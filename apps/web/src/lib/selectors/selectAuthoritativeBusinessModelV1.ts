export type AuthoritativeBusinessModelSourceV1 =
  | 'arbitration'
  | 'report.business_model_summary'
  | 'report.business_model'
  | 'phase1.legacy'
  | 'missing';

export type AuthoritativeBusinessModelSelectionV1 = {
  value: string | null;
  label: string | null;
  confidence: number | null;
  is_arbitrated: boolean;
  source: AuthoritativeBusinessModelSourceV1;
};

const asNonEmptyString = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s.length > 0 ? s : null;
};

const clamp01 = (v: unknown): number | null => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return Math.max(0, Math.min(1, v));
};

function hasEvidenceSources(sources: unknown): boolean {
  if (!Array.isArray(sources) || sources.length === 0) return false;
  return sources.some((s) => {
    if (!s || typeof s !== 'object') return false;
    const docId = typeof (s as any).document_id === 'string'
      ? (s as any).document_id
      : typeof (s as any).source_document_id === 'string'
        ? (s as any).source_document_id
        : '';
    const page = (s as any).page_index;
    return Boolean(String(docId ?? '').trim()) && typeof page === 'number' && Number.isFinite(page);
  });
}

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

/**
 * Authoritative business model selector for UI/report consumers.
 *
 * Priority:
 * 1) Phase 1 arbitration (`phase1.business_model_arbitration_v1.business_model`)
 * 2) Legacy UI behavior (report structured_summary synthesized → promoted → Phase 1 legacy)
 */
export function selectAuthoritativeBusinessModelV1(params: {
  report?: unknown | null;
  phase1?: unknown | null;
}): AuthoritativeBusinessModelSelectionV1 {
  const phase1: any = params.phase1 as any;

  const arbitratedValue = asNonEmptyString(phase1?.business_model_arbitration_v1?.business_model);
  if (arbitratedValue) {
    return {
      value: arbitratedValue,
      label: 'Arbitrated',
      confidence: clamp01(phase1?.business_model_arbitration_v1?.confidence),
      is_arbitrated: true,
      source: 'arbitration',
    };
  }

  const report: any = params.report as any;

  // Preserve legacy behavior: if report claims to be ready but is missing structured_summary,
  // do NOT fall back to Phase 1 (fail-closed to null) unless arbitration is present (handled above).
  if (reportReadyButMissingStructuredSummary(report)) {
    return {
      value: null,
      label: null,
      confidence: null,
      is_arbitrated: false,
      source: 'missing',
    };
  }

  if (reportLooksReady(report)) {
    const structured = report?.structured_summary as any;
    const promoted = asNonEmptyString(structured?.business_model?.value);
    if (promoted && hasEvidenceSources(structured?.business_model?.sources)) {
      const label = asNonEmptyString(structured?.business_model?.label);
      return {
        value: promoted,
        label,
        confidence: clamp01(structured?.business_model?.confidence) ?? null,
        is_arbitrated: false,
        source: 'report.business_model',
      };
    }

    // Only use synthesized business model summary if it becomes evidence-backed (e.g. sources added).
    const synthesized = asNonEmptyString(structured?.business_model_summary?.value);
    if (synthesized && hasEvidenceSources(structured?.business_model_summary?.sources)) {
      return {
        value: synthesized,
        label: 'Synthesized',
        confidence: clamp01(structured?.business_model_summary?.confidence) ?? null,
        is_arbitrated: false,
        source: 'report.business_model_summary',
      };
    }
  }

  const legacy =
    asNonEmptyString(phase1?.business_model) ??
    asNonEmptyString(phase1?.deal_overview_v2?.business_model) ??
    asNonEmptyString(phase1?.executive_summary_v1?.business_model) ??
    null;

  return {
    value: legacy,
    label: null,
    confidence: null,
    is_arbitrated: false,
    source: legacy ? 'phase1.legacy' : 'missing',
  };
}
