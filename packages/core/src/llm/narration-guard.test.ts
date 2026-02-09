import { degradeNarrationV1, validateNoNewFacts } from "./narration-guard";

const baseExcerpt = {
	structured_summary: {
		kpis: {
			revenue: {
				value_raw: "$2.476M",
				source: { page: 1, slide_title: "Summary" },
			},
		},
		marketing_metrics: null,
	},
	deal_summary_v1: {
		version: "deal_summary_v1",
		one_liner: "Built in 2026.",
	},
	score_explanation: {
		understanding_v1: {
			summary: "Some grounded summary.",
			strengths: [],
			execution_dependencies: [],
			diligence_open_items: [],
		},
	},
	citations: { total_sources: 3, unique_pages: 2 },
} as const;

describe("validateNoNewFacts", () => {
	it("ok: insight title may include a new entity token (title is not entity-gated)", () => {
		const narration: any = {
			version: "llm_narration_v1",
			summary: "Grounded summary.",
			sections: [],
			insights: [
				{
					title: "Notion: underwriting follow-up",
					claim: "This may indicate a need for deeper diligence on collaboration tooling assumptions.",
					tier: "hypothesis",
					confidence: "low",
					evidence_basis: "no_evidence",
					basis: [],
					what_would_change_my_mind: "What I'd need to see next is a cited excerpt that references the specific tooling and adoption assumptions.",
				},
			],
			suggestions: { gaps: [], questions: [] },
			quality_flags: [],
		};

		const res = validateNoNewFacts({ reportExcerpt: baseExcerpt, narration });
		expect(res.ok).toBe(true);
		expect(res.violations.some((v) => v.path === "narration.insights[0].title" && v.code === "entity.new_not_in_excerpt")).toBe(false);
	});

	it("rejects: insight claim is entity-gated (new entity token should fail)", () => {
		const narration: any = {
			version: "llm_narration_v1",
			summary: "Grounded summary.",
			sections: [],
			insights: [
				{
					title: "Operational risk",
					claim: "The team uses Notion, but that is not present in the excerpt.",
					tier: "hypothesis",
					confidence: "low",
					evidence_basis: "no_evidence",
					basis: [],
					what_would_change_my_mind: "What I'd need to see next is a cited excerpt that confirms the tooling stack and dependency risk.",
				},
			],
			suggestions: { gaps: [], questions: [] },
			quality_flags: [],
		};

		const res = validateNoNewFacts({ reportExcerpt: baseExcerpt, narration });
		expect(res.ok).toBe(false);
		expect(res.violations.some((v) => v.code === "entity.new_not_in_excerpt")).toBe(true);
	});

	it("rejects: implication insight must be cited", () => {
		const narration: any = {
			version: "llm_narration_v1",
			summary: "Grounded summary.",
			sections: [],
			insights: [
				{
					title: "Runway implication",
					claim: "This could imply the current burn profile is a key sensitivity for underwriting.",
					tier: "implication",
					confidence: "medium",
					evidence_basis: "no_evidence",
					basis: [],
					what_would_change_my_mind: "What I'd need to see next is a cited excerpt that quantifies burn and runway assumptions.",
				},
			],
			suggestions: { gaps: [], questions: [] },
			quality_flags: [],
		};

		const res = validateNoNewFacts({ reportExcerpt: baseExcerpt, narration });
		expect(res.ok).toBe(false);
		expect(res.violations.some((v) => v.code === "insight.tier.implication.citation_required" && v.path === "narration.insights[0]")).toBe(true);
	});

	it("rejects: hypothesis insight requires uncertainty marker", () => {
		const narration: any = {
			version: "llm_narration_v1",
			summary: "Grounded summary.",
			sections: [],
			insights: [
				{
					title: "Uncertainty required",
					claim: "This indicates a stronger retention profile.",
					tier: "hypothesis",
					confidence: "low",
					evidence_basis: "no_evidence",
					basis: [],
					what_would_change_my_mind: "What I'd need to see next is a cited excerpt with retention evidence.",
				},
			],
			suggestions: { gaps: [], questions: [] },
			quality_flags: [],
		};

		const res = validateNoNewFacts({ reportExcerpt: baseExcerpt, narration });
		expect(res.ok).toBe(false);
		expect(res.violations.some((v) => v.code === "insight.tier.hypothesis.uncertainty_required" && v.path === "narration.insights[0].claim")).toBe(true);
	});

	it("rejects: insight claim cannot introduce new numeric tokens", () => {
		const narration: any = {
			version: "llm_narration_v1",
			summary: "Grounded summary.",
			sections: [],
			insights: [
				{
					title: "Numeric gating",
					claim: "Revenue may be closer to $3.0M than the excerpt implies.",
					tier: "hypothesis",
					confidence: "low",
					evidence_basis: "no_evidence",
					basis: [],
					what_would_change_my_mind: "What I'd need to see next is a cited excerpt that supports the higher revenue figure.",
				},
			],
			suggestions: { gaps: [], questions: [] },
			quality_flags: [],
		};

		const res = validateNoNewFacts({ reportExcerpt: baseExcerpt, narration });
		expect(res.ok).toBe(false);
		expect(res.violations.some((v) => v.path === "narration.insights[0].claim" && v.code === "numeric_token.not_in_excerpt")).toBe(true);
	});

	it("ok: suggestion question containing 'will' does NOT trigger commitment.tier_b.citation_required", () => {
		const narration = {
			version: "llm_narration_v1",
			summary: "Grounded summary.",
			sections: [],
			suggestions: {
				gaps: [],
				questions: ["What will drive conversion improvements?"] ,
			},
			quality_flags: [],
		};

		const res = validateNoNewFacts({ reportExcerpt: baseExcerpt, narration });
		// Suggestions are prompts; commitment-tier enforcement should not apply.
		expect(res.violations.some((v) => v.code === "commitment.tier_b.citation_required")).toBe(false);
	});

	it("ok: suggestion gap rationale containing 'may' does NOT trigger inference.basis_required", () => {
		const narration = {
			version: "llm_narration_v1",
			summary: "Grounded summary.",
			sections: [],
			suggestions: {
				gaps: [{ key: "Diligence", rationale: "This may indicate a missing assumption to validate." }],
				questions: [],
			},
			quality_flags: [],
		};

		const res = validateNoNewFacts({ reportExcerpt: baseExcerpt, narration });
		// Suggestions are prompts; inference basis enforcement should not apply.
		expect(res.violations.some((v) => v.code === "inference.basis_required")).toBe(false);
	});

	it("rejects: section body containing 'will' still triggers commitment.tier_b.citation_required when uncited", () => {
		const narration = {
			version: "llm_narration_v1",
			summary: "Grounded summary.",
			sections: [
				{
					title: "Execution",
					body: "The team will execute quickly.",
					what_would_change_my_mind: "A cited excerpt showing execution dependencies or blockers.",
					evidence_basis: "cited",
					// Intentionally missing citations.
				},
			],
			suggestions: { gaps: [], questions: [] },
			quality_flags: [],
		};

		const res = validateNoNewFacts({ reportExcerpt: baseExcerpt, narration });
		expect(res.ok).toBe(false);
		expect(res.violations.some((v) => v.code === "commitment.tier_b.citation_required" && v.path === "narration.sections[0].body")).toBe(true);
	});

	it("rejects: section body containing 'may' still triggers inference.basis_required when uncited", () => {
		const narration = {
			version: "llm_narration_v1",
			summary: "Grounded summary.",
			sections: [
				{
					title: "Interpretation",
					body: "This may indicate a stronger retention profile.",
					what_would_change_my_mind: "A cited excerpt that supports or contradicts retention signals.",
					evidence_basis: "cited",
					// Intentionally missing citations.
				},
			],
			suggestions: { gaps: [], questions: [] },
			quality_flags: [],
		};

		const res = validateNoNewFacts({ reportExcerpt: baseExcerpt, narration });
		expect(res.ok).toBe(false);
		expect(res.violations.some((v) => v.code === "inference.basis_required" && v.path === "narration.sections[0].body")).toBe(true);
	});

	it("ok: passes when what_would_change_my_mind is present", () => {
		const narration = {
			version: "llm_narration_v1",
			summary: "Grounded summary.",
			sections: [
				{
					title: "Traction",
					body: "Built in 2026 per the excerpt.",
					what_would_change_my_mind: "A cited excerpt that changes the timeline.",
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

	it("rejects: missing what_would_change_my_mind yields section.decision_trigger.required", () => {
		const narration = {
			version: "llm_narration_v1",
			summary: "Grounded summary.",
			sections: [
				{
					title: "Traction",
					body: "Built in 2026 per the excerpt.",
					evidence_basis: "cited",
					citations: [{ page: 1, slide_title: "Summary" }],
				},
			],
			suggestions: { gaps: [], questions: [] },
			quality_flags: [],
		};

		const res = validateNoNewFacts({ reportExcerpt: baseExcerpt, narration });
		expect(res.ok).toBe(false);
		expect(res.violations.some((v) => v.code === "section.decision_trigger.required")).toBe(true);
	});

	it("ok: allows narration when numeric tokens are in excerpt and KPI tokens are cited", () => {
		const narration = {
			version: "llm_narration_v1",
			summary: "Grounded summary of the excerpt from 2026.",
			sections: [
				{
					title: "Traction",
					body: "The revenue discussion is grounded in the cited slide.",
					what_would_change_my_mind: "Provide a cited KPI slide that contradicts this interpretation.",
					citations: [{ page: 1, slide_title: "Summary" }],
					evidence_basis: "cited",
				},
			],
			suggestions: { gaps: [], questions: [] },
			quality_flags: [],
		};

		const res = validateNoNewFacts({ reportExcerpt: baseExcerpt, narration });
		expect(res.ok).toBe(true);
		expect(res.violations).toEqual([]);
	});

	it("rejects numeric tokens that do not exist in the allowlisted excerpt corpus", () => {
		const narration = {
			version: "llm_narration_v1",
			summary: "This claims 999 which is not in excerpt.",
			sections: [],
			suggestions: { gaps: [], questions: [] },
			quality_flags: [],
		};

		const res = validateNoNewFacts({ reportExcerpt: baseExcerpt, narration });
		expect(res.ok).toBe(false);
		expect(res.violations.some((v) => v.code === "numeric_token.not_in_excerpt")).toBe(true);
	});

	it("rejects KPI tokens in summary (no citations possible in summary)", () => {
		const narration = {
			version: "llm_narration_v1",
			summary: "Revenue appears strong.",
			sections: [],
			suggestions: { gaps: [], questions: [] },
			quality_flags: [],
		};

		const res = validateNoNewFacts({ reportExcerpt: baseExcerpt, narration });
		expect(res.ok).toBe(false);
		expect(res.violations.some((v) => v.code === "kpi_token.missing_citation")).toBe(true);
	});

	it("rejects KPI tokens in section body when no matching citation exists", () => {
		const narration = {
			version: "llm_narration_v1",
			summary: "Grounded summary.",
			sections: [
				{
					title: "Traction",
					body: "The company discusses revenue improvements.",
					citations: [{ page: 2, slide_title: "Other" }],
					evidence_basis: "cited",
				},
			],
			suggestions: { gaps: [], questions: [] },
			quality_flags: [],
		};

		const res = validateNoNewFacts({ reportExcerpt: baseExcerpt, narration });
		expect(res.ok).toBe(false);
		expect(res.violations.some((v) => v.code === "kpi_token.citation_required")).toBe(true);
	});

	it("rejects narration containing reserved keys (override attempts)", () => {
		const narration = {
			version: "llm_narration_v1",
			summary: "Grounded summary.",
			sections: [
				{
					title: "Note",
					body: "Do not change structured_summary in output.",
					what_would_change_my_mind: "Provide cited excerpt evidence to include this section.",
					evidence_basis: "no_evidence",
				},
			],
			suggestions: { gaps: [], questions: [] },
			quality_flags: [],
		};

		const res = validateNoNewFacts({ reportExcerpt: baseExcerpt, narration });
		expect(res.ok).toBe(false);
		expect(res.violations.some((v) => v.code === "override_attempt.contains_reserved_key")).toBe(true);
	});

	it("ok: excerpt contains $1.5MM and narration uses $1.5MM (exact token)", () => {
		const excerpt = {
			...baseExcerpt,
			structured_summary: {
				...baseExcerpt.structured_summary,
				kpis: {
					...baseExcerpt.structured_summary.kpis,
					revenue: {
						value_raw: "$1.5MM",
						source: { page: 1, slide_title: "Summary" },
					},
				},
			},
		};

		const narration = {
			version: "llm_narration_v1",
			summary: "Grounded summary.",
			sections: [
				{
					title: "Traction",
					body: "Revenue is $1.5MM per the cited slide.",
					what_would_change_my_mind: "Provide a cited slide showing a different revenue figure.",
					citations: [{ page: 1, slide_title: "Summary" }],
					evidence_basis: "cited",
				},
			],
			suggestions: { gaps: [], questions: [] },
			quality_flags: [],
		};

		const res = validateNoNewFacts({ reportExcerpt: excerpt, narration });
		expect(res.ok).toBe(true);
	});

	it("rejects: excerpt contains $1.5MM but narration uses $1.5M (MM != M)", () => {
		const excerpt = {
			...baseExcerpt,
			structured_summary: {
				...baseExcerpt.structured_summary,
				kpis: {
					...baseExcerpt.structured_summary.kpis,
					revenue: {
						value_raw: "$1.5MM",
						source: { page: 1, slide_title: "Summary" },
					},
				},
			},
		};

		const narration = {
			version: "llm_narration_v1",
			summary: "Grounded summary.",
			sections: [
				{
					title: "Traction",
					body: "Revenue is $1.5M per the cited slide.",
					what_would_change_my_mind: "Provide a cited slide with the exact token '$1.5M'.",
					citations: [{ page: 1, slide_title: "Summary" }],
					evidence_basis: "cited",
				},
			],
			suggestions: { gaps: [], questions: [] },
			quality_flags: [],
		};

		const res = validateNoNewFacts({ reportExcerpt: excerpt, narration });
		expect(res.ok).toBe(false);
		expect(res.violations.some((v) => v.code === "numeric_token.not_in_excerpt")).toBe(true);
	});

	it("ok: allows inference language when a citation basis is present", () => {
		const narration = {
			version: "llm_narration_v1",
			summary: "Grounded summary.",
			sections: [
				{
					title: "Interpretation",
					body: "This suggests the story is coherent based on the cited slide.",
					what_would_change_my_mind: "A cited excerpt that contradicts this interpretation.",
					citations: [{ page: 1, slide_title: "Summary" }],
					evidence_basis: "cited",
				},
			],
			suggestions: { gaps: [], questions: [] },
			quality_flags: [],
		};

		const res = validateNoNewFacts({ reportExcerpt: baseExcerpt, narration });
		expect(res.ok).toBe(true);
	});

	it("rejects: inference language without citations (basis_required)", () => {
		const narration = {
			version: "llm_narration_v1",
			summary: "Grounded summary.",
			sections: [
				{
					title: "Interpretation",
					body: "This suggests the story is coherent.",
					what_would_change_my_mind: "A cited excerpt that contradicts this interpretation.",
					evidence_basis: "no_evidence",
				},
			],
			suggestions: { gaps: [], questions: [] },
			quality_flags: [],
		};

		const res = validateNoNewFacts({ reportExcerpt: baseExcerpt, narration });
		expect(res.ok).toBe(false);
		expect(res.violations.some((v) => v.code === "inference.basis_required")).toBe(true);
	});

	it("rejects: new named entity not present verbatim in excerpt", () => {
		const narration = {
			version: "llm_narration_v1",
			summary: "Grounded summary.",
			sections: [
				{
					title: "Competition",
					body: "Acme Corp appears to be a direct competitor.",
					what_would_change_my_mind: "A cited excerpt showing competitor names and positioning.",
					evidence_basis: "cited",
				},
			],
			suggestions: { gaps: [], questions: [] },
			quality_flags: [],
		};

		const res = validateNoNewFacts({ reportExcerpt: baseExcerpt, narration });
		expect(res.ok).toBe(false);
		expect(res.violations.some((v) => v.code === "entity.new_not_in_excerpt")).toBe(true);
	});

	it("rejects: real brand/entity not in excerpt triggers entity violation", () => {
		const narration = {
			version: "llm_narration_v1",
			summary: "Grounded summary.",
			sections: [
				{
					title: "Ops tooling",
					body: "The team uses Notion for internal documentation.",
					what_would_change_my_mind: "A cited excerpt that lists internal tooling explicitly.",
					citations: [{ page: 1, slide_title: "Summary" }],
					evidence_basis: "cited",
				},
			],
			suggestions: { gaps: [], questions: [] },
			quality_flags: [],
		};

		const res = validateNoNewFacts({ reportExcerpt: baseExcerpt, narration });
		expect(res.ok).toBe(false);
		expect(res.violations.some((v) => v.code === "entity.new_not_in_excerpt")).toBe(true);
	});

	it("ok: section title 'Customer Base' does not trigger entity gating", () => {
		const narration = {
			version: "llm_narration_v1",
			summary: "Grounded summary.",
			sections: [
				{
					title: "Customer Base",
					body: "Additional diligence items are listed without naming new entities.",
					what_would_change_my_mind: "Provide cited excerpt evidence that resolves these open items.",
					evidence_basis: "cited",
				},
			],
			suggestions: { gaps: [], questions: [] },
			quality_flags: [],
		};

		const res = validateNoNewFacts({ reportExcerpt: baseExcerpt, narration });
		expect(res.ok).toBe(true);
	});

	it("ok: suggestion mentioning 'runway' passes when deterministic diligence_open_items contains 'runway'", () => {
		const excerpt = {
			...baseExcerpt,
			score_explanation: {
				...baseExcerpt.score_explanation,
				understanding_v1: {
					...baseExcerpt.score_explanation.understanding_v1,
					diligence_open_items: [
						{ text: "Clarify cash runway assumptions.", evidence_ids: [], component_keys: [] },
					],
				},
			},
		};

		const narration = {
			version: "llm_narration_v1",
			summary: "Grounded summary.",
			sections: [],
			suggestions: {
				gaps: [{ key: "Financial diligence", rationale: "Clarify runway assumptions and inputs." }],
				questions: ["What is the runway based on current burn?"] ,
			},
			quality_flags: [],
		};

		const res = validateNoNewFacts({ reportExcerpt: excerpt, narration });
		expect(res.ok).toBe(true);
	});

	it("rejects: suggestion mentioning KPI token fails when token appears nowhere in deterministic excerpt and has no citation", () => {
		const narration = {
			version: "llm_narration_v1",
			summary: "Grounded summary.",
			sections: [],
			suggestions: {
				gaps: [{ key: "Unit economics", rationale: "Clarify CAC assumptions." }],
				questions: ["What is CAC?"] ,
			},
			quality_flags: [],
		};

		const res = validateNoNewFacts({ reportExcerpt: baseExcerpt, narration });
		expect(res.ok).toBe(false);
		expect(res.violations.some((v) => v.code === "kpi_token.missing_citation")).toBe(true);
	});

	it("rejects: new entity in summary still triggers entity gating", () => {
		const narration = {
			version: "llm_narration_v1",
			summary: "The team uses Notion for internal documentation.",
			sections: [],
			suggestions: { gaps: [], questions: [] },
			quality_flags: [],
		};

		const res = validateNoNewFacts({ reportExcerpt: baseExcerpt, narration });
		expect(res.ok).toBe(false);
		expect(res.violations.some((v) => v.code === "entity.new_not_in_excerpt" && v.path === "narration.summary")).toBe(true);
	});

	it("ok: sentence-start Title Case false positives do not trigger entity violations", () => {
		const narration = {
			version: "llm_narration_v1",
			summary: "Grounded summary.",
			sections: [
				{
					title: "Open questions",
					body: "Further diligence is needed to validate assumptions and risks.",
					what_would_change_my_mind: "A cited excerpt that resolves the key diligence questions.",
					citations: [{ page: 1, slide_title: "Summary" }],
					evidence_basis: "cited",
				},
			],
			suggestions: { gaps: [], questions: [] },
			quality_flags: [],
		};

		const res = validateNoNewFacts({ reportExcerpt: baseExcerpt, narration });
		expect(res.ok).toBe(true);
		expect(res.violations).toEqual([]);
	});

	it("ok: 'Series A' does not trigger entity violations", () => {
		const narration = {
			version: "llm_narration_v1",
			summary: "Grounded summary.",
			sections: [
				{
					title: "Raise",
					body: "This is a Series A raise.",
					what_would_change_my_mind: "A cited excerpt that clarifies the fundraising round and terms.",
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

	it("Tier B commitments require citation; Tier C commitments do not", () => {
		const tierBNoCitation = {
			version: "llm_narration_v1",
			summary: "Grounded summary.",
			sections: [
				{
					title: "Execution",
					body: "The team will execute well.",
					what_would_change_my_mind: "A cited excerpt showing execution dependencies or blockers.",
					evidence_basis: "cited",
				},
			],
			suggestions: { gaps: [], questions: [] },
			quality_flags: [],
		};

		const resB = validateNoNewFacts({ reportExcerpt: baseExcerpt, narration: tierBNoCitation });
		expect(resB.ok).toBe(false);
		expect(resB.violations.some((v) => v.code === "commitment.tier_b.citation_required")).toBe(true);

		const tierCNoCitation = {
			version: "llm_narration_v1",
			summary: "Grounded summary.",
			sections: [
				{
					title: "Execution",
					body: "The team can execute well.",
					what_would_change_my_mind: "A cited excerpt showing execution dependencies or blockers.",
					evidence_basis: "cited",
				},
			],
			suggestions: { gaps: [], questions: [] },
			quality_flags: [],
		};

		const resC = validateNoNewFacts({ reportExcerpt: baseExcerpt, narration: tierCNoCitation });
		expect(resC.ok).toBe(true);
	});

	it("degrades: keeps valid sections and replaces invalid ones with no_evidence placeholders", () => {
		const narration = {
			version: "llm_narration_v1",
			summary: "Grounded summary.",
			sections: [
				{
					title: "Valid",
					body: "Built in 2026 per the excerpt.",
					what_would_change_my_mind: "A cited excerpt that changes the timeline.",
					evidence_basis: "cited",
					citations: [{ page: 1, slide_title: "Summary" }],
				},
				{
					title: "Invalid",
					body: "Acme Corp is clearly the market leader.",
					what_would_change_my_mind: "A cited excerpt that supports this claim.",
					evidence_basis: "cited",
				},
			],
			suggestions: { gaps: [], questions: [] },
			quality_flags: [],
		};

		const res = validateNoNewFacts({ reportExcerpt: baseExcerpt, narration });
		expect(res.ok).toBe(false);

		const degraded = degradeNarrationV1({ narration: narration as any, violations: res.violations });
		expect(degraded.degraded).toBe(true);
		expect(degraded.invalid_sections).toBeGreaterThan(0);
		expect(degraded.narration.sections[0].title).toBe("Valid");
		expect(degraded.narration.sections[0].body).toContain("2026");
		expect(degraded.narration.sections[1].evidence_basis).toBe("no_evidence");
		expect(degraded.narration.sections[1].body).toContain("withheld");
	});

	it("rejects: restatement insight requires citations (basis)", () => {
		const narration = {
			version: "llm_narration_v1",
			summary: "Grounded summary.",
			sections: [],
			insights: [
				{
					title: "Restatement",
					claim: "Built in 2026 per the excerpt.",
					tier: "restatement",
					confidence: "high",
					evidence_basis: "cited",
					basis: [],
					what_would_change_my_mind: "Provide a cited excerpt that contradicts the timeline.",
				},
			],
			suggestions: { gaps: [], questions: [] },
			quality_flags: [],
		};

		const res = validateNoNewFacts({ reportExcerpt: baseExcerpt, narration });
		expect(res.ok).toBe(false);
		expect(res.violations.some((v) => v.code === "insight.tier.restatement.citation_required")).toBe(true);
	});

	it("rejects: hypothesis insight requires uncertainty marker", () => {
		const narration = {
			version: "llm_narration_v1",
			summary: "Grounded summary.",
			sections: [],
			insights: [
				{
					title: "Hypothesis",
					claim: "This indicates a stronger retention profile.",
					tier: "hypothesis",
					confidence: "low",
					evidence_basis: "no_evidence",
					basis: [],
					what_would_change_my_mind: "What I'd need to see next is a cited excerpt with retention cohort data.",
				},
			],
			suggestions: { gaps: [], questions: [] },
			quality_flags: [],
		};

		const res = validateNoNewFacts({ reportExcerpt: baseExcerpt, narration });
		expect(res.ok).toBe(false);
		expect(res.violations.some((v) => v.code === "insight.tier.hypothesis.uncertainty_required")).toBe(true);
	});

	it("degrades: drops invalid insights but does not degrade sections", () => {
		const narration = {
			version: "llm_narration_v1",
			summary: "Grounded summary.",
			sections: [
				{
					title: "Valid",
					body: "Built in 2026 per the excerpt.",
					what_would_change_my_mind: "A cited excerpt that changes the timeline.",
					evidence_basis: "cited",
					citations: [{ page: 1, slide_title: "Summary" }],
				},
			],
			insights: [
				{
					title: "Restatement",
					claim: "Built in 2026 per the excerpt.",
					tier: "restatement",
					confidence: "high",
					evidence_basis: "cited",
					basis: [],
					what_would_change_my_mind: "Provide a cited excerpt that contradicts the timeline.",
				},
			],
			suggestions: { gaps: [], questions: [] },
			quality_flags: [],
		};

		const res = validateNoNewFacts({ reportExcerpt: baseExcerpt, narration });
		expect(res.ok).toBe(false);

		const degraded = degradeNarrationV1({ narration: narration as any, violations: res.violations });
		expect(degraded.degraded).toBe(true);
		expect(degraded.invalid_sections).toBe(0);
		expect((degraded as any).dropped_insights ?? 0).toBe(1);
		expect(degraded.narration.sections[0].title).toBe("Valid");
		expect(Array.isArray((degraded.narration as any).insights)).toBe(true);
		expect(((degraded.narration as any).insights as any[]).length).toBe(0);
	});
});
