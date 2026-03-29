"""
Metrics Store - JSON file based metrics persistence.

This module provides simple functions to read/write metrics from a JSON file.
Metrics are automatically seeded with demo data on first run and updated
whenever the pipeline completes.

File: backend/data/metrics_snapshot.json
"""

import json
import os
from datetime import datetime
from pathlib import Path

_BACKEND_DIR = Path(__file__).resolve().parent

METRICS_FILE = _BACKEND_DIR / "data" / "metrics_snapshot.json"


def _get_empty_metrics():
    """Return empty metrics structure."""
    return {
        "timestamp": None,
        "total_circulars": 0,
        "total_matches": 0,
        "total_drafts": 0,
        "pending_drafts": 0,
        "deadline_alerts": 0,
        "total_exposure": 0,
        "last_run": None,
        "run_mode": None,
        "message": "No metrics available. Run the pipeline to generate data."
    }


def _get_demo_metrics():
    """Return seeded demo metrics for initial dashboard load."""
    now = datetime.utcnow().isoformat() + "Z"
    return {
        "timestamp": now,
        "total_circulars": 5,
        "total_matches": 12,
        "total_drafts": 8,
        "pending_drafts": 8,
        "deadline_alerts": 3,
        "total_exposure": 15000,
        "last_run": now,
        "run_mode": "demo",
        "message": "Demo data loaded. Run real pipeline to fetch live circulars."
    }


def _count_pending_drafts():
    """Count drafts with pending review status."""
    drafts_dir = _BACKEND_DIR / "data" / "drafts"
    if not drafts_dir.exists():
        return 0
    
    count = 0
    for draft_file in drafts_dir.glob("*.json"):
        try:
            draft = json.loads(draft_file.read_text())
            status = draft.get("review_status", "").lower()
            if status == "pending":
                count += 1
        except:
            pass
    return count


def _count_deadline_alerts():
    """Count total deadline alerts across all date files."""
    alerts_dir = _BACKEND_DIR / "data" / "deadline_alerts"
    if not alerts_dir.exists():
        return 0
    
    count = 0
    for alert_file in alerts_dir.glob("*.json"):
        try:
            alerts = json.loads(alert_file.read_text())
            if isinstance(alerts, list):
                count += len(alerts)
        except:
            pass
    return count


def _calculate_total_exposure():
    """Calculate total financial exposure from deadline alerts."""
    alerts_dir = _BACKEND_DIR / "data" / "deadline_alerts"
    if not alerts_dir.exists():
        return 0
    
    total = 0
    for alert_file in alerts_dir.glob("*.json"):
        try:
            alerts = json.loads(alert_file.read_text())
            if isinstance(alerts, list):
                for alert in alerts:
                    exposure = alert.get("exposure", {}).get("exposure_rupees", 0)
                    if isinstance(exposure, (int, float)):
                        total += exposure
        except:
            pass
    return total


def _count_circulars():
    """Count circulars from pipeline status file."""
    status_file = _BACKEND_DIR / "data" / "latest_pipeline_status.json"
    if not status_file.exists():
        return 0
    
    try:
        status = json.loads(status_file.read_text())
        return status.get("total_circulars", 0)
    except:
        return 0


def _count_matches():
    """Count total matches from pipeline status file."""
    status_file = _BACKEND_DIR / "data" / "latest_pipeline_status.json"
    if not status_file.exists():
        return 0
    
    try:
        status = json.loads(status_file.read_text())
        return status.get("total_matches", 0)
    except:
        return 0


def _count_total_drafts():
    """Count total drafts from drafts directory."""
    drafts_dir = _BACKEND_DIR / "data" / "drafts"
    if not drafts_dir.exists():
        return 0
    
    return len(list(drafts_dir.glob("*.json")))


def get_metrics():
    """
    Get current metrics from JSON file.
    
    If file doesn't exist, seed with demo data and return it.
    This ensures dashboard always has data to display.
    """
    if not METRICS_FILE.exists():
        # First run - seed with demo data
        demo_data = _get_demo_metrics()
        save_metrics(demo_data)
        print("📊 Seeded demo metrics for initial dashboard load")
        return demo_data
    
    try:
        data = json.loads(METRICS_FILE.read_text())
        return data
    except:
        # File corrupted - reseed with demo data
        demo_data = _get_demo_metrics()
        save_metrics(demo_data)
        print("⚠️ Metrics file corrupted, reseeded with demo data")
        return demo_data


def save_metrics(metrics):
    """Save metrics to JSON file."""
    METRICS_FILE.parent.mkdir(exist_ok=True)
    METRICS_FILE.write_text(json.dumps(metrics, indent=2))


def update_metrics(pipeline_result=None):
    """
    Update metrics after pipeline completion.
    
    This recomputes all metrics from actual files to ensure accuracy.
    Call this after pipeline/run completes.
    
    Args:
        pipeline_result: Optional dict from pipeline execution with keys:
            - total_circulars
            - total_matches
            - total_drafts
            - run_mode
    """
    # Compute current state from files
    now = datetime.utcnow().isoformat() + "Z"
    
    metrics = {
        "timestamp": now,
        "total_circulars": _count_circulars(),
        "total_matches": _count_matches(),
        "total_drafts": _count_total_drafts(),
        "pending_drafts": _count_pending_drafts(),
        "deadline_alerts": _count_deadline_alerts(),
        "total_exposure": _calculate_total_exposure(),
        "last_run": now,
        "run_mode": pipeline_result.get("run_mode", "manual") if pipeline_result else "manual",
        "message": None  # Clear any demo message
    }
    
    # Override with pipeline result if provided
    if pipeline_result:
        if "total_circulars" in pipeline_result:
            metrics["total_circulars"] = pipeline_result["total_circulars"]
        if "total_matches" in pipeline_result:
            metrics["total_matches"] = pipeline_result["total_matches"]
        if "total_drafts" in pipeline_result:
            metrics["total_drafts"] = pipeline_result["total_drafts"]
    
    save_metrics(metrics)
    print(f"📊 Metrics updated: {metrics['total_circulars']} circulars, "
          f"{metrics['total_matches']} matches, {metrics['total_drafts']} drafts")
    
    return metrics


def reset_metrics():
    """
    Reset metrics to empty state.

    Call this when user resets the pipeline.
    """
    if METRICS_FILE.exists():
        METRICS_FILE.unlink()
    print("🗑️ Metrics reset - will reseed on next fetch")


def get_guardrail_metrics():
    """
    Aggregate guardrail metrics from audit log and draft files.

    Returns counts for abstentions (by reason), query answers,
    draft confidence breakdown, citation stats, and recent guardrail events.
    """
    from core.audit import read_audit_log

    events = read_audit_log()  # newest-first

    # --- Query-level metrics ---
    total_queries = 0
    total_answered = 0
    total_abstained = 0
    abstain_reasons = {}          # reason -> count
    confidence_scores = []        # list of floats from answered queries
    citation_verified_count = 0   # answered queries with sources

    for ev in events:
        action = ev.get("action", "")
        details = ev.get("details", {})

        if action == "query_answered":
            total_queries += 1
            total_answered += 1
            score = details.get("score") or details.get("confidence")
            if isinstance(score, (int, float)):
                confidence_scores.append(score)
            sources = details.get("sources") or details.get("source_chunks")
            if sources:
                citation_verified_count += 1

        elif action == "query_abstained":
            total_queries += 1
            total_abstained += 1
            reason = details.get("reason", "unknown")
            # Normalize LLM-generated reasons into bucketed labels
            reason_lower = reason.lower()
            if "embedding_model" in reason_lower or "model_unavailable" in reason_lower:
                reason = "model_unavailable"
            elif "no_documents" in reason_lower or "empty" in reason_lower or "collection" in reason_lower:
                reason = "no_documents_ingested"
            elif reason_lower in ("low_relevance", "no_matching_chunks", "reranking_empty"):
                reason = "low_relevance"
            elif "validation" in reason_lower or "answer_validation" in reason_lower:
                reason = "answer_validation_failed"
            elif any(kw in reason_lower for kw in ("no information", "no specific", "no relevant",
                     "no explicit", "not found", "not specified", "no exclusion", "no mention")):
                reason = "insufficient_evidence"
            elif len(reason) > 40:
                reason = "insufficient_evidence"
            abstain_reasons[reason] = abstain_reasons.get(reason, 0) + 1

    abstain_rate = (total_abstained / total_queries * 100) if total_queries > 0 else 0
    avg_confidence = (sum(confidence_scores) / len(confidence_scores)) if confidence_scores else None

    # --- Draft-level metrics ---
    drafts_dir = _BACKEND_DIR / "data" / "drafts"
    total_drafts = 0
    high_confidence_drafts = 0
    low_confidence_drafts = 0
    no_confidence_drafts = 0
    drafts_with_sources = 0
    total_source_chunks = 0

    if drafts_dir.exists():
        for draft_file in drafts_dir.glob("*.json"):
            try:
                draft = json.loads(draft_file.read_text())
                total_drafts += 1

                rag_conf = draft.get("rag_confidence", "unknown")
                if rag_conf == "high":
                    high_confidence_drafts += 1
                elif rag_conf == "low":
                    low_confidence_drafts += 1
                elif rag_conf == "none":
                    no_confidence_drafts += 1
                else:
                    # Older drafts without rag_confidence field — infer from source_chunks
                    chunks = draft.get("source_chunks", [])
                    top_score = max((c.get("score", 0) for c in chunks), default=0)
                    if top_score >= 0.5:
                        high_confidence_drafts += 1
                    elif top_score > 0:
                        low_confidence_drafts += 1
                    else:
                        no_confidence_drafts += 1

                chunks = draft.get("source_chunks", [])
                if chunks:
                    drafts_with_sources += 1
                    total_source_chunks += len(chunks)
            except Exception:
                pass

    # --- Recent guardrail events (last 20) ---
    guardrail_actions = {"query_abstained", "query_answered"}
    recent_events = []
    for ev in events:
        if ev.get("action") in guardrail_actions:
            recent_events.append({
                "timestamp": ev.get("timestamp"),
                "action":    ev.get("action"),
                "question":  ev.get("details", {}).get("question", ""),
                "reason":    ev.get("details", {}).get("reason"),
                "score":     ev.get("details", {}).get("score")
                             or ev.get("details", {}).get("confidence"),
            })
            if len(recent_events) >= 20:
                break

    return {
        "query_metrics": {
            "total_queries":          total_queries,
            "total_answered":         total_answered,
            "total_abstained":        total_abstained,
            "abstain_rate_pct":       round(abstain_rate, 1),
            "avg_confidence":         round(avg_confidence, 3) if avg_confidence is not None else None,
            "citation_verified":      citation_verified_count,
            "abstain_reasons":        abstain_reasons,
        },
        "draft_metrics": {
            "total_drafts":           total_drafts,
            "high_confidence":        high_confidence_drafts,
            "low_confidence":         low_confidence_drafts,
            "no_confidence":          no_confidence_drafts,
            "drafts_with_sources":    drafts_with_sources,
            "avg_sources_per_draft":  round(total_source_chunks / total_drafts, 1) if total_drafts > 0 else 0,
        },
        "recent_guardrail_events":    recent_events,
    }
