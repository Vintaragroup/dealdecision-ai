export type NarrativeQualityCheckResult = 'pass' | 'fail' | 'warning';

export type NarrativeQualityValidationStatus = 'passed' | 'failed' | 'needs_review';

export type NarrativeQualityValidationV1 = {
  schema_version: 'narrative_quality_validation_v1';
  deal_id: string;
  run_id: string | null;
  created_at: string;
  specificity_check: NarrativeQualityCheckResult;
  evidence_grounding_check: NarrativeQualityCheckResult;
  jargon_check: NarrativeQualityCheckResult;
  score_narration_check: NarrativeQualityCheckResult;
  investment_implication_check: NarrativeQualityCheckResult;
  limitation_presence_check: NarrativeQualityCheckResult;
  unsupported_claim_check: NarrativeQualityCheckResult;
  section_fit_check: NarrativeQualityCheckResult;
  contamination_check: NarrativeQualityCheckResult;
  archetype_consistency_check: NarrativeQualityCheckResult;
  generic_language_warnings: string[];
  critical_warnings: string[];
  recommended_edits: string[];
  status: NarrativeQualityValidationStatus;
};