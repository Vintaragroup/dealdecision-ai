/**
 * Governed-skip observability — WS-B (PR20)
 *
 * Records skip events for governed LLM stages with a stable reason_code so
 * every null-return path is observable and queryable via structured logs.
 *
 * Side-effects:
 *   - Emits GOVERNED_STAGE_SKIPPED structured log event (console.log JSON).
 *   - Appends to opts.governedSkips array when provided (mutates in-place).
 *
 * Pure until the log call: no DB access, no LLM calls.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type GovernedSkipStage =
	| "governed_summary_v1"
	| "governed_executive_summary_v1"
	| "product_profile_v1";

/**
 * Stable reason codes for governed-stage skips.
 *
 * Each code maps to a class of failure and is persisted in the render package
 * so dashboards, alerts, and audit queries can filter by skip category without
 * parsing log text.
 *
 * Binding: docs/Active/Authoritative/investor-analysis-engine/governed-skip-reason-codes.md
 */
export type GovernedSkipReasonCode =
	/** OpenAI key absent or empty — job cannot call the LLM at all. */
	| "missing_openai_key"
	/** Feature-flag gate disabled upstream processing for this stage. */
	| "feature_flag_disabled"
	/** Evidence gate blocked all LLM stages before this one was reached. */
	| "evidence_gate_blocked"
	/** Upstream structured JSON (G3) is missing or unparseable. */
	| "upstream_missing_structured_json"
	/** LLM returned output but governance token validation failed. */
	| "validation_failed"
	/** LLM call timed out or the governed-summary resolver returned null. */
	| "timeout"
	/** No product narrative text was available as LLM input. */
	| "no_product_narrative"
	/** Catch-all — reason was not classifiable from available context. */
	| "unknown";

/** Shape of a single governed-skip record inside render_package.governed_skips. */
export interface GovernedSkip {
	stage: GovernedSkipStage;
	reason_code: GovernedSkipReasonCode;
	ts: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Map an arbitrary reason string from generateProductProfileV1 results to the
 * closest GovernedSkipReasonCode.  Falls back to "unknown" for unrecognised values.
 */
export function productProfileReasonToSkipCode(reason: string | null | undefined): GovernedSkipReasonCode {
	if (!reason) return "unknown";
	const r = reason.toLowerCase();
	if (r.includes("no_product_narrative") || r.includes("no_product") || r.includes("narrative_absent"))
		return "no_product_narrative";
	if (r.includes("missing_openai") || r.includes("openai_key") || r.includes("api_key"))
		return "missing_openai_key";
	if (r.includes("feature_flag") || r.includes("disabled"))
		return "feature_flag_disabled";
	if (r.includes("timeout"))
		return "timeout";
	return "unknown";
}

// ─── Core utility ─────────────────────────────────────────────────────────────

/**
 * Record a governed-stage skip event.
 *
 * Emits a GOVERNED_STAGE_SKIPPED structured log (console.log JSON) and, when
 * `governedSkips` is provided, appends a GovernedSkip record to the array for
 * later inclusion in the render package as render_package.governed_skips.
 */
export function recordGovernedSkip(opts: {
	stage: GovernedSkipStage;
	reason_code: GovernedSkipReasonCode;
	deal_id?: string;
	report_id?: string;
	governedSkips?: GovernedSkip[];
}): void {
	const ts = new Date().toISOString();

	console.log(
		JSON.stringify({
			event: "GOVERNED_STAGE_SKIPPED",
			stage: opts.stage,
			reason_code: opts.reason_code,
			deal_id: opts.deal_id ?? null,
			report_id: opts.report_id ?? null,
			ts,
		})
	);

	if (opts.governedSkips !== undefined) {
		opts.governedSkips.push({
			stage: opts.stage,
			reason_code: opts.reason_code,
			ts,
		});
	}
}
