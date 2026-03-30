export type DeepDiveClassificationConfidenceV1 = "strong" | "moderate" | "weak" | "unknown";

export interface DeepDiveTaxonomyCandidateV1 {
  code: string;
  title: string;
  confidence: Exclude<DeepDiveClassificationConfidenceV1, "unknown">;
}

export interface DeepDiveClassificationEnrichmentV1 {
  inferredLabel: string;
  inferredDescription?: string;
  naicsCandidates: DeepDiveTaxonomyCandidateV1[];
  sicCandidates: DeepDiveTaxonomyCandidateV1[];
  classificationConfidence: DeepDiveClassificationConfidenceV1;
  isHybrid: boolean;
  classificationConflict: boolean;
  conflictReason?: string;
  bestFitLabel?: string;
  industryExpectations?: string[];
}
