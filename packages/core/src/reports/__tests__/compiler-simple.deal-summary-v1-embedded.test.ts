import { makeFixture } from './helpers/makeFixtureReport';

describe('compiler-simple: deal_summary_v1 embedding', () => {
  test('embeds structured_summary.deal_summary_v1', () => {
    const { report } = makeFixture({
      pages: [
        {
          document_id: '00000000-0000-4000-8000-00000000d001',
          page_index: 0,
          page: 1,
          text: 'Raising $2M Seed SAFE.',
        },
        {
          document_id: '00000000-0000-4000-8000-00000000d001',
          page_index: 1,
          page: 2,
          text: 'ARR $1.2M in 2025. Revenue is growing.',
        },
      ],
    });

    expect(report).toBeTruthy();
    expect(report.structured_summary).toBeTruthy();
    expect(report.structured_summary?.deal_summary_v1?.version).toBe('deal_summary_v1');
    expect(typeof report.structured_summary?.deal_summary_v1?.tiers?.hero).toBe('string');
  });
});
