# save as check_db.py in your project root and run it
import chromadb
import sys
from pathlib import Path
sys.path.append(str(Path(__file__).parent))
from config import VECTORSTORE_DIR, CHROMA_COLLECTION

client = chromadb.PersistentClient(path=str(VECTORSTORE_DIR))
collection = client.get_or_create_collection(name=CHROMA_COLLECTION)

print("Total chunks:", collection.count())

results = collection.get(include=["metadatas"])
pages = sorted(set(m["page"] for m in results["metadatas"]))
print("All pages in DB:", pages)