process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerReportRoutes } from "../routes/reports";
import { closeQueues } from "../lib/queue";

test.after(async () => {
  await closeQueues();
});

function buildMockPool(dealId: string): any {
  return {
    query: async (sql: string, params: unknown[] = []) => {
      if (sql.includes("SELECT id FROM deals") && sql.includes("deleted_at IS NULL")) {
        return { rows: [{ id: String(params[0] ?? dealId) }] };
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
}

function jsonResponse(content: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      model: "gpt-4o-mini",
      usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
      choices: [{ message: { content } }],
    }),
    text: async () => "",
  } as any;
}

test("GET /api/v1/deals/:deal_id/report?narrate=1 truncates too-long overview citations.slide_title and still succeeds", async () => {
  const dealId = "00000000-0000-0000-0000-000000000046";

  const originalKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test";

  const originalFetch = globalThis.fetch;
  let call = 0;
  globalThis.fetch = (async () => {
    call++;

    if (call === 1) {
      return jsonResponse(
        JSON.stringify({
          version: "llm_narration_v1",
          summary: "ok",
          sections: [],
          insights: [],
          suggestions: { gaps: [], questions: [] },
          quality_flags: [],
        })
      );
    }

    if (call === 2) {
      return jsonResponse(
        JSON.stringify({
          version: "llm_overview_v1",
          hero_header: "ok",
          deal_summary: { hero: "", mid: "", long: "" },
          investment_analysis_overview: "",
          strengths_overlay: [],
          concerns_overlay: [],
          coverage_gaps_overlay: [],
          citations: [{ page: 1, slide_title: "A".repeat(220) }],
          quality_flags: [],
        })
      );
    }

    return jsonResponse(
      JSON.stringify({
        investment_analysis_overview:
          "Signal: Deterministic evidence appears mixed.\n\nImplication: This may suggest diligence should prioritize validating KPIs.\n\nUncertainty: Confidence is limited because evidence coverage appears sparse.\n\nDecision Tension: The committee would debate what evidence changes conviction.",
      })
    );
  }) as any;

  const app = Fastify();
  await registerReportRoutes(app, buildMockPool(dealId));
  await app.ready();

  const res = await app.inject({ method: "GET", url: `/api/v1/deals/${dealId}/report?narrate=1` });
  assert.equal(res.statusCode, 200, `status=${res.statusCode} body=${res.body}`);

  const body = res.json() as any;
  const overview = body.llm_overview_v1 ?? body.report?.llm_overview_v1;
  assert.ok(overview && typeof overview === "object");
  assert.equal(overview.version, "llm_overview_v1");

  assert.ok(Array.isArray(overview.citations), "expected citations array");
  assert.ok(overview.citations.length >= 1, "expected citations to be preserved");
  const title = overview.citations[0]?.slide_title;
  assert.equal(typeof title, "string");
  assert.ok(title.length <= 160, `expected slide_title <= 160, got ${title.length}`);

  await app.close();
  globalThis.fetch = originalFetch;
  if (originalKey) process.env.OPENAI_API_KEY = originalKey;
  else delete process.env.OPENAI_API_KEY;
});

test("GET /api/v1/deals/:deal_id/report?narrate=1 drops citations if citations cannot be made schema-valid", async () => {
  const dealId = "00000000-0000-0000-0000-000000000047";

  const originalKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test";

  const originalFetch = globalThis.fetch;
  let call = 0;
  globalThis.fetch = (async () => {
    call++;

    if (call === 1) {
      return jsonResponse(
        JSON.stringify({
          version: "llm_narration_v1",
          summary: "ok",
          sections: [],
          insights: [],
          suggestions: { gaps: [], questions: [] },
          quality_flags: [],
        })
      );
    }

    if (call === 2) {
      return jsonResponse(
        JSON.stringify({
          version: "llm_overview_v1",
          hero_header: "ok",
          deal_summary: { hero: "", mid: "", long: "" },
          investment_analysis_overview: "",
          strengths_overlay: [],
          concerns_overlay: [],
          coverage_gaps_overlay: [],
          // Cannot be fixed by truncation alone: schema requires page to be int.
          citations: [{ page: 1.5, slide_title: "Summary" }],
          quality_flags: [],
        })
      );
    }

    return jsonResponse(
      JSON.stringify({
        investment_analysis_overview:
          "Signal: Deterministic evidence appears mixed.\n\nImplication: This may suggest diligence should prioritize validating KPIs.\n\nUncertainty: Confidence is limited because evidence coverage appears sparse.\n\nDecision Tension: The committee would debate what evidence changes conviction.",
      })
    );
  }) as any;

  const app = Fastify();
  await registerReportRoutes(app, buildMockPool(dealId));
  await app.ready();

  const res = await app.inject({ method: "GET", url: `/api/v1/deals/${dealId}/report?narrate=1` });
  assert.equal(res.statusCode, 200, `status=${res.statusCode} body=${res.body}`);

  const body = res.json() as any;
  const overview = body.llm_overview_v1 ?? body.report?.llm_overview_v1;
  assert.ok(overview && typeof overview === "object");
  assert.equal(overview.version, "llm_overview_v1");

  assert.ok(Array.isArray(overview.citations), "expected citations array");
  assert.equal(overview.citations.length, 0, "expected citations to be dropped");

  await app.close();
  globalThis.fetch = originalFetch;
  if (originalKey) process.env.OPENAI_API_KEY = originalKey;
  else delete process.env.OPENAI_API_KEY;
});
