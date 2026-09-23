/**
 * Apply Accepted Financial Corrections
 *
 * Pure function: given a deal's raw financial facts and a set of
 * validator-decided corrections, mutates the metric_key of any fact whose
 * correction reached validator_status "accepted" so it is excluded from
 * canonical metric selection (see select-authoritative-fact.ts,
 * CANONICAL_REVENUE_KEYS) in this same analysis run — not just a future one.
 *
 * Scope: only corrections with source === 'llm_financial_verification' and
 * validator_status === 'accepted' are applied. By construction of the
 * deterministic validator's accept rule (requires financial_type !==
 * 'current_revenue' / 'historical_revenue', plus flagged_as_projection or
 * flagged_as_market_sizing), an accepted correction here can only mean
 * "exclude this value from its current classification" — never a
 * same-classification confirmation — so no additional guard is needed.
 *
 * No I/O. Mutates the `facts` array's elements in place (matching how
 * apps/worker/src/jobs/analyze-deal/processor.ts passes this array by
 * reference through orchestrator.analyze() and the report compiler) and
 * returns the corrections that were applied, each stamped with
 * applied_to_scoring/applied_at, so the caller can persist them to
 * financial_facts_v1.
 */

import type { FinancialFactV1 } from "@dealdecision/core";
import type { CorrectionLineageItem } from "@dealdecision/core/dist/models/correction-lineage-v1";

export interface AppliedFinancialCorrection {
	correction: CorrectionLineageItem;
	fact: FinancialFactV1;
	originalMetricKey: string;
	newMetricKey: string;
}

const FINANCIAL_FACTS_FIELD_PREFIX = "financial_facts.";

export function applyAcceptedFinancialCorrections(
	facts: FinancialFactV1[],
	corrections: CorrectionLineageItem[],
): AppliedFinancialCorrection[] {
	const factById = new Map(facts.map((f) => [f.fact_id, f]));
	const nowIso = new Date().toISOString();
	const applied: AppliedFinancialCorrection[] = [];

	for (const correction of corrections) {
		if (correction.source !== "llm_financial_verification") continue;
		if (correction.validator_status !== "accepted") continue;

		const targetFact = factById.get(correction.original_field);
		if (!targetFact) continue;

		const newMetricKey = correction.proposed_field.startsWith(FINANCIAL_FACTS_FIELD_PREFIX)
			? correction.proposed_field.slice(FINANCIAL_FACTS_FIELD_PREFIX.length)
			: null;
		if (!newMetricKey || newMetricKey === targetFact.metric_key) continue;

		const originalMetricKey = targetFact.metric_key;
		targetFact.metric_key = newMetricKey; // in-memory — propagates to scoring/compile this run
		correction.applied_to_scoring = true;
		correction.applied_at = nowIso;

		applied.push({ correction, fact: targetFact, originalMetricKey, newMetricKey });
	}

	return applied;
}
