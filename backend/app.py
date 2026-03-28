"""
app.py — ComplianceGPT FastAPI Backend
────────────────────────────────────────
Run: uvicorn app:app --reload --port 8000
"""
import os
import json
import hashlib
import logging
import re
import shutil
import sys
from uuid import uuid4
import time
from pathlib import Path
from typing import Optional, List
from datetime import datetime, timezone, date
from agents.deadline_agent import scan_deadlines, get_latest_alerts, deadline_summary
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

sys.path.append(str(Path(__file__).parent))

_BACKEND_DIR = Path(__file__).parent
from config import PDF_DIR, LOGS_DIR
from core.ingest    import ingest_pdf
from core.retriever import query_rag, invalidate_collection_cache
from core.audit     import read_audit_log, log_event
from agents.monitoring_agent import run_monitoring_agent, HASH_DB_PATH, SIMULATED_DOCUMENTS
from agents.client_matcher   import match_clients
from agents.drafter_agent    import draft_single, DRAFTS_DIR

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
UPLOADED_DOCS_PATH = Path(__file__).parent / "data" / "uploaded_documents.json"
SUPPORTED_REGULATORS = {"RBI", "GST", "IncomeTax", "MCA", "SEBI"}
SUPPORTED_UPLOAD_EXTENSIONS = {".pdf", ".txt"}

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


def _load_uploaded_documents() -> dict:
    if not UPLOADED_DOCS_PATH.exists():
        return {}
    try:
        data = json.loads(UPLOADED_DOCS_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}
    if not isinstance(data, dict):
        return {}
    return data


def _save_uploaded_documents(documents: dict) -> None:
    UPLOADED_DOCS_PATH.parent.mkdir(parents=True, exist_ok=True)
    UPLOADED_DOCS_PATH.write_text(
        json.dumps(documents, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _slugify_filename(name: str) -> str:
    stem = re.sub(r"[^A-Za-z0-9._-]+", "_", name).strip("._")
    return stem or "document"


def _infer_priority_from_title(title: str) -> str:
    lower = title.lower()
    if any(token in lower for token in ("deadline", "extension", "penalty", "mandatory", "fema", "urgent")):
        return "HIGH"
    if any(token in lower for token in ("advisory", "clarification", "information", "guidelines", "faq")):
        return "LOW"
    return "MEDIUM"


def _summary_from_preview(preview_text: str) -> str:
    compact = re.sub(r"\s+", " ", preview_text or "").strip()
    if not compact:
        return "Manual upload document for compliance processing."
    return compact[:220]


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


class SaveDraftRequest(BaseModel):
    subject: str
    body: str
    ca_name: str = "CA"


class SendDraftRequest(BaseModel):
    subject: str
    body: str
    ca_name: str = "CA"
    idempotency_key: Optional[str] = None


class ReopenDraftRequest(BaseModel):
    ca_name: str = "CA"

class PipelineRequest(BaseModel):
    simulate_mode: bool = True
    regulators:    Optional[list[str]] = None
    reset:         bool = False


class DocumentPipelineRequest(BaseModel):
    ca_name: str = "CA"


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


def _execute_uploaded_document_pipeline(document_id: str, ca_name: str):
    global _latest_result
    try:
        uploaded_docs = _load_uploaded_documents()
        uploaded = uploaded_docs.get(document_id)
        if not uploaded:
            raise ValueError(f"Uploaded document not found: {document_id}")

        started_at = _now()
        pipeline_doc = {
            "document_id": document_id,
            "regulator": uploaded["regulator"],
            "title": uploaded["title"],
            "url": uploaded.get("url") or "",
            "filename": uploaded["stored_filename"],
            "priority": uploaded["priority"],
            "summary": uploaded["summary"],
            "source": "manual_upload",
            "uploaded_by": uploaded.get("uploaded_by", "CA"),
            "uploaded_at": uploaded.get("uploaded_at"),
        }

        _update_pipeline_result(
            new_documents=[pipeline_doc],
            match_results=[],
            drafts=[],
            total_circulars=1,
            total_matches=0,
            total_drafts=0,
            last_run=None,
            run_mode="manual_upload",
            status="running",
            stage="matching",
            status_message=f"Running matcher for uploaded document: {uploaded['title']}",
            started_at=started_at,
        )

        match_results = match_clients([pipeline_doc])
        total_matches = sum(item["match_count"] for item in match_results)
        _update_pipeline_result(
            match_results=match_results,
            total_matches=total_matches,
            stage="matching",
            status_message=f"Matching complete: {total_matches} client match(es)",
        )

        _update_pipeline_result(
            stage="drafting",
            status_message="Draft generation in progress",
        )

        drafts = []
        actionable = [item for item in match_results if item["match_count"] > 0]
        if actionable:
            clients_path = Path(__file__).parent / "clients.json"
            clients_map = {
                client["id"]: client
                for client in json.loads(clients_path.read_text(encoding="utf-8"))
            }
            total_targets = sum(len(item.get("affected_clients", [])) for item in actionable)
            processed_targets = 0
            for item in actionable:
                circular = {
                    "title": item["circular_title"],
                    "regulator": item["regulator"],
                    "priority": item["priority"],
                    "summary": item.get("summary", ""),
                }
                for affected in item.get("affected_clients", []):
                    client = clients_map.get(affected["client_id"])
                    if not client:
                        continue
                    draft = draft_single(circular, client)
                    drafts.append(draft)
                    processed_targets += 1
                    _update_pipeline_result(
                        drafts=drafts,
                        total_drafts=len(drafts),
                        stage="drafting",
                        status_message=(
                            f"Drafting in progress: {processed_targets}/{total_targets} draft(s) generated"
                        ),
                    )

        _update_pipeline_result(
            stage="deadlines",
            status_message="Scanning deadlines from updated drafts and client obligations",
        )
        alerts = scan_deadlines()
        deadline_count = len(alerts)

        _latest_result = {
            "new_documents": [pipeline_doc],
            "match_results": match_results,
            "drafts": drafts,
            "total_circulars": 1,
            "total_matches": total_matches,
            "total_drafts": len(drafts),
            "last_run": _now(),
            "run_mode": "manual_upload",
            "status": "completed",
            "stage": "completed",
            "status_message": (
                f"Uploaded document pipeline complete: {total_matches} match(es), "
                f"{len(drafts)} draft(s), {deadline_count} deadline alert(s) in watchlist"
            ),
            "started_at": started_at,
            "updated_at": _now(),
        }
        _save_pipeline_status(_latest_result)

        uploaded["last_pipeline_run"] = _now()
        uploaded["last_pipeline_summary"] = {
            "matches": total_matches,
            "drafts": len(drafts),
            "deadline_alerts": deadline_count,
            "triggered_by": ca_name,
        }
        uploaded_docs[document_id] = uploaded
        _save_uploaded_documents(uploaded_docs)

        log_event(
            agent="UploadAgent",
            action="document_pipeline_completed",
            details={
                "document_id": document_id,
                "title": uploaded["title"],
                "regulator": uploaded["regulator"],
                "uploaded_by": uploaded.get("uploaded_by", "CA"),
                "triggered_by": ca_name,
                "matches": total_matches,
                "drafts": len(drafts),
                "deadline_alerts": deadline_count,
            },
            citation=uploaded["stored_filename"],
        )
    except Exception as exc:
        _update_pipeline_result(
            status="failed",
            stage="failed",
            status_message=f"Uploaded document pipeline failed: {exc}",
            last_run=_latest_result.get("last_run"),
        )
        logger.error(f"❌ Uploaded document pipeline error ({document_id}): {exc}")


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

_REVIEW_STATUSES = {"pending", "approved", "rejected"}
_DELIVERY_STATUSES = {"not_sent", "sent", "failed"}


def _canonical_client_key(client_id: str) -> str:
    value = str(client_id or "").strip().upper()
    if not value:
        return ""
    if value.startswith("CLT-"):
        suffix = value.split("-", 1)[1]
        if suffix.isdigit():
            return f"C{int(suffix)}"
        return value
    if value.startswith("C") and value[1:].isdigit():
        return f"C{int(value[1:])}"
    return value


def _extract_client_contact(client: dict) -> tuple[str, str]:
    profile = client.get("profile", {}) if isinstance(client, dict) else {}
    contact = client.get("contact", {}) if isinstance(client, dict) else {}
    name = (
        str(profile.get("name") or client.get("name") or "").strip()
        if isinstance(client, dict)
        else ""
    )
    email = (
        str(profile.get("email") or contact.get("email") or client.get("email") or "").strip()
        if isinstance(client, dict)
        else ""
    )
    return name, email


def _build_clients_lookup() -> tuple[dict, dict]:
    by_id: dict[str, dict] = {}
    by_name: dict[str, dict] = {}
    for client in _load_clients():
        raw_id = str(client.get("id", "")).strip()
        keys = {raw_id.upper(), _canonical_client_key(raw_id)}
        for key in keys:
            if key:
                by_id[key] = client
        name, _ = _extract_client_contact(client)
        if name:
            by_name[name.lower()] = client
    return by_id, by_name


def _hydrate_draft_client_contact(
    draft: dict,
    clients_by_id: Optional[dict] = None,
    clients_by_name: Optional[dict] = None,
) -> dict:
    hydrated = dict(draft or {})
    if clients_by_id is None or clients_by_name is None:
        clients_by_id, clients_by_name = _build_clients_lookup()

    raw_client_id = str(hydrated.get("client_id", "")).strip()
    lookup_id = _canonical_client_key(raw_client_id)
    client = (
        clients_by_id.get(raw_client_id.upper())
        or clients_by_id.get(lookup_id)
    )
    if not client:
        draft_name = str(hydrated.get("client_name", "")).strip().lower()
        if draft_name:
            client = clients_by_name.get(draft_name)

    if client:
        live_name, live_email = _extract_client_contact(client)
        if live_name:
            hydrated["client_name"] = live_name
        if live_email:
            hydrated["client_email"] = live_email

    return hydrated


def _canonical_draft_status(review_status: str, delivery_status: str) -> str:
    if review_status == "rejected":
        return "rejected"
    if review_status == "approved":
        if delivery_status == "sent":
            return "approved"
        if delivery_status == "failed":
            return "send_failed"
        return "approved_not_sent"
    return "pending_review"


def _normalize_draft_state(draft: dict) -> dict:
    normalized = dict(draft or {})

    legacy_status = str(normalized.get("status", "")).strip().lower()
    review_status = str(normalized.get("review_status", "")).strip().lower()
    delivery_status = str(normalized.get("delivery_status", "")).strip().lower()
    email_sent = bool(normalized.get("email_sent"))
    send_error = normalized.get("send_error")

    if review_status not in _REVIEW_STATUSES:
        if legacy_status == "rejected":
            review_status = "rejected"
        elif legacy_status in {"approved", "approved_not_sent", "send_failed", "sent"}:
            review_status = "approved"
        else:
            review_status = "pending"

    if delivery_status not in _DELIVERY_STATUSES:
        if review_status == "rejected":
            delivery_status = "not_sent"
        elif legacy_status == "send_failed":
            delivery_status = "failed"
        elif legacy_status == "approved_not_sent":
            delivery_status = "not_sent"
        elif legacy_status == "sent":
            delivery_status = "sent"
        elif legacy_status == "approved":
            if email_sent:
                delivery_status = "sent"
            elif send_error:
                delivery_status = "failed"
            else:
                delivery_status = "not_sent"
        else:
            delivery_status = "sent" if email_sent else "not_sent"

    if review_status == "rejected":
        delivery_status = "not_sent"
    if delivery_status == "sent":
        review_status = "approved"

    normalized["review_status"] = review_status
    normalized["delivery_status"] = delivery_status
    normalized["status"] = _canonical_draft_status(review_status, delivery_status)
    normalized["email_sent"] = delivery_status == "sent"

    if delivery_status != "failed":
        normalized["send_error"] = None

    return normalized


def _load_draft_for_update(draft_id: str) -> tuple[Path, dict]:
    path = DRAFTS_DIR / f"{draft_id}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Draft not found: {draft_id}")
    draft = json.loads(path.read_text(encoding="utf-8"))
    normalized = _normalize_draft_state(draft)
    hydrated = _hydrate_draft_client_contact(normalized)
    return path, hydrated


def _write_draft(path: Path, draft: dict) -> dict:
    normalized = _normalize_draft_state(draft)
    normalized = _hydrate_draft_client_contact(normalized)
    path.write_text(json.dumps(normalized, indent=2, ensure_ascii=False), encoding="utf-8")
    return normalized


def _matches_draft_filter(draft: dict, status_filter: str) -> bool:
    value = (status_filter or "").strip().lower()
    if not value:
        return True
    return value in {
        str(draft.get("status", "")).lower(),
        str(draft.get("review_status", "")).lower(),
        str(draft.get("delivery_status", "")).lower(),
    }


def _send_fingerprint(client_email: str, subject: str, body: str) -> str:
    payload = f"{client_email.strip().lower()}|{subject.strip()}|{body.strip()}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()

@app.get("/drafts")
def list_drafts(
    status: Optional[str] = None,
    review_status: Optional[str] = None,
    delivery_status: Optional[str] = None,
):
    """
    List all draft files from backend/data/drafts/.
    Filters:
      - status: pending_review | approved_not_sent | send_failed | approved | rejected
      - review_status: pending | approved | rejected
      - delivery_status: not_sent | sent | failed
    """
    if not DRAFTS_DIR.exists():
        return {"drafts": []}

    review_filter = (review_status or "").strip().lower()
    delivery_filter = (delivery_status or "").strip().lower()

    drafts = []
    clients_by_id, clients_by_name = _build_clients_lookup()
    for path in sorted(DRAFTS_DIR.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
        try:
            draft = _normalize_draft_state(json.loads(path.read_text(encoding="utf-8")))
            draft = _hydrate_draft_client_contact(
                draft,
                clients_by_id=clients_by_id,
                clients_by_name=clients_by_name,
            )
            if status and not _matches_draft_filter(draft, status):
                continue
            if review_filter and draft.get("review_status") != review_filter:
                continue
            if delivery_filter and draft.get("delivery_status") != delivery_filter:
                continue
            drafts.append(draft)
        except Exception:
            continue

    return {"drafts": drafts, "total": len(drafts)}


@app.get("/drafts/{draft_id}")
def get_draft(draft_id: str):
    """Get a single draft by ID."""
    _, draft = _load_draft_for_update(draft_id)
    return draft


@app.post("/drafts/{draft_id}/approve")
def approve_draft_endpoint(draft_id: str, req: ApproveRequest):
    """CA marks review decision only. Delivery is handled by /drafts/{draft_id}/send."""
    try:
        path, draft = _load_draft_for_update(draft_id)
        now = datetime.now(timezone.utc).isoformat()

        draft["reviewed_by"] = req.ca_name
        draft["reviewed_at"] = now

        if req.approved:
            draft["review_status"] = "approved"
            if draft.get("delivery_status") != "sent":
                draft["delivery_status"] = draft.get("delivery_status") or "not_sent"
                if draft["delivery_status"] not in _DELIVERY_STATUSES:
                    draft["delivery_status"] = "not_sent"
                if draft["delivery_status"] == "failed":
                    # keep failed state so CA can explicitly retry send
                    pass
                elif draft["delivery_status"] != "sent":
                    draft["delivery_status"] = "not_sent"
            draft["approved_by"] = req.ca_name
            draft["approved_at"] = now
            action = "draft_approved"
        else:
            draft["review_status"] = "rejected"
            draft["delivery_status"] = "not_sent"
            draft["approved_by"] = None
            draft["approved_at"] = None
            draft["email_sent"] = False
            draft["email_sent_at"] = None
            draft["send_error"] = None
            action = "draft_rejected"

        updated = _write_draft(path, draft)

        log_event(
            agent="CA",
            action=action,
            details={
                "draft_id": draft_id,
                "client_id": updated.get("client_id"),
                "client_name": updated.get("client_name"),
                "ca_name": req.ca_name,
                "review_status": updated.get("review_status"),
                "delivery_status": updated.get("delivery_status"),
                "status": updated.get("status"),
            },
            user_approval=req.approved,
        )

        return {
            "message": (
                f"Draft approved by {req.ca_name}"
                if req.approved
                else f"Draft rejected by {req.ca_name}"
            ),
            "draft_id": draft_id,
            "status": updated["status"],
            "review_status": updated["review_status"],
            "delivery_status": updated["delivery_status"],
        }
    except Exception as e:
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/drafts/{draft_id}/save")
def save_draft_endpoint(draft_id: str, req: SaveDraftRequest):
    """Save subject/body edits without changing review or delivery state."""
    path, draft = _load_draft_for_update(draft_id)
    if draft.get("delivery_status") == "sent":
        raise HTTPException(
            status_code=400,
            detail="Draft is already sent. Reopen before editing for resend.",
        )

    now = datetime.now(timezone.utc).isoformat()
    draft["email_subject"] = req.subject
    draft["email_body"] = req.body
    draft["last_edited_by"] = req.ca_name
    draft["last_edited_at"] = now

    updated = _write_draft(path, draft)
    log_event(
        agent="CA",
        action="draft_saved",
        details={
            "draft_id": draft_id,
            "client_id": updated.get("client_id"),
            "client_name": updated.get("client_name"),
            "ca_name": req.ca_name,
            "review_status": updated.get("review_status"),
            "delivery_status": updated.get("delivery_status"),
            "status": updated.get("status"),
        },
    )

    return {
        "message": "Draft saved",
        "draft_id": draft_id,
        "status": updated["status"],
        "review_status": updated["review_status"],
        "delivery_status": updated["delivery_status"],
    }


@app.post("/drafts/{draft_id}/reopen")
def reopen_draft_endpoint(draft_id: str, req: ReopenDraftRequest):
    """Move draft back to pending review so CA can edit/review again."""
    path, draft = _load_draft_for_update(draft_id)

    now = datetime.now(timezone.utc).isoformat()
    draft["review_status"] = "pending"
    draft["delivery_status"] = "not_sent"
    draft["reopened_by"] = req.ca_name
    draft["reopened_at"] = now
    draft["reviewed_by"] = None
    draft["reviewed_at"] = None
    draft["approved_by"] = None
    draft["approved_at"] = None
    draft["email_sent"] = False
    draft["email_sent_at"] = None
    draft["send_error"] = None
    draft["last_send_result"] = None
    draft["last_send_error"] = None
    draft["last_send_idempotency_key"] = None
    draft["last_send_fingerprint"] = None

    updated = _write_draft(path, draft)
    log_event(
        agent="CA",
        action="draft_reopened",
        details={
            "draft_id": draft_id,
            "client_id": updated.get("client_id"),
            "client_name": updated.get("client_name"),
            "ca_name": req.ca_name,
            "review_status": updated.get("review_status"),
            "delivery_status": updated.get("delivery_status"),
            "status": updated.get("status"),
        },
    )

    return {
        "message": "Draft moved back to pending review",
        "draft_id": draft_id,
        "status": updated["status"],
        "review_status": updated["review_status"],
        "delivery_status": updated["delivery_status"],
    }


@app.post("/drafts/{draft_id}/send")
def send_draft_email(draft_id: str, req: SendDraftRequest):
    """Send draft email to client. Auto-approves pending drafts before delivery."""
    path, draft = _load_draft_for_update(draft_id)

    if draft.get("review_status") == "rejected":
        raise HTTPException(status_code=400, detail="Draft is rejected. Reopen before sending.")

    client_email = draft.get("client_email", "")
    if not client_email:
        raise HTTPException(status_code=400, detail="No client email on this draft")

    idempotency_key = (req.idempotency_key or str(uuid4())).strip()
    fingerprint = _send_fingerprint(client_email, req.subject, req.body)

    if draft.get("delivery_status") == "sent":
        if draft.get("last_send_fingerprint") == fingerprint:
            return {
                "message": f"Email already sent to {client_email}",
                "already_sent": True,
                "draft_id": draft_id,
                "client_email": client_email,
                "sent_at": draft.get("email_sent_at"),
                "status": draft.get("status"),
                "review_status": draft.get("review_status"),
                "delivery_status": draft.get("delivery_status"),
            }
        raise HTTPException(
            status_code=400,
            detail="Draft already sent. Reopen if you want to edit and send again.",
        )

    if idempotency_key and idempotency_key == draft.get("last_send_idempotency_key"):
        last_result = draft.get("last_send_result")
        if last_result == "sent":
            return {
                "message": f"Email already sent to {client_email}",
                "already_sent": True,
                "draft_id": draft_id,
                "client_email": client_email,
                "sent_at": draft.get("email_sent_at"),
                "status": draft.get("status"),
                "review_status": draft.get("review_status"),
                "delivery_status": draft.get("delivery_status"),
            }
        if last_result == "failed":
            raise HTTPException(
                status_code=409,
                detail=f"Previous send attempt with the same request key failed: {draft.get('last_send_error') or 'unknown error'}",
            )

    from config import SMTP_USER, SMTP_PASS
    email_sent = False
    send_error = None
    requested_at = datetime.now(timezone.utc).isoformat()

    if draft.get("review_status") == "pending":
        draft["review_status"] = "approved"
        draft["approved_by"] = req.ca_name
        draft["approved_at"] = requested_at
        draft["reviewed_by"] = req.ca_name
        draft["reviewed_at"] = requested_at
    elif draft.get("review_status") == "approved":
        draft["approved_by"] = draft.get("approved_by") or req.ca_name
        draft["approved_at"] = draft.get("approved_at") or requested_at

    draft["email_subject"] = req.subject
    draft["email_body"] = req.body
    draft["last_send_attempt_at"] = requested_at
    draft["last_send_idempotency_key"] = idempotency_key
    draft["last_send_fingerprint"] = fingerprint

    try:
        import smtplib
        from email.mime.text import MIMEText
        from email.mime.multipart import MIMEMultipart

        if SMTP_USER and SMTP_PASS:
            msg = MIMEMultipart()
            msg["From"] = f"ComplianceGPT <{SMTP_USER}>"
            msg["To"] = client_email
            msg["Subject"] = req.subject
            msg.attach(MIMEText(req.body, "plain", "utf-8"))

            with smtplib.SMTP("smtp.gmail.com", 587) as server:
                server.starttls()
                server.login(SMTP_USER, SMTP_PASS)
                server.sendmail(SMTP_USER, client_email, msg.as_string())
            email_sent = True
        else:
            # Demo mode — no SMTP configured, just log it
            logger.info(f"[DEMO EMAIL] To: {client_email} | Subject: {req.subject}")
            email_sent = True

    except Exception as e:
        send_error = str(e)
        logger.error(f"Email send failed for {draft_id}: {e}")

    now = datetime.now(timezone.utc).isoformat()
    draft["delivery_status"] = "sent" if email_sent else "failed"
    draft["email_sent"] = email_sent
    draft["email_sent_at"] = now if email_sent else None
    draft["send_error"] = send_error
    draft["last_send_result"] = "sent" if email_sent else "failed"
    draft["last_send_error"] = send_error
    updated = _write_draft(path, draft)

    log_event(
        agent="CA",
        action="draft_sent" if email_sent else "draft_send_failed",
        details={
            "draft_id": draft_id,
            "client_id": draft.get("client_id"),
            "client_name": draft.get("client_name"),
            "client_email": client_email,
            "ca_name": req.ca_name,
            "email_sent": email_sent,
            "send_error": send_error,
            "status": updated.get("status"),
            "review_status": updated.get("review_status"),
            "delivery_status": updated.get("delivery_status"),
            "idempotency_key": idempotency_key,
        }
    )

    if not email_sent:
        raise HTTPException(
            status_code=502,
            detail=f"Email failed: {send_error}"
        )

    return {
        "message": f"Email sent to {client_email}",
        "already_sent": False,
        "draft_id": draft_id,
        "client_email": client_email,
        "sent_at": now,
        "status": updated["status"],
        "review_status": updated["review_status"],
        "delivery_status": updated["delivery_status"],
    }


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
    
    # Load draft and mark as approved + sent
    draft = _normalize_draft_state(json.loads(draft_path.read_text(encoding="utf-8")))
    now = datetime.now(timezone.utc).isoformat()
    draft["review_status"] = "approved"
    draft["delivery_status"] = "sent"
    draft["approved_by"] = ca_name
    draft["approved_at"] = now
    draft["reviewed_by"] = ca_name
    draft["reviewed_at"] = now
    draft["email_sent"] = True
    draft["email_sent_at"] = now
    draft["send_error"] = None

    # Save updated draft
    updated = _write_draft(draft_path, draft)
    
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
            "draft_id": draft_id,
            "status": updated.get("status"),
            "review_status": updated.get("review_status"),
            "delivery_status": updated.get("delivery_status"),
        }
    )
    
    return {
        "message": f"Deadline alert email sent to {alert['client_email']}",
        "client_name": alert["client_name"],
        "obligation": alert["obligation_type"],
        "deadline_level": alert["level"],
        "draft_id": draft_id,
        "email_to": alert["client_email"],
        "sent_at": updated["email_sent_at"],
        "status": updated["status"],
        "review_status": updated["review_status"],
        "delivery_status": updated["delivery_status"],
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

@app.post("/documents/upload")
async def upload_document(
    file: UploadFile = File(...),
    regulator: str = Form(...),
    title: str = Form(...),
    uploaded_by: str = Form("CA"),
):
    """
    Upload a PDF/TXT document, ingest it into ChromaDB, and return extraction preview.
    This does NOT trigger matching/drafting automatically.
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="File name is required")

    regulator = regulator.strip()
    if regulator not in SUPPORTED_REGULATORS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported regulator. Allowed: {', '.join(sorted(SUPPORTED_REGULATORS))}",
        )

    title = title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="Title is required")

    suffix = Path(file.filename).suffix.lower()
    if suffix not in SUPPORTED_UPLOAD_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Only PDF and TXT files are accepted")

    safe_original = _slugify_filename(Path(file.filename).stem)
    document_id = f"DOC_{uuid4().hex[:12].upper()}"
    stored_filename = f"{document_id}_{safe_original}{suffix}"
    destination = PDF_DIR / stored_filename
    PDF_DIR.mkdir(parents=True, exist_ok=True)

    file_bytes = await file.read()
    destination.write_bytes(file_bytes)

    ingest_result = ingest_pdf(
        str(destination),
        force=True,
        regulator_override=regulator,
        title_override=title,
    )
    # Invalidate the retriever's collection singleton so the next query_rag()
    # call opens a fresh ChromaDB connection and sees the newly uploaded chunks.
    # This is the fix for the "sometimes right, sometimes wrong" inconsistency —
    # the old lru_cache held a stale connection that missed chunks written by
    # ingest_pdf's own client instance.
    invalidate_collection_cache()

    preview = (ingest_result or {}).get("first_chunk_preview", "")
    summary = _summary_from_preview(preview)
    priority = _infer_priority_from_title(title)
    uploaded_at = _now()
    uploaded_record = {
        "document_id": document_id,
        "title": title,
        "regulator": regulator,
        "priority": priority,
        "summary": summary,
        "source": "manual_upload",
        "stored_filename": stored_filename,
        "original_filename": file.filename,
        "uploaded_by": uploaded_by.strip() or "CA",
        "uploaded_at": uploaded_at,
        "ingest": {
            "pages": (ingest_result or {}).get("pages", 0),
            "chunks": (ingest_result or {}).get("chunks", 0),
            "used_ocr": bool((ingest_result or {}).get("used_ocr", False)),
            "first_chunk_preview": preview,
            "status": (ingest_result or {}).get("status", "unknown"),
        },
    }

    uploaded_docs = _load_uploaded_documents()
    uploaded_docs[document_id] = uploaded_record
    _save_uploaded_documents(uploaded_docs)

    log_event(
        agent="UploadAgent",
        action="document_uploaded",
        details={
            "document_id": document_id,
            "uploaded_by": uploaded_record["uploaded_by"],
            "filename": file.filename,
            "stored_filename": stored_filename,
            "regulator": regulator,
            "title": title,
            "chunks": uploaded_record["ingest"]["chunks"],
        },
        citation=stored_filename,
    )

    return {
        "message": f"{file.filename} ingested successfully",
        "document": uploaded_record,
    }


@app.post("/documents/{document_id}/run-pipeline")
def run_uploaded_document_pipeline(
    document_id: str,
    background_tasks: BackgroundTasks,
    req: Optional[DocumentPipelineRequest] = None,
):
    """
    Trigger matcher + drafter + deadline scan for one already-ingested uploaded document.
    """
    uploaded_docs = _load_uploaded_documents()
    uploaded = uploaded_docs.get(document_id)
    if not uploaded:
        raise HTTPException(status_code=404, detail=f"Uploaded document not found: {document_id}")

    ca_name = (req.ca_name if req else "CA").strip() or "CA"
    background_tasks.add_task(
        _execute_uploaded_document_pipeline,
        document_id=document_id,
        ca_name=ca_name,
    )
    return {
        "message": "Uploaded document pipeline started",
        "document_id": document_id,
        "title": uploaded["title"],
        "regulator": uploaded["regulator"],
        "triggered_by": ca_name,
    }


@app.post("/ingest")
def ingest(file: UploadFile = File(...)):
    """Legacy ingest endpoint (supports PDF and TXT)."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="File name is required")
    suffix = Path(file.filename).suffix.lower()
    if suffix not in SUPPORTED_UPLOAD_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Only PDF and TXT files accepted")
    dest = PDF_DIR / file.filename
    PDF_DIR.mkdir(parents=True, exist_ok=True)
    with open(dest, "wb") as f:
        shutil.copyfileobj(file.file, f)
    result = ingest_pdf(str(dest))
    invalidate_collection_cache()
    return {"message": f"{file.filename} ingested successfully", "ingest": result}


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
