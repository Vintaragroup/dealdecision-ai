import type { Edge, Node } from '@xyflow/react';

export type ExpandedById = Record<string, boolean>;

export type VisibleGraphResult = {
  visibleNodes: Node[];
  visibleEdges: Edge[];
  descendantCountsById: Record<string, number>;
  connectedNodeIds: Set<string>;
};

export function nodeType(node: Node): string {
  return String((node as any).type ?? (node as any).data?.__node_type ?? '').toLowerCase();
}

export function defaultExpandedForNode(node: Node): boolean {
  const t = nodeType(node);
  if (t === 'deal') return true;
  if (t === 'document') return true;
  if (t === 'segment') return true;
  if (t === 'visual_asset') return false;
  if (t === 'visual_group') return false;
  if (t === 'evidence_group') return false;
  return true;
}

function buildOutgoing(edges: Edge[]): Map<string, Edge[]> {
  const outgoing = new Map<string, Edge[]>();
  for (const e of edges) {
    const list = outgoing.get(e.source) ?? [];
    list.push(e);
    outgoing.set(e.source, list);
  }

  for (const [k, list] of outgoing.entries()) {
    list.sort((a, b) => {
      const ta = `${a.target}::${a.id}`;
      const tb = `${b.target}::${b.id}`;
      return ta.localeCompare(tb);
    });
    outgoing.set(k, list);
  }

  return outgoing;
}

export function computeDescendantCounts(nodes: Node[], edges: Edge[]): Record<string, number> {
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const outgoing = buildOutgoing(edges);

  const memo = new Map<string, number>();

  const count = (id: string, visiting: Set<string>): number => {
    if (memo.has(id)) return memo.get(id)!;
    if (visiting.has(id)) return 0;
    visiting.add(id);

    let total = 0;
    const outs = outgoing.get(id) ?? [];
    for (const e of outs) {
      if (!byId.has(e.target)) continue;
      total += 1;
      total += count(e.target, visiting);
    }

    visiting.delete(id);
    memo.set(id, total);
    return total;
  };

  const result: Record<string, number> = {};
  for (const n of nodes) {
    result[n.id] = count(n.id, new Set());
  }
  return result;
}

export function computeVisibleGraph(params: {
  nodes: Node[];
  edges: Edge[];
  rootId: string;
  expandedById: ExpandedById;
}): VisibleGraphResult {
  const { nodes, edges, rootId, expandedById } = params;
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const outgoing = buildOutgoing(edges);
  const descendantCountsById = computeDescendantCounts(nodes, edges);

  const connectedNodeIds = new Set<string>();
  const connectedEdgeIds = new Set<string>();

  const visit = (id: string) => {
    if (!byId.has(id) || connectedNodeIds.has(id)) return;
    connectedNodeIds.add(id);

    const node = byId.get(id)!;
    const expanded = expandedById[id] ?? defaultExpandedForNode(node);

    if (!expanded) return;

    const outs = outgoing.get(id) ?? [];
    for (const e of outs) {
      if (!byId.has(e.target)) continue;
      connectedEdgeIds.add(e.id);
      visit(e.target);
    }
  };

  visit(rootId);

  const visibleNodes = nodes.filter((n) => connectedNodeIds.has(n.id));
  const visibleEdges = edges.filter((e) => connectedEdgeIds.has(e.id));

  return { visibleNodes, visibleEdges, descendantCountsById, connectedNodeIds };
}
