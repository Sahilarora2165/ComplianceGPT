import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

# Paths
BASE_DIR = Path(__file__).parent
PDF_DIR = BASE_DIR / "data" / "pdfs"
VECTORSTORE_DIR = BASE_DIR / "vectorstore"
LOGS_DIR = BASE_DIR / "logs"

# Embedding model
EMBEDDING_MODEL = "all-MiniLM-L6-v2"

# ChromaDB
CHROMA_COLLECTION = "compliance_docs"

# Groq LLM
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
GROQ_MODEL = "llama-3.3-70b-versatile"

# RAG
CHUNK_SIZE = 500
CHUNK_OVERLAP = 50
TOP_K = 8
MIN_RELEVANCE_SCORE = 0.3