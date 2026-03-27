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
DEBUG_DIR       = LOGS_DIR / "scrape_debug"
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    )
}

PORTALS = []   # All portals now use dedicated Playwright scrapers below

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
    {
        "regulator": "RBI",
        "title":     "RBI Directions: NBFC Governance and KYC Compliance - 2026",
        "url":       "https://www.rbi.org.in/sample/nbfc_governance_2026.pdf",
        "filename":  "rbi_nbfc_governance_2026.pdf",
        "priority":  "HIGH",
        "summary":   "RBI issues updated directions on NBFC internal governance, KYC norms, and monthly return filing.",
    },
    {
        "regulator": "IncomeTax",
        "title":     "CBDT Circular: Presumptive Taxation under Section 44ADA for Professionals - FY 2026-27",
        "url":       "https://incometaxindia.gov.in/sample/presumptive_44ada_2026.pdf",
        "filename":  "incometax_presumptive_44ada_2026.pdf",
        "priority":  "MEDIUM",
        "summary":   "CBDT clarifies applicability of presumptive taxation scheme under Section 44ADA for freelancers and professionals.",
    },
    {
        "regulator": "IncomeTax",
        "title":     "CBDT Circular: DTAA Relief for NRI Rental Income and TDS Refund Claims - FY 2026-27",
        "url":       "https://incometaxindia.gov.in/sample/nri_dtaa_rental_2026.pdf",
        "filename":  "incometax_nri_dtaa_rental_2026.pdf",
        "priority":  "MEDIUM",
        "summary":   "CBDT guidance on DTAA benefit claims for NRI rental income and excess TDS deducted by tenants under Section 195.",
    },
    {
        "regulator": "IncomeTax",
        "title":     "CBDT Circular: Capital Gains on Debt Mutual Fund Redemptions - AY 2026-27",
        "url":       "https://incometaxindia.gov.in/sample/capital_gains_mf_2026.pdf",
        "filename":  "incometax_capital_gains_mf_2026.pdf",
        "priority":  "MEDIUM",
        "summary":   "CBDT clarifies capital gains computation for debt mutual fund redemptions and STT applicability for AY 2026-27.",
    },
    {
        "regulator": "EPFO",
        "title":     "EPFO Circular: ECR Filing Mandate and Wage Ceiling Update - 2026",
        "url":       "https://www.epfindia.gov.in/sample/ecr_wage_ceiling_2026.pdf",
        "filename":  "epfo_ecr_wage_ceiling_2026.pdf",
        "priority":  "HIGH",
        "summary":   "EPFO mandates monthly ECR filing and updates PF wage ceiling for covered establishments with 20 or more employees.",
    },
]

SIMULATED_DOCUMENT_TEXT = {
    "rbi_fema_circular_march2026.pdf": """
Reserve Bank of India circular on export and foreign exchange compliance for authorised dealer banks and eligible exporters. Authorised dealers are advised to ensure that SOFTEX and related FEMA reporting timelines are monitored for each export transaction, and delayed submissions should be escalated for immediate regularisation. Where the original reporting timeline was 30 days from the invoice or certification event, regulated entities should apply the revised extension window communicated in this circular and maintain documentary evidence of delay condonation wherever applicable.

Entities receiving export proceeds in foreign currency should reconcile shipping documents, invoices, bank realisation details, and SOFTEX declarations before closure of the reporting cycle. Dealers should obtain corrected declarations where transaction values, invoice references, or remittance details do not match prior submissions. Compliance teams should track pending export realisations, overdue foreign receivables, and FEMA follow-up items separately from GST or direct tax matters because these obligations arise specifically under RBI and FEMA reporting requirements.

This circular is intended to improve timeliness of export data submission, reduce mismatches in foreign exchange reporting, and support supervisory review by authorised dealer banks. Records relating to foreign inward remittance, export declaration forms, and SOFTEX certifications should be preserved in an auditable format for regulatory inspection.
""".strip(),
    "gst_ims_advisory_april2026.pdf": """
Goods and Services Tax Network advisory on implementation of the Invoice Management System (IMS) for registered taxpayers from April 1, 2026. Taxpayers should review supplier-uploaded invoices within the IMS workflow before auto-population into GSTR-2B, and mismatched invoices should be accepted, rejected, or kept pending within the prescribed cycle. Businesses must align purchase register reconciliation with IMS actions so that eligible input tax credit is reflected accurately in GSTR-3B.

The advisory clarifies that outward supply reporting in GSTR-1 continues to be the source document for invoice visibility in the recipient's IMS dashboard. Recipients should reconcile invoices, debit notes, and credit notes against books before finalising monthly returns, and unresolved mismatches may affect input tax credit availability. Compliance teams should ensure that vendor follow-up happens before filing GSTR-3B so that the claim of input tax credit matches the accepted invoice data.

Taxpayers with large vendor bases are encouraged to create maker-checker controls around IMS review, document exception handling for missing invoices, and maintain a return-close checklist covering GSTR-1, IMS actions, and GSTR-3B. The advisory is relevant to GST-registered entities and should not be used for RBI, FEMA, or direct tax compliance actions.
""".strip(),
    "incometax_tds_revision_2026.pdf": """
CBDT circular revising tax deduction at source compliance guidance for financial year 2026-27. Deductors making contractual payments under Section 194C and professional or technical fee payments under Section 194J should apply the revised TDS rates from the effective date notified in the circular. Entities must update ERP or payroll-accounting systems so the correct deduction logic is applied from the first payment cycle after implementation.

The circular reiterates that deductors should verify PAN availability, threshold limits, and the nature of payment before deciding the applicable section and rate. Any short deduction arising from legacy rate tables should be identified through vendor ledger review, and correction statements should be prepared where return filings need amendment. Monthly deposit of TDS and quarterly statement filing should continue within the statutory due dates under the Income-tax Act and related rules.

Businesses should maintain section-wise documentation for contractor payments, consultancy fees, and technical service invoices to support classification under Section 194C or Section 194J. This circular is limited to Income-tax and CBDT TDS obligations and does not create any GST, RBI, or MCA filing requirement.
""".strip(),
    "mca_llp_filing_2025_26.pdf": """
Ministry of Corporate Affairs notification regarding annual filing obligations for Limited Liability Partnerships for financial year 2025-26. Every LLP should prepare and file Form 11, being the LLP Annual Return, with the Registrar within the statutory filing timeline, and designated partners should confirm the particulars of partners, contribution, and business classification before submission. The annual compliance package should also include preparation of the Statement of Account and Solvency in Form 8, where applicable under the LLP framework.

The notification highlights that LLP Annual Return compliance is distinct from company annual filing under the Companies Act. Forms such as AOC-4 and MGT-7 apply to companies and are not substitutes for LLP Form 11 or Form 8. Compliance teams should therefore validate the constitution of the entity before preparing annual filing tasks, and only LLPs should be assigned these MCA obligations.

For demo purposes, the filing calendar should treat October 30 as the annual due date benchmark for LLP Annual Return tracking unless a later extension is expressly notified. Supporting registers, partner details, and financial statements should be reviewed in advance so the filing can be completed without late fees.
""".strip(),
    "sebi_esg_disclosure_2026.pdf": """
Securities and Exchange Board of India circular enhancing ESG disclosure expectations for listed entities. The circular applies to listed companies within the prescribed coverage universe and requires stronger reporting on environmental, social, and governance metrics through the applicable annual reporting framework. Companies should review board-approved sustainability governance, materiality assessment, and data ownership across business units before compiling disclosures.

Listed entities should ensure that ESG disclosures are consistent with annual report narratives, business responsibility and sustainability reporting, and risk management statements made to stock exchanges. Metrics relating to greenhouse gas emissions, workforce data, supply chain due diligence, and governance controls should be documented with internal evidence trails. Investor-facing disclosures should be reviewed for completeness and consistency before submission to exchanges or inclusion in annual reporting.

The circular is intended for capital market disclosure compliance and should be actioned only for relevant listed companies. Unlisted entities or businesses outside the SEBI disclosure perimeter may treat the update as awareness-only unless they are specifically brought within the reporting framework.
""".strip(),
    "rbi_nbfc_governance_2026.pdf": """
Reserve Bank of India directions issued to Non-Banking Financial Companies on strengthening internal governance frameworks, Know Your Customer compliance, and periodic regulatory return filing. NBFCs classified under the applicable tier must ensure that the monthly NBS-9 return is filed by the 7th of each succeeding month, and any delays should be reported with explanation to the concerned Regional Office. Board-level oversight of compliance monitoring, internal audit findings, and RBI inspection observations should be documented in board minutes.

NBFCs must ensure KYC records are updated for all borrowers and depositors at the prescribed periodicity. Entities falling under the RBI regulatory perimeter must designate a compliance officer and ensure that FICO or equivalent risk frameworks capture NBFC-specific liquidity and credit risks. Failures in governance or delayed regulatory filings may attract monetary penalties or enforcement action under the RBI Act.

This circular applies exclusively to RBI-registered and regulated Non-Banking Financial Companies. Non-regulated entities, exporters, or GST-only businesses should not treat this as creating any compliance obligation and should disregard this circular.
""".strip(),
    "incometax_presumptive_44ada_2026.pdf": """
Central Board of Direct Taxes circular clarifying the applicability and computation methodology under the presumptive taxation scheme for professionals and freelancers under Section 44ADA of the Income-tax Act. Eligible professionals — including doctors, lawyers, engineers, architects, accountants, technical consultants, interior decorators, and film artists — with gross receipts not exceeding the prescribed threshold may opt for presumptive income computation at 50 percent of gross receipts.

Freelancers opting for the presumptive scheme must ensure that advance tax for Q4 is deposited by March 15. ITR-4 (SUGAM) should be filed for assessment year 2026-27 reporting presumptive income. The circular clarifies that professionals under 44ADA are not required to maintain regular books of account under Section 44AA, nor are they subject to tax audit under Section 44AB, provided the income is declared correctly and the threshold conditions are satisfied.

This circular is specifically relevant to self-employed professionals and freelancers who have opted or intend to opt for the presumptive taxation scheme. It does not apply to salaried individuals, companies, LLPs, or businesses computing actual income under regular books.
""".strip(),
    "incometax_nri_dtaa_rental_2026.pdf": """
Central Board of Direct Taxes guidance circular addressing DTAA benefit claims for non-resident Indians earning rental income from properties in India and the correct procedure for claiming refund of excess TDS deducted by tenants under Section 195. NRIs should file ITR-2 for assessment year 2026-27 declaring Indian-source rental income and claiming DTAA relief under the applicable article of the relevant double taxation avoidance agreement.

Where tenants have deducted TDS at 30 percent on rental payments to NRIs, the NRI taxpayer may claim the benefit of DTAA to reduce effective tax rate, and any excess TDS should be claimed as refund in the income tax return. The circular clarifies that Form 15CA and 15CB requirements apply to foreign remittances by the tenant and should be filed before each remittance. NRIs should also disclose FCNR and NRE account details in the schedule of foreign assets.

This circular applies specifically to non-resident Indians with Indian-source income, NRE or NRO account holders, and persons claiming DTAA benefits under India's bilateral tax treaties. Resident individuals, companies, or LLPs are not covered by this guidance.
""".strip(),
    "incometax_capital_gains_mf_2026.pdf": """
Central Board of Direct Taxes circular clarifying capital gains taxation on debt mutual fund redemptions for assessment year 2026-27 following the amendment removing the indexation benefit for debt fund units purchased after April 1, 2023. Investors redeeming debt mutual fund units should compute capital gains as the difference between redemption value and purchase cost without indexation adjustment, and the applicable tax rate is the slab rate for short-term capital gains regardless of holding period.

Investors holding equity mutual funds for more than 12 months should compute long-term capital gains under Section 112A, and gains exceeding Rs 1 lakh in a financial year are taxable at 10 percent. STT paid on redemption of equity funds should be documented. The circular reiterates that capital gains from mutual fund redemptions should be reported in ITR-2 under the appropriate schedule, and advance tax should have been deposited in proportion to gains realised during each quarter.

This circular applies to individual taxpayers with capital gain income from mutual fund redemptions. It is not relevant to salaried-only individuals without investment income, businesses or firms, or entities assessed as companies or LLPs.
""".strip(),
    "epfo_ecr_wage_ceiling_2026.pdf": """
Employees Provident Fund Organisation circular mandating timely monthly Electronic Challan cum Return filing for all covered establishments and notifying the updated wage ceiling for EPF contribution computation. Every establishment with 20 or more employees must file the ECR by the 15th of each succeeding month and deposit PF contributions by the same date. Delayed ECR filings attract interest at 12 percent per annum under Section 7Q of the EPF and MP Act, and establishments with persistent delays may be subject to damages assessment under Section 14B.

The circular updates the wage ceiling for EPF applicability and requires establishments to ensure that employee and employer contribution rates are applied on the correct wage components. Establishments must reconcile ECR data with payroll registers, employee headcount, and bank debit confirmations before submission. ESIC challan filing should similarly be completed by the 15th of each month for establishments under ESIC coverage.

This circular applies only to EPFO-covered establishments — those employing 20 or more persons in notified industries or voluntarily covered. It does not apply to individual taxpayers, sole proprietors below the threshold, or businesses without employees on the EPF payroll.
""".strip(),
}


def _build_simulated_document_text(doc: dict) -> str:
    body = SIMULATED_DOCUMENT_TEXT.get(doc["filename"], doc["summary"])
    return (
        "SIMULATED REGULATORY DOCUMENT\n"
        f"Regulator : {doc['regulator']}\n"
        f"Title     : {doc['title']}\n"
        f"Summary   : {doc['summary']}\n"
        f"URL       : {doc['url']}\n"
        f"Generated : {datetime.now(timezone.utc).isoformat()}\n\n"
        f"{body}\n"
    )


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


def _absolute_url(base_url: str, href: str) -> str:
    href = (href or "").strip()
    if not href:
        return ""
    if href.startswith("http://") or href.startswith("https://"):
        return href
    if href.startswith("//"):
        return f"https:{href}"
    if href.startswith("/"):
        return f"{base_url.rstrip('/')}{href}"
    return f"{base_url.rstrip('/')}/{href.lstrip('/')}"


def _extract_href_from_onclick(value: str) -> str:
    if not value:
        return ""
    match = re.search(r"""['"]([^'"]+\.(?:pdf|aspx)[^'"]*)['"]""", value, re.IGNORECASE)
    return match.group(1) if match else ""


def _extract_links_from_html(
    html: str,
    base_url: str,
    *,
    href_patterns: list[str] | None = None,
    text_patterns: list[str] | None = None,
    min_text_len: int = 8,
) -> list[dict]:
    href_patterns = href_patterns or []
    text_patterns = text_patterns or []
    soup = BeautifulSoup(html, "html.parser")
    seen = set()
    links = []

    for anchor in soup.select("a, area"):
        href = (
            anchor.get("href")
            or anchor.get("data-href")
            or _extract_href_from_onclick(anchor.get("onclick", ""))
        )
        text = " ".join(anchor.stripped_strings)
        parent_text = " ".join(anchor.parent.stripped_strings) if anchor.parent else ""
        title = re.sub(r"\s+", " ", parent_text or text).strip()
        href = _absolute_url(base_url, href)
        href_l = href.lower()
        title_l = title.lower()

        if not href:
            continue
        if len(title) < min_text_len:
            continue
        if href_patterns and not any(pattern in href_l for pattern in href_patterns):
            continue
        if text_patterns and not any(pattern in title_l for pattern in text_patterns):
            continue
        key = (href, title)
        if key in seen:
            continue
        seen.add(key)
        links.append({"href": href, "text": title})

    return links


def _extract_document_urls_from_text(html: str, base_url: str) -> list[str]:
    patterns = [
        r"""https?://[^\s"'<>]+(?:\.pdf|getdocument\?[^\s"'<>]+|NotificationUser\.aspx[^\s"'<>]*)""",
        r"""(?:/|\.{0,2}/)[^\s"'<>]+(?:\.pdf|getdocument\?[^\s"'<>]+|NotificationUser\.aspx[^\s"'<>]*)""",
    ]
    found = []
    seen = set()
    for pattern in patterns:
        for match in re.findall(pattern, html, flags=re.IGNORECASE):
            url = _absolute_url(base_url, match.replace("\\/", "/"))
            if url in seen:
                continue
            seen.add(url)
            found.append(url)
    return found


def _http_get_html(url: str) -> str:
    resp = requests.get(url, headers=HEADERS, timeout=REQUEST_TIMEOUT)
    resp.raise_for_status()
    return resp.text


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


def _dump_debug_snapshot(page, regulator: str, slug: str) -> None:
    try:
        DEBUG_DIR.mkdir(parents=True, exist_ok=True)
        html_path = DEBUG_DIR / f"{regulator.lower()}_{slug}.html"
        png_path = DEBUG_DIR / f"{regulator.lower()}_{slug}.png"
        meta_path = DEBUG_DIR / f"{regulator.lower()}_{slug}.json"

        html_path.write_text(page.content(), encoding="utf-8")
        page.screenshot(path=str(png_path), full_page=True)
        anchors = page.eval_on_selector_all(
            "a[href]",
            """els => els.slice(0, 80).map(e => ({
                href: e.href,
                text: (e.innerText || e.textContent || '').trim().replace(/\\s+/g, ' ')
            }))""",
        )
        meta_path.write_text(
            json.dumps(
                {
                    "title": page.title(),
                    "url": page.url,
                    "anchors": anchors,
                },
                indent=2,
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        print(
            f"    Debug snapshot saved: {html_path.name}, {png_path.name}, {meta_path.name}"
        )
    except Exception as e:
        print(f"    Debug snapshot failed: {e}")


def _infer_priority(title: str) -> str:
    t = title.lower()
    if any(k in t for k in ["deadline", "extension", "penalty", "mandatory", "fema", "urgent"]):
        return "HIGH"
    if any(k in t for k in ["esg", "advisory", "clarification", "faqs"]):
        return "LOW"
    return "MEDIUM"


_RBI_PRESS_SKIP = {
    "auction result",
    "t-bill",
    "treasury bill",
    "weekly statistical supplement",
    "reserve money and money supply",
    "money market operations",
    "state government securities",
    "yield/price based auction",
    "issuance calendar",
    "calendar for auction",
    "wma limit",
    "vrr auction",
    "variable rate repo",
    "repo auction",
    "fortnight ended",
}

_GST_SKIP = {
    "view (",
    "concept and status",
    "updated ppt",
    "corrigendum",
}

_INCOMETAX_SKIP = {
    "vision-mission",
    "taxpayer charter",
    "charter",
    "mission",
    "values",
    "certificate",
    "cqw_",
}

_MCA_SKIP = {
    "ebook",
    "act",
    "rule",
}


def _contains_any(text: str, patterns: set[str]) -> bool:
    lowered = (text or "").lower()
    return any(pattern in lowered for pattern in patterns)


def _looks_recent(text: str, href: str, window_years: int = 1) -> bool:
    current_year = datetime.now().year
    accepted = {str(current_year), str(current_year - 1)}
    hay = f"{text} {href}"
    return any(year in hay for year in accepted)


def _normalize_download_url(url: str) -> str:
    if not url:
        return ""
    return (
        url.replace("https://cbec-gst.gov.in/", "https://cbic-gst.gov.in/")
        .replace("http://cbec-gst.gov.in/", "https://cbic-gst.gov.in/")
        .replace("https://www.cbec-gst.gov.in/", "https://cbic-gst.gov.in/")
    )


def _is_incometax_regulatory_item(title: str, link_text: str = "") -> bool:
    hay = f"{title} {link_text}".lower()
    include_terms = [
        "circular",
        "notification",
        "cbdt",
        "order",
        "press release",
        "vide notification",
        "refer circular",
    ]
    exclude_terms = [
        "faq",
        "utility",
        "guide",
        "annexure",
        "step by step",
        "download",
        "form enabled",
        "excel",
        "offline utility",
        "itr-",
        "itr ",
        "return filing",
        "taxpayer charter",
        "vision",
        "mission",
    ]
    return any(term in hay for term in include_terms) and not any(term in hay for term in exclude_terms)


def _parse_indian_date(value: str):
    value = (value or "").strip()
    if not value:
        return None
    for fmt in ("%d-%m-%Y", "%d/%m/%Y", "%d.%m.%Y"):
        try:
            return datetime.strptime(value, fmt)
        except ValueError:
            continue
    return None


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
            if _contains_any(title, _RBI_PRESS_SKIP):
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

        links = []

        # New RBI layout often renders current circulars directly on page without
        # needing a year click, so try broad extraction first.
        html = page.content()
        links = _extract_links_from_html(
            html,
            "https://www.rbi.org.in",
            href_patterns=["bs_viewcontent", "notificationuser.aspx", "notification", "scripts/"],
            text_patterns=["rbi/", "circular no.", "directions", "notification"],
            min_text_len=20,
        )

        # Fallback for older interactive year-nav layouts.
        if not links:
            try:
                current_year = datetime.now().year
                year_candidates = page.locator("a").evaluate_all(
                    """(els, currentYear) => els
                        .map(e => ({ text: (e.textContent || '').trim(), href: e.href }))
                        .filter(e => {
                            const t = e.text;
                            return (
                                /^20\\d{2}$/.test(t) ||
                                /^20\\d{2}[-/]20\\d{2}$/.test(t) ||
                                t.includes(String(currentYear)) ||
                                t.includes(String(currentYear - 1))
                            );
                        })""",
                    current_year,
                )
                if year_candidates:
                    label = year_candidates[0]["text"]
                    print(f"    Clicking year: {label}")
                    page.get_by_text(label, exact=True).first.click()
                    page.wait_for_load_state("networkidle", timeout=20000)
                    html = page.content()
                    links = _extract_links_from_html(
                        html,
                        "https://www.rbi.org.in",
                        href_patterns=["bs_viewcontent", "notificationuser.aspx", "notification", "scripts/"],
                        text_patterns=["rbi/", "circular no.", "directions", "notification"],
                        min_text_len=20,
                    )
            except Exception as e:
                print(f"    Year click fallback failed: {e}")

        print(f"    Found {len(links)} notification link(s)")

        for link in links[:20]:
            href  = link.get("href", "").strip()
            title = link.get("text", "").strip()
            title = re.sub(r'\s*\d+\s*kb\s*$', '', title, flags=re.IGNORECASE).strip()
            title = re.sub(r'\s+', ' ', title)[:120]

            if not href or not _is_valid_circular_title(title):
                continue
            if "draft directions" in title.lower():
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
                        "a[href*='.PDF'], a[href*='.pdf'], a[href*='pdf']",
                        "els => els.map(e => e.href)"
                    )
                    if not pdf_links:
                        pdf_links = [
                            item["href"]
                            for item in _extract_links_from_html(
                                notif_page.content(),
                                "https://www.rbi.org.in",
                                href_patterns=[".pdf", "pdf"],
                                min_text_len=1,
                            )
                        ]
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


def _scrape_gst_playwright(hash_db: dict) -> list[dict]:
    """
    CBIC CGST Circulars — https://cbic-gst.gov.in/gst-circulars.html
    Table structure: Circular No | English (PDF) | Hindi (PDF) | Date of issue | Subject
    Column 1 holds the English PDF "View" link.
    """
    print("\n  Scraping [GST] CBIC CGST Circulars via Playwright ...")
    new_docs = []
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("  Playwright not installed"); return []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            viewport={"width": 1280, "height": 800},
        )
        page = context.new_page()
        try:
            print("    Loading CBIC GST circulars page ...")
            page.goto("https://cbic-gst.gov.in/gst-circulars.html", wait_until="networkidle", timeout=60000)
            page.wait_for_timeout(3000)
        except Exception as e:
            print(f"    Page load failed: {e}"); browser.close(); return []

        rows = page.eval_on_selector_all(
            "table tr",
            """rows => rows
                .filter(r => r.querySelectorAll('td').length >= 5)
                .map(r => {
                    const tds = Array.from(r.querySelectorAll('td'));
                    const englishCell = tds[1];
                    const englishLink = englishCell
                      ? Array.from(englishCell.querySelectorAll('a')).find(a => {
                          const href = (a.href || '').toLowerCase();
                          return href.includes('.pdf') || href.includes('cbic-gst') || href.includes('cbec-gst');
                        })
                      : null;
                    return {
                        href: englishLink ? englishLink.href : '',
                        circular_no: (tds[0]?.innerText || '').trim(),
                        date: (tds[3]?.innerText || '').trim(),
                        subject: (tds[4]?.innerText || '').trim()
                    };
                })
                .filter(r => r.href && r.circular_no && r.subject)"""
        )

        if not rows:
            for url in [
                "https://cbic-gst.gov.in/gst-circulars.html",
                "https://cbic-gst.gov.in/hindi/circulars.html",
            ]:
                try:
                    html = _http_get_html(url)
                    soup = BeautifulSoup(html, "html.parser")
                    extracted = []
                    for tr in soup.select("table tr"):
                        cells = tr.select("td")
                        if len(cells) < 5:
                            continue
                        english_link = None
                        for anchor in cells[1].select("a[href]"):
                            href = _normalize_download_url(_absolute_url("https://cbic-gst.gov.in", anchor.get("href", "")))
                            if ".pdf" in href.lower() or "cbic-gst" in href.lower() or "cbec-gst" in href.lower():
                                english_link = href
                                break
                        circular_no = re.sub(r"\s+", " ", cells[0].get_text(" ", strip=True)).strip()
                        issue_date = re.sub(r"\s+", " ", cells[3].get_text(" ", strip=True)).strip()
                        subject = re.sub(r"\s+", " ", cells[4].get_text(" ", strip=True)).strip()
                        if english_link and circular_no and subject:
                            extracted.append({
                                "href": english_link,
                                "circular_no": circular_no,
                                "date": issue_date,
                                "subject": subject,
                            })
                    if extracted:
                        rows = extracted
                        print(f"    HTTP fallback recovered {len(rows)} GST row(s) from {url}")
                        break
                except Exception as e:
                    print(f"    GST HTTP fallback failed for {url}: {e}")
        print(f"    Found {len(rows)} circular(s)")

        recent_rows = []
        current_year = datetime.now().year
        for row in rows:
            href  = _normalize_download_url(row.get("href", "").strip())
            circular_no = re.sub(r"\s+", " ", row.get("circular_no", "")).strip()
            subject = re.sub(r"\s+", " ", row.get("subject", "")).strip()
            issue_date = re.sub(r"\s+", " ", row.get("date", "")).strip()
            title = f"{circular_no} | {subject}".strip(" |")[:160]
            if _contains_any(title, _GST_SKIP) or not circular_no or not subject:
                continue
            parsed_date = _parse_indian_date(issue_date)
            if parsed_date and parsed_date.year < current_year - 1:
                continue
            if not parsed_date and not _looks_recent(title, href):
                continue
            recent_rows.append({
                "href": href,
                "title": title,
                "date": issue_date,
                "circular_no": circular_no,
            })

        for row in recent_rows[:15]:
            href = row["href"]
            title = row["title"]
            if not href or not _is_new_document(href, href.encode(), hash_db):
                if href:
                    print(f"    Already seen: {row.get('circular_no','')}")
                continue
            stem     = Path(href.split("?")[0]).stem[:60]
            filename = f"gst_{stem}.pdf"
            dest     = PDF_DIR / filename
            print(f"    New circular: {title[:70]}")
            if not dest.exists():
                try:
                    pdf_bytes = context.request.get(href, timeout=20000).body()
                    if pdf_bytes.startswith(b"%PDF") and not _is_html(pdf_bytes):
                        PDF_DIR.mkdir(parents=True, exist_ok=True)
                        dest.write_bytes(pdf_bytes)
                        print(f"    Saved: {filename} ({len(pdf_bytes)//1024} KB)")
                    else:
                        filename = ""
                except Exception as e:
                    print(f"    Download failed: {e}"); filename = ""
            new_docs.append({"regulator": "GST", "title": title, "url": href,
                             "filename": filename, "priority": _infer_priority(title),
                             "summary": "", "source": "real_scrape"})
            time.sleep(1)
        browser.close()

    print(f"    GST: {len(new_docs)} new document(s) found")
    return new_docs


def _scrape_epfo_playwright(hash_db: dict) -> list[dict]:
    """
    EPFO Circulars — https://www.epfindia.gov.in/site_en/circulars.php
    Structure: Table with circular title, PDF link, date.
    Regulator tag: EPFO — matches clients with PF/ESIC obligations.
    """
    print("\n  Scraping [EPFO] PF Circulars via Playwright ...")
    new_docs = []
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("  Playwright not installed"); return []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            viewport={"width": 1280, "height": 800},
        )
        page = context.new_page()
        try:
            print("    Loading EPFO circulars page ...")
            page.goto("https://www.epfindia.gov.in/site_en/circulars.php", wait_until="domcontentloaded", timeout=40000)
            page.wait_for_selector("body", timeout=15000, state="attached")
            page.wait_for_timeout(2000)
        except Exception as e:
            print(f"    Page load failed: {e}"); browser.close(); return []

        # Extract only actual PDF circular links — skip navigation, accessibility, and UI links
        _EPFO_NAV_NOISE = {
            "skip to main content", "a+ a a-", "citizen's charter",
            "home", "about us", "contact us", "sitemap", "disclaimer",
            "screen reader", "help desk", "tollfree", "services",
            "exempted estt", "epfo corner", "miscellaneous", "ease of doing business",
        }
        links = page.eval_on_selector_all(
            "a[href$='.pdf'], a[href$='.PDF']",
            """els => els
                .map(e => ({
                    href: e.href,
                    text: (e.closest('td') || e.closest('li') || e.closest('p') || e.parentElement)
                              ?.innerText?.trim().replace(/\\s+/g, ' ') || e.innerText.trim()
                }))
                .filter(e => e.href && e.text && e.text.length > 15)"""
        )
        # Filter out known nav noise by lowercased text
        links = [
            lnk for lnk in links
            if not any(noise in lnk.get("text", "").lower() for noise in _EPFO_NAV_NOISE)
        ]

        # Keep only recent circulars — URLs or text containing current or previous year.
        # This prevents wasting the 15-slot cap on decade-old historical PDFs.
        current_year = datetime.now().year
        recent_years = {str(current_year), str(current_year - 1)}
        recent_links = [
            lnk for lnk in links
            if any(
                yr in lnk.get("href", "") or yr in lnk.get("text", "")
                for yr in recent_years
            )
        ]
        # Fallback: if year filter strips everything (page uses opaque URLs), use all
        links = recent_links if recent_links else links
        print(f"    Found {len(links)} recent PDF link(s)")

        for link in links[:15]:
            href  = link.get("href", "").strip()
            title = re.sub(r'\s+', ' ', link.get("text", "")).strip()[:120]
            if not href:
                continue
            if not _is_new_document(href, href.encode(), hash_db):
                print(f"    Already seen: {title[:60]}")
                continue
            stem     = Path(href.split("?")[0]).stem[:60] or "epfo_circular"
            filename = f"epfo_{stem}.pdf"
            dest     = PDF_DIR / filename
            print(f"    New circular: {title[:70]}")
            if not dest.exists() and href.lower().endswith(".pdf"):
                try:
                    pdf_bytes = context.request.get(href, timeout=20000).body()
                    if pdf_bytes.startswith(b"%PDF") and not _is_html(pdf_bytes):
                        PDF_DIR.mkdir(parents=True, exist_ok=True)
                        dest.write_bytes(pdf_bytes)
                        print(f"    Saved: {filename} ({len(pdf_bytes)//1024} KB)")
                    else:
                        filename = ""
                except Exception as e:
                    print(f"    Download failed: {e}"); filename = ""
            new_docs.append({"regulator": "EPFO", "title": title, "url": href,
                             "filename": filename, "priority": _infer_priority(title),
                             "summary": "", "source": "real_scrape"})
            time.sleep(1)
        browser.close()

    print(f"    EPFO: {len(new_docs)} new document(s) found")
    return new_docs


def _scrape_incometax_playwright(hash_db: dict) -> list[dict]:
    """
    CBDT Income Tax Circulars — https://www.incometaxindia.gov.in/circulars
    Structure: List of items with direct PDF links and circular titles
    """
    print("\n  Scraping [IncomeTax] CBDT Circulars via Playwright ...")
    new_docs = []
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("  Playwright not installed"); return []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            viewport={"width": 1280, "height": 800},
        )
        page = context.new_page()
        try:
            print("    Loading Income Tax circulars page ...")
            page.goto("https://www.incometaxindia.gov.in/Pages/communications/circulars.aspx", wait_until="networkidle", timeout=60000)
            page.wait_for_selector("body", timeout=20000, state="attached")
            page.wait_for_timeout(3000)   # extra settle time for JS-rendered content
        except Exception as e:
            print(f"    Page load failed: {e}"); browser.close(); return []

        cards = page.eval_on_selector_all(
            "div, section, article, li, tr",
            """els => els
                .map(e => {
                    const text = (e.innerText || '').trim().replace(/\\s+/g, ' ');
                    const links = Array.from(e.querySelectorAll('a[href]')).map(a => ({
                        href: a.href,
                        text: (a.innerText || '').trim()
                    })).filter(a => a.href);
                    return { text, links };
                })
                .filter(item => {
                    if (!item.text || item.text.length < 20 || item.links.length === 0) return false;
                    // Accept multiple date formats: DD-Mon-YYYY, DD/MM/YYYY, YYYY-MM-DD, or bare year 20XX
                    return /\\d{2}-[A-Za-z]{3}-\\d{4}|\\d{2}\\/\\d{2}\\/\\d{4}|\\d{4}-\\d{2}-\\d{2}|\\b20[2-9]\\d\\b/.test(item.text);
                })"""
        )

        links = []
        for card in cards:
            card_text = re.sub(r"\s+", " ", card.get("text", "")).strip()
            for link in card.get("links", []):
                link_text = re.sub(r"\s+", " ", link.get("text", "")).strip()
                href = link.get("href", "").strip()
                if not _is_incometax_regulatory_item(card_text, link_text):
                    continue
                links.append({
                    "href": href,
                    "text": card_text,
                    "link_text": link_text,
                })

        if not links:
            current_year = datetime.now().year
            candidate_pages = [
                "https://www.incometaxindia.gov.in/Pages/communications/circulars.aspx",
                f"https://www.incometax.gov.in/iec/foportal/latest-news?year={current_year}",
                f"https://www.incometax.gov.in/iec/foportal/latest-news?year={current_year-1}",
                "https://www.incometax.gov.in/iec/foportal/latest-news",
            ]
            for url in candidate_pages:
                # derive base origin for resolving relative hrefs
                from urllib.parse import urlparse as _urlparse
                _parsed = _urlparse(url)
                base_origin = f"{_parsed.scheme}://{_parsed.netloc}"
                try:
                    html = _http_get_html(url)
                    soup = BeautifulSoup(html, "html.parser")
                    extracted = []
                    for node in soup.select("div, section, article, li, tr, td"):
                        text = re.sub(r"\s+", " ", node.get_text(" ", strip=True)).strip()
                        if not text or len(text) < 20:
                            continue
                        # Accept multiple date formats
                        if not re.search(
                            r"\d{2}-[A-Za-z]{3}-\d{4}|\d{2}/\d{2}/\d{4}|\d{4}-\d{2}-\d{2}|\b20[2-9]\d\b",
                            text,
                        ):
                            continue
                        anchors = node.select("a[href]")
                        for anchor in anchors:
                            href = _absolute_url(base_origin, anchor.get("href", ""))
                            link_text = re.sub(r"\s+", " ", anchor.get_text(" ", strip=True)).strip()
                            if _is_incometax_regulatory_item(text, link_text):
                                extracted.append({
                                    "href": href,
                                    "text": text,
                                    "link_text": link_text,
                                })
                    links = extracted
                    if links:
                        print(f"    HTTP fallback recovered {len(links)} IncomeTax link(s) from {url}")
                        break
                except Exception as e:
                    print(f"    IncomeTax HTTP fallback failed for {url}: {e}")
        if not links:
            _dump_debug_snapshot(page, "IncomeTax", "zero_links")
        print(f"    Found {len(links)} link(s)")

        for link in links[:15]:
            href  = link.get("href", "").strip()
            title = re.sub(r'\s+', ' ', link.get("text", "")).strip()[:120]
            if href and ".pdf" not in href.lower() and "/latest-news/" in href.lower():
                try:
                    detail_html = _http_get_html(href)
                    detail_links = _extract_links_from_html(
                        detail_html,
                        "https://www.incometax.gov.in",
                        href_patterns=[".pdf", "/sites/default/files/"],
                        text_patterns=["circular", "pdf", "notification", "refer circular", "cbdt"],
                        min_text_len=1,
                    )
                    if detail_links:
                        href = detail_links[0]["href"]
                        if not title:
                            title = re.sub(r"\s+", " ", detail_links[0].get("text", "")).strip()[:120]
                except Exception as e:
                    print(f"    Could not resolve IncomeTax detail link {href}: {e}")
            if not href or ".pdf" not in href.lower():
                continue
            if _contains_any(title or href, _INCOMETAX_SKIP):
                continue
            combined = f"{title} {link.get('link_text', '')}".lower()
            if not any(term in combined for term in ["circular", "notification", "cbdt", "order", "refer circular"]):
                continue
            if not _looks_recent(title, href):
                continue
            if not _is_new_document(href, href.encode(), hash_db):
                print(f"    Already seen: {title[:60]}")
                continue
            stem     = Path(href.split("?")[0]).stem[:60]
            filename = f"incometax_{stem}.pdf"
            dest     = PDF_DIR / filename
            print(f"    New circular: {title[:70]}")
            if not dest.exists():
                try:
                    pdf_bytes = context.request.get(href, timeout=20000).body()
                    if pdf_bytes.startswith(b"%PDF") and not _is_html(pdf_bytes):
                        PDF_DIR.mkdir(parents=True, exist_ok=True)
                        dest.write_bytes(pdf_bytes)
                        print(f"    Saved: {filename} ({len(pdf_bytes)//1024} KB)")
                    else:
                        filename = ""
                except Exception as e:
                    print(f"    Download failed: {e}"); filename = ""
            new_docs.append({"regulator": "IncomeTax", "title": title, "url": href,
                             "filename": filename, "priority": _infer_priority(title),
                             "summary": "", "source": "real_scrape"})
            time.sleep(1)
        browser.close()

    print(f"    IncomeTax: {len(new_docs)} new document(s) found")
    return new_docs


def _scrape_mca_playwright(hash_db: dict) -> list[dict]:
    """
    MCA General Circulars — https://www.mca.gov.in/content/mca/global/en/acts-rules/ebooks/circulars.html
    Structure: Direct PDF links on page
    """
    print("\n  Scraping [MCA] Circulars via Playwright ...")
    new_docs = []
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("  Playwright not installed"); return []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            viewport={"width": 1280, "height": 800},
        )
        page = context.new_page()
        try:
            print("    Loading MCA circulars page ...")
            page.goto(
                "https://www.mca.gov.in/content/mca/global/en/acts-rules/ebooks/circulars.html",
                wait_until="networkidle", timeout=60000,
            )
            page.wait_for_timeout(5000)   # MCA is heavily JS-rendered; allow React/Angular to mount
            try:
                page.wait_for_selector("text=Showing Results", timeout=12000, state="attached")
            except Exception:
                pass
            page.wait_for_timeout(2500)
        except Exception as e:
            print(f"    Page load failed: {e}"); browser.close(); return []

        # MCA now renders a paginated results list where the actual document links
        # are `getdocument?...` URLs behind the PDF icon/title row.
        links = page.eval_on_selector_all(
            "a[href*='getdocument'], a[href*='.pdf'], [onclick*='getdocument']",
            """els => els.map(e => {
                const rawHref =
                  e.href ||
                  e.getAttribute('href') ||
                  e.getAttribute('data-href') ||
                  e.getAttribute('onclick') ||
                  '';
                const container =
                  e.closest('tr') ||
                  e.closest('li') ||
                  e.closest('[class*="result"]') ||
                  e.closest('[class*="row"]') ||
                  e.parentElement;
                return {
                  href: rawHref,
                  text: (container?.innerText || e.innerText || '').trim().replace(/\\s+/g, ' ')
                };
            }).filter(e => e.href && e.text)"""
        )
        if not links:
            try:
                page.locator("a[href*='getdocument'], [onclick*='getdocument']").first.wait_for(
                    timeout=10000,
                    state="attached",
                )
                page.wait_for_timeout(1500)
                links = page.eval_on_selector_all(
                    "a[href*='getdocument'], a[href*='.pdf'], [onclick*='getdocument']",
                    """els => els.map(e => {
                        const rawHref =
                          e.href ||
                          e.getAttribute('href') ||
                          e.getAttribute('data-href') ||
                          e.getAttribute('onclick') ||
                          '';
                        const container =
                          e.closest('tr') ||
                          e.closest('li') ||
                          e.closest('[class*="result"]') ||
                          e.closest('[class*="row"]') ||
                          e.parentElement;
                        return {
                          href: rawHref,
                          text: (container?.innerText || e.innerText || '').trim().replace(/\\s+/g, ' ')
                        };
                    }).filter(e => e.href && e.text)""",
                )
            except Exception:
                pass
        if not links:
            html = page.content()
            soup = BeautifulSoup(html, "html.parser")
            seen = set()
            extracted = []
            for node in soup.select("a[href*='getdocument'], a[href*='.pdf'], [onclick*='getdocument']"):
                href = (
                    node.get("href")
                    or node.get("data-href")
                    or _extract_href_from_onclick(node.get("onclick", ""))
                )
                href = _absolute_url("https://www.mca.gov.in", href)
                text = re.sub(r"\s+", " ", " ".join((node.parent or node).stripped_strings)).strip()
                if not href or not text:
                    continue
                key = (href, text)
                if key in seen:
                    continue
                seen.add(key)
                extracted.append({"href": href, "text": text})
            links = extracted
        if not links:
            raw_urls = _extract_document_urls_from_text(page.content(), "https://www.mca.gov.in")
            links = [
                {"href": href, "text": href}
                for href in raw_urls
                if "getdocument" in href.lower() or href.lower().endswith(".pdf")
            ]
        # HTTP fallback to older static MCA pages if Playwright found nothing
        if not links:
            mca_fallback_urls = [
                "https://www.mca.gov.in/MinistryV2/generalcircular.html",
                "https://www.mca.gov.in/MinistryV2/notification.html",
            ]
            for fb_url in mca_fallback_urls:
                try:
                    html = _http_get_html(fb_url)
                    soup = BeautifulSoup(html, "html.parser")
                    seen_hrefs: set = set()
                    extracted = []
                    for node in soup.select("a[href]"):
                        href = node.get("href", "").strip()
                        if not href:
                            continue
                        href = _absolute_url("https://www.mca.gov.in", href)
                        if "getdocument" not in href.lower() and ".pdf" not in href.lower():
                            continue
                        if href in seen_hrefs:
                            continue
                        seen_hrefs.add(href)
                        container = node.parent or node
                        text = re.sub(r"\s+", " ", " ".join(container.stripped_strings)).strip()
                        if not text:
                            text = node.get_text(strip=True) or href
                        extracted.append({"href": href, "text": text})
                    if extracted:
                        links = extracted
                        print(f"    HTTP fallback recovered {len(links)} MCA link(s) from {fb_url}")
                        break
                except Exception as e:
                    print(f"    MCA HTTP fallback failed for {fb_url}: {e}")
        if not links:
            _dump_debug_snapshot(page, "MCA", "zero_links")
        print(f"    Found {len(links)} link(s)")

        for link in links[:25]:
            href  = _absolute_url(
                "https://www.mca.gov.in",
                _extract_href_from_onclick(link.get("href", "")) or link.get("href", "").strip(),
            )
            title = re.sub(r'\s+', ' ', link.get("text", "")).strip()[:160]
            title = re.sub(r"\b\d+\s*KB\b", "", title, flags=re.IGNORECASE).strip()
            if not href:
                continue
            if "getdocument" not in href.lower() and ".pdf" not in href.lower():
                continue
            if _contains_any(title, _MCA_SKIP):
                continue
            if not _looks_recent(title, href):
                continue
            # accept if "circular" appears in title OR in the href itself
            if "circular" not in title.lower() and "circular" not in href.lower():
                continue
            if not _is_new_document(href, href.encode(), hash_db):
                print(f"    Already seen: {title[:60]}")
                continue
            stem     = Path(href.split("?")[0]).stem[:60]
            if "getdocument" in href.lower():
                doc_match = re.search(r"[?&]doc=([^&]+)", href, re.IGNORECASE)
                stem = f"doc_{doc_match.group(1)[:24]}" if doc_match else "mca_circular"
            filename = f"mca_{stem}.pdf"
            dest     = PDF_DIR / filename
            print(f"    New circular: {title[:70]}")
            if not dest.exists():
                try:
                    pdf_bytes = context.request.get(href, timeout=20000).body()
                    if pdf_bytes.startswith(b"%PDF") and not _is_html(pdf_bytes):
                        PDF_DIR.mkdir(parents=True, exist_ok=True)
                        dest.write_bytes(pdf_bytes)
                        print(f"    Saved: {filename} ({len(pdf_bytes)//1024} KB)")
                    else:
                        filename = ""
                except Exception as e:
                    print(f"    Download failed: {e}"); filename = ""
            new_docs.append({"regulator": "MCA", "title": title, "url": href,
                             "filename": filename, "priority": _infer_priority(title),
                             "summary": "", "source": "real_scrape"})
            time.sleep(1)
        browser.close()

    print(f"    MCA: {len(new_docs)} new document(s) found")
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

        if not regulators or "GST" in regulators:
            new_docs.extend(_scrape_gst_playwright(hash_db))
        if not regulators or "IncomeTax" in regulators:
            new_docs.extend(_scrape_incometax_playwright(hash_db))
        if not regulators or "MCA" in regulators:
            new_docs.extend(_scrape_mca_playwright(hash_db))
        # EPFO scraper disabled — epfindia.gov.in mixes circular PDFs with
        # nav links, help-desk pages, and unrelated documents; a reliable
        # selector has not been identified yet. Re-enable once a stable
        # anchor pattern is confirmed.
        # if not regulators or "EPFO" in regulators:
        #     new_docs.extend(_scrape_epfo_playwright(hash_db))

        # Always merge simulated docs in every real-scrape run so all client types
        # get coverage even when real scrapers return nothing new.
        # Simulated docs bypass hash_db — they are demo fixtures, not real circulars,
        # so they don't need deduplication tracking.
        pool = SIMULATED_DOCUMENTS
        if regulators:
            pool = [d for d in pool if d["regulator"] in regulators]
        sim_docs = [{**doc, "source": "simulated"} for doc in pool]
        if sim_docs:
            print(f"\n  +{len(sim_docs)} simulated document(s) added for demo coverage")
            new_docs.extend(sim_docs)

        if not new_docs:
            print("\nNo new documents found (real or simulated).")
            log_event(agent="MonitoringAgent", action="scrape_fallback", details={"reason": "no_new_docs"})

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
            dest.write_text(_build_simulated_document_text(doc), encoding="utf-8")
            print(f"    Simulated document created: {dest.name}")
            try:
                ingest_pdf(str(dest), force=True)
            except Exception as e:
                print(f"    Simulated ingest failed: {e}")
                log_event(agent="MonitoringAgent", action="ingest_failed",
                          details={"filename": dest.name, "error": str(e)})
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
    parser.add_argument("--regulators", nargs="+", choices=["RBI", "GST", "IncomeTax", "MCA", "SEBI", "EPFO", "SEBI", "IBBI"])
    parser.add_argument("--no-ingest", action="store_true")
    args = parser.parse_args()
    run_monitoring_agent(
        simulate_mode=args.simulate,
        regulators=args.regulators,
        auto_ingest=not args.no_ingest,
    )
