import os
os.environ["CHROMA_DISABLE_TELEMETRY"] = "1"
os.environ["ANONYMIZED_TELEMETRY"]     = "False"

from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

# ── Paths ──────────────────────────────────────────────────────────────────────
BASE_DIR        = Path(__file__).resolve().parent
PDF_DIR         = BASE_DIR / "data" / "pdfs"
VECTORSTORE_DIR = BASE_DIR / "vectorstore"
LOGS_DIR        = BASE_DIR / "logs"

# ── Embedding model ────────────────────────────────────────────────────────────
EMBEDDING_MODEL = "all-MiniLM-L6-v2"

# ── ChromaDB ───────────────────────────────────────────────────────────────────
CHROMA_COLLECTION = "compliance_docs"

# ── Groq LLM ───────────────────────────────────────────────────────────────────
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
GROQ_MODEL   = "llama-3.3-70b-versatile"

# ── RAG ────────────────────────────────────────────────────────────────────────
CHUNK_SIZE          = 1500
CHUNK_OVERLAP       = 150
TOP_K               = 5
MIN_RELEVANCE_SCORE = 0.35

# ── OCR ────────────────────────────────────────────────────────────────────────
OCR_CHAR_THRESHOLD = 50

# ── Regulator Tags — used by ingest.py ────────────────────────────────────────
REGULATOR_KEYWORDS = {
    "RBI": [
        "reserve bank", "rbi", "monetary policy", "repo rate",
        "bank regulation", "nbfc", "fema", "foreign exchange"
    ],
    "GST": [
        "gst", "goods and services tax", "gst council",
        "input tax credit", "itc", "gstin", "e-way bill",
        "gstr", "composition scheme"
    ],
    "IncomeTax": [
        "income tax", "cbdt", "tds", "tcs", "itr",
        "advance tax", "pan", "assessment year", "section 80",
        "capital gains", "tax deduction"
    ],
    "MCA": [
        "mca", "ministry of corporate affairs", "companies act",
        "roc", "registrar of companies", "mca21", "llp"
    ],
    "SEBI": [
        "sebi", "securities", "stock exchange", "mutual fund",
        "demat", "nse", "bse", "ipo", "listed company"
    ],
}

REGULATOR_FILENAME_MAP = {
    "rbi":        "RBI",
    "gst":        "GST",
    "income_tax": "IncomeTax",
    "incometax":  "IncomeTax",
    "cbdt":       "IncomeTax",
    "mca":        "MCA",
    "sebi":       "SEBI",
    "fema":       "RBI",
}