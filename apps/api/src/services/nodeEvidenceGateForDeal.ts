import type { Pool } from "pg";
import { computeNodeEvidenceGateV1, type NodeEvidenceGateV1 } from "./nodeEvidenceGateV1";

function isUuidLike(value: string): boolean {
  // Accept uuid v1-v5 formats.
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function extractScoreBreakdownSections(dioData: any): any[] | null {
  if (!dioData || typeof dioData !== "object") return null;

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

  return null;
}

export async function getNodeEvidenceGateForDeal(
  pool: Pool,
  dealId: string
): Promise<{ gate: NodeEvidenceGateV1; source: "dio" | "none" }> {
  const { rows } = await pool.query<{ dio_data: any }>(
    `SELECT dio_data
       FROM deal_intelligence_objects
      WHERE deal_id = $1
      ORDER BY analysis_version DESC
      LIMIT 1`,
    [dealId]
  );

  if (!rows.length) {
    return {
      gate: computeNodeEvidenceGateV1([]),
      source: "none",
    };
  }

  const dioData = (rows[0] as any).dio_data ?? {};
  const sectionsRaw = extractScoreBreakdownSections(dioData);
  const sections = Array.isArray(sectionsRaw) ? sectionsRaw : [];

  // Collect all linked evidence ids from the persisted breakdown.
  const linkedIdsAll: string[] = [];
  for (const s of sections) {
    const linked = Array.isArray(s?.evidence_ids_linked)
      ? s.evidence_ids_linked.filter((v: any) => typeof v === "string" && v.trim().length > 0)
      : [];
    for (const id of linked) linkedIdsAll.push(id);
  }

  const uniqueLinkedIds = Array.from(new Set(linkedIdsAll.map((x) => x.trim()))).filter(isUuidLike);
  if (uniqueLinkedIds.length === 0) {
    // Will be treated as unknown by the gate computation.
    return {
      gate: computeNodeEvidenceGateV1(sections as any),
      source: "dio",
    };
  }

  const { rows: evRows } = await pool.query<{ id: string; visual_asset_id: string | null }>(
    `SELECT id::text AS id, visual_asset_id::text AS visual_asset_id
       FROM evidence
      WHERE deal_id = $1
        AND id = ANY($2::uuid[])`,
    [dealId, uniqueLinkedIds]
  );

  const visualAssetByEvidenceId = new Map<string, string>();
  for (const r of evRows) {
    if (!r?.id) continue;
    const va = typeof r.visual_asset_id === "string" ? r.visual_asset_id.trim() : "";
    if (va) visualAssetByEvidenceId.set(r.id, va);
  }

  // Enrich sections with node_evidence_count_linked so the gate can compute.
  for (const s of sections) {
    const linked = Array.isArray(s?.evidence_ids_linked)
      ? s.evidence_ids_linked.filter((v: any) => typeof v === "string" && v.trim().length > 0)
      : [];
    if (linked.length === 0) {
      s.node_evidence_count_linked = 0;
      continue;
    }

    let nodeBacked = 0;
    for (const id of linked) {
      if (!isUuidLike(id)) continue;
      const va = visualAssetByEvidenceId.get(id);
      if (va) nodeBacked += 1;
    }

    s.node_evidence_count_linked = nodeBacked;
  }

  return {
    gate: computeNodeEvidenceGateV1(sections as any),
    source: "dio",
  };
}
