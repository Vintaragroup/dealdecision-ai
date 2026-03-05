/**
 * Stage 0 — Input loaders (DB-only, no LLM, no detection patterns).
 *
 * All functions are best-effort: individual failures return zero/null/[] rather than throwing,
 * so the main processor can always continue with degraded data rather than a hard crash.
 */

import type { Pool } from "pg";

import type { FusedFact } from "../deal-fusion";
import type { GovernedSummaryRecord } from "../governed-summary-v1";
import type { GovernedExecutiveSummaryRecord } from "../governed-executive-summary-v1";
import type { UpstreamSnapshot, CoverageSnapshot } from "./_shared";

// ─── Upstream snapshot ────────────────────────────────────────────────────────

/**
 * Collect upstream deterministic signal counts for the fingerprint.
 * All sub-queries are best-effort; failure returns zero-value for that field.
 */
export async function loadUpstreamSnapshot(pool: Pool, dealId: string): Promise<UpstreamSnapshot> {
	let dpuCount = 0;
	let dpuCoverage = 0;
	let evidenceCount = 0;
	let visualAssetCount = 0;
	let overlayExists = false;

	await Promise.allSettled([
		pool
			.query<{ total: string; non_empty: string }>(
				`SELECT COUNT(*)::bigint AS total,
				        COUNT(*) FILTER (WHERE COALESCE(payload->>'page_text','') <> '')::bigint AS non_empty
				   FROM public.document_page_understanding
				  WHERE deal_id = $1::uuid`,
				[dealId]
			)
			.then(({ rows }) => {
				dpuCount = Number(rows[0]?.total ?? 0);
				const nonEmpty = Number(rows[0]?.non_empty ?? 0);
				dpuCoverage = dpuCount > 0 ? nonEmpty / dpuCount : 0;
			}),

		pool
			.query<{ c: string }>(
				`SELECT COUNT(*)::bigint AS c FROM public.evidence_items WHERE deal_id = $1::uuid`,
				[dealId]
			)
			.then(({ rows }) => {
				evidenceCount = Number(rows[0]?.c ?? 0);
			}),

		pool
			.query<{ c: string }>(
				`SELECT COUNT(*)::bigint AS c
				   FROM public.visual_assets va
				   JOIN public.documents d ON d.id = va.document_id
				  WHERE d.deal_id = $1::uuid`,
				[dealId]
			)
			.then(({ rows }) => {
				visualAssetCount = Number(rows[0]?.c ?? 0);
			}),

		pool
			.query<{ c: string }>(
				`SELECT COUNT(*)::bigint AS c FROM public.governed_llm_overviews WHERE deal_id = $1::uuid`,
				[dealId]
			)
			.then(({ rows }) => {
				overlayExists = Number(rows[0]?.c ?? 0) > 0;
			}),
	]);

	return { dpuCount, dpuCoverage, evidenceCount, visualAssetCount, overlayExists };
}

// ─── Coverage snapshot ──────────────────────────────────────────────────────────

/**
 * Collect deterministic coverage counts for the coverage_snapshot section.
 * All sub-queries are best-effort; failure returns 0 for that field.
 */
export async function loadCoverageSnapshot(pool: Pool, dealId: string): Promise<CoverageSnapshot> {
	let docsCount = 0;
	let dpuPageCount = 0;
	let dpuNonemptyPages = 0;
	let evidenceCount = 0;
	let visualsCount = 0;

	// Label each sub-query so failures are identifiable in the output section.
	const queries: Array<[string, Promise<void>]> = [
		[
			"documents_count",
			pool
				.query<{ c: string }>(
					`SELECT COUNT(*)::bigint AS c FROM public.documents WHERE deal_id = $1::uuid`,
					[dealId]
				)
				.then(({ rows }) => {
					docsCount = Number(rows[0]?.c ?? 0);
				}),
		],
		[
			"dpu_counts",
			pool
				.query<{ total: string; non_empty: string }>(
					`SELECT
					   COUNT(*)::bigint AS total,
					   COUNT(*) FILTER (WHERE COALESCE(payload->>'page_text', '') <> '')::bigint AS non_empty
					  FROM public.document_page_understanding
					 WHERE deal_id = $1::uuid`,
					[dealId]
				)
				.then(({ rows }) => {
					dpuPageCount = Number(rows[0]?.total ?? 0);
					dpuNonemptyPages = Number(rows[0]?.non_empty ?? 0);
				}),
		],
		[
			"evidence_count",
			pool
				.query<{ c: string }>(
					`SELECT COUNT(*)::bigint AS c FROM public.evidence_items WHERE deal_id = $1::uuid`,
					[dealId]
				)
				.then(({ rows }) => {
					evidenceCount = Number(rows[0]?.c ?? 0);
				}),
		],
		[
			"visuals_count",
			pool
				.query<{ c: string }>(
					`SELECT COUNT(*)::bigint AS c
					   FROM public.visual_assets va
					   JOIN public.documents d ON d.id = va.document_id
					  WHERE d.deal_id = $1::uuid`,
					[dealId]
				)
				.then(({ rows }) => {
					visualsCount = Number(rows[0]?.c ?? 0);
				}),
		],
	];

	const results = await Promise.allSettled(queries.map(([, p]) => p));
	const coverageQueryErrors: string[] = results
		.map((r, i) => (r.status === "rejected" ? queries[i]![0] : null))
		.filter((label): label is string => label !== null);

	return { docsCount, dpuPageCount, dpuNonemptyPages, evidenceCount, visualsCount, coverageQueryErrors };
}

// ─── Deal name loader ─────────────────────────────────────────────────────────

/**
 * Load the human-readable deal name from the deals table.
 * Best-effort: returns null on any error rather than blocking the processor.
 * Used to anchor the LLM to use the real company name instead of placeholders.
 */
export async function loadDealName(pool: Pool, dealId: string): Promise<string | null> {
	try {
		const { rows } = await pool.query<{ name: string }>(
			`SELECT name FROM public.deals WHERE id = $1::uuid LIMIT 1`,
			[dealId]
		);
		return rows[0]?.name ?? null;
	} catch {
		return null;
	}
}

// ─── Previous fused facts loader ──────────────────────────────────────────────

/**
 * Load the most-recent set of fused canonical facts for a deal from
 * the report_payload of the last persisted report.
 * Returns [] when no prior run exists or the payload has no fused_facts key.
 * Fail-open: any DB error returns [] so history tracking is best-effort and
 * never blocks report generation.
 */
export async function loadPreviousFusedFacts(pool: Pool, dealId: string): Promise<FusedFact[]> {
	try {
		const { rows } = await pool.query<{ report_payload: unknown }>(
			`SELECT report_payload
			   FROM public.investor_insight_reports
			  WHERE deal_id = $1::uuid
			    AND report_payload != '{}'::jsonb
			  ORDER BY created_at DESC
			  LIMIT 1`,
			[dealId]
		);
		const payload = rows[0]?.report_payload;
		if (payload && typeof payload === "object" && !Array.isArray(payload)) {
			const p = payload as Record<string, unknown>;
			if (Array.isArray(p["fused_facts"])) {
				return p["fused_facts"] as FusedFact[];
			}
		}
	} catch {
		// Fail-open: history is best-effort; never block report generation
	}
	return [];
}

// ─── Previous governed summary loader ────────────────────────────────────────

/**
 * Load the most-recent GovernedSummaryRecord for a deal from report_payload.
 * Returns null when no prior run exists or the record is malformed / absent.
 * Fail-open: any DB error returns null so cache misses are safe and never block
 * report generation.
 */
export async function loadPreviousGovernedSummary(
	pool: Pool,
	dealId: string
): Promise<GovernedSummaryRecord | null> {
	try {
		const { rows } = await pool.query<{ report_payload: unknown }>(
			`SELECT report_payload
			   FROM public.investor_insight_reports
			  WHERE deal_id = $1::uuid
			    AND report_payload != '{}'::jsonb
			  ORDER BY created_at DESC
			  LIMIT 1`,
			[dealId]
		);
		const payload = rows[0]?.report_payload;
		if (payload && typeof payload === "object" && !Array.isArray(payload)) {
			const p = payload as Record<string, unknown>;
			const gsv1 = p["governed_summary_v1"];
			if (gsv1 && typeof gsv1 === "object" && !Array.isArray(gsv1)) {
				const r = gsv1 as GovernedSummaryRecord;
				// Basic structural guard before trusting the record
				if (
					r.schema_version === "governed_summary_v1" &&
					typeof r.fingerprint === "string" &&
					r.fingerprint.length > 0 &&
					r.summary !== null &&
					r.summary !== undefined &&
					typeof r.validation_ok === "boolean"
				) {
					return r;
				}
			}
		}
	} catch {
		// Fail-open: cache is best-effort; never block report generation
	}
	return null;
}

// ─── Previous governed executive summary loader ───────────────────────────────

/**
 * Load the most-recent GovernedExecutiveSummaryRecord for a deal from report_payload.
 * Returns null when no prior run exists or the record is malformed / absent.
 * Fail-open: any DB error returns null so cache misses are safe.
 */
export async function loadPreviousGovernedExecSummary(
	pool: Pool,
	dealId: string
): Promise<GovernedExecutiveSummaryRecord | null> {
	try {
		const { rows } = await pool.query<{ report_payload: unknown }>(
			`SELECT report_payload
			   FROM public.investor_insight_reports
			  WHERE deal_id = $1::uuid
			    AND report_payload != '{}'::jsonb
			  ORDER BY created_at DESC
			  LIMIT 1`,
			[dealId]
		);
		const payload = rows[0]?.report_payload;
		if (payload && typeof payload === "object" && !Array.isArray(payload)) {
			const p = payload as Record<string, unknown>;
			const gesv1 = p["governed_executive_summary_v1"];
			if (gesv1 && typeof gesv1 === "object" && !Array.isArray(gesv1)) {
				const r = gesv1 as GovernedExecutiveSummaryRecord;
				if (
					r.schema_version === "governed_executive_summary_v1" &&
					typeof r.fingerprint === "string" &&
					r.fingerprint.length > 0 &&
					r.summary !== null &&
					r.summary !== undefined &&
					typeof r.validation_ok === "boolean"
				) {
					return r;
				}
			}
		}
	} catch {
		// Fail-open: cache is best-effort; never block report generation
	}
	return null;
}
