export type ScoreBandV2Key =
	| "hard_pass"
	| "consider_caution"
	| "strong_consider"
	| "fund_caution"
	| "fund_track"
	| "fund_confident";

export type ScoreBandV2 = {
	key: ScoreBandV2Key;
	label: string;
	min: number;
	max: number;
};

export const SCORE_BANDS_V2: ReadonlyArray<ScoreBandV2> = Object.freeze([
	{ key: "hard_pass", label: "Hard Pass", min: 0, max: 44 },
	{ key: "consider_caution", label: "Consider (Caution)", min: 45, max: 54 },
	{ key: "strong_consider", label: "Strong Consider (Needs Confidence)", min: 55, max: 64 },
	{ key: "fund_caution", label: "Fund (Caution)", min: 65, max: 74 },
	{ key: "fund_track", label: "Fund & Track", min: 75, max: 84 },
	{ key: "fund_confident", label: "Fund (High Confidence)", min: 85, max: 100 },
]);

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/**
 * Returns the v2 score band for the given overall score.
 *
 * Notes:
 * - Score is clamped into [0, 100]
 * - Band edges are inclusive
 */
export function getScoreBandV2(overall_score: number): ScoreBandV2 {
	const score = Number.isFinite(overall_score) ? clamp(overall_score, 0, 100) : 50;
	for (const band of SCORE_BANDS_V2) {
		if (score >= band.min && score <= band.max) return band;
	}
	// Should be unreachable due to clamping + full coverage.
	return SCORE_BANDS_V2[SCORE_BANDS_V2.length - 1];
}

export type HardPassGuardrailV2Reason = "low_score_despite_full_coverage" | null;

export type HardPassGuardrailV2CriteriaSnapshot = {
	overall_score: number;
	coverage_ratio: number | null;
	unadjusted_overall_score: number | null;
	drift_assessment: string;
	kpi_selected: {
		key: string;
		confidence: number;
		value_raw_present: boolean;
	} | null;
	criteria: {
		overall_score_lt_45: boolean;
		coverage_ratio_gte_085: boolean;
		baseline_present: boolean;
		kpi_present_conf_gte_060: boolean;
		drift_not_misaligned: boolean;
		full_criteria_in_place: boolean;
	};
	thresholds: {
		coverage_ratio_min: number;
		kpi_confidence_min: number;
		overall_hard_pass_max: number;
	};
};

export type HardPassGuardrailV2Result = {
	triggered: boolean;
	reason: HardPassGuardrailV2Reason;
	note: string | null;
	criteria_snapshot: HardPassGuardrailV2CriteriaSnapshot;
};

type GuardrailKpi = {
	key: string;
	confidence: number;
	value_raw?: string | null;
};

function selectBestKpi(kpis: GuardrailKpi[], minConfidence: number): GuardrailKpi | null {
	const arr = Array.isArray(kpis) ? kpis : [];
	const ok = arr
		.filter((k) => typeof k?.confidence === "number" && Number.isFinite(k.confidence))
		.filter((k) => (k.confidence as number) >= minConfidence);
	if (ok.length === 0) return null;

	const preferred = ok.filter((k) => k.key === "revenue" || k.key === "customers");
	const pool = preferred.length > 0 ? preferred : ok;

	pool.sort((a, b) => {
		const conf = (b.confidence as number) - (a.confidence as number);
		if (Math.abs(conf) > 1e-12) return conf;
		return String(a.key).localeCompare(String(b.key));
	});

	return pool[0] ?? null;
}

const asFinite = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * Hard-pass guardrail v2:
 * If score is < 45 even with "full criteria in place", emit a deterministic warning.
 */
export function computeHardPassGuardrailV2(ctx: {
	overall_score: number;
	coverage_ratio: number | null;
	unadjusted_overall_score: number | null;
	kpis: GuardrailKpi[];
	drift_assessment: string;
}): HardPassGuardrailV2Result {
	const coverageRatioMin = 0.85;
	const kpiConfidenceMin = 0.6;
	const overallHardPassMax = 44;

	const overall = Number.isFinite(ctx.overall_score) ? ctx.overall_score : 50;
	const coverageRatio = asFinite(ctx.coverage_ratio);
	const unadjusted = asFinite(ctx.unadjusted_overall_score);
	const drift = typeof ctx.drift_assessment === "string" && ctx.drift_assessment.trim()
		? ctx.drift_assessment.trim()
		: "unknown";

	const overallLt45 = overall <= overallHardPassMax;
	const coverageOk = coverageRatio != null && coverageRatio >= coverageRatioMin;
	const baselineOk = unadjusted != null;
	const driftOk = drift !== "misaligned";

	const bestKpi = selectBestKpi(ctx.kpis, kpiConfidenceMin);
	const kpiOk = bestKpi != null;

	const fullCriteria = Boolean(coverageOk && baselineOk && kpiOk && driftOk);
	const triggered = Boolean(overallLt45 && fullCriteria);

	const reason: HardPassGuardrailV2Reason = triggered ? "low_score_despite_full_coverage" : null;
	const note = triggered
		? "Hard Pass guardrail: overall score is below 45 despite strong coverage and KPI presence."
		: null;

	const criteria_snapshot: HardPassGuardrailV2CriteriaSnapshot = {
		overall_score: overall,
		coverage_ratio: coverageRatio,
		unadjusted_overall_score: unadjusted,
		drift_assessment: drift,
		kpi_selected: bestKpi
			? {
				key: String(bestKpi.key),
				confidence: Number(bestKpi.confidence),
				value_raw_present: typeof bestKpi.value_raw === "string" && bestKpi.value_raw.trim().length > 0,
			}
			: null,
		criteria: {
			overall_score_lt_45: overallLt45,
			coverage_ratio_gte_085: coverageOk,
			baseline_present: baselineOk,
			kpi_present_conf_gte_060: kpiOk,
			drift_not_misaligned: driftOk,
			full_criteria_in_place: fullCriteria,
		},
		thresholds: {
			coverage_ratio_min: coverageRatioMin,
			kpi_confidence_min: kpiConfidenceMin,
			overall_hard_pass_max: overallHardPassMax,
		},
	};

	return { triggered, reason, note, criteria_snapshot };
}
