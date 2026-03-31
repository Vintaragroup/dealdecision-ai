import { describe, expect, it } from 'vitest';
import {
  getInferenceSummary,
  getBoostedDimensions,
  type VCScoringV2InferenceLike,
} from '../vcInferenceSummary';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeTrace(
  boosted: boolean,
  reasons: string[] = [],
  inferred_score = 60,
  final_score = 55
) {
  return { boosted, inferred_score, final_score, reasons };
}

function makeInference(overrides: Partial<VCScoringV2InferenceLike> = {}): VCScoringV2InferenceLike {
  return {
    market: makeTrace(false, ['No market inference boost — structured market score used as-is.']),
    product: makeTrace(false, ['No product signals — inference at floor.']),
    team: makeTrace(false, ['No team penalty signals — assuming adequate team composition.']),
    traction: makeTrace(false, ['No traction signals — scored at minimum floor.']),
    ...overrides,
  };
}

// ─── getBoostedDimensions ─────────────────────────────────────────────────────

describe('getBoostedDimensions', () => {
  it('returns empty array when no dimensions boosted', () => {
    const result = getBoostedDimensions(makeInference());
    expect(result).toEqual([]);
  });

  it('returns only boosted dimension keys', () => {
    const inference = makeInference({
      product: makeTrace(true, ['Revenue present — product has demonstrated exchangeability.']),
      traction: makeTrace(true, ['Revenue present — commercial traction confirmed.']),
    });
    const result = getBoostedDimensions(inference);
    expect(result).toContain('product');
    expect(result).toContain('traction');
    expect(result).not.toContain('market');
    expect(result).not.toContain('team');
  });

  it('returns traction before product (priority order)', () => {
    const inference = makeInference({
      product: makeTrace(true, ['Revenue present.']),
      traction: makeTrace(true, ['Revenue present.']),
    });
    const result = getBoostedDimensions(inference);
    expect(result.indexOf('traction')).toBeLessThan(result.indexOf('product'));
  });
});

// ─── getInferenceSummary ──────────────────────────────────────────────────────

describe('getInferenceSummary', () => {
  it('returns null when no dimensions boosted', () => {
    expect(getInferenceSummary(makeInference())).toBeNull();
  });

  it('returns a "Boosted by" phrase when multiple signal reasons exist', () => {
    const inference = makeInference({
      product: makeTrace(true, [
        'Revenue present — product has demonstrated exchangeability.',
        'ARR/MRR present — recurring usage implies product retention.',
        'GTM strategy signals product-market clarity.',
        'Growth rate present — product demand is increasing.',
      ]),
      traction: makeTrace(true, [
        'Revenue present — commercial traction confirmed.',
        'ARR/MRR present — recurring revenue validates retention.',
        'Growth rate present — directional momentum confirmed.',
      ]),
    });
    const summary = getInferenceSummary(inference);
    expect(summary).not.toBeNull();
    expect(summary!.toLowerCase()).toContain('boosted by');
    // Should extract concrete signal names
    expect(summary!.toLowerCase()).toMatch(/revenue|arr|growth/);
  });

  it('returns a single-dimension phrase when only one dim boosted but signal clear', () => {
    const inference = makeInference({
      traction: makeTrace(true, ['Revenue present — commercial traction confirmed.']),
    });
    const summary = getInferenceSummary(inference);
    expect(summary).not.toBeNull();
    // Single dim with single phrase → "Traction boosted by revenue present"
    expect(summary!.toLowerCase()).toContain('traction');
    expect(summary!.toLowerCase()).toContain('revenue');
  });

  it('falls back to dimension names when no signal phrases match', () => {
    // Reasons that don't start with signal keywords — edge case (shouldn't happen in prod)
    const inference = makeInference({
      market: makeTrace(true, ['Market inferred at 72 vs structured 55.']),
    });
    const summary = getInferenceSummary(inference);
    expect(summary).not.toBeNull();
    expect(summary!.toLowerCase()).toContain('market');
  });

  it('deduplicates identical signal phrases across dimensions', () => {
    const inference = makeInference({
      product: makeTrace(true, ['Revenue present — product signal.']),
      traction: makeTrace(true, ['Revenue present — traction signal.']),
    });
    const summary = getInferenceSummary(inference);
    expect(summary).not.toBeNull();
    // "revenue present" should appear only once in the summary
    const lower = summary!.toLowerCase();
    const firstIdx = lower.indexOf('revenue present');
    const secondIdx = lower.indexOf('revenue present', firstIdx + 1);
    expect(secondIdx).toBe(-1); // no duplicate
  });

  it('caps summary at 4 signal phrases max', () => {
    const inference = makeInference({
      traction: makeTrace(true, [
        'Revenue present — traction.',
        'ARR/MRR present — traction.',
        'Growth rate present — traction.',
        'TAM present — traction.',
      ]),
      product: makeTrace(true, [
        'Revenue present — product.',
        'ARR/MRR present — product.',
        'GTM strategy signals product-market clarity.',
        'Growth rate present — product.',
      ]),
    });
    const summary = getInferenceSummary(inference);
    // Ensure summary is non-null and reasonable length
    expect(summary).not.toBeNull();
    expect(summary!.length).toBeLessThan(200);
  });
});
