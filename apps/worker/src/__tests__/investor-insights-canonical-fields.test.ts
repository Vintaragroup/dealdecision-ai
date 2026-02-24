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
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
	evaluateGates: () => mockEvaluateGates(),
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

// ── Tests: Palm deck formats ──────────────────────────────────────────────────

describe("Stage 2 – Palm Deck Formats", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockEvaluateGates.mockResolvedValue(g3OnlyFailGateState());
	});

	it("raise_amount is Computable from 'Equity $1.5MM raise on a $6MM Valuation.'", async () => {
		mockPool = makeSinglePagePool("Equity $1.5MM raise on a $6MM Valuation.");

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const cf = pkg.sections.find((s: any) => s.key === "canonical_fields");
		expect(cf).toBeTruthy();
		expect(cf.body).toMatch(/field=raise_amount \| computability=Computable/);
		expect(cf.body).toMatch(/evidence=dpu:doc:[0-9a-f]{8}:page:\d+/);
	});

	it("valuation_post is Computable from '$6MM Valuation'", async () => {
		mockPool = makeSinglePagePool("We are raising $1.5MM on a $6MM Valuation.");

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const cf = pkg.sections.find((s: any) => s.key === "canonical_fields");
		expect(cf).toBeTruthy();
		expect(cf.body).toMatch(/field=valuation_post \| computability=Computable/);
		expect(cf.body).toMatch(/evidence=dpu:doc:[0-9a-f]{8}:page:\d+/);
	});

	it("raise_instrument is Computable from 'Capital Raise. Equity'", async () => {
		mockPool = makeSinglePagePool("Capital Raise. Equity");

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const cf = pkg.sections.find((s: any) => s.key === "canonical_fields");
		expect(cf).toBeTruthy();
		expect(cf.body).toMatch(/field=raise_instrument \| computability=Computable/);
	});

	it("no conflict between '$1.5MM' and '$1.5M' after normalization", async () => {
		mockPool = makePool([
			{ docId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890", pageIndex: 1, text: "Raising $1.5MM seed round." },
			{ docId: "b2c3d4e5-f6a7-8901-bcde-f12345678901", pageIndex: 5, text: "Seeking $1.5M seed capital." },
		]);

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const conflictsSection = pkg.sections.find((s: any) => s.key === "conflicts");
		expect(conflictsSection).toBeUndefined();
	});
});

// ── Tests: Non-USD / multi-currency formats ───────────────────────────────────

describe("Stage 2 – Non-USD / Cinco Deck Formats", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockEvaluateGates.mockResolvedValue(g3OnlyFailGateState());
	});

	it("raise_amount is Computable from '€5.6M raised to date'", async () => {
		mockPool = makeSinglePagePool("€5.6M raised to date from strategic investors.");

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const cf = pkg.sections.find((s: any) => s.key === "canonical_fields");
		expect(cf).toBeTruthy();
		expect(cf.body).toMatch(/field=raise_amount \| computability=Computable/);
		expect(cf.body).toMatch(/evidence=dpu:doc:[0-9a-f]{8}:page:\d+/);
	});

	it("raise_amount is Computable from 'Raised €5.6M to date'", async () => {
		mockPool = makeSinglePagePool("Raised €5.6M to date across three funding rounds.");

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const cf = pkg.sections.find((s: any) => s.key === "canonical_fields");
		expect(cf).toBeTruthy();
		expect(cf.body).toMatch(/field=raise_amount \| computability=Computable/);
	});

	it("raise_amount is Computable from 'USD 2.0M funded'", async () => {
		mockPool = makeSinglePagePool("USD 2.0M funded by angel investors in 2024.");

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const cf = pkg.sections.find((s: any) => s.key === "canonical_fields");
		expect(cf).toBeTruthy();
		expect(cf.body).toMatch(/field=raise_amount \| computability=Computable/);
	});

	it("no conflict between '€5.6M' and 'EUR 5.6M' after normalization", async () => {
		mockPool = makePool([
			{ docId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890", pageIndex: 1, text: "€5.6M raised to date." },
			{ docId: "b2c3d4e5-f6a7-8901-bcde-f12345678901", pageIndex: 5, text: "EUR 5.6M funded by investors." },
		]);

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const conflictsSection = pkg.sections.find((s: any) => s.key === "conflicts");
		expect(conflictsSection).toBeUndefined();
	});
});

// ── Tests: clean value extraction ─────────────────────────────────────────────

describe("Stage 2 – Clean Value Extraction", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockEvaluateGates.mockResolvedValue(g3OnlyFailGateState());
	});

	it("raise_amount value is '€5.6M' (not noisy OCR) for Cinco-style text", async () => {
		mockPool = makeSinglePagePool("€5.6M raised to date from strategic investors.");

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const cf = pkg.sections.find((s: any) => s.key === "canonical_fields");
		expect(cf).toBeTruthy();
		// Extract the value= token from the body line for raise_amount
		const valueLine = cf.body.split("\n").find((l: string) => l.includes("field=raise_amount"));
		expect(valueLine).toBeTruthy();
		const valueMatch = /\| value="([^"]+)"/.exec(valueLine!);
		expect(valueMatch).toBeTruthy();
		expect(valueMatch![1]).toBe("€5.6M");
	});

	it("raise_amount value is '$1.5M' (normalized MM→M) for Palm-style text", async () => {
		mockPool = makeSinglePagePool("Equity $1.5MM raise on a $6MM Valuation.");

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const cf = pkg.sections.find((s: any) => s.key === "canonical_fields");
		const valueLine = cf.body.split("\n").find((l: string) => l.includes("field=raise_amount"));
		expect(valueLine).toBeTruthy();
		const valueMatch = /\| value="([^"]+)"/.exec(valueLine!);
		expect(valueMatch).toBeTruthy();
		expect(valueMatch![1]).toBe("$1.5M");
	});

	it("valuation_post value is '$6M' (normalized MM→M) for Palm-style text", async () => {
		mockPool = makeSinglePagePool("$6MM Valuation for this seed round.");

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const cf = pkg.sections.find((s: any) => s.key === "canonical_fields");
		const valueLine = cf.body.split("\n").find((l: string) => l.includes("field=valuation_post"));
		expect(valueLine).toBeTruthy();
		const valueMatch = /\| value="([^"]+)"/.exec(valueLine!);
		expect(valueMatch).toBeTruthy();
		expect(valueMatch![1]).toBe("$6M");
	});

	it("clean value fields still carry Computable status and evidence ref", async () => {
		mockPool = makeSinglePagePool("€5.6M raised to date.");

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const cf = pkg.sections.find((s: any) => s.key === "canonical_fields");
		expect(cf.body).toMatch(/field=raise_amount \| computability=Computable/);
		expect(cf.body).toMatch(/evidence=dpu:doc:[0-9a-f]{8}:page:\d+/);
	});
});

// ── Pool factory: evidence snippet fallback ───────────────────────────────────

/**
 * Build a mock pool with evidence items and optionally empty DPU pages.
 * Used for testing the evidence snippet fallback path.
 */
function makePoolWithEvidence(
	evidenceItems: Array<{ id: string; claim_text: string }>,
	dpuPages: Array<{ docId: string; pageIndex: number; text: string }> = []
) {
	return {
		query: vi.fn(async (sql: string) => {
			if (sql.includes("current_database")) return { rows: [{ db: "testdb", schema: "public" }] };
			if (sql.includes("investor_insight_reports") && (sql as string).trimStart().startsWith("INSERT")) {
				return { rows: [{ id: "mock-report-id" }] };
			}
			if (sql.includes("investor_insight_reports")) return { rows: [] };
			// DPU slot query
			if (sql.includes("document_id") && sql.includes("document_page_understanding")) {
				return {
					rows: dpuPages.map((p) => ({
						document_id: p.docId,
						page_index: p.pageIndex,
						payload: { page_text: p.text },
					})),
				};
			}
			// Coverage snapshot DPU count
			if (sql.includes("COUNT") && sql.includes("document_page_understanding")) {
				return { rows: [{ total: String(dpuPages.length), non_empty: String(dpuPages.length) }] };
			}
			// Evidence items SELECT (for slot inputs) — must come before COUNT check
			if (sql.includes("evidence_items") && sql.includes("claim_text")) {
				return { rows: evidenceItems };
			}
			// Evidence count (coverage snapshot)
			if (sql.includes("evidence_items")) {
				return { rows: [{ c: String(evidenceItems.length) }] };
			}
			if (sql.includes("documents") && sql.includes("COUNT") && !sql.includes("visual_assets")) {
				return { rows: [{ c: "2" }] };
			}
			if (sql.includes("visual_assets")) return { rows: [{ c: "3" }] };
			return { rows: [] };
		}),
	};
}

// ── Tests: evidence snippet fallback ─────────────────────────────────────────

describe("Stage 2 – Evidence Snippet Fallback", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockEvaluateGates.mockResolvedValue(g3OnlyFailGateState());
	});

	it("raise_amount is Computable from evidence_items when DPU pages are empty", async () => {
		mockPool = makePoolWithEvidence(
			[{ id: "11223344-5566-7788-99aa-bbccddeeff00", claim_text: "$2M raise seed round" }],
			[] // empty DPU
		);

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const cf = pkg.sections.find((s: any) => s.key === "canonical_fields");
		expect(cf).toBeTruthy();
		const raiseAmountLine = cf.body.split("\n").find((l: string) => l.includes("field=raise_amount"));
		expect(raiseAmountLine).toBeTruthy();
		expect(raiseAmountLine).toMatch(/computability=Computable/);
		expect(raiseAmountLine).toMatch(/evidence=evidence:item:[0-9a-f]{8}/);
		expect(raiseAmountLine).toMatch(/reason=none/);
	});

	it("evidence ref prefix is first 8 hex chars of id (no hyphens)", async () => {
		mockPool = makePoolWithEvidence(
			[{ id: "aabbccdd-eeff-0011-2233-445566778899", claim_text: "$5M seed raise" }],
			[]
		);

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const cf = pkg.sections.find((s: any) => s.key === "canonical_fields");
		const raiseAmountLine = cf.body.split("\n").find((l: string) => l.includes("field=raise_amount"));
		expect(raiseAmountLine).toMatch(/evidence=evidence:item:aabbccdd/);
	});

	it("raise_terms slot visible is Computable from evidence fallback", async () => {
		mockPool = makePoolWithEvidence(
			[{ id: "feedface-dead-beef-cafe-123456789abc", claim_text: "raising $3M pre-seed" }],
			[]
		);

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const slots = pkg.sections.find((s: any) => s.key === "insight_slots");
		expect(slots).toBeTruthy();
		// raise_terms slot should be Computable via evidence fallback
		expect(slots.body).toMatch(/raise_terms: Computable/);
		expect(slots.body).toMatch(/evidence=evidence:item:[0-9a-f]{8}/);
	});

	it("DPU hit takes priority over evidence snippets", async () => {
		mockPool = makePoolWithEvidence(
			[{ id: "11223344-5566-7788-99aa-bbccddeeff00", claim_text: "$99M raise huge" }],
			[{ docId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890", pageIndex: 2, text: "$2M seed round" }]
		);

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const cf = pkg.sections.find((s: any) => s.key === "canonical_fields");
		const raiseAmountLine = cf.body.split("\n").find((l: string) => l.includes("field=raise_amount"));
		expect(raiseAmountLine).toMatch(/evidence=dpu:doc:[0-9a-f]{8}:page:2/);
		// Should NOT use the evidence item
		expect(raiseAmountLine).not.toMatch(/evidence=evidence:item:/);
	});
});

// ── Tests: signal visibility section ─────────────────────────────────────────

describe("Stage 2 – Signal Visibility Section", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockEvaluateGates.mockResolvedValue(g3OnlyFailGateState());
	});

	afterEach(() => {
		// Always restore production mode after each test in this suite
		process.env["NODE_ENV"] = "production";
	});

	it("debug.signal_visibility section is absent in production", async () => {
		process.env["NODE_ENV"] = "production";
		mockPool = makeSinglePagePool("$2M seed round raising valuation $10M post-money.");

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const sigVis = pkg.sections.find((s: any) => s.key === "debug.signal_visibility");
		expect(sigVis).toBeUndefined();
	});

	it("debug.signal_visibility section is present in non-production with money signal pages", async () => {
		process.env["NODE_ENV"] = "development";
		mockPool = makeSinglePagePool("Raising $2M seed round. Valuation $10M post-money.");

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const sigVis = pkg.sections.find((s: any) => s.key === "debug.signal_visibility");
		expect(sigVis).toBeTruthy();
		expect(sigVis.body).toMatch(/dev-only/);
		expect(sigVis.body).toMatch(/dpu_page_count:/);
		expect(sigVis.body).toMatch(/--- top money-signal pages ---/);
		expect(sigVis.body).toMatch(/--- top keyword pages ---/);
		// The test page should appear in at least one of the scored lists
		expect(sigVis.body).toMatch(/page=3/);
	});
});

// ── Tests: expanded raise anchors ─────────────────────────────────────────────

describe("Stage 2 – Expanded Raise Anchors", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockEvaluateGates.mockResolvedValue(g3OnlyFailGateState());
	});

	it("raise_amount is Computable when DPU contains 'funding $4M'", async () => {
		mockPool = makeSinglePagePool("Total funding $4M raised to expand our engineering team.");

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const cf = pkg.sections.find((s: any) => s.key === "canonical_fields");
		expect(cf).toBeTruthy();
		const line = cf.body.split("\n").find((l: string) => l.includes("field=raise_amount"));
		expect(line).toBeTruthy();
		expect(line).toMatch(/computability=Computable/);
		expect(line).toMatch(/evidence=dpu:doc:[0-9a-f]{8}:page:\d+/);
	});

	it("raise_amount is Computable when DPU contains 'round size $3M'", async () => {
		mockPool = makeSinglePagePool("Round size $3M. Ticket size $3M. Use of proceeds: product and sales.");

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const cf = pkg.sections.find((s: any) => s.key === "canonical_fields");
		const line = cf.body.split("\n").find((l: string) => l.includes("field=raise_amount"));
		expect(line).toBeTruthy();
		expect(line).toMatch(/computability=Computable/);
	});

	it("raise_terms slot is Computable when DPU contains 'financing $5M'", async () => {
		mockPool = makeSinglePagePool("We are financing $5M of our growth via this round.");

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const slots = pkg.sections.find((s: any) => s.key === "insight_slots");
		expect(slots).toBeTruthy();
		expect(slots.body).toMatch(/raise_terms: Computable/);
	});

	it("raise_terms slot is Computable when DPU uses 'investment $2M'", async () => {
		mockPool = makeSinglePagePool("Total investment $2M for this seed stage.");

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const slots = pkg.sections.find((s: any) => s.key === "insight_slots");
		expect(slots.body).toMatch(/raise_terms: Computable/);
	});
});

// ── Tests: grammar expansion — colon & label forms (Phase 2.2) ───────────────

describe("Stage 2 – Grammar Expansion: Colon & Label Forms", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockEvaluateGates.mockResolvedValue(g3OnlyFailGateState());
	});

	// Form G: raise-anchor + colon form
	it("raise_amount is Computable for 'Raise: $4M'", async () => {
		mockPool = makeSinglePagePool("Raise: $4M seed round for product expansion.");

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const cf = pkg.sections.find((s: any) => s.key === "canonical_fields");
		expect(cf).toBeTruthy();
		const line = cf.body.split("\n").find((l: string) => l.includes("field=raise_amount"));
		expect(line).toBeTruthy();
		expect(line).toMatch(/computability=Computable/);
		expect(line).toMatch(/evidence=dpu:doc:[0-9a-f]{8}:page:\d+/);
	});

	it("raise_amount value is '$4M' for 'Raise: $4M'", async () => {
		mockPool = makeSinglePagePool("Raise: $4M seed round.");

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const cf = pkg.sections.find((s: any) => s.key === "canonical_fields");
		const line = cf.body.split("\n").find((l: string) => l.includes("field=raise_amount"));
		const valueMatch = /\| value="([^"]+)"/.exec(line!);
		expect(valueMatch).toBeTruthy();
		expect(valueMatch![1]).toBe("$4M");
	});

	// Form H: slide-layout label prefix — "Financial Strategy Raise: a $4M"
	it("raise_amount is Computable for 'Financial Strategy Raise: a $4M'", async () => {
		mockPool = makeSinglePagePool("Financial Strategy Raise: a $4M seed investment to scale operations.");

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const cf = pkg.sections.find((s: any) => s.key === "canonical_fields");
		expect(cf).toBeTruthy();
		const line = cf.body.split("\n").find((l: string) => l.includes("field=raise_amount"));
		expect(line).toBeTruthy();
		expect(line).toMatch(/computability=Computable/);
	});

	it("raise_amount value is '$4M' for 'Financial Strategy Raise: a $4M'", async () => {
		mockPool = makeSinglePagePool("Financial Strategy Raise: a $4M seed round.");

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const cf = pkg.sections.find((s: any) => s.key === "canonical_fields");
		const line = cf.body.split("\n").find((l: string) => l.includes("field=raise_amount"));
		const valueMatch = /\| value="([^"]+)"/.exec(line!);
		expect(valueMatch).toBeTruthy();
		expect(valueMatch![1]).toBe("$4M");
	});

	// Form G variant: "Raised: $5M" (past tense + colon)
	it("raise_amount is Computable for 'Raised: $5M' (past tense colon form)", async () => {
		mockPool = makeSinglePagePool("Raised: $5M in Series A from strategic investors.");

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const cf = pkg.sections.find((s: any) => s.key === "canonical_fields");
		const line = cf.body.split("\n").find((l: string) => l.includes("field=raise_amount"));
		expect(line).toBeTruthy();
		expect(line).toMatch(/computability=Computable/);
	});

	// "Total raised to date €5.6M" — Form F handles verb-first with colon gap
	it("raise_amount is Computable for 'Total raised to date €5.6M'", async () => {
		mockPool = makeSinglePagePool("Total raised to date €5.6M across three rounds.");

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const cf = pkg.sections.find((s: any) => s.key === "canonical_fields");
		const line = cf.body.split("\n").find((l: string) => l.includes("field=raise_amount"));
		expect(line).toBeTruthy();
		expect(line).toMatch(/computability=Computable/);
		const valueMatch = /\| value="([^"]+)"/.exec(line!);
		expect(valueMatch).toBeTruthy();
		expect(valueMatch![1]).toBe("€5.6M");
	});

	// "Valuation: $6MM" — Form C of VALUATION_POST_PATTERN handles colon within 20 chars
	// Use isolated input to avoid the raise amount token being picked up by Form B.
	it("valuation_post is Computable for 'Valuation: $6MM' (colon form, normalized $6M)", async () => {
		mockPool = makeSinglePagePool("Valuation: $6MM post-money.");

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const cf = pkg.sections.find((s: any) => s.key === "canonical_fields");
		const line = cf.body.split("\n").find((l: string) => l.includes("field=valuation_post"));
		expect(line).toBeTruthy();
		expect(line).toMatch(/computability=Computable/);
		const valueMatch = /\| value="([^"]+)"/.exec(line!);
		expect(valueMatch).toBeTruthy();
		expect(valueMatch![1]).toBe("$6M");
	});

	// Revenue-only guard: "$2M revenue" must NOT produce a raise_amount Computable
	it("raise_amount is NotComputable for '$2M revenue' (revenue-only, no raise context)", async () => {
		mockPool = makeSinglePagePool("$2M revenue last fiscal year.");

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const cf = pkg.sections.find((s: any) => s.key === "canonical_fields");
		const line = cf.body.split("\n").find((l: string) => l.includes("field=raise_amount"));
		expect(line).toBeTruthy();
		expect(line).toMatch(/computability=NotComputable/);
		expect(line).toMatch(/reason=NO_RAISE_AMOUNT_MENTION/);
	});

	// Colon form for non-USD currency
	it("raise_amount is Computable for 'Seeking: €3M Series A'", async () => {
		mockPool = makeSinglePagePool("Seeking: €3M Series A for EMEA expansion.");

		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const cf = pkg.sections.find((s: any) => s.key === "canonical_fields");
		const line = cf.body.split("\n").find((l: string) => l.includes("field=raise_amount"));
		expect(line).toBeTruthy();
		expect(line).toMatch(/computability=Computable/);
		const valueMatch = /\| value="([^"]+)"/.exec(line!);
		expect(valueMatch).toBeTruthy();
		expect(valueMatch![1]).toBe("€3M");
	});
});

