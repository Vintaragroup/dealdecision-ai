import type { EvidenceRefV1, GovernedLLMClaimV1, GovernedLLMOverviewV1, LLMPhaseMode } from "@dealdecision/contracts";

export type OverlayGovernanceMetrics = {
  llm_phase_mode: LLMPhaseMode;
  citation_integrity_percent: number | null;
  numeric_claims_without_evidence: number;
  hallucination_count: number;
};

export type DeterministicDiagnostics = {
  deterministic_coverage_ratio: number | null;
};

export type DriftMetrics = {
  semantic_drift_score: number | null;
};

export type DocumentIndexLite = Map<string, { page_count: number | null }>;

function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

export function computeOverlayGovernanceMetrics(args: {
  overlay: Pick<GovernedLLMOverviewV1, "llm_phase_mode" | "claims">;
  documentsById?: DocumentIndexLite | null;
}): OverlayGovernanceMetrics {
  const claims = Array.isArray(args.overlay?.claims) ? (args.overlay.claims as GovernedLLMClaimV1[]) : [];

  let numeric_claims_without_evidence = 0;
  let evidenceRefTotal = 0;
  let evidenceRefValid = 0;
  let hallucination_count = 0;

  const documentsById = args.documentsById ?? null;

  for (const c of claims) {
    const isNumeric = isFiniteNumber((c as any)?.value_number);
    const refs = Array.isArray((c as any)?.evidence_refs) ? ((c as any).evidence_refs as EvidenceRefV1[]) : [];

    if (isNumeric && refs.length === 0) numeric_claims_without_evidence += 1;

    for (const r of refs) {
      evidenceRefTotal += 1;

      const docId = typeof (r as any)?.document_id === "string" ? String((r as any).document_id).trim() : "";
      const pageIndex = (r as any)?.page_index;
      const pageOk = typeof pageIndex === "number" && Number.isFinite(pageIndex) && Math.floor(pageIndex) === pageIndex && pageIndex >= 0;

      let ok = Boolean(docId) && pageOk;
      if (ok && documentsById) {
        const meta = documentsById.get(docId);
        const pageCount = meta && isFiniteNumber(meta.page_count) ? meta.page_count : null;
        if (pageCount != null) {
          ok = pageIndex < pageCount;
        }
      }

      if (ok) {
        evidenceRefValid += 1;
      } else {
        hallucination_count += 1;
      }
    }
  }

  const citation_integrity_percent =
    evidenceRefTotal > 0 ? Math.round((10000 * (evidenceRefValid / evidenceRefTotal))) / 100 : null;

  return {
    llm_phase_mode: args.overlay.llm_phase_mode,
    citation_integrity_percent,
    numeric_claims_without_evidence,
    hallucination_count,
  };
}

function extractScoreBreakdownSections(dioData: any): any[] {
  if (!dioData || typeof dioData !== "object") return [];

  const candidates: Array<any> = [
    dioData?.computed_score_breakdown_v1,
    dioData?.dio?.phase1?.executive_summary_v2?.score_breakdown_v1,
    dioData?.dio?.phase1?.score_breakdown_v1,
    dioData?.dio?.phase1?.executive_summary_v1?.score_breakdown_v1,
  ];

  for (const cand of candidates) {
    const sections = cand?.sections;
    if (Array.isArray(sections)) return sections;
  }

  return [];
}

function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function computeDeterministicDiagnostics(args: {
  dioData: any;
  evidenceVisualAssetById?: Map<string, string> | null;
}): DeterministicDiagnostics {
  const sections = extractScoreBreakdownSections(args.dioData);
  const evidenceVisualAssetById = args.evidenceVisualAssetById ?? null;

  let linkedTotal = 0;
  let nodeBacked = 0;

  for (const s of sections) {
    const linked = Array.isArray(s?.evidence_ids_linked)
      ? s.evidence_ids_linked.filter((v: any) => typeof v === "string" && v.trim().length > 0)
      : [];

    for (const rawId of linked) {
      const id = String(rawId).trim();
      if (!isUuidLike(id)) continue;
      linkedTotal += 1;
      const va = evidenceVisualAssetById ? evidenceVisualAssetById.get(id) : null;
      if (typeof va === "string" && va.trim()) nodeBacked += 1;
    }
  }

  const deterministic_coverage_ratio =
    linkedTotal > 0 ? Math.round(1_000_000 * clamp01(nodeBacked / linkedTotal)) / 1_000_000 : null;

  return { deterministic_coverage_ratio };
}

function readDriftAssessment(dioData: any): string | null {
  const candidates: Array<any> = [
    dioData?.archetype_segment_drift_v1?.overall_assessment,
    dioData?.metadata?.archetype_segment_drift_v1?.overall_assessment,
    dioData?.deterministic_score_preview_v1?.gate?.drift_assessment,
    dioData?.metadata?.deterministic_score_preview_v1?.gate?.drift_assessment,
    dioData?.deterministic_score_inputs_v1?.deck?.drift_assessment,
    dioData?.metadata?.deterministic_score_inputs_v1?.deck?.drift_assessment,
  ];

  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }

  return null;
}

export function computeDriftMetrics(args: { dioData: any }): DriftMetrics {
  const drift = readDriftAssessment(args.dioData);
  if (!drift) return { semantic_drift_score: null };

  const normalized = drift.toLowerCase();

  // Keep mapping conservative and monotonic; score is display-only.
  if (normalized === "aligned") return { semantic_drift_score: 0 };
  if (normalized === "mostly_aligned") return { semantic_drift_score: 0.25 };
  if (normalized === "mixed") return { semantic_drift_score: 0.5 };
  if (normalized === "misaligned") return { semantic_drift_score: 1 };

  return { semantic_drift_score: null };
}
