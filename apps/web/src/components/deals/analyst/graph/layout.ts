import dagre from '@dagrejs/dagre';
import { Position, type Edge, type Node } from '@xyflow/react';

const LANE_WIDTH = 650;
const LANE_GUTTER = 120;
const NODE_VERTICAL_GAP = 40;
const LANE_PADDING_LEFT = LANE_GUTTER;

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
  if (t === 'deal') return { width: 260, height: 120 };
  if (t === 'document') return { width: 260, height: 120 };
  if (t === 'segment') return { width: 240, height: 100 };
  if (t === 'visual_asset') {
    const expanded = Boolean((node as any)?.data?.expanded);
    return { width: 300, height: expanded ? 220 : 160 };
  }
  if (t === 'evidence') return { width: 260, height: 110 };
  return { width: 220, height: 100 };
}

function getLayer(node: Node): number {
  const explicit = (node as any)?.data?.__layer;
  if (typeof explicit === 'number' && Number.isFinite(explicit)) return explicit;

  const t = String((node as any).type ?? '').toLowerCase();
  if (t === 'deal') return 0;
  if (t === 'document') return 1;
  if (t === 'segment') return 2;
  if (t === 'visual_asset') return 3;
  if (t === 'evidence') return 4;
  return 3;
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
  const ranksep = typeof options.ranksep === 'number' ? options.ranksep : 120;
  const nodesep = typeof options.nodesep === 'number' ? options.nodesep : 80;

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: direction,
    ranksep,
    nodesep,
    edgesep: 40,
    marginx: 40,
    marginy: 40,
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
  const laneCounts = new Map<number, number>();

  const laidOut = nodes.map((node) => {
    const layer = getLayer(node);
    laneCounts.set(layer, (laneCounts.get(layer) ?? 0) + 1);

    const { width, height } = estimateNodeSize(node);
    const computed = g.node(node.id) as { x: number; y: number } | undefined;

    if (!computed || !Number.isFinite(computed.x) || !Number.isFinite(computed.y)) {
      return {
        ...node,
        sourcePosition,
        targetPosition,
        data: { ...(node.data ?? {}), __layer: layer },
      };
    }

    const laneSpan = LANE_WIDTH + LANE_GUTTER;
    const laneBase = LANE_PADDING_LEFT + layer * laneSpan;
    const rawX = computed.x - width / 2;
    const localOffsetX = rawX - laneBase;
    const clampedLocalX = Math.max(0, Math.min(localOffsetX, Math.max(0, LANE_WIDTH - width)));

    return {
      ...node,
      sourcePosition,
      targetPosition,
      data: { ...(node.data ?? {}), __layer: layer },
      position: {
        x: laneBase + clampedLocalX,
        y: computed.y - height / 2,
      },
    } as Node;
  });

  // Per-layer collision resolution with vertical breathing room.
  const byLayer = new Map<number, Node[]>();
  for (const n of laidOut) {
    const layer = getLayer(n);
    if (!byLayer.has(layer)) byLayer.set(layer, []);
    byLayer.get(layer)!.push(n);
  }

  for (const [layer, layerNodes] of byLayer.entries()) {
    const sorted = layerNodes
      .filter((n) => n.position)
      .sort((a, b) => {
        const ay = a.position?.y ?? 0;
        const by = b.position?.y ?? 0;
        if (ay === by) return (a.position?.x ?? 0) - (b.position?.x ?? 0);
        return ay - by;
      });

    let lastBottom = Number.NEGATIVE_INFINITY;
    for (const n of sorted) {
      if (!n.position) continue;
      const { height } = estimateNodeSize(n);
      if (lastBottom === Number.NEGATIVE_INFINITY) {
        lastBottom = n.position.y + height;
        continue;
      }
      const overlap = lastBottom - n.position.y;
      if (overlap >= 0) {
        n.position = { ...n.position, y: n.position.y + overlap + NODE_VERTICAL_GAP };
      }
      lastBottom = n.position.y + height;
    }
  }

  if (import.meta.env.DEV && typeof window !== 'undefined') {
    // eslint-disable-next-line no-console
    console.log('[layout] lanes', {
      laneWidth: LANE_WIDTH,
      laneGutter: LANE_GUTTER,
      countsByLayer: Object.fromEntries(Array.from(laneCounts.entries()).sort((a, b) => a[0] - b[0])),
    });
  }

  return laidOut;
}
