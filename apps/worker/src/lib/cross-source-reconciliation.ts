/**
 * cross-source-reconciliation.ts
 *
 * Deterministic cross-document financial reconciliation engine.
 *
 * Compares FinancialFactV1 rows across source kinds (deck vs workbook) for the
 * same metric_key + period_label and labels their agreement state before final
 * downstream use.
 *
 * ─── Agreement states ──────────────────────────────────────────────────────
 *
 *  supported
 *    ≥1 deck (source_kind="deck") AND ≥1 workbook (source_kind ≠ "deck") fact
 *    both exist for the same realized slot (historical|current temporal_scope)
 *    and their values agree within the per-metric tolerance.
 *
 *  conflicting
 *    ≥1 deck AND ≥1 workbook realized fact exist but values disagree beyond
 *    tolerance.
 *
 *  deck_only
 *    Only deck-sourced realized facts exist for this slot; no workbook equivalent.
 *
 *  workbook_only
 *    Only workbook-sourced realized facts exist; no deck equivalent.
 *
 *  projected_only
 *    No realized (historical|current) fact exists from any source; only
 *    projected / scenario / target facts are present.
 *
 *  unresolved
 *    Insufficient data to determine agreement (e.g. both values are zero,
 *    or both facts share the same source kind, or the comparison cannot be
 *    made reliably).
 *
 * ─── Scope definitions ─────────────────────────────────────────────────────
 *
 *  "deck source"      — FinancialFactV1 with source_kind = "deck"
 *  "workbook source"  — FinancialFactV1 with source_kind in
 *                       { "xlsx", "pdf_table", "pdf_kpi_line" }
 *  "realized fact"    — temporal_scope in { "historical", "current", undefined }
 *  "projected fact"   — temporal_scope in { "projected", "scenario", "target" }
 *
 * ─── Tolerance policy ──────────────────────────────────────────────────────
 *
 *  Relative tolerance: |a − b| / max(|a|, |b|) ≤ T  (where T is per-metric).
 *  When max(|a|, |b|) < ABSOLUTE_FLOOR we fall back to an absolute $50 K check.
 *  Tolerance values are deliberately conservative from an investor-diligence POV.
 *  Changing a threshold changes what counts as "supported" vs "conflicting".
 *
 *  raise_amount / safe_cap          →  5%   (tight — specific commitment)
 *  valuation (pre / post / cap)     → 10%
 *  revenue / arr / mrr              → 10%
 *  booked_revenue / recognized_rev  → 10%
 *  ebitda / net_income              → 15%   (harder to normalize)
 *  burn_rate / runway_months        → 15%
 *  gross_profit / gross_margin      → 10%
 *  tam / sam / som                  → 25%   (estimates, wider acceptable range)
 *  default (other metrics)          → 10%
 *
 * ─── Scenario matching ──────────────────────────────────────────────────────
 *
 *  Scenario facts (temporal_scope = "scenario") are compared ONLY to other
 *  scenario facts that share the same scenario label (case-insensitive).
 *  Scenario facts do NOT compare to realized facts.
 *
 * ─── No LLM — pure deterministic function. ──────────────────────────────────
 */

import type { FinancialFactV1, CrossSourceReconciliationStatus } from "@dealdecision/core";
import { isFiniteFactValue } from "@dealdecision/core";

// ─── Tolerance map ────────────────────────────────────────────────────────────

/**
 * Per-metric relative tolerance for numeric agreement checks.
 * Key: canonical metric_key.
 * Value: fraction (0.05 = 5%).
 */
const METRIC_TOLERANCE: Record<string, number> = {
  // Financing terms (very tight — specific commitment numbers)
  raise_amount:       0.05,
  safe_cap:           0.05,
  raise_cap:          0.05,
  safe_discount:      0.05,
  raise_discount:     0.05,

  // Valuations
  valuation:          0.10,
  valuation_pre:      0.10,
  valuation_post:     0.10,
  valuation_safe_cap: 0.10,

  // Revenue / recurring metrics
  revenue:            0.10,
  booked_revenue:     0.10,
  recognized_revenue: 0.10,
  arr:                0.10,
  mrr:                0.10,
  forecast_revenue:   0.10,

  // Profitability
  gross_profit:       0.10,
  gross_margin:       0.10,
  ebitda:             0.15,
  net_income:         0.15,
  operating_expense:  0.15,

  // Cash / burn / runway
  cash:               0.10,
  burn_rate:          0.15,
  runway_months:      0.15,

  // Unit economics
  cac:                0.10,
  ltv:                0.10,
  arpu:               0.10,
  churn_pct:          0.10,
  retention_pct:      0.10,

  // Market estimates (wide tolerance — inherently imprecise)
  tam:                0.25,
  sam:                0.25,
  som:                0.25,

  // Pipeline / other
  pipeline:           0.15,
  other_metric:       0.15,
};

/** Default tolerance for metrics not listed above (10%). */
const DEFAULT_TOLERANCE = 0.10;

/**
 * Minimum absolute value (in native units) below which relative tolerance is
 * unreliable.  For currency metrics < $50K, fall back to an absolute $5K gap.
 * This prevents near-zero ARR figures (e.g. $1K vs $2K) from being flagged as
 * 100% divergent when the absolute gap is trivial.
 */
const ABSOLUTE_FLOOR = 50_000;
const ABSOLUTE_FLOOR_TOLERANCE = 5_000;

// ─── Source kind classification ───────────────────────────────────────────────

const DECK_SOURCE_KINDS = new Set<FinancialFactV1["source_kind"]>(["deck"]);
const WORKBOOK_SOURCE_KINDS = new Set<FinancialFactV1["source_kind"]>([
  "xlsx", "pdf_table", "pdf_kpi_line",
]);

/** True when this fact comes from a deck/text extraction. */
function isDeckFact(f: FinancialFactV1): boolean {
  return DECK_SOURCE_KINDS.has(f.source_kind);
}

/** True when this fact comes from a structured workbook/PDF-table extraction. */
function isWorkbookFact(f: FinancialFactV1): boolean {
  return WORKBOOK_SOURCE_KINDS.has(f.source_kind);
}

// ─── Temporal scope helpers ───────────────────────────────────────────────────

/**
 * True for facts that represent confirmed/reported data (not forward-looking).
 * When temporal_scope is undefined we treat the fact as realized (conservative default).
 */
function isRealizedFact(f: FinancialFactV1): boolean {
  const s = f.temporal_scope;
  if (!s) return true;  // undefined → treat as realized
  return s === "historical" || s === "current";
}

/**
 * True for forward-looking or hypothetical facts.
 */
function isProjectedFact(f: FinancialFactV1): boolean {
  const s = f.temporal_scope;
  if (!s) return false;
  return s === "projected" || s === "scenario" || s === "target";
}

// ─── Tolerance check ─────────────────────────────────────────────────────────

/**
 * Returns true when values a and b agree within the per-metric tolerance.
 *
 * Uses relative tolerance, falling back to absolute comparison for small values.
 * Both a and b must be finite and non-negative for a meaningful comparison.
 */
export function withinTolerance(
  a: number,
  b: number,
  metricKey: string,
): boolean {
  if (!isFiniteFactValue(a) || !isFiniteFactValue(b)) return false;
  const absA = Math.abs(a);
  const absB = Math.abs(b);
  const maxAbs = Math.max(absA, absB);
  const diff    = Math.abs(a - b);

  // Absolute floor: for very small numbers use a fixed tolerance
  if (maxAbs < ABSOLUTE_FLOOR) {
    return diff <= ABSOLUTE_FLOOR_TOLERANCE;
  }

  const tolerance = METRIC_TOLERANCE[metricKey] ?? DEFAULT_TOLERANCE;
  return diff / maxAbs <= tolerance;
}

// ─── Reconciliation group ─────────────────────────────────────────────────────

/**
 * Internal grouping: all facts for one (metric_key, period_label) slot,
 * split by realization state and source kind.
 */
interface ReconciliationGroup {
  groupKey: string;  // "${metric_key}:${period_label}"
  metricKey: string;
  periodLabel: string;
  /** Realized facts from deck sources. */
  realizedDeck: FinancialFactV1[];
  /** Realized facts from workbook sources. */
  realizedWorkbook: FinancialFactV1[];
  /** Projected/scenario facts (any source). */
  projected: FinancialFactV1[];
}

/**
 * Group a flat array of facts by (metric_key, period_label).
 * Facts are routed into realizedDeck / realizedWorkbook / projected buckets.
 */
function buildGroups(facts: FinancialFactV1[]): Map<string, ReconciliationGroup> {
  const groups = new Map<string, ReconciliationGroup>();

  for (const f of facts) {
    const key = `${f.metric_key}:${f.period_label}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        groupKey:         key,
        metricKey:        f.metric_key,
        periodLabel:      f.period_label,
        realizedDeck:     [],
        realizedWorkbook: [],
        projected:        [],
      };
      groups.set(key, group);
    }

    if (isProjectedFact(f)) {
      group.projected.push(f);
    } else if (isDeckFact(f)) {
      group.realizedDeck.push(f);
    } else if (isWorkbookFact(f)) {
      group.realizedWorkbook.push(f);
    }
    // facts with source_kind="unknown" are intentionally excluded from cross-source comparison
  }

  return groups;
}

// ─── Group-level status derivation ───────────────────────────────────────────

/**
 * Derive the cross-source reconciliation status for one (metric_key, period_label) group.
 *
 * Rules (in priority order):
 *
 * 1. If there are realized deck facts AND realized workbook facts:
 *    Compare the best values (highest-confidence within each bucket).
 *    → "supported" if within tolerance
 *    → "conflicting" if outside tolerance
 *    → "unresolved" if values are zero or incomparable
 *
 * 2. If only realized deck facts exist (no workbook):
 *    → "deck_only"
 *
 * 3. If only realized workbook facts exist (no deck):
 *    → "workbook_only"
 *
 * 4. If no realized facts exist at all but projected facts do:
 *    → "projected_only"
 *
 * 5. Empty group or all unknown source kinds:
 *    → "unresolved"
 *
 * Scenario facts (temporal_scope = "scenario"):
 *    Scenario facts are treated as projected for the purposes of this function.
 *    They can only produce "projected_only" status at the group level.
 *    (Detailed scenario-vs-scenario matching is done at the sub-group level in
 *    the scenario section below.)
 */
function deriveGroupStatus(group: ReconciliationGroup): CrossSourceReconciliationStatus {
  const hasDeck     = group.realizedDeck.length > 0;
  const hasWorkbook = group.realizedWorkbook.length > 0;

  if (!hasDeck && !hasWorkbook) {
    // No realized data from any source
    if (group.projected.length > 0) return "projected_only";
    return "unresolved";
  }

  if (hasDeck && !hasWorkbook) return "deck_only";
  if (!hasDeck && hasWorkbook) return "workbook_only";

  // Both deck and workbook have realized facts: compare best values.
  const bestDeck     = pickBestFact(group.realizedDeck);
  const bestWorkbook = pickBestFact(group.realizedWorkbook);

  if (!isFiniteFactValue(bestDeck.value) || !isFiniteFactValue(bestWorkbook.value)) {
    return "unresolved";
  }
  if (bestDeck.value === 0 && bestWorkbook.value === 0) {
    // Both zero — technically "agree" but not meaningful; call it "supported"
    return "supported";
  }
  if (bestDeck.value === 0 || bestWorkbook.value === 0) {
    // One zero, one non-zero — almost certainly a data absence, not a claim
    return "unresolved";
  }

  return withinTolerance(bestDeck.value, bestWorkbook.value, group.metricKey)
    ? "supported"
    : "conflicting";
}

/**
 * Pick the most-representative fact from a bucket.
 * Preference: high confidence > medium > low; otherwise first wins.
 */
function pickBestFact(facts: FinancialFactV1[]): FinancialFactV1 {
  const ranked = [...facts].sort((a, b) => {
    const rankA = CONFIDENCE_RANK[a.confidence] ?? 0;
    const rankB = CONFIDENCE_RANK[b.confidence] ?? 0;
    return rankB - rankA;
  });
  return ranked[0]!;
}

const CONFIDENCE_RANK: Record<FinancialFactV1["confidence"], number> = {
  high:   3,
  medium: 2,
  low:    1,
};

// ─── Scenario sub-group matching ──────────────────────────────────────────────

/**
 * Within a group's projected bucket, find scenario facts that have BOTH a deck
 * and a workbook counterpart for the same scenario label, and determine their
 * agreement state.
 *
 * Returns a map of scenario_label → CrossSourceReconciliationStatus for facts
 * in this group.  Facts without a matching cross-source counterpart remain
 * "projected_only".
 */
function buildScenarioStatusMap(
  projected: FinancialFactV1[],
  metricKey: string,
): Map<string, CrossSourceReconciliationStatus> {
  const result = new Map<string, CrossSourceReconciliationStatus>();

  // Group projected by normalized scenario label (case-insensitive)
  const byScenario = new Map<string, { deck: FinancialFactV1[]; workbook: FinancialFactV1[] }>();
  for (const f of projected) {
    if (f.temporal_scope !== "scenario") continue;
    const label = (f.scenario ?? "").toLowerCase().trim() || "_no_label_";
    let bucket = byScenario.get(label);
    if (!bucket) { bucket = { deck: [], workbook: [] }; byScenario.set(label, bucket); }
    if (isDeckFact(f)) bucket.deck.push(f);
    else if (isWorkbookFact(f)) bucket.workbook.push(f);
  }

  for (const [label, bucket] of byScenario) {
    if (bucket.deck.length === 0 || bucket.workbook.length === 0) {
      result.set(label, "projected_only");
    } else {
      const bestDeck     = pickBestFact(bucket.deck);
      const bestWorkbook = pickBestFact(bucket.workbook);
      if (!isFiniteFactValue(bestDeck.value) || !isFiniteFactValue(bestWorkbook.value)) {
        result.set(label, "unresolved");
      } else if (bestDeck.value === 0 || bestWorkbook.value === 0) {
        result.set(label, "unresolved");
      } else {
        result.set(label,
          withinTolerance(bestDeck.value, bestWorkbook.value, metricKey)
            ? "supported"
            : "conflicting"
        );
      }
    }
  }

  return result;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Annotate a flat array of FinancialFactV1 with cross_source_status.
 *
 * Each fact is cloned with cross_source_status set.  The input array is not
 * mutated.  Fact identity (fact_id) is preserved.
 *
 * Facts with source_kind = "unknown" receive cross_source_status = "unresolved"
 * and are excluded from comparison groups.
 *
 * Algorithm:
 *  1. Group facts by (metric_key, period_label).
 *  2. For realized (historical|current|undefined) facts: derive status per group.
 *  3. For scenario facts: derive status per (group, scenario_label) sub-group.
 *  4. Clone each fact with the derived status.
 *
 * @param facts  All FinancialFactV1 for a single deal (all source kinds).
 * @returns      New array — same facts with cross_source_status populated.
 */
export function reconcileFinancialFacts(
  facts: FinancialFactV1[],
): FinancialFactV1[] {
  if (facts.length === 0) return facts;

  const groups = buildGroups(facts);

  // Build (groupKey → status) and (groupKey+scenario → status) maps
  // so we can annotate facts in a single pass.
  const groupStatusMap    = new Map<string, CrossSourceReconciliationStatus>();
  const scenarioStatusMap = new Map<string, CrossSourceReconciliationStatus>(); // key: "groupKey|scenarioLabel"

  for (const [key, group] of groups) {
    const status = deriveGroupStatus(group);
    groupStatusMap.set(key, status);

    // Build per-scenario statuses for projected/scenario facts
    if (group.projected.length > 0) {
      const sMap = buildScenarioStatusMap(group.projected, group.metricKey);
      for (const [scenarioLabel, sStatus] of sMap) {
        scenarioStatusMap.set(`${key}|${scenarioLabel}`, sStatus);
      }
    }
  }

  // Annotate each fact
  return facts.map((f): FinancialFactV1 => {
    const key = `${f.metric_key}:${f.period_label}`;

    if (f.source_kind === "unknown") {
      return { ...f, cross_source_status: "unresolved" };
    }

    if (isProjectedFact(f) && f.temporal_scope === "scenario") {
      const scenarioLabel = (f.scenario ?? "").toLowerCase().trim() || "_no_label_";
      const sKey = `${key}|${scenarioLabel}`;
      const sStatus = scenarioStatusMap.get(sKey);
      return { ...f, cross_source_status: sStatus ?? "projected_only" };
    }

    if (isProjectedFact(f)) {
      // Non-scenario projected / target facts always get "projected_only".
      // They represent forward-looking estimates, not realized performance
      // claims, and must never inherit "deck_only", "workbook_only",
      // "supported", or "conflicting" status that was derived from realized
      // sibling facts in the same (metric_key, period_label) group.
      return { ...f, cross_source_status: "projected_only" };
    }

    // Realized fact: use group-level status
    const gStatus = groupStatusMap.get(key);
    return { ...f, cross_source_status: gStatus ?? "unresolved" };
  });
}

// ─── Reconciliation summary ───────────────────────────────────────────────────

/**
 * Summary of cross-source reconciliation results for a deal.
 * Produced alongside the annotated facts for downstream reporting.
 */
export interface CrossSourceReconciliationSummary {
  schema_version: "cross_source_reconciliation_summary_v1";
  /** Total facts processed. */
  total_facts: number;
  /** Count per status. */
  counts: Record<CrossSourceReconciliationStatus, number>;
  /**
   * Metric slots that are "conflicting" — highest-priority items for review.
   * Each entry: { metric_key, period_label, deck_value, workbook_value }
   */
  conflicts: Array<{
    metric_key:    string;
    period_label:  string;
    deck_value:    number | null;
    workbook_value: number | null;
    variance_pct:  number | null;
  }>;
  /** Metric slots that are "supported" — corroborated by both sources. */
  supported_count: number;
  /** Metric slots that are "deck_only" or "workbook_only". */
  single_source_count: number;
}

/**
 * Build a summary report from a reconciled FinancialFactV1 array.
 * The input must already have cross_source_status populated
 * (i.e. have been through reconcileFinancialFacts()).
 */
export function buildReconciliationSummary(
  facts: FinancialFactV1[],
): CrossSourceReconciliationSummary {
  const counts: Record<CrossSourceReconciliationStatus, number> = {
    supported:       0,
    conflicting:     0,
    deck_only:       0,
    workbook_only:   0,
    projected_only:  0,
    unresolved:      0,
  };

  for (const f of facts) {
    if (f.cross_source_status) {
      counts[f.cross_source_status]++;
    }
  }

  // Build conflict details — one entry per conflicting group
  // Collect from realized deck + workbook facts that have cross_source_status = "conflicting"
  const conflictGroups = new Map<string, { deck: FinancialFactV1 | null; workbook: FinancialFactV1 | null }>();
  for (const f of facts) {
    if (f.cross_source_status !== "conflicting" || isProjectedFact(f)) continue;
    const key = `${f.metric_key}:${f.period_label}`;
    let entry = conflictGroups.get(key);
    if (!entry) { entry = { deck: null, workbook: null }; conflictGroups.set(key, entry); }
    if (isDeckFact(f) && !entry.deck) entry.deck = f;
    if (isWorkbookFact(f) && !entry.workbook) entry.workbook = f;
  }

  const conflicts = Array.from(conflictGroups.entries()).map(([key, entry]) => {
    const [metric_key, period_label] = key.split(":") as [string, string];
    const deckVal = entry.deck && isFiniteFactValue(entry.deck.value) ? entry.deck.value : null;
    const wbVal   = entry.workbook && isFiniteFactValue(entry.workbook.value) ? entry.workbook.value : null;
    let variance_pct: number | null = null;
    if (deckVal !== null && wbVal !== null && Math.max(Math.abs(deckVal), Math.abs(wbVal)) > 0) {
      variance_pct = parseFloat(
        (Math.abs(deckVal - wbVal) / Math.max(Math.abs(deckVal), Math.abs(wbVal)) * 100).toFixed(1)
      );
    }
    return { metric_key, period_label, deck_value: deckVal, workbook_value: wbVal, variance_pct };
  });

  return {
    schema_version: "cross_source_reconciliation_summary_v1",
    total_facts:        facts.length,
    counts,
    conflicts,
    supported_count:     counts.supported,
    single_source_count: counts.deck_only + counts.workbook_only,
  };
}
