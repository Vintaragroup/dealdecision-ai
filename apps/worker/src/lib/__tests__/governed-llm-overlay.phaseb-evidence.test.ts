/**
 * Regression tests for PhaseB visual evidence integration in governed-llm-overlay:
 *   - classifyPhasebField  – tag-based field routing
 *   - loadPhasebVisualEvidenceItems – DB query, classification, richer PhasebEvidenceItem return
 *   - Supplement path: phaseb_visual prevents no_evidence when DPU yields nothing
 *   - evidence_visual_asset_map_size > 0 when phaseb_visual rows exist
 */
import { describe, it, expect } from "vitest";

import {
  classifyPhasebField,
  loadPhasebVisualEvidenceItems,
} from "../governed-llm-overlay";

// ---------------------------------------------------------------------------
// classifyPhasebField
// ---------------------------------------------------------------------------
describe("classifyPhasebField", () => {
  it("routes raise / round / funding tags → raise_terms", () => {
    expect(classifyPhasebField(["signal:phaseb_visual", "evidence_type:raise_terms"])).toBe("raise_terms");
    expect(classifyPhasebField(["funding", "valuation"])).toBe("raise_terms");
    expect(classifyPhasebField(["ask", "investment"])).toBe("raise_terms");
    expect(classifyPhasebField(["round", "series_a"])).toBe("raise_terms");
    expect(classifyPhasebField(["terms"])).toBe("raise_terms");
  });

  it("routes market / TAM tags → market_icp", () => {
    expect(classifyPhasebField(["signal:phaseb_visual", "evidence_type:market_tam"])).toBe("market_icp");
    expect(classifyPhasebField(["icp", "customer"])).toBe("market_icp");
    expect(classifyPhasebField(["audience", "segment"])).toBe("market_icp");
    expect(classifyPhasebField(["tam", "addressable"])).toBe("market_icp");
  });

  it("routes financial / revenue / arr tags → business_model", () => {
    expect(classifyPhasebField(["signal:phaseb_visual", "evidence_type:financial_metrics"])).toBe("business_model");
    expect(classifyPhasebField(["revenue", "subscription"])).toBe("business_model");
    expect(classifyPhasebField(["saas", "pricing"])).toBe("business_model");
    expect(classifyPhasebField(["arr", "mrr"])).toBe("business_model");
    expect(classifyPhasebField(["unit economics", "gross margin"])).toBe("business_model");
  });

  it("defaults to product_solution for unrecognised tags", () => {
    expect(classifyPhasebField(["signal:phaseb_visual", "evidence_type:chart_analysis"])).toBe("product_solution");
    expect(classifyPhasebField([])).toBe("product_solution");
    expect(classifyPhasebField(["unknown_tag"])).toBe("product_solution");
  });

  it("accepts null and undefined without throwing", () => {
    expect(classifyPhasebField(null)).toBe("product_solution");
    expect(classifyPhasebField(undefined)).toBe("product_solution");
  });

  it("raise takes priority over market when both signals present", () => {
    expect(classifyPhasebField(["raise", "market"])).toBe("raise_terms");
  });
});

// ---------------------------------------------------------------------------
// loadPhasebVisualEvidenceItems
// ---------------------------------------------------------------------------

/** Build a minimal Pool mock typed for pg.Pool */
function makeMockPool(
  queryFn: (sql: string, params?: unknown[]) => { rows: unknown[] }
): import("pg").Pool {
  return {
    query: (sql: string, params?: unknown[]) => Promise.resolve(queryFn(sql, params)),
  } as unknown as import("pg").Pool;
}

const DEAL_ID = "00000000-0000-0000-0000-000000000001";

/** Canonical phaseb_visual DB row shape returned by the mock */
function makeRow(overrides: {
  evidence_id: string;
  source_document_id?: string;
  source_visual_asset_id?: string | null;
  source_path?: string;
  tags?: string[];
  content_text?: string;
  confidence?: number | null;
}) {
  return {
    source_document_id: "doc-default",
    source_visual_asset_id: "va-default",
    source_path: "doc:doc-default:page:1:type:chart_analysis:asset:va-default",
    tags: ["signal:phaseb_visual", "evidence_type:chart_analysis"],
    content_text: "Default content snippet long enough to qualify here.",
    confidence: 0.5,
    ...overrides,
  };
}

describe("loadPhasebVisualEvidenceItems", () => {
  it("returns empty buckets when evidence_items table does not exist", async () => {
    const pool = makeMockPool((sql) => {
      if (sql.includes("information_schema.tables")) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    });

    const result = await loadPhasebVisualEvidenceItems(pool, DEAL_ID);
    expect(result.product_solution).toHaveLength(0);
    expect(result.market_icp).toHaveLength(0);
    expect(result.business_model).toHaveLength(0);
    expect(result.raise_terms).toHaveLength(0);
  });

  it("correctly populates field buckets from phaseb_visual rows", async () => {
    const pool = makeMockPool((sql) => {
      if (sql.includes("information_schema.tables")) return { rows: [{ exists: true }] };
      if (sql.includes("FROM evidence_items")) {
        return {
          rows: [
            makeRow({ evidence_id: "ev-financial-1", tags: ["signal:phaseb_visual", "evidence_type:financial_metrics"], content_text: "Revenue grew 40% YoY reaching $2.4M ARR in Q4." }),
            makeRow({ evidence_id: "ev-market-1",    tags: ["signal:phaseb_visual", "evidence_type:market_tam"],       content_text: "TAM is $12B with 3% current penetration." }),
            makeRow({ evidence_id: "ev-raise-1",     tags: ["signal:phaseb_visual", "evidence_type:raise_terms"],      content_text: "Raising $3M seed at $12M pre-money valuation." }),
            makeRow({ evidence_id: "ev-product-1",   tags: ["signal:phaseb_visual", "evidence_type:chart_analysis"],   content_text: "Platform enables real-time analytics at enterprise scale." }),
          ],
        };
      }
      throw new Error(`Unexpected query: ${sql}`);
    });

    const result = await loadPhasebVisualEvidenceItems(pool, DEAL_ID);
    expect(result.business_model[0].evidence_id).toBe("ev-financial-1");
    expect(result.market_icp[0].evidence_id).toBe("ev-market-1");
    expect(result.raise_terms[0].evidence_id).toBe("ev-raise-1");
    expect(result.product_solution[0].evidence_id).toBe("ev-product-1");
  });

  it("returns full PhasebEvidenceItem shape with source_visual_asset_id, page_number (1-based), confidence, tags", async () => {
    const pool = makeMockPool((sql) => {
      if (sql.includes("information_schema.tables")) return { rows: [{ exists: true }] };
      if (sql.includes("FROM evidence_items")) {
        return {
          rows: [
            makeRow({
              evidence_id: "ev-rich",
              source_document_id: "dddddddd-0000-0000-0000-000000000001",
              source_visual_asset_id: "vvvvvvvv-0000-0000-0000-000000000002",
              source_path: "doc:dddddddd-0000-0000-0000-000000000001:page:8:type:chart_analysis:asset:vvvvvvvv-0000-0000-0000-000000000002",
              tags: ["signal:phaseb_visual", "evidence_type:chart_analysis"],
              content_text: "SaaS platform delivering workflow automation for SMBs.",
              confidence: 0.72,
            }),
          ],
        };
      }
      throw new Error(`Unexpected query: ${sql}`);
    });

    const result = await loadPhasebVisualEvidenceItems(pool, DEAL_ID);
    const item = result.product_solution[0];
    expect(item.evidence_id).toBe("ev-rich");
    expect(item.source_document_id).toBe("dddddddd-0000-0000-0000-000000000001");
    expect(item.source_visual_asset_id).toBe("vvvvvvvv-0000-0000-0000-000000000002");
    expect(item.page_number).toBe(8);          // 1-based, as stored
    expect(item.content_text).toContain("SaaS");
    expect(item.tags).toContain("signal:phaseb_visual");
    expect(item.confidence).toBe(0.72);
  });

  it("parses 1-based page_number from source_path (page_number is 1-based)", async () => {
    const pool = makeMockPool((sql) => {
      if (sql.includes("information_schema.tables")) return { rows: [{ exists: true }] };
      if (sql.includes("FROM evidence_items")) {
        return {
          rows: [
            makeRow({
              evidence_id: "ev-page-test",
              source_path: "doc:doc-b:page:4:type:chart_analysis:asset:va-10",
              content_text: "Some sufficiently long snippet text that qualifies.",
            }),
          ],
        };
      }
      throw new Error(`Unexpected query: ${sql}`);
    });

    const result = await loadPhasebVisualEvidenceItems(pool, DEAL_ID);
    // page_number is 1-based — stays as parsed from source_path
    expect(result.product_solution[0].page_number).toBe(4);
  });

  it("sets page_number to null when source_path contains no page segment", async () => {
    const pool = makeMockPool((sql) => {
      if (sql.includes("information_schema.tables")) return { rows: [{ exists: true }] };
      if (sql.includes("FROM evidence_items")) {
        return {
          rows: [
            makeRow({ evidence_id: "ev-nopage", source_path: "doc:doc-c:no_page_here:asset:va-5", content_text: "Content without a page segment in source path." }),
          ],
        };
      }
      throw new Error(`Unexpected query: ${sql}`);
    });

    const result = await loadPhasebVisualEvidenceItems(pool, DEAL_ID);
    expect(result.product_solution[0].page_number).toBeNull();
  });

  it("caps each field bucket to 3 entries", async () => {
    const pool = makeMockPool((sql) => {
      if (sql.includes("information_schema.tables")) return { rows: [{ exists: true }] };
      if (sql.includes("FROM evidence_items")) {
        return {
          rows: Array.from({ length: 6 }, (_, i) =>
            makeRow({ evidence_id: `ev-prod-${i}`, content_text: `Product snippet ${i} with enough content to qualify here.` })
          ),
        };
      }
      throw new Error(`Unexpected query: ${sql}`);
    });

    const result = await loadPhasebVisualEvidenceItems(pool, DEAL_ID);
    expect(result.product_solution).toHaveLength(3);
  });

  it("returns empty buckets when pool query throws (fail-open)", async () => {
    const pool = makeMockPool((sql) => {
      if (sql.includes("information_schema.tables")) return { rows: [{ exists: true }] };
      throw new Error("DB connection error");
    });

    // Must not throw — governed overlay must remain fail-open
    await expect(loadPhasebVisualEvidenceItems(pool, DEAL_ID)).resolves.toMatchObject({
      product_solution: [],
      raise_terms: [],
      market_icp: [],
      business_model: [],
    });
  });

  // -------------------------------------------------------------------------
  // Critical regression: phaseb supplement prevents no_evidence
  // -------------------------------------------------------------------------
  it("regression: phaseb_visual evidence items are returned so allEvidenceIds would be non-empty", async () => {
    // Simulates the scenario where DPU returns nothing but evidence_items has 13 phaseb_visual rows.
    // The supplement code in generateDisplayFactsV1BestEffort pushes phasebItemToDisplayFactEv() results
    // into each empty evidence array; this test validates the IDs are correct and would populate allEvidenceIds.
    const pool = makeMockPool((sql) => {
      if (sql.includes("information_schema.tables")) return { rows: [{ exists: true }] };
      if (sql.includes("FROM evidence_items")) {
        return {
          rows: Array.from({ length: 13 }, (_, i) =>
            makeRow({
              evidence_id: `phaseb-ev-${i.toString().padStart(3, "0")}`,
              source_path: `doc:doc-x:page:${i + 1}:type:chart_analysis:asset:va-${i}`,
              content_text: `Phaseb visual evidence item ${i} sufficient length for inclusion.`,
            })
          ),
        };
      }
      throw new Error(`Unexpected query: ${sql}`);
    });

    const result = await loadPhasebVisualEvidenceItems(pool, DEAL_ID);

    // All 13 rows route to product_solution (unrecognised tags); bucket capped at 3.
    const allIds = [
      ...result.product_solution,
      ...result.market_icp,
      ...result.business_model,
      ...result.raise_terms,
    ].map((i) => i.evidence_id);

    expect(allIds.length).toBeGreaterThan(0);
    // Verify IDs are non-empty strings (would populate allEvidenceIds set)
    for (const id of allIds) {
      expect(typeof id).toBe("string");
      expect(id.length).toBeGreaterThan(0);
    }
  });

  // -------------------------------------------------------------------------
  // Critical regression: evidence_visual_asset_map_size populated via source_visual_asset_id
  // -------------------------------------------------------------------------
  it("regression: source_visual_asset_id is preserved on returned items to feed visual-asset map", async () => {
    const VA_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const pool = makeMockPool((sql) => {
      if (sql.includes("information_schema.tables")) return { rows: [{ exists: true }] };
      if (sql.includes("FROM evidence_items")) {
        return {
          rows: [
            makeRow({
              evidence_id: "ev-with-va",
              source_visual_asset_id: VA_ID,
              content_text: "Chart shows ARR of $1.2M up from $800K in prior year.",
              tags: ["signal:phaseb_visual", "evidence_type:financial_metrics"],
            }),
          ],
        };
      }
      throw new Error(`Unexpected query: ${sql}`);
    });

    const result = await loadPhasebVisualEvidenceItems(pool, DEAL_ID);
    const item = result.business_model[0];
    expect(item).toBeDefined();
    // The evidenceVisualAssetById map is built by querying evidence_items directly (separate path),
    // but the returned source_visual_asset_id lets callers build supplementary maps.
    expect(item.source_visual_asset_id).toBe(VA_ID);
    expect(item.evidence_id).toBe("ev-with-va");
  });
});
