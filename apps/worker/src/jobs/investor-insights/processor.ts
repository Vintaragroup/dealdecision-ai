/**
 * Investor Insight Engine – Stage 0 Processor
 *
 * Implements Stage 0 only (PR1 scope):
 *   - Parse job using InvestorInsightsJobSchema
 *   - Evaluate G0–G5 gates
 *   - Fail-closed: always persist a render_package even when gates fail
 *   - If gates pass: compute upstream fingerprint + dedup + persist deterministic_only
 *
 * Binding spec:
 *   docs/Active/Authoritative/investor-analysis-engine/Investor-Insight-Engine–Execution-Contract-binding.md
 *   docs/Active/Authoritative/investor-analysis-engine/contracts/investor-insights/version-pins.md
 *   apps/worker/src/contracts/investor-insights/schemas.ts
 *   apps/worker/src/contracts/investor-insights/validators.ts
 *
 * DO NOT add LLM calls in this file. Stage 5 (LLM) is out of scope for PR1.
 */

import { createHash } from "crypto";
import type { Job } from "bullmq";
import type { Pool } from "pg";

import {
	InvestorInsightsJobSchema,
	type GateState,
	type ComplianceState,
	type RenderPackage,
} from "../../contracts/investor-insights/schemas";
import {
	validateGateState,
	validateRenderPackage,
	validateNoEmptyBlocks,
} from "../../contracts/investor-insights/validators";
import { getPool } from "../../lib/db";
import { evaluateGates } from "./gates";
import { normalizeForExtraction, type NormalizationEvent } from "./normalize";

// ─── Binding constants (version-pins.md) ───────────────────────────────────────

/** Queue name (binding). Task spec: "investor_insights" */
export const QUEUE_NAME = "investor_insights" as const;

/** BullMQ job name (binding). Task spec: "generate_investor_insights" */
export const JOB_NAME = "generate_investor_insights" as const;

/** Version pins – must be present in every render package and audit entry. */
const VERSION_PINS = {
	constitution_version: "v2.0",
	engine_version: "v1",
	schema_version: "v2",
	governance_version: "v1.1",
	ui_contract_version: "v1",
} as const;

// ─── Fingerprint helpers ───────────────────────────────────────────────────────

/**
 * Build the upstream fingerprint (SHA-256 over canonical JSON).
 * Canonicalization: keys sorted lexicographically, primitive-array values sorted.
 * Binding: Execution Contract §4.2–4.3.
 */
function buildDeterministicFingerprint(input: {
	dealId: string;
	engineVersion: string;
	dpuCount: number;
	dpuCoverage: number;
	evidenceCount: number;
	overlayExists: boolean;
	visualAssetCount: number;
}): string {
	// Keys sorted lexicographically per §4.2
	const canonical = JSON.stringify({
		deal_id: input.dealId,
		dpu_count: input.dpuCount,
		dpu_coverage: Number(input.dpuCoverage.toFixed(6)),
		engine_version: input.engineVersion,
		evidence_count: input.evidenceCount,
		overlay_exists: input.overlayExists,
		visual_asset_count: input.visualAssetCount,
	});
	return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Fallback fingerprint used when gates fail (no upstream snapshot available)
 * or when the canonical computation itself fails.
 * Unique per-run (timestamp) so each fail-closed run gets its own row.
 */
function buildFallbackFingerprint(dealId: string, engineVersion: string): string {
	return createHash("sha256")
		.update(`${dealId}:${engineVersion}:fallback:${Date.now()}`)
		.digest("hex")
		.slice(0, 16);
}

// ─── Upstream snapshot ────────────────────────────────────────────────────────

interface UpstreamSnapshot {
	dpuCount: number;
	dpuCoverage: number;
	evidenceCount: number;
	visualAssetCount: number;
	overlayExists: boolean;
}

/**
 * Collect upstream deterministic signal counts for the fingerprint.
 * All sub-queries are best-effort; failure returns zero-value for that field.
 */
async function loadUpstreamSnapshot(pool: Pool, dealId: string): Promise<UpstreamSnapshot> {
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

interface CoverageSnapshot {
	docsCount: number;
	dpuPageCount: number;
	dpuNonemptyPages: number;
	evidenceCount: number;
	visualsCount: number;
	/** Names of sub-queries that were rejected via Promise.allSettled. Empty = all succeeded. */
	coverageQueryErrors: string[];
}

/**
 * Collect deterministic coverage counts for the coverage_snapshot section.
 * All sub-queries are best-effort; failure returns 0 for that field.
 */
async function loadCoverageSnapshot(pool: Pool, dealId: string): Promise<CoverageSnapshot> {
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

// ─── Compliance state builder ─────────────────────────────────────────────────

function buildComplianceState(events: ComplianceState["events"] = []): ComplianceState {
	const hasFail = events.some((e) => e.severity === "error");
	return {
		status: events.length === 0 ? "not_run" : hasFail ? "failed" : "passed",
		events,
	};
}

// ─── Section builders ─────────────────────────────────────────────────────────

/**
 * Build the coverage_snapshot section from pre-loaded counts + gate state.
 * structured_json_available and overlay_available are derived from G3/G5 gate results.
 */
function buildCoverageSnapshotSection(
	coverage: CoverageSnapshot,
	gateState: GateState
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
		`evidence_count: ${coverage.evidenceCount}`,
		`visuals_count: ${coverage.visualsCount}`,
		`structured_json_available: ${structuredJsonAvailable}`,
		`overlay_available: ${overlayAvailable}`,
		`coverage_query_errors: ${errorLabel}`,
	];

	return {
		key: "coverage_snapshot",
		title: "Coverage Snapshot",
		kind: "message",
		body: lines.join("\n"),
		fallback: "Coverage data unavailable.",
	};
}

/**
 * Build deterministic-only sections for a gate-failed (status="failed") render package.
 * Each section must satisfy validateNoEmptyBlocks: has items, body, or fallback.
 */
function buildGateFailedSections(
	gateState: GateState,
	coverage: CoverageSnapshot,
	insightSlotsSections: Array<RenderPackage["sections"][number]>,
	phase2Sections: Array<RenderPackage["sections"][number]>
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
		buildCoverageSnapshotSection(coverage, gateState),
	];
}

/**
 * Build deterministic-only sections when gates pass but Stage 5+ not yet run.
 */
function buildDeterministicOnlySections(
	gateState: GateState,
	coverage: CoverageSnapshot,
	insightSlotsSections: Array<RenderPackage["sections"][number]>,
	phase2Sections: Array<RenderPackage["sections"][number]>,
	thesisSection: RenderPackage["sections"][number] | null
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
	sections.push(buildCoverageSnapshotSection(coverage, gateState));
	return sections;
}

/**
 * Build deterministic-only sections for the G3-only fail-soft path.
 * Status = deterministic_only; G3 structured JSON is unreadable but all other gates passed.
 */
function buildG3OnlyFailSections(
	gateState: GateState,
	coverage: CoverageSnapshot,
	insightSlotsSections: Array<RenderPackage["sections"][number]>,
	phase2Sections: Array<RenderPackage["sections"][number]>,
	thesisSection: RenderPackage["sections"][number] | null
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
	sections.push(buildCoverageSnapshotSection(coverage, gateState));
	return sections;
}
// ─── Stage 1: Deterministic Insight Slots ───────────────────────────────────────

/**
 * Stage 1 slot reason codes (NotComputable cases).
 * UPPER_SNAKE_CASE per reason-code format enforcement.
 */
const SLOT_REASON_CODES = {
	NO_RAISE_MENTION: "NO_RAISE_MENTION",
	NO_MARKET_CLAIM_MENTION: "NO_MARKET_CLAIM_MENTION",
	NO_TRACTION_SIGNAL_MENTION: "NO_TRACTION_SIGNAL_MENTION",
	NO_VALUATION_MENTION: "NO_VALUATION_MENTION",
	NO_USE_OF_FUNDS_MENTION: "NO_USE_OF_FUNDS_MENTION",
	STRUCTURED_JSON_UNAVAILABLE: "STRUCTURED_JSON_UNAVAILABLE",
	DPU_LOAD_FAILED: "DPU_LOAD_FAILED",
} as const;

type SlotReasonCode = (typeof SLOT_REASON_CODES)[keyof typeof SLOT_REASON_CODES];

interface SlotResult {
	computable: boolean;
	value: string | null;
	evidence: string | null;
	reasonCode: SlotReasonCode | null;
}

interface DpuPage {
	document_id: string;
	page_index: number;
	/** Normalized OCR text — used by all detectors. */
	text: string;
	/** Original OCR output before normalization. */
	text_raw: string;
	/** Number of normalization transform events applied to this page. */
	norm_events_count: number;
}

interface EvidenceSnippet {
	id: string;
	claim_text: string | null;
	/** Normalized form of claim_text, or null when claim_text was empty/null. */
	claim_text_norm: string | null;
}

interface DpuDiagnostics {
	queryOk: boolean;
	rowCount: number;
	usablePageCount: number;
	sample: string;
	errorMessage?: string;
	errorCode?: string;
}

interface InsightSlotInputs {
	dpuPages: DpuPage[];
	evidenceSnippets: EvidenceSnippet[];
	/** True when the DPU query itself threw (block-level failure). */
	dpuLoadFailed: boolean;
	/** Derived from G3 gate result. */
	g3Passed: boolean;
	dpuDiag: DpuDiagnostics;
	/** All normalization transform events collected during data load. */
	normEvents: NormalizationEvent[];
}

// ── Slot detection patterns (compile once) ───────────────────────────────────

/**
 * RAISE_TERMS: matches "Raising $2M seed", "raise $5M Series A", "$3M seed round",
 * "seeking $10M", "raised $1.5M", "funding $2M", "round size $3M", "proceeds $5M", etc.
 * Anchors: raise/raising/raised, seeking, funding/funded, financing/financed,
 *   investment/investing, offering, round size, ticket size, capital raise, proceeds, allocation.
 */
const RAISE_PATTERN =
	/(?:rais(?:e|ing|ed)|seeking|fund(?:ed|ing)?|financ(?:ed|ing)?|invest(?:ment|ing)?|offer(?:ing)?|round\s+size|ticket\s+size|capital\s+raise|proceeds|allocation)\s+\$[\d,.]+\s*[BMKbmk]?(?:\s*(?:million|billion|thousand))?|\$[\d,.]+\s*[BMKbmk]?(?:\s*(?:million|billion|thousand))?\s*(?:seed|series\s+[a-cA-C]|pre[-\s]seed|round|fund(?:ed|ing)?|raise|financing|investment)/i;

/**
 * MARKET_CLAIMS: matches both keyword-first and dollar-first forms:
 *   Form A (keyword → $): "TAM $10B", "total addressable market $10B"
 *   Form B ($ → keyword): "$10.5B+ TAM", "$600-900M TAM SAM SOM"
 *
 * Amount format: $<digits>[,<digits>][.<digits>][-<range>][K|M|B|T][+]
 * Anchor tokens: TAM, SAM, SOM, "total addressable market", "addressable market"
 */
const MARKET_PATTERN =
	/(?:\bTAM\b|\bSAM\b|\bSOM\b|\btotal\s+addressable\s+market\b|\baddressable\s+market\b)[^$\n]{0,60}?\$[\d,]+(?:\.\d+)?(?:\s*-\s*[\d,]+(?:\.\d+)?)?\s*[BbMmKkTt]?\+?|\$[\d,]+(?:\.\d+)?(?:\s*-\s*[\d,]+(?:\.\d+)?)?\s*[BbMmKkTt]\+?[^$\n]{0,60}?(?:\bTAM\b|\bSAM\b|\bSOM\b|\btotal\s+addressable\s+market\b|\baddressable\s+market\b)/i;

/**
 * TRACTION_SIGNAL: matches "MRR $50K", "ARR $600K",
 * "monthly recurring revenue $50K", "annual recurring revenue $2M".
 */
const TRACTION_PATTERN =
	/(?:\bMRR\b|\bARR\b|\bmonthly\s+recurring\s+revenue\b|\bannual\s+recurring\s+revenue\b)(?:[^$\n]{0,60})?\$[\d,.]+\s*[BMKbmk]?/i;

/**
 * VALUATION_TERMS: matches "valuation", "post-money", "pre-money", "safe cap", "cap".
 */
const VALUATION_PATTERN = /(valuation|post[- ]money|pre[- ]money|safe cap|cap)\b/i;

/**
 * USE_OF_FUNDS: matches "use of funds", "use of proceeds",
 * "allocation of proceeds", "proceeds will be used".
 */
const USE_OF_FUNDS_PATTERN =
	/(use of (funds|proceeds)|allocation of proceeds|proceeds will be used)\b/i;

// ── Data loader ───────────────────────────────────────────────────────────────

/**
 * Extract the best available text from a raw DPU payload object.
 * Prefers payload.page_text over payload.normalized_text.
 * Returns null if neither is present or non-empty.
 */
function extractDpuText(payload: unknown): string | null {
	if (payload === null || typeof payload !== "object") return null;
	const p = payload as Record<string, unknown>;
	const text = typeof p["page_text"] === "string" ? p["page_text"]
		: typeof p["normalized_text"] === "string" ? p["normalized_text"]
		: null;
	return text && text.trim().length > 0 ? text : null;
}

/**
 * Load DPU page texts and evidence snippets for Stage 1 slot extraction.
 * Best-effort: DPU load failure sets dpuLoadFailed=true; all slots become NotComputable.
 */
async function loadInsightSlotInputs(
	pool: Pool,
	dealId: string,
	gateState: GateState
): Promise<InsightSlotInputs> {
	const g3Passed = gateState.results.find((r) => r.gate === "G3")?.passed === true;
	let dpuPages: DpuPage[] = [];
	let evidenceSnippets: EvidenceSnippet[] = [];
	let dpuLoadFailed = false;
	const dpuDiag: DpuDiagnostics = { queryOk: false, rowCount: 0, usablePageCount: 0, sample: "n/a" };
	const allNormEvents: NormalizationEvent[] = [];

	try {
		const { rows } = await pool.query<{ document_id: string; page_index: number; payload: unknown }>(
			`SELECT document_id,
			        page_index,
			        payload
			   FROM public.document_page_understanding
			  WHERE deal_id = $1
			  ORDER BY page_index ASC
			  LIMIT 50`,
			[dealId]
		);
		dpuDiag.queryOk = true;
		dpuDiag.rowCount = rows.length;
		dpuPages = rows
			.map((r) => {
				const raw = extractDpuText(r.payload);
				if (!raw) return null;
				const norm = normalizeForExtraction(raw);
				allNormEvents.push(...norm.events);
				return {
					document_id: r.document_id,
					page_index: r.page_index,
					text: norm.text,
					text_raw: raw,
					norm_events_count: norm.events.length,
				};
			})
			.filter((p): p is DpuPage => p !== null);
		dpuDiag.usablePageCount = dpuPages.length;
		if (dpuPages.length > 0) {
			const first = dpuPages[0]!;
			dpuDiag.sample = `${first.page_index}: ${first.text.slice(0, 120)}`;
		}
	} catch (err) {
		dpuLoadFailed = true;
		dpuDiag.queryOk = false;
		dpuDiag.errorMessage = (err instanceof Error ? err.message : String(err)).slice(0, 300);
		dpuDiag.errorCode = (err as Record<string, unknown>)["code"] as string | undefined;
		console.error(
			JSON.stringify({
				event: "INVESTOR_INSIGHTS_DPU_QUERY_FAILED",
				deal_id: dealId,
				err_code: dpuDiag.errorCode ?? null,
				err_message: dpuDiag.errorMessage ?? null,
			})
		);
	}

	await pool
		.query<{ id: string; claim_text: string | null }>(
			`SELECT id, claim_text FROM public.evidence_items WHERE deal_id = $1::uuid LIMIT 50`,
			[dealId]
		)
		.then(({ rows }) => {
			evidenceSnippets = rows.map((row) => {
				if (!row.claim_text) return { ...row, claim_text_norm: null };
				const norm = normalizeForExtraction(row.claim_text);
				allNormEvents.push(...norm.events);
				return { ...row, claim_text_norm: norm.text };
			});
		})
		.catch(() => {
			// Evidence snippets are supplemental; failure is non-fatal.
		});

	return { dpuPages, evidenceSnippets, dpuLoadFailed, g3Passed, dpuDiag, normEvents: allNormEvents };
}

// ── Slot detectors ───────────────────────────────────────────────────────────

/**
 * Build a stable 8-hex-char evidence ref prefix from a DPU document UUID.
 * Strips hyphens first so the prefix is always drawn from hex digits only.
 */
function dpuEvidenceRef(documentId: string, pageIndex: number): string {
	const prefix = documentId.replace(/-/g, "").slice(0, 8);
	return `dpu:doc:${prefix}:page:${pageIndex}`;
}

function detectInPages(pages: DpuPage[], pattern: RegExp): { snippet: string; ref: string } | null {
	for (const page of pages) {
		const m = pattern.exec(page.text ?? "");
		if (m) {
			return {
				snippet: m[0].slice(0, 80),
				ref: dpuEvidenceRef(page.document_id, page.page_index),
			};
		}
	}
	return null;
}

/**
 * Try DPU pages first; fall back to evidence_items claim_text when DPU yields nothing.
 * Evidence ref format: `evidence:item:<8hex>` (UUID without hyphens, first 8 chars).
 */
function detectInTextSources(
	pattern: RegExp,
	dpuPages: DpuPage[],
	evidenceSnippets: EvidenceSnippet[]
): { snippet: string; ref: string } | null {
	const dpuHit = detectInPages(dpuPages, pattern);
	if (dpuHit) return dpuHit;
	for (const ev of evidenceSnippets) {
		const text = ev.claim_text_norm ?? ev.claim_text ?? "";
		const m = pattern.exec(text);
		if (m) {
			const prefix = ev.id.replace(/-/g, "").slice(0, 8);
			return { snippet: m[0].slice(0, 80), ref: `evidence:item:${prefix}` };
		}
	}
	return null;
}

function evalRaiseTermsSlot(inputs: InsightSlotInputs): SlotResult {
	if (inputs.dpuLoadFailed) {
		return { computable: false, value: null, evidence: null, reasonCode: SLOT_REASON_CODES.DPU_LOAD_FAILED };
	}
	const hit = detectInTextSources(RAISE_PATTERN, inputs.dpuPages, inputs.evidenceSnippets);
	if (hit) {
		return { computable: true, value: hit.snippet, evidence: hit.ref, reasonCode: null };
	}
	return { computable: false, value: null, evidence: null, reasonCode: SLOT_REASON_CODES.NO_RAISE_MENTION };
}

function evalMarketClaimsSlot(inputs: InsightSlotInputs): SlotResult {
	if (inputs.dpuLoadFailed) {
		return { computable: false, value: null, evidence: null, reasonCode: SLOT_REASON_CODES.DPU_LOAD_FAILED };
	}
	const hit = detectInTextSources(MARKET_PATTERN, inputs.dpuPages, inputs.evidenceSnippets);
	if (hit) {
		return { computable: true, value: hit.snippet, evidence: hit.ref, reasonCode: null };
	}
	return { computable: false, value: null, evidence: null, reasonCode: SLOT_REASON_CODES.NO_MARKET_CLAIM_MENTION };
}

function evalTractionSignalSlot(inputs: InsightSlotInputs): SlotResult {
	if (inputs.dpuLoadFailed) {
		return { computable: false, value: null, evidence: null, reasonCode: SLOT_REASON_CODES.DPU_LOAD_FAILED };
	}
	const hit = detectInTextSources(TRACTION_PATTERN, inputs.dpuPages, inputs.evidenceSnippets);
	if (hit) {
		return { computable: true, value: hit.snippet, evidence: hit.ref, reasonCode: null };
	}
	return { computable: false, value: null, evidence: null, reasonCode: SLOT_REASON_CODES.NO_TRACTION_SIGNAL_MENTION };
}

function evalValuationTermsSlot(inputs: InsightSlotInputs): SlotResult {
	if (inputs.dpuLoadFailed) {
		return { computable: false, value: null, evidence: null, reasonCode: SLOT_REASON_CODES.DPU_LOAD_FAILED };
	}
	const hit = detectInTextSources(VALUATION_PATTERN, inputs.dpuPages, inputs.evidenceSnippets);
	if (hit) {
		return { computable: true, value: hit.snippet, evidence: hit.ref, reasonCode: null };
	}
	return { computable: false, value: null, evidence: null, reasonCode: SLOT_REASON_CODES.NO_VALUATION_MENTION };
}

function evalUseOfFundsSlot(inputs: InsightSlotInputs): SlotResult {
	if (inputs.dpuLoadFailed) {
		return { computable: false, value: null, evidence: null, reasonCode: SLOT_REASON_CODES.DPU_LOAD_FAILED };
	}
	const hit = detectInTextSources(USE_OF_FUNDS_PATTERN, inputs.dpuPages, inputs.evidenceSnippets);
	if (hit) {
		return { computable: true, value: hit.snippet, evidence: hit.ref, reasonCode: null };
	}
	return { computable: false, value: null, evidence: null, reasonCode: SLOT_REASON_CODES.NO_USE_OF_FUNDS_MENTION };
}

/** Format a single slot result as a pipe-delimited output line. */
function formatSlotLine(name: string, result: SlotResult): string {
	if (result.computable && result.value !== null && result.evidence !== null) {
		return `${name}: Computable | value="${result.value}" | evidence=${result.evidence} | reason=none`;
	}
	return `${name}: NotComputable | value=none | evidence=none | reason=${result.reasonCode ?? "UNKNOWN"}`;
}

/**
 * Build the insight_slots section from pre-loaded DPU pages + evidence snippets.
 * All slot evaluations are deterministic (regex-only); no LLM calls.
 */
function buildInsightSlotsSection(inputs: InsightSlotInputs): RenderPackage["sections"][number] {
	const slots: Array<{ name: string; result: SlotResult }> = [
		{ name: "raise_terms", result: evalRaiseTermsSlot(inputs) },
		{ name: "market_claims", result: evalMarketClaimsSlot(inputs) },
		{ name: "traction_signal", result: evalTractionSignalSlot(inputs) },
		{ name: "valuation_terms", result: evalValuationTermsSlot(inputs) },
		{ name: "use_of_funds", result: evalUseOfFundsSlot(inputs) },
	];

	const lines = slots.map(({ name, result }) => formatSlotLine(name, result));

	return {
		key: "insight_slots",
		title: "Deterministic Insight Slots",
		kind: "message",
		body: lines.join("\n"),
		fallback: "Insight slot extraction unavailable.",
	};
}

/**
 * Build the DPU diagnostics debug section. Returns null in production or when DPU loaded fine.
 * Shown when query failed (dpuLoadFailed) or when query succeeded but yielded 0 usable pages.
 */
function buildDpuDiagnosticsSection(
	dealId: string,
	diag: DpuDiagnostics
): RenderPackage["sections"][number] | null {
	if (process.env["NODE_ENV"] === "production") return null;
	if (diag.queryOk && diag.usablePageCount > 0) return null;
	const lines = [
		"dev_only: true",
		"table: document_page_understanding",
		`deal_id: ${dealId}`,
		`query_ok: ${diag.queryOk}`,
		`row_count: ${diag.rowCount}`,
		`usable_pages: ${diag.usablePageCount}`,
		`sample: ${diag.sample}`,
		`error_code: ${diag.errorCode ?? "none"}`,
		`error: ${diag.errorMessage ?? "none"}`,
	];
	return {
		key: "debug.dpu_diagnostics",
		title: "Debug \u2014 DPU Diagnostics",
		kind: "message",
		body: lines.join("\n"),
		fallback: "DPU diagnostics unavailable.",
	};
}

/**
 * Build a dev-only signal visibility section showing which pages contain the
 * strongest money and keyword signals for manual debugging of low-DPU-coverage deals.
 * Returns null in production (NODE_ENV === 'production').
 */
function buildSignalVisibilitySection(
	inputs: InsightSlotInputs
): RenderPackage["sections"][number] | null {
	if (process.env["NODE_ENV"] === "production") return null;
	if (inputs.dpuPages.length === 0) return null;

	const MONEY_SIGNAL_RE = /[$€£%]|(?:[KMBT])\b/gi;
	const KEYWORD_RE = /\b(?:raise|raising|raised|valuation|post-money|pre-money|post money|pre money|TAM|SAM|SOM|ARR|MRR|revenue|use of funds|proceeds)\b/gi;

	function scoreAndTop(pages: DpuPage[], re: RegExp): Array<{ page: DpuPage; score: number }> {
		return pages
			.map((page) => {
				const text = page.text ?? "";
				const matches = text.match(new RegExp(re.source, re.flags)) ?? [];
				return { page, score: matches.length };
			})
			.filter((entry) => entry.score > 0)
			.sort((a, b) => b.score - a.score)
			.slice(0, 10);
	}

	const moneyTop = scoreAndTop(inputs.dpuPages, MONEY_SIGNAL_RE);
	const keywordTop = scoreAndTop(inputs.dpuPages, KEYWORD_RE);

	function formatEntry(entry: { page: DpuPage; score: number }): string {
		const ref = dpuEvidenceRef(entry.page.document_id, entry.page.page_index);
		const preview = (entry.page.text ?? "").slice(0, 120).replace(/\r?\n/g, " ");
		return `page=${entry.page.page_index} | ref=${ref} | score=${entry.score} | preview=${preview}`;
	}

	const lines: string[] = ["(dev-only) Omitted in production.", `dpu_page_count: ${inputs.dpuPages.length}`, "--- top money-signal pages ---"];
	if (moneyTop.length === 0) {
		lines.push("none");
	} else {
		lines.push(...moneyTop.map(formatEntry));
	}
	lines.push("--- top keyword pages ---");
	if (keywordTop.length === 0) {
		lines.push("none");
	} else {
		lines.push(...keywordTop.map(formatEntry));
	}

	return {
		key: "debug.signal_visibility",
		title: "Debug \u2014 Signal Visibility",
		kind: "message",
		body: lines.join("\n"),
		fallback: "Signal visibility data unavailable.",
	};
}

/**
 * Dev-only section summarising OCR normalization events collected during data load.
 * Omitted in production and when no transformations occurred.
 */
function buildNormalizationSummarySection(
	inputs: InsightSlotInputs
): RenderPackage["sections"][number] | null {
	if (process.env["NODE_ENV"] === "production") return null;
	if (inputs.normEvents.length === 0) return null;

	const byRule = new Map<string, number>();
	for (const ev of inputs.normEvents) {
		byRule.set(ev.rule, (byRule.get(ev.rule) ?? 0) + 1);
	}
	const ruleLines = Array.from(byRule.entries())
		.sort((a, b) => b[1] - a[1])
		.map(([rule, count]) => `  ${rule}: ${count}`);

	// Sample up to 5 events for quick inspection.
	const samples = inputs.normEvents.slice(0, 5).map(
		(ev) => `  [${ev.rule}] "${ev.before}" → "${ev.after}" | ctx: …${ev.context.slice(0, 60)}…`
	);

	const lines: string[] = [
		"(dev-only) Omitted in production.",
		`total_events: ${inputs.normEvents.length}`,
		"--- events by rule ---",
		...ruleLines,
		"--- samples (first 5) ---",
		...samples,
	];

	return {
		key: "debug.normalization_summary",
		title: "Debug \u2014 OCR Normalization Summary",
		kind: "message",
		body: lines.join("\n"),
		fallback: "Normalization summary unavailable.",
	};
}

/**
 * Return the insight_slots section plus optional DPU diagnostics, signal visibility,
 * and normalization summary sections.
 */
function buildInsightSlotsSections(
	dealId: string,
	inputs: InsightSlotInputs
): Array<RenderPackage["sections"][number]> {
	const slotsSection = buildInsightSlotsSection(inputs);
	const diagSection = buildDpuDiagnosticsSection(dealId, inputs.dpuDiag);
	const signalSection = buildSignalVisibilitySection(inputs);
	const normSection = buildNormalizationSummarySection(inputs);
	const sections: Array<RenderPackage["sections"][number]> = [slotsSection];
	if (diagSection) sections.push(diagSection);
	if (signalSection) sections.push(signalSection);
	if (normSection) sections.push(normSection);
	return sections;
}

// ─── Stage 2: Canonical Fields + Conflicts + Completeness ────────────────────

/**
 * Phase 2 reason codes for canonical sub-field extractors.
 * All UPPER_SNAKE_CASE per reason-code format enforcement.
 */
const P2_REASON = {
	NO_RAISE_AMOUNT_MENTION: "NO_RAISE_AMOUNT_MENTION",
	NO_RAISE_ROUND_MENTION: "NO_RAISE_ROUND_MENTION",
	NO_RAISE_INSTRUMENT_MENTION: "NO_RAISE_INSTRUMENT_MENTION",
	NO_RAISE_CAP_MENTION: "NO_RAISE_CAP_MENTION",
	NO_RAISE_DISCOUNT_MENTION: "NO_RAISE_DISCOUNT_MENTION",
	NO_VALUATION_PRE_MENTION: "NO_VALUATION_PRE_MENTION",
	NO_VALUATION_POST_MENTION: "NO_VALUATION_POST_MENTION",
	NO_VALUATION_SAFE_CAP_MENTION: "NO_VALUATION_SAFE_CAP_MENTION",
	NO_USE_OF_FUNDS_BUCKETS_MENTION: "NO_USE_OF_FUNDS_BUCKETS_MENTION",
	NO_TAM_VALUE_MENTION: "NO_TAM_VALUE_MENTION",
	NO_SAM_VALUE_MENTION: "NO_SAM_VALUE_MENTION",
	NO_SOM_VALUE_MENTION: "NO_SOM_VALUE_MENTION",
	NO_MRR_VALUE_MENTION: "NO_MRR_VALUE_MENTION",
	NO_ARR_VALUE_MENTION: "NO_ARR_VALUE_MENTION",
	NO_REVENUE_VALUE_MENTION: "NO_REVENUE_VALUE_MENTION",
	NO_GROWTH_RATE_MENTION: "NO_GROWTH_RATE_MENTION",
	NO_CUSTOMER_COUNT_MENTION: "NO_CUSTOMER_COUNT_MENTION",
} as const;

// ── Phase 2 sub-field patterns (compile once) ────────────────────────────────

/**
 * Building blocks for currency-aware money fragments.
 *   CURRENCY: "$", "€", "£", or word codes USD / EUR / GBP.
 *   AMOUNT:   digit sequence with optional comma separators and decimal.
 *   SUFFIX:   optional magnitude suffix (K/M/B/T, double-letter MM/BB, or words).
 *   MONEY_FRAGMENT: full currency-amount-suffix token used across all extraction patterns.
 *
 * Examples that MUST match: "$1.5MM", "$6MM", "$800,000", "€5.6M", "EUR 5.6M",
 *                            "£2M", "USD 2.5M", "1.5MM", "$1.5 million"
 */
const CURRENCY       = String.raw`(?:\$|€|£|\bUSD\b|\bEUR\b|\bGBP\b)`;
const AMOUNT         = String.raw`\d{1,3}(?:[,\d]{0,3})*(?:\.\d+)?`;
const SUFFIX         = String.raw`(?:\s*(?:MM|BB|[KMBTkmbt]|thousand|million|billion|trillion)\b)?`;
const MONEY_FRAGMENT = String.raw`${CURRENCY}\s*${AMOUNT}${SUFFIX}`;

/**
 * Wildcard span that refuses to cross another currency token or a newline.
 * Used in patterns that allow free text between a money token and a keyword.
 */
const _NO_CUR = `[^$€£\\n]`;

/**
 * raise_amount: amount anchored to a fundraising verb, round type, or past-tense funding.
 * Form A: "Raising $2M seed", "raise $5M Series A", "seeking $1M"
 * Form B: "$1.5MM raise", "Equity $1.5MM raise on a $6MM Valuation"
 * Form C: "Capital Raise ... $1.5MM"
 * Form D: "$2M seed round", "$3M bridge raise"
 * Form E: "€5.6M raised to date", "EUR 5.6M funded" (money-first, past-tense)
 * Form F: "raised €5.6M", "has raised USD 2.0M to date" (verb-first, past-tense with gap)
 *
 * _NO_CUR prevents wildcard spans from crossing neighbouring currency tokens.
 */
/**
 * RAISE_ANCHOR: full list of word anchors signalling a raise context.
 * Used in Forms A, B, G of RAISE_AMOUNT_PATTERN.
 */
const RAISE_ANCHOR = String.raw`(?:rais(?:e|ing|ed)|seeking|fund(?:ed|ing)?|financ(?:ed|ing)?|invest(?:ment|ing)?|offer(?:ing)?|proceeds|allocation)`;

const RAISE_AMOUNT_PATTERN = new RegExp(
	// Form A: raise/seek/fund/finance/invest/offer verb/noun immediately followed by money
	`${RAISE_ANCHOR}\\s+${MONEY_FRAGMENT}` +
	// Form B: money then raise-word within ~40 chars
	`|${MONEY_FRAGMENT}${_NO_CUR}{0,40}?\\b${RAISE_ANCHOR}\\b` +
	// Form C: label-first — capital raise / round size / ticket size / proceeds / allocation then money
	`|\\b(?:capital\\s+raise|round\\s+size|ticket\\s+size|proceeds|allocation)\\b${_NO_CUR}{0,40}?${MONEY_FRAGMENT}` +
	// Form D: money immediately before a round-type keyword
	`|${MONEY_FRAGMENT}\\s+(?:seed|series\\s+[a-cA-C]|pre[-\\s]seed|bridge)\\s*(?:round|raise|funding)?` +
	// Form E: money first, then past-tense funding phrase within ~60 chars
	`|${MONEY_FRAGMENT}${_NO_CUR}{0,60}?\\b(?:raised(?:\\s+to\\s+date)?|funded|funding\\s+to\\s+date|financed|investment)\\b` +
	// Form F: past-tense funding phrase first, then money within ~60 chars
	`|\\b(?:raised(?:\\s+to\\s+date)?|funded|funding\\s+to\\s+date|financed|investment)\\b${_NO_CUR}{0,60}?${MONEY_FRAGMENT}`,
	"i"
);

/** raise_round: seed, series A/B/C, pre-seed, bridge, angel */
const RAISE_ROUND_PATTERN = /\b(seed|series\s+[a-cA-C]|pre[-\s]seed|bridge|angel)\b/i;

/**
 * raise_instrument: SAFE, convertible note, priced round, equity (round), common/preferred stock.
 * "Equity" alone is treated as Computable (Palm deck format: "Capital Raise. Equity").
 */
const RAISE_INSTRUMENT_PATTERN =
	/\b(SAFE|convertible\s+note|priced\s+round|equity(?:\s+round)?|common(?:\s+(?:stock|equity|shares?))?|preferred(?:\s+(?:stock|equity|shares?))?)\b/i;

/** raise_cap: "cap $X", "valuation cap $X", "SAFE cap $X", "cap of $X" */
const RAISE_CAP_PATTERN =
	/(?:valuation\s+)?cap\s+(?:of\s+)?\$[\d,.]+\s*[BMKbmk]?|\bSAFE\s+cap\s+\$[\d,.]+\s*[BMKbmk]?/i;

/** raise_discount: "X% discount" */
const RAISE_DISCOUNT_PATTERN = /\b(\d+)%\s+discount\b/i;

/** valuation_pre: pre-money valuation with dollar figure */
const VALUATION_PRE_PATTERN =
	/pre[-\s]money\s+(?:valuation\s+)?(?:of\s+|is\s+|at\s+)?\$[\d,.]+\s*[BMKbmk]?/i;

/**
 * valuation_post: post-money valuation with dollar figure, or bare "$XMM Valuation".
 * Form A: "post-money valuation $10M", "post-money $10M"
 * Form B: "$6MM Valuation", "$6MM post-money valuation" (money then "valuation" within ~30 chars)
 * Form C: "valuation $6MM" (valuation keyword then money within ~20 chars)
 */
const VALUATION_POST_PATTERN = new RegExp(
	// Form A: explicit post-money prefix (classic)
	`post[-\\s]money\\s+(?:valuation\\s+)?(?:of\\s+|is\\s+|at\\s+)?${MONEY_FRAGMENT}` +
	// Form B: money then "valuation" keyword within ~30 chars
	`|${MONEY_FRAGMENT}${_NO_CUR}{0,30}?\\bvaluation\\b` +
	// Form C: "valuation" keyword then money within ~20 chars
	`|\\bvaluation\\b${_NO_CUR}{0,20}?${MONEY_FRAGMENT}`,
	"i"
);

/** valuation_safe_cap: standalone "safe cap $X" — does not require raise context */
const VALUATION_SAFE_CAP_PATTERN =
	/safe\s+cap\s+(?:of\s+|is\s+|at\s+)?\$[\d,.]+\s*[BMKbmk]?/i;

/**
 * use_of_funds_buckets: captures use-of-funds section headers plus trailing context.
 * Conservative: requires the header phrase, then grabs up to 200 chars of allocation text.
 */
const USE_OF_FUNDS_BUCKET_PATTERN =
	/(?:use\s+of\s+(?:funds|proceeds)|allocation\s+of\s+proceeds|proceeds\s+will\s+be\s+used)\b[^.]{0,200}/i;

/** tam_value: TAM with explicit dollar amount (Form A + B) */
const TAM_VALUE_PATTERN =
	/(?:\bTAM\b[^$\n]{0,60}?\$[\d,.]+\s*[BbMmKkTt]?|\$[\d,.]+\s*[BbMmKkTt]\+?[^$\n]{0,60}?\bTAM\b)/i;

/** sam_value: SAM with explicit dollar amount */
const SAM_VALUE_PATTERN =
	/(?:\bSAM\b[^$\n]{0,60}?\$[\d,.]+\s*[BbMmKkTt]?|\$[\d,.]+\s*[BbMmKkTt]\+?[^$\n]{0,60}?\bSAM\b)/i;

/** som_value: SOM with explicit dollar amount */
const SOM_VALUE_PATTERN =
	/(?:\bSOM\b[^$\n]{0,60}?\$[\d,.]+\s*[BbMmKkTt]?|\$[\d,.]+\s*[BbMmKkTt]\+?[^$\n]{0,60}?\bSOM\b)/i;

/** mrr_value: MRR keyword with dollar figure within 40 chars */
const MRR_VALUE_PATTERN = /\bMRR\b[^$\n]{0,40}?\$[\d,.]+\s*[BMKbmk]?/i;

/** arr_value: ARR keyword with dollar figure within 40 chars */
const ARR_VALUE_PATTERN = /\bARR\b[^$\n]{0,40}?\$[\d,.]+\s*[BMKbmk]?/i;

/**
 * revenue_value: explicit annual/quarterly/total revenue — conservative to prevent
 * false positives against raise amounts.
 */
const REVENUE_VALUE_PATTERN =
	/(?:annual\s+revenue|quarterly\s+revenue|total\s+revenue)\s+(?:of\s+|is\s+)?\$[\d,.]+\s*[BMKbmk]?/i;

/** growth_rate: "growing X%", "X% MoM/YoY/month over month" */
const GROWTH_RATE_PATTERN =
	/(?:growing|growth(?:\s+rate)?(?:\s+of)?)\s+\d+%|\b\d+%\s+(?:month\s+over\s+month|MoM\b|YoY\b|year\s+over\s+year|annually)/i;

/** customer_count: explicit count followed by customers/users/clients */
const CUSTOMER_COUNT_PATTERN = /\b(\d[\d,]+)\s+(?:customers?|active\s+users?|clients?)\b/i;

// ── Phase 2 types ────────────────────────────────────────────────────────────

interface CanonicalField {
	category: string;
	field: string;
	computability: "Computable" | "NotComputable";
	value: string | null;
	evidenceRef: string | null;
	reasonCode: string | null;
}

interface ConflictEntry {
	field: string;
	valueA: string;
	evidenceA: string;
	valueB: string;
	evidenceB: string;
}

type CompletenessStatus = "Present" | "Missing" | "Conflicting";

interface CompletenessRow {
	category: string;
	status: CompletenessStatus;
}

interface Phase2Result {
	fields: CanonicalField[];
	conflicts: ConflictEntry[];
	completeness: CompletenessRow[];
}

/**
 * Structured inputs for the deterministic investor thesis stub (Phase 3.0).
 * Derived entirely from canonical fields + completeness — no LLM required.
 */
export interface ThesisInputsV1 {
	raise_amount: string | null;
	raise_round: string | null;
	raise_instrument: string | null;
	valuation_pre: string | null;
	valuation_post: string | null;
	tam_value: string | null;
	mrr_value: string | null;
	arr_value: string | null;
	revenue_value: string | null;
	/** Fraction of canonical fields that are Computable (0–1). */
	coverage_ratio: number;
	/** True when at least one cross-page field conflict was detected. */
	conflicts_present: boolean;
	/** Per-category completeness rows from Phase 2. */
	completeness: CompletenessRow[];
}

// ── Phase 2 helpers ──────────────────────────────────────────────────────────

/**
 * Normalize a currency+amount token for conflict deduplication.
 * Handles $, €, £, and word codes USD/EUR/GBP.
 * "$2M" / "$2m" → "$2m"; "$1.5MM" / "$1.5M" → "$1.5m" (no false conflict);
 * "€5.6M" / "EUR 5.6M" → "€5.6m"; "$1.5 million" → "$1.5m".
 */
function normalizeAmountForConflict(s: string): string {
	const m = /(?:[€£$]|EUR|USD|GBP)\s*[\d,]+(?:\.\d+)?(?:\s*(?:MM|BB|[BMKbmkTt]|million|billion|thousand|trillion))?/i.exec(s);
	if (!m) return s.trim().toLowerCase().slice(0, 30);
	return m[0]
		.replace(/\s/g, "")
		.toLowerCase()
		// Normalize word currency codes to their symbol equivalents
		.replace(/^eur/, "€")
		.replace(/^usd/, "\$")
		.replace(/^gbp/, "£")
		// Collapse double-letter magnitude suffixes to single (mm→m, bb→b)
		.replace(/mm$/, "m")
		.replace(/bb$/, "b")
		// Collapse word magnitude suffixes to single letter
		.replace(/million$/, "m")
		.replace(/billion$/, "b")
		.replace(/thousand$/, "k")
		.replace(/trillion$/, "t");
}

/**
 * Compiled form of MONEY_FRAGMENT for use in value-extraction helpers.
 * Captures the first currency+amount+suffix token from a snippet.
 */
const MONEY_RE = new RegExp(MONEY_FRAGMENT, "i");

/**
 * Extract the first clean money token from a matched snippet.
 * "€5.6M raised to date" → "€5.6M"
 * "Equity $1.5MM raise on a $6MM Valuation" → "$1.5MM"
 * "USD 2.0M funded" → "USD 2.0M"
 * Returns null when no currency token is found.
 */
function extractFirstMoney(snippet: string): string | null {
	const m = MONEY_RE.exec(snippet);
	if (!m) return null;
	return m[0].replace(/\s+/g, " ").trim();
}

/** Field names where the value should be a clean money token. */
const AMOUNT_FIELDS = new Set([
	"raise_amount", "raise_cap",
	"valuation_post", "valuation_pre", "valuation_safe_cap",
	"tam_value", "sam_value", "som_value",
	"mrr_value", "arr_value", "revenue_value",
]);

/**
 * Return a clean, presentation-safe value string for a canonical field.
 * - Amount fields: first matched money token only (e.g. "€5.6M", "$1.5MM")
 * - growth_rate: first percentage token (e.g. "20%", "15% MoM")
 * - customer_count: first numeric count token (e.g. "1,200")
 * - All others: trimmed snippet with collapsed whitespace
 *
 * Always strips surrounding quotes and collapses internal whitespace.
 */
function cleanCanonicalValue(field: string, snippet: string): string {
	const base = snippet.replace(/^["']+|["']+$/g, "").replace(/\s+/g, " ").trim();
	if (AMOUNT_FIELDS.has(field)) {
		return extractFirstMoney(base) ?? base;
	}
	if (field === "growth_rate") {
		const m = /\b\d+(?:\.\d+)?%(?:\s*(?:YoY|MoM|month[-\s]over[-\s]month|year[-\s]over[-\s]year|annually))?/i.exec(base);
		return m ? m[0].trim() : base;
	}
	if (field === "customer_count") {
		const m = /\b(\d[\d,]*)\+?(?:\s*(?:customers?|active\s+users?|clients?))?\b/.exec(base);
		return m ? m[0].trim() : base;
	}
	return base;
}

/**
 * Collect ALL first-match results across all pages for conflict detection.
 * Unlike detectInPages (stops at first match), this scans every page.
 */
function detectAllMatchesForConflict(
	pages: DpuPage[],
	pattern: RegExp
): Array<{ snippet: string; ref: string; normalized: string }> {
	return pages.flatMap((page) => {
		const m = pattern.exec(page.text ?? "");
		if (!m) return [];
		const snippet = m[0].slice(0, 80);
		return [{
			snippet,
			ref: dpuEvidenceRef(page.document_id, page.page_index),
			normalized: normalizeAmountForConflict(snippet),
		}];
	});
}

/**
 * Find a conflict: two distinct normalized dollar amounts on different evidence refs.
 * Same page cannot conflict with itself.
 */
function findConflictInMatches(
	fieldName: string,
	matches: Array<{ snippet: string; ref: string; normalized: string }>
): ConflictEntry | null {
	if (matches.length < 2) return null;
	const seen = new Map<string, { snippet: string; ref: string }>();
	for (const m of matches) {
		if (!seen.has(m.normalized)) {
			seen.set(m.normalized, { snippet: m.snippet, ref: m.ref });
		}
	}
	if (seen.size < 2) return null;
	const entries = [...seen.values()];
	const a = entries[0]!;
	const b = entries[1]!;
	if (a.ref === b.ref) return null; // same page — not a cross-page conflict
	return { field: fieldName, valueA: a.snippet, evidenceA: a.ref, valueB: b.snippet, evidenceB: b.ref };
}

/** Evaluate a single canonical sub-field via first-match detection (DPU → evidence fallback). */
function evalCanonicalField(
	category: string,
	field: string,
	pages: DpuPage[],
	evidenceSnippets: EvidenceSnippet[],
	pattern: RegExp,
	reasonCode: string,
	dpuLoadFailed: boolean
): CanonicalField {
	if (dpuLoadFailed) {
		return { category, field, computability: "NotComputable", value: null, evidenceRef: null, reasonCode: SLOT_REASON_CODES.DPU_LOAD_FAILED };
	}
	const hit = detectInTextSources(pattern, pages, evidenceSnippets);
	if (hit) {
		return { category, field, computability: "Computable", value: cleanCanonicalValue(field, hit.snippet), evidenceRef: hit.ref, reasonCode: null };
	}
	return { category, field, computability: "NotComputable", value: null, evidenceRef: null, reasonCode };
}

/**
 * Extract all Phase 2 canonical fields, detect conflicts, and compute per-category completeness.
 * No extra DB calls — reuses the same InsightSlotInputs fetched in Stage 1.
 */
function extractPhase2Result(inputs: InsightSlotInputs): Phase2Result {
	const { dpuPages, evidenceSnippets, dpuLoadFailed } = inputs;
	const fields: CanonicalField[] = [];
	const conflicts: ConflictEntry[] = [];

	// ── Raise Terms ────────────────────────────────────────────────────────────
	// Conflict detection: scan ALL pages to find distinct raise amounts.
	const raiseAmountMatches = dpuLoadFailed
		? []
		: detectAllMatchesForConflict(dpuPages, RAISE_AMOUNT_PATTERN);
	const raiseAmountConflict = findConflictInMatches("raise_amount", raiseAmountMatches);
	if (raiseAmountConflict) conflicts.push(raiseAmountConflict);

	fields.push(evalCanonicalField("raise_terms", "raise_amount", dpuPages, evidenceSnippets, RAISE_AMOUNT_PATTERN, P2_REASON.NO_RAISE_AMOUNT_MENTION, dpuLoadFailed));
	fields.push(evalCanonicalField("raise_terms", "raise_round", dpuPages, evidenceSnippets, RAISE_ROUND_PATTERN, P2_REASON.NO_RAISE_ROUND_MENTION, dpuLoadFailed));
	fields.push(evalCanonicalField("raise_terms", "raise_instrument", dpuPages, evidenceSnippets, RAISE_INSTRUMENT_PATTERN, P2_REASON.NO_RAISE_INSTRUMENT_MENTION, dpuLoadFailed));
	fields.push(evalCanonicalField("raise_terms", "raise_cap", dpuPages, evidenceSnippets, RAISE_CAP_PATTERN, P2_REASON.NO_RAISE_CAP_MENTION, dpuLoadFailed));
	fields.push(evalCanonicalField("raise_terms", "raise_discount", dpuPages, evidenceSnippets, RAISE_DISCOUNT_PATTERN, P2_REASON.NO_RAISE_DISCOUNT_MENTION, dpuLoadFailed));

	// ── Valuation Terms ────────────────────────────────────────────────────────
	fields.push(evalCanonicalField("valuation_terms", "valuation_pre", dpuPages, evidenceSnippets, VALUATION_PRE_PATTERN, P2_REASON.NO_VALUATION_PRE_MENTION, dpuLoadFailed));
	fields.push(evalCanonicalField("valuation_terms", "valuation_post", dpuPages, evidenceSnippets, VALUATION_POST_PATTERN, P2_REASON.NO_VALUATION_POST_MENTION, dpuLoadFailed));
	fields.push(evalCanonicalField("valuation_terms", "valuation_safe_cap", dpuPages, evidenceSnippets, VALUATION_SAFE_CAP_PATTERN, P2_REASON.NO_VALUATION_SAFE_CAP_MENTION, dpuLoadFailed));

	// ── Use of Funds ───────────────────────────────────────────────────────────
	fields.push(evalCanonicalField("use_of_funds", "use_of_funds_buckets", dpuPages, evidenceSnippets, USE_OF_FUNDS_BUCKET_PATTERN, P2_REASON.NO_USE_OF_FUNDS_BUCKETS_MENTION, dpuLoadFailed));

	// ── Market Claims ──────────────────────────────────────────────────────────
	fields.push(evalCanonicalField("market_claims", "tam_value", dpuPages, evidenceSnippets, TAM_VALUE_PATTERN, P2_REASON.NO_TAM_VALUE_MENTION, dpuLoadFailed));
	fields.push(evalCanonicalField("market_claims", "sam_value", dpuPages, evidenceSnippets, SAM_VALUE_PATTERN, P2_REASON.NO_SAM_VALUE_MENTION, dpuLoadFailed));
	fields.push(evalCanonicalField("market_claims", "som_value", dpuPages, evidenceSnippets, SOM_VALUE_PATTERN, P2_REASON.NO_SOM_VALUE_MENTION, dpuLoadFailed));

	// ── Traction Signal ────────────────────────────────────────────────────────
	fields.push(evalCanonicalField("traction_signal", "mrr_value", dpuPages, evidenceSnippets, MRR_VALUE_PATTERN, P2_REASON.NO_MRR_VALUE_MENTION, dpuLoadFailed));
	fields.push(evalCanonicalField("traction_signal", "arr_value", dpuPages, evidenceSnippets, ARR_VALUE_PATTERN, P2_REASON.NO_ARR_VALUE_MENTION, dpuLoadFailed));
	fields.push(evalCanonicalField("traction_signal", "revenue_value", dpuPages, evidenceSnippets, REVENUE_VALUE_PATTERN, P2_REASON.NO_REVENUE_VALUE_MENTION, dpuLoadFailed));
	fields.push(evalCanonicalField("traction_signal", "growth_rate", dpuPages, evidenceSnippets, GROWTH_RATE_PATTERN, P2_REASON.NO_GROWTH_RATE_MENTION, dpuLoadFailed));
	fields.push(evalCanonicalField("traction_signal", "customer_count", dpuPages, evidenceSnippets, CUSTOMER_COUNT_PATTERN, P2_REASON.NO_CUSTOMER_COUNT_MENTION, dpuLoadFailed));

	// ── Completeness ───────────────────────────────────────────────────────────
	const COMPLETENESS_CATEGORIES = [
		"raise_terms",
		"valuation_terms",
		"use_of_funds",
		"market_claims",
		"traction_signal",
	] as const;
	const completeness: CompletenessRow[] = COMPLETENESS_CATEGORIES.map((cat) => {
		const catFields = fields.filter((f) => f.category === cat);
		const hasConflict = conflicts.some((c) => catFields.some((f) => f.field === c.field));
		if (hasConflict) return { category: cat, status: "Conflicting" };
		const hasComputable = catFields.some((f) => f.computability === "Computable");
		return { category: cat, status: hasComputable ? "Present" : "Missing" };
	});

	return { fields, conflicts, completeness };
}

// ── Phase 2 section builders ──────────────────────────────────────────────────

function formatCanonicalFieldLine(f: CanonicalField): string {
	if (f.computability === "Computable" && f.value !== null && f.evidenceRef !== null) {
		return `category=${f.category} | field=${f.field} | computability=Computable | value="${f.value}" | evidence=${f.evidenceRef} | reason=none`;
	}
	return `category=${f.category} | field=${f.field} | computability=NotComputable | value=none | evidence=none | reason=${f.reasonCode ?? "UNKNOWN"}`;
}

function formatConflictLine(c: ConflictEntry): string {
	return `field=${c.field} | value_a="${c.valueA}" | evidence_a=${c.evidenceA} | value_b="${c.valueB}" | evidence_b=${c.evidenceB}`;
}

function buildCanonicalFieldsSection(
	result: Phase2Result
): RenderPackage["sections"][number] {
	const body = result.fields.map(formatCanonicalFieldLine).join("\n");
	return {
		key: "canonical_fields",
		title: "Canonical Fields",
		kind: "message",
		body,
		fallback: "Canonical field extraction unavailable.",
	};
}

function buildConflictsSectionP2(
	result: Phase2Result
): RenderPackage["sections"][number] | null {
	if (result.conflicts.length === 0) return null;
	const body = result.conflicts.map(formatConflictLine).join("\n");
	return {
		key: "conflicts",
		title: "Conflicting Field Values",
		kind: "message",
		body,
		fallback: "No conflicts detected.",
	};
}

function buildCompletenessSummarySection(
	result: Phase2Result
): RenderPackage["sections"][number] {
	const body = result.completeness.map((row) => `${row.category}: ${row.status}`).join("\n");
	return {
		key: "completeness_summary",
		title: "Completeness Summary",
		kind: "message",
		body,
		fallback: "Completeness summary unavailable.",
	};
}

/**
 * Build all Phase 2 sections: canonical_fields, optional conflicts, completeness_summary.
 * Returns 2–3 sections. Reuses pre-fetched InsightSlotInputs — no additional DB calls.
 */
function buildPhase2Sections(
	inputs: InsightSlotInputs
): Array<RenderPackage["sections"][number]> {
	const result = extractPhase2Result(inputs);
	const sections: Array<RenderPackage["sections"][number]> = [];
	sections.push(buildCanonicalFieldsSection(result));
	const conflictsSection = buildConflictsSectionP2(result);
	if (conflictsSection) sections.push(conflictsSection);
	sections.push(buildCompletenessSummarySection(result));
	return sections;
}

// ─── Phase 3.0: Deterministic Investor Thesis Stub ───────────────────────────

/**
 * Map Phase 2 canonical fields and completeness into ThesisInputsV1.
 * Calls extractPhase2Result — pure/cheap (no DB).
 */
function buildThesisInputs(inputs: InsightSlotInputs): ThesisInputsV1 {
	const result = extractPhase2Result(inputs);
	const get = (field: string): string | null =>
		result.fields.find((f) => f.field === field)?.value ?? null;

	const computable = result.fields.filter((f) => f.computability === "Computable").length;
	const total = result.fields.length;
	const coverage_ratio = total > 0 ? computable / total : 0;

	return {
		raise_amount: get("raise_amount"),
		raise_round: get("raise_round"),
		raise_instrument: get("raise_instrument"),
		valuation_pre: get("valuation_pre"),
		valuation_post: get("valuation_post"),
		tam_value: get("tam_value"),
		mrr_value: get("mrr_value"),
		arr_value: get("arr_value"),
		revenue_value: get("revenue_value"),
		coverage_ratio,
		conflicts_present: result.conflicts.length > 0,
		completeness: result.completeness,
	};
}

/**
 * Determine confidence cap based on coverage, conflicts, and missing-category count.
 *
 * Rules (evaluated in order):
 *   1. coverage_ratio < 0.5             → Low
 *   2. ≥3 categories Missing            → Low
 *   3. conflicts_present OR ≥2 Missing  → Moderate ("max" cap: cannot be High)
 *   4. else                             → High
 */
export function computeConfidenceCap(t: ThesisInputsV1): "High" | "Moderate" | "Low" {
	if (t.coverage_ratio < 0.5) return "Low";
	const missingCount = t.completeness.filter((c) => c.status === "Missing").length;
	if (missingCount >= 3) return "Low";
	if (t.conflicts_present || missingCount >= 2) return "Moderate";
	return "High";
}

/** Deterministic open question for each Missing completeness category. */
const THESIS_OPEN_QUESTIONS: Record<string, string> = {
	raise_terms:    "What is the target raise amount, round type, and instrument?",
	valuation_terms: "What is the pre/post-money valuation or SAFE cap?",
	use_of_funds:   "How will the proceeds be allocated across the business?",
	market_claims:  "What is the total addressable market (TAM) and target segment size?",
	traction_signal: "What are the current revenue or MRR/ARR metrics and customer count?",
};

/**
 * Build the investor_thesis section — a deterministic stub derived from Phase 2 data.
 * Present in deterministic_only packages only; no LLM required.
 */
export function buildInvestorThesisStubSection(
	thesisInputs: ThesisInputsV1
): RenderPackage["sections"][number] {
	const cap = computeConfidenceCap(thesisInputs);

	const disclosureLines = thesisInputs.completeness.map(
		(c) => `  ${c.category}: ${c.status}`
	);

	const missingCategories = thesisInputs.completeness
		.filter((c) => c.status === "Missing")
		.map((c) => c.category);

	const openQuestionLines = missingCategories.map(
		(cat) => `  - ${THESIS_OPEN_QUESTIONS[cat] ?? `No data available for ${cat}.`}`
	);

	const lines: string[] = [
		`Confidence Cap: ${cap}`,
		"Disclosure Summary:",
		...disclosureLines,
	];

	if (openQuestionLines.length > 0) {
		lines.push("Open Questions:");
		lines.push(...openQuestionLines);
	}

	return {
		key: "investor_thesis",
		title: "Investor Thesis (Deterministic Stub)",
		kind: "message",
		body: lines.join("\n"),
		fallback: "Investor thesis stub unavailable.",
	};
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
async function buildG3DiagnosticsSection(
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

// ─── Render package builder ───────────────────────────────────────────────────

function buildRenderPackage(opts: {
	dealId: string;
	status: RenderPackage["status"];
	gateState: GateState;
	complianceState: ComplianceState;
	upstreamFingerprint: string;
	engineVersion: string;
	sections: RenderPackage["sections"];
}): RenderPackage {
	return {
		render_version: "ui_contract_v1",
		ui_contract_version: VERSION_PINS.ui_contract_version,
		engine_version: opts.engineVersion,
		schema_version: VERSION_PINS.schema_version,
		governance_version: VERSION_PINS.governance_version,
		constitution_version: VERSION_PINS.constitution_version,
		deal_id: opts.dealId,
		upstream_fingerprint: opts.upstreamFingerprint,
		status: opts.status,
		gate_state: opts.gateState,
		compliance_state: opts.complianceState,
		sections: opts.sections,
		no_empty_blocks: true,
		audit_footer: {
			stage: "stage_0",
			generated_at: new Date().toISOString(),
			engine_version: opts.engineVersion,
			schema_version: VERSION_PINS.schema_version,
			governance_version: VERSION_PINS.governance_version,
			constitution_version: VERSION_PINS.constitution_version,
		},
	};
}

// ─── Persistence ──────────────────────────────────────────────────────────────

async function persistReport(
	pool: Pool,
	opts: {
		dealId: string;
		engineVersion: string;
		upstreamFingerprint: string;
		status: string;
		gateState: GateState;
		complianceState: ComplianceState;
		renderPackage: RenderPackage;
		auditLog: unknown[];
	}
): Promise<string> {
	// ── Debug: log DB context once per call ─────────────────────────────────
	const { rows: dbCtxRows } = await pool.query<{ db: string; schema: string }>(
		"SELECT current_database() AS db, current_schema() AS schema"
	);
	console.log(
		JSON.stringify({
			event: "INVESTOR_INSIGHTS_DB_CONTEXT",
			db: dbCtxRows[0]?.db ?? null,
			schema: dbCtxRows[0]?.schema ?? null,
			deal_id: opts.dealId,
			ts: new Date().toISOString(),
		})
	);

	// ── Debug: log attempt before insert ────────────────────────────────────
	console.log(
		JSON.stringify({
			event: "INVESTOR_INSIGHTS_PERSIST_ATTEMPT",
			deal_id: opts.dealId,
			engine_version: opts.engineVersion,
			status: opts.status,
			upstream_fingerprint: opts.upstreamFingerprint,
			ts: new Date().toISOString(),
		})
	);

	let insertedId: string;
	try {
		const { rows } = await pool.query<{ id: string }>(
			`INSERT INTO public.investor_insight_reports
			   (deal_id, engine_version, upstream_fingerprint, status,
			    gate_state, compliance_state, render_package, report_payload, audit_log)
			 VALUES
			   ($1::uuid, $2::text, $3::text, $4::text,
			    $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb)
			 ON CONFLICT (deal_id, engine_version, upstream_fingerprint) DO UPDATE
			   SET status            = EXCLUDED.status,
			       gate_state        = EXCLUDED.gate_state,
			       compliance_state  = EXCLUDED.compliance_state,
			       render_package    = EXCLUDED.render_package,
			       audit_log         = EXCLUDED.audit_log,
			       updated_at        = now()
			 RETURNING id`,
			[
				opts.dealId,
				opts.engineVersion,
				opts.upstreamFingerprint,
				opts.status,
				JSON.stringify(opts.gateState),
				JSON.stringify(opts.complianceState),
				JSON.stringify(opts.renderPackage),
				JSON.stringify({}), // report_payload reserved for Stage 1+
				JSON.stringify(opts.auditLog),
			]
		);
		insertedId = rows[0]?.id ?? "";
	} catch (err) {
		const pgErr = err as Record<string, unknown>;
		console.error(
			JSON.stringify({
				event: "INVESTOR_INSIGHTS_PERSIST_ERROR",
				deal_id: opts.dealId,
				engine_version: opts.engineVersion,
				status: opts.status,
				upstream_fingerprint: opts.upstreamFingerprint,
				err_code: typeof pgErr["code"] === "string" ? pgErr["code"] : null,
				err_message: err instanceof Error ? err.message : String(err),
				err_detail: typeof pgErr["detail"] === "string" ? pgErr["detail"] : null,
				err_constraint: typeof pgErr["constraint"] === "string" ? pgErr["constraint"] : null,
				stack: err instanceof Error ? err.stack : null,
				ts: new Date().toISOString(),
			})
		);
		throw err;
	}

	// ── Debug: log success after insert ─────────────────────────────────────
	console.log(
		JSON.stringify({
			event: "INVESTOR_INSIGHTS_PERSIST_OK",
			deal_id: opts.dealId,
			engine_version: opts.engineVersion,
			status: opts.status,
			upstream_fingerprint: opts.upstreamFingerprint,
			inserted_id: insertedId,
			ts: new Date().toISOString(),
		})
	);

	return insertedId;
}

// ─── Main processor ───────────────────────────────────────────────────────────

export async function generateInvestorInsightsProcessor(job: Job): Promise<unknown> {
	const rawData = job.data ?? {};

	// ── 1. Parse and validate job payload ──────────────────────────────────────
	let parsed: ReturnType<typeof InvestorInsightsJobSchema.parse>;
	try {
		parsed = InvestorInsightsJobSchema.parse(rawData);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error(
			JSON.stringify({ event: "INVESTOR_INSIGHTS_JOB_PARSE_ERROR", job_id: job.id, error: msg })
		);
		throw err;
	}

	const {
		deal_id: dealId,
		engine_version: engineVersion,
		force_recompute: forceRecompute = false,
		triggered_by: triggeredBy,
	} = parsed;

	console.log(
		JSON.stringify({
			event: "INVESTOR_INSIGHTS_STAGE0_START",
			deal_id: dealId,
			engine_version: engineVersion,
			force_recompute: forceRecompute,
			triggered_by: triggeredBy ?? null,
			ts: new Date().toISOString(),
		})
	);

	const pool = getPool();

	// ── 2. Evaluate gates G0–G5 ───────────────────────────────────────────────
	const rawGateState = await evaluateGates(pool, { dealId, engineVersion });

	// Schema-validate gate state; log on failure but continue (fail-closed doctrine)
	let gateState: GateState;
	try {
		gateState = validateGateState(rawGateState);
	} catch (err) {
		console.error(
			JSON.stringify({
				event: "INVESTOR_INSIGHTS_GATE_STATE_SCHEMA_INVALID",
				reason_code: "SCHEMA_GATE_STATE_INVALID",
				deal_id: dealId,
				error: err instanceof Error ? err.message : String(err),
			})
		);
		// Best-effort: use raw value; GateStateSchema failure is a schema issue not a blocker
		gateState = rawGateState;
	}

	const complianceState = buildComplianceState();

	// ── 3. Gates failed → fail-soft (G3-only) or fail-closed (all others) ───────
	if (!gateState.all_passed) {
		const failedGates = gateState.results.filter((r) => !r.passed);

		// Fail-soft reason codes: structural/readability failures → deterministic_only.
		// QUERY_FAILED is intentionally excluded (DB failure → fail-closed).
		const G3_FAIL_SOFT_CODES = new Set([
			"GATE_STRUCTURED_JSON_MISSING",
			"GATE_STRUCTURED_JSON_PARSE_FAILED",
			"GATE_STRUCTURED_JSON_SCHEMA_MISMATCH",
		]);

		// Fail-soft: only G3 failed AND the reason is a soft code → deterministic_only.
		const g3OnlyFail =
			failedGates.length === 1 &&
			failedGates[0]?.gate === "G3" &&
			G3_FAIL_SOFT_CODES.has(failedGates[0]?.reason_code ?? "");

		const persistStatus = g3OnlyFail ? "deterministic_only" : "failed";
		const logEvent = g3OnlyFail
			? "INVESTOR_INSIGHTS_G3_FAIL_SOFT"
			: "INVESTOR_INSIGHTS_ENQUEUE_BLOCKED";

		console.log(
			JSON.stringify({
				event: logEvent,
				deal_id: dealId,
				engine_version: engineVersion,
				failed_gates: failedGates.map((g) => ({ gate: g.gate, reason_code: g.reason_code })),
				ts: new Date().toISOString(),
			})
		);

		const fallbackFp = buildFallbackFingerprint(dealId, engineVersion);
		const [coverage, insightSlotInputs] = await Promise.all([
			loadCoverageSnapshot(pool, dealId),
			loadInsightSlotInputs(pool, dealId, gateState),
		]);
		const insightSlotsSections = buildInsightSlotsSections(dealId, insightSlotInputs);
		const phase2Sections = buildPhase2Sections(insightSlotInputs);
		const thesisSection = g3OnlyFail
			? buildInvestorThesisStubSection(buildThesisInputs(insightSlotInputs))
			: null;
		const sections = g3OnlyFail
			? buildG3OnlyFailSections(gateState, coverage, insightSlotsSections, phase2Sections, thesisSection)
			: buildGateFailedSections(gateState, coverage, insightSlotsSections, phase2Sections);

		// Append diagnostics for any structural G3 failure (QUERY_FAILED is excluded
		// since it indicates a DB problem, not a readability one).
		const G3_DIAG_CODES = new Set([
			"GATE_STRUCTURED_JSON_MISSING",
			"GATE_STRUCTURED_JSON_PARSE_FAILED",
			"GATE_STRUCTURED_JSON_SCHEMA_MISMATCH",
		]);
		const g3Result = gateState.results.find(
			(r) => r.gate === "G3" && !r.passed && G3_DIAG_CODES.has(r.reason_code ?? "")
		);
		if (g3Result) {
			const diagSection = await buildG3DiagnosticsSection(pool, dealId);
			if (diagSection) sections.push(diagSection);
		}

		const renderPackage = buildRenderPackage({
			dealId,
			status: persistStatus,
			gateState,
			complianceState,
			upstreamFingerprint: fallbackFp,
			engineVersion,
			sections,
		});

		// Validate render package; log on failure but always persist (fail-closed)
		let validatedPkg = renderPackage;
		try {
			validatedPkg = validateRenderPackage(renderPackage);
			validateNoEmptyBlocks(validatedPkg);
		} catch (err) {
			console.error(
				JSON.stringify({
					event: "INVESTOR_INSIGHTS_RENDER_PKG_INVALID",
					reason_code: "SCHEMA_RENDER_PACKAGE_INVALID",
					deal_id: dealId,
					error: err instanceof Error ? err.message : String(err),
				})
			);
		}

		const auditLog = [
			{
				stage: "stage_0",
				event: logEvent,
				failed_gates: failedGates.map((g) => ({ gate: g.gate, reason_code: g.reason_code })),
				g3_only_fail_soft: g3OnlyFail,
				engine_version: engineVersion,
				constitution_version: VERSION_PINS.constitution_version,
				schema_version: VERSION_PINS.schema_version,
				governance_version: VERSION_PINS.governance_version,
				ui_contract_version: VERSION_PINS.ui_contract_version,
				ts: new Date().toISOString(),
			},
		];

		const reportId = await persistReport(pool, {
			dealId,
			engineVersion,
			upstreamFingerprint: fallbackFp,
			status: persistStatus,
			gateState,
			complianceState,
			renderPackage: validatedPkg,
			auditLog,
		});

		return {
			ok: true,
			status: persistStatus,
			report_id: reportId,
			failed_gates: failedGates.map((g) => g.gate),
		};
	}

	// ── 4. Gates passed: compute upstream fingerprint ─────────────────────────
	const upstream = await loadUpstreamSnapshot(pool, dealId);

	let upstreamFingerprint: string;
	try {
		upstreamFingerprint = buildDeterministicFingerprint({
			dealId,
			engineVersion,
			...upstream,
		});
	} catch (err) {
		console.error(
			JSON.stringify({
				event: "INVESTOR_INSIGHTS_FP_FAILED",
				reason_code: "FP_HASH_FAILED",
				deal_id: dealId,
				error: err instanceof Error ? err.message : String(err),
			})
		);
		upstreamFingerprint = buildFallbackFingerprint(dealId, engineVersion);
	}

	// ── 5. Dedup index check ──────────────────────────────────────────────────
	if (!forceRecompute) {
		try {
			const { rows } = await pool.query<{ id: string; status: string }>(
				`SELECT id, status
				   FROM public.investor_insight_reports
				  WHERE deal_id = $1::uuid
				    AND engine_version = $2::text
				    AND upstream_fingerprint = $3::text
				  LIMIT 1`,
				[dealId, engineVersion, upstreamFingerprint]
			);
			if (rows[0]) {
				console.log(
					JSON.stringify({
						event: "INVESTOR_INSIGHTS_DEDUP_HIT",
						reason_code: "FP_IDEMPOTENT_HIT_SKIP",
						deal_id: dealId,
						engine_version: engineVersion,
						upstream_fingerprint: upstreamFingerprint,
						existing_report_id: rows[0].id,
						existing_status: rows[0].status,
						ts: new Date().toISOString(),
					})
				);
				return {
					ok: true,
					status: "dedup_skip",
					reason_code: "FP_IDEMPOTENT_HIT_SKIP",
					report_id: rows[0].id,
				};
			}
		} catch {
			// Dedup check is best-effort; failure must not block downstream work
		}
	}

	// ── 6. Persist deterministic-only render package ──────────────────────────
	const [coverage, insightSlotInputs] = await Promise.all([
		loadCoverageSnapshot(pool, dealId),
		loadInsightSlotInputs(pool, dealId, gateState),
	]);
	const insightSlotsSections = buildInsightSlotsSections(dealId, insightSlotInputs);
	const phase2Sections = buildPhase2Sections(insightSlotInputs);
	const thesisSection = buildInvestorThesisStubSection(buildThesisInputs(insightSlotInputs));
	const sections = buildDeterministicOnlySections(gateState, coverage, insightSlotsSections, phase2Sections, thesisSection);
	const renderPackage = buildRenderPackage({
		dealId,
		status: "deterministic_only",
		gateState,
		complianceState,
		upstreamFingerprint,
		engineVersion,
		sections,
	});

	let validatedPkg = renderPackage;
	try {
		validatedPkg = validateRenderPackage(renderPackage);
		validateNoEmptyBlocks(validatedPkg);
	} catch (err) {
		console.error(
			JSON.stringify({
				event: "INVESTOR_INSIGHTS_RENDER_PKG_INVALID",
				reason_code: "SCHEMA_RENDER_PACKAGE_INVALID",
				deal_id: dealId,
				error: err instanceof Error ? err.message : String(err),
			})
		);
	}

	const auditLog = [
		{
			stage: "stage_0",
			event: "INVESTOR_INSIGHTS_STAGE0_COMPLETE",
			upstream_fingerprint: upstreamFingerprint,
			dpu_count: upstream.dpuCount,
			dpu_coverage: upstream.dpuCoverage,
			evidence_count: upstream.evidenceCount,
			visual_asset_count: upstream.visualAssetCount,
			overlay_exists: upstream.overlayExists,
			engine_version: engineVersion,
			constitution_version: VERSION_PINS.constitution_version,
			schema_version: VERSION_PINS.schema_version,
			governance_version: VERSION_PINS.governance_version,
			ui_contract_version: VERSION_PINS.ui_contract_version,
			ts: new Date().toISOString(),
		},
	];

	const reportId = await persistReport(pool, {
		dealId,
		engineVersion,
		upstreamFingerprint,
		status: "deterministic_only",
		gateState,
		complianceState,
		renderPackage: validatedPkg,
		auditLog,
	});

	console.log(
		JSON.stringify({
			event: "INVESTOR_INSIGHTS_STAGE0_COMPLETE",
			deal_id: dealId,
			engine_version: engineVersion,
			upstream_fingerprint: upstreamFingerprint,
			report_id: reportId,
			dpu_count: upstream.dpuCount,
			dpu_coverage: upstream.dpuCoverage,
			evidence_count: upstream.evidenceCount,
			ts: new Date().toISOString(),
		})
	);

	return {
		ok: true,
		status: "deterministic_only",
		report_id: reportId,
		upstream_fingerprint: upstreamFingerprint,
	};
}
