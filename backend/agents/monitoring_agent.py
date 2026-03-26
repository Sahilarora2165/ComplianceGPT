import re                          
import sys
import hashlib
import json
import time
import requests
from pathlib import Path
from datetime import datetime, timezone
from typing import Optional
from bs4 import BeautifulSoup

# ── Path bootstrap ─────────────────────────────────────────────────────────────
# agents/monitoring_agent.py → parent = agents/ → parent = backend/ (app root)
_BACKEND_DIR = Path(__file__).resolve().parent.parent
sys.path.append(str(_BACKEND_DIR))

from config import PDF_DIR, LOGS_DIR
from core.audit import log_event

HASH_DB_PATH    = LOGS_DIR / "seen_documents.json"
SCRAPE_DELAY    = 5
REQUEST_TIMEOUT = 15
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    )
}

PORTALS = [
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
        "regulator":      "IncomeTax",
        "name":           "Income Tax Circulars",
        "url":            "https://incometaxindia.gov.in/Pages/communications/circulars.aspx",
        "list_selector":  "table.GridView tr",
        "link_selector":  "a[href$='.pdf']",
        "title_selector": "td:first-child",
        "base_url":       "https://incometaxindia.gov.in",
    },
    {
        "regulator":      "MCA",
        "name":           "MCA Circulars",
        "url":            "https://www.mca.gov.in/Ministry/pdf/GeneralCircular.pdf",
        "list_selector":  "table tr",
        "link_selector":  "a[href$='.pdf']",
        "title_selector": "td:first-child",
        "base_url":       "https://www.mca.gov.in",
    },
]

SIMULATED_DOCUMENTS = [
    {
        "regulator": "RBI",
        "title":     "RBI Circular: FEMA Compliance Deadline Extended - March 2026",
        "url":       "https://www.rbi.org.in/sample/fema_circular_march2026.pdf",
        "filename":  "rbi_fema_circular_march2026.pdf",
        "priority":  "HIGH",
        "summary":   "FEMA reporting deadline for foreign transactions extended by 30 days.",
    },
    {
        "regulator": "GST",
        "title":     "GST Advisory: New Invoice Management System (IMS) - April 2026",
        "url":       "https://www.gst.gov.in/sample/ims_advisory_april2026.pdf",
        "filename":  "gst_ims_advisory_april2026.pdf",
        "priority":  "HIGH",
        "summary":   "Invoice Management System mandatory from April 1, 2026 for all GST filers.",
    },
    {
        "regulator": "IncomeTax",
        "title":     "CBDT Circular: TDS Rate Revision - FY 2026-27",
        "url":       "https://incometaxindia.gov.in/sample/tds_revision_2026.pdf",
        "filename":  "incometax_tds_revision_2026.pdf",
        "priority":  "MEDIUM",
        "summary":   "TDS rates revised for Section 194C and 194J effective April 2026.",
    },
    {
        "regulator": "MCA",
        "title":     "MCA Notification: LLP Annual Filing Deadline - FY 2025-26",
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


def _load_hash_db() -> dict:
    if HASH_DB_PATH.exists():
        try:
            return json.loads(HASH_DB_PATH.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def _save_hash_db(db: dict) -> None:
    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    HASH_DB_PATH.write_text(json.dumps(db, indent=2), encoding="utf-8")


def _hash_content(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _is_new_document(url: str, data: bytes, db: dict) -> bool:
    new_hash = _hash_content(data)
    if db.get(url) == new_hash:
        return False
    db[url] = new_hash
    return True


def _is_html(data: bytes) -> bool:
    sniff = data[:20].lower()
    return sniff.startswith(b"<!doctype") or sniff.startswith(b"<html")


def _clean_bad_downloads() -> int:
    removed = 0
    for f in PDF_DIR.glob("*.pdf"):
        try:
            if _is_html(f.read_bytes()):
                print(f"  Removing fake PDF: {f.name}")
                f.unlink()
                removed += 1
        except Exception:
            pass
    if removed:
        print(f"  Cleaned {removed} bad file(s)")
    return removed


def _infer_priority(title: str) -> str:
    t = title.lower()
    if any(k in t for k in ["deadline", "extension", "penalty", "mandatory", "fema", "urgent"]):
        return "HIGH"
    if any(k in t for k in ["esg", "advisory", "clarification", "faqs"]):
        return "LOW"
    return "MEDIUM"


def _scrape_rbi_playwright(hash_db: dict) -> list[dict]:
    print("\n  Scraping [RBI] via Playwright ...")
    new_docs = []

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("  Playwright not installed")
        return []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            viewport={"width": 1280, "height": 800},
        )
        page = context.new_page()

        try:
            print("    Loading RBI press releases page ...")
            page.goto(
                "https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx",
                wait_until="networkidle",
                timeout=40000,
            )
            page.wait_for_selector("tr", timeout=15000)
        except Exception as e:
            print(f"    Page load failed: {e}")
            browser.close()
            return []

        links = page.eval_on_selector_all(
            "a[href*='.PDF'], a[href*='.pdf']",
            "els => els.map(e => ({href: e.href, text: (e.closest('tr') ? e.closest('tr').innerText : e.innerText).trim()}))"
        )
        print(f"    Found {len(links)} PDF link(s)")

        for link in links[:20]:
            href  = link.get("href", "").strip()
            title = link.get("text", "").strip()
            title = re.sub(r'\s*\d+\s*kb\s*$', '', title, flags=re.IGNORECASE).strip()
            title = title[:120] or href

            if not href or ".pdf" not in href.lower():
                continue

            if not _is_new_document(href, href.encode(), hash_db):
                print(f"    Already seen: {Path(href).name}")
                continue

            stem     = Path(href.split("?")[0]).stem[:60]
            filename = f"rbi_{stem}.pdf"
            dest     = PDF_DIR / filename

            if dest.exists():
                print(f"    Already on disk: {filename}")
                new_docs.append({
                    "regulator": "RBI",
                    "title":     title,
                    "url":       href,
                    "filename":  filename,
                    "priority":  _infer_priority(title),
                    "summary":   "",
                    "source":    "real_scrape",
                })
                continue

            try:
                print(f"    Downloading: {filename} ...")
                resp      = context.request.get(href, timeout=20000)
                pdf_bytes = resp.body()

                if _is_html(pdf_bytes):
                    print(f"    Bot challenge for {filename} — skipping")
                    continue

                if not pdf_bytes.startswith(b"%PDF"):
                    print(f"    Not a valid PDF — skipping {filename}")
                    continue

                PDF_DIR.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(pdf_bytes)
                print(f"    Saved: {filename} ({len(pdf_bytes) // 1024} KB)")

                new_docs.append({
                    "regulator": "RBI",
                    "title":     title,
                    "url":       href,
                    "filename":  filename,
                    "priority":  _infer_priority(title),
                    "summary":   "",
                    "source":    "real_scrape",
                })

            except Exception as e:
                print(f"    Download failed for {filename}: {e}")

            time.sleep(1)

        browser.close()

    print(f"    RBI: {len(new_docs)} new document(s) found")
    return new_docs


_CIRCULAR_NAV_SKIP = {
    "notifications", "accessibility statement", "disclaimer",
    "sitemap", "contact us", "feedback", "right to information",
    "utkarsh", "core purpose", "values and vision", "careers",
    "tenders", "media", "statistics", "publications", "home",
}

def _is_valid_circular_title(title: str) -> bool:
    """Filter out navigation/footer links masquerading as circulars."""
    if len(title) < 15:
        return False
    tl = title.lower()
    if any(skip in tl for skip in _CIRCULAR_NAV_SKIP):
        return False
    return True


def _scrape_rbi_circulars_playwright(hash_db: dict) -> list[dict]:
    """
    Scrapes RBI Circulars & Notifications — where FEMA, KYC, banking
    directions and NBFC rules are published.

    Strategy:
      1. Load BS_CircularIndexDisplay.aspx
      2. Click the most recent year to expand the circular list
      3. Extract NotificationUser.aspx?Id=XXXX links
      4. For each new circular, visit the page and download its PDF
    """
    print("\n  Scraping [RBI] Circulars & Notifications via Playwright ...")
    new_docs = []

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("  Playwright not installed")
        return []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
            viewport={"width": 1280, "height": 800},
        )
        page = context.new_page()

        try:
            print("    Loading RBI circulars index ...")
            page.goto(
                "https://www.rbi.org.in/Scripts/BS_CircularIndexDisplay.aspx",
                wait_until="networkidle",
                timeout=40000,
            )
            # Wait for any link to appear (DOM-attached), not "visible" — the
            # year-nav table is empty until a year is clicked, so the default
            # visible state check times out.
            page.wait_for_selector("a", timeout=15000, state="attached")
        except Exception as e:
            print(f"    Page load failed: {e}")
            browser.close()
            return []

        # The page shows a year table. Click the most recent year to load circulars.
        try:
            current_year = str(datetime.now().year)
            prev_year    = str(datetime.now().year - 1)

            year_link = (
                page.query_selector(f"a:text('{current_year}')") or
                page.query_selector(f"a:text('{prev_year}')")
            )
            if year_link:
                print(f"    Clicking year: {year_link.inner_text().strip()} ...")
                year_link.click()
                page.wait_for_load_state("networkidle", timeout=20000)
            else:
                print("    Year link not found — using page as-is")
        except Exception as e:
            print(f"    Year click failed: {e} — using page as-is")

        # Only pick NotificationUser links that have a numeric Id parameter
        links = page.eval_on_selector_all(
            "a[href*='NotificationUser.aspx']",
            """els => els
                .filter(e => /[?&]Id=\\d+/i.test(e.href))
                .map(e => ({
                    href: e.href,
                    text: (e.closest('tr') ? e.closest('tr').innerText : e.innerText).trim()
                }))"""
        )
        print(f"    Found {len(links)} notification link(s)")

        for link in links[:20]:
            href  = link.get("href", "").strip()
            title = link.get("text", "").strip()
            title = re.sub(r'\s*\d+\s*kb\s*$', '', title, flags=re.IGNORECASE).strip()
            title = re.sub(r'\s+', ' ', title)[:120]

            if not href or not _is_valid_circular_title(title):
                continue

            if not _is_new_document(href, href.encode(), hash_db):
                print(f"    Already seen: {title[:70]}")
                continue

            print(f"    New circular: {title[:70]}")

            # Visit the notification page and download its PDF
            id_match = re.search(r'Id=(\d+)', href, re.IGNORECASE)
            notif_id = id_match.group(1) if id_match else re.sub(r'\W+', '_', title[:20])
            filename = f"rbi_circ_{notif_id}.pdf"
            dest     = PDF_DIR / filename

            if dest.exists():
                print(f"    Already on disk: {filename}")
            else:
                try:
                    notif_page = context.new_page()
                    notif_page.goto(href, wait_until="networkidle", timeout=30000)
                    pdf_links = notif_page.eval_on_selector_all(
                        "a[href*='.PDF'], a[href*='.pdf']",
                        "els => els.map(e => e.href)"
                    )
                    notif_page.close()

                    if pdf_links:
                        resp      = context.request.get(pdf_links[0], timeout=20000)
                        pdf_bytes = resp.body()
                        if pdf_bytes.startswith(b"%PDF") and not _is_html(pdf_bytes):
                            PDF_DIR.mkdir(parents=True, exist_ok=True)
                            dest.write_bytes(pdf_bytes)
                            print(f"    Saved: {filename} ({len(pdf_bytes) // 1024} KB)")
                        else:
                            filename = ""
                    else:
                        print(f"    No PDF on notification page — LLM fallback")
                        filename = ""
                except Exception as e:
                    print(f"    Could not fetch notification page: {e}")
                    filename = ""

            new_docs.append({
                "regulator": "RBI",
                "title":     title,
                "url":       href,
                "filename":  filename,
                "priority":  _infer_priority(title),
                "summary":   "",
                "source":    "real_scrape",
            })

            time.sleep(1)

        browser.close()

    print(f"    RBI Circulars: {len(new_docs)} new document(s) found")
    return new_docs


_sessions: dict = {}

def _get_session(base_url: str) -> requests.Session:
    if base_url not in _sessions:
        session = requests.Session()
        session.headers.update(HEADERS)
        try:
            session.get(base_url, timeout=REQUEST_TIMEOUT)
        except Exception:
            pass
        _sessions[base_url] = session
    return _sessions[base_url]


def _download_pdf(pdf_url: str, filename: str, base_url: str) -> Optional[Path]:
    dest = PDF_DIR / filename
    if dest.exists():
        if _is_html(dest.read_bytes()):
            dest.unlink()
        else:
            print(f"    Already on disk: {filename}")
            return dest
    try:
        session   = _get_session(base_url)
        resp      = session.get(pdf_url, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()
        pdf_bytes = resp.content
        if _is_html(pdf_bytes) or not pdf_bytes.startswith(b"%PDF"):
            print(f"    Not a valid PDF — skipping {filename}")
            return None
        PDF_DIR.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(pdf_bytes)
        print(f"    Downloaded: {filename} ({len(pdf_bytes) // 1024} KB)")
        return dest
    except Exception as e:
        print(f"    Download failed for {filename}: {e}")
        return None


def _scrape_portal(portal: dict, hash_db: dict) -> list[dict]:
    new_docs = []
    print(f"\n  Scraping [{portal['regulator']}] {portal['name']} ...")
    try:
        resp = requests.get(portal["url"], headers=HEADERS, timeout=REQUEST_TIMEOUT)
        resp.raise_for_status()
        soup = BeautifulSoup(resp.content, "html.parser")
        rows = soup.select(portal["list_selector"])
        print(f"    Found {len(rows)} rows")
        for row in rows[:20]:
            link_tag = row.select_one(portal["link_selector"])
            if not link_tag:
                continue
            href  = link_tag.get("href", "")
            title = row.get_text(strip=True)[:120]
            title = re.sub(r'\s*\d+\s*kb\s*$', '', title, flags=re.IGNORECASE).strip()
            if href.startswith("http"):
                pdf_url = href
            elif href.startswith("/"):
                pdf_url = portal["base_url"] + href
            else:
                pdf_url = portal["base_url"] + "/" + href
            if ".pdf" not in pdf_url.lower():
                continue
            try:
                head           = requests.head(pdf_url, headers=HEADERS, timeout=REQUEST_TIMEOUT, allow_redirects=True)
                content_sample = head.headers.get("ETag", pdf_url).encode()
            except Exception:
                content_sample = pdf_url.encode()
            if not _is_new_document(pdf_url, content_sample, hash_db):
                continue
            stem     = Path(pdf_url.split("?")[0]).stem[:60]
            filename = f"{portal['regulator'].lower()}_{stem}.pdf"
            new_docs.append({
                "regulator": portal["regulator"],
                "title":     title,
                "url":       pdf_url,
                "filename":  filename,
                "priority":  _infer_priority(title),
                "summary":   "",
                "source":    "real_scrape",
            })
        time.sleep(SCRAPE_DELAY)
    except Exception as e:
        print(f"    Scrape failed for {portal['name']}: {e}")
    return new_docs


# ── Simulate Mode ──────────────────────────────────────────────────────────────

def _simulate_new_documents(hash_db: dict, regulators: list[str] = None) -> list[dict]:
    new_docs = []
    pool = SIMULATED_DOCUMENTS
    if regulators:
        pool = [d for d in pool if d["regulator"] in regulators]
    for doc in pool:
        key = f"sim::{doc['url']}"
        if _is_new_document(key, doc["url"].encode(), hash_db):
            new_docs.append({**doc, "source": "simulated"})
    return new_docs


def run_monitoring_agent(
    simulate_mode: bool = False,
    regulators: list = None,
    auto_ingest: bool = True,
) -> list[dict]:
    print("\n" + "=" * 60)
    print("ComplianceGPT - Monitoring Agent")
    print(f"   Mode      : {'SIMULATE' if simulate_mode else 'REAL SCRAPE'}")
    print(f"   Regulators: {regulators or 'ALL'}")
    print(f"   Time      : {datetime.now(timezone.utc).isoformat()}")
    print("=" * 60)

    _clean_bad_downloads()
    hash_db  = _load_hash_db()
    new_docs = []

    if simulate_mode:
        print("\nRunning in SIMULATE mode")
        new_docs = _simulate_new_documents(hash_db, regulators)
    else:
        if not regulators or "RBI" in regulators:
            new_docs.extend(_scrape_rbi_playwright(hash_db))
            new_docs.extend(_scrape_rbi_circulars_playwright(hash_db))

        other_portals = [p for p in PORTALS if not regulators or p["regulator"] in regulators]
        for portal in other_portals:
            new_docs.extend(_scrape_portal(portal, hash_db))

        if not new_docs:
            print("\nReal scraping found nothing — falling back to SIMULATE")
            log_event(agent="MonitoringAgent", action="scrape_fallback", details={"reason": "no_new_docs"})
            new_docs = _simulate_new_documents(hash_db, regulators)

    if not new_docs:
        print("\nNo new documents found.")
        log_event(agent="MonitoringAgent", action="monitor_complete", details={"new_docs": 0})
        _save_hash_db(hash_db)
        return []

    print(f"\n{len(new_docs)} new document(s) detected:\n")
    for i, doc in enumerate(new_docs, 1):
        print(f"  {i}. [{doc['regulator']}] {doc['title']}")
        print(f"     Priority : {doc['priority']}")
        print(f"     Source   : {doc['source']}")

    if auto_ingest:
        print("\nDownloading & ingesting new documents...")
        _ingest_new_docs(new_docs)

    _save_hash_db(hash_db)
    log_event(
        agent="MonitoringAgent",
        action="monitor_complete",
        details={
            "mode":     "simulate" if simulate_mode else "real",
            "new_docs": len(new_docs),
            "docs":     [{"title": d["title"], "regulator": d["regulator"], "priority": d["priority"]} for d in new_docs],
        }
    )
    print(f"\nMonitoring complete - {len(new_docs)} new document(s) processed.")
    return new_docs


def _ingest_new_docs(new_docs: list) -> None:
    try:
        from core.ingest import ingest_pdf
    except ImportError:
        try:
            from ingest import ingest_pdf
        except ImportError:
            print("  Could not import ingest_pdf — skipping")
            return

    for doc in new_docs:
        if not doc.get("filename"):
            print(f"\n  Skipping ingest (no PDF): {doc['title'][:70]}")
            continue

        print(f"\n  Processing: {doc['filename']}")

        if doc["source"] == "simulated":
            dest = PDF_DIR / doc["filename"].replace(".pdf", "_sim.txt")
            PDF_DIR.mkdir(parents=True, exist_ok=True)
            dest.write_text(
                f"SIMULATED DOCUMENT\nRegulator : {doc['regulator']}\nTitle     : {doc['title']}\n"
                f"Summary   : {doc['summary']}\nURL       : {doc['url']}\n"
                f"Generated : {datetime.now(timezone.utc).isoformat()}\n",
                encoding="utf-8"
            )
            print(f"    Placeholder created: {dest.name}")
            log_event(agent="MonitoringAgent", action="doc_simulated",
                      details={"filename": doc["filename"], "regulator": doc["regulator"]},
                      citation=doc["title"])
            continue

        local_path = PDF_DIR / doc["filename"]
        if not local_path.exists():
            if doc["regulator"] == "RBI":
                print(f"    RBI file not on disk (Playwright failed) — skipping ingest")
                continue
            base_url   = f"https://{doc['url'].split('/')[2]}"
            local_path = _download_pdf(doc["url"], doc["filename"], base_url)

        if local_path and local_path.exists():
            try:
                ingest_pdf(str(local_path))
            except Exception as e:
                print(f"    Ingest failed: {e}")
                log_event(agent="MonitoringAgent", action="ingest_failed",
                          details={"filename": doc["filename"], "error": str(e)})


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description="ComplianceGPT Monitoring Agent")
    parser.add_argument("--simulate", action="store_true")
    parser.add_argument("--regulators", nargs="+", choices=["RBI", "GST", "IncomeTax", "MCA", "SEBI"])
    parser.add_argument("--no-ingest", action="store_true")
    args = parser.parse_args()
    run_monitoring_agent(
        simulate_mode=args.simulate,
        regulators=args.regulators,
        auto_ingest=not args.no_ingest,
    )
