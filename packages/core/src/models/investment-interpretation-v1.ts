export type InvestmentInterpretationSectionId =
  | 'product'
  | 'market'
  | 'business_model'
  | 'raise_terms';

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
};