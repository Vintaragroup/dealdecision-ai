export type QueryResult<T> = { rows: T[]; rowCount?: number };

export type TxClient = {
  query: <T = any>(sql: string, params?: unknown[]) => Promise<QueryResult<T>>;
  release: () => void;
};

export type DbPoolLike = {
  connect: () => Promise<TxClient>;
  query?: <T = any>(sql: string, params?: unknown[]) => Promise<QueryResult<T>>;
};

export type PurgeDealCascadeArgs = {
  deal_id: string;
  actor_user_id?: string | null;
  db: DbPoolLike;
  logger?: {
    info: (msg: string, meta?: any) => void;
    warn: (msg: string, meta?: any) => void;
    error: (msg: string, meta?: any) => void;
  };
};

export type PurgeDealCascadeResult = {
  ok: true;
  deal_id: string;
  actor_user_id: string | null;
  expected_deleted: {
    documents: number;
    evidence: number;
    jobs: number;
    deal_intelligence_objects: number;
  };
  deleted: {
    ingestion_reports: number;
    deal_evidence: number;
    deal_row: number;
  };
  blobs: {
    attempted_sha256: string[];
    deleted_unreferenced_blobs: number;
    deleted_sha256: string[];
  };
};

class PurgeDealNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PurgeDealNotFoundError';
  }
}

function isMissingRelationError(err: unknown): boolean {
  const anyErr = err as any;
  const code = anyErr?.code;
  return code === '42P01';
}

async function countByDealId(client: TxClient, table: string, dealId: string): Promise<number> {
  const { rows } = await client.query<{ count: string }>(
    `SELECT COUNT(*)::text as count FROM ${table} WHERE deal_id = $1`,
    [dealId]
  );
  const raw = rows?.[0]?.count ?? '0';
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function getAttemptedBlobSha256(client: TxClient, dealId: string): Promise<string[]> {
  try {
    const { rows } = await client.query<{ sha256: string }>(
      `SELECT DISTINCT df.sha256
         FROM document_files df
         JOIN documents d ON d.id = df.document_id
        WHERE d.deal_id = $1`,
      [dealId]
    );
    return rows
      .map((r) => (typeof r.sha256 === 'string' ? r.sha256 : null))
      .filter((x): x is string => Boolean(x));
  } catch (err) {
    // If the optional original-files tables aren't present, treat as no blobs.
    if (isMissingRelationError(err)) return [];
    throw err;
  }
}

async function deleteOptionalByDealId(client: TxClient, table: string, dealId: string): Promise<number> {
  try {
    const res = await client.query(`DELETE FROM ${table} WHERE deal_id = $1`, [dealId]);
    return res.rowCount ?? 0;
  } catch (err) {
    if (isMissingRelationError(err)) return 0;
    throw err;
  }
}

async function deleteUnreferencedBlobsBySha256(client: TxClient, sha256s: string[]): Promise<{ deleted: number; sha256: string[] }> {
  if (sha256s.length === 0) return { deleted: 0, sha256: [] };

  try {
    const res = await client.query<{ sha256: string }>(
      `DELETE FROM document_file_blobs b
        WHERE b.sha256 = ANY($1)
          AND NOT EXISTS (SELECT 1 FROM document_files f WHERE f.sha256 = b.sha256)
        RETURNING b.sha256`,
      [sha256s]
    );
    const deleted = res.rowCount ?? 0;
    const deletedSha = (res.rows ?? [])
      .map((r) => (typeof r.sha256 === 'string' ? r.sha256 : null))
      .filter((x): x is string => Boolean(x));
    return { deleted, sha256: deletedSha };
  } catch (err) {
    if (isMissingRelationError(err)) return { deleted: 0, sha256: [] };
    throw err;
  }
}

export async function purgeDealCascade(args: PurgeDealCascadeArgs): Promise<PurgeDealCascadeResult> {
  const logger = args.logger;
  const actor_user_id = args.actor_user_id ?? null;
  const dealId = args.deal_id;

  const client = await args.db.connect();
  try {
    await client.query('BEGIN');

    const dealCheck = await client.query<{ id: string }>(
      `SELECT id FROM deals WHERE id = $1`,
      [dealId]
    );
    if ((dealCheck.rows ?? []).length === 0) {
      throw new PurgeDealNotFoundError('Deal not found');
    }

    const expected_deleted = {
      documents: await countByDealId(client, 'documents', dealId),
      evidence: await countByDealId(client, 'evidence', dealId),
      jobs: await countByDealId(client, 'jobs', dealId),
      deal_intelligence_objects: await countByDealId(client, 'deal_intelligence_objects', dealId),
    };

    // Capture blob keys before cascades remove document_files.
    const attempted_sha256 = await getAttemptedBlobSha256(client, dealId);

    // Non-FK / optional tables that won't be handled by ON DELETE CASCADE.
    const ingestion_reports = await deleteOptionalByDealId(client, 'ingestion_reports', dealId);
    const deal_evidence = await deleteOptionalByDealId(client, 'deal_evidence', dealId);

    // Some schemas use a RESTRICT/NO ACTION FK from deal_intelligence_objects -> deals.
    // Ensure those rows are removed before deleting the deal.
    await deleteOptionalByDealId(client, 'deal_intelligence_objects', dealId);

    // Delete the deal last so FK cascades remove dependent rows.
    const delDeal = await client.query(`DELETE FROM deals WHERE id = $1`, [dealId]);
    const deal_row = delDeal.rowCount ?? 0;

    // Best-effort GC for blobs that are now unreferenced.
    const gc = await deleteUnreferencedBlobsBySha256(client, attempted_sha256);

    await client.query('COMMIT');

    logger?.info?.('deal.purge.completed', {
      deal_id: dealId,
      actor_user_id,
      expected_deleted,
      deleted: { ingestion_reports, deal_evidence, deal_row },
      blobs: { attempted: attempted_sha256.length, deleted_unreferenced_blobs: gc.deleted },
    });

    return {
      ok: true,
      deal_id: dealId,
      actor_user_id,
      expected_deleted,
      deleted: {
        ingestion_reports,
        deal_evidence,
        deal_row,
      },
      blobs: {
        attempted_sha256,
        deleted_unreferenced_blobs: gc.deleted,
        deleted_sha256: gc.sha256,
      },
    };
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore
    }

    if (err instanceof PurgeDealNotFoundError) {
      throw err;
    }

    logger?.error?.('deal.purge.failed', {
      deal_id: dealId,
      actor_user_id,
      error: err instanceof Error ? err.message : String(err),
    });

    throw err;
  } finally {
    client.release();
  }
}

export function isPurgeDealNotFoundError(err: unknown): boolean {
  return err instanceof Error && err.name === 'PurgeDealNotFoundError';
}
