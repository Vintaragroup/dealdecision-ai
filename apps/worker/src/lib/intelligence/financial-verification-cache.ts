/**
 * Financial Verification Cache — Fingerprint
 *
 * Pure function: computes a stable SHA-256 fingerprint of the financial facts
 * corpus fed to the pre-scoring Financial Verifier. Used as the inputs_hash
 * key into the existing deal_report_llm_cache table so that re-running
 * analysis on unchanged documents reuses the prior verification result
 * instead of re-calling the LLM.
 *
 * Why this exists: moving the Financial Verifier pre-scoring (see
 * apps/worker/src/jobs/analyze-deal/processor.ts) put LLM output in the
 * critical path of scoring for the first time. LLM output is not guaranteed
 * bit-reproducible even at temperature 0, so without a cache, re-analyzing
 * the same deal with unchanged documents could silently produce a different
 * score between runs. Caching by fingerprint restores that reproducibility:
 * the same facts always resolve to the same cached verification/correction
 * decision until the facts actually change.
 *
 * The fingerprint changes when any fact's fact_id, metric_key, value,
 * source_kind, or confidence changes, or when a fact is added/removed —
 * i.e. exactly when re-verification is actually warranted.
 */

import { createHash } from "node:crypto";
import type { FinancialFactV1 } from "@dealdecision/core";

export function computeFinancialFactsFingerprint(facts: FinancialFactV1[]): string {
	const canonical = facts
		.map((f) => ({
			fact_id: f.fact_id,
			metric_key: f.metric_key,
			value: f.value,
			source_kind: f.source_kind,
			confidence: f.confidence,
		}))
		.sort((a, b) => a.fact_id.localeCompare(b.fact_id));

	return createHash("sha256").update(JSON.stringify(canonical), "utf8").digest("hex");
}
