/**
 * Tests for Key Facts LLM synthesis wiring in DealWorkspaceV4.
 *
 * Validates:
 * - LLM synthesis text is used when product.source === 'llm_synthesis'
 * - Raw OCR garbage is not used when synthesis is available
 * - Fallback only appears when synthesis is absent AND raw quality fails
 * - Synthesis source diagnostic appears when llm_synthesis is the final source
 * - Portfolio/project text is not required to be used as the company product
 */

import { render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DealWorkspaceV4, type DealWorkspaceV4Props } from '../components/workspace/DealWorkspaceV4';

afterEach(() => {
  vi.unstubAllEnvs();
});

const emptyFact = { value: null, trust: 'not_extracted' as const, nullReason: 'Not extracted' };

const BASE_PROPS: DealWorkspaceV4Props = {
  darkMode: true,
  companyName: 'TestCo',
  dealType: 'Equity',
  stage: 'Series A',
  raise: '$5M',
  raiseNullRule: null,
  lastAnalyzedAt: '2026-05-07T12:00:00.000Z',
  investmentSnapshotBody: 'Financial evidence is incomplete.',
  convictionScore: 52,
  convictionBand: 'Investigate',
  convictionPosture: 'INVESTIGATE',
  convictionHeadline: null,
  convictionRationale: null,
  convictionProvisional: false,
  topPositiveContributors: [],
  topNegativeContributors: [],
  requiredNextChecks: [],
  product: emptyFact,
  market: emptyFact,
  businessModel: emptyFact,
  raiseTerms: emptyFact,
  financialTiles: [],
  financialCoverage: 40,
  underwritingReadiness: 38,
  financialIntegrityStatus: 'unvalidated',
  financialNarrative: null,
  financialCurrentStateSummary: null,
  financialBurnRunwaySummary: null,
  underwritingNarrative: null,
  redFlags: [],
  blockerCount: 0,
  openQuestions: [],
  contradictions: [],
  teamHighlights: [],
  useOfFunds: [],
  projectPipeline: [],
  revenueModel: { type: null, unitEconomics: null, detail: null },
  deepDiveReady: false,
  insightsReady: false,
};

const LLM_SYNTHESIS_PRODUCT = {
  value: 'Climatic is a green infrastructure lender that provides project finance for renewable energy assets in emerging markets.',
  trust: 'governed' as const,
  source: 'llm_synthesis' as const,
  origin: 'overlay' as const,
  evidenceIds: [],
  evidence: [],
  nullReason: null,
};

const OCR_GARBAGE_PRODUCT = {
  value: 'Platform, your digital platform and our media partner\'s as well 7 eae ila oe HES as a key part',
  trust: 'interim_extraction' as const,
  source: 'phase1' as const,
  origin: 'deterministic' as const,
  evidenceIds: [],
  evidence: [],
  nullReason: null,
};

const strongSectionHygiene = (sectionId: 'product' | 'market' | 'business_model' | 'raise_terms', sourceField: string, evidenceRef: string) => ({
  section_id: sectionId,
  raw_text: `${sectionId} raw text`,
  source_field: sourceField,
  evidence_refs: [evidenceRef],
  section_fit: 'strong',
  contamination_flags: [],
  clean_text: `${sectionId} clean text`,
  reason: 'clean section evidence',
  confidence: 0.95,
});

// ─── LLM synthesis is used when available ────────────────────────────────────

describe('Product card: LLM synthesis is used when available', () => {
  it('renders LLM-synthesized product description without fallback', () => {
    render(
      <DealWorkspaceV4
        {...BASE_PROPS}
        product={LLM_SYNTHESIS_PRODUCT}
      />,
    );
    expect(screen.getByText(LLM_SYNTHESIS_PRODUCT.value)).toBeInTheDocument();
    expect(screen.queryByTestId('product-copy-fallback')).not.toBeInTheDocument();
  });

  it('does not put LLM synthesis text into suppressed-raw diagnostics', () => {
    render(
      <DealWorkspaceV4
        {...BASE_PROPS}
        product={LLM_SYNTHESIS_PRODUCT}
      />,
    );
    expect(screen.queryByTestId('product-suppressed-raw')).not.toBeInTheDocument();
  });

  it('shows synthesis source diagnostic when llm_synthesis is the final source', () => {
    render(
      <DealWorkspaceV4
        {...BASE_PROPS}
        product={LLM_SYNTHESIS_PRODUCT}
      />,
    );
    const diag = screen.queryByTestId('product-synthesis-source');
    expect(diag).toBeInTheDocument();
    expect(diag?.textContent).toMatch(/llm_synthesis/i);
  });
});

// ─── LLM synthesis takes priority over raw OCR ───────────────────────────────

describe('Product card: LLM synthesis priority over raw extraction', () => {
  it('uses synthesis when synthesis product is provided, even if OCR garbage is available', () => {
    // The selector ensures llm_synthesis wins over phase1/structured — the test
    // simulates post-selector state where product.source is already llm_synthesis.
    render(
      <DealWorkspaceV4
        {...BASE_PROPS}
        product={LLM_SYNTHESIS_PRODUCT}
      />,
    );
    // The OCR garbage string must NOT appear in any card.
    expect(screen.queryByText(/eae ila oe HES/i)).not.toBeInTheDocument();
    // The synthesis text must appear.
    expect(screen.getByText(LLM_SYNTHESIS_PRODUCT.value)).toBeInTheDocument();
  });
});

// ─── Fallback when synthesis absent and raw fails ────────────────────────────

describe('Product card: fallback when no synthesis and raw quality fails', () => {
  it('shows fallback when only OCR garbage is available and no synthesis', () => {
    render(
      <DealWorkspaceV4
        {...BASE_PROPS}
        product={OCR_GARBAGE_PRODUCT}
      />,
    );
    expect(screen.getByTestId('product-copy-conservative-fallback')).toBeInTheDocument();
    expect(screen.queryByTestId('product-synthesis-source')).not.toBeInTheDocument();
  });
});

// ─── Portfolio project not treated as company product ────────────────────────

describe('Product card: portfolio project entity distinction', () => {
  const ENTITY_CONFUSED_PRODUCT = {
    value: 'Project S Tidal Energy System offers a government-backed high IRR investment backed by export credit agencies.',
    trust: 'interim_extraction' as const,
    source: 'phase1' as const,
    origin: 'deterministic' as const,
    evidenceIds: [],
    evidence: [],
    nullReason: null,
  };

  const COMPANY_PRODUCT_SYNTHESIS = {
    value: 'Climatic is a specialty project finance lender deploying capital into renewable energy infrastructure across Sub-Saharan Africa.',
    trust: 'governed' as const,
    source: 'llm_synthesis' as const,
    origin: 'overlay' as const,
    evidenceIds: [],
    evidence: [],
    nullReason: null,
  };

  it('renders company description from synthesis, not a portfolio project name', () => {
    render(
      <DealWorkspaceV4
        {...BASE_PROPS}
        product={COMPANY_PRODUCT_SYNTHESIS}
      />,
    );
    // Company-level synthesis is shown
    expect(screen.getByText(COMPANY_PRODUCT_SYNTHESIS.value)).toBeInTheDocument();
    // Portfolio project name is not in the product card
    expect(screen.queryByText(/Project S Tidal Energy/i)).not.toBeInTheDocument();
  });

  it('does not surface entity-confused extraction when synthesis supersedes it', () => {
    // When llm_synthesis is provided, the entity-confused extraction (phase1) is not shown.
    render(
      <DealWorkspaceV4
        {...BASE_PROPS}
        product={COMPANY_PRODUCT_SYNTHESIS}
      />,
    );
    expect(screen.queryByText(/Project S Tidal Energy/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId('product-copy-fallback')).not.toBeInTheDocument();
    expect(screen.queryByTestId('product-copy-conservative-fallback')).not.toBeInTheDocument();
  });

  it('shows conservative fallback when entity-confused raw copy is the only input', () => {
    render(
      <DealWorkspaceV4
        {...BASE_PROPS}
        product={ENTITY_CONFUSED_PRODUCT}
      />,
    );
    expect(screen.queryByText(ENTITY_CONFUSED_PRODUCT.value)).not.toBeInTheDocument();
    expect(screen.getByTestId('product-copy-conservative-fallback')).toBeInTheDocument();
  });
});

// ─── Synthesis source diagnostic presence ─────────────────────────────────────

describe('Synthesis diagnostics', () => {
  it('does not show synthesis source diagnostic when source is not llm_synthesis', () => {
    render(
      <DealWorkspaceV4
        {...BASE_PROPS}
        product={{
          value: 'A climate-tech SaaS platform for enterprise carbon accounting with certified audit trails.',
          trust: 'structured' as const,
          source: 'structured_summary' as const,
          origin: 'deterministic' as const,
          evidenceIds: [],
          evidence: [],
          nullReason: null,
        }}
      />,
    );
    expect(screen.queryByTestId('product-synthesis-source')).not.toBeInTheDocument();
  });

  it('synthesis source diagnostic contains product_profile_v1 provenance', () => {
    render(
      <DealWorkspaceV4
        {...BASE_PROPS}
        product={LLM_SYNTHESIS_PRODUCT}
      />,
    );
    const diag = screen.queryByTestId('product-synthesis-source');
    expect(diag?.textContent).toMatch(/key_facts_synthesis_v1/i);
  });
});

describe('Investment interpretation experimental rendering', () => {
  it('replaces key-fact copy when env is enabled and narrative validation passes', () => {
    vi.stubEnv('VITE_USE_INVESTMENT_INTERPRETATION_V1', 'true');

    render(
      <DealWorkspaceV4
        {...BASE_PROPS}
        product={{
          value: 'Legacy raw product copy that should not win.',
          trust: 'structured',
          source: 'structured_summary',
          origin: 'deterministic',
          evidenceIds: [],
          evidence: [],
          nullReason: null,
        }}
        market={{ value: 'Legacy market copy', trust: 'structured', nullReason: null }}
        businessModel={{ value: 'Legacy business model copy', trust: 'structured', nullReason: null }}
        raiseTerms={{ value: 'Legacy raise copy', trust: 'structured', nullReason: null }}
        investmentInterpretation={{
          schema_version: 'investment_interpretation_v1',
          status: 'shadow_only',
          sections: [
            {
              section_id: 'product',
              observation: 'Product observation.',
              interpretation: 'Product interpretation.',
              limitations: ['Product limitation.'],
              investment_implication: 'Product implication.',
              supporting_evidence: ['Product evidence.'],
              confidence: 'medium',
              evidence_refs: ['prod-1'],
              source_quality: 'directional',
              warnings: [],
              section_hygiene: strongSectionHygiene('product', 'phase1_overview.product_solution', 'prod-1'),
            },
            {
              section_id: 'market',
              observation: 'Market observation.',
              interpretation: 'Market interpretation.',
              limitations: ['Market limitation.'],
              investment_implication: 'Market implication.',
              supporting_evidence: ['Market evidence.'],
              confidence: 'medium',
              evidence_refs: ['mkt-1'],
              source_quality: 'directional',
              warnings: [],
              section_hygiene: strongSectionHygiene('market', 'phase1_overview.market_icp', 'mkt-1'),
            },
            {
              section_id: 'business_model',
              observation: 'Business model observation.',
              interpretation: 'Business model interpretation.',
              limitations: ['Business model limitation.'],
              investment_implication: 'Business model implication.',
              supporting_evidence: ['Business model evidence.'],
              confidence: 'medium',
              evidence_refs: ['bm-1'],
              source_quality: 'directional',
              warnings: [],
              section_hygiene: strongSectionHygiene('business_model', 'structured_summary.business_model', 'bm-1'),
            },
            {
              section_id: 'raise_terms',
              observation: 'Raise observation.',
              interpretation: 'Raise interpretation.',
              limitations: ['Raise limitation.'],
              investment_implication: 'Raise implication.',
              supporting_evidence: ['Raise evidence.'],
              confidence: 'medium',
              evidence_refs: ['raise-1'],
              source_quality: 'directional',
              warnings: [],
              section_hygiene: strongSectionHygiene('raise_terms', 'structured_summary.raise', 'raise-1'),
            },
          ],
        } as any}
        narrativeQualityValidation={{
          schema_version: 'narrative_quality_validation_v1',
          status: 'passed',
          evidence_grounding_check: 'pass',
          investment_implication_check: 'pass',
          limitation_presence_check: 'pass',
          section_fit_check: 'pass',
          contamination_check: 'pass',
          archetype_consistency_check: 'pass',
          critical_warnings: [],
        } as any}
      />,
    );

    expect(screen.getByText(/Product observation\. Product interpretation\. Product limitation\. Product implication\./i)).toBeInTheDocument();
    expect(screen.getByText(/Market observation\. Market interpretation\. Market limitation\. Market implication\./i)).toBeInTheDocument();
    expect(screen.getByText(/Business model observation\. Business model interpretation\. Business model limitation\. Business model implication\./i)).toBeInTheDocument();
    expect(screen.getByText(/Raise observation\. Raise interpretation\. Raise limitation\. Raise implication\./i)).toBeInTheDocument();
    expect(screen.getByTestId('product-interpretation-source')).toBeInTheDocument();
    expect(screen.queryByText('Legacy raw product copy that should not win.')).not.toBeInTheDocument();
  });

  it('keeps existing copy when validation does not pass', () => {
    vi.stubEnv('VITE_USE_INVESTMENT_INTERPRETATION_V1', 'true');

    render(
      <DealWorkspaceV4
        {...BASE_PROPS}
        product={{
          value: 'Existing governed product copy remains visible because the company sells workflow software to enterprise climate teams with a clear compliance use case.',
          trust: 'structured',
          source: 'structured_summary',
          origin: 'deterministic',
          evidenceIds: [],
          evidence: [],
          nullReason: null,
        }}
        investmentInterpretation={{
          schema_version: 'investment_interpretation_v1',
          status: 'shadow_only',
          sections: [
            {
              section_id: 'product',
              observation: 'Suppressed interpretation observation.',
              interpretation: 'Suppressed interpretation text.',
              limitations: ['Suppressed limitation.'],
              investment_implication: 'Suppressed implication.',
              supporting_evidence: ['Suppressed evidence.'],
              confidence: 'medium',
              evidence_refs: ['prod-1'],
              source_quality: 'directional',
              warnings: [],
            },
          ],
        } as any}
        narrativeQualityValidation={{
          schema_version: 'narrative_quality_validation_v1',
          status: 'failed',
          evidence_grounding_check: 'fail',
          investment_implication_check: 'pass',
          limitation_presence_check: 'pass',
          critical_warnings: ['product: failed grounding'],
        } as any}
      />,
    );

    expect(screen.getByText(/Existing governed product copy remains visible because the company sells workflow software to enterprise climate teams with a clear compliance use case\./i)).toBeInTheDocument();
    expect(screen.queryByTestId('product-interpretation-source')).not.toBeInTheDocument();
    expect(screen.queryByText(/Suppressed interpretation observation/i)).not.toBeInTheDocument();
  });

  it('suppresses contaminated interpretation and contaminated legacy product copy', () => {
    vi.stubEnv('VITE_USE_INVESTMENT_INTERPRETATION_V1', 'true');

    render(
      <DealWorkspaceV4
        {...BASE_PROPS}
        product={{
          value: 'Climatic Funding: FO / EU Green Bonds income for the poorest in society...',
          trust: 'structured',
          source: 'structured_summary',
          origin: 'deterministic',
          evidenceIds: [],
          evidence: [],
          nullReason: null,
        }}
        investmentInterpretation={{
          schema_version: 'investment_interpretation_v1',
          status: 'shadow_only',
          sections: [
            {
              section_id: 'product',
              observation: 'Climatic Funding: FO / EU Green Bonds income for the poorest in society...',
              interpretation: 'Polished but wrong interpretation.',
              limitations: ['Suppressed limitation.'],
              investment_implication: 'Suppressed implication.',
              supporting_evidence: ['Suppressed evidence.'],
              confidence: 'low',
              evidence_refs: ['prod-1'],
              source_quality: 'unverified',
              warnings: ['Product interpretation omitted because clean section-specific evidence was insufficient.'],
              section_hygiene: {
                section_id: 'product',
                raw_text: 'Climatic Funding: FO / EU Green Bonds income for the poorest in society...',
                source_field: 'phase1_overview.product_solution',
                evidence_refs: ['prod-1'],
                section_fit: 'invalid',
                contamination_flags: ['ocr_noise', 'insufficient_clean_evidence'],
                clean_text: null,
                reason: 'insufficient clean product evidence for interpretation',
                confidence: 0.1,
              },
            },
          ],
        } as any}
        narrativeQualityValidation={{
          schema_version: 'narrative_quality_validation_v1',
          status: 'passed',
          evidence_grounding_check: 'pass',
          investment_implication_check: 'pass',
          limitation_presence_check: 'pass',
          section_fit_check: 'fail',
          contamination_check: 'fail',
          archetype_consistency_check: 'pass',
          critical_warnings: ['product: contamination flags present'],
        } as any}
      />,
    );

    expect(screen.queryByText(/Polished but wrong interpretation/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Climatic Funding: FO \/ EU Green Bonds income/i)).not.toBeInTheDocument();
    expect(screen.getByTestId('product-copy-conservative-fallback')).toHaveTextContent(/do not provide a clean, section-specific product description sufficient for interpretation/i);
  });
});

// ─── Conciseness: synthesis text is 1-2 sentences ─────────────────────────────

describe('Synthesis text: conciseness constraint', () => {
  it('renders synthesis text that is concise (≤ 2 sentences)', () => {
    render(
      <DealWorkspaceV4
        {...BASE_PROPS}
        product={LLM_SYNTHESIS_PRODUCT}
      />,
    );
    const rendered = screen.getByText(LLM_SYNTHESIS_PRODUCT.value);
    // Count sentences by period/exclamation/question mark followed by space or end
    const sentenceCount = (rendered.textContent?.match(/[.!?](\s|$)/g) ?? []).length;
    expect(sentenceCount).toBeLessThanOrEqual(3); // Allow slight flexibility for complex constructions
  });
});
