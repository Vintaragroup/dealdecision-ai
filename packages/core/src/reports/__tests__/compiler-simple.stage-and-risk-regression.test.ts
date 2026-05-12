import { compileDIOToReportWithPromotedFacts } from '../compiler-simple';

function makeBaseDio(now: string): any {
  return {
    schema_version: '1.0.0',
    dio_id: '00000000-0000-4000-8000-000000002001',
    deal_id: '00000000-0000-4000-8000-000000002002',
    created_at: now,
    updated_at: now,
    analysis_version: 1,
    dio_context: { primary_doc_type: 'pitch_deck' },
    inputs: {
      documents: [],
      evidence: [],
      config: { analyzer_versions: {}, features: {}, parameters: {} },
    },
    analyzer_results: {
      slide_sequence: { analyzer_version: '1.0.0', executed_at: now, status: 'insufficient_data', coverage: 0, confidence: 0 },
      metric_benchmark: {
        analyzer_version: '1.0.0',
        executed_at: now,
        status: 'insufficient_data',
        coverage: 0,
        confidence: 0,
        metrics_analyzed: [],
      },
      visual_design: { analyzer_version: '1.0.0', executed_at: now, status: 'insufficient_data', coverage: 0, confidence: 0 },
      narrative_arc: { analyzer_version: '1.0.0', executed_at: now, status: 'insufficient_data', coverage: 0, confidence: 0 },
      financial_health: {
        analyzer_version: '1.0.0',
        executed_at: now,
        status: 'insufficient_data',
        coverage: 0,
        confidence: 0,
        health_score: null,
        runway_months: null,
        burn_multiple: null,
        risks: [],
        evidence_ids: [],
      },
      risk_assessment: {
        analyzer_version: '1.0.0',
        executed_at: now,
        status: 'ok',
        coverage: 1,
        confidence: 0.8,
        overall_risk_score: 55,
        total_risks: 1,
        critical_count: 0,
        high_count: 0,
        risks_by_category: {
          market: [],
          team: [],
          financial: [
            {
              risk_id: 'risk-1',
              category: 'financial',
              severity: 'medium',
              description: 'Pre-revenue stage - monetization unproven',
              evidence_id: '00000000-0000-4000-8000-000000002003',
            },
          ],
          execution: [],
        },
        evidence_ids: [],
      },
    },
    dio: {
      phase1: {
        claims: [],
      },
      phase_inference_v1: {
        company_phase: 'pre-seed',
      },
    },
  };
}

describe('compileDIOToReportWithPromotedFacts public-stage and risk consistency regressions', () => {
  it('infers public_company stage from SEC 8-K filename metadata', () => {
    const now = new Date().toISOString();
    const dio = makeBaseDio(now);

    const report = compileDIOToReportWithPromotedFacts(dio, {
      documents: [
        {
          document_id: 'doc-1',
          kind: 'other',
          filename: 'Acme Form 8-K Current Report.pdf',
          mime_type: 'application/pdf',
        },
      ],
    });

    expect(report.funding_stage_v1?.funding_stage).toBe('public_company');
  });

  it('infers public_company stage from page text Form 10-K hints', () => {
    const now = new Date().toISOString();
    const dio = makeBaseDio(now);

    const report = compileDIOToReportWithPromotedFacts(dio, {
      pageTexts: ['FORM 10-K ANNUAL REPORT PURSUANT TO SECTION 13 OR 15(d) OF THE SECURITIES EXCHANGE ACT'],
    });

    expect(report.funding_stage_v1?.funding_stage).toBe('public_company');
  });

  it('suppresses pre-revenue risk when structured revenue indicates meaningful current revenue', () => {
    const now = new Date().toISOString();
    const dio = makeBaseDio(now);

    const promotedFacts: any[] = [
      {
        fact_type: 'revenue_v1',
        confidence: 0.9,
        extracted_at: now,
        content_json: {
          fact_type: 'revenue_v1',
          value_json: {
            display: '$65MM',
            raw: '$65MM',
            subtype: 'current',
            scope: 'company_total',
            amount: { amount: 65_000_000, currency: 'USD' },
          },
          provenance: {
            source_document_id: 'doc-1',
            page_index: 0,
          },
        },
        meta: { document_id: 'doc-1', page_index: 0 },
      },
    ];

    const report = compileDIOToReportWithPromotedFacts(dio, { promotedFacts });

    const redFlags = Array.isArray(report.redFlags) ? report.redFlags : [];
    expect(redFlags.some((f: any) => String(f?.message ?? '').toLowerCase() === 'pre-revenue stage - monetization unproven')).toBe(false);

    const riskSection = (Array.isArray(report.sections) ? report.sections : []).find((s: any) => s?.id === 'risk-assessment');
    expect(String(riskSection?.content ?? '')).not.toMatch(/pre-revenue stage - monetization unproven/i);
  });
});
