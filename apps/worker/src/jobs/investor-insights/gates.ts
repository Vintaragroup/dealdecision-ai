/**
 * Investor Insight Engine – Gate Evaluators (G0–G5)
 *
 * Binding spec:
 *   docs/Active/Authoritative/investor-analysis-engine/Investor-Insight-Engine–Execution-Contract-binding.md §2
 *   docs/Active/Authoritative/investor-analysis-engine/contracts/investor-insights/reason-codes.md §A
 *
 * Gate order and definitions are binding; do NOT reorder.
 *
 * Stage 0 scope: deterministic data-existence checks only.
 * No LLM calls; no downstream engine results expected at this stage.
 */

import type { Pool } from "pg";
import { z } from "zod";
import { type GateState, GateResultSchema } from "../../contracts/investor-insights/schemas";

export type GateResult = z.infer<typeof GateResultSchema>;
export interface GateContext {
	dealId: string;
	engineVersion: string;
}

/**
 * G0 – Deal + documents existence.
 * Reason codes: GATE_DEAL_NOT_FOUND, GATE_DOCUMENTS_NOT_FOUND
 */
async function evalG0(pool: Pool, dealId: string): Promise<GateResult> {
	try {
		const { rows: dealRows } = await pool.query<{ id: string }>(
			`SELECT id FROM public.deals WHERE id = $1::uuid LIMIT 1`,
			[dealId]
		);
		if (!dealRows[0]) {
			return { gate: "G0", passed: false, reason_code: "GATE_DEAL_NOT_FOUND" };
		}

		const { rows: docRows } = await pool.query<{ c: string }>(
			`SELECT COUNT(*)::bigint AS c FROM public.documents WHERE deal_id = $1::uuid`,
			[dealId]
		);
		const docCount = Number(docRows[0]?.c ?? 0);
		if (docCount === 0) {
			return { gate: "G0", passed: false, reason_code: "GATE_DOCUMENTS_NOT_FOUND", actual: 0 };
		}

		return { gate: "G0", passed: true, actual: docCount };
	} catch {
		return { gate: "G0", passed: false, reason_code: "GATE_DEAL_NOT_FOUND" };
	}
}

/**
 * G1 – DPU exists (document_page_understanding rows are present).
 * Reason codes: GATE_DPU_MISSING, GATE_DPU_QUERY_FAILED
 */
async function evalG1(pool: Pool, dealId: string): Promise<GateResult> {
	try {
		const { rows } = await pool.query<{ c: string }>(
			`SELECT COUNT(*)::bigint AS c
			   FROM public.document_page_understanding
			  WHERE deal_id = $1::uuid`,
			[dealId]
		);
		const count = Number(rows[0]?.c ?? 0);
		if (count === 0) {
			return { gate: "G1", passed: false, reason_code: "GATE_DPU_MISSING", actual: 0 };
		}
		return { gate: "G1", passed: true, actual: count };
	} catch {
		return { gate: "G1", passed: false, reason_code: "GATE_DPU_QUERY_FAILED" };
	}
}

/**
 * G2 – DPU coverage threshold.
 * Fails if ALL pages have empty page_text (total coverage = 0).
 * Passes if at least one page has non-empty text (coverage >= 0.0 minimum for Stage 0).
 * Reason codes: GATE_DPU_TEXT_EMPTY_ALL_PAGES, GATE_DPU_COVERAGE_BELOW_THRESHOLD
 */
const DPU_COVERAGE_MIN = 0.0; // Stage 0: any page with text satisfies the gate

async function evalG2(pool: Pool, dealId: string): Promise<GateResult> {
	try {
		const { rows } = await pool.query<{ total: string; non_empty: string }>(
			`SELECT
			   COUNT(*)::bigint AS total,
			   COUNT(*) FILTER (WHERE COALESCE(payload->>'page_text', '') <> '')::bigint AS non_empty
			  FROM public.document_page_understanding
			 WHERE deal_id = $1::uuid`,
			[dealId]
		);
		const total = Number(rows[0]?.total ?? 0);
		const nonEmpty = Number(rows[0]?.non_empty ?? 0);
		const ratio = total > 0 ? nonEmpty / total : 0;

		if (total > 0 && nonEmpty === 0) {
			return {
				gate: "G2",
				passed: false,
				reason_code: "GATE_DPU_TEXT_EMPTY_ALL_PAGES",
				actual: 0,
				threshold: DPU_COVERAGE_MIN,
			};
		}
		if (total > 0 && ratio < DPU_COVERAGE_MIN) {
			return {
				gate: "G2",
				passed: false,
				reason_code: "GATE_DPU_COVERAGE_BELOW_THRESHOLD",
				actual: ratio,
				threshold: DPU_COVERAGE_MIN,
			};
		}
		return { gate: "G2", passed: true, actual: ratio, threshold: DPU_COVERAGE_MIN };
	} catch {
		return { gate: "G2", passed: false, reason_code: "GATE_DPU_QUERY_FAILED" };
	}
}

/**
 * G3 – Structured artifact present (visual_extractions.structured_json).
 * structured_json lives on visual_extractions, joined via:
 *   visual_extractions → visual_assets → documents
 *
 * Reason codes:
 *   GATE_STRUCTURED_JSON_MISSING        – no rows exist or all are NULL
 *   GATE_STRUCTURED_JSON_PARSE_FAILED   – JSON.parse throws (parse error is dev-only, not surfaced here)
 *   GATE_STRUCTURED_JSON_SCHEMA_MISMATCH – parses but fails minimal Zod schema
 *   GATE_STRUCTURED_JSON_QUERY_FAILED   – DB query throws (fail-closed, not eligible for fail-soft)
 */

/** Minimal Stage 0 schema: structured_json must be a non-empty plain object. */
const StructuredJsonMinimalSchema = z
	.record(z.unknown())
	.refine((obj) => Object.keys(obj).length > 0, { message: "empty object" });

async function evalG3(pool: Pool, dealId: string): Promise<GateResult> {
	try {
		// 1. Existence check via correct join path.
		const existsRes = await pool.query<{ exists: boolean }>(
			`SELECT EXISTS (
			   SELECT 1
			     FROM public.visual_extractions ve
			     JOIN public.visual_assets va ON va.id = ve.visual_asset_id
			     JOIN public.documents d ON d.id = va.document_id
			    WHERE d.deal_id = $1::uuid
			      AND ve.structured_json IS NOT NULL
			 ) AS exists`,
			[dealId]
		);
		const rowExists = existsRes.rows[0]?.exists === true;
		if (!rowExists) {
			return { gate: "G3", passed: false, reason_code: "GATE_STRUCTURED_JSON_MISSING", actual: 0 };
		}

		// 2. Sample one row for parse + schema check.
		const sampleRes = await pool.query<{ raw_json: string | null }>(
			`SELECT ve.structured_json::text AS raw_json
			   FROM public.visual_extractions ve
			   JOIN public.visual_assets va ON va.id = ve.visual_asset_id
			   JOIN public.documents d ON d.id = va.document_id
			  WHERE d.deal_id = $1::uuid
			    AND ve.structured_json IS NOT NULL
			  LIMIT 1`,
			[dealId]
		);
		const rawJson = sampleRes.rows[0]?.raw_json ?? null;
		if (rawJson === null) {
			// Row disappeared between EXISTS and SELECT (race condition).
			return { gate: "G3", passed: false, reason_code: "GATE_STRUCTURED_JSON_MISSING", actual: 0 };
		}

		// 3. Parse check. Parse error details are intentionally omitted from gate_state
		//    (surfaced in dev diagnostics only via buildG3DiagnosticsSection in processor).
		let parsed: unknown;
		try {
			parsed = JSON.parse(rawJson);
		} catch {
			return { gate: "G3", passed: false, reason_code: "GATE_STRUCTURED_JSON_PARSE_FAILED" };
		}

		// 4. Schema check: must be a non-empty plain object.
		const schemaResult = StructuredJsonMinimalSchema.safeParse(parsed);
		if (!schemaResult.success) {
			return { gate: "G3", passed: false, reason_code: "GATE_STRUCTURED_JSON_SCHEMA_MISMATCH" };
		}

		return { gate: "G3", passed: true, actual: 1 };
	} catch {
		// DB-level failure: fail-closed (not eligible for fail-soft).
		return { gate: "G3", passed: false, reason_code: "GATE_STRUCTURED_JSON_QUERY_FAILED" };
	}
}

/**
 * G4 – Evidence index present (or explicitly none).
 * Spec: "evidence index present OR explicitly none" — passes if query succeeds,
 * regardless of row count. Only fails if the query itself errors.
 * Reason codes: GATE_EVIDENCE_QUERY_FAILED
 */
async function evalG4(pool: Pool, dealId: string): Promise<GateResult> {
	try {
		const { rows } = await pool.query<{ c: string }>(
			`SELECT COUNT(*)::bigint AS c
			   FROM public.evidence_items
			  WHERE deal_id = $1::uuid`,
			[dealId]
		);
		const count = Number(rows[0]?.c ?? 0);
		return { gate: "G4", passed: true, actual: count };
	} catch {
		return { gate: "G4", passed: false, reason_code: "GATE_EVIDENCE_QUERY_FAILED" };
	}
}

/**
 * G5 – Governed overlay complete (governed_llm_overviews row exists for deal).
 * Reason codes: GATE_GOVERNED_OVERLAY_MISSING, GATE_GOVERNED_OVERLAY_INCOMPLETE
 */
async function evalG5(pool: Pool, dealId: string): Promise<GateResult> {
	try {
		const { rows } = await pool.query<{ c: string }>(
			`SELECT COUNT(*)::bigint AS c
			   FROM public.governed_llm_overviews
			  WHERE deal_id = $1::uuid`,
			[dealId]
		);
		const count = Number(rows[0]?.c ?? 0);
		if (count === 0) {
			return { gate: "G5", passed: false, reason_code: "GATE_GOVERNED_OVERLAY_MISSING", actual: 0 };
		}
		return { gate: "G5", passed: true, actual: count };
	} catch {
		return { gate: "G5", passed: false, reason_code: "GATE_GOVERNED_OVERLAY_INCOMPLETE" };
	}
}

/**
 * Evaluate all gates G0–G5 in parallel and return a combined GateState.
 * Order is binding per Execution Contract §2; evaluation is parallel for performance.
 */
export async function evaluateGates(pool: Pool, ctx: GateContext): Promise<GateState> {
	const [g0, g1, g2, g3, g4, g5] = await Promise.all([
		evalG0(pool, ctx.dealId),
		evalG1(pool, ctx.dealId),
		evalG2(pool, ctx.dealId),
		evalG3(pool, ctx.dealId),
		evalG4(pool, ctx.dealId),
		evalG5(pool, ctx.dealId),
	]);

	const results: GateResult[] = [g0, g1, g2, g3, g4, g5];
	const allPassed = results.every((r) => r.passed);
	return { all_passed: allPassed, results };
}
