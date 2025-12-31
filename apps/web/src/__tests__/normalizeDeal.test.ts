import { describe, expect, test } from 'vitest';

import { normalizeDeal } from '../lib/apiClient';

describe('normalizeDeal (Phase 1 executive summary)', () => {
  test('maps executive_summary_v1.one_liner -> ui.executiveSummary.summary', () => {
    const raw: any = {
      id: 'deal-1',
      name: 'WebMax',
      executive_summary_v1: {
        title: 'Executive Summary',
        one_liner: 'WebMax builds fast diligence tooling.',
      },
    };

    const normalized = normalizeDeal(raw);
    expect((normalized as any).ui).toBeTruthy();
    expect((normalized as any).ui.executiveSummary).toBeTruthy();
    expect((normalized as any).ui.executiveSummary.summary).toBe('WebMax builds fast diligence tooling.');
    expect((normalized as any).ui.executiveSummary.title).toBe('WebMax — Executive Summary');
  });

  test('maps dio.phase1.executive_summary_v2 -> ui.executiveSummaryV2 (preserves V1)', () => {
    const raw: any = {
      id: 'deal-2',
      name: 'V2Co',
      executive_summary_v1: {
        title: 'Executive Summary',
        one_liner: 'V1 one liner.',
      },
      dio: {
        phase1: {
          executive_summary_v2: {
            paragraphs: ['V2 paragraph 1.', 'V2 paragraph 2.'],
            highlights: ['H1', 'H2'],
            missing: ['product_solution'],
          },
        },
      },
    };

    const normalized = normalizeDeal(raw);
    expect((normalized as any).ui.executiveSummaryV2).toBeTruthy();
    expect((normalized as any).ui.executiveSummaryV2.paragraphs[0]).toBe('V2 paragraph 1.');
    // V1 remains available
    expect((normalized as any).ui.executiveSummary.summary).toBe('V1 one liner.');
  });
});
