import { describe, it, expect } from "vitest";

import {
  computeOverlayGovernanceMetrics,
  computeDeterministicDiagnostics,
  computeDriftMetrics,
} from "../analysis-diagnostics";

describe("analysis diagnostics", () => {
  describe("computeOverlayGovernanceMetrics", () => {
    it("counts numeric claims without evidence and computes citation integrity", () => {
      const out = computeOverlayGovernanceMetrics({
        overlay: {
          llm_phase_mode: "governed" as any,
          claims: [
            {
              claim_type: "kpi",
              label: "ARR",
              value_number: 123,
              confidence: 0.9,
              evidence_refs: [],
            },
            {
              claim_type: "kpi",
              label: "Revenue",
              value_number: 456,
              confidence: 0.9,
              evidence_refs: [
                { document_id: "doc-1", page_index: 0 }, // valid
                { document_id: "", page_index: 0 }, // invalid
              ],
            },
          ],
        },
        documentsById: new Map([
          ["doc-1", { page_count: 2 }],
        ]),
      });

      expect(out.llm_phase_mode).toEqual("governed");
      expect(out.numeric_claims_without_evidence).toEqual(1);
      expect(out.hallucination_count).toEqual(1);
      expect(out.citation_integrity_percent).toEqual(50);
    });

    it("treats out-of-range page refs as hallucinations when page_count known", () => {
      const out = computeOverlayGovernanceMetrics({
        overlay: {
          llm_phase_mode: "stabilizing" as any,
          claims: [
            {
              claim_type: "kpi",
              label: "GM%",
              value_number: 55,
              confidence: 0.9,
              evidence_refs: [{ document_id: "doc-2", page_index: 9 }],
            },
          ],
        },
        documentsById: new Map([
          ["doc-2", { page_count: 2 }],
        ]),
      });

      expect(out.numeric_claims_without_evidence).toEqual(0);
      expect(out.hallucination_count).toEqual(1);
      expect(out.citation_integrity_percent).toEqual(0);
    });
  });

  describe("computeDeterministicDiagnostics", () => {
    it("computes coverage ratio from linked evidence ids backed by visual assets", () => {
      const dioData = {
        computed_score_breakdown_v1: {
          sections: [
            {
              title: "Market",
              evidence_ids_linked: [
                "00000000-0000-4000-8000-000000000001",
                "00000000-0000-4000-8000-000000000002",
              ],
            },
            {
              title: "Team",
              evidence_ids_linked: ["not-a-uuid"],
            },
          ],
        },
      };

      const evidenceVisualAssetById = new Map<string, string>([
        ["00000000-0000-4000-8000-000000000001", "va-1"],
      ]);

      const out = computeDeterministicDiagnostics({ dioData, evidenceVisualAssetById });
      expect(out.deterministic_coverage_ratio).toEqual(0.5);
    });

    it("returns null when no linked evidence ids present", () => {
      const out = computeDeterministicDiagnostics({ dioData: { computed_score_breakdown_v1: { sections: [] } } });
      expect(out.deterministic_coverage_ratio).toEqual(null);
    });
  });

  describe("computeDriftMetrics", () => {
    it("maps aligned/mixed/misaligned assessments into a monotonic score", () => {
      expect(computeDriftMetrics({ dioData: { deterministic_score_preview_v1: { gate: { drift_assessment: "aligned" } } } })
        .semantic_drift_score).toEqual(0);
      expect(computeDriftMetrics({ dioData: { deterministic_score_preview_v1: { gate: { drift_assessment: "mostly_aligned" } } } })
        .semantic_drift_score).toEqual(0.25);
      expect(computeDriftMetrics({ dioData: { deterministic_score_preview_v1: { gate: { drift_assessment: "mixed" } } } })
        .semantic_drift_score).toEqual(0.5);
      expect(computeDriftMetrics({ dioData: { deterministic_score_preview_v1: { gate: { drift_assessment: "misaligned" } } } })
        .semantic_drift_score).toEqual(1);
    });

    it("returns null for unknown assessments", () => {
      const out = computeDriftMetrics({ dioData: { deterministic_score_preview_v1: { gate: { drift_assessment: "??" } } } });
      expect(out.semantic_drift_score).toEqual(null);
    });
  });
});
