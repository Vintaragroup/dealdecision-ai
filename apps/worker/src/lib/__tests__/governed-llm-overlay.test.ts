import { describe, it, expect } from "vitest";

import {
	computeGovernedLlmOverviewInputHash,
	generateAndPersistGovernedLlmOverviewBestEffort,
	validateGovernedLlmOverviewV1,
} from "../governed-llm-overlay";

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
});
