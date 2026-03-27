# ComplianceGPT — System Documentation

## What is ComplianceGPT?

ComplianceGPT is an AI-powered compliance monitoring and advisory system built for Indian CA (Chartered Accountant) firms. It automatically monitors regulatory websites (RBI, GST Council), detects new circulars, matches them to relevant clients, and generates client-specific compliance advisory drafts using a Retrieval-Augmented Generation (RAG) pipeline powered by Groq LLM.

The system eliminates the manual work of reading every new circular from every regulator and figuring out which clients it applies to — it does that automatically and produces ready-to-review draft advisories.

---

## Local Setup

Use the project virtual environment for backend work. This avoids future breakage from global Python package conflicts.

```bash
./backend/bootstrap_venv.sh
source .venv/bin/activate
cd backend
python -m uvicorn app:app --reload --port 8000
```

Or run the backend directly through the helper script:

```bash
./backend/run_local.sh
```

Notes:
- The backend now expects `.venv` at the repo root.
- Keep using `backend/requirements.txt` for backend dependency changes.
- If embeddings or reranker models are not cached locally, the first retrieval run may download them once.

---

## Architecture Overview

```
Internet (RBI / GST Council websites)
            │
            ▼
    ┌─────────────────┐
    │ MonitoringAgent │  — scrapes new circulars, downloads PDFs, ingests to vectorstore
    └────────┬────────┘
             │  new_docs[]
             ▼
    ┌─────────────────┐
    │  ClientMatcher  │  — matches each circular to relevant clients
    └────────┬────────┘
             │  match_results[]
             ▼
    ┌─────────────────┐
    │  DrafterAgent   │  — generates compliance advisory drafts using RAG + LLM
    └────────┬────────┘
             │
             ▼
    data/drafts/*.json   — saved for CA review and frontend display
```

All three stages are coordinated by `backend/orchestrator.py`.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Web scraping | Playwright (headless Chromium) |
| PDF parsing | pdfplumber + Tesseract OCR (fallback) |
| Embeddings | `all-MiniLM-L6-v2` (sentence-transformers) |
| Vector store | ChromaDB (persistent, local) |
| Keyword search | BM25 (rank-bm25) |
| Reranking | `cross-encoder/ms-marco-MiniLM-L-6-v2` |
| LLM | Groq API — `llama-3.3-70b-versatile` |
| Scheduling | APScheduler (runs every 6 hours) |
| Backend API | FastAPI + Uvicorn |
| Frontend | React (Vite) |
| Containerization | Docker + Docker Compose |

---

## Directory Structure

```
ComplianceGPT/
├── backend/
│   ├── agents/
│   │   ├── monitoring_agent.py     # Stage 1: scrape + ingest
│   │   ├── client_matcher.py       # Stage 2: match circulars to clients
│   │   └── drafter_agent.py        # Stage 3: generate advisory drafts
│   ├── core/
│   │   ├── ingest.py               # PDF → chunks → ChromaDB
│   │   ├── audit.py                # Audit trail logger
│   │   └── rag.py                  # RAG query interface (used by frontend)
│   ├── data/
│   │   ├── pdfs/                   # Downloaded circular PDFs
│   │   ├── drafts/                 # Generated advisory JSONs
│   │   └── seen_documents.json     # Hash DB for deduplication
│   ├── vectorstore/                # ChromaDB embeddings (gitignored)
│   ├── logs/
│   │   └── audit.jsonl             # Full audit trail (gitignored)
│   ├── clients.json                # Client profiles (10 clients)
│   ├── config.py                   # Paths, model names, API keys
│   ├── orchestrator.py             # Pipeline controller
│   ├── app.py                      # FastAPI app
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   └── ...                         # React frontend
├── docker-compose.yml
└── README.md
```

---

## Stage 1 — Monitoring Agent

**File:** `backend/agents/monitoring_agent.py`
**Entry point:** `run_monitoring_agent(simulate_mode, regulators, auto_ingest)`

This agent is responsible for detecting new regulatory circulars, downloading them, and ingesting them into the knowledge base.

### Scrapers

#### RBI Press Releases — `_scrape_rbi_playwright(hash_db)`

- **URL:** `https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx`
- Uses Playwright to open the page in a headless Chromium browser
- Waits for the table to load (`wait_for_selector("tr")`)
- Extracts all `.PDF` links using JavaScript `eval_on_selector_all`
- Takes the top 20 links (most recent)
- For each link: checks the hash DB — skips if already seen, otherwise downloads
- PDF bytes validated (must start with `%PDF`, must not be an HTML bot-challenge page)
- Saved to `backend/data/pdfs/rbi_{stem}.pdf`

#### RBI Circulars & Notifications — `_scrape_rbi_circulars_playwright(hash_db)`

- **URL:** `https://www.rbi.org.in/Scripts/BS_CircularIndexDisplay.aspx`
- Clicks the current year tab to load recent circulars
- Extracts notification links (filters out navigation links via `_is_valid_circular_title`)
- Downloads each new circular PDF

#### GST Council Circulars — `_scrape_gst_playwright(hash_db)`

- **URL:** `https://gstcouncil.gov.in/cgst-circulars`
- Table structure: Sr. No | Circular No | PDF Link | Date | Subject
- Page 1 shows most recent circulars first — no sorting required
- Uses `wait_until="domcontentloaded"` (more reliable than `networkidle` on govt sites)
- Extracts circular number (td[1]), PDF href (td[2]), date (td[3]), subject (td[4])
- Downloads and saves as `gst_{stem}.pdf`

### Deduplication — `_is_new_document(key, content, hash_db)`

Every document URL is SHA-256 hashed before processing:

```python
h = hashlib.sha256(content).hexdigest()
if h in hash_db.values() or key in hash_db:
    return False       # already seen — skip
hash_db[key] = h       # mark as seen
return True            # new document — proceed
```

The hash DB is loaded from `data/seen_documents.json` at the start of each run and saved back at the end. This ensures no circular is processed twice across runs.

### Ingestion — `_ingest_new_docs(new_docs)`

Each new PDF is passed to `core/ingest.py`:

1. **Text extraction** — `pdfplumber` extracts text page by page
2. **OCR fallback** — if a page has fewer than 50 characters (scanned PDF), Tesseract OCR is used
3. **Regulator tagging** — regulator is inferred from filename prefix or content keywords (defined in `config.py → REGULATOR_KEYWORDS`)
4. **Chunking** — text split into chunks of 1500 characters with 150 character overlap using `RecursiveCharacterTextSplitter`
5. **Embedding** — each chunk embedded using `all-MiniLM-L6-v2` (384-dimensional vectors)
6. **Storage** — embeddings + metadata stored in ChromaDB collection `compliance_docs`
   - Metadata per chunk: `{source, page, regulator, chunk_index}`

### Simulate Mode

When `simulate_mode=True`, the agent skips all scraping and instead uses a hardcoded list of `SIMULATED_DOCUMENTS` — useful for testing the pipeline without hitting live websites.

If real scraping finds nothing new, the agent automatically falls back to simulate mode.

---

## Stage 2 — Client Matcher

**File:** `backend/agents/client_matcher.py`
**Entry point:** `match_clients(new_docs)`

This agent decides which clients are affected by each new circular.

### Client Profiles — `clients.json`

Each client has:

```json
{
  "id": "C1",
  "name": "Arvind Textiles Pvt. Ltd.",
  "business_type": "Textile Exporter",
  "constitution": "Private Limited",
  "industry": "Textiles",
  "tags": ["RBI", "GST", "IncomeTax", "FEMA"],
  "compliance": {
    "gst_filing_frequency": "monthly",
    "tds_applicable": true,
    "transfer_pricing_applicable": true,
    "audit_required": true
  },
  "contact": {
    "primary_person": "Arvind Shah",
    "designation": "Director",
    "email": "arvind.shah@arvindtextiles.com"
  },
  "notes": "Exports to UAE and UK — FEMA applicable"
}
```

There are 10 clients covering diverse business types: textile exporter, restaurant, pharma distributor, IT services, NBFC, co-operative bank, importer, stockbroker, real estate, and e-commerce.

### 3-Stage Matching Logic

**Stage 1 — Market-ops skip**
Clients whose business is purely market-operations related skip certain banking circulars that don't apply to them.

**Stage 2 — Regulator tag match**
The circular's regulator (`RBI`, `GST`, `IncomeTax`, `MCA`, `SEBI`) must appear in the client's `tags` list. A GST circular will never be sent to a client tagged only for RBI.

**Stage 3 — Content keyword rules**
Each client type has industry-specific keywords. The circular's title and summary are scanned:

| Client | Matching Keywords |
|---|---|
| NBFC | nbfc, non-banking, microfinance, fair practices |
| Co-op Bank | co-operative bank, urban bank, section 35a, amalgamation |
| Importer | import, fema, foreign exchange, remittance |
| Stockbroker | securities, demat, nse, bse, listed company |
| E-Commerce | e-commerce, tcs, marketplace, online seller |
| Real Estate | real estate, construction, works contract |

### Priority Assignment

Each match is assigned a priority based on keywords found in the circular:

- **HIGH** — "penalty", "mandatory", "license", "cancellation", "section 35a", "suo motu"
- **MEDIUM** — "deadline", "filing", "return", "compliance", "circular", "notification"
- **LOW** — "advisory", "clarification", "information", "guidelines"

### Output

```python
[
  {
    "circular_title": "RBI Directions under Section 35A...",
    "regulator": "RBI",
    "priority": "HIGH",
    "circular_summary": "...",
    "affected_clients": [
      {"client_id": "C5", "name": "Sunrise Finserv NBFC Ltd.", "reason": "NBFC — Section 35A applicable"},
      {"client_id": "C6", "name": "Nashik Merchant Urban Co-operative Bank Ltd.", "reason": "Co-op bank — Section 35A applicable"}
    ],
    "match_count": 2
  },
  ...
]
```

---

## Stage 3 — Drafter Agent

**File:** `backend/agents/drafter_agent.py`
**Entry point:** `draft_advisories(match_results)`

This is the most complex stage. For each (client × circular) pair, it generates a full compliance advisory using a 3-step RAG + LLM pipeline.

### Step 1 — Hybrid RAG Retrieval — `_retrieve_context(query)`

The query is: `"{regulator} {circular_title} {summary}"`

Three retrieval methods are combined:

**Vector Search (semantic)**
- Query is embedded using `all-MiniLM-L6-v2`
- ChromaDB returns top 50 chunks by cosine distance
- Finds semantically similar content even if exact words differ

**BM25 Search (keyword)**
- All chunks in ChromaDB loaded
- BM25 (Best Match 25) algorithm scores each chunk by keyword frequency
- Top 50 chunks by BM25 score
- Finds exact keyword matches that vector search might miss

**RRF Merge (Reciprocal Rank Fusion)**
- Both result lists combined using RRF formula: `score += 1 / (60 + rank)`
- Rewards chunks that appear high in BOTH lists
- Produces a unified ranked list of best candidates

**Cross-Encoder Rerank**
- `cross-encoder/ms-marco-MiniLM-L-6-v2` scores every (query, chunk) pair together
- More accurate than bi-encoder but slower — used only on the merged candidates
- Top 5 chunks selected as final context

This hybrid approach (vector + BM25 + rerank) is significantly more accurate than plain vector search alone.

### Step 2 — Obligation Extraction — `_extract_obligations(circular, client, context)`

**Groq API call** with `llama-3.3-70b-versatile`.

The prompt contains:
- Circular details (regulator, title, summary, priority)
- Full client profile (business type, constitution, industry, GST filing frequency, TDS applicability, transfer pricing, audit requirement, tags, notes)
- Top 5 RAG chunks from the actual circular PDF

The LLM is instructed to return **specific, executable obligations** — not vague generic advice:

```
Bad:  "Comply with RBI guidelines"
Good: "Submit updated KYC documents to bank before June 30, 2026"
```

**Output JSON:**
```json
{
  "actions": [
    "Ensure all branches are open for public on March 31, 2026 for government transactions",
    "Verify and update KYC records of customers onto CKYCR to avoid penalty",
    "Monitor and maintain cash reserve requirements as per RBI guidelines"
  ],
  "deadline": "March 31, 2026",
  "risk_level": "MEDIUM",
  "penalty_if_missed": "Penalty under Banking Regulation Act, 1949",
  "applicable_sections": ["Section 42", "Section 56"],
  "internal_notes": "Branch must confirm govt transaction readiness by March 28"
}
```

### Step 3 — Email Drafting — `_draft_email(circular, client, obligations)`

Second **Groq API call**.

Generates a formal advisory email:
- Addressed to the specific contact person (not "Dear Client")
- Explains WHY this circular applies to this specific client
- Lists actions clearly and numbered
- States deadline prominently
- Mentions penalty if HIGH risk
- Under 300 words
- Signed as "Compliance Advisory Team"

### Step 4 — Save Draft

Full draft assembled and saved as JSON:

```
backend/data/drafts/{client_id}_{circular_id}.json
e.g. C5_RBI_DIRECTIONS_UNDER_SECTION_35A_READ.json
```

Draft status is set to `pending_review` — a CA must approve it before it is sent to the client.

### Step 5 — Audit Log

Every draft generation is logged to `backend/logs/audit.jsonl`:
```json
{
  "timestamp": "2026-03-26T06:38:45Z",
  "agent": "DrafterAgent",
  "action": "draft_generated",
  "details": {
    "draft_id": "C5_RBI_DIRECTIONS_UNDER_SECTION_35A_READ",
    "client_name": "Sunrise Finserv NBFC Ltd.",
    "regulator": "RBI",
    "risk_level": "MEDIUM",
    "actions": 3,
    "rag_chunks": 5,
    "status": "pending_review"
  }
}
```

---

## Orchestrator — Pipeline Controller

**File:** `backend/orchestrator.py`
**Entry point:** `run_pipeline(simulate_mode)`

Controls the full end-to-end flow:

```
run_pipeline()
    │
    ├─ [1/3] MonitoringAgent
    │         → if 0 new docs → stop (no point running matcher/drafter)
    │
    ├─ [2/3] ClientMatcher
    │         → if 0 matches → stop (no advisories needed)
    │         → sort matches: HIGH → MEDIUM → LOW
    │         → cap at MAX_DRAFTS_PER_RUN = 20  (avoids Groq rate limit)
    │
    ├─ [3/3] DrafterAgent
    │         → generates one draft per (client × circular) pair
    │         → summary["drafts"] captured in finally block (always accurate)
    │
    └─ Log pipeline summary to audit trail
```

### Running Options

```bash
# Run once immediately
python orchestrator.py --run-now

# Run on a schedule (every 6 hours)
python orchestrator.py --schedule

# Run with simulated data (no real scraping)
python orchestrator.py --run-now --simulate

# Custom schedule interval
python orchestrator.py --schedule --interval 12
```

### Draft Cap

To avoid hitting Groq's free tier rate limit (100k tokens/day), drafts are capped at 20 per run. Matches are sorted by priority (HIGH first) so the most critical advisories are always generated first. Lower-priority items are skipped with a warning.

---

## Supporting Infrastructure

### ChromaDB Vectorstore

- Stored at `backend/vectorstore/` (gitignored — large binary files)
- Single collection: `compliance_docs`
- Each chunk stored with metadata: `{source, page, regulator, chunk_index}`
- Persists across runs — only new documents are ingested each time

### Hash Database — `seen_documents.json`

```json
{
  "https://rbi.org.in/...PR2327.PDF": "sha256hash...",
  "https://gstcouncil.gov.in/...circular-250.pdf": "sha256hash..."
}
```

Prevents the same circular from being downloaded, ingested, and drafted twice.

### Audit Trail — `audit.jsonl`

Every significant action across all agents is logged:
- `MonitoringAgent` → `scrape_complete`, `ingest_complete`, `scrape_fallback`
- `ClientMatcher` → `match_complete`
- `DrafterAgent` → `draft_generated`, `draft_approved`, `draft_rejected`
- `Orchestrator` → `pipeline_complete`

### Configuration — `config.py`

```python
EMBEDDING_MODEL     = "all-MiniLM-L6-v2"
CHROMA_COLLECTION   = "compliance_docs"
GROQ_MODEL          = "llama-3.3-70b-versatile"
CHUNK_SIZE          = 1500
CHUNK_OVERLAP       = 150
TOP_K               = 5
MIN_RELEVANCE_SCORE = 0.35
OCR_CHAR_THRESHOLD  = 50    # pages with fewer chars trigger OCR
```

---

## Full Data Flow (End to End)

```
1. RBI / GST websites
       │
       ▼
2. Playwright scraper (headless Chromium)
   - Waits for page elements
   - Extracts PDF links via JavaScript
       │
       ▼
3. Deduplication check (SHA-256 hash vs seen_documents.json)
   - Already seen? → skip
   - New? → download PDF to data/pdfs/
       │
       ▼
4. PDF ingestion (core/ingest.py)
   - pdfplumber extracts text
   - Tesseract OCR for scanned pages
   - Split into 1500-char chunks
   - Embedded → stored in ChromaDB
       │
       ▼
5. ClientMatcher (client_matcher.py)
   - Regulator tag filter
   - Content keyword rules
   - Priority scoring
   → Produces: circular × [affected clients] pairs
       │
       ▼
6. Draft cap + priority sort (orchestrator.py)
   - Sort HIGH → MEDIUM → LOW
   - Take top 20 match pairs
       │
       ▼
7. For each (client × circular) pair:
   │
   ├─ Hybrid RAG retrieval
   │   - Vector search (ChromaDB)
   │   - BM25 keyword search
   │   - RRF merge
   │   - Cross-encoder rerank
   │   → Top 5 relevant PDF chunks
   │
   ├─ Groq LLM Call 1 — Obligation extraction
   │   → Specific actions + deadline + risk level
   │
   ├─ Groq LLM Call 2 — Email drafting
   │   → Formal advisory email to client contact
   │
   └─ Save to data/drafts/{client_id}_{circular_id}.json
      Status: pending_review
       │
       ▼
8. CA reviews drafts in frontend
   - Approve → status: approved → ready to send
   - Reject  → status: rejected → discarded
```

---

## Current Scraper Coverage

| Regulator | Source | Status |
|---|---|---|
| RBI | Press Releases page | Working |
| RBI | Circulars & Notifications index | Working |
| GST | GST Council CGST Circulars | Working |
| IncomeTax | incometaxindia.gov.in | Not yet (0 links — JS-heavy page) |
| MCA | mca.gov.in | Not yet (0 links — JS-heavy page) |

---

## Environment Variables

Create a `.env` file in `backend/`:

```
GROQ_API_KEY=your_groq_api_key_here
```

Get a free Groq API key at `console.groq.com`. The free tier allows 100k tokens/day, which is sufficient for ~20 drafts per pipeline run.

---

## Running with Docker

```bash
# Build and start
docker compose up --build -d

# Run pipeline manually inside container
docker exec compliancegpt-backend python /app/orchestrator.py --run-now

# Run in simulate mode
docker exec compliancegpt-backend python /app/orchestrator.py --run-now --simulate

# View logs
docker logs compliancegpt-backend -f
```
