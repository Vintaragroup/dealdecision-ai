import type {
  InvestmentInterpretationV1,
  InvestmentInterpretationSectionV1,
  InvestmentInterpretationConfidence,
  InvestmentInterpretationSourceQuality,
  SectionEvidenceHygieneV1,
} from '@dealdecision/core';
import type { LLMFinancialVerificationV1 } from '@dealdecision/core/dist/models/llm-financial-verification-v1';
import type { LLMValidationSummaryV1 } from '@dealdecision/core/dist/models/llm-validation-summary-v1';
import { classifySectionEvidenceV1 } from './section-evidence-hygiene-v1.js';

type PromotedFactSample = {
  evidence_id: string;
  fact_type: string;
  summary: string;
  confidence: number;
  source_kind?: string | null;
};

export type InvestmentInterpretationSynthesizerInput = {
  deal_id: string;
  report_id: string | null;
  run_id: string | null;
  company_name: string | null;
  canonical_verdict: string | null;
  archetype: string | null;
  selected_policy_id: string | null;
  structured_summary: Record<string, unknown> | null;
  phase1_overview: Record<string, unknown> | null;
  promoted_facts_sample: PromotedFactSample[];
  financial_verification: LLMFinancialVerificationV1 | null;
  validation_summary: LLMValidationSummaryV1 | null;
  accepted_corrections: string[];
  underwriting_readiness: Record<string, unknown> | null;
};

function asText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed !== '—' ? trimmed : null;
}

function normalizeSentence(value: string | null): string | null {
  const text = asText(value);
  if (!text) return null;
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function uniqueStrings(values: Array<string | null | undefined>, limit = 4): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const text = asText(value);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

function extractEvidenceRefsFromSources(sources: unknown): string[] {
  if (!Array.isArray(sources)) return [];
  const refs: string[] = [];
  const seen = new Set<string>();
  for (const item of sources) {
    if (!item || typeof item !== 'object') continue;
    const ref = asText((item as any).evidence_id)
      ?? asText((item as any).evidence_ref)
      ?? asText((item as any).id)
      ?? asText((item as any).document_id);
    if (!ref || seen.has(ref)) continue;
    seen.add(ref);
    refs.push(ref);
  }
  return refs.slice(0, 6);
}

function extractEvidenceSnippetsFromSources(sources: unknown): string[] {
  if (!Array.isArray(sources)) return [];
  const snippets: string[] = [];
  const seen = new Set<string>();
  for (const item of sources) {
    if (!item || typeof item !== 'object') continue;
    const snippet = asText((item as any).note_snippet)
      ?? asText((item as any).snippet)
      ?? asText((item as any).text)
      ?? asText((item as any).raw)
      ?? asText((item as any).value);
    if (!snippet) continue;
    const key = snippet.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    snippets.push(snippet);
  }
  return snippets.slice(0, 3);
}

function pickPromotedEvidence(sample: PromotedFactSample[], matcher: RegExp): { refs: string[]; snippets: string[] } {
  const refs: string[] = [];
  const snippets: string[] = [];
  const refSeen = new Set<string>();
  const snippetSeen = new Set<string>();

  for (const item of sample) {
    const haystack = `${item.fact_type} ${item.summary}`;
    if (!matcher.test(haystack)) continue;
    const evidenceId = asText(item.evidence_id);
    if (evidenceId && !refSeen.has(evidenceId)) {
      refSeen.add(evidenceId);
      refs.push(evidenceId);
    }
    const snippet = asText(item.summary);
    if (snippet && !snippetSeen.has(snippet.toLowerCase())) {
      snippetSeen.add(snippet.toLowerCase());
      snippets.push(snippet);
    }
    if (refs.length >= 3 && snippets.length >= 3) break;
  }

  return { refs, snippets };
}

function inferConfidence(evidenceRefs: string[], warnings: string[]): InvestmentInterpretationConfidence {
  if (warnings.length > 1 && evidenceRefs.length === 0) return 'none';
  if (evidenceRefs.length >= 2 && warnings.length === 0) return 'high';
  if (evidenceRefs.length >= 1) return 'medium';
  if (warnings.length > 0) return 'low';
  return 'low';
}

function inferSourceQuality(evidenceRefs: string[], confidence: InvestmentInterpretationConfidence, warnings: string[]): InvestmentInterpretationSourceQuality {
  if (warnings.some((warning) => /conflict|disagreement/i.test(warning))) return 'conflicted';
  if (confidence === 'high' && evidenceRefs.length >= 2) return 'verified';
  if (confidence === 'medium' && evidenceRefs.length >= 1) return 'directional';
  return 'unverified';
}

type SectionCandidate = {
  rawText: string | null;
  sourceField: string;
  evidenceRefs: string[];
  supportingEvidence: string[];
};

function dedupeStrings(values: string[], limit = 6): string[] {
  return uniqueStrings(values, limit);
}

function pickBestSectionCandidate(params: {
  sectionId: InvestmentInterpretationSectionV1['section_id'];
  candidates: SectionCandidate[];
  archetype: string | null;
  selectedPolicyId: string | null;
}): { hygiene: SectionEvidenceHygieneV1 | null; refs: string[]; supportingEvidence: string[] } {
  const hygiened = params.candidates.map((candidate) => ({
    candidate,
    hygiene: classifySectionEvidenceV1({
      sectionId: params.sectionId,
      rawText: candidate.rawText,
      sourceField: candidate.sourceField,
      evidenceRefs: candidate.evidenceRefs,
      archetype: params.archetype,
      selectedPolicyId: params.selectedPolicyId,
    }),
  }));

  const best = hygiened.find((item) => item.hygiene.section_fit === 'strong')
    ?? hygiened.find((item) => item.hygiene.section_fit === 'partial')
    ?? null;

  if (!best) return { hygiene: null, refs: [], supportingEvidence: [] };

  return {
    hygiene: best.hygiene,
    refs: dedupeStrings([...best.candidate.evidenceRefs, ...best.hygiene.evidence_refs], 6),
    supportingEvidence: dedupeStrings(best.candidate.supportingEvidence, 3),
  };
}

function isInfrastructureArchetype(archetype: string | null, selectedPolicyId: string | null): boolean {
  return /infrastructure|energy|project[_ -]?finance|real[_ -]?estate|asset[_ -]?backed|underwriting/i.test(`${archetype ?? ''} ${selectedPolicyId ?? ''}`);
}

function buildSection(params: {
  sectionId: InvestmentInterpretationSectionV1['section_id'];
  observation: string | null;
  evidenceRefs: string[];
  supportingEvidence: string[];
  limitations: string[];
  interpretation: string;
  implication: string;
  warnings: Array<string | null>;
  sectionHygiene?: SectionEvidenceHygieneV1 | null;
}): InvestmentInterpretationSectionV1 | null {
  const observation = normalizeSentence(params.observation);
  if (!observation) return null;

  const warnings = uniqueStrings(params.warnings);
  const limitations = uniqueStrings(params.limitations, 3).map((item) => normalizeSentence(item) ?? item);
  const evidenceRefs = uniqueStrings(params.evidenceRefs, 6);
  const supportingEvidence = uniqueStrings(params.supportingEvidence, 3).map((item) => normalizeSentence(item) ?? item);
  const confidence = inferConfidence(evidenceRefs, warnings);
  const sourceQuality = inferSourceQuality(evidenceRefs, confidence, warnings);

  return {
    section_id: params.sectionId,
    observation,
    interpretation: normalizeSentence(params.interpretation) ?? params.interpretation,
    supporting_evidence: supportingEvidence,
    limitations,
    investment_implication: normalizeSentence(params.implication) ?? params.implication,
    confidence,
    evidence_refs: evidenceRefs,
    source_quality: sourceQuality,
    warnings,
    section_hygiene: params.sectionHygiene ?? null,
  };
}

export function synthesizeInvestmentInterpretationV1(
  input: InvestmentInterpretationSynthesizerInput,
): InvestmentInterpretationV1 | null {
  const structuredSummary = input.structured_summary ?? null;
  const phase1Overview = input.phase1_overview ?? null;

  const productObservation = asText((phase1Overview as any)?.product_solution);
  const marketObservation = asText((phase1Overview as any)?.market_icp);
  const businessModelField = (structuredSummary as any)?.business_model;
  const raiseField = (structuredSummary as any)?.raise;
  const businessModelObservation = asText((businessModelField as any)?.value ?? businessModelField);
  const raiseObservation = asText((raiseField as any)?.value ?? raiseField);

  const sharedPhase1Refs = extractEvidenceRefsFromSources((phase1Overview as any)?.sources);
  const sharedPhase1Snippets = extractEvidenceSnippetsFromSources((phase1Overview as any)?.sources);
  const businessModelRefs = extractEvidenceRefsFromSources((businessModelField as any)?.sources);
  const businessModelSnippets = extractEvidenceSnippetsFromSources((businessModelField as any)?.sources);
  const raiseRefs = extractEvidenceRefsFromSources((raiseField as any)?.sources);
  const raiseSnippets = extractEvidenceSnippetsFromSources((raiseField as any)?.sources);

  const productEvidence = pickPromotedEvidence(input.promoted_facts_sample, /(product|solution|customer|workflow|technology|platform)/i);
  const marketEvidence = pickPromotedEvidence(input.promoted_facts_sample, /(market|customer|segment|demand|traction|pipeline)/i);
  const businessModelEvidence = pickPromotedEvidence(input.promoted_facts_sample, /(business_model|pricing|subscription|contract|revenue|customer)/i);
  const raiseEvidence = pickPromotedEvidence(input.promoted_facts_sample, /(raise|round|safe|valuation|cap table|equity|term)/i);
  const synthesisWarnings: string[] = [];

  const disagreementCount = Number((input.validation_summary as any)?.high_confidence_disagreements ?? 0);
  const financialGapCount = Array.isArray(input.financial_verification?.financial_gaps)
    ? input.financial_verification!.financial_gaps.length
    : 0;

  const productCandidate = pickBestSectionCandidate({
    sectionId: 'product',
    archetype: input.archetype,
    selectedPolicyId: input.selected_policy_id,
    candidates: [
      {
        rawText: productObservation,
        sourceField: 'phase1_overview.product_solution',
        evidenceRefs: sharedPhase1Refs,
        supportingEvidence: [...sharedPhase1Snippets, ...productEvidence.snippets],
      },
      ...productEvidence.snippets.map((snippet, index) => ({
        rawText: snippet,
        sourceField: `promoted_facts_sample.product[${index}]`,
        evidenceRefs: productEvidence.refs,
        supportingEvidence: [snippet],
      })),
    ],
  });
  if (!productCandidate.hygiene) synthesisWarnings.push('product: insufficient_clean_evidence');

  const marketCandidate = pickBestSectionCandidate({
    sectionId: 'market',
    archetype: input.archetype,
    selectedPolicyId: input.selected_policy_id,
    candidates: [
      {
        rawText: marketObservation,
        sourceField: 'phase1_overview.market_icp',
        evidenceRefs: sharedPhase1Refs,
        supportingEvidence: [...sharedPhase1Snippets, ...marketEvidence.snippets],
      },
      ...marketEvidence.snippets.map((snippet, index) => ({
        rawText: snippet,
        sourceField: `promoted_facts_sample.market[${index}]`,
        evidenceRefs: marketEvidence.refs,
        supportingEvidence: [snippet],
      })),
    ],
  });
  if (!marketCandidate.hygiene) synthesisWarnings.push('market: insufficient_clean_evidence');

  const businessModelCandidate = pickBestSectionCandidate({
    sectionId: 'business_model',
    archetype: input.archetype,
    selectedPolicyId: input.selected_policy_id,
    candidates: [
      {
        rawText: businessModelObservation,
        sourceField: 'structured_summary.business_model',
        evidenceRefs: businessModelRefs,
        supportingEvidence: [...businessModelSnippets, ...businessModelEvidence.snippets],
      },
      ...businessModelEvidence.snippets.map((snippet, index) => ({
        rawText: snippet,
        sourceField: `promoted_facts_sample.business_model[${index}]`,
        evidenceRefs: businessModelEvidence.refs,
        supportingEvidence: [snippet],
      })),
    ],
  });
  if (!businessModelCandidate.hygiene) synthesisWarnings.push('business_model: insufficient_clean_evidence');

  const raiseCandidate = pickBestSectionCandidate({
    sectionId: 'raise_terms',
    archetype: input.archetype,
    selectedPolicyId: input.selected_policy_id,
    candidates: [
      {
        rawText: raiseObservation,
        sourceField: 'structured_summary.raise',
        evidenceRefs: raiseRefs,
        supportingEvidence: [...raiseSnippets, ...raiseEvidence.snippets],
      },
      ...raiseEvidence.snippets.map((snippet, index) => ({
        rawText: snippet,
        sourceField: `promoted_facts_sample.raise_terms[${index}]`,
        evidenceRefs: raiseEvidence.refs,
        supportingEvidence: [snippet],
      })),
    ],
  });
  if (!raiseCandidate.hygiene) synthesisWarnings.push('raise_terms: insufficient_clean_evidence');

  const productSection = buildSection({
    sectionId: 'product',
    observation: productCandidate.hygiene?.clean_text ?? null,
    evidenceRefs: productCandidate.refs,
    supportingEvidence: productCandidate.supportingEvidence,
    limitations: [
      'The current package does not yet show independent customer adoption or deployment proof for this product description.',
      disagreementCount > 0 ? 'Some upstream interpretation signals still disagree with deterministic extraction and should be reviewed.' : null,
    ],
    interpretation:
      'If the stated product positioning reflects a real operational pain point rather than pitch framing alone, it could support differentiated adoption and pricing discipline.',
    implication:
      'For capital, this means product quality should be underwritten through proof of deployment success, buyer urgency, and conversion evidence before it is treated as durable differentiation.',
    warnings: [
      !productCandidate.hygiene ? 'Product interpretation omitted because clean section-specific evidence was insufficient.' : null,
      productCandidate.hygiene?.reason ?? null,
    ],
    sectionHygiene: productCandidate.hygiene,
  });

  const marketSection = buildSection({
    sectionId: 'market',
    observation: marketCandidate.hygiene?.clean_text ?? null,
    evidenceRefs: marketCandidate.refs,
    supportingEvidence: marketCandidate.supportingEvidence,
    limitations: [
      'The current materials do not yet establish whether the cited market demand converts into repeatable acquisition efficiency or durable retention.',
      financialGapCount > 0 ? 'Financial verification still reports unresolved gaps, which limits confidence in any demand-to-revenue inference.' : null,
    ],
    interpretation:
      'A focused market claim matters because underwriting depends on whether the company can repeatedly reach a specific buyer segment, not merely point to a broad addressable market.',
    implication:
      'For capital, this means market attractiveness should be judged through evidence of buyer concentration, sales motion repeatability, and externally corroborated demand rather than headline TAM language.',
    warnings: [
      !marketCandidate.hygiene ? 'Market interpretation omitted because clean section-specific evidence was insufficient.' : null,
      marketCandidate.hygiene?.reason ?? null,
    ],
    sectionHygiene: marketCandidate.hygiene,
  });

  const businessModelSection = buildSection({
    sectionId: 'business_model',
    observation: businessModelCandidate.hygiene?.clean_text ?? null,
    evidenceRefs: businessModelCandidate.refs,
    supportingEvidence: businessModelCandidate.supportingEvidence,
    limitations: [
      'The current package does not yet provide independently validated pricing, retention, or unit economics sufficient for full underwriting confidence.',
      input.accepted_corrections.length > 0 ? `Accepted shadow corrections remain advisory only: ${input.accepted_corrections.slice(0, 2).join('; ')}.` : null,
    ],
    interpretation:
      isInfrastructureArchetype(input.archetype, input.selected_policy_id)
        ? 'For infrastructure and energy deals, the business model must be underwritten through project finance structure, contracted offtake, deployment economics, and asset-backed cash-flow mechanics rather than generic software labels.'
        : 'The stated business model matters because underwriting depends on how revenue is contracted, repeated, and scaled relative to delivery cost.',
    implication:
      isInfrastructureArchetype(input.archetype, input.selected_policy_id)
        ? 'For capital, this means the model should only be treated as durable if project economics, customer or offtake commitments, and capital-stack sufficiency hold up under independent diligence.'
        : 'For capital, this means the business model should only be treated as durable if pricing, customer concentration, and margin mechanics hold up under independent diligence.',
    warnings: [
      !businessModelCandidate.hygiene ? 'Business model interpretation omitted because clean section-specific evidence was insufficient.' : null,
      businessModelCandidate.hygiene?.reason ?? null,
    ],
    sectionHygiene: businessModelCandidate.hygiene,
  });

  const raiseSection = buildSection({
    sectionId: 'raise_terms',
    observation: raiseCandidate.hygiene?.clean_text ?? null,
    evidenceRefs: raiseCandidate.refs,
    supportingEvidence: raiseCandidate.supportingEvidence,
    limitations: [
      'The financing structure is not yet paired with a fully underwritten dilution model, cap table context, or milestone-based use-of-proceeds analysis.',
      input.financial_verification?.cap_table_present ? null : 'Cap table support is absent or incomplete, which limits ownership and dilution interpretation.',
    ],
    interpretation:
      'Raise terms matter because financing structure determines dilution, runway, and how much proof the company must deliver before the next capital event.',
    implication:
      'For capital, this means term quality should be evaluated alongside ownership, time-to-next-round, and evidence that the raise amount is sufficient for the stated execution plan.',
    warnings: [
      !raiseCandidate.hygiene ? 'Raise-terms interpretation omitted because clean financing evidence was insufficient.' : null,
      raiseCandidate.hygiene?.reason ?? null,
    ],
    sectionHygiene: raiseCandidate.hygiene,
  });

  const sections = [productSection, marketSection, businessModelSection, raiseSection].filter(
    (section): section is InvestmentInterpretationSectionV1 => section !== null,
  );

  if (sections.length === 0) return null;

  return {
    schema_version: 'investment_interpretation_v1',
    deal_id: input.deal_id,
    report_id: input.report_id,
    run_id: input.run_id,
    created_at: new Date().toISOString(),
    status: 'shadow_only',
    synthesizer_version: 'deterministic_v1',
    sections,
    synthesis_warnings: synthesisWarnings,
  };
}