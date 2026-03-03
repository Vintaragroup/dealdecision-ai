/**
 * extract-financial-table-claims.test.ts
 */

import { describe, it, expect } from "vitest";
import {
  detectFinancialTableCandidate,
  extractFinancialTableClaims,
  extractPeriodFromText,
} from "../extract-financial-table-claims";

// ─── detectFinancialTableCandidate ────────────────────────────────────────────

describe("detectFinancialTableCandidate", () => {
  it("returns true for text with 3+ currency symbols", () => {
    const text = "Revenue $1.2M | COGS $400K | Gross Profit $800K";
    expect(detectFinancialTableCandidate(text)).toBe(true);
  });

  it("returns true for pipe-separated table rows", () => {
    const text = "Label | FY2024 | FY2025\nRevenue | $1M | $2M\nBurn | $200K | $300K";
    expect(detectFinancialTableCandidate(text)).toBe(true);
  });

  it("returns true for financial keyword + number on same line", () => {
    const text = "ARR $2.5M verified by management";
    expect(detectFinancialTableCandidate(text)).toBe(true);
  });

  it("returns false for non-financial text", () => {
    const text = "We build products that help teams collaborate and innovate.";
    expect(detectFinancialTableCandidate(text)).toBe(false);
  });

  it("returns false for empty text", () => {
    expect(detectFinancialTableCandidate("")).toBe(false);
    expect(detectFinancialTableCandidate("Hi")).toBe(false);
  });
});

// ─── extractPeriodFromText ────────────────────────────────────────────────────

describe("extractPeriodFromText", () => {
  it("extracts FY year", () => {
    expect(extractPeriodFromText("FY2024")).toBe("FY2024");
    expect(extractPeriodFromText("FY 2025")).toBe("FY2025");
  });

  it("extracts quarterly", () => {
    expect(extractPeriodFromText("Q2 2024")).toBe("Q2 2024");
    expect(extractPeriodFromText("Q3-2025")).toBe("Q3 2025");
  });

  it("extracts standalone year", () => {
    expect(extractPeriodFromText("2023")).toBe("FY2023");
  });

  it("extracts monthly ISO format", () => {
    expect(extractPeriodFromText("2024-03")).toBe("2024-03");
  });

  it("extracts TTM/LTM", () => {
    expect(extractPeriodFromText("TTM")).toBe("TTM");
    expect(extractPeriodFromText("LTM")).toBe("LTM");
  });

  it("returns null for non-period text", () => {
    expect(extractPeriodFromText("Revenue")).toBeNull();
    expect(extractPeriodFromText("$1.2M")).toBeNull();
  });
});

// ─── extractFinancialTableClaims ─────────────────────────────────────────────

const BASE_OPTS = { deal_id: "deal-test-001", document_id: "doc-001", page_number: 5 };

describe("extractFinancialTableClaims", () => {
  it("extracts from pipe-separated table rows", () => {
    const text = [
      "Metric | FY2024 | FY2025",
      "Revenue | $1,200,000 | $2,400,000",
      "Gross Margin | 65% | 70%",
      "Burn Rate | $120,000 | $150,000",
    ].join("\n");

    const claims = extractFinancialTableClaims(text, BASE_OPTS);
    expect(claims.length).toBeGreaterThanOrEqual(2);

    const revenueFact = claims.find((c) => c.metric_key === "revenue");
    expect(revenueFact).toBeDefined();
    expect(revenueFact!.value).toBe(1_200_000);
    expect(revenueFact!.unit).toBe("currency");
    expect(revenueFact!.source_kind).toBe("pdf_table");
    expect(revenueFact!.deal_id).toBe("deal-test-001");
  });

  it("extracts from colon-separated lines", () => {
    const text = "ARR: $2.5M\nMRR: $210K\nRunway: 18 months";
    const claims = extractFinancialTableClaims(text, BASE_OPTS);
    const arrFact = claims.find((c) => c.metric_key === "arr");
    expect(arrFact).toBeDefined();
    expect(arrFact!.value).toBe(2_500_000);
  });

  it("returns empty array for non-financial text", () => {
    const text = "We believe in creating great products for teams.";
    expect(extractFinancialTableClaims(text, BASE_OPTS)).toEqual([]);
  });

  it("returns empty array for empty text", () => {
    expect(extractFinancialTableClaims("", BASE_OPTS)).toEqual([]);
  });

  it("returns empty array without deal_id", () => {
    const text = "Revenue | $1,200,000";
    expect(extractFinancialTableClaims(text, { deal_id: "" })).toEqual([]);
  });

  it("all returned facts have finite values and required fields", () => {
    const text = [
      "Revenue | $1,200,000 | $2,400,000",
      "Gross Margin | 65% | 70%",
      "Burn | $120K | $150K",
    ].join("\n");
    const claims = extractFinancialTableClaims(text, BASE_OPTS);
    for (const c of claims) {
      expect(Number.isFinite(c.value)).toBe(true);
      expect(c.fact_id).toBeTruthy();
      expect(c.deal_id).toBe("deal-test-001");
      expect(c.metric_key.length).toBeGreaterThan(0);
      expect(c.source_kind).toBe("pdf_table");
    }
  });

  it("never exceeds 40 facts per page", () => {
    const rows: string[] = [];
    for (let i = 0; i < 60; i++) {
      rows.push(`Metric${i} | $${i * 1000}`);
    }
    const claims = extractFinancialTableClaims(rows.join("\n"), BASE_OPTS);
    expect(claims.length).toBeLessThanOrEqual(40);
  });

  it("never throws on malformed input", () => {
    expect(() =>
      extractFinancialTableClaims("|||||||", BASE_OPTS)
    ).not.toThrow();
    expect(() =>
      extractFinancialTableClaims(null as unknown as string, BASE_OPTS)
    ).not.toThrow();
  });
});
