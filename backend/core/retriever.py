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

# L2 distance scale: 0 = perfect match, ~2 = completely unrelated
# 1/(1+d) maps this to: 1.0 = perfect, ~0.33 = unrelated
# Threshold of 0.3 filters truly irrelevant queries only
MIN_RELEVANCE_SCORE = 0.3


def query_rag(user_question: str) -> dict:
    # Load embedding model + ChromaDB
    model = SentenceTransformer(EMBEDDING_MODEL)
    client = chromadb.PersistentClient(path=str(VECTORSTORE_DIR))
    collection = client.get_or_create_collection(name=CHROMA_COLLECTION)

    # Embed the question
    question_embedding = model.encode([user_question]).tolist()

    # Search
    results = collection.query(
        query_embeddings=question_embedding,
        n_results=TOP_K,
        include=["documents", "metadatas", "distances"]
    )

    docs = results["documents"][0]
    metadatas = results["metadatas"][0]
    distances = results["distances"][0]

    # Convert L2 distance → similarity score
    scores = [round(1 / (1 + d), 4) for d in distances]
    max_score = max(scores)

    # HARD ABSTAIN
    if max_score < MIN_RELEVANCE_SCORE:
        return {
            "answer": "I cannot answer this as no relevant regulatory document was found.",
            "sources": [],
            "confidence": max_score,
            "abstained": True
        }

    # Build context with citations
    context_parts = []
    for doc, meta, score in zip(docs, metadatas, scores):
        context_parts.append(
            f"[Source: {meta['source']}, Page: {meta['page']}, Score: {score}]\n{doc}"
        )
    context = "\n\n---\n\n".join(context_parts)

    # Call Groq LLM
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
        temperature=0.1
    )

    answer = response.choices[0].message.content

    return {
        "answer": answer,
        "sources": [
            {"source": m["source"], "page": m["page"], "score": s}
            for m, s in zip(metadatas, scores)
        ],
        "confidence": max_score,
        "abstained": False
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
        print("\n" + "─"*60 + "\n")