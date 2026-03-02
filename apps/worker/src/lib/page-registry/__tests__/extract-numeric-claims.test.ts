/**
 * extract-numeric-claims.test.ts
 *
 * Unit tests for the deterministic regex numeric extraction helper.
 * Covers: currency, percent, multiple, count, suffix normalisation, label inference, edge cases.
 */

import { expect, describe, test } from "vitest";
import { extractNumericClaims } from "../extract-numeric-claims";

// ─── Currency ────────────────────────────────────────────────────────────────

describe("extractNumericClaims – currency", () => {
  test("parses $1.2M", () => {
    const claims = extractNumericClaims("Raising $1.2M seed round");
    expect(claims.length).toBeGreaterThan(0);
    const c = claims[0];
    expect(c.unit).toBe("currency");
    expect(c.value).toBeCloseTo(1_200_000);
    expect(c.currency).toBe("USD");
  });

  test("parses $500k", () => {
    const claims = extractNumericClaims("Bridge loan of $500k");
    expect(claims[0].value).toBe(500_000);
    expect(claims[0].unit).toBe("currency");
  });

  test("parses $2.5B", () => {
    const claims = extractNumericClaims("Market valued at $2.5B");
    expect(claims[0].value).toBeCloseTo(2_500_000_000);
  });

  test("parses USD 10M", () => {
    const claims = extractNumericClaims("Revenue goal of USD 10M");
    expect(claims[0].value).toBe(10_000_000);
    expect(claims[0].currency).toBe("USD");
  });

  test("parses plain dollar with magnitude suffix", () => {
    const claims = extractNumericClaims("Invoice amount $5M");
    expect(claims.length).toBeGreaterThan(0);
    expect(claims[0].value).toBe(5_000_000);
  });
});

// ─── Percent ─────────────────────────────────────────────────────────────────

describe("extractNumericClaims – percent", () => {
  test("parses 20%", () => {
    const claims = extractNumericClaims("Revenue grew 20% YoY");
    expect(claims[0].unit).toBe("percent");
    expect(claims[0].value).toBe(20);
  });

  test("parses 100% in text", () => {
    const claims = extractNumericClaims("We own 100% of the IP");
    const pct = claims.find((c) => c.unit === "percent");
    expect(pct?.value).toBe(100);
  });
});

// ─── Multiple ─────────────────────────────────────────────────────────────────

describe("extractNumericClaims – multiple", () => {
  test("parses 3x", () => {
    const claims = extractNumericClaims("3x YoY growth last quarter");
    const m = claims.find((c) => c.unit === "multiple");
    expect(m).toBeDefined();
    expect(m?.value).toBe(3);
  });

  test("parses 10x", () => {
    const claims = extractNumericClaims("10x return on capital");
    const m = claims.find((c) => c.unit === "multiple");
    expect(m?.value).toBe(10);
  });
});

// ─── Count ───────────────────────────────────────────────────────────────────

describe("extractNumericClaims – count", () => {
  test("parses 10,000 users", () => {
    // Note: extractor requires no intervening word between number and unit
    const claims = extractNumericClaims("We have 10,000 users today");
    const ct = claims.find((c) => c.unit === "count");
    expect(ct).toBeDefined();
    expect(ct?.value).toBe(10_000);
  });

  test("parses customer count", () => {
    const claims = extractNumericClaims("500 customers signed up");
    const ct = claims.find((c) => c.unit === "count");
    expect(ct?.value).toBe(500);
  });
});

// ─── normalised label inference ───────────────────────────────────────────────

describe("extractNumericClaims – normalised label inference", () => {
  test("infers raise_amount from raising context", () => {
    const claims = extractNumericClaims("We are raising $2M");
    const c = claims.find((c) => c.normalized_label === "raise_amount");
    expect(c).toBeDefined();
  });

  test("infers arr from ARR context", () => {
    const claims = extractNumericClaims("ARR of $3.6M");
    const c = claims.find((c) => c.normalized_label === "arr");
    expect(c).toBeDefined();
  });

  test("infers mrr from MRR context", () => {
    const claims = extractNumericClaims("Current MRR is $300k");
    const c = claims.find((c) => c.normalized_label === "mrr");
    expect(c).toBeDefined();
  });

  test("infers valuation from valuation context", () => {
    const claims = extractNumericClaims("Pre-money valuation of $15M");
    const c = claims.find((c) => c.normalized_label === "valuation");
    expect(c).toBeDefined();
  });
});

// ─── Edge cases ───────────────────────────────────────────────────────────────

describe("extractNumericClaims – edge cases", () => {
  test("returns empty array for empty string", () => {
    expect(extractNumericClaims("")).toEqual([]);
  });

  test("never throws on garbage input", () => {
    expect(() => extractNumericClaims("!!!@@@###$$$%%%^^^&&&***")).not.toThrow();
    expect(() => extractNumericClaims(null as any)).not.toThrow();
    expect(() => extractNumericClaims(undefined as any)).not.toThrow();
  });

  test("caps output to 20 results", () => {
    const many = Array(30).fill("$1M ").join("");
    const claims = extractNumericClaims(many);
    expect(claims.length).toBeLessThanOrEqual(20);
  });

  test("each claim has required fields", () => {
    const claims = extractNumericClaims("Revenue of $5M and 40% margin");
    for (const c of claims) {
      expect(typeof c.raw).toBe("string");
      expect(typeof c.value).toBe("number");
      expect(typeof c.unit).toBe("string");
      expect(typeof c.context).toBe("string");
    }
  });
});
