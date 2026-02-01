import { test } from "node:test";
import assert from "node:assert/strict";

import { enqueueJob } from "../src/services/jobs";

test("enqueueJob persists non-null payload and includes identifiers", async () => {
  const seen: { sql?: string; params?: unknown[] } = {};

  const mockPool = {
    query: async (sql: string, params: unknown[]) => {
      seen.sql = sql;
      seen.params = params;
      return { rows: [{ id: 1, job_id: params[0], status: "queued" }] };
    },
  };

  const mockQueue = {
    add: async () => ({ id: "bull-1" }),
  };

  const input = {
    type: "ingest_documents" as const,
    deal_id: "deal-123",
  };

  const res = await enqueueJob(input, { deps: { pool: mockPool as any, queue: mockQueue as any } });

  assert.ok(seen.sql?.includes("payload"), "insert should write payload");
  assert.ok(seen.sql?.includes("queue"), "insert should write queue");

  const params = seen.params ?? [];
  const jobId = params[0] as string;
  assert.equal(res.job_id, jobId);

  const payloadJson = params[6] as string;
  assert.equal(typeof payloadJson, "string");

  const payload = JSON.parse(payloadJson) as Record<string, unknown>;
  assert.equal(payload.deal_id, input.deal_id);
  assert.equal(payload.type, input.type);
  assert.equal(payload.job_id, jobId);
});
