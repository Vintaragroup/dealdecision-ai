import type {
  InvestmentInterpretationSectionId,
  SectionEvidenceContaminationFlag,
  SectionEvidenceFit,
  SectionEvidenceHygieneV1,
} from '@dealdecision/core';

type SectionEvidenceHygieneInput = {
  sectionId: InvestmentInterpretationSectionId;
  rawText: string | null;
  sourceField: string;
  evidenceRefs: string[];
  archetype: string | null;
  selectedPolicyId: string | null;
};

function normalizeText(value: string | null): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/[ \t]{2,}/g, ' ').trim();
  return trimmed.length > 0 && trimmed !== '—' ? trimmed : null;
}

function cleanText(value: string | null): string | null {
  const text = normalizeText(value);
  if (!text) return null;
  return text.replace(/\s*\.\.\.$/, '').replace(/^\s*[•·\-–—]\s*/, '').trim() || null;
}

function isLikelyOcrNoise(text: string): boolean {
  const trimmed = text.trim();
  const tokens = trimmed.split(/\s+/);
  if (tokens.length === 0) return true;
  if (/\b[a-zA-Z]\s+[a-zA-Z]\b/.test(trimmed) && tokens.length > 6) return true;
  if (/^[A-Z0-9\s,.:;!?()/-]{15,}$/.test(trimmed) && !/[a-z]/.test(trimmed)) return true;
  if (/\s{3,}/.test(trimmed)) return true;
  const alphaTokens = tokens.filter((token) => /[a-zA-Z]{3,}/.test(token)).length;
  return tokens.length >= 6 && alphaTokens / tokens.length < 0.5;
}

function hasBiographySignal(text: string): boolean {
  return /\b(mba|bachelor'?s|master'?s|phd|studied at|graduated from|university|business school|degree|technical university)\b/i.test(text);
}

function hasTeamBackgroundSignal(text: string): boolean {
  return /\b(founder|co-founder|ceo|cto|executive|leadership|team brings|years of experience|background in)\b/i.test(text);
}

function isInfrastructureArchetype(archetype: string | null, selectedPolicyId: string | null): boolean {
  const haystack = `${archetype ?? ''} ${selectedPolicyId ?? ''}`.toLowerCase();
  return /infrastructure|energy|project[_ -]?finance|real[_ -]?estate|asset[_ -]?backed|underwriting/.test(haystack);
}

function isConsumerArchetype(archetype: string | null, selectedPolicyId: string | null): boolean {
  const haystack = `${archetype ?? ''} ${selectedPolicyId ?? ''}`.toLowerCase();
  return /consumer|brand|retail|commerce/.test(haystack);
}

function buildReason(sectionId: InvestmentInterpretationSectionId, fit: SectionEvidenceFit, flags: SectionEvidenceContaminationFlag[]): string {
  if (flags.includes('insufficient_clean_evidence')) {
    return `insufficient clean ${sectionId.replace('_', ' ')} evidence for interpretation`;
  }
  if (flags.length === 0) {
    return `${sectionId.replace('_', ' ')} evidence appears section-specific and readable`;
  }
  return `${sectionId.replace('_', ' ')} evidence flagged for ${flags.join(', ')} (${fit})`;
}

export function classifySectionEvidenceV1(input: SectionEvidenceHygieneInput): SectionEvidenceHygieneV1 {
  const rawText = normalizeText(input.rawText);
  const text = cleanText(rawText);
  const flags = new Set<SectionEvidenceContaminationFlag>();

  if (!text) {
    flags.add('malformed_text');
    flags.add('insufficient_clean_evidence');
  }

  if (text && isLikelyOcrNoise(text)) flags.add('ocr_noise');
  if (text && hasBiographySignal(text)) {
    flags.add('biography_text');
    flags.add('unrelated_person_credential');
  }
  if (text && hasTeamBackgroundSignal(text)) flags.add('team_background');

  if (text && input.sectionId === 'product') {
    if (/\b(funding|green bonds|equity|safe|valuation|raise|debt|financing)\b/i.test(text) && !/\b(product|service|technology|platform|software|device|asset|offering|solution|sells|provides|builds|deploys|manufactures|produces)\b/i.test(text)) {
      flags.add('wrong_section');
    }
    if (/\bmarket\b/i.test(text) && !/\b(product|service|technology|platform|software|device|asset|offering|solution|sells|provides|builds|deploys|manufactures|produces)\b/i.test(text)) {
      if (!isConsumerArchetype(input.archetype, input.selectedPolicyId)) {
        flags.add('wrong_section');
      }
    }
    if (/\b(company focused on|evolving .* market|growing market|younger and female players|demographic|category)\b/i.test(text) && !/\b(product|service|technology|offering|device|asset|solution|sells|provides)\b/i.test(text)) {
      flags.add('generic_jargon');
    }
  }

  if (text && input.sectionId === 'market') {
    if (hasBiographySignal(text) || hasTeamBackgroundSignal(text)) flags.add('wrong_section');
    if (/\b(product|technology|workflow|platform|solution|manufacturing|device)\b/i.test(text) && !/\bmarket|customer|buyer|segment|tam|demand|industry|compet/i.test(text)) {
      flags.add('wrong_section');
    }
  }

  if (text && input.sectionId === 'business_model') {
    if (/\b(marketplace|platform)\b/i.test(text) && isInfrastructureArchetype(input.archetype, input.selectedPolicyId) && !/\b(marketplace|platform)\b.*\b(take rate|transaction|buyer|seller|listing|network)\b/i.test(text)) {
      flags.add('unsupported_business_model_label');
    }
    if (/\bmarket size|tam|sam|som\b/i.test(text) || hasBiographySignal(text)) flags.add('wrong_section');
  }

  if (text && input.sectionId === 'raise_terms') {
    if (/\$\s?\d/.test(text) && !/\b(raise|raising|round|equity|safe|valuation|ownership|cap table|debt|instrument|financing|funding|capital stack|project finance|ppa|offtake)\b/i.test(text)) {
      flags.add('financial_amount_without_context');
      flags.add('wrong_section');
    }
  }

  let sectionFit: SectionEvidenceFit = 'strong';
  if (flags.has('insufficient_clean_evidence') || flags.has('ocr_noise') || flags.has('malformed_text')) {
    sectionFit = 'invalid';
  } else if (flags.has('biography_text') || flags.has('team_background') || flags.has('unrelated_person_credential') || flags.has('wrong_section') || flags.has('unsupported_business_model_label') || flags.has('financial_amount_without_context')) {
    sectionFit = 'invalid';
  } else if (flags.has('generic_jargon')) {
    sectionFit = input.sectionId === 'product' && isConsumerArchetype(input.archetype, input.selectedPolicyId) ? 'partial' : 'weak';
  }

  const clean = sectionFit === 'invalid' ? null : text;
  const confidence = sectionFit === 'strong' ? 0.92 : sectionFit === 'partial' ? 0.66 : sectionFit === 'weak' ? 0.35 : 0.08;

  return {
    section_id: input.sectionId,
    raw_text: rawText,
    source_field: input.sourceField,
    evidence_refs: input.evidenceRefs.slice(0, 6),
    section_fit: sectionFit,
    contamination_flags: Array.from(flags),
    clean_text: clean,
    reason: buildReason(input.sectionId, sectionFit, Array.from(flags)),
    confidence,
  };
}
