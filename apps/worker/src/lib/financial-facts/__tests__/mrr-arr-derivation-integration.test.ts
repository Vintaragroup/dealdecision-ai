/**
 * mrr-arr-derivation-integration.test.ts
 *
 * Integration exercises for MRR → ARR derivation across the full production
 * code path:
 *
 *   buildFinancialFactRegistryV1
 *     → reconcileFinancialFactsV1 (Rule 5: structured MRR)
 *     → buildFinancialTruthV1 (post-loop: deck MRR fallback)
 *
 * Four cases are exercised using Webmaxco's deal_id as the candidate:
 *
 *   Case A — Structured MRR (xlsx saasKpis), no explicit ARR:
 *     Rule 5 derives ARR = MRR × 12.  FTRL resolves ARR as CONFIRMED
 *     via the derived structured_derived fact (strategy may be
 *     single_source or consensus_average depending on period count).
 *
 *   Case B — Deck MRR only, no explicit ARR:
 *     No structured MRR → Rule 5 does NOT fire.
 *     FTRL post-loop derives ARR from deck MRR.
 *     resolution_strategy = "derived_from_mrr", confidence low.
 *
 *   Case C — Deck MRR present, but explicit ARR also present:
 *     Post-loop guard `arrRecord.state === "INSUFFICIENT"` blocks.
 *     Explicit ARR wins.
 *
 *   Case D — Monthly pricing language in deck, no real MRR/ARR:
 *     Pricing mentions go to pricing_mentions, NOT arr_mrr_mentions.
 *     MRR = INSUFFICIENT.  ARR = INSUFFICIENT.  No contamination.
 *
 * Note: this test does NOT write to any DB or queue.  It is a pure
 * integration smoke test of the derivation pipeline.
 */

import { describe, it, expect } from "vitest";
import { buildFinancialFactRegistryV1 } from "../../build-financial-fact-registry-v1.js";
import { reconcileFinancialFactsV1 } from "../reconcile-financial-facts-v1.js";
import { buildFinancialTruthV1 } from "../build-financial-truth-v1.js";
import type { SaasKpisV1 } from "../../saas-kpis-parser-v1.js";
import type { DeckFinancialSignalsV1, DeckFinancialMention } from "../../deck-financial-signals-v1.js";

// ─── Fixture helpers ──────────────────────────────────────────────────────────

// Webmaxco's real deal_id — used as the candidate
const DEAL_ID = "23b2fa42-e6d1-4aa3-8fbc-f7aa083846e4";
const DOC_ID  = "58595eb2-2f09-4453-9240-4c6504eb499d";

function makeSaasKpis(overrides: Partial<SaasKpisV1>): SaasKpisV1 {
  return {
    schema_version: "saas_kpis_v1",
    source: { document_id: DOC_ID, page_ref: "Sheet=KPIs" },
    periods: ["FY2025"],
    diagnostics: {
      matched_rows: ["MRR"],
      parsed_cells: 1,
      parse_warnings: [],
    },
    ...overrides,
  };
}

function makeNullDeckSignals(): DeckFinancialSignalsV1 {
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
    pages_scanned: 10,
  };
}

function makeMention(text: string): DeckFinancialMention {
  return { text, doc_id: DOC_ID, page_index: 5 };
}

/**
 * Run the full 3-stage derivation pipeline and return the financial truth map.
 */
function runPipeline(opts: {
  saasKpis?: SaasKpisV1 | null;
  deckSignals?: DeckFinancialSignalsV1 | null;
}) {
  // Stage 1: Build fact registry from structured inputs
  const rawFacts = buildFinancialFactRegistryV1({
    dealId: DEAL_ID,
    saasKpis: opts.saasKpis ?? null,
    deckSignals: opts.deckSignals ?? makeNullDeckSignals(),
  });

  // Stage 2: Reconcile (derives structured ARR from MRR via Rule 5)
  const reconciledFacts = reconcileFinancialFactsV1(rawFacts, DEAL_ID);

  // Stage 3: Build financial truth (post-loop derives deck ARR from MRR)
  const truth = buildFinancialTruthV1({
    facts: reconciledFacts,
    deckFinancialSignals: opts.deckSignals ?? null,
    pipelineB: { revenue_latest: null, burn_monthly: null, runway_months: null, cash_latest: null },
  });

  return { rawFacts, reconciledFacts, truth };
}

// ─── Case A: Structured MRR (xlsx), no explicit ARR ──────────────────────────

describe("MRR→ARR integration — Case A: structured xlsx MRR, no explicit ARR", () => {
  const MRR_VALUE = 125_000;   // $125k MRR → ARR should be $1,500,000
  const PERIOD    = "FY2025";

  const kpis = makeSaasKpis({ mrr: { [PERIOD]: MRR_VALUE } }); // no arr
  const { rawFacts, reconciledFacts, truth } = runPipeline({ saasKpis: kpis });

  it("factory output contains MRR xlsx fact and derived ARR (Rule 5 is baked into buildFinancialFactRegistryV1)", () => {
    // buildFinancialFactRegistryV1 calls reconcileFinancialFactsV1 internally as
    // its final step, so Rule 5 has already fired.  rawFacts is post-reconciliation.
    const mrrFacts = rawFacts.filter((f) => f.metric_key === "mrr");
    const arrFacts = rawFacts.filter((f) => f.metric_key === "arr");
    expect(mrrFacts).toHaveLength(1);
    expect(mrrFacts[0].source_kind).toBe("xlsx");
    expect(mrrFacts[0].value).toBe(MRR_VALUE);
    // Rule 5 already produced the structured_derived ARR inside the factory
    expect(arrFacts).toHaveLength(1);
    expect(arrFacts[0].source_kind).toBe("structured_derived");
    expect(arrFacts[0].value).toBe(MRR_VALUE * 12);
  });

  it("reconcile Rule 5 derives an ARR fact = MRR × 12", () => {
    const derived = reconciledFacts.filter(
      (f) => f.metric_key === "arr" && f.source_kind === "structured_derived"
    );
    expect(derived).toHaveLength(1);
    expect(derived[0].value).toBe(MRR_VALUE * 12);
    expect(derived[0].derivation_rule).toBe("arr_from_mrr_times_12");
    expect(derived[0].is_derived).toBe(true);
    expect(derived[0].period_label).toBe(PERIOD);
    expect(derived[0].confidence).toBe("medium");
    expect(derived[0].semantic_family).toBe("revenue");
    expect(derived[0].semantic_role).toBe("derived");
  });

  it("FTRL reports ARR as CONFIRMED with resolved_value = MRR × 12", () => {
    const arr = truth["arr"]!;
    expect(arr.state).toBe("CONFIRMED");
    expect(arr.resolved_value).toBe(MRR_VALUE * 12);
  });

  it("FTRL ARR resolved_source_kind is structured_derived", () => {
    expect(truth["arr"]!.resolved_source_kind).toBe("structured_derived");
  });

  it("FTRL ARR does NOT use derived_from_mrr strategy (came through fact registry as structured_derived)", () => {
    // Rule 5 produces a structured_derived fact that enters the registry;
    // the FTRL post-loop only fires when ARR is still INSUFFICIENT.
    // Here the fact_registry source already gave us CONFIRMED, so post-loop is skipped.
    expect(truth["arr"]!.resolution_strategy).not.toBe("derived_from_mrr");
  });

  it("FTRL ARR has no disagreement (single derived source)", () => {
    expect(truth["arr"]!.disagreement).toBe(false);
  });

  it("MRR is still CONFIRMED at $125k deck is absent", () => {
    const mrr = truth["mrr"]!;
    expect(mrr.state).toBe("CONFIRMED");
    expect(mrr.resolved_value).toBe(MRR_VALUE);
  });
});

// ─── Case A2: Two MRR periods — both produce derived ARR ─────────────────────

describe("MRR→ARR integration — Case A2: two xlsx MRR periods, no explicit ARR", () => {
  const kpis = makeSaasKpis({
    mrr: { "FY2024": 100_000, "FY2025": 125_000 },
    periods: ["FY2024", "FY2025"],
  });
  const { reconciledFacts, truth } = runPipeline({ saasKpis: kpis });

  it("two distinct derived ARR facts are produced", () => {
    const derived = reconciledFacts.filter(
      (f) => f.metric_key === "arr" && f.derivation_rule === "arr_from_mrr_times_12"
    );
    expect(derived).toHaveLength(2);
    const vals = derived.map((f) => f.value).sort((a, b) => a - b);
    expect(vals).toEqual([1_200_000, 1_500_000]);
  });

  it("FTRL ARR is CONFIRMED (two close sources agree)", () => {
    expect(truth["arr"]!.state).toBe("CONFIRMED");
  });
});

// ─── Case B: Deck MRR only, no explicit ARR ───────────────────────────────────

describe("MRR→ARR integration — Case B: deck MRR only, no structured MRR, no explicit ARR", () => {
  const DECK_MRR = 381_000; // Qredible's deck MRR value as reference

  const deck: DeckFinancialSignalsV1 = {
    ...makeNullDeckSignals(),
    arr_mrr_mentions: [
      makeMention(`MRR is $${(DECK_MRR / 1000).toFixed(0)}K monthly recurring revenue`),
    ],
    has_arr_mrr: true,
  };

  const { rawFacts, reconciledFacts, truth } = runPipeline({ saasKpis: null, deckSignals: deck });

  it("no structured MRR facts exist (Rule 5 cannot fire)", () => {
    const structured = reconciledFacts.filter(
      (f) => f.metric_key === "mrr" && f.source_kind !== "deck"
    );
    expect(structured).toHaveLength(0);
  });

  it("no derived ARR in fact registry (Rule 5 blocked: deck source)", () => {
    const derived = reconciledFacts.filter(
      (f) => f.metric_key === "arr" && f.derivation_rule === "arr_from_mrr_times_12"
    );
    expect(derived).toHaveLength(0);
  });

  it("FTRL post-loop derives ARR from deck MRR", () => {
    const arr = truth["arr"]!;
    expect(arr.state).toBe("CONFIRMED");
    expect(arr.resolved_value).toBe(DECK_MRR * 12);
    expect(arr.resolution_strategy).toBe("derived_from_mrr");
  });

  it("FTRL derived ARR source_kind is deck (inherits MRR source bucket)", () => {
    expect(truth["arr"]!.resolved_source_kind).toBe("deck");
  });

  it("FTRL derived ARR confidence is low (deck MRR → low confidence)", () => {
    const sources = truth["arr"]!.sources;
    expect(sources.every((s) => s.confidence === "low")).toBe(true);
  });

  it("FTRL derived ARR origin is derived_from_mrr", () => {
    const sources = truth["arr"]!.sources;
    expect(sources.every((s) => s.origin === "derived_from_mrr")).toBe(true);
  });

  it("FTRL MRR is CONFIRMED from deck", () => {
    const mrr = truth["mrr"]!;
    expect(mrr.state).toBe("CONFIRMED");
    expect(mrr.resolved_value).toBe(DECK_MRR);
    expect(mrr.resolved_source_kind).toBe("deck");
  });
});

// ─── Case C: Explicit ARR wins over deck MRR derivation ──────────────────────

describe("MRR→ARR integration — Case C: deck MRR present but explicit ARR overrides", () => {
  const EXPLICIT_ARR = 2_000_000;
  const DECK_MRR     = 381_000; // deck-only MRR

  // Explicit ARR comes from saasKpis (xlsx)
  const kpis = makeSaasKpis({ arr: { FY2025: EXPLICIT_ARR } }); // no mrr in xlsx
  // Deck has MRR mention — this should NOT override the explicit ARR
  const deck: DeckFinancialSignalsV1 = {
    ...makeNullDeckSignals(),
    arr_mrr_mentions: [
      makeMention(`MRR is $${(DECK_MRR / 1000).toFixed(0)}K monthly recurring revenue`),
    ],
    has_arr_mrr: true,
  };

  const { truth } = runPipeline({ saasKpis: kpis, deckSignals: deck });

  it("explicit ARR value is preserved", () => {
    expect(truth["arr"]!.resolved_value).toBe(EXPLICIT_ARR);
  });

  it("ARR state is CONFIRMED", () => {
    expect(truth["arr"]!.state).toBe("CONFIRMED");
  });

  it("ARR resolution_strategy is NOT derived_from_mrr", () => {
    expect(truth["arr"]!.resolution_strategy).not.toBe("derived_from_mrr");
  });

  it("resolved_source_kind is xlsx (not deck)", () => {
    expect(truth["arr"]!.resolved_source_kind).toBe("xlsx");
  });
});

// ─── Case C2: Structured MRR + explicit ARR same period — explicit wins ───────

describe("MRR→ARR integration — Case C2: structured MRR + explicit ARR same period", () => {
  const EXPLICIT_ARR = 3_000_000;
  const kpis = makeSaasKpis({
    mrr: { FY2025: 200_000 },
    arr: { FY2025: EXPLICIT_ARR },
  });

  const { reconciledFacts, truth } = runPipeline({ saasKpis: kpis });

  it("Rule 5 does NOT produce a derived ARR for FY2025 (explicit ARR exists)", () => {
    const derived = reconciledFacts.filter(
      (f) => f.metric_key === "arr" && f.derivation_rule === "arr_from_mrr_times_12"
    );
    expect(derived).toHaveLength(0);
  });

  it("explicit ARR value is preserved in FTRL", () => {
    expect(truth["arr"]!.resolved_value).toBe(EXPLICIT_ARR);
  });
});

// ─── Case D: Monthly pricing language — no ARR contamination ─────────────────

describe("MRR→ARR integration — Case D: pricing-only monthly language, no real MRR/ARR", () => {
  // Pricing-tier text that contains dollar amounts and 'per month' — should
  // NOT produce MRR because the REVENUE_RE pattern in deck-financial-signals
  // and getDeckValue MRR filter (\bMRR\b | monthly\s+recurring) are exclusive.
  const deck: DeckFinancialSignalsV1 = {
    ...makeNullDeckSignals(),
    // Pricing mentions capture this, NOT arr_mrr_mentions
    pricing_mentions: [
      makeMention("Pro plan: $29/month per seat"),
      makeMention("Enterprise: $199/month, billed annually"),
    ],
    // arr_mrr_mentions is EMPTY — pricing language does not trigger ARR_MRR_RE
    arr_mrr_mentions: [],
    has_pricing: true,
    has_arr_mrr: false,
  };

  const { truth } = runPipeline({ saasKpis: null, deckSignals: deck });

  it("MRR is INSUFFICIENT — pricing text does not produce MRR", () => {
    expect(truth["mrr"]!.state).toBe("INSUFFICIENT");
    expect(truth["mrr"]!.resolved_value).toBeNull();
  });

  it("ARR is INSUFFICIENT — no MRR means no derivation", () => {
    expect(truth["arr"]!.state).toBe("INSUFFICIENT");
    expect(truth["arr"]!.resolved_value).toBeNull();
  });

  it("ARR resolution_strategy is null — no derivation ran", () => {
    expect(truth["arr"]!.resolution_strategy).toBeNull();
  });
});

// ─── Case D2: Pricing text INSIDE arr_mrr_mentions — getDeckValue blocks it ───

describe("MRR→ARR integration — Case D2: per-seat price in arr_mrr_mentions rejected by getDeckValue filter", () => {
  // If somehow pricing text ends up in arr_mrr_mentions (shouldn't happen, but
  // defensive check), getDeckValue('mrr') filters on /\bMRR\b|monthly\s+recurring/i.
  // "$29/month per seat" does NOT match that pattern → getDeckValue returns null.
  const deck: DeckFinancialSignalsV1 = {
    ...makeNullDeckSignals(),
    arr_mrr_mentions: [
      makeMention("Pro plan costs $29/month per seat"),
    ],
    has_arr_mrr: true,
  };

  const { truth } = runPipeline({ saasKpis: null, deckSignals: deck });

  it("MRR is INSUFFICIENT — per-seat price ignored by getDeckValue MRR filter", () => {
    expect(truth["mrr"]!.state).toBe("INSUFFICIENT");
  });

  it("ARR is INSUFFICIENT — no derivation from pricing-tier text", () => {
    expect(truth["arr"]!.state).toBe("INSUFFICIENT");
  });
});
