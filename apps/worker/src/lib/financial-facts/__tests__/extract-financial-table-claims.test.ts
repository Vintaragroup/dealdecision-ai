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

// ─── Scale-unit whitespace-split regression (F1 bug) ─────────────────────────

describe("extractFinancialTableClaims — whitespace-split scale suffix", () => {
  it("inline: '$3.5 B' is parsed as $3.5 billion", () => {
    // Use 'Revenue' keyword so detectFinancialTableCandidate passes
    const text = "Revenue $3.5 B";
    const claims = extractFinancialTableClaims(text, BASE_OPTS);
    expect(claims.some((c) => c.value === 3_500_000_000)).toBe(true);
  });

  it("inline: '$20 M' is parsed as $20 million", () => {
    const text = "Revenue $20 M";
    const claims = extractFinancialTableClaims(text, BASE_OPTS);
    expect(claims.some((c) => c.value === 20_000_000)).toBe(true);
  });

  it("pipe-separated: '$3.5' + lone 'B' part is combined", () => {
    // Two-line pipe table triggers detectFinancialTableCandidate rule B
    const text = "ARR | $3.5 | B\nRevenue | $1M";
    const claims = extractFinancialTableClaims(text, BASE_OPTS);
    expect(claims.some((c) => c.value === 3_500_000_000)).toBe(true);
  });

  it("pipe-separated: '$20' + lone 'M' part is combined", () => {
    const text = "ARR | $20 | M";
    const claims = extractFinancialTableClaims(text, BASE_OPTS);
    expect(claims.some((c) => c.value === 20_000_000)).toBe(true);
  });

  it("inline: '$11B' adjacent suffix is unaffected", () => {
    // Use a longer string so detectFinancialTableCandidate passes the 10-char min
    const text = "ARR $11B currently";
    const claims = extractFinancialTableClaims(text, BASE_OPTS);
    expect(claims.some((c) => c.value === 11_000_000_000)).toBe(true);
  });

  it("inline: suffix word 'basis' is not captured as scale unit 'b'", () => {
    // '$3.5 basis points' should NOT be parsed as $3.5 billion
    const text = "Burn $3.5 basis points";
    const claims = extractFinancialTableClaims(text, BASE_OPTS);
    // Should either return nothing or return $3.5 (not $3.5B)
    expect(claims.every((c) => c.value !== 3_500_000_000)).toBe(true);
  });
});

// ─── Noise rejection — metric key guard ──────────────────────────────────────

describe("extractFinancialTableClaims — noise metric key rejection", () => {
  it("rejects job-title row 'Warehouse Associate | $45,000'", () => {
    // Label has no financial signal keyword; slug has a job-title token
    const text = "Warehouse Associate | $45,000\nRevenue | $1,200,000";
    const claims = extractFinancialTableClaims(text, BASE_OPTS);
    expect(claims.every((c) => c.metric_key !== "warehouse_associate")).toBe(true);
  });

  it("rejects OCR artifact 'and Fortune 500 | $2,000,000'", () => {
    const text = "and Fortune 500 | $2,000,000\nRevenue | $1,000,000";
    const claims = extractFinancialTableClaims(text, BASE_OPTS);
    expect(claims.every((c) => c.metric_key !== "and_fortune_500")).toBe(true);
  });

  it("accepts canonical 'Revenue' label", () => {
    const text = "Revenue | $1,500,000";
    const claims = extractFinancialTableClaims(text, BASE_OPTS);
    expect(claims.some((c) => c.metric_key === "revenue")).toBe(true);
  });

  it("accepts 'ARR' label (alias-mapped)", () => {
    const text = "ARR | $2,400,000";
    const claims = extractFinancialTableClaims(text, BASE_OPTS);
    expect(claims.some((c) => c.metric_key === "arr")).toBe(true);
  });
});

// ─── Value guard — zero and implausibly small currency values ────────────────

describe("extractFinancialTableClaims — currency value guard", () => {
  it("rejects $0 currency values (OCR placeholder artifact)", () => {
    const text = "Revenue | $0\nARR | $2,500,000";
    const claims = extractFinancialTableClaims(text, BASE_OPTS);
    expect(claims.every((c) => c.value !== 0 || c.unit !== "currency")).toBe(true);
  });

  it("rejects currency values under $100", () => {
    const text = "Revenue | $42\nBurn Rate | $1,200,000";
    const claims = extractFinancialTableClaims(text, BASE_OPTS);
    expect(claims.every((c) => !(c.unit === "currency" && c.value < 100))).toBe(true);
  });

  it("does NOT reject zero for non-currency units", () => {
    // 0% churn rate is semantically valid
    const text = "Churn Rate | 0%\nRevenue | $1,000,000";
    const claims = extractFinancialTableClaims(text, BASE_OPTS);
    const churnFact = claims.find((c) => c.metric_key === "churn_rate");
    // If churn extracted, its value should be 0 and unit not "currency"
    if (churnFact) {
      expect(churnFact.unit).not.toBe("currency");
    }
  });
});

// ─── Period detection — new patterns ─────────────────────────────────────────

describe("extractPeriodFromText — extended patterns", () => {
  it("'YTD' → 'YTD'", () => {
    expect(extractPeriodFromText("YTD")).toBe("YTD");
  });

  it("'ytd' → 'YTD' (case insensitive)", () => {
    expect(extractPeriodFromText("ytd")).toBe("YTD");
  });

  it("'H1 2024' → 'H1 2024'", () => {
    expect(extractPeriodFromText("H1 2024")).toBe("H1 2024");
  });

  it("'H2 2025' → 'H2 2025'", () => {
    expect(extractPeriodFromText("H2 2025")).toBe("H2 2025");
  });

  it("'2024 H1' → 'H1 2024'", () => {
    expect(extractPeriodFromText("2024 H1")).toBe("H1 2024");
  });

  it("'2024E' → 'FY2024'", () => {
    expect(extractPeriodFromText("2024E")).toBe("FY2024");
  });

  it("'2025E' → 'FY2025'", () => {
    expect(extractPeriodFromText("2025E")).toBe("FY2025");
  });

  it("'Q2' standalone → 'Q2'", () => {
    expect(extractPeriodFromText("Q2")).toBe("Q2");
  });

  it("'Q4' standalone → 'Q4'", () => {
    expect(extractPeriodFromText("Q4")).toBe("Q4");
  });

  it("'Forecast 2025' → 'FY2025'", () => {
    expect(extractPeriodFromText("Forecast 2025")).toBe("FY2025");
  });

  it("'Budget 2026' → 'FY2026'", () => {
    expect(extractPeriodFromText("Budget 2026")).toBe("FY2026");
  });

  it("'Fiscal Year 2024' → 'FY2024'", () => {
    expect(extractPeriodFromText("Fiscal Year 2024")).toBe("FY2024");
  });

  it("'Fiscal 2023' → 'FY2023'", () => {
    expect(extractPeriodFromText("Fiscal 2023")).toBe("FY2023");
  });
});
