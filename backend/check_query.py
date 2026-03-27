import argparse
import json

from config import PDF_DIR, VECTORSTORE_DIR, CHROMA_COLLECTION
from core.chroma_client import get_persistent_client
from core.ingest import ingest_pdf
from core.retriever import query_rag


def ensure_ingested() -> int:
    files = sorted(list(PDF_DIR.glob("*.pdf")) + list(PDF_DIR.glob("*.txt")))
    for path in files:
        ingest_pdf(str(path))

    client = get_persistent_client(VECTORSTORE_DIR)
    collection = client.get_or_create_collection(name=CHROMA_COLLECTION)
    return collection.count()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--ingest-only", action="store_true")
    args = parser.parse_args()

    count = ensure_ingested()
    print(f"Vectorstore chunk count: {count}")

    if args.ingest_only:
        return

    result = query_rag(
        "What is the FEMA deadline extension mentioned in the documents?",
        filters={"regulator": "RBI"},
    )

    print(json.dumps(result, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
