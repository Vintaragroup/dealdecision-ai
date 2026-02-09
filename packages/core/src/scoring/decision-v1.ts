export type DecisionV1RecommendationKey =
	| "hard_pass"
	| "consider"
	| "strong_consider"
	| "fund_caution"
	| "fund_track"
	| "fund_confident";

export type DecisionV1Severity = "danger" | "warn" | "info" | "success";

export type DecisionV1 = {
	recommendation_key: DecisionV1RecommendationKey;
	label: string;
	severity: DecisionV1Severity;
	reasons: string[];
};

export type DecisionV1Inputs = {
	score_band_key: string | null;
	score_band_label: string | null;
	hard_pass_guardrail_triggered: boolean;
	hard_pass_guardrail_reason: string | null;
	hard_pass_guardrail_note: string | null;

	// Optional deterministic gating flags (best-effort).
	drift_assessment?: string | null;
	override_quality_assessment?: string | null;
	override_ratio?: number | null;
	unadjusted_pinned?: boolean | null;
	unadjusted_reason?: string | null;
	coverage_ratio?: number | null;
	blocked_by_drift_misaligned?: boolean | null;
	blocked_by_unadjusted_pinned?: boolean | null;
};

const asNonEmpty = (v: unknown): string | null =>
	typeof v === "string" && v.trim().length > 0 ? v.trim() : null;

const asFinite = (v: unknown): number | null =>
	typeof v === "number" && Number.isFinite(v) ? v : null;

function uniqueReasons(xs: Array<string | null | undefined>): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	for (const x of xs) {
		const s = asNonEmpty(x);
		if (!s) continue;
		if (seen.has(s)) continue;
		seen.add(s);
		out.push(s);
	}
	return out;
}

function mappingFromScoreBand(bandKey: string | null): {
	recommendation_key: DecisionV1RecommendationKey;
	label: string;
	severity: DecisionV1Severity;
} {
	switch (bandKey) {
		case "hard_pass":
			return { recommendation_key: "hard_pass", label: "Hard Pass", severity: "danger" };
		case "consider_caution":
			return { recommendation_key: "consider", label: "Consider (Caution)", severity: "warn" };
		case "strong_consider":
			return { recommendation_key: "strong_consider", label: "Strong Consider (Needs Confidence)", severity: "info" };
		case "fund_caution":
			return { recommendation_key: "fund_caution", label: "Fund (Caution)", severity: "warn" };
		case "fund_track":
			return { recommendation_key: "fund_track", label: "Fund & Track", severity: "success" };
		case "fund_confident":
			return { recommendation_key: "fund_confident", label: "Fund (High Confidence)", severity: "success" };
		default:
			return { recommendation_key: "consider", label: "Consider", severity: "info" };
	}
}

/**
 * Computes a stable UI-facing decision object (v1).
 * Guardrail (if triggered) always overrides band mapping.
 */
export function computeDecisionV1(input: DecisionV1Inputs): DecisionV1 {
	const bandKey = asNonEmpty(input.score_band_key);
	const bandLabel = asNonEmpty(input.score_band_label);

	if (input.hard_pass_guardrail_triggered === true) {
		const reasons = uniqueReasons([
			"guardrail:hard_pass",
			input.hard_pass_guardrail_reason ? `guardrail_reason:${input.hard_pass_guardrail_reason}` : null,
			input.hard_pass_guardrail_note ? `guardrail_note:${input.hard_pass_guardrail_note}` : null,
			bandKey ? `band:${bandKey}` : null,
		]);
		return {
			recommendation_key: "hard_pass",
			label: "Hard Pass",
			severity: "danger",
			reasons,
		};
	}

	const mapped = mappingFromScoreBand(bandKey);
	const label = bandLabel ?? mapped.label;

	const drift = asNonEmpty(input.drift_assessment);
	const overrideAssessment = asNonEmpty(input.override_quality_assessment);
	const overrideRatio = asFinite(input.override_ratio);
	const pinned = Boolean(input.unadjusted_pinned || input.blocked_by_unadjusted_pinned);
	const pinnedReason = asNonEmpty(input.unadjusted_reason);
	const coverage = asFinite(input.coverage_ratio);
	const driftBlocked = Boolean(input.blocked_by_drift_misaligned) || drift === "misaligned";

	const reasons = uniqueReasons([
		bandKey ? `band:${bandKey}` : null,
		driftBlocked ? "drift:misaligned" : null,
		pinned ? "baseline:pinned" : null,
		pinnedReason ? `baseline_reason:${pinnedReason}` : null,
		overrideAssessment ? `overrides:${overrideAssessment}` : null,
		overrideRatio != null && overrideRatio >= 0.25 ? `override_ratio:${overrideRatio.toFixed(2)}` : null,
		coverage != null && coverage < 0.85 ? `coverage_ratio:${coverage.toFixed(2)}` : null,
	]);

	const severity: DecisionV1Severity = (() => {
		// Escalate to danger for hard pass band even without guardrail.
		if (bandKey === "hard_pass") return "danger";
		// Escalate caution when deterministic gating is blocking or baseline is pinned.
		if (driftBlocked || pinned) return "warn";
		return mapped.severity;
	})();

	return {
		recommendation_key: mapped.recommendation_key,
		label,
		severity,
		reasons,
	};
}
