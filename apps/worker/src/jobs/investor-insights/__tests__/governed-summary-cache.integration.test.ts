/**
 * governed-summary-cache.integration.test.ts
 *
 * Hard integration tests verifying the full cache lifecycle of GovernedSummaryRecord:
 *   - Scenario A: First generation (MISS) — LLM called, record stored
 *   - Scenario B: Unchanged inputs (HIT) — LLM NOT called, cached record returned
 *   - Scenario C: Deterministic input change (MISS) — LLM called again, new fingerprint
 *
 * Phase 5 guardrails:
 *   - Governance version change → cache invalidates
 *   - Raw DPU page_text never reaches the LLM generateFn
 *
 * This test MUST fail if someone reintroduces "always call LLM" without cache.
 *
 * No DB access. No real LLM calls. Injectable generateFn provides full coverage.
 */

import { describe, it, expect, vi } from "vitest";
import {
	resolveGovernedSummaryWithCache,
	computeGovernedSummaryFingerprintV1,
	type GovernedSummaryRecord,
	type GovernedSummaryArgs,
	type GovernedSummaryResult,
} from "../governed-summary-v1";

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const ENGINE_VERSION = "v1";
const GOVERNANCE_VERSION = "governed_summary_v1";

const BASE_INPUTS = {
	canonicalFieldsBody: "company_name: Acme Corp | raise_amount: $2M | stage: Seed",
	insightSlotsBody: "market_size: $1B TAM | team_strength: strong",
	financialStmtBody: "arr: $200K | burn_rate: $40K/month",
	useOfFundsBody: "engineering: 60% | marketing: 40%",
	conflictsBody: null,
	impliedCapitalBody: null,
	financialHealthBody: null,
	financialReconciliationBody: null,
	engineVersion: ENGINE_VERSION,
	governanceVersion: GOVERNANCE_VERSION,
};

function makeSuccessResult(): GovernedSummaryResult {
	return {
		ok: true,
		value: {
			schema_version: "governed_summary_v1",
			executive_summary: "Acme Corp is raising $2M at Seed stage.",
			strengths: ["Strong team", "$1B market"],
			risks: ["Early ARR"],
			open_questions: ["Path to Series A?"],
			validated: true,
		},
	};
}

// ─── Scenario A — First Generation (MISS) ────────────────────────────────────

describe("Scenario A — first generation (cache miss)", () => {
	it("calls generateFn exactly once, returns source='generated', sets fingerprint and validation_ok", async () => {
		const mockGenerateFn = vi.fn<[GovernedSummaryArgs], Promise<GovernedSummaryResult>>()
			.mockResolvedValue(makeSuccessResult());

		const record = await resolveGovernedSummaryWithCache({
			...BASE_INPUTS,
			previousRecord: null,
			generateFn: mockGenerateFn,
		});

		// LLM was called exactly once
		expect(mockGenerateFn).toHaveBeenCalledTimes(1);

		// Record is present and structured correctly
		expect(record).not.toBeNull();
		expect(record!.source).toBe("generated");
		expect(record!.validation_ok).toBe(true);
		expect(record!.fingerprint).toMatch(/^[0-9a-f]{64}$/);
		expect(record!.schema_version).toBe("governed_summary_v1");
		expect(record!.created_at).toBeTruthy();
		expect(record!.summary.executive_summary).toContain("$2M");
	});

	it("fingerprint matches independent computation from same inputs", async () => {
		const mockGenerateFn = vi.fn<[GovernedSummaryArgs], Promise<GovernedSummaryResult>>()
			.mockResolvedValue(makeSuccessResult());

		const record = await resolveGovernedSummaryWithCache({
			...BASE_INPUTS,
			previousRecord: null,
			generateFn: mockGenerateFn,
		});

		const expectedFp = computeGovernedSummaryFingerprintV1({
			canonicalText: BASE_INPUTS.canonicalFieldsBody,
			slotsText: BASE_INPUTS.insightSlotsBody ?? "",
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
		// First run: generate to get a stored record
		const firstGenerateFn = vi.fn<[GovernedSummaryArgs], Promise<GovernedSummaryResult>>()
			.mockResolvedValue(makeSuccessResult());

		const firstRecord = await resolveGovernedSummaryWithCache({
			...BASE_INPUTS,
			previousRecord: null,
			generateFn: firstGenerateFn,
		});

		expect(firstRecord).not.toBeNull();
		expect(firstRecord!.source).toBe("generated");

		// Second run: same inputs, with stored record as previousRecord
		const secondGenerateFn = vi.fn<[GovernedSummaryArgs], Promise<GovernedSummaryResult>>();
		// (not even providing a return value — should never be called)

		const secondRecord = await resolveGovernedSummaryWithCache({
			...BASE_INPUTS,
			previousRecord: firstRecord!,
			generateFn: secondGenerateFn,
		});

		// LLM must NOT have been called on the second run
		expect(secondGenerateFn).not.toHaveBeenCalled();

		// Cached record is returned
		expect(secondRecord).not.toBeNull();
		expect(secondRecord!.source).toBe("cached");

		// Fingerprint unchanged
		expect(secondRecord!.fingerprint).toBe(firstRecord!.fingerprint);

		// created_at unchanged (we didn't regenerate)
		expect(secondRecord!.created_at).toBe(firstRecord!.created_at);

		// Summary content unchanged
		expect(secondRecord!.summary).toEqual(firstRecord!.summary);
	});
});

// ─── Scenario C — Deterministic Input Change (MISS) ──────────────────────────

describe("Scenario C — canonical input change after cache hit (cache miss)", () => {
	it("calls generateFn again, fingerprint changes, source='generated'", async () => {
		// Establish a stored record with original inputs
		const firstGenerateFn = vi.fn<[GovernedSummaryArgs], Promise<GovernedSummaryResult>>()
			.mockResolvedValue(makeSuccessResult());

		const firstRecord = await resolveGovernedSummaryWithCache({
			...BASE_INPUTS,
			previousRecord: null,
			generateFn: firstGenerateFn,
		});

		expect(firstRecord!.source).toBe("generated");
		const oldFingerprint = firstRecord!.fingerprint;
		const oldCreatedAt = firstRecord!.created_at;

		// Simulate a deterministic change: revenue figure updated in canonical fields
		const changedInputs = {
			...BASE_INPUTS,
			canonicalFieldsBody: "company_name: Acme Corp | raise_amount: $3M | stage: Seed", // $3M instead of $2M
		};

		const secondGenerateFn = vi.fn<[GovernedSummaryArgs], Promise<GovernedSummaryResult>>()
			.mockResolvedValue({
				ok: true,
				value: {
					schema_version: "governed_summary_v1",
					executive_summary: "Acme Corp is raising $3M at Seed stage.",
					strengths: ["Strong team"],
					risks: ["Early stage"],
					open_questions: [],
					validated: true,
				},
			});

		const thirdRecord = await resolveGovernedSummaryWithCache({
			...changedInputs,
			previousRecord: firstRecord!, // stale record
			generateFn: secondGenerateFn,
		});

		// LLM WAS called (cache miss)
		expect(secondGenerateFn).toHaveBeenCalledTimes(1);

		// New record reflects the change
		expect(thirdRecord!.source).toBe("generated");
		expect(thirdRecord!.fingerprint).not.toBe(oldFingerprint);
		// created_at is intentionally not asserted here: both records are created in the same
		// test run and may share the same millisecond. source + fingerprint change are conclusive.
		void oldCreatedAt; // suppress unused-variable warning
		expect(thirdRecord!.summary.executive_summary).toContain("$3M");
	});
});

// ─── Phase J fail-guard: reintroducing "always call LLM" breaks this ─────────

describe("Phase J fail-guard — cache must be respected on identical inputs", () => {
	it("across 10 runs with same inputs, generateFn is called ONLY once", async () => {
		const generateFn = vi.fn<[GovernedSummaryArgs], Promise<GovernedSummaryResult>>()
			.mockResolvedValue(makeSuccessResult());

		let storedRecord: GovernedSummaryRecord | null = null;

		for (let i = 0; i < 10; i++) {
			const record = await resolveGovernedSummaryWithCache({
				...BASE_INPUTS,
				previousRecord: storedRecord,
				generateFn,
			});
			storedRecord = record;
		}

		// LLM was called exactly ONCE despite 10 invocations with identical inputs
		expect(generateFn).toHaveBeenCalledTimes(1);
		expect(storedRecord!.source).toBe("cached");
	});
});

// ─── Phase 5.1 — Governance version change invalidates cache ─────────────────

describe("Phase 5.1 — governance version change invalidates cache", () => {
	it("same canonical inputs but changed governanceVersion → cache miss → generateFn called", async () => {
		const firstGenerateFn = vi.fn<[GovernedSummaryArgs], Promise<GovernedSummaryResult>>()
			.mockResolvedValue(makeSuccessResult());

		const firstRecord = await resolveGovernedSummaryWithCache({
			...BASE_INPUTS,
			governanceVersion: "governed_summary_v1",
			previousRecord: null,
			generateFn: firstGenerateFn,
		});

		expect(firstRecord!.source).toBe("generated");

		// Bump governance version
		const secondGenerateFn = vi.fn<[GovernedSummaryArgs], Promise<GovernedSummaryResult>>()
			.mockResolvedValue(makeSuccessResult());

		const secondRecord = await resolveGovernedSummaryWithCache({
			...BASE_INPUTS,
			governanceVersion: "governed_summary_v2", // bumped
			previousRecord: firstRecord!,
			generateFn: secondGenerateFn,
		});

		// Cache must have been invalidated
		expect(secondGenerateFn).toHaveBeenCalledTimes(1);
		expect(secondRecord!.source).toBe("generated");
		expect(secondRecord!.fingerprint).not.toBe(firstRecord!.fingerprint);
	});

	it("engine version change also invalidates cache", async () => {
		const firstGenerateFn = vi.fn<[GovernedSummaryArgs], Promise<GovernedSummaryResult>>()
			.mockResolvedValue(makeSuccessResult());

		const firstRecord = await resolveGovernedSummaryWithCache({
			...BASE_INPUTS,
			engineVersion: "v1",
			previousRecord: null,
			generateFn: firstGenerateFn,
		});

		const secondGenerateFn = vi.fn<[GovernedSummaryArgs], Promise<GovernedSummaryResult>>()
			.mockResolvedValue(makeSuccessResult());

		const secondRecord = await resolveGovernedSummaryWithCache({
			...BASE_INPUTS,
			engineVersion: "v2", // bumped
			previousRecord: firstRecord!,
			generateFn: secondGenerateFn,
		});

		expect(secondGenerateFn).toHaveBeenCalledTimes(1);
		expect(secondRecord!.source).toBe("generated");
	});

	it("a stored record with validation_ok=false is always regenerated regardless of matching fingerprint", async () => {
		// Manufacture a record with the matching fingerprint but validation_ok=false
		const matchingFp = computeGovernedSummaryFingerprintV1({
			canonicalText: BASE_INPUTS.canonicalFieldsBody,
			slotsText: BASE_INPUTS.insightSlotsBody ?? "",
			fsText: BASE_INPUTS.financialStmtBody,
			uofText: BASE_INPUTS.useOfFundsBody,
			engineVersion: ENGINE_VERSION,
			governanceVersion: GOVERNANCE_VERSION,
		});

		const invalidRecord: GovernedSummaryRecord = {
			schema_version: "governed_summary_v1",
			fingerprint: matchingFp,  // fingerprint matches!
			model: "gpt-4o-mini",
			created_at: "2025-01-01T00:00:00.000Z",
			validation_ok: false,       // but validation failed
			unknown_tokens: ["$99M"],
			summary: {
				schema_version: "governed_summary_v1",
				executive_summary: "",
				strengths: [],
				risks: [],
				open_questions: [],
				validated: false,
			},
			source: "generated",
		};

		const generateFn = vi.fn<[GovernedSummaryArgs], Promise<GovernedSummaryResult>>()
			.mockResolvedValue(makeSuccessResult());

		const record = await resolveGovernedSummaryWithCache({
			...BASE_INPUTS,
			previousRecord: invalidRecord,
			generateFn,
		});

		// Must regenerate despite fingerprint match
		expect(generateFn).toHaveBeenCalledTimes(1);
		expect(record!.source).toBe("generated");
		expect(record!.validation_ok).toBe(true);
	});
});

// ─── Phase 5.2 — Raw DPU page_text never reaches the LLM ────────────────────

describe("Phase 5.2 — raw DPU page_text is never passed to generateFn", () => {
	it("generateFn receives only canonical derived fields — no dpuPages, pageText, or raw keys", async () => {
		const receivedArgs: GovernedSummaryArgs[] = [];

		const generateFn = vi.fn<[GovernedSummaryArgs], Promise<GovernedSummaryResult>>()
			.mockImplementation(async (args) => {
				receivedArgs.push(args);
				return makeSuccessResult();
			});

		await resolveGovernedSummaryWithCache({
			...BASE_INPUTS,
			previousRecord: null,
			generateFn,
		});

		expect(generateFn).toHaveBeenCalledTimes(1);
		expect(receivedArgs).toHaveLength(1);

		const args = receivedArgs[0]!;
		const argsKeys = Object.keys(args);

		// Allowed keys in GovernedSummaryArgs
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
			"dealName",
		]);

		// Forbidden raw DPU keys
		const FORBIDDEN_PATTERNS = [
			"dpuPages", "dpu_pages",
			"pageText", "page_text",
			"rawText", "raw_text",
			"ocrText", "ocr_text",
			"dpuPage", "dpu_page",
		];

		for (const key of argsKeys) {
			expect(ALLOWED_KEYS.has(key), `generateFn received unexpected key: "${key}"`).toBe(true);
		}

		for (const forbidden of FORBIDDEN_PATTERNS) {
			expect(argsKeys.includes(forbidden), `generateFn must not receive raw DPU key: "${forbidden}"`).toBe(false);
		}
	});

	it("null/undefined fields in GovernedSummaryArgs are allowed — no raw objects", async () => {
		const generateFn = vi.fn<[GovernedSummaryArgs], Promise<GovernedSummaryResult>>()
			.mockImplementation(async (args) => {
				// Verify all values are either string | null | undefined — no arrays/objects
				for (const [key, value] of Object.entries(args)) {
					if (value !== null && value !== undefined) {
						expect(
							typeof value === "string",
							`GovernedSummaryArgs.${key} must be string | null | undefined, got ${typeof value}`
						).toBe(true);
					}
				}
				return makeSuccessResult();
			});

		await resolveGovernedSummaryWithCache({
			...BASE_INPUTS,
			previousRecord: null,
			generateFn,
		});

		expect(generateFn).toHaveBeenCalledTimes(1);
	});
});

// ─── Phase 3 — Observability log events ──────────────────────────────────────

describe("Phase 3 — observability log events", () => {
	it("logs GOVERNED_SUMMARY_V1_CACHE with outcome=miss and reason=cache_miss_no_previous on first run", async () => {
		const logCalls: string[] = [];
		const originalLog = console.log;
		console.log = (msg: string) => { logCalls.push(msg); };

		try {
			const generateFn = vi.fn<[GovernedSummaryArgs], Promise<GovernedSummaryResult>>()
				.mockResolvedValue(makeSuccessResult());

			await resolveGovernedSummaryWithCache({
				...BASE_INPUTS,
				previousRecord: null,
				generateFn,
			});
		} finally {
			console.log = originalLog;
		}

		const cacheLog = logCalls
			.map((l) => { try { return JSON.parse(l); } catch { return null; } })
			.find((o) => o?.event === "GOVERNED_SUMMARY_V1_CACHE");

		expect(cacheLog).not.toBeNull();
		expect(cacheLog.outcome).toBe("miss");
		expect(cacheLog.reason).toBe("cache_miss_no_previous");
		expect(cacheLog.previous_record_exists).toBe(false);
	});

	it("logs outcome=hit on cache hit", async () => {
		const generateFn = vi.fn<[GovernedSummaryArgs], Promise<GovernedSummaryResult>>()
			.mockResolvedValue(makeSuccessResult());

		const firstRecord = await resolveGovernedSummaryWithCache({
			...BASE_INPUTS,
			previousRecord: null,
			generateFn,
		});

		const logCalls: string[] = [];
		const originalLog = console.log;
		console.log = (msg: string) => { logCalls.push(msg); };

		try {
			const noOpGenerateFn = vi.fn<[GovernedSummaryArgs], Promise<GovernedSummaryResult>>();
			await resolveGovernedSummaryWithCache({
				...BASE_INPUTS,
				previousRecord: firstRecord!,
				generateFn: noOpGenerateFn,
			});
		} finally {
			console.log = originalLog;
		}

		const cacheLog = logCalls
			.map((l) => { try { return JSON.parse(l); } catch { return null; } })
			.find((o) => o?.event === "GOVERNED_SUMMARY_V1_CACHE");

		expect(cacheLog).not.toBeNull();
		expect(cacheLog.outcome).toBe("hit");
		expect(cacheLog.reason).toBe("cache_hit");
		expect(cacheLog.previous_record_exists).toBe(true);
	});

	it("logs reason=cache_miss_fingerprint_mismatch when fingerprint changed", async () => {
		const staleRecord: GovernedSummaryRecord = {
			schema_version: "governed_summary_v1",
			fingerprint: "a".repeat(64), // deliberately wrong
			model: "gpt-4o-mini",
			created_at: "2025-01-01T00:00:00.000Z",
			validation_ok: true,
			unknown_tokens: [],
			summary: {
				schema_version: "governed_summary_v1",
				executive_summary: "Old summary.",
				strengths: [],
				risks: [],
				open_questions: [],
				validated: true,
			},
			source: "generated",
		};

		const logCalls: string[] = [];
		const originalLog = console.log;
		console.log = (msg: string) => { logCalls.push(msg); };

		try {
			await resolveGovernedSummaryWithCache({
				...BASE_INPUTS,
				previousRecord: staleRecord,
				generateFn: vi.fn<[GovernedSummaryArgs], Promise<GovernedSummaryResult>>()
					.mockResolvedValue(makeSuccessResult()),
			});
		} finally {
			console.log = originalLog;
		}

		const cacheLog = logCalls
			.map((l) => { try { return JSON.parse(l); } catch { return null; } })
			.find((o) => o?.event === "GOVERNED_SUMMARY_V1_CACHE");

		expect(cacheLog).not.toBeNull();
		expect(cacheLog.outcome).toBe("miss");
		expect(cacheLog.reason).toBe("cache_miss_fingerprint_mismatch");
	});
});
