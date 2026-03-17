/**
 * financial-fact-v1.test.ts
 *
 * Unit tests for FinancialFactV1 helpers:
 * - computeFactId: determinism
 * - isFiniteFactValue: finiteness guard
 * - capFactExcerpt: 280-char cap
 * - inferPeriodType: period label inference
 * - validateFinancialFact: validation rules
 */

import {
  computeFactId,
  isFiniteFactValue,
  capFactExcerpt,
  inferPeriodType,
  validateFinancialFact,
} from "../financial-fact-v1";
import type { FinancialFactV1 } from "../financial-fact-v1";

// ─── computeFactId ────────────────────────────────────────────────────────────

describe("computeFactId", () => {
  it("is deterministic for same inputs", () => {
    const opts = {
      deal_id: "deal-abc",
      metric_key: "revenue",
      period_type: "annual" as const,
      period_label: "FY2024",
      source_pointer: "sheet=Income row_key=revenue period=FY2024",
    };
    expect(computeFactId(opts)).toBe(computeFactId(opts));
  });

  it("produces expected format: factv1:{deal}:{metric}:{period_type}:{period_label}:{hash}", () => {
    const id = computeFactId({
      deal_id: "deal-xyz",
      metric_key: "burn_rate",
      period_type: "unknown",
      period_label: "current",
      source_pointer: "",
    });
    expect(id).toMatch(/^factv1:deal-xyz:burn_rate:unknown:current:[0-9a-f]{8}$/);
  });

  it("different metric_key → different fact_id", () => {
    const base = {
      deal_id: "deal-1",
      period_type: "annual" as const,
      period_label: "2024",
      source_pointer: "x",
    };
    expect(computeFactId({ ...base, metric_key: "revenue" })).not.toBe(
      computeFactId({ ...base, metric_key: "gross_margin" })
    );
  });

  it("different period_label → different fact_id", () => {
    const base = {
      deal_id: "deal-1",
      metric_key: "revenue",
      period_type: "annual" as const,
      source_pointer: "x",
    };
    expect(computeFactId({ ...base, period_label: "2023" })).not.toBe(
      computeFactId({ ...base, period_label: "2024" })
    );
  });

  it("sanitizes slashes in period_label", () => {
    const id = computeFactId({
      deal_id: "d",
      metric_key: "arr",
      period_type: "quarterly",
      period_label: "Q1/2024",
      source_pointer: "",
    });
    expect(id).not.toContain("/");
  });

  it("falls back to document_id when source_pointer is absent", () => {
    const with_doc = computeFactId({
      deal_id: "d",
      metric_key: "revenue",
      period_type: "annual",
      period_label: "2024",
      document_id: "doc-111",
    });
    const with_ptr = computeFactId({
      deal_id: "d",
      metric_key: "revenue",
      period_type: "annual",
      period_label: "2024",
      source_pointer: "doc-111",
    });
    // Both should hash the same string "doc-111"
    expect(with_doc).toBe(with_ptr);
  });
});

// ─── isFiniteFactValue ────────────────────────────────────────────────────────

describe("isFiniteFactValue", () => {
  it.each([
    [0, true],
    [42, true],
    [-100.5, true],
    [1e9, true],
    [NaN, false],
    [Infinity, false],
    [-Infinity, false],
    ["42", false],
    [null, false],
    [undefined, false],
  ])("isFiniteFactValue(%p) === %p", (input, expected) => {
    expect(isFiniteFactValue(input)).toBe(expected);
  });
});

// ─── capFactExcerpt ───────────────────────────────────────────────────────────

describe("capFactExcerpt", () => {
  it("passes through strings ≤ 280 chars unchanged", () => {
    const s = "a".repeat(280);
    expect(capFactExcerpt(s)).toBe(s);
    expect(capFactExcerpt(s).length).toBe(280);
  });

  it("truncates strings > 280 chars at 277 + '...'", () => {
    const s = "x".repeat(400);
    const result = capFactExcerpt(s);
    expect(result.length).toBe(280);
    expect(result.endsWith("...")).toBe(true);
  });

  it("does not modify empty string", () => {
    expect(capFactExcerpt("")).toBe("");
  });
});

// ─── inferPeriodType ──────────────────────────────────────────────────────────

describe("inferPeriodType", () => {
  it.each([
    ["2024",     "annual"],
    ["FY2024",   "annual"],
    ["FY2025",   "annual"],
    ["Q1 2024",  "quarterly"],
    ["Q3-2025",  "quarterly"],
    ["2024-03",  "monthly"],
    ["2025-11",  "monthly"],
    ["TTM",      "ttm"],
    ["LTM",      "ttm"],
    ["current",  "unknown"],
    ["P0",       "unknown"],
    // Standalone quarter labels
    ["Q1",       "quarterly"],
    ["Q2",       "quarterly"],
    ["Q3",       "quarterly"],
    ["Q4",       "quarterly"],
    // Half-year and YTD → annual (year-scoped aggregations)
    ["YTD",      "annual"],
    ["H1 2024",  "annual"],
    ["H2 2025",  "annual"],
  ] as const)("inferPeriodType(%s) === %s", (label, expected) => {
    expect(inferPeriodType(label)).toBe(expected);
  });
});

// ─── validateFinancialFact ────────────────────────────────────────────────────

describe("validateFinancialFact", () => {
  function makeFact(overrides: Partial<FinancialFactV1> = {}): FinancialFactV1 {
    return {
      fact_id: "factv1:d:revenue:annual:2024:abcd1234",
      deal_id: "deal-1",
      source_kind: "xlsx",
      metric_key: "revenue",
      period_type: "annual",
      period_label: "2024",
      value: 1_200_000,
      unit: "currency",
      confidence: "high",
      ...overrides,
    };
  }

  it("returns the fact unchanged for valid input", () => {
    const f = makeFact();
    expect(validateFinancialFact(f)).toMatchObject({ metric_key: "revenue", value: 1_200_000 });
  });

  it("returns null for NaN value", () => {
    expect(validateFinancialFact(makeFact({ value: NaN }))).toBeNull();
  });

  it("returns null for Infinity value", () => {
    expect(validateFinancialFact(makeFact({ value: Infinity }))).toBeNull();
  });

  it("returns null for empty metric_key", () => {
    expect(validateFinancialFact(makeFact({ metric_key: "" }))).toBeNull();
  });

  it("returns null for empty period_label", () => {
    expect(validateFinancialFact(makeFact({ period_label: "" }))).toBeNull();
  });

  it("caps excerpt at 280 chars", () => {
    const f = makeFact({ excerpt: "z".repeat(400) });
    const result = validateFinancialFact(f);
    expect(result).not.toBeNull();
    expect(result!.excerpt!.length).toBe(280);
  });

  it("preserves excerpt ≤ 280 chars unchanged", () => {
    const short = "short text";
    const f = makeFact({ excerpt: short });
    const result = validateFinancialFact(f);
    expect(result!.excerpt).toBe(short);
  });

  it("omits undefined excerpt field when not provided", () => {
    const f = makeFact();
    const result = validateFinancialFact(f);
    expect(result!.excerpt).toBeUndefined();
  });
});
