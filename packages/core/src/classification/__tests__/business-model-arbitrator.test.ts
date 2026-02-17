import { arbitrateBusinessModelV1 } from "../business-model-arbitrator";

describe("arbitrateBusinessModelV1 (regression)", () => {
	it("does not allow real_estate_investment when strong SaaS evidence exists", () => {
		const out = arbitrateBusinessModelV1({
			detected_revenue_types: ["saas_subscriptions"],
			kpis_present: ["mrr", "arr"],
			product_descriptors: ["AI-powered platform", "software"],
			slide_archetypes: ["Revenue Model", "Traction", "GTM"],
			candidates: [{ business_model: "real_estate_investment", confidence: 0.8, source: "upstream" }],
		});

		expect(out.business_model).not.toBe("real_estate_investment");
		expect(["saas", "regtech_saas"]).toContain(out.business_model);
		expect(out.overridden_candidates.map((c) => String(c.business_model))).toContain("real_estate_investment");
	});
});
