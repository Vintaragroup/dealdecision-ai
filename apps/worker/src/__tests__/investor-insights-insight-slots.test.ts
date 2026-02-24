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
