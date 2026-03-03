/**
 * reconcile-financial-facts-v1.ts
 *
 * Deterministic derivation of implied financial facts.
 *
 * Rules:
 * - Rule 1: If `cash` + `burn_rate` exist for overlapping periods AND no
 *   `runway_months` exists → add computed runway_months = cash / burn_rate.
 * - Never mutates input facts.
 * - Never overrides extracted values.
 * - Never hallucinated: only mathematical derivations with clear provenance.
 * - Returns original facts PLUS derived entries.
 */

import type { FinancialFactV1 } from "@dealdecision/core";
import { computeFactId } from "@dealdecision/core";

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Reconcile a set of FinancialFactV1 entries, appending derived facts.
 *
 * @param facts  Existing facts from all sources.
 * @param dealId deal_id for derived fact provenance.
 * @returns      Original facts + any derived facts. Original facts never mutated.
 */
export function reconcileFinancialFactsV1(
  facts: FinancialFactV1[],
  dealId: string,
): FinancialFactV1[] {
  if (!Array.isArray(facts) || facts.length < 2) return facts;

  try {
    const derived: FinancialFactV1[] = [];
    const existing = [...facts];

    // Group by metric_key + period_label for fast lookup
    const byKey = groupByMetricPeriod(existing);

    // ── Rule 1: Derive runway_months from cash + burn_rate ──────────────────
    const cashFacts  = factsForMetric(byKey, "cash");
    const burnFacts  = factsForMetric(byKey, "burn_rate");
    const runwayFacts = factsForMetric(byKey, "runway_months");

    for (const cashFact of cashFacts) {
      // Find a burn_rate for the same period
      const burnFact = burnFacts.find(
        (b) => b.period_label === cashFact.period_label,
      );
      if (!burnFact) continue;
      if (burnFact.value <= 0) continue;

      // Don't derive if runway already present for this period
      const alreadyHasRunway = runwayFacts.some(
        (r) => r.period_label === cashFact.period_label,
      );
      if (alreadyHasRunway) continue;

      const runwayValue = cashFact.value / burnFact.value;
      if (!Number.isFinite(runwayValue) || runwayValue <= 0) continue;

      const source_pointer = `derived:cash+burn cash=${cashFact.fact_id} burn=${burnFact.fact_id}`;
      const fact_id = computeFactId({
        deal_id: dealId,
        metric_key: "runway_months",
        period_type: cashFact.period_type,
        period_label: cashFact.period_label,
        source_pointer,
      });

      // Skip if we already derived this exact fact_id (idempotent)
      if (existing.some((f) => f.fact_id === fact_id)) continue;

      const derivedFact: FinancialFactV1 = {
        fact_id,
        deal_id: dealId,
        document_id: cashFact.document_id,
        source_kind: "unknown",
        metric_key: "runway_months",
        metric_label: "Runway (derived)",
        period_type: cashFact.period_type,
        period_label: cashFact.period_label,
        value: Math.round(runwayValue * 10) / 10, // 1 decimal place
        unit: "number",
        confidence: "medium",
        reconciliation_status: "ok",
        source_pointer,
        excerpt: `Derived: cash $${cashFact.value.toLocaleString()} / burn $${burnFact.value.toLocaleString()}/mo`,
      };

      derived.push(derivedFact);
    }

    return derived.length > 0 ? [...existing, ...derived] : existing;
  } catch {
    return facts;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function groupByMetricPeriod(
  facts: FinancialFactV1[],
): Map<string, FinancialFactV1[]> {
  const map = new Map<string, FinancialFactV1[]>();
  for (const f of facts) {
    const key = `${f.metric_key}:${f.period_label}`;
    const arr = map.get(key);
    if (arr) {
      arr.push(f);
    } else {
      map.set(key, [f]);
    }
  }
  return map;
}

function factsForMetric(
  map: Map<string, FinancialFactV1[]>,
  metric_key: string,
): FinancialFactV1[] {
  const result: FinancialFactV1[] = [];
  for (const [key, facts] of map.entries()) {
    if (key.startsWith(`${metric_key}:`)) {
      result.push(...facts);
    }
  }
  return result;
}
