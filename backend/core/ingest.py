import re
import sys
import time
from pathlib import Path

_BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.append(str(_BACKEND_DIR))

import fitz
import pytesseract
from pdf2image import convert_from_path
from langchain_core.documents import Document
from sentence_transformers import SentenceTransformer
import chromadb

from config import (
    PDF_DIR, VECTORSTORE_DIR, EMBEDDING_MODEL,
    CHROMA_COLLECTION, CHUNK_SIZE, CHUNK_OVERLAP,
    OCR_CHAR_THRESHOLD, REGULATOR_KEYWORDS, REGULATOR_FILENAME_MAP
)
from core.audit import log_event


# ── Regulator Detection ───────────────────────────────────────────────────────

def detect_regulator(pdf_path: str, sample_text: str) -> str:
    filename_lower = Path(pdf_path).stem.lower()
    for prefix, tag in REGULATOR_FILENAME_MAP.items():
        if prefix in filename_lower:
            return tag
    text_lower = sample_text[:2000].lower()
    for regulator, keywords in REGULATOR_KEYWORDS.items():
        for kw in keywords:
            if kw in text_lower:
                return regulator
    return "Unknown"


# ── PDF Text Extraction ───────────────────────────────────────────────────────

def extract_text_pymupdf(pdf_path: str) -> tuple[list[dict], bool]:
    try:
        doc   = fitz.open(pdf_path)
        pages = []
        for page_num, page in enumerate(doc):
            text = page.get_text("text").strip()
            pages.append({"page": page_num, "text": text})
        doc.close()
        total_chars = sum(len(p["text"]) for p in pages)
        avg_chars   = total_chars / len(pages) if pages else 0
        needs_ocr   = avg_chars < OCR_CHAR_THRESHOLD
        return pages, needs_ocr
    except Exception as e:
        print(f"  ⚠️  PyMuPDF failed ({e}) — falling back to OCR")
        return [], True


def extract_text_ocr(pdf_path: str) -> list[dict]:
    print(f"  🔍 OCR triggered for: {Path(pdf_path).name}")
    images = convert_from_path(pdf_path, dpi=300)
    pages  = []
    for page_num, image in enumerate(images):
        text = pytesseract.image_to_string(image, lang="eng").strip()
        pages.append({"page": page_num, "text": text})
        print(f"    Page {page_num + 1}/{len(images)} OCR done — {len(text)} chars")
    return pages


def load_pdf_pages(pdf_path: str, max_retries: int = 2) -> tuple[list[dict], bool]:
    for attempt in range(max_retries + 1):
        try:
            pages, needs_ocr = extract_text_pymupdf(pdf_path)
            if needs_ocr:
                pages     = extract_text_ocr(pdf_path)
                needs_ocr = True
            if pages and any(p["text"] for p in pages):
                return pages, needs_ocr
        except Exception as e:
            if attempt == max_retries:
                print(f"  ❌ Failed after {max_retries} retries: {e}")
                return [], True
            print(f"  ⚠️  Retry {attempt + 1}/{max_retries}...")
            time.sleep(1)
    return [], True


# ── Structure-Aware Chunking ──────────────────────────────────────────────────

# Matches: "1.", "1.1", "Section 5", "CHAPTER 3", "A.", blank-line separators
_SECTION_PATTERN = re.compile(
    r'(?m)^(?:'
    r'\d+\.\d*\s+[A-Z]'           # "1. Heading" or "1.1 Heading"
    r'|(?:Section|SECTION|Clause|CLAUSE|Chapter|CHAPTER)\s+\d+'
    r'|[A-Z][A-Z\s]{4,}$'         # ALL-CAPS heading line
    r'|(?:\n\s*\n)'                # blank line separator
    r')'
)

def _split_by_structure(text: str) -> list[str]:
    """
    Split text on detected headings/section boundaries.
    Falls back to sentence-boundary splitting if no structure found.
    """
    splits = _SECTION_PATTERN.split(text)
    # Filter empty and very short splits (< 50 chars — likely just whitespace)
    splits = [s.strip() for s in splits if s and len(s.strip()) > 50]
    if not splits:
        # Fallback: split on double newlines
        splits = [s.strip() for s in text.split("\n\n") if s.strip()]
    return splits


def _merge_short_chunks(chunks: list[str], min_chars: int = 200) -> list[str]:
    """
    Merge consecutive short chunks so we don't embed tiny fragments.
    """
    merged = []
    buffer = ""
    for chunk in chunks:
        buffer = (buffer + "\n\n" + chunk).strip() if buffer else chunk
        if len(buffer) >= min_chars:
            merged.append(buffer)
            buffer = ""
    if buffer:
        merged.append(buffer)
    return merged


def _hard_split(text: str, max_chars: int) -> list[str]:
    """
    Split an oversized chunk at sentence boundaries.
    Used when a single structural section exceeds CHUNK_SIZE.
    """
    sentences = re.split(r'(?<=[.!?])\s+', text)
    parts, current = [], ""
    for sentence in sentences:
        if len(current) + len(sentence) + 1 <= max_chars:
            current = (current + " " + sentence).strip()
        else:
            if current:
                parts.append(current)
            current = sentence
    if current:
        parts.append(current)
    return parts if parts else [text]


def chunk_pages(pages: list[dict], source_name: str) -> list[Document]:
    """
    Structure-aware chunking pipeline:
    1. Split each page by detected headings/clauses/sections
    2. Merge tiny fragments (< 200 chars)
    3. Hard-split any chunk that exceeds CHUNK_SIZE at sentence boundaries
    Preserves source + page metadata on every chunk.
    """
    all_chunks = []

    for page in pages:
        raw_text = page["text"].strip()
        if not raw_text:
            continue

        # Step 1: structural split
        structural_chunks = _split_by_structure(raw_text)

        # Step 2: merge short fragments
        merged_chunks = _merge_short_chunks(structural_chunks, min_chars=200)

        # Step 3: hard-split oversized chunks
        final_chunks: list[str] = []
        for chunk in merged_chunks:
            if len(chunk) > CHUNK_SIZE:
                final_chunks.extend(_hard_split(chunk, CHUNK_SIZE))
            else:
                final_chunks.append(chunk)

        for chunk_text in final_chunks:
            if chunk_text.strip():
                all_chunks.append(Document(
                    page_content=chunk_text.strip(),
                    metadata={"source": source_name, "page": page["page"]}
                ))

    return all_chunks


# ── Duplicate Detection ───────────────────────────────────────────────────────

def _already_ingested(collection, pdf_stem: str) -> bool:
    try:
        result = collection.get(ids=[f"{pdf_stem}_chunk_0"])
        return len(result["ids"]) > 0
    except Exception:
        return False


# ── Main Ingest Function ──────────────────────────────────────────────────────

def ingest_pdf(pdf_path: str, force: bool = False):
    pdf_name = Path(pdf_path).name
    pdf_stem = Path(pdf_path).stem
    print(f"\n📄 Ingesting: {pdf_name}")

    client     = chromadb.PersistentClient(path=str(VECTORSTORE_DIR))
    collection = client.get_or_create_collection(name=CHROMA_COLLECTION)

    if not force and _already_ingested(collection, pdf_stem):
        print(f"  ⏭️  Already ingested — skipping (use force=True to re-ingest)")
        return

    pages, used_ocr = load_pdf_pages(pdf_path)
    total_chars     = sum(len(p["text"]) for p in pages)
    print(f"  {'🔎 OCR used' if used_ocr else '⚡ PyMuPDF used'} — {len(pages)} pages, {total_chars} chars")

    sample_text = " ".join(p["text"] for p in pages[:3])
    regulator   = detect_regulator(pdf_path, sample_text)
    print(f"  🏷️  Regulator tag: {regulator}")

    chunks = chunk_pages(pages, pdf_name)
    if not chunks:
        print(f"  ⚠️  No text extracted from {pdf_name} — skipping")
        log_event(agent="IngestAgent", action="pdf_skipped",
                  details={"file": pdf_name, "reason": "no_text_extracted", "used_ocr": used_ocr})
        return

    print(f"  ✂️  {len(chunks)} chunks created")

    model      = SentenceTransformer(EMBEDDING_MODEL)
    texts      = [chunk.page_content for chunk in chunks]
    embeddings = model.encode(texts, show_progress_bar=False).tolist()
    ids        = [f"{pdf_stem}_chunk_{i}" for i in range(len(texts))]
    metadatas  = [
        {
            "source":    pdf_name,
            "page":      chunk.metadata.get("page", 0),
            "regulator": regulator,
            "used_ocr":  str(used_ocr)
        }
        for chunk in chunks
    ]

    collection.upsert(ids=ids, embeddings=embeddings, documents=texts, metadatas=metadatas)
    print(f"  ✅ Stored {len(texts)} chunks [regulator={regulator}]")

    log_event(
        agent="IngestAgent", action="pdf_ingested",
        details={"file": pdf_name, "pages": len(pages), "chunks": len(chunks),
                 "regulator": regulator, "used_ocr": used_ocr, "total_chars": total_chars},
        citation=pdf_name
    )


if __name__ == "__main__":
    pdf_files = list(PDF_DIR.glob("*.pdf"))
    if not pdf_files:
        print("❌ No PDFs found in backend/data/pdfs/")
        sys.exit(1)
    print(f"📂 Found {len(pdf_files)} PDF(s)\n")
    for pdf in pdf_files:
        ingest_pdf(str(pdf))
    print("\n🎉 All PDFs ingested!")