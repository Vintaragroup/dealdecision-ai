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
 *   rankFinancialFacts               — sort facts by temporal scope then source_kind
 *   SOURCE_KIND_RANK                 — the source-kind rank map for testing / callers
 *   TEMPORAL_SCOPE_RANK              — the temporal-scope rank map (realized > projected)
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
 * Temporal scope tiers for generic fact selection.
 *
 * Realized facts (historical actuals and current/TTM) rank above projected,
 * scenario, or unknown facts.  Projection-blocked facts should not silently
 * override confirmed actuals in any downstream consumer.
 *
 * Tier 2 (realized):  historical | current
 * Tier 1 (projected): projected | scenario | target
 * Tier 0 (unknown):   undefined / unknown
 */
export const TEMPORAL_SCOPE_RANK: Record<string, number> = {
  historical: 2,
  current:    2,
  projected:  1,
  scenario:   1,
  target:     1,
  unknown:    0,
};

/**
 * Sort an array of FinancialFactV1 rows by:
 *   1. Temporal scope preference (realized > projected > unknown)
 *   2. Source-kind precedence (xlsx > pdf_table > … > unknown)
 *
 * Realized historical/current facts always outrank projected ones regardless
 * of source strength — this prevents forecast columns from silently displacing
 * confirmed actuals when a consumer iterates the sorted list.
 *
 * Does NOT mutate the input array. Returns a new array.
 * Facts with the same rank retain their relative order (stable sort).
 */
export function rankFinancialFacts(facts: FinancialFactV1[]): FinancialFactV1[] {
  return [...facts].sort((a, b) => {
    // Primary: temporal scope (realized > projected > unknown)
    const scopeA = TEMPORAL_SCOPE_RANK[a.temporal_scope ?? "unknown"] ?? 0;
    const scopeB = TEMPORAL_SCOPE_RANK[b.temporal_scope ?? "unknown"] ?? 0;
    if (scopeB !== scopeA) return scopeB - scopeA;
    // Secondary: source-kind rank (xlsx > pdf_table > … > unknown)
    const kindA = SOURCE_KIND_RANK[a.source_kind] ?? 0;
    const kindB = SOURCE_KIND_RANK[b.source_kind] ?? 0;
    return kindB - kindA;
  });
}
