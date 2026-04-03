/**
 * build-financial-truth-v1.ts
 *
 * Financial Truth Resolution Layer — V2
 *
 * Collects all available sources for tracked financial metrics and produces a
 * FinancialTruthRecord per metric with a deterministic truth state:
 *
 *   CONFIRMED    — 1 source, or multiple sources agree within 20%
 *   CONFLICT     — multiple sources disagree by > 20%
 *   INSUFFICIENT — no credible source found
 *
 * V2 upgrade: source-priority arbitration.
 * When sources disagree (CONFLICT), resolved_value is now set using source hierarchy:
 *   1. xlsx          — structured XLSX financial facts (highest trust)
 *   2. structured_derived — Pipeline B parse outputs (pdf_table, pdf_kpi_line, etc.)
 *   3. deck          — deck narrative / deckFinancialSignals
 *
 * State remains CONFLICT when hierarchy wins — conflict is preserved, not erased.
 * resolved_source_kind, resolution_strategy, and disagreement fields are new in V2.
 *
 * Pure function. No I/O. Never throws (outer guard catches and returns INSUFFICIENT map).
 */

import type { FinancialFactV1 } from "@dealdecision/core";
import type { DeckFinancialSignalsV1 } from "../deck-financial-signals-v1.js";

// ─── Public types ─────────────────────────────────────────────────────────────

export type FinancialTruthState = "CONFIRMED" | "CONFLICT" | "INSUFFICIENT";

export interface FinancialTruthSource {
  source_kind: string;
  document_id: string | null;
  value: number;
  confidence: string;
  period_label: string;
  origin:
    | "fact_registry"
    | "pipeline_b_financial_statement"
    | "pipeline_b_cash_flow"
    | "pipeline_b_balance_sheet"
    | "deck_mention";
}

/** Normalized source priority buckets used for hierarchy arbitration. */
export type SourceKindBucket = "xlsx" | "structured_derived" | "deck" | "unknown";

export type ResolutionStrategy = "single_source" | "consensus_average" | "source_hierarchy";

export interface FinancialTruthRecord {
  metric: string;
  state: FinancialTruthState;
  /** Best resolved value. Non-null even when state=CONFLICT if source hierarchy produced a winner. */
  resolved_value: number | null;
  /** Which source bucket provided the resolved_value. Null when INSUFFICIENT. */
  resolved_source_kind: SourceKindBucket | null;
  /** How the value was resolved. */
  resolution_strategy: ResolutionStrategy | null;
  /** True when multiple sources disagree by >20% (even if resolved_value is set). */
  disagreement: boolean;
  sources: FinancialTruthSource[];
  source_count: number;
  has_xlsx_source: boolean;
  has_deck_source: boolean;
  disagreement_pct: number | null;
}

/** Keyed by metric name: "revenue" | "arr" | "mrr" | "burn_rate" | "runway_months" */
export type FinancialTruthMapV1 = Record<string, FinancialTruthRecord>;

// ─── Inputs ───────────────────────────────────────────────────────────────────

export interface FinancialTruthInputs {
  /** All facts from buildFinancialFactRegistryV1 (reconciled + derived). */
  facts: FinancialFactV1[];
  /** Deck signal mentions — may be null for XLSX-only deals. */
  deckFinancialSignals: DeckFinancialSignalsV1 | null | undefined;
  /** Scalar outputs from Pipeline B parsers. */
  pipelineB: {
    revenue_latest: number | null;
    burn_monthly: number | null;
    runway_months: number | null;
    cash_latest: number | null;
  };
}

// ─── Tracked metrics ──────────────────────────────────────────────────────────

const TRACKED_METRICS = [
  "revenue",
  "arr",
  "mrr",
  "burn_rate",
  "runway_months",
] as const;

type TrackedMetric = (typeof TRACKED_METRICS)[number];

/** Canonical metric_key aliases in the fact registry for each tracked metric. */
const METRIC_ALIASES: Record<TrackedMetric, string[]> = {
  revenue:       ["revenue", "total_revenue"],
  arr:           ["arr"],
  mrr:           ["mrr"],
  burn_rate:     ["burn_rate", "monthly_burn"],
  runway_months: ["runway_months", "runway"],
};

// ─── Debug ────────────────────────────────────────────────────────────────────

const DEBUG = process.env["DEBUG_FINANCIAL_TRUTH"] === "1";
function dbg(msg: string, data?: unknown): void {
  if (DEBUG) console.log(`[financial-truth-v1] ${msg}`, data ?? "");
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Parse a dollar figure from a deck mention text string.
 * Returns null when no parseable dollar amount is found.
 */
function parseDeckAmount(text: string): number | null {
  const match = /\$([\d,]+(?:\.\d+)?)\s*([KMBTkmbt]?)/.exec(text);
  if (!match) return null;
  const raw = parseFloat(match[1]!.replace(/,/g, ""));
  if (!isFinite(raw) || raw <= 0) return null;
  const multipliers: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9, t: 1e12 };
  const suffix = match[2]?.toLowerCase() ?? "";
  return raw * (multipliers[suffix] ?? 1);
}

/**
 * Returns true when a fact looks like a section-header artifact.
 * Guard: "2026 Revenue Projections" row → metric_key=revenue, value=2026.
 */
function isSectionHeaderFact(f: FinancialFactV1): boolean {
  return Number.isInteger(f.value) && f.value >= 1990 && f.value <= 2040;
}

/**
 * Compute max pairwise disagreement percentage across a set of values.
 * Returns null when fewer than 2 values.
 */
function computeDisagreementPct(values: number[]): number | null {
  if (values.length < 2) return null;
  const max = Math.max(...values);
  const min = Math.min(...values);
  if (max === 0) return null;
  return ((max - min) / max) * 100;
}

/**
 * Normalize a raw source_kind string into a stable priority bucket.
 * Explicit mapping — no clever regex. New source_kinds must be added here.
 */
function normalizeSourceKind(raw: string): SourceKindBucket {
  switch (raw) {
    case "xlsx":
      return "xlsx";
    case "pdf_table":
    case "pdf_kpi_line":
    case "kpi_tile":
    case "structured":
    case "workbook":
      return "structured_derived";
    case "deck":
    case "narrative":
    case "deck_claim":
    case "fused_fact":
      return "deck";
    default:
      return "unknown";
  }
}

/** Source priority order — lower index = higher priority. */
const SOURCE_PRIORITY: SourceKindBucket[] = ["xlsx", "structured_derived", "deck", "unknown"];

function sourcePriority(bucket: SourceKindBucket): number {
  return SOURCE_PRIORITY.indexOf(bucket);
}

/**
 * Pick the best (highest-priority) source from a list.
 * When multiple sources share the top priority bucket, average their values.
 */
function selectHierarchyWinner(sources: FinancialTruthSource[]): {
  value: number;
  bucket: SourceKindBucket;
} | null {
  if (sources.length === 0) return null;

  // Map each source to its normalized bucket
  const bucketed = sources.map((s) => ({
    ...s,
    bucket: normalizeSourceKind(s.source_kind),
  }));

  // Find the best (lowest priority index) bucket that has at least one source
  let bestPriorityIdx = Infinity;
  for (const b of bucketed) {
    const idx = sourcePriority(b.bucket);
    if (idx < bestPriorityIdx) bestPriorityIdx = idx;
  }

  const winners = bucketed.filter((b) => sourcePriority(b.bucket) === bestPriorityIdx);
  const avg = winners.reduce((sum, b) => sum + b.value, 0) / winners.length;
  return { value: avg, bucket: SOURCE_PRIORITY[bestPriorityIdx] ?? "unknown" };
}

/**
 * Apply V2 resolution rules to a list of sources.
 * Same state logic as V1, but CONFLICT now resolves a value via source hierarchy.
 */
function resolveV2(sources: FinancialTruthSource[]): {
  state: FinancialTruthState;
  resolved_value: number | null;
  resolved_source_kind: SourceKindBucket | null;
  resolution_strategy: ResolutionStrategy | null;
  disagreement: boolean;
  disagreement_pct: number | null;
} {
  if (sources.length === 0) {
    return {
      state: "INSUFFICIENT",
      resolved_value: null,
      resolved_source_kind: null,
      resolution_strategy: null,
      disagreement: false,
      disagreement_pct: null,
    };
  }
  if (sources.length === 1) {
    const s = sources[0]!;
    return {
      state: "CONFIRMED",
      resolved_value: s.value,
      resolved_source_kind: normalizeSourceKind(s.source_kind),
      resolution_strategy: "single_source",
      disagreement: false,
      disagreement_pct: null,
    };
  }

  const values = sources.map((s) => s.value);
  const disagreementPct = computeDisagreementPct(values);

  if (disagreementPct === null || disagreementPct <= 20) {
    // All sources agree — average across all (same logic as V1 CONFIRMED path)
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    // Best bucket from full source set for provenance
    const winner = selectHierarchyWinner(sources);
    return {
      state: "CONFIRMED",
      resolved_value: avg,
      resolved_source_kind: winner?.bucket ?? null,
      resolution_strategy: "consensus_average",
      disagreement: false,
      disagreement_pct: disagreementPct,
    };
  }

  // CONFLICT — sources disagree. Pick a winner via source hierarchy.
  // State remains CONFLICT so downstream knows the data is contested.
  const winner = selectHierarchyWinner(sources);
  return {
    state: "CONFLICT",
    resolved_value: winner?.value ?? null,
    resolved_source_kind: winner?.bucket ?? null,
    resolution_strategy: winner != null ? "source_hierarchy" : null,
    disagreement: true,
    disagreement_pct: disagreementPct,
  };
}

// ─── Source collectors ────────────────────────────────────────────────────────

function collectFactRegistrySources(
  facts: FinancialFactV1[],
  metricKeys: string[],
): FinancialTruthSource[] {
  return facts
    .filter(
      (f) =>
        metricKeys.includes(f.metric_key) &&
        !isSectionHeaderFact(f) &&
        f.temporal_scope !== "projected" &&
        f.temporal_scope !== "scenario" &&
        f.temporal_scope !== "target",
    )
    .map((f) => ({
      source_kind: f.source_kind,
      document_id: f.document_id ?? null,
      value: f.value,
      confidence: f.confidence,
      period_label: f.period_label,
      origin: "fact_registry" as const,
    }));
}

function getPipelineBValue(
  metric: TrackedMetric,
  pb: FinancialTruthInputs["pipelineB"],
): number | null {
  switch (metric) {
    case "revenue":       return pb.revenue_latest;
    case "burn_rate":     return pb.burn_monthly;
    case "runway_months": return pb.runway_months;
    // arr and mrr come from fact registry only — Pipeline B does not produce these scalars
    default:              return null;
  }
}

function getPipelineBOrigin(metric: TrackedMetric): FinancialTruthSource["origin"] {
  switch (metric) {
    case "burn_rate":
    case "runway_months":
      return "pipeline_b_cash_flow";
    default:
      return "pipeline_b_financial_statement";
  }
}

function getDeckValue(
  metric: TrackedMetric,
  signals: DeckFinancialSignalsV1 | null | undefined,
): number | null {
  if (!signals) return null;

  switch (metric) {
    case "arr":
    case "mrr": {
      for (const m of signals.arr_mrr_mentions) {
        const v = parseDeckAmount(m.text);
        if (v != null) return v;
      }
      return null;
    }
    case "revenue": {
      for (const m of signals.revenue_mentions) {
        const v = parseDeckAmount(m.text);
        if (v != null) return v;
      }
      return null;
    }
    case "burn_rate": {
      for (const m of signals.burn_mentions) {
        const v = parseDeckAmount(m.text);
        if (v != null) return v;
      }
      return null;
    }
    // runway_months deck mentions are "N months", not dollar amounts — not extracted in V1
    default:
      return null;
  }
}

// ─── Main builder ─────────────────────────────────────────────────────────────

function buildInsufficientMap(): FinancialTruthMapV1 {
  const map: FinancialTruthMapV1 = {};
  for (const metric of TRACKED_METRICS) {
    map[metric] = {
      metric,
      state: "INSUFFICIENT",
      resolved_value: null,
      resolved_source_kind: null,
      resolution_strategy: null,
      disagreement: false,
      sources: [],
      source_count: 0,
      has_xlsx_source: false,
      has_deck_source: false,
      disagreement_pct: null,
    };
  }
  return map;
}

function _buildFinancialTruthV1(inputs: FinancialTruthInputs): FinancialTruthMapV1 {
  const { facts, deckFinancialSignals, pipelineB } = inputs;
  const map: FinancialTruthMapV1 = {};

  for (const metric of TRACKED_METRICS) {
    const aliases = METRIC_ALIASES[metric];
    const sources: FinancialTruthSource[] = [];

    // ── 1. Fact registry (xlsx, pdf_table, kpi_tile, etc.) ───────────────────
    const registrySources = collectFactRegistrySources(facts, aliases);
    sources.push(...registrySources);
    dbg(`${metric}: fact_registry sources=${registrySources.length}`);

    // ── 2. Pipeline B scalar ─────────────────────────────────────────────────
    // Only add when no structured (xlsx/pdf_table) source already covers this metric,
    // to avoid double-counting the same underlying extraction.
    const pbValue = getPipelineBValue(metric, pipelineB);
    if (pbValue != null) {
      const hasStructuredSource = registrySources.some(
        (s) => s.source_kind === "xlsx" || s.source_kind === "pdf_table",
      );
      if (!hasStructuredSource) {
        sources.push({
          source_kind: "pdf_kpi_line",
          document_id: null,
          value: pbValue,
          confidence: "medium",
          period_label: "current",
          origin: getPipelineBOrigin(metric),
        });
        dbg(`${metric}: added pipeline_b value=${pbValue}`);
      }
    }

    // ── 3. Deck mention ───────────────────────────────────────────────────────
    const deckValue = getDeckValue(metric, deckFinancialSignals);
    if (deckValue != null) {
      sources.push({
        source_kind: "deck",
        document_id: null,
        value: deckValue,
        confidence: "low",
        period_label: "current",
        origin: "deck_mention",
      });
      dbg(`${metric}: added deck value=${deckValue}`);
    }

    // ── 4. Resolve ────────────────────────────────────────────────────────────
    const { state, resolved_value, resolved_source_kind, resolution_strategy, disagreement, disagreement_pct } = resolveV2(sources);

    map[metric] = {
      metric,
      state,
      resolved_value,
      resolved_source_kind,
      resolution_strategy,
      disagreement,
      sources,
      source_count: sources.length,
      has_xlsx_source: sources.some((s) => s.source_kind === "xlsx"),
      has_deck_source: sources.some((s) => s.source_kind === "deck"),
      disagreement_pct,
    };

    dbg(`${metric}: state=${state} resolved=${resolved_value} src_kind=${resolved_source_kind} strategy=${resolution_strategy} sources=${sources.length} disagreement=${disagreement_pct?.toFixed(1) ?? "n/a"}%`);
  }

  return map;
}

/**
 * Build the financial truth map for a set of pipeline facts and signals.
 *
 * Always returns a complete map (all tracked metrics present).
 * Returns an INSUFFICIENT map when an unexpected error occurs.
 */
export function buildFinancialTruthV1(inputs: FinancialTruthInputs): FinancialTruthMapV1 {
  try {
    return _buildFinancialTruthV1(inputs);
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "financial_truth_v1_error",
        error: err instanceof Error ? err.message : String(err),
        ts: new Date().toISOString(),
      }),
    );
    return buildInsufficientMap();
  }
}

/**
 * Returns true when any metric in the truth map has an XLSX source.
 * Use as the authoritative has_xlsx signal.
 */
export function hasXlsxFromTruthMap(map: FinancialTruthMapV1): boolean {
  return Object.values(map).some((r) => r.has_xlsx_source);
}
