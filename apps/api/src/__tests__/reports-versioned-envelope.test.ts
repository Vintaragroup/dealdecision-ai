process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerReportRoutes } from "../routes/reports";
import { closeQueues } from "../lib/queue";

test.after(async () => {
  await closeQueues();
});

test("GET /api/v1/deals/:deal_id/report/:version returns ready envelope + structured_summary.deal_summary_v1", async () => {
  const dealId = "00000000-0000-0000-0000-000000000242";
  const version = 3;
  const visualAssetId = "00000000-0000-0000-0000-0000000000aa";

  const missingEvidenceItems = () => {
    const err: any = new Error("missing table");
    err.code = "42P01";
    throw err;
  };

  const mockPool = {
    query: async (sql: string, params: unknown[] = []) => {
      if (sql.includes("FROM ingestion_reports") && sql.includes("analysis_version")) {
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO ingestion_reports") && sql.includes("ON CONFLICT (deal_id, analysis_version)")) {
        return { rows: [{ report_id: "ir-1" }] };
      }

      // Deal existence check
      if (sql.includes("FROM deals") && sql.includes("WHERE id = $1") && sql.includes("deleted_at IS NULL")) {
        return { rows: [{ id: String(params[0] ?? dealId) }] };
      }

      // Versioned DIO lookup
      if (sql.includes("FROM deal_intelligence_objects") && sql.includes("analysis_version = $2")) {
        return {
          rows: [
            {
              dio_id: "dio-v3",
              analysis_version: version,
              recommendation: null,
              overall_score: 55,
              updated_at: "2026-02-18T00:00:00.000Z",
              dio_data: {
                deal_id: dealId,
                analysis_version: version,
                inputs: { documents: [], evidence: [] },
                analyzer_results: {},
                dio: {
                  phase1: {
                    deal_overview_v2: {
                      raise: "$10M",
                      business_model: "SaaS",
                      revenue: "$1.2M",
                      customers: "50 customers",
                      growth: "10% MoM",
                      sources: [{ document_id: "doc-1", page: 1, note: "fixture" }],
                    },
                  },
                },
              },
            },
          ],
        };
      }

      // Promoted facts table probe (fail-open)
      if (sql.includes("SELECT 1 FROM evidence_items")) return missingEvidenceItems();

      // Segmented nodes inputs: document_page_understanding
      if (sql.includes("FROM public.document_page_understanding") && sql.includes("version = 'page_understanding_v1'")) {
        return {
          rows: [
            {
              document_id: "00000000-0000-0000-0000-000000001111",
              page_index: 0,
              payload: {
                structured: {
                  title: "Company Overview",
                  bullets: [
                    "We build workflow automation for SMBs",
                    "ARR $1.2M, growing 10% MoM",
                  ],
                },
                source: { visual_asset_id: visualAssetId },
              },
            },
          ],
        };
      }

      // Segmented nodes optional mapping: visual_assets
      if (sql.includes("FROM visual_assets") && sql.includes("WHERE id = ANY")) {
        return {
          rows: [
            {
              id: visualAssetId,
              quality_flags: { segment_key: "overview", segment_confidence: 0.9, segment_source: "human_override" },
            },
          ],
        };
      }

      throw new Error(`Unexpected query: ${sql}`);
    },
  } as any;

  const app = Fastify();
  await registerReportRoutes(app, mockPool);
  await app.ready();

  const res = await app.inject({ method: "GET", url: `/api/v1/deals/${dealId}/report/${version}` });
  assert.equal(res.statusCode, 200, `status=${res.statusCode} body=${res.body}`);

  const body = res.json() as any;
  assert.equal(body?.ready, true);
  assert.equal(body?.version, version);
  assert.ok(body?.artifact && typeof body.artifact === "object");
  assert.ok(body?.report && typeof body.report === "object");

  const structured = body?.report?.structured_summary;
  assert.ok(structured && typeof structured === "object");
  assert.ok(Object.prototype.hasOwnProperty.call(structured, "deal_summary_v1"));

  await app.close();
});
