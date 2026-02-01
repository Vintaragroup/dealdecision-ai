import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import type { Pool } from "pg";

import { registerDashboardRoutes } from "../src/routes/dashboard";

function makePoolMock(row: any): Pool {
  return {
    // minimal Pool shape for this route
    query: async () => ({ rows: [row] }),
  } as unknown as Pool;
}

test("/api/dashboard/reports returns latest DIO per deal (analysis_version, updated_at tie-break) and includes dealName + dioId", async () => {
  const app = Fastify();

  const dealId = "deal_latest_1";

  const makeDioData = (primaryDocType: string, analysisVersion: number) => ({
    deal_id: dealId,
    analysis_version: analysisVersion,
    analyzer_results: {
      slide_sequence: {
        status: "ok",
        score: 80,
        pattern_match: "standard",
        deviations: [],
        evidence_ids: [],
      },
      visual_design: {
        status: "ok",
        design_score: 75,
        strengths: [],
        weaknesses: [],
      },
      narrative_arc: {
        status: "ok",
        pacing_score: 70,
        archetype: "problem-solution",
      },
      metric_benchmark: {
        status: "ok",
        overall_score: 65,
        metrics_analyzed: [],
      },
      financial_health: {
        status: "ok",
        health_score: 60,
        risks: [],
      },
      risk_assessment: {
        status: "ok",
        overall_risk_score: 40,
        risks_by_category: { market: [], team: [], financial: [], execution: [] },
      },
    },
    inputs: {
      documents: [
        {
          id: "doc_1",
          title: "Pitch Deck",
          type: "pitch_deck",
        },
      ],
      evidence: [],
    },
    dio_context: {
      company_name: "Acme",
      sector: "tech",
      primary_doc_type: primaryDocType,
    },
    score_explanation: { context: { primary_doc_type: primaryDocType } },
  });

  const olderRow = {
    dio_id: "dio_old",
    deal_id: dealId,
    analysis_version: 1,
    overall_score: 0.55,
    dio_data: makeDioData("pitch_deck", 1),
    created_at: "2025-12-22T18:00:00.000Z",
    updated_at: "2025-12-22T18:00:00.000Z",
    deal_name: "WebMax",
    documents: [],
  };

  const newerRow = {
    dio_id: "dio_new",
    deal_id: dealId,
    analysis_version: 2,
    overall_score: 0.65,
    dio_data: makeDioData("business_plan_im", 2),
    created_at: "2025-12-22T18:05:00.000Z",
    updated_at: "2025-12-22T18:10:00.000Z",
    deal_name: "WebMax",
    documents: [],
  };

  const mockPool = {
    query: async (sql: string) => {
      // Ensure query expresses the intended selection semantics.
      assert.match(sql, /ROW_NUMBER\(\) OVER \(PARTITION BY dio\.deal_id ORDER BY dio\.analysis_version DESC, dio\.updated_at DESC\)/);
      assert.match(sql, /JOIN deals ON deals\.id = dio\.deal_id/);
      assert.match(sql, /deals\.deleted_at IS NULL/);
      return { rows: [olderRow, newerRow] };
    },
  } as unknown as Pool;

  await registerDashboardRoutes(app, mockPool);

  const res = await app.inject({ method: "GET", url: "/api/dashboard/reports" });
  assert.equal(res.statusCode, 200, `Unexpected status ${res.statusCode}: ${res.body}`);

  const payload = res.json() as any[];
  assert.ok(Array.isArray(payload));
  assert.equal(payload.length, 1);

  const report = payload[0];
  assert.equal(report.dealId, dealId);
  assert.equal(report.dealName, "WebMax");
  assert.equal(report.dioId, "dio_new");
  assert.equal(report?.metadata?.score_explanation?.context?.primary_doc_type, "business_plan_im");
});

test("/api/dashboard/reports includes score_explanation.debug scoring trace", async () => {
  const app = Fastify();

  const dioData = {
    deal_id: "deal_1",
    analysis_version: 3,
    analyzer_results: {
      slide_sequence: {
        status: "ok",
        score: 80,
        pattern_match: "standard",
        deviations: [],
        evidence_ids: [],
      },
      visual_design: {
        status: "ok",
        design_score: 75,
        strengths: [],
        weaknesses: [],
      },
      narrative_arc: {
        status: "ok",
        pacing_score: 70,
        archetype: "problem-solution",
      },
      metric_benchmark: {
        status: "ok",
        overall_score: 65,
        metrics_analyzed: [],
      },
      financial_health: {
        status: "ok",
        health_score: 60,
        risks: [],
      },
      risk_assessment: {
        status: "ok",
        overall_risk_score: 40,
        risks_by_category: { market: [], team: [], financial: [], execution: [] },
      },
    },
    inputs: {
      documents: [
        {
          id: "doc_1",
          title: "Pitch Deck",
          type: "pitch_deck",
        },
      ],
      evidence: [],
    },
    dio_context: {
      company_name: "Acme",
      sector: "tech",
      primary_doc_type: "pitch_deck",
    },
  };

  const row = {
    dio_id: "dio_1",
    deal_id: "deal_1",
    analysis_version: 3,
    overall_score: 0.55,
    dio_data: dioData,
    created_at: new Date().toISOString(),
    deal_name: "Acme",
    documents: [
      {
        id: "doc_1",
        title: "Pitch Deck",
        type: "pitch_deck",
        page_count: 12,
        extraction_metadata: {
          contentType: "application/pdf",
          fileSizeBytes: 12345,
          totalPages: 12,
          totalWords: 3400,
          headingsCount: 18,
          summaryLength: 900,
          completeness: { score: 0.8 },
        },
        structured_data: {
          keyMetrics: [{ name: "ARR", value: "$1M" }],
          keyFinancialMetrics: { revenue: 1000000 },
        },
      },
    ],
  };

  await registerDashboardRoutes(app, makePoolMock(row));

  const res = await app.inject({
    method: "GET",
    url: "/api/dashboard/reports",
  });

  assert.equal(res.statusCode, 200, `Unexpected status ${res.statusCode}: ${res.body}`);
  const payload = res.json() as any;
  assert.ok(Array.isArray(payload));
  assert.equal(payload.length, 1);

  const report = payload[0];

  // Stable identifiers for UI mapping
  assert.equal(report.dealId, "deal_1");
  assert.equal(report.dealName, "Acme");
  assert.ok(report.dioId);

  // Required core fields
  assert.equal(typeof report.overallScore, "number");
  assert.ok(report.recommendation);

  // Required metadata
  assert.equal(report?.metadata?.documentCount, 1);
  assert.equal(report?.metadata?.score_explanation?.context?.primary_doc_type, "pitch_deck");

  const debug = report?.metadata?.score_explanation?.debug;
  assert.ok(debug, "Expected score_explanation.debug to exist");

  assert.ok(Array.isArray(debug.doc_inventory));
  assert.equal(debug.doc_inventory.length, 1);
  assert.equal(debug.doc_inventory[0].document_id, "doc_1");

  assert.ok(debug.analyzer_inputs_used);
  assert.ok(Array.isArray(debug.analyzer_inputs_used.slide_sequence.source_docs));
  assert.equal(debug.analyzer_inputs_used.slide_sequence.source_docs[0], "doc_1");

  assert.deepEqual(debug.context_used, dioData.dio_context);
  assert.ok(debug.inclusion_decisions);
});
