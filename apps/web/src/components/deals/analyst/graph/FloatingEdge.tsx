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

  const sourcePoint = getNodeIntersection(sourceNode, targetNode);
  const targetPoint = getNodeIntersection(targetNode, sourceNode);

  const sourcePosition = getEdgePosition(sourcePoint, targetPoint);
  const targetPosition = getEdgePosition(targetPoint, sourcePoint);

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
