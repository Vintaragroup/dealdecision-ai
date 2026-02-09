import { degradeOverviewV1 } from "../overview-guard";

const baseExcerpt = {
	structured_summary: {
		company_name: "Acme Corp",
		kpis: {
			revenue: { value_raw: "$1.2M", source: { page: 1, slide_title: "Traction" } },
		},
	},
	deal_summary_v1: { version: "deal_summary_v1", one_liner: "Acme Corp builds payroll tooling." },
	deal_summary: { tiers: { hero: "Deterministic tier hero." } },
	score_explanation: {
		understanding_v1: {
			summary: "Acme Corp is discussed in the excerpt.",
			strengths: [],
			execution_dependencies: [],
			diligence_open_items: [],
		},
	},
	citations: { total_sources: 1, unique_pages: 1 },
} as const;

describe("degradeOverviewV1", () => {
	it("sentence-start 'Clarity …' does not trigger entity.new_not_in_excerpt", () => {
		const excerpt = {
			structured_summary: {},
			deal_summary_v1: { version: "deal_summary_v1", one_liner: "Deterministic one-liner." },
			deal_summary: { tiers: { hero: "Deterministic hero." } },
			score_explanation: {
				understanding_v1: { summary: "", strengths: [], execution_dependencies: [], diligence_open_items: [] },
			},
			citations: { total_sources: 0, unique_pages: 0 },
		} as const;

		const overview = {
			version: "llm_overview_v1",
			hero_header: "Clarity may improve with audited financials.",
			deal_summary: { hero: "", mid: "", long: "" },
			investment_analysis_overview: "",
			strengths_overlay: [],
			concerns_overlay: [],
			coverage_gaps_overlay: [],
			citations: [],
			quality_flags: [],
		};

		const res = degradeOverviewV1({ reportExcerpt: excerpt, overview });
		expect(res.ok).toBe(true);
		expect((res.error?.violations ?? []).some((v) => v.code === "entity.new_not_in_excerpt")).toBe(false);
	});

	it("sentence-start 'Notion …' still triggers entity.new_not_in_excerpt", () => {
		const excerpt = {
			structured_summary: {},
			deal_summary_v1: { version: "deal_summary_v1", one_liner: "Deterministic one-liner." },
			deal_summary: { tiers: { hero: "Deterministic hero." } },
			score_explanation: {
				understanding_v1: { summary: "", strengths: [], execution_dependencies: [], diligence_open_items: [] },
			},
			citations: { total_sources: 0, unique_pages: 0 },
		} as const;

		const overview = {
			version: "llm_overview_v1",
			hero_header: "Notion may improve collaboration.",
			deal_summary: { hero: "", mid: "", long: "" },
			investment_analysis_overview: "",
			strengths_overlay: [],
			concerns_overlay: [],
			coverage_gaps_overlay: [],
			citations: [],
			quality_flags: [],
		};

		const res = degradeOverviewV1({ reportExcerpt: excerpt, overview });
		expect(res.ok).toBe(false);
		expect(res.error?.violations.some((v) => v.code === "entity.new_not_in_excerpt")).toBe(true);
	});

	it("sentence-start 'Palm …' triggers entity.new_not_in_excerpt when excerpt is empty", () => {
		const excerpt = {
			structured_summary: {},
			deal_summary_v1: { version: "deal_summary_v1", one_liner: "Deterministic one-liner." },
			deal_summary: { tiers: { hero: "Deterministic hero." } },
			score_explanation: {
				understanding_v1: { summary: "", strengths: [], execution_dependencies: [], diligence_open_items: [] },
			},
			citations: { total_sources: 0, unique_pages: 0 },
		} as const;

		const overview = {
			version: "llm_overview_v1",
			hero_header: "Palm may improve execution discipline.",
			deal_summary: { hero: "", mid: "", long: "" },
			investment_analysis_overview: "",
			strengths_overlay: [],
			concerns_overlay: [],
			coverage_gaps_overlay: [],
			citations: [],
			quality_flags: [],
		};

		const res = degradeOverviewV1({ reportExcerpt: excerpt, overview });
		expect(res.ok).toBe(false);
		expect(res.error?.violations.some((v) => v.code === "entity.new_not_in_excerpt")).toBe(true);
	});

	it("drops an invalid bullet but keeps the others", () => {
		const overview = {
			version: "llm_overview_v1",
			hero_header: "Acme Corp overview.",
			deal_summary: { hero: "Acme Corp.", mid: "", long: "" },
			investment_analysis_overview: "",
			strengths_overlay: [
				"Acme Corp has clear positioning.",
				"Notion is a competitor mentioned here.",
			],
			concerns_overlay: [],
			coverage_gaps_overlay: [],
			citations: [{ page: 1, slide_title: "Traction" }],
			quality_flags: [],
		};

		const res = degradeOverviewV1({ reportExcerpt: baseExcerpt, overview });
		expect(res.ok).toBe(false);
		expect(res.overview.strengths_overlay).toEqual(["Acme Corp has clear positioning."]);
		expect(res.error?.dropped_bullets ?? 0).toBeGreaterThanOrEqual(1);
	});

	it("numeric/KPI token without citation triggers violation", () => {
		const overview = {
			version: "llm_overview_v1",
			hero_header: "Revenue grew 50% year-over-year.",
			deal_summary: { hero: "Acme Corp.", mid: "", long: "" },
			investment_analysis_overview: "",
			strengths_overlay: [],
			concerns_overlay: [],
			coverage_gaps_overlay: [],
			citations: [],
			quality_flags: [],
		};

		const res = degradeOverviewV1({ reportExcerpt: baseExcerpt, overview });
		expect(res.ok).toBe(false);
		expect(res.error?.violations.some((v) => v.code === "citation.required_for_numeric_or_kpi")).toBe(true);
	});

	it("uses deterministic fallbacks on failure", () => {
		const overview = {
			version: "llm_overview_v1",
			hero_header: "Notion will dominate this category.",
			deal_summary: { hero: "Notion is the company.", mid: "", long: "" },
			investment_analysis_overview: "",
			strengths_overlay: [],
			concerns_overlay: [],
			coverage_gaps_overlay: [],
			citations: [],
			quality_flags: [],
		};

		const res = degradeOverviewV1({ reportExcerpt: baseExcerpt, overview });
		expect(res.overview.hero_header).toBe(baseExcerpt.deal_summary_v1.one_liner);
		expect(res.overview.deal_summary.hero).toBe(baseExcerpt.deal_summary.tiers.hero);
	});

	it("sentence-start capitalization like 'Reliance on …' does not trigger entity.new_not_in_excerpt in overlay bullets", () => {
		const overview = {
			version: "llm_overview_v1",
			hero_header: "Acme Corp overview.",
			deal_summary: { hero: "Acme Corp.", mid: "", long: "" },
			investment_analysis_overview: "",
			strengths_overlay: ["Reliance on wholesale distribution may be a risk posture to validate."],
			concerns_overlay: [],
			coverage_gaps_overlay: [],
			citations: [{ page: 1, slide_title: "Traction" }],
			quality_flags: [],
		};

		const res = degradeOverviewV1({ reportExcerpt: baseExcerpt, overview });
		expect(res.ok).toBe(true);
		expect(res.overview.strengths_overlay).toEqual([
			"Reliance on wholesale distribution may be a risk posture to validate.",
		]);
		expect((res.error?.violations ?? []).some((v) => v.code === "entity.new_not_in_excerpt")).toBe(false);
	});

	it("Need on sentence-start Title Case token does not trigger entity gating in concerns_overlay", () => {
		const overview = {
			version: "llm_overview_v1",
			hero_header: "Acme Corp overview.",
			deal_summary: { hero: "Acme Corp.", mid: "", long: "" },
			investment_analysis_overview: "",
			strengths_overlay: [],
			concerns_overlay: ["Need for tighter churn instrumentation remains unclear."],
			coverage_gaps_overlay: [],
			citations: [{ page: 1, slide_title: "Traction" }],
			quality_flags: [],
		};

		const res = degradeOverviewV1({ reportExcerpt: baseExcerpt, overview });
		expect(res.ok).toBe(true);
		expect(res.overview.concerns_overlay).toEqual([
			"Need for tighter churn instrumentation remains unclear.",
		]);
		const violations = res.error?.violations ?? [];
		expect(violations.some((v) => v.code === "entity.new_not_in_excerpt")).toBe(false);
	});

	it("Detailed on sentence-start Title Case token does not trigger entity gating in coverage_gaps_overlay", () => {
		const overview = {
			version: "llm_overview_v1",
			hero_header: "Acme Corp overview.",
			deal_summary: { hero: "Acme Corp.", mid: "", long: "" },
			investment_analysis_overview: "",
			strengths_overlay: [],
			concerns_overlay: [],
			coverage_gaps_overlay: ["Detailed unit economics analysis is missing."],
			citations: [{ page: 1, slide_title: "Traction" }],
			quality_flags: [],
		};

		const res = degradeOverviewV1({ reportExcerpt: baseExcerpt, overview });
		expect(res.ok).toBe(true);
		expect(res.overview.coverage_gaps_overlay).toEqual(["Detailed unit economics analysis is missing."]);
		const violations = res.error?.violations ?? [];
		expect(violations.some((v) => v.code === "entity.new_not_in_excerpt")).toBe(false);
	});

	it("sentence-start 'Conduct …' does not trigger entity.new_not_in_excerpt in overlay bullets", () => {
		const overview = {
			version: "llm_overview_v1",
			hero_header: "Acme Corp overview.",
			deal_summary: { hero: "Acme Corp.", mid: "", long: "" },
			investment_analysis_overview: "",
			strengths_overlay: [],
			concerns_overlay: [],
			coverage_gaps_overlay: ["Conduct a risk review focused on unit economics and retention."],
			citations: [{ page: 1, slide_title: "Traction" }],
			quality_flags: [],
		};

		const res = degradeOverviewV1({ reportExcerpt: baseExcerpt, overview });
		expect(res.ok).toBe(true);
		expect(res.overview.coverage_gaps_overlay).toEqual([
			"Conduct a risk review focused on unit economics and retention.",
		]);
		expect((res.error?.violations ?? []).some((v) => v.code === "entity.new_not_in_excerpt")).toBe(false);
	});

	it("sentence-start 'Investors …' does not trigger entity.new_not_in_excerpt in overlay bullets", () => {
		const overview = {
			version: "llm_overview_v1",
			hero_header: "Acme Corp overview.",
			deal_summary: { hero: "Acme Corp.", mid: "", long: "" },
			investment_analysis_overview: "",
			strengths_overlay: [],
			concerns_overlay: ["Investors may require clarification on go-to-market assumptions."],
			coverage_gaps_overlay: [],
			citations: [{ page: 1, slide_title: "Traction" }],
			quality_flags: [],
		};

		const res = degradeOverviewV1({ reportExcerpt: baseExcerpt, overview });
		expect(res.ok).toBe(true);
		expect(res.overview.concerns_overlay).toEqual([
			"Investors may require clarification on go-to-market assumptions.",
		]);
		expect((res.error?.violations ?? []).some((v) => v.code === "entity.new_not_in_excerpt")).toBe(false);
	});

	it("real new entity like 'The team uses Notion …' still triggers entity.new_not_in_excerpt in overlay bullets", () => {
		const overview = {
			version: "llm_overview_v1",
			hero_header: "Acme Corp overview.",
			deal_summary: { hero: "Acme Corp.", mid: "", long: "" },
			investment_analysis_overview: "",
			strengths_overlay: ["The team uses Notion for internal workflows."],
			concerns_overlay: [],
			coverage_gaps_overlay: [],
			citations: [{ page: 1, slide_title: "Traction" }],
			quality_flags: [],
		};

		const res = degradeOverviewV1({ reportExcerpt: baseExcerpt, overview });
		expect(res.ok).toBe(false);
		expect(res.overview.strengths_overlay).toEqual([]);
		expect(res.error?.violations.some((v) => v.code === "entity.new_not_in_excerpt")).toBe(true);
	});

	it("missing-evidence KPI mention does not require citation when no numbers are present", () => {
		const overview = {
			version: "llm_overview_v1",
			hero_header: "Acme Corp overview.",
			deal_summary: { hero: "Acme Corp.", mid: "", long: "" },
			investment_analysis_overview: "",
			strengths_overlay: [],
			concerns_overlay: [],
			coverage_gaps_overlay: ["Revenue and other financial metrics are not provided."],
			citations: [],
			quality_flags: [],
		};

		const res = degradeOverviewV1({ reportExcerpt: baseExcerpt, overview });
		expect(res.ok).toBe(true);
		expect((res.error?.violations ?? []).some((v) => v.code === "citation.required_for_numeric_or_kpi")).toBe(false);
	});

	it("uncited KPI claim still requires citation", () => {
		const overview = {
			version: "llm_overview_v1",
			hero_header: "Acme Corp overview.",
			deal_summary: { hero: "Acme Corp.", mid: "", long: "" },
			investment_analysis_overview: "",
			strengths_overlay: ["Revenue is strong."],
			concerns_overlay: [],
			coverage_gaps_overlay: [],
			citations: [],
			quality_flags: [],
		};

		const res = degradeOverviewV1({ reportExcerpt: baseExcerpt, overview });
		expect(res.ok).toBe(false);
		expect(res.error?.violations.some((v) => v.code === "citation.required_for_numeric_or_kpi")).toBe(true);
	});

	it("uncited numeric KPI claim still requires citation", () => {
		const overview = {
			version: "llm_overview_v1",
			hero_header: "Acme Corp overview.",
			deal_summary: { hero: "Acme Corp.", mid: "", long: "" },
			investment_analysis_overview: "",
			strengths_overlay: ["Revenue is $4.5M."],
			concerns_overlay: [],
			coverage_gaps_overlay: [],
			citations: [],
			quality_flags: [],
		};

		const res = degradeOverviewV1({ reportExcerpt: baseExcerpt, overview });
		expect(res.ok).toBe(false);
		expect(res.error?.violations.some((v) => v.code === "citation.required_for_numeric_or_kpi")).toBe(true);
	});

	it("keeps investment_analysis_overview when it matches the required 2–4 point structure", () => {
		const overview = {
			version: "llm_overview_v1",
			hero_header: "Acme Corp overview.",
			deal_summary: { hero: "Acme Corp.", mid: "", long: "" },
			investment_analysis_overview:
				"• Signal: Evidence is incomplete or internally inconsistent.\n" +
				"• Implication: This may shift the risk/reward framing if validated.\n" +
				"• Uncertainty: Key inputs are not yet confirmed.\n" +
				"• Decision Tension: Whether to invest now versus require verification first.\n\n" +
				"• Signal: Material diligence gaps remain in the excerpt.\n" +
				"• Implication: This might increase variance in outcomes and timeline risk.\n" +
				"• Uncertainty: The missing evidence could be benign or fundamental.\n" +
				"• Decision Tension: Whether to treat this as a pacing item or a blocker.",
			strengths_overlay: [],
			concerns_overlay: [],
			coverage_gaps_overlay: [],
			citations: [{ page: 1, slide_title: "Traction" }],
			quality_flags: [],
		};

		const res = degradeOverviewV1({ reportExcerpt: baseExcerpt, overview });
		expect(res.ok).toBe(true);
		expect(res.overview.investment_analysis_overview.length).toBeGreaterThan(0);
		expect(
			(res.error?.violations ?? []).some((v) => v.code === "investment_overview.structure.required_points"),
		).toBe(false);
	});

	it("Signal-only investment_analysis_overview triggers required_points violation", () => {
		const overview = {
			version: "llm_overview_v1",
			hero_header: "Acme Corp overview.",
			deal_summary: { hero: "Acme Corp.", mid: "", long: "" },
			investment_analysis_overview: "• Signal: Only one label is present.",
			strengths_overlay: [],
			concerns_overlay: [],
			coverage_gaps_overlay: [],
			citations: [{ page: 1, slide_title: "Traction" }],
			quality_flags: [],
		};

		const res = degradeOverviewV1({ reportExcerpt: baseExcerpt, overview });
		expect(res.overview.investment_analysis_overview).toBe("");
		expect(res.ok).toBe(false);
		expect(
			res.error?.violations.some((v) => v.code === "investment_overview.structure.required_points"),
		).toBe(true);
	});
});
