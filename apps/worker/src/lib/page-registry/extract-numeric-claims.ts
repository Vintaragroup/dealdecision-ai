/**
 * extract-numeric-claims.ts
 *
 * Deterministic regex-based numeric claim extractor.
 * Supports: currency ($1.2M, USD 500k, 2 million, 8B), percent (20%, 20 percent),
 *           multiples (3x, 10x), and counts (10,000 users).
 *
 * Rules:
 * - Never throws — returns [] on any error or empty input.
 * - Max 20 claims per page, deduped by raw match.
 * - Context window: ±60 chars around match (capped at 160 chars total).
 * - Currency detection: "$" prefix or explicit "USD"/"EUR"/"GBP" prefix/suffix.
 */

import type { NumericClaimV1, NumericClaimUnitV1 } from "@dealdecision/core";
import { capContext } from "@dealdecision/core";

// ─── Magnitude normalisation ─────────────────────────────────────────────────

const MAGNITUDE: Record<string, number> = {
  k: 1_000,
  thousand: 1_000,
  m: 1_000_000,
  million: 1_000_000,
  b: 1_000_000_000,
  billion: 1_000_000_000,
  t: 1_000_000_000_000,
  trillion: 1_000_000_000_000,
};

function parseMagnitude(suffix: string): number {
  return MAGNITUDE[suffix.toLowerCase()] ?? 1;
}

// ─── Currency code detection ──────────────────────────────────────────────────

const CURRENCY_SYMBOLS: Record<string, string> = {
  "$":  "USD",
  "€":  "EUR",
  "£":  "GBP",
  "¥":  "JPY",
  "₹":  "INR",
  "CAD": "CAD",
  "AUD": "AUD",
  "USD": "USD",
  "EUR": "EUR",
  "GBP": "GBP",
};

function detectCurrency(raw: string): string | undefined {
  for (const [symbol, code] of Object.entries(CURRENCY_SYMBOLS)) {
    if (raw.includes(symbol)) return code;
  }
  return undefined;
}

// ─── NORMALIZED_LABEL heuristics ─────────────────────────────────────────────

/** Return normalized_label only when context is unambiguous. Never guess. */
function inferNormalizedLabel(
  raw: string,
  context: string,
): string | undefined {
  const haystack = (raw + " " + context).toLowerCase();

  // Raise / ask size
  if (/\b(rais|asking|the ask|seek|round size|fundrais)\w*/i.test(haystack)) return "raise_amount";
  // Valuation
  if (/\b(valuation|pre-money|post-money|pre money|post money|valued at)\b/i.test(haystack)) return "valuation";
  // ARR
  if (/\barr\b/i.test(haystack)) return "arr";
  // MRR
  if (/\bmrr\b/i.test(haystack)) return "mrr";
  // Revenue
  if (/\brevenue\b/i.test(haystack) && !/\bprojected\b|\bforecast\b/i.test(haystack)) return "revenue";

  return undefined;
}

// ─── Context window ───────────────────────────────────────────────────────────

function extractContext(text: string, index: number, matchLen: number): string {
  const start = Math.max(0, index - 60);
  const end = Math.min(text.length, index + matchLen + 60);
  return capContext(text.slice(start, end).replace(/\s+/g, " ").trim());
}

// ─── Regex patterns ───────────────────────────────────────────────────────────

interface RawMatch {
  raw: string;
  value: number;
  unit: NumericClaimUnitV1;
  currency?: string;
  context: string;
  index: number;
}

// Currency: $1.2M / USD 500k / $5 million / €2.5B / £10m / 5 billion dollars
const CURRENCY_PATTERN =
  /(?:USD|CAD|AUD|GBP|EUR|[$€£¥₹])\s*(\d[\d,]*(?:\.\d+)?)\s*(trillion|billion|million|thousand|[tTbBmMkK])\b|(\d[\d,]*(?:\.\d+)?)\s*(trillion|billion|million|thousand)\s*(?:USD|usd|dollars?|euros?|pounds?|\$|€|£)?/gi;

// Percent: 20%, 20.5 percent, 200 basis points
const PERCENT_PATTERN =
  /(\d[\d,]*(?:\.\d+)?)\s*(?:%|percent(?:age)?|basis\s+point(?:s)?)/gi;

// Multiples: 3x, 2.5x, 10x
const MULTIPLE_PATTERN = /\b(\d+(?:\.\d+)?)\s*[xX]\b/g;

// Counts with explicit unit: 10,000 users / 5,000 customers / 1M users
const COUNT_PATTERN =
  /(\d[\d,]*(?:\.\d+)?)\s*(thousand|million|[kKmM])?\s+(?:users?|customers?|downloads?|installs?|clients?|subscribers?|employees?|headcount)\b/gi;

function collectCurrencyMatches(text: string): RawMatch[] {
  const matches: RawMatch[] = [];
  for (const re of [CURRENCY_PATTERN]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const raw = m[0].trim();
      // Group 1+2: symbol+number+magnitude; Group 3+4: number+word-magnitude
      const numStr = (m[1] ?? m[3] ?? "0").replace(/,/g, "");
      const mag = parseMagnitude(m[2] ?? m[4] ?? "");
      const num = parseFloat(numStr) * mag;
      if (!Number.isFinite(num)) continue;
      const ctx = extractContext(text, m.index, raw.length);
      matches.push({
        raw,
        value: num,
        unit: "currency",
        currency: detectCurrency(raw) ?? "USD",
        context: ctx,
        index: m.index,
      });
    }
  }
  return matches;
}

function collectPercentMatches(text: string): RawMatch[] {
  const matches: RawMatch[] = [];
  PERCENT_PATTERN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PERCENT_PATTERN.exec(text)) !== null) {
    const raw = m[0].trim();
    const numStr = (m[1] ?? "0").replace(/,/g, "");
    const num = parseFloat(numStr);
    if (!Number.isFinite(num)) continue;
    if (num > 10_000) continue; // sanity: no percent > 10000
    const ctx = extractContext(text, m.index, raw.length);
    matches.push({ raw, value: num, unit: "percent", context: ctx, index: m.index });
  }
  return matches;
}

function collectMultipleMatches(text: string): RawMatch[] {
  const matches: RawMatch[] = [];
  MULTIPLE_PATTERN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MULTIPLE_PATTERN.exec(text)) !== null) {
    const raw = m[0].trim();
    const num = parseFloat((m[1] ?? "0").replace(/,/g, ""));
    if (!Number.isFinite(num)) continue;
    if (num > 1000) continue; // sanity
    const ctx = extractContext(text, m.index, raw.length);
    matches.push({ raw, value: num, unit: "multiple", context: ctx, index: m.index });
  }
  return matches;
}

function collectCountMatches(text: string): RawMatch[] {
  const matches: RawMatch[] = [];
  COUNT_PATTERN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = COUNT_PATTERN.exec(text)) !== null) {
    const raw = m[0].trim();
    const numStr = (m[1] ?? "0").replace(/,/g, "");
    const mag = parseMagnitude(m[2] ?? "");
    const num = parseFloat(numStr) * mag;
    if (!Number.isFinite(num)) continue;
    const ctx = extractContext(text, m.index, raw.length);
    matches.push({ raw, value: num, unit: "count", context: ctx, index: m.index });
  }
  return matches;
}

// ─── Main export ──────────────────────────────────────────────────────────────

const MAX_CLAIMS = 20;

/**
 * Extract numeric claims from page text.
 *
 * @param pageText - pre-resolved best page text from DPU
 * @returns Ordered array of NumericClaimV1 (currency first, then percent, multiple, count).
 *          At most 20 claims. Empty array if text is empty or on any error.
 */
export function extractNumericClaims(pageText: string): NumericClaimV1[] {
  try {
    if (!pageText || !pageText.trim()) return [];

    const allMatches: RawMatch[] = [
      ...collectCurrencyMatches(pageText),
      ...collectPercentMatches(pageText),
      ...collectMultipleMatches(pageText),
      ...collectCountMatches(pageText),
    ];

    // Sort by index (position in text)
    allMatches.sort((a, b) => a.index - b.index);

    // Deduplicate overlapping matches (same raw text within 10 chars)
    const seen = new Set<string>();
    const deduped: RawMatch[] = [];
    let lastEnd = -1;
    for (const m of allMatches) {
      const key = m.raw.toLowerCase().replace(/\s+/g, "");
      if (seen.has(key)) continue;
      // Skip if overlaps with previous match
      if (m.index < lastEnd) continue;
      seen.add(key);
      deduped.push(m);
      lastEnd = m.index + m.raw.length;
    }

    return deduped.slice(0, MAX_CLAIMS).map((m) => {
      const claim: NumericClaimV1 = {
        raw: m.raw,
        value: m.value,
        unit: m.unit,
        context: m.context,
      };
      if (m.currency) claim.currency = m.currency;
      const label = inferNormalizedLabel(m.raw, m.context);
      if (label) claim.normalized_label = label;
      return claim;
    });
  } catch {
    return [];
  }
}
