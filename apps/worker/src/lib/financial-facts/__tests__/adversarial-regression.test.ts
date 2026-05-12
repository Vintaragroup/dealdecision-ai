/**
 * adversarial-regression.test.ts
 *
 * Adversarial regression tests organized by bug class (Fixes 6–17).
 * Each describe block maps to one root failure mode.
 *
 * Bug classes in this file:
 *   BC-1  Pricing value misread as burn_rate           (Fix 6 $250, Fix 7 $349)
 *   BC-2  Aspirational ARR beats structured traction   (Fix 14, Qredible OB-4/5)
 *
 * Already covered in existing test files:
 *   BC-3  Duplicate zero vs non-zero (Fix 17 OB-3)
 *         → apps/worker/src/jobs/investor-insights/__tests__/workbook-fact-dedup.test.ts
 *            (11 baseline tests + adversarial edge cases added in that same file)
 *   BC-4  Cap-table / col_X / salary row → revenue (Fix 12, Fix 13)
 *         → apps/worker/src/extraction/xlsx/__tests__/financial-model-interpreter.test.ts
 *            (cap_table sheet suppression, col_X period-label drop, payroll G5, year-label G1)
 *   BC-5  Projected Year N contaminates current_state (Fix 15)
 *         → apps/worker/src/lib/financial-facts/__tests__/phase2-projected-scope.test.ts
 *            (Tests 1–8: explicit projected, unknown-scope future-year, same-doc mix)
 *   BC-6  Proforma-only XLSX → projected_only_dataset (Fix 15b)
 *         → phase2-projected-scope.test.ts Tests 4–5 (projected_only_dataset=true)
 */

import { describe, it, expect } from "vitest";
import { extractDeckFinancialSignalsV1 } from "../../deck-financial-signals-v1.js";
import type { DeckSignalPage } from "../../deck-financial-signals-v1.js";
import { buildFinancialTruthV1 } from "../build-financial-truth-v1.js";
import type { FinancialFactV1, FinancialFactSourceKind } from "@dealdecision/core";
import type { TemporalScope } from "@dealdecision/core";

// ─── Shared helpers ───────────────────────────────────────────────────────────

function page(text: string, page_index = 0): DeckSignalPage {
  return { document_id: "doc-adv-test", page_index, text };
}

let _seq = 0;
function makeArrFact(opts: {
  fact_id?: string;
  source_kind?: FinancialFactSourceKind;
  value: number;
  period_label?: string;
  temporal_scope?: TemporalScope;
  document_id?: string;
}): FinancialFactV1 {
  _seq++;
  return {
    fact_id: opts.fact_id ?? `adv-arr-${_seq}`,
    deal_id: "adv-deal",
    document_id: opts.document_id ?? "doc-adv-0001",
    source_kind: opts.source_kind ?? "xlsx",
    metric_key: "arr",
    metric_label: "ARR",
    period_type: "annual",
    period_label: opts.period_label ?? "FY2024",
    value: opts.value,
    unit: "currency",
    currency: "USD",
    confidence: "high",
    source_pointer: `adv-test period=${opts.period_label ?? "FY2024"} value=${opts.value}`,
    excerpt: `ARR ${opts.period_label ?? "FY2024"}: ${opts.value}`,
    temporal_scope: opts.temporal_scope ?? "historical",
  };
}

// Minimal NULL_DECK with ARR slot empty (for tests that supply ARR via facts)
const NULL_DECK_BASE = {
  schema_version: "deck_financial_signals_v1" as const,
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

const NULL_PB = {
  revenue_latest: null,
  burn_monthly: null,
  runway_months: null,
  cash_latest: null,
};

// ═══════════════════════════════════════════════════════════════════════════════
// BC-1: Pricing value misread as burn_rate (Fix 6 / Fix 7)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Fix 6 (StackFactor): "$250/user/month" pricing slide text was being captured
 * as a burn_rate mention.  The root cause was that BURN_RE fired on "per month"
 * phrasing before PRICING_SIGNAL_RE could filter it out.
 *
 * Fix 7 (Qredible): same class — "$349/month per-agent pricing".
 *
 * Both variants must produce burn_mentions=[] at extraction time.
 */
describe("BC-1: Pricing value misread as burn_rate — extraction guard (Fix 6 $250)", () => {
  const PRICING_TEXT = "Subscription tiers: $250/user/month — scales to enterprise.";

  const result = extractDeckFinancialSignalsV1([page(PRICING_TEXT)])!;

  it("burn_mentions is empty when text is per-user pricing language", () => {
    expect(result.burn_mentions).toHaveLength(0);
  });

  it("has_burn is false for per-user pricing text", () => {
    expect(result.has_burn).toBe(false);
  });

  it("$250/user/month appears in pricing_mentions (correctly categorised)", () => {
    expect(result.pricing_mentions.length).toBeGreaterThan(0);
    const texts = result.pricing_mentions.map((m) => m.text);
    expect(texts.some((t) => t.includes("250"))).toBe(true);
  });

  it("has_pricing is true", () => {
    expect(result.has_pricing).toBe(true);
  });
});

describe("BC-1: Pricing value misread as burn_rate — extraction guard (Fix 6 variant: per-seat)", () => {
  const PRICING_TEXT = "Enterprise plan: $250 per seat per month. Volume discounts available.";

  const result = extractDeckFinancialSignalsV1([page(PRICING_TEXT)])!;

  it("burn_mentions is empty for per-seat per-month pricing", () => {
    expect(result.burn_mentions).toHaveLength(0);
  });

  it("has_burn is false", () => {
    expect(result.has_burn).toBe(false);
  });
});

describe("BC-1: Pricing value misread as burn_rate — deck context with both pricing AND burn", () => {
  /**
   * Adversarial: same deck has a real burn figure ($120K/month) on one slide and
   * per-user pricing ($250/user/month) on another.  The burn mention must survive
   * while the pricing mention is correctly classified.
   */
  const result = extractDeckFinancialSignalsV1([
    page("Current monthly burn rate: $120,000.", 1),
    page("Product pricing: $250/user/month — 30-day free trial.", 2),
  ])!;

  it("burn_mentions contains the real burn figure ($120K)", () => {
    const texts = result.burn_mentions.map((m) => m.text);
    expect(texts.some((t) => t.includes("120,000") || t.includes("120K"))).toBe(true);
  });

  it("burn_mentions does NOT contain the pricing value ($250)", () => {
    const texts = result.burn_mentions.map((m) => m.text);
    expect(texts.some((t) => t.includes("250") && t.includes("user"))).toBe(false);
  });

  it("pricing_mentions contains the $250/user/month entry", () => {
    const texts = result.pricing_mentions.map((m) => m.text);
    expect(texts.some((t) => t.includes("250"))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// BC-2: Aspirational ARR beats structured traction ARR (Fix 14 / Qredible OB-4/5)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Root cause: buildFinancialTruthV1 resolved ARR from the deck mention ($6M)
 * because a structured kpi_tile fact ($1,582,164) was present but trust
 * arbitration hadn't been applied — the larger deck value "won" numerically.
 *
 * Fix: SOURCE_PRIORITY: xlsx > structured_derived > deck > unknown.
 * When a kpi_tile (structured_derived) and a deck mention disagree, the
 * kpi_tile value wins and state=CONFLICT is raised.
 */

/**
 * kpi_tile ARR $1,582,164 vs deck $6M aspirational claim.
 * Structured source must win.
 */
describe("BC-2: Aspirational deck ARR vs structured kpi_tile ARR — kpi_tile wins", () => {
  const STRUCTURED_ARR = 1_582_164;   // traction (kpi_tile from financial model)
  const ASPIRATIONAL_ARR = 6_000_000; // deck slide: "We are at $6M+ ARR"

  const deckSignals = {
    ...NULL_DECK_BASE,
    arr_mrr_mentions: [
      { text: "We are at $6M+ ARR with strong retention.", doc_id: "deck-doc", page_index: 3 },
    ],
    has_arr_mrr: true,
  };

  const facts: FinancialFactV1[] = [
    makeArrFact({ source_kind: "kpi_tile", value: STRUCTURED_ARR, period_label: "FY2024", temporal_scope: "historical" }),
  ];

  const truth = buildFinancialTruthV1({
    facts,
    deckFinancialSignals: deckSignals,
    pipelineB: NULL_PB,
  });

  it("state is CONFLICT (structured vs deck disagree)", () => {
    expect(truth["arr"]!.state).toBe("CONFLICT");
  });

  it("resolved_value is the structured traction ARR, NOT the aspirational deck figure", () => {
    expect(truth["arr"]!.resolved_value).toBe(STRUCTURED_ARR);
    expect(truth["arr"]!.resolved_value).not.toBe(ASPIRATIONAL_ARR);
  });

  it("resolved_source_kind is structured_derived (kpi_tile bucket)", () => {
    expect(truth["arr"]!.resolved_source_kind).toBe("structured_derived");
  });

  it("has_deck_source is true (deck mention present in sources)", () => {
    expect(truth["arr"]!.has_deck_source).toBe(true);
  });
});

/**
 * xlsx ARR $1,582,164 vs deck $6M aspirational claim.
 * xlsx is even higher priority than kpi_tile — must also win.
 */
describe("BC-2: Aspirational deck ARR vs XLSX ARR — xlsx wins (highest priority)", () => {
  const XLSX_ARR    = 1_582_164;
  const DECK_ARR    = 6_000_000;

  const deckSignals = {
    ...NULL_DECK_BASE,
    arr_mrr_mentions: [
      { text: "Total ARR $6M as of Q4.", doc_id: "deck-doc", page_index: 5 },
    ],
    has_arr_mrr: true,
  };

  const facts: FinancialFactV1[] = [
    makeArrFact({ source_kind: "xlsx", value: XLSX_ARR, period_label: "FY2024", temporal_scope: "historical" }),
  ];

  const truth = buildFinancialTruthV1({
    facts,
    deckFinancialSignals: deckSignals,
    pipelineB: NULL_PB,
  });

  it("state is CONFLICT (xlsx vs deck disagree)", () => {
    expect(truth["arr"]!.state).toBe("CONFLICT");
  });

  it("resolved_value is the XLSX ARR, NOT the aspirational deck value", () => {
    expect(truth["arr"]!.resolved_value).toBe(XLSX_ARR);
    expect(truth["arr"]!.resolved_value).not.toBe(DECK_ARR);
  });

  it("resolved_source_kind is xlsx", () => {
    expect(truth["arr"]!.resolved_source_kind).toBe("xlsx");
  });

  it("has_xlsx_source is true", () => {
    expect(truth["arr"]!.has_xlsx_source).toBe(true);
  });
});

/**
 * Deck-only ARR ($6M) with no structured source.
 * Deck mention is the only signal — should resolve but be flagged deck-sourced.
 * Ensures the fix does NOT silently drop deck ARR when it's the sole source.
 */
describe("BC-2: Deck-only ARR — resolves when no structured source exists", () => {
  const DECK_ONLY_ARR = 6_000_000;

  const deckSignals = {
    ...NULL_DECK_BASE,
    arr_mrr_mentions: [
      { text: "We are at $6M+ ARR with strong retention.", doc_id: "deck-doc", page_index: 3 },
    ],
    has_arr_mrr: true,
  };

  const truth = buildFinancialTruthV1({
    facts: [],
    deckFinancialSignals: deckSignals,
    pipelineB: NULL_PB,
  });

  it("state is CONFIRMED when deck is the sole ARR source", () => {
    expect(truth["arr"]!.state).toBe("CONFIRMED");
  });

  it("resolved_value is the deck ARR value", () => {
    expect(truth["arr"]!.resolved_value).toBe(DECK_ONLY_ARR);
  });

  it("resolved_source_kind is deck", () => {
    expect(truth["arr"]!.resolved_source_kind).toBe("deck");
  });

  it("has_deck_source is true", () => {
    expect(truth["arr"]!.has_deck_source).toBe(true);
  });

  it("has_xlsx_source is false", () => {
    expect(truth["arr"]!.has_xlsx_source).toBe(false);
  });
});

/**
 * Two structured ARR facts from different sources both above deck value.
 * Multiple structured facts agree → CONFIRMED at the structured value,
 * deck mention does not distort the average.
 */
describe("BC-2: Two structured ARR facts + deck aspirational — structured consensus wins", () => {
  const XLSX_ARR    = 1_582_164;
  const KPI_ARR     = 1_600_000;   // close agreement with xlsx
  const DECK_ARR    = 6_000_000;   // far outlier

  const deckSignals = {
    ...NULL_DECK_BASE,
    arr_mrr_mentions: [
      { text: "Total ARR $6M", doc_id: "deck-doc", page_index: 2 },
    ],
    has_arr_mrr: true,
  };

  const facts: FinancialFactV1[] = [
    makeArrFact({ source_kind: "xlsx",     value: XLSX_ARR, period_label: "FY2024", temporal_scope: "historical", document_id: "doc-model" }),
    makeArrFact({ source_kind: "kpi_tile", value: KPI_ARR,  period_label: "FY2024", temporal_scope: "historical", document_id: "doc-kpi" }),
  ];

  const truth = buildFinancialTruthV1({
    facts,
    deckFinancialSignals: deckSignals,
    pipelineB: NULL_PB,
  });

  it("state is CONFLICT (structured sources vs deck disagree)", () => {
    // xlsx and kpi_tile agree closely, but deck $6M creates conflict
    expect(truth["arr"]!.state).toBe("CONFLICT");
  });

  it("resolved_value is NOT the deck aspirational ARR ($6M)", () => {
    expect(truth["arr"]!.resolved_value).not.toBe(DECK_ARR);
  });

  it("resolved_source_kind is xlsx (highest bucket wins between xlsx and kpi_tile)", () => {
    // xlsx is ranked above structured_derived — xlsx bucket wins
    expect(truth["arr"]!.resolved_source_kind).toBe("xlsx");
  });
});
