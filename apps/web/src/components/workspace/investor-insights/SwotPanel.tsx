/**
 * SwotPanel — unified Strengths / Risks / Key Unknowns panel.
 *
 * Layout:
 *   ┌──────────────────────┬──────────────────────┐
 *   │  Strengths           │  Risks               │
 *   │  • ...               │  • ...               │
 *   └──────────────────────┴──────────────────────┘
 *   [Key Unknowns — full width, only if present]
 *   [Top Diligence Questions — full width, only if present]
 *
 * When a NarrativeContradictionBundle is supplied, the Risks card and Key Unknowns
 * card show ContradictionCallout chips for business_quality and financial_outlook
 * where applicable.
 */

import React from 'react';
import type { LlmInterpretationV1, NarrativeContradictionBundle } from '../investorInsightsUtils';
import { getTopicContradiction } from '../investorInsightsUtils';
import { CheckCircle2, AlertTriangle, HelpCircle, MessageSquare } from 'lucide-react';
import { ContradictionCallout } from './ContradictionCallout';

interface SwotPanelProps {
  data: LlmInterpretationV1;
  darkMode: boolean;
  /** PR36.9: optional contradiction bundle for mixed-evidence display. */
  contradictions?: NarrativeContradictionBundle | null;
}

function BulletList({
  items,
  emptyText,
  darkMode,
}: {
  items: string[];
  emptyText: string;
  darkMode: boolean;
}) {
  if (items.length === 0) {
    return (
      <p className={`text-xs italic ${darkMode ? 'text-gray-600' : 'text-gray-400'}`}>
        {emptyText}
      </p>
    );
  }
  return (
    <ul className="space-y-1.5">
      {items.map((item, i) => (
        <li
          key={i}
          className={`text-sm leading-snug flex gap-2 ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}
        >
          <span className="mt-0.5 shrink-0 opacity-40">·</span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function SectionHeading({
  label,
  icon,
  colorClass,
  darkMode,
  count,
}: {
  label: string;
  icon: React.ReactNode;
  colorClass: string;
  darkMode: boolean;
  count?: number;
}) {
  return (
    <div className={`flex items-center gap-1.5 mb-2.5 ${colorClass}`}>
      <span className="w-3.5 h-3.5 shrink-0">{icon}</span>
      <span className="text-xs font-semibold uppercase tracking-wide">{label}</span>
      {count !== undefined && count > 0 && (
        <span className={`ml-auto text-xs font-mono ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
          {count}
        </span>
      )}
    </div>
  );
}

export function SwotPanel({ data, darkMode, contradictions }: SwotPanelProps) {
  const borderBase = `rounded-lg border p-4 ${
    darkMode ? 'border-white/10 bg-white/5' : 'border-gray-100 bg-gray-50'
  }`;

  const hasUnknowns = data.key_unknowns && data.key_unknowns.length > 0;
  const hasQuestions = data.next_questions && data.next_questions.length > 0;

  // PR36.9: per-topic contradiction signals for this panel
  const businessQualityContradiction = getTopicContradiction(contradictions, 'business_quality');
  const financialOutlookContradiction = getTopicContradiction(contradictions, 'financial_outlook');
  const capitalRaiseContradiction = getTopicContradiction(contradictions, 'capital_and_raise');
  const tractionContradiction = getTopicContradiction(contradictions, 'traction');

  // Aggregate any contradiction that relates to Risks (financial clarity, business model quality)
  const riskContradiction = financialOutlookContradiction ?? businessQualityContradiction ?? null;
  // Aggregate any contradiction that relates to Key Unknowns
  const unknownContradiction = capitalRaiseContradiction ?? tractionContradiction ?? null;

  return (
    <div className="space-y-3">
      {/* Strengths / Risks row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Strengths */}
        <div className={borderBase}>
          <SectionHeading
            label="Strengths"
            icon={<CheckCircle2 className="w-3.5 h-3.5" />}
            colorClass={darkMode ? 'text-emerald-400' : 'text-emerald-700'}
            darkMode={darkMode}
            count={data.strengths.length}
          />
          <BulletList items={data.strengths} emptyText="None identified" darkMode={darkMode} />
        </div>

        {/* Risks */}
        <div className={borderBase}>
          <SectionHeading
            label="Risks"
            icon={<AlertTriangle className="w-3.5 h-3.5" />}
            colorClass={darkMode ? 'text-red-400' : 'text-red-700'}
            darkMode={darkMode}
            count={data.risks.length}
          />
          <BulletList items={data.risks} emptyText="None identified" darkMode={darkMode} />
          {/* PR36.9: show callout when financial or business quality evidence is in conflict */}
          {riskContradiction && (
            <ContradictionCallout
              contradiction={riskContradiction}
              darkMode={darkMode}
            />
          )}
        </div>
      </div>

      {/* Key Unknowns — full width */}
      {hasUnknowns && (
        <div className={borderBase}>
          <SectionHeading
            label="Key Unknowns"
            icon={<HelpCircle className="w-3.5 h-3.5" />}
            colorClass={darkMode ? 'text-orange-400' : 'text-orange-700'}
            darkMode={darkMode}
            count={data.key_unknowns!.length}
          />
          <BulletList items={data.key_unknowns!} emptyText="" darkMode={darkMode} />
          {/* PR36.9: show callout when capital or traction evidence is uncertain */}
          {unknownContradiction && (
            <ContradictionCallout
              contradiction={unknownContradiction}
              darkMode={darkMode}
            />
          )}
        </div>
      )}

      {/* Top Diligence Questions — full width */}
      {hasQuestions && (
        <div className={borderBase}>
          <SectionHeading
            label="Top Diligence Questions"
            icon={<MessageSquare className="w-3.5 h-3.5" />}
            colorClass={darkMode ? 'text-blue-400' : 'text-blue-700'}
            darkMode={darkMode}
            count={data.next_questions!.length}
          />
          <BulletList items={data.next_questions!} emptyText="" darkMode={darkMode} />
        </div>
      )}
    </div>
  );
}
