export const collapseWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

const countMatches = (s: string, re: RegExp): number => (s.match(re) ?? []).length;

/**
 * Returns true when a deterministic text string is safe to show as a UI display value.
 * Purpose: avoid showing OCR soup / slide dumps while still allowing short clean strings.
 */
export const deterministicIsDisplayable = (value: unknown): boolean => {
  if (typeof value !== 'string') return false;
  const s = collapseWhitespace(value);
  if (!s) return false;

  // Hard cap: long strings are almost always slide dumps.
  if (s.length > 140) return false;

  const lower = s.toLowerCase();

  // Known OCR header-ish patterns.
  if (lower.includes('from visa/mastercard')) return false;
  if (lower.includes('visa/mastercard')) return false;

  // Excessive currency/percent fragments.
  if (/[%€$]{2,}/.test(s)) return false;

  // Too numeric-heavy for a short fact tile.
  const numericTokens = countMatches(s, /\b\d+(?:\.\d+)?\b/g);
  if (numericTokens >= 8) return false;

  // Symbol density heuristic.
  const noSpace = s.replace(/\s+/g, '');
  if (noSpace.length >= 24) {
    const letters = countMatches(noSpace, /[A-Za-z]/g);
    const symbols = countMatches(noSpace, /[^A-Za-z0-9]/g);
    const letterRatio = letters / noSpace.length;
    const symbolRatio = symbols / noSpace.length;
    if (letterRatio < 0.35) return false;
    if (symbolRatio > 0.4) return false;
  }

  // Slide-title dump: lots of Title Case words, separators, or repeated short tokens.
  const pipeHits = countMatches(s, /\|/g);
  const colonHits = countMatches(s, /:/g);
  const bulletHits = countMatches(s, /•/g);
  if (pipeHits + colonHits + bulletHits >= 4) return false;

  return true;
};
