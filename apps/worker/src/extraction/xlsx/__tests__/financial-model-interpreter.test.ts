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
