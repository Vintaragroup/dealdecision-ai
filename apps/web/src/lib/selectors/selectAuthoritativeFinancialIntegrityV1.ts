// Local structural types mirroring packages/core/src/types/financial-integrity-v1.ts.
// Kept inline so the web app has no hard dependency on the core package types.

export type IntegrityFlagStatus = 'PASS' | 'WARN' | 'FAIL';
export type IntegrityFlagSeverity = 'low' | 'medium' | 'high' | 'critical';

export type IntegrityFlagSourceRef = {
  source_kind: string;
  value: number;
  period_label?: string;
};

export type IntegrityFlag = {
  flag_key: string;
  status: IntegrityFlagStatus;
  severity: IntegrityFlagSeverity;
  fact_type?: string;
  note: string;
  source_a?: IntegrityFlagSourceRef;
  source_b?: IntegrityFlagSourceRef;
};

export type FinancialIntegrityV1Like = {
  computed_at: string;
  completeness_score: number | null;
  missing_critical: string[];
  missing_supplementary: string[];
  flags: IntegrityFlag[];
};

export type AuthoritativeFinancialIntegritySelectionV1 = {
  value: FinancialIntegrityV1Like | null;
  source: 'report.financial_integrity_v1' | 'missing';
};

function reportLooksReady(report: unknown): boolean {
  if (!report || typeof report !== 'object') return false;
  const r = report as any;
  const readyFlag = typeof r?.ready === 'boolean' ? r.ready : null;
  if (readyFlag === false) return false;
  if (readyFlag === true) return true;
  return Boolean(r?.structured_summary && typeof r.structured_summary === 'object');
}

function unwrapEnvelope(reportOrEnvelope: unknown): any {
  const r = reportOrEnvelope as any;
  return r?.report && typeof r.report === 'object' ? r.report : r;
}

export function selectAuthoritativeFinancialIntegrityV1(
  reportOrEnvelope?: unknown | null,
): AuthoritativeFinancialIntegritySelectionV1 {
  const report = unwrapEnvelope(reportOrEnvelope);

  if (!reportLooksReady(report)) {
    return { value: null, source: 'missing' };
  }

  const block = (report as any)?.financial_integrity_v1;
  if (!block || typeof block !== 'object') {
    return { value: null, source: 'missing' };
  }

  return { value: block as FinancialIntegrityV1Like, source: 'report.financial_integrity_v1' };
}
