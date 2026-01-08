import { describe, expect, it } from 'vitest';
import type { Edge, Node } from '@xyflow/react';
import { projectClusteredGraph } from '../cluster';

function makeNode(id: string, type: string, data: Record<string, unknown> = {}): Node {
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    data,
  } as Node;
}

function makeEdge(id: string, source: string, target: string, data: Record<string, unknown> = {}): Edge {
  return {
    id,
    source,
    target,
    data,
  } as Edge;
}

describe('projectClusteredGraph', () => {
  it('clusters visual assets into group nodes when enabled', () => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];

    const doc1 = makeNode('document:doc1', 'document', { document_id: 'doc1' });
    const doc2 = makeNode('document:doc2', 'document', { document_id: 'doc2' });
    const seg1 = makeNode('segment:seg1', 'segment', { segment_id: 'seg1', __docId: 'doc1', label: 'Seg A' });
    const seg2 = makeNode('segment:seg2', 'segment', { segment_id: 'seg2', __docId: 'doc2', label: 'Seg B' });

    nodes.push(doc1, doc2, seg1, seg2);

    for (let i = 0; i < 30; i++) {
      const docId = i < 15 ? 'doc1' : 'doc2';
      const segId = i < 15 ? 'seg1' : 'seg2';
      const assetId = `va-${i}`;
      const evidenceId = `ev-${i}`;
      const visualNode = makeNode(`visual_asset:${assetId}`, 'visual_asset', {
        document_id: docId,
        segment_id: segId,
        __docId: docId,
        __segmentId: segId,
        confidence: 0.9,
        page_understanding: { summary: `summary ${i}` },
      });
      const evidenceNode = makeNode(`evidence:${assetId}`, 'evidence', {
        visual_asset_id: assetId,
        __docId: docId,
        __segmentId: segId,
        count: 2,
        sample_snippet: `snippet ${i}`,
      });
      nodes.push(visualNode, evidenceNode);

      edges.push(
        makeEdge(`edge:seg-${i}`, `segment:${segId}`, visualNode.id, { __docId: docId, __segmentId: segId }),
        makeEdge(`edge:ev-${i}`, visualNode.id, evidenceNode.id, { __docId: docId, __segmentId: segId })
      );
    }

    const result = projectClusteredGraph({
      nodes,
      edges,
      expandedById: {},
      clusterEnabled: true,
      clusterEligible: true,
    });

    const visualGroups = result.nodes.filter((n) => String((n as any).type) === 'visual_group');
    const evidenceGroups = result.nodes.filter((n) => String((n as any).type) === 'evidence_group');
    const visuals = result.nodes.filter((n) => String((n as any).type) === 'visual_asset');
    const evidences = result.nodes.filter((n) => String((n as any).type) === 'evidence');

    expect(visualGroups.length).toBe(2);
    expect(evidenceGroups.length).toBe(2);
    expect(visuals.length).toBe(0);
    expect(evidences.length).toBe(0);
  });

  it('shows children when a group is expanded', () => {
    const visual = makeNode('visual_asset:child', 'visual_asset', {
      document_id: 'docX',
      segment_id: 'segX',
      __docId: 'docX',
      __segmentId: 'segX',
      confidence: 0.5,
    });
    const evidence = makeNode('evidence:child', 'evidence', { visual_asset_id: 'child', count: 1, __docId: 'docX', __segmentId: 'segX' });
    const segment = makeNode('segment:segX', 'segment', { segment_id: 'segX', __docId: 'docX', label: 'SegX' });

    const result = projectClusteredGraph({
      nodes: [segment, visual, evidence],
      edges: [
        makeEdge('edge:seg', segment.id, visual.id, { __docId: 'docX', __segmentId: 'segX' }),
        makeEdge('edge:ev', visual.id, evidence.id, { __docId: 'docX', __segmentId: 'segX' }),
      ],
      expandedById: { 'visual_group:docX:segX': true },
      clusterEnabled: true,
      clusterEligible: true,
    });

    const visuals = result.nodes.filter((n) => String((n as any).type) === 'visual_asset');
    const visualGroups = result.nodes.filter((n) => String((n as any).type) === 'visual_group');

    expect(visualGroups.length).toBe(0);
    expect(visuals.length).toBe(1);
  });
});
