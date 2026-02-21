import { buildDeterministicDealSummaryV1FromStructuredSummary } from '../deal-summary-v1-deterministic';

describe('deterministic deal_summary_v1 (lock) regression', () => {
  it('uses raise amount (not TAM/valuation) and cites correct slides', () => {
    const structured_summary: any = {
      raise: {
        value: '$8B',
        value_json: { amount: { amount: 2_000_000, currency: 'USD' } },
        round_label: 'Seed',
        sources: [
          {
            source_document_id: 'doc-ask',
            page_index: 0,
            slide_title: 'The Ask: Raising $2M',
            note_snippet: 'The Ask: Raising $2M via SAFE',
          },
        ],
      },
      product_summary_v1: {
        value: 'WebMax builds diligence tooling for investors.',
        sources: [
          {
            source_document_id: 'doc-prod',
            page_index: 11,
            slide_title: 'Product',
            note_snippet: 'WebMax builds diligence tooling…',
          },
        ],
      },
      market_summary_v1: {
        value: 'Targets mid-market PE firms and VC analysts.',
        sources: [
          {
            source_document_id: 'doc-mkt',
            page_index: 23,
            slide_title: 'Market / ICP',
            note_snippet: 'Targets mid-market PE…',
          },
        ],
      },
      // Add a misleading TAM slide to ensure it never pollutes raise.
      market_size_v1: {
        value: '$8B TAM',
        sources: [
          {
            source_document_id: 'doc-tam',
            page_index: 1,
            slide_title: '$8B TAM',
            note_snippet: '$8B TAM',
          },
        ],
      },
    };

    const summary = buildDeterministicDealSummaryV1FromStructuredSummary({ structured_summary });
    expect(summary.ready).toBe(true);

    // Raise must use $2M from value_json.amount.amount.
    expect(summary.tiers.overview).toContain('Raise: $2M');
    expect(summary.tiers.overview).not.toContain('$8B');

    // One-liner is product-first and cites product slide.
    expect(summary.one_liner?.text).toContain('WebMax builds diligence tooling');
    expect(summary.one_liner?.sources?.[0]?.source_document_id).toBe('doc-prod');
    expect(summary.one_liner?.sources?.[0]?.page_index).toBe(11);

    // Paragraph citations must include the ask slide (page 0).
    const paraCites = (summary.paragraphs ?? []).flatMap((p) => p.sources ?? []);
    const hasAsk = paraCites.some((c) => c.source_document_id === 'doc-ask' && c.page_index === 0);
    expect(hasAsk).toBe(true);

    // Ensure TAM doc is never cited for raise by default.
    const hasTam = paraCites.some((c) => c.source_document_id === 'doc-tam');
    expect(hasTam).toBe(false);
  });
});
