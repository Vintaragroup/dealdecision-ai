"""
evaluation/benchmark/ground_truth_compare.py
=============================================

Automatic comparison of system-extracted slot values against ground-truth answers.

Verdict model
-------------
Each slot comparison returns one of:

  CORRECT     - system value matches ground truth well enough
  PARTIAL     - system value partially overlaps with ground truth
  INCORRECT   - system value contradicts or misses ground truth
  UNSUPPORTED - slot not present in system output (not extracted at all)

Matching strategy
-----------------
  1. Exact match after normalization (lowercased, stripped)  → CORRECT
  2. Substring / token overlap ≥50%                          → PARTIAL
  3. No meaningful overlap                                    → INCORRECT
  4. System did not populate the slot                        → UNSUPPORTED

For boolean values (ai_claims_present):
  - Python bool / JSON bool compared directly                → CORRECT / INCORRECT

For list values (core_features, core_workflow, etc.):
  - Overlap counted as |intersection| / |ground_truth|
  - ≥66%  → CORRECT
  - ≥33%  → PARTIAL
  - <33%  → INCORRECT

For numeric financial values:
  - Within 5% relative tolerance                             → CORRECT
  - Within 25% relative tolerance                           → PARTIAL
  - Outside 25%                                             → INCORRECT

Usage:

  from evaluation.benchmark.ground_truth_compare import (
      compare_slot,
      compute_ground_truth_accuracy,
  )

  verdict = compare_slot(system_value, ground_truth_value)
  scores = compute_ground_truth_accuracy(understanding, ground_truth)
"""

from __future__ import annotations

import re
from typing import Any, Optional

# ---------------------------------------------------------------------------
# Verdict constants — reuse the string values from ReviewerVerdict
# ---------------------------------------------------------------------------

CORRECT     = "correct"
PARTIAL     = "partial"
INCORRECT   = "incorrect"
UNSUPPORTED = "unsupported"

# Verdict → numeric score (matches reviewer_verdict.VERDICT_SCORE)
VERDICT_SCORE: dict[str, float] = {
    CORRECT:     1.0,
    PARTIAL:     0.5,
    INCORRECT:   0.0,
    UNSUPPORTED: 0.0,
}

# Financial tolerance thresholds
_FIN_CORRECT_TOL  = 0.05   # within 5%  → CORRECT
_FIN_PARTIAL_TOL  = 0.25   # within 25% → PARTIAL

# List overlap thresholds
_LIST_CORRECT_TOL = 0.66   # ≥66% of GT tokens covered → CORRECT
_LIST_PARTIAL_TOL = 0.33   # ≥33%  → PARTIAL

# Text token overlap threshold (for string slots)
_TEXT_PARTIAL_TOL = 0.30   # ≥30% significant-word overlap → PARTIAL


# ---------------------------------------------------------------------------
# Internal normalisation helpers
# ---------------------------------------------------------------------------

_STOPWORDS = frozenset(
    "a an the and or of in to for with on at by from is are was were be been"
    " this that have has its it we our our you your they their".split()
)


def _normalise(s: str) -> str:
    """Lowercase, strip punctuation, collapse whitespace."""
    s = s.lower().strip()
    s = re.sub(r"[^\w\s]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _tokens(s: str) -> set[str]:
    """Return significant (non-stopword) tokens from a normalised string."""
    return {t for t in _normalise(s).split() if t not in _STOPWORDS and len(t) > 1}


def _str_compare(system: str, ground_truth: str) -> str:
    """Compare two string values."""
    sys_n = _normalise(str(system))
    gt_n  = _normalise(str(ground_truth))

    # Exact match
    if sys_n == gt_n:
        return CORRECT

    # Substring containment (one contains the other)
    if sys_n in gt_n or gt_n in sys_n:
        return CORRECT if min(len(sys_n), len(gt_n)) / max(len(sys_n), len(gt_n)) >= 0.6 else PARTIAL

    # Token overlap
    sys_toks = _tokens(str(system))
    gt_toks  = _tokens(str(ground_truth))
    if not gt_toks:
        return CORRECT if not sys_toks else PARTIAL
    overlap = len(sys_toks & gt_toks) / len(gt_toks)
    if overlap >= 0.8:
        return CORRECT
    if overlap >= _TEXT_PARTIAL_TOL:
        return PARTIAL
    return INCORRECT


def _bool_compare(system: Any, ground_truth: bool) -> str:
    """Compare boolean slots."""
    # Normalise system value to bool
    if isinstance(system, bool):
        sys_bool = system
    elif isinstance(system, str):
        sys_bool = system.strip().lower() in ("true", "yes", "1")
    elif isinstance(system, (int, float)):
        sys_bool = bool(system)
    else:
        return UNSUPPORTED
    return CORRECT if sys_bool == ground_truth else INCORRECT


def _list_compare(system: list, ground_truth: list) -> str:
    """
    Compare list slots.  Measures how many GT tokens appear in any system item.
    """
    if not ground_truth:
        return CORRECT if not system else PARTIAL

    gt_toks_all: set[str] = set()
    for item in ground_truth:
        gt_toks_all.update(_tokens(str(item)))

    sys_toks_all: set[str] = set()
    for item in system:
        sys_toks_all.update(_tokens(str(item)))

    if not gt_toks_all:
        return CORRECT
    overlap = len(sys_toks_all & gt_toks_all) / len(gt_toks_all)
    if overlap >= _LIST_CORRECT_TOL:
        return CORRECT
    if overlap >= _LIST_PARTIAL_TOL:
        return PARTIAL
    return INCORRECT


def _numeric_compare(system: Any, ground_truth: Any) -> str:
    """Compare numeric (financial) values with relative tolerance."""
    try:
        sys_val = float(system)
        gt_val  = float(ground_truth)
    except (TypeError, ValueError):
        return INCORRECT

    if gt_val == 0:
        return CORRECT if sys_val == 0 else INCORRECT

    rel_diff = abs(sys_val - gt_val) / abs(gt_val)
    if rel_diff <= _FIN_CORRECT_TOL:
        return CORRECT
    if rel_diff <= _FIN_PARTIAL_TOL:
        return PARTIAL
    return INCORRECT


# ---------------------------------------------------------------------------
# Public comparison API
# ---------------------------------------------------------------------------

def compare_slot(system_value: Any, ground_truth_value: Any) -> str:
    """
    Compare a system-extracted slot value against its ground-truth answer.

    Parameters
    ----------
    system_value      : value from DealUnderstandingV1 slot (may be None)
    ground_truth_value: value from the ground-truth JSON file

    Returns
    -------
    One of: "correct", "partial", "incorrect", "unsupported"
    """
    # System did not extract anything
    if system_value is None:
        return UNSUPPORTED
    if isinstance(system_value, str) and not system_value.strip():
        return UNSUPPORTED
    if isinstance(system_value, list) and len(system_value) == 0:
        return UNSUPPORTED

    # Ground truth is None → cannot evaluate
    if ground_truth_value is None:
        return UNSUPPORTED

    # Boolean
    if isinstance(ground_truth_value, bool):
        return _bool_compare(system_value, ground_truth_value)

    # List
    if isinstance(ground_truth_value, list):
        sys_list = system_value if isinstance(system_value, list) else [system_value]
        if not ground_truth_value:
            return CORRECT
        return _list_compare(sys_list, ground_truth_value)

    # Numeric financial
    if isinstance(ground_truth_value, (int, float)):
        return _numeric_compare(system_value, ground_truth_value)

    # String (default)
    return _str_compare(str(system_value), str(ground_truth_value))


def compare_financial(system_value: Any, ground_truth_value: Any) -> str:
    """Explicit numeric comparison for financial facts (thin wrapper)."""
    if system_value is None:
        return UNSUPPORTED
    if ground_truth_value is None:
        return UNSUPPORTED
    return _numeric_compare(system_value, ground_truth_value)


# ---------------------------------------------------------------------------
# Per-deal accuracy calculation
# ---------------------------------------------------------------------------

def compute_ground_truth_accuracy(
    understanding: Any,          # DealUnderstandingV1 — loosely typed to avoid circular import
    ground_truth: dict,
    system_financials: Optional[dict] = None,
) -> dict:
    """
    Compute automatic accuracy scores for a deal by comparing system extraction
    against ground-truth values.

    Parameters
    ----------
    understanding     : DealUnderstandingV1 instance
    ground_truth      : dict from load_ground_truth()
    system_financials : optional dict mapping metric_key → numeric value,
                        representing the system's extracted financial facts.
                        If omitted, financial accuracy is not computed.

    Returns
    -------
    {
      "semantic_accuracy": float | None,   // 0.0–1.0 (None if no GT slots)
      "financial_accuracy": float | None,  // 0.0–1.0 (None if no GT financials)
      "overall_accuracy": float | None,    // weighted average, None if both None
      "slot_verdicts": {<slot_field>: <verdict>},
      "financial_verdicts": {<metric_key>: <verdict>},
      "slots_evaluated": int,
      "financials_evaluated": int,
    }
    """
    gt_slots = ground_truth.get("slots") or {}
    gt_financials = ground_truth.get("financials") or {}

    # Build slot lookup from understanding
    slot_map: dict[str, Any] = {}
    for s in understanding.slots:
        slot_map[s.slot_field] = s.value if s.populated else None

    # Slot verdicts
    slot_verdicts: dict[str, str] = {}
    for field, gt_val in gt_slots.items():
        sys_val = slot_map.get(field)
        slot_verdicts[field] = compare_slot(sys_val, gt_val)

    # Financial verdicts
    financial_verdicts: dict[str, str] = {}
    if system_financials:
        for metric, gt_val in gt_financials.items():
            sys_val = system_financials.get(metric)
            financial_verdicts[metric] = compare_financial(sys_val, gt_val)

    # Accuracy scores
    def _acc(verdicts: dict) -> Optional[float]:
        if not verdicts:
            return None
        total = sum(VERDICT_SCORE[v] for v in verdicts.values())
        return round(total / len(verdicts), 4)

    sem_acc = _acc(slot_verdicts)
    fin_acc = _acc(financial_verdicts) if financial_verdicts else None

    # Overall = 70% semantic + 30% financial (or just semantic if no financials)
    if sem_acc is not None and fin_acc is not None:
        overall = round(0.70 * sem_acc + 0.30 * fin_acc, 4)
    elif sem_acc is not None:
        overall = sem_acc
    else:
        overall = fin_acc

    return {
        "semantic_accuracy": sem_acc,
        "financial_accuracy": fin_acc,
        "overall_accuracy": overall,
        "slot_verdicts": slot_verdicts,
        "financial_verdicts": financial_verdicts,
        "slots_evaluated": len(slot_verdicts),
        "financials_evaluated": len(financial_verdicts),
    }
