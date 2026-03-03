/**
 * extract-inline-financial-claims.ts
 *
 * Extracts financial metric mentions from non-table text regions —
 * traction slides, ask slides, and KPI-dense paragraphs.
 *
 * source_kind: "pdf_kpi_line" — distinct from structured table extractions.
 *
 * Design rules:
 *  - No LLM. Purely regex + deterministic alias normalization.
 *  - Only emits facts where canonical metric_key is in KNOWN_INLINE_METRIC_KEYS.
 *  - Finance keyword must appear within ±40 chars of numeric token (noise gate).
 *  - Max MAX_INLINE_CLAIMS_PER_PAGE claims per call.
 *  - Confidence: always "medium" for accepted claims.
 *  - Never throws.
 *
 * Supported patterns per line:
 *  P1.  Label: $value      "ARR: $2M"
 *  P2.  Label = $value     "Burn Rate = $150k"
 *  P3.  Label $value       "ARR $2.5M"            (label before value)
 *  P4.  $value Label       "$2M ARR"              (value before label)
 *  P5.  Raise sentence     "We are raising $5M"
 *  P6.  Value+unit mention "$8B valuation"         (via P4 generalised)
 */

import { createHash } from "crypto";
import type {
  FinancialFactV1,
  FinancialFactPeriodType,
} from "@dealdecision/core";
import {
  capFactExcerpt,
  computeFactId,
  inferPeriodType,
} from "@dealdecision/core";
import {
  parseNumericToken,
  extractPeriodFromText,
  type ParsedNumeric,
} from "./extract-financial-table-claims";
import { normalizeMetricKey } from "./financial-metric-aliases";

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_INLINE_CLAIMS_PER_PAGE = 20;

/**
 * Canonical metric keys that are valid outputs from the inline extractor.
 * Keys not in this set are discarded — avoids emitting garbage slugs.
 */
const KNOWN_INLINE_METRIC_KEYS = new Set<string>([
  "revenue",
  "cogs",
  "gross_profit",
  "gross_margin",
  "opex",
  "ebitda",
  "net_income",
  "cash",
  "burn_rate",
  "runway_months",
  "arr",
  "mrr",
  "cac",
  "ltv",
  "arpu",
  "churn_pct",
  "retention_pct",
  "net_revenue_retention",
  "headcount",
  "gmv",
  "pre_money_valuation",
  "post_money_valuation",
  "raise_amount",
]);

/**
 * Finance keywords used for proximity noise gate (±40 chars around a numeric).
 */
const FINANCE_KW_PATTERN =
  /\b(revenue|arr|mrr|burn|runway|gross|ebitda|cogs|valuation|raise|raising|raised|seed|series|forecast|opex|margin|invest|gmv|nrr|churn|retention|ltv|cac|arpu|headcount|funding|capital|cash|profit|loss|income|cost|salary|expense|expense|salary)\b/i;

// ─── Public types ─────────────────────────────────────────────────────────────

export interface ExtractInlineFinancialClaimsOpts {
  deal_id: string;
  document_id?: string;
  page_number?: number;
  /** Optional page registry id for source_pointer disambiguation */
  page_id?: string;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Extract inline financial KPI mentions from a raw text page.
 *
 * Returns FinancialFactV1[] with source_kind="pdf_kpi_line".
 * Returns [] on any error.
 */
export function extractInlineFinancialClaims(
  text: string,
  opts: ExtractInlineFinancialClaimsOpts,
): FinancialFactV1[] {
  if (!text || text.length < 5) return [];

  const claims: FinancialFactV1[] = [];

  try {
    const lines = text.split("\n");

    for (const rawLine of lines) {
      if (claims.length >= MAX_INLINE_CLAIMS_PER_PAGE) break;

      const line = rawLine.trim();
      if (!line || line.length < 4) continue;
      // Skip lines that are clearly table separators or headings with no value
      if (/^[-=|_\s]{3,}$/.test(line)) continue;

      const extracted = tryExtractInlineClaim(line);
      if (!extracted) continue;

      const { rawLabel, parsed, period_label, matchStart, matchEnd } = extracted;

      // ── Noise gate: finance keyword within ±40 chars of numeric match ──────
      const windowStart = Math.max(0, matchStart - 40);
      const windowEnd = Math.min(line.length, matchEnd + 40);
      const window = line.slice(windowStart, windowEnd);
      if (!FINANCE_KW_PATTERN.test(window)) continue;

      // ── Normalize label → canonical key ────────────────────────────────────
      const metric_key = normalizeMetricKey(rawLabel);

      // Discard if key is not in the known set (would be a fallback slug)
      if (!KNOWN_INLINE_METRIC_KEYS.has(metric_key)) continue;

      const period_type: FinancialFactPeriodType =
        period_label === "current" ? "unknown" : inferPeriodType(period_label);

      const sourceRef =
        opts.page_id ?? opts.document_id ?? opts.deal_id;

      const source_pointer = buildInlineSourcePointer(
        sourceRef,
        opts.page_number ?? 0,
        metric_key,
        period_label,
      );

      const fact_id = computeFactId({
        deal_id:     opts.deal_id,
        metric_key,
        period_type,
        period_label,
        source_pointer,
        document_id: opts.document_id,
      });

      const fact: FinancialFactV1 = {
        fact_id,
        deal_id:       opts.deal_id,
        document_id:   opts.document_id,
        source_kind:   "pdf_kpi_line",
        metric_key,
        metric_label:  rawLabel !== metric_key ? rawLabel : undefined,
        period_type,
        period_label,
        value:         parsed.value,
        unit:          parsed.unit,
        confidence:    "medium",
        reconciliation_status: "unknown",
        page_number:   opts.page_number,
        source_pointer,
        excerpt:       capFactExcerpt(line),
      };

      claims.push(fact);
    }
  } catch {
    return [];
  }

  return claims;
}

// ─── Internal extraction ──────────────────────────────────────────────────────

interface InlineClaim {
  rawLabel: string;
  parsed: ParsedNumeric;
  period_label: string;
  /** start index in `line` of the matched numeric token */
  matchStart: number;
  /** end index in `line` of the matched numeric token */
  matchEnd: number;
}

/**
 * Try to extract a (label, value, period) triple from a single text line.
 *
 * Returns null if no pattern matched.
 */
function tryExtractInlineClaim(line: string): InlineClaim | null {
  // P5 — checked FIRST because it has a very specific trigger verb that avoids
  // false positives; prevents P3 from stealing "raised $X" as a vague label.
  // Sentence: "raising/raised/raise/seeking/investing $X"
  const raiseMatch = line.match(
    /(?:raising|raised|raise|seeking|investing)\s+([\$\u20ac\u00a3\u00a5\u20b9][\d,.]+[KkMmBbTt]?)/i,
  );
  if (raiseMatch) {
    const valueStr = raiseMatch[1]!;
    const parsed = parseNumericToken(valueStr);
    if (parsed) {
      const matchStart = line.indexOf(valueStr, raiseMatch.index ?? 0);
      const matchEnd = matchStart + valueStr.length;
      const period_label = extractPeriodFromText(line) ?? "current";
      return {
        rawLabel: "raise amount",   // maps to raise_amount via alias
        parsed,
        period_label,
        matchStart,
        matchEnd,
      };
    }
  }

  // P1 / P2: "Label: $value" or "Label = $value" or "Label – $value"
  // NOTE: hyphen (-) is intentionally excluded from the separator set here to avoid
  // prematurely cutting hyphenated labels like "Post-money valuation: $25M".
  const colonMatch = line.match(
    /^([A-Za-z][A-Za-z0-9\s%/&(),.'-]{1,60}?)\s*[:=\u2013\u2014]\s*(.{1,60})$/,
  );
  if (colonMatch) {
    const rawLabel = colonMatch[1].trim();
    const valuePart = colonMatch[2].trim();
    // Only take the first token of valuePart for numeric parsing (avoid picking
    // up unrelated text after the numeric)
    const firstToken = valuePart.split(/\s+/)[0] ?? valuePart;
    const parsed = parseNumericToken(firstToken);
    if (parsed) {
      const matchStart = line.indexOf(firstToken, colonMatch[1].length + 1);
      const matchEnd = matchStart + firstToken.length;
      const period_label =
        extractPeriodFromText(valuePart) ??
        extractPeriodFromText(line) ??
        "current";
      return { rawLabel, parsed, period_label, matchStart, matchEnd };
    }
  }

  // P3: "Label $value" — label runs up to currency symbol
  // Pattern: word(s) followed by $/$€/etc + number
  const labelBeforeValue = line.match(
    /\b([A-Za-z][A-Za-z0-9\s%/&(),.'-]{1,50}?)\s+([$\u20ac\u00a3\u00a5\u20b9][\d,.]+[KkMmBbTt]?)/,
  );
  if (labelBeforeValue) {
    const rawLabel = labelBeforeValue[1].trim();
    const valueStr = labelBeforeValue[2];
    const parsed = parseNumericToken(valueStr);
    if (parsed && rawLabel.length >= 2) {
      const matchStart = line.indexOf(valueStr, labelBeforeValue.index ?? 0);
      const matchEnd = matchStart + valueStr.length;
      const period_label = extractPeriodFromText(line) ?? "current";
      return { rawLabel, parsed, period_label, matchStart, matchEnd };
    }
  }

  // P4: "$value Label" — value first, then label
  const valueBeforeLabel = line.match(
    /([$\u20ac\u00a3\u00a5\u20b9][\d,.]+[KkMmBbTt]?)\s+([A-Za-z][A-Za-z0-9\s%/&(),.'-]{1,50})/,
  );
  if (valueBeforeLabel) {
    const valueStr = valueBeforeLabel[1];
    const rawLabel = valueBeforeLabel[2].trim();
    const parsed = parseNumericToken(valueStr);
    if (parsed && rawLabel.length >= 2) {
      const matchStart = line.indexOf(valueStr, valueBeforeLabel.index ?? 0);
      const matchEnd = matchStart + valueStr.length;
      const period_label = extractPeriodFromText(line) ?? "current";
      return { rawLabel, parsed, period_label, matchStart, matchEnd };
    }
  }

  // P5 is handled at the top of this function.

  return null;
}

// ─── Source pointer ───────────────────────────────────────────────────────────

function buildInlineSourcePointer(
  sourceRef: string,
  pageNumber: number,
  metricKey: string,
  periodLabel: string,
): string {
  const hash = createHash("sha256")
    .update(`inline:${sourceRef}:${pageNumber}:${metricKey}:${periodLabel}`)
    .digest("hex")
    .slice(0, 8);
  return `pdf_kpi_line source=${sourceRef.slice(0, 32)} page=${pageNumber} metric=${metricKey} period=${periodLabel} h=${hash}`;
}
