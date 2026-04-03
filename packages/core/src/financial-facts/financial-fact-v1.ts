/**
 * FinancialFactV1 — Canonical persisted financial datapoint schema.
 *
 * One row = one metric × one period × one provenance source.
 * Persisted in: financial_facts_v1 table.
 * Consumed by: deal chat (read), orchestrator (read-only).
 *
 * Design rules:
 * - No LLM: all values are extracted/derived deterministically.
 * - Numeric integrity: value must be finite (no NaN/Infinity).
 * - fact_id is deterministic: stable across re-runs for the same inputs.
 * - excerpt capped at 280 chars.
 */

import { createHash } from "crypto";
import type { TemporalScope } from "../temporal/temporal-scope";

// ─── Unit + source types ──────────────────────────────────────────────────────

export type FinancialFactUnit =
  | "currency"
  | "percent"
  | "number"
  | "unknown";

export type FinancialFactSourceKind =
  | "xlsx"
  | "pdf_table"
  | "pdf_kpi_line"
  | "kpi_tile"
  | "chart_pixel"
  | "deck"
  | "structured_derived"
  | "unknown";

export type FinancialFactPeriodType =
  | "annual"
  | "quarterly"
  | "monthly"
  | "ttm"
  | "unknown";

export type FinancialFactConfidence = "high" | "medium" | "low";

export type FinancialFactReconciliationStatus = "ok" | "conflict" | "unknown";

/**
 * Cross-source reconciliation status for a FinancialFactV1.
 *
 * Set by the cross-source reconciliation engine after comparing all facts for
 * the same metric_key + period_label across source kinds.
 *
 * Status semantics:
 *  supported       — ≥1 deck fact and ≥1 workbook fact exist for this slot and
 *                    their values agree within per-metric tolerance.
 *  conflicting     — ≥1 deck fact and ≥1 workbook fact exist but values disagree
 *                    beyond tolerance.
 *  deck_only       — Realized (historical/current) fact exists only in deck sources.
 *  workbook_only   — Realized fact exists only in workbook sources.
 *  projected_only  — Only projected/scenario facts exist for this slot; no realized
 *                    fact from any source.
 *  unresolved      — Insufficient data to determine agreement (e.g. value = 0,
 *                    non-numeric, or group has a single projected + single realized
 *                    from the same source).
 */
export type CrossSourceReconciliationStatus =
  | "supported"
  | "conflicting"
  | "deck_only"
  | "workbook_only"
  | "projected_only"
  | "unresolved";

// ─── Cell dependency ────────────────────────────────────────────────────────

/**
 * A direct cell dependency extracted from an Excel formula.
 *
 * Represents a single-cell reference (not a range) to a specific cell,
 * either on the same worksheet or a different one.
 *
 * Populated in Phase 2E by `parseAllDirectCellDeps()` in `dependency-graph.ts`.
 * Present in `FinancialFactV1.formula_dependencies` and `TypedMetric.formula_dependencies`.
 */
export interface CellDependency {
  /** Worksheet name. For same-sheet refs this is the current sheet name. */
  sheet: string;
  /** Cell address, uppercase, $ stripped. e.g. "C5", "D12". */
  cell: string;
}

// ─── Resolved cross-sheet value ─────────────────────────────────────────────

/**
 * A resolved direct single-cell cross-sheet reference value.
 *
 * Produced by `resolveDirectCrossSheetRefs()` in `cross-tab-resolver.ts`
 * when a formula like `=Inputs!C5` or `='Revenue Build'!D12` was resolved
 * against the workbook cell index at extraction time.
 *
 * Only direct single-cell refs are resolved in Phase 2D.
 * Range references (SUM(Model!C3:C10)) remain detection-only (cross_sheet_refs).
 */
export interface ResolvedCrossSheetValue {
  /** Worksheet name, exact case. */
  sheet: string;
  /** Cell address, uppercase, $ stripped. e.g. "C5", "D12". */
  cell: string;
  /**
   * Raw cell value when resolved; null when the referenced sheet or cell
   * was not found in the workbook index, or when the value was non-numeric
   * and non-string (boolean, error, etc.).
   */
  value: number | string | null;
}

// ─── FinancialFactV1 ──────────────────────────────────────────────────────────

export interface FinancialFactV1 {
  /**
   * Deterministic stable identifier.
   * Format: `factv1:{deal_id}:{metric_key}:{period_type}:{period_label}:{source_hash}`
   * source_hash = first 8 hex chars of sha256(source_pointer ?? document_id ?? "")
   */
  fact_id: string;
  deal_id: string;
  document_id?: string;
  source_kind: FinancialFactSourceKind;

  /**
   * Canonical metric key.
   * Standard values: "revenue" | "cogs" | "gross_profit" | "gross_margin" |
   *   "operating_expense" | "opex" | "ebitda" | "net_income" | "cash" |
   *   "burn_rate" | "runway_months" | "arr" | "mrr" | "cac" | "ltv" |
   *   "arpu" | "churn_pct" | "retention_pct"
   */
  metric_key: string;

  /** Human-friendly label if different from metric_key. */
  metric_label?: string;

  period_type: FinancialFactPeriodType;

  /**
   * Period label: e.g. "FY2024", "Q2 2025", "2024-03", "current", "P0".
   * Use "current" when period_type="unknown" and no explicit period is available.
   */
  period_label: string;

  /** Finite number. Must pass isFiniteFactValue(). */
  value: number;

  unit: FinancialFactUnit;

  /** ISO 4217 currency code when unit="currency". e.g. "USD" */
  currency?: string;

  confidence: FinancialFactConfidence;
  reconciliation_status?: FinancialFactReconciliationStatus;

  /**
   * Cross-source reconciliation status — populated by reconcileFinancialFacts()
   * inside buildFinancialFactRegistryV1() after all sources are merged.
   *
   * Indicates whether this fact is corroborated by another source, in conflict,
   * single-source, or projected-only.  Not persisted to DB (in-memory only for
   * the current processing run).
   *
   * @see CrossSourceReconciliationStatus
   */
  cross_source_status?: CrossSourceReconciliationStatus;

  /**
   * Temporal scope of this financial fact.
   *
   * Populated by classifyTemporalScope() using the period_label and surrounding
   * context text (e.g., column header from the XLSX sheet).
   *
   * "projected" or "scenario" means the value MUST NOT be presented as the
   * company's current actual performance without an explicit qualifier.
   *
   * Defaults to "unknown" when the parser cannot determine scope.
   */
  temporal_scope?: TemporalScope;

  /**
   * Scenario label when this fact comes from a named scenario column in a
   * financial model (e.g. "Base", "Upside", "Downside", "Bear", "Bull").
   *
   * Undefined for actuals / single-column models.
   * Always set when temporal_scope = "scenario".
   */
  scenario?: string;

  // ── Provenance ────────────────────────────────────────────────────────────
  sheet_name?: string;
  page_number?: number;
  row_index?: number;
  col_index?: number;

  /**
   * Slide classification type from DPU payload (resolved_slide_type).
   * e.g. "financials" | "traction" | "raise_terms" | "use_of_funds" | "team" | ...
   * Populated during Phase 10 slide-aware extraction.  Undefined when no DPU
   * slide context was available for the source page.
   */
  slide_type?: string;

  /**
   * Human-readable slide title extracted by the DPU pipeline.
   * Populated alongside slide_type.
   */
  slide_title?: string;

  /** Stable pointer string: e.g. "sheet=Revenue row_idx=3 col=B value_raw=1200000" */
  source_pointer?: string;

  /** Linked evidence row ID if one exists in the evidence table. */
  evidence_id?: string;

  /** ≤ 280 chars, optional text excerpt from source. */
  excerpt?: string;

  // ── Formula traceability ─────────────────────────────────────────────────

  /**
   * Whether the source Excel cell value was hard-coded or derived from a formula.
   *
   * "literal"  — the cell contained a static/hard-coded value.
   * "formula"  — the cell value was computed by an Excel formula.
   * "unknown"  — formula metadata was not available for this extraction
   *              (e.g. pre-formula-traceability ingestion, or excel_range payloads).
   *
   * Only populated for XLSX-sourced facts (source_kind === "xlsx").
   */
  value_kind?: "literal" | "formula" | "unknown";

  /**
   * The raw Excel formula string when value_kind === "formula".
   * e.g. "=SUM(C3:C17)" or "=B12/B13".
   *
   * Preserved for downstream workbook-logic traceability. Null when the cell
   * was literal or formula metadata was unavailable.
   */
  formula?: string | null;

  /**
   * Worksheet names referenced by the source formula across tab boundaries.
   * Absent when value_kind !== "formula" or when no cross-tab references
   * were detected. Sorted and deduplicated.
   *
   * Indicates the fact's value was computed from data on another sheet,
   * which may carry forward uncertainty if the source sheet is unavailable.
   */
  cross_sheet_refs?: string[];

  /**
   * Workbook-level named range identifiers referenced by the source formula.
   * Absent when value_kind !== "formula" or when no named-range candidates
   * were detected. Sorted and deduplicated.
   *
   * Detected deterministically by `extractNamedRangeRefs()` — does NOT
   * resolve what value a named range holds (requires full workbook context).
   * Indicates the fact depends on a named workbook assumption whose definition
   * may not be available from the extracted page payload alone.
   *
   * Examples:
   *   formula "=Revenue_2024"            → ["Revenue_2024"]
   *   formula "=IF(ChurnRate > 0.05, …)" → ["ChurnRate", …]
   */
  named_range_refs?: string[];

  /**
   * Resolved values for direct single-cell cross-sheet references in the formula.
   *
   * Populated when the source formula contained at least one direct cross-tab
   * reference (e.g. `=Inputs!C5`) AND the workbook cell index was available
   * at extraction time (`cross_sheet_resolved` in the DPU payload).
   *
   * One entry per unique direct ref found in the formula:
   *   - `value` is the raw cell value when found in the index.
   *   - `value` is null when the referenced sheet/cell was not found.
   *
   * Range references (e.g. `SUM(Model!C3:C10)`) remain detection-only in
   * `cross_sheet_refs` and are NOT resolved here.
   *
   * Examples:
   *   formula "=Inputs!C5"               → [{ sheet: "Inputs", cell: "C5", value: 12.5 }]
   *   formula "='Revenue Build'!D12"     → [{ sheet: "Revenue Build", cell: "D12", value: 450000 }]
   *   formula "=SUM(Model!C3:C10)"       → []  (range ref — not resolved)
   */
  resolved_cross_sheet_values?: ResolvedCrossSheetValue[];

  // ── Dependency graph metadata ─────────────────────────────────────────────

  /**
   * Direct single-cell dependencies of the source formula.
   *
   * Includes both same-sheet refs (e.g. `{ sheet: "Revenue", cell: "C3" }`) and
   * cross-sheet refs (e.g. `{ sheet: "Inputs", cell: "C5" }`).
   *
   * Only direct cell references are included — range endpoints (SUM(C3:C17))
   * are not expanded in this phase. Named ranges are not resolved.
   *
   * Absent when value_kind !== "formula" or when formula has no direct cell refs.
   *
   * Examples:
   *   formula "=C3+D3"              → [{ sheet: "Revenue", cell: "C3" }, { sheet: "Revenue", cell: "D3" }]
   *   formula "=Inputs!C5"          → [{ sheet: "Inputs", cell: "C5" }]
   *   formula "=SUM(Inputs!C3:C10)" → []  (range ref — not expanded)
   */
  formula_dependencies?: CellDependency[];

  /**
   * Depth of this formula cell in the workbook dependency chain.
   *
   * Depth 1 = formula depends only on literal (non-formula) cells.
   * Depth 2 = formula depends on at least one depth-1 formula cell.
   * Depth N = N formula hops from the nearest literal leaf input.
   *
   * null when:
   *   - This cell or one of its dependencies is involved in a circular reference.
   *   - The workbook graph was not available at extraction time.
   *   - All dependencies are outside the processed sheets (depth unknown).
   *
   * Absent when value_kind !== "formula" or when formula has no direct cell deps.
   */
  dependency_depth?: number | null;

  /**
   * True when any of this formula's direct dependencies is involved in a
   * circular reference chain detected in the workbook.
   *
   * Indicates that this fact's value may be unreliable or undefined — circular
   * references in Excel produce iteration-dependent results or errors.
   *
   * Only set when `true`; absent when no circular reference risk was detected.
   *
   * Note: Phase 2E detects adjacency to circular nodes (any direct dep is in
   * a cycle), not just membership in a cycle, to surface risk conservatively.
   */
  circular_reference_detected?: boolean;

  // ── Extraction assumption metadata ────────────────────────────────────────

  /**
   * Numeric scale factor applied to the raw cell value during XLSX extraction.
   * 1 = no scaling; 1000 = "in thousands"; 1_000_000 = "in millions".
   * Absent for non-XLSX sources or when no scale annotation was detected.
   * Present only when the factor is > 1 (no-op scalings are omitted).
   */
  unit_scale_factor_applied?: number;

  /**
   * Source text that indicated the scale factor.
   * e.g. "in thousands", "$000s", "$MM", "in millions".
   * Present only when unit_scale_factor_applied > 1.
   */
  unit_scale_source_text?: string | null;

  /**
   * Canonical normalized period label produced by parsePeriodLabel().
   * e.g. raw header "1Q24" → "Q1 2024"; "Trailing Twelve Months" → "TTM".
   * Present for XLSX-sourced facts.
   */
  normalized_period_label?: string;

  /**
   * Raw column header string before period normalization.
   * e.g. "1Q24", "FY 2024", "Trailing Twelve Months".
   * Present for XLSX-sourced facts.
   */
  original_period_label?: string;

  /**
   * When true, this fact was mathematically derived from other facts rather
   * than directly extracted from a source document.
   *
   * Always false (or absent) for extraction-sourced facts.
   * Always true for any fact produced by reconcileFinancialFactsV1().
   *
   * Used by audit views, downstream consumers, and the financial integrity
   * analyzer to distinguish derived signal from primary evidence.
   */
  is_derived?: boolean;

  /**
   * Stable machine-readable key identifying the derivation rule used to
   * produce this fact.
   *
   * Only present when is_derived = true.
   * Values are defined and documented in reconcile-financial-facts-v1.ts.
   *
   * Examples:
   *   "runway_months_from_cash_and_burn_rate"
   *   "gross_margin_from_gross_profit_and_revenue"
   *   "burn_rate_from_total_expenses_run_rate"
   */
  derivation_rule?: string | null;

  /**
   * Semantic family of this metric, from the financial semantics ontology.
   *
   * Populated for derived facts; optionally set for explicit extracted facts
   * when the extraction pipeline has access to the semantics layer.
   *
   * Values correspond to FinancialSemanticFamily in
   * packages/core/src/financial-semantics/semantic-types.ts.
   */
  semantic_family?: string | null;

  /**
   * Semantic role of this fact's value in the financial model.
   *
   * "explicit"   — directly stated in a source document
   * "derived"    — computed from other facts via a deterministic rule
   * "inferred"   — estimated from context (lower confidence)
   * "supporting" — metadata/label field, not a primary financial signal
   * "unknown"    — provenance could not be determined
   *
   * Only present when set explicitly by the derivation pipeline or extraction
   * with access to the semantics layer.
   */
  semantic_role?: "explicit" | "derived" | "inferred" | "supporting" | "unknown";

  /**
   * Deterministic explanation of why this metric_key was assigned.
   * Carried from TypedMetric.typing_reason through metric-promoter.
   * Includes the row label match, column context, and any scale-factor
   * annotation. Useful for analyst traceability without code inspection.
   *
   * Example:
   *   `Row label "Revenue" matched pattern for revenue_canonical_v1;
   *    column="FY2024"; unit_scale_factor=1000 applied (source: "in thousands")`
   */
  typing_reason?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Guard: returns true only for finite non-NaN numbers.
 */
export function isFiniteFactValue(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Cap a string to 280 characters.
 */
export function capFactExcerpt(s: string): string {
  if (s.length <= 280) return s;
  return s.slice(0, 277) + "...";
}

/**
 * Compute a deterministic fact_id.
 *
 * Format: `factv1:{deal_id}:{metric_key}:{period_type}:{period_label}:{source_hash}`
 * source_hash = first 8 hex chars of sha256(source_pointer ?? document_id ?? "")
 */
export function computeFactId(opts: {
  deal_id: string;
  metric_key: string;
  period_type: FinancialFactPeriodType;
  period_label: string;
  source_pointer?: string;
  document_id?: string;
}): string {
  const sourceInput = opts.source_pointer ?? opts.document_id ?? "";
  const hash = createHash("sha256")
    .update(sourceInput)
    .digest("hex")
    .slice(0, 8);
  // Sanitize period_label: collapse spaces, strip slashes
  const safeLabel = opts.period_label.replace(/[:/\\]/g, "_").replace(/\s+/g, "_");
  return [
    "factv1",
    opts.deal_id,
    opts.metric_key,
    opts.period_type,
    safeLabel,
    hash,
  ].join(":");
}

/**
 * Normalize a FinancialFactV1 draft before persistence.
 * Returns null if the fact fails validation (non-finite value, missing required fields).
 */
export function validateFinancialFact(
  fact: FinancialFactV1
): FinancialFactV1 | null {
  if (!fact.metric_key || !fact.period_label) return null;
  if (!isFiniteFactValue(fact.value)) return null;
  return {
    ...fact,
    excerpt: fact.excerpt ? capFactExcerpt(fact.excerpt) : undefined,
  };
}

/**
 * Infer period_type from a period label string.
 * - "2024", "FY2024" → "annual"
 * - "Q1 2024", "Q3-2025", "Q1" (standalone) → "quarterly"
 * - "2024-03" → "monthly"
 * - "TTM", "LTM" → "ttm"
 * - "YTD", "H1 YYYY", "H2 YYYY" → "annual"
 * - Otherwise → "unknown"
 */
export function inferPeriodType(label: string): FinancialFactPeriodType {
  const s = label.trim();
  if (/^(ttm|ltm)$/i.test(s)) return "ttm";
  if (/^(Q[1-4][\s\-_]\d{4}|\d{4}[\s\-_]Q[1-4])$/i.test(s)) return "quarterly";
  // Standalone quarter ("Q1", "Q2", ...)
  if (/^Q[1-4]$/i.test(s)) return "quarterly";
  if (/^\d{4}-\d{2}$/.test(s)) return "monthly";
  // Month names ("January", "Feb", "Mar") and ordinal months ("Month 1", "Month 12")
  if (/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*$/i.test(s)) return "monthly";
  if (/^month\s+\d{1,2}$/i.test(s)) return "monthly";
  if (/^(FY)?\d{4}$/.test(s)) return "annual";
  // Half-year and YTD: year-scoped aggregations → annual
  if (/^(YTD|H[12]\s+\d{4}|\d{4}\s+H[12])$/i.test(s)) return "annual";
  // "Year N Total" or "Year N" → annual
  if (/^year\s+\d+(?:\s+total)?$/i.test(s)) return "annual";
  return "unknown";
}
