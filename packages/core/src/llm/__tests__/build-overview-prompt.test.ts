import { buildOverviewPrompt } from "../build-overview-prompt";

describe("buildOverviewPrompt", () => {
	it("returns system+user strings and embeds excerpt", () => {
		const reportExcerpt = {
			structured_summary: { kpis: {}, issues: [] },
			deal_summary_v1: { version: "deal_summary_v1", one_liner: "Test deal." },
			score_explanation: { understanding_v1: { summary: "Grounded", strengths: [], diligence_open_items: [] } },
		};

		const { system, user } = buildOverviewPrompt({ reportExcerpt, narration: { version: "llm_narration_v1" } });
		expect(typeof system).toBe("string");
		expect(typeof user).toBe("string");
		expect(system).toContain("llm_overview_v1");
		expect(user).toContain("REPORT_EXCERPT_JSON");
		expect(user).toContain("Test deal");
	});
});
