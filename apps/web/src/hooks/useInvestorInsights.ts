import { useCallback, useEffect, useRef, useState } from 'react';
import { apiGetInvestorInsights, apiGenerateInvestorInsights, type InvestorInsightsReport } from '../lib/apiClient';

export type UseInvestorInsightsStatus = 'idle' | 'loading' | 'ready' | 'error';

export type UseInvestorInsightsResult = {
  status: UseInvestorInsightsStatus;
  report: InvestorInsightsReport | null;
  error: string | null;
  refresh: () => Promise<void>;
  generate: () => Promise<void>;
};

export function useInvestorInsights(dealId: string | undefined): UseInvestorInsightsResult {
  const [fetchStatus, setFetchStatus] = useState<UseInvestorInsightsStatus>('idle');
  const [report, setReport] = useState<InvestorInsightsReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dealIdRef = useRef(dealId);
  dealIdRef.current = dealId;
  // Tracks whether the consuming component is still mounted to prevent post-unmount setState.
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    const id = dealIdRef.current;
    if (!id) return;
    setFetchStatus('loading');
    try {
      const data = await apiGetInvestorInsights(id);
      // Discard if unmounted or if dealId changed since fetch started.
      if (!mountedRef.current || dealIdRef.current !== id) return;
      setReport(data);
      setFetchStatus('ready');
      setError(null);
    } catch (err) {
      if (!mountedRef.current || dealIdRef.current !== id) return;
      setError(err instanceof Error ? err.message : String(err));
      setFetchStatus('error');
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    refresh();
    // Re-fetch whenever dealId changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const generate = useCallback(async () => {
    const id = dealIdRef.current;
    if (!id) return;
    await apiGenerateInvestorInsights(id);
    await refresh();
  }, [refresh]);

  return { status: fetchStatus, report, error, refresh, generate };
}