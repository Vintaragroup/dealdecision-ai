import { describe, it, expect } from "vitest";

import {
	computeGovernedLlmOverviewInputHash,
	generateAndPersistGovernedLlmOverviewBestEffort,
	validateGovernedLlmOverviewV1,
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
});
