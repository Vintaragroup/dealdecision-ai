/**
 * extract-financial-table-claims.ts
 *
 * Deterministic extraction of FinancialFactV1 entries from raw text regions
 * that contain financial tables or structured financial data in PDF pages.
 *
 * Strategy:
 * 1. Detect if the text region is likely a financial table (currency density or
 *    pipe-separated rows).
 * 2. For each line, attempt to match label + optional period + value patterns.
 * 3. Normalize labels via `normalizeMetricKey`.
 * 4. Infer period from column headers or inline context.
 * 5. Emit FinancialFactV1 entries with source_kind="pdf_table".
 *
 * Hard limits:
 * - Max 40 claims per call (avoids noise pages).
 * - Empty / non-financial pages return [].
 * - Never throws.
 */

import { createHash } from "crypto";
import type {
  FinancialFactV1,
  FinancialFactUnit,
  FinancialFactPeriodType,
} from "@dealdecision/core";
import {
  capFactExcerpt,
  computeFactId,
  inferPeriodType,
} from "@dealdecision/core";
import type { FinancialFactSourceKind } from "@dealdecision/core";
import { normalizeMetricKey, isKnownMetricKey, FINANCIAL_SIGNAL_KEYWORDS_RE } from "./financial-metric-aliases";

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_CLAIMS_PER_PAGE = 40;

// ─── Public types ─────────────────────────────────────────────────────────────

export interface ExtractFinancialTableClaimsOpts {
  deal_id: string;
  document_id?: string;
  page_number?: number;
  /** Optional unique ID used only for source_pointer disambiguation */
  page_id?: string;
  /**
   * Override the source_kind assigned to extracted facts.
   * Defaults to "pdf_table". Pass "xlsx" when the source document is a spreadsheet.
   */
  source_kind_override?: FinancialFactSourceKind;
  /**
   * Resolved slide type from DPU payload (resolved_slide_type).
   * When provided, the value is stamped on each emitted fact.
   * Confidence adjustment is handled separately by applySlideAwareness().
   */
  slide_type?: string;
  /** Human-readable slide title from DPU payload. */
  slide_title?: string;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Quick pre-filter: returns true if the text is likely a financial table page
 * or contains enough financial signal to be worth deeper extraction.
 *
 * Rules (any one triggers):
 *  A. >= 3 currency symbol occurrences  (table / financial summary)
 *  B. >= 2 pipe-separated lines         (table structure)
 *  C. >= 2 tab+numeric lines            (TSV table)
 *  D. >= 1 line with expanded finance keyword + number  (KPI mention)
 *  E. >= 2 currency symbols AND finance keyword present (ask/traction slides)
 */
export function detectFinancialTableCandidate(text: string): boolean {
  if (!text || text.length < 10) return false;

  // A. Currency symbol density: at least 3 occurrences in the text
  const currencyMatches = text.match(/[$€£¥₹]|USD|EUR|GBP/g);
  if (currencyMatches && currencyMatches.length >= 3) return true;

  // B. Pipe-separated table pattern: at least 2 lines with | separator
  const pipeLines = text.split("\n").filter((l) => l.includes("|"));
  if (pipeLines.length >= 2) return true;

  // C. Tab-separated numeric rows: at least 2 lines with tabs + numbers
  const tabNumLines = text.split("\n").filter((l) => /\t.*[\d,.]+/.test(l));
  if (tabNumLines.length >= 2) return true;

  // D. Financial keyword + number on same line (expanded keyword set)
  const kwLines = text.split("\n").filter((l) =>
    /\b(revenue|arr|mrr|burn|runway|gross|ebitda|cogs|valuation|raise|raising|raised|seed|series|forecast|budget|opex|margin|invest|gmv|nrr|churn|retention|ltv|cac|arpu|headcount)\b/i.test(l) &&
    /[\d,.]+/.test(l)
  );
  if (kwLines.length >= 1) return true;

  // E. 2+ currency symbols combined with a finance keyword anywhere in text
  if (
    currencyMatches &&
    currencyMatches.length >= 2 &&
    /\b(revenue|arr|mrr|burn|runway|gross|ebitda|cogs|valuation|raise|raising|seed|series|opex|margin|gmv)\b/i.test(text)
  ) {
    return true;
  }

  return false;
}

/**
 * Extract FinancialFactV1 entries from a raw text region.
 * Returns [] when nothing useful is found.
 */
export function extractFinancialTableClaims(
  text: string,
  opts: ExtractFinancialTableClaimsOpts,
): FinancialFactV1[] {
  if (!text || !opts.deal_id) return [];
  if (!detectFinancialTableCandidate(text)) return [];

  try {
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    const claims: FinancialFactV1[] = [];

    // Attempt to detect column headers (for period inference)
    const headerPeriods = extractColumnHeaders(lines);

    for (const line of lines) {
      if (claims.length >= MAX_CLAIMS_PER_PAGE) break;

      // Skip pure separator lines
      if (/^[-=|_\s]+$/.test(line)) continue;

      const extracted = tryExtractLineClaim(line, headerPeriods);
      if (!extracted) continue;

      const { rawLabel, value, unit, currency, period_label, confidence, excerpt } =
        extracted;

      const metric_key = normalizeMetricKey(rawLabel);
      // Skip noise metric keys (job titles, OCR artifacts, sentence fragments)
      if (shouldSkipMetricKey(metric_key, rawLabel)) continue;

      // Reject placeholder / zero currency values (e.g. OCR artifact "$000", "$0")
      // Note: zero IS valid for percent (0% churn) and plain number (0 headcount)
      if (unit === "currency" && value === 0) continue;

      // Reject implausibly small currency values that are almost certainly
      // OCR artifacts (e.g. "$1", "$2").  Threshold: < $100.
      if (unit === "currency" && Math.abs(value) < 100) continue;

      const period_type: FinancialFactPeriodType =
        period_label === "current" ? "unknown" : inferPeriodType(period_label);

      const source_pointer = buildSourcePointer(
        opts.page_id ?? opts.document_id ?? opts.deal_id,
        opts.page_number ?? 0,
        metric_key,
        period_label,
      );

      const fact_id = computeFactId({
        deal_id: opts.deal_id,
        metric_key,
        period_type,
        period_label,
        source_pointer,
        document_id: opts.document_id,
      });

      const fact: FinancialFactV1 = {
        fact_id,
        deal_id: opts.deal_id,
        document_id: opts.document_id,
        source_kind: opts.source_kind_override ?? "pdf_table",
        metric_key,
        metric_label: rawLabel !== metric_key ? rawLabel : undefined,
        period_type,
        period_label,
        value,
        unit,
        currency,
        confidence,
        reconciliation_status: "unknown",
        page_number: opts.page_number,
        source_pointer,
        excerpt: capFactExcerpt(excerpt ?? line),
        slide_type:  opts.slide_type,
        slide_title: opts.slide_title,
      };

      claims.push(fact);
    }

    return claims;
  } catch {
    return [];
  }
}

// ─── Line parser ─────────────────────────────────────────────────────────────

interface ExtractedLineClaim {
  rawLabel: string;
  value: number;
  unit: FinancialFactUnit;
  currency?: string;
  period_label: string;
  confidence: "high" | "medium" | "low";
  excerpt?: string;
}

/** Map a leading currency symbol to its ISO 4217 code. */
export function inferCurrencyCode(token: string): string | undefined {
  const s = token.trim();
  if (s.startsWith("$"))  return "USD";
  if (s.startsWith("€"))  return "EUR";
  if (s.startsWith("£"))  return "GBP";
  if (s.startsWith("¥"))  return "JPY";
  if (s.startsWith("₹"))  return "INR";
  return undefined;
}

/**
 * Attempt to extract a (label, value, period) triple from a single text line.
 *
 * Supported formats:
 * 1. Pipe-separated:  `Revenue | FY2024 | $1,200,000`
 *                     `Gross Margin | 65%`
 * 2. Colon-separated: `ARR: $2M`
 * 3. Tab-separated:   `Revenue\t2024\t$1.2M`
 * 4. Inline mention:  `Revenue $1.2M FY2024`
 */
function tryExtractLineClaim(
  line: string,
  headerPeriods: string[],
): ExtractedLineClaim | null {
  // ── 1. Pipe-separated ──────────────────────────────────────────────────────
  const pipeParts = line.split("|").map((p) => p.trim()).filter(Boolean);
  if (pipeParts.length >= 2) {
    return extractFromParts(pipeParts, "high");
  }

  // ── 2. Tab-separated ──────────────────────────────────────────────────────
  const tabParts = line.split("\t").map((p) => p.trim()).filter(Boolean);
  if (tabParts.length >= 2 && hasNumericPart(tabParts)) {
    return extractFromParts(tabParts, "high");
  }

  // ── 3. Colon-separated ────────────────────────────────────────────────────
  const colonMatch = line.match(/^([A-Za-z][\w\s%/&()-]{0,60}):\s*(.+)$/);
  if (colonMatch) {
    const parts = [colonMatch[1].trim(), colonMatch[2].trim()];
    const result = extractFromParts(parts, "medium");
    if (result) return result;
  }

  // ── 4. Inline mention с period from header context ────────────────────────
  const inlineResult = tryInlineExtract(line, headerPeriods);
  if (inlineResult) return inlineResult;

  return null;
}

/** Extract from an ordered array of parts: [label, (period?), value, ...] */
function extractFromParts(
  parts: string[],
  confidence: "high" | "medium" | "low",
): ExtractedLineClaim | null {
  if (parts.length < 2) return null;

  // Find the label (first non-numeric, non-period part)
  let rawLabel = parts[0] ?? "";
  if (!rawLabel || rawLabel.length < 2) return null;
  if (isNumericToken(rawLabel)) return null;

  // Strip XLSX row-number prefix: "- 9: Label text" → "Label text"
  rawLabel = rawLabel.replace(/^-?\s*\d+\s*:\s*/, "").trim();
  if (!rawLabel) return null;

  // Detect scale annotation in label: ($000) → 1000, ($M) → 1_000_000 etc.
  const scaleMultiplier = detectScaleAnnotation(rawLabel);
  // Strip scale annotation from label for cleaner alias normalisation
  const cleanLabel = rawLabel.replace(/\s*\(\s*\$\s*(?:000|k|K|M|m|B|b|millions?|thousands?|billions?)\s*\)/gi, "").trim();

  // Collect all parseable numeric values from remaining parts
  const numericCandidates: Array<{
    index: number; value: number; unit: string; currency?: string;
  }> = [];
  for (let i = 1; i < parts.length; i++) {
    // Look-ahead: if the next part is a lone scale suffix (K/M/B/T), combine it
    // with the current part so "$3.5" + "B" → "$3.5B" before parsing.
    const nextPart = parts[i + 1]?.trim() ?? "";
    const tokenToTry =
      /^[KkMmBbTt]$/.test(nextPart) && /[$€£¥₹\d]/.test(parts[i] ?? "")
        ? (parts[i] ?? "") + nextPart
        : (parts[i] ?? "");

    const parsed = parseNumericToken(tokenToTry);
    if (parsed === null) continue;

    numericCandidates.push({
      index: i,
      value: parsed.value * scaleMultiplier,
      unit: parsed.unit,
      currency: parsed.unit === "currency" ? inferCurrencyCode(parts[i] ?? "") : undefined,
    });
  }

  if (numericCandidates.length === 0) return null;

  // For time-series rows (3+ numeric columns — e.g. XLSX quarterly P&L),
  // prefer the last non-zero value to represent the most recent period.
  // Falls back to the first candidate when all values are zero.
  const chosen: typeof numericCandidates[number] =
    numericCandidates.length >= 3
      ? (numericCandidates.filter((c) => c.value !== 0).at(-1) ?? numericCandidates[0]!)
      : numericCandidates[0]!;

  // Look for an adjacent period label
  const period_label = findPeriodLabel(parts, chosen.index);

  return {
    rawLabel: cleanLabel || rawLabel,
    value: chosen.value,
    unit: chosen.unit as FinancialFactUnit,
    currency: chosen.currency,
    period_label: period_label ?? "current",
    confidence,
    excerpt: parts.join(" | "),
  };
}

/**
 * Detect a scale multiplier from label annotations common in XLSX financial models.
 *   "($000)" or "($ thousands)" → 1_000
 *   "($M)" or "($ millions)"   → 1_000_000
 *   "($B)" or "($ billions)"   → 1_000_000_000
 *   No annotation              → 1 (pass-through)
 */
function detectScaleAnnotation(label: string): number {
  const m = label.match(
    /\(\s*\$?\s*(000|k|K|M|m|B|b|millions?|thousands?|billions?)\s*\)/i,
  );
  if (!m) return 1;
  const s = (m[1] ?? "").toLowerCase();
  if (s === "000" || s === "k" || s.startsWith("thous")) return 1_000;
  if (s === "m" || s.startsWith("mill")) return 1_000_000;
  if (s === "b" || s.startsWith("bill")) return 1_000_000_000;
  return 1;
}

/** Try to extract a financial claim from an inline sentence-like line */
function tryInlineExtract(
  line: string,
  headerPeriods: string[],
): ExtractedLineClaim | null {
  // Pattern: "Revenue $1.2M", "ARR: €2.5M in FY2024", "GTV £3.5M"
  const match = line.match(
    /\b([A-Za-z][\w\s%-]{2,50}?)\s+(?:of\s+|:\s*)?([$€£¥₹][\d,.]+(?:\s*[KkMmBbTt](?!\w))?|\d[\d,.]+\s*[KkMmBbTt]?%?)/
  );
  if (!match) return null;

  const rawLabel = match[1].trim();
  if (rawLabel.length < 2 || isNumericToken(rawLabel)) return null;

  const parsed = parseNumericToken(match[2]);
  if (!parsed) return null;

  // Try to find period in the same line
  const linePeriod = extractPeriodFromText(line);
  const period_label =
    linePeriod ?? headerPeriods[0] ?? "current";

  return {
    rawLabel,
    value: parsed.value,
    unit: parsed.unit,
    currency: parsed.unit === "currency" ? inferCurrencyCode(match[2]) : undefined,
    period_label,
    confidence: "low",
    excerpt: line,
  };
}

// ─── Period detection ────────────────────────────────────────────────────────

/** Look for period tokens in a parts array around a numeric value */
function findPeriodLabel(parts: string[], valueIndex: number): string | null {
  for (let i = 1; i < parts.length; i++) {
    if (i === valueIndex) continue;
    const period = extractPeriodFromText(parts[i]);
    if (period) return period;
  }
  return null;
}

/**
 * Extract a period label from a text fragment.
 * Handles: FY2024, FY2025, Q1 2024, Q3-2024, 2024, 2024-03, TTM, LTM,
 *          YTD, H1 2024, H2 2024, 2024E (estimate), Forecast 2025,
 *          Budget 2025, Q1/Q2/Q3/Q4 (no year attached)
 */
export function extractPeriodFromText(text: string): string | null {
  const s = text.trim();

  // TTM / LTM
  if (/^(ttm|ltm)$/i.test(s)) return s.toUpperCase();

  // YTD (year-to-date) — treat as a period label so inferPeriodType maps it
  if (/\bYTD\b/i.test(s)) return "YTD";

  // "FY2024" or "FY 2024"
  const fyMatch = s.match(/\bFY\s*(\d{4})\b/i);
  if (fyMatch) return `FY${fyMatch[1]}`;

  // "Fiscal 2024" or "Fiscal Year 2024"
  const fiscalMatch = s.match(/\bfiscal(?:\s+year)?\s+(\d{4})\b/i);
  if (fiscalMatch) return `FY${fiscalMatch[1]}`;

  // "Forecast 2025", "Budget 2025", "Plan 2025", "Est 2025", "Proj 2025"
  const forecastMatch = s.match(
    /\b(?:forecast|budget|plan|estimate[ds]?|est|proj(?:ected)?)\s+(\d{4})\b/i,
  );
  if (forecastMatch) return `FY${forecastMatch[1]}`;

  // "2024E", "2025E", "2026E" (estimate suffix)
  const estYearMatch = s.match(/\b(20\d{2})E\b/);
  if (estYearMatch) return `FY${estYearMatch[1]}`;

  // "Q2 2024" or "Q2-2024" or "2024 Q2"
  const qMatch = s.match(/\bQ([1-4])[\s\-_](\d{4})\b|\b(\d{4})[\s\-_]Q([1-4])\b/i);
  if (qMatch) {
    const q = qMatch[1] ?? qMatch[4];
    const year = qMatch[2] ?? qMatch[3];
    return `Q${q} ${year}`;
  }

  // "Q1", "Q2", "Q3", "Q4" (standalone — no year)
  const qAloneMatch = s.match(/^Q([1-4])$/i);
  if (qAloneMatch) return `Q${qAloneMatch[1]}`;

  // "H1 2024", "H2 2024", "H1-2024", "2024 H1"
  const halfMatch = s.match(/\bH([12])[\s\-_](\d{4})\b|\b(\d{4})[\s\-_]H([12])\b/i);
  if (halfMatch) {
    const h = halfMatch[1] ?? halfMatch[4];
    const year = halfMatch[2] ?? halfMatch[3];
    return `H${h} ${year}`;
  }

  // "2024-03" monthly
  const monthlyMatch = s.match(/\b(\d{4})-(\d{2})\b/);
  if (monthlyMatch) return `${monthlyMatch[1]}-${monthlyMatch[2]}`;

  // Standalone year "2024"
  const yearMatch = s.match(/\b(20\d{2}|19\d{2})\b/);
  if (yearMatch) return `FY${yearMatch[1]}`;

  return null;
}

/** Scan first ~5 lines for period column headers */
function extractColumnHeaders(lines: string[]): string[] {
  const periods: string[] = [];
  const headerLines = lines.slice(0, Math.min(5, lines.length));
  for (const line of headerLines) {
    // Look for FY patterns, Q patterns, year, TTM/LTM, YTD, H1/H2, estimate suffix
    const matches = line.match(
      /\b(?:FY\s*\d{4}|\d{4}E|H[12]\s+\d{4}|Q[1-4]\s+\d{4}|Q[1-4]|YTD|\d{4}|TTM|LTM)\b/gi
    );
    if (matches) {
      for (const m of matches) {
        const period = extractPeriodFromText(m);
        if (period && !periods.includes(period)) periods.push(period);
      }
    }
  }
  return periods;
}

// ─── Numeric parsing ─────────────────────────────────────────────────────────

export interface ParsedNumeric {
  value: number;
  unit: FinancialFactUnit;
}

/** Parse tokens like "$1.2M", "65%", "120k", "1,200,000", "2.5B" */
export function parseNumericToken(token: string): ParsedNumeric | null {
  const s = token.trim().replace(/\s+/g, "");
  if (!s) return null;

  // Percent
  const pctMatch = s.match(/^[^%\d]*(\d[\d,.]*)\s*%$/);
  if (pctMatch) {
    const v = parseFloat(pctMatch[1].replace(/,/g, ""));
    if (!Number.isFinite(v)) return null;
    return { value: v, unit: "percent" };
  }

  // Currency with multiplier: $1.2M, $120k, $2.5B etc.
  const currMatch = s.match(
    /^[$€£¥₹]?\s*(-?[\d,.]+)\s*([KkMmBbTt]?)$/
  );
  if (currMatch) {
    const raw = parseFloat(currMatch[1].replace(/,/g, ""));
    if (!Number.isFinite(raw)) return null;
    const mult = resolveMultiplier(currMatch[2] ?? "");
    const hasCurrencySymbol = /[$€£¥₹]/.test(s);
    return {
      value: raw * mult,
      unit: hasCurrencySymbol ? "currency" : "number",
    };
  }

  return null;
}

function resolveMultiplier(suffix: string): number {
  switch (suffix.toUpperCase()) {
    case "K": return 1_000;
    case "M": return 1_000_000;
    case "B": return 1_000_000_000;
    case "T": return 1_000_000_000_000;
    default:  return 1;
  }
}

function isNumericToken(s: string): boolean {
  return /^[$€£¥₹\-]?[\d,.]+[KkMmBbTt%]?$/.test(s.trim());
}

function hasNumericPart(parts: string[]): boolean {
  return parts.some((p) => parseNumericToken(p) !== null);
}

// ─── Skip logic ───────────────────────────────────────────────────────────────

/** Stop words that alone cannot form a valid metric key */
const METRIC_STOP_TOKENS = new Set(["of", "the", "a", "an", "and", "but", "or"]);
/** Common verbs that indicate a sentence fragment rather than a metric label */
const METRIC_VERB_TOKENS = new Set(["will", "has", "have", "had", "exceed", "exceeds", "exceeded", "expects", "projected"]);

/**
 * HR / job-title tokens.  A metric key slug containing any of these is almost
 * certainly an OCR artifact from a headcount table (e.g. "warehouse_associate",
 * "senior_director_day_rate").
 *
 * NOTE: "headcount" and "employees" are valid canonical keys so they do NOT
 * appear here — only tokens that exclusively appear in job titles / HR context.
 */
const JOB_TITLE_TOKENS = new Set([
  "associate", "assistant", "coordinator", "specialist", "consultant",
  "analyst", "engineer", "developer", "designer", "scientist", "intern",
  "director", "executive", "officer", "president", "chairman", "chairman",
  "supervisor", "lead", "clerk", "technician", "accountant", "recruiter",
  "representative", "ceo", "cto", "cfo", "coo", "svp", "evp",
]);

/**
 * Calendar / day-of-week / month tokens.  A metric key slug containing any
 * of these (and not already in the alias map) is miscategorised noise,
 * e.g. "warehouse_associate_day", "fortune_monday".
 */
const CALENDAR_NOISE_TOKENS = new Set([
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "january", "february", "march", "april", "june", "july",
  "august", "september", "october", "november", "december",
  "daily", "weekly",
]);

/**
 * Returns true when the metric_key slug should be rejected as noise.
 *
 * Two-tier acceptance:
 *  Tier-1 (alias-mapped): key is in KNOWN_CANONICAL_METRIC_KEYS → always accept.
 *  Tier-2 (slug fallback): only accept if:
 *    - ≤ 3 tokens (short descriptor)
 *    - no job-title, calendar, or verb tokens
 *    - raw label contains a financial signal keyword
 */
function shouldSkipMetricKey(key: string, rawLabel: string): boolean {
  if (!key || key.length < 2) return true;
  if (/^\d/.test(key)) return true;
  if (rawLabel.trim().length < 2) return true;

  // Tier-1: clean alias-mapped key — structural checks only
  if (isKnownMetricKey(key)) {
    const tokens = key.split("_");
    if (tokens.some(t => METRIC_VERB_TOKENS.has(t))) return true;
    return false;
  }

  // Tier-2: slug fallback — apply full noise filter

  const tokens = key.split("_");

  // Fragment guard: no valid financial metric has more than 4 slug tokens
  if (tokens.length > 4) return true;

  // Stop-word-only keys (e.g. "of_the")
  if (tokens.every(t => METRIC_STOP_TOKENS.has(t))) return true;

  // Verb fragment
  if (tokens.some(t => METRIC_VERB_TOKENS.has(t))) return true;

  // Job-title token
  if (tokens.some(t => JOB_TITLE_TOKENS.has(t))) return true;

  // Calendar / day-of-week noise
  if (tokens.some(t => CALENDAR_NOISE_TOKENS.has(t))) return true;

  // Financial signal gate: raw label must contain a recognisable finance word
  if (!FINANCIAL_SIGNAL_KEYWORDS_RE.test(rawLabel)) return true;

  return false;
}

// ─── Source pointer ───────────────────────────────────────────────────────────

function buildSourcePointer(
  sourceRef: string,
  pageNumber: number,
  metricKey: string,
  periodLabel: string,
): string {
  const hash = createHash("sha256")
    .update(`${sourceRef}:${pageNumber}:${metricKey}:${periodLabel}`)
    .digest("hex")
    .slice(0, 8);
  return `pdf_table source=${sourceRef.slice(0, 32)} page=${pageNumber} metric=${metricKey} period=${periodLabel} h=${hash}`;
}
