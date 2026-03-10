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
import { normalizeMetricKey } from "./financial-metric-aliases";

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

      const { rawLabel, value, unit, period_label, confidence, excerpt } =
        extracted;

      const metric_key = normalizeMetricKey(rawLabel);
      // Skip extremely generic/unknown labels that produce no signal
      if (shouldSkipMetricKey(metric_key, rawLabel)) continue;

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
  period_label: string;
  confidence: "high" | "medium" | "low";
  excerpt?: string;
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
  const rawLabel = parts[0];
  if (!rawLabel || rawLabel.length < 2) return null;
  if (isNumericToken(rawLabel)) return null;

  // Find a numeric value in remaining parts
  for (let i = 1; i < parts.length; i++) {
    const parsed = parseNumericToken(parts[i]);
    if (parsed === null) continue;

    // Look for an adjacent period label
    const period_label = findPeriodLabel(parts, i);

    return {
      rawLabel,
      value: parsed.value,
      unit: parsed.unit,
      period_label: period_label ?? "current",
      confidence,
      excerpt: parts.join(" | "),
    };
  }

  return null;
}

/** Try to extract a financial claim from an inline sentence-like line */
function tryInlineExtract(
  line: string,
  headerPeriods: string[],
): ExtractedLineClaim | null {
  // Pattern: "Revenue $1.2M" or "ARR: $2.5M in FY2024"
  const match = line.match(
    /\b([A-Za-z][\w\s%-]{2,50}?)\s+(?:of\s+|:\s*)?(\$[\d,.]+[KkMmBbTt]?|\d[\d,.]+\s*[KkMmBbTt]?%?)/
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
 * Handles: FY2024, FY2025, Q1 2024, Q3-2024, 2024, 2024-03, TTM, LTM
 */
export function extractPeriodFromText(text: string): string | null {
  const s = text.trim();

  // TTM / LTM
  if (/^(ttm|ltm)$/i.test(s)) return s.toUpperCase();

  // "FY2024" or "FY 2024"
  const fyMatch = s.match(/\bFY\s*(\d{4})\b/i);
  if (fyMatch) return `FY${fyMatch[1]}`;

  // "Q2 2024" or "Q2-2024" or "2024 Q2"
  const qMatch = s.match(/\bQ([1-4])[\s\-_](\d{4})\b|\b(\d{4})[\s\-_]Q([1-4])\b/i);
  if (qMatch) {
    const q = qMatch[1] ?? qMatch[4];
    const year = qMatch[2] ?? qMatch[3];
    return `Q${q} ${year}`;
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
    // Look for FY patterns or Q patterns
    const matches = line.match(
      /\b(?:FY\s*\d{4}|Q[1-4]\s+\d{4}|\d{4}|TTM|LTM)\b/gi
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

/** Skip slug-like metric keys that look like noise (single letter etc.) */
// Stop words that alone cannot form a valid metric key
const METRIC_STOP_TOKENS = new Set(["of", "the", "a", "an", "and", "but", "or"]);
// Common verbs that indicate a sentence fragment rather than a metric label
const METRIC_VERB_TOKENS = new Set(["will", "has", "have", "had", "exceed", "exceeds", "exceeded", "expects", "projected"]);

function shouldSkipMetricKey(key: string, rawLabel: string): boolean {
  if (key.length < 2) return true;
  if (/^\d/.test(key)) return true;
  // Skip if raw label was entirely numeric or short noise
  if (rawLabel.trim().length < 2) return true;
  // Reject sentence fragments: no valid financial metric has more than 5 tokens
  const tokens = key.split("_");
  if (tokens.length > 5) return true;
  // Reject keys composed entirely of stop words (e.g. "of_the")
  if (tokens.every(t => METRIC_STOP_TOKENS.has(t))) return true;
  // Reject keys containing verb tokens — clear indicators of sentence fragments
  if (tokens.some(t => METRIC_VERB_TOKENS.has(t))) return true;
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
