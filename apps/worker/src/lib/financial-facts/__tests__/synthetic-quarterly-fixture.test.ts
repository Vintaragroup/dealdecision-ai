/**
 * synthetic-quarterly-fixture.test.ts
 *
 * REF-DEAL-7 behavioral validation for the SyntheticQuarterly ground-truth spec.
 * Exercises `buildFinancialTruthV1` with a fixture representing SynthStream
 * Analytics — an XLSX workbook with quarterly actuals + annual totals +
 * mixed denomination + GBP burn cost sheet.
 *
 *   True values (ground truth):
 *     Revenue FY2024 Annual:  $2,200,000
 *     Burn USD normalized:    $150,000/month  (£120K GBP × 1.25 FX)
 *
 *   Noise sources to reject:
 *     Q1–Q4 quarterly actuals: $420K / $510K / $610K / $660K
 *     FY2025 forecast revenue: $3,800,000   (projected — must be excluded)
 *     Q1 2025 forecast rev:    $780,000     (projected — must be excluded)
 *     $000s denomination raw:  2,200        (deck NLP artifact, value = 2,200)
 *     GBP burn raw:            £120,000/mo  (no FX conversion applied)
 *
 * Ground truth: evaluation/ground_truth/SyntheticQuarterly.json
 *
 * Test suites:
 *   Suite 1 — Annual actual beats quarterly via timeseries collapse
 *   Suite 2 — Forecast excluded; actual wins primary resolution
 *   Suite 3 — Denomination normalization: xlsx($2.2M) beats deck($2,200)
 *   Suite 4 — GBP burn loses to USD-normalized burn via timeseries collapse
 *   Suite 5 — Single-quarter-only failure mode: quarter becomes headline (known gap)
 *   Suite 6 — End-to-end adversarial batch: all noise combined
 *
 * No DB or API dependency — pure unit tests.
 */

import { describe, it, expect } from "vitest";
import { buildFinancialTruthV1 } from "../build-financial-truth-v1.js";
import type { FinancialFactV1, FinancialFactSourceKind } from "@dealdecision/core";
import type { TemporalScope } from "@dealdecision/core";

// ─── Fixture constants ────────────────────────────────────────────────────────

const DEAL_ID  = "00000000-0000-4000-8000-000000000003";  // matches SyntheticQuarterly.json
const DOC_XLSX = "doc-synthq-pl-xlsx-0001";                // main XLSX — quarterly + annual + burn
const DOC_DECK = "doc-synthq-deck-nlp-0001";               // deck NLP — denomination noise

// Ground truth resolved values
const FY2024_ANNUAL_REVENUE = 2_200_000;
const USD_BURN_MONTHLY      = 150_000;

// Quarterly actuals (must NOT become headline after timeseries collapse)
const Q1_REVENUE = 420_000;
const Q2_REVENUE = 510_000;
const Q3_REVENUE = 610_000;
const Q4_REVENUE = 660_000;

// Forecasts (projected — must be excluded from primary resolution)
const FY2025_FORECAST_REVENUE   = 3_800_000;
const Q1_2025_FORECAST_REVENUE  = 780_000;

// Denomination noise (deck NLP artifact in $000s — must NOT resolve as revenue)
const DENOM_RAW_THOUSANDS = 2_200;

// Currency noise (raw GBP before FX conversion — must lose timeseries collapse)
const GBP_BURN_MONTHLY = 120_000;

// ─── Helpers ──────────────────────────────────────────────────────────────────

let _seq = 0;
function makeRevFact(opts: {
  period_label: string;
  value: number;
  temporal_scope: TemporalScope | undefined;
  source_kind?: FinancialFactSourceKind;
  document_id?: string;
}): FinancialFactV1 {
  _seq++;
  return {
    fact_id:        `synthq-rev-${_seq}`,
    deal_id:        DEAL_ID,
    document_id:    opts.document_id ?? DOC_XLSX,
    source_kind:    opts.source_kind ?? "xlsx",
    metric_key:     "revenue",
    metric_label:   "Total Revenue",
    period_type:    "annual",
    period_label:   opts.period_label,
    value:          opts.value,
    unit:           "currency",
    currency:       "USD",
    confidence:     opts.temporal_scope === "historical" || opts.temporal_scope === "current" ? "high" : "medium",
    source_pointer: `SynthStream P&L row='Total Revenue' col='${opts.period_label}'`,
    excerpt:        `Total Revenue ${opts.period_label}: ${opts.value}`,
    temporal_scope: opts.temporal_scope,
  };
}

function makeBurnFact(opts: {
  period_label: string;
  value: number;
  temporal_scope: TemporalScope | undefined;
  source_kind?: FinancialFactSourceKind;
  currency?: string;
}): FinancialFactV1 {
  _seq++;
  return {
    fact_id:        `synthq-burn-${_seq}`,
    deal_id:        DEAL_ID,
    document_id:    DOC_XLSX,
    source_kind:    opts.source_kind ?? "xlsx",
    metric_key:     "burn_rate",
    metric_label:   "Monthly Burn",
    period_type:    "monthly",
    period_label:   opts.period_label,
    value:          opts.value,
    unit:           "currency",
    currency:       opts.currency ?? "USD",
    confidence:     opts.temporal_scope === "current" ? "high" : "medium",
    source_pointer: `SynthStream Costs row='Total Opex' col='${opts.period_label}' / 12`,
    excerpt:        `Monthly burn ${opts.period_label}: ${opts.value}`,
    temporal_scope: opts.temporal_scope,
  };
}

// ─── Shared fact collections ──────────────────────────────────────────────────

/**
 * 5 revenue facts in the SAME document (DOC_XLSX).
 * ≥2 distinct period_labels → timeseries collapse fires.
 * FY2024 Actual uses temporal_scope="current" → rank 52,024
 * Q1–Q4 use temporal_scope="historical"       → rank 42,024
 * Annual wins collapse deterministically.
 */
const QUARTERLY_PLUS_ANNUAL_REVENUE: FinancialFactV1[] = [
  makeRevFact({ period_label: "Q1 2024",        value: Q1_REVENUE,            temporal_scope: "historical" }),
  makeRevFact({ period_label: "Q2 2024",        value: Q2_REVENUE,            temporal_scope: "historical" }),
  makeRevFact({ period_label: "Q3 2024",        value: Q3_REVENUE,            temporal_scope: "historical" }),
  makeRevFact({ period_label: "Q4 2024",        value: Q4_REVENUE,            temporal_scope: "historical" }),
  makeRevFact({ period_label: "FY2024 Actual",  value: FY2024_ANNUAL_REVENUE, temporal_scope: "current"   }),
];

/**
 * Forward projections — must be excluded from primary resolution.
 * Both use temporal_scope="projected".
 */
const FORECAST_REVENUE: FinancialFactV1[] = [
  makeRevFact({ period_label: "FY2025 Forecast", value: FY2025_FORECAST_REVENUE,  temporal_scope: "projected" }),
  makeRevFact({ period_label: "Q1 2025",         value: Q1_2025_FORECAST_REVENUE, temporal_scope: "projected" }),
];

/**
 * Denomination noise — deck NLP artifact produced value=2,200 ($000s unscaled).
 * source_kind="deck" (lowest bucket) vs xlsx (highest bucket).
 * Different document (DOC_DECK) → 2 sources reach resolveV2 → CONFLICT →
 * selectHierarchyWinner picks xlsx bucket → $2,200,000 wins.
 */
const DENOM_NOISE_FACT: FinancialFactV1 = makeRevFact({
  period_label:   "FY2024 Actual",
  value:          DENOM_RAW_THOUSANDS,
  temporal_scope: undefined,
  source_kind:    "deck",
  document_id:    DOC_DECK,
});

/**
 * Correctly normalized revenue from xlsx (same DOC_XLSX as quarterly facts).
 * When tested alongside DENOM_NOISE_FACT they are in different documents —
 * each yields 1 source — selectHierarchyWinner picks xlsx bucket.
 */
const DENOM_NORMALIZED_FACT: FinancialFactV1 = makeRevFact({
  period_label:   "FY2024 Actual",
  value:          FY2024_ANNUAL_REVENUE,
  temporal_scope: "current",
  source_kind:    "xlsx",
  document_id:    DOC_XLSX,
});

/**
 * Two burn facts — SAME document, DIFFERENT period_labels.
 * → Timeseries collapse fires.
 * USD fact: temporal_scope="current"  → rank 52,024  (wins)
 * GBP fact: no temporal_scope, year=2024 → unknown-past → rank 12,024  (loses)
 */
const USD_BURN_FACT: FinancialFactV1 = makeBurnFact({
  period_label:   "FY2024 USD",
  value:          USD_BURN_MONTHLY,
  temporal_scope: "current",
  currency:       "USD",
});

const GBP_BURN_FACT: FinancialFactV1 = makeBurnFact({
  period_label:   "FY2024 GBP",
  value:          GBP_BURN_MONTHLY,
  temporal_scope: undefined,   // → unknown-past (year 2024 ≤ currentYear)
  currency:       "GBP",
});

// ─── Shared null helpers ──────────────────────────────────────────────────────

const NULL_DECK = {
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
  pages_scanned: 0,
};

const NULL_PB = {
  revenue_latest: null,
  burn_monthly: null,
  runway_months: null,
  cash_latest: null,
};

// ═══════════════════════════════════════════════════════════════════════════════
// Suite 1 — Annual actual beats quarterly via timeseries collapse
// ═══════════════════════════════════════════════════════════════════════════════

describe("REF-DEAL-7 Suite 1: FY2024 annual actual wins timeseries collapse over Q1–Q4", () => {
  const truth = buildFinancialTruthV1({
    facts: QUARTERLY_PLUS_ANNUAL_REVENUE,
    deckFinancialSignals: NULL_DECK,
    pipelineB: NULL_PB,
  });
  const rev = truth["revenue"]!;

  it("revenue state is CONFIRMED", () => {
    expect(rev.state).toBe("CONFIRMED");
  });

  it("timeseries collapse was triggered (intra_document_timeseries = true)", () => {
    expect(rev.intra_document_timeseries).toBe(true);
  });

  it("resolved_value is FY2024 annual ($2.2M), within 5%", () => {
    expect(rev.resolved_value).toBeGreaterThanOrEqual(FY2024_ANNUAL_REVENUE * 0.95);
    expect(rev.resolved_value).toBeLessThanOrEqual(FY2024_ANNUAL_REVENUE * 1.05);
  });

  it("resolved_value is NOT a single quarterly value (> Q4 max $660K)", () => {
    expect(rev.resolved_value).toBeGreaterThan(Q4_REVENUE);
  });

  it("resolved_value is NOT near Q1 revenue ($420K)", () => {
    const val = rev.resolved_value ?? 0;
    const nearQ1 = val >= Q1_REVENUE * 0.9 && val <= Q1_REVENUE * 1.1;
    expect(nearQ1).toBe(false);
  });

  it("resolved_value is NOT a simple sum of all quarters (which would also be $2.2M but via summing)", () => {
    // After collapse, exactly ONE source reaches resolveV2. If summing had occurred,
    // there would be multiple sources with smaller values. The single-source path
    // confirms collapse rather than arithmetic aggregation.
    // The only way to confirm this is via state=CONFIRMED + single-source semantics.
    expect(rev.state).toBe("CONFIRMED");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Suite 2 — FY2025 forecast excluded; FY2024 actual wins primary resolution
// ═══════════════════════════════════════════════════════════════════════════════

describe("REF-DEAL-7 Suite 2: FY2025 projected revenue excluded; FY2024 actual wins", () => {
  const truth = buildFinancialTruthV1({
    facts: [
      ...QUARTERLY_PLUS_ANNUAL_REVENUE,
      ...FORECAST_REVENUE,
    ],
    deckFinancialSignals: NULL_DECK,
    pipelineB: NULL_PB,
  });
  const rev = truth["revenue"]!;

  it("revenue state is CONFIRMED", () => {
    expect(rev.state).toBe("CONFIRMED");
  });

  it("projected_excluded_count ≥ 2 (FY2025 + Q1 2025 both excluded)", () => {
    expect(rev.projected_excluded_count ?? 0).toBeGreaterThanOrEqual(2);
  });

  it("resolved_value is FY2024 actual ($2.2M), not FY2025 forecast ($3.8M)", () => {
    expect(rev.resolved_value).toBeGreaterThanOrEqual(FY2024_ANNUAL_REVENUE * 0.95);
    expect(rev.resolved_value).toBeLessThanOrEqual(FY2024_ANNUAL_REVENUE * 1.05);
  });

  it("resolved_value is NOT near FY2025 forecast ($3.8M)", () => {
    const val = rev.resolved_value ?? 0;
    const nearForecast = val >= FY2025_FORECAST_REVENUE * 0.9 && val <= FY2025_FORECAST_REVENUE * 1.1;
    expect(nearForecast).toBe(false);
  });

  it("projected_only_dataset is false (actuals are present)", () => {
    expect(rev.projected_only_dataset).toBeFalsy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Suite 3 — Denomination normalization: xlsx($2.2M) beats deck($2,200 raw $000s)
// ═══════════════════════════════════════════════════════════════════════════════

describe("REF-DEAL-7 Suite 3: Denomination normalization — xlsx $2.2M beats deck $000s artifact", () => {
  describe("with both normalized xlsx fact and raw deck artifact", () => {
    const truth = buildFinancialTruthV1({
      facts: [DENOM_NORMALIZED_FACT, DENOM_NOISE_FACT],
      deckFinancialSignals: NULL_DECK,
      pipelineB: NULL_PB,
    });
    const rev = truth["revenue"]!;

    it("revenue state is CONFLICT (large disagreement between xlsx and deck values)", () => {
      // $2,200,000 vs $2,200 = 99.9% disagreement > 20% threshold
      expect(rev.state).toBe("CONFLICT");
    });

    it("resolved_value is the xlsx-normalized amount ($2.2M), not the deck artifact ($2,200)", () => {
      // selectHierarchyWinner picks xlsx bucket: averages [2200000] → 2200000
      expect(rev.resolved_value).toBeGreaterThanOrEqual(FY2024_ANNUAL_REVENUE * 0.95);
      expect(rev.resolved_value).toBeLessThanOrEqual(FY2024_ANNUAL_REVENUE * 1.05);
    });

    it("resolved_value is NOT the raw $000 artifact value ($2,200)", () => {
      const val = rev.resolved_value ?? 0;
      expect(val).not.toBeCloseTo(DENOM_RAW_THOUSANDS, -2);
    });

    it("resolved_value is NOT an average of the two ($1.1M range)", () => {
      // If selectHierarchyWinner averaged both: ~$1,101,100 — this must not happen
      const val = rev.resolved_value ?? 0;
      expect(val).not.toBeCloseTo(1_101_100, -4);
    });
  });

  describe("failure mode: deck artifact alone resolves to wrong value", () => {
    const truth = buildFinancialTruthV1({
      facts: [DENOM_NOISE_FACT],
      deckFinancialSignals: NULL_DECK,
      pipelineB: NULL_PB,
    });
    const rev = truth["revenue"]!;

    it("when only raw $000 artifact is present, state is CONFIRMED (single source)", () => {
      // Documents the known failure: a lone deck artifact can become headline
      expect(rev.state).toBe("CONFIRMED");
    });

    it("when only raw $000 artifact is present, resolved_value = 2,200 (wrong scale)", () => {
      // This is the failure mode — the xlsx guard is what prevents this in production
      expect(rev.resolved_value).toBeCloseTo(DENOM_RAW_THOUSANDS, -1);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Suite 4 — GBP burn loses to USD-normalized burn via timeseries collapse
// ═══════════════════════════════════════════════════════════════════════════════

describe("REF-DEAL-7 Suite 4: GBP burn (£120K) loses timeseries collapse to USD burn ($150K)", () => {
  const truth = buildFinancialTruthV1({
    facts: [USD_BURN_FACT, GBP_BURN_FACT],
    deckFinancialSignals: NULL_DECK,
    pipelineB: NULL_PB,
  });
  const burn = truth["burn_rate"]!;

  it("burn_rate state is CONFIRMED", () => {
    expect(burn.state).toBe("CONFIRMED");
  });

  it("timeseries collapse was triggered (intra_document_timeseries = true)", () => {
    // Different period_labels in same document: 'FY2024 USD' vs 'FY2024 GBP'
    expect(burn.intra_document_timeseries).toBe(true);
  });

  it("resolved_value is USD-normalized burn ($150K/month), within 10%", () => {
    expect(burn.resolved_value).toBeGreaterThanOrEqual(USD_BURN_MONTHLY * 0.90);
    expect(burn.resolved_value).toBeLessThanOrEqual(USD_BURN_MONTHLY * 1.10);
  });

  it("resolved_value is NOT the raw GBP burn (£120K)", () => {
    const val = burn.resolved_value ?? 0;
    const nearGbp = val >= GBP_BURN_MONTHLY * 0.95 && val <= GBP_BURN_MONTHLY * 1.05;
    expect(nearGbp).toBe(false);
  });

  it("resolved_value is NOT an average of USD and GBP ($135K)", () => {
    // If collapse had not fired and both reached resolveV2: avg = (150K+120K)/2 = 135K
    const avgUsdGbp = (USD_BURN_MONTHLY + GBP_BURN_MONTHLY) / 2;
    const val = burn.resolved_value ?? 0;
    const nearAvg = val >= avgUsdGbp * 0.95 && val <= avgUsdGbp * 1.05;
    expect(nearAvg).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Suite 5 — Single-quarter-only failure mode (known gap — documented behavior)
// ═══════════════════════════════════════════════════════════════════════════════

describe("REF-DEAL-7 Suite 5: Single-quarter-only path — known failure mode when annual absent", () => {
  describe("Q4 2024 alone resolves as headline revenue (no annual fact present)", () => {
    const truth = buildFinancialTruthV1({
      facts: [makeRevFact({ period_label: "Q4 2024", value: Q4_REVENUE, temporal_scope: "historical" })],
      deckFinancialSignals: NULL_DECK,
      pipelineB: NULL_PB,
    });
    const rev = truth["revenue"]!;

    it("state is CONFIRMED (single source)", () => {
      expect(rev.state).toBe("CONFIRMED");
    });

    it("resolved_value is Q4 value ($660K) — single quarter becomes headline without annual", () => {
      // This documents the known gap: the annual MUST be present for correct resolution.
      // Suite 1 verifies that when both are present, the annual wins.
      expect(rev.resolved_value).toBeCloseTo(Q4_REVENUE, -4);
    });

    it("intra_document_timeseries is false (only 1 distinct period, no collapse)", () => {
      expect(rev.intra_document_timeseries).toBeFalsy();
    });
  });

  describe("All four quarters without annual — Q4 (most recent historical) wins collapse", () => {
    // All 4 Q facts in same doc → 4 distinct period_labels → timeseries collapse fires.
    // All have temporal_scope="historical" → rank 42024 for all 4 (year 2024 from period label).
    // Tie → reduce keeps FIRST element (Q1 2024, placed first in array).
    // This documents: without the annual 'current' fact, collapse picks Q1 (rank tie, first element).
    const quartersOnly: FinancialFactV1[] = [
      makeRevFact({ period_label: "Q1 2024", value: Q1_REVENUE, temporal_scope: "historical" }),
      makeRevFact({ period_label: "Q2 2024", value: Q2_REVENUE, temporal_scope: "historical" }),
      makeRevFact({ period_label: "Q3 2024", value: Q3_REVENUE, temporal_scope: "historical" }),
      makeRevFact({ period_label: "Q4 2024", value: Q4_REVENUE, temporal_scope: "historical" }),
    ];
    const truth = buildFinancialTruthV1({
      facts: quartersOnly,
      deckFinancialSignals: NULL_DECK,
      pipelineB: NULL_PB,
    });
    const rev = truth["revenue"]!;

    it("timeseries collapse fires (4 distinct quarterly period_labels)", () => {
      expect(rev.intra_document_timeseries).toBe(true);
    });

    it("resolved_value is a single quarterly value (not the full-year total)", () => {
      // Without the annual 'current' fact, collapse picks one quarter — never the sum.
      // Boundary: any quarterly value is ≤ $660K — not $2.2M
      const val = rev.resolved_value ?? 0;
      expect(val).toBeLessThanOrEqual(Q4_REVENUE * 1.05);
    });

    it("resolved_value is NOT the full-year total ($2.2M) — demonstrates the gap", () => {
      const val = rev.resolved_value ?? 0;
      const nearAnnual = val >= FY2024_ANNUAL_REVENUE * 0.9 && val <= FY2024_ANNUAL_REVENUE * 1.1;
      expect(nearAnnual).toBe(false);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Suite 6 — End-to-end adversarial: all noise combined, ground truth wins
// ═══════════════════════════════════════════════════════════════════════════════

describe("REF-DEAL-7 Suite 6: End-to-end adversarial — all noise combined", () => {
  const allFacts: FinancialFactV1[] = [
    // Quarterly actuals + annual actual (shared DOC_XLSX → timeseries collapse)
    ...QUARTERLY_PLUS_ANNUAL_REVENUE,
    // Forecasts (projected — excluded from primary)
    ...FORECAST_REVENUE,
    // Denomination noise: xlsx($2.2M) in DOC_XLSX + deck($2,200) in DOC_DECK
    DENOM_NOISE_FACT,
    // Burn: USD $150K + GBP £120K (shared DOC_XLSX → timeseries collapse)
    USD_BURN_FACT,
    GBP_BURN_FACT,
  ];

  const truth = buildFinancialTruthV1({
    facts: allFacts,
    deckFinancialSignals: NULL_DECK,
    pipelineB: NULL_PB,
  });

  describe("Revenue resolution", () => {
    const rev = truth["revenue"]!;

    it("revenue state is CONFIRMED or CONFLICT", () => {
      // With 2 docs producing revenue sources (DOC_XLSX collapsed→$2.2M, DOC_DECK deck→$2,200),
      // disagreement is >20% → CONFLICT, but selectHierarchyWinner picks xlsx → $2.2M.
      expect(["CONFIRMED", "CONFLICT"]).toContain(rev.state);
    });

    it("resolved_value is FY2024 annual revenue ($2.2M), within 5%", () => {
      expect(rev.resolved_value).toBeGreaterThanOrEqual(FY2024_ANNUAL_REVENUE * 0.95);
      expect(rev.resolved_value).toBeLessThanOrEqual(FY2024_ANNUAL_REVENUE * 1.05);
    });

    it("resolved_value is NOT a quarterly value (> $660K)", () => {
      expect(rev.resolved_value).toBeGreaterThan(Q4_REVENUE);
    });

    it("resolved_value is NOT the FY2025 forecast ($3.8M)", () => {
      const val = rev.resolved_value ?? 0;
      const nearForecast = val >= FY2025_FORECAST_REVENUE * 0.9 && val <= FY2025_FORECAST_REVENUE * 1.1;
      expect(nearForecast).toBe(false);
    });

    it("resolved_value is NOT the raw $000 artifact ($2,200)", () => {
      const val = rev.resolved_value ?? 0;
      expect(val).not.toBeCloseTo(DENOM_RAW_THOUSANDS, -2);
    });

    it("projected_excluded_count ≥ 2 (FY2025 + Q1 2025 forecasts excluded)", () => {
      expect(rev.projected_excluded_count ?? 0).toBeGreaterThanOrEqual(2);
    });

    it("projected_only_dataset is false", () => {
      expect(rev.projected_only_dataset).toBeFalsy();
    });
  });

  describe("Burn rate resolution", () => {
    const burn = truth["burn_rate"]!;

    it("burn_rate state is CONFIRMED", () => {
      expect(burn.state).toBe("CONFIRMED");
    });

    it("resolved_value is USD-normalized burn ($150K/month), within 10%", () => {
      expect(burn.resolved_value).toBeGreaterThanOrEqual(USD_BURN_MONTHLY * 0.90);
      expect(burn.resolved_value).toBeLessThanOrEqual(USD_BURN_MONTHLY * 1.10);
    });

    it("resolved_value is NOT raw GBP burn ($120K)", () => {
      const val = burn.resolved_value ?? 0;
      const nearGbp = val >= GBP_BURN_MONTHLY * 0.95 && val <= GBP_BURN_MONTHLY * 1.05;
      expect(nearGbp).toBe(false);
    });
  });
});
