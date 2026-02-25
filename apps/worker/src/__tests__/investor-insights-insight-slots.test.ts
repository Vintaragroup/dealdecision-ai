/**
 * Tests for Stage 1 deterministic insight slot extraction.
 *
 * Coverage:
 *   - raise_terms: Computable when "Raising $2M seed" found in DPU page_text
 *   - raise_terms: NotComputable with NO_RAISE_MENTION when absent
 *   - market_claims: Computable when TAM mention found
 *   - traction_signal: Computable when MRR mention found
 *   - insight_slots section present and ordered before coverage_snapshot
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

process.env["NODE_ENV"] = "production";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://user:pass@localhost:5432/test";
process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

// ── Pool factory ─────────────────────────────────────────────────────────────

/**
 * Build a mock pool from a page_text string.
 * The DPU insight-slot query selects document_id, page_index, payload;
 * distinguishable from the coverage-snapshot DPU query which uses COUNT.
 */
const makeDpuPool = (pageText: string) => ({
	query: vi.fn(async (sql: string) => {
		if (sql.includes("current_database")) return { rows: [{ db: "testdb", schema: "public" }] };
		if (sql.includes("investor_insight_reports")) return { rows: [{ id: "mock-report-id" }] };
		// Insight slot DPU query (SELECT document_id, page_index, payload ... LIMIT 50)
		if (sql.includes("document_id") && sql.includes("document_page_understanding")) {
			// Use a real UUID-shaped document_id so dpuEvidenceRef produces 8 clean hex chars: "a1b2c3d4".
			return {
				rows: pageText
					? [{ document_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890", page_index: 3, payload: { page_text: pageText } }]
					: [],
			};
		}
		// Coverage snapshot DPU query (SELECT COUNT … non_empty …)
		if (sql.includes("COUNT") && sql.includes("document_page_understanding")) {
			return { rows: [{ total: "5", non_empty: "4" }] };
		}
		// Evidence items (both coverage count and insight slot query)
		if (sql.includes("evidence_items")) return { rows: [{ c: "3", id: "ev-1", claim_text: null }] };
		// Documents count
		if (sql.includes("documents") && sql.includes("COUNT") && !sql.includes("visual_assets")) {
			return { rows: [{ c: "2" }] };
		}
		// Visual assets count
		if (sql.includes("visual_assets")) return { rows: [{ c: "4" }] };
		return { rows: [] };
	}),
});

let mockPool = makeDpuPool("");

vi.mock("../lib/db", () => ({
	getPool: () => mockPool,
	closePool: vi.fn(async () => undefined),
}));

// ── Gate state fixtures ───────────────────────────────────────────────────────

import type { GateState } from "../contracts/investor-insights/schemas";

const g3OnlyFailGateState = (): GateState => ({
	all_passed: false,
	results: [
		{ gate: "G0", passed: true },
		{ gate: "G1", passed: true },
		{ gate: "G2", passed: true },
		{ gate: "G3", passed: false, reason_code: "GATE_STRUCTURED_JSON_MISSING" },
		{ gate: "G4", passed: true },
		{ gate: "G5", passed: true },
	],
});

const allFailGateState = (): GateState => ({
	all_passed: false,
	results: [
		{ gate: "G0", passed: true },
		{ gate: "G1", passed: false, reason_code: "GATE_DPU_MISSING" },
		{ gate: "G2", passed: true },
		{ gate: "G3", passed: false, reason_code: "GATE_STRUCTURED_JSON_MISSING" },
		{ gate: "G4", passed: true },
		{ gate: "G5", passed: true },
	],
});

const mockEvaluateGates = vi.fn(async (..._args: unknown[]): Promise<GateState> => g3OnlyFailGateState());

vi.mock("../jobs/investor-insights/gates", () => ({
	evaluateGates: (...args: unknown[]) => mockEvaluateGates(...args),
}));

// ── Import processor after mocks ──────────────────────────────────────────────

const { generateInvestorInsightsProcessor } = await import(
	"../jobs/investor-insights/processor"
);

function makeJob(dealId = "517be946-cab9-4bc1-8982-9522ff9dab32") {
	return { id: "job-1", data: { deal_id: dealId, engine_version: "v1" } } as any;
}

function getInsertedRenderPkg(): any {
	const calls = mockPool.query.mock.calls as Array<[string, ...unknown[]]>;
	const insertCall = calls.find(
		([sql]) => sql.includes("investor_insight_reports") && sql.trimStart().startsWith("INSERT")
	);
	expect(insertCall).toBeTruthy();
	return JSON.parse((insertCall as [string, unknown[]])[1]![6] as string);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Stage 1 – Deterministic Insight Slots", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockEvaluateGates.mockResolvedValue(g3OnlyFailGateState());
	});

	it("insight_slots section is present before coverage_snapshot in g3-only-fail output", async () => {
		mockPool = makeDpuPool("No financial details mentioned here.");

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const keys: string[] = pkg.sections.map((s: any) => s.key);
		expect(keys).toContain("insight_slots");
		expect(keys).toContain("coverage_snapshot");

		const slotsIdx = keys.indexOf("insight_slots");
		const coverageIdx = keys.indexOf("coverage_snapshot");
		expect(slotsIdx).toBeLessThan(coverageIdx);
	});

	it("insight_slots section is present in fail-closed output", async () => {
		mockPool = makeDpuPool("");
		mockEvaluateGates.mockResolvedValue(allFailGateState());

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const keys: string[] = pkg.sections.map((s: any) => s.key);
		expect(keys).toContain("insight_slots");
		const slotsIdx = keys.indexOf("insight_slots");
		const coverageIdx = keys.indexOf("coverage_snapshot");
		expect(slotsIdx).toBeLessThan(coverageIdx);
	});

	it("raise_terms is Computable with evidence ref when DPU contains 'Raising $2M seed'", async () => {
		mockPool = makeDpuPool("Raising $2M seed round to expand our product.");

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const slotsSection = pkg.sections.find((s: any) => s.key === "insight_slots");
		expect(slotsSection).toBeTruthy();
		expect(slotsSection.body).toMatch(/raise_terms: Computable/);
  expect(slotsSection.body).toMatch(/evidence=dpu:doc:[0-9a-f]{8}:page:\d+/);
		expect(slotsSection.body).toMatch(/value="[^"]+"/);
		expect(slotsSection.body).toMatch(/reason=none/);
	});

	it("raise_terms is NotComputable with NO_RAISE_MENTION when DPU has no raise content", async () => {
		mockPool = makeDpuPool("Our product helps small businesses manage invoices.");

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const slotsSection = pkg.sections.find((s: any) => s.key === "insight_slots");
		expect(slotsSection).toBeTruthy();
		expect(slotsSection.body).toMatch(/raise_terms: NotComputable \| value=none \| evidence=none \| reason=NO_RAISE_MENTION/);
	});

	it("market_claims is Computable when DPU contains a TAM figure", async () => {
		mockPool = makeDpuPool("The TAM is $50B globally with strong growth trends.");

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const slotsSection = pkg.sections.find((s: any) => s.key === "insight_slots");
		expect(slotsSection.body).toMatch(/market_claims: Computable/);
		expect(slotsSection.body).toMatch(/evidence=dpu:doc:[0-9a-f]{8}:page:\d+/);
		expect(slotsSection.body).toMatch(/reason=none/);
	});

	it("market_claims is NotComputable with NO_MARKET_CLAIM_MENTION when absent", async () => {
		mockPool = makeDpuPool("We are raising $2M seed.");

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const slotsSection = pkg.sections.find((s: any) => s.key === "insight_slots");
		expect(slotsSection.body).toMatch(/market_claims: NotComputable \| value=none \| evidence=none \| reason=NO_MARKET_CLAIM_MENTION/);
	});

	it("market_claims is Computable for dollar-first '$10.5B+ TAM SAM SOM'", async () => {
		mockPool = makeDpuPool("The company targets a $10.5B+ TAM SAM SOM opportunity in logistics.");

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const slotsSection = pkg.sections.find((s: any) => s.key === "insight_slots");
		expect(slotsSection.body).toMatch(/market_claims: Computable/);
		expect(slotsSection.body).toMatch(/evidence=dpu:doc:[0-9a-f]{8}:page:\d+/);
		expect(slotsSection.body).toMatch(/reason=none/);
	});

	it("market_claims is Computable for range format '$600-900M TAM'", async () => {
		mockPool = makeDpuPool("We estimate a $600-900M TAM based on 2025 industry data.");

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const slotsSection = pkg.sections.find((s: any) => s.key === "insight_slots");
		expect(slotsSection.body).toMatch(/market_claims: Computable/);
		expect(slotsSection.body).toMatch(/evidence=dpu:doc:[0-9a-f]{8}:page:\d+/);
		expect(slotsSection.body).toMatch(/reason=none/);
	});

	it("market_claims is NotComputable when dollar amount appears without TAM/SAM/SOM anchor", async () => {
		mockPool = makeDpuPool("We generated $2M revenue last year with 40% margins.");

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const slotsSection = pkg.sections.find((s: any) => s.key === "insight_slots");
		expect(slotsSection.body).toMatch(/market_claims: NotComputable \| value=none \| evidence=none \| reason=NO_MARKET_CLAIM_MENTION/);
	});

	it("traction_signal is Computable when DPU contains an MRR figure", async () => {
		mockPool = makeDpuPool("Our MRR is $50K and growing 20% month over month.");

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const slotsSection = pkg.sections.find((s: any) => s.key === "insight_slots");
		expect(slotsSection.body).toMatch(/traction_signal: Computable/);
		expect(slotsSection.body).toMatch(/evidence=dpu:doc:[0-9a-f]{8}:page:\d+/);
		expect(slotsSection.body).toMatch(/reason=none/);
	});

	it("traction_signal is NotComputable with NO_TRACTION_SIGNAL_MENTION when absent", async () => {
		mockPool = makeDpuPool("Our product helps small businesses manage invoices.");

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const slotsSection = pkg.sections.find((s: any) => s.key === "insight_slots");
		expect(slotsSection.body).toMatch(/traction_signal: NotComputable \| value=none \| evidence=none \| reason=NO_TRACTION_SIGNAL_MENTION/);
	});

	it("all three slots computable when DPU page contains all signals", async () => {
		mockPool = makeDpuPool(
			"Raising $2M seed. TAM $5B market. MRR $30K and growing."
		);

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const slotsSection = pkg.sections.find((s: any) => s.key === "insight_slots");
		expect(slotsSection.body).toMatch(/raise_terms: Computable/);
		expect(slotsSection.body).toMatch(/market_claims: Computable/);
		expect(slotsSection.body).toMatch(/traction_signal: Computable/);
	});

	it("valuation_terms is Computable with evidence ref when DPU contains 'post-money valuation'", async () => {
		mockPool = makeDpuPool("Our post-money valuation is $10M on this round.");

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const slotsSection = pkg.sections.find((s: any) => s.key === "insight_slots");
		expect(slotsSection).toBeTruthy();
		expect(slotsSection.body).toMatch(/valuation_terms: Computable/);
		expect(slotsSection.body).toMatch(/evidence=dpu:doc:[0-9a-f]{8}:page:\d+/);
		expect(slotsSection.body).toMatch(/value="[^"]+"/);
		expect(slotsSection.body).toMatch(/reason=none/);
	});

	it("valuation_terms is NotComputable with NO_VALUATION_MENTION when absent", async () => {
		mockPool = makeDpuPool("We help small businesses manage their invoices efficiently.");

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const slotsSection = pkg.sections.find((s: any) => s.key === "insight_slots");
		expect(slotsSection).toBeTruthy();
		expect(slotsSection.body).toMatch(
			/valuation_terms: NotComputable \| value=none \| evidence=none \| reason=NO_VALUATION_MENTION/
		);
	});

	it("use_of_funds is Computable with evidence ref when DPU contains 'use of funds'", async () => {
		mockPool = makeDpuPool("Use of funds: 40% product development, 30% sales, 30% operations.");

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const slotsSection = pkg.sections.find((s: any) => s.key === "insight_slots");
		expect(slotsSection).toBeTruthy();
		expect(slotsSection.body).toMatch(/use_of_funds: Computable/);
		expect(slotsSection.body).toMatch(/evidence=dpu:doc:[0-9a-f]{8}:page:\d+/);
		expect(slotsSection.body).toMatch(/value="[^"]+"/);
		expect(slotsSection.body).toMatch(/reason=none/);
	});

	it("use_of_funds is NotComputable with NO_USE_OF_FUNDS_MENTION when absent", async () => {
		mockPool = makeDpuPool("Our MRR is $50K and growing 20% month over month.");

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const slotsSection = pkg.sections.find((s: any) => s.key === "insight_slots");
		expect(slotsSection).toBeTruthy();
		expect(slotsSection.body).toMatch(
			/use_of_funds: NotComputable \| value=none \| evidence=none \| reason=NO_USE_OF_FUNDS_MENTION/
		);
	});
});

// ── DPU Diagnostics tests (dev mode) ─────────────────────────────────────────

describe("Stage 1 – DPU diagnostics (dev mode)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		process.env["NODE_ENV"] = "development";
		mockEvaluateGates.mockResolvedValue(g3OnlyFailGateState());
	});

	afterEach(() => {
		process.env["NODE_ENV"] = "production";
	});

	it("DPU query throws → all slots are DPU_LOAD_FAILED and debug.dpu_diagnostics has query_ok: false", async () => {
		// Pool that throws on the DPU slot query (document_id + document_page_understanding).
		mockPool = {
			query: vi.fn(async (sql: string) => {
				if (sql.includes("current_database")) return { rows: [{ db: "testdb", schema: "public" }] };
				if (sql.includes("investor_insight_reports") && (sql as string).trimStart().startsWith("INSERT")) {
					return { rows: [{ id: "mock-report-id" }] };
				}
				if (sql.includes("investor_insight_reports")) return { rows: [] };
				if (sql.includes("document_id") && sql.includes("document_page_understanding")) {
					throw Object.assign(new Error("relation does not exist"), { code: "42P01" });
				}
				if (sql.includes("document_page_understanding")) return { rows: [{ total: "3", non_empty: "2" }] };
				if (sql.includes("evidence_items")) return { rows: [] };
				if (sql.includes("documents") && !sql.includes("visual_assets")) return { rows: [{ c: "2" }] };
				if (sql.includes("visual_assets")) return { rows: [{ c: "4" }] };
				return { rows: [] };
			}),
		} as any;

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		// All slots should be DPU_LOAD_FAILED
		const slotsSection = pkg.sections.find((s: any) => s.key === "insight_slots");
		expect(slotsSection).toBeTruthy();
		expect(slotsSection.body).toMatch(/raise_terms: NotComputable.*reason=DPU_LOAD_FAILED/);
		expect(slotsSection.body).toMatch(/market_claims: NotComputable.*reason=DPU_LOAD_FAILED/);

		// debug.dpu_diagnostics section must be present with query_ok: false
		const diagSection = pkg.sections.find((s: any) => s.key === "debug.dpu_diagnostics");
		expect(diagSection).toBeTruthy();
		expect(diagSection.body).toMatch(/query_ok: false/);
		expect(diagSection.body).toMatch(/error_code: 42P01/);
		expect(diagSection.body).toMatch(/error: relation does not exist/);
	});

	// ── Regression: RAISE_AMOUNT_PATTERN Form G / H (OCR-label patterns) ───────
	//
	// Bug: raise_terms slot used a simpler RAISE_PATTERN that required the dollar
	// sign to immediately follow the raise keyword.  OCR slide-layout labels such as
	// "Raise: $4M" (Form G) and "Financial Strategy Raise: a $4M" (Form H) were
	// skipped, producing slot=NotComputable while canonical raise_amount=Computable
	// on the same page.  The fix delegates the slot to RAISE_AMOUNT_PATTERN.

	it("raise_terms is Computable for Form G OCR label 'Raise: $4M' (colon-separated)", async () => {
		mockPool = makeDpuPool("Financial Strategy Raise: $4M post close to scale operations.");

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const slots = pkg.sections.find((s: any) => s.key === "insight_slots");
		expect(slots).toBeTruthy();
		expect(slots.body).toMatch(/raise_terms: Computable/);
		expect(slots.body).toMatch(/evidence=dpu:doc:[0-9a-f]{8}:page:\d+/);
		expect(slots.body).toMatch(/reason=none/);
	});

	it("raise_terms is Computable for Form H WebMax OCR text 'Financial Strategy Raise: a $4M'", async () => {
		mockPool = makeDpuPool(
			"DIGITAL MORTGAGE SOLUTIONS Financial Strategy Raise: a $4M Financial WebMax > $2M-$4M"
		);

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const slots = pkg.sections.find((s: any) => s.key === "insight_slots");
		expect(slots).toBeTruthy();
		expect(slots.body).toMatch(/raise_terms: Computable/);
		expect(slots.body).toMatch(/reason=none/);
	});

	it("raise_terms is Computable for Form G bare label 'Raising: a $2.5M seed'", async () => {
		mockPool = makeDpuPool("Raising: a $2.5M seed round to fund product development.");

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const slots = pkg.sections.find((s: any) => s.key === "insight_slots");
		expect(slots.body).toMatch(/raise_terms: Computable/);
	});

	it("raise_terms remains NotComputable when page has money but no raise context", async () => {
		// Dollar amounts near TAM/MRR keywords should NOT trigger raise_terms.
		// Avoid any RAISE_ANCHOR words (fund/raise/invest/proceed) in this text.
		mockPool = makeDpuPool(
			"The TAM is $50B globally. Monthly recurring revenue $80K growing 15% month over month. Market leader in space."
		);

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const slots = pkg.sections.find((s: any) => s.key === "insight_slots");
		expect(slots.body).toMatch(/raise_terms: NotComputable.*reason=NO_RAISE_MENTION/);
		// But market_claims and traction should be detectable
		expect(slots.body).toMatch(/market_claims: Computable/);
		expect(slots.body).toMatch(/traction_signal: Computable/);
	});

	it("multi-doc: raise_terms Computable from XLSX page 10, evidence ref matches, other slots NotComputable", async () => {
		// Simulate WebMax layout: PDF doc has no raise; XLSX doc has Form H text on page 10.
		// Using ae9a45e5-prefixed UUID so evidence ref is dpu:doc:ae9a45e5:page:10.
		const PDF_DOC_ID  = "aaaa1111-bbbb-cccc-dddd-000000000001";
		const XLSX_DOC_ID = "ae9a45e5-e5f6-7890-abcd-ef1234567890";

		mockPool = {
			query: vi.fn(async (sql: string) => {
				if (sql.includes("current_database")) return { rows: [{ db: "testdb", schema: "public" }] };
				if (sql.includes("investor_insight_reports") && (sql as string).trimStart().startsWith("INSERT")) {
					return { rows: [{ id: "mock-report-id" }] };
				}
				if (sql.includes("investor_insight_reports")) return { rows: [] };
				if (sql.includes("document_id") && sql.includes("document_page_understanding")) {
					return {
						rows: [
							// PDF page 0: pitch deck intro — no raise mention
							{
								document_id: PDF_DOC_ID,
								page_index: 0,
								payload: { page_text: "WebMax CRM-agnostic predictive scoring engine for mortgage teams." },
							},
							// XLSX page 10: financial strategy slide with OCR label (Form H) —
							// THE page that was previously missed by RAISE_PATTERN
							{
								document_id: XLSX_DOC_ID,
								page_index: 10,
								payload: {
									page_text:
										"DIGITAL MORTGAGE SOLUTIONS Financial Strategy Raise: a $4M " +
										"Financial WebMax DIGITAL > $2M-$4M",
								},
							},
						],
					};
				}
				if (sql.includes("COUNT") && sql.includes("document_page_understanding")) {
					return { rows: [{ total: "2", non_empty: "2" }] };
				}
				if (sql.includes("evidence_items")) return { rows: [] };
				if (sql.includes("documents") && !sql.includes("visual_assets")) return { rows: [{ c: "2" }] };
				if (sql.includes("visual_assets")) return { rows: [{ c: "4" }] };
				return { rows: [] };
			}),
		} as any;

		await generateInvestorInsightsProcessor(makeJob("23b2fa42-e6d1-4aa3-8fbc-f7aa083846e4"));
		const pkg = getInsertedRenderPkg();

		const slots = pkg.sections.find((s: any) => s.key === "insight_slots");
		expect(slots).toBeTruthy();

		// raise_terms MUST be Computable — regression guard for WebMax
		expect(slots.body).toMatch(/raise_terms: Computable/);
		// Evidence ref must point to the XLSX doc (ae9a45e5) at page 10
		expect(slots.body).toMatch(/evidence=dpu:doc:ae9a45e5:page:10/);
		expect(slots.body).toMatch(/reason=none/);

		// Slots without evidence must remain NotComputable (no false positives)
		expect(slots.body).toMatch(/market_claims: NotComputable.*reason=NO_MARKET_CLAIM_MENTION/);
		expect(slots.body).toMatch(/traction_signal: NotComputable.*reason=NO_TRACTION_SIGNAL_MENTION/);
		expect(slots.body).toMatch(/valuation_terms: NotComputable.*reason=NO_VALUATION_MENTION/);
	});

	it("DPU query ok but 0 usable pages → NO_*_MENTION reasons and debug.dpu_diagnostics with usable_pages: 0", async () => {
		// Pool returning DPU rows whose payloads have no extractable text.
		mockPool = {
			query: vi.fn(async (sql: string) => {
				if (sql.includes("current_database")) return { rows: [{ db: "testdb", schema: "public" }] };
				if (sql.includes("investor_insight_reports") && (sql as string).trimStart().startsWith("INSERT")) {
					return { rows: [{ id: "mock-report-id" }] };
				}
				if (sql.includes("investor_insight_reports")) return { rows: [] };
				if (sql.includes("document_id") && sql.includes("document_page_understanding")) {
					// Row with payload that has no page_text or normalized_text.
					return { rows: [{ document_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890", page_index: 0, payload: { structured: {} } }] };
				}
				if (sql.includes("document_page_understanding")) return { rows: [{ total: "1", non_empty: "0" }] };
				if (sql.includes("evidence_items")) return { rows: [] };
				if (sql.includes("documents") && !sql.includes("visual_assets")) return { rows: [{ c: "2" }] };
				if (sql.includes("visual_assets")) return { rows: [{ c: "4" }] };
				return { rows: [] };
			}),
		} as any;

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		// Slots degrade to NO_*_MENTION (not DPU_LOAD_FAILED — query succeeded)
		const slotsSection = pkg.sections.find((s: any) => s.key === "insight_slots");
		expect(slotsSection).toBeTruthy();
		expect(slotsSection.body).toMatch(/raise_terms: NotComputable.*reason=NO_RAISE_MENTION/);
		expect(slotsSection.body).not.toMatch(/DPU_LOAD_FAILED/);

		// debug.dpu_diagnostics section must be present
		const diagSection = pkg.sections.find((s: any) => s.key === "debug.dpu_diagnostics");
		expect(diagSection).toBeTruthy();
		expect(diagSection.body).toMatch(/query_ok: true/);
		expect(diagSection.body).toMatch(/row_count: 1/);
		expect(diagSection.body).toMatch(/usable_pages: 0/);
		expect(diagSection.body).toMatch(/error: none/);
	});
});
// ── Raise range + Traction % level-up regression tests ───────────────────────

describe("Level-up: raise range + traction % detection", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockEvaluateGates.mockResolvedValue(g3OnlyFailGateState());
	});

	// ── Raise range ────────────────────────────────────────────────────────

	it("raise_terms is Computable and value preserves en-dash range '$2M–$4M Raise'", async () => {
		mockPool = makeDpuPool("$2M–$4M Raise to accelerate growth.");

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const slots = pkg.sections.find((s: any) => s.key === "insight_slots");
		expect(slots).toBeTruthy();
		expect(slots.body).toMatch(/raise_terms: Computable/);
		// The captured value must contain both the low and high figure
		expect(slots.body).toMatch(/value="[^"]*\$2M[^"]*\$4M[^"]*"|value="[^"]*2M[^"]*4M[^"]*"/);
	});

	it("raise_terms is Computable for colon-label range 'Raise: $2M-$4M'", async () => {
		mockPool = makeDpuPool("Raise: $2M-$4M seed financing");

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const slots = pkg.sections.find((s: any) => s.key === "insight_slots");
		expect(slots).toBeTruthy();
		expect(slots.body).toMatch(/raise_terms: Computable/);
		expect(slots.body).toMatch(/evidence=dpu:doc:[0-9a-f]{8}:page:\d+/);
	});

	it("raise_terms is Computable for word-separator range 'raising $500K to $1M'", async () => {
		mockPool = makeDpuPool("We are raising $500K to $1M in this bridge round.");

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const slots = pkg.sections.find((s: any) => s.key === "insight_slots");
		expect(slots).toBeTruthy();
		expect(slots.body).toMatch(/raise_terms: Computable/);
	});

	it("raise_terms is Computable for slide-layout prefix with range 'Financial Strategy Raise: $2M–$4M'", async () => {
		mockPool = makeDpuPool("Financial Strategy Raise: $2M–$4M total investment ask.");

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const slots = pkg.sections.find((s: any) => s.key === "insight_slots");
		expect(slots).toBeTruthy();
		expect(slots.body).toMatch(/raise_terms: Computable/);
	});

	// ── Traction % ─────────────────────────────────────────────────────────

	it("traction_signal is Computable for keyword-first '50% demo-to-close conversion'", async () => {
		mockPool = makeDpuPool("Our team achieves a 50% demo-to-close conversion rate.");

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const slots = pkg.sections.find((s: any) => s.key === "insight_slots");
		expect(slots).toBeTruthy();
		expect(slots.body).toMatch(/traction_signal: Computable/);
		expect(slots.body).toMatch(/evidence=dpu:doc:[0-9a-f]{8}:page:\d+/);
	});

	it("traction_signal is Computable for percent-first range '20-300% lift in engagement'", async () => {
		mockPool = makeDpuPool("Our product delivers a 20-300% lift in engagement across cohorts.");

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const slots = pkg.sections.find((s: any) => s.key === "insight_slots");
		expect(slots).toBeTruthy();
		expect(slots.body).toMatch(/traction_signal: Computable/);
	});

	it("traction_signal is Computable for 'retention ratio of 60%'", async () => {
		mockPool = makeDpuPool("We maintain a retention ratio of 60% across all cohorts.");

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const slots = pkg.sections.find((s: any) => s.key === "insight_slots");
		expect(slots).toBeTruthy();
		expect(slots.body).toMatch(/traction_signal: Computable/);
	});

	it("traction_signal is NOT Computable for non-traction percent '30% allocation of proceeds'", async () => {
		// "allocation of proceeds" is a use-of-funds phrase — must NOT trigger traction_signal.
		mockPool = makeDpuPool("30% allocation of proceeds will go to product development.");

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const slots = pkg.sections.find((s: any) => s.key === "insight_slots");
		expect(slots).toBeTruthy();
		expect(slots.body).toMatch(/traction_signal: NotComputable.*reason=NO_TRACTION_SIGNAL_MENTION/);
	});
});