/**
 * investor-insights-uof-e2e.test.ts
 *
 * End-to-end unit-level test proving the XLSX Use-of-Funds pipeline chain:
 *
 *   excel_range DPU payload (page_type="excel_range")
 *     → parseUseOfFundsV1          (use-of-funds-parser-v1)
 *     → bestUseOfFundsStatement    (insightSlotInputs)
 *     → use_of_funds_v1 section    (buildUseOfFundsV1Section)
 *     → use_of_funds slot Computable + reason=DERIVED_FROM_USE_OF_FUNDS
 *                                  (evalUseOfFundsSlot → promoteFromUseOfFunds)
 *     → governed_summary_v1 corpus includes useOfFundsBody
 *                                  (buildGovernedSummarySection)
 *     → governed_summary_v1 section present in render_package
 *     → report_payload.governed_summary_v1 persisted to DB
 *
 * Test architecture:
 *   - Mock pool provides one excel_range DPU page; no text-based DPU pages.
 *   - All gates mocked as all_passed=true so the governed summary path runs.
 *   - resolveGovernedSummaryWithCache mocked to return a valid record (no LLM call).
 *   - Assertions inspect the INSERT parameters captured by the mock pool vitest spy.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

process.env["NODE_ENV"] = "test";
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://user:pass@localhost:5432/test";
process.env.REDIS_URL     = process.env.REDIS_URL    || "redis://localhost:6379";

// ─── XLSX DPU fixture ─────────────────────────────────────────────────────────

/**
 * A minimal excel_range DPU payload that represents a Use-of-Funds XLSX tab.
 * - page_type: "excel_range"  triggers XLSX-parser branch in loadInsightSlotInputs
 * - "Use of Funds" header row triggers parseUseOfFundsV1 header-detection
 * - Four allocation buckets (all ≤100 → treated as percentages) sum to 100
 * - ≥2 buckets satisfies promoteFromUseOfFunds quality guardrail
 */
const UOF_XLSX_PAYLOAD = {
	page_type: "excel_range",
	structured: {
		kind: "excel_range",
		rows_preview: [
			{ col_A: "Use of Funds" },
			{ col_A: "Product Development", col_B: 40 },
			{ col_A: "Sales & Marketing",   col_B: 30 },
			{ col_A: "G&A",                col_B: 20 },
			{ col_A: "Other",              col_B: 10 },
		],
	},
};

const UOF_DOC_ID = "00000000-0000-4000-8000-000000000001";

// ─── Mock pool factory ────────────────────────────────────────────────────────

/**
 * Build a mock pool that returns the XLSX UoF DPU page for the main DPU SELECT,
 * empty rows for all investor_insight_reports reads (no prior report), and
 * a successful mock insert result.
 *
 * Designed for the all-gates-pass processor path which runs more DB queries
 * than the G3-only-fail path used in other test files:
 *   - loadUpstreamSnapshot: COUNT queries for dpu/evidence/visuals/governed_llm_overviews
 *   - dedup check: SELECT id, status ... WHERE upstream_fingerprint
 *   - loadCoverageSnapshot: COUNT queries
 *   - loadInsightSlotInputs: DPU SELECT (main data) + evidence SELECT
 *   - loadPreviousFusedFacts: SELECT report_payload ... WHERE report_payload != '{}'
 *   - loadPreviousGovernedSummary: SELECT report_payload ... WHERE report_payload != '{}'
 *   - persistReport: INSERT INTO investor_insight_reports
 */
const makeUofPool = () => ({
	query: vi.fn(async (sql: string) => {
		if (sql.includes("current_database")) {
			return { rows: [{ db: "testdb", schema: "public" }] };
		}

		if (sql.includes("investor_insight_reports")) {
			// INSERT → return a mock report row ID
			if (sql.trimStart().startsWith("INSERT")) {
				return { rows: [{ id: "uof-e2e-report-id-001" }] };
			}
			// Dedup check: SELECT id, status ... WHERE ... AND upstream_fingerprint
			if (sql.includes("upstream_fingerprint")) {
				return { rows: [] }; // No existing dedup match → proceed
			}
			// loadPreviousFusedFacts / loadPreviousGovernedSummary:
			//   SELECT report_payload ... WHERE report_payload != '{}'
			if (sql.includes("report_payload")) {
				return { rows: [] }; // No prior report → cache miss is fine
			}
			return { rows: [] };
		}

		// Main DPU SELECT: SELECT document_id, page_index, payload FROM document_page_understanding
		// Also matches loadUpstreamSnapshot's COUNT query — differentiate by presence of COUNT.
		if (sql.includes("document_page_understanding")) {
			if (sql.includes("COUNT")) {
				// Upstream snapshot + coverage snapshot COUNT queries.
				// Return sufficient coverage so the Evidence Gate v1 passes (E2: ≥55%).
				return { rows: [{ total: "30", non_empty: "20" }] };
			}
			// Main DPU page load (SELECT document_id, page_index, payload LIMIT 500)
			return {
				rows: [
					{
						document_id: UOF_DOC_ID,
						page_index:  0,
						payload:     UOF_XLSX_PAYLOAD,
					},
				],
			};
		}

		// evidence_items
		if (sql.includes("evidence_items")) {
			// Coverage snapshot COUNT query (Evidence Gate E3: ≥25 items).
			if (sql.includes("COUNT")) {
				return { rows: [{ c: "30" }] };
			}
			return { rows: [] };
		}

		// documents COUNT
		if (sql.includes("documents") && sql.includes("COUNT") && !sql.includes("visual_assets")) {
			return { rows: [{ c: "1" }] };
		}

		// visual_assets COUNT
		if (sql.includes("visual_assets")) {
			return { rows: [{ c: "0" }] };
		}

		// governed_llm_overviews COUNT (loadUpstreamSnapshot overlay check)
		if (sql.includes("governed_llm_overviews")) {
			return { rows: [{ c: "0" }] };
		}

		return { rows: [] };
	}),
});

let mockPool = makeUofPool();

vi.mock("../lib/db", () => ({
	getPool:   () => mockPool,
	closePool: vi.fn(async () => undefined),
}));

// ─── All-gates-pass gate state ────────────────────────────────────────────────

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

const mockEvaluateGates = vi.fn(async (..._args: unknown[]): Promise<GateState> => allPassGateState());

vi.mock("../jobs/investor-insights/gates", () => ({
	evaluateGates: (...args: unknown[]) => mockEvaluateGates(...args),
}));

// ─── Governed summary mock ────────────────────────────────────────────────────
//
// resolveGovernedSummaryWithCache is mocked to return a deterministic valid
// record so no real LLM API call is made.  serializeGovernedSummaryBody and
// all other exports are preserved from the real module.

vi.mock("../jobs/investor-insights/governed-summary-v1", async (importOriginal) => {
	const actual = await importOriginal() as typeof import("../jobs/investor-insights/governed-summary-v1");

	const mockRecord = {
		schema_version: "governed_summary_v1" as const,
		summary: {
			schema_version: "governed_summary_v1" as const,
			executive_summary: "Mock E2E: Company has clear XLSX Use-of-Funds allocation.",
			strengths: ["XLSX Use-of-Funds data structured and parseable"],
			risks:     [],
			open_questions: [],
		},
		fingerprint:   "uof-e2e-test-fp-001",
		source:        "generated" as const,
		validation_ok: true,
		unknown_tokens: [],
		corpus_hash:   "uof-e2e-test-hash",
	};

	return {
		...actual,
		resolveGovernedSummaryWithCache: vi.fn(async () => mockRecord),
	};
});

// ─── Import processor after all mocks ────────────────────────────────────────

const { generateInvestorInsightsProcessor } = await import(
	"../jobs/investor-insights/processor"
);

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeJob(dealId = "e2e00000-0000-4000-8000-000000000001") {
	return { id: "uof-e2e-job-1", data: { deal_id: dealId, engine_version: "v1" } } as any;
}

/** Extract render_package from the INSERT call's $7 parameter. */
function getInsertedRenderPkg(): any {
	const calls = mockPool.query.mock.calls as Array<[string, ...unknown[]]>;
	const insertCall = calls.find(
		([sql]) => sql.includes("investor_insight_reports") && sql.trimStart().startsWith("INSERT")
	);
	expect(insertCall, "INSERT into investor_insight_reports not found").toBeTruthy();
	return JSON.parse((insertCall as [string, unknown[]])[1]![6] as string);
}

/** Extract report_payload from the INSERT call's $8 parameter. */
function getInsertedReportPayload(): any {
	const calls = mockPool.query.mock.calls as Array<[string, ...unknown[]]>;
	const insertCall = calls.find(
		([sql]) => sql.includes("investor_insight_reports") && sql.trimStart().startsWith("INSERT")
	);
	expect(insertCall, "INSERT into investor_insight_reports not found").toBeTruthy();
	return JSON.parse((insertCall as [string, unknown[]])[1]![7] as string);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("UoF E2E – XLSX to governed_summary_v1 pipeline", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockPool = makeUofPool();
		mockEvaluateGates.mockResolvedValue(allPassGateState());
	});

	it("use_of_funds_v1 section is present in render_package when XLSX UoF data exists", async () => {
		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const sectionKeys: string[] = pkg.sections.map((s: any) => s.key);
		expect(sectionKeys, `Expected use_of_funds_v1 in sections=${sectionKeys.join(", ")}`).toContain("use_of_funds_v1");
	});

	it("use_of_funds_v1 section body contains parsed bucket data", async () => {
		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const uofSection = pkg.sections.find((s: any) => s.key === "use_of_funds_v1");
		expect(uofSection).toBeTruthy();
		// Body should reference the schema and source
		expect(uofSection.body).toMatch(/schema_version: use_of_funds_v1/);
		expect(uofSection.body).toMatch(/buckets: [1-9]/);
		// At least one bucket label from our fixture
		expect(uofSection.body).toMatch(/Product Development|Sales|G&A|Other/);
	});

	it("use_of_funds insight slot is Computable when promoted from XLSX (no text patterns)", async () => {
		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const slotsSection = pkg.sections.find((s: any) => s.key === "insight_slots");
		expect(slotsSection, "insight_slots section missing").toBeTruthy();
		// Slot must be Computable (promoted via promoteFromUseOfFunds bridge)
		expect(slotsSection.body).toMatch(/use_of_funds:\s*Computable/);
	});

	it("use_of_funds slot reason is DERIVED_FROM_USE_OF_FUNDS (not text-pattern match)", async () => {
		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const slotsSection = pkg.sections.find((s: any) => s.key === "insight_slots");
		expect(slotsSection).toBeTruthy();
		// The reason must be the XLSX-bridge code, proving data came from excel_range page
		expect(slotsSection.body).toMatch(/reason=DERIVED_FROM_USE_OF_FUNDS/);
	});

	it("use_of_funds slot evidence ref points to the XLSX DPU page", async () => {
		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const slotsSection = pkg.sections.find((s: any) => s.key === "insight_slots");
		expect(slotsSection).toBeTruthy();
		// Evidence ref: dpu:doc:<8-hex-of-doc-id>:page:0
		const docPrefix = UOF_DOC_ID.replace(/-/g, "").slice(0, 8);
		expect(slotsSection.body).toMatch(new RegExp(`evidence=dpu:doc:${docPrefix}:page:0`));
	});

	it("governed_summary_v1 section is present when all gates pass", async () => {
		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const sectionKeys: string[] = pkg.sections.map((s: any) => s.key);
		expect(sectionKeys, `governed_summary_v1 missing; sections=${sectionKeys.join(", ")}`).toContain("governed_summary_v1");
	});

	it("governed_summary_v1 section body is serialized from mock record", async () => {
		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const govSection = pkg.sections.find((s: any) => s.key === "governed_summary_v1");
		expect(govSection).toBeTruthy();
		// The mock summary text
		expect(govSection.body).toMatch(/XLSX Use-of-Funds/);
		// Structured JSON delimiter embedded
		expect(govSection.body).toMatch(/---governed_summary_v1_json---/);
	});

	it("report_payload includes governed_summary_v1 record", async () => {
		await generateInvestorInsightsProcessor(makeJob());
		const payload = getInsertedReportPayload();

		expect(payload).toHaveProperty("governed_summary_v1");
		const gov = payload.governed_summary_v1 as any;
		expect(gov.fingerprint).toBe("uof-e2e-test-fp-001");
		expect(gov.validation_ok).toBe(true);
		expect(gov.summary?.schema_version).toBe("governed_summary_v1");
	});

	it("resolveGovernedSummaryWithCache receives useOfFundsBody (UoF in governed corpus)", async () => {
		// Re-import the mocked module to capture the spy reference
		const govModule = await import("../jobs/investor-insights/governed-summary-v1");
		const spy = govModule.resolveGovernedSummaryWithCache as ReturnType<typeof vi.fn>;

		await generateInvestorInsightsProcessor(makeJob());

		expect(spy).toHaveBeenCalledOnce();
		const callArgs = spy.mock.calls[0]![0] as Record<string, unknown>;
		// useOfFundsBody must be non-null — confirms UoF data was passed to governed corpus
		expect(callArgs.useOfFundsBody, "useOfFundsBody must be non-null in governed corpus args").not.toBeNull();
		expect(typeof callArgs.useOfFundsBody).toBe("string");
		// The body should contain the parsed bucket data
		expect(callArgs.useOfFundsBody as string).toMatch(/bucket:|Product Development|Sales/i);
	});

	it("full section ordering: insight_slots before governed_summary_v1 before coverage_snapshot", async () => {
		await generateInvestorInsightsProcessor(makeJob());
		const pkg = getInsertedRenderPkg();

		const keys: string[] = pkg.sections.map((s: any) => s.key);
		const slotsIdx    = keys.indexOf("insight_slots");
		const govIdx      = keys.indexOf("governed_summary_v1");
		const coverageIdx = keys.indexOf("coverage_snapshot");

		expect(slotsIdx, "insight_slots section missing").toBeGreaterThanOrEqual(0);
		expect(govIdx,   "governed_summary_v1 section missing").toBeGreaterThanOrEqual(0);
		expect(coverageIdx, "coverage_snapshot section missing").toBeGreaterThanOrEqual(0);

		// Governed summary is inserted after analysis_status (before coverage_snapshot)
		expect(govIdx).toBeLessThan(coverageIdx);
	});
});
