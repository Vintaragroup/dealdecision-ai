/**
 * pr36-6-evidence-confidence.test.ts
 *
 * Regression tests for the Evidence Confidence Layer (PR36.6).
 *
 * Validates:
 *  1. buildConfidenceSignals assembles correct signals from canonical field attributes
 *  2. computeEvidenceConfidence scores correctly for key deal scenarios
 *  3. formatCanonicalFieldLine (via parseCanonicalFieldsBody round-trip) includes confidence token
 *  4. parseCanonicalFieldsBody round-trips confidence field correctly
 *  5. getFactPromotionPolicy enforces surface-aware rules
 *
 * This suite uses vitest (worker test framework) and imports from @dealdecision/core.
 * No DB, no LLM, no side effects.
 */

import { describe, it, expect } from "vitest";
import {
  computeEvidenceConfidence,
  buildConfidenceSignals,
  EVIDENCE_CONFIDENCE_LEVEL,
  getFactPromotionPolicy,
  isFactPromotable,
  getUncertaintyLabel,
} from "@dealdecision/core";
import { parseCanonicalFieldsBody } from "../../../orchestrator/render-package-helpers";

// ─── 1. buildConfidenceSignals ────────────────────────────────────────────────

describe("buildConfidenceSignals — worker integration", () => {
  it("ARR from XLSX: source=xlsx, no conflict → STRONG_EVIDENCE signals", () => {
    const signals = buildConfidenceSignals({
      computability: "Computable",
      evidenceRef: "xlsx-row-42",
      source: "xlsx",
      reasonCode: null,
      hasConflict: false,
    });
    expect(signals.computability).toBe("Computable");
    expect(signals.source_type).toBe("xlsx");
    expect(signals.evidence_count).toBe(1);
    expect(signals.has_cross_source_conflict).toBe(false);
  });

  it("Raise amount conflict: hasConflict=true → has_cross_source_conflict=true", () => {
    const signals = buildConfidenceSignals({
      computability: "Computable",
      evidenceRef: "slide-3",
      source: "deck",
      reasonCode: null,
      hasConflict: true,
    });
    expect(signals.has_cross_source_conflict).toBe(true);
  });

  it("Use-of-funds derived: DERIVED_FROM_BUDGET_MODEL → source_type='derived'", () => {
    const signals = buildConfidenceSignals({
      computability: "Computable",
      evidenceRef: null,
      source: "deck",
      reasonCode: "DERIVED_FROM_BUDGET_MODEL",
      hasConflict: false,
    });
    expect(signals.source_type).toBe("derived");
    expect(signals.evidence_count).toBe(0);
  });

  it("Suppressed field: NotComputable → computability=NotComputable", () => {
    const signals = buildConfidenceSignals({
      computability: "NotComputable",
      evidenceRef: null,
      source: null,
      reasonCode: "NO_RAISE_MENTION",
      hasConflict: false,
    });
    expect(signals.computability).toBe("NotComputable");
  });

  it("Weak OCR product_solution: no evidenceRef → evidence_count=0", () => {
    const signals = buildConfidenceSignals({
      computability: "Computable",
      evidenceRef: null,
      source: "deck",
      reasonCode: null,
      hasConflict: false,
    });
    expect(signals.evidence_count).toBe(0);
    expect(signals.source_type).toBe("deck");
  });
});

// ─── 2. computeEvidenceConfidence — deal scenarios ───────────────────────────

describe("computeEvidenceConfidence — deal scenarios", () => {
  it("ARR from XLSX (strong structured source) → STRONG_EVIDENCE", () => {
    const result = computeEvidenceConfidence(
      buildConfidenceSignals({
        computability: "Computable",
        evidenceRef: "xlsx-arr-cell",
        source: "xlsx",
        reasonCode: null,
        hasConflict: false,
      }),
    );
    expect(result.level).toBe(EVIDENCE_CONFIDENCE_LEVEL.STRONG_EVIDENCE);
  });

  it("Raise amount from deck+xlsx cross-validation → CONFLICTING", () => {
    const result = computeEvidenceConfidence(
      buildConfidenceSignals({
        computability: "Computable",
        evidenceRef: "slide-3",
        source: "deck",
        reasonCode: null,
        hasConflict: true,
      }),
    );
    expect(result.level).toBe(EVIDENCE_CONFIDENCE_LEVEL.CONFLICTING);
  });

  it("Suppressed malformed field → SUPPRESSED", () => {
    const result = computeEvidenceConfidence(
      buildConfidenceSignals({
        computability: "NotComputable",
        evidenceRef: null,
        source: null,
        reasonCode: "NO_RAISE_MENTION",
        hasConflict: false,
      }),
    );
    expect(result.level).toBe(EVIDENCE_CONFIDENCE_LEVEL.SUPPRESSED);
  });

  it("Derived use_of_funds (no direct evidence ref) → PROVISIONAL", () => {
    const result = computeEvidenceConfidence(
      buildConfidenceSignals({
        computability: "Computable",
        evidenceRef: null,
        source: "deck",
        reasonCode: "DERIVED_FROM_SAAS_KPI",
        hasConflict: false,
      }),
    );
    expect(result.level).toBe(EVIDENCE_CONFIDENCE_LEVEL.PROVISIONAL);
  });

  it("Weak OCR product fragment (no ref) → WEAK_EVIDENCE", () => {
    const result = computeEvidenceConfidence(
      buildConfidenceSignals({
        computability: "Computable",
        evidenceRef: null,
        source: "deck",
        reasonCode: null,
        hasConflict: false,
      }),
    );
    expect(result.level).toBe(EVIDENCE_CONFIDENCE_LEVEL.WEAK_EVIDENCE);
  });

  it("Deck single ref → STRONG_EVIDENCE", () => {
    const result = computeEvidenceConfidence(
      buildConfidenceSignals({
        computability: "Computable",
        evidenceRef: "page-7",
        source: "deck",
        reasonCode: null,
        hasConflict: false,
      }),
    );
    expect(result.level).toBe(EVIDENCE_CONFIDENCE_LEVEL.STRONG_EVIDENCE);
  });
});

// ─── 3. parseCanonicalFieldsBody round-trip (confidence field) ────────────────

describe("parseCanonicalFieldsBody — confidence round-trip", () => {
  it("parses confidence=STRONG_EVIDENCE from a Computable line", () => {
    const body =
      'category=raise_terms | field=raise_amount | computability=Computable | value="$2M" | evidence=slide-3 | reason=none | source=deck | confidence=STRONG_EVIDENCE';
    const fields = parseCanonicalFieldsBody(body);
    expect(fields).toHaveLength(1);
    expect(fields[0]!.confidence).toBe("STRONG_EVIDENCE");
    expect(fields[0]!.value).toBe("$2M");
  });

  it("parses confidence=CONFLICTING from a field line", () => {
    const body =
      'category=raise_terms | field=raise_amount | computability=Computable | value="$5M" | evidence=slide-2 | reason=none | source=deck | confidence=CONFLICTING';
    const fields = parseCanonicalFieldsBody(body);
    expect(fields[0]!.confidence).toBe("CONFLICTING");
  });

  it("parses confidence=SUPPRESSED from a NotComputable line", () => {
    const body =
      "category=market_claims | field=market_size | computability=NotComputable | value=none | evidence=none | reason=NO_MARKET_CLAIM_MENTION | source=unknown | confidence=SUPPRESSED";
    const fields = parseCanonicalFieldsBody(body);
    expect(fields[0]!.confidence).toBe("SUPPRESSED");
    expect(fields[0]!.value).toBeNull();
  });

  it("confidence is undefined when confidence token is absent (legacy lines)", () => {
    const body =
      'category=raise_terms | field=raise_amount | computability=Computable | value="$2M" | evidence=slide-3 | reason=none | source=deck';
    const fields = parseCanonicalFieldsBody(body);
    expect(fields[0]!.confidence).toBeUndefined();
  });

  it("handles multi-line body with mixed confidence levels", () => {
    const body = [
      'category=raise_terms | field=raise_amount | computability=Computable | value="$2M" | evidence=slide-3 | reason=none | source=deck | confidence=STRONG_EVIDENCE',
      "category=market_claims | field=market_size | computability=NotComputable | value=none | evidence=none | reason=NO_MARKET_CLAIM_MENTION | source=unknown | confidence=SUPPRESSED",
      'category=traction_signal | field=arr | computability=Computable | value="$1.2M" | evidence=xlsx-arr | reason=none | source=xlsx | confidence=STRONG_EVIDENCE',
    ].join("\n");

    const fields = parseCanonicalFieldsBody(body);
    expect(fields).toHaveLength(3);
    expect(fields[0]!.confidence).toBe("STRONG_EVIDENCE");
    expect(fields[1]!.confidence).toBe("SUPPRESSED");
    expect(fields[2]!.confidence).toBe("STRONG_EVIDENCE");
  });
});

// ─── 4. getFactPromotionPolicy — surface enforcement ─────────────────────────

describe("getFactPromotionPolicy — surface enforcement", () => {
  it("CONFLICTING raise_amount is NOT promotable on deal_overview", () => {
    const policy = getFactPromotionPolicy("CONFLICTING", "deal_overview");
    expect(policy.promotable).toBe(false);
    expect(policy.show_as_conflict).toBe(true);
  });

  it("CONFLICTING raise_amount is NOT promotable on investor_insights", () => {
    const policy = getFactPromotionPolicy("CONFLICTING", "investor_insights");
    expect(policy.promotable).toBe(false);
    expect(policy.uncertainty_label).toBe("conflicting signals");
  });

  it("WEAK_EVIDENCE is blocked on governed_summary", () => {
    expect(getFactPromotionPolicy("WEAK_EVIDENCE", "governed_summary").promotable).toBe(false);
  });

  it("WEAK_EVIDENCE shows with uncertainty label on investor_insights", () => {
    const policy = getFactPromotionPolicy("WEAK_EVIDENCE", "investor_insights");
    expect(policy.promotable).toBe(true);
    expect(policy.uncertainty_label).toBe("limited evidence");
  });

  it("STRONG_EVIDENCE ARR is promotable on deal_overview without label", () => {
    const policy = getFactPromotionPolicy("STRONG_EVIDENCE", "deal_overview");
    expect(policy.promotable).toBe(true);
    expect(policy.uncertainty_label).toBeNull();
  });

  it("VERIFIED is promotable on all surfaces", () => {
    const surfaces = [
      "deal_overview",
      "display_facts",
      "governed_summary",
      "llm_interpretation",
      "investor_insights",
      "data_tab",
    ] as const;
    for (const surface of surfaces) {
      expect(isFactPromotable("VERIFIED", surface)).toBe(true);
    }
  });

  it("SUPPRESSED is never promotable", () => {
    const surfaces = [
      "deal_overview",
      "display_facts",
      "governed_summary",
      "llm_interpretation",
      "investor_insights",
      "data_tab",
    ] as const;
    for (const surface of surfaces) {
      expect(isFactPromotable("SUPPRESSED", surface)).toBe(false);
    }
  });
});

// ─── 5. getUncertaintyLabel ───────────────────────────────────────────────────

describe("getUncertaintyLabel — worker integration", () => {
  it("WEAK_EVIDENCE → 'limited evidence'", () => {
    expect(getUncertaintyLabel("WEAK_EVIDENCE")).toBe("limited evidence");
  });

  it("CONFLICTING → 'conflicting signals'", () => {
    expect(getUncertaintyLabel("CONFLICTING")).toBe("conflicting signals");
  });

  it("PROVISIONAL → 'inferred'", () => {
    expect(getUncertaintyLabel("PROVISIONAL")).toBe("inferred");
  });

  it("VERIFIED → null", () => {
    expect(getUncertaintyLabel("VERIFIED")).toBeNull();
  });

  it("STRONG_EVIDENCE → null", () => {
    expect(getUncertaintyLabel("STRONG_EVIDENCE")).toBeNull();
  });
});
