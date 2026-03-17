/**
 * Unit tests for computeEvidenceGateV1 — pure function, no DB, no side effects.
 */
import { describe, it, expect } from "vitest";
import {
	computeEvidenceGateV1,
	EVIDENCE_GATE_COVERAGE_THRESHOLD,
	EVIDENCE_GATE_MIN_EVIDENCE_COUNT,
} from "../evidence-gate-v1";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a passing fixture (high coverage, many evidence items). */
function passingInput() {
	return {
		docs_count: 2,
		expected_pages_total: 30,
		dpu_nonempty_pages: 24, // 80 %
		evidence_count: 42,
	};
}

// ─── Constants ────────────────────────────────────────────────────────────────

describe("Evidence gate constants", () => {
	it("EVIDENCE_GATE_COVERAGE_THRESHOLD is 0.30", () => {
		expect(EVIDENCE_GATE_COVERAGE_THRESHOLD).toBe(0.30);
	});

	it("EVIDENCE_GATE_MIN_EVIDENCE_COUNT is 10", () => {
		expect(EVIDENCE_GATE_MIN_EVIDENCE_COUNT).toBe(10);
	});
});

// ─── Happy-path ───────────────────────────────────────────────────────────────

describe("computeEvidenceGateV1 — passing cases", () => {
	it("passes when coverage=0.60, evidence=30", () => {
		const result = computeEvidenceGateV1({
			docs_count: 1,
			expected_pages_total: 20,
			dpu_nonempty_pages: 12, // 0.60
			evidence_count: 30,
		});
		expect(result.passed).toBe(true);
		expect(result.blocking_reason).toBeNull();
		expect(result.results.every((r) => r.passed)).toBe(true);
	});

	it("reports correct coverage_pct in metrics", () => {
		const result = computeEvidenceGateV1({
			docs_count: 1,
			expected_pages_total: 20,
			dpu_nonempty_pages: 12,
			evidence_count: 30,
		});
		expect(result.metrics.coverage_pct).toBeCloseTo(0.6, 6);
	});

	it("passes at the revised boundary values (coverage=0.30, evidence=10)", () => {
		const result = computeEvidenceGateV1({
			docs_count: 1,
			expected_pages_total: 20,
			dpu_nonempty_pages: 6,   // 6/20 = 0.30 exactly
			evidence_count: 10,      // exactly at threshold
		});
		expect(result.passed).toBe(true);
		expect(result.blocking_reason).toBeNull();
	});

	it("includes E0–E3 result entries and omits E4 when hard_missing not provided", () => {
		const result = computeEvidenceGateV1(passingInput());
		const gates = result.results.map((r) => r.gate);
		expect(gates).toEqual(["E0", "E1", "E2", "E3"]);
	});

	it("includes E4 when hard_missing_pages_total is 0 and all gates pass", () => {
		const result = computeEvidenceGateV1({
			...passingInput(),
			hard_missing_pages_total: 0,
		});
		const gates = result.results.map((r) => r.gate);
		expect(gates).toContain("E4");
		const e4 = result.results.find((r) => r.gate === "E4")!;
		expect(e4.passed).toBe(true);
		expect(result.passed).toBe(true);
	});
});

// ─── Failure — low coverage ───────────────────────────────────────────────────

describe("computeEvidenceGateV1 — E2 failure (low coverage)", () => {
	it("fails when coverage=0.15 (clearly below 0.30 threshold)", () => {
		const result = computeEvidenceGateV1({
			docs_count: 1,
			expected_pages_total: 20,
			dpu_nonempty_pages: 3, // 3/20 = 0.15
			evidence_count: 30,
		});
		expect(result.passed).toBe(false);
		expect(result.blocking_reason).toBe("EVIDENCE_GATE_LOW_COVERAGE");
	});

	it("E2 reports correct actual and threshold", () => {
		const result = computeEvidenceGateV1({
			docs_count: 1,
			expected_pages_total: 20,
			dpu_nonempty_pages: 3, // 0.15
			evidence_count: 30,
		});
		const e2 = result.results.find((r) => r.gate === "E2")!;
		expect(e2.passed).toBe(false);
		expect(e2.actual).toBeCloseTo(0.15, 6);
		expect(e2.threshold).toBe(EVIDENCE_GATE_COVERAGE_THRESHOLD);
	});

	it("fails just below coverage boundary (0.2999…)", () => {
		const result = computeEvidenceGateV1({
			docs_count: 1,
			expected_pages_total: 100,
			dpu_nonempty_pages: 29, // 0.29
			evidence_count: 30,
		});
		expect(result.passed).toBe(false);
		const e2 = result.results.find((r) => r.gate === "E2")!;
		expect(e2.passed).toBe(false);
	});
});

// ─── Failure — low evidence ───────────────────────────────────────────────────

describe("computeEvidenceGateV1 — E3 failure (low evidence)", () => {
	it("fails when evidence=5 (clearly below 10 threshold)", () => {
		const result = computeEvidenceGateV1({
			docs_count: 1,
			expected_pages_total: 20,
			dpu_nonempty_pages: 14, // 0.70
			evidence_count: 5,
		});
		expect(result.passed).toBe(false);
		expect(result.blocking_reason).toBe("EVIDENCE_GATE_LOW_EVIDENCE");
	});

	it("E3 reports correct reason_code and threshold", () => {
		const result = computeEvidenceGateV1({
			docs_count: 1,
			expected_pages_total: 20,
			dpu_nonempty_pages: 14,
			evidence_count: 5,
		});
		const e3 = result.results.find((r) => r.gate === "E3")!;
		expect(e3.reason_code).toBe("EVIDENCE_GATE_LOW_EVIDENCE");
		expect(e3.threshold).toBe(EVIDENCE_GATE_MIN_EVIDENCE_COUNT);
		expect(e3.actual).toBe(5);
	});

	it("fails at evidence=9 (one below revised threshold of 10)", () => {
		const result = computeEvidenceGateV1({
			docs_count: 1,
			expected_pages_total: 20,
			dpu_nonempty_pages: 14,
			evidence_count: 9,
		});
		expect(result.passed).toBe(false);
		const e3 = result.results.find((r) => r.gate === "E3")!;
		expect(e3.passed).toBe(false);
	});
});

// ─── Failure — no documents / pages ──────────────────────────────────────────

describe("computeEvidenceGateV1 — E0/E1 failures", () => {
	it("fails E0 when docs_count=0", () => {
		const result = computeEvidenceGateV1({
			docs_count: 0,
			expected_pages_total: 10,
			dpu_nonempty_pages: 8,
			evidence_count: 30,
		});
		expect(result.passed).toBe(false);
		const e0 = result.results.find((r) => r.gate === "E0")!;
		expect(e0.passed).toBe(false);
		expect(e0.reason_code).toBe("EVIDENCE_GATE_NO_DOCUMENTS");
	});

	it("fails E1 when expected_pages_total=0 and does not NaN-crash E2", () => {
		const result = computeEvidenceGateV1({
			docs_count: 1,
			expected_pages_total: 0,
			dpu_nonempty_pages: 0,
			evidence_count: 30,
		});
		expect(result.passed).toBe(false);
		// E1 fails
		const e1 = result.results.find((r) => r.gate === "E1")!;
		expect(e1.passed).toBe(false);
		expect(e1.reason_code).toBe("EVIDENCE_GATE_NO_PAGES");
		// E2 also fails but must NOT produce NaN
		const e2 = result.results.find((r) => r.gate === "E2")!;
		expect(Number.isNaN(e2.actual)).toBe(false);
		expect(result.metrics.coverage_pct).toBe(0);
	});
});

// ─── Blocking reason ─────────────────────────────────────────────────────────

describe("computeEvidenceGateV1 — blocking_reason derivation", () => {
	it("blocking_reason is the first failing gate's reason_code", () => {
		// Both E2 and E3 fail; blocking_reason should be E2's code (first in order)
		const result = computeEvidenceGateV1({
			docs_count: 1,
			expected_pages_total: 20,
			dpu_nonempty_pages: 5, // E2 fails (0.25)
			evidence_count: 5,     // E3 fails too
		});
		expect(result.blocking_reason).toBe("EVIDENCE_GATE_LOW_COVERAGE");
	});

	it("blocking_reason is null when all gates pass", () => {
		const result = computeEvidenceGateV1(passingInput());
		expect(result.blocking_reason).toBeNull();
	});
});

// ─── Optional E4 gate ────────────────────────────────────────────────────────

describe("computeEvidenceGateV1 — E4 (hard_missing_pages_total)", () => {
	it("omits E4 when hard_missing_pages_total is undefined", () => {
		const result = computeEvidenceGateV1(passingInput());
		expect(result.results.find((r) => r.gate === "E4")).toBeUndefined();
	});

	it("omits E4 when hard_missing_pages_total is null", () => {
		const result = computeEvidenceGateV1({ ...passingInput(), hard_missing_pages_total: null });
		expect(result.results.find((r) => r.gate === "E4")).toBeUndefined();
	});

	it("includes E4 and fails when hard_missing_pages_total > 0", () => {
		const result = computeEvidenceGateV1({
			...passingInput(),
			hard_missing_pages_total: 3,
		});
		const e4 = result.results.find((r) => r.gate === "E4")!;
		expect(e4).toBeDefined();
		expect(e4.passed).toBe(false);
		expect(e4.reason_code).toBe("EVIDENCE_GATE_HARD_MISSING_PAGES");
		expect(e4.actual).toBe(3);
		expect(result.passed).toBe(false);
	});
});

// ─── Metrics always populated ─────────────────────────────────────────────────

describe("computeEvidenceGateV1 — metrics shape", () => {
	it("always returns a complete metrics object", () => {
		const result = computeEvidenceGateV1(passingInput());
		expect(result.metrics).toMatchObject({
			docs_count: expect.any(Number),
			expected_pages_total: expect.any(Number),
			coverage_pct: expect.any(Number),
			evidence_count: expect.any(Number),
			hard_missing_pages_total: null,
		});
	});

	it("metrics.hard_missing_pages_total reflects provided value", () => {
		const result = computeEvidenceGateV1({
			...passingInput(),
			hard_missing_pages_total: 2,
		});
		expect(result.metrics.hard_missing_pages_total).toBe(2);
	});
});

// ─── Regression: single pitch-deck workflows (benchmark cohort shapes) ────────
//
// These tests encode the specific deck shapes that were over-blocked by the
// original thresholds (E2=0.55, E3=25). All inputs below come from real
// benchmark deal DPU row counts and typical evidence extraction yields.

describe("computeEvidenceGateV1 — single pitch-deck regression (benchmark cohort)", () => {
	it("Cinco-like (17 pages, 40% coverage, 12 evidence items) now passes", () => {
		// Before fix: E2 failed (0.40 < 0.55) and E3 failed (12 < 25)
		// After fix:  E2 passes (0.40 >= 0.30) and E3 passes (12 >= 10)
		const result = computeEvidenceGateV1({
			docs_count: 1,
			expected_pages_total: 17,
			dpu_nonempty_pages: 7,  // 7/17 ≈ 0.41
			evidence_count: 12,
		});
		expect(result.passed).toBe(true);
		expect(result.blocking_reason).toBeNull();
	});

	it("Qredible-like (23 pages, 45% coverage, 15 evidence items) now passes", () => {
		const result = computeEvidenceGateV1({
			docs_count: 1,
			expected_pages_total: 23,
			dpu_nonempty_pages: 10, // 10/23 ≈ 0.43
			evidence_count: 15,
		});
		expect(result.passed).toBe(true);
		expect(result.blocking_reason).toBeNull();
	});

	it("Palm-like (31 pages, 50% coverage, 18 evidence items) now passes", () => {
		const result = computeEvidenceGateV1({
			docs_count: 1,
			expected_pages_total: 31,
			dpu_nonempty_pages: 15, // 15/31 ≈ 0.48
			evidence_count: 18,
		});
		expect(result.passed).toBe(true);
		expect(result.blocking_reason).toBeNull();
	});

	it("truly sparse deal (3 pages, 0 evidence) still fails", () => {
		// Below both E2 (0/3 = 0%) and E3 (0 items) thresholds
		const result = computeEvidenceGateV1({
			docs_count: 1,
			expected_pages_total: 3,
			dpu_nonempty_pages: 0,
			evidence_count: 0,
		});
		expect(result.passed).toBe(false);
	});

	it("hard-fail case — no docs — still fails irrespective of threshold changes", () => {
		const result = computeEvidenceGateV1({
			docs_count: 0,
			expected_pages_total: 20,
			dpu_nonempty_pages: 15,
			evidence_count: 20,
		});
		expect(result.passed).toBe(false);
		expect(result.blocking_reason).toBe("EVIDENCE_GATE_NO_DOCUMENTS");
	});
});
