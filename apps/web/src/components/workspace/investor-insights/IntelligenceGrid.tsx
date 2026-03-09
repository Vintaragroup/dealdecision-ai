/**
 * IntelligenceGrid — 2×2 responsive grid of topic signal cards.
 *
 * The four quadrants are:
 *   ┌─────────────────────┬────────────────────┐
 *   │ Product &           │ Market Position    │
 *   │ Differentiation     │                    │
 *   ├─────────────────────┼────────────────────┤
 *   │ Go-To-Market        │ Financial Outlook  │
 *   │ Strategy            │                    │
 *   └─────────────────────┴────────────────────┘
 *
 * Each card gets a StatusBadge derived from whether the content is substantive
 * ('green') or absent ('gray').  If the executive_summary hints at risk for
 * a topic the badge is promoted to 'amber'.
 *
 * When a NarrativeContradictionBundle is supplied, cards with mixed/conflicting
 * evidence show a ContradictionCallout beneath the body text.
 */

import React from 'react';
import type { LlmInterpretationV1, NarrativeContradictionBundle, NarrativeContradictionV1 } from '../investorInsightsUtils';
import { getTopicContradiction } from '../investorInsightsUtils';
import { StatusBadge } from './StatusBadge';
import type { StatusBadgeVariant } from './StatusBadge';
import { ContradictionCallout } from './ContradictionCallout';

interface TopicCardProps {
  title: string;
  color: string; // Tailwind text color class for heading
  body: string;
  badge?: { label: string; variant: StatusBadgeVariant };
  darkMode: boolean;
  /** When provided and non-null, renders a ContradictionCallout below the body. */
  contradiction?: NarrativeContradictionV1 | null;
}

function TopicCard({ title, color, body, badge, darkMode, contradiction }: TopicCardProps) {
  const hasContent = body.trim().length > 0 &&
    body !== 'Not determinable from available signals.' &&
    body !== 'Not disclosed.';

  return (
    <div
      className={`rounded-lg border p-4 flex flex-col gap-2 h-full ${
        darkMode ? 'border-white/10 bg-white/5' : 'border-gray-100 bg-gray-50'
      }`}
      data-testid={`topic-card-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={`text-xs font-semibold uppercase tracking-wide ${color}`}>
          {title}
        </span>
        {badge ? (
          <StatusBadge variant={badge.variant} label={badge.label} darkMode={darkMode} />
        ) : null}
      </div>
      <p className={`text-sm leading-relaxed flex-1 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>
        {hasContent ? body : (
          <span className={`italic ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
            Not determinable from available signals.
          </span>
        )}
      </p>
      {/* PR36.9: Contradiction callout — expandable mixed/conflicting detail */}
      {contradiction && (
        <ContradictionCallout contradiction={contradiction} darkMode={darkMode} />
      )}
    </div>
  );
}

/** Derive a badge for a topic text. */
function topicBadge(text: string): { label: string; variant: StatusBadgeVariant } {
  if (!text || text === 'Not determinable from available signals.' || text === 'Not disclosed.') {
    return { label: 'No data', variant: 'gray' };
  }
  const lower = text.toLowerCase();
  if (/\brisk\b|\bconcern\b|\bweak\b|\blimited\b|\bchallenging\b/.test(lower)) {
    return { label: 'Review', variant: 'amber' };
  }
  return { label: 'Signal', variant: 'green' };
}

interface IntelligenceGridProps {
  data: LlmInterpretationV1;
  darkMode: boolean;
  /** PR36.9: Optional contradiction bundle from report_payload. */
  contradictions?: NarrativeContradictionBundle | null;
}

export function IntelligenceGrid({ data, darkMode, contradictions }: IntelligenceGridProps) {
  const productText =
    (data as LlmInterpretationV1 & { product_differentiation?: string }).product_differentiation ?? '';
  const gtmText =
    (data as LlmInterpretationV1 & { go_to_market_strategy?: string }).go_to_market_strategy ?? '';

  const topics = [
    {
      title: 'Product & Differentiation',
      color: darkMode ? 'text-cyan-400' : 'text-cyan-700',
      body: productText,
      badge: topicBadge(productText),
      contradiction: getTopicContradiction(contradictions, 'product_differentiation'),
    },
    {
      title: 'Market Position',
      color: darkMode ? 'text-teal-400' : 'text-teal-700',
      body: data.market_position,
      badge: topicBadge(data.market_position),
      contradiction: getTopicContradiction(contradictions, 'market_position'),
    },
    {
      title: 'Go-To-Market Strategy',
      color: darkMode ? 'text-purple-400' : 'text-purple-700',
      body: gtmText,
      badge: topicBadge(gtmText),
      contradiction: getTopicContradiction(contradictions, 'go_to_market_strategy'),
    },
    {
      title: 'Financial Outlook',
      color: darkMode ? 'text-sky-400' : 'text-sky-700',
      body: data.financial_outlook,
      badge: topicBadge(data.financial_outlook),
      contradiction: getTopicContradiction(contradictions, 'financial_outlook'),
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {topics.map((t) => (
        <TopicCard key={t.title} {...t} darkMode={darkMode} />
      ))}
    </div>
  );
}
