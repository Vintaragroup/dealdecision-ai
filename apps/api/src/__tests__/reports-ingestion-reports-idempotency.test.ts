process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerReportRoutes } from "../routes/reports";
import { closeQueues } from "../lib/queue";

test.after(async () => {
  await closeQueues();
});

test("GET /api/v1/deals/:deal_id/report is idempotent in ingestion_reports by (deal_id, analysis_version)", async () => {
  const dealId = "00000000-0000-0000-0000-000000000777";
  const analysisVersion = 1;

  const rowsByKey = new Map<string, { report_id: string; summary: any }>();
  const keyFor = (dealId: string, version: number) => `${dealId}::${version}`;

  const mockPool = {
    query: async (sql: string, params: unknown[] = []) => {
      // Cache read
      if (sql.includes("FROM ingestion_reports") && sql.includes("SELECT summary") && sql.includes("analysis_version")) {
        const [deal_id, v] = params as any[];
        const k = keyFor(String(deal_id), Number(v));
        const row = rowsByKey.get(k);
        return { rows: row ? [{ summary: row.summary }] : [] };
      }

      // UPSERT
      if (sql.includes("INSERT INTO ingestion_reports") && sql.includes("ON CONFLICT (deal_id, analysis_version)")) {
        const [reportId, deal_id, v, summary] = params as any[];
        const k = keyFor(String(deal_id), Number(v));
        const existing = rowsByKey.get(k);
        if (existing) {
          existing.summary = summary;
          return { rows: [{ report_id: existing.report_id }] };
        }
        rowsByKey.set(k, { report_id: String(reportId), summary });
        return { rows: [{ report_id: String(reportId) }] };
      }

      // Deal existence check
      if (sql.includes("FROM deals") && sql.includes("WHERE id = $1") && sql.includes("deleted_at IS NULL")) {
        return { rows: [{ id: String(params[0] ?? dealId), llm_phase_mode: "exploratory" }] };
      }

      // Latest DIO lookup
      if (sql.includes("FROM deal_intelligence_objects") && sql.includes("WHERE deal_id = $1") && sql.includes("ORDER BY analysis_version")) {
        return {
          rows: [
            {
              dio_id: "dio-1",
              analysis_version: analysisVersion,
              recommendation: null,
              overall_score: 50,
              updated_at: "2026-02-20T00:00:00.000Z",
              dio_data: {
                deal_id: dealId,
                analysis_version: analysisVersion,
                inputs: { documents: [], evidence: [] },
                analyzer_results: {},
                report: {
                  version: 1,
                  structured_summary: {
                    raise: { value: "$10M", sources: [] },
                    business_model: { value: "SaaS", sources: [] },
                    revenue: { value: "$1M", sources: [] },
                    customers: { value: "10", sources: [] },
                    growth: { value: "10%", sources: [] },
                  },
                  metadata: {},
                },
                dio: { phase1: { deal_overview_v2: { sources: [] } } },
              },
            },
          ],
        };
      }

      // Everything else is best-effort in the route; simulate missing tables to avoid extra fixture work.
      const err: any = new Error("missing table");
      err.code = "42P01";
      throw err;
    },
  } as any;

  const app = Fastify();
  await registerReportRoutes(app, mockPool);
  await app.ready();

  const res1 = await app.inject({ method: "GET", url: `/api/v1/deals/${dealId}/report` });
  assert.equal(res1.statusCode, 200, `status=${res1.statusCode} body=${res1.body}`);

  const res2 = await app.inject({ method: "GET", url: `/api/v1/deals/${dealId}/report` });
  assert.equal(res2.statusCode, 200, `status=${res2.statusCode} body=${res2.body}`);

  assert.equal(rowsByKey.size, 1, `expected one ingestion_reports row; keys=${JSON.stringify(Array.from(rowsByKey.keys()))}`);
  assert.ok(rowsByKey.get(keyFor(dealId, analysisVersion))?.report_id, "expected stored report_id");

  await app.close();
});
