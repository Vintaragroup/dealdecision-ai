import { z } from "zod";

const LlmNarrationV1Citation = z
	.object({
		page: z.number().optional(),
		slide_title: z.string().optional(),
		evidence_id: z.string().optional(),
	})
	.strict();

const LlmNarrationV1Section = z
	.object({
		title: z.string(),
		body: z.string(),
		what_would_change_my_mind: z.string().min(1),
		citations: z.array(LlmNarrationV1Citation).optional(),
		evidence_basis: z.enum(["cited", "no_evidence"]),
	})
	.strict();

const LlmNarrationV1Insight = z
	.object({
		title: z.string(),
		claim: z.string(),
		tier: z.enum(["restatement", "implication", "hypothesis"]),
		confidence: z.enum(["low", "medium", "high"]),
		basis: z.array(LlmNarrationV1Citation).optional().default([]),
		evidence_basis: z.enum(["cited", "no_evidence"]),
		what_would_change_my_mind: z.string().min(1),
	})
	.strict();

const LlmNarrationV1Gap = z
	.object({
		key: z.string(),
		rationale: z.string(),
	})
	.strict();

const LlmNarrationV1Suggestions = z
	.object({
		gaps: z.array(LlmNarrationV1Gap),
		questions: z.array(z.string()),
	})
	.strict();

export const LlmNarrationV1Schema = z
	.object({
		version: z.literal("llm_narration_v1"),
		summary: z.string(),
		sections: z.array(LlmNarrationV1Section),
		insights: z.array(LlmNarrationV1Insight).max(6).optional().default([]),
		suggestions: LlmNarrationV1Suggestions,
		quality_flags: z.array(z.string()),
	})
	.strict();

export type LlmNarrationV1 = z.infer<typeof LlmNarrationV1Schema>;

// NOTE: Keep the schema name explicit (`*Schema`) to avoid value/type name collisions in TS.
