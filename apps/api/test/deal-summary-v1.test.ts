process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerReportRoutes } from "../src/routes/reports";

const now = new Date().toISOString();

// Keep this schema-valid enough for compileDIOToReport().
const baseDio = (dealId: string, version: number): any => ({
  schema_version: "1.0.0",
  dio_id: "00000000-0000-4000-8000-00000000b001",
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
  ledger_manifest: { cycles: 0, depth_delta: [], subgoals: 0, constraints: 0, dead_ends: 0, paraphrase_invariance: 0, calibration: { brier: 0 }, total_facts_added: 0, total_evidence_cited: 0, uncertain_claims: 0, uncertain_claims_count: 0 },
  risk_map: [],
  decision: { recommendation: "CONDITIONAL", confidence: 0.5, tranche_plan: { t0_amount: null, milestones: [] }, verification_checklist: [], key_strengths: [], key_weaknesses: [], evidence_ids: [] },
  narrative: { llm_version: "", generated_at: now, token_usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0, estimated_cost: 0 }, executive_summary: "" },
  execution_metadata: { started_at: now, completed_at: now, duration_ms: 0, errors: [], warnings: [], analyzer_execution: [] },
});

test("/report includes deterministic deal_summary_v1 with segment-pure citations", async () => {
  const dealId = "00000000-0000-0000-0000-0000000000d1";
  const dioId = "00000000-0000-4000-8000-00000000b002";

  const dio = baseDio(dealId, 1);
  dio.dio_id = dioId;

  const docId = "00000000-0000-4000-8000-00000000e001";
  const vaProduct = "00000000-0000-4000-8000-00000000f001";

  const dpuRows = [
    {
      document_id: docId,
      page_index: 0,
      payload: {
        source: { extracted_at: now, visual_asset_id: vaProduct },
        structured: {
          title: "Product",
          bullets: ["A workflow automation platform that connects tools and reduces manual ops."],
          segment_key: null,
        },
      },
    },
    {
      document_id: docId,
      page_index: 1,
      payload: {
        source: { extracted_at: now },
        structured: {
          title: "Market / ICP",
          bullets: ["Target customers are mid-market operations teams in logistics and field services."],
          segment_key: "market",
        },
      },
    },
    {
      document_id: docId,
      page_index: 2,
      payload: {
        source: { extracted_at: now },
        structured: {
          title: "Company Overview",
          bullets: ["We help operations teams automate complex workflows across existing systems."],
          segment_key: "overview",
        },
      },
    },
    {
      document_id: docId,
      page_index: 3,
      payload: {
        source: { extracted_at: now },
        structured: {
          title: "Team",
          bullets: ["CEO previously scaled a $100M revenue business."],
          segment_key: "team",
        },
      },
    },
  ];

  const mockPool = {
    query: async (sql: string, params?: unknown[]) => {
      const q = String(sql);

      if (q.includes("SELECT id FROM deals") && q.includes("deleted_at IS NULL")) {
        assert.deepEqual(params, [dealId]);
        return { rows: [{ id: dealId }] };
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
        return { rows: dpuRows };
      }

      if (q.includes("FROM visual_assets") && q.includes("quality_flags")) {
        assert.deepEqual(params, [[vaProduct]]);
        return {
          rows: [
            {
              id: vaProduct,
              quality_flags: { segment_key: "product", segment_source: "vision_v1", segment_confidence: 0.9 },
            },
          ],
        };
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
    assert.ok(body.deal_summary);
    assert.equal(body.deal_summary.version, "deal_summary_v1");
    assert.equal(body.deal_summary.ready, true);

    assert.equal(typeof body.deal_summary.one_liner?.text, "string");
    assert.equal(body.deal_summary.product?.text, "A workflow automation platform that connects tools and reduces manual ops.");
    assert.equal(body.deal_summary.market?.text, "Target customers are mid-market operations teams in logistics and field services.");

    const productSrc = body.deal_summary.product?.sources?.[0];
    const marketSrc = body.deal_summary.market?.sources?.[0];

    assert.equal(productSrc?.page_index, 0);
    assert.equal(productSrc?.segment_key, "product");
    assert.equal(productSrc?.source_document_id, docId);

    assert.equal(marketSrc?.page_index, 1);
    assert.equal(marketSrc?.segment_key, "market");
    assert.equal(marketSrc?.source_document_id, docId);

    // Segment purity: product line must not cite market/team pages.
    assert.ok(!String(productSrc?.slide_title ?? "").toLowerCase().includes("market"));
    assert.ok(!String(productSrc?.slide_title ?? "").toLowerCase().includes("team"));
  } finally {
    await app.close();
  }
});

test("/report deterministic deal_summary_v1 market line avoids fluff cover slides", async () => {
  const dealId = "00000000-0000-0000-0000-0000000000d2";
  const dioId = "00000000-0000-4000-8000-00000000b003";

  const dio = baseDio(dealId, 1);
  dio.dio_id = dioId;

  const docId = "00000000-0000-4000-8000-00000000e002";

  const dpuRows = [
    {
      document_id: docId,
      page_index: 0,
      payload: {
        source: { extracted_at: now },
        structured: {
          title: "Opportunity",
          bullets: ["Unlock the Potential"],
          segment_key: "market",
        },
      },
    },
    {
      document_id: docId,
      page_index: 1,
      payload: {
        source: { extracted_at: now },
        structured: {
          title: "Industry Outlook",
          bullets: ["The market has 60M participants and is a $20B+ opportunity with clear segment dynamics."],
          segment_key: "market",
        },
      },
    },
    {
      document_id: docId,
      page_index: 2,
      payload: {
        source: { extracted_at: now },
        structured: {
          title: "Palm is poised",
          bullets: ["Palm is poised to win by focusing on the 8-14 age segment and leveraging strong participation trends."],
          segment_key: "market",
        },
      },
    },
    {
      document_id: docId,
      page_index: 3,
      payload: {
        source: { extracted_at: now },
        structured: {
          title: "Product",
          bullets: ["A scheduling and payments platform that simplifies league operations for coaches and parents."],
          segment_key: "product",
        },
      },
    },
    {
      document_id: docId,
      page_index: 4,
      payload: {
        source: { extracted_at: now },
        structured: {
          title: "Company Overview",
          bullets: ["We help youth sports organizations manage registrations, scheduling, and payments in one system."],
          segment_key: "overview",
        },
      },
    },
  ];

  const mockPool = {
    query: async (sql: string, params?: unknown[]) => {
      const q = String(sql);

      if (q.includes("SELECT id FROM deals") && q.includes("deleted_at IS NULL")) {
        assert.deepEqual(params, [dealId]);
        return { rows: [{ id: dealId }] };
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
        return { rows: dpuRows };
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
    assert.ok(body.deal_summary);
    assert.equal(body.deal_summary.version, "deal_summary_v1");
    assert.equal(body.deal_summary.ready, true);

    const market = body.deal_summary.market;
    assert.ok(market);
    const marketSrc = market.sources?.[0];
    assert.ok(marketSrc);

    // Market should not come from the page 0 cover/opportunity fluff slide.
    assert.ok(marketSrc.page_index === 1 || marketSrc.page_index === 2);
    assert.ok(!String(market.text ?? "").toLowerCase().startsWith("unlock the potential"));
  } finally {
    await app.close();
  }
});
