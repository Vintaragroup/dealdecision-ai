"""
evaluation/pipeline_regression/checker.py
==========================================

Phase 3 + 4 + 5 — Normalize ground_truth_v1 checks and execute them
against live system outputs.

Check categories
----------------
  extraction_checks  — query financial_facts_v1 for expected metric values
  noise_checks       — either SQL-count guard or report path value guard
  report_checks      — navigate the API report JSON by path
  dio_checks         — navigate the DIO JSON (dio_data.dio.{path})
  evidence_checks    — inspect promoted_facts in API report

Outcome classification
----------------------
  PASS          — check passes
  FAIL          — check fails (may be known issue)
  SKIP          — check could not execute (missing data)
  KNOWN_ISSUE   — check fails in a way that matches a documented known issue
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Optional

# ─────────────────────────────────────────────────────────────────────────────
# Outcome constants
# ─────────────────────────────────────────────────────────────────────────────

PASS        = "PASS"
FAIL        = "FAIL"
SKIP        = "SKIP"
KNOWN_ISSUE = "KNOWN_ISSUE"


# ─────────────────────────────────────────────────────────────────────────────
# Result types
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class CheckResult:
    category:      str         # extraction | noise | report | dio | evidence
    label:         str
    outcome:       str         # PASS | FAIL | SKIP | KNOWN_ISSUE
    actual:        Any
    expected_desc: str
    note:          str   = ""
    diff_snippet:  str   = ""
    known_issue_ref: str = ""   # e.g. "BUG-RE-1"


@dataclass
class CaseResult:
    gt_name:        str
    deal_id:        Optional[str]
    gt_path:        str
    mapping_status: str
    mapping_note:   str
    checks:         list[CheckResult] = field(default_factory=list)
    fetch_error:    Optional[str]     = None

    # Computed lazily
    @property
    def pass_count(self)         -> int: return sum(1 for c in self.checks if c.outcome == PASS)
    @property
    def fail_count(self)         -> int: return sum(1 for c in self.checks if c.outcome == FAIL)
    @property
    def known_issue_count(self)  -> int: return sum(1 for c in self.checks if c.outcome == KNOWN_ISSUE)
    @property
    def skip_count(self)         -> int: return sum(1 for c in self.checks if c.outcome == SKIP)
    @property
    def total_checks(self)       -> int: return len(self.checks)

    @property
    def overall_status(self) -> str:
        if self.mapping_status != "mapped":
            return "UNMAPPED"
        if self.fetch_error:
            return "ERROR"
        if self.fail_count > 0:
            return "FAIL"
        if self.pass_count == 0 and self.skip_count > 0:
            return "SKIP"
        return "PASS"


# ─────────────────────────────────────────────────────────────────────────────
# Path navigation helpers
# ─────────────────────────────────────────────────────────────────────────────

_MISSING = object()  # sentinel


def _nav(obj: Any, path: list[str]) -> Any:
    """Navigate a nested dict/list with a path like ['a','b','c']. Returns _MISSING if not found."""
    cur = obj
    for key in path:
        if cur is _MISSING or cur is None:
            return _MISSING
        if isinstance(cur, dict):
            if key in cur:
                cur = cur[key]
            else:
                return _MISSING
        elif isinstance(cur, list):
            try:
                cur = cur[int(key)]
            except (ValueError, IndexError):
                return _MISSING
        else:
            return _MISSING
    return cur


def _nav_dio(dio_data: dict, path: list[str]) -> Any:
    """
    Navigate a DIO check path.  The convention in GT files is:
      ["phase1", ...]      → dio_data["dio"]["phase1"][...]
      ["dio_context", ...] → dio_data["dio_context"][...]
    """
    if not path:
        return _MISSING
    first = path[0]
    if first == "phase1":
        base = (dio_data.get("dio") or {})
        return _nav(base, path)
    elif first == "dio_context":
        return _nav(dio_data, path)
    else:
        # Try top-level first, then under "dio"
        result = _nav(dio_data, path)
        if result is not _MISSING:
            return result
        return _nav(dio_data.get("dio") or {}, path)


# ─────────────────────────────────────────────────────────────────────────────
# Value comparison helpers
# ─────────────────────────────────────────────────────────────────────────────

def _within_tolerance(actual: Any, expected: float, pct: float) -> bool:
    """Return True if actual is within pct% of expected."""
    try:
        a = float(actual)
        if expected == 0:
            return a == 0
        return abs(a - expected) / abs(expected) <= pct / 100.0
    except (TypeError, ValueError):
        return False


def _string_contains(actual: Any, substring: str) -> bool:
    """Case-insensitive substring match."""
    return isinstance(actual, str) and substring.lower() in actual.lower()


def _is_null_or_missing(val: Any) -> bool:
    return val is None or val is _MISSING


# ─────────────────────────────────────────────────────────────────────────────
# Known-issue matcher
# ─────────────────────────────────────────────────────────────────────────────

def _match_known_issue(check_label: str, gt: dict, check_note: str = "") -> Optional[str]:
    """
    Return a known-issue reference (e.g. "BUG-RE-1") if the failing check label
    matches a documented known issue in the GT file.
    Searches _failure_modes_targeted and financials.known_issues.

    Priority:
    1. BUG-IDs explicitly cited in check_note matched against GT failure modes
    2. Word-overlap on check_label vs _failure_modes_targeted
    3. Word-overlap on check_label vs known_issues keys
    """
    # 1. BUG-ID extraction from check note (e.g. "BUG-RE-3")
    if check_note:
        note_bugs = re.findall(r'BUG-[\w-]+', check_note, re.IGNORECASE)
        for bug_ref in note_bugs:
            norm = bug_ref.upper().replace("-", "_")
            # Match against _failure_modes_targeted
            for item in gt.get("_failure_modes_targeted") or []:
                if bug_ref.upper() in item.upper():
                    return bug_ref.upper()
            # Match against known_issues keys
            fin = gt.get("financials") or {}
            for ki_key in (fin.get("known_issues") or {}).keys():
                if norm in ki_key.upper():
                    return bug_ref.upper()
            # Explicit BUG note with no GT match — still a known issue
            return bug_ref.upper()

    # 2. Word-overlap on label vs _failure_modes_targeted
    for item in gt.get("_failure_modes_targeted") or []:
        check_words = set(re.findall(r'\w+', check_label.lower()))
        item_words  = set(re.findall(r'\w+', item.lower()))
        if len(check_words & item_words) >= 2:
            # Extract BUG id if present
            m = re.search(r'BUG-\w+-\w+', item, re.IGNORECASE)
            return m.group(0) if m else "known_failure_mode"

    # 3. Word-overlap on label vs known_issues keys
    fin = gt.get("financials") or {}
    for ki_key, ki_val in (fin.get("known_issues") or {}).items():
        ki_words = set(re.findall(r'\w+', ki_key.lower()))
        check_words = set(re.findall(r'\w+', check_label.lower()))
        if len(check_words & ki_words) >= 2:
            m = re.search(r'BUG-\w+-\w+', ki_key, re.IGNORECASE)
            return m.group(0) if m else ki_key

    return None


# ─────────────────────────────────────────────────────────────────────────────
# Individual check executors
# ─────────────────────────────────────────────────────────────────────────────

def _eval_extraction_check(
    check: dict,
    facts: list[dict],
    gt: dict,
) -> CheckResult:
    """
    extraction_check shape:
      metric_key: str
      expected_value: float | null
      tolerance_pct: float  (default 20)
      allowed_source_kinds: list[str]  (optional)
      note: str
    """
    metric_key = check.get("metric_key", "?")
    label = f"extraction:{metric_key}"
    note  = check.get("note", "")

    # Filter facts for this metric
    matching = [f for f in facts if f.get("metric_key") == metric_key]
    if not matching:
        return CheckResult(
            category="extraction",
            label=label,
            outcome=SKIP,
            actual=None,
            expected_desc=f"{metric_key} = {check.get('expected_value')}",
            note=f"No financial_facts_v1 rows for metric_key='{metric_key}'. {note}",
        )

    expected = check.get("expected_value")
    tol      = float(check.get("tolerance_pct", 20))
    allowed  = check.get("allowed_source_kinds")

    # If expected_value is null, check that NO non-null facts exist
    if expected is None:
        non_null = [f for f in matching if f.get("value") is not None]
        if non_null:
            outcome = FAIL
            actual  = non_null[0].get("value")
            ki      = _match_known_issue(label, gt, note)
            if ki:
                outcome = KNOWN_ISSUE
            return CheckResult(
                category="extraction",
                label=label,
                outcome=outcome,
                actual=actual,
                expected_desc=f"{metric_key} should be null / absent",
                note=note,
                diff_snippet=f"Found {len(non_null)} non-null fact(s); first value={actual}",
                known_issue_ref=ki or "",
            )
        return CheckResult(
            category="extraction",
            label=label,
            outcome=PASS,
            actual=None,
            expected_desc=f"{metric_key} should be null",
            note=note,
        )

    # Best row: prefer highest numeric confidence, then first
    def _conf_sort(f: dict) -> float:
        c = f.get("confidence")
        try:
            return float(c)
        except Exception:
            # string confidence levels
            return {"high": 0.9, "medium": 0.7, "low": 0.4}.get(str(c).lower(), 0.5)

    best = sorted(matching, key=_conf_sort, reverse=True)[0]
    actual_val = best.get("value")

    # Source kind check
    if allowed:
        sk = best.get("source_kind", "")
        if sk not in allowed:
            ki = _match_known_issue(label, gt, note)
            return CheckResult(
                category="extraction",
                label=label,
                outcome=KNOWN_ISSUE if ki else FAIL,
                actual=f"{actual_val} (source_kind={sk})",
                expected_desc=f"{metric_key} ≈ {expected} from source_kinds={allowed}",
                note=note,
                diff_snippet=f"source_kind='{sk}' not in allowed={allowed}",
                known_issue_ref=ki or "",
            )

    # Value tolerance check
    if not _within_tolerance(actual_val, float(expected), tol):
        ki = _match_known_issue(label, gt, note)
        return CheckResult(
            category="extraction",
            label=label,
            outcome=KNOWN_ISSUE if ki else FAIL,
            actual=actual_val,
            expected_desc=f"{metric_key} ≈ {expected} (±{tol}%)",
            note=note,
            diff_snippet=f"actual={actual_val}, expected={expected}, tol={tol}%",
            known_issue_ref=ki or "",
        )

    return CheckResult(
        category="extraction",
        label=label,
        outcome=PASS,
        actual=actual_val,
        expected_desc=f"{metric_key} ≈ {expected} (±{tol}%)",
        note=note,
    )


def _eval_noise_check(
    check: dict,
    report: Optional[dict],
    facts: list[dict],
    deal_id: str,
    gt: dict,
    db_url: str,
) -> CheckResult:
    """
    Two noise_check shapes:

    SQL-count shape:
      label: str
      sql_filter: str
      expected_count: int
      failure_layer: str

    Report-path shape:
      label: str
      report_path: list[str]
      expected_max | expected_string | expected_value: ...
      failure_layer: str

    Also handles:
      expected_max_count (for list paths like promoted_facts)
    """
    from loader import run_noise_sql  # local import to avoid circular

    label = check.get("label", "noise_check")
    note  = check.get("note", check.get("description", ""))

    # ── SQL-count shape ───────────────────────────────────────────────────────
    if "sql_filter" in check:
        expected_count = check.get("expected_count", 0)
        actual_count   = run_noise_sql(deal_id, check["sql_filter"], db_url)
        if actual_count < 0:
            return CheckResult(
                category="noise",
                label=label,
                outcome=SKIP,
                actual=None,
                expected_desc=f"count({check['sql_filter']}) == {expected_count}",
                note=f"SQL query errored. {note}",
            )
        outcome = PASS if actual_count == expected_count else FAIL
        ki = _match_known_issue(label, gt, note) if outcome == FAIL else None
        if ki:
            outcome = KNOWN_ISSUE
        return CheckResult(
            category="noise",
            label=label,
            outcome=outcome,
            actual=actual_count,
            expected_desc=f"count == {expected_count}",
            note=note,
            diff_snippet="" if outcome == PASS else f"actual count={actual_count}, expected={expected_count}",
            known_issue_ref=ki or "",
        )

    # ── Report-path shape ─────────────────────────────────────────────────────
    if "report_path" in check:
        if report is None:
            return CheckResult(
                category="noise",
                label=label,
                outcome=SKIP,
                actual=None,
                expected_desc="(report unavailable)",
                note=note,
            )
        path  = check["report_path"]
        value = _nav(report, path)

        # expected_max_count — for list paths (e.g. promoted_facts)
        if "expected_max_count" in check:
            expected_max = check["expected_max_count"]
            actual_count = len(value) if isinstance(value, list) else (0 if _is_null_or_missing(value) else 1)
            outcome = PASS if actual_count <= expected_max else FAIL
            ki = _match_known_issue(label, gt, note) if outcome == FAIL else None
            if ki: outcome = KNOWN_ISSUE
            return CheckResult(
                category="noise",
                label=label,
                outcome=outcome,
                actual=actual_count,
                expected_desc=f"len({'.'.join(path)}) <= {expected_max}",
                note=note,
                diff_snippet="" if outcome == PASS else f"actual count={actual_count}, expected_max={expected_max}",
                known_issue_ref=ki or "",
            )

        # expected_max — numeric ceiling
        if "expected_max" in check:
            expected_max = check["expected_max"]
            actual_val   = None if _is_null_or_missing(value) else _extract_numeric(value)
            if actual_val is None:
                return CheckResult(
                    category="noise", label=label, outcome=SKIP, actual=value,
                    expected_desc=f"{'.'.join(path)} <= {expected_max}", note=note,
                )
            outcome = PASS if actual_val <= expected_max else FAIL
            ki = _match_known_issue(label, gt, note) if outcome == FAIL else None
            if ki: outcome = KNOWN_ISSUE
            return CheckResult(
                category="noise", label=label, outcome=outcome, actual=actual_val,
                expected_desc=f"<= {expected_max}", note=note,
                diff_snippet="" if outcome == PASS else f"actual={actual_val}, max={expected_max}",
                known_issue_ref=ki or "",
            )

        # expected_string — exact or substring
        if "expected_string" in check:
            return _check_string(value, check["expected_string"], label, "noise", path, note, gt)

        # expected_value — exact
        if "expected_value" in check:
            return _check_exact(value, check["expected_value"], label, "noise", path, note, gt)

    # ── Unknown shape ─────────────────────────────────────────────────────────
    return CheckResult(
        category="noise",
        label=label,
        outcome=SKIP,
        actual=None,
        expected_desc="unknown shape",
        note=f"noise_check has neither sql_filter nor supported report_path assertion. {note}",
    )


def _eval_report_check(check: dict, report: Optional[dict], gt: dict) -> CheckResult:
    """
    report_check shape:
      label: str
      report_path: list[str]
      One of:
        expected_string: str               exact match
        expected_string_contains: str      substring match
        expected_value: any                exact value (incl. null/bool)
        expected_absent: true              path must not exist or be null
        tolerance_pct: float + expected_value  numeric within tolerance
        expected_min: float                numeric lower bound
        expected_max: float                numeric upper bound
      failure_layer: str
      note: str
    """
    label = check.get("label", "report_check")
    note  = check.get("note", "")
    path  = check.get("report_path", [])

    if report is None:
        return CheckResult(
            category="report",
            label=label,
            outcome=SKIP,
            actual=None,
            expected_desc="(report unavailable)",
            note=note,
        )

    value = _nav(report, path)
    path_str = ".".join(str(p) for p in path)

    # expected_absent
    if check.get("expected_absent"):
        if "expected_string" in check:
            # Negation check: value must NOT equal this string.
            # e.g. { expected_string: "deck", expected_absent: true } → source must NOT be "deck"
            negate_val = check["expected_string"]
            is_bad = (not _is_null_or_missing(value)) and str(value) == negate_val
            outcome = FAIL if is_bad else PASS
            ki = _match_known_issue(label, gt, note) if outcome == FAIL else None
            if ki: outcome = KNOWN_ISSUE
            return CheckResult(
                category="report", label=label, outcome=outcome, actual=value,
                expected_desc=f"{path_str} must NOT be '{negate_val}'",
                note=note,
                diff_snippet="" if outcome == PASS else f"found value='{value}' which is the forbidden value",
                known_issue_ref=ki or "",
            )
        outcome = PASS if _is_null_or_missing(value) else FAIL
        ki = _match_known_issue(label, gt, note) if outcome == FAIL else None
        if ki: outcome = KNOWN_ISSUE
        return CheckResult(
            category="report", label=label, outcome=outcome, actual=value,
            expected_desc=f"{path_str} must be absent/null",
            note=note,
            diff_snippet="" if outcome == PASS else f"found value={repr(value)}",
            known_issue_ref=ki or "",
        )

    # expected_string (exact)
    if "expected_string" in check:
        return _check_string(value, check["expected_string"], label, "report", path, note, gt)

    # expected_string_contains (substring)
    if "expected_string_contains" in check:
        substr = check["expected_string_contains"]
        if _is_null_or_missing(value):
            outcome = FAIL
            ki = _match_known_issue(label, gt, note)
            if ki: outcome = KNOWN_ISSUE
            return CheckResult(
                category="report", label=label, outcome=outcome, actual=None,
                expected_desc=f"{path_str} contains '{substr}'",
                note=note, diff_snippet="path missing / null",
                known_issue_ref=ki or "",
            )
        outcome = PASS if _string_contains(value, substr) else FAIL
        ki = _match_known_issue(label, gt, note) if outcome == FAIL else None
        if ki: outcome = KNOWN_ISSUE
        return CheckResult(
            category="report", label=label, outcome=outcome, actual=value,
            expected_desc=f"{path_str} contains '{substr}'",
            note=note,
            diff_snippet="" if outcome == PASS else f"actual='{value}' does not contain '{substr}'",
            known_issue_ref=ki or "",
        )

    # expected_value with optional tolerance_pct
    if "expected_value" in check:
        tol = check.get("tolerance_pct")
        if tol is not None and check["expected_value"] is not None:
            num = _extract_numeric(value)
            if num is None:
                return CheckResult(
                    category="report", label=label, outcome=SKIP, actual=value,
                    expected_desc=f"{path_str} ≈ {check['expected_value']} ±{tol}%", note=note,
                )
            outcome = PASS if _within_tolerance(num, float(check["expected_value"]), float(tol)) else FAIL
            ki = _match_known_issue(label, gt, note) if outcome == FAIL else None
            if ki: outcome = KNOWN_ISSUE
            return CheckResult(
                category="report", label=label, outcome=outcome, actual=num,
                expected_desc=f"{path_str} ≈ {check['expected_value']} (±{tol}%)",
                note=note,
                diff_snippet="" if outcome == PASS else f"actual={num}, expected={check['expected_value']}",
                known_issue_ref=ki or "",
            )
        return _check_exact(value, check["expected_value"], label, "report", path, note, gt)

    # expected_min / expected_max — numeric bounds
    if "expected_min" in check or "expected_max" in check:
        num = _extract_numeric(value)
        if num is None:
            return CheckResult(
                category="report", label=label, outcome=SKIP, actual=value,
                expected_desc=f"{path_str} numeric bound check", note=note,
            )
        mn = check.get("expected_min")
        mx = check.get("expected_max")
        ok = (mn is None or num >= mn) and (mx is None or num <= mx)
        outcome = PASS if ok else FAIL
        ki = _match_known_issue(label, gt, note) if outcome == FAIL else None
        if ki: outcome = KNOWN_ISSUE
        desc = f"{path_str}"
        if mn is not None: desc += f" >= {mn}"
        if mx is not None: desc += f" <= {mx}"
        return CheckResult(
            category="report", label=label, outcome=outcome, actual=num,
            expected_desc=desc, note=note,
            diff_snippet="" if outcome == PASS else f"actual={num}",
            known_issue_ref=ki or "",
        )

    return CheckResult(
        category="report", label=label, outcome=SKIP, actual=_MISSING,
        expected_desc="unknown assertion type", note=note,
    )


def _eval_dio_check(check: dict, dio_data: Optional[dict], gt: dict) -> CheckResult:
    """
    dio_check shape — same comparison operators as report_check,
    but uses _nav_dio to resolve the path.
    Also supports report_path as alias for cases where the assertion is against
    the API report rather than the DIO (some checks use report_path in dio_checks).
    """
    label = check.get("label", "dio_check")
    note  = check.get("note", "")

    # Some dio_checks use report_path (lazy authoring) — return SKIP if they do
    # because they belong on report_checks.  We handle this gracefully.
    if "report_path" in check and "dio_path" not in check:
        return CheckResult(
            category="dio",
            label=label,
            outcome=SKIP,
            actual=None,
            expected_desc="(report_path in dio_check — moved to report_checks)",
            note=note,
        )

    path = check.get("dio_path", [])

    if dio_data is None:
        return CheckResult(
            category="dio", label=label, outcome=SKIP, actual=None,
            expected_desc="(DIO unavailable)", note=note,
        )

    value    = _nav_dio(dio_data, path)
    path_str = ".".join(str(p) for p in path)

    if "expected_string" in check:
        return _check_string(value, check["expected_string"], label, "dio", path, note, gt)

    if "expected_value" in check:
        return _check_exact(value, check["expected_value"], label, "dio", path, note, gt)

    if "expected_min" in check or "expected_max" in check:
        num = _extract_numeric(value)
        if num is None:
            return CheckResult(
                category="dio", label=label, outcome=SKIP, actual=value,
                expected_desc=f"{path_str} numeric bound", note=note,
            )
        mn = check.get("expected_min")
        mx = check.get("expected_max")
        ok = (mn is None or num >= mn) and (mx is None or num <= mx)
        outcome = PASS if ok else FAIL
        ki = _match_known_issue(label, gt, note) if outcome == FAIL else None
        if ki: outcome = KNOWN_ISSUE
        desc = path_str
        if mn is not None: desc += f" >= {mn}"
        if mx is not None: desc += f" <= {mx}"
        return CheckResult(
            category="dio", label=label, outcome=outcome, actual=num,
            expected_desc=desc, note=note,
            diff_snippet="" if outcome == PASS else f"actual={num}",
            known_issue_ref=ki or "",
        )

    if check.get("expected_absent"):
        outcome = PASS if _is_null_or_missing(value) else FAIL
        ki = _match_known_issue(label, gt, note) if outcome == FAIL else None
        if ki: outcome = KNOWN_ISSUE
        return CheckResult(
            category="dio", label=label, outcome=outcome, actual=value,
            expected_desc=f"{path_str} must be absent/null",
            note=note,
            diff_snippet="" if outcome == PASS else f"found value={repr(value)}",
            known_issue_ref=ki or "",
        )

    return CheckResult(
        category="dio", label=label, outcome=SKIP, actual=_MISSING,
        expected_desc="unknown assertion type", note=note,
    )


def _eval_evidence_check(
    check: dict,
    report: Optional[dict],
    dio_data: Optional[dict],
    gt: dict,
) -> CheckResult:
    """
    evidence_check shape:
      label: str
      report_path: list[str]  OR dio_path: list[str]
      fact_type: str  (filter promoted_facts by fact_type)
      expected_diagnostic:
        path: list[str]         within matched fact's value_json
        expected_value: any
        expected_contains: str  substring check on a list field
      note: str
    """
    label     = check.get("label", "evidence_check")
    note      = check.get("note", "")
    fact_type = check.get("fact_type")
    diag      = check.get("expected_diagnostic") or {}

    # Determine source object for navigation
    path = check.get("report_path") or check.get("dio_path") or []

    source_obj: Optional[dict] = None
    if "report_path" in check and report is not None:
        source_obj = report
    elif "dio_path" in check and dio_data is not None:
        source_obj = _nav_dio(dio_data, [])  # just use dio_data root
        path = check["dio_path"]

    if source_obj is None:
        return CheckResult(
            category="evidence", label=label, outcome=SKIP, actual=None,
            expected_desc="(source unavailable)", note=note,
        )

    if not fact_type:
        # Plain path-based evidence check (no promoted_facts filtering)
        value = _nav(source_obj, path) if "report_path" in check else _nav_dio(source_obj, path)
        if diag:
            return _eval_diagnostic(value, diag, label, note, gt)
        # Fall through to SKIP — missing assertion
        return CheckResult(
            category="evidence", label=label, outcome=SKIP, actual=value,
            expected_desc="no diagnostic assertion", note=note,
        )

    # Filter promoted_facts by fact_type
    promoted = _nav(report, ["promoted_facts"]) if report else []
    if not isinstance(promoted, list):
        return CheckResult(
            category="evidence", label=label, outcome=SKIP, actual=None,
            expected_desc=f"promoted_facts[fact_type={fact_type}]", note=note,
        )

    matching = [f for f in promoted if f.get("fact_type") == fact_type]
    if not matching:
        outcome = FAIL
        ki = _match_known_issue(label, gt, note)
        if ki: outcome = KNOWN_ISSUE
        return CheckResult(
            category="evidence", label=label, outcome=outcome, actual=None,
            expected_desc=f"promoted_fact fact_type='{fact_type}' must exist",
            note=note,
            diff_snippet=f"No promoted_facts with fact_type='{fact_type}'",
            known_issue_ref=ki or "",
        )

    # Navigate within matching fact
    fact = matching[0]
    if diag:
        diag_path = diag.get("path", [])
        diag_val  = _nav(fact, diag_path)
        return _eval_diagnostic(diag_val, diag, label, note, gt)

    return CheckResult(
        category="evidence", label=label, outcome=PASS, actual=fact.get("fact_type"),
        expected_desc=f"promoted_fact fact_type='{fact_type}' present",
        note=note,
    )


def _eval_diagnostic(value: Any, diag: dict, label: str, note: str, gt: dict) -> CheckResult:
    """Evaluate a diagnostic sub-assertion within an evidence_check."""
    diag_path_str = ".".join(str(p) for p in diag.get("path", []))

    if "expected_value" in diag:
        expected = diag["expected_value"]
        if isinstance(expected, bool):
            ok = value is expected or value == expected
        elif expected is None:
            ok = _is_null_or_missing(value)
        else:
            ok = str(value).lower() == str(expected).lower()
        outcome = PASS if ok else FAIL
        ki = _match_known_issue(label, gt, note) if outcome == FAIL else None
        if ki: outcome = KNOWN_ISSUE
        return CheckResult(
            category="evidence", label=label, outcome=outcome, actual=value,
            expected_desc=f"{diag_path_str} == {expected}",
            note=note,
            diff_snippet="" if outcome == PASS else f"actual={repr(value)}, expected={repr(expected)}",
            known_issue_ref=ki or "",
        )

    if "expected_contains" in diag:
        substr = diag["expected_contains"]
        if isinstance(value, list):
            ok = substr in value or any(isinstance(v, str) and substr.lower() in v.lower() for v in value)
        elif isinstance(value, str):
            ok = substr.lower() in value.lower()
        else:
            ok = False
        outcome = PASS if ok else FAIL
        ki = _match_known_issue(label, gt, note) if outcome == FAIL else None
        if ki: outcome = KNOWN_ISSUE
        return CheckResult(
            category="evidence", label=label, outcome=outcome, actual=value,
            expected_desc=f"{diag_path_str} contains '{substr}'",
            note=note,
            diff_snippet="" if outcome == PASS else f"actual={repr(value)} does not contain '{substr}'",
            known_issue_ref=ki or "",
        )

    return CheckResult(
        category="evidence", label=label, outcome=SKIP, actual=value,
        expected_desc="unknown diagnostic assertion", note=note,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Shared check helpers
# ─────────────────────────────────────────────────────────────────────────────

def _check_string(
    value: Any,
    expected: str,
    label: str,
    category: str,
    path: list,
    note: str,
    gt: dict,
) -> CheckResult:
    path_str = ".".join(str(p) for p in path)
    if _is_null_or_missing(value):
        outcome = FAIL
        ki = _match_known_issue(label, gt, note)
        if ki: outcome = KNOWN_ISSUE
        return CheckResult(
            category=category, label=label, outcome=outcome, actual=None,
            expected_desc=f"{path_str} == '{expected}'",
            note=note, diff_snippet="path missing / null",
            known_issue_ref=ki or "",
        )
    ok = str(value).lower() == str(expected).lower()
    outcome = PASS if ok else FAIL
    ki = _match_known_issue(label, gt, note) if outcome == FAIL else None
    if ki: outcome = KNOWN_ISSUE
    return CheckResult(
        category=category, label=label, outcome=outcome, actual=value,
        expected_desc=f"{path_str} == '{expected}'",
        note=note,
        diff_snippet="" if outcome == PASS else f"actual='{value}', expected='{expected}'",
        known_issue_ref=ki or "",
    )


def _check_exact(
    value: Any,
    expected: Any,
    label: str,
    category: str,
    path: list,
    note: str,
    gt: dict,
) -> CheckResult:
    path_str = ".".join(str(p) for p in path)
    if expected is None:
        ok = _is_null_or_missing(value) or value is None
    elif isinstance(expected, bool):
        ok = value is expected or value == expected
    elif isinstance(expected, (int, float)):
        ok = _within_tolerance(value, float(expected), 0.1)
    else:
        ok = str(value).lower() == str(expected).lower()
    outcome = PASS if ok else FAIL
    ki = _match_known_issue(label, gt, note) if outcome == FAIL else None
    if ki: outcome = KNOWN_ISSUE
    return CheckResult(
        category=category, label=label, outcome=outcome, actual=value,
        expected_desc=f"{path_str} == {repr(expected)}",
        note=note,
        diff_snippet="" if outcome == PASS else f"actual={repr(value)}, expected={repr(expected)}",
        known_issue_ref=ki or "",
    )


def _extract_numeric(value: Any) -> Optional[float]:
    """Try to extract a float from various shapes (nested dict, string with $, etc.)."""
    if value is None or value is _MISSING:
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, dict):
        # Try common patterns
        for key in ("amount", "value", "amount"):
            v = value.get(key)
            if v is not None:
                inner = _extract_numeric(v)
                if inner is not None:
                    return inner
        return None
    if isinstance(value, str):
        cleaned = re.sub(r"[,$\s]", "", value)
        try:
            return float(cleaned)
        except ValueError:
            return None
    return None


# ─────────────────────────────────────────────────────────────────────────────
# Main evaluator
# ─────────────────────────────────────────────────────────────────────────────

def evaluate_case(
    case: dict,
    report: Optional[dict],
    dio_data: Optional[dict],
    facts: list[dict],
    db_url: str,
) -> CaseResult:
    """
    Run all checks for a single GT case against live system outputs.

    Parameters
    ----------
    case       : dict from loader.build_case_map
    report     : API report dict (or None if unavailable)
    dio_data   : DIO JSON from deal_intelligence_objects (or None)
    facts      : list of financial_facts_v1 rows for this deal
    db_url     : postgres connection string
    """
    gt      = case["gt"]
    deal_id = case["deal_id"] or ""

    result = CaseResult(
        gt_name        = case["gt_name"],
        deal_id        = case["deal_id"],
        gt_path        = str(case["gt_path"]),
        mapping_status = case["mapping_status"],
        mapping_note   = case["mapping_note"],
    )

    if case["mapping_status"] != "mapped" or not deal_id:
        return result

    # Locate validation block — support both old and new GT layouts
    validation = (
        (gt.get("financials") or {}).get("validation")
        or gt.get("validation")
        or {}
    )

    # ── extraction_checks ─────────────────────────────────────────────────────
    for ch in validation.get("extraction_checks") or []:
        try:
            result.checks.append(_eval_extraction_check(ch, facts, gt))
        except Exception as exc:
            result.checks.append(CheckResult(
                category="extraction",
                label=ch.get("metric_key", "?"),
                outcome=SKIP,
                actual=None,
                expected_desc="error",
                note=str(exc),
            ))

    # ── noise_checks ─────────────────────────────────────────────────────────
    for ch in validation.get("noise_checks") or []:
        try:
            result.checks.append(_eval_noise_check(ch, report, facts, deal_id, gt, db_url))
        except Exception as exc:
            result.checks.append(CheckResult(
                category="noise",
                label=ch.get("label", "?"),
                outcome=SKIP,
                actual=None,
                expected_desc="error",
                note=str(exc),
            ))

    # ── report_checks ─────────────────────────────────────────────────────────
    for ch in validation.get("report_checks") or []:
        try:
            result.checks.append(_eval_report_check(ch, report, gt))
        except Exception as exc:
            result.checks.append(CheckResult(
                category="report",
                label=ch.get("label", "?"),
                outcome=SKIP,
                actual=None,
                expected_desc="error",
                note=str(exc),
            ))

    # ── dio_checks ───────────────────────────────────────────────────────────
    for ch in validation.get("dio_checks") or []:
        try:
            # dio_checks that use report_path — route through report_check evaluator
            if "report_path" in ch and "dio_path" not in ch:
                result.checks.append(_eval_report_check(ch, report, gt))
            else:
                result.checks.append(_eval_dio_check(ch, dio_data, gt))
        except Exception as exc:
            result.checks.append(CheckResult(
                category="dio",
                label=ch.get("label", "?"),
                outcome=SKIP,
                actual=None,
                expected_desc="error",
                note=str(exc),
            ))

    # ── evidence_checks ───────────────────────────────────────────────────────
    for ch in validation.get("evidence_checks") or []:
        try:
            result.checks.append(_eval_evidence_check(ch, report, dio_data, gt))
        except Exception as exc:
            result.checks.append(CheckResult(
                category="evidence",
                label=ch.get("label", "?"),
                outcome=SKIP,
                actual=None,
                expected_desc="error",
                note=str(exc),
            ))

    return result
