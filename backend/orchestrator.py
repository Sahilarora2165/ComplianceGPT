"""
orchestrator.py — ComplianceGPT Pipeline Orchestrator
──────────────────────────────────────────────────────
Runs the full agent pipeline in sequence:
  1. MonitoringAgent  → detect new circulars
  2. ClientMatcher    → match circulars to clients
  3. DrafterAgent     → generate advisory drafts
  4. DeadlineWatch    → scan for upcoming client deadlines

Can be run:
  - Once manually:   python orchestrator.py --run-now
  - On a schedule:   python orchestrator.py --schedule   (every 6 hours)
  - Simulate mode:   python orchestrator.py --run-now --simulate
"""

import sys
import argparse
from pathlib import Path
from datetime import datetime, timezone

# ── Path setup ────────────────────────────────────────────────────────────────
_BACKEND_DIR = Path(__file__).resolve().parent
sys.path.append(str(_BACKEND_DIR))

from core.audit import log_event

# ── Pipeline ──────────────────────────────────────────────────────────────────

def run_pipeline(simulate_mode: bool = False) -> dict:
    """
    Run the full agent pipeline in sequence.
    Returns a summary dict.
    """
    started_at = datetime.now(timezone.utc).isoformat()

    print("\n" + "=" * 60)
    print("  ComplianceGPT — Full Pipeline Run")
    print(f"  Mode    : {'SIMULATE' if simulate_mode else 'REAL SCRAPE'}")
    print(f"  Started : {started_at}")
    print("=" * 60)

    summary = {
        "started_at":    started_at,
        "simulate_mode": simulate_mode,
        "new_docs":      0,
        "matches":       0,
        "drafts":        0,
        "deadline_alerts": 0,
        "errors":        [],
    }

    # ── Step 1: Monitoring Agent ───────────────────────────────────────────
    print("\n[1/3] 🔍 Running Monitoring Agent ...")
    try:
        from agents.monitoring_agent import run_monitoring_agent
        new_docs = run_monitoring_agent(
            simulate_mode=simulate_mode,
            auto_ingest=True
        )
        summary["new_docs"] = len(new_docs)
        print(f"  ✅ Monitoring complete — {len(new_docs)} new document(s)")
    except Exception as e:
        msg = f"MonitoringAgent failed: {e}"
        print(f"  ❌ {msg}")
        summary["errors"].append(msg)
        new_docs = []

    if not new_docs:
        print("\n  ℹ️  No new documents — skipping matcher and drafter.")
        _log_pipeline(summary)
        return summary

    # ── Step 2: Client Matcher ─────────────────────────────────────────────
    print("\n[2/3] 🎯 Running Client Matcher ...")
    try:
        from agents.client_matcher import match_clients
        match_results = match_clients(new_docs)
        total_matches = sum(r["match_count"] for r in match_results)
        summary["matches"] = total_matches
        print(f"  ✅ Matching complete — {total_matches} client-circular pair(s)")

        # Print summary table
        for r in match_results:
            if r["match_count"] > 0:
                clients = ", ".join(c["name"] for c in r["affected_clients"])
                print(f"     [{r['priority']}] {r['regulator']} → {clients}")

    except Exception as e:
        msg = f"ClientMatcher failed: {e}"
        print(f"  ❌ {msg}")
        summary["errors"].append(msg)
        match_results = []

    # Filter to only circulars that matched at least one client
    actionable = [r for r in match_results if r["match_count"] > 0]

    if not actionable:
        print("\n  ℹ️  No clients matched — skipping drafter.")
        _log_pipeline(summary)
        return summary

    # Filter: Skip LOW priority circulars to save tokens for HIGH/MEDIUM
    # LOW priority = indirect matches, general awareness, no immediate action
    # This saves ~70% of tokens for drafts that actually matter
    low_priority_count = sum(1 for r in actionable if r["priority"] == "LOW")
    actionable = [r for r in actionable if r["priority"] != "LOW"]
    if low_priority_count > 0:
        print(f"  ℹ️  Skipped {low_priority_count} LOW priority circular(s) — saving tokens for HIGH/MEDIUM")

    # Cap drafts per run to avoid LLM rate limits — HIGH priority first
    MAX_DRAFTS_PER_RUN = 20
    _priority_order = {"HIGH": 0, "MEDIUM": 1, "LOW": 2}
    actionable.sort(key=lambda r: _priority_order.get(r["priority"], 3))
    trimmed, total = [], 0
    for r in actionable:
        if total >= MAX_DRAFTS_PER_RUN:
            break
        trimmed.append(r)
        total += r["match_count"]
    if len(trimmed) < len(actionable):
        print(f"  ⚠️  Capped at {MAX_DRAFTS_PER_RUN} drafts — {len(actionable) - len(trimmed)} lower-priority item(s) skipped")
    actionable = trimmed

    # ── Step 3: Drafter Agent ──────────────────────────────────────────────
    print("\n[3/3] ✍️  Running Drafter Agent ...")
    drafts = []
    try:
        from agents.drafter_agent import draft_advisories
        drafts = draft_advisories(actionable)
    except Exception as e:
        msg = f"DrafterAgent failed: {e}"
        print(f"  ❌ {msg}")
        summary["errors"].append(msg)
    finally:
        summary["drafts"] = len(drafts)
        print(f"  ✅ Drafting complete — {len(drafts)} draft(s) generated")

        # Print draft summary
        for d in drafts:
            icon = {"HIGH": "🔴", "MEDIUM": "🟡", "LOW": "⚪"}.get(d["risk_level"], "⚪")
            print(f"     {icon} [{d['risk_level']}] {d['client_name']} × {d['regulator']} | Deadline: {d['deadline']}")
            for i, action in enumerate(d["actions"], 1):
                print(f"          {i}. {action}")

    # ── Step 4: Deadline Watch Agent ───────────────────────────────────────
    print("\n[4/4] ⚠️  Running Deadline Watch Agent ...")
    deadline_alerts = []
    deadline_drafts = []
    try:
        from agents.deadline_agent import scan_deadlines, deadline_summary, generate_deadline_drafts
        deadline_alerts = scan_deadlines()
        summary["deadline_alerts"] = len(deadline_alerts)
        
        d_summary = deadline_summary(deadline_alerts)
        print(f"  ✅ Deadline scan complete — {d_summary['total_alerts']} alert(s)")
        print(f"     MISSED: {d_summary['missed']} | CRITICAL: {d_summary['critical']} | WARNING: {d_summary['warning']}")
        if d_summary['total_exposure'] > 0:
            print(f"     Total exposure: ₹{d_summary['total_exposure']:,.0f}")
        
        # Auto-generate drafts for CRITICAL and MISSED deadlines
        critical_alerts = [a for a in deadline_alerts if a["level"] in ("MISSED", "CRITICAL")]
        if critical_alerts:
            print(f"  ⚠️  {len(critical_alerts)} URGENT deadline(s) — auto-generating drafts...")
            deadline_drafts = generate_deadline_drafts(deadline_alerts)
            print(f"     ✅ {len(deadline_drafts)} draft(s) generated for urgent deadlines")
        else:
            print(f"  ℹ️  No urgent deadlines — no auto-drafts needed")
        
        # Print critical alerts
        if critical_alerts:
            print(f"  ⚠️  {len(critical_alerts)} URGENT deadline(s) require attention:")
            for alert in critical_alerts:
                icon = "💀" if alert["level"] == "MISSED" else "🔴"
                print(f"     {icon} [{alert['level']}] {alert['client_name']} — {alert['obligation_type']} ({alert['due_date']})")
    except Exception as e:
        msg = f"DeadlineWatchAgent failed: {e}"
        print(f"  ❌ {msg}")
        summary["errors"].append(msg)

    # ── Final summary ──────────────────────────────────────────────────────
    summary["finished_at"] = datetime.now(timezone.utc).isoformat()
    _log_pipeline(summary)

    print("\n" + "=" * 60)
    print("  Pipeline Complete")
    print(f"  New docs       : {summary['new_docs']}")
    print(f"  Matches        : {summary['matches']}")
    print(f"  Drafts         : {summary['drafts']}")
    print(f"  Deadline Alerts: {summary['deadline_alerts']}")
    if summary["errors"]:
        print(f"  Errors         : {len(summary['errors'])}")
        for e in summary["errors"]:
            print(f"    - {e}")
    print("=" * 60 + "\n")

    return summary


def _log_pipeline(summary: dict) -> None:
    try:
        log_event(
            agent="Orchestrator",
            action="pipeline_complete",
            details=summary
        )
    except Exception:
        pass


# ── Scheduler ─────────────────────────────────────────────────────────────────

def start_scheduler(simulate_mode: bool = False, interval_hours: int = 6) -> None:
    """
    Run the pipeline on a schedule using APScheduler.
    Runs immediately on start, then every `interval_hours` hours.
    """
    try:
        from apscheduler.schedulers.blocking import BlockingScheduler
    except ImportError:
        print("APScheduler not installed — pip install apscheduler")
        sys.exit(1)

    scheduler = BlockingScheduler(timezone="UTC")

    print(f"\n  ⏰ Scheduler started — pipeline runs every {interval_hours} hour(s)")
    print(f"  Mode: {'SIMULATE' if simulate_mode else 'REAL SCRAPE'}")
    print(f"  Press Ctrl+C to stop\n")

    # Run immediately on start
    run_pipeline(simulate_mode=simulate_mode)

    # Then on schedule
    scheduler.add_job(
        func=run_pipeline,
        trigger="interval",
        hours=interval_hours,
        kwargs={"simulate_mode": simulate_mode},
        id="compliance_pipeline",
        name="ComplianceGPT Full Pipeline",
        misfire_grace_time=300,    # 5 min grace if job missed
        coalesce=True,             # don't pile up missed runs
    )

    try:
        scheduler.start()
    except (KeyboardInterrupt, SystemExit):
        print("\n  Scheduler stopped.")


# ── CLI ───────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="ComplianceGPT Pipeline Orchestrator")
    parser.add_argument(
        "--run-now", action="store_true",
        help="Run the pipeline once immediately"
    )
    parser.add_argument(
        "--schedule", action="store_true",
        help="Run on schedule (every 6 hours)"
    )
    parser.add_argument(
        "--simulate", action="store_true",
        help="Use simulated documents instead of real scraping"
    )
    parser.add_argument(
        "--interval", type=int, default=6,
        help="Schedule interval in hours (default: 6)"
    )
    args = parser.parse_args()

    if args.run_now:
        run_pipeline(simulate_mode=args.simulate)
    elif args.schedule:
        start_scheduler(simulate_mode=args.simulate, interval_hours=args.interval)
    else:
        # Default: run once
        run_pipeline(simulate_mode=args.simulate)