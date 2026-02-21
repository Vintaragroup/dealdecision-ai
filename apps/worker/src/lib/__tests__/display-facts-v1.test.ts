import { describe, it, expect, vi } from "vitest";
import { createHash } from "crypto";

import { OpenAIGPT4oProvider } from "../llm/providers/openai-provider";
import { generateAndPersistGovernedLlmOverviewBestEffort } from "../governed-llm-overlay";

function deterministicUuidFromKey(key: string): string {
  const digest = createHash("sha256").update(key).digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

describe("display_facts_v1 (governed overlay)", () => {
  it("repairs out-of-field evidence_ids to allowed set when deterministic candidates exist", async () => {
    const originalKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-key";
    const dealId = "00000000-0000-0000-0000-000000000101";
    const documentId = "00000000-0000-4000-8000-000000000201";

    const expectedEvidenceId = deterministicUuidFromKey(
      `display_fact_v1|${dealId}|product_solution|${documentId}|0`
    );

    const completeSpy = vi
      .spyOn(OpenAIGPT4oProvider.prototype as any, "complete")
      .mockResolvedValueOnce({
        content: JSON.stringify({
          product_solution: { text: "Clean statement", evidence_ids: ["not-a-real-evidence-id"], evidence_basis: "direct_snippet" },
          market_icp: { text: null, evidence_ids: [], evidence_basis: "no_evidence" },
          business_model: { text: null, evidence_ids: [], evidence_basis: "no_evidence" },
          raise_terms: { text: null, evidence_ids: [], evidence_basis: "no_evidence" },
        }),
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          hero_summary: "Clean statement",
          product_solution: "Clean statement",
          market_icp: null,
          business_model: null,
          raise_terms: null,
        }),
      });

    let capturedOverviewJson: any = null;

    const pool = {
      query: async (sql: string, params?: unknown[]) => {
        if (sql.includes("information_schema.tables") && sql.includes("table_name=$1")) {
          const table = String((params ?? [])[0] ?? "");
          if (table === "governed_llm_overviews") return { rows: [{ exists: true }] };
          if (table === "evidence") return { rows: [{ exists: true }] };
          return { rows: [{ exists: false }] };
        }
        if (sql.includes("information_schema.columns") && sql.includes("table_name=$1") && sql.includes("column_name=$2")) {
          // hasColumn checks
          return { rows: [{ ok: 1 }] };
        }
        if (sql.includes("FROM deals") && sql.includes("llm_phase_mode")) {
          return { rows: [{ llm_phase_mode: "governed" }] };
        }
        if (sql.includes("SELECT payload FROM document_page_understanding")) {
          return { rows: [{ payload: { normalized_text: "NOISY OCR SOUP about the product and what it does for customers (with extra filler to exceed minimum length)." } }] };
        }
        if (sql.includes("INSERT INTO evidence")) {
          return { rows: [], rowCount: 1 } as any;
        }
        if (sql.includes("FROM deal_intelligence_objects") && sql.includes("dio_data")) {
          return { rows: [] };
        }
        if (sql.includes("FROM evidence") || sql.includes("FROM documents")) {
          return { rows: [] };
        }
        if (sql.includes("INSERT INTO governed_llm_overviews")) {
          // params: ... overview_json is last
          capturedOverviewJson = Array.isArray(params) ? (params as any[])[9] : null;
          return { rows: [], rowCount: 1 } as any;
        }
        throw new Error(`Unexpected query: ${sql}`);
      },
    } as any;

    try {
      const out = await generateAndPersistGovernedLlmOverviewBestEffort({
        pool,
        dealId,
        runId: "run-1",
        stepRunId: null,
        dealName: "TestCo",
        phase1_deal_overview_v2: {
          deal_name: "TestCo",
          sources: [{ document_id: documentId, page_range: [1, 1], note: "definition" }],
        },
        phase1_business_archetype_v1: { archetype: "saas" },
        phase1_update_report_v1: { summary: "" },
        phase1_deal_summary_v2: null,
        phase1_documents: [],
      });

      expect(out.ok).toEqual(true);
      expect(completeSpy).toHaveBeenCalled();
      expect(capturedOverviewJson).not.toEqual(null);

      const parsed = typeof capturedOverviewJson === "string" ? JSON.parse(capturedOverviewJson) : capturedOverviewJson;
      expect(parsed.display_facts_v1?.schema_version).toEqual("display_facts_v1");
      expect(parsed.display_facts_v1?.product_solution?.text).toEqual("Clean statement");
      expect(parsed.display_facts_v1?.product_solution?.evidence_ids).toEqual([expectedEvidenceId]);
      expect(parsed.display_facts_v1_quality?.ok).toEqual(true);
      expect(parsed.display_facts_v1_quality?.guard_degraded).toEqual(true);
      expect(parsed.display_facts_v1_quality?.errors ?? []).toContain("product_solution_evidence_ids_repaired_to_allowed");

      // Downstream governed UI copy should be generated (not missing_display_facts_v1).
      expect(parsed.phase1?.governed_ui_copy_v1?.schema_version).toEqual("governed_ui_copy_v1");
      expect(parsed.phase1?.governed_ui_copy_v1_quality?.ok).toEqual(true);
    } finally {
      if (originalKey == null) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = originalKey;
      vi.restoreAllMocks();
    }
  });

  it("routes product_solution away from raise/terms snippets (note+snippet heuristics)", async () => {
    const originalKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-key";
    const dealId = "00000000-0000-0000-0000-000000000105";
    const documentId = "00000000-0000-4000-8000-000000000205";

    const raiseLikePageIndex = 1; // page_range [2,2]
    const productLikePageIndex = 2; // page_range [3,3]
    const raiseLikeEvidenceIfWrong = deterministicUuidFromKey(
      `display_fact_v1|${dealId}|product_solution|${documentId}|${raiseLikePageIndex}`
    );
    const expectedProductEvidenceId = deterministicUuidFromKey(
      `display_fact_v1|${dealId}|product_solution|${documentId}|${productLikePageIndex}`
    );

    let capturedDisplayFactsPayload: any = null;

    vi.spyOn(OpenAIGPT4oProvider.prototype as any, "complete")
      .mockImplementationOnce(async (req: any) => {
        const user = req?.messages?.find((m: any) => m?.role === "user")?.content;
        capturedDisplayFactsPayload = JSON.parse(String(user ?? "{}"));
        const psAllowed: string[] = capturedDisplayFactsPayload?.allowed_evidence_ids?.product_solution ?? [];
        return {
          content: JSON.stringify({
            product_solution: { text: "We provide a platform for operators.", evidence_ids: [psAllowed[0]], evidence_basis: "direct_snippet" },
            market_icp: { text: null, evidence_ids: [], evidence_basis: "no_evidence" },
            business_model: { text: null, evidence_ids: [], evidence_basis: "no_evidence" },
            raise_terms: { text: null, evidence_ids: [], evidence_basis: "no_evidence" },
          }),
        };
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          hero_summary: "We provide a platform for operators.",
          product_solution: "We provide a platform for operators.",
          market_icp: null,
          business_model: null,
          raise_terms: null,
        }),
      });

    let capturedOverviewJson: any = null;

    const pool = {
      query: async (sql: string, params?: unknown[]) => {
        if (sql.includes("information_schema.tables") && sql.includes("table_name=$1")) {
          const table = String((params ?? [])[0] ?? "");
          if (table === "governed_llm_overviews") return { rows: [{ exists: true }] };
          if (table === "evidence") return { rows: [{ exists: true }] };
          return { rows: [{ exists: false }] };
        }
        if (sql.includes("information_schema.columns") && sql.includes("table_name=$1") && sql.includes("column_name=$2")) {
          return { rows: [{ ok: 1 }] };
        }
        if (sql.includes("FROM deals") && sql.includes("llm_phase_mode")) {
          return { rows: [{ llm_phase_mode: "governed" }] };
        }
        if (sql.includes("SELECT payload FROM document_page_understanding")) {
          const pageIndex = Number((params ?? [])[1]);
          if (pageIndex === raiseLikePageIndex) {
            return {
              rows: [
                { payload: { normalized_text: "We are raising $5M at a $20M pre-money valuation. Terms: SAFE. Multiple 10x." } },
              ],
            };
          }
          if (pageIndex === productLikePageIndex) {
            return {
              rows: [
                { payload: { normalized_text: "Product overview: Our platform/solution helps operators automate workflows. What we do: streamline operations." } },
              ],
            };
          }
          return { rows: [] };
        }
        if (sql.includes("INSERT INTO evidence")) {
          return { rows: [], rowCount: 1 } as any;
        }
        if (sql.includes("FROM deal_intelligence_objects") && sql.includes("dio_data")) {
          return { rows: [] };
        }
        if (sql.includes("FROM evidence") || sql.includes("FROM documents")) {
          return { rows: [] };
        }
        if (sql.includes("INSERT INTO governed_llm_overviews")) {
          capturedOverviewJson = Array.isArray(params) ? (params as any[])[9] : null;
          return { rows: [], rowCount: 1 } as any;
        }
        throw new Error(`Unexpected query: ${sql}`);
      },
    } as any;

    try {
      const out = await generateAndPersistGovernedLlmOverviewBestEffort({
        pool,
        dealId,
        runId: "run-1",
        stepRunId: null,
        dealName: "TestCo",
        phase1_deal_overview_v2: {
          deal_name: "TestCo",
          sources: [
            { document_id: documentId, page_range: [2, 2], note: undefined },
            { document_id: documentId, page_range: [3, 3], note: undefined },
          ],
        },
        phase1_business_archetype_v1: { archetype: "saas" },
        phase1_update_report_v1: { summary: "" },
        phase1_deal_summary_v2: null,
        phase1_documents: [],
      });

      expect(out.ok).toEqual(true);
      expect(capturedDisplayFactsPayload).toBeTruthy();

      const allowed = capturedDisplayFactsPayload?.allowed_evidence_ids?.product_solution ?? [];
      expect(allowed).toContain(expectedProductEvidenceId);
      expect(allowed).not.toContain(raiseLikeEvidenceIfWrong);

      expect(capturedOverviewJson).not.toEqual(null);
      const parsed = typeof capturedOverviewJson === "string" ? JSON.parse(capturedOverviewJson) : capturedOverviewJson;
      expect(parsed.display_facts_v1?.product_solution?.evidence_ids).toEqual([expectedProductEvidenceId]);
    } finally {
      if (originalKey == null) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = originalKey;
      vi.restoreAllMocks();
    }
  });

  it("filters per-field evidence_ids to in-scope set and keeps other fields valid", async () => {
    const originalKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-key";
    const dealId = "00000000-0000-0000-0000-000000000104";
    const documentId = "00000000-0000-4000-8000-000000000204";

    const expectedProductEvidenceId = deterministicUuidFromKey(
      `display_fact_v1|${dealId}|product_solution|${documentId}|0`
    );
    const expectedMarketEvidenceId = deterministicUuidFromKey(
      `display_fact_v1|${dealId}|market_icp|${documentId}|0`
    );
    const bogusEvidenceId = "ffffffff-ffff-4fff-8fff-ffffffffffff";

    vi.spyOn(OpenAIGPT4oProvider.prototype as any, "complete")
      .mockResolvedValueOnce({
        content: JSON.stringify({
          product_solution: { text: "Concise product statement.", evidence_ids: [expectedProductEvidenceId], evidence_basis: "direct_snippet" },
          market_icp: { text: "Target customers are SMB operators.", evidence_ids: [bogusEvidenceId, expectedMarketEvidenceId], evidence_basis: "direct_snippet" },
          business_model: { text: null, evidence_ids: [], evidence_basis: "no_evidence" },
          raise_terms: { text: null, evidence_ids: [], evidence_basis: "no_evidence" },
        }),
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          hero_summary: "Concise product statement.",
          product_solution: "Concise product statement.",
          market_icp: "Target customers are SMB operators.",
          business_model: null,
          raise_terms: null,
        }),
      });

    let capturedOverviewJson: any = null;

    const pool = {
      query: async (sql: string, params?: unknown[]) => {
        if (sql.includes("information_schema.tables") && sql.includes("table_name=$1")) {
          const table = String((params ?? [])[0] ?? "");
          if (table === "governed_llm_overviews") return { rows: [{ exists: true }] };
          if (table === "evidence") return { rows: [{ exists: true }] };
          return { rows: [{ exists: false }] };
        }
        if (sql.includes("information_schema.columns") && sql.includes("table_name=$1") && sql.includes("column_name=$2")) {
          return { rows: [{ ok: 1 }] };
        }
        if (sql.includes("FROM deals") && sql.includes("llm_phase_mode")) {
          return { rows: [{ llm_phase_mode: "governed" }] };
        }
        if (sql.includes("SELECT payload FROM document_page_understanding")) {
          return { rows: [{ payload: { normalized_text: "NOISY OCR SOUP about the product and what it does for customers (with extra filler to exceed minimum length)." } }] };
        }
        if (sql.includes("INSERT INTO evidence")) {
          return { rows: [], rowCount: 1 } as any;
        }
        if (sql.includes("FROM deal_intelligence_objects") && sql.includes("dio_data")) {
          return { rows: [] };
        }
        if (sql.includes("FROM evidence") || sql.includes("FROM documents")) {
          return { rows: [] };
        }
        if (sql.includes("INSERT INTO governed_llm_overviews")) {
          capturedOverviewJson = Array.isArray(params) ? (params as any[])[9] : null;
          return { rows: [], rowCount: 1 } as any;
        }
        throw new Error(`Unexpected query: ${sql}`);
      },
    } as any;

    try {
      const out = await generateAndPersistGovernedLlmOverviewBestEffort({
        pool,
        dealId,
        runId: "run-1",
        stepRunId: null,
        dealName: "TestCo",
        phase1_deal_overview_v2: {
          deal_name: "TestCo",
          sources: [{ document_id: documentId, page_range: [1, 1], note: "definition" }],
        },
        phase1_business_archetype_v1: { archetype: "saas" },
        phase1_update_report_v1: { summary: "" },
        phase1_deal_summary_v2: null,
        phase1_documents: [],
      });

      expect(out.ok).toEqual(true);
      expect(capturedOverviewJson).not.toEqual(null);

      const parsed = typeof capturedOverviewJson === "string" ? JSON.parse(capturedOverviewJson) : capturedOverviewJson;
      expect(parsed.display_facts_v1?.schema_version).toEqual("display_facts_v1");
      expect(parsed.display_facts_v1?.product_solution?.evidence_ids).toEqual([expectedProductEvidenceId]);
      expect(parsed.display_facts_v1?.market_icp?.evidence_ids).toEqual([expectedMarketEvidenceId]);
      expect(parsed.display_facts_v1?.market_icp?.text).toEqual("Target customers are SMB operators.");
      expect(parsed.display_facts_v1_quality?.ok).toEqual(true);
      expect(parsed.display_facts_v1_quality?.guard_degraded).toEqual(true);
      expect(parsed.display_facts_v1_quality?.errors ?? []).toContain("market_icp_evidence_ids_repaired_to_allowed");
    } finally {
      if (originalKey == null) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = originalKey;
      vi.restoreAllMocks();
    }
  });

  it("repairs market_icp bogus evidence_id to in-scope allowed evidence_id and preserves text", async () => {
    const originalKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-key";
    const dealId = "00000000-0000-0000-0000-000000000106";
    const documentId = "00000000-0000-4000-8000-000000000206";

    const expectedMarketEvidenceId = deterministicUuidFromKey(
      `display_fact_v1|${dealId}|market_icp|${documentId}|0`
    );

    vi.spyOn(OpenAIGPT4oProvider.prototype as any, "complete")
      .mockResolvedValueOnce({
        content: JSON.stringify({
          product_solution: { text: null, evidence_ids: [], evidence_basis: "no_evidence" },
          market_icp: { text: "Target customers are SMB operators.", evidence_ids: ["ffffffff-ffff-4fff-8fff-ffffffffffff"], evidence_basis: "direct_snippet" },
          business_model: { text: null, evidence_ids: [], evidence_basis: "no_evidence" },
          raise_terms: { text: null, evidence_ids: [], evidence_basis: "no_evidence" },
        }),
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          hero_summary: null,
          product_solution: null,
          market_icp: "Target customers are SMB operators.",
          business_model: null,
          raise_terms: null,
        }),
      });

    let capturedOverviewJson: any = null;

    const pool = {
      query: async (sql: string, params?: unknown[]) => {
        if (sql.includes("information_schema.tables") && sql.includes("table_name=$1")) {
          const table = String((params ?? [])[0] ?? "");
          if (table === "governed_llm_overviews") return { rows: [{ exists: true }] };
          if (table === "evidence") return { rows: [{ exists: true }] };
          return { rows: [{ exists: false }] };
        }
        if (sql.includes("information_schema.columns") && sql.includes("table_name=$1") && sql.includes("column_name=$2")) {
          return { rows: [{ ok: 1 }] };
        }
        if (sql.includes("FROM deals") && sql.includes("llm_phase_mode")) {
          return { rows: [{ llm_phase_mode: "governed" }] };
        }
        if (sql.includes("SELECT payload FROM document_page_understanding")) {
          return {
            rows: [
              { payload: { normalized_text: "Market/ICP: Our target customers are SMB operators managing inventory." } },
            ],
          };
        }
        if (sql.includes("INSERT INTO evidence")) {
          return { rows: [], rowCount: 1 } as any;
        }
        if (sql.includes("FROM deal_intelligence_objects") && sql.includes("dio_data")) {
          return { rows: [] };
        }
        if (sql.includes("FROM evidence") || sql.includes("FROM documents")) {
          return { rows: [] };
        }
        if (sql.includes("INSERT INTO governed_llm_overviews")) {
          capturedOverviewJson = Array.isArray(params) ? (params as any[])[9] : null;
          return { rows: [], rowCount: 1 } as any;
        }
        throw new Error(`Unexpected query: ${sql}`);
      },
    } as any;

    try {
      const out = await generateAndPersistGovernedLlmOverviewBestEffort({
        pool,
        dealId,
        runId: "run-1",
        stepRunId: null,
        dealName: "TestCo",
        phase1_deal_overview_v2: {
          deal_name: "TestCo",
          sources: [{ document_id: documentId, page_range: [1, 1], note: "icp" }],
        },
        phase1_business_archetype_v1: { archetype: "saas" },
        phase1_update_report_v1: { summary: "" },
        phase1_deal_summary_v2: null,
        phase1_documents: [],
      });

      expect(out.ok).toEqual(true);
      expect(capturedOverviewJson).not.toEqual(null);

      const parsed = typeof capturedOverviewJson === "string" ? JSON.parse(capturedOverviewJson) : capturedOverviewJson;
      expect(parsed.display_facts_v1?.market_icp?.evidence_ids).toEqual([expectedMarketEvidenceId]);
      expect(parsed.display_facts_v1?.market_icp?.text).toEqual("Target customers are SMB operators.");
      expect(parsed.display_facts_v1_quality?.guard_degraded).toEqual(true);
      expect(parsed.display_facts_v1_quality?.errors ?? []).toContain("market_icp_evidence_ids_repaired_to_allowed");
    } finally {
      if (originalKey == null) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = originalKey;
      vi.restoreAllMocks();
    }
  });

  it("accepts valid evidence_ids and persists display_facts_v1", async () => {
    const originalKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-key";
    const dealId = "00000000-0000-0000-0000-000000000102";
    const documentId = "00000000-0000-4000-8000-000000000202";

    const expectedEvidenceId = deterministicUuidFromKey(
      `display_fact_v1|${dealId}|product_solution|${documentId}|0`
    );

    vi.spyOn(OpenAIGPT4oProvider.prototype as any, "complete")
      .mockResolvedValueOnce({
        content: JSON.stringify({
          product_solution: { text: "Concise product statement.", evidence_ids: [expectedEvidenceId], evidence_basis: "direct_snippet" },
          market_icp: { text: null, evidence_ids: [], evidence_basis: "no_evidence" },
          business_model: { text: null, evidence_ids: [], evidence_basis: "no_evidence" },
          raise_terms: { text: null, evidence_ids: [], evidence_basis: "no_evidence" },
        }),
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          hero_summary: "Concise product statement.",
          product_solution: "Concise product statement.",
          market_icp: null,
          business_model: null,
          raise_terms: null,
        }),
      });

    let capturedOverviewJson: any = null;

    const pool = {
      query: async (sql: string, params?: unknown[]) => {
        if (sql.includes("information_schema.tables") && sql.includes("table_name=$1")) {
          const table = String((params ?? [])[0] ?? "");
          if (table === "governed_llm_overviews") return { rows: [{ exists: true }] };
          if (table === "evidence") return { rows: [{ exists: true }] };
          return { rows: [{ exists: false }] };
        }
        if (sql.includes("information_schema.columns") && sql.includes("table_name=$1") && sql.includes("column_name=$2")) {
          return { rows: [{ ok: 1 }] };
        }
        if (sql.includes("FROM deals") && sql.includes("llm_phase_mode")) {
          return { rows: [{ llm_phase_mode: "governed" }] };
        }
        if (sql.includes("SELECT payload FROM document_page_understanding")) {
          return { rows: [{ payload: { normalized_text: "NOISY OCR SOUP about the product and what it does for customers (with extra filler to exceed minimum length)." } }] };
        }
        if (sql.includes("INSERT INTO evidence")) {
          return { rows: [], rowCount: 1 } as any;
        }
        if (sql.includes("FROM deal_intelligence_objects") && sql.includes("dio_data")) {
          return { rows: [] };
        }
        if (sql.includes("FROM evidence") || sql.includes("FROM documents")) {
          return { rows: [] };
        }
        if (sql.includes("INSERT INTO governed_llm_overviews")) {
          capturedOverviewJson = Array.isArray(params) ? (params as any[])[9] : null;
          return { rows: [], rowCount: 1 } as any;
        }
        throw new Error(`Unexpected query: ${sql}`);
      },
    } as any;

    try {
      const out = await generateAndPersistGovernedLlmOverviewBestEffort({
        pool,
        dealId,
        runId: "run-1",
        stepRunId: null,
        dealName: "TestCo",
        phase1_deal_overview_v2: {
          deal_name: "TestCo",
          sources: [{ document_id: documentId, page_range: [1, 1], note: "definition" }],
        },
        phase1_business_archetype_v1: { archetype: "saas" },
        phase1_update_report_v1: { summary: "" },
        phase1_deal_summary_v2: null,
        phase1_documents: [],
      });

      expect(out.ok).toEqual(true);
      expect(capturedOverviewJson).not.toEqual(null);

      const parsed = typeof capturedOverviewJson === "string" ? JSON.parse(capturedOverviewJson) : capturedOverviewJson;
      expect(parsed.display_facts_v1?.schema_version).toEqual("display_facts_v1");
      expect(parsed.display_facts_v1?.product_solution?.evidence_ids).toEqual([expectedEvidenceId]);
      expect(parsed.display_facts_v1?.product_solution?.text).toEqual("Concise product statement.");
      expect(parsed.display_facts_v1_quality?.ok).toEqual(true);

      expect(parsed.phase1?.governed_ui_copy_v1?.schema_version).toEqual("governed_ui_copy_v1");
      expect(parsed.phase1?.governed_ui_copy_v1?.product_solution).toEqual("Concise product statement.");
      expect(parsed.phase1?.governed_ui_copy_v1?.evidence_ids?.product_solution).toEqual([expectedEvidenceId]);
      expect(parsed.phase1?.governed_ui_copy_v1?.evidence_map).toBeTruthy();
      expect(Array.isArray(parsed.phase1?.governed_ui_copy_v1?.evidence_map?.product_solution)).toEqual(true);
      expect(parsed.phase1?.governed_ui_copy_v1?.evidence_map?.product_solution?.[0]?.source_document_id).toEqual(documentId);
      expect(parsed.phase1?.governed_ui_copy_v1?.evidence_map?.product_solution?.[0]?.page_index).toEqual(0);
      expect(typeof parsed.phase1?.governed_ui_copy_v1?.evidence_map?.product_solution?.[0]?.snippet).toEqual("string");
      expect(parsed.phase1?.governed_ui_copy_v1_quality?.ok).toEqual(true);
    } finally {
      if (originalKey == null) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = originalKey;
      vi.restoreAllMocks();
    }
  });

  it("is compatible with evidence_id-only evidence table schema", async () => {
    const originalKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "test-key";
    const dealId = "00000000-0000-0000-0000-000000000103";
    const documentId = "00000000-0000-4000-8000-000000000203";

    const expectedEvidenceId = deterministicUuidFromKey(
      `display_fact_v1|${dealId}|product_solution|${documentId}|0`
    );

    vi.spyOn(OpenAIGPT4oProvider.prototype as any, "complete")
      .mockResolvedValueOnce({
        content: JSON.stringify({
          product_solution: { text: "Concise product statement.", evidence_ids: [expectedEvidenceId], evidence_basis: "direct_snippet" },
          market_icp: { text: null, evidence_ids: [], evidence_basis: "no_evidence" },
          business_model: { text: null, evidence_ids: [], evidence_basis: "no_evidence" },
          raise_terms: { text: null, evidence_ids: [], evidence_basis: "no_evidence" },
        }),
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          hero_summary: "Concise product statement.",
          product_solution: "Concise product statement.",
          market_icp: null,
          business_model: null,
          raise_terms: null,
        }),
      });

    let capturedOverviewJson: any = null;
    let capturedEvidenceInsertSql: string | null = null;

    const pool = {
      query: async (sql: string, params?: unknown[]) => {
        if (sql.includes("information_schema.tables") && sql.includes("table_name=$1")) {
          const table = String((params ?? [])[0] ?? "");
          if (table === "governed_llm_overviews") return { rows: [{ exists: true }] };
          if (table === "evidence") return { rows: [{ exists: true }] };
          return { rows: [{ exists: false }] };
        }

        if (sql.includes("information_schema.columns") && sql.includes("table_name=$1") && sql.includes("column_name=$2")) {
          const table = String((params ?? [])[0] ?? "");
          const column = String((params ?? [])[1] ?? "");
          if (table === "evidence") {
            // Simulate canonical migration schema: evidence_id exists, id does NOT.
            if (column === "id") return { rows: [] };
            if (column === "evidence_id") return { rows: [{ ok: 1 }] };
            // Remaining optional/required columns present.
            return { rows: [{ ok: 1 }] };
          }
          // Default: present.
          return { rows: [{ ok: 1 }] };
        }

        if (sql.includes("FROM deals") && sql.includes("llm_phase_mode")) {
          return { rows: [{ llm_phase_mode: "governed" }] };
        }

        if (sql.includes("SELECT payload FROM document_page_understanding")) {
          return { rows: [{ payload: { normalized_text: "NOISY OCR SOUP about the product and what it does for customers (with extra filler to exceed minimum length)." } }] };
        }

        if (sql.includes("INSERT INTO evidence")) {
          capturedEvidenceInsertSql = sql;
          // Support RETURNING ... AS evidence_id in the implementation.
          return { rows: [{ evidence_id: expectedEvidenceId }], rowCount: 1 } as any;
        }

        if (sql.includes("FROM deal_intelligence_objects") && sql.includes("dio_data")) {
          return { rows: [] };
        }

        if (sql.includes("FROM evidence") || sql.includes("FROM documents")) {
          return { rows: [] };
        }

        if (sql.includes("INSERT INTO governed_llm_overviews")) {
          capturedOverviewJson = Array.isArray(params) ? (params as any[])[9] : null;
          return { rows: [], rowCount: 1 } as any;
        }

        throw new Error(`Unexpected query: ${sql}`);
      },
    } as any;

    try {
      const out = await generateAndPersistGovernedLlmOverviewBestEffort({
        pool,
        dealId,
        runId: "run-1",
        stepRunId: null,
        dealName: "TestCo",
        phase1_deal_overview_v2: {
          deal_name: "TestCo",
          sources: [{ document_id: documentId, page_range: [1, 1], note: "definition" }],
        },
        phase1_business_archetype_v1: { archetype: "saas" },
        phase1_update_report_v1: { summary: "" },
        phase1_deal_summary_v2: null,
        phase1_documents: [],
      });

      expect(out.ok).toEqual(true);
      expect(capturedEvidenceInsertSql).toContain("INSERT INTO evidence");
      // Critical: evidence insert must be compatible with evidence_id-only schemas.
      expect(capturedEvidenceInsertSql).toContain("evidence_id");
      expect(capturedEvidenceInsertSql).not.toContain("ON CONFLICT (id)");

      expect(capturedOverviewJson).not.toEqual(null);
      const parsed = typeof capturedOverviewJson === "string" ? JSON.parse(capturedOverviewJson) : capturedOverviewJson;

      expect(parsed.display_facts_v1_quality?.skipped_reason ?? null).not.toEqual("no_evidence");
      expect(parsed.display_facts_v1?.product_solution?.evidence_ids).toEqual([expectedEvidenceId]);

      expect(parsed.phase1?.governed_ui_copy_v1_quality?.skipped_reason ?? null).not.toEqual("no_evidence");
      expect(parsed.phase1?.governed_ui_copy_v1?.evidence_ids?.product_solution).toEqual([expectedEvidenceId]);
    } finally {
      if (originalKey == null) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = originalKey;
      vi.restoreAllMocks();
    }
  });
});
