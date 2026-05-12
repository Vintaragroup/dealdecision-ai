#!/usr/bin/env python3
"""
evaluation/pipeline_regression/run.py
=======================================

CLI entry point for the ground_truth_v1 regression runner.

Usage
-----
  # All cases
  python evaluation/pipeline_regression/run.py

  # Single case
  python evaluation/pipeline_regression/run.py --case Allurion

  # Custom DB URL
  python evaluation/pipeline_regression/run.py --db-url postgresql://postgres:postgres@localhost:5434/dealdecision

  # Don't fail process on check failures (just report)
  python evaluation/pipeline_regression/run.py --no-fail

Exit codes
----------
  0 — all checks PASS (KNOWN_ISSUE does not count as failure)
  1 — at least one FAIL check, or fatal error
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path

# ── Path setup ────────────────────────────────────────────────────────────────
_RUNNER_ROOT = Path(__file__).resolve().parent
_EVAL_ROOT   = _RUNNER_ROOT.parent
_REPO_ROOT   = _EVAL_ROOT.parent
sys.path.insert(0, str(_RUNNER_ROOT))   # so checker/loader/reporter are importable

# ── Default settings ──────────────────────────────────────────────────────────
DEFAULT_DB_URL  = "postgresql://postgres:postgres@localhost:55433/dealdecision"
DEFAULT_API_URL = "http://localhost:9001"


def _build_run_id() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Run ground_truth_v1 regression checks against the live pipeline."
    )
    parser.add_argument(
        "--case", "-c",
        metavar="CASE_NAME",
        help="Evaluate only this GT case (file stem, e.g. Allurion)",
    )
    parser.add_argument(
        "--db-url",
        default=DEFAULT_DB_URL,
        metavar="URL",
        help=f"Postgres connection string (default: {DEFAULT_DB_URL})",
    )
    parser.add_argument(
        "--gt-dir",
        default=None,
        metavar="DIR",
        help="Override ground_truth directory path",
    )
    parser.add_argument(
        "--run-id",
        default=None,
        metavar="ID",
        help="Run identifier used in output filenames (default: YYYYMMDD)",
    )
    parser.add_argument(
        "--no-fail",
        action="store_true",
        help="Exit 0 even when FAIL checks exist (report only)",
    )
    fmt_group = parser.add_mutually_exclusive_group()
    fmt_group.add_argument(
        "--json-only",
        action="store_true",
        help="Write only the JSON report (skip Markdown)",
    )
    fmt_group.add_argument(
        "--md-only",
        action="store_true",
        help="Write only the Markdown report (skip JSON)",
    )
    args = parser.parse_args(argv)

    run_id      = args.run_id or _build_run_id()
    db_url      = args.db_url
    gt_dir_arg  = Path(args.gt_dir) if args.gt_dir else None
    case_filter = args.case

    print(f"\n🔍 DealDecisionAI — Pipeline Regression Runner")
    print(f"   run_id   : {run_id}")
    print(f"   db_url   : {db_url}")
    print(f"   api_base : {DEFAULT_API_URL}")
    if case_filter:
        print(f"   filter   : {case_filter}")
    print()

    # ── Import after path setup ───────────────────────────────────────────────
    try:
        from loader  import build_case_map, fetch_report, fetch_dio, fetch_financial_facts
        from checker import evaluate_case
        from reporter import write_reports
    except ImportError as exc:
        print(f"FATAL: import error — {exc}", file=sys.stderr)
        return 1

    gt_dir = gt_dir_arg or (_EVAL_ROOT / "ground_truth")

    # ── Phase 1 — Discover + map ──────────────────────────────────────────────
    print("Phase 1 — Discovering and mapping benchmark cases...")
    try:
        cases = build_case_map(gt_dir=gt_dir, db_url=db_url)
    except Exception as exc:
        print(f"FATAL: could not build case map — {exc}", file=sys.stderr)
        return 1

    if case_filter:
        cases = [c for c in cases if c["gt_name"].lower() == case_filter.lower()]
        if not cases:
            print(f"  ERROR: no GT file found for case '{case_filter}'", file=sys.stderr)
            print(f"  Available cases: {[c['gt_name'] for c in build_case_map(gt_dir=gt_dir, db_url=db_url)]}")
            return 1

    for c in cases:
        icon = "✅" if c["mapping_status"] == "mapped" else "❌"
        print(f"  {icon} {c['gt_name']:30s} — {c['mapping_status']} ({c['mapping_note'][:60]})")

    mapped   = [c for c in cases if c["mapping_status"] == "mapped"]
    unmapped = [c for c in cases if c["mapping_status"] != "mapped"]
    print(f"\n  {len(mapped)} mapped, {len(unmapped)} unmapped\n")

    # ── Phase 2 + 3 + 4 + 5 — Fetch + Evaluate ───────────────────────────────
    print("Phase 2–5 — Fetching outputs and evaluating checks...")
    from checker import CaseResult

    evaluated: list[CaseResult] = []

    for case in cases:
        print(f"\n  [{case['gt_name']}]")

        if case["mapping_status"] != "mapped":
            cr = CaseResult(
                gt_name=case["gt_name"],
                deal_id=None,
                gt_path=str(case["gt_path"]),
                mapping_status=case["mapping_status"],
                mapping_note=case["mapping_note"],
            )
            evaluated.append(cr)
            print(f"    ⚠️  UNMAPPED — skipping checks")
            continue

        deal_id = case["deal_id"]
        fetch_error = None

        # Fetch API report
        print(f"    → fetching API report ({deal_id[:8]}...)")
        report = fetch_report(deal_id)
        if report is None:
            fetch_error = f"API report unavailable for deal_id={deal_id}"
            print(f"    ⚠️  report unavailable")

        # Fetch DIO
        print(f"    → fetching DIO...")
        dio_data = fetch_dio(deal_id, db_url)
        if dio_data is None:
            print(f"    ⚠️  DIO not found (some checks will SKIP)")

        # Fetch financial facts
        print(f"    → fetching financial_facts_v1...")
        facts = fetch_financial_facts(deal_id, db_url)
        print(f"    → {len(facts)} financial fact row(s)")

        # Execute checks
        cr = evaluate_case(case, report, dio_data, facts, db_url)
        cr.fetch_error = fetch_error
        evaluated.append(cr)

        p = cr.pass_count
        f = cr.fail_count
        k = cr.known_issue_count
        s = cr.skip_count
        icon = "✅" if f == 0 else "❌"
        print(f"    {icon}  {p} PASS  {f} FAIL  {k} KNOWN_ISSUE  {s} SKIP  → {cr.overall_status}")

    # ── Phase 6 — Write reports ───────────────────────────────────────────────
    print("\nPhase 6 — Writing reports...")
    generated_at = datetime.now(timezone.utc).isoformat()

    try:
        from reporter import write_reports
        formats: set[str] | None = None
        if args.json_only:
            formats = {"json"}
        elif args.md_only:
            formats = {"md"}
        md_path, json_path = write_reports(
            cases=evaluated,
            run_id=run_id,
            generated_at=generated_at,
            case_name=case_filter,
            formats=formats,
        )
        if md_path:
            print(f"  📄  Markdown : {md_path}")
        if json_path:
            print(f"  📊  JSON     : {json_path}")
    except Exception as exc:
        print(f"  ERROR writing reports: {exc}", file=sys.stderr)
        return 1

    # ── Summary ───────────────────────────────────────────────────────────────
    total_fail = sum(c.fail_count for c in evaluated)
    total_pass = sum(c.pass_count for c in evaluated)
    total_ki   = sum(c.known_issue_count for c in evaluated)
    total_skip = sum(c.skip_count for c in evaluated)
    total_chx  = sum(c.total_checks for c in evaluated)

    print()
    print("─" * 60)
    print(f"  Total checks : {total_chx}")
    print(f"  PASS         : {total_pass}")
    print(f"  FAIL         : {total_fail}")
    print(f"  KNOWN_ISSUE  : {total_ki}")
    print(f"  SKIP         : {total_skip}")
    print()

    if total_fail > 0:
        print(f"❌  REGRESSION FAILURES — {total_fail} unresolved FAIL check(s)")
        for case in evaluated:
            for ch in case.checks:
                if ch.outcome == "FAIL":
                    print(f"   • [{case.gt_name}] {ch.label}: {ch.diff_snippet or ch.expected_desc}")
    else:
        print("✅  PASS — no unresolved failures")

    print()

    if total_fail > 0 and not args.no_fail:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
