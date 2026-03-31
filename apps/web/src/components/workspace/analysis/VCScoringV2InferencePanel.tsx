/**
 * VCScoringV2InferencePanel
 *
 * Renders the signal inference trace from vc_scoring_v2.inference.
 * For each of the four scored dimensions (Market, Product, Team, Traction):
 *   - Boosted / Not Boosted badge
 *   - Inferred score → Final score
 *   - Bullet reasons (why the score was derived)
 *
 * Purely presentational. Source of truth: vc-scoring-v2.ts inference layer.
 * This is explanation-only UI — it does not modify or re-derive scores.
 */

import type { VCScoringV2InferenceLike, VCScoringV2InferenceTraceLike } from '../../../lib/vcInferenceSummary';

interface VCScoringV2InferencePanelProps {
  inference: VCScoringV2InferenceLike;
  darkMode: boolean;
}

const DIMENSION_META: Array<{
  key: keyof VCScoringV2InferenceLike;
  label: string;
  description: string;
}> = [
  {
    key: 'market',
    label: 'Market',
    description: 'Inferred from growth rate, revenue, and TAM signals',
  },
  {
    key: 'product',
    label: 'Product',
    description: 'Inferred from revenue, ARR/MRR, GTM, and growth signals',
  },
  {
    key: 'team',
    label: 'Team',
    description: 'Derived from structured team score or penalty codes',
  },
  {
    key: 'traction',
    label: 'Traction',
    description: 'Scored from revenue, ARR/MRR, growth rate, and TAM signals',
  },
];

interface DimensionRowProps {
  meta: (typeof DIMENSION_META)[number];
  trace: VCScoringV2InferenceTraceLike;
  darkMode: boolean;
  isLast: boolean;
}

function DimensionRow({ meta, trace, darkMode, isLast }: DimensionRowProps) {
  const border = !isLast
    ? `border-b ${darkMode ? 'border-white/5' : 'border-gray-100'}`
    : '';

  const badgeClass = trace.boosted
    ? darkMode
      ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30'
      : 'text-emerald-700 bg-emerald-50 border-emerald-200'
    : darkMode
      ? 'text-gray-500 bg-gray-500/5 border-gray-600/20'
      : 'text-gray-500 bg-gray-50 border-gray-200';

  const scoreColor = (n: number) => {
    if (n >= 70) return darkMode ? 'text-emerald-400' : 'text-emerald-700';
    if (n >= 45) return darkMode ? 'text-amber-400' : 'text-amber-600';
    return darkMode ? 'text-red-400' : 'text-red-700';
  };

  return (
    <div className={`py-3 ${border}`}>
      {/* Row header */}
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-xs font-semibold ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
              {meta.label}
            </span>
            <span
              data-testid={`inference-badge-${meta.key}`}
              className={`px-1.5 py-0.5 rounded border text-[10px] font-semibold leading-none ${badgeClass}`}
            >
              {trace.boosted ? 'Boosted' : 'No Boost'}
            </span>
          </div>
          <div className={`text-[10px] mt-0.5 ${darkMode ? 'text-gray-600' : 'text-gray-400'}`}>
            {meta.description}
          </div>
        </div>

        {/* Scores */}
        <div className="flex-shrink-0 text-right">
          {trace.boosted ? (
            <div className="flex items-center gap-1 text-xs">
              <span className={`${darkMode ? 'text-gray-600' : 'text-gray-400'} line-through`}>
                {trace.inferred_score}
              </span>
              <span className={darkMode ? 'text-gray-600' : 'text-gray-400'}>→</span>
              <span
                data-testid={`inference-final-${meta.key}`}
                className={`font-semibold ${scoreColor(trace.final_score)}`}
              >
                {trace.final_score}
              </span>
            </div>
          ) : (
            <span
              data-testid={`inference-final-${meta.key}`}
              className={`text-xs font-semibold ${scoreColor(trace.final_score)}`}
            >
              {trace.final_score}
            </span>
          )}
          <div className={`text-[10px] mt-0.5 ${darkMode ? 'text-gray-600' : 'text-gray-400'}`}>
            final
          </div>
        </div>
      </div>

      {/* Reasons */}
      {trace.reasons.length > 0 && (
        <ul
          data-testid={`inference-reasons-${meta.key}`}
          className={`space-y-0.5 ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}
        >
          {trace.reasons.map((reason, i) => (
            <li key={i} className="text-[11px] flex items-start gap-1">
              <span className={`mt-[2px] flex-shrink-0 ${darkMode ? 'text-gray-700' : 'text-gray-300'}`}>
                •
              </span>
              {reason}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function VCScoringV2InferencePanel({
  inference,
  darkMode,
}: VCScoringV2InferencePanelProps) {
  const anyBoosted = DIMENSION_META.some((m) => inference[m.key].boosted);

  return (
    <div
      data-testid="vc-inference-panel"
      className={`mt-4 rounded-lg border ${
        darkMode ? 'border-white/8 bg-white/2' : 'border-gray-200 bg-gray-50/50'
      }`}
    >
      {/* Panel header */}
      <div
        className={`px-4 py-2.5 border-b flex items-center justify-between ${
          darkMode ? 'border-white/8' : 'border-gray-200'
        }`}
      >
        <span
          className={`text-xs font-semibold uppercase tracking-wide ${
            darkMode ? 'text-gray-400' : 'text-gray-500'
          }`}
        >
          Why V2 scored this deal
        </span>
        {anyBoosted && (
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded border font-medium ${
              darkMode
                ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30'
                : 'text-emerald-700 bg-emerald-50 border-emerald-200'
            }`}
          >
            Signal inference active
          </span>
        )}
      </div>

      {/* Dimension rows */}
      <div className="px-4">
        {DIMENSION_META.map((meta, idx) => (
          <DimensionRow
            key={meta.key}
            meta={meta}
            trace={inference[meta.key]}
            darkMode={darkMode}
            isLast={idx === DIMENSION_META.length - 1}
          />
        ))}
      </div>
    </div>
  );
}
