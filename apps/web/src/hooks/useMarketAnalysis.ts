/**
 * useMarketAnalysis
 *
 * AI Analysis Tab–exclusive hook. Reads market-signal canonical fields from
 * an already-fetched InvestorInsightsReport then calls the lightweight
 * POST /api/v1/deals/:id/analysis/market endpoint.
 *
 * Rules:
 *  - Does NOT touch the Investor Insights pipeline.
 *  - Does NOT modify the InvestorInsightsReport it receives.
 *  - Re-runs whenever dealId or the canonical field fingerprint changes.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { parseCanonicalFieldsBody } from '../components/workspace/investorInsightsUtils';
import {
  apiPostMarketAnalysis,
  type MarketAnalysisResult,
  type InvestorInsightsReport,
} from '../lib/apiClient';

// The canonical field keys that drive market synthesis.
const MARKET_FIELD_KEYS = [
  'tam',
  'sam',
  'som',
  'growth_rate',
  'customer_count',
  'market_category',
  'market_geography',
  'icp',
  'pricing_model',
  'competition',
] as const;

// Categories + patterns from canonical_fields body that map to market signals.
const MARKET_CATEGORY_PATTERNS = [
  'market',
  'tam',
  'growth',
  'traction',
  'competition',
  'revenue',
  'customer',
  'icp',
  'pricing',
];

/**
 * Extract market-signal fields from the canonical_fields section body.
 * Returns a flat Record<fieldKey, value | null>.
 */
export function extractMarketFields(
  report: InvestorInsightsReport | null,
): Record<string, string | null> {
  const fields: Record<string, string | null> = {};
  for (const k of MARKET_FIELD_KEYS) fields[k] = null;

  if (!report) return fields;

  const canonicalSection = report.render_package?.sections?.find(
    (s) => s.key === 'canonical_fields',
  );
  if (!canonicalSection || typeof canonicalSection.body !== 'string') return fields;

  const rows = parseCanonicalFieldsBody(canonicalSection.body);
  for (const row of rows) {
    const fieldKey = row.field.toLowerCase().trim();
    const cat = row.category.toLowerCase().trim();

    // Accept rows whose field key matches directly
    if (Object.prototype.hasOwnProperty.call(fields, fieldKey) && row.value != null) {
      fields[fieldKey] = row.value;
      continue;
    }

    // Also map rows from market-related categories to best-fit key
    const isMarketCategory = MARKET_CATEGORY_PATTERNS.some(
      (p) => cat.includes(p) || fieldKey.includes(p),
    );
    if (!isMarketCategory) continue;

    // Try prefix-based matching: field name that starts with a known key
    for (const k of MARKET_FIELD_KEYS) {
      if (fieldKey.startsWith(k) || k.startsWith(fieldKey)) {
        if (fields[k] == null && row.value != null) {
          fields[k] = row.value;
        }
        break;
      }
    }
  }

  return fields;
}

function fingerprint(fields: Record<string, string | null>): string {
  return JSON.stringify(
    MARKET_FIELD_KEYS.map((k) => fields[k] ?? '').join('|'),
  );
}

export type UseMarketAnalysisStatus = 'idle' | 'loading' | 'ready' | 'error' | 'no_data';

export type UseMarketAnalysisResult = {
  status: UseMarketAnalysisStatus;
  data: MarketAnalysisResult | null;
  /** Extracted canonical fields — always available regardless of LLM status */
  canonicalFields: Record<string, string | null>;
  error: string | null;
  refresh: () => void;
};

export function useMarketAnalysis(
  dealId: string | undefined,
  report: InvestorInsightsReport | null,
  dealName?: string,
): UseMarketAnalysisResult {
  const [status, setStatus] = useState<UseMarketAnalysisStatus>('idle');
  const [data, setData] = useState<MarketAnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canonicalFields = extractMarketFields(report);
  const currentFingerprint = fingerprint(canonicalFields);

  const mountedRef = useRef(true);
  const dealIdRef = useRef(dealId);
  const dealNameRef = useRef(dealName);
  const fpRef = useRef(currentFingerprint);
  dealIdRef.current = dealId;
  dealNameRef.current = dealName;
  fpRef.current = currentFingerprint;

  const run = useCallback(async () => {
    const id = dealIdRef.current;
    const fp = fpRef.current;
    if (!id) {
      setStatus('idle');
      return;
    }

    // If ALL market fields are null, surface no_data
    const fields = extractMarketFields(report);
    const hasAny = Object.values(fields).some((v) => v != null);
    if (!hasAny) {
      setStatus('no_data');
      setData(null);
      return;
    }

    setStatus('loading');
    try {
      const result = await apiPostMarketAnalysis(id, fields, dealNameRef.current);
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
