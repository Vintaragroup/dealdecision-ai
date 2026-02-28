/**
 * risk-verification-analysis.test.ts — API contract tests
 *
 * Tests for POST /api/v1/deals/:deal_id/analysis/risk-verification endpoint.
 * Uses node:test + Fastify inject. No real database, no real OpenAI calls.
 *
 * Contract guarantees:
 *  1.  400 when deal_id is not a valid UUID
 *  2.  400 when body is empty (insufficient_data)
 *  3.  400 when body fails schema validation
 *  4.  404 when deal does not exist
 *  5.  503 when OPENAI_API_KEY is not configured
 *  6.  200 with correct shape on valid input + mocked LLM
 *  7.  502 when LLM returns placeholder company name
 *  8.  502 when OpenAI returns non-ok HTTP status
 *  9.  502 when LLM returns empty content
 * 10.  502 when LLM returns non-JSON
 * 11.  When missing_critical_terms present → narrative must include "not disclosed"
 * 12.  When low coverage → narrative must include "data coverage"
 * 13.  DB isolation — pool query only touches deals table
 * 14.  200 when optional deal_name is provided
 */

process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerDealRoutes } from "../routes/deals";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DEAL_ID = "d1e2f3a4-bbbb-0000-0000-000000000099";

function makeMockPool(dealExists = true) {
  return {
    query: async (sql: string, params: unknown[] = []) => {
      if (
        sql.includes("FROM deals") &&
        sql.includes("WHERE id = $1") &&
        sql.includes("deleted_at IS NULL")
      ) {
        if (
          sql.includes("investor_insights") ||
          sql.includes("render_package") ||
          sql.includes("investor_report")
        ) {
          throw new Error("[risk-verification test] DB isolation violation — unexpected table");
        }
        return { rows: dealExists ? [{ id: String(params[0] ?? DEAL_ID) }] : [] };
      }
      throw new Error(`[risk-verification test] Unexpected DB query: ${sql.slice(0, 120)}`);
    },
  } as any;
}

function validRvBody(overrides: Partial<{
  deal_name: string;
  gates: Array<{ id: string; status: "pass" | "fail" | "not_run"; reason?: string }>;
  missing_critical_terms: string[];
  conflicts: Array<{ field: string; value_a: string; value_b: string }>;
  coverage: {
    docs_count?: number;
    dpu_pages?: number;
    nonempty_pages?: number;
    evidence_count?: number;
    text_coverage_pct?: number;
  };
  reconciliation: {
    confidence_score?: number;
    flags?: Array<{ name: string; status: "PASS" | "WARN" | "FAIL" | "SKIP"; reason?: string }>;
  };
}> = {}) {
  return {
    gates: [
      { id: "G0_DOCS_PRESENT", status: "pass" as const },
      { id: "G2_RAISE_DISCLOSED", status: "fail" as const, reason: "raise_amount_missing" },
    ],
    coverage: {
      docs_count: 3,
      dpu_pages: 20,
      nonempty_pages: 14,
      evidence_count: 45,
      text_coverage_pct: 70,
    },
    reconciliation: {
      confidence_score: 0.75,
      flags: [
        { name: "revenue_crosscheck", status: "PASS" as const, reason: "Matches across docs" },
        { name: "burn_rate",          status: "WARN" as const, reason: "Not disclosed" },
      ],
    },
    ...overrides,
  };
}

function validLlmOutput(overrides: Partial<{
  summary_paragraphs: string[];
  top_risks: string[];
  verification_requests: string[];
}> = {}) {
  return {
    schema_version: "risk_verification_v1",
    summary_paragraphs: [
      "The company's raise terms are not yet disclosed, representing a key diligence gap.",
      "Reconciliation confidence of 0.75 indicates generally consistent financial reporting.",
    ],
    top_risks: [
      "Raise amount not disclosed — equity dilution cannot be modelled",
      "Burn rate not disclosed — runway risk cannot be quantified",
      "Gate G2_RAISE_DISCLOSED failed due to missing raise information",
    ],
    verification_requests: [
      "Provide signed term sheet or cap table disclosing raise amount and instrument",
      "Supply burn rate and cash position as of most recent month-end",
      "Confirm data room includes all referenced slide appendices",
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

test("risk-verification: 400 when deal_id is not a UUID", async () => {
  const app = Fastify({ logger: false });
  await registerDealRoutes(app, makeMockPool());
  await app.ready();

  const res = await app.inject({
    method: "POST",
    url: "/api/v1/deals/not-a-uuid/analysis/risk-verification",
    payload: validRvBody(),
    headers: { "content-type": "application/json" },
  });

  assert.equal(res.statusCode, 400, `body=${res.body}`);
  assert.equal(res.json<any>().error, "invalid_deal_id");
  await app.close();
});

// ─── Test 2: empty body → insufficient_data ───────────────────────────────────

test("risk-verification: 400 when body has no substantive fields (insufficient_data)", async () => {
  const app = Fastify({ logger: false });
  await registerDealRoutes(app, makeMockPool());
  await app.ready();

  const savedKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";

  const res = await app.inject({
    method: "POST",
    url: `/api/v1/deals/${DEAL_ID}/analysis/risk-verification`,
    payload: {},
    headers: { "content-type": "application/json" },
  });

  // Empty body means no gates/conflicts/etc → insufficient_data
  assert.equal(res.statusCode, 400, `body=${res.body}`);
  assert.equal(res.json<any>().error, "insufficient_data");

  await app.close();
  if (savedKey !== undefined) process.env.OPENAI_API_KEY = savedKey;
  else delete process.env.OPENAI_API_KEY;
});

// ─── Test 3: invalid body schema ─────────────────────────────────────────────

test("risk-verification: 400 when body fails schema validation", async () => {
  const app = Fastify({ logger: false });
  await registerDealRoutes(app, makeMockPool());
  await app.ready();

  const res = await app.inject({
    method: "POST",
    url: `/api/v1/deals/${DEAL_ID}/analysis/risk-verification`,
    payload: { gates: "not-an-array" },
    headers: { "content-type": "application/json" },
  });

  assert.equal(res.statusCode, 400, `body=${res.body}`);
  await app.close();
});

// ─── Test 4: deal not found ────────────────────────────────────────────────────

test("risk-verification: 404 when deal does not exist", async () => {
  const app = Fastify({ logger: false });
  await registerDealRoutes(app, makeMockPool(false));
  await app.ready();

  const savedKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";

  const res = await app.inject({
    method: "POST",
    url: `/api/v1/deals/${DEAL_ID}/analysis/risk-verification`,
    payload: validRvBody(),
    headers: { "content-type": "application/json" },
  });

  assert.equal(res.statusCode, 404, `body=${res.body}`);
  assert.equal(res.json<any>().error, "deal_not_found");

  await app.close();
  if (savedKey !== undefined) process.env.OPENAI_API_KEY = savedKey;
  else delete process.env.OPENAI_API_KEY;
});

// ─── Test 5: missing OPENAI_API_KEY ───────────────────────────────────────────

test("risk-verification: 503 when OPENAI_API_KEY is not set", async () => {
  const app = Fastify({ logger: false });
  await registerDealRoutes(app, makeMockPool());
  await app.ready();

  const savedKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  const res = await app.inject({
    method: "POST",
    url: `/api/v1/deals/${DEAL_ID}/analysis/risk-verification`,
    payload: validRvBody(),
    headers: { "content-type": "application/json" },
  });

  assert.equal(res.statusCode, 503, `body=${res.body}`);
  assert.equal(res.json<any>().error, "llm_unavailable");

  await app.close();
  if (savedKey !== undefined) process.env.OPENAI_API_KEY = savedKey;
});

// ─── Test 6: 200 happy path ───────────────────────────────────────────────────

test("risk-verification: 200 with correct shape when LLM returns valid JSON", async () => {
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
    url: `/api/v1/deals/${DEAL_ID}/analysis/risk-verification`,
    payload: validRvBody(),
    headers: { "content-type": "application/json" },
  });

  assert.equal(res.statusCode, 200, `body=${res.body}`);
  const body = res.json<any>();

  assert.equal(body.schema_version, "risk_verification_v1");
  assert.ok(Array.isArray(body.summary_paragraphs), "summary_paragraphs must be an array");
  assert.ok(body.summary_paragraphs.length >= 1, "at least 1 summary paragraph");
  assert.ok(Array.isArray(body.top_risks), "top_risks must be an array");
  assert.ok(Array.isArray(body.verification_requests), "verification_requests must be an array");

  globalThis.fetch = originalFetch;
  await app.close();
  if (savedKey !== undefined) process.env.OPENAI_API_KEY = savedKey;
  else delete process.env.OPENAI_API_KEY;
});

// ─── Test 7: placeholder detected → 502 ──────────────────────────────────────

test("risk-verification: 502 when LLM returns placeholder company name", async () => {
  const app = Fastify({ logger: false });
  await registerDealRoutes(app, makeMockPool());
  await app.ready();

  const savedKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true, status: 200,
    json: async () => mockLlmResponse(validLlmOutput({
      summary_paragraphs: ["Startup Corp is requesting $2M in funding."],
    })),
    text: async () => "",
  }) as any;

  const res = await app.inject({
    method: "POST",
    url: `/api/v1/deals/${DEAL_ID}/analysis/risk-verification`,
    payload: validRvBody(),
    headers: { "content-type": "application/json" },
  });

  assert.equal(res.statusCode, 502, `body=${res.body}`);
  assert.equal(res.json<any>().error, "llm_quality_error");

  globalThis.fetch = originalFetch;
  await app.close();
  if (savedKey !== undefined) process.env.OPENAI_API_KEY = savedKey;
  else delete process.env.OPENAI_API_KEY;
});

// ─── Test 8: OpenAI non-ok status → 502 ──────────────────────────────────────

test("risk-verification: 502 when OpenAI returns non-ok HTTP status", async () => {
  const app = Fastify({ logger: false });
  await registerDealRoutes(app, makeMockPool());
  await app.ready();

  const savedKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: false, status: 429,
    text: async () => "rate limited",
  }) as any;

  const res = await app.inject({
    method: "POST",
    url: `/api/v1/deals/${DEAL_ID}/analysis/risk-verification`,
    payload: validRvBody(),
    headers: { "content-type": "application/json" },
  });

  assert.equal(res.statusCode, 502, `body=${res.body}`);
  assert.equal(res.json<any>().error, "llm_error");

  globalThis.fetch = originalFetch;
  await app.close();
  if (savedKey !== undefined) process.env.OPENAI_API_KEY = savedKey;
  else delete process.env.OPENAI_API_KEY;
});

// ─── Test 9: empty LLM response → 502 ─────────────────────────────────────────

test("risk-verification: 502 when LLM returns empty content", async () => {
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
    url: `/api/v1/deals/${DEAL_ID}/analysis/risk-verification`,
    payload: validRvBody(),
    headers: { "content-type": "application/json" },
  });

  assert.equal(res.statusCode, 502, `body=${res.body}`);
  assert.equal(res.json<any>().error, "llm_empty_response");

  globalThis.fetch = originalFetch;
  await app.close();
  if (savedKey !== undefined) process.env.OPENAI_API_KEY = savedKey;
  else delete process.env.OPENAI_API_KEY;
});

// ─── Test 10: non-JSON LLM response → 502 ────────────────────────────────────

test("risk-verification: 502 when LLM returns non-JSON", async () => {
  const app = Fastify({ logger: false });
  await registerDealRoutes(app, makeMockPool());
  await app.ready();

  const savedKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true, status: 200,
    json: async () => ({ model: "gpt-4o-mini", choices: [{ message: { content: "This is not JSON!" } }] }),
    text: async () => "",
  }) as any;

  const res = await app.inject({
    method: "POST",
    url: `/api/v1/deals/${DEAL_ID}/analysis/risk-verification`,
    payload: validRvBody(),
    headers: { "content-type": "application/json" },
  });

  assert.equal(res.statusCode, 502, `body=${res.body}`);
  assert.equal(res.json<any>().error, "llm_parse_error");

  globalThis.fetch = originalFetch;
  await app.close();
  if (savedKey !== undefined) process.env.OPENAI_API_KEY = savedKey;
  else delete process.env.OPENAI_API_KEY;
});

// ─── Test 11: missing_critical_terms → narrative must say "not disclosed" ─────

test("risk-verification: 502 when missing_critical_terms present but narrative omits 'not disclosed'", async () => {
  const app = Fastify({ logger: false });
  await registerDealRoutes(app, makeMockPool());
  await app.ready();

  const savedKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-key";

  const originalFetch = globalThis.fetch;
  // LLM response does NOT include "not disclosed" anywhere
  globalThis.fetch = async () => ({
    ok: true, status: 200,
    json: async () => mockLlmResponse(validLlmOutput({
      summary_paragraphs: [
        "The company is seeking a $2M seed round.",
        "Revenue is growing at 50% YoY with healthy gross margins.",
      ],
      top_risks: [
        "Raise structure lacks transparency",
        "Balance sheet has not been provided",
      ],
      verification_requests: [
        "Request a signed term sheet from the company",
        "Supply audited financials or management accounts",
      ],
    })),
    text: async () => "",
  }) as any;

  const res = await app.inject({
    method: "POST",
    url: `/api/v1/deals/${DEAL_ID}/analysis/risk-verification`,
    payload: validRvBody({ missing_critical_terms: ["raise_amount", "raise_instrument"] }),
    headers: { "content-type": "application/json" },
  });

  assert.equal(res.statusCode, 502, `body=${res.body}`);
  assert.equal(res.json<any>().error, "llm_quality_error");

  globalThis.fetch = originalFetch;
  await app.close();
  if (savedKey !== undefined) process.env.OPENAI_API_KEY = savedKey;
  else delete process.env.OPENAI_API_KEY;
});

// ─── Test 11b: happy path when "not disclosed" is present ────────────────────

test("risk-verification: 200 when missing_critical_terms present and narrative includes 'not disclosed'", async () => {
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
        "Raise terms are not disclosed in current materials — this is the primary diligence gap.",
      ],
    })),
    text: async () => "",
  }) as any;

  const res = await app.inject({
    method: "POST",
    url: `/api/v1/deals/${DEAL_ID}/analysis/risk-verification`,
    payload: validRvBody({ missing_critical_terms: ["raise_amount"] }),
    headers: { "content-type": "application/json" },
  });

  assert.equal(res.statusCode, 200, `body=${res.body}`);

  globalThis.fetch = originalFetch;
  await app.close();
  if (savedKey !== undefined) process.env.OPENAI_API_KEY = savedKey;
  else delete process.env.OPENAI_API_KEY;
});

// ─── Test 12: low coverage → narrative must say "data coverage" ───────────────

test("risk-verification: 502 when low-coverage and narrative omits 'data coverage'", async () => {
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
        "The deal shows several risks that require targeted diligence.",
      ],
    })),
    text: async () => "",
  }) as any;

  const res = await app.inject({
    method: "POST",
    url: `/api/v1/deals/${DEAL_ID}/analysis/risk-verification`,
    payload: validRvBody({
      coverage: {
        dpu_pages:      30,
        nonempty_pages: 10, // 33% — below 70% threshold
        docs_count:     2,
        text_coverage_pct: 33,
      },
    }),
    headers: { "content-type": "application/json" },
  });

  assert.equal(res.statusCode, 502, `body=${res.body}`);
  assert.equal(res.json<any>().error, "llm_quality_error");

  globalThis.fetch = originalFetch;
  await app.close();
  if (savedKey !== undefined) process.env.OPENAI_API_KEY = savedKey;
  else delete process.env.OPENAI_API_KEY;
});

// ─── Test 12b: low coverage happy path ───────────────────────────────────────

test("risk-verification: 200 when low coverage and narrative includes 'data coverage'", async () => {
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
        "Data coverage is limited to 33% of submitted pages, restricting the depth of analysis.",
      ],
    })),
    text: async () => "",
  }) as any;

  const res = await app.inject({
    method: "POST",
    url: `/api/v1/deals/${DEAL_ID}/analysis/risk-verification`,
    payload: validRvBody({ coverage: { dpu_pages: 30, nonempty_pages: 10, text_coverage_pct: 33 } }),
    headers: { "content-type": "application/json" },
  });

  assert.equal(res.statusCode, 200, `body=${res.body}`);

  globalThis.fetch = originalFetch;
  await app.close();
  if (savedKey !== undefined) process.env.OPENAI_API_KEY = savedKey;
  else delete process.env.OPENAI_API_KEY;
});

// ─── Test 13: DB isolation ────────────────────────────────────────────────────

test("risk-verification: DB isolation — query only touches deals table", async () => {
  // makeMockPool already throws if investor_insights / render_package appear in SQL.
  // If the endpoint calls anything other than SELECT FROM deals… the pool throws and
  // the request returns 500. We assert it returns 200 with valid data instead.
  const app = Fastify({ logger: false });
  await registerDealRoutes(app, makeMockPool(true));
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
    url: `/api/v1/deals/${DEAL_ID}/analysis/risk-verification`,
    payload: validRvBody(),
    headers: { "content-type": "application/json" },
  });

  assert.equal(res.statusCode, 200, `DB isolation violation body=${res.body}`);

  globalThis.fetch = originalFetch;
  await app.close();
  if (savedKey !== undefined) process.env.OPENAI_API_KEY = savedKey;
  else delete process.env.OPENAI_API_KEY;
});

// ─── Test 14: optional deal_name → 200 ───────────────────────────────────────

test("risk-verification: 200 when optional deal_name is provided", async () => {
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
    url: `/api/v1/deals/${DEAL_ID}/analysis/risk-verification`,
    payload: validRvBody({ deal_name: "TestCo" }),
    headers: { "content-type": "application/json" },
  });

  assert.equal(res.statusCode, 200, `body=${res.body}`);
  assert.equal(res.json<any>().schema_version, "risk_verification_v1");

  globalThis.fetch = originalFetch;
  await app.close();
  if (savedKey !== undefined) process.env.OPENAI_API_KEY = savedKey;
  else delete process.env.OPENAI_API_KEY;
});
