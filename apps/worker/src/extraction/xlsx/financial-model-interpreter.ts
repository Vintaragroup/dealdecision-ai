/**
 * extraction/xlsx/financial-model-interpreter.ts
 *
 * Converts a `FinancialTable` (produced by table-detector.ts) into an array
 * of `TypedMetric` objects using the canonical temporal classification and
 * field-typing rules from `@dealdecision/core`.
 *
 * Design rules:
 *   - Zero side effects. Pure function — same inputs → same outputs.
 *   - Uses `classifyTemporalScope()` and `isProjectedScope()` from core.
 *   - Uses `extractYearFromLabel()` (from core) to find years in headers.
 *   - Never throws — skips cells that cannot be interpreted.
 *   - Does NOT produce a TypedMetric when the cell value is null.
 */

import {
  classifyTemporalScope,
  isProjectedScope,
} from "@dealdecision/core";
import type {
  EvidenceRef,
  FieldTypeV1,
  FinancialFactPeriodType,
  TypedMetric,
} from "@dealdecision/core";

import { extractScenarioLabels } from "./sheet-classifier.js";
import type { FinancialTable } from "./table-detector.js";
import { parsePeriodLabel } from "./period-parser.js";
import { extractCrossSheetRefs } from "./cross-tab-refs.js";
import { extractNamedRangeRefs } from "./named-range-refs.js";
import { resolveDirectCrossSheetRefs } from "./cross-tab-resolver.js";
import { parseAllDirectCellDeps } from "./dependency-graph.js";

// ─── Row-label → FieldTypeV1 mapping ─────────────────────────────────────────

/**
 * Priority-ordered list of row-label matchers.
 * First match wins. Patterns are lowercased before testing.
 */
const ROW_LABEL_RULES: Array<{ pattern: RegExp; field_type: FieldTypeV1 }> = [
  // ARR / MRR (must precede revenue rule to avoid "arr revenue" mapping wrong)
  { pattern: /\barr\b|annual recurring rev/i,                     field_type: "arr_v1" },
  { pattern: /\bmrr\b|monthly recurring rev/i,                    field_type: "mrr_v1" },
  // Revenue subtypes — MUST precede the generic revenue/sales catch-all
  // -----------------------------------------------------------------
  // Forward-looking / projected revenue rows (captures "Revenue Projections"
  // which would otherwise fall through to revenue_canonical_v1)
  { pattern: /\bforecast(?:ed)?\s+rev|\bprojected\s+rev|\brevenue\s+projections?\b/i, field_type: "forecast_revenue_v1" },
  // Sales-expense rows: must precede \bsales\b to prevent "Total Sales Expense"
  // or compensation rows from being misclassified as revenue.
  { pattern: /\bsales\s+(?:expense|cost|spend|salary|bonus|commission|comp(?:ensation)?|incentive|travel)\b/i, field_type: "opex_v1" },
  { pattern: /\btotal\s+sales\s+(?:expense|cost)\b/i,             field_type: "opex_v1" },  // Numbered sales rows (e.g. "Sales 1", "Sales 2") are payroll/headcount line
  // items in many startup financial models.  Must precede the broad \bsales\b
  // revenue rule so they are not misclassified as revenue.
  { pattern: /\bsales\s+\d+\b/i,                                  field_type: "opex_v1" },  // Recognized revenue rows (ASC 606) — must precede revenue to avoid collapse
  { pattern: /\brecognized\s+rev|\brev(?:enue)?\s+rec(?:ognized)?\b/i, field_type: "recognized_revenue_v1" },
  // Handles "YTD Revenue Recognized", "Channel Revenue Recognized", etc.
  { pattern: /\b(?:ytd|channel|direct|subscription|booked)\s+(?:revenue\s+recognized|recognized\s+revenue)\b/i, field_type: "recognized_revenue_v1" },
  // Booked revenue rows (contracted, not yet recognized) — must precede revenue
  { pattern: /\bbooked\s+(?:revenue|sales|orders?)\b|\brev(?:enue)?\s+booked\b/i, field_type: "booked_revenue_v1" },
  // Revenue
  { pattern: /\brevenue\b|\bsales\b|\btop[ -]?line\b/i,           field_type: "revenue_canonical_v1" },
  // Market sizing
  { pattern: /\btam\b|total addr/i,                                field_type: "tam_v1" },
  { pattern: /\bsam\b|serviceable addr/i,                         field_type: "sam_v1" },
  { pattern: /\bsom\b|serviceable obt/i,                          field_type: "som_v1" },
  // EBITDA / net income
  { pattern: /\bebitda\b|\bnet\s+income\b|\bnet\s+loss\b|\bnet\s+profit\b|\boperating\s+income\b/i, field_type: "ebitda_v1" },
  // Burn / runway
  { pattern: /\bburn\b|\bcash\s+consumption\b/i,                  field_type: "burn_rate_v1" },
  { pattern: /\brunway\b/i,                                        field_type: "runway_months_v1" },
  // Raise / valuation
  { pattern: /\b(?:raise|fundrais|round)\b/i,                     field_type: "raise_amount_v1" },
  { pattern: /\bvaluation\b/i,                                     field_type: "valuation_v1" },
  // Pipeline
  { pattern: /\bpipeline\b|\bleads\b|\bopportunities\b/i,        field_type: "pipeline_metric_v1" },
  // Expenses (must come after EBITDA/burn to avoid false matches)
  { pattern: /\btotal\s+(?:expenses?|costs?)\b/i,                 field_type: "total_expenses_v1" },
  { pattern: /\bcogs\b|\bcost\s+of\s+(?:goods|revenue|sales)\b/i, field_type: "cogs_v1" },
  { pattern: /\bop(?:erating)?\s+exp(?:enses?)?\b|\bopex\b/i,     field_type: "opex_v1" },
  { pattern: /\bexpenses?\s+(?:fixed|variable)\b/i,               field_type: "opex_v1" },
  { pattern: /\bpayroll\b|\bsalaries\b|\bwages\b|\bsalary\b|\bcompensation\b|\bcomp\s+expense\b/i, field_type: "opex_v1" },
  // Headcount / personnel rows (salary schedule sheets). Must precede catch-all.
  { pattern: /\bheadcount\b|\bemployee\s+(?:cost|name|salary|compensation|count|fte)\b|\bpersonnel\b|\bstaff(?:ing)?\s+(?:cost|expense)\b/i, field_type: "opex_v1" },
  // Catch-all
  { pattern: /.*/,                                                  field_type: "other_metric_v1" },
];

function resolveFieldType(rowLabel: string): { field_type: FieldTypeV1; typing_reason: string; typing_confidence: number } {
  const label = rowLabel.trim();
  for (const rule of ROW_LABEL_RULES) {
    if (rule.pattern.test(label)) {
      const canonical = rule.field_type !== "other_metric_v1";
      return {
        field_type: rule.field_type,
        typing_reason: canonical
          ? `Row label "${label}" matched pattern for ${rule.field_type}`
          : `Row label "${label}" did not match any canonical pattern; classified as other_metric_v1`,
        typing_confidence: canonical ? 0.75 : 0.35,
      };
    }
  }
  // Should never reach here because the catch-all matches everything.
  return {
    field_type: "other_metric_v1",
    typing_reason: `Fallback — no pattern matched for "${rowLabel}"`,
    typing_confidence: 0.20,
  };
}

// ─── Column-header scenario detection ────────────────────────────────────────

/**
 * Per-column metadata produced from the `column_headers` array.
 *
 * `normalized_label` is used (rather than `label`) in period suffixes for
 * quarterly and TTM headers so that short-form labels like "1Q24" or
 * "Trailing Twelve Months" are canonicalized before becoming period_label on
 * the promoted FinancialFactV1.
 */
interface ColumnMeta {
  /** Raw header string (preserved for compatibility). */
  label: string;
  /** Normalized canonical period label; falls back to `label` when unknown. */
  normalized_label: string;
  year: number | null;
  quarter: number | null;
  period_type: FinancialFactPeriodType;
  scenario: string | null;
  temporal_scope_context: string;
}

/**
 * Pre-compute per-column metadata from column headers.
 *
 * For scenario columns (Base, Upside, Downside, etc.) temporal scope is forced
 * to "scenario" regardless of any year in the header.
 *
 * For quarterly and TTM headers, normalized_label and scope_context are derived
 * via parsePeriodLabel() so that classifyTemporalScope() receives accurate signals.
 */
function buildColumnMeta(
  columnHeaders: string[],
  currentYear: number,
): ColumnMeta[] {
  // extractScenarioLabels identifies which headers are scenario names
  const scenarioSet = new Set(extractScenarioLabels(columnHeaders));

  return columnHeaders.map((header) => {
    const isScenario = scenarioSet.has(header);
    const scenario = isScenario ? header : null;

    if (isScenario) {
      return {
        label: header,
        normalized_label: header,
        year: null,
        quarter: null,
        period_type: "unknown" as FinancialFactPeriodType,
        scenario,
        temporal_scope_context: `${header} scenario`,
      };
    }

    const info = parsePeriodLabel(header);
    return {
      label: header,
      normalized_label: info.normalized || header,
      year: info.year,
      quarter: info.quarter,
      period_type: info.period_type,
      scenario: null,
      // scope_context from parsePeriodLabel covers projected and TTM signals.
      // classifyTemporalScope() falls back to year-vs-currentYear when it is "".
      temporal_scope_context: info.scope_context,
    };
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface ParseFinancialTableOptions {
  /** Deal ID — forwarded to EvidenceRef */
  deal_id: string;
  /** Optional source document ID */
  document_id?: string;
  /** Optional page index within the document */
  page_index?: number;
  /** Optional slide title / sheet name for evidence ref */
  slide_title?: string;
  /**
   * Reference year used by `classifyTemporalScope`.
   * Defaults to the current calendar year when omitted.
   */
  currentYear?: number;
  /**
   * Minimum confidence threshold for emitting a TypedMetric.
   * Cells whose typing_confidence falls below this are dropped.
   * Defaults to 0.20 (keeps everything including catch-all "other_metric_v1").
   */
  minConfidence?: number;
}

/**
 * Revenue / income / burn field types that should NOT be emitted from a
 * cap-table sheet. Cap tables track equity ownership, share classes, and
 * dilution — they do not carry operating P&L metrics. When the sheet
 * classifier correctly identifies a table as `cap_table`, suppress these
 * field types to prevent share-count or vesting rows from polluting the
 * revenue fact pool.
 */
const CAP_TABLE_SUPPRESSED_FIELDS = new Set<FieldTypeV1>([
  "revenue_canonical_v1",
  "forecast_revenue_v1",
  "booked_revenue_v1",
  "recognized_revenue_v1",
  "arr_v1",
  "mrr_v1",
  "ebitda_v1",
  "burn_rate_v1",
  "runway_months_v1",
  "total_expenses_v1",
]);

/**
 * Convert a `FinancialTable` into typed metrics.
 *
 * Each non-null cell in the table produces at most one TypedMetric.
 * Cells with null values are silently skipped.
 *
 * @param table     Structured financial table from table-detector.ts
 * @param opts      Interpretation options
 * @returns         Array of TypedMetric objects; empty when nothing interpretable
 */
export function parseFinancialTable(
  table: FinancialTable,
  opts: ParseFinancialTableOptions,
): TypedMetric[] {
  const currentYear = opts.currentYear ?? new Date().getFullYear();
  const minConf = opts.minConfidence ?? 0.20;
  const metrics: TypedMetric[] = [];

  // Unit scale factor: 1 = no scaling; 1000 = "in thousands"; 1_000_000 = "in millions".
  // Comes from detectUnitScale() in table-detector; defaults to 1 when absent.
  const unitScaleFactor = table.unit_scale_factor ?? 1;
  const scaleAnnotation = unitScaleFactor > 1
    ? `; unit_scale_factor=${unitScaleFactor} applied (source: "${table.unit_scale_source_text ?? "unknown"}")`
    : "";

  const colMeta = buildColumnMeta(table.column_headers, currentYear);

  const evidence: EvidenceRef = {
    source_document_id: opts.document_id ?? opts.deal_id,
    page_index: opts.page_index ?? null,
    slide_title: opts.slide_title ?? table.sheet_name,
    snippet: null,
  };

  for (let rowIdx = 0; rowIdx < table.row_headers.length; rowIdx++) {
    const rowLabel = table.row_headers[rowIdx]!;
    const row = table.cell_matrix[rowIdx];
    if (!row) continue;

    const { field_type, typing_reason, typing_confidence } = resolveFieldType(rowLabel);
    if (typing_confidence < minConf) continue;

    // Cap-table sheets must not emit P&L / operating metrics. Equity schedules,
    // vesting tables, and share-class rows produce numeric values that can match
    // revenue / EBITDA patterns — suppress them at the sheet-kind boundary.
    if (table.table_kind === "cap_table" && CAP_TABLE_SUPPRESSED_FIELDS.has(field_type)) continue;

    for (let colIdx = 0; colIdx < colMeta.length; colIdx++) {
      const cellValue = row[colIdx];
      if (cellValue === null || cellValue === undefined) continue;

      // Year-label suppression: a raw (pre-scale) integer in the calendar-year
      // range 2020–2040 is almost always a year value inadvertently placed in a
      // data cell (e.g. a "Target Year" or "Launch Year" row), not a financial
      // figure.  Suppress before any scale-factor multiplication to prevent
      // e.g. 2025 × 1000 = $2,025,000 from appearing as a revenue metric.
      if (Number.isInteger(cellValue) && cellValue >= 2020 && cellValue <= 2040) continue;

      const col = colMeta[colIdx]!;

      // Apply unit scale (e.g. ×1000 for "in thousands" workbooks).
      // Raw cell value is preserved in value_raw with a scale annotation so
      // source_pointer (and thus fact_id) remains distinct from unscaled facts.
      const scaledValue = Number.isFinite(cellValue) ? cellValue * unitScaleFactor : null;
      const value_raw = unitScaleFactor === 1
        ? String(cellValue)
        : `${String(cellValue)} [×${unitScaleFactor}]`;

      // Determine temporal scope.
      const temporal_scope = classifyTemporalScope(
        col.year,
        col.temporal_scope_context,
        undefined,
        currentYear,
      );

      const projection_blocked = isProjectedScope(temporal_scope);

      // Formula traceability: look up formula metadata for this (rowIdx, colIdx) pair.
      // formula_map is present only when the source payload carried formula_grid.
      const cellFormulaKey = `${rowIdx}:${colIdx}`;
      const cellFormula = table.formula_map?.[cellFormulaKey] ?? null;
      // value_kind is deterministic when formula_map is present; otherwise unknown.
      const value_kind: TypedMetric["value_kind"] = table.formula_map
        ? (cellFormula !== null ? "formula" : "literal")
        : "unknown";

      // Cross-tab reference detection: parse the formula string for SheetName!
      // patterns. Pure regex — no formula evaluation or graph traversal.
      // Empty array when formula is null (literal or unknown) or has no cross-tab refs.
      const crossSheetRefs = cellFormula !== null ? extractCrossSheetRefs(cellFormula) : [];

      // Named-range reference detection: parse the formula string for workbook-level
      // named identifiers (e.g. Revenue_2024, ChurnRate). Excludes function names,
      // cell addresses, and sheet references. Does NOT resolve named-range values.
      const namedRangeRefs = cellFormula !== null ? extractNamedRangeRefs(cellFormula) : [];

      // Cross-tab value resolution: look up direct single-cell cross-sheet refs
      // (e.g. =Inputs!C5) against the workbook cell index when available.
      // Always returns [] for range refs (SUM(Model!C3:C10)) or when the index
      // is absent. Never throws — fails open with { value: null }.
      const resolvedCrossSheetValues =
        cellFormula !== null && table.cross_sheet_value_index
          ? resolveDirectCrossSheetRefs(cellFormula, table.cross_sheet_value_index)
          : [];

      // Dependency graph: parse all direct single-cell dependencies from the formula
      // (same-sheet + cross-sheet). Used to populate formula_dependencies,
      // dependency_depth, and circular_reference_detected on TypedMetric.
      const formulaDependencies =
        cellFormula !== null
          ? parseAllDirectCellDeps(cellFormula, table.sheet_name)
          : [];

      // Dependency depth and circular reference detection:
      // Look up each direct dep in the workbook graph payload (built in excel.ts).
      // If any dep key appears in circular_cells, flag circular reference risk.
      // depth = 1 + max depth of direct deps (deps not in cell_depths are literals, depth 0).
      let dependencyDepth: number | null = null;
      let circularReferenceDetected = false;
      if (formulaDependencies.length > 0 && table.workbook_graph) {
        const { circular_cells, cell_depths } = table.workbook_graph;
        const circularSet = new Set(circular_cells);
        for (const dep of formulaDependencies) {
          if (circularSet.has(`${dep.sheet}!${dep.cell}`)) {
            circularReferenceDetected = true;
            break;
          }
        }
        if (!circularReferenceDetected) {
          const depDepths = formulaDependencies.map((dep) => {
            const key = `${dep.sheet}!${dep.cell}`;
            // Dep in cell_depths means it's a formula cell; dep absent = literal (depth 0).
            return cell_depths[key] ?? 0;
          });
          dependencyDepth = 1 + Math.max(...depDepths);
        }
      }

      const periodSuffix = col.scenario
        ? `[${col.scenario}]`
        : (col.period_type === "quarterly" || col.period_type === "ttm")
          // Use the full normalized label so "Q1 2024" / "TTM" appear as
          // the period_label in promoted facts rather than just the year.
          ? `(${col.normalized_label})`
          : col.year !== null
            ? `(${col.year})`
            : col.label !== ""
              ? `(${col.label})`
              : "";
      const label = `${rowLabel} ${periodSuffix}`.trim();

      metrics.push({
        field_type,
        temporal_scope,
        value_raw,
        value: scaledValue,
        label,
        confidence: typing_confidence,
        sources: [evidence],
        typing_reason: `${typing_reason}; column="${col.label}"${scaleAnnotation}`,
        typing_confidence,
        projection_blocked,
        ...(col.scenario !== null ? { scenario: col.scenario } : {}),
        // Formula traceability fields — omit entirely when source had no formula metadata.
        ...(value_kind !== "unknown" ? { value_kind } : {}),
        ...(cellFormula !== null ? { formula: cellFormula } : {}),
        // Cross-tab refs — only set when formula references another worksheet.
        ...(crossSheetRefs.length > 0 ? { cross_sheet_refs: crossSheetRefs } : {}),
        // Named-range refs — only set when named workbook references are detected.
        ...(namedRangeRefs.length > 0 ? { named_range_refs: namedRangeRefs } : {}),
        // Resolved cross-sheet values — only set when direct refs were resolvable.
        ...(resolvedCrossSheetValues.length > 0 ? { resolved_cross_sheet_values: resolvedCrossSheetValues } : {}),
        // Dependency graph metadata — formula cell dependencies, depth, circular reference risk.
        ...(formulaDependencies.length > 0 ? { formula_dependencies: formulaDependencies } : {}),
        ...(dependencyDepth !== null ? { dependency_depth: dependencyDepth } : {}),
        ...(circularReferenceDetected ? { circular_reference_detected: true } : {}),
        // Extraction assumption metadata — unit scale and period normalization.
        ...(unitScaleFactor > 1 ? { unit_scale_factor_applied: unitScaleFactor } : {}),
        ...(unitScaleFactor > 1 && table.unit_scale_source_text != null
          ? { unit_scale_source_text: table.unit_scale_source_text }
          : {}),
        ...(col.normalized_label ? { normalized_period_label: col.normalized_label } : {}),
        ...(col.label ? { original_period_label: col.label } : {}),
      });
    }
  }

  return metrics;
}
