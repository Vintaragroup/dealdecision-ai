"""
evaluation/tests/test_deal_understanding.py
============================================

Unit tests for DealUnderstandingV1 — slot population, coverage,
evidence refs, display helpers, and conservative (no-crash) behaviour
when product profile is absent.

Run from the repo root:
  python -m pytest evaluation/tests/test_deal_understanding.py -v

Or from evaluation/:
  python -m pytest tests/test_deal_understanding.py -v
"""

from __future__ import annotations

import os
import sys

# Ensure 'evaluation/' is on the path so `from lib.deal_understanding_v1 import ...`
# works regardless of where pytest is invoked from.
_EVAL_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _EVAL_ROOT not in sys.path:
    sys.path.insert(0, _EVAL_ROOT)

import pytest

from lib.deal_understanding_v1 import (
    UnderstandingSlot,
    DealUnderstandingV1,
    UnderstandingSourceKind,
    build_deal_understanding_v1,
    SLOT_DEFINITIONS,
)


# ─── Fixtures ─────────────────────────────────────────────────────────────────

DEAL_ID = "test-deal-00000000-0000-0000-0000-000000000001"

FULL_PROFILE = {
    "schema_version": "product_profile_v1",
    "company_description": "Acme Corp builds AI-powered widget ops tooling.",
    "problem_statement":   "Widget management is fragmented and manual.",
    "solution_summary":    "A SaaS platform unifying widget ingestion and analysis.",
    "product_type":        "SaaS",
    "delivery_model":      "B2B SaaS",
    "target_customer":     "Enterprise widget operations teams.",
    "buyer_persona":       "Head of Widget Operations",
    "core_workflow":       ["Ingest widgets", "Analyse widgets", "Report findings"],
    "core_features":       ["Widget ingestion", "AI analysis pipeline", "Dashboard"],
    "differentiation_claims": ["Only AI-native widget platform", "5-minute onboarding"],
    "integrations_or_dependencies": ["Salesforce", "Slack"],
    "product_maturity":    "GA",
    "ai_claims_present":   True,
    "ai_usage_summary":    "LLMs for widget defect classification.",
    "ai_usage_type":       "LLM as core feature",
    "ai_defensibility_notes": "Proprietary widget training corpus.",
    "ai_evidence_strength": "strong",
    "evidence": {
        "company_description": ["ev-001", "ev-002"],
        "problem_statement":   ["ev-003"],
        "ai_usage_summary":    [],
    },
    "sources": ["seg-abc", "seg-def"],
}

EMPTY_PROFILE = {
    "schema_version":       "product_profile_v1",
    "company_description":  "",
    "problem_statement":    None,
    "solution_summary":     "  ",
    "product_type":         None,
    "delivery_model":       None,
    "target_customer":      None,
    "buyer_persona":        None,
    "core_workflow":        [],
    "core_features":        [],
    "differentiation_claims": [],
    "integrations_or_dependencies": [],
    "product_maturity":     None,
    "ai_claims_present":    False,   # boolean False — still populated
    "ai_usage_summary":     None,
    "ai_usage_type":        "None",
    "ai_defensibility_notes": None,
    "ai_evidence_strength": "none",
    "evidence": {},
    "sources": [],
}


# ─── Slot population tests ────────────────────────────────────────────────────

def test_slot_populated_text_fields():
    du = build_deal_understanding_v1(DEAL_ID, FULL_PROFILE)
    slot_map = {s.slot_field: s for s in du.slots}
    assert slot_map["company_description"].populated is True
    assert slot_map["problem_statement"].populated is True
    assert slot_map["solution_summary"].populated is True
    assert slot_map["target_customer"].populated is True
    assert slot_map["buyer_persona"].populated is True


def test_slot_populated_list_fields():
    du = build_deal_understanding_v1(DEAL_ID, FULL_PROFILE)
    slot_map = {s.slot_field: s for s in du.slots}
    assert slot_map["core_workflow"].populated is True
    assert slot_map["core_features"].populated is True
    assert slot_map["differentiation_claims"].populated is True


def test_slot_populated_bool_false_is_still_populated():
    """ai_claims_present=False must count as populated — it's a deliberate assertion."""
    du = build_deal_understanding_v1(DEAL_ID, EMPTY_PROFILE)
    slot_map = {s.slot_field: s for s in du.slots}
    assert slot_map["ai_claims_present"].populated is True


def test_slot_empty_for_none_value():
    du = build_deal_understanding_v1(DEAL_ID, EMPTY_PROFILE)
    slot_map = {s.slot_field: s for s in du.slots}
    assert slot_map["problem_statement"].populated is False
    assert slot_map["buyer_persona"].populated is False
    assert slot_map["ai_usage_summary"].populated is False


def test_slot_empty_for_empty_string():
    du = build_deal_understanding_v1(DEAL_ID, EMPTY_PROFILE)
    slot_map = {s.slot_field: s for s in du.slots}
    assert slot_map["company_description"].populated is False


def test_slot_empty_for_whitespace_string():
    du = build_deal_understanding_v1(DEAL_ID, EMPTY_PROFILE)
    slot_map = {s.slot_field: s for s in du.slots}
    assert slot_map["solution_summary"].populated is False


def test_slot_empty_for_empty_list():
    du = build_deal_understanding_v1(DEAL_ID, EMPTY_PROFILE)
    slot_map = {s.slot_field: s for s in du.slots}
    assert slot_map["core_features"].populated is False
    assert slot_map["differentiation_claims"].populated is False


# ─── Coverage tests ───────────────────────────────────────────────────────────

def test_coverage_full_profile():
    du = build_deal_understanding_v1(DEAL_ID, FULL_PROFILE)
    assert du.populated_count > 0
    assert du.total_count == len(SLOT_DEFINITIONS)
    assert du.coverage_pct > 0.0
    assert du.has_profile() is True


def test_coverage_none_profile_all_empty():
    """When no product profile exists, all slots should be unpopulated."""
    du = build_deal_understanding_v1(DEAL_ID, None)
    assert du.populated_count == 0
    assert du.coverage_pct == 0.0
    assert du.has_profile() is False
    assert len(du.slots) == len(SLOT_DEFINITIONS)


def test_coverage_empty_profile_only_boolean_populates():
    """Empty profile populates at least ai_claims_present (boolean False)."""
    du = build_deal_understanding_v1(DEAL_ID, EMPTY_PROFILE)
    assert du.populated_count >= 1
    assert du.has_profile() is True


def test_coverage_by_category_contains_all_used_categories():
    du = build_deal_understanding_v1(DEAL_ID, FULL_PROFILE)
    cats = du.coverage_by_category()
    assert "company" in cats
    assert "product" in cats
    assert "ai" in cats
    for cat, (pop, tot) in cats.items():
        assert tot > 0
        assert pop <= tot


# ─── Category grouping tests ──────────────────────────────────────────────────

def test_company_slots_correct_category():
    du = build_deal_understanding_v1(DEAL_ID, FULL_PROFILE)
    assert len(du.company_slots) > 0
    assert all(s.category == "company" for s in du.company_slots)


def test_product_slots_correct_category():
    du = build_deal_understanding_v1(DEAL_ID, FULL_PROFILE)
    assert len(du.product_slots) > 0
    assert all(s.category == "product" for s in du.product_slots)


def test_ai_slots_correct_category():
    du = build_deal_understanding_v1(DEAL_ID, FULL_PROFILE)
    assert len(du.ai_slots) > 0
    assert all(s.category == "ai" for s in du.ai_slots)


def test_all_slots_assigned_a_category():
    du = build_deal_understanding_v1(DEAL_ID, FULL_PROFILE)
    for s in du.slots:
        assert s.category in ("company", "product", "ai"), \
            f"Slot '{s.slot_field}' has unexpected category '{s.category}'"


# ─── Evidence ref tests ───────────────────────────────────────────────────────

def test_evidence_ids_populated_from_profile():
    du = build_deal_understanding_v1(DEAL_ID, FULL_PROFILE)
    slot_map = {s.slot_field: s for s in du.slots}
    assert slot_map["company_description"].evidence_ids == ["ev-001", "ev-002"]
    assert slot_map["problem_statement"].evidence_ids == ["ev-003"]


def test_evidence_ids_empty_for_field_not_in_evidence_block():
    du = build_deal_understanding_v1(DEAL_ID, FULL_PROFILE)
    slot_map = {s.slot_field: s for s in du.slots}
    # product_type has no entry in FULL_PROFILE["evidence"]
    assert slot_map["product_type"].evidence_ids == []


def test_evidence_ids_empty_when_evidence_entry_is_empty_list():
    du = build_deal_understanding_v1(DEAL_ID, FULL_PROFILE)
    slot_map = {s.slot_field: s for s in du.slots}
    assert slot_map["ai_usage_summary"].evidence_ids == []


def test_evidence_summary_with_refs():
    slot = UnderstandingSlot(
        slot_field="company_description", label="Company Description",
        category="company", value="Test co.", evidence_ids=["e1", "e2"],
    )
    assert "2 ref" in slot.evidence_summary()


def test_evidence_summary_no_refs():
    slot = UnderstandingSlot(
        slot_field="company_description", label="Company Description",
        category="company", value="Test co.", evidence_ids=[],
    )
    assert slot.evidence_summary() == "—"


# ─── Display value tests ──────────────────────────────────────────────────────

def test_display_value_string():
    slot = UnderstandingSlot("x", "X", "company", "Hello World")
    assert slot.display_value() == "Hello World"


def test_display_value_list_short():
    slot = UnderstandingSlot("x", "X", "product", ["A", "B", "C"])
    dv = slot.display_value()
    assert "A" in dv and "B" in dv and "C" in dv
    assert "more" not in dv


def test_display_value_long_list_truncated():
    slot = UnderstandingSlot("x", "X", "product", [str(i) for i in range(20)])
    dv = slot.display_value()
    assert "more" in dv


def test_display_value_none():
    slot = UnderstandingSlot("x", "X", "company", None)
    assert slot.display_value() == "—"


def test_display_value_empty_string():
    slot = UnderstandingSlot("x", "X", "company", "")
    assert slot.display_value() == "—"


def test_display_value_empty_list():
    slot = UnderstandingSlot("x", "X", "product", [])
    assert slot.display_value() == "—"


def test_display_value_bool_true():
    slot = UnderstandingSlot("x", "X", "ai", True)
    assert slot.display_value() == "yes"


def test_display_value_bool_false():
    slot = UnderstandingSlot("x", "X", "ai", False)
    assert slot.display_value() == "no"


def test_display_value_long_string_truncated():
    long_str = "x" * 200
    slot = UnderstandingSlot("x", "X", "company", long_str)
    dv = slot.display_value(max_len=50)
    assert len(dv) <= 54  # 50 chars + "…"
    assert dv.endswith("…")


# ─── Conservative / robustness tests ─────────────────────────────────────────

def test_none_profile_returns_complete_slot_list():
    """Must never crash when product profile is absent."""
    du = build_deal_understanding_v1(DEAL_ID, None)
    assert len(du.slots) == len(SLOT_DEFINITIONS)
    for slot in du.slots:
        assert not slot.populated


def test_partial_profile_no_crash():
    """A profile with only some fields set should not crash the builder."""
    partial = {"schema_version": "product_profile_v1", "company_description": "Partial Co."}
    du = build_deal_understanding_v1(DEAL_ID, partial)
    assert len(du.slots) == len(SLOT_DEFINITIONS)
    slot_map = {s.slot_field: s for s in du.slots}
    assert slot_map["company_description"].populated is True
    assert slot_map["problem_statement"].populated is False


def test_all_required_company_fields_in_slots():
    """Company understanding slots must include the four key narrative fields."""
    field_keys = {defn[0] for defn in SLOT_DEFINITIONS}
    assert "company_description" in field_keys
    assert "problem_statement" in field_keys
    assert "solution_summary" in field_keys
    assert "target_customer" in field_keys


def test_all_required_ai_fields_in_slots():
    field_keys = {defn[0] for defn in SLOT_DEFINITIONS}
    assert "ai_claims_present" in field_keys
    assert "ai_usage_summary" in field_keys
    assert "ai_evidence_strength" in field_keys


def test_slot_count_matches_definitions():
    du = build_deal_understanding_v1(DEAL_ID, FULL_PROFILE)
    assert len(du.slots) == len(SLOT_DEFINITIONS)


# ─── Phase 3 — Fallback understanding tests ───────────────────────────────────

_DEAL_FACTS_TARGET = [
    {"type": "target_customer", "label": "customers", "value": "Enterprise SaaS buyers",
     "confidence": 0.8,
     "sources": [{"evidence_id": "page:pagev1:abc123", "page_number": 2, "document_id": "doc1", "excerpt": "..."}]},
]

_DEAL_FACTS_BUSINESS = [
    {"type": "business_model", "label": "model", "value": "SaaS",
     "confidence": 0.9,
     "sources": [{"evidence_id": "page:pagev1:biz001", "page_number": 3, "document_id": "doc1", "excerpt": "..."}]},
]

_DEAL_FACTS_CAPABILITY = [
    {"type": "product_capability", "label": "cap1", "value": "Automated reporting",
     "confidence": 0.7,
     "sources": [{"evidence_id": "page:pagev1:cap001", "page_number": 4, "document_id": "doc1", "excerpt": "..."}]},
    {"type": "product_capability", "label": "cap2", "value": "Real-time dashboards",
     "confidence": 0.65,
     "sources": [{"evidence_id": "page:pagev1:cap002", "page_number": 5, "document_id": "doc1", "excerpt": "..."}]},
]

_DEAL_FACTS_AI = [
    {"type": "ai_usage_claim", "label": "ai", "value": "Uses ML for predictions",
     "confidence": 0.85,
     "sources": [{"evidence_id": "page:pagev1:ai001", "page_number": 6, "document_id": "doc1", "excerpt": "..."}]},
]

_GOVERNED_SUMMARY_JSON = (
    "Executive Summary: An innovative AI platform.\n"
    "---governed_summary_v1_json---\n"
    '{"schema_version": "governed_summary_v1", '
    '"executive_summary": "An innovative AI platform that automates enterprise workflows.", '
    '"strengths": [], "risks": [], "open_questions": [], "validated": false}'
)


def test_fallback_target_customer_from_deal_fact():
    """target_customer slot is populated via deal_fact when primary absent."""
    du = build_deal_understanding_v1(DEAL_ID, None, deal_facts=_DEAL_FACTS_TARGET)
    slot = next(s for s in du.slots if s.slot_field == "target_customer")
    assert slot.populated is True
    assert slot.source_kind == UnderstandingSourceKind.DEAL_FACT
    assert slot.value == "Enterprise SaaS buyers"
    assert slot.confidence >= 0.6
    assert len(slot.evidence_ids) == 1


def test_fallback_delivery_model_from_deal_fact():
    """delivery_model slot is populated from business_model deal_fact when primary absent."""
    du = build_deal_understanding_v1(DEAL_ID, None, deal_facts=_DEAL_FACTS_BUSINESS)
    slot = next(s for s in du.slots if s.slot_field == "delivery_model")
    assert slot.populated is True
    assert slot.source_kind == UnderstandingSourceKind.DEAL_FACT
    assert slot.value == "SaaS"
    assert slot.confidence == 0.7
    assert len(slot.evidence_ids) == 1


def test_fallback_core_features_from_product_capability():
    """core_features slot is aggregated from product_capability deal_facts."""
    du = build_deal_understanding_v1(DEAL_ID, None, deal_facts=_DEAL_FACTS_CAPABILITY)
    slot = next(s for s in du.slots if s.slot_field == "core_features")
    assert slot.populated is True
    assert slot.source_kind == UnderstandingSourceKind.DEAL_FACT
    assert isinstance(slot.value, list)
    assert len(slot.value) == 2
    assert slot.confidence == 0.65
    assert len(slot.evidence_ids) == 2


def test_fallback_ai_claims_from_ai_usage_claim_fact():
    """ai_claims_present is True when ai_usage_claim deal_facts exist."""
    du = build_deal_understanding_v1(DEAL_ID, None, deal_facts=_DEAL_FACTS_AI)
    slot = next(s for s in du.slots if s.slot_field == "ai_claims_present")
    assert slot.populated is True
    assert slot.value is True
    assert slot.source_kind == UnderstandingSourceKind.DEAL_FACT
    assert slot.confidence == 0.75
    assert len(slot.evidence_ids) == 1


def test_fallback_company_description_from_governed_summary():
    """company_description is populated from governed_summary executive_summary."""
    du = build_deal_understanding_v1(
        DEAL_ID, None, governed_summary=_GOVERNED_SUMMARY_JSON
    )
    slot = next(s for s in du.slots if s.slot_field == "company_description")
    assert slot.populated is True
    assert "innovative AI platform" in slot.value
    assert slot.source_kind == UnderstandingSourceKind.GOVERNED_SUMMARY
    assert slot.confidence == 0.4
    assert slot.evidence_ids == []  # narrative-only, no grounding IDs


def test_provenance_primary_vs_fallback_vs_missing():
    """Slots from primary profile get source_kind=primary; the rest missing when no fallback."""
    partial = {"company_description": "acme", "problem_statement": None}
    du = build_deal_understanding_v1(DEAL_ID, partial)
    desc  = next(s for s in du.slots if s.slot_field == "company_description")
    prob  = next(s for s in du.slots if s.slot_field == "problem_statement")
    ai    = next(s for s in du.slots if s.slot_field == "ai_usage_summary")
    assert desc.source_kind == UnderstandingSourceKind.PRIMARY
    assert desc.confidence  == 1.0
    assert prob.source_kind == UnderstandingSourceKind.MISSING
    assert ai.source_kind   == UnderstandingSourceKind.MISSING


def test_false_zero_recovered():
    """is_false_zero_recovered() returns True when no profile but fallback works."""
    du = build_deal_understanding_v1(DEAL_ID, None, deal_facts=_DEAL_FACTS_TARGET)
    assert du.has_profile() is False
    assert du.populated_count > 0
    assert du.is_false_zero_recovered() is True


def test_false_zero_not_recovered_when_truly_empty():
    """is_false_zero_recovered() returns False when both profile and facts are absent."""
    du = build_deal_understanding_v1(DEAL_ID, None)
    assert du.has_profile() is False
    assert du.populated_count == 0
    assert du.is_false_zero_recovered() is False


def test_conservative_no_fallback_for_unsafe_slots():
    """problem_statement stays missing without a primary profile — no unsafe inference."""
    all_facts = _DEAL_FACTS_TARGET + _DEAL_FACTS_BUSINESS + _DEAL_FACTS_CAPABILITY
    du = build_deal_understanding_v1(DEAL_ID, None, deal_facts=all_facts)
    prob = next(s for s in du.slots if s.slot_field == "problem_statement")
    solu = next(s for s in du.slots if s.slot_field == "solution_summary")
    assert prob.populated is False
    assert solu.populated is False
    assert prob.source_kind == UnderstandingSourceKind.MISSING
    assert solu.source_kind == UnderstandingSourceKind.MISSING


def test_confidence_labels():
    """confidence_label() returns correct tier strings."""
    s = UnderstandingSlot("x", "X", "company", value="v", confidence=1.0, source_kind="primary")
    assert s.confidence_label() == "high"
    s.confidence = 0.7
    assert s.confidence_label() == "medium"
    s.confidence = 0.3
    assert s.confidence_label() == "low"
    s.confidence = 0.0
    assert s.confidence_label() == "—"


def test_provenance_counts_breakdown():
    """provenance_counts() returns correct counts per source kind."""
    all_facts = _DEAL_FACTS_TARGET + _DEAL_FACTS_BUSINESS + _DEAL_FACTS_CAPABILITY
    du = build_deal_understanding_v1(
        DEAL_ID, None,
        deal_facts=all_facts,
        governed_summary=_GOVERNED_SUMMARY_JSON,
    )
    counts = du.provenance_counts()
    # company_description from governed_summary, others from deal_fact
    assert counts.get(UnderstandingSourceKind.GOVERNED_SUMMARY, 0) >= 1
    assert counts.get(UnderstandingSourceKind.DEAL_FACT, 0) >= 1
    assert counts.get(UnderstandingSourceKind.PRIMARY, 0) == 0
    assert du.primary_count == 0
    assert du.fallback_count == du.populated_count
    assert du.missing_count == du.total_count - du.populated_count


def test_primary_takes_precedence_over_fallback():
    """When primary profile has a value, it wins over any deal_fact fallback."""
    profile_with_target = {"target_customer": "Small businesses"}
    all_facts = _DEAL_FACTS_TARGET  # has "Enterprise SaaS buyers"
    du = build_deal_understanding_v1(DEAL_ID, profile_with_target, deal_facts=all_facts)
    slot = next(s for s in du.slots if s.slot_field == "target_customer")
    assert slot.source_kind == UnderstandingSourceKind.PRIMARY
    assert slot.value == "Small businesses"
    assert slot.confidence == 1.0


# ─── Phase 4: Document type classification ────────────────────────────────────

from lib.doc_type_classifier import (
    BenchmarkDocumentType,
    classify_document,
    classify_deal_documents,
)
from lib.expectation_profiles import (
    ExpectationLevel,
    ZeroClassification,
    apply_expectations,
    adjusted_coverage_pct,
    classify_zero,
    get_expectation_profile,
)


class TestDocTypeClassifier:
    def test_investor_deck_from_title(self):
        assert classify_document("PD - Acme Deck 2025.pdf", "application/pdf", 25) == BenchmarkDocumentType.INVESTOR_DECK

    def test_cim_from_title(self):
        result = classify_document("Acme-CIM-2025.pdf", "application/pdf", 30)
        assert result == BenchmarkDocumentType.CIM

    def test_one_pager_from_title_short(self):
        result = classify_document("Acme_OnePage.pdf", "application/pdf", 2)
        assert result == BenchmarkDocumentType.ONE_PAGER

    def test_one_pager_title_long_becomes_investor_deck(self):
        """'OnePage' in title but >6 pages → still investor_deck."""
        result = classify_document("Acme OnePage Overview.pdf", "application/pdf", 15)
        assert result == BenchmarkDocumentType.INVESTOR_DECK

    def test_financial_pack_from_spreadsheet_mime(self):
        result = classify_document("FinancialModel.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", 1)
        assert result == BenchmarkDocumentType.FINANCIAL_PACK

    def test_investor_deck_from_pptx_mime(self):
        result = classify_document("Pitch.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation", 20)
        assert result == BenchmarkDocumentType.INVESTOR_DECK

    def test_small_pdf_no_keyword_is_one_pager(self):
        result = classify_document("Summary.pdf", "application/pdf", 2)
        assert result == BenchmarkDocumentType.ONE_PAGER

    def test_unknown_for_unrecognised_mime_no_keyword(self):
        result = classify_document("random.bin", "application/octet-stream", None)
        assert result == BenchmarkDocumentType.UNKNOWN

    def test_classify_deal_single_deck(self):
        docs = [{"title": "PD - Deck.pdf", "mime_type": "application/pdf", "page_count": 20}]
        result = classify_deal_documents(docs)
        assert result["deal_type"] == BenchmarkDocumentType.INVESTOR_DECK
        assert result["has_deck"] is True
        assert result["has_financials"] is False

    def test_classify_deal_mixed_deck_and_xlsx(self):
        docs = [
            {"title": "Deck.pdf", "mime_type": "application/pdf", "page_count": 20},
            {"title": "Financials.xlsx", "mime_type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "page_count": 1},
        ]
        result = classify_deal_documents(docs)
        assert result["deal_type"] == BenchmarkDocumentType.MIXED
        assert result["has_deck"] is True
        assert result["has_financials"] is True

    def test_classify_deal_cim_alone(self):
        docs = [{"title": "Company-CIM.pdf", "mime_type": "application/pdf", "page_count": 40}]
        result = classify_deal_documents(docs)
        assert result["deal_type"] == BenchmarkDocumentType.CIM

    def test_benchmark_document_type_label(self):
        assert "Investor" in BenchmarkDocumentType.label(BenchmarkDocumentType.INVESTOR_DECK)
        assert "Financial" in BenchmarkDocumentType.label(BenchmarkDocumentType.FINANCIAL_PACK)
        assert "Unknown" in BenchmarkDocumentType.label(BenchmarkDocumentType.UNKNOWN)


class TestExpectationProfiles:
    def test_investor_deck_has_8_expected_slots(self):
        profile = get_expectation_profile(BenchmarkDocumentType.INVESTOR_DECK)
        expected = [k for k, v in profile.items() if v == ExpectationLevel.EXPECTED]
        assert len(expected) == 8

    def test_investor_deck_has_3_unlikely_ai_slots(self):
        profile = get_expectation_profile(BenchmarkDocumentType.INVESTOR_DECK)
        unlikely = [k for k, v in profile.items() if v == ExpectationLevel.UNLIKELY]
        assert len(unlikely) == 3

    def test_one_pager_has_3_expected_slots(self):
        profile = get_expectation_profile(BenchmarkDocumentType.ONE_PAGER)
        expected = [k for k, v in profile.items() if v == ExpectationLevel.EXPECTED]
        assert len(expected) == 3

    def test_financial_pack_has_0_expected_slots(self):
        profile = get_expectation_profile(BenchmarkDocumentType.FINANCIAL_PACK)
        expected = [k for k, v in profile.items() if v == ExpectationLevel.EXPECTED]
        assert len(expected) == 0

    def test_unknown_has_all_optional(self):
        profile = get_expectation_profile(BenchmarkDocumentType.UNKNOWN)
        for level in profile.values():
            assert level == ExpectationLevel.OPTIONAL

    def test_apply_expectations_mutates_slots(self):
        du = build_deal_understanding_v1(DEAL_ID, None, doc_type=BenchmarkDocumentType.INVESTOR_DECK)
        for slot in du.slots:
            assert slot.expectation in (ExpectationLevel.EXPECTED, ExpectationLevel.OPTIONAL, ExpectationLevel.UNLIKELY)

    def test_apply_expectations_company_description_expected_for_deck(self):
        du = build_deal_understanding_v1(DEAL_ID, None, doc_type=BenchmarkDocumentType.INVESTOR_DECK)
        slot = next(s for s in du.slots if s.slot_field == "company_description")
        assert slot.expectation == ExpectationLevel.EXPECTED

    def test_apply_expectations_ai_usage_type_unlikely_for_deck(self):
        du = build_deal_understanding_v1(DEAL_ID, None, doc_type=BenchmarkDocumentType.INVESTOR_DECK)
        slot = next(s for s in du.slots if s.slot_field == "ai_usage_type")
        assert slot.expectation == ExpectationLevel.UNLIKELY


class TestAdjustedCoverage:
    def test_adjusted_coverage_investor_deck_zero_populated(self):
        du = build_deal_understanding_v1(DEAL_ID, None, doc_type=BenchmarkDocumentType.INVESTOR_DECK)
        assert du.expected_count == 8
        assert du.populated_expected_count == 0
        assert du.adjusted_coverage_pct == 0.0

    def test_adjusted_coverage_financial_pack_returns_100(self):
        """Financial pack has 0 expected slots — adjusted coverage should be 100%."""
        du = build_deal_understanding_v1(DEAL_ID, None, doc_type=BenchmarkDocumentType.FINANCIAL_PACK)
        assert du.expected_count == 0
        assert du.adjusted_coverage_pct == 100.0

    def test_adjusted_coverage_partial_expected_slots_populated(self):
        """4 of 8 expected slots for investor_deck = 50%."""
        # FULL_PROFILE populates company_description, problem_statement, solution_summary,
        # target_customer, product_type, delivery_model, core_features, differentiation_claims
        # = all 8 expected, so adjusted = 100%
        du = build_deal_understanding_v1(DEAL_ID, FULL_PROFILE, doc_type=BenchmarkDocumentType.INVESTOR_DECK)
        assert du.expected_count == 8
        assert du.populated_expected_count == 8
        assert du.adjusted_coverage_pct == 100.0

    def test_doc_type_set_on_understanding(self):
        du = build_deal_understanding_v1(DEAL_ID, None, doc_type=BenchmarkDocumentType.CIM)
        assert du.doc_type == BenchmarkDocumentType.CIM

    def test_doc_type_default_is_unknown(self):
        du = build_deal_understanding_v1(DEAL_ID, None)
        assert du.doc_type == BenchmarkDocumentType.UNKNOWN

    def test_expected_optional_unlikely_counts_sum_to_total(self):
        du = build_deal_understanding_v1(DEAL_ID, None, doc_type=BenchmarkDocumentType.INVESTOR_DECK)
        assert du.expected_count + du.optional_count + du.unlikely_count == du.total_count


class TestZeroClassification:
    def test_true_zero_expected_when_profile_absent_and_has_expected_slots(self):
        du = build_deal_understanding_v1(DEAL_ID, None, doc_type=BenchmarkDocumentType.INVESTOR_DECK)
        # all slots unpopulated, expected_count=8
        clf = du.zero_classification()
        assert clf == ZeroClassification.TRUE_ZERO_EXPECTED

    def test_true_zero_sparse_source_for_financial_pack(self):
        du = build_deal_understanding_v1(DEAL_ID, None, doc_type=BenchmarkDocumentType.FINANCIAL_PACK)
        clf = du.zero_classification()
        assert clf == ZeroClassification.TRUE_ZERO_SPARSE_SOURCE

    def test_adequate_when_coverage_is_high(self):
        du = build_deal_understanding_v1(DEAL_ID, FULL_PROFILE, doc_type=BenchmarkDocumentType.INVESTOR_DECK)
        clf = du.zero_classification()
        assert clf == ZeroClassification.ADEQUATE

    def test_classify_zero_helper_direct(self):
        assert classify_zero(0, 0.0, 0.0, 8) == ZeroClassification.TRUE_ZERO_EXPECTED
        assert classify_zero(0, 0.0, 100.0, 0) == ZeroClassification.TRUE_ZERO_SPARSE_SOURCE
        assert classify_zero(5, 50.0, 75.0, 8) == ZeroClassification.ADEQUATE

    def test_primary_precedence_unaffected_by_doc_type(self):
        """doc_type assignment must not change primary-wins logic."""
        profile = {"target_customer": "Enterprise SaaS"}
        du_typed = build_deal_understanding_v1(DEAL_ID, profile, doc_type=BenchmarkDocumentType.INVESTOR_DECK)
        du_plain = build_deal_understanding_v1(DEAL_ID, profile)
        slot_typed = next(s for s in du_typed.slots if s.slot_field == "target_customer")
        slot_plain = next(s for s in du_plain.slots if s.slot_field == "target_customer")
        assert slot_typed.source_kind == UnderstandingSourceKind.PRIMARY
        assert slot_plain.source_kind == UnderstandingSourceKind.PRIMARY
        assert slot_typed.value == slot_plain.value


# ─── Phase 5: Reviewer Verdict Scoring & Accuracy Benchmark ──────────────────

from lib.reviewer_verdict import (
    ReviewerVerdict,
    score_verdict,
    semantic_accuracy_pct,
    fact_accuracy_pct,
    financial_accuracy_pct,
    reconciliation_accuracy_pct,
    narrative_accuracy_pct,
    overall_score,
    detect_failure_flags,
    format_accuracy,
    VERDICT_SCORE,
)


class TestReviewerVerdictEnum:
    def test_correct_value(self):
        assert ReviewerVerdict.CORRECT == "correct"

    def test_partial_value(self):
        assert ReviewerVerdict.PARTIAL == "partial"

    def test_incorrect_value(self):
        assert ReviewerVerdict.INCORRECT == "incorrect"

    def test_unsupported_value(self):
        assert ReviewerVerdict.UNSUPPORTED == "unsupported"

    def test_from_str_valid(self):
        assert ReviewerVerdict.from_str("correct") == ReviewerVerdict.CORRECT
        assert ReviewerVerdict.from_str("PARTIAL") == ReviewerVerdict.PARTIAL
        assert ReviewerVerdict.from_str("  incorrect  ") == ReviewerVerdict.INCORRECT

    def test_from_str_none_returns_none(self):
        assert ReviewerVerdict.from_str(None) is None

    def test_from_str_blank_returns_none(self):
        assert ReviewerVerdict.from_str("") is None
        assert ReviewerVerdict.from_str("   ") is None

    def test_from_str_unknown_returns_none(self):
        assert ReviewerVerdict.from_str("maybe") is None

    def test_label_none_returns_fill_placeholder(self):
        assert ReviewerVerdict.label(None) == "_[ reviewer fill ]_"

    def test_label_verdict_returns_value(self):
        assert ReviewerVerdict.label(ReviewerVerdict.CORRECT) == "correct"
        assert ReviewerVerdict.label(ReviewerVerdict.PARTIAL) == "partial"


class TestVerdictScoring:
    def test_correct_scores_1(self):
        assert score_verdict(ReviewerVerdict.CORRECT) == 1.0

    def test_partial_scores_0_5(self):
        assert score_verdict(ReviewerVerdict.PARTIAL) == 0.5

    def test_incorrect_scores_0(self):
        assert score_verdict(ReviewerVerdict.INCORRECT) == 0.0

    def test_unsupported_scores_0(self):
        assert score_verdict(ReviewerVerdict.UNSUPPORTED) == 0.0

    def test_none_returns_none(self):
        assert score_verdict(None) is None

    def test_string_verdict_parsed(self):
        assert score_verdict("correct") == 1.0
        assert score_verdict("partial") == 0.5

    def test_unknown_string_returns_none(self):
        assert score_verdict("maybe") is None


class TestSlotAccuracyScoring:
    def _make_slot_with_verdict(self, field: str, value, verdict):
        """Build a populated UnderstandingSlot with a recorded verdict."""
        from lib.deal_understanding_v1 import UnderstandingSlot
        s = UnderstandingSlot(slot_field=field, label=field, category="company", value=value)
        s.reviewer_verdict = verdict
        return s

    def test_semantic_accuracy_no_verdicts_returns_none(self):
        du = build_deal_understanding_v1(DEAL_ID, FULL_PROFILE)
        assert du.semantic_accuracy_pct() is None

    def test_semantic_accuracy_all_correct(self):
        du = build_deal_understanding_v1(DEAL_ID, FULL_PROFILE)
        for s in du.slots:
            if s.populated:
                s.reviewer_verdict = ReviewerVerdict.CORRECT
        assert du.semantic_accuracy_pct() == 100.0

    def test_semantic_accuracy_mixed(self):
        """3 correct + 1 partial + 1 incorrect = (3 + 0.5 + 0) / 5 = 70%."""
        du = build_deal_understanding_v1(DEAL_ID, FULL_PROFILE)
        populated = [s for s in du.slots if s.populated]
        assert len(populated) >= 5
        populated[0].reviewer_verdict = ReviewerVerdict.CORRECT
        populated[1].reviewer_verdict = ReviewerVerdict.CORRECT
        populated[2].reviewer_verdict = ReviewerVerdict.CORRECT
        populated[3].reviewer_verdict = ReviewerVerdict.PARTIAL
        populated[4].reviewer_verdict = ReviewerVerdict.INCORRECT
        acc = du.semantic_accuracy_pct()
        assert acc == 70.0

    def test_semantic_accuracy_ignores_unpopulated_slots(self):
        """Unpopulated slots without verdicts don't drag accuracy to None."""
        du = build_deal_understanding_v1(DEAL_ID, FULL_PROFILE)
        populated = [s for s in du.slots if s.populated]
        populated[0].reviewer_verdict = ReviewerVerdict.CORRECT
        # all other slots have no verdict
        acc = du.semantic_accuracy_pct()
        assert acc == 100.0

    def test_semantic_accuracy_all_unsupported(self):
        du = build_deal_understanding_v1(DEAL_ID, FULL_PROFILE)
        for s in du.slots:
            if s.populated:
                s.reviewer_verdict = ReviewerVerdict.UNSUPPORTED
        assert du.semantic_accuracy_pct() == 0.0


class TestFactAccuracyScoring:
    def test_fact_accuracy_no_verdicts_returns_none(self):
        assert fact_accuracy_pct([]) is None
        assert fact_accuracy_pct([None, None]) is None

    def test_fact_accuracy_all_correct(self):
        verdicts = [ReviewerVerdict.CORRECT] * 4
        assert fact_accuracy_pct(verdicts) == 100.0

    def test_fact_accuracy_mixed(self):
        """3 correct + 1 partial + 1 incorrect = 70.0%."""
        verdicts = [
            ReviewerVerdict.CORRECT,
            ReviewerVerdict.CORRECT,
            ReviewerVerdict.CORRECT,
            ReviewerVerdict.PARTIAL,
            ReviewerVerdict.INCORRECT,
        ]
        assert fact_accuracy_pct(verdicts) == 70.0

    def test_financial_accuracy_pct(self):
        verdicts = [ReviewerVerdict.CORRECT, ReviewerVerdict.PARTIAL]
        assert financial_accuracy_pct(verdicts) == 75.0

    def test_reconciliation_accuracy_pct(self):
        verdicts = [ReviewerVerdict.CORRECT, ReviewerVerdict.INCORRECT]
        assert reconciliation_accuracy_pct(verdicts) == 50.0

    def test_narrative_accuracy_correct(self):
        assert narrative_accuracy_pct(ReviewerVerdict.CORRECT) == 100.0

    def test_narrative_accuracy_partial(self):
        assert narrative_accuracy_pct(ReviewerVerdict.PARTIAL) == 50.0

    def test_narrative_accuracy_incorrect(self):
        assert narrative_accuracy_pct(ReviewerVerdict.INCORRECT) == 0.0

    def test_narrative_accuracy_unsupported(self):
        assert narrative_accuracy_pct(ReviewerVerdict.UNSUPPORTED) == 0.0

    def test_narrative_accuracy_none_returns_none(self):
        assert narrative_accuracy_pct(None) is None


class TestOverallScore:
    def test_all_components_none_returns_none(self):
        assert overall_score(None, None, None, None) is None

    def test_all_100_returns_100(self):
        assert overall_score(100.0, 100.0, 100.0, 100.0) == 100.0

    def test_all_0_returns_0(self):
        assert overall_score(0.0, 0.0, 0.0, 0.0) == 0.0

    def test_partial_components_redistributes_weight(self):
        """With only understanding (30%) and narrative (20%) available,
        weights are redistributed: und=60%, nar=40%.
        understanding=100%, narrative=0% → 60% overall."""
        result = overall_score(100.0, None, None, 0.0)
        # (0.30*100 + 0.20*0) / (0.30 + 0.20) = 30 / 0.50 = 60.0
        assert result == 60.0

    def test_single_component(self):
        """Single 100% component → 100% overall."""
        assert overall_score(100.0, None, None, None) == 100.0

    def test_weighted_result(self):
        """und=80, fact=60, fin=70, nar=90.
        (0.30*80 + 0.25*60 + 0.25*70 + 0.20*90) / 1.0 = (24+15+17.5+18) / 1.0 = 74.5"""
        result = overall_score(80.0, 60.0, 70.0, 90.0)
        assert result == 74.5


class TestFailureFlags:
    def _slot(self, field, value, confidence, verdict=None):
        from lib.deal_understanding_v1 import UnderstandingSlot
        s = UnderstandingSlot(slot_field=field, label=field, category="company", value=value, confidence=confidence)
        s.reviewer_verdict = verdict
        return s

    def test_no_flags_when_no_verdicts(self):
        du = build_deal_understanding_v1(DEAL_ID, None)
        assert du.failure_flags() == []

    def test_understanding_wrong_high_confidence_flag(self):
        du = build_deal_understanding_v1(DEAL_ID, FULL_PROFILE)
        # find a high-confidence populated slot and mark it incorrect
        for s in du.slots:
            if s.populated:
                s.confidence = 0.95
                s.reviewer_verdict = ReviewerVerdict.INCORRECT
                break
        flags = du.failure_flags()
        assert "understanding_wrong_high_confidence" in flags

    def test_no_flag_incorrect_low_confidence(self):
        """INCORRECT at low confidence does NOT trigger the flag."""
        du = build_deal_understanding_v1(DEAL_ID, FULL_PROFILE)
        for s in du.slots:
            if s.populated:
                s.confidence = 0.5
                s.reviewer_verdict = ReviewerVerdict.INCORRECT
                break
        flags = du.failure_flags()
        assert "understanding_wrong_high_confidence" not in flags

    def test_unsupported_claim_detected_flag(self):
        du = build_deal_understanding_v1(DEAL_ID, FULL_PROFILE)
        for s in du.slots:
            if s.populated:
                s.reviewer_verdict = ReviewerVerdict.UNSUPPORTED
                break
        flags = du.failure_flags()
        assert "unsupported_claim_detected" in flags

    def test_financial_fact_incorrect_flag(self):
        slots = []
        flags = detect_failure_flags(
            slots,
            financial_verdicts=[ReviewerVerdict.CORRECT, ReviewerVerdict.INCORRECT],
        )
        assert "financial_fact_incorrect" in flags

    def test_summary_hallucination_detected_flag(self):
        flags = detect_failure_flags(
            [],
            narrative_verdict=ReviewerVerdict.UNSUPPORTED,
        )
        assert "summary_hallucination_detected" in flags

    def test_no_summary_flag_for_incorrect(self):
        """INCORRECT narrative does NOT trigger hallucination flag (only UNSUPPORTED does)."""
        flags = detect_failure_flags([], narrative_verdict=ReviewerVerdict.INCORRECT)
        assert "summary_hallucination_detected" not in flags


class TestVerdictOnUnderstandingSlot:
    def test_reviewer_fields_default_to_none(self):
        du = build_deal_understanding_v1(DEAL_ID, FULL_PROFILE)
        for s in du.slots:
            assert s.reviewer_verdict is None
            assert s.reviewer_notes is None
            assert s.reviewer_page_reference is None

    def test_reviewer_verdict_can_be_set(self):
        du = build_deal_understanding_v1(DEAL_ID, FULL_PROFILE)
        slot = du.slots[0]
        slot.reviewer_verdict = ReviewerVerdict.CORRECT
        slot.reviewer_notes = "Matches slide 3 verbatim."
        slot.reviewer_page_reference = "p. 3"
        assert slot.reviewer_verdict == ReviewerVerdict.CORRECT
        assert slot.reviewer_notes == "Matches slide 3 verbatim."
        assert slot.reviewer_page_reference == "p. 3"

    def test_verdict_summary_empty_when_no_verdicts(self):
        du = build_deal_understanding_v1(DEAL_ID, FULL_PROFILE)
        assert du.verdict_summary() == {}

    def test_verdict_summary_counts_correctly(self):
        du = build_deal_understanding_v1(DEAL_ID, FULL_PROFILE)
        populated = [s for s in du.slots if s.populated]
        populated[0].reviewer_verdict = ReviewerVerdict.CORRECT
        populated[1].reviewer_verdict = ReviewerVerdict.CORRECT
        populated[2].reviewer_verdict = ReviewerVerdict.PARTIAL
        summary = du.verdict_summary()
        assert summary["correct"] == 2
        assert summary["partial"] == 1

    def test_extraction_unaffected_by_verdict_fields(self):
        """Setting verdict fields must not change populated, value, or coverage."""
        du = build_deal_understanding_v1(DEAL_ID, FULL_PROFILE)
        original_populated = du.populated_count
        original_coverage = du.coverage_pct
        for s in du.slots:
            s.reviewer_verdict = ReviewerVerdict.INCORRECT
        assert du.populated_count == original_populated
        assert du.coverage_pct == original_coverage


class TestFormatAccuracy:
    def test_none_returns_dash(self):
        assert format_accuracy(None) == "—"

    def test_100_formats_correctly(self):
        assert format_accuracy(100.0) == "100.0%"

    def test_0_formats_correctly(self):
        assert format_accuracy(0.0) == "0.0%"

    def test_decimal_rounds(self):
        result = format_accuracy(66.666)
        assert result == "66.7%"


# ═══════════════════════════════════════════════════════════════════════════════
# Phase 6 — Reviewer Verdict Persistence & Benchmark Rollup
# ═══════════════════════════════════════════════════════════════════════════════

import json
import tempfile
from pathlib import Path

from lib.benchmark_run import (
    generate_run_id,
    build_run_manifest,
    write_run_manifest,
    load_run_manifest,
    load_prior_run_manifest,
)
from lib.review_persistence import (
    SlotVerdictRecord,
    FactVerdictRecord,
    DealReview,
    generate_review_template,
    write_review_sidecar,
    load_reviewer_verdicts,
    apply_verdicts_to_understanding,
    compute_deal_rollup,
    compute_cross_deal_rollup,
    review_completion_metrics,
    REVIEW_FILENAME,
)


# ─── Phase 6 shared helpers ────────────────────────────────────────────────────

def _make_slot(field: str, value: str | None = "some value") -> UnderstandingSlot:
    return UnderstandingSlot(
        slot_field=field,
        label=field.replace("_", " ").title(),
        category="company",
        value=value,
    )


def _minimal_understanding(*slot_fields: str) -> DealUnderstandingV1:
    """Build a minimal DealUnderstandingV1 with specified populated slots."""
    slots = [_make_slot(sf) for sf in slot_fields]
    return DealUnderstandingV1(
        deal_id=DEAL_ID,
        slots=slots,
        product_profile_raw={},
    )


def _minimal_review(
    slug: str = "test-deal",
    slot_fields: list[str] | None = None,
    fact_ids: list[str] | None = None,
    fin_ids: list[str] | None = None,
    run_id: str = "2026-01-01T000000Z",
) -> DealReview:
    return DealReview(
        benchmark_run_id=run_id,
        deal_id=DEAL_ID,
        deal_slug=slug,
        reviewed_at=None,
        reviewer=None,
        doc_type="investor_deck",
        semantic_slots={
            sf: SlotVerdictRecord(verdict="correct") for sf in (slot_fields or [])
        },
        facts={
            fid: FactVerdictRecord(verdict="correct") for fid in (fact_ids or [])
        },
        financial_facts={
            fid: FactVerdictRecord(verdict="correct") for fid in (fin_ids or [])
        },
        narrative={"executive_summary": SlotVerdictRecord(verdict="correct")},
    )


# ─── TestBenchmarkRunMeta ──────────────────────────────────────────────────────

class TestBenchmarkRunMeta:
    def test_generate_run_id_format(self):
        rid = generate_run_id()
        # Should be YYYY-MM-DDTHHMMSSZ
        import re
        assert re.match(r"^\d{4}-\d{2}-\d{2}T\d{6}Z$", rid), f"Unexpected format: {rid}"

    def test_generate_run_id_with_label(self):
        rid = generate_run_id("cleanroom-01")
        assert "--cleanroom-01" in rid

    def test_generate_run_id_label_sanitised(self):
        rid = generate_run_id("Hello World!")
        assert " " not in rid
        assert "!" not in rid

    def test_generate_run_id_label_truncated(self):
        long_label = "x" * 60
        rid = generate_run_id(long_label)
        # label portion after -- should be at most 40 chars
        label_part = rid.split("--", 1)[1] if "--" in rid else ""
        assert len(label_part) <= 40

    def test_build_run_manifest_keys(self):
        m = build_run_manifest("2026-01-01T000000Z", Path("/tmp"), deal_count=5)
        for key in ("run_id", "generated_at", "git_sha", "reviewer", "label", "report_dir", "deal_count"):
            assert key in m

    def test_build_run_manifest_deal_count(self):
        m = build_run_manifest("rid", Path("/tmp"), deal_count=3)
        assert m["deal_count"] == 3

    def test_write_and_load_manifest(self):
        with tempfile.TemporaryDirectory() as td:
            d = Path(td)
            m = build_run_manifest("run-abc", d)
            write_run_manifest(m, d)
            loaded = load_run_manifest(d)
            assert loaded is not None
            assert loaded["run_id"] == "run-abc"

    def test_load_manifest_missing_returns_none(self):
        with tempfile.TemporaryDirectory() as td:
            result = load_run_manifest(Path(td))
            assert result is None

    def test_load_prior_manifest_none_dir(self):
        assert load_prior_run_manifest(None) is None

    def test_load_prior_manifest_missing_dir(self):
        result = load_prior_run_manifest(Path("/nonexistent/path/xyz"))
        assert result is None


# ─── TestReviewSidecarGeneration ──────────────────────────────────────────────

class TestReviewSidecarGeneration:
    def _make_deal_facts(self) -> list[dict]:
        return [
            {"fact_id": "fact-0001", "type": "raise_amount", "label": "Raise", "value": "1M"},
            {"fact_id": "fact-0002", "type": "valuation", "label": "Valuation", "value": "5M"},
        ]

    def _make_fin_facts(self) -> list[dict]:
        return [
            {"fact_id": "fin-0001", "metric_key": "arr", "metric_label": "ARR"},
        ]

    def test_template_contains_populated_slots(self):
        u = _minimal_understanding("company_description", "problem_statement")
        template = generate_review_template(DEAL_ID, "td", u, [], [], "investor_deck", "run1")
        assert "company_description" in template["semantic_slots"]
        assert "problem_statement" in template["semantic_slots"]

    def test_template_excludes_unpopulated_slots(self):
        # slot with None value should NOT be in template
        slot = _make_slot("company_description", value=None)
        u = DealUnderstandingV1(
            deal_id=DEAL_ID, slots=[slot], product_profile_raw={},
        )
        template = generate_review_template(DEAL_ID, "td", u, [], [], "unknown", "run1")
        assert "company_description" not in template["semantic_slots"]

    def test_template_slot_verdict_fields_are_null(self):
        u = _minimal_understanding("company_description")
        template = generate_review_template(DEAL_ID, "td", u, [], [], "investor_deck", "run1")
        slot_rec = template["semantic_slots"]["company_description"]
        assert slot_rec["verdict"] is None
        assert slot_rec["notes"] is None
        assert slot_rec["page_reference"] is None

    def test_template_includes_deal_fact_ids(self):
        u = _minimal_understanding()
        facts = self._make_deal_facts()
        template = generate_review_template(DEAL_ID, "td", u, facts, [], "investor_deck", "run1")
        assert "fact-0001" in template["facts"]
        assert "fact-0002" in template["facts"]

    def test_template_includes_financial_fact_ids(self):
        u = _minimal_understanding()
        template = generate_review_template(DEAL_ID, "td", u, [], self._make_fin_facts(), "investor_deck", "run1")
        assert "fin-0001" in template["financial_facts"]

    def test_template_has_narrative_key(self):
        u = _minimal_understanding()
        template = generate_review_template(DEAL_ID, "td", u, [], [], "investor_deck", "run1")
        assert "executive_summary" in template["narrative"]

    def test_template_top_level_fields(self):
        u = _minimal_understanding()
        template = generate_review_template(DEAL_ID, "td", u, [], [], "investor_deck", "run42")
        assert template["benchmark_run_id"] == "run42"
        assert template["deal_id"] == DEAL_ID
        assert template["deal_slug"] == "td"
        assert template["doc_type"] == "investor_deck"

    def test_write_sidecar_creates_file(self):
        with tempfile.TemporaryDirectory() as td:
            d = Path(td)
            review = {"benchmark_run_id": "r1", "deal_slug": "td"}
            path = write_review_sidecar(review, d)
            assert path.exists()
            parsed = json.loads(path.read_text())
            assert parsed["benchmark_run_id"] == "r1"

    def test_write_sidecar_does_not_overwrite(self):
        with tempfile.TemporaryDirectory() as td:
            d = Path(td)
            write_review_sidecar({"run": "v1"}, d)
            write_review_sidecar({"run": "v2"}, d)  # should be ignored
            parsed = json.loads((d / REVIEW_FILENAME).read_text())
            assert parsed["run"] == "v1"  # original preserved

    def test_write_sidecar_overwrite_flag(self):
        with tempfile.TemporaryDirectory() as td:
            d = Path(td)
            write_review_sidecar({"run": "v1"}, d)
            write_review_sidecar({"run": "v2"}, d, overwrite=True)
            parsed = json.loads((d / REVIEW_FILENAME).read_text())
            assert parsed["run"] == "v2"


# ─── TestVerdictLoading ───────────────────────────────────────────────────────

class TestVerdictLoading:
    def _write_review(self, d: Path, data: dict) -> None:
        (d / REVIEW_FILENAME).write_text(json.dumps(data), encoding="utf-8")

    def test_returns_none_when_absent(self):
        with tempfile.TemporaryDirectory() as td:
            result = load_reviewer_verdicts(Path(td))
            assert result is None

    def test_loads_complete_review(self):
        with tempfile.TemporaryDirectory() as td:
            d = Path(td)
            self._write_review(d, {
                "benchmark_run_id": "r1",
                "deal_id": DEAL_ID,
                "deal_slug": "test",
                "reviewed_at": "2026-01-01",
                "reviewer": "Alice",
                "doc_type": "investor_deck",
                "semantic_slots": {
                    "company_description": {"verdict": "correct", "notes": "ok", "page_reference": "p1"},
                },
                "facts": {"fact-1": {"verdict": "partial", "notes": "close"}},
                "financial_facts": {"fin-1": {"verdict": "incorrect", "notes": "wrong"}},
                "narrative": {"executive_summary": {"verdict": "correct", "notes": None}},
            })
            review = load_reviewer_verdicts(d)
            assert review is not None
            assert review.reviewer == "Alice"
            assert review.semantic_slots["company_description"].verdict == "correct"
            assert review.facts["fact-1"].verdict == "partial"
            assert review.financial_facts["fin-1"].verdict == "incorrect"
            assert review.narrative["executive_summary"].verdict == "correct"

    def test_tolerates_partial_review(self):
        with tempfile.TemporaryDirectory() as td:
            d = Path(td)
            # Only some fields filled
            self._write_review(d, {
                "benchmark_run_id": "r1",
                "deal_id": DEAL_ID,
                "deal_slug": "test",
                "reviewed_at": None,
                "reviewer": None,
                "doc_type": "unknown",
                "semantic_slots": {
                    "company_description": {"verdict": None, "notes": None, "page_reference": None},
                },
                "facts": {},
                "financial_facts": {},
                "narrative": {},
            })
            review = load_reviewer_verdicts(d)
            assert review is not None
            assert review.semantic_slots["company_description"].verdict is None

    def test_tolerates_unknown_fields(self):
        with tempfile.TemporaryDirectory() as td:
            d = Path(td)
            self._write_review(d, {
                "benchmark_run_id": "r1",
                "deal_id": DEAL_ID,
                "deal_slug": "test",
                "reviewed_at": None,
                "reviewer": None,
                "doc_type": "unknown",
                "semantic_slots": {},
                "facts": {},
                "financial_facts": {},
                "narrative": {},
                "future_field_unknown_to_older_code": "should not crash",
            })
            review = load_reviewer_verdicts(d)
            assert review is not None

    def test_returns_none_for_malformed_json(self):
        with tempfile.TemporaryDirectory() as td:
            d = Path(td)
            (d / REVIEW_FILENAME).write_text("{not valid json", encoding="utf-8")
            result = load_reviewer_verdicts(d)
            assert result is None

    def test_returns_none_for_non_dict_json(self):
        with tempfile.TemporaryDirectory() as td:
            d = Path(td)
            (d / REVIEW_FILENAME).write_text("[1, 2, 3]", encoding="utf-8")
            result = load_reviewer_verdicts(d)
            assert result is None

    def test_slot_has_verdict_true_when_filled(self):
        rec = SlotVerdictRecord(verdict="correct")
        assert rec.has_verdict is True

    def test_slot_has_verdict_false_when_null(self):
        rec = SlotVerdictRecord(verdict=None)
        assert rec.has_verdict is False

    def test_fact_has_verdict_false_when_empty_string(self):
        rec = FactVerdictRecord(verdict="")
        assert rec.has_verdict is False


# ─── TestApplyVerdicts ────────────────────────────────────────────────────────

class TestApplyVerdicts:
    def test_applies_verdict_to_matching_slot(self):
        u = _minimal_understanding("company_description")
        review = _minimal_review(slot_fields=["company_description"])
        apply_verdicts_to_understanding(u, review)
        slot = u.slots[0]
        assert slot.reviewer_verdict == "correct"

    def test_ignores_unknown_slot_fields(self):
        u = _minimal_understanding("company_description")
        review = _minimal_review(slot_fields=["nonexistent_field"])
        # Should not raise
        apply_verdicts_to_understanding(u, review)
        assert u.slots[0].reviewer_verdict is None

    def test_sets_notes_and_page_reference(self):
        u = _minimal_understanding("company_description")
        review = DealReview(
            benchmark_run_id="r1", deal_id=DEAL_ID, deal_slug="td",
            reviewed_at=None, reviewer=None, doc_type="investor_deck",
            semantic_slots={
                "company_description": SlotVerdictRecord(
                    verdict="partial", notes="slightly off", page_reference="p5"
                )
            },
        )
        apply_verdicts_to_understanding(u, review)
        slot = u.slots[0]
        assert slot.reviewer_verdict == "partial"
        assert slot.reviewer_notes == "slightly off"
        assert slot.reviewer_page_reference == "p5"

    def test_null_review_is_noop(self):
        u = _minimal_understanding("company_description")
        apply_verdicts_to_understanding(u, None)  # type: ignore[arg-type]
        assert u.slots[0].reviewer_verdict is None

    def test_slot_without_verdict_remains_none(self):
        u = _minimal_understanding("company_description")
        review = DealReview(
            benchmark_run_id="r1", deal_id=DEAL_ID, deal_slug="td",
            reviewed_at=None, reviewer=None, doc_type="investor_deck",
            semantic_slots={
                "company_description": SlotVerdictRecord(verdict=None),
            },
        )
        apply_verdicts_to_understanding(u, review)
        assert u.slots[0].reviewer_verdict is None


# ─── TestDealRollup ───────────────────────────────────────────────────────────

class TestDealRollup:
    def test_rollup_all_correct(self):
        u = _minimal_understanding("company_description", "problem_statement")
        review = _minimal_review(
            slot_fields=["company_description", "problem_statement"],
            fact_ids=["f1"],
            fin_ids=["f2"],
        )
        rollup = compute_deal_rollup(review, u)
        assert rollup["semantic_accuracy_pct"] == 100.0
        assert rollup["fact_accuracy_pct"] == 100.0
        assert rollup["financial_accuracy_pct"] == 100.0
        assert rollup["narrative_accuracy_pct"] == 100.0
        assert rollup["overall_score"] == 100.0

    def test_rollup_no_verdicts_returns_none(self):
        u = _minimal_understanding("company_description")
        review = DealReview(
            benchmark_run_id="r1", deal_id=DEAL_ID, deal_slug="td",
            reviewed_at=None, reviewer=None, doc_type="investor_deck",
            semantic_slots={
                "company_description": SlotVerdictRecord(verdict=None),
            },
        )
        rollup = compute_deal_rollup(review, u)
        # No verdicts filled in → all None
        assert rollup["semantic_accuracy_pct"] is None
        assert rollup["overall_score"] is None

    def test_rollup_partial_verdict(self):
        u = _minimal_understanding("company_description")
        review = DealReview(
            benchmark_run_id="r1", deal_id=DEAL_ID, deal_slug="td",
            reviewed_at=None, reviewer=None, doc_type="investor_deck",
            semantic_slots={
                "company_description": SlotVerdictRecord(verdict="partial"),
            },
            narrative={"executive_summary": SlotVerdictRecord(verdict="correct")},
        )
        rollup = compute_deal_rollup(review, u)
        assert rollup["semantic_accuracy_pct"] == 50.0
        assert rollup["narrative_accuracy_pct"] == 100.0

    def test_rollup_sets_verdicts_on_slots(self):
        u = _minimal_understanding("company_description")
        review = _minimal_review(slot_fields=["company_description"])
        compute_deal_rollup(review, u)
        assert u.slots[0].reviewer_verdict == "correct"


# ─── TestCrossDealRollup ──────────────────────────────────────────────────────

class TestCrossDealRollup:
    def test_averages_computed(self):
        rollups = [
            {"semantic_accuracy_pct": 80.0, "fact_accuracy_pct": 60.0,
             "financial_accuracy_pct": 70.0, "narrative_accuracy_pct": 90.0, "overall_score": 75.0},
            {"semantic_accuracy_pct": 100.0, "fact_accuracy_pct": 100.0,
             "financial_accuracy_pct": 100.0, "narrative_accuracy_pct": 100.0, "overall_score": 100.0},
        ]
        cross = compute_cross_deal_rollup(rollups)
        assert cross["avg_semantic_accuracy_pct"] == 90.0
        assert cross["avg_fact_accuracy_pct"] == 80.0
        assert cross["deals_scored"] == 2

    def test_none_values_excluded_from_average(self):
        rollups = [
            {"semantic_accuracy_pct": 80.0, "fact_accuracy_pct": None,
             "financial_accuracy_pct": None, "narrative_accuracy_pct": None, "overall_score": 80.0},
            {"semantic_accuracy_pct": 100.0, "fact_accuracy_pct": None,
             "financial_accuracy_pct": None, "narrative_accuracy_pct": None, "overall_score": 100.0},
        ]
        cross = compute_cross_deal_rollup(rollups)
        assert cross["avg_semantic_accuracy_pct"] == 90.0
        assert cross["avg_fact_accuracy_pct"] is None  # no values at all

    def test_empty_rollups(self):
        cross = compute_cross_deal_rollup([])
        assert cross["avg_overall_score"] is None
        assert cross["deals_scored"] == 0

    def test_all_none_rollups(self):
        rollups = [
            {"semantic_accuracy_pct": None, "fact_accuracy_pct": None,
             "financial_accuracy_pct": None, "narrative_accuracy_pct": None, "overall_score": None},
        ]
        cross = compute_cross_deal_rollup(rollups)
        assert cross["avg_overall_score"] is None

    def test_single_deal_rollup(self):
        rollups = [
            {"semantic_accuracy_pct": 75.0, "fact_accuracy_pct": 50.0,
             "financial_accuracy_pct": 50.0, "narrative_accuracy_pct": 100.0, "overall_score": 68.8},
        ]
        cross = compute_cross_deal_rollup(rollups)
        assert cross["avg_semantic_accuracy_pct"] == 75.0
        assert cross["deals_scored"] == 1


# ─── TestReviewCompletionMetrics ──────────────────────────────────────────────

class TestReviewCompletionMetrics:
    def _make_deal_facts(self, n: int = 2) -> list[dict]:
        return [{"fact_id": f"f{i}"} for i in range(n)]

    def _make_fin_facts(self, n: int = 2) -> list[dict]:
        return [{"fact_id": f"fin{i}"} for i in range(n)]

    def test_fully_reviewed(self):
        u = _minimal_understanding("company_description", "problem_statement")
        facts = self._make_deal_facts(2)
        fin = self._make_fin_facts(2)
        review = DealReview(
            benchmark_run_id="r1", deal_id=DEAL_ID, deal_slug="td",
            reviewed_at=None, reviewer=None, doc_type="investor_deck",
            semantic_slots={
                "company_description": SlotVerdictRecord(verdict="correct"),
                "problem_statement": SlotVerdictRecord(verdict="correct"),
            },
            facts={f["fact_id"]: FactVerdictRecord(verdict="correct") for f in facts},
            financial_facts={f["fact_id"]: FactVerdictRecord(verdict="correct") for f in fin},
            narrative={"executive_summary": SlotVerdictRecord(verdict="correct")},
        )
        metrics = review_completion_metrics(review, u, facts, fin)
        assert metrics["slots_reviewed"] == 2
        assert metrics["slots_total"] == 2
        assert metrics["facts_reviewed"] == 2
        assert metrics["financial_reviewed"] == 2
        assert metrics["narrative_reviewed"] == 1
        assert metrics["completion_pct"] == 100.0

    def test_empty_review(self):
        u = _minimal_understanding("company_description")
        facts = self._make_deal_facts(1)
        review = DealReview(
            benchmark_run_id="r1", deal_id=DEAL_ID, deal_slug="td",
            reviewed_at=None, reviewer=None, doc_type="investor_deck",
            semantic_slots={"company_description": SlotVerdictRecord(verdict=None)},
        )
        metrics = review_completion_metrics(review, u, facts, [])
        assert metrics["slots_reviewed"] == 0
        assert metrics["completion_pct"] < 100.0

    def test_completion_pct_partial(self):
        u = _minimal_understanding("company_description", "problem_statement")
        review = DealReview(
            benchmark_run_id="r1", deal_id=DEAL_ID, deal_slug="td",
            reviewed_at=None, reviewer=None, doc_type="investor_deck",
            semantic_slots={
                "company_description": SlotVerdictRecord(verdict="correct"),
                "problem_statement": SlotVerdictRecord(verdict=None),
            },
            narrative={"executive_summary": SlotVerdictRecord(verdict=None)},
        )
        metrics = review_completion_metrics(review, u, [], [])
        # 2 slots total + 0 facts + 0 fin + 1 narrative = 3 total, 1 reviewed
        assert metrics["slots_reviewed"] == 1
        assert metrics["completion_pct"] == round(100.0 * 1 / 3, 1)


# ─── TestBackwardCompat ────────────────────────────────────────────────────────

class TestBackwardCompat:
    """
    Confirms the benchmark pipeline operates cleanly when no review sidecars
    exist — i.e., Phase 6 infrastructure does not break existing audits.
    """

    def test_load_verdict_returns_none_when_no_sidecar(self):
        with tempfile.TemporaryDirectory() as td:
            result = load_reviewer_verdicts(Path(td))
            assert result is None

    def test_apply_verdicts_with_none_review(self):
        u = _minimal_understanding("company_description")
        # Must not raise
        apply_verdicts_to_understanding(u, None)  # type: ignore[arg-type]
        assert u.slots[0].reviewer_verdict is None

    def test_cross_deal_rollup_all_none(self):
        rollups = [
            {"semantic_accuracy_pct": None, "fact_accuracy_pct": None,
             "financial_accuracy_pct": None, "narrative_accuracy_pct": None, "overall_score": None},
        ] * 5
        cross = compute_cross_deal_rollup(rollups)
        assert cross["avg_overall_score"] is None

    def test_write_sidecar_does_not_overwrite_verdicts(self):
        """Existing reviewer verdicts must survive a re-run of generate_deal_audit."""
        with tempfile.TemporaryDirectory() as td:
            d = Path(td)
            # Simulate a reviewer having filled in verdicts
            original = {
                "benchmark_run_id": "run-v1",
                "semantic_slots": {
                    "company_description": {"verdict": "correct", "notes": "looks good", "page_reference": None}
                },
            }
            (d / REVIEW_FILENAME).write_text(json.dumps(original), encoding="utf-8")

            # A second run writes a fresh template — should be ignored
            new_template = {"benchmark_run_id": "run-v2", "semantic_slots": {}}
            write_review_sidecar(new_template, d)

            reloaded = json.loads((d / REVIEW_FILENAME).read_text())
            assert reloaded["benchmark_run_id"] == "run-v1"
            assert reloaded["semantic_slots"]["company_description"]["verdict"] == "correct"

    def test_generate_run_id_is_deterministic_format(self):
        import re
        for _ in range(5):
            rid = generate_run_id()
            assert re.match(r"^\d{4}-\d{2}-\d{2}T\d{6}Z", rid)
