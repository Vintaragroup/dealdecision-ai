/**
 * PR36.3 — Market Attractiveness Scorer
 *
 * Inputs:  MarketOutlookSignal + FinancialContextSignal
 * Output:  SynthesisItem with rating + summary + drivers
 *
 * Logic table:
 *   direction=growing  + env!=weak   → high
 *   direction=growing  + env=weak    → moderate  (tailwinds suppressed)
 *   direction=mixed    + env=support → moderate
 *   direction=flat     + any env     → moderate
 *   direction=declining              → low
 *   direction=unknown  + env=support → moderate
 *   direction=unknown  + env=weak    → low
 *   everything else / no data        → unknown
 */

import type { MarketOutlookSignal, FinancialContextSignal, SynthesisItem, SynthesizedRating } from "../external-diligence-schema";

export function scoreMarketAttractiveness(
	marketSignal: MarketOutlookSignal | null,
	financialSignal: FinancialContextSignal | null
): SynthesisItem {
	const direction = marketSignal?.direction ?? "unknown";
	const env = financialSignal?.funding_environment ?? "unknown";
	const tailwinds = marketSignal?.tailwinds ?? [];
	const headwinds = marketSignal?.headwinds ?? [];

	const drivers: string[] = [];

	// Direction driver
	if (direction !== "unknown") {
		drivers.push(`Category trend classified as ${direction}`);
	}
	if (tailwinds.length > 0) {
		drivers.push(`Growth tailwinds identified: ${tailwinds.slice(0, 2).join("; ")}`);
	}
	if (headwinds.length > 0) {
		drivers.push(`Headwinds present: ${headwinds.slice(0, 2).join("; ")}`);
	}

	// Funding environment driver
	if (env !== "unknown") {
		drivers.push(`Funding environment for sector is ${env}`);
	}

	// Rating logic
	let rating: SynthesizedRating;
	if (direction === "growing" && env !== "weak") {
		rating = "high";
	} else if (direction === "growing" && env === "weak") {
		rating = "moderate";
	} else if (direction === "mixed" && env === "supportive") {
		rating = "moderate";
	} else if (direction === "flat") {
		rating = "moderate";
	} else if (direction === "declining") {
		rating = "low";
	} else if (direction === "unknown" && env === "supportive") {
		rating = "moderate";
	} else if (direction === "unknown" && env === "weak") {
		rating = "low";
	} else if (direction === "mixed") {
		rating = "moderate";
	} else if (direction === "unknown" && env === "unknown") {
		rating = "unknown";
	} else {
		rating = "unknown";
	}

	const summary = buildSummary(rating, direction, env);

	return { rating, summary, drivers };
}

function buildSummary(
	rating: SynthesizedRating,
	direction: MarketOutlookSignal["direction"],
	env: FinancialContextSignal["funding_environment"]
): string {
	if (rating === "unknown") return "Insufficient external data to assess market attractiveness.";
	if (rating === "high") return `Market shows ${direction} trajectory with a ${env} funding environment — attractive for investors.`;
	if (rating === "low") {
		if (direction === "declining") return "Category shows signs of decline — market attractiveness is limited.";
		return `Weak funding environment constrains market attractiveness despite any growth signals.`;
	}
	// moderate
	if (direction === "flat") return "Category appears stable but lacks strong growth signals.";
	if (direction === "growing" && env === "weak") return "Category is growing but investor funding appetite is weak.";
	if (direction === "mixed") return "Category shows mixed signals — both tailwinds and headwinds present.";
	return "Market shows moderate attractiveness based on available signals.";
}
