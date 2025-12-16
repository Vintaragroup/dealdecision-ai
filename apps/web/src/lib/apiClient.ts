import type { Deal } from '@dealdecision/contracts';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:9000';
const BACKEND_MODE = (import.meta.env.VITE_BACKEND_MODE || 'mock').toLowerCase();

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
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
    status: string;
    progress_pct?: number;
    message?: string;
    updated_at?: string;
  }>(`/api/v1/jobs/${jobId}`);
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