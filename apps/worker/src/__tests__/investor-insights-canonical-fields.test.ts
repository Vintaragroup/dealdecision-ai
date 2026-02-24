/**
 * Tests for Stage 2 deterministic canonical fields, conflict detection, and completeness summary.
 *
 * Coverage:
 *   - raise_amount: Computable when "$2M seed round" found in DPU
 *   - raise_cap: Computable when "SAFE cap $10M" found
 *   - raise_instrument: Computable when "SAFE" instrument found
 *   - use_of_funds_buckets: Computable when use-of-funds header found
 *   - tam_value: Computable when "TAM $50B" found
 *   - mrr_value: Computable when "MRR $80K" found
 *   - valuation_pre/post: Computable when explicit pre/post-money figure found
 *   - conflict emitted when two pages have different raise_amounts (different refs)
 *   - no conflict when both pages have same raise_amount
 *   - completeness: Present/Missing/Conflicting per category
 *   - canonical_fields section present and ordered after insight_slots, before coverage_snapshot
 *   - conflicts section absent when no conflicts
 *   - completeness_summary always present
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

process.env["NODE_ENV"] = "production";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://user:pass@localhost:5432/test";
process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

// ── Pool factory ─────────────────────────────────────────────────────────────

/**
 * Build a mock pool from an ordered list of DPU pages.
 * Each page gets an independent doc_id so cross-page conflict detection works correctly.
 */
function makePool(pages: Array<{ docId: string; pageIndex: number; text: string }>) {
	return {
		query: vi.fn(async (sql: string) => {
			if (sql.includes("current_database")) return { rows: [{ db: "testdb", schema: "public" }] };
			if (sql.includes("investor_insight_reports") && (sql as string).trimStart().startsWith("INSERT")) {
				return { rows: [{ id: "mock-report-id" }] };
			}
			if (sql.includes("investor_insight_reports")) return { rows: [] };
			// DPU slot query: SELECT document_id, page_index, payload … LIMIT 50
			if (sql.includes("document_id") && sql.includes("document_page_understanding")) {
				return {
					rows: pages.map((p) => ({
						document_id: p.docId,
						page_index: p.pageIndex,
						payload: { page_text: p.text },
					})),
				};
			}
			// Coverage snapshot DPU count
			if (sql.includes("COUNT") && sql.includes("document_page_understanding")) {
				return { rows: [{ total: String(pages.length), non_empty: String(pages.length) }] };
			}
			if (sql.includes("evidence_items")) return { rows: [{ c: "0" }] };
			if (sql.includes("documents") && sql.includes("COUNT") && !sql.includes("visual_assets")) {
				return { rows: [{ c: "2" }] };
			}
			if (sql.includes("visual_assets")) return { rows: [{ c: "3" }] };
			return { rows: [] };
		}),
	};
}

/** Single-page convenience wrapper with stable doc_id. */
const makeSinglePagePool = (text: string) =>
	makePool([{ docId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890", pageIndex: 3, text }]);

let mockPool = makeSinglePagePool("");

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

const mockEvaluateGates = vi.fn(async (): Promise<GateState> => g3OnlyFailGateState());

vi.mock("../jobs/investor-insights/gates", () => ({
	evaluateGates: (...args: [unknown, ...unknown[]]) => mockEvaluateGates(...args),
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

// ── Tests: raise_terms ────────────────────────────────────────────────────────

describe("Stage 2 – Canonical Fields: raise_terms", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockEvaluateGates.mockResolvedValue(g3OnlyFailGateState());
	});

	it("raise_amount is Computable when DPU contains '$2M seed round'", async () => {
		mockPool = makeSinglePagePool("$2M seed round to expand operations and hire sales reps.");

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const cf = pkg.sections.find((s: any) => s.key === "canonical_fields");
		expect(cf).toBeTruthy();
		expect(cf.body).toMatch(/field=raise_amount \| computability=Computable/);
		expect(cf.body).toMatch(/evidence=dpu:doc:[0-9a-f]{8}:page:\d+/);
		expect(cf.body).toMatch(/reason=none/);
	});

	it("raise_amount is NotComputable with NO_RAISE_AMOUNT_MENTION when no raise", async () => {
		mockPool = makeSinglePagePool("Our SaaS platform serves 500 enterprise clients globally.");

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const cf = pkg.sections.find((s: any) => s.key === "canonical_fields");
		expect(cf.body).toMatch(
			/field=raise_amount \| computability=NotComputable \| value=none \| evidence=none \| reason=NO_RAISE_AMOUNT_MENTION/
		);
	});

	it("raise_cap is Computable when DPU contains 'SAFE cap $10M'", async () => {
		mockPool = makeSinglePagePool("We are issuing a SAFE cap $10M note to early investors in this round.");

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const cf = pkg.sections.find((s: any) => s.key === "canonical_fields");
		expect(cf.body).toMatch(/field=raise_cap \| computability=Computable/);
		expect(cf.body).toMatch(/evidence=dpu:doc:[0-9a-f]{8}:page:\d+/);
	});

	it("raise_instrument is Computable when DPU contains 'SAFE'", async () => {
		mockPool = makeSinglePagePool("Raising via a SAFE instrument with a 20% discount rate.");

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const cf = pkg.sections.find((s: any) => s.key === "canonical_fields");
		expect(cf.body).toMatch(/field=raise_instrument \| computability=Computable/);
	});

	it("raise_discount is Computable when DPU contains '20% discount'", async () => {
		mockPool = makeSinglePagePool("The SAFE note includes a 20% discount for early investors.");

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const cf = pkg.sections.find((s: any) => s.key === "canonical_fields");
		expect(cf.body).toMatch(/field=raise_discount \| computability=Computable/);
	});
});

// ── Tests: valuation_terms ────────────────────────────────────────────────────

describe("Stage 2 – Canonical Fields: valuation_terms", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockEvaluateGates.mockResolvedValue(g3OnlyFailGateState());
	});

	it("valuation_pre is Computable when DPU contains 'pre-money valuation $8M'", async () => {
		mockPool = makeSinglePagePool("Our pre-money valuation is $8M for this seed round.");

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const cf = pkg.sections.find((s: any) => s.key === "canonical_fields");
		expect(cf.body).toMatch(/field=valuation_pre \| computability=Computable/);
		expect(cf.body).toMatch(/evidence=dpu:doc:[0-9a-f]{8}:page:\d+/);
	});

	it("valuation_post is Computable when DPU contains 'post-money valuation $10M'", async () => {
		mockPool = makeSinglePagePool("Post-money valuation is $10M, implying a 25% dilution.");

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const cf = pkg.sections.find((s: any) => s.key === "canonical_fields");
		expect(cf.body).toMatch(/field=valuation_post \| computability=Computable/);
	});

	it("valuation_safe_cap is Computable when DPU contains 'safe cap of $12M'", async () => {
		mockPool = makeSinglePagePool("Investors receive safe cap of $12M on conversion.");

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const cf = pkg.sections.find((s: any) => s.key === "canonical_fields");
		expect(cf.body).toMatch(/field=valuation_safe_cap \| computability=Computable/);
	});
});

// ── Tests: market_claims + traction_signal ────────────────────────────────────

describe("Stage 2 – Canonical Fields: market_claims + traction_signal", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockEvaluateGates.mockResolvedValue(g3OnlyFailGateState());
	});

	it("tam_value is Computable when DPU contains 'TAM $50B'", async () => {
		mockPool = makeSinglePagePool("The TAM $50B is driven by global supply chain digitization trends.");

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const cf = pkg.sections.find((s: any) => s.key === "canonical_fields");
		expect(cf.body).toMatch(/field=tam_value \| computability=Computable/);
		expect(cf.body).toMatch(/evidence=dpu:doc:[0-9a-f]{8}:page:\d+/);
	});

	it("tam_value is NotComputable when no TAM mention", async () => {
		mockPool = makeSinglePagePool("MRR $80K growing 15% MoM with 300 paying customers.");

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const cf = pkg.sections.find((s: any) => s.key === "canonical_fields");
		expect(cf.body).toMatch(/field=tam_value \| computability=NotComputable.*reason=NO_TAM_VALUE_MENTION/);
	});

	it("mrr_value is Computable when DPU contains 'MRR $80K'", async () => {
		mockPool = makeSinglePagePool("MRR $80K and doubling every two quarters.");

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const cf = pkg.sections.find((s: any) => s.key === "canonical_fields");
		expect(cf.body).toMatch(/field=mrr_value \| computability=Computable/);
	});

	it("growth_rate is Computable when DPU contains 'growing 20%'", async () => {
		mockPool = makeSinglePagePool("Revenue growing 20% month over month consistently.");

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const cf = pkg.sections.find((s: any) => s.key === "canonical_fields");
		expect(cf.body).toMatch(/field=growth_rate \| computability=Computable/);
	});

	it("customer_count is Computable when DPU contains '1200 customers'", async () => {
		mockPool = makeSinglePagePool("We serve 1200 customers across 12 verticals.");

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const cf = pkg.sections.find((s: any) => s.key === "canonical_fields");
		expect(cf.body).toMatch(/field=customer_count \| computability=Computable/);
	});
});

// ── Tests: use_of_funds ────────────────────────────────────────────────────────

describe("Stage 2 – Canonical Fields: use_of_funds", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockEvaluateGates.mockResolvedValue(g3OnlyFailGateState());
	});

	it("use_of_funds_buckets is Computable when DPU contains 'Use of funds:' header", async () => {
		mockPool = makeSinglePagePool(
			"Use of funds: product development 50%, sales and marketing 30%, operations 20%."
		);

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const cf = pkg.sections.find((s: any) => s.key === "canonical_fields");
		expect(cf.body).toMatch(/field=use_of_funds_buckets \| computability=Computable/);
		expect(cf.body).toMatch(/evidence=dpu:doc:[0-9a-f]{8}:page:\d+/);
	});

	it("use_of_funds_buckets is NotComputable when no use-of-funds header present", async () => {
		mockPool = makeSinglePagePool("MRR $50K and growing 10% MoM.");

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const cf = pkg.sections.find((s: any) => s.key === "canonical_fields");
		expect(cf.body).toMatch(
			/field=use_of_funds_buckets \| computability=NotComputable.*reason=NO_USE_OF_FUNDS_BUCKETS_MENTION/
		);
	});
});

// ── Tests: conflict detection ─────────────────────────────────────────────────

describe("Stage 2 – Conflict Detection", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockEvaluateGates.mockResolvedValue(g3OnlyFailGateState());
	});

	it("no conflicts section when a single page has one raise amount", async () => {
		mockPool = makeSinglePagePool("Raising $2M seed round.");

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const conflictsSection = pkg.sections.find((s: any) => s.key === "conflicts");
		expect(conflictsSection).toBeUndefined();
	});

	it("conflict section emitted when two pages have different raise amounts", async () => {
		mockPool = makePool([
			{ docId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890", pageIndex: 1, text: "Raising $2M seed round." },
			{
				docId: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
				pageIndex: 5,
				text: "Raising $5M Series A round.",
			},
		]);

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const conflictsSection = pkg.sections.find((s: any) => s.key === "conflicts");
		expect(conflictsSection).toBeTruthy();
		expect(conflictsSection.body).toMatch(/field=raise_amount/);
		expect(conflictsSection.body).toMatch(/value_a="[^"]+"/);
		expect(conflictsSection.body).toMatch(/evidence_a=dpu:doc:[0-9a-f]{8}:page:\d+/);
		expect(conflictsSection.body).toMatch(/value_b="[^"]+"/);
		expect(conflictsSection.body).toMatch(/evidence_b=dpu:doc:[0-9a-f]{8}:page:\d+/);
	});

	it("no conflict when two pages have the same raise amount", async () => {
		mockPool = makePool([
			{ docId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890", pageIndex: 1, text: "Raising $2M seed round." },
			{
				docId: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
				pageIndex: 5,
				text: "Raising $2M seed capital for growth.",
			},
		]);

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const conflictsSection = pkg.sections.find((s: any) => s.key === "conflicts");
		expect(conflictsSection).toBeUndefined();
	});
});

// ── Tests: completeness summary ───────────────────────────────────────────────

describe("Stage 2 – Completeness Summary", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockEvaluateGates.mockResolvedValue(g3OnlyFailGateState());
	});

	it("completeness_summary section is always present with all five categories", async () => {
		mockPool = makeSinglePagePool("No relevant financial signals mentioned.");

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const cs = pkg.sections.find((s: any) => s.key === "completeness_summary");
		expect(cs).toBeTruthy();
		expect(cs.body).toMatch(/raise_terms:/);
		expect(cs.body).toMatch(/valuation_terms:/);
		expect(cs.body).toMatch(/use_of_funds:/);
		expect(cs.body).toMatch(/market_claims:/);
		expect(cs.body).toMatch(/traction_signal:/);
	});

	it("raise_terms: Present when raise amount found; market_claims: Missing when not", async () => {
		mockPool = makeSinglePagePool("$2M seed round to accelerate hiring.");

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const cs = pkg.sections.find((s: any) => s.key === "completeness_summary");
		expect(cs.body).toMatch(/raise_terms: Present/);
		expect(cs.body).toMatch(/market_claims: Missing/);
	});

	it("traction_signal: Present when MRR found", async () => {
		mockPool = makeSinglePagePool("MRR $25K growing 15% MoM with strong retention.");

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const cs = pkg.sections.find((s: any) => s.key === "completeness_summary");
		expect(cs.body).toMatch(/traction_signal: Present/);
	});

	it("raise_terms: Conflicting when two pages show different raise amounts", async () => {
		mockPool = makePool([
			{ docId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890", pageIndex: 1, text: "Raising $2M seed round." },
			{
				docId: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
				pageIndex: 5,
				text: "Raising $5M Series A round.",
			},
		]);

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const cs = pkg.sections.find((s: any) => s.key === "completeness_summary");
		expect(cs.body).toMatch(/raise_terms: Conflicting/);
	});

	it("all five categories Missing when DPU has no financial signals", async () => {
		mockPool = makeSinglePagePool("Our team has 20 years of combined experience in enterprise software.");

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const cs = pkg.sections.find((s: any) => s.key === "completeness_summary");
		expect(cs.body).toMatch(/raise_terms: Missing/);
		expect(cs.body).toMatch(/valuation_terms: Missing/);
		expect(cs.body).toMatch(/use_of_funds: Missing/);
		expect(cs.body).toMatch(/market_claims: Missing/);
		expect(cs.body).toMatch(/traction_signal: Missing/);
	});
});

// ── Tests: section ordering ───────────────────────────────────────────────────

describe("Stage 2 – Section Ordering", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockEvaluateGates.mockResolvedValue(g3OnlyFailGateState());
	});

	it("canonical_fields and completeness_summary both appear before coverage_snapshot", async () => {
		mockPool = makeSinglePagePool("$2M seed round.");

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const keys: string[] = pkg.sections.map((s: any) => s.key);
		expect(keys).toContain("canonical_fields");
		expect(keys).toContain("completeness_summary");
		expect(keys).toContain("coverage_snapshot");
		expect(keys.indexOf("canonical_fields")).toBeLessThan(keys.indexOf("coverage_snapshot"));
		expect(keys.indexOf("completeness_summary")).toBeLessThan(keys.indexOf("coverage_snapshot"));
	});

	it("insight_slots comes before canonical_fields", async () => {
		mockPool = makeSinglePagePool("$2M seed round.");

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const keys: string[] = pkg.sections.map((s: any) => s.key);
		expect(keys.indexOf("insight_slots")).toBeLessThan(keys.indexOf("canonical_fields"));
	});

	it("conflicts section falls between canonical_fields and completeness_summary when present", async () => {
		mockPool = makePool([
			{ docId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890", pageIndex: 1, text: "Raising $2M seed round." },
			{
				docId: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
				pageIndex: 5,
				text: "Raising $5M Series A round.",
			},
		]);

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const keys: string[] = pkg.sections.map((s: any) => s.key);
		const cfIdx = keys.indexOf("canonical_fields");
		const conflictsIdx = keys.indexOf("conflicts");
		const csIdx = keys.indexOf("completeness_summary");

		expect(conflictsIdx).toBeGreaterThan(cfIdx);
		expect(conflictsIdx).toBeLessThan(csIdx);
	});
});
