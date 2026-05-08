export type InvestmentInterpretationSectionId =
  | 'product'
  | 'market'
  | 'business_model'
  | 'raise_terms';

export type SectionEvidenceFit = 'strong' | 'partial' | 'weak' | 'invalid';

export type SectionEvidenceContaminationFlag =
  | 'ocr_noise'
  | 'biography_text'
  | 'team_background'
  | 'unrelated_person_credential'
  | 'wrong_section'
  | 'generic_jargon'
  | 'malformed_text'
  | 'financial_amount_without_context'
  | 'unsupported_business_model_label'
  | 'insufficient_clean_evidence';

export type SectionEvidenceHygieneV1 = {
  section_id: InvestmentInterpretationSectionId;
  raw_text: string | null;
  source_field: string;
  evidence_refs: string[];
  section_fit: SectionEvidenceFit;
  contamination_flags: SectionEvidenceContaminationFlag[];
  clean_text: string | null;
  reason: string;
  confidence: number;
};

export type InvestmentInterpretationConfidence = 'high' | 'medium' | 'low' | 'none';

export type InvestmentInterpretationSourceQuality =
  | 'verified'
  | 'directional'
  | 'unverified'
  | 'conflicted';

export type InvestmentInterpretationStatus = 'shadow_only' | 'validated' | 'rejected';

export type InvestmentInterpretationSectionV1 = {
  section_id: InvestmentInterpretationSectionId;
  observation: string;
  interpretation: string;
  supporting_evidence: string[];
  limitations: string[];
  investment_implication: string;
  confidence: InvestmentInterpretationConfidence;
  evidence_refs: string[];
  source_quality: InvestmentInterpretationSourceQuality;
  warnings: string[];
  section_hygiene?: SectionEvidenceHygieneV1 | null;
};

export type InvestmentInterpretationV1 = {
  schema_version: 'investment_interpretation_v1';
  deal_id: string;
  report_id: string | null;
  run_id: string | null;
  created_at: string;
  status: InvestmentInterpretationStatus;
  synthesizer_version?: string | null;
  sections: InvestmentInterpretationSectionV1[];
  synthesis_warnings?: string[];
};