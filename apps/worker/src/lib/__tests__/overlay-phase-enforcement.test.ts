import { describe, it, expect } from "vitest";

import { enforcePhaseMode, isNumericClaim } from "../governed-llm-overlay";

function baseOverlay(overrides: Record<string, unknown> = {}) {
	return {
		schema_version: "governed_llm_overview_v1",
		deal_id: "00000000-0000-0000-0000-0000000000aa",
		run_id: "run-1",
		step_run_id: "step-1",
		input_hash: "hash",
		created_at: new Date("2026-01-01T00:00:00.000Z").toISOString(),
		llm_phase_mode: "exploratory",
		summary_text: "",
		claims: [
			{
				claim_type: "kpi",
				label: "ARR",
				value_number: 123,
				confidence: 0.8,
				evidence_refs: [],
			},
		],
		disclosures: [],
		...overrides,
	};
}

describe("overlay phase enforcement", () => {
	it("exploratory allows numeric without evidence + disclosure", () => {
		const overlay: any = baseOverlay();
		const out = enforcePhaseMode(overlay, "exploratory");
		expect(out.input_hash).toEqual("hash");
		expect(out.claims.length).toEqual(1);
		expect(out.disclosures.some((d: any) => d.code === "numeric_claim_missing_evidence")).toEqual(true);
	});

	it("stabilizing removes numeric without evidence + disclosure", () => {
		const overlay: any = baseOverlay();
		const out = enforcePhaseMode(overlay, "stabilizing");
		expect(out.input_hash).toEqual("hash");
		expect(out.claims.length).toEqual(0);
		expect(out.disclosures.some((d: any) => d.code === "stabilizing_removed_numeric_without_evidence")).toEqual(true);
	});

	it("governed suppresses all claims if any numeric lacks evidence + disclosure", () => {
		const overlay: any = baseOverlay();
		const out = enforcePhaseMode(overlay, "governed");
		expect(out.input_hash).toEqual("hash");
		expect(out.claims.length).toEqual(0);
		expect(out.disclosures.some((d: any) => d.code === "governed_mode_validation_failed")).toEqual(true);
	});

	it("when evidence exists, claims are preserved (all phases)", () => {
		const overlay: any = baseOverlay({
			claims: [
				{
					claim_type: "kpi",
					label: "ARR",
					value_number: 123,
					confidence: 0.8,
					evidence_refs: [{ document_id: "doc-1", page_index: 0 }],
				},
			],
		});

		for (const phase of ["exploratory", "stabilizing", "governed"] as const) {
			const out = enforcePhaseMode(overlay, phase);
			expect(out.input_hash).toEqual("hash");
			expect(out.claims.length).toEqual(1);
			expect(out.disclosures.length).toEqual(0);
		}
	});
});

describe("numeric claim classification guard", () => {
	// IMPORTANT:
	// If you add a new claim type containing numeric fields (value, pct, amount, multiple, etc),
	// you MUST update isNumericClaim() and this test.
	// This protects PR2C phase enforcement guarantees.

	function makeClaim(overrides: Record<string, unknown>) {
		return {
			claim_type: "kpi",
			label: "",
			confidence: 0.8,
			evidence_refs: [],
			...overrides,
		};
	}

	it("classifies numeric/KPI-like claims as numeric", () => {
		const revenueClaim: any = makeClaim({
			claim_type: "kpi",
			label: "Revenue",
			value_number: 1000000,
			unit: "USD",
		});

		const arrClaim: any = makeClaim({
			claim_type: "kpi",
			label: "ARR",
			value_number: 1200000,
			unit: "USD",
		});

		const raiseAmountClaim: any = makeClaim({
			claim_type: "other",
			label: "Raise amount",
			value_number: 2500000,
			unit: "USD",
		});

		const growthPctClaim: any = makeClaim({
			claim_type: "kpi",
			label: "Growth",
			value_number: 25,
			unit: "%",
		});

		const multipleClaim: any = makeClaim({
			claim_type: "kpi",
			label: "Revenue multiple",
			value_number: 10,
			unit: "x",
		});

		expect(isNumericClaim(revenueClaim)).toBe(true);
		expect(isNumericClaim(arrClaim)).toBe(true);
		expect(isNumericClaim(raiseAmountClaim)).toBe(true);
		expect(isNumericClaim(growthPctClaim)).toBe(true);
		expect(isNumericClaim(multipleClaim)).toBe(true);
	});

	it("does not classify qualitative/non-numeric claims as numeric", () => {
		const qualitativeStrength: any = makeClaim({
			claim_type: "summary",
			label: "Qualitative strength",
			value_string: "Strong founder-market fit.",
		});

		const marketCommentary: any = makeClaim({
			claim_type: "summary",
			label: "Market commentary",
			value_string: "Market is fragmented; consolidation likely.",
		});

		const hypothesis: any = makeClaim({
			claim_type: "other",
			label: "Hypothesis",
			value_string: "Retention improves after onboarding changes.",
		});

		const suggestion: any = makeClaim({
			claim_type: "other",
			label: "Suggestion",
			value_string: "Validate pricing with 10 customer calls.",
		});

		expect(isNumericClaim(qualitativeStrength)).toBe(false);
		expect(isNumericClaim(marketCommentary)).toBe(false);
		expect(isNumericClaim(hypothesis)).toBe(false);
		expect(isNumericClaim(suggestion)).toBe(false);
	});
});
