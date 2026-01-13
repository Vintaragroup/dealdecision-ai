import { describe, expect, it } from 'vitest';
import { extractPhaseBFeaturesV1 } from '../extract';

describe('extractPhaseBFeaturesV1', () => {
  it('computes counts, ratios, and flags from lineage', () => {
    const lineage = {
      nodes: [
        { id: 'deal:1', node_type: 'DEAL' },
        { id: 'doc:1', node_type: 'DOCUMENT' },
        { id: 'seg:1', node_type: 'SEGMENT', data: { segment_key: 'market' } },
        { id: 'seg:2', node_type: 'SEGMENT', data: { segment_key: 'team' } },
        { id: 'visual:1', node_type: 'VISUAL', data: { ocr_text: 'abc' } },
        { id: 'visual:2', node_type: 'VISUAL', data: { ocr_text: 'hello', structured_kind: 'table' } },
        { id: 'visual:3', node_type: 'VISUAL', data: { structured_kind: 'bar' } },
        { id: 'evidence:1', node_type: 'EVIDENCE' },
        { id: 'evidence:2', node_type: 'EVIDENCE' },
        { id: 'evidence:3', node_type: 'EVIDENCE' },
        { id: 'evidence:4', node_type: 'EVIDENCE' },
      ],
    };

    const res = extractPhaseBFeaturesV1({ dealId: 'deal-1', lineage });

    expect(res.coverage.documents_count).toBe(1);
    expect(res.coverage.segments_count).toBe(2);
    expect(res.coverage.visuals_count).toBe(3);
    expect(res.coverage.evidence_count).toBe(4);
    expect(res.coverage.evidence_per_visual).toBeCloseTo(4 / 3, 5);

    expect(res.content_density.avg_ocr_chars_per_visual).toBeCloseTo(8 / 3, 5);
    expect(res.content_density.pct_visuals_with_ocr).toBeCloseTo(2 / 3, 5);
    expect(res.content_density.pct_visuals_with_structured).toBeCloseTo(2 / 3, 5);

    expect(res.structure.pct_segments_with_visuals).toBe(1);
    expect(res.structure.pct_documents_with_segments).toBe(1);
    expect(res.structure.pct_documents_with_visuals).toBe(1);

    expect(res.flags.no_visuals).toBe(false);
    expect(res.flags.low_evidence).toBe(false);
    expect(res.flags.low_coverage).toBe(true);
    expect(res.notes).toContain('Low segment coverage');
  });
});
