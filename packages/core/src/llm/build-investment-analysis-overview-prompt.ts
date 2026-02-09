export type BuildInvestmentAnalysisOverviewPromptArgs = {
	reportExcerpt: unknown;
};

export function buildInvestmentAnalysisOverviewPrompt(
	args: BuildInvestmentAnalysisOverviewPromptArgs,
): { system: string; user: string } {
	const reportExcerptJson = JSON.stringify(args?.reportExcerpt ?? null);

	const requiredTemplate =
		"{\"investment_analysis_overview\":\"" +
		"• Signal: <text>\\n" +
		"• Implication: <text with uncertainty language: may/might/likely/appears/suggests/could>\\n" +
		"• Uncertainty: <text>\\n" +
		"• Decision Tension: <text>\\n\\n" +
		"• Signal: <text>\\n" +
		"• Implication: <text with uncertainty language: may/might/likely/appears/suggests/could>\\n" +
		"• Uncertainty: <text>\\n" +
		"• Decision Tension: <text>\"}";

	const exampleOnePoint =
		"• Signal: Evidence is incomplete or internally inconsistent.\\n" +
		"• Implication: This may change the risk/reward framing if validated.\\n" +
		"• Uncertainty: Key inputs and causal links are not yet confirmed.\\n" +
		"• Decision Tension: Whether to invest now versus require verification first.";

	const system =
		"You are an investment committee analyst operating under strict governance rules. " +
		"Deterministic analysis is authoritative. " +
		"You must NOT introduce new facts, entities, metrics, or numerical claims. " +
		"You may only interpret, synthesize, and frame judgment using uncertainty-aware language. " +
		"You are producing an INVESTMENT ANALYSIS OVERVIEW. This is NOT a summary. " +
		"This is a reasoning artifact for an investment committee. " +
		"Your objective: Explain what actually matters in this deal, why the score looks the way it does, and where judgment—not math—drives the decision. " +
		"You must follow the reasoning structure below exactly. " +
		"REASONING STRUCTURE (MANDATORY): Produce 2–4 points only. " +
		"Each point MUST start with the exact literal delimiter and label: '• Signal:' (U+2022 bullet, then a space, then Signal, then colon). " +
		"Within each point, you MUST include ALL four labels exactly once, each on its own line, and each line MUST begin with the exact literal label string including the bullet: " +
		"'• Signal:', '• Implication:', '• Uncertainty:', '• Decision Tension:'. " +
		"Do NOT use '-', '*', numbering, or any other bullet marker. Do NOT write 'Signal -' or 'Signal —'. " +
		"Point delimiter format: each point is exactly 4 lines (one per label) and points are separated by exactly one blank line. " +
		"Before responding, verify the output contains 2–4 points and each point contains all 4 labels exactly once. " +
		"If you cannot comply, output investment_analysis_overview as an empty string. " +
		"CONSTRAINTS: Every '• Implication:' line MUST include at least one uncertainty marker: may/might/likely/appears/suggests/could. " +
		"KPI tokens (revenue/ARR/MRR/burn/runway/etc.) must be referenced only as missing/unclear evidence unless you include a matching deterministic citation; avoid numbers unless cited. " +
		"You may restate facts ONLY if they already appear in deterministic outputs. " +
		"Do NOT repeat the deterministic score explanation verbatim. " +
		"Do NOT assign or suggest a score, grade, recommendation, or decision. " +
		"Do NOT resolve uncertainty — surface it. " +
		"Focus on asymmetry, irreversibility, and decision leverage. " +
		"OUTPUT: Output valid JSON ONLY. No markdown. No prose outside JSON. " +
		"Return a JSON object with exactly one key: {investment_analysis_overview:string}. " +
		"investment_analysis_overview length must be <= 2400 chars. " +
		"Example of ONE correctly formatted point (generic; do not copy verbatim): " +
		exampleOnePoint +
		" Return format must match this template exactly (fill in the <text> placeholders; you may add up to 4 points by repeating the 4 labeled lines and separating points with a blank line): " +
		requiredTemplate;

	const user = `DETERMINISTIC_REPORT_JSON:\n${reportExcerptJson}`;

	return { system, user };
}
