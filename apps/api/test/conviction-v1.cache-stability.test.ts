process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerReportRoutes } from "../src/routes/reports";

const now = new Date().toISOString();

function makeDio(dealId: string, policyId: string): any {
  return {
    schema_version: "1.0.0",
    dio_id: "00000000-0000-4000-8000-00000000e101",
    deal_id: dealId,
    created_at: now,
    updated_at: now,
    analysis_version: 1,
    policy_id: policyId,
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
      slide_sequence: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 0.8, confidence: 0.8, score: 72, pattern_match: "ok", sequence_detected: [], expected_sequence: [], deviations: [], evidence_ids: ["ev-slide"] },
      metric_benchmark: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 0.7, confidence: 0.8, overall_score: 74, metrics_analyzed: [], evidence_ids: ["ev-metric"] },
      visual_design: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 0.6, confidence: 0.7, design_score: 68, proxy_signals: {}, strengths: [], weaknesses: [], evidence_ids: ["ev-visual"] },
      narrative_arc: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 0.6, confidence: 0.7, pacing_score: 70, archetype: "", archetype_confidence: 0, emotional_beats: [], evidence_ids: ["ev-arc"] },
      financial_health: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 0.5, confidence: 0.7, runway_months: 12, burn_multiple: 1.2, health_score: 73, metrics: { revenue: null, expenses: null, cash_balance: null, burn_rate: null, growth_rate: null }, risks: [], evidence_ids: ["ev-fin"] },
      risk_assessment: { analyzer_version: "1.0.0", executed_at: now, status: "ok", coverage: 0.5, confidence: 0.7, overall_risk_score: 28, risks_by_category: { market: [], team: [], financial: [], execution: [] }, total_risks: 1, critical_count: 0, high_count: 0, evidence_ids: ["ev-risk"] },
    },
    planner_state: { cycle: 0, goals: [], constraints: [], hypotheses: [], subgoals: [], focus: "", stop_reason: null },
    fact_table: [],
    ledger_manifest: { cycles: 0, depth_delta: [], subgoals: 0, constraints: 0, dead_ends: 0, paraphrase_invariance: 0, calibration: { brier: 0 }, total_facts_added: 0, total_evidence_cited: 0, uncertain_claims: 0 },
    risk_map: [],
    decision: { recommendation: "CONDITIONAL", confidence: 0.5, tranche_plan: { t0_amount: null, milestones: [] }, verification_checklist: [], key_strengths: [], key_weaknesses: [], evidence_ids: [] },
    narrative: { llm_version: "", generated_at: now, token_usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0, estimated_cost: 0 }, executive_summary: "" },
    execution_metadata: { started_at: now, completed_at: now, duration_ms: 0, errors: [], warnings: [], analyzer_execution: [] },
  };
}

function makePool(dealId: string, dio: any): any {
  let cachedSummary: any = null;

  return {
    query: async (sql: string, params?: unknown[]) => {
      const q = String(sql);

      if (q.includes("FROM ingestion_reports") && q.includes("analysis_version")) {
        return { rows: cachedSummary ? [{ summary: cachedSummary }] : [] };
      }

      if (q.includes("INSERT INTO ingestion_reports") && q.includes("ON CONFLICT (deal_id, analysis_version)")) {
        cachedSummary = params?.[3] ?? null;
        return { rows: [{ report_id: "ir-conviction-cache" }] };
      }

      if (q.includes("FROM deals") && q.includes("WHERE id = $1") && q.includes("deleted_at IS NULL")) {
        assert.deepEqual(params, [dealId]);
        return { rows: [{ id: dealId, llm_phase_mode: null }] };
      }

      if (q.includes("FROM deal_intelligence_objects") && q.includes("WHERE deal_id = $1")) {
        assert.deepEqual(params, [dealId]);
        return {
          rows: [
            {
              dio_id: dio.dio_id,
              analysis_version: 1,
              recommendation: null,
              overall_score: null,
              dio_data: dio,
              updated_at: now,
            },
          ],
        };
      }

      if (q.includes("SELECT 1 FROM evidence_items") || q.includes("SELECT 1 FROM document_page_understanding")) {
        return { rows: [{ ok: 1 }], rowCount: 1 };
      }

      if (q.includes("source_type IN ('promoted_slide_fact','business_model_fact')")) {
        return { rows: [] };
      }

      if (q.includes("FROM public.document_page_understanding") || q.includes("FROM visual_assets") || q.includes("FROM visual_extractions")) {
        return { rows: [] };
      }

      if (q.includes("FROM financial_facts_v1") || q.includes("FROM documents")) {
        return { rows: [] };
      }

      // Fail-open for non-critical read paths that are irrelevant to conviction_v1 assertions.
      return { rows: [] };
    },
  };
}

test("conviction_v1 is emitted and cache-stable across cache miss/hit", async () => {
  const dealId = "00000000-0000-4000-8000-00000000e201";
  const dio = makeDio(dealId, "operating_startup_revenue_v1");
  const pool = makePool(dealId, dio);

  const app = Fastify({ logger: false });
  await registerReportRoutes(app as any, pool as any);

  const res1 = await app.inject({ method: "GET", url: `/api/v1/deals/${dealId}/report` });
  assert.equal(res1.statusCode, 200);
  const body1 = res1.json() as any;
  const c1 = body1?.report?.conviction_v1 ?? body1?.conviction_v1;

  assert.ok(c1);
  assert.equal(c1.schema_version, "conviction_v1");
  assert.equal(c1.selected_policy_id, "operating_startup_revenue_v1");
  assert.ok(Array.isArray(c1.lineage?.source_artifacts));

  const res2 = await app.inject({ method: "GET", url: `/api/v1/deals/${dealId}/report` });
  assert.equal(res2.statusCode, 200);
  const body2 = res2.json() as any;
  const c2 = body2?.report?.conviction_v1 ?? body2?.conviction_v1;

  assert.deepEqual(c2, c1);

  await app.close();
});

test("conviction_v1 preserves selected_policy_id for real-estate policy", async () => {
  const dealId = "00000000-0000-4000-8000-00000000e301";
  const dio = makeDio(dealId, "real_estate_underwriting");
  const pool = makePool(dealId, dio);

  const app = Fastify({ logger: false });
  await registerReportRoutes(app as any, pool as any);

  const res = await app.inject({ method: "GET", url: `/api/v1/deals/${dealId}/report` });
  assert.equal(res.statusCode, 200);

  const body = res.json() as any;
  const conviction = body?.report?.conviction_v1 ?? body?.conviction_v1;
  assert.equal(conviction?.selected_policy_id, "real_estate_underwriting");

  await app.close();
});
