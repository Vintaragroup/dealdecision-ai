import { buildInvestmentAnalysisOverviewPrompt } from "../build-investment-analysis-overview-prompt";

describe("buildInvestmentAnalysisOverviewPrompt", () => {
	test("emits JSON-only and required reasoning structure", () => {
		const { system, user } = buildInvestmentAnalysisOverviewPrompt({
			reportExcerpt: { report: { metadata: { score_explanation: { understanding_v1: {} } } } },
		});

		expect(typeof system).toBe("string");
		expect(system.length).toBeGreaterThan(0);
		expect(typeof user).toBe("string");
		expect(user.length).toBeGreaterThan(0);

		expect(system).toContain("Output valid JSON ONLY");
		expect(system).toContain("Return a JSON object with exactly one key");
		expect(system).toContain("Produce 2–4 points only");
		expect(system).toContain("• Signal:");
		expect(system).toContain("• Implication:");
		expect(system).toContain("• Uncertainty:");
		expect(system).toContain("• Decision Tension:");
		expect(system).toContain("Before responding, verify the output contains 2–4 points");
		expect(system).toContain("If you cannot comply, output investment_analysis_overview as an empty string");
		expect(system).toContain("Every '• Implication:' line MUST include at least one uncertainty marker");
		expect(system).toContain("may/might/likely/appears/suggests/could");

		expect(user).toContain("DETERMINISTIC_REPORT_JSON");
		expect(user).toContain("score_explanation");
	});
});
