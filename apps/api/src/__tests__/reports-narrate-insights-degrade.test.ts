process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerReportRoutes } from "../routes/reports";
import { closeQueues } from "../lib/queue";

test.after(async () => {
  await closeQueues();
});

test("GET /api/v1/deals/:deal_id/report?narrate=1 selectively drops invalid insights and preserves valid ones", async () => {
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
            summary: "A concise overview based on the provided excerpt.",
            sections: [],
            insights: [
              {
                // Invalid: KPI token (revenue) without a matching deterministic KPI citation.
                // Should be selectively dropped (kpi_token.citation_required).
                title: "Forecast Credibility",
                claim: "This may suggest revenue performance needs further validation before relying on it.",
                tier: "hypothesis",
                confidence: "low",
                evidence_basis: "no_evidence",
                basis: [],
                what_would_change_my_mind: "What I'd need to see next is a cited excerpt that supports or contradicts this interpretation.",
              },
              {
                // Valid: avoid KPI token; same idea phrased without 'revenue' and without numbers.
                title: "Forecast Credibility",
                claim: "This may suggest top-line performance needs further validation before relying on it.",
                tier: "hypothesis",
                confidence: "low",
                evidence_basis: "no_evidence",
                basis: [],
                what_would_change_my_mind: "What I'd need to see next is a cited excerpt that supports or contradicts this interpretation.",
              },
            ],
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

  // Narrated report (should preserve deterministic subtrees).
  const res = await app.inject({ method: "GET", url: `/api/v1/deals/${dealId}/report?narrate=1` });
  assert.equal(res.statusCode, 200, `status=${res.statusCode} body=${res.body}`);
  const body = res.json() as any;

  // 1) Deterministic subtrees must be identical between baseline and narrate.
  assert.deepEqual(body.structured_summary, baselineBody.structured_summary);
  assert.deepEqual(body.promoted_facts ?? null, baselineBody.promoted_facts ?? null);

  const baseMeta = baselineBody.metadata ?? baselineBody.report?.metadata;
  const narrMeta = body.metadata ?? body.report?.metadata;
  assert.ok(baseMeta && typeof baseMeta === "object");
  assert.ok(narrMeta && typeof narrMeta === "object");
  assert.deepEqual(narrMeta.score_explanation ?? null, baseMeta.score_explanation ?? null);

  // 2) Narrated response includes llm_narration_v1.
  const narration = body.llm_narration_v1 ?? body.report?.llm_narration_v1;
  assert.ok(narration && typeof narration === "object");
  assert.equal(narration.version, "llm_narration_v1");

  // 3) insights contains ONLY the valid insight(s).
  assert.ok(Array.isArray(narration.insights), "narration.insights must be an array");
  assert.equal(narration.insights.length, 1);
  assert.equal(narration.insights[0]?.title, "Forecast Credibility");
  assert.ok(
    typeof narration.insights[0]?.claim === "string" && narration.insights[0].claim.includes("top-line performance"),
    `expected preserved insight to use non-KPI phrasing; got: ${JSON.stringify(narration.insights[0]?.claim ?? null)}`
  );

  // 4) metadata.llm_narration_v1_error indicates guard degradation.
  const meta = body.metadata ?? body.report?.metadata;
  assert.ok(meta && typeof meta === "object");
  assert.equal(meta.llm_narration_v1_error?.code, "guard_degraded");

  // 5) dropped_insights increments and violations include the specific failing code/path.
  assert.equal(meta.llm_narration_v1_error?.dropped_insights, 1);
  assert.ok(Array.isArray(meta.llm_narration_v1_error?.violations), "expected violations array");
  assert.ok(
    meta.llm_narration_v1_error.violations.some(
      (v: any) => v?.code === "kpi_token.citation_required" && v?.path === "narration.insights[0].claim"
    ),
    "expected kpi_token.citation_required violation for the invalid (uncited KPI token) insight"
  );

  await app.close();

  globalThis.fetch = originalFetch;
  if (originalKey) process.env.OPENAI_API_KEY = originalKey;
  else delete process.env.OPENAI_API_KEY;
});
