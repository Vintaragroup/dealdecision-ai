import { buildNarrationPrompt } from "../build-narration-prompt";

describe("buildNarrationPrompt", () => {
	it("includes KPI-token rewrite guidance for sections and insights", () => {
		const excerpt = {
			structured_summary: {},
			deal_summary_v1: { version: "deal_summary_v1", one_liner: "Test." },
			score_explanation: { understanding_v1: { summary: "", strengths: [], diligence_open_items: [] } },
		};

		const { system } = buildNarrationPrompt({ excerpt });
		expect(system).toContain("KPI-token rule (sections+insights)");
		expect(system).toContain("cash outflow rate");
		expect(system).toContain("monthly spend rate");
		expect(system).toContain("time-to-cash-constraint");
		expect(system).toContain("top-line performance");
	});
});
