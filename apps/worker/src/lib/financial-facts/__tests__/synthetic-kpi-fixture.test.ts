/**
 * synthetic-kpi-fixture.test.ts
 *
 * REF-DEAL-6 behavioral validation for the SyntheticKPI ground-truth spec.
 * Exercises `extractDeckFinancialSignalsV1` and `buildFinancialTruthV1` with
 * deck page text representing SynthCapture — a deck-only deal with:
 *
 *   True KPI values (traction slide):
 *     $182,400  Total MRR
 *     $2,188,800 Total ARR
 *
 *   Noise sources to reject:
 *     Pricing:      $99/seat/month, $499/month
 *     TAM/SAM/SOM:  $4.2B TAM, $900M SAM, $120M SOM
 *     Competitors:  ARR $50M, ARR $12M
 *     Unit econ:    LTV $18,000, CAC $2,100
 *     Channel proj: MRR of $381K, ARR of $6M potential
 *     Fundraise:    $6M raise, $24M pre-money
 *
 * Ground truth: evaluation/ground_truth/SyntheticKPI.json
 *
 * Test suites:
 *   Suite 1 — KPI extraction from traction slide
 *   Suite 2 — Pricing suppression (not in burn/arr/mrr)
 *   Suite 3 — Market size / competitor suppression
 *   Suite 4 — Channel projection suppression (Total label wins)
 *   Suite 5 — kpi_tile selection precedence over aspirational deck values
 *
 * No DB or API dependency — pure unit tests.
 */

import { describe, it, expect } from "vitest";
import { extractDeckFinancialSignalsV1 } from "../../deck-financial-signals-v1.js";
import type { DeckSignalPage } from "../../deck-financial-signals-v1.js";
import { buildFinancialTruthV1 } from "../build-financial-truth-v1.js";
import type { FinancialFactV1, FinancialFactSourceKind } from "@dealdecision/core";
import type { TemporalScope } from "@dealdecision/core";

// ─── Fixture constants ────────────────────────────────────────────────────────

const DEAL_ID    = "00000000-0000-4000-8000-000000000002";  // matches SyntheticKPI.json
const DOC_DECK   = "doc-synthcapture-deck-0001";

const TRUE_MRR = 182_400;
const TRUE_ARR = 2_188_800;

// Noise values that must NOT become resolved ARR/MRR/burn
const COMPETITOR_A_ARR  = 50_000_000;
const COMPETITOR_B_ARR  = 12_000_000;
const CHANNEL_MRR_PROJ  = 381_000;
const CHANNEL_ARR_PROJ  = 6_000_000;

// ─── Deck page fixtures ───────────────────────────────────────────────────────
//
// These exact strings match `_fixture_deck_text` in SyntheticKPI.json.
// Changing them here requires updating the JSON and vice versa.

function page(text: string, pageIndex: number): DeckSignalPage {
  return { document_id: DOC_DECK, page_index: pageIndex, text };
}

const PAGE_TRACTION = page(
  "TRACTION — Q4 2025\n$182,400 Total MRR\n$2,188,800 Total ARR\n152 Customers\n18% MoM Growth",
  0,
);
const PAGE_PRICING = page(
  "PRICING\n$99/seat/month — Starter Plan\n$499/month — Platform Fee\n$1,250 Onboarding (one-time)",
  1,
);
const PAGE_MARKET = page(
  "MARKET OPPORTUNITY\nTotal Addressable Market: $4.2B TAM\nServiceable Addressable Market: $900M SAM\nServiceable Obtainable Market: $120M SOM",
  2,
);
const PAGE_COMPETITORS = page(
  "COMPETITIVE LANDSCAPE\nCompetitor A: ARR $50M (Series C, 200 customers)\nCompetitor B: ARR $12M (Series B, 80 customers)\nWe offer 3x better NPS than Competitor A",
  3,
);
const PAGE_UNIT_ECON = page(
  "UNIT ECONOMICS\nLTV $18,000\nCAC $2,100\nPayback 7 months\nRevenue efficiency: 11x per sales dollar",
  4,
);
const PAGE_FUNDRAISE = page(
  "FUNDRAISE\nRaising $6M at $24M pre-money\nCHANNEL PARTNER OPPORTUNITY\nProjected channel MRR of $381K (2026 target)\nChannel ARR of $6M potential by end of 2026",
  5,
);

/** All 6 deck pages — the full noisy deck */
const ALL_PAGES = [
  PAGE_TRACTION,
  PAGE_PRICING,
  PAGE_MARKET,
  PAGE_COMPETITORS,
  PAGE_UNIT_ECON,
  PAGE_FUNDRAISE,
];

/** Pages without the traction slide — used for competitor/channel noise tests */
const NOISE_PAGES_ONLY = [
  PAGE_PRICING,
  PAGE_MARKET,
  PAGE_COMPETITORS,
  PAGE_UNIT_ECON,
  PAGE_FUNDRAISE,
];

// ─── Shared helpers ───────────────────────────────────────────────────────────

const NULL_PB = {
  revenue_latest: null,
  burn_monthly: null,
  runway_months: null,
  cash_latest: null,
};

let _seq = 0;
function makeArrMrrFact(opts: {
  metric_key: "arr" | "mrr";
  value: number;
  source_kind?: FinancialFactSourceKind;
  temporal_scope?: TemporalScope;
}): FinancialFactV1 {
  _seq++;
  return {
    fact_id:        `synthkpi-${opts.metric_key}-${_seq}`,
    deal_id:        DEAL_ID,
    document_id:    DOC_DECK,
    source_kind:    opts.source_kind ?? "kpi_tile",
    metric_key:     opts.metric_key,
    metric_label:   opts.metric_key.toUpperCase(),
    period_type:    "unknown",
    period_label:   "current",
    value:          opts.value,
    unit:           "currency",
    currency:       "USD",
    confidence:     "high",
    source_pointer: `SynthCapture traction KPI tile: ${opts.metric_key} = ${opts.value}`,
    excerpt:        `${opts.metric_key.toUpperCase()}: ${opts.value}`,
    temporal_scope: opts.temporal_scope ?? "current",
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Suite 1 — KPI extraction: traction slide captures true MRR and ARR
// ═══════════════════════════════════════════════════════════════════════════════

describe("REF-DEAL-6 Suite 1: KPI extraction — traction slide Total MRR / Total ARR", () => {
  const signals = extractDeckFinancialSignalsV1([PAGE_TRACTION])!;

  it("signals is not null", () => {
    expect(signals).not.toBeNull();
  });

  it("has_arr_mrr is true", () => {
    expect(signals.has_arr_mrr).toBe(true);
  });

  it("arr_mrr_mentions contains a 'Total MRR' mention", () => {
    const hasTotalMrr = signals.arr_mrr_mentions.some((m) =>
      /\bTotal\b/i.test(m.text) && /\bMRR\b/i.test(m.text),
    );
    expect(hasTotalMrr).toBe(true);
  });

  it("arr_mrr_mentions contains a 'Total ARR' mention", () => {
    const hasTotalArr = signals.arr_mrr_mentions.some((m) =>
      /\bTotal\b/i.test(m.text) && /\bARR\b/i.test(m.text),
    );
    expect(hasTotalArr).toBe(true);
  });

  describe("truth resolution from traction slide only", () => {
    const truth = buildFinancialTruthV1({
      facts: [],
      deckFinancialSignals: signals,
      pipelineB: NULL_PB,
    });

    it("arr resolves to TRUE_ARR ($2,188,800)", () => {
      const arr = truth["arr"]!;
      expect(arr.resolved_value).toBeGreaterThanOrEqual(TRUE_ARR * 0.85);
      expect(arr.resolved_value).toBeLessThanOrEqual(TRUE_ARR * 1.15);
    });

    it("mrr resolves to TRUE_MRR ($182,400)", () => {
      const mrr = truth["mrr"]!;
      expect(mrr.resolved_value).toBeGreaterThanOrEqual(TRUE_MRR * 0.85);
      expect(mrr.resolved_value).toBeLessThanOrEqual(TRUE_MRR * 1.15);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Suite 2 — Pricing suppression: $99/seat and $499/month stay in pricing_mentions
// ═══════════════════════════════════════════════════════════════════════════════

describe("REF-DEAL-6 Suite 2: Pricing suppression — tier prices not in burn/arr/mrr", () => {
  const signals = extractDeckFinancialSignalsV1([PAGE_PRICING])!;

  it("signals is not null (pricing slide has detectable values)", () => {
    expect(signals).not.toBeNull();
  });

  it("pricing_mentions captures $99/seat/month", () => {
    const texts = signals.pricing_mentions.map((m) => m.text);
    expect(texts.some((t) => t.includes("99") && /seat/i.test(t))).toBe(true);
  });

  it("pricing_mentions captures $499/month", () => {
    const texts = signals.pricing_mentions.map((m) => m.text);
    expect(texts.some((t) => t.includes("499"))).toBe(true);
  });

  it("burn_mentions does NOT contain $99 pricing value", () => {
    const texts = signals.burn_mentions.map((m) => m.text);
    expect(texts.some((t) => t.includes("99"))).toBe(false);
  });

  it("burn_mentions does NOT contain $499 pricing value", () => {
    const texts = signals.burn_mentions.map((m) => m.text);
    expect(texts.some((t) => t.includes("499"))).toBe(false);
  });

  it("arr_mrr_mentions does NOT contain pricing values ($99 or $499)", () => {
    const texts = signals.arr_mrr_mentions.map((m) => m.text);
    const hasPricingNoise = texts.some((t) => t.includes("99") || t.includes("499"));
    expect(hasPricingNoise).toBe(false);
  });

  it("truth resolution: burn_rate is null when only pricing slide present", () => {
    const truth = buildFinancialTruthV1({
      facts: [],
      deckFinancialSignals: signals,
      pipelineB: NULL_PB,
    });
    expect(truth["burn_rate"]!.resolved_value).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Suite 3 — Market / competitor suppression
// ═══════════════════════════════════════════════════════════════════════════════

describe("REF-DEAL-6 Suite 3: Market / competitor suppression", () => {

  describe("TAM/SAM/SOM slide: market-size numbers not captured as revenue/arr/mrr", () => {
    const tamSignals = extractDeckFinancialSignalsV1([PAGE_MARKET]);

    it("TAM slide produces no arr_mrr_mentions", () => {
      // $4.2B TAM / $900M SAM / $120M SOM contain no ARR/MRR keywords
      const count = tamSignals?.arr_mrr_mentions.length ?? 0;
      expect(count).toBe(0);
    });

    it("TAM slide produces no revenue_mentions", () => {
      // 'TAM', 'SAM', 'SOM' are not revenue/sales keywords
      const count = tamSignals?.revenue_mentions.length ?? 0;
      expect(count).toBe(0);
    });

    it("truth resolution: arr is INSUFFICIENT when only TAM data present", () => {
      if (!tamSignals) return;
      const truth = buildFinancialTruthV1({
        facts: [],
        deckFinancialSignals: tamSignals,
        pipelineB: NULL_PB,
      });
      expect(truth["arr"]!.state).toBe("INSUFFICIENT");
    });
  });

  describe("Competitor slide: competitor ARR in arr_mrr_mentions but loses to Total ARR", () => {
    const compSignals = extractDeckFinancialSignalsV1([PAGE_COMPETITORS])!;

    it("competitor slide has arr_mrr_mentions (competitor ARR is captured)", () => {
      // We WANT to see this captured so we can test that Total ARR wins
      expect(compSignals.arr_mrr_mentions.length).toBeGreaterThan(0);
    });

    it("competitor ARR mentions include $50M ARR", () => {
      const texts = compSignals.arr_mrr_mentions.map((m) => m.text);
      expect(texts.some((t) => /50M/.test(t) && /ARR/i.test(t))).toBe(true);
    });

    it("competitor ARR mentions contain NO 'Total' label — they are plain ADR mentions", () => {
      const totalMentions = compSignals.arr_mrr_mentions.filter(
        (m) => /\bTotal\b/i.test(m.text),
      );
      expect(totalMentions.length).toBe(0);
    });

    it("truth (competitor only): arr resolves to largest competitor value (no Total to correct it)", () => {
      // Without the traction slide, getDeckValue picks firstMatch = $50M
      // This documents the known failure mode that Suite 5 (kpi_tile) fixes
      const truth = buildFinancialTruthV1({
        facts: [],
        deckFinancialSignals: compSignals,
        pipelineB: NULL_PB,
      });
      const arrVal = truth["arr"]!.resolved_value ?? 0;
      // Without a Total ARR label, the largest first-match ARR wins in deck-only mode.
      // This exposes WHY Suite 5's kpi_tile precedence is critical.
      expect(arrVal).toBeGreaterThan(TRUE_ARR);
    });

    it("full deck: Total ARR from traction slide beats competitor ARR", () => {
      const fullSignals = extractDeckFinancialSignalsV1([PAGE_TRACTION, PAGE_COMPETITORS])!;
      const truth = buildFinancialTruthV1({
        facts: [],
        deckFinancialSignals: fullSignals,
        pipelineB: NULL_PB,
      });
      const arrVal = truth["arr"]!.resolved_value ?? 0;
      expect(arrVal).toBeGreaterThanOrEqual(TRUE_ARR * 0.85);
      expect(arrVal).toBeLessThanOrEqual(TRUE_ARR * 1.15);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Suite 4 — Channel / fundraise projection suppression
// ═══════════════════════════════════════════════════════════════════════════════

describe("REF-DEAL-6 Suite 4: Channel / fundraise projection suppression", () => {
  const fundraiseSignals = extractDeckFinancialSignalsV1([PAGE_FUNDRAISE])!;

  it("fundraise slide captures channel MRR projection mentions", () => {
    const texts = fundraiseSignals.arr_mrr_mentions.map((m) => m.text);
    expect(texts.some((t) => /381/.test(t) || /MRR/i.test(t))).toBe(true);
  });

  it("channel MRR projection has no 'Total' label", () => {
    const totalMrrMentions = fundraiseSignals.arr_mrr_mentions.filter(
      (m) => /\bTotal\b/i.test(m.text) && /\bMRR\b/i.test(m.text),
    );
    expect(totalMrrMentions.length).toBe(0);
  });

  it("full deck: True Total MRR ($182,400) beats channel projected MRR ($381K)", () => {
    const fullSignals = extractDeckFinancialSignalsV1([PAGE_TRACTION, PAGE_FUNDRAISE])!;
    const truth = buildFinancialTruthV1({
      facts: [],
      deckFinancialSignals: fullSignals,
      pipelineB: NULL_PB,
    });
    const mrrVal = truth["mrr"]!.resolved_value ?? 0;
    expect(mrrVal).toBeGreaterThanOrEqual(TRUE_MRR * 0.85);
    expect(mrrVal).toBeLessThanOrEqual(TRUE_MRR * 1.15);
    // Specifically should NOT be the channel projection
    const isChannelMrr =
      mrrVal >= CHANNEL_MRR_PROJ * 0.85 && mrrVal <= CHANNEL_MRR_PROJ * 1.15;
    expect(isChannelMrr).toBe(false);
  });

  it("full deck: True Total ARR ($2.18M) beats channel ARR potential ($6M)", () => {
    const fullSignals = extractDeckFinancialSignalsV1([PAGE_TRACTION, PAGE_FUNDRAISE])!;
    const truth = buildFinancialTruthV1({
      facts: [],
      deckFinancialSignals: fullSignals,
      pipelineB: NULL_PB,
    });
    const arrVal = truth["arr"]!.resolved_value ?? 0;
    expect(arrVal).toBeGreaterThanOrEqual(TRUE_ARR * 0.85);
    expect(arrVal).toBeLessThanOrEqual(TRUE_ARR * 1.15);
    const isChannelArr =
      arrVal >= CHANNEL_ARR_PROJ * 0.85 && arrVal <= CHANNEL_ARR_PROJ * 1.15;
    expect(isChannelArr).toBe(false);
  });

  it("burn_rate remains null (no burn data in fundraise slide)", () => {
    const truth = buildFinancialTruthV1({
      facts: [],
      deckFinancialSignals: fundraiseSignals,
      pipelineB: NULL_PB,
    });
    expect(truth["burn_rate"]!.resolved_value).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Suite 5 — kpi_tile selection precedence over aspirational deck values
// ═══════════════════════════════════════════════════════════════════════════════

describe("REF-DEAL-6 Suite 5: kpi_tile precedence — structured facts beat deck mentions", () => {
  // Use NOISE_PAGES_ONLY (no traction slide) so getDeckValue("arr") picks
  // Competitor A's $50M ARR as firstMatch. The kpi_tile fact must override it.
  const noisyDeckSignals = extractDeckFinancialSignalsV1(NOISE_PAGES_ONLY)!;

  const kpiArrFact  = makeArrMrrFact({ metric_key: "arr", value: TRUE_ARR,   source_kind: "kpi_tile" });
  const kpiMrrFact  = makeArrMrrFact({ metric_key: "mrr", value: TRUE_MRR,   source_kind: "kpi_tile" });

  const truth = buildFinancialTruthV1({
    facts: [kpiArrFact, kpiMrrFact],
    deckFinancialSignals: noisyDeckSignals,
    pipelineB: NULL_PB,
  });

  it("noisy deck produces arr_mrr_mentions (competitor $50M ARR is present)", () => {
    expect(noisyDeckSignals.arr_mrr_mentions.length).toBeGreaterThan(0);
  });

  it("arr state is not INSUFFICIENT — kpi_tile conflicting with $50M deck produces CONFLICT, not silence", () => {
    // When kpi_tile=$2.18M conflicts with deck firstMatch=$50M (no Total ARR),
    // the state is CONFLICT. That is correct: there IS a disagreement.
    // The resolved_value still correctly picks the kpi_tile via source priority.
    expect(truth["arr"]!.state).not.toBe("INSUFFICIENT");
  });

  it("resolved ARR is TRUE_ARR ($2,188,800), not competitor $50M ARR", () => {
    const arrVal = truth["arr"]!.resolved_value ?? 0;
    expect(arrVal).toBeGreaterThanOrEqual(TRUE_ARR * 0.85);
    expect(arrVal).toBeLessThanOrEqual(TRUE_ARR * 1.15);
    // Must not resolve to competitor ARR
    expect(arrVal).not.toBeCloseTo(COMPETITOR_A_ARR, -3);
  });

  it("resolved MRR is TRUE_MRR ($182,400), not channel projected $381K", () => {
    const mrrVal = truth["mrr"]!.resolved_value ?? 0;
    expect(mrrVal).toBeGreaterThanOrEqual(TRUE_MRR * 0.85);
    expect(mrrVal).toBeLessThanOrEqual(TRUE_MRR * 1.15);
    expect(mrrVal).not.toBeCloseTo(CHANNEL_MRR_PROJ, -3);
  });

  it("resolved_source_kind for arr is structured (not deck)", () => {
    // kpi_tile maps to 'structured_derived' bucket
    const kind = truth["arr"]!.resolved_source_kind;
    expect(kind).not.toBe("deck");
  });

  it("burn_rate is null (kpi_tile facts provided no burn data)", () => {
    expect(truth["burn_rate"]!.resolved_value).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Suite 6 — Full deck end-to-end: all 6 pages with kpi_tile facts
// ═══════════════════════════════════════════════════════════════════════════════

describe("REF-DEAL-6 Suite 6: Full deck end-to-end — all noise pages, kpi_tile facts win", () => {
  const fullSignals = extractDeckFinancialSignalsV1(ALL_PAGES)!;
  const kpiArrFact  = makeArrMrrFact({ metric_key: "arr", value: TRUE_ARR, source_kind: "kpi_tile" });
  const kpiMrrFact  = makeArrMrrFact({ metric_key: "mrr", value: TRUE_MRR, source_kind: "kpi_tile" });

  const truth = buildFinancialTruthV1({
    facts: [kpiArrFact, kpiMrrFact],
    deckFinancialSignals: fullSignals,
    pipelineB: NULL_PB,
  });

  it("ARR resolves correctly from full noisy deck", () => {
    const arrVal = truth["arr"]!.resolved_value ?? 0;
    expect(arrVal).toBeGreaterThanOrEqual(TRUE_ARR * 0.85);
    expect(arrVal).toBeLessThanOrEqual(TRUE_ARR * 1.15);
  });

  it("MRR resolves correctly from full noisy deck", () => {
    const mrrVal = truth["mrr"]!.resolved_value ?? 0;
    expect(mrrVal).toBeGreaterThanOrEqual(TRUE_MRR * 0.85);
    expect(mrrVal).toBeLessThanOrEqual(TRUE_MRR * 1.15);
  });

  it("burn_rate remains null (no burn keywords in any deck page)", () => {
    expect(truth["burn_rate"]!.resolved_value).toBeNull();
  });

  it("arr_mrr_mentions are present (deck has ARR/MRR mentions)", () => {
    expect(fullSignals.arr_mrr_mentions.length).toBeGreaterThan(0);
  });

  it("pricing_mentions are present (pricing page captured)", () => {
    expect(fullSignals.pricing_mentions.length).toBeGreaterThan(0);
  });

  it("unit_econ_mentions are present (LTV/CAC captured)", () => {
    expect(fullSignals.unit_econ_mentions.length).toBeGreaterThan(0);
  });
});
