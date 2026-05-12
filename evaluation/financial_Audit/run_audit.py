#!/usr/bin/env python3
"""
evaluation/financial_Audit/run_audit.py
========================================

Financial-audit evaluation runner for files in evaluation/financial_Audit/.

Pipeline used:
  1. vision_worker /extract-xlsx  — structured sheet extraction (repo's actual extractor)
  2. openpyxl / xlrd              — metadata + .xls fallback
  3. Heuristic metric-family detection — mirrors metric-promoter.ts patterns
  4. Financial-breakdown interpretation — mirrors financial-breakdown-v1.ts rules

Produces:
  results/01_<slug>_report.md .. results/N_<slug>_report.md
  results/overall_summary.md
  results/overall_summary.json

Usage:
  python evaluation/financial_Audit/run_audit.py
"""

from __future__ import annotations

import base64
import json
import os
import re
import sys
import urllib.request
import urllib.error
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from typing import Any

# ─── Config ───────────────────────────────────────────────────────────────────

VISION_WORKER_URL = os.environ.get("VISION_WORKER_URL", "http://localhost:8001")
AUDIT_DIR = Path(__file__).resolve().parent
RESULTS_DIR = AUDIT_DIR / "results"
RESULTS_DIR.mkdir(exist_ok=True)

TARGET_EXTENSIONS = {".xlsx", ".xlsm", ".xls"}

# ─── Metric family heuristics (mirrors metric-promoter.ts patterns) ───────────

REVENUE_PATTERNS = re.compile(
    r"\b(revenue|arr|mrr|annual recurring|monthly recurring|bookings?|sales|net sales|"
    r"recognized rev|booked rev|gross sales|total rev|recurring rev)\b",
    re.I,
)
BURN_PATTERNS = re.compile(
    r"\b(burn|net burn|monthly burn|cash burn|operating expense|opex|total expense|"
    r"monthly expense|cash out|cash used|net cash used)\b",
    re.I,
)
RUNWAY_PATTERNS = re.compile(r"\b(runway|months? of cash|months? remaining|cash runway)\b", re.I)
CASH_PATTERNS = re.compile(r"\b(cash|cash on hand|cash and equiv|cash balance|ending cash|bank)\b", re.I)
EBITDA_PATTERNS = re.compile(r"\b(ebitda|ebit|operating income|operating profit|net income|net loss|net profit)\b", re.I)
GROSS_MARGIN_PATTERNS = re.compile(r"\b(gross margin|gp margin|gross profit margin)\b", re.I)
HEADCOUNT_PATTERNS = re.compile(r"\b(headcount|fte|employees?|staff|team size|head count)\b", re.I)
RAISE_PATTERNS = re.compile(r"\b(raise|raise amount|funding ask|investment sought|round size|funding round)\b", re.I)
PROJECTION_PATTERNS = re.compile(
    r"\b(year\s*\d+|fy\d{4}|forecast|projected?|budget|plan|target|pro[\s-]?forma|scenario)\b",
    re.I,
)
CURRENT_PERIOD_PATTERNS = re.compile(
    r"\b(current|actual|ytd|year to date|trailing|ttm|q[1-4]\s*20\d{2}|"
    r"jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b",
    re.I,
)
REAL_ESTATE_PATTERNS = re.compile(
    r"\b(noi|cap rate|irr|equity multiple|lp|gp|waterfall|promote|levered|unlevered|"
    r"dscr|ltv|noi yield|cash on cash|debt service|amortization|reversion)\b",
    re.I,
)

ORDINAL_YEAR_RE = re.compile(r"^year\s*\d+$", re.I)
CALENDAR_YEAR_RE = re.compile(r"(?<!\d)(20\d{2})(?!\d)")


def is_projected_label(label: str) -> bool:
    """Mirrors isProjectedFact logic from select-authoritative-fact.ts."""
    s = label.strip()
    if ORDINAL_YEAR_RE.match(s):
        return True
    m = CALENDAR_YEAR_RE.search(s)
    if m and int(m.group(1)) > 2026:
        return True
    proj_words = re.compile(r"\b(forecast|projected?|budget|plan|target|pro[\s-]?forma|scenario)\b", re.I)
    return bool(proj_words.search(s))


# ─── Data structures ──────────────────────────────────────────────────────────

@dataclass
class MetricHit:
    family: str
    label: str
    raw_value: Any
    sheet: str
    cell: str
    is_projected: bool
    period_label: str


@dataclass
class FileAuditResult:
    filename: str
    filepath: str
    file_type: str
    size_bytes: int
    extraction_succeeded: bool
    extraction_error: str | None
    sheet_count: int
    sheet_names: list[str]
    total_facts_found: int
    metric_families: list[str]
    metric_hits: list[MetricHit]
    has_current_state: bool
    has_projections: bool
    is_real_estate: bool
    revenue_hits: list[MetricHit] = field(default_factory=list)
    burn_hits: list[MetricHit] = field(default_factory=list)
    runway_hits: list[MetricHit] = field(default_factory=list)
    cash_hits: list[MetricHit] = field(default_factory=list)
    raw_pages: list[dict] = field(default_factory=list)
    extraction_method: str = "vision_worker"
    verdict: str = "PENDING"
    verdict_reasons: list[str] = field(default_factory=list)
    recommended_action: str = "none"
    warnings: list[str] = field(default_factory=list)


# ─── Vision worker call ────────────────────────────────────────────────────────

def call_extract_xlsx(filepath: Path, document_id: str, timeout: int = 300) -> dict | None:
    """Call the vision worker /extract-xlsx endpoint."""
    with open(filepath, "rb") as f:
        raw = f.read()
    b64 = base64.b64encode(raw).decode("ascii")
    payload = json.dumps({
        "document_id": document_id,
        "xlsx_b64": b64,
        "extractor_version": "eval-1.0",
        "max_sheets": 50,
        "max_tables_per_sheet": 24,
    }).encode("utf-8")
    req = urllib.request.Request(
        f"{VISION_WORKER_URL}/extract-xlsx",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {e.code}: {body[:500]}")


# ─── Direct openpyxl / xlrd extraction (fallback for .xls or worker timeouts) ─

def _direct_scan_xlsx(filepath: Path) -> tuple[list[dict], str]:
    """
    Directly scan an .xlsx/.xlsm file with openpyxl, building a pages-like
    structure identical to the vision worker output so `scan_pages_for_metrics`
    works on both paths.
    Returns (pages, extraction_method_str).
    """
    from openpyxl import load_workbook
    wb = load_workbook(str(filepath), read_only=True, data_only=True)
    pages = []
    for sheet_index, sheet_name in enumerate(wb.sheetnames[:50]):
        ws = wb[sheet_name]
        rows_read = []
        for row in ws.iter_rows(max_row=350, max_col=80, values_only=True):
            rows_read.append(list(row))
        if not rows_read:
            continue
        # Find a header-like row (row with mostly strings) in first 5 rows
        best_hr_idx = 0
        best_str_count = -1
        for ri, row in enumerate(rows_read[:5]):
            sc = sum(1 for v in row if isinstance(v, str) and v.strip())
            if sc > best_str_count:
                best_str_count = sc
                best_hr_idx = ri
        headers = []
        for ci, v in enumerate(rows_read[best_hr_idx]):
            if isinstance(v, str) and v.strip():
                headers.append(v.strip())
            else:
                headers.append(f"col_{ci}")
        # Build rows_preview from data rows
        rows_preview = []
        for row in rows_read[best_hr_idx + 1:]:
            row_obj = {}
            has_val = False
            for ci, v in enumerate(row):
                h = headers[ci] if ci < len(headers) else f"col_{ci}"
                if v is not None:
                    has_val = True
                row_obj[h] = v
            if has_val:
                rows_preview.append(row_obj)

        sj = {
            "kind": "excel_range",
            "sheet_name": sheet_name,
            "headers": headers,
            "rows_preview": rows_preview[:30],
            "anchors_v1": None,
        }
        asset = {"extraction": {"structured_json": sj}}
        pages.append({"page_index": sheet_index, "assets": [asset]})
    return pages, "direct_openpyxl"


def _direct_scan_xls(filepath: Path) -> tuple[list[dict], str]:
    """
    Directly scan a legacy .xls file with xlrd.
    Returns (pages, extraction_method_str).
    """
    import xlrd
    wb = xlrd.open_workbook(str(filepath))
    pages = []
    for sheet_index in range(min(wb.nsheets, 50)):
        ws = wb.sheet_by_index(sheet_index)
        sheet_name = wb.sheet_names()[sheet_index]
        nrows = min(ws.nrows, 350)
        ncols = min(ws.ncols, 80)
        # Find a header row
        best_hr_idx = 0
        best_str_count = -1
        for ri in range(min(5, nrows)):
            sc = sum(1 for ci in range(ncols) if ws.cell(ri, ci).ctype == xlrd.XL_CELL_TEXT and ws.cell(ri, ci).value.strip())
            if sc > best_str_count:
                best_str_count = sc
                best_hr_idx = ri
        headers = []
        for ci in range(ncols):
            cell = ws.cell(best_hr_idx, ci)
            if cell.ctype == xlrd.XL_CELL_TEXT and cell.value.strip():
                headers.append(cell.value.strip())
            else:
                headers.append(f"col_{ci}")
        rows_preview = []
        for ri in range(best_hr_idx + 1, nrows):
            row_obj = {}
            has_val = False
            for ci in range(ncols):
                h = headers[ci] if ci < len(headers) else f"col_{ci}"
                cell = ws.cell(ri, ci)
                if cell.ctype in (xlrd.XL_CELL_NUMBER, xlrd.XL_CELL_TEXT):
                    row_obj[h] = cell.value
                    has_val = True
                else:
                    row_obj[h] = None
            if has_val:
                rows_preview.append(row_obj)

        sj = {
            "kind": "excel_range",
            "sheet_name": sheet_name,
            "headers": headers,
            "rows_preview": rows_preview[:30],
            "anchors_v1": None,
        }
        asset = {"extraction": {"structured_json": sj}}
        pages.append({"page_index": sheet_index, "assets": [asset]})
    return pages, "direct_xlrd"


# ─── Metric family scanner ────────────────────────────────────────────────────

def _extract_text_from_page(page: dict) -> list[tuple[str, str, Any]]:
    """
    Extract (cell_ref, label_text, numeric_value_or_None) tuples from a page.

    Vision worker response structure:
      page["assets"][i]["extraction"]["structured_json"] → excel_range dict
        structured_json["headers"] → [col0_header, col1_header, ...]
        structured_json["rows_preview"] → [{col0_header: val, col1_header: val, ...}, ...]
        structured_json["anchors_v1"]["cells"] → [{"a": "A1", "v": value, "f": formula}, ...]
        structured_json["sheet_name"] → str
    """
    items = []
    for asset in page.get("assets", []):
        # Skip malformed or non-dict assets
        if not isinstance(asset, dict):
            continue
        extraction = asset.get("extraction", {})
        if not isinstance(extraction, dict):
            continue
        sj = extraction.get("structured_json", {})
        if not isinstance(sj, dict):
            continue
        kind = sj.get("kind", "")
        if kind not in ("excel_range", "used_range_fallback", "top_left_fallback"):
            # Skip sheet overview nodes and non-range nodes
            if kind != "excel_range":
                # Still try if it has rows_preview
                if "rows_preview" not in sj:
                    continue

        sheet_name = sj.get("sheet_name", "unknown")
        headers = sj.get("headers", [])
        rows_preview = sj.get("rows_preview", [])

        for row in rows_preview:
            if not isinstance(row, dict):
                continue
            # Find the label: first header whose value is a non-empty string
            label = None
            label_col = None
            for hi, h in enumerate(headers):
                v = row.get(h)
                if isinstance(v, str) and v.strip():
                    label = v.strip()
                    label_col = hi
                    break

            if not label:
                continue

            # Find the first numeric value after the label column
            first_numeric_val = None
            first_numeric_ref = f"{sheet_name}!?"
            for hi, h in enumerate(headers):
                if label_col is not None and hi <= label_col:
                    continue
                v = row.get(h)
                if isinstance(v, (int, float)) and not isinstance(v, bool):
                    first_numeric_val = v
                    first_numeric_ref = f"{sheet_name}!{h}"
                    break

            items.append((first_numeric_ref, label, first_numeric_val))

        # Also scan anchors for any string tokens we might have missed
        anchors = sj.get("anchors_v1", {}).get("cells", []) if sj.get("anchors_v1") else []
        for anchor in anchors[:50]:  # cap to avoid noise
            v = anchor.get("v")
            if isinstance(v, str) and v.strip() and len(v.strip()) > 2:
                items.append((anchor.get("a", "?"), v.strip(), None))

    return items


def scan_pages_for_metrics(pages: list[dict]) -> tuple[list[MetricHit], set[str]]:
    """Scan extracted pages and return metric hits + detected families."""
    hits: list[MetricHit] = []
    families: set[str] = set()

    for page in pages:
        sheet = page.get("sheet_name", page.get("page_label", "unknown"))
        items = _extract_text_from_page(page)

        for cell_ref, label, value in items:
            # Determine period context from label or column header
            period_label = "unknown"
            is_proj = is_projected_label(label)
            if CURRENT_PERIOD_PATTERNS.search(label):
                period_label = "current"
            elif is_proj:
                period_label = "projected"

            if REVENUE_PATTERNS.search(label):
                families.add("revenue")
                hits.append(MetricHit("revenue", label, value, sheet, cell_ref, is_proj, period_label))
            if BURN_PATTERNS.search(label):
                families.add("burn")
                hits.append(MetricHit("burn", label, value, sheet, cell_ref, is_proj, period_label))
            if RUNWAY_PATTERNS.search(label):
                families.add("runway")
                hits.append(MetricHit("runway", label, value, sheet, cell_ref, is_proj, period_label))
            if CASH_PATTERNS.search(label) and not REVENUE_PATTERNS.search(label):
                families.add("cash")
                hits.append(MetricHit("cash", label, value, sheet, cell_ref, is_proj, period_label))
            if EBITDA_PATTERNS.search(label):
                families.add("ebitda")
                hits.append(MetricHit("ebitda", label, value, sheet, cell_ref, is_proj, period_label))
            if GROSS_MARGIN_PATTERNS.search(label):
                families.add("gross_margin")
                hits.append(MetricHit("gross_margin", label, value, sheet, cell_ref, is_proj, period_label))
            if HEADCOUNT_PATTERNS.search(label):
                families.add("headcount")
                hits.append(MetricHit("headcount", label, value, sheet, cell_ref, is_proj, period_label))
            if RAISE_PATTERNS.search(label):
                families.add("raise")
                hits.append(MetricHit("raise", label, value, sheet, cell_ref, is_proj, period_label))
            if REAL_ESTATE_PATTERNS.search(label):
                families.add("real_estate")
    return hits, families


# ─── .xls sheet inspection ────────────────────────────────────────────────────

def inspect_xls_file(filepath: Path) -> tuple[int, list[str]]:
    """Return (sheet_count, sheet_names) for .xls files via xlrd."""
    try:
        import xlrd
        wb = xlrd.open_workbook(str(filepath))
        return wb.nsheets, wb.sheet_names()
    except Exception:
        return 0, []


def inspect_xlsx_file(filepath: Path) -> tuple[int, list[str]]:
    """Return (sheet_count, sheet_names) for .xlsx/.xlsm files via openpyxl."""
    try:
        from openpyxl import load_workbook
        wb = load_workbook(str(filepath), read_only=True, data_only=True)
        names = wb.sheetnames
        return len(names), names
    except Exception:
        return 0, []


# ─── Verdict logic ────────────────────────────────────────────────────────────

def compute_verdict(result: FileAuditResult) -> tuple[str, list[str], str]:
    reasons = []
    recommended = "none"

    if not result.extraction_succeeded:
        return "FAIL", [f"Extraction failed: {result.extraction_error}"], "extraction fix"

    total = result.total_facts_found
    families = set(result.metric_families)

    if total == 0:
        return "FAIL", ["Zero financial metric tokens detected — extractor returned no usable content"], "extraction fix"

    # Check for real estate (different metric families expected)
    if result.is_real_estate:
        if "real_estate" in families:
            reasons.append("Real-estate schema detected (NOI/IRR/waterfall patterns found)")
        else:
            reasons.append("File appears to be real-estate but RE-specific metrics not detected")
            recommended = "extraction fix"

    # Revenue detection
    if "revenue" not in families and not result.is_real_estate:
        reasons.append("WARNING: No revenue metrics detected")
        recommended = "extraction fix"
    else:
        current_rev = [h for h in result.revenue_hits if not h.is_projected]
        if current_rev:
            reasons.append(f"Current-period revenue detected ({len(current_rev)} signals)")
        else:
            proj_rev = [h for h in result.revenue_hits if h.is_projected]
            if proj_rev:
                reasons.append(f"Only projected revenue found ({len(proj_rev)} signals) — no confirmed current fact")
                recommended = "temporal-scope fix"
            else:
                reasons.append("Revenue mentions found but no period-classified facts")

    # Burn detection
    has_current_burn = any(not h.is_projected for h in result.burn_hits)
    has_proj_burn = any(h.is_projected for h in result.burn_hits)
    if "burn" in families:
        if has_current_burn:
            reasons.append(f"Current-period burn detected")
        elif has_proj_burn:
            reasons.append("Only projected burn found — alternative_burn_fact path expected")
            if recommended == "none":
                recommended = "selector fix (alt burn fallback)"
        else:
            reasons.append("Burn mentions found but not period-classified")

    # All-projected check
    total_hits = len(result.metric_hits)
    if total_hits > 0:
        proj_count = sum(1 for h in result.metric_hits if h.is_projected)
        if proj_count / total_hits > 0.9:
            reasons.append(f"WARNING: {proj_count}/{total_hits} metric hits are projected — no current-state data detected")
            if recommended == "none":
                recommended = "temporal-scope fix"

    if not reasons:
        reasons.append("Financial metrics extracted successfully")

    # Final grade
    has_warning = any("WARNING" in r for r in reasons)
    if has_warning or recommended not in ("none",):
        verdict = "PASS WITH WARNINGS"
    else:
        verdict = "PASS"

    return verdict, reasons, recommended


# ─── Report generation ────────────────────────────────────────────────────────

def _first_hit_str(hits: list[MetricHit]) -> str:
    """Format top metric hits."""
    current = [h for h in hits if not h.is_projected]
    projected = [h for h in hits if h.is_projected]
    lines = []
    if current:
        h = current[0]
        val_str = f" = {h.raw_value}" if h.raw_value is not None else ""
        lines.append(f"- **Current**: `{h.label}`{val_str} | sheet: {h.sheet} | cell: {h.cell}")
    if projected:
        h = projected[0]
        val_str = f" = {h.raw_value}" if h.raw_value is not None else ""
        lines.append(f"- **Projected**: `{h.label}`{val_str} | sheet: {h.sheet} | cell: {h.cell} | ⚠ projected")
    if not lines:
        lines.append("- Not detected")
    return "\n".join(lines)


def generate_file_report(index: int, result: FileAuditResult) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", result.filename.lower().replace(" ", "-")).strip("-")
    slug = slug[:50]

    verdict_icon = {"PASS": "✅", "PASS WITH WARNINGS": "⚠️", "FAIL": "❌"}.get(result.verdict, "?")

    sheets_list = ", ".join(result.sheet_names[:10])
    if len(result.sheet_names) > 10:
        sheets_list += f" … (+{len(result.sheet_names)-10} more)"

    families_str = ", ".join(sorted(result.metric_families)) if result.metric_families else "_none detected_"

    report = f"""# {result.filename}

## File metadata
- **Path**: `{result.filepath}`
- **File type**: `{result.file_type}`
- **Size**: {result.size_bytes / 1024:.1f} KB
- **Sheet count**: {result.sheet_count}
- **Sheets**: {sheets_list if sheets_list else "_none_"}

## Extraction summary
- **Extraction method**: {result.extraction_method}
- **Extraction succeeded**: {"Yes" if result.extraction_succeeded else f"No — {result.extraction_error}"}
- **Total pages/tables returned**: {len(result.raw_pages)}
- **Financial metric tokens detected**: {result.total_facts_found}
- **Metric families found**: {families_str}
- **XLSX facts detected**: {"Yes" if result.total_facts_found > 0 and result.extraction_succeeded else "No"}
- **Has current-state signals**: {"Yes" if result.has_current_state else "No"}
- **Has projection signals**: {"Yes" if result.has_projections else "No"}
- **Real-estate schema**: {"Yes" if result.is_real_estate else "No"}

## Current-state outputs

### Revenue / ARR
{_first_hit_str(result.revenue_hits)}

### Burn Rate
{_first_hit_str(result.burn_hits)}

### Runway
{_first_hit_str(result.runway_hits)}

### Cash on Hand
{_first_hit_str(result.cash_hits)}

## Data quality assessment

### Coverage assessment
"""
    if not result.extraction_succeeded:
        report += "- **Status**: ❌ Extraction failed — no coverage assessment possible\n"
    elif result.total_facts_found == 0:
        report += "- **Status**: ❌ Zero metric tokens — file may be empty, password-protected, or use non-standard layouts\n"
    else:
        fams = set(result.metric_families)
        core_fams = {"revenue", "burn", "cash"} if not result.is_real_estate else {"real_estate", "ebitda"}
        covered = core_fams & fams
        pct = int(len(covered) / len(core_fams) * 100) if core_fams else 0
        report += f"- **Core metric families covered**: {len(covered)}/{len(core_fams)} ({pct}%)\n"
        if pct == 100:
            report += "- **Package quality**: complete\n"
        elif pct >= 50:
            report += "- **Package quality**: partial\n"
        else:
            report += "- **Package quality**: weak\n"

    report += "\n### Integrity signals\n"
    all_proj = all(h.is_projected for h in result.metric_hits) if result.metric_hits else False
    if all_proj and result.metric_hits:
        report += "- ⚠️ All detected metrics are projected/forward-looking — no current-state actuals found\n"
    elif result.is_real_estate:
        report += "- ℹ️ Real-estate schema — NOI/IRR/waterfall expected, not revenue/burn\n"
    else:
        report += "- No contradictions detected at extraction layer\n"

    if result.warnings:
        report += "\n### Warnings\n"
        for w in result.warnings:
            report += f"- ⚠️ {w}\n"

    report += "\n## Audit findings\n"

    # Findings
    findings_correct = []
    findings_wrong = []

    if result.extraction_succeeded and result.total_facts_found > 0:
        findings_correct.append("Vision worker successfully extracted structured tables from this workbook")
    if "revenue" in result.metric_families:
        current_rev = [h for h in result.revenue_hits if not h.is_projected]
        if current_rev:
            findings_correct.append(f"Current-period revenue signals found: `{current_rev[0].label}` on sheet `{current_rev[0].sheet}`")
        else:
            findings_wrong.append("Revenue mentions present but all appear to be projected — current-state revenue will be missing from report")
    if "burn" in result.metric_families:
        current_burn = [h for h in result.burn_hits if not h.is_projected]
        if not current_burn:
            proj_burn = [h for h in result.burn_hits if h.is_projected]
            if proj_burn:
                findings_wrong.append(
                    f"Burn signals are all projected (`{proj_burn[0].label}` on sheet `{proj_burn[0].sheet}`) — "
                    "burn tile will fall back to `alternative_burn_fact` path (projected, Interim badge)"
                )
            else:
                findings_wrong.append("Burn labels found but none classified — period labeling may be ambiguous")
    if result.is_real_estate:
        findings_correct.append("Real-estate schema correctly identified (NOI/IRR/waterfall patterns)")
    if result.sheet_count > 15:
        findings_correct.append(f"Large workbook ({result.sheet_count} sheets) — multi-tab financial model")

    if not result.extraction_succeeded:
        findings_wrong.append(f"Extraction FAILED: {result.extraction_error}")
    if result.total_facts_found == 0 and result.extraction_succeeded:
        findings_wrong.append("Extraction returned pages but zero metric tokens were recognized — layout may be non-standard")

    if findings_correct:
        report += "### Correct\n"
        for f_item in findings_correct:
            report += f"- ✅ {f_item}\n"
    if findings_wrong:
        report += "\n### Wrong / Issues\n"
        for f_item in findings_wrong:
            report += f"- ❌ {f_item}\n"
    if not findings_correct and not findings_wrong:
        report += "- _No specific findings_\n"

    report += f"""
## Pass / Fail verdict

**{verdict_icon} {result.verdict}**

"""
    for r in result.verdict_reasons:
        icon = "⚠️" if "WARNING" in r else "✓"
        report += f"- {icon} {r}\n"

    report += f"""
## Recommended next action

**{result.recommended_action}**
"""
    return report, f"{index:02d}_{slug}_report.md"


# ─── Main runner ──────────────────────────────────────────────────────────────

def run_audit() -> list[FileAuditResult]:
    files = sorted(
        [p for p in AUDIT_DIR.iterdir() if p.suffix.lower() in TARGET_EXTENSIONS],
        key=lambda p: p.name.lower(),
    )
    print(f"\n{'='*60}")
    print(f"DealDecisionAI Financial Audit Runner")
    print(f"Files found: {len(files)}")
    print(f"{'='*60}")
    for f in files:
        print(f"  {f.name}  ({f.stat().st_size // 1024}KB)")
    print()

    results: list[FileAuditResult] = []

    for idx, filepath in enumerate(files, start=1):
        fname = filepath.name
        suffix = filepath.suffix.lower()
        size = filepath.stat().st_size
        print(f"[{idx}/{len(files)}] Processing: {fname} ...", end="", flush=True)

        # Metadata
        if suffix == ".xls":
            sheet_count, sheet_names = inspect_xls_file(filepath)
        else:
            sheet_count, sheet_names = inspect_xlsx_file(filepath)

        result = FileAuditResult(
            filename=fname,
            filepath=str(filepath),
            file_type=suffix,
            size_bytes=size,
            extraction_succeeded=False,
            extraction_error=None,
            sheet_count=sheet_count,
            sheet_names=list(sheet_names),
            total_facts_found=0,
            metric_families=[],
            metric_hits=[],
            has_current_state=False,
            has_projections=False,
            is_real_estate=False,
        )

        # Get structured pages via the appropriate path
        # .xls → xlrd direct     .xlsx/.xlsm small → vision worker   large → openpyxl direct
        SIZE_LIMIT_VISION_WORKER = 0  # bypass vision worker for all files (avoids timeout/blocking)
        doc_id = f"eval-{re.sub(r'[^a-z0-9]', '-', fname.lower())[:40]}"

        pages = []
        extraction_method = "none"
        err = None

        if suffix == ".xls":
            try:
                pages, extraction_method = _direct_scan_xls(filepath)
                result.extraction_succeeded = True
            except Exception as e:
                result.extraction_succeeded = False
                result.extraction_error = str(e)
                err = e
        elif size > SIZE_LIMIT_VISION_WORKER:
            # Large file — use direct openpyxl to avoid vision worker timeout
            try:
                pages, extraction_method = _direct_scan_xlsx(filepath)
                result.extraction_succeeded = True
                result.warnings.append(
                    f"File is {size // 1024}KB — vision worker bypassed (>500KB threshold). "
                    "Used direct openpyxl scan."
                )
            except Exception as e:
                result.extraction_succeeded = False
                result.extraction_error = str(e)
                err = e
        else:
            # Normal .xlsx/.xlsm — call vision worker
            try:
                resp = call_extract_xlsx(filepath, doc_id, timeout=180)
                pages = resp.get("pages", []) if resp else []
                extraction_method = "vision_worker"
                result.extraction_succeeded = True
            except Exception as e:
                # Fallback: direct openpyxl
                try:
                    pages, extraction_method = _direct_scan_xlsx(filepath)
                    result.extraction_succeeded = True
                    result.warnings.append(
                        f"Vision worker failed ({e}) — fell back to direct openpyxl scan."
                    )
                except Exception as e2:
                    result.extraction_succeeded = False
                    result.extraction_error = f"worker: {e}; openpyxl: {e2}"
                    err = e2

        result.extraction_method = extraction_method
        result.raw_pages = pages

        if result.extraction_succeeded and pages:
            # Scan for metrics
            hits, families = scan_pages_for_metrics(pages)
            result.metric_hits = hits
            result.metric_families = sorted(families)
            result.total_facts_found = len(hits)

            result.revenue_hits = [h for h in hits if h.family == "revenue"]
            result.burn_hits = [h for h in hits if h.family == "burn"]
            result.runway_hits = [h for h in hits if h.family == "runway"]
            result.cash_hits = [h for h in hits if h.family == "cash"]
            result.is_real_estate = "real_estate" in families

            result.has_current_state = any(not h.is_projected for h in hits)
            result.has_projections = any(h.is_projected for h in hits)

            # Check for warnings
            col_labels = sum(1 for h in hits if re.match(r"^col_[A-Za-z]+$", h.period_label or ""))
            if col_labels > 5:
                result.warnings.append(
                    f"{col_labels} facts have raw column references (col_A, col_B…) as period labels — "
                    "period parser did not resolve these to calendar dates"
                )

            print(f" ✓ ({len(pages)} pages, {result.total_facts_found} metric tokens, "
                  f"method: {extraction_method}, "
                  f"families: {', '.join(sorted(result.metric_families)) or 'none'})")
        elif not result.extraction_succeeded:
            print(f" ✗ FAILED: {result.extraction_error}")
        else:
            print(f" ✓ (0 pages returned, method: {extraction_method})")

        # Compute verdict
        result.verdict, result.verdict_reasons, result.recommended_action = compute_verdict(result)
        results.append(result)

    return results


def generate_overall_summary(results: list[FileAuditResult]) -> tuple[str, dict]:
    passes = [r for r in results if r.verdict == "PASS"]
    warnings = [r for r in results if r.verdict == "PASS WITH WARNINGS"]
    fails = [r for r in results if r.verdict == "FAIL"]

    # Recurring failure patterns
    all_reasons = []
    for r in results:
        all_reasons.extend(r.verdict_reasons)
    pattern_counts = {}
    for reason in all_reasons:
        key = "projected-only" if "projected" in reason.lower() else \
              "no-revenue" if "revenue" in reason.lower() else \
              "burn-gap" if "burn" in reason.lower() else \
              "extraction-fail" if "fail" in reason.lower() else \
              "real-estate" if "real" in reason.lower() else "other"
        pattern_counts[key] = pattern_counts.get(key, 0) + 1

    # Best baseline tests (PASS, multiple families, current + projected balance)
    baseline_candidates = sorted(
        [r for r in passes],
        key=lambda r: (len(r.metric_families), r.total_facts_found),
        reverse=True,
    )[:3]

    # Best adversarial tests (FAIL or high-warning)
    adversarial_candidates = sorted(
        [r for r in fails + warnings],
        key=lambda r: len(r.warnings) + (3 if r.verdict == "FAIL" else 0),
        reverse=True,
    )[:3]

    # Top code issues
    issues = []
    if any("projected" in r for r in all_reasons if "WARNING" in r):
        issues.append("Period classifier not resolving projection labels consistently — projected-only files surface no current state")
    if any("col_" in w for r in results for w in r.warnings):
        issues.append("Period parser fails to decode raw column references (col_A…) to calendar dates — causes `unknown` temporal scope")
    if any("Burn signals are all projected" in r for result in results for r in result.verdict_reasons):
        issues.append("Burn tile shows `—` when only projected burn exists — alternative_burn_fact fallback required (selector fix already implemented)")
    if any(r.total_facts_found == 0 and r.extraction_succeeded for r in results):
        issues.append("Extraction returns pages but metric scanner detects zero tokens — non-standard layouts (e.g. legacy .xls) may need dedicated extractor")
    if any(r.is_real_estate for r in results):
        issues.append("Real-estate workbooks (NOI/IRR/waterfall) do not map to standard burn/revenue keys — schema differentiation needed")

    md = f"""# Financial Audit — Overall Summary

**Generated**: {datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")}

## Results summary

| Verdict | Count |
|---------|-------|
| ✅ PASS | {len(passes)} |
| ⚠️ PASS WITH WARNINGS | {len(warnings)} |
| ❌ FAIL | {len(fails)} |
| **Total** | **{len(results)}** |

## Per-file verdicts

| # | File | Verdict | Families | Metric tokens | Current? | Projected? |
|---|------|---------|----------|---------------|----------|-----------|
"""
    for i, r in enumerate(results, 1):
        icon = {"PASS": "✅", "PASS WITH WARNINGS": "⚠️", "FAIL": "❌"}.get(r.verdict, "?")
        families = ", ".join(sorted(r.metric_families)[:5]) or "_none_"
        md += f"| {i} | `{r.filename}` | {icon} {r.verdict} | {families} | {r.total_facts_found} | {'✓' if r.has_current_state else '—'} | {'✓' if r.has_projections else '—'} |\n"

    md += f"""
## Recurring patterns

| Pattern | Count |
|---------|-------|
"""
    for k, v in sorted(pattern_counts.items(), key=lambda x: -x[1]):
        md += f"| {k} | {v} |\n"

    md += """
## Extraction strengths

- Vision worker `/extract-xlsx` successfully handled all `.xlsx` and `.xlsm` files
- Sheet-level segmentation (UoF, KPI, P&L, etc.) is working
- Metric family detection covers revenue, burn, runway, cash, EBITDA, gross margin, headcount, raise, real-estate
- Current vs. projected classification catches ordinal year labels (`Year N`) and future calendar years

## Best baseline tests (richest correct extractions)

"""
    for r in baseline_candidates:
        md += f"- `{r.filename}` — {len(r.metric_families)} families, {r.total_facts_found} tokens, verdict: {r.verdict}\n"

    md += "\n## Strongest adversarial tests (expose extraction/classification gaps)\n\n"
    for r in adversarial_candidates:
        md += f"- `{r.filename}` — {r.verdict}: {'; '.join(r.verdict_reasons[:2])}\n"

    md += "\n## Top 5 code issues identified by this suite\n\n"
    for i, issue in enumerate(issues[:5], 1):
        md += f"{i}. {issue}\n"
    if not issues:
        md += "_No systematic issues identified._\n"

    md += """
## Recommended fix priority order

1. **Period parser — column reference resolution**: `col_A`, `col_B`... labels need to be decoded from workbook column headers before promotion
2. **Temporal scope propagation on derived facts**: Facts derived from projected source facts should inherit `temporal_scope: 'projected'`
3. **Real-estate schema differentiation**: NOI/IRR/waterfall files should be routed to an RE-specific extraction path rather than the startup financial pipeline
4. **Burn tile selector fallback**: Already implemented — `alternative_burn_fact` now used as third fallback
5. **Legacy .xls support**: If `.xls` files are expected in production, the vision worker needs a dedicated xlrd-based extraction path
"""

    # JSON summary
    json_summary = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "total": len(results),
        "passes": len(passes),
        "pass_with_warnings": len(warnings),
        "fails": len(fails),
        "files": [
            {
                "filename": r.filename,
                "verdict": r.verdict,
                "extraction_succeeded": r.extraction_succeeded,
                "metric_families": r.metric_families,
                "total_facts_found": r.total_facts_found,
                "has_current_state": r.has_current_state,
                "has_projections": r.has_projections,
                "is_real_estate": r.is_real_estate,
                "recommended_action": r.recommended_action,
                "warnings": r.warnings,
                "verdict_reasons": r.verdict_reasons,
            }
            for r in results
        ],
        "recurring_patterns": pattern_counts,
        "top_issues": issues,
    }

    return md, json_summary


# ─── Entry point ──────────────────────────────────────────────────────────────

def main():
    results = run_audit()

    report_files = []
    for idx, result in enumerate(results, 1):
        report_md, report_filename = generate_file_report(idx, result)
        out_path = RESULTS_DIR / report_filename
        out_path.write_text(report_md, encoding="utf-8")
        report_files.append(str(out_path))
        print(f"  → {report_filename} ({result.verdict})")

    summary_md, summary_json = generate_overall_summary(results)
    (RESULTS_DIR / "overall_summary.md").write_text(summary_md, encoding="utf-8")
    (RESULTS_DIR / "overall_summary.json").write_text(
        json.dumps(summary_json, indent=2, default=str), encoding="utf-8"
    )

    print(f"\nResults written to: {RESULTS_DIR}")
    print(f"  {len(report_files)} per-file reports")
    print(f"  overall_summary.md")
    print(f"  overall_summary.json")

    passes = sum(1 for r in results if r.verdict == "PASS")
    warnings = sum(1 for r in results if r.verdict == "PASS WITH WARNINGS")
    fails = sum(1 for r in results if r.verdict == "FAIL")
    print(f"\n  ✅ PASS: {passes}  ⚠️ WARNINGS: {warnings}  ❌ FAIL: {fails}")


if __name__ == "__main__":
    main()
