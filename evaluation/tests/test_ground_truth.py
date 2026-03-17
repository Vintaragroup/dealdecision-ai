"""
evaluation/tests/test_ground_truth.py
======================================

Tests for Phase 7 — Ground Truth Dataset + Regression Benchmark.

Coverage:
  - GroundTruthLoader: file loading, missing file, malformed file, load_all
  - GroundTruthCompare: compare_slot (string, bool, list, numeric), edge cases
  - compute_ground_truth_accuracy: per-deal accuracy calculation
  - RegressionRunner: threshold detection, RegressionFailure, baseline persistence,
                      report generation, backward compat (no baseline)

Run from repo root:
  python -m pytest evaluation/tests/test_ground_truth.py -v

Or from evaluation/:
  python -m pytest tests/test_ground_truth.py -v
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path
from typing import Any

_EVAL_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _EVAL_ROOT not in sys.path:
    sys.path.insert(0, _EVAL_ROOT)

import pytest

from benchmark.ground_truth_loader import (
    GroundTruthNotFoundError,
    load_all_ground_truth,
    list_ground_truth_deals,
    _gt_path,
    _load_from_path,
)
from benchmark.ground_truth_compare import (
    CORRECT,
    PARTIAL,
    INCORRECT,
    UNSUPPORTED,
    compare_slot,
    compare_financial,
    compute_ground_truth_accuracy,
    _str_compare,
    _bool_compare,
    _list_compare,
    _numeric_compare,
)
from benchmark.regression_runner import (
    RegressionFailure,
    DealRegressionResult,
    RegressionRunResult,
    write_baseline,
    load_baseline,
    load_latest_baseline,
    _avg,
    _fmt,
    _delta_str,
    REGRESSION_THRESHOLD_PTS,
)
from lib.deal_understanding_v1 import build_deal_understanding_v1, SLOT_DEFINITIONS


# ─── Shared fixtures ──────────────────────────────────────────────────────────

DEAL_ID = "test-deal-00000000-0000-0000-0000-000000000099"

FULL_PROFILE = {
    "schema_version": "product_profile_v1",
    "company_description": "Acme Corp builds AI-powered widget ops tooling for enterprise teams.",
    "problem_statement": "Widget management is fragmented and manual.",
    "solution_summary": "A SaaS platform unifying widget ingestion and analysis.",
    "product_type": "SaaS",
    "delivery_model": "B2B SaaS",
    "target_customer": "Enterprise widget operations teams",
    "buyer_persona": "Head of Widget Operations",
    "core_workflow": ["Ingest widgets", "Analyse widgets", "Report findings"],
    "core_features": ["Widget ingestion", "AI analysis pipeline", "Dashboard"],
    "differentiation_claims": ["Only AI-native widget platform", "5-minute onboarding"],
    "integrations_or_dependencies": ["Salesforce", "Slack"],
    "product_maturity": "GA",
    "ai_claims_present": True,
    "ai_usage_summary": "LLMs for widget defect classification.",
    "ai_usage_type": "LLM as core feature",
    "ai_defensibility_notes": "Proprietary widget training corpus.",
    "ai_evidence_strength": "strong",
    "evidence": {},
    "sources": [],
}


def _make_understanding(profile=None):
    return build_deal_understanding_v1(DEAL_ID, profile or FULL_PROFILE)


def _make_gt(**overrides):
    base = {
        "_schema": "ground_truth_v1",
        "deal_name": "TestDeal",
        "slots": {
            "company_description": "Acme Corp builds AI-powered widget ops tooling",
            "product_type": "SaaS",
            "delivery_model": "B2B SaaS",
            "ai_claims_present": True,
            "core_features": ["Widget ingestion", "AI analysis pipeline"],
        },
        "financials": {},
    }
    base.update(overrides)
    return base


# ─────────────────────────────────────────────────────────────────────────────
# TestGroundTruthLoader
# ─────────────────────────────────────────────────────────────────────────────

class TestGroundTruthLoader:
    """Tests for ground_truth_loader.py"""

    def test_load_from_path_success(self, tmp_path):
        data = {"deal_name": "Demo", "slots": {"company_description": "x"}, "financials": {}}
        p = tmp_path / "Demo.json"
        p.write_text(json.dumps(data))
        result = _load_from_path(p, "Demo")
        assert result["deal_name"] == "Demo"
        assert result["slots"]["company_description"] == "x"

    def test_load_from_path_adds_defaults(self, tmp_path):
        data = {"deal_name": "Demo"}  # missing 'slots' and 'financials'
        p = tmp_path / "Demo.json"
        p.write_text(json.dumps(data))
        result = _load_from_path(p, "Demo")
        assert result["slots"] == {}
        assert result["financials"] == {}

    def test_load_from_path_missing(self, tmp_path):
        with pytest.raises(GroundTruthNotFoundError):
            _load_from_path(tmp_path / "Missing.json", "Missing")

    def test_load_from_path_invalid_json(self, tmp_path):
        p = tmp_path / "Bad.json"
        p.write_text("{invalid json}")
        with pytest.raises(ValueError, match="Invalid JSON"):
            _load_from_path(p, "Bad")

    def test_load_from_path_not_a_dict(self, tmp_path):
        p = tmp_path / "Bad.json"
        p.write_text("[1, 2, 3]")
        with pytest.raises(ValueError, match="JSON object"):
            _load_from_path(p, "Bad")

    def test_load_all_ground_truth_empty_dir(self, tmp_path):
        result = load_all_ground_truth(tmp_path)
        assert result == {}

    def test_load_all_ground_truth_missing_dir(self, tmp_path):
        result = load_all_ground_truth(tmp_path / "nonexistent")
        assert result == {}

    def test_load_all_ground_truth_multiple(self, tmp_path):
        for name in ["Alpha", "Beta", "Gamma"]:
            p = tmp_path / f"{name}.json"
            p.write_text(json.dumps({"deal_name": name, "slots": {}, "financials": {}}))
        result = load_all_ground_truth(tmp_path)
        assert set(result.keys()) == {"Alpha", "Beta", "Gamma"}

    def test_load_all_ground_truth_skips_invalid(self, tmp_path, capsys):
        good = tmp_path / "Good.json"
        good.write_text(json.dumps({"deal_name": "Good", "slots": {}, "financials": {}}))
        bad = tmp_path / "Bad.json"
        bad.write_text("{broken")
        result = load_all_ground_truth(tmp_path)
        assert "Good" in result
        assert "Bad" not in result
        # Warning should have been printed to stderr
        captured = capsys.readouterr()
        assert "Bad" in captured.err

    def test_list_ground_truth_deals(self, tmp_path):
        for name in ["X", "Y"]:
            (tmp_path / f"{name}.json").write_text("{}")
        result = list_ground_truth_deals(tmp_path)
        assert result == ["X", "Y"]

    def test_list_ground_truth_deals_empty(self, tmp_path):
        assert list_ground_truth_deals(tmp_path) == []

    def test_deal_name_falls_back_to_stem(self, tmp_path):
        # File without deal_name key — should use filename stem
        p = tmp_path / "MyDeal.json"
        p.write_text(json.dumps({"slots": {}, "financials": {}}))
        result = load_all_ground_truth(tmp_path)
        assert "MyDeal" in result


# ─────────────────────────────────────────────────────────────────────────────
# TestCompareSlot — string comparison
# ─────────────────────────────────────────────────────────────────────────────

class TestCompareSlotStrings:
    """String slot comparison logic."""

    def test_exact_match(self):
        assert compare_slot("Acme Corp", "Acme Corp") == CORRECT

    def test_case_insensitive_match(self):
        assert compare_slot("acme corp", "Acme Corp") == CORRECT

    def test_substring_containment_correct(self):
        # system contains the ground truth → CORRECT if overlap is large enough
        assert compare_slot(
            "Acme Corp builds AI-powered widget ops tooling for enterprise teams",
            "Acme Corp builds AI-powered widget ops tooling",
        ) == CORRECT

    def test_partial_overlap(self):
        # shares key words but diverges significantly
        result = compare_slot("Acme Corp SaaS analytics", "Qredible compliance ecosystem blockchain")
        assert result in (PARTIAL, INCORRECT)

    def test_no_overlap_is_incorrect(self):
        assert compare_slot("xyz totally unrelated", "Acme Corp builds AI") == INCORRECT

    def test_none_system_is_unsupported(self):
        assert compare_slot(None, "some truth") == UNSUPPORTED

    def test_empty_string_system_is_unsupported(self):
        assert compare_slot("  ", "some truth") == UNSUPPORTED

    def test_none_ground_truth_is_unsupported(self):
        assert compare_slot("some value", None) == UNSUPPORTED

    def test_str_compare_direct(self):
        assert _str_compare("SaaS", "SaaS") == CORRECT
        assert _str_compare("saas", "SaaS") == CORRECT


# ─────────────────────────────────────────────────────────────────────────────
# TestCompareSlotBooleans
# ─────────────────────────────────────────────────────────────────────────────

class TestCompareSlotBooleans:
    """Boolean slot comparison."""

    def test_true_true(self):
        assert compare_slot(True, True) == CORRECT

    def test_false_false(self):
        assert compare_slot(False, False) == CORRECT

    def test_true_false_incorrect(self):
        assert compare_slot(True, False) == INCORRECT

    def test_string_true_vs_bool_true(self):
        assert compare_slot("true", True) == CORRECT

    def test_string_false_vs_bool_false(self):
        assert compare_slot("false", False) == CORRECT

    def test_wrong_string_bool(self):
        assert compare_slot("yes", False) == INCORRECT

    def test_bool_compare_direct(self):
        assert _bool_compare(True, True) == CORRECT
        assert _bool_compare(False, True) == INCORRECT


# ─────────────────────────────────────────────────────────────────────────────
# TestCompareSlotLists
# ─────────────────────────────────────────────────────────────────────────────

class TestCompareSlotLists:
    """List slot comparison."""

    def test_exact_list_match(self):
        gt = ["Widget ingestion", "AI analysis pipeline", "Dashboard"]
        sys = ["Widget ingestion", "AI analysis pipeline", "Dashboard"]
        assert compare_slot(sys, gt) == CORRECT

    def test_superset_system_list(self):
        gt = ["Widget ingestion", "AI analysis pipeline"]
        sys = ["Widget ingestion", "AI analysis pipeline", "Extra Feature", "Bonus"]
        assert compare_slot(sys, gt) == CORRECT

    def test_partial_list_overlap(self):
        gt = ["Validate regulated businesses", "Monitor compliance", "Certify products"]
        sys = ["Validate regulated businesses"]
        result = compare_slot(sys, gt)
        assert result in (PARTIAL, CORRECT)

    def test_empty_system_list(self):
        assert compare_slot([], ["Ingest", "Analyse"]) == UNSUPPORTED

    def test_empty_ground_truth_list(self):
        assert compare_slot(["something"], []) == CORRECT

    def test_list_compare_direct(self):
        assert _list_compare(["a", "b", "c"], ["a", "b"]) == CORRECT

    def test_no_overlap_list_incorrect(self):
        result = compare_slot(["unrelated item one"], ["Ingest widgets", "Analyse widgets", "Report"])
        assert result == INCORRECT


# ─────────────────────────────────────────────────────────────────────────────
# TestCompareSlotNumeric
# ─────────────────────────────────────────────────────────────────────────────

class TestCompareSlotNumeric:
    """Numeric (financial) comparison."""

    def test_exact_numeric(self):
        assert compare_slot(8000, 8000) == CORRECT

    def test_within_5_pct(self):
        assert compare_slot(8200, 8000) == CORRECT   # 2.5% delta

    def test_within_25_pct(self):
        assert compare_slot(9500, 8000) == PARTIAL    # 18.75% delta

    def test_outside_25_pct(self):
        assert compare_slot(12000, 8000) == INCORRECT  # 50% delta

    def test_zero_vs_zero(self):
        assert compare_slot(0, 0) == CORRECT

    def test_zero_vs_nonzero(self):
        assert compare_slot(0, 1000) == INCORRECT

    def test_compare_financial_correct(self):
        assert compare_financial(381000, 381000) == CORRECT

    def test_compare_financial_partial(self):
        # 440000 vs 381000 is ~15.5% delta → within 25% → PARTIAL
        assert compare_financial(440000, 381000) == PARTIAL

    def test_compare_financial_none_system(self):
        assert compare_financial(None, 381000) == UNSUPPORTED

    def test_numeric_compare_direct(self):
        assert _numeric_compare(100, 100) == CORRECT
        assert _numeric_compare(120, 100) == PARTIAL
        assert _numeric_compare(200, 100) == INCORRECT


# ─────────────────────────────────────────────────────────────────────────────
# TestComputeGroundTruthAccuracy
# ─────────────────────────────────────────────────────────────────────────────

class TestComputeGroundTruthAccuracy:
    """Per-deal accuracy calculation from ground truth."""

    def test_all_correct_slots(self):
        u = _make_understanding()
        gt = _make_gt(slots={
            "company_description": "Acme Corp builds AI-powered widget ops tooling",
            "product_type": "SaaS",
            "delivery_model": "B2B SaaS",
        })
        result = compute_ground_truth_accuracy(u, gt)
        assert result["semantic_accuracy"] is not None
        assert result["semantic_accuracy"] >= 0.8
        assert result["slots_evaluated"] == 3

    def test_incorrect_slot_lowers_accuracy(self):
        u = _make_understanding()
        gt = _make_gt(slots={
            "company_description": "Completely different business in agriculture",
            "product_type": "Hardware",
        })
        result = compute_ground_truth_accuracy(u, gt)
        # At least one incorrect → accuracy < 1.0
        assert result["semantic_accuracy"] is not None
        assert result["semantic_accuracy"] < 1.0

    def test_no_gt_slots_returns_none_semantic(self):
        u = _make_understanding()
        gt = {"deal_name": "T", "slots": {}, "financials": {}}
        result = compute_ground_truth_accuracy(u, gt)
        assert result["semantic_accuracy"] is None
        assert result["slots_evaluated"] == 0

    def test_financial_accuracy_computed(self):
        u = _make_understanding()
        gt = _make_gt(financials={"revenue": 8000})
        sys_fin = {"revenue": 8100}   # within 5% → CORRECT
        result = compute_ground_truth_accuracy(u, gt, system_financials=sys_fin)
        assert result["financial_accuracy"] == 1.0
        assert result["financials_evaluated"] == 1

    def test_financial_accuracy_wrong(self):
        u = _make_understanding()
        gt = _make_gt(financials={"revenue": 8000})
        sys_fin = {"revenue": 999}    # way off → INCORRECT
        result = compute_ground_truth_accuracy(u, gt, system_financials=sys_fin)
        assert result["financial_accuracy"] == 0.0

    def test_no_system_financials_returns_none_financial(self):
        u = _make_understanding()
        gt = _make_gt(financials={"arr": 381000})
        result = compute_ground_truth_accuracy(u, gt, system_financials=None)
        assert result["financial_accuracy"] is None

    def test_overall_accuracy_blends_sem_and_fin(self):
        u = _make_understanding()
        gt = _make_gt(
            slots={"company_description": "Acme Corp builds AI-powered widget ops tooling"},
            financials={"revenue": 8000},
        )
        sys_fin = {"revenue": 8000}
        result = compute_ground_truth_accuracy(u, gt, system_financials=sys_fin)
        # Both correct → overall should be near 1.0
        assert result["overall_accuracy"] is not None
        assert result["overall_accuracy"] >= 0.85

    def test_overall_falls_back_to_semantic_only(self):
        u = _make_understanding()
        gt = _make_gt(slots={"product_type": "SaaS"}, financials={})
        result = compute_ground_truth_accuracy(u, gt)
        assert result["overall_accuracy"] == result["semantic_accuracy"]

    def test_slot_verdicts_returned(self):
        u = _make_understanding()
        gt = _make_gt(slots={"product_type": "SaaS", "delivery_model": "B2B SaaS"})
        result = compute_ground_truth_accuracy(u, gt)
        assert "product_type" in result["slot_verdicts"]
        assert "delivery_model" in result["slot_verdicts"]

    def test_boolean_slot_evaluated(self):
        u = _make_understanding()
        gt = _make_gt(slots={"ai_claims_present": True})
        result = compute_ground_truth_accuracy(u, gt)
        assert result["slot_verdicts"]["ai_claims_present"] == CORRECT


# ─────────────────────────────────────────────────────────────────────────────
# TestRegressionThresholds
# ─────────────────────────────────────────────────────────────────────────────

class TestRegressionThresholds:
    """Regression failure detection via DealRegressionResult.regression_flags."""

    def _make_dr(self, *, b_sem=0.80, c_sem=0.80, b_fin=None, c_fin=None, b_ovr=0.80, c_ovr=0.80):
        return DealRegressionResult(
            deal_name="TestDeal",
            baseline_semantic=b_sem,
            current_semantic=c_sem,
            baseline_financial=b_fin,
            current_financial=c_fin,
            baseline_overall=b_ovr,
            current_overall=c_ovr,
        )

    def test_no_regression_no_flags(self):
        dr = self._make_dr(b_sem=0.80, c_sem=0.82)
        assert dr.regression_flags() == []

    def test_small_drop_no_flag(self):
        # 3pp drop, threshold is 5pp
        dr = self._make_dr(b_sem=0.80, c_sem=0.77)
        assert dr.regression_flags() == []

    def test_exact_threshold_no_flag(self):
        # Exactly 5pp drop — NOT a failure (strictly greater than threshold)
        dr = self._make_dr(b_sem=0.80, c_sem=0.75)
        assert dr.regression_flags() == []

    def test_exceeds_threshold_raises_flag(self):
        # 6pp drop
        dr = self._make_dr(b_sem=0.80, c_sem=0.74)
        flags = dr.regression_flags()
        assert len(flags) == 1
        assert "semantic_accuracy" in flags[0]

    def test_overall_regression_flagged(self):
        dr = self._make_dr(b_ovr=0.85, c_ovr=0.78)
        flags = dr.regression_flags()
        assert any("overall_accuracy" in f for f in flags)

    def test_improvement_is_not_flagged(self):
        dr = self._make_dr(b_sem=0.70, c_sem=0.90)
        assert dr.regression_flags() == []

    def test_none_baseline_not_flagged(self):
        # No baseline → can't compute delta → no flag
        dr = self._make_dr(b_sem=None, c_sem=0.80)
        assert dr.regression_flags() == []

    def test_none_current_not_flagged(self):
        dr = self._make_dr(b_sem=0.80, c_sem=None)
        assert dr.regression_flags() == []

    def test_custom_threshold(self):
        # With a 10pp threshold, a 7pp drop should NOT flag
        dr = self._make_dr(b_sem=0.80, c_sem=0.73)
        assert dr.regression_flags(threshold_pts=10.0) == []

    def test_multiple_metrics_flagged(self):
        dr = DealRegressionResult(
            deal_name="TestDeal",
            baseline_semantic=0.90,
            current_semantic=0.80,   # 10pp drop
            baseline_financial=0.85,
            current_financial=0.75,  # 10pp drop
            baseline_overall=0.88,
            current_overall=0.78,    # 10pp drop
        )
        flags = dr.regression_flags()
        assert len(flags) == 3


# ─────────────────────────────────────────────────────────────────────────────
# TestBaselinePersistence
# ─────────────────────────────────────────────────────────────────────────────

class TestBaselinePersistence:
    """Baseline file write and load."""

    def _make_deal_results(self) -> list:
        return [
            DealRegressionResult(
                deal_name="Alpha",
                baseline_semantic=None, baseline_financial=None, baseline_overall=None,
                current_semantic=0.85, current_financial=0.90, current_overall=0.87,
            ),
            DealRegressionResult(
                deal_name="Beta",
                baseline_semantic=None, baseline_financial=None, baseline_overall=None,
                current_semantic=0.70, current_financial=None, current_overall=0.70,
            ),
        ]

    def test_write_and_load_baseline(self, tmp_path, monkeypatch):
        import benchmark.regression_runner as rr
        monkeypatch.setattr(rr, "BASELINES_DIR", tmp_path / "baselines")

        dr_list = self._make_deal_results()
        out_path = write_baseline("test-run-01", dr_list)
        assert out_path.exists()

        loaded = load_baseline.__wrapped__("test-run-01") if hasattr(load_baseline, "__wrapped__") else None
        # Direct file check
        data = json.loads(out_path.read_text())
        assert data["run_id"] == "test-run-01"
        assert "Alpha" in data["deals"]
        assert data["deals"]["Alpha"]["semantic_accuracy"] == 0.85
        assert data["deals"]["Beta"]["financial_accuracy"] is None

    def test_load_baseline_missing_returns_none(self, tmp_path, monkeypatch):
        import benchmark.regression_runner as rr
        monkeypatch.setattr(rr, "BASELINES_DIR", tmp_path / "baselines")
        result = load_baseline("nonexistent-run")
        assert result is None

    def test_load_latest_baseline_returns_most_recent(self, tmp_path, monkeypatch):
        import benchmark.regression_runner as rr
        monkeypatch.setattr(rr, "BASELINES_DIR", tmp_path / "baselines")

        dr_list = self._make_deal_results()
        write_baseline("aaa-run-01", dr_list)
        write_baseline("zzz-run-02", dr_list)

        # Modify the second one so we can tell them apart
        second_path = (tmp_path / "baselines" / "zzz-run-02.json")
        data = json.loads(second_path.read_text())
        data["deals"]["Alpha"]["semantic_accuracy"] = 0.99
        second_path.write_text(json.dumps(data))

        latest = load_latest_baseline()
        assert latest is not None
        assert latest["run_id"] == "zzz-run-02"
        assert latest["deals"]["Alpha"]["semantic_accuracy"] == 0.99

    def test_load_latest_baseline_no_files_returns_none(self, tmp_path, monkeypatch):
        import benchmark.regression_runner as rr
        monkeypatch.setattr(rr, "BASELINES_DIR", tmp_path / "baselines")
        assert load_latest_baseline() is None


# ─────────────────────────────────────────────────────────────────────────────
# TestRegressionReportGeneration
# ─────────────────────────────────────────────────────────────────────────────

class TestRegressionReportGeneration:
    """Regression report format and content."""

    def _make_run_result(self, status="pass") -> RegressionRunResult:
        deals = [
            DealRegressionResult(
                deal_name="WebMax",
                baseline_semantic=0.80, baseline_financial=0.90, baseline_overall=0.84,
                current_semantic=0.85, current_financial=0.92, current_overall=0.87,
                slot_verdicts={"company_description": CORRECT, "delivery_model": PARTIAL},
                financial_verdicts={"revenue": CORRECT},
            ),
            DealRegressionResult(
                deal_name="Qredible",
                baseline_semantic=0.83, baseline_financial=None, baseline_overall=0.83,
                current_semantic=0.83, current_financial=None, current_overall=0.83,
                slot_verdicts={"company_description": CORRECT, "product_type": INCORRECT},
            ),
        ]
        return RegressionRunResult(
            run_id="test-run-report",
            baseline_run_id="test-baseline",
            generated_at="2026-03-10T00:00:00+00:00",
            deal_results=deals,
            status=status,
        )

    def test_report_contains_run_id(self):
        from benchmark.regression_runner import _build_report
        result = self._make_run_result()
        report = _build_report(
            run_id="test-run-report",
            baseline_run_id="test-baseline",
            generated_at="2026-03-10T00:00:00+00:00",
            deal_results=result.deal_results,
            regression_flags=[],
            status="pass",
            threshold_pts=5.0,
        )
        assert "test-run-report" in report
        assert "test-baseline" in report

    def test_report_shows_pass(self):
        from benchmark.regression_runner import _build_report
        report = _build_report(
            run_id="r1", baseline_run_id=None,
            generated_at="2026-03-10T00:00:00+00:00",
            deal_results=self._make_run_result().deal_results,
            regression_flags=[],
            status="pass",
            threshold_pts=5.0,
        )
        assert "PASS" in report

    def test_report_shows_fail_with_flags(self):
        from benchmark.regression_runner import _build_report
        flags = ["WebMax/semantic_accuracy: 80.0% → 70.0% (Δ -10.0pp, threshold –5pp)"]
        report = _build_report(
            run_id="r1", baseline_run_id=None,
            generated_at="2026-03-10T00:00:00+00:00",
            deal_results=self._make_run_result().deal_results,
            regression_flags=flags,
            status="fail",
            threshold_pts=5.0,
        )
        assert "FAIL" in report
        assert "WebMax/semantic_accuracy" in report

    def test_report_contains_deal_names(self):
        from benchmark.regression_runner import _build_report
        report = _build_report(
            run_id="r1", baseline_run_id=None,
            generated_at="2026-03-10T00:00:00+00:00",
            deal_results=self._make_run_result().deal_results,
            regression_flags=[],
            status="pass",
            threshold_pts=5.0,
        )
        assert "WebMax" in report
        assert "Qredible" in report

    def test_report_contains_slot_verdicts(self):
        from benchmark.regression_runner import _build_report
        report = _build_report(
            run_id="r1", baseline_run_id=None,
            generated_at="2026-03-10T00:00:00+00:00",
            deal_results=self._make_run_result().deal_results,
            regression_flags=[],
            status="pass",
            threshold_pts=5.0,
        )
        assert "company_description" in report
        assert "correct" in report

    def test_report_no_baseline_run(self):
        from benchmark.regression_runner import _build_report
        report = _build_report(
            run_id="r1", baseline_run_id=None,
            generated_at="2026-03-10T00:00:00+00:00",
            deal_results=self._make_run_result().deal_results,
            regression_flags=[],
            status="pass",
            threshold_pts=5.0,
        )
        assert "first run" in report or "none" in report.lower()


# ─────────────────────────────────────────────────────────────────────────────
# TestRegressionRunModel
# ─────────────────────────────────────────────────────────────────────────────

class TestRegressionRunModel:
    """RegressionRunResult aggregate helpers."""

    def _deals(self):
        return [
            DealRegressionResult(
                deal_name="A",
                baseline_semantic=0.80, baseline_financial=0.70, baseline_overall=0.76,
                current_semantic=0.85, current_financial=0.75, current_overall=0.81,
            ),
            DealRegressionResult(
                deal_name="B",
                baseline_semantic=0.60, baseline_financial=None, baseline_overall=0.60,
                current_semantic=0.65, current_financial=None, current_overall=0.65,
            ),
        ]

    def test_avg_current_semantic(self):
        r = RegressionRunResult("r1", None, "ts", self._deals())
        avg = r.avg_current_semantic
        assert avg == pytest.approx((0.85 + 0.65) / 2, rel=1e-3)

    def test_avg_excludes_none_financial(self):
        r = RegressionRunResult("r1", None, "ts", self._deals())
        avg = r.avg_current_financial
        # Only deal A has financial → avg should be 0.75, not averaged with None
        assert avg == pytest.approx(0.75)

    def test_all_regression_flags_aggregates(self):
        deals = [
            DealRegressionResult(
                deal_name="A",
                baseline_semantic=0.90, current_semantic=0.80,  # 10pp drop
                baseline_financial=None, current_financial=None,
                baseline_overall=0.90, current_overall=0.80,    # 10pp drop
            ),
        ]
        r = RegressionRunResult("r1", None, "ts", deals)
        flags = r.all_regression_flags()
        assert len(flags) >= 2

    def test_pass_status_when_no_regressions(self):
        deals = [
            DealRegressionResult(
                deal_name="A",
                baseline_semantic=0.80, current_semantic=0.82,
                baseline_financial=None, current_financial=None,
                baseline_overall=0.80, current_overall=0.82,
            ),
        ]
        r = RegressionRunResult("r1", None, "ts", deals, status="pass")
        assert r.status == "pass"
        assert r.all_regression_flags() == []


# ─────────────────────────────────────────────────────────────────────────────
# TestHelpers
# ─────────────────────────────────────────────────────────────────────────────

class TestHelpers:
    """Utility functions."""

    def test_avg_all_values(self):
        assert _avg([0.8, 0.9, 1.0]) == pytest.approx(0.9)

    def test_avg_excludes_none(self):
        assert _avg([0.8, None, 1.0]) == pytest.approx(0.9)

    def test_avg_all_none(self):
        assert _avg([None, None]) is None

    def test_avg_empty(self):
        assert _avg([]) is None

    def test_fmt_value(self):
        assert _fmt(0.75) == "75.0%"
        assert _fmt(None) == "—"
        assert _fmt(1.0) == "100.0%"

    def test_delta_str_positive(self):
        assert _delta_str(0.03) == "+3.0pp"

    def test_delta_str_negative(self):
        assert _delta_str(-0.05) == "-5.0pp"

    def test_delta_str_none(self):
        assert _delta_str(None) == "—"


# ─────────────────────────────────────────────────────────────────────────────
# TestBackwardCompatibility
# ─────────────────────────────────────────────────────────────────────────────

class TestGroundTruthBackwardCompat:
    """Ensure Phase 7 code doesn't break when baseline/GT files are absent."""

    def test_compute_accuracy_with_empty_gt(self):
        u = _make_understanding()
        gt = {"deal_name": "T", "slots": {}, "financials": {}}
        result = compute_ground_truth_accuracy(u, gt)
        assert result["semantic_accuracy"] is None
        assert result["financial_accuracy"] is None
        assert result["overall_accuracy"] is None

    def test_regression_result_no_baseline_no_flags(self):
        dr = DealRegressionResult(
            deal_name="New",
            baseline_semantic=None, baseline_financial=None, baseline_overall=None,
            current_semantic=0.80, current_financial=0.75, current_overall=0.78,
        )
        # No baseline → deltas are None → no regression flags
        assert dr.regression_flags() == []

    def test_load_all_ground_truth_nonexistent_dir(self):
        result = load_all_ground_truth(Path("/nonexistent_dir_phase7"))
        assert result == {}
