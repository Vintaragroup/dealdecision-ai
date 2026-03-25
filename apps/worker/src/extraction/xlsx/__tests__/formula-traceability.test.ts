/**
 * formula-traceability.test.ts
 *
 * Tests for Excel formula metadata preservation across the full extraction
 * pipeline:
 *
 *   DPU payload (with formula_grid)
 *     → detectFinancialTables → FinancialTable.formula_map
 *     → parseFinancialTable → TypedMetric.value_kind / .formula
 *     → promoteToFinancialFactV1 → FinancialFactV1.value_kind / .formula
 *
 * Coverage:
 *  1.  excel_sheet payload with formula_grid → FinancialTable.formula_map populated
 *  2.  excel_sheet payload WITHOUT formula_grid → formula_map absent (undefined)
 *  3.  excel_range payload → formula_map absent (format carries no formula info)
 *  4.  parseFinancialTable with formula_map → TypedMetric has value_kind="formula" for formula cells
 *  5.  parseFinancialTable with formula_map → TypedMetric has value_kind="literal" for literal cells
 *  6.  parseFinancialTable without formula_map → TypedMetric omits value_kind (unknown)
 *  7.  promoteToFinancialFactV1 → FinancialFactV1 retains formula string + value_kind
 *  8.  promoteToFinancialFactV1 → literal cell retains value_kind="literal", no formula field
 *  9.  promoteToFinancialFactV1 → fact_id unchanged by formula presence (source_pointer stable)
 * 10.  Mixed row: some cells formula, some literal — each cell tracked independently
 */

import { describe, it, expect } from "vitest";
import { detectFinancialTables } from "../table-detector.js";
import { parseFinancialTable } from "../financial-model-interpreter.js";
import { promoteToFinancialFactV1 } from "../metric-promoter.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/**
 * An excel_sheet DPU payload that carries formula_grid metadata.
 *
 * Row 0 = Revenue: FY2023 value is literal; FY2024 value is formula-derived.
 * Row 1 = EBITDA: both FY2023 and FY2024 are formula-derived.
 * Row 2 = Burn:   both literal.
 *
 * formula_grid keys: "rawRowIndex:headerName" (0-based within rows[]).
 */
const PAYLOAD_WITH_FORMULAS = {
  page_type: "excel_sheet",
  structured: {
    sheet_title: "P&L",
    headers: ["Metric", "FY2023", "FY2024"],
    rows: [
      // rawRowIdx 0
      { Metric: "Revenue",  FY2023: 4_000_000, FY2024: 6_500_000 },
      // rawRowIdx 1
      { Metric: "EBITDA",   FY2023: 400_000,   FY2024: 800_000   },
      // rawRowIdx 2
      { Metric: "Burn rate", FY2023: 150_000,  FY2024: 200_000   },
    ],
    tables: [],
    // FY2024 Revenue is formula-derived. Both EBITDA columns are formula-derived.
    formula_grid: {
      "0:FY2024": "=FY2023_Revenue*1.625",    // Revenue FY2024
      "1:FY2023": "=C5-C6",                    // EBITDA FY2023
      "1:FY2024": "=D5-D6",                    // EBITDA FY2024
      // Row 2 (Burn rate) — no entries → both cells are literal
    },
  },
};

/**
 * Same shape but no formula_grid in the payload.
 */
const PAYLOAD_NO_FORMULA_GRID = {
  page_type: "excel_sheet",
  structured: {
    sheet_title: "P&L",
    headers: ["Metric", "FY2023", "FY2024"],
    rows: [
      { Metric: "Revenue", FY2023: 4_000_000, FY2024: 6_500_000 },
      { Metric: "EBITDA",  FY2023: 400_000,   FY2024: 800_000   },
    ],
    tables: [],
    // No formula_grid field
  },
};

/**
 * Standard excel_range payload (never carries formula info).
 */
const PAYLOAD_EXCEL_RANGE = {
  page_type: "excel_range",
  structured: {
    sheet_title: "Income",
    rows_preview: [
      { col_A: null,       col_C: 2023,       col_D: 2024       },
      { col_A: "Revenue",  col_C: 4_000_000,  col_D: 6_500_000  },
      { col_A: "EBITDA",   col_C: 400_000,    col_D: 800_000    },
    ],
  },
};

// ─── 1–3: detectFinancialTables → FinancialTable.formula_map ──────────────────

describe("detectFinancialTables — formula_map population", () => {
  it("1. excel_sheet with formula_grid → FinancialTable.formula_map includes formula cells", () => {
    const [table] = detectFinancialTables(PAYLOAD_WITH_FORMULAS);
    expect(table).toBeDefined();
    expect(table!.formula_map).toBeDefined();

    // Revenue (matrixRow 0) col FY2024 (colIdx 1) — should have formula
    expect(table!.formula_map!["0:1"]).toBe("=FY2023_Revenue*1.625");

    // EBITDA (matrixRow 1) col FY2023 (colIdx 0) — should have formula
    expect(table!.formula_map!["1:0"]).toBe("=C5-C6");

    // EBITDA (matrixRow 1) col FY2024 (colIdx 1)
    expect(table!.formula_map!["1:1"]).toBe("=D5-D6");
  });

  it("1b. literal cells NOT present in formula_map", () => {
    const [table] = detectFinancialTables(PAYLOAD_WITH_FORMULAS);
    // Revenue FY2023 (row 0, colIdx 0) is literal — must NOT be in formula_map
    expect(table!.formula_map!["0:0"]).toBeUndefined();
    // Burn rate row (matrixRow 2) — both literal
    expect(table!.formula_map!["2:0"]).toBeUndefined();
    expect(table!.formula_map!["2:1"]).toBeUndefined();
  });

  it("2. excel_sheet WITHOUT formula_grid → formula_map absent", () => {
    const [table] = detectFinancialTables(PAYLOAD_NO_FORMULA_GRID);
    expect(table).toBeDefined();
    expect(table!.formula_map).toBeUndefined();
  });

  it("3. excel_range payload → formula_map absent (format carries no formula info)", () => {
    const [table] = detectFinancialTables(PAYLOAD_EXCEL_RANGE);
    expect(table).toBeDefined();
    expect(table!.formula_map).toBeUndefined();
  });
});

// ─── 4–6: parseFinancialTable → TypedMetric formula fields ───────────────────

describe("parseFinancialTable — TypedMetric formula traceability", () => {
  const OPTS = { deal_id: "deal_test", document_id: "doc_test", currentYear: 2025 };

  it("4. formula cell → TypedMetric has value_kind='formula' and formula string", () => {
    const [table] = detectFinancialTables(PAYLOAD_WITH_FORMULAS);
    const metrics = parseFinancialTable(table!, OPTS);

    // EBITDA FY2023 — formula "=C5-C6" (matrixRow 1, colIdx 0)
    const ebitda2023 = metrics.find(
      (m) => /ebitda/i.test(m.label ?? "") && /FY2023|2023/.test(m.label ?? ""),
    );
    expect(ebitda2023).toBeDefined();
    expect(ebitda2023!.value_kind).toBe("formula");
    expect(ebitda2023!.formula).toBe("=C5-C6");
  });

  it("5. literal cell → TypedMetric has value_kind='literal', no formula field", () => {
    const [table] = detectFinancialTables(PAYLOAD_WITH_FORMULAS);
    const metrics = parseFinancialTable(table!, OPTS);

    // Revenue FY2023 — literal (matrixRow 0, colIdx 0)
    const rev2023 = metrics.find(
      (m) => /revenue/i.test(m.label ?? "") && /FY2023|2023/.test(m.label ?? ""),
    );
    expect(rev2023).toBeDefined();
    expect(rev2023!.value_kind).toBe("literal");
    expect(rev2023!.formula).toBeUndefined();
  });

  it("6. no formula_grid in payload → TypedMetric omits value_kind (unknown handled by absence)", () => {
    const [table] = detectFinancialTables(PAYLOAD_NO_FORMULA_GRID);
    const metrics = parseFinancialTable(table!, OPTS);

    // All metrics should have no value_kind (undefined, not "unknown") because
    // the field is omitted when formula_map is absent.
    expect(metrics.length).toBeGreaterThan(0);
    for (const m of metrics) {
      expect(m.value_kind).toBeUndefined();
      expect(m.formula).toBeUndefined();
    }
  });

  it("6b. excel_range payload → TypedMetric omits value_kind", () => {
    const [table] = detectFinancialTables(PAYLOAD_EXCEL_RANGE);
    const metrics = parseFinancialTable(table!, OPTS);

    expect(metrics.length).toBeGreaterThan(0);
    for (const m of metrics) {
      expect(m.value_kind).toBeUndefined();
    }
  });
});

// ─── 7–9: promoteToFinancialFactV1 → FinancialFactV1 formula retention ────────

describe("promoteToFinancialFactV1 — formula traceability in promoted facts", () => {
  const PARSE_OPTS = { deal_id: "deal_test", document_id: "doc_test", currentYear: 2025 };
  const PROMOTE_OPTS = { deal_id: "deal_test", document_id: "doc_test", sheet_name: "P&L" };

  it("7. formula cell → FinancialFactV1 retains formula and value_kind='formula'", () => {
    const [table] = detectFinancialTables(PAYLOAD_WITH_FORMULAS);
    const metrics = parseFinancialTable(table!, PARSE_OPTS);
    const facts = promoteToFinancialFactV1(metrics, PROMOTE_OPTS);

    // EBITDA FY2024 — formula "=D5-D6" (matrixRow 1, colIdx 1)
    const ebitdaFact = facts.find(
      (f) => f.metric_key === "ebitda" && /FY2024|2024/.test(f.period_label),
    );
    expect(ebitdaFact).toBeDefined();
    expect(ebitdaFact!.value_kind).toBe("formula");
    expect(ebitdaFact!.formula).toBe("=D5-D6");
  });

  it("8. literal cell → FinancialFactV1 has value_kind='literal', formula absent", () => {
    const [table] = detectFinancialTables(PAYLOAD_WITH_FORMULAS);
    const metrics = parseFinancialTable(table!, PARSE_OPTS);
    const facts = promoteToFinancialFactV1(metrics, PROMOTE_OPTS);

    // Revenue FY2023 — literal
    const revFact = facts.find(
      (f) => f.metric_key === "revenue" && /FY2023|2023/.test(f.period_label),
    );
    expect(revFact).toBeDefined();
    expect(revFact!.value_kind).toBe("literal");
    expect(revFact!.formula).toBeUndefined();
  });

  it("9. formula presence does NOT affect fact_id (source_pointer is stable)", () => {
    // Derive fact_id for the EBITDA FY2024 fact both with and without formula_grid.
    const [tableWithFormulas] = detectFinancialTables(PAYLOAD_WITH_FORMULAS);
    const [tableNoFormulas]   = detectFinancialTables(PAYLOAD_NO_FORMULA_GRID);

    const metricsWithFormulas = parseFinancialTable(tableWithFormulas!, PARSE_OPTS);
    const metricsNoFormulas   = parseFinancialTable(tableNoFormulas!,   PARSE_OPTS);

    const factsWithFormulas = promoteToFinancialFactV1(metricsWithFormulas, PROMOTE_OPTS);
    const factsNoFormulas   = promoteToFinancialFactV1(metricsNoFormulas,   PROMOTE_OPTS);

    const ebitdaWith = factsWithFormulas.find(
      (f) => f.metric_key === "ebitda" && /FY2024|2024/.test(f.period_label),
    );
    const ebitdaWithout = factsNoFormulas.find(
      (f) => f.metric_key === "ebitda" && /FY2024|2024/.test(f.period_label),
    );

    expect(ebitdaWith).toBeDefined();
    expect(ebitdaWithout).toBeDefined();
    // fact_id must be identical — formula metadata does not alter identity
    expect(ebitdaWith!.fact_id).toBe(ebitdaWithout!.fact_id);
    // But the formula fields differ
    expect(ebitdaWith!.formula).toBe("=D5-D6");
    expect(ebitdaWithout!.formula).toBeUndefined();
  });
});

// ─── 10: Mixed row — per-cell tracking ───────────────────────────────────────

describe("formula traceability — mixed literal + formula cells in same row", () => {
  it("10. Revenue row: FY2023=literal, FY2024=formula — each cell tracked independently", () => {
    const [table] = detectFinancialTables(PAYLOAD_WITH_FORMULAS);
    const OPTS = { deal_id: "deal_test", document_id: "doc_test", currentYear: 2025 };
    const metrics = parseFinancialTable(table!, OPTS);

    const rev2023 = metrics.find((m) => /revenue/i.test(m.label ?? "") && /FY2023|2023/.test(m.label ?? ""));
    const rev2024 = metrics.find((m) => /revenue/i.test(m.label ?? "") && /FY2024|2024/.test(m.label ?? ""));

    expect(rev2023).toBeDefined();
    expect(rev2024).toBeDefined();

    // FY2023 Revenue — literal (no formula_grid entry for "0:FY2023")
    expect(rev2023!.value_kind).toBe("literal");
    expect(rev2023!.formula).toBeUndefined();

    // FY2024 Revenue — formula-derived
    expect(rev2024!.value_kind).toBe("formula");
    expect(rev2024!.formula).toBe("=FY2023_Revenue*1.625");
  });
});
