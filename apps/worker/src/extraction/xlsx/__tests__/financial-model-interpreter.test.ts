/**
 * __tests__/financial-model-interpreter.test.ts
 *
 * Unit tests for:
 *   apps/worker/src/extraction/xlsx/financial-model-interpreter.ts
 *   apps/worker/src/extraction/xlsx/metric-promoter.ts
 */

import { describe, it, expect } from "vitest";
import { parseFinancialTable } from "../financial-model-interpreter.js";
import { promoteToFinancialFactV1 } from "../metric-promoter.js";
import type { FinancialTable } from "../table-detector.js";

// ─── Test fixtures ─────────────────────────────────────────────────────────────

const INCOME_TABLE: FinancialTable = {
  sheet_name:       "P&L",
  table_kind:       "income_statement",
  row_headers:      ["Revenue", "Net Income", "EBITDA"],
  column_headers:   ["2023", "2024", "2025"],
  cell_matrix: [
    [5_000_000, 7_200_000, 9_800_000],
    [  800_000, 1_200_000, 1_900_000],
    [1_100_000, 1_600_000, 2_400_000],
  ],
  source_page_type: "excel_range",
};

const SCENARIO_TABLE: FinancialTable = {
  sheet_name:      "Revenue Model",
  table_kind:      "scenario_model",
  row_headers:     ["Revenue", "ARR"],
  column_headers:  ["Base", "Upside", "Downside"],
  cell_matrix: [
    [5_000_000, 7_000_000, 4_000_000],
    [3_000_000, 4_500_000, 2_500_000],
  ],
  source_page_type: "excel_range",
};

const CURRENT_YEAR = 2025;

// ─── parseFinancialTable — temporal scope ─────────────────────────────────────

describe("parseFinancialTable — temporal scope classification", () => {
  it("assigns historical scope to past years", () => {
    const metrics = parseFinancialTable(INCOME_TABLE, {
      deal_id: "deal-001",
      currentYear: CURRENT_YEAR,
    });
    const y2023 = metrics.filter((m) => m.label?.includes("(2023)"));
    expect(y2023.length).toBeGreaterThan(0);
    for (const m of y2023) {
      expect(m.temporal_scope).toBe("historical");
      expect(m.projection_blocked).toBe(false);
    }
  });

  it("assigns current scope to current year", () => {
    const metrics = parseFinancialTable(INCOME_TABLE, {
      deal_id: "deal-001",
      currentYear: 2024,
    });
    const y2024 = metrics.filter((m) => m.label?.includes("(2024)"));
    expect(y2024.length).toBeGreaterThan(0);
    for (const m of y2024) {
      expect(m.temporal_scope).toBe("current");
    }
  });

  it("assigns projected scope to future years", () => {
    const metrics = parseFinancialTable(INCOME_TABLE, {
      deal_id: "deal-001",
      currentYear: 2024,
    });
    const y2025 = metrics.filter((m) => m.label?.includes("(2025)"));
    expect(y2025.length).toBeGreaterThan(0);
    for (const m of y2025) {
      expect(m.temporal_scope).toBe("projected");
      expect(m.projection_blocked).toBe(true);
    }
  });
});

// ─── parseFinancialTable — scenario columns ───────────────────────────────────

describe("parseFinancialTable — scenario columns", () => {
  it("assigns scenario scope + scenario label for Base/Upside/Downside cols", () => {
    const metrics = parseFinancialTable(SCENARIO_TABLE, {
      deal_id: "deal-002",
      currentYear: CURRENT_YEAR,
    });
    expect(metrics.length).toBeGreaterThan(0);
    for (const m of metrics) {
      expect(m.temporal_scope).toBe("scenario");
      expect(m.scenario).toBeDefined();
      expect(m.projection_blocked).toBe(true);
    }
  });

  it("preserves Base/Upside/Downside as scenario labels", () => {
    const metrics = parseFinancialTable(SCENARIO_TABLE, {
      deal_id: "deal-002",
      currentYear: CURRENT_YEAR,
    });
    const scenarios = new Set(metrics.map((m) => m.scenario));
    expect(scenarios).toContain("Base");
    expect(scenarios).toContain("Upside");
    expect(scenarios).toContain("Downside");
  });

  it("scenario metrics have projection_blocked=true", () => {
    const metrics = parseFinancialTable(SCENARIO_TABLE, {
      deal_id: "deal-002",
      currentYear: CURRENT_YEAR,
    });
    for (const m of metrics) {
      expect(m.projection_blocked).toBe(true);
    }
  });
});

// ─── parseFinancialTable — field type mapping ─────────────────────────────────

describe("parseFinancialTable — field_type mapping", () => {
  it("maps Revenue row to revenue_canonical_v1", () => {
    const metrics = parseFinancialTable(INCOME_TABLE, { deal_id: "d1", currentYear: CURRENT_YEAR });
    const rev = metrics.filter((m) => m.field_type === "revenue_canonical_v1");
    expect(rev.length).toBeGreaterThan(0);
  });

  it("maps Net Income row to ebitda_v1", () => {
    const metrics = parseFinancialTable(INCOME_TABLE, { deal_id: "d1", currentYear: CURRENT_YEAR });
    const ebitda = metrics.filter((m) => m.field_type === "ebitda_v1" && m.label?.startsWith("Net Income"));
    expect(ebitda.length).toBeGreaterThan(0);
  });

  it("maps EBITDA row to ebitda_v1", () => {
    const metrics = parseFinancialTable(INCOME_TABLE, { deal_id: "d1", currentYear: CURRENT_YEAR });
    const ebitda = metrics.filter((m) => m.field_type === "ebitda_v1" && m.label?.startsWith("EBITDA"));
    expect(ebitda.length).toBeGreaterThan(0);
  });

  it("maps ARR row to arr_v1", () => {
    const metrics = parseFinancialTable(SCENARIO_TABLE, { deal_id: "d1", currentYear: CURRENT_YEAR });
    const arr = metrics.filter((m) => m.field_type === "arr_v1");
    expect(arr.length).toBeGreaterThan(0);
  });
});

// ─── parseFinancialTable — null cell skipping ─────────────────────────────────

describe("parseFinancialTable — null cells are skipped", () => {
  it("does not emit TypedMetric for null cell", () => {
    const tableWithNull: FinancialTable = {
      ...INCOME_TABLE,
      cell_matrix: [
        [5_000_000, null, 9_800_000],
        [  800_000, 1_200_000, null],
        [  null,    1_600_000, 2_400_000],
      ],
    };
    const metrics = parseFinancialTable(tableWithNull, { deal_id: "d1", currentYear: CURRENT_YEAR });
    // Total cells = 3 rows × 3 cols = 9; 3 nulls; expect 6
    expect(metrics).toHaveLength(6);
  });
});

// ─── promoteToFinancialFactV1 ────────────────────────────────────────────────

describe("promoteToFinancialFactV1", () => {
  it("produces a FinancialFactV1 for each non-null TypedMetric", () => {
    const metrics = parseFinancialTable(INCOME_TABLE, { deal_id: "deal-abc", currentYear: CURRENT_YEAR });
    const facts = promoteToFinancialFactV1(metrics, {
      deal_id: "deal-abc",
      document_id: "doc-xyz",
      sheet_name: "P&L",
    });
    expect(facts.length).toBe(metrics.length);
  });

  it("fact_id follows the factv1: prefix pattern", () => {
    const metrics = parseFinancialTable(INCOME_TABLE, { deal_id: "d1", currentYear: CURRENT_YEAR });
    const [fact] = promoteToFinancialFactV1(metrics, { deal_id: "d1" });
    expect(fact!.fact_id).toMatch(/^factv1:/);
  });

  it("fact_id is deterministic for identical inputs", () => {
    const metrics = parseFinancialTable(INCOME_TABLE, { deal_id: "d1", currentYear: CURRENT_YEAR });
    const facts1 = promoteToFinancialFactV1(metrics, { deal_id: "d1", sheet_name: "P&L" });
    const facts2 = promoteToFinancialFactV1(metrics, { deal_id: "d1", sheet_name: "P&L" });
    for (let i = 0; i < facts1.length; i++) {
      expect(facts1[i]!.fact_id).toBe(facts2[i]!.fact_id);
    }
  });

  it("propagates temporal_scope from TypedMetric", () => {
    const metrics = parseFinancialTable(INCOME_TABLE, { deal_id: "d1", currentYear: 2024 });
    const facts = promoteToFinancialFactV1(metrics, { deal_id: "d1" });
    const hist = facts.filter((f) => f.temporal_scope === "historical");
    const proj = facts.filter((f) => f.temporal_scope === "projected");
    expect(hist.length).toBeGreaterThan(0);
    expect(proj.length).toBeGreaterThan(0);
  });

  it("propagates scenario label for scenario facts", () => {
    const metrics = parseFinancialTable(SCENARIO_TABLE, { deal_id: "d1", currentYear: CURRENT_YEAR });
    const facts = promoteToFinancialFactV1(metrics, { deal_id: "d1" });
    for (const f of facts) {
      expect(f.scenario).toBeDefined();
      expect(["Base", "Upside", "Downside"]).toContain(f.scenario);
      expect(f.temporal_scope).toBe("scenario");
    }
  });

  it("metric_key for Revenue facts is 'revenue'", () => {
    const metrics = parseFinancialTable(INCOME_TABLE, { deal_id: "d1", currentYear: CURRENT_YEAR });
    const facts = promoteToFinancialFactV1(metrics, { deal_id: "d1" });
    const revFacts = facts.filter((f) => f.metric_key === "revenue");
    expect(revFacts.length).toBeGreaterThan(0);
  });

  it("confidence is high when typing_confidence >= 0.70", () => {
    const metrics = parseFinancialTable(INCOME_TABLE, { deal_id: "d1", currentYear: CURRENT_YEAR });
    const highConf = metrics.filter((m) => m.typing_confidence >= 0.70);
    const facts = promoteToFinancialFactV1(highConf, { deal_id: "d1" });
    for (const f of facts) {
      expect(f.confidence).toBe("high");
    }
  });

  it("source_kind is xlsx by default", () => {
    const metrics = parseFinancialTable(INCOME_TABLE, { deal_id: "d1", currentYear: CURRENT_YEAR });
    const facts = promoteToFinancialFactV1(metrics, { deal_id: "d1" });
    for (const f of facts) {
      expect(f.source_kind).toBe("xlsx");
    }
  });
});

// ─── parseFinancialTable — unit scaling ───────────────────────────────────────

/**
 * Fixtures for unit scaling tests.
 * Raw cell values are small integers (5, 7, 1, 2) — clearly "in thousands" or
 * "in millions" workbooks.  After scaling they become the absolute values that
 * downstream facts should carry.
 */
const IN_THOUSANDS_TABLE: FinancialTable = {
  sheet_name:       "P&L (in thousands)",
  table_kind:       "income_statement",
  row_headers:      ["Revenue", "Net Income"],
  column_headers:   ["2023", "2024"],
  cell_matrix: [
    [5, 7],
    [1, 2],
  ],
  source_page_type: "excel_range",
  unit_scale_factor: 1_000,
  unit_scale_source_text: "in thousands",
};

const IN_MILLIONS_TABLE: FinancialTable = {
  sheet_name:       "Financial Summary",
  table_kind:       "income_statement",
  row_headers:      ["Revenue", "Net Income"],
  column_headers:   ["2023", "2024"],
  cell_matrix: [
    [50, 75],
    [ 5, 10],
  ],
  source_page_type: "excel_range",
  unit_scale_factor: 1_000_000,
  unit_scale_source_text: "in millions",
};

describe("parseFinancialTable — unit scaling (×1000)", () => {
  it("multiplies metric values by 1000 when unit_scale_factor=1000", () => {
    const metrics = parseFinancialTable(IN_THOUSANDS_TABLE, { deal_id: "d1", currentYear: CURRENT_YEAR });
    const revMetrics = metrics.filter((m) => m.field_type === "revenue_canonical_v1");
    expect(revMetrics.length).toBeGreaterThan(0);
    const values = revMetrics.map((m) => m.value);
    expect(values).toContain(5_000);  // 5 × 1000
    expect(values).toContain(7_000);  // 7 × 1000
  });

  it("does not emit the raw pre-scale value when scaled", () => {
    const metrics = parseFinancialTable(IN_THOUSANDS_TABLE, { deal_id: "d1", currentYear: CURRENT_YEAR });
    const revMetrics = metrics.filter((m) => m.field_type === "revenue_canonical_v1");
    const values = revMetrics.map((m) => m.value);
    // Raw cell values 5 and 7 must not appear — they must have been scaled
    expect(values).not.toContain(5);
    expect(values).not.toContain(7);
  });

  it("includes unit_scale_factor annotation in typing_reason", () => {
    const metrics = parseFinancialTable(IN_THOUSANDS_TABLE, { deal_id: "d1", currentYear: CURRENT_YEAR });
    for (const m of metrics) {
      expect(m.typing_reason).toContain("unit_scale_factor=1000");
      expect(m.typing_reason).toContain('source: "in thousands"');
    }
  });

  it("encodes scale multiplier in value_raw (e.g. '5 [×1000]')", () => {
    const metrics = parseFinancialTable(IN_THOUSANDS_TABLE, { deal_id: "d1", currentYear: CURRENT_YEAR });
    for (const m of metrics) {
      expect(m.value_raw).toMatch(/\[×1000\]/);
    }
  });

  it("fact_ids are unique (scaled value_raw creates distinct source_pointer)", () => {
    const metrics = parseFinancialTable(IN_THOUSANDS_TABLE, { deal_id: "d1", currentYear: CURRENT_YEAR });
    const facts = promoteToFinancialFactV1(metrics, { deal_id: "d1" });
    const ids = facts.map((f) => f.fact_id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("parseFinancialTable — unit scaling (×1_000_000)", () => {
  it("multiplies metric values by 1_000_000 when unit_scale_factor=1_000_000", () => {
    const metrics = parseFinancialTable(IN_MILLIONS_TABLE, { deal_id: "d1", currentYear: CURRENT_YEAR });
    const revMetrics = metrics.filter((m) => m.field_type === "revenue_canonical_v1");
    expect(revMetrics.length).toBeGreaterThan(0);
    const values = revMetrics.map((m) => m.value);
    expect(values).toContain(50_000_000);  // 50 × 1_000_000
    expect(values).toContain(75_000_000);  // 75 × 1_000_000
  });

  it("includes unit_scale_factor=1000000 annotation in typing_reason", () => {
    const metrics = parseFinancialTable(IN_MILLIONS_TABLE, { deal_id: "d1", currentYear: CURRENT_YEAR });
    for (const m of metrics) {
      expect(m.typing_reason).toContain("unit_scale_factor=1000000");
      expect(m.typing_reason).toContain('source: "in millions"');
    }
  });

  it("encodes scale multiplier in value_raw (e.g. '50 [×1000000]')", () => {
    const metrics = parseFinancialTable(IN_MILLIONS_TABLE, { deal_id: "d1", currentYear: CURRENT_YEAR });
    for (const m of metrics) {
      expect(m.value_raw).toMatch(/\[×1000000\]/);
    }
  });
});

describe("parseFinancialTable — no scaling (unit_scale_factor absent or 1)", () => {
  it("leaves values unchanged when unit_scale_factor is absent", () => {
    // INCOME_TABLE has no unit_scale_factor field — identical to factor=1
    const metrics = parseFinancialTable(INCOME_TABLE, { deal_id: "d1", currentYear: CURRENT_YEAR });
    const revMetrics = metrics.filter((m) => m.field_type === "revenue_canonical_v1");
    const values = revMetrics.map((m) => m.value);
    expect(values).toContain(5_000_000);
    expect(values).toContain(7_200_000);
    expect(values).toContain(9_800_000);
  });

  it("leaves values unchanged when unit_scale_factor=1 (explicit identity)", () => {
    const explicitlyUnscaled: FinancialTable = {
      ...INCOME_TABLE,
      unit_scale_factor: 1,
      unit_scale_source_text: null,
    };
    const metrics = parseFinancialTable(explicitlyUnscaled, { deal_id: "d1", currentYear: CURRENT_YEAR });
    const revMetrics = metrics.filter((m) => m.field_type === "revenue_canonical_v1");
    const values = revMetrics.map((m) => m.value);
    expect(values).toContain(5_000_000);
    expect(values).toContain(7_200_000);
  });

  it("value_raw has no [×...] annotation when unscaled", () => {
    const metrics = parseFinancialTable(INCOME_TABLE, { deal_id: "d1", currentYear: CURRENT_YEAR });
    for (const m of metrics) {
      expect(m.value_raw).not.toContain("[×");
    }
  });

  it("typing_reason has no unit_scale_factor annotation when unscaled", () => {
    const metrics = parseFinancialTable(INCOME_TABLE, { deal_id: "d1", currentYear: CURRENT_YEAR });
    for (const m of metrics) {
      expect(m.typing_reason).not.toContain("unit_scale_factor");
    }
  });
});

// ─── promoteToFinancialFactV1 — valuation_v1 → pre_money_valuation ───────────

const VALUATION_TABLE: FinancialTable = {
  sheet_name:       "Cap Table",
  table_kind:       "other",
  row_headers:      ["Valuation", "Post-Money Valuation", "Pre-Money Valuation"],
  column_headers:   ["2026"],
  cell_matrix:      [[25_000_000], [30_000_000], [22_000_000]],
  source_page_type: "excel_range",
};

describe("promoteToFinancialFactV1 — valuation_v1 → pre_money_valuation (bug fix)", () => {
  it("maps bare 'Valuation' row to pre_money_valuation (not 'valuation')", () => {
    const metrics = parseFinancialTable(VALUATION_TABLE, { deal_id: "d1", currentYear: CURRENT_YEAR });
    const facts = promoteToFinancialFactV1(metrics, { deal_id: "d1" });
    const valFact = facts.find(
      (f) => f.metric_label?.toLowerCase() === "valuation (2026)"
    );
    expect(valFact?.metric_key).toBe("pre_money_valuation");
  });

  it("maps 'Post-Money Valuation' row to post_money_valuation (label-aware)", () => {
    const metrics = parseFinancialTable(VALUATION_TABLE, { deal_id: "d1", currentYear: CURRENT_YEAR });
    const facts = promoteToFinancialFactV1(metrics, { deal_id: "d1" });
    const postFact = facts.find(
      (f) => f.metric_label?.toLowerCase().startsWith("post-money valuation")
    );
    expect(postFact?.metric_key).toBe("post_money_valuation");
  });

  it("maps 'Pre-Money Valuation' row to pre_money_valuation", () => {
    const metrics = parseFinancialTable(VALUATION_TABLE, { deal_id: "d1", currentYear: CURRENT_YEAR });
    const facts = promoteToFinancialFactV1(metrics, { deal_id: "d1" });
    const preFact = facts.find(
      (f) => f.metric_label?.toLowerCase().startsWith("pre-money valuation")
    );
    expect(preFact?.metric_key).toBe("pre_money_valuation");
  });
});

// ─── Guardrail: payroll row suppression (G5) ─────────────────────────────────

describe("parseFinancialTable — payroll row suppression (G5)", () => {
  it("maps 'Sales 1' row to opex_v1, not revenue_canonical_v1", () => {
    const table: FinancialTable = {
      sheet_name: "Headcount",
      table_kind: "income_statement",
      row_headers: ["Sales 1", "Sales 2", "Revenue"],
      column_headers: ["2024", "2025"],
      cell_matrix: [
        [80_000, 90_000],
        [75_000, 85_000],
        [2_000_000, 3_000_000],
      ],
      source_page_type: "excel_range",
    };
    const metrics = parseFinancialTable(table, { deal_id: "d-g5", currentYear: CURRENT_YEAR });
    const sales1 = metrics.filter((m) => m.label?.startsWith("Sales 1"));
    expect(sales1.length).toBeGreaterThan(0);
    for (const m of sales1) {
      expect(m.field_type).toBe("opex_v1");
      expect(m.field_type).not.toBe("revenue_canonical_v1");
    }
  });

  it("maps 'Sales 2' row to opex_v1", () => {
    const table: FinancialTable = {
      sheet_name: "Headcount",
      table_kind: "income_statement",
      row_headers: ["Sales 2"],
      column_headers: ["2024"],
      cell_matrix: [[75_000]],
      source_page_type: "excel_range",
    };
    const metrics = parseFinancialTable(table, { deal_id: "d-g5b", currentYear: CURRENT_YEAR });
    expect(metrics[0]?.field_type).toBe("opex_v1");
  });

  it("still maps bare 'Sales' row to revenue_canonical_v1 (unchanged)", () => {
    const table: FinancialTable = {
      sheet_name: "P&L",
      table_kind: "income_statement",
      row_headers: ["Sales"],
      column_headers: ["2024"],
      cell_matrix: [[5_000_000]],
      source_page_type: "excel_range",
    };
    const metrics = parseFinancialTable(table, { deal_id: "d-g5c", currentYear: CURRENT_YEAR });
    expect(metrics[0]?.field_type).toBe("revenue_canonical_v1");
  });
});

// ─── Guardrail: year-label suppression (G1) ──────────────────────────────────

describe("parseFinancialTable — year-label suppression (G1)", () => {
  it("does not emit a TypedMetric for a cell whose raw value is a calendar year (2025)", () => {
    const table: FinancialTable = {
      sheet_name: "Summary",
      table_kind: "income_statement",
      row_headers: ["Target Year", "Revenue"],
      column_headers: ["Plan"],
      cell_matrix: [
        [2025],         // year label — should be suppressed
        [5_000_000],    // real revenue — should be kept
      ],
      source_page_type: "excel_range",
    };
    const metrics = parseFinancialTable(table, { deal_id: "d-g1", currentYear: CURRENT_YEAR });
    const yearMetrics = metrics.filter((m) => m.value === 2025);
    expect(yearMetrics).toHaveLength(0);
  });

  it("does not emit a TypedMetric for cell values 2020 through 2040 (full range)", () => {
    const yearValues = [2020, 2021, 2022, 2023, 2024, 2026, 2027, 2030, 2035, 2040];
    const table: FinancialTable = {
      sheet_name: "Summary",
      table_kind: "income_statement",
      row_headers: yearValues.map((y) => `Year ${y}`),
      column_headers: ["Value"],
      cell_matrix: yearValues.map((y) => [y]),
      source_page_type: "excel_range",
    };
    const metrics = parseFinancialTable(table, { deal_id: "d-g1b", currentYear: CURRENT_YEAR });
    expect(metrics).toHaveLength(0);
  });

  it("does NOT suppress 2019 (outside the guarded range)", () => {
    const table: FinancialTable = {
      sheet_name: "History",
      table_kind: "income_statement",
      row_headers: ["Revenue"],
      column_headers: ["Value"],
      cell_matrix: [[2019]],
      source_page_type: "excel_range",
    };
    const metrics = parseFinancialTable(table, { deal_id: "d-g1c", currentYear: CURRENT_YEAR });
    // 2019 is outside 2020–2040 — kept (even if it seems small, that's the extractor's job)
    const kept = metrics.filter((m) => m.value === 2019);
    expect(kept.length).toBeGreaterThan(0);
  });

  it("still emits real revenue figures alongside suppressed year cells", () => {
    const table: FinancialTable = {
      sheet_name: "Summary",
      table_kind: "income_statement",
      row_headers: ["Target Year", "Revenue"],
      column_headers: ["Plan"],
      cell_matrix: [
        [2025],
        [8_000_000],
      ],
      source_page_type: "excel_range",
    };
    const metrics = parseFinancialTable(table, { deal_id: "d-g1d", currentYear: CURRENT_YEAR });
    const revMetrics = metrics.filter((m) => m.field_type === "revenue_canonical_v1" || m.field_type === "other_metric_v1");
    // The $8M revenue row must survive
    expect(metrics.some((m) => m.value === 8_000_000)).toBe(true);
    // The year row must not appear
    expect(metrics.some((m) => m.value === 2025)).toBe(false);
  });
});

// ─── Cap-table sheet suppression (Fix 12 / StackFactor) ──────────────────────

describe("parseFinancialTable — cap_table sheet suppression (Fix 12)", () => {
  const CAP_TABLE: FinancialTable = {
    sheet_name: "Cap Table",
    table_kind: "cap_table",
    row_headers: ["Revenue", "ARR", "Common Shares", "Series A Preferred", "Option Pool", "Net Income"],
    column_headers: ["2024", "2025"],
    cell_matrix: [
      [1_000_000, 2_000_000],   // Revenue row — must be suppressed
      [  800_000, 1_600_000],   // ARR row — must be suppressed
      [5_000_000, 5_000_000],   // Common Shares
      [2_000_000, 2_500_000],   // Series A Preferred
      [  500_000,   600_000],   // Option Pool
      [  100_000,   250_000],   // Net Income — must be suppressed (ebitda_v1)
    ],
    source_page_type: "excel_sheet",
  };

  it("suppresses revenue_canonical_v1 metrics from cap_table sheets", () => {
    const metrics = parseFinancialTable(CAP_TABLE, { deal_id: "d-cap", currentYear: CURRENT_YEAR });
    const revMetrics = metrics.filter((m) => m.field_type === "revenue_canonical_v1");
    expect(revMetrics).toHaveLength(0);
  });

  it("suppresses arr_v1 metrics from cap_table sheets", () => {
    const metrics = parseFinancialTable(CAP_TABLE, { deal_id: "d-cap", currentYear: CURRENT_YEAR });
    const arrMetrics = metrics.filter((m) => m.field_type === "arr_v1");
    expect(arrMetrics).toHaveLength(0);
  });

  it("suppresses ebitda_v1 (Net Income) metrics from cap_table sheets", () => {
    const metrics = parseFinancialTable(CAP_TABLE, { deal_id: "d-cap", currentYear: CURRENT_YEAR });
    const ebitdaMetrics = metrics.filter((m) => m.field_type === "ebitda_v1");
    expect(ebitdaMetrics).toHaveLength(0);
  });

  it("still emits other_metric_v1 rows from cap_table (share counts etc.)", () => {
    const metrics = parseFinancialTable(CAP_TABLE, { deal_id: "d-cap", currentYear: CURRENT_YEAR });
    // Common Shares / Series A / Option Pool are other_metric_v1 — should survive
    const otherMetrics = metrics.filter((m) => m.field_type === "other_metric_v1");
    expect(otherMetrics.length).toBeGreaterThan(0);
  });

  it("does NOT suppress revenue from income_statement sheets (control check)", () => {
    const incomeTable: FinancialTable = {
      sheet_name: "P&L",
      table_kind: "income_statement",
      row_headers: ["Revenue", "ARR"],
      column_headers: ["2024", "2025"],
      cell_matrix: [[1_000_000, 2_000_000], [800_000, 1_600_000]],
      source_page_type: "excel_sheet",
    };
    const metrics = parseFinancialTable(incomeTable, { deal_id: "d-income", currentYear: CURRENT_YEAR });
    const revMetrics = metrics.filter((m) => m.field_type === "revenue_canonical_v1");
    expect(revMetrics.length).toBeGreaterThan(0);
  });
});

// ─── isStructuralPeriodLabel → metric-promoter drop guard (Fix 12) ───────────

describe("promoteToFinancialFactV1 — structural period label suppression (Fix 12)", () => {
  it("drops facts with col_X period labels (belt-and-suspenders)", () => {
    // A table with structural column headers produces metrics with col_C / col_D labels.
    // Even if somehow the table-detector guard was bypassed, metric-promoter suppresses these.
    const tableWithColXHeaders: FinancialTable = {
      sheet_name: "Salary",
      table_kind: "unknown",
      row_headers: ["Revenue", "EBITDA"],
      column_headers: ["col_C", "col_D", "col_M"],
      cell_matrix: [
        [100_000, 200_000, 300_000],
        [ 10_000,  20_000,  30_000],
      ],
      source_page_type: "excel_range",
    };
    const metrics = parseFinancialTable(tableWithColXHeaders, { deal_id: "d-colx", currentYear: CURRENT_YEAR });
    const facts = promoteToFinancialFactV1(metrics, { deal_id: "d-colx" });
    const revFacts = facts.filter((f) => f.metric_key === "revenue");
    expect(revFacts).toHaveLength(0);
  });

  it("drops facts with $000 period labels", () => {
    const tableWith000Headers: FinancialTable = {
      sheet_name: "Report",
      table_kind: "income_statement",
      row_headers: ["Revenue"],
      column_headers: ["$000", "000s"],
      cell_matrix: [[5_000, 5_000]],
      source_page_type: "excel_sheet",
    };
    const metrics = parseFinancialTable(tableWith000Headers, { deal_id: "d-000", currentYear: CURRENT_YEAR });
    const facts = promoteToFinancialFactV1(metrics, { deal_id: "d-000" });
    const revFacts = facts.filter((f) => f.metric_key === "revenue");
    expect(revFacts).toHaveLength(0);
  });

  it("preserves facts with legitimate annual period labels", () => {
    const validTable: FinancialTable = {
      sheet_name: "P&L",
      table_kind: "income_statement",
      row_headers: ["Revenue"],
      column_headers: ["2024", "2025"],
      cell_matrix: [[1_000_000, 2_000_000]],
      source_page_type: "excel_range",
    };
    const metrics = parseFinancialTable(validTable, { deal_id: "d-valid", currentYear: CURRENT_YEAR });
    const facts = promoteToFinancialFactV1(metrics, { deal_id: "d-valid" });
    const revFacts = facts.filter((f) => f.metric_key === "revenue");
    expect(revFacts).toHaveLength(2);
    expect(revFacts[0]!.period_label).toBe("2024");
    expect(revFacts[1]!.period_label).toBe("2025");
  });
});
