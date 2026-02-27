/**
 * governed-summary-corpus-v1.test.ts
 *
 * Regression tests asserting that financial_health_metrics_v1,
 * financial_reconciliation_v1, and implied_capital_allocation_v1 are
 * correctly wired into the governed-summary LLM corpus and fingerprint.
 *
 * These tests use a stub generateFn to capture the exact GovernedSummaryArgs
 * that the corpus builder would pass to the LLM, without making any real
 * network calls.
 */

import { describe, it, expect } from "vitest";
import {
	resolveGovernedSummaryWithCache,
	computeGovernedSummaryFingerprintV1,
	type GovernedSummaryArgs,
	type GovernedSummaryResult,
	type GovernedSummaryRecord,
} from "../governed-summary-v1";

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Capture the args passed to generateFn without calling the LLM. */
function makeCapturingGenerateFn(): {
	capturedArgs: GovernedSummaryArgs | null;
	generateFn: (args: GovernedSummaryArgs) => Promise<GovernedSummaryResult>;
} {
	let capturedArgs: GovernedSummaryArgs | null = null;
	const generateFn = async (args: GovernedSummaryArgs): Promise<GovernedSummaryResult> => {
		capturedArgs = args;
		return {
			ok: true,
			value: {
				schema_version: "governed_summary_v1",
				executive_summary: "Test summary.",
				strengths: ["strength1"],
				risks: ["risk1"],
				open_questions: ["question1"],
				validated: true,
			},
		};
	};
	return { capturedArgs: null, generateFn: Object.assign(generateFn, { _ref: () => capturedArgs }) };
}

/** Minimal valid resolve args — only canonical + slots required. */
function baseArgs(overrides: Partial<Parameters<typeof resolveGovernedSummaryWithCache>[0]> = {}) {
	return {
		canonicalFieldsBody: "raise_amount: $2,000,000\nstage: Seed",
		insightSlotsBody: "business_model: SaaS",
		financialStmtBody: null,
		useOfFundsBody: null,
		impliedCapitalBody: null,
		financialHealthBody: null,
		financialReconciliationBody: null,
		conflictsBody: null,
		previousRecord: null as GovernedSummaryRecord | null,
		engineVersion: "v1",
		governanceVersion: "v1.1",
		...overrides,
	};
}

// ─── corpus inclusion tests ───────────────────────────────────────────────────

describe("governed-summary corpus: new financial sections are passed to generate fn", () => {
	it("passes financialHealthBody to generateFn when provided", async () => {
		const { generateFn, _ref } = (() => {
			let captured: GovernedSummaryArgs | null = null;
			const fn = async (args: GovernedSummaryArgs): Promise<GovernedSummaryResult> => {
				captured = args;
				return { ok: true, value: { schema_version: "governed_summary_v1", executive_summary: "s", strengths: [], risks: [], open_questions: [], validated: true } };
			};
			return { generateFn: fn, _ref: () => captured };
		})();

		await resolveGovernedSummaryWithCache({
			...baseArgs({ financialHealthBody: "revenue_latest: $3,337,000\nrevenue_yoy_growth_pct: 364.5%" }),
			generateFn,
		});

		const captured = _ref();
		expect(captured).not.toBeNull();
		expect(captured!.financialHealthBody).toBe("revenue_latest: $3,337,000\nrevenue_yoy_growth_pct: 364.5%");
	});

	it("passes financialReconciliationBody to generateFn when provided", async () => {
		let captured: GovernedSummaryArgs | null = null;
		const generateFn = async (args: GovernedSummaryArgs): Promise<GovernedSummaryResult> => {
			captured = args;
			return { ok: true, value: { schema_version: "governed_summary_v1", executive_summary: "s", strengths: [], risks: [], open_questions: [], validated: true } };
		};

		await resolveGovernedSummaryWithCache({
			...baseArgs({ financialReconciliationBody: "confidence_score: 0.85\n✓ arr_mrr_coherence: PASS — coherent" }),
			generateFn,
		});

		expect(captured).not.toBeNull();
		expect(captured!.financialReconciliationBody).toBe("confidence_score: 0.85\n✓ arr_mrr_coherence: PASS — coherent");
	});

	it("passes impliedCapitalBody to generateFn when provided", async () => {
		let captured: GovernedSummaryArgs | null = null;
		const generateFn = async (args: GovernedSummaryArgs): Promise<GovernedSummaryResult> => {
			captured = args;
			return { ok: true, value: { schema_version: "governed_summary_v1", executive_summary: "s", strengths: [], risks: [], open_questions: [], validated: true } };
		};

		await resolveGovernedSummaryWithCache({
			...baseArgs({ impliedCapitalBody: "total_raise: $2,000,000\nengineering: 40%" }),
			generateFn,
		});

		expect(captured).not.toBeNull();
		expect(captured!.impliedCapitalBody).toBe("total_raise: $2,000,000\nengineering: 40%");
	});

	it("passes BOTH useOfFundsBody AND impliedCapitalBody when both are present", async () => {
		let captured: GovernedSummaryArgs | null = null;
		const generateFn = async (args: GovernedSummaryArgs): Promise<GovernedSummaryResult> => {
			captured = args;
			return { ok: true, value: { schema_version: "governed_summary_v1", executive_summary: "s", strengths: [], risks: [], open_questions: [], validated: true } };
		};

		await resolveGovernedSummaryWithCache({
			...baseArgs({
				useOfFundsBody: "product: 50%\nsales: 30%\nops: 20%",
				impliedCapitalBody: "total_raise: $2,000,000\nengineering: 40%",
			}),
			generateFn,
		});

		expect(captured).not.toBeNull();
		// Both must be non-null — no more mutual exclusion bug
		expect(captured!.useOfFundsBody).not.toBeNull();
		expect(captured!.impliedCapitalBody).not.toBeNull();
	});

	it("null fields are preserved as null on generateFn args", async () => {
		let captured: GovernedSummaryArgs | null = null;
		const generateFn = async (args: GovernedSummaryArgs): Promise<GovernedSummaryResult> => {
			captured = args;
			return { ok: true, value: { schema_version: "governed_summary_v1", executive_summary: "s", strengths: [], risks: [], open_questions: [], validated: true } };
		};

		await resolveGovernedSummaryWithCache({ ...baseArgs(), generateFn });

		expect(captured).not.toBeNull();
		expect(captured!.financialHealthBody).toBeNull();
		expect(captured!.financialReconciliationBody).toBeNull();
		expect(captured!.impliedCapitalBody).toBeNull();
	});
});

// ─── fingerprint sensitivity tests ───────────────────────────────────────────

describe("governed-summary fingerprint: sensitive to new corpus fields", () => {
	const sharedBase = {
		canonicalText: "raise_amount: $2,000,000",
		slotsText: "business_model: SaaS",
		engineVersion: "v1",
		governanceVersion: "v1.1",
	};

	it("fingerprint changes when financialHealthText is added", () => {
		const fp1 = computeGovernedSummaryFingerprintV1({ ...sharedBase });
		const fp2 = computeGovernedSummaryFingerprintV1({
			...sharedBase,
			financialHealthText: "revenue_latest: $3,337,000",
		});
		expect(fp1).not.toBe(fp2);
	});

	it("fingerprint changes when financialReconciliationText is added", () => {
		const fp1 = computeGovernedSummaryFingerprintV1({ ...sharedBase });
		const fp2 = computeGovernedSummaryFingerprintV1({
			...sharedBase,
			financialReconciliationText: "confidence_score: 0.85",
		});
		expect(fp1).not.toBe(fp2);
	});

	it("fingerprint changes when impliedCapitalText is added", () => {
		const fp1 = computeGovernedSummaryFingerprintV1({ ...sharedBase });
		const fp2 = computeGovernedSummaryFingerprintV1({
			...sharedBase,
			impliedCapitalText: "total_raise: $2,000,000\nengineering: 40%",
		});
		expect(fp1).not.toBe(fp2);
	});

	it("fingerprint is stable when same new fields are provided twice", () => {
		const inputs = {
			...sharedBase,
			financialHealthText: "revenue_latest: $3,337,000",
			financialReconciliationText: "confidence_score: 0.85",
			impliedCapitalText: "total_raise: $2,000,000",
		};
		expect(computeGovernedSummaryFingerprintV1(inputs)).toBe(
			computeGovernedSummaryFingerprintV1(inputs)
		);
	});

	it("fingerprint treats null and undefined new fields as equivalent to absent", () => {
		const fp1 = computeGovernedSummaryFingerprintV1({ ...sharedBase, financialHealthText: null });
		const fp2 = computeGovernedSummaryFingerprintV1({ ...sharedBase });
		expect(fp1).toBe(fp2);
	});
});

// ─── cache invalidation tests ─────────────────────────────────────────────────

describe("governed-summary cache: new fields trigger cache miss", () => {
	it("returns cached result when all new fields are unchanged", async () => {
		const generateFn = async (_args: GovernedSummaryArgs): Promise<GovernedSummaryResult> => ({
			ok: true,
			value: { schema_version: "governed_summary_v1", executive_summary: "gen", strengths: [], risks: [], open_questions: [], validated: true },
		});

		// First call — generates
		const first = await resolveGovernedSummaryWithCache({
			...baseArgs({ financialHealthBody: "revenue_latest: $3,337,000" }),
			generateFn,
		});
		expect(first).not.toBeNull();
		expect(first!.source).toBe("generated");

		// Second call with same inputs — should hit cache
		const second = await resolveGovernedSummaryWithCache({
			...baseArgs({ financialHealthBody: "revenue_latest: $3,337,000" }),
			previousRecord: first!,
			generateFn,
		});
		expect(second).not.toBeNull();
		expect(second!.source).toBe("cached");
	});

	it("triggers cache miss when financialHealthBody changes", async () => {
		const generateFn = async (_args: GovernedSummaryArgs): Promise<GovernedSummaryResult> => ({
			ok: true,
			value: { schema_version: "governed_summary_v1", executive_summary: "gen", strengths: [], risks: [], open_questions: [], validated: true },
		});

		const first = await resolveGovernedSummaryWithCache({
			...baseArgs({ financialHealthBody: "revenue_latest: $3,337,000" }),
			generateFn,
		});

		// Changed health — must miss cache
		const second = await resolveGovernedSummaryWithCache({
			...baseArgs({ financialHealthBody: "revenue_latest: $5,000,000" }),
			previousRecord: first!,
			generateFn,
		});
		expect(second).not.toBeNull();
		expect(second!.source).toBe("generated");
	});

	it("triggers cache miss when financialReconciliationBody changes", async () => {
		const generateFn = async (_args: GovernedSummaryArgs): Promise<GovernedSummaryResult> => ({
			ok: true,
			value: { schema_version: "governed_summary_v1", executive_summary: "gen", strengths: [], risks: [], open_questions: [], validated: true },
		});

		const first = await resolveGovernedSummaryWithCache({
			...baseArgs({ financialReconciliationBody: "confidence_score: 0.85" }),
			generateFn,
		});

		const second = await resolveGovernedSummaryWithCache({
			...baseArgs({ financialReconciliationBody: "confidence_score: 0.45" }),
			previousRecord: first!,
			generateFn,
		});
		expect(second!.source).toBe("generated");
	});
});
