import { inferFinancialCoverageProfileV1 } from '../financial-coverage-profile.js';
import type { FinancialFactV1 } from '../../financial-facts/financial-fact-v1.js';

// ─── Fixture helpers ─────────────────────────────────────────────────────────

let _seq = 0;
function makeXlsxFact(
  metric_key: string,
  value: number,
  overrides: Partial<FinancialFactV1> = {}
): FinancialFactV1 {
  const id = ++_seq;
  return {
    fact_id: `factv1:deal1:${metric_key}:annual:FY2024:${String(id).padStart(8, '0')}`,
    deal_id: 'deal1',
    document_id: 'doc_xlsx',
    source_kind: 'xlsx',
    metric_key,
    period_type: 'annual',
    period_label: 'FY2024',
    value,
    unit: 'currency',
    confidence: 'high',
    ...overrides,
  };
}

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

  // ─── financial_facts typed coverage (Phase 1 fix) ─────────────────────────

  describe('financial_facts typed coverage', () => {
    test('deck-only deal with no financial_facts — behavior unchanged, sources=[deck]', () => {
      const res = inferFinancialCoverageProfileV1({
        structured_summary: {},
        promoted_facts: null,
        financial_facts: null,
        documents: [{ document_id: 'doc_deck', mime_type: 'application/pdf', filename: 'deck.pdf' }],
      });

      expect(res.sources).toEqual([{ kind: 'deck' }]);
      expect(res.coverage.historical_revenue_present).toBe(false);
      expect(res.coverage.income_statement_present).toBe(false);
      expect(res.confidence).toBe('low');
    });

    test('deck-only deal with empty financial_facts array — behavior unchanged', () => {
      const res = inferFinancialCoverageProfileV1({
        structured_summary: {},
        promoted_facts: null,
        financial_facts: [],
        documents: [{ document_id: 'doc_deck', mime_type: 'application/pdf', filename: 'deck.pdf' }],
      });

      expect(res.sources).toEqual([{ kind: 'deck' }]);
      expect(res.coverage.historical_revenue_present).toBe(false);
    });

    test('xlsx revenue fact → historical_revenue_present=true, source includes xlsx', () => {
      const res = inferFinancialCoverageProfileV1({
        structured_summary: {},
        promoted_facts: null,
        financial_facts: [makeXlsxFact('revenue', 2_400_000)],
        documents: null,
      });

      expect(res.coverage.historical_revenue_present).toBe(true);
      expect(res.coverage.forecast_revenue_present).toBe(false);
      expect(res.sources.some((s) => s.kind === 'xlsx' && s.document_id === 'doc_xlsx')).toBe(true);
    });

    test('xlsx ARR fact counts as historical revenue', () => {
      const res = inferFinancialCoverageProfileV1({
        structured_summary: {},
        promoted_facts: null,
        financial_facts: [makeXlsxFact('arr', 1_500_000)],
        documents: null,
      });

      expect(res.coverage.historical_revenue_present).toBe(true);
    });

    test('projected xlsx revenue fact → forecast_revenue_present=true, historical=false', () => {
      const futureYear = new Date().getFullYear() + 1;
      const res = inferFinancialCoverageProfileV1({
        structured_summary: {},
        promoted_facts: null,
        financial_facts: [
          makeXlsxFact('revenue', 5_000_000, {
            temporal_scope: 'projected',
            period_label: `FY${futureYear}`,
          }),
        ],
        documents: null,
      });

      expect(res.coverage.forecast_revenue_present).toBe(true);
      expect(res.coverage.historical_revenue_present).toBe(false);
    });

    test('xlsx EBITDA fact → income_statement_present=true', () => {
      const res = inferFinancialCoverageProfileV1({
        structured_summary: {},
        promoted_facts: null,
        financial_facts: [makeXlsxFact('ebitda', -120_000, { unit: 'currency' })],
        documents: null,
      });

      expect(res.coverage.income_statement_present).toBe(true);
    });

    test('xlsx burn_rate fact → burn_rate_present=true', () => {
      const res = inferFinancialCoverageProfileV1({
        structured_summary: {},
        promoted_facts: null,
        financial_facts: [makeXlsxFact('burn_rate', 80_000, { unit: 'currency' })],
        documents: null,
      });

      expect(res.coverage.burn_rate_present).toBe(true);
    });

    test('xlsx runway_months fact → runway_present=true', () => {
      const res = inferFinancialCoverageProfileV1({
        structured_summary: {},
        promoted_facts: null,
        financial_facts: [makeXlsxFact('runway_months', 18, { unit: 'number' })],
        documents: null,
      });

      expect(res.coverage.runway_present).toBe(true);
    });

    test('deck + xlsx deal — multiple coverage flags set, confidence high when income_statement present', () => {
      const res = inferFinancialCoverageProfileV1({
        structured_summary: {},
        promoted_facts: null,
        financial_facts: [
          makeXlsxFact('revenue', 3_000_000),
          makeXlsxFact('ebitda', -200_000, { unit: 'currency' }),
          makeXlsxFact('burn_rate', 75_000, { unit: 'currency' }),
          makeXlsxFact('runway_months', 14, { unit: 'number' }),
          makeXlsxFact('cac', 250, { unit: 'currency' }),
        ],
        documents: [
          { document_id: 'doc_xlsx', mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', filename: 'model.xlsx' },
          { document_id: 'doc_deck', mime_type: 'application/pdf', filename: 'deck.pdf' },
        ],
      });

      expect(res.coverage.historical_revenue_present).toBe(true);
      expect(res.coverage.income_statement_present).toBe(true);
      expect(res.coverage.burn_rate_present).toBe(true);
      expect(res.coverage.runway_present).toBe(true);
      expect(res.coverage.unit_economics_present).toBe(true);
      expect(res.confidence).toBe('high');
    });

    test('source attribution: xlsx facts without xlsx document metadata still get kind=xlsx in sources', () => {
      // Simulates case where documents metadata is missing but facts are in the registry
      const res = inferFinancialCoverageProfileV1({
        structured_summary: {},
        promoted_facts: null,
        financial_facts: [makeXlsxFact('revenue', 1_000_000)],
        documents: null,
      });

      // Should NOT fall back to [{kind:'deck'}] when xlsx facts exist
      expect(res.sources.some((s) => s.kind === 'deck')).toBe(false);
      expect(res.sources.some((s) => s.kind === 'xlsx')).toBe(true);
    });

    test('notes include xlsx_evidence_used when xlsx facts are present', () => {
      const res = inferFinancialCoverageProfileV1({
        structured_summary: {},
        promoted_facts: null,
        financial_facts: [makeXlsxFact('revenue', 1_000_000)],
        documents: null,
      });

      expect(res.notes).toContain('xlsx_present');
      expect(res.notes).toContain('xlsx_evidence_used');
    });
  });
});

// ─── Cash outflow → burn_rate_present coverage ───────────────────────────────

describe('inferFinancialCoverageProfileV1 — cash_outflow_operating as burn signal', () => {
  test('cash_outflow_operating fact → burn_rate_present=true', () => {
    const res = inferFinancialCoverageProfileV1({
      structured_summary: {},
      promoted_facts: null,
      financial_facts: [makeXlsxFact('cash_outflow_operating', 1_453_000, { unit: 'currency' })],
      documents: null,
    });

    expect(res.coverage.burn_rate_present).toBe(true);
  });

  test('cash_outflow fact → burn_rate_present=true', () => {
    const res = inferFinancialCoverageProfileV1({
      structured_summary: {},
      promoted_facts: null,
      financial_facts: [makeXlsxFact('cash_outflow', 800_000, { unit: 'currency' })],
      documents: null,
    });

    expect(res.coverage.burn_rate_present).toBe(true);
  });

  test('cash_outflow_operating evidence appears in coverage.evidence.burn_rate_present', () => {
    const fact = makeXlsxFact('cash_outflow_operating', 1_453_000, {
      unit: 'currency',
      source_pointer: 'sheet=CashFlow row=42',
      excerpt: 'Cash outflow from operations: $1.45M',
    });
    const res = inferFinancialCoverageProfileV1({
      structured_summary: {},
      promoted_facts: null,
      financial_facts: [fact],
      documents: null,
    });

    expect(res.coverage.burn_rate_present).toBe(true);
    expect(res.evidence.burn_rate_present).toBeDefined();
    expect(res.evidence.burn_rate_present!.snippet).toContain('$1.45M');
  });

  test('cash_outflow_operating + cash → burn_rate_present true, runway derivable', () => {
    // A cash fact alone does not set cash_flow_present (that requires cash_flow / OCF / FCF).
    // But cash_outflow_operating does set burn_rate_present, and together they enable
    // runway derivation in the reconcile pipeline.
    const res = inferFinancialCoverageProfileV1({
      structured_summary: {},
      promoted_facts: null,
      financial_facts: [
        makeXlsxFact('cash_outflow_operating', 1_453_000, { unit: 'currency' }),
        makeXlsxFact('cash', 7_812_000, { unit: 'currency' }),
      ],
      documents: null,
    });

    expect(res.coverage.burn_rate_present).toBe(true);
    // cash alone does not trigger cash_flow_present (requires cash_flow / OCF / FCF facts)
    expect(res.coverage.cash_flow_present).toBe(false);
  });
});

