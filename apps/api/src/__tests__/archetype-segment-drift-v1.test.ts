import test from "node:test";
import assert from "node:assert/strict";

import { computeArchetypeSegmentDriftV1 } from "../lib/archetype-segment-drift-v1";
import type { DeckArchetypeDiagnosticV1, DeckArchetypeV1 } from "../lib/deck-archetypes";

test("archetype_segment_drift_v1: consumer_apparel_dtc missing business_model is underrepresented but compensated by synthesis", () => {
  const deck_archetype: DeckArchetypeV1 = {
    version: "deck_archetype_v1",
    key: "consumer_apparel_dtc",
    confidence: 0.62,
    scores: {
      consumer_apparel_dtc: 0.62,
      enterprise_saas_compliance: 0.12,
      pe_rollup_consolidation: 0.06,
    },
    segment_counts: {
      product: 2,
      market: 1,
      traction: 1,
      business_model: 0,
      go_to_market: 1,
    },
    keyword_hits: { dtc: 1, wholesale: 1 },
  };

  const diagnostics: DeckArchetypeDiagnosticV1[] = [
    {
      kind: "satisfied_by_synthesis",
      segment: "business_model",
      message: "business_model requirement satisfied via synthesized business_model_summary_v1",
      details: { confidence: 0.85 },
    },
  ];

  const structured_summary = {
    business_model_summary_v1: {
      value: "DTC ecommerce plus wholesale distribution",
      confidence: 0.85,
      derived_from: { product_pages: [4], gtm_pages: [9] },
    },
  };

  const drift = computeArchetypeSegmentDriftV1({ deck_archetype, diagnostics, structured_summary });
  assert.ok(drift);
  assert.equal(drift!.archetype, "consumer_apparel_dtc");
  assert.ok(["aligned", "mostly_aligned"].includes(drift!.overall_assessment));

  const bm = drift!.segment_analysis.find((r) => r.segment_key === "business_model");
  assert.ok(bm);
  assert.equal(bm!.status, "underrepresented");

  assert.ok(drift!.compensating_patterns.some((cp) => cp.missing_segment === "business_model"));
});

test("archetype_segment_drift_v1: critical overrepresentation yields misaligned", () => {
  const deck_archetype: DeckArchetypeV1 = {
    version: "deck_archetype_v1",
    key: "enterprise_saas_compliance",
    confidence: 0.58,
    scores: {
      consumer_apparel_dtc: 0.11,
      enterprise_saas_compliance: 0.58,
      pe_rollup_consolidation: 0.08,
    },
    segment_counts: {
      operations: 10, // expected_max for ops is 6
      product: 1,
      traction: 1,
      risks: 1,
    },
    keyword_hits: { compliance: 2, audit: 1 },
  };

  const drift = computeArchetypeSegmentDriftV1({ deck_archetype, diagnostics: [], structured_summary: null });
  assert.ok(drift);
  assert.equal(drift!.overall_assessment, "misaligned");

  const ops = drift!.segment_analysis.find((r) => r.segment_key === "operations");
  assert.ok(ops);
  assert.equal(ops!.status, "overrepresented");
  assert.equal(ops!.severity, "critical");
});
