import { describe, it, expect } from "vitest";

import {
  buildCanonicalInput,
  computeInputHash,
  stableJsonStringify,
} from "../../src/understanding/canonical";

import { normalizeText } from "../../src/understanding/normalize";
import { classifyPage } from "../../src/understanding/classify";
import { extractMetrics } from "../../src/understanding/extract_metrics";
import { rankEvidence } from "../../src/understanding/rank_evidence";
import { buildUnderstandingPatch } from "../../src/understanding/enrich";

import type { CanonicalUnderstandingInput } from "../../src/understanding/canonical";
import type { DeterministicUnderstandingInput } from "../../src/understanding/types";

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
    expect(h1).toBe(h2);
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
    expect(stableJsonStringify(a)).toBe(stableJsonStringify(b));
    expect(computeInputHash(a)).toBe(computeInputHash(b));
  });

  it("buildCanonicalInput excludes volatile fields (hash unchanged)", () => {
    const base: DeterministicUnderstandingInput = {
      deal_id: "deal_volatile",
      documents: [
        {
          document_id: "doc_1",
          title: "Doc",
          page_count: 1,
          // should be ignored (not included in canonical doc object)
          created_at: "2020-01-01T00:00:00Z" as unknown as never,
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
    expect(h1).toBe(h2);
  });

  it("dehyphenates across line breaks", () => {
    const raw = "re-\nvenue";
    const out = normalizeText(raw);
    expect(out.normalized_text).toBe("revenue");
  });

  it("joins wrapped lines only under the specified conditions", () => {
    const rawJoin = "This is a line\ncontinued here";
    const joined = normalizeText(rawJoin);
    expect(joined.normalized_text).toBe("This is a line continued here");

    const rawNoJoinPunct = "This is a line.\ncontinued here";
    const noJoinPunct = normalizeText(rawNoJoinPunct);
    expect(noJoinPunct.normalized_text).toBe(rawNoJoinPunct);

    const rawNoJoinUpper = "This is a line\nContinued here";
    const noJoinUpper = normalizeText(rawNoJoinUpper);
    expect(noJoinUpper.normalized_text).toBe(rawNoJoinUpper);
  });

  it("collapses whitespace (spaces + newlines)", () => {
    const raw = "a   b\n\n\n\n\nc";
    const out = normalizeText(raw);
    expect(out.normalized_text).toBe("a b\n\nc");
  });

  it("applies conservative OCR fixes only in numeric/currency contexts and logs flags", () => {
    const raw = "S100 and Sales and 1O0";
    const out = normalizeText(raw);

    expect(out.normalized_text).toBe("$100 and Sales and 100");
    expect(out.normalization_flags).toContain("ocr_fix:S_to_$");
    expect(out.normalization_flags).toContain("ocr_fix:O_to_0");

    const rawNoCurrency = "Sales SaaS";
    const outNoCurrency = normalizeText(rawNoCurrency);
    expect(outNoCurrency.normalized_text).toBe(rawNoCurrency);
    expect(outNoCurrency.normalization_flags.length).toBe(0);
  });

  it("classifies financials_pnl on revenue/COGS/gross margin + currency", () => {
    const normalized_text = "Revenue $1,200,000\nCOGS $400,000\nGross margin 45%";
    const c = classifyPage(normalized_text);
    expect(c.page_type).toBe("financials_pnl");
    expect(c.why.join("\n")).toMatch(/keyword:(revenue|cogs|gross|margin)/);
    expect(c.why.join("\n")).toMatch(/currency_count:/);
  });

  it("classifies terms_cap_table on cap table / preferred / option pool / valuation", () => {
    const normalized_text = "Cap table: Preferred vs Common. Option pool 10%. Pre-money valuation $10m.";
    const c = classifyPage(normalized_text);
    expect(c.page_type).toBe("terms_cap_table");
    expect(c.why.join("\n")).toMatch(/keyword:(cap table|preferred|option pool|valuation)/);
  });

  it("classifies market_size on TAM/SAM/SOM + market size", () => {
    const normalized_text = "Market size: TAM $10B, SAM $2B, SOM $200M";
    const c = classifyPage(normalized_text);
    expect(c.page_type).toBe("market_size");
    expect(c.why.join("\n")).toMatch(/keyword:(tam|sam|som|market size)/);
  });

  it("classifies team on CEO/CTO/founder/advisors", () => {
    const normalized_text = "Team: Founder & CEO Jane Doe. CTO John Smith. Advisors include ...";
    const c = classifyPage(normalized_text);
    expect(c.page_type).toBe("team");
    expect(c.why.join("\n")).toMatch(/keyword:(founder|ceo|cto|advisors)/);
  });

  it("classifies unknown when max score < 3.0", () => {
    const normalized_text = "hello world";
    const c = classifyPage(normalized_text);
    expect(c.page_type).toBe("unknown");
  });

  it("why[] includes deterministic keyword/currency/year/table reasons", () => {
    const normalized_text = "Revenue $100 in 2024";
    const c = classifyPage(normalized_text);
    expect(c.why.some((w) => w.startsWith("keyword:"))).toBe(true);
    expect(c.why.some((w) => w.startsWith("currency_count:"))).toBe(true);
    expect(c.why.some((w) => w.startsWith("year_count:"))).toBe(true);
  });

  it("extractMetrics: $2.4m normalizes to 2400000 USD", () => {
    const metrics = extractMetrics("Revenue $2.4m");
    const m = metrics.find((x) => x.raw_value === "$2.4m");
    expect(m).toBeTruthy();
    expect(m?.unit).toBe("USD");
    expect(m?.value_normalized).toBe(2400000);
  });

  it("extractMetrics: $1,200k normalizes to 1200000 USD", () => {
    const metrics = extractMetrics("Revenue $1,200k");
    const m = metrics.find((x) => x.raw_value === "$1,200k");
    expect(m).toBeTruthy();
    expect(m?.unit).toBe("USD");
    expect(m?.value_normalized).toBe(1200000);
  });

  it("extractMetrics: 45% normalizes to 45 PERCENT", () => {
    const metrics = extractMetrics("Gross margin 45% ");
    const m = metrics.find((x) => x.raw_value === "45%");
    expect(m).toBeTruthy();
    expect(m?.unit).toBe("PERCENT");
    expect(m?.value_normalized).toBe(45);
  });

  it("extractMetrics: detects years (2024) with unit YEARS", () => {
    const metrics = extractMetrics("In 2024, revenue grew.");
    const m = metrics.find((x) => x.raw_value === "2024");
    expect(m).toBeTruthy();
    expect(m?.unit).toBe("YEARS");
    expect(m?.value_normalized).toBe(2024);
  });

  it("extractMetrics: confidence increases when Revenue is near a currency token", () => {
    const withRevenue = extractMetrics("Revenue $2.4m").find((x) => x.raw_value === "$2.4m");
    const withoutRevenue = extractMetrics("Slide $2.4m").find((x) => x.raw_value === "$2.4m");
    expect(withRevenue).toBeTruthy();
    expect(withoutRevenue).toBeTruthy();
    expect((withRevenue?.confidence ?? 0) > (withoutRevenue?.confidence ?? 0)).toBe(true);
  });

  it("extractMetrics: stable ordering (same input => same order)", () => {
    const text = "Revenue $2.4m in 2024. Gross margin 45%. Pre-money valuation $10m.";
    const a = extractMetrics(text);
    const b = extractMetrics(text);
    expect(a).toEqual(b);
  });

  it("rankEvidence: evidence is non-empty for non-trivial text", () => {
    const text =
      "Revenue was $2.4m in 2024 for the quarter.\n" +
      "- Gross margin 45% year-over-year improvement.\n" +
      "Team includes Jane Doe CEO at Acme Inc.";
    const ev = rankEvidence(text);
    expect(ev.length).toBeGreaterThan(0);
  });

  it("rankEvidence: snippets are verbatim substrings of the source", () => {
    const text =
      "Revenue was $2.4m in 2024 for the quarter.\n" +
      "- Gross margin 45% year-over-year improvement.";
    const ev = rankEvidence(text);
    for (const s of ev) {
      expect(text.includes(s.snippet)).toBe(true);
      if (s.source_span) {
        expect(text.slice(s.source_span.start, s.source_span.end)).toBe(s.snippet);
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
    expect(a).toEqual(b);
  });

  it("rankEvidence: currency/percent/year features affect score ordering", () => {
    const currency = "Revenue was $2.4m in 2024 for the quarter.";
    const yearOnly = "In 2024 the company expanded internationally in a new region.";
    const plain = "This is a general statement about the company and its mission.";
    const text = `${plain}\n${yearOnly}\n${currency}`;
    const ev = rankEvidence(text);
    expect(ev[0]?.snippet.includes("$2.4m")).toBe(true);
    expect(ev[0]?.features?.includes("contains_currency")).toBe(true);
    expect(ev[0]?.features?.includes("contains_year")).toBe(true);
  });

  it("rankEvidence: stable tie-break (same score => lexicographic snippet order)", () => {
    const a = "Alpha statement happened in 2024 and then ended normally.";
    const b = "Beta statement happened in 2024 and then ended normally.";
    const text = `${b}\n${a}`;
    const ev = rankEvidence(text);

    const aRow = ev.find((x) => x.snippet.startsWith("Alpha statement"));
    const bRow = ev.find((x) => x.snippet.startsWith("Beta statement"));
    expect(aRow).toBeTruthy();
    expect(bRow).toBeTruthy();

    if (aRow && bRow) {
      expect(aRow.score).toBe(bRow.score);
      const aIndex = ev.findIndex((x) => x.snippet === aRow.snippet);
      const bIndex = ev.findIndex((x) => x.snippet === bRow.snippet);
      expect(aIndex).toBeGreaterThanOrEqual(0);
      expect(bIndex).toBeGreaterThanOrEqual(0);
      expect(aIndex).toBeLessThan(bIndex);
    }
  });

  it("buildUnderstandingPatch: includes all pages (no drops)", () => {
    const input: DeterministicUnderstandingInput = {
      deal_id: "deal_p7",
      documents: [{ document_id: "doc_1", title: "Doc" }],
      pages: [
        { page_id: "p1", document_id: "doc_1", page_index: 0, raw_ocr_text: "Revenue $2.4m in 2024." },
        { page_id: "p2", document_id: "doc_1", page_index: 1, raw_ocr_text: "Cap table and valuation $10m. Gross margin 45%." },
      ],
    };

    const patch = buildUnderstandingPatch(input, { now: () => new Date("2026-01-31T00:00:00.000Z") });
    expect(Object.keys(patch.pages).sort()).toEqual(["p1", "p2"]);
  });

  it("buildUnderstandingPatch: order-independent input yields identical patch", () => {
    const base: DeterministicUnderstandingInput = {
      deal_id: "deal_p7",
      documents: [{ document_id: "doc_1", title: "Doc" }],
      pages: [
        { page_id: "p1", document_id: "doc_1", page_index: 0, raw_ocr_text: "Revenue $2.4m in 2024." },
        { page_id: "p2", document_id: "doc_1", page_index: 1, raw_ocr_text: "Cap table and valuation $10m. Gross margin 45%." },
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
    expect(a).toEqual(b);
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
    expect(doc.document_key_points && doc.document_key_points.length > 0).toBe(true);

    const kps = doc.document_key_points ?? [];
    for (let i = 1; i < kps.length; i++) {
      const prev = kps[i - 1];
      const cur = kps[i];
      if (prev.score === cur.score) {
        expect(prev.snippet.localeCompare(cur.snippet)).toBeLessThanOrEqual(0);
      } else {
        expect(prev.score).toBeGreaterThanOrEqual(cur.score);
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
    expect(patch.created_at).toBe("2026-01-31T00:00:00.000Z");
  });
});
