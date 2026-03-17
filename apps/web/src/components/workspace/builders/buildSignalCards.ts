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

/**
 * Contextual description strings that appear beneath the signal title.
 * These are distinct from the title — they convey evidence context, not
 * the signal observation itself.
 */
const _DESCRIPTION_CONTEXT: Record<
  'high' | 'med' | 'low' | 'unknown',
  { strength: string; concern: string }
> = {
  high: {
    strength: 'Supporting evidence found across submitted materials.',
    concern: 'Flagged during diligence review.',
  },
  med: {
    strength: 'Partially supported by available evidence.',
    concern: 'Area of potential concern — evidence is partial.',
  },
  low: {
    strength: 'Identified strength — evidence is limited.',
    concern: 'Risk area — limited evidence to fully assess.',
  },
  unknown: {
    strength: 'Identified strength — evidence not yet assessed.',
    concern: 'Risk area — evidence not yet assessed.',
  },
};

/**
 * Normalise snake_case machine keys to Title Case so internal field names
 * never surface directly as signal titles.
 * Examples: "market_traction" → "Market Traction", "SaaS model" → "SaaS model".
 */
function toTitleCase(s: string): string {
  return /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/.test(s.trim())
    ? s.trim().split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
    : s;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Build WorkspaceSignalCard[] from analysis strengths and weaknesses.
 *
 * Strengths → 'strength' type.
 * Weaknesses → 'concern' type.
 * Confidence float derived from overall confidence band.
 *
 * Deduplication: titles are compared case-insensitively; the first
 * occurrence wins. snake_case machine keys are normalised to Title Case
 * so internal keys never surface as visible signal text.
 */
export function buildSignalCards(
  strengths: string[],
  weaknesses: string[],
  band: 'high' | 'med' | 'low' | 'unknown',
): WorkspaceSignalCard[] {
  const confidenceFloat = _BAND_CONFIDENCE[band];
  const ctx = _DESCRIPTION_CONTEXT[band];
  const cards: WorkspaceSignalCard[] = [];
  // Deduplication set — tracks normalised lower-case titles across both arrays.
  const seen = new Set<string>();

  for (const title of strengths) {
    const t = toTitleCase(title?.trim() ?? '');
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cards.push({
      type: 'strength',
      title: t,
      description: ctx.strength,
      confidence: confidenceFloat,
      source: 'score_explanation_v1',
    });
  }

  for (const title of weaknesses) {
    const t = toTitleCase(title?.trim() ?? '');
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cards.push({
      type: 'concern',
      title: t,
      description: ctx.concern,
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
  // Concern cards: lower confidence → less certain label.
  // 'low' / 'unknown' bands mean we have limited evidence, so concern labels
  // should reflect that — NOT "Strong Evidence" (which was a semantic inversion).
  const negativeLabel: WorkspaceOverviewSignal['confidence'] =
    band === 'low' || band === 'unknown' ? 'Limited Evidence' : 'Partial Evidence';

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
