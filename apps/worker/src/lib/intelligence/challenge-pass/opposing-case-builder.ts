/**
 * Challenge Pass — Opposing Case Builder
 *
 * Pure function. Constructs the bear case from evaluator flags and
 * any risk items surfaced in the render package.
 */

import type { EvaluationFlag } from "../evaluation-engine/types.js";
import type { OverconfidentClaim } from "./types.js";

export interface OpposingCaseInput {
  deal_name: string;
  verdict: string;
  ors_score: number;
  flags: EvaluationFlag[];
  deck_risk_items?: string[];
}

export interface OpposingCaseOutput {
  opposing_case_summary: string;
  overconfident_claims: OverconfidentClaim[];
}

// ─── Map flag types to bear-case sentences ────────────────────────────────────

const FLAG_BEAR_SENTENCES: Record<string, string> = {
  ARR_NARRATIVE_CONTRADICTION:
    "The ARR figures in the narrative diverge materially from structured financial data — revenue quality is unverified.",
  SCORE_VERDICT_MISALIGNMENT:
    "The recommendation verdict is misaligned with the quantitative scores, raising questions about scoring integrity.",
  URSS_GO_CONFLICT:
    "Unit economics are signaling concern while the verdict indicates GO — capital efficiency risk is elevated.",
  DCI_FHC_DIVERGENCE:
    "Debt complexity is high relative to financial health, suggesting hidden capital structure risk.",
  EVIDENCE_COUNT_CRITICAL:
    "Insufficient evidence was available to support this analysis — the conclusions rest on thin factual basis.",
  DPU_PROVENANCE_MISSING:
    "Document-level extraction quality is unverified — data provenance cannot be confirmed.",
  XLSX_LLM_FALLBACK:
    "Structured financial data was supplemented by LLM inference — XLSX extraction was incomplete.",
  EVIDENCE_GATE_FAILED:
    "This deal did not pass the evidence gate — analysis may be based on incomplete data.",
  DETERMINISTIC_ONLY_MODE:
    "The pipeline ran in deterministic-only mode — LLM-enhanced extraction was not applied.",
  STALE_CACHE:
    "The analysis is based on a stale cache snapshot — market conditions may have shifted since last scoring.",
  EVIDENCE_COUNT_LOW:
    "Evidence coverage is below the recommended threshold — conclusions carry higher uncertainty.",
  EVIDENCE_SECTIONS_ZERO:
    "No structured evidence sections were identified — the analysis has no grounded support.",
  VERDICT_RESISTANCE_LOW:
    "This deal's verdict is fragile — minor new information could shift the recommendation.",
};

// ─── Build overconfident claims from flags ────────────────────────────────────

function buildOverconfidentClaims(
  flags: EvaluationFlag[],
  originalVerdict: string
): OverconfidentClaim[] {
  const claims: OverconfidentClaim[] = [];

  for (const flag of flags) {
    if (flag.severity === "CRITICAL" || flag.severity === "ERROR") {
      const bearLabel =
        FLAG_BEAR_SENTENCES[flag.flag_type] ??
        `Flag type ${flag.flag_type} indicates unreliable signal.`;

      claims.push({
        claim_text: `Verdict "${originalVerdict}" is presented with ${
          flag.severity === "CRITICAL" ? "critical" : "significant"
        } uncertainty.`,
        source: "score",
        challenge_reason: bearLabel,
        flag_type: flag.flag_type,
      });
    }
  }

  return claims;
}

// ─── Build narrative paragraphs ───────────────────────────────────────────────

function buildNarrativeParagraphs(
  verdict: string,
  orsScore: number,
  flags: EvaluationFlag[],
  deckRisks: string[]
): string[] {
  const paragraphs: string[] = [];

  const criticals = flags.filter((f) => f.severity === "CRITICAL");
  const errors = flags.filter((f) => f.severity === "ERROR");
  const warns = flags.filter((f) => f.severity === "WARN");

  if (criticals.length > 0) {
    const bullets = criticals
      .map((f) => FLAG_BEAR_SENTENCES[f.flag_type] ?? `${f.flag_type} is flagged as critical.`)
      .join(" ");
    paragraphs.push(`Critical issues: ${bullets}`);
  }

  if (errors.length > 0 && criticals.length === 0) {
    const bullets = errors
      .slice(0, 2)
      .map((f) => FLAG_BEAR_SENTENCES[f.flag_type] ?? `${f.flag_type} is flagged.`)
      .join(" ");
    paragraphs.push(`Analysis errors: ${bullets}`);
  }

  if (warns.length > 0) {
    paragraphs.push(
      `${warns.length} warning-level flag${warns.length > 1 ? "s" : ""} indicate elevated uncertainty.`
    );
  }

  if (orsScore < 55 && verdict === "GO") {
    paragraphs.push(
      `The Overall Readiness Score (${orsScore}) is below 55 — the GO verdict may overstate deal quality.`
    );
  }

  if (deckRisks.length > 0) {
    paragraphs.push(`Deck-identified risks: ${deckRisks.slice(0, 3).join("; ")}.`);
  }

  if (paragraphs.length === 0) {
    paragraphs.push(
      `No material contradictions or failures were detected, but all recommendations carry inherent uncertainty.`
    );
  }

  return paragraphs;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function buildOpposingCase(input: OpposingCaseInput): OpposingCaseOutput {
  const { deal_name, verdict, ors_score, flags, deck_risk_items = [] } = input;

  const paragraphs = buildNarrativeParagraphs(verdict, ors_score, flags, deck_risk_items);
  const overconfidentClaims = buildOverconfidentClaims(flags, verdict);

  const intro = `Bear case for ${deal_name} (verdict: ${verdict}, ORS: ${ors_score}):`;
  const opposing_case_summary = [intro, ...paragraphs].join(" ");

  return { opposing_case_summary, overconfident_claims: overconfidentClaims };
}
