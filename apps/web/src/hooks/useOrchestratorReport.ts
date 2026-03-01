import { useCallback, useEffect, useRef, useState } from 'react';
import { apiGetOrchestratorReport, type OrchestratorReportResponse } from '../lib/apiClient';

export type UseOrchestratorReportStatus = 'idle' | 'loading' | 'ready' | 'error' | 'not_found';

export type UseOrchestratorReportResult = {
  status: UseOrchestratorReportStatus;
  data: OrchestratorReportResponse | null;
  error: string | null;
  refresh: () => Promise<OrchestratorReportResponse | null>;
};

export function useOrchestratorReport(dealId: string | undefined): UseOrchestratorReportResult {
  const [fetchStatus, setFetchStatus] = useState<UseOrchestratorReportStatus>('idle');
  const [data, setData] = useState<OrchestratorReportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dealIdRef = useRef(dealId);
  dealIdRef.current = dealId;
  // Tracks whether the consuming component is still mounted to prevent post-unmount setState.
  const mountedRef = useRef(true);

  const refresh = useCallback(async (): Promise<OrchestratorReportResponse | null> => {
    const id = dealIdRef.current;
    if (!id) return null;
    setFetchStatus('loading');
    try {
      const result = await apiGetOrchestratorReport(id);
      // Discard if unmounted or if dealId changed since fetch started.
      if (!mountedRef.current || dealIdRef.current !== id) return null;
      setData(result);
      setFetchStatus('ready');
      setError(null);
      return result;
    } catch (err) {
      if (!mountedRef.current || dealIdRef.current !== id) return null;
      const msg = err instanceof Error ? err.message : String(err);
      // Treat 404 as a distinct state (insights not yet generated)
      if (msg.includes('404') || msg.includes('not_found')) {
        setFetchStatus('not_found');
        setError(null);
      } else {
        setError(msg);
        setFetchStatus('error');
      }
      return null;
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

  return { status: fetchStatus, data, error, refresh };
}
