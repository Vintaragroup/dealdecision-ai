process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import Fastify from "fastify";
import { registerDealRoutes } from "../routes/deals";

function makeCapturingLogger() {
  const events: any[] = [];
  const logger: any = {
    info: (obj: any, msg?: any) => {
      events.push({ level: "info", obj, msg });
    },
    warn: (obj: any, msg?: any) => {
      events.push({ level: "warn", obj, msg });
    },
    error: (obj: any, msg?: any) => {
      events.push({ level: "error", obj, msg });
    },
    debug: (obj: any, msg?: any) => {
      events.push({ level: "debug", obj, msg });
    },
    trace: (obj: any, msg?: any) => {
      events.push({ level: "trace", obj, msg });
    },
    fatal: (obj: any, msg?: any) => {
      events.push({ level: "fatal", obj, msg });
    },
    child: () => logger,
  };
  return { logger, events };
}

test("extract-visuals: local rendered-pages fallback is disabled in production even if local files exist", async () => {
  const priorEnv = { ...process.env };
  try {
    process.env.NODE_ENV = "production";
    process.env.STORAGE_DRIVER = "local";
    process.env.DDAI_DEV_LOCAL_FALLBACK = "1";

    const tempUploads = fs.mkdtempSync(path.join(os.tmpdir(), "ddai-uploads-"));
    process.env.UPLOAD_DIR = tempUploads;

    const dealId = "00000000-0000-0000-0000-000000000011";
    const docId = "00000000-0000-0000-0000-000000000012";

    // Create local rendered pages that would have satisfied the fallback.
    const safeId = docId.replace(/[^a-zA-Z0-9_\-]/g, "_");
    const renderedDir = path.join(tempUploads, "rendered_pages", safeId);
    fs.mkdirSync(renderedDir, { recursive: true });
    fs.writeFileSync(path.join(renderedDir, "page_0000.png"), "x");

    const mockPool = {
      query: async (sql: string, params: unknown[] = []) => {
        if (sql.includes("SELECT * FROM deals") && Array.isArray(params) && params[0] === dealId) {
          return { rows: [{ id: dealId, deleted_at: null }] };
        }

        if (sql.includes("SELECT to_regclass") || sql.includes("to_regclass")) {
          // hasTable(document_files)
          return { rows: [{ oid: "document_files" }] };
        }

        if (sql.includes("information_schema.columns") && sql.includes("mime_type")) {
          // hasColumn(mime_type)
          return { rows: [{ ok: 1 }] };
        }

        if (sql.includes("FROM documents d") && sql.includes("LEFT JOIN document_files")) {
          return {
            rows: [
              {
                id: docId,
                file_name: "deck.pdf",
                mime_type: "application/pdf",
                extraction_metadata: null,
              },
            ],
          };
        }

        throw new Error(`Unexpected query: ${sql}`);
      },
    } as any;

    const { logger } = makeCapturingLogger();
    const app = Fastify({ logger });

    await registerDealRoutes(app, mockPool, {
      enqueueJob: async () => ({ id: 1, job_id: "job-render-1", status: "queued" }),
      jobs: { queue: { add: async () => ({ ok: true }) } },
      r2: { objectExistsInR2: async ({ key }: { key: string }) => ({ key, exists: false }) },
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/deals/${dealId}/extract-visuals`,
      payload: {},
    });

    assert.equal(res.statusCode, 409);
    const body = res.json() as any;
    assert.equal(body.error, "rendered_pages_not_ready");
    assert.ok(Array.isArray(body.blocked_documents) && body.blocked_documents.length === 1);
    assert.equal(body.blocked_documents[0].document_id, docId);
    assert.equal(body.blocked_documents[0].failure_reason, "rendered_pages_r2_missing");

    await app.close();
  } finally {
    process.env = priorEnv;
  }
});

test("extract-visuals: local rendered-pages fallback works in non-prod when DDAI_DEV_LOCAL_FALLBACK=1", async () => {
  const priorEnv = { ...process.env };
  try {
    process.env.NODE_ENV = "test";
    process.env.STORAGE_DRIVER = "local";
    process.env.DDAI_DEV_LOCAL_FALLBACK = "1";

    const tempUploads = fs.mkdtempSync(path.join(os.tmpdir(), "ddai-uploads-"));
    process.env.UPLOAD_DIR = tempUploads;

    const dealId = "00000000-0000-0000-0000-000000000021";
    const docId = "00000000-0000-0000-0000-000000000022";

    const safeId = docId.replace(/[^a-zA-Z0-9_\-]/g, "_");
    const renderedDir = path.join(tempUploads, "rendered_pages", safeId);
    fs.mkdirSync(renderedDir, { recursive: true });
    fs.writeFileSync(path.join(renderedDir, "page_0000.png"), "x");

    const mockPool = {
      query: async (sql: string, params: unknown[] = []) => {
        if (sql.includes("SELECT * FROM deals") && Array.isArray(params) && params[0] === dealId) {
          return { rows: [{ id: dealId, deleted_at: null }] };
        }

        if (sql.includes("SELECT to_regclass") || sql.includes("to_regclass")) {
          return { rows: [{ oid: "document_files" }] };
        }

        if (sql.includes("information_schema.columns") && sql.includes("mime_type")) {
          return { rows: [{ ok: 1 }] };
        }

        if (sql.includes("FROM documents d") && sql.includes("LEFT JOIN document_files")) {
          return {
            rows: [
              {
                id: docId,
                file_name: "deck.pdf",
                mime_type: "application/pdf",
                extraction_metadata: null,
              },
            ],
          };
        }

        throw new Error(`Unexpected query: ${sql}`);
      },
    } as any;

    const { logger, events } = makeCapturingLogger();
    const app = Fastify({ logger });

    await registerDealRoutes(app, mockPool, {
      enqueueJob: async () => ({ id: 1, job_id: "job-extract-1", status: "queued" }),
      jobs: { queue: { add: async () => ({ ok: true }) } },
      r2: { objectExistsInR2: async ({ key }: { key: string }) => ({ key, exists: false }) },
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/deals/${dealId}/extract-visuals`,
      payload: {},
    });

    assert.equal(res.statusCode, 202);
    const body = res.json() as any;
    assert.equal(body.readiness_reason, "local_rendered_pages_present");
    assert.deepEqual(body.ready_documents, [docId]);

    const disclosure = events.find((e) => e?.obj?.event === "GOVERNANCE_DISCLOSURE" && e?.obj?.code === "dev_local_rendered_pages_fallback");
    assert.ok(disclosure, "expected dev local fallback disclosure log");

    await app.close();
  } finally {
    process.env = priorEnv;
  }
});

test("extract-visuals: R2 probe override in production is disclosed", async () => {
  const priorEnv = { ...process.env };
  try {
    process.env.NODE_ENV = "production";
    process.env.STORAGE_DRIVER = "r2";
    delete process.env.DDAI_DEV_LOCAL_FALLBACK;

    const dealId = "00000000-0000-0000-0000-000000000031";
    const docId = "00000000-0000-0000-0000-000000000032";

    const mockPool = {
      query: async (sql: string, params: unknown[] = []) => {
        if (sql.includes("SELECT * FROM deals") && Array.isArray(params) && params[0] === dealId) {
          return { rows: [{ id: dealId, deleted_at: null }] };
        }

        if (sql.includes("SELECT to_regclass") || sql.includes("to_regclass")) {
          return { rows: [{ oid: "document_files" }] };
        }

        if (sql.includes("information_schema.columns") && sql.includes("mime_type")) {
          return { rows: [{ ok: 1 }] };
        }

        if (sql.includes("FROM documents d") && sql.includes("LEFT JOIN document_files")) {
          return {
            rows: [
              {
                id: docId,
                file_name: "deck.pdf",
                mime_type: "application/pdf",
                extraction_metadata: {
                  rendered_pages_r2: {
                    bucket: "b",
                    prefix: "deals/d/documents/doc/rendered_pages",
                    format: "page_%04d.png",
                  },
                  rendered_pages_count: 2,
                  rendered_pages_rendered: 0,
                },
              },
            ],
          };
        }

        throw new Error(`Unexpected query: ${sql}`);
      },
    } as any;

    const { logger, events } = makeCapturingLogger();
    const app = Fastify({ logger });

    await registerDealRoutes(app, mockPool, {
      enqueueJob: async () => ({ id: 1, job_id: "job-extract-2", status: "queued" }),
      jobs: { queue: { add: async () => ({ ok: true }) } },
      r2: {
        objectExistsInR2: async ({ key }: { key: string }) => ({ key, exists: true }),
      },
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/v1/deals/${dealId}/extract-visuals`,
      payload: {},
    });

    assert.equal(res.statusCode, 202);
    const body = res.json() as any;
    assert.equal(body.readiness_reason, "r2_probe_overrode_metadata");
    assert.deepEqual(body.ready_documents, [docId]);
    assert.ok(Array.isArray(body.r2_probe_overrides) && body.r2_probe_overrides.length === 1);

    const disclosure = events.find((e) => e?.obj?.event === "GOVERNANCE_DISCLOSURE" && e?.obj?.code === "r2_probe_overrode_render_metadata");
    assert.ok(disclosure, "expected R2 probe override disclosure log");

    await app.close();
  } finally {
    process.env = priorEnv;
  }
});
