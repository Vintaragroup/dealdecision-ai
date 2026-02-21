import { test } from "node:test";
import assert from "node:assert/strict";

import { segmentDpuPage } from "../src/lib/segment-dpu-page";

test("Palm deck title segmentation regressions", () => {
  const cases: Array<{ title: string; expected: string }> = [
    { title: "Industry Outlook.", expected: "market" },
    { title: "Our Team.", expected: "team" },
    { title: "Key Advisors.", expected: "team" },
    { title: "Our Product Journey.", expected: "product" },
    { title: "Go to Market Strategy.", expected: "go_to_market" },
    { title: "Growth Forecast.", expected: "financials" },
    { title: "The Financials.", expected: "financials" },
    { title: "Strategic Hires", expected: "team" },
    { title: "Equipment", expected: "operations" },
  ];

  for (const c of cases) {
    const res = segmentDpuPage({ title: c.title, bullets: [] });
    assert.equal(res.segment_key, c.expected, `${c.title} -> ${res.segment_key}`);
    assert.ok(res.confidence >= 0.8, `Expected high confidence for title rule: ${c.title}`);
    assert.ok(res.reason.title_rules_hit.length > 0, `Expected title_rules_hit for: ${c.title}`);
  }
});

test("Palm deck bullet intent overrides regressions", () => {
  const cases: Array<{
    page_index: number;
    title: string;
    bullets: string[];
    expected: string;
    expectTitleRule: string;
    expectOverrideRule: string;
  }> = [
    {
      page_index: 8,
      title: "Business Performance",
      bullets: ["$800,000 in revenue", "Conversion rate 3.2%", "CAC improving QoQ"],
      expected: "traction",
      expectTitleRule: "overview.title.business_performance",
      expectOverrideRule: "traction.intent.kpi_signals",
    },
    {
      page_index: 22,
      title: "Strategic Hires & Wholesale Build Out",
      bullets: ["Serving 32 retailers", "Brick and mortar accounts expanding", "Wholesale distribution build out"],
      expected: "go_to_market",
      expectTitleRule: "team.title.strategic_hires",
      expectOverrideRule: "gtm.intent.customers_distribution",
    },
    {
      page_index: 24,
      title: "Licensing",
      bullets: ["Retail channels via distribution partnerships", "Wholesale channel partners for new regions"],
      expected: "go_to_market",
      expectTitleRule: "market.title.licensing",
      expectOverrideRule: "gtm.intent.licensing",
    },
  ];

  for (const c of cases) {
    const res = segmentDpuPage({ title: c.title, bullets: c.bullets });
    assert.equal(res.segment_key, c.expected, `page ${c.page_index} '${c.title}' -> ${res.segment_key}`);
    assert.ok(res.confidence >= 0.85, `Expected override confidence >= 0.85 for: ${c.title}`);
    assert.ok(res.reason.title_rules_hit.includes(c.expectTitleRule), `Expected title rule '${c.expectTitleRule}' for: ${c.title}`);
    assert.ok(res.reason.override_rules_hit.includes(c.expectOverrideRule), `Expected override rule '${c.expectOverrideRule}' for: ${c.title}`);
  }
});

test("Raise terms hardening: '$8B TAM' does not classify as raise_terms", () => {
  const res = segmentDpuPage({ title: "$8B TAM", bullets: ["Total addressable market", "$8B market size"] });
  assert.notEqual(res.segment_key, "raise_terms", `Expected not raise_terms, got ${res.segment_key}`);
});

test("Raise terms hardening: '$2M raise' classifies as raise_terms", () => {
  const res = segmentDpuPage({ title: "$2M raise", bullets: [] });
  assert.equal(res.segment_key, "raise_terms", `Expected raise_terms, got ${res.segment_key}`);
  assert.ok(res.confidence >= 0.9, `Expected high confidence for raise_terms, got ${res.confidence}`);
  assert.ok(res.reason.title_rules_hit.includes("raise.title.raise_terms"), "Expected raise title rule hit");
});
