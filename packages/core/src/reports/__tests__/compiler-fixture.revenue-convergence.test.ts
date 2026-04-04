/**
 * compiler-fixture.revenue-convergence.test.ts
 *
 * Regression tests for Fix #6: revenue path unification.
 *
 * Validates that structured_summary.revenue and financial_breakdown_v1.current_state.revenue
 * always select the same canonical revenue value — and that the revenue_convergence
 * diagnostic in report metadata reflects this.
 *
 * Covers:
 *   - Qredible-type divergence: PDF-extracted FinancialFactV1 must appear in both paths
 *   - WebMax-type divergence: monthly-only facts must produce null on both paths
 *   - XLSX deal: xlsx fact selected consistently on both paths
 *   - No facts: both paths return null, convergence = true
 *   - Convergence diagnostic in report.metadata.revenue_convergence
 */

import { compileDIOToReportWithPromotedFacts } from '../compiler-simple';
import type { FinancialFactV1 } from '../../financial-facts/financial-fact-v1';

// ─── Minimal DIO fixture ──────────────────────────────────────────────────────

const now = '2026-04-03T00:00:00.000Z';

const minimalDio = (): any => ({
  schema_version: '1.0.0',
  dio_id: '00000000-0000-4000-8000-000000000001',
  deal_id: '00000000-0000-4000-8000-000000000001',
  created_at: now,
  updated_at: now,
  analysis_version: 1,
  dio_context: { primary_doc_type: 'pitch_deck' },
  inputs: { documents: [], evidence: [], config: { analyzer_versions: {}, features: {}, parameters: {} } },
  analyzer_results: {},
  dio: { phase1: {} },
});

// ─── FinancialFactV1 fixture builder ─────────────────────────────────────────

let _seq = 0;
function financialFact(
  metric_key: string,
  value: number,
  overrides: Partial<FinancialFactV1> = {}
): FinancialFactV1 {
  const id = ++_seq;
  return {
    fact_id: `factv1:deal1:${metric_key}:annual:${String(id).padStart(8, '0')}`,
    deal_id: '00000000-0000-4000-8000-000000000001',
    document_id: 'doc-001',
    source_kind: 'xlsx',
    metric_key,
    period_type: 'annual',
    period_label: 'FY2025',
    value,
    unit: 'currency',
    currency: 'USD',
    confidence: 'high',
    ...overrides,
  };
}

// Convenience builders for common source kinds
const xlsxFact = (key: string, value: number, overrides?: Partial<FinancialFactV1>) =>
  financialFact(key, value, { source_kind: 'xlsx', document_id: 'doc-xlsx', ...overrides });

const pdfFact = (key: string, value: number, overrides?: Partial<FinancialFactV1>) =>
  financialFact(key, value, { source_kind: 'pdf_table', document_id: 'doc-pdf', ...overrides });

const monthlyFact = (key: string, value: number, periodLabel: string) =>
  financialFact(key, value, { period_type: 'monthly', period_label: periodLabel });

// ─── Helper: extract amounts from compiled report ─────────────────────────────

function reportRevenue(report: any) {
  const ssAmount: number | null = report.structured_summary?.revenue?.value?.amount ?? null;
  const bdAmount: number | null = report.financial_breakdown_v1?.current_state?.revenue?.value ?? null;
  const convergenceDiag = (report.metadata as any)?.revenue_convergence ?? null;
  return { ssAmount, bdAmount, convergenceDiag };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('revenue path convergence — no FinancialFacts', () => {
  test('both paths null when no financial facts provided', () => {
    const report = compileDIOToReportWithPromotedFacts(minimalDio(), {
      promotedFacts: [],
      financialFacts: [],
    });
    const { ssAmount, bdAmount, convergenceDiag } = reportRevenue(report);
    expect(ssAmount).toBeNull();
    expect(bdAmount).toBeNull(); // no revenue fact → null
    expect(convergenceDiag?.converged).toBe(true);
  });
});

describe('[Qredible regression] PDF-only deal — revenue appears in both paths', () => {
  // Before Fix #6, injectXlsxRevenueIntoStructuredSummary filtered source_kind==='xlsx' only.
  // A pdf_table FinancialFactV1 ($381K) was visible in financial_breakdown but absent from
  // structured_summary.revenue, causing scoring to underreport traction.

  test('pdf_table revenue fact is injected into structured_summary.revenue', () => {
    const facts: FinancialFactV1[] = [
      pdfFact('revenue', 381_000, { period_label: 'FY2024', period_type: 'annual' }),
    ];

    const report = compileDIOToReportWithPromotedFacts(minimalDio(), {
      promotedFacts: [],
      financialFacts: facts,
    });

    const { ssAmount, bdAmount, convergenceDiag } = reportRevenue(report);

    expect(ssAmount).toBe(381_000);
    expect(bdAmount).toBe(381_000);
    expect(convergenceDiag?.converged).toBe(true);
    expect(convergenceDiag?.backfill_applied).toBe(false);
  });

  test('pdf_table revenue fact sets selection_reason = financial_fact', () => {
    const facts = [pdfFact('revenue', 381_000, { period_label: 'FY2024' })];
    const report = compileDIOToReportWithPromotedFacts(minimalDio(), {
      promotedFacts: [],
      financialFacts: facts,
    });
    expect(report.structured_summary?.revenue?.selection_reason).toBe('financial_fact');
  });

  test('pdf_table fact populates scoring path: structured_summary.revenue.value.amount', () => {
    const facts = [pdfFact('revenue', 381_000, { period_label: 'FY2024' })];
    const report = compileDIOToReportWithPromotedFacts(minimalDio(), {
      promotedFacts: [],
      financialFacts: facts,
    });
    // Scoring reads: args.structured_summary?.revenue?.value?.amount
    expect(report.structured_summary?.revenue?.value?.amount).toBe(381_000);
  });
});

describe('[WebMax regression] monthly-only XLSX facts — neither path produces annual revenue', () => {
  // After Fix #5 (period label validation), monthly XLSX revenue facts are blocked by
  // selectCanonicalRevenueFact's monthly-only guard.
  // Both paths must be null — not one getting $8K and the other $0.

  test('all monthly revenue facts → structured_summary revenue has no amount', () => {
    const facts: FinancialFactV1[] = [
      monthlyFact('revenue', 8_000, 'September'),
      monthlyFact('revenue', 9_200, 'October'),
      monthlyFact('revenue', 7_500, 'November'),
    ];

    const report = compileDIOToReportWithPromotedFacts(minimalDio(), {
      promotedFacts: [],
      financialFacts: facts,
    });

    const { ssAmount, bdAmount } = reportRevenue(report);

    // Neither path should produce a revenue value from monthly facts.
    expect(ssAmount).toBeNull();
    expect(bdAmount).toBeNull();
  });

  test('monthly-only facts set selection_reason = monthly_only on structured_summary', () => {
    const facts = [
      monthlyFact('revenue', 8_000, 'September'),
      monthlyFact('revenue', 9_200, 'October'),
    ];
    const report = compileDIOToReportWithPromotedFacts(minimalDio(), {
      promotedFacts: [],
      financialFacts: facts,
    });
    expect(report.structured_summary?.revenue?.selection_reason).toBe('monthly_only');
  });

  test('both paths converge to null for monthly-only scenario', () => {
    const facts = [monthlyFact('revenue', 8_000, 'September')];
    const report = compileDIOToReportWithPromotedFacts(minimalDio(), {
      promotedFacts: [],
      financialFacts: facts,
    });
    const { convergenceDiag } = reportRevenue(report);
    expect(convergenceDiag?.converged).toBe(true);
  });
});

describe('XLSX deal — canonical XLSX fact selected on both paths', () => {
  test('xlsx revenue fact appears in both structured_summary and financial_breakdown with same value', () => {
    const facts = [
      xlsxFact('revenue', 3_337_000, { period_label: 'FY2026', period_type: 'annual' }),
    ];

    const report = compileDIOToReportWithPromotedFacts(minimalDio(), {
      promotedFacts: [],
      financialFacts: facts,
    });

    const { ssAmount, bdAmount, convergenceDiag } = reportRevenue(report);

    expect(ssAmount).toBe(3_337_000);
    expect(bdAmount).toBe(3_337_000);
    expect(convergenceDiag?.converged).toBe(true);
  });

  test('xlsx fact sets selection_reason = xlsx_financial_fact', () => {
    const facts = [xlsxFact('revenue', 3_337_000, { period_label: 'FY2026' })];
    const report = compileDIOToReportWithPromotedFacts(minimalDio(), {
      promotedFacts: [],
      financialFacts: facts,
    });
    expect(report.structured_summary?.revenue?.selection_reason).toBe('xlsx_financial_fact');
  });
});

describe('convergence guard back-fills structured_summary when breakdown wins', () => {
  // If (due to some unforeseen path) structured_summary.revenue misses a value that
  // financial_breakdown has, the back-fill step corrects it and marks backfill_applied=true.

  test('report.metadata.revenue_convergence.converged is true after normal compilation', () => {
    const facts = [xlsxFact('revenue', 461_000, { period_label: 'FY2025' })];
    const report = compileDIOToReportWithPromotedFacts(minimalDio(), {
      promotedFacts: [],
      financialFacts: facts,
    });
    const diag = (report.metadata as any)?.revenue_convergence;
    expect(diag).toBeDefined();
    expect(diag.converged).toBe(true);
  });

  test('revenue_convergence.financial_breakdown_amount matches current_state.revenue.value', () => {
    const facts = [xlsxFact('revenue', 461_000, { period_label: 'FY2025' })];
    const report = compileDIOToReportWithPromotedFacts(minimalDio(), {
      promotedFacts: [],
      financialFacts: facts,
    });
    const diag = (report.metadata as any)?.revenue_convergence;
    expect(diag.financial_breakdown_amount).toBe(461_000);
    expect(report.financial_breakdown_v1?.current_state?.revenue?.value).toBe(461_000);
  });
});

describe('mixed PDF + XLSX — xlsx wins via source hierarchy', () => {
  test('xlsx beats pdf_table on both paths', () => {
    const facts: FinancialFactV1[] = [
      pdfFact('revenue', 381_000, { period_label: 'FY2024' }),
      xlsxFact('revenue', 461_000, { period_label: 'FY2025' }),
    ];

    const report = compileDIOToReportWithPromotedFacts(minimalDio(), {
      promotedFacts: [],
      financialFacts: facts,
    });

    const { ssAmount, bdAmount } = reportRevenue(report);

    // Both paths should select the xlsx fact (source rank 10 vs 5)
    expect(ssAmount).toBe(461_000);
    expect(bdAmount).toBe(461_000);
  });
});
