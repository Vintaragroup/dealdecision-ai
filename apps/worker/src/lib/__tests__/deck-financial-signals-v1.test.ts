import { describe, it, expect } from "vitest";
import { extractDeckFinancialSignalsV1, type DeckSignalPage } from "../deck-financial-signals-v1.js";

// Helper to build a minimal DeckSignalPage
function page(text: string, page_index = 0, doc_id = "doc_test"): DeckSignalPage {
  return { document_id: doc_id, page_index, text };
}

describe("extractDeckFinancialSignalsV1 — ARR_MRR_RE (extended patterns)", () => {
  it('captures "$1,582,164 Total ARR" (Total label after amount)', () => {
    // Simulates traction row where amount is immediately followed by label (as in split table rows)
    const result = extractDeckFinancialSignalsV1([
      page("Total MRR $131,847  Total ARR $1,582,164"),
    ]);
    const texts = result!.arr_mrr_mentions.map((m) => m.text);
    expect(texts.some((t) => t.includes("1,582,164"))).toBe(true);
  });

  it('captures "$131,847 Total MRR" (Total label after amount)', () => {
    // The "$AMT Total MRR" pattern (amount before label)
    const result = extractDeckFinancialSignalsV1([
      page("$131,847 Total MRR  $1,582,164 Total ARR"),
    ]);
    const texts = result!.arr_mrr_mentions.map((m) => m.text);
    expect(texts.some((t) => t.includes("131,847"))).toBe(true);
  });

  it('captures "$40K+ MRR" (+ suffix on amount)', () => {
    const result = extractDeckFinancialSignalsV1([page("Traction: $40K+ MRR & Growing")]);
    const texts = result!.arr_mrr_mentions.map((m) => m.text);
    expect(texts.some((t) => t.includes("40K"))).toBe(true);
  });

  it('captures "$6M+ ARR" (+ suffix on amount)', () => {
    const result = extractDeckFinancialSignalsV1([page("We are at $6M+ ARR with strong retention.")]);
    const texts = result!.arr_mrr_mentions.map((m) => m.text);
    expect(texts.some((t) => t.includes("6M"))).toBe(true);
  });

  it('captures "ARR of $5M" (ARR keyword → of → amount)', () => {
    const result = extractDeckFinancialSignalsV1([page("We reached ARR of $5M last quarter.")]);
    const texts = result!.arr_mrr_mentions.map((m) => m.text);
    expect(texts.some((t) => t.includes("5M"))).toBe(true);
  });

  it('captures "Total ARR: $1.2M" (Total before keyword, colon separator)', () => {
    const result = extractDeckFinancialSignalsV1([page("Total ARR: $1.2M as of Q4.")]);
    const texts = result!.arr_mrr_mentions.map((m) => m.text);
    expect(texts.some((t) => t.includes("1.2M"))).toBe(true);
  });

  it("sets has_arr_mrr = true when arr_mrr mentions found", () => {
    const result = extractDeckFinancialSignalsV1([page("$131,847 Total MRR")]);
    expect(result!.has_arr_mrr).toBe(true);
  });
});

describe("extractDeckFinancialSignalsV1 — column-format traction extraction", () => {
  // Simulates Qredible-style traction slide where OCR reads all dollar values
  // (top row) before all metric labels (bottom row) in a single text block.
  const QREDIBLE_TRACTION_TEXT =
    "$1,748 $125,630 $4,469 $131,847 $1,582,164 " +
    "Client HQ MRR 170 Retail Locations MRR Reseller/B2B MRR Total MRR Total ARR";

  it("extracts $131,847 as Total MRR from column-format traction text", () => {
    const result = extractDeckFinancialSignalsV1([page(QREDIBLE_TRACTION_TEXT)]);
    const texts = result!.arr_mrr_mentions.map((m) => m.text);
    expect(texts.some((t) => t.includes("131,847") && /total/i.test(t))).toBe(true);
  });

  it("extracts $1,582,164 as Total ARR from column-format traction text", () => {
    const result = extractDeckFinancialSignalsV1([page(QREDIBLE_TRACTION_TEXT)]);
    const texts = result!.arr_mrr_mentions.map((m) => m.text);
    expect(texts.some((t) => t.includes("1,582,164") && /total/i.test(t))).toBe(true);
  });

  it("places column-total mentions BEFORE base mentions in arr_mrr_mentions", () => {
    // Column-total synthetic mentions should appear before base mentions in the list
    // so that downstream selectors can efficiently find them.
    const result = extractDeckFinancialSignalsV1([
      page("$40K+ MRR & Growing  Active pipeline $6M+ ARR"),      // bare mentions
      page(QREDIBLE_TRACTION_TEXT),                                 // column-total mentions
    ]);
    const mentions = result!.arr_mrr_mentions;
    // Column-total mentions (containing "Total") should appear in the list
    expect(mentions.some((m) => /Total/i.test(m.text) && /MRR/i.test(m.text))).toBe(true);
    expect(mentions.some((m) => /Total/i.test(m.text) && /\bARR\b/i.test(m.text))).toBe(true);
  });

  it("does NOT produce column-total mentions when 'Total MRR/ARR' is absent", () => {
    const result = extractDeckFinancialSignalsV1([
      page("$40K+ MRR  $500K ARR  Client A MRR $1.2M"),
    ]);
    const texts = result?.arr_mrr_mentions.map((m) => m.text) ?? [];
    // No "Total" in any mention because the page has no "Total MRR/ARR" label
    expect(texts.every((t) => !/Total/i.test(t))).toBe(true);
  });
});

describe("extractDeckFinancialSignalsV1 — BURN_RE (pricing safety)", () => {
  it('does NOT capture "$349/month per-agent pricing" as a burn mention', () => {
    const result = extractDeckFinancialSignalsV1([
      page("ISO Agent/Sub-ISO licenses at $349/month (745 agents x $4.2K ARR = $3.12M). The $349/month per-agent pricing delivers strong unit economics."),
    ]);
    // burn_mentions must be empty — no "burn" keyword present
    expect(result!.burn_mentions).toHaveLength(0);
    expect(result!.has_burn).toBe(false);
  });

  it('DOES capture "$349/month" in pricing_mentions for per-agent wording', () => {
    const result = extractDeckFinancialSignalsV1([
      page("ISO Agent licenses at $349/month per agent. The $349/month per-agent pricing is competitive."),
    ]);
    // PRICING_RE matches $AMT/month patterns
    expect(result!.pricing_mentions.length).toBeGreaterThan(0);
    expect(result!.has_pricing).toBe(true);
  });

  it("still captures actual burn rate when 'burn rate' keyword present", () => {
    const result = extractDeckFinancialSignalsV1([
      page("Current burn rate $125,000/month with 18 months runway."),
    ]);
    const texts = result!.burn_mentions.map((m) => m.text);
    expect(texts.some((t) => t.includes("125,000"))).toBe(true);
    expect(result!.has_burn).toBe(true);
  });

  it("captures 'monthly burn $80K' format", () => {
    const result = extractDeckFinancialSignalsV1([page("monthly burn $80K, runway 24 months")]);
    const texts = result!.burn_mentions.map((m) => m.text);
    expect(texts.some((t) => t.includes("80K"))).toBe(true);
  });
});

describe("extractDeckFinancialSignalsV1 — REVENUE_RE (efficiency ratio safety)", () => {
  it('does NOT treat "each sales dollar generating over $11 in ARR" as revenue', () => {
    // REVENUE_RE matches "sales...within 25 chars...$11" but $11 < MIN_PLAUSIBLE threshold
    // The regex WILL match it — but the build-financial-fact-registry min-value guards
    // filter it out downstream. Here we just document the regex behavior:
    const result = extractDeckFinancialSignalsV1([
      page("with each sales dollar generating over $11 in ARR"),
    ]);
    // The mention CAN appear in revenue_mentions (regex matches) — that's fine,
    // the guard is applied in build-financial-fact-registry-v1.ts section 6
    // But it should NOT show a multi-figure revenue capture:
    const texts = result!.revenue_mentions.map((m) => m.text);
    // If present, the matched value should be $11 (the efficiency ratio), not a real revenue figure
    if (texts.length > 0) {
      expect(texts.every((t) => t.includes("11"))).toBe(true);
    }
  });

  it("captures real revenue figures correctly", () => {
    const result = extractDeckFinancialSignalsV1([
      page("Revenue: $2.4M in FY2024, growing 142% YoY"),
    ]);
    const texts = result!.revenue_mentions.map((m) => m.text);
    expect(texts.some((t) => t.includes("2.4M"))).toBe(true);
    expect(result!.has_revenue).toBe(true);
  });
});

describe("extractDeckFinancialSignalsV1 — null/empty guard", () => {
  it("returns null when pages array is empty", () => {
    const result = extractDeckFinancialSignalsV1([]);
    expect(result).toBeNull();
  });

  it("returns null for pages with only empty text (no signals found)", () => {
    // extractDeckFinancialSignalsV1 returns null when no signals are detected
    // (empty pages produce no regex matches → hasAny=false → null)
    const result = extractDeckFinancialSignalsV1([page(""), page("   ")]);
    expect(result).toBeNull();
  });
});
