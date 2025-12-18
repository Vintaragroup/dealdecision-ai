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
  return request<Deal & {
    dioVersionId?: string;
    dioStatus?: string;
    lastAnalyzedAt?: string;
  }>(`/api/v1/deals/${dealId}`);
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

export function apiGetEvidence(dealId: string) {
  return request<{ evidence: Array<{
    evidence_id: string;
    deal_id: string;
    document_id?: string;
    source: string;
    kind: string;
    text: string;
    excerpt?: string;
    created_at?: string;
  }> }>(`/api/v1/deals/${dealId}/evidence`);
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