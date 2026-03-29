export type ConvictionInputStatusV1 = "confirmed" | "probable" | "contradicted" | "unknown";

export type ConvictionInputFamilyKeyV1 =
  | "financial_truth"
  | "capital_structure"
  | "traction_validation"
  | "market_demand"
  | "product_or_asset_quality"
  | "team_execution"
  | "risk_dependencies"
  | "external_corroboration"
  | "evidence_quality"
  | "coverage"
  | "contradictions";

export type ConvictionInputFamilyV1 = {
  family: ConvictionInputFamilyKeyV1;
  status: ConvictionInputStatusV1;
  signal_strength: number;
  confidence: number;
  coverage: number;
  source: string;
  source_priority: number;
  evidence_refs: string[];
  notes: string[];
};

export type ConvictionInputsV1 = Record<ConvictionInputFamilyKeyV1, ConvictionInputFamilyV1>;

export type ConvictionContributorV1 = {
  key: string;
  label: string;
  score_delta_0_100: number;
  evidence_refs: string[];
  notes?: string[];
};

export type ConvictionUnknownV1 = {
  code: string;
  text: string;
  evidence_refs: string[];
};

export type ConvictionContradictionV1 = {
  code: string;
  text: string;
  severity: "low" | "medium" | "high";
  evidence_refs: string[];
  source: string;
};

export type ConvictionRequiredCheckV1 = {
  text: string;
  expected_direction: "increase" | "decrease" | "clarify";
  evidence_refs: string[];
};

export type ConvictionLineageArtifactV1 = {
  artifact: string;
  path: string;
  used: boolean;
  note?: string;
};

export type ConvictionLineageV1 = {
  generated_at: string;
  mapping_version: "phase1_transitional_v1" | "phase2_deterministic_v1";
  source_artifacts: ConvictionLineageArtifactV1[];
};

export type ConvictionV1 = {
  schema_version: "conviction_v1";
  selected_policy_id: string | null;
  conviction_score_0_100: number;
  conviction_band: string;
  recommendation_posture: string;
  confidence_0_1: number;
  coverage_ratio_0_1: number;
  contradiction_index_0_1: number;
  inputs: ConvictionInputsV1;
  summary: {
    headline: string;
    rationale: string;
    provisional: boolean;
    notes: string[];
  };
  top_positive_contributors: ConvictionContributorV1[];
  top_negative_contributors: ConvictionContributorV1[];
  unknowns: ConvictionUnknownV1[];
  contradictions: ConvictionContradictionV1[];
  required_next_checks: ConvictionRequiredCheckV1[];
  lineage: ConvictionLineageV1;
};
