import { inferFinancialCoverageProfileV1 } from '../financial-coverage-profile.js';

describe('inferFinancialCoverageProfileV1', () => {
  test('XLSX present + income statement signals -> confidence high, sources include xlsx', () => {
    const res = inferFinancialCoverageProfileV1({
      structured_summary: {},
      promoted_facts: [
        {
          fact_type: 'note',
          content_json: {
            text: 'Income Statement (P&L): revenue, COGS, gross margin, opex',
            provenance: { source_document_id: 'doc_deck', page_index: 2 },
          },
        },
      ],
      documents: [
        { document_id: 'doc_xlsx', mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', filename: 'model.xlsx' },
        { document_id: 'doc_deck', mime_type: 'application/pdf', filename: 'deck.pdf' },
      ],
    });

    expect(res.sources.some((s) => s.kind === 'xlsx' && s.document_id === 'doc_xlsx')).toBe(true);
    expect(res.coverage.income_statement_present).toBe(true);
    expect(res.confidence).toBe('high');
  });

  test('Only TAM present -> revenue flags remain false, confidence low', () => {
    const res = inferFinancialCoverageProfileV1({
      structured_summary: {
        revenue: {
          candidates: [
            {
              year: new Date().getFullYear(),
              value_raw: '$8B TAM',
              sources: [{ document_id: 'doc_deck', page_index: 1 }],
            },
          ],
        },
      },
      promoted_facts: [
        {
          fact_type: 'market_size_v1',
          content_json: { text: '$8B TAM' },
        },
      ],
      documents: [{ document_id: 'doc_deck', mime_type: 'application/pdf', filename: 'deck.pdf' }],
    });

    expect(res.coverage.historical_revenue_present).toBe(false);
    expect(res.coverage.forecast_revenue_present).toBe(false);
    expect(res.confidence).toBe('low');
  });

  test('Forecast years present but no historical -> forecast true, historical false', () => {
    const nextYear = new Date().getFullYear() + 1;
    const res = inferFinancialCoverageProfileV1({
      structured_summary: {
        revenue: {
          candidates: [
            {
              year: nextYear,
              subtype: 'forecast',
              value_raw: `Revenue forecast ${nextYear}: $5M`,
              sources: [{ document_id: 'doc_deck', page_index: 5 }],
            },
          ],
        },
      },
      promoted_facts: null,
      documents: [{ document_id: 'doc_deck', mime_type: 'application/pdf', filename: 'deck.pdf' }],
    });

    expect(res.coverage.forecast_revenue_present).toBe(true);
    expect(res.coverage.historical_revenue_present).toBe(false);
  });

  test('Unit economics terms present -> unit_economics_present true', () => {
    const res = inferFinancialCoverageProfileV1({
      structured_summary: {},
      promoted_facts: [
        {
          fact_type: 'note',
          content_json: {
            text: 'Unit economics: CAC $200, LTV $1,200, payback period 6 months',
            provenance: { source_document_id: 'doc_deck', page_index: 7 },
          },
        },
      ],
      documents: [{ document_id: 'doc_deck', mime_type: 'application/pdf', filename: 'deck.pdf' }],
    });

    expect(res.coverage.unit_economics_present).toBe(true);
  });
});
