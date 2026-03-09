/**
 * governed-executive-summary-cache.integration.test.ts
 *
 * Hard integration tests verifying the full cache lifecycle of
 * GovernedExecutiveSummaryRecord:
 *   - Scenario A: First generation (MISS) — LLM called, record stored
 *   - Scenario B: Unchanged inputs (HIT) — LLM NOT called, cached record returned
 *   - Scenario C: Deterministic input change (MISS) — LLM called again, new fingerprint
 *   - Scenario D: Coverage change → cache miss
 *
 * Phase 5 guardrails:
 *   - Governance version change → cache invalidates
 *   - Raw DPU page_text never reaches the LLM generateFn
 *   - coverage_note is injected in args, not produced by LLM
 *
 * This test MUST fail if someone reintroduces "always call LLM" without cache.
 *
 * No DB access. No real LLM calls. Injectable generateFn provides full coverage.
 */

import { describe, it, expect, vi } from "vitest";
import {
	resolveGovernedExecSummaryWithCache,
	computeGovernedExecSummaryFingerprintV1,
	type GovernedExecutiveSummaryRecord,
	type GovernedExecutiveSummaryArgs,
	type GovernedExecutiveSummaryResult,
} from "../governed-executive-summary-v1";

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const ENGINE_VERSION = "v1";
const GOVERNANCE_VERSION = "governed_executive_summary_v1";

const BASE_INPUTS = {
	canonicalFieldsBody: "company_name: Acme Corp | raise_amount: $2M | stage: Seed",
	insightSlotsBody: "market_size: $1B TAM | team_strength: strong",
	financialStmtBody: "arr: $200K | burn_rate: $40K/month",
	useOfFundsBody: "engineering: 60% | marketing: 40%",
	conflictsBody: null,
	impliedCapitalBody: null,
	financialHealthBody: null,
	financialReconciliationBody: null,
	coverageText: "23/30 pages. 47 evidence items.",
	gateStateText: "gates=3 pass=2 fail=1",
	coverageNote: "23/30 pages parsed (77%). 47 evidence items extracted.",
	engineVersion: ENGINE_VERSION,
	governanceVersion: GOVERNANCE_VERSION,
};

function makeSuccessResult(): GovernedExecutiveSummaryResult {
	return {
		ok: true,
		value: {
			schema_version: "governed_executive_summary_v1",
			headline: "Acme Corp — AI logistics SaaS (Seed)",
			one_liner: "Acme Corp is raising $2M in a seed round targeting SMB customers.",
			summary_paragraphs: ["Acme Corp builds SaaS for logistics.", "The company is raising $2M."],
			strengths: ["Strong team", "$1B market"],
			risks: ["Early ARR"],
			open_questions: ["Path to Series A?"],
			coverage_note: BASE_INPUTS.coverageNote,
			validated: true,
		},
	};
}

// ─── Scenario A — First Generation (MISS) ────────────────────────────────────

describe("Scenario A — first generation (cache miss)", () => {
	it("calls generateFn exactly once, returns source='generated', sets fingerprint and validation_ok", async () => {
		const mockGenerateFn = vi.fn<[GovernedExecutiveSummaryArgs], Promise<GovernedExecutiveSummaryResult>>()
			.mockResolvedValue(makeSuccessResult());

		const record = await resolveGovernedExecSummaryWithCache({
			...BASE_INPUTS,
			previousRecord: null,
			generateFn: mockGenerateFn,
		});

		expect(mockGenerateFn).toHaveBeenCalledTimes(1);

		expect(record).not.toBeNull();
		expect(record!.source).toBe("generated");
		expect(record!.validation_ok).toBe(true);
		expect(record!.fingerprint).toMatch(/^[0-9a-f]{64}$/);
		expect(record!.schema_version).toBe("governed_executive_summary_v1");
		expect(record!.created_at).toBeTruthy();
		expect(record!.summary.headline).toContain("Acme Corp");
	});

	it("fingerprint matches independent computation from same inputs", async () => {
		const mockGenerateFn = vi.fn<[GovernedExecutiveSummaryArgs], Promise<GovernedExecutiveSummaryResult>>()
			.mockResolvedValue(makeSuccessResult());

		const record = await resolveGovernedExecSummaryWithCache({
			...BASE_INPUTS,
			previousRecord: null,
			generateFn: mockGenerateFn,
		});

		const expectedFp = computeGovernedExecSummaryFingerprintV1({
			canonicalText: BASE_INPUTS.canonicalFieldsBody,
			slotsText: BASE_INPUTS.insightSlotsBody,
			coverageText: BASE_INPUTS.coverageText,
			gateStateText: BASE_INPUTS.gateStateText,
			fsText: BASE_INPUTS.financialStmtBody,
			uofText: BASE_INPUTS.useOfFundsBody,
			engineVersion: ENGINE_VERSION,
			governanceVersion: GOVERNANCE_VERSION,
		});

		expect(record!.fingerprint).toBe(expectedFp);
	});
});

// ─── Scenario B — Second Generation (HIT) ────────────────────────────────────

describe("Scenario B — second generation with unchanged inputs (cache hit)", () => {
	it("does NOT call generateFn, returns source='cached' with same fingerprint and created_at", async () => {
		const firstGenerateFn = vi.fn<[GovernedExecutiveSummaryArgs], Promise<GovernedExecutiveSummaryResult>>()
			.mockResolvedValue(makeSuccessResult());

		const firstRecord = await resolveGovernedExecSummaryWithCache({
			...BASE_INPUTS,
			previousRecord: null,
			generateFn: firstGenerateFn,
		});

		expect(firstRecord!.source).toBe("generated");

		const secondGenerateFn = vi.fn<[GovernedExecutiveSummaryArgs], Promise<GovernedExecutiveSummaryResult>>();

		const secondRecord = await resolveGovernedExecSummaryWithCache({
			...BASE_INPUTS,
			previousRecord: firstRecord!,
			generateFn: secondGenerateFn,
		});

		expect(secondGenerateFn).not.toHaveBeenCalled();
		expect(secondRecord!.source).toBe("cached");
		expect(secondRecord!.fingerprint).toBe(firstRecord!.fingerprint);
		expect(secondRecord!.created_at).toBe(firstRecord!.created_at);
		expect(secondRecord!.summary).toEqual(firstRecord!.summary);
	});
});

// ─── Scenario C — Deterministic Input Change (MISS) ──────────────────────────

describe("Scenario C — canonical input change after cache hit (cache miss)", () => {
	it("calls generateFn again, fingerprint changes, source='generated'", async () => {
		const firstGenerateFn = vi.fn<[GovernedExecutiveSummaryArgs], Promise<GovernedExecutiveSummaryResult>>()
			.mockResolvedValue(makeSuccessResult());

		const firstRecord = await resolveGovernedExecSummaryWithCache({
			...BASE_INPUTS,
			previousRecord: null,
			generateFn: firstGenerateFn,
		});

		expect(firstRecord!.source).toBe("generated");
		const oldFingerprint = firstRecord!.fingerprint;

		const changedInputs = {
			...BASE_INPUTS,
			canonicalFieldsBody: "company_name: Acme Corp | raise_amount: $3M | stage: Seed",
		};

		const secondGenerateFn = vi.fn<[GovernedExecutiveSummaryArgs], Promise<GovernedExecutiveSummaryResult>>()
			.mockResolvedValue({
				ok: true,
				value: {
					schema_version: "governed_executive_summary_v1",
					headline: "Acme Corp — AI logistics SaaS (Seed)",
					one_liner: "Acme Corp is raising $3M in a seed round.",
				summary_paragraphs: ["Acme Corp is building logistics SaaS.", "Raising $3M."],
					strengths: ["Strong team"],
					risks: ["Early stage"],
					open_questions: [],
					coverage_note: BASE_INPUTS.coverageNote,
					validated: true,
				},
			});

		const secondRecord = await resolveGovernedExecSummaryWithCache({
			...changedInputs,
			previousRecord: firstRecord!,
			generateFn: secondGenerateFn,
		});

		expect(secondGenerateFn).toHaveBeenCalledTimes(1);
		expect(secondRecord!.source).toBe("generated");
		expect(secondRecord!.fingerprint).not.toBe(oldFingerprint);
		expect(secondRecord!.summary.one_liner).toContain("$3M");
	});
});

// ─── Scenario D — Coverage change → cache miss ───────────────────────────────

describe("Scenario D — coverage change invalidates cache", () => {
	it("same canonical but different coverageText → cache miss → generateFn called", async () => {
		const firstGenerateFn = vi.fn<[GovernedExecutiveSummaryArgs], Promise<GovernedExecutiveSummaryResult>>()
			.mockResolvedValue(makeSuccessResult());

		const firstRecord = await resolveGovernedExecSummaryWithCache({
			...BASE_INPUTS,
			previousRecord: null,
			generateFn: firstGenerateFn,
		});

		expect(firstRecord!.source).toBe("generated");

		const secondGenerateFn = vi.fn<[GovernedExecutiveSummaryArgs], Promise<GovernedExecutiveSummaryResult>>()
			.mockResolvedValue(makeSuccessResult());

		const secondRecord = await resolveGovernedExecSummaryWithCache({
			...BASE_INPUTS,
			coverageText: "30/35 pages. 60 evidence items.", // changed coverage
			coverageNote: "30/35 pages parsed (86%). 60 evidence items extracted.",
			previousRecord: firstRecord!,
			generateFn: secondGenerateFn,
		});

		expect(secondGenerateFn).toHaveBeenCalledTimes(1);
		expect(secondRecord!.source).toBe("generated");
		expect(secondRecord!.fingerprint).not.toBe(firstRecord!.fingerprint);
	});
});

// ─── Fail-guard: cache must be respected on identical inputs ──────────────────

describe("Phase J fail-guard — cache must be respected on identical inputs", () => {
	it("across 10 runs with same inputs, generateFn is called ONLY once", async () => {
		const generateFn = vi.fn<[GovernedExecutiveSummaryArgs], Promise<GovernedExecutiveSummaryResult>>()
			.mockResolvedValue(makeSuccessResult());

		let storedRecord: GovernedExecutiveSummaryRecord | null = null;

		for (let i = 0; i < 10; i++) {
			const record = await resolveGovernedExecSummaryWithCache({
				...BASE_INPUTS,
				previousRecord: storedRecord,
				generateFn,
			});
			storedRecord = record;
		}

		expect(generateFn).toHaveBeenCalledTimes(1);
		expect(storedRecord!.source).toBe("cached");
	});
});

// ─── Governance version change invalidates cache ──────────────────────────────

describe("Governance version change invalidates cache", () => {
	it("same canonical inputs but changed governanceVersion → cache miss → generateFn called", async () => {
		const firstGenerateFn = vi.fn<[GovernedExecutiveSummaryArgs], Promise<GovernedExecutiveSummaryResult>>()
			.mockResolvedValue(makeSuccessResult());

		const firstRecord = await resolveGovernedExecSummaryWithCache({
			...BASE_INPUTS,
			governanceVersion: "governed_executive_summary_v1",
			previousRecord: null,
			generateFn: firstGenerateFn,
		});

		expect(firstRecord!.source).toBe("generated");

		const secondGenerateFn = vi.fn<[GovernedExecutiveSummaryArgs], Promise<GovernedExecutiveSummaryResult>>()
			.mockResolvedValue(makeSuccessResult());

		const secondRecord = await resolveGovernedExecSummaryWithCache({
			...BASE_INPUTS,
			governanceVersion: "governed_executive_summary_v2", // bumped
			previousRecord: firstRecord!,
			generateFn: secondGenerateFn,
		});

		expect(secondGenerateFn).toHaveBeenCalledTimes(1);
		expect(secondRecord!.source).toBe("generated");
		expect(secondRecord!.fingerprint).not.toBe(firstRecord!.fingerprint);
	});

	it("engine version change also invalidates cache", async () => {
		const firstGenerateFn = vi.fn<[GovernedExecutiveSummaryArgs], Promise<GovernedExecutiveSummaryResult>>()
			.mockResolvedValue(makeSuccessResult());

		const firstRecord = await resolveGovernedExecSummaryWithCache({
			...BASE_INPUTS,
			engineVersion: "v1",
			previousRecord: null,
			generateFn: firstGenerateFn,
		});

		const secondGenerateFn = vi.fn<[GovernedExecutiveSummaryArgs], Promise<GovernedExecutiveSummaryResult>>()
			.mockResolvedValue(makeSuccessResult());

		const secondRecord = await resolveGovernedExecSummaryWithCache({
			...BASE_INPUTS,
			engineVersion: "v2",
			previousRecord: firstRecord!,
			generateFn: secondGenerateFn,
		});

		expect(secondGenerateFn).toHaveBeenCalledTimes(1);
		expect(secondRecord!.source).toBe("generated");
	});
});

// ─── Raw DPU page_text never reaches the LLM ─────────────────────────────────

describe("Raw DPU page_text is never passed to generateFn", () => {
	it("generateFn receives only canonical derived fields — no dpuPages, pageText, or raw keys", async () => {
		const receivedArgs: GovernedExecutiveSummaryArgs[] = [];

		const generateFn = vi.fn<[GovernedExecutiveSummaryArgs], Promise<GovernedExecutiveSummaryResult>>()
			.mockImplementation(async (args) => {
				receivedArgs.push(args);
				return makeSuccessResult();
			});

		await resolveGovernedExecSummaryWithCache({
			...BASE_INPUTS,
			previousRecord: null,
			generateFn,
		});

		expect(generateFn).toHaveBeenCalledTimes(1);
		expect(receivedArgs).toHaveLength(1);

		const args = receivedArgs[0]!;
		const argsKeys = Object.keys(args);

		const ALLOWED_KEYS = new Set([
			"canonicalFieldsBody",
			"insightSlotsBody",
			"financialStmtBody",
			"useOfFundsBody",
			"impliedCapitalBody",
			"financialHealthBody",
			"financialReconciliationBody",
			"conflictsBody",
			"productNarrativeBody",
			"contradictionMarkersBody",
			"coverageNote",
			"dealName",
		]);

		const FORBIDDEN_PATTERNS = [
			"dpuPages", "dpu_pages",
			"pageText", "page_text",
			"rawText", "raw_text",
			"ocrText", "ocr_text",
			"dpuPage", "dpu_page",
			"coverageText",   // fingerprint-only; must NOT be in generateFn args
			"gateStateText",  // fingerprint-only; must NOT be in generateFn args
		];

		for (const key of argsKeys) {
			expect(ALLOWED_KEYS.has(key), `generateFn received unexpected key: "${key}"`).toBe(true);
		}

		for (const forbidden of FORBIDDEN_PATTERNS) {
			expect(argsKeys.includes(forbidden), `generateFn must not receive key: "${forbidden}"`).toBe(false);
		}
	});

	it("all GovernedExecutiveSummaryArgs values are string | null | undefined — no raw objects", async () => {
		const generateFn = vi.fn<[GovernedExecutiveSummaryArgs], Promise<GovernedExecutiveSummaryResult>>()
			.mockImplementation(async (args) => {
				for (const [key, value] of Object.entries(args)) {
					if (value !== null && value !== undefined) {
						expect(
							typeof value === "string",
							`GovernedExecutiveSummaryArgs.${key} must be string | null | undefined, got ${typeof value}`
						).toBe(true);
					}
				}
				return makeSuccessResult();
			});

		await resolveGovernedExecSummaryWithCache({
			...BASE_INPUTS,
			previousRecord: null,
			generateFn,
		});

		expect(generateFn).toHaveBeenCalledTimes(1);
	});
});
