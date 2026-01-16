import type { FundabilityAssessmentV1, FundabilityDecisionV1, PhaseInferenceV1 } from "../../types/dio.js";

import { getPhaseRequirementsV1, type SignalKey } from "./phase-inference.js";

function isSupportedSignal(e: PhaseInferenceV1["supporting_evidence"][number]): e is {
  signal: string;
} {
  return !!e && typeof e === "object" && typeof (e as any).signal === "string";
}

export function buildFundabilityDecisionV1(params: {
  phase_inference: PhaseInferenceV1;
  assessment: FundabilityAssessmentV1;
}): FundabilityDecisionV1 {
  const supportedSignals = new Set(
    (params.phase_inference.supporting_evidence || [])
      .filter(isSupportedSignal)
      .map((e) => e.signal)
      .filter(Boolean)
  );

  const inferredPhase = params.phase_inference.company_phase;
  const missing_required_signals = getPhaseRequirementsV1(inferredPhase).filter(
    (s) => !supportedSignals.has(s)
  ) as SignalKey[];

  const next_requests: string[] = [];

  if (params.assessment.outcome !== "PASS") {
    for (const m of missing_required_signals) {
      next_requests.push(`provide_evidence:${m}`);
    }

    if (params.assessment.reasons.some((r) => r.startsWith("low_phase_confidence:"))) {
      next_requests.push("increase_phase_confidence");
    }

    if (params.assessment.reasons.includes("live_product_but_no_traction")) {
      next_requests.push("show_traction_metrics");
    }

    if (params.assessment.outcome === "FAIL") {
      const downgraded = params.assessment.fundable_at_phase_if_downgraded;
      if (typeof downgraded === "string" && downgraded.length > 0) {
        next_requests.push(`reassess_phase:${downgraded}`);
      }
    }
  }

  return {
    outcome: params.assessment.outcome,
    should_block_investment: params.assessment.outcome === "FAIL",
    missing_required_signals,
    next_requests,
  };
}
