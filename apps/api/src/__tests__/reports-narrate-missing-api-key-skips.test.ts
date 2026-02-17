process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerReportRoutes } from "../routes/reports";
import { closeQueues } from "../lib/queue";

test.after(async () => {
  await closeQueues();
});

test("GET /api/v1/deals/:deal_id/report?narrate=1 when OPENAI_API_KEY missing sets metadata.llm_narration_v1_skipped.reason=missing_api_key", async () => {
  const dealId = "00000000-0000-0000-0000-000000000043";

  const originalKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("fetch_should_not_be_called");
  }) as any;

  const mockPool = {
    query: async (sql: string, params: unknown[] = []) => {
      if (sql.includes("FROM deals") && sql.includes("WHERE id = $1") && sql.includes("deleted_at IS NULL")) {
        return { rows: [{ id: String(params[0] ?? dealId), llm_phase_mode: "exploratory" }] };
      }
      if (sql.includes("FROM deal_intelligence_objects") && sql.includes("WHERE deal_id = $1")) {
        return {
          rows: [
            {
              dio_id: "dio-1",
              analysis_version: 1,
              recommendation: null,
              overall_score: 50,
              updated_at: "2026-02-04T00:00:00.000Z",
              dio_data: {
                deal_id: dealId,
                analysis_version: 1,
                inputs: { documents: [], evidence: [] },
                analyzer_results: {},
                dio: {
                  phase1: {
                    deal_overview_v2: {
                      raise: "$10M",
                      business_model: "DTC + wholesale",
                      revenue: "$2.476M",
                      customers: "100k customers",
                      growth: "20% MoM",
                      sources: [{ document_id: "doc-1", page: 1, slide_title: "Summary", note: "fixture" }],
                    },
                  },
                },
              },
            },
          ],
        };
      }

      if (sql.includes("SELECT 1 FROM evidence_items") || sql.includes("SELECT 1 FROM document_page_understanding")) {
        const err: any = new Error("missing table");
        err.code = "42P01";
        throw err;
      }

      throw new Error(`Unexpected query: ${sql}`);
    },
  } as any;

  const app = Fastify();
  await registerReportRoutes(app, mockPool);
  await app.ready();

  const res = await app.inject({ method: "GET", url: `/api/v1/deals/${dealId}/report?narrate=1` });
  assert.equal(res.statusCode, 200, `status=${res.statusCode} body=${res.body}`);
  const body = res.json() as any;

  const meta = body.metadata ?? body.report?.metadata;
  assert.ok(meta && typeof meta === "object");
  assert.equal(meta.llm_narration_v1_skipped?.reason, "missing_api_key");

  await app.close();

  globalThis.fetch = originalFetch;
  if (originalKey) process.env.OPENAI_API_KEY = originalKey;
  else delete process.env.OPENAI_API_KEY;
});
