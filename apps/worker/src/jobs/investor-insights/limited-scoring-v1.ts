/**
 * Limited Scoring MVP — Conservative, deterministic, evidence-grounded.
 *
 * Four categories:
 *   A. Completeness / Deal Readiness
 *   B. Deal Terms
 *   C. Traction Existence Signal
 *   D. Market Sizing Presence
 *
 * Design principles:
 *   - "Not scoreable yet" preferred over weak guesses.
 *   - Every score exposes contributing facts in notes.
 *   - Pure synchronous function — no LLM, no DB, no side effects.
 *   - Plausibility guards reject implausible monetary values.
 *   - Same inputs always produce the same output (deterministic).
 *
 * Categories intentionally deferred to future scoring phases:
 *   team, product_quality, business_model_quality, go_to_market_quality,
 *   full_financial_health, comparative_ranking.
 */

import type { FinancialFactV1 } from "@dealdecision/core";
import type { InsightSlotInputs, ThesisInputsV1 } from "./stages/stage-2-deterministic";
import { extractPhase2Result } from "./stages/stage-2-deterministic";
import type { RenderPackage } from "../../contracts/investor-insights/schemas";

// ─── Output type ──────────────────────────────────────────────────────────────

export interface LimitedScoringV1 {
	schema_version: "limited_scoring_v1";
	// Category A: Completeness / Deal Readiness
	completeness_score: number | null;
	completeness_confidence: "high" | "medium" | "low";
	completeness_notes: string[];
	// Category B: Deal Terms
	deal_terms_score: number | null;
	deal_terms_confidence: "high" | "medium" | "low";
	deal_terms_notes: string[];
	// Category C: Traction Existence Signal
	traction_signal_score: number | null;
	traction_signal_confidence: "high" | "medium" | "low";
	traction_signal_notes: string[];
	// Category D: Market Sizing Presence
	market_presence_score: number | null;
	market_presence_confidence: "high" | "medium" | "low";
	market_presence_notes: string[];
	// Aggregate
	overall_limited_score: number | null;
	scoring_confidence: "high" | "medium" | "low" | "not_scoreable";
	scoring_notes: string[];
	/** Categories excluded from this MVP pass — listed for transparency. */
	deferred_categories: string[];
	scored_at: string;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

interface CategoryScore {
	score: number | null;
	confidence: "high" | "medium" | "low";
	notes: string[];
}

/**
 * Parse a money string like "$2M", "$500K", "$1.5B", "$5.6MM", "€10B"
 * to a base dollar value.  Returns null on parse failure.
 */
export function parseMoneyString(s: string | null | undefined): number | null {
	if (!s) return null;
	// Match: optional currency prefix, number, optional magnitude suffix
	// Handles: $, €, £, USD, EUR, GBP, and MM/BB double-letter suffixes
	const m =
		/(?:\$|€|£|USD|EUR|GBP)?\s*([\d,]+(?:\.\d+)?)\s*(MM|BB|[KkMmBbTt])?(?:\b|$)/i.exec(
			s.replace(/,/g, "")
		);
	if (!m || !m[1]) return null;
	const raw = parseFloat(m[1].replace(/,/g, ""));
	if (!isFinite(raw) || raw <= 0) return null;
	const suffix = (m[2] ?? "").toUpperCase();
	const multipliers: Record<string, number> = {
		K: 1e3,
		M: 1e6,
		MM: 1e6,
		B: 1e9,
		BB: 1e9,
		T: 1e12,
	};
	return raw * (multipliers[suffix] ?? 1);
}

/**
 * Raise amounts must be between $100K and $500M to be a plausible seed/early-stage capital raise.
 * Rejects micro-amounts ($100, $50K) and implausibly large amounts ($1B+ raises).
 */
export function isRaiseAmountPlausible(s: string | null | undefined): boolean {
	const v = parseMoneyString(s);
	if (v === null) return false;
	return v >= 100_000 && v <= 500_000_000;
}

/**
 * Market sizing values (TAM/SAM/SOM) must be between $10M and $100T.
 * Rejects implausibly small markets ($1M TAM) and clearly bogus figures ($999T).
 */
export function isMarketValuePlausible(s: string | null | undefined): boolean {
	const v = parseMoneyString(s);
	if (v === null) return false;
	return v >= 10_000_000 && v <= 100_000_000_000_000;
}

// ─── Category A: Completeness / Deal Readiness ────────────────────────────────

const COMPLETENESS_CATEGORIES = [
	"raise_terms",
	"valuation_terms",
	"use_of_funds",
	"market_claims",
	"traction_signal",
] as const;

/**
 * Score = 20 pts per present category (max 100).
 * "Conflicting" counts as Present (data exists, even if ambiguous).
 * Conflict deduction: −10 when cross-page conflicts detected.
 * Confidence tied to coverage_ratio.
 */
function scoreCompleteness(thesis: ThesisInputsV1): CategoryScore {
	const notes: string[] = [];
	let raw = 0;

	for (const cat of COMPLETENESS_CATEGORIES) {
		const row = thesis.completeness.find((r) => r.category === cat);
		const status = row?.status ?? "Missing";
		if (status === "Present" || status === "Conflicting") {
			raw += 20;
			notes.push(`${cat}: ${status}`);
		} else {
			notes.push(`${cat}: Missing`);
		}
	}

	if (thesis.conflicts_present) {
		raw = Math.max(0, raw - 10);
		notes.push("conflict_deduction: −10 (cross-page conflicts detected)");
	}

	const score = Math.round(Math.min(100, Math.max(0, raw)));
	const coverage = thesis.coverage_ratio;
	const confidence: "high" | "medium" | "low" =
		coverage >= 0.7 ? "high" : coverage >= 0.5 ? "medium" : "low";

	return { score, confidence, notes };
}

// ─── Category B: Deal Terms ────────────────────────────────────────────────────

/**
 * Scores raise clarity: amount (40), round (30), instrument (20), valuation (10).
 * raise_amount must pass the $100K–$500M plausibility guard.
 * Returns null score when no raise signals are detected at all.
 * Caps at 60 when cross-field conflicts are present.
 */
function scoreDealTerms(thesis: ThesisInputsV1): CategoryScore {
	const notes: string[] = [];
	let raw = 0;

	// raise_amount: 40 pts, plausibility-guarded
	if (thesis.raise_amount !== null) {
		if (isRaiseAmountPlausible(thesis.raise_amount)) {
			raw += 40;
			notes.push(`raise_amount: "${thesis.raise_amount}" (within $100K–$500M range)`);
		} else {
			notes.push(
				`raise_amount: "${thesis.raise_amount}" (rejected — outside $100K–$500M plausibility range)`
			);
		}
	} else {
		notes.push("raise_amount: not detected");
	}

	// raise_round: 30 pts
	if (thesis.raise_round !== null) {
		raw += 30;
		notes.push(`raise_round: "${thesis.raise_round}"`);
	} else {
		notes.push("raise_round: not detected");
	}

	// raise_instrument: 20 pts
	if (thesis.raise_instrument !== null) {
		raw += 20;
		notes.push(`raise_instrument: "${thesis.raise_instrument}"`);
	} else {
		notes.push("raise_instrument: not detected");
	}

	// valuation (pre or post): 10 pts
	if (thesis.valuation_pre !== null || thesis.valuation_post !== null) {
		const v = thesis.valuation_pre ?? thesis.valuation_post;
		raw += 10;
		notes.push(`valuation: "${v}"`);
	} else {
		notes.push("valuation: not detected");
	}

	// No raise signals at all → not scoreable (null)
	const hasAnyRaiseSignal =
		thesis.raise_amount !== null ||
		thesis.raise_round !== null ||
		thesis.raise_instrument !== null;

	if (!hasAnyRaiseSignal) {
		return {
			score: null,
			confidence: "low",
			notes: ["No raise signals detected — deal terms not scoreable"],
		};
	}

	// Conflict cap: if conflicts present, cap score at 60
	if (thesis.conflicts_present) {
		raw = Math.min(raw, 60);
		notes.push("conflict_cap: score capped at 60 (conflicts present)");
	}

	const score = Math.round(Math.min(100, Math.max(0, raw)));
	const confidence: "high" | "medium" | "low" =
		raw >= 70 && !thesis.conflicts_present ? "high" : raw >= 40 ? "medium" : "low";

	return { score, confidence, notes };
}

// ─── Category C: Traction Existence Signal ────────────────────────────────────

const STRONG_TRACTION_SCOPES = new Set(["historical", "current", "ttm"]);
const TRACTION_METRIC_KEYS = new Set(["revenue", "arr", "mrr"]);

/**
 * Scores traction using workbook facts (XLSX) first, then text-extracted thesis fields.
 *
 * Workbook facts (strong signal, scope = historical/current/ttm):
 *   - First qualifying metric: +50 pts
 *   - Second different qualifying metric: +25 pts (capped at 75 from workbook)
 *
 * Workbook facts (weak signal, scope = projected/scenario):
 *   - First projected metric: +10 pts (half-credit; projections ≠ current actuals)
 *
 * Text-extracted fallback (when no workbook signals):
 *   - thesis.revenue_value / .arr_value / .mrr_value present: +40 pts
 *
 * Growth signal bonus (workbook, metric_key = growth_rate/retention_pct/churn_pct):
 *   - +15 pts if present
 *
 * Returns score=0 only when no signals exist at all.
 */
function scoreTractionSignal(
	thesis: ThesisInputsV1,
	workbookFacts: FinancialFactV1[]
): CategoryScore {
	const notes: string[] = [];
	let raw = 0;

	const seenStrongMetrics = new Set<string>();
	let strongCount = 0;
	let hasProjectedFact = false;

	for (const fact of workbookFacts) {
		if (!TRACTION_METRIC_KEYS.has(fact.metric_key)) continue;
		if (fact.confidence === "low") continue;

		const scope = fact.temporal_scope ?? "unknown";

		if (STRONG_TRACTION_SCOPES.has(scope)) {
			if (!seenStrongMetrics.has(fact.metric_key)) {
				seenStrongMetrics.add(fact.metric_key);
				const pts = strongCount === 0 ? 50 : 25;
				raw += pts;
				strongCount++;
				notes.push(
					`workbook_fact: ${fact.metric_key} [scope=${scope}, confidence=${fact.confidence}] +${pts}pts`
				);
			}
		} else if ((scope === "projected" || scope === "scenario") && !hasProjectedFact) {
			hasProjectedFact = true;
			raw += 10;
			notes.push(
				`workbook_fact: ${fact.metric_key} [scope=${scope}] +10pts (projected only — half credit)`
			);
		}
	}

	// Cap workbook-derived raw at 80 before adding any bonus
	raw = Math.min(raw, 80);

	// Growth / engagement signal bonus from workbook
	const hasGrowthFact = workbookFacts.some(
		(f) =>
			f.metric_key === "growth_rate" ||
			f.metric_key === "retention_pct" ||
			f.metric_key === "churn_pct"
	);
	if (hasGrowthFact) {
		raw += 15;
		notes.push("growth_metric: detected in workbook facts +15pts");
	}

	// Fallback to text-extracted thesis fields when no workbook signals were found
	if (strongCount === 0 && !hasProjectedFact) {
		const textHits: string[] = [];
		if (thesis.revenue_value !== null) textHits.push(`revenue_value: "${thesis.revenue_value}"`);
		if (thesis.arr_value !== null) textHits.push(`arr_value: "${thesis.arr_value}"`);
		if (thesis.mrr_value !== null) textHits.push(`mrr_value: "${thesis.mrr_value}"`);

		if (textHits.length > 0) {
			raw += 40;
			for (const h of textHits) notes.push(`text_signal: ${h}`);
		} else {
			// Check completeness row as last resort
			const tractionRow = thesis.completeness.find((r) => r.category === "traction_signal");
			const tractionStatus = tractionRow?.status ?? "Missing";
			if (tractionStatus === "Present" || tractionStatus === "Conflicting") {
				raw += 20;
				notes.push(
					`traction_signal completeness: ${tractionStatus} (no extractable value — completeness signal only)`
				);
			} else {
				return {
					score: 0,
					confidence: "low",
					notes: ["No traction signals detected in any source"],
				};
			}
		}
	}

	const score = Math.round(Math.min(100, Math.max(0, raw)));
	const confidence: "high" | "medium" | "low" =
		strongCount >= 2 ? "high" : strongCount >= 1 ? "medium" : "low";

	return { score, confidence, notes };
}

// ─── Category D: Market Sizing Presence ───────────────────────────────────────

/**
 * Scores market sizing presence with plausibility guards.
 * TAM (45), SAM (30), SOM (25) — each must parse to $10M–$100T.
 * TAM comes from ThesisInputsV1; SAM and SOM come from Phase 2 canonical fields
 * (not surfaced in ThesisInputsV1).
 * Returns null score when no market signals detected.
 */
function scoreMarketPresence(
	thesis: ThesisInputsV1,
	phase2Fields: Array<{ field: string; value: string | null; computability: string }>
): CategoryScore {
	const notes: string[] = [];
	let raw = 0;
	let hasPlausibleSignal = false;

	// TAM: 45 pts — sourced from ThesisInputsV1
	if (thesis.tam_value !== null) {
		if (isMarketValuePlausible(thesis.tam_value)) {
			raw += 45;
			hasPlausibleSignal = true;
			notes.push(`TAM: "${thesis.tam_value}" (plausible)`);
		} else {
			notes.push(
				`TAM: "${thesis.tam_value}" (rejected — outside $10M–$100T plausibility range)`
			);
		}
	} else {
		notes.push("TAM: not detected");
	}

	// SAM: 30 pts — sourced from Phase 2 canonical fields
	const samField = phase2Fields.find((f) => f.field === "sam_value");
	const samValue = samField?.computability === "Computable" ? samField.value : null;
	if (samValue !== null) {
		if (isMarketValuePlausible(samValue)) {
			raw += 30;
			hasPlausibleSignal = true;
			notes.push(`SAM: "${samValue}" (plausible)`);
		} else {
			notes.push(`SAM: "${samValue}" (rejected — outside plausibility range)`);
		}
	} else {
		notes.push("SAM: not detected");
	}

	// SOM: 25 pts — sourced from Phase 2 canonical fields
	const somField = phase2Fields.find((f) => f.field === "som_value");
	const somValue = somField?.computability === "Computable" ? somField.value : null;
	if (somValue !== null) {
		if (isMarketValuePlausible(somValue)) {
			raw += 25;
			hasPlausibleSignal = true;
			notes.push(`SOM: "${somValue}" (plausible)`);
		} else {
			notes.push(`SOM: "${somValue}" (rejected — outside plausibility range)`);
		}
	} else {
		notes.push("SOM: not detected");
	}

	// No plausible market signals found → not scoreable (null)
	// (Detected-but-rejected values don't count as signals.)
	if (!hasPlausibleSignal) {
		return { score: null, confidence: "low", notes };
	}

	const score = Math.round(Math.min(100, Math.max(0, raw)));
	const tamPlausible = thesis.tam_value !== null && isMarketValuePlausible(thesis.tam_value);
	const samPlausible = samValue !== null && isMarketValuePlausible(samValue);
	const confidence: "high" | "medium" | "low" =
		tamPlausible && samPlausible ? "high" : tamPlausible ? "medium" : "low";

	return { score, confidence, notes };
}

// ─── Overall scoring ──────────────────────────────────────────────────────────

const CATEGORY_WEIGHTS = {
	completeness: 0.25,
	deal_terms: 0.35,
	traction: 0.25,
	market: 0.15,
} as const;

/**
 * Compute overall score as a weighted average of non-null categories.
 * Requires ≥2 scoreable categories; otherwise returns null / "not_scoreable".
 * Overall confidence = weakest confidence across scored categories.
 */
function computeOverall(cats: {
	completeness: CategoryScore;
	deal_terms: CategoryScore;
	traction: CategoryScore;
	market: CategoryScore;
}): {
	score: number | null;
	confidence: "high" | "medium" | "low" | "not_scoreable";
	notes: string[];
} {
	const notes: string[] = [];
	let weightedSum = 0;
	let totalWeight = 0;

	const entries: [keyof typeof CATEGORY_WEIGHTS, CategoryScore][] = [
		["completeness", cats.completeness],
		["deal_terms", cats.deal_terms],
		["traction", cats.traction],
		["market", cats.market],
	];

	const scoredEntries: [string, CategoryScore][] = [];

	for (const [name, cat] of entries) {
		if (cat.score === null) {
			notes.push(`${name}: not scoreable`);
		} else {
			const weight = CATEGORY_WEIGHTS[name];
			weightedSum += cat.score * weight;
			totalWeight += weight;
			notes.push(`${name}: ${cat.score} (weight ${weight})`);
			scoredEntries.push([name, cat]);
		}
	}

	// Require at least 2 scoreable categories
	if (scoredEntries.length < 2) {
		return { score: null, confidence: "not_scoreable", notes };
	}

	const rawOverall = totalWeight > 0 ? weightedSum / totalWeight : 0;
	const score = Math.round(Math.min(100, Math.max(0, rawOverall)));

	// Overall confidence: derived from weakest category confidence
	const confidenceRank = { high: 2, medium: 1, low: 0 };
	const minRank = Math.min(
		...scoredEntries.map(([, cat]) => confidenceRank[cat.confidence])
	);
	const confidenceMap: Record<number, "high" | "medium" | "low"> = {
		2: "high",
		1: "medium",
		0: "low",
	};
	const confidence = confidenceMap[minRank] ?? "low";

	return { score, confidence, notes };
}

// ─── Main public function ─────────────────────────────────────────────────────

/**
 * Compute limited scoring for one deal.
 *
 * @param thesis - Pre-computed thesis inputs (from buildThesisInputs).
 * @param inputs - Insight slot inputs (for workbook facts + Phase 2 extraction).
 * @param now    - ISO timestamp for `scored_at`; defaults to current time.
 *                 Pass a fixed value in tests to ensure determinism.
 */
export function computeLimitedScoringV1(
	thesis: ThesisInputsV1,
	inputs: InsightSlotInputs,
	now: string = new Date().toISOString()
): LimitedScoringV1 {
	// Phase 2 canonical fields (for SAM/SOM and market claims not in ThesisInputsV1)
	const phase2 = extractPhase2Result(inputs);

	const completeness = scoreCompleteness(thesis);
	const dealTerms = scoreDealTerms(thesis);
	const traction = scoreTractionSignal(thesis, inputs.workbookFacts);
	const market = scoreMarketPresence(thesis, phase2.fields);

	const overall = computeOverall({
		completeness,
		deal_terms: dealTerms,
		traction,
		market,
	});

	return {
		schema_version: "limited_scoring_v1",
		completeness_score: completeness.score,
		completeness_confidence: completeness.confidence,
		completeness_notes: completeness.notes,
		deal_terms_score: dealTerms.score,
		deal_terms_confidence: dealTerms.confidence,
		deal_terms_notes: dealTerms.notes,
		traction_signal_score: traction.score,
		traction_signal_confidence: traction.confidence,
		traction_signal_notes: traction.notes,
		market_presence_score: market.score,
		market_presence_confidence: market.confidence,
		market_presence_notes: market.notes,
		overall_limited_score: overall.score,
		scoring_confidence: overall.confidence,
		scoring_notes: overall.notes,
		deferred_categories: [
			"team",
			"product_quality",
			"business_model_quality",
			"go_to_market_quality",
			"full_financial_health",
			"comparative_ranking",
		],
		scored_at: now,
	};
}

// ─── Section builder ──────────────────────────────────────────────────────────

/**
 * Build the limited_scoring_v1 render section from a computed LimitedScoringV1 payload.
 * Format: key-value text lines with indented notes for explainability.
 */
export function buildLimitedScoringSection(
	scoring: LimitedScoringV1
): RenderPackage["sections"][number] {
	const scoreStr = (v: number | null) => (v === null ? "not_scoreable" : String(v));

	const lines: string[] = [
		`schema_version: ${scoring.schema_version}`,
		`scored_at: ${scoring.scored_at}`,
		"",
		`completeness_score: ${scoreStr(scoring.completeness_score)}`,
		`completeness_confidence: ${scoring.completeness_confidence}`,
		...scoring.completeness_notes.map((n) => `  completeness_note: ${n}`),
		"",
		`deal_terms_score: ${scoreStr(scoring.deal_terms_score)}`,
		`deal_terms_confidence: ${scoring.deal_terms_confidence}`,
		...scoring.deal_terms_notes.map((n) => `  deal_terms_note: ${n}`),
		"",
		`traction_signal_score: ${scoreStr(scoring.traction_signal_score)}`,
		`traction_signal_confidence: ${scoring.traction_signal_confidence}`,
		...scoring.traction_signal_notes.map((n) => `  traction_note: ${n}`),
		"",
		`market_presence_score: ${scoreStr(scoring.market_presence_score)}`,
		`market_presence_confidence: ${scoring.market_presence_confidence}`,
		...scoring.market_presence_notes.map((n) => `  market_note: ${n}`),
		"",
		`overall_limited_score: ${scoreStr(scoring.overall_limited_score)}`,
		`scoring_confidence: ${scoring.scoring_confidence}`,
		...scoring.scoring_notes.map((n) => `  scoring_note: ${n}`),
		"",
		`deferred_categories: ${scoring.deferred_categories.join(", ")}`,
	];

	return {
		key: "limited_scoring_v1",
		title: "Limited Scoring (MVP)",
		kind: "message",
		body: lines.join("\n"),
		fallback: "Limited scoring data unavailable.",
	};
}
