/**
 * Unified Risk Severity Score (URSS)
 *
 * Authoritative spec: docs/Active/orchestractor/DDAI_CORE_SCORING_MODEL_v1.md §B
 *
 * Range: 0–100. Higher is WORSE.
 * Deterministic. No LLM.
 */

// ─── Primitives ──────────────────────────────────────────────────────────────

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

function pct(x01: number): number {
  return clamp(Math.round(x01 * 100), 0, 100);
}

function countPenalty(count: number, per: number, cap: number): number {
  return clamp(count * per, 0, cap);
}

// ─── High-value conflict fields ──────────────────────────────────────────────

/** Fields whose conflict escalates Consistency severity by +12. */
const HIGH_VALUE_CONFLICT_FIELDS = new Set([
  "raise_amount",
  "valuation_pre",
  "valuation_post",
  "arr_value",
  "revenue_latest",
  "burn_monthly",
]);

// ─── Input types ─────────────────────────────────────────────────────────────

export interface UrssConflict {
  field: string;
}

export interface UrssGateResult {
  passed: boolean;
}

export interface UrssInputs {
  /** Field names that are critical but absent from this deal. */
  missing_critical_terms: string[];
  conflicts: UrssConflict[];
  /** DCI score (0–100). */
  dci: number;
  /** financial_reconciliation_v1.confidence_score (0–1), or null if absent. */
  reconciliation_confidence_score: number | null;
  gate_results: UrssGateResult[];
}

export interface UrssResult {
  score: number;
  band: "Low" | "Medium" | "High" | "Critical";
  components: {
    transparency: number;
    consistency: number;
    coverage: number;
    financial_reliability: number;
    gate: number;
  };
}

// ─── Component computations ──────────────────────────────────────────────────

/** T — Transparency severity (missing critical terms). */
function computeT(missingTerms: string[]): number {
  const count = missingTerms.length;
  if (count === 0) return 0;
  return clamp(20 + countPenalty(count, 8, 40), 0, 60);
}

/** C — Consistency severity (cross-source conflicts). */
function computeC(conflicts: UrssConflict[]): number {
  const count = conflicts.length;
  let c = clamp(countPenalty(count, 12, 48), 0, 48);
  // Escalate if any conflict is in a high-value field
  const hasHighValue = conflicts.some((cf) => HIGH_VALUE_CONFLICT_FIELDS.has(cf.field));
  if (hasHighValue) c += 12;
  return clamp(c, 0, 60);
}

/** CV — Coverage severity (low DCI). */
function computeCV(dci: number): number {
  // No penalty when DCI >= 70
  return clamp(Math.round((70 - dci) * 1.2), 0, 60);
}

/** F — Financial reliability severity. */
function computeF(reconciliationConfidenceScore: number | null): number {
  let f: number;
  if (reconciliationConfidenceScore !== null) {
    const rc = pct(reconciliationConfidenceScore);
    f = clamp(Math.round((60 - rc) * 1.3), 0, 70);
  } else {
    f = 25; // unknown — moderate default
  }
  return clamp(f, 0, 80);
}

/** G — Gate severity. */
function computeG(gateResults: UrssGateResult[]): number {
  const gatesFailed = gateResults.filter((r) => !r.passed).length;
  return clamp(gatesFailed * 12, 0, 60);
}

function urssBand(score: number): UrssResult["band"] {
  if (score <= 24) return "Low";
  if (score <= 49) return "Medium";
  if (score <= 74) return "High";
  return "Critical";
}

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * Compute the Unified Risk Severity Score.
 *
 * URSS = clamp(round(0.30*T + 0.25*C + 0.20*CV + 0.15*F + 0.10*G), 0, 100)
 */
export function computeUnifiedRiskSeverity(inputs: UrssInputs): UrssResult {
  const t  = computeT(inputs.missing_critical_terms);
  const c  = computeC(inputs.conflicts);
  const cv = computeCV(inputs.dci);
  const f  = computeF(inputs.reconciliation_confidence_score);
  const g  = computeG(inputs.gate_results);

  const score = clamp(
    Math.round(0.30 * t + 0.25 * c + 0.20 * cv + 0.15 * f + 0.10 * g),
    0,
    100
  );

  return {
    score,
    band: urssBand(score),
    components: {
      transparency: t,
      consistency: c,
      coverage: cv,
      financial_reliability: f,
      gate: g,
    },
  };
}
