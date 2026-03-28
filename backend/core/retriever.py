import json
import math
import re
import sys
from datetime import datetime
from functools import lru_cache
from pathlib import Path
from typing import Optional

_BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.append(str(_BACKEND_DIR))

from groq import Groq
from rank_bm25 import BM25Okapi
from sentence_transformers import CrossEncoder, SentenceTransformer

from config import (
    CHROMA_COLLECTION,
    EMBEDDING_MODEL,
    GROQ_API_KEY,
    GROQ_MODEL,
    MIN_RELEVANCE_SCORE,
    PDF_DIR,
    TOP_K,
    VECTORSTORE_DIR,
)
from core.audit import log_event
from core.chroma_client import get_persistent_client

_TEMPORAL_PATTERN = re.compile(r"\b(latest|current|today|yesterday|tomorrow|recent|new|newest|as of now)\b", re.IGNORECASE)
_ISO_DATE_PATTERN = re.compile(r"\d{4}-\d{2}-\d{2}")
_INLINE_SOURCE_PATTERN = re.compile(r"\[(S\d+(?:,\s*S\d+)*)\]")
_WORD_PATTERN = re.compile(r"[a-z0-9]{2,}")
_DOC_SCOPE_PATTERN = re.compile(r"\b(this|that|above|previous|same)\b", re.IGNORECASE)
_SUMMARY_PATTERN = re.compile(r"\b(summary|summarize|important points|key points|alerts|points to note|highlights|main points)\b", re.IGNORECASE)
_DEADLINE_QUERY_PATTERN = re.compile(r"\b(when is|what date|deadline|due date|effective date|effective from|applicable from|extension)\b", re.IGNORECASE)
_GENERIC_DATE_QUERY_PATTERN = re.compile(r"\b(date of|what is the date|what's the date|dated)\b", re.IGNORECASE)
_CIRCULAR_DATE_QUERY_PATTERN = re.compile(r"\b(date of (this )?(rbi )?circular|circular date|date of this circular)\b", re.IGNORECASE)
_CIRCULAR_REF_PATTERN = re.compile(
    r"\b(circular number|circular no|circular ref|reference number|rbi number|what is the circular)\b",
    re.IGNORECASE,
)
_RATE_QUERY_PATTERN = re.compile(r"\b(what rate|which rate|rate mentioned|what percent|what percentage|rate of)\b", re.IGNORECASE)
_DATE_VALUE_PATTERN = re.compile(
    r"\b(?:\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{4}|"
    r"(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2},\s+\d{4}|"
    r"\d{4}-\d{2}-\d{2})\b",
    re.IGNORECASE,
)
_DURATION_VALUE_PATTERN = re.compile(r"\b\d+\s+(?:day|days|month|months|year|years)\b", re.IGNORECASE)
_RATE_VALUE_PATTERN = re.compile(r"\b\d+(?:\.\d+)?\s*%\b")
_CIRCULAR_REF_VALUE_PATTERN = re.compile(
    r"\b(?:RBI/\d{4}-\d{2}/\d+|CO\.[A-Za-z0-9.]+\.[A-Za-z0-9.]+\.No\.[A-Za-z0-9.-]+(?:/[A-Za-z0-9.-]+)+)\b",
    re.IGNORECASE,
)
_MAX_QUERY_VARIANTS = 6
_MIN_FETCH_K = 8
_MAX_FETCH_K = 16
# Lowered from 75 → 20: the old value caused keyword-heavy queries to miss on
# small corpora because the bypass path returns fake positional RRF with no BM25.
_SMALL_CORPUS_THRESHOLD = 20
_MEDIUM_CORPUS_THRESHOLD = 300
_MAX_RERANK_CANDIDATES = 10

_STOPWORDS = {
    "the", "and", "for", "what", "which", "when", "where", "does", "about", "from", "with",
    "that", "this", "there", "into", "have", "will", "your", "their", "them", "they", "been",
    "are", "was", "were", "has", "had", "its", "any", "all", "new", "latest", "current",
}
_DOMAIN_ALIASES = {
    "fema": ["foreign exchange management act", "fema"],
    "ims": ["invoice management system", "ims"],
    "gst": ["goods and services tax", "gst"],
    "tds": ["tax deduction at source", "tds"],
    "194c": ["194c", "section 194c"],
    "194j": ["194j", "section 194j"],
    "llp": ["llp", "limited liability partnership"],
    "esg": ["esg", "environmental, social, and governance"],
    "rbi": ["reserve bank of india", "rbi"],
    "cbdt": ["cbdt", "income tax"],
    "sebi": ["sebi", "securities and exchange board of india"],
}
_CONCEPT_TERMS = {
    "deadline": ["deadline", "due date", "timeline"],
    "extension": ["extended", "extension", "extended by"],
    "advisory": ["advisory", "circular", "notification"],
    "affected": ["affected", "applies to", "relevant to", "covered"],
    "summary": ["summary", "overview", "what changed", "key change"],
    "rate_change": ["rate", "revised", "revision", "changed"],
}
_DISPLAY_LABELS = {
    "fema": "FEMA",
    "ims": "Invoice Management System (IMS)",
    "gst": "GST",
    "tds": "TDS",
    "194c": "Section 194C",
    "194j": "Section 194J",
    "llp": "LLP",
    "esg": "ESG",
    "rbi": "RBI",
    "cbdt": "CBDT",
    "sebi": "SEBI",
    "deadline": "deadline",
    "extension": "extension",
    "advisory": "advisory",
    "affected": "applicability",
    "summary": "summary",
    "rate_change": "rate change",
}


@lru_cache(maxsize=1)
def _get_embedding_model() -> Optional[SentenceTransformer]:
    try:
        return SentenceTransformer(EMBEDDING_MODEL)
    except Exception as exc:
        print(f"Warning: embedding model unavailable ({EMBEDDING_MODEL}): {exc}")
        return None


@lru_cache(maxsize=1)
def _get_cross_encoder() -> Optional[CrossEncoder]:
    try:
        return CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2")
    except Exception as exc:
        print("Warning: cross-encoder unavailable (cross-encoder/ms-marco-MiniLM-L-6-v2):", exc)
        return None


# Module-level singleton — NOT lru_cache.
# lru_cache caused stale-state bugs: after an upload, ingest_pdf writes chunks
# via its own ChromaDB client instance, but the cached collection object here
# still pointed to the old connection and missed the new chunks intermittently.
# invalidate_collection_cache() is called by app.py after every successful
# upload so the next query_rag() always opens a fresh connection.
_collection_singleton = None


def _get_collection():
    global _collection_singleton
    if _collection_singleton is None:
        client = get_persistent_client(VECTORSTORE_DIR)
        _collection_singleton = client.get_or_create_collection(name=CHROMA_COLLECTION)
    return _collection_singleton


def invalidate_collection_cache() -> None:
    """
    Drop the cached collection handle.
    Call this immediately after any ingest_pdf() call so the next
    query_rag() opens a fresh connection and sees the new chunks.
    Zero performance cost — re-fetched once on next query only.
    """
    global _collection_singleton
    _collection_singleton = None


def _safe_date(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    text = value.strip()
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None


def _humanize_title(source_name: str) -> str:
    stem = Path(source_name).stem
    label = re.sub(r"[_\-]+", " ", stem).strip()
    return label.title() if label else source_name


def _normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", value.lower()).strip()


def _contains_phrase(text: str, phrase: str) -> bool:
    return _normalize_text(phrase) in _normalize_text(text)


def _extract_query_signals(question: str) -> dict:
    lower = question.lower()
    entities = []
    concepts = []

    for key, variants in _DOMAIN_ALIASES.items():
        if any(variant in lower for variant in variants):
            entities.append(key)

    for key, variants in _CONCEPT_TERMS.items():
        if any(variant in lower for variant in variants):
            concepts.append(key)

    keywords = [
        token
        for token in _WORD_PATTERN.findall(lower)
        if token not in _STOPWORDS and len(token) >= 3
    ]
    return {
        "entities": list(dict.fromkeys(entities)),
        "concepts": list(dict.fromkeys(concepts)),
        "keywords": list(dict.fromkeys(keywords)),
    }


@lru_cache(maxsize=256)
def _read_source_metadata(source_name: str) -> dict:
    path = PDF_DIR / source_name
    base = {
        "source": source_name,
        "title": _humanize_title(source_name),
        "regulator": "Unknown",
        "document_date": None,
        "url": None,
    }
    if not path.exists() or path.suffix.lower() != ".txt":
        prefix = Path(source_name).stem.lower()
        if prefix.startswith("rbi") or "fema" in prefix:
            base["regulator"] = "RBI"
        elif prefix.startswith("gst"):
            base["regulator"] = "GST"
        elif prefix.startswith("mca"):
            base["regulator"] = "MCA"
        elif prefix.startswith("sebi"):
            base["regulator"] = "SEBI"
        elif prefix.startswith("incometax") or prefix.startswith("income_tax") or prefix.startswith("cbdt"):
            base["regulator"] = "IncomeTax"
        return base

    try:
        lines = path.read_text(encoding="utf-8").splitlines()[:12]
    except Exception:
        return base

    for line in lines:
        if ":" not in line:
            continue
        key, value = [part.strip() for part in line.split(":", 1)]
        lowered = key.lower()
        if lowered == "regulator" and value:
            base["regulator"] = value
        elif lowered == "title" and value:
            base["title"] = value
        elif lowered in {"generated", "date"} and value:
            match = _ISO_DATE_PATTERN.search(value)
            base["document_date"] = match.group(0) if match else value
        elif lowered == "url" and value:
            base["url"] = value

    return base


def _enrich_metadata(meta: Optional[dict]) -> dict:
    meta = dict(meta or {})
    source_name = meta.get("source", "Unknown")
    file_meta = _read_source_metadata(source_name)
    enriched = {
        "source": source_name,
        "page": int(meta.get("page", 0) or 0),
        "regulator": meta.get("regulator") or file_meta.get("regulator") or "Unknown",
        "title": meta.get("title") or file_meta.get("title") or _humanize_title(source_name),
        "document_date": meta.get("document_date") or file_meta.get("document_date"),
        "url": meta.get("url") or file_meta.get("url"),
        "used_ocr": meta.get("used_ocr"),
    }
    enriched["page_label"] = enriched["page"] + 1
    return enriched


def _matches_filters(meta: dict, filters: Optional[dict]) -> bool:
    if not filters:
        return True

    enriched = _enrich_metadata(meta)
    regulator = (filters.get("regulator") or "").strip().lower()
    title_contains = (filters.get("title_contains") or "").strip().lower()
    source_name = (filters.get("source") or "").strip().lower()
    title_lower = enriched["title"].lower()
    source_lower = enriched["source"].lower()

    if regulator and enriched["regulator"].lower() != regulator:
        return False
    if title_contains:
        # Support comma/semicolon/pipe separated keywords as OR conditions.
        title_terms = [
            term.strip()
            for term in re.split(r"[,;|]", title_contains)
            if term.strip()
        ]
        if not title_terms:
            title_terms = [title_contains]

        if not any(term in title_lower or term in source_lower for term in title_terms):
            return False
    if source_name and enriched["source"].lower() != source_name:
        return False

    doc_date = _safe_date(enriched.get("document_date"))
    date_from = _safe_date(filters.get("date_from"))
    date_to = _safe_date(filters.get("date_to"))

    if (date_from or date_to) and doc_date is None:
        return False
    if date_from and doc_date and doc_date < date_from:
        return False
    if date_to and doc_date and doc_date > date_to:
        return False
    return True


def _is_summary_request(question: str) -> bool:
    return bool(_SUMMARY_PATTERN.search(question))


def _should_use_active_document(question: str, active_document: Optional[str]) -> bool:
    if not active_document:
        return False
    lower = question.lower().strip()
    return bool(_DOC_SCOPE_PATTERN.search(lower))


def _apply_active_document(filters: Optional[dict], question: str, active_document: Optional[str]) -> tuple[dict, bool]:
    next_filters = dict(filters or {})
    if _should_use_active_document(question, active_document):
        next_filters["source"] = active_document
        return next_filters, True
    return next_filters, False


def _classify_question_type(question: str) -> str:
    lower = question.lower().strip()
    if any(token in lower for token in ["impact", "affect", "obligation", "should", "recommend", "compare", "difference", "why", "how does"]):
        return "REASONING"
    if _CIRCULAR_REF_PATTERN.search(lower):
        return "REFERENCE_EXTRACTION"
    if _RATE_QUERY_PATTERN.search(lower):
        return "RATE_EXTRACTION"
    if _DEADLINE_QUERY_PATTERN.search(lower):
        return "DEADLINE_EXTRACTION"
    # Handle common CA phrasing: "What is the date of this RBI circular?"
    if _GENERIC_DATE_QUERY_PATTERN.search(lower):
        return "DEADLINE_EXTRACTION"
    return "REASONING"


def expand_query(user_question: str) -> list[str]:
    base = user_question.strip()
    lower = base.lower()
    variants = [base]

    compliance_aliases = {
        "fema": ["foreign exchange management act", "authorised dealer", "softex", "export proceeds"],
        "gst": ["goods and services tax", "gstr", "input tax credit", "itc"],
        "tds": ["tax deduction at source", "section 194c", "section 194j", "cbdt"],
        "ims": ["invoice management system", "ims"],
        "rbi": ["reserve bank of india", "nbfc", "bank"],
        "mca": ["ministry of corporate affairs", "roc", "llp"],
        "sebi": ["listed entity", "securities", "disclosure"],
        "deadline": ["due date", "effective date", "compliance timeline"],
        "circular": ["notification", "advisory", "direction"],
    }

    for term, extras in compliance_aliases.items():
        if term in lower:
            variants.extend(extras)

    if _TEMPORAL_PATTERN.search(lower):
        variants.extend(["effective date", "deadline", "applicable from", "extended until"])
    if re.search(r"\bcircular\s*(number|no\.?|ref|reference)\b", lower):
        variants.extend(["RBI/", "CO.DGBA", "circular number", "reference number", "rbi circular", "circular no"])
    if "who" in lower or "applicable" in lower or "affected" in lower:
        variants.extend(["applies to", "relevant to", "entities covered"])

    deduped = []
    seen = set()
    for variant in variants:
        normalized = variant.lower().strip()
        if normalized and normalized not in seen:
            deduped.append(variant)
            seen.add(normalized)
    return deduped[:_MAX_QUERY_VARIANTS]


def _text_support(item: dict, signals: dict) -> dict:
    meta = _enrich_metadata(item["meta"])
    searchable = " ".join([item["doc"], meta["title"], meta["source"], meta["regulator"]]).lower()
    matched_entities = [
        entity
        for entity in signals["entities"]
        if any(phrase in searchable for phrase in _DOMAIN_ALIASES.get(entity, [entity]))
    ]
    matched_concepts = [
        concept
        for concept in signals["concepts"]
        if any(phrase in searchable for phrase in _CONCEPT_TERMS.get(concept, [concept]))
    ]
    exact_keyword_hits = [keyword for keyword in signals["keywords"] if keyword in searchable]
    return {
        "matched_entities": matched_entities,
        "matched_concepts": matched_concepts,
        "keyword_hits": exact_keyword_hits,
        "support_score": len(matched_entities) * 4 + len(matched_concepts) * 3 + len(exact_keyword_hits),
    }


def _hybrid_search(collection, model: SentenceTransformer, queries: list[str], fetch_k: int, filters: Optional[dict]) -> dict[str, dict]:
    vector_results: dict[str, dict] = {}
    query_embeddings = model.encode(queries).tolist()
    for qtext, q_emb in zip(queries, query_embeddings):
        results = collection.query(
            query_embeddings=[q_emb],
            n_results=fetch_k,
            include=["documents", "metadatas", "distances"],
        )
        for doc, meta, dist, cid in zip(
            results["documents"][0],
            results["metadatas"][0],
            results["distances"][0],
            results["ids"][0],
        ):
            if not _matches_filters(meta, filters):
                continue
            if cid not in vector_results or dist < vector_results[cid]["dist"]:
                vector_results[cid] = {"doc": doc, "meta": meta, "dist": dist, "id": cid}

    corpus_result = collection.get(include=["documents", "metadatas"])
    filtered_corpus = [
        (doc, meta, cid)
        for doc, meta, cid in zip(corpus_result["documents"], corpus_result["metadatas"], corpus_result["ids"])
        if _matches_filters(meta, filters)
    ]
    if not filtered_corpus:
        return {}

    filtered_count = len(filtered_corpus)
    if filtered_count <= _SMALL_CORPUS_THRESHOLD:
        return {
            cid: {
                "doc": entry["doc"],
                "meta": entry["meta"],
                "rrf_score": 1 / (index + 1),
            }
            for index, (cid, entry) in enumerate(
                sorted(vector_results.items(), key=lambda item: item[1]["dist"])[:fetch_k]
            )
        }

    tokenized_corpus = [doc.lower().split() for doc, _, _ in filtered_corpus]
    bm25 = BM25Okapi(tokenized_corpus)

    bm25_results: dict[str, dict] = {}
    bm25_fetch_k = fetch_k if filtered_count <= _MEDIUM_CORPUS_THRESHOLD else min(fetch_k, 12)
    for qtext in queries:
        scores = bm25.get_scores(qtext.lower().split())
        top_indices = sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)[:bm25_fetch_k]
        for idx in top_indices:
            doc, meta, cid = filtered_corpus[idx]
            if cid not in bm25_results or scores[idx] > bm25_results[cid].get("bm25_score", 0):
                bm25_results[cid] = {
                    "doc": doc,
                    "meta": meta,
                    "bm25_score": scores[idx],
                    "id": cid,
                }

    rrf_scores: dict[str, float] = {}
    for rank, entry in enumerate(sorted(vector_results.values(), key=lambda x: x["dist"])):
        rrf_scores[entry["id"]] = rrf_scores.get(entry["id"], 0.0) + 1 / (60 + rank + 1)
    for rank, entry in enumerate(sorted(bm25_results.values(), key=lambda x: x["bm25_score"], reverse=True)):
        rrf_scores[entry["id"]] = rrf_scores.get(entry["id"], 0.0) + 1 / (60 + rank + 1)

    merged: dict[str, dict] = {}
    for cid, entry in {**vector_results, **bm25_results}.items():
        merged[cid] = {
            "doc": entry["doc"],
            "meta": entry["meta"],
            "rrf_score": rrf_scores.get(cid, 0.0),
        }
    return merged


def _score_candidate_precision(question: str, candidate: dict) -> float:
    signals = _extract_query_signals(question)
    support = _text_support(candidate, signals)
    meta = _enrich_metadata(candidate["meta"])
    title_lower = meta["title"].lower()
    precision = support["support_score"]

    for entity in signals["entities"]:
        if any(phrase in title_lower for phrase in _DOMAIN_ALIASES.get(entity, [])):
            precision += 6
    for concept in signals["concepts"]:
        if any(phrase in title_lower for phrase in _CONCEPT_TERMS.get(concept, [])):
            precision += 3
    return precision


def _rerank(question: str, candidates: list[dict], top_n: int) -> list[dict]:
    if not candidates:
        return []
    limited_candidates = sorted(
        candidates,
        key=lambda item: item.get("rrf_score", 0.0),
        reverse=True,
    )[:_MAX_RERANK_CANDIDATES]
    cross_encoder = _get_cross_encoder()
    if cross_encoder is None:
        for candidate in limited_candidates:
            candidate["ce_score"] = float(candidate.get("rrf_score", 0.0))
            candidate["precision_score"] = _score_candidate_precision(question, candidate)
            candidate["combined_score"] = candidate["ce_score"] + (candidate["precision_score"] * 0.15)
        return sorted(limited_candidates, key=lambda item: item["combined_score"], reverse=True)[:top_n]

    scores = cross_encoder.predict([(question, candidate["doc"]) for candidate in limited_candidates])
    for index, candidate in enumerate(limited_candidates):
        candidate["ce_score"] = float(scores[index])
        candidate["precision_score"] = _score_candidate_precision(question, candidate)
        candidate["combined_score"] = candidate["ce_score"] + (candidate["precision_score"] * 0.15)
    return sorted(limited_candidates, key=lambda item: item["combined_score"], reverse=True)[:top_n]


def _sigmoid(value: float) -> float:
    return 1 / (1 + math.exp(-value))


def _make_snippet(text: str, question: str, max_chars: int = 220) -> str:
    clean_text = " ".join(text.split())
    if len(clean_text) <= max_chars:
        return clean_text

    terms = [
        term
        for term in _WORD_PATTERN.findall(question.lower())
        if term not in _STOPWORDS and len(term) >= 3
    ]
    lower_text = clean_text.lower()
    for term in terms:
        position = lower_text.find(term)
        if position >= 0:
            start = max(position - 55, 0)
            end = min(position + max_chars - 55, len(clean_text))
            snippet = clean_text[start:end].strip()
            if start > 0:
                snippet = "..." + snippet
            if end < len(clean_text):
                snippet += "..."
            return snippet
    return clean_text[: max_chars - 3].rstrip() + "..."


def _split_sentences(text: str) -> list[str]:
    compact = re.sub(r"\s+", " ", text).strip()
    if not compact:
        return []
    parts = re.split(r"(?<=[.!?])\s+|\s{2,}|(?<=:)\s+", compact)
    return [part.strip() for part in parts if part.strip()]


def _question_keywords(question: str) -> list[str]:
    return [
        token
        for token in _WORD_PATTERN.findall(question.lower())
        if token not in _STOPWORDS and len(token) >= 3
    ]


def _sentence_relevance(sentence: str, question: str) -> int:
    sentence_lower = sentence.lower()
    return sum(1 for token in _question_keywords(question) if token in sentence_lower)


def _has_strong_fast_path_support(signals: dict, support: dict) -> bool:
    required_entities = signals["entities"]
    if required_entities and not all(entity in support["matched_entities"] for entity in required_entities):
        return False

    required_concepts = signals["concepts"]
    if required_concepts and not all(concept in support["matched_concepts"] for concept in required_concepts):
        return False

    return True


def _deadline_query_preferences(question: str) -> dict:
    lower = question.lower()
    wants_date = any(
        phrase in lower
        for phrase in [
            "what date",
            "what is the date",
            "what's the date",
            "date of",
            "dated",
            "when is",
            "effective date",
            "effective from",
            "applicable from",
        ]
    )
    wants_extension = "extension" in lower or "extended" in lower
    wants_duration = wants_extension and not wants_date
    return {
        "wants_date": wants_date,
        "wants_extension": wants_extension,
        "wants_duration": wants_duration,
        "wants_circular_issue_date": bool(_CIRCULAR_DATE_QUERY_PATTERN.search(lower)),
    }


def _pick_circular_issue_date(question: str, reranked: list[dict], sources: list[dict]) -> Optional[dict]:
    """
    Prefer the circular's issue date (usually page 1 header), not historical dates
    listed inside annex tables.
    """
    preferences = _deadline_query_preferences(question)
    if not preferences["wants_circular_issue_date"]:
        return None

    best = None
    best_score = -10**9
    pairs = list(zip(reranked[:6], sources[:6]))

    def evaluate_pairs(candidates: list[tuple[dict, dict]]) -> tuple[Optional[dict], int]:
        local_best = None
        local_best_score = -10**9
        for candidate, source in candidates:
            sentences = _split_sentences(candidate["doc"])
            for sentence in sentences[:14]:
                date_match = _DATE_VALUE_PATTERN.search(sentence)
                if not date_match:
                    continue

                s_lower = sentence.lower()
                score = 0

                # Issue dates are usually on page 1 headers.
                if int(source.get("page", 999)) <= 1:
                    score += 12
                elif int(source.get("page", 999)) <= 2:
                    score += 4

                # Positive issue-date cues.
                if any(token in s_lower for token in [" dated ", " dated", "rbi/", "master circular", "on the above subject"]):
                    score += 6
                if "reserve bank of india" in s_lower:
                    score += 2

                # Strong negative cues for annex/history/table rows.
                if any(
                    token in s_lower
                    for token in ["annex", "list of circulars", "consolidated", "subject", "circular no.", "agency commission"]
                ):
                    score -= 15

                # Prefer top-ranked sources as tie-breaker.
                score += max(0, 4 - (int(source["source_id"][1:]) - 1))

                if score > local_best_score:
                    local_best_score = score
                    local_best = {
                        "answer": f"The circular is dated {date_match.group(0)} [{source['source_id']}]",
                        "source_ids": [source["source_id"]],
                    }
        return local_best, local_best_score

    # Pass 1: Strictly prefer page-1/2 evidence for "this circular" date.
    page_pref_pairs = [
        (candidate, source)
        for candidate, source in pairs
        if int(source.get("page", 999)) <= 2
    ]
    if page_pref_pairs:
        best, best_score = evaluate_pairs(page_pref_pairs)
        if best:
            return best

    # Pass 2: fallback over remaining candidates.
    best, best_score = evaluate_pairs(pairs)
    if best:
        return best

    return None


def _extract_deadline_answer(question: str, reranked: list[dict], sources: list[dict]) -> Optional[dict]:
    issue_date = _pick_circular_issue_date(question, reranked, sources)
    if issue_date:
        return issue_date

    preferences = _deadline_query_preferences(question)
    keywords = ["deadline", "due date", "effective", "applicable", "extended", "extension", "date", "dated"]
    signals = _extract_query_signals(question)

    for candidate, source in zip(reranked[:3], sources[:3]):
        support = _text_support(candidate, signals)
        if not _has_strong_fast_path_support(signals, support):
            continue
        sentences = _split_sentences(candidate["doc"])
        ranked_sentences = sorted(sentences, key=lambda sentence: _sentence_relevance(sentence, question), reverse=True)
        for sentence in ranked_sentences[:6]:
            sentence_lower = sentence.lower()
            if not any(keyword in sentence_lower for keyword in keywords):
                continue

            duration_match = _DURATION_VALUE_PATTERN.search(sentence)
            date_match = _DATE_VALUE_PATTERN.search(sentence)

            if preferences["wants_extension"] and duration_match and ("extend" in sentence_lower or "extension" in sentence_lower):
                return {
                    "answer": f"The document states the deadline was extended by {duration_match.group(0)} [{source['source_id']}]",
                    "source_ids": [source["source_id"]],
                }
            if date_match:
                label = "deadline" if "deadline" in sentence_lower or "due date" in sentence_lower else "effective date"
                return {
                    "answer": f"The {label} mentioned is {date_match.group(0)} [{source['source_id']}]",
                    "source_ids": [source["source_id"]],
                }
            if preferences["wants_duration"] and duration_match:
                return {
                    "answer": f"The time period mentioned is {duration_match.group(0)} [{source['source_id']}]",
                    "source_ids": [source["source_id"]],
                }
    return None


def _extract_rate_answer(question: str, reranked: list[dict], sources: list[dict]) -> Optional[dict]:
    keywords = ["rate", "rates", "percent", "percentage"]
    signals = _extract_query_signals(question)

    for candidate, source in zip(reranked[:3], sources[:3]):
        support = _text_support(candidate, signals)
        if not _has_strong_fast_path_support(signals, support):
            continue
        sentences = _split_sentences(candidate["doc"])
        ranked_sentences = sorted(sentences, key=lambda sentence: _sentence_relevance(sentence, question), reverse=True)
        for sentence in ranked_sentences[:6]:
            sentence_lower = sentence.lower()
            if not any(keyword in sentence_lower for keyword in keywords):
                continue

            rate_match = _RATE_VALUE_PATTERN.search(sentence)
            if rate_match:
                return {
                    "answer": f"The rate mentioned is {rate_match.group(0)} [{source['source_id']}]",
                    "source_ids": [source["source_id"]],
                }
    return None


def _extract_circular_reference(question: str, reranked: list[dict], sources: list[dict]) -> Optional[dict]:
    preferred_tokens = ("rbi/", "co.dgba")

    # Prefer page-1/2 header evidence first.
    for candidate, source in zip(reranked[:6], sources[:6]):
        if int(source.get("page", 999)) > 2:
            continue
        matches = _CIRCULAR_REF_VALUE_PATTERN.findall(candidate["doc"])
        if not matches:
            continue

        deduped = []
        for value in matches:
            if value not in deduped:
                deduped.append(value)

        deduped.sort(key=lambda value: (0 if any(token in value.lower() for token in preferred_tokens) else 1, value.lower()))
        reference_text = "; ".join(deduped[:2])
        return {
            "answer": f"The circular reference is {reference_text} [{source['source_id']}]",
            "source_ids": [source["source_id"]],
        }

    # Fallback across the top reranked chunks.
    for candidate, source in zip(reranked[:6], sources[:6]):
        matches = _CIRCULAR_REF_VALUE_PATTERN.findall(candidate["doc"])
        if not matches:
            continue
        deduped = []
        for value in matches:
            if value not in deduped:
                deduped.append(value)
        reference_text = "; ".join(deduped[:2])
        return {
            "answer": f"The circular reference is {reference_text} [{source['source_id']}]",
            "source_ids": [source["source_id"]],
        }
    return None


def _try_fast_path(question: str, reranked: list[dict], sources: list[dict]) -> Optional[dict]:
    question_type = _classify_question_type(question)
    if question_type == "REFERENCE_EXTRACTION":
        return _extract_circular_reference(question, reranked, sources)
    if question_type == "DEADLINE_EXTRACTION":
        return _extract_deadline_answer(question, reranked, sources)
    if question_type == "RATE_EXTRACTION":
        return _extract_rate_answer(question, reranked, sources)
    return None


def _format_sources(reranked: list[dict], question: str) -> tuple[list[dict], list[dict]]:
    sources = []
    quotes = []
    for index, item in enumerate(reranked, start=1):
        meta = _enrich_metadata(item["meta"])
        source_id = f"S{index}"
        score = round(_sigmoid(item["ce_score"]), 4)
        snippet = _make_snippet(item["doc"], question)
        entry = {
            "source_id": source_id,
            "source": meta["source"],
            "title": meta["title"],
            "regulator": meta["regulator"],
            "document_date": meta["document_date"],
            "page": meta["page"],
            "page_label": meta["page_label"],
            "score": score,
            "url": meta["url"],
            "snippet": snippet,
        }
        sources.append(entry)
        quotes.append(
            {
                "source_id": source_id,
                "source": meta["source"],
                "title": meta["title"],
                "page": meta["page"],
                "page_label": meta["page_label"],
                "quote": snippet,
            }
        )
    return sources, quotes


def _parse_json_response(raw_text: str) -> Optional[dict]:
    try:
        return json.loads(raw_text)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", raw_text, re.DOTALL)
        if not match:
            return None
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            return None


def _normalize_text_field(value) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    if isinstance(value, list):
        parts = [str(item).strip() for item in value if str(item).strip()]
        return "\n".join(parts).strip()
    return str(value).strip()


def _validate_answer(answer: str, valid_source_ids: set[str]) -> bool:
    lines = [line.strip(" -") for line in answer.splitlines() if line.strip()]
    if not lines:
        return False
    for line in lines:
        matches = _INLINE_SOURCE_PATTERN.findall(line)
        if not matches:
            return False
        flat_ids = [token.strip() for group in matches for token in group.split(",")]
        if any(source_id not in valid_source_ids for source_id in flat_ids):
            return False
    return True


def _verify_citation_support(answer: str, sources: list[dict], reranked: list[dict]) -> bool:
    """
    Check that key terms in each cited answer line appear in the cited chunks.
    """
    for raw_line in answer.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        cited_groups = _INLINE_SOURCE_PATTERN.findall(line)
        if not cited_groups:
            continue

        line_no_citations = _INLINE_SOURCE_PATTERN.sub("", line.lower())
        answer_terms = [
            token
            for token in _WORD_PATTERN.findall(line_no_citations)
            if token not in _STOPWORDS and len(token) > 3
        ]
        if not answer_terms:
            continue

        for group in cited_groups:
            for sid in group.split(","):
                sid = sid.strip()
                if not re.fullmatch(r"S\d+", sid):
                    return False
                idx = int(sid[1:]) - 1
                if idx < 0 or idx >= len(reranked):
                    return False
                chunk_text = str(reranked[idx].get("doc", "")).lower()
                matches = sum(1 for term in answer_terms if term in chunk_text)
                if matches / len(answer_terms) < 0.4:
                    return False
    return True


def _support_summary(question: str, candidates: list[dict]) -> dict:
    signals = _extract_query_signals(question)
    entity_hits = set()
    concept_hits = set()
    joint_support = False
    best_candidate = None
    best_score = -1

    for candidate in candidates:
        support = _text_support(candidate, signals)
        candidate["support"] = support
        entity_hits.update(support["matched_entities"])
        concept_hits.update(support["matched_concepts"])
        if support["support_score"] > best_score:
            best_candidate = candidate
            best_score = support["support_score"]
        if signals["entities"] and signals["concepts"] and support["matched_entities"] and support["matched_concepts"]:
            joint_support = True

    return {
        "signals": signals,
        "entity_hits": sorted(entity_hits),
        "concept_hits": sorted(concept_hits),
        "joint_support": joint_support,
        "best_candidate": best_candidate,
    }


def _build_not_found_reason(question: str, summary: dict) -> str:
    signals = summary["signals"]
    entity_hits = summary["entity_hits"]
    concept_hits = summary["concept_hits"]

    if not entity_hits and signals["entities"]:
        return f"No document about {_DISPLAY_LABELS.get(signals['entities'][0], signals['entities'][0])} was found."

    if entity_hits and signals["concepts"] and not concept_hits:
        entity_label = _DISPLAY_LABELS.get(entity_hits[0], entity_hits[0])
        concept_label = _DISPLAY_LABELS.get(signals["concepts"][0], signals["concepts"][0])
        return f"{entity_label} is mentioned, but no {concept_label} is stated."

    if entity_hits and concept_hits and not summary["joint_support"]:
        entity_label = _DISPLAY_LABELS.get(entity_hits[0], entity_hits[0])
        concept_label = _DISPLAY_LABELS.get(signals["concepts"][0], signals["concepts"][0]) if signals["concepts"] else "matching claim"
        return f"{concept_label.capitalize()} is mentioned, but not in connection with {entity_label}."

    if _TEMPORAL_PATTERN.search(question.lower()):
        return "The documents do not prove a latest or current answer for this request."

    return "The documents do not contain a supported answer for this request."


def _response_payload(
    *,
    answer: str,
    status: str,
    sources: list[dict],
    supporting_quotes: list[dict],
    confidence: float,
    standalone_question: str,
    filters: Optional[dict],
    history_used: bool,
    abstained: bool,
    not_found_reason: Optional[str],
) -> dict:
    return {
        "answer": answer,
        "status": status,
        "sources": sources,
        "supporting_quotes": supporting_quotes,
        "confidence": round(confidence, 4),
        "abstained": abstained,
        "not_found_reason": not_found_reason,
        "query": {
            "standalone_question": standalone_question,
            "filters_applied": filters or {},
            "history_used": history_used,
        },
    }


def _abstain(
    *,
    answer: Optional[str] = None,
    reason: str,
    confidence: float,
    standalone_question: str,
    filters: Optional[dict],
    history_used: bool,
    sources: Optional[list[dict]] = None,
    supporting_quotes: Optional[list[dict]] = None,
    status: str = "not_found",
) -> dict:
    return _response_payload(
        answer=answer or "Not found in provided documents.",
        status=status,
        sources=(sources or [])[:2],
        supporting_quotes=(supporting_quotes or [])[:1],
        confidence=confidence,
        standalone_question=standalone_question,
        filters=filters,
        history_used=history_used,
        abstained=True,
        not_found_reason=reason,
    )


def _infer_regulator_filter(question: str) -> Optional[str]:
    lower = question.lower()
    if any(t in lower for t in ["rbi", "fema", "nbfc", "softex"]):
        return "RBI"
    if any(t in lower for t in ["gst", "gstr", "input tax", "ims", "invoice management"]):
        return "GST"
    if any(t in lower for t in ["tds", "income tax", "cbdt", "194c", "194j", "itr"]):
        return "IncomeTax"
    if any(t in lower for t in ["mca", "llp", "aoc-4", "mgt-7", "form 11"]):
        return "MCA"
    return None


def query_rag(user_question: str, filters: Optional[dict] = None, active_document: Optional[str] = None) -> dict:
    standalone_question = user_question.strip()
    filters, active_document_used = _apply_active_document(filters, standalone_question, active_document)

    if not GROQ_API_KEY:
        result = _abstain(
            reason="The analyst service is not configured yet.",
            confidence=0.0,
            standalone_question=standalone_question,
            filters=filters,
            history_used=False,
        )
        log_event(agent="AnalystAgent", action="query_abstained", details={"question": user_question, "reason": "service_not_configured"})
        return result

    model = _get_embedding_model()
    if model is None:
        result = _abstain(
            reason="The local embedding model is unavailable in this offline environment.",
            confidence=0.0,
            standalone_question=standalone_question,
            filters=filters,
            history_used=False,
        )
        log_event(agent="AnalystAgent", action="query_abstained", details={"question": user_question, "reason": "embedding_model_unavailable"})
        return result
    collection = _get_collection()
    if collection.count() == 0:
        result = _abstain(
            reason="No documents are available in the knowledge base yet.",
            confidence=0.0,
            standalone_question=standalone_question,
            filters=filters,
            history_used=False,
        )
        log_event(agent="AnalystAgent", action="query_abstained", details={"question": user_question, "reason": "empty_collection"})
        return result

    inferred = _infer_regulator_filter(standalone_question)
    if inferred and not (filters or {}).get("regulator"):
        filters = dict(filters or {})
        filters["regulator"] = inferred

    queries = expand_query(standalone_question)
    fetch_k = min(_MAX_FETCH_K, max(TOP_K * 3, _MIN_FETCH_K))
    all_chunks = _hybrid_search(collection, model, queries, fetch_k, filters)
    if not all_chunks:
        result = _abstain(
            reason="No matching document was found for this question.",
            confidence=0.0,
            standalone_question=standalone_question,
            filters=filters,
            history_used=False,
        )
        log_event(agent="AnalystAgent", action="query_abstained", details={"question": user_question, "reason": "no_matching_documents", "filters": filters or {}})
        return result

    rrf_sorted = sorted(
        all_chunks.values(),
        key=lambda x: x.get("rrf_score", 0),
        reverse=True,
    )[:6]

    fast_path_sources = [
        {
            "source_id": f"S{i+1}",
            "source": _enrich_metadata(c["meta"])["source"],
            "page": _enrich_metadata(c["meta"])["page"],
        }
        for i, c in enumerate(rrf_sorted)
    ]

    fast_result = _try_fast_path(standalone_question, rrf_sorted, fast_path_sources)
    if fast_result:
        chunk_text = rrf_sorted[0]["doc"].lower()
        answer_terms = [
            t for t in _WORD_PATTERN.findall(fast_result["answer"].lower())
            if t not in _STOPWORDS and len(t) > 3
        ]
        if answer_terms:
            match_ratio = sum(1 for t in answer_terms if t in chunk_text) / len(answer_terms)
            if match_ratio >= 0.4:
                return _response_payload(
                    answer=fast_result["answer"],
                    status="answered",
                    sources=fast_path_sources[:2],
                    supporting_quotes=[],
                    confidence=0.9,
                    standalone_question=standalone_question,
                    filters=filters,
                    history_used=active_document_used,
                    abstained=False,
                    not_found_reason=None,
                )

    reranked = _rerank(standalone_question, list(all_chunks.values()), top_n=TOP_K)
    if not reranked:
        result = _abstain(
            reason="The documents did not produce a usable match for this question.",
            confidence=0.0,
            standalone_question=standalone_question,
            filters=filters,
            history_used=False,
        )
        log_event(agent="AnalystAgent", action="query_abstained", details={"question": user_question, "reason": "rerank_failed"})
        return result

    sources, supporting_quotes = _format_sources(reranked, user_question)
    support = _support_summary(standalone_question, reranked)
    max_score = max(round(_sigmoid(item["ce_score"]), 4) for item in reranked)
    scoped_summary = _is_summary_request(standalone_question) and bool(
        (filters or {}).get("source")
        or (filters or {}).get("title_contains")
        or (filters or {}).get("regulator")
        or support["signals"]["entities"]
    )
    if scoped_summary:
        max_score = max(max_score, 0.85)
        for source in sources:
            source["score"] = max(source["score"], 0.85)

    if not scoped_summary and support["signals"]["entities"] and support["signals"]["concepts"] and not support["joint_support"]:
        reason = _build_not_found_reason(standalone_question, support)
        result = _abstain(
            answer="Not found in provided documents.",
            reason=reason,
            confidence=max_score,
            standalone_question=standalone_question,
            filters=filters,
            history_used=False,
            sources=sources,
            supporting_quotes=supporting_quotes,
        )
        log_event(agent="AnalystAgent", action="query_abstained", details={"question": user_question, "reason": "no_joint_support", "summary": reason})
        return result

    if not scoped_summary and max_score < MIN_RELEVANCE_SCORE:
        reason = _build_not_found_reason(standalone_question, support)
        result = _abstain(
            answer="Not found in provided documents.",
            reason=reason,
            confidence=max_score,
            standalone_question=standalone_question,
            filters=filters,
            history_used=False,
            sources=sources,
            supporting_quotes=supporting_quotes,
        )
        log_event(agent="AnalystAgent", action="query_abstained", details={"question": user_question, "reason": "low_relevance", "summary": reason, "score": max_score})
        return result

    context = "\n\n".join(
        "\n".join(
            [
                f"{source['source_id']}",
                f"Title: {source['title']}",
                f"Regulator: {source['regulator']}",
                f"Date: {source['document_date'] or 'Unknown'}",
                f"Source: {source['source']}",
                f"Page: {source['page_label']}",
                f"Snippet: {source['snippet']}",
            ]
        )
        for source in sources
    )

    prompt = f"""You are a compliance analyst for Indian CA firms.

You must answer only from the provided evidence. If the evidence is missing, ambiguous, incomplete, contradictory, or does not establish the requested claim clearly, abstain.

Return valid JSON only:
{{
  "status": "answered" | "not_found" | "unsupported",
  "answer": "For answered responses, use 1-3 short bullet lines. If this is a summary request, use up to 5 concise bullet lines. Every bullet must end with citations like [S1] or [S1, S2]. For abstentions, use one short sentence.",
  "used_source_ids": ["S1"],
  "not_found_reason": "one short user-facing reason or null"
}}

Rules:
1. Use ONLY the evidence below.
2. Do not infer relationships unless they are explicitly supported.
3. If the question asks for latest/current/new and the evidence does not prove recency, return "unsupported".
4. Never cite a source id that is not in the evidence.
5. Keep the answer concise.
6. If the question asks for important points, alerts, highlights, or a summary of a clearly scoped document/topic, summarize only what is explicitly present in the evidence.
7. If you are not certain the evidence EXPLICITLY states the answer — not implies, not suggests, not is consistent with — return not_found. For compliance facts (deadlines, rates, penalties, section numbers), the document must state it directly. Do not infer.

Evidence:
{context}

Question:
{user_question}
"""

    groq_client = Groq(api_key=GROQ_API_KEY)
    try:
        response = groq_client.chat.completions.create(
            model=GROQ_MODEL,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.0,
            response_format={"type": "json_object"},
        )
    except Exception:
        response = groq_client.chat.completions.create(
            model=GROQ_MODEL,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.0,
        )

    payload = _parse_json_response(response.choices[0].message.content or "")
    valid_source_ids = {source["source_id"] for source in sources}
    if not payload:
        result = _abstain(
            reason="The analyst could not generate a reliable answer.",
            confidence=max_score,
            standalone_question=standalone_question,
            filters=filters,
            history_used=False,
            sources=sources,
            supporting_quotes=supporting_quotes,
        )
        log_event(agent="AnalystAgent", action="query_abstained", details={"question": user_question, "reason": "invalid_model_output"})
        return result

    status = payload.get("status")
    answer = _normalize_text_field(payload.get("answer"))
    used_source_ids = [source_id for source_id in payload.get("used_source_ids", []) if source_id in valid_source_ids]
    not_found_reason = _normalize_text_field(payload.get("not_found_reason")) or None

    if status == "answered":
        if (
            not _validate_answer(answer, valid_source_ids)
            or not used_source_ids
            or not _verify_citation_support(answer, sources, reranked)
        ):
            result = _abstain(
                reason="The retrieved evidence did not support a precise answer.",
                confidence=max_score,
                standalone_question=standalone_question,
                filters=filters,
                history_used=False,
                sources=sources,
                supporting_quotes=supporting_quotes,
            )
            log_event(agent="AnalystAgent", action="query_abstained", details={"question": user_question, "reason": "answer_validation_failed"})
            return result

        filtered_sources = [source for source in sources if source["source_id"] in used_source_ids][:2]
        filtered_quotes = [quote for quote in supporting_quotes if quote["source_id"] in used_source_ids][:2]
        result = _response_payload(
            answer=answer,
            status="answered",
            sources=filtered_sources,
            supporting_quotes=filtered_quotes,
            confidence=max_score,
            standalone_question=standalone_question,
            filters=filters,
            history_used=active_document_used,
            abstained=False,
            not_found_reason=None,
        )
        log_event(
            agent="AnalystAgent",
            action="query_answered",
            details={
                "question": user_question,
                "score": max_score,
                "used_source_ids": used_source_ids,
                "sources": [source["source"] for source in filtered_sources],
                "filters": filters or {},
                "active_document_used": active_document_used,
            },
            citation=filtered_sources[0]["source"] if filtered_sources else None,
        )
        return result

    reason = not_found_reason or _build_not_found_reason(standalone_question, support)
    answer_text = "I cannot verify that request from the ingested documents alone." if status == "unsupported" else "Not found in provided documents."
    result = _abstain(
        answer=answer_text,
        reason=reason,
        confidence=max_score,
        standalone_question=standalone_question,
        filters=filters,
        history_used=active_document_used,
        sources=sources,
        supporting_quotes=supporting_quotes,
        status="unsupported" if status == "unsupported" else "not_found",
    )
    log_event(agent="AnalystAgent", action="query_abstained", details={"question": user_question, "reason": reason, "filters": filters or {}, "active_document_used": active_document_used})
    return result


if __name__ == "__main__":
    print("ComplianceGPT - RAG Query Engine")
    print("Type 'exit' to quit\n")

    while True:
        question = input("Your Question: ").strip()
        if question.lower() == "exit":
            break
        if not question:
            continue

        result = query_rag(question)
        print("\nANSWER:\n", result["answer"])
        if result["sources"]:
            print("\nSOURCES:")
            for source in result["sources"]:
                print(f"  - {source['source_id']} | {source['title']} | Page {source['page_label']} | Score {source['score']}")
        print(f"\nCONFIDENCE: {result['confidence']}")
        print(f"ABSTAINED : {result['abstained']}")
        if result.get("not_found_reason"):
            print(f"REASON    : {result['not_found_reason']}")
        print("\n" + "-" * 60 + "\n")
