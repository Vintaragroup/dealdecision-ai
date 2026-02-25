/**
 * repair-insight-slots.test.ts
 *
 * Unit tests for the offline insight-slot repair exports in processor.ts.
 * No real DB connection required — all tests use a mock Pool.
 */

import { describe, it, expect, vi } from "vitest";

// Mock out lib/db so it doesn't throw when DATABASE_URL is absent in test context.
vi.mock("../../../lib/db", () => ({
	getPool: vi.fn(),
}));

import {
	recomputeInsightSlotBody,
	repairInsightSlotsInReport,
} from "../processor";

// ── Mock pool factory ─────────────────────────────────────────────────────────

/**
 * Build a fake pg.Pool that returns a predetermined sequence of query results.
 * Queries are matched in call order (first call → first entry, etc.).
 */
function makeMockPool(queryResponses: Array<{ rows: unknown[]; rowCount?: number }>): object {
	let callIdx = 0;
	return {
		query: vi.fn().mockImplementation(() => {
			const resp = queryResponses[callIdx] ?? { rows: [], rowCount: 0 };
			callIdx++;
			return Promise.resolve({ rows: resp.rows, rowCount: resp.rowCount ?? resp.rows.length });
		}),
		end: vi.fn().mockResolvedValue(undefined),
	};
}

// ── Test fixtures ─────────────────────────────────────────────────────────────

const DEAL_ID = "adb2a1cf-bbb1-4f3b-8735-e2249415124f";

/** DPU row with raise_terms text that the detector should match */
const RaiseDpuPayload = {
	page_text: "We are raising $500K seed round to expand our engineering team.",
};

/** DPU row with traction_signal (percentage-based) that the detector should match */
const TractionPctDpuPayload = {
	page_text: "Retention ratio 85% after 12 months; churn rate 5% quarterly.",
};

/** DPU row with no relevant signals */
const EmptyDpuPayload = {
	page_text: "Our team has strong domain expertise and years of experience.",
};

// ── recomputeInsightSlotBody ──────────────────────────────────────────────────

describe("recomputeInsightSlotBody", () => {
	it("returns a Computable raise_terms line when DPU contains a raise mention", async () => {
		const pool = makeMockPool([
			// Query 1: DPU rows
			{
				rows: [
					{ document_id: "aaaaaaaa-0000-0000-0000-000000000001", page_index: 0, payload: RaiseDpuPayload },
				],
			},
			// Query 2: evidence_items (empty)
			{ rows: [] },
		]);

		const body = await recomputeInsightSlotBody(pool as never, DEAL_ID);
		const lines = body.split("\n");
		const raiseLine = lines.find((l) => l.startsWith("raise_terms:"));
		expect(raiseLine).toBeDefined();
		expect(raiseLine).toMatch(/Computable/);
		expect(raiseLine).toMatch(/evidence=dpu:doc:/);
		expect(raiseLine).toMatch(/value="/);
	});

	it("returns NotComputable raise_terms when DPU has no raise mention", async () => {
		const pool = makeMockPool([
			{ rows: [{ document_id: "bbbbbbbb-0000-0000-0000-000000000001", page_index: 0, payload: EmptyDpuPayload }] },
			{ rows: [] },
		]);

		const body = await recomputeInsightSlotBody(pool as never, DEAL_ID);
		const raiseLine = body.split("\n").find((l) => l.startsWith("raise_terms:"));
		expect(raiseLine).toMatch(/NotComputable/);
		expect(raiseLine).toMatch(/reason=NO_RAISE_MENTION/);
	});

	it("returns Computable traction_signal for percentage-based retention ratio", async () => {
		const pool = makeMockPool([
			{ rows: [{ document_id: "cccccccc-0000-0000-0000-000000000001", page_index: 2, payload: TractionPctDpuPayload }] },
			{ rows: [] },
		]);

		const body = await recomputeInsightSlotBody(pool as never, DEAL_ID);
		const tractionLine = body.split("\n").find((l) => l.startsWith("traction_signal:"));
		expect(tractionLine).toMatch(/Computable/);
		expect(tractionLine).toMatch(/evidence=dpu:doc:/);
	});

	it("marks all slots NotComputable when DPU load fails (query throws)", async () => {
		const pool = {
			query: vi.fn().mockRejectedValue(new Error("DB DOWN")),
			end: vi.fn().mockResolvedValue(undefined),
		};

		const body = await recomputeInsightSlotBody(pool as never, DEAL_ID);
		const lines = body.split("\n");
		for (const line of lines) {
			expect(line).toMatch(/NotComputable/);
			expect(line).toMatch(/DPU_LOAD_FAILED/);
		}
	});

	it("returns all 5 slot lines", async () => {
		const pool = makeMockPool([
			{ rows: [{ document_id: "dddddddd-0000-0000-0000-000000000001", page_index: 0, payload: RaiseDpuPayload }] },
			{ rows: [] },
		]);

		const body = await recomputeInsightSlotBody(pool as never, DEAL_ID);
		const lines = body.split("\n").filter(Boolean);
		const slotKeys = lines.map((l) => l.split(":")[0]);
		expect(slotKeys).toContain("raise_terms");
		expect(slotKeys).toContain("market_claims");
		expect(slotKeys).toContain("traction_signal");
		expect(slotKeys).toContain("valuation_terms");
		expect(slotKeys).toContain("use_of_funds");
		expect(lines).toHaveLength(5);
	});
});

// ── repairInsightSlotsInReport ────────────────────────────────────────────────

describe("repairInsightSlotsInReport", () => {
	it("returns updated=false when no report row exists for the deal", async () => {
		const pool = makeMockPool([
			// DPU query
			{ rows: [{ document_id: "aaaaaaaa-0000-0000-0000-000000000001", page_index: 0, payload: RaiseDpuPayload }] },
			// evidence_items
			{ rows: [] },
			// SELECT from investor_insight_reports — no row
			{ rows: [] },
		]);

		const result = await repairInsightSlotsInReport(pool as never, DEAL_ID);
		expect(result.updated).toBe(false);
		expect(result.oldBody).toBeNull();
		expect(result.newBody).toBeTruthy();
	});

	it("updates an existing NotComputable insight_slots body to Computable", async () => {
		const staleBody =
			"raise_terms: NotComputable | value=none | evidence=none | reason=NO_RAISE_MENTION\n" +
			"market_claims: NotComputable | value=none | evidence=none | reason=NO_MARKET_CLAIM_MENTION\n" +
			"traction_signal: NotComputable | value=none | evidence=none | reason=NO_TRACTION_SIGNAL_MENTION\n" +
			"valuation_terms: NotComputable | value=none | evidence=none | reason=NO_VALUATION_MENTION\n" +
			"use_of_funds: NotComputable | value=none | evidence=none | reason=NO_USE_OF_FUNDS_MENTION";

		const staleRenderPkg = {
			sections: [
				{ key: "insight_slots", title: "Deterministic Insight Slots", kind: "message", body: staleBody, fallback: "" },
			],
		};

		const pool = makeMockPool([
			// DPU query
			{ rows: [{ document_id: "aaaaaaaa-0000-0000-0000-000000000001", page_index: 0, payload: RaiseDpuPayload }] },
			// evidence_items
			{ rows: [] },
			// SELECT existing report
			{ rows: [{ id: "report-row-id-001", render_package: staleRenderPkg }] },
			// UPDATE — rowCount: 1
			{ rows: [], rowCount: 1 },
		]);

		const result = await repairInsightSlotsInReport(pool as never, DEAL_ID);
		expect(result.updated).toBe(true);
		expect(result.oldBody).toBe(staleBody);
		expect(result.newBody).toMatch(/raise_terms: Computable/);
		expect(result.newBody).toMatch(/evidence=dpu:doc:/);
	});

	it("appends insight_slots section when section is absent from render_package (Carmoola-type report)", async () => {
		const renderPkgWithoutSlots = {
			sections: [
				{ key: "deal_fusion", title: "Deal Info", kind: "message", body: "some deal info" },
			],
		};

		const pool = makeMockPool([
			{ rows: [{ document_id: "bbbbbbbb-0000-0000-0000-000000000001", page_index: 0, payload: RaiseDpuPayload }] },
			{ rows: [] },
			{ rows: [{ id: "report-row-id-002", render_package: renderPkgWithoutSlots }] },
			{ rows: [], rowCount: 1 },
		]);

		const result = await repairInsightSlotsInReport(pool as never, DEAL_ID);
		expect(result.updated).toBe(true);
		expect(result.oldBody).toBeNull(); // section was absent
		expect(result.newBody).toMatch(/raise_terms:/);
	});

	it("is idempotent: running repair twice on already-Computable report produces the same body", async () => {
		const computableBody =
			'raise_terms: Computable | value="raising $500K seed round" | evidence=dpu:doc:aaaaaaaa:page:0 | reason=none\n' +
			"market_claims: NotComputable | value=none | evidence=none | reason=NO_MARKET_CLAIM_MENTION\n" +
			"traction_signal: NotComputable | value=none | evidence=none | reason=NO_TRACTION_SIGNAL_MENTION\n" +
			"valuation_terms: NotComputable | value=none | evidence=none | reason=NO_VALUATION_MENTION\n" +
			"use_of_funds: NotComputable | value=none | evidence=none | reason=NO_USE_OF_FUNDS_MENTION";

		const renderPkg = {
			sections: [
				{ key: "insight_slots", title: "Deterministic Insight Slots", kind: "message", body: computableBody, fallback: "" },
			],
		};

		// First repair run
		const pool1 = makeMockPool([
			{ rows: [{ document_id: "aaaaaaaa-0000-0000-0000-000000000001", page_index: 0, payload: RaiseDpuPayload }] },
			{ rows: [] },
			{ rows: [{ id: "report-row-id-003", render_package: renderPkg }] },
			{ rows: [], rowCount: 1 },
		]);
		const result1 = await repairInsightSlotsInReport(pool1 as never, DEAL_ID);

		// Second repair run with same DPU data
		const pool2 = makeMockPool([
			{ rows: [{ document_id: "aaaaaaaa-0000-0000-0000-000000000001", page_index: 0, payload: RaiseDpuPayload }] },
			{ rows: [] },
			{ rows: [{ id: "report-row-id-003", render_package: renderPkg }] },
			{ rows: [], rowCount: 1 },
		]);
		const result2 = await repairInsightSlotsInReport(pool2 as never, DEAL_ID);

		expect(result1.newBody).toBe(result2.newBody);
		expect(result1.newBody).toMatch(/raise_terms: Computable/);
	});

	it("does not flip NotComputable to Computable when DPU genuinely has no match", async () => {
		const staleBody =
			"raise_terms: NotComputable | value=none | evidence=none | reason=NO_RAISE_MENTION\n" +
			"market_claims: NotComputable | value=none | evidence=none | reason=NO_MARKET_CLAIM_MENTION\n" +
			"traction_signal: NotComputable | value=none | evidence=none | reason=NO_TRACTION_SIGNAL_MENTION\n" +
			"valuation_terms: NotComputable | value=none | evidence=none | reason=NO_VALUATION_MENTION\n" +
			"use_of_funds: NotComputable | value=none | evidence=none | reason=NO_USE_OF_FUNDS_MENTION";

		const renderPkg = {
			sections: [{ key: "insight_slots", kind: "message", body: staleBody, title: "" }],
		};

		// DPU has no raise/traction signals — should stay NotComputable after repair
		const pool = makeMockPool([
			{ rows: [{ document_id: "eeeeeeee-0000-0000-0000-000000000001", page_index: 0, payload: EmptyDpuPayload }] },
			{ rows: [] },
			{ rows: [{ id: "report-row-id-004", render_package: renderPkg }] },
			{ rows: [], rowCount: 1 },
		]);

		const result = await repairInsightSlotsInReport(pool as never, DEAL_ID);
		const raiseLine = result.newBody.split("\n").find((l) => l.startsWith("raise_terms:"));
		expect(raiseLine).toMatch(/NotComputable/);
		// Ensure the slot status itself is NotComputable, not Computable
		expect(raiseLine).not.toMatch(/raise_terms: Computable/);
	});
});
