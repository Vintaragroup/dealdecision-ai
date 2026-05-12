/**
 * Challenge Pass — Opposing Case Builder
 *
 * Pure function. Reconstructs the bear case from pre-derived ChallengeFactor[]
 * rather than raw flags so the output is always grounded in real signal, not
 * a generic lookup table.
 */

import type { EvaluationFlag } from "../evaluation-engine/types.js";
import type { ChallengeFactor, MissingEvidenceItem, OverconfidentClaim } from "./types.js";
import type { MemoryInfluenceSummary } from "../decision-memory/influence.js";

export interface OpposingCaseInput {
  deal_name: string;
  verdict: string;
  ors_score: number;
  flags: EvaluationFlag[];
  deck_risk_items?: string[];
  challenge_factors: ChallengeFactor[];
  missing_evidence: MissingEvidenceItem[];
  memory_influence: MemoryInfluenceSummary | null;
}

export interface OpposingCaseOutput {
  opposing_case_summary: string;
  overconfident_claims: OverconfidentClaim[];
}

// ─── Build overconfident claims from high-severity factors ────────────────────

function buildOverconfidentClaims(
  flags: EvaluationFlag[],
  factors: ChallengeFactor[],
  originalVerdict: string
): OverconfidentClaim[] {
  const claims: OverconfidentClaim[] = [];

  const critical = factors.filter((f) => f.severity === "Critical");
  const high = factors.filter((f) => f.severity === "High");

  for (const factor of [...critical, ...high].slice(0, 3)) {
    const sourceFlag = flags.find((fl) =>
      ["CRITICAL", "ERROR"].includes(fl.severity)
    );
    claims.push({
      claim_text: `Verdict "${originalVerdict}" is presented with ${
        factor.severity === "Critical" ? "critical" : "significant"
      } uncertainty.`,
      source: "score",
      challenge_reason: factor.explanation,
      flag_type: sourceFlag?.flag_type ?? factor.code,
    });
  }

  return claims;
}

// ─── Build grounded narrative paragraphs ─────────────────────────────────────

function buildNarrativeParagraphs(
  verdict: string,
  ors_score: number,
  factors: ChallengeFactor[],
  deck_risk_items: string[],
  missing_evidence: MissingEvidenceItem[],
  memory_influence: MemoryInfluenceSummary | null
): string[] {
  const paragraphs: string[] = [];

  // Top 1–3 factors drive the narrative — ordered Critical → High → Medium → Low.
  // memory_fragility is excluded here: it is handled by the appended suffix in service.ts
  // so that base prose (without memory) and base prose (with memory) are identical.
  const top = factors.filter((f) => f.code !== "memory_fragility").slice(0, 3);

  for (const f of top) {
    paragraphs.push(f.explanation);
  }

  // Deck risk items as supplemental signal (max 2)
  if (deck_risk_items.length > 0 && top.length < 3) {
    paragraphs.push(
      `Narrative risk items identified in the deck: ${deck_risk_items.slice(0, 2).join("; ")}.`
    );
  }

  // Memory fragility if not already in factors
  if (
    memory_influence?.memory_fragility_signal &&
    !factors.some((f) => f.code === "memory_fragility")
  ) {
    paragraphs.push(
      memory_influence.challenge_memory_summary ??
        `Memory pool analysis shows structurally similar deals have predominantly received unfavorable verdicts.`
    );
  }

  // Structural gaps as a closing note when they are the primary non-memory driver.
  // memory_fragility is excluded so this condition is stable regardless of memory context.
  const nonMemoryFactors = factors.filter((f) => f.code !== "memory_fragility");
  if (
    nonMemoryFactors.length === 0 ||
    (nonMemoryFactors.length === 1 && nonMemoryFactors[0].code === "structural_gaps_only")
  ) {
    if (missing_evidence.length > 0) {
      const high = missing_evidence.filter((m) => m.verdict_sensitivity === "High");
      const names = high.map((m) => m.evidence_type).slice(0, 3).join(", ");
      paragraphs.push(
        `The ${high.length > 0 ? `${high.length} high-sensitivity` : missing_evidence.length.toString()} missing evidence item${missing_evidence.length > 1 ? "s" : ""} (${names}) prevent a high-confidence verdict.`
      );
    }
  }

  if (paragraphs.length === 0) {
    paragraphs.push(
      `No material contradictions or pipeline failures were detected for this deal. The verdict appears internally consistent given available evidence. All recommendations carry inherent uncertainty.`
    );
  }

  return paragraphs;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function buildOpposingCase(input: OpposingCaseInput): OpposingCaseOutput {
  const {
    deal_name,
    verdict,
    ors_score,
    flags,
    deck_risk_items = [],
    challenge_factors,
    missing_evidence,
    memory_influence,
  } = input;

  const paragraphs = buildNarrativeParagraphs(
    verdict,
    ors_score,
    challenge_factors,
    deck_risk_items,
    missing_evidence,
    memory_influence
  );

  const overconfident_claims = buildOverconfidentClaims(flags, challenge_factors, verdict);

  // Use the top non-memory factor for the primary title so the intro is stable
  // regardless of memory context (memory is additive via the appended suffix).
  const primaryFactor = challenge_factors.find((f) => f.code !== "memory_fragility");
  const primaryCode = primaryFactor?.code ?? "structural_gaps_only";
  const primaryTitle = primaryFactor?.title ?? "No material challenge factors detected";

  const intro =
    `Challenge assessment for ${deal_name} (verdict: ${verdict}, ORS: ${ors_score}). ` +
    `Primary risk signal: ${primaryTitle}.`;

  const opposing_case_summary = [intro, ...paragraphs].join(" ");

  return { opposing_case_summary, overconfident_claims };
}

