import { describe, expect, test } from 'vitest';

import { selectDealWorkspaceHeader } from '../selectDealWorkspaceHeader';

describe('selectDealWorkspaceHeader', () => {
  test('when report is ready and arbitration exists: business_model prefers arbitration and indicates Arbitrated', () => {
    const report: any = {
      ready: true,
      structured_summary: {
        business_model_summary: { value: 'Real estate investment (synthesized)' },
        business_model: { value: 'Real estate investment (promoted)', label: 'Attributed', sources: [] },
        kpis: {
          business_model: { value: 'Real estate investment (promoted)', label: 'Attributed', sources: [] },
        },
      },
    };

    const phase1: any = {
      business_model_arbitration_v1: { business_model: 'saas', confidence: 0.83 },
      business_model: 'SHOULD_NOT_WIN',
    };

    const selected = selectDealWorkspaceHeader(report, phase1);
    expect(selected.ready).toBe(true);
    expect(selected.business_model.value).toBe('saas');
    expect(selected.business_model.label).toBe('Arbitrated');
    expect(selected.business_model_synthesized.value).toBeNull();
  });

  test('when report is ready: routes only from report.structured_summary (ignores Phase 1)', () => {
    const sourcesRef = [{ document_id: 'doc-1', page_index: 3, note_snippet: 'from deck' }];

    const report: any = {
      ready: true,
      structured_summary: {
        kpis: {
          raise: { value: '$5M', label: 'Attributed', sources: sourcesRef },
          business_model: { value: 'SaaS', label: 'Attributed', sources: [] },
          revenue: { value: { raw: '$850K ARR' }, label: 'Forecast', sources: sourcesRef },
          growth: { value: { raw: '40% MoM' }, label: 'Forecast', sources: sourcesRef },
          customers: { value: { raw: '15 customers' }, label: 'Wholesale', sources: sourcesRef },
        },
      },
    };

    const phase1: any = {
      raise: 'SHOULD_NOT_WIN',
      business_model: 'SHOULD_NOT_WIN',
      revenue: 'SHOULD_NOT_WIN',
      growth: 'SHOULD_NOT_WIN',
      customers: 'SHOULD_NOT_WIN',
    };

    const selected = selectDealWorkspaceHeader(report, phase1);

    expect(selected.ready).toBe(true);
    expect(selected.raise.value).toBe('$5M');
    expect(selected.raise.label).toBe('Attributed');
    expect(selected.raise.sources).toBe(sourcesRef);

    expect(selected.business_model_synthesized.value).toBeNull();

    expect(selected.revenue.value).toBe('$850K ARR');
    expect(selected.revenue.label).toBe('Forecast');
    expect(selected.revenue.sources).toBe(sourcesRef);

    expect(selected.growth.value).toBe('40% MoM');
    expect(selected.customers.value).toBe('15 customers');
  });

  test('when report is ready and structured_summary contains both top-level + kpis: prefers structured_summary.kpis.*', () => {
    const sourcesRef = [{ document_id: 'doc-1', page_index: 3, note_snippet: 'from deck' }];

    const report: any = {
      ready: true,
      structured_summary: {
        // Top-level values (should lose)
        raise: { value: '$2M Seed', label: 'Top', sources: sourcesRef },
        business_model: { value: 'Top BM', label: 'Top', sources: sourcesRef },
        revenue: { value: { raw: '$800K ARR' }, label: 'Top', sources: sourcesRef },
        growth: { value: { raw: '30% MoM' }, label: 'Top', sources: sourcesRef },
        customers: { value: { raw: '12 customers' }, label: 'Top', sources: sourcesRef },
        // Nested canonical values (should win)
        kpis: {
          raise: { value: '$3M Seed', label: 'KPI', sources: sourcesRef },
          business_model: { value: 'KPI BM', label: 'KPI', sources: sourcesRef },
          revenue: { value: { raw: '$900K ARR' }, label: 'KPI', sources: sourcesRef },
          growth: { value: { raw: '40% MoM' }, label: 'KPI', sources: sourcesRef },
          customers: { value: { raw: '15 customers' }, label: 'KPI', sources: sourcesRef },
        },
      },
    };

    const selected = selectDealWorkspaceHeader(report, null);

    expect(selected.ready).toBe(true);
    expect(selected.raise.value).toBe('$3M Seed');
    expect(selected.raise.label).toBe('KPI');
    expect(selected.revenue.value).toBe('$900K ARR');
    expect(selected.growth.value).toBe('40% MoM');
    expect(selected.customers.value).toBe('15 customers');
    expect(selected.business_model.value).toBe('KPI BM');
    expect(selected.business_model.label).toBe('KPI');
  });

  test('when report is not ready: routes only from Phase 1 (ignores structured_summary)', () => {
    const report: any = {
      ready: false,
      structured_summary: {
        raise: { value: '$999M', label: 'Attributed', sources: [{ document_id: 'doc-x' }] },
        business_model: { value: 'IGNORE_ME', sources: [] },
        revenue: { value: { raw: 'IGNORE_ME' }, sources: [] },
        growth: { value: { raw: 'IGNORE_ME' }, sources: [] },
        customers: { value: { raw: 'IGNORE_ME' }, sources: [] },
      },
    };

    const phase1: any = {
      raise: 'Seed',
      business_model: 'Marketplace',
      revenue: 'N/A',
      growth: '10% YoY',
      customers: '42 users',
    };

    const selected = selectDealWorkspaceHeader(report, phase1);

    expect(selected.ready).toBe(false);
    expect(selected.raise.value).toBe('Seed');
    expect(selected.business_model.value).toBe('Marketplace');
    expect(selected.revenue.value).toBe('N/A');
    expect(selected.growth.value).toBe('10% YoY');
    expect(selected.customers.value).toBe('42 users');

    expect(selected.raise.value).not.toBe('$999M');
  });

  test('when report is ready but structured_summary is missing: returns nulls (no Phase 1 mixing)', () => {
    const report: any = { ready: true };
    const phase1: any = { raise: '$1M', business_model: 'SaaS' };

    const selected = selectDealWorkspaceHeader(report, phase1);

    expect(selected.ready).toBe(true);
    expect(selected.raise.value).toBeNull();
    expect(selected.business_model.value).toBeNull();
    expect(selected.business_model_synthesized.value).toBeNull();
  });

  test('when report is ready and business_model_summary exists: business_model prefers synthesized and sets label', () => {
    const report: any = {
      ready: true,
      structured_summary: {
        business_model_summary: {
          value: 'DTC + wholesale apparel',
          confidence: 0.72,
          derived_from: { product_pages: [12], gtm_pages: [15], distribution_pages: [23], traction_pages: [8], market_pages: [], other_pages: [] },
          supporting_nodes: [],
        },
        business_model: { value: 'Usage-based SaaS', label: 'Attributed', sources: [{ document_id: 'doc-x', page_index: 3 }] },
        kpis: {
          business_model: { value: 'Usage-based SaaS', label: 'Attributed', sources: [{ document_id: 'doc-x', page_index: 3 }] },
        },
      },
    };

    const selected = selectDealWorkspaceHeader(report, null);

    expect(selected.ready).toBe(true);
    expect(selected.business_model_synthesized.value).toBeNull();
    expect(selected.business_model.value).toBe('Usage-based SaaS');
    expect(selected.business_model.label).toBe('Attributed');
  });

  test('when report is ready and business_model_summary is null: business_model falls back to promoted (no synthesized label)', () => {
    const report: any = {
      ready: true,
      structured_summary: {
        business_model_summary: { value: null },
        business_model: { value: 'Usage-based SaaS', label: 'Attributed', sources: [{ document_id: 'doc-1', page_index: 1 }] },
        kpis: {
          business_model: { value: 'Usage-based SaaS', label: 'Attributed', sources: [{ document_id: 'doc-1', page_index: 1 }] },
        },
      },
    };

    const selected = selectDealWorkspaceHeader(report, null);

    expect(selected.ready).toBe(true);
    expect(selected.business_model_synthesized.value).toBeNull();
    expect(selected.business_model_synthesized.label).toBeUndefined();
    expect(selected.business_model.value).toBe('Usage-based SaaS');
    expect(selected.business_model.label).toBe('Attributed');
  });
});
