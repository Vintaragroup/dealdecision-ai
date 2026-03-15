/**
 * Stage 1 — Gate evaluation section builders.
 *
 * Builds the set of render_package.sections for each gate-outcome path:
 *   - gate_failed:          G0–G5 hard fail (fail-closed)
 *   - g3_only_fail:         G3 structural soft fail → deterministic_only
 *   - evidence_gate_failed: G0–G5 pass, E0–E4 fail → deterministic_only
 *   - deterministic_only:   all gates pass, LLM stages deferred
 *
 * Also contains buildG3DiagnosticsSection (dev/staging diagnostic).
 *
 * NO LLM calls. NO direct DB queries (buildG3DiagnosticsSection probes DB but is
 * dev-only and never in production).
 */

import type { Pool } from "pg";

import type {
	GateState,
	RenderPackage,
	EvidenceGateState,
} from "../../../contracts/investor-insights/schemas";
import {
	EVIDENCE_GATE_COVERAGE_THRESHOLD,
	EVIDENCE_GATE_MIN_EVIDENCE_COUNT,
} from "../evidence-gate-v1";
import type { CoverageSnapshot } from "./_shared";
import type { InsightSlotInputs } from "./stage-2-deterministic";

// ─── Section builders ─────────────────────────────────────────────────────────

/**
 * Build the coverage_snapshot section from pre-loaded counts + gate state.
 * structured_json_available and overlay_available are derived from G3/G5 gate results.
 */
export function buildCoverageSnapshotSection(
	coverage: CoverageSnapshot,
	gateState: GateState,
	normMetrics?: { normalizationEvents: number; normalizedPages: number }
): RenderPackage["sections"][number] {
	const g3 = gateState.results.find((r) => r.gate === "G3");
	const g5 = gateState.results.find((r) => r.gate === "G5");
	const structuredJsonAvailable = g3?.passed === true;
	const overlayAvailable = g5?.passed === true;

	const errorLabel =
		coverage.coverageQueryErrors.length === 0
			? "none"
			: coverage.coverageQueryErrors.join(",");

	const lines = [
		`docs_count: ${coverage.docsCount}`,
		`dpu_page_count: ${coverage.dpuPageCount}`,
		`dpu_nonempty_pages: ${coverage.dpuNonemptyPages}`,
		`xlsx_bonus_pages: ${coverage.xlsxBonusPages}`,
		`evidence_count: ${coverage.evidenceCount}`,
		`evidence_source: ${coverage.evidenceSource ?? "unknown"}`,
		`visuals_count: ${coverage.visualsCount}`,
		`structured_json_available: ${structuredJsonAvailable}`,
		`overlay_available: ${overlayAvailable}`,
		`coverage_query_errors: ${errorLabel}`,
	];
	if (normMetrics) {
		lines.push(`normalization_events: ${normMetrics.normalizationEvents}`);
		lines.push(`normalized_pages: ${normMetrics.normalizedPages}`);
	}

	return {
		key: "coverage_snapshot",
		title: "Coverage Snapshot",
		kind: "message",
		body: lines.join("\n"),
		fallback: "Coverage data unavailable.",
	};
}

/**
 * Compute normalization metrics from loaded InsightSlotInputs for coverage_snapshot.
 */
export function normMetricsFromInputs(inputs: InsightSlotInputs): { normalizationEvents: number; normalizedPages: number } {
	return {
		normalizationEvents: inputs.normEvents.length,
		normalizedPages: inputs.dpuPages.filter((p) => p.norm_events_count > 0).length,
	};
}

/**
 * Build deterministic-only sections for a gate-failed (status="failed") render package.
 * Each section must satisfy validateNoEmptyBlocks: has items, body, or fallback.
 */
export function buildGateFailedSections(
	gateState: GateState,
	coverage: CoverageSnapshot,
	insightSlotsSections: Array<RenderPackage["sections"][number]>,
	phase2Sections: Array<RenderPackage["sections"][number]>,
	normMetrics?: { normalizationEvents: number; normalizedPages: number }
): RenderPackage["sections"] {
	const failedGates = gateState.results.filter((r) => !r.passed);
	const failSummary =
		failedGates.length > 0
			? `${failedGates.length} gate(s) failed: ${failedGates.map((g) => g.gate).join(", ")}`
			: "Gate evaluation error";

	return [
		{
			key: "gate_state",
			title: "Readiness Gates",
			kind: "gate_state",
			items: gateState.results.map((r) => ({
				gate: r.gate,
				passed: r.passed,
				reason_code: r.reason_code ?? null,
				actual: r.actual ?? null,
				threshold: r.threshold ?? null,
			})),
			fallback: failSummary,
		},
		{
			key: "analysis_status",
			title: "Analysis Status",
			kind: "message",
			body: `Investor analysis cannot proceed until readiness gates are met. ${failSummary}. Required remediation: resolve ${failedGates.map((g) => g.reason_code ?? g.gate).join(", ")}.`,
		},
		...insightSlotsSections,
		...phase2Sections,
		buildCoverageSnapshotSection(coverage, gateState, normMetrics),
	];
}

/**
 * Build deterministic-only sections when gates pass but Stage 5+ not yet run.
 */
export function buildDeterministicOnlySections(
	gateState: GateState,
	coverage: CoverageSnapshot,
	insightSlotsSections: Array<RenderPackage["sections"][number]>,
	phase2Sections: Array<RenderPackage["sections"][number]>,
	thesisSection: RenderPackage["sections"][number] | null,
	normMetrics?: { normalizationEvents: number; normalizedPages: number }
): RenderPackage["sections"] {
	const sections: RenderPackage["sections"] = [
		{
			key: "gate_state",
			title: "Readiness Gates",
			kind: "gate_state",
			items: gateState.results.map((r) => ({
				gate: r.gate,
				passed: r.passed,
				reason_code: r.reason_code ?? null,
				actual: r.actual ?? null,
				threshold: r.threshold ?? null,
			})),
			fallback: "All readiness gates passed",
		},
		{
			key: "analysis_status",
			title: "Analysis Status",
			kind: "message",
			body: "Deterministic Stage 0 analysis complete. Full analytical interpretation (Stages 1–7) pending.",
		},
		...insightSlotsSections,
		...phase2Sections,
	];
	if (thesisSection) sections.push(thesisSection);
	sections.push(buildCoverageSnapshotSection(coverage, gateState, normMetrics));
	return sections;
}

/**
 * Build deterministic-only sections for the G3-only fail-soft path.
 * Status = deterministic_only; G3 structured JSON is unreadable but all other gates passed.
 */
export function buildG3OnlyFailSections(
	gateState: GateState,
	coverage: CoverageSnapshot,
	insightSlotsSections: Array<RenderPackage["sections"][number]>,
	phase2Sections: Array<RenderPackage["sections"][number]>,
	thesisSection: RenderPackage["sections"][number] | null,
	normMetrics?: { normalizationEvents: number; normalizedPages: number }
): RenderPackage["sections"] {
	const sections: RenderPackage["sections"] = [
		{
			key: "gate_state",
			title: "Readiness Gates",
			kind: "gate_state",
			items: gateState.results.map((r) => ({
				gate: r.gate,
				passed: r.passed,
				reason_code: r.reason_code ?? null,
				actual: r.actual ?? null,
				threshold: r.threshold ?? null,
			})),
			fallback: "G3 gate failed — structured JSON unreadable",
		},
		{
			key: "analysis_status",
			title: "Analysis Status",
			kind: "message",
			body: "Generated deterministic-only report. Structured JSON unreadable (G3) — structured-derived insights are NotComputable.",
		},
		{
			key: "g3_remediation",
			title: "G3 Remediation",
			kind: "message",
			body: "Remediation steps: (1) Re-run document extraction to regenerate structured_json rows in visual_extractions. (2) Verify the extraction worker completes without error for all documents in this deal. (3) Re-trigger investor insight generation once visual_extractions rows are present.\nrecommended_queue: document_intelligence_extract\nrecommended_action: rerun_upstream_extraction\nrecommended_reason: structured_json_unreadable",
		},
		...insightSlotsSections,
		...phase2Sections,
	];
	if (thesisSection) sections.push(thesisSection);
	sections.push(buildCoverageSnapshotSection(coverage, gateState, normMetrics));
	return sections;
}

/**
 * Build deterministic-only sections for the evidence-gate-failed path.
 *
 * G0–G5 all passed; the E0–E4 evidence quality gates prevented LLM stages
 * from running due to insufficient coverage or evidence signal.
 * Deterministic Stage 0 output (slots, phase 2, thesis stub) is preserved.
 */
export function buildEvidenceGateFailedSections(
	gateState: GateState,
	coverage: CoverageSnapshot,
	evidenceGate: EvidenceGateState,
	insightSlotsSections: Array<RenderPackage["sections"][number]>,
	phase2Sections: Array<RenderPackage["sections"][number]>,
	thesisSection: RenderPackage["sections"][number] | null,
	normMetrics?: { normalizationEvents: number; normalizedPages: number }
): RenderPackage["sections"] {
	const coveragePct = Math.round((evidenceGate.metrics.coverage_pct ?? 0) * 100);
	const evidenceCount = evidenceGate.metrics.evidence_count;
	const blockingGate = evidenceGate.results.find((r) => !r.passed);
	const reasonStr = evidenceGate.blocking_reason ?? "EVIDENCE_GATE_FAIL";

	const sections: RenderPackage["sections"] = [
		{
			key: "gate_state",
			title: "Readiness Gates",
			kind: "gate_state",
			items: gateState.results.map((r) => ({
				gate: r.gate,
				passed: r.passed,
				reason_code: r.reason_code ?? null,
				actual: r.actual ?? null,
				threshold: r.threshold ?? null,
			})),
			fallback: "All structural readiness gates passed",
		},
		{
			key: "analysis_status",
			title: "Analysis Status",
			kind: "message",
			body: `Deterministic Stage 0 analysis complete. Full interpretation paused — insufficient evidence signal (${evidenceCount} items, ${coveragePct}% coverage). Reason: ${reasonStr}.`,
		},
		{
			key: "evidence_quality_gate",
			title: "Evidence Quality Gate",
			kind: "message",
			body: [
				`Full analytical interpretation (Stages 1–7) requires stronger evidence coverage to reduce hallucination risk.`,
				`Coverage: ${coveragePct}% (threshold: ${Math.round(EVIDENCE_GATE_COVERAGE_THRESHOLD * 100)}%)`,
				`Evidence items: ${evidenceCount} (threshold: ${EVIDENCE_GATE_MIN_EVIDENCE_COUNT})`,
				`Blocking gate: ${blockingGate?.gate ?? "unknown"} — ${reasonStr}`,
				`Recommended action: re-run document extraction to improve OCR coverage, or add additional source documents.`,
				`recommended_queue: document_intelligence_extract`,
				`recommended_action: rerun_upstream_extraction`,
				`recommended_reason: ${reasonStr}`,
			].join("\n"),
		},
		...insightSlotsSections,
		...phase2Sections,
	];
	if (thesisSection) sections.push(thesisSection);
	sections.push(buildCoverageSnapshotSection(coverage, gateState, normMetrics));
	return sections;
}

// ─── G3 diagnostic section (dev/staging only) ───────────────────────────────

const DIAG_TRUNCATE = 300;

function truncate(s: string, max: number): string {
	return s.length <= max ? s : s.slice(0, max) + `…(+${s.length - max} chars)`;
}

/**
 * Collects structured diagnostic detail for G3 GATE_STRUCTURED_JSON_UNREADABLE failures.
 * Probes visual_extractions.structured_json via the correct join path:
 *   documents → visual_assets → visual_extractions
 * Returns undefined in production (NODE_ENV === 'production').
 * Does NOT include raw JSON payload.
 */
export async function buildG3DiagnosticsSection(
	pool: Pool,
	dealId: string
): Promise<RenderPackage["sections"][number] | undefined> {
	if (process.env["NODE_ENV"] === "production") return undefined;

	let rowExists: boolean | null = null;
	let byteLength: number | null = null;
	let parseOk: boolean | null = null;
	let parseError: string | null = null;
	let diagQueryError: string | null = null;

	try {
		// 1. Check if any visual_extractions rows exist for this deal via correct join.
		const existsRes = await pool.query<{ exists: boolean }>(
			`SELECT EXISTS (
			   SELECT 1
			     FROM public.visual_extractions ve
			     JOIN public.visual_assets va ON va.id = ve.visual_asset_id
			     JOIN public.documents d ON d.id = va.document_id
			    WHERE d.deal_id = $1::uuid
			 ) AS exists`,
			[dealId]
		);
		rowExists = existsRes.rows[0]?.exists === true;

		if (rowExists) {
			// 2. Sample one structured_json text for size + parse check. Raw value is NOT surfaced.
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
			if (rawJson !== null) {
				byteLength = Buffer.byteLength(rawJson, "utf8");
				try {
					JSON.parse(rawJson);
					parseOk = true;
				} catch (parseErr) {
					parseOk = false;
					const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
					parseError = truncate(msg, DIAG_TRUNCATE);
				}
			}
		}
	} catch (diagErr) {
		diagQueryError = truncate(
			diagErr instanceof Error ? diagErr.message : String(diagErr),
			DIAG_TRUNCATE
		);
	}

	const lines: string[] = [
		"(dev-only) Omitted in production.",
		`source_table: visual_extractions`,
		`source_column: structured_json`,
		`row_exists: ${rowExists ?? "query_failed"}`,
		`byte_length: ${byteLength ?? "n/a"}`,
		`parse_ok: ${parseOk ?? "n/a"}`,
		`parse_error: ${parseError ?? "none"}`,
	];
	if (diagQueryError !== null) {
		lines.push(`diag_query_error: ${diagQueryError}`);
	}

	return {
		key: "debug.structured_json_diagnostics",
		title: "Debug — Structured JSON Diagnostics",
		kind: "message",
		body: lines.join("\n"),
		fallback: "Structured JSON diagnostic data unavailable.",
	};
}
