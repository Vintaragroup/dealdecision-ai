// Lightweight API client placeholders to satisfy type checking and test mocks.
// These should be replaced with real HTTP calls when backend wiring is added.
export type DealResponse = {
  dioVersionId?: string;
  dioStatus?: string;
  lastAnalyzedAt?: string | null;
};

export type AnalyzeResponse = {
  job_id: string;
  status: string;
};

export type JobResponse = {
  job_id: string;
  status: string;
  progress_pct?: number;
  message?: string;
  updated_at?: string;
};

export async function apiGetDeal(_dealId: string): Promise<DealResponse> {
  return { dioStatus: 'missing', lastAnalyzedAt: null };
}

export async function apiPostAnalyze(dealId: string): Promise<AnalyzeResponse> {
  return { job_id: `job-${dealId}`, status: 'queued' };
}

export async function apiGetJob(jobId: string): Promise<JobResponse> {
  return { job_id: jobId, status: 'queued', progress_pct: 0 };
}

export function isLiveBackend(): boolean {
  return false;
}
