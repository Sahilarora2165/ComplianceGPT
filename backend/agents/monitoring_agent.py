"""
monitoring_agent.py — ComplianceGPT Monitoring Agent
Scrapes RBI, GST, Income Tax, MCA portals for new circulars/PDFs.
Falls back to simulate mode if scraping fails or is explicitly triggered.
"""

import sys
import hashlib
import json
import time
import random
import requests
from pathlib import Path
from datetime import datetime, timezone
from typing import Optional

from bs4 import BeautifulSoup

# ── Path bootstrap (mirrors your existing files) ─────────────────────────────
_BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.append(str(_BACKEND_DIR))

from config import PDF_DIR, LOGS_DIR
from core.audit import log_event
# ── Constants ─────────────────────────────────────────────────────────────────
HASH_DB_PATH   = LOGS_DIR / "seen_documents.json"   # Persists seen file hashes
SCRAPE_DELAY   = 5                                   # Seconds between requests (ethical)
REQUEST_TIMEOUT = 15
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (ComplianceGPT-Bot/1.0; "
        "Hackathon Research Tool; respects robots.txt)"
    )
}

# ── Portal Configurations ─────────────────────────────────────────────────────
# Each portal defines: url, regulator tag, CSS selectors to find PDF links.
# list_selector  → selects the container rows/items on the page
# link_selector  → selects the <a> tag with the PDF href inside each row
# title_selector → selects the human-readable title text inside each row
PORTALS = [
    {
        "regulator": "RBI",
        "name":      "RBI Press Releases",
        "url":       "https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx",
        "list_selector":  "tr",
        "link_selector":  "a[href*='.PDF'], a[href*='.pdf']",
        "title_selector": "td",
        "base_url":       "https://rbidocs.rbi.org.in",
    },
    {
        "regulator": "GST",
        "name":      "GST Circulars",
        "url":       "https://www.cbic-gst.gov.in/gst-goods-services-rates.html",
        "list_selector":  "table tr",
        "link_selector":  "a[href$='.pdf']",
        "title_selector": "td:first-child",
        "base_url":       "https://www.cbic-gst.gov.in",
    },
    {
        "regulator": "IncomeTax",
        "name":      "Income Tax Circulars",
        "url":       "https://incometaxindia.gov.in/Pages/communications/circulars.aspx",
        "list_selector":  "table.GridView tr",
        "link_selector":  "a[href$='.pdf']",
        "title_selector": "td:first-child",
        "base_url":       "https://incometaxindia.gov.in",
    },
    {
        "regulator": "MCA",
        "name":      "MCA Circulars",
        "url":       "https://www.mca.gov.in/Ministry/pdf/GeneralCircular.pdf",
        "list_selector":  "table tr",
        "link_selector":  "a[href$='.pdf']",
        "title_selector": "td:first-child",
        "base_url":       "https://www.mca.gov.in",
    },
]

# ── Simulated Documents (Demo Fallback) ───────────────────────────────────────
# These are used when real scraping fails or simulate_mode=True is passed.
# Structured to mimic exactly what real scraping would produce.
SIMULATED_DOCUMENTS = [
    {
        "regulator": "RBI",
        "title":     "RBI Circular: FEMA Compliance Deadline Extended – March 2026",
        "url":       "https://www.rbi.org.in/sample/fema_circular_march2026.pdf",
        "filename":  "rbi_fema_circular_march2026.pdf",
        "priority":  "HIGH",
        "summary":   "FEMA reporting deadline for foreign transactions extended by 30 days.",
    },
    {
        "regulator": "GST",
        "title":     "GST Advisory: New Invoice Management System (IMS) – April 2026",
        "url":       "https://www.gst.gov.in/sample/ims_advisory_april2026.pdf",
        "filename":  "gst_ims_advisory_april2026.pdf",
        "priority":  "HIGH",
        "summary":   "Invoice Management System mandatory from April 1, 2026 for all GST filers.",
    },
    {
        "regulator": "IncomeTax",
        "title":     "CBDT Circular: TDS Rate Revision – FY 2026-27",
        "url":       "https://incometaxindia.gov.in/sample/tds_revision_2026.pdf",
        "filename":  "incometax_tds_revision_2026.pdf",
        "priority":  "MEDIUM",
        "summary":   "TDS rates revised for Section 194C and 194J effective April 2026.",
    },
    {
        "regulator": "MCA",
        "title":     "MCA Notification: LLP Annual Filing Deadline – FY 2025-26",
        "url":       "https://www.mca.gov.in/sample/llp_filing_2025_26.pdf",
        "filename":  "mca_llp_filing_2025_26.pdf",
        "priority":  "MEDIUM",
        "summary":   "LLP Form 11 annual return due date extended to July 15, 2026.",
    },
    {
        "regulator": "SEBI",
        "title":     "SEBI Circular: ESG Disclosure Norms for Listed Companies",
        "url":       "https://www.sebi.gov.in/sample/esg_disclosure_2026.pdf",
        "filename":  "sebi_esg_disclosure_2026.pdf",
        "priority":  "LOW",
        "summary":   "Enhanced ESG disclosures mandatory for top 1000 listed companies.",
    },
]


# ── Hash Database Helpers ─────────────────────────────────────────────────────

def _load_hash_db() -> dict:
    """Load the persisted dictionary of {url: content_hash}."""
    if HASH_DB_PATH.exists():
        try:
            return json.loads(HASH_DB_PATH.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def _save_hash_db(db: dict) -> None:
    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    HASH_DB_PATH.write_text(json.dumps(db, indent=2), encoding="utf-8")


def _hash_content(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def _is_new_document(url: str, content: bytes, db: dict) -> bool:
    """Return True if this URL/content has not been seen before."""
    new_hash = _hash_content(content)
    if db.get(url) == new_hash:
        return False
    db[url] = new_hash          # Mutates in place; caller must save
    return True


# ── PDF Downloader ────────────────────────────────────────────────────────────

def _download_pdf(pdf_url: str, filename: str) -> Optional[Path]:
    """
    Download a PDF to PDF_DIR.
    Returns the local Path on success, None on failure.
    """
    dest = PDF_DIR / filename
    if dest.exists():
        print(f"    📁 Already on disk: {filename}")
        return dest

    try:
        resp = requests.get(
            pdf_url, headers=HEADERS,
            timeout=REQUEST_TIMEOUT, stream=True
        )
        resp.raise_for_status()
        PDF_DIR.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(resp.content)
        print(f"    ⬇️  Downloaded: {filename} ({len(resp.content)//1024} KB)")
        return dest
    except Exception as e:
        print(f"    ❌ Download failed for {filename}: {e}")
        return None


# ── Real Scraper ──────────────────────────────────────────────────────────────

def _scrape_portal(portal: dict, hash_db: dict) -> list[dict]:
    """
    Scrape a single portal for new PDFs.
    Returns list of new-document dicts.
    """
    new_docs = []
    print(f"\n  🌐 Scraping [{portal['regulator']}] {portal['name']} ...")

    try:
        resp = requests.get(
            portal["url"], headers=HEADERS,
            timeout=REQUEST_TIMEOUT
        )
        resp.raise_for_status()
        soup = BeautifulSoup(resp.content, "html.parser")

        rows = soup.select(portal["list_selector"])
        print(f"    Found {len(rows)} rows")

        for row in rows[:20]:          # Cap at 20 rows per portal
            link_tag  = row.select_one(portal["link_selector"])
            title_tag = row.select_one(portal["title_selector"])
            if not link_tag:
                continue

            href  = link_tag.get("href", "")
            title = row.get_text(strip=True) if hasattr(row, 'get_text') else link_tag.get_text(strip=True)
            import re
            title = re.sub(r'\s*\d+\s*kb\s*$', '', title, flags=re.IGNORECASE).strip()
            title = title[:120] if title else link_tag.get('href', '')


            # Build absolute URL
            if href.startswith("http"):
                pdf_url = href
            elif href.startswith("/"):
                pdf_url = portal["base_url"] + href
            else:
                pdf_url = portal["base_url"] + "/" + href

            if not pdf_url.lower().endswith(".pdf") and ".pdf" not in pdf_url.lower():
                continue

            # Check if new
            try:
                head = requests.head(
                    pdf_url, headers=HEADERS,
                    timeout=REQUEST_TIMEOUT, allow_redirects=True
                )
                content_sample = head.headers.get("ETag", pdf_url).encode()
            except Exception:
                content_sample = pdf_url.encode()

            if not _is_new_document(pdf_url, content_sample, hash_db):
                continue

            # Derive a clean filename
            stem     = Path(pdf_url.split("?")[0]).stem[:60]
            filename = f"{portal['regulator'].lower()}_{stem}.pdf"

            new_docs.append({
                "regulator": portal["regulator"],
                "title":     title or filename,
                "url":       pdf_url,
                "filename":  filename,
                "priority":  _infer_priority(title),
                "summary":   "",           # Filled after ingest
                "source":    "real_scrape",
            })

        time.sleep(SCRAPE_DELAY)        # Ethical rate limiting

    except Exception as e:
        print(f"    ⚠️  Scrape failed for {portal['name']}: {e}")

    return new_docs


def _infer_priority(title: str) -> str:
    """Heuristic priority from title keywords."""
    title_lower = title.lower()
    high_kw  = ["deadline", "extension", "penalty", "mandatory", "fema", "urgent", "immediate"]
    low_kw   = ["esg", "advisory", "clarification", "faqs"]
    if any(k in title_lower for k in high_kw):
        return "HIGH"
    if any(k in title_lower for k in low_kw):
        return "LOW"
    return "MEDIUM"


# ── Simulate Mode ─────────────────────────────────────────────────────────────

def _simulate_new_documents(hash_db: dict, regulators: list[str] = None) -> list[dict]:
    """
    Return simulated new documents, filtered to unseen ones only.
    Optionally filter by regulator list.
    """
    new_docs = []
    pool = SIMULATED_DOCUMENTS
    if regulators:
        pool = [d for d in pool if d["regulator"] in regulators]

    for doc in pool:
        key     = f"sim::{doc['url']}"
        content = doc["url"].encode()
        if _is_new_document(key, content, hash_db):
            new_docs.append({**doc, "source": "simulated"})

    return new_docs


# ── Orchestrator ──────────────────────────────────────────────────────────────

def run_monitoring_agent(
    simulate_mode: bool = False,
    regulators: list[str] = None,
    auto_ingest: bool = True,
) -> list[dict]:
    """
    Main entry point for the Monitoring Agent.

    Args:
        simulate_mode: If True, skip real scraping and use SIMULATED_DOCUMENTS.
        regulators:    Optional list e.g. ["RBI", "GST"] to filter portals.
        auto_ingest:   If True, download PDFs and trigger ingest pipeline.

    Returns:
        List of new-document dicts (with keys: regulator, title, url,
        filename, priority, summary, source).
    """
    print("\n" + "═" * 60)
    print("🔍 ComplianceGPT — Monitoring Agent")
    print(f"   Mode      : {'🎭 SIMULATE' if simulate_mode else '🌐 REAL SCRAPE'}")
    print(f"   Regulators: {regulators or 'ALL'}")
    print(f"   Time      : {datetime.now(timezone.utc).isoformat()}")
    print("═" * 60)

    hash_db  = _load_hash_db()
    new_docs = []

    if simulate_mode:
        # ── Simulate path ──────────────────────────────────────────────────
        print("\n🎭 Running in SIMULATE mode — using pre-built documents")
        new_docs = _simulate_new_documents(hash_db, regulators)

    else:
        # ── Real scraping path ─────────────────────────────────────────────
        portals_to_check = PORTALS
        if regulators:
            portals_to_check = [p for p in PORTALS if p["regulator"] in regulators]

        for portal in portals_to_check:
            docs = _scrape_portal(portal, hash_db)
            new_docs.extend(docs)

        # Fall back to simulate if real scraping yielded nothing
        if not new_docs:
            print("\n⚠️  Real scraping found no new documents — falling back to SIMULATE")
            log_event(
                agent="MonitoringAgent",
                action="scrape_fallback",
                details={"reason": "no_new_docs_from_real_scrape"}
            )
            new_docs = _simulate_new_documents(hash_db, regulators)

    # ── Process new documents ──────────────────────────────────────────────
    if not new_docs:
        print("\n✅ No new documents found — system is up to date.")
        log_event(
            agent="MonitoringAgent",
            action="monitor_complete",
            details={"new_docs": 0}
        )
        _save_hash_db(hash_db)
        return []

    print(f"\n📋 {len(new_docs)} new document(s) detected:\n")
    for i, doc in enumerate(new_docs, 1):
        print(f"  {i}. [{doc['regulator']}] {doc['title']}")
        print(f"     Priority : {doc['priority']}")
        print(f"     Source   : {doc['source']}")

    # ── Download + ingest ──────────────────────────────────────────────────
    if auto_ingest:
        print("\n⬇️  Downloading & ingesting new documents...")
        _ingest_new_docs(new_docs)

    # ── Persist hash DB ────────────────────────────────────────────────────
    _save_hash_db(hash_db)

    log_event(
        agent="MonitoringAgent",
        action="monitor_complete",
        details={
            "mode":     "simulate" if simulate_mode else "real",
            "new_docs": len(new_docs),
            "docs":     [{"title": d["title"], "regulator": d["regulator"],
                          "priority": d["priority"]} for d in new_docs],
        }
    )

    print(f"\n✅ Monitoring complete — {len(new_docs)} new document(s) processed.")
    return new_docs


def _ingest_new_docs(new_docs: list[dict]) -> None:
    """
    Download PDFs and hand off to ingest pipeline.
    For simulated docs, creates a placeholder text file instead.
    """
    # Lazy import to avoid circular deps; ingest.py is a sibling module
    try:
        from agents.ingest import ingest_pdf
    except ImportError:
        try:
            from ingest import ingest_pdf
        except ImportError:
            print("  ⚠️  Could not import ingest_pdf — skipping auto-ingest")
            return

    for doc in new_docs:
        print(f"\n  📄 Processing: {doc['filename']}")

        if doc["source"] == "simulated":
            # Create a realistic placeholder PDF text file for demo
            dest = PDF_DIR / doc["filename"].replace(".pdf", "_sim.txt")
            PDF_DIR.mkdir(parents=True, exist_ok=True)
            dest.write_text(
                f"SIMULATED DOCUMENT\n"
                f"Regulator : {doc['regulator']}\n"
                f"Title     : {doc['title']}\n"
                f"Summary   : {doc['summary']}\n"
                f"URL       : {doc['url']}\n"
                f"Generated : {datetime.now(timezone.utc).isoformat()}\n",
                encoding="utf-8"
            )
            print(f"    📝 Placeholder created: {dest.name}")
            log_event(
                agent="MonitoringAgent",
                action="doc_simulated",
                details={"filename": doc["filename"], "regulator": doc["regulator"]},
                citation=doc["title"]
            )
            continue

        # Real download + ingest
        local_path = _download_pdf(doc["url"], doc["filename"])
        if local_path:
            try:
                ingest_pdf(str(local_path))
            except Exception as e:
                print(f"    ⚠️  Ingest failed: {e}")
                log_event(
                    agent="MonitoringAgent",
                    action="ingest_failed",
                    details={"filename": doc["filename"], "error": str(e)}
                )


# ── CLI Entry Point ───────────────────────────────────────────────────────────

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="ComplianceGPT Monitoring Agent")
    parser.add_argument(
        "--simulate", action="store_true",
        help="Use simulated documents instead of real scraping"
    )
    parser.add_argument(
        "--regulators", nargs="+",
        choices=["RBI", "GST", "IncomeTax", "MCA", "SEBI"],
        help="Filter to specific regulators"
    )
    parser.add_argument(
        "--no-ingest", action="store_true",
        help="Detect new docs but skip download/ingest"
    )
    args = parser.parse_args()

    results = run_monitoring_agent(
        simulate_mode=args.simulate,
        regulators=args.regulators,
        auto_ingest=not args.no_ingest,
    )