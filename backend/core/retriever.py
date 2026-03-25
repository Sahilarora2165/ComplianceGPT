import re
import sys
from pathlib import Path

_BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.append(str(_BACKEND_DIR))

from sentence_transformers import SentenceTransformer, CrossEncoder
from rank_bm25 import BM25Okapi
import chromadb
from groq import Groq

from config import (
    VECTORSTORE_DIR, EMBEDDING_MODEL,
    CHROMA_COLLECTION, TOP_K,
    GROQ_API_KEY, GROQ_MODEL,
    MIN_RELEVANCE_SCORE
)
from audit import log_event

# Cross-encoder for reranking — loads once at module level (not per query)
# ms-marco-MiniLM-L-6-v2: small, fast, accurate, free, runs locally
_CROSS_ENCODER = CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2")

# ── Query Expansion ───────────────────────────────────────────────────────────

def expand_query(user_question: str) -> list[str]:
    q       = user_question.strip()
    q_lower = q.lower()
    variants = [q]

    ordinal_map = {
        "1st": "1", "2nd": "2", "3rd": "3", "4th": "4", "5th": "5",
        "6th": "6", "7th": "7", "8th": "8", "9th": "9"
    }
    for ordinal, cardinal in ordinal_map.items():
        if ordinal in q_lower:
            variants.append(q_lower.replace(ordinal, cardinal))
            variants.append(f"problem statement {cardinal}")

    broad_triggers = [
        "all", "list", "give", "every", "each", "summary",
        "summarize", "overview", "document", "pdf", "brief"
    ]
    if any(t in q_lower for t in broad_triggers):
        variants += ["problem statement", "challenge description",
                     "objective and goals", "solution requirements"]

    return list(dict.fromkeys(variants))


# ── Hybrid Search (BM25 + Vector) ────────────────────────────────────────────

def _hybrid_search(
    collection,
    model: SentenceTransformer,
    queries: list[str],
    fetch_k: int
) -> dict[str, dict]:
    """
    Step 1 — Vector search across all query variants.
    Step 2 — BM25 keyword search over the same corpus.
    Step 3 — Reciprocal Rank Fusion (RRF) to merge scores.
    Returns: dict of {chunk_id: {doc, meta, rrf_score}}
    """
    # ── Vector search ──
    vector_results: dict[str, dict] = {}
    for qtext in queries:
        q_emb   = model.encode([qtext]).tolist()
        results = collection.query(
            query_embeddings=q_emb,
            n_results=fetch_k,
            include=["documents", "metadatas", "distances"]
        )
        for doc, meta, dist, cid in zip(
            results["documents"][0],
            results["metadatas"][0],
            results["distances"][0],
            results["ids"][0],
        ):
            if cid not in vector_results or dist < vector_results[cid]["dist"]:
                vector_results[cid] = {"doc": doc, "meta": meta, "dist": dist, "id": cid}

    # ── BM25 search ──
    # Fetch full corpus for BM25 (up to 2000 chunks — sufficient for regulatory docs)
    corpus_result = collection.get(include=["documents", "metadatas"])
    corpus_docs   = corpus_result["documents"]
    corpus_metas  = corpus_result["metadatas"]
    corpus_ids    = corpus_result["ids"]

    tokenized_corpus = [doc.lower().split() for doc in corpus_docs]
    bm25             = BM25Okapi(tokenized_corpus)

    bm25_results: dict[str, dict] = {}
    for qtext in queries:
        tokenized_query = qtext.lower().split()
        scores          = bm25.get_scores(tokenized_query)
        # Take top fetch_k by BM25 score
        top_indices = sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)[:fetch_k]
        for rank, idx in enumerate(top_indices):
            cid = corpus_ids[idx]
            if cid not in bm25_results or scores[idx] > bm25_results[cid].get("bm25_score", 0):
                bm25_results[cid] = {
                    "doc":        corpus_docs[idx],
                    "meta":       corpus_metas[idx],
                    "bm25_score": scores[idx],
                    "id":         cid
                }

    # ── Reciprocal Rank Fusion (RRF) ──
    # k=60 is standard RRF constant — balances precision vs recall
    RRF_K = 60
    rrf_scores: dict[str, float] = {}

    vector_ranked = sorted(vector_results.values(), key=lambda x: x["dist"])
    for rank, entry in enumerate(vector_ranked):
        cid = entry["id"]
        rrf_scores[cid] = rrf_scores.get(cid, 0) + 1 / (RRF_K + rank + 1)

    bm25_ranked = sorted(bm25_results.values(), key=lambda x: x["bm25_score"], reverse=True)
    for rank, entry in enumerate(bm25_ranked):
        cid = entry["id"]
        rrf_scores[cid] = rrf_scores.get(cid, 0) + 1 / (RRF_K + rank + 1)

    # Merge all candidates
    all_candidates: dict[str, dict] = {}
    for cid, entry in {**vector_results, **bm25_results}.items():
        all_candidates[cid] = {
            "doc":       entry["doc"],
            "meta":      entry["meta"],
            "rrf_score": rrf_scores.get(cid, 0)
        }

    return all_candidates


# ── Cross-Encoder Reranking ───────────────────────────────────────────────────

def _rerank(question: str, candidates: list[dict], top_n: int) -> list[dict]:
    """
    Score each candidate chunk against the question using cross-encoder.
    Returns top_n chunks sorted by cross-encoder score descending.
    Cross-encoder reads both question + chunk together — far more accurate
    than cosine similarity alone.
    """
    pairs  = [(question, c["doc"]) for c in candidates]
    scores = _CROSS_ENCODER.predict(pairs)
    for i, candidate in enumerate(candidates):
        candidate["ce_score"] = float(scores[i])
    reranked = sorted(candidates, key=lambda x: x["ce_score"], reverse=True)
    return reranked[:top_n]


# ── Main RAG Function ─────────────────────────────────────────────────────────

def query_rag(user_question: str) -> dict:
    model      = SentenceTransformer(EMBEDDING_MODEL)
    client     = chromadb.PersistentClient(path=str(VECTORSTORE_DIR))
    collection = client.get_or_create_collection(name=CHROMA_COLLECTION)

    queries = expand_query(user_question)
    FETCH_K = min(50, collection.count())

    # Step 1: Hybrid search
    all_chunks = _hybrid_search(collection, model, queries, FETCH_K)

    if not all_chunks:
        return {
            "answer": "I cannot answer this as no relevant regulatory document was found.",
            "sources": [], "confidence": 0.0,
            "abstained": True, "abstain_reason": "empty_collection"
        }

    # Step 2: Cross-encoder reranking
    candidates = list(all_chunks.values())
    reranked   = _rerank(user_question, candidates, top_n=TOP_K)

    # Step 3: Convert cross-encoder scores to 0-1 confidence
    # Cross-encoder returns logits (can be negative) — sigmoid normalizes them
    import math
    def sigmoid(x): return 1 / (1 + math.exp(-x))

    final_docs   = [r["doc"]  for r in reranked]
    final_metas  = [r["meta"] for r in reranked]
    final_scores = [round(sigmoid(r["ce_score"]), 4) for r in reranked]
    max_score    = max(final_scores) if final_scores else 0

    # Layer 1: score threshold (applied to sigmoid-normalized cross-encoder score)
    if max_score < MIN_RELEVANCE_SCORE:
        log_event(agent="AnalystAgent", action="query_abstained",
                  details={"question": user_question, "reason": "low_score", "score": max_score})
        return {
            "answer": "I cannot answer this as no relevant regulatory document was found.",
            "sources": [], "confidence": max_score,
            "abstained": True, "abstain_reason": "low_score"
        }

    # Step 4: Build context sorted by page number
    combined = sorted(
        zip(final_docs, final_metas, final_scores),
        key=lambda x: x[1]["page"]
    )
    context_parts = []
    for doc, meta, score in combined:
        context_parts.append(
            f"[Source: {meta['source']}, Page: {meta['page']}, Score: {score}]\n{doc}"
        )
    context = "\n\n---\n\n".join(context_parts)

    # Step 5: LLM call
    groq_client = Groq(api_key=GROQ_API_KEY)
    prompt = f"""You are a compliance analyst for Indian CA firms.

RULES:
1. Answer using ONLY the context below.
2. Be DIRECT and CLEAR. Do not hedge if the answer is present.
3. Cite source and page for every claim: (Source: filename.pdf, Page: X)
4. Only say "Not found in provided documents" if the answer is genuinely absent.

CONTEXT:
{context}

Question: {user_question}

Answer:"""

    response = groq_client.chat.completions.create(
        model=GROQ_MODEL,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.1,
    )

    answer = response.choices[0].message.content

    log_event(
        agent="AnalystAgent", action="query_answered",
        details={"question": user_question, "score": max_score,
                 "pages_used": [m["page"] for m in final_metas]},
        citation=final_metas[0]["source"] if final_metas else None
    )

    return {
        "answer": answer,
        "sources": [{"source": m["source"], "page": m["page"], "score": s}
                    for m, s in zip(final_metas, final_scores)],
        "confidence": max_score,
        "abstained": False,
        "abstain_reason": None
    }


if __name__ == "__main__":
    print("📄 ComplianceGPT — RAG Query Engine")
    print("Type 'exit' to quit\n")

    while True:
        question = input("❓ Your Question: ").strip()
        if question.lower() == "exit":
            break
        if not question:
            continue

        result = query_rag(question)

        print("\n🔍 ANSWER:\n", result["answer"])
        if result["sources"]:
            print("\n📎 SOURCES:")
            for s in result["sources"]:
                print(f"   - {s['source']} | Page {s['page']} | Score {s['score']}")
        print(f"\n📊 CONFIDENCE  : {result['confidence']}")
        print(f"🚫 ABSTAINED   : {result['abstained']}")
        if result.get("abstain_reason"):
            print(f"📌 REASON      : {result['abstain_reason']}")
        print("\n" + "─" * 60 + "\n")