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
  if (/^(FY)?\d{4}$/.test(s)) return "annual";
  // Half-year and YTD: year-scoped aggregations → annual
  if (/^(YTD|H[12]\s+\d{4}|\d{4}\s+H[12])$/i.test(s)) return "annual";
  return "unknown";
}
