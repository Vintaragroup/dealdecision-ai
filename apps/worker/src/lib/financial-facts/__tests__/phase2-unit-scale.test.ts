/**
 * phase2-unit-scale.test.ts
 *
 * Phase 2 Fix #3 — Unit / scale normalization.
 *
 * Validates that financial values are normalized to the correct magnitude
 * before truth resolution and scoring:
 *
 *   1. XLSX table-level scale detection (expanded patterns: $M, $K, ($M), ($K),
 *      USD millions, USD thousands, in $M, in $K)
 *   2. fromExcelSheet row-content scale scan (mirrors fromExcelRange)
 *   3. Deck KPI page-level scale detection with double-scaling guard
 *   4. Inline financial claims page-level scale detection
 *   5. parseNumericToken has_explicit_scale_suffix field
 *   6. No double-scaling when token already has K/M/B suffix
 *   7. Plain values without suffix on a scaled page
 *   8. Regression: existing patterns still work
 */

import { describe, it, expect } from "vitest";
import { detectUnitScale, detectFinancialTables } from "../../../extraction/xlsx/table-detector.js";
import { parseNumericToken } from "../extract-financial-table-claims.js";
import { extractKpiTileClaims } from "../extract-kpi-tile-claims.js";
import { extractInlineFinancialClaims } from "../extract-inline-financial-claims.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DEAL_ID = "phase2-scale-test";
const DOC_ID  = "doc-scale-0001";

function kpiOpts() {
  return { deal_id: DEAL_ID, document_id: DOC_ID, page_number: 1, slide_type: "traction" };
}

function inlineOpts() {
  return { deal_id: DEAL_ID, document_id: DOC_ID, page_number: 1, slide_type: "traction" };
}

// ─── Section 1: detectUnitScale — new patterns ────────────────────────────────

describe("detectUnitScale — new patterns ($M, $K, USD M, USD K)", () => {

  // Millions — new patterns
  it("detects '$M' standalone → factor 1_000_000", () => {
    const { factor } = detectUnitScale(["$M"]);
    expect(factor).toBe(1_000_000);
  });

  it("detects '($M)' → factor 1_000_000", () => {
    const { factor, source_text } = detectUnitScale(["($M)"]);
    expect(factor).toBe(1_000_000);
    expect(source_text).toBe("($M)");
  });

  it("detects '($ M)' (space between $ and M) → factor 1_000_000", () => {
    const { factor } = detectUnitScale(["($ M)"]);
    expect(factor).toBe(1_000_000);
  });

  it("detects 'Revenue ($M)' in sheet title → factor 1_000_000", () => {
    const { factor } = detectUnitScale(["Revenue ($M)"]);
    expect(factor).toBe(1_000_000);
  });

  it("detects 'USD millions' → factor 1_000_000", () => {
    const { factor, source_text } = detectUnitScale(["USD millions"]);
    expect(factor).toBe(1_000_000);
    expect(source_text).toBe("USD millions");
  });

  it("detects 'EUR million' → factor 1_000_000", () => {
    const { factor } = detectUnitScale(["EUR million"]);
    expect(factor).toBe(1_000_000);
  });

  it("detects 'in $M' → factor 1_000_000", () => {
    const { factor } = detectUnitScale(["in $M"]);
    expect(factor).toBe(1_000_000);
  });

  it("detects 'in £M' → factor 1_000_000", () => {
    const { factor } = detectUnitScale(["in £M"]);
    expect(factor).toBe(1_000_000);
  });

  // Thousands — new patterns
  it("detects '$K' standalone → factor 1_000", () => {
    const { factor } = detectUnitScale(["$K"]);
    expect(factor).toBe(1_000);
  });

  it("detects '($K)' → factor 1_000", () => {
    const { factor, source_text } = detectUnitScale(["($K)"]);
    expect(factor).toBe(1_000);
    expect(source_text).toBe("($K)");
  });

  it("detects '($ K)' (space between $ and K) → factor 1_000", () => {
    const { factor } = detectUnitScale(["($ K)"]);
    expect(factor).toBe(1_000);
  });

  it("detects 'Revenue ($K)' in sheet title → factor 1_000", () => {
    const { factor } = detectUnitScale(["Revenue ($K)"]);
    expect(factor).toBe(1_000);
  });

  it("detects 'USD thousands' → factor 1_000", () => {
    const { factor, source_text } = detectUnitScale(["USD thousands"]);
    expect(factor).toBe(1_000);
    expect(source_text).toBe("USD thousands");
  });

  it("detects 'GBP thousand' → factor 1_000", () => {
    const { factor } = detectUnitScale(["GBP thousand"]);
    expect(factor).toBe(1_000);
  });

  it("detects 'in $K' → factor 1_000", () => {
    const { factor } = detectUnitScale(["in $K"]);
    expect(factor).toBe(1_000);
  });

  // Billions — new pattern
  it("detects 'USD billions' → factor 1_000_000_000", () => {
    const { factor } = detectUnitScale(["USD billions"]);
    expect(factor).toBe(1_000_000_000);
  });

  // No false positives

  it("does NOT match '$KPI' as thousands ($K followed by word char)", () => {
    const { factor } = detectUnitScale(["$KPI"]);
    expect(factor).toBe(1);
  });

  it("does NOT match '$MM' as single-M millions (it is already matched by existing $MM pattern)", () => {
    const { factor } = detectUnitScale(["$MM"]);
    expect(factor).toBe(1_000_000); // still detects as millions via existing $MM pattern
  });

  it("does NOT create billions false positive from 'USD millions' text", () => {
    const { factor } = detectUnitScale(["USD millions"]);
    expect(factor).not.toBe(1_000_000_000);
  });

  it("does NOT match 'Gross Margin' or 'MRR' as millions", () => {
    expect(detectUnitScale(["Gross Margin"]).factor).toBe(1);
    expect(detectUnitScale(["MRR"]).factor).toBe(1);
  });

  // Ordering: billions wins over millions, millions over thousands
  it("billions wins over millions when both appear in different texts", () => {
    const { factor } = detectUnitScale(["USD billions", "in millions"]);
    expect(factor).toBe(1_000_000_000);
  });

  it("millions wins over thousands when both appear in different texts", () => {
    const { factor } = detectUnitScale(["($M)", "($K)"]);
    expect(factor).toBe(1_000_000);
  });
});

// ─── Section 2: Regression — existing patterns still work ─────────────────────

describe("detectUnitScale — regression: existing patterns still work", () => {
  it("'in thousands' → 1_000", () => {
    expect(detectUnitScale(["in thousands"]).factor).toBe(1_000);
  });

  it("'(in thousands)' → 1_000", () => {
    expect(detectUnitScale(["(in thousands)"]).factor).toBe(1_000);
  });

  it("'$000s' → 1_000", () => {
    expect(detectUnitScale(["$000s"]).factor).toBe(1_000);
  });

  it("'£000s' → 1_000", () => {
    expect(detectUnitScale(["£000s"]).factor).toBe(1_000);
  });

  it("'($000s)' → 1_000", () => {
    expect(detectUnitScale(["($000s)"]).factor).toBe(1_000);
  });

  it("'$000' (no trailing s) → 1_000", () => {
    expect(detectUnitScale(["$000"]).factor).toBe(1_000);
  });

  it("'in millions' → 1_000_000", () => {
    expect(detectUnitScale(["in millions"]).factor).toBe(1_000_000);
  });

  it("'$MM' → 1_000_000", () => {
    expect(detectUnitScale(["$MM"]).factor).toBe(1_000_000);
  });

  it("'(£MM)' → 1_000_000", () => {
    expect(detectUnitScale(["(£MM)"]).factor).toBe(1_000_000);
  });

  it("'in billions' → 1_000_000_000", () => {
    expect(detectUnitScale(["in billions"]).factor).toBe(1_000_000_000);
  });

  it("no marker → factor 1, source_text null", () => {
    const r = detectUnitScale(["P&L", "2024", "2025"]);
    expect(r.factor).toBe(1);
    expect(r.source_text).toBeNull();
  });
});

// ─── Section 3: XLSX table — $M / $K in sheet title ──────────────────────────

describe("detectFinancialTables — $M / $K scale in sheet title", () => {
  function makeExcelSheetPayload(
    sheetTitle: string,
    headers: string[],
    rows: Record<string, unknown>[],
  ) {
    return {
      page_type: "excel_sheet",
      structured: { sheet_title: sheetTitle, headers, rows, tables: [] },
    };
  }

  it("sets unit_scale_factor=1_000_000 when sheet title is '($M)'", () => {
    const payload = makeExcelSheetPayload("P&L ($M)", ["Metric", "FY2024", "FY2025"], [
      { Metric: "Revenue",    FY2024: 5.12, FY2025: 7.8 },
      { Metric: "Net Income", FY2024: 0.45, FY2025: 0.9 },
    ]);
    const [t] = detectFinancialTables(payload);
    expect(t?.unit_scale_factor).toBe(1_000_000);
    expect(t?.unit_scale_source_text).toBe("P&L ($M)");
  });

  it("sets unit_scale_factor=1_000 when sheet title is 'Revenue ($K)'", () => {
    const payload = makeExcelSheetPayload("Revenue ($K)", ["Metric", "FY2024", "FY2025"], [
      { Metric: "Revenue",    FY2024: 5120, FY2025: 7800 },
      { Metric: "Net Income", FY2024:  450, FY2025:  900 },
    ]);
    const [t] = detectFinancialTables(payload);
    expect(t?.unit_scale_factor).toBe(1_000);
  });

  it("sets unit_scale_factor=1_000_000 when column header contains 'USD millions'", () => {
    const payload = makeExcelSheetPayload("Financials", ["Metric", "FY2024 USD millions", "FY2025 USD millions"], [
      { Metric: "Revenue", "FY2024 USD millions": 5.12, "FY2025 USD millions": 7.8 },
      { Metric: "EBITDA",  "FY2024 USD millions": 0.45, "FY2025 USD millions": 0.9 },
    ]);
    const [t] = detectFinancialTables(payload);
    expect(t?.unit_scale_factor).toBe(1_000_000);
  });

  it("sets unit_scale_factor=1_000 when first row label is '$K' (row-content scan)", () => {
    // Scale marker is in the first data row's label cell, not in the sheet title or headers
    const payload = makeExcelSheetPayload("Income Statement", ["Metric", "FY2024", "FY2025"], [
      { Metric: "$K",         FY2024: null, FY2025: null },
      { Metric: "Revenue",    FY2024: 5120, FY2025: 7800 },
      { Metric: "Net Income", FY2024:  450, FY2025:  900 },
    ]);
    const [t] = detectFinancialTables(payload);
    expect(t?.unit_scale_factor).toBe(1_000);
  });

  it("sets unit_scale_factor=1_000_000 when first row label is '($M)' (row-content scan)", () => {
    const payload = makeExcelSheetPayload("Income Statement", ["Metric", "FY2024", "FY2025"], [
      { Metric: "($M)",        FY2024: null, FY2025: null },
      { Metric: "Revenue",     FY2024: 5.12, FY2025: 7.8  },
      { Metric: "Net Income",  FY2024: 0.45, FY2025: 0.9  },
    ]);
    const [t] = detectFinancialTables(payload);
    expect(t?.unit_scale_factor).toBe(1_000_000);
  });

  it("applies scale factor to cell values when $M detected", () => {
    const payload = makeExcelSheetPayload("P&L ($M)", ["Metric", "FY2024", "FY2025"], [
      { Metric: "Revenue",    FY2024: 5.12, FY2025: 7.8 },
      { Metric: "Net Income", FY2024: 0.45, FY2025: 0.9 },
    ]);
    const [t] = detectFinancialTables(payload);
    // Table itself stores raw values — scale is applied by parseFinancialTable
    expect(t?.unit_scale_factor).toBe(1_000_000);
    expect(t?.cell_matrix[0]?.[0]).toBe(5.12); // raw cell value
  });
});

// ─── Section 4: XLSX excel_range — $M / $K in row label ─────────────────────

describe("detectFinancialTables — $M / $K in excel_range row content", () => {
  function makeExcelRangePayload(
    sheetTitle: string,
    rowsPreview: Record<string, unknown>[],
  ) {
    return {
      page_type: "excel_range",
      structured: { sheet_title: sheetTitle, rows_preview: rowsPreview },
    };
  }

  it("detects '($M)' in top-row label and sets unit_scale_factor=1_000_000", () => {
    const rows = [
      { col_A: "($M)",       col_C: null, col_D: null },
      { col_A: null,         col_C: 2023, col_D: 2024 },
      { col_A: "Revenue",    col_C: 5.12, col_D: 7.8  },
      { col_A: "Net Income", col_C: 0.45, col_D: 0.9  },
    ];
    const [t] = detectFinancialTables(makeExcelRangePayload("Income Statement", rows));
    expect(t?.unit_scale_factor).toBe(1_000_000);
  });

  it("detects '$K' in top-row label and sets unit_scale_factor=1_000", () => {
    const rows = [
      { col_A: "$K",         col_C: null, col_D: null },
      { col_A: null,         col_C: 2023, col_D: 2024 },
      { col_A: "Revenue",    col_C: 5120, col_D: 7800 },
      { col_A: "Net Income", col_C:  450, col_D:  900 },
    ];
    const [t] = detectFinancialTables(makeExcelRangePayload("Income Statement", rows));
    expect(t?.unit_scale_factor).toBe(1_000);
  });
});

// ─── Section 5: parseNumericToken — has_explicit_scale_suffix ─────────────────

describe("parseNumericToken — has_explicit_scale_suffix", () => {
  it("$5.12M → value 5_120_000, has_explicit_scale_suffix true", () => {
    const r = parseNumericToken("$5.12M");
    expect(r?.value).toBe(5_120_000);
    expect(r?.has_explicit_scale_suffix).toBe(true);
  });

  it("$381K → value 381_000, has_explicit_scale_suffix true", () => {
    const r = parseNumericToken("$381K");
    expect(r?.value).toBe(381_000);
    expect(r?.has_explicit_scale_suffix).toBe(true);
  });

  it("$4.58M → value 4_580_000, has_explicit_scale_suffix true", () => {
    const r = parseNumericToken("$4.58M");
    expect(r?.value).toBe(4_580_000);
    expect(r?.has_explicit_scale_suffix).toBe(true);
  });

  it("$2.5B → value 2_500_000_000, has_explicit_scale_suffix true", () => {
    const r = parseNumericToken("$2.5B");
    expect(r?.value).toBe(2_500_000_000);
    expect(r?.has_explicit_scale_suffix).toBe(true);
  });

  it("$5,120 (no suffix) → value 5120, has_explicit_scale_suffix false", () => {
    const r = parseNumericToken("$5,120");
    expect(r?.value).toBe(5120);
    expect(r?.has_explicit_scale_suffix).toBe(false);
  });

  it("1200000 (no suffix) → value 1200000, has_explicit_scale_suffix false", () => {
    const r = parseNumericToken("1200000");
    expect(r?.value).toBe(1_200_000);
    expect(r?.has_explicit_scale_suffix).toBe(false);
  });

  it("65% → value 65, has_explicit_scale_suffix false", () => {
    const r = parseNumericToken("65%");
    expect(r?.value).toBe(65);
    expect(r?.has_explicit_scale_suffix).toBe(false);
  });
});

// ─── Section 6: Deck KPI — page-level scale context ───────────────────────────

describe("extractKpiTileClaims — page-level scale context", () => {

  it("plain '$5,120 ARR' on a page with '(in thousands)' header → value 5_120_000", () => {
    // Simulates a deck slide that states "in thousands" at the top but shows
    // plain numeric values like "$5,120" without an M/K suffix.
    const text = [
      "(in thousands)",
      "ARR: $5,120",
    ].join("\n");
    const facts = extractKpiTileClaims(text, kpiOpts());
    const arr = facts.find((f) => f.metric_key === "arr");
    expect(arr).toBeDefined();
    expect(arr!.value).toBe(5_120_000);
    expect(arr!.unit_scale_factor_applied).toBe(1_000);
    expect(arr!.unit_scale_source_text).toBe("(in thousands)");
  });

  it("plain '$381 MRR' on a page with '$000s' → value 381_000", () => {
    const text = [
      "All amounts: $000s",
      "$381 MRR",
    ].join("\n");
    const facts = extractKpiTileClaims(text, kpiOpts());
    const mrr = facts.find((f) => f.metric_key === "mrr");
    expect(mrr).toBeDefined();
    expect(mrr!.value).toBe(381_000);
  });

  it("explicit $5.12M ARR on a thousands page → no double scaling → still 5_120_000", () => {
    // Token already has M suffix → suffix wins, page scale NOT applied
    const text = [
      "in thousands",
      "$5.12M ARR",
    ].join("\n");
    const facts = extractKpiTileClaims(text, kpiOpts());
    const arr = facts.find((f) => f.metric_key === "arr");
    expect(arr).toBeDefined();
    expect(arr!.value).toBe(5_120_000); // NOT $5.12M × 1000 = $5.12B
    expect(arr!.unit_scale_factor_applied).toBeUndefined(); // no page scale applied
  });

  it("explicit $381K MRR on a thousands page → no double scaling → still 381_000", () => {
    const text = [
      "(in thousands)",
      "$381K MRR",
    ].join("\n");
    const facts = extractKpiTileClaims(text, kpiOpts());
    const mrr = facts.find((f) => f.metric_key === "mrr");
    expect(mrr).toBeDefined();
    expect(mrr!.value).toBe(381_000); // NOT $381K × 1000 = $381M
  });

  it("no scale context → plain $5,120 ARR stays at 5120", () => {
    // No scale annotation on the page → value as extracted
    const text = "$5,120 ARR";
    const facts = extractKpiTileClaims(text, kpiOpts());
    const arr = facts.find((f) => f.metric_key === "arr");
    expect(arr).toBeDefined();
    expect(arr!.value).toBe(5120);
    expect(arr!.unit_scale_factor_applied).toBeUndefined();
  });

  it("page with '($M)' scale → plain '$5.12 ARR' → 5_120_000", () => {
    const text = [
      "Financial Summary ($M)",
      "ARR $5.12",  // raw value in millions context
    ].join("\n");
    const facts = extractKpiTileClaims(text, kpiOpts());
    const arr = facts.find((f) => f.metric_key === "arr");
    expect(arr).toBeDefined();
    expect(arr!.value).toBe(5_120_000);
  });

  it("page with 'USD thousands' scale → $4,580 revenue → 4_580_000", () => {
    const text = [
      "USD thousands",
      "$4,580 revenue",
    ].join("\n");
    const facts = extractKpiTileClaims(text, kpiOpts());
    const rev = facts.find((f) => f.metric_key === "revenue");
    expect(rev).toBeDefined();
    expect(rev!.value).toBe(4_580_000);
    expect(rev!.unit_scale_factor_applied).toBe(1_000);
  });
});

// ─── Section 7: Inline financial claims — page-level scale ────────────────────

describe("extractInlineFinancialClaims — page-level scale context", () => {

  it("plain 'ARR: $5,120' on a '$000s' page → 5_120_000", () => {
    const text = [
      "$000s",
      "ARR: $5,120",
    ].join("\n");
    const facts = extractInlineFinancialClaims(text, inlineOpts());
    const arr = facts.find((f) => f.metric_key === "arr");
    expect(arr).toBeDefined();
    expect(arr!.value).toBe(5_120_000);
    expect(arr!.unit_scale_factor_applied).toBe(1_000);
  });

  it("plain 'Revenue: $4,580' on 'in millions' page → 4_580_000_000", () => {
    const text = [
      "in millions",
      "Revenue: $4,580",
    ].join("\n");
    const facts = extractInlineFinancialClaims(text, inlineOpts());
    const rev = facts.find((f) => f.metric_key === "revenue");
    expect(rev).toBeDefined();
    expect(rev!.value).toBe(4_580_000_000);
  });

  it("explicit '$4.58M revenue' on a thousands page → no double scaling → 4_580_000", () => {
    const text = [
      "in thousands",
      "$4.58M revenue",
    ].join("\n");
    const facts = extractInlineFinancialClaims(text, inlineOpts());
    const rev = facts.find((f) => f.metric_key === "revenue");
    expect(rev).toBeDefined();
    expect(rev!.value).toBe(4_580_000);
    expect(rev!.unit_scale_factor_applied).toBeUndefined();
  });

  it("no scale annotation → plain value unchanged", () => {
    const text = "ARR: $2,500";
    const facts = extractInlineFinancialClaims(text, inlineOpts());
    const arr = facts.find((f) => f.metric_key === "arr");
    expect(arr).toBeDefined();
    expect(arr!.value).toBe(2_500);
    expect(arr!.unit_scale_factor_applied).toBeUndefined();
  });
});

// ─── Section 8: Known-good suffix parsing regression ─────────────────────────

describe("deck KPI suffix parsing — regression (existing behaviour)", () => {
  it("extractKpiTileClaims — '$5.12M ARR' → 5_120_000 with no context", () => {
    const facts = extractKpiTileClaims("$5.12M ARR", kpiOpts());
    const arr = facts.find((f) => f.metric_key === "arr");
    expect(arr?.value).toBe(5_120_000);
  });

  it("extractKpiTileClaims — '$381K MRR' → 381_000 with no context", () => {
    const facts = extractKpiTileClaims("$381K MRR", kpiOpts());
    const mrr = facts.find((f) => f.metric_key === "mrr");
    expect(mrr?.value).toBe(381_000);
  });

  it("extractKpiTileClaims — '$4.58M ARR' → 4_580_000 with no context", () => {
    const facts = extractKpiTileClaims("$4.58M ARR", kpiOpts());
    const arr = facts.find((f) => f.metric_key === "arr");
    expect(arr?.value).toBe(4_580_000);
  });

  it("extractKpiTileClaims — '€1B GTV' → 1_000_000_000 with no context", () => {
    const facts = extractKpiTileClaims("€1B GTV", kpiOpts());
    const gtv = facts.find((f) => f.metric_key === "gtv");
    expect(gtv?.value).toBe(1_000_000_000);
  });

  it("extractKpiTileClaims — plain '$1,200,000 revenue' → 1_200_000 with no context", () => {
    const facts = extractKpiTileClaims("$1,200,000 revenue", kpiOpts());
    const rev = facts.find((f) => f.metric_key === "revenue");
    expect(rev?.value).toBe(1_200_000);
  });
});
