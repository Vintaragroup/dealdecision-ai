import { describe, it, expect } from "vitest";

import { enforcePhaseMode } from "../governed-llm-overlay";

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
