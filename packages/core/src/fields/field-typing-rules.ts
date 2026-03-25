/**
 * Field typing rules / outputs live in Core and must remain transport-agnostic.
 *
 * NOTE: Do not import DB/API evidence row types here. We use a lightweight
 * evidence reference shape that can be produced from DPU/promoted facts and
 * consumed by report/UI layers.
 *
 * Phase 1 changes:
 *   - Expanded FieldTypeV1 to cover all key financial metric families.
 *   - Added temporal_scope to TypedMetric (imported from temporal-scope.ts).
 *   - TypedMetric is now exported from packages/core/src/index.ts.
 */

import type { TemporalScope } from "../temporal/temporal-scope";
import type { CellDependency, ResolvedCrossSheetValue } from "../financial-facts/financial-fact-v1";

export type EvidenceRef = {
  source_document_id: string;
  /** 0-based page index, when known */
  page_index: number | null;
  /** Optional human-friendly slide title */
  slide_title?: string | null;
  /** Optional snippet used for debugging/verification */
  snippet?: string | null;
  /** Optional evidence id when the upstream layer has one */
  evidence_id?: string;
};

export type FieldTypeV1 =
  // ── Revenue subtypes ────────────────────────────────────────────────────
  /** Current-period actual / TTM revenue. */
  | "revenue_canonical_v1"
  /** Revenue attributable specifically to marketing channels. */
  | "marketing_attributed_revenue_v1"
  /** Forward-looking / forecast revenue. */
  | "forecast_revenue_v1"
  // ── ARR / MRR ───────────────────────────────────────────────────────────
  /** Annual recurring revenue (ARR). */
  | "arr_v1"
  /** Monthly recurring revenue (MRR). */
  | "mrr_v1"
  // ── Market sizing ───────────────────────────────────────────────────────
  /** Total addressable market (TAM). */
  | "tam_v1"
  /** Serviceable addressable market (SAM). */
  | "sam_v1"
  /** Serviceable obtainable market (SOM). */
  | "som_v1"
  // ── Raise / valuation ───────────────────────────────────────────────────
  /** Raise ask (investment amount being sought in this round). */
  | "raise_amount_v1"
  /** Company valuation (pre- or post-money determined by context). */
  | "valuation_v1"
  // ── P&L / unit economics ────────────────────────────────────────────────
  /** EBITDA or net income. */
  | "ebitda_v1"
  /** Monthly / quarterly cash burn rate. */
  | "burn_rate_v1"
  /** Cash runway in months. */
  | "runway_months_v1"
  // ── Other ───────────────────────────────────────────────────────────────
  /** Deal returns / exit multiple. */
  | "deal_returns_v1"
  /** Pipeline / funnel metric (leads, pipeline value, etc.). */
  | "pipeline_metric_v1"
  /** Any numeric metric that does not fit a more specific type. */
  | "other_metric_v1";

export type TypedMetric = {
  field_type: FieldTypeV1;

  /**
   * Temporal scope of this value — was it historical (reported), current
   * (TTM / run-rate), projected (forecast/plan), scenario, or unknown?
   *
   * Populated by classifyTemporalScope() from temporal-scope.ts.
   * "unknown" is the safe default when signals are insufficient.
   */
  temporal_scope: TemporalScope;

  /** Raw token/value matched from the source (e.g. "$2.476M") */
  value_raw: string;

  /** Normalized numeric value when parseable; null when not */
  value: number | null;

  /** Optional label shown in UI (e.g. "Revenue (2024)") */
  label: string | null;

  /** Overall extraction confidence (0..1) */
  confidence: number;

  /** Evidence references supporting this typed metric */
  sources: EvidenceRef[];

  /** Deterministic explanation of why this field_type was chosen */
  typing_reason: string;

  /** Confidence in the typing decision itself (0..1) */
  typing_confidence: number;

  /**
   * When true, this metric is blocked from promotion to current-company-status
   * surfaces (overview, governed summary headline) because it carries projected
   * or scenario scope.
   *
   * Populated by isProjectedScope(temporal_scope).
   */
  projection_blocked?: boolean;

  /**
   * Scenario label when this metric belongs to a named scenario column in a
   * financial model (e.g. "Base", "Upside", "Downside", "Bear", "Bull").
   *
   * Undefined for actuals / historical data.
   * Always set when temporal_scope = "scenario".
   */
  scenario?: string;

  // ── Formula traceability ─────────────────────────────────────────────────

  /**
   * Whether the source cell value was hard-coded or derived from an Excel formula.
   *
   * "literal"  — the cell contained a static/hard-coded numeric value.
   * "formula"  — the cell contained an Excel formula (e.g. =SUM(C3:C17)).
   * "unknown"  — the source payload did not carry formula metadata (e.g.
   *              excel_range payloads, or pre-formula-traceability extractions).
   *
   * Only populated for facts extracted from XLSX workbooks.
   */
  value_kind?: "literal" | "formula" | "unknown";

  /**
   * The raw formula string from the source cell when value_kind === "formula".
   * e.g. "=SUM(C3:C17)".
   *
   * Preserved for workbook-logic traceability. Null when the cell was literal
   * or when formula metadata was unavailable from the source payload.
   */
  formula?: string | null;

  /**
   * Worksheet names referenced by the formula across tab boundaries.
   * Absent when value_kind !== "formula", no cross-tab references exist,
   * or formula metadata was unavailable from the source payload.
   *
   * Derived deterministically by regex parsing of SheetName! patterns.
   * Sorted and deduplicated. Does not include sheet references that require
   * full workbook evaluation (e.g. named ranges resolving cross-tab).
   *
   * Examples:
   *   formula "Inputs!C5"              → ["Inputs"]
   *   formula "SUM(Model!C3:C10)"      → ["Model"]
   *   formula "'Revenue Build'!D12"    → ["Revenue Build"]
   *   formula "Sheet1!A1+Sheet2!B2"    → ["Sheet1", "Sheet2"]
   */
  cross_sheet_refs?: string[];

  /**
   * Workbook-level named range identifiers referenced by the formula.
   * Absent when value_kind !== "formula", no named-range candidates were
   * detected, or formula metadata was unavailable.
   *
   * Derived deterministically by regex parsing — does NOT resolve what value
   * a named range holds (requires full workbook context to resolve).
   * Sorted and deduplicated.
   *
   * Examples:
   *   formula "=Revenue_2024"                          → ["Revenue_2024"]
   *   formula "=SUM(Revenue_2024, Cost_2024)"           → ["Cost_2024", "Revenue_2024"]
   *   formula "=IF(ChurnRate > 0.05, ARR_Base, ARR_Low)" → ["ARR_Base", "ARR_Low", "ChurnRate"]
   *   formula "=Inputs!C5"                              → [] (sheet ref, not named range)
   */
  named_range_refs?: string[];

  /**
   * Resolved values for direct single-cell cross-sheet references in the formula.
   *
   * Populated when the formula contained at least one direct cross-tab ref
   * (e.g. `=Inputs!C5`) AND the workbook cell index was available at extraction
   * time. One entry per unique direct ref in the formula.
   *
   * `value` is the raw cell value when found; null when the ref could not be
   * resolved (sheet not in index, cell empty, no workbook index available).
   *
   * Range references (SUM(Model!C3:C10)) are not resolved in this phase —
   * see `cross_sheet_refs` for detection-only coverage.
   */
  resolved_cross_sheet_values?: ResolvedCrossSheetValue[];

  // ── Dependency graph metadata ────────────────────────────────────────────────

  /**
   * Direct single-cell dependencies of the source formula.
   *
   * Includes both same-sheet refs and cross-sheet direct single-cell refs.
   * Range endpoints are not expanded. Named ranges are not resolved.
   *
   * Absent when value_kind !== "formula" or when formula has no direct cell refs.
   *
   * See `FinancialFactV1.formula_dependencies` for full field documentation.
   */
  formula_dependencies?: CellDependency[];

  /**
   * Depth of this formula cell in the workbook dependency chain.
   *
   * Depth 1 = depends only on literal cells. null when circular or unknown.
   * See `FinancialFactV1.dependency_depth` for full semantics.
   */
  dependency_depth?: number | null;

  /**
   * True when any direct dependency of this formula is part of a circular
   * reference chain detected in the workbook.
   *
   * Only set when `true`; absent when no circular reference risk was detected.
   * See `FinancialFactV1.circular_reference_detected` for full semantics.
   */
  circular_reference_detected?: boolean;

  // ── Extraction assumption metadata ──────────────────────────────────────────

  /**
   * Numeric scale factor applied to the raw cell value during extraction.
   * 1 = no scaling; 1000 = "in thousands"; 1_000_000 = "in millions".
   * Absent when the source was not XLSX or no scale annotation was detected.
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
   * e.g. raw header "1Q24" → normalized "Q1 2024";
   *      "Trailing Twelve Months" → "TTM";
   *      "FY2024" → "FY2024" (unchanged).
   * Present for XLSX-sourced metrics where a column header was available.
   */
  normalized_period_label?: string;

  /**
   * Raw column header string before period normalization.
   * e.g. "1Q24", "FY 2024", "Trailing Twelve Months".
   * Present for XLSX-sourced metrics where a column header was available.
   */
  original_period_label?: string;
};