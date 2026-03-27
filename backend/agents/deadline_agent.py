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


def _scan_drafts_for_deadlines(clients: list, today: date, today_str: str) -> list[dict]:
    """
    Scan generated drafts for structured deadlines.
    Handles ISO, RELATIVE, PERIODIC formats from deadline_parser.
    
    Returns list of alert dicts for upcoming deadlines.
    """
    from core.deadline_parser import parse_deadline
    
    DRAFTS_DIR = _BACKEND_DIR / "data" / "drafts"
    if not DRAFTS_DIR.exists():
        return []
    
    alerts = []
    clients_map = {c["id"]: c for c in clients}
    
    # Scan all draft files
    for draft_path in DRAFTS_DIR.glob("*.json"):
        try:
            draft = json.loads(draft_path.read_text(encoding="utf-8"))

            # Skip DEADLINE_ drafts — these are auto-generated reminder drafts,
            # not original compliance obligations. They should never be re-processed.
            draft_id = draft.get("draft_id", "")
            if draft_id.startswith("DEADLINE_"):
                continue

            # Skip if no deadline or already completed
            deadline_str = draft.get("deadline")
            if not deadline_str:
                continue

            status = draft.get("status", "pending_review")
            if status in ("approved", "rejected", "sent"):
                continue
            
            # Get client info
            client_id = draft.get("client_id")
            client = clients_map.get(client_id)
            if not client:
                continue
            
            # Parse deadline using the parser
            regulator = draft.get("regulator", "")
            obligation_type = draft.get("circular_title", "")
            parsed_date, deadline_format, explanation = parse_deadline(
                deadline_str, regulator, obligation_type, today
            )
            
            if not parsed_date:
                continue  # null deadline — skip
            
            # Calculate days until due
            days = (parsed_date - today).days
            level = _alert_level(days)
            
            if level == "OK":
                continue  # Too far out — no alert needed
            
            # Build alert
            _p2         = client.get("profile", {})
            client_name = _p2.get("name", client.get("name", "Unknown"))
            contact     = _p2
            risk_profile = client.get("risk", client.get("risk_profile", {}))
            
            penalty = draft.get("penalty_if_missed", "Not specified")
            exposure = _financial_exposure(client, {
                "type": obligation_type,
                "risk_level": draft.get("risk_level", "LOW"),
                "penalty_if_missed": penalty
            }, days)
            
            # Build headline based on format
            if level == "MISSED":
                headline = f"MISSED DEADLINE — {draft['circular_title']} was due {parsed_date.isoformat()} ({abs(days)} days ago)"
                action = f"File immediately. Initiate late filing / condonation procedure. {penalty}"
            elif level == "CRITICAL":
                headline = f"URGENT — {draft['circular_title']} due in {days} day(s) ({parsed_date.isoformat()})"
                action = f"File TODAY. {penalty}"
            else:
                headline = f"REMINDER — {draft['circular_title']} due in {days} day(s) ({parsed_date.isoformat()})"
                action = f"Prepare and file before {parsed_date.isoformat()}. {penalty}"
            
            alert = {
                "alert_id":          f"DRAFT_{client_id}_{draft.get('circular_id', 'UNKNOWN')}_{today_str}",
                "generated_at":      datetime.now(timezone.utc).isoformat(),
                "level":             level,
                "days_until_due":    days,
                "client_id":         client_id,
                "client_name":       client_name,
                "client_email":      contact.get("email", ""),
                "client_contact":    contact.get("name", contact.get("primary_person", "")),
                "obligation_id":     draft.get("draft_id", ""),
                "obligation_type":   draft.get("circular_title", ""),
                "due_date":          parsed_date.isoformat(),
                "risk_level":        draft.get("risk_level", "LOW"),
                "compliance_score":  risk_profile.get("compliance_score", 100),
                "recent_misses":     risk_profile.get("recent_misses", 0),
                "penalty":           penalty,
                "exposure":          exposure,
                "headline":          headline,
                "recommended_action": action,
                "tags":              client.get("tags", []),
                "source":            "draft",
                "draft_id":          draft.get("draft_id"),
                "deadline_format":   deadline_format,
                "deadline_raw":      draft.get("deadline_raw", deadline_str),
                
                # Email draft
                "advisory_email": {
                    "subject": f"[{level}] {draft.get('email_subject', 'Compliance Deadline')}",
                    "body": draft.get("email_body", "")
                }
            }
            alerts.append(alert)
            
        except Exception as e:
            # Skip malformed drafts
            continue
    
    return alerts


def scan_deadlines(clients: Optional[list] = None) -> list[dict]:
    """
    Main function. Scans all clients for deadline breaches.
    Returns list of alert dicts, sorted by urgency.
    
    Scans two sources:
    1. Client active_obligations from clients.json (hardcoded deadlines)
    2. Generated drafts with structured deadlines (from Drafter Agent)

    Args:
        clients: Optional pre-loaded client list. Reads from clients.json if None.
    """
    if clients is None:
        if not CLIENTS_PATH.exists():
            raise FileNotFoundError(f"clients.json not found at {CLIENTS_PATH}")
        clients = json.loads(CLIENTS_PATH.read_text(encoding="utf-8"))

    alerts = []
    today_str = date.today().isoformat()
    today = date.today()

    # ── Source 1: Client active_obligations ────────────────────────────────
    for client in clients:
        client_id    = client.get("id", "UNKNOWN")
        _prof        = client.get("profile", {})
        client_name  = _prof.get("name", client.get("name", "Unknown Client"))
        contact      = _prof  # profile holds email, name in new schema
        risk_profile = client.get("risk", client.get("risk_profile", {}))

        # Support both new schema (obligations) and old schema (active_obligations)
        raw_obligations = client.get("obligations", client.get("active_obligations", []))

        # Normalise new schema obligations to the shape deadline_agent expects
        obligations_list = []
        for o in raw_obligations:
            if "code" in o:  # new schema
                obligations_list.append({
                    "id":               o["code"],
                    "type":             o["code"].replace("_", " ").title(),
                    "due_date":         o.get("due_date", ""),
                    "status":           o.get("status", "pending").upper(),
                    "risk_level":       "HIGH" if o.get("status") in ("overdue", "critical") else "MEDIUM",
                    "penalty_if_missed": o.get("penalty", "Not specified"),
                })
            else:  # old schema — pass through unchanged
                obligations_list.append(o)

        for obligation in obligations_list:
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
                "client_contact":    contact.get("name", client_name),
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
                "source":            "clients_json",

                # Email draft for CA to send to client
                "advisory_email": {
                    "subject": f"[{level}] Compliance Deadline — {obligation.get('type','')} due {due_date_str}",
                    "body": (
                        f"Dear {contact.get('name', client_name)},\n\n"
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

    # ── Source 2: Generated drafts with structured deadlines ───────────────
    drafts_alerts = _scan_drafts_for_deadlines(clients, today, today_str)
    alerts.extend(drafts_alerts)

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


# ── AUTO-DRAFT GENERATION FOR DEADLINES ──────────────────────────────────────

def generate_deadline_drafts(alerts: Optional[list[dict]] = None, auto_generate: bool = True) -> list[dict]:
    """
    Auto-generate compliance drafts for CRITICAL and MISSED deadlines.
    
    Args:
        alerts: List of deadline alerts (scans if None)
        auto_generate: If True, generates drafts for CRITICAL and MISSED only
    
    Returns:
        List of generated drafts with metadata
    """
    if alerts is None:
        alerts = scan_deadlines()
    
    # Filter to only CRITICAL and MISSED for auto-generation
    actionable = [a for a in alerts if a["level"] in ("CRITICAL", "MISSED")]
    
    if not actionable:
        return []
    
    # Load full client data
    if not CLIENTS_PATH.exists():
        raise FileNotFoundError(f"clients.json not found at {CLIENTS_PATH}")
    
    clients = {c["id"]: c for c in json.loads(CLIENTS_PATH.read_text(encoding="utf-8"))}
    
    generated_drafts = []
    
    for alert in actionable:
        client_id = alert["client_id"]

        # Skip alerts that came from existing DEADLINE drafts — these should not
        # trigger new draft generation. This prevents infinite nesting.
        obligation_id = alert.get("obligation_id", "")
        if obligation_id.startswith("DEADLINE_"):
            continue

        client = clients.get(client_id)

        if not client:
            print(f"  ⚠️  Client {client_id} not found — skipping draft generation")
            continue

        # Build a circular-like object for drafter compatibility
        circular = {
            "title": f"{alert['obligation_type']} - {alert['level']} Deadline Alert",
            "regulator": _infer_regulator_from_obligation(alert["obligation_type"], alert["tags"]),
            "priority": "HIGH" if alert["level"] == "MISSED" else "MEDIUM",
            "summary": alert["headline"],
        }

        # Build obligations from alert
        obligations = {
            "actions": [alert["recommended_action"]],
            "deadline": alert["due_date"],
            "risk_level": alert["risk_level"],
            "penalty_if_missed": alert["penalty"],
            "applicable_sections": [],
            "internal_notes": f"Auto-generated from deadline agent. Level: {alert['level']}. Days until due: {alert['days_until_due']}. Financial exposure: {alert['exposure']['exposure_label']}"
        }

        # Generate draft email
        try:
            subject, body = _generate_deadline_email(alert, client, obligations)

            # Strip any DEADLINE_ prefix from obligation_id to prevent nested IDs
            clean_obligation_id = obligation_id.removeprefix("DEADLINE_")
            draft_id = f"DEADLINE_{client_id}_{clean_obligation_id}_{date.today().isoformat()}"
            
            draft = {
                "draft_id": draft_id,
                "client_id": client_id,
                "client_name": client.get("profile", {}).get("name", client.get("name", "")),
                "client_email": alert["client_email"],
                "client_contact": alert["client_contact"],
                "circular_id": f"DEADLINE_{alert['obligation_id']}",
                "circular_title": circular["title"],
                "regulator": circular["regulator"],
                "priority": circular["priority"],
                "circular_summary": circular["summary"],
                "actions": obligations["actions"],
                "deadline": obligations["deadline"],
                "risk_level": obligations["risk_level"],
                "penalty_if_missed": obligations["penalty_if_missed"],
                "applicable_sections": obligations["applicable_sections"],
                "email_subject": subject,
                "email_body": body,
                "internal_notes": obligations["internal_notes"],
                "source_chunks": [],
                "model_used": "deadline_agent_auto",
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "version": "v1",
                "status": "pending_review",
                "metadata": {
                    "deadline_level": alert["level"],
                    "days_until_due": alert["days_until_due"],
                    "financial_exposure": alert["exposure"],
                    "auto_generated": True
                }
            }
            
            # Save draft
            draft_path = _save_deadline_draft(draft)
            generated_drafts.append(draft)
            
            icon = "💀" if alert["level"] == "MISSED" else "🔴"
            print(f"  {icon} Draft generated: {client.get('profile', {}).get('name', client.get('name', '?'))} — {alert['obligation_type']} ({alert['level']})")
            
        except Exception as e:
            print(f"  ❌ Failed to generate draft for {client.get('profile', {}).get('name', client.get('name', '?'))}: {e}")
    
    return generated_drafts


def _infer_regulator_from_obligation(obligation_type: str, tags: list[str]) -> str:
    """Infer regulator from obligation type and client tags."""
    obligation_lower = obligation_type.lower()
    
    if "gst" in obligation_lower or "gstr" in obligation_lower:
        return "GST"
    elif "tds" in obligation_lower or "income" in obligation_lower or "itr" in obligation_lower or "advance tax" in obligation_lower:
        return "IncomeTax"
    elif "rbi" in obligation_lower or "softex" in obligation_lower or "export" in obligation_lower:
        return "RBI"
    elif "fema" in obligation_lower:
        return "RBI"
    elif "sebi" in obligation_lower:
        return "SEBI"
    elif "mca" in obligation_lower or "llp" in obligation_lower or "cin" in obligation_lower:
        return "MCA"
    elif "transfer pricing" in obligation_lower or "tp" in obligation_lower:
        return "IncomeTax"
    
    # Fallback to first tag
    if tags:
        tag_map = {
            "GST": "GST",
            "IncomeTax": "IncomeTax",
            "RBI": "RBI",
            "FEMA": "RBI",
            "SEBI": "SEBI",
            "MCA": "MCA"
        }
        for tag in tags:
            if tag in tag_map:
                return tag_map[tag]
    
    return "Unknown"


def _generate_deadline_email(alert: dict, client: dict, obligations: dict) -> tuple[str, str]:
    """Generate email subject and body for deadline alert."""
    contact = client.get("contact", {})
    primary_person = contact.get("primary_person") or contact.get("name", "Sir/Madam")
    
    level = alert["level"]
    obligation_type = alert["obligation_type"]
    due_date = alert["due_date"]
    days_until = alert["days_until_due"]
    penalty = alert["penalty"]
    exposure = alert["exposure"]["exposure_label"]
    
    # Subject lines by urgency
    if level == "MISSED":
        subject = f"URGENT: {obligation_type} Deadline MISSED — Immediate Action Required"
    elif level == "CRITICAL":
        subject = f"CRITICAL: {obligation_type} Due in {days_until} Day(s) — Action Required"
    else:
        subject = f"Reminder: {obligation_type} Due on {due_date}"
    
    # Email body templates
    if level == "MISSED":
        body = f"""Dear {primary_person},

This is an URGENT compliance alert regarding a MISSED deadline.

⚠️ MISSED DEADLINE: {obligation_type}
   Original Due Date: {due_date}
   Days Overdue: {abs(days_until)} days

FINANCIAL EXPOSURE: {exposure}
PENALTY APPLICABLE: {penalty}

IMMEDIATE ACTION REQUIRED:
{obligations['actions'][0]}

Please contact us IMMEDIATELY to initiate late filing/condonation procedures.

Time is critical — every day of delay increases the penalty.

Regards,
Compliance Advisory Team
[ComplianceGPT Automated Deadline Alert]
"""
    elif level == "CRITICAL":
        body = f"""Dear {primary_person},

This is a CRITICAL compliance reminder.

🔴 URGENT DEADLINE: {obligation_type}
   Due Date: {due_date}
   Days Remaining: {days_until} day(s)

FINANCIAL EXPOSURE: {exposure}
PENALTY IF MISSED: {penalty}

REQUIRED ACTION:
{obligations['actions'][0]}

Please prioritize this matter and contact us today to ensure timely filing.

Regards,
Compliance Advisory Team
[ComplianceGPT Automated Deadline Alert]
"""
    else:
        body = f"""Dear {primary_person},

This is a compliance reminder for your upcoming deadline.

🟡 REMINDER: {obligation_type}
   Due Date: {due_date}
   Days Remaining: {days_until} days

FINANCIAL EXPOSURE: {exposure}
PENALTY IF MISSED: {penalty}

REQUIRED ACTION:
{obligations['actions'][0]}

Please contact us to proceed with the filing.

Regards,
Compliance Advisory Team
[ComplianceGPT Automated Deadline Alert]
"""
    
    return subject, body


def _save_deadline_draft(draft: dict) -> Path:
    """Save deadline draft to data/drafts/ directory."""
    from pathlib import Path
    DRAFTS_DIR = _BACKEND_DIR / "data" / "drafts"
    DRAFTS_DIR.mkdir(parents=True, exist_ok=True)
    
    filename = f"{draft['draft_id']}.json"
    path = DRAFTS_DIR / filename
    path.write_text(json.dumps(draft, indent=2, ensure_ascii=False), encoding="utf-8")
    return path


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