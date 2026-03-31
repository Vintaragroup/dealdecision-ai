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

export function buildInvestmentAnalysisOverviewV2(args: {
	dio: DealIntelligenceObject;
	report: any;
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
		summary: oneLiner,
		summary_medium: summaryMedium,
		summary_long: summaryLong,
	};
}
