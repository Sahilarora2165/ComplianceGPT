from langchain_community.document_loaders import PyPDFLoader
from langchain.text_splitter import RecursiveCharacterTextSplitter
from sentence_transformers import SentenceTransformer
import chromadb
from chromadb.config import Settings
import sys
from pathlib import Path

sys.path.append(str(Path(__file__).parent.parent))
from config import (
    PDF_DIR, VECTORSTORE_DIR, EMBEDDING_MODEL,
    CHROMA_COLLECTION, CHUNK_SIZE, CHUNK_OVERLAP
)


def load_and_chunk_pdf(pdf_path: str) -> list:
    loader = PyPDFLoader(pdf_path)
    pages = loader.load()

    splitter = RecursiveCharacterTextSplitter(
        chunk_size=CHUNK_SIZE,
        chunk_overlap=CHUNK_OVERLAP
    )
    chunks = splitter.split_documents(pages)
    print(f"✅ Loaded {len(pages)} pages → {len(chunks)} chunks from {Path(pdf_path).name}")
    return chunks


def ingest_pdf(pdf_path: str):
    chunks = load_and_chunk_pdf(pdf_path)

    # Load embedding model
    model = SentenceTransformer(EMBEDDING_MODEL)

    # Init ChromaDB
    client = chromadb.PersistentClient(path=str(VECTORSTORE_DIR))
    collection = client.get_or_create_collection(name=CHROMA_COLLECTION)

    # Prepare data
    texts = [chunk.page_content for chunk in chunks]
    embeddings = model.encode(texts).tolist()
    ids = [f"{Path(pdf_path).stem}_chunk_{i}" for i in range(len(texts))]
    metadatas = [{"source": Path(pdf_path).name, "page": chunk.metadata.get("page", 0)} for chunk in chunks]

    # Store in ChromaDB
    collection.upsert(
        ids=ids,
        embeddings=embeddings,
        documents=texts,
        metadatas=metadatas
    )
    print(f"✅ Ingested {len(texts)} chunks into ChromaDB collection '{CHROMA_COLLECTION}'")


if __name__ == "__main__":
    # Test: ingest all PDFs in data/pdfs/
    pdf_files = list(PDF_DIR.glob("*.pdf"))
    if not pdf_files:
        print("❌ No PDFs found in backend/data/pdfs/ — drop a PDF there first")
    for pdf in pdf_files:
        ingest_pdf(str(pdf))