"""
app.py — ComplianceGPT FastAPI Backend
────────────────────────────────────────
Run: uvicorn app:app --reload --port 8000
"""

import json
import logging
import shutil
import sys
import time
from pathlib import Path
from typing import Optional, List
from datetime import datetime, timezone, date
from agents.deadline_agent import scan_deadlines, get_latest_alerts, deadline_summary
from fastapi import FastAPI, UploadFile, File, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

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

# ── Suppress noisy dashboard-polling GET logs from uvicorn access log ──────────
_SILENT_PATHS = {
    "/pipeline/status", "/circulars", "/drafts", "/audit",
    "/deadlines", "/compliance-calendar", "/clients", "/scheduler/status", "/health",
}

class _SilentPollingFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        msg = record.getMessage()
        return not any(
            f'"GET {path} HTTP' in msg or f'"OPTIONS {path} HTTP' in msg
            for path in _SILENT_PATHS
        )

logging.getLogger("uvicorn.access").addFilter(_SilentPollingFilter())

PIPELINE_STATUS_PATH = Path(__file__).parent / "data" / "latest_pipeline_status.json"

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
    "status":         "idle",
    "stage":          "idle",
    "status_message": "Waiting for first run",
    "started_at":     None,
    "updated_at":     None,
}


def _save_pipeline_status(status: dict) -> None:
    PIPELINE_STATUS_PATH.parent.mkdir(parents=True, exist_ok=True)
    PIPELINE_STATUS_PATH.write_text(
        json.dumps(status, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _load_pipeline_status() -> dict:
    if not PIPELINE_STATUS_PATH.exists():
        return dict(_latest_result)
    try:
        saved = json.loads(PIPELINE_STATUS_PATH.read_text(encoding="utf-8"))
    except Exception as exc:
        logger.warning(f"Failed to load persisted pipeline status: {exc}")
        return dict(_latest_result)

    return {
        "new_documents": saved.get("new_documents", []),
        "match_results": saved.get("match_results", []),
        "drafts": saved.get("drafts", []),
        "total_circulars": saved.get("total_circulars", 0),
        "total_matches": saved.get("total_matches", 0),
        "total_drafts": saved.get("total_drafts", 0),
        "last_run": saved.get("last_run"),
        "run_mode": saved.get("run_mode"),
        "status": saved.get("status", "idle"),
        "stage": saved.get("stage", "idle"),
        "status_message": saved.get("status_message", "Waiting for first run"),
        "started_at": saved.get("started_at"),
        "updated_at": saved.get("updated_at"),
    }


def _update_pipeline_result(**updates) -> None:
    global _latest_result
    _latest_result.update(updates)
    _latest_result["updated_at"] = _now()
    _save_pipeline_status(_latest_result)


# ── Scheduler ─────────────────────────────────────────────────────────────────

def _run_monitoring_job():
    try:
        logger.info("⏰ Scheduler — running Monitoring Agent...")
        new_docs = run_monitoring_agent(simulate_mode=False, auto_ingest=True)
        logger.info(f"✅ Monitoring job complete — {len(new_docs)} new document(s)")
    except Exception as e:
        logger.error(f"❌ Monitoring job failed: {e}")


def _run_reminder_job():
    try:
        logger.info("⏰ Reminder Agent — scanning client obligations...")
        from agents.drafter_agent import scan_and_remind
        drafts = scan_and_remind(days_window=14)
        logger.info(f"✅ Reminder scan complete — {len(drafts)} reminder draft(s) generated")
    except Exception as e:
        logger.error(f"❌ Reminder job failed: {e}")


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
    global _latest_result
    _latest_result = _load_pipeline_status()
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
    scheduler.add_job(
        _run_reminder_job,
        trigger=IntervalTrigger(hours=24),
        id="reminder_job",
        name="Obligation Reminders — every 24 hours",
        replace_existing=True,
    )
    scheduler.start()
    logger.info("⏰ Scheduler started — monitoring every 6h, reminders every 24h")

@app.on_event("shutdown")
def stop_scheduler():
    scheduler.shutdown()


# ── Pydantic models ────────────────────────────────────────────────────────────

class QueryTurn(BaseModel):
    role: str
    content: str


class QueryFilters(BaseModel):
    regulator: Optional[str] = None
    title_contains: Optional[str] = None
    date_from: Optional[str] = None
    date_to: Optional[str] = None


class QueryRequest(BaseModel):
    question: str
    history: List[QueryTurn] = Field(default_factory=list)
    filters: Optional[QueryFilters] = None
    active_document: Optional[str] = None

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
        started_at = _now()
        _update_pipeline_result(
            new_documents=[],
            match_results=[],
            drafts=[],
            total_circulars=0,
            total_matches=0,
            total_drafts=0,
            last_run=None,
            run_mode="simulate" if simulate_mode else "real",
            status="running",
            stage="monitoring",
            status_message="Monitoring stage started",
            started_at=started_at,
        )

        if reset and HASH_DB_PATH.exists():
            HASH_DB_PATH.unlink()
            logger.info("🔄 Hash DB reset")
            _update_pipeline_result(status_message="Pipeline state reset. Monitoring stage started")

        # Stage 1 — scrape + save PDFs + ingest into ChromaDB
        new_docs = run_monitoring_agent(
            simulate_mode=simulate_mode,
            regulators=regulators,
            auto_ingest=True
        )
        _update_pipeline_result(
            new_documents=new_docs,
            total_circulars=len(new_docs),
            stage="monitoring",
            status_message=f"Monitoring complete: {len(new_docs)} circular(s) found",
        )
        if not new_docs:
            _update_pipeline_result(
                match_results=[],
                drafts=[],
                total_matches=0,
                total_drafts=0,
                last_run=_now(),
                status="completed",
                stage="completed",
                status_message="Pipeline completed with no new documents",
            )
            return

        # Stage 2
        _update_pipeline_result(stage="matching", status_message="Client matching in progress")
        match_results = match_clients(new_docs)
        total_matches = sum(r["match_count"] for r in match_results)
        _update_pipeline_result(
            match_results=match_results,
            total_matches=total_matches,
            stage="matching",
            status_message=f"Matching complete: {total_matches} client match(es) found",
        )

        # Stage 3
        # Deduplicate match_results: same circular can appear twice when scraped from
        # two different RBI endpoints (press releases + circulars index). Keep the
        # entry with the higher match_count (usually identical, but safer).
        _seen_circulars: dict[str, dict] = {}
        for r in match_results:
            key = f"{r['regulator']}::{r['circular_title'].lower().strip()}"
            if key not in _seen_circulars or r["match_count"] > _seen_circulars[key]["match_count"]:
                _seen_circulars[key] = r
        deduped_results = list(_seen_circulars.values())

        # Sort: HIGH priority circulars first so rate-limit cap doesn't waste slots on LOW docs
        actionable = sorted(
            [r for r in deduped_results if r["match_count"] > 0],
            key=lambda r: {"HIGH": 0, "MEDIUM": 1, "LOW": 2}.get(r.get("priority", "LOW"), 2),
        )
        # Cap total drafts per run and per client to ensure diversity.
        # Without a per-client cap, one client with many matching circulars
        # (e.g. Sunrise Finserv × 20 RBI penalty notices) consumes all slots.
        MAX_DRAFTS_PER_RUN    = 20
        MAX_DRAFTS_PER_CLIENT = 1   # 1 draft per client keeps demo diverse across all 10 clients
        _update_pipeline_result(
            stage="drafting",
            status_message=f"Draft generation started for {len(actionable)} actionable circular(s) (cap: {MAX_DRAFTS_PER_RUN}, {MAX_DRAFTS_PER_CLIENT}/client)",
        )
        drafts = []
        if actionable:
            clients_path = Path(__file__).parent / "clients.json"
            clients_map = {
                client["id"]: client
                for client in json.loads(clients_path.read_text(encoding="utf-8"))
            }
            total_targets = min(
                sum(len(item.get("affected_clients", [])) for item in actionable),
                MAX_DRAFTS_PER_RUN,
            )
            processed_targets  = 0
            drafts_per_client: dict[str, int] = {}   # client_id → draft count this run

            for item in actionable:
                if processed_targets >= MAX_DRAFTS_PER_RUN:
                    logger.info(f"Draft cap ({MAX_DRAFTS_PER_RUN}) reached — deferring remaining circulars to next run")
                    break
                circular = {
                    "title": item["circular_title"],
                    "regulator": item["regulator"],
                    "priority": item["priority"],
                    "summary": item.get("summary", ""),
                    "url": item.get("url", ""),
                }
                # Within each circular: highest-risk clients (lowest compliance_score) first
                affected_sorted = sorted(
                    item.get("affected_clients", []),
                    key=lambda a: (clients_map.get(a["client_id"]) or {})
                        .get("risk", (clients_map.get(a["client_id"]) or {}).get("risk_profile", {}))
                        .get("compliance_score", 100)
                )
                for affected in affected_sorted:
                    if processed_targets >= MAX_DRAFTS_PER_RUN:
                        break
                    client_id = affected["client_id"]
                    if drafts_per_client.get(client_id, 0) >= MAX_DRAFTS_PER_CLIENT:
                        continue   # this client already has enough drafts this run
                    client = clients_map.get(client_id)
                    if not client:
                        continue
                    draft = draft_single(circular, client)
                    drafts.append(draft)
                    processed_targets += 1
                    drafts_per_client[client_id] = drafts_per_client.get(client_id, 0) + 1
                    _update_pipeline_result(
                        drafts=drafts,
                        total_drafts=len(drafts),
                        stage="drafting",
                        status_message=(
                            f"Drafting in progress: {processed_targets}/{total_targets} draft(s) generated"
                        ),
                    )
                    # Pace LLM calls to stay under Groq free-tier rate limit (~30 req/min).
                    # 2s gap = max 30 drafts/min; reduces 429 retries from hammering the API.
                    if processed_targets < total_targets:
                        time.sleep(2)

        _latest_result = {
            "new_documents":   new_docs,
            "match_results":   match_results,
            "drafts":          drafts,
            "total_circulars": len(new_docs),
            "total_matches":   total_matches,
            "total_drafts":    len(drafts),
            "last_run":        _now(),
            "run_mode":        "simulate" if simulate_mode else "real",
            "status":          "completed",
            "stage":           "completed",
            "status_message":  f"Pipeline completed: {len(new_docs)} circular(s), {total_matches} match(es), {len(drafts)} draft(s)",
            "started_at":      started_at,
            "updated_at":      _now(),
        }
        _save_pipeline_status(_latest_result)
        logger.info(f"✅ Pipeline complete — {len(new_docs)} circulars, {total_matches} matches, {len(drafts)} drafts")
    except Exception as e:
        _update_pipeline_result(
            status="failed",
            stage="failed",
            status_message=f"Pipeline failed: {e}",
            last_run=_latest_result.get("last_run"),
        )
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

_CLIENTS_PATH = Path(__file__).parent / "clients.json"

def _load_clients() -> list:
    if not _CLIENTS_PATH.exists():
        return []
    return json.loads(_CLIENTS_PATH.read_text(encoding="utf-8"))

def _save_clients(clients: list) -> None:
    _CLIENTS_PATH.write_text(json.dumps(clients, indent=2, ensure_ascii=False), encoding="utf-8")

def _next_client_id(clients: list) -> str:
    nums = []
    for c in clients:
        cid = c.get("id", "")
        if cid.startswith("CLT-"):
            try:
                nums.append(int(cid.split("-")[1]))
            except (IndexError, ValueError):
                pass
    return f"CLT-{(max(nums, default=0) + 1):03d}"


@app.get("/clients")
def list_clients():
    return {"clients": _load_clients()}


@app.get("/clients/{client_id}")
def get_client(client_id: str):
    client = next((c for c in _load_clients() if c["id"] == client_id), None)
    if not client:
        raise HTTPException(status_code=404, detail=f"Client {client_id} not found")
    return client


@app.post("/clients", status_code=201)
def create_client(body: dict):
    clients = _load_clients()
    client = dict(body)
    client["id"] = _next_client_id(clients)
    clients.append(client)
    _save_clients(clients)
    name = client.get("profile", {}).get("name", client.get("profile", {}).get("name", ""))
    log_event(agent="CA", action="client_created", details={"client_id": client["id"], "name": name})
    return client


@app.put("/clients/{client_id}")
def update_client(client_id: str, body: dict):
    clients = _load_clients()
    idx = next((i for i, c in enumerate(clients) if c["id"] == client_id), None)
    if idx is None:
        raise HTTPException(status_code=404, detail=f"Client {client_id} not found")
    updated = dict(body)
    updated["id"] = client_id
    clients[idx] = updated
    _save_clients(clients)
    log_event(agent="CA", action="client_updated", details={"client_id": client_id})
    return updated


@app.delete("/clients/{client_id}", status_code=204)
def delete_client(client_id: str):
    clients = _load_clients()
    new_clients = [c for c in clients if c["id"] != client_id]
    if len(new_clients) == len(clients):
        raise HTTPException(status_code=404, detail=f"Client {client_id} not found")
    _save_clients(new_clients)
    log_event(agent="CA", action="client_deleted", details={"client_id": client_id})
    return None



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
# PROACTIVE REMINDER SCAN
# ─────────────────────────────────────────────

@app.post("/reminders/scan")
def trigger_reminder_scan(days_window: int = 14):
    """
    Scan all client obligations and generate reminder drafts for:
      - Obligations overdue
      - Obligations due within `days_window` days (default 14)
      - Obligations with status "critical" or "action_needed"

    Drafts appear in the same review queue as circular-driven drafts.
    """
    from agents.drafter_agent import scan_and_remind
    drafts = scan_and_remind(days_window=days_window)
    return {
        "generated": len(drafts),
        "days_window": days_window,
        "draft_ids": [d["draft_id"] for d in drafts],
    }


# ─────────────────────────────────────────────
# COMPLIANCE CALENDAR
# ─────────────────────────────────────────────

@app.get("/compliance-calendar")
def get_compliance_calendar():
    """
    Returns the full Indian statutory compliance calendar with next due dates.
    Top ~20 recurring deadlines every CA firm tracks (GST, TDS, MCA, RBI, SEBI).
    """
    from core.deadline_parser import get_calendar
    calendar = get_calendar()
    return {
        "calendar": calendar,
        "total": len(calendar),
        "as_of": date.today().isoformat(),
    }


# ─────────────────────────────────────────────
# RAG QUERY
# ─────────────────────────────────────────────

@app.post("/query")
def query(req: QueryRequest):
    """Ask a compliance question — answered via RAG pipeline."""
    if not req.question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty")
    return query_rag(
        req.question,
        filters=req.filters.dict(exclude_none=True) if req.filters else None,
        active_document=req.active_document,
    )


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
