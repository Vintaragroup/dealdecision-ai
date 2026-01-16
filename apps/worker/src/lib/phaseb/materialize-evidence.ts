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

function coerceJsonObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
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

  const tablesOk = (await hasTable(pool as unknown as PoolLike, "evidence")) &&
    (await hasTable(pool as unknown as PoolLike, "evidence_links")) &&
    (await hasTable(pool as unknown as PoolLike, "documents"));

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

  // Clear prior Phase B visual evidence for the deal so evidence doesn't go stale
  // when evidence_links are removed or updated.
  const deleteRes = await pool.query(
    `DELETE FROM evidence WHERE deal_id = $1 AND source = 'phaseb_visual'`,
    [sanitizeText(dealId)]
  );
  const deleted = typeof (deleteRes as any)?.rowCount === "number" ? (deleteRes as any).rowCount : 0;

  type LinkRow = {
    document_id: string;
    page_index: number | null;
    evidence_type: string;
    visual_asset_id: string | null;
    ref: unknown;
    snippet: string | null;
    confidence: number | null;
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
  const { rows } = await pool.query<LinkRow>(
    `SELECT el.document_id,
            el.page_index,
            el.evidence_type,
            el.visual_asset_id,
            el.ref,
            el.snippet,
            el.confidence
       FROM evidence_links el
       JOIN documents d ON d.id = el.document_id
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
    const refObj = coerceJsonObject(row.ref) ?? {};

    const hasRefSignal = Object.keys(refObj).length > 0;
    const confidence = typeof row.confidence === "number" && Number.isFinite(row.confidence) ? row.confidence : 0.5;
    if (!snippet && !hasRefSignal) {
      skipped += 1;
      continue;
    }

    // Avoid flooding the evidence list with low-signal items that have neither OCR snippet
    // nor strong model confidence.
    if (!snippet && confidence < 0.55) {
      skipped += 1;
      continue;
    }

    const pageIndex = typeof row.page_index === "number" && Number.isFinite(row.page_index) ? row.page_index : null;
    const pageNumber = pageIndex != null ? pageIndex + 1 : null;

    const text = snippet ?? `${evidenceType} (no OCR snippet)`;

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

    materialized += 1;
  }

  return { ok: true, deleted, materialized, skipped };
}
