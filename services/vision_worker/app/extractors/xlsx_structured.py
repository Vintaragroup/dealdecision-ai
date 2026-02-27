from __future__ import annotations

import base64
import hashlib
from dataclasses import dataclass
from io import BytesIO
from typing import Any, Dict, List, Optional, Tuple

from openpyxl import load_workbook


@dataclass
class CellVal:
    address: str
    value: Optional[Any]
    formula: Optional[str]


def _sha256_hex(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()


def _is_empty(v: Any) -> bool:
    if v is None:
        return True
    if isinstance(v, str) and v.strip() == "":
        return True
    return False


def _a1(col: int, row: int) -> str:
    # openpyxl is 1-based.
    from openpyxl.utils import get_column_letter

    return f"{get_column_letter(col)}{row}"


def _coerce_scalar(v: Any) -> Any:
    # Ensure JSON-serializable values.
    if v is None:
        return None
    if isinstance(v, (int, float, str, bool)):
        return v
    # Dates / datetimes / decimals etc.
    try:
        return str(v)
    except Exception:
        return None


def _cell_kind(v: Any) -> str:
    if v is None:
        return "empty"
    if isinstance(v, (int, float)):
        return "number"
    if isinstance(v, bool):
        return "bool"
    if isinstance(v, str):
        t = v.strip()
        if not t:
            return "empty"
        # Excel formulas are strings like "=SUM(A1:A3)" when data_only=False
        if t.startswith("="):
            return "formula"
        return "text"
    return "other"


# ─── Use-of-Funds sheet detection ─────────────────────────────────────────────

import re as _re

# Sheet-name keywords that strongly indicate a Use-of-Funds sheet.
_UOF_SHEET_NAME_PATTERNS: List[_re.Pattern] = [
    _re.compile(r"use[\s_-]+of[\s_-]+(?:funds|proceeds|capital|raise|investment)", _re.I),
    _re.compile(r"allocation[\s_-]+of[\s_-]+(?:funds|proceeds|capital)", _re.I),
    _re.compile(r"capital[\s_-]+alloc", _re.I),
    _re.compile(r"proceed[s]?[\s_-]+alloc", _re.I),
    _re.compile(r"fund[s]?[\s_-]+alloc", _re.I),
    _re.compile(r"budget[\s_-]+alloc", _re.I),
    _re.compile(r"round[\s_-]+alloc", _re.I),
    _re.compile(r"funding[\s_-]+(?:breakdown|plan|use|alloc)", _re.I),
    _re.compile(r"investment[\s_-]+(?:breakdown|plan|allocation)", _re.I),
    _re.compile(r"(?:fund|money|capital|proceeds?|raise)[\s_-]+deploy", _re.I),
    _re.compile(r"how[\s_-]+(?:we[\s_-]+)?use", _re.I),
]

# Row-level keywords that, if found in the first rows of a sheet, indicate a UoF table.
_UOF_ROW_PATTERNS: List[_re.Pattern] = [
    _re.compile(r"use[\s]+of[\s]+(?:funds|proceeds|capital|raise|investment)", _re.I),
    _re.compile(r"allocation[\s]+of[\s]+(?:funds|proceeds)", _re.I),
    _re.compile(r"capital[\s]+allocation", _re.I),
    _re.compile(r"how[\s]+(?:we[\s]+(?:will[\s]+)?use|funds[\s]+(?:will[\s]+be[\s]+)?used|we[\s]+plan[\s]+to[\s]+use)", _re.I),
    _re.compile(r"where[\s]+(?:the[\s]+)?(?:money|funds?|capital)\s+(?:goes|will[\s]+go|is[\s]+going)", _re.I),
    _re.compile(r"(?:fund|money|capital|proceeds?|raise)[\s]+deploy", _re.I),
    _re.compile(r"round[\s]+alloc", _re.I),
    _re.compile(r"funding[\s]+(?:breakdown|plan|use)", _re.I),
]


def _detect_segment_key(sheet_name: str, ws_f, max_scan_rows: int) -> str:
    """Return 'use_of_funds' when the sheet appears to contain a Use-of-Funds table,
    otherwise return 'financials'.

    Detection priority:
      1. Sheet name keyword match (fast)
      2. First-row scan for UoF header patterns (up to 15 rows)
    """
    name_lower = (sheet_name or "").strip().lower()
    for pat in _UOF_SHEET_NAME_PATTERNS:
        if pat.search(name_lower):
            return "use_of_funds"

    # Scan the first 15 rows for a UoF header string in any cell
    scan_limit = min(15, max_scan_rows)
    try:
        for r in range(1, scan_limit + 1):
            for c in range(1, 16):  # cap col scan at 15 for speed
                v = ws_f.cell(row=r, column=c).value
                if not v or not isinstance(v, str):
                    continue
                s = v.strip()
                if not s:
                    continue
                for pat in _UOF_ROW_PATTERNS:
                    if pat.search(s):
                        return "use_of_funds"
    except Exception:
        pass  # never crash extraction due to segment detection

    return "financials"


def _header_like_score(values: List[Any]) -> float:
    non_empty = [v for v in values if not _is_empty(v)]
    if len(non_empty) < 2:
        return 0.0
    kinds = [_cell_kind(v) for v in non_empty]
    textish = sum(1 for k in kinds if k in {"text"})
    numeric = sum(1 for k in kinds if k in {"number"})
    if textish < 2:
        return 0.0
    return (textish / max(1, len(non_empty))) - (numeric / max(1, len(non_empty))) * 0.5


def _connected_components(
    non_empty: set[Tuple[int, int]],
    *,
    max_components: int,
    max_cells_total: int,
) -> List[Tuple[int, int, int, int, List[Tuple[int, int]]]]:
    # Returns list of (min_r, max_r, min_c, max_c, cells)
    comps: List[Tuple[int, int, int, int, List[Tuple[int, int]]]] = []
    visited: set[Tuple[int, int]] = set()

    def neighbors(r: int, c: int):
        yield (r - 1, c)
        yield (r + 1, c)
        yield (r, c - 1)
        yield (r, c + 1)

    # Guard against pathological sheets.
    if len(non_empty) > max_cells_total:
        # Keep only a sample; prefer top-left region.
        non_empty = {p for p in non_empty if p[0] <= 300 and p[1] <= 60}

    for start in non_empty:
        if start in visited:
            continue
        stack = [start]
        visited.add(start)
        cells: List[Tuple[int, int]] = []
        min_r = max_r = start[0]
        min_c = max_c = start[1]

        while stack:
            r, c = stack.pop()
            cells.append((r, c))
            if r < min_r:
                min_r = r
            if r > max_r:
                max_r = r
            if c < min_c:
                min_c = c
            if c > max_c:
                max_c = c

            for nb in neighbors(r, c):
                if nb in non_empty and nb not in visited:
                    visited.add(nb)
                    stack.append(nb)

        comps.append((min_r, max_r, min_c, max_c, cells))
        if len(comps) >= max_components:
            break

    # Sort larger first.
    comps.sort(key=lambda x: (-(x[1] - x[0] + 1) * (x[3] - x[2] + 1), -len(x[4])))
    return comps


def extract_xlsx_structured_pages(
    *,
    document_id: str,
    xlsx_b64: str,
    extractor_version: str,
    max_sheets: int = 50,
    max_tables_per_sheet: int = 24,
    max_scan_rows: int = 350,
    max_scan_cols: int = 80,
) -> List[Dict[str, Any]]:
    raw = base64.b64decode(xlsx_b64)

    # Load twice: one for formulas, one for cached values if present.
    wb_formula = load_workbook(filename=BytesIO(raw), data_only=False, read_only=True)
    wb_values = load_workbook(filename=BytesIO(raw), data_only=True, read_only=True)

    sheet_names = list(wb_formula.sheetnames)[:max_sheets]
    pages: List[Dict[str, Any]] = []

    for sheet_index, name in enumerate(sheet_names):
        ws_f = wb_formula[name]
        ws_v = wb_values[name]

        # Detect whether this sheet is a Use-of-Funds sheet or a financials sheet.
        sheet_segment_key = _detect_segment_key(name, ws_f, max_scan_rows)
        max_row = min(int(ws_f.max_row or 0), max_scan_rows)
        max_col = min(int(ws_f.max_column or 0), max_scan_cols)
        if max_row <= 0 or max_col <= 0:
            max_row, max_col = 1, 1

        non_empty: set[Tuple[int, int]] = set()
        # Cell lookup is a bit slow; keep this bounded.
        for r in range(1, max_row + 1):
            for c in range(1, max_col + 1):
                v = ws_f.cell(row=r, column=c).value
                if not _is_empty(v):
                    non_empty.add((r, c))

        # Build components; each component becomes a "table/range" node.
        comps = _connected_components(non_empty, max_components=80, max_cells_total=40000)

        table_assets: List[Dict[str, Any]] = []
        kept = 0


        def build_range_asset(*, min_r: int, max_r: int, min_c: int, max_c: int, reason: str) -> Dict[str, Any]:
            height = max_r - min_r + 1
            width = max_c - min_c + 1
            area = height * width

            # Pick a header row in the top ~5 rows of the block.
            candidate_rows = list(range(min_r, min(max_r, min_r + 4) + 1))
            best_hr = min_r
            best_score = -1.0
            for rr in candidate_rows:
                vals = [ws_f.cell(row=rr, column=cc).value for cc in range(min_c, max_c + 1)]
                sc = _header_like_score(vals)
                if sc > best_score:
                    best_score = sc
                    best_hr = rr

            headers: List[str] = []
            for cc in range(min_c, max_c + 1):
                hv = ws_f.cell(row=best_hr, column=cc).value
                hs = str(hv).strip() if isinstance(hv, str) else (str(hv).strip() if hv is not None else "")
                if not hs:
                    from openpyxl.utils import get_column_letter

                    hs = f"col_{get_column_letter(cc)}"
                headers.append(hs)

            rows_preview: List[Dict[str, Any]] = []
            max_preview_rows = min(30, max_r - best_hr)
            for ridx in range(1, max_preview_rows + 1):
                rr = best_hr + ridx
                row_obj: Dict[str, Any] = {}
                any_val = False
                for j, cc in enumerate(range(min_c, max_c + 1)):
                    cell_f = ws_f.cell(row=rr, column=cc)
                    cell_v = ws_v.cell(row=rr, column=cc)
                    val = cell_v.value
                    formula = cell_f.value if isinstance(cell_f.value, str) and str(cell_f.value).strip().startswith("=") else None
                    out_v = _coerce_scalar(val if val is not None else (None if formula else cell_f.value))
                    if out_v is not None:
                        any_val = True
                    row_obj[headers[j]] = out_v
                if any_val:
                    rows_preview.append(row_obj)

            # Anchors: prefer non-empty cells, but always provide a sample.
            anchors: List[Dict[str, Any]] = []
            # First pass: non-empty.
            for r in range(min_r, max_r + 1):
                for c in range(min_c, max_c + 1):
                    cell_f = ws_f.cell(row=r, column=c)
                    if _is_empty(cell_f.value):
                        continue
                    cell_v = ws_v.cell(row=r, column=c)
                    formula = cell_f.value if isinstance(cell_f.value, str) and str(cell_f.value).strip().startswith("=") else None
                    val = _coerce_scalar(cell_v.value if cell_v.value is not None else (None if formula else cell_f.value))
                    anchors.append({"a": _a1(c, r), "v": val, "f": formula})
                    if len(anchors) >= 250:
                        break
                if len(anchors) >= 250:
                    break

            start = _a1(min_c, min_r)
            end = _a1(max_c, max_r)
            range_id = f"{name}!{start}:{end}"
            title = f"{name} {start}:{end}"

            structured_json = {
                "kind": "excel_range",
                "segment_key": sheet_segment_key,
                "sheet_name": name,
                "range": {"start": start, "end": end},
                "header_row": int(best_hr),
                "headers": headers,
                "rows_preview": rows_preview,
                "anchors_v1": {"cells": anchors},
                "title": title,
                "stats": {
                    "area": area,
                    "rows": height,
                    "cols": width,
                    "reason": reason,
                },
            }

            return {
                "asset_type": "table",
                "bbox": {"x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0},
                "confidence": 0.9,
                "quality_flags": {
                    "source": "structured_excel_py",
                    "segment_key": sheet_segment_key,
                    "sheet_name": name,
                    "range": f"{start}:{end}",
                    "reason": reason,
                },
                "image_uri": None,
                "image_hash": _sha256_hex(f"{document_id}|{extractor_version}|{range_id}|{reason}"),
                "extraction": {
                    "ocr_text": None,
                    "ocr_blocks": [],
                    "structured_json": structured_json,
                    "units": None,
                    "labels": {"title": title, "source": "structured_excel_py"},
                    "model_version": None,
                    "confidence": 0.9,
                },
            }
        for (min_r, max_r, min_c, max_c, cells) in comps:
            height = max_r - min_r + 1
            width = max_c - min_c + 1
            area = height * width
            if area < 6:
                continue
            if height < 2 and width < 3:
                continue
            density = len(cells) / max(1, area)
            # Skip sparse noise.
            if density < 0.10 and area > 20:
                continue

            # Pick a header row in the top ~4 rows of the block.
            candidate_rows = list(range(min_r, min(max_r, min_r + 3) + 1))
            best_hr = min_r
            best_score = -1.0
            for rr in candidate_rows:
                vals = [ws_f.cell(row=rr, column=cc).value for cc in range(min_c, max_c + 1)]
                sc = _header_like_score(vals)
                if sc > best_score:
                    best_score = sc
                    best_hr = rr

            headers: List[str] = []
            for cc in range(min_c, max_c + 1):
                hv = ws_f.cell(row=best_hr, column=cc).value
                hs = str(hv).strip() if isinstance(hv, str) else (str(hv).strip() if hv is not None else "")
                if not hs:
                    from openpyxl.utils import get_column_letter

                    hs = f"col_{get_column_letter(cc)}"
                headers.append(hs)

            rows_preview: List[Dict[str, Any]] = []
            max_preview_rows = min(30, max_r - best_hr)
            for ridx in range(1, max_preview_rows + 1):
                rr = best_hr + ridx
                row_obj: Dict[str, Any] = {}
                any_val = False
                for j, cc in enumerate(range(min_c, max_c + 1)):
                    cell_f = ws_f.cell(row=rr, column=cc)
                    cell_v = ws_v.cell(row=rr, column=cc)
                    val = cell_v.value
                    formula = cell_f.value if isinstance(cell_f.value, str) and str(cell_f.value).strip().startswith("=") else None
                    out_v = _coerce_scalar(val if val is not None else (None if formula else cell_f.value))
                    if out_v is not None:
                        any_val = True
                    row_obj[headers[j]] = out_v
                if any_val:
                    rows_preview.append(row_obj)

            # Anchors: keep up to 250 cell refs.
            anchors: List[Dict[str, Any]] = []
            for (r, c) in sorted(cells)[:250]:
                cell_f = ws_f.cell(row=r, column=c)
                cell_v = ws_v.cell(row=r, column=c)
                formula = cell_f.value if isinstance(cell_f.value, str) and str(cell_f.value).strip().startswith("=") else None
                val = _coerce_scalar(cell_v.value if cell_v.value is not None else (None if formula else cell_f.value))
                anchors.append({"a": _a1(c, r), "v": val, "f": formula})

            start = _a1(min_c, min_r)
            end = _a1(max_c, max_r)
            range_id = f"{name}!{start}:{end}"
            title = f"{name} {start}:{end}"

            structured_json = {
                "kind": "excel_range",
                "segment_key": sheet_segment_key,
                "sheet_name": name,
                "range": {"start": start, "end": end},
                "header_row": int(best_hr),
                "headers": headers,
                "rows_preview": rows_preview,
                "anchors_v1": {"cells": anchors},
                "title": title,
                "stats": {
                    "area": area,
                    "density": round(density, 4),
                    "rows": height,
                    "cols": width,
                    "non_empty_cells": len(cells),
                },
            }

            asset = {
                "asset_type": "table",
                "bbox": {"x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0},
                "confidence": 0.9,
                "quality_flags": {
                    "source": "structured_excel_py",
                    "segment_key": sheet_segment_key,
                    "sheet_name": name,
                    "range": f"{start}:{end}",
                },
                "image_uri": None,
                "image_hash": _sha256_hex(f"{document_id}|{extractor_version}|{range_id}"),
                "extraction": {
                    "ocr_text": None,
                    "ocr_blocks": [],
                    "structured_json": structured_json,
                    "units": None,
                    "labels": {"title": title, "source": "structured_excel_py"},
                    "model_version": None,
                    "confidence": 0.9,
                },
            }
            table_assets.append(asset)
            kept += 1
            if kept >= max_tables_per_sheet:
                break

        # If we failed to detect any table/range blocks, fall back to emitting the sheet's used-range.
        if kept == 0:
            try:
                from openpyxl.utils.cell import range_boundaries

                dim = str(ws_f.calculate_dimension() or "A1:A1")
                min_c, min_r, max_c, max_r = range_boundaries(dim)
                min_r = max(1, min(int(min_r), max_scan_rows))
                max_r = max(1, min(int(max_r), max_scan_rows))
                min_c = max(1, min(int(min_c), max_scan_cols))
                max_c = max(1, min(int(max_c), max_scan_cols))
                if max_r >= min_r and max_c >= min_c:
                    table_assets.append(build_range_asset(min_r=min_r, max_r=max_r, min_c=min_c, max_c=max_c, reason="used_range_fallback"))
                    kept = 1
            except Exception:
                # As a last resort, emit a tiny top-left range.
                table_assets.append(build_range_asset(min_r=1, max_r=min(40, max_scan_rows), min_c=1, max_c=min(20, max_scan_cols), reason="top_left_fallback"))
                kept = 1

        # Always include a sheet overview node.
        overview_structured = {
            "kind": "excel_sheet_overview",
            "segment_key": sheet_segment_key,
            "sheet_name": name,
            "sheet_index": sheet_index,
            "tables_detected": min(len(table_assets), max_tables_per_sheet),
        }
        overview_asset = {
            "asset_type": "table",
            "bbox": {"x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0},
            "confidence": 0.85,
            "quality_flags": {"source": "structured_excel_py", "segment_key": sheet_segment_key, "sheet_name": name},
            "image_uri": None,
            "image_hash": _sha256_hex(f"{document_id}|{extractor_version}|{name}|overview"),
            "extraction": {
                "ocr_text": None,
                "ocr_blocks": [],
                "structured_json": overview_structured,
                "units": None,
                "labels": {"title": f"Sheet: {name}", "source": "structured_excel_py"},
                "model_version": None,
                "confidence": 0.85,
            },
        }

        page = {
            "document_id": document_id,
            "page_index": int(sheet_index),
            "extractor_version": extractor_version,
            "assets": [overview_asset, *table_assets],
        }
        pages.append(page)

    return pages
