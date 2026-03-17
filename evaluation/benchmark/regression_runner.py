"""
evaluation/benchmark/regression_runner.py
==========================================

Regression benchmark runner for DealDecisionAI.

Workflow
--------
1. Load ground truth for all configured deals
2. For each deal, build DealUnderstandingV1 from the live DB
3. Compute automatic accuracy via ground_truth_compare
4. Compare against baseline run scores (if a baseline run-id is provided)
5. Detect regression failures when a metric drops > THRESHOLD
6. Write a regression report to evaluation/regression_reports/<run_id>.md
7. Return a RegressionResult that callers can inspect or raise on failure

Regression thresholds
---------------------
semantic_accuracy  must not drop > 5 percentage points
financial_accuracy must not drop > 5 percentage points
overall_accuracy   must not drop > 5 percentage points

If any threshold is exceeded, RegressionFailure is raised.

Baseline handling
-----------------
Baselines are stored as JSON in:
  evaluation/regression_reports/baselines/<run_id>.json

A baseline is written automatically after each successful run so the next
run can compare against it.  Pass --baseline-run-id to pick a specific prior
run; otherwise the most recent available baseline is used.
"""

from __future__ import annotations

import json
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

_EVAL_ROOT = Path(__file__).resolve().parent.parent
REGRESSION_REPORTS_DIR  = _EVAL_ROOT / "regression_reports"
BASELINES_DIR           = REGRESSION_REPORTS_DIR / "baselines"

# ---------------------------------------------------------------------------
# Thresholds
# ---------------------------------------------------------------------------

# Maximum allowed drop in percentage points before a regression failure is raised
REGRESSION_THRESHOLD_PTS = 5.0

# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------


class RegressionFailure(Exception):
    """Raised when accuracy drops beyond the allowed threshold."""


# ---------------------------------------------------------------------------
# Data types
# ---------------------------------------------------------------------------


@dataclass
class DealRegressionResult:
    deal_name: str
    baseline_semantic: Optional[float]    # 0.0–1.0 or None
    baseline_financial: Optional[float]
    baseline_overall: Optional[float]
    current_semantic: Optional[float]
    current_financial: Optional[float]
    current_overall: Optional[float]
    slot_verdicts: dict = field(default_factory=dict)
    financial_verdicts: dict = field(default_factory=dict)
    # Phase 9 — financial intelligence signals
    financial_coverage_pct: Optional[int] = None   # 0–100
    financial_conflict_count: int = 0
    financial_risk_flags: list[str] = field(default_factory=list)
    # Phase 10 — slide-aware financial extraction signals
    financial_slide_sources: list[str] = field(default_factory=list)      # distinct slide_types that contributed facts
    financial_slide_confidence_boosts: int = 0                             # facts that received a confidence upgrade
    # Section quality labels — computed after all other signals are assembled
    section_labels: dict = field(default_factory=dict)   # section_name → (label, note)

    def _delta(self, baseline: Optional[float], current: Optional[float]) -> Optional[float]:
        if baseline is None or current is None:
            return None
        return round(current - baseline, 4)

    @property
    def semantic_delta(self) -> Optional[float]:
        return self._delta(self.baseline_semantic, self.current_semantic)

    @property
    def financial_delta(self) -> Optional[float]:
        return self._delta(self.baseline_financial, self.current_financial)

    @property
    def overall_delta(self) -> Optional[float]:
        return self._delta(self.baseline_overall, self.current_overall)

    def regression_flags(self, threshold_pts: float = REGRESSION_THRESHOLD_PTS) -> list[str]:
        """Return list of failure descriptions for metrics that dropped too much."""
        threshold = threshold_pts / 100.0   # convert pp to 0.0–1.0 scale
        flags: list[str] = []
        for metric, delta, baseline, current in [
            ("semantic_accuracy",  self.semantic_delta,  self.baseline_semantic,  self.current_semantic),
            ("financial_accuracy", self.financial_delta, self.baseline_financial, self.current_financial),
            ("overall_accuracy",   self.overall_delta,   self.baseline_overall,   self.current_overall),
        ]:
            if delta is not None and delta < -threshold:
                flags.append(
                    f"{self.deal_name}/{metric}: "
                    f"{_fmt(baseline)} → {_fmt(current)} "
                    f"(Δ {delta*100:+.1f}pp, threshold –{threshold_pts:.0f}pp)"
                )
        return flags


@dataclass
class RegressionRunResult:
    run_id: str
    baseline_run_id: Optional[str]
    generated_at: str
    deal_results: list[DealRegressionResult] = field(default_factory=list)
    report_path: Optional[Path] = None
    status: str = "pass"    # "pass" | "fail"

    def all_regression_flags(self, threshold_pts: float = REGRESSION_THRESHOLD_PTS) -> list[str]:
        flags: list[str] = []
        for dr in self.deal_results:
            flags.extend(dr.regression_flags(threshold_pts))
        return flags

    @property
    def avg_current_semantic(self) -> Optional[float]:
        return _avg([d.current_semantic for d in self.deal_results])

    @property
    def avg_current_financial(self) -> Optional[float]:
        return _avg([d.current_financial for d in self.deal_results])

    @property
    def avg_current_overall(self) -> Optional[float]:
        return _avg([d.current_overall for d in self.deal_results])

    @property
    def avg_baseline_semantic(self) -> Optional[float]:
        return _avg([d.baseline_semantic for d in self.deal_results])

    @property
    def avg_baseline_financial(self) -> Optional[float]:
        return _avg([d.baseline_financial for d in self.deal_results])

    @property
    def avg_baseline_overall(self) -> Optional[float]:
        return _avg([d.baseline_overall for d in self.deal_results])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _avg(values: list[Optional[float]]) -> Optional[float]:
    real = [v for v in values if v is not None]
    if not real:
        return None
    return round(sum(real) / len(real), 4)


def _fmt(val: Optional[float]) -> str:
    if val is None:
        return "—"
    return f"{val*100:.1f}%"


def _delta_str(delta: Optional[float]) -> str:
    if delta is None:
        return "—"
    sign = "+" if delta >= 0 else ""
    return f"{sign}{delta*100:.1f}pp"


# ---------------------------------------------------------------------------
# Baseline persistence
# ---------------------------------------------------------------------------


def write_baseline(run_id: str, deal_results: list[DealRegressionResult]) -> Path:
    """Persist current run scores as a named baseline."""
    BASELINES_DIR.mkdir(parents=True, exist_ok=True)
    data = {
        "run_id": run_id,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "deals": {
            dr.deal_name: {
                "semantic_accuracy":  dr.current_semantic,
                "financial_accuracy": dr.current_financial,
                "overall_accuracy":   dr.current_overall,
            }
            for dr in deal_results
        },
    }
    path = BASELINES_DIR / f"{run_id}.json"
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")
    return path


def load_baseline(run_id: str) -> Optional[dict]:
    """Load a named baseline.  Returns None if not found."""
    path = BASELINES_DIR / f"{run_id}.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def load_latest_baseline() -> Optional[dict]:
    """Load the most recently written baseline (by filename sort)."""
    if not BASELINES_DIR.exists():
        return None
    files = sorted(BASELINES_DIR.glob("*.json"))
    if not files:
        return None
    try:
        return json.loads(files[-1].read_text(encoding="utf-8"))
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Main runner
# ---------------------------------------------------------------------------


def run_regression_benchmark(
    conn: Any,                              # psycopg2 connection
    run_id: str,
    baseline_run_id: Optional[str] = None,
    ground_truth_dir: Optional[Path] = None,
    threshold_pts: float = REGRESSION_THRESHOLD_PTS,
    raise_on_failure: bool = True,
) -> RegressionRunResult:
    """
    Execute a full regression benchmark against ground-truth data.

    Parameters
    ----------
    conn              : open psycopg2 connection to the dev DB
    run_id            : identifier for this run
    baseline_run_id   : if set, load this specific baseline; otherwise use latest
    ground_truth_dir  : override default ground truth directory (for tests)
    threshold_pts     : regression failure threshold in percentage points
    raise_on_failure  : if True (default), raise RegressionFailure when regressions found

    Returns
    -------
    RegressionRunResult
    """
    # Import evaluation libs (path must already include evaluation/)
    from benchmark.ground_truth_loader import load_all_ground_truth
    from benchmark.ground_truth_compare import compute_ground_truth_accuracy
    from lib.deal_understanding_v1 import (
        build_deal_understanding_v1,
        fetch_product_profile_v1,
        fetch_understanding_fallback_inputs,
    )
    from lib.doc_type_classifier import classify_deal_documents, fetch_documents_for_classification

    generated_at = datetime.now(timezone.utc).isoformat()

    # Load ground truth
    all_gt = load_all_ground_truth(ground_truth_dir)
    if not all_gt:
        print("[regression_runner] WARNING: no ground-truth files found — nothing to compare", file=sys.stderr)

    # Load baseline
    baseline: Optional[dict] = None
    if baseline_run_id:
        baseline = load_baseline(baseline_run_id)
        if not baseline:
            print(f"[regression_runner] WARNING: baseline '{baseline_run_id}' not found", file=sys.stderr)
    else:
        baseline = load_latest_baseline()

    effective_baseline_id = (baseline or {}).get("run_id")

    # Run per-deal evaluation
    deal_results: list[DealRegressionResult] = []

    for deal_name, gt in all_gt.items():
        deal_id = gt.get("deal_id")
        if not deal_id:
            # Try to resolve by name
            deal_id = _resolve_deal_id_by_name(conn, deal_name)
        if not deal_id:
            print(f"[regression_runner] WARNING: deal '{deal_name}' not found in DB — skipping", file=sys.stderr)
            continue

        try:
            docs = fetch_documents_for_classification(conn, deal_id)
            doc_type = classify_deal_documents(docs)["deal_type"]
            pp = fetch_product_profile_v1(conn, deal_id)
            fb = fetch_understanding_fallback_inputs(conn, deal_id)
            understanding = build_deal_understanding_v1(
                deal_id, pp,
                deal_facts=fb["deal_facts"],
                governed_summary=fb["governed_summary"],
                doc_type=doc_type,
            )

            # Build system financials from DB (metric_key → first numeric value)
            system_financials = _fetch_financial_totals(conn, deal_id)

            scores = compute_ground_truth_accuracy(understanding, gt, system_financials)

        except Exception as exc:
            print(f"[regression_runner] ERROR processing '{deal_name}': {exc}", file=sys.stderr)
            continue

        # Pull baseline scores for this deal
        baseline_scores = (baseline or {}).get("deals", {}).get(deal_name, {})

        fin_coverage = _fetch_financial_coverage_signals(conn, deal_id)
        fin_slides   = _fetch_financial_slide_signals(conn, deal_id)

        from lib.section_quality import compute_section_labels
        section_labels = compute_section_labels(
            slot_verdicts=scores["slot_verdicts"],
            financial_verdicts=scores["financial_verdicts"],
            financial_coverage_pct=fin_coverage.get("financial_coverage_pct"),
            financial_conflict_count=fin_coverage.get("financial_conflict_count", 0),
            financial_slide_sources=fin_slides.get("financial_slide_sources", []),
        )

        deal_results.append(DealRegressionResult(
            deal_name=deal_name,
            baseline_semantic=baseline_scores.get("semantic_accuracy"),
            baseline_financial=baseline_scores.get("financial_accuracy"),
            baseline_overall=baseline_scores.get("overall_accuracy"),
            current_semantic=scores["semantic_accuracy"],
            current_financial=scores["financial_accuracy"],
            current_overall=scores["overall_accuracy"],
            slot_verdicts=scores["slot_verdicts"],
            financial_verdicts=scores["financial_verdicts"],
            section_labels=section_labels,
            **{**fin_coverage, **fin_slides},
        ))

    # Persist current run as new baseline
    write_baseline(run_id, deal_results)

    # Detect regressions
    regression_flags = []
    for dr in deal_results:
        regression_flags.extend(dr.regression_flags(threshold_pts))

    status = "fail" if regression_flags else "pass"

    # Write report
    REGRESSION_REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    report_path = REGRESSION_REPORTS_DIR / f"{run_id}.md"
    report_text = _build_report(
        run_id=run_id,
        baseline_run_id=effective_baseline_id,
        generated_at=generated_at,
        deal_results=deal_results,
        regression_flags=regression_flags,
        status=status,
        threshold_pts=threshold_pts,
    )
    report_path.write_text(report_text, encoding="utf-8")

    result = RegressionRunResult(
        run_id=run_id,
        baseline_run_id=effective_baseline_id,
        generated_at=generated_at,
        deal_results=deal_results,
        report_path=report_path,
        status=status,
    )

    if raise_on_failure and regression_flags:
        raise RegressionFailure(
            f"Regression benchmark FAILED ({len(regression_flags)} issue(s)):\n"
            + "\n".join(f"  • {f}" for f in regression_flags)
        )

    return result


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _resolve_deal_id_by_name(conn: Any, name: str) -> Optional[str]:
    """Resolve a deal UUID from a partial name match."""
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id::text FROM deals WHERE lower(name) LIKE lower(%s) AND deleted_at IS NULL"
                " ORDER BY created_at DESC LIMIT 1",
                (f"%{name}%",),
            )
            row = cur.fetchone()
            if row:
                return list(row.values())[0] if hasattr(row, "values") else row[0]
    except Exception:
        pass
    return None


# ---------------------------------------------------------------------------
# Financial coverage / conflict signals  (Phase 9)
# ---------------------------------------------------------------------------

_ALL_TRACKED_METRICS = [
    # income statement
    "revenue", "cogs", "gross_profit", "gross_margin", "opex", "ebitda", "net_income",
    # unit economics
    "arr", "mrr", "cac", "ltv", "arpu", "churn_pct", "retention_pct",
    # cash flow
    "cash", "burn_rate", "runway_months",
]  # 17 total
_TRACKED_METRICS_SET = set(_ALL_TRACKED_METRICS)
_CONFLICT_DIVERGENCE_THRESHOLD = 0.05  # 5% relative


# ---------------------------------------------------------------------------
# Financial slide-source signals  (Phase 10)
# ---------------------------------------------------------------------------

_SLIDE_CONFIDENCE_BOOST: dict[str, int] = {
    "financials":   4,
    "traction":     3,
    "raise_terms":  2,
    "use_of_funds": 1,
    "team":        -2,
    "market":      -2,
}


def _fetch_financial_slide_signals(
    conn: Any,
    deal_id: str,
) -> dict:
    """
    Query financial_facts_v1 for Phase-10 slide metadata.

    Returns a dict with keys matching DealRegressionResult phase-10 fields:
        financial_slide_sources          — sorted list of distinct slide_types
        financial_slide_confidence_boosts — count of facts that received boost >= 2
    """
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT slide_type, confidence"
                " FROM financial_facts_v1"
                " WHERE deal_id = %s AND slide_type IS NOT NULL",
                (deal_id,),
            )
            rows = cur.fetchall()
    except Exception:
        return {"financial_slide_sources": [], "financial_slide_confidence_boosts": 0}

    if not rows:
        return {"financial_slide_sources": [], "financial_slide_confidence_boosts": 0}

    slide_types: set[str] = set()
    boost_count = 0
    for row in rows:
        d = dict(row) if hasattr(row, "keys") else {"slide_type": row[0], "confidence": row[1]}
        st = d.get("slide_type") or ""
        if st:
            slide_types.add(st)
            boost = _SLIDE_CONFIDENCE_BOOST.get(st, 0)
            if boost >= 2:
                boost_count += 1

    return {
        "financial_slide_sources":          sorted(slide_types),
        "financial_slide_confidence_boosts": boost_count,
    }


def _fetch_financial_coverage_signals(
    conn: Any,
    deal_id: str,
) -> dict:
    """
    Compute financial coverage % and conflict count from financial_facts_v1.

    Returns a dict with keys matching DealRegressionResult phase-9 fields:
        financial_coverage_pct   — 0-100 integer  (or None on DB error)
        financial_conflict_count — integer
        financial_risk_flags     — list[str]
    """
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT metric_key, period_label, value"
                " FROM financial_facts_v1"
                " WHERE deal_id = %s",
                (deal_id,),
            )
            rows = cur.fetchall()
    except Exception:
        return {"financial_coverage_pct": None, "financial_conflict_count": 0, "financial_risk_flags": []}

    if not rows:
        return {"financial_coverage_pct": 0, "financial_conflict_count": 0, "financial_risk_flags": []}

    # ── Coverage ─────────────────────────────────────────────────────────────
    present_metrics: set[str] = set()
    slot_values: dict[str, list[float]] = {}   # "metric_key:period_label" → [values]

    for row in rows:
        d = dict(row) if hasattr(row, "keys") else {
            "metric_key": row[0], "period_label": row[1], "value": row[2]
        }
        mk  = d.get("metric_key") or ""
        pl  = str(d.get("period_label") or "").lower()
        val = d.get("value")
        if val is None:
            continue
        try:
            val_f = float(val)
        except (TypeError, ValueError):
            continue
        present_metrics.add(mk)
        slot_values.setdefault(f"{mk}:{pl}", []).append(val_f)

    tracked_present = _TRACKED_METRICS_SET & present_metrics
    coverage_pct = round(len(tracked_present) / len(_ALL_TRACKED_METRICS) * 100)

    # ── Conflict detection ───────────────────────────────────────────────────
    conflict_metrics: set[str] = set()
    for key, values in slot_values.items():
        if len(values) < 2:
            continue
        min_v, max_v = min(values), max(values)
        if min_v == 0:
            continue
        if (max_v - min_v) / abs(min_v) > _CONFLICT_DIVERGENCE_THRESHOLD:
            conflict_metrics.add(key.split(":")[0])

    conflict_count = len(conflict_metrics)

    # ── Risk flags ───────────────────────────────────────────────────────────
    flags: list[str] = []
    if coverage_pct < 30:
        flags.append("low_coverage")
    if "revenue" in conflict_metrics:
        flags.append("revenue_conflict")
    if "arr" in conflict_metrics:
        flags.append("arr_conflict")
    if "burn_rate" in conflict_metrics:
        flags.append("burn_conflict")
    if "burn_rate" in present_metrics and "runway_months" not in present_metrics:
        flags.append("burn_without_runway")
    if conflict_count >= 3:
        flags.append("high_conflict_count")

    return {
        "financial_coverage_pct":   coverage_pct,
        "financial_conflict_count": conflict_count,
        "financial_risk_flags":     sorted(flags),
    }


def _fetch_financial_totals(conn: Any, deal_id: str) -> dict:
    """
    Build a dict of {metric_key: numeric_value} from financial_facts_v1.

    When multiple rows exist for the same metric_key, the row with
    period_label = 'current' is preferred; otherwise the first row is used.
    """
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT metric_key, period_label, value FROM financial_facts_v1"
                " WHERE deal_id = %s ORDER BY metric_key, period_label",
                (deal_id,),
            )
            rows = cur.fetchall()
    except Exception:
        return {}

    result: dict = {}
    seen: dict = {}  # metric_key → (period_label, value)

    for row in rows:
        row_dict = dict(row) if hasattr(row, "keys") else {"metric_key": row[0], "period_label": row[1], "value": row[2]}
        mk = row_dict.get("metric_key") or ""
        pl = str(row_dict.get("period_label") or "").lower()
        val = row_dict.get("value")
        if val is None:
            continue
        try:
            val_float = float(val)
        except (TypeError, ValueError):
            continue

        if mk not in seen or pl in ("current", "ttm", "monthly"):
            seen[mk] = (pl, val_float)

    for mk, (_, val) in seen.items():
        result[mk] = val

    return result


# ---------------------------------------------------------------------------
# Report builder
# ---------------------------------------------------------------------------


def _build_report(
    run_id: str,
    baseline_run_id: Optional[str],
    generated_at: str,
    deal_results: list[DealRegressionResult],
    regression_flags: list[str],
    status: str,
    threshold_pts: float,
) -> str:
    lines: list[str] = []

    lines.append("# Regression Benchmark Report\n")
    lines.append(f"_Generated: {generated_at}_  ")
    lines.append(f"_Run ID: `{run_id}`_  ")
    if baseline_run_id:
        lines.append(f"_Baseline Run: `{baseline_run_id}`_  ")
    else:
        lines.append("_Baseline Run: none (first run — this run becomes the baseline)_  ")
    lines.append(f"_Threshold: –{threshold_pts:.0f} percentage points_\n")
    lines.append(f"## Status: {'✅ PASS' if status == 'pass' else '❌ FAIL'}\n")

    if regression_flags:
        lines.append("### Regression Failures\n")
        for f in regression_flags:
            lines.append(f"- ⛔ {f}")
        lines.append("")

    # Per-deal table
    lines.append("## Per-Deal Accuracy\n")
    lines.append("_Accuracy values are 0.0–1.0 (automated ground-truth comparison)._\n")
    headers = ["Deal", "Semantic (baseline)", "Semantic (current)", "Δ Semantic",
               "Financial (baseline)", "Financial (current)", "Δ Financial",
               "Overall (baseline)", "Overall (current)", "Δ Overall"]
    lines.append("| " + " | ".join(headers) + " |")
    lines.append("| " + " | ".join(["---"] * len(headers)) + " |")

    for dr in deal_results:
        row = [
            dr.deal_name,
            _fmt(dr.baseline_semantic),  _fmt(dr.current_semantic),  _delta_str(dr.semantic_delta),
            _fmt(dr.baseline_financial), _fmt(dr.current_financial), _delta_str(dr.financial_delta),
            _fmt(dr.baseline_overall),   _fmt(dr.current_overall),   _delta_str(dr.overall_delta),
        ]
        lines.append("| " + " | ".join(row) + " |")

    lines.append("")

    # Per-deal slot verdicts + section quality labels
    lines.append("## Per-Deal Slot Verdicts\n")
    for dr in deal_results:
        if not dr.slot_verdicts and not dr.section_labels:
            continue
        lines.append(f"### {dr.deal_name}\n")
        if dr.slot_verdicts:
            lines.append("| Slot | Verdict |")
            lines.append("| --- | --- |")
            for slot, verdict in sorted(dr.slot_verdicts.items()):
                lines.append(f"| {slot} | {verdict} |")
        if dr.financial_verdicts:
            lines.append("\n**Financial verdicts:**\n")
            lines.append("| Metric | Verdict |")
            lines.append("| --- | --- |")
            for metric, verdict in sorted(dr.financial_verdicts.items()):
                lines.append(f"| {metric} | {verdict} |")
        if dr.section_labels:
            lines.append("\n**Section quality:**\n")
            lines.append("| Section | Label | Note |")
            lines.append("| --- | --- | --- |")
            from lib.section_quality import INVESTOR_SECTIONS
            for section in INVESTOR_SECTIONS:
                if section in dr.section_labels:
                    lbl, note = dr.section_labels[section]
                    lines.append(f"| {section} | {lbl} | {note} |")
        lines.append("")

    # Overall averages
    avg_sem_b = _avg([d.baseline_semantic  for d in deal_results])
    avg_fin_b = _avg([d.baseline_financial for d in deal_results])
    avg_ovr_b = _avg([d.baseline_overall   for d in deal_results])
    avg_sem_c = _avg([d.current_semantic   for d in deal_results])
    avg_fin_c = _avg([d.current_financial  for d in deal_results])
    avg_ovr_c = _avg([d.current_overall    for d in deal_results])

    lines.append("## Overall Averages\n")
    lines.append("| Metric | Baseline | Current | Δ |")
    lines.append("| --- | --- | --- | --- |")
    for label, b, c in [
        ("Semantic Accuracy",  avg_sem_b, avg_sem_c),
        ("Financial Accuracy", avg_fin_b, avg_fin_c),
        ("Overall Accuracy",   avg_ovr_b, avg_ovr_c),
    ]:
        delta = round(c - b, 4) if (b is not None and c is not None) else None
        lines.append(f"| {label} | {_fmt(b)} | {_fmt(c)} | {_delta_str(delta)} |")

    lines.append("")

    # Financial Coverage Signals (Phase 9)
    has_signals = any(d.financial_coverage_pct is not None for d in deal_results)
    if has_signals:
        lines.append("## Financial Coverage Signals\n")
        lines.append("_Coverage = % of 17 tracked metrics present in financial_facts_v1._\n")
        lines.append("| Deal | Coverage % | Conflicts | Risk Flags |")
        lines.append("| --- | --- | --- | --- |")
        for dr in deal_results:
            cov   = f"{dr.financial_coverage_pct}%" if dr.financial_coverage_pct is not None else "—"
            flags = ", ".join(dr.financial_risk_flags) if dr.financial_risk_flags else "none"
            lines.append(f"| {dr.deal_name} | {cov} | {dr.financial_conflict_count} | {flags} |")
        lines.append("")

    # Financial Slide Sources (Phase 10)
    has_slide_signals = any(d.financial_slide_sources for d in deal_results)
    if has_slide_signals:
        lines.append("## Financial Slide Sources (Phase 10)\n")
        lines.append("_Facts extracted from slide-classified pages; confidence boosts applied per slide type._\n")
        lines.append("| Deal | Slide Sources | High-Confidence Boosts |")
        lines.append("| --- | --- | --- |")
        for dr in deal_results:
            sources = ", ".join(dr.financial_slide_sources) if dr.financial_slide_sources else "none"
            lines.append(f"| {dr.deal_name} | {sources} | {dr.financial_slide_confidence_boosts} |")
        lines.append("")

    # Section Quality Matrix — cross-deal summary
    has_section_labels = any(d.section_labels for d in deal_results)
    if has_section_labels:
        from lib.section_quality import INVESTOR_SECTIONS
        deal_names = [d.deal_name for d in deal_results]
        lines.append("## Section Quality Matrix\n")
        lines.append(
            "_Labels: **Strong** = well-supported · Partial = thin evidence · "
            "Weak = low-confidence · Missing = absent / not tracked_\n"
        )
        header = ["Section"] + deal_names
        lines.append("| " + " | ".join(header) + " |")
        lines.append("| " + " | ".join(["---"] * len(header)) + " |")

        for section in INVESTOR_SECTIONS:
            row = [section]
            for dr in deal_results:
                if section in dr.section_labels:
                    lbl, note = dr.section_labels[section]
                    # Compact cell: label only (tooltip-style note omitted for width)
                    row.append(lbl)
                else:
                    row.append("—")
            lines.append("| " + " | ".join(row) + " |")
        lines.append("")

    return "\n".join(lines)

