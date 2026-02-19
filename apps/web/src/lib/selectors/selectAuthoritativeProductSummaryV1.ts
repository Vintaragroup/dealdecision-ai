export type AuthoritativeSummaryEvidenceRefV1 = {
  source_document_id: string;
  page_index: number;
  slide_title: string | null;
  snippet: string;
};

export type AuthoritativeProductSummarySelectionV1 = {
  value: string | null;
  confidence: number | null;
  sources: AuthoritativeSummaryEvidenceRefV1[];
  source: 'report.structured_summary.product_summary_v1' | 'missing';
};

const asNonEmptyString = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s.length > 0 ? s : null;
};

const asFiniteNumber = (v: unknown): number | null => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return v;
};

const normalizeEvidenceRefs = (sourcesRaw: unknown): AuthoritativeSummaryEvidenceRefV1[] => {
  if (!Array.isArray(sourcesRaw)) return [];
  const out: AuthoritativeSummaryEvidenceRefV1[] = [];
  const seen = new Set<string>();

  for (const v of sourcesRaw) {
    if (!v || typeof v !== 'object') continue;

    const source_document_id =
      typeof (v as any).source_document_id === 'string'
        ? String((v as any).source_document_id).trim()
        : typeof (v as any).document_id === 'string'
          ? String((v as any).document_id).trim()
          : '';

    const page_index_raw = (v as any).page_index;
    const page_index = typeof page_index_raw === 'number' && Number.isFinite(page_index_raw)
      ? Math.max(0, Math.floor(page_index_raw))
      : null;

    const slide_title = typeof (v as any).slide_title === 'string' ? String((v as any).slide_title).trim() : null;

    const snippet =
      typeof (v as any).snippet === 'string'
        ? String((v as any).snippet).trim()
        : typeof (v as any).note_snippet === 'string'
          ? String((v as any).note_snippet).trim()
          : '';

    if (!source_document_id || page_index == null) continue;

    const key = `${source_document_id}::${page_index}::${snippet.slice(0, 64).toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({ source_document_id, page_index, slide_title: slide_title && slide_title.length > 0 ? slide_title : null, snippet });
  }

  return out.slice(0, 12);
};

function reportLooksReady(report: unknown): boolean {
  if (!report || typeof report !== 'object') return false;
  const r: any = report as any;
  const structured = r?.structured_summary;
  const readyFlag = typeof r?.ready === 'boolean' ? (r.ready as boolean) : null;
  if (readyFlag === false) return false;
  if (readyFlag === true) return true;
  return Boolean(structured && typeof structured === 'object');
}

function reportReadyButMissingStructuredSummary(report: unknown): boolean {
  if (!report || typeof report !== 'object') return false;
  const r: any = report as any;
  if (r?.ready !== true) return false;
  const structured = r?.structured_summary;
  return !(structured && typeof structured === 'object');
}

export function selectAuthoritativeProductSummaryV1(report?: unknown | null): AuthoritativeProductSummarySelectionV1 {
  const r: any = report as any;
  const reportObj = r?.report && typeof r.report === 'object' ? (r.report as any) : r;

  if (reportReadyButMissingStructuredSummary(reportObj)) {
    return { value: null, confidence: null, sources: [], source: 'missing' };
  }

  if (!reportLooksReady(reportObj)) {
    return { value: null, confidence: null, sources: [], source: 'missing' };
  }

  const structured = reportObj?.structured_summary;
  const block = structured?.product_summary_v1;
  if (!block || typeof block !== 'object') {
    return { value: null, confidence: null, sources: [], source: 'missing' };
  }

  const value = asNonEmptyString(block?.value);
  const confidence = asFiniteNumber(block?.confidence);
  const sources = normalizeEvidenceRefs(block?.sources);

  return {
    value,
    confidence,
    sources,
    source: value ? 'report.structured_summary.product_summary_v1' : 'missing',
  };
}
