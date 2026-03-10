/**
 * financial-coverage-conflicts-pipeline.test.ts
 *
 * Unit tests for Phase 9 — Financial Coverage + Conflict Intelligence.
 *
 * Coverage:
 *  1.  computeFinancialCoveragePct — null coverage → 0
 *  2.  computeFinancialCoveragePct — all 17 tracked metrics → 100
 *  3.  computeFinancialCoveragePct — 2 of 17 tracked metrics → correct %
 *  4.  detectFinancialFactConflictsV1 — no facts → []
 *  5.  detectFinancialFactConflictsV1 — diverging revenue facts → 1 conflict
 *  6.  detectFinancialFactConflictsV1 — < 5% divergence → no conflict
 *  7.  deriveFinancialRiskFlags — coverage < 30% → ["low_coverage"]
 *  8.  deriveFinancialRiskFlags — revenue conflict → includes "revenue_conflict"
 *  9.  deriveFinancialRiskFlags — 3+ conflicts → includes "high_conflict_count"
 * 10.  deriveFinancialRiskFlags — burn_rate present, runway_months missing → "burn_without_runway"
 * 11.  buildFinancialCoverageV1 — empty facts → empty profile, 0 total_facts
 * 12.  buildFinancialCoverageV1 — income-statement facts → statements.income_statement = true
 * 13.  buildFinancialCoverageV1 — cash facts → statements.cash_flow = true
 * 14.  ALL_TRACKED_METRICS — exports exactly 17 metrics
 * 15.  Pipeline integration — empty facts → coverage_pct 0, conflicts []
 */

import { describe, it, expect } from "vitest";

import {
	buildFinancialCoverageV1,
} from "../lib/financial-facts/build-financial-coverage-v1";
import { detectFinancialFactConflictsV1 } from "@dealdecision/core";
import {
	computeFinancialCoveragePct,
	deriveFinancialRiskFlags,
	ALL_TRACKED_METRICS,
} from "../lib/financial-facts/financial-coverage-signals-v1";
import type { FinancialFactV1 } from "@dealdecision/core";

// ─── Fixture helpers ──────────────────────────────────────────────────────────

const DEAL_ID = "deal-0000-0000-0000";

function makeFact(
	metric_key: string,
	value: number,
	overrides: Partial<FinancialFactV1> = {},
): FinancialFactV1 {
	return {
		fact_id:      `factv1:${DEAL_ID}:${metric_key}:unknown:current:deadbeef`,
		deal_id:      DEAL_ID,
		source_kind:  "pitch_deck",
		metric_key,
		period_type:  "unknown",
		period_label: "current",
		value,
		unit:         "currency",
		confidence:   "high",
		...overrides,
	} as FinancialFactV1;
}

// All 17 tracked metrics with distinct values
const ALL_TRACKED_FACTS: FinancialFactV1[] = ALL_TRACKED_METRICS.map((mk, i) =>
	makeFact(mk, (i + 1) * 100_000),
);

// ─── computeFinancialCoveragePct ──────────────────────────────────────────────

describe("computeFinancialCoveragePct", () => {
	it("1. returns 0 when coverage is null", () => {
		expect(computeFinancialCoveragePct(null)).toBe(0);
	});

	it("2. returns 0 when coverage is undefined", () => {
		expect(computeFinancialCoveragePct(undefined)).toBe(0);
	});

	it("3. returns 100 when all 17 tracked metrics are present", () => {
		const coverage = buildFinancialCoverageV1(DEAL_ID, ALL_TRACKED_FACTS);
		expect(computeFinancialCoveragePct(coverage)).toBe(100);
	});

	it("4. returns correct % when 2 of 17 tracked metrics are present", () => {
		const facts = [makeFact("revenue", 1_000_000), makeFact("arr", 800_000)];
		const coverage = buildFinancialCoverageV1(DEAL_ID, facts);
		// 2 / 17 ≈ 11.76% → rounds to 12
		expect(computeFinancialCoveragePct(coverage)).toBe(Math.round((2 / 17) * 100));
	});
});

// ─── detectFinancialFactConflictsV1 ──────────────────────────────────────────

describe("detectFinancialFactConflictsV1", () => {
	it("5. returns [] when given no facts", () => {
		expect(detectFinancialFactConflictsV1([])).toEqual([]);
	});

	it("6. detects a conflict when two revenue facts diverge > 5%", () => {
		const facts = [
			makeFact("revenue", 1_000_000, { fact_id: "f1", source_kind: "deck" }),
			makeFact("revenue", 1_200_000, { fact_id: "f2", source_kind: "xlsx" }),
		];
		const conflicts = detectFinancialFactConflictsV1(facts);
		expect(conflicts).toHaveLength(1);
		expect(conflicts[0].metric_key).toBe("revenue");
	});

	it("7. does NOT flag a conflict when divergence is < 5%", () => {
		// 1_000_000 vs 1_040_000 → 4% divergence
		const facts = [
		makeFact("revenue", 1_000_000, { fact_id: "f1", source_kind: "deck" }),
		makeFact("revenue", 1_040_000, { fact_id: "f2", source_kind: "xlsx" }),
		];
		const conflicts = detectFinancialFactConflictsV1(facts);
		expect(conflicts).toHaveLength(0);
	});
});

// ─── deriveFinancialRiskFlags ─────────────────────────────────────────────────

describe("deriveFinancialRiskFlags", () => {
	it("8. returns ['low_coverage'] when coverage is < 30%", () => {
		// 2 / 17 = ~12% — well below 30
		const facts = [makeFact("revenue", 1_000_000), makeFact("arr", 800_000)];
		const coverage = buildFinancialCoverageV1(DEAL_ID, facts);
		const flags = deriveFinancialRiskFlags(coverage, []);
		expect(flags).toContain("low_coverage");
	});

	it("9. returns [] when coverage >= 30% and no conflicts", () => {
		// All 17 tracked → 100% coverage, no conflicts
		const coverage = buildFinancialCoverageV1(DEAL_ID, ALL_TRACKED_FACTS);
		const flags = deriveFinancialRiskFlags(coverage, []);
		expect(flags).toEqual([]);
	});

	it("10. includes 'revenue_conflict' when a revenue conflict exists", () => {
		const coverage = buildFinancialCoverageV1(DEAL_ID, ALL_TRACKED_FACTS);
		const conflicts = [
			{
				metric_key:    "revenue",
				period_label:  "current",
				fact_ids:      ["f1", "f2"],
				values:        [1_000_000, 1_200_000],
				divergence_pct: 0.2,
				source_kinds:  ["pitch_deck", "financial_model"],
			},
		];
		const flags = deriveFinancialRiskFlags(coverage, conflicts);
		expect(flags).toContain("revenue_conflict");
		expect(flags).not.toContain("low_coverage");
	});

	it("11. includes 'high_conflict_count' when 3 or more conflicts", () => {
		const coverage = buildFinancialCoverageV1(DEAL_ID, ALL_TRACKED_FACTS);
		const conflicts = [
			{ metric_key: "revenue",   period_label: "current", fact_ids: [], values: [1, 2], divergence_pct: 0.2, source_kinds: [] },
			{ metric_key: "arr",       period_label: "current", fact_ids: [], values: [1, 2], divergence_pct: 0.2, source_kinds: [] },
			{ metric_key: "burn_rate", period_label: "current", fact_ids: [], values: [1, 2], divergence_pct: 0.2, source_kinds: [] },
		];
		const flags = deriveFinancialRiskFlags(coverage, conflicts);
		expect(flags).toContain("high_conflict_count");
	});

	it("12. includes 'burn_without_runway' when burn_rate present but runway_months missing", () => {
		// 4 facts: includes burn_rate but not runway_months
		const facts = [
			makeFact("revenue",   1_000_000),
			makeFact("arr",         800_000),
			makeFact("burn_rate",    50_000),
			makeFact("cash",        300_000),
		];
		const coverage = buildFinancialCoverageV1(DEAL_ID, facts);
		const flags = deriveFinancialRiskFlags(coverage, []);
		expect(flags).toContain("burn_without_runway");
	});

	it("13. returns null-safe response when coverage is null", () => {
		expect(() => deriveFinancialRiskFlags(null, null)).not.toThrow();
		const flags = deriveFinancialRiskFlags(null, null);
		// null → 0% coverage → low_coverage
		expect(flags).toContain("low_coverage");
	});
});

// ─── buildFinancialCoverageV1 ─────────────────────────────────────────────────

describe("buildFinancialCoverageV1", () => {
	it("14. empty facts → empty profile with total_facts = 0", () => {
		const coverage = buildFinancialCoverageV1(DEAL_ID, []);
		expect(coverage.total_facts).toBe(0);
		expect(coverage.metrics_present).toEqual([]);
		expect(coverage.statements.income_statement).toBe(false);
	});

	it("15. income-statement facts → statements.income_statement = true", () => {
		const facts = [makeFact("revenue", 1_000_000), makeFact("ebitda", 200_000)];
		const coverage = buildFinancialCoverageV1(DEAL_ID, facts);
		expect(coverage.statements.income_statement).toBe(true);
	});

	it("16. cash-flow facts → statements.cash_flow = true", () => {
		const facts = [makeFact("cash", 500_000), makeFact("burn_rate", 40_000)];
		const coverage = buildFinancialCoverageV1(DEAL_ID, facts);
		expect(coverage.statements.cash_flow).toBe(true);
	});
});

// ─── ALL_TRACKED_METRICS ──────────────────────────────────────────────────────

describe("ALL_TRACKED_METRICS", () => {
	it("17. exports exactly 17 canonical metrics", () => {
		expect(ALL_TRACKED_METRICS).toHaveLength(17);
	});

	it("18. contains revenue, arr, and runway_months", () => {
		const set = new Set(ALL_TRACKED_METRICS);
		expect(set.has("revenue")).toBe(true);
		expect(set.has("arr")).toBe(true);
		expect(set.has("runway_months")).toBe(true);
	});
});

// ─── Pipeline integration ─────────────────────────────────────────────────────

describe("pipeline integration", () => {
	it("19. empty facts → coverage_pct 0, no conflicts", () => {
		const coverage = buildFinancialCoverageV1(DEAL_ID, []);
		const conflicts = detectFinancialFactConflictsV1([]);
		const pct = computeFinancialCoveragePct(coverage);
		const flags = deriveFinancialRiskFlags(coverage, conflicts);
		expect(pct).toBe(0);
		expect(conflicts).toHaveLength(0);
		expect(flags).toContain("low_coverage");
	});

	it("20. full 17-metric facts → 100% coverage, no flags from coverage", () => {
		const coverage = buildFinancialCoverageV1(DEAL_ID, ALL_TRACKED_FACTS);
		const conflicts = detectFinancialFactConflictsV1(ALL_TRACKED_FACTS);
		const pct = computeFinancialCoveragePct(coverage);
		const flags = deriveFinancialRiskFlags(coverage, conflicts);
		expect(pct).toBe(100);
		expect(flags).not.toContain("low_coverage");
		expect(flags).not.toContain("high_conflict_count");
	});
});
