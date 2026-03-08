/**
 * PR36.3 — External Risk Scorer
 *
 * Inputs:
 *   ExternalRisksSignal        — direct risk signals (regulatory, reputation)
 *   MarketOutlookSignal        — declining market amplifies risk
 *   CompetitiveLandscapeSignal — high competition under pressure amplifies risk
 *   CompanyFootprintSignal     — weak footprint amplifies uncertainty
 *
 * Output: SynthesisItem with rating + summary + drivers
 *
 * Scoring:
 *   Base score from ExternalRisksSignal (0–3)
 *   Market amplifier (+1 if declining, +0.5 if mixed)
 *   Competition amplifier (+0.5 if high intensity + declining)
 *   Footprint amplifier (+0.5 if footprint=none)
 *
 *   Score ≥ 2.5 → high
 *   Score ≥ 1.5 → moderate
 *   Score > 0   → low
 *   Score = 0   → low (no risk signals is treated as low, not unknown)
 *   No external risk signal at all → unknown
 */

import type {
	ExternalRisksSignal,
	MarketOutlookSignal,
	CompetitiveLandscapeSignal,
	CompanyFootprintSignal,
	SynthesisItem,
	SynthesizedRating,
} from "../external-diligence-schema";

export function scoreExternalRisk(
	riskSignal: ExternalRisksSignal | null,
	marketSignal: MarketOutlookSignal | null,
	competitiveSignal: CompetitiveLandscapeSignal | null,
	footprintSignal: CompanyFootprintSignal | null
): SynthesisItem {
	// If no direct risk signal exists we still aggregate market/competition risk
	const hasRiskSignal = riskSignal !== null;

	const has_regulatory = riskSignal?.has_regulatory_concern ?? false;
	const has_reputation = riskSignal?.has_reputation_concern ?? false;
	const riskSignalCount = riskSignal?.risk_signals.length ?? 0;
	const direction = marketSignal?.direction ?? "unknown";
	const intensity = competitiveSignal?.competitive_intensity ?? "unknown";
	const footprintQuality = footprintSignal?.footprint_quality ?? "unknown";

	// Build drivers
	const drivers: string[] = [];
	if (has_regulatory) drivers.push("Regulatory or compliance concerns identified");
	if (has_reputation) drivers.push("Reputational or PR concerns identified");
	if (riskSignalCount > 0) {
		drivers.push(`${riskSignalCount} external risk signal${riskSignalCount > 1 ? "s" : ""} detected`);
	}
	if (direction === "declining") drivers.push("Declining market direction increases structural risk");
	if (direction === "mixed") drivers.push("Mixed market signals present uncertainty");
	if (intensity === "high" && direction === "declining") {
		drivers.push("High competition in a declining market elevates competitive risk");
	}
	if (footprintQuality === "none") drivers.push("No company footprint amplifies diligence risk");

	if (!hasRiskSignal && drivers.length === 0) {
		return {
			rating: "unknown",
			summary: "No external risk data available.",
			drivers: [],
		};
	}

	// Score computation
	let score = 0;
	if (has_regulatory) score += 1.5;
	if (has_reputation) score += 1;
	score += Math.min(riskSignalCount * 0.5, 1);

	if (direction === "declining") score += 1;
	else if (direction === "mixed") score += 0.5;

	if (intensity === "high" && direction === "declining") score += 0.5;
	if (footprintQuality === "none") score += 0.5;

	let rating: SynthesizedRating;
	if (!hasRiskSignal && score === 0) {
		rating = "unknown";
	} else if (score >= 2.5) {
		rating = "high";
	} else if (score >= 1.5) {
		rating = "moderate";
	} else {
		rating = "low";
	}

	const summary = buildSummary(rating, has_regulatory, has_reputation, direction);
	return { rating, summary, drivers };
}

function buildSummary(
	rating: SynthesizedRating,
	regulatory: boolean,
	reputation: boolean,
	direction: MarketOutlookSignal["direction"]
): string {
	if (rating === "unknown") return "Insufficient external data to assess risk.";
	if (rating === "high") {
		const concerns = [regulatory && "regulatory concerns", reputation && "reputational risks"].filter(Boolean) as string[];
		if (concerns.length > 0) return `High external risk: ${concerns.join(" and ")} detected.`;
		return "High external risk indicated by multiple converging risk signals.";
	}
	if (rating === "low") {
		if (direction === "declining") return "Low direct risk signals, but declining market adds structural headwind.";
		return "No significant external risk signals detected.";
	}
	// moderate
	const parts: string[] = [];
	if (regulatory) parts.push("regulatory concerns");
	if (reputation) parts.push("reputational signals");
	if (direction === "declining") parts.push("declining market");
	if (parts.length > 0) return `Moderate external risk: ${parts.join(", ")} noted.`;
	return "Moderate external risk based on combination of market and competitive signals.";
}
