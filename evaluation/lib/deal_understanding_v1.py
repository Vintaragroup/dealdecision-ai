"""
evaluation/lib/deal_understanding_v1.py
=======================================

Data model and multi-source assembler for DealUnderstandingV1.

Assembly uses a priority chain:
  Priority 1 — ProductProfileV1      (primary, confidence=1.0)
  Priority 2 — governed_summary_v1   (executive_summary text, conf≈0.4)
  Priority 3 — deal_facts_v1         (evidence-backed structured facts, conf 0.65-0.75)
  Priority 4 — Missing               (slot left empty, confidence=0.0)

Each slot records where its value came from (source_kind) and a confidence
score (0.0–1.0) so reviewers can calibrate how much to trust the answer.

Schema reference: packages/core/src/orchestrator/types.ts
  - ProductProfileV1, ProductProfileEvidence
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any

# Lazy import to avoid circular dependency — resolved at call time
_expectation_module = None

def _get_expectation_module():
    global _expectation_module
    if _expectation_module is None:
        from . import expectation_profiles as _ep
        _expectation_module = _ep
    return _expectation_module


# ---------------------------------------------------------------------------
# Source provenance constants
# ---------------------------------------------------------------------------

class UnderstandingSourceKind:
    """String enum for slot provenance."""
    PRIMARY            = "primary"
    GOVERNED_SUMMARY   = "governed_summary"
    DEAL_FACT          = "deal_fact"
    FINANCIAL_FACT     = "financial_fact"
    FUSED_FACT         = "fused_fact"
    NARRATIVE_FALLBACK = "narrative_fallback"
    MISSING            = "missing"

    LABELS: dict = {
        "primary":            "primary",
        "governed_summary":   "governed_summary",
        "deal_fact":          "deal_fact",
        "financial_fact":     "financial_fact",
        "fused_fact":         "fused_fact",
        "narrative_fallback": "narrative_fallback",
        "missing":            "—",
    }

    @classmethod
    def label(cls, kind: str) -> str:
        return cls.LABELS.get(kind, kind)

    @classmethod
    def all_kinds(cls) -> list:
        return [cls.PRIMARY, cls.GOVERNED_SUMMARY, cls.DEAL_FACT,
                cls.FINANCIAL_FACT, cls.FUSED_FACT, cls.NARRATIVE_FALLBACK,
                cls.MISSING]


# ---------------------------------------------------------------------------
# Data types
# ---------------------------------------------------------------------------

@dataclass
class UnderstandingSlot:
    """
    One semantic understanding field from the ProductProfileV1 schema.

    Extraction fields (set by builder):
      'populated'    - True when the system extracted a non-null, non-empty value
      'source_kind'  - where the value came from (UnderstandingSourceKind constant)
      'confidence'   - 0.0 (missing) to 1.0 (primary, fully confident)
      'evidence_ids' - grounding evidence IDs when available
      'expectation'  - 'expected' | 'optional' | 'unlikely' per document type profile

    Reviewer verdict fields (evaluation-only, do NOT affect extraction):
      'reviewer_verdict'        - ReviewerVerdict | None — accuracy judgement
      'reviewer_notes'          - free-text reviewer commentary
      'reviewer_page_reference' - manual page/slide citation for the verdict
    """
    slot_field: str
    label: str
    category: str           # 'company' | 'product' | 'ai'
    value: Any = None
    evidence_ids: list = field(default_factory=list)
    source_kind: str = "missing"
    confidence: float = 0.0
    expectation: str = "optional"  # set by apply_expectations() after construction
    # Reviewer-assigned accuracy verdict — evaluation only
    reviewer_verdict: Any = None   # ReviewerVerdict | str | None
    reviewer_notes: str | None = None
    reviewer_page_reference: str | None = None

    @property
    def populated(self) -> bool:
        if self.value is None:
            return False
        if isinstance(self.value, str) and not self.value.strip():
            return False
        if isinstance(self.value, list) and not self.value:
            return False
        return True  # bool False is a valid populated value

    def display_value(self, max_len: int = 120) -> str:
        if self.value is None:
            return "—"
        if isinstance(self.value, bool):
            return "yes" if self.value else "no"
        if isinstance(self.value, list):
            if not self.value:
                return "—"
            items = [str(v) for v in self.value]
            joined = "; ".join(items[:6])
            suffix = f" … (+{len(items) - 6} more)" if len(items) > 6 else ""
            raw = joined + suffix
            return raw[:max_len] + ("…" if len(raw) > max_len else "")
        s = str(self.value)
        if len(s) > max_len:
            return s[:max_len] + "…"
        return s or "—"

    def evidence_summary(self) -> str:
        if not self.evidence_ids:
            return "—"
        return f"{len(self.evidence_ids)} ref(s)"

    def confidence_label(self) -> str:
        if self.confidence >= 0.9:
            return "high"
        if self.confidence >= 0.6:
            return "medium"
        if self.confidence > 0.0:
            return "low"
        return "—"


@dataclass
class DealUnderstandingV1:
    """
    Assembled company / product semantic understanding for one deal.

    Built from a priority chain of sources via build_deal_understanding_v1().
    Reports slot coverage broken out by category and source provenance.
    Includes document-type-aware adjusted coverage (adjusted_coverage_pct).
    """
    deal_id: str
    product_profile_raw: Any  # raw parsed ProductProfileV1 dict or None
    slots: list = field(default_factory=list)
    doc_type: str = "unknown"  # BenchmarkDocumentType — set by builder

    @property
    def company_slots(self) -> list:
        return [s for s in self.slots if s.category == "company"]

    @property
    def product_slots(self) -> list:
        return [s for s in self.slots if s.category == "product"]

    @property
    def ai_slots(self) -> list:
        return [s for s in self.slots if s.category == "ai"]

    @property
    def populated_count(self) -> int:
        return sum(1 for s in self.slots if s.populated)

    @property
    def total_count(self) -> int:
        return len(self.slots)

    @property
    def coverage_pct(self) -> float:
        if self.total_count == 0:
            return 0.0
        return round(100.0 * self.populated_count / self.total_count, 1)

    def has_profile(self) -> bool:
        return self.product_profile_raw is not None

    def coverage_by_category(self) -> dict:
        cats: dict = {}
        for s in self.slots:
            p, t = cats.get(s.category, (0, 0))
            cats[s.category] = (p + (1 if s.populated else 0), t + 1)
        return cats

    def provenance_counts(self) -> dict:
        """Return {source_kind: count} for populated slots only."""
        counts: dict = {}
        for s in self.slots:
            if s.populated:
                counts[s.source_kind] = counts.get(s.source_kind, 0) + 1
        return counts

    @property
    def primary_count(self) -> int:
        return sum(1 for s in self.slots if s.populated and s.source_kind == UnderstandingSourceKind.PRIMARY)

    @property
    def fallback_count(self) -> int:
        return sum(1 for s in self.slots if s.populated and s.source_kind != UnderstandingSourceKind.PRIMARY)

    @property
    def missing_count(self) -> int:
        return sum(1 for s in self.slots if not s.populated)

    def is_false_zero_recovered(self) -> bool:
        """True when no primary profile existed but fallback populated >= 1 slot."""
        return not self.has_profile() and self.populated_count > 0

    # ── Expectation-aware coverage ──────────────────────────────────────────

    @property
    def expected_slots(self) -> list:
        from .expectation_profiles import ExpectationLevel
        return [s for s in self.slots if s.expectation == ExpectationLevel.EXPECTED]

    @property
    def optional_slots_list(self) -> list:
        from .expectation_profiles import ExpectationLevel
        return [s for s in self.slots if s.expectation == ExpectationLevel.OPTIONAL]

    @property
    def unlikely_slots_list(self) -> list:
        from .expectation_profiles import ExpectationLevel
        return [s for s in self.slots if s.expectation == ExpectationLevel.UNLIKELY]

    @property
    def expected_count(self) -> int:
        return len(self.expected_slots)

    @property
    def optional_count(self) -> int:
        return len(self.optional_slots_list)

    @property
    def unlikely_count(self) -> int:
        return len(self.unlikely_slots_list)

    @property
    def populated_expected_count(self) -> int:
        return sum(1 for s in self.expected_slots if s.populated)

    @property
    def adjusted_coverage_pct(self) -> float:
        from .expectation_profiles import adjusted_coverage_pct as _adj
        return _adj(self.slots)

    def zero_classification(self) -> str:
        from .expectation_profiles import classify_zero
        return classify_zero(
            self.populated_count,
            self.coverage_pct,
            self.adjusted_coverage_pct,
            self.expected_count,
        )

    # ── Reviewer accuracy scoring ────────────────────────────────────────────

    def semantic_accuracy_pct(self):
        """Accuracy % across populated slots with recorded reviewer verdicts.

        Returns None if no slot has a verdict yet.
        Scoring: correct=1.0, partial=0.5, incorrect=0.0, unsupported=0.0.
        """
        from .reviewer_verdict import semantic_accuracy_pct as _sa
        return _sa(self.slots)

    def verdict_summary(self) -> dict:
        """Return {verdict_value: count} for populated slots with verdicts."""
        counts: dict = {}
        for s in self.slots:
            if s.populated and s.reviewer_verdict is not None:
                # Normalise: enum member → its .value str; plain str passes through
                rv = s.reviewer_verdict
                key = rv.value if hasattr(rv, "value") else str(rv)
                counts[key] = counts.get(key, 0) + 1
        return counts

    def failure_flags(self) -> list:
        """Return active failure flag keys for this deal's understanding."""
        from .reviewer_verdict import detect_failure_flags
        return detect_failure_flags(self.slots)


# ---------------------------------------------------------------------------
# Slot definitions
# ---------------------------------------------------------------------------

# Each tuple: (field_key, display_label, category)
# Keep in sync with ProductProfileV1 in packages/core/src/orchestrator/types.ts
SLOT_DEFINITIONS: list = [
    # Company understanding
    ("company_description",          "Company Description",              "company"),
    ("problem_statement",            "Problem Statement",                "company"),
    ("solution_summary",             "Solution Summary",                 "company"),
    ("target_customer",              "Target Customer",                  "company"),
    ("buyer_persona",                "Buyer Persona",                    "company"),
    # Product profile
    ("product_type",                 "Product Type",                     "product"),
    ("delivery_model",               "Delivery Model",                   "product"),
    ("product_maturity",             "Product Maturity",                 "product"),
    ("core_workflow",                "Core Workflow Steps",              "product"),
    ("core_features",                "Core Features",                    "product"),
    ("differentiation_claims",       "Differentiation Claims",           "product"),
    ("integrations_or_dependencies", "Integrations / Dependencies",      "product"),
    # AI assessment
    ("ai_claims_present",            "AI Claims Present",                "ai"),
    ("ai_usage_summary",             "AI Usage Summary",                 "ai"),
    ("ai_usage_type",                "AI Usage Type",                    "ai"),
    ("ai_defensibility_notes",       "AI Defensibility Notes",           "ai"),
    ("ai_evidence_strength",         "AI Evidence Strength",             "ai"),
]


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _jval(obj: Any) -> Any:
    if isinstance(obj, (dict, list)):
        return obj
    if isinstance(obj, str):
        try:
            return json.loads(obj)
        except Exception:
            return obj
    return obj


def _extract_evidence_ids_from_facts(facts: list) -> list:
    ids: list = []
    for f in facts:
        sources = _jval(f.get("sources") or []) or []
        if isinstance(sources, list):
            for src in sources:
                if isinstance(src, dict):
                    eid = src.get("evidence_id")
                    if eid:
                        ids.append(str(eid))
    return ids


def _fact_value_str(fact: dict):
    val = _jval(fact.get("value"))
    if val is None:
        return None
    if isinstance(val, dict):
        v = val.get("value")
        return str(v).strip() or None if v is not None else None
    return str(val).strip() or None


def _parse_confidence(val, default: float = 0.7) -> float:
    """Parse a confidence value that may be a float, int, or string label."""
    if val is None:
        return default
    if isinstance(val, (int, float)):
        return float(val)
    s = str(val).strip().lower()
    return {"high": 0.9, "medium": 0.7, "low": 0.4}.get(s, default)


# ---------------------------------------------------------------------------
# Per-slot fallback functions
# ---------------------------------------------------------------------------

def _fallback_target_customer(deal_facts: list):
    facts = [f for f in deal_facts if f.get("type") == "target_customer"]
    if not facts:
        return None, 0.0, []
    for f in facts:
        val = _fact_value_str(f)
        if val:
            conf = min(max(_parse_confidence(f.get("confidence"), 0.7), 0.6), 1.0)
            return val, conf, _extract_evidence_ids_from_facts([f])
    return None, 0.0, []


def _fallback_delivery_model(deal_facts: list):
    facts = [f for f in deal_facts if f.get("type") == "business_model"]
    if not facts:
        return None, 0.0, []
    for f in facts:
        val = _fact_value_str(f)
        if val:
            return val, 0.7, _extract_evidence_ids_from_facts([f])
    return None, 0.0, []


def _fallback_core_features(deal_facts: list):
    facts = [f for f in deal_facts if f.get("type") == "product_capability"]
    if not facts:
        return None, 0.0, []
    values = [v for v in (_fact_value_str(f) for f in facts) if v]
    if not values:
        return None, 0.0, []
    return values, 0.65, _extract_evidence_ids_from_facts(facts)


def _fallback_ai_claims(deal_facts: list):
    facts = [f for f in deal_facts if f.get("type") == "ai_usage_claim"]
    if not facts:
        return None, 0.0, []
    return True, 0.75, _extract_evidence_ids_from_facts(facts)


def _fallback_company_description(governed_summary: Any):
    """governed_summary_v1 executive_summary -> company_description (no evidence IDs)."""
    if not governed_summary:
        return None, 0.0, []
    body = governed_summary
    if isinstance(body, str):
        marker = "---governed_summary_v1_json---"
        pos = body.find(marker)
        if pos >= 0:
            try:
                body = json.loads(body[pos + len(marker):].strip())
            except Exception:
                return None, 0.0, []
        else:
            return None, 0.0, []
    summary = body.get("executive_summary") if isinstance(body, dict) else None
    if summary and isinstance(summary, str) and summary.strip():
        return summary.strip(), 0.4, []  # no evidence_ids — narrative-only
    return None, 0.0, []


# ---------------------------------------------------------------------------
# Expectation application helper
# ---------------------------------------------------------------------------

def _apply_expectations_if_available(slots: list, doc_type: str) -> list:
    """Apply expectation profile to slots, failing safely if module unavailable."""
    try:
        from .expectation_profiles import apply_expectations
        return apply_expectations(slots, doc_type)
    except Exception:
        return slots


# ---------------------------------------------------------------------------
# Builder
# ---------------------------------------------------------------------------

def build_deal_understanding_v1(
    deal_id: str,
    product_profile: Any,
    *,
    deal_facts: list = None,
    governed_summary: Any = None,
    doc_type: str = "unknown",
) -> "DealUnderstandingV1":
    """
    Assemble DealUnderstandingV1 from a priority chain of sources.

    Priority chain per slot:
      1. ProductProfileV1 field value              (source_kind='primary',  conf=1.0)
      2. governed_summary executive_summary text   (source_kind='governed_summary', conf=0.4)
         — only for company_description
      3. deal_facts_v1 typed rows                  (source_kind='deal_fact', conf 0.65-0.75)
         — target_customer, delivery_model, core_features, ai_claims_present
      4. Missing                                   (source_kind='missing', conf=0.0)

    After slot assembly, expectation levels are applied from doc_type profile
    so adjusted_coverage_pct and zero_classification reflect realistic expectations.

    Parameters
    ----------
    deal_id          : deal UUID
    product_profile  : parsed ProductProfileV1 dict, or None
    deal_facts       : list of deal_facts_v1 row dicts (optional keyword)
    governed_summary : parsed governed_summary_v1 section body (optional keyword)
    doc_type         : BenchmarkDocumentType string (optional keyword, default 'unknown')
    """
    deal_facts = deal_facts or []

    # Evidence map from primary profile
    evidence_map: dict = {}
    if product_profile:
        ev_obj = product_profile.get("evidence") or {}
        if isinstance(ev_obj, dict):
            for k, v in ev_obj.items():
                if isinstance(v, list):
                    evidence_map[k] = [str(e) for e in v if e]

    # Precompute fallback results
    _fb_desc   = _fallback_company_description(governed_summary)
    _fb_target = _fallback_target_customer(deal_facts)
    _fb_model  = _fallback_delivery_model(deal_facts)
    _fb_feats  = _fallback_core_features(deal_facts)
    _fb_ai     = _fallback_ai_claims(deal_facts)

    K = UnderstandingSourceKind

    def _fb_entry(triple, kind):
        val, conf, ev = triple
        return (val, conf, ev, kind) if val is not None else None

    FALLBACK: dict = {
        "company_description": _fb_entry(_fb_desc,   K.GOVERNED_SUMMARY),
        "target_customer":     _fb_entry(_fb_target,  K.DEAL_FACT),
        "delivery_model":      _fb_entry(_fb_model,   K.DEAL_FACT),
        "core_features":       _fb_entry(_fb_feats,   K.DEAL_FACT),
        "ai_claims_present":   _fb_entry(_fb_ai,      K.DEAL_FACT),
    }

    slots: list = []

    for slot_field, label, category in SLOT_DEFINITIONS:

        # Priority 1 — ProductProfileV1
        if product_profile is not None:
            raw_value = product_profile.get(slot_field)
            is_present = (
                raw_value is not None
                and not (isinstance(raw_value, str) and not raw_value.strip())
                and not (isinstance(raw_value, list) and not raw_value)
            )
            if is_present:
                slots.append(UnderstandingSlot(
                    slot_field=slot_field, label=label, category=category,
                    value=raw_value, evidence_ids=evidence_map.get(slot_field, []),
                    source_kind=K.PRIMARY, confidence=1.0,
                ))
                continue

        # Priority 2/3 — Fallback sources
        fb = FALLBACK.get(slot_field)
        if fb is not None:
            fb_val, fb_conf, fb_ev, fb_kind = fb
            slots.append(UnderstandingSlot(
                slot_field=slot_field, label=label, category=category,
                value=fb_val, evidence_ids=fb_ev,
                source_kind=fb_kind, confidence=fb_conf,
            ))
            continue

        # Priority 4 — Missing
        slots.append(UnderstandingSlot(
            slot_field=slot_field, label=label, category=category,
            value=None, evidence_ids=[],
            source_kind=K.MISSING, confidence=0.0,
        ))

    return DealUnderstandingV1(
        deal_id=deal_id,
        product_profile_raw=product_profile,
        doc_type=doc_type,
        slots=_apply_expectations_if_available(slots, doc_type),
    )


# ---------------------------------------------------------------------------
# DB fetchers
# ---------------------------------------------------------------------------

def fetch_product_profile_v1(conn, deal_id: str):
    """Pull ProductProfileV1 body from render_package sections. Returns dict or None."""
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT s->>'body' AS body
                FROM investor_insight_reports r,
                     jsonb_array_elements(r.render_package->'sections') s
                WHERE r.deal_id = %s
                  AND s->>'key' = 'product_profile_v1'
                  AND r.status NOT IN ('failed', 'quarantined')
                ORDER BY r.updated_at DESC
                LIMIT 1
                """,
                (deal_id,),
            )
            row = cur.fetchone()
        if not row:
            return None
        body = row["body"] if isinstance(row, dict) else row[0]
        if not body:
            return None
        return json.loads(body) if isinstance(body, str) else body
    except Exception:
        return None


def fetch_governed_summary_v1(conn, deal_id: str):
    """
    Pull governed_summary_v1 section body from render_package.
    Returns parsed dict (with executive_summary etc.) or None.
    """
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT s->>'body' AS body
                FROM investor_insight_reports r,
                     jsonb_array_elements(r.render_package->'sections') s
                WHERE r.deal_id = %s
                  AND s->>'key' = 'governed_summary_v1'
                  AND r.status NOT IN ('failed', 'quarantined')
                ORDER BY r.updated_at DESC
                LIMIT 1
                """,
                (deal_id,),
            )
            row = cur.fetchone()
        if not row:
            return None
        body = row["body"] if isinstance(row, dict) else row[0]
        if not body:
            return None
        if isinstance(body, dict):
            return body
        # Try direct JSON parse first
        try:
            return json.loads(body)
        except Exception:
            pass
        # Extract after embedded JSON marker
        marker = "---governed_summary_v1_json---"
        pos = body.find(marker)
        if pos < 0:
            return None
        try:
            return json.loads(body[pos + len(marker):].strip())
        except Exception:
            return None
    except Exception:
        return None


def fetch_understanding_fallback_inputs(conn, deal_id: str) -> dict:
    """
    Fetch all fallback inputs needed for build_deal_understanding_v1().

    Returns:
        {
            "deal_facts": [...]     list of deal_facts_v1 row dicts
            "governed_summary": {}  parsed governed_summary_v1 body or None
        }
    """
    deal_facts: list = []
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT fact_id, type, label, value, confidence, sources
                FROM deal_facts_v1
                WHERE deal_id = %s
                ORDER BY type, label
                """,
                (deal_id,),
            )
            deal_facts = [dict(r) for r in cur.fetchall()]
    except Exception:
        pass

    return {
        "deal_facts": deal_facts,
        "governed_summary": fetch_governed_summary_v1(conn, deal_id),
    }
