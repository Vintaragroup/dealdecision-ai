/**
 * Unit tests for WS-B (PR20): recordGovernedSkip + productProfileReasonToSkipCode
 *
 * Pure functions — no DB, no LLM, no side effects.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
	recordGovernedSkip,
	productProfileReasonToSkipCode,
	type GovernedSkip,
} from "../stages/governed-skip";

// ─── recordGovernedSkip ────────────────────────────────────────────────────────

describe("recordGovernedSkip — log output", () => {
	beforeEach(() => {
		vi.spyOn(console, "log").mockImplementation(() => {});
	});

	it("emits a GOVERNED_STAGE_SKIPPED JSON event to console.log", () => {
		recordGovernedSkip({
			stage: "governed_summary_v1",
			reason_code: "validation_failed",
			deal_id: "abc-123",
			report_id: "rep-456",
		});

		expect(console.log).toHaveBeenCalledOnce();
		const call = vi.mocked(console.log).mock.calls[0]![0] as string;
		const parsed = JSON.parse(call) as Record<string, unknown>;
		expect(parsed["event"]).toBe("GOVERNED_STAGE_SKIPPED");
		expect(parsed["stage"]).toBe("governed_summary_v1");
		expect(parsed["reason_code"]).toBe("validation_failed");
		expect(parsed["deal_id"]).toBe("abc-123");
		expect(parsed["report_id"]).toBe("rep-456");
		expect(typeof parsed["ts"]).toBe("string");
	});

	it("sets deal_id and report_id to null when not provided", () => {
		recordGovernedSkip({ stage: "product_profile_v1", reason_code: "no_product_narrative" });
		const call = vi.mocked(console.log).mock.calls[0]![0] as string;
		const parsed = JSON.parse(call) as Record<string, unknown>;
		expect(parsed["deal_id"]).toBeNull();
		expect(parsed["report_id"]).toBeNull();
	});
});

describe("recordGovernedSkip — governedSkips mutation", () => {
	it("appends a GovernedSkip record to the provided array", () => {
		const skips: GovernedSkip[] = [];
		recordGovernedSkip({
			stage: "governed_executive_summary_v1",
			reason_code: "unknown",
			governedSkips: skips,
		});
		expect(skips).toHaveLength(1);
		expect(skips[0]!.stage).toBe("governed_executive_summary_v1");
		expect(skips[0]!.reason_code).toBe("unknown");
		expect(typeof skips[0]!.ts).toBe("string");
	});

	it("appends multiple calls to the same array", () => {
		const skips: GovernedSkip[] = [];
		recordGovernedSkip({ stage: "governed_summary_v1", reason_code: "unknown", governedSkips: skips });
		recordGovernedSkip({ stage: "product_profile_v1", reason_code: "no_product_narrative", governedSkips: skips });
		expect(skips).toHaveLength(2);
		expect(skips[0]!.stage).toBe("governed_summary_v1");
		expect(skips[1]!.stage).toBe("product_profile_v1");
	});

	it("does not mutate the array when governedSkips is undefined", () => {
		// Should not throw even when omitted
		expect(() =>
			recordGovernedSkip({ stage: "governed_summary_v1", reason_code: "timeout" })
		).not.toThrow();
	});
});

// ─── productProfileReasonToSkipCode ───────────────────────────────────────────

describe("productProfileReasonToSkipCode", () => {
	it.each([
		["no_product_narrative", "no_product_narrative"],
		["no_product", "no_product_narrative"],
		["narrative_absent", "no_product_narrative"],
		["missing_openai_key", "missing_openai_key"],
		["openai_key_missing", "missing_openai_key"],
		["api_key_not_set", "missing_openai_key"],
		["feature_flag_disabled", "feature_flag_disabled"],
		["disabled", "feature_flag_disabled"],
		["timeout", "timeout"],
		["", "unknown"],
		[null, "unknown"],
		[undefined, "unknown"],
	] as const)("maps %s → %s", (input, expected) => {
		expect(productProfileReasonToSkipCode(input as string | null | undefined)).toBe(expected);
	});

	it("returns 'unknown' for unrecognised strings", () => {
		expect(productProfileReasonToSkipCode("UNEXPECTED_REASON")).toBe("unknown");
	});
});

// ─── GovernedSkip record shape ────────────────────────────────────────────────

describe("GovernedSkip record shape", () => {
	it("ts is a valid ISO datetime", () => {
		const skips: GovernedSkip[] = [];
		recordGovernedSkip({ stage: "governed_summary_v1", reason_code: "unknown", governedSkips: skips });
		const ts = skips[0]!.ts;
		expect(new Date(ts).getTime()).toBeGreaterThan(0);
	});
});
