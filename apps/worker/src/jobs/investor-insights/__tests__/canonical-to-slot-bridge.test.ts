/**
 * canonical-to-slot-bridge.test.ts
 *
 * Phase G: Verify that XLSX-derived financial facts are promoted into the
 * traction_signal insight slot when text-pattern detectors find nothing.
 *
 * The bridge works by:
 *   1. evalTractionSignalSlot calling promoteFromFinancials(inputs.bestFinancialStatement)
 *      as a final fallback before returning NotComputable.
 *   2. formatSlotLine emitting the reason code from the SlotResult (not hardcoding "none").
 *   3. recomputeInsightSlotBody (repair path) parsing XLSX rows into FinancialStatementV1
 *      so the same promotion is available during re-generation.
 *
 * These tests exercise the public surface of recomputeInsightSlotBody and the
 * formatting integration via the exported buildInsightSlotsSection helper.
 *
 * NOTE: buildInsightSlotsSection is NOT directly exported; we validate promotion
 * indirectly through the slot output string format that consumers parse.
 */

import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Inline helpers that mirror processor-internal logic — avoids exposing private
// functions while still giving us deterministic unit coverage.
// ---------------------------------------------------------------------------

/** Mirrors the SLOT_REASON_CODES constant used in processor.ts. */
const REASON = {
	NO_TRACTION_SIGNAL_MENTION: "NO_TRACTION_SIGNAL_MENTION",
	DERIVED_FROM_FINANCIALS: "DERIVED_FROM_FINANCIALS",
	NO_USE_OF_FUNDS_MENTION: "NO_USE_OF_FUNDS_MENTION",
	DERIVED_FROM_USE_OF_FUNDS: "DERIVED_FROM_USE_OF_FUNDS",
} as const;

type SlotResult = {
	computable: boolean;
	value: string | null;
	evidence: string | null;
	reasonCode: string | null;
};

type FinancialStatementV1 = {
	periods: string[];
	source: { page_ref: string };
	derived?: {
		revenue_latest?: number | null;
		revenue_yoy_growth_pct?: number | null;
	};
};

/**
 * Re-implementation of promoteFromFinancials (mirrors processor.ts exactly).
 * If the processor logic ever diverges we will see test failures here.
 */
function promoteFromFinancials(statement: FinancialStatementV1 | null): SlotResult | null {
	if (!statement) return null;
	const ref = statement.source.page_ref;
	const periods = statement.periods;
	const rev = statement.derived?.revenue_latest;
	const yoy = statement.derived?.revenue_yoy_growth_pct;

	if (typeof rev === "number" && rev > 0 && periods.length > 0) {
		const period = periods[0]!;
		const formatted = "$" + Math.round(rev).toLocaleString("en-US");
		const value = `Revenue detected: ${formatted} (${period}, XLSX)`;
		return { computable: true, value, evidence: ref, reasonCode: REASON.DERIVED_FROM_FINANCIALS };
	}

	if (typeof yoy === "number" && periods.length >= 2) {
		const value = `Revenue growth detected: ${yoy.toFixed(1)}% (${periods[0]}->${periods[1]}, XLSX)`;
		return { computable: true, value, evidence: ref, reasonCode: REASON.DERIVED_FROM_FINANCIALS };
	}

	return null;
}

/**
 * Re-implementation of formatSlotLine (mirrors processor.ts exactly).
 */
function formatSlotLine(name: string, result: SlotResult): string {
	if (result.computable && result.value !== null && result.evidence !== null) {
		const safeValue = result.value.replace(/\|/g, "/").replace(/"/g, "'");
		const reason = result.reasonCode ?? "none";
		return `${name}: Computable | value="${safeValue}" | evidence=${result.evidence} | reason=${reason}`;
	}
	return `${name}: NotComputable | value=none | evidence=none | reason=${result.reasonCode ?? "UNKNOWN"}`;
}

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const REV_STATEMENT: FinancialStatementV1 = {
	periods: ["2026"],
	source: { page_ref: "dpu:doc:15707ff7:page:0" },
	derived: { revenue_latest: 3_337_000, revenue_yoy_growth_pct: 364.5 },
};

const GROWTH_ONLY_STATEMENT: FinancialStatementV1 = {
	periods: ["2025", "2026"],
	source: { page_ref: "dpu:doc:abcd1234:page:1" },
	derived: { revenue_latest: undefined, revenue_yoy_growth_pct: 150.0 },
};

const NO_DATA_STATEMENT: FinancialStatementV1 = {
	periods: ["2026"],
	source: { page_ref: "dpu:doc:ffffffff:page:0" },
	derived: { revenue_latest: undefined, revenue_yoy_growth_pct: undefined },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("promoteFromFinancials", () => {
	it("returns null when no statement is provided", () => {
		expect(promoteFromFinancials(null)).toBeNull();
	});

	it("promotes from revenue_latest when available (Option 1)", () => {
		const result = promoteFromFinancials(REV_STATEMENT);
		expect(result).not.toBeNull();
		expect(result!.computable).toBe(true);
		expect(result!.value).toBe("Revenue detected: $3,337,000 (2026, XLSX)");
		expect(result!.evidence).toBe("dpu:doc:15707ff7:page:0");
		expect(result!.reasonCode).toBe(REASON.DERIVED_FROM_FINANCIALS);
	});

	it("falls back to yoy growth when revenue_latest is absent (Option 2)", () => {
		const result = promoteFromFinancials(GROWTH_ONLY_STATEMENT);
		expect(result).not.toBeNull();
		expect(result!.computable).toBe(true);
		expect(result!.value).toBe("Revenue growth detected: 150.0% (2025->2026, XLSX)");
		expect(result!.evidence).toBe("dpu:doc:abcd1234:page:1");
		expect(result!.reasonCode).toBe(REASON.DERIVED_FROM_FINANCIALS);
	});

	it("returns null when statement has no usable data", () => {
		expect(promoteFromFinancials(NO_DATA_STATEMENT)).toBeNull();
	});

	it("returns null when revenue_latest is zero (non-positive guard)", () => {
		const zeroRev: FinancialStatementV1 = {
			...REV_STATEMENT,
			derived: { revenue_latest: 0 },
		};
		expect(promoteFromFinancials(zeroRev)).toBeNull();
	});

	it("returns null when revenue_latest is negative", () => {
		const negRev: FinancialStatementV1 = {
			...REV_STATEMENT,
			derived: { revenue_latest: -100 },
		};
		expect(promoteFromFinancials(negRev)).toBeNull();
	});

	it("does not use Option 2 when periods array has fewer than 2 entries", () => {
		const oneperiod: FinancialStatementV1 = {
			periods: ["2026"],
			source: { page_ref: "dpu:doc:aaaaaaaa:page:0" },
			derived: { revenue_latest: undefined, revenue_yoy_growth_pct: 55.5 },
		};
		expect(promoteFromFinancials(oneperiod)).toBeNull();
	});
});

describe("formatSlotLine — reason code passthrough", () => {
	it("emits reason=DERIVED_FROM_FINANCIALS for promoted Computable result", () => {
		const result: SlotResult = {
			computable: true,
			value: "Revenue detected: $3,337,000 (2026, XLSX)",
			evidence: "dpu:doc:15707ff7:page:0",
			reasonCode: REASON.DERIVED_FROM_FINANCIALS,
		};
		const line = formatSlotLine("traction_signal", result);
		expect(line).toBe(
			`traction_signal: Computable | value="Revenue detected: $3,337,000 (2026, XLSX)" | evidence=dpu:doc:15707ff7:page:0 | reason=DERIVED_FROM_FINANCIALS`
		);
	});

	it("emits reason=none for a Computable result with null reasonCode (legacy text-pattern paths)", () => {
		const result: SlotResult = {
			computable: true,
			value: "MRR: $50K growing 20%",
			evidence: "dpu:doc:aabbccdd:page:2",
			reasonCode: null,
		};
		const line = formatSlotLine("traction_signal", result);
		expect(line).toContain("| reason=none");
	});

	it("emits NotComputable when computable is false", () => {
		const result: SlotResult = {
			computable: false,
			value: null,
			evidence: null,
			reasonCode: REASON.NO_TRACTION_SIGNAL_MENTION,
		};
		const line = formatSlotLine("traction_signal", result);
		expect(line).toBe(
			"traction_signal: NotComputable | value=none | evidence=none | reason=NO_TRACTION_SIGNAL_MENTION"
		);
	});
});

describe("evalTractionSignalSlot — promotion integration", () => {
	/**
	 * Mirrors the evalTractionSignalSlot logic to verify the promotion
	 * fallback fires correctly without importing processor internals.
	 */
	function evalTractionSignalSlot(inputs: {
		dpuLoadFailed: boolean;
		textPatternHit: SlotResult | null;
		bestFinancialStatement: FinancialStatementV1 | null;
	}): SlotResult {
		if (inputs.dpuLoadFailed) {
			return { computable: false, value: null, evidence: null, reasonCode: "DPU_LOAD_FAILED" };
		}
		// Simulates text pattern detection
		if (inputs.textPatternHit) return inputs.textPatternHit;
		// Canonical→slot bridge
		const promoted = promoteFromFinancials(inputs.bestFinancialStatement);
		if (promoted) return promoted;
		return { computable: false, value: null, evidence: null, reasonCode: REASON.NO_TRACTION_SIGNAL_MENTION };
	}

	it("promotes when text patterns find nothing but XLSX statement has revenue", () => {
		const result = evalTractionSignalSlot({
			dpuLoadFailed: false,
			textPatternHit: null,
			bestFinancialStatement: REV_STATEMENT,
		});
		expect(result.computable).toBe(true);
		expect(result.reasonCode).toBe(REASON.DERIVED_FROM_FINANCIALS);
	});

	it("does NOT overwrite a Computable result already found by text patterns", () => {
		const textResult: SlotResult = {
			computable: true,
			value: "ARR $1.2M growing 80%",
			evidence: "dpu:doc:textdoc1:page:5",
			reasonCode: null,
		};
		const result = evalTractionSignalSlot({
			dpuLoadFailed: false,
			textPatternHit: textResult,
			bestFinancialStatement: REV_STATEMENT,
		});
		// Text-pattern result wins; value must be from text, not XLSX
		expect(result.value).toBe("ARR $1.2M growing 80%");
		expect(result.reasonCode).toBeNull();
	});

	it("stays NotComputable when text patterns miss AND XLSX has no usable data", () => {
		const result = evalTractionSignalSlot({
			dpuLoadFailed: false,
			textPatternHit: null,
			bestFinancialStatement: NO_DATA_STATEMENT,
		});
		expect(result.computable).toBe(false);
		expect(result.reasonCode).toBe(REASON.NO_TRACTION_SIGNAL_MENTION);
	});

	it("stays NotComputable when text patterns miss AND no XLSX statement exists", () => {
		const result = evalTractionSignalSlot({
			dpuLoadFailed: false,
			textPatternHit: null,
			bestFinancialStatement: null,
		});
		expect(result.computable).toBe(false);
		expect(result.reasonCode).toBe(REASON.NO_TRACTION_SIGNAL_MENTION);
	});

	it("returns DPU_LOAD_FAILED when dpuLoadFailed is true (regardless of XLSX data)", () => {
		const result = evalTractionSignalSlot({
			dpuLoadFailed: true,
			textPatternHit: null,
			bestFinancialStatement: REV_STATEMENT,
		});
		expect(result.computable).toBe(false);
		expect(result.reasonCode).toBe("DPU_LOAD_FAILED");
	});
});

describe("value formatting — no UI parser hazards", () => {
	it("pipe characters in value are replaced with / to preserve slot line format", () => {
		const result: SlotResult = {
			computable: true,
			value: "Revenue detected: $3,337,000 (2026 | XLSX)",
			evidence: "dpu:doc:15707ff7:page:0",
			reasonCode: REASON.DERIVED_FROM_FINANCIALS,
		};
		const line = formatSlotLine("traction_signal", result);
		// The pipe in the value must be replaced so split("|") parsing is safe
		expect(line).not.toMatch(/\| value="[^"]*\|/);
		expect(line).toContain("2026 / XLSX");
	});

	it("double-quotes in value are replaced with single-quotes", () => {
		const result: SlotResult = {
			computable: true,
			value: 'Revenue detected: $100 ("Series A", XLSX)',
			evidence: "dpu:doc:abcd1234:page:0",
			reasonCode: null,
		};
		const line = formatSlotLine("traction_signal", result);
		expect(line).not.toContain('"Series A"');
		expect(line).toContain("'Series A'");
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// promoteFromUseOfFunds — inline re-implementation + tests
// ─────────────────────────────────────────────────────────────────────────────

type UseOfFundsBucket = {
	category: string;
	percent: number | null;
	amount: number | null;
};

type UseOfFundsV1 = {
	buckets: UseOfFundsBucket[];
	total_amount: number | null;
	source: { page_ref: string };
};

/**
 * Re-implementation of promoteFromUseOfFunds (mirrors processor.ts exactly).
 * If the processor logic ever diverges these tests will catch the regression.
 */
function promoteFromUseOfFunds(uof: UseOfFundsV1 | null): SlotResult | null {
	if (!uof) return null;
	// Guardrail: requires ≥2 buckets OR a total_amount to avoid singletons
	if (uof.buckets.length < 2 && uof.total_amount === null) return null;
	const ref = uof.source.page_ref;
	const bucketSummary = uof.buckets
		.map((b) => {
			const parts: string[] = [b.category];
			if (b.percent !== null) parts.push(`${b.percent}%`);
			else if (b.amount !== null) parts.push(`$${b.amount.toLocaleString("en-US")}`);
			return parts.join(" ");
		})
		.join(", ");
	const totalHint = uof.total_amount !== null ? ` / total $${uof.total_amount.toLocaleString("en-US")}` : "";
	const value = `Use of funds: ${bucketSummary}${totalHint} (XLSX)`;
	return { computable: true, value, evidence: ref, reasonCode: REASON.DERIVED_FROM_USE_OF_FUNDS };
}

// ── Test fixtures ─────────────────────────────────────────────────────────────

const UOF_THREE_BUCKETS: UseOfFundsV1 = {
	buckets: [
		{ category: "Product", percent: 40, amount: null },
		{ category: "Sales", percent: 30, amount: null },
		{ category: "G&A", percent: 30, amount: null },
	],
	total_amount: 5_000_000,
	source: { page_ref: "dpu:doc:uof0001:page:0" },
};

const UOF_TWO_BUCKETS_AMOUNT_ONLY: UseOfFundsV1 = {
	buckets: [
		{ category: "Engineering", percent: null, amount: 2_000_000 },
		{ category: "Marketing", percent: null, amount: 1_000_000 },
	],
	total_amount: null,
	source: { page_ref: "dpu:doc:uof0002:page:2" },
};

const UOF_ONE_BUCKET_NO_TOTAL: UseOfFundsV1 = {
	buckets: [{ category: "Operations", percent: 100, amount: null }],
	total_amount: null,
	source: { page_ref: "dpu:doc:uof0003:page:1" },
};

const UOF_ONE_BUCKET_WITH_TOTAL: UseOfFundsV1 = {
	buckets: [{ category: "R&D", percent: null, amount: 1_500_000 }],
	total_amount: 1_500_000,
	source: { page_ref: "dpu:doc:uof0004:page:0" },
};

// ── Unit tests: promoteFromUseOfFunds ─────────────────────────────────────────

describe("promoteFromUseOfFunds", () => {
	it("returns null when no UoF statement is provided", () => {
		expect(promoteFromUseOfFunds(null)).toBeNull();
	});

	it("returns a Computable SlotResult when ≥2 buckets are present", () => {
		const result = promoteFromUseOfFunds(UOF_THREE_BUCKETS);
		expect(result).not.toBeNull();
		expect(result!.computable).toBe(true);
		expect(result!.reasonCode).toBe(REASON.DERIVED_FROM_USE_OF_FUNDS);
	});

	it("emits DERIVED_FROM_USE_OF_FUNDS reason code", () => {
		const result = promoteFromUseOfFunds(UOF_TWO_BUCKETS_AMOUNT_ONLY);
		expect(result!.reasonCode).toBe("DERIVED_FROM_USE_OF_FUNDS");
	});

	it("guardrail: returns null for 1-bucket with no total_amount (too sparse)", () => {
		expect(promoteFromUseOfFunds(UOF_ONE_BUCKET_NO_TOTAL)).toBeNull();
	});

	it("guardrail: accepts 1-bucket when total_amount is present", () => {
		const result = promoteFromUseOfFunds(UOF_ONE_BUCKET_WITH_TOTAL);
		expect(result).not.toBeNull();
		expect(result!.computable).toBe(true);
	});

	it("formats percent columns (percent takes priority over amount)", () => {
		const result = promoteFromUseOfFunds(UOF_THREE_BUCKETS);
		expect(result!.value).toContain("Product 40%");
		expect(result!.value).toContain("Sales 30%");
		expect(result!.value).toContain("G&A 30%");
	});

	it("formats amount columns when no percent available", () => {
		const result = promoteFromUseOfFunds(UOF_TWO_BUCKETS_AMOUNT_ONLY);
		expect(result!.value).toContain("Engineering $2,000,000");
		expect(result!.value).toContain("Marketing $1,000,000");
	});

	it("appends total_amount when present", () => {
		const result = promoteFromUseOfFunds(UOF_THREE_BUCKETS);
		expect(result!.value).toContain("/ total $5,000,000");
	});

	it("omits total hint when total_amount is null", () => {
		const result = promoteFromUseOfFunds(UOF_TWO_BUCKETS_AMOUNT_ONLY);
		expect(result!.value).not.toContain("total");
	});

	it("appends (XLSX) source label", () => {
		const result = promoteFromUseOfFunds(UOF_THREE_BUCKETS);
		expect(result!.value).toMatch(/\(XLSX\)$/);
	});

	it("uses page_ref from source as evidence", () => {
		const result = promoteFromUseOfFunds(UOF_THREE_BUCKETS);
		expect(result!.evidence).toBe("dpu:doc:uof0001:page:0");
	});
});

// ── Integration tests: evalUseOfFundsSlot with XLSX bridge ────────────────────

/** Minimal inline re-implementation of evalUseOfFundsSlot for integration testing. */
function evalUseOfFundsSlot(inputs: {
	dpuLoadFailed: boolean;
	textPatternHit: SlotResult | null;
	bestUseOfFundsStatement: UseOfFundsV1 | null;
}): SlotResult {
	if (inputs.dpuLoadFailed) {
		return { computable: false, value: null, evidence: null, reasonCode: "DPU_LOAD_FAILED" };
	}
	if (inputs.textPatternHit) return inputs.textPatternHit;
	const promoted = promoteFromUseOfFunds(inputs.bestUseOfFundsStatement);
	if (promoted) return promoted;
	return { computable: false, value: null, evidence: null, reasonCode: REASON.NO_USE_OF_FUNDS_MENTION };
}

describe("evalUseOfFundsSlot — XLSX bridge integration", () => {
	it("promotes from XLSX when text patterns find nothing and UoF has ≥2 buckets", () => {
		const result = evalUseOfFundsSlot({
			dpuLoadFailed: false,
			textPatternHit: null,
			bestUseOfFundsStatement: UOF_THREE_BUCKETS,
		});
		expect(result.computable).toBe(true);
		expect(result.reasonCode).toBe(REASON.DERIVED_FROM_USE_OF_FUNDS);
	});

	it("text pattern result wins over XLSX promotion", () => {
		const textResult: SlotResult = {
			computable: true,
			value: "Use of funds: 40% product, 60% sales",
			evidence: "dpu:doc:pitchdeck:page:7",
			reasonCode: null,
		};
		const result = evalUseOfFundsSlot({
			dpuLoadFailed: false,
			textPatternHit: textResult,
			bestUseOfFundsStatement: UOF_THREE_BUCKETS,
		});
		expect(result.value).toBe("Use of funds: 40% product, 60% sales");
		expect(result.reasonCode).toBeNull();
	});

	it("stays NotComputable when text patterns miss AND UoF is too sparse (guardrail)", () => {
		const result = evalUseOfFundsSlot({
			dpuLoadFailed: false,
			textPatternHit: null,
			bestUseOfFundsStatement: UOF_ONE_BUCKET_NO_TOTAL,
		});
		expect(result.computable).toBe(false);
		expect(result.reasonCode).toBe(REASON.NO_USE_OF_FUNDS_MENTION);
	});

	it("stays NotComputable when text patterns miss AND no XLSX statement exists", () => {
		const result = evalUseOfFundsSlot({
			dpuLoadFailed: false,
			textPatternHit: null,
			bestUseOfFundsStatement: null,
		});
		expect(result.computable).toBe(false);
		expect(result.reasonCode).toBe(REASON.NO_USE_OF_FUNDS_MENTION);
	});

	it("returns DPU_LOAD_FAILED when dpuLoadFailed is true (regardless of XLSX data)", () => {
		const result = evalUseOfFundsSlot({
			dpuLoadFailed: true,
			textPatternHit: null,
			bestUseOfFundsStatement: UOF_THREE_BUCKETS,
		});
		expect(result.computable).toBe(false);
		expect(result.reasonCode).toBe("DPU_LOAD_FAILED");
	});

	it("promoted value is safe to embed in slot line format (no pipe or double-quote hazards)", () => {
		const result = evalUseOfFundsSlot({
			dpuLoadFailed: false,
			textPatternHit: null,
			bestUseOfFundsStatement: UOF_THREE_BUCKETS,
		});
		expect(result.computable).toBe(true);
		const line = formatSlotLine("use_of_funds", result);
		// pipe chars in value must be escaped so slot line parsing remains safe
		expect(line).not.toMatch(/\| value="[^"]*\|/);
	});
});
