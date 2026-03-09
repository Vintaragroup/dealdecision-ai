/**
 * temporal-scope.ts
 *
 * Shared temporal classification primitive for the investor-insights pipeline.
 *
 * Previously, temporal scope detection logic was scattered across:
 *   - financial-coverage-profile.ts (looksLikeFutureYear, isForecast)
 *   - extract-numeric-claims.ts (partial "projected" keyword gate)
 *   - deal-fact-v1.ts (timeframe?: string — calendar label only)
 *
 * This module consolidates that logic into a single, reusable utility and
 * defines the canonical TemporalScope type. All pipeline layers should import
 * from here rather than duplicating detection logic.
 *
 * Design rules:
 *   - Pure functions only — no DB, no LLM, no side effects.
 *   - Unknown > invention: return "unknown" rather than guess.
 *   - Scenario is higher priority than projected (scenario implies projected).
 *   - Year inference is always secondary to explicit keyword signals.
 */

// ─── TemporalScope type ───────────────────────────────────────────────────────

export type TemporalScope =
  /** Past period with reported / actual data. */
  | "historical"
  /** Current period — TTM, YTD, run rate, as-of-current-date. */
  | "current"
  /** Forward-looking — forecast / plan / model / guidance. */
  | "projected"
  /** Base / bull / bear scenario analysis (implies forward-looking). */
  | "scenario"
  /** Goal / milestone (not yet a model, not yet historical). */
  | "target"
  /** Cannot determine from available signals. */
  | "unknown";

// ─── Keyword patterns ─────────────────────────────────────────────────────────

/** Words that unambiguously indicate forward-looking data. */
const PROJECTED_KEYWORDS =
  /\b(forecast(?:ed)?|projection|projected|pro\s*forma|proforma|plan(?:ned)?|expected|estimated|outlook|guidance|model(?:ed)?|budget(?:ed)?|implied|forward[-\s]looking)\b/i;

/**
 * Scenario language (treated as a sub-variant of projected but distinct enough
 * to warrant its own scope value for downstream filtering).
 */
const SCENARIO_KEYWORDS =
  /\b(scenario|base\s+case|bull\s+case|bear\s+case|upside(?:\s+case)?|downside(?:\s+case)?|best[-\s]case|worst[-\s]case|sensitivity)\b/i;

/**
 * Goal / target language — aspirational but not modeled.
 * Only matched when no higher-priority keyword fires first.
 */
const TARGET_KEYWORDS =
  /\b(target(?:ed)?|goal|milestone|aspiration|aspiring|aim(?:ing)?|objective)\b/i;

/** Current-period markers — TTM, YTD, run rate, as-of-current-date. */
const CURRENT_KEYWORDS =
  /\b(ttm|ltm|trailing|ytd|run[-\s]rate|current\s+run|as\s+of\s+today|as\s+of\s+now|current(?:ly)?|present)\b/i;

/** Explicit historical / actual markers. */
const HISTORICAL_KEYWORDS =
  /\b(actual|actuals|reported|audited|filed|historical|prior\s+year|last\s+year|year\s+ended|as\s+of\s+\d{4})\b/i;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Classify the temporal scope of a financial value from:
 *   1. An optional explicit `subtype` string (e.g., from an XLSX column header or
 *      a pre-classified extraction label) — highest priority.
 *   2. Context text keywords — checked in priority order: scenario > projected >
 *      target > current > historical.
 *   3. Year-vs-current-year comparison — lowest priority heuristic.
 *
 * @param year         Optional 4-digit year associated with the value.
 * @param contextText  Text snippet surrounding the value (page text, column header, etc.).
 * @param subtype      Optional explicit subtype string (e.g., "forecast", "actual").
 * @param currentYear  Optional override for the reference year (defaults to today).
 */
export function classifyTemporalScope(
  year: number | null,
  contextText: string,
  subtype?: string,
  currentYear?: number,
): TemporalScope {
  const refYear = currentYear ?? new Date().getFullYear();
  const text = contextText ?? "";

  // ── Explicit subtype override ────────────────────────────────────────────
  if (subtype) {
    const s = subtype.toLowerCase().trim();
    if (["forecast", "forecasted", "projected", "projection", "plan", "planned",
         "pro forma", "proforma", "guidance", "budget", "budgeted",
         "estimated", "expected"].includes(s)) return "projected";
    if (["historical", "actual", "actuals", "reported", "audited",
         "filed", "prior"].includes(s)) return "historical";
    if (["scenario", "base case", "bull case", "bear case"].includes(s)) return "scenario";
    if (["ttm", "ltm", "trailing", "ytd", "run rate", "current"].includes(s)) return "current";
    if (["target", "goal", "milestone"].includes(s)) return "target";
  }

  // ── Keyword priority chain (text) ────────────────────────────────────────
  if (SCENARIO_KEYWORDS.test(text)) return "scenario";
  if (PROJECTED_KEYWORDS.test(text)) return "projected";
  if (TARGET_KEYWORDS.test(text)) return "target";
  if (CURRENT_KEYWORDS.test(text)) return "current";
  if (HISTORICAL_KEYWORDS.test(text)) return "historical";

  // ── Year-based heuristic ─────────────────────────────────────────────────
  if (year !== null) {
    if (year > refYear) return "projected";
    if (year === refYear) return "current";
    if (year < refYear) return "historical";
  }

  return "unknown";
}

/**
 * Extract the first 4-digit calendar year embedded in a period label.
 *
 * Handles: "FY2025", "2025", "Q3 2025", "2025-03", "as of Jan 2025", etc.
 * Returns null when no year in range [2000..2100] is found.
 */
export function extractYearFromLabel(label: string): number | null {
  // Use negative digit lookaround so "FY2025", "Q3 2025", "2025-03" all match,
  // while "20250101" (embedded in a longer number) does not.
  const m = /(?<!\d)(20\d{2})(?!\d)/.exec(label);
  if (!m) return null;
  const y = parseInt(m[1]!, 10);
  return y >= 2000 && y <= 2100 ? y : null;
}

/**
 * Returns true when the temporal scope indicates forward-looking / unverified data.
 * Useful as a quick gate before presenting a value as a current company metric.
 *
 * projected | scenario | target → true (not yet realized)
 * historical | current | unknown → false
 */
export function isProjectedScope(scope: TemporalScope): boolean {
  return scope === "projected" || scope === "scenario" || scope === "target";
}

/**
 * Returns a short, human-readable qualifier suffix for a temporal scope.
 * Used when assembling LLM prompt bodies or UI labels.
 *
 * Examples: "(projected)", "(historical)", ""
 */
export function temporalScopeLabel(scope: TemporalScope): string {
  switch (scope) {
    case "historical": return "(historical)";
    case "current":    return "(current)";
    case "projected":  return "(projected)";
    case "scenario":   return "(scenario)";
    case "target":     return "(target)";
    case "unknown":    return "";
  }
}
