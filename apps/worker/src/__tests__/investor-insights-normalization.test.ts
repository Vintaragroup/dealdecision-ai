/**
 * Tests for Phase 2.1: Deterministic OCR Normalization Layer.
 *
 * Two test suites:
 *   1. normalizeForExtraction – pure unit tests, no DB
 *   2. Wired detection        – processor integration via makePool mock
 */

process.env["NODE_ENV"] = "test";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://user:pass@localhost:5432/test";
process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

import { describe, it, expect, vi, beforeEach } from "vitest";
import { normalizeForExtraction } from "../jobs/investor-insights/normalize";

// ── Pure normalization tests ──────────────────────────────────────────────────

describe("normalizeForExtraction – Rule A: money_symbol_S_to_$", () => {
	it("converts S4M to $4M and records 1 event", () => {
		const { text, events } = normalizeForExtraction("S4M");
		expect(text).toContain("$4M");
		expect(events).toHaveLength(1);
		expect(events[0]!.rule).toBe("money_symbol_S_to_$");
		expect(events[0]!.before).toBe("S");
		expect(events[0]!.after).toBe("$");
	});

	it("converts S2.5M to $2.5M", () => {
		const { text } = normalizeForExtraction("raise S2.5M");
		expect(text).toContain("$2.5M");
	});

	it("converts S 4M (with space) to $ 4M", () => {
		const { text, events } = normalizeForExtraction("S 4M");
		expect(text).toContain("$");
		expect(events.some((e) => e.rule === "money_symbol_S_to_$")).toBe(true);
	});

	it("does NOT convert S in 'Sales'", () => {
		const { text, events } = normalizeForExtraction("Sales Strategy");
		expect(text).toBe("Sales Strategy");
		expect(events.filter((e) => e.rule === "money_symbol_S_to_$")).toHaveLength(0);
	});

	it("does NOT convert S in 'Series A'", () => {
		const { text, events } = normalizeForExtraction("Series A round");
		expect(text).toBe("Series A round");
		expect(events.filter((e) => e.rule === "money_symbol_S_to_$")).toHaveLength(0);
	});

	it("does NOT convert S in 'SAM'", () => {
		const { text, events } = normalizeForExtraction("TAM SAM SOM");
		expect(text).toBe("TAM SAM SOM");
		expect(events.filter((e) => e.rule === "money_symbol_S_to_$")).toHaveLength(0);
	});

	it("handles multiple S-tokens in one string", () => {
		const { text, events } = normalizeForExtraction("raise S2M; seed round S500K");
		expect(text).toContain("$2M");
		expect(text).toContain("$500K");
		expect(events.filter((e) => e.rule === "money_symbol_S_to_$").length).toBeGreaterThanOrEqual(2);
	});
});

describe("normalizeForExtraction – Rule C: magnitude double-to-single", () => {
	it("converts 1.5MM to 1.5M", () => {
		const { text, events } = normalizeForExtraction("$1.5MM");
		expect(text).toBe("$1.5M");
		expect(events[0]!.rule).toBe("magnitude_mm_to_m");
	});

	it("converts 10BB to 10B", () => {
		const { text, events } = normalizeForExtraction("$10BB");
		expect(text).toBe("$10B");
		expect(events[0]!.rule).toBe("magnitude_bb_to_b");
	});

	it("leaves $1.5M unchanged", () => {
		const { text, events } = normalizeForExtraction("$1.5M");
		expect(text).toBe("$1.5M");
		expect(events).toHaveLength(0);
	});
});

describe("normalizeForExtraction – Rule D: word magnitudes to letter", () => {
	it("converts '$4 million' to '$4M'", () => {
		const { text, events } = normalizeForExtraction("raise $4 million");
		expect(text).toContain("$4M");
		expect(events.some((e) => e.rule === "magnitude_word_to_letter")).toBe(true);
	});

	it("converts '$5.6 million' to '$5.6M'", () => {
		const { text } = normalizeForExtraction("seeking $5.6 million Series A");
		expect(text).toContain("$5.6M");
	});

	it("converts '$2 billion' to '$2B'", () => {
		const { text } = normalizeForExtraction("TAM $2 billion");
		expect(text).toContain("$2B");
	});

	it("is case-insensitive for Million/MILLION", () => {
		const { text } = normalizeForExtraction("$3 Million");
		expect(text).toContain("$3M");
	});
});

describe("normalizeForExtraction – Rule E: OCR digit confusion", () => {
	it("fixes O→0 inside $-token digit span", () => {
		const { text, events } = normalizeForExtraction("$5O0K");
		expect(text).toContain("$500K");
		expect(events.some((e) => e.rule === "ocr_digit_confusion")).toBe(true);
	});

	it("fixes l→1 inside $-token digit span", () => {
		const { text } = normalizeForExtraction("$l.5M");
		expect(text).toContain("$1.5M");
	});
});

describe("normalizeForExtraction – Rule F: whitespace inside money token", () => {
	it("collapses '$ 4 M' to '$4M'", () => {
		const { text, events } = normalizeForExtraction("$ 4 M");
		expect(text).toContain("$4M");
		expect(events.some((e) => e.rule === "whitespace_inside_money")).toBe(true);
	});

	it("collapses '$ 2.5M' to '$2.5M'", () => {
		const { text } = normalizeForExtraction("raising $ 2.5M");
		expect(text).toContain("$2.5M");
	});
});

describe("normalizeForExtraction – end-to-end OCR compound cases", () => {
	it("'Raise: S4M' normalizes fully to contain '$4M'", () => {
		const { text } = normalizeForExtraction("Raise: S4M");
		expect(text).toContain("$4M");
	});

	it("'S1.5MM seed round' normalizes to '$1.5M'", () => {
		const { text } = normalizeForExtraction("S1.5MM seed round");
		expect(text).toContain("$1.5M");
	});

	it("clean text produces zero events", () => {
		const { events } = normalizeForExtraction("Raising $5M Series A. TAM $2B.");
		expect(events).toHaveLength(0);
	});

	it("NormalizationEvent context is a non-empty string", () => {
		const { events } = normalizeForExtraction("Raise S4M seed");
		expect(events.length).toBeGreaterThan(0);
		for (const ev of events) {
			expect(typeof ev.context).toBe("string");
			expect(ev.context.length).toBeGreaterThan(0);
		}
	});
});

// ── Wired processor integration tests ────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MockPool = { query: ReturnType<typeof vi.fn<any[], any>> };

function makePool(pages: Array<{ docId: string; pageIndex: number; text: string }>): MockPool {
	return {
		query: vi.fn(async (sql: string) => {
			if (sql.includes("current_database")) return { rows: [{ db: "testdb", schema: "public" }] };
			if (sql.includes("investor_insight_reports") && sql.trimStart().startsWith("INSERT"))
				return { rows: [{ id: "mock-report-id" }] };
			if (sql.includes("investor_insight_reports")) return { rows: [] };
			if (sql.includes("document_id") && sql.includes("document_page_understanding"))
				return {
					rows: pages.map((p) => ({
						document_id: p.docId,
						page_index: p.pageIndex,
						payload: { page_text: p.text },
					})),
				};
			if (sql.includes("COUNT") && sql.includes("document_page_understanding"))
				return { rows: [{ total: String(pages.length), non_empty: String(pages.length) }] };
			if (sql.includes("evidence_items")) return { rows: [] };
			if (sql.includes("documents") && sql.includes("COUNT") && !sql.includes("visual_assets"))
				return { rows: [{ c: "2" }] };
			if (sql.includes("visual_assets")) return { rows: [{ c: "3" }] };
			return { rows: [] };
		}),
	};
}

const makeSinglePagePool = (text: string): MockPool =>
	makePool([{ docId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890", pageIndex: 1, text }]);

let mockPool: MockPool = makeSinglePagePool("");

vi.mock("../lib/db", () => ({
	getPool: () => mockPool,
	closePool: vi.fn(async () => undefined),
}));

vi.mock("../jobs/investor-insights/gates", () => ({
	evaluateGates: vi.fn(async () => ({
		all_passed: false,
		results: [
			{ gate: "G0", passed: true },
			{ gate: "G1", passed: true },
			{ gate: "G2", passed: true },
			{ gate: "G3", passed: false, reason_code: "GATE_STRUCTURED_JSON_MISSING" },
			{ gate: "G4", passed: true },
			{ gate: "G5", passed: true },
		],
	})),
}));

const { generateInvestorInsightsProcessor } = await import("../jobs/investor-insights/processor");

function makeJob(dealId = "af2edc64-0000-0000-0000-000000000001") {
	return { id: "job-1", data: { deal_id: dealId, engine_version: "v1" } } as Parameters<typeof generateInvestorInsightsProcessor>[0];
}

function getInsertedRenderPkg(): { sections: Array<{ key: string; body: string }> } {
	const calls = mockPool.query.mock.calls as Array<[string, ...unknown[]]>;
	const insertCall = calls.find(
		([sql]) => sql.includes("investor_insight_reports") && sql.trimStart().startsWith("INSERT")
	);
	expect(insertCall).toBeTruthy();
	return JSON.parse((insertCall as [string, unknown[]])[1]![6] as string);
}

describe("processor integration – normalization wired into raise detection", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("raise_amount is Computable when DPU contains 'Raise: S4M'", async () => {
		mockPool = makeSinglePagePool("Raise: S4M seed round");
		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();
		const cf = pkg.sections.find((s) => s.key === "canonical_fields");
		expect(cf).toBeTruthy();
		expect(cf!.body).toMatch(/field=raise_amount \| computability=Computable/);
	});

	it("debug.normalization_summary section is present in test env when events occur", async () => {
		mockPool = makeSinglePagePool("Seeking S3M Series A");
		await generateInvestorInsightsProcessor(makeJob("af2edc64-0000-0000-0000-000000000002"));
		const pkg = getInsertedRenderPkg();
		const normSection = pkg.sections.find((s) => s.key === "debug.normalization_summary");
		expect(normSection).toBeDefined();
		expect(normSection!.body).toMatch(/money_symbol_S_to_\$/);
	});

	it("debug.normalization_summary is absent when no normalization events occur", async () => {
		mockPool = makeSinglePagePool("Seeking $3M Series A");
		await generateInvestorInsightsProcessor(makeJob("af2edc64-0000-0000-0000-000000000003"));
		const pkg = getInsertedRenderPkg();
		const normSection = pkg.sections.find((s) => s.key === "debug.normalization_summary");
		expect(normSection).toBeUndefined();
	});
});
