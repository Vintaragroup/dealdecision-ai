import type { ExtractedMetric, MetricUnit } from "./types";

const CONTEXT_WINDOW_CHARS = 60;

const CURRENCY_DOLLAR_RE = /\$\s?\d[\d,]*(?:\.\d+)?\s?(k|m|mm|b)?/gi;
const CURRENCY_USD_RE = /\bUSD\s?\d[\d,]*(?:\.\d+)?\s?(k|m|mm|b)?\b/gi;
const PERCENT_RE = /\b\d+(?:\.\d+)?%/g;
const YEAR_RE = /\b(?:19|20)\d{2}\b/g;
const MONTHS_RE = /\b\d+(?:\.\d+)?\s*(?:months?|mos?)\b/gi;

type MetricCandidate = {
  raw_value: string;
  unit: MetricUnit;
  value_normalized: number | string;
  metric_type: string;
  context: string;
  confidence: number;
};

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function getContext(text: string, start: number, end: number): string {
  const a = Math.max(0, start - CONTEXT_WINDOW_CHARS);
  const b = Math.min(text.length, end + CONTEXT_WINDOW_CHARS);
  return text
    .slice(a, b)
    .replace(/\s+/g, " ")
    .trim();
}

function looksGarbled(text: string): boolean {
  if (!text) return false;
  const replacementLike = (text.match(/[\uFFFD\u25A1]/g) ?? []).length;
  if (replacementLike >= 2) return true;

  // Simple deterministic heuristic: if too many characters are outside a safe set.
  const total = text.length;
  let weird = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (!/[A-Za-z0-9\s\.,;:$%()\[\]{}\-+\/=]/.test(ch)) {
      weird++;
    }
  }
  const ratio = total === 0 ? 0 : weird / total;
  return ratio > 0.25;
}

function parseCurrencyValue(raw: string): number | null {
  const trimmed = raw.trim();
  const cleaned = trimmed
    .replace(/^USD\s*/i, "")
    .replace(/^\$\s?/, "")
    .trim();

  const match = cleaned.match(/^([\d,]+(?:\.\d+)?)(?:\s*(k|m|mm|b))?$/i);
  if (!match) return null;

  const numericPart = match[1].replace(/,/g, "");
  const suffix = (match[2] ?? "").toLowerCase();
  const base = Number.parseFloat(numericPart);
  if (!Number.isFinite(base)) return null;

  const multiplier =
    suffix === "k"
      ? 1e3
      : suffix === "m" || suffix === "mm"
        ? 1e6
        : suffix === "b"
          ? 1e9
          : 1;

  return base * multiplier;
}

function parsePercentValue(raw: string): number | null {
  const t = raw.trim();
  if (!t.endsWith("%")) return null;
  const n = Number.parseFloat(t.slice(0, -1));
  return Number.isFinite(n) ? n : null;
}

function parseMonthsValue(raw: string): number | null {
  const t = raw.trim().toLowerCase();
  const m = t.match(/^(\d+(?:\.\d+)?)\s*(months?|mos?)$/);
  if (!m) return null;
  const n = Number.parseFloat(m[1]);
  return Number.isFinite(n) ? n : null;
}

function inferMetricType(unit: MetricUnit, contextLower: string): string {
  // Requirement: infer from nearby keyword context; else unknown_metric.
  if (unit === "USD") {
    // Financials / traction
    if (/\brevenue\b|\bsales\b|\barr\b|\bmrr\b|\bbookings\b/.test(contextLower)) return "revenue_usd";

    // Terms
    if (/\bvaluation\b|\bpre-money\b|\bpost-money\b|\bpre money\b|\bpost money\b/.test(contextLower)) return "valuation_usd";

    // Market sizing (keep conservative)
    if (/\btam\b|\btotal addressable market\b|\bmarket size\b/.test(contextLower)) return "tam_usd";
    if (/\bsam\b|\bserviceable available market\b/.test(contextLower)) return "sam_usd";
    if (/\bsom\b|\bserviceable obtainable market\b/.test(contextLower)) return "som_usd";

    // Other (still conservative)
    if (/\bburn rate\b|\bburn\b/.test(contextLower)) return "burn_usd";
    if (/\bcash\b/.test(contextLower)) return "cash_usd";
    return "unknown_metric";
  }

  if (unit === "PERCENT") {
    // Financials
    if (/\bgross margin\b/.test(contextLower) || (/\bgross\b/.test(contextLower) && /\bmargin\b/.test(contextLower))) {
      return "gross_margin_percent";
    }
    if (/\bnet margin\b/.test(contextLower)) return "net_margin_percent";
    if (/\bebitda margin\b/.test(contextLower)) return "ebitda_margin_percent";

    // Traction
    if (/\bchurn\b/.test(contextLower)) return "churn_rate_percent";
    if (/\bretention\b/.test(contextLower)) return "retention_rate_percent";
    if (/\bconversion\b/.test(contextLower)) return "conversion_rate_percent";
    if (/\bctr\b|\bclick[- ]through\b/.test(contextLower)) return "ctr_percent";

    // Product
    if (/\buptime\b|\bavailability\b/.test(contextLower)) return "uptime_percent";
    if (/\baccuracy\b/.test(contextLower)) return "accuracy_percent";

    // Terms
    if (/\boption pool\b/.test(contextLower)) return "option_pool_percent";

    // Market / growth (only when explicit)
    if (/\bgrowth\b/.test(contextLower)) return "growth_rate_percent";
    return "unknown_metric";
  }

  if (unit === "YEARS") {
    // Default: calendar year. Keep conservative; do not guess without strong context.
    if (/\bfounded\b|\bsince\b/.test(contextLower)) return "founded_year";
    if (/\bfy\b|\bfiscal\b/.test(contextLower)) return "fiscal_year";
    return "year";
  }

  if (unit === "MONTHS") {
    if (/\brunway\b/.test(contextLower)) return "runway_months";
    if (/\bsales cycle\b/.test(contextLower)) return "sales_cycle_months";
    if (/\bpayback\b/.test(contextLower)) return "payback_months";
    if (/\bcontract term\b|\bterm length\b/.test(contextLower)) return "contract_term_months";
    return "unknown_metric";
  }

  return "unknown_metric";
}

function computeConfidence(unit: MetricUnit, metric_type: string, context: string): number {
  let confidence = 0.6;
  const lower = context.toLowerCase();

  // +0.15 if keyword context matches (e.g. "Revenue" near currency)
  if (unit === "USD") {
    if (/\brevenue\b|\bsales\b|\barr\b|\bmrr\b|\bbookings\b/.test(lower)) {
      confidence += 0.15;
    }
  } else if (unit === "PERCENT") {
    if (/\bmargin\b|\bgross\b|\bchurn\b|\bretention\b/.test(lower)) {
      confidence += 0.15;
    }
  } else if (unit === "MONTHS") {
    if (/\brunway\b|\bmonths?\b|\bmos?\b/.test(lower)) {
      confidence += 0.15;
    }
  } else if (unit === "YEARS") {
    // No additional keyword bump for years.
  }

  // Requirement: deterministic +0.10 bump when we can type the metric conservatively.
  if (metric_type !== "unknown_metric") {
    if (unit === "PERCENT") confidence += 0.1;
    if (unit === "USD") confidence += 0.1;
  }

  // +0.10 if a year also appears in the snippet
  YEAR_RE.lastIndex = 0;
  if (YEAR_RE.test(context)) {
    confidence += 0.1;
  }

  // -0.20 if garbled OCR
  if (looksGarbled(context)) {
    confidence -= 0.2;
  }

  return clamp01(confidence);
}

function addCandidate(
  out: MetricCandidate[],
  normalized_text: string,
  start: number,
  end: number,
  raw_value: string,
  unit: MetricUnit,
  value_normalized: number | string,
): void {
  const context = getContext(normalized_text, start, end);
  const lower = context.toLowerCase();
  const metric_type = inferMetricType(unit, lower);
  const confidence = computeConfidence(unit, metric_type, context);
  out.push({ metric_type, value_normalized, raw_value, unit, context, confidence });
}

export function extractMetrics(normalized_text: string): ExtractedMetric[] {
  if (!normalized_text) return [];

  const candidates: MetricCandidate[] = [];

  for (const match of normalized_text.matchAll(CURRENCY_DOLLAR_RE)) {
    const raw_value = match[0];
    const start = match.index ?? 0;
    const end = start + raw_value.length;
    const value = parseCurrencyValue(raw_value);
    if (value !== null) {
      addCandidate(candidates, normalized_text, start, end, raw_value, "USD", value);
    }
  }

  for (const match of normalized_text.matchAll(CURRENCY_USD_RE)) {
    const raw_value = match[0];
    const start = match.index ?? 0;
    const end = start + raw_value.length;
    const value = parseCurrencyValue(raw_value);
    if (value !== null) {
      addCandidate(candidates, normalized_text, start, end, raw_value, "USD", value);
    }
  }

  for (const match of normalized_text.matchAll(PERCENT_RE)) {
    const raw_value = match[0];
    const start = match.index ?? 0;
    const end = start + raw_value.length;
    const value = parsePercentValue(raw_value);
    if (value !== null) {
      addCandidate(candidates, normalized_text, start, end, raw_value, "PERCENT", value);
    }
  }

  for (const match of normalized_text.matchAll(YEAR_RE)) {
    const raw_value = match[0];
    const start = match.index ?? 0;
    const end = start + raw_value.length;
    const year = Number.parseInt(raw_value, 10);
    if (Number.isFinite(year)) {
      addCandidate(candidates, normalized_text, start, end, raw_value, "YEARS", year);
    }
  }

  for (const match of normalized_text.matchAll(MONTHS_RE)) {
    const raw_value = match[0];
    const start = match.index ?? 0;
    const end = start + raw_value.length;
    const months = parseMonthsValue(raw_value);
    if (months !== null) {
      addCandidate(candidates, normalized_text, start, end, raw_value, "MONTHS", months);
    }
  }

  // Dedupe identical (metric_type + unit + raw_value + context) tuples.
  const seen = new Set<string>();
  const deduped: ExtractedMetric[] = [];
  for (const c of candidates) {
    const key = `${c.metric_type}@@${c.unit}@@${c.raw_value}@@${c.context}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(c);
  }

  // Stable ordering.
  deduped.sort((a, b) => {
    const mt = a.metric_type.localeCompare(b.metric_type);
    if (mt !== 0) return mt;
    const u = a.unit.localeCompare(b.unit);
    if (u !== 0) return u;
    const va = String(a.value_normalized);
    const vb = String(b.value_normalized);
    const vv = va.localeCompare(vb);
    if (vv !== 0) return vv;
    const rv = a.raw_value.localeCompare(b.raw_value);
    if (rv !== 0) return rv;
    return a.context.localeCompare(b.context);
  });

  return deduped;
}
