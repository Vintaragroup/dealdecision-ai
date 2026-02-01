import type { JobStatus } from "@dealdecision/contracts";
import { sanitizeText } from "@dealdecision/core";
import type { Pool } from "pg";
import { getPool } from "./db";

export type DbPoolLike = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};

type DbClientLike = DbPoolLike & { release?: () => void };

type ConnectablePoolLike = DbPoolLike & { connect?: () => Promise<DbClientLike> };

export async function runIdempotentOperation(params: {
  deal_id: string;
  operation: string;
  idempotency_key: string;
  runDb: (client: DbPoolLike) => Promise<{ job_id: string; status: JobStatus } & Record<string, any>>;
  afterCommit?: (dbResult: { job_id: string; status: JobStatus } & Record<string, any>) => Promise<void>;
  poolOverride?: Pool | ConnectablePoolLike;
}): Promise<{ job_id: string; status: JobStatus; idempotent: boolean } & Record<string, any>> {
  const pool: any = params.poolOverride ?? (getPool() as any);
  const dealId = sanitizeText(params.deal_id);
  const operation = sanitizeText(params.operation);
  const idempotencyKey = sanitizeText(params.idempotency_key);

  const client: any = typeof pool?.connect === "function" ? await pool.connect() : pool;
  const shouldRelease = client && typeof client.release === "function";

  let dbResultForAfterCommit: ({ job_id: string; status: JobStatus } & Record<string, any>) | null = null;
  let didCommit = false;

  try {
    await client.query("BEGIN");

    // Reserve the idempotency key. The unique constraint enforces global correctness.
    await client.query(
      `INSERT INTO job_idempotency (deal_id, operation, idempotency_key, job_id)
       VALUES ($1, $2, $3, NULL)
       ON CONFLICT (deal_id, operation, idempotency_key)
       DO NOTHING`,
      [dealId, operation, idempotencyKey]
    );

    // Lock the row so concurrent duplicates wait until job_id is populated.
    const { rows } = await client.query(
      `SELECT job_id
         FROM job_idempotency
        WHERE deal_id = $1
          AND operation = $2
          AND idempotency_key = $3
        FOR UPDATE`,
      [dealId, operation, idempotencyKey]
    );

    if (!rows || rows.length === 0) {
      throw new Error("idempotency_row_missing");
    }

    const existingJobId = typeof rows[0]?.job_id === "string" && rows[0].job_id ? rows[0].job_id : null;
    if (existingJobId) {
      const statusRes = await client.query(
        `SELECT status
           FROM jobs
          WHERE job_id = $1
          LIMIT 1`,
        [sanitizeText(existingJobId)]
      );
      const status = (statusRes?.rows?.[0]?.status as JobStatus | undefined) ?? "queued";
      await client.query("COMMIT");
      didCommit = true;
      return { job_id: existingJobId, status, idempotent: true };
    }

    const result = await params.runDb(client as DbPoolLike);
    const jobId = sanitizeText(result.job_id);

    await client.query(
      `UPDATE job_idempotency
          SET job_id = $4,
              updated_at = now()
        WHERE deal_id = $1
          AND operation = $2
          AND idempotency_key = $3`,
      [dealId, operation, idempotencyKey, jobId]
    );

    await client.query("COMMIT");
    didCommit = true;

    dbResultForAfterCommit = { ...result, job_id: jobId };
    if (typeof params.afterCommit === "function") {
      await params.afterCommit(dbResultForAfterCommit);
    }

    return { job_id: jobId, status: result.status, idempotent: false };
  } catch (err) {
    if (!didCommit) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // ignore
      }
    }
    throw err;
  } finally {
    if (shouldRelease) client.release();
  }
}
