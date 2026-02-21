/**
 * resolveCanonicalScore
 *
 * Single authoritative score resolver for a deal report object.
 * Consumers MUST use this function instead of reading score fields directly,
 * so gauge, labels, and the SCORE_MISMATCH_IN_COPY validator all agree.
 *
 * Priority:
 *   1. report.metadata.score_band_v2.overall_score  (calibrated post-band score)
 *   2. report.overallScore                          (pre-calibration)
 *   3. null                                         (not scored)
 */
export type ResolvedScore = {
  /** Rounded integer 0-100, or null when no score is available. */
  score: number | null;
  /** Which field the score was resolved from. */
  source: 'score_band_v2.overall_score' | 'report.overallScore' | 'none';
};

/**
 * Returns a `ResolvedScore` for the given report object (or null/non-object).
 *
 * Pure function — safe to call in useMemo, tests, or outside React.
 *
 * @param report - The raw report object (e.g. `reportFromApi`). Pass `null` when
 *   the report is not ready yet; the result will be `{ score: null, source: 'none' }`.
 */
export function resolveCanonicalScore(report: unknown): ResolvedScore {
  if (!report || typeof report !== 'object') {
    return { score: null, source: 'none' };
  }

  const r = report as Record<string, unknown>;

  // 1. Prefer calibrated band score
  const meta = r['metadata'];
  if (meta && typeof meta === 'object') {
    const bandScoreRaw = (meta as Record<string, unknown>)?.['score_band_v2'];
    if (bandScoreRaw && typeof bandScoreRaw === 'object') {
      const overall = (bandScoreRaw as Record<string, unknown>)['overall_score'];
      if (typeof overall === 'number' && Number.isFinite(overall)) {
        return { score: Math.round(overall), source: 'score_band_v2.overall_score' };
      }
    }
  }

  // 2. Fall back to pre-calibration top-level score
  const overallScore = r['overallScore'];
  if (typeof overallScore === 'number' && Number.isFinite(overallScore)) {
    return { score: Math.round(overallScore), source: 'report.overallScore' };
  }

  return { score: null, source: 'none' };
}
