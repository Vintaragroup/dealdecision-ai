/**
 * coverage-trend-gate.test.ts
 *
 * Unit tests for the coverage trend gate helpers.
 * No file I/O, no process.exit — all logic tested in isolation.
 */

import { describe, it, expect } from "vitest";

import {
	parseArgs,
	totalGap,
	slotGap,
	allSlotNames,
	topRegressingDeals,
	type CoverageReport,
	type DealResult,
} from "../coverage-trend-gate";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeReport(
	slots: Array<{ slot: string; detector_gap: number }>,
	deals: DealResult[] = []
): CoverageReport {
	return {
		generated_at: "2026-01-01T00:00:00.000Z",
		portfolio_summary: {
			slot_breakdown: slots.map((s) => ({
				slot: s.slot,
				ok_match: 0,
				stale_stored: 0,
				regressed: 0,
				detector_gap: s.detector_gap,
				true_absence: 0,
			})),
		},
		deals,
	};
}

function makeDeal(
	id: string,
	label: string,
	gapSlots: string[],
	okSlots: string[] = []
): DealResult {
	return {
		deal_id: id,
		deal_label: label,
		slot_results: [
			...gapSlots.map((slot) => ({
				slot,
				classification: "DETECTOR_GAP",
				candidate_pages: [],
			})),
			...okSlots.map((slot) => ({
				slot,
				classification: "OK_MATCH",
				candidate_pages: [],
			})),
		],
	};
}

// ═══════════════════════════════════════════════════════════════════════
// parseArgs
// ═══════════════════════════════════════════════════════════════════════

describe("parseArgs", () => {
	it("parses --baseline and --current", () => {
		const result = parseArgs(["node", "script.ts", "--baseline", "base.json", "--current", "cur.json"]);
		expect(result.baselinePath).toBe("base.json");
		expect(result.currentPath).toBe("cur.json");
		expect(result.slots).toHaveLength(0);
	});

	it("accumulates multiple --slot values into array", () => {
		const result = parseArgs([
			"node", "script.ts",
			"--baseline", "base.json",
			"--current",  "cur.json",
			"--slot", "use_of_funds",
			"--slot", "market_claims",
		]);
		expect(result.slots).toEqual(["use_of_funds", "market_claims"]);
	});

	it("single --slot is stored in array", () => {
		const result = parseArgs(["node", "script.ts", "--baseline", "b.json", "--current", "c.json", "--slot", "raise_terms"]);
		expect(result.slots).toEqual(["raise_terms"]);
	});

	it("returns empty slots array when --slot is omitted", () => {
		const result = parseArgs(["node", "script.ts", "--baseline", "b.json", "--current", "c.json"]);
		expect(result.slots).toEqual([]);
	});

	it("returns null for missing --baseline and --current", () => {
		const result = parseArgs(["node", "script.ts"]);
		expect(result.baselinePath).toBeNull();
		expect(result.currentPath).toBeNull();
	});

	it("ignores -- separator", () => {
		const result = parseArgs(["node", "script.ts", "--", "--baseline", "b.json", "--current", "c.json"]);
		expect(result.baselinePath).toBe("b.json");
	});
});

// ═══════════════════════════════════════════════════════════════════════
// totalGap
// ═══════════════════════════════════════════════════════════════════════

describe("totalGap", () => {
	it("sums all slot detector_gap values", () => {
		const report = makeReport([
			{ slot: "use_of_funds", detector_gap: 3 },
			{ slot: "market_claims", detector_gap: 2 },
			{ slot: "raise_terms", detector_gap: 0 },
		]);
		expect(totalGap(report)).toBe(5);
	});

	it("returns 0 for empty breakdown", () => {
		const report = makeReport([]);
		expect(totalGap(report)).toBe(0);
	});

	it("returns 0 when all slots have gap=0", () => {
		const report = makeReport([
			{ slot: "use_of_funds", detector_gap: 0 },
			{ slot: "market_claims", detector_gap: 0 },
		]);
		expect(totalGap(report)).toBe(0);
	});
});

// ═══════════════════════════════════════════════════════════════════════
// slotGap
// ═══════════════════════════════════════════════════════════════════════

describe("slotGap", () => {
	it("returns detector_gap for named slot", () => {
		const report = makeReport([
			{ slot: "use_of_funds", detector_gap: 6 },
			{ slot: "market_claims", detector_gap: 4 },
		]);
		expect(slotGap(report, "market_claims")).toBe(4);
	});

	it("returns 0 when slot not present in breakdown", () => {
		const report = makeReport([{ slot: "use_of_funds", detector_gap: 5 }]);
		expect(slotGap(report, "raise_terms")).toBe(0);
	});
});

// ═══════════════════════════════════════════════════════════════════════
// allSlotNames
// ═══════════════════════════════════════════════════════════════════════

describe("allSlotNames", () => {
	it("returns union of slots from both reports", () => {
		const baseline = makeReport([
			{ slot: "use_of_funds", detector_gap: 3 },
			{ slot: "market_claims", detector_gap: 2 },
		]);
		const current = makeReport([
			{ slot: "use_of_funds", detector_gap: 3 },
			{ slot: "traction_signal", detector_gap: 1 },
		]);
		const names = allSlotNames(baseline, current);
		expect(names).toContain("use_of_funds");
		expect(names).toContain("market_claims");
		expect(names).toContain("traction_signal");
		expect(names).toHaveLength(3);
	});

	it("returns sorted slot names", () => {
		const baseline = makeReport([
			{ slot: "use_of_funds", detector_gap: 1 },
			{ slot: "market_claims", detector_gap: 1 },
		]);
		const current = makeReport([
			{ slot: "raise_terms", detector_gap: 1 },
		]);
		const names = allSlotNames(baseline, current);
		expect(names).toEqual([...names].sort());
	});

	it("deduplicates slots present in both reports", () => {
		const base = makeReport([{ slot: "use_of_funds", detector_gap: 3 }]);
		const cur  = makeReport([{ slot: "use_of_funds", detector_gap: 5 }]);
		expect(allSlotNames(base, cur)).toEqual(["use_of_funds"]);
	});

	it("returns empty array for two empty reports", () => {
		expect(allSlotNames(makeReport([]), makeReport([]))).toEqual([]);
	});
});

// ═══════════════════════════════════════════════════════════════════════
// topRegressingDeals
// ═══════════════════════════════════════════════════════════════════════

describe("topRegressingDeals", () => {
	it("returns empty array when no deals have regressions", () => {
		// Both baseline and current have same DETECTOR_GAP patterns
		const deal = makeDeal("deal-a", "DealA", ["use_of_funds"]);
		const base = makeReport([{ slot: "use_of_funds", detector_gap: 1 }], [deal]);
		const cur  = makeReport([{ slot: "use_of_funds", detector_gap: 1 }], [deal]);
		expect(topRegressingDeals(base, cur)).toHaveLength(0);
	});

	it("identifies a deal that newly gained a DETECTOR_GAP slot", () => {
		// Baseline: DealA has OK_MATCH for use_of_funds
		const baseDeal = makeDeal("deal-a", "DealA", [], ["use_of_funds"]);
		// Current:  DealA has DETECTOR_GAP for use_of_funds (regression)
		const curDeal  = makeDeal("deal-a", "DealA", ["use_of_funds"]);

		const base = makeReport([{ slot: "use_of_funds", detector_gap: 0 }], [baseDeal]);
		const cur  = makeReport([{ slot: "use_of_funds", detector_gap: 1 }], [curDeal]);

		const result = topRegressingDeals(base, cur);
		expect(result).toHaveLength(1);
		expect(result[0]!.label).toBe("DealA");
		expect(result[0]!.regressions).toBe(1);
		expect(result[0]!.slots).toContain("use_of_funds");
	});

	it("counts all regressed slots for a deal", () => {
		// Baseline: DealB has OK_MATCH for both slots
		const baseDeal = makeDeal("deal-b", "DealB", [], ["use_of_funds", "market_claims"]);
		// Current:  DealB has DETECTOR_GAP for both (2 regressions)
		const curDeal  = makeDeal("deal-b", "DealB", ["use_of_funds", "market_claims"]);

		const base = makeReport([
			{ slot: "use_of_funds",  detector_gap: 0 },
			{ slot: "market_claims", detector_gap: 0 },
		], [baseDeal]);
		const cur = makeReport([
			{ slot: "use_of_funds",  detector_gap: 2 },
			{ slot: "market_claims", detector_gap: 2 },
		], [curDeal]);

		const result = topRegressingDeals(base, cur);
		expect(result[0]!.regressions).toBe(2);
	});

	it("sorts results descending by regression count", () => {
		// DealA: 1 regression; DealB: 2 regressions → DealB first
		const baseDealA = makeDeal("deal-a", "DealA", [],   ["use_of_funds"]);
		const baseDealB = makeDeal("deal-b", "DealB", [],   ["use_of_funds", "market_claims"]);
		const curDealA  = makeDeal("deal-a", "DealA", ["use_of_funds"]);
		const curDealB  = makeDeal("deal-b", "DealB", ["use_of_funds", "market_claims"]);

		const base = makeReport([
			{ slot: "use_of_funds",  detector_gap: 0 },
			{ slot: "market_claims", detector_gap: 0 },
		], [baseDealA, baseDealB]);
		const cur = makeReport([
			{ slot: "use_of_funds",  detector_gap: 3 },
			{ slot: "market_claims", detector_gap: 2 },
		], [curDealA, curDealB]);

		const result = topRegressingDeals(base, cur);
		expect(result[0]!.label).toBe("DealB");
		expect(result[1]!.label).toBe("DealA");
	});

	it("respects the limit parameter", () => {
		const n = 5;
		const baseDealsFn = () =>
			Array.from({ length: n }, (_, i) =>
				makeDeal(`deal-${i}`, `Deal${i}`, [], ["use_of_funds"])
			);
		const curDealsFn = () =>
			Array.from({ length: n }, (_, i) =>
				makeDeal(`deal-${i}`, `Deal${i}`, ["use_of_funds"])
			);
		const base = makeReport([{ slot: "use_of_funds", detector_gap: 0 }], baseDealsFn());
		const cur  = makeReport([{ slot: "use_of_funds", detector_gap: n }], curDealsFn());

		const result = topRegressingDeals(base, cur, 2);
		expect(result).toHaveLength(2);
	});

	it("treats a deal absent from baseline as a new regression for all its DETECTOR_GAP slots", () => {
		// Deal was not in baseline at all (brand-new deal) → all its gaps are "new"
		const curDeal = makeDeal("brand-new", "NewDeal", ["use_of_funds", "raise_terms"]);
		const base = makeReport([{ slot: "use_of_funds", detector_gap: 0 }], []);
		const cur  = makeReport([
			{ slot: "use_of_funds", detector_gap: 2 },
			{ slot: "raise_terms",  detector_gap: 2 },
		], [curDeal]);

		const result = topRegressingDeals(base, cur);
		expect(result).toHaveLength(1);
		expect(result[0]!.label).toBe("NewDeal");
		expect(result[0]!.regressions).toBe(2);
	});
});
