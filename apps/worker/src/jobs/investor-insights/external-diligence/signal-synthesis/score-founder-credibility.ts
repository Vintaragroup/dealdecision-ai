/**
 * PR36.3 — Founder Credibility Scorer
 *
 * Input:  FounderTeamSignal
 * Output: SynthesisItem with rating + summary + drivers
 *
 * Logic:
 *   credibility_signals.length >= 2 → high
 *   profile_found && prior_role_found → moderate  (or if credibility_signals === 1)
 *   profile_found only               → moderate
 *   limited_footprint                → low
 *   no signal                        → unknown
 */

import type { FounderTeamSignal, SynthesisItem, SynthesizedRating } from "../external-diligence-schema";

export function scoreFounderCredibility(
	founderSignal: FounderTeamSignal | null
): SynthesisItem {
	if (!founderSignal) {
		return {
			rating: "unknown",
			summary: "No founder or team signal data available.",
			drivers: [],
		};
	}

	const { profile_found, prior_role_found, credibility_signals, limited_footprint } = founderSignal;
	const drivers: string[] = [];

	if (profile_found) drivers.push("Founder public profile found");
	if (prior_role_found) drivers.push("Prior role or employment evidence found");
	if (credibility_signals.length > 0) {
		drivers.push(`Credibility signals: ${credibility_signals.slice(0, 3).join(", ")}`);
	}
	if (limited_footprint) drivers.push("Limited or no meaningful public founder footprint");

	let rating: SynthesizedRating;
	if (credibility_signals.length >= 2) {
		rating = "high";
	} else if (credibility_signals.length === 1 && profile_found) {
		rating = "high";
	} else if (profile_found && prior_role_found) {
		rating = "moderate";
	} else if (profile_found) {
		rating = "moderate";
	} else if (limited_footprint) {
		rating = "low";
	} else {
		rating = "unknown";
	}

	const summary = buildSummary(rating, founderSignal);
	return { rating, summary, drivers };
}

function buildSummary(rating: SynthesizedRating, signal: FounderTeamSignal): string {
	if (rating === "high") {
		return signal.credibility_signals.length > 0
			? `Founder has strong signals including: ${signal.credibility_signals.slice(0, 2).join(", ")}.`
			: "Founder has a strong public profile with prior role evidence.";
	}
	if (rating === "moderate") {
		if (signal.prior_role_found) return "Founder has a public profile with prior role evidence — moderate credibility signal.";
		return "Founder has a public profile but limited additional credibility signals.";
	}
	if (rating === "low") return "Limited founder footprint found — minimal public evidence of experience or background.";
	return "Insufficient data to assess founder credibility.";
}
