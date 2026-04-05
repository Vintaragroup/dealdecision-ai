/**
 * workbook-fact-dedup.test.ts
 *
 * Fix 17 — OB-3: Regression tests for deduplicateWorkbookFacts.
 *
 * Root cause: promoteToFinancialFactV1 includes value_raw in the fact_id hash,
 * so "Sales 1" ($8K) and "Sales 4" ($0) for the same period produce distinct
 * fact_ids and both accumulate in the DB.
 *
 * Fix: deduplicateWorkbookFacts collapses same-(metric_key, period_label,
 * source_kind) groups to a single winner before upserting.
 *
 * Resolution order:
 *  1. Non-zero value beats zero value.
 *  2. Higher absolute value wins.
 *  3. Lexicographically smallest fact_id (deterministic).
 */

import { describe, it, expect } from "vitest";
import type { FinancialFactV1 } from "@dealdecision/core";
import { deduplicateWorkbookFacts } from "../stages/stage-2-deterministic.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeFact(
	overrides: Partial<FinancialFactV1> & {
		fact_id: string;
		metric_key: string;
		period_label: string;
		value: number;
	}
): FinancialFactV1 {
	return {
		deal_id: "test-deal",
		source_kind: "xlsx",
		period_type: "unknown",
		unit: "currency",
		currency: "USD",
		confidence: "high",
		reconciliation_status: "unknown",
		...overrides,
	} as FinancialFactV1;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("deduplicateWorkbookFacts — OB-3 regression", () => {
	it("non-zero beats zero for same metric+period+source_kind", () => {
		const facts = [
			makeFact({ fact_id: "fact-a", metric_key: "revenue", period_label: "September", value: 0 }),
			makeFact({ fact_id: "fact-b", metric_key: "revenue", period_label: "September", value: 8000 }),
		];
		const result = deduplicateWorkbookFacts(facts);
		expect(result).toHaveLength(1);
		expect(result[0]!.value).toBe(8000);
		expect(result[0]!.fact_id).toBe("fact-b");
	});

	it("non-zero (first) beats zero (second) regardless of order", () => {
		const facts = [
			makeFact({ fact_id: "fact-b", metric_key: "revenue", period_label: "September", value: 8000 }),
			makeFact({ fact_id: "fact-a", metric_key: "revenue", period_label: "September", value: 0 }),
		];
		const result = deduplicateWorkbookFacts(facts);
		expect(result).toHaveLength(1);
		expect(result[0]!.value).toBe(8000);
	});

	it("higher absolute value wins when both non-zero", () => {
		const facts = [
			makeFact({ fact_id: "fact-a", metric_key: "revenue", period_label: "September", value: 5000 }),
			makeFact({ fact_id: "fact-b", metric_key: "revenue", period_label: "September", value: 8000 }),
		];
		const result = deduplicateWorkbookFacts(facts);
		expect(result).toHaveLength(1);
		expect(result[0]!.value).toBe(8000);
	});

	it("deterministic tiebreaker: lexicographically smaller fact_id wins when values equal", () => {
		const facts = [
			makeFact({ fact_id: "fact-z", metric_key: "revenue", period_label: "September", value: 8000 }),
			makeFact({ fact_id: "fact-a", metric_key: "revenue", period_label: "September", value: 8000 }),
		];
		const result = deduplicateWorkbookFacts(facts);
		expect(result).toHaveLength(1);
		expect(result[0]!.fact_id).toBe("fact-a");
	});

	it("preserves distinct periods — does not deduplicate across periods", () => {
		const facts = [
			makeFact({ fact_id: "fact-a", metric_key: "revenue", period_label: "September", value: 8000 }),
			makeFact({ fact_id: "fact-b", metric_key: "revenue", period_label: "October", value: 8000 }),
		];
		const result = deduplicateWorkbookFacts(facts);
		expect(result).toHaveLength(2);
	});

	it("preserves distinct metric_keys — does not deduplicate across metrics", () => {
		const facts = [
			makeFact({ fact_id: "fact-a", metric_key: "revenue", period_label: "September", value: 8000 }),
			makeFact({ fact_id: "fact-b", metric_key: "burn_rate", period_label: "September", value: 8000 }),
		];
		const result = deduplicateWorkbookFacts(facts);
		expect(result).toHaveLength(2);
	});

	it("preserves distinct source_kinds — does not deduplicate xlsx vs deck", () => {
		const facts = [
			makeFact({ fact_id: "fact-a", metric_key: "revenue", period_label: "current", value: 0, source_kind: "xlsx" }),
			makeFact({ fact_id: "fact-b", metric_key: "revenue", period_label: "current", value: 8000, source_kind: "deck" }),
		];
		const result = deduplicateWorkbookFacts(facts);
		expect(result).toHaveLength(2);
	});

	it("handles the full WebMax pattern: all months with Sales 1 + Sales 4 pairs", () => {
		const months = ["January", "February", "March", "April", "May", "June",
		                "July", "August", "September", "October", "November", "December"];
		const facts: FinancialFactV1[] = [];
		for (const month of months) {
			// "Sales 1" row — non-zero
			facts.push(makeFact({ fact_id: `${month}-sales1`, metric_key: "revenue", period_label: month, value: 8000 }));
			// "Sales 4" row — zero
			facts.push(makeFact({ fact_id: `${month}-sales4`, metric_key: "revenue", period_label: month, value: 0 }));
		}
		const result = deduplicateWorkbookFacts(facts);
		expect(result).toHaveLength(months.length);
		for (const f of result) {
			expect(f.value).toBe(8000); // all zeros eliminated
		}
	});

	it("returns empty array for empty input", () => {
		expect(deduplicateWorkbookFacts([])).toEqual([]);
	});

	it("preserves single fact unchanged", () => {
		const fact = makeFact({ fact_id: "fact-a", metric_key: "revenue", period_label: "September", value: 8000 });
		const result = deduplicateWorkbookFacts([fact]);
		expect(result).toHaveLength(1);
		expect(result[0]).toEqual(fact);
	});

	it("keeps the last zero when all facts for a period are zero", () => {
		// When every candidate is zero, keep the deterministic smallest fact_id
		const facts = [
			makeFact({ fact_id: "fact-z", metric_key: "revenue", period_label: "September", value: 0 }),
			makeFact({ fact_id: "fact-a", metric_key: "revenue", period_label: "September", value: 0 }),
		];
		const result = deduplicateWorkbookFacts(facts);
		expect(result).toHaveLength(1);
		expect(result[0]!.fact_id).toBe("fact-a"); // lexicographically smaller
	});
});
