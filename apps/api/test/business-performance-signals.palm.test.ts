process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerReportRoutes } from "../src/routes/reports";

const now = new Date().toISOString();

function dioWithBusinessPerformanceSignals(dealId: string, version: number): any {
  return {
    schema_version: "1.0.0",
    dio_id: "dio-palm-business-performance",
    deal_id: dealId,
    created_at: now,
    updated_at: now,
    analysis_version: version,
    inputs: {
      documents: [
        {
          id: "doc-input-1",
          type: "pitch_deck",
          page_count: 10,
          metrics: [
            { key: "paid_media_conversion_pct", value: "3.4%" },
            { key: "first_party_database_size", value: "120000" },
            { key: "first_party_database_active_pct", value: "42%" },
            { key: "marketing_attributed_revenue_email_sms", value: "$1.2MM" },
          ],
        },
      ],
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
      slide_sequence: {
        analyzer_version: "1.0.0",
        executed_at: now,
        status: "ok",
        coverage: 0.3,
        confidence: 0.8,
        score: 70,
        pattern_match: "OK",
        sequence_detected: [],
        expected_sequence: [],
        deviations: [],
        evidence_ids: [],
      },
      metric_benchmark: {
        analyzer_version: "1.0.0",
        executed_at: now,
        status: "ok",
        coverage: 0.3,
        confidence: 0.8,
        overall_score: 70,
        metrics_analyzed: [{ metric: "CAC", value: "$50" }],
        evidence_ids: [],
      },
      visual_design: {
        analyzer_version: "1.0.0",
        executed_at: now,
        status: "ok",
        coverage: 0.3,
        confidence: 0.8,
        design_score: 70,
        proxy_signals: {},
        strengths: [],
        weaknesses: [],
        evidence_ids: [],
      },
      narrative_arc: {
        analyzer_version: "1.0.0",
        executed_at: now,
        status: "ok",
        coverage: 0.3,
        confidence: 0.8,
        pacing_score: 70,
        archetype: "",
        archetype_confidence: 0,
        emotional_beats: [],
        evidence_ids: [],
      },
      financial_health: {
        analyzer_version: "1.0.0",
        executed_at: now,
        status: "ok",
        coverage: 0.3,
        confidence: 0.8,
        runway_months: null,
        burn_multiple: null,
        health_score: 70,
        metrics: { revenue: null, expenses: null, cash_balance: null, burn_rate: null, growth_rate: null },
        risks: [],
        evidence_ids: [],
      },
      risk_assessment: {
        analyzer_version: "1.0.0",
        executed_at: now,
        status: "ok",
        coverage: 0.3,
        confidence: 0.8,
        overall_risk_score: 35,
        risks_by_category: { market: [], team: [], financial: [], execution: [] },
        total_risks: 0,
        critical_count: 0,
        high_count: 0,
        evidence_ids: [],
      },
    },
    planner_state: { cycle: 0, goals: [], constraints: [], hypotheses: [], subgoals: [], focus: "", stop_reason: null },
    fact_table: [],
    ledger_manifest: {
      cycles: 0,
      depth_delta: [],
      subgoals: 0,
      constraints: 0,
      dead_ends: 0,
      paraphrase_invariance: 0,
      calibration: { brier: 0 },
      total_facts_added: 0,
      total_evidence_cited: 0,
      uncertain_claims: 0,
    },
    risk_map: [],
    decision: {
      recommendation: "CONDITIONAL",
      confidence: 0.5,
      tranche_plan: { t0_amount: null, milestones: [] },
      verification_checklist: [],
      key_strengths: [],
      key_weaknesses: [],
      evidence_ids: [],
    },
    narrative: { llm_version: "", generated_at: now, token_usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0, estimated_cost: 0 }, executive_summary: "" },
    execution_metadata: { started_at: now, completed_at: now, duration_ms: 0, errors: [], warnings: [], analyzer_execution: [] },
  };
}

function mkMockPool(args: {
  dealId: string;
  dioId: string;
  dio: any;
  dpuRows: Array<{ document_id: string; page_index: number; payload: any }>;
}): any {
  return {
    query: async (sql: string, params?: unknown[]) => {
      const q = String(sql);
      if (q.includes("SELECT id FROM deals") && q.includes("deleted_at IS NULL")) {
        assert.deepEqual(params, [args.dealId]);
        return { rows: [{ id: args.dealId }] };
      }
      if (q.includes("FROM deal_intelligence_objects") && q.includes("WHERE deal_id = $1")) {
        assert.deepEqual(params, [args.dealId]);
        return {
          rows: [
            {
              dio_id: args.dioId,
              analysis_version: 1,
              recommendation: null,
              overall_score: null,
              dio_data: args.dio,
              updated_at: now,
            },
          ],
        };
      }
      if (q.includes("SELECT 1 FROM evidence_items")) return { rows: [{ ok: 1 }], rowCount: 1 };
      if (q.includes("SELECT 1 FROM document_page_understanding")) return { rows: [{ ok: 1 }], rowCount: 1 };
      if (q.includes("FROM evidence_items") && q.includes("source_type IN ('promoted_slide_fact','business_model_fact')")) {
        return { rows: [] };
      }
      if (q.includes("FROM public.document_page_understanding")) {
        assert.deepEqual(params, [args.dealId]);
        return { rows: args.dpuRows.map((r) => ({ document_id: r.document_id, page_index: r.page_index, payload: r.payload })) };
      }
      if (q.includes("FROM visual_assets") && q.includes("quality_flags")) return { rows: [] };
      throw new Error(`Unexpected SQL in test: ${q}`);
    },
  };
}

function dpuRowsBusinessPerformance(docId: string): Array<{ document_id: string; page_index: number; payload: any }> {
  const pages: Array<{ page_index: number; title: string; bullets: string[] }> = [
    {
      page_index: 0,
      title: "Business Performance",
      bullets: ["Paid media conversion 3.4%", "First party database 120k (42% active)", "Revenue attributed to email/SMS $1.2MM"],
    },
  ];
  return pages.map((p) => ({
    document_id: docId,
    page_index: p.page_index,
    payload: {
      structured: { title: p.title, bullets: p.bullets },
      source: { visual_asset_id: "00000000-0000-4000-8000-00000000b0ac" },
    },
  }));
}

test("Palm: Business Performance signals appear in strengths and overview KPIs", async () => {
  const dealId = "00000000-0000-4000-8000-00000000b001";
  const dioId = "dio-bp01";
  const docId = "doc-bp01";

  const dio = dioWithBusinessPerformanceSignals(dealId, 1);
  const pool = mkMockPool({ dealId, dioId, dio, dpuRows: dpuRowsBusinessPerformance(docId) });

  const app = Fastify({ logger: false });
  await registerReportRoutes(app as any, pool as any);

  try {
    const res = await app.inject({ method: "GET", url: `/api/v1/deals/${dealId}/report` });
    assert.equal(res.statusCode, 200);
    const body = res.json() as any;

    const strengths: any[] = body?.report?.metadata?.score_explanation?.understanding_v1?.strengths ?? [];
    assert.ok(Array.isArray(strengths));
    assert.ok(strengths.some((s) => typeof s?.text === "string" && s.text.includes("Business Performance")));

    const kpis: any[] = body?.report?.metadata?.deterministic_score_inputs_v1?.kpis ?? [];
    assert.ok(Array.isArray(kpis));

    const byKey = (k: string) => kpis.find((x) => x && String(x.key) === k);
    assert.ok(byKey("paid_media_conversion_pct")?.value_raw);
    assert.ok(byKey("first_party_database_size")?.value_raw);
    assert.ok(byKey("first_party_database_active_pct")?.value_raw);
    assert.ok(byKey("marketing_attributed_revenue_email_sms")?.value_raw);
  } finally {
    await app.close();
  }
});
