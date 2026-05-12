import type {
	DealIntelligenceObject,
	Risk,
	RiskAssessmentResult,
	FinancialHealthResult,
} from "../types/dio.js";

export type InvestmentAnalysisOverviewV2ReadinessBand = "low" | "med" | "high";

export type InvestmentAnalysisOverviewV2 = {
	version: "investment_analysis_overview_v2";
	archetype: { value: string | null; confidence: number | null };
	traction: { present: boolean; signals: string[]; metrics: string[] };
	capital_profile: { runway_months: number | null; burn_multiple: number | null };
	evidence_strength: {
		coverage_ratio: number | null;
		confidence_score: number | null;
		evidence_factor: number | null;
		due_diligence_factor: number | null;
		adjustment_factor: number | null;
		diligence_readiness_band: InvestmentAnalysisOverviewV2ReadinessBand;
	};
	kpis: {
		inputs_hash: string | null;
		keys: string[];
	};
	open_items: {
		source: "score_explanation.understanding_v1.diligence_open_items" | "score_explanation.totals.unadjusted_missing_inputs";
		items: string[];
	};
	top_risks: {
		source: "dio.analyzer_results.risk_assessment" | "dio.phase1.deal_overview_v2.key_risks_detected" | "none";
		items: string[];
	};
	coverage_gaps: string[];
	/** Investor-readable one-liner sourced from dio.phase1.deal_summary_v2.summary.one_liner */
	summary: string | null;
	/** Medium-length narrative paragraph sourced from dio.phase1.deal_summary_v2.summary.paragraphs[0] */
	summary_medium: string | null;
	/** Long-form narrative sourced from dio.phase1.deal_summary_v2.summary.paragraphs[1] + paragraphs[2] joined */
	summary_long: string | null;
	/** Raise amount sourced from guarded structured_summary (null when blocked by final_publish_guard). */
	raise: { value: string | null; guarded: boolean } | null;
	/** Business model sourced from guarded structured_summary (null when blocked by final_publish_guard). */
	business_model: { value: string | null; guarded: boolean } | null;
	/** Revenue sourced from guarded structured_summary (null when blocked by guard or "Unknown" sentinel). */
	revenue: { value: string | null; guarded: boolean; is_projected: boolean } | null;
};

const uniqSorted = (arr: string[]): string[] => {
	const out = Array.from(new Set(arr.map((s) => s.trim()).filter(Boolean)));
	out.sort((a, b) => a.localeCompare(b));
	return out;
};

const asStringArray = (v: unknown): string[] =>
	Array.isArray(v) ? (v as any[]).filter((x) => typeof x === "string").map((x) => String(x)) : [];

const asFiniteNumberOrNull = (v: unknown): number | null =>
	typeof v === "number" && Number.isFinite(v) ? v : null;

const severityRank: Record<Risk["severity"], number> = {
	critical: 0,
	high: 1,
	medium: 2,
	low: 3,
};

const pickTopRiskDescriptions = (ra: RiskAssessmentResult | null): string[] => {
	if (!ra) return [];
	const risks: Risk[] = [];
	const cats = ra.risks_by_category;
	if (cats && typeof cats === "object") {
		for (const key of ["market", "team", "financial", "execution"] as const) {
			const arr = (cats as any)[key];
			if (Array.isArray(arr)) {
				for (const r of arr) {
					if (!r || typeof r !== "object") continue;
					if (typeof (r as any).description !== "string") continue;
					risks.push(r as Risk);
				}
			}
		}
	}

	risks.sort((a, b) => {
		const sa = severityRank[a.severity] ?? 99;
		const sb = severityRank[b.severity] ?? 99;
		if (sa !== sb) return sa - sb;
		const ca = String(a.category);
		const cb = String(b.category);
		const c = ca.localeCompare(cb);
		if (c !== 0) return c;
		return String(a.description).localeCompare(String(b.description));
	});

	return uniqSorted(risks.map((r) => r.description)).slice(0, 6);
};

const bandFromDueDiligenceFactor = (v: number | null): InvestmentAnalysisOverviewV2ReadinessBand => {
	if (v == null) return "low";
	if (v >= 0.9) return "high";
	if (v >= 0.75) return "med";
	return "low";
};

/**
 * Remove or replace guard-invalidated values from LLM-generated IAO summary texts.
 *
 * IAO summaries are produced by the DIO phase1 LLM pipeline BEFORE field-authority-guard
 * (FAG) and final-publish-guard (FPG) have run. Guard-rejected values (e.g. "$1 per-share
 * amount", "Wholesale/Retail" misclassification) can therefore appear in the cached summary
 * text even when the structured_summary fields are correctly guarded.
 *
 * This function applies targeted substitutions so the narrative text is consistent with the
 * guarded structured_summary fields.
 *
 * Patterns addressed:
 *   1. "$1 [Series/Preferred/Convertible] [Note]" — de-SPAC per-share artifact.
 *      Replaced with the guarded raise value when one is available.
 *   2. "Wholesale/Retail" (and "wholesale and retail") language — generic distribution
 *      channel label misextracted as a business model.
 *      Replaced with guarded BM value, or removed when BM is null/guarded.
 */
function sanitizeIaoText(text: string | null, structuredSummary: any): string | null {
	if (!text) return null;
	let result = text;

	// 1. De-SPAC $1 artifact: replace complete "$1 [instrument phrase]" with correct raise.
	//    Patterns: "$1 Series A Convertible Note", "$1 Preferred Note", "$1 Convertible Note",
	//    "$1 Convertible preferred share", etc.
	const guardedRaise = structuredSummary?.raise;
	const guardedRaiseValue =
		typeof guardedRaise?.value === 'string' && guardedRaise.value.trim()
			? guardedRaise.value.trim()
			: null;
	if (guardedRaiseValue) {
		// Match: $1 [optional: Series X] [one-or-more of: preferred|convertible] [optional: note|share]
		result = result.replace(
			/\$\s*1(?:\s+series\s+\w+)?(?:\s+(?:preferred|convertible))+(?:\s+(?:note|notes|share|shares))?\b/gi,
			guardedRaiseValue,
		);
	}

	// 2. "Wholesale/Retail" or "wholesale and retail" — replace with guarded BM or remove
	const guardedBm = structuredSummary?.business_model;
	const guardedBmValue =
		typeof guardedBm?.value === 'string' && guardedBm.value.trim()
			? guardedBm.value.trim()
			: null;

	// Test includes both slash form ("wholesale/retail") and prose form ("wholesale and retail")
	const wholesalePattern = /\bwholesale\s*(?:\/\s*retail|and retail|\s+retail)\b/gi;
	if (wholesalePattern.test(result)) {
		wholesalePattern.lastIndex = 0; // reset after .test()
		if (guardedBmValue) {
			// Replace with the correct BM label
			result = result.replace(wholesalePattern, guardedBmValue);
		} else {
			// BM was nulled — remove term, clean up common surrounding phrases
			result = result.replace(/\bfocused on (?:an? )?wholesale\s*(?:\/\s*retail|and retail|\s+retail)\b/gi, '');
			result = result.replace(/\boperating within (?:the )?wholesale\s*(?:\/\s*retail|and retail|\s+retail)(?: sector)?\b/gi, '');
			result = result.replace(/\bthe wholesale\s*(?:\/\s*retail|and retail|\s+retail)(?: (?:business model|sector|segment))?\b/gi, 'an undisclosed business model');
			result = result.replace(wholesalePattern, '');
		}
	}

	// 2b. Replace stale generic ecommerce archetype phrases with the guarded BM label.
	// This avoids investor-facing contradictions where the LLM one-liner says
	// "consumer e-commerce brand" while structured_summary.business_model was guarded
	// to a different canonical value (e.g. Marketplace / platform).
	if (guardedBmValue) {
		result = result.replace(/\bconsumer\s+e-?commerce\s+brand\b/gi, guardedBmValue);
		result = result.replace(/\bdtc\s+ecommerce(?:\s+business)?\b/gi, guardedBmValue);
	}

	// 3. "Unknown" sentinel values — DIO phase1 summaries may contain bare "Unknown" as a
	//    value placeholder if the extraction found no data and the guard cleared the field
	//    before the summary was written. Target only sentinel-like uses (after colon, "of
	//    Unknown", "raising Unknown") — leave natural-language "unknown" untouched.
	if (/\bunknown\b/i.test(result)) {
		result = result.replace(/\b(?:raise|revenue|amount|funding)\s*:\s*unknown\b/gi, '');
		result = result.replace(/\braising\s+(?:an?\s+)?unknown\b(?:\s+(?:amount|round))?\b/gi, 'raising an undisclosed amount');
		result = result.replace(/\b(?:an?\s+)?unknown\s+(?:raise|amount|funding|investment)\b/gi, 'an undisclosed amount');
		result = result.replace(/\bof\s+unknown\b/gi, '');
	}

	// 4. SPV / special-purpose-vehicle context bleed — remove SPV language from summaries
	//    when the current deal is not a fund or SPV vehicle. SPV is a fund-archetype concept
	//    that can bleed from an adjacent deal (e.g. Climatic → Weavstra) during batch LLM
	//    generation. If structured_summary confirms no fund model, SPV references are invalid.
	const bmValueForSpv = structuredSummary?.business_model?.value;
	const isFundOrSpvModel = typeof bmValueForSpv === 'string' && /\b(fund|spvs?|special\s+purpose)\b/i.test(bmValueForSpv);
	if (!isFundOrSpvModel && /\bspvs?\b|\bspecial\s+purpose\s+vehicles?\b/i.test(result)) {
		// Remove the most common bleed phrases first, then any residual bare SPV tokens.
		result = result.replace(/\bleveraging\s+(?:multiple\s+)?spvs?\s+(?:for|to)\b[^.]{0,120}(?=[,.]|$)/gi, '');
		result = result.replace(/\busing\s+(?:multiple\s+)?spvs?\s+(?:for|to)\s+[^.]{0,80}(?=[,.]|$)/gi, '');
		result = result.replace(/\b(?:via|through|with)\s+(?:multiple\s+)?spvs?\b[^,.]{0,80}/gi, '');
		result = result.replace(/\bspecial\s+purpose\s+vehicles?\b[^.]{0,60}(?=[,.]|$)/gi, '');
		result = result.replace(/\bspvs?\b/gi, '');
	}

	// Clean up residual artefacts from text removal: multiple spaces and orphaned punctuation
	result = result.replace(/[ \t]{2,}/g, ' ');
	result = result.replace(/[ \t]+([,;])/g, '$1');
	result = result.trim();

	return result || null;
}

export function buildInvestmentAnalysisOverviewV2(args: {
	dio: DealIntelligenceObject;
	report: any;
	structured_summary?: any;
}): InvestmentAnalysisOverviewV2 {
	const dio = args.dio as any;
	const reportObj = args.report && typeof args.report === "object" ? args.report : {};
	const meta = reportObj.metadata && typeof reportObj.metadata === "object" ? reportObj.metadata : {};

	const phase1 = dio?.dio?.phase1;
	const archetype = phase1?.business_archetype_v1;
	const archetypeValue = typeof archetype?.value === "string" && archetype.value.trim() ? archetype.value.trim() : null;
	const archetypeConfidence = asFiniteNumberOrNull(archetype?.confidence);

	const overviewV2 = phase1?.deal_overview_v2;
	const tractionSignals = uniqSorted(asStringArray(overviewV2?.traction_signals));
	const tractionMetrics = uniqSorted(asStringArray(overviewV2?.traction_metrics));
	const tractionPresent = tractionSignals.length > 0 || tractionMetrics.length > 0;

	const fh: FinancialHealthResult | null = dio?.analyzer_results?.financial_health ?? null;
	const runway = asFiniteNumberOrNull((fh as any)?.runway_months);
	const burnMultiple = asFiniteNumberOrNull((fh as any)?.burn_multiple);

	const scoreExp = meta?.score_explanation && typeof meta.score_explanation === "object" ? meta.score_explanation : null;
	const totals = scoreExp?.totals && typeof scoreExp.totals === "object" ? scoreExp.totals : null;

	const coverageRatio = asFiniteNumberOrNull(totals?.coverage_ratio);
	const confidenceScore = asFiniteNumberOrNull(totals?.confidence_score);
	const evidenceFactor = asFiniteNumberOrNull(totals?.evidence_factor);
	const dueDiligenceFactor = asFiniteNumberOrNull(totals?.due_diligence_factor);
	const adjustmentFactor = asFiniteNumberOrNull(totals?.adjustment_factor);

	const detInputs = meta?.deterministic_score_inputs_v1 && typeof meta.deterministic_score_inputs_v1 === "object"
		? meta.deterministic_score_inputs_v1
		: null;
	const kpiKeys = (() => {
		const kpis = Array.isArray(detInputs?.kpis) ? (detInputs.kpis as any[]) : [];
		return uniqSorted(kpis.map((k) => (typeof k?.key === "string" ? k.key : "")).filter(Boolean));
	})();
	const inputsHash = typeof detInputs?.inputs_hash === "string" && detInputs.inputs_hash.trim() ? detInputs.inputs_hash.trim() : null;

	const openItemsFromUnderstanding = (() => {
		const understanding = scoreExp?.understanding_v1 && typeof scoreExp.understanding_v1 === "object" ? scoreExp.understanding_v1 : null;
		const items = Array.isArray(understanding?.diligence_open_items)
			? (understanding.diligence_open_items as any[])
					.map((x) => (typeof x?.text === "string" ? x.text : ""))
					.filter(Boolean)
			: [];
		return uniqSorted(items).slice(0, 10);
	})();

	const openItemsFromMissing = uniqSorted(asStringArray(totals?.unadjusted_missing_inputs)).slice(0, 10);
	const openItems = openItemsFromUnderstanding.length > 0 ? openItemsFromUnderstanding : openItemsFromMissing;
	const openItemsSource = openItemsFromUnderstanding.length > 0
		? "score_explanation.understanding_v1.diligence_open_items"
		: "score_explanation.totals.unadjusted_missing_inputs";

	const ra: RiskAssessmentResult | null = dio?.analyzer_results?.risk_assessment ?? null;
	const riskDescriptions = pickTopRiskDescriptions(ra);
	const phase1RiskSignals = uniqSorted(asStringArray(overviewV2?.key_risks_detected)).slice(0, 8);

	const topRisks = (() => {
		if (riskDescriptions.length > 0) return { source: "dio.analyzer_results.risk_assessment" as const, items: riskDescriptions };
		if (phase1RiskSignals.length > 0) return { source: "dio.phase1.deal_overview_v2.key_risks_detected" as const, items: phase1RiskSignals };
		return { source: "none" as const, items: [] };
	})();

	const coverageGaps = openItemsSource === "score_explanation.totals.unadjusted_missing_inputs" ? openItemsFromMissing : openItemsFromMissing;

	const dealSummaryV2 = phase1?.deal_summary_v2;
	const oneLiner =
		typeof dealSummaryV2?.summary?.one_liner === "string" && dealSummaryV2.summary.one_liner.trim()
			? dealSummaryV2.summary.one_liner.trim()
			: null;

	const paragraphs: string[] = Array.isArray(dealSummaryV2?.summary?.paragraphs)
		? (dealSummaryV2.summary.paragraphs as unknown[]).filter((p): p is string => typeof p === "string" && p.trim().length > 0).map((p) => p.trim())
		: [];

	const summaryMedium = paragraphs[0] ?? null;
	const summaryLong = (() => {
		const tail = [paragraphs[1], paragraphs[2]].filter((p): p is string => p !== undefined && p.length > 0);
		return tail.length > 0 ? tail.join("\n\n") : null;
	})();

	// Apply post-guard sanitization to the LLM-generated summary texts.
	// Summaries are produced during DIO phase1 (before FAG/FPG ran) and may contain
	// invalidated raise or business-model values. Replace/remove those using guarded fields.
	const ss = args.structured_summary ?? null;
	const sanitizedOneLiner = sanitizeIaoText(oneLiner, ss);
	const sanitizedSummaryMedium = sanitizeIaoText(summaryMedium, ss);
	const sanitizedSummaryLong = sanitizeIaoText(summaryLong, ss);

	return {
		version: "investment_analysis_overview_v2",
		archetype: { value: archetypeValue, confidence: archetypeConfidence },
		traction: { present: tractionPresent, signals: tractionSignals, metrics: tractionMetrics },
		capital_profile: { runway_months: runway, burn_multiple: burnMultiple },
		evidence_strength: {
			coverage_ratio: coverageRatio,
			confidence_score: confidenceScore,
			evidence_factor: evidenceFactor,
			due_diligence_factor: dueDiligenceFactor,
			adjustment_factor: adjustmentFactor,
			diligence_readiness_band: bandFromDueDiligenceFactor(dueDiligenceFactor),
		},
		kpis: { inputs_hash: inputsHash, keys: kpiKeys },
		open_items: { source: openItemsSource, items: openItems },
		top_risks: topRisks,
		coverage_gaps: coverageGaps,
		summary: sanitizedOneLiner,
		summary_medium: sanitizedSummaryMedium,
		summary_long: sanitizedSummaryLong,
		raise: (() => {
			const ss = args.structured_summary;
			if (!ss || typeof ss !== 'object') return null;
			const r = (ss as any).raise;
			if (!r || typeof r !== 'object') return null;
			const guarded = !!(r.nulled_by === 'final_publish_guard' || r.null_rule);
			const v = typeof r.value === 'string' && r.value.trim() ? r.value.trim() : null;
			return { value: v, guarded };
		})(),
		business_model: (() => {
			const ss = args.structured_summary;
			if (!ss || typeof ss !== 'object') return null;
			const b = (ss as any).business_model;
			if (!b || typeof b !== 'object') return null;
			const guarded = !!(b.nulled_by === 'final_publish_guard' || b.null_rule);
			const v = typeof b.value === 'string' && b.value.trim() ? b.value.trim() : null;
			return { value: v, guarded };
		})(),
		revenue: (() => {
			const ss = args.structured_summary;
			if (!ss || typeof ss !== 'object') return null;
			const r = (ss as any).revenue;
			if (!r || typeof r !== 'object') return null;
			const guarded = !!(r.nulled_by === 'final_publish_guard' || r.null_rule);
			// Read value.raw (primary) → value_raw → value string
			const rawStr =
				(typeof r.value?.raw === 'string' && r.value.raw.trim() ? r.value.raw.trim() : null) ??
				(typeof r.value_raw === 'string' && r.value_raw.trim() ? r.value_raw.trim() : null) ??
				(typeof r.value === 'string' && r.value.trim() ? r.value.trim() : null);
			// Suppress "Unknown" sentinel
			const v = rawStr && rawStr.toLowerCase() !== 'unknown' ? rawStr : null;
			const is_projected = !!(r.is_projected || r.is_provisional);
			return { value: v, guarded, is_projected };
		})(),
	};
}
