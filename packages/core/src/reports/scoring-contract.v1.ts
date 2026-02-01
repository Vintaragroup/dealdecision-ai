export const SCORE_COMPONENT_KEYS_V1 = [
  "slide_sequence",
  "metric_benchmark",
  "visual_design",
  "narrative_arc",
  "financial_health",
  "risk_assessment",
] as const;

export type ScoreComponentKeyV1 = (typeof SCORE_COMPONENT_KEYS_V1)[number];

// Components that currently affect the numeric `overall_score` in ScoreExplanation.
// This is the authoritative list for score aggregation.
export const DECISION_SCORE_COMPONENT_KEYS_V1 = SCORE_COMPONENT_KEYS_V1;

// Components that are presentation/packaging quality signals.
// These may be moved to non-decision diagnostics in a future contract revision.
export const PRESENTATION_COMPONENT_KEYS_V1 = [
  "slide_sequence",
  "visual_design",
  "narrative_arc",
] as const satisfies readonly ScoreComponentKeyV1[];

// Components that represent business fundamentals.
export const FUNDAMENTALS_COMPONENT_KEYS_V1 = [
  "metric_benchmark",
  "financial_health",
  "risk_assessment",
] as const satisfies readonly ScoreComponentKeyV1[];
