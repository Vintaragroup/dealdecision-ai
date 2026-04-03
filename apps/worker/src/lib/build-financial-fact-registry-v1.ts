/**
 * build-financial-fact-registry-v1.ts
 *
 * Derives a flat array of FinancialFactV1 rows from structured orchestrator
 * inputs. No DB calls, no LLM calls — pure deterministic transformation.
 *
 * Strategy (per the Financial Fact Registry v1 spec):
 *   1. Income statement series (revenue, gross_profit, total_expenses, net_income)
 *   2. SAAS KPI series (mrr, arr, cac, ltv, arpu, churn_pct, retention_pct)
 *   3. Balance sheet (cash, debt per period)
 *   4. Cash flow derived (burn_rate, runway_months → "current")
 *   5. FinancialBenchmark[] from orchestrator segments.financial (medium confidence)
 *   6. Deck financial signals (low confidence, skipped if XLSX data present)
 *   7. Workbook intelligence facts (Phase 2 XLSX modules) — with projection safety
 *   8. Cross-source reconciliation (Phase 3) — annotate cross_source_status on every fact
 *
 * Confidence assignment:
 *   - "high"   — XLSX series with reconciliation confidence ≥ 0.7
 *   - "medium" — XLSX series without reconciliation, or derived benchmarks
 *   - "low"    — deck signals, or single-value implied estimates
 */

import type { FinancialFactV1, FinancialFactPeriodType } from "@dealdecision/core";
import {
  computeFactId,
  inferPeriodType,
  isFiniteFactValue,
  capFactExcerpt,
} from "@dealdecision/core";
import type { FinancialStatementV1 } from "./financial-statement-parser.js";
import type { SaasKpisV1 } from "./saas-kpis-parser-v1.js";
import type { BalanceSheetV1 } from "./balance-sheet-parser-v1.js";
import type { CashFlowStatementV1 } from "./cash-flow-parser-v1.js";
import type { FinancialBenchmark } from "@dealdecision/core";
import type { DeckFinancialSignalsV1, DeckFinancialMention } from "./deck-financial-signals-v1.js";
import type { FinancialReconciliationV1 } from "./financial-reconciliation-v1.js";
import { reconcileFinancialFacts } from "./cross-source-reconciliation.js";
import { reconcileFinancialFactsV1 } from "./financial-facts/reconcile-financial-facts-v1.js";

// ─── Inputs ───────────────────────────────────────────────────────────────────

export interface FinancialFactRegistryInputsV1 {
  dealId: string;

  /** Best income statement parsed from XLSX/PDF. */
  financialStatement?: FinancialStatementV1 | null;

  /** Best SAAS KPIs parsed from XLSX/PDF. */
  saasKpis?: SaasKpisV1 | null;

  /** Best balance sheet parsed from XLSX/PDF. */
  balanceSheet?: BalanceSheetV1 | null;

  /** Best cash flow statement parsed from XLSX/PDF. */
  cashFlow?: CashFlowStatementV1 | null;

  /** Reconciliation output — used to set confidence on income statement facts. */
  reconciliation?: FinancialReconciliationV1 | null;

  /** FinancialBenchmark[] from OrchestratorReportV1.segments.financial.benchmarks */
  orchestratorBenchmarks?: FinancialBenchmark[];

  /** Deck financial signals — used as low-confidence fallback. */
  deckSignals?: DeckFinancialSignalsV1 | null;

  /**
   * Workbook-intelligence facts from Phase 2 XLSX modules
   * (table-detector → financial-model-interpreter → metric-promoter).
   *
   * Merged AFTER all structured parser series.  Projected / scenario workbook
   * facts are silently dropped when a historical or current fact for the same
   * metric_key + period_label already exists in the registry (projection safety).
   */
  workbookFacts?: FinancialFactV1[];
}

// ─── Builder ──────────────────────────────────────────────────────────────────

/**
 * Build a flat FinancialFactV1[] from structured orchestrator inputs.
 * Returns deduplicated facts (by fact_id). Later calls override earlier ones
 * within the same batch, so call order = increasing quality.
 */
export function buildFinancialFactRegistryV1(
  inputs: FinancialFactRegistryInputsV1
): FinancialFactV1[] {
  const { dealId } = inputs;
  const map = new Map<string, FinancialFactV1>();
  const push = (f: FinancialFactV1) => map.set(f.fact_id, f);

  // ── 1. Income statement series ─────────────────────────────────────────────
  if (inputs.financialStatement) {
    const fs = inputs.financialStatement;
    const reconScore = inputs.reconciliation?.confidence_score ?? null;
    const baseConf: FinancialFactV1["confidence"] =
      reconScore !== null && reconScore >= 0.7 ? "high" : "medium";
    const reconStatus: FinancialFactV1["reconciliation_status"] =
      reconScore !== null ? (reconScore >= 0.5 ? "ok" : "conflict") : "unknown";

    const incomeSeriesMap: Array<{
      key: string;
      label: string;
      series: Record<string, number> | undefined;
      unit: FinancialFactV1["unit"];
    }> = [
      { key: "revenue",          label: "Revenue",          series: fs.revenue,          unit: "currency" },
      { key: "gross_profit",     label: "Gross Profit",     series: fs.gross_profit,     unit: "currency" },
      { key: "total_expenses",   label: "Total Expenses",   series: fs.total_expenses,   unit: "currency" },
      { key: "net_income",       label: "Net Income",       series: fs.net_income,       unit: "currency" },
    ];

    for (const { key, label, series, unit } of incomeSeriesMap) {
      if (!series) continue;
      for (const [periodLabel, rawValue] of Object.entries(series)) {
        if (!isFiniteFactValue(rawValue)) continue;
        const period_type = inferPeriodType(periodLabel);
        const source_pointer = `sheet=Income row_key=${key} period=${periodLabel}`;
        push({
          fact_id: computeFactId({
            deal_id: dealId,
            metric_key: key,
            period_type,
            period_label: periodLabel,
            source_pointer,
            document_id: fs.source.document_id,
          }),
          deal_id: dealId,
          document_id: fs.source.document_id,
          source_kind: "xlsx",
          metric_key: key,
          metric_label: label,
          period_type,
          period_label: periodLabel,
          value: rawValue,
          unit,
          currency: unit === "currency" ? "USD" : undefined,
          confidence: baseConf,
          reconciliation_status: reconStatus,
          source_pointer,
          excerpt: capFactExcerpt(`${label} ${periodLabel}: ${rawValue}`),
        });
      }
    }

    // Derived gross_margin (% per period) from series
    if (fs.revenue && fs.gross_profit) {
      for (const periodLabel of Object.keys(fs.revenue)) {
        const rev = fs.revenue[periodLabel];
        const gp = fs.gross_profit[periodLabel];
        if (!isFiniteFactValue(rev) || !isFiniteFactValue(gp) || rev === 0) continue;
        const gmPct = Number(((gp / rev) * 100).toFixed(1));
        const period_type = inferPeriodType(periodLabel);
        const source_pointer = `derived=gross_margin period=${periodLabel}`;
        push({
          fact_id: computeFactId({
            deal_id: dealId,
            metric_key: "gross_margin",
            period_type,
            period_label: periodLabel,
            source_pointer,
            document_id: fs.source.document_id,
          }),
          deal_id: dealId,
          document_id: fs.source.document_id,
          source_kind: "xlsx",
          metric_key: "gross_margin",
          metric_label: "Gross Margin",
          period_type,
          period_label: periodLabel,
          value: gmPct,
          unit: "percent",
          confidence: baseConf,
          reconciliation_status: reconStatus,
          source_pointer,
          excerpt: capFactExcerpt(`Gross Margin ${periodLabel}: ${gmPct}%`),
        });
      }
    }
  }

  // ── 2. SAAS KPI series ─────────────────────────────────────────────────────
  if (inputs.saasKpis) {
    const kpis = inputs.saasKpis;
    const kpiSeriesMap: Array<{
      key: string;
      label: string;
      series: Record<string, number> | undefined;
      unit: FinancialFactV1["unit"];
    }> = [
      { key: "mrr",             label: "MRR",                   series: kpis.mrr,           unit: "currency"  },
      { key: "arr",             label: "ARR",                   series: kpis.arr,           unit: "currency"  },
      { key: "cac",             label: "CAC",                   series: kpis.cac,           unit: "currency"  },
      { key: "ltv",             label: "LTV",                   series: kpis.ltv,           unit: "currency"  },
      { key: "arpu",            label: "ARPU",                  series: kpis.arpu,          unit: "currency"  },
      { key: "churn_pct",       label: "Churn Rate",            series: kpis.churn_pct,     unit: "percent"   },
      { key: "retention_pct",   label: "Retention Rate",        series: kpis.retention_pct, unit: "percent"   },
    ];

    for (const { key, label, series, unit } of kpiSeriesMap) {
      if (!series) continue;
      for (const [periodLabel, rawValue] of Object.entries(series)) {
        if (!isFiniteFactValue(rawValue)) continue;
        const period_type = inferPeriodType(periodLabel);
        const source_pointer = `sheet=KPIs row_key=${key} period=${periodLabel}`;
        const document_id = kpis.source.document_id;
        push({
          fact_id: computeFactId({
            deal_id: dealId,
            metric_key: key,
            period_type,
            period_label: periodLabel,
            source_pointer,
            document_id,
          }),
          deal_id: dealId,
          document_id,
          source_kind: "xlsx",
          metric_key: key,
          metric_label: label,
          period_type,
          period_label: periodLabel,
          value: rawValue,
          unit,
          currency: unit === "currency" ? "USD" : undefined,
          confidence: "medium",
          source_pointer,
          excerpt: capFactExcerpt(`${label} ${periodLabel}: ${rawValue}`),
        });
      }
    }
  }

  // ── 3. Balance sheet (cash + debt per period) ──────────────────────────────
  if (inputs.balanceSheet) {
    const bs = inputs.balanceSheet;
    const bsSeriesMap: Array<{
      key: string;
      label: string;
      series: Record<string, number> | undefined;
    }> = [
      { key: "cash",             label: "Cash & Equivalents", series: bs.cash },
      { key: "debt_outstanding", label: "Debt Outstanding",   series: bs.debt_outstanding },
      { key: "total_equity",     label: "Total Equity",       series: bs.total_equity },
    ];

    for (const { key, label, series } of bsSeriesMap) {
      if (!series) continue;
      for (const [periodLabel, rawValue] of Object.entries(series)) {
        if (!isFiniteFactValue(rawValue)) continue;
        const period_type = inferPeriodType(periodLabel);
        const source_pointer = `sheet=BalanceSheet row_key=${key} period=${periodLabel}`;
        const document_id = bs.source.document_id;
        push({
          fact_id: computeFactId({
            deal_id: dealId,
            metric_key: key,
            period_type,
            period_label: periodLabel,
            source_pointer,
            document_id,
          }),
          deal_id: dealId,
          document_id,
          source_kind: "xlsx",
          metric_key: key,
          metric_label: label,
          period_type,
          period_label: periodLabel,
          value: rawValue,
          unit: "currency",
          currency: "USD",
          confidence: "medium",
          source_pointer,
          excerpt: capFactExcerpt(`${label} ${periodLabel}: ${rawValue}`),
        });
      }
    }
  }

  // ── 4. Cash flow derived (burn_rate, runway_months → "current") ────────────
  if (inputs.cashFlow) {
    const cf = inputs.cashFlow;
    const document_id = cf.source.document_id;

    // Monthly burn rate
    const monthlyBurn = cf.derived?.monthly_burn_from_ops;
    if (isFiniteFactValue(monthlyBurn)) {
      const source_pointer = `derived=burn_rate from=cash_flow`;
      push({
        fact_id: computeFactId({
          deal_id: dealId,
          metric_key: "burn_rate",
          period_type: "unknown",
          period_label: "current",
          source_pointer,
          document_id,
        }),
        deal_id: dealId,
        document_id,
        source_kind: "xlsx",
        metric_key: "burn_rate",
        metric_label: "Monthly Burn Rate",
        period_type: "unknown",
        period_label: "current",
        value: monthlyBurn,
        unit: "currency",
        currency: "USD",
        confidence: "medium",
        source_pointer,
        excerpt: capFactExcerpt(`Monthly burn rate: $${monthlyBurn.toLocaleString()}/mo`),
      });
    }

    // Runway months
    const runwayMonths = cf.derived?.runway_months;
    if (isFiniteFactValue(runwayMonths)) {
      const source_pointer = `derived=runway_months from=cash_flow`;
      push({
        fact_id: computeFactId({
          deal_id: dealId,
          metric_key: "runway_months",
          period_type: "unknown",
          period_label: "current",
          source_pointer,
          document_id,
        }),
        deal_id: dealId,
        document_id,
        source_kind: "xlsx",
        metric_key: "runway_months",
        metric_label: "Cash Runway",
        period_type: "unknown",
        period_label: "current",
        value: runwayMonths,
        unit: "number",
        confidence: "medium",
        source_pointer,
        excerpt: capFactExcerpt(`Cash runway: ${runwayMonths.toFixed(1)} months`),
      });
    }
  }

  // ── 5. FinancialBenchmark[] from orchestrator segments ──────────────────────
  // Only ingest if they don't duplicate higher-quality XLSX facts.
  if (inputs.orchestratorBenchmarks?.length) {
    for (const bm of inputs.orchestratorBenchmarks) {
      if (!bm.label || !bm.value) continue;

      // Try to parse a numeric value from the benchmark label+value string
      const parsed = parseOrchestratorBenchmark(bm);
      if (!parsed) continue;

      const source_pointer = `orchestrator_benchmark label=${bm.label} basis=${bm.basis}`;
      // Don't overwrite a higher-confidence XLSX fact already in the map
      const tempId = computeFactId({
        deal_id: dealId,
        metric_key: parsed.metric_key,
        period_type: "unknown",
        period_label: "current",
        source_pointer,
      });
      if (map.has(tempId)) continue; // XLSX already populated this

      push({
        fact_id: tempId,
        deal_id: dealId,
        source_kind: bm.basis === "deck_signal" ? "deck" : "xlsx",
        metric_key: parsed.metric_key,
        metric_label: parsed.metric_label,
        period_type: "unknown",
        period_label: "current",
        value: parsed.value,
        unit: parsed.unit,
        currency: parsed.unit === "currency" ? "USD" : undefined,
        confidence: bm.basis === "direct" ? "medium" : "low",
        source_pointer,
        excerpt: capFactExcerpt(`${bm.label}: ${bm.value}`),
      });
    }
  }

  // ── 6. Deck financial signals — low confidence fallback ───────────────────
  if (inputs.deckSignals) {
    const ds = inputs.deckSignals;

    // Helper: find the first parseable mention matching a text predicate.
    const firstMentionMatch = (
      mentions: DeckFinancialMention[],
      predicate: (text: string) => boolean,
    ): DeckFinancialMention | null => mentions.find((m) => predicate(m.text)) ?? null;

    const deckFactGroups: Array<{
      metric_key: string;
      label: string;
      mention: DeckFinancialMention | null;
      unit: FinancialFactV1["unit"];
    }> = [
      {
        metric_key: "revenue",
        label: "Revenue (deck)",
        // Skip mentions that overlap with pricing or ARR/MRR language — these
        // are not canonical revenue disclosures.
        mention: (() => {
          const pricingTexts = new Set((ds.pricing_mentions ?? []).map((m) => m.text));
          const arrMrrTexts  = new Set((ds.arr_mrr_mentions ?? []).map((m) => m.text));
          return ds.revenue_mentions.find(
            (m) => !pricingTexts.has(m.text) && !arrMrrTexts.has(m.text),
          ) ?? null;
        })(),
        unit: "currency",
      },
      {
        metric_key: "burn_rate",
        label: "Burn Rate (deck)",
        mention: ds.burn_mentions[0] ?? null,
        unit: "currency",
      },
      {
        metric_key: "arr",
        label: "ARR (deck)",
        // Only write an ARR deck fact when the mention text explicitly references
        // ARR / "annual recurring". Prevents MRR signals ("$381K MRR") from being
        // stored as arr facts — those belong in the mrr bucket via getDeckValue.
        mention: firstMentionMatch(
          ds.arr_mrr_mentions,
          (t) => /\bARR\b|annual\s+recurring/i.test(t),
        ),
        unit: "currency",
      },
    ];

    for (const { metric_key, label, mention, unit } of deckFactGroups) {
      // Only produce one deck fact per metric_key (the first mention)
      if (!mention) continue;

      // Skip if higher-confidence data already covers this metric
      const qualId = computeFactId({
        deal_id: dealId,
        metric_key,
        period_type: "unknown",
        period_label: "current",
        source_pointer: `deck`,
      });
      // Check if any XLSX fact already covers this metric
      const alreadyHasXlsx = [...map.values()].some(
        (f) => f.metric_key === metric_key && f.source_kind === "xlsx"
      );
      if (alreadyHasXlsx) continue;

      // Try parse a dollar amount from the mention text
      const parsed = parseDeckAmount(mention.text);
      if (parsed === null) continue;

      const source_pointer = `deck doc=${mention.doc_id} page=${mention.page_index}`;
      push({
        fact_id: computeFactId({
          deal_id: dealId,
          metric_key,
          period_type: "unknown",
          period_label: "current",
          source_pointer,
          document_id: mention.doc_id,
        }),
        deal_id: dealId,
        document_id: mention.doc_id,
        source_kind: "deck",
        metric_key,
        metric_label: label,
        period_type: "unknown",
        period_label: "current",
        value: parsed,
        unit,
        currency: unit === "currency" ? "USD" : undefined,
        confidence: "low",
        page_number: mention.page_index,
        source_pointer,
        excerpt: capFactExcerpt(mention.text),
      });
    }
  }

  // ── 7. Workbook intelligence facts (Phase 2 XLSX modules) ─────────────────
  if (inputs.workbookFacts && inputs.workbookFacts.length > 0) {
    // Two-pass approach:
    //
    // Pass 1 — build the full set of realized keys from BOTH the existing
    //   registry (steps 1-6) AND the workbook facts batch itself.  This makes
    //   projection safety order-independent within the batch.
    //
    // Pass 2 — merge workbook facts, skipping projected/scenario facts for any
    //   metric+period slot already covered by a realized fact.
    const realizedKeys = new Set<string>();

    // From the existing registry (steps 1-6):
    for (const f of map.values()) {
      if (isRealizedScope(f.temporal_scope)) {
        realizedKeys.add(`${f.metric_key}:${f.period_label}`);
      }
    }
    // From the workbook batch itself:
    for (const wf of inputs.workbookFacts) {
      if (isRealizedScope(wf.temporal_scope) && isFiniteFactValue(wf.value)) {
        realizedKeys.add(`${wf.metric_key}:${wf.period_label}`);
      }
    }

    // Pass 2: merge, applying projection safety.
    for (const wf of inputs.workbookFacts) {
      if (!isFiniteFactValue(wf.value)) continue;
      // Projection safety: drop projected/scenario workbook facts when a
      // realized (historical/current) fact already exists for the same slot.
      if (!isRealizedScope(wf.temporal_scope)) {
        if (realizedKeys.has(`${wf.metric_key}:${wf.period_label}`)) continue;
      }
      push(wf);
    }
  }

  // ── 8. Cross-source reconciliation (Phase 3) ──────────────────────────────
  // Annotate every fact with cross_source_status by comparing deck vs workbook
  // facts for the same metric_key + period_label slot.
  //
  // This is a pure in-memory step: cross_source_status is available downstream
  // during this processing run but is NOT persisted to the DB (the upsert
  // function uses positional parameters that do not include this column).
  //
  // Projection safety is preserved: reconcileFinancialFacts() only compares
  // realized (historical|current) facts across sources.  Projected / scenario
  // facts produce "projected_only" or scenario-matched status and are NEVER
  // promoted to "supported" for current-company performance claims.
  const crossSourceResult = reconcileFinancialFacts(Array.from(map.values()));

  // ── 9. Derivation rules ────────────────────────────────────────────────────
  // Run deterministic derivation (burn_rate from total_expenses, runway from
  // cash + burn, gross_margin from revenue + gross_profit) on the reconciled
  // facts.  This ensures XLSX-origin expense data produces derived burn_rate.
  return reconcileFinancialFactsV1(crossSourceResult, dealId);
}

/** Returns true for temporal_scope values that represent realized/reported data. */
function isRealizedScope(scope: string | undefined): boolean {
  return scope === "historical" || scope === "current";
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Attempt to extract a numeric value + metric_key from a FinancialBenchmark.
 * Returns null when the value string is non-parseable.
 */
function parseOrchestratorBenchmark(bm: FinancialBenchmark): {
  metric_key: string;
  metric_label: string;
  value: number;
  unit: FinancialFactV1["unit"];
} | null {
  const labelLower = bm.label.toLowerCase();
  const valueStr = bm.value.trim();

  // Detect unit
  let unit: FinancialFactV1["unit"] = "unknown";
  if (valueStr.includes("$") || valueStr.includes("USD")) unit = "currency";
  else if (valueStr.includes("%")) unit = "percent";

  // Parse numeric value
  const num = parseLooseCurrency(valueStr);
  if (num === null) return null;
  if (!isFiniteFactValue(num)) return null;

  // Map label → metric_key
  const metric_key = labelToMetricKey(labelLower);

  return {
    metric_key,
    metric_label: bm.label,
    value: num,
    unit,
  };
}

/** Map benchmark label to canonical metric key. */
function labelToMetricKey(label: string): string {
  if (/burn|monthly.?burn/.test(label)) return "burn_rate";
  if (/runway/.test(label)) return "runway_months";
  if (/gross.?margin|gm/.test(label)) return "gross_margin";
  if (/\barr\b/.test(label)) return "arr";
  if (/\bmrr\b/.test(label)) return "mrr";
  if (/revenue|sales/.test(label)) return "revenue";
  if (/ebitda/.test(label)) return "ebitda";
  if (/net.?income/.test(label)) return "net_income";
  if (/\bcac\b/.test(label)) return "cac";
  if (/\bltv\b/.test(label)) return "ltv";
  // Default: slugify
  return label.trim().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

/**
 * Parse a "loose" currency/number string like "$1.2M", "$450K", "62%", "18 months".
 * Returns absolute numeric value, or null if unparseable.
 */
function parseLooseCurrency(s: string): number | null {
  const clean = s.trim().replace(/,/g, "").replace(/USD/gi, "").trim();
  // % value
  const pct = clean.match(/^([+-]?\d+(?:\.\d+)?)\s*%$/);
  if (pct) return parseFloat(pct[1]);
  // Dollar + multiplier
  const m = clean.match(/^\$?\s*([+-]?\d+(?:\.\d+)?)\s*([KkMmBbTt]?)(?:\s*\/mo|\s*month|\s*months?)?$/);
  if (!m) return null;
  const base = parseFloat(m[1]);
  const mult = m[2]?.toUpperCase();
  if (!isFiniteFactValue(base)) return null;
  if (mult === "K") return base * 1_000;
  if (mult === "M") return base * 1_000_000;
  if (mult === "B") return base * 1_000_000_000;
  if (mult === "T") return base * 1_000_000_000_000;
  return base;
}

/**
 * Parse a dollar amount from a deck mention text snippet.
 * Returns null if no recognizable amount found.
 */
function parseDeckAmount(text: string): number | null {
  const m = text.match(/\$\s*([\d,]+(?:\.\d+)?)\s*([KkMmBbTt]?)/);
  if (!m) return null;
  const base = parseFloat(m[1].replace(/,/g, ""));
  const mult = m[2]?.toUpperCase();
  if (!isFiniteFactValue(base)) return null;
  if (mult === "K") return base * 1_000;
  if (mult === "M") return base * 1_000_000;
  if (mult === "B") return base * 1_000_000_000;
  return base;
}
