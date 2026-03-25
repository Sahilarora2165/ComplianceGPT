"""
Client Context Matcher Agent
─────────────────────────────
Takes new regulatory circulars from the Monitoring Agent and matches
each one to the relevant clients from clients.json.

Public API:
    match_clients(documents: list[dict]) -> list[dict]

Standalone:
    python agents/client_matcher.py
"""

import json
import sys
from pathlib import Path

# ── Path setup ────────────────────────────────────────────────────────────────
# agents/client_matcher.py → parent = agents/ → parent = backend/ (app root)
_BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.append(str(_BACKEND_DIR))

from config import LOGS_DIR
from core.audit import log_event

# ── Paths ─────────────────────────────────────────────────────────────────────
CLIENTS_PATH = _BACKEND_DIR / "clients.json"


# ─────────────────────────────────────────────
# CLIENT LOADER
# ─────────────────────────────────────────────

def _load_clients() -> list[dict]:
    if not CLIENTS_PATH.exists():
        raise FileNotFoundError(f"clients.json not found at: {CLIENTS_PATH}")
    with open(CLIENTS_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


# ─────────────────────────────────────────────
# MATCHING RULES
# ─────────────────────────────────────────────

# Each rule is:
#   "regulator_tag" → list of (client_field, expected_value, reason_string)
# All conditions in a rule's list are checked with OR logic —
# a client matches if ANY condition is true.
#
# client_field supports:
#   - top-level key:         "business_type"
#   - nested key (dot):      "compliance.tds_applicable"
#   - tags list membership:  "tags:GST"

_MATCH_RULES: dict[str, list[dict]] = {
    "RBI": [
        {
            "field":  "tags:RBI",
            "reason": "Tagged as RBI-regulated entity"
        },
        {
            "field":  "tags:FEMA",
            "reason": "Has foreign transactions — FEMA applicable"
        },
        {
            "field":  "identifiers.iec",
            "check":  "not_null",
            "reason": "Has IEC code — involved in import/export (FEMA applicable)"
        },
    ],
    "GST": [
        {
            "field":  "tags:GST",
            "reason": "GST registered entity"
        },
        {
            "field":  "identifiers.gstin",
            "check":  "not_null",
            "reason": "Has active GSTIN — GST advisory directly applicable"
        },
    ],
    "IncomeTax": [
        {
            "field":  "tags:IncomeTax",
            "reason": "Income Tax filer"
        },
        {
            "field":  "compliance.tds_applicable",
            "check":  "is_true",
            "reason": "TDS applicable — income tax circulars directly affect this client"
        },
        {
            "field":  "identifiers.tan",
            "check":  "not_null",
            "reason": "Has TAN — TDS filer, income tax circulars apply"
        },
    ],
    "MCA": [
        {
            "field":  "tags:MCA",
            "reason": "MCA-regulated entity"
        },
        {
            "field":  "constitution",
            "check":  "contains",
            "value":  "llp",
            "reason": "Constituted as LLP — MCA/LLP filings applicable"
        },
        {
            "field":  "constitution",
            "check":  "contains",
            "value":  "private limited",
            "reason": "Private Limited Company — MCA compliance applicable"
        },
        {
            "field":  "identifiers.cin",
            "check":  "not_null",
            "reason": "Has CIN — registered company under MCA"
        },
    ],
    "SEBI": [
        {
            "field":  "tags:SEBI",
            "reason": "SEBI-regulated entity"
        },
        {
            "field":  "business_type",
            "check":  "contains",
            "value":  "listed",
            "reason": "Listed company — SEBI circulars directly applicable"
        },
    ],
}


# ─────────────────────────────────────────────
# FIELD RESOLVER
# ─────────────────────────────────────────────

def _resolve_field(client: dict, field: str) -> object:
    """
    Resolve a field path from a client dict.
    Supports:
      "business_type"              → client["business_type"]
      "compliance.tds_applicable"  → client["compliance"]["tds_applicable"]
      "tags:GST"                   → "GST" in client["tags"]  (returns bool)
    """
    # Tags membership check
    if field.startswith("tags:"):
        tag = field.split(":", 1)[1].upper()
        client_tags = [t.upper() for t in client.get("tags", [])]
        return tag in client_tags

    # Nested dot path
    parts = field.split(".")
    value = client
    for part in parts:
        if not isinstance(value, dict):
            return None
        value = value.get(part)
    return value


def _client_matches_rule(client: dict, rule: dict) -> tuple[bool, str]:
    """
    Evaluate a single rule condition against a client.
    Returns (matched: bool, reason: str)
    """
    field  = rule["field"]
    check  = rule.get("check", "truthy")
    value  = rule.get("value", None)
    reason = rule["reason"]

    resolved = _resolve_field(client, field)

    if check == "truthy":
        # For tags:X → resolved is already bool
        matched = bool(resolved)

    elif check == "not_null":
        matched = resolved is not None and str(resolved).strip() not in ("", "None", "null")

    elif check == "is_true":
        matched = resolved is True

    elif check == "contains":
        if resolved is None:
            matched = False
        else:
            matched = value.lower() in str(resolved).lower()

    else:
        matched = False

    return matched, reason


def _match_client_to_circular(client: dict, regulator: str) -> tuple[bool, str]:
    """
    Check if a client is affected by a circular from a given regulator.
    Tries all rules for that regulator — returns on first match (OR logic).
    Returns (matched: bool, reason: str)
    """
    rules = _MATCH_RULES.get(regulator, [])

    for rule in rules:
        matched, reason = _client_matches_rule(client, rule)
        if matched:
            return True, reason

    return False, ""


# ─────────────────────────────────────────────
# PRIORITY LABEL
# ─────────────────────────────────────────────

def _is_urgent(priority: str) -> bool:
    return priority.upper() == "HIGH"


# ─────────────────────────────────────────────
# CORE MATCHER
# ─────────────────────────────────────────────

def match_clients(documents: list[dict]) -> list[dict]:
    """
    Main entry point.
    Takes a list of circular dicts from the Monitoring Agent.
    Returns a list of match result dicts, one per circular.

    Input format per circular:
        {
            "regulator": "RBI",
            "title":     "...",
            "priority":  "HIGH",
            "summary":   "...",
            "source":    "simulated"   # optional
        }

    Output format per circular:
        {
            "circular_title":   "...",
            "regulator":        "RBI",
            "priority":         "HIGH",
            "summary":          "...",
            "affected_clients": [
                {
                    "client_id": "C1",
                    "name":      "...",
                    "reason":    "...",
                    "urgent":    True
                }
            ],
            "match_count": 1
        }
    """
    clients = _load_clients()
    results = []

    for doc in documents:
        regulator = doc.get("regulator", "Unknown").strip()
        title     = doc.get("title", "Untitled")
        priority  = doc.get("priority", "LOW")
        summary   = doc.get("summary", "")
        urgent    = _is_urgent(priority)

        affected: list[dict] = []

        for client in clients:
            matched, reason = _match_client_to_circular(client, regulator)
            if matched:
                affected.append({
                    "client_id": client["id"],
                    "name":      client["name"],
                    "business_type": client["business_type"],
                    "contact_email": client["contact"]["email"],
                    "reason":    reason,
                    "urgent":    urgent
                })

        result = {
            "circular_title":   title,
            "regulator":        regulator,
            "priority":         priority,
            "summary":          summary,
            "affected_clients": affected,
            "match_count":      len(affected)
        }
        results.append(result)

        # Audit log every match event
        log_event(
            agent="ClientMatcher",
            action="clients_matched",
            details={
                "circular":    title,
                "regulator":   regulator,
                "priority":    priority,
                "match_count": len(affected),
                "client_ids":  [c["client_id"] for c in affected]
            }
        )

    return results


# ─────────────────────────────────────────────
# STANDALONE DEMO
# ─────────────────────────────────────────────

_SIMULATED_DOCS = [
    {
        "regulator": "RBI",
        "title":     "RBI Circular: FEMA Compliance Deadline Extended – March 2026",
        "url":       "https://www.rbi.org.in/sample/fema_circular_march2026.pdf",
        "filename":  "rbi_fema_circular_march2026.pdf",
        "priority":  "HIGH",
        "summary":   "FEMA reporting deadline for foreign transactions extended by 30 days.",
        "source":    "simulated"
    },
    {
        "regulator": "GST",
        "title":     "GST Advisory: New Invoice Management System (IMS) – April 2026",
        "priority":  "HIGH",
        "summary":   "Invoice Management System mandatory from April 1, 2026 for all GST filers.",
        "source":    "simulated"
    },
    {
        "regulator": "IncomeTax",
        "title":     "CBDT Circular: TDS Rate Revision – FY 2026-27",
        "priority":  "MEDIUM",
        "summary":   "TDS rates revised for Section 194C and 194J effective April 2026.",
        "source":    "simulated"
    },
    {
        "regulator": "MCA",
        "title":     "MCA Notification: LLP Annual Filing Deadline – FY 2025-26",
        "priority":  "MEDIUM",
        "summary":   "LLP Form 11 annual return due date extended to July 15, 2026.",
        "source":    "simulated"
    },
    {
        "regulator": "SEBI",
        "title":     "SEBI Circular: ESG Disclosure Norms for Listed Companies",
        "priority":  "LOW",
        "summary":   "Enhanced ESG disclosures mandatory for top 1000 listed companies.",
        "source":    "simulated"
    },
]


if __name__ == "__main__":
    print("=" * 60)
    print("  CLIENT CONTEXT MATCHER — Demo Run")
    print("=" * 60)

    results = match_clients(_SIMULATED_DOCS)

    priority_icon = {"HIGH": "🔴", "MEDIUM": "🟡", "LOW": "⚪"}

    for r in results:
        icon = priority_icon.get(r["priority"], "⚪")
        print(f"\n{icon} [{r['priority']}] {r['circular_title']}")
        print(f"   Regulator : {r['regulator']}")
        print(f"   Summary   : {r['summary']}")
        print(f"   Matches   : {r['match_count']} client(s)")

        if r["affected_clients"]:
            for c in r["affected_clients"]:
                urgent_badge = " ⚡ URGENT" if c["urgent"] else ""
                print(f"     → {c['name']} ({c['business_type']}){urgent_badge}")
                print(f"        Reason : {c['reason']}")
                print(f"        Email  : {c['contact_email']}")
        else:
            print("     → No clients affected")

    print("\n" + "=" * 60)
    print(f"  Processed {len(results)} circulars")
    total_matches = sum(r["match_count"] for r in results)
    print(f"  Total client-circular matches: {total_matches}")
    print("=" * 60)