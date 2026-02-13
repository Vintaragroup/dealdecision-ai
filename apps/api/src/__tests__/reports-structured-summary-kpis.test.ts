process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerReportRoutes } from "../routes/reports";
import { closeQueues } from "../lib/queue";

test.after(async () => {
  await closeQueues();
});

test("GET /api/v1/deals/:deal_id/report includes structured_summary.kpis (compat)", async () => {
  const dealId = "00000000-0000-0000-0000-000000000042";

  const mockPool = {
    query: async (sql: string, params: unknown[] = []) => {
      // Deal existence check (match regardless of selected columns)
      if (sql.includes("FROM deals") && sql.includes("WHERE id = $1") && sql.includes("deleted_at IS NULL")) {
        return { rows: [{ id: String(params[0] ?? dealId), llm_phase_mode: "exploratory" }] };
      }

      // Latest DIO lookup
      if (sql.includes("FROM deal_intelligence_objects") && sql.includes("WHERE deal_id = $1")) {
        return {
          rows: [
            {
              dio_id: "dio-1",
              analysis_version: 1,
              recommendation: null,
              overall_score: 50,
              updated_at: "2026-02-04T00:00:00.000Z",
              // Minimal DIO payload that the core compiler accepts.
              // Note: core expects phase1 under dio.phase1 and requires inputs/analyzer_results.
              dio_data: {
                deal_id: dealId,
                analysis_version: 1,
                inputs: {
                  documents: [],
                  evidence: [],
                },
                analyzer_results: {},
                dio: {
                  phase1: {
                    deal_overview_v2: {
                      raise: "$10M",
                      business_model: "DTC + wholesale",
                      revenue: "$2.476M",
                      customers: "100k customers",
                      growth: "20% MoM",
                      sources: [{ document_id: "doc-1", page: 1, note: "fixture" }],
                      // Optional marketing attributed revenue (only mapped when present).
                      marketing_metrics: {
                        attributed_revenue: { value_raw: "$800k", channel: "email_sms", confidence: 0.62, sources: [] },
                      },
                    },
                  },
                },
              },
            },
          ],
        };
      }

      // Avoid hitting promoted facts + DPU tables in this unit test.
      if (sql.includes("SELECT 1 FROM evidence_items")) {
        const err: any = new Error("missing table");
        err.code = "42P01";
        throw err;
      }
      if (sql.includes("SELECT 1 FROM document_page_understanding")) {
        const err: any = new Error("missing table");
        err.code = "42P01";
        throw err;
      }

      // Any other query means route logic changed; fail loudly.
      throw new Error(`Unexpected query: ${sql}`);
    },
  } as any;

  const app = Fastify();
  await registerReportRoutes(app, mockPool);
  await app.ready();

  const res = await app.inject({ method: "GET", url: `/api/v1/deals/${dealId}/report` });
  assert.ok(res && typeof (res as any).statusCode === "number", `inject did not return a normal response: keys=${Object.keys(res as any)}`);
  assert.equal(res.statusCode, 200, `status=${res.statusCode} body=${res.body}`);

  const body = res.json() as any;
  assert.equal(body.ready, true);

  const structured = body.structured_summary;
  assert.ok(structured && typeof structured === "object");

  const kpis = structured.kpis;
  assert.ok(kpis && typeof kpis === "object");

  assert.deepEqual(kpis.raise, structured.raise);
  assert.deepEqual(kpis.revenue, structured.revenue);
  assert.deepEqual(kpis.customers, structured.customers);
  assert.deepEqual(kpis.growth, structured.growth);

  // Business model may be promoted or synthesized; compat mapping chooses business_model first.
  assert.deepEqual(kpis.business_model, structured.business_model ?? structured.business_model_summary ?? null);

  // Only present when marketing_metrics.attributed_revenue exists.
  if (structured.marketing_metrics?.attributed_revenue) {
    assert.deepEqual(kpis.performance?.marketing_attributed_revenue_v1, structured.marketing_metrics.attributed_revenue);
  }

  await app.close();
});
