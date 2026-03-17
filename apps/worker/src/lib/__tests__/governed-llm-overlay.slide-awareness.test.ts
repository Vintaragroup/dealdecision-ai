import { describe, it, expect } from "vitest";

describe("governed-llm-overlay slide awareness helpers", () => {
  it("resolvedSlideTypeToNote maps raise-related types correctly", async () => {
    const { __test__ } = await import("../governed-llm-overlay.js");
    expect(__test__.resolvedSlideTypeToNote("raise_terms")).toBe("global_raise_terms");
    expect(__test__.resolvedSlideTypeToNote("use_of_funds")).toBe("global_raise_terms");
  });

  it("resolvedSlideTypeToNote maps business-model types correctly", async () => {
    const { __test__ } = await import("../governed-llm-overlay.js");
    expect(__test__.resolvedSlideTypeToNote("business_model")).toBe("global_business_model");
    expect(__test__.resolvedSlideTypeToNote("financials")).toBe("global_business_model");
    expect(__test__.resolvedSlideTypeToNote("go_to_market")).toBe("global_business_model");
  });

  it("resolvedSlideTypeToNote maps market/competition to global_market", async () => {
    const { __test__ } = await import("../governed-llm-overlay.js");
    expect(__test__.resolvedSlideTypeToNote("market")).toBe("global_market");
    expect(__test__.resolvedSlideTypeToNote("competition")).toBe("global_market");
  });

  it("resolvedSlideTypeToNote maps product types to global_product", async () => {
    const { __test__ } = await import("../governed-llm-overlay.js");
    expect(__test__.resolvedSlideTypeToNote("product")).toBe("global_product");
    expect(__test__.resolvedSlideTypeToNote("solution")).toBe("global_product");
    expect(__test__.resolvedSlideTypeToNote("traction")).toBe("global_product");
    expect(__test__.resolvedSlideTypeToNote("problem")).toBe("global_product");
  });

  it("resolvedSlideTypeToNote returns null for 'other'", async () => {
    const { __test__ } = await import("../governed-llm-overlay.js");
    expect(__test__.resolvedSlideTypeToNote("other")).toBeNull();
    expect(__test__.resolvedSlideTypeToNote("team")).toBe("global_context");
    expect(__test__.resolvedSlideTypeToNote("risks")).toBe("global_context");
  });

  it("isSlideTypeMatchForField: raise_terms matches raise fields", async () => {
    const { __test__ } = await import("../governed-llm-overlay.js");
    expect(__test__.isSlideTypeMatchForField("raise_terms", "raise_terms")).toBe(true);
    // use_of_funds slide type is matched via the raise_terms field
    expect(__test__.isSlideTypeMatchForField("use_of_funds", "raise_terms")).toBe(true);
    expect(__test__.isSlideTypeMatchForField("raise_terms", "market_icp")).toBe(false);
  });

  it("isSlideTypeMatchForField: business_model matches business fields", async () => {
    const { __test__ } = await import("../governed-llm-overlay.js");
    expect(__test__.isSlideTypeMatchForField("business_model", "business_model")).toBe(true);
    expect(__test__.isSlideTypeMatchForField("financials", "business_model")).toBe(true);
    expect(__test__.isSlideTypeMatchForField("go_to_market", "business_model")).toBe(true);
    expect(__test__.isSlideTypeMatchForField("business_model", "raise_terms")).toBe(false);
  });

  it("isSlideTypeMatchForField: market matches market_icp", async () => {
    const { __test__ } = await import("../governed-llm-overlay.js");
    expect(__test__.isSlideTypeMatchForField("market", "market_icp")).toBe(true);
    expect(__test__.isSlideTypeMatchForField("competition", "market_icp")).toBe(true);
    expect(__test__.isSlideTypeMatchForField("market", "raise_terms")).toBe(false);
  });

  it("isSlideTypeContradiction: low confidence never fires", async () => {
    const { __test__ } = await import("../governed-llm-overlay.js");
    expect(__test__.isSlideTypeContradiction("product", "raise_terms", 0.4)).toBe(false);
  });

  it("isSlideTypeContradiction: product high-conf contradicts product_solution field seeking raise-like", async () => {
    const { __test__ } = await import("../governed-llm-overlay.js");
    // Contradiction fires when a raise-like slide is used in a product/market field search
    expect(__test__.isSlideTypeContradiction("raise_terms", "product_solution", 0.8)).toBe(true);
    expect(__test__.isSlideTypeContradiction("use_of_funds", "product_solution", 0.7)).toBe(true);
    // product slide in product_solution field — no contradiction
    expect(__test__.isSlideTypeContradiction("product", "product_solution", 0.9)).toBe(false);
  });

  it("isSlideTypeContradiction: raise-like slide contradicts market_icp field", async () => {
    const { __test__ } = await import("../governed-llm-overlay.js");
    expect(__test__.isSlideTypeContradiction("raise_terms", "market_icp", 0.9)).toBe(true);
    // market slide in market_icp field — no contradiction
    expect(__test__.isSlideTypeContradiction("market", "market_icp", 0.9)).toBe(false);
  });
});

describe("gatherGlobalSummarySources: slide type integration", () => {
  it("assigns confirmed slide type note over snippet-only note", async () => {
    const { gatherGlobalSummarySources } = await import("../governed-llm-overlay.js");

    const pool: any = {
      query: async () => ({
        rows: [
          {
            document_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
            page_index: 0,
            payload: {
              // Page text has no financial keywords → snippet signals would give global_context
              page_text: "The leadership team has over 20 years of combined experience.",
              // But resolved_slide_type says raise_terms with high confidence
              resolved_slide_type: "raise_terms",
              resolved_slide_type_confidence: 0.85,
            },
          },
        ],
      }),
    };

    const res = await gatherGlobalSummarySources(pool, {
      documentIds: ["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"],
      targetCount: 5,
    });

    expect(res.sources.length).toBe(1);
    // confirmed slide type should override the snippet-only fallback
    expect(res.sources[0].note).toBe("global_raise_terms");
  });

  it("falls back to snippet-only note when slide type is 'other'", async () => {
    const { gatherGlobalSummarySources } = await import("../governed-llm-overlay.js");

    const pool: any = {
      query: async () => ({
        rows: [
          {
            document_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
            page_index: 0,
            payload: {
              page_text: "Product roadmap: Q1 launch, mobile app, enterprise integrations.",
              resolved_slide_type: "other",
              resolved_slide_type_confidence: 0.9,
            },
          },
        ],
      }),
    };

    const res = await gatherGlobalSummarySources(pool, {
      documentIds: ["bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"],
      targetCount: 5,
    });

    expect(res.sources.length).toBe(1);
    // "other" → no confirmed note → falls back to snippet signals
    expect(res.sources[0].note).toBe("global_product");
  });

  it("confirmed slide type note appears in sources when slide type is set", async () => {
    const { gatherGlobalSummarySources } = await import("../governed-llm-overlay.js");

    // Single page with confirmed slide type that would otherwise get global_context from snippet signals.
    const pool: any = {
      query: async () => ({
        rows: [
          {
            document_id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
            page_index: 0,
            payload: {
              page_text: "Some generic content on the slide here today.",
              resolved_slide_type: "market",
              resolved_slide_type_confidence: 0.8,
            },
          },
        ],
      }),
    };

    const res = await gatherGlobalSummarySources(pool, {
      documentIds: ["cccccccc-cccc-cccc-cccc-cccccccccccc"],
      targetCount: 5,
    });

    // Confirmed market slide type should produce global_market note.
    expect(res.sources.length).toBe(1);
    expect(res.sources[0].note).toBe("global_market");
  });

  it("returns empty sources when documentIds is empty", async () => {
    const { gatherGlobalSummarySources } = await import("../governed-llm-overlay.js");
    const pool: any = { query: async () => ({ rows: [] }) };
    const res = await gatherGlobalSummarySources(pool, { documentIds: [] });
    expect(res.sources).toEqual([]);
    expect(res.total_pages).toBe(0);
  });
});
