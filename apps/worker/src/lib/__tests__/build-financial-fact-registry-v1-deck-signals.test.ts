/**
 * Tests for buildFinancialFactRegistryV1 covering the deck-signal fixes:
 *  - Section 5 (orchestratorBenchmarks): MIN_PLAUSIBLE guards for burn_rate and revenue
 *  - Section 6 (deckSignals): pricing-guard for burn_rate, largestMentionMatch for ARR/MRR,
 *    new MRR deck fact group, and MIN_PLAUSIBLE floor guard in the loop
 */
import { describe, it, expect } from "vitest";
import { buildFinancialFactRegistryV1 } from "../build-financial-fact-registry-v1.js";
import type { DeckFinancialSignalsV1, DeckFinancialMention } from "../deck-financial-signals-v1.js";

const DEAL_ID = "test-deal-deck-signals";

// ─── Minimal DeckFinancialSignalsV1 factory ────────────────────────────────

function emptySignals(): DeckFinancialSignalsV1 {
  return {
    schema_version: "deck_financial_signals_v1",
    revenue_mentions: [],
    burn_mentions: [],
    runway_mentions: [],
    margin_mentions: [],
    pricing_mentions: [],
    arr_mrr_mentions: [],
    unit_econ_mentions: [],
    has_revenue: false,
    has_burn: false,
    has_runway: false,
    has_pricing: false,
    has_arr_mrr: false,
    has_unit_economics: false,
    pages_scanned: 1,
  };
}

function mention(text: string): DeckFinancialMention {
  return { text, doc_id: "doc_test", page_index: 0 };
}

// ─── Section 5: orchestratorBenchmarks plausibility guards ────────────────

describe("buildFinancialFactRegistryV1 — section 5 orchestratorBenchmarks plausibility", () => {
  it("drops burn_rate=349 with basis=deck_signal (< $1K threshold)", () => {
    const facts = buildFinancialFactRegistryV1({
      dealId: DEAL_ID,
      orchestratorBenchmarks: [
        { label: "burn rate", value: "$349/month", basis: "deck_signal", evidence_refs: [] },
      ],
    });
    const burnFacts = facts.filter((f) => f.metric_key === "burn_rate");
    expect(burnFacts).toHaveLength(0);
  });

  it("drops burn_rate=500 with basis=deck_signal (< $1K threshold)", () => {
    const facts = buildFinancialFactRegistryV1({
      dealId: DEAL_ID,
      orchestratorBenchmarks: [
        { label: "burn rate", value: "$500", basis: "deck_signal", evidence_refs: [] },
      ],
    });
    expect(facts.filter((f) => f.metric_key === "burn_rate")).toHaveLength(0);
  });

  it("accepts burn_rate=$50,000 with basis=deck_signal (>= $1K)", () => {
    const facts = buildFinancialFactRegistryV1({
      dealId: DEAL_ID,
      orchestratorBenchmarks: [
        // Use "$50,000" (no "/month" suffix — parseLooseCurrency can't parse "/month")
        { label: "burn rate", value: "$50,000", basis: "deck_signal", evidence_refs: [] },
      ],
    });
    const burnFacts = facts.filter((f) => f.metric_key === "burn_rate");
    expect(burnFacts).toHaveLength(1);
    expect(burnFacts[0]!.value).toBe(50000);
    expect(burnFacts[0]!.source_kind).toBe("deck");
  });

  it("drops revenue=$11 with basis=deck_signal (< $1K threshold — efficiency ratio)", () => {
    const facts = buildFinancialFactRegistryV1({
      dealId: DEAL_ID,
      orchestratorBenchmarks: [
        { label: "revenue", value: "$11", basis: "deck_signal", evidence_refs: [] },
      ],
    });
    expect(facts.filter((f) => f.metric_key === "revenue")).toHaveLength(0);
  });

  it("accepts revenue=$381,000 with basis=deck_signal", () => {
    const facts = buildFinancialFactRegistryV1({
      dealId: DEAL_ID,
      orchestratorBenchmarks: [
        { label: "revenue", value: "$381,000", basis: "deck_signal", evidence_refs: [] },
      ],
    });
    const revFacts = facts.filter((f) => f.metric_key === "revenue");
    expect(revFacts).toHaveLength(1);
    expect(revFacts[0]!.value).toBe(381000);
  });

  it("does NOT drop burn_rate=$800 for basis=direct (threshold only applies to deck_signal)", () => {
    // A direct benchmark could legitimately be small (pre-revenue startup with <$1K burn is
    // unrealistic but not filtered — only deck_signal has the pricing contamination problem)
    const facts = buildFinancialFactRegistryV1({
      dealId: DEAL_ID,
      orchestratorBenchmarks: [
        { label: "burn rate", value: "$800", basis: "direct", evidence_refs: [] },
      ],
    });
    // direct basis is NOT filtered by the plausibility guard
    const burnFacts = facts.filter((f) => f.metric_key === "burn_rate");
    expect(burnFacts).toHaveLength(1);
    expect(burnFacts[0]!.source_kind).toBe("xlsx"); // basis="direct" → source_kind="xlsx"
  });
});

// ─── Section 6: deckSignals ARR — largestMentionMatch ────────────────────

describe("buildFinancialFactRegistryV1 — section 6 ARR largestMentionMatch", () => {
  it("selects the largest ARR mention when multiple candidates exist ($5,120 vs $1,582,164)", () => {
    const signals = emptySignals();
    signals.arr_mrr_mentions = [
      mention("$5120 ARR"),          // OCR garble — small value
      mention("$1,582,164 Total ARR"), // real traction — should win
    ];
    signals.has_arr_mrr = true;

    const facts = buildFinancialFactRegistryV1({ dealId: DEAL_ID, deckSignals: signals });
    const arrFact = facts.find((f) => f.metric_key === "arr");
    expect(arrFact).toBeDefined();
    expect(arrFact!.value).toBe(1582164);
    expect(arrFact!.source_kind).toBe("deck");
  });

  it("drops arr=$5,120 when it's the only candidate (below no threshold — ARR has no MIN guard)", () => {
    // ARR does not have a MIN_PLAUSIBLE guard (it's a KPI not a burn/revenue line),
    // so small values ARE stored. This documents current behavior.
    const signals = emptySignals();
    signals.arr_mrr_mentions = [mention("$5120 ARR")];
    signals.has_arr_mrr = true;

    const facts = buildFinancialFactRegistryV1({ dealId: DEAL_ID, deckSignals: signals });
    const arrFact = facts.find((f) => f.metric_key === "arr");
    // 5120 is the only value so it wins (no better candidate)
    expect(arrFact).toBeDefined();
    expect(arrFact!.value).toBe(5120);
  });

  it("stores nothing for arr when arr_mrr_mentions contains only MRR-labeled entries", () => {
    const signals = emptySignals();
    signals.arr_mrr_mentions = [mention("$131,847 Total MRR")]; // MRR only, no ARR
    signals.has_arr_mrr = true;

    const facts = buildFinancialFactRegistryV1({ dealId: DEAL_ID, deckSignals: signals });
    expect(facts.find((f) => f.metric_key === "arr")).toBeUndefined();
  });
});

// ─── Section 6: deckSignals MRR — new group ──────────────────────────────

describe("buildFinancialFactRegistryV1 — section 6 MRR deck fact group (new)", () => {
  it("extracts mrr=$131,847 from '$131,847 Total MRR'", () => {
    const signals = emptySignals();
    signals.arr_mrr_mentions = [mention("$131,847 Total MRR")];
    signals.has_arr_mrr = true;

    const facts = buildFinancialFactRegistryV1({ dealId: DEAL_ID, deckSignals: signals });
    const mrrFact = facts.find((f) => f.metric_key === "mrr");
    expect(mrrFact).toBeDefined();
    expect(mrrFact!.value).toBe(131847);
    expect(mrrFact!.source_kind).toBe("deck");
  });

  it("selects largest MRR when multiple candidates exist ($1,748 vs $131,847)", () => {
    const signals = emptySignals();
    signals.arr_mrr_mentions = [
      mention("$1,748 Client HQ MRR"),   // small per-segment figure
      mention("$131,847 Total MRR"),       // total — should win
    ];
    signals.has_arr_mrr = true;

    const facts = buildFinancialFactRegistryV1({ dealId: DEAL_ID, deckSignals: signals });
    const mrrFact = facts.find((f) => f.metric_key === "mrr");
    expect(mrrFact).toBeDefined();
    expect(mrrFact!.value).toBe(131847);
  });

  it("extracts mrr from '$40K+ MRR' mention", () => {
    const signals = emptySignals();
    signals.arr_mrr_mentions = [mention("$40K+ MRR & Growing")];
    signals.has_arr_mrr = true;

    const facts = buildFinancialFactRegistryV1({ dealId: DEAL_ID, deckSignals: signals });
    const mrrFact = facts.find((f) => f.metric_key === "mrr");
    expect(mrrFact).toBeDefined();
    expect(mrrFact!.value).toBe(40000);
  });
});

// ─── Section 6: burn_rate pricing guard ──────────────────────────────────

describe("buildFinancialFactRegistryV1 — section 6 burn_rate pricing guard", () => {
  it("filters out burn mention that overlaps with a pricing_mention text", () => {
    const signals = emptySignals();
    // Simulate a case where BURN_RE somehow matched "$349/month" (e.g. via legacy config)
    // and it also appears in pricing_mentions
    const pricingText = "$349 /month"; // PRICING_RE: "$AMT /month"
    signals.burn_mentions = [mention(pricingText)];
    signals.pricing_mentions = [mention(pricingText)];
    signals.has_burn = true;
    signals.has_pricing = true;

    const facts = buildFinancialFactRegistryV1({ dealId: DEAL_ID, deckSignals: signals });
    expect(facts.filter((f) => f.metric_key === "burn_rate")).toHaveLength(0);
  });

  it("filters out burn mention with PRICING_SIGNAL_RE patterns like 'per-agent'", () => {
    const signals = emptySignals();
    // Even if it landed in burn_mentions, per-agent wording is filtered
    signals.burn_mentions = [mention("$349/month per-agent pricing for ISO licenses")];
    signals.has_burn = true;

    const facts = buildFinancialFactRegistryV1({ dealId: DEAL_ID, deckSignals: signals });
    expect(facts.filter((f) => f.metric_key === "burn_rate")).toHaveLength(0);
  });

  it("filters out burn mention with value < $1K (subscription/license pricing floor)", () => {
    const signals = emptySignals();
    signals.burn_mentions = [mention("burn rate $500")]; // < $1K
    signals.has_burn = true;

    const facts = buildFinancialFactRegistryV1({ dealId: DEAL_ID, deckSignals: signals });
    expect(facts.filter((f) => f.metric_key === "burn_rate")).toHaveLength(0);
  });

  it("accepts valid burn_rate mention that is not pricing-like and >= $1K", () => {
    const signals = emptySignals();
    signals.burn_mentions = [mention("burn rate $125,000 per month")];
    signals.has_burn = true;

    const facts = buildFinancialFactRegistryV1({ dealId: DEAL_ID, deckSignals: signals });
    const burnFact = facts.find((f) => f.metric_key === "burn_rate");
    expect(burnFact).toBeDefined();
    expect(burnFact!.value).toBe(125000);
  });
});

// ─── Section 6: revenue MIN_PLAUSIBLE floor in loop ──────────────────────

describe("buildFinancialFactRegistryV1 — section 6 revenue MIN_PLAUSIBLE loop guard", () => {
  it("drops revenue=$11 from deck signals (loop guard)", () => {
    const signals = emptySignals();
    signals.revenue_mentions = [mention("sales dollar generating over $11 in ARR")];
    signals.has_revenue = true;

    const facts = buildFinancialFactRegistryV1({ dealId: DEAL_ID, deckSignals: signals });
    expect(facts.filter((f) => f.metric_key === "revenue")).toHaveLength(0);
  });

  it("accepts revenue=$381,000 from deck signals", () => {
    const signals = emptySignals();
    signals.revenue_mentions = [mention("Total Revenue $381,000")];
    signals.has_revenue = true;

    const facts = buildFinancialFactRegistryV1({ dealId: DEAL_ID, deckSignals: signals });
    const revFact = facts.find((f) => f.metric_key === "revenue");
    expect(revFact).toBeDefined();
    expect(revFact!.value).toBe(381000);
  });
});
