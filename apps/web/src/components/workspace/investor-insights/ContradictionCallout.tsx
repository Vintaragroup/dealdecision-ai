/**
 * ContradictionCallout — progressive-disclosure component for mixed/conflicting evidence.
 *
 * Compact state:
 *   ⚡ Mixed signals  (amber chip)   — for status="mixed"
 *   ⚡ Conflicting evidence (red chip) — for status="conflicting"
 *
 * Expanded state (click to reveal):
 *   Primary interpretation
 *   Runner-up interpretation(s)
 *   Optional notes
 *
 * Renders nothing when contradiction is null (absent or status="none").
 */

import React, { useState } from 'react';
import { AlertTriangle, Zap, ChevronDown, ChevronUp } from 'lucide-react';
import type { NarrativeContradictionV1 } from '../investorInsightsUtils';

interface ContradictionCalloutProps {
  contradiction: NarrativeContradictionV1 | null;
  darkMode: boolean;
  /** When true, renders only the inline chip (no expand control). Default false. */
  chipOnly?: boolean;
}

export function ContradictionCallout({
  contradiction,
  darkMode,
  chipOnly = false,
}: ContradictionCalloutProps) {
  const [expanded, setExpanded] = useState(false);

  if (!contradiction || contradiction.status === 'none') return null;

  const isConflicting = contradiction.status === 'conflicting';

  // ── Chip colors ────────────────────────────────────────────────────────────
  const chipBg = isConflicting
    ? darkMode ? 'bg-red-900/30 border-red-700/50' : 'bg-red-50 border-red-200'
    : darkMode ? 'bg-amber-900/30 border-amber-700/50' : 'bg-amber-50 border-amber-200';

  const chipText = isConflicting
    ? darkMode ? 'text-red-300' : 'text-red-700'
    : darkMode ? 'text-amber-300' : 'text-amber-700';

  const expandBg = darkMode
    ? 'bg-white/5 border-white/10'
    : 'bg-gray-50 border-gray-200';

  // Left accent color for the expanded detail panel
  const accentBorder = isConflicting
    ? darkMode ? 'border-l-red-500/60' : 'border-l-red-400'
    : darkMode ? 'border-l-amber-500/60' : 'border-l-amber-400';

  const labelText = isConflicting ? 'Conflicting evidence' : 'Mixed signals';
  const Icon = isConflicting ? AlertTriangle : Zap;

  const hasSecondary = contradiction.secondary_texts.length > 0;

  if (chipOnly) {
    return (
      <span
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-medium ${chipBg} ${chipText}`}
      >
        <Icon className="w-3 h-3 shrink-0" />
        {labelText}
      </span>
    );
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded border text-xs font-medium transition-opacity hover:opacity-80 ${chipBg} ${chipText}`}
        aria-expanded={expanded}
        aria-label={expanded ? 'Collapse contradiction detail' : 'Expand contradiction detail'}
      >
        <Icon className="w-3 h-3 shrink-0" />
        {labelText}
        {expanded ? (
          <ChevronUp className="w-3 h-3 shrink-0 ml-0.5" />
        ) : (
          <ChevronDown className="w-3 h-3 shrink-0 ml-0.5" />
        )}
      </button>

      {expanded && (
        <div
          className={`mt-2 rounded-lg border border-l-2 p-3 pl-3.5 space-y-2 text-xs ${accentBorder} ${expandBg} ${
            darkMode ? 'text-gray-300' : 'text-gray-700'
          }`}
          data-testid="contradiction-detail"
        >
          {/* Primary interpretation */}
          <div>
            <span
              className={`inline-block text-[10px] font-semibold uppercase tracking-wide mb-1 ${
                darkMode ? 'text-gray-500' : 'text-gray-400'
              }`}
            >
              Leading interpretation
            </span>
            <p className="leading-relaxed">{contradiction.primary_text}</p>
          </div>

          {/* Runner-up interpretation(s) */}
          {hasSecondary && (
            <div>
              <span
                className={`inline-block text-[10px] font-semibold uppercase tracking-wide mb-1 ${
                  isConflicting
                    ? darkMode ? 'text-red-500' : 'text-red-600'
                    : darkMode ? 'text-amber-500' : 'text-amber-600'
                }`}
              >
                {isConflicting ? 'Conflicting view' : 'Alternative view'}
              </span>
              {contradiction.secondary_texts.slice(0, 2).map((txt, i) => (
                <p key={i} className="leading-relaxed">
                  {txt}
                </p>
              ))}
            </div>
          )}

          {/* Reason tag */}
          {contradiction.reason && (
            <p
              className={`text-[10px] font-mono border-t pt-2 mt-1 ${
                darkMode ? 'text-gray-600 border-white/10' : 'text-gray-400 border-gray-200'
              }`}
            >
              <span className={`font-semibold ${
                darkMode ? 'text-gray-500' : 'text-gray-400'
              }`}>reason:</span>{' '}{contradiction.reason}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
