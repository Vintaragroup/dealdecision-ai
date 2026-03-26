/**
 * Table Semantics (Phase 0)
 *
 * Infers the `FinancialTableSemanticType` for a financial table/sheet
 * given available classifier signals (SheetKind, LayoutType, row metric keys).
 *
 * Design rules:
 *  - Pure function — no async, no DB, no LLM
 *  - Cascading priority: sheetKind > layoutType > metric family counts
 *  - Returns "unknown" rather than throwing when signals are insufficient
 *  - Existing SheetKind / LayoutType classifiers are NOT replaced — this
 *    is an additive bridge layer that speaks the semantics-layer vocabulary
 */

import type { FinancialTableSemanticType, FinancialSemanticFamily } from "./semantic-types.js";
import { inferFamilyFromLabel } from "./metric-semantics.js";

// ─── SheetKind → SemanticType mapping ─────────────────────────────────────────
// Mirrors the values produced by sheet-classifier.ts (existing system).
// "unknown" is excluded — it forces fallthrough to layoutType inference.

const SHEET_KIND_TO_SEMANTIC: Record<string, FinancialTableSemanticType> = {
  income_statement: "income_statement",
  cash_flow: "cash_flow",
  balance_sheet: "balance_sheet",
  cap_table: "cap_table",
  unit_economics: "saas_kpi_table",
  metrics_dashboard: "metrics_dashboard",
  forecast_model: "forecast_model",
  scenario_model: "forecast_model",
};

// ─── LayoutType → SemanticType mapping ────────────────────────────────────────
// Mirrors the values produced by financial-layout-classifier-v1.ts.
// "other" and "unknown" are excluded — they force fallthrough to metric inference.

const LAYOUT_TYPE_TO_SEMANTIC: Record<string, FinancialTableSemanticType> = {
  income_statement: "income_statement",
  cash_flow: "cash_flow",
  balance_sheet: "balance_sheet",
  cap_table: "cap_table",
  saas_kpis: "saas_kpi_table",
  use_of_funds: "use_of_funds",
  budget_model: "forecast_model",
  bank_transactions: "cash_flow",
};

// ─── Family → SemanticType preference for metric-count inference ───────────────
// When falling back to metric family counts, prefer these type assignments
// in priority order (first match wins after sorting families by frequency).

const FAMILY_TO_PREFERRED_SEMANTIC: Partial<
  Record<FinancialSemanticFamily, FinancialTableSemanticType>
> = {
  revenue: "revenue_model",
  expense: "opex_schedule",
  profitability: "income_statement",
  liquidity: "cash_flow",
  capitalization: "cap_table",
  unit_economics: "saas_kpi_table",
  growth: "metrics_dashboard",
  headcount: "opex_schedule",
};

// ─── Public API ───────────────────────────────────────────────────────────────

export interface InferTableSemanticTypeInput {
  /** SheetKind string from the existing sheet-classifier (may be "unknown"). */
  sheetKind?: string | null;
  /** LayoutType string from financial-layout-classifier-v1 (may be "unknown" / "other"). */
  layoutType?: string | null;
  /**
   * Canonical metric keys OR raw label strings present as row headers.
   * The function will attempt to resolve labels via the ontology alias index.
   */
  rowMetricKeys?: string[];
}

/**
 * inferTableSemanticType
 *
 * Resolves the best-fit `FinancialTableSemanticType` for a table/sheet given
 * a priority cascade of available signals:
 *
 *  1. `sheetKind` — if mapped and not "unknown", use directly
 *  2. `layoutType` — if mapped and not "unknown" / "other", use directly
 *  3. Row metric keys / labels — resolve families, pick the dominant type
 *  4. Fallback: "unknown"
 */
export function inferTableSemanticType(
  input: InferTableSemanticTypeInput,
): FinancialTableSemanticType {
  const { sheetKind, layoutType, rowMetricKeys = [] } = input;

  // ── Priority 1: sheetKind ────────────────────────────────────────────────
  if (sheetKind && sheetKind !== "unknown") {
    const mapped = SHEET_KIND_TO_SEMANTIC[sheetKind];
    if (mapped) return mapped;
  }

  // ── Priority 2: layoutType ───────────────────────────────────────────────
  if (layoutType && layoutType !== "unknown" && layoutType !== "other") {
    const mapped = LAYOUT_TYPE_TO_SEMANTIC[layoutType];
    if (mapped) return mapped;
  }

  // ── Priority 3: metric family frequency ──────────────────────────────────
  if (rowMetricKeys.length > 0) {
    const familyCounts = new Map<FinancialSemanticFamily, number>();

    for (const key of rowMetricKeys) {
      const family = inferFamilyFromLabel(key);
      if (family) {
        const prev = familyCounts.get(family) ?? 0;
        familyCounts.set(family, prev + 1);
      }
    }

    if (familyCounts.size > 0) {
      // Pick the family with the highest count
      let dominantFamily: FinancialSemanticFamily | undefined;
      let maxCount = 0;
      for (const [family, count] of familyCounts) {
        if (count > maxCount) {
          maxCount = count;
          dominantFamily = family;
        }
      }
      if (dominantFamily) {
        const preferred = FAMILY_TO_PREFERRED_SEMANTIC[dominantFamily];
        if (preferred) return preferred;
      }
    }
  }

  // ── Fallback ─────────────────────────────────────────────────────────────
  return "unknown";
}
// ─── Multi-sheet inference ────────────────────────────────────────────────────

/**
 * Infer a deduplicated set of table semantic types across multiple
 * sheet/table descriptions. Useful when processing a workbook with
 * multiple sheets.
 */
export function inferAllTableSemanticTypes(
  inputs: InferTableSemanticTypeInput[],
): FinancialTableSemanticType[] {
  const seen = new Set<FinancialTableSemanticType>();
  for (const input of inputs) {
    seen.add(inferTableSemanticType(input));
  }
  return Array.from(seen);
}
