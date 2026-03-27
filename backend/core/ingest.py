import re
import sys
import time
from pathlib import Path
from typing import Optional

_BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.append(str(_BACKEND_DIR))

try:
    import fitz
except ImportError:
    fitz = None

try:
    import pytesseract
except ImportError:
    pytesseract = None

try:
    from pdf2image import convert_from_path
except ImportError:
    convert_from_path = None
from langchain_core.documents import Document
# SentenceTransformer no longer imported here — we use the shared cached model
# from core.retriever via _get_embed_model() to avoid duplicate instances.

from config import (
    PDF_DIR, VECTORSTORE_DIR, EMBEDDING_MODEL,
    CHROMA_COLLECTION, CHUNK_SIZE, CHUNK_OVERLAP,
    OCR_CHAR_THRESHOLD, REGULATOR_KEYWORDS, REGULATOR_FILENAME_MAP
)
from core.audit import log_event
from core.chroma_client import get_persistent_client

# Import the cached model from retriever so ingest and retrieval always use
# the SAME SentenceTransformer instance. Instantiating a second model here
# (even from the same EMBEDDING_MODEL string) creates a separate object that
# can diverge if the model is updated mid-session, causing embedding mismatches.
# We do a lazy import inside ingest_pdf() to avoid circular-import issues at
# module load time.
def _get_embed_model():
    from core.retriever import _get_embedding_model
    return _get_embedding_model()


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
    if fitz is None:
        print("  ⚠️  PyMuPDF not installed — falling back to OCR")
        return [], True
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
    if convert_from_path is None or pytesseract is None:
        print("  ❌ OCR dependencies not installed")
        return []
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


def load_text_pages(text_path: str) -> tuple[list[dict], bool]:
    try:
        text = Path(text_path).read_text(encoding="utf-8").strip()
    except Exception as e:
        print(f"  ❌ Failed to read text document: {e}")
        return [], False
    if not text:
        return [], False
    return [{"page": 0, "text": text}], False


def extract_document_metadata(
    pdf_path: str,
    pages: list[dict],
    regulator: str,
    title_override: Optional[str] = None,
    url_override: Optional[str] = None,
) -> dict:
    metadata = {
        "title": Path(pdf_path).stem.replace("_", " ").replace("-", " ").title(),
        "document_date": None,
        "url": None,
        "regulator": regulator,
    }
    if Path(pdf_path).suffix.lower() != ".txt" or not pages:
        return metadata

    header_lines = pages[0]["text"].splitlines()[:12]
    for line in header_lines:
        if ":" not in line:
            continue
        key, value = [part.strip() for part in line.split(":", 1)]
        lowered = key.lower()
        if lowered == "title" and value:
            metadata["title"] = value
        elif lowered in {"generated", "date"} and value:
            metadata["document_date"] = value
        elif lowered == "url" and value:
            metadata["url"] = value
        elif lowered == "regulator" and value:
            metadata["regulator"] = value

    if title_override:
        metadata["title"] = title_override.strip()
    if url_override:
        metadata["url"] = url_override.strip()

    return metadata


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


def _merge_short_chunks(chunks: list[str], min_chars: int = 200, page: int = 0) -> list[str]:
    """
    Merge consecutive short chunks so we don't embed tiny fragments.
    """
    # Page 1 headers are often short but carry critical metadata
    # (circular no., reference no., date), so use a lower merge threshold.
    if page == 0:
        min_chars = 60

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

        if page["page"] == 0:
            header_text = raw_text[:400].strip()
            if header_text:
                all_chunks.append(
                    Document(
                        page_content=header_text,
                        metadata={
                            "source": source_name,
                            "page": 0,
                            "chunk_type": "header",
                        },
                    )
                )

        # Step 1: structural split
        structural_chunks = _split_by_structure(raw_text)

        # Step 2: merge short fragments
        merged_chunks = _merge_short_chunks(structural_chunks, min_chars=200, page=page["page"])

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

def ingest_pdf(
    pdf_path: str,
    force: bool = False,
    regulator_override: Optional[str] = None,
    title_override: Optional[str] = None,
    url_override: Optional[str] = None,
):
    pdf_name = Path(pdf_path).name
    pdf_stem = Path(pdf_path).stem
    file_suffix = Path(pdf_path).suffix.lower()
    print(f"\n📄 Ingesting: {pdf_name}")

    client     = get_persistent_client(VECTORSTORE_DIR)
    collection = client.get_or_create_collection(name=CHROMA_COLLECTION)

    if not force and _already_ingested(collection, pdf_stem):
        print(f"  ⏭️  Already ingested — skipping (use force=True to re-ingest)")
        return {
            "status": "skipped",
            "file": pdf_name,
            "pages": 0,
            "chunks": 0,
            "regulator": regulator_override or "Unknown",
            "title": title_override or Path(pdf_path).stem,
            "first_chunk_preview": "",
        }

    if file_suffix == ".txt":
        pages, used_ocr = load_text_pages(pdf_path)
        extractor_label = "📝 Text file used"
    else:
        pages, used_ocr = load_pdf_pages(pdf_path)
        extractor_label = "🔎 OCR used" if used_ocr else "⚡ PyMuPDF used"
    total_chars     = sum(len(p["text"]) for p in pages)
    print(f"  {extractor_label} — {len(pages)} pages, {total_chars} chars")

    sample_text = " ".join(p["text"] for p in pages[:3])
    regulator   = regulator_override or detect_regulator(pdf_path, sample_text)
    doc_meta    = extract_document_metadata(
        pdf_path,
        pages,
        regulator,
        title_override=title_override,
        url_override=url_override,
    )
    print(f"  🏷️  Regulator tag: {regulator}")

    chunks = chunk_pages(pages, pdf_name)
    if not chunks:
        print(f"  ⚠️  No text extracted from {pdf_name} — skipping")
        log_event(agent="IngestAgent", action="pdf_skipped",
                  details={"file": pdf_name, "reason": "no_text_extracted", "used_ocr": used_ocr})
        return {
            "status": "skipped",
            "file": pdf_name,
            "pages": len(pages),
            "chunks": 0,
            "regulator": regulator,
            "title": doc_meta["title"],
            "first_chunk_preview": "",
        }

    print(f"  ✂️  {len(chunks)} chunks created")

    # Use the shared cached embedding model from retriever.
    # This ensures ingest and query use the IDENTICAL model instance — critical
    # for vector-space consistency. A fresh SentenceTransformer() here would
    # create a separate object that can drift if the model is updated mid-session.
    model      = _get_embed_model()
    texts      = [chunk.page_content for chunk in chunks]
    embeddings = model.encode(texts, show_progress_bar=False).tolist()
    ids        = [f"{pdf_stem}_chunk_{i}" for i in range(len(texts))]
    metadatas  = [
        {
            "source":    pdf_name,
            "page":      chunk.metadata.get("page", 0),
            "regulator": doc_meta["regulator"],
            "title":     doc_meta["title"],
            "document_date": doc_meta["document_date"] or "",
            "url":       doc_meta["url"] or "",
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

    preview = ""
    if texts:
        preview = re.sub(r"\s+", " ", texts[0]).strip()[:400]

    return {
        "status": "ingested",
        "file": pdf_name,
        "pages": len(pages),
        "chunks": len(chunks),
        "regulator": regulator,
        "title": doc_meta["title"],
        "document_date": doc_meta["document_date"],
        "url": doc_meta["url"],
        "used_ocr": used_ocr,
        "total_chars": total_chars,
        "first_chunk_preview": preview,
    }


if __name__ == "__main__":
    pdf_files = list(PDF_DIR.glob("*.pdf")) + list(PDF_DIR.glob("*.txt"))
    if not pdf_files:
        print("❌ No ingestible documents found in backend/data/pdfs/")
        sys.exit(1)
    print(f"📂 Found {len(pdf_files)} ingestible document(s)\n")
    for pdf in pdf_files:
        ingest_pdf(str(pdf))
    print("\n🎉 All PDFs ingested!")
