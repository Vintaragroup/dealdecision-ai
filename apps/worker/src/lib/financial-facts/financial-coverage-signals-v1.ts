/**
 * financial-coverage-signals-v1.ts
 *
 * Pure helpers that derive investor-facing summary signals from a
 * FinancialCoverageV1 profile + conflict list:
 *
 *   computeFinancialCoveragePct  — % of 17 tracked metrics present (0-100)
 *   deriveFinancialRiskFlags     — investor-facing string risk flags
 *
 * Used by the investor-insights processor (Phase 9).
 * Pure functions — no DB, no LLM, never throw.
 */

import type { FinancialCoverageV1, FinancialConflictV1 } from "@dealdecision/core";
import {
	INCOME_STATEMENT_METRICS,
	UNIT_ECONOMICS_METRICS,
	CASH_FLOW_METRICS,
} from "./build-financial-coverage-v1.js";

// ─── Tracked metrics ──────────────────────────────────────────────────────────

/**
 * The 17 canonical metrics that define financial completeness:
 *   7 income-statement + 7 unit-economics + 3 cash-flow
 */
export const ALL_TRACKED_METRICS: ReadonlyArray<string> = [
	...INCOME_STATEMENT_METRICS,
	...UNIT_ECONOMICS_METRICS,
	...CASH_FLOW_METRICS,
];

// ─── Coverage % ───────────────────────────────────────────────────────────────

/**
 * Return the coverage percentage (0–100) as the fraction of ALL_TRACKED_METRICS
 * that appear in coverage.metrics_present.
 *
 * Returns 0 on any edge case.
 */
export function computeFinancialCoveragePct(
	coverage: FinancialCoverageV1 | null | undefined,
): number {
	if (!coverage || ALL_TRACKED_METRICS.length === 0) return 0;
	const presentSet = new Set(coverage.metrics_present);
	const n = ALL_TRACKED_METRICS.filter((m) => presentSet.has(m)).length;
	return Math.round((n / ALL_TRACKED_METRICS.length) * 100);
}

// ─── Risk flags ───────────────────────────────────────────────────────────────

/**
 * Derive investor-facing risk flags from a coverage profile + conflict list.
 *
 * Possible flags:
 *   "low_coverage"        — < 30% of tracked metrics present
 *   "revenue_conflict"    — conflicting revenue values across sources
 *   "arr_conflict"        — conflicting ARR values across sources
 *   "burn_conflict"       — conflicting burn-rate values across sources
 *   "burn_without_runway" — burn_rate present but runway_months missing
 *   "high_conflict_count" — 3 or more distinct metric conflicts detected
 *
 * Returns a sorted, deduplicated array.  Never throws.
 */
export function deriveFinancialRiskFlags(
	coverage: FinancialCoverageV1 | null | undefined,
	conflicts: FinancialConflictV1[] | null | undefined,
): string[] {
	const flags = new Set<string>();
	try {
		const safeConflicts = conflicts ?? [];

		if (computeFinancialCoveragePct(coverage) < 30) {
			flags.add("low_coverage");
		}

		for (const c of safeConflicts) {
			switch (c.metric_key) {
				case "revenue":   flags.add("revenue_conflict"); break;
				case "arr":       flags.add("arr_conflict");     break;
				case "burn_rate": flags.add("burn_conflict");    break;
			}
		}

		if (coverage?.metrics_missing.includes("runway_months")) {
			flags.add("burn_without_runway");
		}

		if (safeConflicts.length >= 3) {
			flags.add("high_conflict_count");
		}
	} catch {
		// pure helper — never rethrow
	}
	return [...flags].sort();
}
