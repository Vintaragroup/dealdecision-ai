import { describe, expect, it } from 'vitest';
import { extractPhaseBFeatures } from '../extract';
import { computePhaseBScore } from '../score';
import type { PhaseBFeatures } from '../types';

describe('Phase B scoring', () => {
  it('missing + thin + low confidence coverage pushes recommendation to pass', () => {
    const missingSegments = Array.from({ length: 5 }, () => ({
      segment_key: '',
      segment_label: undefined,
      document_ids: [],
      visual_count: 0,
      evidence_count: 0,
    }));

    const keyedSegments = ['product', 'market', 'traction', 'team', 'financials', 'risks', 'docs', 'evidence'].map((k: string) => ({
      segment_key: k,
      segment_label: k,
      document_ids: [],
      visual_count: 0,
      evidence_count: 0,
      avg_confidence: 0.4,
    }));

    const features: PhaseBFeatures = {
      total_documents: 0,
      total_visuals: 0,
      total_evidence: 0,
      avg_doc_confidence: null,
      segments: [...missingSegments, ...keyedSegments],
    };

    const res = computePhaseBScore(features);
    expect(res.score_0_100).toBeLessThan(55); // combined penalties applied
    expect(res.recommendation).toBe('pass');
    expect(res.penalties.find((p) => p.code === 'missing_segment')).toBeTruthy();
    expect(res.penalties.find((p) => p.code === 'thin_segments')).toBeTruthy();
    expect(res.penalties.find((p) => p.code === 'low_confidence')).toBeTruthy();
  });

  it('all segments present but thin evidence → watch', () => {
    const segments = ['product', 'market', 'traction', 'team', 'financials', 'risks', 'docs', 'evidence'].map((k: string) => ({
      segment_key: k,
      segment_label: k,
      document_ids: ['doc-1'],
      visual_count: 1,
      evidence_count: 0,
      avg_confidence: 0.5,
    }));
    const features: PhaseBFeatures = {
      total_documents: 1,
      total_visuals: 0,
      total_evidence: 0,
      avg_doc_confidence: 0.8,
      segments,
    };

    const res = computePhaseBScore(features);
    expect(res.recommendation).toBe('watch'); // penalties keep score below invest threshold
    expect(res.score_0_100).toBeGreaterThanOrEqual(55);
    expect(res.score_0_100).toBeLessThan(75);
    expect(res.confidence_0_1).toBeGreaterThan(0.6);
  });

  it('good evidence density lifts confidence and score to invest', () => {
    const segments = ['product', 'market', 'traction', 'team', 'financials', 'risks', 'docs', 'evidence'].map((k: string) => ({
      segment_key: k,
      segment_label: k,
      document_ids: ['doc-1'],
      visual_count: 3,
      evidence_count: 5,
      avg_confidence: 0.9,
    }));
    const features: PhaseBFeatures = {
      total_documents: 2,
      total_visuals: 10,
      total_evidence: 30, // triggers +0.10 confidence bonus
      avg_doc_confidence: 0.9,
      segments,
    };

    const res = computePhaseBScore(features);
    expect(res.score_0_100).toBeGreaterThanOrEqual(75);
    expect(res.recommendation).toBe('invest');
    expect(res.confidence_0_1).toBeGreaterThanOrEqual(0.65);
  });
});

describe('Phase B extraction', () => {
  it('derives section keys from overview coverage when present', () => {
    const features = extractPhaseBFeatures({
      dealId: 'deal-1',
      documentsForAnalyzers: [
        { document_id: 'doc-1', verification_result: { overall_score: 0.8 } },
      ],
      phase1_deal_overview_v2: { sections: { product_solution: 'present', market_icp: 'partial' } },
      currentPhase1: null,
    });

    expect(features.total_documents).toBe(1);
    expect(features.segments.map((s: PhaseBFeatures['segments'][number]) => s.segment_key)).toEqual(['product_solution', 'market_icp']);
    expect(features.avg_doc_confidence).toBeCloseTo(0.8);
  });

  it('falls back to Phase1 coverage/decision when overview missing', () => {
    const features = extractPhaseBFeatures({
      dealId: 'deal-1',
      documentsForAnalyzers: [],
      phase1_deal_overview_v2: null,
      currentPhase1: { coverage: { sections: { traction: 'present', risks: 'missing' } } },
    });

    expect(features.segments.map((s: PhaseBFeatures['segments'][number]) => s.segment_key)).toEqual(['traction', 'risks']);
  });
});
