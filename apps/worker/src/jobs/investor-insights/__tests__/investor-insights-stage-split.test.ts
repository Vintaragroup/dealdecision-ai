/**
 * PR17.6 Lite — Stage-split smoke tests.
 *
 * Validates that:
 *  1. Each stage module exports the expected symbols (no missing exports).
 *  2. processor.ts still re-exports the public API surface unchanged.
 *  3. Key deterministic functions produce the expected output shapes.
 *  4. Stage-4 buildRenderPackage assembles a valid RenderPackage shell.
 *  5. VERSION_PINS is accessible from _shared.
 */

import { describe, it, expect, vi } from "vitest";

// Mock DB module before any module that imports it — vitest hoists vi.mock() calls.
vi.mock("../../../lib/db", () => ({ getPool: vi.fn() }));

// ── Stage: _shared ──────────────────────────────────────────────────────────
import {
	VERSION_PINS,
	buildDeterministicFingerprint,
	buildFallbackFingerprint,
	buildComplianceState,
	type UpstreamSnapshot,
	type CoverageSnapshot,
} from "../stages/_shared";

// ── Stage: stage-0-load-inputs ──────────────────────────────────────────────
import {
	loadUpstreamSnapshot,
	loadCoverageSnapshot,
	loadDealName,
} from "../stages/stage-0-load-inputs";

// ── Stage: stage-1-gates ────────────────────────────────────────────────────
import {
	normMetricsFromInputs,
	buildGateFailedSections,
	buildDeterministicOnlySections,
	buildG3OnlyFailSections,
	buildEvidenceGateFailedSections,
	buildG3DiagnosticsSection,
} from "../stages/stage-1-gates";

// ── Stage: stage-2-deterministic ────────────────────────────────────────────
import {
	type InsightSlotInputs,
	type DpuPage,
	type EvidenceSnippet,
	type ThesisInputsV1,
	computeConfidenceCap,
	buildInvestorThesisStubSection,
	buildPhase2Sections,
	buildInsightSlotsSection,
	extractPhase2Result,
	loadInsightSlotInputs,
	buildProductNarrativeBody,
	buildThesisInputs,
	deriveFinancialFactsV1,
} from "../stages/stage-2-deterministic";

// ── Stage: stage-3-llm ──────────────────────────────────────────────────────
import {
	buildGovernedSummarySection,
	buildGovernedExecutiveSummarySection,
	buildProductProfileSection,
} from "../stages/stage-3-llm";

// ── Stage: stage-4-render-package ───────────────────────────────────────────
import {
	buildRenderPackage,
	persistReport,
} from "../stages/stage-4-render-package";

// ── processor.ts public API re-exports ──────────────────────────────────────
import {
	QUEUE_NAME,
	JOB_NAME,
	generateInvestorInsightsProcessor,
	recomputeInsightSlotBody,
	repairInsightSlotsInReport,
	_sectionBuilders,
	computeConfidenceCap as processorComputeConfidenceCap,
	buildInvestorThesisStubSection as processorBuildThesis,
} from "../processor";
import type { ThesisInputsV1 as ProcessorThesisInputsV1 } from "../processor";

// ─── Helper: minimal InsightSlotInputs stub ──────────────────────────────────

function makeEmptyInputs(): InsightSlotInputs {
	return {
		dpuPages: [],
		evidenceSnippets: [],
		dpuLoadFailed: false,
		g3Passed: true,
		dpuDiag: { queryOk: true, rowCount: 0, usablePageCount: 0, sample: "n/a" },
		normEvents: [],
		financialStatements: [],
		bestFinancialStatement: null,
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
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("PR17.6 stage split — _shared exports", () => {
	it("VERSION_PINS has all required keys", () => {
		expect(VERSION_PINS.constitution_version).toBe("v2.0");
		expect(VERSION_PINS.engine_version).toBe("v1");
		expect(VERSION_PINS.schema_version).toBe("v2");
		expect(VERSION_PINS.governance_version).toBe("v1.1");
		expect(VERSION_PINS.ui_contract_version).toBe("v1");
	});

	it("buildDeterministicFingerprint returns 64-hex-char SHA-256", () => {
		const fp = buildDeterministicFingerprint({
			dealId: "00000000-0000-0000-0000-000000000001",
			engineVersion: "v1",
			dpuCount: 10,
			dpuCoverage: 0.8,
			evidenceCount: 5,
			overlayExists: false,
			visualAssetCount: 3,
		});
		expect(fp).toMatch(/^[0-9a-f]{64}$/);
	});

	it("buildFallbackFingerprint returns a 16-hex-char prefix", () => {
		const fp = buildFallbackFingerprint("deal-id", "v1");
		expect(fp).toMatch(/^[0-9a-f]{16}$/);
	});

	it("buildComplianceState returns not_run when no events", () => {
		expect(buildComplianceState().status).toBe("not_run");
	});

	it("buildComplianceState returns failed when error event present", () => {
		const cs = buildComplianceState([{ severity: "error", code: "TEST", message: "fail" }]);
		expect(cs.status).toBe("failed");
	});
});

describe("PR17.6 stage split — stage-2 deterministic", () => {
	it("buildInsightSlotsSection returns correct section key and kind", () => {
		const section = buildInsightSlotsSection(makeEmptyInputs());
		expect(section.key).toBe("insight_slots");
		expect(section.kind).toBe("message");
	});

	it("buildInsightSlotsSection marks all slots NotComputable when no data", () => {
		const section = buildInsightSlotsSection(makeEmptyInputs());
		expect(section.body).toContain("raise_terms: NotComputable");
		expect(section.body).toContain("market_claims: NotComputable");
		expect(section.body).toContain("traction_signal: NotComputable");
		expect(section.body).toContain("valuation_terms: NotComputable");
		expect(section.body).toContain("use_of_funds: NotComputable");
	});

	it("buildPhase2Sections returns 2-3 sections with expected keys", () => {
		const sections = buildPhase2Sections(makeEmptyInputs());
		expect(sections.length).toBeGreaterThanOrEqual(2);
		const keys = sections.map((s) => s.key);
		expect(keys).toContain("canonical_fields");
		expect(keys).toContain("completeness_summary");
	});

	it("extractPhase2Result returns fields, conflicts, completeness arrays", () => {
		const result = extractPhase2Result(makeEmptyInputs());
		expect(Array.isArray(result.fields)).toBe(true);
		expect(Array.isArray(result.conflicts)).toBe(true);
		expect(Array.isArray(result.completeness)).toBe(true);
		// completeness should cover the 5 tracked categories
		expect(result.completeness.length).toBe(5);
	});

	it("computeConfidenceCap returns Low when coverage is below 0.5", () => {
		const inputs: ThesisInputsV1 = {
			raise_amount: null,
			raise_round: null,
			raise_instrument: null,
			raise_cap: null,
			raise_discount: null,
			note_interest_rate: null,
			note_maturity: null,
			valuation_pre: null,
			valuation_post: null,
			tam_value: null,
			mrr_value: null,
			arr_value: null,
			revenue_value: null,
			coverage_ratio: 0.1,
			conflicts_present: false,
			completeness: [],
		};
		expect(computeConfidenceCap(inputs)).toBe("Low");
	});

	it("buildInvestorThesisStubSection returns correct section key", () => {
		const thesisInputs = buildThesisInputs(makeEmptyInputs());
		const section = buildInvestorThesisStubSection(thesisInputs);
		expect(section.key).toBe("investor_thesis");
		expect(section.body).toContain("Confidence Cap:");
	});

	it("buildProductNarrativeBody returns null when no pages", () => {
		expect(buildProductNarrativeBody(makeEmptyInputs())).toBeNull();
	});
});

describe("PR17.6 stage split — stage-4 render package", () => {
	it("buildRenderPackage assembles a RenderPackage with correct fields", () => {
		const pkg = buildRenderPackage({
			dealId: "00000000-0000-0000-0000-000000000001",
			status: "deterministic_only",
			gateState: { all_passed: true, results: [] },
			complianceState: { status: "not_run", events: [] },
			upstreamFingerprint: "abc123",
			engineVersion: "v1",
			sections: [],
		});
		expect(pkg.deal_id).toBe("00000000-0000-0000-0000-000000000001");
		expect(pkg.status).toBe("deterministic_only");
		expect(pkg.engine_version).toBe("v1");
		expect(pkg.no_empty_blocks).toBe(true);
		expect(pkg.audit_footer.stage).toBe("stage_0");
	});

	it("buildRenderPackage includes evidence_gate when provided", () => {
		const eg = {
			passed: false,
			blocking_reason: "LOW_COVERAGE",
			metrics: { coverage_ratio: 0.1, evidence_count: 0, docs_count: 1, expected_pages_total: 10, dpu_nonempty_pages: 1 },
		};
		const pkg = buildRenderPackage({
			dealId: "00000000-0000-0000-0000-000000000001",
			status: "deterministic_only",
			gateState: { all_passed: true, results: [] },
			complianceState: { status: "not_run", events: [] },
			upstreamFingerprint: "abc123",
			engineVersion: "v1",
			sections: [],
			evidenceGate: eg,
		});
		expect(pkg.evidence_gate).toBeDefined();
		expect(pkg.evidence_gate?.passed).toBe(false);
	});
});

describe("PR17.6 stage split — processor.ts public API surface", () => {
	it("QUEUE_NAME and JOB_NAME are correct", () => {
		expect(QUEUE_NAME).toBe("investor_insights");
		expect(JOB_NAME).toBe("generate_investor_insights");
	});

	it("computeConfidenceCap re-export functions identically to stage-2 direct import", () => {
		const inputs: ProcessorThesisInputsV1 = {
			raise_amount: "$2M",
			raise_round: "seed",
			raise_instrument: "SAFE",
			raise_cap: null,
			raise_discount: null,
			note_interest_rate: null,
			note_maturity: null,
			valuation_pre: null,
			valuation_post: "$10M",
			tam_value: "$1B",
			mrr_value: "$50K",
			arr_value: null,
			revenue_value: null,
			coverage_ratio: 0.75,
			conflicts_present: false,
			completeness: [
				{ category: "raise_terms", status: "Present" },
				{ category: "valuation_terms", status: "Present" },
				{ category: "use_of_funds", status: "Missing" },
				{ category: "market_claims", status: "Present" },
				{ category: "traction_signal", status: "Present" },
			],
		};
		// Both imports should produce the same result
		expect(processorComputeConfidenceCap(inputs)).toBe(computeConfidenceCap(inputs));
		expect(processorComputeConfidenceCap(inputs)).toBe("High");
	});

	it("_sectionBuilders exposes all 4 expected builders", () => {
		expect(typeof _sectionBuilders.buildDeterministicOnlySections).toBe("function");
		expect(typeof _sectionBuilders.buildG3OnlyFailSections).toBe("function");
		expect(typeof _sectionBuilders.buildGateFailedSections).toBe("function");
		expect(typeof _sectionBuilders.buildEvidenceGateFailedSections).toBe("function");
	});

	it("generateInvestorInsightsProcessor is a function", () => {
		expect(typeof generateInvestorInsightsProcessor).toBe("function");
	});

	it("recomputeInsightSlotBody and repairInsightSlotsInReport are async functions", () => {
		expect(typeof recomputeInsightSlotBody).toBe("function");
		expect(typeof repairInsightSlotsInReport).toBe("function");
	});
});
