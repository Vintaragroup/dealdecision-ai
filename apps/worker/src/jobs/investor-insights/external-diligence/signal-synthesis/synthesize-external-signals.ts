/**
 * PR36.3 — External Signal Synthesis
 *
 * Takes a completed ExternalDiligenceV1 (post signal-extraction) and produces
 * an ExternalSignalSynthesisV1 by cross-referencing typed bucket signals.
 *
 * Bucket → synthesis mapping:
 *   market_attractiveness  → market_outlook + financial_context
 *   competitive_pressure   → competitive_landscape + market_outlook
 *   company_visibility     → company_footprint
 *   founder_credibility    → founder_team_signals
 *   external_risk          → external_risks + market_outlook + competitive_landscape + company_footprint
 *   claim_validation_posture → claim_corroborations[]
 *
 * Design:
 *   - Pure function: no I/O, no LLM
 *   - Conservative: unknown > wrong
 *   - Deterministic: same input → same output
 *   - evidence_refs drawn from all bucket result URLs (max 20 unique)
 */

import type {
	ExternalDiligenceV1,
	ExternalSignalSynthesisV1,
	BucketSignal,
	CompanyFootprintSignal,
	CompetitiveLandscapeSignal,
	MarketOutlookSignal,
	FounderTeamSignal,
	FinancialContextSignal,
	ExternalRisksSignal,
} from "../external-diligence-schema";
import { scoreMarketAttractiveness } from "./score-market-attractiveness";
import { scoreCompetitivePressure } from "./score-competitive-pressure";
import { scoreCompanyVisibility } from "./score-company-visibility";
import { scoreFounderCredibility } from "./score-founder-credibility";
import { scoreExternalRisk } from "./score-external-risk";
import { scoreClaimValidation } from "./score-claim-validation";

// ─── Typed signal helpers ─────────────────────────────────────────────────────

function pickSignal<T extends BucketSignal>(
	diligence: ExternalDiligenceV1,
	kind: T["kind"]
): T | null {
	for (const bucket of diligence.buckets) {
		if (bucket.signal?.kind === kind) return bucket.signal as T;
	}
	return null;
}

function collectEvidenceRefs(diligence: ExternalDiligenceV1, max = 20): string[] {
	const seen = new Set<string>();
	const refs: string[] = [];
	for (const bucket of diligence.buckets) {
		for (const result of bucket.results) {
			const url = result.url.trim();
			if (!seen.has(url)) {
				seen.add(url);
				refs.push(url);
				if (refs.length >= max) return refs;
			}
		}
	}
	return refs;
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Synthesise cross-bucket investor conclusions from a completed ExternalDiligenceV1.
 *
 * Safe to call even when signals are sparse — all scorers handle null inputs
 * by returning "unknown" ratings.
 */
export function synthesizeExternalSignals(
	diligence: ExternalDiligenceV1
): ExternalSignalSynthesisV1 {
	// Extract per-bucket typed signals
	const marketSignal = pickSignal<MarketOutlookSignal>(diligence, "market_outlook");
	const financialSignal = pickSignal<FinancialContextSignal>(diligence, "financial_context");
	const competitiveSignal = pickSignal<CompetitiveLandscapeSignal>(diligence, "competitive_landscape");
	const footprintSignal = pickSignal<CompanyFootprintSignal>(diligence, "company_footprint");
	const founderSignal = pickSignal<FounderTeamSignal>(diligence, "founder_team_signals");
	const riskSignal = pickSignal<ExternalRisksSignal>(diligence, "external_risks");

	const market_attractiveness = scoreMarketAttractiveness(marketSignal, financialSignal);
	const competitive_pressure = scoreCompetitivePressure(competitiveSignal, marketSignal);
	const company_visibility = scoreCompanyVisibility(footprintSignal);
	const founder_credibility = scoreFounderCredibility(founderSignal);
	const external_risk = scoreExternalRisk(riskSignal, marketSignal, competitiveSignal, footprintSignal);
	const claim_validation_posture = scoreClaimValidation(diligence.claim_corroborations ?? []);

	const evidence_refs = collectEvidenceRefs(diligence);

	return {
		schema_version: "external_signal_synthesis_v1",
		market_attractiveness,
		competitive_pressure,
		company_visibility,
		founder_credibility,
		external_risk,
		claim_validation_posture,
		evidence_refs,
	};
}
