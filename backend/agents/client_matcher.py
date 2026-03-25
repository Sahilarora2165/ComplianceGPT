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

# ─────────────────────────────────────────────
# CONTENT-BASED FILTERING
# ─────────────────────────────────────────────

# Circular titles/summaries matching these → market ops / statistical data.
# They carry no compliance obligation for non-banking businesses → skip entirely.
_MARKET_OPS_SKIP: dict[str, list[str]] = {
    "RBI": [
        "auction result",
        "t-bill",
        "treasury bill",
        "91-day",
        "182-day",
        "364-day",
        "reserve money",
        "money supply",
        "cut-off",
        "state government securit",   # "securities" / "security"
        "state development loan",
        "open market operation",
        "liquidity adjustment facility",
        "fortnight ended",             # periodic statistical releases
        "weekly statistical supplement",
        "ways and means advance",
    ],
}

# Content rules per regulator: if the circular text matches a keyword group,
# the client must also satisfy the tag/business check to be included.
# Rules are evaluated in order; first keyword match wins.
# If NO rule's keywords match, the circular is treated as generic for that
# regulator and the regulator-level tag match (from _MATCH_RULES) stands.
_CONTENT_RULES: dict[str, list[dict]] = {
    "RBI": [
        {
            "keywords": [
                "fema", "foreign exchange management", "foreign transaction",
                "export realisation", "iec", "softex", "lrs", "liberalised remittance",
                "ecb", "external commercial borrowing", "nri", "fcnr",
                "import payment", "overseas direct investment", "odi",
            ],
            "required_tags": ["FEMA"],
            "reason": "FEMA/foreign exchange circular — applicable to entities with foreign transactions",
        },
        {
            "keywords": [
                "nbfc", "non-banking financial", "microfinance institution",
                "mfi", "housing finance company",
            ],
            "required_tags": ["RBI"],
            "business_contains": ["nbfc", "microfinance", "housing finance"],
            "reason": "NBFC/microfinance circular — applicable to NBFC-type clients",
        },
        {
            "keywords": [
                "co-operative bank", "cooperative bank", "urban co-op",
                "urban cooperative", "credit cooperative", "mahila co-operative",
            ],
            "required_tags": ["RBI"],
            "business_contains": ["bank", "cooperative", "credit society"],
            "reason": "Co-operative bank circular — applicable to cooperative banking clients",
        },
        {
            "keywords": [
                "kyc", "know your customer", "anti-money laundering",
                "aml", "pmla", "beneficial owner", "customer due diligence",
            ],
            "required_tags": ["RBI"],
            "reason": "KYC/AML circular — applicable to RBI-regulated entities",
        },
        {
            "keywords": [
                "section 35a", "directions under section", "banking regulation act",
                "enforcement action", "corrective action plan", "amalgamat",
                "voluntary amalgamation",
            ],
            "required_tags": ["RBI"],
            "business_contains": ["bank", "cooperative", "financial", "nbfc"],
            "reason": "Banking enforcement/amalgamation — applicable to banking/financial clients",
        },
        {
            "keywords": [
                "priority sector", "agricultural credit", "msme lending",
                "kisan credit", "crop loan",
            ],
            "required_tags": ["RBI"],
            "business_contains": ["bank", "cooperative", "nbfc", "microfinance"],
            "reason": "Priority sector lending circular — applicable to RBI-regulated lenders",
        },
    ],
}


def _matches_any(text: str, keywords: list) -> bool:
    return any(kw in text for kw in keywords)


def _is_market_ops(title: str, summary: str, regulator: str) -> bool:
    """True if this circular is a market/statistical release with no compliance obligation."""
    patterns = _MARKET_OPS_SKIP.get(regulator, [])
    if not patterns:
        return False
    text = (title + " " + summary).lower()
    return _matches_any(text, patterns)


def _content_match(title: str, summary: str, client: dict, regulator: str) -> tuple[bool, str]:
    """
    Content-based relevance check, called after the regulator-level tag check passes.
    Returns (matched, reason).
    If no content rule's keywords match the circular, returns (True, "") — treating
    it as a generic circular and deferring to the regulator-level reason.
    """
    rules = _CONTENT_RULES.get(regulator, [])
    if not rules:
        return True, ""

    text = (title + " " + summary).lower()
    client_tags = [t.upper() for t in client.get("tags", [])]
    biz = client.get("business_type", "").lower()

    for rule in rules:
        if not _matches_any(text, rule["keywords"]):
            continue

        # Keywords matched — check required client tags
        required_tags = rule.get("required_tags", [])
        if required_tags and not any(t.upper() in client_tags for t in required_tags):
            return False, ""

        # Optionally narrow by business type
        biz_kws = rule.get("business_contains", [])
        if biz_kws and not _matches_any(biz, biz_kws):
            return False, ""

        return True, rule["reason"]

    # No content rule matched → generic circular, pass through
    return True, ""


# ─────────────────────────────────────────────
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


def _match_client_to_circular(
    client: dict, regulator: str, title: str = "", summary: str = ""
) -> tuple[bool, str]:
    """
    Check if a client is affected by a circular from a given regulator.

    Three-stage filter:
      1. Skip market-ops / statistical releases (no compliance obligation).
      2. Check regulator-level tag rules (OR logic).
      3. Content-based check: narrow by circular topic vs client profile.

    Returns (matched: bool, reason: str)
    """
    # Stage 1 — skip market ops
    if _is_market_ops(title, summary, regulator):
        return False, ""

    # Stage 2 — regulator-level tag check
    rules = _MATCH_RULES.get(regulator, [])
    matched_reason = ""
    for rule in rules:
        matched, reason = _client_matches_rule(client, rule)
        if matched:
            matched_reason = reason
            break

    if not matched_reason:
        return False, ""

    # Stage 3 — content relevance check
    content_ok, content_reason = _content_match(title, summary, client, regulator)
    if not content_ok:
        return False, ""

    return True, content_reason or matched_reason


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
            matched, reason = _match_client_to_circular(client, regulator, title=title, summary=summary)
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

    priority_icon = {"HIGH": "python /app/orchestrator.py --schedule🔴", "MEDIUM": "🟡", "LOW": "⚪"}

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