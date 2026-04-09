"""
evaluation/pipeline_regression/loader.py
==========================================

Phase 1 + 2 — Discover ground_truth_v1 files, map them to live deal IDs,
and fetch current system outputs (API report + DIO + DB financial facts).

Ground-truth discovery
----------------------
- Enumerates every *.json file in evaluation/ground_truth/
- Accepts both the simple ground_truth_v1 (slots + financials.validation)
  and the richer "validation-first" layout produced in the 2026-04 sprint
  (metadata, financials.current_state, financials.known_issues, validation)
- Skips files whose _schema is NOT "ground_truth_v1"

Deal mapping priority
---------------------
1. GT file has explicit deal_id field  → use directly
2. GT deal_name fuzzy-matched against deals table            (via DB)
3. GT file cannot be matched → flagged as UNMAPPED
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any, Optional

import psycopg2
import psycopg2.extras
import requests

# ── Repo layout ──────────────────────────────────────────────────────────────
_RUNNER_ROOT  = Path(__file__).resolve().parent
_EVAL_ROOT    = _RUNNER_ROOT.parent
_REPO_ROOT    = _EVAL_ROOT.parent
GT_DIR        = _EVAL_ROOT / "ground_truth"
REF_DEALS_DIR = _REPO_ROOT / "docs" / "reference-deal-docs"

# ── API settings ─────────────────────────────────────────────────────────────
API_BASE    = "http://localhost:9001"
API_TIMEOUT = 30   # seconds per request

# ── DB settings ──────────────────────────────────────────────────────────────
DEFAULT_DB_URL = "postgresql://postgres:postgres@localhost:55433/dealdecision"

# ── Reference-deal subfolder → GT name mapping ───────────────────────────────
# Maps folder or prefix patterns → canonical GT deal_name (file stem)
_REF_FOLDER_MAP: dict[str, str] = {
    "dealdecisionai": "Deal Decision",
    "qredible":       "Qredible",
    "stackfactor":    "StackFactor",
    "webmax":         "WebMax",
    "pdf-pptx-deals": None,    # contains multiple deals — not 1:1
}


# ─────────────────────────────────────────────────────────────────────────────
# GT file discovery
# ─────────────────────────────────────────────────────────────────────────────

def discover_gt_files(gt_dir: Path = GT_DIR) -> list[Path]:
    """Return all *.json GT files in gt_dir that declare _schema == ground_truth_v1."""
    out: list[Path] = []
    for p in sorted(gt_dir.glob("*.json")):
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
            if data.get("_schema") == "ground_truth_v1":
                out.append(p)
        except Exception as exc:
            print(f"[loader] WARNING: could not parse {p.name}: {exc}", file=sys.stderr)
    return out


def load_gt(path: Path) -> dict:
    """Load and minimally validate a ground_truth_v1 file."""
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError(f"GT file must be a JSON object: {path}")
    if data.get("_schema") != "ground_truth_v1":
        raise ValueError(f"GT file is not ground_truth_v1: {path}")
    # Normalise validation structure — support both locations:
    #   financials.validation  (older simple GT)
    #   financials.validation  (same key, newer GT just has more fields)
    return data


# ─────────────────────────────────────────────────────────────────────────────
# Deal mapping
# ─────────────────────────────────────────────────────────────────────────────

def _connect_db(db_url: str) -> Any:
    return psycopg2.connect(db_url, cursor_factory=psycopg2.extras.RealDictCursor)


def _resolve_deal_id(conn: Any, gt: dict) -> Optional[str]:
    """
    Return deal_id for a GT entry.
    Uses the explicit deal_id from the GT file if present, else fuzzy-matches by name.
    """
    explicit_id = gt.get("deal_id")
    if explicit_id:
        # Verify it exists in DB (not deleted)
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id::text FROM deals WHERE id = %s AND deleted_at IS NULL",
                (explicit_id,)
            )
            row = cur.fetchone()
            if row:
                return list(row.values())[0]
        # Explicit ID not found in DB — fall through to name match
    # Fuzzy name match
    name = (gt.get("deal_name") or "").strip()
    if not name:
        return None
    with conn.cursor() as cur:
        cur.execute(
            "SELECT id::text FROM deals WHERE lower(name) LIKE lower(%s) AND deleted_at IS NULL"
            " ORDER BY created_at DESC LIMIT 1",
            (f"%{name}%",)
        )
        row = cur.fetchone()
        if row:
            return list(row.values())[0]
    return None


def _find_ref_folder(gt_name: str) -> Optional[Path]:
    """Return the reference-deal-docs subfolder for a GT name if it exists."""
    key = gt_name.lower().replace(" ", "")
    if key in _REF_FOLDER_MAP:
        mapped = _REF_FOLDER_MAP[key]
        if mapped is None:
            return None
        candidate = REF_DEALS_DIR / mapped
        return candidate if candidate.exists() else None
    # Direct folder name match
    for sub in REF_DEALS_DIR.iterdir():
        if sub.is_dir() and sub.name.lower().replace(" ", "") == key:
            return sub
    return None


def build_case_map(gt_dir: Path = GT_DIR, db_url: str = DEFAULT_DB_URL) -> list[dict]:
    """
    Returns a list of case dicts, one per discovered GT file:
      {
        "gt_path": Path,
        "gt_name": str,
        "gt": dict,              # loaded GT data
        "deal_id": str | None,
        "ref_folder": Path | None,
        "mapping_status": "mapped" | "unmapped" | "ambiguous",
        "mapping_note": str,
      }
    """
    gt_files = discover_gt_files(gt_dir)
    conn = _connect_db(db_url)
    cases: list[dict] = []
    try:
        for path in gt_files:
            gt = load_gt(path)
            gt_name = path.stem
            deal_id = _resolve_deal_id(conn, gt)
            ref_folder = _find_ref_folder(gt_name)

            if deal_id:
                status = "mapped"
                note   = f"deal_id={deal_id}"
            else:
                status = "unmapped"
                note   = f"No deal found in DB for '{gt.get('deal_name', gt_name)}'"

            cases.append({
                "gt_path":        path,
                "gt_name":        gt_name,
                "gt":             gt,
                "deal_id":        deal_id,
                "ref_folder":     ref_folder,
                "mapping_status": status,
                "mapping_note":   note,
            })
    finally:
        conn.close()
    return cases


# ─────────────────────────────────────────────────────────────────────────────
# System output fetch
# ─────────────────────────────────────────────────────────────────────────────

def fetch_report(deal_id: str) -> Optional[dict]:
    """Fetch the live API report for a deal. Returns None on any error."""
    url = f"{API_BASE}/api/v1/deals/{deal_id}/report"
    try:
        resp = requests.get(url, timeout=API_TIMEOUT)
        resp.raise_for_status()
        return resp.json()
    except Exception as exc:
        print(f"[loader] WARNING: report fetch failed ({deal_id}): {exc}", file=sys.stderr)
        return None


def fetch_dio(deal_id: str, db_url: str = DEFAULT_DB_URL) -> Optional[dict]:
    """Return the latest DIO data dict for a deal from deal_intelligence_objects."""
    conn = _connect_db(db_url)
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT dio_data FROM deal_intelligence_objects"
                " WHERE deal_id = %s ORDER BY created_at DESC LIMIT 1",
                (deal_id,)
            )
            row = cur.fetchone()
            if row:
                raw = list(row.values())[0]
                if isinstance(raw, dict):
                    return raw
                if isinstance(raw, str):
                    return json.loads(raw)
        return None
    except Exception as exc:
        print(f"[loader] WARNING: DIO fetch failed ({deal_id}): {exc}", file=sys.stderr)
        return None
    finally:
        conn.close()


def fetch_financial_facts(deal_id: str, db_url: str = DEFAULT_DB_URL) -> list[dict]:
    """Return all financial_facts_v1 rows for a deal."""
    conn = _connect_db(db_url)
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT fact_id, document_id, source_kind, metric_key, metric_label,"
                "       period_type, period_label, value, unit, currency, confidence,"
                "       reconciliation_status, sheet_name, page_number, row_index,"
                "       col_index, source_pointer, evidence_id, excerpt, slide_type,"
                "       slide_title"
                " FROM financial_facts_v1"
                " WHERE deal_id = %s",
                (deal_id,)
            )
            rows = cur.fetchall()
            return [dict(r) for r in rows]
    except Exception as exc:
        print(f"[loader] WARNING: financial_facts fetch failed ({deal_id}): {exc}", file=sys.stderr)
        return []
    finally:
        conn.close()


def run_noise_sql(deal_id: str, sql_filter: str, db_url: str = DEFAULT_DB_URL) -> int:
    """
    Execute a noise-check SQL filter against financial_facts_v1 for the given deal.
    The sql_filter is appended as AND clause to a safe base query.
    Returns the row count.

    SECURITY NOTE: sql_filter comes from GT files committed to the repo — treated
    as controlled internal input.  Never expose this to user-supplied values.
    """
    conn = _connect_db(db_url)
    try:
        # Inject deal_id safely via parameterised base; the filter is appended as
        # literal SQL — it is authored by developers in the GT repo, not user input.
        # Escape any literal % in the filter so psycopg2 doesn't misinterpret them
        # as positional parameter placeholders (e.g. ILIKE '%cap%table%').
        safe_filter = sql_filter.replace("%", "%%")
        query = (
            "SELECT COUNT(*) AS n FROM financial_facts_v1"
            f" WHERE deal_id = %s AND ({safe_filter})"
        )
        with conn.cursor() as cur:
            cur.execute(query, (deal_id,))
            row = cur.fetchone()
            return int(list(row.values())[0]) if row else 0
    except Exception as exc:
        print(f"[loader] WARNING: noise SQL failed ({deal_id}): {exc}", file=sys.stderr)
        return -1   # sentinel: query errored
    finally:
        conn.close()
