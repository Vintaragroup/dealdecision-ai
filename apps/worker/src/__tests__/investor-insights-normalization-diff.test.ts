/**
 * Tests for the debug.normalization_diff section (Phase 2.1 audit trail).
 *
 * Coverage:
 *   1. Section absent in production (NODE_ENV=production)
 *   2. Section absent when no normalization events occur (clean text)
 *   3. Section present in development when events exist
 *   4. Entry lines sorted by event count descending
 *   5. Body contains page/ref/raw/norm fields for each affected page
 *   6. bonus: coverage_snapshot carries normalization_events + normalized_pages
 *
 * How to verify manually:
 *   1. curl -X POST http://localhost:9001/api/v1/deals/<id>/investor-insights/generate
 *   2. curl http://localhost:9001/api/v1/deals/<id>/investor-insights | \
 *        jq -r '.render_package.sections[] | select(.key=="debug.normalization_diff") | .body'
 */

process.env["NODE_ENV"] = "test";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://user:pass@localhost:5432/test";
process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Pool factory ──────────────────────────────────────────────────────────────

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

/** Multi-page pool — each page gets a distinct UUID so we can test sorting. */
function makeMultiPagePool(pages: Array<{ pageIndex: number; text: string }>): MockPool {
	return makePool(
		pages.map((p, i) => ({
			docId: `a1b2c3d4-0000-0000-0000-${String(i).padStart(12, "0")}`,
			pageIndex: p.pageIndex,
			text: p.text,
		}))
	);
}

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

function makeJob(dealId = "ee1f2340-0000-0000-0000-000000000001") {
	return { id: "job-1", data: { deal_id: dealId, engine_version: "v1" } } as Parameters<
		typeof generateInvestorInsightsProcessor
	>[0];
}

function getInsertedRenderPkg(): { sections: Array<{ key: string; body?: string; title?: string }> } {
	const calls = mockPool.query.mock.calls as Array<[string, ...unknown[]]>;
	const insertCall = calls.find(
		([sql]) => sql.includes("investor_insight_reports") && sql.trimStart().startsWith("INSERT")
	);
	expect(insertCall).toBeTruthy();
	return JSON.parse((insertCall as [string, unknown[]])[1]![6] as string);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("debug.normalization_diff – absent when no events", () => {
	beforeEach(() => { vi.clearAllMocks(); });

	it("section is absent when DPU text is already clean", async () => {
		mockPool = makeSinglePagePool("Raising $5M Series A. TAM $2B.");
		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();
		const diff = pkg.sections.find((s) => s.key === "debug.normalization_diff");
		expect(diff).toBeUndefined();
	});

	it("section is absent when DPU pages are empty", async () => {
		mockPool = makeSinglePagePool("");
		await generateInvestorInsightsProcessor(makeJob("ee1f2340-0000-0000-0000-000000000002"));
		const pkg = getInsertedRenderPkg();
		const diff = pkg.sections.find((s) => s.key === "debug.normalization_diff");
		expect(diff).toBeUndefined();
	});
});

describe("debug.normalization_diff – absent in production", () => {
	beforeEach(() => { vi.clearAllMocks(); });

	it("section is absent when NODE_ENV=production even with OCR garbage", async () => {
		process.env["NODE_ENV"] = "production";
		mockPool = makeSinglePagePool("Raise: S4M seed round.");
		try {
			await generateInvestorInsightsProcessor(makeJob("ee1f2340-0000-0000-0000-000000000003"));
			const pkg = getInsertedRenderPkg();
			const diff = pkg.sections.find((s) => s.key === "debug.normalization_diff");
			expect(diff).toBeUndefined();
		} finally {
			process.env["NODE_ENV"] = "test";
		}
	});
});

describe("debug.normalization_diff – present in dev when events exist", () => {
	beforeEach(() => { vi.clearAllMocks(); });

	it("section is present when DPU contains OCR garbage tokens", async () => {
		mockPool = makeSinglePagePool("Raise: S4M seed round.");
		await generateInvestorInsightsProcessor(makeJob("ee1f2340-0000-0000-0000-000000000004"));
		const pkg = getInsertedRenderPkg();
		const diff = pkg.sections.find((s) => s.key === "debug.normalization_diff");
		expect(diff).toBeDefined();
	});

	it("body starts with dev-only header line", async () => {
		mockPool = makeSinglePagePool("Raise: S4M seed round.");
		await generateInvestorInsightsProcessor(makeJob("ee1f2340-0000-0000-0000-000000000005"));
		const pkg = getInsertedRenderPkg();
		const diff = pkg.sections.find((s) => s.key === "debug.normalization_diff");
		expect(diff!.body).toMatch(/\(dev-only\) Omitted in production\./);
	});

	it("body contains total_events line", async () => {
		mockPool = makeSinglePagePool("Raise: S4M seed round.");
		await generateInvestorInsightsProcessor(makeJob("ee1f2340-0000-0000-0000-000000000006"));
		const pkg = getInsertedRenderPkg();
		const diff = pkg.sections.find((s) => s.key === "debug.normalization_diff");
		expect(diff!.body).toMatch(/total_events: \d+/);
	});

	it("body contains affected_pages line", async () => {
		mockPool = makeSinglePagePool("Raise: S4M seed round.");
		await generateInvestorInsightsProcessor(makeJob("ee1f2340-0000-0000-0000-000000000007"));
		const pkg = getInsertedRenderPkg();
		const diff = pkg.sections.find((s) => s.key === "debug.normalization_diff");
		expect(diff!.body).toMatch(/affected_pages: \d+/);
	});

	it("body contains page= entry line with all required fields", async () => {
		mockPool = makeSinglePagePool("Raise: S4M seed round.");
		await generateInvestorInsightsProcessor(makeJob("ee1f2340-0000-0000-0000-000000000008"));
		const pkg = getInsertedRenderPkg();
		const diff = pkg.sections.find((s) => s.key === "debug.normalization_diff");
		const entryLine = diff!.body!.split("\n").find((l) => l.startsWith("page="));
		expect(entryLine).toBeTruthy();
		expect(entryLine).toMatch(/ref=dpu:doc:[0-9a-f]{8}:page:\d+/);
		expect(entryLine).toMatch(/events=\d+/);
		expect(entryLine).toMatch(/rules=[a-z_$,]+/);
		expect(entryLine).toMatch(/raw=/);
		expect(entryLine).toMatch(/norm=/);
	});

	it("raw preview contains the original OCR garbage token", async () => {
		mockPool = makeSinglePagePool("Raise: S4M seed round.");
		await generateInvestorInsightsProcessor(makeJob("ee1f2340-0000-0000-0000-000000000009"));
		const pkg = getInsertedRenderPkg();
		const diff = pkg.sections.find((s) => s.key === "debug.normalization_diff");
		const entryLine = diff!.body!.split("\n").find((l) => l.startsWith("page="))!;
		// raw= value should contain the original S4M token
		const rawPart = entryLine.split(" | ").find((p) => p.startsWith("raw="))!;
		expect(rawPart).toMatch(/S4M/);
	});

	it("norm preview contains the corrected $4M token", async () => {
		mockPool = makeSinglePagePool("Raise: S4M seed round.");
		await generateInvestorInsightsProcessor(makeJob("ee1f2340-0000-0000-0000-000000000010"));
		const pkg = getInsertedRenderPkg();
		const diff = pkg.sections.find((s) => s.key === "debug.normalization_diff");
		const entryLine = diff!.body!.split("\n").find((l) => l.startsWith("page="))!;
		const normPart = entryLine.split(" | ").find((p) => p.startsWith("norm="))!;
		expect(normPart).toMatch(/\$4M/);
	});

	it("title is 'Debug — OCR Normalization Diff'", async () => {
		mockPool = makeSinglePagePool("Raise: S4M seed round.");
		await generateInvestorInsightsProcessor(makeJob("ee1f2340-0000-0000-0000-000000000011"));
		const pkg = getInsertedRenderPkg();
		const diff = pkg.sections.find((s) => s.key === "debug.normalization_diff");
		expect(diff!.title).toBe("Debug — OCR Normalization Diff");
	});

	it("section ordering: normalization_diff appears after normalization_summary and before canonical_fields", async () => {
		mockPool = makeSinglePagePool("Raise: S4M seed round.");
		await generateInvestorInsightsProcessor(makeJob("ee1f2340-0000-0000-0000-000000000012"));
		const pkg = getInsertedRenderPkg();
		const keys = pkg.sections.map((s) => s.key);
		const summaryIdx = keys.indexOf("debug.normalization_summary");
		const diffIdx = keys.indexOf("debug.normalization_diff");
		const canonIdx = keys.indexOf("canonical_fields");
		expect(diffIdx).toBeGreaterThan(summaryIdx);
		expect(diffIdx).toBeLessThan(canonIdx);
	});
});

describe("debug.normalization_diff – multi-page sorting by event count", () => {
	beforeEach(() => { vi.clearAllMocks(); });

	it("page with more events appears first in entry list", async () => {
		// Page 2 has MORE OCR garbage (S1MM needs 2 transforms: S→$, MM→M)
		// Page 1 has FEWER (just S→$ on S3M)
		mockPool = makeMultiPagePool([
			{ pageIndex: 1, text: "Raise S3M seed." },           // 1 event: S→$
			{ pageIndex: 2, text: "Raise S1MM Series A." },      // 2 events: S→$, MM→M
		]);
		await generateInvestorInsightsProcessor(makeJob("ee1f2340-0000-0000-0000-000000000013"));
		const pkg = getInsertedRenderPkg();
		const diff = pkg.sections.find((s) => s.key === "debug.normalization_diff");
		const entryLines = diff!.body!.split("\n").filter((l) => l.startsWith("page="));
		expect(entryLines.length).toBe(2);
		// First entry should have more events than the second
		const eventsOf = (line: string) => {
			const m = /events=(\d+)/.exec(line);
			return m ? parseInt(m[1]!, 10) : 0;
		};
		expect(eventsOf(entryLines[0]!)).toBeGreaterThanOrEqual(eventsOf(entryLines[1]!));
	});

	it("clean pages are excluded from entry list", async () => {
		mockPool = makeMultiPagePool([
			{ pageIndex: 1, text: "Raising $5M Series A." },     // clean — no events
			{ pageIndex: 2, text: "Raise: S4M seed round." },    // OCR garbage
		]);
		await generateInvestorInsightsProcessor(makeJob("ee1f2340-0000-0000-0000-000000000014"));
		const pkg = getInsertedRenderPkg();
		const diff = pkg.sections.find((s) => s.key === "debug.normalization_diff");
		const entryLines = diff!.body!.split("\n").filter((l) => l.startsWith("page="));
		// Only 1 page has events
		expect(entryLines.length).toBe(1);
		expect(entryLines[0]).toMatch(/page=2/);
	});

	it("affected_pages count matches number of entry lines in single-OCR-page case", async () => {
		mockPool = makeMultiPagePool([
			{ pageIndex: 1, text: "Raising $5M Series A." },
			{ pageIndex: 2, text: "Raise: S4M seed round." },
		]);
		await generateInvestorInsightsProcessor(makeJob("ee1f2340-0000-0000-0000-000000000015"));
		const pkg = getInsertedRenderPkg();
		const diff = pkg.sections.find((s) => s.key === "debug.normalization_diff");
		const body = diff!.body!;
		const affectedMatch = /affected_pages: (\d+)/.exec(body);
		expect(affectedMatch).toBeTruthy();
		const entryCount = body.split("\n").filter((l) => l.startsWith("page=")).length;
		expect(entryCount).toBe(parseInt(affectedMatch![1]!, 10));
	});
});

describe("bonus – coverage_snapshot normalization metrics", () => {
	beforeEach(() => { vi.clearAllMocks(); });

	it("coverage_snapshot body contains normalization_events when OCR events occurred", async () => {
		mockPool = makeSinglePagePool("Raise: S4M seed round.");
		await generateInvestorInsightsProcessor(makeJob("ee1f2340-0000-0000-0000-000000000016"));
		const pkg = getInsertedRenderPkg();
		const cov = pkg.sections.find((s) => s.key === "coverage_snapshot");
		expect(cov!.body).toMatch(/normalization_events: \d+/);
	});

	it("coverage_snapshot body contains normalized_pages when OCR events occurred", async () => {
		mockPool = makeSinglePagePool("Raise: S4M seed round.");
		await generateInvestorInsightsProcessor(makeJob("ee1f2340-0000-0000-0000-000000000017"));
		const pkg = getInsertedRenderPkg();
		const cov = pkg.sections.find((s) => s.key === "coverage_snapshot");
		expect(cov!.body).toMatch(/normalized_pages: \d+/);
	});

	it("normalization_events is 0 and normalized_pages is 0 for clean text", async () => {
		mockPool = makeSinglePagePool("Raising $5M Series A. TAM $2B.");
		await generateInvestorInsightsProcessor(makeJob("ee1f2340-0000-0000-0000-000000000018"));
		const pkg = getInsertedRenderPkg();
		const cov = pkg.sections.find((s) => s.key === "coverage_snapshot");
		expect(cov!.body).toMatch(/normalization_events: 0/);
		expect(cov!.body).toMatch(/normalized_pages: 0/);
	});
});
