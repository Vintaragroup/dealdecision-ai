/**
 * Financial Verifier Batching
 *
 * Pure functions: split a deal's financial facts into token-budgeted batches
 * for the pre-scoring Financial Verifier, and merge the per-batch LLM results
 * back into a single LLMFinancialVerificationV1 object.
 *
 * Why this exists: sending all of a deal's financial_facts_v1 rows to the
 * Financial Verifier in one call hits MAX_TOKENS (2500) well before 100
 * facts — verified live on a 143-fact deal, where the LLM's JSON response
 * was truncated and failed to parse, silently returning zero classifications
 * for the entire deal.
 *
 * The fix is not a filter that decides which facts are "worth" reviewing —
 * any exclusion rule creates a class of facts that never reach the LLM, with
 * no signal downstream that they were skipped. Batching guarantees every
 * fact is reviewed; it only changes how many calls that takes.
 *
 * A fixed COUNT per batch (the first version of this fix) is not actually a
 * token guarantee — verified live: batch size 12 still produced 4 parse
 * failures out of 12 batches on a real deal, because some facts have far
 * longer excerpt/raw_value text than others, and a count-based batch doesn't
 * account for that. Packing by ESTIMATED output token cost is the real
 * guarantee: no batch is assembled past its token budget regardless of how
 * verbose any individual fact's text is. A single fact whose own estimate
 * exceeds the budget still gets its own solo batch — it is never dropped,
 * only isolated.
 *
 * Each batch is cached independently by its own fingerprint (see
 * financial-verification-cache.ts), so a deal where only one fact changed
 * between analyses only re-verifies the batch that fact belongs to, not the
 * whole deal — this is also why packing must be deterministic given the same
 * input facts, so batch membership (and therefore cache keys) stays stable
 * across runs.
 */

import type { FinancialFactV1 } from "@dealdecision/core";
import type { LLMFinancialVerificationV1 } from "@dealdecision/core/dist/models/llm-financial-verification-v1";

/**
 * MAX_TOKENS in llm-financial-verifier.ts is 2500 (the OpenAI response's
 * completion-token ceiling). Calibrated against real usage, not a guess:
 * verified live on the 143-fact deal used to find this bug, successful
 * batches of 10-12 facts measured 1927-2472 actual completion_tokens — some
 * within 30 tokens of the 2500 ceiling despite "succeeding". A batch target
 * of 1400 (this constant's original value) still produced 2 failures out of
 * 13 batches for exactly this reason: the per-fact estimate below was tuned
 * to theory (JSON structure + input length), not to what the model actually
 * spends generating a "reason" field, which turned out to be roughly 3x
 * higher. 1200 leaves real headroom under the measured worst case rather
 * than sitting near it.
 */
export const FINANCIAL_VERIFIER_TOKEN_BUDGET_PER_BATCH = 1200;

/**
 * Estimated OUTPUT tokens a single fact will cost once classified.
 *
 * Calibrated from real usage, not derived from theory: measured completion
 * tokens on 8 real, successful batches divided by their verified_value
 * counts consistently landed at ~200-210 tokens/fact regardless of input
 * text length — meaning the dominant cost is the model's own reasoning
 * output (the "reason" field, entity/type classification), not the input
 * excerpt it's reading. The original estimate (70 base + length/4) measured
 * roughly a third of the real value; this one has margin above the observed
 * range instead of sitting at it. The length term is kept, but with a much
 * smaller weight, so unusually long excerpts still nudge the estimate up
 * without dominating it the way the original formula did.
 */
export function estimateFactOutputTokens(fact: FinancialFactV1): number {
	const textLength =
		(fact.excerpt?.length ?? 0) +
		(fact.metric_key?.length ?? 0) +
		(fact.source_pointer?.length ?? 0) +
		String(fact.value ?? "").length;
	const measuredAverageTokensPerFact = 230;
	const lengthAdjustment = Math.ceil(textLength / 12);
	return measuredAverageTokensPerFact + lengthAdjustment;
}

/**
 * Packs facts into batches such that no batch's estimated total output
 * tokens exceeds targetTokenBudget. Greedy bin-packing in input order (not
 * sorted by size) so batch membership is easy to reason about and stays
 * stable when a small number of facts change between runs. A fact whose own
 * estimate alone exceeds the budget is placed in its own single-fact batch
 * rather than being dropped — the batch will still be sent to the LLM and
 * may itself risk truncation for that one fact's response, but it is never
 * silently excluded.
 */
export function packFactsByTokenBudget(
	facts: FinancialFactV1[],
	targetTokenBudget: number = FINANCIAL_VERIFIER_TOKEN_BUDGET_PER_BATCH,
): FinancialFactV1[][] {
	if (targetTokenBudget <= 0) throw new Error("targetTokenBudget must be positive");
	const batches: FinancialFactV1[][] = [];
	let currentBatch: FinancialFactV1[] = [];
	let currentBatchTokens = 0;

	for (const fact of facts) {
		const factTokens = estimateFactOutputTokens(fact);
		const wouldExceedBudget = currentBatchTokens + factTokens > targetTokenBudget;
		if (wouldExceedBudget && currentBatch.length > 0) {
			batches.push(currentBatch);
			currentBatch = [];
			currentBatchTokens = 0;
		}
		currentBatch.push(fact);
		currentBatchTokens += factTokens;
	}
	if (currentBatch.length > 0) batches.push(currentBatch);

	return batches;
}

/**
 * Merges per-batch verification results into one object. Coverage guarantee:
 * a batch that failed (null — parse failure, timeout, missing API key) is
 * simply absent from its contribution, not silently treated as "verified
 * clean" — callers should check batch failure counts separately if that
 * distinction matters (see PRE_SCORING_FINANCIAL_VERIFICATION_COMPLETE log).
 */
export function mergeFinancialVerifications(
	results: Array<LLMFinancialVerificationV1 | null>,
	context: { deal_id: string; run_id: string | null },
): LLMFinancialVerificationV1 | null {
	const successful = results.filter((r): r is LLMFinancialVerificationV1 => r !== null);
	if (successful.length === 0) return null;

	return {
		schema_version: "llm_financial_verification_v1",
		deal_id: context.deal_id,
		run_id: context.run_id,
		created_at: new Date().toISOString(),
		model: successful[0].model ?? null,
		provider: successful[0].provider ?? null,
		verified_values: successful.flatMap((r) => r.verified_values),
		financial_gaps: successful.flatMap((r) => r.financial_gaps),
		summary: successful.map((r) => r.summary).filter(Boolean).join(" ") || null,
		xlsx_data_present: successful.some((r) => r.xlsx_data_present),
		cap_table_present: successful.some((r) => r.cap_table_present),
	};
}
