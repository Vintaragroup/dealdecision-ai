/**
 * useDealTermsAnalysis
 *
 * AI Analysis Tab–exclusive hook.  Reads canonical raise-terms fields from an
 * already-fetched InvestorInsightsReport then calls the lightweight
 * POST /api/v1/deals/:id/analysis/deal-terms endpoint.
 *
 * Rules:
 *  - Does NOT touch the Investor Insights pipeline.
 *  - Does NOT modify the InvestorInsightsReport it receives.
 *  - Re-runs whenever dealId or the canonical_fields fingerprint changes.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { parseCanonicalFieldsBody } from '../components/workspace/InvestorInsightsTab';
import {
  apiPostDealTermsAnalysis,
  type DealTermsAnalysisResult,
  type InvestorInsightsReport,
} from '../lib/apiClient';

// The 10 canonical fields driving the synthesis.
const RAISE_TERM_FIELDS = [
  'raise_amount',
  'raise_round',
  'raise_instrument',
  'raise_cap',
  'raise_discount',
  'note_interest_rate',
  'note_maturity',
  'valuation_pre',
  'valuation_post',
  'valuation_safe_cap',
] as const;

/**
 * Extract the 10 raise-terms fields from the canonical_fields section body
 * and return them as a flat Record<fieldName, value | null>.
 */
export function extractRaiseTermFields(
  report: InvestorInsightsReport | null,
): Record<string, string | null> {
  const fields: Record<string, string | null> = {};
  for (const k of RAISE_TERM_FIELDS) fields[k] = null;

  if (!report) return fields;

  const canonicalSection = report.render_package?.sections?.find(
    (s) => s.key === 'canonical_fields',
  );
  if (!canonicalSection || typeof canonicalSection.body !== 'string') return fields;

  const rows = parseCanonicalFieldsBody(canonicalSection.body);
  for (const row of rows) {
    const key = row.field.toLowerCase().trim();
    if (Object.prototype.hasOwnProperty.call(fields, key) && row.value != null) {
      fields[key] = row.value;
    }
  }

  return fields;
}

function fingerprint(fields: Record<string, string | null>): string {
  return JSON.stringify(
    RAISE_TERM_FIELDS.map((k) => fields[k] ?? '').join('|'),
  );
}

export type UseDealTermsAnalysisStatus = 'idle' | 'loading' | 'ready' | 'error' | 'no_data';

export type UseDealTermsAnalysisResult = {
  status: UseDealTermsAnalysisStatus;
  data: DealTermsAnalysisResult | null;
  /** Extracted canonical fields — always available regardless of LLM status */
  canonicalFields: Record<string, string | null>;
  error: string | null;
  refresh: () => void;
};

export function useDealTermsAnalysis(
  dealId: string | undefined,
  report: InvestorInsightsReport | null,
): UseDealTermsAnalysisResult {
  const [status, setStatus] = useState<UseDealTermsAnalysisStatus>('idle');
  const [data, setData] = useState<DealTermsAnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Derived canonical fields — recomputed only when report changes.
  const canonicalFields = extractRaiseTermFields(report);
  const currentFingerprint = fingerprint(canonicalFields);

  const mountedRef = useRef(true);
  const dealIdRef = useRef(dealId);
  const fpRef = useRef(currentFingerprint);
  dealIdRef.current = dealId;
  fpRef.current = currentFingerprint;

  const run = useCallback(async () => {
    const id = dealIdRef.current;
    const fp = fpRef.current;
    if (!id) {
      setStatus('idle');
      return;
    }

    // Check if ALL fields are null → no data to synthesise
    const fields = extractRaiseTermFields(report);
    const hasAny = Object.values(fields).some((v) => v != null);
    if (!hasAny) {
      setStatus('no_data');
      setData(null);
      return;
    }

    setStatus('loading');
    try {
      const result = await apiPostDealTermsAnalysis(id, fields);
      if (!mountedRef.current || dealIdRef.current !== id || fpRef.current !== fp) return;
      setData(result);
      setStatus('ready');
      setError(null);
    } catch (err) {
      if (!mountedRef.current || dealIdRef.current !== id) return;
      setError(err instanceof Error ? err.message : String(err));
      setStatus('error');
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Trigger whenever dealId or field fingerprint changes.
  useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId, currentFingerprint]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  return {
    status,
    data,
    canonicalFields,
    error,
    refresh: run,
  };
}
