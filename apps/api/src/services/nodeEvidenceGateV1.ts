export type NodeEvidenceGateStatusV1 = "unknown" | "ok" | "warn" | "block";

export type NodeEvidenceGateV1 = {
  status: NodeEvidenceGateStatusV1;
  node_coverage_pct: number; // 0-100
  node_trace_coverage_pct: number; // 0-1
  evidence_count_linked_total: number;
  evidence_count_linked_node_backed: number;
  sections_considered: number;
  sections_blocking: number;
  notes: string[];
};

export type ScoreBreakdownSectionForGate = {
  evidence_ids_linked?: string[];
  node_evidence_count_linked?: number;
};

export function computeNodeEvidenceGateV1(
  sections: ScoreBreakdownSectionForGate[]
): NodeEvidenceGateV1 {
  const safeSections = Array.isArray(sections) ? sections : [];
  let evidence_count_linked_total = 0;
  let evidence_count_linked_node_backed = 0;
  let sections_considered = 0;
  let sections_blocking = 0;
  const notes: string[] = [];

  for (const section of safeSections) {
    const linkedIds = Array.isArray(section?.evidence_ids_linked)
      ? section.evidence_ids_linked.filter((v) => typeof v === "string" && v.trim().length > 0)
      : [];
    if (linkedIds.length === 0) continue;

    sections_considered += 1;
    evidence_count_linked_total += linkedIds.length;

    const nodeBacked =
      typeof section?.node_evidence_count_linked === "number" && Number.isFinite(section.node_evidence_count_linked)
        ? Math.max(0, Math.min(linkedIds.length, Math.floor(section.node_evidence_count_linked)))
        : 0;

    evidence_count_linked_node_backed += nodeBacked;
    if (nodeBacked === 0) sections_blocking += 1;
  }

  if (evidence_count_linked_total <= 0) {
    return {
      status: "unknown",
      node_coverage_pct: 0,
      node_trace_coverage_pct: 0,
      evidence_count_linked_total: 0,
      evidence_count_linked_node_backed: 0,
      sections_considered,
      sections_blocking,
      notes: ["No linked score evidence to evaluate"],
    };
  }

  const node_trace_coverage_pct = Math.min(
    1,
    Math.max(0, evidence_count_linked_node_backed / evidence_count_linked_total)
  );
  const node_coverage_pct = Math.round(node_trace_coverage_pct * 100);

  let status: NodeEvidenceGateStatusV1 = "warn";
  if (node_trace_coverage_pct >= 0.8) status = "ok";
  else if (node_trace_coverage_pct < 0.5) status = "block";

  if (status !== "ok") notes.push("Score-linked evidence is not fully node-locatable; decision defensibility is reduced");
  if (sections_blocking > 0) notes.push(`${sections_blocking} section(s) have 0 node-backed linked evidence`);

  return {
    status,
    node_coverage_pct,
    node_trace_coverage_pct,
    evidence_count_linked_total,
    evidence_count_linked_node_backed,
    sections_considered,
    sections_blocking,
    notes,
  };
}
