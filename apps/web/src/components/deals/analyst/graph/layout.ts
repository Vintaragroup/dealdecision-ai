import dagre from '@dagrejs/dagre';
import { Position, type Edge, type Node } from '@xyflow/react';

export type LayoutDirection = 'TB' | 'BT' | 'LR' | 'RL';

export type LayoutOptions = {
  direction?: LayoutDirection;
  ranksep?: number;
  nodesep?: number;
};

function estimateNodeSize(node: Node): { width: number; height: number } {
  const measured = (node as any).measured as { width?: number; height?: number } | undefined;
  const measuredWidth = typeof measured?.width === 'number' ? measured.width : undefined;
  const measuredHeight = typeof measured?.height === 'number' ? measured.height : undefined;
  if (measuredWidth && measuredHeight) return { width: measuredWidth, height: measuredHeight };

  const t = String((node as any).type ?? '').toLowerCase();
  if (t === 'deal') return { width: 260, height: 96 };
  if (t === 'document') return { width: 280, height: 112 };
  if (t === 'visual_asset') return { width: 280, height: 170 };
  if (t === 'evidence') return { width: 240, height: 92 };
  return { width: 220, height: 92 };
}

function getPortPositions(direction: LayoutDirection): { sourcePosition: Position; targetPosition: Position } {
  switch (direction) {
    case 'BT':
      return { sourcePosition: Position.Top, targetPosition: Position.Bottom };
    case 'LR':
      return { sourcePosition: Position.Right, targetPosition: Position.Left };
    case 'RL':
      return { sourcePosition: Position.Left, targetPosition: Position.Right };
    case 'TB':
    default:
      return { sourcePosition: Position.Bottom, targetPosition: Position.Top };
  }
}

export function layoutGraph(nodes: Node[], edges: Edge[], options: LayoutOptions = {}): Node[] {
  const direction = options.direction ?? 'TB';
  const ranksep = typeof options.ranksep === 'number' ? options.ranksep : 160;
  const nodesep = typeof options.nodesep === 'number' ? options.nodesep : 100;

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: direction,
    ranksep,
    nodesep,
    edgesep: 40,
    marginx: 20,
    marginy: 20,
  });

  const byId = new Map(nodes.map((n) => [n.id, n] as const));

  for (const node of nodes) {
    const { width, height } = estimateNodeSize(node);
    g.setNode(node.id, { width, height });
  }

  for (const edge of edges) {
    if (!byId.has(edge.source) || !byId.has(edge.target)) continue;
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  const { sourcePosition, targetPosition } = getPortPositions(direction);

  return nodes.map((node) => {
    const { width, height } = estimateNodeSize(node);
    const computed = g.node(node.id) as { x: number; y: number } | undefined;

    if (!computed || !Number.isFinite(computed.x) || !Number.isFinite(computed.y)) {
      return {
        ...node,
        sourcePosition,
        targetPosition,
      };
    }

    return {
      ...node,
      sourcePosition,
      targetPosition,
      position: {
        x: computed.x - width / 2,
        y: computed.y - height / 2,
      },
    };
  });
}
