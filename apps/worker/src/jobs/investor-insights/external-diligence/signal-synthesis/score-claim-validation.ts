/**
 * PR36.3 — Claim Validation Posture Scorer
 *
 * Input:  ClaimCorroboration[]
 * Output: ClaimValidationItem with DirectionalRating + summary + drivers
 *
 * Logic:
 *   No corroborations                     → unknown
 *   All corroborated                      → positive
 *   Any contradicted > corroborated count → negative
 *   Contradicted == 0 + not_found > 0     → neutral
 *   Mix of corroborated + contradicted    → mixed
 *   Only not_found                        → neutral
 */

import type { ClaimCorroboration, ClaimValidationItem, DirectionalRating } from "../external-diligence-schema";

export function scoreClaimValidation(
	corroborations: ClaimCorroboration[]
): ClaimValidationItem {
	if (corroborations.length === 0) {
		return {
			rating: "unknown",
			summary: "No claim corroboration data available.",
			drivers: [],
		};
	}

	const corroboratedItems = corroborations.filter((c) => c.verdict === "corroborated");
	const contradictedItems = corroborations.filter((c) => c.verdict === "contradicted");
	const notFoundItems = corroborations.filter((c) => c.verdict === "not_found");

	const corroboratedCount = corroboratedItems.length;
	const contradictedCount = contradictedItems.length;
	const notFoundCount = notFoundItems.length;
	const total = corroborations.length;

	const drivers: string[] = [];
	if (corroboratedCount > 0) {
		drivers.push(`${corroboratedCount} deck claim${corroboratedCount > 1 ? "s" : ""} corroborated by external sources`);
		const fields = corroboratedItems.map((c) => c.claim_field).slice(0, 3);
		drivers.push(`Corroborated: ${fields.join(", ")}`);
	}
	if (contradictedCount > 0) {
		drivers.push(`${contradictedCount} deck claim${contradictedCount > 1 ? "s" : ""} contradicted by external sources`);
		const fields = contradictedItems.map((c) => c.claim_field).slice(0, 3);
		drivers.push(`Contradicted: ${fields.join(", ")}`);
	}
	if (notFoundCount > 0) {
		drivers.push(`${notFoundCount} claim${notFoundCount > 1 ? "s" : ""} could not be confirmed externally`);
	}

	let rating: DirectionalRating;
	if (contradictedCount === 0 && corroboratedCount === total) {
		rating = "positive";
	} else if (contradictedCount > corroboratedCount) {
		rating = "negative";
	} else if (contradictedCount > 0 && corroboratedCount > 0) {
		rating = "mixed";
	} else if (contradictedCount === 0 && notFoundCount > 0 && corroboratedCount === 0) {
		rating = "neutral";
	} else if (corroboratedCount > 0 && notFoundCount > 0) {
		rating = "mixed";
	} else {
		rating = "neutral";
	}

	const summary = buildSummary(rating, corroboratedCount, contradictedCount, notFoundCount);
	return { rating, summary, drivers };
}

function buildSummary(
	rating: DirectionalRating,
	corroborated: number,
	contradicted: number,
	notFound: number
): string {
	const total = corroborated + contradicted + notFound;
	if (rating === "positive") {
		return `All ${total} checked deck claim${total > 1 ? "s" : ""} corroborated by external sources.`;
	}
	if (rating === "negative") {
		return `${contradicted} deck claim${contradicted > 1 ? "s" : ""} contradicted by external evidence — warrants closer scrutiny.`;
	}
	if (rating === "mixed") {
		return `Mixed corroboration: ${corroborated} supported, ${contradicted} contradicted out of ${total} checked.`;
	}
	if (rating === "neutral") {
		return `External sources did not confirm or deny the ${notFound} checked claim${notFound > 1 ? "s" : ""}.`;
	}
	return "Claim validation posture unclear from available data.";
}
