process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerReportRoutes } from "../routes/reports";
import { closeQueues } from "../lib/queue";

test.after(async () => {
  await closeQueues();
});

test("GET /api/v1/deals/:deal_id/report?narrate=1 attaches llm_narration_v1 when provider output is guard-compliant (KPI cited)", async () => {
  const dealId = "00000000-0000-0000-0000-000000000042";

  const originalKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test";

  const originalFetch = globalThis.fetch;
  let call = 0;
  globalThis.fetch = (async () => {
    call++;
    const content =
      call === 1
        ? JSON.stringify({
            version: "llm_narration_v1",
            // Must be KPI-free (guard disallows KPI terms in summary).
            summary: "A concise overview grounded in the provided excerpt.",
            sections: [
              {
                title: "Traction",
                body: "The materials discuss revenue, supported by the cited source.",
                what_would_change_my_mind: "What I'd need to see next is a cited excerpt that contradicts this interpretation.",
                citations: [{ page: 1, slide_title: "Summary" }],
                evidence_basis: "cited",
              },
              {
                title: "Open questions",
                body: "Further diligence is needed to validate assumptions and risks.",
                what_would_change_my_mind: "What I'd need to see next is a cited excerpt that resolves the open diligence questions.",
                evidence_basis: "no_evidence",
              },
            ],
            insights: [],
            suggestions: { gaps: [], questions: [] },
            quality_flags: [],
          })
        : JSON.stringify({
            version: "llm_overview_v1",
            hero_header: "Overview based on the excerpt.",
            deal_summary: { hero: "", mid: "", long: "" },
            investment_analysis_overview: "",
            strengths_overlay: [],
            concerns_overlay: [],
            coverage_gaps_overlay: [],
            citations: [{ page: 1, slide_title: "Summary" }],
            quality_flags: [],
          });

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
  }) as any;

  const mockPool = {
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

      // Avoid promoted facts + DPU tables.
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

  // Baseline deterministic report.
  const baselineRes = await app.inject({ method: "GET", url: `/api/v1/deals/${dealId}/report` });
  assert.equal(baselineRes.statusCode, 200, `status=${baselineRes.statusCode} body=${baselineRes.body}`);
  const baselineBody = baselineRes.json() as any;

  // Narrated (additive-only) report.
  const res = await app.inject({ method: "GET", url: `/api/v1/deals/${dealId}/report?narrate=1` });
  assert.equal(res.statusCode, 200, `status=${res.statusCode} body=${res.body}`);

  const body = res.json() as any;
  const narration = body.llm_narration_v1 ?? body.report?.llm_narration_v1;
  assert.ok(narration && typeof narration === "object");
  assert.equal(narration.version, "llm_narration_v1");

  if (Array.isArray(narration.sections)) {
    for (const [i, s] of narration.sections.entries()) {
      assert.ok(typeof s?.what_would_change_my_mind === "string" && s.what_would_change_my_mind.trim().length > 0, `section[${i}] missing what_would_change_my_mind`);
    }
  }

  const meta = body.metadata ?? body.report?.metadata;
  assert.ok(meta && typeof meta === "object");
  assert.equal(meta.llm_narration_v1_error ?? null, null);

  // Deterministic subtrees must be identical between baseline and narrate.
  assert.deepEqual(body.structured_summary, baselineBody.structured_summary);
  assert.deepEqual(body.promoted_facts ?? null, baselineBody.promoted_facts ?? null);
  const baseMeta = baselineBody.metadata ?? baselineBody.report?.metadata;
  assert.deepEqual((meta as any).score_explanation ?? null, baseMeta?.score_explanation ?? null);

  await app.close();

  globalThis.fetch = originalFetch;
  if (originalKey) process.env.OPENAI_API_KEY = originalKey;
  else delete process.env.OPENAI_API_KEY;
});

test("GET /api/v1/deals/:deal_id/report?narrate=1 degrades invalid sections instead of omitting narration", async () => {
  const dealId = "00000000-0000-0000-0000-000000000042";

  const originalKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test";

  const originalFetch = globalThis.fetch;
  let call = 0;
  globalThis.fetch = (async () => {
    call++;
    const content =
      call === 1
        ? JSON.stringify({
            version: "llm_narration_v1",
            summary: "A concise overview grounded in the provided excerpt.",
            sections: [
              {
                title: "Valid",
                body: "The materials discuss revenue, supported by the cited source.",
                what_would_change_my_mind: "What I'd need to see next is a cited excerpt that contradicts this interpretation.",
                citations: [{ page: 1, slide_title: "Summary" }],
                evidence_basis: "cited",
              },
              {
                title: "Invalid",
                body: "Acme Corp is clearly the market leader.",
                what_would_change_my_mind: "What I'd need to see next is a cited excerpt that supports this claim.",
                evidence_basis: "cited",
              },
            ],
            insights: [],
            suggestions: { gaps: [], questions: [] },
            quality_flags: [],
          })
        : JSON.stringify({
            version: "llm_overview_v1",
            hero_header: "Overview based on the excerpt.",
            deal_summary: { hero: "", mid: "", long: "" },
            investment_analysis_overview: "",
            strengths_overlay: [],
            concerns_overlay: [],
            coverage_gaps_overlay: [],
            citations: [{ page: 1, slide_title: "Summary" }],
            quality_flags: [],
          });

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
  }) as any;

  const mockPool = {
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

  const app = Fastify();
  await registerReportRoutes(app, mockPool);
  await app.ready();

  const res = await app.inject({ method: "GET", url: `/api/v1/deals/${dealId}/report?narrate=1` });
  assert.equal(res.statusCode, 200, `status=${res.statusCode} body=${res.body}`);
  const body = res.json() as any;

  const narration = body.llm_narration_v1 ?? body.report?.llm_narration_v1;
  assert.ok(narration && typeof narration === "object");
  assert.equal(narration.version, "llm_narration_v1");
  assert.equal(narration.sections?.[0]?.title, "Valid");
  assert.equal(narration.sections?.[1]?.evidence_basis, "no_evidence");
  assert.ok(String(narration.sections?.[1]?.body ?? "").toLowerCase().includes("withheld"));
  assert.ok(typeof narration.sections?.[0]?.what_would_change_my_mind === "string" && narration.sections[0].what_would_change_my_mind.trim().length > 0);
  assert.ok(typeof narration.sections?.[1]?.what_would_change_my_mind === "string" && narration.sections[1].what_would_change_my_mind.trim().length > 0);

  const meta = body.metadata ?? body.report?.metadata;
  assert.ok(meta && typeof meta === "object");
  assert.equal(meta.llm_narration_v1_error?.code, "guard_degraded");

  await app.close();

  globalThis.fetch = originalFetch;
  if (originalKey) process.env.OPENAI_API_KEY = originalKey;
  else delete process.env.OPENAI_API_KEY;
});
