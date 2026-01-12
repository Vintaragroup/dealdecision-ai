import type { Deal, WorkspaceChatResponse, DealChatResponse, JobProgressEventV1, JobStatusDetail } from '@dealdecision/contracts';

import { debugApiInferDealId, debugApiIsEnabled, debugApiLogCall, debugApiLogSse } from './debugApi';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:9000';
const BACKEND_MODE = (import.meta.env.VITE_BACKEND_MODE || 'mock').toLowerCase();

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

export function apiPostExtractVisuals(dealId: string) {
	return request<{ job_id: string; status: string }>(`/api/v1/deals/${dealId}/extract-visuals`, {
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
    created_at?: string;
    started_at?: string | null;
    status_detail?: JobStatusDetail | null;
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
};

export function apiGetDealLineage(dealId: string) {
  return request<DealLineageResponse>(`/api/v1/deals/${dealId}/lineage`);
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
  asset_type?: string | null;
  bbox?: unknown;
  image_uri?: string | null;
  image_hash?: string | null;
  confidence?: number | null;
  extractor_version?: string | null;
  created_at?: string | null;
  ocr_text?: string | null;
  structured_json?: unknown;
  structured_kind?: string | null;
  structured_summary?: unknown;
  quality_flags?: unknown;
  evidence?: VisualAssetEvidenceSummary;
  document_title?: string | null;
  document_type?: string | null;
  document_status?: string | null;
  document_page_count?: number | null;
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
  const ocr_text = typeof structured?.ocr_text === 'string' ? structured.ocr_text : typeof raw.ocr_text === 'string' ? raw.ocr_text : null;
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

  return {
    visual_asset_id,
    document_id: docId,
    deal_id: raw.deal_id ?? dealId,
    page_index: Number.isFinite(raw.page_index) ? Number(raw.page_index) : null,
    asset_type: raw.asset_type ?? raw.type ?? null,
    bbox: raw.bbox,
    image_uri: raw.image_uri ?? raw.image_url ?? null,
    image_hash: raw.image_hash ?? null,
    extractor_version: raw.extractor_version ?? null,
    created_at: raw.created_at ?? null,
    confidence: parsedConfidence,
    quality_flags: raw.quality_flags ?? raw.flags ?? null,
    ocr_text,
    structured_json,
    structured_kind,
    structured_summary,
    evidence: evidence_count != null || sample_snippets ? { count: evidence_count, evidence_count, sample_snippets } : raw.evidence,
    document_title: docTitle,
    document_type: docType,
    document_status: docStatus,
    document_page_count: docPageCount,
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

export async function apiGetDocumentVisualAssets(dealId: string, documentId: string) {
  const res = await request<{ deal_id: string; document_id: string; assets?: any[]; visual_assets?: any[]; warnings?: string[] }>(
    `/api/v1/deals/${dealId}/documents/${documentId}/visual-assets`
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

export async function apiGetDealVisualAssets(dealId: string) {
  const res = await request<{ deal_id: string; visual_assets?: any[] }>(`/api/v1/deals/${dealId}/visual-assets`);
  const visual_assets = normalizeVisualAssetsResponse(Array.isArray(res?.visual_assets) ? res.visual_assets : [], dealId);
  return { deal_id: res?.deal_id ?? dealId, visual_assets };
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

export async function apiGetDealReport(dealId: string): Promise<DealReport | null> {
  const path = `/api/v1/deals/${dealId}/report`;
  const debugEnabled = debugApiIsEnabled();
  const startedAt = typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
  let res: Response | undefined;
  let responseJson: unknown = undefined;
  let error: unknown = undefined;

  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method: 'GET',
    });
    if (res.status === 404) {
      return null;
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `Request failed with ${res.status}`);
    }
    responseJson = await res.json();
    return responseJson as DealReport;
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
  if (typeof EventSource === 'undefined') {
    return () => {};
  }

  const lastEventIdRef = { current: options?.cursor } as { current: string | undefined };
  let source: EventSource | null = null;
  let stopped = false;
  let retryDelay = 1000;

  const cleanupSource = () => {
    if (source) {
      try {
        source.close();
      } catch {
        // ignore
      }
      source = null;
    }
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

  const connect = () => {
    if (stopped) return;

    const params = new URLSearchParams({ deal_id: dealId });
    if (lastEventIdRef.current) {
      params.set('cursor', lastEventIdRef.current);
    }
    const url = `${API_BASE_URL}/api/v1/events?${params.toString()}`;

    try {
      source = new EventSource(url);

      const handleJobEvent = (eventName: string) => (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data);
          const normalized = normalizeJobPayload(data, eventName);
          const lastId = (event as any)?.lastEventId || normalized.updated_at;
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

      source.addEventListener('open', () => {
        retryDelay = 1000;
      });

      source.addEventListener('ready', () => {
        retryDelay = 1000;
        if (debugApiIsEnabled()) debugApiLogSse({ event: 'ready', dealId });
        handlers.onReady?.();
      });
      source.addEventListener('job.updated', handleJobEvent('job.updated'));
      source.addEventListener('job.progress', handleJobEvent('job.progress'));
      source.addEventListener('error', (event) => {
        if (debugApiIsEnabled()) debugApiLogSse({ event: 'error', dealId, error: event });
        handlers.onError?.(event);
        cleanupSource();
        if (stopped) return;
        const delay = retryDelay;
        retryDelay = Math.min(10000, retryDelay * 2);
        setTimeout(connect, delay);
      });
    } catch (err) {
      if (debugApiIsEnabled()) debugApiLogSse({ event: 'init_error', dealId, error: err });
      handlers.onError?.(err);
      if (stopped) return;
      const delay = retryDelay;
      retryDelay = Math.min(10000, retryDelay * 2);
      setTimeout(connect, delay);
    }
  };

  connect();

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