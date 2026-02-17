import { reconcileArrMrrKpisV1, type ArrMrrKpiClaimV1 } from "../kpi-reconciliation-v1";

describe("reconcileArrMrrKpisV1", () => {
	it("prefers Total over non-total", () => {
		const claims: ArrMrrKpiClaimV1[] = [
			{ claim_id: "a", metric: "ARR", value: 1_000_000, label: "ARR", context: "segment A" },
			{ claim_id: "b", metric: "ARR", value: 2_000_000, label: "Total ARR", context: "company" },
		];
		const out = reconcileArrMrrKpisV1({ generated_at: "now", claims });
		expect(out.results.ARR.resolved).toBe(true);
		expect(out.results.ARR.value).toBe(2_000_000);
		expect(out.results.ARR.source_claim_id).toBe("b");
		expect(out.results.ARR.rejected_claims.length).toBe(1);
		expect(out.results.ARR.rejected_claims[0].reason).toMatch(/Total/i);
	});

	it("prefers company-level over use-case", () => {
		const claims: ArrMrrKpiClaimV1[] = [
			{ claim_id: "a", metric: "MRR", value: 10_000, label: "MRR", context: "per use case" },
			{ claim_id: "b", metric: "MRR", value: 25_000, label: "MRR", context: "company overall" },
		];
		const out = reconcileArrMrrKpisV1({ generated_at: "now", claims });
		expect(out.results.MRR.resolved).toBe(true);
		expect(out.results.MRR.value).toBe(25_000);
		expect(out.results.MRR.source_claim_id).toBe("b");
	});

	it("prefers actuals over projections", () => {
		const claims: ArrMrrKpiClaimV1[] = [
			{ claim_id: "a", metric: "ARR", value: 900_000, label: "ARR", context: "projected" },
			{ claim_id: "b", metric: "ARR", value: 750_000, label: "ARR", context: "actuals" },
		];
		const out = reconcileArrMrrKpisV1({ generated_at: "now", claims });
		expect(out.results.ARR.resolved).toBe(true);
		expect(out.results.ARR.value).toBe(750_000);
		expect(out.results.ARR.source_claim_id).toBe("b");
	});

	it("returns unresolved conflict when top-precedence ties disagree on value", () => {
		const claims: ArrMrrKpiClaimV1[] = [
			{ claim_id: "a", metric: "MRR", value: 50_000, label: "Total MRR", context: "company" },
			{ claim_id: "b", metric: "MRR", value: 55_000, label: "Total MRR", context: "company" },
		];
		const out = reconcileArrMrrKpisV1({ generated_at: "now", claims });
		expect(out.results.MRR.resolved).toBe(false);
		expect(out.results.MRR.conflict_reason).toMatch(/top_precedence_tie/i);
		// Explicitly does not silently drop into a winner.
		expect(out.results.MRR.value).toBeUndefined();
	});
});
