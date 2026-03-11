/**
 * extract-chart-fact-claims.ts
 *
 * Bridges bar chart pixel data (stored in visual_extractions.structured_json)
 * into FinancialFactV1 records.
 *
 * source_kind: "chart_pixel" — lowest confidence tier in SOURCE_KIND_RANK.
 *
 * Design rules:
 *  - No LLM. Pure deterministic mapping.
 *  - Only emits facts when axis_mapping_succeeded = true
 *    (series[0].values_are_normalized === false).
 *  - Series must have >= 2 values.
 *  - Absolute value must be >= MIN_FINANCIAL_VALUE (1000).
 *  - A financial metric key must be inferrable from slide_type / DPU text.
 *  - Each x_label must yield a parseable period via extractPeriodFromText;
 *    bars with unparseable labels are skipped.
 *  - Never throws.
 *
 * Confidence assignment:
 *  - "low"    always (chart pixel values are inherently approximate)
 *
 * Expected structured_json shape (from chart_bar.py extract_bar_chart):
 * {
 *   "chart": {
 *     "type": "bar",
 *     "title": null,
 *     "x_labels": ["2023", "2024", "2025"],
 *     "series": [{
 *       "name": "Series 1",
 *       "values": [1200000, 2500000, 4500000],
 *       "unit": null,
 *       "values_are_normalized": false
 *     }],
 *     "y_unit": null,
 *     "confidence": 0.72,
 *     "method": "bar_pixels_v1"
 *   }
 * }
 *
 * Note: axis_mapping_succeeded is stored in visual_assets.quality_flags,
 * not inside structured_json. Callers must pre-filter on this flag before
 * calling this function.
 */

import type { FinancialFactV1, FinancialFactPeriodType } from "@dealdecision/core";
import {
  computeFactId,
  capFactExcerpt,
  inferPeriodType,
} from "@dealdecision/core";
import { extractPeriodFromText } from "./extract-financial-table-claims";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Minimum absolute value to be considered a financial quantity (after scaling). */
const MIN_FINANCIAL_VALUE = 1_000;

/** Maximum facts to emit per chart (safety cap). */
const MAX_CLAIMS_PER_CHART = 8;

// ─── Scale unit detection ─────────────────────────────────────────────────────

/**
 * Detect the scale multiplier from any chart text (title, y_unit, series name,
 * axis labels, nearby OCR text).
 *
 * Returns null when no unambiguous scale signal is found — callers should skip
 * the chart to avoid writing wrongly-scaled values.
 *
 * Returns { multiplier: 1, unit: "percent" } for % charts — callers should
 * also skip because percent values never exceed MIN_FINANCIAL_VALUE.
 */
export function detectChartScaleUnit(
  text: string,
): { multiplier: number; unit: "currency" | "percent" } | null {
  const t = text.toLowerCase().trim();
  if (!t) return null;

  // Percent — evaluated first so "$%" or "pcnt" don't fall through to currency
  if (/\bpercent\b|\bpct\b|\bpercentage\b|[\s(]%|^%/.test(t) || t === "%") {
    return { multiplier: 1, unit: "percent" };
  }

  // Billion: $B, $Bn, billions, (B), "in billions"
  if (/\$\s*b(?:n|ill)?\b|\bbillion[s]?\b|\(\s*b\s*\)|\bin\s+billion/.test(t)) {
    return { multiplier: 1_000_000_000, unit: "currency" };
  }

  // Million: $M, $MM, millions, (M), "in millions", "($ millions)"
  if (/\$\s*m{1,3}\b|\bmillion[s]?\b|\(\s*m\s*\)|\bin\s+million|\(\s*\$\s*m\s*\)/.test(t)) {
    return { multiplier: 1_000_000, unit: "currency" };
  }

  // Thousand: $K, thousands, (K), "in thousands"
  if (/\$\s*k\b|\bthousand[s]?\b|\(\s*k\s*\)|\bin\s+thousand/.test(t)) {
    return { multiplier: 1_000, unit: "currency" };
  }

  // Bare single-character unit strings (e.g. y_unit="M", unit="k", label="B")
  // Only match when the full candidate text is a very short unit token.
  if (t.length <= 4) {
    if (/^[($]*b[)$]*$/.test(t)) return { multiplier: 1_000_000_000, unit: "currency" };
    if (/^[($]*m[)$]*$/.test(t)) return { multiplier: 1_000_000, unit: "currency" };
    if (/^[($]*k[)$]*$/.test(t)) return { multiplier: 1_000, unit: "currency" };
  }

  return null;
}

// ─── Public types ─────────────────────────────────────────────────────────────

export interface ExtractChartFactClaimsOpts {
  deal_id: string;
  document_id?: string;
  /** visual_assets.id — used in source_pointer for traceability */
  visual_asset_id: string;
  page_number: number;
  slide_type?: string;
  slide_title?: string;
  /** Raw OCR text from the same page (DPU normalized_text), used for metric key inference. */
  dpu_text?: string;
}

// ─── Metric key inference ─────────────────────────────────────────────────────

/**
 * Infer the financial metric key this chart is displaying.
 *
 * Scans the first 1000 chars of dpu_text for known metric patterns in
 * priority order, then falls back to slide_type heuristics.
 *
 * Returns null when no confident key can be determined — callers should skip
 * the chart in this case to avoid noisy/incorrect facts.
 */
export function inferChartMetricKey(
  slide_type: string | undefined,
  dpu_text: string | undefined,
  chart_title?: string | null,
): string | null {
  // Prepend chart title so explicit labels ("Revenue ($M)") beat fuzzy DPU text
  const titlePart = chart_title ? chart_title.toLowerCase() + " " : "";
  const text = (titlePart + (dpu_text ?? "").toLowerCase().slice(0, 1_000)).trim();

  // Prioritised candidates — checked in order; first match wins
  const CANDIDATES: Array<{ key: string; pats: RegExp[] }> = [
    { key: "arr",          pats: [/\barr\b/, /annual\s+recurring\s+revenue/, /recurring\s+revenue/] },
    { key: "mrr",          pats: [/\bmrr\b/, /monthly\s+recurring\s+revenue/] },
    { key: "gmv",          pats: [/\bgmv\b/, /gross\s+merchandise\s+value/] },
    { key: "revenue",      pats: [/\brevenue\b/, /\bsales\b/, /\bgtv\b/] },
    { key: "gross_profit", pats: [/\bgross\s+profit\b/] },
    { key: "gross_margin", pats: [/\bgross\s+margin\b/] },
    { key: "burn_rate",    pats: [/\bburn\s+rate\b/, /\bmonthly\s+burn\b/] },
    { key: "ebitda",       pats: [/\bebitda\b/] },
  ];

  for (const { key, pats } of CANDIDATES) {
    if (pats.some((p) => p.test(text))) return key;
  }

  // slide_type fallback — only for clearly revenue-oriented contexts
  if (slide_type === "financials") return "revenue";
  if (slide_type === "traction")   return "revenue";

  return null;
}

// ─── Main extraction ──────────────────────────────────────────────────────────

/**
 * Extract FinancialFactV1 entries from a bar chart structured_json payload.
 *
 * Each bar whose x_label parses to a valid period and whose value exceeds
 * MIN_FINANCIAL_VALUE becomes one fact.
 *
 * Returns [] when guards are not met or on any error.
 */
export function extractChartFactClaims(
  structuredJson: Record<string, unknown>,
  opts: ExtractChartFactClaimsOpts,
): FinancialFactV1[] {
  try {
    const chart = structuredJson?.chart as Record<string, unknown> | undefined;
    if (!chart || typeof chart !== "object") return [];

    // ── Series guards ────────────────────────────────────────────────────────
    const series = chart.series as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(series) || series.length === 0) return [];

    const s0 = series[0];
    if (!s0 || typeof s0 !== "object") return [];

    // Only emit facts from absolute-valued data
    if (s0.values_are_normalized === true) return [];

    const values = s0.values as unknown[] | undefined;
    if (!Array.isArray(values) || values.length < 2) return [];

    const xLabels = Array.isArray(chart.x_labels) ? chart.x_labels as unknown[] : [];
    const chartTitle = typeof chart.title === "string" ? chart.title : null;

    // ── Scale unit detection ─────────────────────────────────────────────────
    // Combine all available text signals in priority order: y_unit, series unit,
    // series name, chart title, leading DPU text, x_labels.
    const scaleTexts = [
      typeof chart.y_unit === "string" ? chart.y_unit : "",
      typeof s0.unit     === "string" ? s0.unit     : "",
      typeof s0.name     === "string" ? s0.name     : "",
      chartTitle ?? "",
      (opts.dpu_text ?? "").slice(0, 300),
      xLabels.filter((l): l is string => typeof l === "string").join(" "),
    ].filter(Boolean).join(" ");

    const scaleResult = detectChartScaleUnit(scaleTexts);
    // Skip chart if no scale unit found or if it shows percentages
    if (!scaleResult || scaleResult.unit === "percent") return [];
    const { multiplier } = scaleResult;

    // ── Metric key inference ─────────────────────────────────────────────────
    const metric_key = inferChartMetricKey(opts.slide_type, opts.dpu_text, chartTitle);
    if (!metric_key) return [];

    // ── Per-bar extraction ───────────────────────────────────────────────────
    const claims: FinancialFactV1[] = [];

    for (let i = 0; i < values.length; i++) {
      if (claims.length >= MAX_CLAIMS_PER_CHART) break;

      const rawVal = values[i];
      if (typeof rawVal !== "number" || !Number.isFinite(rawVal)) continue;

      // Apply axis scale (e.g. $M → ×1_000_000)
      const scaledVal = rawVal * multiplier;

      // Skip values below the financial threshold after scaling
      if (Math.abs(scaledVal) < MIN_FINANCIAL_VALUE) continue;

      // Require a parseable time period from the x_label
      const xLabel = typeof xLabels[i] === "string" ? (xLabels[i] as string).trim() : "";
      const period_label = extractPeriodFromText(xLabel);
      if (!period_label) continue;

      const period_type: FinancialFactPeriodType = inferPeriodType(period_label);

      const source_pointer = [
        `visual_asset_id=${opts.visual_asset_id}`,
        `page=${opts.page_number}`,
        `bar_index=${i}`,
      ].join(" ");

      const fact_id = computeFactId({
        deal_id:     opts.deal_id,
        metric_key,
        period_type,
        period_label,
        source_pointer,
        document_id: opts.document_id,
      });

      claims.push({
        fact_id,
        deal_id:     opts.deal_id,
        document_id: opts.document_id,
        source_kind: "chart_pixel",
        metric_key,
        period_type,
        period_label,
        value:       scaledVal,
        unit:        "currency",
        confidence:  "low",
        reconciliation_status: "unknown",
        page_number: opts.page_number,
        source_pointer,
        excerpt:     capFactExcerpt(
          `chart_bar[${i}] x="${xLabel}" raw=${rawVal} scale=${multiplier} value=${scaledVal} metric=${metric_key}`,
        ),
        slide_type:  opts.slide_type,
        slide_title: opts.slide_title,
      });
    }

    return claims;
  } catch {
    return [];
  }
}
