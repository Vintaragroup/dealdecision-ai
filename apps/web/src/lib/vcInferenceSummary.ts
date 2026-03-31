/**
 * vcInferenceSummary
 *
 * Pure utilities for flattening vc_scoring_v2.inference into human-readable
 * summary text for use in the workspace header and other compact surfaces.
 *
 * Purely presentational — no computation, derives display copy only.
 */

export interface VCScoringV2InferenceTraceLike {
  boosted: boolean;
  inferred_score: number;
  final_score: number;
  reasons: string[];
}

export interface VCScoringV2InferenceLike {
  market: VCScoringV2InferenceTraceLike;
  product: VCScoringV2InferenceTraceLike;
  team: VCScoringV2InferenceTraceLike;
  traction: VCScoringV2InferenceTraceLike;
}

/** Maps dimension keys to the short signal label used in prose summaries. */
const DIMENSION_LABELS: Record<keyof VCScoringV2InferenceLike, string> = {
  market: 'market',
  product: 'product',
  team: 'team',
  traction: 'traction',
};

/**
 * Returns the keys of dimensions that were inference-boosted.
 * Order: traction → product → market → team (most actionable first).
 */
export function getBoostedDimensions(
  inference: VCScoringV2InferenceLike
): Array<keyof VCScoringV2InferenceLike> {
  const order: Array<keyof VCScoringV2InferenceLike> = ['traction', 'product', 'market', 'team'];
  return order.filter((k) => inference[k].boosted);
}

/**
 * Extracts the top N signal phrases from boosted dimension reasons.
 * Strips long meta-reasons (e.g. "Market inferred at X vs structured Y") and
 * keeps short, concrete evidence bullets (e.g. "Revenue present — ...").
 *
 * A "signal reason" is one that starts with a concrete evidence noun:
 *   Revenue, ARR/MRR, Growth rate, TAM, GTM, ...
 */
function extractSignalPhrases(inference: VCScoringV2InferenceLike, maxPhrases = 4): string[] {
  const SIGNAL_WORDS = ['revenue', 'arr', 'mrr', 'growth', 'gtm', 'tam', 'market'];
  const seen = new Set<string>();
  const phrases: string[] = [];

  const order: Array<keyof VCScoringV2InferenceLike> = ['traction', 'product', 'market', 'team'];
  for (const dim of order) {
    if (!inference[dim].boosted) continue;
    for (const reason of inference[dim].reasons) {
      if (phrases.length >= maxPhrases) break;
      const lower = reason.toLowerCase();
      const isSignal = SIGNAL_WORDS.some((w) => lower.startsWith(w));
      if (!isSignal) continue;
      // Extract up to the em-dash or period — keep the short evidence noun/phrase.
      const phrase = reason.split('—')[0].split('.')[0].trim().toLowerCase();
      if (!seen.has(phrase) && phrase.length < 50) {
        seen.add(phrase);
        phrases.push(phrase);
      }
    }
  }
  return phrases;
}

/**
 * Composes a one-line human-readable inference summary for use in compact UIs.
 *
 * Returns `null` when no dimensions were boosted (nothing to report).
 *
 * Examples:
 *   "Boosted by revenue, ARR/MRR, growth rate, and GTM signals"
 *   "Boosted by market and product signals"
 *   "Traction boosted by revenue signal"
 */
export function getInferenceSummary(inference: VCScoringV2InferenceLike): string | null {
  const boosted = getBoostedDimensions(inference);
  if (boosted.length === 0) return null;

  const phrases = extractSignalPhrases(inference);

  if (phrases.length >= 2) {
    // Build prose from signal phrases
    const last = phrases[phrases.length - 1];
    const rest = phrases.slice(0, -1);
    const list = rest.join(', ') + ', and ' + last;
    return `Boosted by ${list}`;
  }

  if (phrases.length === 1) {
    const dim = DIMENSION_LABELS[boosted[0]];
    return `${capitalize(dim)} boosted by ${phrases[0]}`;
  }

  // No concrete signal phrases found — fall back to dimension names
  if (boosted.length === 1) {
    return `${capitalize(DIMENSION_LABELS[boosted[0]])} score inferred from available signals`;
  }

  const dimLabels = boosted.map((k) => DIMENSION_LABELS[k]);
  const last = dimLabels[dimLabels.length - 1];
  const rest = dimLabels.slice(0, -1);
  return `Boosted by ${rest.join(', ')} and ${last} signals`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
