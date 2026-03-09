/**
 * evidence-confidence-evaluator.test.ts
 *
 * Unit tests for computeEvidenceConfidence and buildConfidenceSignals.
 * Pure functions — no DB, no LLM, no side effects.
 *
 * Coverage:
 *   1. Blocking: NotComputable → SUPPRESSED
 *   2. Blocking: numeric_sanity_pass=false → SUPPRESSED
 *   3. Conflict: has_cross_source_conflict → CONFLICTING
 *   4. Derived: source_type="derived" → PROVISIONAL
 *   5. Derived + external_corroborated → STRONG_EVIDENCE (upgrade)
 *   6. Text quality: text_quality_pass=false → WEAK_EVIDENCE
 *   7. Text quality + external_corroborated → STRONG_EVIDENCE (upgrade)
 *   8. Cross-validated: evidence_count >= 2 → VERIFIED
 *   9. XLSX single source → STRONG_EVIDENCE
 *  10. Deck single source → STRONG_EVIDENCE
 *  11. No evidence ref → WEAK_EVIDENCE
 *  12. External corroboration upgrades WEAK → STRONG
 *  13. External corroboration upgrades STRONG → VERIFIED
 *  14. Precedence: conflict beats derived
 *  15. Precedence: numeric sanity beats conflict
 *  16. buildConfidenceSignals: DERIVED_FROM_* maps to source_type="derived"
 *  17. buildConfidenceSignals: no reasonCode, null source → "unknown"
 *  18. FactConfidenceState.reason is non-empty string for all outcomes
 */

import { describe, it, expect } from "@jest/globals";
import {
  computeEvidenceConfidence,
  buildConfidenceSignals,
} from "../evidence-confidence-evaluator";
import { EVIDENCE_CONFIDENCE_LEVEL } from "../evidence-confidence";
import type { EvidenceConfidenceSignals } from "../evidence-confidence";

// ─── Fixture builder ─────────────────────────────────────────────────────────

function makeSignals(overrides: Partial<EvidenceConfidenceSignals> = {}): EvidenceConfidenceSignals {
  return {
    computability: "Computable",
    evidence_count: 1,
    source_type: "deck",
    has_cross_source_conflict: false,
    numeric_sanity_pass: true,
    text_quality_pass: true,
    external_corroborated: false,
    ...overrides,
  };
}

// ─── 1. Blocking: NotComputable ───────────────────────────────────────────────

describe("computeEvidenceConfidence — blocking: NotComputable", () => {
  it("returns SUPPRESSED for NotComputable fields", () => {
    const result = computeEvidenceConfidence(makeSignals({ computability: "NotComputable" }));
    expect(result.level).toBe(EVIDENCE_CONFIDENCE_LEVEL.SUPPRESSED);
  });

  it("returns SUPPRESSED regardless of other signals when NotComputable", () => {
    const result = computeEvidenceConfidence(
      makeSignals({
        computability: "NotComputable",
        evidence_count: 5,
        source_type: "xlsx",
        external_corroborated: true,
      }),
    );
    expect(result.level).toBe(EVIDENCE_CONFIDENCE_LEVEL.SUPPRESSED);
  });
});

// ─── 2. Blocking: numeric sanity ─────────────────────────────────────────────

describe("computeEvidenceConfidence — blocking: numeric_sanity_pass=false", () => {
  it("returns SUPPRESSED when numeric sanity fails", () => {
    const result = computeEvidenceConfidence(makeSignals({ numeric_sanity_pass: false }));
    expect(result.level).toBe(EVIDENCE_CONFIDENCE_LEVEL.SUPPRESSED);
  });

  it("SUPPRESSED from numeric sanity even with XLSX source", () => {
    const result = computeEvidenceConfidence(
      makeSignals({ numeric_sanity_pass: false, source_type: "xlsx" }),
    );
    expect(result.level).toBe(EVIDENCE_CONFIDENCE_LEVEL.SUPPRESSED);
  });
});

// ─── 3. Conflicting ──────────────────────────────────────────────────────────

describe("computeEvidenceConfidence — conflicting", () => {
  it("returns CONFLICTING when has_cross_source_conflict=true", () => {
    const result = computeEvidenceConfidence(makeSignals({ has_cross_source_conflict: true }));
    expect(result.level).toBe(EVIDENCE_CONFIDENCE_LEVEL.CONFLICTING);
  });

  it("CONFLICTING even with XLSX source and external corroboration", () => {
    const result = computeEvidenceConfidence(
      makeSignals({
        has_cross_source_conflict: true,
        source_type: "xlsx",
        external_corroborated: true,
      }),
    );
    expect(result.level).toBe(EVIDENCE_CONFIDENCE_LEVEL.CONFLICTING);
  });
});

// ─── 4. Derived → PROVISIONAL ────────────────────────────────────────────────

describe("computeEvidenceConfidence — derived", () => {
  it("returns PROVISIONAL for source_type='derived'", () => {
    const result = computeEvidenceConfidence(
      makeSignals({ source_type: "derived", has_cross_source_conflict: false }),
    );
    expect(result.level).toBe(EVIDENCE_CONFIDENCE_LEVEL.PROVISIONAL);
  });
});

// ─── 5. Derived + external corroboration → STRONG_EVIDENCE ───────────────────

describe("computeEvidenceConfidence — derived + external boost", () => {
  it("upgrades derived to STRONG_EVIDENCE when externally corroborated", () => {
    const result = computeEvidenceConfidence(
      makeSignals({ source_type: "derived", external_corroborated: true }),
    );
    expect(result.level).toBe(EVIDENCE_CONFIDENCE_LEVEL.STRONG_EVIDENCE);
  });
});

// ─── 6. Text quality failure → WEAK_EVIDENCE ─────────────────────────────────

describe("computeEvidenceConfidence — text quality failure", () => {
  it("returns WEAK_EVIDENCE when text_quality_pass=false", () => {
    const result = computeEvidenceConfidence(makeSignals({ text_quality_pass: false }));
    expect(result.level).toBe(EVIDENCE_CONFIDENCE_LEVEL.WEAK_EVIDENCE);
  });

  it("WEAK_EVIDENCE even with XLSX source type when text quality fails", () => {
    const result = computeEvidenceConfidence(
      makeSignals({ text_quality_pass: false, source_type: "xlsx" }),
    );
    expect(result.level).toBe(EVIDENCE_CONFIDENCE_LEVEL.WEAK_EVIDENCE);
  });
});

// ─── 7. Text quality failure + external boost → STRONG_EVIDENCE ──────────────

describe("computeEvidenceConfidence — text quality + external boost", () => {
  it("upgrades WEAK text to STRONG_EVIDENCE when externally corroborated", () => {
    const result = computeEvidenceConfidence(
      makeSignals({ text_quality_pass: false, external_corroborated: true }),
    );
    expect(result.level).toBe(EVIDENCE_CONFIDENCE_LEVEL.STRONG_EVIDENCE);
  });
});

// ─── 8. Cross-validated → VERIFIED ───────────────────────────────────────────

describe("computeEvidenceConfidence — cross-validated (evidence_count >= 2)", () => {
  it("returns VERIFIED when evidence_count=2", () => {
    const result = computeEvidenceConfidence(makeSignals({ evidence_count: 2 }));
    expect(result.level).toBe(EVIDENCE_CONFIDENCE_LEVEL.VERIFIED);
  });

  it("returns VERIFIED when evidence_count=5", () => {
    const result = computeEvidenceConfidence(makeSignals({ evidence_count: 5 }));
    expect(result.level).toBe(EVIDENCE_CONFIDENCE_LEVEL.VERIFIED);
  });
});

// ─── 9. XLSX single source → STRONG_EVIDENCE ─────────────────────────────────

describe("computeEvidenceConfidence — XLSX source", () => {
  it("returns STRONG_EVIDENCE for XLSX single source", () => {
    const result = computeEvidenceConfidence(makeSignals({ source_type: "xlsx", evidence_count: 1 }));
    expect(result.level).toBe(EVIDENCE_CONFIDENCE_LEVEL.STRONG_EVIDENCE);
  });
});

// ─── 10. Deck single source → STRONG_EVIDENCE ────────────────────────────────

describe("computeEvidenceConfidence — deck single source", () => {
  it("returns STRONG_EVIDENCE for deck source with evidence ref", () => {
    const result = computeEvidenceConfidence(makeSignals({ source_type: "deck", evidence_count: 1 }));
    expect(result.level).toBe(EVIDENCE_CONFIDENCE_LEVEL.STRONG_EVIDENCE);
  });
});

// ─── 11. No evidence reference → WEAK_EVIDENCE ───────────────────────────────

describe("computeEvidenceConfidence — no evidence reference", () => {
  it("returns WEAK_EVIDENCE when evidence_count=0 and source_type=deck", () => {
    const result = computeEvidenceConfidence(makeSignals({ evidence_count: 0, source_type: "deck" }));
    expect(result.level).toBe(EVIDENCE_CONFIDENCE_LEVEL.WEAK_EVIDENCE);
  });

  it("returns WEAK_EVIDENCE when evidence_count=0 and source_type=unknown", () => {
    const result = computeEvidenceConfidence(
      makeSignals({ evidence_count: 0, source_type: "unknown" }),
    );
    expect(result.level).toBe(EVIDENCE_CONFIDENCE_LEVEL.WEAK_EVIDENCE);
  });
});

// ─── 12-13. External corroboration upgrades ───────────────────────────────────

describe("computeEvidenceConfidence — external corroboration upgrades", () => {
  it("WEAK → STRONG_EVIDENCE via external corroboration", () => {
    const result = computeEvidenceConfidence(
      makeSignals({ evidence_count: 0, external_corroborated: true }),
    );
    expect(result.level).toBe(EVIDENCE_CONFIDENCE_LEVEL.STRONG_EVIDENCE);
  });

  it("STRONG_EVIDENCE → VERIFIED via external corroboration (XLSX source)", () => {
    const result = computeEvidenceConfidence(
      makeSignals({ source_type: "xlsx", evidence_count: 1, external_corroborated: true }),
    );
    expect(result.level).toBe(EVIDENCE_CONFIDENCE_LEVEL.VERIFIED);
  });

  it("STRONG_EVIDENCE → VERIFIED via external corroboration (deck source)", () => {
    const result = computeEvidenceConfidence(
      makeSignals({ source_type: "deck", evidence_count: 1, external_corroborated: true }),
    );
    expect(result.level).toBe(EVIDENCE_CONFIDENCE_LEVEL.VERIFIED);
  });

  it("VERIFIED stays VERIFIED with external corroboration (already at max)", () => {
    const result = computeEvidenceConfidence(
      makeSignals({ evidence_count: 2, external_corroborated: true }),
    );
    expect(result.level).toBe(EVIDENCE_CONFIDENCE_LEVEL.VERIFIED);
  });
});

// ─── 14. Precedence: conflict > derived ───────────────────────────────────────

describe("computeEvidenceConfidence — precedence ordering", () => {
  it("conflict beats derived source type", () => {
    const result = computeEvidenceConfidence(
      makeSignals({ has_cross_source_conflict: true, source_type: "derived" }),
    );
    expect(result.level).toBe(EVIDENCE_CONFIDENCE_LEVEL.CONFLICTING);
  });

  it("numeric sanity failure beats conflict", () => {
    const result = computeEvidenceConfidence(
      makeSignals({ numeric_sanity_pass: false, has_cross_source_conflict: true }),
    );
    expect(result.level).toBe(EVIDENCE_CONFIDENCE_LEVEL.SUPPRESSED);
  });

  it("NotComputable beats everything", () => {
    const result = computeEvidenceConfidence(
      makeSignals({
        computability: "NotComputable",
        has_cross_source_conflict: true,
        numeric_sanity_pass: false,
        external_corroborated: true,
      }),
    );
    expect(result.level).toBe(EVIDENCE_CONFIDENCE_LEVEL.SUPPRESSED);
  });
});

// ─── 15-17. buildConfidenceSignals ───────────────────────────────────────────

describe("buildConfidenceSignals", () => {
  it("maps DERIVED_FROM_* reasonCode to source_type='derived'", () => {
    const signals = buildConfidenceSignals({
      computability: "Computable",
      evidenceRef: "page-5",
      source: "deck",
      reasonCode: "DERIVED_FROM_FINANCIALS",
      hasConflict: false,
    });
    expect(signals.source_type).toBe("derived");
  });

  it("maps DERIVED_FROM_SAAS_KPI to source_type='derived'", () => {
    const signals = buildConfidenceSignals({
      computability: "Computable",
      evidenceRef: null,
      source: "xlsx",
      reasonCode: "DERIVED_FROM_SAAS_KPI",
      hasConflict: false,
    });
    expect(signals.source_type).toBe("derived");
  });

  it("preserves source when reasonCode is not DERIVED_FROM_*", () => {
    const signals = buildConfidenceSignals({
      computability: "Computable",
      evidenceRef: "page-3",
      source: "xlsx",
      reasonCode: null,
      hasConflict: false,
    });
    expect(signals.source_type).toBe("xlsx");
  });

  it("falls back to 'unknown' when source is null/undefined", () => {
    const signals = buildConfidenceSignals({
      computability: "Computable",
      evidenceRef: null,
      source: null,
      reasonCode: null,
      hasConflict: false,
    });
    expect(signals.source_type).toBe("unknown");
  });

  it("sets evidence_count=1 when evidenceRef is non-null", () => {
    const signals = buildConfidenceSignals({
      computability: "Computable",
      evidenceRef: "doc-1-p-3",
      source: "deck",
      reasonCode: null,
      hasConflict: false,
    });
    expect(signals.evidence_count).toBe(1);
  });

  it("sets evidence_count=0 when evidenceRef is null", () => {
    const signals = buildConfidenceSignals({
      computability: "Computable",
      evidenceRef: null,
      source: "deck",
      reasonCode: null,
      hasConflict: false,
    });
    expect(signals.evidence_count).toBe(0);
  });

  it("threads hasConflict through to has_cross_source_conflict", () => {
    const signals = buildConfidenceSignals({
      computability: "Computable",
      evidenceRef: "p-1",
      source: "deck",
      reasonCode: null,
      hasConflict: true,
    });
    expect(signals.has_cross_source_conflict).toBe(true);
  });

  it("threads externalCorroborated correctly", () => {
    const signals = buildConfidenceSignals({
      computability: "Computable",
      evidenceRef: "p-1",
      source: "deck",
      reasonCode: null,
      hasConflict: false,
      externalCorroborated: true,
    });
    expect(signals.external_corroborated).toBe(true);
  });
});

// ─── 18. FactConfidenceState.reason is always non-empty ──────────────────────

describe("computeEvidenceConfidence — reason is always non-empty", () => {
  const cases: Array<Partial<EvidenceConfidenceSignals>> = [
    { computability: "NotComputable" },
    { numeric_sanity_pass: false },
    { has_cross_source_conflict: true },
    { source_type: "derived" },
    { source_type: "derived", external_corroborated: true },
    { text_quality_pass: false },
    { text_quality_pass: false, external_corroborated: true },
    { evidence_count: 2 },
    { source_type: "xlsx" },
    { source_type: "deck", evidence_count: 1 },
    { evidence_count: 0 },
    { evidence_count: 0, external_corroborated: true },
    { source_type: "deck", evidence_count: 1, external_corroborated: true },
  ];

  for (const override of cases) {
    it(`reason is non-empty string for signals: ${JSON.stringify(override)}`, () => {
      const state = computeEvidenceConfidence(makeSignals(override));
      expect(typeof state.reason).toBe("string");
      expect(state.reason.length).toBeGreaterThan(0);
    });
  }
});
