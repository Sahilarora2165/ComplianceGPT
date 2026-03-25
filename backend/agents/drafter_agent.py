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
from datetime import datetime, timezone
from pathlib import Path

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
    groq = Groq(api_key=GROQ_API_KEY)

    client_profile = f"""
Client Name       : {client['name']}
Business Type     : {client['business_type']}
Constitution      : {client['constitution']}
Industry          : {client['industry']}
GST Filing        : {client['compliance'].get('gst_filing_frequency', 'N/A')}
TDS Applicable    : {client['compliance'].get('tds_applicable', False)}
Transfer Pricing  : {client['compliance'].get('transfer_pricing_applicable', False)}
Audit Required    : {client['compliance'].get('audit_required', False)}
Tags              : {', '.join(client.get('tags', []))}
Notes             : {client.get('notes', '')}
""".strip()

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
Based on the circular and client profile above, extract SPECIFIC EXECUTABLE obligations for this client.

RULES:
1. Actions must be SPECIFIC — include form names, section numbers, deadlines where available
2. Bad: "Comply with RBI guidelines"
   Good: "Submit updated KYC documents to bank before June 30, 2026"
3. Each action must be something a CA can put on a task list TODAY
4. Deadline must be extracted from the circular text if available, else estimate based on regulator norms
5. Risk level: HIGH if penalty > ₹1L or license risk, MEDIUM if filing risk, LOW if advisory only
6. internal_notes must flag anything the CA team needs to know that the client doesn't need to see

Return ONLY valid JSON, no explanation, no markdown:
{{
  "actions": [
    "Action 1 — specific and executable",
    "Action 2 — specific and executable"
  ],
  "deadline": "YYYY-MM-DD or descriptive deadline",
  "risk_level": "HIGH|MEDIUM|LOW",
  "penalty_if_missed": "describe penalty or 'Not specified'",
  "applicable_sections": ["Section X", "Rule Y"],
  "internal_notes": "Notes for CA team only — red flags, dependencies, cross-checks needed"
}}"""

    response = groq.chat.completions.create(
        model=GROQ_MODEL,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.1,
        max_tokens=1000
    )

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
    obligations: dict
) -> tuple[str, str]:
    """
    Step 2 of drafting: generate client advisory email + subject line.
    Returns (subject, email_body).
    """
    groq = Groq(api_key=GROQ_API_KEY)

    actions_text = "\n".join(f"  {i+1}. {a}" for i, a in enumerate(obligations["actions"]))

    prompt = f"""You are a CA (Chartered Accountant) writing a formal compliance advisory email to a client.

CIRCULAR: {circular['title']}
REGULATOR: {circular['regulator']}
CLIENT: {client['name']} ({client['business_type']})
CONTACT PERSON: {client['contact']['primary_person']} ({client['contact']['designation']})

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
        model=GROQ_MODEL,
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
    query   = f"{circular['regulator']} {circular['title']} {circular['summary']}"
    context, sources = _retrieve_context(query)

    if sources:
        print(f"     📚 RAG: {len(sources)} chunk(s) retrieved from {sources[0]['source']}")
    else:
        print(f"     ⚠️  RAG: no matching chunks — using LLM knowledge only")

    # Step 2: extract obligations
    obligations = _extract_obligations(circular, client, context)
    print(f"     ✅ {len(obligations['actions'])} action(s) | Risk: {obligations['risk_level']} | Deadline: {obligations['deadline']}")

    # Step 3: draft email
    subject, body = _draft_email(circular, client, obligations)

    # Step 4: assemble full draft
    draft = {
        "draft_id":            draft_id,
        "client_id":           client_id,
        "client_name":         client["name"],
        "client_email":        client["contact"]["email"],
        "client_contact":      client["contact"]["primary_person"],
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
        "model_used":          GROQ_MODEL,
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