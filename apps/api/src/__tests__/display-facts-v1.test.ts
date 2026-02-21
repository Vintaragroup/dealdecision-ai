import test from "node:test";
import assert from "node:assert/strict";

import { buildDisplayFactsV1 } from "../lib/canonical/display-facts-v1";

test("buildDisplayFactsV1 preserves deterministic values + sources", () => {
  const report = {
    deal_summary: {
      one_liner: {
        display_text: "Company: Golf apparel brand. Sells: Premium gloves.",
        quality: "good",
        suppressed_reasons: [],
        sources: [
          {
            source_document_id: "doc-1",
            page_index: 2,
            slide_title: "Overview",
            snippet: "Premium golf gloves.",
            segment_key: "product",
            node_id: "node-1",
          },
        ],
      },
      product: {
        display_text: "Product: Premium golf gloves with performance fit.",
        quality: "ok",
        suppressed_reasons: [],
        sources: [
          {
            source_document_id: "doc-1",
            page_index: 3,
            slide_title: "Product",
            snippet: "Premium golf gloves.",
            segment_key: "product",
            node_id: "node-2",
          },
        ],
      },
      market: {
        display_text: "Market: Golf apparel and accessories.",
        quality: "ok",
        suppressed_reasons: [],
        sources: [
          {
            source_document_id: "doc-1",
            page_index: 4,
            slide_title: "Market",
            snippet: "Golf apparel market.",
            segment_key: "market",
            node_id: "node-3",
          },
        ],
      },
      market_target: {
        display_text: "Target market: 18–34 male golfers; expanding to women/youth.",
        quality: "good",
        suppressed_reasons: [],
        sources: [
          {
            source_document_id: "doc-1",
            page_index: 4,
            slide_title: "Market",
            snippet: "ICP: 18–34 male golfers.",
            segment_key: "market",
            node_id: "node-3",
          },
        ],
      },
      market_context: {
        display_text: "Market context: Golf participation is growing.",
        quality: "ok",
        suppressed_reasons: [],
        sources: [
          {
            source_document_id: "doc-1",
            page_index: 4,
            slide_title: "Market",
            snippet: "Participation growing.",
            segment_key: "market",
            node_id: "node-3",
          },
        ],
      },
      meta: {
        market_target: { canonical: { kind: "market_target", rules_applied: ["market_target_symbol_lighten_v1"] } },
      },
    },
    structured_summary: {
      business_model_summary: {
        value: "DTC + wholesale.",
        sources: [{ document_id: "doc-1", page_range: [6, 6], note: "fixture" }],
      },
      raise: {
        value_raw: "$10M",
        sources: [{ document_id: "doc-1", page_range: [7, 7], note: "raise slide" }],
      },
      traction_signals: ["46 wholesale accounts", "Strong conversion"],
    },
  };

  const out = buildDisplayFactsV1(report);
  assert.equal(out.schema_version, "display_facts_v1");

  assert.equal(out.one_liner.value, report.deal_summary.one_liner.display_text);
  assert.equal(out.one_liner.sources.length, 1);
  assert.equal(out.one_liner.sources[0].source_document_id, "doc-1");
  assert.equal(out.one_liner.sources[0].page_index, 2);

  assert.equal(out.market_target.value, report.deal_summary.market_target.display_text);
  assert.equal(out.who_it_serves.value, report.deal_summary.market_target.display_text);
  assert.ok(out.market_target.canonical);
  assert.equal(out.market_target.canonical?.kind, "market_target");

  assert.ok(out.business_model.value?.includes("DTC + wholesale"));
  assert.ok(out.raise_terms.value?.includes("$10M"));
  assert.equal(out.traction_signals.length, 2);
});

test("buildDisplayFactsV1 emits explicit missing reasons", () => {
  const report = { deal_summary: null, structured_summary: {} };
  const out = buildDisplayFactsV1(report);

  assert.equal(out.one_liner.value, null);
  assert.equal(out.one_liner.missing_reason, "missing_in_deal_summary_v1");
  assert.equal(out.business_model.value, null);
  assert.equal(out.business_model.missing_reason, "missing_in_structured_summary");
  assert.equal(out.why_it_wins.value, null);
  assert.equal(out.why_it_wins.missing_reason, "not_available_deterministically");
});

test("buildDisplayFactsV1 raise_terms guard: '$8B TAM' must not emit raise_terms", () => {
  const report = {
    deal_summary: null,
    structured_summary: {
      raise: {
        value_raw: "$8B TAM",
        sources: [{ document_id: "doc-1", page_range: [7, 7], note: "$8B TAM" }],
      },
    },
  };

  const out = buildDisplayFactsV1(report);
  assert.equal(out.raise_terms.value, null);
});

test("buildDisplayFactsV1 raise_terms guard: explicit ask may emit raise_terms", () => {
  const report = {
    deal_summary: null,
    structured_summary: {
      raise: {
        value_raw: "The Ask: Raising $2M via SAFE",
        sources: [{ document_id: "doc-1", page_range: [7, 7], note: "The Ask: Raising $2M via SAFE" }],
      },
    },
  };

  const out = buildDisplayFactsV1(report);
  assert.ok(out.raise_terms.value);
  assert.ok(out.raise_terms.value?.includes("$2M"));
});
