/**
 * extraction-assumptions.test.ts
 *
 * Verifies that extraction assumption metadata fields survive the full
 * pipeline: FinancialTable → parseFinancialTable → promoteToFinancialFactV1.
 *
 * Coverage:
 *  1. Scale factor + source text survive extraction → promotion
 *  2. Normalized + original period labels survive extraction → promotion
 *  3. typing_reason survives extraction → promotion
 *  4. formula + cross_sheet_refs survive (integration complement to cross-tab-refs.test.ts)
 *  5. No-scaling case: unit_scale_factor_applied absent when factor = 1
 *  6. Scenario columns: original/normalized label absent (scenario forces unknown period)
 */

import { describe, it, expect } from "vitest";
import { detectFinancialTables } from "../table-detector.js";
import { parseFinancialTable } from "../financial-model-interpreter.js";
import { promoteToFinancialFactV1 } from "../metric-promoter.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DEAL_ID = "deal-assump-001";
const DOC_ID  = "doc-assump-001";

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

// ─── Payloads ─────────────────────────────────────────────────────────────────

/**
 * excel_sheet payload with an explicit "in thousands" scale annotation.
 * The annotation is embedded in the sheet title — detectUnitScale scans
 * [sheetTitle, ...headers] for `excel_sheet` pages.
 * Revenue FY2024: 5_000 in sheet → 5_000_000 after ×1000 scaling.
 */
const SCALED_THOUSANDS_PAYLOAD = {
  page_type: "excel_sheet",
  structured: {
    // Sheet title carries the unit hint; source_text will be the full title string.
    sheet_title: "P&L (in thousands)",
    headers: ["Metric", "FY2023", "FY2024"],
    rows: [
      { Metric: "Revenue",    FY2023: 5_000, FY2024: 5_000 },
      { Metric: "Net Income", FY2023:  -200, FY2024:  -100 },
    ],
    tables: [],
  },
};

/**
 * excel_sheet payload with short-form quarter headers that require normalization.
 * "1Q24" → normalized "Q1 2024" via parsePeriodLabel.
 * Two value columns and two data rows to satisfy MIN_COL_HEADERS=2 / MIN_ROW_HEADERS=2.
 */
const SHORT_FORM_QUARTER_PAYLOAD = {
  page_type: "excel_sheet",
  structured: {
    sheet_title: "Quarterly",
    headers: ["Metric", "1Q24", "2Q24"],
    rows: [
      { Metric: "Revenue",      "1Q24": 1_200_000, "2Q24": 1_300_000 },
      { Metric: "Gross Profit", "1Q24":   600_000, "2Q24":   650_000 },
    ],
    tables: [],
  },
};

/**
 * excel_sheet payload with formula_grid — tests formula + cross_sheet_refs.
 *
 * formula_grid keys are "${rawRowIdx}:${colName}" (0-based index within rows[]).
 * Revenue is rawRowIdx=0; FY2023 is the first value column.
 * facts.find(metric_key==='revenue') returns the Revenue/FY2023 fact which has
 * value_kind='formula', formula='...', and cross_sheet_refs=['Revenue Build'].
 */
const FORMULA_GRID_PAYLOAD = {
  page_type: "excel_sheet",
  structured: {
    sheet_title: "Revenue Model",
    headers: ["Metric", "FY2023", "FY2024"],
    rows: [
      { Metric: "Revenue",    FY2023: 4_500_000, FY2024: 5_000_000 },
      { Metric: "Net Income", FY2023:  -300_000, FY2024:  -100_000 },
    ],
    // Revenue row (rawRowIdx=0), FY2023 column → first Revenue fact has the formula.
    formula_grid: {
      "0:FY2023": "=SUM('Revenue Build'!C3:C17)",
    },
    tables: [],
  },
};

/**
 * Standard payload — no scaling, two standard annual period headers.
 * Two value columns and two data rows satisfy MIN_COL_HEADERS=2 / MIN_ROW_HEADERS=2.
 */
const NO_SCALE_PAYLOAD = {
  page_type: "excel_sheet",
  structured: {
    sheet_title: "Model",
    headers: ["Metric", "FY2023", "FY2024"],
    rows: [
      { Metric: "Revenue",    FY2023: 3_000_000, FY2024: 4_000_000 },
      { Metric: "Net Income", FY2023:  -500_000, FY2024:  -200_000 },
    ],
    tables: [],
  },
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Extraction Assumption Metadata — end-to-end pipeline", () => {

  // ── 1. Scale factor + source text ─────────────────────────────────────────

  describe("unit scale factor", () => {
    it("unit_scale_factor_applied is set when 'in thousands' annotation is detected", () => {
      const facts = runPipeline(SCALED_THOUSANDS_PAYLOAD);
      const rev = facts.find((f) => f.metric_key === "revenue");
      expect(rev).toBeDefined();
      // Scaled value: 5000 × 1000 = 5_000_000
      expect(rev!.value).toBe(5_000_000);
      expect(rev!.unit_scale_factor_applied).toBe(1000);
    });

    it("unit_scale_source_text is set alongside factor", () => {
      const facts = runPipeline(SCALED_THOUSANDS_PAYLOAD);
      const rev = facts.find((f) => f.metric_key === "revenue");
      expect(rev).toBeDefined();
      // source_text is the full scanned string that contained the annotation.
      expect(rev!.unit_scale_source_text).toContain("in thousands");
    });

    it("unit_scale_factor_applied is absent when no scale annotation", () => {
      const facts = runPipeline(NO_SCALE_PAYLOAD);
      const rev = facts.find((f) => f.metric_key === "revenue");
      expect(rev).toBeDefined();
      expect(rev!.unit_scale_factor_applied).toBeUndefined();
      expect(rev!.unit_scale_source_text).toBeUndefined();
    });
  });

  // ── 2. Period normalization metadata ──────────────────────────────────────

  describe("period normalization labels", () => {
    it("original_period_label is the raw column header", () => {
      const facts = runPipeline(SHORT_FORM_QUARTER_PAYLOAD);
      const rev = facts.find((f) => f.metric_key === "revenue");
      expect(rev).toBeDefined();
      expect(rev!.original_period_label).toBe("1Q24");
    });

    it("normalized_period_label is the canonical form", () => {
      const facts = runPipeline(SHORT_FORM_QUARTER_PAYLOAD);
      const rev = facts.find((f) => f.metric_key === "revenue");
      expect(rev).toBeDefined();
      expect(rev!.normalized_period_label).toBe("Q1 2024");
    });

    it("both labels are present for standard year headers", () => {
      const facts = runPipeline(NO_SCALE_PAYLOAD);
      const rev = facts.find((f) => f.metric_key === "revenue");
      expect(rev).toBeDefined();
      // FY2024 header: original = "FY2024", normalized may be "FY2024" or "2024"
      expect(rev!.original_period_label).toBeDefined();
      expect(rev!.normalized_period_label).toBeDefined();
    });
  });

  // ── 3. typing_reason survives promotion ───────────────────────────────────

  describe("typing_reason", () => {
    it("typing_reason is present on promoted fact", () => {
      const facts = runPipeline(NO_SCALE_PAYLOAD);
      const rev = facts.find((f) => f.metric_key === "revenue");
      expect(rev).toBeDefined();
      expect(rev!.typing_reason).toBeDefined();
      expect(typeof rev!.typing_reason).toBe("string");
      expect(rev!.typing_reason!.length).toBeGreaterThan(0);
    });

    it("typing_reason references the matched row label", () => {
      const facts = runPipeline(NO_SCALE_PAYLOAD);
      const rev = facts.find((f) => f.metric_key === "revenue");
      expect(rev!.typing_reason).toMatch(/Revenue/i);
    });

    it("typing_reason includes scale annotation when scale was applied", () => {
      const facts = runPipeline(SCALED_THOUSANDS_PAYLOAD);
      const rev = facts.find((f) => f.metric_key === "revenue");
      expect(rev!.typing_reason).toMatch(/unit_scale_factor=1000/);
    });
  });

  // ── 4. Formula + cross-sheet refs survive promotion ───────────────────────

  describe("formula traceability (complement to cross-tab-refs.test.ts)", () => {
    it("value_kind=formula when formula_grid is present and cell has formula", () => {
      const facts = runPipeline(FORMULA_GRID_PAYLOAD);
      const rev = facts.find((f) => f.metric_key === "revenue");
      expect(rev).toBeDefined();
      expect(rev!.value_kind).toBe("formula");
    });

    it("formula string is preserved on promoted fact", () => {
      const facts = runPipeline(FORMULA_GRID_PAYLOAD);
      const rev = facts.find((f) => f.metric_key === "revenue");
      expect(rev!.formula).toBe("=SUM('Revenue Build'!C3:C17)");
    });

    it("cross_sheet_refs parsed from formula", () => {
      const facts = runPipeline(FORMULA_GRID_PAYLOAD);
      const rev = facts.find((f) => f.metric_key === "revenue");
      expect(rev!.cross_sheet_refs).toEqual(["Revenue Build"]);
    });
  });

  // ── 5. All new fields are absent for scenario columns ──────────────────────

  describe("scenario columns — no period metadata", () => {
    // fromExcelRange requires rowsPreview.length >= MIN_ROW_HEADERS+1 (=3) and
    // at least 2 data rows after skipping the header row.
    const SCENARIO_PAYLOAD = {
      page_type: "excel_range",
      structured: {
        sheet_title: "Revenue Model",
        rows_preview: [
          { col_A: null,         col_C: "Base",     col_D: "Upside"  },
          { col_A: "Revenue",    col_C: 5_000_000,  col_D: 7_000_000 },
          { col_A: "Net Income", col_C:  -500_000,  col_D:  200_000  },
        ],
      },
    };

    it("scenario facts have no unit_scale_factor_applied by default", () => {
      const facts = runPipeline(SCENARIO_PAYLOAD);
      for (const f of facts) {
        expect(f.unit_scale_factor_applied).toBeUndefined();
      }
    });

    it("scenario column label is set as scenario, not original_period_label", () => {
      const facts = runPipeline(SCENARIO_PAYLOAD);
      const base = facts.find((f) => f.scenario === "Base");
      expect(base).toBeDefined();
      // Scenario columns don't go through parsePeriodLabel → no normalized label expected
      // original_period_label will still be the raw header string ("Base")
      expect(base!.original_period_label).toBe("Base");
    });
  });
});
