/**
 * governed-summary-v1.test.ts
 *
 * Unit tests for the governed LLM summary layer.
 *
 * Test strategy:
 *   - validateNoNewNumbers: thorough unit coverage
 *   - serialize/parse round-trip: deterministic
 *   - generateGovernedSummaryV1: key failure branches (no key, no data)
 *   - generateGovernedSummaryV1 LLM path: mocked provider
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
	validateNoNewNumbers,
	normalizeLlmFinanceShorthand,
	expandShorthandToken,
	generateGovernedSummaryV1,
	serializeGovernedSummaryBody,
	parseGovernedSummaryBody,
	type GovernedSummaryV1,
	computeGovernedSummaryFingerprintV1,
	normalizeForFingerprint,
	resolveGovernedSummaryWithCache,
	type GovernedSummaryRecord,
	type GovernedSummaryArgs,
	type GovernedSummaryResult,
} from "../governed-summary-v1";

// Module-level mock so vi.mock hoisting works correctly.
// vi.hoisted ensures mockCompleteFn is available when vi.mock factory runs.
const mockCompleteFn = vi.hoisted(() => vi.fn());

vi.mock("../../../lib/llm/providers/openai-provider", () => ({
	OpenAIGPT4oProvider: vi.fn().mockImplementation(() => ({
		complete: mockCompleteFn,
	})),
}));

// ─── validateNoNewNumbers ─────────────────────────────────────────────────────

describe("validateNoNewNumbers", () => {
	it("returns ok=true when output contains no numeric tokens", () => {
		const result = validateNoNewNumbers(
			"This company has strong product-market fit and solid leadership.",
			"Some canonical data about the company."
		);
		expect(result.ok).toBe(true);
		expect(result.unknown).toHaveLength(0);
	});

	it("returns ok=true when all dollar amounts in output appear in canonical", () => {
		const canonical = "Revenue detected: $3,337,000 (2026, XLSX)\nRaise: $2M seed";
		const output = "The company reported $3,337,000 in revenue. They are raising $2M.";
		const result = validateNoNewNumbers(output, canonical);
		expect(result.ok).toBe(true);
		expect(result.unknown).toHaveLength(0);
	});

	it("returns ok=false when a dollar amount in output is NOT in canonical", () => {
		const canonical = "Revenue detected: $3,337,000";
		const output = "The company is valued at $8B post-money.";
		const result = validateNoNewNumbers(output, canonical);
		expect(result.ok).toBe(false);
		expect(result.unknown.some((t) => t.includes("8b"))).toBe(true);
	});

	it("returns ok=true when a percentage in output appears in canonical", () => {
		const canonical = "Growth rate: 364.5% YoY";
		const output = "Revenue grew 364.5% year over year.";
		const result = validateNoNewNumbers(output, canonical);
		expect(result.ok).toBe(true);
	});

	it("returns ok=false when a percentage in output is absent from canonical", () => {
		const canonical = "Retention: 80%.";
		const output = "The company achieves 95% gross margin.";
		const result = validateNoNewNumbers(output, canonical);
		expect(result.ok).toBe(false);
		expect(result.unknown.some((t) => t.includes("95%"))).toBe(true);
	});

	it("returns ok=true when a year value in output appears in canonical", () => {
		const canonical = "Financial statement year: 2026";
		const output = "Projected to reach profitability by 2026.";
		const result = validateNoNewNumbers(output, canonical);
		expect(result.ok).toBe(true);
	});

	it("returns ok=false when a year value in output is absent from canonical", () => {
		const canonical = "Founded: 2022";
		const output = "Expects to IPO in 2028.";
		const result = validateNoNewNumbers(output, canonical);
		expect(result.ok).toBe(false);
	});

	it("accumulates all unknown tokens in unknown array", () => {
		const canonical = "Raise: $500K";
		const output = "Revenue is $2M and growth is 150%.";
		const result = validateNoNewNumbers(output, canonical);
		expect(result.ok).toBe(false);
		expect(result.unknown.length).toBeGreaterThanOrEqual(2);
	});

	it("normalizes comma-separated numbers for comparison", () => {
		// "$3,337,000" in output should match "$3,337,000" in canonical after comma removal
		const canonical = "Total Revenue: $3,337,000";
		const output = "Revenue of $3,337,000 recorded.";
		const result = validateNoNewNumbers(output, canonical);
		expect(result.ok).toBe(true);
	});

	it("normalizes suffix letters case-insensitively", () => {
		const canonical = "Raise: $2m seed round";
		const output = "Raising $2M in a seed round.";
		const result = validateNoNewNumbers(output, canonical);
		expect(result.ok).toBe(true);
	});

	it("normalizes trailing decimal zeros: 60.00% matches 60%", () => {
		const canonical = "Retention ratio / 60.00%";
		const output = "Retention rate of 60%.";
		const result = validateNoNewNumbers(output, canonical);
		expect(result.ok).toBe(true);
	});

	it("normalizes trailing decimal zeros: 1.50M matches 1.5M", () => {
		const canonical = "Revenue: $1.50M ARR";
		const output = "ARR of $1.5M.";
		const result = validateNoNewNumbers(output, canonical);
		expect(result.ok).toBe(true);
	});

	it("returns ok=true for an empty output string", () => {
		const result = validateNoNewNumbers("", "Some canonical data.");
		expect(result.ok).toBe(true);
		expect(result.unknown).toHaveLength(0);
	});

	// ── magnitude-expansion fallback (finance shorthand regression) ──────────

	it("accepts $3.5b when canonical has the full-integer form $3,500,000,000", () => {
		const canonical = "Enterprise valuation: $3,500,000,000 post-money.";
		const output = "The company has a valuation of $3.5B.";
		const result = validateNoNewNumbers(output, canonical);
		expect(result.ok).toBe(true);
		expect(result.unknown).toHaveLength(0);
	});

	it("accepts $600m when canonical has the full-integer form $600,000,000", () => {
		const canonical = "TAM estimated at $600,000,000 annually.";
		const output = "The total addressable market is $600M.";
		const result = validateNoNewNumbers(output, canonical);
		expect(result.ok).toBe(true);
		expect(result.unknown).toHaveLength(0);
	});

	it("accepts $900m when canonical has the full-integer form $900,000,000", () => {
		const canonical = "Revenue target: $900,000,000 by 2027.";
		const output = "Management targets $900M in revenue by 2027.";
		const result = validateNoNewNumbers(output, canonical);
		expect(result.ok).toBe(true);
		expect(result.unknown).toHaveLength(0);
	});

	it("accepts $120k when canonical has the full-integer form $120,000", () => {
		const canonical = "Monthly burn: $120,000.";
		const output = "Burn runs at $120K per month.";
		const result = validateNoNewNumbers(output, canonical);
		expect(result.ok).toBe(true);
		expect(result.unknown).toHaveLength(0);
	});

	it("still rejects a shorthand token whose expanded form is not in canonical", () => {
		const canonical = "Raise: $500,000.";
		const output = "The company is targeting $10M.";
		const result = validateNoNewNumbers(output, canonical);
		expect(result.ok).toBe(false);
		expect(result.unknown.some((t) => t.includes("10m"))).toBe(true);
	});

	it("the trio $3.5b/$600m/$900m together all pass against their integer canonical forms", () => {
		const canonical = [
			"Valuation: $3,500,000,000 post-money.",
			"TAM: $600,000,000.",
			"Revenue target: $900,000,000.",
		].join(" ");
		const output = "Valued at $3.5B with a $600M TAM and $900M revenue target.";
		const result = validateNoNewNumbers(output, canonical);
		expect(result.ok).toBe(true);
		expect(result.unknown).toHaveLength(0);
	});

	// ── trailing-punctuation regression (GitHub issue: $432750, false positive) ──

	it("accepts $432750, (trailing comma from sentence context) when canonical has $432750", () => {
		// The LLM writes "raised $432750," mid-sentence — trailing comma must not
		// cause a false-positive unknown token.
		const canonical = "Raise amount: $432750";
		const output = "The company has raised $432750, which represents the full seed round.";
		const result = validateNoNewNumbers(output, canonical);
		expect(result.ok).toBe(true);
		expect(result.unknown).toHaveLength(0);
	});

	it("accepts $432,750. (comma-formatted, trailing period) when canonical has $432,750", () => {
		const canonical = "Total raised: $432,750";
		const output = "The total raise is $432,750.";
		const result = validateNoNewNumbers(output, canonical);
		expect(result.ok).toBe(true);
		expect(result.unknown).toHaveLength(0);
	});

	it("accepts $1,200,000 (with grouping commas) when canonical has the same amount", () => {
		const canonical = "ARR: $1,200,000 as of Q4 2025";
		const output = "Annual recurring revenue stands at $1,200,000.";
		const result = validateNoNewNumbers(output, canonical);
		expect(result.ok).toBe(true);
		expect(result.unknown).toHaveLength(0);
	});

	it("accepts $500k (shorthand) when canonical has $500,000", () => {
		// $500k expands to $500000; canonical has $500,000 which normalizes to $500000.
		const canonical = "Burn rate: $500,000 per month";
		const output = "Monthly burn is $500K.";
		const result = validateNoNewNumbers(output, canonical);
		expect(result.ok).toBe(true);
		expect(result.unknown).toHaveLength(0);
	});

	it("still rejects a trailing-comma token whose base amount is NOT in canonical", () => {
		// $999000, (unknown amount, not in canonical) must still fail
		const canonical = "Raise: $432750";
		const output = "They plan to raise $999000, which exceeds prior rounds.";
		const result = validateNoNewNumbers(output, canonical);
		expect(result.ok).toBe(false);
		expect(result.unknown.some((t) => t.includes("999000"))).toBe(true);
	});
});

// ─── normalizeLlmFinanceShorthand ─────────────────────────────────────────────

describe("normalizeLlmFinanceShorthand", () => {
	it("uppercases lowercase b suffix", () => {
		expect(normalizeLlmFinanceShorthand("valued at $3.5b")).toBe("valued at $3.5B");
	});

	it("uppercases lowercase m suffix", () => {
		expect(normalizeLlmFinanceShorthand("raise $600m")).toBe("raise $600M");
	});

	it("uppercases lowercase k suffix", () => {
		expect(normalizeLlmFinanceShorthand("burn $120k/mo")).toBe("burn $120K/mo");
	});

	it("leaves already-uppercase suffixes unchanged (idempotent)", () => {
		const input = "raise $2M seed, $3.5B valuation";
		expect(normalizeLlmFinanceShorthand(input)).toBe(input);
	});

	it("normalizes multiple tokens in one string", () => {
		const result = normalizeLlmFinanceShorthand("valued at $3.5b, TAM $600m, target $900m");
		expect(result).toBe("valued at $3.5B, TAM $600M, target $900M");
	});

	it("does not alter non-dollar text or percentages", () => {
		const input = "grew 60% in 2025, team of 12";
		expect(normalizeLlmFinanceShorthand(input)).toBe(input);
	});

	it("does not corrupt the number value — only suffix case changes", () => {
		const result = normalizeLlmFinanceShorthand("$3.5b");
		expect(result).toBe("$3.5B");
		// Value numeric part unchanged
		expect(result).toContain("3.5");
	});
});

// ─── expandShorthandToken ─────────────────────────────────────────────────────

describe("expandShorthandToken", () => {
	it("expands $3.5b to $3500000000", () => {
		expect(expandShorthandToken("$3.5b")).toBe("$3500000000");
	});

	it("expands $600m to $600000000", () => {
		expect(expandShorthandToken("$600m")).toBe("$600000000");
	});

	it("expands $900m to $900000000", () => {
		expect(expandShorthandToken("$900m")).toBe("$900000000");
	});

	it("expands $120k to $120000", () => {
		expect(expandShorthandToken("$120k")).toBe("$120000");
	});

	it("expands $2b to $2000000000", () => {
		expect(expandShorthandToken("$2b")).toBe("$2000000000");
	});

	it("returns null for plain dollar amounts with no suffix", () => {
		expect(expandShorthandToken("$3337000")).toBeNull();
	});

	it("returns null for percentage tokens", () => {
		expect(expandShorthandToken("60%")).toBeNull();
	});

	it("returns null for year tokens", () => {
		expect(expandShorthandToken("2026")).toBeNull();
	});
});

// ─── serialize / parse round-trip ────────────────────────────────────────────

const FIXTURE: GovernedSummaryV1 = {
	schema_version: "governed_summary_v1",
	executive_summary: "This company is building a SaaS platform targeting SMBs.",
	strengths: ["Strong traction with $3,337,000 revenue", "Experienced founding team"],
	risks: ["Competitive market", "Relies on single distribution channel"],
	open_questions: ["What is the path to 40% gross margin?", "How will CAC evolve post-seed?"],
	validated: true,
};

describe("serializeGovernedSummaryBody / parseGovernedSummaryBody", () => {
	it("round-trips a GovernedSummaryV1 value", () => {
		const body = serializeGovernedSummaryBody(FIXTURE);
		expect(body).toContain("Executive Summary");
		expect(body).toContain(FIXTURE.executive_summary);
		expect(body).toContain("Strengths");
		expect(body).toContain("Risks");
		expect(body).toContain("Open Questions");
		expect(body).toContain("---governed_summary_v1_json---");

		const parsed = parseGovernedSummaryBody(body);
		expect(parsed).not.toBeNull();
		expect(parsed!.schema_version).toBe("governed_summary_v1");
		expect(parsed!.executive_summary).toBe(FIXTURE.executive_summary);
		expect(parsed!.strengths).toEqual(FIXTURE.strengths);
		expect(parsed!.risks).toEqual(FIXTURE.risks);
		expect(parsed!.open_questions).toEqual(FIXTURE.open_questions);
		expect(parsed!.validated).toBe(true);
	});

	it("returns null when delimiter is missing", () => {
		const result = parseGovernedSummaryBody("No delimiter here.");
		expect(result).toBeNull();
	});

	it("returns null on invalid JSON after delimiter", () => {
		const body = "prefix\n---governed_summary_v1_json---\n{not valid json}";
		const result = parseGovernedSummaryBody(body);
		expect(result).toBeNull();
	});

	it("returns null when schema_version is wrong", () => {
		const body =
			"prefix\n---governed_summary_v1_json---\n" +
			JSON.stringify({ schema_version: "wrong_version", executive_summary: "x", strengths: [], risks: [], open_questions: [], validated: false });
		const result = parseGovernedSummaryBody(body);
		expect(result).toBeNull();
	});
});

// ─── generateGovernedSummaryV1 — failure branches ────────────────────────────

describe("generateGovernedSummaryV1", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("returns ok=false with reason='no_canonical_data' when all inputs are null", async () => {
		vi.stubEnv("OPENAI_API_KEY", "sk-test");
		const result = await generateGovernedSummaryV1({
			canonicalFieldsBody: null,
			insightSlotsBody: null,
			financialStmtBody: null,
			useOfFundsBody: null,
			conflictsBody: null,
			impliedCapitalBody: null,
			financialHealthBody: null,
			financialReconciliationBody: null,
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe("no_canonical_data");
		}
	});

	it("returns ok=false with reason='missing_openai_api_key' when OPENAI_API_KEY is unset", async () => {
		vi.stubEnv("OPENAI_API_KEY", "");
		const result = await generateGovernedSummaryV1({
			canonicalFieldsBody: "raise_amount: $2M | Computable",
			insightSlotsBody: "raise_terms: Computable",
			financialStmtBody: null,
			useOfFundsBody: null,
			conflictsBody: null,
			impliedCapitalBody: null,
			financialHealthBody: null,
			financialReconciliationBody: null,
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe("missing_openai_api_key");
		}
	});
});

// ─── generateGovernedSummaryV1 — mocked LLM path ─────────────────────────────

describe("generateGovernedSummaryV1 (mocked LLM)", () => {
	beforeEach(() => {
		mockCompleteFn.mockReset();
	});
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("returns ok=true with GovernedSummaryV1 on happy path", async () => {
		vi.stubEnv("OPENAI_API_KEY", "sk-test");

		mockCompleteFn.mockResolvedValue({
			id: "mock-id",
			model: "gpt-4o-mini",
			provider: "openai",
			content: JSON.stringify({
				executive_summary:
					"The company is raising $2M in a seed round targeting SMB customers.",
				strengths: ["Clear revenue traction"],
				risks: ["Market competition"],
				open_questions: ["What is the CAC payback period?"],
			}),
			finish_reason: "stop",
			usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 },
			latency_ms: 500,
		});

		const result = await generateGovernedSummaryV1({
			canonicalFieldsBody: "raise_amount: $2M | Computable",
			insightSlotsBody: "raise_terms: Computable | value=Raising $2M seed",
			financialStmtBody: null,
			useOfFundsBody: null,
			conflictsBody: null,
			impliedCapitalBody: null,
			financialHealthBody: null,
			financialReconciliationBody: null,
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.schema_version).toBe("governed_summary_v1");
			expect(result.value.validated).toBe(true);
			expect(typeof result.value.executive_summary).toBe("string");
			expect(Array.isArray(result.value.strengths)).toBe(true);
			expect(Array.isArray(result.value.risks)).toBe(true);
			expect(Array.isArray(result.value.open_questions)).toBe(true);
		}
	});

	it("returns ok=false with reason='numeric_parity_failed' when LLM introduces unknown number", async () => {
		vi.stubEnv("OPENAI_API_KEY", "sk-test");

		mockCompleteFn.mockResolvedValue({
			id: "mock-id",
			model: "gpt-4o-mini",
			provider: "openai",
			content: JSON.stringify({
				executive_summary: "The company is valued at $8B with strong fundamentals.",
				strengths: ["Scale"],
				risks: ["Execution"],
				open_questions: ["How?"],
			}),
			finish_reason: "stop",
			usage: { prompt_tokens: 50, completion_tokens: 50, total_tokens: 100 },
			latency_ms: 300,
		});

		const result = await generateGovernedSummaryV1({
			// Canonical contains $2M, NOT $8B
			canonicalFieldsBody: "raise_amount: $2M | Computable",
			insightSlotsBody: "raise_terms: Computable",
			financialStmtBody: null,
			useOfFundsBody: null,
			conflictsBody: null,
			impliedCapitalBody: null,
			financialHealthBody: null,
			financialReconciliationBody: null,
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe("numeric_parity_failed");
			expect(result.unknownTokens).toBeDefined();
			expect(result.unknownTokens!.some((t) => t.includes("8b"))).toBe(true);
		}
	});

	it("returns ok=false with reason='llm_call_failed' when provider throws", async () => {
		vi.stubEnv("OPENAI_API_KEY", "sk-test");

		mockCompleteFn.mockRejectedValue(new Error("Network timeout"));

		const result = await generateGovernedSummaryV1({
			canonicalFieldsBody: "raise_amount: $2M | Computable",
			insightSlotsBody: null,
			financialStmtBody: null,
			useOfFundsBody: null,
			conflictsBody: null,
			impliedCapitalBody: null,
			financialHealthBody: null,
			financialReconciliationBody: null,
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe("llm_call_failed");
		}
	});

	it("returns ok=false with reason='llm_output_not_json' when model returns non-JSON", async () => {
		vi.stubEnv("OPENAI_API_KEY", "sk-test");

		mockCompleteFn.mockResolvedValue({
			id: "mock-id",
			model: "gpt-4o-mini",
			provider: "openai",
			content: "Sorry, I cannot help with that.",
			finish_reason: "stop",
			usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
			latency_ms: 200,
		});

		const result = await generateGovernedSummaryV1({
			canonicalFieldsBody: "raise_amount: $2M | Computable",
			insightSlotsBody: null,
			financialStmtBody: null,
			useOfFundsBody: null,
			conflictsBody: null,
			impliedCapitalBody: null,
			financialHealthBody: null,
			financialReconciliationBody: null,
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe("llm_output_not_json");
		}
	});
});

// ─── normalizeForFingerprint ──────────────────────────────────────────────────

describe("normalizeForFingerprint", () => {
	it("collapses multiple spaces to a single space", () => {
		expect(normalizeForFingerprint("  hello   world  ")).toBe("hello world");
	});

	it("normalizes CRLF to LF", () => {
		expect(normalizeForFingerprint("a\r\nb")).toBe("a b");
	});

	it("trims leading/trailing whitespace", () => {
		expect(normalizeForFingerprint("\n  hello\n  ")).toBe("hello");
	});

	it("returns empty string for all-whitespace input", () => {
		expect(normalizeForFingerprint("   \n\r\n   ")).toBe("");
	});
});

// ─── computeGovernedSummaryFingerprintV1 ─────────────────────────────────────

describe("computeGovernedSummaryFingerprintV1", () => {
	const BASE_INPUTS = {
		canonicalText: "raise_amount: $2M",
		slotsText: "insight: strong team",
		engineVersion: "v1",
		governanceVersion: "v1",
	};

	it("returns a 64-char hex string", () => {
		const fp = computeGovernedSummaryFingerprintV1(BASE_INPUTS);
		expect(fp).toMatch(/^[0-9a-f]{64}$/);
	});

	it("is stable: same inputs → same fingerprint", () => {
		const a = computeGovernedSummaryFingerprintV1(BASE_INPUTS);
		const b = computeGovernedSummaryFingerprintV1({ ...BASE_INPUTS });
		expect(a).toBe(b);
	});

	it("extra whitespace does NOT change the fingerprint", () => {
		const a = computeGovernedSummaryFingerprintV1(BASE_INPUTS);
		const b = computeGovernedSummaryFingerprintV1({
			...BASE_INPUTS,
			canonicalText: "  raise_amount:  $2M  ",
			slotsText: "insight:   strong team  ",
		});
		expect(a).toBe(b);
	});

	it("a content change DOES change the fingerprint", () => {
		const a = computeGovernedSummaryFingerprintV1(BASE_INPUTS);
		const b = computeGovernedSummaryFingerprintV1({
			...BASE_INPUTS,
			canonicalText: "raise_amount: $3M",
		});
		expect(a).not.toBe(b);
	});

	it("an engine_version change DOES change the fingerprint", () => {
		const a = computeGovernedSummaryFingerprintV1(BASE_INPUTS);
		const b = computeGovernedSummaryFingerprintV1({
			...BASE_INPUTS,
			engineVersion: "v2",
		});
		expect(a).not.toBe(b);
	});
});

// ─── resolveGovernedSummaryWithCache ─────────────────────────────────────────

/** Build a minimal valid GovernedSummaryV1 fixture. */
function makeGovernedSummaryFixture(): GovernedSummaryV1 {
	return {
		schema_version: "governed_summary_v1",
		executive_summary: "Strong team, $2M raise.",
		strengths: ["Experienced founders"],
		risks: ["Early stage"],
		open_questions: ["Unit economics?"],
		validated: true,
	};
}

/** Build a valid GovernedSummaryRecord that will produce a cache HIT for the given args. */
function makePreviousRecord(
	fingerprint: string,
	overrides: Partial<GovernedSummaryRecord> = {}
): GovernedSummaryRecord {
	return {
		schema_version: "governed_summary_v1",
		fingerprint,
		model: "gpt-4o-mini",
		created_at: "2025-01-01T00:00:00.000Z",
		validation_ok: true,
		unknown_tokens: [],
		summary: makeGovernedSummaryFixture(),
		source: "generated",
		...overrides,
	};
}

const BASE_CACHE_ARGS = {
	canonicalFieldsBody: "raise_amount: $2M",
	insightSlotsBody: "insight: strong team",
	financialStmtBody: null,
	useOfFundsBody: null,
	conflictsBody: null,
	impliedCapitalBody: null,
	financialHealthBody: null,
	financialReconciliationBody: null,
	engineVersion: "v1",
	governanceVersion: "v1",
};

describe("resolveGovernedSummaryWithCache", () => {
	it("returns null when both canonicalFieldsBody and insightSlotsBody are null/empty", async () => {
		const mockFn = vi.fn();
		const result = await resolveGovernedSummaryWithCache({
			...BASE_CACHE_ARGS,
			canonicalFieldsBody: null,
			insightSlotsBody: null,
			previousRecord: null,
			generateFn: mockFn,
		});
		expect(result).toBeNull();
		expect(mockFn).not.toHaveBeenCalled();
	});

	it("cache HIT: returns cached record with source='cached' and does NOT call generateFn", async () => {
		const mockFn = vi.fn<[GovernedSummaryArgs], Promise<GovernedSummaryResult>>();

		// Compute what the fingerprint *will be* for the base args
		const expectedFp = computeGovernedSummaryFingerprintV1({
			canonicalText: BASE_CACHE_ARGS.canonicalFieldsBody,
			slotsText: BASE_CACHE_ARGS.insightSlotsBody ?? "",
			engineVersion: BASE_CACHE_ARGS.engineVersion,
			governanceVersion: BASE_CACHE_ARGS.governanceVersion,
		});

		const previousRecord = makePreviousRecord(expectedFp);

		const record = await resolveGovernedSummaryWithCache({
			...BASE_CACHE_ARGS,
			previousRecord,
			generateFn: mockFn,
		});

		expect(record).not.toBeNull();
		expect(record?.source).toBe("cached");
		expect(record?.fingerprint).toBe(expectedFp);
		expect(record?.summary).toEqual(previousRecord.summary);
		expect(mockFn).not.toHaveBeenCalled();
	});

	it("cache MISS: fingerprint mismatch → calls generateFn once and returns source='generated'", async () => {
		const newSummary = makeGovernedSummaryFixture();
		const mockFn = vi.fn<[GovernedSummaryArgs], Promise<GovernedSummaryResult>>().mockResolvedValue({
			ok: true,
			value: newSummary,
		});

		// Previous record has a DIFFERENT fingerprint (stale)
		const previousRecord = makePreviousRecord("aaaaaa1111111111111111111111111111111111111111111111111111111111");

		const record = await resolveGovernedSummaryWithCache({
			...BASE_CACHE_ARGS,
			previousRecord,
			generateFn: mockFn,
		});

		expect(record).not.toBeNull();
		expect(record?.source).toBe("generated");
		expect(record?.validation_ok).toBe(true);
		expect(record?.summary).toEqual(newSummary);
		expect(mockFn).toHaveBeenCalledTimes(1);
	});

	it("cache MISS: no previous record → calls generateFn once", async () => {
		const newSummary = makeGovernedSummaryFixture();
		const mockFn = vi.fn<[GovernedSummaryArgs], Promise<GovernedSummaryResult>>().mockResolvedValue({
			ok: true,
			value: newSummary,
		});

		const record = await resolveGovernedSummaryWithCache({
			...BASE_CACHE_ARGS,
			previousRecord: null,
			generateFn: mockFn,
		});

		expect(record).not.toBeNull();
		expect(record?.source).toBe("generated");
		expect(mockFn).toHaveBeenCalledTimes(1);
	});

	it("cache INVALIDATED: validation_ok=false forces regeneration even if fingerprint matches", async () => {
		const newSummary = makeGovernedSummaryFixture();
		const mockFn = vi.fn<[GovernedSummaryArgs], Promise<GovernedSummaryResult>>().mockResolvedValue({
			ok: true,
			value: newSummary,
		});

		// Same fingerprint but validation_ok=false
		const expectedFp = computeGovernedSummaryFingerprintV1({
			canonicalText: BASE_CACHE_ARGS.canonicalFieldsBody,
			slotsText: BASE_CACHE_ARGS.insightSlotsBody ?? "",
			engineVersion: BASE_CACHE_ARGS.engineVersion,
			governanceVersion: BASE_CACHE_ARGS.governanceVersion,
		});
		const previousRecord = makePreviousRecord(expectedFp, { validation_ok: false });

		const record = await resolveGovernedSummaryWithCache({
			...BASE_CACHE_ARGS,
			previousRecord,
			generateFn: mockFn,
		});

		expect(record).not.toBeNull();
		expect(record?.source).toBe("generated");
		expect(mockFn).toHaveBeenCalledTimes(1);
	});

	it("LLM failure: generateFn returns ok=false → record has validation_ok=false (fail-open, not null)", async () => {
		const mockFn = vi.fn<[GovernedSummaryArgs], Promise<GovernedSummaryResult>>().mockResolvedValue({
			ok: false,
			reason: "llm_output_not_json",
		});

		const record = await resolveGovernedSummaryWithCache({
			...BASE_CACHE_ARGS,
			previousRecord: null,
			generateFn: mockFn,
		});

		// We still get a record back (fail-open — caller decides what to render)
		expect(record).not.toBeNull();
		expect(record?.validation_ok).toBe(false);
		expect(record?.source).toBe("generated");
		expect(record?.schema_version).toBe("governed_summary_v1");
	});

	it("records generated fingerprint regardless of LLM outcome", async () => {
		const mockFn = vi.fn<[GovernedSummaryArgs], Promise<GovernedSummaryResult>>().mockResolvedValue({
			ok: false,
			reason: "llm_key_missing",
		});

		const expectedFp = computeGovernedSummaryFingerprintV1({
			canonicalText: BASE_CACHE_ARGS.canonicalFieldsBody,
			slotsText: BASE_CACHE_ARGS.insightSlotsBody ?? "",
			engineVersion: BASE_CACHE_ARGS.engineVersion,
			governanceVersion: BASE_CACHE_ARGS.governanceVersion,
		});

		const record = await resolveGovernedSummaryWithCache({
			...BASE_CACHE_ARGS,
			previousRecord: null,
			generateFn: mockFn,
		});

		expect(record?.fingerprint).toBe(expectedFp);
	});
});
