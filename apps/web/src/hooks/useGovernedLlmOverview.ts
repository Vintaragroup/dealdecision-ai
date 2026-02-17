import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiGetDealGovernedOverlayPersisted } from '../lib/apiClient';

export type GovernedLlmQualityFlags = {
  provider_error?: boolean;
  model_output_not_json?: boolean;
  guard_degraded?: boolean;
  [key: string]: unknown;
};

export type GovernedLlmOverviewPayload = {
  llm_phase_mode?: string;
  input_hash?: string;
  created_at?: string;
  summary_text?: string;
  claims?: unknown[];
  disclosures?: unknown[];
  // Backend may add more status/quality fields over time.
  [key: string]: unknown;
};

export type UseGovernedLlmOverviewResult = {
  status: 'idle' | 'loading' | 'ready' | 'missing' | 'error';
  overview: GovernedLlmOverviewPayload | null;
  error: string | null;
  llm_phase_mode: string | null;
  input_hash: string | null;
  created_at: string | null;
  quality_flags: GovernedLlmQualityFlags;
  refresh: (opts?: { force?: boolean }) => Promise<void>;
};

function extractQualityFlags(overview: GovernedLlmOverviewPayload | null): GovernedLlmQualityFlags {
  if (!overview || typeof overview !== 'object') return {};

  const direct: GovernedLlmQualityFlags = {
    provider_error: Boolean((overview as any).provider_error),
    model_output_not_json: Boolean((overview as any).model_output_not_json),
    guard_degraded: Boolean((overview as any).guard_degraded),
  };

  const nested = (overview as any).quality_flags;
  if (nested && typeof nested === 'object') {
    return {
      ...direct,
      ...(nested as any),
      provider_error: Boolean((nested as any).provider_error ?? direct.provider_error),
      model_output_not_json: Boolean((nested as any).model_output_not_json ?? direct.model_output_not_json),
      guard_degraded: Boolean((nested as any).guard_degraded ?? direct.guard_degraded),
    };
  }

  return direct;
}

function isMissingOverlayError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return msg.includes('governed_overlay_http_204');
}

export function useGovernedLlmOverview(dealId?: string | null): UseGovernedLlmOverviewResult {
  const id = String(dealId ?? '').trim();
  const [status, setStatus] = useState<UseGovernedLlmOverviewResult['status']>('idle');
  const [overview, setOverview] = useState<GovernedLlmOverviewPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastAttemptAtRef = useRef<number>(0);
  const lastDealIdRef = useRef<string>('');

  const refresh = useCallback(
    async (opts?: { force?: boolean }) => {
      if (!id) {
        setOverview(null);
        setStatus('idle');
        setError(null);
        return;
      }

      const now = Date.now();
      if (!opts?.force && now - lastAttemptAtRef.current < 3000) return;
      lastAttemptAtRef.current = now;

      setStatus('loading');
      setError(null);
      try {
        const res = await apiGetDealGovernedOverlayPersisted(id);
        const next = res && typeof res === 'object' ? ((res as any).overview as GovernedLlmOverviewPayload | null) : null;

        if (!next) {
          setOverview(null);
          setStatus('missing');
          setError(null);
          return;
        }

        setOverview(next);
        setStatus('ready');
        setError(null);
      } catch (err) {
        if (isMissingOverlayError(err)) {
          setOverview(null);
          setStatus('missing');
          setError(null);
          return;
        }
        setOverview(null);
        setStatus('error');
        setError(err instanceof Error ? err.message : 'Failed to load governed overlay');
      }
    },
    [id]
  );

  useEffect(() => {
    if (lastDealIdRef.current !== id) {
      lastDealIdRef.current = id;
      setOverview(null);
      setError(null);
      setStatus(id ? 'loading' : 'idle');
      lastAttemptAtRef.current = 0;
    }

    if (!id) return;
    refresh({ force: true }).catch(() => {
      // status + error already set
    });
  }, [id, refresh]);

  const quality_flags = useMemo(() => extractQualityFlags(overview), [overview]);

  return {
    status,
    overview,
    error,
    llm_phase_mode: typeof (overview as any)?.llm_phase_mode === 'string' ? String((overview as any).llm_phase_mode) : null,
    input_hash: typeof (overview as any)?.input_hash === 'string' ? String((overview as any).input_hash) : null,
    created_at: typeof (overview as any)?.created_at === 'string' ? String((overview as any).created_at) : null,
    quality_flags,
    refresh,
  };
}
