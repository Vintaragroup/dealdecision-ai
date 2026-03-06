/**
 * PR35 — External Due Diligence Layer v1
 * Main entry point: runExternalDiligenceV1
 *
 * Orchestrates:
 *   1. buildExternalDiligenceQueryPlan   — derive queries from InsightSlotInputs
 *   2. runTavilySearches                 — execute cost-bounded Tavily searches
 *   3. normalizeExternalResults          — dedup, corroborate, assemble schema
 *   4. serializeExternalDiligenceBody    — render to LLM-safe text body
 *
 * Graceful degradation:
 *   - Any unhandled error returns null (non-fatal).
 *   - Tavily feature-flag off → returns ExternalDiligenceV1 with run_status="skipped".
 *   - Per-bucket Tavily errors are contained inside runTavilySearches.
 *
 * Called from processor.ts immediately before buildLlmInterpretationSection.
 */

import type { InsightSlotInputs } from "../stages/stage-2-deterministic";
import type { ExternalDiligenceV1 } from "./external-diligence-schema";
import { buildExternalDiligenceQueryPlan } from "./build-query-plan";
import { runTavilySearches } from "./run-tavily-searches";
import { normalizeExternalResults } from "./normalize-external-results";
import {
	serializeExternalDiligenceBody,
	serializeExternalDiligenceSectionBody,
} from "./serialize-external-diligence";

export type { ExternalDiligenceV1 } from "./external-diligence-schema";

// ─── Options ──────────────────────────────────────────────────────────────────

export interface RunExternalDiligenceV1Opts {
	/** Deal identifier for structured logging */
	deal_id: string;
	/** Optional deal name — used when company name can't be extracted from DPU text */
	dealName?: string | null;
	/** Canonical fields body from Phase-2 — used for claim corroboration */
	canonicalFieldsBody?: string | null;
}

// ─── Result ───────────────────────────────────────────────────────────────────

export interface ExternalDiligenceV1Result {
	/** Structured schema — used to build the render package section */
	diligence: ExternalDiligenceV1;
	/** LLM-safe serialised body — passed to generateLlmInterpretationV1 */
	body: string | null;
}

// ─── Render section builder ───────────────────────────────────────────────────

/**
 * Build an investor-insights render-package section from ExternalDiligenceV1.
 *
 * The section body embeds both human-readable text AND the structured JSON
 * (under a delimiter) so the web UI can parse it without a separate API call.
 *
 * Returns null when the diligence run was skipped with zero results.
 */
export function buildExternalDiligenceRenderSection(
	diligence: ExternalDiligenceV1
): { key: string; title: string; kind: "message"; body: string; fallback: string } | null {
	if (diligence.run_status === "skipped" && diligence.total_results_fetched === 0) {
		return null;
	}
	const body = serializeExternalDiligenceSectionBody(diligence);
	return {
		key: "external_diligence_v1",
		title: "External Due Diligence",
		kind: "message",
		body,
		fallback: "External due diligence data unavailable.",
	};
}

// ─── Main ─────────────────────────────────────────────────────────────────────

/**
 * Run external due diligence for a deal.
 *
 * Returns an ExternalDiligenceV1Result on success, or null on unhandled failure.
 * Callers should treat null as a non-fatal skip — the pipeline continues without
 * external diligence.
 */
export async function runExternalDiligenceV1(
	inputs: InsightSlotInputs,
	opts: RunExternalDiligenceV1Opts
): Promise<ExternalDiligenceV1Result | null> {
	const { deal_id, dealName, canonicalFieldsBody } = opts;

	try {
		console.log(
			JSON.stringify({
				event: "EXTERNAL_DILIGENCE_V1_START",
				deal_id,
				has_canonical_fields: !!canonicalFieldsBody,
				dpu_pages: inputs?.dpuPages?.length ?? 0,
				ts: new Date().toISOString(),
			})
		);

		// ── Step 1: Build query plan ──────────────────────────────────────────
		const plan = buildExternalDiligenceQueryPlan(inputs, dealName);

		console.log(
			JSON.stringify({
				event: "EXTERNAL_DILIGENCE_QUERY_PLAN",
				deal_id,
				company_name: plan.company_name,
				sector: plan.sector,
				founder_name: plan.founder_name,
				ts: new Date().toISOString(),
			})
		);

		// ── Step 2: Execute Tavily searches ───────────────────────────────────
		const searchResult = await runTavilySearches(plan, deal_id);

		// ── Step 3: Normalize and assemble schema ─────────────────────────────
		const diligence = normalizeExternalResults(
			searchResult,
			plan,
			canonicalFieldsBody ?? null
		);

		// ── Step 4: Serialise for LLM ─────────────────────────────────────────
		const body = serializeExternalDiligenceBody(diligence);

		console.log(
			JSON.stringify({
				event: "EXTERNAL_DILIGENCE_V1_COMPLETE",
				deal_id,
				run_status: diligence.run_status,
				total_results: diligence.total_results_fetched,
				queries_run: diligence.queries_run,
				corroborations: diligence.claim_corroborations.length,
				body_chars: body?.length ?? 0,
				tavily_credits: diligence.tavily_credits_used,
				ts: new Date().toISOString(),
			})
		);

		return { diligence, body };
	} catch (err) {
		console.error(
			JSON.stringify({
				event: "EXTERNAL_DILIGENCE_V1_ERROR",
				deal_id,
				error: err instanceof Error ? err.message : String(err),
				ts: new Date().toISOString(),
			})
		);
		// Graceful degradation — return null so the main pipeline can continue
		return null;
	}
}
