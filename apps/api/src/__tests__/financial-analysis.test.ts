/**
 * financial-analysis.test.ts — API contract tests
 *
 * Tests for POST /api/v1/deals/:deal_id/analysis/financial-analysis endpoint.
 * Uses node:test + Fastify inject. No real database, no real OpenAI calls.
 *
 * Contract guarantees:
 *  1.  400 when deal_id is not a valid UUID
 *  2.  400 when all has_* booleans are false (insufficient_data)
 *  3.  400 when required body fields are missing
 *  4.  404 when deal does not exist
 *  5.  503 when OPENAI_API_KEY is not configured
 *  6.  200 with correct shape on valid input + mocked LLM
 *  7.  200 with implied-only path — response must contain word "implied"
 *  8.  502 when LLM returns placeholder company name
 *  9.  502 when OpenAI returns non-ok HTTP status
 * 10.  502 when LLM returns empty content
 * 11.  502 when LLM returns non-JSON
 * 12.  DB isolation — pool query never touches investor_insights or render_package
 * 13.  200 when optional deal_name is provided
 */

process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerDealRoutes } from "../routes/deals";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DEAL_ID = "c3d4e5f6-2222-0000-0000-000000000003";

function makeMockPool(dealExists = true) {
  return {
    query: async (sql: string, params: unknown[] = []) => {
      if (
        sql.includes("FROM deals") &&
        sql.includes("WHERE id = $1") &&
        sql.includes("deleted_at IS NULL")
      ) {
        return { rows: dealExists ? [{ id: String(params[0] ?? DEAL_ID) }] : [] };
      }
      throw new Error(`[financial-analysis test] Unexpected DB query: ${sql.slice(0, 120)}`);
    },
  } as any;
}

function validFinancialBody(overrides: Partial<{
  deal_name: string;
  layout_coverage_pct: number;
  has_statement: boolean;
  has_implied_allocation: boolean;
  has_health_metrics: boolean;
  revenue_latest: string;
  gross_margin_pct: string;
  total_annual_cost: string;
  reconciliation_confidence: number;
  warn_fail_flags: string[];
  missing_sections: string[];
}> = {}) {
  return {
    has_statement: true,
    has_implied_allocation: false,
    has_health_metrics: true,
    layout_coverage_pct: 65,
    revenue_latest: "$1.2M ARR",
    gross_margin_pct: "72%",
    reconciliation_confidence: 0.8,
    warn_fail_flags: [],
    missing_sections: [],
    ...overrides,
  };
}

function validLlmOutput(overrides: Partial<{
  summary_paragraphs: string[];
  strengths: string[];
  considerations: string[];
}> = {}) {
  return {
    schema_version: "financial_analysis_v1",
    summary_paragraphs: [
      "The company demonstrates strong revenue of $1.2M ARR with healthy 72% gross margins.",
      "Reconciliation confidence is 0.80, indicating consistent financial reporting.",
    ],
    strengths: [
      "High gross margin of 72% well above SaaS benchmarks",
      "Revenue statement corroborated across multiple document sources",
    ],
    considerations: [
      "Burn rate and runway not disclosed in available materials",
      "No detailed balance sheet provided — limited capital structure visibility",
    ],
    ...overrides,
  };
}

function mockLlmResponse(content: unknown) {
  return {
    model: "gpt-4o-mini",
    choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }],
  };
}

// ─── Test 1: invalid UUID ─────────────────────────────────────────────────────

test("financial-analysis: 400 when deal_id is not a UUID", async () => {
  const app = Fastify({ logger: false });
  await registerDealRoutes(app, makeMockPool());
  await app.ready();

  const res = await app.inject({
    method: "POST",
    url: "/api/v1/deals/not-a-uuid/analysis/financial-analysis",
    payload: validFinancialBody(),
    headers: { "content-type": "application/json" },
  });

  assert.equal(res.statusCode, 400, `body=${res.body}`);
  assert.equal(res.json<any>().error, "invalid_deal_id");
  await app.close();
});

// ─── Test 2: all has_* false → insufficient_data ──────────────────────────────

test("financial-analysis: 400 when all has_* booleans are false", async () => {
  const app = Fastify({ logger: false });
  await registerDealRoutes(app, makeMockPool());
  await app.ready();

  const savedKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";

  const res = await app.inject({
    method: "POST",
    url: `/api/v1/deals/${DEAL_ID}/analysis/financial-analysis`,
    payload: validFinancialBody({
      has_statement: false,
      has_implied_allocation: false,
      has_health_metrics: false,
    }),
    headers: { "content-type": "application/json" },
  });

  assert.equal(res.statusCode, 400, `body=${res.body}`);
  assert.equal(res.json<any>().error, "insufficient_data");

  await app.close();
  if (savedKey !== undefined) process.env.OPENAI_API_KEY = savedKey;
  else delete process.env.OPENAI_API_KEY;
});

// ─── Test 3: missing required body fields ────────────────────────────────────

test("financial-analysis: 400 when required body fields are missing", async () => {
  const app = Fastify({ logger: false });
  await registerDealRoutes(app, makeMockPool());
  await app.ready();

  const res = await app.inject({
    method: "POST",
    url: `/api/v1/deals/${DEAL_ID}/analysis/financial-analysis`,
    payload: {},
    headers: { "content-type": "application/json" },
  });

  assert.equal(res.statusCode, 400, `body=${res.body}`);
  await app.close();
});

// ─── Test 4: deal not found ────────────────────────────────────────────────────

test("financial-analysis: 404 when deal does not exist", async () => {
  const app = Fastify({ logger: false });
  await registerDealRoutes(app, makeMockPool(false));
  await app.ready();

  const savedKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";

  const res = await app.inject({
    method: "POST",
    url: `/api/v1/deals/${DEAL_ID}/analysis/financial-analysis`,
    payload: validFinancialBody(),
    headers: { "content-type": "application/json" },
  });

  assert.equal(res.statusCode, 404, `body=${res.body}`);
  assert.equal(res.json<any>().error, "deal_not_found");

  await app.close();
  if (savedKey !== undefined) process.env.OPENAI_API_KEY = savedKey;
  else delete process.env.OPENAI_API_KEY;
});

// ─── Test 5: missing OPENAI_API_KEY ───────────────────────────────────────────

test("financial-analysis: 503 when OPENAI_API_KEY is not set", async () => {
  const app = Fastify({ logger: false });
  await registerDealRoutes(app, makeMockPool());
  await app.ready();

  const savedKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  const res = await app.inject({
    method: "POST",
    url: `/api/v1/deals/${DEAL_ID}/analysis/financial-analysis`,
    payload: validFinancialBody(),
    headers: { "content-type": "application/json" },
  });

  assert.equal(res.statusCode, 503, `body=${res.body}`);
  assert.equal(res.json<any>().error, "llm_unavailable");

  await app.close();
  if (savedKey !== undefined) process.env.OPENAI_API_KEY = savedKey;
});

// ─── Test 6: 200 happy path ───────────────────────────────────────────────────

test("financial-analysis: 200 with correct shape when LLM returns valid JSON", async () => {
  const app = Fastify({ logger: false });
  await registerDealRoutes(app, makeMockPool());
  await app.ready();

  const savedKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true, status: 200,
    json: async () => mockLlmResponse(validLlmOutput()),
    text: async () => "",
  }) as any;

  const res = await app.inject({
    method: "POST",
    url: `/api/v1/deals/${DEAL_ID}/analysis/financial-analysis`,
    payload: validFinancialBody(),
    headers: { "content-type": "application/json" },
  });

  assert.equal(res.statusCode, 200, `body=${res.body}`);
  const body = res.json<any>();

  assert.equal(body.schema_version, "financial_analysis_v1");
  assert.ok(Array.isArray(body.summary_paragraphs), "summary_paragraphs must be an array");
  assert.ok(body.summary_paragraphs.length >= 1, "at least 1 summary paragraph");
  assert.ok(Array.isArray(body.strengths), "strengths must be an array");
  assert.ok(Array.isArray(body.considerations), "considerations must be an array");

  globalThis.fetch = originalFetch;
  await app.close();
  if (savedKey !== undefined) process.env.OPENAI_API_KEY = savedKey;
  else delete process.env.OPENAI_API_KEY;
});

// ─── Test 7: implied-only path — response must contain "implied" ──────────────

test("financial-analysis: 200 implied-only → response must contain word 'implied'", async () => {
  const app = Fastify({ logger: false });
  await registerDealRoutes(app, makeMockPool());
  await app.ready();

  const savedKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";

  // LLM response correctly uses the word "implied" for budget-model-only scenario
  const impliedLlmOut = validLlmOutput({
    summary_paragraphs: [
      "Based on the implied budget model, the company's annual operating cost is approximately $3.2M.",
      "This implied allocation is derived from hiring plans and vendor commitments, not a formal income statement.",
    ],
    strengths: [
      "Implied cost structure aligns with stage-appropriate burn",
      "Budget model provides implied visibility into team scaling plans",
    ],
    considerations: [
      "No formal income statement available — visibility is limited to implied budget",
      "Implied allocation cannot be reconciled against audited financials",
    ],
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true, status: 200,
    json: async () => mockLlmResponse(impliedLlmOut),
    text: async () => "",
  }) as any;

  const res = await app.inject({
    method: "POST",
    url: `/api/v1/deals/${DEAL_ID}/analysis/financial-analysis`,
    // isImpliedOnly = has_implied_allocation && !has_statement
    payload: validFinancialBody({
      has_statement: false,
      has_implied_allocation: true,
      has_health_metrics: false,
      total_annual_cost: "$3.2M",
    }),
    headers: { "content-type": "application/json" },
  });

  assert.equal(res.statusCode, 200, `body=${res.body}`);
  const body = res.json<any>();

  // Verify "implied" appears somewhere in the response text
  const allText = [
    ...body.summary_paragraphs,
    ...body.strengths,
    ...body.considerations,
  ].join(" ").toLowerCase();
  assert.ok(
    allText.includes("implied"),
    `implied-only response must use word "implied" — got: ${allText.slice(0, 200)}`,
  );

  globalThis.fetch = originalFetch;
  await app.close();
  if (savedKey !== undefined) process.env.OPENAI_API_KEY = savedKey;
  else delete process.env.OPENAI_API_KEY;
});

// ─── Test 8: placeholder company name in LLM response → 502 ─────────────────

test("financial-analysis: 502 when LLM returns placeholder company name", async () => {
  const app = Fastify({ logger: false });
  await registerDealRoutes(app, makeMockPool());
  await app.ready();

  const savedKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";

  const placeholderOut = validLlmOutput({
    summary_paragraphs: [
      "Startup Corp demonstrates strong unit economics with 72% gross margins.",
    ],
    strengths: ["Startup Corp has clear revenue visibility"],
    considerations: ["Startup Corp needs to disclose runway"],
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true, status: 200,
    json: async () => mockLlmResponse(placeholderOut),
    text: async () => "",
  }) as any;

  const res = await app.inject({
    method: "POST",
    url: `/api/v1/deals/${DEAL_ID}/analysis/financial-analysis`,
    payload: validFinancialBody(),
    headers: { "content-type": "application/json" },
  });

  assert.equal(res.statusCode, 502, `body=${res.body}`);
  assert.equal(res.json<any>().error, "llm_quality_error");

  globalThis.fetch = originalFetch;
  await app.close();
  if (savedKey !== undefined) process.env.OPENAI_API_KEY = savedKey;
  else delete process.env.OPENAI_API_KEY;
});

// ─── Test 9: OpenAI returns non-ok HTTP ─────────────────────────────────────

test("financial-analysis: 502 when OpenAI returns non-ok HTTP status", async () => {
  const app = Fastify({ logger: false });
  await registerDealRoutes(app, makeMockPool());
  await app.ready();

  const savedKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false, status: 429,
    json: async () => ({}),
    text: async () => "rate limited",
  }) as any;

  const res = await app.inject({
    method: "POST",
    url: `/api/v1/deals/${DEAL_ID}/analysis/financial-analysis`,
    payload: validFinancialBody(),
    headers: { "content-type": "application/json" },
  });

  assert.equal(res.statusCode, 502, `body=${res.body}`);
  assert.equal(res.json<any>().error, "llm_error");

  globalThis.fetch = originalFetch;
  await app.close();
  if (savedKey !== undefined) process.env.OPENAI_API_KEY = savedKey;
  else delete process.env.OPENAI_API_KEY;
});

// ─── Test 10: LLM returns empty content ──────────────────────────────────────

test("financial-analysis: 502 when LLM returns empty content", async () => {
  const app = Fastify({ logger: false });
  await registerDealRoutes(app, makeMockPool());
  await app.ready();

  const savedKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true, status: 200,
    json: async () => ({ model: "gpt-4o-mini", choices: [{ message: { content: "" } }] }),
    text: async () => "",
  }) as any;

  const res = await app.inject({
    method: "POST",
    url: `/api/v1/deals/${DEAL_ID}/analysis/financial-analysis`,
    payload: validFinancialBody(),
    headers: { "content-type": "application/json" },
  });

  assert.equal(res.statusCode, 502, `body=${res.body}`);
  assert.equal(res.json<any>().error, "llm_empty_response");

  globalThis.fetch = originalFetch;
  await app.close();
  if (savedKey !== undefined) process.env.OPENAI_API_KEY = savedKey;
  else delete process.env.OPENAI_API_KEY;
});

// ─── Test 11: LLM returns non-JSON ────────────────────────────────────────────

test("financial-analysis: 502 when LLM returns non-JSON content", async () => {
  const app = Fastify({ logger: false });
  await registerDealRoutes(app, makeMockPool());
  await app.ready();

  const savedKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true, status: 200,
    json: async () => ({
      model: "gpt-4o-mini",
      choices: [{ message: { content: "I cannot summarize financial data for this company." } }],
    }),
    text: async () => "",
  }) as any;

  const res = await app.inject({
    method: "POST",
    url: `/api/v1/deals/${DEAL_ID}/analysis/financial-analysis`,
    payload: validFinancialBody(),
    headers: { "content-type": "application/json" },
  });

  assert.equal(res.statusCode, 502, `body=${res.body}`);
  assert.equal(res.json<any>().error, "llm_parse_error");

  globalThis.fetch = originalFetch;
  await app.close();
  if (savedKey !== undefined) process.env.OPENAI_API_KEY = savedKey;
  else delete process.env.OPENAI_API_KEY;
});

// ─── Test 12: DB isolation ────────────────────────────────────────────────────

test("financial-analysis: pool query never references investor_insights or render_package", async () => {
  const queriedSqls: string[] = [];
  const isolationPool = {
    query: async (sql: string, params: unknown[] = []) => {
      queriedSqls.push(sql);
      if (
        sql.includes("FROM deals") &&
        sql.includes("WHERE id = $1") &&
        sql.includes("deleted_at IS NULL")
      ) {
        return { rows: [{ id: DEAL_ID }] };
      }
      throw new Error(`[financial isolation] Unexpected: ${sql.slice(0, 120)}`);
    },
  } as any;

  const app = Fastify({ logger: false });
  await registerDealRoutes(app, isolationPool);
  await app.ready();

  const savedKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true, status: 200,
    json: async () => mockLlmResponse(validLlmOutput()),
    text: async () => "",
  }) as any;

  await app.inject({
    method: "POST",
    url: `/api/v1/deals/${DEAL_ID}/analysis/financial-analysis`,
    payload: validFinancialBody(),
    headers: { "content-type": "application/json" },
  });

  const forbidden = ["investor_insights", "render_package", "governed_", "investor_insight_sections"];
  for (const sql of queriedSqls) {
    for (const kw of forbidden) {
      assert.ok(
        !sql.toLowerCase().includes(kw.toLowerCase()),
        `Must not reference "${kw}": ${sql.slice(0, 100)}`,
      );
    }
  }

  globalThis.fetch = originalFetch;
  await app.close();
  if (savedKey !== undefined) process.env.OPENAI_API_KEY = savedKey;
  else delete process.env.OPENAI_API_KEY;
});

// ─── Test 13: optional deal_name ─────────────────────────────────────────────

test("financial-analysis: 200 when optional deal_name is provided", async () => {
  const app = Fastify({ logger: false });
  await registerDealRoutes(app, makeMockPool());
  await app.ready();

  const savedKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true, status: 200,
    json: async () => mockLlmResponse(validLlmOutput()),
    text: async () => "",
  }) as any;

  const res = await app.inject({
    method: "POST",
    url: `/api/v1/deals/${DEAL_ID}/analysis/financial-analysis`,
    payload: validFinancialBody({ deal_name: "AcmeCorp" }),
    headers: { "content-type": "application/json" },
  });

  assert.equal(res.statusCode, 200, `body=${res.body}`);
  assert.equal(res.json<any>().schema_version, "financial_analysis_v1");

  globalThis.fetch = originalFetch;
  await app.close();
  if (savedKey !== undefined) process.env.OPENAI_API_KEY = savedKey;
  else delete process.env.OPENAI_API_KEY;
});

// ─── Test 14: deck-only — 200 when no xlsx but deck_financial_signals present ───

test("financial-analysis: 200 when no XLSX data but deck_financial_signals present (PDF-only deal)", async () => {
  const app = Fastify({ logger: false });
  await registerDealRoutes(app, makeMockPool());
  await app.ready();

  const savedKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true, status: 200,
    json: async () => mockLlmResponse(validLlmOutput({
      summary_paragraphs: [
        "Revenue signals were identified in the pitch deck narrative.",
        "Burn rate is not disclosed in the available materials.",
      ],
      strengths: ["Revenue traction referenced in deck ($1.2M ARR)"],
      considerations: ["No structured financials available — deck signals only"],
    })),
    text: async () => "",
  }) as any;

  const res = await app.inject({
    method: "POST",
    url: `/api/v1/deals/${DEAL_ID}/analysis/financial-analysis`,
    payload: {
      // All XLSX flags false (PDF-only deal)
      has_statement: false,
      has_implied_allocation: false,
      has_health_metrics: false,
      layout_coverage_pct: 0,
      warn_fail_flags: [],
      missing_sections: [],
      // Deck signal flags
      has_deck_signals: true,
      deck_has_revenue: true,
      deck_has_arr_mrr: true,
      deck_has_burn: false,
      deck_has_runway: false,
      deck_has_unit_economics: false,
      deck_revenue_snippets: ["$1.2M ARR", "growing 50% YoY"],
      deck_burn_snippets: [],
      deck_pages_scanned: 18,
    },
    headers: { "content-type": "application/json" },
  });

  assert.equal(res.statusCode, 200, `body=${res.body}`);
  assert.equal(res.json<any>().schema_version, "financial_analysis_v1");

  globalThis.fetch = originalFetch;
  await app.close();
  if (savedKey !== undefined) process.env.OPENAI_API_KEY = savedKey;
  else delete process.env.OPENAI_API_KEY;
});

// ─── Test 15: deck-only — 400 when deck signals present but all deck_has_* false ───

test("financial-analysis: 400 (insufficient_data) when deck signals present but all deck_has_* are false", async () => {
  const app = Fastify({ logger: false });
  await registerDealRoutes(app, makeMockPool());
  await app.ready();

  const savedKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";

  const res = await app.inject({
    method: "POST",
    url: `/api/v1/deals/${DEAL_ID}/analysis/financial-analysis`,
    payload: {
      has_statement: false,
      has_implied_allocation: false,
      has_health_metrics: false,
      layout_coverage_pct: 0,
      warn_fail_flags: [],
      missing_sections: [],
      // has_deck_signals true but no meaningful signals
      has_deck_signals: true,
      deck_has_revenue: false,
      deck_has_arr_mrr: false,
      deck_has_burn: false,
      deck_has_runway: false,
      deck_has_unit_economics: false,
      deck_revenue_snippets: [],
      deck_burn_snippets: [],
      deck_pages_scanned: 5,
    },
    headers: { "content-type": "application/json" },
  });

  assert.equal(res.statusCode, 400, `body=${res.body}`);
  assert.equal(res.json<any>().error, "insufficient_data");

  await app.close();
  if (savedKey !== undefined) process.env.OPENAI_API_KEY = savedKey;
  else delete process.env.OPENAI_API_KEY;
});
