/**
 * extraction/xlsx/metric-promoter.ts
 *
 * Promotes `TypedMetric[]` (from financial-model-interpreter) into
 * `FinancialFactV1[]` for persistence in the financial_facts_v1 table.
 *
 * Design rules:
 *   - Each non-null TypedMetric with a finite value produces exactly one fact.
 *   - Confidence maps: typing_confidence >= 0.70 → "high"; >= 0.45 → "medium"; else "low"
 *   - `fact_id` is deterministic via the same algorithm as makeFactId() in core.
 *   - `metric_key` is derived from `field_type` (strips "_v1" suffix; maps special cases).
 *   - `period_label` uses the TypedMetric's label (e.g. "Revenue (2024)") stripped to
 *     the period token, or "unknown" when no period is present.
 *   - `unit` is inferred from metric_key.
 *   - Currency is left as "USD" by default (XLSX parser has no currency context).
 */

import { createHash } from "crypto";
import type { FinancialFactV1, FinancialFactConfidence, FinancialFactUnit, FinancialFactSourceKind } from "@dealdecision/core";
import type { TypedMetric, FieldTypeV1 } from "@dealdecision/core";
import { inferPeriodType } from "@dealdecision/core";

// ─── Field type mappings ──────────────────────────────────────────────────────

/**
 * Map FieldTypeV1 → canonical metric_key.
 * Strips the trailing "_v1" suffix and normalises special cases.
 */
const FIELD_TYPE_TO_METRIC_KEY: Record<FieldTypeV1, string> = {
  revenue_canonical_v1:          "revenue",
  marketing_attributed_revenue_v1: "marketing_attributed_revenue",
  forecast_revenue_v1:           "forecast_revenue",
  // Semantic revenue subtypes — never collapse into generic "revenue"
  booked_revenue_v1:             "booked_revenue",
  recognized_revenue_v1:         "recognized_revenue",
  arr_v1:                        "arr",
  mrr_v1:                        "mrr",
  tam_v1:                        "tam",
  sam_v1:                        "sam",
  som_v1:                        "som",
  raise_amount_v1:               "raise_amount",
  // valuation_v1 is resolved to pre_money_valuation by default (startup XLSX
  // "Valuation" rows are pre-money). The caller disambiguates post-money via
  // the metric label at promotion time — see promoteToFinancialFactV1.
  valuation_v1:                  "pre_money_valuation",
  ebitda_v1:                     "ebitda",
  burn_rate_v1:                  "burn_rate",
  runway_months_v1:              "runway_months",
  total_expenses_v1:             "total_expenses",
  opex_v1:                       "opex",
  cogs_v1:                       "cogs",
  deal_returns_v1:               "deal_returns",
  pipeline_metric_v1:            "pipeline",
  other_metric_v1:               "other_metric",
};

/**
 * Metrics whose values are in months (not currency).
 */
const MONTH_UNIT_KEYS = new Set(["runway_months"]);
/**
 * Metrics whose values are percentages.
 */
const PERCENT_UNIT_KEYS = new Set(["gross_margin", "churn_pct", "retention_pct"]);

function inferUnit(metricKey: string): FinancialFactUnit {
  if (MONTH_UNIT_KEYS.has(metricKey)) return "number";
  if (PERCENT_UNIT_KEYS.has(metricKey)) return "percent";
  return "currency";
}

// ─── Period label extraction ──────────────────────────────────────────────────

/**
 * Extract a clean period label from a TypedMetric.
 *
 * TypedMetric.label is formatted like "Revenue (2024)" or "Revenue [Base]".
 * We extract the token inside the brackets.
 * If none, return "current".
 */
function extractPeriodLabel(metric: TypedMetric): string {
  const label = metric.label ?? "";
  // [Scenario] or (Year) or (label)
  const m = /[\[(]([^\])]+)[\])]/.exec(label);
  if (m && m[1]) return m[1].trim();
  // If no brackets found, fall back to the column label if we can parse it
  return "current";
}

/**
 * Returns true when a period label is a structural artifact of the XLSX
 * extraction format rather than a genuine financial period.
 *
 * Belt-and-suspenders guard that catches any structural labels that slip past
 * the table-detector layer (e.g. via excel_sheet paths or unusual payloads).
 *
 * Suppressed patterns:
 *   - Column coordinate placeholders: "col_C", "col_M", "col_AA"
 *   - Denomination markers: "$000", "$000s", "000s", "($000)", "(000s)"
 *   - Pure scale abbreviations: "$M", "$MM", "$K", "€B" (stand-alone tokens)
 *   - Empty / whitespace
 */
function isStructuralPeriodLabel(periodLabel: string): boolean {
  const s = periodLabel.trim();
  if (!s) return true;
  // Column coordinate: col_A, col_B, …, col_AA (Fallback 2 artifacts)
  if (/^col_[A-Za-z]+$/.test(s)) return true;
  // Denomination markers: $000, $000s, 000s, 000, ₹000s, (000s), ($000), etc.
  if (/^[$€£¥₹]?\s*0{2,}s?$/i.test(s)) return true;
  if (/^\([$€£¥₹]?\s*0{2,}s?\)$/i.test(s)) return true;
  // Stand-alone scale abbreviations: $M, $MM, €M, $K, £B, etc.
  if (/^[$€£¥₹]\s*m{1,2}$/i.test(s)) return true;
  if (/^[$€£¥₹]\s*k$/i.test(s)) return true;
  if (/^[$€£¥₹]\s*b$/i.test(s)) return true;
  return false;
}

// ─── Confidence mapping ───────────────────────────────────────────────────────

function toFactConfidence(tc: number): FinancialFactConfidence {
  if (tc >= 0.70) return "high";
  if (tc >= 0.45) return "medium";
  return "low";
}

// ─── Deterministic fact_id ────────────────────────────────────────────────────

function makeFactId(
  dealId: string,
  metricKey: string,
  periodLabel: string,
  sourcePointer: string,
): string {
  const hash = createHash("sha256")
    .update(sourcePointer)
    .digest("hex")
    .slice(0, 8);
  const safe = (s: string) => s.replace(/\s+/g, "_").toLowerCase();
  return `factv1:${safe(dealId)}:${safe(metricKey)}:unknown:${safe(periodLabel)}:${hash}`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface PromoteToFactsOptions {
  deal_id: string;
  document_id?: string;
  sheet_name?: string;
  /** Override source_kind (default: "xlsx") */
  source_kind?: FinancialFactSourceKind;
  /** Override currency (default: "USD") */
  currency?: string;
}

/**
 * Promote an array of typed metrics into FinancialFactV1 rows.
 *
 * Metrics are dropped when:
 *   - value is null
 *   - value is not a finite number
 *   - field_type is "other_metric_v1" with typing_confidence < 0.30
 *
 * @param metrics  Array from parseFinancialTable()
 * @param opts     Promotion options
 * @returns        FinancialFactV1 rows ready for persistence
 */
export function promoteToFinancialFactV1(
  metrics: TypedMetric[],
  opts: PromoteToFactsOptions,
): FinancialFactV1[] {
  const facts: FinancialFactV1[] = [];
  const sourceKind: FinancialFactSourceKind = opts.source_kind ?? "xlsx";
  const currency = opts.currency ?? "USD";

  for (const metric of metrics) {
    // Drop null / non-finite
    if (metric.value === null || !Number.isFinite(metric.value)) continue;
    // Drop low-confidence other_metric_v1 (noisy rows)
    if (metric.field_type === "other_metric_v1" && metric.typing_confidence < 0.30) continue;

    const rawMetricKey = FIELD_TYPE_TO_METRIC_KEY[metric.field_type] ?? "other_metric";
    // For valuation rows, inspect the label to distinguish post-money from pre-money.
    // Default is pre_money_valuation (the common case in startup financial models).
    const metricKey =
      rawMetricKey === "pre_money_valuation" && /post.?money/i.test(metric.label ?? "")
        ? "post_money_valuation"
        : rawMetricKey;
    const periodLabel = extractPeriodLabel(metric);

    // Structural period label guard: drop facts whose period label is an XLSX
    // formatting artifact (col_C, $000, $M, etc.) rather than a real period.
    // These originate from salary schedules, cap-table sheets, or allocation
    // tables that lacked a proper period-header row. Belt-and-suspenders check
    // complementing the table-detector-layer structural column guard.
    if (isStructuralPeriodLabel(periodLabel)) continue;
    const unit = inferUnit(metricKey);

    // Build deterministic source pointer for fact_id
    const sourcePointer = [
      opts.document_id ?? opts.deal_id,
      opts.sheet_name ? `sheet=${opts.sheet_name}` : null,
      `metric=${metricKey}`,
      `period=${periodLabel}`,
      `value_raw=${metric.value_raw}`,
    ]
      .filter(Boolean)
      .join(" ");

    const factId = makeFactId(opts.deal_id, metricKey, periodLabel, sourcePointer);

    const fact: FinancialFactV1 = {
      fact_id: factId,
      deal_id: opts.deal_id,
      ...(opts.document_id ? { document_id: opts.document_id } : {}),
      source_kind: sourceKind,
      metric_key: metricKey,
      metric_label: metric.label ?? undefined,
      period_type: inferPeriodType(periodLabel),
      period_label: periodLabel,
      value: metric.value,
      unit,
      ...(unit === "currency" ? { currency } : {}),
      confidence: toFactConfidence(metric.typing_confidence),
      reconciliation_status: "unknown",
      temporal_scope: metric.temporal_scope,
      ...(metric.scenario !== undefined ? { scenario: metric.scenario } : {}),
      ...(opts.sheet_name ? { sheet_name: opts.sheet_name } : {}),
      source_pointer: sourcePointer,
      // Formula traceability — carry value_kind, formula, and cross_sheet_refs when present.
      ...(metric.value_kind !== undefined ? { value_kind: metric.value_kind } : {}),
      ...(metric.formula !== undefined ? { formula: metric.formula } : {}),
      ...(metric.cross_sheet_refs !== undefined ? { cross_sheet_refs: metric.cross_sheet_refs } : {}),
      ...(metric.named_range_refs !== undefined ? { named_range_refs: metric.named_range_refs } : {}),
      ...(metric.resolved_cross_sheet_values !== undefined ? { resolved_cross_sheet_values: metric.resolved_cross_sheet_values } : {}),
      // Dependency graph metadata — carry through formula dependencies, depth, circular flag.
      ...(metric.formula_dependencies !== undefined ? { formula_dependencies: metric.formula_dependencies } : {}),
      ...(metric.dependency_depth !== undefined ? { dependency_depth: metric.dependency_depth } : {}),
      ...(metric.circular_reference_detected !== undefined ? { circular_reference_detected: metric.circular_reference_detected } : {}),
      // Extraction assumption metadata — scale factor, period normalization, typing reason.
      ...(metric.unit_scale_factor_applied !== undefined ? { unit_scale_factor_applied: metric.unit_scale_factor_applied } : {}),
      ...(metric.unit_scale_source_text !== undefined ? { unit_scale_source_text: metric.unit_scale_source_text } : {}),
      ...(metric.normalized_period_label !== undefined ? { normalized_period_label: metric.normalized_period_label } : {}),
      ...(metric.original_period_label !== undefined ? { original_period_label: metric.original_period_label } : {}),
      ...(metric.typing_reason !== undefined ? { typing_reason: metric.typing_reason } : {}),
    };

    facts.push(fact);
  }

  // ── Multi-year proforma model detection ────────────────────────────────────
  // If this extraction batch contains XLSX annual/TTM facts for a future year,
  // the current-year column is part of a forward-projection model (not realized
  // actuals). Upgrade temporal_scope from "current" → "projected" for current-year
  // annual/TTM facts so that downstream selectors and isProjectedFact() treat them
  // correctly after the next re-ingest.
  const promoterCurrentYear = new Date().getFullYear();
  const hasFutureXlsxAnnualFact = facts.some((f) => {
    if (f.period_type !== 'annual' && f.period_type !== 'ttm') return false;
    const yr = f.period_label.match(/(?<!\d)(20\d{2})(?!\d)/);
    return yr != null && Number(yr[1]) > promoterCurrentYear;
  });
  if (hasFutureXlsxAnnualFact) {
    for (const f of facts) {
      if (f.temporal_scope !== 'current') continue;
      if (f.period_type !== 'annual' && f.period_type !== 'ttm') continue;
      const yr = f.period_label.match(/(?<!\d)(20\d{2})(?!\d)/);
      if (yr != null && Number(yr[1]) === promoterCurrentYear) {
        f.temporal_scope = 'projected';
      }
    }
  }

  return facts;
}
