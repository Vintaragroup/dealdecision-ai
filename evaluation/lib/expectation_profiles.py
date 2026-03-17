"""
evaluation/lib/expectation_profiles.py
========================================

Expectation profiles mapping BenchmarkDocumentType to semantic slot
expectation levels.

Expectation levels:
  "expected"  — the document type reliably contains this understanding element;
                benchmark should flag absence as a potential extraction failure
  "optional"  — the element may or may not appear; absence is not a failure
  "unlikely"  — the document type rarely contains this element;
                presence is a bonus, absence is expected

Profiles are conservative and evidence-based. They:
  - avoid penalising sparse documents for missing content they cannot contain
  - avoid inflating adjusted coverage for trivially easy document types
  - preserve raw coverage for longitudinal comparison

Adjusted coverage formula:
  adjusted_coverage_pct = populated_expected_slots / expected_slots * 100
  (Financial packs have 0 expected slots → adjusted_coverage = 100.0)
"""

from __future__ import annotations

from .doc_type_classifier import BenchmarkDocumentType

K = BenchmarkDocumentType


# ---------------------------------------------------------------------------
# Expectation level constants
# ---------------------------------------------------------------------------

class ExpectationLevel:
    EXPECTED  = "expected"
    OPTIONAL  = "optional"
    UNLIKELY  = "unlikely"

    @classmethod
    def all(cls) -> list:
        return [cls.EXPECTED, cls.OPTIONAL, cls.UNLIKELY]


E = ExpectationLevel.EXPECTED
O = ExpectationLevel.OPTIONAL
U = ExpectationLevel.UNLIKELY


# ---------------------------------------------------------------------------
# Profiles
# ---------------------------------------------------------------------------

# Each profile is a dict: { slot_field: expectation_level }
# Must contain entries for all 17 slots in SLOT_DEFINITIONS.

_INVESTOR_DECK_PROFILE: dict = {
    # Investor decks are structured narratives: problem → solution → product
    # → market → team → ask. They reliably contain these understanding elements.
    "company_description":          E,  # company intro slide always present
    "problem_statement":            E,  # problem/opportunity slide is canonical
    "solution_summary":             E,  # solution section always present
    "target_customer":              E,  # market/ICP section always present
    "buyer_persona":                O,  # sometimes specific, often just "enterprise"
    "product_type":                 E,  # product type clear from product section
    "delivery_model":               E,  # SaaS/platform/marketplace always stated
    "product_maturity":             O,  # sometimes mentioned, sometimes implied
    "core_workflow":                O,  # product walkthrough not always explicit
    "core_features":                E,  # feature bullets always in product section
    "differentiation_claims":       E,  # competitive moat / unfair advantage slide
    "integrations_or_dependencies": O,  # tech stack sometimes present
    "ai_claims_present":            O,  # depends on company domain
    "ai_usage_summary":             O,  # if AI in product, usually described
    "ai_usage_type":                U,  # deep taxonomy rarely in pitch decks
    "ai_defensibility_notes":       U,  # too technical for investor deck
    "ai_evidence_strength":         U,  # quantified AI evidence rare in decks
}

_CIM_PROFILE: dict = {
    # CIMs (Confidential Information Memoranda) are broker-prepared M&A docs.
    # They focus on business operations, revenue model, customer base, and
    # competitive positioning. Less emphasis on technology depth.
    "company_description":          E,  # always an executive summary
    "problem_statement":            O,  # CIMs describe business, not problem-solution
    "solution_summary":             E,  # business/product description always present
    "target_customer":              E,  # customer base / market focus always stated
    "buyer_persona":                E,  # CIMs explicitly describe buyer profile
    "product_type":                 E,  # product/service type always clear
    "delivery_model":               E,  # revenue model critical in CIM
    "product_maturity":             O,  # maturity often implied, not stated
    "core_workflow":                U,  # proprietary process details often withheld
    "core_features":                E,  # product capabilities described
    "differentiation_claims":       E,  # competitive moat prominently featured
    "integrations_or_dependencies": O,  # sometimes listed in tech section
    "ai_claims_present":            O,  # depends on business type
    "ai_usage_summary":             O,  # if AI present, described
    "ai_usage_type":                U,  # taxonomy too deep for CIM
    "ai_defensibility_notes":       U,
    "ai_evidence_strength":         U,
}

_ONE_PAGER_PROFILE: dict = {
    # One-pagers / teasers: 1–3 pages, high-level summary.
    # Very limited content depth. Only top-level elements expected.
    "company_description":          E,  # headline description always present
    "problem_statement":            O,  # sometimes present as a bullet
    "solution_summary":             E,  # core offering always stated
    "target_customer":              E,  # always stated (ICP or market)
    "buyer_persona":                U,  # too deep for one-pager
    "product_type":                 O,  # sometimes clear, sometimes implied
    "delivery_model":               O,  # sometimes mentioned (SaaS / etc)
    "product_maturity":             U,  # rarely stated explicitly
    "core_workflow":                U,  # no room for process details
    "core_features":                O,  # brief bullets sometimes included
    "differentiation_claims":       O,  # brief "why us" sometimes present
    "integrations_or_dependencies": U,
    "ai_claims_present":            O,
    "ai_usage_summary":             U,
    "ai_usage_type":                U,
    "ai_defensibility_notes":       U,
    "ai_evidence_strength":         U,
}

_FINANCIAL_PACK_PROFILE: dict = {
    # Financial packs: spreadsheets, models, cap tables.
    # Minimal narrative content. No product understanding expected.
    "company_description":          U,  # spreadsheets have no narrative
    "problem_statement":            U,
    "solution_summary":             U,
    "target_customer":              U,
    "buyer_persona":                U,
    "product_type":                 U,
    "delivery_model":               O,  # revenue line items can imply model
    "product_maturity":             U,
    "core_workflow":                U,
    "core_features":                U,
    "differentiation_claims":       U,
    "integrations_or_dependencies": U,
    "ai_claims_present":            U,
    "ai_usage_summary":             U,
    "ai_usage_type":                U,
    "ai_defensibility_notes":       U,
    "ai_evidence_strength":         U,
}

_DILIGENCE_REPORT_PROFILE: dict = {
    # Diligence reports / questionnaires: exhaustive structured documents.
    # Should contain virtually all product understanding elements.
    "company_description":          E,
    "problem_statement":            E,
    "solution_summary":             E,
    "target_customer":              E,
    "buyer_persona":                E,
    "product_type":                 E,
    "delivery_model":               E,
    "product_maturity":             E,
    "core_workflow":                E,  # process flows explicitly described
    "core_features":                E,
    "differentiation_claims":       E,
    "integrations_or_dependencies": E,  # integration list always requested
    "ai_claims_present":            O,
    "ai_usage_summary":             O,
    "ai_usage_type":                O,
    "ai_defensibility_notes":       O,
    "ai_evidence_strength":         O,
}

_MIXED_PROFILE: dict = {
    # Mixed (deck + financials): deck drives narrative understanding.
    # Use investor_deck expectations — financials add context but not product evals.
    **_INVESTOR_DECK_PROFILE,
}

_UNKNOWN_PROFILE: dict = {
    # Unknown: everything optional — no penalty, no reward.
    "company_description":          O,
    "problem_statement":            O,
    "solution_summary":             O,
    "target_customer":              O,
    "buyer_persona":                O,
    "product_type":                 O,
    "delivery_model":               O,
    "product_maturity":             O,
    "core_workflow":                O,
    "core_features":                O,
    "differentiation_claims":       O,
    "integrations_or_dependencies": O,
    "ai_claims_present":            O,
    "ai_usage_summary":             O,
    "ai_usage_type":                O,
    "ai_defensibility_notes":       O,
    "ai_evidence_strength":         O,
}

PROFILES: dict = {
    K.INVESTOR_DECK:    _INVESTOR_DECK_PROFILE,
    K.CIM:              _CIM_PROFILE,
    K.ONE_PAGER:        _ONE_PAGER_PROFILE,
    K.FINANCIAL_PACK:   _FINANCIAL_PACK_PROFILE,
    K.DILIGENCE_REPORT: _DILIGENCE_REPORT_PROFILE,
    K.MIXED:            _MIXED_PROFILE,
    K.UNKNOWN:          _UNKNOWN_PROFILE,
}


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def get_expectation_profile(doc_type: str) -> dict:
    """
    Return the expectation profile dict for a BenchmarkDocumentType.

    Returns the UNKNOWN profile when doc_type is not recognised,
    ensuring conservative (optional) defaults.
    """
    return PROFILES.get(doc_type, _UNKNOWN_PROFILE)


def apply_expectations(slots: list, doc_type: str) -> list:
    """
    Annotate a list of UnderstandingSlot objects with their expectation level.

    Mutates each slot's 'expectation' field in-place and returns the list.
    """
    profile = get_expectation_profile(doc_type)
    for slot in slots:
        slot.expectation = profile.get(slot.slot_field, ExpectationLevel.OPTIONAL)
    return slots


def expected_slots(slots: list) -> list:
    """Filter to slots with expectation == 'expected'."""
    return [s for s in slots if getattr(s, "expectation", None) == ExpectationLevel.EXPECTED]


def optional_slots(slots: list) -> list:
    """Filter to slots with expectation == 'optional'."""
    return [s for s in slots if getattr(s, "expectation", None) == ExpectationLevel.OPTIONAL]


def unlikely_slots(slots: list) -> list:
    """Filter to slots with expectation == 'unlikely'."""
    return [s for s in slots if getattr(s, "expectation", None) == ExpectationLevel.UNLIKELY]


def adjusted_coverage_pct(slots: list) -> float:
    """
    Compute adjusted coverage: populated_expected / expected * 100.

    When no slots are 'expected' (e.g. financial_pack), returns 100.0
    — the document type meets all realistic expectations by having none.
    """
    exp = expected_slots(slots)
    if not exp:
        return 100.0
    populated = sum(1 for s in exp if s.populated)
    return round(100.0 * populated / len(exp), 1)


# ---------------------------------------------------------------------------
# Zero classification
# ---------------------------------------------------------------------------

class ZeroClassification:
    """String constants for the zero-coverage classification."""
    TRUE_ZERO_EXPECTED      = "true_zero_expected"
    TRUE_ZERO_SPARSE_SOURCE = "true_zero_sparse_source"
    LOW_COVERAGE_APPROPRIATE= "low_coverage_appropriate"
    ADEQUATE                = "adequate"
    NEEDS_REVIEW            = "needs_review"

    LABELS: dict = {
        "true_zero_expected":       "True Zero — extraction failure expected",
        "true_zero_sparse_source":  "True Zero — sparse source (appropriate)",
        "low_coverage_appropriate": "Low raw coverage — appropriate for doc type",
        "adequate":                 "Adequate",
        "needs_review":             "Needs review",
    }

    @classmethod
    def label(cls, clf: str) -> str:
        return cls.LABELS.get(clf, clf)


def classify_zero(
    populated_count: int,
    raw_coverage_pct: float,
    adjusted_cov_pct: float,
    expected_count: int,
) -> str:
    """
    Classify a deal's understanding coverage result.

    Returns a ZeroClassification constant.
    """
    if populated_count == 0:
        if expected_count == 0:
            return ZeroClassification.TRUE_ZERO_SPARSE_SOURCE
        else:
            return ZeroClassification.TRUE_ZERO_EXPECTED
    if raw_coverage_pct < 35.0 and adjusted_cov_pct >= 60.0:
        return ZeroClassification.LOW_COVERAGE_APPROPRIATE
    return ZeroClassification.ADEQUATE
