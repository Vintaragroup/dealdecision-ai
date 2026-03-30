import { describe, expect, it } from 'vitest';
import {
  humanizeActionTitle,
  humanizeContradictionType,
  humanizeCriticalFieldName,
  humanizeEvidenceRef,
  humanizeEvidenceRefs,
  normalizeDeepDiveText,
} from '../deepDiveHumanization';

describe('deepDiveHumanization', () => {
  it('humanizes critical field names', () => {
    expect(humanizeCriticalFieldName('raise_cap')).toBe('SAFE valuation cap');
    expect(humanizeCriticalFieldName('valuation_post')).toBe('post-money valuation');
  });

  it('humanizes contradiction labels', () => {
    expect(humanizeContradictionType('semantic_divergence')).toContain('conflicting descriptions');
  });

  it('humanizes evidence refs without exposing raw ids', () => {
    expect(humanizeEvidenceRef('dpu:doc:f18aa49b:page:22')).toBe('Source material, page 22');
    expect(humanizeEvidenceRefs(['dpu:doc:a:page:2', 'dpu:doc:b:page:2'])).toEqual(['Source material, page 2']);
  });

  it('rewrites machine phrasing and malformed money output', () => {
    const text = normalizeDeepDiveText('No explicit TAM KPI evidence found. proof_signals=1 $2352769.0B');
    expect(text).toContain('do not provide a clearly supported TAM estimate');
    expect(text).toContain('limited hard proof points available');
    expect(text).not.toContain('$2352769.0B');
  });

  it('humanizes action title templates', () => {
    expect(humanizeActionTitle('Backfill raise_cap with evidence-backed data')).toContain('SAFE valuation cap');
  });
});
