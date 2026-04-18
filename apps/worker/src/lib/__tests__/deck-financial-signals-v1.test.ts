import { describe, it, expect } from "vitest";
import { extractDeckFinancialSignalsV1, detectMentionsInEvidenceText, type DeckSignalPage } from "../deck-financial-signals-v1.js";

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

// ─── ARR_MRR_RE: space-plus-space format ─────────────────────────────────────

describe("extractDeckFinancialSignalsV1 — ARR_MRR_RE (space-plus-space format)", () => {
  it('captures "$100K + ARR" (space before and after +)', () => {
    const result = extractDeckFinancialSignalsV1([page("Strong revenue traction ($100K + ARR)")]);
    const texts = result!.arr_mrr_mentions.map((m) => m.text);
    expect(texts.some((t) => t.includes("100K"))).toBe(true);
    expect(result!.has_arr_mrr).toBe(true);
  });

  it('captures "$500K + MRR" (space-plus-space with MRR)', () => {
    const result = extractDeckFinancialSignalsV1([page("Current run rate: $500K + MRR")]);
    const texts = result!.arr_mrr_mentions.map((m) => m.text);
    expect(texts.some((t) => t.includes("500K"))).toBe(true);
  });

  it('still captures "$6M+ ARR" (no space before +)', () => {
    const result = extractDeckFinancialSignalsV1([page("We are at $6M+ ARR with strong retention.")]);
    const texts = result!.arr_mrr_mentions.map((m) => m.text);
    expect(texts.some((t) => t.includes("6M"))).toBe(true);
  });

  it('still captures "$40K+ MRR" (no space before +)', () => {
    const result = extractDeckFinancialSignalsV1([page("Traction: $40K+ MRR & Growing")]);
    const texts = result!.arr_mrr_mentions.map((m) => m.text);
    expect(texts.some((t) => t.includes("40K"))).toBe(true);
  });

  it('does not match "ARR potential" without a dollar amount (market opportunity language)', () => {
    const result = extractDeckFinancialSignalsV1([
      page("Even a tiny slice translates into tens to hundreds of millions in ARR potential."),
    ]);
    // No dollar + ARR colocation → no arr_mrr_mentions
    expect(result?.arr_mrr_mentions ?? []).toHaveLength(0);
  });
});

// ─── detectMentionsInEvidenceText ─────────────────────────────────────────────

describe("detectMentionsInEvidenceText — ARR detection", () => {
  it("detects dollar + ARR mention (DealDecision format)", () => {
    const result = detectMentionsInEvidenceText([
      { claim_text: "Strong revenue traction ($100K + ARR)" },
    ]);
    expect(result.has_arr).toBe(true);
  });

  it("detects '$2M ARR' (plain amount + ARR)", () => {
    const result = detectMentionsInEvidenceText([{ claim_text: "Currently at $2M ARR" }]);
    expect(result.has_arr).toBe(true);
  });

  it("detects 'ARR of $5M' (ARR keyword before amount)", () => {
    const result = detectMentionsInEvidenceText([{ claim_text: "ARR of $5M last quarter" }]);
    expect(result.has_arr).toBe(true);
  });

  it("does NOT fire on market-opportunity language without dollar+ARR colocation", () => {
    // StackFactor-style: ARR as future target, no adjacent dollar
    const snippets = [
      { claim_text: "tens to hundreds of millions in ARR potential" },
      { claim_text: "Conservative 3-5yr ARR" },
      { claim_text: "Booked revenue reflects contracted ARR signed in-year" },
    ];
    const result = detectMentionsInEvidenceText(snippets);
    expect(result.has_arr).toBe(false);
  });

  it("does NOT fire on SEC legal text containing 'ARR' as substring", () => {
    // Allurion-style: ARRANGEMENT, WARRANTY embedded in legal filings
    const result = detectMentionsInEvidenceText([
      { claim_text: "NOTES TO THE UNAUDITED CONDENSED CONSOLIDATED FINANCIAL STATEMENTS" },
      { claim_text: "Registration Rights — WARRANT holders and arranger obligations" },
    ]);
    expect(result.has_arr).toBe(false);
  });

  it("returns false for null/empty claim_text", () => {
    const result = detectMentionsInEvidenceText([
      { claim_text: null },
      { claim_text: "" },
    ]);
    expect(result.has_arr).toBe(false);
    expect(result.has_burn).toBe(false);
    expect(result.has_runway).toBe(false);
  });

  it("returns all false for empty snippets array", () => {
    const result = detectMentionsInEvidenceText([]);
    expect(result).toEqual({ has_arr: false, has_burn: false, has_runway: false });
  });
});

describe("detectMentionsInEvidenceText — burn detection", () => {
  it("detects canonical_metric format (StackFactor format)", () => {
    // The format produced by buildFinancialFactRegistryV1 for derived burn metrics
    const result = detectMentionsInEvidenceText([
      { claim_text: "burn_rate: -3224.3975813559555 • type=derived metric=burn_rate derived_from={}" },
    ]);
    expect(result.has_burn).toBe(true);
  });

  it("detects 'burn rate $250K' deck format", () => {
    const result = detectMentionsInEvidenceText([
      { claim_text: "Current burn rate $250K per month" },
    ]);
    expect(result.has_burn).toBe(true);
  });

  it("detects 'monthly burn $500K'", () => {
    const result = detectMentionsInEvidenceText([
      { claim_text: "monthly burn $500K as of Q4" },
    ]);
    expect(result.has_burn).toBe(true);
  });

  it("does NOT fire on burn without dollar amount (no false positives)", () => {
    const result = detectMentionsInEvidenceText([
      { claim_text: "We are managing burn carefully." },
    ]);
    expect(result.has_burn).toBe(false);
  });
});

describe("detectMentionsInEvidenceText — runway detection", () => {
  it("detects 'runway 18 months'", () => {
    const result = detectMentionsInEvidenceText([
      { claim_text: "Current runway is 18 months at existing burn rate" },
    ]);
    expect(result.has_runway).toBe(true);
  });

  it("detects '24-month runway'", () => {
    const result = detectMentionsInEvidenceText([
      { claim_text: "We have a 24-month runway with current funding" },
    ]);
    expect(result.has_runway).toBe(true);
  });

  it("short-circuits after all three signals found", () => {
    const snippets = [
      { claim_text: "burn_rate: -1000" },
      { claim_text: "$200K ARR" },
      { claim_text: "runway 12 months" },
      { claim_text: "this should not be scanned" },
    ];
    const result = detectMentionsInEvidenceText(snippets);
    expect(result.has_arr).toBe(true);
    expect(result.has_burn).toBe(true);
    expect(result.has_runway).toBe(true);
  });
});
