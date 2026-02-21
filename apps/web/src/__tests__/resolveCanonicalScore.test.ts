import { describe, expect, test } from 'vitest';
import { resolveCanonicalScore } from '../lib/resolveCanonicalScore';

describe('resolveCanonicalScore', () => {
  test('returns null+none when report is null', () => {
    const result = resolveCanonicalScore(null);
    expect(result.score).toBeNull();
    expect(result.source).toBe('none');
  });

  test('returns null+none when report is not an object', () => {
    expect(resolveCanonicalScore(undefined).score).toBeNull();
    expect(resolveCanonicalScore('string').score).toBeNull();
    expect(resolveCanonicalScore(42).score).toBeNull();
  });

  test('prefers score_band_v2.overall_score over overallScore', () => {
    const report = {
      overallScore: 48,
      metadata: {
        score_band_v2: { key: 'fund_track', label: 'Fund & Track', overall_score: 82, thresholds_version: 'v2' },
      },
    };
    const result = resolveCanonicalScore(report);
    expect(result.score).toBe(82);
    expect(result.source).toBe('score_band_v2.overall_score');
  });

  test('rounds fractional band score', () => {
    const report = {
      overallScore: 48,
      metadata: { score_band_v2: { overall_score: 81.7 } },
    };
    expect(resolveCanonicalScore(report).score).toBe(82);
  });

  test('falls back to overallScore when score_band_v2 is absent', () => {
    const report = { overallScore: 48, metadata: { cycle_number: 2 } };
    const result = resolveCanonicalScore(report);
    expect(result.score).toBe(48);
    expect(result.source).toBe('report.overallScore');
  });

  test('falls back to overallScore when score_band_v2.overall_score is not a finite number', () => {
    const report = {
      overallScore: 55,
      metadata: { score_band_v2: { overall_score: null } },
    };
    const result = resolveCanonicalScore(report);
    expect(result.score).toBe(55);
    expect(result.source).toBe('report.overallScore');
  });

  test('returns null+none when both score_band_v2 and overallScore are absent', () => {
    const result = resolveCanonicalScore({ metadata: {} });
    expect(result.score).toBeNull();
    expect(result.source).toBe('none');
  });

  test('returns null+none when overallScore is non-finite', () => {
    const result = resolveCanonicalScore({ overallScore: NaN });
    expect(result.score).toBeNull();
    expect(result.source).toBe('none');
  });

  test('[investorScore-fix] canonical score is correct when band_score === overallScore (normal case)', () => {
    // This is the typical production case: both are equal after deterministic bridge.
    const report = {
      overallScore: 72,
      metadata: {
        score_band_v2: { key: 'fund_caution', label: 'Fund (Caution)', overall_score: 72, thresholds_version: 'v2' },
      },
    };
    const result = resolveCanonicalScore(report);
    // Band score preferred; value is same as overallScore so no effective change.
    expect(result.score).toBe(72);
    expect(result.source).toBe('score_band_v2.overall_score');
  });

  test('[investorScore-fix] when band > overallScore, resolver surfaces calibrated score', () => {
    // Scenario: overallScore stored in report = 48 (pre-calibration); band was computed from
    // a different score input (e.g., totals.overall_score after deterministic bridge).
    const report = {
      overallScore: 48,
      metadata: {
        score_band_v2: { key: 'fund_track', label: 'Fund & Track', overall_score: 82, thresholds_version: 'v2' },
      },
    };
    const result = resolveCanonicalScore(report);
    // investorScore (and thus fundamentalsScore0_100 when dealFromApi.score is absent)
    // must be set from the CANONICAL score (82), not the raw overallScore (48).
    expect(result.score).toBe(82);
    expect(result.source).toBe('score_band_v2.overall_score');
  });
});
