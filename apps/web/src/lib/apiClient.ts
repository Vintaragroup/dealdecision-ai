import type { Deal, WorkspaceChatResponse, DealChatResponse } from '@dealdecision/contracts';

import { debugApiInferDealId, debugApiIsEnabled, debugApiLogCall, debugApiLogSse } from './debugApi';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:9000';
const BACKEND_MODE = (import.meta.env.VITE_BACKEND_MODE || 'mock').toLowerCase();

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
};

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const debugEnabled = debugApiIsEnabled();
  const method = String(options?.method ?? 'GET').toUpperCase();
  const startedAt = typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();

  const isFormData = options?.body instanceof FormData;
	const hasBody = options?.body !== undefined && options?.body !== null;
  let res: Response | undefined;
  let responseJson: unknown = undefined;
  let error: unknown = undefined;

  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      headers: {
        ...(isFormData ? {} : hasBody ? { 'Content-Type': 'application/json' } : {}),
        ...(options?.headers || {})
      }
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `Request failed with ${res.status}`);
    }

    responseJson = await res.json();
    return responseJson as T;
  } catch (err) {
    error = err;
    throw err;
  } finally {
    if (debugEnabled) {
      const endedAt = typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
      debugApiLogCall({
        method,
        path,
        dealId: debugApiInferDealId({ path, body: options?.body }),
        status: typeof res?.status === 'number' ? res.status : 0,
        duration_ms: endedAt - startedAt,
        response: responseJson,
        error,
      });
    }
  }
}

export function isLiveBackend() {
  return BACKEND_MODE === 'live';
}

export function apiGetDeals() {
  return request<Deal[]>(`/api/v1/deals`).then((deals) => deals.map((d) => normalizeDeal(d)));
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

export function apiGetDeal(dealId: string) {
  return request<Deal>(`/api/v1/deals/${dealId}`).then((deal) => normalizeDeal(deal));
}

export function apiPostAnalyze(dealId: string) {
  return request<{ job_id: string; status: string }>(`/api/v1/deals/${dealId}/analyze`, {
    method: 'POST'
  });
}

export function apiGetJob(jobId: string) {
  return request<{
    job_id: string;
    type?: string;
    status: string;
    progress_pct?: number;
    message?: string;
    updated_at?: string;
  }>(`/api/v1/jobs/${jobId}`);
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

export function apiGetDocumentAnalysis(dealId: string, documentId: string) {
  return request<DocumentAnalysisResponse>(
    `/api/v1/deals/${dealId}/documents/${documentId}/analysis`
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

export function apiGetDealReport(dealId: string) {
  return request<DealReport>(`/api/v1/deals/${dealId}/report`);
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
  if (typeof EventSource === 'undefined') {
    return () => {};
  }

  const params = new URLSearchParams({ deal_id: dealId });
  if (options?.cursor) {
    params.set('cursor', options.cursor);
  }

  const url = `${API_BASE_URL}/api/v1/events?${params.toString()}`;
  
  let source: EventSource | null = null;
  let hasConnected = false;

  try {
    source = new EventSource(url);

    const lastEventIdRef = { current: options?.cursor } as { current: string | undefined };

    const handleJobUpdated = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as JobUpdatedEvent;
        if (debugApiIsEnabled()) {
          debugApiLogSse({ event: 'job.updated', dealId: data?.deal_id ?? dealId, data });
        }
        lastEventIdRef.current = data.updated_at ?? lastEventIdRef.current;
        handlers.onJobUpdated?.(data);
      } catch (err) {
        if (debugApiIsEnabled()) {
          debugApiLogSse({ event: 'job.updated_parse_error', dealId, error: err });
        }
        handlers.onError?.(err);
      }
    };

    source.addEventListener('ready', () => {
      hasConnected = true;
      if (debugApiIsEnabled()) debugApiLogSse({ event: 'ready', dealId });
      handlers.onReady?.();
    });
    source.addEventListener('job.updated', handleJobUpdated);
    source.addEventListener('error', (event) => {
      // Gracefully handle CORS and connection errors
      // The frontend can continue without SSE if the backend doesn't support it
      if (source?.readyState === EventSource.CLOSED) {
        // Connection closed, app will continue with fallback
      }
      if (debugApiIsEnabled()) debugApiLogSse({ event: 'error', dealId, error: event });
      handlers.onError?.(event);
    });

    return () => {
      if (source) {
        source.close();
        source = null;
      }
    };
  } catch (err) {
    // EventSource initialization failed (likely CORS), return no-op cleanup
    // App continues to work without real-time updates
    if (debugApiIsEnabled()) debugApiLogSse({ event: 'init_error', dealId, error: err });
    return () => {};
  }
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