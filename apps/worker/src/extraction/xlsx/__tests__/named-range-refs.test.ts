/**
 * __tests__/named-range-refs.test.ts
 *
 * Tests for workbook-level named-range reference detection:
 *   - extractNamedRangeRefs() unit tests (primary cases + edge cases)
 *   - hasNamedRangeRefs() unit tests
 *   - Integration: named_range_refs flows through detectFinancialTables →
 *     parseFinancialTable → promoteToFinancialFactV1
 */

import { describe, it, expect } from "vitest";
import { extractNamedRangeRefs, hasNamedRangeRefs } from "../named-range-refs.js";
import { detectFinancialTables } from "../table-detector.js";
import { parseFinancialTable } from "../financial-model-interpreter.js";
import { promoteToFinancialFactV1 } from "../metric-promoter.js";

// ─── extractNamedRangeRefs unit tests ────────────────────────────────────────

describe("extractNamedRangeRefs", () => {
  // ── Trivial / empty ──────────────────────────────────────────────────────

  it("returns [] for an empty string", () => {
    expect(extractNamedRangeRefs("")).toEqual([]);
  });

  it("returns [] for a formula with only same-sheet cell refs", () => {
    expect(extractNamedRangeRefs("=SUM(C3:C17)")).toEqual([]);
    expect(extractNamedRangeRefs("=B12/B13")).toEqual([]);
    expect(extractNamedRangeRefs("=A1+B2")).toEqual([]);
  });

  it("returns [] for a formula containing only cross-sheet references", () => {
    expect(extractNamedRangeRefs("=Inputs!C5")).toEqual([]);
    expect(extractNamedRangeRefs("='Revenue Build'!D12")).toEqual([]);
    expect(extractNamedRangeRefs("=SUM(Model!C3:C17)")).toEqual([]);
  });

  it("returns [] for a formula containing only function calls and literals", () => {
    expect(extractNamedRangeRefs("=ROUND(SUM(B3:B10), 2)")).toEqual([]);
    expect(extractNamedRangeRefs("=IF(B2>0, B2, 0)")).toEqual([]);
    expect(extractNamedRangeRefs("=1000")).toEqual([]);
  });

  // ── Single named range ───────────────────────────────────────────────────

  it("detects a simple standalone named range", () => {
    expect(extractNamedRangeRefs("=Revenue_2024")).toEqual(["Revenue_2024"]);
  });

  it("detects a named range without leading =", () => {
    expect(extractNamedRangeRefs("Revenue_2024")).toEqual(["Revenue_2024"]);
  });

  it("detects a named range used in arithmetic", () => {
    expect(extractNamedRangeRefs("=Revenue_2024 * 0.9")).toEqual(["Revenue_2024"]);
  });

  // ── Multiple named ranges ────────────────────────────────────────────────

  it("detects multiple named ranges inside a function call", () => {
    expect(extractNamedRangeRefs("=SUM(Revenue_2024, Cost_2024)")).toEqual([
      "Cost_2024",
      "Revenue_2024",
    ]);
  });

  it("detects multiple named ranges in an arithmetic expression", () => {
    expect(extractNamedRangeRefs("=Inputs_GrowthRate * Revenue_Base")).toEqual([
      "Inputs_GrowthRate",
      "Revenue_Base",
    ]);
  });

  // ── Named range inside nested formula ────────────────────────────────────

  it("detects named ranges inside a nested IF formula", () => {
    expect(
      extractNamedRangeRefs("=IF(ChurnRate > 0.05, ARR_Base, ARR_Downside)"),
    ).toEqual(["ARR_Base", "ARR_Downside", "ChurnRate"]);
  });

  it("detects named ranges inside deeply nested functions", () => {
    expect(
      extractNamedRangeRefs("=ROUND(IF(GrowthRate > 0, Revenue_Base * GrowthRate, Revenue_Base), 0)"),
    ).toEqual(["GrowthRate", "Revenue_Base"]);
  });

  // ── Excel function names are excluded ────────────────────────────────────

  it("excludes SUM, IF, ROUND and other built-in function names", () => {
    expect(extractNamedRangeRefs("=ROUND(SUM(Revenue_2024, Cost_2024), 2)")).toEqual([
      "Cost_2024",
      "Revenue_2024",
    ]);
  });

  it("excludes logical function names (AND, OR, NOT, etc.)", () => {
    expect(extractNamedRangeRefs("=IF(AND(Revenue_Base > 0, ChurnRate < 0.2), 1, 0)")).toEqual([
      "ChurnRate",
      "Revenue_Base",
    ]);
  });

  it("excludes TRUE, FALSE, NA, PI (function-like constants)", () => {
    expect(extractNamedRangeRefs("=IF(OR(A1>0, FALSE), Revenue_Base, NA())")).toEqual([
      "Revenue_Base",
    ]);
  });

  it("excludes VLOOKUP, INDEX, MATCH and lookup functions", () => {
    expect(extractNamedRangeRefs("=INDEX(ResultRange, MATCH(Revenue_Input, LookupArray, 0))")).toEqual([
      "LookupArray",
      "ResultRange",
      "Revenue_Input",
    ]);
  });

  // ── Cross-sheet refs are excluded from named-range results ───────────────

  it("excludes unquoted cross-sheet ref sheet names", () => {
    // "Inputs" is the sheet name, not a named range
    expect(extractNamedRangeRefs("=Inputs!C5")).toEqual([]);
  });

  it("excludes quoted cross-sheet ref sheet names", () => {
    expect(extractNamedRangeRefs("='Revenue Build'!D12")).toEqual([]);
  });

  it("isolates named ranges from mixed formula with cross-sheet refs", () => {
    // Inputs!C5 is a sheet ref; Revenue_Base is a named range
    expect(extractNamedRangeRefs("=Inputs!C5 * Revenue_Base")).toEqual(["Revenue_Base"]);
  });

  it("isolates named ranges from formula with quoted cross-sheet refs", () => {
    expect(extractNamedRangeRefs("=SUM('Revenue Build'!C3:C17) + Revenue_Named")).toEqual([
      "Revenue_Named",
    ]);
  });

  it("handles formula with both cross-sheet and named refs", () => {
    expect(
      extractNamedRangeRefs("=Inputs!C5 * GrowthRate + 'Assumptions'!B2 * Revenue_Base"),
    ).toEqual(["GrowthRate", "Revenue_Base"]);
  });

  // ── Text string literals are excluded ────────────────────────────────────

  it("does not pick up identifiers inside quoted string literals", () => {
    // "Revenue_2024" is a string value, not a named range reference
    expect(extractNamedRangeRefs('=IF(A1="Revenue_2024", Actual_Revenue, 0)')).toEqual([
      "Actual_Revenue",
    ]);
  });

  // ── Cell address exclusion ───────────────────────────────────────────────

  it("does not treat single-cell references as named ranges (A1, B12, XFD1)", () => {
    expect(extractNamedRangeRefs("=A1 + B12 + XFD1")).toEqual([]);
  });

  it("does not treat absolute cell refs as named ranges ($A$1)", () => {
    // $A$1 → identRe picks up "A" (single char, excluded) and nothing else
    expect(extractNamedRangeRefs("=$A$1 + Revenue_Base")).toEqual(["Revenue_Base"]);
  });

  // ── Output properties: sorted and deduplicated ───────────────────────────

  it("returns sorted output for stable ordering", () => {
    expect(extractNamedRangeRefs("=Zebra_Metric + Alpha_Metric + Mmm_Metric")).toEqual([
      "Alpha_Metric",
      "Mmm_Metric",
      "Zebra_Metric",
    ]);
  });

  it("deduplicates repeated references to the same named range", () => {
    expect(extractNamedRangeRefs("=Revenue_Base - Revenue_Base * 0.1")).toEqual([
      "Revenue_Base",
    ]);
  });

  // ── ARR-style all-caps names ─────────────────────────────────────────────

  it("detects all-caps named ranges (ARR, MRR style with underscore)", () => {
    expect(extractNamedRangeRefs("=ARR_Base - ARR_Churn")).toEqual([
      "ARR_Base",
      "ARR_Churn",
    ]);
  });

  it("detects camelCase named ranges without underscores", () => {
    expect(extractNamedRangeRefs("=GrowthRate * ChurnFactor")).toEqual([
      "ChurnFactor",
      "GrowthRate",
    ]);
  });
});

// ─── hasNamedRangeRefs unit tests ─────────────────────────────────────────────

describe("hasNamedRangeRefs", () => {
  it("returns false for an empty string", () => {
    expect(hasNamedRangeRefs("")).toBe(false);
  });

  it("returns false for a same-sheet cell formula", () => {
    expect(hasNamedRangeRefs("=SUM(C3:C17)")).toBe(false);
  });

  it("returns false for a cross-tab formula with no named ranges", () => {
    expect(hasNamedRangeRefs("=Inputs!C5")).toBe(false);
  });

  it("returns true for a formula with a named range", () => {
    expect(hasNamedRangeRefs("=Revenue_2024")).toBe(true);
  });

  it("returns true for a formula with named range and cross-tab refs", () => {
    expect(hasNamedRangeRefs("=Inputs!C5 * Revenue_Base")).toBe(true);
  });
});

// ─── Integration: payload → TypedMetric → FinancialFactV1 ────────────────────

/**
 * Pipeline helper.
 */
const DEAL_ID = "deal-named-ranges-test";
const DOC_ID  = "doc-named-ranges-test";

function runPipeline(payload: Record<string, unknown>) {
  const facts: ReturnType<typeof promoteToFinancialFactV1> = [];
  for (const table of detectFinancialTables(payload)) {
    const metrics = parseFinancialTable(table, { deal_id: DEAL_ID, document_id: DOC_ID });
    facts.push(
      ...promoteToFinancialFactV1(metrics, {
        deal_id: DEAL_ID,
        document_id: DOC_ID,
        sheet_name: table.sheet_name,
      }),
    );
  }
  return facts;
}

/**
 * Payload with formulas containing named ranges.
 *
 * Revenue FY2023: formula with single named range `Revenue_Assumptions`
 * Revenue FY2024: formula with named range + cross-sheet ref mix
 * EBITDA  FY2023: formula with multiple named ranges
 * EBITDA  FY2024: literal (no formula)
 */
const NAMED_RANGE_PAYLOAD = {
  page_type: "excel_sheet",
  structured: {
    sheet_title: "Summary",
    headers: ["Metric", "FY2023", "FY2024"],
    rows: [
      { Metric: "Revenue",    FY2023: 3_000_000, FY2024: 4_000_000 },
      { Metric: "Net Income", FY2023:  -500_000, FY2024:  -200_000 },
    ],
    formula_grid: {
      // Revenue FY2023: single named range
      "0:FY2023": "=Revenue_Assumptions",
      // Revenue FY2024: named range + cross-sheet ref in same formula
      "0:FY2024": "=Inputs!C5 * GrowthRate_2024",
      // Net Income FY2023: multiple named ranges
      "1:FY2023": "=Revenue_Assumptions - Cost_Structure",
      // Net Income FY2024: literal — no formula_grid entry
    },
    tables: [],
  },
};

describe("Integration: named_range_refs through detectFinancialTables → promoteToFinancialFactV1", () => {
  it("named_range_refs is present on a fact whose formula references a named range", () => {
    const facts = runPipeline(NAMED_RANGE_PAYLOAD);
    // Revenue FY2023: formula "=Revenue_Assumptions"
    const rev23 = facts.find(
      (f) => f.metric_key === "revenue" && f.original_period_label === "FY2023",
    );
    expect(rev23).toBeDefined();
    expect(rev23!.named_range_refs).toEqual(["Revenue_Assumptions"]);
  });

  it("named_range_refs contains only the named range when formula also has cross-sheet refs", () => {
    const facts = runPipeline(NAMED_RANGE_PAYLOAD);
    // Revenue FY2024: formula "=Inputs!C5 * GrowthRate_2024"
    const rev24 = facts.find(
      (f) => f.metric_key === "revenue" && f.original_period_label === "FY2024",
    );
    expect(rev24).toBeDefined();
    // cross_sheet_refs captures "Inputs"; named_range_refs captures "GrowthRate_2024"
    expect(rev24!.cross_sheet_refs).toEqual(["Inputs"]);
    expect(rev24!.named_range_refs).toEqual(["GrowthRate_2024"]);
  });

  it("named_range_refs contains multiple named ranges from the formula", () => {
    const facts = runPipeline(NAMED_RANGE_PAYLOAD);
    // Net Income FY2023: formula "=Revenue_Assumptions - Cost_Structure"
    const ni23 = facts.find(
      (f) => f.metric_key === "ebitda" && f.original_period_label === "FY2023",
    );
    expect(ni23).toBeDefined();
    expect(ni23!.named_range_refs).toEqual(["Cost_Structure", "Revenue_Assumptions"]);
  });

  it("named_range_refs is absent on a literal-value fact (no formula)", () => {
    const facts = runPipeline(NAMED_RANGE_PAYLOAD);
    // Net Income FY2024: literal — no formula_grid entry
    const ni24 = facts.find(
      (f) => f.metric_key === "ebitda" && f.original_period_label === "FY2024",
    );
    expect(ni24).toBeDefined();
    expect(ni24!.named_range_refs).toBeUndefined();
  });

  it("named_range_refs is absent when formula contains only cross-sheet refs", () => {
    const CROSS_ONLY_PAYLOAD = {
      page_type: "excel_sheet",
      structured: {
        sheet_title: "Summary",
        headers: ["Metric", "FY2023", "FY2024"],
        rows: [
          { Metric: "Revenue",    FY2023: 3_000_000, FY2024: 4_000_000 },
          { Metric: "Net Income", FY2023:  -500_000, FY2024:  -200_000 },
        ],
        formula_grid: {
          "0:FY2023": "=Inputs!C5",
        },
        tables: [],
      },
    };
    const facts = runPipeline(CROSS_ONLY_PAYLOAD);
    const rev23 = facts.find(
      (f) => f.metric_key === "revenue" && f.original_period_label === "FY2023",
    );
    expect(rev23).toBeDefined();
    expect(rev23!.cross_sheet_refs).toEqual(["Inputs"]);
    expect(rev23!.named_range_refs).toBeUndefined();
  });
});
