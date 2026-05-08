import type {
  InvestmentInterpretationV1,
  NarrativeQualityValidationV1,
  NarrativeQualityCheckResult,
  NarrativeQualityValidationStatus,
} from '@dealdecision/core';

export type NarrativeQualityValidatorInput = {
  deal_id: string;
  run_id: string | null;
  interpretation: InvestmentInterpretationV1;
};

const GENERIC_JARGON_PATTERNS: RegExp[] = [
  /compelling investment opportunity/i,
  /strong investment case/i,
  /favorable raise terms/i,
  /coherent business model/i,
  /exciting market opportunity/i,
  /verified evidence across key underwriting dimensions/i,
];

const SCORE_NARRATION_PATTERNS: RegExp[] = [
  /\b\d{1,3}(?:\.\d+)?\/100\b/,
  /supports proceeding/i,
  /investigate due to score/i,
  /high conviction/i,
  /score band/i,
  /below threshold/i,
  /above threshold/i,
];

function safeResult(value: boolean, warning = false): NarrativeQualityCheckResult {
  if (value) return 'pass';
  return warning ? 'warning' : 'fail';
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function validateNarrativeQualityV1(
  input: NarrativeQualityValidatorInput,
): NarrativeQualityValidationV1 {
  const sections = input.interpretation.sections ?? [];
  const genericLanguageWarnings: string[] = [];
  const criticalWarnings: string[] = [];
  const recommendedEdits: string[] = [];

  let specificityFailed = false;
  let evidenceFailed = false;
  let jargonFailed = false;
  let scoreNarrationFailed = false;
  let implicationFailed = false;
  let limitationFailed = false;
  let unsupportedFailed = false;
  let sectionFitFailed = false;
  let contaminationFailed = false;
  let archetypeFailed = false;

  for (const section of sections) {
    const combined = [
      section.observation,
      section.interpretation,
      ...(section.limitations ?? []),
      section.investment_implication,
      ...(section.supporting_evidence ?? []),
    ].join(' ');

    const normalizedObservation = normalize(section.observation);
    const normalizedInterpretation = normalize(section.interpretation);
    if (!section.interpretation || normalizedInterpretation === normalizedObservation) {
      specificityFailed = true;
      recommendedEdits.push(`Add analytical interpretation for ${section.section_id} instead of repeating the observation.`);
    }

    if (!section.investment_implication || section.investment_implication.trim().length < 20) {
      implicationFailed = true;
      recommendedEdits.push(`Add an explicit capital implication for ${section.section_id}.`);
    }

    if ((section.limitations ?? []).length === 0) {
      limitationFailed = true;
      recommendedEdits.push(`Add a limitation or missing-validation note for ${section.section_id}.`);
    }

    if ((section.evidence_refs ?? []).length === 0) {
      evidenceFailed = true;
      recommendedEdits.push(`Add evidence refs for ${section.section_id} or keep the current fallback copy.`);
    }

    const hygiene = section.section_hygiene;
    if (hygiene) {
      if (hygiene.section_fit === 'weak' || hygiene.section_fit === 'invalid') {
        sectionFitFailed = true;
        criticalWarnings.push(`${section.section_id}: section-fit hygiene rejected the current source text.`);
        recommendedEdits.push(`Remove or replace the current ${section.section_id} source because it is not section-specific enough.`);
      }
      if ((hygiene.contamination_flags ?? []).length > 0) {
        contaminationFailed = true;
        criticalWarnings.push(`${section.section_id}: contamination flags present (${hygiene.contamination_flags.join(', ')}).`);
      }
      if ((hygiene.contamination_flags ?? []).includes('unsupported_business_model_label')) {
        archetypeFailed = true;
        criticalWarnings.push(`${section.section_id}: archetype consistency check failed.`);
        recommendedEdits.push(`Replace the unsupported business-model label in ${section.section_id} with archetype-consistent economics.`);
      }
    }

    for (const pattern of GENERIC_JARGON_PATTERNS) {
      if (!pattern.test(combined)) continue;
      const hasSupport = (section.evidence_refs ?? []).length > 0 && (section.limitations ?? []).length > 0 && Boolean(section.investment_implication);
      if (!hasSupport) {
        jargonFailed = true;
        genericLanguageWarnings.push(`${section.section_id}: contains generic investment jargon without adequate evidence, limitation, and implication.`);
        recommendedEdits.push(`Replace generic investment language in ${section.section_id} with evidence-specific reasoning.`);
      }
    }

    for (const pattern of SCORE_NARRATION_PATTERNS) {
      if (!pattern.test(combined)) continue;
      scoreNarrationFailed = true;
      criticalWarnings.push(`${section.section_id}: contains score narration or unsupported conviction shorthand.`);
      recommendedEdits.push(`Remove score narration from ${section.section_id} and replace it with analytical reasoning.`);
    }

    if (/\bverified\b/i.test(combined) && (section.evidence_refs ?? []).length === 0) {
      unsupportedFailed = true;
      criticalWarnings.push(`${section.section_id}: uses verification language without evidence refs.`);
      recommendedEdits.push(`Remove unsupported verification language from ${section.section_id}.`);
    }
  }

  const specificityCheck = safeResult(!specificityFailed, sections.length > 0);
  const evidenceGroundingCheck = safeResult(!evidenceFailed, sections.length > 0);
  const jargonCheck = safeResult(!jargonFailed, genericLanguageWarnings.length > 0);
  const scoreNarrationCheck = safeResult(!scoreNarrationFailed);
  const investmentImplicationCheck = safeResult(!implicationFailed, sections.length > 0);
  const limitationPresenceCheck = safeResult(!limitationFailed, sections.length > 0);
  const unsupportedClaimCheck = safeResult(!unsupportedFailed, criticalWarnings.length > 0);
  const sectionFitCheck = safeResult(!sectionFitFailed);
  const contaminationCheck = safeResult(!contaminationFailed);
  const archetypeConsistencyCheck = safeResult(!archetypeFailed);

  const hasFailure = [
    specificityCheck,
    evidenceGroundingCheck,
    jargonCheck,
    scoreNarrationCheck,
    investmentImplicationCheck,
    limitationPresenceCheck,
    unsupportedClaimCheck,
    sectionFitCheck,
    contaminationCheck,
    archetypeConsistencyCheck,
  ].includes('fail');

  const status: NarrativeQualityValidationStatus = hasFailure
    ? 'failed'
    : genericLanguageWarnings.length > 0 || criticalWarnings.length > 0
      ? 'needs_review'
      : 'passed';

  return {
    schema_version: 'narrative_quality_validation_v1',
    deal_id: input.deal_id,
    run_id: input.run_id,
    created_at: new Date().toISOString(),
    specificity_check: specificityCheck,
    evidence_grounding_check: evidenceGroundingCheck,
    jargon_check: jargonCheck,
    score_narration_check: scoreNarrationCheck,
    investment_implication_check: investmentImplicationCheck,
    limitation_presence_check: limitationPresenceCheck,
    unsupported_claim_check: unsupportedClaimCheck,
    section_fit_check: sectionFitCheck,
    contamination_check: contaminationCheck,
    archetype_consistency_check: archetypeConsistencyCheck,
    generic_language_warnings: genericLanguageWarnings,
    critical_warnings: criticalWarnings,
    recommended_edits: Array.from(new Set(recommendedEdits)),
    status,
  };
}