/**
 * narrative-contradiction-v1.ts — PR36.9
 *
 * Schema types for topic-level narrative contradiction detection.
 *
 * Design contract:
 *  - Pure type module: no logic, no imports.
 *  - Compact and deterministic — each field has a single unambiguous meaning.
 *  - Used by narrative-contradiction-detector.ts (detection logic) and
 *    by narrative-evidence-ranking.ts (bundle selection output).
 *  - Consumed downstream by llm-interpretation-v1.ts corpus builder and
 *    governed-summary-v1.ts / governed-executive-summary-v1.ts.
 */

import type { NarrativeTopic } from "./narrative-evidence-ranking.js";

// Re-export NarrativeTopic so consumers can import from a single schema file.
export type { NarrativeTopic };

// ─── Contradiction status ─────────────────────────────────────────────────────

/**
 * Three-level contradiction classification:
 *
 *  none        — No meaningful disagreement detected between candidates.
 *                The topic has a clear primary signal with no material conflict.
 *
 *  mixed       — Multiple candidates are mutually compatible but frame the topic
 *                differently. Both interpretations might be true.
 *                (e.g. direct sales AND a partner channel both visible)
 *                → LLM should qualify language, not flatten.
 *
 *  conflicting — Candidates present materially incompatible claims.
 *                (e.g. "$5M ARR" vs "$200K ARR", "marketplace" vs "SaaS tool")
 *                → LLM must NOT write a settled claim. Surface both interpretations.
 */
export type NarrativeContradictionStatus = "none" | "mixed" | "conflicting";

// ─── Contradiction reason codes ───────────────────────────────────────────────

/**
 * Reason code identifying the category of disagreement detected.
 *
 *  semantic_divergence        — Candidates describe materially different meanings,
 *                               qualities, or framings of the same topic.
 *                               (e.g. two different product functionality claims)
 *
 *  numeric_divergence         — Two numeric signals in the same financial context
 *                               differ by 3× or more (e.g. two ARR figures).
 *
 *  stage_vs_metric_divergence — One candidate implies pre-revenue/early stage
 *                               while another references post-revenue metrics.
 *
 *  category_divergence        — Candidates imply mutually exclusive product or
 *                               market categories
 *                               (e.g. "marketplace" vs "SaaS automation tool").
 *
 *  source_divergence          — Structurally different sources (e.g. structured
 *                               financial statement vs OCR page) produce
 *                               incompatible claims.
 *
 *  insufficient_overlap       — Candidates address different sub-topics so well
 *                               that meaningful comparison cannot be made.
 *                               Used to label mixed status when direct comparison
 *                               is not possible.
 */
export type NarrativeContradictionReason =
	| "semantic_divergence"
	| "numeric_divergence"
	| "stage_vs_metric_divergence"
	| "category_divergence"
	| "source_divergence"
	| "insufficient_overlap";

// ─── Core contradiction record ────────────────────────────────────────────────

/**
 * A single narrative contradiction detection result for one topic.
 *
 * When status = "none", reason is null and secondary_texts / notes are empty.
 * When status = "mixed" or "conflicting", reason and notes explain why.
 */
export interface NarrativeContradictionV1 {
	/** Which narrative topic this contradiction record covers. */
	topic: NarrativeTopic;
	/** Classification of the disagreement severity. */
	status: NarrativeContradictionStatus;
	/** Why the conflict was detected. null when status = "none". */
	reason: NarrativeContradictionReason | null;
	/** The best-ranked candidate text (primary evidence). */
	primary_text: string;
	/** Other qualified candidate texts that conflict with or diverge from the primary. */
	secondary_texts: string[];
	/** Human-readable notes explaining the contradiction for the LLM / downstream logic. */
	notes: string[];
}

// ─── Bundle of topic contradictions assembled by the pipeline ─────────────────

/**
 * A bundle of contradiction records for all topics detected in a single
 * pipeline run. null values indicate the topic was not processed or had
 * no candidates above the minimum quality threshold.
 */
export interface NarrativeContradictionBundle {
	product_differentiation?: NarrativeContradictionV1 | null;
	go_to_market_strategy?: NarrativeContradictionV1 | null;
	market_position?: NarrativeContradictionV1 | null;
	financial_outlook?: NarrativeContradictionV1 | null;
	capital_and_raise?: NarrativeContradictionV1 | null;
	traction?: NarrativeContradictionV1 | null;
	business_quality?: NarrativeContradictionV1 | null;
}

// ─── Bundle selection output (Phase 3) ───────────────────────────────────────

/**
 * The result of selecting ranked narrative candidates WITH contradiction context.
 *
 * Returned by `buildProductNarrativeBundle`, `buildProductSignalsBundleSection`,
 * and `buildGtmSignalsBundleSection` after Phase 3 — adds contradiction data
 * alongside the combined selectedText for LLM/corpus use.
 */
export interface RankedNarrativeBundle {
	/** Combined text of the top qualifying candidates (null if none qualify). */
	selectedText: string | null;
	/** Contradiction detection result for this topic. null if < 2 qualified candidates. */
	contradiction: NarrativeContradictionV1 | null;
}

// ─── Serialized section body ──────────────────────────────────────────────────

/**
 * Serialize a NarrativeContradictionBundle into a compact corpus section body.
 *
 * Only conflicting and mixed topics are emitted — "none" topics are silently
 * omitted to keep the corpus clean.
 *
 * Format example:
 *
 *   product_differentiation: status=CONFLICTING reason=category_divergence
 *     [primary] "StackFactor automates due diligence workflows..."
 *     [runner-up] "StackFactor is a marketplace connecting investors..."
 *     note: Candidates imply mutually exclusive product categories.
 *           Do NOT write a single settled claim.
 *
 * Returns null when all topics are "none" (no contradiction present).
 */
export function serializeContradictionMarkersBody(
	bundle: NarrativeContradictionBundle | null | undefined,
): string | null {
	if (!bundle) return null;

	const lines: string[] = [];

	for (const [_topicStr, rec] of Object.entries(bundle)) {
		if (!rec || rec.status === "none") continue;
		const topicLabel = rec.topic;
		const statusLabel = rec.status.toUpperCase();
		const reasonLabel = rec.reason ?? "unknown";

		lines.push(`${topicLabel}: status=${statusLabel} reason=${reasonLabel}`);

		const primaryExcerpt = rec.primary_text.slice(0, 200).replace(/\n/g, " ");
		lines.push(`  [primary] "${primaryExcerpt}"`);

		for (const sec of rec.secondary_texts.slice(0, 2)) {
			const secExcerpt = sec.slice(0, 200).replace(/\n/g, " ");
			lines.push(`  [runner-up] "${secExcerpt}"`);
		}

		for (const note of rec.notes) {
			lines.push(`  note: ${note}`);
		}

		lines.push("");
	}

	if (lines.length === 0) return null;

	return lines.join("\n").trimEnd();
}

// ─── Suppression helpers (Phase 6) ───────────────────────────────────────────

/**
 * Returns true when a topic's contradiction status is severe enough that
 * it should be suppressed from hero/overview highlight surfaces.
 *
 * "conflicting" topics should never appear as confident settled claims in
 * hero summaries or overview cards.
 */
export function shouldSuppressTopicFromHero(
	rec: NarrativeContradictionV1 | null | undefined,
): boolean {
	return rec?.status === "conflicting";
}

/**
 * Returns true when a topic has any contradiction signal (mixed or conflicting).
 * Use this to decide whether to qualify rather than suppress.
 */
export function hasTopicContradiction(
	rec: NarrativeContradictionV1 | null | undefined,
): boolean {
	return !!rec && rec.status !== "none";
}
