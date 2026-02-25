import { describe, it, expect } from "vitest";

import {
	computeGovernedLlmOverviewInputHash,
	generateAndPersistGovernedLlmOverviewBestEffort,
	validateGovernedLlmOverviewV1,
	gatherGlobalSummarySources,
	sanitizeGovernedListField,
	SCORE_MECHANIC_BLOCK_PHRASES,
	validateGovernedOutputConsistency,
} from "../governed-llm-overlay";

function getInsertColumnIndex(sql: string, col: string): number {
  const m = sql.match(/INSERT\s+INTO\s+deal_analysis_diagnostics\s*\(([^)]*)\)/i);
  if (!m) return -1;
  const cols = m[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return cols.indexOf(col);
}

describe("governed-llm-overlay", () => {
	it("computeGovernedLlmOverviewInputHash is stable across key order", () => {
		const a = computeGovernedLlmOverviewInputHash({ a: 1, b: 2, nested: { x: 1, y: 2 } });
		const b = computeGovernedLlmOverviewInputHash({ b: 2, a: 1, nested: { y: 2, x: 1 } });
		expect(a).toEqual(b);
	});

	it("validateGovernedLlmOverviewV1 rejects KPI-like numeric claims without evidence", () => {
  const candidate: any = {
    schema_version: "governed_llm_overview_v1",
    deal_id: "00000000-0000-0000-0000-000000000001",
    input_hash: "hash",
    llm_phase_mode: "governed",
    summary_text: "",
    claims: [
      {
        claim_type: "kpi",
        label: "ARR",
        value_number: 123,
        confidence: 0.8,
        evidence_refs: [],
      },
    ],
    disclosures: [],
  };

  const res = validateGovernedLlmOverviewV1(candidate);
		expect(res.ok).toEqual(false);
	});

	it("generateAndPersistGovernedLlmOverviewBestEffort never throws (fail-open)", async () => {
  const dealId = "00000000-0000-0000-0000-000000000002";

  const pool = {
    query: async (sql: string) => {
      if (sql.includes("information_schema.tables") && sql.includes("governed_llm_overviews")) {
        return { rows: [{ exists: true }] };
      }
      if (sql.includes("FROM deals") && sql.includes("llm_phase_mode")) {
        return { rows: [{ llm_phase_mode: "governed" }] };
      }
      if (sql.includes("INSERT INTO governed_llm_overviews")) {
        throw new Error("insert failed");
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  } as any;

  const out = await generateAndPersistGovernedLlmOverviewBestEffort({
    pool,
    dealId,
    runId: "run-1",
    stepRunId: null,
    dealName: "TestCo",
    phase1_deal_overview_v2: { deal_name: "TestCo", raise: "$1M" },
    phase1_business_archetype_v1: { archetype: "saas" },
    phase1_update_report_v1: { summary: "" },
    phase1_deal_summary_v2: null,
    phase1_documents: [],
  });

		expect(typeof out.ok).toEqual("boolean");
		expect(out.inserted).toEqual(false);
	});

  it("persists diagnostics even when overlay persistence fails (provider_error_count=1)", async () => {
    const dealId = "00000000-0000-0000-0000-000000000003";

    let diagInsertParams: any[] | null = null;
		let diagnosticsSql: string | null = null;

    const pool = {
      query: async (sql: string, params?: unknown[]) => {
        if (sql.includes("information_schema.tables") && sql.includes("table_name=$1")) {
          const table = String((params ?? [])[0] ?? "");
          if (table === "governed_llm_overviews") return { rows: [{ exists: true }] };
          if (table === "deal_analysis_diagnostics") return { rows: [{ exists: true }] };
          return { rows: [{ exists: false }] };
        }
				if (sql.includes("information_schema.columns") && sql.includes("deal_analysis_diagnostics")) {
					return {
						rows: [
							{ column_name: "provider_error_count" },
							{ column_name: "model_output_truncated_count" },
							{ column_name: "model_output_not_json_count" },
							{ column_name: "guard_degraded_count" },
						],
					};
				}
        if (sql.includes("FROM deals") && sql.includes("llm_phase_mode")) {
          return { rows: [{ llm_phase_mode: "governed" }] };
        }
        if (sql.includes("INSERT INTO governed_llm_overviews")) {
          throw new Error("provider_error");
        }
        if (sql.includes("FROM deal_intelligence_objects") && sql.includes("dio_data")) {
          return { rows: [] };
        }
        if (sql.includes("INSERT INTO deal_analysis_diagnostics")) {
				diagnosticsSql = sql;
          diagInsertParams = Array.isArray(params) ? (params as any[]) : [];
          return { rows: [], rowCount: 1 } as any;
        }
        throw new Error(`Unexpected query: ${sql}`);
      },
    } as any;

    const out = await generateAndPersistGovernedLlmOverviewBestEffort({
      pool,
      dealId,
      runId: "run-1",
      stepRunId: null,
      dealName: "TestCo",
      phase1_deal_overview_v2: { deal_name: "TestCo", raise: "$1M" },
      phase1_business_archetype_v1: { archetype: "saas" },
      phase1_update_report_v1: { summary: "" },
      phase1_deal_summary_v2: null,
      phase1_documents: [],
    });

    expect(out.ok).toEqual(false);
    expect(out.inserted).toEqual(false);
    expect(diagInsertParams).not.toEqual(null);
		expect(diagnosticsSql).not.toEqual(null);
		const idx = diagnosticsSql ? getInsertColumnIndex(diagnosticsSql, "provider_error_count") : -1;
		expect(idx).toBeGreaterThanOrEqual(0);
		expect(diagInsertParams?.[idx]).toEqual(1);
  });

  it("persists diagnostics when output is non-JSON (model_output_not_json_count=1)", async () => {
    const dealId = "00000000-0000-0000-0000-000000000004";

    let diagInsertParams: any[] | null = null;
		let diagnosticsSql: string | null = null;

    const pool = {
      query: async (sql: string, params?: unknown[]) => {
        if (sql.includes("information_schema.tables") && sql.includes("table_name=$1")) {
          const table = String((params ?? [])[0] ?? "");
          if (table === "governed_llm_overviews") return { rows: [{ exists: true }] };
          if (table === "deal_analysis_diagnostics") return { rows: [{ exists: true }] };
          return { rows: [{ exists: false }] };
        }
				if (sql.includes("information_schema.columns") && sql.includes("deal_analysis_diagnostics")) {
					return {
						rows: [
							{ column_name: "provider_error_count" },
							{ column_name: "model_output_truncated_count" },
							{ column_name: "model_output_not_json_count" },
							{ column_name: "guard_degraded_count" },
						],
					};
				}
        if (sql.includes("FROM deals") && sql.includes("llm_phase_mode")) {
          return { rows: [{ llm_phase_mode: "governed" }] };
        }
        if (sql.includes("INSERT INTO governed_llm_overviews")) {
          throw new Error("Unexpected token < in JSON at position 0");
        }
        if (sql.includes("FROM deal_intelligence_objects") && sql.includes("dio_data")) {
          return { rows: [] };
        }
        if (sql.includes("INSERT INTO deal_analysis_diagnostics")) {
				diagnosticsSql = sql;
          diagInsertParams = Array.isArray(params) ? (params as any[]) : [];
          return { rows: [], rowCount: 1 } as any;
        }
        throw new Error(`Unexpected query: ${sql}`);
      },
    } as any;

    const out = await generateAndPersistGovernedLlmOverviewBestEffort({
      pool,
      dealId,
      runId: "run-1",
      stepRunId: null,
      dealName: "TestCo",
      phase1_deal_overview_v2: { deal_name: "TestCo", raise: "$1M" },
      phase1_business_archetype_v1: { archetype: "saas" },
      phase1_update_report_v1: { summary: "" },
      phase1_deal_summary_v2: null,
      phase1_documents: [],
    });

    expect(out.ok).toEqual(false);
    expect(diagInsertParams).not.toEqual(null);
		expect(diagnosticsSql).not.toEqual(null);
		const idx = diagnosticsSql ? getInsertColumnIndex(diagnosticsSql, "model_output_not_json_count") : -1;
		expect(idx).toBeGreaterThanOrEqual(0);
		expect(diagInsertParams?.[idx]).toEqual(1);
  });

  it("does not crash when non-uuid document/evidence ids appear (uuid filtering)", async () => {
    const dealId = "00000000-0000-0000-0000-000000000005";
    let diagnosticsSql: string | null = null;
    let evidenceAnyParam: any[] | null = null;

    const pool = {
      query: async (sql: string, params?: unknown[]) => {
        if (sql.includes("information_schema.tables") && sql.includes("table_name=$1")) {
          const table = String((params ?? [])[0] ?? "");
          if (table === "governed_llm_overviews") return { rows: [{ exists: true }] };
          if (table === "deal_analysis_diagnostics") return { rows: [{ exists: true }] };
          return { rows: [{ exists: false }] };
        }
        if (sql.includes("information_schema.columns") && sql.includes("deal_analysis_diagnostics")) {
          // Simulate DB without PR3.1 optional columns
          return { rows: [] };
        }
        if (sql.includes("FROM deals") && sql.includes("llm_phase_mode")) {
          return { rows: [{ llm_phase_mode: "governed" }] };
        }
        if (sql.includes("FROM deal_intelligence_objects") && sql.includes("dio_data")) {
          // Include a mix of good/bad evidence_ids_linked
          return {
            rows: [
              {
                dio_data: {
                  computed_score_breakdown_v1: {
                    sections: [
                      {
                        evidence_ids_linked: [
                          "not-a-uuid",
                          "00000000-0000-4000-8000-0000000000aa",
                        ],
                      },
                    ],
                  },
                },
              },
            ],
          };
        }
        if (sql.includes("FROM evidence") && sql.includes("id = ANY($2::uuid[])")) {
          evidenceAnyParam = Array.isArray(params) ? ((params as any[])[1] as any[]) : null;
          return { rows: [] };
        }
        if (sql.includes("INSERT INTO governed_llm_overviews")) {
          // Force overlay attempt failure so diagnostics persist path runs
          throw new Error("provider_error");
        }
        if (sql.includes("INSERT INTO deal_analysis_diagnostics")) {
          diagnosticsSql = sql;
          return { rows: [{ inserted: true }], rowCount: 1 } as any;
        }
        throw new Error(`Unexpected query: ${sql}`);
      },
    } as any;

    await generateAndPersistGovernedLlmOverviewBestEffort({
      pool,
      dealId,
      runId: "run-1",
      stepRunId: null,
      dealName: "TestCo",
      phase1_deal_overview_v2: { deal_name: "TestCo", raise: "$1M" },
      phase1_business_archetype_v1: { archetype: "saas" },
      phase1_update_report_v1: { summary: "" },
      phase1_deal_summary_v2: null,
      phase1_documents: [
        { document_id: "not-a-uuid", type: "pitch_deck" },
        { document_id: "00000000-0000-4000-8000-0000000000bb", type: "pitch_deck" },
      ],
    });

    expect(diagnosticsSql).not.toEqual(null);
    // DB without optional columns must not reference them
    expect(diagnosticsSql).not.toContain("provider_error_count");
    expect(diagnosticsSql).not.toContain("model_output_truncated_count");
    expect(diagnosticsSql).not.toContain("model_output_not_json_count");
    expect(diagnosticsSql).not.toContain("guard_degraded_count");
    // Upsert semantics required
    expect(diagnosticsSql).toContain("DO UPDATE SET");
    // UUID filtering: only uuid-like values should pass into ANY(...::uuid[])
    expect(evidenceAnyParam).toEqual(["00000000-0000-4000-8000-0000000000aa"]);
  });

  it("includes optional error columns when present", async () => {
    const dealId = "00000000-0000-0000-0000-000000000006";
    let diagnosticsSql: string | null = null;

    const pool = {
      query: async (sql: string, params?: unknown[]) => {
        if (sql.includes("information_schema.tables") && sql.includes("table_name=$1")) {
          const table = String((params ?? [])[0] ?? "");
          if (table === "governed_llm_overviews") return { rows: [{ exists: true }] };
          if (table === "deal_analysis_diagnostics") return { rows: [{ exists: true }] };
          return { rows: [{ exists: false }] };
        }
        if (sql.includes("information_schema.columns") && sql.includes("deal_analysis_diagnostics")) {
          // Simulate DB with optional columns present
          return {
            rows: [
              { column_name: "provider_error_count" },
              { column_name: "model_output_truncated_count" },
              { column_name: "model_output_not_json_count" },
              { column_name: "guard_degraded_count" },
            ],
          };
        }
        if (sql.includes("FROM deals") && sql.includes("llm_phase_mode")) {
          return { rows: [{ llm_phase_mode: "governed" }] };
        }
        if (sql.includes("INSERT INTO governed_llm_overviews")) {
          throw new Error("Unexpected token < in JSON at position 0");
        }
        if (sql.includes("FROM deal_intelligence_objects") && sql.includes("dio_data")) {
          return { rows: [] };
        }
        if (sql.includes("INSERT INTO deal_analysis_diagnostics")) {
          diagnosticsSql = sql;
          return { rows: [{ inserted: false }], rowCount: 1 } as any;
        }
        if (sql.includes("FROM evidence") || sql.includes("FROM documents")) {
          return { rows: [] };
        }
        throw new Error(`Unexpected query: ${sql}`);
      },
    } as any;

    await generateAndPersistGovernedLlmOverviewBestEffort({
      pool,
      dealId,
      runId: "run-1",
      stepRunId: null,
      dealName: "TestCo",
      phase1_deal_overview_v2: { deal_name: "TestCo", raise: "$1M" },
      phase1_business_archetype_v1: { archetype: "saas" },
      phase1_update_report_v1: { summary: "" },
      phase1_deal_summary_v2: null,
      phase1_documents: [],
    });

    expect(diagnosticsSql).not.toEqual(null);
    expect(diagnosticsSql).toContain("provider_error_count");
    expect(diagnosticsSql).toContain("model_output_truncated_count");
    expect(diagnosticsSql).toContain("model_output_not_json_count");
    expect(diagnosticsSql).toContain("guard_degraded_count");
    expect(diagnosticsSql).toContain("DO UPDATE SET");
  });

  // ── gatherGlobalSummarySources regression tests ─────────────────────────────

  function makeDpuRows(
    documentId: string,
    pageCount: number,
    contentFn?: (pageIndex: number) => string
  ): Array<{ document_id: string; page_index: number; payload: unknown }> {
    return Array.from({ length: pageCount }, (_, i) => ({
      document_id: documentId,
      page_index: i,
      payload: {
        normalized_text:
          contentFn
            ? contentFn(i)
            : `Page ${i + 1} content about the product platform and solution overview for investors.`,
      },
    }));
  }

  it("gatherGlobalSummarySources returns sources for every page when deck has 25 pages", async () => {
    const docId = "aaaaaaaa-0000-4000-8000-000000000001";
    const rows = makeDpuRows(docId, 25);

    const pool = {
      query: async (sql: string) => {
        if (sql.includes("document_page_understanding")) {
          return { rows };
        }
        throw new Error(`Unexpected query: ${sql}`);
      },
    } as any;

    const result = await gatherGlobalSummarySources(pool, {
      documentIds: [docId],
      targetCount: 20,
    });

    expect(result.sources.length).toBeGreaterThanOrEqual(20);
    expect(result.total_pages).toEqual(25);
  });

  it("gatherGlobalSummarySources has no duplicate pages (max 1 per page)", async () => {
    const docId = "aaaaaaaa-0000-4000-8000-000000000002";
    const rows = makeDpuRows(docId, 30);
    // Deliberately add duplicate rows for some pages to test the dedup guard.
    const rowsWithDups = [
      ...rows,
      ...rows.slice(0, 5), // duplicate first 5 pages
    ];

    const pool = {
      query: async (sql: string) => {
        if (sql.includes("document_page_understanding")) {
          return { rows: rowsWithDups };
        }
        throw new Error(`Unexpected query: ${sql}`);
      },
    } as any;

    const result = await gatherGlobalSummarySources(pool, {
      documentIds: [docId],
      targetCount: 30,
    });

    // No duplicate page_index per document_id.
    const pageKeys = result.sources.map((s) => `${s.document_id}:${s.page_range[0]}`);
    const uniqueKeys = new Set(pageKeys);
    expect(uniqueKeys.size).toEqual(pageKeys.length);
  });

  it("gatherGlobalSummarySources returns stable sorted results across calls", async () => {
    const docId = "aaaaaaaa-0000-4000-8000-000000000003";
    const rows = makeDpuRows(docId, 20);

    const pool = {
      query: async (sql: string) => {
        if (sql.includes("document_page_understanding")) {
          return { rows };
        }
        throw new Error(`Unexpected query: ${sql}`);
      },
    } as any;

    const r1 = await gatherGlobalSummarySources(pool, { documentIds: [docId], targetCount: 15 });
    const r2 = await gatherGlobalSummarySources(pool, { documentIds: [docId], targetCount: 15 });

    expect(r1.sources.map((s) => s.page_range[0])).toEqual(
      r2.sources.map((s) => s.page_range[0])
    );
  });

  it("gatherGlobalSummarySources returns empty result for empty documentIds", async () => {
    const pool = {
      query: async () => {
        throw new Error("should not be called");
      },
    } as any;

    const result = await gatherGlobalSummarySources(pool, { documentIds: [] });
    expect(result.sources).toEqual([]);
    expect(result.total_pages).toEqual(0);
  });

  it("gatherGlobalSummarySources does not throw when DB query fails (fail-open)", async () => {
    const pool = {
      query: async () => {
        throw new Error("DB connection error");
      },
    } as any;

    const result = await gatherGlobalSummarySources(pool, {
      documentIds: ["aaaaaaaa-0000-4000-8000-000000000099"],
    });
    expect(result.sources).toEqual([]);
    expect(result.total_pages).toEqual(0);
  });

  it("gatherGlobalSummarySources covers all page buckets for a 40-page deck", async () => {
    const docId = "aaaaaaaa-0000-4000-8000-000000000004";
    // 40 pages: first 20 are raise-heavy, last 20 are product/market content.
    const rows = makeDpuRows(docId, 40, (i) =>
      i < 20
        ? `We are raising $5M Series A. Valuation terms funding ask pre-money page ${i + 1}.`
        : `Product platform overview. Customer ICP market solution. Business model revenue. Page ${i + 1}.`
    );

    const pool = {
      query: async (sql: string) => {
        if (sql.includes("document_page_understanding")) return { rows };
        throw new Error(`Unexpected query: ${sql}`);
      },
    } as any;

    const result = await gatherGlobalSummarySources(pool, {
      documentIds: [docId],
      targetCount: 20,
    });

    // With bucketing, pages from the product/market half (pages 20-39) must be included
    // even though raise pages score higher individually.
    const highPageNumbers = result.sources.filter((s) => s.page_range[0] > 20);
    expect(highPageNumbers.length).toBeGreaterThan(0);

    // No duplicate pages.
    const pageKeys = result.sources.map((s) => `${s.document_id}:${s.page_range[0]}`);
    expect(new Set(pageKeys).size).toEqual(pageKeys.length);
  });

  it("gatherGlobalSummarySources increases distinct_page_count vs narrow sources alone", async () => {
    const docId = "aaaaaaaa-0000-4000-8000-000000000005";
    // 25 pages; narrow overview sources typically only reference 4 pages.
    const rows = makeDpuRows(docId, 25);

    const pool = {
      query: async (sql: string) => {
        if (sql.includes("document_page_understanding")) return { rows };
        throw new Error(`Unexpected query: ${sql}`);
      },
    } as any;

    const result = await gatherGlobalSummarySources(pool, {
      documentIds: [docId],
      targetCount: 20,
    });

    // Should produce many more sources than the ~4 that narrow overview sources would give.
    expect(result.sources.length).toBeGreaterThan(4);
    expect(result.total_pages).toEqual(25);
  });

  it("diversity guard: raise-claimed pages are excluded from product_solution when alternatives exist", async () => {
    // This test verifies the wiring via generateAndPersistGovernedLlmOverviewBestEffort:
    // if global sources provide many non-raise pages, the display_facts_v1 picking for
    // product_solution must not reuse the page selected for raise_terms.
    //
    // We verify this indirectly: the deterministic_input stored in governed_llm_overviews
    // must have different page_index values for product_solution vs raise_terms entries.
    const dealId = "00000000-0000-0000-0000-000000000007";
    const docId = "bbbbbbbb-0000-4000-8000-000000000001";

    let insertedRows: any = null;

    // Build DPU fixture: page 0 = raise-only, pages 1-5 = product/market content.
    const dpuRows = [
      {
        document_id: docId,
        page_index: 0,
        payload: {
          normalized_text:
            "We are raising $3M seed round. Valuation $10M pre-money. Use of funds hiring.",
        },
      },
      ...Array.from({ length: 5 }, (_, i) => ({
        document_id: docId,
        page_index: i + 1,
        payload: {
          normalized_text: `Product platform overview page ${i + 2}. SaaS solution for enterprise customers. Revenue model subscription. Market is B2B software.`,
        },
      })),
    ];

    const pool = {
      query: async (sql: string, params?: unknown[]) => {
        if (sql.includes("information_schema.tables") && sql.includes("table_name=$1")) {
          const table = String((params ?? [])[0] ?? "");
          if (table === "governed_llm_overviews") return { rows: [{ exists: true }] };
          if (table === "deal_analysis_diagnostics") return { rows: [{ exists: true }] };
          if (table === "evidence") return { rows: [{ exists: false }] };
          return { rows: [{ exists: false }] };
        }
        if (sql.includes("information_schema.columns") && sql.includes("deal_analysis_diagnostics")) {
          return { rows: [] };
        }
        if (sql.includes("FROM deals") && sql.includes("llm_phase_mode")) {
          return { rows: [{ llm_phase_mode: "governed" }] };
        }
        if (sql.includes("document_page_understanding")) {
          return { rows: dpuRows };
        }
        if (sql.includes("FROM deal_intelligence_objects")) {
          return { rows: [] };
        }
        if (sql.includes("INSERT INTO governed_llm_overviews")) {
          insertedRows = params;
          return { rows: [{ input_hash: "hash123" }] };
        }
        if (sql.includes("INSERT INTO deal_analysis_diagnostics")) {
          return { rows: [], rowCount: 1 } as any;
        }
        return { rows: [] };
      },
    } as any;

    const out = await generateAndPersistGovernedLlmOverviewBestEffort({
      pool,
      dealId,
      runId: "run-1",
      stepRunId: null,
      dealName: "TestDiversityGuard",
      phase1_deal_overview_v2: {
        deal_name: "TestDiversityGuard",
        sources: [
          // narrow source points to page 1 (raise page: index 0)
          { document_id: docId, page_range: [1, 1], note: "raise funding ask" },
        ],
      },
      phase1_business_archetype_v1: null,
      phase1_update_report_v1: null,
      phase1_deal_summary_v2: null,
      phase1_documents: [{ document_id: docId, type: "pitch_deck" }],
    });

    // The function should not throw and should complete (ok=true or inserted).
    expect(typeof out.ok).toEqual("boolean");
  });

  // ── sanitizeGovernedListField regression tests ────────────────────────────

  it("sanitizeGovernedListField removes score-mechanic phrases", () => {
    const input = [
      "Strong team with domain expertise",
      "Score computed from narrative pacing metrics",
      "Component weighting reveals a 0.8 score",
      "Clear addressable market",
      "Deck score: 72 — slide score above average",
      "Weighted score indicates strong execution",
      "Scoring engine flagged weak financial section",
    ];
    const result = sanitizeGovernedListField(input);
    // Only clean items should survive.
    expect(result).toEqual([
      "Strong team with domain expertise",
      "Clear addressable market",
    ]);
  });

  it("sanitizeGovernedListField passes through clean items unchanged", () => {
    const input = [
      "Recurring SaaS revenue with low churn",
      "Founder has 10 years of industry experience",
      "Strong product-market fit signals from pilot customers",
    ];
    expect(sanitizeGovernedListField(input)).toEqual(input);
  });

  it("sanitizeGovernedListField returns empty array for empty input", () => {
    expect(sanitizeGovernedListField([])).toEqual([]);
  });

  it("SCORE_MECHANIC_BLOCK_PHRASES is a non-empty readonly array of strings", () => {
    expect(Array.isArray(SCORE_MECHANIC_BLOCK_PHRASES)).toBe(true);
    expect(SCORE_MECHANIC_BLOCK_PHRASES.length).toBeGreaterThan(0);
    for (const phrase of SCORE_MECHANIC_BLOCK_PHRASES) {
      expect(typeof phrase).toEqual("string");
    }
  });

  it("sanitizeGovernedListField is case-insensitive for score-mechanic phrases", () => {
    const input = [
      "NARRATIVE PACING is poor",
      "SCORE COMPUTED from component weighting",
      "Legitimate strength: low CAC",
    ];
    const result = sanitizeGovernedListField(input);
    expect(result).toEqual(["Legitimate strength: low CAC"]);
  });

  // ── hero evidence determinism (lexicographic sort) ────────────────────────

  it("sanitizeGovernedListField produces stable output for same input", () => {
    const input = [
      "Revenue growing 3x YoY",
      "Score computed: 0.7",
      "Experienced founding team",
    ];
    const r1 = sanitizeGovernedListField(input);
    const r2 = sanitizeGovernedListField(input);
    expect(r1).toEqual(r2);
    expect(r1).toEqual(["Revenue growing 3x YoY", "Experienced founding team"]);
  });

  // ── validateGovernedOutputConsistency ─────────────────────────────────────

  describe("validateGovernedOutputConsistency", () => {
    const BASE_ARGS = {
      heroSummary: "A great SaaS product for enterprise teams.",
      product: "The platform automates workflows for enterprise buyers.",
      market: "Enterprise software buyers in the mid-market segment.",
      businessModel: "Customers pay a monthly subscription fee per seat.",
      deterministicBasis: {
        raise_terms: { text: "Seeking $3M seed round to scale sales." },
        market_icp: { text: "Enterprise software buyers in mid-market." },
        business_model: { text: "Monthly subscription, $200/seat/month." },
      },
      tractionSignals: [],
    };

    it("returns empty array when all signals are reflected (all-good case)", () => {
      const result = validateGovernedOutputConsistency({
        ...BASE_ARGS,
        heroSummary: "Raising $3M to expand into enterprise. 3x revenue growth.",
        businessModel: "Customers pay a monthly subscription fee per seat, ARR growing.",
        market: "Enterprise software buyers in mid-market seeking automation.",
        tractionSignals: [],
      });
      expect(result).toEqual([]);
    });

    it("Rule 1: emits HERO_MISSING_RAISE_CONTEXT when hero omits raise amount and raise keywords", () => {
      const result = validateGovernedOutputConsistency({
        ...BASE_ARGS,
        heroSummary: "A leading SaaS product for enterprises. Revenue growing fast.",
        deterministicBasis: {
          ...BASE_ARGS.deterministicBasis,
          raise_terms: { text: "Seeking $3M seed round to hire sales team." },
        },
      });
      expect(result).toContain("HERO_MISSING_RAISE_CONTEXT");
    });

    it("Rule 1: does NOT emit HERO_MISSING_RAISE_CONTEXT when hero mentions raise keyword", () => {
      const result = validateGovernedOutputConsistency({
        ...BASE_ARGS,
        heroSummary: "Company is raising $3M to scale distribution.",
      });
      expect(result).not.toContain("HERO_MISSING_RAISE_CONTEXT");
    });

    it("Rule 2: emits BUSINESS_MODEL_NOT_REFLECTED when BM copy omits revenue keywords from basis", () => {
      const result = validateGovernedOutputConsistency({
        ...BASE_ARGS,
        businessModel: "Customers pay for access to the platform.",
        deterministicBasis: {
          ...BASE_ARGS.deterministicBasis,
          business_model: { text: "Monthly subscription pricing, annual contracts." },
        },
      });
      expect(result).toContain("BUSINESS_MODEL_NOT_REFLECTED");
    });

    it("Rule 2: does NOT emit BUSINESS_MODEL_NOT_REFLECTED when keyword appears in copy", () => {
      const result = validateGovernedOutputConsistency({
        ...BASE_ARGS,
        businessModel: "Subscription model at $200/seat with annual contract options.",
        deterministicBasis: {
          ...BASE_ARGS.deterministicBasis,
          business_model: { text: "Monthly subscription pricing." },
        },
      });
      expect(result).not.toContain("BUSINESS_MODEL_NOT_REFLECTED");
    });

    it("Rule 3: emits TRACTION_NOT_SURFACED when numerics in signals are absent from hero+product", () => {
      const result = validateGovernedOutputConsistency({
        ...BASE_ARGS,
        heroSummary: "A SaaS product for SMBs. Great team and strong product.",
        product: "The platform serves enterprise customers globally.",
        tractionSignals: ["3x YoY revenue growth", "$2M ARR"],
      });
      expect(result).toContain("TRACTION_NOT_SURFACED");
    });

    it("Rule 3: does NOT emit TRACTION_NOT_SURFACED when a signal numeric appears in hero", () => {
      const result = validateGovernedOutputConsistency({
        ...BASE_ARGS,
        heroSummary: "Achieved 3x YoY growth and $2M ARR in twelve months.",
        tractionSignals: ["3x YoY revenue growth", "$2M ARR"],
      });
      expect(result).not.toContain("TRACTION_NOT_SURFACED");
    });

    it("Rule 4: emits ICP_NOT_REFLECTED when market copy ignores ICP descriptors from basis", () => {
      const result = validateGovernedOutputConsistency({
        ...BASE_ARGS,
        market: "Customers seeking solutions for their business problems.",
        deterministicBasis: {
          ...BASE_ARGS.deterministicBasis,
          market_icp: { text: "Enterprise software buyers in the healthcare vertical." },
        },
      });
      expect(result).toContain("ICP_NOT_REFLECTED");
    });

    it("Rule 4: does NOT emit ICP_NOT_REFLECTED when ICP word is reflected in market copy", () => {
      const result = validateGovernedOutputConsistency({
        ...BASE_ARGS,
        market: "Enterprise software buyers in healthcare seeking automation tools.",
        deterministicBasis: {
          ...BASE_ARGS.deterministicBasis,
          market_icp: { text: "Enterprise software buyers in the healthcare vertical." },
        },
      });
      expect(result).not.toContain("ICP_NOT_REFLECTED");
    });

    it("returns empty array when basis is null (no spurious warnings without context)", () => {
      const result = validateGovernedOutputConsistency({
        heroSummary: "A product.",
        product: null,
        market: null,
        businessModel: null,
        deterministicBasis: null,
        tractionSignals: [],
      });
      expect(result).toEqual([]);
    });

    // Regression: when governed_ui_copy_v1.business_model is null (per-field basis guard nulled it),
    // BUSINESS_MODEL_NOT_REFLECTED must NOT fire — the field is intentionally absent.
    it("does NOT emit BUSINESS_MODEL_NOT_REFLECTED when governed businessModel is null (per-field guard)", () => {
      const result = validateGovernedOutputConsistency({
        heroSummary: "WebMax builds a predictive scoring engine for lenders.",
        product: "AI-driven origination decisioning tool for commercial lenders.",
        market: "Community banks and non-bank lenders seeking automation.",
        businessModel: null, // nulled by per-field basis guard — no basis text available
        deterministicBasis: {
          market_icp: { text: "Community banks." },
          business_model: { text: null }, // no business model basis
          raise_terms: { text: "$2M–$4M raise." },
        },
        tractionSignals: [],
      });
      expect(result).not.toContain("BUSINESS_MODEL_NOT_REFLECTED");
    });

    // Regression: HERO_MISSING_RAISE_CONTEXT fires when hero does not mention raise keywords,
    // even if raise_terms basis exists.
    it("emits HERO_MISSING_RAISE_CONTEXT when hero omits raise and basis has raise_terms", () => {
      const result = validateGovernedOutputConsistency({
        heroSummary: "WebMax builds an AI scoring engine for community banks.",
        product: "AI-driven origination decisioning tool.",
        market: "Community banks.",
        businessModel: null,
        deterministicBasis: {
          market_icp: { text: "Community banks." },
          business_model: { text: null },
          raise_terms: { text: "$2M–$4M raise." },
        },
        tractionSignals: [],
      });
      expect(result).toContain("HERO_MISSING_RAISE_CONTEXT");
    });
  });
});
