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
        print(f"  Warning: clients.json not found at {CLIENTS_PATH} — returning empty client list")
        log_event(agent="ClientMatcher", action="load_failed", details={"reason": "clients.json not found"})
        return []
    try:
        with open(CLIENTS_PATH, "r", encoding="utf-8") as f:
            raw = json.load(f)
    except (json.JSONDecodeError, Exception) as e:
        print(f"  Warning: clients.json is corrupted — {e}")
        log_event(agent="ClientMatcher", action="load_failed", details={"reason": str(e)})
        return []

    # Validate required fields — skip malformed records
    valid = []
    for client in raw:
        if not isinstance(client, dict) or "id" not in client:
            print(f"  Warning: skipping malformed client record (missing 'id'): {str(client)[:80]}")
            continue
        valid.append(client)
    return valid


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
        # ─── FEMA / Foreign Exchange ──────────────────────────────────────
        {
            "keywords": [
                "fema", "foreign exchange management", "foreign transaction",
                "export realisation", "iec", "softex", "lrs", "liberalised remittance",
                "ecb", "external commercial borrowing", "nri", "fcnr",
                "import payment", "overseas direct investment", "odi",
                "current account transaction", "capital account transaction",
            ],
            "required_tags": ["FEMA"],
            "reason": "FEMA/foreign exchange circular — applicable to entities with foreign transactions",
        },
        # ─── NBFC / Financial Institutions ─────────────────────────────────
        {
            "keywords": [
                "nbfc", "non-banking financial", "microfinance institution",
                "mfi", "housing finance company", "hfc", "asset finance company",
                "investment company", "loan company", "infrastructure finance company",
            ],
            "required_tags": ["RBI"],
            "business_contains": ["nbfc", "microfinance", "housing finance", "financial services"],
            "reason": "NBFC/microfinance circular — applicable to NBFC-type clients",
        },
        # ─── Co-operative Banks ────────────────────────────────────────────
        {
            "keywords": [
                "co-operative bank", "cooperative bank", "urban co-op",
                "urban cooperative", "credit cooperative", "mahila co-operative",
                "district central cooperative", "state cooperative bank",
            ],
            "required_tags": ["RBI"],
            "business_contains": ["bank", "cooperative", "credit society"],
            "reason": "Co-operative bank circular — applicable to cooperative banking clients",
        },
        # ─── KYC / AML / PMLA ──────────────────────────────────────────────
        {
            "keywords": [
                "kyc", "know your customer", "anti-money laundering",
                "aml", "pmla", "beneficial owner", "customer due diligence",
                "cdd", "edd", "enhanced due diligence", "sanctions",
                "fugitive economic offender", "wilful defaulter",
            ],
            "required_tags": ["RBI"],
            "reason": "KYC/AML circular — applicable to RBI-regulated entities",
        },
        # ─── Monetary Penalty / Enforcement ────────────────────────────────
        {
            "keywords": [
                "imposes monetary penalty", "monetary penalty on", "penalty imposed",
                "penalised", "rbi penalises", "enforcement action",
                "section 30", "section 31", "section 32",
            ],
            "required_client_type": "business",
            "required_tags": ["RBI"],
            "reason": "RBI monetary penalty — applicable to RBI-regulated banking entities only",
        },
        # ─── Banking Regulation / Enforcement ──────────────────────────────
        {
            "keywords": [
                "section 35a", "directions under section", "banking regulation act",
                "enforcement action", "corrective action plan", "amalgamat",
                "voluntary amalgamation", "prompt corrective action", "pca framework",
                "banking ombudsman", "customer protection", "fair practices code",
            ],
            "required_tags": ["RBI"],
            "required_client_type": "business",
            "business_contains": ["bank", "cooperative", "financial", "nbfc"],
            "reason": "Banking enforcement/amalgamation — applicable to banking/financial clients",
        },
        # ─── Priority Sector Lending ───────────────────────────────────────
        {
            "keywords": [
                "priority sector", "agricultural credit", "msme lending",
                "kisan credit", "crop loan", "self-help group",
                "weaker sections", "differential rate of interest",
            ],
            "required_tags": ["RBI"],
            "business_contains": ["bank", "cooperative", "nbfc", "microfinance"],
            "reason": "Priority sector lending circular — applicable to RBI-regulated lenders",
        },
        # ─── Digital Payments / Fintech ────────────────────────────────────
        {
            "keywords": [
                "digital payment", "upi", "prepaid instrument", "payout",
                "wallet", "payment bank", "small finance bank",
                "card tokenisation", "e-mandate", "bbps", "imps", "neft", "rtgs",
            ],
            "required_tags": ["RBI"],
            "business_contains": ["bank", "fintech", "payment", "wallet"],
            "reason": "Digital payments circular — applicable to payment service providers",
        },
        # ─── Interest Rate / Deposit ───────────────────────────────────────
        {
            "keywords": [
                "interest rate", "deposit rate", "savings bank", "term deposit",
                "repo rate", "reverse repo", "mclr", "base rate",
            ],
            "required_tags": ["RBI"],
            "business_contains": ["bank", "cooperative", "nbfc"],
            "reason": "Interest rate/deposit circular — applicable to deposit-taking institutions",
        },
    ],
    "MCA": [
        # ─── LLP Filings ───────────────────────────────────────────────────
        {
            "keywords": [
                "llp", "form 11", "form 8", "limited liability partnership",
                "llp annual", "llp agreement", "form 3", "form 4",
                "form 5", "form 14", "llp settlement",
            ],
            "required_constitution": "llp",
            "reason": "LLP filing circular — applicable only to LLP clients",
        },
        # ─── Company Annual Filings ────────────────────────────────────────
        {
            "keywords": [
                "aoc-4", "mgt-7", "annual return", "annual filing",
                "form aoc-4", "form mgt-7", "board report", "financial statement",
                "annual general meeting", "agm", "notice of agm",
            ],
            "required_constitution": "company",
            "reason": "Company annual filing circular — applicable only to company clients",
        },
        # ─── Director Related ──────────────────────────────────────────────
        {
            "keywords": [
                "din", "director identification", "disqualification of director",
                "form dir-3", "form dir-12", "appointment of director",
                "independent director", "women director", "resident director",
                "director report", "board composition",
            ],
            "required_constitution": "company",
            "reason": "Director-related circular — applicable to companies with directors",
        },
        # ─── Charge / Sec 8 / Registration ─────────────────────────────────
        {
            "keywords": [
                "form chg-1", "registration of charge", "satisfaction of charge",
                "sec 8 company", "section 8", "one person company", "opc",
                "producer company", "nidhi company", "section 455",
            ],
            "required_constitution": "company",
            "reason": "Company registration/charge circular — applicable to registered companies",
        },
        # ─── Compliance / Prosecution ──────────────────────────────────────
        {
            "keywords": [
                "compounding", "prosecution", "adjudication", "penalty",
                "form coc", "condonation of delay", "additional fee",
                "late filing", "extra fee", "penalty for delay",
            ],
            "required_constitution": "company",
            "reason": "MCA compliance/prosecution circular — applicable to companies",
        },
        # ─── Beneficial Owner / Significant Control ────────────────────────
        {
            "keywords": [
                "significant beneficial owner", "sbo", "beneficial interest",
                "form ben-1", "form ben-2", "form ben-4", "beneficial ownership",
            ],
            "required_constitution": "company",
            "reason": "Beneficial ownership reporting — applicable to companies",
        },
        # ─── CSR / Related Party ───────────────────────────────────────────
        {
            "keywords": [
                "corporate social responsibility", "csr", "section 135",
                "related party transaction", "rpt", "section 188", "form aoc-2",
                "arm's length transaction",
            ],
            "required_constitution": "company",
            "reason": "CSR/RPT circular — applicable to companies meeting threshold",
        },
        # ─── Generic MCA (catch companies) ─────────────────────────────────
        {
            "keywords": [
                "companies act", "company law", "mca21", "roc",
                "registrar of companies", "corporate affairs",
            ],
            "required_constitution": "company",
            "reason": "Companies Act circular — applicable to all companies",
        },
    ],
    "IncomeTax": [
        # ─── TDS/TCS (Deductors Only) ──────────────────────────────────────
        {
            "keywords": [
                "tds", "tax deduction at source", "tcs", "tax collection at source",
                "section 194", "section 206", "deductor", "deductee",
                "form 24q", "form 26q", "form 27q", "form 27eq",
                "tds return", "tds rate", "tds certificate", "form 16", "form 16a",
                "tan", "tax deduction account", "section 200", "section 203",
            ],
            "required_tags": ["TDS"],
            "required_constitution_exclude": ["individual", "salaried"],
            "reason": "TDS/TCS circular — applicable to TAN holders who are deductors (companies, LLPs, firms)",
        },
        # ─── Transfer Pricing ──────────────────────────────────────────────
        {
            "keywords": [
                "transfer pricing", "arm's length", "associated enterprise",
                "form 3ceb", "international transaction", "specified domestic",
                "section 92", "section 93", "country by country report", "master file",
                "local file", "safe harbour", "advance pricing agreement", "apa",
            ],
            "required_tags": ["Transfer Pricing"],
            "reason": "Transfer pricing circular — applicable to TP-assessed clients with international transactions",
        },
        # ─── Presumptive Taxation ──────────────────────────────────────────
        {
            "keywords": [
                "44ada", "44ad", "44ae", "presumptive taxation", "presumptive income",
                "section 44", "presumptive scheme", "turnover basis",
                "eligible profession", "specified profession",
            ],
            "required_tags": ["Presumptive Tax"],
            "reason": "Presumptive taxation circular — applicable to freelancers/small business under 44ADA/44AD",
        },
        # ─── Capital Gains ─────────────────────────────────────────────────
        {
            "keywords": [
                "capital gain", "ltcg", "stcg", "section 112", "section 111a",
                "securities transaction tax", "stt", "mutual fund redemption",
                "property sale", "share sale", "bond sale", "indexation benefit",
                "section 54", "section 54f", "section 54ec", "capital loss",
            ],
            "required_tags": ["Capital Gains"],
            "reason": "Capital gains circular — applicable to clients with capital gain transactions",
        },
        # ─── NRI / DTAA ────────────────────────────────────────────────────
        {
            "keywords": [
                "nri", "non-resident indian", "dtaa", "double taxation",
                "section 195", "foreign remittance", "repatriation",
                "residential status", "ordinarily resident", "not ordinarily resident",
                "form 10f", "tax residency certificate",
            ],
            "required_tags": ["NRI"],
            "reason": "NRI/DTAA circular — applicable to non-resident clients",
        },
        # ─── Scrutiny / Assessment / Appeal ────────────────────────────────
        {
            "keywords": [
                "scrutiny", "section 143", "section 148", "assessment order",
                "appeal", "itat", "cit(a)", "demand notice", "rectification",
                "section 154", "revision", "section 263", "section 264",
                "faceless assessment", "e-assessment", "national faceless",
            ],
            "required_client_type": "business",
            "reason": "Scrutiny/assessment circular — applicable to business clients under IT assessment",
        },
        # ─── ITR Filing (Generic) ──────────────────────────────────────────
        {
            "keywords": [
                "income tax return", "itr filing", "itr form", "itr-1", "itr-2",
                "itr-3", "itr-4", "itr-5", "itr-6", "itr-7", "belated return",
                "revised return", "section 139", "due date for return",
            ],
            "required_tags": ["IncomeTax"],
            "reason": "ITR filing circular — applicable to all income tax filers",
        },
        # ─── Advance Tax / Self Assessment ─────────────────────────────────
        {
            "keywords": [
                "advance tax", "self assessment tax", "section 208", "section 211",
                "instalment of tax", "deferred tax", "interest 234b", "interest 234c",
            ],
            "required_tags": ["IncomeTax"],
            "required_client_type": "business",
            "reason": "Advance tax circular — applicable to business clients with tax liability",
        },
        # ─── Tax Audit ─────────────────────────────────────────────────────
        {
            "keywords": [
                "tax audit", "section 44ab", "form 3ca", "form 3cb", "form 3cd",
                "audit report", "chartered accountant", "turnover audit",
            ],
            "required_tags": ["Tax Audit"],
            "reason": "Tax audit circular — applicable to clients requiring tax audit",
        },
        # ─── GST Overlap (Business Only) ───────────────────────────────────
        {
            "keywords": [
                "gst audit", "reconciliation statement", "gstr-9c", "annual return",
                "turnover reconciliation", "input tax credit", "itc",
            ],
            "required_tags": ["GST", "IncomeTax"],
            "reason": "GST-ITR reconciliation circular — applicable to clients with both GST and Income tax obligations",
        },
    ],
    "EPFO": [
        # ─── EPFO / PF / ESI ───────────────────────────────────────────────
        {
            "keywords": [
                "epf", "employee provident fund", "pf contribution", "pf return",
                "form 3a", "form 6a", "form 12a", "form 5", "form 10", "form 19",
                "form 31", "form 10c", "eps", "employee pension scheme",
            ],
            "required_tags": ["EPFO"],
            "reason": "EPFO/PF circular — applicable to EPFO-registered employers",
        },
        # ─── ESIC ──────────────────────────────────────────────────────────
        {
            "keywords": [
                "esic", "employee state insurance", "esi contribution",
                "medical benefit", "sickness benefit", "esi return",
                "dispensary", "esi hospital",
            ],
            "required_tags": ["EPFO"],
            "reason": "ESIC circular — applicable to ESIC-registered employers",
        },
        # ─── International Worker ──────────────────────────────────────────
        {
            "keywords": [
                "international worker", "iw", "cross-border",
                "foreign national", "overseas employee", "social security agreement",
            ],
            "required_tags": ["FEMA"],
            "reason": "EPFO international worker circular — applicable to entities with foreign employees",
        },
        # ─── Wage Ceiling / Coverage ───────────────────────────────────────
        {
            "keywords": [
                "wage ceiling", "coverage", "member", "subscriber",
                "mandatory coverage", "voluntary coverage", "excluded employee",
            ],
            "required_tags": ["EPFO"],
            "reason": "EPFO coverage circular — applicable to employers with employees",
        },
    ],
    "GST": [
        # ─── GSTR-1 / GSTR-3B (Regular Returns) ────────────────────────────
        {
            "keywords": [
                "gstr-1", "gstr-3b", "gstr-2b", "gstr-2a", "monthly return",
                "outward supply", "inward supply", "purchase register", "sales register",
                "return filing", "nil return", "late fee", "section 39",
            ],
            "required_tags": ["GST"],
            "reason": "GST return filing circular — applicable to GST-registered entities",
        },
        # ─── GSTR-9 / Annual Return ────────────────────────────────────────
        {
            "keywords": [
                "gstr-9", "gstr-9c", "annual return", "reconciliation statement",
                "annual statement", "form gst annx", "financial year return",
            ],
            "required_tags": ["GST"],
            "reason": "GST annual return circular — applicable to GST-registered entities",
        },
        # ─── Input Tax Credit (ITC) ────────────────────────────────────────
        {
            "keywords": [
                "input tax credit", "itc", "eligibility", "blocked credit",
                "section 16", "section 17", "reversal of credit", "common credit",
                "itc mismatch", "gstr-2b vs books", "section 17(5)",
            ],
            "required_tags": ["GST"],
            "reason": "Input tax credit circular — applicable to GST-registered entities claiming ITC",
        },
        # ─── E-Invoice / E-Way Bill ────────────────────────────────────────
        {
            "keywords": [
                "e-invoice", "eway bill", "invoice reference number", "irn",
                "qr code", "e-way bill rules", "turnover limit", "part-a", "part-b",
                "consignment", "goods movement", "transportation",
            ],
            "required_tags": ["GST"],
            "reason": "E-invoice/e-way bill circular — applicable to entities with goods movement",
        },
        # ─── GST Audit / Assessment ────────────────────────────────────────
        {
            "keywords": [
                "gst audit", "scrutiny", "assessment", "section 61", "section 65",
                "special audit", "section 66", "demand", "show cause notice",
                "section 73", "section 74", "adjudication",
            ],
            "required_tags": ["GST"],
            "required_client_type": "business",
            "reason": "GST audit/assessment circular — applicable to business entities under GST scrutiny",
        },
        # ─── Rate Change / Classification ──────────────────────────────────
        {
            "keywords": [
                "gst rate", "tax rate", "hsn code", "sac code", "classification",
                "schedule", "rate change", "exemption", "nil rated", "zero rated",
            ],
            "required_tags": ["GST"],
            "reason": "GST rate/classification circular — applicable to GST-registered entities",
        },
        # ─── Composition Scheme ────────────────────────────────────────────
        {
            "keywords": [
                "composition scheme", "composition levy", "section 10",
                "cmp-02", "cmp-08", "turnover limit", "quarterly return",
            ],
            "required_tags": ["GST"],
            "reason": "Composition scheme circular — applicable to small taxpayers under composition",
        },
        # ─── Refund / Export ───────────────────────────────────────────────
        {
            "keywords": [
                "gst refund", "refund claim", "export refund", "lut", "bond",
                "zero-rated supply", "refund rules", "form gst rfd",
                "unutilised credit", "inverted duty",
            ],
            "required_tags": ["GST", "FEMA"],
            "reason": "GST refund/export circular — applicable to exporters with GST registration",
        },
        # ─── TCS / E-Commerce ──────────────────────────────────────────────
        {
            "keywords": [
                "tcs", "tax collection at source", "e-commerce operator",
                "section 52", "gst on e-commerce", "gst portal",
            ],
            "required_tags": ["GST"],
            "reason": "GST TCS/e-commerce circular — applicable to e-commerce operators",
        },
    ],
    "SEBI": [
        # ─── Listed Company Compliance ─────────────────────────────────────
        {
            "keywords": [
                "listed company", "listing agreement", "listing regulation",
                "lodr", "stock exchange", "bse", "nse", "disclosure",
                "price sensitive", "unpublished price sensitive", "upsi",
            ],
            "required_tags": ["SEBI"],
            "business_contains": ["listed"],
            "reason": "Listed company compliance circular — applicable to SEBI-regulated listed entities",
        },
        # ─── Insider Trading / Code of Conduct ─────────────────────────────
        {
            "keywords": [
                "insider trading", "pit regulations", "code of conduct",
                "designated person", "trading window", "pre-clearance",
                "related party", "immediate relative",
            ],
            "required_tags": ["SEBI"],
            "reason": "Insider trading circular — applicable to SEBI-regulated entities",
        },
        # ─── Corporate Governance ──────────────────────────────────────────
        {
            "keywords": [
                "corporate governance", "board committee", "audit committee",
                "nomination and remuneration", "stakeholder relationship",
                "independent director", "women director", "board evaluation",
            ],
            "required_tags": ["SEBI"],
            "business_contains": ["listed"],
            "reason": "Corporate governance circular — applicable to listed companies",
        },
        # ─── SAST / Substantial Acquisition ────────────────────────────────
        {
            "keywords": [
                "sast", "substantial acquisition", "shareholding", "open offer",
                "trigger point", "creeping acquisition", "disclosure of acquisition",
            ],
            "required_tags": ["SEBI"],
            "business_contains": ["listed"],
            "reason": "SAST circular — applicable to listed companies and acquirers",
        },
        # ─── PIT / Prohibition ─────────────────────────────────────────────
        {
            "keywords": [
                "prohibition", "fraudulent", "unfair trade practice",
                "market manipulation", "front running", "pump and dump",
            ],
            "required_tags": ["SEBI"],
            "reason": "SEBI prohibition circular — applicable to market participants",
        },
        # ─── Mutual Fund / AIF / Portfolio Manager ─────────────────────────
        {
            "keywords": [
                "mutual fund", "aif", "alternative investment", "portfolio manager",
                "investment adviser", "research analyst", "fund manager",
                "scheme information", "sid", "kiim",
            ],
            "required_tags": ["SEBI"],
            "business_contains": ["fund", "asset management", "portfolio", "wealth management"],
            "reason": "SEBI fund/adviser circular — applicable to fund managers and investment advisers",
        },
        # ─── ESG / BRSR / Sustainability ───────────────────────────────────
        {
            "keywords": [
                "esg", "brsr", "business responsibility", "sustainability reporting",
                "integrated reporting", "carbon disclosure", "gri",
            ],
            "required_tags": ["SEBI"],
            "business_contains": ["listed"],
            "reason": "ESG/sustainability circular — applicable to listed entities",
        },
        # ─── Delisting / Buyback / SRE ─────────────────────────────────────
        {
            "keywords": [
                "delisting", "buyback", "share buyback", "rights issue",
                "preferential allotment", "qualified institutions placement", "qip",
                "further issue", "bonus issue",
            ],
            "required_tags": ["SEBI"],
            "business_contains": ["listed"],
            "reason": "SEBI corporate action circular — applicable to listed companies",
        },
    ],
}

# ─────────────────────────────────────────────
# Catch-all policy: when no content rule keyword matches a circular, these policies restrict
# the generic pass-through to a narrower audience instead of every client
# with any obligation under that regulator.
_CATCH_ALL_POLICY: dict[str, dict] = {
    # Generic RBI circulars (no FEMA/NBFC/KYC/penalty keyword) → banking entities only.
    # Arvind Textiles and Kapoor Tech have FEMA obligations under RBI but should NOT
    # receive every bank-governance or WMA circular that slips past content rules.
    "RBI": {"required_tags": ["RBI"]},
    # Generic IncomeTax circulars → business filers only (not salaried individuals).
    # Individual clients (CLT-008/009/010) get only circulars whose keywords
    # match their specific tags (NRI, Capital Gains, Presumptive Tax).
    "IncomeTax": {"required_client_type": "business"},
    # Generic GST circulars → all GST-registered entities
    "GST": {"required_tags": ["GST"]},
    # Generic MCA circulars → companies and LLPs only (not individuals)
    "MCA": {"required_constitution": "company"},
    # Generic SEBI circulars → listed companies and fund managers only
    "SEBI": {"required_tags": ["SEBI"]},
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


# ─────────────────────────────────────────────
# OBLIGATION-DRIVEN MATCH  (primary path)
# ─────────────────────────────────────────────

def _obligation_match(client: dict, regulator: str) -> str:
    """
    Check if the client has any obligation under this regulator.
    Returns a reason string if matched, empty string otherwise.

    This is the primary matching path — it works for any client whose
    obligations[] array is properly populated, regardless of tags or
    registration fields. A CA firm can onboard 100 unknown clients and
    as long as obligations are entered, matching is automatic.
    """
    obligations = client.get("obligations", [])
    matched = [o for o in obligations if o.get("regulator", "").upper() == regulator.upper()]
    if not matched:
        return ""

    # Build a compact reason from the obligation codes present
    codes = [o["code"] for o in matched if "code" in o]
    statuses = {o.get("status", "pending") for o in matched}

    if len(codes) == 1:
        status_str = next(iter(statuses))
        return f"Has {codes[0]} obligation ({status_str}) under {regulator}"
    else:
        overdue = [o for o in matched if o.get("status") in ("overdue", "critical", "action_needed")]
        if overdue:
            return f"{len(overdue)} overdue/critical {regulator} obligation(s): {', '.join(o['code'] for o in overdue)}"
        return f"{len(codes)} active {regulator} obligation(s): {', '.join(codes[:3])}{'...' if len(codes) > 3 else ''}"


# ─────────────────────────────────────────────
# TAG / REGISTRATION FALLBACK  (for clients with no obligations array)
# ─────────────────────────────────────────────

def _content_match(
    title: str,
    summary: str,
    client: dict,
    regulator: str,
    obligation_matched: bool = False,
) -> tuple[bool, str]:
    """
    Content-based relevance check, called after a client passes the regulator match.
    Returns (matched, reason).
    If no content rule's keywords match the circular, returns (True, "") — treating
    it as a generic circular for that regulator.

    obligation_matched=True means the client arrived via the obligation path (has a real
    duty to this regulator). In that case tag-based filters are skipped — a client with
    an active RBI obligation should receive all RBI circulars regardless of which tags
    the CA assigned. Only structural checks (client_type, constitution, business_contains)
    still apply to avoid e.g. a company getting LLP-only circulars.
    """
    rules = _CONTENT_RULES.get(regulator, [])
    if not rules:
        return True, ""

    text = (title + " " + summary).lower()
    client_tags = [t.upper() for t in client.get("tags", [])]
    biz = client.get("profile", {}).get("industry", "").lower()
    constitution = client.get("profile", {}).get("constitution", "").lower()

    for rule in rules:
        if not _matches_any(text, rule["keywords"]):
            continue

        # Keywords matched — check required client type (business vs individual)
        required_client_type = rule.get("required_client_type")
        if required_client_type:
            actual_type = client.get("client_type", "business")
            if actual_type != required_client_type:
                return False, ""

        # Tag check: skip for obligation-matched clients (they already proved relevance).
        required_tags = rule.get("required_tags", [])
        if required_tags and not obligation_matched:
            if not any(t.upper() in client_tags for t in required_tags):
                return False, ""

        # Constitution requirement (e.g., "llp", "company")
        required_constitution = rule.get("required_constitution")
        if required_constitution:
            if required_constitution not in constitution:
                return False, ""

        # Constitution exclusion (e.g., exclude "individual", "salaried" for TDS)
        required_constitution_exclude = rule.get("required_constitution_exclude", [])
        if required_constitution_exclude:
            if any(excl in constitution for excl in required_constitution_exclude):
                return False, ""

        # Optionally narrow by business type
        biz_kws = rule.get("business_contains", [])
        if biz_kws and not _matches_any(biz, biz_kws):
            return False, ""

        return True, rule["reason"]

    # No content rule matched → apply catch-all policy.
    # Obligation-matched clients bypass tag checks here too — they have a real
    # duty to this regulator, so generic circulars from it are always relevant.
    if obligation_matched:
        return True, ""

    catch_all = _CATCH_ALL_POLICY.get(regulator)
    if catch_all:
        required_tags = catch_all.get("required_tags", [])
        if required_tags and not any(t.upper() in client_tags for t in required_tags):
            return False, ""
        required_client_type = catch_all.get("required_client_type")
        if required_client_type:
            if client.get("client_type", "business") != required_client_type:
                return False, ""
        required_constitution = catch_all.get("required_constitution")
        if required_constitution:
            constitution = client.get("profile", {}).get("constitution", "").lower()
            if required_constitution not in constitution:
                return False, ""
    return True, ""


# ─────────────────────────────────────────────
# FALLBACK RULES  (tag/registration-based)
# Used only when obligations[] is empty or absent.
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
            "field":  "registrations.iec_code",
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
            "field":  "registrations.gstin",
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
            "field":  "registrations.tan",
            "check":  "not_null",
            "reason": "Has TAN — TDS filer, income tax circulars apply"
        },
        {
            "field":  "registrations.pan",
            "check":  "not_null",
            "reason": "Has PAN — income tax circulars applicable"
        },
    ],
    "MCA": [
        {
            "field":  "tags:MCA",
            "reason": "MCA-regulated entity"
        },
        {
            "field":  "profile.constitution",
            "check":  "contains",
            "value":  "llp",
            "reason": "Constituted as LLP — MCA/LLP filings applicable"
        },
        {
            "field":  "profile.constitution",
            "check":  "contains",
            "value":  "private limited",
            "reason": "Private Limited Company — MCA compliance applicable"
        },
        {
            "field":  "profile.constitution",
            "check":  "contains",
            "value":  "public limited",
            "reason": "Public Limited Company — MCA compliance applicable"
        },
        {
            "field":  "registrations.cin",
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
            "field":  "profile.industry",
            "check":  "contains",
            "value":  "listed",
            "reason": "Listed company — SEBI circulars directly applicable"
        },
    ],
    "EPFO": [
        {
            "field":  "tags:EPFO",
            "reason": "Tagged as EPFO-registered employer"
        },
        # employee_count intentionally removed — having employees doesn't mean
        # EPFO circulars apply; obligation-driven Stage 2 already catches
        # CLT-002 and CLT-007 via obligations[].regulator == "EPFO".
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

    Four-stage pipeline:
      1. Drop market-ops / statistical releases (no compliance obligation).
      2. Obligation-driven match — primary path, schema-based, no hardcoding.
         Works automatically for any client whose obligations[] is populated.
      3. Fallback: tag + registration field rules (_MATCH_RULES).
         Catches clients with minimal data (no obligations array).
      4. Content filter — narrows by circular topic vs client profile.
         Only applied when a content rule's keywords match the circular text.

    Returns (matched: bool, reason: str)
    """
    # Stage 1 — drop market ops / statistical releases
    if _is_market_ops(title, summary, regulator):
        return False, ""

    # Stage 2 — obligation-driven match (primary, schema-based)
    ob_reason = _obligation_match(client, regulator)
    if ob_reason:
        # Pass obligation_matched=True so tag-based content filters are bypassed.
        # A client with a real obligation to this regulator receives all its circulars.
        content_ok, content_reason = _content_match(title, summary, client, regulator, obligation_matched=True)
        if not content_ok:
            return False, ""
        return True, content_reason or ob_reason

    # Stage 3 — fallback: tag + registration rules
    # Only runs if client has no obligations for this regulator.
    rules = _MATCH_RULES.get(regulator, [])
    fallback_reason = ""
    for rule in rules:
        matched, reason = _client_matches_rule(client, rule)
        if matched:
            fallback_reason = reason
            break

    if not fallback_reason:
        return False, ""

    # Stage 4 — content filter (same for both paths)
    content_ok, content_reason = _content_match(title, summary, client, regulator)
    if not content_ok:
        return False, ""

    return True, content_reason or fallback_reason


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
        regulator      = doc.get("regulator", "Unknown").strip()
        title          = doc.get("title", "Untitled")
        priority       = doc.get("priority", "LOW")
        summary        = doc.get("summary", "")
        url            = doc.get("url", "")
        circular_no    = doc.get("circular_no", doc.get("circular_number", ""))
        published_date = doc.get("published_date", doc.get("date", doc.get("pub_date", "")))
        urgent         = _is_urgent(priority)

        affected: list[dict] = []

        for client in clients:
            try:
                matched, reason = _match_client_to_circular(client, regulator, title=title, summary=summary)
                if matched:
                    profile = client.get("profile", {})
                    affected.append({
                        "client_id":    client["id"],
                        "name":         profile.get("name", client.get("name", "Unknown")),
                        "business_type": profile.get("industry", "Unknown"),
                        "contact_email": profile.get("email", ""),
                        "reason":       reason,
                        "urgent":       urgent
                    })
            except Exception as e:
                cid = client.get("id", "unknown")
                print(f"  Warning: skipping client {cid} due to error: {e}")
                continue

        match_count = len(affected)
        # Abstain flag: circular matched zero clients — out of scope for this
        # client portfolio. Surfaced to the frontend so it can show these as
        # "No clients affected" instead of silently hiding them.
        abstained = match_count == 0
        abstain_reason = (
            f"No clients in this portfolio are affected by this {regulator} circular. "
            "Either no client has the required regulatory tags/obligations, or the circular "
            "is out of scope for the current client set."
        ) if abstained else None

        result = {
            "circular_title":   title,
            "regulator":        regulator,
            "priority":         priority,
            "summary":          summary,
            "url":              url,
            "circular_no":      circular_no,
            "published_date":   published_date,
            "affected_clients": affected,
            "match_count":      match_count,
            "abstained":        abstained,
            "abstain_reason":   abstain_reason,
        }
        results.append(result)

        # Audit log every match event
        log_event(
            agent="ClientMatcher",
            action="clients_matched" if not abstained else "circular_abstained",
            details={
                "circular":      title,
                "regulator":     regulator,
                "priority":      priority,
                "match_count":   match_count,
                "abstained":     abstained,
                "abstain_reason": abstain_reason,
                "client_ids":    [c["client_id"] for c in affected]
            }
        )

    return results


# ─────────────────────────────────────────────
# STANDALONE DEMO
# ─────────────────────────────────────────────

_SIMULATED_DOCS = [
    {
        "regulator":      "RBI",
        "title":          "RBI Circular: FEMA Compliance Deadline Extended – March 2026",
        "url":            "https://www.rbi.org.in/sample/fema_circular_march2026.pdf",
        "circular_no":    "RBI/2025-26/89",
        "published_date": "2026-03-15",
        "filename":       "rbi_fema_circular_march2026.pdf",
        "priority":       "HIGH",
        "summary":        "FEMA reporting deadline for foreign transactions extended by 30 days.",
        "source":         "simulated"
    },
    {
        "regulator":      "GST",
        "title":          "GST Advisory: New Invoice Management System (IMS) – April 2026",
        "url":            "https://www.gst.gov.in/newsandupdates/read/611",
        "circular_no":    "CBIC-20016/2/2024-GST",
        "published_date": "2026-03-10",
        "priority":       "HIGH",
        "summary":        "Invoice Management System mandatory from April 1, 2026 for all GST filers.",
        "source":         "simulated"
    },
    {
        "regulator":      "IncomeTax",
        "title":          "CBDT Circular: TDS Rate Revision – FY 2026-27",
        "url":            "https://incometaxindia.gov.in/communications/circular/circular_2026.pdf",
        "circular_no":    "Circular No. 5/2026",
        "published_date": "2026-03-20",
        "priority":       "MEDIUM",
        "summary":        "TDS rates revised for Section 194C and 194J effective April 2026.",
        "source":         "simulated"
    },
    {
        "regulator":      "MCA",
        "title":          "MCA Notification: LLP Annual Filing Deadline – FY 2025-26",
        "url":            "https://www.mca.gov.in/MinistryV2/notification.html",
        "circular_no":    "G.S.R. 214(E)",
        "published_date": "2026-03-01",
        "priority":       "MEDIUM",
        "summary":        "LLP Form 11 annual return due date extended to July 15, 2026.",
        "source":         "simulated"
    },
    {
        "regulator":      "SEBI",
        "title":          "SEBI Circular: ESG Disclosure Norms for Listed Companies",
        "url":            "https://www.sebi.gov.in/legal/circulars/mar-2026/esg-circular.html",
        "circular_no":    "SEBI/HO/CFD/CMD/CIR/2026/42",
        "published_date": "2026-03-18",
        "priority":       "LOW",
        "summary":        "Enhanced ESG disclosures mandatory for top 1000 listed companies.",
        "source":         "simulated"
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