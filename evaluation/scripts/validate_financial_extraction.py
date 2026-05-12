#!/usr/bin/env python3
"""
evaluation/scripts/validate_financial_extraction.py
=====================================================

Standing workflow: validates extracted financial facts against source-document
ground truth for the four reference deals.

For each deal and each metric it checks three pipeline layers:
  Layer 1 — EXTRACTION   : is the correct value present in financial_facts_v1?
  Layer 2 — NOISE        : are values that should be absent still present?
  Layer 3 — REPORT       : does the /report payload surface the correct value?

Ground truth is loaded from evaluation/ground_truth/<Deal>.json
(validation.extraction_checks, validation.noise_checks, validation.report_checks).

Usage
-----
  # All four reference deals
  python evaluation/scripts/validate_financial_extraction.py

  # Single deal
  python evaluation/scripts/validate_financial_extraction.py --deal StackFactor

  # Write report to file
  python evaluation/scripts/validate_financial_extraction.py --output tmp/validation_run.md

  # Use a non-default DB or API endpoint
  DATABASE_URL="postgresql://..." API_BASE_URL="http://..." python ...

Requirements
------------
  pip install psycopg2-binary          # already in .venv
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
import urllib.request
import urllib.error

try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    print("ERROR: psycopg2 not found. Run: pip install psycopg2-binary", file=sys.stderr)
    sys.exit(1)

# ─── Paths ────────────────────────────────────────────────────────────────────

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
GROUND_TRUTH_DIR = REPO_ROOT / "evaluation" / "ground_truth"

DEFAULT_DB_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://postgres:postgres@localhost:55433/dealdecision",
)
API_BASE = os.environ.get("API_BASE_URL", "http://localhost:9001")

# ─── Reference deals ─────────────────────────────────────────────────────────

REFERENCE_DEALS: dict[str, dict] = {
    "DealDecision": {
        "deal_id":          "517be946-cab9-4bc1-8982-9522ff9dab32",
        "ground_truth_file": "Deal Decision.json",
    },
    "StackFactor": {
        "deal_id":          "adb2a1cf-bbb1-4f3b-8735-e2249415124f",
        "ground_truth_file": "StackFactor.json",
    },
    "WebMax": {
        "deal_id":          "23b2fa42-e6d1-4aa3-8fbc-f7aa083846e4",
        "ground_truth_file": "WebMax.json",
    },
    "Qredible": {
        "deal_id":          "b21b894e-4020-46bd-b753-93b2d2d5fa8f",
        "ground_truth_file": "Qredible.json",
    },
    # ── Synthetic fixture deals ───────────────────────────────────────────────
    # These have no live DB row. The validate script runs spec coherence checks
    # (Layer 0) instead of DB / API checks.
    # Behavioral assertions live in the corresponding Vitest test file.
    # See evaluation/ground_truth/ONBOARDING_CHECKLIST.md.
    "SyntheticActuals": {        # REF-DEAL-5: actuals + forecast in same XLSX
        "deal_id":           "00000000-0000-4000-8000-000000000001",
        "ground_truth_file": "SyntheticActuals.json",
    },
    "SyntheticKPI": {            # REF-DEAL-6: deck-only with KPI tiles and heavy noise
        "deal_id":           "00000000-0000-4000-8000-000000000002",
        "ground_truth_file": "SyntheticKPI.json",
    },
    "SyntheticQuarterly": {      # REF-DEAL-7: quarterly actuals + mixed denomination + GBP burn
        "deal_id":           "00000000-0000-4000-8000-000000000003",
        "ground_truth_file": "SyntheticQuarterly.json",
    },
}

# ─── DB helpers ───────────────────────────────────────────────────────────────

def db_connect(db_url: str) -> psycopg2.extensions.connection:
    conn = psycopg2.connect(db_url, cursor_factory=psycopg2.extras.RealDictCursor)
    conn.set_session(readonly=True, autocommit=True)
    return conn


def q(conn, sql: str, params: tuple = ()) -> list[dict]:
    with conn.cursor() as cur:
        cur.execute(sql, params)
        return [dict(r) for r in cur.fetchall()]


# ─── API helpers ──────────────────────────────────────────────────────────────

def fetch_report(deal_id: str) -> dict | None:
    """Fetch the compiled /report for a deal from the running API."""
    url = f"{API_BASE}/api/v1/deals/{deal_id}/report"
    try:
        with urllib.request.urlopen(url, timeout=10) as resp:
            d = json.load(resp)
        # The report fields live under d["report"]; top-level has compiler version etc.
        return d
    except urllib.error.HTTPError as e:
        print(f"  [WARN] HTTP {e.code} fetching report for {deal_id}", file=sys.stderr)
        return None
    except Exception as e:
        print(f"  [WARN] Could not fetch report for {deal_id}: {e}", file=sys.stderr)
        return None


def nav(obj: Any, *path: str | int) -> Any:
    """Safely navigate a nested dict/list by a variable-length path."""
    for key in path:
        if obj is None:
            return None
        if isinstance(obj, dict):
            obj = obj.get(str(key))
        elif isinstance(obj, list):
            try:
                obj = obj[int(key)]
            except (IndexError, ValueError):
                return None
        else:
            return None
    return obj


# ─── Layer checks ─────────────────────────────────────────────────────────────

def _closest_value(rows: list[dict], target: float) -> str:
    """Return the closest numeric value found in a list of financial_facts rows."""
    best = None
    best_delta = float("inf")
    for row in rows:
        v = row.get("value")
        if v is None:
            continue
        try:
            fv = float(v)
            delta = abs(fv - target)
            if delta < best_delta:
                best_delta = delta
                best = fv
        except (ValueError, TypeError):
            continue
    if best is None:
        return "no numeric values found"
    return f"{best:,.0f}"


def check_extraction(
    conn,
    deal_id: str,
    metric_key: str,
    expected_value: float | None,
    tolerance_pct: float = 15,
    allowed_source_kinds: list[str] | None = None,
) -> tuple[bool, list[dict], str]:
    """
    Layer 1 — EXTRACTION
    Checks whether the expected value appears anywhere in financial_facts_v1
    for this deal and metric_key, with optional source_kind filter.

    Returns (passed, matching_rows, message).
    """
    rows = q(conn, """
        SELECT fact_id, metric_key, period_label, period_type,
               value, unit, source_kind, confidence, sheet_name
        FROM financial_facts_v1
        WHERE deal_id = %s AND metric_key = %s
        ORDER BY confidence DESC, source_kind
    """, (deal_id, metric_key))

    if expected_value is None:
        if not rows:
            return True, rows, "PASS — no facts present (expected absent)"
        return False, rows, f"FAIL — found {len(rows)} fact(s) but expected none"

    if not rows:
        return False, rows, f"FAIL — 0 facts found for metric '{metric_key}'"

    low  = expected_value * (1 - tolerance_pct / 100)
    high = expected_value * (1 + tolerance_pct / 100)

    candidates = rows if not allowed_source_kinds else [
        r for r in rows if r.get("source_kind") in allowed_source_kinds
    ]
    for row in candidates:
        v = row.get("value")
        if v is None:
            continue
        try:
            fv = float(v)
        except (ValueError, TypeError):
            continue
        if low <= fv <= high:
            return True, rows, f"PASS — found {fv:,.0f} (expected ~{expected_value:,.0f}, ±{tolerance_pct}%)"

    closest = _closest_value(candidates if candidates else rows, expected_value)
    scope = f" in source_kinds {allowed_source_kinds}" if allowed_source_kinds else ""
    return (
        False, rows,
        f"FAIL — expected ~{expected_value:,.0f}{scope}; closest found = {closest}"
    )


def check_noise(
    conn,
    deal_id: str,
    sql_filter: str,
    expected_count: int = 0,
) -> tuple[bool, int, str]:
    """
    Layer 1b — NOISE
    Counts rows in financial_facts_v1 matching a noise pattern.
    The sql_filter is appended after `deal_id = %s AND `.

    Returns (passed, actual_count, message).
    """
    # Escape bare % signs so psycopg2 doesn't treat them as param placeholders.
    # We still inject deal_id via %s (the one real placeholder).
    safe_filter = sql_filter.replace("%", "%%")
    rows = q(conn, f"""
        SELECT COUNT(*) AS c
        FROM financial_facts_v1
        WHERE deal_id = %s AND {safe_filter}
    """, (deal_id,))
    actual = int(rows[0]["c"]) if rows else 0
    passed = actual == expected_count
    if passed:
        return True, actual, f"PASS — count={actual} (expected {expected_count})"
    return False, actual, f"FAIL — count={actual} (expected {expected_count})"


def check_report_field(
    report_data: dict | None,
    path: list[str],
    expected_value: float | None = None,
    tolerance_pct: float = 15,
    expected_string: str | None = None,
    expected_absent: bool = False,
) -> tuple[bool, Any, str]:
    """
    Layer 3 — COMPILER / REPORT
    Navigates the /report JSON by the given path and compares to expected.

    Modes:
      expected_value   — numeric comparison with tolerance.
      expected_string + expected_absent=True — the string should NOT be present.
      expected_value=None (no string) — check the field is null/absent.
    """
    if report_data is None:
        return False, None, "FAIL — report not available (API down or deal not found)"

    report = report_data.get("report", {})
    obj = nav(report, *path)

    # Null / absent check
    if expected_value is None and expected_string is None and not expected_absent:
        if obj is None:
            return True, None, "PASS — field is null as expected"
        return False, obj, f"FAIL — expected null but found: {obj!r}"

    # String-absent check (e.g., source_kind should NOT be 'deck')
    if expected_string is not None and expected_absent:
        actual_str = str(obj) if obj is not None else None
        if actual_str != expected_string:
            return True, actual_str, f"PASS — field is '{actual_str}' (not '{expected_string}')"
        return False, actual_str, f"FAIL — field is '{actual_str}' but should not be"

    # Numeric check
    if expected_value is not None:
        if obj is None:
            return False, None, f"FAIL — field is null, expected ~{expected_value:,.0f}"

        # Unwrap common envelope shapes
        actual: float | None = None
        if isinstance(obj, (int, float)):
            actual = float(obj)
        elif isinstance(obj, dict):
            for key in ("value", "amount"):
                v = obj.get(key)
                if v is not None:
                    try:
                        actual = float(v)
                        break
                    except (ValueError, TypeError):
                        pass

        if actual is None:
            return False, obj, f"FAIL — could not extract numeric from: {obj!r}"

        low  = expected_value * (1 - tolerance_pct / 100)
        high = expected_value * (1 + tolerance_pct / 100)
        if low <= actual <= high:
            return True, actual, f"PASS — {actual:,.0f} within ±{tolerance_pct}% of {expected_value:,.0f}"
        return False, actual, f"FAIL — {actual:,.0f} is outside ±{tolerance_pct}% of {expected_value:,.0f}"

    return False, obj, "FAIL — no valid comparison criteria configured"


# ─── Spec coherence checks (synthetic fixture mode) ──────────────────────────

_PLACEHOLDER_MARKERS = ("__FILL", "__PLACEHOLDER", "FILL IN")


def _is_placeholder(v: Any) -> bool:
    """Return True if the value looks like an unfilled placeholder."""
    if v is None:
        return False
    if isinstance(v, str):
        return any(m in v for m in _PLACEHOLDER_MARKERS)
    return False


def check_spec_coherence(gt: dict) -> list[tuple[bool, str, str]]:
    """
    Layer 0 — SPEC COHERENCE (synthetic fixture mode)

    Verifies that all check specs in the ground truth JSON are fully populated
    (no remaining __FILL IN__ placeholders, concrete expected_values, valid paths).

    Returns a list of (passed, label, message) tuples.
    """
    results: list[tuple[bool, str, str]] = []
    validation = (gt.get("financials") or {}).get("validation") or {}

    for i, chk in enumerate(validation.get("extraction_checks", [])):
        metric = chk.get("metric_key", f"#check{i}")
        label = f"[SPEC] extraction_checks[{i}] {metric}"
        ev = chk.get("expected_value")
        if _is_placeholder(ev):
            results.append((False, label, f"FAIL — expected_value is still a placeholder: {ev!r}"))
        elif ev is None and chk.get("note", "").lower().find("absent") == -1:
            results.append((False, label, "FAIL — expected_value is null without an 'absent' intent note"))
        elif not isinstance(ev, (int, float)) and ev is not None:
            results.append((False, label, f"FAIL — expected_value must be numeric, got {type(ev).__name__}: {ev!r}"))
        else:
            results.append((True, label, f"PASS — expected_value={ev} (concrete)"))

    for i, chk in enumerate(validation.get("noise_checks", [])):
        lab = chk.get("label", f"#noise{i}")
        label = f"[SPEC] noise_checks[{i}] '{lab}'"
        sql = chk.get("sql_filter", "")
        if not sql or _is_placeholder(sql):
            results.append((False, label, f"FAIL — sql_filter is empty or placeholder: {sql!r}"))
        else:
            results.append((True, label, f"PASS — sql_filter is concrete"))

    for i, chk in enumerate(validation.get("report_checks", [])):
        lab = chk.get("label", f"#report{i}")
        label = f"[SPEC] report_checks[{i}] '{lab}'"
        path = chk.get("report_path", [])
        ev = chk.get("expected_value")
        es = chk.get("expected_string")
        absent = chk.get("expected_absent", False)

        if not path:
            results.append((False, label, "FAIL — report_path is empty"))
            continue
        if _is_placeholder(ev) or _is_placeholder(es):
            results.append((False, label, f"FAIL — expected_value or expected_string is a placeholder"))
            continue
        if ev is None and es is None and not absent and not (ev is None and not es and not absent):
            results.append((False, label, "FAIL — no expected_value, expected_string, or expected_absent=True defined"))
            continue
        results.append((True, label, f"PASS — report_path={path}, criteria defined"))

    # Confirm deal_id and _synthetic flag are present
    deal_id = gt.get("deal_id", "")
    label_id = "[SPEC] deal_id is concrete"
    if not deal_id or _is_placeholder(deal_id):
        results.append((False, label_id, f"FAIL — deal_id is placeholder or missing: {deal_id!r}"))
    else:
        results.append((True, label_id, f"PASS — deal_id={deal_id}"))

    return results


# ─── Per-deal runner ──────────────────────────────────────────────────────────

LAYER_LABEL = {
    "extraction":       "L1-EXTRACTION",
    "noise":            "L2-NOISE",
    "truth_resolution": "L2-TRUTH",
    "compiler":         "L3-COMPILER",
    "scoring":          "L4-SCORING",
}


def run_deal_validation(
    deal_name: str,
    deal_cfg: dict,
    conn,
) -> dict:
    """Run all validation checks for one deal. Returns a result dict."""
    deal_id = deal_cfg["deal_id"]
    gt_file = GROUND_TRUTH_DIR / deal_cfg["ground_truth_file"]

    result: dict = {
        "deal_name":      deal_name,
        "deal_id":        deal_id,
        "run_ts":         datetime.now(timezone.utc).isoformat(),
        "pass_count":     0,
        "fail_count":     0,
        "findings":       [],
        "error":          None,
    }

    # Load ground truth
    if not gt_file.exists():
        result["error"] = f"Ground truth file not found: {gt_file}"
        return result
    try:
        gt = json.loads(gt_file.read_text())
    except Exception as e:
        result["error"] = f"Could not parse ground truth: {e}"
        return result

    validation = (gt.get("financials") or {}).get("validation")
    if not validation:
        result["error"] = "No 'financials.validation' section in ground truth file"
        return result

    # ── Synthetic fixture mode ─────────────────────────────────────────────────
    # When a ground truth file has "_synthetic": true, the deal has no live DB row.
    # Skip DB/API checks; run spec coherence (Layer 0) instead.
    if gt.get("_synthetic"):
        coherence_results = check_spec_coherence(gt)
        for passed, label, message in coherence_results:
            tag = "PASS" if passed else "FAIL"
            result["findings"].append({
                "label":   label,
                "layer":   "L0-SPEC",
                "status":  tag,
                "value":   None,
                "message": message,
                "note":    "synthetic fixture — no live DB row",
            })
            if passed:
                result["pass_count"] += 1
            else:
                result["fail_count"] += 1
        result["findings"].append({
            "label":   "[INFO] Behavioral tests",
            "layer":   "L0-SPEC",
            "status":  "INFO",
            "value":   None,
            "message": "Behavioral validation in apps/worker/src/lib/financial-facts/__tests__/synthetic-actuals-fixture.test.ts",
            "note":    "Run: pnpm vitest run --testPathPattern synthetic-actuals-fixture",
        })
        return result

    # Fetch report once per deal
    report_data = fetch_report(deal_id)

    def record(label: str, layer_key: str, passed: bool, value: Any, message: str, note: str = ""):
        tag = "PASS" if passed else "FAIL"
        finding = {
            "label":   label,
            "layer":   LAYER_LABEL.get(layer_key, layer_key.upper()),
            "status":  tag,
            "value":   value,
            "message": message,
            "note":    note,
        }
        result["findings"].append(finding)
        if passed:
            result["pass_count"] += 1
        else:
            result["fail_count"] += 1

    # ── Layer 1: Extraction checks ────────────────────────────────────────────
    for chk in validation.get("extraction_checks", []):
        metric_key = chk["metric_key"]
        expected   = chk.get("expected_value")
        tol        = chk.get("tolerance_pct", 15)
        source_ks  = chk.get("allowed_source_kinds")
        note       = chk.get("note", "")
        label      = f"Extract {metric_key} ≈ {expected:,.0f}" if expected is not None else f"Extract {metric_key} absent"

        passed, rows, msg = check_extraction(conn, deal_id, metric_key, expected, tol, source_ks)
        found_val = _closest_value(rows, expected) if expected is not None and rows else ("absent" if not rows else f"{len(rows)} rows")
        record(label, "extraction", passed, found_val, msg, note)

    # ── Layer 1b: Noise checks ────────────────────────────────────────────────
    for chk in validation.get("noise_checks", []):
        label      = chk.get("label", "noise check")
        sql_filter = chk["sql_filter"]
        expected_n = chk.get("expected_count", 0)
        layer      = chk.get("failure_layer", "extraction")
        description = chk.get("description", chk.get("fix_ref", ""))

        passed, actual_n, msg = check_noise(conn, deal_id, sql_filter, expected_n)
        record(label, layer, passed, actual_n, msg, description)

    # ── Layer 3: Report / compiler checks ────────────────────────────────────
    for chk in validation.get("report_checks", []):
        label          = chk.get("label", "report check")
        path           = chk.get("report_path", [])
        expected_value = chk.get("expected_value")  # None means "should be null"
        tol            = chk.get("tolerance_pct", 15)
        exp_string     = chk.get("expected_string")
        exp_absent     = chk.get("expected_absent", False)
        layer          = chk.get("failure_layer", "compiler")
        note           = chk.get("note", "")

        passed, actual_val, msg = check_report_field(
            report_data, path, expected_value, tol, exp_string, exp_absent
        )
        record(label, layer, passed, actual_val, msg, note)

    return result


# ─── Markdown report ──────────────────────────────────────────────────────────

LAYER_ORDER = ["L1-EXTRACTION", "L2-NOISE", "L2-TRUTH", "L3-COMPILER", "L4-SCORING"]
STATUS_EMOJI = {"PASS": "✅", "FAIL": "❌", "INFO": "ℹ️"}


def format_deal_section(r: dict) -> str:
    lines: list[str] = []
    name = r["deal_name"]
    p, f = r["pass_count"], r["fail_count"]
    total = p + f
    pct = int(p / total * 100) if total else 0
    health = "🟢" if f == 0 else ("🟡" if f <= 2 else "🔴")
    lines.append(f"### {health} {name}  ({p}/{total} checks passing, {pct}%)\n")
    lines.append(f"_{r['deal_id']}_\n")

    if r.get("error"):
        lines.append(f"> **Error:** {r['error']}\n")
        return "\n".join(lines)

    # Table
    lines.append("| Status | Layer | Check | Value Found | Note |")
    lines.append("| --- | --- | --- | --- | --- |")
    for f_ in r["findings"]:
        emoji = STATUS_EMOJI.get(f_["status"], f_["status"])
        val_str = str(f_["value"])[:50] if f_["value"] is not None else "—"
        note_str = str(f_["note"])[:60] if f_["note"] else ""
        lines.append(
            f"| {emoji} | `{f_['layer']}` | {f_['label']} | {val_str} | {note_str} |"
        )
    lines.append("")
    return "\n".join(lines)


def format_cross_deal_summary(results: list[dict]) -> str:
    lines: list[str] = []
    lines.append("## Cross-deal summary\n")
    lines.append("| Deal | Pass | Fail | Status |")
    lines.append("| --- | --- | --- | --- |")
    total_p = total_f = 0
    for r in results:
        p, f = r["pass_count"], r["fail_count"]
        total_p += p
        total_f += f
        icon = "🟢 All pass" if f == 0 else f"🔴 {f} failing"
        lines.append(f"| {r['deal_name']} | {p} | {f} | {icon} |")
    lines.append(f"| **TOTAL** | **{total_p}** | **{total_f}** | |")
    lines.append("")

    # Collect unique open issues
    fails = [
        (r["deal_name"], f_)
        for r in results
        for f_ in r["findings"]
        if f_["status"] == "FAIL"
    ]
    if fails:
        lines.append("### Open issues\n")
        for deal_name, f_ in fails:
            lines.append(f"- **[{f_['layer']}]** {deal_name} — {f_['label']}: {f_['message']}")
        lines.append("")

    return "\n".join(lines)


def format_report(results: list[dict], run_ts: str) -> str:
    lines: list[str] = [
        "# Financial Extraction Validation Report",
        f"**Run:** {run_ts}  ",
        f"**Deals checked:** {len(results)}  ",
        "**Layers:** L1=Extraction | L2=Noise/Truth | L3=Compiler/Report  ",
        "",
        "---",
        "",
        format_cross_deal_summary(results),
        "---",
        "",
        "## Per-deal results",
        "",
    ]
    for r in results:
        lines.append(format_deal_section(r))
        lines.append("---")
        lines.append("")
    return "\n".join(lines)


# ─── Entrypoint ───────────────────────────────────────────────────────────────

def main() -> int:
    parser = argparse.ArgumentParser(
        description="Validate financial extraction against source-document ground truth"
    )
    parser.add_argument(
        "--deal",
        metavar="NAME",
        help="Run only this deal (DealDecision|StackFactor|WebMax|Qredible)",
    )
    parser.add_argument(
        "--output",
        metavar="FILE",
        help="Write markdown report to FILE instead of stdout",
    )
    parser.add_argument(
        "--db",
        default=DEFAULT_DB_URL,
        metavar="URL",
        help=f"Postgres URL (default: {DEFAULT_DB_URL})",
    )
    args = parser.parse_args()

    run_ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    # Connect to DB
    try:
        conn = db_connect(args.db)
    except Exception as e:
        print(f"ERROR: could not connect to DB: {e}", file=sys.stderr)
        return 1

    # Select deals
    if args.deal:
        if args.deal not in REFERENCE_DEALS:
            print(f"ERROR: unknown deal '{args.deal}'. Choose from: {list(REFERENCE_DEALS)}", file=sys.stderr)
            return 1
        deals = {args.deal: REFERENCE_DEALS[args.deal]}
    else:
        deals = REFERENCE_DEALS

    results = []
    for name, cfg in deals.items():
        print(f"  Checking {name}...", file=sys.stderr)
        r = run_deal_validation(name, cfg, conn)
        results.append(r)

    conn.close()

    report_md = format_report(results, run_ts)

    if args.output:
        out_path = Path(args.output)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(report_md, encoding="utf-8")
        print(f"Report written to {out_path}", file=sys.stderr)
    else:
        print(report_md)

    # Exit code: 0 = all pass, 1 = any failures
    any_fail = any(r["fail_count"] > 0 for r in results)
    return 1 if any_fail else 0


if __name__ == "__main__":
    sys.exit(main())
