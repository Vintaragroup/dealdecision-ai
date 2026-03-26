import { Clock, AlertTriangle } from 'lucide-react';
import { TemporalAlignmentBlock } from '../../../types/financialAudit';
import { getCardBackground } from '../../../utils/financialAuditHelpers';

interface Props {
  block: TemporalAlignmentBlock;
  darkMode?: boolean;
}

/**
 * Temporal Alignment Panel — Phase 3B
 *
 * Renders ONE grouped explanation for metrics that mix projected and historical facts.
 * Tone: amber (warning), not red — temporal mismatches are not numeric conflicts.
 *
 * Replaces the old pattern of N per-metric "mixes projected and historical" raw messages.
 */
export function TemporalAlignmentPanel({ block, darkMode = true }: Props) {
  if (!block.hasIssue) return null;

  const { affectedMetrics, explanation } = block;

  return (
    <div
      className={`p-4 rounded-xl border ${
        darkMode
          ? 'bg-amber-500/8 border-amber-500/25'
          : 'bg-amber-50 border-amber-200'
      }`}
    >
      {/* Header */}
      <div className="flex items-center gap-2 mb-3">
        <Clock
          className={`w-4 h-4 flex-shrink-0 ${
            darkMode ? 'text-amber-400' : 'text-amber-600'
          }`}
        />
        <h3
          className={`text-xs font-medium uppercase tracking-wide ${
            darkMode ? 'text-amber-400' : 'text-amber-700'
          }`}
        >
          Temporal Alignment
        </h3>
        <span
          className={`ml-auto text-xs px-2 py-0.5 rounded ${
            darkMode
              ? 'bg-amber-500/20 text-amber-400'
              : 'bg-amber-100 text-amber-700'
          }`}
        >
          {affectedMetrics.length} metric{affectedMetrics.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Explanation */}
      <p
        className={`text-sm mb-3 leading-relaxed ${
          darkMode ? 'text-gray-300' : 'text-gray-700'
        }`}
      >
        {explanation}
      </p>

      {/* Affected metrics list */}
      {affectedMetrics.length > 0 && (
        <div className="mb-3">
          <div
            className={`text-xs mb-2 font-medium ${
              darkMode ? 'text-amber-400/70' : 'text-amber-600'
            }`}
          >
            Cross-source comparison limited for:
          </div>
          <div className="flex flex-wrap gap-1.5">
            {affectedMetrics.map((metric) => (
              <span
                key={metric}
                className={`px-2 py-0.5 rounded text-xs font-mono ${
                  darkMode
                    ? 'bg-amber-500/15 text-amber-300 border border-amber-500/20'
                    : 'bg-amber-100 text-amber-800 border border-amber-200'
                }`}
              >
                {metric.replace(/_/g, ' ')}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Footer note */}
      <div
        className={`flex items-start gap-1.5 text-xs ${
          darkMode ? 'text-amber-400/60' : 'text-amber-600/80'
        }`}
      >
        <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
        <span>
          Projected vs. realized comparisons are excluded from the numeric conflict count.
          Review projected figures independently before relying on them in an investment decision.
        </span>
      </div>
    </div>
  );
}
