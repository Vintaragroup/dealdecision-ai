/**
 * __tests__/dependency-graph.test.ts
 *
 * Tests for Phase 2E: Dependency Graph and Circular Reference Analysis.
 *
 * Coverage:
 *   - parseSameSheetCellRefs() — unit tests for same-sheet formula parsing
 *   - parseAllDirectCellDeps() — unit tests for combined dep extraction
 *   - buildWorkbookGraph() — graph construction, cycle detection, depth computation
 *   - Integration: dependency metadata flows through
 *     detectFinancialTables → parseFinancialTable → promoteToFinancialFactV1
 */

import { describe, it, expect } from "vitest";
import {
  parseSameSheetCellRefs,
  parseAllDirectCellDeps,
  buildWorkbookGraph,
} from "../dependency-graph.js";
import { detectFinancialTables } from "../table-detector.js";
import { parseFinancialTable } from "../financial-model-interpreter.js";
import { promoteToFinancialFactV1 } from "../metric-promoter.js";

// ─── parseSameSheetCellRefs ───────────────────────────────────────────────────

describe("parseSameSheetCellRefs", () => {
  it("returns [] for empty string", () => {
    expect(parseSameSheetCellRefs("")).toEqual([]);
  });

  it("returns [] for a formula with only cross-sheet refs", () => {
    // Cross-tab refs are stripped before same-sheet parsing
    expect(parseSameSheetCellRefs("=Inputs!C5")).toEqual([]);
    expect(parseSameSheetCellRefs("='Revenue Build'!D12")).toEqual([]);
  });

  it("extracts direct same-sheet single-cell refs", () => {
    const refs = parseSameSheetCellRefs("=C3+D3");
    expect(refs).toContain("C3");
    expect(refs).toContain("D3");
  });

  it("excludes range endpoints (range left)", () => {
    // C3 is followed by : in C3:C17, so C3 is excluded
    const refs = parseSameSheetCellRefs("=SUM(C3:C17)");
    expect(refs).not.toContain("C3");
    expect(refs).not.toContain("C17");
  });

  it("excludes range endpoints (range right)", () => {
    // C17 is preceded by : in C3:C17, so C17 is excluded
    const refs = parseSameSheetCellRefs("C3:C17");
    expect(refs).not.toContain("C17");
  });

  it("normalizes column letters to uppercase", () => {
    const refs = parseSameSheetCellRefs("=b12+c3");
    expect(refs).toContain("B12");
    expect(refs).toContain("C3");
  });

  it("strips $ from absolute cell references", () => {
    const refs = parseSameSheetCellRefs("=$C$5+$D$12");
    expect(refs).toContain("C5");
    expect(refs).toContain("D12");
  });

  it("does not match identifiers like EBITDA12", () => {
    // EBITDA12 — A is preceded by D (a letter), so no match
    const refs = parseSameSheetCellRefs("=EBITDA12");
    expect(refs).not.toContain("A12");
    expect(refs).not.toContain("EBITDA12");
  });

  it("does not match scientific notation (1E5)", () => {
    // E is preceded by 1 (a digit) in 1E5 — should not match as cell E5
    const refs = parseSameSheetCellRefs("=1E5");
    expect(refs).not.toContain("E5");
  });

  it("does not double-count cross-sheet refs as same-sheet", () => {
    // =Inputs!C5 + D3 — C5 is cross-sheet, D3 is same-sheet
    const refs = parseSameSheetCellRefs("=Inputs!C5+D3");
    expect(refs).toContain("D3");
    expect(refs).not.toContain("C5"); // C5 belongs to cross-sheet ref
  });

  it("handles multiple same-sheet refs in an IF formula", () => {
    // IF(Assumptions!B2>0, D12, E12) — D12 and E12 are same-sheet; B2 is cross-sheet
    const refs = parseSameSheetCellRefs("IF(Assumptions!B2>0,D12,E12)");
    expect(refs).toContain("D12");
    expect(refs).toContain("E12");
    expect(refs).not.toContain("B2");
  });

  it("deduplicates the same cell if it appears multiple times", () => {
    const refs = parseSameSheetCellRefs("=C5+C5*2");
    const c5Count = refs.filter((r) => r === "C5").length;
    expect(c5Count).toBe(1);
  });
});

// ─── parseAllDirectCellDeps ───────────────────────────────────────────────────

describe("parseAllDirectCellDeps", () => {
  it("returns [] for an empty formula", () => {
    expect(parseAllDirectCellDeps("", "Sheet1")).toEqual([]);
  });

  it("returns [] for empty currentSheet", () => {
    expect(parseAllDirectCellDeps("=C5", "")).toEqual([]);
  });

  it("extracts a single cross-sheet dependency", () => {
    const deps = parseAllDirectCellDeps("=Inputs!C5", "Revenue");
    expect(deps).toHaveLength(1);
    expect(deps[0]).toEqual({ sheet: "Inputs", cell: "C5" });
  });

  it("extracts a single same-sheet dependency", () => {
    const deps = parseAllDirectCellDeps("=D12", "Revenue");
    expect(deps).toHaveLength(1);
    expect(deps[0]).toEqual({ sheet: "Revenue", cell: "D12" });
  });

  it("extracts both same-sheet and cross-sheet deps from a mixed formula", () => {
    const deps = parseAllDirectCellDeps("=Inputs!C5+D3", "Revenue");
    expect(deps).toHaveLength(2);
    const sheets = deps.map((d) => d.sheet);
    expect(sheets).toContain("Inputs");
    expect(sheets).toContain("Revenue");
  });

  it("extracts quoted sheet name cross-sheet dep", () => {
    const deps = parseAllDirectCellDeps("='Revenue Build'!D12", "Model");
    expect(deps).toHaveLength(1);
    expect(deps[0]).toEqual({ sheet: "Revenue Build", cell: "D12" });
  });

  it("does not expand range references", () => {
    // SUM(Model!C3:C10) — range ref, not a direct dep
    const deps = parseAllDirectCellDeps("=SUM(Model!C3:C10)", "Revenue");
    expect(deps).toHaveLength(0);
  });

  it("deduplicates cross-sheet and same-sheet refs", () => {
    // If same sheet ref could collide with cross-sheet, dedup prevents double-entry
    const deps = parseAllDirectCellDeps("=C5+C5", "Sheet1");
    const c5Entries = deps.filter((d) => d.cell === "C5" && d.sheet === "Sheet1");
    expect(c5Entries).toHaveLength(1);
  });
});

// ─── buildWorkbookGraph ───────────────────────────────────────────────────────

describe("buildWorkbookGraph", () => {
  it("returns empty graph for no input", () => {
    const graph = buildWorkbookGraph([]);
    expect(graph.circular_cells).toEqual([]);
    expect(graph.cell_depths).toEqual({});
  });

  it("returns empty graph for sheets with no formula cells", () => {
    const graph = buildWorkbookGraph([{ sheet: "Sheet1", cells: [] }]);
    expect(graph.circular_cells).toEqual([]);
    expect(graph.cell_depths).toEqual({});
  });

  it("computes depth 1 for a formula depending only on literals", () => {
    // Sheet1!C5 formula depends on Sheet1!B2 and Sheet1!B3, which have no formulas
    const graph = buildWorkbookGraph([
      {
        sheet: "Model",
        cells: [{ addr: "C5", formula: "=B2+B3" }],
      },
    ]);
    // B2 and B3 are not in adjacency (not formula cells) → depth 0 (literal)
    expect(graph.cell_depths["Model!C5"]).toBe(1);
    expect(graph.circular_cells).toHaveLength(0);
  });

  it("computes depth 2 for a formula depending on a depth-1 formula", () => {
    // A5 = B3 + C3 (depth 1), D5 = A5 (depth 2)
    const graph = buildWorkbookGraph([
      {
        sheet: "Sheet1",
        cells: [
          { addr: "A5", formula: "=B3+C3" }, // depends on literals → depth 1
          { addr: "D5", formula: "=A5" },     // depends on A5 (depth 1) → depth 2
        ],
      },
    ]);
    expect(graph.cell_depths["Sheet1!A5"]).toBe(1);
    expect(graph.cell_depths["Sheet1!D5"]).toBe(2);
  });

  it("handles cross-sheet edges in depth computation", () => {
    // Inputs!C5 is a literal; Revenue!B3 depends on Inputs!C5 → depth 1
    const graph = buildWorkbookGraph([
      {
        sheet: "Revenue",
        cells: [{ addr: "B3", formula: "=Inputs!C5" }],
      },
    ]);
    expect(graph.cell_depths["Revenue!B3"]).toBe(1);
  });

  it("detects a simple circular reference (A → B → A)", () => {
    // A1 depends on B1, B1 depends on A1 — direct cycle
    const graph = buildWorkbookGraph([
      {
        sheet: "Sheet1",
        cells: [
          { addr: "A1", formula: "=B1" },
          { addr: "B1", formula: "=A1" },
        ],
      },
    ]);
    expect(graph.circular_cells).toContain("Sheet1!A1");
    expect(graph.circular_cells).toContain("Sheet1!B1");
  });

  it("detects a three-node circular reference (A → B → C → A)", () => {
    const graph = buildWorkbookGraph([
      {
        sheet: "Worksheet",
        cells: [
          { addr: "A1", formula: "=B1" },
          { addr: "B1", formula: "=C1" },
          { addr: "C1", formula: "=A1" },
        ],
      },
    ]);
    expect(graph.circular_cells).toContain("Worksheet!A1");
    expect(graph.circular_cells).toContain("Worksheet!B1");
    expect(graph.circular_cells).toContain("Worksheet!C1");
  });

  it("does not flag a non-circular chain as circular", () => {
    // A → B → C (linear chain — no cycle)
    const graph = buildWorkbookGraph([
      {
        sheet: "Sheet1",
        cells: [
          { addr: "A1", formula: "=B1" },
          { addr: "B1", formula: "=C1" },
          // C1 has no formula — literal leaf
        ],
      },
    ]);
    expect(graph.circular_cells).toHaveLength(0);
    expect(graph.cell_depths["Sheet1!B1"]).toBe(1);
    expect(graph.cell_depths["Sheet1!A1"]).toBe(2);
  });

  it("excludes circular nodes from cell_depths", () => {
    const graph = buildWorkbookGraph([
      {
        sheet: "Sheet1",
        cells: [
          { addr: "A1", formula: "=B1" },
          { addr: "B1", formula: "=A1" },
          { addr: "C1", formula: "=D1" }, // not circular; D1 is a literal
        ],
      },
    ]);
    expect(graph.circular_cells).toContain("Sheet1!A1");
    expect(graph.circular_cells).toContain("Sheet1!B1");
    // Circular nodes are NOT in cell_depths
    expect(graph.cell_depths["Sheet1!A1"]).toBeUndefined();
    expect(graph.cell_depths["Sheet1!B1"]).toBeUndefined();
    // Non-circular node IS in cell_depths
    expect(graph.cell_depths["Sheet1!C1"]).toBe(1);
  });

  it("handles cross-sheet circular references", () => {
    // Revenue!C5 depends on Inputs!D3, which depends on Revenue!C5
    const graph = buildWorkbookGraph([
      {
        sheet: "Revenue",
        cells: [{ addr: "C5", formula: "=Inputs!D3" }],
      },
      {
        sheet: "Inputs",
        cells: [{ addr: "D3", formula: "=Revenue!C5" }],
      },
    ]);
    expect(graph.circular_cells).toContain("Revenue!C5");
    expect(graph.circular_cells).toContain("Inputs!D3");
  });

  it("normalizes cell addresses (strips $, uppercases column)", () => {
    const graph = buildWorkbookGraph([
      {
        sheet: "Model",
        cells: [{ addr: "$c$5", formula: "=$b$3" }],
      },
    ]);
    // Node key should be normalized: "Model!C5"
    expect(graph.cell_depths["Model!C5"]).toBe(1);
  });
});

// ─── Integration: dependency metadata through the extraction pipeline ─────────

describe("dependency metadata through pipeline", () => {
  // Minimal DPU page payload for excel_sheet type with workbook_graph
  const makePayload = (overrides: Record<string, unknown> = {}) => ({
    page_type: "excel_sheet",
    structured: {
      sheet_title: "Revenue",
      headers: ["Label", "2023", "2024"],
      rows: [
        { Label: "Revenue", "2023": 1000000, "2024": 1200000 },
        { Label: "EBITDA", "2023": 200000, "2024": 300000 },
      ],
      formula_grid: {
        "0:2023": "=C3+D3",          // Revenue 2023: same-sheet deps
        "0:2024": "=Inputs!C5",      // Revenue 2024: cross-sheet dep
        "1:2023": "=A2*B2",          // EBITDA 2023: same-sheet deps
      },
      workbook_graph: {
        circular_cells: ["Revenue!A2"],  // A2 is in a cycle
        cell_depths: {
          "Revenue!C3": 1,
          "Revenue!D3": 1,
          "Revenue!C4": 2,
        },
      },
      ...overrides,
    },
  });

  it("formula_dependencies flows from table to TypedMetric for same-sheet formula", () => {
    const payload = makePayload();
    const [table] = detectFinancialTables(payload);
    if (!table) throw new Error("expected table");

    const metrics = parseFinancialTable(table, { deal_id: "test-deal" });
    // Revenue 2023 formula is "=C3+D3" — same-sheet deps C3 and D3
    const rev2023 = metrics.find((m) => m.label?.includes("Revenue") && m.label.includes("2023"));
    expect(rev2023?.formula_dependencies).toBeDefined();
    expect(rev2023?.formula_dependencies?.length).toBeGreaterThan(0);
    // Same-sheet deps should be tagged with "Revenue" as the sheet
    const sheets = rev2023?.formula_dependencies?.map((d) => d.sheet) ?? [];
    expect(sheets.every((s) => s === "Revenue")).toBe(true);
  });

  it("formula_dependencies flows from table to TypedMetric for cross-sheet formula", () => {
    const payload = makePayload();
    const [table] = detectFinancialTables(payload);
    if (!table) throw new Error("expected table");

    const metrics = parseFinancialTable(table, { deal_id: "test-deal" });
    // Revenue 2024 formula is "=Inputs!C5" — one cross-sheet dep
    const rev2024 = metrics.find((m) => m.label?.includes("Revenue") && m.label.includes("2024"));
    expect(rev2024?.formula_dependencies).toEqual([{ sheet: "Inputs", cell: "C5" }]);
  });

  it("dependency_depth is computed from workbook_graph.cell_depths", () => {
    const payload = makePayload();
    const [table] = detectFinancialTables(payload);
    if (!table) throw new Error("expected table");

    const metrics = parseFinancialTable(table, { deal_id: "test-deal" });

    // Revenue 2023: formula "=C3+D3" — deps C3 (depth 1) and D3 (depth 1)
    // expected dependency_depth = 1 + max(1, 1) = 2
    const rev2023 = metrics.find((m) => m.label?.includes("Revenue") && m.label.includes("2023"));
    expect(rev2023?.dependency_depth).toBe(2);
  });

  it("circular_reference_detected when a direct dep is in circular_cells", () => {
    const payload = makePayload();
    const [table] = detectFinancialTables(payload);
    if (!table) throw new Error("expected table");

    const metrics = parseFinancialTable(table, { deal_id: "test-deal" });
    // EBITDA 2023: formula "=A2*B2" — A2 is in circular_cells
    const ebitda2023 = metrics.find((m) => m.label?.includes("EBITDA") && m.label.includes("2023"));
    expect(ebitda2023?.circular_reference_detected).toBe(true);
  });

  it("formula_dependencies survive promotion into FinancialFactV1", () => {
    const payload = makePayload();
    const [table] = detectFinancialTables(payload);
    if (!table) throw new Error("expected table");

    const metrics = parseFinancialTable(table, { deal_id: "test-deal" });
    const facts = promoteToFinancialFactV1(metrics, { deal_id: "test-deal" });

    const rev2024 = facts.find((f) => f.metric_key === "revenue" && f.period_label === "2024");
    expect(rev2024?.formula_dependencies).toEqual([{ sheet: "Inputs", cell: "C5" }]);
  });

  it("dependency_depth survives promotion into FinancialFactV1", () => {
    const payload = makePayload();
    const [table] = detectFinancialTables(payload);
    if (!table) throw new Error("expected table");

    const metrics = parseFinancialTable(table, { deal_id: "test-deal" });
    const facts = promoteToFinancialFactV1(metrics, { deal_id: "test-deal" });

    const rev2023 = facts.find((f) => f.metric_key === "revenue" && f.period_label === "2023");
    expect(rev2023?.dependency_depth).toBe(2);
  });

  it("circular_reference_detected survives promotion into FinancialFactV1", () => {
    const payload = makePayload();
    const [table] = detectFinancialTables(payload);
    if (!table) throw new Error("expected table");

    const metrics = parseFinancialTable(table, { deal_id: "test-deal" });
    const facts = promoteToFinancialFactV1(metrics, { deal_id: "test-deal" });

    const ebitda2023 = facts.find((f) => f.metric_key === "ebitda" && f.period_label === "2023");
    expect(ebitda2023?.circular_reference_detected).toBe(true);
  });

  it("formula_dependencies absent for literal cells (no formula_grid)", () => {
    const payload = {
      page_type: "excel_sheet",
      structured: {
        sheet_title: "Revenue",
        headers: ["Label", "2023", "2024"],
        rows: [
          { Label: "Revenue", "2023": 1000000, "2024": 1200000 },
          { Label: "EBITDA", "2023": 200000, "2024": 300000 },
        ],
        // No formula_grid — all cells are literals
      },
    };
    const [table] = detectFinancialTables(payload);
    if (!table) throw new Error("expected table");

    const metrics = parseFinancialTable(table, { deal_id: "test-deal" });
    for (const m of metrics) {
      expect(m.formula_dependencies).toBeUndefined();
      expect(m.dependency_depth).toBeUndefined();
      expect(m.circular_reference_detected).toBeUndefined();
    }
  });

  it("no circular_reference_detected when workbook_graph absent", () => {
    const payload = {
      page_type: "excel_sheet",
      structured: {
        sheet_title: "Revenue",
        headers: ["Label", "2023", "2024"],
        rows: [
          { Label: "Revenue", "2023": 1000000, "2024": 1200000 },
          { Label: "EBITDA", "2023": 200000, "2024": 300000 },
        ],
        formula_grid: { "0:2023": "=C3+D3" },
        // No workbook_graph
      },
    };
    const [table] = detectFinancialTables(payload);
    if (!table) throw new Error("expected table");

    const metrics = parseFinancialTable(table, { deal_id: "test-deal" });
    const rev = metrics.find((m) => m.label?.includes("Revenue"));
    // formula_dependencies should still be set from formula parsing
    expect(rev?.formula_dependencies).toBeDefined();
    // But no depth or circular flag since workbook_graph is absent
    expect(rev?.dependency_depth).toBeUndefined();
    expect(rev?.circular_reference_detected).toBeUndefined();
  });
});
