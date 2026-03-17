/**
 * Tests for the resolveRaiseAmount helper.
 *
 * Coverage:
 *   - parseMoneyToMillions: K / M / B suffix conversions
 *   - isCandidateTaintedByMarketContext: TAM / market / total revenue patterns
 *   - hasStrongRaiseSignal: explicit raise-request verbs
 *   - resolveRaiseAmount — Rule 1: raise_terms override for early-stage deals
 *   - resolveRaiseAmount — Rule 2: market-context taint rejection (all candidates)
 *   - resolveRaiseAmount — Rule 3: magnitude sanity ($100M+ for early-stage)
 *   - resolveRaiseAmount — pass-through for late-stage magnitude
 *   - resolveRaiseAmount — null result when no candidates survive
 */

import { describe, it, expect } from "vitest";
import {
  parseMoneyToMillions,
  isCandidateTaintedByMarketContext,
  isCandidateTaintedByFundAumContext,
  hasStrongRaiseSignal,
  resolveRaiseAmount,
  MAGNITUDE_THRESHOLD_M,
} from "../jobs/investor-insights/resolve-raise-amount";

// ─── parseMoneyToMillions ─────────────────────────────────────────────────────

describe("parseMoneyToMillions", () => {
  it("parses $25K to 0.025M", () => {
    expect(parseMoneyToMillions("$25K")).toBeCloseTo(0.025);
  });

  it("parses $2M to 2", () => {
    expect(parseMoneyToMillions("$2M")).toBe(2);
  });

  it("parses $11B to 11000", () => {
    expect(parseMoneyToMillions("$11B")).toBe(11_000);
  });

  it("parses $1.5B to 1500", () => {
    expect(parseMoneyToMillions("$1.5B")).toBeCloseTo(1_500);
  });

  it("parses €500K to 0.5", () => {
    expect(parseMoneyToMillions("€500K")).toBeCloseTo(0.5);
  });

  it("returns null for non-money string", () => {
    expect(parseMoneyToMillions("Tax Software Market")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseMoneyToMillions("")).toBeNull();
  });

  it("MAGNITUDE_THRESHOLD_M is 100", () => {
    expect(MAGNITUDE_THRESHOLD_M).toBe(100);
  });
});

// ─── isCandidateTaintedByMarketContext ────────────────────────────────────────

describe("isCandidateTaintedByMarketContext", () => {
  it("detects 'market' keyword", () => {
    expect(isCandidateTaintedByMarketContext("Tax Software Market $11B")).toBe(true);
  });

  it("detects TAM", () => {
    expect(isCandidateTaintedByMarketContext("TAM is $5B globally")).toBe(true);
  });

  it("detects 'total revenue'", () => {
    expect(isCandidateTaintedByMarketContext("Total revenue of $11B for the sector")).toBe(true);
  });

  it("detects 'revenue size'", () => {
    expect(isCandidateTaintedByMarketContext("revenue size of $3B in the space")).toBe(true);
  });

  it("detects 'industry'", () => {
    expect(isCandidateTaintedByMarketContext("industry opportunity valued at $50B")).toBe(true);
  });

  it("does NOT taint a clean raise sentence", () => {
    expect(isCandidateTaintedByMarketContext("Raising $4M pre-seed to expand our team")).toBe(false);
  });

  it("does NOT taint 'investment of $2M SAFE' without market words", () => {
    expect(isCandidateTaintedByMarketContext("Seeking investment of $2M via SAFE note")).toBe(false);
  });
});

// ─── hasStrongRaiseSignal ─────────────────────────────────────────────────────

describe("hasStrongRaiseSignal", () => {
  it("detects 'Raising $4M'", () => {
    expect(hasStrongRaiseSignal("Raising $4M pre-seed")).toBe(true);
  });

  it("detects 'Seeking $2M'", () => {
    expect(hasStrongRaiseSignal("Seeking $2M in investment")).toBe(true);
  });

  it("detects 'we are raising'", () => {
    expect(hasStrongRaiseSignal("We are raising $1M for our next phase")).toBe(true);
  });

  it("does NOT match 'investment opportunity'", () => {
    expect(hasStrongRaiseSignal("investment opportunity of $11B")).toBe(false);
  });

  it("does NOT match 'market'", () => {
    expect(hasStrongRaiseSignal("Total Software Market $11B")).toBe(false);
  });
});

// ─── resolveRaiseAmount — Rule 1: raise_terms override ───────────────────────

describe("resolveRaiseAmount — Rule 1: raise_terms override for early-stage", () => {
  it("$25K Pre-Seed raise_terms overrides $11B deck candidate", () => {
    const result = resolveRaiseAmount({
      raiseTermsRaw: "$25K Pre-Seed",
      stage: "Unknown",
      candidates: [
        {
          value: "$11B",
          context: "Tax Software Market $11B total revenue",
          source: "deck",
          evidence_ref: null,
        },
      ],
    });
    expect(result.raise_amount).not.toBeNull();
    expect(result.raise_amount).toContain("25");
    expect(result.from_raise_terms_override).toBe(true);
  });

  it("raise_terms override applies for 'Seed' stage", () => {
    const result = resolveRaiseAmount({
      raiseTermsRaw: "Raising $500K Seed",
      stage: "Seed",
      candidates: [
        { value: "$2B", context: "market cap $2B sector", source: "deck", evidence_ref: null },
      ],
    });
    expect(result.from_raise_terms_override).toBe(true);
    expect(result.raise_amount).not.toBeNull();
  });

  it("raise_terms override does NOT apply for Series A stage", () => {
    // Series A is not an early-stage — deck candidate should be used if valid.
    const result = resolveRaiseAmount({
      raiseTermsRaw: "$25K Placeholder",
      stage: "Series A",
      candidates: [
        { value: "$5M", context: "Raising $5M Series A", source: "deck", evidence_ref: null },
      ],
    });
    // from_raise_terms_override should be false for non-early stages
    expect(result.from_raise_terms_override).toBe(false);
  });
});

// ─── resolveRaiseAmount — Rule 2: market-context taint ───────────────────────

describe("resolveRaiseAmount — Rule 2: market-context taint (regression: $11B from 'Tax Software Market')", () => {
  it("$11B in Tax Software Market context → raise_amount null", () => {
    const result = resolveRaiseAmount({
      stage: "Seed",
      candidates: [
        {
          value: "$11B",
          context: "Tax Software Market $11B total revenue size for enterprise customers.",
          source: "deck",
          evidence_ref: null,
        },
      ],
    });
    expect(result.raise_amount).toBeNull();
    expect(result.rejected_candidates).toHaveLength(1);
    expect(result.rejected_candidates[0]!.reason).toBe("market_context_taint");
  });

  it("'investment opportunity of $11B' with market context → raise_amount null", () => {
    const result = resolveRaiseAmount({
      stage: "Seed",
      candidates: [
        {
          value: "$11B",
          context: "investment opportunity of $11B Tax Software Market",
          source: "deck",
          evidence_ref: null,
        },
      ],
    });
    expect(result.raise_amount).toBeNull();
    expect(result.rejected_candidates[0]!.reason).toBe("market_context_taint");
  });

  it("clean 'investment of $2M SAFE' without market words → accepted", () => {
    const result = resolveRaiseAmount({
      stage: "Seed",
      candidates: [
        {
          value: "$2M",
          context: "Seeking investment of $2M via SAFE note for product development.",
          source: "deck",
          evidence_ref: null,
        },
      ],
    });
    expect(result.raise_amount).toBe("$2M");
  });
});

// ─── resolveRaiseAmount — Rule 3: magnitude sanity ───────────────────────────

describe("resolveRaiseAmount — Rule 3: magnitude sanity ($100M+ early-stage)", () => {
  it("$11B without strong raise verb for 'Seed' → rejected", () => {
    const result = resolveRaiseAmount({
      stage: "Seed",
      candidates: [
        {
          value: "$11B",
          context: "investment of $11B allocated across the portfolio",
          source: "deck",
          evidence_ref: null,
        },
      ],
    });
    expect(result.raise_amount).toBeNull();
    expect(result.rejected_candidates[0]!.reason).toBe("magnitude_no_strong_verb");
  });

  it("$150M without strong raise verb for 'pre-seed' → rejected", () => {
    const result = resolveRaiseAmount({
      stage: "pre-seed",
      candidates: [
        {
          value: "$150M",
          context: "portfolio allocation of $150M in fintech.",
          source: "deck",
          evidence_ref: null,
        },
      ],
    });
    expect(result.raise_amount).toBeNull();
    expect(result.rejected_candidates[0]!.reason).toBe("magnitude_no_strong_verb");
  });

  it("'Raising $11B' with strong raise verb → accepted even for Seed stage", () => {
    const result = resolveRaiseAmount({
      stage: "Seed",
      candidates: [
        {
          value: "$11B",
          context: "Raising $11B for our global platform expansion in 2026.",
          source: "deck",
          evidence_ref: null,
        },
      ],
    });
    // Strong raise verb present — magnitude check is satisfied.
    expect(result.raise_amount).toBe("$11B");
    expect(result.rejected_candidates).toHaveLength(0);
  });

  it("$200M for 'Series B' stage is NOT rejected (not early-stage)", () => {
    const result = resolveRaiseAmount({
      stage: "Series B",
      candidates: [
        {
          value: "$200M",
          context: "investment of $200M in total",
          source: "deck",
          evidence_ref: null,
        },
      ],
    });
    // Series B is not early-stage — magnitude rule does not apply.
    expect(result.raise_amount).toBe("$200M");
  });
});

// ─── resolveRaiseAmount — null result when no candidates ─────────────────────

describe("resolveRaiseAmount — null result when all candidates rejected or absent", () => {
  it("returns null raise_amount when candidates array is empty", () => {
    const result = resolveRaiseAmount({ stage: "Seed", candidates: [] });
    expect(result.raise_amount).toBeNull();
    expect(result.source).toBeNull();
  });

  it("returns null when only candidate is market-tainted", () => {
    const result = resolveRaiseAmount({
      stage: "Seed",
      candidates: [
        { value: "$5B", context: "SAM of $5B in the insurance market", source: "deck", evidence_ref: null },
      ],
    });
    expect(result.raise_amount).toBeNull();
  });
});

// ─── isCandidateTaintedByFundAumContext ───────────────────────────────────────

describe("isCandidateTaintedByFundAumContext", () => {
  it("detects 'Alternatives Fund'", () => {
    expect(isCandidateTaintedByFundAumContext("$100M Alternatives Fund raising from institutional LPs")).toBe(true);
  });

  it("detects 'AUM'", () => {
    expect(isCandidateTaintedByFundAumContext("$500M AUM across the portfolio")).toBe(true);
  });

  it("detects 'assets under management'", () => {
    expect(isCandidateTaintedByFundAumContext("$2B in assets under management")).toBe(true);
  });

  it("detects 'limited partner'", () => {
    expect(isCandidateTaintedByFundAumContext("$250M limited partner commitment to the vehicle")).toBe(true);
  });

  it("detects 'hedge fund'", () => {
    expect(isCandidateTaintedByFundAumContext("We are a $50M hedge fund focused on crypto assets")).toBe(true);
  });

  it("detects 'private equity fund'", () => {
    expect(isCandidateTaintedByFundAumContext("$300M private equity fund investing in Series B")).toBe(true);
  });

  it("does NOT taint '$2M Pre-Seed raise'", () => {
    expect(isCandidateTaintedByFundAumContext("Raising $2M Pre-Seed to fund product and GTM")).toBe(false);
  });

  it("does NOT taint clean SAFE sentence", () => {
    expect(isCandidateTaintedByFundAumContext("Seeking $1.5M via SAFE note for 18-month runway")).toBe(false);
  });

  it("does NOT taint '$100M TAM' — TAM is market_context, not fund_aum", () => {
    expect(isCandidateTaintedByFundAumContext("TAM of $100M in the SMB accounting space")).toBe(false);
  });
});

// ─── resolveRaiseAmount — Rule 2b: fund/AUM context ──────────────────────────

describe("resolveRaiseAmount — Rule 2b: fund/AUM context (regression: $100M Alternatives Fund)", () => {
  it("$100M Alternatives Fund → rejected with fund_aum_context", () => {
    const result = resolveRaiseAmount({
      stage: "Seed",
      candidates: [
        {
          value: "$100M",
          context: "$100M Alternatives Fund raising capital from institutional limited partners.",
          source: "deck",
          evidence_ref: null,
        },
      ],
    });
    expect(result.raise_amount).toBeNull();
    expect(result.rejected_candidates).toHaveLength(1);
    expect(result.rejected_candidates[0]!.reason).toBe("fund_aum_context");
  });

  it("$2M Pre-Seed → accepted when no fund/AUM language", () => {
    const result = resolveRaiseAmount({
      stage: "Seed",
      candidates: [
        {
          value: "$2M",
          context: "We are raising $2M Pre-Seed to grow our engineering team and launch in Q3.",
          source: "deck",
          evidence_ref: null,
        },
      ],
    });
    expect(result.raise_amount).toBe("$2M");
    expect(result.rejected_candidates).toHaveLength(0);
  });

  it("$100M Alternatives Fund alongside $2M Pre-Seed → only $2M accepted", () => {
    const result = resolveRaiseAmount({
      stage: "Seed",
      candidates: [
        {
          value: "$100M",
          context: "$100M Alternatives Fund vehicle for LP capital.",
          source: "deck",
          evidence_ref: null,
        },
        {
          value: "$2M",
          context: "We are raising $2M pre-seed for runway.",
          source: "deck",
          evidence_ref: null,
        },
      ],
    });
    expect(result.raise_amount).toBe("$2M");
    expect(result.rejected_candidates).toHaveLength(1);
    expect(result.rejected_candidates[0]!.reason).toBe("fund_aum_context");
  });

  it("'$100M TAM' is rejected as market_context_taint, not fund_aum_context (rule 2 fires first)", () => {
    const result = resolveRaiseAmount({
      stage: "Seed",
      candidates: [
        {
          value: "$100M",
          context: "TAM of $100M in the SMB accounting software market.",
          source: "deck",
          evidence_ref: null,
        },
      ],
    });
    expect(result.raise_amount).toBeNull();
    expect(result.rejected_candidates[0]!.reason).toBe("market_context_taint");
  });
});
