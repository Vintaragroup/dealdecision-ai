/**
 * extraction/xlsx/period-parser.ts
 *
 * Pure-function period label normalizer for XLSX column headers.
 *
 * Converts raw period header strings (e.g. "1Q24", "FY25 Q1", "Quarter 3 2026E",
 * "TTM", "Trailing Twelve Months") into a structured `PeriodInfo` object suitable
 * for:
 *   - temporal scope classification (scope_context → classifyTemporalScope)
 *   - period_type population in FinancialFactV1
 *   - normalized canonical display labels (avoids ambiguity from raw forms)
 *
 * Design rules:
 *   - Pure functions only — no DB, no LLM, no side effects.
 *   - Patterns are tested largest-granularity-first (quarterly before annual)
 *     to prevent partial matches.
 *   - Returns period_type="unknown" when no pattern matches; never throws.
 *   - Short-form 2-digit years (e.g. "24") are expanded assuming 2000–2049 range.
 */

import type { FinancialFactPeriodType } from "@dealdecision/core";

// ─── Public types ─────────────────────────────────────────────────────────────

export interface PeriodInfo {
  /**
   * Canonical normalized label.
   * e.g. "Q1 2024", "TTM", "FY2024", "2024", "2024-03".
   * Falls back to the raw input when no pattern matched.
   */
  normalized: string;

  /** Inferred period granularity. */
  period_type: FinancialFactPeriodType;

  /**
   * Full 4-digit calendar year, when determinable.
   * null for TTM/LTM and "unknown" periods that contain no year.
   */
  year: number | null;

  /** Quarter number 1–4 for quarterly periods; null otherwise. */
  quarter: number | null;

  /**
   * True when the label includes a projected signal:
   * trailing "E" or "F" suffix, or "Forecast" / "Est" text.
   * Used to build scope_context so classifyTemporalScope() returns "projected".
   */
  is_projected: boolean;

  /**
   * Text fragment suitable for `contextText` in classifyTemporalScope().
   *
   * - Projected periods: "projected forecast {year}"
   * - TTM/LTM: "ttm trailing"
   * - Historical/current: "" (classifyTemporalScope falls back to year comparison)
   * - Unknown: ""
   */
  scope_context: string;
}

// ─── Fallback singleton ───────────────────────────────────────────────────────

const UNKNOWN_PERIOD: Readonly<PeriodInfo> = {
  normalized: "",
  period_type: "unknown",
  year: null,
  quarter: null,
  is_projected: false,
  scope_context: "",
};

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Expand a 2-digit fiscal year shorthand to a 4-digit calendar year.
 * Assumes 00..49 → 2000..2049;  50..99 → 1950..1999.
 */
function expand2DigitYear(yy: number): number {
  return yy < 50 ? 2000 + yy : 1900 + yy;
}

function buildQuarterlyInfo(quarter: number, year: number, isProjected: boolean): PeriodInfo {
  return {
    normalized: `Q${quarter} ${year}`,
    period_type: "quarterly",
    year,
    quarter,
    is_projected: isProjected,
    scope_context: isProjected ? `projected forecast ${year}` : "",
  };
}

function buildAnnualInfo(normalized: string, year: number, isProjected: boolean): PeriodInfo {
  return {
    normalized,
    period_type: "annual",
    year,
    quarter: null,
    is_projected: isProjected,
    scope_context: isProjected ? `projected forecast ${year}` : "",
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Parse a raw XLSX column header string into structured period metadata.
 *
 * Recognized formats (patterns tested in this order):
 *
 *   Quarterly:
 *     "Q1 2024", "Q2 2025E", "Q3-2024", "Q1_2024F"  →  quarterly
 *     "2024-Q1", "2024/Q2", "2025-Q3E"               →  quarterly
 *     "1Q24", "2Q25E"    (short-form 2-digit year)    →  quarterly
 *     "FY25 Q1", "FY2025-Q3", "FY25Q1E"              →  quarterly
 *     "Quarter 1 2024", "Quarter 3 2026E"             →  quarterly
 *
 *   TTM/LTM:
 *     "TTM", "LTM", "T12M"                           →  ttm
 *     "Trailing Twelve Months"                         →  ttm
 *     "Last Twelve Months"                             →  ttm
 *     "Trailing 12 Months"                             →  ttm
 *
 *   Annual:
 *     "2024", "2025E", "2024F"                        →  annual
 *     "FY2024", "FY2025E"   (4-digit FY)              →  annual
 *     "FY24", "FY25E"       (2-digit short-form FY)   →  annual
 *
 *   Monthly:
 *     "2024-03", "2025-01"                            →  monthly
 *
 *   Unknown:
 *     anything else — returns period_type="unknown", normalized=raw input
 *
 * @param raw  Raw column header string. Leading/trailing whitespace is trimmed.
 */
export function parsePeriodLabel(raw: string): PeriodInfo {
  const s = raw.trim();
  if (!s) return { ...UNKNOWN_PERIOD };

  // ── 1. "Q1 2024", "Q2 2025E", "Q3-2024", "Q1_2024F" ─────────────────────
  {
    const m = /^Q([1-4])[\s\-_](\d{4})([EeFf])?$/i.exec(s);
    if (m) {
      return buildQuarterlyInfo(Number(m[1]), Number(m[2]), Boolean(m[3]));
    }
  }

  // ── 2. "2024-Q1", "2024/Q2", "2025-Q3E" ──────────────────────────────────
  {
    const m = /^(\d{4})[\s\-\/]Q([1-4])([EeFf])?$/i.exec(s);
    if (m) {
      return buildQuarterlyInfo(Number(m[2]), Number(m[1]), Boolean(m[3]));
    }
  }

  // ── 3. "1Q24", "2Q25E" (quarter-leading short form with 2-digit year) ────
  {
    const m = /^([1-4])Q(\d{2})([EeFf])?$/i.exec(s);
    if (m) {
      return buildQuarterlyInfo(Number(m[1]), expand2DigitYear(Number(m[2])), Boolean(m[3]));
    }
  }

  // ── 4. "FY25 Q1", "FY2025-Q3", "FY25Q1E" ─────────────────────────────────
  {
    const m = /^FY(\d{2}|\d{4})[\s\-_]?Q([1-4])([EeFf])?$/i.exec(s);
    if (m) {
      const yr = m[1]!.length === 2 ? expand2DigitYear(Number(m[1])) : Number(m[1]);
      return buildQuarterlyInfo(Number(m[2]), yr, Boolean(m[3]));
    }
  }

  // ── 5. "Quarter 1 2024", "Quarter 3 2026E" ────────────────────────────────
  {
    const m = /^Quarter\s+([1-4])\s+(\d{4})([EeFf])?$/i.exec(s);
    if (m) {
      return buildQuarterlyInfo(Number(m[1]), Number(m[2]), Boolean(m[3]));
    }
  }

  // ── 6. TTM / LTM abbreviations ────────────────────────────────────────────
  if (/^(ttm|ltm|t12m)$/i.test(s)) {
    return {
      normalized: "TTM",
      period_type: "ttm",
      year: null,
      quarter: null,
      is_projected: false,
      scope_context: "ttm trailing",
    };
  }

  // ── 7. "Trailing Twelve Months", "Last Twelve Months", "Trailing 12 Months"
  if (/^(trailing\s+(twelve|12)\s+months?|last\s+(twelve|12)\s+months?)$/i.test(s)) {
    return {
      normalized: "TTM",
      period_type: "ttm",
      year: null,
      quarter: null,
      is_projected: false,
      scope_context: "ttm trailing",
    };
  }

  // ── 8. "FY2024", "FY2025E" (4-digit FY) ──────────────────────────────────
  {
    const m = /^FY(\d{4})([EeFf])?$/i.exec(s);
    if (m) {
      const year = Number(m[1]);
      if (year >= 2000 && year <= 2100) {
        return buildAnnualInfo(s, year, Boolean(m[2]));
      }
    }
  }

  // ── 9. "FY24", "FY25E" (2-digit short-form FY) ───────────────────────────
  {
    const m = /^FY(\d{2})([EeFf])?$/i.exec(s);
    if (m) {
      const year = expand2DigitYear(Number(m[1]));
      return buildAnnualInfo(s, year, Boolean(m[2]));
    }
  }

  // ── 10. "2024", "2025E", "2024F" ─────────────────────────────────────────
  {
    const m = /^(\d{4})([EeFf])?$/.exec(s);
    if (m) {
      const year = Number(m[1]);
      if (year >= 2000 && year <= 2100) {
        return buildAnnualInfo(m[1]!, year, Boolean(m[2]));
      }
    }
  }

  // ── 11. "2024-03" (monthly) ───────────────────────────────────────────────
  {
    const m = /^(\d{4})-(\d{2})$/.exec(s);
    if (m) {
      const year = Number(m[1]);
      if (year >= 2000 && year <= 2100) {
        return {
          normalized: s,
          period_type: "monthly",
          year,
          quarter: null,
          is_projected: false,
          scope_context: "",
        };
      }
    }
  }

  // ── Fallback ──────────────────────────────────────────────────────────────
  return { ...UNKNOWN_PERIOD, normalized: s };
}
