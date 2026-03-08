/**
 * build-monitoring-query-plan.test.ts — PR37
 *
 * Unit tests for buildMonitoringQueryPlan().
 *
 * Strategy:
 *   - Empty context degrades gracefully to generic startup queries
 *   - company_name present: query uses quoted company name
 *   - competitor_names present: OR-query for up to 3 competitors
 *   - founder_names present: first founder name is quoted in query
 *   - sector propagated to market_signals query
 *   - All 4 bucket keys always present in output
 */

import { describe, it, expect } from "vitest";
import { buildMonitoringQueryPlan } from "../build-monitoring-query-plan";
import type { MonitoringContext } from "../build-monitoring-query-plan";

function makeCtx(overrides: Partial<MonitoringContext> = {}): MonitoringContext {
	return {
		company_name: null,
		sector: null,
		competitor_names: [],
		founder_names: [],
		...overrides,
	};
}

describe("buildMonitoringQueryPlan", () => {
	it("returns all 4 bucket keys", () => {
		const plan = buildMonitoringQueryPlan(makeCtx());
		expect(Object.keys(plan.queries)).toEqual(
			expect.arrayContaining([
				"company_signals",
				"competitor_signals",
				"market_signals",
				"founder_team_signals",
			])
		);
	});

	it("includes recency anchor in all queries", () => {
		const plan = buildMonitoringQueryPlan(makeCtx({ company_name: "Acme", sector: "Fintech" }));
		for (const q of Object.values(plan.queries)) {
			expect(q).toContain("2025");
		}
	});

	it("quotes company_name in company_signals query", () => {
		const plan = buildMonitoringQueryPlan(makeCtx({ company_name: "AcmeCorp" }));
		expect(plan.queries.company_signals).toContain('"AcmeCorp"');
	});

	it("includes sector in company_signals query when present", () => {
		const plan = buildMonitoringQueryPlan(
			makeCtx({ company_name: "AcmeCorp", sector: "CleanTech" })
		);
		expect(plan.queries.company_signals).toContain("CleanTech");
	});

	it("generates OR-query for multiple competitors", () => {
		const plan = buildMonitoringQueryPlan(
			makeCtx({ competitor_names: ["Alpha Inc", "Beta Co", "Gamma Ltd"] })
		);
		expect(plan.queries.competitor_signals).toContain('"Alpha Inc"');
		expect(plan.queries.competitor_signals).toContain('"Beta Co"');
		expect(plan.queries.competitor_signals).toContain("OR");
	});

	it("uses single quoted name when only one competitor", () => {
		const plan = buildMonitoringQueryPlan(
			makeCtx({ competitor_names: ["OnlyComp"] })
		);
		expect(plan.queries.competitor_signals).toContain('"OnlyComp"');
		expect(plan.queries.competitor_signals).not.toContain("OR");
	});

	it("uses sector in market_signals query", () => {
		const plan = buildMonitoringQueryPlan(makeCtx({ sector: "HealthTech" }));
		expect(plan.queries.market_signals).toContain("HealthTech");
	});

	it("quotes first founder name in founder_team_signals query", () => {
		const plan = buildMonitoringQueryPlan(
			makeCtx({ founder_names: ["Jane Doe", "John Smith"] })
		);
		expect(plan.queries.founder_team_signals).toContain('"Jane Doe"');
	});

	it("degrades to startup fallback when context is empty", () => {
		const plan = buildMonitoringQueryPlan(makeCtx());
		expect(plan.queries.company_signals).toContain("startup");
		expect(plan.queries.competitor_signals).toContain("startup");
		expect(plan.queries.founder_team_signals).toContain("startup");
	});

	it("persists context fields in returned plan", () => {
		const ctx = makeCtx({
			company_name: "TestCo",
			sector: "SaaS",
			competitor_names: ["Comp1"],
			founder_names: ["Alice"],
		});
		const plan = buildMonitoringQueryPlan(ctx);
		expect(plan.company_name).toBe("TestCo");
		expect(plan.sector).toBe("SaaS");
		expect(plan.competitor_names).toEqual(["Comp1"]);
		expect(plan.founder_names).toEqual(["Alice"]);
	});
});
