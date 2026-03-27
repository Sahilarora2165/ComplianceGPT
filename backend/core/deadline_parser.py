"""
deadline_parser.py — Structured Deadline Extraction & Validation
─────────────────────────────────────────────────────────────────
Three-layer defense against unstructured deadlines:
1. Prompt enforcement (in drafter_agent.py)
2. Post-processing parser with validation + lookup table (this file)
3. Watch Agent date resolution (in deadline_agent.py)

Four accepted formats:
- ISO date:      2026-04-01
- Relative:      RELATIVE:30 (days from circular date)
- Periodic:      PERIODIC:MONTHLY:15 or PERIODIC:QUARTERLY:20
- null:          Only when genuinely no deadline exists
"""

import re
from datetime import datetime, date, timedelta
from typing import Optional, Tuple
from dateutil.relativedelta import relativedelta

# ─────────────────────────────────────────────────────────────────────────────
# INDIAN COMPLIANCE DEADLINE LOOKUP TABLE
# Hardcode known recurring deadlines that CAs expect the system to know
# ─────────────────────────────────────────────────────────────────────────────

PERIODIC_DEADLINES = {
    # GST Deadlines
    ("GST", "GSTR-1"):        ("PERIODIC:MONTHLY:11", "11th of every month"),
    ("GST", "GSTR1"):         ("PERIODIC:MONTHLY:11", "11th of every month"),
    ("GST", "GSTR-3B"):       ("PERIODIC:MONTHLY:20", "20th of every month"),
    ("GST", "GSTR3B"):        ("PERIODIC:MONTHLY:20", "20th of every month"),
    ("GST", "GSTR-9"):        ("PERIODIC:YEARLY:12-31", "31st December of following FY"),
    ("GST", "GSTR9"):         ("PERIODIC:YEARLY:12-31", "31st December of following FY"),
    
    # TDS Deadlines
    ("IncomeTax", "TDS"):     ("PERIODIC:MONTHLY:7", "7th of every month"),
    ("IncomeTax", "TDS Return"): ("PERIODIC:QUARTERLY:30", "30th of month following quarter"),
    ("IncomeTax", "Form 24Q"): ("PERIODIC:QUARTERLY:30", "30th of month following quarter"),
    ("IncomeTax", "Form 26Q"): ("PERIODIC:QUARTERLY:30", "30th of month following quarter"),
    
    # PF/ESI (common for manufacturing/services)
    ("Labour", "PF"):         ("PERIODIC:MONTHLY:15", "15th of every month"),
    ("Labour", "ESI"):        ("PERIODIC:MONTHLY:15", "15th of every month"),
    
    # RBI/FEMA
    ("RBI", "SOFTEX"):        ("PERIODIC:MONTHLY:15", "15th of every month for previous month"),
    ("RBI", "Export Realisation"): ("RELATIVE:180", "180 days from export date (FEMA)"),
    ("RBI", "FEMA"):          ("RELATIVE:180", "180 days under FEMA regulations"),
    ("RBI", "LUT"):           ("PERIODIC:YEARLY:03-31", "31st March - end of FY"),
    
    # MCA/LLP
    ("MCA", "LLP Annual"):    ("PERIODIC:YEARLY:10-30", "30th October every year"),
    ("MCA", "LLP Form 11"):   ("PERIODIC:YEARLY:05-30", "30th May every year"),
    ("MCA", "LLP Form 8"):    ("PERIODIC:YEARLY:11-30", "30th November every year"),
    ("MCA", "AOC-4"):         ("PERIODIC:YEARLY:11-30", "30th November from AGM date"),
    ("MCA", "MGT-7"):         ("PERIODIC:YEARLY:12-31", "31st December from AGM date"),
    
    # Income Tax
    ("IncomeTax", "ITR"):     ("PERIODIC:YEARLY:07-31", "31st July every year"),
    ("IncomeTax", "Advance Tax"): ("PERIODIC:QUARTERLY:15", "15th of Jun/Sep/Dec/Mar"),
    ("IncomeTax", "Transfer Pricing"): ("PERIODIC:YEARLY:11-30", "30th November"),
    ("IncomeTax", "TP Report"): ("PERIODIC:YEARLY:11-30", "30th November"),
    
    # SEBI
    ("SEBI", "Annual"):       ("PERIODIC:YEARLY:06-30", "30th June"),
    ("SEBI", "Half-Yearly"):  ("PERIODIC:HALFYEARLY:30", "30th of month following half-year"),
    ("SEBI", "Quarterly"):    ("PERIODIC:QUARTERLY:21", "21 days from quarter end"),
}

# Keywords that indicate periodic obligations even if not exact match
PERIODIC_KEYWORDS = {
    "monthly": "PERIODIC:MONTHLY:20",
    "quarterly": "PERIODIC:QUARTERLY:30",
    "annual": "PERIODIC:YEARLY:12-31",
    "yearly": "PERIODIC:YEARLY:12-31",
    "every month": "PERIODIC:MONTHLY:20",
    "every quarter": "PERIODIC:QUARTERLY:30",
    "every year": "PERIODIC:YEARLY:12-31",
}

# ─────────────────────────────────────────────────────────────────────────────
# LAYER 2: POST-PROCESSING PARSER
# ─────────────────────────────────────────────────────────────────────────────

def parse_deadline(deadline_str: str, regulator: str = "", obligation_type: str = "", 
                   circular_date: Optional[date] = None) -> Tuple[Optional[date], str, str]:
    """
    Parse and validate deadline string into structured format.
    
    Args:
        deadline_str: Raw deadline from LLM (any format)
        regulator: Regulator name (GST, RBI, IncomeTax, etc.)
        obligation_type: Type of obligation (GSTR-3B, TDS, SOFTEX, etc.)
        circular_date: Date of circular (for relative calculations)
    
    Returns:
        (calculated_date, normalized_format, explanation)
        - calculated_date: Next occurrence date or None
        - normalized_format: One of ISO/RELATIVE/PERIODIC/null
        - explanation: Human-readable explanation
    """
    if not deadline_str or deadline_str.lower() in ("null", "none", "n/a", ""):
        # Check lookup table before giving up
        lookup_result = _lookup_periodic_deadline(regulator, obligation_type)
        if lookup_result:
            return _calculate_from_periodic(lookup_result[0], circular_date)
        return None, "null", "No deadline specified or found in lookup table"
    
    deadline_str = deadline_str.strip()
    
    # ── Layer 2A: Try ISO date format ────────────────────────────────────
    iso_result = _try_parse_iso(deadline_str)
    if iso_result:
        return iso_result, "ISO", f"Hard deadline: {iso_result.isoformat()}"
    
    # ── Layer 2B: Try RELATIVE format ────────────────────────────────────
    relative_result = _try_parse_relative(deadline_str, circular_date)
    if relative_result:
        return relative_result, "RELATIVE", f"Relative deadline: {relative_result.isoformat()}"
    
    # ── Layer 2C: Try PERIODIC format ────────────────────────────────────
    periodic_result = _try_parse_periodic(deadline_str, circular_date)
    if periodic_result:
        return periodic_result, "PERIODIC", f"Periodic deadline: {periodic_result.isoformat()}"
    
    # ── Layer 2D: Lookup table fallback ──────────────────────────────────
    lookup_result = _lookup_periodic_deadline(regulator, obligation_type)
    if lookup_result:
        return _calculate_from_periodic(lookup_result[0], circular_date)
    
    # ── Layer 2E: Try to extract date from prose ─────────────────────────
    prose_result = _extract_date_from_prose(deadline_str)
    if prose_result:
        return prose_result, "ISO", f"Extracted from prose: {prose_result.isoformat()}"
    
    # ── All methods failed ───────────────────────────────────────────────
    return None, "null", f"Could not parse deadline: {deadline_str[:100]}"


def _try_parse_iso(deadline_str: str) -> Optional[date]:
    """Try to parse as ISO date (YYYY-MM-DD)."""
    # Direct ISO format
    iso_pattern = r'^(\d{4}-\d{2}-\d{2})$'
    match = re.match(iso_pattern, deadline_str)
    if match:
        try:
            return date.fromisoformat(match.group(1))
        except ValueError:
            pass
    
    # Also try common date formats
    date_formats = [
        "%Y-%m-%d",
        "%d-%m-%Y",
        "%d/%m/%Y",
        "%B %d, %Y",  # April 1, 2026
        "%b %d, %Y",  # Apr 01, 2026
        "%d %B %Y",   # 01 April 2026
        "%d %b %Y",   # 01 Apr 2026
    ]
    
    for fmt in date_formats:
        try:
            return datetime.strptime(deadline_str, fmt).date()
        except ValueError:
            continue
    
    return None


def _try_parse_relative(deadline_str: str, circular_date: Optional[date] = None) -> Optional[date]:
    """Try to parse RELATIVE:N format or prose like 'within 30 days'."""
    # Explicit RELATIVE:N format
    rel_pattern = r'RELATIVE:(\d+)'
    match = re.match(rel_pattern, deadline_str, re.IGNORECASE)
    if match:
        days = int(match.group(1))
        if circular_date:
            return circular_date + timedelta(days=days)
        return date.today() + timedelta(days=days)
    
    # Prose patterns: "within 30 days", "30 days from", "by 30 days"
    prose_patterns = [
        r'within\s+(\d+)\s+days',
        r'(\d+)\s+days\s+from',
        r'(\d+)\s+days',
        r'by\s+(\d+)\s+days',
    ]
    
    for pattern in prose_patterns:
        match = re.search(pattern, deadline_str, re.IGNORECASE)
        if match:
            days = int(match.group(1))
            if circular_date:
                return circular_date + timedelta(days=days)
            return date.today() + timedelta(days=days)
    
    return None


def _try_parse_periodic(deadline_str: str, circular_date: Optional[date] = None) -> Optional[date]:
    """Try to parse PERIODIC:TYPE:DAY format."""
    # Explicit PERIODIC format
    periodic_pattern = r'PERIODIC:(MONTHLY|QUARTERLY|HALFYEARLY|YEARLY):(\d{1,2}(?:-\d{1,2})?)'
    match = re.match(periodic_pattern, deadline_str, re.IGNORECASE)
    if match:
        freq = match.group(1).upper()
        day_spec = match.group(2)
        return _calculate_periodic_next(freq, day_spec, circular_date)
    
    # Check for periodic keywords
    for keyword, periodic_format in PERIODIC_KEYWORDS.items():
        if keyword in deadline_str.lower():
            freq, day = periodic_format.replace("PERIODIC:", "").split(":")
            return _calculate_periodic_next(freq.upper(), day, circular_date)
    
    return None


def _calculate_periodic_next(freq: str, day_spec: str, circular_date: Optional[date] = None) -> date:
    """
    Calculate next occurrence of a periodic deadline.
    
    Args:
        freq: MONTHLY, QUARTERLY, HALFYEARLY, or YEARLY
        day_spec: Day of month (1-31) or month-day for yearly (e.g., "12-31")
        circular_date: Reference date (defaults to today)
    
    Returns:
        Next occurrence date
    """
    ref_date = circular_date or date.today()
    
    if freq == "MONTHLY":
        day = int(day_spec)
        # Next occurrence is this month or next
        try:
            candidate = ref_date.replace(day=day)
            if candidate <= ref_date:
                candidate = (ref_date + relativedelta(months=1)).replace(day=day)
            return candidate
        except ValueError:
            # Day doesn't exist in this month (e.g., 31st)
            # Use last day of month
            next_month = ref_date.replace(day=28) + relativedelta(days=4)
            return next_month - relativedelta(days=1)
    
    elif freq == "QUARTERLY":
        day = int(day_spec)
        # Current quarter end month
        quarter_month = ((ref_date.month - 1) // 3) * 3 + 3
        try:
            candidate = ref_date.replace(month=quarter_month, day=day)
            if candidate <= ref_date:
                next_quarter_month = quarter_month + 3
                next_year = ref_date.year + (1 if next_quarter_month > 12 else 0)
                next_quarter_month = next_quarter_month - 12 if next_quarter_month > 12 else next_quarter_month
                candidate = date(next_year, next_quarter_month, day)
            return candidate
        except ValueError:
            # Use last day of quarter month
            quarter_end = ref_date.replace(month=quarter_month, day=28) + relativedelta(days=4)
            return quarter_end - relativedelta(days=1)
    
    elif freq == "HALFYEARLY":
        day = int(day_spec)
        # Half-year ends: June (6) or December (12)
        half_year = 6 if ref_date.month <= 6 else 12
        try:
            candidate = ref_date.replace(month=half_year, day=day)
            if candidate <= ref_date:
                half_year = 12 if half_year == 6 else 6
                year_add = 1 if half_year == 6 else 0
                candidate = (ref_date + relativedelta(years=year_add)).replace(month=half_year, day=day)
            return candidate
        except ValueError:
            # Last day of half-year month
            hy_end = ref_date.replace(month=half_year, day=28) + relativedelta(days=4)
            return hy_end - relativedelta(days=1)
    
    elif freq == "YEARLY":
        # Format: MM-DD (e.g., "12-31" for Dec 31)
        parts = day_spec.split("-")
        if len(parts) == 2:
            month, day = int(parts[0]), int(parts[1])
            try:
                candidate = ref_date.replace(month=month, day=day)
                if candidate <= ref_date:
                    candidate = candidate.replace(year=ref_date.year + 1)
                return candidate
            except ValueError:
                # Invalid date
                pass
    
    return None


def _lookup_periodic_deadline(regulator: str, obligation_type: str) -> Optional[Tuple[str, str]]:
    """
    Lookup known periodic deadline from hardcoded table.
    
    Returns:
        (periodic_format, explanation) or None
    """
    if not regulator or not obligation_type:
        return None
    
    # Exact match
    key = (regulator, obligation_type)
    if key in PERIODIC_DEADLINES:
        return PERIODIC_DEADLINES[key]
    
    # Partial match (obligation type contains keyword)
    obligation_lower = obligation_type.lower()
    for (reg, obl), (format, explanation) in PERIODIC_DEADLINES.items():
        if reg == regulator and obl.lower() in obligation_lower:
            return (format, explanation)
        if reg == regulator and obligation_lower in obl.lower():
            return (format, explanation)

    # Second pass: ignore regulator and match by obligation only
    for (_, obl), (format, explanation) in PERIODIC_DEADLINES.items():
        if obl.lower() in obligation_lower:
            return (format, explanation)
        if obligation_lower in obl.lower():
            return (format, explanation)
    
    # Check obligation type keywords
    for keyword, periodic_format in PERIODIC_KEYWORDS.items():
        if keyword in obligation_lower:
            return (periodic_format, f"Keyword match: {keyword}")
    
    return None


def _extract_date_from_prose(prose: str) -> Optional[date]:
    """Try to extract any date from prose text."""
    # Common date patterns in prose
    patterns = [
        r'(\d{4}-\d{2}-\d{2})',  # ISO
        r'(\d{1,2}[-/]\d{1,2}[-/]\d{4})',  # DD/MM/YYYY or MM-DD-YYYY
        r'([A-Z][a-z]+ \d{1,2},? \d{4})',  # April 1, 2026
        r'(\d{1,2} [A-Z][a-z]+ \d{4})',  # 01 April 2026
    ]
    
    for pattern in patterns:
        match = re.search(pattern, prose)
        if match:
            date_str = match.group(1)
            result = _try_parse_iso(date_str)
            if result:
                return result
    
    return None


def _calculate_from_periodic(periodic_format: str, circular_date: Optional[date] = None) -> Tuple[Optional[date], str, str]:
    """Convert periodic format to calculated date."""
    # Parse PERIODIC:FREQ:DAY
    match = re.match(r'PERIODIC:(\w+):(.+)', periodic_format, re.IGNORECASE)
    if match:
        freq, day_spec = match.groups()
        calc_date = _calculate_periodic_next(freq.upper(), day_spec, circular_date)
        if calc_date is None:
            return None, "null", "Periodic calculation failed"
        return calc_date, periodic_format, f"Calculated from periodic: {calc_date.isoformat()}"
    
    return None, "null", "Invalid periodic format"


# ─────────────────────────────────────────────────────────────────────────────
# VALIDATION HELPER
# ─────────────────────────────────────────────────────────────────────────────

def validate_deadline_format(deadline_str: str) -> Tuple[bool, str]:
    """
    Validate that deadline string matches one of the four accepted formats.
    
    Returns:
        (is_valid, error_message)
    """
    if not deadline_str or deadline_str.lower() in ("null", "none", "n/a", ""):
        return True, ""  # null is valid
    
    # Check ISO
    if _try_parse_iso(deadline_str):
        return True, ""
    
    # Check RELATIVE
    if re.match(r'RELATIVE:\d+', deadline_str, re.IGNORECASE):
        return True, ""
    
    # Check PERIODIC
    if re.match(r'PERIODIC:(MONTHLY|QUARTERLY|HALFYEARLY|YEARLY):\d{1,2}(-\d{1,2})?', deadline_str, re.IGNORECASE):
        return True, ""
    
    # Check if it's a periodic keyword
    for keyword in PERIODIC_KEYWORDS.keys():
        if keyword in deadline_str.lower():
            return True, ""
    
    return False, f"Deadline '{deadline_str[:50]}' does not match accepted formats (ISO/RELATIVE/PERIODIC/null)"


# ─────────────────────────────────────────────────────────────────────────────
# PUBLIC: GET COMPLIANCE CALENDAR (for API endpoint)
# ─────────────────────────────────────────────────────────────────────────────

def get_calendar(reference_date: Optional[date] = None) -> list[dict]:
    """
    Returns the full Indian compliance calendar with next concrete dates.
    Used by GET /compliance-calendar.
    """
    if reference_date is None:
        reference_date = date.today()

    result = []
    seen = set()  # Deduplicate entries with same obligation name

    for (regulator, obligation), (periodic_fmt, explanation) in PERIODIC_DEADLINES.items():
        # Skip duplicate obligation names (e.g., GSTR1 vs GSTR-1)
        key = (regulator, obligation.replace("-", "").upper())
        if key in seen:
            continue
        seen.add(key)

        # Calculate next date from the periodic format
        calc_date, _, _ = _calculate_from_periodic(periodic_fmt, reference_date)
        days_until = (calc_date - reference_date).days if calc_date else None

        # Determine frequency label
        if "MONTHLY" in periodic_fmt:
            frequency = "Monthly"
        elif "QUARTERLY" in periodic_fmt:
            frequency = "Quarterly"
        elif "HALFYEARLY" in periodic_fmt:
            frequency = "Half-Yearly"
        elif "YEARLY" in periodic_fmt:
            frequency = "Annual"
        else:
            frequency = "As applicable"

        # Urgency level
        urgency = "OK"
        if days_until is not None:
            if days_until < 0:
                urgency = "MISSED"
            elif days_until <= 3:
                urgency = "CRITICAL"
            elif days_until <= 14:
                urgency = "WARNING"

        result.append({
            "regulator":     regulator,
            "obligation":    obligation,
            "description":   explanation,
            "next_due_date": calc_date.isoformat() if calc_date else None,
            "days_until":    days_until,
            "frequency":     frequency,
            "urgency":       urgency,
        })

    # Sort by next due date (soonest first)
    result.sort(key=lambda x: x["next_due_date"] or "9999-12-31")
    return result
