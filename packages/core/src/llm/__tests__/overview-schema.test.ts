import { LlmOverviewV1Schema } from "../overview-schema";

describe("LlmOverviewV1Schema", () => {
	it("valid object passes", () => {
		const value = {
			version: "llm_overview_v1",
			hero_header: "This is sentence one. This is sentence two.",
			deal_summary: {
				hero: "One sentence.",
				mid: "A short summary. Second sentence. Third sentence.",
				long: "Longer summary. Sentence two. Sentence three. Sentence four. Sentence five. Sentence six. Sentence seven. Sentence eight.",
			},
			investment_analysis_overview: "Investor memo tone. Sentence two. Sentence three. Sentence four.",
			strengths_overlay: ["Strong product signal."],
			concerns_overlay: ["Evidence is thin."],
			coverage_gaps_overlay: ["Missing cohort retention data."],
			citations: [{ page: 1, slide_title: "Overview", evidence_id: "ev_123" }],
			quality_flags: [],
		};

		expect(() => LlmOverviewV1Schema.parse(value)).not.toThrow();
	});

	it("oversized arrays fail", () => {
		const base = {
			version: "llm_overview_v1",
			hero_header: "Two sentences. Second sentence.",
			deal_summary: { hero: "One.", mid: "Two. Three.", long: "Four. Five. Six. Seven. Eight. Nine. Ten. Eleven." },
			investment_analysis_overview: "One. Two. Three. Four.",
			strengths_overlay: Array.from({ length: 7 }, (_, i) => `s${i}`),
			concerns_overlay: [],
			coverage_gaps_overlay: [],
			citations: [],
			quality_flags: [],
		};

		const res = LlmOverviewV1Schema.safeParse(base);
		expect(res.success).toBe(false);
	});

	it("missing version fails", () => {
		const value: any = {
			hero_header: "Two sentences. Second sentence.",
			deal_summary: { hero: "One.", mid: "Two. Three.", long: "Four. Five. Six. Seven. Eight. Nine. Ten. Eleven." },
			investment_analysis_overview: "One. Two. Three. Four.",
			strengths_overlay: [],
			concerns_overlay: [],
			coverage_gaps_overlay: [],
			citations: [],
			quality_flags: [],
		};

		const res = LlmOverviewV1Schema.safeParse(value);
		expect(res.success).toBe(false);
	});
});
