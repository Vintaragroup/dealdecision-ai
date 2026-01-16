import type { Deal } from '@dealdecision/contracts';

import type { ScoreSourceV1 } from '../contexts/ScoreSourceContext';

export function extractFundabilityScore0_100(deal: Pick<Deal, 'fundability_v1'>): number | null {
  const raw = deal?.fundability_v1?.fundability_assessment_v1?.fundability_score_0_100;
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

export function extractLegacyScore0_100(deal: Pick<Deal, 'score'>): number | null {
  const raw = deal?.score;
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

export function getDisplayScoreForDeal(
  deal: Pick<Deal, 'score' | 'fundability_v1'>,
  preferred: ScoreSourceV1,
): { score: number | null; sourceUsed: ScoreSourceV1 } {
  const legacy = extractLegacyScore0_100(deal);

  if (preferred === 'fundability_v1') {
    const fundability = extractFundabilityScore0_100(deal);
    if (fundability != null) return { score: fundability, sourceUsed: 'fundability_v1' };
  }

  return { score: legacy, sourceUsed: 'legacy' };
}
