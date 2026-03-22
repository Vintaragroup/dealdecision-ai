/**
 * FinancialIntegrityAnalyzerV1
 *
 * Deterministic cross-source integrity analysis for FinancialFactV1 registries.
 *
 * Phase 1 checks:
 *  1. Completeness — critical metrics present/absent from financial_facts_v1
 *  2. Cross-source discrepancy — xlsx vs deck/ocr value divergence
 *  3. Anomaly checks — negative revenue, valuation < raise, burn > cash, etc.
 *
 * Design rules:
 *  - Pure / deterministic: no LLM, no DB calls, no side effects
 *  - Graceful degradation: missing facts → SKIP flags, not errors
 *  - Does not mutate input
 *  - All outputs conform to FinancialIntegrityV1Schema
 */

import { BaseAnalyzer, type AnalyzerMetadata } from "./base.js";
import type { FinancialFactV1, FinancialFactSourceKind } from "../financial-facts/financial-fact-v1.js";
import {
  type FinancialIntegrityV1,
  type IntegrityFlag,
  type IntegrityFlagStatus,
  type IntegrityFlagSeverity,
  type IntegrityFlagSourceRef,
} from "../types/financial-integrity-v1.js";

// ─── Input type ────────────────────────────────────────────────────────────────
// Loosely typed to accept anything from input_data while being safe.

export interface FinancialIntegrityInput {
  /** Pre-loaded FinancialFactV1 rows for this deal (optional — graceful absent). */
  financial_facts?: FinancialFactV1[] | null;
  /** Evidence IDs to propagate into the result for audit trail. */
  evidence_ids?: string[];
}

// ─── Constants ─────────────────────────────────────────────────────────────────

/** Metric keys treated as critical for completeness scoring. */
const CRITICAL_METRICS = [
  "revenue",
  "arr",
  "mrr",
  "burn_rate",
  "cash",
  "runway_months",
  "raise_amount",
  "pre_money_valuation",
] as const;

/** Supplementary metrics — absence reduces score but is not critical. */
const SUPPLEMENTARY_METRICS = [
  "gross_margin",
  "opex",
  "churn_pct",
  "cac",
  "ltv",
  "arpu",
  "net_income",
] as const;

/** Source kinds from workbooks (high-trust). */
const WORKBOOK_SOURCE_KINDS: ReadonlySet<FinancialFactSourceKind> = new Set([
  "xlsx",
  "pdf_table",
]);

/** Source kinds from decks / OCR (lower-trust). */
const DECK_SOURCE_KINDS: ReadonlySet<FinancialFactSourceKind> = new Set([
  "deck",
  "kpi_tile",
  "chart_pixel",
  "pdf_kpi_line",
]);

/**
 * Warn threshold for cross-source divergence (20%).
 * Beyond this we emit WARN; beyond FAIL_DIVERGENCE_THRESHOLD we emit FAIL.
 */
const WARN_DIVERGENCE_THRESHOLD = 0.2;
const FAIL_DIVERGENCE_THRESHOLD = 0.5;

// ─── Helpers ───────────────────────────────────────────────────────────────────

function relativeDivergence(a: number, b: number): number {
  const base = Math.abs(a);
  if (base === 0) return Math.abs(b) > 0 ? 1 : 0;
  return Math.abs(a - b) / base;
}

function makeFlag(
  flag_key: string,
  status: IntegrityFlagStatus,
  severity: IntegrityFlagSeverity,
  note: string,
  extras?: {
    fact_type?: string;
    source_a?: IntegrityFlagSourceRef;
    source_b?: IntegrityFlagSourceRef;
  },
): IntegrityFlag {
  return {
    flag_key,
    status,
    severity,
    note,
    ...(extras?.fact_type !== undefined ? { fact_type: extras.fact_type } : {}),
    ...(extras?.source_a !== undefined ? { source_a: extras.source_a } : {}),
    ...(extras?.source_b !== undefined ? { source_b: extras.source_b } : {}),
  };
}

// ─── Analyzer ─────────────────────────────────────────────────────────────────

export class FinancialIntegrityAnalyzerV1 extends BaseAnalyzer<
  FinancialIntegrityInput,
  FinancialIntegrityV1
> {
  readonly metadata: AnalyzerMetadata = {
    name: "financial_integrity_v1",
    version: "1.0.0",
    released_at: "2026-03-22",
    changelog: "Initial release — completeness, cross-source discrepancy, and anomaly checks",
  };

  async analyze(input: FinancialIntegrityInput): Promise<FinancialIntegrityV1> {
    const computed_at = new Date().toISOString();
    const facts: FinancialFactV1[] = Array.isArray(input.financial_facts)
      ? input.financial_facts.filter(
          (f) => typeof f?.metric_key === "string" && typeof f?.value === "number" && Number.isFinite(f.value),
        )
      : [];

    const flags: IntegrityFlag[] = [];

    // ── 1. Completeness ─────────────────────────────────────────────────────
    const presentKeys = new Set(facts.map((f) => f.metric_key));

    const missing_critical: string[] = [];
    const missing_supplementary: string[] = [];

    for (const key of CRITICAL_METRICS) {
      if (!presentKeys.has(key)) missing_critical.push(key);
    }
    for (const key of SUPPLEMENTARY_METRICS) {
      if (!presentKeys.has(key)) missing_supplementary.push(key);
    }

    // Completeness score: critical metrics are worth 70 pts total, supplementary 30 pts.
    let completeness_score: number | null = null;
    if (facts.length > 0) {
      const criticalPresent = CRITICAL_METRICS.length - missing_critical.length;
      const supplPresent = SUPPLEMENTARY_METRICS.length - missing_supplementary.length;
      const criticalScore = (criticalPresent / CRITICAL_METRICS.length) * 70;
      const supplScore = (supplPresent / SUPPLEMENTARY_METRICS.length) * 30;
      completeness_score = Math.round(criticalScore + supplScore);
    }

    // Emit completeness flag
    if (completeness_score === null) {
      flags.push(
        makeFlag(
          "completeness:no_facts",
          "FAIL",
          "high",
          "No financial facts available. financial_integrity analysis requires financial_facts_v1 data.",
        ),
      );
    } else if (missing_critical.length > 0) {
      const severity: IntegrityFlagSeverity =
        missing_critical.length >= CRITICAL_METRICS.length / 2 ? "high" : "medium";
      flags.push(
        makeFlag(
          "completeness:missing_critical",
          "WARN",
          severity,
          `Missing ${missing_critical.length} critical metric(s): ${missing_critical.join(", ")}.`,
        ),
      );
    } else {
      flags.push(
        makeFlag(
          "completeness:ok",
          "PASS",
          "low",
          "All critical financial metrics are present.",
        ),
      );
    }

    // ── 2. Cross-source discrepancy ─────────────────────────────────────────
    // Group facts by (metric_key, period_label) — look for workbook vs deck conflicts.
    const groups = new Map<string, FinancialFactV1[]>();
    for (const fact of facts) {
      const groupKey = `${fact.metric_key}:${fact.period_label}`;
      const arr = groups.get(groupKey);
      if (arr) arr.push(fact);
      else groups.set(groupKey, [fact]);
    }

    for (const [groupKey, group] of groups) {
      if (group.length < 2) continue;

      const workbookFacts = group.filter((f) => WORKBOOK_SOURCE_KINDS.has(f.source_kind));
      const deckFacts = group.filter((f) => DECK_SOURCE_KINDS.has(f.source_kind));

      if (workbookFacts.length === 0 || deckFacts.length === 0) continue;

      // Representative values: median of each group (or single value)
      const wbValue = medianValue(workbookFacts.map((f) => f.value));
      const deckValue = medianValue(deckFacts.map((f) => f.value));

      const div = relativeDivergence(wbValue, deckValue);

      if (div <= WARN_DIVERGENCE_THRESHOLD) continue;

      const [metric_key, period_label] = groupKey.split(":") as [string, string];
      const flagStatus: IntegrityFlagStatus = div > FAIL_DIVERGENCE_THRESHOLD ? "FAIL" : "WARN";
      const severity: IntegrityFlagSeverity = div > FAIL_DIVERGENCE_THRESHOLD ? "high" : "medium";
      const pct = Math.round(div * 100);

      flags.push(
        makeFlag(
          `cross_source_discrepancy:${metric_key}`,
          flagStatus,
          severity,
          `${metric_key} diverges ${pct}% between workbook (${formatValue(wbValue)}) and deck/OCR (${formatValue(deckValue)}) for period '${period_label}'.`,
          {
            fact_type: metric_key,
            source_a: {
              source_kind: workbookFacts[0]!.source_kind,
              value: wbValue,
              period_label,
            },
            source_b: {
              source_kind: deckFacts[0]!.source_kind,
              value: deckValue,
              period_label,
            },
          },
        ),
      );
    }

    // ── 3. Anomaly checks ───────────────────────────────────────────────────
    const latestFact = (metricKey: string): number | null => {
      const candidates = facts.filter((f) => f.metric_key === metricKey);
      if (candidates.length === 0) return null;
      // Prefer workbook source; fall back to any best-confidence fact.
      const preferred = candidates
        .filter((f) => WORKBOOK_SOURCE_KINDS.has(f.source_kind))
        .sort((a, b) => confidenceRank(b.confidence) - confidenceRank(a.confidence));
      return (preferred[0] ?? candidates[0]!).value;
    };

    const revenue = latestFact("revenue") ?? latestFact("arr") ?? latestFact("mrr");
    const burnRate = latestFact("burn_rate");
    const cash = latestFact("cash");
    const runwayMonths = latestFact("runway_months");
    const raiseAmount = latestFact("raise_amount");
    const preMoney = latestFact("pre_money_valuation");

    // Negative revenue
    if (revenue !== null && revenue < 0) {
      flags.push(
        makeFlag(
          "anomaly:negative_revenue",
          "FAIL",
          "critical",
          `Revenue value is negative (${formatValue(revenue)}). This is likely a data extraction error.`,
          { fact_type: "revenue" },
        ),
      );
    }

    // Valuation < raise amount
    if (preMoney !== null && raiseAmount !== null && preMoney < raiseAmount) {
      flags.push(
        makeFlag(
          "anomaly:valuation_below_raise",
          "FAIL",
          "high",
          `Pre-money valuation (${formatValue(preMoney)}) is less than raise amount (${formatValue(raiseAmount)}). Structural inconsistency detected.`,
          { fact_type: "pre_money_valuation" },
        ),
      );
    }

    // Burn > cash (runway < 1 month)
    if (burnRate !== null && burnRate > 0 && cash !== null && burnRate > cash) {
      flags.push(
        makeFlag(
          "anomaly:burn_exceeds_cash",
          "FAIL",
          "critical",
          `Monthly burn rate (${formatValue(burnRate)}) exceeds cash on hand (${formatValue(cash)}). Company has less than one month of runway.`,
          { fact_type: "burn_rate" },
        ),
      );
    }

    // Short runway (< 3 months) — only when not already in burn_exceeds_cash territory
    if (runwayMonths !== null && runwayMonths < 3 && runwayMonths >= 0) {
      const alreadyFailed = flags.some((f) => f.flag_key === "anomaly:burn_exceeds_cash");
      if (!alreadyFailed) {
        flags.push(
          makeFlag(
            "anomaly:short_runway",
            "WARN",
            "high",
            `Runway is ${runwayMonths.toFixed(1)} months — dangerously short. Immediate fundraising or cost reduction required.`,
            { fact_type: "runway_months" },
          ),
        );
      }
    }

    // Implausible MoM growth (> 10x = 1000%)
    const growthRate = latestFact("growth_rate") ?? latestFact("revenue_growth_rate");
    if (growthRate !== null && growthRate > 1000) {
      flags.push(
        makeFlag(
          "anomaly:implausible_growth",
          "WARN",
          "medium",
          `MoM growth rate of ${growthRate.toFixed(0)}% is implausibly high. Verify extraction source — may be YoY or incorrect units.`,
          { fact_type: "growth_rate" },
        ),
      );
    }

    // ── 4. Period alignment checks ─────────────────────────────────────────────
    // Detect when facts for the same metric arrive with incompatible period
    // granularities (e.g. quarterly burn vs annual cash). Such mismatches would
    // produce misleading cross-source discrepancy signals or incorrect derivations.
    //
    // These checks are purely additive. They do NOT suppress other flags.

    // Group all facts by metric_key (all sources, all periods).
    const byMetric = new Map<string, FinancialFactV1[]>();
    for (const fact of facts) {
      const arr = byMetric.get(fact.metric_key) ?? [];
      arr.push(fact);
      byMetric.set(fact.metric_key, arr);
    }

    // 4a: Per-metric period-type mismatch.
    // Flag when a metric has facts with fundamentally incompatible granularities.
    for (const [metric_key, mFacts] of byMetric) {
      const periodTypes = new Set(
        mFacts.map((f) => f.period_type ?? "unknown").filter((t) => t !== "unknown"),
      );
      if (periodTypes.size < 2) continue; // single type or all unknown → no mismatch possible

      const types = [...periodTypes];
      let worstCompat: "ok" | "warn" | "incompatible" = "ok";
      outer: for (let i = 0; i < types.length - 1; i++) {
        for (let j = i + 1; j < types.length; j++) {
          const compat = periodTypeCompatibility(types[i], types[j]);
          if (compat === "incompatible") {
            worstCompat = "incompatible";
            break outer;
          }
          if (compat === "warn" && worstCompat === "ok") worstCompat = "warn";
        }
      }
      if (worstCompat === "ok") continue;

      const typeList = types.sort().join(", ");
      if (worstCompat === "incompatible") {
        flags.push(
          makeFlag(
            `period_alignment:period_mismatch:${metric_key}`,
            "FAIL",
            "high",
            `${metric_key} has facts with incompatible period granularities (${typeList}). Direct comparison across these periods would produce misleading signals.`,
            { fact_type: metric_key },
          ),
        );
      } else {
        // worstCompat === "warn" — annual + TTM are close but not identical.
        flags.push(
          makeFlag(
            `period_alignment:incompatible_period_comparison:${metric_key}`,
            "WARN",
            "medium",
            `${metric_key} mixes annual and TTM period types (${typeList}). Comparisons may be imprecise due to period boundary differences.`,
            { fact_type: metric_key },
          ),
        );
      }
    }

    // 4b: Ambiguous "current" period alongside explicit period labels.
    // When a metric has facts labeled "current" (no explicit year/quarter) AND facts
    // with explicit period labels, cross-period comparisons cannot be trusted.
    for (const [metric_key, mFacts] of byMetric) {
      const hasCurrentLabel = mFacts.some((f) => f.period_label === "current");
      const hasExplicitLabel = mFacts.some(
        (f) => f.period_label !== "current" && f.period_label !== "unknown",
      );
      if (hasCurrentLabel && hasExplicitLabel) {
        flags.push(
          makeFlag(
            `period_alignment:ambiguous_current_period:${metric_key}`,
            "WARN",
            "low",
            `${metric_key} has facts labeled 'current' alongside facts with explicit period labels. The 'current' reference period is ambiguous — comparison confidence is reduced.`,
            { fact_type: metric_key },
          ),
        );
      }
    }

    // 4c: Derivation period mismatch — cash ÷ burn_rate → runway_months.
    // The derivation is mathematically valid only when cash and burn_rate share
    // the same period granularity. A quarterly burn divided into an annual cash
    // balance produces a runway figure that is off by 3×.
    {
      const cashFacts = (byMetric.get("cash") ?? []).filter((f) => !alertIsProjectedFact(f));
      const burnFacts = (byMetric.get("burn_rate") ?? []).filter((f) => !alertIsProjectedFact(f));
      if (cashFacts.length > 0 && burnFacts.length > 0) {
        const cashTypes = [
          ...new Set(
            cashFacts.map((f) => f.period_type ?? "unknown").filter((t) => t !== "unknown"),
          ),
        ];
        const burnTypes = [
          ...new Set(
            burnFacts.map((f) => f.period_type ?? "unknown").filter((t) => t !== "unknown"),
          ),
        ];
        let hasIncompatibleDerivation = false;
        derivationCheck: for (const ct of cashTypes) {
          for (const bt of burnTypes) {
            if (periodTypeCompatibility(ct, bt) === "incompatible") {
              hasIncompatibleDerivation = true;
              break derivationCheck;
            }
          }
        }
        if (hasIncompatibleDerivation) {
          flags.push(
            makeFlag(
              "period_alignment:derivation_period_mismatch",
              "WARN",
              "high",
              `Runway derivation (cash ÷ burn_rate) involves facts with incompatible period types (cash: ${cashTypes.sort().join(", ")}; burn_rate: ${burnTypes.sort().join(", ")}). Any derived runway_months would be unreliable.`,
              { fact_type: "runway_months" },
            ),
          );
        }
      }
    }

    return {
      computed_at,
      completeness_score,
      missing_critical,
      missing_supplementary,
      flags,
    };
  }
}

// ─── Private utilities ─────────────────────────────────────────────────────────

function medianValue(values: number[]): number {
  if (values.length === 0) return 0;
  if (values.length === 1) return values[0]!;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

function confidenceRank(confidence: string | undefined): number {
  switch (confidence) {
    case "high":
      return 2;
    case "medium":
      return 1;
    default:
      return 0;
  }
}

function formatValue(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `${v}`;
}

/**
 * Returns the compatibility level between two FinancialFactPeriodType strings.
 *
 * "ok"           — same type (or one/both unknown) → period comparison is safe.
 * "warn"         — broadly similar but distinct: annual and TTM overlap but
 *                  TTM may span calendar-year boundaries.
 * "incompatible" — fundamentally different granularities that must not be
 *                  compared or combined directly without unit conversion
 *                  (e.g. quarterly burn ÷ annual cash → wrong runway).
 */
function periodTypeCompatibility(
  a: string | undefined,
  b: string | undefined,
): "ok" | "warn" | "incompatible" {
  const ta = a ?? "unknown";
  const tb = b ?? "unknown";
  if (ta === "unknown" || tb === "unknown") return "ok";
  if (ta === tb) return "ok";
  const key = [ta, tb].sort().join(":");
  // Fundamentally incompatible — mixing these without explicit conversion is wrong.
  if (
    key === "annual:quarterly" ||
    key === "annual:monthly" ||
    key === "monthly:quarterly" ||
    key === "monthly:ttm" ||
    key === "quarterly:ttm"
  ) {
    return "incompatible";
  }
  // Warn — annual and TTM are the same granularity family but TTM can span
  // boundaries differently (e.g. TTM ending March ≠ FY2024 ending December).
  if (key === "annual:ttm") return "warn";
  return "ok";
}

/**
 * Returns true when a fact is projected / scenario / target.
 * Mirrors the same guard logic in reconcile-financial-facts-v1.ts.
 * Kept in sync manually — both copies must agree.
 */
function alertIsProjectedFact(f: FinancialFactV1): boolean {
  const scope = f.temporal_scope ?? "unknown";
  return scope === "projected" || scope === "scenario" || scope === "target";
}
