import { describe, expect, it } from 'vitest';
import { synthesizeInvestmentInterpretationV1 } from '../investment-interpretation-synthesizer-v1';
import { validateNarrativeQualityV1 } from '../narrative-quality-validator-v1';

describe('synthesizeInvestmentInterpretationV1', () => {
  it('builds deterministic shadow sections from structured and phase1 inputs', () => {
    const result = synthesizeInvestmentInterpretationV1({
      deal_id: 'deal-1',
      report_id: 'report-1',
      run_id: 'run-1',
      company_name: 'TestCo',
      canonical_verdict: 'INVESTIGATE',
      archetype: 'saas',
      selected_policy_id: 'policy-1',
      structured_summary: {
        business_model: {
          value: 'The company sells annual SaaS subscriptions to enterprise compliance teams.',
          sources: [{ evidence_id: 'e-bm-1', note_snippet: 'Annual subscription contracts with enterprise customers' }],
        },
        raise: {
          value: 'Raising $5M to fund product delivery and commercial hiring.',
          sources: [{ evidence_id: 'e-raise-1', note_snippet: 'Seeking a $5M round to scale go-to-market execution' }],
        },
      },
      phase1_overview: {
        product_solution: 'A workflow automation platform for climate reporting teams.',
        market_icp: 'Mid-market industrial companies facing new disclosure requirements.',
        sources: [{ evidence_id: 'e-p1-1', note_snippet: 'Targets climate reporting workflows for regulated operators' }],
      },
      promoted_facts_sample: [
        { evidence_id: 'pf-1', fact_type: 'product', summary: 'Platform automates carbon accounting workflows.', confidence: 0.92 },
        { evidence_id: 'pf-2', fact_type: 'market', summary: 'Customers are mid-market manufacturers with reporting mandates.', confidence: 0.88 },
      ],
      financial_verification: {
        schema_version: 'llm_financial_verification_v1',
        deal_id: 'deal-1',
        run_id: 'run-1',
        created_at: '2026-05-08T00:00:00.000Z',
        company_name: 'TestCo',
        has_xlsx: true,
        cap_table_present: true,
        financial_gaps: [],
        deck_vs_xlsx_conflicts: [],
        confidence: 'high',
        status: 'shadow_only',
        provider: 'openai',
        model: 'gpt-5.4',
      } as any,
      validation_summary: {
        schema_version: 'llm_validation_summary_v1',
        deal_id: 'deal-1',
        run_id: 'run-1',
        created_at: '2026-05-08T00:00:00.000Z',
        high_confidence_disagreements: 0,
        status: 'shadow_only',
      } as any,
      accepted_corrections: ['revenue -> arr: normalization'],
      underwriting_readiness: null,
    });

    expect(result).not.toBeNull();
    expect(result?.status).toBe('shadow_only');
    expect(result?.sections.map((section) => section.section_id)).toEqual([
      'product',
      'market',
      'business_model',
      'raise_terms',
    ]);
    expect(result?.sections[0]?.evidence_refs.length).toBeGreaterThan(0);
  });
});

describe('validateNarrativeQualityV1', () => {
  it('fails generic and unsupported investment language without grounding', () => {
    const validation = validateNarrativeQualityV1({
      deal_id: 'deal-1',
      run_id: 'run-1',
      interpretation: {
        schema_version: 'investment_interpretation_v1',
        deal_id: 'deal-1',
        report_id: 'report-1',
        run_id: 'run-1',
        created_at: '2026-05-08T00:00:00.000Z',
        status: 'shadow_only',
        synthesizer_version: 'deterministic_v1',
        sections: [
          {
            section_id: 'product',
            observation: 'A workflow automation platform for climate reporting teams.',
            interpretation: 'This is a compelling investment opportunity with verified evidence across key underwriting dimensions.',
            supporting_evidence: [],
            limitations: [],
            investment_implication: 'Supports proceeding because the score is 82/100.',
            confidence: 'low',
            evidence_refs: [],
            source_quality: 'unverified',
            warnings: [],
          },
        ],
      },
    });

    expect(validation.status).toBe('failed');
    expect(validation.evidence_grounding_check).toBe('warning');
    expect(validation.score_narration_check).toBe('fail');
    expect(validation.unsupported_claim_check).toBe('warning');
  });

  it('passes grounded interpretation with implication, limitation, and evidence refs', () => {
    const validation = validateNarrativeQualityV1({
      deal_id: 'deal-1',
      run_id: 'run-1',
      interpretation: {
        schema_version: 'investment_interpretation_v1',
        deal_id: 'deal-1',
        report_id: 'report-1',
        run_id: 'run-1',
        created_at: '2026-05-08T00:00:00.000Z',
        status: 'shadow_only',
        synthesizer_version: 'deterministic_v1',
        sections: [
          {
            section_id: 'market',
            observation: 'The company targets mid-market industrial customers facing climate disclosure mandates.',
            interpretation: 'That focus suggests the sales motion may benefit from a clear regulatory trigger instead of depending on discretionary software budgets.',
            supporting_evidence: ['Customers face mandatory disclosure requirements in the EU supply chain.'],
            limitations: ['Current materials do not yet prove renewal durability or acquisition efficiency.'],
            investment_implication: 'For capital, demand should be underwritten through repeatable conversion and retention evidence before market strength is treated as durable.',
            confidence: 'medium',
            evidence_refs: ['e-1'],
            source_quality: 'directional',
            warnings: [],
          },
        ],
      },
    });

    expect(validation.status).toBe('passed');
    expect(validation.evidence_grounding_check).toBe('pass');
    expect(validation.investment_implication_check).toBe('pass');
    expect(validation.limitation_presence_check).toBe('pass');
  });
});