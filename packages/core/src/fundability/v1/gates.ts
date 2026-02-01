import type {
  DealIntelligenceObject,
  CompanyPhase,
  PhaseInferenceV1,
  FundabilityAssessmentV1,
  FundabilityGateOutcome,
} from "../../types/dio.js";

import { getPhaseRequirementsV1, type SignalKey } from "./phase-inference.js";

const PHASE_ORDER_HIGH_TO_LOW: CompanyPhase[] = [
  "SERIES_B",
  "SERIES_A",
  "SEED_PLUS",
  "SEED",
  "PRE_SEED",
  "IDEA",
];

function phaseIndex(phase: CompanyPhase): number {
  return PHASE_ORDER_HIGH_TO_LOW.indexOf(phase);
}

function evaluateAtPhase(params: {
  dio: DealIntelligenceObject;
  phase: CompanyPhase;
  phase_inference: PhaseInferenceV1;
}): { outcome: FundabilityGateOutcome; missing: SignalKey[]; reasons: string[] } {
  const reqs = getPhaseRequirementsV1(params.phase);

  // We trust phase_inference.missing_evidence only for the inferred phase; recompute for other phases using rationale text.
  // For v1, required signals are represented by their keys; we approximate presence by checking if the key appears in
  // supporting evidence signals.
  const supportedSignals = new Set(
    (params.phase_inference.supporting_evidence || [])
      .map((e) => (typeof e?.signal === "string" ? e.signal : ""))
      .filter(Boolean)
  );

  const missing = reqs.filter((r) => !supportedSignals.has(r));

  // Special case from spec: seed-level fail if live product but no traction.
  if (params.phase === "SEED") {
    const hasLive = supportedSignals.has("live_product");
    const hasTraction = supportedSignals.has("customers_or_users") || supportedSignals.has("revenue_or_strong_usage");
    if (hasLive && !hasTraction) {
      return {
        outcome: "FAIL",
        missing,
        reasons: ["live_product_but_no_traction"],
      };
    }
  }

  let outcome: FundabilityGateOutcome;
  if (missing.length === 0) outcome = "PASS";
  else if (missing.length === 1) outcome = "CONDITIONAL";
  else outcome = "FAIL";

  const reasons = missing.map((m) => `missing:${m}`);

  return { outcome, missing, reasons };
}

export function evaluateFundabilityGatesV1(params: {
  dio: DealIntelligenceObject;
  phase_inference: PhaseInferenceV1;
}): FundabilityAssessmentV1 {
  const inferred = params.phase_inference.company_phase;

  const base = evaluateAtPhase({
    dio: params.dio,
    phase: inferred,
    phase_inference: params.phase_inference,
  });

  let outcome: FundabilityGateOutcome = base.outcome;
  const reasons: string[] = [...base.reasons];
  let caps: FundabilityAssessmentV1["caps"] | undefined;
  let fundable_at_phase_if_downgraded: CompanyPhase | undefined;

  // Soft gate (v1 addendum): low confidence => CONDITIONAL (request more evidence) not FAIL.
  if (params.phase_inference.confidence < 0.65) {
    outcome = "CONDITIONAL";
    reasons.unshift(`low_phase_confidence:${params.phase_inference.confidence.toFixed(2)}`);
    caps = { max_fundability_score_0_100: 60 };
  }

  // Phase 2 (soft caps): when missing required evidence yields CONDITIONAL, cap fundability score.
  // Cap value is intentionally conservative and deterministic; can be tuned via future MINOR spec revisions.
  if (outcome === "CONDITIONAL" && !caps) {
    caps = { max_fundability_score_0_100: 75 };
    reasons.push("score_cap_applied:missing_required_evidence");
  }

  // Optional guidance-only fallback (v1 addendum): if it FAILs at inferred phase, show nearest downgrade that clears.
  if (outcome === "FAIL") {
    const startIdx = phaseIndex(inferred);
    for (let i = startIdx + 1; i < PHASE_ORDER_HIGH_TO_LOW.length; i++) {
      const candidate = PHASE_ORDER_HIGH_TO_LOW[i];
      const evaluated = evaluateAtPhase({
        dio: params.dio,
        phase: candidate,
        phase_inference: params.phase_inference,
      });
      if (evaluated.outcome !== "FAIL") {
        fundable_at_phase_if_downgraded = candidate;
        reasons.push(`fundable_at_phase_if_downgraded:${candidate}`);
        break;
      }
    }
  }

  return {
    outcome,
    reasons,
    caps,
    fundable_at_phase_if_downgraded,
  };
}
