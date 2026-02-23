import { useCallback, useEffect, useRef, useState } from 'react';
import { apiGetInvestorInsights, type InvestorInsightsReport } from '../lib/apiClient';

export type UseInvestorInsightsStatus = 'idle' | 'loading' | 'ready' | 'error';

export type UseInvestorInsightsResult = {
  status: UseInvestorInsightsStatus;
  report: InvestorInsightsReport | null;
  error: string | null;
  refresh: () => Promise<void>;
};

export function useInvestorInsights(dealId: string | undefined): UseInvestorInsightsResult {
  const [fetchStatus, setFetchStatus] = useState<UseInvestorInsightsStatus>('idle');
  const [report, setReport] = useState<InvestorInsightsReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dealIdRef = useRef(dealId);
  dealIdRef.current = dealId;

  const refresh = useCallback(async () => {
    const id = dealIdRef.current;
    if (!id) return;
    setFetchStatus('loading');
    try {
      const data = await apiGetInvestorInsights(id);
      setReport(data);
      setFetchStatus('ready');
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setFetchStatus('error');
    }
  }, []);

  useEffect(() => {
    refresh();
    // Re-fetch whenever dealId changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId]);

  return { status: fetchStatus, report, error, refresh };
}
