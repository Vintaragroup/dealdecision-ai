/**
 * PR36.3 — Competitive Pressure Scorer
 *
 * Inputs:  CompetitiveLandscapeSignal + MarketOutlookSignal (optional amplifier)
 * Output:  SynthesisItem with rating + summary + drivers
 *
 * Logic table:
 *   intensity=high                              → high
 *   intensity=medium                            → moderate
 *   intensity=medium + direction=declining      → high  (incumbents dig in)
 *   intensity=low   + direction=declining       → moderate (even few can dominate)
 *   intensity=low                               → low
 *   intensity=unknown + fragmentation=fragmented → moderate
 *   intensity=unknown + competitor_names.length>3 → moderate
 *   intensity=unknown                            → unknown
 */

import type { CompetitiveLandscapeSignal, MarketOutlookSignal, SynthesisItem, SynthesizedRating } from "../external-diligence-schema";

export function scoreCompetitivePressure(
	competitiveSignal: CompetitiveLandscapeSignal | null,
	marketSignal: MarketOutlookSignal | null
): SynthesisItem {
	const intensity = competitiveSignal?.competitive_intensity ?? "unknown";
	const fragmentation = competitiveSignal?.category_fragmentation ?? "unknown";
	const direction = marketSignal?.direction ?? "unknown";
	const directCompetitors = competitiveSignal?.direct_competitor_names ?? [];
	const adjacentNames = competitiveSignal?.adjacent_names ?? [];
	const totalNames = directCompetitors.length + adjacentNames.length;

	const drivers: string[] = [];

	if (intensity !== "unknown") {
		drivers.push(`Competitive intensity classified as ${intensity}`);
	}
	if (fragmentation !== "unknown") {
		drivers.push(`Market structure is ${fragmentation}`);
	}
	if (directCompetitors.length > 0) {
		drivers.push(`Direct competitors identified: ${directCompetitors.slice(0, 3).join(", ")}`);
	}
	if (adjacentNames.length > 0 && directCompetitors.length === 0) {
		drivers.push(`Adjacent alternatives identified: ${adjacentNames.slice(0, 2).join(", ")}`);
	}
	if (direction === "declining") {
		drivers.push("Declining market direction amplifies competitive pressure");
	}

	// Rating logic
	let rating: SynthesizedRating;
	if (intensity === "high") {
		rating = "high";
	} else if (intensity === "medium" && direction === "declining") {
		rating = "high";
	} else if (intensity === "medium") {
		rating = "moderate";
	} else if (intensity === "low" && direction === "declining") {
		rating = "moderate";
	} else if (intensity === "low") {
		rating = "low";
	} else if (fragmentation === "fragmented" || totalNames >= 4) {
		rating = "moderate";
	} else if (totalNames >= 2) {
		rating = "moderate";
	} else if (fragmentation === "consolidated") {
		rating = "moderate";
	} else {
		rating = "unknown";
	}

	const summary = buildSummary(rating, intensity, directCompetitors, direction);

	return { rating, summary, drivers };
}

function buildSummary(
	rating: SynthesizedRating,
	intensity: CompetitiveLandscapeSignal["competitive_intensity"],
	directCompetitors: string[],
	direction: MarketOutlookSignal["direction"]
): string {
	if (rating === "unknown") return "Insufficient data to assess competitive pressure.";
	if (rating === "high") {
		if (direction === "declining") return "Competitive pressure is high — market contraction intensifies incumbent rivalry.";
		return directCompetitors.length > 0
			? `High competitive intensity with identified rivals including ${directCompetitors.slice(0, 2).join(", ")}.`
			: "High competitive intensity detected in this category.";
	}
	if (rating === "low") return "Limited competitive pressure detected — category may be early or niche.";
	// moderate
	if (intensity === "medium") return directCompetitors.length > 0
		? `Moderate competitive pressure — ${directCompetitors.slice(0, 2).join(", ")} among key players.`
		: "Moderate competitive pressure in this category.";
	return "Moderate competitive pressure based on available market signals.";
}
