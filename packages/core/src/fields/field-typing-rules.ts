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
};