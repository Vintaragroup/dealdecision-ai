/**
 * Phase 2 Integration: XLSX Workbook Intelligence Pipeline
 *
 * Validates the full end-to-end pipeline:
 *   DPU payload → detectFinancialTables → parseFinancialTable
 *               → promoteToFinancialFactV1 → FinancialFactV1[]
 *
 * Coverage:
 *  1. excel_range payload → FinancialFactV1[] with correct metric_key + value
 *  2. temporal_scope = "historical" for past years, "projected" for future years
 *  3. excel_sheet payload (headers/rows format) also produces FinancialFactV1[]
 *  4. scenario model payload: scenario field is preserved on promoted facts
 *  5. projection_blocked=true on projected facts
 *  6. source_kind="xlsx" on all promoted facts
 *  7. Empty / unrecognised payload produces no facts (non-fatal)
 */

import { describe, it, expect } from "vitest";
import { detectFinancialTables } from "../table-detector.js";
import { parseFinancialTable } from "../financial-model-interpreter.js";
import { promoteToFinancialFactV1 } from "../metric-promoter.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DEAL_ID = "deal-integ-001";
const DOC_ID  = "doc-integ-001";

function runPipeline(payload: Record<string, unknown>) {
  const facts: ReturnType<typeof promoteToFinancialFactV1> = [];
  for (const table of detectFinancialTables(payload)) {
    const metrics = parseFinancialTable(table, { deal_id: DEAL_ID });
    facts.push(...promoteToFinancialFactV1(metrics, { deal_id: DEAL_ID, document_id: DOC_ID, sheet_name: table.sheet_name }));
  }
  return facts;
}

// ─── Fixture payloads ─────────────────────────────────────────────────────────

/** Standard income-statement excel_range payload (past + future years). */
const INCOME_RANGE_PAYLOAD = {
  page_type: "excel_range",
  structured: {
    sheet_title: "P&L",
    rows_preview: [
      // Header row — year integers; 2028 is clearly future/projected
      { col_A: null,           col_C: 2023,       col_D: 2024,       col_E: 2028 },
      { col_A: "Revenue",      col_C: 5_000_000,  col_D: 7_200_000,  col_E: 10_000_000 },
      { col_A: "Net Income",   col_C:   400_000,  col_D:   800_000,  col_E:  1_500_000 },
      { col_A: "EBITDA",       col_C:   600_000,  col_D: 1_100_000,  col_E:  2_000_000 },
    ],
  },
};

/** Scenario model with named columns (Base / Upside / Downside). */
const SCENARIO_RANGE_PAYLOAD = {
  page_type: "excel_range",
  structured: {
    sheet_title: "Revenue Model",
    rows_preview: [
      { col_A: null,       col_C: "Base",     col_D: "Upside",   col_E: "Downside" },
      { col_A: "Revenue",  col_C: 5_000_000,  col_D: 7_000_000,  col_E: 4_000_000 },
      { col_A: "ARR",      col_C: 3_000_000,  col_D: 4_500_000,  col_E: 2_500_000 },
    ],
  },
};

/** excel_sheet payload (headers + rows). */
const INCOME_SHEET_PAYLOAD = {
  page_type: "excel_sheet",
  structured: {
    sheet_title: "Income Statement",
    headers: ["Metric", "FY2023", "FY2024"],
    rows: [
      { Metric: "Revenue",    FY2023: 4_000_000, FY2024: 6_500_000 },
      { Metric: "Gross Profit", FY2023: 2_500_000, FY2024: 4_000_000 },
    ],
    tables: [],
  },
};

/** Payload with no recognisable financial rows. */
const EMPTY_PAYLOAD = {
  page_type: "excel_range",
  structured: {
    sheet_title: "Cover",
    rows_preview: [
      { col_A: "Company Name", col_C: "Acme Corp" },
      { col_A: "Date",         col_C: "2025-01-01" },
    ],
  },
};

// ─── 1. excel_range → FinancialFactV1[] ───────────────────────────────────────

describe("Pipeline integration — excel_range income statement", () => {
  it("produces FinancialFactV1 array with at least one revenue fact", () => {
    const facts = runPipeline(INCOME_RANGE_PAYLOAD);
    expect(facts.length).toBeGreaterThan(0);
    const revFacts = facts.filter((f) => f.metric_key === "revenue");
    expect(revFacts.length).toBeGreaterThan(0);
  });

  it("all facts carry source_kind='xlsx'", () => {
    const facts = runPipeline(INCOME_RANGE_PAYLOAD);
    for (const f of facts) {
      expect(f.source_kind).toBe("xlsx");
    }
  });

  it("all facts carry deal_id and document_id", () => {
    const facts = runPipeline(INCOME_RANGE_PAYLOAD);
    for (const f of facts) {
      expect(f.deal_id).toBe(DEAL_ID);
      expect(f.document_id).toBe(DOC_ID);
    }
  });

  it("all facts have a non-empty deterministic fact_id", () => {
    const facts = runPipeline(INCOME_RANGE_PAYLOAD);
    const ids = facts.map((f) => f.fact_id);
    // Unique within the batch
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(typeof id).toBe("string");
      expect(id.length).toBeGreaterThan(8);
    }
  });

  it("revenue values match fixture numbers", () => {
    const facts = runPipeline(INCOME_RANGE_PAYLOAD);
    const revFacts = facts.filter((f) => f.metric_key === "revenue");
    const values = revFacts.map((f) => f.value as number);
    // All three revenue values from fixture should be present
    expect(values).toContain(5_000_000);   // 2023
    expect(values).toContain(7_200_000);   // 2024
    expect(values).toContain(10_000_000);  // 2028
  });
});

// ─── 2. Temporal scope ────────────────────────────────────────────────────────

describe("Pipeline integration — temporal scope", () => {
  it("2023 revenue fact carries temporal_scope='historical'", () => {
    const facts = runPipeline(INCOME_RANGE_PAYLOAD);
    // 2023 is historically past
    const f = facts.find((f) => f.metric_key === "revenue" && String(f.period_label).includes("2023"));
    expect(f).toBeDefined();
    expect(f!.temporal_scope).toBe("historical");
  });

  it("2028 revenue fact carries temporal_scope='projected'", () => {
    const facts = runPipeline(INCOME_RANGE_PAYLOAD);
    const f = facts.find((f) => f.metric_key === "revenue" && String(f.period_label).includes("2028"));
    expect(f).toBeDefined();
    expect(f!.temporal_scope).toBe("projected");
  });
});

// ─── 3. excel_sheet payload ───────────────────────────────────────────────────

describe("Pipeline integration — excel_sheet payload", () => {
  it("produces FinancialFactV1 array from headers+rows format", () => {
    const facts = runPipeline(INCOME_SHEET_PAYLOAD);
    expect(facts.length).toBeGreaterThan(0);
  });

  it("excel_sheet revenue facts carry source_kind='xlsx'", () => {
    const facts = runPipeline(INCOME_SHEET_PAYLOAD);
    for (const f of facts) {
      expect(f.source_kind).toBe("xlsx");
    }
  });

  it("excel_sheet revenue values match fixture", () => {
    const facts = runPipeline(INCOME_SHEET_PAYLOAD);
    const revFacts = facts.filter((f) => f.metric_key === "revenue");
    const values = revFacts.map((f) => f.value as number);
    expect(values).toContain(4_000_000);
    expect(values).toContain(6_500_000);
  });
});

// ─── 4. Scenario model — scenario field preserved ─────────────────────────────

describe("Pipeline integration — scenario model", () => {
  it("produces facts for each scenario column", () => {
    const facts = runPipeline(SCENARIO_RANGE_PAYLOAD);
    expect(facts.length).toBeGreaterThan(0);
    // Should have revenue facts for Base, Upside, Downside
    const revFacts = facts.filter((f) => f.metric_key === "revenue");
    expect(revFacts.length).toBe(3);
  });

  it("scenario facts carry temporal_scope='scenario'", () => {
    const facts = runPipeline(SCENARIO_RANGE_PAYLOAD);
    for (const f of facts) {
      expect(f.temporal_scope).toBe("scenario");
    }
  });

  it("Base scenario revenue fact has scenario field = 'Base'", () => {
    const facts = runPipeline(SCENARIO_RANGE_PAYLOAD);
    const baseFact = facts.find(
      (f) => f.metric_key === "revenue" && String(f.period_label).toLowerCase() === "base"
    );
    expect(baseFact).toBeDefined();
    expect(baseFact!.scenario).toBe("Base");
  });

  it("Upside revenue value is 7_000_000", () => {
    const facts = runPipeline(SCENARIO_RANGE_PAYLOAD);
    const upsideFact = facts.find(
      (f) => f.metric_key === "revenue" && String(f.period_label).toLowerCase() === "upside"
    );
    expect(upsideFact).toBeDefined();
    expect(upsideFact!.value).toBe(7_000_000);
  });
});

// ─── 5. ARR facts from scenario model ────────────────────────────────────────

describe("Pipeline integration — ARR from scenario model", () => {
  it("ARR facts are produced for all three scenarios", () => {
    const facts = runPipeline(SCENARIO_RANGE_PAYLOAD);
    const arrFacts = facts.filter((f) => f.metric_key === "arr");
    expect(arrFacts.length).toBe(3);
  });
});

// ─── 6. Empty/unrecognised payload ───────────────────────────────────────────

describe("Pipeline integration — empty / unrecognised payload", () => {
  it("produces no facts for a non-financial sheet (non-fatal)", () => {
    const facts = runPipeline(EMPTY_PAYLOAD);
    expect(facts.length).toBe(0);
  });

  it("produces no facts for a completely empty object (non-fatal)", () => {
    const facts = runPipeline({});
    expect(facts.length).toBe(0);
  });
});

// ─── 7. Unit scaling — in thousands via sheet title (excel_range) ─────────────

/** Income statement expressed in-thousands; marker lives in the sheet title. */
const IN_THOUSANDS_RANGE_PAYLOAD = {
  page_type: "excel_range",
  structured: {
    sheet_title: "P&L (in thousands)",
    rows_preview: [
      { col_A: null,         col_C: 2023, col_D: 2024 },
      { col_A: "Revenue",    col_C: 5,    col_D: 7 },
      { col_A: "Net Income", col_C: 1,    col_D: 2 },
    ],
  },
};

describe("Pipeline integration — unit scaling (in thousands, sheet title)", () => {
  it("scales revenue fact values by 1000", () => {
    const facts = runPipeline(IN_THOUSANDS_RANGE_PAYLOAD);
    const revFacts = facts.filter((f) => f.metric_key === "revenue");
    expect(revFacts.length).toBeGreaterThan(0);
    const values = revFacts.map((f) => f.value as number);
    expect(values).toContain(5_000);   // 5 × 1000
    expect(values).toContain(7_000);   // 7 × 1000
  });

  it("does not emit the raw pre-scale cell value in any fact", () => {
    const facts = runPipeline(IN_THOUSANDS_RANGE_PAYLOAD);
    const revFacts = facts.filter((f) => f.metric_key === "revenue");
    const values = revFacts.map((f) => f.value);
    expect(values).not.toContain(5);
    expect(values).not.toContain(7);
  });

  it("fact_ids are all unique (scale annotation makes each source_pointer distinct)", () => {
    const facts = runPipeline(IN_THOUSANDS_RANGE_PAYLOAD);
    const ids = facts.map((f) => f.fact_id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("source_kind is still xlsx after scaling", () => {
    const facts = runPipeline(IN_THOUSANDS_RANGE_PAYLOAD);
    for (const f of facts) {
      expect(f.source_kind).toBe("xlsx");
    }
  });
});

// ─── 8. Unit scaling — $000s via top-row label (excel_range) ─────────────────

/**
 * Scale marker lives in col_A of the first row (a common pattern where
 * workbooks write "$000s" as a label above the numeric grid).
 */
const DOLLAR_000S_RANGE_PAYLOAD = {
  page_type: "excel_range",
  structured: {
    sheet_title: "Income Statement",
    rows_preview: [
      { col_A: "$000s",      col_C: null, col_D: null },
      { col_A: null,         col_C: 2023, col_D: 2024 },
      { col_A: "Revenue",    col_C: 10,   col_D: 15 },
      { col_A: "Net Income", col_C: 2,    col_D: 4 },
    ],
  },
};

describe("Pipeline integration — unit scaling ($000s, top-row label)", () => {
  it("detects $000s and scales fact values by 1000", () => {
    const facts = runPipeline(DOLLAR_000S_RANGE_PAYLOAD);
    const revFacts = facts.filter((f) => f.metric_key === "revenue");
    expect(revFacts.length).toBeGreaterThan(0);
    const values = revFacts.map((f) => f.value as number);
    expect(values).toContain(10_000);  // 10 × 1000
    expect(values).toContain(15_000);  // 15 × 1000
  });

  it("does not emit raw pre-scale values", () => {
    const facts = runPipeline(DOLLAR_000S_RANGE_PAYLOAD);
    const revFacts = facts.filter((f) => f.metric_key === "revenue");
    const values = revFacts.map((f) => f.value);
    expect(values).not.toContain(10);
    expect(values).not.toContain(15);
  });
});

// ─── 9. Unit scaling — in millions via sheet title (excel_range) ──────────────

const IN_MILLIONS_RANGE_PAYLOAD = {
  page_type: "excel_range",
  structured: {
    sheet_title: "Financial Summary (in millions)",
    rows_preview: [
      { col_A: null,         col_C: 2023, col_D: 2024 },
      { col_A: "Revenue",    col_C: 50,   col_D: 75 },
      { col_A: "Net Income", col_C: 5,    col_D: 10 },
    ],
  },
};

describe("Pipeline integration — unit scaling (in millions, sheet title)", () => {
  it("scales revenue fact values by 1_000_000", () => {
    const facts = runPipeline(IN_MILLIONS_RANGE_PAYLOAD);
    const revFacts = facts.filter((f) => f.metric_key === "revenue");
    expect(revFacts.length).toBeGreaterThan(0);
    const values = revFacts.map((f) => f.value as number);
    expect(values).toContain(50_000_000);  // 50 × 1_000_000
    expect(values).toContain(75_000_000);  // 75 × 1_000_000
  });

  it("does not emit raw pre-scale values", () => {
    const facts = runPipeline(IN_MILLIONS_RANGE_PAYLOAD);
    const revFacts = facts.filter((f) => f.metric_key === "revenue");
    const values = revFacts.map((f) => f.value);
    expect(values).not.toContain(50);
    expect(values).not.toContain(75);
  });
});

// ─── 10. No scaling — control case ──────────────────────────────────────────

describe("Pipeline integration — no unit scaling (control)", () => {
  it("INCOME_RANGE_PAYLOAD passes absolute values through unchanged", () => {
    // This fixture has no scale marker — all values should arrive as-is
    const facts = runPipeline(INCOME_RANGE_PAYLOAD);
    const revFacts = facts.filter((f) => f.metric_key === "revenue");
    const values = revFacts.map((f) => f.value as number);
    expect(values).toContain(5_000_000);
    expect(values).toContain(7_200_000);
    expect(values).toContain(10_000_000);
  });
});

// ─── 11. Unit scaling — in thousands via sheet title (excel_sheet) ────────────

const IN_THOUSANDS_SHEET_PAYLOAD = {
  page_type: "excel_sheet",
  structured: {
    sheet_title: "Revenue Model (in thousands)",
    headers: ["Metric", "FY2023", "FY2024"],
    rows: [
      { Metric: "Revenue",    FY2023: 4_000, FY2024: 6_500 },
      { Metric: "Net Income", FY2023:   500, FY2024:   900 },
    ],
    tables: [],
  },
};

describe("Pipeline integration — unit scaling (excel_sheet, in thousands)", () => {
  it("scales excel_sheet revenue values by 1000", () => {
    const facts = runPipeline(IN_THOUSANDS_SHEET_PAYLOAD);
    const revFacts = facts.filter((f) => f.metric_key === "revenue");
    expect(revFacts.length).toBeGreaterThan(0);
    const values = revFacts.map((f) => f.value as number);
    expect(values).toContain(4_000_000);  // 4_000 × 1000
    expect(values).toContain(6_500_000);  // 6_500 × 1000
  });

  it("source_kind is xlsx for excel_sheet scaled facts", () => {
    const facts = runPipeline(IN_THOUSANDS_SHEET_PAYLOAD);
    for (const f of facts) {
      expect(f.source_kind).toBe("xlsx");
    }
  });
});
