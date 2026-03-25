from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import shutil
from pathlib import Path
import sys

sys.path.append(str(Path(__file__).parent))
from config import PDF_DIR
from core.ingest import ingest_pdf
from core.retriever import query_rag

app = FastAPI(title="ComplianceGPT", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten in prod
    allow_methods=["*"],
    allow_headers=["*"],
)

class QueryRequest(BaseModel):
    question: str

@app.get("/health")
def health():
    return {"status": "ok"}

@app.post("/query")
def query(req: QueryRequest):
    if not req.question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty")
    result = query_rag(req.question)
    return result

@app.post("/ingest")
def ingest(file: UploadFile = File(...)):
    if not file.filename.endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are accepted")
    dest = PDF_DIR / file.filename
    PDF_DIR.mkdir(parents=True, exist_ok=True)
    with open(dest, "wb") as f:
        shutil.copyfileobj(file.file, f)
    ingest_pdf(str(dest))
    return {"message": f"{file.filename} ingested successfully"}