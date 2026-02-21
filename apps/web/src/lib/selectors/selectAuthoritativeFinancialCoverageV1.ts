export type FinancialCoverageEvidenceRefV1 = {
  document_id?: string;
  page_index?: number;
  page?: number;
  source_path?: string;
  snippet?: string;
};

export type FinancialCoverageProfileV1Like = {
  confidence?: 'low' | 'medium' | 'high';
  sources?: Array<{ kind: 'deck' | 'xlsx' | 'other'; document_id?: string; notes?: string }>;
  coverage?: {
    historical_revenue_present?: boolean;
    forecast_revenue_present?: boolean;
    income_statement_present?: boolean;
    burn_rate_present?: boolean;
    runway_present?: boolean;
    unit_economics_present?: boolean;
    balance_sheet_present?: boolean;
    cash_flow_present?: boolean;
  };
  evidence?: Partial<Record<string, FinancialCoverageEvidenceRefV1>>;
  notes?: string[];
};

export type AuthoritativeFinancialCoverageSelectionV1 = {
  value: FinancialCoverageProfileV1Like | null;
  source: 'report.financial_coverage_v1' | 'missing';
};

function reportLooksReady(report: unknown): boolean {
  if (!report || typeof report !== 'object') return false;
  const r: any = report as any;
  const structured = r?.structured_summary;
  const readyFlag = typeof r?.ready === 'boolean' ? (r.ready as boolean) : null;
  if (readyFlag === false) return false;
  if (readyFlag === true) return true;
  return Boolean(structured && typeof structured === 'object');
}

function unwrapEnvelope(reportOrEnvelope: unknown): any {
  const r: any = reportOrEnvelope as any;
  return r?.report && typeof r.report === 'object' ? (r.report as any) : r;
}

export function selectAuthoritativeFinancialCoverageV1(reportOrEnvelope?: unknown | null): AuthoritativeFinancialCoverageSelectionV1 {
  const report = unwrapEnvelope(reportOrEnvelope);

  if (!reportLooksReady(report)) {
    return { value: null, source: 'missing' };
  }

  const block = (report as any)?.financial_coverage_v1;
  if (!block || typeof block !== 'object') {
    return { value: null, source: 'missing' };
  }

  return { value: block as FinancialCoverageProfileV1Like, source: 'report.financial_coverage_v1' };
}
