/**
 * extract-kpi-tile-claims.ts
 *
 * Extracts prominent KPI callout values from investor deck slides.
 *
 * Targets isolated numeric metrics commonly displayed as large "hero" tiles:
 *  - "$40K+ MRR"          → {metric_key:"mrr",            value:40_000,       unit:"currency"}
 *  - "330k active users"  → {metric_key:"active_users",   value:330_000,      unit:"number"}
 *  - "85% retention"      → {metric_key:"retention_pct",  value:85,           unit:"percent"}
 *  - "€1B GTV"            → {metric_key:"gtv",            value:1_000_000_000,unit:"currency"}
 *  - "4 payment processors"→{metric_key:"partner_count",   value:4,            unit:"number"}
 *  - "20M impressions"    → {metric_key:"impression_count",value:20_000_000,   unit:"number"}
 *
 * source_kind: "kpi_tile" — peer rank with "pdf_kpi_line" in SOURCE_KIND_RANK.
 *
 * Design rules:
 *  - No LLM. Pure deterministic pattern matching.
 *  - Only emits facts when a canonical metric key can be identified.
 *  - Phrase-length guard: max 120 chars per segment.
 *  - Slide-type suppression: returns [] for team/testimonial/quote/cover/appendix slides.
 *  - Confidence starts at "low"; caller must apply applySlideAwareness() to boost
 *    to "medium" on traction/financials/raise_terms slides (boost >= 2).
 *  - Currency facts must have abs(value) >= MIN_CURRENCY_VALUE (1_000).
 *  - Year-like plain integers (1990–2050) without a currency symbol are rejected.
 *  - Never throws.
 */

import type { FinancialFactV1, FinancialFactPeriodType } from "@dealdecision/core";
import { computeFactId, capFactExcerpt, inferPeriodType } from "@dealdecision/core";
import {
  parseNumericToken,
  extractPeriodFromText,
  inferCurrencyCode,
} from "./extract-financial-table-claims";
import { detectUnitScale } from "../../extraction/xlsx/table-detector.js";

// ─── Page-level scale context ────────────────────────────────────────────────

/**
 * Number of lines to scan from the start of a page's text for a scale annotation.
 * e.g. "All amounts in $000s" or "(in thousands)" at the top of a traction slide.
 */
const PAGE_SCALE_SCAN_LINES = 6;

/**
 * Detect a page-level scale annotation from the first few lines of text.
 *
 * Returns { factor: 1, source_text: null } when no annotation is found.
 * When found, all KPI values without an explicit K/M/B/T token suffix are
 * multiplied by `factor` to normalize to absolute dollars.
 */
function detectPageScaleContext(text: string): { factor: number; source_text: string | null } {
  const lines = text
    .split("\n")
    .slice(0, PAGE_SCALE_SCAN_LINES)
    .map((l) => l.trim())
    .filter(Boolean);
  return detectUnitScale(lines);
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_KPI_CLAIMS_PER_PAGE = 15;
const MAX_LINE_CHARS = 120;
const MIN_CURRENCY_VALUE = 1_000;

/**
 * Slide types where extraction is suppressed — numeric mentions on these slides
 * are overwhelmingly non-financial (team bios, quotes, sport scores, etc.).
 *
 * "product" is included because product feature / demo slides frequently contain
 * UI screenshots whose embedded numbers (e.g. "$40K MRR" shown inside a demo
 * dashboard) reflect sample or customer-level data, not company-level KPIs.
 * Legitimate company traction callouts on a product slide cause the classifier
 * to resolve the slide as "traction" (higher priority) rather than "product".
 */
const SUPPRESSED_SLIDE_TYPES = new Set([
  "team",
  "testimonial",
  "quote",
  "cover",
  "appendix",
  "product",
]);

// ─── Public types ─────────────────────────────────────────────────────────────

export interface ExtractKpiTileClaimsOpts {
  deal_id: string;
  document_id?: string;
  page_number?: number;
  page_id?: string;
  slide_type?: string;
  slide_title?: string;
}

// ─── Metric detection table ───────────────────────────────────────────────────

/**
 * Priority-ordered KPI metric patterns.
 *
 * Checked in order; first match wins. More specific patterns (ARR, MRR, GTV)
 * appear before broader ones (revenue, users) to avoid ambiguity.
 */
const KPI_METRIC_PATTERNS: ReadonlyArray<{ key: string; pat: RegExp }> = [
  // ── Recurring revenue (must precede generic "revenue") ────────────────────
  { key: "arr",                   pat: /\barr\b|\bannual\s+recurring\s+revenue\b|\bannual\s+run\s+rate\b/i },
  { key: "mrr",                   pat: /\bmrr\b|\bmonthly\s+recurring\s+revenue\b|\bmonthly\s+run\s+rate\b/i },
  // ── Transaction / merchandise volume ─────────────────────────────────────
  { key: "gtv",                   pat: /\bgtv\b|\bgross\s+transaction\s+value\b/i },
  { key: "gmv",                   pat: /\bgmv\b|\bgross\s+merchandise\s+(?:value|volume)\b/i },
  // ── Revenue (broad — after ARR/MRR so they take priority) ────────────────
  { key: "revenue",               pat: /\brevenue\b|\bsales\b(?!\s+processor)|\bgtv\b/i },
  // ── Raise / valuation ────────────────────────────────────────────────────
  { key: "pre_money_valuation",   pat: /\bvaluation\b|\bpre.?money\b|\bvaluation\s+cap\b/i },
  { key: "raise_amount",          pat: /\braising\b|\braised?\b|\bfunding\b|\bseries\s+[a-c]\b|\bseed\s+round\b|\bcapital\s+raise\b|\bthe\s+ask\b|\bfunding\s+sought\b|\bamount\s+raising\b/i },
  // ── Unit economics ────────────────────────────────────────────────────────
  { key: "burn_rate",             pat: /\bburn\s+rate\b|\bmonthly\s+burn\b|\bnet\s+burn\b/i },
  { key: "runway_months",         pat: /\brunway\b|\boperating\s+runway\b/i },
  { key: "gross_margin",          pat: /\bgross\s+margin\b/i },
  { key: "gross_profit",          pat: /\bgross\s+profit\b/i },
  { key: "ebitda",                pat: /\bebitda\b/i },
  { key: "net_revenue_retention", pat: /\bnrr\b|\bnet\s+revenue\s+retention\b|\bnet\s+dollar\s+retention\b/i },
  { key: "churn_pct",             pat: /\bchurn\b/i },
  { key: "retention_pct",         pat: /\bretention\b/i },
  { key: "cac",                   pat: /\bcac\b|\bcustomer\s+acquisition\s+cost\b/i },
  { key: "ltv",                   pat: /\bltv\b|\blifetime\s+value\b/i },
  { key: "arpu",                  pat: /\barpu\b|\bavg\s+revenue\s+per\s+user\b|\baverage\s+revenue\s+per\s+user\b/i },
  // ── Count metrics ─────────────────────────────────────────────────────────
  { key: "active_users",          pat: /\bactive\s+users?\b|\bdau\b|\bmau\b|\bmonthly\s+active\s+users?\b|\bdaily\s+active\s+users?\b/i },
  { key: "active_users",          pat: /\busers?\b/i },          // broad — checked after "active users"
  { key: "customer_count",        pat: /\bcustomers?\b|\bclients?\b/i },
  { key: "merchant_count",        pat: /\bmerchants?\b/i },
  { key: "impression_count",      pat: /\bimpressions?\b/i },
  { key: "partner_count",         pat: /\bpayment\s+processors?\b|\bprocessors?\b|\bpartners?\b|\binstitutions?\b/i },
  // ── Other ─────────────────────────────────────────────────────────────────
  { key: "headcount",             pat: /\bemployees?\b|\bheadcount\b|\bteam\s+size\b/i },
  { key: "cash",                  pat: /\bcash\s+(?:balance|on\s+hand|reserves?|position)\b|\bending\s+cash\b/i },
];

/** Canonical KPI metric keys valid for this extractor. */
const KNOWN_KPI_METRIC_KEYS = new Set(KPI_METRIC_PATTERNS.map((x) => x.key));

/** Metric keys that represent currency values — used to prefer currency-tagged tokens. */
const CURRENCY_METRIC_KEYS = new Set([
  "arr", "mrr", "gtv", "gmv", "revenue", "pre_money_valuation", "raise_amount",
  "burn_rate", "gross_profit", "ebitda", "cash", "cac", "ltv", "arpu",
]);

// ─── Context-level guards ─────────────────────────────────────────────────────

/**
 * Matches segments describing customer examples, use cases, scenarios, or
 * hypothetical economics — NOT company-level financial facts.
 *
 * When matched, the segment is skipped so that "example merchant ARR $7K"
 * or "use case: $40K MRR per merchant" never pollute company-level facts.
 */
const EXAMPLE_CONTEXT_RE =
  /\b(?:use[\s-]case|use_case|scenario|hypothetical|illustrative|case\s+study|sample\s+(?:merchant|customer|client|scenario|economics)|merchant\s+example|customer\s+example|fi\s+example|institution\s+example|example\s+(?:economics|customer|merchant|client|institution))\b/i;

/**
 * Matches market-size projection phrases: "Per SAM ARR", "% of SOM", "SAM ARR",
 * and standalone market-size labels: "addressable market", "market opportunity",
 * "market size", "TAM:", "SAM:", "SOM:".
 * Applied only to revenue/ARR/MRR/GTV/GMV — these are market-capture projections,
 * not current company traction metrics.
 */
const MARKET_PROJECTION_RE =
  /\bper\s+(?:sam|som|tam)\b|%\s*of\s+(?:tam|sam|som)\b|\bsam\s+arr\b|\bsom\s+arr\b|\bsam\s+mrr\b|\bsom\s+mrr\b|\b(?:total\s+)?addressable\s+market\b|\bmarket\s+(?:size|opportunity)\b|\b(?:tam|sam|som)\s*[:\-]\s*\$|\brev(?:enue)?\s+opportunity\b/i;

/** Revenue/ARR/MRR/GTV/GMV — suppressed when MARKET_PROJECTION_RE matches the segment. */
const MARKET_PROJECTION_SENSITIVE_KEYS = new Set(["arr", "mrr", "revenue", "gtv", "gmv"]);

/**
 * Returns true when `text` contains cue words indicating the content describes
 * a customer example, use case, scenario, or hypothetical — NOT company metrics.
 *
 * Exported for testing and reuse by sibling extractors.
 */
export function isExampleOrScenarioContext(text: string): boolean {
  return EXAMPLE_CONTEXT_RE.test(text);
}

// ─── Value token extraction ───────────────────────────────────────────────────

/**
 * Ordered patterns (most to least specific) for locating a numeric value token
 * in a KPI phrase.
 *
 * Intentionally broad — parseNumericToken() performs the authoritative parse.
 * Note: For currency-prefixed tokens (e.g. "$3.5 B"), a single whitespace is
 * allowed before the scale suffix so that OCR-split tokens like "$3.5" + " B"
 * are captured as one unit. The negative lookahead (?!\w) prevents "basis" or
 * "billion" from being mistaken for the single-char scale suffix "b".
 * NO whitespace is allowed for bare numeric tokens (no currency symbol) to
 * prevent "6000 merchants" from being read as "6000M" (6 billion).
 */
const VALUE_TOKEN_RE =
  /[$€£¥₹]\s*[\d,.]+(?:\s*[KkMmBbTt](?!\w))?[+~]?|[\d,.]+[KkMmBbTt%][+~]?|[\d,.]+/g;

interface ExtractedValueToken {
  raw: string;
  /** Raw token with trailing `+`, `~` stripped — safe for parseNumericToken(). */
  clean: string;
  index: number;
}

function extractValueTokens(text: string): ExtractedValueToken[] {
  const tokens: ExtractedValueToken[] = [];
  VALUE_TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = VALUE_TOKEN_RE.exec(text)) !== null) {
    tokens.push({
      raw:   m[0],
      clean: m[0].replace(/\s+/g, "").replace(/[+~]$/, ""),
      index: m.index,
    });
  }
  return tokens;
}

/**
 * Pick the value token closest to the metric keyword match position.
 *
 * For currency metric keys, prefers tokens that carry an explicit currency
 * symbol (e.g. "$", "€") and among those picks the one nearest the label.
 * Falls back to the overall nearest token when no symbol-bearing token exists.
 */
function pickBestValueToken(
  tokens: ExtractedValueToken[],
  metricMatch: { matchStart: number; matchEnd: number },
  metricKey: string,
): ExtractedValueToken | null {
  if (tokens.length === 0) return null;
  if (tokens.length === 1) return tokens[0]!;

  const metricMid = (metricMatch.matchStart + metricMatch.matchEnd) / 2;
  const distanceTo = (t: ExtractedValueToken) => Math.abs(t.index - metricMid);

  if (CURRENCY_METRIC_KEYS.has(metricKey)) {
    const symbolTokens = tokens.filter((t) => /[$€£¥₹]/.test(t.clean));
    if (symbolTokens.length > 0) {
      return symbolTokens.reduce((best, t) => (distanceTo(t) < distanceTo(best) ? t : best));
    }
  }

  return tokens.reduce((best, t) => (distanceTo(t) < distanceTo(best) ? t : best));
}

// ─── Metric detection ─────────────────────────────────────────────────────────

function findMetricInText(text: string): { key: string; matchStart: number; matchEnd: number } | null {
  for (const { key, pat } of KPI_METRIC_PATTERNS) {
    const m = pat.exec(text);
    if (m) return { key, matchStart: m.index, matchEnd: m.index + m[0].length };
  }
  return null;
}

// ─── Guards ───────────────────────────────────────────────────────────────────

/** Returns true when a plain integer resembles a calendar year (no financial meaning). */
function isYearLike(value: number): boolean {
  return Number.isInteger(value) && value >= 1990 && value <= 2050;
}

// ─── Main extraction ──────────────────────────────────────────────────────────

/**
 * Extract KPI tile facts from a page's OCR / DPU text.
 *
 * Each short phrase (line or delimited segment) is inspected for a
 * numeric value alongside a known metric label. One fact per
 * (metric_key, period_label) per call.
 *
 * Returns [] on any error or when slide_type is in SUPPRESSED_SLIDE_TYPES.
 */
export function extractKpiTileClaims(
  text: string,
  opts: ExtractKpiTileClaimsOpts,
): FinancialFactV1[] {
  if (!text || text.length < 4) return [];

  // Gate: suppress extraction on non-relevant slide types
  if (opts.slide_type && SUPPRESSED_SLIDE_TYPES.has(opts.slide_type)) return [];

  // Detect page-level scale annotation once for the whole page.
  // Applied to values that carry no explicit K/M/B/T suffix.
  const { factor: pageScaleFactor, source_text: pageScaleSourceText } =
    detectPageScaleContext(text);

  const claims: FinancialFactV1[] = [];
  /** Dedup guard within a single page call */
  const emittedKeys = new Set<string>();

  try {
    // Split text into short segments:
    //   1. Split on newlines
    //   2. Sub-split each line on common KPI tile delimiters (bullet, pipe, slash)
    const segments = text
      .split(/\n/)
      .flatMap((line) => line.split(/[•·|\/]+/).map((s) => s.trim()))
      .filter((s) => s.length >= 5);

    for (const segment of segments) {
      if (claims.length >= MAX_KPI_CLAIMS_PER_PAGE) break;

      // Guard: reject long segments (prose rather than tiles)
      if (segment.length > MAX_LINE_CHARS) continue;

      // Guard: reject run-on segments with too many words
      const wordCount = segment.trim().split(/\s+/).length;
      if (wordCount > 20) continue;

      // Guard: skip example/use-case/scenario segments — describes hypothetical
      // or customer-level economics, not company traction.
      if (isExampleOrScenarioContext(segment)) continue;

      // ── Step 1: find the metric in this segment ──────────────────────────
      const matchedMetric = findMetricInText(segment);
      if (!matchedMetric) continue;

      // Guard: skip market-size projection context for revenue/ARR/MRR/GTV/GMV.
      // "Per SAM ARR", "% of SOM", "SOM ARR" are market-capture projections,
      // not company traction metrics.
      if (
        MARKET_PROJECTION_SENSITIVE_KEYS.has(matchedMetric.key) &&
        MARKET_PROJECTION_RE.test(segment)
      ) continue;

      // ── Step 2: find and pick best value token ───────────────────────────
      const valueTokens = extractValueTokens(segment);
      if (valueTokens.length === 0) continue;

      // Guard: too many values in one segment → table row, not a KPI tile.
      // A genuine KPI tile has one prominent number (occasionally a comparison
      // like "40K / 120K potential"). More than 2 distinct tokens almost always
      // indicates an OCR'd table row where column values from adjacent cells
      // bleed into a single segment (e.g. "$7,000 $6.3M $7,000" from a TAM table).
      if (valueTokens.length > 2) continue;

      const bestToken = pickBestValueToken(valueTokens, matchedMetric, matchedMetric.key);
      if (!bestToken) continue;

      const parsed = parseNumericToken(bestToken.clean);
      if (!parsed || !Number.isFinite(parsed.value)) continue;

      // ── Guards on parsed value ───────────────────────────────────────────

      // Reject year-like plain integers without a currency symbol
      if (
        parsed.unit === "number" &&
        !/[$€£¥₹]/.test(bestToken.clean) &&
        isYearLike(parsed.value)
      ) continue;

      // Apply page-level scale when no explicit K/M/B/T suffix was used.
      // Double-scaling guard: if the token already expanded a scale suffix
      // (e.g. "$5.12M" → already 5_120_000), do NOT multiply again.
      const effectiveValue = parsed.has_explicit_scale_suffix
        ? parsed.value
        : parsed.value * pageScaleFactor;

      // Currency facts must meet minimum threshold
      if (parsed.unit === "currency" && Math.abs(effectiveValue) < MIN_CURRENCY_VALUE) continue;

      // Guard: currency-keyed metrics with a bare number token (no $ symbol)
      // must also meet the minimum threshold to avoid "revenue: 2" style noise.
      if (
        CURRENCY_METRIC_KEYS.has(matchedMetric.key) &&
        parsed.unit === "number" &&
        Math.abs(effectiveValue) < MIN_CURRENCY_VALUE
      ) continue;

      // ── Build the fact ───────────────────────────────────────────────────
      const currency =
        parsed.unit === "currency" ? inferCurrencyCode(bestToken.clean) : undefined;

      const period_label = extractPeriodFromText(segment) ?? "current";
      const period_type: FinancialFactPeriodType =
        period_label === "current" ? "unknown" : inferPeriodType(period_label);

      // Dedup within this page call
      const dedupeKey = `${matchedMetric.key}:${period_label}`;
      if (emittedKeys.has(dedupeKey)) continue;
      emittedKeys.add(dedupeKey);

      const sourceRef = opts.page_id ?? opts.document_id ?? opts.deal_id;
      const source_pointer = [
        `kpi_tile:${sourceRef}`,
        `pg=${opts.page_number ?? 0}`,
        `metric=${matchedMetric.key}`,
        `period=${period_label}`,
      ].join(" ");

      const fact_id = computeFactId({
        deal_id:     opts.deal_id,
        metric_key:  matchedMetric.key,
        period_type,
        period_label,
        source_pointer,
        document_id: opts.document_id,
      });

      claims.push({
        fact_id,
        deal_id:               opts.deal_id,
        document_id:           opts.document_id,
        source_kind:           "kpi_tile",
        metric_key:            matchedMetric.key,
        period_type,
        period_label,
        value:                 effectiveValue,
        unit:                  parsed.unit,
        currency,
        confidence:            "low",
        reconciliation_status: "unknown",
        page_number:           opts.page_number,
        source_pointer,
        excerpt:               capFactExcerpt(segment),
        slide_type:            opts.slide_type,
        slide_title:           opts.slide_title,
        // Page-level scale auditability: set when scale was applied from context.
        ...(pageScaleFactor > 1 && !parsed.has_explicit_scale_suffix ? {
          unit_scale_factor_applied: pageScaleFactor,
          unit_scale_source_text:    pageScaleSourceText,
        } : {}),
      });
    }
  } catch {
    // Never rethrow — always return what was collected
  }

  return claims;
}

// ─── Exported internals (for testing) ────────────────────────────────────────

export { findMetricInText, isYearLike, KNOWN_KPI_METRIC_KEYS, SUPPRESSED_SLIDE_TYPES, MARKET_PROJECTION_SENSITIVE_KEYS };
