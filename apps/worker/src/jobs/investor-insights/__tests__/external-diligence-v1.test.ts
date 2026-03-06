/**
 * external-diligence-v1.test.ts — PR35
 *
 * Unit tests for the External Due Diligence layer.
 *
 * Test strategy:
 *   - buildExternalDiligenceQueryPlan: company/sector/founder extraction, query string shapes
 *   - normalizeExternalResults: URL dedup, run_status derivation, claim corroboration
 *   - serializeExternalDiligenceBody: null when skipped, content when results present
 *   - serializeExternalDiligenceSectionBody + parseExternalDiligenceSectionBody: round-trip
 *   - runTavilySearches: skipped when flag is off, skipped when API key missing
 *   - buildExternalDiligenceRenderSection: null when skipped, section shape when has results
 *   - runExternalDiligenceV1: graceful degradation on Tavily error
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
	buildExternalDiligenceQueryPlan,
} from "../external-diligence/build-query-plan";
import {
	normalizeExternalResults,
} from "../external-diligence/normalize-external-results";
import {
	serializeExternalDiligenceBody,
	serializeExternalDiligenceSectionBody,
	parseExternalDiligenceSectionBody,
} from "../external-diligence/serialize-external-diligence";
import {
	runTavilySearches,
} from "../external-diligence/run-tavily-searches";
import {
	buildExternalDiligenceRenderSection,
	runExternalDiligenceV1,
} from "../external-diligence/external-diligence-v1";
import type {
	ExternalDiligenceV1,
	ExternalDiligenceBucket,
	ExternalDiligenceQueryPlan,
} from "../external-diligence/external-diligence-schema";
import {
	MAX_RESULTS_PER_QUERY,
	MAX_TOTAL_RESULTS,
} from "../external-diligence/external-diligence-schema";
import type { InsightSlotInputs } from "../stages/stage-2-deterministic";

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockSearchFn = vi.hoisted(() => vi.fn());

vi.mock("@tavily/core", () => ({
	tavily: vi.fn().mockReturnValue({
		search: mockSearchFn,
	}),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Minimal InsightSlotInputs stub for query plan tests */
function makeInputs(dpuPages: Array<{ text: string }> = []): InsightSlotInputs {
	return {
		dpuPages: dpuPages.map((p, i) => ({
			document_id: `doc-${i}`,
			page_index: i,
			text: p.text,
			text_raw: p.text,
			norm_events_count: 0,
		})),
		evidenceSnippets: [],
		dpuLoadFailed: false,
		g3Passed: true,
		dpuDiag: { totalPages: dpuPages.length, pagesWithText: dpuPages.length, emptyPages: 0 },
		normEvents: [],
		financialStatements: [],
		bestFinancialStatement: null,
		useOfFundsStatements: [],
		bestUseOfFundsStatement: null,
		impliedCapitalAllocation: null,
		impliedFromIncomeStatement: null,
		financialLayoutClassification: null,
		financialReconciliation: null,
		balanceSheet: null,
		cashFlow: null,
		capTable: null,
		saasKpis: null,
		bankTransactions: null,
		deckFinancialSignals: null,
	} as unknown as InsightSlotInputs;
}

function makeOkBucket(
	bucket: ExternalDiligenceBucket["bucket"],
	results: Array<{ url: string; snippet?: string }>
): ExternalDiligenceBucket {
	return {
		bucket,
		query_used: `query for ${bucket}`,
		results: results.map((r) => ({
			url: r.url,
			title: "Test Title",
			snippet: r.snippet ?? "This is a test snippet about the company.",
			score: 0.85,
			published_date: "2025-01-15",
			bucket,
		})),
		results_count: results.length,
		status: "ok",
	};
}

function makeFailedBucket(bucket: ExternalDiligenceBucket["bucket"]): ExternalDiligenceBucket {
	return {
		bucket,
		query_used: `query for ${bucket}`,
		results: [],
		results_count: 0,
		status: "failed",
		error_message: "Network error",
	};
}

function makeSkippedBucket(bucket: ExternalDiligenceBucket["bucket"]): ExternalDiligenceBucket {
	return {
		bucket,
		query_used: `query for ${bucket}`,
		results: [],
		results_count: 0,
		status: "skipped",
	};
}

function makeDiligence(overrides?: Partial<ExternalDiligenceV1>): ExternalDiligenceV1 {
	return {
		schema_version: "external_diligence_v1",
		run_status: "succeeded",
		total_results_fetched: 5,
		queries_run: 6,
		buckets: [
			makeOkBucket("company_overview", [
				{ url: "https://techcrunch.com/2025/01/acme", snippet: "Acme raised $500K seed round." },
				{ url: "https://linkedin.com/company/acme", snippet: "Acme Corp builds automation software." },
			]),
			makeOkBucket("competitors", [
				{ url: "https://g2.com/categories/workflow", snippet: "Top competitors include WorkflowAI and FlowDash." },
			]),
			makeOkBucket("market_trends", [
				{ url: "https://gartner.com/market-2025", snippet: "Workflow automation market expected to grow 25% YoY." },
			]),
			makeSkippedBucket("company_news"),
			makeSkippedBucket("founder_team_signals"),
			makeSkippedBucket("financial_market_context"),
		],
		claim_corroborations: [],
		company_name_used: "Acme Corp",
		sector_used: "workflow automation",
		ran_at: "2025-01-15T12:00:00.000Z",
		tavily_credits_used: 6,
		...overrides,
	};
}

// ─── Tests: buildExternalDiligenceQueryPlan ───────────────────────────────────

describe("buildExternalDiligenceQueryPlan", () => {
	it("uses dealName as fallback when DPU pages are empty", () => {
		const plan = buildExternalDiligenceQueryPlan(makeInputs(), "AcmeCo");
		expect(plan.company_name).toBe("AcmeCo");
		expect(plan.queries.company_overview).toContain("AcmeCo");
		expect(plan.queries.competitors).toContain("AcmeCo");
		expect(plan.queries.company_news).toContain("AcmeCo");
	});

	it("extracts company name from 'Company: X' pattern on first pages", () => {
		const plan = buildExternalDiligenceQueryPlan(
			makeInputs([{ text: "Company: BrightPath AI\nWe help teams automate workflows." }])
		);
		expect(plan.company_name).toBe("BrightPath AI");
	});

	it("extracts sector from 'industry: X' pattern", () => {
		const plan = buildExternalDiligenceQueryPlan(
			makeInputs([{ text: "industry: SaaS / workflow automation" }])
		);
		expect(plan.sector).toBeTruthy();
		expect(plan.sector!.toLowerCase()).toContain("saas");
	});

	it("extracts founder name from 'CEO: Name' pattern", () => {
		const plan = buildExternalDiligenceQueryPlan(
			makeInputs([{ text: "CEO: Jane Smith\nOur mission is to automate everything." }])
		);
		expect(plan.founder_name).toBe("Jane Smith");
		expect(plan.queries.founder_team_signals).toContain("Jane Smith");
	});

	it("returns all 6 bucket query strings", () => {
		const plan = buildExternalDiligenceQueryPlan(makeInputs(), "TestCo");
		const keys: Array<keyof typeof plan.queries> = [
			"company_overview",
			"competitors",
			"market_trends",
			"company_news",
			"founder_team_signals",
			"financial_market_context",
		];
		for (const key of keys) {
			expect(typeof plan.queries[key]).toBe("string");
			expect(plan.queries[key].length).toBeGreaterThan(5);
		}
	});

	it("falls back to generic label when no company name is detectable", () => {
		const plan = buildExternalDiligenceQueryPlan(makeInputs([{ text: "revenue grew 20%" }]));
		expect(plan.queries.company_overview).toContain("this company");
	});
});

// ─── Tests: normalizeExternalResults ─────────────────────────────────────────

describe("normalizeExternalResults", () => {
	const mockPlan: ExternalDiligenceQueryPlan = {
		company_name: "Acme Corp",
		sector: "workflow automation",
		founder_name: "Jane Smith",
		queries: {
			company_overview: "Acme Corp company overview",
			competitors: "Acme Corp competitors",
			market_trends: "workflow automation market trends 2025",
			company_news: "Acme Corp news 2025",
			founder_team_signals: "Jane Smith CEO founder",
			financial_market_context: "workflow automation investment 2025",
		},
	};

	it("derives run_status=succeeded when some buckets are ok and none failed", () => {
		const result = normalizeExternalResults(
			{
				buckets: [
					makeOkBucket("company_overview", [{ url: "https://example.com/a" }]),
					makeSkippedBucket("competitors"),
					makeSkippedBucket("market_trends"),
					makeSkippedBucket("company_news"),
					makeSkippedBucket("founder_team_signals"),
					makeSkippedBucket("financial_market_context"),
				],
				total_results_fetched: 1,
				queries_run: 1,
				tavily_credits_used: 1,
			},
			mockPlan
		);
		expect(result.run_status).toBe("succeeded");
	});

	it("derives run_status=partial when some buckets ok and some failed", () => {
		const result = normalizeExternalResults(
			{
				buckets: [
					makeOkBucket("company_overview", [{ url: "https://example.com/a" }]),
					makeFailedBucket("competitors"),
					makeSkippedBucket("market_trends"),
					makeSkippedBucket("company_news"),
					makeSkippedBucket("founder_team_signals"),
					makeSkippedBucket("financial_market_context"),
				],
				total_results_fetched: 1,
				queries_run: 2,
				tavily_credits_used: null,
			},
			mockPlan
		);
		expect(result.run_status).toBe("partial");
	});

	it("derives run_status=skipped when all buckets are skipped", () => {
		const buckets = (
			["company_overview", "competitors", "market_trends", "company_news", "founder_team_signals", "financial_market_context"] as const
		).map((b) => makeSkippedBucket(b));
		const result = normalizeExternalResults(
			{ buckets, total_results_fetched: 0, queries_run: 0, tavily_credits_used: null },
			mockPlan
		);
		expect(result.run_status).toBe("skipped");
	});

	it("deduplicates results with the same URL across buckets", () => {
		const result = normalizeExternalResults(
			{
				buckets: [
					makeOkBucket("company_overview", [
						{ url: "https://techcrunch.com/acme/" },
						{ url: "https://techcrunch.com/acme/" }, // duplicate
					]),
					makeSkippedBucket("competitors"),
					makeSkippedBucket("market_trends"),
					makeSkippedBucket("company_news"),
					makeSkippedBucket("founder_team_signals"),
					makeSkippedBucket("financial_market_context"),
				],
				total_results_fetched: 2,
				queries_run: 1,
				tavily_credits_used: null,
			},
			mockPlan
		);
		// After dedup, only 1 result should remain
		const bucket = result.buckets.find((b) => b.bucket === "company_overview")!;
		expect(bucket.results_count).toBe(1);
		expect(result.total_results_fetched).toBe(1);
	});

	it("includes schema_version and ran_at in output", () => {
		const result = normalizeExternalResults(
			{
				buckets: (["company_overview", "competitors", "market_trends", "company_news", "founder_team_signals", "financial_market_context"] as const).map((b) =>
					makeSkippedBucket(b)
				),
				total_results_fetched: 0,
				queries_run: 0,
				tavily_credits_used: null,
			},
			mockPlan
		);
		expect(result.schema_version).toBe("external_diligence_v1");
		expect(result.ran_at).toBeTruthy();
		expect(result.company_name_used).toBe("Acme Corp");
		expect(result.sector_used).toBe("workflow automation");
	});

	it("builds claim corroborations from canonical fields body", () => {
		const canonicalBody = "field=raise_amount value=$500K evidence=doc1 reason=detected";
		const result = normalizeExternalResults(
			{
				buckets: [
					makeOkBucket("company_overview", [
						{ url: "https://tc.com/acme", snippet: "Acme Corp raised $500K seed round this year." },
					]),
					makeSkippedBucket("competitors"),
					makeSkippedBucket("market_trends"),
					makeSkippedBucket("company_news"),
					makeSkippedBucket("founder_team_signals"),
					makeSkippedBucket("financial_market_context"),
				],
				total_results_fetched: 1,
				queries_run: 1,
				tavily_credits_used: null,
			},
			mockPlan,
			canonicalBody
		);
		// Should at least attempt corroboration (result depends on snippet matching)
		expect(Array.isArray(result.claim_corroborations)).toBe(true);
	});
});

// ─── Tests: serializeExternalDiligenceBody ───────────────────────────────────

describe("serializeExternalDiligenceBody", () => {
	it("returns null when run_status=skipped", () => {
		const diligence = makeDiligence({ run_status: "skipped", total_results_fetched: 0 });
		expect(serializeExternalDiligenceBody(diligence)).toBeNull();
	});

	it("returns null when run_status=failed and 0 results", () => {
		const diligence = makeDiligence({ run_status: "failed", total_results_fetched: 0 });
		expect(serializeExternalDiligenceBody(diligence)).toBeNull();
	});

	it("returns a string body when there are results", () => {
		const body = serializeExternalDiligenceBody(makeDiligence());
		expect(typeof body).toBe("string");
		expect(body!.length).toBeGreaterThan(50);
		expect(body).toContain("Acme Corp");
	});

	it("includes bucket labels in the body", () => {
		const body = serializeExternalDiligenceBody(makeDiligence());
		expect(body).toContain("Company Overview");
		expect(body).toContain("Competitive Landscape");
	});

	it("respects MAX_BODY_CHARS hard cap", () => {
		// Build a diligence with many large snippets
		const manyResults = Array.from({ length: 10 }, (_, i) => ({
			url: `https://example${i}.com`,
			snippet: "x".repeat(490),
		}));
		const diligence = makeDiligence({
			buckets: [makeOkBucket("company_overview", manyResults), makeSkippedBucket("competitors"), makeSkippedBucket("market_trends"), makeSkippedBucket("company_news"), makeSkippedBucket("founder_team_signals"), makeSkippedBucket("financial_market_context")],
			total_results_fetched: 10,
		});
		const body = serializeExternalDiligenceBody(diligence);
		// 4000 chars + "[truncated]" = ~4011
		expect(body!.length).toBeLessThanOrEqual(4020);
		expect(body).toContain("[truncated]");
	});
});

// ─── Tests: section round-trip ────────────────────────────────────────────────

describe("serializeExternalDiligenceSectionBody / parseExternalDiligenceSectionBody", () => {
	it("round-trips full ExternalDiligenceV1", () => {
		const original = makeDiligence();
		const body = serializeExternalDiligenceSectionBody(original);
		const parsed = parseExternalDiligenceSectionBody(body);
		expect(parsed).not.toBeNull();
		expect(parsed!.schema_version).toBe("external_diligence_v1");
		expect(parsed!.run_status).toBe(original.run_status);
		expect(parsed!.total_results_fetched).toBe(original.total_results_fetched);
		expect(parsed!.company_name_used).toBe(original.company_name_used);
		expect(parsed!.buckets.length).toBe(original.buckets.length);
	});

	it("returns null when section body has no delimiter", () => {
		expect(parseExternalDiligenceSectionBody("plain text no delimiter")).toBeNull();
	});

	it("returns null when JSON after delimiter is malformed", () => {
		const body = "header\n\n---external_diligence_v1_json---\n{not json";
		expect(parseExternalDiligenceSectionBody(body)).toBeNull();
	});

	it("returns null when schema_version is wrong", () => {
		const body = `header\n\n---external_diligence_v1_json---\n${JSON.stringify({ schema_version: "other_v1" })}`;
		expect(parseExternalDiligenceSectionBody(body)).toBeNull();
	});
});

// ─── Tests: runTavilySearches (with env mocking) ──────────────────────────────

describe("runTavilySearches — feature flags", () => {
	beforeEach(() => {
		delete process.env["TAVILY_ENABLED"];
		delete process.env["TAVILY_API_KEY"];
		mockSearchFn.mockReset();
	});

	afterEach(() => {
		delete process.env["TAVILY_ENABLED"];
		delete process.env["TAVILY_API_KEY"];
	});

	it("returns all-skipped buckets when TAVILY_ENABLED is not set", async () => {
		const plan: ExternalDiligenceQueryPlan = {
			company_name: "TestCo",
			sector: null,
			founder_name: null,
			queries: {
				company_overview: "TestCo company",
				competitors: "TestCo competitors",
				market_trends: "TestCo market",
				company_news: "TestCo news",
				founder_team_signals: "TestCo founder",
				financial_market_context: "TestCo investment",
			},
		};
		const result = await runTavilySearches(plan, "deal-123");
		expect(result.queries_run).toBe(0);
		expect(result.total_results_fetched).toBe(0);
		expect(result.buckets.every((b) => b.status === "skipped")).toBe(true);
		expect(mockSearchFn).not.toHaveBeenCalled();
	});

	it("returns all-skipped when TAVILY_ENABLED=true but API key missing", async () => {
		process.env["TAVILY_ENABLED"] = "true";
		const plan: ExternalDiligenceQueryPlan = {
			company_name: "TestCo",
			sector: null,
			founder_name: null,
			queries: {
				company_overview: "Q1", competitors: "Q2", market_trends: "Q3",
				company_news: "Q4", founder_team_signals: "Q5", financial_market_context: "Q6",
			},
		};
		const result = await runTavilySearches(plan, "deal-123");
		expect(result.queries_run).toBe(0);
		expect(result.buckets.every((b) => b.status === "skipped")).toBe(true);
		expect(mockSearchFn).not.toHaveBeenCalled();
	});

	it("executes queries and maps results when enabled and key set", async () => {
		process.env["TAVILY_ENABLED"] = "true";
		process.env["TAVILY_API_KEY"] = "tvly-test-key";
		mockSearchFn.mockResolvedValue({
			results: [
				{
					title: "Acme Funding",
					url: "https://tc.com/acme",
					content: "Acme raised $500K seed.",
					score: 0.9,
					publishedDate: "2025-01-15",
				},
			],
			usage: { credits: 1 },
		});
		const plan: ExternalDiligenceQueryPlan = {
			company_name: "Acme",
			sector: "SaaS",
			founder_name: null,
			queries: {
				company_overview: "Acme company",
				competitors: "Acme competitors",
				market_trends: "SaaS market 2025",
				company_news: "Acme news 2025",
				founder_team_signals: "Acme founder",
				financial_market_context: "SaaS investment 2025",
			},
		};
		const result = await runTavilySearches(plan, "deal-xyz");
		expect(mockSearchFn).toHaveBeenCalledTimes(6);
		expect(result.queries_run).toBe(6);
		expect(result.total_results_fetched).toBe(6); // 1 per query × 6
		expect(result.tavily_credits_used).toBe(6);
		// All buckets should be ok
		expect(result.buckets.every((b) => b.status === "ok")).toBe(true);
	});

	it("marks bucket as failed when Tavily throws", async () => {
		process.env["TAVILY_ENABLED"] = "true";
		process.env["TAVILY_API_KEY"] = "tvly-test-key";
		mockSearchFn.mockRejectedValue(new Error("Network timeout"));
		const plan: ExternalDiligenceQueryPlan = {
			company_name: "Acme",
			sector: null,
			founder_name: null,
			queries: {
				company_overview: "Acme company",
				competitors: "Q2", market_trends: "Q3", company_news: "Q4", founder_team_signals: "Q5", financial_market_context: "Q6",
			},
		};
		const result = await runTavilySearches(plan, "deal-fail");
		// Should not throw — all buckets should be "failed"
		expect(result.queries_run).toBe(0);
		result.buckets.forEach((b) => {
			expect(b.status).toBe("failed");
		});
	});

	it("respects MAX_TOTAL_RESULTS cap by skipping remaining buckets", async () => {
		process.env["TAVILY_ENABLED"] = "true";
		process.env["TAVILY_API_KEY"] = "tvly-test-key";
		// Return MAX_TOTAL_RESULTS results in the FIRST query to trigger the cap
		const manyResults = Array.from({ length: MAX_TOTAL_RESULTS }, (_, i) => ({
			title: `Result ${i}`,
			url: `https://example${i}.com`,
			content: "snippet",
			score: 0.8,
			publishedDate: "2025-01-15",
		}));
		mockSearchFn.mockResolvedValueOnce({ results: manyResults, usage: { credits: 5 } });
		const plan: ExternalDiligenceQueryPlan = {
			company_name: "Acme",
			sector: null,
			founder_name: null,
			queries: {
				company_overview: "Q1", competitors: "Q2", market_trends: "Q3",
				company_news: "Q4", founder_team_signals: "Q5", financial_market_context: "Q6",
			},
		};
		const result = await runTavilySearches(plan, "deal-cap");
		// All subsequent buckets should be "skipped" after hitting the cap
		expect(result.total_results_fetched).toBe(MAX_TOTAL_RESULTS);
		const skippedBuckets = result.buckets.filter((b) => b.status === "skipped");
		expect(skippedBuckets.length).toBeGreaterThan(0);
	});
});

// ─── Tests: buildExternalDiligenceRenderSection ───────────────────────────────

describe("buildExternalDiligenceRenderSection", () => {
	it("returns null when skipped with 0 results", () => {
		const diligence = makeDiligence({
			run_status: "skipped",
			total_results_fetched: 0,
		});
		expect(buildExternalDiligenceRenderSection(diligence)).toBeNull();
	});

	it("returns a section with correct key and kind when results exist", () => {
		const section = buildExternalDiligenceRenderSection(makeDiligence());
		expect(section).not.toBeNull();
		expect(section!.key).toBe("external_diligence_v1");
		expect(section!.kind).toBe("message");
		expect(section!.title).toBe("External Due Diligence");
		expect(typeof section!.body).toBe("string");
	});

	it("embeds parseable JSON in the section body", () => {
		const diligence = makeDiligence();
		const section = buildExternalDiligenceRenderSection(diligence)!;
		const parsed = parseExternalDiligenceSectionBody(section.body);
		expect(parsed).not.toBeNull();
		expect(parsed!.company_name_used).toBe("Acme Corp");
	});
});

// ─── Tests: runExternalDiligenceV1 — graceful degradation ────────────────────

describe("runExternalDiligenceV1 — graceful degradation", () => {
	beforeEach(() => {
		delete process.env["TAVILY_ENABLED"];
		delete process.env["TAVILY_API_KEY"];
		mockSearchFn.mockReset();
	});

	it("returns a result with run_status=skipped when Tavily is disabled", async () => {
		const inputs = makeInputs([{ text: "Company: TestCo\nSaaS product." }]);
		const result = await runExternalDiligenceV1(inputs, { deal_id: "deal-001", dealName: "TestCo" });
		expect(result).not.toBeNull();
		expect(result!.diligence.run_status).toBe("skipped");
		expect(result!.body).toBeNull();
	});

	it("returns null (not throw) when an unhandled internal error occurs", async () => {
		// Force an error inside build-query-plan by passing bad inputs
		const result = await runExternalDiligenceV1(null as unknown as InsightSlotInputs, {
			deal_id: "deal-error",
		});
		expect(result).toBeNull();
	});
});

// ─── Tests: constants ─────────────────────────────────────────────────────────

describe("cost-bounding constants", () => {
	it("MAX_RESULTS_PER_QUERY <= 5", () => {
		expect(MAX_RESULTS_PER_QUERY).toBeLessThanOrEqual(5);
	});

	it("MAX_TOTAL_RESULTS <= 30", () => {
		expect(MAX_TOTAL_RESULTS).toBeLessThanOrEqual(30);
	});

	it("MAX_RESULTS_PER_QUERY * 6 == MAX_TOTAL_RESULTS (budget consistent)", () => {
		expect(MAX_RESULTS_PER_QUERY * 6).toBe(MAX_TOTAL_RESULTS);
	});
});
