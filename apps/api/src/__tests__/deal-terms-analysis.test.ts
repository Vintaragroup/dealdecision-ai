/**
 * deal-terms-analysis.test.ts — Phase 2 API contract tests
 *
 * Tests the POST /api/v1/deals/:deal_id/analysis/deal-terms endpoint in
 * isolation using node:test + Fastify inject.  No real database, no real
 * OpenAI calls.
 *
 * Contract guarantees:
 *  1. 400 when deal_id is not a valid UUID
 *  2. 400 when body lacks canonical_fields
 *  3. 404 when deal does not exist in database
 *  4. 503 when OPENAI_API_KEY is not configured
 *  5. 200 with correct shape on valid input + mocked LLM response
 *  6. assessment levels normalised to "High"|"Medium"|"Low" (unknown → "Low")
 *  7. 502 when OpenAI returns a non-ok status
 *  8. 502 when LLM returns empty content
 *  9. 502 when LLM returns non-JSON content
 * 10. Pool query NEVER touches investor_insights / render_package tables
 */

// Prevent queue initialisation failures in environments without Redis.
process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerDealRoutes } from "../routes/deals";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DEAL_ID = "a1b2c3d4-0000-0000-0000-000000000001";

/** Returns a pool mock that correctly handles only the deals-existence query. */
function makeMockPool(dealExists: boolean = true) {
  const queriedTables: string[] = [];

  const pool = {
    query: async (sql: string, params: unknown[] = []) => {
      queriedTables.push(sql);

      // The ONLY query the deal-terms endpoint issues
      if (
        sql.includes("FROM deals") &&
        sql.includes("WHERE id = $1") &&
        sql.includes("deleted_at IS NULL")
      ) {
        return { rows: dealExists ? [{ id: String(params[0] ?? DEAL_ID) }] : [] };
      }

      throw new Error(`[deal-terms test] Unexpected DB query: ${sql.slice(0, 120)}`);
    },
    // Expose queried tables for inspection in tests
    _queriedTables: queriedTables,
  } as any;

  return pool;
}

/** Minimal valid canonical_fields payload */
function sampleFields(overrides: Record<string, string | null> = {}): Record<string, string | null> {
  return {
    raise_amount: "$2M",
    raise_round: "Seed",
    raise_instrument: "Priced equity",
    raise_cap: null,
    raise_discount: null,
    note_interest_rate: null,
    note_maturity: null,
    valuation_pre: "$10M",
    valuation_post: "$12M",
    valuation_safe_cap: null,
    ...overrides,
  };
}

/** Mock OpenAI JSON response with controlled LLM output. */
function mockLlmOutput(content: unknown) {
  return {
    model: "gpt-4o-mini",
    choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }],
  };
}

// ─── Test 1: invalid UUID ─────────────────────────────────────────────────────

test("400 when deal_id is not a UUID", async () => {
  const app = Fastify({ logger: false });
  await registerDealRoutes(app, makeMockPool());
  await app.ready();

  const res = await app.inject({
    method: "POST",
    url: "/api/v1/deals/not-a-uuid/analysis/deal-terms",
    payload: { canonical_fields: sampleFields() },
    headers: { "content-type": "application/json" },
  });

  assert.equal(res.statusCode, 400, `body=${res.body}`);
  const body = res.json() as any;
  assert.equal(body.error, "invalid_deal_id");

  await app.close();
});

// ─── Test 2: missing canonical_fields ─────────────────────────────────────────

test("400 when body is missing canonical_fields", async () => {
  const app = Fastify({ logger: false });
  await registerDealRoutes(app, makeMockPool());
  await app.ready();

  const res = await app.inject({
    method: "POST",
    url: `/api/v1/deals/${DEAL_ID}/analysis/deal-terms`,
    payload: {},
    headers: { "content-type": "application/json" },
  });

  assert.equal(res.statusCode, 400, `body=${res.body}`);
  const body = res.json() as any;
  assert.equal(body.error, "invalid_body");

  await app.close();
});

test("400 when canonical_fields is not an object", async () => {
  const app = Fastify({ logger: false });
  await registerDealRoutes(app, makeMockPool());
  await app.ready();

  const res = await app.inject({
    method: "POST",
    url: `/api/v1/deals/${DEAL_ID}/analysis/deal-terms`,
    payload: { canonical_fields: "not-an-object" },
    headers: { "content-type": "application/json" },
  });

  assert.equal(res.statusCode, 400, `body=${res.body}`);
  const body = res.json() as any;
  assert.equal(body.error, "invalid_body");

  await app.close();
});

// ─── Test 3: deal not found ────────────────────────────────────────────────────

test("404 when deal does not exist", async () => {
  const app = Fastify({ logger: false });
  await registerDealRoutes(app, makeMockPool(false));
  await app.ready();

  const savedKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";

  const res = await app.inject({
    method: "POST",
    url: `/api/v1/deals/${DEAL_ID}/analysis/deal-terms`,
    payload: { canonical_fields: sampleFields() },
    headers: { "content-type": "application/json" },
  });

  assert.equal(res.statusCode, 404, `body=${res.body}`);
  const body = res.json() as any;
  assert.equal(body.error, "deal_not_found");

  await app.close();
  if (savedKey !== undefined) process.env.OPENAI_API_KEY = savedKey;
  else delete process.env.OPENAI_API_KEY;
});

// ─── Test 4: missing OPENAI_API_KEY ───────────────────────────────────────────

test("503 when OPENAI_API_KEY is not set", async () => {
  const app = Fastify({ logger: false });
  await registerDealRoutes(app, makeMockPool());
  await app.ready();

  const savedKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  const res = await app.inject({
    method: "POST",
    url: `/api/v1/deals/${DEAL_ID}/analysis/deal-terms`,
    payload: { canonical_fields: sampleFields() },
    headers: { "content-type": "application/json" },
  });

  assert.equal(res.statusCode, 503, `body=${res.body}`);
  const body = res.json() as any;
  assert.equal(body.error, "llm_unavailable");

  await app.close();
  if (savedKey !== undefined) process.env.OPENAI_API_KEY = savedKey;
});

// ─── Test 5: 200 success with mocked LLM ──────────────────────────────────────

test("200 with correct shape when LLM returns valid JSON", async () => {
  const app = Fastify({ logger: false });
  const mockPool = makeMockPool();
  await registerDealRoutes(app, mockPool);
  await app.ready();

  const savedKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";

  const expectedOutput = {
    structure_summary:
      "The company is raising $2M on a priced seed round at a $10M pre-money valuation. " +
      "Note interest rate and maturity are not disclosed.",
    structure_assessment: {
      simplicity: "High",
      dilution_visibility: "High",
      valuation_clarity: "High",
      downside_protection: "Low",
    },
    missing_terms: ["note interest rate", "note maturity"],
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url: any, _opts: any) => ({
    ok: true,
    status: 200,
    json: async () => mockLlmOutput(expectedOutput),
    text: async () => "",
  }) as any;

  const res = await app.inject({
    method: "POST",
    url: `/api/v1/deals/${DEAL_ID}/analysis/deal-terms`,
    payload: { canonical_fields: sampleFields() },
    headers: { "content-type": "application/json" },
  });

  assert.equal(res.statusCode, 200, `body=${res.body}`);
  const body = res.json() as any;

  // Shape check
  assert.equal(typeof body.structure_summary, "string");
  assert.ok(body.structure_summary.length > 0, "structure_summary must be non-empty");
  assert.equal(typeof body.structure_assessment, "object");
  assert.ok(["High", "Medium", "Low"].includes(body.structure_assessment.simplicity));
  assert.ok(["High", "Medium", "Low"].includes(body.structure_assessment.dilution_visibility));
  assert.ok(["High", "Medium", "Low"].includes(body.structure_assessment.valuation_clarity));
  assert.ok(["High", "Medium", "Low"].includes(body.structure_assessment.downside_protection));
  assert.ok(Array.isArray(body.missing_terms));

  // Value check
  assert.equal(body.structure_assessment.simplicity, "High");
  assert.equal(body.structure_assessment.downside_protection, "Low");
  assert.deepEqual(body.missing_terms, ["note interest rate", "note maturity"]);

  globalThis.fetch = originalFetch;
  await app.close();
  if (savedKey !== undefined) process.env.OPENAI_API_KEY = savedKey;
  else delete process.env.OPENAI_API_KEY;
});

// ─── Test 6: level normalisation ──────────────────────────────────────────────

test("normalises unknown assessment levels to Low", async () => {
  const app = Fastify({ logger: false });
  await registerDealRoutes(app, makeMockPool());
  await app.ready();

  const savedKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";

  const badLlmOutput = {
    structure_summary: "The company is raising capital.",
    structure_assessment: {
      simplicity: "Excellent",     // invalid → Low
      dilution_visibility: "N/A",  // invalid → Low
      valuation_clarity: "High",   // valid
      downside_protection: "",     // invalid → Low
    },
    missing_terms: [],
  };

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => mockLlmOutput(badLlmOutput),
    text: async () => "",
  }) as any;

  const res = await app.inject({
    method: "POST",
    url: `/api/v1/deals/${DEAL_ID}/analysis/deal-terms`,
    payload: { canonical_fields: sampleFields() },
    headers: { "content-type": "application/json" },
  });

  assert.equal(res.statusCode, 200, `body=${res.body}`);
  const body = res.json() as any;
  assert.equal(body.structure_assessment.simplicity, "Low");
  assert.equal(body.structure_assessment.dilution_visibility, "Low");
  assert.equal(body.structure_assessment.valuation_clarity, "High");
  assert.equal(body.structure_assessment.downside_protection, "Low");

  globalThis.fetch = originalFetch;
  await app.close();
  if (savedKey !== undefined) process.env.OPENAI_API_KEY = savedKey;
  else delete process.env.OPENAI_API_KEY;
});

// ─── Test 7: OpenAI non-ok response ────────────────────────────────────────────

test("502 when OpenAI returns a non-ok HTTP status", async () => {
  const app = Fastify({ logger: false });
  await registerDealRoutes(app, makeMockPool());
  await app.ready();

  const savedKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false,
    status: 429,
    json: async () => ({ error: { message: "rate limited" } }),
    text: async () => "rate limited",
  }) as any;

  const res = await app.inject({
    method: "POST",
    url: `/api/v1/deals/${DEAL_ID}/analysis/deal-terms`,
    payload: { canonical_fields: sampleFields() },
    headers: { "content-type": "application/json" },
  });

  assert.equal(res.statusCode, 502, `body=${res.body}`);
  const body = res.json() as any;
  assert.equal(body.error, "llm_error");

  globalThis.fetch = originalFetch;
  await app.close();
  if (savedKey !== undefined) process.env.OPENAI_API_KEY = savedKey;
  else delete process.env.OPENAI_API_KEY;
});

// ─── Test 8: LLM empty content ─────────────────────────────────────────────────

test("502 when LLM returns empty content string", async () => {
  const app = Fastify({ logger: false });
  await registerDealRoutes(app, makeMockPool());
  await app.ready();

  const savedKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ model: "gpt-4o-mini", choices: [{ message: { content: "" } }] }),
    text: async () => "",
  }) as any;

  const res = await app.inject({
    method: "POST",
    url: `/api/v1/deals/${DEAL_ID}/analysis/deal-terms`,
    payload: { canonical_fields: sampleFields() },
    headers: { "content-type": "application/json" },
  });

  assert.equal(res.statusCode, 502, `body=${res.body}`);
  const body = res.json() as any;
  assert.equal(body.error, "llm_empty_response");

  globalThis.fetch = originalFetch;
  await app.close();
  if (savedKey !== undefined) process.env.OPENAI_API_KEY = savedKey;
  else delete process.env.OPENAI_API_KEY;
});

// ─── Test 9: LLM returns non-JSON ──────────────────────────────────────────────

test("502 when LLM returns non-JSON content", async () => {
  const app = Fastify({ logger: false });
  await registerDealRoutes(app, makeMockPool());
  await app.ready();

  const savedKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      model: "gpt-4o-mini",
      choices: [{ message: { content: "Sorry, I cannot help with that." } }],
    }),
    text: async () => "",
  }) as any;

  const res = await app.inject({
    method: "POST",
    url: `/api/v1/deals/${DEAL_ID}/analysis/deal-terms`,
    payload: { canonical_fields: sampleFields() },
    headers: { "content-type": "application/json" },
  });

  assert.equal(res.statusCode, 502, `body=${res.body}`);
  const body = res.json() as any;
  assert.equal(body.error, "llm_parse_error");

  globalThis.fetch = originalFetch;
  await app.close();
  if (savedKey !== undefined) process.env.OPENAI_API_KEY = savedKey;
  else delete process.env.OPENAI_API_KEY;
});

// ─── Test 10: DB isolation — never queries investor_insights tables ────────────

test("pool query never references investor_insights or render_package tables", async () => {
  const app = Fastify({ logger: false });
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
      throw new Error(`[isolation test] Unexpected query: ${sql.slice(0, 120)}`);
    },
  } as any;

  await registerDealRoutes(app, isolationPool);
  await app.ready();

  const savedKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    json: async () => mockLlmOutput({
      structure_summary: "The company is raising $2M at $10M pre-money.",
      structure_assessment: { simplicity: "High", dilution_visibility: "High", valuation_clarity: "High", downside_protection: "Low" },
      missing_terms: [],
    }),
    text: async () => "",
  }) as any;

  await app.inject({
    method: "POST",
    url: `/api/v1/deals/${DEAL_ID}/analysis/deal-terms`,
    payload: { canonical_fields: sampleFields() },
    headers: { "content-type": "application/json" },
  });

  // None of these must appear in any issued SQL
  const forbidden = [
    "investor_insights",
    "render_package",
    "governed_",
    "investor_insight_sections",
    "deal_intelligence_objects",
  ];

  for (const sql of queriedSqls) {
    for (const keyword of forbidden) {
      assert.ok(
        !sql.toLowerCase().includes(keyword.toLowerCase()),
        `Query must not reference "${keyword}": ${sql.slice(0, 120)}`,
      );
    }
  }

  globalThis.fetch = originalFetch;
  await app.close();
  if (savedKey !== undefined) process.env.OPENAI_API_KEY = savedKey;
  else delete process.env.OPENAI_API_KEY;
});
