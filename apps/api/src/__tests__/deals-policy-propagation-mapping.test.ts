import { test } from "node:test";
import assert from "node:assert/strict";

import { mapDeal, type DealRow, type DIOAggregateRow } from "../routes/deals/_shared";

test("mapDeal surfaces selected policy aliases for web consumers", () => {
  const row: DealRow = {
    id: "00000000-0000-0000-0000-000000000901",
    name: "Albuquerque",
    stage: "intake" as DealRow["stage"],
    priority: "medium" as DealRow["priority"],
    lifecycle_status: "active",
    trend: null,
    score: null,
    owner: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    deleted_at: null,
  };

  const dio: DIOAggregateRow = {
    dio_id: "11111111-1111-1111-1111-111111111111",
    analysis_version: 2,
    recommendation: "CONSIDER",
    overall_score: 71,
    last_analyzed_at: new Date().toISOString(),
    run_count: 4,
    selected_policy: "real_estate_underwriting",
    policy_id: "real_estate_underwriting",
    deal_classification_v1: {
      selected_policy: "real_estate_underwriting",
      selected: {
        asset_class: "real_estate",
        deal_structure: "preferred_equity",
        strategy_subtype: "real_estate_preferred_equity",
      },
    },
  };

  const mapped = mapDeal(row, dio, "full") as any;

  assert.equal(mapped.selected_policy, "real_estate_underwriting");
  assert.equal(mapped.policy_id, "real_estate_underwriting");
  assert.equal(mapped.deal_classification_v1?.selected_policy, "real_estate_underwriting");
  assert.equal(mapped.deal_classification_v1?.selected?.deal_structure, "preferred_equity");
});
