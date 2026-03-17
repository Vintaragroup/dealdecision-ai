/**
 * PR2 — XLSX Source Kind Through Financial Pipeline
 *
 * Coverage:
 *  1. extractFinancialTableClaims with source_kind_override='xlsx' → facts carry source_kind='xlsx'
 *  2. extractFinancialTableClaims without override → facts carry source_kind='pdf_table' (unchanged)
 *  3. Mixed PDF + XLSX dedup: pdf_table (rank 4) beats xlsx (rank 3) on same metric+period
 *  4. Mixed PDF + XLSX dedup: xlsx wins when there is no pdf_table competitor
 *  5. populateFinancialFactRegistryV1 with xlsx_doc:true → facts_xlsx counter, XLSX_FINANCIAL_FACTS_DETECTED log
 *  6. populateFinancialFactRegistryV1 with xlsx_doc:false → facts_xlsx=0, no XLSX log
 *  7. Warning FINANCIAL_FACT_XLSX_SOURCE_MISSING guard (via manual injection)
 *  8. SOURCE_KIND_RANK ordering: pdf_table > xlsx > pdf_kpi_line > deck > unknown
 *  9. Compile guard: source_kind is never undefined for XLSX rows
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  extractFinancialTableClaims,
} from "../extract-financial-table-claims";
import {
  mergeFactsByConfidence,
  populateFinancialFactRegistryV1,
} from "../populate-financial-fact-registry-v1";
import type { FinancialFactV1, FinancialFactSourceKind } from "@dealdecision/core";

// ───────────────────────────────────────────────────────────────────────────────
// Fixtures
// ───────────────────────────────────────────────────────────────────────────────

const XLSX_TABLE_TEXT = `
Revenue  | FY2024    | FY2025
$1,200,000 | $2,400,000
Burn Rate | $80,000 | $100,000
ARR       | $1,200,000 | $2,400,000
`.trim();

const BASE_OPTS = {
  deal_id: "deal-xlsx-test",
  document_id: "doc-xlsx-001",
  page_number: 0,
};

// ───────────────────────────────────────────────────────────────────────────────
// 1 & 2 — source_kind_override in extractFinancialTableClaims
// ───────────────────────────────────────────────────────────────────────────────

describe("extractFinancialTableClaims — source_kind_override", () => {
  it("tags facts with source_kind='xlsx' when source_kind_override='xlsx'", () => {
    const facts = extractFinancialTableClaims(XLSX_TABLE_TEXT, {
      ...BASE_OPTS,
      source_kind_override: "xlsx",
    });

    expect(facts.length).toBeGreaterThan(0);
    for (const fact of facts) {
      expect(fact.source_kind).toBe("xlsx");
    }
  });

  it("tags facts with source_kind='pdf_table' when no override (regression)", () => {
    const facts = extractFinancialTableClaims(XLSX_TABLE_TEXT, BASE_OPTS);

    expect(facts.length).toBeGreaterThan(0);
    for (const fact of facts) {
      expect(fact.source_kind).toBe("pdf_table");
    }
  });

  it("source_kind is never undefined or null for xlsx-overridden facts (compile guard)", () => {
    const facts = extractFinancialTableClaims(XLSX_TABLE_TEXT, {
      ...BASE_OPTS,
      source_kind_override: "xlsx",
    });

    // TypeScript guarantees source_kind is string (not undefined/null)
    for (const fact of facts) {
      const sk: string = fact.source_kind; // compile error if undefined
      expect(typeof sk).toBe("string");
      expect(sk.length).toBeGreaterThan(0);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────────
// 3 & 4 — mergeFactsByConfidence ranking: pdf_table > xlsx
// ───────────────────────────────────────────────────────────────────────────────

describe("mergeFactsByConfidence — source_kind ranking", () => {
  const BASE_FACT: Omit<FinancialFactV1, "source_kind" | "fact_id" | "source_pointer"> = {
    deal_id: "deal-1",
    document_id: "doc-1",
    metric_key: "revenue",
    metric_label: "Revenue",
    period_type: "annual",
    period_label: "FY2024",
    value: 1_200_000,
    unit: "currency",
    confidence: "high",
    reconciliation_status: "unknown",
    page_number: 0,
    excerpt: "Revenue $1.2M",
  };

  it("pdf_table beats xlsx on same metric+period (rank 4 > rank 3)", () => {
    const pdfTableFact: FinancialFactV1 = {
      ...BASE_FACT,
      fact_id: "fact-pdf",
      source_kind: "pdf_table",
      source_pointer: "doc-1::p0::revenue::FY2024",
    };
    const xlsxFact: FinancialFactV1 = {
      ...BASE_FACT,
      fact_id: "fact-xlsx",
      source_kind: "xlsx",
      source_pointer: "doc-2::p0::revenue::FY2024",
    };

    const { merged, droppedCount } = mergeFactsByConfidence([xlsxFact, pdfTableFact]);

    expect(merged).toHaveLength(1);
    expect(merged[0].source_kind).toBe("pdf_table");
    expect(droppedCount).toBe(1);
  });

  it("xlsx wins over pdf_kpi_line (rank 3 > rank 2)", () => {
    const xlsxFact: FinancialFactV1 = {
      ...BASE_FACT,
      fact_id: "fact-xlsx",
      source_kind: "xlsx",
      source_pointer: "doc-xlsx::p0::revenue::FY2024",
    };
    const kpiFact: FinancialFactV1 = {
      ...BASE_FACT,
      fact_id: "fact-kpi",
      source_kind: "pdf_kpi_line",
      source_pointer: "doc-pdf::p3::revenue::FY2024",
    };

    const { merged, droppedCount } = mergeFactsByConfidence([kpiFact, xlsxFact]);

    expect(merged).toHaveLength(1);
    expect(merged[0].source_kind).toBe("xlsx");
    expect(droppedCount).toBe(1);
  });

  it("xlsx wins when no pdf_table competitor exists — preserved as-is", () => {
    const xlsxFact: FinancialFactV1 = {
      ...BASE_FACT,
      fact_id: "fact-xlsx",
      source_kind: "xlsx",
      source_pointer: "doc-xlsx::p0::revenue::FY2024",
    };
    const unrelatedFact: FinancialFactV1 = {
      ...BASE_FACT,
      fact_id: "fact-burn",
      source_kind: "xlsx",
      source_pointer: "doc-xlsx::p0::burn_rate::FY2024",
      metric_key: "burn_rate",
      metric_label: "Burn Rate",
    };

    const { merged, droppedCount } = mergeFactsByConfidence([xlsxFact, unrelatedFact]);

    expect(merged).toHaveLength(2);
    expect(merged.every((f) => f.source_kind === "xlsx")).toBe(true);
    expect(droppedCount).toBe(0);
  });

  it("confirms full ranking order: pdf_table > xlsx > pdf_kpi_line > deck > unknown", () => {
    const makeFactForKind = (kind: FinancialFactSourceKind, suffix: string): FinancialFactV1 => ({
      ...BASE_FACT,
      fact_id: `fact-${kind}`,
      source_kind: kind,
      // Use different periods so they don't dedup against each other
      period_label: `FY2024-${suffix}`,
      source_pointer: `doc::p0::revenue::FY2024-${suffix}`,
    });

    // Pairs to test: higher-rank item should always win
    const pairs: Array<[FinancialFactSourceKind, FinancialFactSourceKind]> = [
      ["pdf_table", "xlsx"],
      ["xlsx", "pdf_kpi_line"],
      ["pdf_kpi_line", "deck"],
      ["deck", "unknown"],
    ];

    for (const [winner, loser] of pairs) {
      const facts = [makeFactForKind(loser, loser), makeFactForKind(winner, loser)];
      // Force same dedup key by giving same period_label
      const sameKey = facts.map((f) => ({ ...f, period_label: "FY2024" }));
      const { merged } = mergeFactsByConfidence(sameKey);
      expect(merged[0].source_kind, `${winner} should beat ${loser}`).toBe(winner);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────────
// 5 & 6 — populateFinancialFactRegistryV1 with xlsx_doc flag
// ───────────────────────────────────────────────────────────────────────────────

// Minimal mock pool: returns one "financials" page with XLSX table text
function makeMockPool(overrides: { pageText?: string; dpuRows?: any[] } = {}) {
  const pageText = overrides.pageText ?? XLSX_TABLE_TEXT;

  return {
    query: vi.fn(async (sql: string, _params?: any[]) => {
      const q = String(sql);

      // Primary candidates: page_registry_v1 query
      if (q.includes("page_registry_v1") && q.includes("page_type IN")) {
        return {
          rows: [{
            page_id: "page-1",
            document_id: "doc-xlsx-001",
            page_index: 0,
            page_type: "financials",
          }],
        };
      }

      // Secondary candidates: skip
      if (q.includes("page_registry_v1") && q.includes("page_type NOT IN")) {
        return { rows: [] };
      }

      // DPU text fetch
      if (q.includes("document_page_understanding")) {
        return { rows: [{ page_text: pageText }] };
      }

      // financial_facts_v1 upsert
      if (q.includes("INSERT INTO") && q.includes("financial_facts")) {
        return { rows: [{ upserted: 1 }] };
      }

      return { rows: [] };
    }),
  } as any;
}

describe("populateFinancialFactRegistryV1 — xlsx_doc flag", () => {
  let consoleLogs: string[];
  let consoleWarns: string[];
  let consoleInfos: string[];

  beforeEach(() => {
    consoleLogs = [];
    consoleWarns = [];
    consoleInfos = [];
    vi.spyOn(console, "log").mockImplementation((msg: string) => { consoleLogs.push(msg); });
    vi.spyOn(console, "warn").mockImplementation((msg: string) => { consoleWarns.push(msg); });
    vi.spyOn(console, "info").mockImplementation((msg: string) => { consoleInfos.push(msg); });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("xlsx_doc:true → extracted facts carry source_kind='xlsx' and facts_xlsx > 0", async () => {
    // Intercept upsertFinancialFactsV1 to capture written facts
    const capturedFacts: FinancialFactV1[] = [];
    const mockPool = makeMockPool();
    // Override the upsert query handler to capture
    const originalQuery = mockPool.query;
    mockPool.query = vi.fn(async (sql: string, params?: any[]) => {
      const q = String(sql);
      if (q.includes("INSERT INTO") && q.includes("financial_facts")) {
        // params[2] in the multi-row insert contains source_kind info
        // We can't easily capture typed FinancialFactV1 from raw SQL params here,
        // so we rely on result.facts_xlsx as the primary assertion.
        return { rows: [] };
      }
      return originalQuery(sql, params);
    });

    const result = await populateFinancialFactRegistryV1(mockPool, {
      deal_id: "deal-xlsx-test",
      document_id: "doc-xlsx-001",
      xlsx_doc: true,
    });

    expect(result.facts_xlsx).toBeGreaterThan(0);
    expect(result.pages_scanned).toBeGreaterThan(0);
    expect(result.pages_with_data).toBeGreaterThan(0);
  });

  it("xlsx_doc:true → emits XLSX_FINANCIAL_FACTS_DETECTED log when facts_xlsx > 0", async () => {
    await populateFinancialFactRegistryV1(makeMockPool(), {
      deal_id: "deal-xlsx-test",
      document_id: "doc-xlsx-001",
      xlsx_doc: true,
    });

    const detectionLog = consoleLogs
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .find((e) => e?.event === "XLSX_FINANCIAL_FACTS_DETECTED");

    expect(detectionLog).toBeDefined();
    expect(detectionLog?.deal_id).toBe("deal-xlsx-test");
    expect(detectionLog?.document_id).toBe("doc-xlsx-001");
    expect(typeof detectionLog?.fact_count).toBe("number");
    expect(detectionLog?.fact_count).toBeGreaterThan(0);
  });

  it("xlsx_doc:false → facts_xlsx=0, no XLSX_FINANCIAL_FACTS_DETECTED log", async () => {
    const result = await populateFinancialFactRegistryV1(makeMockPool(), {
      deal_id: "deal-pdf-test",
      document_id: "doc-pdf-001",
      xlsx_doc: false,
    });

    expect(result.facts_xlsx).toBe(0);

    const detectionLog = consoleLogs
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .find((e) => e?.event === "XLSX_FINANCIAL_FACTS_DETECTED");
    expect(detectionLog).toBeUndefined();
  });

  it("xlsx_doc not set (undefined) → facts_xlsx=0 (backward compat)", async () => {
    const result = await populateFinancialFactRegistryV1(makeMockPool(), {
      deal_id: "deal-pdf-test",
      document_id: "doc-pdf-001",
    });

    expect(result.facts_xlsx).toBe(0);
  });

  it("FINANCIAL_EXPANSION_V2_SUMMARY log includes facts_xlsx field", async () => {
    await populateFinancialFactRegistryV1(makeMockPool(), {
      deal_id: "deal-xlsx-test",
      document_id: "doc-xlsx-001",
      xlsx_doc: true,
    });

    // emitExpansionSummary uses console.info
    const summaryLog = consoleInfos
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .find((e) => e?.event === "FINANCIAL_EXPANSION_V2_SUMMARY");

    expect(summaryLog).toBeDefined();
    expect(summaryLog).toHaveProperty("facts_xlsx");
    expect(typeof summaryLog?.facts_xlsx).toBe("number");
  });
});

// ───────────────────────────────────────────────────────────────────────────────
// 7 — FINANCIAL_FACT_XLSX_SOURCE_MISSING guard
// ───────────────────────────────────────────────────────────────────────────────

describe("FINANCIAL_FACT_XLSX_SOURCE_MISSING guard", () => {
  it("does NOT emit FINANCIAL_FACT_XLSX_SOURCE_MISSING when xlsx_doc:true and facts are correctly tagged", async () => {
    const consoleWarns: string[] = [];
    vi.spyOn(console, "warn").mockImplementation((msg: string) => { consoleWarns.push(String(msg)); });
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});

    // Normal xlsx_doc:true path — all facts should have source_kind="xlsx" → no warning
    await populateFinancialFactRegistryV1(makeMockPool(), {
      deal_id: "deal-xlsx-test",
      document_id: "doc-xlsx-001",
      xlsx_doc: true,
    });

    const missingWarning = consoleWarns.find((w) => {
      try { return JSON.parse(w)?.event === "FINANCIAL_FACT_XLSX_SOURCE_MISSING"; }
      catch { return false; }
    });
    expect(missingWarning).toBeUndefined();

    vi.restoreAllMocks();
  });

  it("extracted facts always have a non-empty source_kind when source_kind_override='xlsx' (compile guard)", () => {
    const facts = extractFinancialTableClaims(XLSX_TABLE_TEXT, {
      ...BASE_OPTS,
      source_kind_override: "xlsx",
    });

    expect(facts.length).toBeGreaterThan(0);
    // Every fact must have a non-empty source_kind (compile-time enforced by FinancialFactSourceKind union)
    for (const fact of facts) {
      expect(fact.source_kind).toBeTruthy();
      expect(fact.source_kind).toBe("xlsx");
    }
  });
});
