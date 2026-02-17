import { describe, it, expect } from "vitest";
import { buildPhase1KpiReconciliationV1 } from "../kpiReconciliationV1";

describe("buildPhase1KpiReconciliationV1", () => {
	it("extracts ARR/MRR claims from DPU payload.key_metrics and reconciles deterministically", async () => {
		const fakePool = {
			query: async () => {
				return {
					rows: [
						{
							document_id: "11111111-1111-4111-8111-111111111111",
							page_index: 0,
							payload: {
								key_metrics: [
									{ label: "MRR", context: "company overall", value: "$50k MRR", conf: 0.9 },
									{ label: "MRR", context: "projected", value: "$80k MRR", conf: 0.95 },
									{ label: "ARR", context: "Total", value: "$1.2M ARR", conf: 0.8 },
								],
							},
						},
					],
				};
			},
		} as any;

		const out = await buildPhase1KpiReconciliationV1({
			pool: fakePool,
			dealId: "22222222-2222-4222-8222-222222222222",
			documents: [{ document_id: "11111111-1111-4111-8111-111111111111", type: "pitch_deck" }],
			nowIso: "2026-02-10T00:00:00.000Z",
		});

		expect(Array.isArray(out.claims)).toBe(true);
		expect(out.claims.length).toBe(3);
		expect(out.reconciliation.version).toBe("kpi_reconciliation_v1");

		// MRR should prefer actual/company over projection.
		expect(out.reconciliation.results.MRR.resolved).toBe(true);
		expect(out.reconciliation.results.MRR.value).toBe(50_000);

		// ARR should resolve to the one claim.
		expect(out.reconciliation.results.ARR.resolved).toBe(true);
		expect(out.reconciliation.results.ARR.value).toBe(1_200_000);
	});
});
