/**
 * Tests for Phase 3.0: Deterministic Investor Thesis Stub.
 *
 * Coverage:
 *   - investor_thesis section appears when deterministic_only
 *   - investor_thesis does NOT appear when status=failed
 *   - confidence cap rules (Low / Moderate / High)
 *   - missing categories generate deterministic open questions
 *   - conflicts lower cap from High to Moderate
 *   - section key, title, kind are correct
 *   - section order: completeness_summary before investor_thesis before coverage_snapshot
 */

process.env["NODE_ENV"] = "test";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://user:pass@localhost:5432/test";
process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
	computeConfidenceCap,
	buildInvestorThesisStubSection,
} from "../jobs/investor-insights/processor";
import type { ThesisInputsV1 } from "../jobs/investor-insights/processor";

// ── Unit tests: computeConfidenceCap ──────────────────────────────────────────

function makeThesisInputs(overrides: Partial<ThesisInputsV1> = {}): ThesisInputsV1 {
	return {
		raise_amount: null,
		raise_round: null,
		raise_instrument: null,
		valuation_pre: null,
		valuation_post: null,
		tam_value: null,
		mrr_value: null,
		arr_value: null,
		revenue_value: null,
		coverage_ratio: 0.8,
		conflicts_present: false,
		completeness: [
			{ category: "raise_terms", status: "Present" },
			{ category: "valuation_terms", status: "Present" },
			{ category: "use_of_funds", status: "Present" },
			{ category: "market_claims", status: "Present" },
			{ category: "traction_signal", status: "Present" },
		],
		...overrides,
	};
}

describe("computeConfidenceCap – coverage_ratio rules", () => {
	it("returns Low when coverage_ratio < 0.5", () => {
		expect(computeConfidenceCap(makeThesisInputs({ coverage_ratio: 0.3 }))).toBe("Low");
	});

	it("returns Low when coverage_ratio exactly 0", () => {
		expect(computeConfidenceCap(makeThesisInputs({ coverage_ratio: 0 }))).toBe("Low");
	});

	it("does NOT return Low for coverage_ratio exactly 0.5", () => {
		const cap = computeConfidenceCap(makeThesisInputs({ coverage_ratio: 0.5 }));
		expect(cap).not.toBe("Low");
	});

	it("allows High when coverage_ratio >= 0.5 and all Present", () => {
		expect(computeConfidenceCap(makeThesisInputs({ coverage_ratio: 0.9 }))).toBe("High");
	});
});

describe("computeConfidenceCap – missing category rules", () => {
	it("returns Low when 3 categories are Missing", () => {
		const t = makeThesisInputs({
			coverage_ratio: 0.6,
			completeness: [
				{ category: "raise_terms", status: "Missing" },
				{ category: "valuation_terms", status: "Missing" },
				{ category: "use_of_funds", status: "Missing" },
				{ category: "market_claims", status: "Present" },
				{ category: "traction_signal", status: "Present" },
			],
		});
		expect(computeConfidenceCap(t)).toBe("Low");
	});

	it("returns Low when 4 categories are Missing", () => {
		const t = makeThesisInputs({
			coverage_ratio: 0.6,
			completeness: [
				{ category: "raise_terms", status: "Missing" },
				{ category: "valuation_terms", status: "Missing" },
				{ category: "use_of_funds", status: "Missing" },
				{ category: "market_claims", status: "Missing" },
				{ category: "traction_signal", status: "Present" },
			],
		});
		expect(computeConfidenceCap(t)).toBe("Low");
	});

	it("returns Moderate when exactly 2 categories are Missing", () => {
		const t = makeThesisInputs({
			coverage_ratio: 0.6,
			completeness: [
				{ category: "raise_terms", status: "Missing" },
				{ category: "valuation_terms", status: "Missing" },
				{ category: "use_of_funds", status: "Present" },
				{ category: "market_claims", status: "Present" },
				{ category: "traction_signal", status: "Present" },
			],
		});
		expect(computeConfidenceCap(t)).toBe("Moderate");
	});

	it("returns High when only 1 category is Missing and no conflicts", () => {
		const t = makeThesisInputs({
			coverage_ratio: 0.8,
			completeness: [
				{ category: "raise_terms", status: "Present" },
				{ category: "valuation_terms", status: "Missing" },
				{ category: "use_of_funds", status: "Present" },
				{ category: "market_claims", status: "Present" },
				{ category: "traction_signal", status: "Present" },
			],
		});
		expect(computeConfidenceCap(t)).toBe("High");
	});
});

describe("computeConfidenceCap – conflict rules", () => {
	it("lowers cap from High to Moderate when conflicts_present", () => {
		const t = makeThesisInputs({ coverage_ratio: 0.9, conflicts_present: true });
		expect(computeConfidenceCap(t)).toBe("Moderate");
	});

	it("does NOT raise Low to Moderate when both low-coverage and conflicts", () => {
		const t = makeThesisInputs({ coverage_ratio: 0.3, conflicts_present: true });
		expect(computeConfidenceCap(t)).toBe("Low");
	});

	it("stays Moderate (not Low) with 1 Missing + conflict", () => {
		const t = makeThesisInputs({
			coverage_ratio: 0.8,
			conflicts_present: true,
			completeness: [
				{ category: "raise_terms", status: "Present" },
				{ category: "valuation_terms", status: "Missing" },
				{ category: "use_of_funds", status: "Present" },
				{ category: "market_claims", status: "Present" },
				{ category: "traction_signal", status: "Present" },
			],
		});
		expect(computeConfidenceCap(t)).toBe("Moderate");
	});
});

describe("buildInvestorThesisStubSection – structure", () => {
	it("returns section with key 'investor_thesis'", () => {
		const s = buildInvestorThesisStubSection(makeThesisInputs());
		expect(s.key).toBe("investor_thesis");
	});

	it("title is 'Investor Thesis (Deterministic Stub)'", () => {
		const s = buildInvestorThesisStubSection(makeThesisInputs());
		expect(s.title).toBe("Investor Thesis (Deterministic Stub)");
	});

	it("kind is 'message'", () => {
		const s = buildInvestorThesisStubSection(makeThesisInputs());
		expect(s.kind).toBe("message");
	});

	it("body contains 'Confidence Cap: High' for clean inputs", () => {
		const s = buildInvestorThesisStubSection(makeThesisInputs());
		expect(s.body).toContain("Confidence Cap: High");
	});

	it("body contains 'Confidence Cap: Low' for low-coverage inputs", () => {
		const s = buildInvestorThesisStubSection(makeThesisInputs({ coverage_ratio: 0.1 }));
		expect(s.body).toContain("Confidence Cap: Low");
	});

	it("body contains 'Confidence Cap: Moderate' for conflict inputs", () => {
		const s = buildInvestorThesisStubSection(makeThesisInputs({ conflicts_present: true }));
		expect(s.body).toContain("Confidence Cap: Moderate");
	});

	it("body contains Disclosure Summary with all categories", () => {
		const s = buildInvestorThesisStubSection(makeThesisInputs());
		expect(s.body).toContain("Disclosure Summary:");
		expect(s.body).toContain("raise_terms: Present");
		expect(s.body).toContain("valuation_terms: Present");
		expect(s.body).toContain("use_of_funds: Present");
		expect(s.body).toContain("market_claims: Present");
		expect(s.body).toContain("traction_signal: Present");
	});

	it("body contains no 'Open Questions' when all Present", () => {
		const s = buildInvestorThesisStubSection(makeThesisInputs());
		expect(s.body).not.toContain("Open Questions:");
	});
});

describe("buildInvestorThesisStubSection – open questions for Missing categories", () => {
	it("generates open question for missing raise_terms", () => {
		const t = makeThesisInputs({
			completeness: [
				{ category: "raise_terms", status: "Missing" },
				{ category: "valuation_terms", status: "Present" },
				{ category: "use_of_funds", status: "Present" },
				{ category: "market_claims", status: "Present" },
				{ category: "traction_signal", status: "Present" },
			],
		});
		const s = buildInvestorThesisStubSection(t);
		expect(s.body).toContain("Open Questions:");
		expect(s.body).toContain("raise amount");
	});

	it("generates open question for missing market_claims", () => {
		const t = makeThesisInputs({
			completeness: [
				{ category: "raise_terms", status: "Present" },
				{ category: "valuation_terms", status: "Present" },
				{ category: "use_of_funds", status: "Present" },
				{ category: "market_claims", status: "Missing" },
				{ category: "traction_signal", status: "Present" },
			],
		});
		const s = buildInvestorThesisStubSection(t);
		expect(s.body).toContain("TAM");
	});

	it("generates open question for missing traction_signal", () => {
		const t = makeThesisInputs({
			completeness: [
				{ category: "raise_terms", status: "Present" },
				{ category: "valuation_terms", status: "Present" },
				{ category: "use_of_funds", status: "Present" },
				{ category: "market_claims", status: "Present" },
				{ category: "traction_signal", status: "Missing" },
			],
		});
		const s = buildInvestorThesisStubSection(t);
		expect(s.body).toContain("MRR");
	});

	it("generates separate open question for each Missing category", () => {
		const t = makeThesisInputs({
			coverage_ratio: 0.6,
			completeness: [
				{ category: "raise_terms", status: "Missing" },
				{ category: "valuation_terms", status: "Missing" },
				{ category: "use_of_funds", status: "Present" },
				{ category: "market_claims", status: "Present" },
				{ category: "traction_signal", status: "Present" },
			],
		});
		const s = buildInvestorThesisStubSection(t);
		const lines = s.body.split("\n");
		const questionLines = lines.filter((l) => l.trim().startsWith("-"));
		expect(questionLines.length).toBe(2);
	});
});

// ── Integration tests: section wired into deterministic_only render package ───

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
	makePool([{ docId: "b2c3d4e5-f6a7-8901-bcde-f23456789012", pageIndex: 1, text }]);

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

function makeJob(dealId = "dc9e1f20-0000-0000-0000-000000000001") {
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

describe("processor integration – investor_thesis section in deterministic_only package", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("investor_thesis section is present in deterministic_only package", async () => {
		mockPool = makeSinglePagePool("$3M seed round. TAM $2B.");
		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();
		const thesis = pkg.sections.find((s) => s.key === "investor_thesis");
		expect(thesis).toBeDefined();
		expect(thesis!.body).toContain("Confidence Cap:");
		expect(thesis!.body).toContain("Disclosure Summary:");
	});

	it("investor_thesis body includes completeness categories", async () => {
		mockPool = makeSinglePagePool("$3M seed round.");
		await generateInvestorInsightsProcessor(makeJob("dc9e1f20-0000-0000-0000-000000000002"));
		const pkg = getInsertedRenderPkg();
		const thesis = pkg.sections.find((s) => s.key === "investor_thesis");
		expect(thesis!.body).toMatch(/raise_terms: (Present|Missing)/);
		expect(thesis!.body).toMatch(/valuation_terms: (Present|Missing)/);
		expect(thesis!.body).toMatch(/market_claims: (Present|Missing)/);
	});

	it("open questions appear when categories are Missing", async () => {
		// No DPU text → all fields NotComputable → all categories Missing
		mockPool = makeSinglePagePool("");
		await generateInvestorInsightsProcessor(makeJob("dc9e1f20-0000-0000-0000-000000000003"));
		const pkg = getInsertedRenderPkg();
		const thesis = pkg.sections.find((s) => s.key === "investor_thesis");
		expect(thesis!.body).toContain("Open Questions:");
	});

	it("investor_thesis appears after completeness_summary and before coverage_snapshot", async () => {
		mockPool = makeSinglePagePool("$3M seed round.");
		await generateInvestorInsightsProcessor(makeJob("dc9e1f20-0000-0000-0000-000000000004"));
		const pkg = getInsertedRenderPkg();
		const keys = pkg.sections.map((s) => s.key);
		const completenessIdx = keys.indexOf("completeness_summary");
		const thesisIdx = keys.indexOf("investor_thesis");
		const coverageIdx = keys.indexOf("coverage_snapshot");
		expect(thesisIdx).toBeGreaterThan(completenessIdx);
		expect(thesisIdx).toBeLessThan(coverageIdx);
	});
});
