"""
app.py — ComplianceGPT FastAPI Backend
────────────────────────────────────────
Run: uvicorn app:app --reload --port 8000
"""

import json
import logging
import shutil
import sys
from pathlib import Path
from typing import Optional
from datetime import datetime, timezone, date
from agents.deadline_agent import scan_deadlines, get_latest_alerts, deadline_summary
from fastapi import FastAPI, UploadFile, File, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

sys.path.append(str(Path(__file__).parent))

_BACKEND_DIR = Path(__file__).parent
from config import PDF_DIR, LOGS_DIR
from core.ingest    import ingest_pdf
from core.retriever import query_rag
from core.audit     import read_audit_log, log_event
from agents.monitoring_agent import run_monitoring_agent, HASH_DB_PATH, SIMULATED_DOCUMENTS
from agents.client_matcher   import match_clients
from agents.drafter_agent    import draft_advisories, draft_single, approve_draft, DRAFTS_DIR

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="ComplianceGPT API",
    description="Autonomous compliance agent system for Indian CA firms",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000", "*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── In-memory state (latest pipeline result) ──────────────────────────────────
_latest_result: dict = {
    "new_documents":  [],
    "match_results":  [],
    "drafts":         [],
    "total_circulars": 0,
    "total_matches":  0,
    "total_drafts":   0,
    "last_run":       None,
    "run_mode":       None,
}


# ── Scheduler ─────────────────────────────────────────────────────────────────

def _run_monitoring_job():
    try:
        logger.info("⏰ Scheduler — running Monitoring Agent...")
        new_docs = run_monitoring_agent(simulate_mode=False, auto_ingest=True)
        logger.info(f"✅ Monitoring job complete — {len(new_docs)} new document(s)")
    except Exception as e:
        logger.error(f"❌ Monitoring job failed: {e}")


def _run_deadline_job():
        try:
            logger.info("⏰ Deadline Watch Agent running...")
            alerts = scan_deadlines()
            summary = deadline_summary(alerts)
            logger.info(
                f"✅ Deadline scan complete — "
                f"{summary['missed']} missed, "
                f"{summary['critical']} critical, "
                f"{summary['warning']} warnings. "
                f"Total exposure: ₹{summary['total_exposure']:,.0f}"
            )
        except Exception as e:
            logger.error(f"❌ Deadline job failed: {e}")


scheduler = BackgroundScheduler()

@app.on_event("startup")
def start_scheduler():
    scheduler.add_job(
        _run_monitoring_job,
        trigger=IntervalTrigger(hours=6),
        id="monitoring_job",
        name="Regulatory Monitoring — every 6 hours",
        replace_existing=True,
    )
    scheduler.add_job(
        _run_deadline_job,
        trigger=IntervalTrigger(hours=6),
        id="deadline_job",
        name="Deadline Watch — every 6 hours",
        replace_existing=True,
    )
    scheduler.start()
    logger.info("⏰ Scheduler started — runs every 6 hours")

@app.on_event("shutdown")
def stop_scheduler():
    scheduler.shutdown()


# ── Pydantic models ────────────────────────────────────────────────────────────

class QueryRequest(BaseModel):
    question: str

class ApproveRequest(BaseModel):
    approved: bool
    ca_name:  str = "CA"

class PipelineRequest(BaseModel):
    simulate_mode: bool = True
    regulators:    Optional[list[str]] = None
    reset:         bool = False


# ─────────────────────────────────────────────
# HEALTH
# ─────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok", "version": "1.0.0"}


# ─────────────────────────────────────────────
# PIPELINE — runs all 3 agents in sequence
# ─────────────────────────────────────────────

@app.post("/pipeline/run")
def run_full_pipeline(req: PipelineRequest, background_tasks: BackgroundTasks):
    """
    Trigger the full pipeline: Monitor → Match → Draft.
    Runs in background so the UI doesn't time out.
    Returns immediately with a job_id.
    """
    background_tasks.add_task(
        _execute_pipeline,
        simulate_mode=req.simulate_mode,
        regulators=req.regulators,
        reset=req.reset,
    )
    return {"message": "Pipeline started", "simulate_mode": req.simulate_mode}


def _execute_pipeline(simulate_mode: bool, regulators, reset: bool):
    global _latest_result
    try:
        if reset and HASH_DB_PATH.exists():
            HASH_DB_PATH.unlink()
            logger.info("🔄 Hash DB reset")

        # Stage 1
        new_docs = run_monitoring_agent(
            simulate_mode=simulate_mode,
            regulators=regulators,
            auto_ingest=False
        )
        if not new_docs:
            _latest_result.update({"new_documents":[],"match_results":[],"drafts":[],
                                    "total_circulars":0,"total_matches":0,"total_drafts":0,
                                    "last_run": _now(), "run_mode": "simulate" if simulate_mode else "real"})
            return

        # Stage 2
        match_results = match_clients(new_docs)
        total_matches = sum(r["match_count"] for r in match_results)

        # Stage 3
        actionable = [r for r in match_results if r["match_count"] > 0]
        drafts     = draft_advisories(actionable) if actionable else []

        _latest_result = {
            "new_documents":   new_docs,
            "match_results":   match_results,
            "drafts":          drafts,
            "total_circulars": len(new_docs),
            "total_matches":   total_matches,
            "total_drafts":    len(drafts),
            "last_run":        _now(),
            "run_mode":        "simulate" if simulate_mode else "real",
        }
        logger.info(f"✅ Pipeline complete — {len(new_docs)} circulars, {total_matches} matches, {len(drafts)} drafts")
    except Exception as e:
        logger.error(f"❌ Pipeline error: {e}")


@app.get("/pipeline/status")
def pipeline_status():
    """Get the latest pipeline run result."""
    return _latest_result


@app.post("/pipeline/reset")
def reset_pipeline():
    """Clear seen_documents.json so monitoring agent finds fresh circulars."""
    if HASH_DB_PATH.exists():
        HASH_DB_PATH.unlink()
        return {"message": "Reset complete — monitoring agent will detect all circulars as new"}
    return {"message": "Nothing to reset"}


# ─────────────────────────────────────────────
# CIRCULARS
# ─────────────────────────────────────────────

@app.get("/circulars")
def get_circulars():
    """Return latest detected circulars with match counts."""
    return {"circulars": _latest_result.get("match_results", [])}


@app.get("/circulars/simulate")
def get_simulated_circulars():
    """Return the 5 simulated circulars — always available for demo."""
    docs = run_monitoring_agent(simulate_mode=True, auto_ingest=False)
    matches = match_clients(docs)
    return {"circulars": matches}


# ─────────────────────────────────────────────
# DRAFTS
# ─────────────────────────────────────────────

@app.get("/drafts")
def list_drafts(status: Optional[str] = None):
    """
    List all draft files from backend/data/drafts/.
    Optionally filter by status: pending_review | approved | rejected
    """
    if not DRAFTS_DIR.exists():
        return {"drafts": []}

    drafts = []
    for path in sorted(DRAFTS_DIR.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        try:
            draft = json.loads(path.read_text(encoding="utf-8"))
            if status is None or draft.get("status") == status:
                drafts.append(draft)
        except Exception:
            continue

    return {"drafts": drafts, "total": len(drafts)}


@app.get("/drafts/{draft_id}")
def get_draft(draft_id: str):
    """Get a single draft by ID."""
    path = DRAFTS_DIR / f"{draft_id}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Draft not found: {draft_id}")
    return json.loads(path.read_text(encoding="utf-8"))


@app.post("/drafts/{draft_id}/approve")
def approve_draft_endpoint(draft_id: str, req: ApproveRequest):
    """CA approves or rejects a draft. Updates status + logs to audit trail."""
    try:
        updated = approve_draft(draft_id=draft_id, approved=req.approved, ca_name=req.ca_name)
        return {
            "message":  f"Draft {'approved' if req.approved else 'rejected'} by {req.ca_name}",
            "draft_id": draft_id,
            "status":   updated["status"],
        }
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Draft not found: {draft_id}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/drafts/{draft_id}")
def delete_draft(draft_id: str):
    """Delete a draft file."""
    path = DRAFTS_DIR / f"{draft_id}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Draft not found: {draft_id}")
    path.unlink()
    return {"message": f"Draft {draft_id} deleted"}


# ─────────────────────────────────────────────
# CLIENTS
# ─────────────────────────────────────────────

@app.get("/clients")
def list_clients():
    """Return all clients from clients.json."""
    clients_path = Path(__file__).parent / "clients.json"
    if not clients_path.exists():
        raise HTTPException(status_code=404, detail="clients.json not found")
    return {"clients": json.loads(clients_path.read_text(encoding="utf-8"))}



# ─────────────────────────────────────────────
# DEADLINE WATCH AGENT
# ─────────────────────────────────────────────
 
@app.get("/deadlines")
def get_deadlines(level: Optional[str] = None, client_id: Optional[str] = None):
    alerts = get_latest_alerts()
    if level:
        alerts = [a for a in alerts if a["level"].upper() == level.upper()]
    if client_id:
        alerts = [a for a in alerts if a["client_id"] == client_id]
    from agents.deadline_agent import deadline_summary as _ds
    summary = _ds(alerts)
    return {
        "alerts":     alerts,
        "total":      len(alerts),
        "summary":    summary,
        "scanned_at": alerts[0]["generated_at"] if alerts else None,
    }
 
 
@app.post("/deadlines/scan")
def trigger_deadline_scan():
    alerts = scan_deadlines()
    from agents.deadline_agent import deadline_summary as _ds
    summary = _ds(alerts)
    return {
        "message": f"Scan complete — {len(alerts)} alert(s) found",
        "summary": summary,
        "alerts":  alerts,
    }
 
 
@app.get("/deadlines/summary")
def get_deadline_summary():
    alerts = get_latest_alerts()
    from agents.deadline_agent import deadline_summary as _ds
    summary = _ds(alerts)
    return {
        "summary":          summary,
        "exposure_display": f"₹{summary['total_exposure']:,.0f} at risk across {summary['total_alerts']} obligation(s)",
    }


@app.post("/deadlines/{alert_id}/send")
def send_deadline_alert(alert_id: str, ca_name: str = "CA"):
    """
    CA approves and sends a deadline alert email to client.
    Logs to audit trail and marks alert as sent.
    
    For demo purposes, this logs the action and returns success.
    In production, this would integrate with SMTP/SendGrid.
    """
    from agents.deadline_agent import get_latest_alerts
    from core.audit import log_event
    
    # Find the alert
    alerts = get_latest_alerts()
    alert = next((a for a in alerts if a["alert_id"] == alert_id), None)
    
    if not alert:
        raise HTTPException(status_code=404, detail=f"Deadline alert not found: {alert_id}")
    
    # Check if alert has associated draft
    draft_id = f"DEADLINE_{alert['client_id']}_{alert['obligation_id']}_{date.today().isoformat()}"
    DRAFTS_DIR = _BACKEND_DIR / "data" / "drafts"
    draft_path = DRAFTS_DIR / f"{draft_id}.json"
    
    if not draft_path.exists():
        # Auto-generate draft if not exists
        from agents.deadline_agent import generate_deadline_drafts
        drafts = generate_deadline_drafts([alert])
        if not drafts:
            raise HTTPException(status_code=500, detail="Failed to generate draft for this alert")
        draft_path = DRAFTS_DIR / f"{drafts[0]['draft_id']}.json"
    
    # Load draft and mark as approved
    draft = json.loads(draft_path.read_text(encoding="utf-8"))
    draft["status"] = "approved"
    draft["approved_by"] = ca_name
    draft["approved_at"] = datetime.now(timezone.utc).isoformat()
    draft["email_sent"] = True
    draft["email_sent_at"] = datetime.now(timezone.utc).isoformat()
    
    # Save updated draft
    draft_path.write_text(json.dumps(draft, indent=2, ensure_ascii=False), encoding="utf-8")
    
    # Log to audit trail
    log_event(
        agent="DeadlineAlert",
        action="email_sent",
        details={
            "alert_id": alert_id,
            "client_id": alert["client_id"],
            "client_name": alert["client_name"],
            "obligation": alert["obligation_type"],
            "deadline_level": alert["level"],
            "ca_name": ca_name,
            "email_to": alert["client_email"],
            "draft_id": draft_id
        }
    )
    
    return {
        "message": f"Deadline alert email sent to {alert['client_email']}",
        "client_name": alert["client_name"],
        "obligation": alert["obligation_type"],
        "deadline_level": alert["level"],
        "draft_id": draft_id,
        "email_to": alert["client_email"],
        "sent_at": draft["email_sent_at"]
    }


# ─────────────────────────────────────────────
# RAG QUERY
# ─────────────────────────────────────────────

@app.post("/query")
def query(req: QueryRequest):
    """Ask a compliance question — answered via RAG pipeline."""
    if not req.question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty")
    return query_rag(req.question)


# ─────────────────────────────────────────────
# INGEST
# ─────────────────────────────────────────────

@app.post("/ingest")
def ingest(file: UploadFile = File(...)):
    """Upload and ingest a PDF into ChromaDB."""
    if not file.filename.endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files accepted")
    dest = PDF_DIR / file.filename
    PDF_DIR.mkdir(parents=True, exist_ok=True)
    with open(dest, "wb") as f:
        shutil.copyfileobj(file.file, f)
    ingest_pdf(str(dest))
    return {"message": f"{file.filename} ingested successfully"}


# ─────────────────────────────────────────────
# AUDIT TRAIL
# ─────────────────────────────────────────────

@app.get("/audit")
def get_audit_log(limit: int = 100, agent: Optional[str] = None):
    """
    Return audit log entries, newest first.
    Optionally filter by agent name.
    """
    events = read_audit_log()
    if agent:
        events = [e for e in events if e.get("agent") == agent]
    return {
        "events": events[:limit],
        "total":  len(events),
    }


# ─────────────────────────────────────────────
# SCHEDULER STATUS
# ─────────────────────────────────────────────

@app.get("/scheduler/status")
def scheduler_status():
    jobs = []
    for job in scheduler.get_jobs():
        jobs.append({"id":job.id,"name":job.name,"next_run":str(job.next_run_time)})
    return {"scheduler_running": scheduler.running, "jobs": jobs}

@app.post("/scheduler/trigger")
def trigger_now():
    """Manually trigger monitoring agent (simulate mode, no ingest)."""
    try:
        new_docs = run_monitoring_agent(simulate_mode=True, auto_ingest=False)
        return {
            "message":   f"Triggered — {len(new_docs)} new document(s) found",
            "documents": [{"title":d["title"],"regulator":d["regulator"],"priority":d["priority"]} for d in new_docs]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────

def _now() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()