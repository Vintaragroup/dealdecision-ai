import type { Deal, WorkspaceChatResponse, DealChatResponse } from '@dealdecision/contracts';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:9000';
const BACKEND_MODE = (import.meta.env.VITE_BACKEND_MODE || 'mock').toLowerCase();

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
  const isFormData = options?.body instanceof FormData;
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...(options?.headers || {})
    }
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Request failed with ${res.status}`);
  }

  return res.json();
}

export function isLiveBackend() {
  return BACKEND_MODE === 'live';
}

export function apiGetDeals() {
  return request<Deal[]>(`/api/v1/deals`);
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
  });
}

export function apiGetDeal(dealId: string) {
  return request<Deal>(`/api/v1/deals/${dealId}`);
}

// Phase 1 contract view (no legacy scoring language; includes deal.phase1.* slices)
export function apiGetDealPhase1(dealId: string) {
  return request<any>(`/api/v1/deals/${dealId}?mode=phase1`);
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

  const res = await fetch(`${API_BASE_URL}/api/v1/deals/${dealId}/documents`, {
    method: 'POST',
    body: form,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Request failed with ${res.status}`);
  }

  return res.json() as Promise<{ document: {
    document_id: string;
    deal_id: string;
    title: string;
    type: string;
    status: string;
    uploaded_at?: string;
  }, job_status: string }>;
}

export async function apiRetryDocument(dealId: string, documentId: string) {
  const res = await fetch(`${API_BASE_URL}/api/v1/deals/${dealId}/documents/${documentId}/retry`, {
    method: 'POST'
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Request failed with ${res.status}`);
  }
  return res.json();
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
        lastEventIdRef.current = data.updated_at ?? lastEventIdRef.current;
        handlers.onJobUpdated?.(data);
      } catch (err) {
        handlers.onError?.(err);
      }
    };

    source.addEventListener('ready', () => {
      hasConnected = true;
      handlers.onReady?.();
    });
    source.addEventListener('job.updated', handleJobUpdated);
    source.addEventListener('error', (event) => {
      // Gracefully handle CORS and connection errors
      // The frontend can continue without SSE if the backend doesn't support it
      if (source?.readyState === EventSource.CLOSED) {
        // Connection closed, app will continue with fallback
      }
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