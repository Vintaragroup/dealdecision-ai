import test from "node:test";
import assert from "node:assert/strict";

import { computeArchetypeSegmentDriftV1 } from "../lib/archetype-segment-drift-v1";
import type { DeckArchetypeV1 } from "../lib/deck-archetypes";

test("archetype_segment_drift_v1: consumer_apparel_dtc team overrep is warn (<= expected_max+4) and not misaligned", () => {
  const deck_archetype: DeckArchetypeV1 = {
    version: "deck_archetype_v1",
    key: "consumer_apparel_dtc",
    confidence: 0.71,
    scores: {
      consumer_apparel_dtc: 0.71,
      enterprise_saas_compliance: 0.12,
      pe_rollup_consolidation: 0.04,
    },
    segment_counts: {
      product: 1,
      market: 1,
      traction: 1,
      business_model: 1,
      go_to_market: 1,
      team: 6, // expected_max=2; over=4 => warn under archetype rule
    },
    keyword_hits: { dtc: 1, apparel: 1, wholesale: 1 },
  };

  const structured_summary = {
    revenue: { value: { raw: "$1M ARR" } },
    customers: { value: { raw: "100 customers" } },
  };

  const drift = computeArchetypeSegmentDriftV1({ deck_archetype, diagnostics: [], structured_summary });
  assert.ok(drift);

  const team = drift!.segment_analysis.find((r) => r.segment_key === "team");
  assert.ok(team);
  assert.equal(team!.status, "overrepresented");
  assert.equal(team!.severity, "warn");

  // Team overrepresentation alone must not hard-block.
  assert.equal(drift!.overall_assessment, "mostly_aligned");

  assert.ok(
    drift!.compensating_patterns.some((cp) => cp.missing_segment === "team_overrep_compensated_by_core_segments")
  );
});
