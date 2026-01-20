import {
  BaseEdge,
  Position,
  getBezierPath,
  type EdgeProps,
  type InternalNode,
  useStore,
} from '@xyflow/react';

function getNodeCenter(node: InternalNode): { x: number; y: number } {
  const width = node.measured?.width ?? node.width ?? 0;
  const height = node.measured?.height ?? node.height ?? 0;
  const x = node.internals.positionAbsolute.x + width / 2;
  const y = node.internals.positionAbsolute.y + height / 2;
  return { x, y };
}

function getNodeIntersection(intersectionNode: InternalNode, targetNode: InternalNode): { x: number; y: number } {
  const w = intersectionNode.measured?.width ?? intersectionNode.width ?? 0;
  const h = intersectionNode.measured?.height ?? intersectionNode.height ?? 0;

  const ix = intersectionNode.internals.positionAbsolute.x;
  const iy = intersectionNode.internals.positionAbsolute.y;

  const nodeCenter = { x: ix + w / 2, y: iy + h / 2 };
  const targetCenter = getNodeCenter(targetNode);

  const dx = targetCenter.x - nodeCenter.x;
  const dy = targetCenter.y - nodeCenter.y;

  // Avoid divide-by-zero.
  const absDx = Math.max(0.0001, Math.abs(dx));
  const absDy = Math.max(0.0001, Math.abs(dy));

  const sx = w / 2 / absDx;
  const sy = h / 2 / absDy;
  const scale = Math.min(sx, sy);

  return {
    x: nodeCenter.x + dx * scale,
    y: nodeCenter.y + dy * scale,
  };
}

function getNodeAnchor(node: InternalNode, pos: Position): { x: number; y: number } {
  const w = node.measured?.width ?? node.width ?? 0;
  const h = node.measured?.height ?? node.height ?? 0;
  const x0 = node.internals.positionAbsolute.x;
  const y0 = node.internals.positionAbsolute.y;
  const cx = x0 + w / 2;
  const cy = y0 + h / 2;

  switch (pos) {
    case Position.Top:
      return { x: cx, y: y0 };
    case Position.Bottom:
      return { x: cx, y: y0 + h };
    case Position.Left:
      return { x: x0, y: cy };
    case Position.Right:
      return { x: x0 + w, y: cy };
    default:
      return { x: cx, y: cy };
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getNodeAnchorTowards(node: InternalNode, pos: Position, toward: { x: number; y: number }): { x: number; y: number } {
  const w = node.measured?.width ?? node.width ?? 0;
  const h = node.measured?.height ?? node.height ?? 0;
  const x0 = node.internals.positionAbsolute.x;
  const y0 = node.internals.positionAbsolute.y;
  const pad = Math.min(24, Math.max(8, w * 0.08));
  const cx = x0 + w / 2;
  const cy = y0 + h / 2;

  if (pos === Position.Top) {
    return { x: clamp(toward.x, x0 + pad, x0 + w - pad), y: y0 };
  }
  if (pos === Position.Bottom) {
    return { x: clamp(toward.x, x0 + pad, x0 + w - pad), y: y0 + h };
  }
  if (pos === Position.Left) {
    return { x: x0, y: clamp(toward.y, y0 + pad, y0 + h - pad) };
  }
  if (pos === Position.Right) {
    return { x: x0 + w, y: clamp(toward.y, y0 + pad, y0 + h - pad) };
  }
  return { x: cx, y: cy };
}

function getEdgePosition(from: { x: number; y: number }, to: { x: number; y: number }): Position {
  const dx = Math.abs(from.x - to.x);
  const dy = Math.abs(from.y - to.y);
  if (dx > dy) return from.x > to.x ? Position.Left : Position.Right;
  return from.y > to.y ? Position.Top : Position.Bottom;
}

export function FloatingEdge(props: EdgeProps) {
  const { id, source, target, style, markerEnd } = props;

  const sourceNode = useStore((s) => s.nodeLookup.get(source) as InternalNode | undefined);
  const targetNode = useStore((s) => s.nodeLookup.get(target) as InternalNode | undefined);

  if (!sourceNode || !targetNode) return null;

  const sourceCenter = getNodeCenter(sourceNode);
  const targetCenter = getNodeCenter(targetNode);
  const dy = targetCenter.y - sourceCenter.y;

  // This graph is laid out top-to-bottom.
  // Always prefer bottom->top connections whenever nodes are vertically separated,
  // even if they are horizontally offset.
  const isVerticallySeparated = Math.abs(dy) > 20;

  const sourcePosition = isVerticallySeparated
    ? dy >= 0
      ? Position.Bottom
      : Position.Top
    : getEdgePosition(sourceCenter, targetCenter);
  const targetPosition = isVerticallySeparated
    ? dy >= 0
      ? Position.Top
      : Position.Bottom
    : getEdgePosition(targetCenter, sourceCenter);

  const sourcePoint = isVerticallySeparated
    ? getNodeAnchorTowards(sourceNode, sourcePosition, targetCenter)
    : getNodeIntersection(sourceNode, targetNode);
  const targetPoint = isVerticallySeparated
    ? getNodeAnchorTowards(targetNode, targetPosition, sourceCenter)
    : getNodeIntersection(targetNode, sourceNode);

  const [path] = getBezierPath({
    sourceX: sourcePoint.x,
    sourceY: sourcePoint.y,
    sourcePosition,
    targetX: targetPoint.x,
    targetY: targetPoint.y,
    targetPosition,
  });

  return (
    <BaseEdge
      id={id}
      path={path}
      // This is a viewer-only graph; edges should never steal pointer events from nodes.
      style={{ pointerEvents: 'none', strokeWidth: 1, ...(style ?? {}) }}
      markerEnd={markerEnd}
    />
  );
}
