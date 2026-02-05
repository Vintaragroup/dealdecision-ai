import { test } from "node:test";
import assert from "node:assert/strict";
import { computeOverrideQualityV1 } from "../lib/override-quality-v1";

function makeOverrideNode(input: {
  title: string;
  finalSegment: any;
  overrideRuleId?: string;
}): any {
  return {
    slide_title: input.title,
    bullets: [],
    segment_key: input.finalSegment,
    segment_reason: {
      rules_hit: input.overrideRuleId ? [input.overrideRuleId] : [],
    },
  };
}

test("computeOverrideQualityV1: returns null on empty", () => {
  assert.equal(computeOverrideQualityV1([]), null);
  assert.equal(computeOverrideQualityV1(null), null);
});

test("computeOverrideQualityV1: low band at 10%", () => {
  const nodes = [
    // 1 override out of 10
    makeOverrideNode({
      title: "Strategic Hires",
      finalSegment: "go_to_market",
      overrideRuleId: "segmenter:override:gtm.intent.customers_distribution",
    }),
    ...Array.from({ length: 9 }).map(() => makeOverrideNode({ title: "Product", finalSegment: "product" })),
  ];

  const out = computeOverrideQualityV1(nodes);
  assert.ok(out);
  assert.equal(out.total_nodes, 10);
  assert.equal(out.overridden_nodes, 1);
  assert.equal(out.override_ratio, 0.1);
  assert.equal(out.assessment, "low");
  assert.deepEqual(out.by_segment, { go_to_market: 1 });
  assert.deepEqual(out.by_override_rule, { "segmenter:override:gtm.intent.customers_distribution": 1 });
  assert.deepEqual(out.notes, []);
});

test("computeOverrideQualityV1: moderate band at 25% and GTM concentration note", () => {
  const nodes = [
    // 2 overrides out of 8 => 0.25
    makeOverrideNode({
      title: "Strategic Hires",
      finalSegment: "go_to_market",
      overrideRuleId: "segmenter:override:gtm.intent.customers_distribution",
    }),
    makeOverrideNode({
      title: "Strategic Hires",
      finalSegment: "go_to_market",
      overrideRuleId: "segmenter:override:gtm.intent.customers_distribution",
    }),
    ...Array.from({ length: 6 }).map(() => makeOverrideNode({ title: "Product", finalSegment: "product" })),
  ];

  const out = computeOverrideQualityV1(nodes);
  assert.ok(out);
  assert.equal(out.total_nodes, 8);
  assert.equal(out.overridden_nodes, 2);
  assert.equal(out.override_ratio, 0.25);
  assert.equal(out.assessment, "moderate");
  assert.deepEqual(out.by_segment, { go_to_market: 2 });
  assert.deepEqual(out.by_override_rule, { "segmenter:override:gtm.intent.customers_distribution": 2 });
  assert.ok(out.notes.includes("Overrides concentrated in GTM-related slides"));
});

test("computeOverrideQualityV1: high band and deterministic notes", () => {
  const nodes = [
    // 3 overrides out of 10 => 0.30
    makeOverrideNode({
      title: "Strategic Hires",
      finalSegment: "go_to_market",
      overrideRuleId: "segmenter:override:gtm.intent.customers_distribution",
    }),
    makeOverrideNode({
      title: "Strategic Hires",
      finalSegment: "go_to_market",
      overrideRuleId: "segmenter:override:gtm.intent.customers_distribution",
    }),
    makeOverrideNode({
      title: "Strategic Hires",
      finalSegment: "go_to_market",
      overrideRuleId: "segmenter:override:gtm.intent.customers_distribution",
    }),
    ...Array.from({ length: 7 }).map(() => makeOverrideNode({ title: "Product", finalSegment: "product" })),
  ];

  const out = computeOverrideQualityV1(nodes);
  assert.ok(out);
  assert.equal(out.total_nodes, 10);
  assert.equal(out.overridden_nodes, 3);
  assert.equal(out.override_ratio, 0.3);
  assert.equal(out.assessment, "high");

  assert.ok(out.notes.includes("Overrides concentrated in GTM-related slides"));
  assert.ok(out.notes.includes("Overrides dominated by a single override rule"));
  assert.ok(out.notes.includes("High override rate may indicate title ambiguity"));

  assert.deepEqual(out.by_override_rule_segments, {
    "segmenter:override:gtm.intent.customers_distribution": ["go_to_market"],
  });
});
