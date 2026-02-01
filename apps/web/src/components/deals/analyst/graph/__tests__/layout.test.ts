import { describe, expect, test } from 'vitest';
import type { Edge, Node } from '@xyflow/react';
import { layoutGraph } from '../layout';

function n(id: string, type: string): Node {
  return { id, type, position: { x: 0, y: 0 }, data: {} } as Node;
}

function e(id: string, source: string, target: string): Edge {
  return { id, source, target } as Edge;
}

describe('layoutGraph', () => {
  test('produces deterministic non-overlapping-ish positions for a simple chain (TB)', () => {
    const nodes = [n('deal:1', 'deal'), n('document:1', 'document'), n('visual_asset:1', 'visual_asset')];
    const edges = [e('e1', 'deal:1', 'document:1'), e('e2', 'document:1', 'visual_asset:1')];

    const laidOut = layoutGraph(nodes, edges, { direction: 'TB' });

    const byId = new Map(laidOut.map((x) => [x.id, x] as const));
    expect(byId.get('deal:1')!.position.y).toBeLessThan(byId.get('document:1')!.position.y);
    expect(byId.get('document:1')!.position.y).toBeLessThan(byId.get('visual_asset:1')!.position.y);

    const posSet = new Set(laidOut.map((x) => `${Math.round(x.position.x)}:${Math.round(x.position.y)}`));
    expect(posSet.size).toBe(laidOut.length);
  });
});
