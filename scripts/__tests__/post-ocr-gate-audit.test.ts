import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  computeEffectiveCoverage,
  formatPct,
  coverageLabel,
  ocrDeltaLabel,
  evaluateEvidenceGate,
  hasGovernedSections,
  COVERAGE_THRESHOLD,
  MIN_EVIDENCE_COUNT,
} from "../diagnostics/post-ocr-gate-audit";

// ─── computeEffectiveCoverage ─────────────────────────────────────────────────

describe("computeEffectiveCoverage", () => {
  test("zero dpuPageCount returns 0", () => {
    assert.equal(computeEffectiveCoverage(10, 5, 0), 0);
  });

  test("no xlsx bonus: nonempty / total", () => {
    assert.equal(computeEffectiveCoverage(18, 0, 40), 0.45);
  });

  test("with xlsx bonus: (nonempty + bonus) / total", () => {
    assert.equal(computeEffectiveCoverage(18, 5, 40), 0.575);
  });

  test("full coverage returns 1", () => {
    assert.equal(computeEffectiveCoverage(40, 0, 40), 1);
  });

  test("over-full coverage capped by numerics (not clamped by this fn)", () => {
    // This function does not clamp; callers can clamp if needed.
    assert.equal(computeEffectiveCoverage(45, 0, 40), 1.125);
  });
});

// ─── formatPct ────────────────────────────────────────────────────────────────

describe("formatPct", () => {
  test("0 → '0.0%'", () => {
    assert.equal(formatPct(0), "0.0%");
  });

  test("0.55 → '55.0%'", () => {
    assert.equal(formatPct(0.55), "55.0%");
  });

  test("0.673 → '67.3%'", () => {
    assert.equal(formatPct(0.673), "67.3%");
  });

  test("1 → '100.0%'", () => {
    assert.equal(formatPct(1), "100.0%");
  });

  test("0.4512 rounds to 1 decimal '45.1%'", () => {
    assert.equal(formatPct(0.4512), "45.1%");
  });
});

// ─── coverageLabel ────────────────────────────────────────────────────────────

describe("coverageLabel", () => {
  test("passing coverage includes ✓", () => {
    const label = coverageLabel(0.67, COVERAGE_THRESHOLD);
    assert.ok(label.includes("✓"), `Expected ✓ in "${label}"`);
    assert.ok(label.includes("67.0%"), `Expected pct in "${label}"`);
  });

  test("failing coverage includes ✗", () => {
    const label = coverageLabel(0.42, COVERAGE_THRESHOLD);
    assert.ok(label.includes("✗"), `Expected ✗ in "${label}"`);
    assert.ok(label.includes("42.0%"), `Expected pct in "${label}"`);
  });

  test("exactly at threshold passes", () => {
    const label = coverageLabel(COVERAGE_THRESHOLD, COVERAGE_THRESHOLD);
    assert.ok(label.includes("✓"), `Expected ✓ at threshold in "${label}"`);
  });

  test("one below threshold fails", () => {
    const below = COVERAGE_THRESHOLD - 0.001;
    const label = coverageLabel(below, COVERAGE_THRESHOLD);
    assert.ok(label.includes("✗"), `Expected ✗ just below threshold in "${label}"`);
  });
});

// ─── ocrDeltaLabel ────────────────────────────────────────────────────────────

describe("ocrDeltaLabel", () => {
  test("both zero → 'none'", () => {
    assert.equal(ocrDeltaLabel(0, 0), "none");
  });

  test("only written pages", () => {
    const label = ocrDeltaLabel(5, 0);
    assert.ok(label.includes("5 written"), `Got "${label}"`);
    assert.ok(!label.includes("attempted"), `Got "${label}"`);
  });

  test("only attempted pages", () => {
    const label = ocrDeltaLabel(0, 3);
    assert.ok(label.includes("3 attempted-only"), `Got "${label}"`);
    assert.ok(!label.includes("written"), `Got "${label}"`);
  });

  test("both present", () => {
    const label = ocrDeltaLabel(7, 2);
    assert.ok(label.includes("7 written"), `Got "${label}"`);
    assert.ok(label.includes("2 attempted-only"), `Got "${label}"`);
  });
});

// ─── evaluateEvidenceGate ─────────────────────────────────────────────────────

describe("evaluateEvidenceGate", () => {
  test("passes when all thresholds met", () => {
    const r = evaluateEvidenceGate(1, 40, 25, 30);
    assert.equal(r.passed, true);
    assert.equal(r.blockingReason, null);
  });

  test("fails E0 when no docs", () => {
    const r = evaluateEvidenceGate(0, 40, 22, 30);
    assert.equal(r.passed, false);
    assert.equal(r.blockingReason, "EVIDENCE_GATE_NO_DOCUMENTS");
  });

  test("fails E1 when no DPU pages", () => {
    const r = evaluateEvidenceGate(1, 0, 0, 30);
    assert.equal(r.passed, false);
    assert.equal(r.blockingReason, "EVIDENCE_GATE_NO_PAGES");
  });

  test("fails E2 when coverage below threshold (45% < 55%)", () => {
    // 18 / 40 = 0.45 < 0.55
    const r = evaluateEvidenceGate(1, 40, 18, 30);
    assert.equal(r.passed, false);
    assert.equal(r.blockingReason, "EVIDENCE_GATE_LOW_COVERAGE");
  });

  test("passes E2 when OCR boost brings coverage to 57.5%", () => {
    // 18 nonempty + 5 xlsx_bonus = 23 / 40 = 0.575 > 0.55 — passes
    const r = evaluateEvidenceGate(1, 40, 23, 30);
    assert.equal(r.passed, true);
    assert.equal(r.blockingReason, null);
  });

  test("fails E3 when evidence count below threshold", () => {
    // coverage fine but evidence too low
    const r = evaluateEvidenceGate(1, 40, 25, MIN_EVIDENCE_COUNT - 1);
    assert.equal(r.passed, false);
    assert.equal(r.blockingReason, "EVIDENCE_GATE_LOW_EVIDENCE");
  });

  test("E0 blocks before E2 (short-circuit order)", () => {
    // docsCount = 0 should produce E0 reason even when coverage data is fine
    const r = evaluateEvidenceGate(0, 40, 30, 50);
    assert.equal(r.blockingReason, "EVIDENCE_GATE_NO_DOCUMENTS");
  });
});

// ─── hasGovernedSections ─────────────────────────────────────────────────────

describe("hasGovernedSections", () => {
  test("returns false for null inputs", () => {
    assert.equal(hasGovernedSections(null, null), false);
  });

  test("returns false when sections empty", () => {
    assert.equal(hasGovernedSections({ sections: [] }, null), false);
  });

  test("detects governed_summary_v1 in render_package sections", () => {
    const rp = {
      sections: [{ key: "analysis_status" }, { key: "governed_summary_v1" }],
    };
    assert.equal(hasGovernedSections(rp, null), true);
  });

  test("detects governed_executive_summary_v1 in render_package sections", () => {
    const rp = {
      sections: [{ key: "governed_executive_summary_v1" }],
    };
    assert.equal(hasGovernedSections(rp, null), true);
  });

  test("detects governed_summary_v1 in report_payload keys", () => {
    const payload = { governed_summary_v1: { fingerprint: "abc" } };
    assert.equal(hasGovernedSections(null, payload), true);
  });

  test("returns false when only non-governed sections present", () => {
    const rp = {
      sections: [
        { key: "analysis_status" },
        { key: "canonical_fields" },
        { key: "insight_slots" },
      ],
    };
    assert.equal(hasGovernedSections(rp, null), false);
  });

  test("non-array sections field is ignored gracefully", () => {
    const rp = { sections: "not-an-array" };
    assert.equal(hasGovernedSections(rp, null), false);
  });
});
