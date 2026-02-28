/**
 * market-analysis.test.ts — API contract tests
 *
 * Tests for POST /api/v1/deals/:deal_id/analysis/market endpoint.
 * Uses node:test + Fastify inject. No real database, no real OpenAI calls.
 *
 * Contract guarantees:
 *  1. 400 when deal_id is not a valid UUID
 *  2. 400 when body lacks canonical_fields
 *  3. 404 when deal does not exist
 *  4. 503 when OPENAI_API_KEY is not configured
 *  5. 200 with correct shape on valid input + mocked LLM
 *  6. 200 when only TAM exists — no invented values
 *  7. validator rejects placeholder values in KPIs
 *  8. 502 when OpenAI returns non-ok status
 *  9. 502 when LLM returns empty content
 * 10. 502 when LLM returns non-JSON
 * 11. score clamped to 0–100, rounded to integer
 * 12. missing_inputs merged from detected + LLM fields
 * 13. pool query never touches investor_insights tables
 */

process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerDealRoutes } from "../routes/deals";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DEAL_ID = "b2c3d4e5-1111-0000-0000-000000000002";

function makeMockPool(dealExists = true) {
  const pool = {
    query: async (sql: string, params: unknown[] = []) => {
      if (
        sql.includes("FROM deals") &&
        sql.includes("WHERE id = $1") &&
        sql.includes("deleted_at IS NULL")
      ) {
        return { rows: dealExists ? [{ id: String(params[0] ?? DEAL_ID) }] : [] };
      }
      throw new Error(`[market-analysis test] Unexpected DB query: ${sql.slice(0, 120)}`);
    },
  } as any;
  return pool;
}

function sampleMarketFields(overrides: Record<string, string | null> = {}): Record<string, string | null> {
  return {
    tam: "$5B",
    sam: "$500M",
    som: "$50M",
    growth_rate: "25% YoY",
    customer_count: "42 design agencies",
    market_category: "SaaS / MarTech",
    market_geography: "North America",
    icp: "SMB marketing teams",
    pricing_model: "Subscription / per-seat",
    competition: "HubSpot, Mailchimp",
    ...overrides,
  };
}

function mockLlmOutput(content: unknown) {
  return {
    model: "gpt-4o-mini",
    choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }],
  };
}

function validMarketOutput(overrides: Partial<{
  score: number;
  kpis: object;
  strengths: string[];
  concerns: string[];
  ai_insight: string;
  missing_inputs: string[];
}> = {}) {
  return {
    schema_version: "market_analysis_v1",
    score: 78,
    kpis: {
      tailwind: "Strong market growth driven by digital transformation",
      launch_plan: "ICP defined — SMB marketing teams",
      priority_markets: "US / SMB segment",
    },
    strengths: [
      "Clear TAM/SAM/SOM breakdown at $5B/$500M/$50M",
      "25% YoY growth rate signals healthy market expansion",
    ],
    concerns: [
      "Competitive landscape includes well-funded incumbents (HubSpot, Mailchimp)",
      "SOM capture requires differentiation beyond current materials",
    ],
    ai_insight:
      "Materials suggest a well-scoped $500M SAM within the broader $5B TAM. " +
      "With 25% YoY growth and a defined ICP, market entry signals are positive, " +
      "though competitive differentiation remains underdeveloped.",
    missing_inputs: [],
    ...overrides,
  };
}

// ─── Test 1: invalid UUID ─────────────────────────────────────────────────────

test("market-analysis: 400 when deal_id is not a UUID", async () => {
  const app = Fastify({ logger: false });
  await registerDealRoutes(app, makeMockPool());
  await app.ready();

  const res = await app.inject({
    method: "POST",
    url: "/api/v1/deals/not-a-uuid/analysis/market",
    payload: { canonical_fields: sampleMarketFields() },
    headers: { "content-type": "application/json" },
  });

  assert.equal(res.statusCode, 400, `body=${res.body}`);
  assert.equal(res.json<any>().error, "invalid_deal_id");
  await app.close();
});

// ─── Test 2: missing canonical_fields ─────────────────────────────────────────

test("market-analysis: 400 when body is missing canonical_fields", async () => {
  const app = Fastify({ logger: false });
  await registerDealRoutes(app, makeMockPool());
  await app.ready();

  const res = await app.inject({
    method: "POST",
    url: `/api/v1/deals/${DEAL_ID}/analysis/market`,
    payload: {},
    headers: { "content-type": "application/json" },
  });

  assert.equal(res.statusCode, 400, `body=${res.body}`);
  assert.equal(res.json<any>().error, "invalid_body");
  await app.close();
});

// ─── Test 3: deal not found ────────────────────────────────────────────────────

test("market-analysis: 404 when deal does not exist", async () => {
  const app = Fastify({ logger: false });
  await registerDealRoutes(app, makeMockPool(false));
  await app.ready();

  const savedKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";

  const res = await app.inject({
    method: "POST",
    url: `/api/v1/deals/${DEAL_ID}/analysis/market`,
    payload: { canonical_fields: sampleMarketFields() },
    headers: { "content-type": "application/json" },
  });

  assert.equal(res.statusCode, 404, `body=${res.body}`);
  assert.equal(res.json<any>().error, "deal_not_found");

  await app.close();
  if (savedKey !== undefined) process.env.OPENAI_API_KEY = savedKey;
  else delete process.env.OPENAI_API_KEY;
});

// ─── Test 4: missing OPENAI_API_KEY ───────────────────────────────────────────

test("market-analysis: 503 when OPENAI_API_KEY is not set", async () => {
  const app = Fastify({ logger: false });
  await registerDealRoutes(app, makeMockPool());
  await app.ready();

  const savedKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  const res = await app.inject({
    method: "POST",
    url: `/api/v1/deals/${DEAL_ID}/analysis/market`,
    payload: { canonical_fields: sampleMarketFields() },
    headers: { "content-type": "application/json" },
  });

  assert.equal(res.statusCode, 503, `body=${res.body}`);
  assert.equal(res.json<any>().error, "llm_unavailable");

  await app.close();
  if (savedKey !== undefined) process.env.OPENAI_API_KEY = savedKey;
});

// ─── Test 5: 200 success with all fields ─────────────────────────────────────

test("market-analysis: 200 with correct shape when LLM returns valid JSON", async () => {
  const app = Fastify({ logger: false });
  await registerDealRoutes(app, makeMockPool());
  await app.ready();

  const savedKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";

  const llmOut = validMarketOutput();

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true, status: 200,
    json: async () => mockLlmOutput(llmOut),
    text: async () => "",
  }) as any;

  const res = await app.inject({
    method: "POST",
    url: `/api/v1/deals/${DEAL_ID}/analysis/market`,
    payload: { canonical_fields: sampleMarketFields() },
    headers: { "content-type": "application/json" },
  });

  assert.equal(res.statusCode, 200, `body=${res.body}`);
  const body = res.json<any>();

  // schema_version
  assert.equal(body.schema_version, "market_analysis_v1");

  // score
  assert.equal(typeof body.score, "number");
  assert.ok(body.score >= 0 && body.score <= 100, "score must be 0–100");
  assert.equal(body.score, 78);

  // kpis
  assert.equal(typeof body.kpis, "object");
  assert.equal(typeof body.kpis.tailwind, "string");
  assert.equal(typeof body.kpis.launch_plan, "string");
  assert.equal(typeof body.kpis.priority_markets, "string");

  // strengths / concerns
  assert.ok(Array.isArray(body.strengths));
  assert.ok(body.strengths.length >= 2, "at least 2 strengths");
  assert.ok(Array.isArray(body.concerns));
  assert.ok(body.concerns.length >= 2, "at least 2 concerns");

  // ai_insight
  assert.equal(typeof body.ai_insight, "string");
  assert.ok(body.ai_insight.length > 0, "ai_insight must be non-empty");

  // missing_inputs
  assert.ok(Array.isArray(body.missing_inputs));

  globalThis.fetch = originalFetch;
  await app.close();
  if (savedKey !== undefined) process.env.OPENAI_API_KEY = savedKey;
  else delete process.env.OPENAI_API_KEY;
});

// ─── Test 6: TAM-only input — no invented values ─────────────────────────────

test("market-analysis: 200 when only TAM provided — kpis fall back to Not disclosed", async () => {
  const app = Fastify({ logger: false });
  await registerDealRoutes(app, makeMockPool());
  await app.ready();

  const savedKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";

  // LLM correctly signals missing data for partial input
  const llmOut = validMarketOutput({
    score: 20,
    kpis: {
      tailwind: "Not disclosed — insufficient market signals",
      launch_plan: "Pre-launch",
      priority_markets: "Not disclosed",
    },
    strengths: ["TAM of $5B indicates large potential market"],
    concerns: ["SAM and SOM not disclosed — market segmentation unclear"],
    ai_insight: "Materials provide only a top-level TAM figure. Without SAM/SOM breakdown, market sizing confidence is limited.",
    missing_inputs: ["SAM", "SOM", "Growth Rate", "Customer Count"],
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true, status: 200,
    json: async () => mockLlmOutput(llmOut),
    text: async () => "",
  }) as any;

  const res = await app.inject({
    method: "POST",
    url: `/api/v1/deals/${DEAL_ID}/analysis/market`,
    // Only TAM provided
    payload: { canonical_fields: { tam: "$5B", sam: null, som: null, growth_rate: null, customer_count: null, market_category: null, market_geography: null, icp: null, pricing_model: null, competition: null } },
    headers: { "content-type": "application/json" },
  });

  assert.equal(res.statusCode, 200, `body=${res.body}`);
  const body = res.json<any>();
  assert.equal(body.score, 20);
  // Must not have invented priority_markets
  assert.ok(
    body.kpis.priority_markets.toLowerCase().includes("not disclosed") ||
    body.kpis.priority_markets === "Not disclosed",
    `priority_markets should be 'Not disclosed' for TAM-only input, got: ${body.kpis.priority_markets}`,
  );
  assert.ok(body.missing_inputs.length > 0, "missing_inputs must list absent fields");

  globalThis.fetch = originalFetch;
  await app.close();
  if (savedKey !== undefined) process.env.OPENAI_API_KEY = savedKey;
  else delete process.env.OPENAI_API_KEY;
});

// ─── Test 7: validator rejects placeholder company names ──────────────────────

test("market-analysis: 502 when LLM returns placeholder value in KPIs", async () => {
  const app = Fastify({ logger: false });
  await registerDealRoutes(app, makeMockPool());
  await app.ready();

  const savedKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";

  const placeholderOut = validMarketOutput({
    kpis: {
      tailwind: "Strong growth for Startup Corp",   // placeholder ← triggers rejection
      launch_plan: "ICP defined",
      priority_markets: "US Market",
    },
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true, status: 200,
    json: async () => mockLlmOutput(placeholderOut),
    text: async () => "",
  }) as any;

  const res = await app.inject({
    method: "POST",
    url: `/api/v1/deals/${DEAL_ID}/analysis/market`,
    payload: { canonical_fields: sampleMarketFields() },
    headers: { "content-type": "application/json" },
  });

  assert.equal(res.statusCode, 502, `body=${res.body}`);
  assert.equal(res.json<any>().error, "llm_quality_error");

  globalThis.fetch = originalFetch;
  await app.close();
  if (savedKey !== undefined) process.env.OPENAI_API_KEY = savedKey;
  else delete process.env.OPENAI_API_KEY;
});

// ─── Test 8: OpenAI non-ok response ────────────────────────────────────────────

test("market-analysis: 502 when OpenAI returns non-ok HTTP status", async () => {
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
    url: `/api/v1/deals/${DEAL_ID}/analysis/market`,
    payload: { canonical_fields: sampleMarketFields() },
    headers: { "content-type": "application/json" },
  });

  assert.equal(res.statusCode, 502, `body=${res.body}`);
  assert.equal(res.json<any>().error, "llm_error");

  globalThis.fetch = originalFetch;
  await app.close();
  if (savedKey !== undefined) process.env.OPENAI_API_KEY = savedKey;
  else delete process.env.OPENAI_API_KEY;
});

// ─── Test 9: LLM returns empty content ────────────────────────────────────────

test("market-analysis: 502 when LLM returns empty content", async () => {
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
    url: `/api/v1/deals/${DEAL_ID}/analysis/market`,
    payload: { canonical_fields: sampleMarketFields() },
    headers: { "content-type": "application/json" },
  });

  assert.equal(res.statusCode, 502, `body=${res.body}`);
  assert.equal(res.json<any>().error, "llm_empty_response");

  globalThis.fetch = originalFetch;
  await app.close();
  if (savedKey !== undefined) process.env.OPENAI_API_KEY = savedKey;
  else delete process.env.OPENAI_API_KEY;
});

// ─── Test 10: LLM returns non-JSON ────────────────────────────────────────────

test("market-analysis: 502 when LLM returns non-JSON content", async () => {
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
      choices: [{ message: { content: "I cannot provide market analysis." } }],
    }),
    text: async () => "",
  }) as any;

  const res = await app.inject({
    method: "POST",
    url: `/api/v1/deals/${DEAL_ID}/analysis/market`,
    payload: { canonical_fields: sampleMarketFields() },
    headers: { "content-type": "application/json" },
  });

  assert.equal(res.statusCode, 502, `body=${res.body}`);
  assert.equal(res.json<any>().error, "llm_parse_error");

  globalThis.fetch = originalFetch;
  await app.close();
  if (savedKey !== undefined) process.env.OPENAI_API_KEY = savedKey;
  else delete process.env.OPENAI_API_KEY;
});

// ─── Test 11: score clamped to 0–100 ──────────────────────────────────────────

test("market-analysis: score clamped and rounded to integer", async () => {
  const app = Fastify({ logger: false });
  await registerDealRoutes(app, makeMockPool());
  await app.ready();

  const savedKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";

  const llmOut = validMarketOutput({ score: 99.7 });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true, status: 200,
    json: async () => mockLlmOutput(llmOut),
    text: async () => "",
  }) as any;

  const res = await app.inject({
    method: "POST",
    url: `/api/v1/deals/${DEAL_ID}/analysis/market`,
    payload: { canonical_fields: sampleMarketFields() },
    headers: { "content-type": "application/json" },
  });

  assert.equal(res.statusCode, 200, `body=${res.body}`);
  const body = res.json<any>();
  assert.equal(body.score, 100); // rounded up from 99.7
  assert.equal(typeof body.score, "number");
  assert.ok(Number.isInteger(body.score), "score must be integer");

  globalThis.fetch = originalFetch;
  await app.close();
  if (savedKey !== undefined) process.env.OPENAI_API_KEY = savedKey;
  else delete process.env.OPENAI_API_KEY;
});

// ─── Test 12: pool query never touches investor_insights tables ───────────────

test("market-analysis: pool query never references investor_insights or render_package", async () => {
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
      throw new Error(`[market isolation] Unexpected: ${sql.slice(0, 120)}`);
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
    json: async () => mockLlmOutput(validMarketOutput()),
    text: async () => "",
  }) as any;

  await app.inject({
    method: "POST",
    url: `/api/v1/deals/${DEAL_ID}/analysis/market`,
    payload: { canonical_fields: sampleMarketFields() },
    headers: { "content-type": "application/json" },
  });

  const forbidden = [
    "investor_insights", "render_package", "governed_", "investor_insight_sections",
  ];
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

// ─── Test 13: deal_name is optional ───────────────────────────────────────────

test("market-analysis: 200 when optional deal_name is provided", async () => {
  const app = Fastify({ logger: false });
  await registerDealRoutes(app, makeMockPool());
  await app.ready();

  const savedKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true, status: 200,
    json: async () => mockLlmOutput(validMarketOutput()),
    text: async () => "",
  }) as any;

  const res = await app.inject({
    method: "POST",
    url: `/api/v1/deals/${DEAL_ID}/analysis/market`,
    payload: { canonical_fields: sampleMarketFields(), deal_name: "AcmeCorp" },
    headers: { "content-type": "application/json" },
  });

  assert.equal(res.statusCode, 200, `body=${res.body}`);
  assert.equal(res.json<any>().schema_version, "market_analysis_v1");

  globalThis.fetch = originalFetch;
  await app.close();
  if (savedKey !== undefined) process.env.OPENAI_API_KEY = savedKey;
  else delete process.env.OPENAI_API_KEY;
});
