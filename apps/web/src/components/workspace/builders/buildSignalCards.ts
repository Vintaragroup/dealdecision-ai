/**
 * buildSignalCards
 *
 * Builds normalised WorkspaceSignalCard[] and DealOverviewTab-compatible
 * WorkspaceOverviewSignal[] from analysis strength/weakness string arrays
 * and the overall confidence band.
 *
 * Replaces the previous hardcoded signals=[] passed to DealOverviewTab.
 */

import type { WorkspaceSignalCard, WorkspaceOverviewSignal } from '../contracts/workspaceViewModel';

// ─── Helpers ────────────────────────────────────────────────────────────────

const _BAND_CONFIDENCE: Record<'high' | 'med' | 'low' | 'unknown', number | null> = {
  high: 0.85,
  med: 0.62,
  low: 0.38,
  unknown: null,
};

const _EVIDENCE_LABEL: Record<
  'high' | 'med' | 'low' | 'unknown',
  WorkspaceOverviewSignal['confidence']
> = {
  high: 'Strong Evidence',
  med: 'Partial Evidence',
  low: 'Limited Evidence',
  unknown: 'Limited Evidence',
};

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Build WorkspaceSignalCard[] from analysis strengths and weaknesses.
 *
 * Strengths → 'strength' type.
 * Weaknesses → 'concern' type.
 * Confidence float derived from overall confidence band.
 */
export function buildSignalCards(
  strengths: string[],
  weaknesses: string[],
  band: 'high' | 'med' | 'low' | 'unknown',
): WorkspaceSignalCard[] {
  const confidenceFloat = _BAND_CONFIDENCE[band];
  const cards: WorkspaceSignalCard[] = [];

  for (const title of strengths) {
    const t = title?.trim();
    if (!t) continue;
    cards.push({
      type: 'strength',
      title: t,
      description: t,
      confidence: confidenceFloat,
      source: 'score_explanation_v1',
    });
  }

  for (const title of weaknesses) {
    const t = title?.trim();
    if (!t) continue;
    cards.push({
      type: 'concern',
      title: t,
      description: t,
      confidence: confidenceFloat,
      source: 'score_explanation_v1',
    });
  }

  return cards;
}

/**
 * Convert WorkspaceSignalCard[] to WorkspaceOverviewSignal[] for the
 * DealOverviewTab signals prop.
 *
 * Assigns representative placement scores (not authoritative scores) and
 * confidence labels for the overview signals display. Strengths cluster
 * in the 70–90 range; concerns cluster in the 25–50 range.
 */
export function toOverviewSignalData(
  cards: WorkspaceSignalCard[],
  band: 'high' | 'med' | 'low' | 'unknown',
): WorkspaceOverviewSignal[] {
  const positiveLabel = _EVIDENCE_LABEL[band];
  const negativeLabel: WorkspaceOverviewSignal['confidence'] =
    band === 'low' ? 'Strong Evidence' : 'Partial Evidence';

  let strengthIdx = 0;
  let concernIdx = 0;

  return cards.map((card) => {
    const isPositive = card.type === 'strength' || card.type === 'traction';

    const score = isPositive
      ? Math.max(60, 85 - strengthIdx++ * 5)   // 85, 80, 75, 70 ...
      : Math.max(20, 50 - concernIdx++ * 5);    // 50, 45, 40, 35 ...

    return {
      name: card.title,
      score,
      explanation: card.description,
      confidence: isPositive ? positiveLabel : negativeLabel,
    };
  });
}
