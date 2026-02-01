import { describe, expect, test } from 'vitest';
import type { Edge, Node } from '@xyflow/react';
import { computeVisibleGraph } from '../visibility';

function n(id: string, type: string): Node {
  return { id, type, position: { x: 0, y: 0 }, data: {} } as Node;
}

function e(id: string, source: string, target: string): Edge {
  return { id, source, target } as Edge;
}

describe('computeVisibleGraph', () => {
  test('shows only connected nodes from root', () => {
    const nodes = [n('deal:1', 'deal'), n('document:1', 'document'), n('orphan:1', 'document')];
    const edges = [e('e1', 'deal:1', 'document:1')];

    const res = computeVisibleGraph({
      nodes,
      edges,
      rootId: 'deal:1',
      expandedById: { 'deal:1': true, 'document:1': true },
    });

    expect(res.visibleNodes.map((x) => x.id).sort()).toEqual(['deal:1', 'document:1']);
    expect(res.visibleEdges.map((x) => x.id)).toEqual(['e1']);
  });

  test('collapsing a node hides all descendants and edges', () => {
    const nodes = [
      n('deal:1', 'deal'),
      n('document:1', 'document'),
      n('visual_asset:1', 'visual_asset'),
      n('evidence:1', 'evidence'),
    ];
    const edges = [
      e('e1', 'deal:1', 'document:1'),
      e('e2', 'document:1', 'visual_asset:1'),
      e('e3', 'visual_asset:1', 'evidence:1'),
    ];

    const res = computeVisibleGraph({
      nodes,
      edges,
      rootId: 'deal:1',
      expandedById: {
        'deal:1': true,
        'document:1': false,
      },
    });

    expect(res.visibleNodes.map((x) => x.id).sort()).toEqual(['deal:1', 'document:1']);
    expect(res.visibleEdges.map((x) => x.id)).toEqual(['e1']);
  });
});
