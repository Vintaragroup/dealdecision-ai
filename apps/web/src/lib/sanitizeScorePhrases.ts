/**
 * sanitizeScorePhrases.ts
 *
 * Utility for stripping mismatched NN/100 patterns from user-facing copy.
 *
 * Problem: governed/overlay LLM copy sometimes includes phrases like
 * "Strong recommendation score of 67/100" where 67 is a raw or stale number
 * that disagrees with the canonical score (e.g. 82 from score_band_v2).
 *
 * These mismatches confuse users and must never reach the DOM.
 *
 * # Contract
 * - Only activates when `canonicalScore` is a finite integer.
 * - Pass 1: removes contextual phrases of the form "[adjective] [recommendation] score of NN/100"
 *   where NN does NOT equal the canonical score.
 * - Pass 2: removes any remaining standalone "NN/100" where NN does NOT equal canonical.
 * - Returns empty string if no text remains after cleaning; callers should drop that bullet.
 * - Does NOT modify phrases where NN === canonicalScore (those are fine).
 * - Does NOT change any other punctuation or formatting.
 */

/**
 * Pass 1: contextual score phrases like "Strong recommendation score of 67/100",
 * "overall score of 48/100", "a score of 72/100", etc.
 * Captured group is the numeric part.
 */
const CONTEXTUAL_SCORE_PHRASE_RE =
  /\b(?:(?:a|an|the)\s+)?(?:strong|solid|good|high|low|weak|overall|composite|final)?\s*(?:recommendation\s+)?(?:score|rating)\s+(?:of\s+)?(\d{1,3})\s*\/\s*100\b/gi;

/** Pass 2: any remaining standalone "67/100" or "67 / 100" (NN 0-100). */
const SCORE_FRACTION_RE = /\b(\d{1,3})\s*\/\s*100\b/g;

/**
 * Remove all mismatched NN/100 occurrences from `text` (two-pass), then tidy
 * any leftover whitespace/punctuation artefacts.
 *
 * If canonicalScore is null/undefined the text is returned unchanged.
 */
export function stripMismatchedScorePhrase(
  text: string,
  canonicalScore: number | null | undefined,
): string {
  if (canonicalScore == null || !Number.isFinite(canonicalScore)) return text;
  const canonical = Math.round(canonicalScore);

  const replacer = (match: string, numStr: string): string => {
    const n = parseInt(numStr, 10);
    return Number.isFinite(n) && n === canonical ? match : '';
  };

  // Pass 1: remove contextual phrases (before any other manipulation)
  let result = text.replace(CONTEXTUAL_SCORE_PHRASE_RE, replacer);

  // Pass 2: remove any remaining standalone mismatched fractions
  result = result.replace(SCORE_FRACTION_RE, replacer);

  // Tidy artefacts produced by stripping
  result = result
    .replace(/\(\s*\)/g, '')              // dangling "()"
    .replace(/\s{2,}/g, ' ')             // multiple spaces → one
    .replace(/\s+([.,;:])/g, '$1')       // spaces before punctuation
    .replace(/^[,;:\s]+/, '')            // leading punctuation/spaces
    .replace(/[,;:\s]+$/, '')            // trailing punctuation/spaces
    .trim();

  return result;
}

/**
 * Apply `stripMismatchedScorePhrase` to every item in an array.
 * Items that become empty (or whitespace-only) after stripping are removed.
 */
export function filterMismatchedScoreItems(
  items: string[],
  canonicalScore: number | null | undefined,
): string[] {
  return items
    .map((item) => stripMismatchedScorePhrase(item, canonicalScore))
    .filter((item) => item.trim().length > 0);
}

/**
 * Unconditionally strip ALL NN/100 patterns and "score of N" phrases from `text`.
 *
 * Use on narrative bullets (strengths / concerns / open questions) where any
 * hard-coded numeric score is misleading to users regardless of whether it matches
 * the canonical score.  Unlike `stripMismatchedScorePhrase`, this does NOT keep
 * matching values — it removes every occurrence.
 */
export function stripScoreFractions(text: string): string {
  // Use fresh regex instances (avoids global-flag lastIndex edge cases).
  const contextualRe =
    /\b(?:(?:a|an|the)\s+)?(?:strong|solid|good|high|low|weak|overall|composite|final)?\s*(?:recommendation\s+)?(?:score|rating)\s+(?:of\s+)?\d{1,3}\s*\/\s*100\b/gi;
  const fractionRe = /\b\d{1,3}\s*\/\s*100\b/g;
  // "score of N", "scored at N", "score is N" patterns not already caught above
  const scoreOfRe = /\bscored?\s+(?:of|at|is|was)\s+\d{1,3}\b/gi;

  let result = text
    .replace(contextualRe, '')
    .replace(fractionRe, '')
    .replace(scoreOfRe, '')
    .replace(/\(\s*\)/g, '')         // dangling "()"
    .replace(/\s{2,}/g, ' ')        // multiple spaces → one
    .replace(/\s+([.,;:])/g, '$1')  // spaces before punctuation
    .replace(/^[,;:\s]+/, '')       // leading punctuation/spaces
    .replace(/[,;:\s]+$/, '')       // trailing punctuation/spaces
    .trim();

  return result;
}

/**
 * Apply `stripScoreFractions` to every item in an array.
 * Items that become empty (or whitespace-only) after stripping are removed.
 */
export function stripScoreFractionsFromItems(items: string[]): string[] {
  return items
    .map(stripScoreFractions)
    .filter((item) => item.trim().length > 0);
}

