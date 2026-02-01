import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getPool } from "../lib/db";
import { enqueueJob } from "../services/jobs";

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

async function getColumnDataType(pool: PoolLike, table: string, column: string): Promise<string | null> {
  try {
    const { rows } = await pool.query<{ data_type: string }>(
      `SELECT data_type
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = $1
          AND column_name = $2
        LIMIT 1`,
      [table, column]
    );
    return rows?.[0]?.data_type ?? null;
  } catch {
    return null;
  }
}

function isUuid(value: string): boolean {
  return z.string().uuid().safeParse(value).success;
}

const fetchSchema = z.object({
  deal_id: z.string().min(1),
  filter: z.string().optional(),
});

const resolveSchema = z.object({
  ids: z.string().min(1),
});

const dealIdSchema = z.string().min(1);

export async function registerEvidenceRoutes(app: FastifyInstance, pool = getPool(), enqueue = enqueueJob) {
  app.post("/api/v1/evidence/fetch", async (request, reply) => {
    const parsed = fetchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid input", details: parsed.error.flatten() });
    }

    const { deal_id, filter } = parsed.data;
    const { rows: deals } = await pool.query(`SELECT id FROM deals WHERE id = $1 AND deleted_at IS NULL`, [deal_id]);
    if (deals.length === 0) {
      return reply.status(404).send({ error: "Deal not found" });
    }

    try {
      const job = await enqueue({ deal_id, type: "fetch_evidence", payload: filter ? { filter } : {} });
      return reply.status(202).send({ job_id: job.job_id, status: job.status });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to queue evidence job";
      return reply.status(500).send({ error: message });
    }
  });

  // Resolve evidence IDs to citations for UI trace mode.
  // Accepts comma-separated IDs: /api/v1/evidence/resolve?ids=a,b,c
  app.get("/api/v1/evidence/resolve", async (request, reply) => {
    const parsed = resolveSchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid input", details: parsed.error.flatten() });
    }

    const ids = parsed.data.ids
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    const uniqueIds = Array.from(new Set(ids)).slice(0, 100);
    if (uniqueIds.length === 0) {
      return reply.status(400).send({ error: "No ids provided" });
    }

    const evidenceTableExists = await hasTable(pool as unknown as PoolLike, "evidence");
    if (!evidenceTableExists) {
      return reply.status(200).send({ results: uniqueIds.map((id) => ({ id, ok: false })) });
    }

    const [hasId, hasEvidenceId] = await Promise.all([
      hasColumn(pool as unknown as PoolLike, "evidence", "id"),
      hasColumn(pool as unknown as PoolLike, "evidence", "evidence_id"),
    ]);

    const evidenceIdColumn = hasId ? "id" : hasEvidenceId ? "evidence_id" : "id";
    const evidenceIdType = await getColumnDataType(pool as unknown as PoolLike, "evidence", evidenceIdColumn);

    const [hasDocumentId, hasPage, hasPageNumber, hasText, hasExcerpt] = await Promise.all([
      hasColumn(pool as unknown as PoolLike, "evidence", "document_id"),
      hasColumn(pool as unknown as PoolLike, "evidence", "page"),
      hasColumn(pool as unknown as PoolLike, "evidence", "page_number"),
      hasColumn(pool as unknown as PoolLike, "evidence", "text"),
      hasColumn(pool as unknown as PoolLike, "evidence", "excerpt"),
    ]);

    const documentsTableExists = await hasTable(pool as unknown as PoolLike, "documents");
    const hasDocumentTitle = documentsTableExists
      ? await hasColumn(pool as unknown as PoolLike, "documents", "title")
      : false;

    const evidenceDocumentIdType = hasDocumentId
      ? await getColumnDataType(pool as unknown as PoolLike, "evidence", "document_id")
      : null;
    const documentsIdType = documentsTableExists
      ? await getColumnDataType(pool as unknown as PoolLike, "documents", "id")
      : null;

    const evidenceIdExpr = `e.${evidenceIdColumn}`;
    const documentIdExpr = hasDocumentId ? "e.document_id" : "NULL::text AS document_id";
    const pageExpr = hasPage ? "e.page" : hasPageNumber ? "e.page_number" : "NULL::int AS page";
    const snippetExpr = hasExcerpt
      ? "e.excerpt"
      : hasText
        ? "e.text"
        : "NULL::text AS snippet";
    const documentTitleExpr = documentsTableExists && hasDocumentTitle ? "d.title" : "NULL::text AS document_title";

    const joinDocuments = (() => {
      if (!(documentsTableExists && hasDocumentId)) return "";
      if (documentsIdType === "uuid" || evidenceDocumentIdType === "uuid") {
        // Avoid uuid=text mismatches by joining on text representations.
        return "LEFT JOIN documents d ON d.id::text = e.document_id::text";
      }
      return "LEFT JOIN documents d ON d.id = e.document_id";
    })();

    type Row = {
      id: string;
      document_id: string | null;
      page: number | null;
      snippet: string | null;
      document_title: string | null;
    };

    const useUuidIds = evidenceIdType === "uuid";
    const queryIds = useUuidIds ? uniqueIds.filter(isUuid) : uniqueIds;

    if (queryIds.length === 0) {
      return reply.status(200).send({ results: uniqueIds.map((id) => ({ id, ok: false })) });
    }

    const { rows } = await pool.query<Row>(
      `SELECT ${evidenceIdExpr} as id,
              ${documentIdExpr},
              ${pageExpr},
              ${snippetExpr} as snippet,
              ${documentTitleExpr}
         FROM evidence e
         ${joinDocuments}
        WHERE ${evidenceIdExpr} = ANY($1::${useUuidIds ? "uuid" : "text"}[])`,
      [queryIds]
    );

    const byId = new Map<string, Row>();
    for (const row of rows ?? []) {
      if (row?.id) byId.set(row.id, row);
    }

    const results = uniqueIds.map((id) => {
      const row = byId.get(id);
      if (!row) return { id, ok: false };

      const document_id = row.document_id ?? undefined;
      const document_title = row.document_title ?? undefined;
      const page = typeof row.page === "number" && Number.isFinite(row.page) ? row.page : row.page ?? undefined;
      const snippet = typeof row.snippet === "string" && row.snippet.trim().length > 0 ? row.snippet : undefined;
      const resolvable = Boolean(document_id);

      return {
        id,
        ok: true,
        resolvable,
        document_id,
        document_title,
        page,
        snippet,
      };
    });

    return reply.status(200).send({ results });
  });

  app.get("/api/v1/deals/:deal_id/evidence", async (request) => {
    const startTs = Date.now();
    const dealParam = (request.params as { deal_id: string }).deal_id;
    const parsedDeal = dealIdSchema.safeParse(dealParam);
    if (!parsedDeal.success) {
      return { evidence: [] };
    }
    const dealId = parsedDeal.data;

    request.log.info({ msg: "deal.evidence.start", deal_id: dealId, start_ts: new Date(startTs).toISOString() });

    const { rows: deals } = await pool.query(`SELECT id FROM deals WHERE id = $1 AND deleted_at IS NULL`, [dealId]);
    if (deals.length === 0) {
      return { evidence: [] };
    }

    const [hasId, hasEvidenceId, hasDocumentId, hasConfidence, hasVisualAssetId] = await Promise.all([
      hasColumn(pool as unknown as PoolLike, "evidence", "id"),
      hasColumn(pool as unknown as PoolLike, "evidence", "evidence_id"),
      hasColumn(pool as unknown as PoolLike, "evidence", "document_id"),
      hasColumn(pool as unknown as PoolLike, "evidence", "confidence"),
      hasColumn(pool as unknown as PoolLike, "evidence", "visual_asset_id"),
    ]);

    const idExpr = hasId ? "id" : hasEvidenceId ? "evidence_id" : "id";
    const documentIdExpr = hasDocumentId ? "document_id" : "NULL::text AS document_id";
    const confidenceExpr = hasConfidence ? "confidence::float8 AS confidence" : "NULL::float8 AS confidence";
    const visualAssetIdExpr = hasVisualAssetId ? "visual_asset_id" : "NULL::text AS visual_asset_id";

    const { rows } = await pool.query(
      `SELECT ${idExpr} as id,
              deal_id,
              ${documentIdExpr},
              ${visualAssetIdExpr},
              source,
              kind,
              text,
              ${confidenceExpr},
              created_at
       FROM evidence
       WHERE deal_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [dealId]
    );

    const endTs = Date.now();
    request.log.info({
      msg: "deal.evidence.done",
      deal_id: dealId,
      count: rows.length,
      start_ts: new Date(startTs).toISOString(),
      end_ts: new Date(endTs).toISOString(),
      duration_ms: endTs - startTs,
    });

    return { evidence: rows.map((row) => ({
      id: row.id,
      deal_id: row.deal_id,
      document_id: row.document_id ?? undefined,
      visual_asset_id: (row as any).visual_asset_id ?? undefined,
      source: row.source,
      kind: row.kind,
      text: row.text,
      confidence: row.confidence ?? undefined,
      created_at: row.created_at,
    })) };
  });
}
