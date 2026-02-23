import type { Pool } from "pg";
import { createHash } from "crypto";
import { sanitizeDeep, sanitizeText } from "@dealdecision/core";

type PoolLike = {
  query: <T = any>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
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

function deterministicUuidFromKey(key: string): string {
  const digest = createHash("sha256").update(key).digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  // Version 5 (name-based)
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  // Variant RFC 4122
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function normalizeSnippet(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s) return null;
  // Keep evidence rows compact; the UI only shows the first chunk anyway.
  return s.length > 2000 ? `${s.slice(0, 1997)}...` : s;
}

/**
 * Returns true when `value` contains any usable ref signal — either a non-empty
 * object (keyed citation) or a non-empty array (list of citation anchors).
 * A row with a valid ref is a concrete citation anchor and must be materialized
 * even when the OCR snippet is absent or confidence is 0 ("unset/not computed").
 */
function hasAnyRefSignal(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return (value as unknown[]).length > 0;
  return Object.keys(value as Record<string, unknown>).length > 0;
}

export async function materializePhaseBVisualEvidenceForDeal(
  pool: Pool,
  dealId: string,
  options?: {
    env?: NodeJS.ProcessEnv;
    limit?: number;
  }
): Promise<{
  ok: boolean;
  reason?: string;
  deleted?: number;
  materialized?: number;
  skipped?: number;
}> {
  const env = options?.env ?? process.env;
  if (env.DDAI_ENABLE_PHASEB_VISUAL_EVIDENCE !== "1") {
    return { ok: true, reason: "disabled" };
  }

  const [evidenceExists, evidenceLinksExists, documentsExists, evidenceItemsExists, visualExtractionsExists] = await Promise.all([
    hasTable(pool as unknown as PoolLike, "evidence"),
    hasTable(pool as unknown as PoolLike, "evidence_links"),
    hasTable(pool as unknown as PoolLike, "documents"),
    hasTable(pool as unknown as PoolLike, "evidence_items"),
    hasTable(pool as unknown as PoolLike, "visual_extractions"),
  ]);

  const tablesOk = evidenceExists && evidenceLinksExists && documentsExists;

  if (!tablesOk) {
    return { ok: true, reason: "missing_tables" };
  }

  const [hasEvidenceId, hasEvidenceEvidenceId] = await Promise.all([
    hasColumn(pool as unknown as PoolLike, "evidence", "id"),
    hasColumn(pool as unknown as PoolLike, "evidence", "evidence_id"),
  ]);

  const evidenceIdCol = hasEvidenceId ? "id" : hasEvidenceEvidenceId ? "evidence_id" : null;
  if (!evidenceIdCol) {
    return { ok: true, reason: "no_evidence_id_column" };
  }

  const [hasSource, hasKind, hasText, hasDealId, hasConfidence, hasDocumentId] = await Promise.all([
    hasColumn(pool as unknown as PoolLike, "evidence", "source"),
    hasColumn(pool as unknown as PoolLike, "evidence", "kind"),
    hasColumn(pool as unknown as PoolLike, "evidence", "text"),
    hasColumn(pool as unknown as PoolLike, "evidence", "deal_id"),
    hasColumn(pool as unknown as PoolLike, "evidence", "confidence"),
    hasColumn(pool as unknown as PoolLike, "evidence", "document_id"),
  ]);

  if (!hasSource || !hasKind || !hasText || !hasDealId) {
    return { ok: true, reason: "missing_required_evidence_columns" };
  }

  const [hasPage, hasPageNumber, hasExcerpt] = await Promise.all([
    hasColumn(pool as unknown as PoolLike, "evidence", "page"),
    hasColumn(pool as unknown as PoolLike, "evidence", "page_number"),
    hasColumn(pool as unknown as PoolLike, "evidence", "excerpt"),
  ]);

  const hasVisualAssetId = await hasColumn(pool as unknown as PoolLike, "evidence", "visual_asset_id");

  // Clear prior Phase B visual evidence for the deal so rows don't go stale
  // when evidence_links are removed or updated. Delete from both legacy `evidence`
  // and canonical `evidence_items`.
  const deleteRes = await pool.query(
    `DELETE FROM evidence WHERE deal_id = $1 AND source = 'phaseb_visual'`,
    [sanitizeText(dealId)]
  );
  const deleted = typeof (deleteRes as any)?.rowCount === "number" ? (deleteRes as any).rowCount : 0;

  if (evidenceItemsExists) {
    await pool.query(
      `DELETE FROM evidence_items WHERE deal_id = $1::uuid AND source_type = 'phaseb_visual'`,
      [sanitizeText(dealId)]
    );
  }

  type LinkRow = {
    document_id: string;
    page_index: number | null;
    evidence_type: string;
    visual_asset_id: string | null;
    ref: unknown;
    snippet: string | null;
    confidence: number | null;
    /** Populated via LEFT JOIN visual_extractions when the table exists. */
    ocr_text: string | null;
    ocr_confidence: number | null;
  };

  const limitFromEnv = (() => {
    const raw = env.DDAI_PHASEB_VISUAL_EVIDENCE_LIMIT;
    if (typeof raw !== "string" || !raw.trim()) return null;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  })();

  // Default to a small sample so Phase B evidence doesn't crowd out other sources
  // in the Evidence tab (which currently shows the latest 50 rows).
  const limit = options?.limit ?? limitFromEnv ?? 25;
  // Conditionally JOIN visual_extractions for OCR fallback when the table exists.
  // If the table is absent (e.g. older migration) the columns are projected as NULL
  // so all downstream logic degrades gracefully.
  const ocrSelectAndJoin = visualExtractionsExists
    ? {
        select: ",\n            ve.ocr_text,\n            ve.confidence AS ocr_confidence",
        join: "\n      LEFT JOIN visual_extractions ve ON ve.visual_asset_id = el.visual_asset_id",
      }
    : {
        select: ",\n            NULL::text AS ocr_text,\n            NULL::double precision AS ocr_confidence",
        join: "",
      };

  const { rows } = await pool.query<LinkRow>(
    `SELECT el.document_id,
            el.page_index,
            el.evidence_type,
            el.visual_asset_id,
            el.ref,
            el.snippet,
            el.confidence${ocrSelectAndJoin.select}
       FROM evidence_links el
       JOIN documents d ON d.id = el.document_id${ocrSelectAndJoin.join}
      WHERE d.deal_id = $1
      ORDER BY (el.snippet IS NOT NULL AND length(el.snippet) > 0) DESC,
               COALESCE(el.confidence, 0) DESC,
               el.document_id,
               el.page_index NULLS LAST
      LIMIT $2`,
    [sanitizeText(dealId), limit]
  );

  let materialized = 0;
  let skipped = 0;

  for (const row of rows ?? []) {
    const evidenceType = typeof row.evidence_type === "string" && row.evidence_type.trim().length > 0
      ? row.evidence_type.trim()
      : "visual";

    const snippet = normalizeSnippet(row.snippet);
    // OCR text from visual_extractions — acts as fallback when the evidence_link
    // has no snippet (common for OCR-heavy PDFs where el.snippet is null).
    // Require >= 40 chars to be considered "usable": shorter strings are typically
    // noise, stray labels, or the placeholder written by prior materialize runs.
    const MIN_USABLE_OCR_LENGTH = 40;
    const ocrRaw = normalizeSnippet(row.ocr_text);
    const ocr = ocrRaw && ocrRaw.length >= MIN_USABLE_OCR_LENGTH ? ocrRaw : null;
    const hasRefSignal = hasAnyRefSignal(row.ref);

    // Effective confidence = max(link confidence, OCR confidence, 0.5).
    const rawConf = typeof row.confidence === "number" && Number.isFinite(row.confidence) ? row.confidence : null;
    const ocrConf = typeof row.ocr_confidence === "number" && Number.isFinite(row.ocr_confidence) ? row.ocr_confidence : null;
    const confidence = Math.max(rawConf ?? 0, ocrConf ?? 0, 0.5);

    // "Real text" = snippet (any length) OR usable OCR (>= MIN_USABLE_OCR_LENGTH).
    // Used as content_text in evidence_items — placeholder strings must never reach
    // the governed overlay, as they are indistinguishable from no evidence.
    const realText: string | null = snippet ?? ocr;

    // Legacy evidence.text may use a short placeholder so the row remains a valid
    // citation anchor in the evidence tab. Rows with neither real text nor a ref
    // signal are always skipped (they have no evidence value).
    const text: string | null = realText ?? (hasRefSignal ? `${evidenceType} (no OCR snippet)` : null);

    if (!text) {
      skipped += 1;
      continue;
    }

    const pageIndex = typeof row.page_index === "number" && Number.isFinite(row.page_index) ? row.page_index : null;
    const pageNumber = pageIndex != null ? pageIndex + 1 : null;

    const idKey = `phaseb_visual|${dealId}|${row.document_id}|${pageIndex ?? ""}|${evidenceType}|${row.visual_asset_id ?? ""}`;
    const id = deterministicUuidFromKey(idKey);

    const cols: string[] = [evidenceIdCol, "deal_id"];
    const values: unknown[] = [id, sanitizeText(dealId)];

    if (hasDocumentId) {
      cols.push("document_id");
      values.push(sanitizeText(row.document_id));
    }

    cols.push("source", "kind", "text");
    values.push("phaseb_visual", sanitizeText(evidenceType), sanitizeText(text));

    if (hasConfidence) {
      cols.push("confidence");
      values.push(confidence);
    }

    if (hasExcerpt) {
      cols.push("excerpt");
      values.push(sanitizeText(text.length > 500 ? `${text.slice(0, 497)}...` : text));
    }

    if (hasPageNumber) {
      cols.push("page_number");
      values.push(pageNumber);
    } else if (hasPage) {
      cols.push("page");
      values.push(pageNumber);
    }

    if (hasVisualAssetId) {
      cols.push("visual_asset_id");
      values.push(row.visual_asset_id ? sanitizeText(row.visual_asset_id) : null);
    }

    const placeholders = cols.map((_, idx) => `$${idx + 1}`).join(", ");

    // Use an upsert even though we delete above, to be safe if multiple jobs run.
    const updateAssignments = cols
      .filter((c) => c !== evidenceIdCol)
      .map((c) => `${c} = EXCLUDED.${c}`)
      .join(", ");

    await pool.query(
      `INSERT INTO evidence (${cols.join(", ")})
       VALUES (${placeholders})
       ON CONFLICT (${evidenceIdCol}) DO UPDATE SET ${updateAssignments}`,
      values.map((v) => (typeof v === "object" && v !== null && !(v instanceof Date) ? JSON.stringify(sanitizeDeep(v)) : v))
    );

    // ── Canonical evidence_items upsert ──────────────────────────────────────
    // Only written when realText exists — placeholder strings must not reach the
    // governed-LLM citation catalog, which would treat them as no_evidence anyway.
    if (evidenceItemsExists && realText) {
      // source_path uses 1-based page number so the citation-catalog page parser
      // (regex /\bpage:(\d+)\b/) returns a sensible slide/page number.
      const sourcePath = `doc:${sanitizeText(row.document_id)}:page:${pageNumber ?? 0}:type:${evidenceType}:asset:${row.visual_asset_id ?? ""}`;
      const contentJsonObj = sanitizeDeep({
        ref: row.ref ?? null,
        page_index: row.page_index ?? null,
        evidence_type: row.evidence_type,
      });
      const metaObj = { materializer: "phaseb", source_table: "evidence_links" };
      const tags = ["signal:phaseb_visual", `evidence_type:${evidenceType.replace(/[^\w.-]/g, "_")}`];

      await pool.query(
        `INSERT INTO evidence_items (
           evidence_id,
           deal_id,
           source_type,
           source_path,
           source_document_id,
           source_visual_asset_id,
           tags,
           confidence,
           extracted_at,
           content_text,
           content_json,
           meta
         )
         VALUES ($1, $2::uuid, $3, $4, $5::uuid, $6::uuid, $7::text[], $8, now(), $9, $10::jsonb, $11::jsonb)
         ON CONFLICT (evidence_id) DO UPDATE SET
           content_text = EXCLUDED.content_text,
           content_json = EXCLUDED.content_json,
           confidence = EXCLUDED.confidence,
           tags = EXCLUDED.tags,
           updated_at = now()`,
        [
          id,
          sanitizeText(dealId),
          "phaseb_visual",
          sourcePath,
          sanitizeText(row.document_id),
          row.visual_asset_id ? sanitizeText(row.visual_asset_id) : null,
          tags,
          confidence,
          sanitizeText(realText),
          JSON.stringify(contentJsonObj),
          JSON.stringify(metaObj),
        ]
      );
    }

    materialized += 1;
  }

  return { ok: true, deleted, materialized, skipped };
}
