import { describe, expect, test } from 'vitest';

import { selectAuthoritativeBusinessModelV1 } from '../selectors/selectAuthoritativeBusinessModelV1';

describe('selectAuthoritativeBusinessModelV1', () => {
  test('prefers phase1.business_model_arbitration_v1 over report structured business model', () => {
    const report: any = {
      ready: true,
      structured_summary: {
        business_model_summary: { value: 'Real estate investment (synthesized)' },
        business_model: { value: 'Real estate investment (promoted)' },
      },
    };

    const phase1: any = {
      business_model_arbitration_v1: { business_model: 'saas', confidence: 0.81 },
      business_model: 'SHOULD_NOT_WIN',
    };

    const selected = selectAuthoritativeBusinessModelV1({ report, phase1 });
    expect(selected.value).toBe('saas');
    expect(selected.label).toBe('Arbitrated');
    expect(selected.is_arbitrated).toBe(true);
    expect(selected.source).toBe('arbitration');
  });

  test('when no arbitration and report is ready: prefers promoted when evidence-backed', () => {
    const report: any = {
      ready: true,
      structured_summary: {
        business_model_summary: { value: 'Synthesized model', confidence: 0.72 },
        business_model: { value: 'Promoted model', label: 'Attributed', sources: [{ document_id: 'doc-1', page_index: 2 }] },
      },
    };

    const selected = selectAuthoritativeBusinessModelV1({ report, phase1: null });
    expect(selected.value).toBe('Promoted model');
    expect(selected.label).toBe('Attributed');
    expect(selected.is_arbitrated).toBe(false);
    expect(selected.source).toBe('report.business_model');
  });

  test('when report.ready===true but structured_summary is missing: returns null (no Phase 1 mixing)', () => {
    const report: any = { ready: true };
    const phase1: any = { business_model: 'SaaS (legacy)' };

    const selected = selectAuthoritativeBusinessModelV1({ report, phase1 });
    expect(selected.value).toBeNull();
    expect(selected.source).toBe('missing');
  });

  test('when report is not ready: falls back to Phase 1 legacy business_model', () => {
    const report: any = { ready: false, structured_summary: { business_model: { value: 'IGNORE_ME' } } };
    const phase1: any = { business_model: 'Marketplace' };

    const selected = selectAuthoritativeBusinessModelV1({ report, phase1 });
    expect(selected.value).toBe('Marketplace');
    expect(selected.source).toBe('phase1.legacy');
  });
});
