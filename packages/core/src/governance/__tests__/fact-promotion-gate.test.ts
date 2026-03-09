/**
 * fact-promotion-gate.test.ts
 *
 * Unit tests for getFactPromotionPolicy, isFactPromotable, getUncertaintyLabel,
 * and isDefinitiveFact. Pure functions — no DB, no LLM.
 *
 * Coverage:
 *   1. VERIFIED is promotable on all surfaces with no label
 *   2. STRONG_EVIDENCE is promotable on all surfaces with no label
 *   3. WEAK_EVIDENCE is blocked on strict surfaces (deal_overview, governed_summary)
 *   4. WEAK_EVIDENCE is promotable with "limited evidence" on permissive surfaces
 *   5. CONFLICTING is never promotable as a fact; show_as_conflict=true
 *   6. PROVISIONAL only visible in data_tab
 *   7. SUPPRESSED never promotable on any surface
 *   8. getUncertaintyLabel returns correct labels
 *   9. isDefinitiveFact identifies VERIFIED and STRONG_EVIDENCE
 */

import { describe, it, expect } from "@jest/globals";
import {
  getFactPromotionPolicy,
  isFactPromotable,
  getUncertaintyLabel,
  isDefinitiveFact,
  type PromotionSurface,
} from "../fact-promotion-gate";
import { EVIDENCE_CONFIDENCE_LEVEL } from "../../evidence/evidence-confidence";

const ALL_SURFACES: PromotionSurface[] = [
  "deal_overview",
  "display_facts",
  "governed_summary",
  "llm_interpretation",
  "investor_insights",
  "data_tab",
];

// ─── 1. VERIFIED ──────────────────────────────────────────────────────────────

describe("getFactPromotionPolicy — VERIFIED", () => {
  for (const surface of ALL_SURFACES) {
    it(`is promotable on ${surface}`, () => {
      const p = getFactPromotionPolicy("VERIFIED", surface);
      expect(p.promotable).toBe(true);
    });

    it(`has null uncertainty_label on ${surface}`, () => {
      const p = getFactPromotionPolicy("VERIFIED", surface);
      expect(p.uncertainty_label).toBeNull();
    });

    it(`show_as_conflict=false on ${surface}`, () => {
      const p = getFactPromotionPolicy("VERIFIED", surface);
      expect(p.show_as_conflict).toBe(false);
    });
  }
});

// ─── 2. STRONG_EVIDENCE ───────────────────────────────────────────────────────

describe("getFactPromotionPolicy — STRONG_EVIDENCE", () => {
  for (const surface of ALL_SURFACES) {
    it(`is promotable on ${surface}`, () => {
      const p = getFactPromotionPolicy("STRONG_EVIDENCE", surface);
      expect(p.promotable).toBe(true);
    });

    it(`null uncertainty_label on ${surface}`, () => {
      const p = getFactPromotionPolicy("STRONG_EVIDENCE", surface);
      expect(p.uncertainty_label).toBeNull();
    });
  }
});

// ─── 3. WEAK_EVIDENCE — strict surfaces block ────────────────────────────────

describe("getFactPromotionPolicy — WEAK_EVIDENCE strict surfaces", () => {
  it("blocked on deal_overview", () => {
    expect(getFactPromotionPolicy("WEAK_EVIDENCE", "deal_overview").promotable).toBe(false);
  });

  it("blocked on governed_summary", () => {
    expect(getFactPromotionPolicy("WEAK_EVIDENCE", "governed_summary").promotable).toBe(false);
  });
});

// ─── 4. WEAK_EVIDENCE — permissive surfaces show with label ─────────────────

describe("getFactPromotionPolicy — WEAK_EVIDENCE permissive surfaces", () => {
  const permissive: PromotionSurface[] = [
    "display_facts",
    "llm_interpretation",
    "investor_insights",
    "data_tab",
  ];

  for (const surface of permissive) {
    it(`is promotable on ${surface} with 'limited evidence' label`, () => {
      const p = getFactPromotionPolicy("WEAK_EVIDENCE", surface);
      expect(p.promotable).toBe(true);
      expect(p.uncertainty_label).toBe("limited evidence");
    });
  }
});

// ─── 5. CONFLICTING — never a fact, always a signal ──────────────────────────

describe("getFactPromotionPolicy — CONFLICTING", () => {
  for (const surface of ALL_SURFACES) {
    it(`promotable=false on ${surface}`, () => {
      const p = getFactPromotionPolicy("CONFLICTING", surface);
      expect(p.promotable).toBe(false);
    });

    it(`show_as_conflict=true on ${surface}`, () => {
      const p = getFactPromotionPolicy("CONFLICTING", surface);
      expect(p.show_as_conflict).toBe(true);
    });

    it(`uncertainty_label='conflicting signals' on ${surface}`, () => {
      const p = getFactPromotionPolicy("CONFLICTING", surface);
      expect(p.uncertainty_label).toBe("conflicting signals");
    });
  }
});

// ─── 6. PROVISIONAL — data tab only ─────────────────────────────────────────

describe("getFactPromotionPolicy — PROVISIONAL", () => {
  it("promotable on data_tab only", () => {
    expect(getFactPromotionPolicy("PROVISIONAL", "data_tab").promotable).toBe(true);
  });

  it("has 'inferred' label on data_tab", () => {
    expect(getFactPromotionPolicy("PROVISIONAL", "data_tab").uncertainty_label).toBe("inferred");
  });

  const nonDataSurfaces: PromotionSurface[] = ALL_SURFACES.filter((s) => s !== "data_tab");
  for (const surface of nonDataSurfaces) {
    it(`blocked on ${surface}`, () => {
      expect(getFactPromotionPolicy("PROVISIONAL", surface).promotable).toBe(false);
    });
  }
});

// ─── 7. SUPPRESSED — never promotable ────────────────────────────────────────

describe("getFactPromotionPolicy — SUPPRESSED", () => {
  for (const surface of ALL_SURFACES) {
    it(`never promotable on ${surface}`, () => {
      expect(getFactPromotionPolicy("SUPPRESSED", surface).promotable).toBe(false);
      expect(getFactPromotionPolicy("SUPPRESSED", surface).uncertainty_label).toBeNull();
      expect(getFactPromotionPolicy("SUPPRESSED", surface).show_as_conflict).toBe(false);
    });
  }
});

// ─── 8. getUncertaintyLabel ───────────────────────────────────────────────────

describe("getUncertaintyLabel", () => {
  it("returns 'limited evidence' for WEAK_EVIDENCE", () => {
    expect(getUncertaintyLabel(EVIDENCE_CONFIDENCE_LEVEL.WEAK_EVIDENCE)).toBe("limited evidence");
  });

  it("returns 'conflicting signals' for CONFLICTING", () => {
    expect(getUncertaintyLabel(EVIDENCE_CONFIDENCE_LEVEL.CONFLICTING)).toBe("conflicting signals");
  });

  it("returns 'inferred' for PROVISIONAL", () => {
    expect(getUncertaintyLabel(EVIDENCE_CONFIDENCE_LEVEL.PROVISIONAL)).toBe("inferred");
  });

  it("returns null for VERIFIED", () => {
    expect(getUncertaintyLabel(EVIDENCE_CONFIDENCE_LEVEL.VERIFIED)).toBeNull();
  });

  it("returns null for STRONG_EVIDENCE", () => {
    expect(getUncertaintyLabel(EVIDENCE_CONFIDENCE_LEVEL.STRONG_EVIDENCE)).toBeNull();
  });

  it("returns null for SUPPRESSED", () => {
    expect(getUncertaintyLabel(EVIDENCE_CONFIDENCE_LEVEL.SUPPRESSED)).toBeNull();
  });
});

// ─── 9. isDefinitiveFact ─────────────────────────────────────────────────────

describe("isDefinitiveFact", () => {
  it("returns true for VERIFIED", () => {
    expect(isDefinitiveFact(EVIDENCE_CONFIDENCE_LEVEL.VERIFIED)).toBe(true);
  });

  it("returns true for STRONG_EVIDENCE", () => {
    expect(isDefinitiveFact(EVIDENCE_CONFIDENCE_LEVEL.STRONG_EVIDENCE)).toBe(true);
  });

  it("returns false for WEAK_EVIDENCE", () => {
    expect(isDefinitiveFact(EVIDENCE_CONFIDENCE_LEVEL.WEAK_EVIDENCE)).toBe(false);
  });

  it("returns false for CONFLICTING", () => {
    expect(isDefinitiveFact(EVIDENCE_CONFIDENCE_LEVEL.CONFLICTING)).toBe(false);
  });

  it("returns false for PROVISIONAL", () => {
    expect(isDefinitiveFact(EVIDENCE_CONFIDENCE_LEVEL.PROVISIONAL)).toBe(false);
  });

  it("returns false for SUPPRESSED", () => {
    expect(isDefinitiveFact(EVIDENCE_CONFIDENCE_LEVEL.SUPPRESSED)).toBe(false);
  });

  // isFactPromotable convenience wrapper
  it("isFactPromotable: CONFLICTING + investor_insights → false", () => {
    expect(isFactPromotable("CONFLICTING", "investor_insights")).toBe(false);
  });

  it("isFactPromotable: STRONG_EVIDENCE + deal_overview → true", () => {
    expect(isFactPromotable("STRONG_EVIDENCE", "deal_overview")).toBe(true);
  });

  it("isFactPromotable: WEAK_EVIDENCE + deal_overview → false", () => {
    expect(isFactPromotable("WEAK_EVIDENCE", "deal_overview")).toBe(false);
  });
});
