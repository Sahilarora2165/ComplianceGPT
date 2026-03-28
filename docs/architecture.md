# ComplianceGPT -- Multi-Agent Architecture Document

## System Overview

ComplianceGPT is an AI-powered compliance monitoring and advisory system built for Indian Chartered Accountancy (CA) firms. It autonomously monitors regulatory bodies (RBI, GST, IncomeTax, MCA), matches new circulars to affected clients using a rule-based engine, generates context-aware advisory drafts via RAG-augmented LLM inference, and proactively alerts on approaching deadlines with financial exposure calculations.

The system is built on a **four-agent pipeline architecture** orchestrated sequentially, with each agent producing structured outputs consumed by the next stage.

---

## Architecture Diagram

```
 ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
 │                                     FASTAPI APPLICATION (app.py)                                │
 │                                                                                                  │
 │   ┌─────────────────┐     REST API Endpoints          ┌──────────────────────────────────────┐   │
 │   │   APScheduler   │◄──── /trigger-scheduler ────────►│          React Frontend              │   │
 │   │                 │      /pipeline/status             │  (Dashboard · Circulars · Drafts ·  │   │
 │   │  Monitoring 6h  │      /drafts · /deadlines        │   Deadlines · Clients · Calendar ·  │   │
 │   │                 │      /compliance-calendar         │   Audit · Analyst Query)            │   │
 │   │  Deadlines  6h  │      /analyst-query              └──────────────────────────────────────┘   │
 │   │  Reminders 24h  │      /documents/upload                                                     │
 │   └────────┬────────┘                                                                            │
 └────────────┼─────────────────────────────────────────────────────────────────────────────────────┘
              │ triggers
              ▼
 ┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
 │                              ORCHESTRATOR (orchestrator.py)                                      │
 │                                                                                                  │
 │   Controls: execution order, priority-based queuing (HIGH → MEDIUM → LOW), configurable          │
 │             per-run and per-client draft caps, deduplication, audit logging at each stage        │
 │                                                                                                  │
 │   ┌──────────┐      new_docs[ ]      ┌──────────┐    match_results[ ]   ┌──────────┐            │
 │   │  STAGE 1 ├──────────────────────►│  STAGE 2 ├─────────────────────►│  STAGE 3 │            │
 │   │ MONITOR  │                        │  MATCH   │                      │  DRAFT   │            │
 │   └──────────┘                        └──────────┘                      └─────┬────┘            │
 │                                                                               │ drafts[ ]       │
 │                                                                               ▼                  │
 │                                                                         ┌──────────┐            │
 │                                                                         │  STAGE 4 │            │
 │                                                                         │ DEADLINE │            │
 │                                                                         └──────────┘            │
 └──────────────────────────────────────────────────────────────────────────────────────────────────┘

 ═══════════════════════════════ AGENT DETAIL ═══════════════════════════════

 STAGE 1: MONITORING AGENT                    STAGE 2: CLIENT MATCHER
 ┌────────────────────────────────┐           ┌────────────────────────────────────┐
 │                                │           │                                    │
 │  Playwright Browser Engine     │           │  For each (circular, client):      │
 │  ┌────────────────────────┐    │           │                                    │
 │  │  Pluggable Regulator   │    │           │  1. Market-Ops Filter (skip noise) │
 │  │  Scrapers (N sources)  │    │           │  2. Obligation Match (primary)     │
 │  └───────────┬────────────┘    │           │     └─ Content Filter (structural) │
 │              │                 │           │  3. Tag/Registration Fallback      │
 │              ▼                 │           │     └─ Content Filter (full)       │
 │  ┌──────────────────────────┐  │           │                                    │
 │  │  Dedup via SHA256 Hash   │  │           │  Output: affected_clients[ ] per   │
 │  │  (seen_documents.json)   │  │           │          circular with reasons     │
 │  └───────────┬──────────────┘  │           └────────────────────────────────────┘
 │              │ new docs
 │              ▼                 │           STAGE 3: DRAFTER AGENT
 │  ┌──────────────────────────┐  │           ┌────────────────────────────────────┐
 │  │  Auto-Ingest into RAG   │  │           │                                    │
 │  │  (PyMuPDF → Chunk →     │  │           │  For each (client, circular) pair: │
 │  │   Embed → ChromaDB)     │  │           │                                    │
 │  └──────────────────────────┘  │           │  1. Obligation-driven RAG          │
 │                                │           │     (client obligations → domain  │
 │  OCR Fallback:                 │           │      terms → hybrid search →      │
 │  pdf2image → Tesseract         │           │      cross-encoder rerank)          │
 │  if avg chars/page < 50       │           │  2. LLM Call 1: Extract            │
 └────────────────────────────────┘           │     obligations + risk flags        │
                                              │     (FEMA, LUT, MCA, tax audit)    │
                                              │  3. Deadline normalization          │
                                              │     (ISO / RELATIVE / PERIODIC)    │
                                              │  4. LLM Call 2: Draft advisory     │
                                              │     email (client-personalized)     │
                                              │                                    │
                                              │  Model tiering (Groq):             │
                                              │  HIGH→70b │ MED→8b │ LOW→gemma   │
                                              │                                    │
                                              │  Output: draft.json                │
                                              │  (actions, deadline, risk,         │
                                              │   email, source citations)         │
                                              └────────────────────────────────────┘

 STAGE 4: DEADLINE AGENT
 ┌────────────────────────────────┐
 │                                │
 │  Sources:                      │
 │  ├─ Client obligations[ ]     │
 │  └─ Generated drafts[ ]      │
 │                                │
 │  Deadline Parser:              │
 │  ├─ ISO:      2026-04-15     │
 │  ├─ RELATIVE: 30 days        │
 │  ├─ PERIODIC: monthly/15th   │
 │  └─ Lookup:   GSTR→20th     │
 │                                │
 │  Alert Levels:                 │
 │  ├─ MISSED   (past due)      │
 │  ├─ CRITICAL (≤3 days)       │
 │  ├─ WARNING  (≤14 days)      │
 │  └─ OK       (>14 days)      │
 │                                │
 │  Financial Exposure Calc:      │
 │  ├─ Pattern: ₹50/day × days  │
 │  ├─ FEMA: ₹500,000+ base    │
 │  └─ Risk multiplier: H=3x    │
 │                                │
 │  Auto-drafts for CRITICAL+    │
 └────────────────────────────────┘

 ═══════════════════════ SHARED INFRASTRUCTURE ═══════════════════════════

 ┌─────────────────────────┐  ┌──────────────────────────┐  ┌─────────────────────────┐
 │      ChromaDB            │  │     Audit Trail          │  │    Analyst Query (RAG)  │
 │  (Vector Store)          │  │  (core/audit.py)         │  │  (core/retriever.py)    │
 │                          │  │                          │  │                          │
 │  Collection:             │  │  Append-only JSONL       │  │  Hybrid Search:          │
 │   compliance_docs        │  │  logs/audit.jsonl        │  │  ├─ BM25 keyword         │
 │                          │  │                          │  │  ├─ Vector similarity     │
 │  Embeddings:             │  │  Fields:                 │  │  └─ RRF merge            │
 │   all-MiniLM-L6-v2      │  │  ├─ timestamp            │  │                          │
 │   (384-dim, cached)      │  │  ├─ agent               │  │  Reranking:              │
 │                          │  │  ├─ action               │  │   cross-encoder          │
 │  Metadata per chunk:     │  │  ├─ details{}            │  │   ms-marco-MiniLM-L-6   │
 │  ├─ page number          │  │  ├─ citation             │  │                          │
 │  ├─ regulator            │  │  └─ user_approval        │  │  Query Expansion:        │
 │  ├─ title                │  │                          │  │  ├─ Domain aliases       │
 │  ├─ document_date        │  │  Every agent action      │  │  ├─ Concept terms        │
 │  └─ source URL           │  │  is immutably logged     │  │  └─ Up to 6 variants     │
 └─────────────────────────┘  └──────────────────────────┘  └─────────────────────────┘
```

---

## Agent Roles and Communication

### Stage 1: Monitoring Agent

**Purpose:** Continuously detect new regulatory circulars from Indian government portals.

**How it works:**
- Uses **Playwright** (headless Chromium) to scrape JavaScript-heavy regulatory websites. Each regulator is implemented as an independent scraper function, making it straightforward to add new sources (e.g., SEBI, IRDAI) without modifying the core pipeline.
- Each scraped document is **SHA256-hashed** and checked against a persistent hash database (`seen_documents.json`) for deduplication -- only truly new circulars proceed.
- New PDFs are downloaded, and text is extracted via **PyMuPDF**. If a page averages fewer than 50 characters (scanned document), the system falls back to **OCR** — pdf2image converts the PDF pages to images, then Tesseract reads the text from those images.
- Extracted text is automatically chunked (1500 chars, 150 overlap) and embedded using **SentenceTransformer (all-MiniLM-L6-v2)** into ChromaDB for downstream RAG retrieval.

**Output to Stage 2:** `new_docs[]` -- list of document metadata (title, regulator, priority, summary, URL, filename).

**Error handling:**
- Multi-tier scraping fallback: Playwright (headless browser) is attempted first; if it returns zero results, the system falls back to HTTP + BeautifulSoup for static HTML extraction.
- PDF validation: every download is verified for `%PDF` magic bytes and checked for HTML content — fake or corrupted files are rejected and purged automatically.
- Automatic priority inference: circulars are classified as HIGH (deadline, penalty, FEMA), MEDIUM, or LOW (advisory, clarification) based on title keyword analysis.

---

### Stage 2: Client Matcher

**Purpose:** Determine which clients are affected by each new circular using a multi-tier matching engine.

**How it works -- 3-stage matching pipeline:**

1. **Market-Ops Filter:** Immediately skips non-compliance releases (auction results, statistical supplements, open market operations) that don't create client obligations.

2. **Obligation-Driven Match (Primary Path):** Checks if a client has structured `obligations[]` entries matching the circular's regulator. This is the most reliable path -- a client with `obligations[].regulator = "RBI"` automatically matches all RBI circulars. This reflects how CA firms operate: clients declare their compliance responsibilities upfront. Matched clients then pass through a **content filter** (structural checks only -- tag-based filters are bypassed since the client already has a proven obligation).

3. **Tag/Registration Fallback:** For clients without structured obligations, the system falls back to rule-based matching using client tags (e.g., `tags: ["GST", "FEMA"]`) and registration fields (e.g., `registrations.gstin` present implies GST compliance). These clients pass through the **full content filter**, which scans the circular's title and summary for topic-specific keywords -- for example, an "NBFC" circular requires the client's industry to be NBFC-related, and a catch-all policy applies stricter validation for generic circulars.

**Output to Stage 3:** `match_results[]` -- per circular, a list of affected clients with match reasons and urgency flags.


---

### Stage 3: Drafter Agent

**Purpose:** Generate client-specific compliance advisory drafts grounded in source documents, with a parallel proactive reminder engine for known obligations.

**How it works:**
- For each (client, circular) pair, the agent runs a 4-step pipeline:
  1. **Obligation-driven RAG retrieval:** Maps each client's obligation codes to domain-specific search terms (25+ mappings), then executes hybrid search (BM25 + vector + RRF merge + cross-encoder reranking). Chunks below relevance threshold are discarded.
  2. **LLM Call 1 (Obligation Extraction):** RAG chunks + regulator-aware client profile (with pre-computed risk flags: FEMA breach risk, LUT expiry, MCA overdue, tax audit thresholds) are passed to a Groq LLM with priority-based model tiering (HIGH→70b, MEDIUM→8b, LOW→gemma). Extracts structured actions, deadline, risk level, and penalties.
  3. **Deadline normalization:** Parses raw LLM deadline output into ISO/RELATIVE/PERIODIC formats with regulator-specific lookup tables.
  4. **LLM Call 2 (Email Drafting):** Generates personalized advisory email addressed to the client's contact person.

- Drafts are saved with `pending_review` status -- a CA must approve/reject each draft (human-in-the-loop) before delivery.

- **Throughput controls:** Priority-ordered drafting (HIGH first), risk-based client ordering, per-client and global draft caps.

- **Proactive Reminder Engine:** A scheduled scan independently checks all client obligations for approaching/overdue deadlines. Uses deterministic action templates (no LLM for action generation) ensuring 100% accuracy for known obligation types.

**Output to Stage 4:** Draft files on disk, each containing parsed deadlines for the Deadline Agent to monitor.

**Error handling:**
- Per-client fault isolation: if drafting fails for one client, that client is skipped and the pipeline continues for remaining clients — a single LLM or data error never blocks the entire run.
- JSON parse fallback: malformed LLM output falls back to safe default obligation structure with raw output preserved in `internal_notes` for manual review.
- Embedding/cross-encoder unavailable: graceful degradation -- drafts generated without RAG context or with RRF-only ranking (cross-encoder reranking skipped).

---

### Stage 4: Deadline Agent

**Purpose:** Proactively scan all client obligations and generated drafts for approaching or missed deadlines.

**How it works:**
- Scans two sources: client `obligations[]` with hard due dates, and generated drafts from Stage 3 containing structured deadlines.

- The **deadline parser** normalizes deadlines into four formats: `ISO`, `RELATIVE:N`, `PERIODIC:FREQ:DAY`, and a lookup table fallback for 35 known Indian compliance obligations (GSTR-1 on 11th, GSTR-3B on 20th, ITR on July 31st, etc.).

- Each deadline is classified by urgency: **MISSED** (past due), **CRITICAL** (≤3 days), **WARNING** (≤14 days), **OK** (>14 days).

- **Financial exposure** is calculated per alert using penalty pattern matching (per-day, fixed-base, or FEMA-style penalties) and risk-level multipliers (HIGH=3x, MEDIUM=2x, LOW=1x) — enabling the dashboard to sort alerts by rupee impact, not just days remaining.

- For CRITICAL and MISSED deadlines, the agent **auto-generates advisory drafts** with deterministic email templates and recommended actions  ensuring instant generation and 100% accuracy for known obligation types.

**Error handling:**
- Unparseable deadlines are skipped with a warning logged.
- Per-alert fault isolation: if auto-draft generation fails for one alert, it is skipped and the scan continues for remaining alerts.


## Error Handling Philosophy

ComplianceGPT follows a **"never crash the pipeline"** principle. Each agent is wrapped in isolated error handling so that a failure in one stage (e.g., a scraper timeout) does not prevent subsequent stages from executing with whatever data is available.


