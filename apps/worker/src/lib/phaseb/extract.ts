import { PhaseBFeatures, PhaseBFeatureSegment, PhaseBFeaturesV1 } from './types';
import type { Pool } from 'pg';

type DealLineageResponse = {
  nodes?: any[];
  edges?: any[];
};

export type PhaseBVisualsDbSummary = {
  source: 'db_join_documents' | string;
  visuals_count: number;
  visuals_with_structured: number;
  visuals_with_ocr: number;
  ocr_chars_total: number;
  evidence_count: number;
  ocr_text_available: boolean;
  ocr_quality_counts?: {
    pytesseract_missing: number;
    ocr_error: number;
  };
  notes?: string[];
};

async function hasTable(pool: Pool, table: string): Promise<boolean> {
  try {
    const { rows } = await pool.query<{ oid: string | null }>('SELECT to_regclass($1) as oid', [table]);
    return rows?.[0]?.oid !== null;
  } catch {
    return false;
  }
}

async function hasColumn(pool: Pool, table: string, column: string): Promise<boolean> {
  try {
    const { rows } = await pool.query<{ ok: number }>(
      `SELECT 1 as ok FROM information_schema.columns WHERE table_name = $1 AND column_name = $2 LIMIT 1`,
      [table, column]
    );
    return Array.isArray(rows) && rows.length > 0;
  } catch {
    return false;
  }
}

export async function fetchPhaseBVisualsFromDb(pool: Pool, dealId: string): Promise<PhaseBVisualsDbSummary | null> {
  const tablesOk = (await hasTable(pool, 'visual_assets')) && (await hasTable(pool, 'documents'));
  if (!tablesOk) return null;

  const visualAssetsHasDealId = await hasColumn(pool, 'visual_assets', 'deal_id');
  const hasAssetType = await hasColumn(pool, 'visual_assets', 'asset_type');
  const hasQualityFlags = await hasColumn(pool, 'visual_assets', 'quality_flags');
  const hasVisualExtractions = await hasTable(pool, 'visual_extractions');
  const visualExtractionsHaveText = hasVisualExtractions && (await hasColumn(pool, 'visual_extractions', 'ocr_text'));
  const hasEvidenceLinks = await hasTable(pool, 'evidence_links');
  const evidenceLinksHaveDeal = hasEvidenceLinks && (await hasColumn(pool, 'evidence_links', 'deal_id'));
  const evidenceLinksHaveVisual = hasEvidenceLinks && (await hasColumn(pool, 'evidence_links', 'visual_asset_id'));

  const joinDocuments = visualAssetsHasDealId ? '' : 'JOIN documents d ON d.id = va.document_id';
  const whereClause = visualAssetsHasDealId ? 'WHERE va.deal_id = $1' : 'WHERE d.deal_id = $1';

  const structuredParts: string[] = [];
  if (hasAssetType) structuredParts.push("va.asset_type IN ('table','chart')");
  if (hasQualityFlags) {
    structuredParts.push("COALESCE((va.quality_flags->>'table_detected')::boolean,false)");
    structuredParts.push("COALESCE((va.quality_flags->>'chart_detected')::boolean,false)");
  }
  const structuredCondition = structuredParts.length ? structuredParts.join(' OR ') : 'false';

  const ocrQualityOk = hasQualityFlags
    ? "NOT COALESCE((va.quality_flags->>'pytesseract_missing')::boolean,false) AND NOT COALESCE((va.quality_flags->>'ocr_error')::boolean,false)"
    : 'false';

  const ocrPresentExpr = visualExtractionsHaveText
    ? '(ve.ocr_text IS NOT NULL AND length(ve.ocr_text) > 0)'
    : ocrQualityOk;
  const ocrCharsExpr = visualExtractionsHaveText ? 'COALESCE(length(ve.ocr_text),0)' : '0';

  const extractionJoin = hasVisualExtractions ? 'LEFT JOIN visual_extractions ve ON ve.visual_asset_id = va.id' : '';

  let evidenceJoin = '';
  let evidenceCountExpr = '0::int';
  if (evidenceLinksHaveDeal) {
    evidenceJoin = 'LEFT JOIN evidence_links el ON el.deal_id = $1';
    evidenceCountExpr = 'SUM(CASE WHEN el.id IS NOT NULL THEN 1 ELSE 0 END)::int';
  } else if (evidenceLinksHaveVisual) {
    evidenceJoin = 'LEFT JOIN evidence_links el ON el.visual_asset_id = va.id';
    evidenceCountExpr = 'SUM(CASE WHEN el.id IS NOT NULL THEN 1 ELSE 0 END)::int';
  }

  const qualityCountsExpr = hasQualityFlags
    ? `SUM(CASE WHEN COALESCE((va.quality_flags->>'pytesseract_missing')::boolean,false) THEN 1 ELSE 0 END)::int AS pytesseract_missing_count,\n       SUM(CASE WHEN COALESCE((va.quality_flags->>'ocr_error')::boolean,false) THEN 1 ELSE 0 END)::int AS ocr_error_count`
    : '0::int AS pytesseract_missing_count, 0::int AS ocr_error_count';

  const query = `SELECT
    COUNT(*)::int AS visuals_count,
    SUM(CASE WHEN ${structuredCondition} THEN 1 ELSE 0 END)::int AS visuals_with_structured,
    SUM(CASE WHEN ${ocrPresentExpr} THEN 1 ELSE 0 END)::int AS visuals_with_ocr,
    SUM(${ocrCharsExpr})::int AS ocr_chars_total,
    ${evidenceCountExpr} AS evidence_count,
    ${qualityCountsExpr}
  FROM visual_assets va
  ${joinDocuments}
  ${extractionJoin}
  ${evidenceJoin}
  ${whereClause}`;

  const { rows } = await pool.query<{
    visuals_count: number;
    visuals_with_structured: number;
    visuals_with_ocr: number;
    ocr_chars_total: number;
    evidence_count: number;
    pytesseract_missing_count: number;
    ocr_error_count: number;
  }>(query, [dealId]);

  const row = rows?.[0];
  if (!row) return null;

  const notes: string[] = ['counts_source=db_join_documents'];
  if (!visualExtractionsHaveText) notes.push('ocr_text_not_stored');

  return {
    source: 'db_join_documents',
    visuals_count: Number(row.visuals_count ?? 0),
    visuals_with_structured: Number(row.visuals_with_structured ?? 0),
    visuals_with_ocr: Number(row.visuals_with_ocr ?? 0),
    ocr_chars_total: Number(row.ocr_chars_total ?? 0),
    evidence_count: Number(row.evidence_count ?? 0),
    ocr_text_available: visualExtractionsHaveText,
    ocr_quality_counts: {
      pytesseract_missing: Number(row.pytesseract_missing_count ?? 0),
      ocr_error: Number(row.ocr_error_count ?? 0),
    },
    notes,
  };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function safeDivide(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return 0;
  return numerator / denominator;
}

function extractSectionKeys(phase1: any): string[] {
  if (!phase1 || typeof phase1 !== 'object') return [];
  const sources = [phase1.phase1_deal_overview_v2, phase1.coverage, phase1.decision_summary_v1];
  for (const src of sources) {
    const sections = (src as any)?.sections;
    if (sections && typeof sections === 'object') {
      const keys = Object.keys(sections).filter((k) => typeof k === 'string' && k.trim().length > 0);
      if (keys.length > 0) return keys;
    }
  }
  return [];
}

export function extractPhaseBFeaturesV1(args: {
  dealId: string;
  lineage?: DealLineageResponse | null;
  phase1?: any;
  docs?: any[];
  visualsFromDb?: PhaseBVisualsDbSummary | null;
}): PhaseBFeaturesV1 {
  const nowIso = new Date().toISOString();
  const lineage = args.lineage ?? null;
  const phase1 = args.phase1 ?? null;
  const docs = Array.isArray(args.docs) ? args.docs : [];
  const visualsFromDb = args.visualsFromDb ?? null;

  let documentsCount = 0;
  let segmentsCount = 0;
  let visualsCount = visualsFromDb ? visualsFromDb.visuals_count : 0;
  let evidenceCount = visualsFromDb ? visualsFromDb.evidence_count : 0;
  let visualsWithOcr = visualsFromDb ? visualsFromDb.visuals_with_ocr : 0;
  let visualsWithStructured = visualsFromDb ? visualsFromDb.visuals_with_structured : 0;
  let ocrCharsTotal = visualsFromDb ? visualsFromDb.ocr_chars_total : 0;

  const nodes = Array.isArray(lineage?.nodes) ? lineage!.nodes : [];

  if (nodes.length > 0 && !visualsFromDb) {
    for (const node of nodes) {
      const type = String((node as any)?.node_type ?? (node as any)?.kind ?? '').toLowerCase();
      const data = (node as any)?.data ?? node;

      if (type.includes('document')) documentsCount += 1;
      if (type.includes('segment') || type === 'page') segmentsCount += 1;

      const looksVisual = type.includes('visual') || data?.ocr_text || data?.ocr_snippet || data?.structured_json || data?.structured_kind;
      if (looksVisual) {
        visualsCount += 1;
        const ocrText = (data as any)?.ocr_text ?? (data as any)?.ocr_snippet ?? (data as any)?.text ?? null;
        const ocrLen = typeof ocrText === 'string' ? ocrText.length : 0;
        if (ocrLen > 0) {
          visualsWithOcr += 1;
          ocrCharsTotal += ocrLen;
        }
        const hasStructured = Boolean((data as any)?.structured_json) || Boolean((data as any)?.structured_kind) || Boolean((data as any)?.structured_summary);
        if (hasStructured) visualsWithStructured += 1;
      }

      if (type.includes('evidence')) evidenceCount += 1;
    }
  }

  // Fallbacks when lineage is absent or sparse.
  if (documentsCount === 0 && docs.length > 0) {
    documentsCount = docs.length;
  }

  if (segmentsCount === 0) {
    const keys = extractSectionKeys(phase1);
    segmentsCount = keys.length;
  }

  if (evidenceCount === 0) {
    const claims = Array.isArray(phase1?.claims) ? phase1.claims : Array.isArray(phase1?.phase1_claims) ? phase1.phase1_claims : [];
    evidenceCount = claims.length;
  }

  // visuals fallback remains zero unless lineage provided (no reliable source elsewhere).

  const evidencePerVisual = evidenceCount / Math.max(visualsCount, 1);
  const pctVisualsWithOcr = clamp01(safeDivide(visualsWithOcr, Math.max(visualsCount, 1)));
  const pctVisualsWithStructured = clamp01(safeDivide(visualsWithStructured, Math.max(visualsCount, 1)));

  const pctSegmentsWithVisuals = segmentsCount > 0 ? clamp01(safeDivide(visualsCount, segmentsCount)) : 0;
  const pctDocumentsWithSegments = documentsCount > 0 ? clamp01(safeDivide(segmentsCount, documentsCount)) : 0;
  const pctDocumentsWithVisuals = documentsCount > 0 ? clamp01(safeDivide(visualsCount, documentsCount)) : 0;

  const avgOcrCharsPerVisual = visualsCount > 0 ? ocrCharsTotal / visualsCount : 0;

  const flags = {
    no_visuals: visualsCount === 0,
    low_evidence: evidenceCount < 3,
    low_coverage: documentsCount < 1 || segmentsCount < 3,
  };

  const notes: string[] = [];
  if (visualsFromDb?.source) notes.push(`source=${visualsFromDb.source}`);
  if (visualsFromDb?.notes) notes.push(...visualsFromDb.notes);
  if (!visualsFromDb && flags.no_visuals) notes.push('No visual assets detected');
  if (flags.low_evidence) notes.push('Evidence count is low');
  if (flags.low_coverage) notes.push('Low segment coverage');

  return {
    schema_version: 1,
    computed_at: nowIso,
    deal_id: args.dealId,
    coverage: {
      documents_count: documentsCount,
      segments_count: segmentsCount,
      visuals_count: visualsCount,
      evidence_count: evidenceCount,
      evidence_per_visual: evidencePerVisual,
    },
    content_density: {
      avg_ocr_chars_per_visual: avgOcrCharsPerVisual,
      pct_visuals_with_ocr: pctVisualsWithOcr,
      pct_visuals_with_structured: pctVisualsWithStructured,
    },
    structure: {
      pct_segments_with_visuals: pctSegmentsWithVisuals,
      pct_documents_with_segments: pctDocumentsWithSegments,
      pct_documents_with_visuals: pctDocumentsWithVisuals,
    },
    flags,
    notes: notes.slice(0, 10),
  };
}

export type ExtractPhaseBArgs = {
  dealId: string;
  documentsForAnalyzers: Array<any>;
  phase1_deal_overview_v2?: any | null;
  currentPhase1?: any | null; // may include decision_summary_v1, executive_summary_v2, coverage, claims, etc.
};

function toSegmentsFromCoverage(coverageSource: any): string[] {
  if (!coverageSource || typeof coverageSource !== 'object') return [];
  const sections = (coverageSource as any).sections ?? coverageSource;
  if (!sections || typeof sections !== 'object') return [];
  return Object.keys(sections).filter((k) => typeof k === 'string' && k.trim().length > 0);
}

function humanize(label: string): string {
  const s = label.replace(/_/g, ' ').trim();
  return s.length ? s[0].toUpperCase() + s.slice(1) : label;
}

export function extractPhaseBFeatures(args: ExtractPhaseBArgs): PhaseBFeatures {
  const { documentsForAnalyzers, phase1_deal_overview_v2, currentPhase1 } = args;

  const docCount = Array.isArray(documentsForAnalyzers) ? documentsForAnalyzers.length : 0;
  const documentIds = Array.isArray(documentsForAnalyzers)
    ? documentsForAnalyzers.map((d) => String((d as any)?.document_id ?? (d as any)?.id ?? '')).filter(Boolean)
    : [];

  // Prefer coverage map on overview_v2 if present; fall back to currentPhase1 coverage/decision_summary_v1 if available.
  const coverageCandidates = [phase1_deal_overview_v2, (currentPhase1 as any)?.coverage, (currentPhase1 as any)?.decision_summary_v1];
  const sectionKeys: string[] = [];
  for (const c of coverageCandidates) {
    const keys = toSegmentsFromCoverage(c);
    if (keys.length > 0) {
      sectionKeys.push(...keys);
      break;
    }
  }
  const uniqueSectionKeys = Array.from(new Set(sectionKeys));

  const evidenceCount = Array.isArray((currentPhase1 as any)?.claims)
    ? (currentPhase1 as any).claims.length
    : 0;
  const visualCount = 0; // Phase 1 does not expose visual aggregates; keep deterministic.

  // Average document confidence if verification_result carries an overall_score (0-1).
  const confidences: number[] = [];
  for (const d of Array.isArray(documentsForAnalyzers) ? documentsForAnalyzers : []) {
    const vr = (d as any)?.verification_result;
    const score = typeof vr?.overall_score === 'number' && Number.isFinite(vr.overall_score) ? vr.overall_score : null;
    if (score != null) confidences.push(score);
  }
  const avgDocConfidence = confidences.length ? confidences.reduce((a, b) => a + b, 0) / confidences.length : null;

  const segments: PhaseBFeatureSegment[] = uniqueSectionKeys.map((key) => ({
    segment_key: key,
    segment_label: humanize(key),
    document_ids: documentIds,
    visual_count: visualCount,
    evidence_count: evidenceCount,
  }));

  return {
    total_documents: docCount,
    total_visuals: visualCount,
    total_evidence: evidenceCount,
    avg_doc_confidence: avgDocConfidence,
    segments,
    aggregates: {
      documents: docCount,
      evidence: evidenceCount,
    },
  };
}
