process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { registerDealRoutes } from "../routes/deals";
import { closeQueues } from "../lib/queue";

test.after(async () => {
  await closeQueues();
});

test("POST /api/v1/deals/:deal_id/extract-visuals rejects non-UUID deal_id with 400 and does not hit DB", async () => {
  const queries: string[] = [];
  const mockPool = {
    query: async (sql: string) => {
      queries.push(sql);
      throw new Error(`Unexpected query: ${sql}`);
    },
  } as any;

  const app = Fastify();
  await registerDealRoutes(app, mockPool, {
    r2: {
      objectExistsInR2: async () => ({ exists: true }) as any,
    },
  });

  const res = await app.inject({
    method: "POST",
    url: "/api/v1/deals/not-a-uuid/extract-visuals",
    payload: {},
  });

  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.json(), { error: "invalid_deal_id", message: "deal_id must be a UUID" });
  assert.equal(queries.length, 0, "expected no DB queries when deal_id is invalid");

  await app.close();
});

test("POST /api/v1/deals/:deal_id/extract-visuals is idempotent by X-Idempotency-Key", async () => {
  const dealId = "00000000-0000-0000-0000-000000000001";
  const idempotency = new Map<string, { job_id: string | null }>();
  const events: string[] = [];

  const keyFor = (dealId: string, op: string, key: string) => `${dealId}::${op}::${key}`;

  const handleQuery = async (sql: string, params: unknown[] = []) => {
    if (sql.trim() === "BEGIN" || sql.trim() === "COMMIT" || sql.trim() === "ROLLBACK") {
      events.push(sql.trim());
      return { rows: [] };
    }

    if (sql.includes("SELECT * FROM deals WHERE id = $1")) {
      return { rows: [{ id: String(params[0]), deleted_at: null }] };
    }

    if (sql.includes("SELECT id, job_id, status") && sql.includes("FROM jobs") && sql.includes("WHERE deal_id = $1")) {
      // Dedupe check in insertJobRow: return none so we insert.
      return { rows: [] };
    }

    if (sql.includes("INSERT INTO jobs") && sql.includes("RETURNING id, job_id, status")) {
      // insertJobRow uses $1 as job_id.
      const jobId = String((params as any[])[0]);
      return { rows: [{ id: 1, job_id: jobId, status: "queued" }] };
    }
    if (sql.includes("SELECT to_regclass")) {
      // hasTable() checks for document_files.
      return { rows: [{ oid: null }] };
    }
    if (sql.includes("information_schema.columns")) {
      // hasColumn() checks for mime_type.
      return { rows: [{ ok: 1 }] };
    }
    if (sql.includes("FROM documents") && sql.includes("WHERE deal_id = $1")) {
      // One ready PDF so we get to enqueue.
      return {
        rows: [
          {
            id: "doc-1",
            file_name: null,
            mime_type: "application/pdf",
            extraction_metadata: {
              rendered_pages_r2: {
                bucket: "b",
                prefix: "deals/deal-1/documents/doc-1/rendered_pages",
                format: "page_%04d.png",
              },
              rendered_pages_count: 1,
              rendered_pages_rendered: 1,
            },
          },
        ],
      };
    }

    if (sql.includes("INSERT INTO job_idempotency") && sql.includes("ON CONFLICT")) {
      const [dealId, op, key] = params as string[];
      const k = keyFor(dealId, op, key);
      if (!idempotency.has(k)) idempotency.set(k, { job_id: null });
      return { rows: [] };
    }

    if (sql.includes("SELECT job_id") && sql.includes("FROM job_idempotency") && sql.includes("FOR UPDATE")) {
      const [dealId, op, key] = params as string[];
      const k = keyFor(dealId, op, key);
      const row = idempotency.get(k);
      assert.ok(row, "expected idempotency row to exist");
      return { rows: [{ job_id: row?.job_id }] };
    }

    if (sql.includes("UPDATE job_idempotency") && sql.includes("SET job_id")) {
      const [dealId, op, key, jobId] = params as string[];
      const k = keyFor(dealId, op, key);
      const row = idempotency.get(k);
      assert.ok(row, "expected idempotency row to exist");
      row!.job_id = jobId;
      return { rows: [] };
    }

    if (sql.includes("SELECT status") && sql.includes("FROM jobs") && sql.includes("WHERE job_id = $1")) {
      // On duplicate, the route fetches status from jobs.
      return { rows: [{ status: "queued" }] };
    }

    throw new Error(`Unexpected query: ${sql}`);
  };

  const mockClient = {
    query: (sql: string, params?: unknown[]) => handleQuery(sql, (params ?? []) as unknown[]),
    release: () => {
      // no-op
    },
  } as any;

  const mockPool = {
    query: (sql: string, params?: unknown[]) => handleQuery(sql, (params ?? []) as unknown[]),
    connect: async () => mockClient,
  } as any;

  const mockQueue = {
    add: async (_name: string, _data: Record<string, unknown>, _opts: { jobId: string; removeOnComplete: boolean; removeOnFail: boolean }) => {
      events.push("QUEUE_ADD");
    },
  } as any;

  const app = Fastify();
  await registerDealRoutes(app, mockPool, {
    jobs: { queue: mockQueue },
    r2: {
      objectExistsInR2: async () => ({ exists: true }) as any,
    },
  });

  const headers = { "X-Idempotency-Key": "idem-1" };

  const res1 = await app.inject({ method: "POST", url: `/api/v1/deals/${dealId}/extract-visuals`, payload: {}, headers });
  assert.equal(res1.statusCode, 202);
  const body1 = res1.json() as any;

  const res2 = await app.inject({ method: "POST", url: `/api/v1/deals/${dealId}/extract-visuals`, payload: {}, headers });
  assert.equal(res2.statusCode, 202);
  const body2 = res2.json() as any;

  const commitIdx = events.indexOf("COMMIT");
  const queueIdx = events.indexOf("QUEUE_ADD");
  assert.ok(commitIdx >= 0, "expected COMMIT to occur");
  assert.ok(queueIdx >= 0, "expected QUEUE_ADD to occur");
  assert.ok(commitIdx < queueIdx, `expected QUEUE_ADD after COMMIT; events=${JSON.stringify(events)}`);

  assert.equal(events.filter((e) => e === "QUEUE_ADD").length, 1, "expected only one queue.add call");

  assert.equal(body1.job_id, body2.job_id);
  assert.equal(body1.status, "queued");
  assert.equal(body2.status, "queued");

  await app.close();
});

test("POST /api/v1/deals/:deal_id/extract-visuals treats local rendered pages as ready when R2 is not configured", async () => {
  const dealId = "00000000-0000-0000-0000-000000000002";
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ddai-uploads-"));
  const prevUploadDir = process.env.UPLOAD_DIR;
  const prevR2 = process.env.R2_BUCKET;

  try {
    process.env.UPLOAD_DIR = tmp;
    delete (process.env as any).R2_BUCKET;

    // Worker-local rendered pages layout: UPLOAD_DIR/rendered_pages/<safeDocId>/page_0000.png
    const renderedDir = path.join(tmp, "rendered_pages", "doc-1");
    fs.mkdirSync(renderedDir, { recursive: true });
    fs.writeFileSync(path.join(renderedDir, "page_0000.png"), "x");

    const mockPool = {
      query: async (sql: string, params?: unknown[]) => {
        if (sql.includes("SELECT * FROM deals WHERE id = $1")) {
          return { rows: [{ id: String((params ?? [])[0]), deleted_at: null }] };
        }
        if (sql.includes("SELECT to_regclass")) {
          // hasTable() checks for document_files.
          return { rows: [{ oid: null }] };
        }
        if (sql.includes("information_schema.columns")) {
          // hasColumn() checks for mime_type.
          return { rows: [{ ok: 1 }] };
        }
        if (sql.includes("FROM documents") && sql.includes("WHERE deal_id = $1")) {
          return {
            rows: [
              {
                id: "doc-1",
                file_name: null,
                mime_type: "application/pdf",
                extraction_metadata: null,
              },
            ],
          };
        }
        throw new Error(`Unexpected query: ${sql}`);
      },
    } as any;

    const app = Fastify();
    await registerDealRoutes(app, mockPool, {
      enqueueJob: async (job: any) => ({ job_id: "job-1", status: "queued", ...(job ?? {}) }) as any,
      r2: {
        objectExistsInR2: async () => ({ exists: false }) as any,
      },
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/deals/${dealId}/extract-visuals`,
      payload: {},
    });

    assert.equal(res.statusCode, 202);
    const json = res.json() as any;
    assert.equal(json.job_id, "job-1");
    assert.equal(json.status, "queued");
    assert.equal(json.readiness_reason, "local_rendered_pages_present");
    assert.deepEqual(json.ready_documents, ["doc-1"]);

    await app.close();
  } finally {
    process.env.UPLOAD_DIR = prevUploadDir;
    if (prevR2 == null) delete (process.env as any).R2_BUCKET;
    else process.env.R2_BUCKET = prevR2;
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

test("POST /api/v1/deals/:deal_id/extract-visuals returns 202 failed when afterCommit enqueue fails (no zombie queued job)", async () => {
  const dealId = "00000000-0000-0000-0000-000000000002";
  const idempotency = new Map<string, { job_id: string | null }>();
  const jobsById = new Map<string, { status: string; message?: string | null }>();
  const events: string[] = [];

  const keyFor = (dealId: string, op: string, key: string) => `${dealId}::${op}::${key}`;

  const handleQuery = async (sql: string, params: unknown[] = []) => {
    if (sql.trim() === "BEGIN" || sql.trim() === "COMMIT" || sql.trim() === "ROLLBACK") {
      events.push(sql.trim());
      return { rows: [] };
    }

    if (sql.includes("SELECT * FROM deals WHERE id = $1")) {
      return { rows: [{ id: String(params[0]), deleted_at: null }] };
    }

    if (sql.includes("SELECT id, job_id, status") && sql.includes("FROM jobs") && sql.includes("WHERE deal_id = $1")) {
      // Dedupe check in insertJobRow: return none so we insert.
      return { rows: [] };
    }

    if (sql.includes("INSERT INTO jobs") && sql.includes("RETURNING id, job_id, status")) {
      const jobId = String((params as any[])[0]);
      jobsById.set(jobId, { status: "queued" });
      return { rows: [{ id: 1, job_id: jobId, status: "queued" }] };
    }

    if (sql.includes("UPDATE jobs") && sql.includes("SET status = 'failed'")) {
      const [jobId, message] = params as any[];
      jobsById.set(String(jobId), { status: "failed", message: String(message) });
      return { rows: [] };
    }

    if (sql.includes("SELECT to_regclass")) {
      return { rows: [{ oid: null }] };
    }
    if (sql.includes("information_schema.columns")) {
      return { rows: [{ ok: 1 }] };
    }
    if (sql.includes("FROM documents") && sql.includes("WHERE deal_id = $1")) {
      return {
        rows: [
          {
            id: "doc-1",
            file_name: null,
            mime_type: "application/pdf",
            extraction_metadata: {
              rendered_pages_r2: {
                bucket: "b",
                prefix: "deals/deal-2/documents/doc-1/rendered_pages",
                format: "page_%04d.png",
              },
              rendered_pages_count: 1,
              rendered_pages_rendered: 1,
            },
          },
        ],
      };
    }

    if (sql.includes("INSERT INTO job_idempotency") && sql.includes("ON CONFLICT")) {
      const [dealId, op, key] = params as string[];
      const k = keyFor(dealId, op, key);
      if (!idempotency.has(k)) idempotency.set(k, { job_id: null });
      return { rows: [] };
    }

    if (sql.includes("SELECT job_id") && sql.includes("FROM job_idempotency") && sql.includes("FOR UPDATE")) {
      const [dealId, op, key] = params as string[];
      const k = keyFor(dealId, op, key);
      const row = idempotency.get(k);
      assert.ok(row, "expected idempotency row to exist");
      return { rows: [{ job_id: row?.job_id }] };
    }

    if (sql.includes("UPDATE job_idempotency") && sql.includes("SET job_id")) {
      const [dealId, op, key, jobId] = params as string[];
      const k = keyFor(dealId, op, key);
      const row = idempotency.get(k);
      assert.ok(row, "expected idempotency row to exist");
      row!.job_id = jobId;
      return { rows: [] };
    }

    if (sql.includes("UPDATE job_idempotency") && sql.includes("SET updated_at")) {
      return { rows: [] };
    }

    if (sql.includes("SELECT status") && sql.includes("FROM jobs") && sql.includes("WHERE job_id = $1")) {
      const jobId = String((params as any[])[0]);
      const status = jobsById.get(jobId)?.status ?? "queued";
      return { rows: [{ status }] };
    }

    throw new Error(`Unexpected query: ${sql}`);
  };

  const mockClient = {
    query: (sql: string, params?: unknown[]) => handleQuery(sql, (params ?? []) as unknown[]),
    release: () => {
      // no-op
    },
  } as any;

  const mockPool = {
    query: (sql: string, params?: unknown[]) => handleQuery(sql, (params ?? []) as unknown[]),
    connect: async () => mockClient,
  } as any;

  const mockQueue = {
    add: async () => {
      events.push("QUEUE_ADD");
      throw new Error("redis_down");
    },
  } as any;

  const app = Fastify();
  await registerDealRoutes(app, mockPool, {
    jobs: { queue: mockQueue },
    r2: {
      objectExistsInR2: async () => ({ exists: true }) as any,
    },
  });

  const headers = { "X-Idempotency-Key": "idem-fail" };
  const res = await app.inject({ method: "POST", url: `/api/v1/deals/${dealId}/extract-visuals`, payload: {}, headers });
  assert.equal(res.statusCode, 202);
  const body = res.json() as any;
  assert.equal(body.status, "failed");
  assert.equal(typeof body.job_id, "string");

  const stored = jobsById.get(body.job_id);
  assert.equal(stored?.status, "failed");
  assert.ok(String(stored?.message ?? "").startsWith("enqueue_failed:"));

  const commitIdx = events.indexOf("COMMIT");
  const queueIdx = events.indexOf("QUEUE_ADD");
  assert.ok(commitIdx >= 0, "expected COMMIT to occur");
  assert.ok(queueIdx >= 0, "expected QUEUE_ADD to occur");
  assert.ok(commitIdx < queueIdx, `expected QUEUE_ADD after COMMIT; events=${JSON.stringify(events)}`);

  await app.close();
});
