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
import {
	fuseDealCanonicalFacts,
	buildDealFusionSection,
	type FusedFact,
} from "./deal-fusion";
import {
	parseFinancialStatementV1,
	pickBestStatement,
	formatRevenueSeries,
	formatYoY,
	formatCAGR,
	formatGrossMargin,
	type FinancialStatementV1,
} from "../../lib/financial-statement-parser.js";
import { deriveFinancialFactsV1, type FinancialFactsV1 } from "../../lib/financial-facts-v1.js";
import {
	parseUseOfFundsV1,
	pickBestUseOfFunds,
	type UseOfFundsV1,
} from "../../lib/use-of-funds-parser-v1.js";
import {
	parseImpliedCapitalAllocationV1,
	type ImpliedCapitalAllocationV1,
} from "../../lib/implied-capital-allocation-v1.js";
import { parseUseOfFundsTimeseriesV1 } from "../../lib/use-of-funds-timeseries-v1.js";
import {
	parseImpliedCapitalIncomeStatementV1,
	type IncomeStatementAllocationV1,
} from "../../lib/implied-capital-income-statement-v1.js";
import {
	classifyDealLayouts,
	type DealLayoutClassificationV1,
} from "../../lib/financial-layout-classifier-v1.js";
import {
	reconcileFinancialsV1,
	type FinancialReconciliationV1,
} from "../../lib/financial-reconciliation-v1.js";
import {
	parseBalanceSheetV1,
	pickBestBalanceSheet,
	type BalanceSheetV1,
} from "../../lib/balance-sheet-parser-v1.js";
import {
	parseCashFlowStatementV1,
	pickBestCashFlow,
	type CashFlowStatementV1,
} from "../../lib/cash-flow-parser-v1.js";
import {
	parseCapTableV1,
	pickBestCapTable,
	type CapTableV1,
} from "../../lib/cap-table-parser-v1.js";
import {
	parseSaasKpisV1,
	pickBestSaasKpis,
	type SaasKpisV1,
} from "../../lib/saas-kpis-parser-v1.js";
import {
	parseBankTransactionsV1,
	type BankTransactionsV1,
} from "../../lib/bank-transactions-parser-v1.js";
import {
	extractDeckFinancialSignalsV1,
	type DeckFinancialSignalsV1,
} from "../../lib/deck-financial-signals-v1.js";
import {
	generateGovernedSummaryV1,
	serializeGovernedSummaryBody,
	resolveGovernedSummaryWithCache,
	type GovernedSummaryRecord,
} from "./governed-summary-v1";
import {
	resolveGovernedExecSummaryWithCache,
	serializeGovernedExecSummaryBody,
	formatCoverageNote,
	type GovernedExecutiveSummaryRecord,
} from "./governed-executive-summary-v1";
import {
	generateProductProfileV1,
	serializeProductProfileBody,
} from "./product-profile-v1";
import { buildFinancialFactRegistryV1 } from "../../lib/build-financial-fact-registry-v1.js";
import { upsertFinancialFactsV1 } from "../../lib/db/financial-facts-db.js";

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

// ─── Deal name loader ─────────────────────────────────────────────────────────

/**
 * Load the human-readable deal name from the deals table.
 * Best-effort: returns null on any error rather than blocking the processor.
 * Used to anchor the LLM to use the real company name instead of placeholders.
 */
async function loadDealName(pool: Pool, dealId: string): Promise<string | null> {
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

// ─── Product narrative builder ────────────────────────────────────────────────

/**
 * Build a product narrative body from non-financial DPU deck pages.
 *
 * Filters deck pages (excluding heavy financial tables) for pages that
 * contain product/value-proposition keywords. Returns up to ~800 chars of
 * context for the LLM to draw company identity and product description from.
 *
 * Returns null when no suitable pages are found (e.g. XLSX-only deals).
 */
function buildProductNarrativeBody(inputs: InsightSlotInputs): string | null {
	const PRODUCT_KW_RE =
		/\b(?:product|platform|solution|technology|we\s+(?:help|build|provide|enable|serve|power)|our\s+(?:platform|product|solution|technology|tool|software)|problem|pain\s+point|customers?|users?|clients?|mission|vision|founded|raises?|builds?)\b/i;
	const MAX_CHARS = 800;
	const productParts: string[] = [];
	let totalLen = 0;

	for (const page of inputs.dpuPages) {
		const text = page.text ?? "";
		// Skip pages that look like financial tables (high density of money tokens)
		const moneyCount = (text.match(/\$[\d,]/g) ?? []).length;
		const totalWords = text.split(/\s+/).filter(Boolean).length;
		if (totalWords > 0 && moneyCount / totalWords >= 0.12) continue;
		if (!PRODUCT_KW_RE.test(text)) continue;
		const excerpt = text.slice(0, 500).replace(/\s+/g, " ").trim();
		if (!excerpt || excerpt.length < 30) continue;
		productParts.push(excerpt);
		totalLen += excerpt.length;
		if (totalLen >= MAX_CHARS) break;
	}

	if (productParts.length === 0) return null;
	return productParts.join("\n\n").slice(0, MAX_CHARS);
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
		`evidence_count: ${coverage.evidenceCount}`,
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
function normMetricsFromInputs(inputs: InsightSlotInputs): { normalizationEvents: number; normalizedPages: number } {
	return {
		normalizationEvents: inputs.normEvents.length,
		normalizedPages: inputs.dpuPages.filter((p) => p.norm_events_count > 0).length,
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
function buildDeterministicOnlySections(
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
function buildG3OnlyFailSections(
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
	/** Slot was promoted from XLSX-derived financial facts (not text patterns). */
	DERIVED_FROM_FINANCIALS: "DERIVED_FROM_FINANCIALS",
	/** Slot was promoted from a parsed Use-of-Funds XLSX section (not text patterns). */
	DERIVED_FROM_USE_OF_FUNDS: "DERIVED_FROM_USE_OF_FUNDS",
	/** Slot was promoted from an operational budget model (implied allocation — not stated raise). */
	DERIVED_FROM_BUDGET_MODEL: "DERIVED_FROM_BUDGET_MODEL",
	/** Slot was promoted from an income-statement expense breakdown (implied allocation — not stated raise). */
	DERIVED_FROM_INCOME_STATEMENT: "DERIVED_FROM_INCOME_STATEMENT",
	/** Phase 2 canonical field derived from SaaS KPI XLSX data. */
	DERIVED_FROM_SAAS_KPI: "DERIVED_FROM_SAAS_KPI",
	/** Phase 2 canonical field derived from balance sheet XLSX data. */
	DERIVED_FROM_BALANCE_SHEET: "DERIVED_FROM_BALANCE_SHEET",
	/** Phase 2 canonical field derived from cash flow XLSX data. */
	DERIVED_FROM_CASH_FLOW: "DERIVED_FROM_CASH_FLOW",
	/** Phase 2 canonical field derived from cap table XLSX data. */
	DERIVED_FROM_CAP_TABLE: "DERIVED_FROM_CAP_TABLE",
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
	/** Financial statements parsed from XLSX DPU payloads (excel_range pages). */
	financialStatements: FinancialStatementV1[];
	/** Best-selected financial statement across all XLSX documents, or null if none found. */
	bestFinancialStatement: FinancialStatementV1 | null;
	/** Use-of-Funds statements parsed from XLSX DPU payloads. */
	useOfFundsStatements: UseOfFundsV1[];
	/** Best-selected Use-of-Funds statement, or null if none found. */
	bestUseOfFundsStatement: UseOfFundsV1 | null;
	/**
	 * Implied capital allocation derived from Budget/Employee Costs XLSX sheets.
	 * Present only for deals where no explicit Use-of-Funds exists but budget model sheets are available.
	 */
	impliedCapitalAllocation: ImpliedCapitalAllocationV1 | null;
	/**
	 * Implied capital allocation derived from an income-statement expense breakdown.
	 * 3rd-level fallback; only used when both UoF parser and budget model are absent.
	 */
	impliedFromIncomeStatement: IncomeStatementAllocationV1 | null;
	/**
	 * Deterministic financial layout classification for all XLSX pages in this deal.
	 * Used to route parsers and build the financial_layout_classifier_v1 section.
	 */
	financialLayoutClassification: DealLayoutClassificationV1 | null;
	/**
	 * Deterministic cross-check reconciliation of revenue, expense, allocation,
	 * and raise data.  Built after all parsers have run.
	 */
	financialReconciliation: FinancialReconciliationV1 | null;
	// Phase K: new parsed financial document types
	balanceSheet:  BalanceSheetV1 | null;
	cashFlow:      CashFlowStatementV1 | null;
	capTable:      CapTableV1 | null;
	saasKpis:      SaasKpisV1 | null;
	bankTransactions: BankTransactionsV1 | null;
	/**
	 * Deck-derived financial signal mentions extracted from pitch-deck DPU text.
	 * Present for PDF/PPT-only deals; null when no financial mentions found.
	 */
	deckFinancialSignals: DeckFinancialSignalsV1 | null;
}

// ── Slot detection patterns (compile once) ───────────────────────────────────

/**
 * MARKET_CLAIMS: matches both keyword-first and dollar-first forms:
 *   Form A (keyword → $): "TAM $10B", "total addressable market $10B"
 *   Form B ($ → keyword): "$10.5B+ TAM", "$600-900M TAM SAM SOM"
 *   Form C (market size → $): "Market Sizes (USD) $212B"
 *   Form D ($ → market size): "$212B ... Market Sizes (USD)"
 *
 * Amount format: $<digits>[,<digits>][.<digits>][-<range>][K|M|B|T][+]
 * Anchor tokens: TAM, SAM, SOM, "total addressable market", "addressable market",
 *                "market size[s]"
 * Added Forms C+D on 20260225 (detector_gap=7, Carmoola evidence: "$212B Market Sizes").
 */
const MARKET_PATTERN =
	/(?:\bTAM\b|\bSAM\b|\bSOM\b|\btotal\s+addressable\s+market\b|\baddressable\s+market\b)[^$\n]{0,60}?\$[\d,]+(?:\.\d+)?(?:\s*-\s*[\d,]+(?:\.\d+)?)?\s*[BbMmKkTt]?\+?|\$[\d,]+(?:\.\d+)?(?:\s*-\s*[\d,]+(?:\.\d+)?)?\s*[BbMmKkTt]\+?[^$\n]{0,60}?(?:\bTAM\b|\bSAM\b|\bSOM\b|\btotal\s+addressable\s+market\b|\baddressable\s+market\b)|\bmarket\s+size[s]?\b[^$\n]{0,80}?\$[\d,]+(?:\.\d+)?(?:\s*-\s*[\d,]+(?:\.\d+)?)?\s*[BbMmKkTt]?\+?|\$[\d,]+(?:\.\d+)?(?:\s*-\s*[\d,]+(?:\.\d+)?)?\s*[BbMmKkTt]\+?[^$\n]{0,80}?\bmarket\s+size[s]?\b/i;

/**
 * TRACTION_SIGNAL: matches "MRR $50K", "ARR $600K",
 * "monthly recurring revenue $50K", "annual recurring revenue $2M".
 */
const TRACTION_PATTERN =
	/(?:\bMRR\b|\bARR\b|\bmonthly\s+recurring\s+revenue\b|\bannual\s+recurring\s+revenue\b)(?:[^$\n]{0,60})?\$[\d,.]+\s*[BMKbmk]?/i;

/**
 * TRACTION_PCT_PATTERN: matches percentage-based traction claims that don't
 * carry a dollar amount. Anchored to recognised traction metric keywords so
 * that non-traction percentages (e.g. "30% allocation", "50% equity stake")
 * are excluded.
 *
 * Keyword-first forms (kw → %):
 *   "demo-to-close 50%", "retention ratio of 60%", "churn rate 5%",
 *   "lift 20–300%", "win rate 40%", "NPS 72"
 * Percent-first forms (% → kw):
 *   "50% demo-to-close", "20% churn", "300% lift"
 *
 * PCT_VALUE: supports plain integers, decimals, and ranges (20–300%, 5-10%).
 */
const _TRACTION_PCT_KW = String.raw`(?:demo[- ]to[- ]close|close\s+rate|conversion\s+rate?|retention(?:\s+(?:ratio|rate))?|churn(?:\s+rate)?|lift|engagement(?:\s+rate)?|activation(?:\s+rate)?|nps\b|net\s+promoter|upsell(?:\s+rate)?|win\s+rate)`;
const _PCT_VALUE = String.raw`\d+(?:\.\d+)?(?:\s*[–\-]\s*\d+(?:\.\d+)?)?\s*%`;
const TRACTION_PCT_PATTERN = new RegExp(
	// keyword → % (up to 60 chars of non-newline between them)
	`\\b${_TRACTION_PCT_KW}\\b[^\\n]{0,60}?${_PCT_VALUE}` +
	// % → keyword (up to 60 chars between them)
	`|${_PCT_VALUE}[^\\n]{0,60}?\\b${_TRACTION_PCT_KW}\\b`,
	"i"
);

/**
 * VALUATION_TERMS: matches "valuation", "post-money", "pre-money", "safe cap", "cap".
 */
const VALUATION_PATTERN = /(valuation|post[- ]money|pre[- ]money|safe cap|cap)\b/i;

/**
 * USE_OF_FUNDS: matches investor-deck phrases that signal a use-of-funds section.
 *
 * Original forms:
 *   "use of funds", "use of proceeds", "allocation of proceeds",
 *   "proceeds will be used"
 *
 * Added (audit-evidence driven — 20260225 coverage baseline, detector_gap=8):
 *   Form U1: "use of capital"          — common slide-header variant (e.g. "Use of Capital")
 *   Form U2: "allocation of funds"     — e.g. "allocation of funds: 40% marketing, 30% R&D"
 *   Form U3: "capital allocation"      — repeated pattern in Palm / Palm3 decks:
 *                                         "CAPITAL ALLOCATION", "Capital Allocation Detail"
 *   Form U4: "funds will be (used|deployed|allocated)" — conservative verb-phrase form
 *
 * Conservative anchoring: all new forms are compound keyword phrases unlikely to appear
 * in non-use-of-funds contexts (e.g. "capital allocation" on an investor pitch always
 * refers to deployment of raise proceeds, not cap-structure or equity).
 */
const USE_OF_FUNDS_PATTERN =
	/(?:use\s+of\s+(?:funds|proceeds|capital)|allocation\s+of\s+(?:funds|proceeds)|proceeds\s+will\s+be\s+used|capital\s+allocation|funds\s+will\s+be\s+(?:used|deployed|allocated))\b/i;

/**
 * Segment a raw label-text string (text that follows the last `%` on an allocation slide)
 * into individual category-label tokens by splitting at capital-letter word boundaries.
 * Strips standalone numbers (page numbers) and the word "Ask".
 *
 * Example input:  "People / Hiring Go-to-Market Product / Engineering Contingency 15 Ask"
 * Example output: ["People / Hiring", "Go-to-Market", "Product / Engineering", "Contingency"]
 */
function segmentAllocationLabels(text: string): string[] {
	const cleaned = text
		.replace(/\b\d{1,4}\b\s*/g, "")   // remove standalone numbers (page numbers etc.)
		.replace(/\bask\b\s*/gi, "")       // remove "Ask" (slide heading echoed at bottom)
		.replace(/\s{2,}/g, " ")             // collapse internal whitespace
		.trim();
	if (!cleaned) return [];
	return cleaned
		.split(/(?<=[a-z&])\s+(?=[A-Z])/) // split before caps that follow lowercase
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
}

/**
 * Detect an "allocation slide" that presents percentage splits without the
 * standard "Use of Funds" header — e.g. DealDecisionAI deck page 14:
 *   "The Ask  $2M Pre-Seed  ...  40%  30%  20%  10%  People / Hiring  Go-to-Market
 *    Product / Engineering  Contingency"
 *
 * Detection criteria:
 *   1. Page must match ASK_SLIDE_HEADING_RE (explicit ask / raising / deal-terms heading).
 *   2. Page must contain 3–6 percentage values that sum to 80–120%.
 *   3. At least 2 category-label segments must appear after the last percentage.
 *
 * Returns a compact bucket summary string:
 *   "Use of funds (deck): People / Hiring 40%, Go-to-Market 30%, ..."
 */
function detectAskSlideAllocation(
	pages: DpuPage[]
): { snippet: string; ref: string } | null {
	for (const page of pages) {
		const text = page.text ?? "";
		if (!ASK_SLIDE_HEADING_RE.test(text)) continue;

		// Collect percentages (5–100%) and track the end-position of the last one.
		const percents: number[] = [];
		let lastPctEnd = -1;
		for (const pm of text.matchAll(/\b(\d{1,3})%/g)) {
			const v = parseInt(pm[1]!, 10);
			if (v >= 5 && v <= 100) {
				percents.push(v);
				lastPctEnd = pm.index! + pm[0].length;
			}
		}
		if (percents.length < 3 || percents.length > 6) continue;
		const sum = percents.reduce((a, b) => a + b, 0);
		if (sum < 80 || sum > 120) continue;

		// Extract label segments from the text AFTER the last percentage token.
		const afterText = text.slice(lastPctEnd, lastPctEnd + 300);
		const labelSegments = segmentAllocationLabels(afterText).slice(0, percents.length);
		if (labelSegments.length < 2) continue;

		// Build compact "Label pct%" bucket string.
		const buckets: string[] = percents.map((pct, i) => {
			const label = labelSegments[i] ?? `Bucket ${i + 1}`;
			return `${label} ${pct}%`;
		});
		const snippet = `Use of funds (deck): ${buckets.join(", ")}`;
		return { snippet: snippet.slice(0, 200), ref: dpuEvidenceRef(page.document_id, page.page_index) };
	}
	return null;
}

// ── Shared currency/money building blocks (used by both Stage 1 slots and Phase 2 canonical) ──

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
 * _RAISE_ADVERB: optional quantifier / approximation adverb that may appear
 * between a RAISE_ANCHOR verb and the money amount.
 * Handles real-world OCR output such as "raising approximately $10M" (3ICE),
 * "seeking about $2M", "raise roughly £3M", "offering up to $5M".
 * The trailing `\s*` absorbs any whitespace after the adverb so that
 * MONEY_FRAGMENT begins immediately.
 */
const _RAISE_ADVERB = String.raw`(?:approximately|about|around|roughly|~\s*|over|under|nearly|some|a\s+total\s+of|up\s+to|at\s+least|just\s+over)?\s*`;

/**
 * RAISE_ANCHOR: full list of word anchors signalling a raise context.
 * Used in RAISE_AMOUNT_PATTERN Forms A, B, G, H.
 */
const RAISE_ANCHOR = String.raw`(?:rais(?:e|ing|ed)|seeking|fund(?:ed|ing)?|financ(?:ed|ing)?|invest(?:ment|ing)?|offer(?:ing)?|proceeds|allocation)`;

/**
 * RAISE_AMOUNT_PATTERN: comprehensive raise-detection covering Forms A–H.
 * Used for BOTH Stage 1 raise_terms slot and Phase 2 canonical raise_amount field.
 *
 * Form A: "Raising $2M seed", "raise $5M Series A", "seeking $1M",
 *           "raising approximately $10M" (3ICE — adverb between verb and amount)
 * Form B: "$1.5MM raise", "Equity $1.5MM raise on a $6MM Valuation"
 * Form C: "Capital Raise ... $1.5MM"
 * Form D: "$2M seed round", "$3M bridge raise"
 * Form E: "€5.6M raised to date", "EUR 5.6M funded" (money-first, past-tense)
 * Form F: "raised €5.6M", "has raised USD 2.0M to date", "Total raised: €5.6M" (verb-first)
 * Form G: "Raise: $4M", "Raised: €5.6M", "Seeking: a $2M" (colon + optional article — OCR label)
 * Form H: "Financial Strategy Raise: a $4M" (slide-layout label prefix + raise + money)
 *
 */
const RAISE_AMOUNT_PATTERN = new RegExp(
	// Form A: raise/seek/fund/finance/invest/offer verb/noun optionally followed by an
	// approximation adverb (e.g. "approximately", "about", "roughly") then money.
	// FIX(3ICE): "raising approximately $10M" — _RAISE_ADVERB absorbs the adverb.
	`${RAISE_ANCHOR}\\s+${_RAISE_ADVERB}${MONEY_FRAGMENT}` +
	// Form B: money then raise-word within ~40 chars
	`|${MONEY_FRAGMENT}${_NO_CUR}{0,40}?\\b${RAISE_ANCHOR}\\b` +
	// Form C: label-first — capital raise / round size / ticket size / proceeds / allocation then money
	`|\\b(?:capital\\s+raise|round\\s+size|ticket\\s+size|proceeds|allocation)\\b${_NO_CUR}{0,40}?${MONEY_FRAGMENT}` +
	// Form D: money immediately before a round-type keyword
	`|${MONEY_FRAGMENT}\\s+(?:seed|series\\s+[a-cA-C]|pre[-\\s]seed|bridge)\\s*(?:round|raise|funding)?` +
	// Form E: money first, then past-tense funding phrase within ~60 chars
	`|${MONEY_FRAGMENT}${_NO_CUR}{0,60}?\\b(?:raised(?:\\s+to\\s+date)?|funded|funding\\s+to\\s+date|financed|investment)\\b` +
	// Form F: past-tense funding phrase first, then money within ~60 chars; colon between is allowed
	`|\\b(?:raised(?:\\s+to\\s+date)?|funded|funding\\s+to\\s+date|financed|investment)\\b${_NO_CUR}{0,60}?${MONEY_FRAGMENT}` +
	// Form G: raise-anchor + colon + optional indefinite article + money
	// Matches: "Raise: $4M", "Raised: €5.6M", "Seeking: a $2M seed", "Total raised: €5.6M"
	`|\\b${RAISE_ANCHOR}\\s*:\\s*(?:a\\b\\s*|an\\b\\s*)?${MONEY_FRAGMENT}` +
	// Form H: slide-layout label prefix, then raise keyword (with optional colon/article), then money
	// Matches: "Financial Strategy Raise: a $4M", "Investment Strategy Raise $5M"
	`|\\b(?:financial\\s+strategy|capital\\s+strategy|investment\\s+strategy|funding\\s+strategy)\\b${_NO_CUR}{0,60}?\\braise\\b${_NO_CUR}{0,20}?${MONEY_FRAGMENT}`,
	"i"
);

/**
 * RAISE_RANGE_PATTERN: variant of RAISE_AMOUNT_PATTERN that captures the full
 * low–high range when the deck expresses a range instead of a single figure.
 *
 * Range separator: en-dash (–), hyphen (-), or the word "to".
 *
 * Form R-A: "raising $2M–$4M", "raise $2M to $4M", "seeking $500K-$1M"
 * Form R-B: "$2M–$4M Raise", "$500K-$1M raise" (money-range then anchor)
 * Form R-G: "Raise: $2M–$4M", "Seeking: $500K-$1M"  (colon-label form)
 * Form R-H: "Financial Strategy Raise: $2M–$4M"      (slide-layout prefix)
 *
 * Evaluated BEFORE RAISE_AMOUNT_PATTERN in evalRaiseTermsSlot so the range
 * is preserved rather than only the first figure being captured.
 */
const _RANGE_SEP = String.raw`\s*(?:–|-|to)\s*`;
const RAISE_RANGE_PATTERN = new RegExp(
	// Form R-A: raise-anchor + optional adverb immediately followed by money RANGE
	// e.g. "raising approximately $2M–$4M"
	`${RAISE_ANCHOR}\\s+${_RAISE_ADVERB}${MONEY_FRAGMENT}${_RANGE_SEP}${MONEY_FRAGMENT}` +
	// Form R-B: money RANGE then raise-anchor within ~40 chars (e.g. "$2M–$4M Raise")
	`|${MONEY_FRAGMENT}${_RANGE_SEP}${MONEY_FRAGMENT}${_NO_CUR}{0,40}?\\b${RAISE_ANCHOR}\\b` +
	// Form R-G: raise-anchor + colon + optional article + money RANGE
	`|\\b${RAISE_ANCHOR}\\s*:\\s*(?:a\\b\\s*|an\\b\\s*)?${MONEY_FRAGMENT}${_RANGE_SEP}${MONEY_FRAGMENT}` +
	// Form R-H: slide-layout prefix + raise keyword + money RANGE
	`|\\b(?:financial\\s+strategy|capital\\s+strategy|investment\\s+strategy|funding\\s+strategy)\\b${_NO_CUR}{0,60}?\\braise\\b${_NO_CUR}{0,20}?${MONEY_FRAGMENT}${_RANGE_SEP}${MONEY_FRAGMENT}`,
	"i"
);

// ── Raise context-gating: "Ask slide" priority + TAM/SAM/SOM exclusion ──────

/**
 * ASK_SLIDE_HEADING_RE: detects pages that explicitly announce a fundraise ask.
 *
 * A page matching this regex AND containing a RAISE_AMOUNT_PATTERN money token is a
 * strong/prioritised candidate for raise_amount — it wins over any earlier page in
 * document order that only contains an incidental raise-anchor word near a dollar figure.
 *
 * Patterns covered:
 *   "The Ask", "Our Ask", "Funding Ask", "Investment Ask",
 *   "We Are Raising", "We're Raising", "We Are Seeking",
 *   "What We're Raising", "What We Are Raising",
 *   "The Deal", "Deal Terms", "Raise Terms",
 *   "Pre-Seed Round", "Seed Round" (as a heading — followed by $ or raise verb)
 */
const ASK_SLIDE_HEADING_RE =
	/\b(?:the\s+ask|our\s+ask|funding\s+ask|investment\s+ask|we\s+are\s+(?:raising|seeking)|we'?re\s+(?:raising|seeking)|what\s+we(?:'re|\s+are)\s+(?:raising|seeking)|the\s+deal|deal\s+terms|raise\s+terms|round\s+details|funding\s+terms)\b/i;

/**
 * TAM_MARKET_CONTEXT_RE: the presence of any of these tokens near a raise-pattern match
 * indicates the dollar figure describes a market size, NOT a fundraise amount.
 *
 * Extended to cover:
 *   - plain "market", "industry", "sector", "gap", "opportunit*"
 *   - "total revenues?" and "revenue size"  — e.g. "total revenue of $11B"
 *
 * NOTE: this regex is now applied to BOTH money-first AND certain verb-first matches
 * (specifically "invest*" starters — see isRaiseMatchTainted below).
 */
const TAM_MARKET_CONTEXT_RE =
	// Note: plain "market" uses (?<!-)market(?!\w) — a negative lookbehind for hyphen
	// so that "go-to-market" (preceded by '-') does NOT trigger a taint.
	// Only uncompounded uses like "Tax Software Market $11B" will match.
	/\b(?:TAM|SAM|SOM|total\s+addressable\s+market|serviceable\s+addressable\s+market|serviceable\s+obtainable\s+market|addressable\s+market|market\s+size|market\s+opportunity|market\s+cap(?:italization)?|industry|sector|gap|opportunit|total\s+revenues?|revenue\s+size)\b|(?<!-)market(?!\w)/i;

/** Characters to inspect on each side of a raise-pattern match for TAM/SAM/SOM context. */
const TAM_TAINT_WINDOW = 200;

/**
 * STRONG_RAISE_VERB_PREFIX_RE: anchors that are *unambiguously* a fundraise context.
 * Only these are exempt from the market-taint check when they appear verb-first.
 *
 * NOT included: "invest*" — "investment opportunity $11B" is a market claim.
 * NOT included: "allocation", "proceeds" — ambiguous (could be use-of-funds).
 */
const STRONG_RAISE_VERB_PREFIX_RE = /^(?:rais|seek|fund(?:ed|ing)?|financ|offer(?:ing)?)/i;

/**
 * Returns true when the portion of `text` within TAM_TAINT_WINDOW characters of the
 * matched span contains a TAM/SAM/SOM / market-size keyword.
 * Used to reject raise-anchor matches that are actually market-sizing sentences.
 *
 * FIX (raise_amount pollution): The old code unconditionally skipped the taint check
 * for ALL verb-first matches ("if first char is a letter, return false").  This allowed
 * "investment opportunity of $11B Tax Software Market" to pass through because the
 * match starts with "investment" (a letter).  We now only exempt genuine fundraise
 * verb starters (rais.../seek.../fund.../financ.../offer...).  "invest..." is NOT exempt because
 * it is also used in market-context phrases ("investment opportunity", "investment gap").
 */
function isRaiseMatchTainted(text: string, matchIndex: number, matchLength: number): boolean {
	// Genuine fundraise-verb-first forms (e.g. "raising $2M", "seeking $500K",
	// "funding round of $3M") are reliable raise indicators — skip taint check.
	const matchStart = text.slice(matchIndex, matchIndex + 8);
	if (STRONG_RAISE_VERB_PREFIX_RE.test(matchStart)) return false;
	// All other matches — including money-first ("$8B investment") AND ambiguous
	// verb-first starters ("investment $11B", "allocation $5B") — check TAM context.
	const start = Math.max(0, matchIndex - TAM_TAINT_WINDOW);
	const end   = Math.min(text.length, matchIndex + matchLength + TAM_TAINT_WINDOW);
	return TAM_MARKET_CONTEXT_RE.test(text.slice(start, end));
}

/**
 * Priority-ordered, context-gated page scanner for raise amount patterns.
 *
 * Pass 1 — Ask slide priority:
 *   If any page has ASK_SLIDE_HEADING_RE AND a non-TAM-tainted RAISE match, return
 *   the first such page. This ensures "The Ask — $2M Pre-Seed" wins over earlier pages.
 *
 * Pass 2 — Clean (non-TAM) match:
 *   Return the first page where the pattern matches and the match is not TAM-tainted.
 *   This filters out TAM/SAM/SOM slides whose dollar figures incidentally fire
 *   raise-anchor words like "investment" or "allocation".
 *
 * Pass 3 — Fallback (original behaviour):
 *   Return the first page where the pattern matches at all (preserves existing
 *   behaviour for decks that genuinely embed only raise context inside market slides).
 */
function detectRaiseInPages(
	pages: DpuPage[],
	pattern: RegExp
): { snippet: string; ref: string } | null {
	// Pass 1: Ask-slide priority
	for (const page of pages) {
		const text = page.text ?? "";
		if (!ASK_SLIDE_HEADING_RE.test(text)) continue;
		const m = pattern.exec(text);
		if (m && !isRaiseMatchTainted(text, m.index, m[0].length)) {
			return { snippet: m[0].slice(0, 80), ref: dpuEvidenceRef(page.document_id, page.page_index) };
		}
	}
	// Pass 2: First non-TAM-tainted match (any page)
	for (const page of pages) {
		const text = page.text ?? "";
		const m = pattern.exec(text);
		if (m && !isRaiseMatchTainted(text, m.index, m[0].length)) {
			return { snippet: m[0].slice(0, 80), ref: dpuEvidenceRef(page.document_id, page.page_index) };
		}
	}
	// No clean match found — all matches were TAM/SAM/SOM-tainted or absent.
	// Return null rather than falling back to a tainted match.
	return null;
}

/**
 * Gated variant of detectInTextSources for raise patterns.
 * Uses detectRaiseInPages for DPU pages; unfiltered for evidence snippets
 * (snippets are already short contextual clips unlikely to contain TAM context).
 */
function detectRaiseInTextSources(
	pattern: RegExp,
	dpuPages: DpuPage[],
	evidenceSnippets: EvidenceSnippet[]
): { snippet: string; ref: string } | null {
	const dpuHit = detectRaiseInPages(dpuPages, pattern);
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

/**
 * Variant of detectAllMatchesForConflict for raise amounts.
 * Excludes matches that are TAM/SAM/SOM-tainted so that cross-page conflict
 * detection works against genuine raise figures only.
 */
function detectRaiseAllMatchesForConflict(
	pages: DpuPage[],
	pattern: RegExp
): Array<{ snippet: string; ref: string; normalized: string }> {
	return pages.flatMap((page) => {
		const text = page.text ?? "";
		const m = pattern.exec(text);
		if (!m) return [];
		if (isRaiseMatchTainted(text, m.index, m[0].length)) return [];
		const snippet = m[0].slice(0, 80);
		return [{
			snippet,
			ref: dpuEvidenceRef(page.document_id, page.page_index),
			normalized: normalizeAmountForConflict(snippet),
		}];
	});
}

// ── Market-sizing triad extractor ─────────────────────────────────────────────

/**
 * Detects a line containing all three market-sizing labels TAM, SAM, SOM.
 * Handles both orderings (TAM→SAM→SOM and SOM→SAM→TAM).
 */
const MARKET_SIZING_TRIAD_RE =
	/\bTAM\b[^\n]{0,80}\bSAM\b[^\n]{0,80}\bSOM\b|\bSOM\b[^\n]{0,80}\bSAM\b[^\n]{0,80}\bTAM\b/i;

/**
 * Broad money pattern for market-sizing extraction.
 * Captures single values ($10.5B+), ranges ($600-900M), and OCR-artifact ranges
 * ($3.5°-4B where ° is a misread dash — captures $3.5 at minimum).
 * Global flag required for matchAll / exec-loop use.
 */
const BROAD_MONEY_VALUE_RE =
	/[\$€£]\s*[\d,.]+(?:\s*[\-\u2013\u2014]\s*[\d,.]+)?\s*[BbMmKkTt]?\+?/g;

/**
 * Extract TAM, SAM, SOM canonical values from a DPU page where the three labels
 * appear together (e.g. in a slide column layout).
 *
 * Handles the pitch-deck OCR layout where money values appear BEFORE labels:
 *   "$10.5B+  $3.5°-4B  $600-900M  TAM  SAM  SOM"
 * and the standard label-first layout:
 *   "TAM $10.5B  SAM $3.5B  SOM $600-900M"
 *
 * Positional pairing: 1st money ↔ TAM, 2nd money ↔ SAM, 3rd money ↔ SOM.
 * This aligns with standard pitch deck column ordering (largest → smallest).
 */
function detectMarketSizingTriad(
	pages: DpuPage[]
): { tam: string | null; sam: string | null; som: string | null; ref: string } | null {
	for (const page of pages) {
		const text = page.text ?? "";
		const triadMatch = MARKET_SIZING_TRIAD_RE.exec(text);
		if (!triadMatch) continue;

		// Expand context: up to 400 chars before the triad match to capture
		// preceding money values, plus the match itself plus a short buffer.
		const ctxStart = Math.max(0, triadMatch.index - 400);
		const ctxEnd   = Math.min(text.length, triadMatch.index + triadMatch[0].length + 80);
		const context  = text.slice(ctxStart, ctxEnd);

		// Extract all money values in left-to-right order.
		BROAD_MONEY_VALUE_RE.lastIndex = 0;
		const moneyValues: string[] = [];
		let mv: RegExpExecArray | null;
		while ((mv = BROAD_MONEY_VALUE_RE.exec(context)) !== null) {
			// Normalise: strip trailing + (means "more than") and collapse whitespace.
			moneyValues.push(mv[0].replace(/\+$/, "").replace(/\s+/g, "").trim());
		}

		if (moneyValues.length < 3) continue;

		return {
			tam: moneyValues[0] ?? null,
			sam: moneyValues[1] ?? null,
			som: moneyValues[2] ?? null,
			ref: dpuEvidenceRef(page.document_id, page.page_index),
		};
	}
	return null;
}

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
	let financialStatements: FinancialStatementV1[] = [];
	let useOfFundsStatements: UseOfFundsV1[] = [];
	let impliedCapitalAllocation: ImpliedCapitalAllocationV1 | null = null;
	let impliedFromIncomeStatement: IncomeStatementAllocationV1 | null = null;
	let financialLayoutClassification: DealLayoutClassificationV1 | null = null;
	let financialReconciliation: FinancialReconciliationV1 | null = null;
	let deckFinancialSignals: DeckFinancialSignalsV1 | null = null;
	// Phase K: new financial document type accumulators
	const balanceSheets:    BalanceSheetV1[] = [];
	const cashFlows:        CashFlowStatementV1[] = [];
	const capTables:        CapTableV1[] = [];
	const saasKpisAll:      SaasKpisV1[] = [];
	let   bankTransactions: BankTransactionsV1 | null = null;

	try {
		const { rows } = await pool.query<{ document_id: string; page_index: number; payload: unknown }>(
			`SELECT document_id,
			        page_index,
			        payload
			   FROM public.document_page_understanding
			  WHERE deal_id = $1
			  ORDER BY document_id ASC, page_index ASC
			  LIMIT 500`,
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
		// Extract deck financial signals from pitch-deck text pages.
		deckFinancialSignals = extractDeckFinancialSignalsV1(dpuPages);
		// Parse financial statements and use-of-funds from excel_range DPU pages.
		for (const r of rows) {
			const p = r.payload as Record<string, unknown> | null;
			if (!p || p["page_type"] !== "excel_range") continue;
			const pageRef = `dpu:doc:${r.document_id.replace(/-/g, "").slice(0, 8)}:page:${r.page_index}`;
			const stmt = parseFinancialStatementV1(r.payload, { documentId: r.document_id, pageRef });
			if (stmt) financialStatements.push(stmt);
			const uof = parseUseOfFundsV1(r.payload, { documentId: r.document_id, pageRef });
			if (uof) useOfFundsStatements.push(uof);
			const incomeStmt = parseImpliedCapitalIncomeStatementV1(r.payload, { documentId: r.document_id, pageRef });
			if (incomeStmt && impliedFromIncomeStatement === null) impliedFromIncomeStatement = incomeStmt;
			// Phase K: new financial document parsers
			const bs = parseBalanceSheetV1(r.payload, { documentId: r.document_id, pageRef });
			if (bs) balanceSheets.push(bs);
			const cf = parseCashFlowStatementV1(r.payload, { documentId: r.document_id, pageRef });
			if (cf) cashFlows.push(cf);
			const ct = parseCapTableV1(r.payload, { documentId: r.document_id, pageRef });
			if (ct) capTables.push(ct);
			const kpi = parseSaasKpisV1(r.payload, { documentId: r.document_id, pageRef });
			if (kpi) saasKpisAll.push(kpi);
			const btxn = parseBankTransactionsV1(r.payload, { documentId: r.document_id, pageRef });
			if (btxn && bankTransactions === null) bankTransactions = btxn;
		}

		// Parse implied capital allocation from excel_sheet DPU pages (structured_native_v1 fallback).
		// Group rows by document_id and run the parser per document; keep the best result.
		const docGroups = new Map<string, typeof rows>();
		for (const r of rows) {
			const grp = docGroups.get(r.document_id) ?? [];
			grp.push(r);
			docGroups.set(r.document_id, grp);
		}
		// Parse timeseries Use-of-Funds from excel_sheet pages (e.g. WebMax monthly spend plan).
		for (const r of rows) {
			const p = r.payload as Record<string, unknown> | null;
			if (!p || p["page_type"] !== "excel_sheet") continue;
			const pageRef = `dpu:doc:${r.document_id.replace(/-/g, "").slice(0, 8)}:page:${r.page_index}`;
			const tsUof = parseUseOfFundsTimeseriesV1(r.payload, { documentId: r.document_id, pageRef });
			if (tsUof) useOfFundsStatements.push(tsUof);
		}

		// Classify XLSX layouts for the entire deal (all pages, all documents).
		financialLayoutClassification = classifyDealLayouts(
			dealId,
			rows.map((r) => ({ document_id: r.document_id, page_index: r.page_index, payload: r.payload }))
		);

		for (const [docId, docRows] of docGroups.entries()) {
			const candidate = parseImpliedCapitalAllocationV1(
				docRows.map((r) => ({
					document_id: r.document_id,
					page_index: r.page_index,
					payload: r.payload,
				})),
				{ documentId: docId }
			);
			if (
				candidate !== null &&
				(impliedCapitalAllocation === null ||
					candidate.diagnostics.parse_quality >
						impliedCapitalAllocation.diagnostics.parse_quality)
			) {
				impliedCapitalAllocation = candidate;
			}
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

	const _bestStmt = pickBestStatement(financialStatements);
	const _bestUof  = pickBestUseOfFunds(useOfFundsStatements);
	const _bestBs   = pickBestBalanceSheet(balanceSheets);
	const _bestCf   = pickBestCashFlow(cashFlows);
	const _bestCt   = pickBestCapTable(capTables);
	const _bestKpi  = pickBestSaasKpis(saasKpisAll);
	financialReconciliation = reconcileFinancialsV1({
		dealId,
		financialStatement:        _bestStmt,
		useOfFunds:                _bestUof,
		impliedCapitalAllocation,
		incomeStatementAllocation: impliedFromIncomeStatement,
		balanceSheet:              _bestBs,
		cashFlow:                  _bestCf,
		capTable:                  _bestCt,
		saasKpis:                  _bestKpi,
	});

	return {
		dpuPages,
		evidenceSnippets,
		dpuLoadFailed,
		g3Passed,
		dpuDiag,
		normEvents: allNormEvents,
		financialStatements,
		bestFinancialStatement: _bestStmt,
		useOfFundsStatements,
		bestUseOfFundsStatement: _bestUof,
		impliedCapitalAllocation,
		impliedFromIncomeStatement,
		financialLayoutClassification,
		financialReconciliation,
		balanceSheet:     _bestBs,
		cashFlow:         _bestCf,
		capTable:         _bestCt,
		saasKpis:         _bestKpi,
		bankTransactions,
		deckFinancialSignals,
	};
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
	// Try RAISE_RANGE_PATTERN first so that "$2M–$4M" ranges are preserved in the
	// output value rather than being truncated to only the first figure.
	// Fall back to RAISE_AMOUNT_PATTERN (Forms A–H) for single-figure raises.
	// Both share the same building blocks as Phase 2 canonical raise_amount.
	// Use the context-gated variant to exclude TAM/SAM/SOM market-size matches
	// and to prioritise explicit "Ask slide" pages over earlier incidental matches.
	const rangeHit = detectRaiseInTextSources(RAISE_RANGE_PATTERN, inputs.dpuPages, inputs.evidenceSnippets);
	if (rangeHit) {
		return { computable: true, value: rangeHit.snippet, evidence: rangeHit.ref, reasonCode: null };
	}
	const hit = detectRaiseInTextSources(RAISE_AMOUNT_PATTERN, inputs.dpuPages, inputs.evidenceSnippets);
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

/**
 * Canonical→slot bridge: promote traction_signal to Computable using XLSX-derived
 * financial data when text-pattern detectors find nothing.
 *
 * Priority order:
 *   1. Revenue amount (derived.revenue_latest + first period label)
 *   2. YoY growth rate (derived.revenue_yoy_growth_pct + period range label)
 *
 * Returns null when the statement is absent or contains no promotable data.
 */
function promoteFromFinancials(statement: FinancialStatementV1 | null): SlotResult | null {
	if (!statement) return null;
	const ref = statement.source.page_ref;
	const periods = statement.periods;
	const rev = statement.derived?.revenue_latest;
	const yoy = statement.derived?.revenue_yoy_growth_pct;

	// Option 1: revenue amount with period label — most informative
	if (typeof rev === "number" && rev > 0 && periods.length > 0) {
		const period = periods[0]!;
		const formatted = "$" + Math.round(rev).toLocaleString("en-US");
		const value = `Revenue detected: ${formatted} (${period}, XLSX)`;
		return { computable: true, value, evidence: ref, reasonCode: SLOT_REASON_CODES.DERIVED_FROM_FINANCIALS };
	}

	// Option 2: YoY growth rate when revenue_latest not available
	if (typeof yoy === "number" && periods.length >= 2) {
		const value = `Revenue growth detected: ${yoy.toFixed(1)}% (${periods[0]}->${periods[1]}, XLSX)`;
		return { computable: true, value, evidence: ref, reasonCode: SLOT_REASON_CODES.DERIVED_FROM_FINANCIALS };
	}

	return null;
}

/**
 * Canonical→slot bridge: promote use_of_funds to Computable using XLSX-parsed
 * Use-of-Funds data when text-pattern detectors find nothing.
 *
 * Emits a compact bucket summary, e.g.:
 *   "Use of funds: Product 40%, Sales 30%, G&A 20%, Other 10% (XLSX)"
 *
 * Guardrails:
 *   - Requires ≥2 buckets OR a total_amount line to accept (avoids singleton false positives)
 *   - Returns null when the statement is absent or too sparse
 */
function promoteFromUseOfFunds(uof: UseOfFundsV1 | null): SlotResult | null {
	if (!uof) return null;
	// Require at least 2 buckets OR a total amount as a quality guardrail
	if (uof.buckets.length < 2 && uof.total_amount === null) return null;

	const ref = uof.source.page_ref;
	const bucketSummary = uof.buckets
		.map((b) => {
			const parts: string[] = [b.category];
			if (b.percent !== null) parts.push(`${b.percent}%`);
			else if (b.amount !== null) parts.push(`$${b.amount.toLocaleString("en-US")}`);
			return parts.join(" ");
		})
		.join(", ");
	const totalHint = uof.total_amount !== null
		? ` / total $${uof.total_amount.toLocaleString("en-US")}`
		: "";
	const value = `Use of funds: ${bucketSummary}${totalHint} (XLSX)`;
	return { computable: true, value, evidence: ref, reasonCode: SLOT_REASON_CODES.DERIVED_FROM_USE_OF_FUNDS };
}

/**
 * Canonical→slot bridge: promote use_of_funds to Computable using an implied
 * capital allocation derived from operational budget model XLSX sheets.
 *
 * This is the last-resort bridge — used only when both text detection AND the
 * explicit Use-of-Funds parser yield nothing.  The output is explicitly labeled
 * as IMPLIED and never confused with a stated raise allocation.
 *
 * Guardrails:
 *   - Requires parse_quality ≥ 0.5 AND ≥ 2 buckets
 *   - Returns null when implied allocation is absent or too low quality
 */
function promoteFromBudgetModel(ica: ImpliedCapitalAllocationV1 | null): SlotResult | null {
	if (!ica) return null;
	if (ica.diagnostics.parse_quality < 0.5) return null;
	if (ica.buckets.length < 2) return null;

	const ref = ica.source.page_refs[0] ?? `dpu:doc:${ica.source.document_id.replace(/-/g, "").slice(0, 8)}:implied`;
	const topBuckets = ica.buckets.slice(0, 5);
	const bucketSummary = topBuckets
		.map((b) => {
			const parts: string[] = [b.category];
			if (b.pct_of_total !== null) parts.push(`${b.pct_of_total}%`);
			else if (b.annual_cost_usd !== null) parts.push(`$${b.annual_cost_usd.toLocaleString("en-US")}`);
			return parts.join(" ");
		})
		.join(", ");
	const totalHint = ica.total_annual_cost_usd !== null
		? ` / total $${ica.total_annual_cost_usd.toLocaleString("en-US")}`
		: "";
	const value = `[IMPLIED] Budget allocation (${ica.period_label}): ${bucketSummary}${totalHint} — derived from budget model, not stated raise allocation`;
	return { computable: true, value, evidence: ref, reasonCode: SLOT_REASON_CODES.DERIVED_FROM_BUDGET_MODEL };
}

/**
 * Canonical→slot bridge: promote use_of_funds to Computable using expense buckets
 * derived from an income statement.
 *
 * This is the 3rd-level last resort — used only when text detection, explicit UoF
 * parser, AND budget model all yield nothing.  Output is explicitly labeled IMPLIED.
 *
 * Guardrails:
 *   - Requires ≥2 buckets and total > 0
 *   - Returns null when allocation is absent or buckets too few
 */
function promoteFromIncomeStatement(
	isa: IncomeStatementAllocationV1 | null
): SlotResult | null {
	if (!isa) return null;
	if (isa.buckets.length < 2 || isa.total_annual_amount <= 0) return null;

	const ref = isa.source.page_ref;
	const topBuckets = isa.buckets.slice(0, 5);
	const bucketSummary = topBuckets
		.map((b) => `${b.category} ${b.pct_of_total}%`)
		.join(", ");
	const totalHint = ` / total $${isa.total_annual_amount.toLocaleString("en-US")}`;
	const value = `[IMPLIED] Expense allocation (${isa.period_label}): ${bucketSummary}${totalHint} — derived from income statement, not stated raise allocation`;
	return { computable: true, value, evidence: ref, reasonCode: SLOT_REASON_CODES.DERIVED_FROM_INCOME_STATEMENT };
}

function evalTractionSignalSlot(inputs: InsightSlotInputs): SlotResult {
	if (inputs.dpuLoadFailed) {
		return { computable: false, value: null, evidence: null, reasonCode: SLOT_REASON_CODES.DPU_LOAD_FAILED };
	}
	// TRACTION_PCT_PATTERN covers percentage-based traction claims (demo-to-close,
	// retention ratio, lift, churn rate, etc.) that carry no dollar amount.
	// Evaluated first so that %-based signals are not missed when MRR/ARR is absent.
	const pctHit = detectInTextSources(TRACTION_PCT_PATTERN, inputs.dpuPages, inputs.evidenceSnippets);
	if (pctHit) {
		return { computable: true, value: pctHit.snippet, evidence: pctHit.ref, reasonCode: null };
	}
	// Fall back to MRR/ARR dollar-amount traction signal.
	const hit = detectInTextSources(TRACTION_PATTERN, inputs.dpuPages, inputs.evidenceSnippets);
	if (hit) {
		return { computable: true, value: hit.snippet, evidence: hit.ref, reasonCode: null };
	}
	// Canonical→slot bridge: promote from XLSX financial facts when text patterns find nothing.
	const promoted = promoteFromFinancials(inputs.bestFinancialStatement);
	if (promoted) return promoted;

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
	// Ask-slide allocation detector: handles decks where the Use-of-Funds breakdown
	// is presented as a percentage table on the "The Ask" / raise slide rather than
	// with a standard "Use of Funds" header phrase.
	const askAllocation = detectAskSlideAllocation(inputs.dpuPages);
	if (askAllocation) {
		return { computable: true, value: askAllocation.snippet, evidence: askAllocation.ref, reasonCode: null };
	}
	// Canonical→slot bridge: promote from XLSX-parsed Use-of-Funds when text detectors find nothing.
	const promoted = promoteFromUseOfFunds(inputs.bestUseOfFundsStatement);
	if (promoted) return promoted;

	// Last-resort bridge: promote from implied capital allocation (operational budget model).
	// Only used when both text detection and explicit UoF parser yield nothing.
	const promotedFromBudget = promoteFromBudgetModel(inputs.impliedCapitalAllocation);
	if (promotedFromBudget) return promotedFromBudget;

	// 3rd-level last resort: promote from income-statement expense breakdown.
	const promotedFromIncomeStmt = promoteFromIncomeStatement(inputs.impliedFromIncomeStatement);
	if (promotedFromIncomeStmt) return promotedFromIncomeStmt;

	return { computable: false, value: null, evidence: null, reasonCode: SLOT_REASON_CODES.NO_USE_OF_FUNDS_MENTION };
}

/**
 * Format a single slot result as a pipe-delimited output line.
 *
 * The value snippet is sanitized before embedding:
 * - Pipe characters are replaced with "/" so the line format `name: state | value="..." | ...`
 *   is never broken by a `|` that appears inside the matched text (e.g. Excel cell separators).
 * - Double-quote characters inside the snippet are replaced with single quotes so the
 *   surrounding `value="..."` delimiters remain unambiguous.
 */
function formatSlotLine(name: string, result: SlotResult): string {
	if (result.computable && result.value !== null && result.evidence !== null) {
		const safeValue = result.value.replace(/\|/g, "/").replace(/"/g, "'");
		// Emit the reason code when set (e.g. DERIVED_FROM_FINANCIALS); fall back to "none".
		const reason = result.reasonCode ?? "none";
		return `${name}: Computable | value="${safeValue}" | evidence=${result.evidence} | reason=${reason}`;
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
		(ev) => `  [${ev.rule}] "${ev.before}" \u2192 "${ev.after}" | ctx: \u2026${ev.context.slice(0, 60)}\u2026`
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
 * Debug section showing the highest-impact pages where normalization occurred.
 * Sorted by event count descending, capped at 20 entries.
 * Uses DpuPage.text_raw and DpuPage.text (already computed during loadInsightSlotInputs).
 * Re-runs normalizeForExtraction on text_raw to recover per-page rule list (pure/deterministic).
 *
 * How to verify:
 *   1. curl -X POST http://localhost:9001/api/v1/deals/<id>/investor-insights/generate
 *   2. curl http://localhost:9001/api/v1/deals/<id>/investor-insights | \
 *        jq -r '.render_package.sections[] | select(.key=="debug.normalization_diff") | .body'
 */
function buildNormalizationDiffSection(
	inputs: InsightSlotInputs
): RenderPackage["sections"][number] | null {
	if (process.env["NODE_ENV"] === "production") return null;

	const affectedPages = inputs.dpuPages.filter((p) => p.norm_events_count > 0);
	if (affectedPages.length === 0) return null;

	// Sort high-impact pages first, cap at 20 to keep body readable.
	const top20 = [...affectedPages]
		.sort((a, b) => b.norm_events_count - a.norm_events_count)
		.slice(0, 20);

	// Truncate a preview string, replacing pipe chars so the | delimiter stays unambiguous.
	const preview = (s: string, len = 120) =>
		s.replace(/\|/g, "/").replace(/\s+/g, " ").trim().slice(0, len);

	const entryLines = top20.map((page) => {
		const docPrefix = page.document_id.replace(/-/g, "").slice(0, 8);
		const ref = `dpu:doc:${docPrefix}:page:${page.page_index}`;
		// Re-run pure normalization to recover which rules fired on this exact page.
		const { events } = normalizeForExtraction(page.text_raw);
		const rules = [...new Set(events.map((e) => e.rule))].join(",") || "none";
		const raw = preview(page.text_raw);
		const norm = preview(page.text);
		return `page=${page.page_index} | ref=${ref} | events=${page.norm_events_count} | rules=${rules} | raw=${raw} | norm=${norm}`;
	});

	const lines: string[] = [
		"(dev-only) Omitted in production.",
		`total_events: ${inputs.normEvents.length}`,
		`affected_pages: ${affectedPages.length}`,
		...entryLines,
	];

	return {
		key: "debug.normalization_diff",
		title: "Debug \u2014 OCR Normalization Diff",
		kind: "message",
		body: lines.join("\n"),
		fallback: "Normalization diff unavailable.",
	};
}

/**
 * Build the financial_statement_v1 section from a parsed FinancialStatementV1.
 * Emits structured revenue series, derived growth metrics, and source diagnostics.
 */
function buildFinancialStatementSection(stmt: FinancialStatementV1): RenderPackage["sections"][number] {
	const lines: string[] = [
		`schema_version: ${stmt.schema_version}`,
		`source: ${stmt.source.page_ref}`,
		`periods: ${stmt.periods.join(", ")}`,
	];
	if (stmt.revenue) lines.push(`revenue: ${formatRevenueSeries(stmt.revenue, stmt.periods)}`);
	if (stmt.gross_profit) lines.push(`gross_profit: ${formatRevenueSeries(stmt.gross_profit, stmt.periods)}`);
	if (stmt.total_expenses) lines.push(`total_expenses: ${formatRevenueSeries(stmt.total_expenses, stmt.periods)}`);
	if (stmt.derived?.revenue_latest !== undefined) {
		lines.push(`revenue_latest: $${stmt.derived.revenue_latest.toLocaleString("en-US")}`);
	}
	if (stmt.derived?.revenue_yoy_growth_pct != null) {
		lines.push(`revenue_yoy_growth: ${formatYoY(stmt.derived.revenue_yoy_growth_pct, stmt.periods)}`);
	}
	if (stmt.derived?.revenue_cagr_pct != null) {
		lines.push(`revenue_cagr: ${formatCAGR(stmt.derived.revenue_cagr_pct, stmt.periods)}`);
	}
	if (stmt.derived?.gross_margin_latest_pct != null) {
		lines.push(`gross_margin: ${formatGrossMargin(stmt.derived.gross_margin_latest_pct, stmt.periods)}`);
	}
	if (stmt.diagnostics?.matched_rows.length) {
		lines.push(`matched_rows: ${stmt.diagnostics.matched_rows.join(", ")}`);
	}
	if (stmt.diagnostics?.parse_warnings.length) {
		lines.push(`parse_warnings: ${stmt.diagnostics.parse_warnings.join("; ")}`);
	}
	return {
		key: "financial_statement_v1",
		title: "Financial Statement (XLSX)",
		kind: "message",
		body: lines.join("\n"),
		fallback: "Financial statement data unavailable.",
	};
}

/**
 * Build the financial_health_metrics_v1 section from derived fields of a
 * FinancialStatementV1.  Returns null when there are no derived metrics to
 * surface (e.g. sparse revenue data).
 */
function buildFinancialHealthMetricsSection(
	stmt: FinancialStatementV1
): RenderPackage["sections"][number] | null {
	const d = stmt.derived;
	if (!d) return null;

	const lines: string[] = [
		`schema_version: financial_health_metrics_v1`,
		`source: ${stmt.source.page_ref}`,
		`periods: ${stmt.periods.join(", ")}`,
	];

	if (d.revenue_latest != null) {
		lines.push(`revenue_latest: $${d.revenue_latest.toLocaleString("en-US")}`);
	}
	if (d.revenue_yoy_growth_pct != null) {
		lines.push(`revenue_yoy_growth_pct: ${d.revenue_yoy_growth_pct.toFixed(1)}%`);
	}
	if (d.revenue_cagr_pct != null) {
		lines.push(`revenue_cagr_pct: ${d.revenue_cagr_pct.toFixed(1)}%`);
	}
	if (d.gross_margin_latest_pct != null) {
		lines.push(`gross_margin_pct: ${d.gross_margin_latest_pct.toFixed(1)}%`);
	}

	// Cost-efficiency ratio: revenue / total_expenses for the first period.
	const firstPeriod = stmt.periods[0];
	if (firstPeriod && stmt.revenue && stmt.total_expenses) {
		const rev = stmt.revenue[firstPeriod] ?? 0;
		const exp = stmt.total_expenses[firstPeriod] ?? 0;
		if (rev > 0 && exp > 0) {
			lines.push(`cost_efficiency_ratio: ${(rev / exp).toFixed(2)}`);
		}
	}

	// If nothing beyond the header was added there's nothing useful to show.
	if (lines.length <= 3) return null;

	return {
		key: "financial_health_metrics_v1",
		title: "Financial Health Metrics (Derived)",
		kind: "message",
		body: lines.join("\n"),
		fallback: "Financial health metrics unavailable.",
	};
}

/**
 * Build the financial_layout_classifier_v1 section from deal-wide layout
 * classification results produced by `classifyDealLayouts()`.
 */
function buildFinancialLayoutClassifierSection(
	classification: DealLayoutClassificationV1
): RenderPackage["sections"][number] {
	const lines: string[] = [
		`schema_version: ${classification.schema_version}`,
		`total_xl_pages: ${classification.total_xl_pages}`,
		`classified_pages: ${classification.classified_pages}`,
		`layout_coverage_pct: ${classification.layout_coverage_pct.toFixed(1)}%`,
		`has_income_statement: ${classification.has_income_statement}`,
		`has_use_of_funds: ${classification.has_use_of_funds}`,
		`has_budget_model: ${classification.has_budget_model}`,
		`has_cap_table: ${classification.has_cap_table}`,
		`has_cash_flow: ${classification.has_cash_flow}`,
		`has_balance_sheet: ${classification.has_balance_sheet}`,
		`has_saas_kpis: ${classification.has_saas_kpis}`,
		`has_bank_txns: ${classification.has_bank_txns}`,
	];

	for (const doc of classification.documents) {
		lines.push(`doc: ${doc.doc_id} | dominant_layout: ${doc.dominant_layout} | pages: ${doc.page_count}`);
		for (const page of doc.layout_map) {
			lines.push(
				`  page[${page.page_index}] layout=${page.layout} confidence=${page.confidence}` +
					(page.sheet_title ? ` sheet="${page.sheet_title}"` : "") +
					(page.matched_signals.length ? ` signals=[${page.matched_signals.join(", ")}]` : "")
			);
		}
	}

	return {
		key: "financial_layout_classifier_v1",
		title: "Financial Layout Classification",
		kind: "message",
		body: lines.join("\n"),
		fallback: "Financial layout classification unavailable.",
	};
}

/**
 * Build the financial_reconciliation_v1 section from the deterministic
 * cross-check results produced by `reconcileFinancialsV1()`.
 */
function buildFinancialReconciliationSection(
	rec: FinancialReconciliationV1
): RenderPackage["sections"][number] {
	const STATUS_ICONS: Record<string, string> = {
		PASS: "✓",
		WARN: "⚠",
		FAIL: "✗",
		SKIP: "-",
	};
	const lines: string[] = [
		`schema_version: ${rec.schema_version}`,
		`confidence_score: ${rec.confidence_score.toFixed(2)}`,
		`data_sources: ${rec.data_sources_used.join(", ") || "none"}`,
	];
	for (const [flagKey, flag] of Object.entries(rec.flags)) {
		const icon = STATUS_ICONS[flag.status] ?? "?";
		lines.push(`${icon} ${flagKey}: ${flag.status} — ${flag.reason}`);
		if (flag.evidence_refs.length) {
			lines.push(`  evidence: ${flag.evidence_refs.join(", ")}`);
		}
		const numericVals = Object.entries(flag.values)
			.filter(([, v]) => v != null)
			.map(([k, v]) => `${k}=${typeof v === "number" ? v.toFixed(2) : v}`)
			.join(", ");
		if (numericVals) lines.push(`  values: ${numericVals}`);
	}
	return {
		key: "financial_reconciliation_v1",
		title: "Financial Reconciliation (Deterministic)",
		kind: "message",
		body: lines.join("\n"),
		fallback: "Financial reconciliation unavailable.",
	};
}

/**
 * Build the use_of_funds_v1 section from a parsed UseOfFundsV1.
 */
function buildUseOfFundsV1Section(uof: UseOfFundsV1): RenderPackage["sections"][number] {
	const lines: string[] = [
		`schema_version: ${uof.schema_version}`,
		`source: ${uof.source.page_ref}`,
		`buckets: ${uof.buckets.length}`,
	];
	for (const b of uof.buckets) {
		const parts: string[] = [b.category];
		if (b.amount !== null) parts.push(`$${b.amount.toLocaleString("en-US")}`);
		if (b.percent !== null) parts.push(`${b.percent}%`);
		lines.push(`  bucket: ${parts.join(" | ")}`);
	}
	if (uof.total_amount !== null) lines.push(`total_amount: $${uof.total_amount.toLocaleString("en-US")}`);
	if (uof.total_percent !== null) lines.push(`total_percent: ${uof.total_percent}%`);
	if (uof.diagnostics.parse_warnings.length) {
		lines.push(`parse_warnings: ${uof.diagnostics.parse_warnings.join("; ")}`);
	}
	return {
		key: "use_of_funds_v1",
		title: "Use of Funds (XLSX)",
		kind: "message",
		body: lines.join("\n"),
		fallback: "Use of funds data unavailable.",
	};
}

/**
 * Format an ImpliedCapitalAllocationV1 as natural-language text for the
 * governed-summary corpus (LLM input).  Uses explicit human-readable prose
 * so the LLM can include "implied" / "budget model" language in its output.
 * This is SEPARATE from buildImpliedCapitalAllocationSection which renders the
 * technical UI section.
 */
function formatImpliedCapitalForCorpus(ica: ImpliedCapitalAllocationV1): string {
	const lines: string[] = [
		`[IMPLIED from operational budget model — not an explicit raise allocation]`,
		`Inferred operational budget allocations (${ica.period_label}, derived from ${ica.diagnostics.sheets_used.join(" + ")} sheets):`,
	];
	for (const b of ica.buckets) {
		const costPart = b.annual_cost_usd !== null
			? `$${b.annual_cost_usd.toLocaleString("en-US")}/yr`
			: "n/a";
		const pctPart = b.pct_of_total !== null ? ` (${b.pct_of_total}%)` : "";
		lines.push(`- ${b.category}: ${costPart}${pctPart}`);
	}
	if (ica.total_annual_cost_usd !== null) {
		lines.push(
			`Total implied annual operational cost: $${ica.total_annual_cost_usd.toLocaleString("en-US")} [implied budget, not stated raise amount]`
		);
	}
	return lines.join("\n");
}

/**
 * Build the implied_capital_allocation_v1 section from an ImpliedCapitalAllocationV1.
 * Always labeled as IMPLIED — this is an estimation from budget/payroll data,
 * NOT a stated raise allocation.
 */
function buildImpliedCapitalAllocationSection(
	ica: ImpliedCapitalAllocationV1
): RenderPackage["sections"][number] {
	const lines: string[] = [
		`schema_version: ${ica.schema_version}`,
		`basis: ${ica.basis}`,
		`basis_note: ${ica.basis_note}`,
		`period: ${ica.period_label}`,
		`parse_quality: ${ica.diagnostics.parse_quality}`,
		`sheets_used: ${ica.diagnostics.sheets_used.join(", ")}`,
		`buckets: ${ica.buckets.length}`,
	];
	for (const b of ica.buckets) {
		const parts: string[] = [b.category];
		if (b.annual_cost_usd !== null) parts.push(`$${b.annual_cost_usd.toLocaleString("en-US")}/yr`);
		if (b.pct_of_total !== null) parts.push(`${b.pct_of_total}%`);
		parts.push(`[${b.source}]`);
		lines.push(`  bucket: ${parts.join(" | ")}`);
	}
	if (ica.total_annual_cost_usd !== null) {
		lines.push(`total_annual_cost: $${ica.total_annual_cost_usd.toLocaleString("en-US")}`);
	}
	if (ica.diagnostics.notes.length) {
		lines.push(`notes: ${ica.diagnostics.notes.join("; ")}`);
	}
	return {
		key: "implied_capital_allocation_v1",
		title: "Implied Capital Allocation (Budget Model) [IMPLIED]",
		kind: "message",
		body: lines.join("\n"),
		fallback: "Implied capital allocation data unavailable.",
	};
}

/**
 * Asynchronously build the governed_summary_v1 section using a cache-first
 * strategy.  If the deterministic input corpus is unchanged (same fingerprint)
 * and the previous record validated cleanly, the LLM is NOT called — the cached
 * summary is reused.  Returns null (silently) when the LLM is unavailable, the
 * API key is missing, or numeric-parity validation fails.
 *
 * Returns both the UI section and the GovernedSummaryRecord so the record can
 * be persisted in report_payload.governed_summary_v1.
 *
 * Phase J invariant: governed summary must resolve via resolveGovernedSummaryWithCache.
 * This is the ONLY place in the entire codebase that generates a GovernedSummaryRecord.
 * All three entrypoints (API /generate, API /regenerate, overlay_complete auto-trigger)
 * ultimately invoke this function through generateInvestorInsightsProcessor.
 */
async function buildGovernedSummarySection(
	inputs: InsightSlotInputs,
	previousRecord: GovernedSummaryRecord | null,
	engineVersion: string,
	governanceVersion: string,
	dealName?: string,
	productNarrativeBody?: string
): Promise<{ section: RenderPackage["sections"][number]; record: GovernedSummaryRecord } | null> {
	try {
		const phase2Result = extractPhase2Result(inputs);
		const canonicalFieldsBody = phase2Result.fields.map(formatCanonicalFieldLine).join("\n");
		const conflictsBody =
			phase2Result.conflicts.length > 0
				? phase2Result.conflicts.map(formatConflictLine).join("\n")
				: null;
		const slotsSection = buildInsightSlotsSection(inputs);
		const insightSlotsBody =
			typeof slotsSection.body === "string" && slotsSection.body.trim().length > 0
				? slotsSection.body
				: null;
		const financialStmtBody = inputs.bestFinancialStatement
			? (buildFinancialStatementSection(inputs.bestFinancialStatement).body ?? null)
			: null;
		const useOfFundsBody = inputs.bestUseOfFundsStatement
			? (buildUseOfFundsV1Section(inputs.bestUseOfFundsStatement).body ?? null)
			: null;
		const impliedCapitalBody = inputs.impliedCapitalAllocation
			? formatImpliedCapitalForCorpus(inputs.impliedCapitalAllocation)
			: null;
		const financialHealthBody = inputs.bestFinancialStatement
			? (buildFinancialHealthMetricsSection(inputs.bestFinancialStatement)?.body ?? null)
			: null;
		const financialReconciliationBody = inputs.financialReconciliation
			? (buildFinancialReconciliationSection(inputs.financialReconciliation).body ?? null)
			: null;

		const record = await resolveGovernedSummaryWithCache({
			canonicalFieldsBody,
			insightSlotsBody,
			financialStmtBody,
			useOfFundsBody,
			impliedCapitalBody,
			financialHealthBody,
			financialReconciliationBody,
			conflictsBody,
			previousRecord,
			engineVersion,
			governanceVersion,
			dealName: dealName ?? undefined,
			productNarrativeBody: productNarrativeBody ?? undefined,
		});

		if (!record || !record.validation_ok) {
			if (record && !record.validation_ok) {
				console.log(
					JSON.stringify({
						event: "GOVERNED_SUMMARY_V1_SKIP",
						reason: "validation_failed",
						unknown_tokens: record.unknown_tokens,
					})
				);
			}
			return null;
		}

		console.log(
			JSON.stringify({
				event: "GOVERNED_SUMMARY_V1_RESOLVED",
				source: record.source,
				fingerprint: record.fingerprint,
				engine_version: engineVersion,
				governance_version: governanceVersion,
			})
		);

		const body = serializeGovernedSummaryBody(record.summary);

		// Dev-only: append corpus inclusion markers so E2E tooling can assert that
		// UoF inputs were included in the governed-summary corpus without a DB read.
		// Enabled when DEV_GOVERNED_MARKERS=1 in the environment; always omitted in production.
		let bodyFinal = body;
		if (process.env["NODE_ENV"] !== "production" && process.env["DEV_GOVERNED_MARKERS"] === "1") {
			const hasUofSlot =
				typeof insightSlotsBody === "string" &&
				/DERIVED_FROM_USE_OF_FUNDS/.test(insightSlotsBody);
			const hasBudgetSlot =
				typeof insightSlotsBody === "string" &&
				/DERIVED_FROM_BUDGET_MODEL/.test(insightSlotsBody);
			const markers = [
				`use_of_funds_slot=${hasUofSlot ? "true" : "false"}`,
				`use_of_funds_v1=${useOfFundsBody && inputs.bestUseOfFundsStatement ? "true" : "false"}`,
				`implied_capital_v1=${impliedCapitalBody ? "true" : "false"}`,
				`financial_health_v1=${financialHealthBody ? "true" : "false"}`,
				`financial_reconciliation_v1=${financialReconciliationBody ? "true" : "false"}`,
				`budget_model_slot=${hasBudgetSlot ? "true" : "false"}`,
			].join(", ");
			bodyFinal += `\n%%inputs_included: ${markers}%%`;
		}

		return {
			section: {
				key: "governed_summary_v1",
				title: "AI-Governed Investment Summary",
				kind: "message",
				body: bodyFinal,
				fallback: "Executive summary unavailable.",
			},
			record,
		};
	} catch (err) {
		console.error(
			JSON.stringify({
				event: "GOVERNED_SUMMARY_V1_ERROR",
				error: err instanceof Error ? err.message : String(err),
			})
		);
		return null;
	}
}

/**
 * Asynchronously build the governed_executive_summary_v1 section using a
 * cache-first strategy that mirrors buildGovernedSummarySection.
 *
 * Uses the same corpus as governed_summary_v1 PLUS coverage and gate state so
 * the fingerprint invalidates when data coverage changes.
 *
 * Returns both the UI section and the GovernedExecutiveSummaryRecord for
 * persistence in report_payload.governed_executive_summary_v1.
 */
async function buildGovernedExecutiveSummarySection(
	inputs: InsightSlotInputs,
	coverage: CoverageSnapshot,
	gateState: GateState,
	previousRecord: GovernedExecutiveSummaryRecord | null,
	engineVersion: string,
	governanceVersion: string,
	dealName?: string,
	productNarrativeBody?: string
): Promise<{
	section: RenderPackage["sections"][number];
	record: GovernedExecutiveSummaryRecord;
} | null> {
	try {
		const phase2Result = extractPhase2Result(inputs);
		const canonicalFieldsBody = phase2Result.fields.map(formatCanonicalFieldLine).join("\n");
		const conflictsBody =
			phase2Result.conflicts.length > 0
				? phase2Result.conflicts.map(formatConflictLine).join("\n")
				: null;
		const slotsSection = buildInsightSlotsSection(inputs);
		const insightSlotsBody =
			typeof slotsSection.body === "string" && slotsSection.body.trim().length > 0
				? slotsSection.body
				: null;
		const financialStmtBody = inputs.bestFinancialStatement
			? (buildFinancialStatementSection(inputs.bestFinancialStatement).body ?? null)
			: null;
		const useOfFundsBody = inputs.bestUseOfFundsStatement
			? (buildUseOfFundsV1Section(inputs.bestUseOfFundsStatement).body ?? null)
			: null;
		const impliedCapitalBody = inputs.impliedCapitalAllocation
			? formatImpliedCapitalForCorpus(inputs.impliedCapitalAllocation)
			: null;
		const financialHealthBody = inputs.bestFinancialStatement
			? (buildFinancialHealthMetricsSection(inputs.bestFinancialStatement)?.body ?? null)
			: null;
		const financialReconciliationBody = inputs.financialReconciliation
			? (buildFinancialReconciliationSection(inputs.financialReconciliation).body ?? null)
			: null;

		// Deterministic coverage note (not passed to LLM — injected after generation)
		const coverageNote = formatCoverageNote({
			dpuNonemptyPages: coverage.dpuNonemptyPages,
			dpuPageCount: coverage.dpuPageCount,
			evidenceCount: coverage.evidenceCount,
		});

		// Deterministic gate state text for fingerprint only (not sent to LLM)
		const gateResults = gateState.results ?? [];
		const passCount = gateResults.filter((g) => g.passed).length;
		const failCount = gateResults.filter((g) => !g.passed).length;
		const gateStateText = `gates=${gateResults.length} pass=${passCount} fail=${failCount}`;

		const record = await resolveGovernedExecSummaryWithCache({
			canonicalFieldsBody,
			insightSlotsBody,
			financialStmtBody,
			useOfFundsBody,
			impliedCapitalBody,
			financialHealthBody,
			financialReconciliationBody,
			conflictsBody,
			coverageText: coverageNote,
			gateStateText,
			coverageNote,
			previousRecord,
			engineVersion,
			governanceVersion,
			dealName: dealName ?? undefined,
			productNarrativeBody: productNarrativeBody ?? undefined,
		});

		if (!record || !record.validation_ok) {
			if (record && !record.validation_ok) {
				console.log(
					JSON.stringify({
						event: "GOVERNED_EXECUTIVE_SUMMARY_V1_SKIP",
						reason: "validation_failed",
						unknown_tokens: record.unknown_tokens,
					})
				);
			}
			return null;
		}

		console.log(
			JSON.stringify({
				event: "GOVERNED_EXECUTIVE_SUMMARY_V1_RESOLVED",
				source: record.source,
				fingerprint: record.fingerprint,
				engine_version: engineVersion,
				governance_version: governanceVersion,
			})
		);

		const body = serializeGovernedExecSummaryBody(record.summary);

		return {
			section: {
				key: "governed_executive_summary_v1",
				title: "AI Executive Summary",
				kind: "message",
				body,
				fallback: "Executive summary unavailable.",
			},
			record,
		};
	} catch (err) {
		console.error(
			JSON.stringify({
				event: "GOVERNED_EXECUTIVE_SUMMARY_V1_ERROR",
				error: err instanceof Error ? err.message : String(err),
			})
		);
		return null;
	}
}

/**
 * Build the product_profile_v1 section using a governed LLM synthesis.
 *
 * Sources product narrative text from DPU pages (already filtered by
 * buildProductNarrativeBody), plus bounded evidence snippets for citation.
 * Returns null when product narrative is absent or LLM is unavailable.
 */
async function buildProductProfileSection(
	inputs: InsightSlotInputs,
	canonicalFieldsBody: string | null,
	dealName?: string
): Promise<RenderPackage["sections"][number] | null> {
	try {
		const productNarrativeBody = buildProductNarrativeBody(inputs);

		// Build bounded evidence snippets for citation
		const evidenceSnippets = inputs.evidenceSnippets
			.filter((e) => e.claim_text && e.claim_text.trim().length > 20)
			.slice(0, 8)
			.map((e) => ({ id: e.id, text: e.claim_text! }));

		const result = await generateProductProfileV1({
			productNarrativeBody,
			canonicalFieldsBody,
			evidenceSnippets,
			dealName,
		});

		if (!result.ok) {
			console.log(
				JSON.stringify({
					event: "PRODUCT_PROFILE_V1_SKIP",
					reason: result.reason,
				})
			);
			return null;
		}

		console.log(
			JSON.stringify({
				event: "PRODUCT_PROFILE_V1_RESOLVED",
				product_type: result.value.product_type,
				ai_claims_present: result.value.ai_claims_present,
				ai_evidence_strength: result.value.ai_evidence_strength,
				sources_count: result.value.sources.length,
			})
		);

		return {
			key: "product_profile_v1",
			title: "Product Profile",
			kind: "message",
			body: serializeProductProfileBody(result.value),
			fallback: "Product profile unavailable.",
		};
	} catch (err) {
		console.error(
			JSON.stringify({
				event: "PRODUCT_PROFILE_V1_ERROR",
				error: err instanceof Error ? err.message : String(err),
			})
		);
		return null;
	}
}

/**
 * Build the deck_financial_signals_v1 section from pitch-deck–derived signal mentions.
 * Only emitted when extractDeckFinancialSignalsV1 found at least one mention.
 */
function buildDeckFinancialSignalsSection(
	signals: DeckFinancialSignalsV1
): RenderPackage["sections"][number] {
	const lines: string[] = [
		`schema_version: ${signals.schema_version}`,
		`pages_scanned: ${signals.pages_scanned}`,
		`has_revenue: ${signals.has_revenue}`,
		`has_burn: ${signals.has_burn}`,
		`has_runway: ${signals.has_runway}`,
		`has_pricing: ${signals.has_pricing}`,
		`has_arr_mrr: ${signals.has_arr_mrr}`,
		`has_unit_economics: ${signals.has_unit_economics}`,
	];
	const addMentions = (label: string, mentions: DeckFinancialSignalsV1["revenue_mentions"]) => {
		if (mentions.length === 0) return;
		lines.push(`${label}_count: ${mentions.length}`);
		for (const m of mentions.slice(0, 4)) {
			lines.push(`  ${label}: ${m.text} | doc:${m.doc_id.slice(0, 8)} | page:${m.page_index}`);
		}
	};
	addMentions("revenue", signals.revenue_mentions);
	addMentions("arr_mrr", signals.arr_mrr_mentions);
	addMentions("burn", signals.burn_mentions);
	addMentions("runway", signals.runway_mentions);
	addMentions("margin", signals.margin_mentions);
	addMentions("pricing", signals.pricing_mentions);
	addMentions("unit_econ", signals.unit_econ_mentions);

	return {
		key: "deck_financial_signals_v1",
		title: "Deck Financial Signals (PDF/PPT)",
		kind: "message",
		body: lines.join("\n"),
		fallback: "No financial signals detected in deck text.",
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
	const normDiffSection = buildNormalizationDiffSection(inputs);
	const sections: Array<RenderPackage["sections"][number]> = [slotsSection];
	if (diagSection) sections.push(diagSection);
	if (signalSection) sections.push(signalSection);
	if (normSection) sections.push(normSection);
	if (normDiffSection) sections.push(normDiffSection);
	if (inputs.bestFinancialStatement) {
		sections.push(buildFinancialStatementSection(inputs.bestFinancialStatement));
	}
	if (inputs.bestUseOfFundsStatement) {
		sections.push(buildUseOfFundsV1Section(inputs.bestUseOfFundsStatement));
	}
	if (inputs.impliedCapitalAllocation) {
		sections.push(buildImpliedCapitalAllocationSection(inputs.impliedCapitalAllocation));
	}
	if (inputs.bestFinancialStatement) {
		const hmSection = buildFinancialHealthMetricsSection(inputs.bestFinancialStatement);
		if (hmSection) sections.push(hmSection);
	}
	if (inputs.financialLayoutClassification) {
		sections.push(buildFinancialLayoutClassifierSection(inputs.financialLayoutClassification));
	}
	if (inputs.financialReconciliation) {
		sections.push(buildFinancialReconciliationSection(inputs.financialReconciliation));
	}
	if (inputs.deckFinancialSignals) {
		sections.push(buildDeckFinancialSignalsSection(inputs.deckFinancialSignals));
	}
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
	NO_NOTE_INTEREST_RATE_MENTION: "NO_NOTE_INTEREST_RATE_MENTION",
	NO_NOTE_MATURITY_MENTION: "NO_NOTE_MATURITY_MENTION",
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
// NOTE: CURRENCY, AMOUNT, SUFFIX, MONEY_FRAGMENT, _NO_CUR, RAISE_ANCHOR, and
// RAISE_AMOUNT_PATTERN are defined in the "Shared building blocks" section above
// (before the data loader) so they are available to both Stage 1 and Phase 2.

/** raise_round: seed, series A/B/C, pre-seed, bridge, angel */
const RAISE_ROUND_PATTERN = /\b(seed|series\s+[a-cA-C]|pre[-\s]seed|bridge|angel)\b/i;

/**
 * raise_instrument: SAFE, convertible note, priced round, equity (round), common/preferred stock.
 * "Equity" alone is treated as Computable (Palm deck format: "Capital Raise. Equity").
 */
const RAISE_INSTRUMENT_PATTERN =
	/\b(SAFE|convertible\s+note|priced\s+round|equity(?:\s+round)?|common(?:\s+(?:stock|equity|shares?))?|preferred(?:\s+(?:stock|equity|shares?))?)\b/i;

/** raise_cap: "cap $X", "valuation cap $X", "SAFE cap $X", "cap of $X" — with optional SAFE/note proximity context */
const RAISE_CAP_PATTERN =
	/(?:(?:SAFE|convertible\s+note)[^.]{0,200}?)?(?:valuation\s+)?cap\s+(?:of\s+)?\$[\d,.]+\s*[BMKbmk]?|\bSAFE\s+cap\s+\$[\d,.]+\s*[BMKbmk]?/i;

/** raise_discount: "X% discount" — requires explicit "discount" word */
const RAISE_DISCOUNT_PATTERN = /\b(\d+)%\s+discount\b/i;

/**
 * note_interest_rate: interest rate on a convertible note / SAFE.
 * Matches patterns like "6% interest", "interest rate of 8%", "6% p.a.", "5% per annum"
 * anchored within a SAFE / convertible-note context (up to 150 chars preceding).
 */
const NOTE_INTEREST_RATE_PATTERN =
	/\b(\d+(?:\.\d+)?)\s*%\s*(?:interest(?:\s+rate)?|p\.a\.|per\s+annum)\b|interest\s+rate\s+of\s+(\d+(?:\.\d+)?)\s*%/i;

/**
 * note_maturity: maturity date or term of a convertible note.
 * Matches: "matures in 24 months", "maturity date: Dec 2025", "2-year term",
 * "18-month maturity", "maturity of 24 months".
 * Uses \bmatur (not \bmaturi) to cover both "matures" and "maturity".
 */
const NOTE_MATURITY_PATTERN =
	/\bmatur(?:ity|es?|e[ds]|ing)\s+(?:date\s+)?(?:of\s+|in\s+|:\s*)?(?:\d+\s+months?|[A-Za-z]+\s+\d{4}|\d{4})|\b\d+[-\s](?:month|year)\s+(?:term|maturity|note)\b|\bmaturity\s+(?:date\s+)?(?:of\s+)?\d+\s+months?\b/i;

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
// Updated to match plural "revenues" and allow pipe-separated columns from XLSX DPU
const REVENUE_VALUE_PATTERN =
	/(?:annual\s+revenues?|quarterly\s+revenues?|total\s+revenues?|gross\s+revenues?)[^$\n]{0,50}?\$[\d,.]+\s*[BMKbmk]?/i;

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
	/** Explicit source classification: "xlsx" for XLSX-derived, "deck" for PDF/text, "derived" for computed. */
	source?: "xlsx" | "deck" | "derived" | null;
}

interface ConflictEntry {
	field: string;
	valueA: string;
	evidenceA: string;
	/** Source type tag for valueA: which pipeline produced it. */
	sourceTypeA: "deck" | "xlsx";
	valueB: string;
	evidenceB: string;
	/** Source type tag for valueB. */
	sourceTypeB: "deck" | "xlsx";
	/** Human-readable reason explaining why this is a conflict. */
	conflictReason: string;
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
	raise_cap: string | null;
	raise_discount: string | null;
	note_interest_rate: string | null;
	note_maturity: string | null;
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
	return {
		field: fieldName,
		valueA: a.snippet, evidenceA: a.ref, sourceTypeA: "deck",
		valueB: b.snippet, evidenceB: b.ref, sourceTypeB: "deck",
		conflictReason: "Two distinct values found in different deck pages",
	};
}

/** Evaluate a single canonical sub-field via first-match detection (DPU → evidence fallback). */
function evalCanonicalField(
	category: string,
	field: string,
	pages: DpuPage[],
	evidenceSnippets: EvidenceSnippet[],
	pattern: RegExp,
	reasonCode: string,
	dpuLoadFailed: boolean,
	detectFn: (p: RegExp, pages: DpuPage[], ev: EvidenceSnippet[]) => { snippet: string; ref: string } | null = detectInTextSources
): CanonicalField {
	if (dpuLoadFailed) {
		return { category, field, computability: "NotComputable", value: null, evidenceRef: null, reasonCode: SLOT_REASON_CODES.DPU_LOAD_FAILED };
	}
	const hit = detectFn(pattern, pages, evidenceSnippets);
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
	// Use the context-gated variant to exclude TAM/SAM/SOM market-size matches.
	const raiseAmountMatches = dpuLoadFailed
		? []
		: detectRaiseAllMatchesForConflict(dpuPages, RAISE_AMOUNT_PATTERN);
	const raiseAmountConflict = findConflictInMatches("raise_amount", raiseAmountMatches);
	if (raiseAmountConflict) conflicts.push(raiseAmountConflict);

	fields.push(evalCanonicalField("raise_terms", "raise_amount", dpuPages, evidenceSnippets, RAISE_AMOUNT_PATTERN, P2_REASON.NO_RAISE_AMOUNT_MENTION, dpuLoadFailed, detectRaiseInTextSources));
	fields.push(evalCanonicalField("raise_terms", "raise_round", dpuPages, evidenceSnippets, RAISE_ROUND_PATTERN, P2_REASON.NO_RAISE_ROUND_MENTION, dpuLoadFailed));
	fields.push(evalCanonicalField("raise_terms", "raise_instrument", dpuPages, evidenceSnippets, RAISE_INSTRUMENT_PATTERN, P2_REASON.NO_RAISE_INSTRUMENT_MENTION, dpuLoadFailed));
	fields.push(evalCanonicalField("raise_terms", "raise_cap", dpuPages, evidenceSnippets, RAISE_CAP_PATTERN, P2_REASON.NO_RAISE_CAP_MENTION, dpuLoadFailed));
	fields.push(evalCanonicalField("raise_terms", "raise_discount", dpuPages, evidenceSnippets, RAISE_DISCOUNT_PATTERN, P2_REASON.NO_RAISE_DISCOUNT_MENTION, dpuLoadFailed));
	fields.push(evalCanonicalField("raise_terms", "note_interest_rate", dpuPages, evidenceSnippets, NOTE_INTEREST_RATE_PATTERN, P2_REASON.NO_NOTE_INTEREST_RATE_MENTION, dpuLoadFailed));
	fields.push(evalCanonicalField("raise_terms", "note_maturity", dpuPages, evidenceSnippets, NOTE_MATURITY_PATTERN, P2_REASON.NO_NOTE_MATURITY_MENTION, dpuLoadFailed));

	// ── Valuation Terms ────────────────────────────────────────────────────────
	fields.push(evalCanonicalField("valuation_terms", "valuation_pre", dpuPages, evidenceSnippets, VALUATION_PRE_PATTERN, P2_REASON.NO_VALUATION_PRE_MENTION, dpuLoadFailed));
	fields.push(evalCanonicalField("valuation_terms", "valuation_post", dpuPages, evidenceSnippets, VALUATION_POST_PATTERN, P2_REASON.NO_VALUATION_POST_MENTION, dpuLoadFailed));
	fields.push(evalCanonicalField("valuation_terms", "valuation_safe_cap", dpuPages, evidenceSnippets, VALUATION_SAFE_CAP_PATTERN, P2_REASON.NO_VALUATION_SAFE_CAP_MENTION, dpuLoadFailed));

	// ── Use of Funds ───────────────────────────────────────────────────────────
	// use_of_funds_buckets handled below (with XLSX override)

	// ── Market Claims ──────────────────────────────────────────────────────────
	// Prefer the triad extractor (handles pitch-deck layouts where all three values
	// appear on the same line before their labels). Fall back to individual patterns.
	{
		const triad = dpuLoadFailed ? null : detectMarketSizingTriad(dpuPages);
		if (triad) {
			fields.push(triad.tam
				? { category: "market_claims", field: "tam_value", computability: "Computable", value: triad.tam, evidenceRef: triad.ref, reasonCode: null }
				: { category: "market_claims", field: "tam_value", computability: "NotComputable", value: null, evidenceRef: null, reasonCode: P2_REASON.NO_TAM_VALUE_MENTION }
			);
			fields.push(triad.sam
				? { category: "market_claims", field: "sam_value", computability: "Computable", value: triad.sam, evidenceRef: triad.ref, reasonCode: null }
				: { category: "market_claims", field: "sam_value", computability: "NotComputable", value: null, evidenceRef: null, reasonCode: P2_REASON.NO_SAM_VALUE_MENTION }
			);
			fields.push(triad.som
				? { category: "market_claims", field: "som_value", computability: "Computable", value: triad.som, evidenceRef: triad.ref, reasonCode: null }
				: { category: "market_claims", field: "som_value", computability: "NotComputable", value: null, evidenceRef: null, reasonCode: P2_REASON.NO_SOM_VALUE_MENTION }
			);
		} else {
			fields.push(evalCanonicalField("market_claims", "tam_value", dpuPages, evidenceSnippets, TAM_VALUE_PATTERN, P2_REASON.NO_TAM_VALUE_MENTION, dpuLoadFailed));
			fields.push(evalCanonicalField("market_claims", "sam_value", dpuPages, evidenceSnippets, SAM_VALUE_PATTERN, P2_REASON.NO_SAM_VALUE_MENTION, dpuLoadFailed));
			fields.push(evalCanonicalField("market_claims", "som_value", dpuPages, evidenceSnippets, SOM_VALUE_PATTERN, P2_REASON.NO_SOM_VALUE_MENTION, dpuLoadFailed));
		}
	}

	// ── Traction Signal ────────────────────────────────────────────────────────
	// mrr_value: prefer XLSX saas_kpis; fall back to text pattern.
	{
		const textResult = evalCanonicalField("traction_signal", "mrr_value", dpuPages, evidenceSnippets, MRR_VALUE_PATTERN, P2_REASON.NO_MRR_VALUE_MENTION, dpuLoadFailed);
		const kpi = inputs.saasKpis;
		if (kpi?.derived?.mrr_latest != null) {
			const xlsxValue = `$${kpi.derived.mrr_latest.toLocaleString("en-US")} MRR (${kpi.periods[0] ?? "latest"}, XLSX)`;
			if (textResult.computability === "Computable" && textResult.value) {
				conflicts.push({
					field: "mrr_value",
					valueA: xlsxValue, evidenceA: kpi.source.page_ref, sourceTypeA: "xlsx",
					valueB: textResult.value, evidenceB: textResult.evidenceRef ?? "unknown", sourceTypeB: "deck",
					conflictReason: "XLSX SaaS KPI sheet and deck text disagree on MRR; XLSX preferred",
				});
			}
			fields.push({ category: "traction_signal", field: "mrr_value", computability: "Computable", value: xlsxValue, evidenceRef: kpi.source.page_ref, reasonCode: SLOT_REASON_CODES.DERIVED_FROM_SAAS_KPI, source: "xlsx" });
		} else {
			fields.push(textResult);
		}
	}
	// arr_value: prefer XLSX saas_kpis (derived ARR or ARR from MRR×12); fall back to text pattern.
	{
		const textResult = evalCanonicalField("traction_signal", "arr_value", dpuPages, evidenceSnippets, ARR_VALUE_PATTERN, P2_REASON.NO_ARR_VALUE_MENTION, dpuLoadFailed);
		const kpi = inputs.saasKpis;
		const arrVal = kpi?.derived?.arr_latest ?? null;
		if (arrVal != null && kpi) {
			const label = kpi.derived?.arr_from_mrr === true ? "ARR (×12 from MRR, XLSX)" : `ARR (${kpi.periods[0] ?? "latest"}, XLSX)`;
			const xlsxValue = `$${arrVal.toLocaleString("en-US")} ${label}`;
			if (textResult.computability === "Computable" && textResult.value) {
				conflicts.push({
					field: "arr_value",
					valueA: xlsxValue, evidenceA: kpi.source.page_ref, sourceTypeA: "xlsx",
					valueB: textResult.value, evidenceB: textResult.evidenceRef ?? "unknown", sourceTypeB: "deck",
					conflictReason: "XLSX SaaS KPI sheet and deck text disagree on ARR; XLSX preferred",
				});
			}
			fields.push({ category: "traction_signal", field: "arr_value", computability: "Computable", value: xlsxValue, evidenceRef: kpi.source.page_ref, reasonCode: SLOT_REASON_CODES.DERIVED_FROM_SAAS_KPI, source: "xlsx" });
		} else {
			fields.push(textResult);
		}
	}

	// revenue_value: prefer XLSX financial statement; fall back to text pattern.
	// Rule: XLSX is authoritative for revenue when available (structured data > OCR text).
	{
		const textResult = evalCanonicalField("traction_signal", "revenue_value", dpuPages, evidenceSnippets, REVENUE_VALUE_PATTERN, P2_REASON.NO_REVENUE_VALUE_MENTION, dpuLoadFailed);
		const fs = inputs.bestFinancialStatement;
		if (fs?.derived?.revenue_latest !== undefined) {
			const xlsxValue = `$${fs.derived.revenue_latest.toLocaleString("en-US")} (${fs.periods[0] ?? "latest"} revenue from XLSX)`;
			// If text also found a revenue value and it differs from XLSX, emit a cross-source conflict.
			if (textResult.computability === "Computable" && textResult.value) {
				conflicts.push({
					field: "revenue_value",
					valueA: xlsxValue, evidenceA: fs.source.page_ref, sourceTypeA: "xlsx",
					valueB: textResult.value, evidenceB: textResult.evidenceRef ?? "unknown", sourceTypeB: "deck",
					conflictReason: "XLSX structured data and deck text disagree on revenue; XLSX preferred",
				});
			}
			// XLSX preferred: always use XLSX value when available.
			fields.push({
				category: "traction_signal",
				field: "revenue_value",
				computability: "Computable",
				value: xlsxValue,
				evidenceRef: fs.source.page_ref,
				reasonCode: SLOT_REASON_CODES.DERIVED_FROM_FINANCIALS,
				source: "xlsx",
			});
		} else {
			fields.push(textResult);
		}
	}

	// growth_rate: prefer XLSX-derived YoY; fall back to text pattern.
	// Rule: XLSX is authoritative for growth metrics when available.
	{
		const textResult = evalCanonicalField("traction_signal", "growth_rate", dpuPages, evidenceSnippets, GROWTH_RATE_PATTERN, P2_REASON.NO_GROWTH_RATE_MENTION, dpuLoadFailed);
		const fs = inputs.bestFinancialStatement;
		if (fs?.derived?.revenue_yoy_growth_pct != null) {
			const periods = fs.periods;
			const yoyLabel = periods.length >= 2 ? `${periods[0]} → ${periods[1]}` : (periods[0] ?? "YoY");
			const xlsxValue = `${fs.derived.revenue_yoy_growth_pct.toFixed(1)}% revenue growth (${yoyLabel}, XLSX)`;
			fields.push({
				category: "traction_signal",
				field: "growth_rate",
				computability: "Computable",
				value: xlsxValue,
				evidenceRef: fs.source.page_ref,
				reasonCode: SLOT_REASON_CODES.DERIVED_FROM_FINANCIALS,
				source: "xlsx",
			});
		} else {
			fields.push(textResult);
		}
	}

	fields.push(evalCanonicalField("traction_signal", "customer_count", dpuPages, evidenceSnippets, CUSTOMER_COUNT_PATTERN, P2_REASON.NO_CUSTOMER_COUNT_MENTION, dpuLoadFailed));

	// ── Use of Funds (XLSX structured → text → ask-slide → ICA cascade) ────────
	// Priority: (1) XLSX UoF parser (most reliable structured data),
	//           (2) USE_OF_FUNDS_BUCKET_PATTERN text match (deck text),
	//           (3) Ask-slide allocation detector,
	//           (4) Implied capital allocation (budget model).
	// Structured XLSX data is preferred over OCR text pattern matches.
	{
		const textResult = evalCanonicalField("use_of_funds", "use_of_funds_buckets", dpuPages, evidenceSnippets, USE_OF_FUNDS_BUCKET_PATTERN, P2_REASON.NO_USE_OF_FUNDS_BUCKETS_MENTION, dpuLoadFailed);
		// 1st: XLSX UoF statement (highest confidence when available)
		const uof = inputs.bestUseOfFundsStatement;
		if (uof && uof.buckets.length > 0) {
			const bucketSummary = uof.buckets
				.map((b) => {
					const parts: string[] = [b.category];
					if (b.amount !== null) parts.push(`$${b.amount.toLocaleString("en-US")}`);
					if (b.percent !== null) parts.push(`${b.percent}%`);
					return parts.join(" ");
				})
				.join(", ");
			if (textResult.computability === "Computable" && textResult.value) {
				// Emit a conflict when text also found UoF data
				conflicts.push({
					field: "use_of_funds_buckets",
					valueA: bucketSummary, evidenceA: uof.source.page_ref, sourceTypeA: "xlsx",
					valueB: textResult.value, evidenceB: textResult.evidenceRef ?? "unknown", sourceTypeB: "deck",
					conflictReason: "XLSX structured UoF and deck text disagree on use-of-funds buckets; XLSX preferred",
				});
			}
			fields.push({
				category: "use_of_funds",
				field: "use_of_funds_buckets",
				computability: "Computable",
				value: bucketSummary,
				evidenceRef: uof.source.page_ref,
				reasonCode: SLOT_REASON_CODES.DERIVED_FROM_USE_OF_FUNDS,
				source: "xlsx",
			});
		} else if (textResult.computability === "Computable") {
			// 2nd: text pattern hit on deck pages
			fields.push(textResult);
		} else {
			// Ask-slide fallback: allocation table on the Ask/raise slide.
			const askHit = !dpuLoadFailed ? detectAskSlideAllocation(dpuPages) : null;
			if (askHit) {
				fields.push({
					category: "use_of_funds",
					field: "use_of_funds_buckets",
					computability: "Computable",
					value: askHit.snippet,
					evidenceRef: askHit.ref,
					reasonCode: null,
				});
			} else {
				// 4th fallback: implied capital allocation (budget-model derived from excel_sheet pages).
				const ica = inputs.impliedCapitalAllocation;
				const icaBuckets = ica?.buckets.filter((b) => b.annual_cost_usd != null && b.annual_cost_usd > 0) ?? [];
				if (ica && icaBuckets.length > 0 && ica.source.page_refs.length > 0) {
					const bucketSummary = icaBuckets
						.map((b) => {
							const parts: string[] = [b.category];
							if (b.annual_cost_usd != null) parts.push(`$${b.annual_cost_usd.toLocaleString("en-US")}`);
							if (b.pct_of_total != null) parts.push(`${(b.pct_of_total * 100).toFixed(1)}%`);
							return parts.join(" ");
						})
						.join(", ");
					fields.push({
						category: "use_of_funds",
						field: "use_of_funds_buckets",
						computability: "Computable",
						value: `${bucketSummary} (IMPLIED from budget model)`,
						evidenceRef: ica.source.page_refs[0]!,
						reasonCode: SLOT_REASON_CODES.DERIVED_FROM_BUDGET_MODEL,
						source: "xlsx",
					});
				} else {
					fields.push(textResult);
				}
			}
		}
	}

	// ── Financial Health (Phase K — balance sheet + cash flow + bank txns) ────
	{
		const bs  = inputs.balanceSheet;
		const cf  = inputs.cashFlow;
		const btx = inputs.bankTransactions;

		// cash_balance: balance sheet > cash flow ending cash > bank ending balance
		const cfEndingCash = cf?.ending_cash?.[cf?.periods?.[0] ?? ""] ?? null;
		const cashLatest = bs?.derived?.cash_latest ?? cfEndingCash ?? btx?.ending_balance ?? null;
		if (cashLatest != null) {
			const src = bs ? bs.source.page_ref : cf ? cf.source.page_ref : btx!.source.page_ref;
			fields.push({ category: "financial_health", field: "cash_balance", computability: "Computable", value: `$${cashLatest.toLocaleString("en-US")} (XLSX)`, evidenceRef: src, reasonCode: SLOT_REASON_CODES.DERIVED_FROM_BALANCE_SHEET, source: "xlsx" });
		} else {
			fields.push({ category: "financial_health", field: "cash_balance", computability: "NotComputable", value: null, evidenceRef: null, reasonCode: "NO_CASH_BALANCE_DATA" });
		}

		// debt_outstanding: from balance sheet
		const debtLatest = bs?.derived?.debt_latest ?? null;
		if (debtLatest != null) {
			fields.push({ category: "financial_health", field: "debt_outstanding", computability: "Computable", value: `$${debtLatest.toLocaleString("en-US")} (XLSX)`, evidenceRef: bs!.source.page_ref, reasonCode: SLOT_REASON_CODES.DERIVED_FROM_BALANCE_SHEET, source: "xlsx" });
		} else {
			fields.push({ category: "financial_health", field: "debt_outstanding", computability: "NotComputable", value: null, evidenceRef: null, reasonCode: "NO_DEBT_DATA" });
		}

		// net_cash_burn_monthly: cash flow ops > bank transactions
		const burnMonthly = cf?.derived?.monthly_burn_from_ops ?? btx?.derived?.monthly_burn ?? null;
		const burnSrc     = cf ? cf.source.page_ref : btx ? btx.source.page_ref : null;
		if (burnMonthly != null && burnSrc) {
			fields.push({ category: "financial_health", field: "net_cash_burn_monthly", computability: "Computable", value: `$${burnMonthly.toLocaleString("en-US")}/mo (XLSX)`, evidenceRef: burnSrc, reasonCode: SLOT_REASON_CODES.DERIVED_FROM_CASH_FLOW, source: "xlsx" });
		} else {
			fields.push({ category: "financial_health", field: "net_cash_burn_monthly", computability: "NotComputable", value: null, evidenceRef: null, reasonCode: "NO_BURN_DATA" });
		}

		// runway_months: derived when both cash and burn available
		const runwayMonths = cf?.derived?.runway_months ?? null;
		if (runwayMonths != null) {
			fields.push({ category: "financial_health", field: "runway_months", computability: "Computable", value: `${runwayMonths.toFixed(1)} months (XLSX)`, evidenceRef: cf!.source.page_ref, reasonCode: SLOT_REASON_CODES.DERIVED_FROM_CASH_FLOW, source: "xlsx" });
		} else if (cashLatest != null && burnMonthly != null && burnMonthly > 0) {
			const computed = cashLatest / burnMonthly;
			const src2 = burnSrc ?? (bs ? bs.source.page_ref : null);
			fields.push({ category: "financial_health", field: "runway_months", computability: "Computable", value: `${computed.toFixed(1)} months (computed: cash ÷ burn)`, evidenceRef: src2 ?? "unknown", reasonCode: SLOT_REASON_CODES.DERIVED_FROM_CASH_FLOW, source: "xlsx" });
		} else {
			fields.push({ category: "financial_health", field: "runway_months", computability: "NotComputable", value: null, evidenceRef: null, reasonCode: "NO_RUNWAY_DATA" });
		}
	}

	// ── SaaS Metrics (Phase K — saas_kpis sheet) ──────────────────────────────
	{
		const kpi    = inputs.saasKpis;
		const latest = kpi?.periods?.[0] ?? null;

		// Period-keyed records — use first period or "P0" key
		const churnPct     = typeof latest === "string" && latest ? (kpi?.churn_pct?.[latest] ?? kpi?.churn_pct?.["P0"] ?? null) : (kpi?.churn_pct?.["P0"] ?? null);
		const retentionPct = typeof latest === "string" && latest ? (kpi?.retention_pct?.[latest] ?? kpi?.retention_pct?.["P0"] ?? null) : (kpi?.retention_pct?.["P0"] ?? null);
		const cacVal       = typeof latest === "string" && latest ? (kpi?.cac?.[latest] ?? kpi?.cac?.["P0"] ?? null) : (kpi?.cac?.["P0"] ?? null);
		const ltvVal       = typeof latest === "string" && latest ? (kpi?.ltv?.[latest] ?? kpi?.ltv?.["P0"] ?? null) : (kpi?.ltv?.["P0"] ?? null);

		if (churnPct != null && kpi) {
			fields.push({ category: "saas_metrics", field: "churn_pct", computability: "Computable", value: `${churnPct.toFixed(2)}% (${latest ?? "latest"}, XLSX)`, evidenceRef: kpi.source.page_ref, reasonCode: SLOT_REASON_CODES.DERIVED_FROM_SAAS_KPI, source: "xlsx" });
		} else {
			fields.push({ category: "saas_metrics", field: "churn_pct", computability: "NotComputable", value: null, evidenceRef: null, reasonCode: "NO_CHURN_PCT_DATA" });
		}

		if (retentionPct != null && kpi) {
			fields.push({ category: "saas_metrics", field: "retention_pct", computability: "Computable", value: `${retentionPct.toFixed(2)}% (${latest ?? "latest"}, XLSX)`, evidenceRef: kpi.source.page_ref, reasonCode: SLOT_REASON_CODES.DERIVED_FROM_SAAS_KPI, source: "xlsx" });
		} else {
			fields.push({ category: "saas_metrics", field: "retention_pct", computability: "NotComputable", value: null, evidenceRef: null, reasonCode: "NO_RETENTION_PCT_DATA" });
		}

		if (cacVal != null && kpi) {
			fields.push({ category: "saas_metrics", field: "cac", computability: "Computable", value: `$${cacVal.toLocaleString("en-US")} CAC (${latest ?? "latest"}, XLSX)`, evidenceRef: kpi.source.page_ref, reasonCode: SLOT_REASON_CODES.DERIVED_FROM_SAAS_KPI, source: "xlsx" });
		} else {
			fields.push({ category: "saas_metrics", field: "cac", computability: "NotComputable", value: null, evidenceRef: null, reasonCode: "NO_CAC_DATA" });
		}

		if (ltvVal != null && kpi) {
			fields.push({ category: "saas_metrics", field: "ltv", computability: "Computable", value: `$${ltvVal.toLocaleString("en-US")} LTV (${latest ?? "latest"}, XLSX)`, evidenceRef: kpi.source.page_ref, reasonCode: SLOT_REASON_CODES.DERIVED_FROM_SAAS_KPI, source: "xlsx" });
		} else {
			fields.push({ category: "saas_metrics", field: "ltv", computability: "NotComputable", value: null, evidenceRef: null, reasonCode: "NO_LTV_DATA" });
		}
	}

	// ── Cap Table (Phase K) ───────────────────────────────────────────────────
	{
		const ct = inputs.capTable;
		const optionPool = ct?.option_pool_pct ?? null;
		if (optionPool != null && ct) {
			fields.push({ category: "cap_table", field: "option_pool_pct", computability: "Computable", value: `${optionPool.toFixed(2)}% (XLSX)`, evidenceRef: ct.source.page_ref, reasonCode: SLOT_REASON_CODES.DERIVED_FROM_CAP_TABLE, source: "xlsx" });
		} else {
			fields.push({ category: "cap_table", field: "option_pool_pct", computability: "NotComputable", value: null, evidenceRef: null, reasonCode: "NO_OPTION_POOL_DATA" });
		}

		if (ct && ct.stakeholders.length > 0) {
			const ownershipSummary = ct.stakeholders
				.filter((s) => s.row_type !== "total")
				.slice(0, 6)
				.map((s) => `${s.name}${s.pct != null ? ` ${s.pct.toFixed(1)}%` : ""}`)
				.join(", ");
			fields.push({ category: "cap_table", field: "ownership_summary", computability: "Computable", value: ownershipSummary, evidenceRef: ct.source.page_ref, reasonCode: SLOT_REASON_CODES.DERIVED_FROM_CAP_TABLE, source: "xlsx" });
		} else {
			fields.push({ category: "cap_table", field: "ownership_summary", computability: "NotComputable", value: null, evidenceRef: null, reasonCode: "NO_CAP_TABLE_DATA" });
		}
	}

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
		const src = f.source ?? "deck";
		return `category=${f.category} | field=${f.field} | computability=Computable | value="${f.value}" | evidence=${f.evidenceRef} | reason=${f.reasonCode ?? "none"} | source=${src}`;
	}
	return `category=${f.category} | field=${f.field} | computability=NotComputable | value=none | evidence=none | reason=${f.reasonCode ?? "UNKNOWN"} | source=unknown`;
}

function formatConflictLine(c: ConflictEntry): string {
	return `field=${c.field} | value_a="${c.valueA}" | evidence_a=${c.evidenceA} | source_a=${c.sourceTypeA} | value_b="${c.valueB}" | evidence_b=${c.evidenceB} | source_b=${c.sourceTypeB} | reason=${c.conflictReason}`;
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
		raise_cap: get("raise_cap"),
		raise_discount: get("raise_discount"),
		note_interest_rate: get("note_interest_rate"),
		note_maturity: get("note_maturity"),
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
		/** Fused canonical facts to persist in report_payload. */
		fusedFacts?: FusedFact[];
		/** Derived financial facts to persist in report_payload. */
		financialFacts?: FinancialFactsV1 | null;
		/** Governed summary record (with fingerprint) to persist in report_payload. */
		governedSummaryRecord?: GovernedSummaryRecord | null;
		/** Governed executive summary record to persist in report_payload. */
		governedExecutiveSummaryRecord?: GovernedExecutiveSummaryRecord | null;
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
			       report_payload    = EXCLUDED.report_payload,
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
				JSON.stringify({ // report_payload: machine-readable facts
					...(opts.fusedFacts ? { fused_facts: opts.fusedFacts } : {}),
					...(opts.financialFacts ? { financial_facts_v1: opts.financialFacts } : {}),
					...(opts.governedSummaryRecord ? { governed_summary_v1: opts.governedSummaryRecord } : {}),
					...(opts.governedExecutiveSummaryRecord ? { governed_executive_summary_v1: opts.governedExecutiveSummaryRecord } : {}),
				}),
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

// ─── Previous fused facts loader ──────────────────────────────────────────────

/**
 * Load the most-recent set of fused canonical facts for a deal from
 * the report_payload of the last persisted report.
 * Returns [] when no prior run exists or the payload has no fused_facts key.
 * Fail-open: any DB error returns [] so history tracking is best-effort and
 * never blocks report generation.
 */
async function loadPreviousFusedFacts(pool: Pool, dealId: string): Promise<FusedFact[]> {
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
async function loadPreviousGovernedSummary(
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
async function loadPreviousGovernedExecSummary(
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
		const [coverage, insightSlotInputs, previousFusedFacts] = await Promise.all([
			loadCoverageSnapshot(pool, dealId),
			loadInsightSlotInputs(pool, dealId, gateState),
			loadPreviousFusedFacts(pool, dealId),
		]);
		const insightSlotsSections = buildInsightSlotsSections(dealId, insightSlotInputs);
		const phase2Sections = buildPhase2Sections(insightSlotInputs);
		const thesisSection = g3OnlyFail
			? buildInvestorThesisStubSection(buildThesisInputs(insightSlotInputs))
			: null;
		const nm = normMetricsFromInputs(insightSlotInputs);
		const fusionResult = fuseDealCanonicalFacts(
			insightSlotInputs.dpuPages, insightSlotInputs.evidenceSnippets, previousFusedFacts
		);
		const fusionSection = buildDealFusionSection(fusionResult);
		const sections = g3OnlyFail
			? buildG3OnlyFailSections(gateState, coverage, insightSlotsSections, phase2Sections, thesisSection, nm)
			: buildGateFailedSections(gateState, coverage, insightSlotsSections, phase2Sections, nm);
		sections.push(fusionSection);

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
			fusedFacts: fusionResult.facts,
			financialFacts: insightSlotInputs.bestFinancialStatement
				? deriveFinancialFactsV1(insightSlotInputs.bestFinancialStatement)
				: null,
		});

		// Best-effort: populate financial fact registry (non-blocking)
		try {
			const factsToUpsert = buildFinancialFactRegistryV1({
				dealId,
				financialStatement: insightSlotInputs.bestFinancialStatement ?? null,
				saasKpis: insightSlotInputs.saasKpis ?? null,
				balanceSheet: insightSlotInputs.balanceSheet ?? null,
				cashFlow: insightSlotInputs.cashFlow ?? null,
				reconciliation: insightSlotInputs.financialReconciliation ?? null,
				deckSignals: insightSlotInputs.deckFinancialSignals ?? null,
			});
			const upserted = await upsertFinancialFactsV1(pool, factsToUpsert);
			console.log(JSON.stringify({
				event: "POPULATE_FINANCIAL_FACTS_V1",
				deal_id: dealId,
				upserted_count: upserted,
				path: "gates_failed",
				ts: new Date().toISOString(),
			}));
		} catch (factErr) {
			console.error(JSON.stringify({
				event: "POPULATE_FINANCIAL_FACTS_V1_ERROR",
				deal_id: dealId,
				error: factErr instanceof Error ? factErr.message : String(factErr),
				path: "gates_failed",
				ts: new Date().toISOString(),
			}));
		}

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
	const [coverage, insightSlotInputs, previousFusedFacts, previousGovernedSummary, previousGovernedExecSummary, dealName] = await Promise.all([
		loadCoverageSnapshot(pool, dealId),
		loadInsightSlotInputs(pool, dealId, gateState),
		loadPreviousFusedFacts(pool, dealId),
		loadPreviousGovernedSummary(pool, dealId),
		loadPreviousGovernedExecSummary(pool, dealId),
		loadDealName(pool, dealId),
	]);
	const insightSlotsSections = buildInsightSlotsSections(dealId, insightSlotInputs);
	const phase2Sections = buildPhase2Sections(insightSlotInputs);
	const thesisSection = buildInvestorThesisStubSection(buildThesisInputs(insightSlotInputs));
	const fusionResult = fuseDealCanonicalFacts(
		insightSlotInputs.dpuPages, insightSlotInputs.evidenceSnippets, previousFusedFacts
	);
	const fusionSection = buildDealFusionSection(fusionResult);
	const productNarrativeBody = buildProductNarrativeBody(insightSlotInputs);
	const governedResult = await buildGovernedSummarySection(
		insightSlotInputs,
		previousGovernedSummary,
		engineVersion,
		VERSION_PINS.governance_version,
		dealName ?? undefined,
		productNarrativeBody ?? undefined
	);
	const governedExecResult = await buildGovernedExecutiveSummarySection(
		insightSlotInputs,
		coverage,
		gateState,
		previousGovernedExecSummary,
		engineVersion,
		VERSION_PINS.governance_version,
		dealName ?? undefined,
		productNarrativeBody ?? undefined
	);
	// Compute canonical fields body for product profile (same source as governed summaries)
	const phase2ForProfile = extractPhase2Result(insightSlotInputs);
	const canonicalFieldsBodyForProfile = phase2ForProfile.fields.length > 0
		? phase2ForProfile.fields.map(formatCanonicalFieldLine).join("\n")
		: null;
	const productProfileSection = await buildProductProfileSection(
		insightSlotInputs,
		canonicalFieldsBodyForProfile,
		dealName ?? undefined
	);
	const sections = buildDeterministicOnlySections(gateState, coverage, insightSlotsSections, phase2Sections, thesisSection, normMetricsFromInputs(insightSlotInputs));
	if (governedResult) {
		const statusIdx = sections.findIndex((s) => s.key === "analysis_status");
		const insertAt = statusIdx >= 0 ? statusIdx + 1 : 2;
		sections.splice(insertAt, 0, governedResult.section);
	}
	if (governedExecResult) {
		// Insert the exec summary immediately before governed_summary_v1 (or at position 2)
		const govSummaryIdx = sections.findIndex((s) => s.key === "governed_summary_v1");
		const insertAt = govSummaryIdx >= 0 ? govSummaryIdx : 2;
		sections.splice(insertAt, 0, governedExecResult.section);
	}
	if (productProfileSection) {
		sections.push(productProfileSection);
	}
	sections.push(fusionSection);
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
		fusedFacts: fusionResult.facts,
		financialFacts: insightSlotInputs.bestFinancialStatement
			? deriveFinancialFactsV1(insightSlotInputs.bestFinancialStatement)
			: null,
		governedSummaryRecord: governedResult?.record ?? null,
		governedExecutiveSummaryRecord: governedExecResult?.record ?? null,
	});

	// Best-effort: populate financial fact registry (non-blocking)
	try {
		const factsToUpsert = buildFinancialFactRegistryV1({
			dealId,
			financialStatement: insightSlotInputs.bestFinancialStatement ?? null,
			saasKpis: insightSlotInputs.saasKpis ?? null,
			balanceSheet: insightSlotInputs.balanceSheet ?? null,
			cashFlow: insightSlotInputs.cashFlow ?? null,
			reconciliation: insightSlotInputs.financialReconciliation ?? null,
			deckSignals: insightSlotInputs.deckFinancialSignals ?? null,
		});
		const upserted = await upsertFinancialFactsV1(pool, factsToUpsert);
		console.log(JSON.stringify({
			event: "POPULATE_FINANCIAL_FACTS_V1",
			deal_id: dealId,
			upserted_count: upserted,
			path: "happy_path",
			ts: new Date().toISOString(),
		}));
	} catch (factErr) {
		console.error(JSON.stringify({
			event: "POPULATE_FINANCIAL_FACTS_V1_ERROR",
			deal_id: dealId,
			error: factErr instanceof Error ? factErr.message : String(factErr),
			path: "happy_path",
			ts: new Date().toISOString(),
		}));
	}

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

// ═══════════════════════════════════════════════════════════════════════════════
// Repair exports — offline slot backfill
//
// Used by apps/worker/src/bin/repair-insight-slots.ts to fix stale reports
// where DPU data was finalized after the investor-insights job last ran.
// These functions WRITE to the DB and must NOT be called from the audit runner.
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Recompute the insight_slots section body for a deal using current DPU data.
 *
 * Runs the same Stage-1 slot evaluation as the main processor, but without
 * requiring a BullMQ Job object or gate state. Intended for offline repair.
 *
 * @returns The newline-joined slot body string.
 */
export async function recomputeInsightSlotBody(
	pool: Pool,
	dealId: string,
): Promise<string> {
	let dpuPages: DpuPage[] = [];
	let evidenceSnippets: EvidenceSnippet[] = [];
	let dpuLoadFailed = false;
	const normEvents: NormalizationEvent[] = [];
	const repairFinancialStatements: FinancialStatementV1[] = [];

	try {
		const { rows } = await pool.query<{ document_id: string; page_index: number; payload: unknown }>(
			`SELECT document_id, page_index, payload
			   FROM public.document_page_understanding
			  WHERE deal_id = $1
			  ORDER BY document_id ASC, page_index ASC
			  LIMIT 500`,
			[dealId]
		);
		dpuPages = rows
			.map((r) => {
				const raw = extractDpuText(r.payload);
				if (!raw) return null;
				const norm = normalizeForExtraction(raw);
				normEvents.push(...norm.events);
				return {
					document_id: r.document_id,
					page_index:  r.page_index,
					text:        norm.text,
					text_raw:    raw,
					norm_events_count: norm.events.length,
				};
			})
			.filter((p): p is DpuPage => p !== null);
		// Parse XLSX financial statements so the repair path can also promote
		// traction_signal via the canonical-to-slot bridge.
		for (const r of rows) {
			const p = r.payload as Record<string, unknown> | null;
			if (!p || p["page_type"] !== "excel_range") continue;
			const pageRef = `dpu:doc:${r.document_id.replace(/-/g, "").slice(0, 8)}:page:${r.page_index}`;
			const stmt = parseFinancialStatementV1(r.payload, { documentId: r.document_id, pageRef });
			if (stmt) repairFinancialStatements.push(stmt);
		}
	} catch {
		dpuLoadFailed = true;
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
				normEvents.push(...norm.events);
				return { ...row, claim_text_norm: norm.text };
			});
		})
		.catch(() => { /* evidence_items is supplemental; failure is non-fatal */ });

	const inputs: InsightSlotInputs = {
		dpuPages,
		evidenceSnippets,
		dpuLoadFailed,
		g3Passed: true, // repair assumes gates already passed for persisted reports
		dpuDiag: {
			queryOk:        !dpuLoadFailed,
			rowCount:       dpuPages.length,
			usablePageCount: dpuPages.length,
			sample:         dpuPages[0] ? `${dpuPages[0].page_index}: ${dpuPages[0].text.slice(0, 80)}` : "n/a",
		},
		normEvents,
		financialStatements: repairFinancialStatements,
		bestFinancialStatement: pickBestStatement(repairFinancialStatements),
		useOfFundsStatements: [],
		bestUseOfFundsStatement: null,
		impliedCapitalAllocation: null,
		impliedFromIncomeStatement: null,
		financialLayoutClassification: null,
		financialReconciliation: null,
		balanceSheet: null,
		cashFlow: null,
		capTable: null,
		saasKpis: null,
		bankTransactions: null,
		deckFinancialSignals: null,
	};

	return buildInsightSlotsSection(inputs).body ?? "";
}

/**
 * Repair the stored insight_slots section for a deal.
 *
 * Reads the current DPU data, re-evaluates all 5 slot detectors, and replaces
 * the insight_slots body in the most recent investor_insight_reports row.
 * If the insight_slots section is absent from render_package.sections it is
 * appended; if no report row exists the deal is skipped.
 *
 * All other render_package fields are left untouched.
 *
 * @returns Object with updated flag, newBody, and oldBody (null when absent).
 */
export async function repairInsightSlotsInReport(
	pool: Pool,
	dealId: string,
): Promise<{ updated: boolean; newBody: string; oldBody: string | null }> {
	const newBody = await recomputeInsightSlotBody(pool, dealId);

	// Fetch the latest report row
	const { rows: existing } = await pool.query<{
		id: string;
		render_package: unknown;
	}>(
		`SELECT id, render_package
		   FROM public.investor_insight_reports
		  WHERE deal_id = $1
		  ORDER BY updated_at DESC
		  LIMIT 1`,
		[dealId]
	);

	if (existing.length === 0) {
		// No report exists for this deal — cannot repair in-place
		return { updated: false, newBody, oldBody: null };
	}

	const { id: reportId, render_package } = existing[0]!;
	const rp = (render_package ?? {}) as { sections?: Array<Record<string, unknown>> };
	const sections: Array<Record<string, unknown>> = Array.isArray(rp.sections) ? [...rp.sections] : [];

	// Find existing insight_slots section
	const existingIdx = sections.findIndex((s) => s["key"] === "insight_slots");
	const oldBody: string | null =
		existingIdx >= 0 && typeof sections[existingIdx]!["body"] === "string"
			? (sections[existingIdx]!["body"] as string)
			: null;

	const newSection = {
		key:      "insight_slots",
		title:    "Deterministic Insight Slots",
		kind:     "message",
		body:     newBody,
		fallback: "Insight slot extraction unavailable.",
	};

	if (existingIdx >= 0) {
		sections[existingIdx] = newSection;
	} else {
		// Section absent (very old report) — append it
		sections.push(newSection);
	}

	const updatedRp = { ...rp, sections };

	await pool.query(
		`UPDATE public.investor_insight_reports
		    SET render_package = $2::jsonb,
		        updated_at     = NOW()
		  WHERE id = $1`,
		[reportId, JSON.stringify(updatedRp)]
	);

	return { updated: true, newBody, oldBody };
}

// ── Internal exports (unit tests only — not part of public API) ────────────────
/**
 * @internal
 * Exposes deterministic section-builder functions for unit testing.
 * Do not import these in production code paths.
 */
export const _sectionBuilders = {
	buildDeterministicOnlySections,
	buildG3OnlyFailSections,
	buildGateFailedSections,
};
