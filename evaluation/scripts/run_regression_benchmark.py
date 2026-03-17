#!/usr/bin/env python3
"""
evaluation/scripts/run_regression_benchmark.py
================================================

CLI entry point for the Phase 7 regression benchmark.

Connects to the local Postgres DB, loads ground-truth datasets, compares the
current system output against them, and writes a regression report.

Usage:

  # Run against latest baseline (auto-detected)
  python evaluation/scripts/run_regression_benchmark.py

  # Specify explicit run-id and baseline
  python evaluation/scripts/run_regression_benchmark.py \\
    --run-id run_2026_03_10 \\
    --baseline-run-id run_2026_03_09

  # Use a custom ground-truth directory
  python evaluation/scripts/run_regression_benchmark.py \\
    --ground-truth-dir /path/to/my/gt

  # Do not raise on failure (just report)
  python evaluation/scripts/run_regression_benchmark.py --no-fail

  # Override regression threshold (percentage points)
  python evaluation/scripts/run_regression_benchmark.py --threshold 10

Exit codes:
  0 — PASS (no regressions)
  1 — FAIL (regressions found, or error)
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

# ─── Path setup ──────────────────────────────────────────────────────────────
REPO_ROOT = Path(__file__).resolve().parent.parent.parent
EVAL_ROOT = REPO_ROOT / "evaluation"
sys.path.insert(0, str(EVAL_ROOT))

# ─── DB dependency ───────────────────────────────────────────────────────────
try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    print(
        "ERROR: psycopg2 not found.\n"
        "  Install:  pip install psycopg2-binary\n"
        "  Or activate venv:  source .venv/bin/activate",
        file=sys.stderr,
    )
    sys.exit(1)

from lib.benchmark_run import generate_run_id  # noqa: E402
from benchmark.regression_runner import (      # noqa: E402
    run_regression_benchmark,
    RegressionFailure,
    REGRESSION_THRESHOLD_PTS,
    REGRESSION_REPORTS_DIR,
)

DEFAULT_DB_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://postgres:postgres@localhost:55433/dealdecision",
)


def parse_args(argv=None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run the DealDecisionAI regression benchmark against ground-truth datasets.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--run-id",
        default=None,
        help="Identifier for this run (default: auto-generated timestamp).",
    )
    parser.add_argument(
        "--baseline-run-id",
        default=None,
        help="Use this specific baseline run for comparison (default: latest available).",
    )
    parser.add_argument(
        "--ground-truth-dir",
        default=None,
        type=Path,
        help="Path to ground-truth directory (default: evaluation/ground_truth/).",
    )
    parser.add_argument(
        "--threshold",
        default=REGRESSION_THRESHOLD_PTS,
        type=float,
        help=f"Regression failure threshold in percentage points (default: {REGRESSION_THRESHOLD_PTS}).",
    )
    parser.add_argument(
        "--no-fail",
        action="store_true",
        default=False,
        help="Report regressions but do not exit with code 1.",
    )
    parser.add_argument(
        "--db-url",
        default=DEFAULT_DB_URL,
        help="PostgreSQL connection string.",
    )
    return parser.parse_args(argv)


def main(argv=None) -> int:
    args = parse_args(argv)

    run_id = args.run_id or generate_run_id()

    print(f"=== Regression Benchmark ===")
    print(f"  Run ID    : {run_id}")
    if args.baseline_run_id:
        print(f"  Baseline  : {args.baseline_run_id}")
    else:
        print("  Baseline  : auto (latest)")
    print(f"  Threshold : –{args.threshold:.0f} pp")
    print(f"  DB        : {args.db_url}")
    print()

    # Connect
    try:
        conn = psycopg2.connect(
            args.db_url,
            cursor_factory=psycopg2.extras.RealDictCursor,
        )
        conn.set_session(readonly=True, autocommit=True)
    except Exception as exc:
        print(f"ERROR: could not connect to DB: {exc}", file=sys.stderr)
        return 1

    try:
        result = run_regression_benchmark(
            conn=conn,
            run_id=run_id,
            baseline_run_id=args.baseline_run_id,
            ground_truth_dir=args.ground_truth_dir,
            threshold_pts=args.threshold,
            raise_on_failure=False,   # we handle the exit code ourselves
        )
    except Exception as exc:
        print(f"ERROR: regression runner failed: {exc}", file=sys.stderr)
        conn.close()
        return 1
    finally:
        conn.close()

    # Print summary
    print(f"  Deals evaluated : {len(result.deal_results)}")
    print(f"  Report          : {result.report_path}")
    print()

    flags = result.all_regression_flags(args.threshold)
    if flags:
        print(f"❌ REGRESSION FAILURES ({len(flags)}):")
        for f in flags:
            print(f"   • {f}")
        print()
    else:
        print("✅ PASS — no regressions detected")
        print()

    # Per-deal summary
    if result.deal_results:
        col_w = max(len(d.deal_name) for d in result.deal_results) + 2
        header = f"  {'Deal':<{col_w}} {'Semantic':>10}  {'Financial':>10}  {'Overall':>10}"
        print(header)
        print("  " + "-" * (col_w + 36))
        for dr in result.deal_results:
            sem_str  = f"{dr.current_semantic*100:.1f}%"  if dr.current_semantic  is not None else "—"
            fin_str  = f"{dr.current_financial*100:.1f}%" if dr.current_financial is not None else "—"
            ovr_str  = f"{dr.current_overall*100:.1f}%"   if dr.current_overall   is not None else "—"
            print(f"  {dr.deal_name:<{col_w}} {sem_str:>10}  {fin_str:>10}  {ovr_str:>10}")
        print()

    if flags and not args.no_fail:
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
