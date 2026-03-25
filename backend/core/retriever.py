from sentence_transformers import SentenceTransformer
import chromadb
import sys
from pathlib import Path

sys.path.append(str(Path(__file__).parent.parent))
from config import (
    VECTORSTORE_DIR, EMBEDDING_MODEL,
    CHROMA_COLLECTION, TOP_K,
    GROQ_API_KEY, GROQ_MODEL
)
from groq import Groq

MIN_RELEVANCE_SCORE = 0.3

# Expand a single query into multiple semantically varied versions
# so we don't miss chunks that use different vocabulary.
QUERY_EXPANSIONS = {
    "default": ["{q}"],  # fallback: just use the original
}

def expand_query(user_question: str) -> list[str]:
    """
    Returns a list of query variants to improve recall across all pages.
    For broad/listing questions we add generic anchors so every page
    has a chance to surface.
    """
    q = user_question.strip()
    variants = [q]

    broad_triggers = [
        "all", "list", "give", "every", "each", "summary", "summarize",
        "overview", "problems", "statements", "topics", "categories"
    ]
    if any(t in q.lower() for t in broad_triggers):
        # Add generic anchors that match typical section headers / intro lines
        variants += [
            "problem statement",
            "challenge description",
            "objective and goals",
            "use case scenario",
            "solution requirements",
        ]

    return list(dict.fromkeys(variants))  # deduplicate while preserving order


def query_rag(user_question: str) -> dict:
    model = SentenceTransformer(EMBEDDING_MODEL)
    client = chromadb.PersistentClient(path=str(VECTORSTORE_DIR))
    collection = client.get_or_create_collection(name=CHROMA_COLLECTION)

    queries = expand_query(user_question)
    print(f"[INFO] Running {len(queries)} query variant(s): {queries}")

    # ── Step 1: gather candidates from ALL query variants ──────────────────
    # Use a large FETCH_K so even low-scoring pages appear in at least one variant
    FETCH_K = min(100, collection.count())  # never ask for more than what exists

    all_chunks: dict[str, dict] = {}  # chunk_id -> {doc, meta, best_dist}

    for qtext in queries:
        q_emb = model.encode([qtext]).tolist()
        results = collection.query(
            query_embeddings=q_emb,
            n_results=FETCH_K,
            include=["documents", "metadatas", "distances", "ids"]
        )
        for doc, meta, dist, cid in zip(
            results["documents"][0],
            results["metadatas"][0],
            results["distances"][0],
            results["ids"][0],
        ):
            if cid not in all_chunks or dist < all_chunks[cid]["dist"]:
                all_chunks[cid] = {"doc": doc, "meta": meta, "dist": dist}

    print(f"[INFO] Unique chunks after multi-query union: {len(all_chunks)}")

    # ── Step 2: strict diversity — keep only best chunk per page ───────────
    page_best: dict = {}  # page_number -> chunk entry
    for entry in all_chunks.values():
        page = entry["meta"]["page"]
        if page not in page_best or entry["dist"] < page_best[page]["dist"]:
            page_best[page] = entry

    print(f"[INFO] Unique pages represented: {sorted(page_best.keys())}")

    # ── Step 3: sort by relevance, take TOP_K ──────────────────────────────
    # For broad "list everything" queries we want MORE pages, so we bump TOP_K
    effective_top_k = TOP_K
    broad_triggers = ["all", "list", "give", "every", "each", "summary"]
    if any(t in user_question.lower() for t in broad_triggers):
        effective_top_k = max(TOP_K, len(page_best))  # include every page
        print(f"[INFO] Broad query detected — using effective TOP_K={effective_top_k}")

    sorted_pages = sorted(page_best.values(), key=lambda x: x["dist"])
    selected = sorted_pages[:effective_top_k]

    final_docs   = [s["doc"]  for s in selected]
    final_metas  = [s["meta"] for s in selected]
    final_dists  = [s["dist"] for s in selected]

    scores = [round(1 / (1 + d), 4) for d in final_dists]
    max_score = max(scores) if scores else 0

    print(f"[DEBUG] Pages selected: {[m['page'] for m in final_metas]}")

    if max_score < MIN_RELEVANCE_SCORE:
        return {
            "answer": "I cannot answer this as no relevant regulatory document was found.",
            "sources": [],
            "confidence": max_score,
            "abstained": True,
        }

    # ── Step 4: build context ──────────────────────────────────────────────
    # Sort by page number for a coherent reading order
    combined = sorted(
        zip(final_docs, final_metas, scores),
        key=lambda x: x[1]["page"]
    )

    context_parts = []
    for doc, meta, score in combined:
        context_parts.append(
            f"[Source: {meta['source']}, Page: {meta['page']}, Score: {score}]\n{doc}"
        )
    context = "\n\n---\n\n".join(context_parts)

    # ── Step 5: LLM call ───────────────────────────────────────────────────
    groq_client = Groq(api_key=GROQ_API_KEY)
    prompt = f"""You are a compliance advisor for Indian CA firms.
Answer the question using ONLY the context below.
For every claim, cite the source document and page number like (Source: filename.pdf, Page: X).
If the context doesn't contain enough info, say so clearly.

Context:
{context}

Question: {user_question}

Answer (with citations):"""

    response = groq_client.chat.completions.create(
        model=GROQ_MODEL,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.1,
    )

    answer = response.choices[0].message.content

    return {
        "answer": answer,
        "sources": [
            {"source": m["source"], "page": m["page"], "score": s}
            for m, s in zip(final_metas, scores)
        ],
        "confidence": max_score,
        "abstained": False,
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
        print(f"\n📊 CONFIDENCE: {result['confidence']}")
        print(f"🚫 ABSTAINED: {result['abstained']}")
        print("\n" + "─" * 60 + "\n")