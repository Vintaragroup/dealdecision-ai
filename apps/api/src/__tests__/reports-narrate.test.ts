process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerReportRoutes } from "../routes/reports";
import { closeQueues } from "../lib/queue";

test.after(async () => {
  await closeQueues();
});

test("GET /api/v1/deals/:deal_id/report?narrate=1 omits llm_narration_v1 and records metadata error when OPENAI_API_KEY missing", async () => {
  const dealId = "00000000-0000-0000-0000-000000000042";

  const originalKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;

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

  const res = await app.inject({ method: "GET", url: `/api/v1/deals/${dealId}/report?narrate=1` });
  assert.equal(res.statusCode, 200, `status=${res.statusCode} body=${res.body}`);

  const body = res.json() as any;
  assert.equal(body.ready, true);

  // Narration should be absent on error.
  assert.equal(body.llm_narration_v1 ?? body.report?.llm_narration_v1 ?? null, null);

  const meta = body.metadata ?? body.report?.metadata;
  assert.ok(meta && typeof meta === "object");
  assert.equal(meta.llm_narration_v1_error?.code, "missing_openai_api_key");

  await app.close();
  if (originalKey) process.env.OPENAI_API_KEY = originalKey;
});

test("GET /api/v1/deals/:deal_id/report?narrate=1 attaches llm_narration_v1 when schema + guard pass", async () => {
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
            sections: [
              {
                title: "What stands out",
                body: "The excerpt supports a coherent storyline, with clear product and market framing.",
                what_would_change_my_mind:
                  "What I'd need to see next is a cited excerpt that contradicts the product/market framing.",
                evidence_basis: "no_evidence",
              },
            ],
            insights: [
              {
                title: "Underwriting hypothesis",
                claim: "This may indicate that underwriting should prioritize validating unit economics assumptions.",
                tier: "hypothesis",
                confidence: "low",
                evidence_basis: "no_evidence",
                basis: [],
                what_would_change_my_mind:
                  "What I'd need to see next is a cited excerpt that supports or contradicts the unit economics assumptions.",
              },
            ],
            suggestions: { gaps: [], questions: [] },
            quality_flags: [],
          })
        : (call === 2
          ? JSON.stringify({
              version: "llm_overview_v1",
              hero_header: "Overview based on the excerpt.",
              deal_summary: { hero: "", mid: "", long: "" },
              investment_analysis_overview: "",
              strengths_overlay: [],
              concerns_overlay: [],
              coverage_gaps_overlay: [],
              citations: [{ page: 1, slide_title: "Summary" }],
              quality_flags: [],
            })
          : JSON.stringify({
              investment_analysis_overview:
                "• Signal: Deterministic evidence appears incomplete or mixed.\n\n• Implication: This may suggest the investment case depends on validating key underwriting claims.\n\n• Uncertainty: Confidence is limited because evidence coverage appears sparse.\n\n• Decision Tension: The committee would likely debate what evidence would change conviction next.\n\n• Signal: Deterministic coverage gaps appear to constrain score interpretability.\n\n• Implication: This might indicate the score reflects missing verification rather than business weakness.\n\n• Uncertainty: The downside may be asymmetric if critical unknowns are unresolved.\n\n• Decision Tension: The committee would likely probe which gaps are irreversible vs quickly testable.",
            }));

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
  assert.ok(Array.isArray(narration.insights), "narration.insights must be an array");
  assert.ok(narration.insights.length > 0, "narration.insights must be present when compliant");

  // Sections must always include a non-empty what_would_change_my_mind.
  if (Array.isArray(narration.sections)) {
    for (const [i, s] of narration.sections.entries()) {
      assert.ok(typeof s?.what_would_change_my_mind === "string" && s.what_would_change_my_mind.trim().length > 0, `section[${i}] missing what_would_change_my_mind`);
    }
  }

  // Deterministic subtrees must be identical between baseline and narrate.
  assert.deepEqual(body.structured_summary, baselineBody.structured_summary);
  assert.deepEqual(body.promoted_facts ?? null, baselineBody.promoted_facts ?? null);

  const baseMeta = baselineBody.metadata ?? baselineBody.report?.metadata;
  const narrMeta = body.metadata ?? body.report?.metadata;
  assert.ok(baseMeta && typeof baseMeta === "object");
  assert.ok(narrMeta && typeof narrMeta === "object");
  assert.deepEqual(narrMeta.score_explanation ?? null, baseMeta.score_explanation ?? null);

  const meta = body.metadata ?? body.report?.metadata;
  assert.ok(meta && typeof meta === "object");
  assert.ok(meta.llm_narration_v1_meta);

  const overview = body.llm_overview_v1 ?? body.report?.llm_overview_v1;
  assert.ok(overview && typeof overview === "object");
  assert.equal(overview.version, "llm_overview_v1");
  assert.ok(meta.llm_overview_v1_meta);
  assert.ok(typeof overview.investment_analysis_overview === "string");
  assert.ok(
    overview.investment_analysis_overview.includes("Signal:"),
    `expected reasoning structure in investment_analysis_overview; got: ${JSON.stringify(overview.investment_analysis_overview.slice(0, 240))}; llm_overview_v1_error=${JSON.stringify(meta.llm_overview_v1_error ?? null)}`
  );

  await app.close();

  globalThis.fetch = originalFetch;
  if (originalKey) process.env.OPENAI_API_KEY = originalKey;
  else delete process.env.OPENAI_API_KEY;
});

test("GET /api/v1/deals/:deal_id/report?narrate=1 attaches llm_overview_v1 even when guard degrades it", async () => {
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
            insights: [],
            suggestions: { gaps: [], questions: [] },
            quality_flags: [],
          })
        : (call === 2
          ? JSON.stringify({
              version: "llm_overview_v1",
              hero_header: "Overview based on the excerpt.",
              deal_summary: { hero: "", mid: "", long: "" },
              investment_analysis_overview: "",
              // Intentionally includes a new named entity not present in the deterministic excerpt.
              strengths_overlay: ["Acme Corp is clearly the market leader."],
              concerns_overlay: [],
              coverage_gaps_overlay: [],
              citations: [{ page: 1, slide_title: "Summary" }],
              quality_flags: [],
            })
          : JSON.stringify({
              // Intentionally invalid: missing required structure labels.
              investment_analysis_overview: "This is a conclusion and will definitely work.",
            }));

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

  const baselineRes = await app.inject({ method: "GET", url: `/api/v1/deals/${dealId}/report` });
  assert.equal(baselineRes.statusCode, 200, `status=${baselineRes.statusCode} body=${baselineRes.body}`);
  const baselineBody = baselineRes.json() as any;

  const res = await app.inject({ method: "GET", url: `/api/v1/deals/${dealId}/report?narrate=1` });
  assert.equal(res.statusCode, 200, `status=${res.statusCode} body=${res.body}`);
  const body = res.json() as any;

  // Deterministic subtrees must be identical between baseline and narrate.
  assert.deepEqual(body.structured_summary, baselineBody.structured_summary);
  assert.deepEqual(body.promoted_facts ?? null, baselineBody.promoted_facts ?? null);

  const baseMeta = baselineBody.metadata ?? baselineBody.report?.metadata;
  const narrMeta = body.metadata ?? body.report?.metadata;
  assert.ok(baseMeta && typeof baseMeta === "object");
  assert.ok(narrMeta && typeof narrMeta === "object");
  assert.deepEqual(narrMeta.score_explanation ?? null, baseMeta.score_explanation ?? null);

  const overview = body.llm_overview_v1 ?? body.report?.llm_overview_v1;
  assert.ok(overview && typeof overview === "object");
  assert.equal(overview.version, "llm_overview_v1");

  const meta = body.metadata ?? body.report?.metadata;
  assert.ok(meta && typeof meta === "object");
  assert.equal(meta.llm_overview_v1_error?.code, "guard_degraded");
  assert.ok(Array.isArray(meta.llm_overview_v1_error?.violations), "expected violations array");
  assert.ok(meta.llm_overview_v1_error.violations.length <= 10, "violations must be capped at 10");
  assert.equal(overview.investment_analysis_overview, "", "expected guarded investment_analysis_overview to degrade to empty string");

  await app.close();

  globalThis.fetch = originalFetch;
  if (originalKey) process.env.OPENAI_API_KEY = originalKey;
  else delete process.env.OPENAI_API_KEY;
});

test("GET /api/v1/deals/:deal_id/report?narrate=1 maps truncated JSON output to provider_error:model_output_truncated", async () => {
  const dealId = "00000000-0000-0000-0000-000000000042";

  const originalKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test";

  const originalFetch = globalThis.fetch;
  let call = 0;
  globalThis.fetch = (async () => {
    call++;
    const truncated =
      '{"version":"llm_narration_v1","summary":"ok","sections":[],"insights":[{"title":"t","claim":"c","tier":"restatement","confidence":"low","basis":[{"page":1}';

    const overview = JSON.stringify({
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
        choices: [
          {
            finish_reason: "length",
            message: { content: call === 1 ? truncated : overview },
          },
        ],
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

  const baselineRes = await app.inject({ method: "GET", url: `/api/v1/deals/${dealId}/report` });
  assert.equal(baselineRes.statusCode, 200, `status=${baselineRes.statusCode} body=${baselineRes.body}`);
  const baselineBody = baselineRes.json() as any;

  const res = await app.inject({ method: "GET", url: `/api/v1/deals/${dealId}/report?narrate=1` });
  assert.equal(res.statusCode, 200, `status=${res.statusCode} body=${res.body}`);
  const body = res.json() as any;

  assert.equal(body.llm_narration_v1 ?? body.report?.llm_narration_v1 ?? null, null);

  // Deterministic subtrees must be identical between baseline and narrate.
  assert.deepEqual(body.structured_summary, baselineBody.structured_summary);
  assert.deepEqual(body.promoted_facts ?? null, baselineBody.promoted_facts ?? null);

  const meta = body.metadata ?? body.report?.metadata;
  assert.ok(meta && typeof meta === "object");
  assert.equal(meta.llm_narration_v1_error?.code, "provider_error");
  assert.equal(meta.llm_narration_v1_error?.message, "model_output_truncated");

  await app.close();

  globalThis.fetch = originalFetch;
  if (originalKey) process.env.OPENAI_API_KEY = originalKey;
  else delete process.env.OPENAI_API_KEY;
});
