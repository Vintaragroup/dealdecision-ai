/**
 * classify-page-type-v1.test.ts
 *
 * Unit tests for the deterministic page type classifier.
 * Covers: ask, market, financials, team, traction, product, competition,
 *         gtm, use_of_funds, risks, unknown/fallback, edge cases.
 */

import { expect, describe, test } from "vitest";
import { classifyPageTypeV1 } from "../classify-page-type-v1";

// ─── Ask / Raise ─────────────────────────────────────────────────────────────

describe("classifyPageTypeV1 – ask", () => {
  test("fires on 'The Ask' with raising context (high)", () => {
    const r = classifyPageTypeV1("The Ask\nRaising $2M Series A at $12M pre-money valuation");
    expect(r.page_type).toBe("ask");
    expect(r.confidence).toBe("high");
  });

  test("fires on 'raising $X' + valuation cap (high)", () => {
    // ask-high rule fires when 2+ ask patterns match
    const r = classifyPageTypeV1("We are raising $3M seed round at $10M valuation cap");
    expect(r.page_type).toBe("ask");
    expect(r.confidence).toBe("high");
  });

  test("fires on 'use of proceeds'", () => {
    const r = classifyPageTypeV1("Use of proceeds and investment terms");
    expect(["ask", "use_of_funds"]).toContain(r.page_type);
  });
});

// ─── Market ──────────────────────────────────────────────────────────────────

describe("classifyPageTypeV1 – market", () => {
  test("fires on TAM SAM SOM (high)", () => {
    const r = classifyPageTypeV1("TAM $50B | SAM $5B | SOM $500M");
    expect(r.page_type).toBe("market");
    expect(r.confidence).toBe("high");
  });

  test("fires on market size / opportunity wording", () => {
    const r = classifyPageTypeV1("Total addressable market is $10B. Market opportunity is significant.");
    expect(r.page_type).toBe("market");
  });
});

// ─── Financials ───────────────────────────────────────────────────────────────

describe("classifyPageTypeV1 – financials", () => {
  test("fires on income statement + balance sheet (high)", () => {
    const r = classifyPageTypeV1("Income Statement | Revenue | Gross Profit | EBITDA | Balance Sheet");
    expect(r.page_type).toBe("financials");
    expect(r.confidence).toBe("high");
  });

  test("fires on cash flow + P&L (high)", () => {
    // financials-high needs 2+ formal statement terms
    const r = classifyPageTypeV1("Cash flow statement | P&L | burn rate $200k, runway 18 months");
    expect(r.page_type).toBe("financials");
    expect(r.confidence).toBe("high");
  });

  test("fires on gross margin + net revenue together (high)", () => {
    const r = classifyPageTypeV1("ARR $4.8M | MRR $400k | gross margin 72% | net revenue $6M");
    expect(r.page_type).toBe("financials");
    expect(r.confidence).toBe("high");
  });
});

// ─── Team ─────────────────────────────────────────────────────────────────────

describe("classifyPageTypeV1 – team", () => {
  test("fires on 'Meet the Team' + CEO and CTO on same line (high)", () => {
    // CEO.*CTO regex requires same line — use comma-separated names
    const r = classifyPageTypeV1("Meet the Team: Jane Smith CEO, John Doe CTO");
    expect(r.page_type).toBe("team");
    expect(r.confidence).toBe("high");
  });

  test("fires on founders + years of experience (high)", () => {
    const r = classifyPageTypeV1("Our founders bring 20+ years of experience building B2B SaaS");
    expect(r.page_type).toBe("team");
    expect(r.confidence).toBe("high");
  });
});

// ─── Traction ─────────────────────────────────────────────────────────────────

describe("classifyPageTypeV1 – traction", () => {
  test("fires on MRR + paying customers (high)", () => {
    // MRR pattern requires MRR before digit: 'MRR $400k'
    const r = classifyPageTypeV1("MRR $400k, 500 paying customers, 15% growth rate");
    expect(r.page_type).toBe("traction");
    expect(r.confidence).toBe("high");
  });

  test("fires on NPS + retention rate (high)", () => {
    const r = classifyPageTypeV1("120% net revenue retention, NPS of 72, retention rate 95%");
    expect(r.page_type).toBe("traction");
    expect(r.confidence).toBe("high");
  });
});

// ─── Product ──────────────────────────────────────────────────────────────────

describe("classifyPageTypeV1 – product", () => {
  test("fires on product overview + features", () => {
    const r = classifyPageTypeV1("Product Overview\nCore features: AI-powered dashboard, API integrations");
    expect(r.page_type).toBe("product");
  });
});

// ─── Competition ──────────────────────────────────────────────────────────────

describe("classifyPageTypeV1 – competition", () => {
  test("fires on competitive landscape + alternatives", () => {
    const r = classifyPageTypeV1("Competitive Landscape\nKey alternatives include Salesforce and HubSpot\nOur differentiation is clear");
    expect(r.page_type).toBe("competition");
  });
});

// ─── GTM ──────────────────────────────────────────────────────────────────────

describe("classifyPageTypeV1 – gtm", () => {
  test("fires on go-to-market strategy", () => {
    const r = classifyPageTypeV1("Go-To-Market Strategy\nInbound + outbound sales motion");
    expect(r.page_type).toBe("gtm");
  });
});

// ─── Use of Funds ─────────────────────────────────────────────────────────────

describe("classifyPageTypeV1 – use_of_funds", () => {
  test("fires on use of funds breakdown", () => {
    const r = classifyPageTypeV1("Use of Funds\n40% Engineering\n30% Sales & Marketing\n30% Operations");
    expect(r.page_type).toBe("use_of_funds");
  });
});

// ─── Risks ────────────────────────────────────────────────────────────────────

describe("classifyPageTypeV1 – risks", () => {
  test("fires on key risks + mitigations (high)", () => {
    const r = classifyPageTypeV1("Key Risks and Mitigations: regulatory risk factors, market challenges");
    expect(r.page_type).toBe("risks");
    expect(r.confidence).toBe("high");
  });
});

// ─── Fallback / Unknown ───────────────────────────────────────────────────────

describe("classifyPageTypeV1 – unknown / edge cases", () => {
  test("returns unknown for empty string", () => {
    const r = classifyPageTypeV1("");
    expect(r.page_type).toBe("unknown");
    expect(r.confidence).toBe("low");
  });

  test("returns unknown for whitespace-only input", () => {
    const r = classifyPageTypeV1("   \n\t  ");
    expect(r.page_type).toBe("unknown");
  });

  test("never throws on garbage input", () => {
    expect(() => classifyPageTypeV1("!!!@@@###$$$%%%^^^&&& random chars")).not.toThrow();
    expect(() => classifyPageTypeV1(null as any)).not.toThrow();
    expect(() => classifyPageTypeV1(undefined as any)).not.toThrow();
  });

  test("returns never-null result structure", () => {
    const r = classifyPageTypeV1("hello world");
    expect(r).toHaveProperty("page_type");
    expect(r).toHaveProperty("confidence");
  });

  test("confidence is always one of low/medium/high", () => {
    const inputs = ["", "TAM SAM SOM", "Meet the team", "garbage data"];
    for (const input of inputs) {
      const r = classifyPageTypeV1(input);
      expect(["low", "medium", "high"]).toContain(r.confidence);
    }
  });
});
