import { validateNoNewFacts } from "../narration-guard";

// Keep the legacy suite running (the bulk of tests live here).
import "../narration-guard.test";

const baseExcerpt = {
	structured_summary: {
		kpis: {},
		issues: [],
	},
	deal_summary_v1: { version: "deal_summary_v1", one_liner: "Built in 2026." },
	score_explanation: {
		understanding_v1: {
			summary: "Some grounded summary.",
			strengths: [],
			execution_dependencies: [],
			diligence_open_items: [],
		},
	},
	citations: { total_sources: 1, unique_pages: 1 },
} as const;

describe("validateNoNewFacts (regressions: titles + suggestion KPI tokens)", () => {
	it("ok: 'Continued' in section body does not trigger entity gating", () => {
		const narration = {
			version: "llm_narration_v1",
			summary: "Grounded summary.",
			sections: [
				{
					title: "Overview",
					body: "Product positioning (Continued) is consistent with the excerpt.",
					what_would_change_my_mind: "Provide cited excerpt evidence that contradicts the positioning.",
					evidence_basis: "cited",
					citations: [{ page: 1, slide_title: "Summary" }],
				},
			],
			suggestions: { gaps: [], questions: [] },
			quality_flags: [],
		};

		const res = validateNoNewFacts({ reportExcerpt: baseExcerpt, narration });
		expect(res.ok).toBe(true);
		expect(res.violations.some((v) => v.code === "entity.new_not_in_excerpt")).toBe(false);
	});

	it("rejects: real new entity 'Notion' still triggers entity.new_not_in_excerpt", () => {
		const narration = {
			version: "llm_narration_v1",
			summary: "Grounded summary.",
			sections: [
				{
					title: "Notes",
					body: "Notion appears in the narrative but is not in the excerpt.",
					what_would_change_my_mind: "Provide cited excerpt evidence that mentions Notion.",
					evidence_basis: "cited",
					citations: [{ page: 1, slide_title: "Summary" }],
				},
			],
			suggestions: { gaps: [], questions: [] },
			quality_flags: [],
		};

		const res = validateNoNewFacts({ reportExcerpt: baseExcerpt, narration });
		expect(res.ok).toBe(false);
		expect(res.violations.some((v) => v.code === "entity.new_not_in_excerpt")).toBe(true);
	});

	it("ok: section titles 'Customer Base' and 'Business Model' do not trigger entity gating", () => {
		const narration = {
			version: "llm_narration_v1",
			summary: "Grounded summary.",
			sections: [
				{
					title: "Customer Base",
					body: "This section is grounded and does not introduce new named entities.",
					what_would_change_my_mind: "Provide cited excerpt evidence that specifies customer composition.",
					evidence_basis: "cited",
					citations: [{ page: 1, slide_title: "Summary" }],
				},
				{
					title: "Business Model",
					body: "This section is grounded and does not introduce new named entities.",
					what_would_change_my_mind: "Provide cited excerpt evidence that contradicts the described model.",
					evidence_basis: "cited",
					citations: [{ page: 1, slide_title: "Summary" }],
				},
			],
			suggestions: { gaps: [], questions: [] },
			quality_flags: [],
		};

		const res = validateNoNewFacts({ reportExcerpt: baseExcerpt, narration });
		expect(res.ok).toBe(true);
	});

	it("ok: suggestions mentioning 'runway' and 'burn' pass when deterministic diligence_open_items contain those tokens", () => {
		const excerpt = {
			...baseExcerpt,
			score_explanation: {
				...baseExcerpt.score_explanation,
				understanding_v1: {
					...baseExcerpt.score_explanation.understanding_v1,
					diligence_open_items: [
						{ text: "Clarify cash runway and burn assumptions.", evidence_ids: [], component_keys: [] },
					],
				},
			},
		};

		const narration = {
			version: "llm_narration_v1",
			summary: "Grounded summary.",
			sections: [],
			suggestions: {
				gaps: [{ key: "Financial diligence", rationale: "Clarify runway and burn assumptions." }],
				questions: ["What is the runway based on current burn?"] ,
			},
			quality_flags: [],
		};

		const res = validateNoNewFacts({ reportExcerpt: excerpt, narration });
		expect(res.ok).toBe(true);
	});

	it("rejects: suggestions mentioning 'MOIC' still fail unless cited", () => {
		const excerpt = {
			...baseExcerpt,
			score_explanation: {
				...baseExcerpt.score_explanation,
				understanding_v1: {
					...baseExcerpt.score_explanation.understanding_v1,
					diligence_open_items: [
						{ text: "Confirm runway assumptions.", evidence_ids: [], component_keys: [] },
					],
				},
			},
		};

		const narration = {
			version: "llm_narration_v1",
			summary: "Grounded summary.",
			sections: [],
			suggestions: {
				gaps: [{ key: "Returns", rationale: "Clarify MOIC expectations." }],
				questions: ["What MOIC is assumed?"] ,
			},
			quality_flags: [],
		};

		const res = validateNoNewFacts({ reportExcerpt: excerpt, narration });
		expect(res.ok).toBe(false);
		expect(res.violations.some((v) => v.code === "kpi_token.missing_citation")).toBe(true);
	});
});
