process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerReportRoutes } from "../src/routes/reports";
import { compileDIOToReport } from "@dealdecision/core";

// Minimal DIO-like payload for compileDIOToReport(). We don't need a fully realistic analysis,
// just a schema-valid persisted artifact that can be compiled.
const now = new Date().toISOString();
const baseDio = (dealId: string, version: number): any => ({
  schema_version: "1.0.0",
  dio_id: "00000000-0000-4000-8000-00000000a001",
  deal_id: dealId,
  created_at: now,
  updated_at: now,
  analysis_version: version,
  inputs: {
    documents: [],
    evidence: [],
    config: {
      analyzer_versions: {
        slide_sequence: "1.0.0",
        metric_benchmark: "1.0.0",
        visual_design: "1.0.0",
        narrative_arc: "1.0.0",
        financial_health: "1.0.0",
        risk_assessment: "1.0.0",
      },
      features: {
        tavily_enabled: false,
        mcp_enabled: false,
        llm_synthesis_enabled: false,
        debug_scoring: false,
      },
      parameters: {
        max_cycles: 3,
        depth_threshold: 2,
        min_confidence: 0.7,
      },
    },
  },
  analyzer_results: {
    slide_sequence: { analyzer_version: "1.0.0", executed_at: now, status: "insufficient_data", coverage: 0, confidence: 0.3, score: null, pattern_match: "None", sequence_detected: [], expected_sequence: [], deviations: [], evidence_ids: [] },
    metric_benchmark: { analyzer_version: "1.0.0", executed_at: now, status: "insufficient_data", coverage: 0, confidence: 0.3, overall_score: null, metrics_analyzed: [], evidence_ids: [] },
    visual_design: { analyzer_version: "1.0.0", executed_at: now, status: "insufficient_data", coverage: 0, confidence: 0.3, design_score: null, proxy_signals: {}, strengths: [], weaknesses: [], evidence_ids: [] },
    narrative_arc: { analyzer_version: "1.0.0", executed_at: now, status: "insufficient_data", coverage: 0, confidence: 0.3, pacing_score: null, archetype: "", archetype_confidence: 0, emotional_beats: [], evidence_ids: [] },
    financial_health: { analyzer_version: "1.0.0", executed_at: now, status: "insufficient_data", coverage: 0, confidence: 0.3, runway_months: null, burn_multiple: null, health_score: null, metrics: { revenue: null, expenses: null, cash_balance: null, burn_rate: null, growth_rate: null }, risks: [], evidence_ids: [] },
    risk_assessment: { analyzer_version: "1.0.0", executed_at: now, status: "insufficient_data", coverage: 0, confidence: 0.3, overall_risk_score: null, risks_by_category: { market: [], team: [], financial: [], execution: [] }, total_risks: 0, critical_count: 0, high_count: 0, evidence_ids: [] },
  },
  planner_state: { cycle: 0, goals: [], constraints: [], hypotheses: [], subgoals: [], focus: "", stop_reason: null },
  fact_table: [],
  ledger_manifest: { cycles: 0, depth_delta: [], subgoals: 0, constraints: 0, dead_ends: 0, paraphrase_invariance: 0, calibration: { brier: 0 }, total_facts_added: 0, total_evidence_cited: 0, uncertain_claims: 0 },
  risk_map: [],
  decision: { recommendation: "CONDITIONAL", confidence: 0.5, tranche_plan: { t0_amount: null, milestones: [] }, verification_checklist: [], key_strengths: [], key_weaknesses: [], evidence_ids: [] },
  narrative: { llm_version: "", generated_at: now, token_usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0, estimated_cost: 0 }, executive_summary: "" },
  execution_metadata: { started_at: now, completed_at: now, duration_ms: 0, errors: [], warnings: [], analyzer_execution: [] },
});

test("GET /api/v1/deals/:deal_id/report returns 200 {ready:false} before analysis", async () => {
  const dealId = "00000000-0000-0000-0000-0000000000c1";

  const mockPool = {
    query: async (sql: string, params?: unknown[]) => {
      const q = String(sql);
      if (q.includes("FROM deals") && q.includes("WHERE id = $1") && q.includes("deleted_at IS NULL")) {
        assert.deepEqual(params, [dealId]);
        return { rows: [{ id: dealId, llm_phase_mode: "exploratory" }] };
      }
      if (q.includes("FROM deal_intelligence_objects") && q.includes("WHERE deal_id = $1")) {
        assert.deepEqual(params, [dealId]);
        return { rows: [] };
      }
      throw new Error(`Unexpected SQL in test: ${q}`);
    },
  } as any;

  const app = Fastify();
  try {
    await registerReportRoutes(app, mockPool);

    const res = await app.inject({ method: "GET", url: `/api/v1/deals/${dealId}/report` });
    assert.equal(res.statusCode, 200);
    const body = res.json() as any;
    assert.equal(body.ready, false);
    assert.equal(body.reason, "not_generated_yet");
  } finally {
    await app.close();
  }
});

test("GET /api/v1/deals/:deal_id/report returns 200 {ready:true} when a DIO exists", async () => {
  const dealId = "00000000-0000-0000-0000-0000000000c2";
  const dioId = "00000000-0000-4000-8000-00000000a002";

  const dio = baseDio(dealId, 1);
  dio.dio_id = dioId;

  const mockPool = {
    query: async (sql: string, params?: unknown[]) => {
      const q = String(sql);
      if (q.includes("FROM deals") && q.includes("WHERE id = $1") && q.includes("deleted_at IS NULL")) {
        assert.deepEqual(params, [dealId]);
        return { rows: [{ id: dealId, llm_phase_mode: null }] };
      }
      if (q.includes("FROM deal_intelligence_objects") && q.includes("WHERE deal_id = $1")) {
        assert.deepEqual(params, [dealId]);
        return {
          rows: [
            {
              dio_id: dioId,
              analysis_version: 1,
              recommendation: null,
              overall_score: null,
              dio_data: dio,
              updated_at: now,
            },
          ],
        };
      }
      if (q.includes("SELECT 1 FROM evidence_items")) {
        return { rows: [{ ok: 1 }], rowCount: 1 };
      }
          if (q.includes("FROM evidence_items") && q.includes("source_type IN ('promoted_slide_fact','business_model_fact')")) {
        assert.deepEqual(params, [dealId]);
        return { rows: [] };
      }
      if (q.includes("FROM public.document_page_understanding") && q.includes("version = 'page_understanding_v1'")) {
        assert.deepEqual(params, [dealId]);
        return { rows: [] };
      }
      if (q.includes("FROM visual_assets") && q.includes("quality_flags")) {
        return { rows: [] };
      }
      throw new Error(`Unexpected SQL in test: ${q}`);
    },
  } as any;

  const app = Fastify();
  try {
    await registerReportRoutes(app, mockPool);

    const res = await app.inject({ method: "GET", url: `/api/v1/deals/${dealId}/report` });
    assert.equal(res.statusCode, 200);
    const body = res.json() as any;
    assert.equal(body.ready, true);
    assert.equal(body.version, 1);
    assert.equal(body.artifact?.kind, "deal_intelligence_object");
    assert.equal(body.artifact?.dio_id, dioId);

    // Back-compat: compiled report should still be present when compilation succeeds.
    assert.equal(typeof body.dealId, "string");
    assert.equal(typeof body.generatedAt, "string");
    assert.equal(typeof body.overallScore, "number");
  } finally {
    await app.close();
  }
});

test("GET /api/v1/deals/:deal_id/report prefers persisted dio_data.report when present", async () => {
  const dealId = "00000000-0000-0000-0000-0000000000c2";
  const dioId = "00000000-0000-4000-8000-00000000a0p2";

  const dio = baseDio(dealId, 1);
  dio.dio_id = dioId;
  const persistedReport = compileDIOToReport(dio);

  const mockPool = {
    query: async (sql: string, params?: unknown[]) => {
      const q = String(sql);
      if (q.includes("FROM deals") && q.includes("WHERE id = $1") && q.includes("deleted_at IS NULL")) {
        assert.deepEqual(params, [dealId]);
        return { rows: [{ id: dealId, llm_phase_mode: null }] };
      }
      if (q.includes("FROM deal_intelligence_objects") && q.includes("WHERE deal_id = $1")) {
        assert.deepEqual(params, [dealId]);
        return {
          rows: [
            {
              dio_id: dioId,
              analysis_version: 1,
              recommendation: null,
              overall_score: null,
              dio_data: { report: persistedReport },
              updated_at: now,
            },
          ],
        };
      }
      if (q.includes("MAX(dpu.created_at)")) {
        return { rows: [{ latest_dpu_created_at: null }] };
      }
      if (q.includes("document_page_understanding") || q.includes("visual_assets") || q.includes("visual_extractions")) {
        return { rows: [] };
      }
      if (q.includes("evidence_items")) {
        return { rows: [] };
      }
      throw new Error(`Unexpected SQL in test: ${q}`);
    },
  } as any;

  const app = Fastify();
  try {
    await registerReportRoutes(app, mockPool);

    const res = await app.inject({ method: "GET", url: `/api/v1/deals/${dealId}/report` });
    assert.equal(res.statusCode, 200);
    const body = res.json() as any;
    assert.equal(body.ready, true);
    assert.equal(body.dealId, dealId);
    assert.equal(body.structured_summary?.deal_summary_v1?.version, "deal_summary_v1");
  } finally {
    await app.close();
  }
});

test("GET /api/v1/deals/:deal_id/report includes structured_summary populated from DIO inputs", async () => {
  const dealId = "00000000-0000-0000-0000-0000000000c3";
  const dioId = "00000000-0000-4000-8000-00000000a003";
  const docId = "00000000-0000-4000-8000-00000000d001";

  const dio = baseDio(dealId, 1);
  dio.dio_id = dioId;
  dio.inputs.documents = [
    {
      document_id: docId,
      title: "Pitch Deck",
      type: "pitch_deck",
      version_hash: "a".repeat(64),
      extracted_at: now,
      page_count: 12,
      metrics: [
        { key: "ARR", value: "$1.2M", unit: "USD", page: 3, confidence: 0.82 },
        { key: "Customers", value: "450", unit: null, page: 4, confidence: 0.76 },
      ],
      headings: ["Problem", "Solution", "Traction"],
      summary: "Raising a Seed round to scale go-to-market.",
    },
  ];

  dio.dio = {
    phase1: {
      executive_summary_v1: {
        title: "Exec summary",
        one_liner: "A SaaS platform for X",
        deal_type: "Primary equity",
        raise: "$2M Seed",
        business_model: "SaaS subscription",
        traction_signals: ["ARR growth"],
        key_risks_detected: [],
        unknowns: [],
        confidence: { overall: "high", sections: { raise: "high", business_model: "med" } },
        evidence: [
          { claim_id: "raise", document_id: docId, page: 3, snippet: "Raising $2M Seed" },
          { claim_id: "business_model", document_id: docId, page: 2, snippet: "Subscription pricing" },
        ],
      },
      decision_summary_v1: {
        score: 50,
        recommendation: "CONSIDER",
        reasons: [],
        blockers: [],
        next_requests: [],
        confidence: "med",
      },
      claims: [],
      coverage: { sections: {} },
    },
  };

  const mockPool = {
    query: async (sql: string, params?: unknown[]) => {
      const q = String(sql);
      if (q.includes("FROM deals") && q.includes("WHERE id = $1") && q.includes("deleted_at IS NULL")) {
        assert.deepEqual(params, [dealId]);
        return { rows: [{ id: dealId, llm_phase_mode: null }] };
      }
      if (q.includes("FROM deal_intelligence_objects") && q.includes("WHERE deal_id = $1")) {
        assert.deepEqual(params, [dealId]);
        return {
          rows: [
            {
              dio_id: dioId,
              analysis_version: 1,
              recommendation: null,
              overall_score: null,
              dio_data: dio,
              updated_at: now,
            },
          ],
        };
      }
      if (q.includes("SELECT 1 FROM evidence_items")) {
        return { rows: [{ ok: 1 }], rowCount: 1 };
      }
          if (q.includes("FROM evidence_items") && q.includes("source_type IN ('promoted_slide_fact','business_model_fact')")) {
        assert.deepEqual(params, [dealId]);
        return { rows: [] };
      }
      if (q.includes("FROM public.document_page_understanding") && q.includes("version = 'page_understanding_v1'")) {
        assert.deepEqual(params, [dealId]);
        return { rows: [] };
      }
      if (q.includes("FROM visual_assets") && q.includes("quality_flags")) {
        return { rows: [] };
      }
      throw new Error(`Unexpected SQL in test: ${q}`);
    },
  } as any;

  const app = Fastify();
  try {
    await registerReportRoutes(app, mockPool);
    const res = await app.inject({ method: "GET", url: `/api/v1/deals/${dealId}/report` });
    assert.equal(res.statusCode, 200);
    const body = res.json() as any;

    assert.equal(body.ready, true);
    assert.ok(body.structured_summary);

    assert.equal(body.structured_summary.raise?.value, "$2M Seed");
    assert.equal(body.structured_summary.business_model?.value, "SaaS subscription");

    assert.equal(body.structured_summary.revenue?.value?.currency, "USD");
    assert.equal(body.structured_summary.revenue?.value?.period, "ARR");
    assert.equal(typeof body.structured_summary.revenue?.confidence, "number");
    assert.ok(Array.isArray(body.structured_summary.revenue?.sources));

    assert.equal(body.structured_summary.customers?.value?.kind, "customers");
    assert.equal(typeof body.structured_summary.customers?.value?.count, "number");
  } finally {
    await app.close();
  }
});

test("GET /api/v1/deals/:deal_id/report surfaces labeled KPI fallbacks derived from document_page_understanding", async () => {
  const dealId = "00000000-0000-0000-0000-0000000000c4";
  const dioId = "00000000-0000-4000-8000-00000000a004";
  const docId = "00000000-0000-4000-8000-00000000d004";

  const dio = baseDio(dealId, 1);
  dio.dio_id = dioId;
  dio.inputs.documents = [];
  dio.dio = {
    phase1: {
      executive_summary_v1: {
        title: "Exec summary",
        one_liner: "A consumer brand",
        deal_type: "Primary equity",
        raise: null,
        business_model: null,
        traction_signals: [],
        key_risks_detected: [],
        unknowns: [],
        confidence: { overall: "low", sections: {} },
        evidence: [],
      },
      decision_summary_v1: {
        score: 0,
        recommendation: "CONSIDER",
        reasons: [],
        blockers: [],
        next_requests: [],
        confidence: "low",
      },
      claims: [],
      coverage: { sections: {} },
    },
  };

  const dpuRows = [
    // Irrelevant slide: should NOT win growth.
    {
      document_id: docId,
      page_index: 5,
      payload: {
        structured: {
          title: "Our Team.",
          segment_key: "team",
          bullets: ["50% YoY"],
        },
        source: { extracted_at: now },
      },
    },
    {
      document_id: docId,
      page_index: 8,
      payload: {
        structured: {
          title: "Business Performance:",
          segment_key: "financials",
          bullets: ["$800,000 in revenue attributed to email/SMS"],
        },
        source: { extracted_at: now },
      },
    },
    {
      document_id: docId,
      page_index: 16,
      payload: {
        structured: {
          title: "Growth Forecast.",
          segment_key: "financials",
          bullets: ["$4.5M+ 2026."],
        },
        source: { extracted_at: now },
      },
    },
    // Irrelevant slides: opportunity-style equipment pages must NOT become header revenue.
    {
      document_id: docId,
      page_index: 27,
      payload: {
        structured: {
          title: "Equipment",
          segment_key: "equipment",
          bullets: ["$150k-$200k per year in retail revenue within driving distance (opportunity)"],
        },
        source: { extracted_at: now },
      },
    },
    {
      document_id: docId,
      page_index: 28,
      payload: {
        structured: {
          title: "Equipment",
          segment_key: "equipment",
          bullets: ["Annual opportunity: $150k-$200k per year in retail revenue within driving distance"],
        },
        source: { extracted_at: now },
      },
    },
    {
      document_id: docId,
      page_index: 22,
      payload: {
        structured: {
          title: "Strategic Hires & Wholesale Build Out",
          segment_key: "team",
          bullets: ["Serving 32 courses, 8 Retailers, 6 other"],
        },
        source: { extracted_at: now },
      },
    },
  ];

  const mockPool = {
    query: async (sql: string, params?: unknown[]) => {
      const q = String(sql);
      if (q.includes("FROM deals") && q.includes("WHERE id = $1") && q.includes("deleted_at IS NULL")) {
        assert.deepEqual(params, [dealId]);
        return { rows: [{ id: dealId, llm_phase_mode: null }] };
      }
      if (q.includes("FROM deal_intelligence_objects") && q.includes("WHERE deal_id = $1")) {
        assert.deepEqual(params, [dealId]);
        return {
          rows: [
            {
              dio_id: dioId,
              analysis_version: 1,
              recommendation: null,
              overall_score: null,
              dio_data: dio,
              updated_at: now,
            },
          ],
        };
      }
      if (q.includes("SELECT 1 FROM evidence_items")) {
        return { rows: [{ ok: 1 }], rowCount: 1 };
      }
      if (q.includes("FROM evidence_items") && q.includes("source_type IN ('promoted_slide_fact','business_model_fact')")) {
        assert.deepEqual(params, [dealId]);
        return { rows: [] };
      }

      if (q.includes("SELECT 1 FROM document_page_understanding")) {
        return { rows: [{ ok: 1 }], rowCount: 1 };
      }

      if (q.includes("FROM public.document_page_understanding") && q.includes("WHERE deal_id = $1::uuid")) {
        assert.deepEqual(params, [dealId]);
        return { rows: dpuRows };
      }

      if (q.includes("FROM visual_assets") && q.includes("quality_flags")) {
        return { rows: [] };
      }

      throw new Error(`Unexpected SQL in test: ${q}`);
    },
  } as any;

  const app = Fastify();
  try {
    await registerReportRoutes(app, mockPool);

    const res = await app.inject({ method: "GET", url: `/api/v1/deals/${dealId}/report` });
    assert.equal(res.statusCode, 200);
    const body = res.json() as any;

    assert.equal(body.ready, true);
    assert.ok(body.structured_summary);

    // Channel-attributed revenue must not be treated as canonical company revenue.
    assert.equal(body.structured_summary.revenue?.value ?? null, null);
    assert.equal(body.structured_summary.revenue?.label ?? null, null);
    assert.equal(Array.isArray(body.structured_summary.revenue?.sources) ? body.structured_summary.revenue.sources.length : 0, 0);

    // Instead, it should be surfaced under marketing_metrics for inspection/UI.
    assert.equal(body.structured_summary.marketing_metrics?.attributed_revenue?.value_raw, "$800k");
    assert.equal(body.structured_summary.marketing_metrics?.attributed_revenue?.channel, "email_sms");
    assert.equal(body.structured_summary.marketing_metrics?.attributed_revenue?.sources?.[0]?.page_index, 8);
    assert.notEqual(body.structured_summary.marketing_metrics?.attributed_revenue?.sources?.[0]?.page_index, 27);
    assert.notEqual(body.structured_summary.marketing_metrics?.attributed_revenue?.sources?.[0]?.page_index, 28);

    assert.equal(body.structured_summary.growth?.label, "Forecast");
    assert.equal(body.structured_summary.growth?.value?.raw, "Forecast: $4.5M (2026)");
    assert.equal(body.structured_summary.growth?.sources?.[0]?.page_index, 16);
		assert.equal(body.structured_summary.growth?.sources?.[0]?.segment_key, "financials");
    assert.notEqual(body.structured_summary.growth?.sources?.[0]?.page_index, 5);

    assert.equal(body.structured_summary.customers?.value?.count, 46);
    assert.equal(body.structured_summary.customers?.label, "Wholesale");
    assert.equal(body.structured_summary.customers?.value?.raw, "46");
    assert.equal(body.structured_summary.customers?.sources?.[0]?.page_index, 22);
		assert.equal(body.structured_summary.customers?.sources?.[0]?.segment_key, "go_to_market");
		assert.equal(body.structured_summary.customers?.sources?.[0]?.segment_reason?.source, "deterministic");
    assert.ok(String(body.structured_summary.customers?.sources?.[0]?.note_snippet ?? '').includes('= 46'));
  } finally {
    await app.close();
  }
});

test("GET /api/v1/deals/:deal_id/report adds deterministic market/product/gtm/deal summaries to structured_summary", async () => {
  const dealId = "00000000-0000-0000-0000-0000000000e1";
  const dioId = "00000000-0000-4000-8000-00000000c001";
  const docId = "00000000-0000-4000-8000-00000000f001";

  const dio = baseDio(dealId, 1);
  dio.dio_id = dioId;

  const dpuRows = [
    // Market
    {
      document_id: docId,
      page_index: 0,
      payload: { source: { extracted_at: now }, structured: { title: "Market Opportunity", bullets: ["TAM is $2B across premium golf and resort channels."] } },
    },
    {
      document_id: docId,
      page_index: 1,
      payload: { source: { extracted_at: now }, structured: { title: "Industry Outlook", bullets: ["Category growth driven by premiumization and repeat purchase behavior."] } },
    },
    // Product
    {
      document_id: docId,
      page_index: 12,
      payload: { source: { extracted_at: now }, structured: { title: "Product", bullets: ["Premium golf apparel (physical) validated with early customers; expanding SKUs and improving repeat purchase."] } },
    },
    // GTM
    {
      document_id: docId,
      page_index: 23,
      payload: { source: { extracted_at: now }, structured: { title: "Go to Market Strategy", bullets: ["Direct via website ecommerce", "Email/SMS owned channels", "Retail expansion"] } },
    },
    // Raise
    {
      document_id: docId,
      page_index: 19,
      payload: { source: { extracted_at: now }, structured: { title: "Capital Raise", bullets: ["$1.5MM raise on a $6MM valuation"] } },
    },
    // Traction
    {
      document_id: docId,
      page_index: 22,
      payload: { source: { extracted_at: now }, structured: { title: "Wholesale", bullets: ["Serving 32 courses, 8 Retailers, 6 other"] } },
    },
  ];

  const mockPool = {
    query: async (sql: string, params?: unknown[]) => {
      const q = String(sql);
      if (q.includes("FROM deals") && q.includes("WHERE id = $1") && q.includes("deleted_at IS NULL")) {
        assert.deepEqual(params, [dealId]);
        return { rows: [{ id: dealId, llm_phase_mode: null }] };
      }
      if (q.includes("FROM deal_intelligence_objects") && q.includes("WHERE deal_id = $1")) {
        assert.deepEqual(params, [dealId]);
        return {
          rows: [
            {
              dio_id: dioId,
              analysis_version: 1,
              recommendation: null,
              overall_score: null,
              dio_data: dio,
              updated_at: now,
            },
          ],
        };
      }
      if (q.includes("SELECT 1 FROM evidence_items")) {
        return { rows: [{ ok: 1 }], rowCount: 1 };
      }
      if (q.includes("FROM evidence_items") && q.includes("source_type IN ('promoted_slide_fact','business_model_fact')")) {
        assert.deepEqual(params, [dealId]);
        return { rows: [] };
      }
      if (q.includes("SELECT 1 FROM document_page_understanding")) {
        return { rows: [{ ok: 1 }], rowCount: 1 };
      }
      if (q.includes("FROM public.document_page_understanding") && q.includes("WHERE deal_id = $1::uuid")) {
        assert.deepEqual(params, [dealId]);
        return { rows: dpuRows };
      }
      if (q.includes("FROM public.document_page_understanding") && q.includes("version = 'page_understanding_v1'")) {
        assert.deepEqual(params, [dealId]);
        return { rows: dpuRows };
      }
      if (q.includes("FROM visual_assets") && q.includes("quality_flags")) {
        return { rows: [] };
      }
      throw new Error(`Unexpected SQL in test: ${q}`);
    },
  } as any;

  const app = Fastify();
  try {
    await registerReportRoutes(app, mockPool);

    const res = await app.inject({ method: "GET", url: `/api/v1/deals/${dealId}/report` });
    assert.equal(res.statusCode, 200);
    const body = res.json() as any;

    assert.equal(body.ready, true);
    assert.ok(body.structured_summary);

    assert.ok(body.structured_summary.market_summary);
    assert.ok(body.structured_summary.product_summary);
    assert.ok(body.structured_summary.gtm_summary);
    assert.ok(body.structured_summary.deal_summary);

    assert.ok(Array.isArray(body.structured_summary.market_summary.sources));
    assert.ok(body.structured_summary.market_summary.sources.some((s: any) => s?.page_index === 0 || s?.page_index === 1));

    assert.ok(Array.isArray(body.structured_summary.product_summary.sources));
    assert.ok(body.structured_summary.product_summary.sources.some((s: any) => s?.page_index === 12));

    assert.ok(Array.isArray(body.structured_summary.gtm_summary.sources));
    assert.ok(body.structured_summary.gtm_summary.sources.some((s: any) => s?.page_index === 23));

    assert.ok(Array.isArray(body.structured_summary.deal_summary.sources));
    // Canonical deal summary is claim-gated and must not include raise_terms.
    assert.ok(!body.structured_summary.deal_summary.sources.some((s: any) => s?.page_index === 19));
    assert.ok(body.structured_summary.deal_summary.sources.some((s: any) => s?.page_index === 22));
  } finally {
    await app.close();
  }
});

test('GET /api/v1/deals/:deal_id/report debug_deal_summary=1 logs selection path and excludes team/raise as primary evidence', async () => {
  const dealId = '00000000-0000-0000-0000-0000000000e2';
  const dioId = '00000000-0000-4000-8000-00000000c002';
  const docId = '00000000-0000-4000-8000-00000000f002';

  const dio = baseDio(dealId, 1);
  dio.dio_id = dioId;

  const dpuRows = [
    // Good overview/product/market candidates
    {
      document_id: docId,
      page_index: 0,
      payload: {
        source: { extracted_at: now },
        structured: {
          title: 'Overview',
          bullets: ['A workflow automation platform for SMB finance teams; reduces close time and improves accuracy.'],
        },
      },
    },
    {
      document_id: docId,
      page_index: 2,
      payload: {
        source: { extracted_at: now },
        structured: {
          title: 'Product',
          bullets: ['Automates AP/AR workflows with integrations and approvals; includes reporting and audit trails.'],
        },
      },
    },
    {
      document_id: docId,
      page_index: 4,
      payload: {
        source: { extracted_at: now },
        structured: {
          title: 'Market',
          bullets: ['ICP: SMB finance leaders; target segments include multi-location operators and services firms.'],
        },
      },
    },
    // Disallowed primary pages (should not become identity evidence)
    {
      document_id: docId,
      page_index: 19,
      payload: {
        source: { extracted_at: now },
        structured: {
          title: 'Team',
          bullets: ['Hiring plan: expand sales headcount and recruit engineering leadership.'],
        },
      },
    },
    {
      document_id: docId,
      page_index: 20,
      payload: {
        source: { extracted_at: now },
        structured: {
          title: 'Capital Raise',
          bullets: ['Raising $5M Seed SAFE with $20M cap. Use of funds: hiring and product.'],
        },
      },
    },
  ];

  const logs: any[] = [];

  const mockPool = {
    query: async (sql: string, params?: unknown[]) => {
      const q = String(sql);
      if (q.includes('FROM deals') && q.includes('WHERE id = $1') && q.includes('deleted_at IS NULL')) {
        assert.deepEqual(params, [dealId]);
        return { rows: [{ id: dealId, llm_phase_mode: null }] };
      }
      if (q.includes('FROM deal_intelligence_objects') && q.includes('WHERE deal_id = $1')) {
        assert.deepEqual(params, [dealId]);
        return {
          rows: [
            {
              dio_id: dioId,
              analysis_version: 1,
              recommendation: null,
              overall_score: null,
              dio_data: dio,
              updated_at: now,
            },
          ],
        };
      }
      if (q.includes('MAX(dpu.created_at)')) {
        return { rows: [{ latest_dpu_created_at: now }] };
      }
      if (q.includes('SELECT 1 FROM evidence_items')) {
        return { rows: [{ ok: 1 }], rowCount: 1 };
      }
      if (q.includes("FROM evidence_items") && q.includes("source_type IN ('promoted_slide_fact','business_model_fact')")) {
        assert.deepEqual(params, [dealId]);
        return { rows: [] };
      }
      if (q.includes('SELECT 1 FROM document_page_understanding')) {
        return { rows: [{ ok: 1 }], rowCount: 1 };
      }
      if (q.includes('FROM public.document_page_understanding') && q.includes("version = 'page_understanding_v1'")) {
        assert.deepEqual(params, [dealId]);
        return { rows: dpuRows };
      }
      if (q.includes('FROM visual_assets') && q.includes('quality_flags')) {
        return { rows: [] };
      }
      throw new Error(`Unexpected SQL in test: ${q}`);
    },
  } as any;

  const app = Fastify({
    logger: {
      level: 'info',
      stream: {
        write: (msg: string) => {
          try {
            logs.push(JSON.parse(msg));
          } catch {
            // ignore
          }
        },
      },
    },
  });

  try {
    await registerReportRoutes(app, mockPool);
    const res = await app.inject({ method: 'GET', url: `/api/v1/deals/${dealId}/report?debug_deal_summary=1` });
    assert.equal(res.statusCode, 200);

    const evt = logs.find((l) => l && l.event === 'deal.report.deal_summary_debug');
    assert.ok(evt, 'Expected deal.report.deal_summary_debug log event');

    assert.equal(evt.deal_id, dealId);
    assert.equal(evt.dio_id, dioId);

    // Selection path should be overview-first for identity/one-liner.
    assert.equal(evt.selection_path?.identity_pick, 'overview_first');

    const oneLinerSources = Array.isArray(evt.selected?.sources?.one_liner) ? evt.selected.sources.one_liner : [];
    assert.ok(oneLinerSources.length > 0, 'Expected one_liner sources in debug event');
    const s0 = oneLinerSources[0];
    assert.ok(typeof s0.page_index === 'number');
    assert.notEqual(s0.page_index, 19);
    assert.notEqual(s0.page_index, 20);
    assert.notEqual(s0.segment_key, 'team');
    assert.notEqual(s0.segment_key, 'raise_terms');
    assert.notEqual(s0.segment_key, 'financials');

    // Candidates should include disallowed pages as ineligible primary.
    const overviewCands = Array.isArray(evt.candidates?.overview) ? evt.candidates.overview : [];
    const teamCand = overviewCands.find((c: any) => c && c.page_index === 19);
    if (teamCand) {
      assert.equal(teamCand.eligible_primary, false);
      assert.ok(Array.isArray(teamCand.primary_exclude_reasons));
      assert.ok(teamCand.primary_exclude_reasons.some((r: string) => r.includes('team') || r.includes('hiring')));
    }
  } finally {
    await app.close();
  }
});

test("GET /api/v1/deals/:deal_id/report prefers promoted facts for raise and business_model", async () => {
  const dealId = "00000000-0000-0000-0000-0000000000c4";
  const dioId = "00000000-0000-4000-8000-00000000a004";
  const docId = "00000000-0000-4000-8000-00000000d002";

  const dio = baseDio(dealId, 1);
  dio.dio_id = dioId;
  dio.dio = {
    phase1: {
      executive_summary_v1: {
        title: "Exec summary",
        one_liner: "A CPG brand",
        deal_type: "Primary equity",
        raise: "$2M Seed",
        business_model: "DTC",
        traction_signals: [],
        key_risks_detected: [],
        unknowns: [],
        confidence: { overall: "med", sections: { raise: "med", business_model: "med" } },
        evidence: [],
      },
      decision_summary_v1: {
        score: 50,
        recommendation: "CONSIDER",
        reasons: [],
        blockers: [],
        next_requests: [],
        confidence: "med",
      },
      claims: [],
      coverage: { sections: {} },
    },
  };

  const promotedRows = [
    {
      evidence_id: `deal:${dealId}:fact:raise_terms_v1`,
      deal_id: dealId,
      source_type: "promoted_slide_fact",
      source_path: `doc:${docId}:page:7`,
      source_document_id: docId,
      confidence: 0.9,
      extracted_at: now,
      content_json: {
        fact_type: "raise_terms_v1",
        value_json: { display: "$3M Seed SAFE cap $10M", amount: { amount: 3000000, currency: "USD" } },
      },
      meta: { document_id: docId, page_index: 6 },
    },
    {
      evidence_id: `deal:${dealId}:fact:business_model_v1`,
      deal_id: dealId,
      source_type: "promoted_slide_fact",
      source_path: `doc:${docId}:page:5`,
      source_document_id: docId,
      confidence: 0.85,
      extracted_at: now,
      content_json: {
        fact_type: "business_model_v1",
        value_json: { display: "Omnichannel", model: "omnichannel" },
      },
      meta: { document_id: docId, page_index: 4 },
    },
  ];

  // Seed segmented DPU nodes so business_model_summary_v1 can be synthesized in parallel.
  const dpuRows = [
    // Product
    {
      document_id: docId,
      page_index: 12,
      payload: { source: { extracted_at: now }, structured: { title: "Product", bullets: ["Premium golf apparel and accessories for lifestyle and performance."] } },
    },
    {
      document_id: docId,
      page_index: 13,
      payload: { source: { extracted_at: now }, structured: { segment_key: "product", title: "Accessories", bullets: ["Apparel, accessories, and lifestyle collection expansion."] } },
    },
    // GTM / Distribution
    {
      document_id: docId,
      page_index: 15,
      payload: { source: { extracted_at: now }, structured: { title: "Go to Market", bullets: ["DTC via website plus wholesale expansion into green grass retailers."] } },
    },
    {
      document_id: docId,
      page_index: 23,
      payload: { source: { extracted_at: now }, structured: { segment_key: "distribution", title: "Distribution", bullets: ["Omni-channel marketing to support DTC and wholesale growth."] } },
    },
    // Traction
    {
      document_id: docId,
      page_index: 8,
      payload: { source: { extracted_at: now }, structured: { segment_key: "traction", title: "Traction", bullets: ["Website conversion and revenue attribution show DTC traction."] } },
    },
  ];

  const mockPool = {
    query: async (sql: string, params?: unknown[]) => {
      const q = String(sql);
      if (q.includes("FROM deals") && q.includes("WHERE id = $1") && q.includes("deleted_at IS NULL")) {
        assert.deepEqual(params, [dealId]);
        return { rows: [{ id: dealId, llm_phase_mode: null }] };
      }
      if (q.includes("FROM deal_intelligence_objects") && q.includes("WHERE deal_id = $1")) {
        assert.deepEqual(params, [dealId]);
        return {
          rows: [
            {
              dio_id: dioId,
              analysis_version: 1,
              recommendation: null,
              overall_score: null,
              dio_data: dio,
              updated_at: now,
            },
          ],
        };
        if (q.includes("SELECT 1 FROM evidence_items")) {
          return { rows: [{ ok: 1 }], rowCount: 1 };
        }
      }
      if (q.includes("SELECT 1 FROM evidence_items")) {
        return { rows: [{ ok: 1 }], rowCount: 1 };
      }
      if (q.includes("FROM evidence_items") && q.includes("source_type IN ('promoted_slide_fact','business_model_fact')")) {
        assert.deepEqual(params, [dealId]);
        return { rows: promotedRows };
      }
      if (q.includes("FROM public.document_page_understanding") && q.includes("version = 'page_understanding_v1'")) {
        assert.deepEqual(params, [dealId]);
        return { rows: dpuRows };
      }
      if (q.includes("FROM visual_assets") && q.includes("quality_flags")) {
        return { rows: [] };
      }
      throw new Error(`Unexpected SQL in test: ${q}`);
    },
  } as any;

  const app = Fastify();
  try {
    await registerReportRoutes(app, mockPool);
    const res = await app.inject({ method: "GET", url: `/api/v1/deals/${dealId}/report` });
    assert.equal(res.statusCode, 200);
    const body = res.json() as any;

    assert.equal(body.ready, true);
    assert.equal(body.structured_summary.raise?.value, "$3M Seed SAFE cap $10M");
    assert.equal(body.structured_summary.business_model?.value, "Omnichannel");

    assert.ok(body.structured_summary.business_model_summary);
    assert.ok(body.structured_summary.business_model_summary.value);
    assert.ok(body.structured_summary.business_model_summary.derived_from);
    assert.ok(body.structured_summary.business_model_summary.derived_from.product_pages.includes(12));
    assert.ok(body.structured_summary.business_model_summary.derived_from.product_pages.includes(13));
    assert.ok(body.structured_summary.business_model_summary.derived_from.gtm_pages.includes(15));
    assert.ok(body.structured_summary.business_model_summary.derived_from.gtm_pages.includes(23));

    assert.ok(Array.isArray(body.promoted_facts));
    assert.equal(body.promoted_facts.length, 2);
  } finally {
    await app.close();
  }
});

test("GET /api/v1/deals/:deal_id/report_diagnostics computes staleness from dio.meta.min_dpu_created_at", async () => {
  const dealId = "00000000-0000-0000-0000-0000000000d1";
  const dioId = "00000000-0000-4000-8000-00000000a111";
  const docId = "00000000-0000-4000-8000-00000000d222";

  const dio = baseDio(dealId, 1);
  dio.dio_id = dioId;
  dio.meta = {
    min_dpu_created_at: "2026-02-18T00:18:00.000Z",
  };

  const promotedRows = [
    {
      evidence_id: `deal:${dealId}:fact:business_model_v1`,
      deal_id: dealId,
      source_type: "promoted_slide_fact",
      source_path: `doc:${docId}:page:5`,
      source_document_id: docId,
      confidence: 0.85,
      extracted_at: now,
      content_json: {
        fact_type: "business_model_v1",
        value_json: { display: "Licensing", model: "licensing" },
      },
      meta: { document_id: docId, page_index: 4 },
    },
  ];

  const mockPool = {
    query: async (sql: string, params?: unknown[]) => {
      const q = String(sql);
      if (q.includes("FROM deal_intelligence_objects") && q.includes("WHERE deal_id = $1")) {
        return {
          rows: [
            {
              dio_id: dioId,
              analysis_version: 1,
              input_hash: null,
              updated_at: "2026-02-18T00:18:25.717Z",
              recommendation: null,
              overall_score: null,
              dio_data: dio,
            },
          ],
        };
      }
      if (q.includes("FROM document_page_understanding") && q.includes("MAX(dpu.created_at")) {
        // Latest DPU is newer than the DIO's min_dpu_created_at token => not stale
        return { rows: [{ latest_dpu_created_at: "2026-02-18T00:18:16.566Z" }] };
      }
      if (q.includes("SELECT 1 FROM evidence_items")) {
        return { rows: [{ ok: 1 }], rowCount: 1 };
      }
      if (q.includes("FROM evidence_items") && q.includes("source_type IN ('promoted_slide_fact','business_model_fact')")) {
        return { rows: promotedRows };
      }
      throw new Error(`Unexpected SQL in test: ${q}`);
    },
  } as any;

  const app = Fastify();
  try {
    await registerReportRoutes(app, mockPool);
    const res = await app.inject({ method: "GET", url: `/api/v1/deals/${dealId}/report_diagnostics` });
    assert.equal(res.statusCode, 200);
    const body = res.json() as any;

    assert.equal(body.ok, true);
    assert.equal(body.deal_id, dealId);
    assert.equal(body.dpu?.stale_vs_dio_updated_at, false);
  } finally {
    await app.close();
  }
});

test("GET /api/v1/deals/:deal_id/report surfaces promoted raise with valuation phrasing", async () => {
  const dealId = "00000000-0000-0000-0000-0000000000c5";
  const dioId = "00000000-0000-4000-8000-00000000a005";
  const docId = "00000000-0000-4000-8000-00000000d003";

  const dio = baseDio(dealId, 1);
  dio.dio_id = dioId;
  dio.dio = {
    phase1: {
      executive_summary_v1: {
        title: "Exec summary",
        one_liner: "A company",
        deal_type: "Primary equity",
        raise: "Unknown",
        business_model: "Licensing",
        traction_signals: [],
        key_risks_detected: [],
        unknowns: [],
        confidence: { overall: "low", sections: { raise: "low", business_model: "low" } },
        evidence: [],
      },
      decision_summary_v1: {
        score: 40,
        recommendation: "CONSIDER",
        reasons: [],
        blockers: [],
        next_requests: [],
        confidence: "low",
      },
      claims: [],
      coverage: { sections: {} },
    },
  };

  const promotedRows = [
    {
      evidence_id: `deal:${dealId}:fact:raise_terms_v1`,
      deal_id: dealId,
      source_type: "promoted_slide_fact",
      source_path: `doc:${docId}:page:20`,
      source_document_id: docId,
      confidence: 0.9,
      extracted_at: now,
      content_json: {
        fact_type: "raise_terms_v1",
        value_json: {
          display: "$1.5M Equity @ $6M valuation",
          amount: { amount: 1500000, currency: "USD" },
          instrument: "Equity",
          valuation: { amount: 6000000, currency: "USD" },
        },
      },
      meta: { document_id: docId, page_index: 19 },
    },
  ];

  const mockPool = {
    query: async (sql: string, params?: unknown[]) => {
      const q = String(sql);
      if (q.includes("FROM deals") && q.includes("WHERE id = $1") && q.includes("deleted_at IS NULL")) {
        assert.deepEqual(params, [dealId]);
        return { rows: [{ id: dealId, llm_phase_mode: null }] };
      }
      if (q.includes("FROM deal_intelligence_objects") && q.includes("WHERE deal_id = $1")) {
        assert.deepEqual(params, [dealId]);
        return {
          rows: [
            {
              dio_id: dioId,
              analysis_version: 1,
              recommendation: null,
              overall_score: null,
              dio_data: dio,
              updated_at: now,
            },
          ],
        };
      }
      if (q.includes("SELECT 1 FROM evidence_items")) {
        return { rows: [{ ok: 1 }], rowCount: 1 };
      }
      if (q.includes("FROM evidence_items") && q.includes("source_type IN ('promoted_slide_fact','business_model_fact')")) {
        assert.deepEqual(params, [dealId]);
        return { rows: promotedRows };
      }
      if (q.includes("FROM public.document_page_understanding") && q.includes("version = 'page_understanding_v1'")) {
        assert.deepEqual(params, [dealId]);
        return { rows: [] };
      }
      if (q.includes("FROM visual_assets") && q.includes("quality_flags")) {
        return { rows: [] };
      }
      throw new Error(`Unexpected SQL in test: ${q}`);
    },
  } as any;

  const app = Fastify();
  try {
    await registerReportRoutes(app, mockPool);
    const res = await app.inject({ method: "GET", url: `/api/v1/deals/${dealId}/report` });
    assert.equal(res.statusCode, 200);
    const body = res.json() as any;

    assert.equal(body.ready, true);
  // Normalized to amount-only, valuation moved to a note for citations.
    assert.equal(body.structured_summary.raise?.value, "$1.5MM");
  assert.ok(
    Array.isArray(body.structured_summary.raise?.sources) &&
    String(body.structured_summary.raise?.sources?.[0]?.note ?? "").includes("$6MM")
  );
  } finally {
    await app.close();
  }
});

test("GET /api/v1/deals/:deal_id/report derives raise + business_model from document_page_understanding when promoted facts are missing", async () => {
  const dealId = "00000000-0000-0000-0000-0000000000d1";
  const dioId = "00000000-0000-4000-8000-00000000b001";
  const docId = "00000000-0000-4000-8000-00000000e001";

  const dio = baseDio(dealId, 1);
  dio.dio_id = dioId;
  dio.dio = {
    phase1: {
      executive_summary_v1: {
        title: "Exec summary",
        one_liner: "A consumer brand",
        deal_type: "Primary equity",
        raise: "Unknown",
        business_model: "Licensing",
        traction_signals: [],
        key_risks_detected: [],
        unknowns: [],
        confidence: { overall: "low", sections: { raise: "low", business_model: "low" } },
        evidence: [],
      },
      decision_summary_v1: {
        score: 40,
        recommendation: "CONSIDER",
        reasons: [],
        blockers: [],
        next_requests: [],
        confidence: "low",
      },
      claims: [],
      coverage: { sections: {} },
    },
  };

  const dpuRows = [
    {
      document_id: docId,
      page_index: 15,
      payload: {
        source: { extracted_at: now },
        structured: {
          title: "Go to Market Strategy",
          bullets: ["Direct via website ecommerce", "Email/SMS owned channels", "Retail expansion"],
        },
      },
    },
    {
      document_id: docId,
      page_index: 22,
      payload: {
        source: { extracted_at: now },
        structured: {
          title: "Strategic Hires & Wholesale Build Out",
          bullets: ["Wholesale partners", "Brick & mortar retail rollout"],
        },
      },
    },
    {
      document_id: docId,
      page_index: 19,
      payload: {
        source: { extracted_at: now },
        structured: {
          title: "Capital Raise",
          bullets: ["$1.5MM raise on a $6MM valuation"],
        },
      },
    },
  ];

  const mockPool = {
    query: async (sql: string, params?: unknown[]) => {
      const q = String(sql);
      if (q.includes("FROM deals") && q.includes("WHERE id = $1") && q.includes("deleted_at IS NULL")) {
        assert.deepEqual(params, [dealId]);
        return { rows: [{ id: dealId, llm_phase_mode: null }] };
      }
      if (q.includes("FROM deal_intelligence_objects") && q.includes("WHERE deal_id = $1")) {
        assert.deepEqual(params, [dealId]);
        return {
          rows: [
            {
              dio_id: dioId,
              analysis_version: 1,
              recommendation: null,
              overall_score: null,
              dio_data: dio,
              updated_at: now,
            },
          ],
        };
      }
      if (q.includes("SELECT 1 FROM evidence_items")) {
        return { rows: [{ ok: 1 }], rowCount: 1 };
      }
      if (q.includes("FROM evidence_items") && q.includes("source_type IN ('promoted_slide_fact','business_model_fact')")) {
        assert.deepEqual(params, [dealId]);
        return { rows: [] };
      }
      if (q.includes("SELECT 1 FROM document_page_understanding")) {
        return { rows: [{ ok: 1 }], rowCount: 1 };
      }
      if (q.includes("FROM public.document_page_understanding") && q.includes("WHERE deal_id = $1::uuid")) {
        assert.deepEqual(params, [dealId]);
        return { rows: dpuRows };
      }
      if (q.includes("FROM visual_assets") && q.includes("quality_flags")) {
        return { rows: [] };
      }
      throw new Error(`Unexpected SQL in test: ${q}`);
    },
  } as any;

  const app = Fastify();
  try {
    await registerReportRoutes(app, mockPool);
    const res = await app.inject({ method: "GET", url: `/api/v1/deals/${dealId}/report` });
    assert.equal(res.statusCode, 200);
    const body = res.json() as any;

    assert.equal(body.ready, true);
    assert.equal(body.structured_summary.business_model?.value, "Omnichannel (DTC + Wholesale/Retail)");
    assert.equal(body.structured_summary.raise?.value, "$1.5MM");

    const bmSources = Array.isArray(body.structured_summary.business_model?.sources)
      ? body.structured_summary.business_model.sources
      : [];
    const raiseSources = Array.isArray(body.structured_summary.raise?.sources) ? body.structured_summary.raise.sources : [];
    assert.ok(bmSources.some((s: any) => s?.page_index === 15));
    assert.ok(raiseSources.some((s: any) => s?.page_index === 19));
  } finally {
    await app.close();
  }
});
