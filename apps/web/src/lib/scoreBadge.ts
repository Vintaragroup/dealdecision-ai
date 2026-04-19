/**
 * scoreBadge — shared score interpretation utility
 *
 * Single source of truth for translating raw numeric scores into
 * investor-facing badge labels, meanings, and actions.
 *
 * Score buckets are universal; copy is context-specific.
 *
 * Usage:
 *   const badge  = scoreToBadge(convictionScore, 'conviction');
 *   const colors = getScoreBadgeColors(badge.bucket, darkMode);
 *   // → { bucket: 'uncertain', label: 'Uncertain', meaning: 'Not ready for commitment', action: '...' }
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type ScoreBucket = 'strong' | 'promising' | 'uncertain' | 'weak' | 'broken';

export type ScoreContext =
  | 'deal_score'
  | 'conviction'
  | 'decision_confidence'
  | 'section_health';

export interface ScoreBadgeInfo {
  bucket: ScoreBucket | 'unknown';
  /** Badge label — e.g. "Promising" */
  label: string;
  /** Context-specific meaning — e.g. "Worth investigating" */
  meaning: string;
  /** Suggested action — e.g. "Validate key risks" */
  action: string;
}

export interface ScoreBadgeColors {
  text: string;
  bg: string;
  border: string;
  barBg: string;
}

// ─── Score → bucket ───────────────────────────────────────────────────────────

const BUCKET_LABELS: Record<ScoreBucket, string> = {
  strong:    'Strong',
  promising: 'Promising',
  uncertain: 'Uncertain',
  weak:      'Weak',
  broken:    'Broken',
};

const CONTEXT_COPY: Record<ScoreContext, Record<ScoreBucket, { meaning: string; action: string }>> = {
  deal_score: {
    strong:    { meaning: 'Ready to pursue',             action: 'Ready to act' },
    promising: { meaning: 'Worth investigating',         action: 'Validate key risks' },
    uncertain: { meaning: 'Mixed opportunity',           action: 'Investigate further' },
    weak:      { meaning: 'Low quality opportunity',     action: 'Do not proceed' },
    broken:    { meaning: 'Not investable as presented', action: 'Rebuild / reject' },
  },
  conviction: {
    strong:    { meaning: 'Investment-ready',               action: 'Ready to act' },
    promising: { meaning: 'Close, needs validation',        action: 'Validate key risks' },
    uncertain: { meaning: 'Not ready for commitment',       action: 'Investigate further' },
    weak:      { meaning: 'Do not proceed yet',             action: 'Do not proceed' },
    broken:    { meaning: 'Fails core threshold',           action: 'Rebuild / reject' },
  },
  decision_confidence: {
    strong:    { meaning: 'Decision-ready',                    action: 'Ready to act' },
    promising: { meaning: 'Conclusion mostly stable',          action: 'Validate key risks' },
    uncertain: { meaning: 'Not decision-ready',                action: 'Investigate further' },
    weak:      { meaning: 'Do not trust this conclusion yet',  action: 'Do not proceed' },
    broken:    { meaning: 'Rebuild analysis',                  action: 'Rebuild / reject' },
  },
  section_health: {
    strong:    { meaning: 'Well supported',                  action: 'Ready to act' },
    promising: { meaning: 'Generally supported',             action: 'Validate key risks' },
    uncertain: { meaning: 'Gaps remain',                     action: 'Investigate further' },
    weak:      { meaning: 'Poorly supported',                action: 'Do not proceed' },
    broken:    { meaning: 'Unsupported / missing evidence',  action: 'Rebuild / reject' },
  },
};

/**
 * Map a raw numeric score to a semantic bucket.
 * Returns 'unknown' when score is null / non-finite.
 */
export function getScoreBucket(score: number | null): ScoreBucket | 'unknown' {
  if (score === null || !Number.isFinite(score)) return 'unknown';
  if (score >= 70) return 'strong';
  if (score >= 55) return 'promising';
  if (score >= 40) return 'uncertain';
  if (score >= 25) return 'weak';
  return 'broken';
}

/**
 * Translate a score + context into a full badge descriptor.
 */
export function scoreToBadge(score: number | null, context: ScoreContext): ScoreBadgeInfo {
  const bucket = getScoreBucket(score);
  if (bucket === 'unknown') {
    return { bucket: 'unknown', label: 'Not evaluated', meaning: '', action: '' };
  }
  const { meaning, action } = CONTEXT_COPY[context][bucket];
  return { bucket, label: BUCKET_LABELS[bucket], meaning, action };
}

/**
 * Tailwind color classes per bucket and dark/light mode.
 * These classes are used for badge backgrounds, text, borders, and progress bars.
 */
export function getScoreBadgeColors(
  bucket: ScoreBucket | 'unknown',
  darkMode: boolean,
): ScoreBadgeColors {
  switch (bucket) {
    case 'strong':
      return darkMode
        ? { text: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', barBg: 'bg-emerald-500' }
        : { text: 'text-emerald-700', bg: 'bg-emerald-50',     border: 'border-emerald-200',    barBg: 'bg-emerald-500' };
    case 'promising':
      return darkMode
        ? { text: 'text-sky-400',     bg: 'bg-sky-500/10',     border: 'border-sky-500/20',     barBg: 'bg-sky-500' }
        : { text: 'text-sky-700',     bg: 'bg-sky-50',         border: 'border-sky-200',        barBg: 'bg-sky-500' };
    case 'uncertain':
      return darkMode
        ? { text: 'text-amber-400',   bg: 'bg-amber-500/10',   border: 'border-amber-500/20',   barBg: 'bg-amber-500' }
        : { text: 'text-amber-700',   bg: 'bg-amber-50',       border: 'border-amber-200',      barBg: 'bg-amber-500' };
    case 'weak':
      return darkMode
        ? { text: 'text-orange-400',  bg: 'bg-orange-500/10',  border: 'border-orange-500/20',  barBg: 'bg-orange-500' }
        : { text: 'text-orange-700',  bg: 'bg-orange-50',      border: 'border-orange-200',     barBg: 'bg-orange-500' };
    case 'broken':
      return darkMode
        ? { text: 'text-red-400',     bg: 'bg-red-500/10',     border: 'border-red-500/20',     barBg: 'bg-red-500' }
        : { text: 'text-red-700',     bg: 'bg-red-50',         border: 'border-red-200',        barBg: 'bg-red-500' };
    default: // unknown
      return darkMode
        ? { text: 'text-gray-500',    bg: 'bg-white/5',        border: 'border-white/10',       barBg: 'bg-gray-600' }
        : { text: 'text-gray-500',    bg: 'bg-gray-50',        border: 'border-gray-200',       barBg: 'bg-gray-300' };
  }
}
