/**
 * extract-key-claims.ts
 *
 * Extractive (not generative) key claim selector.
 *
 * Scores each candidate sentence/line based on:
 * - Presence of strong verbs (action, state, fact)
 * - Numbers / currencies / percentages
 * - Heading signals (ALL_CAPS lines, "Title: content" lines)
 * - Length: prefer 20–200 chars
 *
 * Returns top 5–8 lines as PageClaimV1[], capped at 220 chars each.
 * Never throws — returns [] on empty input or error.
 */

import type { PageClaimV1 } from "@dealdecision/core";
import { capClaimText } from "@dealdecision/core";

// ─── Scoring signals ──────────────────────────────────────────────────────────

const STRONG_VERBS = /\b(build|built|provide|provid|enable|enabl|raise|raising|seek|seeking|launch|launch|partner|serving|serving|deliver|deploy|integrat|generat|scale|grew|grow|reached|achiev|secur|close|raised|reduced|increas|decreas|automat|replac|eliminat|accelerat|offer|platform|power|transform|disrupt)\w*/i;

const NUMBER_SIGNAL = /[\d,$€£¥%]/;

const HEADING_SIGNAL = /^[A-Z][A-Z\s]{3,}$|^[A-Za-z ]+:\s*.+/;

// Lines that are too generic to be useful
const JUNK_LINE = /^(slide|page|deck|powered by|confidential|disclaimer|all rights|www\.|https?:\/\/|©|™|\d{4}|prepared by|draft|internal|proprietary|copyright)/i;

function scoreLine(line: string): number {
  let score = 0;
  if (STRONG_VERBS.test(line)) score += 3;
  if (NUMBER_SIGNAL.test(line)) score += 2;
  if (HEADING_SIGNAL.test(line)) score += 1;
  // Prefer lines with 20–200 chars
  const len = line.length;
  if (len >= 20 && len <= 200) score += 2;
  else if (len > 200) score += 1;
  else score -= 1; // too short
  // Penalize junk
  if (JUNK_LINE.test(line)) score -= 5;
  return score;
}

// ─── Main export ──────────────────────────────────────────────────────────────

const MIN_SCORE = 2;
const MAX_CLAIMS = 8;

/**
 * Extract top extractive claims from page text.
 *
 * @param pageText — pre-resolved best page text from DPU
 * @returns Up to 8 PageClaimV1 (extractive, not generated). Empty on empty input or error.
 */
export function extractKeyClaims(pageText: string): PageClaimV1[] {
  try {
    if (!pageText || !pageText.trim()) return [];

    // Split into candidate lines
    const candidates = pageText
      .split(/\n|\r\n|(?<=[.!?])\s+/)
      .map((l) => l.trim())
      .filter((l) => l.length >= 15);

    // Score and sort
    const scored = candidates.map((line) => ({ line, score: scoreLine(line) }));
    scored.sort((a, b) => b.score - a.score);

    // Take top scoring, apply min score filter, deduplicate
    const seen = new Set<string>();
    const results: PageClaimV1[] = [];

    for (const { line, score } of scored) {
      if (score < MIN_SCORE) break;
      if (results.length >= MAX_CLAIMS) break;
      // Deduplicate by normalized lowercase
      const key = line.toLowerCase().replace(/\s+/g, " ");
      if (seen.has(key)) continue;
      // Skip if a nearly identical (≥ 80% prefix overlap) claim already added
      let duplicate = false;
      for (const existing of seen) {
        if (existing.startsWith(key.slice(0, Math.min(60, key.length))) && key.length < existing.length + 30) {
          duplicate = true;
          break;
        }
      }
      if (duplicate) continue;
      seen.add(key);
      results.push({ text: capClaimText(line) });
    }

    return results;
  } catch {
    return [];
  }
}
