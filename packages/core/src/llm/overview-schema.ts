import { z } from "zod";

// LLM Overview (governed output)
//
// NOTE:
// - This schema is intended to be *guard/degrade friendly*.
// - Strings are allowed to degrade to "" and arrays to [] while still validating.
// - We enforce hard max lengths for safety; sentence-count guidance should be
//   handled in prompting + guard logic (not relied on here).

const MAX = {
	hero_header_chars: 900,
	deal_summary_hero_chars: 400,
	deal_summary_mid_chars: 1400,
	deal_summary_long_chars: 3600,
	investment_overview_chars: 2400,
	bullet_chars: 320,
	strengths_bullets: 6,
	concerns_bullets: 8,
	coverage_gaps_bullets: 12,
	citations: 80,
	quality_flags: 24,
	evidence_id_chars: 96,
	slide_title_chars: 160,
};

export const LlmOverviewV1CitationSchema = z
	.object({
		page: z.number().int().nonnegative().optional(),
		slide_title: z.string().max(MAX.slide_title_chars).optional(),
		evidence_id: z.string().max(MAX.evidence_id_chars).optional(),
	})
	.strict();

const BoundedString = (max: number) => z.string().max(max);

const BulletString = () => BoundedString(MAX.bullet_chars);

export const LlmOverviewV1Schema = z
	.object({
		version: z.literal("llm_overview_v1"),

		// 2–4 sentences max (guidance via prompt/guard)
		hero_header: BoundedString(MAX.hero_header_chars),

		deal_summary: z
			.object({
				// 1 sentence (guidance via prompt/guard)
				hero: BoundedString(MAX.deal_summary_hero_chars),
				// ~3–5 sentences
				mid: BoundedString(MAX.deal_summary_mid_chars),
				// ~8–12 sentences
				long: BoundedString(MAX.deal_summary_long_chars),
			})
			.strict(),

		// 4–8 sentences, investor memo tone
		investment_analysis_overview: BoundedString(MAX.investment_overview_chars),

		strengths_overlay: z.array(BulletString()).max(MAX.strengths_bullets).default([]),
		concerns_overlay: z.array(BulletString()).max(MAX.concerns_bullets).default([]),
		coverage_gaps_overlay: z.array(BulletString()).max(MAX.coverage_gaps_bullets).default([]),

		// Optional global citations used
		citations: z.array(LlmOverviewV1CitationSchema).max(MAX.citations).default([]),

		// Include "guard_degraded" when degraded
		quality_flags: z.array(z.string().max(64)).max(MAX.quality_flags).default([]),
	})
	.strict();

export type LlmOverviewV1 = z.infer<typeof LlmOverviewV1Schema>;
