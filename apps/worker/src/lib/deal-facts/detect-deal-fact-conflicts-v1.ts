/**
 * detect-deal-fact-conflicts-v1.ts
 *
 * Conflict detection pass for DealFactV1 entries.
 *
 * Runs after buildDealFactRegistryV1. Mutates conflicts_with_fact_ids
 * on facts that have conflicting values for the same observable assertion.
 *
 * Detects conflicts only for:
 *   - raise_amount
 *   - valuation
 *   - round_stage (distinct string values)
 *   - traction_metric (same label, different values)
 *
 * Does NOT delete facts — just links them. Chat/API honesty layer reads this.
 *
 * Never throws.
 */

import type { DealFactV1, DealFactValueV1 } from "@dealdecision/core";

// ─── Types subject to conflict detection ─────────────────────────────────────

const CONFLICTABLE_TYPES = new Set([
  "raise_amount",
  "valuation",
  "round_stage",
  "traction_metric",
]);

// ─── Value normalisation for comparison ──────────────────────────────────────

/**
 * Return a stable, comparable representation of a value for conflict detection.
 * Returns undefined if the value can't be compared (e.g. lists, unknown).
 */
function normalizeForCompare(value: DealFactValueV1): string | undefined {
  switch (value.kind) {
    case "money":
      // Round to nearest 1000 to avoid float noise between $1.99M vs $2M
      return `money:${Math.round(value.value / 1000) * 1000}:${value.currency}`;
    case "number":
      return `number:${Math.round(value.value * 100) / 100}:${value.unit ?? ""}`;
    case "string":
      return `string:${value.value.toLowerCase().trim()}`;
    case "entity":
      return `entity:${value.value.toLowerCase().trim()}`;
    default:
      return undefined;
  }
}

/**
 * Group key: type + label (normalized) + timeframe bucket.
 * For traction_metric, label distinguishes ARR from MRR etc.
 */
function groupKey(fact: DealFactV1): string {
  const baseLabel = fact.label
    .toLowerCase()
    .trim()
    // Strip numeric year suffix from traction labels for grouping — e.g. "ARR (2025)" → "ARR"
    .replace(/\s*\([^)]*\)$/, "")
    .trim();
  // For traction_metric include timeframe in group key IF it canonically matches another fact's
  // timeframe (meaning: same label + same timeframe + different value = conflict)
  const tfKey = fact.timeframe ? fact.timeframe.toLowerCase().trim() : "__any__";
  return `${fact.type}::${baseLabel}::${tfKey}`;
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Run conflict detection over a set of DealFactV1 facts.
 *
 * Returns a new array with `conflicts_with_fact_ids` populated where applicable.
 * Facts not involved in any conflict are returned unchanged.
 *
 * Complexity: O(n) per type group.
 */
export function detectDealFactConflictsV1(facts: DealFactV1[]): DealFactV1[] {
  try {
    // Bucket facts by group key (only for conflictable types)
    const groups = new Map<string, DealFactV1[]>();

    for (const fact of facts) {
      if (!CONFLICTABLE_TYPES.has(fact.type)) continue;
      const key = groupKey(fact);
      const bucket = groups.get(key) ?? [];
      bucket.push(fact);
      groups.set(key, bucket);
    }

    // Build conflict map: fact_id → Set<conflicting_fact_ids>
    const conflictMap = new Map<string, Set<string>>();

    for (const [, bucket] of groups) {
      if (bucket.length < 2) continue;

      // Compute normalized comparable value for each fact in bucket
      const normalized = bucket.map((f) => normalizeForCompare(f.value));

      // Check if any two facts have different normalized values
      const distinctValues = new Set(normalized.filter((v): v is string => v !== undefined));
      if (distinctValues.size < 2) continue;

      // They conflict — link all against all within this group
      for (let i = 0; i < bucket.length; i++) {
        for (let j = 0; j < bucket.length; j++) {
          if (i === j) continue;
          const a = bucket[i]!;
          const b = bucket[j]!;
          // Only mark as conflict if their normalized values actually differ
          const va = normalized[i];
          const vb = normalized[j];
          if (va === undefined || vb === undefined) continue;
          if (va === vb) continue;

          const set = conflictMap.get(a.fact_id) ?? new Set();
          set.add(b.fact_id);
          conflictMap.set(a.fact_id, set);
        }
      }
    }

    if (conflictMap.size === 0) return facts;

    // Apply conflict links to a new array (immutable update)
    return facts.map((fact) => {
      const conflicts = conflictMap.get(fact.fact_id);
      if (!conflicts || conflicts.size === 0) return fact;

      const existing = new Set(fact.conflicts_with_fact_ids ?? []);
      for (const id of conflicts) existing.add(id);

      return {
        ...fact,
        conflicts_with_fact_ids: Array.from(existing),
      };
    });
  } catch {
    // Never break the pipeline — return original facts unchanged
    return facts;
  }
}
