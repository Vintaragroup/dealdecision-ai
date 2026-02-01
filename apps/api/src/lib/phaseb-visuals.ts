import type { QueryResult } from "../routes/deals";

export type PhaseBVisualsDbSummary = {
  source: "db_join_documents" | string;
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

type PoolLike = {
  query: <T = any>(sql: string, params?: unknown[]) => Promise<QueryResult<T>>;
};

async function hasTable(pool: PoolLike, table: string): Promise<boolean> {
  try {
    const { rows } = await pool.query<{ oid: string | null }>("SELECT to_regclass($1) as oid", [table]);
    return rows?.[0]?.oid !== null;
  } catch {
    return false;
  }
}

async function hasColumn(pool: PoolLike, table: string, column: string): Promise<boolean> {
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

export async function fetchPhaseBVisualsFromDb(pool: PoolLike, dealId: string): Promise<PhaseBVisualsDbSummary | null> {
  const tablesOk = (await hasTable(pool, "visual_assets")) && (await hasTable(pool, "documents"));
  if (!tablesOk) return null;

  const visualAssetsHasDealId = await hasColumn(pool, "visual_assets", "deal_id");
  const hasAssetType = await hasColumn(pool, "visual_assets", "asset_type");
  const hasQualityFlags = await hasColumn(pool, "visual_assets", "quality_flags");
  const hasVisualExtractions = await hasTable(pool, "visual_extractions");
  const visualExtractionsHaveText = hasVisualExtractions && (await hasColumn(pool, "visual_extractions", "ocr_text"));
  const hasEvidenceLinks = await hasTable(pool, "evidence_links");
  const evidenceLinksHaveDeal = hasEvidenceLinks && (await hasColumn(pool, "evidence_links", "deal_id"));
  const evidenceLinksHaveVisual = hasEvidenceLinks && (await hasColumn(pool, "evidence_links", "visual_asset_id"));

  const joinDocuments = visualAssetsHasDealId ? "" : "JOIN documents d ON d.id = va.document_id";
  const whereClause = visualAssetsHasDealId ? "WHERE va.deal_id = $1" : "WHERE d.deal_id = $1";

  const structuredParts: string[] = [];
  if (hasAssetType) structuredParts.push("va.asset_type IN ('table','chart')");
  if (hasQualityFlags) {
    structuredParts.push("COALESCE((va.quality_flags->>'table_detected')::boolean,false)");
    structuredParts.push("COALESCE((va.quality_flags->>'chart_detected')::boolean,false)");
  }
  const structuredCondition = structuredParts.length ? structuredParts.join(" OR ") : "false";

  const ocrQualityOk = hasQualityFlags
    ? "NOT COALESCE((va.quality_flags->>'pytesseract_missing')::boolean,false) AND NOT COALESCE((va.quality_flags->>'ocr_error')::boolean,false)"
    : "false";

  const ocrPresentExpr = visualExtractionsHaveText
    ? "(ve.ocr_text IS NOT NULL AND length(ve.ocr_text) > 0)"
    : ocrQualityOk;
  const ocrCharsExpr = visualExtractionsHaveText ? "COALESCE(length(ve.ocr_text),0)" : "0";

  const extractionJoin = hasVisualExtractions ? "LEFT JOIN visual_extractions ve ON ve.visual_asset_id = va.id" : "";

  let evidenceJoin = "";
  let evidenceCountExpr = "0::int";
  if (evidenceLinksHaveDeal) {
    evidenceJoin = "LEFT JOIN evidence_links el ON el.deal_id = $1";
    evidenceCountExpr = "SUM(CASE WHEN el.id IS NOT NULL THEN 1 ELSE 0 END)::int";
  } else if (evidenceLinksHaveVisual) {
    evidenceJoin = "LEFT JOIN evidence_links el ON el.visual_asset_id = va.id";
    evidenceCountExpr = "SUM(CASE WHEN el.id IS NOT NULL THEN 1 ELSE 0 END)::int";
  }

  const qualityCountsExpr = hasQualityFlags
    ? `SUM(CASE WHEN COALESCE((va.quality_flags->>'pytesseract_missing')::boolean,false) THEN 1 ELSE 0 END)::int AS pytesseract_missing_count,\n       SUM(CASE WHEN COALESCE((va.quality_flags->>'ocr_error')::boolean,false) THEN 1 ELSE 0 END)::int AS ocr_error_count`
    : "0::int AS pytesseract_missing_count, 0::int AS ocr_error_count";

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

  const notes: string[] = ["counts_source=db_join_documents"];
  if (!visualExtractionsHaveText) notes.push("ocr_text_not_stored");

  return {
    source: "db_join_documents",
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
