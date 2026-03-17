/**
 * PR36.3 — Company Visibility Scorer
 *
 * Input:  CompanyFootprintSignal
 * Output: SynthesisItem with rating + summary + drivers
 *
 * Logic:
 *   footprint_quality=strong   → high
 *   footprint_quality=moderate → moderate
 *   footprint_quality=weak     → low
 *   footprint_quality=none     → low
 *   no signal                  → unknown
 */

import type { CompanyFootprintSignal, SynthesisItem, SynthesizedRating } from "../external-diligence-schema";

export function scoreCompanyVisibility(
	footprintSignal: CompanyFootprintSignal | null
): SynthesisItem {
	if (!footprintSignal) {
		return {
			rating: "unknown",
			summary: "No company footprint data available.",
			drivers: [],
		};
	}

	const { footprint_quality, website_found, funding_profile_found, press_found } = footprintSignal;
	const drivers: string[] = [];

	if (website_found) drivers.push("Company website or product page found publicly");
	if (funding_profile_found) drivers.push("Funding profile found (Crunchbase, PitchBook, or equivalent)");
	if (press_found) drivers.push("Press or media coverage found");
	if (!website_found && !funding_profile_found && !press_found) {
		drivers.push("No verifiable public signals found for the company");
	}

	let rating: SynthesizedRating;
	switch (footprint_quality) {
		case "strong":
			rating = "high";
			break;
		case "moderate":
			rating = "moderate";
			break;
		case "weak":
		case "none":
			rating = "low";
			break;
		default:
			rating = "unknown";
	}

	const summary = buildSummary(rating, footprintSignal);
	return { rating, summary, drivers };
}

function buildSummary(rating: SynthesizedRating, signal: CompanyFootprintSignal): string {
	const label = "Company";
	if (rating === "high") return `${label} has a strong public presence — website, funding profile, and press found.`;
	if (rating === "moderate") {
		const parts = [
			signal.website_found && "website",
			signal.funding_profile_found && "funding profile",
			signal.press_found && "press",
		].filter(Boolean) as string[];
		return `${label} has moderate visibility: ${parts.join(" and ")} found publicly.`;
	}
	if (rating === "low") {
		if (signal.footprint_quality === "none") return `${label} has no detectable public presence — may be pre-launch or very early.`;
		return `${label} has limited public visibility — only partial signals found externally.`;
	}
	return "Insufficient data to assess company visibility.";
}
