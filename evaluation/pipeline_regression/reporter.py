"""
evaluation/pipeline_regression/reporter.py
============================================

Phase 6 — Write Markdown + JSON outputs to artifacts/.

Outputs
-------
  artifacts/regression_suite_report_<YYYYMMDD>.md    — human-readable summary
  artifacts/regression_suite_report_<YYYYMMDD>.json  — machine-readable

Report sections
---------------
  1. Header + run metadata
  2. Summary table (totals)
  3. Per-case sections (checks by category, failing checks, known issues)
  4. Cross-case regression insights
  5. Release-gate assessment
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from checker import PASS, FAIL, SKIP, KNOWN_ISSUE, CaseResult, CheckResult

# ── Repo layout ──────────────────────────────────────────────────────────────
_RUNNER_ROOT  = Path(__file__).resolve().parent
_REPO_ROOT    = _RUNNER_ROOT.parent.parent
ARTIFACTS_DIR = _REPO_ROOT / "artifacts"


# ─────────────────────────────────────────────────────────────────────────────
# Cross-case pattern analysis
# ─────────────────────────────────────────────────────────────────────────────

_CROSS_CASE_PATTERNS = [
    ("SPAC contamination",        lambda c: any("spac" in r.label.lower() and r.outcome == FAIL for r in c.checks)),
    ("Startup/fund confusion",    lambda c: any(("fund" in r.label.lower() or "startup" in r.label.lower()) and r.outcome == FAIL for r in c.checks)),
    ("Stale evidence reuse",      lambda c: any("stale" in r.label.lower() and r.outcome == FAIL for r in c.checks)),
    ("Raise extraction noise",    lambda c: any(("raise" in r.label.lower()) and r.outcome == FAIL and r.category in ("noise","extraction") for r in c.checks)),
    ("Revenue noise (portfolio)", lambda c: any(("revenue" in r.label.lower() or "portfolio" in r.label.lower()) and r.outcome == FAIL and r.category == "noise" for r in c.checks)),
    ("Business model drift",      lambda c: any("business_model" in r.label.lower() and r.outcome == FAIL for r in c.checks)),
    ("Deal type misclassified",   lambda c: any("deal_type" in r.label.lower() and r.outcome == FAIL for r in c.checks)),
    ("Report/DIO inconsistency",  lambda c: (
        any(r.category == "report" and r.outcome == FAIL for r in c.checks) and
        any(r.category == "dio"    and r.outcome == FAIL for r in c.checks)
    )),
    ("Stage misclassified",       lambda c: any("stage" in r.label.lower() and r.outcome == FAIL for r in c.checks)),
    ("AUM as raise noise",        lambda c: any("aum" in r.label.lower() and r.outcome == FAIL for r in c.checks)),
]


def _detect_patterns(cases: list[CaseResult]) -> list[str]:
    """Return list of cross-case pattern observations."""
    observations: list[str] = []
    for pattern_name, test in _CROSS_CASE_PATTERNS:
        matched = [c.gt_name for c in cases if c.mapping_status == "mapped" and test(c)]
        if matched:
            observations.append(f"**{pattern_name}** — {', '.join(matched)}")
    return observations


# ─────────────────────────────────────────────────────────────────────────────
# Release-gate assessment
# ─────────────────────────────────────────────────────────────────────────────

def _release_gate(cases: list[CaseResult]) -> list[str]:
    """Return release-gate assessment bullets."""
    lines: list[str] = []
    for case in cases:
        if case.mapping_status != "mapped":
            continue
        if case.fail_count == 0 and case.pass_count > 0:
            lines.append(f"✅ **{case.gt_name}** — PASS ({case.pass_count}/{case.total_checks} checks) — strong release-gate candidate")
        elif case.fail_count == 0 and case.known_issue_count > 0 and case.pass_count > 0:
            lines.append(f"🟡 **{case.gt_name}** — PASS with {case.known_issue_count} known issue(s) — acceptable for release with documented caveats")
        elif case.fail_count > 0:
            lines.append(f"❌ **{case.gt_name}** — FAIL ({case.fail_count} unresolved failure(s)) — must fix before release")
        elif case.total_checks == 0:
            lines.append(f"⚪ **{case.gt_name}** — no checks defined — needs GT structure before release-gating")
        else:
            lines.append(f"⚠️ **{case.gt_name}** — SKIP ({case.skip_count} skipped) — coverage too low to gate")
    return lines


# ─────────────────────────────────────────────────────────────────────────────
# Markdown builder
# ─────────────────────────────────────────────────────────────────────────────

def _outcome_emoji(outcome: str) -> str:
    return {PASS: "✅", FAIL: "❌", SKIP: "⚠️", KNOWN_ISSUE: "🟡"}.get(outcome, "?")


def _check_row(c: CheckResult) -> str:
    e = _outcome_emoji(c.outcome)
    ki = f" `[{c.known_issue_ref}]`" if c.known_issue_ref else ""
    diff = f" — `{c.diff_snippet}`" if c.diff_snippet else ""
    return f"| {e} {c.outcome}{ki} | `{c.category}` | {c.label} | `{c.expected_desc}` | {repr(c.actual)}{diff} |"


def build_markdown(
    cases: list[CaseResult],
    run_id: str,
    generated_at: str,
) -> str:
    total_cases      = len(cases)
    mapped_cases     = sum(1 for c in cases if c.mapping_status == "mapped")
    unmapped_cases   = total_cases - mapped_cases
    total_checks     = sum(c.total_checks for c in cases)
    total_pass       = sum(c.pass_count for c in cases)
    total_fail       = sum(c.fail_count for c in cases)
    total_ki         = sum(c.known_issue_count for c in cases)
    total_skip       = sum(c.skip_count for c in cases)
    overall_status   = "PASS" if total_fail == 0 and mapped_cases > 0 else "FAIL"
    status_emoji     = "✅" if overall_status == "PASS" else "❌"

    lines: list[str] = []
    lines += [
        f"# Regression Suite Report — {run_id}",
        f"**Generated:** {generated_at}  ",
        f"**Overall status:** {status_emoji} {overall_status}",
        "",
        "---",
        "",
        "## Summary",
        "",
        "| Metric | Value |",
        "|--------|-------|",
        f"| Benchmark cases | {total_cases} |",
        f"| Mapped cases | {mapped_cases} |",
        f"| Unmapped cases | {unmapped_cases} |",
        f"| Total checks | {total_checks} |",
        f"| PASS | {total_pass} |",
        f"| FAIL | {total_fail} |",
        f"| KNOWN_ISSUE | {total_ki} |",
        f"| SKIP | {total_skip} |",
        "",
        "---",
        "",
        "## Case Overview",
        "",
        "| # | Case | Deal ID | Checks | Pass | Fail | Known | Skip | Status |",
        "|---|------|---------|--------|------|------|-------|------|--------|",
    ]

    for i, case in enumerate(cases, 1):
        s = _outcome_emoji(case.overall_status) + " " + case.overall_status
        deal_id_short = (case.deal_id or "—")[:8]
        lines.append(
            f"| {i} | {case.gt_name} | `{deal_id_short}` | {case.total_checks} | "
            f"{case.pass_count} | {case.fail_count} | {case.known_issue_count} | "
            f"{case.skip_count} | {s} |"
        )

    lines += ["", "---", "", "## Per-Case Detail", ""]

    for case in cases:
        lines += [
            f"### {case.gt_name}",
            "",
            f"- **Deal ID:** `{case.deal_id or 'UNMAPPED'}`",
            f"- **GT file:** `{Path(case.gt_path).name}`",
            f"- **Mapping:** {case.mapping_status} — {case.mapping_note}",
            f"- **Status:** {_outcome_emoji(case.overall_status)} {case.overall_status}",
            f"- **Checks:** {case.total_checks} total — {case.pass_count} PASS, {case.fail_count} FAIL, {case.known_issue_count} KNOWN_ISSUE, {case.skip_count} SKIP",
            "",
        ]

        if case.fetch_error:
            lines.append(f"> ⚠️ **Fetch error:** {case.fetch_error}")
            lines.append("")

        if not case.checks:
            lines.append("_No checks defined or executed._")
            lines.append("")
            continue

        # Group by category
        by_cat: dict[str, list[CheckResult]] = {}
        for ch in case.checks:
            by_cat.setdefault(ch.category, []).append(ch)

        for cat, checks in by_cat.items():
            lines.append(f"**{cat.title()} checks**")
            lines.append("")
            lines.append("| Outcome | Category | Label | Expected | Actual |")
            lines.append("|---------|----------|-------|----------|--------|")
            for ch in checks:
                lines.append(_check_row(ch))
            lines.append("")

        # Failing checks summary
        failing = [c for c in case.checks if c.outcome == FAIL]
        if failing:
            lines.append("**🚨 Failing checks (unresolved):**")
            lines.append("")
            for ch in failing:
                lines.append(f"- **{ch.label}** (`{ch.category}`): expected `{ch.expected_desc}`, got `{repr(ch.actual)}`")
                if ch.diff_snippet:
                    lines.append(f"  - diff: `{ch.diff_snippet}`")
            lines.append("")

        # Known issues
        ki_checks = [c for c in case.checks if c.outcome == KNOWN_ISSUE]
        if ki_checks:
            lines.append("**🟡 Known issues matched:**")
            lines.append("")
            for ch in ki_checks:
                ref = f"`{ch.known_issue_ref}`" if ch.known_issue_ref else "(ref unspecified)"
                lines.append(f"- {ch.label} — {ref}: expected `{ch.expected_desc}`, got `{repr(ch.actual)}`")
            lines.append("")

    # Cross-case patterns
    patterns = _detect_patterns(cases)
    lines += [
        "---",
        "",
        "## Cross-Case Regression Insights",
        "",
    ]
    if patterns:
        for p in patterns:
            lines.append(f"- {p}")
    else:
        lines.append("_No cross-case failure patterns detected._")
    lines.append("")

    # Release gate
    gate_lines = _release_gate(cases)
    lines += [
        "---",
        "",
        "## Release-Gate Assessment",
        "",
    ]
    if gate_lines:
        for g in gate_lines:
            lines.append(f"- {g}")
    else:
        lines.append("_No mapped cases to assess._")

    lines.append("")
    return "\n".join(lines)


# ─────────────────────────────────────────────────────────────────────────────
# JSON builder
# ─────────────────────────────────────────────────────────────────────────────

def _check_to_dict(c: CheckResult) -> dict:
    return {
        "category":       c.category,
        "label":          c.label,
        "outcome":        c.outcome,
        "actual":         _serializable(c.actual),
        "expected_desc":  c.expected_desc,
        "note":           c.note,
        "diff_snippet":   c.diff_snippet,
        "known_issue_ref": c.known_issue_ref,
    }


def _serializable(val: Any) -> Any:
    """Make a value JSON-serializable."""
    if val is None:
        return None
    if isinstance(val, (str, int, float, bool)):
        return val
    if isinstance(val, (list, tuple)):
        return [_serializable(v) for v in val]
    if isinstance(val, dict):
        return {k: _serializable(v) for k, v in val.items()}
    return str(val)


def build_json(
    cases: list[CaseResult],
    run_id: str,
    generated_at: str,
) -> dict:
    total_cases    = len(cases)
    mapped_cases   = sum(1 for c in cases if c.mapping_status == "mapped")
    total_checks   = sum(c.total_checks for c in cases)
    total_pass     = sum(c.pass_count for c in cases)
    total_fail     = sum(c.fail_count for c in cases)
    total_ki       = sum(c.known_issue_count for c in cases)
    total_skip     = sum(c.skip_count for c in cases)

    return {
        "run_id":         run_id,
        "generated_at":   generated_at,
        "overall_status": "PASS" if total_fail == 0 and mapped_cases > 0 else "FAIL",
        "summary": {
            "total_cases":    total_cases,
            "mapped_cases":   mapped_cases,
            "unmapped_cases": total_cases - mapped_cases,
            "total_checks":   total_checks,
            "pass":           total_pass,
            "fail":           total_fail,
            "known_issue":    total_ki,
            "skip":           total_skip,
        },
        "cases": [
            {
                "gt_name":        c.gt_name,
                "deal_id":        c.deal_id,
                "gt_path":        str(c.gt_path),
                "mapping_status": c.mapping_status,
                "mapping_note":   c.mapping_note,
                "overall_status": c.overall_status,
                "totals": {
                    "pass":        c.pass_count,
                    "fail":        c.fail_count,
                    "known_issue": c.known_issue_count,
                    "skip":        c.skip_count,
                    "total":       c.total_checks,
                },
                "checks": [_check_to_dict(ch) for ch in c.checks],
                "fetch_error": c.fetch_error,
            }
            for c in cases
        ],
        "cross_case_patterns": _detect_patterns(cases),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Write outputs
# ─────────────────────────────────────────────────────────────────────────────

def write_reports(
    cases: list[CaseResult],
    run_id: str,
    generated_at: str,
    artifacts_dir: Path = ARTIFACTS_DIR,
    case_name: str | None = None,
    formats: set[str] | None = None,
) -> tuple[Path | None, Path | None]:
    """
    Write Markdown + JSON reports. Returns (md_path, json_path).

    Parameters
    ----------
    case_name : str | None
        When set (single-case mode), the filename includes the case name, e.g.
        ``regression_Allurion_20260408.md``.  A "latest" copy is also written
        as ``regression_latest_Allurion.md``.
    formats : set[str] | None
        Subset of {"md", "json"} to write.  None → write both.
    """
    artifacts_dir.mkdir(parents=True, exist_ok=True)

    write_md   = formats is None or "md"   in formats
    write_json = formats is None or "json" in formats

    if case_name:
        slug     = case_name.replace(" ", "_")
        stem     = f"regression_{slug}_{run_id}"
        stem_lat = f"regression_latest_{slug}"
    else:
        stem     = f"regression_suite_report_{run_id}"
        stem_lat = "regression_suite_latest"

    md_path   = artifacts_dir / f"{stem}.md"
    json_path = artifacts_dir / f"{stem}.json"

    if write_md:
        md_content = build_markdown(cases, run_id, generated_at)
        md_path.write_text(md_content, encoding="utf-8")
        # Stable "latest" copy — always an actual file (no symlinks for cross-platform compat)
        (artifacts_dir / f"{stem_lat}.md").write_text(md_content, encoding="utf-8")

    if write_json:
        json_content = json.dumps(build_json(cases, run_id, generated_at), indent=2)
        json_path.write_text(json_content, encoding="utf-8")
        (artifacts_dir / f"{stem_lat}.json").write_text(json_content, encoding="utf-8")

    return md_path if write_md else None, json_path if write_json else None
