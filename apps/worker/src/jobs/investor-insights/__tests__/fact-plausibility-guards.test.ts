/**
 * fact-plausibility-guards.test.ts
 *
 * Deterministic unit tests for the Fact Plausibility Guards framework.
 *
 * Validates all four guard functions:
 *   1. guardRaiseAmount — rejects market/competitor pages; requires fundraising context
 *   2. guardArr         — rejects market context w/o company context; requires ARR keyword
 *   3. guardRevenue     — rejects industry revenue language; requires company context
 *   4. guardCustomerCount — rejects industry/benchmark context w/o ownership signals
 *
 * No DB, no LLM, no side effects. Tests operate purely on pageText strings.
 */

import { describe, it, expect } from "vitest";
import { FACT_PLAUSIBILITY_GUARDS } from "@dealdecision/core";

// ── guard refs ───────────────────────────────────────────────────────────────
const raiseGuard     = FACT_PLAUSIBILITY_GUARDS["raise_amount"];
const arrGuard       = FACT_PLAUSIBILITY_GUARDS["arr_value"];
const revenueGuard   = FACT_PLAUSIBILITY_GUARDS["revenue_value"];
const customerGuard  = FACT_PLAUSIBILITY_GUARDS["customer_count"];

// ── 1. raise_amount guard ────────────────────────────────────────────────────

describe("guardRaiseAmount", () => {

  // ── PASS cases ──

  it("PASS: explicit 'raising a seed round' page", () => {
    const page = "We are raising a $5M seed round to scale our engineering team.";
    const result = raiseGuard("raise_amount", page, "$5M");
    expect(result.allowed).toBe(true);
  });

  it("PASS: 'The Ask: $3M funding round' page", () => {
    const page = "The Ask: $3M — this funding round will accelerate our go-to-market.";
    const result = raiseGuard("raise_amount", page, "$3M");
    expect(result.allowed).toBe(true);
  });

  it("PASS: 'series a investment' page with no market/competitor language", () => {
    const page = "We are seeking $8M in our Series A investment to accelerate growth.";
    const result = raiseGuard("raise_amount", page, "$8M");
    expect(result.allowed).toBe(true);
  });

  it("PASS: 'capital raise' phrasing on clean page", () => {
    const page = "Capital Raise: $12M — proceeds will be used for product and hiring.";
    const result = raiseGuard("raise_amount", page, "$12M");
    expect(result.allowed).toBe(true);
  });

  it("PASS: mixed page — raise ask plus market context ('Raising $2M. TAM $50B.')", () => {
    // Investor decks often present the raise ask alongside TAM data on the same slide.
    // Market context must NOT override fundraising context when both are present.
    const page = "Raising $2M seed round. TAM $50B global market opportunity. MRR $80K.";
    const result = raiseGuard("raise_amount", page, "$2M");
    expect(result.allowed).toBe(true);
  });

  it("PASS: historic raise phrasing — 'raised to date'", () => {
    const page = "€5.6M raised to date from strategic investors.";
    const result = raiseGuard("raise_amount", page, "€5.6M");
    expect(result.allowed).toBe(true);
  });

  it("PASS: funded phrasing — 'USD 2.0M funded by angels'", () => {
    const page = "USD 2.0M funded by angel investors in 2024.";
    const result = raiseGuard("raise_amount", page, "2.0M");
    expect(result.allowed).toBe(true);
  });

  it("PASS: 'Total funding $4M raised' on clean page", () => {
    const page = "Total funding $4M raised to expand our engineering team.";
    const result = raiseGuard("raise_amount", page, "$4M");
    expect(result.allowed).toBe(true);
  });

  it("PASS: 'Round size $3M' structural label", () => {
    const page = "Round size $3M. Ticket size $3M. Use of proceeds: product and sales.";
    const result = raiseGuard("raise_amount", page, "$3M");
    expect(result.allowed).toBe(true);
  });

  it("PASS: 'The Ask: $2M Pre-Seed' header form", () => {
    const page = "The Ask $2M Pre-Seed Scale product, build team, accelerate go-to-market 40% 30% 20% 10%";
    const result = raiseGuard("raise_amount", page, "$2M");
    expect(result.allowed).toBe(true);
  });

  // ── FAIL cases ──

  it("FAIL: global market opportunity page — MARKET_CONTEXT with no fundraising context", () => {
    const page = "$500M global market opportunity in the healthcare sector.";
    const result = raiseGuard("raise_amount", page, "$500M");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("MARKET_CONTEXT");
  });

  it("FAIL: TAM / SAM / SOM page — MARKET_CONTEXT", () => {
    const page = "TAM: $10B | SAM: $2B | SOM: $300M — addressable market breakdown.";
    const result = raiseGuard("raise_amount", page, "$300M");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("MARKET_CONTEXT");
  });

  it("FAIL: market size page even if dollar value present", () => {
    const page = "Market size is estimated at $1T. Industry size growing at 18% CAGR.";
    const result = raiseGuard("raise_amount", page, "$1T");
    expect(result.allowed).toBe(false);
  });

  it("FAIL: competitive landscape page — COMPETITOR_CONTEXT", () => {
    const page = "Competitive landscape: peer companies have raised $200M to date.";
    const result = raiseGuard("raise_amount", page, "$200M");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("COMPETITOR_CONTEXT");
  });

  it("FAIL: benchmark analysis page — COMPETITOR_CONTEXT", () => {
    const page = "Benchmark: industry leader raised $150M in their last round.";
    const result = raiseGuard("raise_amount", page, "$150M");
    expect(result.allowed).toBe(false);
  });

  it("FAIL: no fundraising context at all — use-of-funds page", () => {
    const page = "Use of funds: $5M will go to engineering, $2M to sales, $1M to ops.";
    const result = raiseGuard("raise_amount", page, "$5M");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("NO_FUNDRAISING_CONTEXT");
  });
});

// ── 2. arr_value guard ───────────────────────────────────────────────────────

describe("guardArr", () => {

  // ── PASS cases ──

  it("PASS: our ARR with clear company context", () => {
    const page = "Our ARR reached $12M in Q3 2024, growing 140% year-over-year.";
    const result = arrGuard("arr_value", page, "$12M");
    expect(result.allowed).toBe(true);
  });

  it("PASS: ARR in financials summary with no market language", () => {
    const page = [
      "Financials Summary",
      "ARR: $2.4M",
      "MRR: $200K",
      "Customers: 120",
    ].join("\n");
    const result = arrGuard("arr_value", page, "$2.4M");
    expect(result.allowed).toBe(true);
  });

  it("PASS: annual recurring revenue keyword present", () => {
    const page = "The company's annual recurring revenue is $5M and growing.";
    const result = arrGuard("arr_value", page, "$5M");
    expect(result.allowed).toBe(true);
  });

  // ── FAIL cases ──

  it("FAIL: SaaS market generates ARR — market context without company context", () => {
    const page = "The global SaaS market size generates $12B ARR annually.";
    const result = arrGuard("arr_value", page, "$12B");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("MARKET_CONTEXT_WITHOUT_COMPANY_CONTEXT");
  });

  it("FAIL: TAM slide claiming ARR potential — market context without company context", () => {
    const page = "TAM opportunity: $500M ARR market opportunity in vertical SaaS.";
    const result = arrGuard("arr_value", page, "$500M");
    expect(result.allowed).toBe(false);
  });

  it("FAIL: competitor ARR cited — COMPETITOR_CONTEXT", () => {
    const page = "Our competitor's ARR is $500M — we aim to capture 2% of their market.";
    const result = arrGuard("arr_value", page, "$500M");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("COMPETITOR_CONTEXT");
  });

  it("FAIL: page with no ARR keyword at all", () => {
    const page = "We have $3M in revenue. Growing 80% YoY. Customers: 200.";
    const result = arrGuard("arr_value", page, "$3M");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("NO_ARR_KEYWORD");
  });

  // ── Edge: MARKET_CONTEXT rescued by company context ──

  it("EDGE: market context + company context → allowed (company data on mixed slide)", () => {
    // Some decks show 'our ARR' alongside TAM sizing on the same page
    const page = [
      "Market opportunity: TAM $10B",
      "Our ARR: $1.2M — growing within this market",
      "We are capturing the SMB segment",
    ].join("\n");
    const result = arrGuard("arr_value", page, "$1.2M");
    expect(result.allowed).toBe(true);
  });
});

// ── 3. revenue_value guard ───────────────────────────────────────────────────

describe("guardRevenue", () => {

  // ── PASS cases ──

  it("PASS: company revenue page with clear company context", () => {
    const page = "Company revenue reached $8M in fiscal year 2024.";
    const result = revenueGuard("revenue_value", page, "$8M");
    expect(result.allowed).toBe(true);
  });

  it("PASS: 'our annual revenue' phrasing", () => {
    const page = "Our annual revenue: $500K as of Q2 2024.";
    const result = revenueGuard("revenue_value", page, "$500K");
    expect(result.allowed).toBe(true);
  });

  it("PASS: product revenue on traction slide", () => {
    const page = "Traction: Product revenue $1.2M | 200 customers | 94% retention.";
    const result = revenueGuard("revenue_value", page, "$1.2M");
    expect(result.allowed).toBe(true);
  });

  // ── FAIL cases ──

  it("FAIL: 'Industry revenue is $8B' — industry revenue taint", () => {
    const page = "Industry revenue is $8B and growing at 12% annually.";
    const result = revenueGuard("revenue_value", page, "$8B");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("INDUSTRY_REVENUE_ON_PAGE");
  });

  it("FAIL: market revenue opportunity phrasing", () => {
    const page = "Market revenue opportunity: $5B in the enterprise software vertical.";
    const result = revenueGuard("revenue_value", page, "$5B");
    expect(result.allowed).toBe(false);
  });

  it("FAIL: competitor revenue cited on page", () => {
    const page = "Competitor revenue is $200M — we plan to undercut their pricing.";
    const result = revenueGuard("revenue_value", page, "$200M");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("INDUSTRY_REVENUE_ON_PAGE");
  });

  it("FAIL: page with no company context at all", () => {
    const page = "Total sector revenue: $3B. Annual growth rate: 15% CAGR.";
    const result = revenueGuard("revenue_value", page, "$3B");
    // sector revenue taint triggers industry revenue check first
    expect(result.allowed).toBe(false);
  });
});

// ── 4. customer_count guard ──────────────────────────────────────────────────

describe("guardCustomerCount", () => {

  // ── PASS cases ──

  it("PASS: 'We serve 1,200 customers'", () => {
    const page = "We serve 1,200 customers across 8 verticals.";
    const result = customerGuard("customer_count", page, "1200");
    expect(result.allowed).toBe(true);
  });

  it("PASS: active customers on traction page", () => {
    const page = "Active customers: 450 | Monthly growth: 12% | Churn: 2%";
    const result = customerGuard("customer_count", page, "450");
    expect(result.allowed).toBe(true);
  });

  it("PASS: users count on traction page", () => {
    const page = "Platform users: 3,400 registered, 1,200 active per month.";
    const result = customerGuard("customer_count", page, "3400");
    expect(result.allowed).toBe(true);
  });

  // ── FAIL cases ──

  it("FAIL: 'the industry serves 1.2M customers' — industry taint", () => {
    const page = "The industry serves 1.2M customers worldwide with no dominant player.";
    const result = customerGuard("customer_count", page, "1200000");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("INDUSTRY_CONTEXT_ON_PAGE");
  });

  it("FAIL: market average customer count — benchmark taint", () => {
    const page = "Market average: 500 customers per vendor in this space.";
    const result = customerGuard("customer_count", page, "500");
    expect(result.allowed).toBe(false);
  });

  it("FAIL: benchmark slide with peers serve count and no ownership signal", () => {
    const page = "Benchmark: peers serve 10,000 clients on average.";
    const result = customerGuard("customer_count", page, "10000");
    expect(result.allowed).toBe(false);
  });

  it("FAIL: page with no customer/user/client keyword", () => {
    const page = "We processed $1.2M in transactions across 400 accounts last quarter.";
    const result = customerGuard("customer_count", page, "400");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("NO_CUSTOMER_KEYWORD");
  });

  // ── Edge: industry taint rescued by ownership phrase ──

  it("EDGE: benchmark page with 'our customers' ownership signal → allowed", () => {
    const page = [
      "Industry benchmark: average 500 customers per company.",
      "Our customers: 1,200 — well above the benchmark.",
    ].join("\n");
    const result = customerGuard("customer_count", page, "1200");
    expect(result.allowed).toBe(true);
  });
});

// ── 5. Registry completeness ─────────────────────────────────────────────────

describe("FACT_PLAUSIBILITY_GUARDS registry", () => {
  it("contains guards for all four canonical fields", () => {
    expect(typeof FACT_PLAUSIBILITY_GUARDS["raise_amount"]).toBe("function");
    expect(typeof FACT_PLAUSIBILITY_GUARDS["arr_value"]).toBe("function");
    expect(typeof FACT_PLAUSIBILITY_GUARDS["revenue_value"]).toBe("function");
    expect(typeof FACT_PLAUSIBILITY_GUARDS["customer_count"]).toBe("function");
  });

  it("does not contain market-claim fields (tam_value intentionally absent)", () => {
    expect(FACT_PLAUSIBILITY_GUARDS["tam_value"]).toBeUndefined();
    expect(FACT_PLAUSIBILITY_GUARDS["sam_value"]).toBeUndefined();
    expect(FACT_PLAUSIBILITY_GUARDS["som_value"]).toBeUndefined();
  });

  it("registry guards for undefined field returns undefined (no crash)", () => {
    expect(FACT_PLAUSIBILITY_GUARDS["nonexistent_field"]).toBeUndefined();
  });
});
