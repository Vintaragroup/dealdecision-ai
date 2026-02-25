/**
 * Tests for Stage 0 fail-soft behavior when only G3 fails.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Suppress NODE_ENV so the G3 diagnostic section is skipped (avoids extra pool.query calls).
process.env["NODE_ENV"] = "production";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://user:pass@localhost:5432/test";
process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

// ── Pool mock ────────────────────────────────────────────────────────────────

const makePool = () => ({
	query: vi.fn(async (sql: string) => {
		if (sql.includes("current_database")) return { rows: [{ db: "testdb", schema: "public" }] };
		// Dedup SELECT must return empty so the processor always reaches the INSERT.
		// INSERT / ON CONFLICT path is identified by the INSERT keyword.
		if (sql.includes("investor_insight_reports") && sql.trimStart().startsWith("INSERT")) {
			return { rows: [{ id: "mock-report-id" }] };
		}
		// Dedup SELECT: return no rows so INSERT always fires.
		if (sql.includes("investor_insight_reports")) return { rows: [] };
		// Stage 1 insight-slot DPU query: SELECT document_id, page_index, payload … LIMIT 50
		// Distinguish from coverage-snapshot COUNT query by checking for 'document_id' column.
		if (sql.includes("document_page_understanding") && sql.includes("document_id")) {
			return { rows: [] }; // No DPU pages → all slots NotComputable (still builds section)
		}
		// Coverage snapshot DPU count query.
		if (sql.includes("document_page_understanding")) return { rows: [{ total: "5", non_empty: "4" }] };
		// Evidence items (coverage count + insight-slot listing).
		if (sql.includes("evidence_items")) return { rows: [{ c: "12", id: "ev-1", claim_text: null }] };
		// Documents count.
		if (sql.includes("documents") && !sql.includes("visual_assets") && !sql.includes("governed")) return { rows: [{ c: "3" }] };
		// Visual assets count.
		if (sql.includes("visual_assets")) return { rows: [{ c: "6" }] };
		return { rows: [] };
	}),
});

let mockPool = makePool();

vi.mock("../lib/db", () => ({
	getPool: () => mockPool,
	closePool: vi.fn(async () => undefined),
}));

// ── Gates mock ───────────────────────────────────────────────────────────────

import type { GateState } from "../contracts/investor-insights/schemas";

const allPassGateState = (): GateState => ({
	all_passed: true,
	results: [
		{ gate: "G0", passed: true },
		{ gate: "G1", passed: true },
		{ gate: "G2", passed: true },
		{ gate: "G3", passed: true },
		{ gate: "G4", passed: true },
		{ gate: "G5", passed: true },
	],
});

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

const g3PlusOtherFailGateState = (): GateState => ({
	all_passed: false,
	results: [
		{ gate: "G0", passed: true },
		{ gate: "G1", passed: false, reason_code: "GATE_DOCUMENTS_MISSING" },
		{ gate: "G2", passed: true },
		{ gate: "G3", passed: false, reason_code: "GATE_STRUCTURED_JSON_MISSING" },
		{ gate: "G4", passed: true },
		{ gate: "G5", passed: true },
	],
});

/** G3-only fail with QUERY_FAILED → must NOT trigger fail-soft (fail-closed). */
const g3QueryFailedOnlyGateState = (): GateState => ({
	all_passed: false,
	results: [
		{ gate: "G0", passed: true },
		{ gate: "G1", passed: true },
		{ gate: "G2", passed: true },
		{ gate: "G3", passed: false, reason_code: "GATE_STRUCTURED_JSON_QUERY_FAILED" },
		{ gate: "G4", passed: true },
		{ gate: "G5", passed: true },
	],
});

/** G3-only fail with PARSE_FAILED → eligible for fail-soft. */
const g3ParseFailedOnlyGateState = (): GateState => ({
	all_passed: false,
	results: [
		{ gate: "G0", passed: true },
		{ gate: "G1", passed: true },
		{ gate: "G2", passed: true },
		{ gate: "G3", passed: false, reason_code: "GATE_STRUCTURED_JSON_PARSE_FAILED" },
		{ gate: "G4", passed: true },
		{ gate: "G5", passed: true },
	],
});

const mockEvaluateGates = vi.fn(async (..._args: unknown[]): Promise<GateState> => allPassGateState());

vi.mock("../jobs/investor-insights/gates", () => ({
	evaluateGates: (...args: unknown[]) => mockEvaluateGates(...args),
}));

// ── Import processor after mocks ─────────────────────────────────────────────

const { generateInvestorInsightsProcessor } = await import(
	"../jobs/investor-insights/processor"
);

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeJob(dealId = "517be946-cab9-4bc1-8982-9522ff9dab32", forceRecompute = false) {
	return {
		id: "job-1",
		data: {
			deal_id: dealId,
			engine_version: "v1",
			...(forceRecompute ? { force_recompute: true } : {}),
		},
	} as any;
}

/** Type-safe accessor for the mock pool INSERT call's parameter array. */
function getInsertParams(): unknown[] {
	const calls = mockPool.query.mock.calls as Array<[string, ...unknown[]]>;
	const call = calls.find(
		([sql]) => sql.includes("investor_insight_reports") && sql.trimStart().startsWith("INSERT")
	);
	if (!call) throw new Error("No investor_insight_reports INSERT call found");
	return call[1] as unknown[];
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Stage 0 – G3 fail-soft", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockPool = makePool();
		mockEvaluateGates.mockResolvedValue(allPassGateState());
	});

	it("when only G3 fails: result status is deterministic_only", async () => {
		mockEvaluateGates.mockResolvedValue(g3OnlyFailGateState());

		const result: any = await generateInvestorInsightsProcessor(makeJob());

		expect(result.status).toBe("deterministic_only");
		expect(result.ok).toBe(true);
		expect(result.failed_gates).toEqual(["G3"]);
	});

	it("when only G3 fails: persisted render_package sections include g3_remediation and analysis_status", async () => {
		mockEvaluateGates.mockResolvedValue(g3OnlyFailGateState());

		await generateInvestorInsightsProcessor(makeJob());

		// Find the INSERT call and inspect the render_package JSON.
		const insertParams = getInsertParams();

		// $7 is render_package (index 6 in the params array).
		const renderPkgJson = insertParams[6] as string;
		const renderPkg = JSON.parse(renderPkgJson);

		const sectionKeys: string[] = renderPkg.sections.map((s: any) => s.key);
		expect(sectionKeys).toContain("gate_state");
		expect(sectionKeys).toContain("analysis_status");
		expect(sectionKeys).toContain("g3_remediation");
		expect(sectionKeys).toContain("insight_slots");
		expect(sectionKeys).toContain("coverage_snapshot");

		// insight_slots must appear before coverage_snapshot.
		const slotsIdx = sectionKeys.indexOf("insight_slots");
		const coverageIdx = sectionKeys.indexOf("coverage_snapshot");
		expect(slotsIdx).toBeLessThan(coverageIdx);

		const analysisSection = renderPkg.sections.find((s: any) => s.key === "analysis_status");
		expect(analysisSection?.body).toMatch(/deterministic-only/i);
		expect(analysisSection?.body).toMatch(/NotComputable/);

		const remediationSection = renderPkg.sections.find((s: any) => s.key === "g3_remediation");
		expect(remediationSection?.body).toBeTruthy();

		const coverageSection = renderPkg.sections.find((s: any) => s.key === "coverage_snapshot");
		expect(coverageSection?.body).toBeTruthy();
		expect(coverageSection?.body).toMatch(/docs_count:/);
		expect(coverageSection?.body).toMatch(/structured_json_available: false/);
		expect(coverageSection?.body).toMatch(/overlay_available: true/);
		expect(coverageSection?.body).toMatch(/coverage_query_errors: none/);
	});

	it("when G3 and another gate fail: result status is failed (fail-closed)", async () => {
		mockEvaluateGates.mockResolvedValue(g3PlusOtherFailGateState());

		const result: any = await generateInvestorInsightsProcessor(makeJob());

		expect(result.status).toBe("failed");
		expect(result.failed_gates).toContain("G1");
		expect(result.failed_gates).toContain("G3");
	});

	it("when G3 and another gate fail: persisted status is failed", async () => {
		mockEvaluateGates.mockResolvedValue(g3PlusOtherFailGateState());

		await generateInvestorInsightsProcessor(makeJob());

		const insertCall = mockPool.query.mock.calls.find((c: any[]) =>
			typeof c[0] === "string" && c[0].includes("investor_insight_reports")
		);
		expect(insertCall).toBeTruthy();

		// $4 is status (index 3).
		const insertParams = getInsertParams();
		const persistedStatus = insertParams[3];
		expect(persistedStatus).toBe("failed");

		// Coverage snapshot must be present even on the fail-closed path.
		const renderPkg = JSON.parse(insertParams[6] as string);
		const sectionKeys: string[] = renderPkg.sections.map((s: any) => s.key);
		expect(sectionKeys).toContain("insight_slots");
		expect(sectionKeys).toContain("coverage_snapshot");
		const slotsIdx = sectionKeys.indexOf("insight_slots");
		const coverageIdx = sectionKeys.indexOf("coverage_snapshot");
		expect(slotsIdx).toBeLessThan(coverageIdx);
		const coverageSection = renderPkg.sections.find((s: any) => s.key === "coverage_snapshot");
		expect(coverageSection?.body).toBeTruthy();
		expect(coverageSection?.body).toMatch(/docs_count:/);
		expect(coverageSection?.body).toMatch(/coverage_query_errors: none/);
	});

	it("when G3-only fails with QUERY_FAILED: result status is failed (fail-closed, not fail-soft)", async () => {
		mockEvaluateGates.mockResolvedValue(g3QueryFailedOnlyGateState());

		const result: any = await generateInvestorInsightsProcessor(makeJob());

		expect(result.status).toBe("failed");
		expect(result.failed_gates).toEqual(["G3"]);
	});

	it("when G3-only fails with PARSE_FAILED: result status is deterministic_only (fail-soft)", async () => {
		mockEvaluateGates.mockResolvedValue(g3ParseFailedOnlyGateState());

		const result: any = await generateInvestorInsightsProcessor(makeJob());

		expect(result.status).toBe("deterministic_only");
		expect(result.ok).toBe(true);
		expect(result.failed_gates).toEqual(["G3"]);
	});

	it("when all gates pass: persisted render_package includes insight_slots and coverage_snapshot", async () => {
		mockEvaluateGates.mockResolvedValue(allPassGateState());

		// Use a normal job (no force_recompute). The dedup SELECT returns empty rows so the
		// INSERT fires — this mirrors a fresh deal hitting the processor for the first time.
		await generateInvestorInsightsProcessor(makeJob());

		const insertParams = getInsertParams();
		const renderPkg = JSON.parse(insertParams[6] as string);
		const sectionKeys: string[] = renderPkg.sections.map((s: any) => s.key);

		expect(sectionKeys).toContain("gate_state");
		expect(sectionKeys).toContain("analysis_status");
		expect(sectionKeys).toContain("insight_slots");
		expect(sectionKeys).toContain("coverage_snapshot");

		// insight_slots must appear before coverage_snapshot.
		const slotsIdx = sectionKeys.indexOf("insight_slots");
		const coverageIdx = sectionKeys.indexOf("coverage_snapshot");
		expect(slotsIdx).toBeLessThan(coverageIdx);
		expect(renderPkg.status).toBe("deterministic_only");
	});

	it("section key order for all-gates-pass: gate_state → analysis_status → insight_slots → coverage_snapshot", async () => {
		mockEvaluateGates.mockResolvedValue(allPassGateState());

		// Normal job — dedup SELECT returns empty so INSERT fires (no force_recompute needed).
		await generateInvestorInsightsProcessor(makeJob());

		const insertParams = getInsertParams();
		const renderPkg = JSON.parse(insertParams[6] as string);
		const keys: string[] = renderPkg.sections.map((s: any) => s.key);

		const expected = ["gate_state", "analysis_status", "insight_slots", "coverage_snapshot"];
		for (let i = 0; i < expected.length - 1; i++) {
			const aIdx = keys.indexOf(expected[i]!);
			const bIdx = keys.indexOf(expected[i + 1]!);
			expect(aIdx).toBeGreaterThanOrEqual(0);
			expect(bIdx).toBeGreaterThanOrEqual(0);
			expect(aIdx).toBeLessThan(bIdx);
		}
	});

	it("section key order for G3 fail-soft: gate_state → analysis_status → g3_remediation → insight_slots → coverage_snapshot", async () => {
		mockEvaluateGates.mockResolvedValue(g3OnlyFailGateState());

		await generateInvestorInsightsProcessor(makeJob());

		const insertCall = mockPool.query.mock.calls.find((c: any[]) =>
			typeof c[0] === "string" &&
			c[0].includes("investor_insight_reports") &&
			(c[0] as string).trimStart().startsWith("INSERT")
		);
		expect(insertCall).toBeTruthy();

		const renderPkg = JSON.parse((insertCall as unknown as [string, unknown[]])[1]![6] as string);
		const keys: string[] = renderPkg.sections.map((s: any) => s.key);

		const expected = ["gate_state", "analysis_status", "g3_remediation", "insight_slots", "coverage_snapshot"];
		for (let i = 0; i < expected.length - 1; i++) {
			const aIdx = keys.indexOf(expected[i]!);
			const bIdx = keys.indexOf(expected[i + 1]!);
			expect(aIdx).toBeGreaterThanOrEqual(0);
			expect(bIdx).toBeGreaterThanOrEqual(0);
			expect(aIdx).toBeLessThan(bIdx);
		}
	});
});
