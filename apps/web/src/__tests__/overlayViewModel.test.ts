import { describe, expect, test } from 'vitest';

import { buildOverlayViewModel } from '../lib/overlay/overlayViewModel';

describe('buildOverlayViewModel', () => {
  test('returns safe defaults for null-ish input', () => {
    const vm = buildOverlayViewModel(null);
    expect(vm.meta.llm_phase_mode).toBeNull();
    expect(vm.meta.created_at).toBeNull();
    expect(vm.meta.input_hash).toBeNull();
    expect(vm.meta.quality_flags).toEqual([]);
    expect(vm.hero_summary).toBeNull();
    expect(vm.facts.product).toBeNull();
    expect(vm.facts.market_icp).toBeNull();
    expect(vm.facts.business_model).toBeNull();
    expect(vm.facts.raise_terms).toBeNull();
    expect(vm.deal_summary.hero).toBeNull();
    expect(vm.deal_summary_paragraphs).toEqual([]);
    expect(vm.strengths).toEqual([]);
    expect(vm.concerns).toEqual([]);
    expect(vm.open_items).toEqual([]);
    expect(vm.coverage_gaps).toEqual([]);
    expect(vm.kpis.raise?.value ?? null).toBeNull();
  });

  test('accepts a wrapped { overview } response and extracts summary + lists', () => {
    const res: any = {
      overview: {
        llm_phase_mode: 'exploratory',
        created_at: '2026-02-12T00:00:00.000Z',
        input_hash: 'hash-1',
        quality_flags: { provider_error: true, guard_degraded: false },
        overview_json: {
          phase1: {
            deal_overview_v2: {
              product_solution: 'Product X',
              market_icp: 'Mid-market logistics teams',
              business_model: 'SaaS',
              raise_terms: '$2M seed',
              key_risks_detected: ['Sparse revenue evidence'],
            },
            deal_summary_v2: {
              summary: {
                one_liner: 'WebMax builds fast diligence tooling.',
                paragraphs: ['Paragraph one.', 'Paragraph two.'],
              },
              strengths: ['Fast execution', 'Clear ICP'],
              risks: ['Market crowded'],
              open_questions: ['Retention by cohort?'],
            },
          },
        },
      },
    };

    const vm = buildOverlayViewModel(res);
    expect(vm.meta.llm_phase_mode).toBe('exploratory');
    expect(vm.meta.input_hash).toBe('hash-1');
    expect(vm.meta.quality_flags).toEqual(['provider_error']);

    expect(vm.hero_summary).toBe('WebMax builds fast diligence tooling.');
    expect(vm.facts.product).toBe('Product X');
    expect(vm.facts.market_icp).toBe('Mid-market logistics teams');
    expect(vm.facts.business_model).toBe('SaaS');
    expect(vm.facts.raise_terms).toBe('$2M seed');
    expect(vm.deal_summary.hero).toBe('WebMax builds fast diligence tooling.');
    expect(vm.deal_summary.overview).toBe('Paragraph one.');
    expect(vm.deal_summary.deep).toBe('Paragraph two.');
    expect(vm.deal_summary_paragraphs).toEqual(['Paragraph one.', 'Paragraph two.']);

    expect(vm.kpis.raise?.value).toBe('$2M seed');
    expect(vm.strengths).toEqual(['Fast execution', 'Clear ICP']);
    // concerns includes risks + key_risks_detected (deduped)
    expect(vm.concerns).toEqual(['Market crowded', 'Sparse revenue evidence']);
    expect(vm.open_items).toEqual(['Retention by cohort?']);
  });

  test('handles overview_json as a string and supports array quality flags', () => {
    const vm = buildOverlayViewModel({
      llm_phase_mode: 'governed',
      quality_flags: ['model_output_not_json', 'model_output_not_json'],
      overview_json: JSON.stringify({
        phase1: {
          deal_summary_v2: { summary: { one_liner: 'One liner', paragraphs: [] } },
        },
      }),
    });

    expect(vm.meta.llm_phase_mode).toBe('governed');
    expect(vm.meta.quality_flags).toEqual(['model_output_not_json']);
    expect(vm.hero_summary).toBe('One liner');
    expect(vm.deal_summary_paragraphs).toEqual([]);
  });

  test('falls back to claim values for KPI strings when overview lacks them', () => {
    const vm = buildOverlayViewModel({
      claims: [
        { label: 'Revenue', value_string: '$1M ARR' },
        { label: 'ARR', value_number: 1200000 },
        { label: 'Customers', value_number: 85 },
        { label: 'Growth YoY', value_text: '120% YoY' },
      ],
      overview_json: {
        phase1: {
          deal_summary_v2: { summary: { one_liner: 'X', paragraphs: [] } },
          deal_overview_v2: {},
        },
      },
    });

    expect(vm.kpis.revenue?.value).toBe('$1M ARR');
    expect(vm.kpis.customers?.value).toBe('85');
    expect(vm.kpis.growth?.value).toBe('120% YoY');
  });
});
