"""
evaluation/lib/section_quality.py
==================================

Deterministic section-quality labels for benchmark regression reports.

Computes per-section verification labels (Strong / Partial / Weak / Missing)
for the 10 standard investor sections, using slot_verdicts and financial
signals already present in each DealRegressionResult.

Labels
------
- Strong  : section populated and well-supported by evidence
- Partial : section populated but support is thin or incomplete
- Weak    : section exists but is low-confidence or poorly grounded
- Missing : section absent / no data available

Scoring rules
-------------
For slot-backed sections (Problem, Product/Technology, Market, Business Model,
Unique Insight):
  - Draw the subset of slot_verdicts whose keys belong to this section
  - VERDICT_SCORE: correct=1.0, partial=0.5, incorrect=0.0, unsupported=0.0
  - mean_score = sum(scores) / n_slots_in_section
  - all unsupported (or no slots in any verdict dict)  → Missing
  - mean_score >= 0.70 AND ≥1 correct                 → Strong
  - mean_score >= 0.25                                 → Partial
  - any non-unsupported verdict but low mean           → Weak
  - otherwise                                          → Missing

For Traction (hybrid — financial slides + financial verdicts):
  - Signals: "traction" in financial_slide_sources
  - Relevant financial metrics: revenue, arr, mrr, churn_pct, retention_pct, arpu
  - Strong  : traction slide present AND ≥1 financial verdict correct
  - Partial : traction slide present OR ≥1 financial verdict correct
  - Weak    : any non-unsupported financial verdict but no correct ones
  - Missing : no traction signals at all

For Financials (financial_verdicts + coverage):
  - Signals: financial_coverage_pct, financial_conflict_count, financial_verdicts
  - Strong  : coverage ≥ 40% AND conflicts < 2 AND ≥1 verdict correct
  - Partial : coverage ≥ 15% OR ≥1 verdict correct
  - Weak    : coverage > 0% OR any verdict present
  - Missing : coverage == 0 AND no verdicts

For Raise/Use of Funds (raises + stage):
  - Slots: stage
  - Financial: raise_amount, valuation
  - Combines both, then applies slot-label rules

For Go-To-Market and Team:
  - No backing data currently tracked → Missing (noted as "not tracked")
"""

from __future__ import annotations

from typing import Optional

# ---------------------------------------------------------------------------
# Label constants
# ---------------------------------------------------------------------------

STRONG  = "Strong"
PARTIAL = "Partial"
WEAK    = "Weak"
MISSING = "Missing"

ALL_LABELS = (STRONG, PARTIAL, WEAK, MISSING)

# ---------------------------------------------------------------------------
# Investor sections — ordered as they appear in pitch decks
# ---------------------------------------------------------------------------

INVESTOR_SECTIONS: list[str] = [
    "Problem",
    "Product/Technology",
    "Market",
    "Business Model",
    "Go-To-Market",
    "Traction",
    "Financials",
    "Team",
    "Raise/Use of Funds",
    "Unique Insight",
]

# ---------------------------------------------------------------------------
# Section → slot_verdicts keys mapping
# ---------------------------------------------------------------------------

_SECTION_SLOTS: dict[str, list[str]] = {
    "Problem": [
        "problem_statement",
        "solution_summary",
    ],
    "Product/Technology": [
        "product_type",
        "product_maturity",
        "core_workflow",
        "core_features",
        "product_description",
    ],
    "Market": [
        "target_customer",
        "buyer_persona",
    ],
    "Business Model": [
        "delivery_model",
        "revenue_model",
    ],
    "Go-To-Market": [],
    "Traction": [],
    "Financials": [],
    "Team": [],
    "Raise/Use of Funds": [
        "stage",
    ],
    "Unique Insight": [
        "differentiation_claims",
        "ai_claims_present",
        "ai_usage_type",
        "ai_evidence_strength",
        "ai_defensibility_notes",
        "integrations_or_dependencies",
    ],
}

# Section → financial_verdicts keys that are *specifically* relevant to it
# (Financials uses all financial_verdicts; others use this narrow set)
_SECTION_FIN_KEYS: dict[str, list[str]] = {
    "Traction": [
        "revenue", "arr", "mrr", "churn_pct", "retention_pct", "arpu",
    ],
    "Raise/Use of Funds": [
        "raise_amount", "valuation",
    ],
}

# Verdict → contribution score (mirrors ground_truth_compare.VERDICT_SCORE)
_SCORE: dict[str, float] = {
    "correct":     1.0,
    "partial":     0.5,
    "incorrect":   0.0,
    "unsupported": 0.0,
}

# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _slot_label(verdicts: list[str]) -> tuple[str, str]:
    """
    Derive a (label, note) from a flat list of verdict strings collected
    for one section from slot_verdicts (and optionally financial_verdicts).
    """
    if not verdicts:
        return MISSING, "no data"

    non_unsupported = [v for v in verdicts if v != "unsupported"]
    if not non_unsupported:
        return MISSING, f"0/{len(verdicts)} extracted"

    n_total   = len(verdicts)
    n_correct = sum(1 for v in verdicts if v == "correct")
    n_partial = sum(1 for v in verdicts if v == "partial")
    mean      = sum(_SCORE.get(v, 0.0) for v in verdicts) / n_total

    note = f"{n_correct}/{n_total} correct"
    if n_partial and not n_correct:
        note = f"{n_partial}/{n_total} partial"

    if mean >= 0.70 and n_correct >= 1:
        return STRONG, note
    if mean >= 0.25:
        return PARTIAL, note
    # Has non-unsupported verdicts but low score (all incorrect)
    return WEAK, note


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def compute_section_labels(
    slot_verdicts: dict,
    financial_verdicts: dict,
    financial_coverage_pct: Optional[int],
    financial_conflict_count: int,
    financial_slide_sources: list[str],
) -> dict[str, tuple[str, str]]:
    """
    Compute per-section quality labels for one deal.

    Parameters
    ----------
    slot_verdicts           : dict[slot_field → verdict]  (from DealRegressionResult)
    financial_verdicts      : dict[metric_key → verdict]
    financial_coverage_pct  : 0–100 integer or None
    financial_conflict_count: integer
    financial_slide_sources : list of slide_type strings from financial_facts_v1

    Returns
    -------
    dict mapping section name → (label, note)
    label is one of: "Strong", "Partial", "Weak", "Missing"
    note  is a short human-readable evidence summary
    """
    result: dict[str, tuple[str, str]] = {}

    for section in INVESTOR_SECTIONS:

        # ── Sections with no current backing data ──────────────────────────
        if section == "Go-To-Market":
            result[section] = (MISSING, "not tracked")
            continue

        if section == "Team":
            result[section] = (MISSING, "not tracked")
            continue

        # ── Traction (hybrid) ───────────────────────────────────────────────
        if section == "Traction":
            has_traction = "traction" in financial_slide_sources

            traction_fin_keys = _SECTION_FIN_KEYS.get("Traction", [])
            traction_verdicts = [
                financial_verdicts[k]
                for k in traction_fin_keys
                if k in financial_verdicts
            ]
            n_fin_correct = sum(1 for v in traction_verdicts if v == "correct")
            n_fin_total   = len(traction_verdicts)

            if has_traction and n_fin_correct >= 1:
                label = STRONG
                note  = f"traction slide; {n_fin_correct}/{n_fin_total} financials correct"
            elif has_traction or n_fin_correct >= 1:
                label = PARTIAL
                note  = (
                    f"traction slide; {n_fin_correct}/{n_fin_total} financials correct"
                    if has_traction
                    else f"{n_fin_correct}/{n_fin_total} financials correct"
                )
            elif traction_verdicts and any(v != "unsupported" for v in traction_verdicts):
                label = WEAK
                note  = f"0/{n_fin_total} financials correct"
            else:
                label = MISSING
                note  = "no traction signals"

            result[section] = (label, note)
            continue

        # ── Financials (coverage-based) ─────────────────────────────────────
        if section == "Financials":
            cov        = financial_coverage_pct if financial_coverage_pct is not None else 0
            fin_vlist  = list(financial_verdicts.values())
            n_correct  = sum(1 for v in fin_vlist if v == "correct")
            n_total    = len(fin_vlist)
            conflicts_ok = financial_conflict_count < 2

            if cov == 0 and not fin_vlist:
                label = MISSING
                note  = "no financial data"
            elif cov >= 40 and conflicts_ok and n_correct >= 1:
                label = STRONG
                note  = f"coverage {cov}%; {n_correct}/{n_total} verified"
            elif cov >= 15 or n_correct >= 1:
                label = PARTIAL
                note  = f"coverage {cov}%; {n_correct}/{n_total} verified"
            elif cov > 0 or fin_vlist:
                label = WEAK
                note  = (
                    f"coverage {cov}%; {n_correct}/{n_total} verified"
                    if fin_vlist
                    else f"coverage {cov}%"
                )
            else:
                label = MISSING
                note  = "no financial data"

            result[section] = (label, note)
            continue

        # ── Raise/Use of Funds (slots + targeted financial verdicts) ────────
        if section == "Raise/Use of Funds":
            slot_keys = _SECTION_SLOTS.get(section, [])
            fin_keys  = _SECTION_FIN_KEYS.get(section, [])
            combined  = (
                [slot_verdicts[k] for k in slot_keys if k in slot_verdicts]
                + [financial_verdicts[k] for k in fin_keys if k in financial_verdicts]
            )
            result[section] = _slot_label(combined)
            continue

        # ── Default: slot-backed sections ───────────────────────────────────
        slot_keys = _SECTION_SLOTS.get(section, [])
        relevant  = [slot_verdicts[k] for k in slot_keys if k in slot_verdicts]
        result[section] = _slot_label(relevant)

    return result
