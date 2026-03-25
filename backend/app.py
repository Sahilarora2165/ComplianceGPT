from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import shutil
from pathlib import Path
import sys
import logging

sys.path.append(str(Path(__file__).parent))
from config import PDF_DIR
from core.ingest import ingest_pdf
from core.retriever import query_rag

# ── Scheduler ─────────────────────────────────────────────────────────────────
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.interval import IntervalTrigger

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="ComplianceGPT", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Scheduled Job ─────────────────────────────────────────────────────────────
def run_monitoring_job():
    """Runs every 6 hours automatically. Scrapes RBI, falls back to simulate."""
    try:
        logger.info("⏰ Scheduler triggered — running Monitoring Agent...")
        from agents.monitoring_agent import run_monitoring_agent
        new_docs = run_monitoring_agent(
            simulate_mode=False,   # Try real scraping first
            auto_ingest=True       # Download + ingest new PDFs
        )
        logger.info(f"✅ Monitoring job complete — {len(new_docs)} new document(s)")
    except Exception as e:
        logger.error(f"❌ Monitoring job failed: {e}")


# ── Startup / Shutdown ────────────────────────────────────────────────────────
scheduler = BackgroundScheduler()

@app.on_event("startup")
def start_scheduler():
    scheduler.add_job(
        run_monitoring_job,
        trigger=IntervalTrigger(hours=6),
        id="monitoring_job",
        name="Regulatory Monitoring — every 6 hours",
        replace_existing=True,
    )
    scheduler.start()
    logger.info("⏰ Scheduler started — Monitoring Agent will run every 6 hours")
    # Run once immediately on startup so you see results right away
    run_monitoring_job()

@app.on_event("shutdown")
def stop_scheduler():
    scheduler.shutdown()
    logger.info("⏰ Scheduler stopped")


# ── Routes ────────────────────────────────────────────────────────────────────
class QueryRequest(BaseModel):
    question: str

@app.get("/health")
def health():
    return {"status": "ok"}

@app.get("/scheduler/status")
def scheduler_status():
    """Check when the next monitoring run is scheduled."""
    jobs = []
    for job in scheduler.get_jobs():
        jobs.append({
            "id":       job.id,
            "name":     job.name,
            "next_run": str(job.next_run_time),
        })
    return {"scheduler_running": scheduler.running, "jobs": jobs}

@app.post("/scheduler/trigger")
def trigger_now():
    """Manually trigger a monitoring run right now (for demo/testing)."""
    try:
        from agents.monitoring_agent import run_monitoring_agent
        new_docs = run_monitoring_agent(simulate_mode=True, auto_ingest=False)
        return {
            "message":   f"Monitoring triggered — {len(new_docs)} new document(s) found",
            "documents": [{"title": d["title"], "regulator": d["regulator"],
                           "priority": d["priority"]} for d in new_docs]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

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