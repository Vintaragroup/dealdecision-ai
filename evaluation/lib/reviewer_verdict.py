"""
evaluation/lib/reviewer_verdict.py
====================================

Reviewer verdict enum and accuracy scoring for the Deal Understanding Benchmark.

This module introduces **evaluation-only** scoring infrastructure.
It does NOT interact with extraction pipelines.

Accuracy scoring model
-----------------------
  CORRECT     → 1.0   (system matches evidence)
  PARTIAL     → 0.5   (partially correct / slightly misinterpreted)
  INCORRECT   → 0.0   (contradicts evidence)
  UNSUPPORTED → 0.0   (claim not grounded in evidence)

Overall benchmark score weights
---------------------------------
  30%  understanding accuracy   (semantic slot verdicts)
  25%  fact accuracy            (deal_facts verdicts)
  25%  financial accuracy       (financial_facts verdicts)
  20%  narrative accuracy       (governed_summary verdict)

Failure flags
-------------
  understanding_wrong_high_confidence — INCORRECT slot with confidence >= 0.9
  financial_fact_incorrect            — any financial fact rated INCORRECT
  unsupported_claim_detected          — any slot rated UNSUPPORTED
  summary_hallucination_detected      — narrative rated UNSUPPORTED
"""

from __future__ import annotations

from enum import Enum
from typing import Optional


# ---------------------------------------------------------------------------
# Reviewer verdict enum
# ---------------------------------------------------------------------------

class ReviewerVerdict(str, Enum):
    """Reviewer-assigned accuracy verdict for a system-extracted value."""

    CORRECT     = "correct"
    PARTIAL     = "partial"
    INCORRECT   = "incorrect"
    UNSUPPORTED = "unsupported"

    @classmethod
    def from_str(cls, s: str | None) -> "ReviewerVerdict | None":
        """Parse a string verdict, returning None if blank / unrecognised."""
        if not s or not s.strip():
            return None
        try:
            return cls(s.strip().lower())
        except ValueError:
            return None

    @classmethod
    def label(cls, v: "ReviewerVerdict | str | None") -> str:
        """Human-readable label for display in tables."""
        if v is None:
            return "_[ reviewer fill ]_"
        if isinstance(v, cls):
            return v.value
        return str(v)


# ---------------------------------------------------------------------------
# Scoring weights
# ---------------------------------------------------------------------------

VERDICT_SCORE: dict[str, float] = {
    ReviewerVerdict.CORRECT:     1.0,
    ReviewerVerdict.PARTIAL:     0.5,
    ReviewerVerdict.INCORRECT:   0.0,
    ReviewerVerdict.UNSUPPORTED: 0.0,
}

OVERALL_WEIGHTS: dict[str, float] = {
    "understanding": 0.30,
    "fact":          0.25,
    "financial":     0.25,
    "narrative":     0.20,
}


def score_verdict(verdict: "ReviewerVerdict | str | None") -> float | None:
    """
    Return the numeric score for a verdict.
    Returns None when verdict is not yet recorded.
    """
    if verdict is None:
        return None
    if isinstance(verdict, str):
        v = ReviewerVerdict.from_str(verdict)
        if v is None:
            return None
        verdict = v
    return VERDICT_SCORE.get(verdict, 0.0)


# ---------------------------------------------------------------------------
# Accuracy aggregation helpers
# ---------------------------------------------------------------------------

def _pct_from_scored(verdicts: list) -> Optional[float]:
    """
    Given a list of verdicts (ReviewerVerdict | str | None), compute accuracy %.

    Only scored (non-None) verdicts are included in the denominator.
    Returns None if no verdicts have been recorded yet.

    Example:
      [CORRECT, CORRECT, CORRECT, PARTIAL, INCORRECT]
      → (1 + 1 + 1 + 0.5 + 0) / 5 = 70.0
    """
    scores: list[float] = []
    for v in verdicts:
        s = score_verdict(v)
        if s is not None:
            scores.append(s)
    if not scores:
        return None
    return round(100.0 * sum(scores) / len(scores), 1)


def semantic_accuracy_pct(slots: list) -> Optional[float]:
    """
    Compute understanding accuracy % from slot reviewer_verdict fields.

    Accepts a list of UnderstandingSlot objects.
    Returns None if no slot has a verdict recorded.

    Only populated slots are included (unpopulated slots with no verdict
    represent missing extractions, not wrong ones — verdict still optional).
    """
    verdicts = [
        getattr(s, "reviewer_verdict", None)
        for s in slots
        if getattr(s, "populated", False)
    ]
    return _pct_from_scored(verdicts)


def fact_accuracy_pct(verdicts: list) -> Optional[float]:
    """
    Compute deal_facts accuracy % from a list of verdicts.

    Accepts: list of ReviewerVerdict | str | None.
    Returns None if no verdicts recorded.
    """
    return _pct_from_scored(verdicts)


def financial_accuracy_pct(verdicts: list) -> Optional[float]:
    """
    Compute financial_facts accuracy % from a list of verdicts.

    Accepts: list of ReviewerVerdict | str | None.
    Returns None if no verdicts recorded.
    """
    return _pct_from_scored(verdicts)


def reconciliation_accuracy_pct(verdicts: list) -> Optional[float]:
    """
    Compute cross-source reconciliation accuracy % from a list of verdicts.

    Accepts: list of ReviewerVerdict | str | None for fused_fact entries.
    Returns None if no verdicts recorded.
    """
    return _pct_from_scored(verdicts)


def narrative_accuracy_pct(verdict: "ReviewerVerdict | str | None") -> Optional[float]:
    """
    Compute narrative accuracy % from a single governed_summary verdict.

    Maps: CORRECT → 100%, PARTIAL → 50%, INCORRECT/UNSUPPORTED → 0%.
    Returns None if no verdict recorded.
    """
    s = score_verdict(verdict)
    if s is None:
        return None
    return round(s * 100.0, 1)


# ---------------------------------------------------------------------------
# Overall benchmark score
# ---------------------------------------------------------------------------

def overall_score(
    understanding_acc: Optional[float],
    fact_acc: Optional[float],
    financial_acc: Optional[float],
    narrative_acc: Optional[float],
) -> Optional[float]:
    """
    Compute the weighted overall benchmark score.

    Weights (see OVERALL_WEIGHTS):
      30% understanding · 25% fact · 25% financial · 20% narrative

    Only components with recorded verdicts are included; the weight is
    redistributed proportionally if some components are missing.

    Returns None if no component has data yet.
    """
    components = {
        "understanding": understanding_acc,
        "fact":          fact_acc,
        "financial":     financial_acc,
        "narrative":     narrative_acc,
    }
    available = {k: v for k, v in components.items() if v is not None}
    if not available:
        return None

    total_weight = sum(OVERALL_WEIGHTS[k] for k in available)
    weighted_sum = sum(OVERALL_WEIGHTS[k] * v for k, v in available.items())
    return round(weighted_sum / total_weight, 1)


# ---------------------------------------------------------------------------
# Failure flag detection
# ---------------------------------------------------------------------------

FAILURE_FLAGS = {
    "understanding_wrong_high_confidence": (
        "INCORRECT slot with confidence ≥ 0.9 — system was confident but wrong"
    ),
    "financial_fact_incorrect": (
        "At least one financial fact rated INCORRECT"
    ),
    "unsupported_claim_detected": (
        "At least one slot rated UNSUPPORTED — claim not grounded in evidence"
    ),
    "summary_hallucination_detected": (
        "Governed summary rated UNSUPPORTED — potential hallucination"
    ),
}


def detect_failure_flags(
    slots: list,
    financial_verdicts: Optional[list] = None,
    narrative_verdict: "ReviewerVerdict | str | None" = None,
) -> list[str]:
    """
    Return a list of active failure flag keys given recorded verdicts.

    Args:
      slots              — list of UnderstandingSlot (with reviewer_verdict attrs)
      financial_verdicts — list of ReviewerVerdict | str | None for financial facts
      narrative_verdict  — single verdict for governed summary

    Returns list of flag keys (strings from FAILURE_FLAGS).
    """
    flags: list[str] = []

    # understanding_wrong_high_confidence
    for slot in slots:
        v = ReviewerVerdict.from_str(getattr(slot, "reviewer_verdict", None) or "")
        conf = getattr(slot, "confidence", 0.0)
        if v == ReviewerVerdict.INCORRECT and conf >= 0.9:
            flags.append("understanding_wrong_high_confidence")
            break

    # unsupported_claim_detected
    for slot in slots:
        v = ReviewerVerdict.from_str(getattr(slot, "reviewer_verdict", None) or "")
        if v == ReviewerVerdict.UNSUPPORTED:
            flags.append("unsupported_claim_detected")
            break

    # financial_fact_incorrect
    if financial_verdicts:
        for fv in financial_verdicts:
            v = ReviewerVerdict.from_str(fv) if isinstance(fv, str) else fv
            if v == ReviewerVerdict.INCORRECT:
                flags.append("financial_fact_incorrect")
                break

    # summary_hallucination_detected
    nv = ReviewerVerdict.from_str(narrative_verdict) if isinstance(narrative_verdict, str) else narrative_verdict
    if nv == ReviewerVerdict.UNSUPPORTED:
        flags.append("summary_hallucination_detected")

    return flags


# ---------------------------------------------------------------------------
# Display helpers
# ---------------------------------------------------------------------------

def format_accuracy(pct: Optional[float], decimals: int = 1) -> str:
    """Format an accuracy % for display in tables. '—' if no verdicts yet."""
    if pct is None:
        return "—"
    return f"{pct:.{decimals}f}%"
