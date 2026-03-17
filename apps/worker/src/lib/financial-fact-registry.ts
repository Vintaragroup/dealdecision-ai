/**
 * financial-fact-registry.ts
 *
 * Canonical public entry point for the financial fact registry subsystem.
 *
 * Consumers should import from this module rather than from the individual
 * files inside lib/financial-facts/. This ensures a stable API surface and
 * allows the internal folder structure to evolve without updating every caller.
 *
 * Exports:
 *   populateFinancialFactRegistryV1  — full pipeline: extract → merge → upsert
 *   extractFinancialTableClaims      — extract FinancialFactV1[] from raw text
 *   detectFinancialTableCandidate    — page-level guard heuristic
 *   mergeFinancialFacts              — confidence-based dedup (public alias)
 *   rankFinancialFacts               — sort facts by source_kind precedence
 *   SOURCE_KIND_RANK                 — the rank map for testing / callers
 */

import type { FinancialFactV1 } from "@dealdecision/core";

// ─── Re-exports from populate orchestrator ────────────────────────────────────

export {
  populateFinancialFactRegistryV1,
  mergeFactsByConfidence as mergeFinancialFacts,
  type PopulateFinancialFactRegistryV1Opts,
  type PopulateFinancialFactRegistryV1Result,
} from "./financial-facts/populate-financial-fact-registry-v1";

// ─── Re-exports from extraction helpers ──────────────────────────────────────

export {
  extractFinancialTableClaims,
  detectFinancialTableCandidate,
  type ExtractFinancialTableClaimsOpts,
} from "./financial-facts/extract-financial-table-claims";

// ─── Source-kind ranking ──────────────────────────────────────────────────────

/**
 * Precedence rank for financial fact sources.
 * Higher value = stronger / more trustworthy provenance.
 *
 * Matches the internal ranking used inside populate-financial-fact-registry-v1.
 * Kept in sync manually — both copies must agree.
 */
export const SOURCE_KIND_RANK: Record<string, number> = {
  pdf_table:    4,
  xlsx:         3,
  pdf_kpi_line: 2,
  deck:         1,
  unknown:      0,
};

/**
 * Sort an array of FinancialFactV1 rows by source_kind precedence descending
 * (highest-confidence sources first).
 *
 * Does NOT mutate the input array. Returns a new array.
 * Facts with the same rank retain their relative order (stable sort).
 */
export function rankFinancialFacts(facts: FinancialFactV1[]): FinancialFactV1[] {
  return [...facts].sort((a, b) => {
    const rankA = SOURCE_KIND_RANK[a.source_kind] ?? 0;
    const rankB = SOURCE_KIND_RANK[b.source_kind] ?? 0;
    return rankB - rankA;
  });
}
