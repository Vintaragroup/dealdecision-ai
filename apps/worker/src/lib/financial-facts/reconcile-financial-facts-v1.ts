/**
 * reconcile-financial-facts-v1.ts
 *
 * Deterministic derivation of implied financial facts.
 *
 * Rules (Phase 1):
 * - Rule 1: If `cash` + `burn_rate` exist for overlapping periods AND no
 *   `runway_months` exists → derive runway_months = cash / burn_rate.
 * - Rule 2: If `revenue` + `gross_profit` exist for overlapping periods AND no
 *   `gross_margin` exists → derive gross_margin = gross_profit / revenue × 100.
 *   Semantics-gated: only when the semantics layer confirms canDeriveGrossMargin.
 * - Rule 3: If `total_expenses` exist AND no `burn_rate` exists AND semantics
 *   layer confirms hasOperatingModel → derive burn_rate from total_expenses run-rate
 *   (monthly direct; annual ÷ 12; quarterly ÷ 3).
 *   Semantics-gated: requires interpretFinancialSemantics().hasOperatingModel.
 *
 * Design rules:
 * - Never mutates input facts.
 * - Never overrides extracted values.
 * - Never hallucinated: only mathematical derivations with clear provenance.
 * - Returns original facts PLUS derived entries.
 * - All derived facts tagged with is_derived, derivation_rule, semantic_family,
 *   semantic_role for downstream auditability.
 * - Debug logging behind DEBUG_FINANCIAL_DERIVATION=1.
 */

import type { FinancialFactV1, FinancialFactConfidence } from "@dealdecision/core";
import { computeFactId } from "@dealdecision/core";
import { interpretFinancialSemantics } from "@dealdecision/core";

// ─── Internal helpers ─────────────────────────────────────────────────────────

const DEBUG = process.env["DEBUG_FINANCIAL_DERIVATION"] === "1";
function dbg(msg: string, data?: unknown): void {
  if (DEBUG) console.log(`[reconcile-v1] ${msg}`, data ?? "");
}

/**
 * Returns true when a fact represents a projected / estimated / scenario value.
 *
 * Projected facts should NOT be used as inputs for mathematical derivations
 * (e.g. runway from cash + burn) because the derived fact would silently
 * inherit projection uncertainty without marking it as such in the output.
 */
function isProjectedFact(f: FinancialFactV1): boolean {
  const scope = f.temporal_scope ?? "unknown";
  return scope === "projected" || scope === "scenario" || scope === "target";
}

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

    // ── Semantic gating — run ONCE, gates Rules 2 and 3 ───────────────────
    // interpretFinancialSemantics is pure/deterministic, zero side effects.
    const semantics = interpretFinancialSemantics({ facts: existing });
    dbg("semantics", {
      hasOperatingModel: semantics.hasOperatingModel,
      canDeriveGrossMargin: semantics.canDeriveGrossMargin,
      canDeriveBurnRate: semantics.canDeriveBurnRate,
    });

    // ── Rule 1: Derive runway_months from cash + burn_rate ─────────────────
    // This rule predates the semantics layer and is intentionally kept simple.
    const cashFacts   = factsForMetric(byKey, "cash");
    const burnFacts   = factsForMetric(byKey, "burn_rate");
    const runwayFacts = factsForMetric(byKey, "runway_months");

    for (const cashFact of cashFacts) {
      // Find a burn_rate for the same period
      const burnFact = burnFacts.find(
        (b) => b.period_label === cashFact.period_label,
      );
      if (!burnFact) continue;
      if (burnFact.value <= 0) continue;

      // Projection guard: do NOT derive runway from projected inputs.
      if (isProjectedFact(cashFact) || isProjectedFact(burnFact)) {
        dbg("Rule 1 skipped — projected input", cashFact.period_label);
        continue;
      }

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
        is_derived: true,
        derivation_rule: "runway_months_from_cash_and_burn_rate",
        semantic_family: "liquidity",
        semantic_role: "derived",
      };

      derived.push(derivedFact);
      dbg("Rule 1 derived runway_months", derivedFact.period_label);
    }

    // ── Rule 2: Derive gross_margin from revenue + gross_profit ────────────
    // Semantics-gated: only proceed if the semantics layer confirms it is safe.
    if (semantics.canDeriveGrossMargin) {
      const revFacts  = factsForMetric(byKey, "revenue");
      const gpFacts   = factsForMetric(byKey, "gross_profit");
      const gmFacts   = factsForMetric(byKey, "gross_margin");

      for (const revFact of revFacts) {
        if (isProjectedFact(revFact)) {
          dbg("Rule 2 skipped — projected revenue", revFact.period_label);
          continue;
        }
        if (revFact.value === 0) {
          dbg("Rule 2 skipped — zero revenue", revFact.period_label);
          continue;
        }
        if (revFact.confidence === "low") {
          dbg("Rule 2 skipped — low confidence revenue", revFact.period_label);
          continue;
        }

        const gpFact = gpFacts.find(
          (gp) => gp.period_label === revFact.period_label,
        );
        if (!gpFact) continue;
        if (isProjectedFact(gpFact)) {
          dbg("Rule 2 skipped — projected gross_profit", gpFact.period_label);
          continue;
        }
        if (gpFact.confidence === "low") {
          dbg("Rule 2 skipped — low confidence gross_profit", gpFact.period_label);
          continue;
        }

        // Don't derive if gross_margin already present for this period
        const alreadyHasGrossMargin = gmFacts.some(
          (gm) => gm.period_label === revFact.period_label,
        );
        if (alreadyHasGrossMargin) {
          dbg("Rule 2 skipped — explicit gross_margin exists", revFact.period_label);
          continue;
        }

        const gmPct = (gpFact.value / revFact.value) * 100;
        if (!Number.isFinite(gmPct)) continue;
        const gmRounded = Math.round(gmPct * 10) / 10; // 1 decimal place

        const source_pointer = `derived:gross_margin rev=${revFact.fact_id} gp=${gpFact.fact_id}`;
        const fact_id = computeFactId({
          deal_id: dealId,
          metric_key: "gross_margin",
          period_type: revFact.period_type,
          period_label: revFact.period_label,
          source_pointer,
        });

        if (existing.some((f) => f.fact_id === fact_id)) continue;

        // Derived facts are always medium confidence — derivation adds uncertainty
        // even when both inputs are high quality.
        const derivedConfidence: FinancialFactConfidence = "medium";

        const derivedFact: FinancialFactV1 = {
          fact_id,
          deal_id: dealId,
          document_id: revFact.document_id,
          source_kind: "unknown",
          metric_key: "gross_margin",
          metric_label: "Gross Margin (derived)",
          period_type: revFact.period_type,
          period_label: revFact.period_label,
          value: gmRounded,
          unit: "percent",
          confidence: derivedConfidence,
          reconciliation_status: "ok",
          source_pointer,
          excerpt: `Derived: gross_profit ${gpFact.value.toLocaleString()} / revenue ${revFact.value.toLocaleString()} = ${gmRounded}%`,
          is_derived: true,
          derivation_rule: "gross_margin_from_gross_profit_and_revenue",
          semantic_family: "profitability",
          semantic_role: "derived",
        };

        derived.push(derivedFact);
        dbg("Rule 2 derived gross_margin", { period: derivedFact.period_label, value: gmRounded });
      }
    } else {
      dbg("Rule 2 skipped — semantics gate: canDeriveGrossMargin=false");
    }

    // ── Rule 3: Derive burn_rate from total_expenses (or opex fallback) ────
    // Only when semantics confirm hasOperatingModel is true.
    // Conservative: monthly direct, annual ÷ 12, quarterly ÷ 3.
    // Do NOT derive if an explicit burn_rate already exists for the period.
    // Do NOT derive from projected facts (expense-based derivation is less direct).
    if (semantics.hasOperatingModel) {
      // Try total_expenses first; fall back to opex (same economic concept).
      const totalExpFacts = factsForMetric(byKey, "total_expenses");
      const opexFacts = totalExpFacts.length === 0 ? factsForMetric(byKey, "opex") : [];
      const expFacts = totalExpFacts.length > 0 ? totalExpFacts : opexFacts;
      const rule3MetricKey = totalExpFacts.length > 0 ? "total_expenses" : "opex";
      const existingBurnFacts = factsForMetric(byKey, "burn_rate");

      for (const expFact of expFacts) {
        if (isProjectedFact(expFact)) {
          dbg("Rule 3 skipped — projected expense fact", expFact.period_label);
          continue;
        }
        if (expFact.confidence === "low") {
          dbg("Rule 3 skipped — low confidence expense fact", expFact.period_label);
          continue;
        }
        if (expFact.value <= 0) continue;

        // Don't derive if burn_rate already present for this period
        const alreadyHasBurn = existingBurnFacts.some(
          (b) => b.period_label === expFact.period_label,
        );
        if (alreadyHasBurn) {
          dbg("Rule 3 skipped — explicit burn_rate exists", expFact.period_label);
          continue;
        }

        // Monthly → use directly
        // Annual  → ÷ 12
        // Quarterly → ÷ 3
        const period_type = expFact.period_type;
        let monthlyBurn: number;
        let ruleNote: string;

        if (period_type === "monthly") {
          monthlyBurn = expFact.value;
          ruleNote = "monthly direct";
        } else if (period_type === "annual") {
          monthlyBurn = expFact.value / 12;
          ruleNote = "annual ÷ 12";
        } else if (period_type === "quarterly") {
          monthlyBurn = expFact.value / 3;
          ruleNote = "quarterly ÷ 3";
        } else {
          // TTM or unknown — cannot safely normalize, skip
          dbg("Rule 3 skipped — cannot normalize period_type for burn proxy", period_type);
          continue;
        }

        if (!Number.isFinite(monthlyBurn) || monthlyBurn <= 0) continue;

        const burnRounded = Math.round(monthlyBurn);
        const derivationRule = rule3MetricKey === "opex"
          ? "burn_rate_from_opex_run_rate"
          : "burn_rate_from_total_expenses_run_rate";

        const source_pointer = `derived:burn_rate ${rule3MetricKey}=${expFact.fact_id} rule=${ruleNote}`;
        const fact_id = computeFactId({
          deal_id: dealId,
          metric_key: "burn_rate",
          period_type: "monthly",
          period_label: expFact.period_label,
          source_pointer,
        });

        if (existing.some((f) => f.fact_id === fact_id)) continue;

        const derivedFact: FinancialFactV1 = {
          fact_id,
          deal_id: dealId,
          document_id: expFact.document_id,
          source_kind: "structured_derived",
          metric_key: "burn_rate",
          metric_label: "Burn Rate (derived)",
          period_type: "monthly",
          period_label: expFact.period_label,
          value: burnRounded,
          unit: "currency",
          currency: expFact.currency ?? "USD",
          confidence: "medium",
          reconciliation_status: "ok",
          source_pointer,
          excerpt: `Derived burn_rate from ${rule3MetricKey} (${ruleNote}): $${burnRounded.toLocaleString()}/mo`,
          is_derived: true,
          derivation_rule: derivationRule,
          semantic_family: "liquidity",
          semantic_role: "derived",
        };

        derived.push(derivedFact);
        dbg("Rule 3 derived burn_rate", { period: derivedFact.period_label, value: burnRounded, ruleNote, source: rule3MetricKey });
      }
    } else {
      dbg("Rule 3 skipped — semantics gate: hasOperatingModel=false");
    }

    // ── Rule 4: Derive burn_rate from cash_outflow_operating ──────────────
    // Cash outflow IS the actual spend — derived from a direct measurement,
    // not a behavioral estimate. Therefore we do NOT skip projected facts here
    // (unlike Rules 1+3). Confidence is set to "low" to signal the derivation.
    //
    // Period normalization:
    //   monthly → ÷1, quarterly → ÷3, annual → ÷12
    //   unknown + label matches /^Year\s+\d+$/i → treat as quarterly ÷3
    //     (ordinal fiscal quarters common in XLSX projection models)
    //   all other unknown → skip
    //
    // Rule 1 (cash + burn_rate → runway_months) then auto-chains off the derived fact.
    {
      const cashOutFacts = factsForMetric(byKey, "cash_outflow_operating");
      const existingBurnFacts = factsForMetric(byKey, "burn_rate");

      for (const coFact of cashOutFacts) {
        if (coFact.confidence === "low") {
          dbg("Rule 4 skipped — low confidence cash_outflow_operating", coFact.period_label);
          continue;
        }
        if (coFact.value <= 0) continue;

        // Don't derive if burn_rate already present for this period
        const alreadyHasBurn = existingBurnFacts.some(
          (b) => b.period_label === coFact.period_label,
        );
        if (alreadyHasBurn) {
          dbg("Rule 4 skipped — explicit burn_rate exists", coFact.period_label);
          continue;
        }

        const period_type = coFact.period_type;
        let monthlyBurn: number;
        let ruleNote: string;

        if (period_type === "monthly") {
          monthlyBurn = coFact.value;
          ruleNote = "monthly direct";
        } else if (period_type === "quarterly") {
          monthlyBurn = coFact.value / 3;
          ruleNote = "quarterly ÷ 3";
        } else if (period_type === "annual") {
          monthlyBurn = coFact.value / 12;
          ruleNote = "annual ÷ 12";
        } else if (/^Year\s+\d+$/i.test(coFact.period_label.trim())) {
          // Ordinal fiscal quarter label ("Year N") common in XLSX models — treat as quarterly.
          monthlyBurn = coFact.value / 3;
          ruleNote = "ordinal-quarter ÷ 3";
        } else {
          dbg("Rule 4 skipped — cannot normalize period_type for cash outflow", { period_type, period_label: coFact.period_label });
          continue;
        }

        if (!Number.isFinite(monthlyBurn) || monthlyBurn <= 0) continue;

        const burnRounded = Math.round(monthlyBurn);

        const source_pointer = `derived:burn_rate cash_outflow=${coFact.fact_id} rule=${ruleNote}`;
        const fact_id = computeFactId({
          deal_id: dealId,
          metric_key: "burn_rate",
          period_type: "monthly",
          period_label: coFact.period_label,
          source_pointer,
        });

        if (existing.some((f) => f.fact_id === fact_id) || derived.some((f) => f.fact_id === fact_id)) continue;

        const derivedFact: FinancialFactV1 = {
          fact_id,
          deal_id: dealId,
          document_id: coFact.document_id,
          source_kind: "structured_derived",
          metric_key: "burn_rate",
          metric_label: "Burn Rate (derived from cash outflow)",
          period_type: "monthly",
          period_label: coFact.period_label,
          value: burnRounded,
          unit: "currency",
          currency: coFact.currency ?? "USD",
          confidence: "low",
          reconciliation_status: "ok",
          source_pointer,
          excerpt: `Derived burn_rate from cash_outflow_operating (${ruleNote}): $${burnRounded.toLocaleString()}/mo`,
          is_derived: true,
          derivation_rule: "burn_rate_from_cash_outflow_operating",
          semantic_family: "liquidity",
          semantic_role: "derived",
        };

        derived.push(derivedFact);
        // Re-index derived facts so downstream rules can query burn_rate in byKey.
        const burnKey = `burn_rate:${derivedFact.period_label}`;
        const burnArr = byKey.get(burnKey);
        if (burnArr) burnArr.push(derivedFact); else byKey.set(burnKey, [derivedFact]);
        dbg("Rule 4 derived burn_rate", { period: derivedFact.period_label, value: burnRounded, ruleNote });

        // ── Rule 4b: also derive runway_months if cash exists for same period ──
        // Rule 1 runs before Rule 4 and carries a projection guard, so we must chain
        // runway derivation here where projected inputs are permitted.
        const cashForPeriod = factsForMetric(byKey, "cash").filter(
          (c) => c.period_label === coFact.period_label && c.value > 0,
        );
        const runwayAlreadyPresent = factsForMetric(byKey, "runway_months").some(
          (r) => r.period_label === coFact.period_label,
        ) || derived.some(
          (d) => d.metric_key === "runway_months" && d.period_label === coFact.period_label,
        );

        if (!runwayAlreadyPresent && cashForPeriod.length > 0) {
          const cashFact = cashForPeriod[0];
          const runwayValue = cashFact.value / burnRounded;
          if (Number.isFinite(runwayValue) && runwayValue > 0) {
            const runway_source_pointer = `derived:runway cash=${cashFact.fact_id} burn=${derivedFact.fact_id}`;
            const runway_fact_id = computeFactId({
              deal_id: dealId,
              metric_key: "runway_months",
              period_type: derivedFact.period_type,
              period_label: coFact.period_label,
              source_pointer: runway_source_pointer,
            });

            if (!existing.some((f) => f.fact_id === runway_fact_id) && !derived.some((f) => f.fact_id === runway_fact_id)) {
              const runwayFact: FinancialFactV1 = {
                fact_id: runway_fact_id,
                deal_id: dealId,
                document_id: cashFact.document_id,
                source_kind: "unknown",
                metric_key: "runway_months",
                metric_label: "Runway (derived from cash outflow)",
                period_type: derivedFact.period_type,
                period_label: coFact.period_label,
                value: Math.round(runwayValue * 10) / 10,
                unit: "number",
                confidence: "low",
                reconciliation_status: "ok",
                source_pointer: runway_source_pointer,
                excerpt: `Derived: cash $${cashFact.value.toLocaleString()} / burn $${burnRounded.toLocaleString()}/mo`,
                is_derived: true,
                derivation_rule: "runway_months_from_cash_and_outflow",
                semantic_family: "liquidity",
                semantic_role: "derived",
              };
              derived.push(runwayFact);
              dbg("Rule 4b derived runway_months", { period: coFact.period_label, value: runwayFact.value });
            }
          }
        }
      }
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

