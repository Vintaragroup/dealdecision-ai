import type { Edge, Node } from '@xyflow/react';
import { computeDescendantCounts, nodeType as nodeTypeInternal } from './visibility';

export type ClusterProjectionResult = {
  nodes: Node[];
  edges: Edge[];
  descendantCountsById: Record<string, number>;
  hiddenSelectionMap: Map<string, string>;
  groupMeta: Record<string, GroupMeta>;
  stats: { visual_group: number; evidence_group: number; visual_asset: number; evidence: number };
  expandedGroupIds: string[];
};

export type GroupMeta = {
  groupId: string;
  evidenceGroupId: string;
  docId: string | null;
  segmentId: string | null;
  segmentLabel?: string;
  countSlides: number;
  evidenceCountTotal: number;
  avgConfidence: number | null;
  sampleSummaries: string[];
  evidenceSamples: string[];
};

function getVisualAssetId(node: Node): string | null {
  const data = (node.data ?? {}) as any;
  const raw = data?.visual_asset_id ?? data?.visualId ?? data?.visual_id;
  if (typeof raw === 'string' && raw.trim()) return raw.trim();
  if (typeof node.id === 'string') {
    if (node.id.startsWith('visual_asset:')) return node.id.slice('visual_asset:'.length);
    if (node.id.startsWith('visual:')) return node.id.slice('visual:'.length);
  }
  return null;
}

export function nodeType(node: Node): string {
  return nodeTypeInternal(node);
}

function getDocIdFromData(d: any): string | null {
  const docId = d?.__docId ?? d?.document_id ?? d?.doc_id ?? d?.documentId;
  if (typeof docId === 'string' && docId.trim()) return docId.trim();
  return null;
}

function getSegmentIdFromData(d: any): string | null {
  const segId = d?.__segmentId ?? d?.segment_id ?? d?.segmentId;
  if (typeof segId === 'string' && segId.trim()) return segId.trim();
  return null;
}

function cleanSummary(value: unknown, maxLen: number = 140): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
  if (!normalized) return null;
  return normalized.length > maxLen ? `${normalized.slice(0, maxLen).trimEnd()}…` : normalized;
}

export function projectClusteredGraph(params: {
  nodes: Node[];
  edges: Edge[];
  expandedById: Record<string, boolean>;
  clusterEnabled: boolean;
  clusterEligible: boolean;
}): ClusterProjectionResult {
  const { nodes, edges, expandedById, clusterEnabled, clusterEligible } = params;
  const hiddenSelectionMap = new Map<string, string>();
  const groupMeta: Record<string, GroupMeta> = {};

  if (!clusterEnabled || !clusterEligible) {
    return {
      nodes,
      edges,
      descendantCountsById: computeDescendantCounts(nodes, edges),
      hiddenSelectionMap,
      groupMeta,
      stats: countTypes(nodes),
      expandedGroupIds: [],
    };
  }

  const nodeById = new Map(nodes.map((n) => [n.id, n] as const));
  const typeOf = (n: Node) => nodeType(n);

  const segmentLabelById = new Map<string, string>();
  for (const n of nodes) {
    if (typeOf(n) !== 'segment') continue;
    const data = (n.data ?? {}) as any;
    const segId = getSegmentIdFromData(data) ?? (typeof n.id === 'string' && n.id.startsWith('segment:') ? n.id.slice('segment:'.length) : null);
    const label = typeof data.label === 'string' && data.label.trim().length > 0 ? data.label : segId ?? String(n.id);
    if (segId) segmentLabelById.set(segId, label);
  }

  const edgesByTarget = new Map<string, Edge[]>();
  const edgesBySource = new Map<string, Edge[]>();
  for (const e of edges) {
    const tList = edgesByTarget.get(e.target) ?? [];
    tList.push(e);
    edgesByTarget.set(e.target, tList);

    const sList = edgesBySource.get(e.source) ?? [];
    sList.push(e);
    edgesBySource.set(e.source, sList);
  }

  type GroupBucket = {
    docId: string | null;
    segmentId: string | null;
    segmentLabel?: string;
    visuals: Node[];
    evidenceNodes: Node[];
    parents: string[];
    avgConfidence: number | null;
  };

  const groups = new Map<string, GroupBucket>();

  const pushGroup = (visual: Node) => {
    const data = (visual.data ?? {}) as any;
    const docId = getDocIdFromData(data);
    const segmentId = getSegmentIdFromData(data);
    const key = `${docId ?? 'doc:none'}::${segmentId ?? 'seg:none'}`;

    const parents = (edgesByTarget.get(visual.id) ?? []).map((e) => e.source);
    const parentSegment = parents
      .map((pid) => nodeById.get(pid))
      .find((p) => p && typeOf(p) === 'segment');
    const segmentLabel = segmentId ? segmentLabelById.get(segmentId) : undefined;
    const conf = (() => {
      const c1 = data.extraction_confidence;
      const c2 = data.confidence;
      const val = typeof c1 === 'number' && Number.isFinite(c1) ? c1 : typeof c2 === 'number' && Number.isFinite(c2) ? c2 : null;
      if (val == null) return null;
      return val <= 1 ? val * 100 : val;
    })();

    if (!groups.has(key)) {
      groups.set(key, {
        docId,
        segmentId,
        segmentLabel: segmentLabel ?? (segmentId ?? undefined),
        visuals: [],
        evidenceNodes: [],
        parents: [],
        avgConfidence: conf,
      });
    }
    const bucket = groups.get(key)!;
    bucket.visuals.push(visual);
    bucket.parents.push(...parents);

    // Gather connected evidence nodes (direct children of the visual).
    const outEdges = edgesBySource.get(visual.id) ?? [];
    for (const oe of outEdges) {
      const tgtNode = nodeById.get(oe.target);
      if (tgtNode && typeOf(tgtNode) === 'evidence') bucket.evidenceNodes.push(tgtNode);
    }

    if (conf != null) {
      if (bucket.avgConfidence == null) bucket.avgConfidence = conf;
      else bucket.avgConfidence = (bucket.avgConfidence + conf) / 2;
    }
  };

  for (const n of nodes) {
    if (typeOf(n) === 'visual_asset') pushGroup(n);
  }

  const removedNodeIds = new Set<string>();
  const addedNodes: Node[] = [];
  const addedEdges: Edge[] = [];
  const expandedGroupIds: string[] = [];

  for (const [key, bucket] of groups.entries()) {
    const { docId, segmentId } = bucket;
    const groupId = `visual_group:${docId ?? 'none'}:${segmentId ?? 'none'}`;
    const evidenceGroupId = `evidence_group:${docId ?? 'none'}:${segmentId ?? 'none'}`;
    const branchKey = `${docId ?? 'none'}:${segmentId ?? 'none'}`;
    const expanded = expandedById[groupId] === true;
    if (expanded) expandedGroupIds.push(groupId);

    const uniqueEvidenceNodes = Array.from(new Map(bucket.evidenceNodes.map((e) => [e.id, e] as const)).values());
    const evidenceCountTotal = uniqueEvidenceNodes.reduce((sum, e) => {
      const c = (e.data as any)?.count;
      return sum + (Number.isFinite(c) ? Number(c) : 0);
    }, 0);

    const sampleSummaries: string[] = [];
    for (const v of bucket.visuals) {
      const d = (v.data ?? {}) as any;
      const summary = cleanSummary(d.page_understanding?.summary ?? d.sample_snippet ?? d.structured_summary);
      if (summary) sampleSummaries.push(summary);
      if (sampleSummaries.length >= 3) break;
    }

    const evidenceSamples: string[] = [];
    for (const ev of uniqueEvidenceNodes) {
      const s = cleanSummary((ev.data as any)?.sample_snippet);
      if (s) evidenceSamples.push(s);
      if (evidenceSamples.length >= 3) break;
    }

    groupMeta[groupId] = {
      groupId,
      evidenceGroupId,
      docId,
      segmentId,
      segmentLabel: bucket.segmentLabel,
      countSlides: bucket.visuals.length,
      evidenceCountTotal,
      avgConfidence: bucket.avgConfidence ?? null,
      sampleSummaries,
      evidenceSamples,
    };

    if (expanded) {
      continue;
    }

    for (const v of bucket.visuals) removedNodeIds.add(v.id);
    for (const e of uniqueEvidenceNodes) removedNodeIds.add(e.id);

    const visualGroupNode: Node = {
      id: groupId,
      type: 'visual_group',
      position: { x: 0, y: 0 },
      data: {
        label: bucket.segmentLabel ?? bucket.segmentId ?? 'Visual group',
        segment_label: bucket.segmentLabel ?? bucket.segmentId ?? undefined,
        count_slides: bucket.visuals.length,
        evidence_count_total: evidenceCountTotal,
        avg_confidence: bucket.avgConfidence ?? null,
        sample_summaries: sampleSummaries,
        group_id: groupId,
        document_id: docId ?? undefined,
        segment_id: segmentId ?? undefined,
        member_visual_asset_ids: bucket.visuals
          .map((v) => getVisualAssetId(v))
          .filter((x): x is string => typeof x === 'string' && x.trim().length > 0),
        __docId: docId ?? undefined,
        __segmentId: segmentId ?? undefined,
        __branchKey: branchKey,
        __node_type: 'visual_group',
      },
      selectable: true,
    } as Node;

    const evidenceGroupNode: Node = {
      id: evidenceGroupId,
      type: 'evidence_group',
      position: { x: 0, y: 0 },
      data: {
        label: bucket.segmentLabel ? `${bucket.segmentLabel} evidence` : 'Evidence group',
        evidence_count_total: evidenceCountTotal,
        avg_confidence: bucket.avgConfidence ?? null,
        sample_summaries: evidenceSamples,
        group_id: evidenceGroupId,
        document_id: docId ?? undefined,
        segment_id: segmentId ?? undefined,
        member_visual_asset_ids: bucket.visuals
          .map((v) => getVisualAssetId(v))
          .filter((x): x is string => typeof x === 'string' && x.trim().length > 0),
        __docId: docId ?? undefined,
        __segmentId: segmentId ?? undefined,
        __branchKey: branchKey,
        __node_type: 'evidence_group',
      },
      selectable: true,
    } as Node;

    addedNodes.push(visualGroupNode, evidenceGroupNode);

    const parentId = bucket.parents.find((pid) => {
      const p = nodeById.get(pid);
      return p && typeOf(p) === 'segment';
    }) ?? bucket.parents[0] ?? `document:${docId ?? 'none'}`;

    const edgeToGroup: Edge = {
      id: `edge:${parentId}->${groupId}`,
      source: parentId,
      target: groupId,
      data: {
        __docId: docId ?? undefined,
        __segmentId: segmentId ?? undefined,
        __branchKey: branchKey,
      },
    } as Edge;

    const edgeToEvidence: Edge = {
      id: `edge:${groupId}->${evidenceGroupId}`,
      source: groupId,
      target: evidenceGroupId,
      data: {
        __docId: docId ?? undefined,
        __segmentId: segmentId ?? undefined,
        __branchKey: branchKey,
      },
    } as Edge;

    addedEdges.push(edgeToGroup, edgeToEvidence);

    for (const v of bucket.visuals) hiddenSelectionMap.set(v.id, groupId);
    for (const ev of uniqueEvidenceNodes) hiddenSelectionMap.set(ev.id, evidenceGroupId);
  }

  const finalNodes = nodes.filter((n) => !removedNodeIds.has(n.id)).concat(addedNodes);
  const finalEdges = edges.filter((e) => !removedNodeIds.has(e.source) && !removedNodeIds.has(e.target)).concat(addedEdges);

  return {
    nodes: finalNodes,
    edges: finalEdges,
    descendantCountsById: computeDescendantCounts(finalNodes, finalEdges),
    hiddenSelectionMap,
    groupMeta,
    stats: countTypes(finalNodes),
    expandedGroupIds,
  };
}

function countTypes(nodes: Node[]): { visual_group: number; evidence_group: number; visual_asset: number; evidence: number } {
  let vg = 0;
  let eg = 0;
  let va = 0;
  let ev = 0;
  for (const n of nodes) {
    const t = nodeType(n);
    if (t === 'visual_group') vg++;
    else if (t === 'evidence_group') eg++;
    else if (t === 'visual_asset') va++;
    else if (t === 'evidence') ev++;
  }
  return { visual_group: vg, evidence_group: eg, visual_asset: va, evidence: ev };
}
