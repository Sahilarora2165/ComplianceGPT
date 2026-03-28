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


METRICS_FILE = Path("data/metrics_snapshot.json")


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
    drafts_dir = Path("data/drafts")
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
    alerts_dir = Path("data/deadline_alerts")
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
    alerts_dir = Path("data/deadline_alerts")
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
    status_file = Path("data/latest_pipeline_status.json")
    if not status_file.exists():
        return 0
    
    try:
        status = json.loads(status_file.read_text())
        return status.get("total_circulars", 0)
    except:
        return 0


def _count_matches():
    """Count total matches from pipeline status file."""
    status_file = Path("data/latest_pipeline_status.json")
    if not status_file.exists():
        return 0
    
    try:
        status = json.loads(status_file.read_text())
        return status.get("total_matches", 0)
    except:
        return 0


def _count_total_drafts():
    """Count total drafts from drafts directory."""
    drafts_dir = Path("data/drafts")
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
