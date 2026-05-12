#!/usr/bin/env python3
"""
evaluation/financial_Audit/evaluate_regression.py
===================================================

Regression evaluator for the 10-file financial extraction golden suite.

Reads:
  results/golden_manifest.json       — expected outcomes per file + category
  results/overall_summary.json       — actual extraction outcomes from run_audit.py

Writes:
  results/regression_check.md        — human-readable pass/fail report
  results/regression_check.json      — machine-readable for CI

Exit code:
  0  — all assertions passed
  1  — one or more regressions detected

Usage:
  python evaluation/financial_Audit/evaluate_regression.py
  python evaluation/financial_Audit/evaluate_regression.py --strict  # fail on warnings too
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

RESULTS_DIR = Path(__file__).resolve().parent / "results"
MANIFEST_PATH = RESULTS_DIR / "golden_manifest.json"
ACTUAL_PATH = RESULTS_DIR / "overall_summary.json"
REGRESSION_MD = RESULTS_DIR / "regression_check.md"
REGRESSION_JSON = RESULTS_DIR / "regression_check.json"

# Priority rubric weights (highest = most important)
PRIORITY_RUBRIC = {
    "affects most files": 5,
    "affects correctness of current-vs-projected interpretation": 4,
    "affects source attribution": 3,
    "affects only presentation": 2,
    "affects schema-divergent cases only": 1,
}


# ─── Data structures ──────────────────────────────────────────────────────────

@dataclass
class AssertionResult:
    assertion: str
    passed: bool
    expected: object
    actual: object
    severity: str  # "REGRESSION" | "WARNING" | "INFO"
    priority_bucket: str


@dataclass
class FileCheckResult:
    filename: str
    category: str
    assertions: list[AssertionResult] = field(default_factory=list)

    @property
    def regressions(self):
        return [a for a in self.assertions if a.severity == "REGRESSION" and not a.passed]

    @property
    def warnings(self):
        return [a for a in self.assertions if a.severity == "WARNING" and not a.passed]

    @property
    def overall_status(self):
        if self.regressions:
            return "REGRESSION"
        if self.warnings:
            return "WARNING"
        return "PASS"


@dataclass
class CategoryResult:
    name: str
    files: list[FileCheckResult] = field(default_factory=list)

    @property
    def pass_count(self):
        return sum(1 for f in self.files if f.overall_status == "PASS")

    @property
    def warning_count(self):
        return sum(1 for f in self.files if f.overall_status == "WARNING")

    @property
    def fail_count(self):
        return sum(1 for f in self.files if f.overall_status == "REGRESSION")

    @property
    def confidence_level(self):
        total = len(self.files)
        if total == 0:
            return "unknown"
        pass_rate = self.pass_count / total
        if pass_rate == 1.0:
            return "high"
        if pass_rate >= 0.67:
            return "medium"
        return "low"

    def recurring_issues(self) -> list[str]:
        issue_counts: dict[str, int] = {}
        for f in self.files:
            seen = set()
            for a in f.regressions + f.warnings:
                bucket = a.priority_bucket
                if bucket not in seen:
                    issue_counts[bucket] = issue_counts.get(bucket, 0) + 1
                    seen.add(bucket)
        return sorted(issue_counts.keys(), key=lambda k: -issue_counts[k])


# ─── Assertion engine ─────────────────────────────────────────────────────────

def check_file(manifest_entry: dict, actual: dict) -> FileCheckResult:
    fname = manifest_entry["filename"]
    category = manifest_entry["category"]
    exp = manifest_entry["expected"]
    result = FileCheckResult(filename=fname, category=category)

    def add(assertion: str, passed: bool, expected, actual_val,
            severity: str = "REGRESSION", priority: str = "affects most files"):
        result.assertions.append(AssertionResult(
            assertion=assertion,
            passed=passed,
            expected=expected,
            actual=actual_val,
            severity=severity,
            priority_bucket=priority,
        ))

    # ── Extraction gate (hard failure) ──
    ext_ok = actual.get("extraction_succeeded", False)
    add(
        "extraction_succeeded",
        ext_ok == exp["extraction_succeeded"],
        exp["extraction_succeeded"],
        ext_ok,
        severity="REGRESSION",
        priority="affects most files",
    )
    if not ext_ok:
        # All downstream assertions are moot
        return result

    # ── Verdict must not regress below floor ──
    verdict_order = {"PASS": 2, "PASS_WITH_WARNINGS": 1, "PASS WITH WARNINGS": 1, "FAIL": 0}
    floor_label = exp.get("must_not_regress_to", "FAIL")
    floor_score = verdict_order.get(floor_label, 0)
    actual_verdict = actual.get("verdict", "FAIL")
    actual_score = verdict_order.get(actual_verdict, 0)
    add(
        "verdict_meets_floor",
        actual_score >= floor_score,
        f"≥ {floor_label}",
        actual_verdict,
        severity="REGRESSION",
        priority="affects most files",
    )

    # ── Required metric families present ──
    actual_families = set(actual.get("metric_families", []))
    for fam in exp.get("metric_families_required", []):
        add(
            f"required_family_present:{fam}",
            fam in actual_families,
            fam,
            actual_families,
            severity="REGRESSION",
            priority="affects most files",
        )

    # ── Forbidden metric families absent ──
    for fam in exp.get("metric_families_forbidden", []):
        add(
            f"forbidden_family_absent:{fam}",
            fam not in actual_families,
            f"NOT {fam}",
            actual_families,
            severity="WARNING",
            priority="affects source attribution",
        )

    # ── Presence assertions (individual metric families) ──
    presence = exp.get("presence", {})

    for key, exp_present in presence.items():
        if key == "projected_values":
            actual_has = actual.get("has_projections", False)
            if exp_present:
                # Must have projections
                add(
                    "presence:projected_values",
                    actual_has == True,
                    True,
                    actual_has,
                    severity="WARNING",
                    priority="affects correctness of current-vs-projected interpretation",
                )
            else:
                # Should NOT have projections (but this is a WARNING if it does — not a hard failure;
                # projections appearing unexpectedly may indicate reclassification drift)
                if actual_has:
                    add(
                        "presence:projected_values_unexpected",
                        False,
                        False,
                        actual_has,
                        severity="WARNING",
                        priority="affects correctness of current-vs-projected interpretation",
                    )
        elif key in ("revenue", "burn", "cash", "runway"):
            fam_map = {
                "cash": "cash",
                "revenue": "revenue",
                "burn": "burn",
                "runway": "runway",
            }
            fam = fam_map[key]
            actual_has = fam in actual_families
            if exp_present and not actual_has:
                add(
                    f"presence:{key}",
                    False,
                    f"{key} present",
                    f"{key} absent",
                    severity="REGRESSION",
                    priority="affects correctness of current-vs-projected interpretation",
                )
            elif not exp_present and actual_has:
                # Unexpected presence — warning (could be a new detection, not necessarily wrong)
                add(
                    f"presence:{key}_unexpected",
                    False,
                    f"{key} absent",
                    f"{key} present",
                    severity="WARNING",
                    priority="affects source attribution",
                )

    # ── Current-state signals ──
    exp_current = exp.get("has_current_state", False)
    actual_current = actual.get("has_current_state", False)
    if exp_current and not actual_current:
        add(
            "has_current_state",
            False,
            True,
            False,
            severity="REGRESSION",
            priority="affects correctness of current-vs-projected interpretation",
        )
    elif not exp_current and actual_current:
        add(
            "has_current_state_unexpected",
            False,
            False,
            True,
            severity="WARNING",
            priority="affects correctness of current-vs-projected interpretation",
        )

    # ── Real-estate schema detection ──
    exp_re = exp.get("is_real_estate", False)
    actual_re = actual.get("is_real_estate", False)
    if exp_re != actual_re:
        severity = "REGRESSION" if exp_re else "WARNING"
        add(
            "is_real_estate",
            False,
            exp_re,
            actual_re,
            severity=severity,
            priority="affects schema-divergent cases only",
        )

    # ── Minimum token count ──
    exp_min = exp.get("min_metric_tokens", 0)
    actual_tokens = actual.get("total_facts_found", 0)
    if actual_tokens < exp_min:
        add(
            "min_metric_tokens",
            False,
            f"≥ {exp_min}",
            actual_tokens,
            severity="REGRESSION",
            priority="affects most files",
        )

    # ── Expected warnings present ──
    actual_reasons = " ".join(actual.get("verdict_reasons", []))
    for expected_warning in exp.get("expected_warnings", []):
        found = expected_warning.lower() in actual_reasons.lower()
        add(
            f"expected_warning_present:{expected_warning[:50]}",
            found,
            f"contains: {expected_warning}",
            actual_reasons[:120],
            severity="WARNING",
            priority="affects only presentation",
        )

    return result


# ─── Category-level scoring ────────────────────────────────────────────────────

def compute_category_results(file_results: list[FileCheckResult]) -> dict[str, CategoryResult]:
    cats: dict[str, CategoryResult] = {}
    for fr in file_results:
        if fr.category not in cats:
            cats[fr.category] = CategoryResult(name=fr.category)
        cats[fr.category].files.append(fr)
    return cats


# ─── Engineering fix ranking ──────────────────────────────────────────────────

def rank_engineering_fixes(
    file_results: list[FileCheckResult],
    category_results: dict[str, CategoryResult],
) -> list[dict]:
    """
    Rank engineering fixes by the priority rubric:
    5 = affects most files
    4 = affects correctness of current-vs-projected interpretation
    3 = affects source attribution
    2 = affects only presentation
    1 = affects schema-divergent cases only
    """
    # Collect all failed assertions
    bucket_file_map: dict[str, set] = {}
    bucket_examples: dict[str, list] = {}

    for fr in file_results:
        for a in fr.assertions:
            if not a.passed:
                if a.priority_bucket not in bucket_file_map:
                    bucket_file_map[a.priority_bucket] = set()
                    bucket_examples[a.priority_bucket] = []
                bucket_file_map[a.priority_bucket].add(fr.filename)
                if len(bucket_examples[a.priority_bucket]) < 3:
                    bucket_examples[a.priority_bucket].append(
                        f"{fr.filename}: {a.assertion} (expected={a.expected}, got={a.actual})"
                    )

    fixes = []
    for bucket, weight in sorted(PRIORITY_RUBRIC.items(), key=lambda x: -x[1]):
        files_affected = bucket_file_map.get(bucket, set())
        if not files_affected:
            continue
        fixes.append({
            "priority_bucket": bucket,
            "priority_weight": weight,
            "files_affected_count": len(files_affected),
            "files_affected": sorted(files_affected),
            "examples": bucket_examples.get(bucket, []),
            "risk": "high" if weight >= 4 else "medium" if weight >= 3 else "low",
            "breadth": "wide" if len(files_affected) >= 5 else "moderate" if len(files_affected) >= 3 else "narrow",
        })

    # Add known structural fixes regardless of assertion failures (from suite design analysis)
    structural_fixes = [
        {
            "priority_bucket": "period-parser-column-label-resolution",
            "priority_weight": 5,
            "files_affected_count": 10,
            "files_affected": ["all files"],
            "description": "col_A / col_B period labels are unresolved. The period parser cannot decode column headers from the structured workbook back to calendar dates. Affects all XLSX extractions where column headers are dates or months.",
            "risk": "high",
            "breadth": "wide",
        },
        {
            "priority_bucket": "re-schema-guard-before-metric-promotion",
            "priority_weight": 3,
            "files_affected_count": 3,
            "files_affected": [
                "Multifamily-Redevelopment-Model-v7.1-asfp9a.xlsx",
                "sf_blog_model.xlsx",
                "Value-Add-Apartment-Acquisition-Model_v0.964-pdsdzt.xlsm",
            ],
            "description": "Real-estate burn/revenue signals must NOT be promoted to burn_rate or revenue_canonical without a schema guard. These files' burn/revenue are RE operating metrics, not startup financials.",
            "risk": "high",
            "breadth": "narrow",
        },
        {
            "priority_bucket": "vision-worker-xls-support",
            "priority_weight": 2,
            "files_affected_count": 2,
            "files_affected": ["capex.xls", "margin.xls"],
            "description": "Vision worker /extract-xlsx only handles .xlsx/.xlsm via openpyxl. .xls files fall back to xlrd direct scan — not production-parity. If .xls files can appear in deals, a dedicated extraction path is needed.",
            "risk": "medium",
            "breadth": "narrow",
        },
    ]

    # Merge structural fixes in (dedup by bucket)
    existing_buckets = {f["priority_bucket"] for f in fixes}
    for sf in structural_fixes:
        if sf["priority_bucket"] not in existing_buckets:
            fixes.append(sf)

    fixes.sort(key=lambda x: (-x["priority_weight"], -x.get("files_affected_count", 0)))
    return fixes


# ─── Report generation ────────────────────────────────────────────────────────

def generate_markdown(
    file_results: list[FileCheckResult],
    category_results: dict[str, CategoryResult],
    engineering_fixes: list[dict],
    total_regressions: int,
    total_warnings: int,
) -> str:
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    status_icon = "🟢 ALL ASSERTIONS PASS" if total_regressions == 0 else f"🔴 {total_regressions} REGRESSION(S) DETECTED"

    md = f"""# Financial Extraction Regression Check

**Generated**: {ts}
**Status**: {status_icon}
**Regressions**: {total_regressions} | **Warnings**: {total_warnings}

---

## Per-file assertion results

"""
    for fr in file_results:
        icon = {"PASS": "✅", "WARNING": "⚠️", "REGRESSION": "❌"}.get(fr.overall_status, "?")
        md += f"### {icon} `{fr.filename}` — {fr.category}\n\n"

        passing = [a for a in fr.assertions if a.passed]
        failing_regressions = fr.regressions
        failing_warnings = fr.warnings

        if passing:
            md += f"**Passing assertions** ({len(passing)}):\n"
            for a in passing:
                md += f"- ✓ `{a.assertion}`\n"
            md += "\n"

        if failing_regressions:
            md += f"**Regressions** ({len(failing_regressions)}):\n"
            for a in failing_regressions:
                md += f"- ❌ `{a.assertion}` — expected `{a.expected}`, got `{a.actual}`\n"
            md += "\n"

        if failing_warnings:
            md += f"**Warnings** ({len(failing_warnings)}):\n"
            for a in failing_warnings:
                md += f"- ⚠️ `{a.assertion}` — expected `{a.expected}`, got `{a.actual}`\n"
            md += "\n"

    md += "---\n\n## Category-level scoring\n\n"

    for cat_name, cat in sorted(category_results.items()):
        md += f"### {cat_name}\n\n"
        md += f"| Metric | Value |\n|--------|-------|\n"
        md += f"| Files | {len(cat.files)} |\n"
        md += f"| Pass | {cat.pass_count} |\n"
        md += f"| Warning | {cat.warning_count} |\n"
        md += f"| Regression | {cat.fail_count} |\n"
        md += f"| Pipeline confidence | **{cat.confidence_level}** |\n"
        issues = cat.recurring_issues()
        if issues:
            md += f"| Recurring issues | {'; '.join(issues)} |\n"
        md += "\n"

        md += "**Files in this category:**\n"
        for fr in cat.files:
            icon = {"PASS": "✅", "WARNING": "⚠️", "REGRESSION": "❌"}.get(fr.overall_status, "?")
            md += f"- {icon} `{fr.filename}` ({fr.overall_status})\n"
        md += "\n"

    md += "---\n\n## Engineering fix priority\n\n"
    md += "Ranked by rubric: **5** = affects most files → **1** = schema-divergent only\n\n"
    md += "| Rank | Fix | Weight | Files affected | Risk | Breadth |\n"
    md += "|------|-----|--------|----------------|------|---------|\n"
    for i, fix in enumerate(engineering_fixes[:8], 1):
        files_str = str(fix["files_affected_count"])
        md += f"| {i} | `{fix['priority_bucket']}` | {fix['priority_weight']} | {files_str} | {fix['risk']} | {fix['breadth']} |\n"

    md += "\n### Top 3 engineering fixes this suite justifies\n\n"
    for i, fix in enumerate(engineering_fixes[:3], 1):
        desc = fix.get("description", fix.get("examples", [""])[0] if fix.get("examples") else "")
        files = ", ".join(f"`{f}`" for f in fix["files_affected"][:3])
        if len(fix["files_affected"]) > 3:
            files += f" (+{len(fix['files_affected'])-3} more)"
        md += f"**{i}. {fix['priority_bucket']}** (priority weight: {fix['priority_weight']}, risk: {fix['risk']})\n"
        if desc:
            md += f"  - {desc}\n"
        md += f"  - Affects: {files}\n\n"

    md += "---\n\n## Regression readiness assessment\n\n"

    total = len(file_results)
    passes = sum(1 for f in file_results if f.overall_status == "PASS")
    warns = sum(1 for f in file_results if f.overall_status == "WARNING")
    fails = sum(1 for f in file_results if f.overall_status == "REGRESSION")

    if fails == 0 and warns <= 2:
        readiness = "**REGRESSION-READY** — Golden assertions cover all 10 files with zero regressions and minimal warnings. Safe to add this suite to CI."
    elif fails == 0:
        readiness = f"**CONDITIONALLY READY** — No regressions, but {warns} warnings need triage before CI integration."
    else:
        readiness = f"**NOT READY** — {fails} regression(s) must be resolved before this suite can gate CI."

    md += f"{readiness}\n\n"
    md += f"- **Total files**: {total}\n"
    md += f"- **Fully passing**: {passes} ({int(passes/total*100)}%)\n"
    md += f"- **Warnings only**: {warns}\n"
    md += f"- **Regressions**: {fails}\n"
    md += f"- **Category coverage**: {', '.join(sorted(category_results.keys()))}\n"

    return md


# ─── Main ─────────────────────────────────────────────────────────────────────

def main(strict: bool = False) -> int:
    # Load inputs
    manifest = json.loads(MANIFEST_PATH.read_text())
    actual_summary = json.loads(ACTUAL_PATH.read_text())

    actual_by_filename = {f["filename"]: f for f in actual_summary["files"]}

    # Run assertions per file
    file_results: list[FileCheckResult] = []
    for entry in manifest["files"]:
        fname = entry["filename"]
        actual = actual_by_filename.get(fname)
        if actual is None:
            # File expected in manifest but missing from actual run
            fr = FileCheckResult(filename=fname, category=entry["category"])
            fr.assertions.append(AssertionResult(
                assertion="file_present_in_actual_run",
                passed=False,
                expected="present",
                actual="missing",
                severity="REGRESSION",
                priority_bucket="affects most files",
            ))
            file_results.append(fr)
            continue
        file_results.append(check_file(entry, actual))

    # Category results
    category_results = compute_category_results(file_results)

    # Engineering fixes
    engineering_fixes = rank_engineering_fixes(file_results, category_results)

    # Counts
    total_regressions = sum(len(fr.regressions) for fr in file_results)
    total_warnings = sum(len(fr.warnings) for fr in file_results)

    # Generate outputs
    md = generate_markdown(
        file_results, category_results, engineering_fixes,
        total_regressions, total_warnings,
    )
    REGRESSION_MD.write_text(md, encoding="utf-8")

    json_out = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "total_files": len(file_results),
        "total_regressions": total_regressions,
        "total_warnings": total_warnings,
        "overall_status": "REGRESSION" if total_regressions > 0 else ("WARNING" if total_warnings > 0 else "PASS"),
        "files": [
            {
                "filename": fr.filename,
                "category": fr.category,
                "status": fr.overall_status,
                "regressions": [
                    {"assertion": a.assertion, "expected": str(a.expected), "actual": str(a.actual)}
                    for a in fr.regressions
                ],
                "warnings": [
                    {"assertion": a.assertion, "expected": str(a.expected), "actual": str(a.actual)}
                    for a in fr.warnings
                ],
                "passing_count": len([a for a in fr.assertions if a.passed]),
                "total_assertions": len(fr.assertions),
            }
            for fr in file_results
        ],
        "categories": {
            name: {
                "confidence_level": cat.confidence_level,
                "pass_count": cat.pass_count,
                "warning_count": cat.warning_count,
                "fail_count": cat.fail_count,
                "recurring_issues": cat.recurring_issues(),
            }
            for name, cat in category_results.items()
        },
        "engineering_fixes": engineering_fixes,
    }
    REGRESSION_JSON.write_text(json.dumps(json_out, indent=2, default=str), encoding="utf-8")

    # Print summary
    print(f"\n{'='*60}")
    print("DealDecisionAI Financial Regression Check")
    print(f"{'='*60}")
    for fr in file_results:
        icon = {"PASS": "✅", "WARNING": "⚠️", "REGRESSION": "❌"}.get(fr.overall_status, "?")
        reg_str = f"  ({len(fr.regressions)} regression(s))" if fr.regressions else ""
        warn_str = f"  ({len(fr.warnings)} warning(s))" if fr.warnings else ""
        print(f"  {icon} {fr.filename}{reg_str}{warn_str}")
        for a in fr.regressions:
            print(f"      REGRESSION  {a.assertion}")
            print(f"                  expected : {a.expected}")
            print(f"                  actual   : {a.actual}")
        for a in fr.warnings:
            print(f"      WARNING     {a.assertion}")
            print(f"                  expected : {a.expected}")
            print(f"                  actual   : {a.actual}")

    print()
    for cat_name, cat in sorted(category_results.items()):
        print(f"  [{cat_name}] confidence={cat.confidence_level}  pass={cat.pass_count} warn={cat.warning_count} fail={cat.fail_count}")

    print()
    if total_regressions == 0:
        print("  ✅ All assertions pass — suite is regression-ready")
    else:
        print(f"  ❌ {total_regressions} regression(s) detected")

    print(f"\n  Top fix: {engineering_fixes[0]['priority_bucket'] if engineering_fixes else 'none'}")
    print(f"\nOutputs written:")
    print(f"  {REGRESSION_MD}")
    print(f"  {REGRESSION_JSON}")

    # ── CI-friendly summary block ──
    exit_code = (1 if (total_regressions > 0 or total_warnings > 0) else 0) if strict else (1 if total_regressions > 0 else 0)
    exit_reason = (
        f"{total_regressions} regression(s) detected" if total_regressions > 0
        else (f"{total_warnings} warning(s) in strict mode" if (strict and total_warnings > 0) else "all assertions passed")
    )

    print()
    print("##[group]Financial Extraction Regression Suite — CI Summary")
    print(f"files_checked     : {len(file_results)}")
    print(f"regressions       : {total_regressions}")
    print(f"warnings          : {total_warnings}")
    print(f"exit_code         : {exit_code}")
    print(f"exit_code_reason  : {exit_reason}")
    print(f"strict_mode       : {'yes' if strict else 'no'}")
    print(f"report            : {REGRESSION_MD}")
    print("##[endgroup]")

    return exit_code


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--strict", action="store_true", help="Exit 1 on warnings as well as regressions")
    args = parser.parse_args()
    sys.exit(main(strict=args.strict))
