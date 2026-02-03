import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildCanonicalInput,
  computeInputHash,
  stableJsonStringify,
} from "../src/understanding/canonical";

import { normalizeText } from "../src/understanding/normalize";
import { classifyPage } from "../src/understanding/classify";
import { extractMetrics } from "../src/understanding/extract_metrics";
import { rankEvidence } from "../src/understanding/rank_evidence";
import { buildUnderstandingPatch } from "../src/understanding/enrich";

import type { CanonicalUnderstandingInput } from "../src/understanding/canonical";
import type { DeterministicUnderstandingInput } from "../src/understanding/types";

describe("deterministic understanding v1", () => {
  it("same canonical input => same hash", () => {
    const canonical: CanonicalUnderstandingInput = {
      deal_id: "deal_x",
      documents: [{ document_id: "doc_a" }],
      pages: [],
      segments: [],
    };

    const h1 = computeInputHash(canonical);
    const h2 = computeInputHash(canonical);
    assert.equal(h1, h2);
  });

  it("same data with different key insertion order => same hash", () => {
    const a: CanonicalUnderstandingInput = {
      deal_id: "deal_x",
      documents: [{ document_id: "doc_a", a: 1, b: 2 }],
      pages: [],
      segments: [],
    };

    // Same values, but inner object keys inserted in different order.
    const b: CanonicalUnderstandingInput = {
      deal_id: "deal_x",
      documents: [{ document_id: "doc_a", b: 2, a: 1 }],
      pages: [],
      segments: [],
    };

    // Make sure the stringifier is actually stable for this case.
    assert.equal(stableJsonStringify(a), stableJsonStringify(b));
    assert.equal(computeInputHash(a), computeInputHash(b));
  });

  it("buildCanonicalInput excludes volatile fields (hash unchanged)", () => {
    const base: DeterministicUnderstandingInput = {
      deal_id: "deal_volatile",
      documents: [
        {
          document_id: "doc_1",
          title: "Doc",
          page_count: 1,
        },
      ],
      pages: [
        {
          page_id: "doc_1_p000",
          document_id: "doc_1",
          page_index: 0,
          raw_ocr_text: "RAW OCR   should   stay   as-is\n",
          structured_extraction: {
            items: [
              {
                id: "runtime_item_id",
                kind: "image",
                image_uri: "/uploads/rendered_pages/doc_1/page_000.png",
                created_at: "2020-01-01T00:00:00Z",
                locators: [
                  {
                    visual_asset_id: "va_1",
                    image_uri: "/tmp/local.png",
                    bbox: { x: 0, y: 0, w: 1, h: 1 },
                  },
                ],
                structured_json: { segment_key: "financials" },
              },
            ],
          },
          evidence: [],
        },
      ],
      segments: [
        {
          segment_id: "seg_1",
          label: "financials",
          page_ids: ["doc_1_p000"],
        },
      ],
    };

    // Inject a volatile field that should be ignored by canonicalization.
    (base.documents[0] as any).created_at = "2020-01-01T00:00:00Z";

    const mutated: DeterministicUnderstandingInput = JSON.parse(JSON.stringify(base));
    // Only mutate volatile fields (should be stripped)
    (mutated.documents[0] as any).updated_at = "2026-01-31T00:00:00Z";
    (mutated.pages[0] as any).scraped_at = "2026-01-31T00:00:00Z";
    (mutated.pages[0] as any).structured_extraction.items[0].created_at = "2026-01-31T00:00:00Z";
    (mutated.pages[0] as any).structured_extraction.items[0].image_uri = "/uploads/DIFFERENT.png";
    (mutated.pages[0] as any).structured_extraction.items[0].locators[0].image_uri = "/tmp/DIFFERENT.png";
    (mutated.pages[0] as any).structured_extraction.items[0].locators[0].visual_asset_id = "va_DIFFERENT";
    (mutated.pages[0] as any).structured_extraction.items[0].id = "runtime_DIFFERENT";

    const h1 = computeInputHash(buildCanonicalInput(base));
    const h2 = computeInputHash(buildCanonicalInput(mutated));
    assert.equal(h1, h2);
  });

  it("dehyphenates across line breaks", () => {
    const raw = "re-\nvenue";
    const out = normalizeText(raw);
    assert.equal(out.normalized_text, "revenue");
  });

  it("joins wrapped lines only under the specified conditions", () => {
    const rawJoin = "This is a line\ncontinued here";
    const joined = normalizeText(rawJoin);
    assert.equal(joined.normalized_text, "This is a line continued here");

    const rawNoJoinPunct = "This is a line.\ncontinued here";
    const noJoinPunct = normalizeText(rawNoJoinPunct);
    assert.equal(noJoinPunct.normalized_text, rawNoJoinPunct);

    const rawNoJoinUpper = "This is a line\nContinued here";
    const noJoinUpper = normalizeText(rawNoJoinUpper);
    assert.equal(noJoinUpper.normalized_text, rawNoJoinUpper);
  });

  it("collapses whitespace (spaces + newlines)", () => {
    const raw = "a   b\n\n\n\n\n\nc";
    const out = normalizeText(raw);
    assert.equal(out.normalized_text, "a b\n\nc");
  });

  it("applies conservative OCR fixes only in numeric/currency contexts and logs flags", () => {
    const raw = "S100 and Sales and 1O0";
    const out = normalizeText(raw);

    assert.equal(out.normalized_text, "$100 and Sales and 100");
    assert.ok(out.normalization_flags.includes("ocr_fix:S_to_$"));
    assert.ok(out.normalization_flags.includes("ocr_fix:O_to_0"));

    const rawNoCurrency = "Sales SaaS";
    const outNoCurrency = normalizeText(rawNoCurrency);
    assert.equal(outNoCurrency.normalized_text, rawNoCurrency);
    assert.equal(outNoCurrency.normalization_flags.length, 0);
  });

  it("classifies financials_pnl on revenue/COGS/gross margin + currency", () => {
    const normalized_text = "Revenue $1,200,000\nCOGS $400,000\nGross margin 45%";
    const c = classifyPage(normalized_text);
    assert.equal(c.page_type, "financials_pnl");
    assert.match(c.why.join("\n"), /keyword:(revenue|cogs|gross|margin)/);
    assert.match(c.why.join("\n"), /currency_count:/);
  });

  it("classifies terms_cap_table on cap table / preferred / option pool / valuation", () => {
    const normalized_text = "Cap table: Preferred vs Common. Option pool 10%. Pre-money valuation $10m.";
    const c = classifyPage(normalized_text);
    assert.equal(c.page_type, "terms_cap_table");
    assert.match(c.why.join("\n"), /keyword:(cap table|preferred|option pool|valuation)/);
  });

  it("classifies market_size on TAM/SAM/SOM + market size", () => {
    const normalized_text = "Market size: TAM $10B, SAM $2B, SOM $200M";
    const c = classifyPage(normalized_text);
    assert.equal(c.page_type, "market_size");
    assert.match(c.why.join("\n"), /keyword:(tam|sam|som|market size)/);
  });

  it("classifies team on CEO/CTO/founder/advisors", () => {
    const normalized_text = "Team: Founder & CEO Jane Doe. CTO John Smith. Advisors include ...";
    const c = classifyPage(normalized_text);
    assert.equal(c.page_type, "team");
    assert.match(c.why.join("\n"), /keyword:(founder|ceo|cto|advisors)/);
  });

  it("classifies unknown when max score < 3.0", () => {
    const normalized_text = "hello world";
    const c = classifyPage(normalized_text);
    assert.equal(c.page_type, "unknown");
  });

  it("why[] includes deterministic keyword/currency/year/table reasons", () => {
    const normalized_text = "Revenue $100 in 2024";
    const c = classifyPage(normalized_text);
    assert.ok(c.why.some((w) => w.startsWith("keyword:")), "expected why[] to include keyword:* reason");
    assert.ok(c.why.some((w) => w.startsWith("currency_count:")), "expected why[] to include currency_count:* reason");
    assert.ok(c.why.some((w) => w.startsWith("year_count:")), "expected why[] to include year_count:* reason");
  });

  it("extractMetrics: $2.4m normalizes to 2400000 USD", () => {
    const metrics = extractMetrics("Revenue $2.4m");
    const m = metrics.find((x) => x.raw_value === "$2.4m");
    assert.ok(m);
    assert.equal(m.unit, "USD");
    assert.equal(m.value_normalized, 2400000);
    assert.equal(m.metric_type, "revenue_usd");
  });

  it("extractMetrics: $1,200k normalizes to 1200000 USD", () => {
    const metrics = extractMetrics("Revenue $1,200k");
    const m = metrics.find((x) => x.raw_value === "$1,200k");
    assert.ok(m);
    assert.equal(m.unit, "USD");
    assert.equal(m.value_normalized, 1200000);
  });

  it("extractMetrics: 45% normalizes to 45 PERCENT", () => {
    const metrics = extractMetrics("Gross margin 45% ");
    const m = metrics.find((x) => x.raw_value === "45%");
    assert.ok(m);
    assert.equal(m.unit, "PERCENT");
    assert.equal(m.value_normalized, 45);
  });

  it("extractMetrics: detects years (2024) with unit YEARS", () => {
    const metrics = extractMetrics("In 2024, revenue grew.");
    const m = metrics.find((x) => x.raw_value === "2024");
    assert.ok(m);
    assert.equal(m.unit, "YEARS");
    assert.equal(m.value_normalized, 2024);
  });

  it("extractMetrics: confidence increases when Revenue is near a currency token", () => {
    const withRevenue = extractMetrics("Revenue $2.4m").find((x) => x.raw_value === "$2.4m");
    const withoutRevenue = extractMetrics("Slide $2.4m").find((x) => x.raw_value === "$2.4m");
    assert.ok(withRevenue);
    assert.ok(withoutRevenue);
    assert.ok((withRevenue.confidence ?? 0) > (withoutRevenue.confidence ?? 0));
  });

  it("Acceptance: inferMetricType(PERCENT) gross margin => gross_margin_percent", () => {
    const m = extractMetrics("Gross margin 45%").find((x) => x.raw_value === "45%");
    assert.ok(m);
    assert.equal(m.unit, "PERCENT");
    assert.equal(m.metric_type, "gross_margin_percent");
  });

  it("Acceptance: inferMetricType(PERCENT) churn => churn_rate_percent", () => {
    const m = extractMetrics("Churn 3%").find((x) => x.raw_value === "3%");
    assert.ok(m);
    assert.equal(m.unit, "PERCENT");
    assert.equal(m.metric_type, "churn_rate_percent");
  });

  it("Acceptance: inferMetricType(PERCENT) uptime => uptime_percent", () => {
    const m = extractMetrics("Uptime 99.9%").find((x) => x.raw_value === "99.9%");
    assert.ok(m);
    assert.equal(m.unit, "PERCENT");
    assert.equal(m.metric_type, "uptime_percent");
  });

  it("Acceptance: inferMetricType(PERCENT) option pool => option_pool_percent", () => {
    const m = extractMetrics("Option pool 10%").find((x) => x.raw_value === "10%");
    assert.ok(m);
    assert.equal(m.unit, "PERCENT");
    assert.equal(m.metric_type, "option_pool_percent");
  });

  it("Acceptance: inferMetricType(USD) post-money valuation => valuation_usd", () => {
    const m = extractMetrics("Post-money valuation $20m").find((x) => x.raw_value === "$20m");
    assert.ok(m);
    assert.equal(m.unit, "USD");
    assert.equal(m.value_normalized, 20000000);
    assert.equal(m.metric_type, "valuation_usd");
  });

  it("Acceptance: inferMetricType(USD) TAM => tam_usd", () => {
    const m = extractMetrics("TAM $5B").find((x) => x.raw_value === "$5B");
    assert.ok(m);
    assert.equal(m.unit, "USD");
    assert.equal(m.value_normalized, 5000000000);
    assert.equal(m.metric_type, "tam_usd");
  });

  it("Acceptance: inferMetricType(MONTHS) runway => runway_months", () => {
    const m = extractMetrics("Runway 18 months").find((x) => x.raw_value.toLowerCase() === "18 months");
    assert.ok(m);
    assert.equal(m.unit, "MONTHS");
    assert.equal(m.value_normalized, 18);
    assert.equal(m.metric_type, "runway_months");
  });

  it("Acceptance: weak percent context stays unknown_metric", () => {
    const m = extractMetrics("Increase 150% in usage").find((x) => x.raw_value === "150%");
    assert.ok(m);
    assert.equal(m.unit, "PERCENT");
    assert.equal(m.metric_type, "unknown_metric");
  });

  it("extractMetrics: stable ordering (same input => same order)", () => {
    const text = "Revenue $2.4m in 2024. Gross margin 45%. Pre-money valuation $10m.";
    const a = extractMetrics(text);
    const b = extractMetrics(text);
    assert.deepEqual(a, b);
  });

  it("rankEvidence: evidence is non-empty for non-trivial text", () => {
    const text =
      "Revenue was $2.4m in 2024 for the quarter.\n" +
      "- Gross margin 45% year-over-year improvement.\n" +
      "Team includes Jane Doe CEO at Acme Inc.";
    const ev = rankEvidence(text);
    assert.ok(ev.length > 0);
  });

  it("rankEvidence: snippets are verbatim substrings of the source", () => {
    const text =
      "Revenue was $2.4m in 2024 for the quarter.\n" +
      "- Gross margin 45% year-over-year improvement.";
    const ev = rankEvidence(text);

    for (const s of ev) {
      assert.ok(text.includes(s.snippet));
      if (s.source_span) {
        assert.equal(text.slice(s.source_span.start, s.source_span.end), s.snippet);
      }
    }
  });

  it("rankEvidence: deterministic ranking (same input => same output order)", () => {
    const text =
      "Revenue was $2.4m in 2024 for the quarter.\n" +
      "- Gross margin 45% year-over-year improvement.\n" +
      "Team includes Jane Doe CEO at Acme Inc.";
    const a = rankEvidence(text);
    const b = rankEvidence(text);
    assert.deepEqual(a, b);
  });

  it("rankEvidence: currency/percent/year features affect score ordering", () => {
    const currency = "Revenue was $2.4m in 2024 for the quarter.";
    const yearOnly = "In 2024 the company expanded internationally in a new region.";
    const plain = "This is a general statement about the company and its mission.";
    const text = `${plain}\n${yearOnly}\n${currency}`;
    const ev = rankEvidence(text);
    assert.ok(ev[0]?.snippet.includes("$2.4m"));
    assert.ok(ev[0]?.features?.includes("contains_currency"));
    assert.ok(ev[0]?.features?.includes("contains_year"));
  });

  it("rankEvidence: stable tie-break (same score => lexicographic snippet order)", () => {
    const a = "Alpha statement happened in 2024 and then ended normally.";
    const b = "Beta statement happened in 2024 and then ended normally.";
    const text = `${b}\n${a}`;
    const ev = rankEvidence(text);

    const aRow = ev.find((x) => x.snippet.startsWith("Alpha statement"));
    const bRow = ev.find((x) => x.snippet.startsWith("Beta statement"));
    assert.ok(aRow);
    assert.ok(bRow);

    assert.equal(aRow.score, bRow.score);
    const aIndex = ev.findIndex((x) => x.snippet === aRow.snippet);
    const bIndex = ev.findIndex((x) => x.snippet === bRow.snippet);
    assert.ok(aIndex >= 0);
    assert.ok(bIndex >= 0);
    assert.ok(aIndex < bIndex);
  });

  it("buildUnderstandingPatch: includes all pages (no drops)", () => {
    const input: DeterministicUnderstandingInput = {
      deal_id: "deal_p7",
      documents: [{ document_id: "doc_1", title: "Doc" }],
      pages: [
        { page_id: "p1", document_id: "doc_1", page_index: 0, raw_ocr_text: "Revenue $2.4m in 2024." },
        {
          page_id: "p2",
          document_id: "doc_1",
          page_index: 1,
          raw_ocr_text: "Cap table and valuation $10m. Gross margin 45%.",
        },
      ],
    };

    const patch = buildUnderstandingPatch(input, { now: () => new Date("2026-01-31T00:00:00.000Z") });
    assert.deepEqual(Object.keys(patch.pages).sort(), ["p1", "p2"]);
  });

  it("buildUnderstandingPatch: order-independent input yields identical patch", () => {
    const base: DeterministicUnderstandingInput = {
      deal_id: "deal_p7",
      documents: [{ document_id: "doc_1", title: "Doc" }],
      pages: [
        { page_id: "p1", document_id: "doc_1", page_index: 0, raw_ocr_text: "Revenue $2.4m in 2024." },
        {
          page_id: "p2",
          document_id: "doc_1",
          page_index: 1,
          raw_ocr_text: "Cap table and valuation $10m. Gross margin 45%.",
        },
      ],
      segments: [{ segment_id: "s1", label: "seg", page_ids: ["p2", "p1"] }],
    };

    const reversed: DeterministicUnderstandingInput = {
      deal_id: base.deal_id,
      documents: [...base.documents].reverse(),
      pages: [...base.pages].reverse(),
      segments: base.segments ? [...base.segments].reverse() : undefined,
    };

    const now = () => new Date("2026-01-31T00:00:00.000Z");
    const a = buildUnderstandingPatch(base, { now });
    const b = buildUnderstandingPatch(reversed, { now });
    assert.deepEqual(a, b);
  });

  it("buildUnderstandingPatch: document_key_points sorted by score desc then snippet asc", () => {
    const input: DeterministicUnderstandingInput = {
      deal_id: "deal_p7",
      documents: [{ document_id: "doc_1", title: "Doc" }],
      pages: [
        {
          page_id: "p1",
          document_id: "doc_1",
          page_index: 0,
          raw_ocr_text:
            "Revenue $2.4m in 2024 for the quarter.\n" +
            "Beta statement happened in 2024 and then ended normally.\n" +
            "Alpha statement happened in 2024 and then ended normally.",
        },
      ],
    };

    const patch = buildUnderstandingPatch(input, { now: () => new Date("2026-01-31T00:00:00.000Z") });
    const doc = patch.documents["doc_1"];
    assert.ok(doc.document_key_points && doc.document_key_points.length > 0);

    const kps = doc.document_key_points ?? [];
    for (let i = 1; i < kps.length; i++) {
      const prev = kps[i - 1];
      const cur = kps[i];
      if (prev.score === cur.score) {
        assert.ok(prev.snippet.localeCompare(cur.snippet) <= 0);
      } else {
        assert.ok(prev.score >= cur.score);
      }
    }
  });

  it("buildUnderstandingPatch: created_at stable when now() is injected", () => {
    const input: DeterministicUnderstandingInput = {
      deal_id: "deal_p7",
      documents: [{ document_id: "doc_1" }],
      pages: [{ page_id: "p1", document_id: "doc_1", page_index: 0, raw_ocr_text: "Hello" }],
    };

    const patch = buildUnderstandingPatch(input, { now: () => new Date("2026-01-31T00:00:00.000Z") });
    assert.equal(patch.created_at, "2026-01-31T00:00:00.000Z");
  });

  it("Acceptance: Enrichment produces analysis_version + input_hash + created_at ISO", () => {
    const input: DeterministicUnderstandingInput = {
      deal_id: "deal_accept",
      documents: [{ document_id: "doc_1", title: "Deck" }],
      pages: [{ page_id: "p1", document_id: "doc_1", page_index: 0, raw_ocr_text: "Revenue $100 in 2024" }],
    };

    const patch = buildUnderstandingPatch(input, { now: () => new Date("2026-01-31T00:00:00.000Z") });

    assert.equal(patch.analysis_version, "deterministic_understanding_v1");
    assert.ok(typeof patch.input_hash === "string" && patch.input_hash.length > 0);
    assert.equal(patch.created_at, "2026-01-31T00:00:00.000Z");
    assert.equal(new Date(patch.created_at).toISOString(), patch.created_at);

    // input_hash must correspond to the canonicalized input.
    assert.equal(patch.input_hash, computeInputHash(buildCanonicalInput(input)));
  });

  it("Acceptance: Stable input hashing across input key order (canonicalize => same hash)", () => {
    const base: DeterministicUnderstandingInput = {
      deal_id: "deal_hash",
      documents: [{ document_id: "doc_1", title: "Deck", type: "pitch", page_count: 1 } as any],
      pages: [
        {
          page_id: "p1",
          document_id: "doc_1",
          page_index: 0,
          raw_ocr_text: "Revenue $100 in 2024",
          structured_extraction: {
            items: [
              {
                kind: "table",
                structured_json: { a: 1, b: 2 },
              },
            ],
          },
        } as any,
      ],
    };

    // Same values, but nested key insertion order differs.
    const mutated: DeterministicUnderstandingInput = {
      deal_id: base.deal_id,
      documents: [{ document_id: "doc_1", title: "Deck", type: "pitch", page_count: 1 } as any],
      pages: [
        {
          page_id: "p1",
          document_id: "doc_1",
          page_index: 0,
          raw_ocr_text: "Revenue $100 in 2024",
          structured_extraction: {
            items: [
              {
                kind: "table",
                structured_json: { b: 2, a: 1 },
              },
            ],
          },
        } as any,
      ],
    };

    const h1 = computeInputHash(buildCanonicalInput(base));
    const h2 = computeInputHash(buildCanonicalInput(mutated));
    assert.equal(h1, h2);
  });

  it("Acceptance: Raw OCR is not modified (normalized_text is separate)", () => {
    const raw = "RAW OCR   should   stay   as-is\n";
    const input: DeterministicUnderstandingInput = {
      deal_id: "deal_raw",
      documents: [{ document_id: "doc_1" }],
      pages: [{ page_id: "p1", document_id: "doc_1", page_index: 0, raw_ocr_text: raw }],
    };

    const patch = buildUnderstandingPatch(input, { now: () => new Date("2026-01-31T00:00:00.000Z") });

    // Ensure input object is not mutated.
    assert.equal(input.pages?.[0]?.raw_ocr_text, raw);
    // Canonical input retains raw OCR verbatim.
    assert.equal((buildCanonicalInput(input).pages[0] as any).raw_ocr_text, raw);

    // Patch stores normalized text separately.
    assert.equal(patch.pages.p1.page_id, "p1");
    assert.ok(typeof patch.pages.p1.normalized_text === "string");
    assert.notEqual(patch.pages.p1.normalized_text, raw);
  });

  it("Acceptance: Page invariants + evidence/metrics stability", () => {
    const longText =
      "Revenue was $2.4m in 2024 for the quarter.\n" +
      "Gross margin 45% year-over-year improvement.\n" +
      "Cap table includes Preferred vs Common and an option pool 10%.\n" +
      "Market size: TAM $10B, SAM $2B, SOM $200M.\n" +
      "Team includes Founder & CEO Jane Doe. CTO John Smith.";

    const input: DeterministicUnderstandingInput = {
      deal_id: "deal_pages",
      documents: [{ document_id: "doc_1", title: "Deck" }],
      pages: [
        { page_id: "p1", document_id: "doc_1", page_index: 0, raw_ocr_text: longText },
        { page_id: "p2", document_id: "doc_1", page_index: 1, raw_ocr_text: "Revenue $100 in 2024" },
      ],
    };

    const now = () => new Date("2026-01-31T00:00:00.000Z");
    const a = buildUnderstandingPatch(input, { now });
    const b = buildUnderstandingPatch(input, { now });
    assert.deepEqual(a, b);

    // Page coverage: every input page_id yields a PageUnderstanding entry.
    assert.deepEqual(Object.keys(a.pages).sort(), ["p1", "p2"]);

    for (const pid of ["p1", "p2"] as const) {
      const p = a.pages[pid];
      assert.ok(typeof p.page_type === "string" && p.page_type.length > 0);
      assert.ok(typeof p.confidence === "number");
      assert.ok(p.confidence >= 0 && p.confidence <= 1);
      assert.ok(Array.isArray(p.evidence));
      assert.ok(Array.isArray(p.key_numbers));
      assert.ok(Array.isArray(p.key_entities));
    }

    // Evidence: for a non-trivial page, evidence list should be non-empty and deterministic.
    assert.ok(a.pages.p1.evidence.length >= 3);
    for (let i = 1; i < a.pages.p1.evidence.length; i++) {
      const prev = a.pages.p1.evidence[i - 1];
      const cur = a.pages.p1.evidence[i];
      if (prev.score === cur.score) {
        assert.ok(prev.snippet.localeCompare(cur.snippet) <= 0);
      } else {
        assert.ok(prev.score >= cur.score);
      }
    }

    // Metrics: metric-dense pages should yield at least one metric and ordering should be stable.
    assert.ok(a.pages.p1.key_numbers.length >= 1);
    assert.deepEqual(a.pages.p1.key_numbers, b.pages.p1.key_numbers);
  });
});
