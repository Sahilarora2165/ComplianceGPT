"""
Drafter Agent — ComplianceGPT
──────────────────────────────
Takes matcher output (circular + affected clients) and generates:
  - Specific executable actions per client
  - Risk level + deadline
  - Client-facing advisory email
  - Internal compliance note
  - Source citations from RAG

Architecture:
  Core unit   : (client × circular) → one draft
  Storage     : backend/data/drafts/{client_id}_{circular_id}.json
  Return      : structured dict (for UI / API)
  Audit trail : every draft logged to audit.jsonl

Public API:
    draft_advisories(match_results: list[dict]) -> list[dict]
    draft_single(circular: dict, client: dict) -> dict

Standalone:
    python agents/drafter_agent.py
"""

import json
import math
import re
import sys
import time
from functools import lru_cache
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

# ── Path setup ─────────────────────────────────────────────────────────────────
_BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.append(str(_BACKEND_DIR))

from groq import Groq
from sentence_transformers import SentenceTransformer, CrossEncoder
from rank_bm25 import BM25Okapi

from config import (
    GROQ_API_KEY, GROQ_MODEL,
    VECTORSTORE_DIR, EMBEDDING_MODEL,
    CHROMA_COLLECTION, TOP_K
)
from core.audit import log_event
from core.chroma_client import get_persistent_client

# ── Multi-Model Configuration ─────────────────────────────────────────────────
# Assign models by priority to maximize free tier usage
# Each model has separate TPD (tokens per day) bucket on Groq free tier
MODEL_BY_PRIORITY = {
    "HIGH":   "llama-3.3-70b-versatile",    # Best quality for critical advisories
    "MEDIUM": "llama-3.1-8b-instant",        # Fast, good quality for routine filings
    "LOW":    "gemma2-9b-it",                # Basic quality for awareness-only
}

# Rate limit retry config
MAX_RETRIES = 3
RETRY_BACKOFF = 5  # seconds

# ── Paths ──────────────────────────────────────────────────────────────────────
DRAFTS_DIR   = _BACKEND_DIR / "data" / "drafts"
DRAFTS_DIR.mkdir(parents=True, exist_ok=True)
CLIENTS_PATH = _BACKEND_DIR / "clients.json"

# ── Models (loaded once at module level — not per call) ────────────────────────
_CROSS_ENCODER_MODEL = "cross-encoder/ms-marco-MiniLM-L-6-v2"


@lru_cache(maxsize=1)
def _get_embed_model() -> Optional[SentenceTransformer]:
    try:
        return SentenceTransformer(EMBEDDING_MODEL)
    except Exception as exc:
        print(f"  Warning: embedding model unavailable ({EMBEDDING_MODEL}): {exc}")
        return None


@lru_cache(maxsize=1)
def _get_cross_encoder() -> Optional[CrossEncoder]:
    try:
        return CrossEncoder(_CROSS_ENCODER_MODEL)
    except Exception as exc:
        print(f"  Warning: cross-encoder unavailable ({_CROSS_ENCODER_MODEL}): {exc}")
        return None


# ─────────────────────────────────────────────
# CIRCULAR ID GENERATOR
# ─────────────────────────────────────────────

def _make_circular_id(regulator: str, title: str, url: str = "") -> str:
    """
    Generate a short stable ID from regulator + title + url hash.
    Example: "RBI_FEMA_COMPLIANCE_DEADLINE_a3f2"
    The 4-char URL hash disambiguates circulars with identical title prefixes
    (e.g. multiple "RBI Imposes Monetary Penalty on..." press releases).
    """
    import hashlib
    slug = re.sub(r"[^a-zA-Z0-9\s]", "", title)
    slug = "_".join(slug.upper().split()[:5])
    url_hash = hashlib.sha256((url or title).encode()).hexdigest()[:4]
    return f"{regulator.upper()}_{slug}_{url_hash}"


# ─────────────────────────────────────────────
# OBLIGATION → RAG QUERY TERM MAP
# Maps obligation codes to domain-specific search terms so the RAG retrieves
# documents relevant to what the client actually needs to act on, rather than
# matching the circular title (which may be a generic penalty notice).
# ─────────────────────────────────────────────

_OBLIGATION_QUERY_TERMS: dict[str, str] = {
    "GST_GSTR3B":             "GSTR-3B monthly return input tax credit GST filing",
    "GST_GSTR1":              "GSTR-1 outward supply invoice details",
    "GST_GSTR9":              "GSTR-9 annual return GST",
    "GST_GSTR9C":             "GSTR-9C reconciliation statement GST audit",
    "GST_LUT":                "LUT letter of undertaking zero-rated export RFD-11",
    "FEMA_SOFTEX":            "SOFTEX foreign exchange FEMA export proceeds realisation 180 days authorised dealer",
    "FEMA_NRI_PROPERTY":      "NRI foreign exchange FEMA property remittance repatriation",
    "RBI_MONTHLY_RETURN":     "NBFC NBS-9 monthly return RBI regulatory return filing",
    "RBI_NBFC_GOVERNANCE":    "NBFC governance KYC RBI direction compliance",
    "MCA_AOC4":               "AOC-4 annual accounts filing MCA company balance sheet",
    "MCA_MGT7":               "MGT-7 annual return MCA company shareholders",
    "MCA_LLP11":              "Form 11 LLP annual return designated partners",
    "MCA_LLP8":               "Form 8 statement of account solvency LLP",
    "TDS_24Q":                "TDS 24Q salary deduction quarterly return deductor",
    "TDS_26Q":                "TDS 26Q non-salary Section 194 contractor professional deductor",
    "IT_SCRUTINY_REPLY":      "income tax scrutiny notice Section 143(2) 148 reply assessment",
    "IT_TP_REPORT":           "transfer pricing Form 3CEB international transaction arm's length associated enterprise",
    "IT_ADVANCE_TAX":         "advance tax payment installment self-assessment income tax",
    "IT_ADVANCE_TAX_Q4":      "advance tax Q4 installment March 15 payment",
    "IT_ITR_FILING":          "ITR income tax return filing assessment year",
    "IT_FORM16":              "Form 16 TDS certificate salary employer",
    "IT_80C_TOPUP":           "Section 80C deduction investment tax saving ELSS PPF",
    "IT_TDS_RENTAL_REFUND":   "TDS rental income NRI refund Section 195 DTAA excess deduction",
    "PF_ECR":                 "EPF provident fund ECR monthly electronic challan return wage",
    "SEBI_HALF_YEARLY_AUDIT": "SEBI stock broker half-yearly audit trading member",
    "ESIC_CONTRIBUTION":      "ESIC employee state insurance contribution monthly",
}


def _build_rag_query(circular: dict, client: dict) -> str:
    """
    Build an obligation-driven RAG query.

    Combines circular regulator + key title/summary terms with domain-specific
    keywords derived from the client's own obligation codes for that regulator.
    This retrieves documents relevant to what the client actually needs to act on
    rather than matching the generic circular title
    (e.g. "RBI penalty" → retrieves penalty PDF for all clients
     vs   "FEMA SOFTEX export proceeds authorised dealer" → retrieves FEMA circular).
    """
    regulator    = circular.get("regulator", "")
    title_terms  = circular.get("title", "")
    summary_terms = circular.get("summary", "")

    # Obligation-code-based keywords for this regulator
    relevant_obs = [
        o for o in client.get("obligations", [])
        if o.get("regulator", "").upper() == regulator.upper()
    ]
    ob_terms = " ".join(
        _OBLIGATION_QUERY_TERMS.get(o.get("code", ""), "")
        for o in relevant_obs
    ).strip()

    # Fallback: use industry + constitution when no obligations found
    if not ob_terms:
        profile  = client.get("profile", {})
        ob_terms = f"{profile.get('industry', '')} {profile.get('constitution', '')}"

    return f"{regulator} {title_terms} {summary_terms} {ob_terms}".strip()


# Minimum cross-encoder relevance score for RAG context to be used.
# sigmoid(-2.5) ≈ 0.076 — below this the retrieved chunks are not meaningfully
# related to the client's obligations and should be discarded rather than
# misleading the LLM into generating circular-irrelevant actions.
_RAG_RELEVANCE_THRESHOLD = -2.5


# ─────────────────────────────────────────────
# RAG CONTEXT RETRIEVER (internal, drafter-specific)
# ─────────────────────────────────────────────

def _retrieve_context(
    query: str,
    regulator: Optional[str] = None,
    top_k: int = TOP_K
) -> tuple[str, list[dict], float]:
    """
    Pull relevant chunks from ChromaDB using hybrid search
    (vector + BM25 + cross-encoder rerank).

    Returns:
        context_text : formatted string for LLM prompt
        sources      : list of {source, page, score}
    """
    client     = get_persistent_client(VECTORSTORE_DIR)
    collection = client.get_or_create_collection(name=CHROMA_COLLECTION)

    if collection.count() == 0:
        return "", [], -999.0

    embed_model = _get_embed_model()
    if embed_model is None:
        return "", [], -999.0

    fetch_k = min(50, collection.count())

    # ── Vector search ──────────────────────────────────────────────────────
    q_emb   = embed_model.encode([query]).tolist()
    results = collection.query(
        query_embeddings=q_emb,
        n_results=fetch_k,
        include=["documents", "metadatas", "distances"]
    )
    vector_chunks: dict[str, dict] = {}
    for doc, meta, dist, cid in zip(
        results["documents"][0],
        results["metadatas"][0],
        results["distances"][0],
        results["ids"][0]
    ):
        if cid not in vector_chunks or dist < vector_chunks[cid]["dist"]:
            vector_chunks[cid] = {"doc": doc, "meta": meta, "dist": dist, "id": cid}

    # ── BM25 search ────────────────────────────────────────────────────────
    corpus        = collection.get(include=["documents", "metadatas"])
    corpus_docs   = corpus["documents"]
    corpus_metas  = corpus["metadatas"]
    corpus_ids    = corpus["ids"]

    bm25        = BM25Okapi([d.lower().split() for d in corpus_docs])
    bm25_scores = bm25.get_scores(query.lower().split())
    top_idx     = sorted(range(len(bm25_scores)), key=lambda i: bm25_scores[i], reverse=True)[:fetch_k]

    bm25_chunks: dict[str, dict] = {}
    for idx in top_idx:
        cid = corpus_ids[idx]
        if cid not in bm25_chunks or bm25_scores[idx] > bm25_chunks[cid].get("score", 0):
            bm25_chunks[cid] = {
                "doc": corpus_docs[idx], "meta": corpus_metas[idx],
                "score": bm25_scores[idx], "id": cid
            }

    # ── RRF merge ──────────────────────────────────────────────────────────
    RRF_K  = 60
    scores = {}
    for rank, entry in enumerate(sorted(vector_chunks.values(), key=lambda x: x["dist"])):
        scores[entry["id"]] = scores.get(entry["id"], 0) + 1 / (RRF_K + rank + 1)
    for rank, entry in enumerate(sorted(bm25_chunks.values(), key=lambda x: -x["score"])):
        scores[entry["id"]] = scores.get(entry["id"], 0) + 1 / (RRF_K + rank + 1)

    all_candidates = {**vector_chunks, **bm25_chunks}
    candidates = [
        {"doc": v["doc"], "meta": v["meta"], "rrf": scores.get(k, 0)}
        for k, v in all_candidates.items()
    ]

    # ── Cross-encoder rerank ───────────────────────────────────────────────
    if candidates:
        cross_encoder = _get_cross_encoder()
        if cross_encoder is not None:
            ce_scores = cross_encoder.predict([(query, c["doc"]) for c in candidates])
            for i, c in enumerate(candidates):
                c["ce_score"] = float(ce_scores[i])
            candidates = sorted(candidates, key=lambda x: x["ce_score"], reverse=True)[:top_k]
        else:
            for c in candidates:
                c["ce_score"] = float(c.get("rrf", 0))
            candidates = sorted(candidates, key=lambda x: x["rrf"], reverse=True)[:top_k]

    # ── Regulator filter ───────────────────────────────────────────────────
    if regulator:
        regulator_keywords = {
            "RBI": ["rbi", "fema"],
            "GST": ["gst"],
            "INCOMETAX": ["incometax", "cbdt"],
            "MCA": ["mca"],
            "SEBI": ["sebi"],
        }
        keywords = regulator_keywords.get(str(regulator).upper(), [str(regulator).lower()])
        candidates = [
            c for c in candidates
            if any(
                keyword in str(c.get("meta", {}).get("source", "")).lower()
                for keyword in keywords
            )
        ]
        if not candidates:
            return "", [], -999.0

    # ── Build context string ───────────────────────────────────────────────
    def sigmoid(x): return 1 / (1 + math.exp(-x))

    top_ce_score  = candidates[0]["ce_score"] if candidates else -999.0
    context_parts = []
    sources       = []
    for c in candidates:
        score = round(sigmoid(c["ce_score"]), 4)
        context_parts.append(
            f"[Source: {c['meta']['source']}, Page: {c['meta']['page']}, Score: {score}]\n{c['doc']}"
        )
        sources.append({
            "source": c["meta"]["source"],
            "page":   c["meta"]["page"],
            "score":  score
        })

    return "\n\n---\n\n".join(context_parts), sources, top_ce_score


# ─────────────────────────────────────────────
# CLIENT PROFILE HELPERS
# ─────────────────────────────────────────────

def _compute_flags(client: dict) -> list[str]:
    """
    Pre-compute actionable flags from client data.
    Injected into the LLM prompt so the model doesn't have to do arithmetic.
    """
    from datetime import date as _date
    flags = []
    today = _date.today()

    fin = client.get("financials", {})
    cs  = client.get("compliance_state", {})

    # ── FEMA breach risk ────────────────────────────────────────────────────
    oldest_age = fin.get("oldest_invoice_age_days") or 0
    unrealised = fin.get("unrealised_forex_amount") or 0
    if oldest_age > 0 and unrealised > 0:
        remaining = 180 - oldest_age
        if remaining <= 0:
            flags.append(
                f"FEMA BREACH: Oldest invoice {oldest_age} days — 180-day limit already exceeded. "
                f"Unrealised ₹{unrealised:,}. Compounding application risk."
            )
        elif remaining <= 30:
            flags.append(
                f"FEMA BREACH RISK: Oldest invoice {oldest_age} days — only {remaining} days to 180-day limit. "
                f"Unrealised ₹{unrealised:,} via {cs.get('ad_bank', 'AD bank')}."
            )
        else:
            flags.append(
                f"FEMA WATCH: Unrealised forex ₹{unrealised:,}, oldest invoice {oldest_age} days."
            )

    # ── LUT expiry ──────────────────────────────────────────────────────────
    lut = cs.get("lut_expiry_date")
    if lut:
        try:
            gap = (_date.fromisoformat(lut) - today).days
            if gap <= 0:
                flags.append(
                    f"LUT EXPIRED on {lut}: All exports now attracting 18% IGST — file RFD-11 immediately."
                )
            elif gap <= 14:
                flags.append(
                    f"LUT EXPIRING IN {gap} DAYS ({lut}): File RFD-11 immediately to continue zero-rated exports."
                )
        except ValueError:
            pass

    # ── MCA overdue filings ─────────────────────────────────────────────────
    CURRENT_FY = "FY2023-24"
    for field, form in [
        ("last_aoc4_filed",  "AOC-4"),
        ("last_mgt7_filed",  "MGT-7"),
        ("last_llp11_filed", "LLP Form 11"),
        ("last_llp8_filed",  "LLP Form 8"),
    ]:
        last = cs.get(field)
        if last and last < CURRENT_FY:
            flags.append(
                f"MCA OVERDUE: {form} last filed for {last} — FY2023-24 filing overdue, ₹100/day penalty accruing."
            )

    # ── Tax audit ───────────────────────────────────────────────────────────
    turnover = fin.get("turnover") or 0
    if cs.get("tax_audit_required"):
        flags.append(f"TAX AUDIT REQUIRED: 3CD/3CB mandatory (turnover ₹{turnover:,}).")
    elif turnover > 10_000_000:
        flags.append(f"TAX AUDIT REQUIRED: Turnover ₹{turnover:,} exceeds ₹1Cr threshold.")

    # ── GST audit + e-invoicing ─────────────────────────────────────────────
    if turnover > 20_000_000:
        flags.append(f"GST AUDIT REQUIRED: Turnover ₹{turnover:,} exceeds ₹2Cr — GSTR-9C mandatory.")
    if turnover > 50_000_000:
        flags.append(f"E-INVOICING MANDATORY: Turnover ₹{turnover:,} exceeds ₹5Cr threshold.")

    # ── Transfer pricing ────────────────────────────────────────────────────
    if cs.get("transfer_pricing_applicable"):
        flags.append("TRANSFER PRICING: Form 3CEB required — related party international transactions exist.")

    # ── Scrutiny ────────────────────────────────────────────────────────────
    scrutiny = cs.get("scrutiny", {})
    if scrutiny and scrutiny.get("status") not in ("none", None, ""):
        flags.append(
            f"SCRUTINY ACTIVE: {scrutiny['status']} under Section {scrutiny.get('section')} "
            f"for AY {scrutiny.get('assessment_year')} — reply due {scrutiny.get('reply_due_date')}."
        )

    # ── Employee thresholds ─────────────────────────────────────────────────
    emp = cs.get("employee_count") or 0
    if emp >= 20:
        flags.append(f"PF APPLICABLE: {emp} employees exceed 20-person EPF threshold.")
    if emp >= 10:
        flags.append(f"ESIC APPLICABLE: {emp} employees exceed 10-person ESIC threshold.")

    return flags


def _build_client_profile(client: dict, regulator: str) -> str:
    """
    Build a regulator-aware client profile string for the LLM prompt.
    Injects only fields relevant to the circular's regulator — reduces noise,
    improves action specificity.
    """
    profile     = client.get("profile", {})
    regs        = client.get("registrations", {})
    fin         = client.get("financials", {})
    cs          = client.get("compliance_state", {})
    obligations = client.get("obligations", [])
    client_type = client.get("client_type", "business")

    lines = [
        f"Client Name    : {profile.get('name', 'Unknown')}",
        f"Client Type    : {client_type}",
        f"Constitution   : {profile.get('constitution', 'Unknown')}",
        f"Industry       : {profile.get('industry', 'Unknown')}",
        f"Priority       : {profile.get('priority', 'MEDIUM')}",
        f"Email          : {profile.get('email', '')}",
        f"Address        : {profile.get('address', 'Not provided')}",
    ]

    # ── Pre-computed flags (scoped to this regulator only) ──────────────────
    _FLAG_REGULATOR_MAP = {
        "FEMA":       {"RBI", "FEMA"},
        "LUT":        {"GST"},
        "MCA":        {"MCA"},
        "TAX AUDIT":  {"INCOMETAX"},
        "GST AUDIT":  {"GST"},
        "E-INVOICING":{"GST"},
        "TRANSFER PRICING": {"INCOMETAX"},
        "SCRUTINY":   {"INCOMETAX"},
        "PF ":        {"EPFO"},
        "ESIC":       {"EPFO"},
    }
    all_flags = _compute_flags(client)
    reg_upper = regulator.upper()
    flags = []
    for flag in all_flags:
        flag_upper = flag.upper()
        allowed = next(
            (regs for prefix, regs in _FLAG_REGULATOR_MAP.items() if flag_upper.startswith(prefix)),
            None
        )
        if allowed is None or reg_upper in allowed:
            flags.append(flag)
    if flags:
        lines.append("\nPRE-COMPUTED FLAGS (use exact amounts/dates from these in your actions):")
        for flag in flags:
            lines.append(f"  ! {flag}")

    # ── Regulator-specific context ──────────────────────────────────────────
    reg = regulator.upper()

    if reg == "GST":
        lines.append("\nGST CONTEXT:")
        lines.append(f"  GSTIN            : {regs.get('gstin', 'Not registered')}")
        lines.append(f"  Filing Frequency : {cs.get('gst_filing_frequency', 'Monthly')}")
        if cs.get("lut_expiry_date"):
            lines.append(f"  LUT Expiry       : {cs['lut_expiry_date']}")
        gst_obs = [
            o for o in obligations
            if o.get("regulator") == "GST" and o.get("status") in ("pending", "overdue", "critical")
        ]
        if gst_obs:
            lines.append("  Pending GST Filings:")
            for o in gst_obs:
                lines.append(
                    f"    - {o['code']}: periods [{', '.join(o['periods'])}] "
                    f"| due {o['due_date']} | penalty: {o['penalty']}"
                )

    elif reg == "RBI":
        lines.append("\nFEMA/RBI CONTEXT:")
        lines.append(f"  IEC Code         : {regs.get('iec_code', 'Not applicable')}")
        lines.append(f"  AD Bank          : {cs.get('ad_bank', 'Not specified')}")
        lines.append(f"  Unrealised Forex : ₹{(fin.get('unrealised_forex_amount') or 0):,}")
        lines.append(f"  Oldest Invoice   : {fin.get('oldest_invoice_age_days', 0)} days old")
        rbi_obs = [
            o for o in obligations
            if o.get("regulator") == "RBI" and o.get("status") in ("pending", "overdue", "critical")
        ]
        if rbi_obs:
            lines.append("  Pending RBI/FEMA Obligations:")
            for o in rbi_obs:
                lines.append(
                    f"    - {o['code']}: [{', '.join(o['periods'])}] "
                    f"| due {o['due_date']} | penalty: {o['penalty']}"
                )

    elif reg == "INCOMETAX":
        lines.append("\nINCOME TAX CONTEXT:")
        lines.append(f"  PAN              : {regs.get('pan', 'Not provided')}")
        lines.append(f"  TAN              : {regs.get('tan', 'N/A')}")
        if client_type == "business":
            lines.append(f"  Turnover         : ₹{(fin.get('turnover') or 0):,}")
            lines.append(f"  Tax Audit Req.   : {cs.get('tax_audit_required', False)}")
            lines.append(f"  Transfer Pricing : {cs.get('transfer_pricing_applicable', False)}")
            lines.append(f"  Advance Tax Paid : ₹{(fin.get('advance_tax_paid') or 0):,}")
        else:
            tc = client.get("tax_context", {})
            lines.append(f"  FY / AY          : {tc.get('financial_year')} / {tc.get('assessment_year')}")
            lines.append(f"  Salary Income    : ₹{(tc.get('salary_income') or 0):,}")
            lines.append(
                f"  Capital Gains    : STCG ₹{(tc.get('capital_gains_stcg') or 0):,} "
                f"| LTCG ₹{(tc.get('capital_gains_ltcg') or 0):,}"
            )
            lines.append(f"  Rental Income    : ₹{(tc.get('rental_income') or 0):,}")
            lines.append(f"  Foreign Income   : ₹{(tc.get('foreign_income') or 0):,}")
            lines.append(f"  NRI Status       : {profile.get('nri_status', False)}")
            lines.append(f"  DTAA Applicable  : {cs.get('dtaa_applicable', False)}")
            if cs.get("dtaa_country"):
                lines.append(f"  DTAA Country     : {cs['dtaa_country']} ({cs.get('dtaa_article', '')})")
            deductions = client.get("deductions", {})
            lines.append(
                f"  80C Invested     : ₹{(deductions.get('investments_80c') or 0):,} "
                f"(limit ₹1,50,000)"
            )
            lines.append(f"  80D Premium      : ₹{(deductions.get('premium_80d') or 0):,}")
            lines.append(f"  ITR Form         : {cs.get('itr_form', 'Unknown')}")
            lines.append(f"  Filing Status    : {cs.get('filing_status', 'unknown')}")
            lines.append(f"  Advance Tax Paid : ₹{(cs.get('advance_tax_paid') or 0):,}")
            if cs.get("pending_refund"):
                lines.append(f"  Pending Refund   : ₹{cs['pending_refund']:,}")
            if cs.get("form16_received") is False:
                lines.append(f"  Form 16          : NOT YET RECEIVED from {cs.get('employer_name', 'employer')}")
            if cs.get("tds_deducted_by_clients"):
                lines.append(f"  TDS by Clients   : ₹{cs['tds_deducted_by_clients']:,} (verify via Form 26AS)")
            if cs.get("presumptive_scheme"):
                lines.append(f"  Presumptive Scheme: {cs['presumptive_scheme']}")
        scrutiny = cs.get("scrutiny", {})
        if scrutiny and scrutiny.get("status") not in ("none", None, ""):
            lines.append(
                f"  Scrutiny         : {scrutiny['status']} | Section {scrutiny.get('section')} "
                f"| AY {scrutiny.get('assessment_year')} | Due {scrutiny.get('reply_due_date')}"
            )
        it_obs = [
            o for o in obligations
            if o.get("regulator") == "IncomeTax" and o.get("status") in ("pending", "overdue", "action_needed")
        ]
        if it_obs:
            lines.append("  Pending IT Actions:")
            for o in it_obs:
                lines.append(
                    f"    - {o['code']}: [{', '.join(o['periods'])}] "
                    f"| due {o['due_date']} | {o.get('penalty', '')}"
                )

    elif reg == "MCA":
        lines.append("\nMCA CONTEXT:")
        lines.append(f"  CIN              : {regs.get('cin', 'N/A')}")
        if regs.get("llpin"):
            lines.append(f"  LLPIN            : {regs['llpin']}")
        constitution = profile.get("constitution", "").lower()
        if "llp" in constitution:
            lines.append(f"  Last LLP-11 Filed: {cs.get('last_llp11_filed', 'Never')}")
            lines.append(f"  Last LLP-8 Filed : {cs.get('last_llp8_filed', 'Never')}")
        else:
            lines.append(f"  Last AOC-4 Filed : {cs.get('last_aoc4_filed', 'Never')}")
            lines.append(f"  Last MGT-7 Filed : {cs.get('last_mgt7_filed', 'Never')}")
        mca_obs = [
            o for o in obligations
            if o.get("regulator") == "MCA" and o.get("status") in ("pending", "overdue")
        ]
        if mca_obs:
            lines.append("  Pending MCA Filings:")
            for o in mca_obs:
                lines.append(
                    f"    - {o['code']}: [{', '.join(o['periods'])}] "
                    f"| due {o['due_date']} | penalty: {o['penalty']}"
                )

    elif reg == "SEBI":
        lines.append("\nSEBI CONTEXT:")
        sebi_obs = [
            o for o in obligations
            if o.get("regulator") == "SEBI" and o.get("status") in ("pending", "overdue")
        ]
        if sebi_obs:
            lines.append("  Pending SEBI Obligations:")
            for o in sebi_obs:
                lines.append(
                    f"    - {o['code']}: [{', '.join(o['periods'])}] "
                    f"| due {o['due_date']} | penalty: {o['penalty']}"
                )

    # ── Always include tags + notes ─────────────────────────────────────────
    tags = client.get("tags", [])
    if tags:
        lines.append(f"\nRegulatory Tags : {', '.join(tags)}")
    notes = client.get("notes", "")
    if notes:
        lines.append(f"CA Notes        : {notes}")

    return "\n".join(lines)


# ─────────────────────────────────────────────
# OBLIGATION EXTRACTOR
# ─────────────────────────────────────────────

def _extract_obligations(
    circular: dict,
    client: dict,
    context: str
) -> dict:
    """
    Step 1 of drafting: ask LLM to extract specific obligations
    for THIS client from the circular text.
    Returns structured JSON with actions, deadline, risk.
    """
    # Select model based on circular priority
    priority = circular.get("priority", "MEDIUM")
    model = MODEL_BY_PRIORITY.get(priority, "llama-3.1-8b-instant")
    groq = Groq(api_key=GROQ_API_KEY)

    client_profile = _build_client_profile(client, circular["regulator"])

    has_context = bool(context.strip())
    context_section = f"""
REGULATORY DOCUMENT EXCERPTS (from ingested PDFs):
{context}
""" if has_context else """
NOTE: No matching regulatory documents found in the knowledge base.
Use your knowledge of Indian compliance regulations to generate obligations.
"""

    prompt = f"""You are a senior compliance officer at an Indian CA firm.

CIRCULAR DETAILS:
Regulator : {circular['regulator']}
Title     : {circular['title']}
Summary   : {circular['summary']}
Priority  : {circular['priority']}

CLIENT PROFILE:
{client_profile}

{context_section}

TASK:
Based on the circular and client profile above, extract SPECIFIC EXECUTABLE obligations for THIS client only.

RULES:
1. Actions must be SPECIFIC to THIS client — include form names, section numbers, deadlines where available
2. Bad: "Comply with RBI guidelines" / "Review the circular" / "File appeals if applicable"
   Good: "Submit SOFTEX form for each export invoice to the bank within 30 days — required as Arvind Textiles is a goods exporter under FEMA"
3. Each action must be something a CA can put on a task list TODAY for this specific client
4. Think about what makes this client DIFFERENT — use the PRE-COMPUTED FLAGS and pending obligations from the CLIENT PROFILE above:
   - Industry: {client.get('profile', {}).get('industry', 'Unknown')}
   - Constitution: {client.get('profile', {}).get('constitution', 'Unknown')}
   - Special notes: {client.get('notes', 'None')}
   - Use exact amounts, invoice counts, and dates from the flags — do NOT be generic
5. SKIP any action that would be IDENTICAL for every GST/RBI registered business — those are not client-specific advisories
6. If this circular has NO direct, specific impact on this client beyond general awareness, return exactly ONE action: "Note for awareness — no immediate action required for {client.get('profile', {}).get('name', client.get('name', ''))}"
7. CONSTITUTION CHECK — CRITICAL: Before suggesting any filing or form, verify it matches the client's constitution. The client's constitution is {client.get('profile', {}).get('constitution', 'Unknown')}. LLP forms (Form 11, Form 8, LLP Annual Return) must NEVER be suggested for a Private Limited or Public Limited company. AOC-4 and MGT-7 are only for companies, never for LLPs or proprietorships. If the circular is about LLP filings and this client is NOT an LLP, return exactly ONE action: "Note for awareness — not applicable to {client.get('profile', {}).get('name', '')} as it is a {client.get('profile', {}).get('constitution', '')}, not an LLP." Do not suggest any filing action.
8. REGULATOR BOUNDARY — CRITICAL: Only suggest actions directly related to the circular's regulator ({circular['regulator']}). Do NOT suggest RBI/FEMA/SOFTEX actions inside a GST or IncomeTax circular. Do NOT suggest GST actions inside an RBI circular. Each draft must stay strictly within the boundary of its regulator.
9. NO MIXING — CRITICAL: Never include "Note for awareness — no immediate action required" as one of multiple actions. It is only valid as the SOLE action when the circular has zero direct impact on this client. If you have identified at least one real, specific action for this client, do NOT add an awareness note alongside it. Either the client has a compliance obligation (list only the real actions) or they don't (list only the awareness note). Never both.

DEADLINE EXTRACTION — CRITICAL INSTRUCTIONS:
You MUST return the deadline in ONE of these FOUR formats ONLY:

1. ISO DATE (when circular states explicit date):
   - Format: YYYY-MM-DD
   - Examples: "2026-04-01", "2026-07-31", "2026-10-30"
   - Use when: Circular says "due on April 1, 2026" or "deadline is 2026-04-01"

2. RELATIVE:N (when deadline is N days from circular date):
   - Format: RELATIVE:number_of_days
   - Examples: "RELATIVE:30", "RELATIVE:180", "RELATIVE:60"
   - Use when: Circular says "within 30 days", "60 days from date of this circular"
   - Common for: FEMA declarations (180 days), RBI export filings (30 days)

3. PERIODIC:FREQ:DAY (for recurring obligations — USE YOUR REGULATORY KNOWLEDGE):
   - Format: PERIODIC:MONTHLY:15 or PERIODIC:QUARTERLY:30 or PERIODIC:YEARLY:07-31
   - Examples: 
     * GSTR-3B → "PERIODIC:MONTHLY:20" (20th of every month)
     * TDS → "PERIODIC:MONTHLY:7" (7th of every month)
     * ITR → "PERIODIC:YEARLY:07-31" (31st July)
     * SOFTEX → "PERIODIC:MONTHLY:15" (15th of every month)
     * LLP Annual → "PERIODIC:YEARLY:10-30" (30th October)
   - CRITICAL: For known recurring Indian compliance (GST, TDS, PF, ESI, MCA filings), 
     you MUST use PERIODIC format even if circular doesn't explicitly state the date.
     Use your regulatory knowledge — CAs expect the system to know these deadlines.

4. null (ONLY when genuinely no deadline exists):
   - Use null when: Circular is purely informational, advisory with no action required
   - Do NOT use null just because you're uncertain — use PERIODIC with your best estimate
   - Examples: "Clarification on existing rules" with no new requirement

DEADLINE DECISION TREE:
- Does circular mention explicit date? → ISO DATE (2026-04-01)
- Does it say "within X days"? → RELATIVE:X
- Is this a recurring filing (GST/TDS/PF/ESI/MCA)? → PERIODIC (use your knowledge)
- Is it purely informational? → null

RISK LEVEL:
- HIGH: Penalty > ₹1L, license risk, criminal liability, SEBI/RBI enforcement
- MEDIUM: Specific filing/action required, monetary penalty possible
- LOW: Advisory/awareness only, no immediate penalty

PENALTY:
- State exact penalty from circular if available
- If not stated, use "Not specified in circular"
- Do NOT make up penalty amounts

APPLICABLE SECTIONS:
- List specific sections/rules from circular
- If none mentioned, return empty array []

INTERNAL NOTES:
- Flag CA-only red flags, cross-checks needed, dependencies
- Mention if deadline was estimated vs explicit
- Note any client-specific considerations

Return ONLY valid JSON, no explanation, no markdown:
{{
  "actions": [
    "Action 1 — specific and executable",
    "Action 2 — specific and executable"
  ],
  "deadline": "2026-04-01 or RELATIVE:30 or PERIODIC:MONTHLY:20 or null",
  "risk_level": "HIGH|MEDIUM|LOW",
  "penalty_if_missed": "exact penalty or 'Not specified in circular'",
  "applicable_sections": ["Section X", "Rule Y"],
  "internal_notes": "CA notes — deadline was [explicit/estimated], cross-checks needed"
}}"""

    # Retry logic with exponential backoff for rate limits
    last_error = None
    for attempt in range(MAX_RETRIES):
        try:
            response = groq.chat.completions.create(
                model=model,  # Use priority-based model
                messages=[{"role": "user", "content": prompt}],
                temperature=0.1,
                max_tokens=1000
            )
            break  # Success — exit retry loop
        except Exception as e:
            error_msg = str(e)
            if "429" in error_msg or "rate limit" in error_msg.lower():
                last_error = e
                if attempt < MAX_RETRIES - 1:
                    wait_time = RETRY_BACKOFF * (2 ** attempt)  # Exponential backoff
                    print(f"     ⏳ Rate limit hit — retrying in {wait_time}s (attempt {attempt+1}/{MAX_RETRIES})")
                    time.sleep(wait_time)
                continue
            else:
                # Non-rate-limit error — don't retry
                raise

    # If all retries failed
    if last_error:
        raise last_error

    raw = response.choices[0].message.content.strip()

    # Strip markdown fences if present
    raw = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.MULTILINE)
    raw = re.sub(r"\s*```$",          "", raw, flags=re.MULTILINE)

    try:
        return json.loads(raw.strip())
    except json.JSONDecodeError:
        # Fallback if LLM returns malformed JSON
        return {
            "actions":             ["Review circular and take appropriate action"],
            "deadline":            "As per regulatory guidelines",
            "risk_level":          circular.get("priority", "MEDIUM"),
            "penalty_if_missed":   "Not specified",
            "applicable_sections": [],
            "internal_notes":      f"JSON parse failed. Raw LLM output: {raw[:300]}"
        }


# ─────────────────────────────────────────────
# EMAIL DRAFTER
# ─────────────────────────────────────────────

def _draft_email(
    circular: dict,
    client: dict,
    obligations: dict,
    priority: str = "MEDIUM"
) -> tuple[str, str]:
    """
    Step 2 of drafting: generate client advisory email + subject line.
    Returns (subject, email_body).
    """
    # Select model based on priority
    model = MODEL_BY_PRIORITY.get(priority, "llama-3.1-8b-instant")
    groq = Groq(api_key=GROQ_API_KEY)

    actions_text = "\n".join(f"  {i+1}. {a}" for i, a in enumerate(obligations["actions"]))

    _p = client.get("profile", {})
    primary_person = _p.get("name", "Sir/Madam")

    prompt = f"""You are a CA (Chartered Accountant) writing a formal compliance advisory email to a client.

CIRCULAR: {circular['title']}
REGULATOR: {circular['regulator']}
CLIENT: {_p.get('name', '')} ({_p.get('industry', 'Unknown')})
CONTACT PERSON: {primary_person}

REQUIRED ACTIONS FOR THIS CLIENT:
{actions_text}

DEADLINE: {obligations['deadline']}
RISK LEVEL: {obligations['risk_level']}
PENALTY IF MISSED: {obligations['penalty_if_missed']}

Write a formal advisory email. Rules:
1. Address by name — not "Dear Client"
2. Explain WHY this applies to them specifically (1-2 sentences max)
3. List actions clearly and numbered — no vague language
4. State the deadline prominently
5. Mention penalty briefly if HIGH risk
6. Professional closing — offer to assist
7. Sign as: "Compliance Advisory Team"
8. Keep it under 300 words — CAs are busy

Return ONLY valid JSON, no explanation:
{{
  "subject": "email subject line here",
  "body": "full email body here"
}}"""

    response = groq.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.2,
        max_tokens=800
    )

    raw = response.choices[0].message.content.strip()
    raw = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.MULTILINE)
    raw = re.sub(r"\s*```$",          "", raw, flags=re.MULTILINE)

    try:
        parsed  = json.loads(raw.strip())
        subject = parsed.get("subject", f"Compliance Advisory: {circular['title']}")
        body    = parsed.get("body", raw)
        return subject, body
    except json.JSONDecodeError:
        subject = f"Compliance Advisory: {circular['title']}"
        return subject, raw


# ─────────────────────────────────────────────
# DRAFT PERSISTENCE
# ─────────────────────────────────────────────

def _save_draft(draft: dict) -> Path:
    """
    Save draft as JSON to backend/data/drafts/{client_id}_{circular_id}.json
    Returns the saved file path.
    """
    DRAFTS_DIR.mkdir(parents=True, exist_ok=True)
    filename = f"{draft['client_id']}_{draft['circular_id']}.json"
    path     = DRAFTS_DIR / filename
    path.write_text(json.dumps(draft, indent=2, ensure_ascii=False), encoding="utf-8")
    return path


# ─────────────────────────────────────────────
# CORE: DRAFT SINGLE (client × circular)
# ─────────────────────────────────────────────

def draft_single(circular: dict, client: dict) -> dict:
    """
    Generate one complete draft for a single (client, circular) pair.

    Returns audit-grade dict:
    {
        "draft_id":          str,
        "client_id":         str,
        "client_name":       str,
        "circular_id":       str,
        "circular_title":    str,
        "regulator":         str,
        "priority":          str,
        "actions":           list[str],
        "deadline":          str,
        "risk_level":        str,
        "penalty_if_missed": str,
        "applicable_sections": list[str],
        "email_subject":     str,
        "email_body":        str,
        "internal_notes":    str,
        "source_chunks":     list[dict],
        "model_used":        str,
        "generated_at":      str,
        "version":           str,
        "status":            "pending_review"
    }
    """
    circular_id = _make_circular_id(circular["regulator"], circular["title"], circular.get("url", ""))
    client_id   = client["id"]
    draft_id    = f"{client_id}_{circular_id}"

    print(f"\n  ✍️  Drafting: {client.get('profile', {}).get('name', client.get('name', '?'))} × {circular['regulator']}")

    # Step 1: retrieve relevant context from ChromaDB
    # Use obligation-driven query so each client pulls chunks relevant to their specific obligations
    query = _build_rag_query(circular, client)
    context, sources, top_ce_score = _retrieve_context(query, regulator=circular["regulator"])

    if sources and top_ce_score >= _RAG_RELEVANCE_THRESHOLD:
        print(f"     📚 RAG: {len(sources)} chunk(s) retrieved from {sources[0]['source']} (score={top_ce_score:.2f})")
    elif sources:
        print(f"     ⚠️  RAG: low relevance (score={top_ce_score:.2f}) — context cleared, using LLM knowledge only")
        context = ""
        sources = []
    else:
        print(f"     ⚠️  RAG: no matching chunks — using LLM knowledge only")

    # Step 2: extract obligations
    obligations = _extract_obligations(circular, client, context)
    
    # LAYER 2: Parse and validate deadline format
    from core.deadline_parser import parse_deadline
    circular_date = None  # Could extract from circular metadata if available
    parsed_deadline, deadline_format, deadline_explanation = parse_deadline(
        obligations.get("deadline", ""),
        circular["regulator"],
        circular["title"],
        circular_date
    )
    
    # Store both raw and parsed deadline
    obligations["deadline_raw"] = obligations.get("deadline", "")
    obligations["deadline"] = parsed_deadline.isoformat() if parsed_deadline else None
    obligations["deadline_format"] = deadline_format
    obligations["deadline_explanation"] = deadline_explanation
    
    print(f"     ✅ {len(obligations['actions'])} action(s) | Risk: {obligations['risk_level']} | Deadline: {obligations['deadline']} ({deadline_format})")
    for i, action in enumerate(obligations["actions"], 1):
        print(f"        {i}. {action}")

    # Step 3: draft email (with priority-based model selection)
    priority = circular.get("priority", "MEDIUM")
    model = MODEL_BY_PRIORITY.get(priority, "llama-3.1-8b-instant")
    subject, body = _draft_email(circular, client, obligations, priority)

    # Step 4: assemble full draft
    _p = client.get("profile", {})
    draft = {
        "draft_id":            draft_id,
        "client_id":           client_id,
        "client_name":         _p.get("name", client.get("name", "")),
        "client_email":        _p.get("email", ""),
        "client_contact":      _p.get("name", "Unknown"),
        "circular_id":         circular_id,
        "circular_title":      circular["title"],
        "regulator":           circular["regulator"],
        "priority":            circular["priority"],
        "circular_summary":    circular["summary"] or f"{circular['regulator']} regulatory update — {circular['title']}.",
        "actions":             obligations["actions"],
        "deadline":            obligations["deadline"],
        "risk_level":          obligations["risk_level"],
        "penalty_if_missed":   obligations["penalty_if_missed"],
        "applicable_sections": obligations["applicable_sections"],
        "email_subject":       subject,
        "email_body":          body,
        "internal_notes":      obligations["internal_notes"],
        "source_chunks":       sources,
        "model_used":          model,
        "generated_at":        datetime.now(timezone.utc).isoformat(),
        "version":             "v1",
        "status":              "pending_review",   # legacy compatibility
        "review_status":       "pending",
        "delivery_status":     "not_sent",
    }

    # Step 5: persist to disk
    saved_path = _save_draft(draft)
    print(f"     💾 Saved: {saved_path.name}")

    # Step 6: audit log
    log_event(
        agent="DrafterAgent",
        action="draft_generated",
        details={
            "draft_id":    draft_id,
            "client_id":   client_id,
            "client_name": client.get("profile", {}).get("name", client.get("name", "")),
            "circular_id": circular_id,
            "regulator":   circular["regulator"],
            "risk_level":  obligations["risk_level"],
            "actions":     len(obligations["actions"]),
            "rag_chunks":  len(sources),
            "status":      "pending_review"
        },
        citation=sources[0]["source"] if sources else None,
        user_approval=None   # None until CA approves
    )

    return draft


# ─────────────────────────────────────────────
# PUBLIC API: DRAFT ALL
# ─────────────────────────────────────────────

MAX_DRAFTS_PER_CLIENT = 1   # max drafts one client can receive per pipeline run
MAX_TOTAL_DRAFTS      = 15  # hard cap on total drafts per run (avoids LLM overload)

_PRIORITY_RANK = {"HIGH": 0, "MEDIUM": 1, "LOW": 2}


def _client_risk_score(client: dict) -> float:
    """Lower score = higher risk = drafted first."""
    risk = client.get("risk", client.get("risk_profile", {}))
    compliance_score = risk.get("compliance_score", 100)
    return compliance_score  # lower compliance_score → higher risk


def draft_advisories(match_results: list[dict]) -> list[dict]:
    """
    Main entry point.
    Takes output from match_clients() and generates one draft
    per (client, circular) pair.

    Throughput rules applied before any LLM call:
      1. Circular-level sort: HIGH priority circulars drafted first.
      2. Client-level sort: within each circular, highest-risk clients first.
      3. Per-client cap: MAX_DRAFTS_PER_CLIENT drafts per client per run.
      4. Global cap: MAX_TOTAL_DRAFTS drafts total per run.

    Input  : list of match result dicts from client_matcher.py
    Output : list of draft dicts, one per (client × circular)
    """
    # Load full client records for detailed profiles
    with open(CLIENTS_PATH, encoding="utf-8") as f:
        clients_map = {c["id"]: c for c in json.load(f)}

    # Sort circulars: HIGH first, then MEDIUM, then LOW
    sorted_matches = sorted(
        match_results,
        key=lambda m: _PRIORITY_RANK.get(str(m.get("priority", "LOW")).upper(), 2)
    )

    all_drafts: list[dict] = []
    client_draft_count: dict[str, int] = {}

    for match in sorted_matches:
        if len(all_drafts) >= MAX_TOTAL_DRAFTS:
            print(f"  ⚠️  Global draft cap ({MAX_TOTAL_DRAFTS}) reached — stopping early")
            break

        circular = {
            "title":     match["circular_title"],
            "regulator": match["regulator"],
            "priority":  match["priority"],
            "summary":   match["circular_summary"] if "circular_summary" in match else match.get("summary", "")
        }

        # Sort affected clients: lowest compliance_score (highest risk) first
        affected_sorted = sorted(
            match["affected_clients"],
            key=lambda a: _client_risk_score(clients_map.get(a["client_id"], {}))
        )

        for affected in affected_sorted:
            if len(all_drafts) >= MAX_TOTAL_DRAFTS:
                break

            client_id = affected["client_id"]

            if client_draft_count.get(client_id, 0) >= MAX_DRAFTS_PER_CLIENT:
                print(f"  ⏭  {client_id} already has {MAX_DRAFTS_PER_CLIENT} draft(s) this run — skipping")
                continue

            client = clients_map.get(client_id)
            if not client:
                print(f"  ⚠️  Client {client_id} not found in clients.json — skipping")
                continue

            try:
                draft = draft_single(circular, client)
                all_drafts.append(draft)
                client_draft_count[client_id] = client_draft_count.get(client_id, 0) + 1
            except Exception as e:
                print(f"  ⚠️  Draft failed for {client_id} × {circular.get('regulator', '?')} — {e}")
                log_event(
                    agent="DrafterAgent",
                    action="draft_failed",
                    details={"client_id": client_id, "circular": circular.get("title", ""), "error": str(e)},
                )
                continue

    return all_drafts


# ─────────────────────────────────────────────
# CA APPROVAL HANDLER
# ─────────────────────────────────────────────

def approve_draft(draft_id: str, approved: bool, ca_name: str = "CA") -> dict:
    """
    Human-in-the-loop: CA approves or rejects a draft.
    Updates the JSON file status and logs to audit trail.

    Args:
        draft_id : e.g. "C1_RBI_FEMA_COMPLIANCE_DEADLINE"
        approved : True = approved for sending, False = rejected
        ca_name  : name of the CA who reviewed

    Returns updated draft dict.
    """
    # Find the draft file
    matches = list(DRAFTS_DIR.glob(f"{draft_id}.json"))
    if not matches:
        raise FileNotFoundError(f"Draft not found: {draft_id}")

    path  = matches[0]
    draft = json.loads(path.read_text(encoding="utf-8"))

    now = datetime.now(timezone.utc).isoformat()
    review_status = str(draft.get("review_status", "")).strip().lower()
    delivery_status = str(draft.get("delivery_status", "")).strip().lower()
    legacy_status = str(draft.get("status", "")).strip().lower()

    if review_status not in {"pending", "approved", "rejected"}:
        if legacy_status == "rejected":
            review_status = "rejected"
        elif legacy_status in {"approved", "approved_not_sent", "send_failed", "sent"}:
            review_status = "approved"
        else:
            review_status = "pending"

    if delivery_status not in {"not_sent", "sent", "failed"}:
        if review_status == "rejected":
            delivery_status = "not_sent"
        elif legacy_status == "send_failed":
            delivery_status = "failed"
        elif legacy_status == "sent" or draft.get("email_sent"):
            delivery_status = "sent"
        else:
            delivery_status = "not_sent"

    if approved:
        review_status = "approved"
        if delivery_status != "sent":
            delivery_status = "not_sent"
        draft["approved_by"] = ca_name
        draft["approved_at"] = now
    else:
        review_status = "rejected"
        delivery_status = "not_sent"
        draft["approved_by"] = None
        draft["approved_at"] = None
        draft["email_sent"] = False
        draft["email_sent_at"] = None
        draft["send_error"] = None

    if review_status == "rejected":
        status = "rejected"
    elif review_status == "approved":
        if delivery_status == "sent":
            status = "approved"
        elif delivery_status == "failed":
            status = "send_failed"
        else:
            status = "approved_not_sent"
    else:
        status = "pending_review"

    draft["status"] = status
    draft["review_status"] = review_status
    draft["delivery_status"] = delivery_status
    draft["reviewed_by"] = ca_name
    draft["reviewed_at"] = now

    path.write_text(json.dumps(draft, indent=2, ensure_ascii=False), encoding="utf-8")

    log_event(
        agent="DrafterAgent",
        action="draft_approved" if approved else "draft_rejected",
        details={
            "draft_id":    draft_id,
            "client_id":   draft["client_id"],
            "circular_id": draft["circular_id"],
            "reviewed_by": ca_name,
            "status": status,
            "review_status": review_status,
            "delivery_status": delivery_status,
        },
        citation=draft.get("source_chunks", [{}])[0].get("source") if draft.get("source_chunks") else None,
        user_approval=approved
    )

    status = "✅ APPROVED" if approved else "❌ REJECTED"
    print(f"  {status}: {draft_id} by {ca_name}")

    return draft


# ─────────────────────────────────────────────
# PROACTIVE REMINDER ENGINE
# ─────────────────────────────────────────────

def _build_reminder_action(client: dict, obligation: dict, days_until: Optional[int]) -> str:
    """
    Build a deterministic, hyper-specific action string from obligation + client data.
    No LLM involved — templates ensure 100% accuracy for known obligation types.
    """
    profile = client.get("profile", {})
    regs    = client.get("registrations", {})
    cs      = client.get("compliance_state", {})
    fin     = client.get("financials", {})

    code     = obligation["code"]
    periods  = ", ".join(obligation.get("periods", []))
    due_date = obligation.get("due_date", "")
    penalty  = obligation.get("penalty", "Not specified")

    if days_until is None:
        urgency_prefix = ""
    elif days_until < 0:
        urgency_prefix = f"OVERDUE by {abs(days_until)} days — "
    elif days_until <= 3:
        urgency_prefix = f"DUE IN {days_until} DAY{'S' if days_until != 1 else ''} — "
    else:
        urgency_prefix = f"Due {due_date} — "

    if code == "GST_GSTR3B":
        return (
            f"{urgency_prefix}File GSTR-3B for [{periods}] on GST portal "
            f"(GSTIN: {regs.get('gstin', 'N/A')}). Penalty if missed: {penalty}"
        )

    if code == "GST_GSTR1":
        return (
            f"{urgency_prefix}File GSTR-1 for [{periods}] on GST portal "
            f"(GSTIN: {regs.get('gstin', 'N/A')})"
        )

    if code == "LUT_RENEWAL":
        return (
            f"{urgency_prefix}File Form RFD-11 on GST portal to renew LUT for FY2026-27. "
            f"Without renewal all exports attract 18% IGST from April 1"
        )

    if code == "FEMA_SOFTEX":
        ad_bank     = cs.get("ad_bank", "AD bank")
        unrealised  = fin.get("unrealised_forex_amount") or 0
        oldest_age  = fin.get("oldest_invoice_age_days") or 0
        remaining   = 180 - oldest_age if oldest_age else None
        action = (
            f"{urgency_prefix}Submit SOFTEX for invoices [{periods}] at {ad_bank}"
        )
        if remaining is not None and remaining <= 30:
            action += (
                f" — oldest invoice {oldest_age} days old, only {remaining} days "
                f"before 180-day FEMA limit breach"
            )
        if unrealised:
            action += f". Total unrealised: ₹{unrealised:,}"
        return action

    if code in ("TDS_24Q", "TDS_26Q"):
        return (
            f"{urgency_prefix}File TDS return ({code}) for [{periods}] on TRACES portal "
            f"(TAN: {regs.get('tan', 'N/A')}). Penalty: {penalty}"
        )

    if code == "MCA_AOC4":
        return (
            f"{urgency_prefix}File AOC-4 for [{periods}] on MCA21 portal "
            f"(CIN: {regs.get('cin', 'N/A')}). Penalty: {penalty}"
        )

    if code == "MCA_MGT7":
        return (
            f"{urgency_prefix}File MGT-7 for [{periods}] on MCA21 portal "
            f"(CIN: {regs.get('cin', 'N/A')}). Penalty: {penalty}"
        )

    if code == "MCA_LLP11":
        return (
            f"{urgency_prefix}File LLP Form 11 (Annual Return) for [{periods}] on MCA21 portal "
            f"(LLPIN: {regs.get('llpin', 'N/A')}). Penalty: {penalty}"
        )

    if code == "MCA_LLP8":
        return (
            f"{urgency_prefix}File LLP Form 8 (Statement of Account & Solvency) for [{periods}] "
            f"on MCA21 portal (LLPIN: {regs.get('llpin', 'N/A')}). Penalty: {penalty}"
        )

    if code == "PF_ECR":
        return (
            f"{urgency_prefix}Submit PF Electronic Challan Return (ECR) for [{periods}] "
            f"on EPFO Employer Portal. Penalty: {penalty}"
        )

    if code == "ESIC_RETURN":
        return (
            f"{urgency_prefix}File ESIC half-yearly return for [{periods}] "
            f"on ESIC Employer Portal. Penalty: {penalty}"
        )

    if code in ("IT_ADVANCE_TAX", "IT_ADVANCE_TAX_Q4"):
        paid = (fin.get("advance_tax_paid") or cs.get("advance_tax_paid")) or 0
        return (
            f"{urgency_prefix}Pay Q4 advance tax instalment by {due_date}. "
            f"Total paid so far: ₹{paid:,}. Penalty: {penalty}"
        )

    if code == "IT_SCRUTINY_REPLY":
        scrutiny = cs.get("scrutiny", {})
        return (
            f"{urgency_prefix}Submit reply to scrutiny notice under Section "
            f"{scrutiny.get('section', '?')} for AY {scrutiny.get('assessment_year', '?')} "
            f"on Income Tax portal. Penalty: {penalty}"
        )

    if code == "IT_TP_REPORT":
        return (
            f"{urgency_prefix}File Form 3CEB (Transfer Pricing report) for [{periods}] "
            f"on Income Tax portal. Penalty: {penalty}"
        )

    if code == "IT_ITR_FILING":
        itr_form = cs.get("itr_form", "ITR")
        return (
            f"{urgency_prefix}File {itr_form} for [{periods}] on Income Tax portal "
            f"(PAN: {regs.get('pan', 'N/A')}). Penalty: {penalty}"
        )

    if code == "IT_TAX_AUDIT":
        return (
            f"{urgency_prefix}Complete tax audit (Form 3CD/3CB) for [{periods}]. "
            f"Penalty: {penalty}"
        )

    if code == "RBI_MONTHLY_RETURN":
        return (
            f"{urgency_prefix}Submit RBI monthly return (NBS-9) for [{periods}] "
            f"on RBI XBRL portal. Penalty: {penalty}"
        )

    if code == "SEBI_HALF_YEARLY_AUDIT":
        return (
            f"{urgency_prefix}Submit SEBI half-yearly internal audit report for [{periods}]. "
            f"Engage auditor immediately. Penalty: {penalty}"
        )

    if code in ("IT_FORM16", "IT_TDS_RENTAL_REFUND", "IT_80C_TOPUP"):
        return f"{urgency_prefix}{obligation.get('penalty', code)} by {due_date}"

    # Fallback for unknown codes
    return f"{urgency_prefix}Complete {code} for [{periods}] by {due_date}. Penalty: {penalty}"


def draft_reminder(client: dict, obligation: dict) -> dict:
    """
    Generate a reminder draft directly from a client obligation.
    Skips _extract_obligations entirely — action is built deterministically.
    Only the advisory email body uses the LLM.

    Returns the same draft dict shape as draft_single() for UI compatibility.
    """
    from datetime import date as _date

    today        = _date.today()
    due_date_str = obligation.get("due_date", "")
    days_until: Optional[int] = None

    if due_date_str:
        try:
            days_until = (_date.fromisoformat(due_date_str) - today).days
        except ValueError:
            pass

    # Determine priority
    if days_until is None or (3 < days_until <= 14):
        priority = "MEDIUM"
    elif days_until <= 3 or days_until < 0:
        priority = "HIGH"
    else:
        priority = "LOW"

    code    = obligation["code"]
    periods = ", ".join(obligation.get("periods", []))
    penalty = obligation.get("penalty", "Not specified")

    # Build deterministic action — no LLM
    action = _build_reminder_action(client, obligation, days_until)

    obligations_data = {
        "actions":             [action],
        "deadline":            due_date_str,
        "risk_level":          priority,
        "penalty_if_missed":   penalty,
        "applicable_sections": [],
        "internal_notes": (
            f"Proactive reminder — {code} for [{periods}] is "
            f"{'overdue by ' + str(abs(days_until)) + ' days' if days_until is not None and days_until < 0 else 'due in ' + str(days_until) + ' days' if days_until is not None else 'upcoming'}. "
            f"Action generated from obligations scan, not from incoming circular."
        ),
    }

    # Synthetic circular for email generation
    synthetic_circular = {
        "regulator": obligation["regulator"],
        "title":     f"Compliance Reminder: {code} — {periods}",
        "summary":   (
            f"{code} for {periods} is due {due_date_str}. "
            f"Penalty if missed: {penalty}"
        ),
        "priority":  priority,
        "source":    "reminder",
    }

    subject, body = _draft_email(synthetic_circular, client, obligations_data, priority)

    # Draft ID — deterministic so re-runs overwrite stale reminders
    periods_slug = "_".join(obligation.get("periods", [])).replace("-", "").replace(" ", "")
    reminder_id  = f"REMINDER_{code}_{periods_slug}"
    client_id    = client["id"]
    draft_id     = f"{client_id}_{reminder_id}"

    _p = client.get("profile", {})
    draft = {
        "draft_id":            draft_id,
        "client_id":           client_id,
        "client_name":         _p.get("name", ""),
        "client_email":        _p.get("email", ""),
        "client_contact":      _p.get("name", "Unknown"),
        "circular_id":         reminder_id,
        "circular_title":      synthetic_circular["title"],
        "regulator":           obligation["regulator"],
        "priority":            priority,
        "circular_summary":    synthetic_circular["summary"],
        "actions":             [action],
        "deadline":            due_date_str,
        "risk_level":          priority,
        "penalty_if_missed":   penalty,
        "applicable_sections": [],
        "email_subject":       subject,
        "email_body":          body,
        "internal_notes":      obligations_data["internal_notes"],
        "source_chunks":       [],
        "model_used":          MODEL_BY_PRIORITY.get(priority, "llama-3.1-8b-instant"),
        "generated_at":        datetime.now(timezone.utc).isoformat(),
        "version":             "v1",
        "status":              "pending_review",
        "review_status":       "pending",
        "delivery_status":     "not_sent",
        "reminder_source":     True,
        "obligation_code":     code,
        "obligation_periods":  obligation.get("periods", []),
    }

    _save_draft(draft)
    print(f"     💾 Reminder saved: {draft_id}")

    log_event(
        agent="ReminderAgent",
        action="reminder_generated",
        details={
            "draft_id":        draft_id,
            "client_id":       client_id,
            "client_name":     _p.get("name", ""),
            "obligation_code": code,
            "days_until":      days_until,
            "due_date":        due_date_str,
        }
    )

    return draft


def scan_and_remind(days_window: int = 14) -> list[dict]:
    """
    Scan all client obligations and generate reminder drafts for:
      - Obligations overdue (status == "overdue")
      - Obligations due within `days_window` days
      - Obligations with status "critical" or "action_needed"

    Skips:
      - Already filed / compliant obligations
      - Obligations with no due_date
      - Drafts that already exist and were actioned (approved/rejected)
      - Drafts generated less than 7 days ago (avoid spam)

    Returns list of generated draft dicts.
    """
    from datetime import date as _date
    today = _date.today()

    with open(CLIENTS_PATH, encoding="utf-8") as f:
        clients = json.load(f)

    all_drafts: list[dict] = []
    scanned = 0
    skipped = 0

    print(f"\n{'='*60}")
    print(f"  REMINDER SCAN — {today.isoformat()}")
    print(f"  Window: {days_window} days | Clients: {len(clients)}")
    print(f"{'='*60}")

    for client in clients:
        obligations = client.get("obligations", [])
        client_name = client.get("profile", {}).get("name", client.get("id", "?"))

        for obligation in obligations:
            scanned += 1
            status   = obligation.get("status", "")
            code     = obligation["code"]
            periods  = obligation.get("periods", [])

            # Skip completed obligations
            if status in ("filed", "compliant"):
                skipped += 1
                continue

            due_date_str = obligation.get("due_date")
            if not due_date_str:
                skipped += 1
                continue

            try:
                due_date   = _date.fromisoformat(due_date_str)
                days_until = (due_date - today).days
            except ValueError:
                skipped += 1
                continue

            # Trigger conditions
            should_remind = (
                status in ("overdue", "critical", "action_needed")
                or days_until <= days_window
            )
            if not should_remind:
                skipped += 1
                continue

            # Check for existing draft — avoid regenerating fresh ones
            periods_slug = "_".join(periods).replace("-", "").replace(" ", "")
            reminder_id  = f"REMINDER_{code}_{periods_slug}"
            draft_path   = DRAFTS_DIR / f"{client['id']}_{reminder_id}.json"

            if draft_path.exists():
                existing = json.loads(draft_path.read_text(encoding="utf-8"))
                existing_review = str(existing.get("review_status", "")).strip().lower()
                existing_status = str(existing.get("status", "")).strip().lower()
                if (
                    existing_review in ("approved", "rejected")
                    or existing_status in ("approved", "rejected", "approved_not_sent", "send_failed", "sent")
                ):
                    skipped += 1
                    continue  # Already actioned — don't regenerate
                # Re-generate only if draft is older than 7 days
                generated_at = existing.get("generated_at", "")
                if generated_at:
                    try:
                        age = (datetime.now(timezone.utc) - datetime.fromisoformat(generated_at)).days
                        if age < 7:
                            skipped += 1
                            continue
                    except Exception:
                        pass

            label = f"OVERDUE {abs(days_until)}d" if days_until < 0 else f"due in {days_until}d"
            print(f"\n  🔔 {client_name} — {code} ({label})")

            try:
                draft = draft_reminder(client, obligation)
                all_drafts.append(draft)
            except Exception as exc:
                print(f"     ⚠️  Failed to generate reminder: {exc}")

    print(f"\n{'='*60}")
    print(f"  Scanned: {scanned} obligations | Skipped: {skipped} | Generated: {len(all_drafts)}")
    print(f"{'='*60}\n")

    return all_drafts


# ─────────────────────────────────────────────
# STANDALONE DEMO
# ─────────────────────────────────────────────

_DEMO_MATCH_RESULTS = [
    {
        "circular_title": "RBI Circular: FEMA Compliance Deadline Extended – March 2026",
        "regulator":      "RBI",
        "priority":       "HIGH",
        "summary":        "FEMA reporting deadline for foreign transactions extended by 30 days.",
        "affected_clients": [
            {
                "client_id":    "C1",
                "name":         "Arvind Textiles Pvt. Ltd.",
                "business_type": "Textile Exporter",
                "contact_email": "arvind.shah@arvindtextiles.com",
                "reason":       "Has foreign transactions — FEMA applicable",
                "urgent":       True
            }
        ],
        "match_count": 1
    },
    {
        "circular_title": "MCA Notification: LLP Annual Filing Deadline – FY 2025-26",
        "regulator":      "MCA",
        "priority":       "MEDIUM",
        "summary":        "LLP Form 11 annual return due date extended to July 15, 2026.",
        "affected_clients": [
            {
                "client_id":    "C3",
                "name":         "Mehta Pharma Distributors LLP",
                "business_type": "Pharmaceutical Distributor",
                "contact_email": "rajesh@mehtapharma.com",
                "reason":       "Constituted as LLP — MCA/LLP filings applicable",
                "urgent":       False
            }
        ],
        "match_count": 1
    }
]


if __name__ == "__main__":
    print("=" * 60)
    print("  DRAFTER AGENT — Demo Run")
    print("=" * 60)

    drafts = draft_advisories(_DEMO_MATCH_RESULTS)

    print(f"\n{'=' * 60}")
    print(f"  Generated {len(drafts)} draft(s)")
    print(f"{'=' * 60}")

    for d in drafts:
        risk_icon = {"HIGH": "🔴", "MEDIUM": "🟡", "LOW": "⚪"}.get(d["risk_level"], "⚪")
        print(f"\n{risk_icon} {d['client_name']} × {d['regulator']}")
        print(f"  Draft ID  : {d['draft_id']}")
        print(f"  Risk      : {d['risk_level']}")
        print(f"  Deadline  : {d['deadline']}")
        print(f"  Actions   : {len(d['actions'])}")
        for i, action in enumerate(d["actions"], 1):
            print(f"    {i}. {action}")
        print(f"  Subject   : {d['email_subject']}")
        print(f"  RAG chunks: {len(d['source_chunks'])}")
        print(f"  Status    : {d['status']}")
        print(f"  Saved to  : data/drafts/{d['draft_id']}.json")

    print(f"\n{'=' * 60}")
    print("  Drafts saved to backend/data/drafts/")
    print("  Run approve_draft(draft_id, approved=True) to approve")
    print(f"{'=' * 60}")
