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
  arr_v1:                        "arr",
  mrr_v1:                        "mrr",
  tam_v1:                        "tam",
  sam_v1:                        "sam",
  som_v1:                        "som",
  raise_amount_v1:               "raise_amount",
  valuation_v1:                  "valuation",
  ebitda_v1:                     "ebitda",
  burn_rate_v1:                  "burn_rate",
  runway_months_v1:              "runway_months",
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

    const metricKey = FIELD_TYPE_TO_METRIC_KEY[metric.field_type] ?? "other_metric";
    const periodLabel = extractPeriodLabel(metric);
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
    };

    facts.push(fact);
  }

  return facts;
}
