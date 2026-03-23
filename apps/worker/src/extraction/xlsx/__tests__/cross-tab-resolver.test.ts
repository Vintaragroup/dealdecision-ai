/**
 * __tests__/cross-tab-resolver.test.ts
 *
 * Tests for Phase 2D: Cross-Tab Value Resolution.
 *
 * Coverage:
 *   - parseDirectCrossSheetRefs() — unit tests for formula parsing
 *   - resolveDirectCrossSheetRefs() — unit tests for index lookup
 *   - Integration: resolved_cross_sheet_values flows through
 *     detectFinancialTables → parseFinancialTable → promoteToFinancialFactV1
 */

import { describe, it, expect } from "vitest";
import {
  parseDirectCrossSheetRefs,
  resolveDirectCrossSheetRefs,
} from "../cross-tab-resolver.js";
import { detectFinancialTables } from "../table-detector.js";
import { parseFinancialTable } from "../financial-model-interpreter.js";
import { promoteToFinancialFactV1 } from "../metric-promoter.js";

// ─── parseDirectCrossSheetRefs ────────────────────────────────────────────────

describe("parseDirectCrossSheetRefs", () => {
  // ── Trivial ──────────────────────────────────────────────────────────────

  it("returns [] for an empty string", () => {
    expect(parseDirectCrossSheetRefs("")).toEqual([]);
  });

  it("returns [] for a same-sheet formula with no cross-tab refs", () => {
    expect(parseDirectCrossSheetRefs("=SUM(C3:C17)")).toEqual([]);
    expect(parseDirectCrossSheetRefs("=B12/B13")).toEqual([]);
    expect(parseDirectCrossSheetRefs("=IF(B2>0, B2, 0)")).toEqual([]);
  });

  // ── Direct single-cell: unquoted sheet name ──────────────────────────────

  it("parses a direct single-cell reference with unquoted sheet name", () => {
    const refs = parseDirectCrossSheetRefs("=Inputs!C5");
    expect(refs).toHaveLength(1);
    expect(refs[0]).toEqual({ sheet: "Inputs", cell: "C5", key: "Inputs!C5" });
  });

  it("parses a direct ref from a formula without leading =", () => {
    const refs = parseDirectCrossSheetRefs("Inputs!C5");
    expect(refs).toHaveLength(1);
    expect(refs[0]?.cell).toBe("C5");
  });

  it("normalizes column letters to uppercase", () => {
    const refs = parseDirectCrossSheetRefs("=Model!b7");
    expect(refs[0]?.cell).toBe("B7");
    expect(refs[0]?.key).toBe("Model!B7");
  });

  it("strips $ absolute notation from column and row", () => {
    const refs = parseDirectCrossSheetRefs("=Inputs!$C$5");
    expect(refs).toHaveLength(1);
    expect(refs[0]?.cell).toBe("C5");
    expect(refs[0]?.key).toBe("Inputs!C5");
  });

  // ── Direct single-cell: quoted sheet name ────────────────────────────────

  it("parses a direct ref with a quoted sheet name containing a space", () => {
    const refs = parseDirectCrossSheetRefs("='Revenue Build'!D12");
    expect(refs).toHaveLength(1);
    expect(refs[0]).toEqual({
      sheet: "Revenue Build",
      cell: "D12",
      key: "Revenue Build!D12",
    });
  });

  it("parses a quoted sheet name with special characters", () => {
    const refs = parseDirectCrossSheetRefs("='P&L 2024'!A2");
    expect(refs).toHaveLength(1);
    expect(refs[0]?.sheet).toBe("P&L 2024");
    expect(refs[0]?.cell).toBe("A2");
  });

  // ── Range references — NOT resolved ─────────────────────────────────────

  it("excludes range references (Inputs!C3:C17) — these are not direct single-cell refs", () => {
    const refs = parseDirectCrossSheetRefs("=SUM(Inputs!C3:C17)");
    expect(refs).toEqual([]); // C3 is followed by : so it is excluded
  });

  it("excludes only range portion when formula mixes direct and range refs", () => {
    // Inputs!C5 is direct; Inputs!C3:C17 is a range — only direct is captured
    const refs = parseDirectCrossSheetRefs("=Inputs!C5 + SUM(Inputs!C3:C17)");
    expect(refs).toHaveLength(1);
    expect(refs[0]?.cell).toBe("C5");
  });

  // ── Multiple direct refs ─────────────────────────────────────────────────

  it("parses multiple direct cross-sheet refs from a single formula", () => {
    const refs = parseDirectCrossSheetRefs("=Inputs!B3+Model!C4");
    expect(refs).toHaveLength(2);
    expect(refs.find((r) => r.sheet === "Inputs")?.cell).toBe("B3");
    expect(refs.find((r) => r.sheet === "Model")?.cell).toBe("C4");
  });

  it("deduplicates identical refs", () => {
    const refs = parseDirectCrossSheetRefs("=Inputs!C5+Inputs!C5");
    expect(refs).toHaveLength(1);
    expect(refs[0]?.key).toBe("Inputs!C5");
  });

  // ── Mixed formula ────────────────────────────────────────────────────────

  it("parses direct ref alongside function calls and same-sheet refs", () => {
    const refs = parseDirectCrossSheetRefs("=Inputs!C5 * ROUND(B12, 2)");
    expect(refs).toHaveLength(1);
    expect(refs[0]?.sheet).toBe("Inputs");
    expect(refs[0]?.cell).toBe("C5");
  });
});

// ─── resolveDirectCrossSheetRefs ─────────────────────────────────────────────

describe("resolveDirectCrossSheetRefs", () => {
  const INDEX = {
    "Inputs!C5": 12.5,
    "Revenue Build!D12": 450000,
    "Model!B7": "Base",
  };

  it("returns [] when formula has no direct cross-tab refs", () => {
    expect(resolveDirectCrossSheetRefs("=SUM(C3:C17)", INDEX)).toEqual([]);
    expect(resolveDirectCrossSheetRefs("=B12/B13", INDEX)).toEqual([]);
  });

  it("resolves a single numeric direct ref", () => {
    const result = resolveDirectCrossSheetRefs("=Inputs!C5", INDEX);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ sheet: "Inputs", cell: "C5", value: 12.5 });
  });

  it("resolves a quoted sheet name ref", () => {
    const result = resolveDirectCrossSheetRefs("='Revenue Build'!D12", INDEX);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ sheet: "Revenue Build", cell: "D12", value: 450000 });
  });

  it("resolves a string-valued ref", () => {
    const result = resolveDirectCrossSheetRefs("=Model!B7", INDEX);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ sheet: "Model", cell: "B7", value: "Base" });
  });

  it("returns null value when ref is not found in the index (fail open)", () => {
    const result = resolveDirectCrossSheetRefs("=Inputs!Z99", INDEX);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ sheet: "Inputs", cell: "Z99", value: null });
  });

  it("returns [] for range formulas — not direct refs", () => {
    const result = resolveDirectCrossSheetRefs("=SUM(Inputs!C3:C17)", INDEX);
    expect(result).toEqual([]);
  });

  it("resolves multiple direct refs independently", () => {
    const result = resolveDirectCrossSheetRefs("=Inputs!C5+Revenue Build!D12", INDEX);
    // Note: "Revenue Build" needs quotes in Excel — unquoted "Revenue" and "Build" are separate
    // Only Inputs!C5 will match as unquoted; "Revenue" then "Build" won't form a valid cross-ref
    // So only Inputs!C5 is captured from this formula
    const inputsRef = result.find((r) => r.sheet === "Inputs");
    expect(inputsRef).toBeDefined();
    expect(inputsRef?.value).toBe(12.5);
  });

  it("resolves multiple quoted-sheet refs independently", () => {
    const result = resolveDirectCrossSheetRefs("='Inputs'!C5+'Revenue Build'!D12", INDEX);
    expect(result).toHaveLength(2);
    const inputsRef = result.find((r) => r.sheet === "Inputs");
    const revRef = result.find((r) => r.sheet === "Revenue Build");
    expect(inputsRef?.value).toBe(12.5);
    expect(revRef?.value).toBe(450000);
  });

  it("does not throw on empty index — all refs produce null values", () => {
    const result = resolveDirectCrossSheetRefs("=Inputs!C5", {});
    expect(result).toHaveLength(1);
    expect(result[0]?.value).toBeNull();
  });
});

// ─── Integration: resolved_cross_sheet_values through pipeline ────────────────

/**
 * Shared DPU payload structure with a cross_sheet_resolved block.
 *
 * Simulates a P&L sheet where Revenue FY2024 is a formula pulling from Inputs!C5.
 * The cross_sheet_resolved entry pre-resolves the referenced cell to 5_000_000.
 */
const PIPELINE_PAYLOAD_WITH_RESOLUTION = {
  page_type: "excel_sheet",
  structured: {
    sheet_title: "P&L",
    headers: ["Metric", "FY2023", "FY2024"],
    rows: [
      { Metric: "Revenue", FY2023: 4000000, FY2024: 5000000 },
      { Metric: "Net Income", FY2023: 500000, FY2024: 600000 },
    ],
    formula_grid: {
      // Revenue FY2024 (rawRowIdx=0, col="FY2024") is a formula pulling from Inputs!C5
      "0:FY2024": "=Inputs!C5",
    },
    cross_sheet_resolved: {
      "Inputs!C5": 5000000,
    },
  },
};

/** Same payload but with a range formula — no direct single-cell refs → no resolution */
const PIPELINE_PAYLOAD_RANGE_FORMULA = {
  page_type: "excel_sheet",
  structured: {
    sheet_title: "Summary",
    headers: ["Metric", "FY2023", "FY2024"],
    rows: [
      { Metric: "Revenue", FY2023: 1000000, FY2024: 1200000 },
      { Metric: "Net Income", FY2023: 100000, FY2024: 150000 },
    ],
    formula_grid: {
      // Range formula — extractable by cross_sheet_refs but NOT resolvable as direct ref
      "0:FY2024": "=SUM(Inputs!C3:C17)",
    },
    cross_sheet_resolved: {
      // No direct ref keys — range is never resolved
    },
  },
};

/** Payload with unquoted sheet name ref that is NOT in the resolved index */
const PIPELINE_PAYLOAD_UNRESOLVABLE = {
  page_type: "excel_sheet",
  structured: {
    sheet_title: "Model",
    headers: ["Metric", "FY2023", "FY2024"],
    rows: [
      { Metric: "Revenue", FY2023: 2000000, FY2024: 2500000 },
      { Metric: "Net Income", FY2023: 200000, FY2024: 300000 },
    ],
    formula_grid: {
      "0:FY2024": "=Assumptions!B12",
    },
    // cross_sheet_resolved present but does NOT contain "Assumptions!B12"
    cross_sheet_resolved: {
      "Inputs!C5": 99,
    },
  },
};

function runPipeline(payload: unknown) {
  const [table] = detectFinancialTables(payload);
  if (!table) return [];
  const metrics = parseFinancialTable(table, {
    deal_id: "deal_test",
    document_id: "doc_test",
    currentYear: 2024,
  });
  return promoteToFinancialFactV1(metrics, {
    deal_id: "deal_test",
    document_id: "doc_test",
    sheet_name: "P&L",
  });
}

describe("Integration: resolved_cross_sheet_values through pipeline", () => {
  it("1. direct single-cell ref resolves correctly and survives promotion", () => {
    const facts = runPipeline(PIPELINE_PAYLOAD_WITH_RESOLUTION);
    // Revenue FY2024 has formula =Inputs!C5 with resolved value
    const revFact = facts.find(
      (f) => f.metric_key === "revenue" && f.formula === "=Inputs!C5"
    );
    expect(revFact).toBeDefined();
    expect(revFact?.resolved_cross_sheet_values).toBeDefined();
    expect(revFact?.resolved_cross_sheet_values).toHaveLength(1);
    expect(revFact?.resolved_cross_sheet_values?.[0]).toEqual({
      sheet: "Inputs",
      cell: "C5",
      value: 5000000,
    });
  });

  it("2. fact without formula has no resolved_cross_sheet_values", () => {
    const facts = runPipeline(PIPELINE_PAYLOAD_WITH_RESOLUTION);
    // Net Income FY2024 has no formula_grid entry → literal → no resolved values
    const netIncomeFact = facts.find(
      (f) => f.metric_key === "other_metric" && !f.formula
    );
    expect(netIncomeFact?.resolved_cross_sheet_values).toBeUndefined();
  });

  it("3. range formula produces cross_sheet_refs but no resolved_cross_sheet_values", () => {
    const facts = runPipeline(PIPELINE_PAYLOAD_RANGE_FORMULA);
    const revFact = facts.find(
      (f) => f.metric_key === "revenue" && f.formula === "=SUM(Inputs!C3:C17)"
    );
    expect(revFact).toBeDefined();
    // cross_sheet_refs should still be populated (detection-only)
    expect(revFact?.cross_sheet_refs).toEqual(["Inputs"]);
    // resolved_cross_sheet_values should be absent (range, not direct ref)
    expect(revFact?.resolved_cross_sheet_values).toBeUndefined();
  });

  it("4. unresolvable direct ref produces resolved entry with value: null (fail open)", () => {
    const facts = runPipeline(PIPELINE_PAYLOAD_UNRESOLVABLE);
    const revFact = facts.find(
      (f) => f.metric_key === "revenue" && f.formula === "=Assumptions!B12"
    );
    expect(revFact).toBeDefined();
    expect(revFact?.resolved_cross_sheet_values).toHaveLength(1);
    expect(revFact?.resolved_cross_sheet_values?.[0]).toEqual({
      sheet: "Assumptions",
      cell: "B12",
      value: null,
    });
  });

  it("5. payload with no cross_sheet_resolved block → no resolution (graceful absence)", () => {
    const payloadNoIndex = {
      page_type: "excel_sheet",
      structured: {
        sheet_title: "P&L",
        headers: ["Metric", "FY2023", "FY2024"],
        rows: [
          { Metric: "Revenue", FY2023: 1000000, FY2024: 2000000 },
          { Metric: "Net Income", FY2023: 100000, FY2024: 200000 },
        ],
        formula_grid: {
          "0:FY2024": "=Inputs!C5",
        },
        // no cross_sheet_resolved field at all
      },
    };
    const facts = runPipeline(payloadNoIndex);
    const revFact = facts.find((f) => f.metric_key === "revenue" && f.formula);
    expect(revFact).toBeDefined();
    // formula and cross_sheet_refs detected
    expect(revFact?.formula).toBe("=Inputs!C5");
    expect(revFact?.cross_sheet_refs).toEqual(["Inputs"]);
    // but no resolution available
    expect(revFact?.resolved_cross_sheet_values).toBeUndefined();
  });

  it("6. resolved values coexist with cross_sheet_refs (both populated independently)", () => {
    const facts = runPipeline(PIPELINE_PAYLOAD_WITH_RESOLUTION);
    const revFact = facts.find((f) => f.formula === "=Inputs!C5");
    expect(revFact?.cross_sheet_refs).toEqual(["Inputs"]);
    expect(revFact?.resolved_cross_sheet_values?.[0]?.sheet).toBe("Inputs");
  });
});
