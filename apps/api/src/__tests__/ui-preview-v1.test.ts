import { test } from "node:test";
import assert from "node:assert/strict";
import { buildUiPreviewV1 } from "../lib/ui-preview-v1";

test("buildUiPreviewV1 business model precedence: synthesized beats promoted", () => {
  const report = {
    ready: true,
    metadata: {
      deterministic_score_inputs_v1: { inputs_hash: "x".repeat(64) },
      deterministic_score_preview_v1: {
        enabled: false,
        gate: { drift_assessment: "aligned", blocked_by_drift_misaligned: false },
        baseline: { overall_score: 50, evidence_factor: 0.5, adjustment_factor: 0.5 },
        deterministic: { overall_score: 55, evidence_factor: 0.55, adjustment_factor: 0.55 },
        delta_overall_score: 5,
        applied: false,
        applied_parts: [],
      },
      score_explanation: { totals: { confidence_score: 0.8, overall_score: 50, evidence_factor: 0.5, adjustment_factor: 0.5 } },
    },
    structured_summary: {
      business_model_summary: { value: "SaaS", confidence: 0.9, sources: [{ document_id: "doc-1", page_range: [1, 1] }] },
      business_model: { value: "Should not win" },
    },
  };

  const dto = buildUiPreviewV1({
    report,
    segmented_nodes: [],
    env: { DETERMINISTIC_SCORE_V1_ENABLED: "false" },
  });

  assert.equal(dto.version, "ui_preview_v1");
  assert.equal(dto.header_tiles.business_model.value, "SaaS");
  assert.equal(dto.header_tiles.business_model.badge, "synthesized");
  assert.equal(dto.header_tiles.business_model.selection_trace.selected_from, "structured_summary.business_model_summary");
});

test("buildUiPreviewV1 business model fallback: promoted when synthesized missing", () => {
  const report = {
    ready: true,
    metadata: { score_explanation: { totals: { confidence_score: 0.6 } } },
    structured_summary: {
      business_model: { value: "DTC", confidence: 0.7 },
    },
  };

  const dto = buildUiPreviewV1({
    report,
    segmented_nodes: [],
    env: { DETERMINISTIC_SCORE_V1_ENABLED: "true" },
  });

  assert.equal(dto.header_tiles.business_model.value, "DTC");
  assert.equal(dto.header_tiles.business_model.badge, "promoted");
  assert.equal(dto.header_tiles.business_model.selection_trace.selected_from, "structured_summary.business_model");
});

test("buildUiPreviewV1 degrades gracefully when deterministic_score_preview_v1 missing", () => {
  const report = {
    ready: true,
    metadata: {
      score_explanation: {
        totals: { overall_score: 42, evidence_factor: 0.4, adjustment_factor: 0.4, confidence_score: 0.5 },
        context: { deal_type: "seed" },
      },
    },
    structured_summary: {
      // New behavior: when no tiers exist, fall back to legacy canonical summaries before sections.
      deal_summary_v1: {
        value: "Legacy canonical deal summary.",
        confidence: 0.8,
        sources: [{ document_id: "doc-1", page_index: 1, slide_title: "Overview", snippet: "..." }],
      },
    },
    sections: [{ id: "executive-summary", content: "Legacy executive summary." }],
  };

  const dto = buildUiPreviewV1({
    report,
    segmented_nodes: [],
    env: { DETERMINISTIC_SCORE_V1_ENABLED: "true" },
  });

  assert.equal(dto.score.enabled, true);
  assert.equal(dto.score.applied, false);
  assert.equal(dto.score.deterministic.overall_score, null);
  assert.equal(dto.score.baseline.overall_score, 42);
  assert.equal(dto.summaries.deal_summary.value, "Legacy canonical deal summary.");
});

test("plumbs revenue scope_label + selection_reason", () => {
  const report = {
    ready: true,
    metadata: {
      score_explanation: { totals: { confidence_score: 0.7 } },
    },
    structured_summary: {
      revenue: {
        value_raw: "$2.476M",
        scope_label: "Revenue (2024)",
        selection_reason: "financial_table_preferred",
        sources: [{ page: 19, slide_title: "The Financials." }],
      },
    },
    deal_summary: {
      tiers: {
        hero: "Palm is a golf apparel and accessories company with DTC + wholesale distribution.",
      },
    },
  };

  const dto = buildUiPreviewV1({
    report,
    segmented_nodes: [],
    env: { DETERMINISTIC_SCORE_V1_ENABLED: "false" },
  });

  assert.equal(dto.header_tiles.revenue.value, "$2.476M");
  assert.equal(dto.header_tiles.revenue.label, "Revenue (2024)");
  assert.equal(dto.header_tiles.revenue.scope_label, "Revenue (2024)");
  assert.equal(dto.header_tiles.revenue.selection_reason, "financial_table_preferred");
  assert.ok(Array.isArray(dto.header_tiles.revenue.sources));
  assert.equal(dto.header_tiles.revenue.sources?.length, 1);
  assert.equal(dto.header_tiles.revenue.sources?.[0]?.slide_title, "The Financials.");
});
