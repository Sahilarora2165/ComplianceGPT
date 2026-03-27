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
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

# ── Path setup ─────────────────────────────────────────────────────────────────
_BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.append(str(_BACKEND_DIR))

from groq import Groq
from sentence_transformers import SentenceTransformer, CrossEncoder
from rank_bm25 import BM25Okapi
import chromadb

from config import (
    GROQ_API_KEY, GROQ_MODEL,
    VECTORSTORE_DIR, EMBEDDING_MODEL,
    CHROMA_COLLECTION, TOP_K
)
from core.audit import log_event

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
_EMBED_MODEL   = SentenceTransformer(EMBEDDING_MODEL)
_CROSS_ENCODER = CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2")


# ─────────────────────────────────────────────
# CIRCULAR ID GENERATOR
# ─────────────────────────────────────────────

def _make_circular_id(regulator: str, title: str) -> str:
    """
    Generate a short stable ID from regulator + title.
    Example: "RBI_FEMA_COMPLIANCE_DEADLINE"
    Used for filename and audit trail.
    """
    slug = re.sub(r"[^a-zA-Z0-9\s]", "", title)
    slug = "_".join(slug.upper().split()[:5])
    return f"{regulator.upper()}_{slug}"


# ─────────────────────────────────────────────
# RAG CONTEXT RETRIEVER (internal, drafter-specific)
# ─────────────────────────────────────────────

def _retrieve_context(query: str, top_k: int = TOP_K) -> tuple[str, list[dict]]:
    """
    Pull relevant chunks from ChromaDB using hybrid search
    (vector + BM25 + cross-encoder rerank).

    Returns:
        context_text : formatted string for LLM prompt
        sources      : list of {source, page, score}
    """
    client     = chromadb.PersistentClient(path=str(VECTORSTORE_DIR))
    collection = client.get_or_create_collection(name=CHROMA_COLLECTION)

    if collection.count() == 0:
        return "", []

    fetch_k = min(50, collection.count())

    # ── Vector search ──────────────────────────────────────────────────────
    q_emb   = _EMBED_MODEL.encode([query]).tolist()
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
        ce_scores = _CROSS_ENCODER.predict([(query, c["doc"]) for c in candidates])
        for i, c in enumerate(candidates):
            c["ce_score"] = float(ce_scores[i])
        candidates = sorted(candidates, key=lambda x: x["ce_score"], reverse=True)[:top_k]

    # ── Build context string ───────────────────────────────────────────────
    def sigmoid(x): return 1 / (1 + math.exp(-x))

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

    return "\n\n---\n\n".join(context_parts), sources


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

    # Support both old and new client.json structures
    compliance = client.get("compliance", {})
    if not compliance:
        # New structure uses regulatory_profile and risk_profile
        regulatory = client.get("regulatory_profile", {})
        risk = client.get("risk_profile", {})
        compliance = {
            "gst_filing_frequency": regulatory.get("gst", ["N/A"])[0] if regulatory.get("gst") else "N/A",
            "tds_applicable": "TDS" in client.get("tags", []),
            "transfer_pricing_applicable": "Transfer Pricing" in regulatory.get("income_tax", []) or "TP" in str(regulatory.get("income_tax", [])),
            "audit_required": risk.get("compliance_score", 100) < 90
        }

    client_profile = f"""
Client Name       : {client['name']}
Business Type     : {client.get('business_type') or client.get('industry', 'Unknown')}
Constitution      : {client['constitution']}
Industry          : {client['industry']}
GST Filing        : {compliance.get('gst_filing_frequency', 'N/A')}
TDS Applicable    : {compliance.get('tds_applicable', False)}
Transfer Pricing  : {compliance.get('transfer_pricing_applicable', False)}
Audit Required    : {compliance.get('audit_required', False)}
Tags              : {', '.join(client.get('tags', []))}
Notes             : {client.get('notes', '')}
""".strip()

    compliance_str = ", ".join(f"{k}={v}" for k, v in client.get("compliance", {}).items())
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
4. Think about what makes this client DIFFERENT:
   - Industry: {client['industry']}
   - Constitution: {client['constitution']}
   - Compliance profile: {compliance_str}
   - Special notes: {client.get('notes', 'None')}
5. SKIP any action that would be IDENTICAL for every GST/RBI registered business — those are not client-specific advisories
6. If this circular has NO direct, specific impact on this client beyond general awareness, return exactly ONE action: "Note for awareness — no immediate action required for {client['name']}"

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

    # Support both old and new client.json structures
    contact = client.get("contact", {})
    primary_person = contact.get("primary_person") or contact.get("name", "Sir/Madam")
    designation = contact.get("designation", "")

    prompt = f"""You are a CA (Chartered Accountant) writing a formal compliance advisory email to a client.

CIRCULAR: {circular['title']}
REGULATOR: {circular['regulator']}
CLIENT: {client['name']} ({client.get('business_type') or client.get('industry', 'Unknown')})
CONTACT PERSON: {primary_person} ({designation})

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
    circular_id = _make_circular_id(circular["regulator"], circular["title"])
    client_id   = client["id"]
    draft_id    = f"{client_id}_{circular_id}"

    print(f"\n  ✍️  Drafting: {client['name']} × {circular['regulator']}")

    # Step 1: retrieve relevant context from ChromaDB
    # Include client industry/type so each client pulls different, relevant chunks
    query   = (
        f"{circular['regulator']} {circular['title']} {circular['summary']} "
        f"{client['industry']} {client.get('business_type') or client.get('industry', '')}"
    )
    context, sources = _retrieve_context(query)

    if sources:
        print(f"     📚 RAG: {len(sources)} chunk(s) retrieved from {sources[0]['source']}")
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
    contact = client.get("contact", {})
    draft = {
        "draft_id":            draft_id,
        "client_id":           client_id,
        "client_name":         client["name"],
        "client_email":        contact.get("email", ""),
        "client_contact":      contact.get("primary_person") or contact.get("name", "Unknown"),
        "circular_id":         circular_id,
        "circular_title":      circular["title"],
        "regulator":           circular["regulator"],
        "priority":            circular["priority"],
        "circular_summary":    circular["summary"],
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
        "status":              "pending_review"   # CA must approve before sending
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
            "client_name": client["name"],
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

def draft_advisories(match_results: list[dict]) -> list[dict]:
    """
    Main entry point.
    Takes output from match_clients() and generates one draft
    per (client, circular) pair.

    Input  : list of match result dicts from client_matcher.py
    Output : list of draft dicts, one per (client × circular)
    """
    # Load full client records for detailed profiles
    with open(CLIENTS_PATH, encoding="utf-8") as f:
        clients_map = {c["id"]: c for c in json.load(f)}

    all_drafts = []

    for match in match_results:
        circular = {
            "title":     match["circular_title"],
            "regulator": match["regulator"],
            "priority":  match["priority"],
            "summary":   match["circular_summary"] if "circular_summary" in match else match.get("summary", "")
        }

        for affected in match["affected_clients"]:
            client_id = affected["client_id"]
            client    = clients_map.get(client_id)

            if not client:
                print(f"  ⚠️  Client {client_id} not found in clients.json — skipping")
                continue

            draft = draft_single(circular, client)
            all_drafts.append(draft)

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

    draft["status"]       = "approved" if approved else "rejected"
    draft["reviewed_by"]  = ca_name
    draft["reviewed_at"]  = datetime.now(timezone.utc).isoformat()

    path.write_text(json.dumps(draft, indent=2, ensure_ascii=False), encoding="utf-8")

    log_event(
        agent="DrafterAgent",
        action="draft_approved" if approved else "draft_rejected",
        details={
            "draft_id":    draft_id,
            "client_id":   draft["client_id"],
            "circular_id": draft["circular_id"],
            "reviewed_by": ca_name
        },
        citation=draft.get("source_chunks", [{}])[0].get("source") if draft.get("source_chunks") else None,
        user_approval=approved
    )

    status = "✅ APPROVED" if approved else "❌ REJECTED"
    print(f"  {status}: {draft_id} by {ca_name}")

    return draft


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