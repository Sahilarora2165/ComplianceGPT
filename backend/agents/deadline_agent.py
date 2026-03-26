"""
deadline_agent.py — ComplianceGPT Deadline Watch Agent
────────────────────────────────────────────────────────
Scans all clients for upcoming compliance deadlines and:
  - CRITICAL  : deadline <= 2 days  → escalation alert with full penalty details
  - WARNING   : deadline <= 7 days  → reminder alert
  - MISSED    : deadline < today    → late filing advisory

Run standalone : python agents/deadline_agent.py
Called by      : orchestrator.py, app.py (scheduler + API endpoint)

Returns list of DeadlineAlert dicts — also persisted to
  backend/data/deadline_alerts/YYYY-MM-DD.json
"""

import json
import sys
from datetime import datetime, timezone, date
from pathlib import Path
from typing import Optional

# ── Path setup ────────────────────────────────────────────────────────────────
_BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.append(str(_BACKEND_DIR))

from core.audit import log_event

# ── Constants ─────────────────────────────────────────────────────────────────
CLIENTS_PATH    = _BACKEND_DIR / "clients.json"
ALERTS_DIR      = _BACKEND_DIR / "data" / "deadline_alerts"
ALERTS_DIR.mkdir(parents=True, exist_ok=True)

CRITICAL_DAYS   = 3    # RED  — escalation
WARNING_DAYS    = 14   # YELLOW — reminder (covers 2-week window)
PENALTY_MAP = {
    # Maps obligation type keywords → estimated penalty for display
    "GSTR":             "₹50/day late fee + 18% interest on tax due",
    "Advance Tax":      "1% per month interest under Section 234B/234C",
    "ITR":              "₹1,000–₹5,000 late filing fee + interest",
    "TDS":              "₹200/day under Section 234E + 1.5% per month interest",
    "SOFTEX":           "RBI penalty + possible export proceeds blockage",
    "Export Realisation":"FEMA violation — penalty up to 3x transaction value",
    "RBI Monthly":      "RBI compliance action — possible NBFC license risk",
    "Transfer Pricing": "₹1L minimum penalty + 2% of transaction value",
    "SEBI":             "SEBI enforcement action — possible trading license suspension",
    "LUT":              "18% GST on all exports if LUT lapses",
}


# ── Core ──────────────────────────────────────────────────────────────────────

def _infer_penalty(obligation_type: str, stated_penalty: str) -> str:
    """Use stated penalty if rich, else look up from PENALTY_MAP."""
    if stated_penalty and len(stated_penalty) > 5 and stated_penalty.lower() not in ("n/a", "tbd", ""):
        return stated_penalty
    for keyword, penalty in PENALTY_MAP.items():
        if keyword.lower() in obligation_type.lower():
            return penalty
    return stated_penalty or "Regulatory penalty — consult circular"


def _days_until(due_date_str: str) -> Optional[int]:
    """Returns days until due date. Negative = overdue. None if unparseable."""
    try:
        due = date.fromisoformat(due_date_str)
        today = date.today()
        return (due - today).days
    except Exception:
        return None


def _alert_level(days: int) -> str:
    if days < 0:
        return "MISSED"
    elif days <= CRITICAL_DAYS:
        return "CRITICAL"
    elif days <= WARNING_DAYS:
        return "WARNING"
    else:
        return "OK"


def _financial_exposure(client: dict, obligation: dict, days: int) -> dict:
    """
    Compute estimated rupee at risk for this obligation.
    Matches against both penalty string AND obligation type for robustness.
    """
    penalty_str     = (obligation.get("penalty_if_missed", "") or "").lower()
    obligation_type = (obligation.get("type", "") or "").lower()

    # Combine both fields — covers all clients.json format variations
    combined = penalty_str + " " + obligation_type
    overdue_days = max(0, -days) + 30  # 30-day exposure window

    exposure = 0
    if "50/day" in combined:
        exposure = 50 * overdue_days
    elif "200/day" in combined:
        exposure = 200 * overdue_days
    elif "fema" in combined or "export realisation" in combined or "violation" in combined:
        exposure = 500000   # FEMA — up to 3x transaction value
    elif "rbi" in combined and ("penalty" in combined or "action" in combined or "blockage" in combined):
        exposure = 300000   # RBI regulatory action estimate
    elif "softex" in combined:
        exposure = 200000   # RBI penalty + export blockage
    elif "transfer pricing" in combined or "tp report" in combined:
        exposure = 100000   # minimum ₹1L under Income Tax Act
    elif "sebi" in combined or "license risk" in combined:
        exposure = 500000   # SEBI enforcement / license suspension
    elif "license" in combined or "blockage" in combined or "suspension" in combined:
        exposure = 1000000  # business continuity risk
    elif "1l" in combined or "1 lakh" in combined:
        exposure = 100000
    elif "5,000" in combined or "5000" in combined:
        exposure = 5000
    elif "1,000" in combined or "1000" in combined:
        exposure = 1000

    # Risk level multiplier (HIGH obligations hurt more)
    risk = obligation.get("risk_level", "LOW")
    multiplier = {"HIGH": 3, "MEDIUM": 2, "LOW": 1}.get(risk, 1)
    exposure = exposure * multiplier

    if exposure == 0:
        label = "Regulatory risk — financial exposure unquantified"
    elif exposure >= 100000:
        label = f"₹{exposure:,.0f}+ at risk"
    else:
        label = f"~₹{exposure:,.0f} at risk"

    return {"exposure_rupees": exposure, "exposure_label": label}


def scan_deadlines(clients: Optional[list] = None) -> list[dict]:
    """
    Main function. Scans all clients for deadline breaches.
    Returns list of alert dicts, sorted by urgency.

    Args:
        clients: Optional pre-loaded client list. Reads from clients.json if None.
    """
    if clients is None:
        if not CLIENTS_PATH.exists():
            raise FileNotFoundError(f"clients.json not found at {CLIENTS_PATH}")
        clients = json.loads(CLIENTS_PATH.read_text(encoding="utf-8"))

    alerts = []
    today_str = date.today().isoformat()

    for client in clients:
        client_id   = client.get("id", "UNKNOWN")
        client_name = client.get("name", "Unknown Client")
        contact     = client.get("contact", {})
        risk_profile = client.get("risk_profile", {})

        for obligation in client.get("active_obligations", []):
            # Skip already completed obligations
            if obligation.get("status", "").upper() in ("COMPLETED", "FILED", "DONE"):
                continue

            due_date_str = obligation.get("due_date", "")
            days = _days_until(due_date_str)
            if days is None:
                continue  # unparseable date — skip

            level = _alert_level(days)
            if level == "OK":
                continue  # no alert needed

            penalty   = _infer_penalty(
                obligation.get("type", ""),
                obligation.get("penalty_if_missed", "")
            )
            exposure  = _financial_exposure(client, obligation, days)

            # Build alert message
            if level == "MISSED":
                headline = f"MISSED DEADLINE — {obligation['type']} was due {due_date_str} ({abs(days)} days ago)"
                action   = f"File immediately. Initiate late filing / condonation procedure. {penalty}"
            elif level == "CRITICAL":
                headline = f"URGENT — {obligation['type']} due in {days} day(s) ({due_date_str})"
                action   = f"File TODAY. {penalty}"
            else:
                headline = f"REMINDER — {obligation['type']} due in {days} day(s) ({due_date_str})"
                action   = f"Prepare and file before {due_date_str}. {penalty}"

            alert = {
                "alert_id":          f"DLA_{client_id}_{obligation['id']}_{today_str}",
                "generated_at":      datetime.now(timezone.utc).isoformat(),
                "level":             level,               # MISSED | CRITICAL | WARNING
                "days_until_due":    days,
                "client_id":         client_id,
                "client_name":       client_name,
                "client_email":      contact.get("email", ""),
                "client_contact":    contact.get("name", ""),
                "obligation_id":     obligation.get("id", ""),
                "obligation_type":   obligation.get("type", ""),
                "due_date":          due_date_str,
                "risk_level":        obligation.get("risk_level", "LOW"),
                "compliance_score":  risk_profile.get("compliance_score", 100),
                "recent_misses":     risk_profile.get("recent_misses", 0),
                "penalty":           penalty,
                "exposure":          exposure,
                "headline":          headline,
                "recommended_action": action,
                "tags":              client.get("tags", []),

                # Email draft for CA to send to client
                "advisory_email": {
                    "subject": f"[{level}] Compliance Deadline — {obligation.get('type','')} due {due_date_str}",
                    "body": (
                        f"Dear {contact.get('name', 'Sir/Madam')},\n\n"
                        f"This is an urgent compliance reminder from your CA firm.\n\n"
                        f"{'⚠️ MISSED DEADLINE' if level == 'MISSED' else ('🔴 CRITICAL' if level == 'CRITICAL' else '🟡 REMINDER')}: "
                        f"{obligation.get('type', '')} {'was due' if level == 'MISSED' else 'is due'} on {due_date_str}.\n\n"
                        f"Financial exposure: {exposure['exposure_label']}\n"
                        f"Penalty if not addressed: {penalty}\n\n"
                        f"Required action: {action}\n\n"
                        f"Please contact us immediately to proceed.\n\n"
                        f"Regards,\nYour CA Firm\n[ComplianceGPT Automated Alert]"
                    )
                }
            }
            alerts.append(alert)

    # Sort: MISSED first → CRITICAL → WARNING, then by days ascending
    level_order = {"MISSED": 0, "CRITICAL": 1, "WARNING": 2}
    alerts.sort(key=lambda a: (level_order.get(a["level"], 9), a["days_until_due"]))

    # Persist to file
    _persist_alerts(alerts, today_str)

    # Audit log
    try:
        log_event(
            agent="DeadlineWatchAgent",
            action="scan_complete",
            details={
                "date":     today_str,
                "total":    len(alerts),
                "missed":   sum(1 for a in alerts if a["level"] == "MISSED"),
                "critical": sum(1 for a in alerts if a["level"] == "CRITICAL"),
                "warning":  sum(1 for a in alerts if a["level"] == "WARNING"),
            }
        )
    except Exception:
        pass

    return alerts


def _persist_alerts(alerts: list, date_str: str) -> None:
    """Save alerts to backend/data/deadline_alerts/YYYY-MM-DD.json"""
    try:
        path = ALERTS_DIR / f"{date_str}.json"
        path.write_text(
            json.dumps({"date": date_str, "alerts": alerts}, indent=2, ensure_ascii=False),
            encoding="utf-8"
        )
    except Exception as e:
        print(f"[DeadlineAgent] Warning: Could not persist alerts — {e}")


def get_latest_alerts() -> list[dict]:
    """
    Read the most recent persisted alert file.
    Falls back to live scan if no file exists.
    """
    files = sorted(ALERTS_DIR.glob("*.json"), reverse=True)
    if files:
        try:
            data = json.loads(files[0].read_text(encoding="utf-8"))
            return data.get("alerts", [])
        except Exception:
            pass
    return scan_deadlines()


# ── Summary helper (used by orchestrator) ─────────────────────────────────────

def deadline_summary(alerts: list[dict]) -> dict:
    """Returns a compact summary dict for pipeline reporting."""
    return {
        "total_alerts":   len(alerts),
        "missed":         sum(1 for a in alerts if a["level"] == "MISSED"),
        "critical":       sum(1 for a in alerts if a["level"] == "CRITICAL"),
        "warning":        sum(1 for a in alerts if a["level"] == "WARNING"),
        "total_exposure": sum(a["exposure"]["exposure_rupees"] for a in alerts),
        "highest_risk_clients": [
            {"client": a["client_name"], "obligation": a["obligation_type"],
             "due": a["due_date"], "exposure": a["exposure"]["exposure_label"]}
            for a in alerts if a["level"] in ("MISSED", "CRITICAL")
        ]
    }


# ── CLI standalone run ────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("\n" + "=" * 60)
    print("  ComplianceGPT — Deadline Watch Agent")
    print(f"  Scanning as of: {date.today().isoformat()}")
    print("=" * 60)

    alerts = scan_deadlines()
    summary = deadline_summary(alerts)

    print(f"\n  Total alerts  : {summary['total_alerts']}")
    print(f"  MISSED        : {summary['missed']}")
    print(f"  CRITICAL      : {summary['critical']}")
    print(f"  WARNING       : {summary['warning']}")
    print(f"  Total exposure: ₹{summary['total_exposure']:,.0f}")

    print("\n  Alerts:")
    for a in alerts:
        icon = {"MISSED": "💀", "CRITICAL": "🔴", "WARNING": "🟡"}.get(a["level"], "⚪")
        print(f"\n  {icon} [{a['level']}] {a['client_name']}")
        print(f"     Obligation : {a['obligation_type']}")
        print(f"     Due        : {a['due_date']} ({a['days_until_due']} days)")
        print(f"     Exposure   : {a['exposure']['exposure_label']}")
        print(f"     Action     : {a['recommended_action']}")

    print("\n" + "=" * 60)