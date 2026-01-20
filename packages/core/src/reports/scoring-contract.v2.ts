// v2 contract: "decision score" is derived from fundamentals only.
// Presentation/packaging analyzers remain available as diagnostics but do not affect `overall_score`.

export const SCORE_COMPONENT_KEYS_V2 = [
  "slide_sequence",
  "metric_benchmark",
  "visual_design",
  "narrative_arc",
  "financial_health",
  "risk_assessment",
] as const;

export type ScoreComponentKeyV2 = (typeof SCORE_COMPONENT_KEYS_V2)[number];

export const PRESENTATION_COMPONENT_KEYS_V2 = [
  "slide_sequence",
  "visual_design",
  "narrative_arc",
] as const satisfies readonly ScoreComponentKeyV2[];

export const FUNDAMENTALS_COMPONENT_KEYS_V2 = [
  "metric_benchmark",
  "financial_health",
  "risk_assessment",
] as const satisfies readonly ScoreComponentKeyV2[];

// Components that contribute to the numeric `overall_score` aggregation.
export const DECISION_SCORE_COMPONENT_KEYS_V2 = FUNDAMENTALS_COMPONENT_KEYS_V2;

export type DecisionScoreComponentKeyV2 = (typeof DECISION_SCORE_COMPONENT_KEYS_V2)[number];
