import type { Deal, WorkspaceChatResponse, DealChatResponse, JobProgressEventV1, JobStatusDetail } from '@dealdecision/contracts';

import { debugApiInferDealId, debugApiIsEnabled, debugApiLogCall, debugApiLogSse } from './debugApi';
import { getAuthToken } from './authToken';
import { fetchEventSource } from '@microsoft/fetch-event-source';

const META_ENV = (import.meta as any)?.env as any;
// Local dev default: docker/infra compose and .env.example use 9000.
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:9000';
// Default to live for any non-dev build (Render preview/staging builds may not set import.meta.env.PROD).
// Default to mock only for true local dev.
const DEFAULT_BACKEND_MODE = META_ENV?.DEV ? 'mock' : 'live';
const BACKEND_MODE = (import.meta.env.VITE_BACKEND_MODE || DEFAULT_BACKEND_MODE).toLowerCase();

export function getWebBackendRuntimeConfig() {
  return {
    apiBaseUrl: API_BASE_URL,
    backendMode: BACKEND_MODE,
    defaultBackendMode: DEFAULT_BACKEND_MODE,
    viteBackendMode: (import.meta.env as any)?.VITE_BACKEND_MODE ?? null,
    viteApiBaseUrl: (import.meta.env as any)?.VITE_API_BASE_URL ?? null,
    dev: !!META_ENV?.DEV,
    prod: !!META_ENV?.PROD,
    mode: typeof META_ENV?.MODE === 'string' ? META_ENV.MODE : null,
  };
}

// DEV-only: expose a small inspection helper for debugging in the browser console.
// DevTools can't reliably evaluate `import.meta.env`, so this provides an easy way to
// confirm which API base URL and backend mode the running UI is using.
try {
  if (META_ENV?.DEV && typeof window !== 'undefined') {
    (window as any).__ddaiApiClient = {
      ...(typeof (window as any).__ddaiApiClient === 'object' ? (window as any).__ddaiApiClient : {}),
      getWebBackendRuntimeConfig,
    };
  }
} catch {
  // ignore
}

async function getAuthHeader(opts?: { forceRefresh?: boolean; refreshWithinSeconds?: number }): Promise<Record<string, string>> {
  const clerkToken = await getAuthToken({
    forceRefresh: !!opts?.forceRefresh,
    refreshWithinSeconds: typeof opts?.refreshWithinSeconds === 'number' ? opts.refreshWithinSeconds : 30,
  });
  const devAdminToken = getDevAdminToken();
  const fallbackBearer = !clerkToken && devAdminToken ? `Bearer ${devAdminToken}` : undefined;
  const bearer = clerkToken ? `Bearer ${clerkToken}` : fallbackBearer;
  return bearer ? { Authorization: bearer } : {};
}

type ApiMutationLogEntry = {
  ts: number;
  method: string;
  url: string;
  path: string;
  status: number;
  duration_ms: number;
  ok: boolean;
  error?: string;
};

function getLocalStorageFlag(key: string): string | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function shouldLogApiMutations(): boolean {
  const raw = getLocalStorageFlag('ddai:logApiMutations');
  if (!raw) return true;
  const v = raw.trim().toLowerCase();
  if (v === '0' || v === 'false' || v === 'off') return false;
  if (v === '1' || v === 'true' || v === 'on') return true;
  return true;
}

function recordApiMutation(entry: ApiMutationLogEntry) {
  try {
    if (typeof window === 'undefined') return;
    const w = window as any;
    const existing = Array.isArray(w.__ddaiApiMutations) ? w.__ddaiApiMutations : [];
    existing.unshift(entry);
    if (existing.length > 50) existing.length = 50;
    w.__ddaiApiMutations = existing;
  } catch {
    // ignore
  }
}

function getDevAdminToken(): string | null {
  const metaEnv = (import.meta as any)?.env as any;
  if (!metaEnv?.DEV) return null;
  const raw = metaEnv?.VITE_ADMIN_TOKEN;
  if (typeof raw !== 'string') return null;
  const token = raw.trim();
  return token.length > 0 ? token : null;
}

type DealUiPayload = {
  executiveSummary?: unknown;
  executiveSummaryV2?: unknown;
  decisionSummary?: unknown;
  coverage?: unknown;
  overviewV2?: unknown;
  dealOverviewV2?: unknown;
  updateReportV1?: unknown;
	businessArchetypeV1?: unknown;
	dealSummaryV2?: unknown;
};

export type ExecutiveSummaryV2 = {
  generated_at?: string;
  paragraphs?: string[];
  highlights?: string[];
  missing?: string[];
  confidence?: {
    overall?: 'low' | 'med' | 'high';
    rationale?: string;
  };
  sources?: Array<{ document_id: string; page_range?: [number, number]; note?: string }>;
};

type DealWithUi = Deal & {
  ui?: DealUiPayload;
};

export function normalizeDeal(raw: Deal): DealWithUi {
  const anyDeal = raw as any;

  // Normalize top-level score (backend may serialize as a string)
  let normalizedScore: number | undefined = undefined;
  const rawScore = anyDeal?.score;
  if (typeof rawScore === 'number' && Number.isFinite(rawScore)) {
    normalizedScore = rawScore;
  } else if (typeof rawScore === 'string') {
    const parsed = Number(rawScore);
    if (Number.isFinite(parsed)) normalizedScore = parsed;
  }

  const executiveSummary = anyDeal?.executive_summary_v1 ?? anyDeal?.phase1?.executive_summary_v1;
  const decisionSummary = anyDeal?.decision_summary_v1;
  const coverage = anyDeal?.coverage;
  const executiveSummaryV2 =
    anyDeal?.executive_summary_v2 ??
    anyDeal?.phase1?.executive_summary_v2 ??
    anyDeal?.dio?.phase1?.executive_summary_v2;
  const dealOverviewV2 =
    anyDeal?.deal_overview_v2 ??
    anyDeal?.phase1?.deal_overview_v2 ??
    anyDeal?.dio?.phase1?.deal_overview_v2;
  const updateReportV1 =
    anyDeal?.update_report_v1 ??
    anyDeal?.phase1?.update_report_v1 ??
    anyDeal?.dio?.phase1?.update_report_v1;
	const businessArchetypeV1 =
		anyDeal?.business_archetype_v1 ??
		anyDeal?.phase1?.business_archetype_v1 ??
		anyDeal?.dio?.phase1?.business_archetype_v1;
  const dealSummaryV2 =
    anyDeal?.deal_summary_v2 ??
    anyDeal?.phase1?.deal_summary_v2 ??
    anyDeal?.dio?.phase1?.deal_summary_v2;

  const existingUi = (anyDeal?.ui ?? {}) as DealUiPayload;

  const baseExecutiveSummary = (existingUi.executiveSummary ?? executiveSummary) as any;
  let executiveSummarySource: 'summary' | 'one_liner' | 'derived' | 'fallback' | 'none' = 'none';

  const normalizedExecutiveSummary: any = (() => {
    if (baseExecutiveSummary == null) return undefined;
    if (typeof baseExecutiveSummary === 'string') {
      executiveSummarySource = baseExecutiveSummary.trim().length > 0 ? 'summary' : 'none';
      return { title: 'Executive Summary', summary: baseExecutiveSummary };
    }
    if (typeof baseExecutiveSummary !== 'object') return undefined;

    const obj = { ...(baseExecutiveSummary as Record<string, unknown>) } as any;

    const existingSummary = typeof obj.summary === 'string' ? obj.summary.trim() : '';
    if (existingSummary.length > 0) {
      executiveSummarySource = 'summary';
      obj.summary = existingSummary;
    } else {
      const oneLiner = typeof obj.one_liner === 'string' ? obj.one_liner.trim() : '';
      if (oneLiner.length > 0) {
        executiveSummarySource = 'one_liner';
        obj.summary = oneLiner;
      } else {
        // Derive a short summary from common Phase 1 fields.
        const parts: string[] = [];
        const dealType = typeof obj.deal_type === 'string' ? obj.deal_type.trim() : '';
        const raise = typeof obj.raise === 'string' ? obj.raise.trim() : '';
        const businessModel = typeof obj.business_model === 'string' ? obj.business_model.trim() : '';
        const tractionSignals = Array.isArray(obj.traction_signals) ? obj.traction_signals.filter((x: any) => typeof x === 'string' && x.trim().length > 0) : [];
        const keyRisks = Array.isArray(obj.key_risks_detected) ? obj.key_risks_detected.filter((x: any) => typeof x === 'string' && x.trim().length > 0) : [];

        if (dealType) parts.push(dealType);
        if (raise) parts.push(`Raise: ${raise}`);
        if (businessModel) parts.push(`Model: ${businessModel}`);
        if (tractionSignals.length > 0) parts.push(`Traction: ${tractionSignals.slice(0, 2).join('; ')}`);
        if (keyRisks.length > 0) parts.push(`Risks: ${keyRisks.slice(0, 2).join('; ')}`);

        const derived = parts.join(' · ').trim();
        if (derived.length > 0) {
          executiveSummarySource = 'derived';
          obj.summary = derived.length > 240 ? derived.slice(0, 240).trimEnd() + '…' : derived;
        } else {
          // Fallback: prefer any plain-text description if present; otherwise keep empty string.
          const fallbackDesc = typeof anyDeal?.description === 'string' ? anyDeal.description.trim() : '';
          executiveSummarySource = fallbackDesc.length > 0 ? 'fallback' : 'none';
          obj.summary = fallbackDesc;
        }
      }
    }

    const title = typeof obj.title === 'string' ? obj.title.trim() : '';
    if (!title || title.toLowerCase() === 'executive summary') {
      const dealName = typeof anyDeal?.name === 'string' && anyDeal.name.trim().length > 0 ? anyDeal.name.trim() : 'Deal';
      obj.title = `${dealName} — Executive Summary`;
    }

    return obj;
  })();

  const ui: DealUiPayload = {
    ...existingUi,
    executiveSummary: normalizedExecutiveSummary,
    executiveSummaryV2: (existingUi as any).executiveSummaryV2 ?? executiveSummaryV2,
    decisionSummary: existingUi.decisionSummary ?? decisionSummary,
    coverage: existingUi.coverage ?? coverage,
    overviewV2: (existingUi as any).overviewV2 ?? (existingUi as any).dealOverviewV2 ?? dealOverviewV2,
    // Back-compat alias: older UI code may read `dealOverviewV2`.
    dealOverviewV2: (existingUi as any).dealOverviewV2 ?? (existingUi as any).overviewV2 ?? dealOverviewV2,
    updateReportV1: (existingUi as any).updateReportV1 ?? updateReportV1,
		businessArchetypeV1: (existingUi as any).businessArchetypeV1 ?? businessArchetypeV1,
		dealSummaryV2: (existingUi as any).dealSummaryV2 ?? dealSummaryV2,
  };

  const normalized: DealWithUi = {
    ...(raw as any),
    ui,
    ...(normalizedScore !== undefined ? { score: normalizedScore } : {}),
  };

  // DEV-only confirmation logs (gated to avoid noise)
  if (debugApiIsEnabled()) {
    const topLevelKeys = (value: unknown): string[] => {
      if (value == null) return [];
      if (Array.isArray(value)) return ['[array]'];
      if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).slice(0, 50);
      return [`[${typeof value}]`];
    };

    const summary = (ui.executiveSummary as any)?.summary;
    console.info('[DDAI]', {
      type: 'ddai.deal.normalize',
      dealId: String((anyDeal?.id ?? anyDeal?.deal_id ?? anyDeal?.dealId ?? '') || ''),
      uiKeys: Object.keys(ui),
      executiveSummarySource,
      uiValues: {
        executiveSummary_summary: typeof summary === 'string' ? summary : undefined,
        decisionSummary: ui.decisionSummary,
        coverage: ui.coverage,
        overviewV2_present: ui.overviewV2 != null,
        overviewV2_keys: topLevelKeys(ui.overviewV2),
        updateReportV1_present: ui.updateReportV1 != null,
        updateReportV1_keys: topLevelKeys(ui.updateReportV1),
      },
    });
  }

  return normalized;
}

export type JobUpdatedEvent = {
  job_id: string;
  status: string;
  progress_pct?: number;
  message?: string;
  deal_id?: string;
  type?: string;
  updated_at?: string;
  created_at?: string;
  started_at?: string | null;
  status_detail?: JobStatusDetail | null;
  result?: { reason?: string; [key: string]: unknown } | null;
  reason?: string;
  progress?: JobProgressEventV1;
};

export function resolveApiAssetUrl(path: string | null): string | null {
  if (!path) return null;
  const trimmed = path.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
  if (trimmed.startsWith('/uploads/')) return `${API_BASE_URL}${trimmed}`;
  return trimmed;
}

export function makeClientRequestId(): string {
  try {
    const c = (globalThis as any)?.crypto;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  } catch {
    // ignore
  }
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const debugEnabled = debugApiIsEnabled();
  const method = String(options?.method ?? 'GET').toUpperCase();
  const startedAt = typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();

  const metaEnv = (import.meta as any)?.env as any;
  const isDev = !!metaEnv?.DEV;
  const isMutation = method !== 'GET' && method !== 'HEAD';

  const isFormData = options?.body instanceof FormData;
	const hasBody = options?.body !== undefined && options?.body !== null;
  let res: Response | undefined;
  let responseJson: unknown = undefined;
  let error: unknown = undefined;

  const looksLikeJwtExpFailure = (text: string): boolean => {
    const t = (text ?? '').toLowerCase();
    return (
      t.includes('exp') && t.includes('timestamp') && t.includes('failed')
    ) || t.includes('"exp" claim timestamp check failed') || t.includes('jwt expired');
  };

  const normalizeHeadersInit = (input?: HeadersInit): Record<string, string> => {
    const out: Record<string, string> = {};
    try {
      if (!input) return out;
      // Headers instance
      if (typeof (input as any).forEach === 'function') {
        (input as any).forEach((value: any, key: any) => {
          if (typeof key === 'string') out[key] = String(value);
        });
        return out;
      }
      // Array of tuples
      if (Array.isArray(input)) {
        for (const entry of input as any[]) {
          if (Array.isArray(entry) && entry.length >= 2) {
            const k = entry[0];
            const v = entry[1];
            if (typeof k === 'string') out[k] = String(v);
          }
        }
        return out;
      }
      // Plain object
      if (typeof input === 'object') {
        for (const [k, v] of Object.entries(input as Record<string, any>)) {
          if (typeof v !== 'undefined' && v !== null) out[k] = String(v);
        }
      }
    } catch {
      // ignore
    }
    return out;
  };

  const doFetch = async (forceRefreshToken: boolean): Promise<Response> => {
    const authHeader = await getAuthHeader({ forceRefresh: forceRefreshToken, refreshWithinSeconds: 30 });
    return await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers: {
        ...(isFormData ? {} : hasBody ? { 'Content-Type': 'application/json' } : {}),
        ...authHeader,
        ...normalizeHeadersInit(options?.headers),
      },
    });
  };

  try {
    if (isDev && isMutation) {
      console.debug('[api]', method, `${API_BASE_URL}${path}`);
    }

    res = await doFetch(false);

    if (!res.ok) {
      const contentType = res.headers.get('content-type') || '';
      let bodyText = '';
      try {
        if (contentType.includes('application/json')) {
          const bodyJson = await res.json();
          bodyText = JSON.stringify(bodyJson);
        } else {
          bodyText = await res.text();
        }
      } catch {
        try {
          bodyText = await res.text();
        } catch {
          bodyText = '';
        }
      }

      if (isDev) {
        console.error('[api]', method, `${API_BASE_URL}${path}`, res.status, bodyText);
      }

      // Retry once on likely-expired JWT by forcing token refresh.
      if (res.status === 401 && looksLikeJwtExpFailure(bodyText)) {
        const refreshed = await doFetch(true);
        if (refreshed.ok) {
          res = refreshed;
          responseJson = await res.json();
          return responseJson as T;
        }
      }

      const message = bodyText?.trim() || `Request failed with ${res.status}`;
      throw new Error(`HTTP ${res.status} ${method} ${path}: ${message}`);
    }

    responseJson = await res.json();
    return responseJson as T;
  } catch (err) {
    error = err;
    throw err;
  } finally {
    const endedAt = typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
    const status = typeof res?.status === 'number' ? res.status : 0;
    const durationMs = endedAt - startedAt;

    // Always record mutations in a runtime-visible buffer (prod-safe, no tokens/bodies).
    if (isMutation) {
      const fullUrl = `${API_BASE_URL}${path}`;
      const errorMessage = error instanceof Error ? error.message : error ? String(error) : undefined;
      recordApiMutation({
        ts: Date.now(),
        method,
        url: fullUrl,
        path,
        status,
        duration_ms: Math.round(durationMs),
        ok: status >= 200 && status < 400,
        ...(errorMessage ? { error: errorMessage } : {}),
      });

      if (shouldLogApiMutations()) {
        const ms = `${Math.round(durationMs)}ms`;
        if (status >= 200 && status < 400) {
          console.info('[DDAI][api:mutation]', method, fullUrl, status, ms);
        } else {
          console.warn('[DDAI][api:mutation]', method, fullUrl, status, ms, errorMessage ?? '');
        }
      }
    }

    // DEV-only logging for write requests (never log tokens or request bodies).
    if (isDev && isMutation) {
      console.debug('[api]', method, `${API_BASE_URL}${path}`, status, `${Math.round(durationMs)}ms`);
    }

    if (debugEnabled) {
      debugApiLogCall({
        method,
        path,
        dealId: debugApiInferDealId({ path, body: options?.body }),
        status,
        duration_ms: durationMs,
        response: responseJson,
        error,
      });
    }
  }
}

type RequestWithStatusResult<TJson = unknown> = {
  ok: boolean;
  status: number;
  json: TJson | null;
  text: string | null;
};

async function requestWithStatus<TJson = unknown>(path: string, options?: RequestInit): Promise<RequestWithStatusResult<TJson>> {
  const method = String(options?.method ?? 'GET').toUpperCase();
  const isFormData = options?.body instanceof FormData;
  const hasBody = options?.body !== undefined && options?.body !== null;

  const looksLikeJwtExpFailure = (text: string): boolean => {
    const t = (text ?? '').toLowerCase();
    return (
      (t.includes('exp') && t.includes('timestamp') && t.includes('failed'))
    ) || t.includes('"exp" claim timestamp check failed') || t.includes('jwt expired');
  };

  const normalizeHeadersInit = (input?: HeadersInit): Record<string, string> => {
    const out: Record<string, string> = {};
    try {
      if (!input) return out;
      if (typeof (input as any).forEach === 'function') {
        (input as any).forEach((value: any, key: any) => {
          if (typeof key === 'string') out[key] = String(value);
        });
        return out;
      }
      if (Array.isArray(input)) {
        for (const entry of input as any[]) {
          if (Array.isArray(entry) && entry.length >= 2) {
            const k = entry[0];
            const v = entry[1];
            if (typeof k === 'string') out[k] = String(v);
          }
        }
        return out;
      }
      if (typeof input === 'object') {
        for (const [k, v] of Object.entries(input as Record<string, any>)) {
          if (typeof v !== 'undefined' && v !== null) out[k] = String(v);
        }
      }
    } catch {
      // ignore
    }
    return out;
  };

  const doFetch = async (forceRefreshToken: boolean): Promise<Response> => {
    const authHeader = await getAuthHeader({ forceRefresh: forceRefreshToken, refreshWithinSeconds: 30 });
    return await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers: {
        ...(isFormData ? {} : hasBody ? { 'Content-Type': 'application/json' } : {}),
        ...authHeader,
        ...normalizeHeadersInit(options?.headers),
      },
    });
  };

  const parse = async (res: Response): Promise<{ json: unknown | null; text: string | null }> => {
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try {
        const bodyJson = await res.json();
        return { json: bodyJson, text: null };
      } catch {
        // fallthrough to text
      }
    }
    try {
      const bodyText = await res.text();
      return { json: null, text: bodyText };
    } catch {
      return { json: null, text: null };
    }
  };

  let res = await doFetch(false);
  let parsed = await parse(res);

  if (res.status === 401 && typeof parsed.text === 'string' && looksLikeJwtExpFailure(parsed.text)) {
    const refreshed = await doFetch(true);
    if (refreshed.ok) {
      res = refreshed;
      parsed = await parse(res);
    }
  }

  if ((import.meta as any)?.env?.DEV && method !== 'GET' && method !== 'HEAD') {
    const payloadSummary = parsed.json ?? (typeof parsed.text === 'string' ? parsed.text.slice(0, 500) : null);
    console.debug('[api:status]', method, `${API_BASE_URL}${path}`, res.status, payloadSummary);
  }

  return {
    ok: res.ok,
    status: res.status,
    json: (parsed.json as any) ?? null,
    text: parsed.text,
  };
}

export function isLiveBackend() {
  return BACKEND_MODE === 'live';
}

export function apiGetDeals() {
  return request<Deal[]>(`/api/v1/deals`).then((deals) => deals.map((d) => normalizeDeal(d)));
}

export function apiClaimLegacyDeals() {
  return request<{ claimed: number }>(`/api/v1/deals/claim`, {
    method: 'POST',
  });
}

export function apiCreateDeal(input: {
  name: string;
  stage: Deal['stage'];
  priority: Deal['priority'];
  trend?: Deal['trend'];
  score?: number;
  owner?: string;
}) {
  return request<Deal>(`/api/v1/deals`, {
    method: 'POST',
    body: JSON.stringify(input)
  }).then((deal) => normalizeDeal(deal));
}

export function apiCreateDealDraft(input?: {
  name?: string;
  stage?: Deal['stage'];
  priority?: Deal['priority'];
  owner?: string;
}) {
  return request<{ deal_id: string }>(`/api/v1/deals/draft`, {
    method: 'POST',
    body: JSON.stringify(input ?? {}),
  });
}

export function apiGetDeal(dealId: string) {
  return request<Deal>(`/api/v1/deals/${dealId}`).then((deal) => normalizeDeal(deal));
}

export function apiUpdateDeal(
  dealId: string,
  input: Partial<Pick<Deal, 'name' | 'stage' | 'priority' | 'trend' | 'score' | 'owner'>>
) {
  return request<Deal>(`/api/v1/deals/${dealId}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  }).then((deal) => normalizeDeal(deal));
}

export function apiDeleteDeal(dealId: string, opts?: { purge?: boolean }) {
  const purge = opts?.purge !== false;
  const qs = purge ? '?purge=true' : '';
  const adminToken = getDevAdminToken();
  return request<{ ok: boolean; deal_id: string; purge?: unknown }>(`/api/v1/deals/${dealId}${qs}`, {
    method: 'DELETE',
    headers: adminToken ? { Authorization: `Bearer ${adminToken}` } : undefined,
  });
}

export function apiPostAnalyze(dealId: string) {
  return request<{ job_id: string; status: string }>(`/api/v1/deals/${dealId}/analyze`, {
    method: 'POST'
  });
}

export type PageUnderstandingReadinessDocument = {
  document_id: string;
  title: string | null;
  page_count: number;
  dpu_rows: number;
  missing_pages: number[];
  dpu_rows_meaningful?: number;
  non_meaningful_pages?: number[];
};

export type PageUnderstandingReadiness = {
  deal_id: string;
  version: string;
  documents: PageUnderstandingReadinessDocument[];
  expected_pages_total: number;
  dpu_rows_total: number;
  dpu_rows_meaningful_total?: number;
  non_meaningful_pages_total?: number;
  missing_pages_total: number;
  ready: boolean;
  blocked_reason?: string | null;
  poll_after_ms?: number | null;
  action?: { type: string; deal_id?: string; document_id?: string; version?: string } | null;
};

export function apiGetDealReadiness(dealId: string, version: string) {
  const qs = new URLSearchParams();
  if (version) qs.set('page_understanding_version', version);
  return request<PageUnderstandingReadiness>(`/api/v1/deals/${dealId}/readiness?${qs.toString()}`);
}

export function apiPostAnalyzeWithStatus(
  dealId: string,
  input?: { require_page_understanding?: boolean; page_understanding_version?: string }
) {
  return requestWithStatus<{ job_id?: string; status?: string; error?: string; message?: string; readiness?: any }>(
    `/api/v1/deals/${dealId}/analyze`,
    {
      method: 'POST',
      body: JSON.stringify(input ?? {}),
    }
  );
}

export function apiPostExtractVisuals(
  dealId: string,
  opts?: { source?: string; requestId?: string; idempotencyKey?: string }
) {
  const requestId = typeof opts?.requestId === 'string' && opts.requestId.trim().length > 0 ? opts.requestId.trim() : undefined;
  const source = typeof opts?.source === 'string' && opts.source.trim().length > 0 ? opts.source.trim() : undefined;
  const idempotencyKey =
    typeof opts?.idempotencyKey === 'string' && opts.idempotencyKey.trim().length > 0
      ? opts.idempotencyKey.trim()
      : requestId;

  const headers: Record<string, string> = {};
  if (requestId) headers['X-Request-Id'] = requestId;
  if (source) headers['X-Client-Source'] = source;
  if (idempotencyKey) headers['X-Idempotency-Key'] = idempotencyKey;

  return request<{ job_id: string; status: string }>(`/api/v1/deals/${dealId}/extract-visuals`, {
    method: 'POST',
    headers: Object.keys(headers).length > 0 ? headers : undefined,
  });
}

export function apiPostReextractDocuments(
  dealId: string,
  input?: {
    document_ids?: string[];
    threshold_low?: number;
    include_warnings?: boolean;
		force?: boolean;
		mode?: string;
  }
) {
  return request<{ ok: boolean; job_id: string; status?: string }>(`/api/v1/deals/${dealId}/documents/re-extract`, {
    method: 'POST',
    body: JSON.stringify(input ?? {}),
  });
}

export function apiPostVerifyDealDocuments(dealId: string, input?: { document_ids?: string[] }) {
  return request<{ ok: true; deal_id: string; job_id: string; status: string; document_count: number }>(
    `/api/v1/deals/${dealId}/documents/verify`,
    {
      method: 'POST',
      body: JSON.stringify(input ?? {}),
    }
  );
}

export function apiGetJob(jobId: string, opts?: { signal?: AbortSignal }) {
  return request<{
    job_id: string;
    type?: string;
    status: string;
    progress_pct?: number;
    message?: string;
    updated_at?: string;
    created_at?: string;
    started_at?: string | null;
    status_detail?: JobStatusDetail | null;
  }>(`/api/v1/jobs/${jobId}`, {
    signal: opts?.signal,
  });
}

export type DealJobRowV2 = {
  job_id: string;
  queue?: string;
  type?: string;
  status: string;
  stage?: string;
  progress_current?: number;
  progress_total?: number;
  progress_pct?: number;
  message?: string;
  deal_id?: string;
  document_id?: string;
  parent_job_id?: string;
  page_start?: number;
  page_end?: number;
  error?: string;
  created_at?: string;
  updated_at?: string;
  started_at?: string | null;
  finished_at?: string | null;
  status_detail?: JobStatusDetail | null;
};

export function apiGetDealJobs(
  dealId: string,
  opts?: { limit?: number; type?: string; queue?: string }
) {
  const params = new URLSearchParams();
  if (typeof opts?.limit === 'number' && Number.isFinite(opts.limit)) params.set('limit', String(opts.limit));
  if (opts?.type) params.set('type', opts.type);
  if (opts?.queue) params.set('queue', opts.queue);
  const qs = params.toString();
  return request<DealJobRowV2[]>(`/api/v1/deals/${dealId}/jobs${qs ? `?${qs}` : ''}`);
}

export function apiAutoProgressDeal(dealId: string) {
  return request<{
    progressed: boolean;
    newStage?: string;
    currentStage?: string;
    message: string;
  }>(`/api/v1/deals/${dealId}/auto-progress`, {
    method: 'POST'
  });
}

export function apiGetDocuments(dealId: string) {
  return request<{ documents: Array<{
    document_id: string;
    deal_id: string;
    title: string;
    type: string;
    status: string;
    uploaded_at?: string;
  }> }>(`/api/v1/deals/${dealId}/documents`);
}

export type DealLineageNode = {
  // API-stable node identifier (preferred). Backend also mirrors this into `id` for React Flow compatibility.
  node_id?: string;
  id: string;
  // Canonical semantic type (preferred); backend may also populate `type` for React Flow.
  node_type?: string;
  type?: string;
  label?: string;
  metadata?: Record<string, unknown>;
  data?: Record<string, unknown>;
};

export type DealLineageEdge = {
  id: string;
  source: string;
  target: string;
  edge_type?: string;
};

export type DealLineageResponse = {
  deal_id: string;
  nodes: DealLineageNode[];
  edges: DealLineageEdge[];
  warnings: string[];
  // Optional debug payloads (DEV-only on backend).
  segment_audit_report?: SegmentAuditReport;
};

export type DeterministicUnderstandingInput = {
  deal_id: string;
  documents: Array<{
    document_id: string;
    title?: string;
    page_count?: number;
    type?: string;
  }>;
  pages: Array<{
    page_id: string;
    document_id: string;
    page_index?: number;
    page_number?: number;
    raw_ocr_text?: string;
    structured_extraction?: unknown;
    evidence?: unknown;
  }>;
  segments?: Array<{
    segment_id: string;
    label?: string;
    page_ids: string[];
  }>;
};

export type DeterministicUnderstandingPatch = {
  analysis_version: string;
  created_at: string;
  input_hash: string;
  deal_id: string;
  pages: Record<
    string,
    {
      page_id: string;
      document_id: string;
      page_index?: number;
      page_label?: string;
      normalized_text_ref?: string;
      normalized_text?: string;
      normalization_flags?: string[];
      page_type: string;
      confidence: number;
      why: string[];
      evidence: Array<{ snippet: string; score: number; features?: string[]; source_span?: { start: number; end: number } }>;
      key_numbers: Array<{
        metric_type: string;
        value_normalized: number | string;
        raw_value: string;
        unit: string;
        context: string;
        confidence: number;
        source_span?: { start: number; end: number };
      }>;
      key_entities: Array<{ entity_type: string; text: string; confidence: number; source_span?: { start: number; end: number } }>;
      quality_flags: string[];
    }
  >;
  documents: Record<
    string,
    {
      document_id: string;
      document_title?: string;
      document_summary?: unknown;
      document_key_points?: unknown;
      key_points: string[];
      key_numbers: unknown[];
      outline: Array<{ label: string; page_ids: string[] }>;
    }
  >;
  segments?: Record<string, unknown>;
};

export type DealDeterministicUnderstandingResponse = {
  analysis_version: string;
  input_hash: string;
  created_at: string;
  patch: DeterministicUnderstandingPatch;
};

export type SegmentAuditReport = {
  deal_id?: string;
  documents: Array<{
    document_id: string;
    title?: string | null;
    type?: string | null;
    items: SegmentAuditItem[];
  }>;
};

export type SegmentAuditItem = {
  visual_asset_id?: string;
  document_id?: string;
  page_index?: number | null;
  page_label?: string;

  // Persisted segment (from DB/quality flags)
  persisted_segment_key?: string;
  segment?: string;
  segment_source?: string;
  segment_confidence?: number | null;

  // Computed segment (discovery-only rescore)
  computed_segment?: string;
  captured_text?: string;
  computed_reason?: {
    best_score?: number | null;
    runner_up_score?: number | null;
    threshold?: number | null;
    tie_delta?: number | null;
    keyword_hits?: Record<string, unknown>;
    classification_text_len?: number | null;
    classification_text_sources_used?: string[];
  };
};

export function apiGetDealLineage(
  dealId: string,
  opts?: {
    debugSegments?: boolean;
    segmentAudit?: boolean;
    segmentRescore?: boolean;
    groupWord?: boolean;
  }
) {
  const params = new URLSearchParams();
  // Default to grouping structured DOCX blocks to keep the lineage graph usable.
  // Raw blocks remain available via API debug flags.
  if (opts?.groupWord !== false) params.set('group_word', '1');
  if (opts?.debugSegments) params.set('debug_segments', '1');
  if (opts?.segmentAudit) params.set('segment_audit', '1');
  if (opts?.segmentRescore) params.set('segment_rescore', '1');
  const qs = params.toString();
  return request<DealLineageResponse>(`/api/v1/deals/${dealId}/lineage${qs ? `?${qs}` : ''}`);
}

export type VisualAssetEvidenceSummary = {
  count?: number;
  evidence_count?: number;
  sample_snippets?: string[];
};

export type DealVisualAsset = {
  visual_asset_id: string;
  document_id: string;
  deal_id?: string;
  page_index: number | null;
  // Segment classification (best-effort; present on /api/v1/deals/:deal_id/visual-assets)
  segment?: string | null;
  effective_segment?: string | null;
  segment_source?: string | null;
  segment_confidence?: number | null;
  computed_segment?: string | null;
  persisted_segment_key?: string | null;
  asset_type?: string | null;
  bbox?: unknown;
  image_uri?: string | null;
  image_hash?: string | null;
  confidence?: number | null;
  extractor_version?: string | null;
  created_at?: string | null;
  ocr_text?: string | null;
  ocr_suppressed?: boolean;
  structured_json?: unknown;
  structured_kind?: string | null;
  structured_summary?: unknown;
  quality_flags?: unknown;
  evidence?: VisualAssetEvidenceSummary;
  document_title?: string | null;
  document_type?: string | null;
  document_status?: string | null;
  document_page_count?: number | null;
  ai_analysis_investor_last_at?: string | null;
  ai_analysis_analyst_last_at?: string | null;
  document?: {
    id: string | null;
    title: string | null;
    type: string | null;
    status: string | null;
    page_count: number | null;
  };
};

// Back-compat alias: existing UI imports may reference DocumentVisualAsset
export type DocumentVisualAsset = DealVisualAsset;

function normalizeVisualAssetRecord(raw: any, dealId?: string): DealVisualAsset | null {
  if (!raw || typeof raw !== 'object') return null;

  const visual_asset_id =
    raw.visual_asset_id || raw.visualAssetId || raw.visual_assetid || raw.visual_asset_id || raw.id || raw.visual_asset_uuid;
  if (typeof visual_asset_id !== 'string' || !visual_asset_id.trim()) return null;

  const doc = raw.document && typeof raw.document === 'object' ? raw.document : null;
  const docId = doc?.id ?? raw.document_id ?? raw.doc_id ?? raw.documentId ?? raw.documentid ?? raw.document ?? '';
  const docTitle = doc?.title ?? raw.document_title ?? raw.title ?? null;
  const docType = doc?.type ?? raw.document_type ?? raw.type ?? null;
  const docStatus = doc?.status ?? raw.document_status ?? null;
  const docPageCount = doc?.page_count ?? raw.document_page_count ?? null;

  const structured = raw.latest_extraction || raw.latest || raw;
  const ocr_suppressed = Boolean(structured?.ocr_suppressed === true || raw.ocr_suppressed === true);
  const ocr_text = ocr_suppressed
    ? null
    : typeof structured?.ocr_text === 'string'
      ? structured.ocr_text
      : typeof raw.ocr_text === 'string'
        ? raw.ocr_text
        : null;
  const structured_json = structured?.structured_json ?? raw.structured_json ?? null;
  const structured_kind = structured?.structured_kind ?? raw.structured_kind ?? null;
  const structured_summary = structured?.structured_summary ?? raw.structured_summary ?? null;

  const evidence_count =
    (raw.evidence && typeof raw.evidence.evidence_count === 'number' ? raw.evidence.evidence_count : undefined) ??
    (raw.evidence && typeof raw.evidence.count === 'number' ? raw.evidence.count : undefined) ??
    (typeof raw.evidence_count === 'number' ? raw.evidence_count : undefined);
  const sample_snippets =
    (raw.evidence && Array.isArray(raw.evidence.sample_snippets) ? raw.evidence.sample_snippets : undefined) ??
    (Array.isArray(raw.evidence_sample_snippets) ? raw.evidence_sample_snippets : undefined);

  const parsedConfidence = (() => {
    const c = raw.confidence;
    if (typeof c === 'number' && Number.isFinite(c)) return c;
    if (typeof c === 'string') {
      const parsed = Number(c);
      if (Number.isFinite(parsed)) return parsed;
    }
    return null;
  })();

  const parsedSegmentConfidence = (() => {
    const c = raw.segment_confidence ?? raw.segmentConfidence;
    if (typeof c === 'number' && Number.isFinite(c)) return c;
    if (typeof c === 'string') {
      const parsed = Number(c);
      if (Number.isFinite(parsed)) return parsed;
    }
    return null;
  })();

  const segment = typeof raw.segment === 'string' ? raw.segment : typeof raw.effective_segment === 'string' ? raw.effective_segment : null;
  const effective_segment = typeof raw.effective_segment === 'string' ? raw.effective_segment : segment;
  const computed_segment = typeof raw.computed_segment === 'string' ? raw.computed_segment : null;
  const persisted_segment_key =
    typeof raw.persisted_segment_key === 'string'
      ? raw.persisted_segment_key
      : typeof raw.quality_flags?.segment_key === 'string'
        ? raw.quality_flags.segment_key
        : null;
  const segment_source =
    typeof raw.segment_source === 'string'
      ? raw.segment_source
      : typeof raw.quality_flags?.segment_source === 'string'
        ? raw.quality_flags.segment_source
        : null;

  return {
    visual_asset_id,
    document_id: docId,
    deal_id: raw.deal_id ?? dealId,
    page_index: Number.isFinite(raw.page_index) ? Number(raw.page_index) : null,
    segment,
    effective_segment,
    segment_source,
    segment_confidence: parsedSegmentConfidence,
    computed_segment,
    persisted_segment_key,
    asset_type: raw.asset_type ?? raw.type ?? null,
    bbox: raw.bbox,
    image_uri: raw.image_uri ?? raw.image_url ?? null,
    image_hash: raw.image_hash ?? null,
    extractor_version: raw.extractor_version ?? null,
    created_at: raw.created_at ?? null,
    confidence: parsedConfidence,
    quality_flags: raw.quality_flags ?? raw.flags ?? null,
    ocr_text,
    ocr_suppressed,
    structured_json,
    structured_kind,
    structured_summary,
    evidence: evidence_count != null || sample_snippets ? { count: evidence_count, evidence_count, sample_snippets } : raw.evidence,
    document_title: docTitle,
    document_type: docType,
    document_status: docStatus,
    document_page_count: docPageCount,
    ai_analysis_investor_last_at: typeof raw.ai_analysis_investor_last_at === 'string' ? raw.ai_analysis_investor_last_at : raw.ai_analysis_investor_last_at ?? null,
    ai_analysis_analyst_last_at: typeof raw.ai_analysis_analyst_last_at === 'string' ? raw.ai_analysis_analyst_last_at : raw.ai_analysis_analyst_last_at ?? null,
    document: doc
      ? {
          id: docId,
          title: docTitle,
          type: docType,
          status: docStatus,
          page_count: docPageCount,
        }
      : undefined,
  };
}

function normalizeVisualAssetsResponse(list: any[], dealId?: string): DealVisualAsset[] {
  if (!Array.isArray(list)) return [];
  const out: DealVisualAsset[] = [];
  for (const raw of list) {
    const norm = normalizeVisualAssetRecord(raw, dealId);
    if (norm) out.push(norm);
  }
  return out;
}

export type DocumentVisualAssetsResponse = {
  deal_id: string;
  document_id: string;
  visual_assets: DealVisualAsset[];
  warnings: string[];
};

export async function apiGetDocumentVisualAssets(dealId: string, documentId: string, opts?: { includeOcr?: boolean }) {
  const params = new URLSearchParams();
  if (opts?.includeOcr) params.set('include_ocr', '1');
  const qs = params.toString();
  const res = await request<{ deal_id: string; document_id: string; assets?: any[]; visual_assets?: any[]; warnings?: string[] }>(
    `/api/v1/deals/${dealId}/documents/${documentId}/visual-assets${qs ? `?${qs}` : ''}`
  );
  const assetsRaw = Array.isArray(res?.visual_assets) ? res.visual_assets : Array.isArray(res?.assets) ? res.assets : [];
  const visual_assets = normalizeVisualAssetsResponse(assetsRaw, dealId);
  return {
    deal_id: res?.deal_id ?? dealId,
    document_id: res?.document_id ?? documentId,
    visual_assets,
    warnings: Array.isArray(res?.warnings) ? res.warnings : [],
  } satisfies DocumentVisualAssetsResponse;
}

export async function apiGetDealVisualAssets(dealId: string, opts?: { includeOcr?: boolean }) {
  const params = new URLSearchParams();
  if (opts?.includeOcr) params.set('include_ocr', '1');
  const qs = params.toString();
  const res = await request<{ deal_id: string; visual_assets?: any[] }>(`/api/v1/deals/${dealId}/visual-assets${qs ? `?${qs}` : ''}`);
  const visual_assets = normalizeVisualAssetsResponse(Array.isArray(res?.visual_assets) ? res.visual_assets : [], dealId);
  return { deal_id: res?.deal_id ?? dealId, visual_assets };
}

export async function apiPostVisualAssetSegmentOverride(input: { visualAssetId: string; segment_key: string; note?: string }) {
  const { visualAssetId, segment_key, note } = input;
  return request<{ ok: boolean; visual_asset_id: string; quality_flags?: any }>(`/visual-assets/${visualAssetId}/segment-override`, {
    method: 'POST',
    body: JSON.stringify({ segment_key, note }),
  });
}

export async function apiDeleteVisualAssetSegmentOverride(visualAssetId: string) {
  return request<{ ok: boolean; visual_asset_id: string; quality_flags?: any }>(`/visual-assets/${visualAssetId}/segment-override`, {
    method: 'DELETE',
  });
}

export async function apiPostVisualAssetAiAnalyze(input: {
  visualAssetId: string;
  audience: 'investor' | 'analyst';
  question?: string;
  force?: boolean;
}) {
  const { visualAssetId, audience, question, force } = input;
  return request<{
    ok: boolean;
    visual_asset_id: string;
    deal_id?: string;
    document_id?: string;
    audience: 'investor' | 'analyst';
    title?: string | null;
    answer_markdown: string;
    evidence?: Array<{ path: string; value?: unknown; note?: string | null }>;
    limitations?: string[];
    followups?: string[];
    model?: string;
    usage?: any;
    llm_called?: boolean;
    duration_ms?: number;
    cached?: boolean;
    analysis_created_at?: string;
  }>(`/visual-assets/${visualAssetId}/ai-analyze`, {
    method: 'POST',
    body: JSON.stringify({
      audience,
      ...(typeof question === 'string' && question.trim().length > 0 ? { question: question.trim() } : {}),
      ...(force === true ? { force: true } : {}),
    }),
  });
}

export async function apiPostDealNodeAiAnalyze(input: {
  dealId: string;
  audience: 'investor' | 'analyst';
  node?: any;
  source_json?: any;
  question?: string;
  force?: boolean;
}) {
  const { dealId, audience, node, source_json, question, force } = input;
  return request<{
    ok: boolean;
    deal_id: string;
    node_key: string;
    audience: 'investor' | 'analyst';
    title?: string | null;
    answer_markdown: string;
    evidence?: Array<{ path: string; value?: unknown; note?: string | null }>;
    limitations?: string[];
    followups?: string[];
    model?: string;
    usage?: any;
    llm_called?: boolean;
    duration_ms?: number;
    cached?: boolean;
    analysis_created_at?: string;
  }>(`/api/v1/deals/${dealId}/ai-analyze`, {
    method: 'POST',
    body: JSON.stringify({
      audience,
      ...(typeof question === 'string' && question.trim().length > 0 ? { question: question.trim() } : {}),
      ...(force === true ? { force: true } : {}),
      ...(node ? { node } : {}),
      ...(typeof source_json !== 'undefined' ? { source_json } : {}),
    }),
  });
}

export type ExtractionConfidenceBand = 'high' | 'medium' | 'low' | 'unknown';
export type ExtractionRecommendedAction = 'proceed' | 'remediate' | 're_extract' | 'wait';

export type DocumentExtractionReport = {
  id: string;
  title: string | null;
  type: string | null;
  status: string | null;
  verification_status: string;
  pages: number;
  file_size_bytes: number;
  extraction_quality_score: number | null;
  confidence_band: ExtractionConfidenceBand;
  ocr_avg_confidence?: number | null;
  verification_warnings?: string[];
  verification_recommendations?: string[];
  recommended_action: ExtractionRecommendedAction;
  recommendation_reason: string;
};

export type DealExtractionReport = {
  deal_id: string;
  overall_confidence_score: number | null;
  confidence_band: ExtractionConfidenceBand;
  thresholds?: { high: number; medium: number };
  counts: {
    total_documents: number;
    completed_verification: number;
    failed_verification: number;
    total_pages: number;
    high_confidence: number;
    medium_confidence: number;
    low_confidence: number;
    unknown_confidence: number;
  };
  recommended_action: ExtractionRecommendedAction;
  recommendation_reason: string;
  note?: string | null;
};

export type DealIngestionStatusResponse = {
  deal_id: string;
  ingestion_status: {
    files_uploaded: number;
    total_pages: number;
    verification_summary: {
      verified: number;
      warnings: number;
      failed: number;
      pending: number;
    };
    overall_readiness: 'ready' | 'needs_review' | 'in_progress' | 'failed';
    readiness_details: string;
  };
  extraction_report: DealExtractionReport;
  documents: DocumentExtractionReport[];
  last_updated?: string;
};

export function apiGetDealIngestionStatus(dealId: string) {
  return request<DealIngestionStatusResponse>(`/api/v1/deals/${dealId}/documents/ingestion-status`);
}

export function apiGetDealExtractionReport(dealId: string) {
  return request<{
    deal_id: string;
    extraction_report: DealExtractionReport;
    documents: DocumentExtractionReport[];
    last_updated?: string;
  }>(`/api/v1/deals/${dealId}/documents/extraction-report`);
}

export type DocumentAnalysisResponse = {
  document_id: string;
  deal_id: string;
  status: string;
  structured_data: any | null;
  extraction_metadata: any | null;
  job_status: string | null;
  job_message: string | null;
  job_progress: number | null;
};

export type RenderedPageSignedUrlResponse = {
  deal_id: string;
  document_id: string;
  page_index: number;
  provider: 'r2';
  key: string;
  url: string;
  expires_in_seconds: number | null;
};

export function apiGetDocumentAnalysis(dealId: string, documentId: string) {
  return request<DocumentAnalysisResponse>(
    `/api/v1/deals/${dealId}/documents/${documentId}/analysis`
  );
}

export function apiGetRenderedPageSignedUrl(dealId: string, documentId: string, pageIndex: number) {
  const idx = Number.isFinite(pageIndex) ? Math.max(0, Math.trunc(pageIndex)) : 0;
  return request<RenderedPageSignedUrlResponse>(
    `/api/v1/deals/${dealId}/documents/${documentId}/rendered-pages/${idx}/signed-url`
  );
}

export function apiGetEvidence(dealId: string) {
  return request<{ evidence: Array<any> }>(`/api/v1/deals/${dealId}/evidence`).then((res) => {
    // API returns `id` (UUID) as the primary evidence identifier.
    const evidence = Array.isArray(res?.evidence)
      ? res.evidence
          .map((row) => ({
            evidence_id: row?.evidence_id ?? row?.id,
            deal_id: row?.deal_id,
            document_id: row?.document_id ?? undefined,
            visual_asset_id: row?.visual_asset_id ?? undefined,
            source: row?.source,
            kind: row?.kind,
            text: row?.text,
            confidence: typeof row?.confidence === 'number' ? row.confidence : row?.confidence ?? undefined,
            created_at: row?.created_at ?? undefined,
          }))
          .filter((row) => typeof row.evidence_id === 'string' && row.evidence_id.length > 0)
      : [];
    return { evidence };
  });
}

export type EvidenceResolveResult = {
  id: string;
  ok: boolean;
  resolvable?: boolean;
  document_id?: string;
  document_title?: string;
  page?: number;
  snippet?: string;
};

export function apiResolveEvidence(ids: string[]) {
  const safeIds = Array.from(
    new Set((ids ?? []).filter((id): id is string => typeof id === 'string' && id.trim().length > 0).map((id) => id.trim()))
  ).slice(0, 100);

  if (safeIds.length === 0) {
    return Promise.resolve<{ results: EvidenceResolveResult[] }>({ results: [] });
  }

  // Comma-separated to match API.
  const qs = encodeURIComponent(safeIds.join(','));
  return request<{ results: EvidenceResolveResult[] }>(`/api/v1/evidence/resolve?ids=${qs}`);
}

export type DealReport = {
  dealId: string;
  generatedAt: string;
  version: number;
  overallScore: number;
  grade: string;
  recommendation: 'strong_yes' | 'yes' | 'consider' | 'pass';
  categories?: Array<{ name: string; score: number; issues?: string[]; strengths?: string[]; recommendations?: string[] }>;
  redFlags?: Array<{ severity: 'high' | 'medium' | 'low'; message: string; action: string }>;
  greenFlags?: string[];
  sections?: Array<{ id: string; title: string; content: string; evidence_ids?: string[] }>;
  completeness?: number;
  metadata?: Record<string, any>;
};

export type DealReportEnvelope =
  | {
      ready: false;
      reason: 'not_generated_yet' | string;
      version?: number;
      artifact?: unknown;
      report?: DealReport | null;
    }
  | {
      ready: true;
      version: number;
      artifact: unknown;
      report?: DealReport | null;
      // Backward compat: API may also include report fields at top-level.
      [key: string]: unknown;
    }
  | (DealReport & { ready?: true | false; reason?: string; artifact?: unknown; report?: DealReport | null });

const isDealReport = (value: unknown): value is DealReport => {
  if (!value || typeof value !== 'object') return false;
  const v = value as any;
  return typeof v.dealId === 'string' && typeof v.generatedAt === 'string' && typeof v.version === 'number';
};

const normalizeReportEnvelope = (value: unknown): DealReportEnvelope => {
  if (!value || typeof value !== 'object') return { ready: false, reason: 'not_generated_yet' };
  const v = value as any;
  if (typeof v.ready === 'boolean') return v as DealReportEnvelope;
  if (isDealReport(v)) return v as DealReportEnvelope;
  // If API returns a ready payload without the `ready` key (legacy), treat as ready.
  if (typeof v.dealId === 'string' && typeof v.version === 'number') return v as DealReportEnvelope;
  return v as DealReportEnvelope;
};

export async function apiGetDealReport(dealId: string): Promise<DealReportEnvelope> {
  return apiGetDealReportInternal(dealId, { narrate: false });
}

export async function apiGetDealReportNarrated(dealId: string): Promise<DealReportEnvelope> {
  return apiGetDealReportInternal(dealId, { narrate: true });
}

export type PersistedGovernedOverlayOverview = {
  schema_version: string;
  deal_id: string;
  run_id?: string;
  step_run_id?: string;
  input_hash: string;
  created_at: string;
  llm_phase_mode: 'exploratory' | 'stabilizing' | 'governed';
  summary_text: string;
  claims: any[];
  disclosures: any[];
};

export async function apiGetDealGovernedOverlayPersisted(
  dealId: string
): Promise<{ overview: PersistedGovernedOverlayOverview | null }> {
  const path = `/api/v1/deals/${dealId}/governed-llm-overview`;

  const doFetch = async (forceRefreshToken: boolean): Promise<Response> => {
    const authHeader = await getAuthHeader({ forceRefresh: forceRefreshToken, refreshWithinSeconds: 30 });
    return await fetch(`${API_BASE_URL}${path}`, {
      method: 'GET',
      cache: 'no-store',
      headers: {
        ...authHeader,
      },
    });
  };

  const tryParseJson = async (res: Response): Promise<any> => {
    try {
      return await res.json();
    } catch {
      return null;
    }
  };

  try {
    let res = await doFetch(false);
    if (!res.ok && res.status === 401) {
      // Retry once with a forced refresh token (mirrors /report behavior).
      res = await doFetch(true);
    }
    if (!res.ok) {
      // Caller decides fallback behavior; treat non-200 as error by throwing.
      throw new Error(`governed_overlay_http_${res.status}`);
    }

    const payload = await tryParseJson(res);
    const overview = payload && typeof payload === 'object' ? (payload as any).overview : null;
    return { overview: (overview && typeof overview === 'object') ? (overview as PersistedGovernedOverlayOverview) : null };
  } catch (err) {
    // Surface error to allow caller to fallback.
    throw err;
  }
}

async function apiGetDealReportInternal(dealId: string, opts: { narrate: boolean }): Promise<DealReportEnvelope> {
  const qs = opts.narrate ? '?narrate=1' : '';
  const path = `/api/v1/deals/${dealId}/report${qs}`;
  const debugEnabled = debugApiIsEnabled();
  const startedAt = typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
  let res: Response | undefined;
  let responseJson: unknown = undefined;
  let error: unknown = undefined;

  const doFetch = async (forceRefreshToken: boolean): Promise<Response> => {
    const authHeader = await getAuthHeader({ forceRefresh: forceRefreshToken, refreshWithinSeconds: 30 });
    return await fetch(`${API_BASE_URL}${path}`, {
      method: 'GET',
      cache: 'no-store',
      headers: {
        ...authHeader,
      },
    });
  };

  const looksLikeJwtExpFailure = (text: string): boolean => {
    const t = (text ?? '').toLowerCase();
    return (
      t.includes('exp') && t.includes('timestamp') && t.includes('failed')
    ) || t.includes('"exp" claim timestamp check failed') || t.includes('jwt expired');
  };

  try {
    res = await doFetch(false);
    // New contract: /report should not 404 for normal pre-analysis states.
    // Keep legacy handling in case older servers are still deployed.
    if (res.status === 404) return { ready: false, reason: 'not_generated_yet' };
    if (!res.ok) {
      const text = await res.text();

      if (res.status === 401 && looksLikeJwtExpFailure(text || '')) {
        const refreshed = await doFetch(true);
        if (refreshed.status === 404) return { ready: false, reason: 'not_generated_yet' };
        if (refreshed.ok) {
          res = refreshed;
          responseJson = await res.json();
          return normalizeReportEnvelope(responseJson);
        }
      }

      throw new Error(text || `Request failed with ${res.status}`);
    }
    responseJson = await res.json();
    return normalizeReportEnvelope(responseJson);
  } catch (err) {
    error = err;
    throw err;
  } finally {
    if (debugEnabled) {
      const endedAt = typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
      debugApiLogCall({
        method: 'GET',
        path,
        dealId,
        status: typeof res?.status === 'number' ? res.status : 0,
        duration_ms: endedAt - startedAt,
        response: responseJson,
        error,
      });
    }
  }
}

export async function apiGetDealDeterministicUnderstanding(dealId: string): Promise<DealDeterministicUnderstandingResponse | null> {
  const path = `/api/v1/deals/${dealId}/understanding/deterministic`;
  const debugEnabled = debugApiIsEnabled();
  const startedAt = typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
  let res: Response | undefined;
  let responseJson: unknown = undefined;
  let error: unknown = undefined;

  const doFetch = async (forceRefreshToken: boolean): Promise<Response> => {
    const authHeader = await getAuthHeader({ forceRefresh: forceRefreshToken, refreshWithinSeconds: 30 });
    return await fetch(`${API_BASE_URL}${path}`, {
      method: 'GET',
      headers: {
        ...authHeader,
      },
    });
  };

  const looksLikeJwtExpFailure = (text: string): boolean => {
    const t = (text ?? '').toLowerCase();
    return (
      t.includes('exp') && t.includes('timestamp') && t.includes('failed')
    ) || t.includes('"exp" claim timestamp check failed') || t.includes('jwt expired');
  };

  try {
    res = await doFetch(false);
    if (res.status === 404) {
      return null;
    }
    if (!res.ok) {
      const text = await res.text();

      if (res.status === 401 && looksLikeJwtExpFailure(text || '')) {
        const refreshed = await doFetch(true);
        if (refreshed.status === 404) return null;
        if (refreshed.ok) {
          res = refreshed;
          responseJson = await res.json();
          return responseJson as DealDeterministicUnderstandingResponse;
        }
      }

      throw new Error(text || `Request failed with ${res.status}`);
    }
    responseJson = await res.json();
    return responseJson as DealDeterministicUnderstandingResponse;
  } catch (err) {
    error = err;
    throw err;
  } finally {
    if (debugEnabled) {
      const endedAt = typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
      debugApiLogCall({
        method: 'GET',
        path,
        dealId,
        status: typeof res?.status === 'number' ? res.status : 0,
        duration_ms: endedAt - startedAt,
        response: responseJson,
        error,
      });
    }
  }
}

export function apiPostDealDeterministicUnderstanding(dealId: string, input: DeterministicUnderstandingInput) {
  return request<DealDeterministicUnderstandingResponse>(`/api/v1/deals/${dealId}/understanding/deterministic`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function apiFetchEvidence(dealId: string, filter?: string) {
  return request<{ job_id: string; status: string }>(`/api/v1/evidence/fetch`, {
    method: 'POST',
    body: JSON.stringify({ deal_id: dealId, filter })
  });
}

export function apiChatWorkspace(message: string) {
  return request<WorkspaceChatResponse>(`/api/v1/chat/workspace`, {
    method: 'POST',
    body: JSON.stringify({ message }),
  });
}

export function apiChatDeal(dealId: string, message: string, dioVersionId?: string) {
  return request<DealChatResponse>(`/api/v1/chat/deal`, {
    method: 'POST',
    body: JSON.stringify({
      message,
      deal_id: dealId,
      dio_version_id: dioVersionId,
    }),
  });
}

export async function apiUploadDocument(dealId: string, file: File, type = 'other', title?: string) {
  const form = new FormData();
  form.append('file', file);
  form.append('type', type);
  if (title) form.append('title', title);

  return request<{
    document: {
      document_id: string;
      deal_id: string;
      title: string;
      type: string;
      status: string;
      uploaded_at?: string;
    };
    job_status: string;
  }>(`/api/v1/deals/${dealId}/documents`, {
    method: 'POST',
    body: form,
  });
}

export type ProposedDealProfile = {
  company_name: string | null;
  deal_name: string | null;
  investment_type: string | null;
  round: string | null;
  industry: string | null;
};

export type AutoProfileResponse = {
  deal_id: string;
  proposed_profile: ProposedDealProfile;
  confidence: Record<string, number>;
  sources: Record<string, string[]>;
  warnings: string[];
};

export function apiAutoProfileDeal(dealId: string) {
  return request<AutoProfileResponse>(`/api/v1/deals/${dealId}/auto-profile`, {
    method: 'POST',
  });
}

export function apiConfirmDealProfile(dealId: string, profile: ProposedDealProfile) {
  return request<Deal>(`/api/v1/deals/${dealId}/confirm-profile`, {
    method: 'POST',
    body: JSON.stringify(profile),
  }).then((deal) => normalizeDeal(deal));
}

export async function apiRetryDocument(dealId: string, documentId: string) {
  return request<Record<string, unknown>>(`/api/v1/deals/${dealId}/documents/${documentId}/retry`, {
    method: 'POST'
  });
}

export async function apiDeleteDocument(dealId: string, documentId: string) {
  return request<{ ok: true; deal_id: string; document_id: string }>(
    `/api/v1/deals/${dealId}/documents/${documentId}`,
    { method: 'DELETE' }
  );
}

export async function apiAnalyzeDocumentsBatch(filenames: string[]) {
  return request<{
    analysis: any;
    deals: Array<{ id: string; name: string }>;
  }>(`/api/v1/documents/analyze-batch`, {
    method: 'POST',
    body: JSON.stringify({ filenames }),
  });
}

export async function apiBulkAssignDocuments(input: {
  assignments: Array<{ filename: string; dealId: string; type?: string }>;
  newDeals?: Array<{ filename: string; dealName: string; type?: string }>;
}) {
  return request<{
    assignments: any[];
    message: string;
  }>(`/api/v1/documents/bulk-assign`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function subscribeToEvents(
  dealId: string,
  handlers: {
    onReady?: () => void;
    onJobUpdated?: (data: JobUpdatedEvent) => void;
    onError?: (err: unknown) => void;
  },
  options?: { cursor?: string }
) {
  const lastEventIdRef = { current: options?.cursor } as { current: string | undefined };
  let stopped = false;
  let retryDelay = 250;
  const MAX_RETRY_DELAY = 10_000;
  const AUTH_ERR_PREFIX = '__SSE_AUTH__';
  let sseAuthMode: 'header' | 'query' = 'header';

  let controller: AbortController | null = null;

  const cleanupSource = () => {
    try {
      controller?.abort();
    } catch {
      // ignore
    }
    controller = null;
  };

  const metaEnv = (import.meta as any)?.env as any;
  const isDev = !!metaEnv?.DEV;
  const sseLog = (...args: any[]) => {
    if (!isDev) return;
    // Never log tokens.
    console.debug('[DDAI][sse]', ...args);
  };

  const nextBackoffMs = (): number => {
    const d = retryDelay;
    retryDelay = Math.min(MAX_RETRY_DELAY, retryDelay * 2);
    return d;
  };

  const resetBackoff = () => {
    retryDelay = 250;
  };

  const normalizeProgress = (payload: any, eventName: string): JobProgressEventV1 | null => {
    if (!payload || typeof payload !== 'object') return null;
    const rawProgress = (payload as any).progress && typeof (payload as any).progress === 'object'
      ? (payload as any).progress
      : (payload as any).stage
        ? payload
        : null;
    if (!rawProgress || typeof rawProgress !== 'object') return null;
    const percent = typeof (rawProgress as any).percent === 'number'
      ? (rawProgress as any).percent
      : typeof (payload as any).progress_pct === 'number'
        ? (payload as any).progress_pct
        : undefined;
    const normalized: JobProgressEventV1 = {
      ...(rawProgress as any),
      version: (rawProgress as any).version ?? (payload as any).version,
      job_id: (rawProgress as any).job_id ?? (payload as any).job_id ?? '',
      deal_id: (rawProgress as any).deal_id ?? (payload as any).deal_id ?? dealId,
      document_id: (rawProgress as any).document_id ?? (payload as any).document_id,
      type: (rawProgress as any).type ?? (payload as any).type,
      status: (rawProgress as any).status ?? (payload as any).status ?? (eventName === 'job.progress' ? 'running' : undefined),
      stage: (rawProgress as any).stage,
      percent,
      completed: (rawProgress as any).completed ?? (payload as any).completed,
      total: (rawProgress as any).total ?? (payload as any).total,
      message: (rawProgress as any).message ?? (payload as any).message,
      reason: (rawProgress as any).reason ?? (payload as any).reason,
      meta: (rawProgress as any).meta ?? (payload as any).meta,
      at: (rawProgress as any).at ?? (payload as any).updated_at ?? (payload as any).created_at,
    };
    return normalized;
  };

  const normalizeJobPayload = (payload: any, eventName: string): JobUpdatedEvent => {
    const progress = normalizeProgress(payload, eventName);
    const updatedAt = (payload as any)?.updated_at ?? progress?.at;
    const normalized: JobUpdatedEvent = {
      ...(payload as any),
      job_id: (payload as any)?.job_id ?? progress?.job_id ?? '',
      deal_id: (payload as any)?.deal_id ?? progress?.deal_id ?? dealId,
      type: (payload as any)?.type ?? progress?.type,
      status: (payload as any)?.status ?? progress?.status ?? (eventName === 'job.progress' ? 'running' : undefined),
      progress_pct: (payload as any)?.progress_pct ?? progress?.percent,
      message: (payload as any)?.message ?? progress?.message,
      updated_at: updatedAt,
      created_at: (payload as any)?.created_at,
      started_at: (payload as any)?.started_at,
      status_detail: (payload as any)?.status_detail ?? (progress ? { progress } : undefined),
      progress,
    };
    return normalized;
  };

  const connect = async () => {
    if (stopped) return;

    // Ensure only one active connection attempt at a time.
    cleanupSource();

    // New controller per connection attempt.
    controller = new AbortController();

    // Always fetch a fresh token immediately before opening SSE.
    // This avoids long-lived sessions reusing stale JWTs.
    const authHeader = await getAuthHeader({ forceRefresh: true, refreshWithinSeconds: 30 });
    const clerkToken = await getAuthToken({ forceRefresh: true, refreshWithinSeconds: 30 });

    // Don't attempt to open SSE without credentials; wait for auth to become available.
    if (!authHeader.Authorization && !clerkToken) {
      const delay = nextBackoffMs();
      sseLog('connect:no-auth', { dealId, retry_in_ms: delay });
      if (debugApiIsEnabled()) debugApiLogSse({ event: 'connect:no-auth', dealId, data: { retry_in_ms: delay } });
      setTimeout(() => {
        connect();
      }, delay);
      return;
    }

    const params = new URLSearchParams({ deal_id: dealId });
    // Browser/proxy-safe auth fallback: if header-based SSE fails, retry with a query token.
    if (sseAuthMode === 'query' && clerkToken) {
      params.set('token', clerkToken);
    }
    if (lastEventIdRef.current) {
      const raw = lastEventIdRef.current;
      // Backend expects ISO datetime with offset. If we somehow have a JS Date string, normalize it.
      const parsed = Date.parse(raw);
      const normalized = Number.isFinite(parsed) ? new Date(parsed).toISOString() : raw;
      params.set('cursor', normalized);
    }
    const url = `${API_BASE_URL}/api/v1/events?${params.toString()}`;

    sseLog('connect:attempt', { dealId, mode: sseAuthMode, retry_delay_ms: retryDelay });
    if (debugApiIsEnabled()) debugApiLogSse({ event: 'connect:attempt', dealId, data: { mode: sseAuthMode, retry_delay_ms: retryDelay } });

    try {
      const handleJobEvent = (eventName: string, data: unknown, lastEventId?: string) => {
        try {
          const normalized = normalizeJobPayload(data, eventName);
          const lastId = lastEventId || normalized.updated_at;
          if (lastId) lastEventIdRef.current = lastId;
          if (debugApiIsEnabled()) {
            debugApiLogSse({ event: eventName, dealId: normalized?.deal_id ?? dealId, data: normalized });
          }
          handlers.onJobUpdated?.(normalized);
        } catch (err) {
          if (debugApiIsEnabled()) {
            debugApiLogSse({ event: `${eventName}_parse_error`, dealId, error: err });
          }
          handlers.onError?.(err);
        }
      };

      await fetchEventSource(url, {
        signal: controller.signal,
        headers: {
          ...authHeader,
        },
        onopen: async (resp) => {
          if (resp.ok) {
            resetBackoff();
            sseLog('connect:open', { dealId, mode: sseAuthMode });
            if (debugApiIsEnabled()) debugApiLogSse({ event: 'connect:open', dealId, data: { mode: sseAuthMode } });
            return;
          }
          if (resp.status === 401 || resp.status === 403) {
            // If header auth failed but we have a Clerk token, retry using a query token.
            if (sseAuthMode === 'header' && clerkToken) {
              sseAuthMode = 'query';
              sseLog('connect:401:switch-to-query', { dealId, status: resp.status });
              if (debugApiIsEnabled()) debugApiLogSse({ event: 'connect:401:switch-to-query', dealId, data: { status: resp.status } });
              throw new Error(`${AUTH_ERR_PREFIX}:switch_to_query:${resp.status}`);
            }

            sseLog('connect:401', { dealId, status: resp.status });
            if (debugApiIsEnabled()) debugApiLogSse({ event: 'connect:401', dealId, data: { status: resp.status } });
            throw new Error(`${AUTH_ERR_PREFIX}:${resp.status}`);
          }
          const text = await resp.text().catch(() => '');
          throw new Error(text || `SSE open failed (${resp.status})`);
        },
        onmessage: (msg) => {
          if (msg.event === 'ready') {
            resetBackoff();
            if (debugApiIsEnabled()) debugApiLogSse({ event: 'ready', dealId });
            handlers.onReady?.();
            return;
          }

          if (msg.event === 'job.updated' || msg.event === 'job.progress') {
            let parsed: unknown = msg.data;
            try {
              parsed = msg.data ? JSON.parse(msg.data) : null;
            } catch {
              // ignore
            }
            handleJobEvent(msg.event, parsed, msg.id);
          }
        },
        onerror: (err) => {
          // Important: throw to stop fetch-event-source's internal retry.
          // We handle retries in the outer catch with fresh tokens.
          throw err;
        },
      });
    } catch (err) {
      if (debugApiIsEnabled()) debugApiLogSse({ event: 'disconnect', dealId, error: err });
      handlers.onError?.(err);
      if (stopped) return;

      const isAuthError = typeof (err as any)?.message === 'string' && String((err as any).message).startsWith(AUTH_ERR_PREFIX);
      const delay = nextBackoffMs();

      if (isAuthError) {
        sseLog('retry:auth', { dealId, retry_in_ms: delay, error: String((err as any)?.message ?? '') });
        if (debugApiIsEnabled()) debugApiLogSse({ event: 'retry:auth', dealId, data: { retry_in_ms: delay, error: String((err as any)?.message ?? '') } });
      } else {
        sseLog('retry', { dealId, retry_in_ms: delay });
        if (debugApiIsEnabled()) debugApiLogSse({ event: 'retry', dealId, data: { retry_in_ms: delay } });
      }

      setTimeout(() => connect(), delay);
    }
  };

  void connect();

  return () => {
    stopped = true;
    cleanupSource();
  };
}

export const apiClient = {
  get: request,
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined
    }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: 'PUT',
      body: body ? JSON.stringify(body) : undefined
    }),
  del: <T>(path: string) =>
    request<T>(path, {
      method: 'DELETE'
    })
};

export type { Deal };