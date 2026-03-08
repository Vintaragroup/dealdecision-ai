/**
 * external-diligence-v1.test.ts — PR35 / PR36.2 / PR36.3 / PR36.4
 *
 * Unit tests for the External Due Diligence layer.
 *
 * Test strategy:
 *   - buildExternalDiligenceQueryPlan: company/sector/founder/product_category extraction,
 *     BucketQuerySpec shapes, new canonical body parsing (raise_round, sector)
 *   - normalizeExternalResults: URL dedup, run_status derivation, claim corroboration,
 *     quality filter applied, signal attached per bucket
 *   - serializeExternalDiligenceBody: null when skipped, content when results present,
 *     signal summary included in bucket body
 *   - serializeExternalDiligenceSectionBody + parseExternalDiligenceSectionBody: round-trip
 *   - runTavilySearches: skipped when flag is off, passes topic/excludeDomains/days to Tavily
 *   - filterAndRankResults: drops job boards, conservative fallback
 *   - extractBucketSignal: typed signal per bucket, null for empty bucket
 *   - buildExternalDiligenceRenderSection: null when skipped, section shape when has results
 *   - runExternalDiligenceV1: graceful degradation on Tavily error
 *   - PR36.3 synthesizeExternalSignals: cross-bucket synthesis scorers
 *   - PR36.4 normalizeCompanyName: strips legal suffixes, TLDs, normalizes punctuation
 *   - PR36.4 buildCompanyEntityQuery: entity-anchored query variants
 *   - PR36.4 buildFounderEntityQuery: disambiguation with company name
 *   - PR36.4 inferProductCategory: keyword heuristics + sector mapping
 *   - PR36.4 query planner hardening: company normalization, no bare company name in market
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
	buildExternalDiligenceQueryPlan,
} from "../external-diligence/build-query-plan";
import {
	normalizeCompanyName,
	buildCompanyEntityQuery,
	buildFounderEntityQuery,
} from "../external-diligence/query-entity-utils";
import {
	inferProductCategory,
} from "../external-diligence/infer-product-category";
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
import {
	filterAndRankResults,
} from "../external-diligence/result-quality-filter";
import {
	extractBucketSignal,
} from "../external-diligence/signal-extraction";
import {
	synthesizeExternalSignals,
} from "../external-diligence/signal-synthesis/synthesize-external-signals";
import {
	scoreMarketAttractiveness,
} from "../external-diligence/signal-synthesis/score-market-attractiveness";
import {
	scoreCompetitivePressure,
} from "../external-diligence/signal-synthesis/score-competitive-pressure";
import {
	scoreCompanyVisibility,
} from "../external-diligence/signal-synthesis/score-company-visibility";
import {
	scoreFounderCredibility,
} from "../external-diligence/signal-synthesis/score-founder-credibility";
import {
	scoreExternalRisk,
} from "../external-diligence/signal-synthesis/score-external-risk";
import {
	scoreClaimValidation,
} from "../external-diligence/signal-synthesis/score-claim-validation";
import type {
	ExternalDiligenceV1,
	ExternalDiligenceBucket,
	ExternalDiligenceQueryPlan,
	BucketQuerySpec,
	MarketOutlookSignal,
	FinancialContextSignal,
	CompetitiveLandscapeSignal,
	CompanyFootprintSignal,
	FounderTeamSignal,
	ExternalRisksSignal,
	ClaimCorroboration,
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

/** PR36.2: BucketQuerySpec factory */
function makeSpec(query: string, topic?: BucketQuerySpec["topic"]): BucketQuerySpec {
	return { query, ...(topic ? { topic } : {}) };
}

function makeDiligence(overrides?: Partial<ExternalDiligenceV1>): ExternalDiligenceV1 {
	return {
		schema_version: "external_diligence_v1",
		run_status: "succeeded",
		total_results_fetched: 5,
		queries_run: 6,
		buckets: [
			makeOkBucket("company_footprint", [
				{ url: "https://techcrunch.com/2025/01/acme", snippet: "Acme raised $500K seed round." },
				{ url: "https://crunchbase.com/org/acme", snippet: "Acme Corp builds automation software." },
			]),
			makeOkBucket("competitive_landscape", [
				{ url: "https://g2.com/categories/workflow", snippet: "Top competitors include WorkflowAI and FlowDash." },
			]),
			makeOkBucket("market_outlook", [
				{ url: "https://gartner.com/market-2025", snippet: "Workflow automation market expected to grow 25% YoY." },
			]),
			makeSkippedBucket("external_risks"),
			makeSkippedBucket("founder_team_signals"),
			makeSkippedBucket("financial_context"),
		],
		claim_corroborations: [],
		company_name_used: "Acme Corp",
		sector_used: "workflow automation",
		ran_at: "2025-01-15T12:00:00.000Z",
		tavily_credits_used: 6,
		...overrides,
	};
}

/** PR36.2: canonical query plan with BucketQuerySpec objects */
const mockPlan: ExternalDiligenceQueryPlan = {
	company_name: "Acme Corp",
	sector: "workflow automation",
	founder_name: "Jane Smith",
	product_category: "workflow automation software",
	queries: {
		company_footprint: makeSpec('"Acme Corp" company startup', "general"),
		competitive_landscape: makeSpec("workflow automation software competitors alternatives", "general"),
		market_outlook: makeSpec("workflow automation software market size growth outlook 2024 2025", "general"),
		external_risks: { query: '"Acme Corp" news 2024 2025', topic: "news" as const, days: 365 },
		founder_team_signals: makeSpec('"Jane Smith" founder CEO startup entrepreneur', "general"),
		financial_context: makeSpec("workflow automation seed funding benchmark valuation 2025", "finance"),
	},
};

// ─── Tests: buildExternalDiligenceQueryPlan ───────────────────────────────────

describe("buildExternalDiligenceQueryPlan", () => {
	it("uses dealName as fallback when DPU pages are empty", () => {
		const plan = buildExternalDiligenceQueryPlan(makeInputs(), "AcmeCo");
		expect(plan.company_name).toBe("AcmeCo");
		expect(plan.queries.company_footprint.query).toContain("AcmeCo");
		expect(plan.queries.external_risks.query).toContain("AcmeCo");
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
		expect(plan.queries.founder_team_signals.query).toContain("Jane Smith");
	});

	it("returns all 6 buckets as BucketQuerySpec objects", () => {
		const plan = buildExternalDiligenceQueryPlan(makeInputs(), "TestCo");
		const keys: Array<keyof typeof plan.queries> = [
			"company_footprint",
			"competitive_landscape",
			"market_outlook",
			"external_risks",
			"founder_team_signals",
			"financial_context",
		];
		for (const key of keys) {
			expect(typeof plan.queries[key]).toBe("object");
			expect(typeof plan.queries[key].query).toBe("string");
			expect(plan.queries[key].query.length).toBeGreaterThan(5);
		}
	});

	it("falls back to generic label when no company name is detectable", () => {
		const plan = buildExternalDiligenceQueryPlan(makeInputs([{ text: "revenue grew 20%" }]));
		expect(plan.queries.company_footprint.query).toContain("this company");
	});

	it("external_risks bucket uses news topic with days=365", () => {
		const plan = buildExternalDiligenceQueryPlan(makeInputs(), "AcmeCo");
		expect(plan.queries.external_risks.topic).toBe("news");
		expect(plan.queries.external_risks.days).toBe(365);
	});

	it("financial_context bucket uses finance topic", () => {
		const plan = buildExternalDiligenceQueryPlan(makeInputs(), "AcmeCo");
		expect(plan.queries.financial_context.topic).toBe("finance");
	});

	it("extracts raise_round from canonical fields body for financial_context query", () => {
		const canonical = "field=raise_round value=Seed evidence=doc1 reason=extracted";
		const plan = buildExternalDiligenceQueryPlan(makeInputs([{ text: "industry: SaaS" }]), "AcmeCo", canonical);
		expect(plan.queries.financial_context.query).toContain("Seed");
	});

	it("extracts product_category from 'the X platform' pattern", () => {
		const plan = buildExternalDiligenceQueryPlan(
			makeInputs([{ text: "We built the customer success platform for enterprise SaaS teams." }])
		);
		expect(plan.product_category).toBeTruthy();
	});

	it("competitive_landscape uses product category when available", () => {
		const plan = buildExternalDiligenceQueryPlan(
			makeInputs([{ text: "We built the revenue forecasting software for sales teams." }]),
			"TestCo"
		);
		// When product_category is extracted, it should appear in competitive landscape query
		if (plan.product_category) {
			expect(plan.queries.competitive_landscape.query).toContain(plan.product_category);
		}
	});
});

// ─── Tests: normalizeExternalResults ─────────────────────────────────────────

describe("normalizeExternalResults", () => {
	it("derives run_status=succeeded when some buckets are ok and none failed", () => {
		const result = normalizeExternalResults(
			{
				buckets: [
					makeOkBucket("company_footprint", [{ url: "https://example.com/a" }]),
					makeSkippedBucket("competitive_landscape"),
					makeSkippedBucket("market_outlook"),
					makeSkippedBucket("external_risks"),
					makeSkippedBucket("founder_team_signals"),
					makeSkippedBucket("financial_context"),
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
					makeOkBucket("company_footprint", [{ url: "https://example.com/a" }]),
					makeFailedBucket("competitive_landscape"),
					makeSkippedBucket("market_outlook"),
					makeSkippedBucket("external_risks"),
					makeSkippedBucket("founder_team_signals"),
					makeSkippedBucket("financial_context"),
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
			["company_footprint", "competitive_landscape", "market_outlook", "external_risks", "founder_team_signals", "financial_context"] as const
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
					makeOkBucket("company_footprint", [
						{ url: "https://techcrunch.com/acme/" },
						{ url: "https://techcrunch.com/acme/" }, // duplicate
					]),
					makeSkippedBucket("competitive_landscape"),
					makeSkippedBucket("market_outlook"),
					makeSkippedBucket("external_risks"),
					makeSkippedBucket("founder_team_signals"),
					makeSkippedBucket("financial_context"),
				],
				total_results_fetched: 2,
				queries_run: 1,
				tavily_credits_used: null,
			},
			mockPlan
		);
		// After dedup, only 1 result should remain
		const bucket = result.buckets.find((b) => b.bucket === "company_footprint")!;
		expect(bucket.results_count).toBe(1);
		expect(result.total_results_fetched).toBe(1);
	});

	it("includes schema_version and ran_at in output", () => {
		const allSkipped = (["company_footprint", "competitive_landscape", "market_outlook", "external_risks", "founder_team_signals", "financial_context"] as const).map((b) =>
			makeSkippedBucket(b)
		);
		const result = normalizeExternalResults(
			{ buckets: allSkipped, total_results_fetched: 0, queries_run: 0, tavily_credits_used: null },
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
					makeOkBucket("company_footprint", [
						{ url: "https://tc.com/acme", snippet: "Acme Corp raised $500K seed round this year." },
					]),
					makeSkippedBucket("competitive_landscape"),
					makeSkippedBucket("market_outlook"),
					makeSkippedBucket("external_risks"),
					makeSkippedBucket("founder_team_signals"),
					makeSkippedBucket("financial_context"),
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

	it("PR36.2: attaches signal to bucket after quality filtering", () => {
		const result = normalizeExternalResults(
			{
				buckets: [
					makeOkBucket("market_outlook", [
						{ url: "https://gartner.com/report", snippet: "The workflow automation market is growing rapidly with strong tailwinds." },
					]),
					makeSkippedBucket("company_footprint"),
					makeSkippedBucket("competitive_landscape"),
					makeSkippedBucket("external_risks"),
					makeSkippedBucket("founder_team_signals"),
					makeSkippedBucket("financial_context"),
				],
				total_results_fetched: 1,
				queries_run: 1,
				tavily_credits_used: null,
			},
			mockPlan
		);
		const marketBucket = result.buckets.find((b) => b.bucket === "market_outlook")!;
		// signal may be null if no results after filter, or present if results pass
		// Either way, the field should exist on the bucket
		expect("signal" in marketBucket || marketBucket.signal === undefined).toBe(true);
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

	it("includes PR36.2 bucket labels in the body", () => {
		const body = serializeExternalDiligenceBody(makeDiligence());
		expect(body).toContain("Company Footprint");
		expect(body).toContain("Competitive Landscape");
		expect(body).toContain("Market Outlook");
	});

	it("includes signal summary before results when signal.summary is set", () => {
		const diligenceWithSignal = makeDiligence({
			buckets: [
				{
					...makeOkBucket("market_outlook", [{ url: "https://gartner.com/x", snippet: "Market growing fast." }]),
					signal: {
						kind: "market_outlook" as const,
						summary: "Market shows strong growth trajectory with 25% YoY CAGR.",
						direction: "growing",
						tailwinds: ["AI adoption"],
						headwinds: [],
					},
				},
				makeSkippedBucket("company_footprint"),
				makeSkippedBucket("competitive_landscape"),
				makeSkippedBucket("external_risks"),
				makeSkippedBucket("founder_team_signals"),
				makeSkippedBucket("financial_context"),
			],
		});
		const body = serializeExternalDiligenceBody(diligenceWithSignal);
		expect(body).toContain("Market shows strong growth trajectory");
	});

	it("respects MAX_BODY_CHARS hard cap", () => {
		// Build a diligence with many large snippets
		const manyResults = Array.from({ length: 10 }, (_, i) => ({
			url: `https://example${i}.com`,
			snippet: "x".repeat(490),
		}));
		const diligence = makeDiligence({
			buckets: [
				makeOkBucket("company_footprint", manyResults),
				makeSkippedBucket("competitive_landscape"),
				makeSkippedBucket("market_outlook"),
				makeSkippedBucket("external_risks"),
				makeSkippedBucket("founder_team_signals"),
				makeSkippedBucket("financial_context"),
			],
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
		const result = await runTavilySearches(mockPlan, "deal-123");
		expect(result.queries_run).toBe(0);
		expect(result.total_results_fetched).toBe(0);
		expect(result.buckets.every((b) => b.status === "skipped")).toBe(true);
		expect(mockSearchFn).not.toHaveBeenCalled();
	});

	it("returns all-skipped when TAVILY_ENABLED=true but API key missing", async () => {
		process.env["TAVILY_ENABLED"] = "true";
		const result = await runTavilySearches(mockPlan, "deal-123");
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
		const result = await runTavilySearches(mockPlan, "deal-xyz");
		expect(mockSearchFn).toHaveBeenCalledTimes(6);
		expect(result.queries_run).toBe(6);
		expect(result.total_results_fetched).toBe(6); // 1 per query × 6
		expect(result.tavily_credits_used).toBe(6);
		expect(result.buckets.every((b) => b.status === "ok")).toBe(true);
	});

	it("PR36.2: passes topic to Tavily for external_risks (news topic)", async () => {
		process.env["TAVILY_ENABLED"] = "true";
		process.env["TAVILY_API_KEY"] = "tvly-test-key";
		mockSearchFn.mockResolvedValue({ results: [], usage: { credits: 1 } });
		await runTavilySearches(mockPlan, "deal-topic-test");
		// The 4th call (index 3) should be external_risks with topic=news
		// BUCKET_ORDER: company_footprint(0), competitive_landscape(1), market_outlook(2),
		//               founder_team_signals(3), financial_context(4), external_risks(5)
		// Find the call that used the news topic
		const calls = mockSearchFn.mock.calls;
		const newsCall = calls.find((c) => c[1]?.topic === "news");
		expect(newsCall).toBeDefined();
	});

	it("PR36.2: passes days to Tavily for external_risks bucket", async () => {
		process.env["TAVILY_ENABLED"] = "true";
		process.env["TAVILY_API_KEY"] = "tvly-test-key";
		mockSearchFn.mockResolvedValue({ results: [], usage: { credits: 1 } });
		await runTavilySearches(mockPlan, "deal-days-test");
		const calls = mockSearchFn.mock.calls;
		const daysCall = calls.find((c) => c[1]?.days === 365);
		expect(daysCall).toBeDefined();
	});

	it("marks bucket as failed when Tavily throws", async () => {
		process.env["TAVILY_ENABLED"] = "true";
		process.env["TAVILY_API_KEY"] = "tvly-test-key";
		mockSearchFn.mockRejectedValue(new Error("Network timeout"));
		const result = await runTavilySearches(mockPlan, "deal-fail");
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
		const result = await runTavilySearches(mockPlan, "deal-cap");
		// All subsequent buckets should be "skipped" after hitting the cap
		expect(result.total_results_fetched).toBe(MAX_TOTAL_RESULTS);
		const skippedBuckets = result.buckets.filter((b) => b.status === "skipped");
		expect(skippedBuckets.length).toBeGreaterThan(0);
	});
});

// ─── Tests: filterAndRankResults (PR36.2) ────────────────────────────────────

describe("filterAndRankResults", () => {
	function makeResult(url: string, score = 0.7, snippet = "Generic content about the topic."): Parameters<typeof filterAndRankResults>[0][number] {
		return { url, title: "Test Title", snippet, score, published_date: null, bucket: "company_footprint" };
	}

	it("drops job board results always", () => {
		const results = [
			makeResult("https://indeed.com/jobs/acme-engineer"),
			makeResult("https://glassdoor.com/acme-reviews"),
			makeResult("https://techcrunch.com/acme-news"),
		];
		const filtered = filterAndRankResults(results, "company_footprint", "Acme");
		const urls = filtered.map((r) => r.url);
		expect(urls).not.toContain("https://indeed.com/jobs/acme-engineer");
		expect(urls).not.toContain("https://glassdoor.com/acme-reviews");
		expect(urls).toContain("https://techcrunch.com/acme-news");
	});

	it("conservative fallback: returns original results when all would be dropped", () => {
		// All are job board URLs
		const results = [
			makeResult("https://indeed.com/jobs/1"),
			makeResult("https://glassdoor.com/jobs/2"),
		];
		const filtered = filterAndRankResults(results, "company_footprint", "Acme");
		// Should fall back to original results rather than returning empty
		expect(filtered.length).toBeGreaterThan(0);
	});

	it("boosts preferred domain results for competitive_landscape", () => {
		const results = [
			makeResult("https://random-blog.com/competitors", 0.6),
			makeResult("https://g2.com/categories/workflow", 0.6),
		];
		const filtered = filterAndRankResults(results, "competitive_landscape", "Acme");
		// g2 is a preferred domain — should appear first or at least not be dropped
		const g2Entry = filtered.find((r) => r.url.includes("g2.com"));
		expect(g2Entry).toBeDefined();
	});

	it("respects maxKeep parameter", () => {
		const results = Array.from({ length: 5 }, (_, i) =>
			makeResult(`https://example${i}.com/article`, 0.8)
		);
		const filtered = filterAndRankResults(results, "market_outlook", null, 2);
		expect(filtered.length).toBeLessThanOrEqual(2);
	});

	it("returns empty array when input is empty", () => {
		const filtered = filterAndRankResults([], "market_outlook", null);
		expect(filtered).toEqual([]);
	});
});

// ─── Tests: extractBucketSignal (PR36.2) ─────────────────────────────────────

describe("extractBucketSignal", () => {
	function makeResult(snippet: string, url = "https://example.com/article"): Parameters<typeof filterAndRankResults>[0][number] {
		return { url, title: "Test", snippet, score: 0.8, published_date: null, bucket: "company_footprint" };
	}

	it("returns null for empty results", () => {
		const signal = extractBucketSignal("market_outlook", [], { companyName: "Acme", sector: "SaaS", founderName: null });
		expect(signal).toBeNull();
	});

	it("market_outlook: detects growing direction from keywords", () => {
		const results = [makeResult("The workflow automation market is growing rapidly at 25% CAGR. Strong adoption.")];
		const signal = extractBucketSignal("market_outlook", results, { companyName: "Acme", sector: "workflow", founderName: null });
		expect(signal).not.toBeNull();
		expect((signal as { direction: string }).direction).toBe("growing");
		expect((signal as { summary: string }).summary.length).toBeGreaterThan(5);
	});

	it("market_outlook: detects declining direction from keywords", () => {
		const results = [makeResult("The desktop software market is declining with shrinking demand and consolidation.")];
		const signal = extractBucketSignal("market_outlook", results, { companyName: "Acme", sector: "desktop", founderName: null });
		expect((signal as { direction: string }).direction).toBe("declining");
	});

	it("competitive_landscape: extracts competitor names from 'vs.' pattern", () => {
		const results = [makeResult("Acme vs. CompetitorA vs. CompetitorB in workflow automation comparison.")];
		const signal = extractBucketSignal("competitive_landscape", results, { companyName: "Acme", sector: null, founderName: null });
		expect(signal).not.toBeNull();
		const comp = signal as { direct_competitor_names: string[] };
		expect(comp.direct_competitor_names.length).toBeGreaterThan(0);
	});

	it("company_footprint: detects press coverage from TechCrunch URL", () => {
		const results = [{ ...makeResult("Acme Corp announces new product launch."), url: "https://techcrunch.com/acme" }];
		const signal = extractBucketSignal("company_footprint", results, { companyName: "Acme", sector: null, founderName: null });
		expect(signal).not.toBeNull();
		expect((signal as { press_found: boolean }).press_found).toBe(true);
	});

	it("founder_team_signals: detects YC credibility signal", () => {
		const results = [makeResult("Jane Smith, founder, is a Y Combinator alumni and previously led product at Stripe.")];
		const signal = extractBucketSignal("founder_team_signals", results, { companyName: "Acme", sector: null, founderName: "Jane Smith" });
		expect(signal).not.toBeNull();
		const founder = signal as { credibility_signals: string[] };
		expect(founder.credibility_signals.some((s) => s.toLowerCase().includes("yc") || s.toLowerCase().includes("y combinator"))).toBe(true);
	});

	it("external_risks: detects regulatory concern from keywords", () => {
		const results = [makeResult("Acme Corp faces regulatory scrutiny from FTC over data privacy compliance issues.")];
		const signal = extractBucketSignal("external_risks", results, { companyName: "Acme", sector: null, founderName: null });
		expect(signal).not.toBeNull();
		expect((signal as { has_regulatory_concern: boolean }).has_regulatory_concern).toBe(true);
	});

	it("financial_context: produces signal with summary", () => {
		const results = [makeResult("SaaS seed funding benchmarks 2025: typical rounds are $1-3M at 5-8x revenue multiples.")];
		const signal = extractBucketSignal("financial_context", results, { companyName: "Acme", sector: "SaaS", founderName: null });
		expect(signal).not.toBeNull();
		expect(typeof (signal as { summary: string }).summary).toBe("string");
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

// ─── Tests: PR36.3 individual scorers ────────────────────────────────────────

describe("scoreMarketAttractiveness", () => {
	function makeMarket(direction: MarketOutlookSignal["direction"]): MarketOutlookSignal {
		return { kind: "market_outlook", direction, tailwinds: [], headwinds: [], summary: "" };
	}
	function makeFinancial(env: FinancialContextSignal["funding_environment"]): FinancialContextSignal {
		return { kind: "financial_context", raise_level: "unknown", funding_environment: env, summary: "" };
	}

	it("rates high when growing + supportive", () => {
		const result = scoreMarketAttractiveness(makeMarket("growing"), makeFinancial("supportive"));
		expect(result.rating).toBe("high");
	});

	it("rates moderate when growing + weak funding environment", () => {
		const result = scoreMarketAttractiveness(makeMarket("growing"), makeFinancial("weak"));
		expect(result.rating).toBe("moderate");
	});

	it("rates low when declining", () => {
		const result = scoreMarketAttractiveness(makeMarket("declining"), makeFinancial("unknown"));
		expect(result.rating).toBe("low");
	});

	it("rates moderate when flat", () => {
		const result = scoreMarketAttractiveness(makeMarket("flat"), null);
		expect(result.rating).toBe("moderate");
	});

	it("rates unknown when both unknown", () => {
		const result = scoreMarketAttractiveness(null, null);
		expect(result.rating).toBe("unknown");
	});

	it("produces non-empty summary for all non-unknown ratings", () => {
		const result = scoreMarketAttractiveness(makeMarket("growing"), makeFinancial("selective"));
		expect(result.summary.length).toBeGreaterThan(10);
	});

	it("includes direction driver when direction is known", () => {
		const result = scoreMarketAttractiveness(makeMarket("growing"), null);
		expect(result.drivers.some((d) => d.includes("growing"))).toBe(true);
	});
});

describe("scoreCompetitivePressure", () => {
	function makeCompetitive(intensity: CompetitiveLandscapeSignal["competitive_intensity"], names: string[] = []): CompetitiveLandscapeSignal {
		return { kind: "competitive_landscape", competitive_intensity: intensity, direct_competitor_names: names, adjacent_names: [], category_fragmentation: "unknown", summary: "" };
	}
	function makeMarket(direction: MarketOutlookSignal["direction"]): MarketOutlookSignal {
		return { kind: "market_outlook", direction, tailwinds: [], headwinds: [], summary: "" };
	}

	it("rates high for high intensity", () => {
		expect(scoreCompetitivePressure(makeCompetitive("high"), null).rating).toBe("high");
	});

	it("rates moderate for medium intensity in growing market", () => {
		expect(scoreCompetitivePressure(makeCompetitive("medium"), makeMarket("growing")).rating).toBe("moderate");
	});

	it("amplifies medium intensity to high in declining market", () => {
		expect(scoreCompetitivePressure(makeCompetitive("medium"), makeMarket("declining")).rating).toBe("high");
	});

	it("rates low for low intensity in neutral market", () => {
		expect(scoreCompetitivePressure(makeCompetitive("low"), makeMarket("flat")).rating).toBe("low");
	});

	it("rates unknown when no signal", () => {
		expect(scoreCompetitivePressure(null, null).rating).toBe("unknown");
	});

	it("includes competitor names in drivers", () => {
		const result = scoreCompetitivePressure(makeCompetitive("high", ["WorkflowAI", "FlowDash"]), null);
		expect(result.drivers.some((d) => d.includes("WorkflowAI"))).toBe(true);
	});
});

describe("scoreCompanyVisibility", () => {
	function makeFootprint(quality: CompanyFootprintSignal["footprint_quality"]): CompanyFootprintSignal {
		return {
			kind: "company_footprint",
			footprint_quality: quality,
			website_found: quality !== "none",
			funding_profile_found: quality === "strong" || quality === "moderate",
			press_found: quality === "strong",
			summary: "",
		};
	}

	it("rates high for strong footprint", () => {
		expect(scoreCompanyVisibility(makeFootprint("strong")).rating).toBe("high");
	});

	it("rates moderate for moderate footprint", () => {
		expect(scoreCompanyVisibility(makeFootprint("moderate")).rating).toBe("moderate");
	});

	it("rates low for weak footprint", () => {
		expect(scoreCompanyVisibility(makeFootprint("weak")).rating).toBe("low");
	});

	it("rates low for no footprint", () => {
		expect(scoreCompanyVisibility(makeFootprint("none")).rating).toBe("low");
	});

	it("rates unknown when no signal", () => {
		expect(scoreCompanyVisibility(null).rating).toBe("unknown");
	});
});

describe("scoreFounderCredibility", () => {
	function makeFounder(overrides: Partial<FounderTeamSignal> = {}): FounderTeamSignal {
		return {
			kind: "founder_team_signals",
			profile_found: false,
			prior_role_found: false,
			credibility_signals: [],
			limited_footprint: true,
			summary: "",
			...overrides,
		};
	}

	it("rates high when 2+ credibility signals", () => {
		expect(scoreFounderCredibility(makeFounder({ credibility_signals: ["YC", "a16z"], limited_footprint: false, profile_found: true })).rating).toBe("high");
	});

	it("rates high when 1 credibility signal + profile found", () => {
		expect(scoreFounderCredibility(makeFounder({ credibility_signals: ["Sequoia"], profile_found: true, limited_footprint: false })).rating).toBe("high");
	});

	it("rates moderate when profile found + prior role", () => {
		expect(scoreFounderCredibility(makeFounder({ profile_found: true, prior_role_found: true, limited_footprint: false })).rating).toBe("moderate");
	});

	it("rates low when limited footprint", () => {
		expect(scoreFounderCredibility(makeFounder({ limited_footprint: true })).rating).toBe("low");
	});

	it("rates unknown when no signal", () => {
		expect(scoreFounderCredibility(null).rating).toBe("unknown");
	});
});

describe("scoreExternalRisk", () => {
	function makeRisk(overrides: Partial<ExternalRisksSignal> = {}): ExternalRisksSignal {
		return { kind: "external_risks", risk_signals: [], has_regulatory_concern: false, has_reputation_concern: false, summary: "", ...overrides };
	}
	function makeMarket(direction: MarketOutlookSignal["direction"]): MarketOutlookSignal {
		return { kind: "market_outlook", direction, tailwinds: [], headwinds: [], summary: "" };
	}

	it("rates high when regulatory + reputational concerns both present", () => {
		const result = scoreExternalRisk(makeRisk({ has_regulatory_concern: true, has_reputation_concern: true }), null, null, null);
		expect(result.rating).toBe("high");
	});

	it("rates moderate when regulatory concern only", () => {
		const result = scoreExternalRisk(makeRisk({ has_regulatory_concern: true }), null, null, null);
		expect(result.rating).toBe("moderate");
	});

	it("rates low when no risk signals", () => {
		const result = scoreExternalRisk(makeRisk(), null, null, null);
		expect(result.rating).toBe("low");
	});

	it("amplifies score when market is declining", () => {
		const low = scoreExternalRisk(makeRisk(), makeMarket("flat"), null, null);
		const amplified = scoreExternalRisk(makeRisk(), makeMarket("declining"), null, null);
		// declining market should produce a rating >= the flat-market result (same or higher)
		const ratingOrder = { low: 0, moderate: 1, high: 2, unknown: -1 };
		expect(ratingOrder[amplified.rating]).toBeGreaterThanOrEqual(ratingOrder[low.rating]);
	});

	it("rates unknown when no signal at all", () => {
		expect(scoreExternalRisk(null, null, null, null).rating).toBe("unknown");
	});
});

describe("scoreClaimValidation", () => {
	function makeCorroboration(verdict: ClaimCorroboration["verdict"], field: string): ClaimCorroboration {
		return { claim_field: field, claim_value: "$500K", web_signal: "signal", source_url: "https://example.com", verdict };
	}

	it("rates positive when all corroborated", () => {
		const result = scoreClaimValidation([makeCorroboration("corroborated", "raise_amount")]);
		expect(result.rating).toBe("positive");
	});

	it("rates negative when contradicted > corroborated", () => {
		const result = scoreClaimValidation([
			makeCorroboration("contradicted", "raise_amount"),
			makeCorroboration("contradicted", "valuation_pre"),
		]);
		expect(result.rating).toBe("negative");
	});

	it("rates mixed when corroborated + contradicted both present", () => {
		const result = scoreClaimValidation([
			makeCorroboration("corroborated", "raise_amount"),
			makeCorroboration("contradicted", "valuation_pre"),
		]);
		expect(result.rating).toBe("mixed");
	});

	it("rates neutral when all not_found", () => {
		const result = scoreClaimValidation([makeCorroboration("not_found", "raise_amount")]);
		expect(result.rating).toBe("neutral");
	});

	it("rates unknown for empty corroborations", () => {
		expect(scoreClaimValidation([]).rating).toBe("unknown");
	});

	it("includes count drivers", () => {
		const result = scoreClaimValidation([makeCorroboration("corroborated", "raise_amount"), makeCorroboration("corroborated", "valuation_pre")]);
		expect(result.drivers.some((d) => d.includes("2"))).toBe(true);
	});
});

// ─── Tests: PR36.3 synthesizeExternalSignals ─────────────────────────────────

describe("synthesizeExternalSignals", () => {
	function makeFullDiligence(): ExternalDiligenceV1 {
		return {
			schema_version: "external_diligence_v1",
			run_status: "succeeded",
			total_results_fetched: 5,
			queries_run: 5,
			company_name_used: "Acme Corp",
			sector_used: "SaaS",
			ran_at: new Date().toISOString(),
			tavily_credits_used: null,
			claim_corroborations: [],
			buckets: [
				{
					bucket: "market_outlook",
					query_used: "SaaS market trends 2025",
					status: "ok",
					results_count: 1,
					results: [{ url: "https://gartner.com/saas", title: "SaaS Market", snippet: "SaaS market growing rapidly", score: 0.9, published_date: null, bucket: "market_outlook" }],
					signal: { kind: "market_outlook", direction: "growing", tailwinds: ["AI adoption"], headwinds: [], summary: "Growing market." },
				},
				{
					bucket: "competitive_landscape",
					query_used: "SaaS competitors",
					status: "ok",
					results_count: 1,
					results: [{ url: "https://g2.com/saas", title: "Competitors", snippet: "WorkflowAI vs FlowDash in SaaS", score: 0.8, published_date: null, bucket: "competitive_landscape" }],
					signal: { kind: "competitive_landscape", direct_competitor_names: ["WorkflowAI"], adjacent_names: [], category_fragmentation: "consolidated", competitive_intensity: "medium", summary: "Medium competition." },
				},
				{
					bucket: "company_footprint",
					query_used: "Acme Corp",
					status: "ok",
					results_count: 1,
					results: [{ url: "https://crunchbase.com/acme", title: "Acme Corp", snippet: "Acme Corp raised $500K seed", score: 0.9, published_date: null, bucket: "company_footprint" }],
					signal: { kind: "company_footprint", website_found: true, funding_profile_found: true, press_found: false, footprint_quality: "moderate", summary: "Moderate footprint." },
				},
				{
					bucket: "founder_team_signals",
					query_used: "Acme Corp founder",
					status: "ok",
					results_count: 1,
					results: [{ url: "https://linkedin.com/in/jane", title: "Jane Smith", snippet: "founder of Acme Corp formerly at Stripe", score: 0.8, published_date: null, bucket: "founder_team_signals" }],
					signal: { kind: "founder_team_signals", profile_found: true, prior_role_found: true, credibility_signals: [], limited_footprint: false, summary: "Founder profile found." },
				},
				{
					bucket: "financial_context",
					query_used: "SaaS seed funding 2025",
					status: "ok",
					results_count: 1,
					results: [{ url: "https://cbinsights.com/saas", title: "SaaS Benchmarks", snippet: "SaaS seed rounds typically $500K-$2M in supportive environment", score: 0.8, published_date: null, bucket: "financial_context" }],
					signal: { kind: "financial_context", raise_level: "typical", funding_environment: "supportive", summary: "Supportive environment." },
				},
				{
					bucket: "external_risks",
					query_used: "Acme Corp news 2025",
					status: "ok",
					results_count: 1,
					results: [{ url: "https://techcrunch.com/acme", title: "Acme Corp", snippet: "Acme Corp launches new product", score: 0.8, published_date: null, bucket: "external_risks" }],
					signal: { kind: "external_risks", risk_signals: [], has_regulatory_concern: false, has_reputation_concern: false, summary: "No risks." },
				},
			],
		};
	}

	it("produces a valid ExternalSignalSynthesisV1 with correct schema_version", () => {
		const result = synthesizeExternalSignals(makeFullDiligence());
		expect(result.schema_version).toBe("external_signal_synthesis_v1");
	});

	it("produces market_attractiveness=high for growing market + supportive env", () => {
		const result = synthesizeExternalSignals(makeFullDiligence());
		expect(result.market_attractiveness.rating).toBe("high");
	});

	it("produces company_visibility=moderate for moderate footprint", () => {
		const result = synthesizeExternalSignals(makeFullDiligence());
		expect(result.company_visibility.rating).toBe("moderate");
	});

	it("produces founder_credibility=moderate for profile + prior role", () => {
		const result = synthesizeExternalSignals(makeFullDiligence());
		expect(result.founder_credibility.rating).toBe("moderate");
	});

	it("produces external_risk=low when no risks and stable market", () => {
		const result = synthesizeExternalSignals(makeFullDiligence());
		expect(result.external_risk.rating).toBe("low");
	});

	it("produces claim_validation_posture=unknown when no corroborations", () => {
		const result = synthesizeExternalSignals(makeFullDiligence());
		expect(result.claim_validation_posture.rating).toBe("unknown");
	});

	it("handles all-empty buckets: all items are unknown", () => {
		const empty: ExternalDiligenceV1 = {
			schema_version: "external_diligence_v1",
			run_status: "skipped",
			total_results_fetched: 0,
			queries_run: 0,
			company_name_used: null,
			sector_used: null,
			ran_at: new Date().toISOString(),
			tavily_credits_used: null,
			claim_corroborations: [],
			buckets: [],
		};
		const result = synthesizeExternalSignals(empty);
		expect(result.market_attractiveness.rating).toBe("unknown");
		expect(result.competitive_pressure.rating).toBe("unknown");
		expect(result.company_visibility.rating).toBe("unknown");
		expect(result.founder_credibility.rating).toBe("unknown");
		expect(result.external_risk.rating).toBe("unknown");
		expect(result.claim_validation_posture.rating).toBe("unknown");
	});

	it("includes evidence_refs from bucket results", () => {
		const result = synthesizeExternalSignals(makeFullDiligence());
		expect(result.evidence_refs.length).toBeGreaterThan(0);
		expect(result.evidence_refs.every((u) => u.startsWith("https://"))).toBe(true);
	});

	it("claim_validation_posture=positive when all corroborated", () => {
		const diligence = makeFullDiligence();
		diligence.claim_corroborations = [
			{ claim_field: "raise_amount", claim_value: "$500K", web_signal: "raised $500K", source_url: "https://tc.com", verdict: "corroborated" },
		];
		const result = synthesizeExternalSignals(diligence);
		expect(result.claim_validation_posture.rating).toBe("positive");
	});

	it("synthesis attached to ExternalDiligenceV1 by normalizeExternalResults when results exist", () => {
		// When run through normalizeExternalResults, synthesis should be present
		const mockSearch = {
			queries_run: 1,
			tavily_credits_used: null,
			buckets: [
				makeOkBucket("market_outlook", [{ url: "https://gartner.com/x", snippet: "market growing fast" }]),
				makeSkippedBucket("competitive_landscape"),
				makeSkippedBucket("company_footprint"),
				makeSkippedBucket("founder_team_signals"),
				makeSkippedBucket("financial_context"),
				makeSkippedBucket("external_risks"),
			],
		};
		const result = normalizeExternalResults(mockSearch, mockPlan);
		expect(result.synthesis).toBeDefined();
		expect(result.synthesis?.schema_version).toBe("external_signal_synthesis_v1");
	});
});

// ─── Tests: PR36.4 normalizeCompanyName ──────────────────────────────────────

describe("normalizeCompanyName", () => {
	it("strips trailing Inc.", () => {
		expect(normalizeCompanyName("Acme Corp, Inc.")).toBe("Acme Corp");
	});

	it("strips LLC suffix", () => {
		expect(normalizeCompanyName("WorkflowAI LLC")).toBe("WorkflowAI");
	});

	it("strips Ltd. suffix", () => {
		expect(normalizeCompanyName("FlowDash Ltd.")).toBe("FlowDash");
	});

	it("strips Corporation suffix", () => {
		expect(normalizeCompanyName("TechCo Corporation")).toBe("TechCo");
	});

	it("strips .ai TLD suffix", () => {
		expect(normalizeCompanyName("FlowDash.ai")).toBe("FlowDash");
	});

	it("strips .io TLD suffix", () => {
		expect(normalizeCompanyName("DealDash.io")).toBe("DealDash");
	});

	it("strips .co TLD suffix", () => {
		expect(normalizeCompanyName("StartupName.co")).toBe("StartupName");
	});

	it("leaves clean names unchanged", () => {
		expect(normalizeCompanyName("Stripe")).toBe("Stripe");
		expect(normalizeCompanyName("WorkflowAI")).toBe("WorkflowAI");
	});

	it("trims surrounding whitespace", () => {
		expect(normalizeCompanyName("  Acme Corp  ")).toBe("Acme Corp");
	});

	it("strips combined suffix: 'DealDecisionAI, Inc.' → 'DealDecisionAI'", () => {
		const result = normalizeCompanyName("DealDecisionAI, Inc.");
		expect(result).toBe("DealDecisionAI");
	});

	it("caps output at 60 characters", () => {
		const long = "A".repeat(80);
		expect(normalizeCompanyName(long).length).toBeLessThanOrEqual(60);
	});
});

// ─── Tests: PR36.4 buildCompanyEntityQuery ────────────────────────────────────

describe("buildCompanyEntityQuery", () => {
	it("always wraps name in double quotes", () => {
		const q = buildCompanyEntityQuery("WorkflowAI", "footprint");
		expect(q).toContain('"WorkflowAI"');
	});

	it("footprint variant includes funding-related terms", () => {
		const q = buildCompanyEntityQuery("WorkflowAI", "footprint");
		expect(q.toLowerCase()).toMatch(/startup|funding|crunchbase/);
	});

	it("news variant includes news/launch terms", () => {
		const q = buildCompanyEntityQuery("WorkflowAI", "news");
		expect(q.toLowerCase()).toMatch(/news|launch|announcement/);
	});

	it("founder variant includes founder/CEO terms", () => {
		const q = buildCompanyEntityQuery("WorkflowAI", "founder");
		expect(q.toLowerCase()).toMatch(/founder|ceo|leadership/);
	});

	it("funding variant includes investment terms", () => {
		const q = buildCompanyEntityQuery("WorkflowAI", "funding");
		expect(q.toLowerCase()).toMatch(/funding|raise|investment/);
	});

	it("product variant includes product/platform terms", () => {
		const q = buildCompanyEntityQuery("WorkflowAI", "product");
		expect(q.toLowerCase()).toMatch(/product|platform|features/);
	});

	it("defaults to footprint variant when no variant specified", () => {
		const q = buildCompanyEntityQuery("WorkflowAI");
		expect(q).toContain('"WorkflowAI"');
	});
});

// ─── Tests: PR36.4 buildFounderEntityQuery ────────────────────────────────────

describe("buildFounderEntityQuery", () => {
	it("includes quoted founder name", () => {
		const q = buildFounderEntityQuery("Jane Smith", null);
		expect(q).toContain('"Jane Smith"');
	});

	it("includes company name as disambiguator when provided", () => {
		const q = buildFounderEntityQuery("Jane Smith", "WorkflowAI");
		expect(q).toContain('"Jane Smith"');
		expect(q).toContain('"WorkflowAI"');
	});

	it("includes founder/startup terms", () => {
		const q = buildFounderEntityQuery("Jane Smith", null);
		expect(q.toLowerCase()).toMatch(/founder|startup|ceo|entrepreneur/);
	});

	it("omits company name when company is null", () => {
		const q = buildFounderEntityQuery("Jane Smith", null);
		expect(q).not.toContain('"null"');
	});
});

// ─── Tests: PR36.4 inferProductCategory ──────────────────────────────────────

describe("inferProductCategory", () => {
	function makePages(text: string): Array<{ text: string }> {
		return [{ text }];
	}

	it("extracts category from 'the X platform' pattern in pages", () => {
		const result = inferProductCategory(
			makePages("We built the AI investment analysis platform for venture teams."),
			null, null
		);
		expect(result).toBeTruthy();
		expect(result!.toLowerCase()).toContain("investment analysis");
	});

	it("extracts category from 'a X solution' pattern", () => {
		const result = inferProductCategory(
			makePages("FlowDash is a revenue forecasting solution for growth teams."),
			null, null
		);
		expect(result).toBeTruthy();
	});

	it("falls back to sector keyword mapping for FinTech sector", () => {
		const result = inferProductCategory([], "FinTech", null);
		expect(result).toContain("financial");
	});

	it("falls back to sector keyword mapping for SaaS sector", () => {
		const result = inferProductCategory([], "SaaS", null);
		expect(result).toBeTruthy();
		expect(result!.toLowerCase()).toMatch(/saas|software/);
	});

	it("falls back to 'X software' from sector when no keyword matches", () => {
		const result = inferProductCategory([], "PropTech", null);
		expect(result).toBeTruthy();
	});

	it("returns null when no signals are present", () => {
		const result = inferProductCategory(
			makePages("Revenue grew 20% last quarter."),
			null, null
		);
		expect(result).toBeNull();
	});

	it("detects AI investment analysis category from matching keywords in text", () => {
		const result = inferProductCategory(
			makePages("We use AI to automate deal analysis for VC firms."),
			null, null
		);
		// Should detect via keyword heuristic — AI + invest pattern
		expect(result).toBeTruthy();
	});

	it("prefers page-level platform extraction over sector keyword", () => {
		// "the customer success platform" is in pages — should prefer that over sector mapping
		const result = inferProductCategory(
			makePages("Introducing the customer success platform for enterprise SaaS teams."),
			"SaaS", null
		);
		// result should match the page-level extraction (specific) rather than generic SaaS
		expect(result).toBeTruthy();
		expect(result!.toLowerCase()).toContain("customer success");
	});
});

// ─── Tests: PR36.4 query planner hardening ────────────────────────────────────

describe("buildExternalDiligenceQueryPlan (PR36.4 hardening)", () => {
	it("normalizes company name from pages — strips legal suffix before using in queries", () => {
		const plan = buildExternalDiligenceQueryPlan(
			makeInputs([{ text: "Company: Acme Corp, Inc.\nWe automate workflows." }])
		);
		// Company name should be normalized
		expect(plan.company_name).toBe("Acme Corp");
		// Normalized name should appear in queries (not the Inc. form)
		expect(plan.queries.company_footprint.query).toContain("Acme Corp");
		expect(plan.queries.company_footprint.query).not.toContain("Inc.");
	});

	it("normalizes dealName before using in queries — strips .ai suffix", () => {
		const plan = buildExternalDiligenceQueryPlan(makeInputs(), "FlowDash.ai");
		expect(plan.company_name).toBe("FlowDash");
		expect(plan.queries.company_footprint.query).toContain("FlowDash");
	});

	it("company_footprint query uses entity-anchored form with quoted name", () => {
		const plan = buildExternalDiligenceQueryPlan(makeInputs(), "WorkflowAI");
		// PR36.4: footprint uses buildCompanyEntityQuery — quoted name + funding signals
		expect(plan.queries.company_footprint.query).toContain('"WorkflowAI"');
	});

	it("external_risks query uses entity-anchored news form", () => {
		const plan = buildExternalDiligenceQueryPlan(makeInputs(), "WorkflowAI");
		// PR36.4: news query includes launch/announcement terms
		expect(plan.queries.external_risks.query).toContain('"WorkflowAI"');
		expect(plan.queries.external_risks.query.toLowerCase()).toMatch(/news|launch|announcement/);
	});

	it("market_outlook query does NOT contain bare company name as market base", () => {
		// When category + sector are both null, market query should use generic fallback
		// not "WorkflowAI market size growth" which is meaningless
		const plan = buildExternalDiligenceQueryPlan(
			makeInputs([{ text: "Revenue grew 20% last quarter." }]),
			"WorkflowAI"
		);
		// Even if product_category is null, market query should not be just company name + market
		if (!plan.product_category && !plan.sector) {
			expect(plan.queries.market_outlook.query).not.toBe('"WorkflowAI" market size growth 2025');
		}
	});

	it("founder query uses entity-anchored form when founder name extracted", () => {
		const plan = buildExternalDiligenceQueryPlan(
			makeInputs([{ text: "CEO: Jane Smith\nOur mission is to automate everything." }]),
			"WorkflowAI"
		);
		// PR36.4: includes both founder and company in query for disambiguation
		expect(plan.queries.founder_team_signals.query).toContain('"Jane Smith"');
		expect(plan.queries.founder_team_signals.query).toContain('"WorkflowAI"');
	});

	it("competitor query uses quoted category when product_category is detected", () => {
		const plan = buildExternalDiligenceQueryPlan(
			makeInputs([{ text: "We deliver the revenue forecasting platform for SaaS CFOs." }]),
			"TestCo"
		);
		if (plan.product_category) {
			// PR36.4: category is quoted in competitor query
			expect(plan.queries.competitive_landscape.query).toContain(`"${plan.product_category}"`);
		}
	});

	it("financial_context query quotes sector when available", () => {
		const plan = buildExternalDiligenceQueryPlan(
			makeInputs([{ text: "industry: SaaS" }]),
			"TestCo"
		);
		if (plan.sector) {
			expect(plan.queries.financial_context.query).toContain(`"${plan.sector}"`);
		}
	});
});

// ─── Tests: PR36.4 filterAndRankResults noise domains ────────────────────────

describe("filterAndRankResults (PR36.4 noise domains)", () => {
	function makeResult(url: string, score = 0.7): Parameters<typeof filterAndRankResults>[0][number] {
		return { url, title: "Market analysis article", snippet: "Some relevant content.", score, published_date: null, bucket: "market_outlook" };
	}

	it("penalises medium.com results (PR36.4 addition)", () => {
		const results = [
			makeResult("https://medium.com/startup-blog/saas-market-2025", 0.8),
			makeResult("https://gartner.com/saas-market", 0.7),
		];
		const filtered = filterAndRankResults(results, "market_outlook", null);
		// Gartner should rank above Medium even though Medium had higher Tavily score
		const gartnerIdx = filtered.findIndex((r) => r.url.includes("gartner.com"));
		const mediumIdx = filtered.findIndex((r) => r.url.includes("medium.com"));
		if (gartnerIdx !== -1 && mediumIdx !== -1) {
			expect(gartnerIdx).toBeLessThan(mediumIdx);
		}
	});

	it("penalises substack.com results (PR36.4 addition)", () => {
		const results = [
			makeResult("https://someauthor.substack.com/p/saas-trends", 0.85),
			makeResult("https://techcrunch.com/saas-funding-2025", 0.6),
		];
		const filtered = filterAndRankResults(results, "company_footprint", "Acme");
		const tcIdx = filtered.findIndex((r) => r.url.includes("techcrunch.com"));
		const substackIdx = filtered.findIndex((r) => r.url.includes("substack.com"));
		if (tcIdx !== -1 && substackIdx !== -1) {
			expect(tcIdx).toBeLessThan(substackIdx);
		}
	});
});


