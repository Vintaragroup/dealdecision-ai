/**
 * SentimentFilterToggle — Filter by Sentiment control for the External Due
 * Diligence search results.
 *
 * Filters visible buckets by the direction/sentiment of their signal:
 *   All          → show everything (default)
 *   Positive     → buckets whose signal direction is positive/growing/bullish/supportive
 *   Risk         → buckets whose signal direction is negative/declining/bearish or whose
 *                   bucket key is 'external_risks'
 *   Mixed        → remaining / unknown / mixed buckets
 *
 * Degrades safely when signal data is absent (falls through to All).
 */

import React from 'react';
import type { ExternalDiligenceBucket } from '../investorInsightsUtils';

export type SentimentFilter = 'all' | 'positive' | 'risk' | 'mixed';

const FILTER_OPTIONS: { value: SentimentFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'positive', label: 'Positive' },
  { value: 'risk', label: 'Risk' },
  { value: 'mixed', label: 'Mixed' },
];

const POSITIVE_DIRECTIONS = new Set(['positive', 'growing', 'supportive', 'bullish', 'typical', 'moderate']);
const NEGATIVE_DIRECTIONS = new Set(['negative', 'declining', 'bearish', 'weak', 'selective']);

/** Resolve the sentiment bucket for a given signal payload. */
function bucketSentiment(bucket: ExternalDiligenceBucket): SentimentFilter {
  if (bucket.bucket === 'external_risks') return 'risk';

  if (!bucket.signal) return 'mixed';

  // Check direction field (present on market_outlook, founder_team, financial_context, etc.)
  const signal = bucket.signal as unknown as Record<string, unknown>;

  const direction = (signal['direction'] ?? signal['funding_environment'] ?? '') as string;
  if (direction && POSITIVE_DIRECTIONS.has(direction)) return 'positive';
  if (direction && NEGATIVE_DIRECTIONS.has(direction)) return 'risk';

  // competitive intensity: high = risk, low = positive
  if (signal['competitive_intensity'] === 'high') return 'risk';
  if (signal['competitive_intensity'] === 'low') return 'positive';

  // company visibility: strong = positive, none = risk
  if (signal['footprint_quality'] === 'strong') return 'positive';
  if (signal['footprint_quality'] === 'none') return 'risk';

  return 'mixed';
}

/** Filter an array of buckets by the selected sentiment. */
export function applyBucketSentimentFilter(
  buckets: ExternalDiligenceBucket[],
  filter: SentimentFilter,
): ExternalDiligenceBucket[] {
  if (filter === 'all') return buckets;
  return buckets.filter((b) => {
    const s = bucketSentiment(b);
    if (filter === 'positive') return s === 'positive';
    if (filter === 'risk') return s === 'risk';
    // 'mixed' shows everything that isn't clearly positive or risk
    return s === 'mixed' || s === 'all';
  });
}

// ── Toggle component ──────────────────────────────────────────────────────────

interface SentimentFilterToggleProps {
  value: SentimentFilter;
  onChange: (v: SentimentFilter) => void;
  darkMode: boolean;
  /** Count of visible results for each filter — shown as a badge. */
  counts?: Partial<Record<SentimentFilter, number>>;
}

export function SentimentFilterToggle({
  value,
  onChange,
  darkMode,
  counts,
}: SentimentFilterToggleProps) {
  return (
    <div
      className={`inline-flex items-center gap-0.5 rounded-lg border p-0.5 ${
        darkMode ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-gray-100'
      }`}
      role="group"
      aria-label="Filter by sentiment"
    >
      {FILTER_OPTIONS.map((opt) => {
        const isActive = value === opt.value;
        const count = counts?.[opt.value];
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors ${
              isActive
                ? darkMode
                  ? 'bg-white/15 text-white'
                  : 'bg-white text-gray-900 shadow-sm'
                : darkMode
                ? 'text-gray-400 hover:text-gray-200'
                : 'text-gray-500 hover:text-gray-700'
            }`}
            aria-pressed={isActive}
          >
            {opt.label}
            {count !== undefined && (
              <span
                className={`text-[10px] font-mono ${
                  isActive
                    ? darkMode ? 'text-gray-300' : 'text-gray-500'
                    : darkMode ? 'text-gray-600' : 'text-gray-400'
                }`}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
