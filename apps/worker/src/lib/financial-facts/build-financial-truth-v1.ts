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
    | "deck_mention"
    | "derived_from_mrr";
}

/** Normalized source priority buckets used for hierarchy arbitration. */
export type SourceKindBucket = "xlsx" | "structured_derived" | "deck" | "unknown";

export type ResolutionStrategy = "single_source" | "consensus_average" | "source_hierarchy" | "derived_from_mrr";

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
  /** True when intra-document timeseries was detected and collapsed for this metric. */
  intra_document_timeseries?: boolean;
  /** Maximum number of distinct periods collapsed from a single document. */
  collapsed_period_count?: number;
  /**
   * True when every eligible fact for this metric was a projected/forecast value.
   * The resolved_value in this case is derived from projected sources, not current actuals.
   */
  projected_only_dataset?: boolean;
  /**
   * Number of explicitly projected (temporal_scope=projected/scenario/target) facts
   * that existed for this metric but were excluded from truth resolution.
   */
  projected_excluded_count?: number;
  /**
   * Number of facts with no temporal scope that had future-year period labels and
   * were deprioritized in favour of current/historical facts.
   */
  future_unknown_excluded_count?: number;
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
  // No \s* between number and suffix: financial suffixes (K/M/B) are always
  // directly adjacent to the number. This prevents the "T" in "Total" from
  // being matched as the trillion (1e12) multiplier.
  const match = /\$([\d,]+(?:\.\d+)?)([KMBkmb]?)/.exec(text);
  if (!match) return null;
  const raw = parseFloat(match[1]!.replace(/,/g, ""));
  if (!isFinite(raw) || raw <= 0) return null;
  const multipliers: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9 };
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
    case "structured_derived":   // derived facts from reconcile-financial-facts-v1
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

/**
 * Extract the 4-digit calendar year embedded in a period_label.
 * Returns null when no unambiguous year is found.
 */
function extractPeriodYear(label: string): number | null {
  const full = /(20\d{2})/.exec(label);
  if (full) return parseInt(full[1]!, 10);
  const short = /\bfy?(\d{2})\b/i.exec(label);
  if (short) {
    const yr = parseInt(short[1]!, 10);
    return yr <= 50 ? 2000 + yr : 1900 + yr;
  }
  return null;
}

/**
 * Rank a period_label for recency / canonical preference.
 * Higher value = more preferred.
 *   "current" → highest (10_000)
 *   "ltm" / "ttm" / "trailing" → near-highest (9_999)
 *   "FY2024" / "2024" / "fy24" → parsed 4-digit year (2024)
 *   unparseable → 0 (lowest priority)
 *
 * NOTE: This rank intentionally allows future years to rank higher numerically.
 * Callers that care about current vs projected MUST check scope before using rank.
 */
function rankPeriodLabel(label: string): number {
  const l = label.toLowerCase().trim();
  if (l === "current") return 10_000;
  if (l === "ltm" || l === "ttm" || l === "trailing") return 9_999;
  const yr = extractPeriodYear(label);
  if (yr !== null) return yr;
  return 0;
}

/**
 * Classify a fact's effective temporal scope for truth-resolution purposes.
 *
 * Outcome categories:
 *   "realized"       — temporal_scope is explicitly "current" or "historical"
 *   "unknown-past"   — no/unknown temporal_scope AND period year ≤ currentYear
 *   "unknown-future" — no/unknown temporal_scope AND period year > currentYear
 *   "unknown-noyear" — no/unknown temporal_scope AND no year in period_label
 *   "projected"      — temporal_scope is "projected", "scenario", or "target"
 *
 * Realized facts are highest trust; projected are excluded from primary resolution.
 */
type FactScopeClass = "realized" | "unknown-past" | "unknown-future" | "unknown-noyear" | "projected";

function classifyFactScope(f: FinancialFactV1, currentYear: number): FactScopeClass {
  const scope = f.temporal_scope;
  if (scope === "projected" || scope === "scenario" || scope === "target") return "projected";
  if (scope === "current" || scope === "historical") return "realized";
  // scope is undefined / "unknown"
  const yr = extractPeriodYear(f.period_label);
  if (yr === null) return "unknown-noyear";
  if (yr > currentYear) return "unknown-future";
  return "unknown-past";
}

/**
 * Composite selection rank for choosing the best representative from a
 * same-document fact group.  Scope tier outweighs period recency.
 *
 * Tier offsets:
 *   realized (current)    50_000 + periodRank
 *   realized (historical) 40_000 + periodRank
 *   unknown-noyear        20_000 (period label has no year — treat as current proxy)
 *   unknown-past          10_000 + year
 *   unknown-future         1_000 + year   (deprioritized)
 *   projected                 0           (should not reach here; excluded upstream)
 */
function factSelectionRank(f: FinancialFactV1, currentYear: number): number {
  const scopeClass = classifyFactScope(f, currentYear);
  const pr = rankPeriodLabel(f.period_label);
  switch (scopeClass) {
    case "realized":
      return (f.temporal_scope === "current" ? 50_000 : 40_000) + pr;
    case "unknown-noyear":
      return 20_000;
    case "unknown-past":
      return 10_000 + pr;
    case "unknown-future":
      return 1_000 + pr;
    case "projected":
      return 0;
  }
}

interface CollectedSourcesResult {
  sources: FinancialTruthSource[];
  /** True when at least one document contributed ≥2 distinct period_labels for this metric. */
  intra_document_timeseries: boolean;
  /** Highest number of distinct periods found in a single document (0 when no timeseries). */
  collapsed_period_count: number;
  /**
   * True when ALL surviving facts were from projected-only sources
   * (no current or historical actuals available).
   */
  projected_only_dataset: boolean;
  /** Number of explicitly projected/scenario/target facts that were excluded. */
  projected_excluded_count: number;
  /** Number of unknown-scope facts whose period year > currentYear that were deprioritized. */
  future_unknown_excluded_count: number;
}

function collectFactRegistrySources(
  facts: FinancialFactV1[],
  metricKeys: string[],
): CollectedSourcesResult {
  const currentYear = new Date().getFullYear();

  // ── Step 1: Broad eligibility (metric match + section header guard) ────────
  const candidates = facts.filter(
    (f) => metricKeys.includes(f.metric_key) && !isSectionHeaderFact(f),
  );

  // ── Step 2: Partition by scope class ──────────────────────────────────────
  // Explicitly projected/scenario/target → excluded entirely.
  // Unknown-future (undefined scope + future year) → excluded from primary;
  //   promoted to fallback only when NO non-projected facts exist at all.
  const primaryFacts: FinancialFactV1[] = [];
  let projected_excluded_count = 0;
  let future_unknown_excluded_count = 0;
  const fallbackProjectedFacts: FinancialFactV1[] = [];

  for (const f of candidates) {
    const cls = classifyFactScope(f, currentYear);
    if (cls === "projected") {
      projected_excluded_count++;
      fallbackProjectedFacts.push(f);
    } else if (cls === "unknown-future") {
      future_unknown_excluded_count++;
      fallbackProjectedFacts.push(f);
    } else {
      // realized | unknown-past | unknown-noyear → primary
      primaryFacts.push(f);
    }
  }
  dbg(
    `collectFactRegistrySources: candidates=${candidates.length} ` +
      `primary=${primaryFacts.length} proj_excl=${projected_excluded_count} ` +
      `future_excl=${future_unknown_excluded_count}`,
  );

  // When NO primary facts exist but projected/future facts do, fall back to
  // them so a projected-only deal remains resolvable (but clearly marked).
  const activeFacts = primaryFacts.length > 0 ? primaryFacts : fallbackProjectedFacts;
  const projected_only_dataset = primaryFacts.length === 0 && fallbackProjectedFacts.length > 0;
  // Only report exclusion counts when actual primary facts exist to have "won".
  // In a projected-only dataset nothing was excluded — everything was used.
  const effective_projected_excluded   = projected_only_dataset ? 0 : projected_excluded_count;
  const effective_future_unknown_excluded = projected_only_dataset ? 0 : future_unknown_excluded_count;

  // ── Step 3: Group by document_id ──────────────────────────────────────────
  const byDoc = new Map<string, FinancialFactV1[]>();
  const noDocFacts: FinancialFactV1[] = [];
  for (const f of activeFacts) {
    if (f.document_id == null) {
      noDocFacts.push(f);
    } else {
      const existing = byDoc.get(f.document_id);
      if (existing) {
        existing.push(f);
      } else {
        byDoc.set(f.document_id, [f]);
      }
    }
  }

  let intra_document_timeseries = false;
  let collapsed_period_count = 0;
  const sources: FinancialTruthSource[] = [];

  // ── Step 4: Collapse intra-document timeseries ────────────────────────────
  // Uses factSelectionRank() which is scope-aware:  realized > unknown-past
  // > unknown-noyear > unknown-future.  This ensures a current/historical
  // period is always preferred over a same-document future-year period.
  for (const docFacts of byDoc.values()) {
    const distinctPeriods = new Set(docFacts.map((f) => f.period_label));
    if (distinctPeriods.size >= 2) {
      intra_document_timeseries = true;
      if (distinctPeriods.size > collapsed_period_count) {
        collapsed_period_count = distinctPeriods.size;
      }
      // Pick the highest-ranked fact using scope-aware ranking.
      const representative = docFacts.reduce((best, cur) =>
        factSelectionRank(cur, currentYear) > factSelectionRank(best, currentYear) ? cur : best,
      );
      sources.push({
        source_kind: representative.source_kind,
        document_id: representative.document_id ?? null,
        value: representative.value,
        confidence: representative.confidence,
        period_label: representative.period_label,
        origin: "fact_registry" as const,
      });
      dbg(
        `timeseries collapse: doc=${representative.document_id} periods=${distinctPeriods.size} ` +
          `best=${representative.period_label} scope=${representative.temporal_scope ?? "undef"} ` +
          `value=${representative.value}`,
      );
    } else {
      for (const f of docFacts) {
        sources.push({
          source_kind: f.source_kind,
          document_id: f.document_id ?? null,
          value: f.value,
          confidence: f.confidence,
          period_label: f.period_label,
          origin: "fact_registry" as const,
        });
      }
    }
  }

  // Facts without a document_id pass through unchanged.
  for (const f of noDocFacts) {
    sources.push({
      source_kind: f.source_kind,
      document_id: null,
      value: f.value,
      confidence: f.confidence,
      period_label: f.period_label,
      origin: "fact_registry" as const,
    });
  }

  return {
    sources,
    intra_document_timeseries,
    collapsed_period_count,
    projected_only_dataset,
    projected_excluded_count: effective_projected_excluded,
    future_unknown_excluded_count: effective_future_unknown_excluded,
  };
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
    case "arr": {
      // Prefer the largest "Total ARR"-labeled mention (matches fact-registry
      // selection logic). Falls back to the first plain ARR mention.
      // This prevents a smaller column-total from a different slide from
      // shadowing the correct traction-slide Total ARR value.
      let bestTotal: number | null = null;
      let firstMatch: number | null = null;
      for (const m of signals.arr_mrr_mentions) {
        if (!/\bARR\b|annual\s+recurring/i.test(m.text)) continue;
        const v = parseDeckAmount(m.text);
        if (v == null) continue;
        if (/\bTotal\b/i.test(m.text)) {
          if (bestTotal === null || v > bestTotal) bestTotal = v;
        } else if (firstMatch === null) {
          firstMatch = v;
        }
      }
      return bestTotal ?? firstMatch;
    }
    case "mrr": {
      // Prefer the largest "Total MRR"-labeled mention; fall back to first MRR.
      let bestTotal: number | null = null;
      let firstMatch: number | null = null;
      for (const m of signals.arr_mrr_mentions) {
        if (!/\bMRR\b|monthly\s+recurring/i.test(m.text)) continue;
        const v = parseDeckAmount(m.text);
        if (v == null) continue;
        if (/\bTotal\b/i.test(m.text)) {
          if (bestTotal === null || v > bestTotal) bestTotal = v;
        } else if (firstMatch === null) {
          firstMatch = v;
        }
      }
      return bestTotal ?? firstMatch;
    }
    case "revenue": {
      // Defense-in-depth: skip any revenue mention whose text also appears in
      // pricing_mentions (pricing tier language) or arr_mrr_mentions (ARR/MRR
      // figures that leaked into revenue_mentions before REVENUE_RE was tightened).
      const pricingTexts = new Set((signals.pricing_mentions ?? []).map((m) => m.text));
      const arrMrrTexts = new Set((signals.arr_mrr_mentions ?? []).map((m) => m.text));
      for (const m of signals.revenue_mentions) {
        if (pricingTexts.has(m.text)) continue;
        if (arrMrrTexts.has(m.text)) continue;
        const v = parseDeckAmount(m.text);
        if (v != null) return v;
      }
      return null;
    }
    case "burn_rate": {
      // Defense-in-depth: skip any burn mention whose text also appears in
      // pricing_mentions — catches residual overlap from pricing slide language.
      const pricingTexts = new Set((signals.pricing_mentions ?? []).map((m) => m.text));
      for (const m of signals.burn_mentions) {
        if (pricingTexts.has(m.text)) continue;
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
    const {
      sources: registrySources,
      intra_document_timeseries,
      collapsed_period_count,
      projected_only_dataset,
      projected_excluded_count,
      future_unknown_excluded_count,
    } = collectFactRegistrySources(facts, aliases);
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
      ...(intra_document_timeseries && {
        intra_document_timeseries: true,
        collapsed_period_count,
      }),
      ...(projected_only_dataset && { projected_only_dataset: true }),
      ...(projected_excluded_count > 0 && { projected_excluded_count }),
      ...(future_unknown_excluded_count > 0 && { future_unknown_excluded_count }),
    };

    dbg(`${metric}: state=${state} resolved=${resolved_value} src_kind=${resolved_source_kind} strategy=${resolution_strategy} sources=${sources.length} disagreement=${disagreement_pct?.toFixed(1) ?? "n/a"}%`);
  }

  // ── Post-loop: Derive ARR from MRR × 12 when ARR is INSUFFICIENT ─────────
  // Handles deals where only MRR is available (e.g. deck-only MRR mentions).
  // Structured MRR → ARR is also handled upstream in reconcileFinancialFactsV1
  // (Rule 5), so by the time we reach here the fact_registry sources would
  // already carry a derived ARR.  This block is the safety net for deck MRR.
  //
  // Guards:
  //   - ARR must be INSUFFICIENT (never overwrite explicit ARR)
  //   - MRR must have a resolved value (CONFIRMED or CONFLICT are both ok —
  //     we take the resolved_value in both cases)
  //   - MRR resolved_value > 0
  const arrRecord = map["arr"];
  const mrrRecord = map["mrr"];
  if (
    arrRecord != null &&
    mrrRecord != null &&
    arrRecord.state === "INSUFFICIENT" &&
    mrrRecord.resolved_value != null &&
    mrrRecord.resolved_value > 0
  ) {
    const derivedArrValue = Math.round(mrrRecord.resolved_value * 12);
    const derivedBucket: SourceKindBucket = mrrRecord.resolved_source_kind ?? "unknown";
    // Deck-sourced MRR → ARR remains low-confidence; structured MRR → medium.
    const derivedConfidence = derivedBucket === "xlsx" ? "medium" : derivedBucket === "structured_derived" ? "medium" : "low";
    map["arr"] = {
      metric: "arr",
      state: "CONFIRMED",
      resolved_value: derivedArrValue,
      resolved_source_kind: derivedBucket,
      resolution_strategy: "derived_from_mrr",
      disagreement: false,
      sources: [
        {
          source_kind: derivedBucket,
          document_id: null,
          value: derivedArrValue,
          confidence: derivedConfidence,
          period_label: mrrRecord.sources[0]?.period_label ?? "current",
          origin: "derived_from_mrr",
        },
      ],
      source_count: 1,
      has_xlsx_source: derivedBucket === "xlsx",
      has_deck_source: derivedBucket === "deck",
      disagreement_pct: null,
    };
    dbg(`arr: post-loop derived from mrr=${mrrRecord.resolved_value} → arr=${derivedArrValue} bucket=${derivedBucket}`);
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
