/**
 * ExecutivePulse — hero section for the Investor Insights decision surface.
 *
 * Structure:
 *   ┌─────────────────────────────────────────────────────────┐
 *   │  [PostureBadge]  [ConfidenceGauge segments]             │
 *   │  Executive summary line                                  │
 *   ├──────────────┬──────────────┬──────────────┤
 *   │  Market      │  Financials  │  Risk        │  ← VitalSigns
 *   └──────────────┴──────────────┴──────────────┘
 */

import React from 'react';
import type { LlmInterpretationV1, LlmInterpretationPosture } from '../investorInsightsUtils';
import { StatusBadge } from './StatusBadge';
import type { StatusBadgeVariant } from './StatusBadge';

// ── Posture → display config ──────────────────────────────────────────────────

interface PostureCfg {
  label: string;
  icon: string;
  gaugeFill: number; // 1-4 active segments
  badgeVariant: StatusBadgeVariant;
  accentDark: string;
  accentLight: string;
}

const POSTURE_CFG: Record<LlmInterpretationPosture, PostureCfg> = {
  GO: {
    label: 'GO',
    icon: '◆',
    gaugeFill: 4,
    badgeVariant: 'green',
    accentDark: 'text-emerald-300',
    accentLight: 'text-emerald-700',
  },
  INVESTIGATE: {
    label: 'INVESTIGATE',
    icon: '◈',
    gaugeFill: 3,
    badgeVariant: 'amber',
    accentDark: 'text-amber-300',
    accentLight: 'text-amber-700',
  },
  CAUTION: {
    label: 'CAUTION',
    icon: '⚑',
    gaugeFill: 2,
    badgeVariant: 'amber',
    accentDark: 'text-orange-300',
    accentLight: 'text-orange-700',
  },
  PASS: {
    label: 'PASS',
    icon: '✕',
    gaugeFill: 1,
    badgeVariant: 'red',
    accentDark: 'text-red-300',
    accentLight: 'text-red-700',
  },
};

const SEGMENT_COLORS = [
  // segment 1 (PASS): always red when active
  { active: 'bg-red-500', inactive: '' },
  // segment 2 (CAUTION): orange
  { active: 'bg-orange-400', inactive: '' },
  // segment 3 (INVESTIGATE): amber
  { active: 'bg-amber-400', inactive: '' },
  // segment 4 (GO): emerald
  { active: 'bg-emerald-500', inactive: '' },
];

// ── Confidence Gauge ──────────────────────────────────────────────────────────

interface ConfidenceGaugeProps {
  posture: LlmInterpretationPosture;
  confidence: LlmInterpretationV1['confidence'];
  darkMode: boolean;
}

/** Four-segment horizontal bar visualising investment posture strength. */
export function ConfidenceGauge({ posture, confidence, darkMode }: ConfidenceGaugeProps) {
  const cfg = POSTURE_CFG[posture] ?? POSTURE_CFG.INVESTIGATE;
  const confidenceLabel =
    confidence === 'HIGH' ? 'High Confidence'
    : confidence === 'MEDIUM' ? 'Medium Confidence'
    : 'Low Confidence';

  return (
    <div className="flex flex-col gap-1.5">
      {/* Posture + confidence labels */}
      <div className="flex items-center gap-2.5 flex-wrap">
        <StatusBadge
          variant={cfg.badgeVariant}
          label={`${cfg.icon} ${cfg.label}`}
          size="md"
          darkMode={darkMode}
        />
        <span className={`text-xs font-medium ${darkMode ? 'text-gray-400' : 'text-gray-500'}`}>
          {confidenceLabel}
        </span>
      </div>
      {/* Segment bar */}
      <div className="flex items-center gap-1" aria-label={`Investment posture: ${cfg.label}`}>
        {SEGMENT_COLORS.map((seg, idx) => {
          const segIndex = idx + 1; // 1-indexed
          const isActive = segIndex <= cfg.gaugeFill;
          return (
            <div
              key={idx}
              className={`h-2 flex-1 rounded-sm transition-colors ${
                isActive
                  ? seg.active
                  : darkMode
                  ? 'bg-white/10'
                  : 'bg-gray-200'
              }`}
            />
          );
        })}
      </div>
      <div className="flex justify-between text-[10px] font-medium px-0.5">
        <span className={darkMode ? 'text-red-400/70' : 'text-red-500/70'}>Pass</span>
        <span className={darkMode ? 'text-emerald-400/70' : 'text-emerald-600/70'}>Go</span>
      </div>
    </div>
  );
}

// ── Vital Sign Card ────────────────────────────────────────────────────────────

interface VitalSignCardProps {
  label: string;
  value: string;
  /** Optional short descriptor (e.g. "Growing" / "Profitable") */
  tag?: { label: string; variant: StatusBadgeVariant } | null;
  darkMode: boolean;
}

function VitalSignCard({ label, value, tag, darkMode }: VitalSignCardProps) {
  const cardClass = `flex flex-col gap-1.5 rounded-lg border p-3 ${
    darkMode ? 'border-white/10 bg-white/[0.03]' : 'border-gray-200 bg-gray-50'
  }`;

  return (
    <div className={cardClass}>
      <div className={`text-[10px] font-semibold uppercase tracking-widest ${darkMode ? 'text-gray-500' : 'text-gray-400'}`}>
        {label}
      </div>
      <p className={`text-xs leading-snug line-clamp-3 ${darkMode ? 'text-gray-200' : 'text-gray-800'}`}>
        {value || <span className="opacity-40 italic">Not assessed</span>}
      </p>
      {tag && (
        <div className="mt-auto pt-1">
          <StatusBadge variant={tag.variant} label={tag.label} darkMode={darkMode} />
        </div>
      )}
    </div>
  );
}

// ── Vital Signs Grid ───────────────────────────────────────────────────────────

interface VitalSignsGridProps {
  data: LlmInterpretationV1;
  darkMode: boolean;
}

/** Derive a short qualifier tag from free-form text snippets. */
function deriveFitnessTag(
  text: string,
  darkMode: boolean,
): { label: string; variant: StatusBadgeVariant } | null {
  if (!text) return null;
  const lower = text.toLowerCase();

  // Positive signals
  if (/\bgrow(?:ing|th)\b/.test(lower) || /\bstrong\b/.test(lower) || /\bsignificant\b/.test(lower)) {
    return { label: 'Growing', variant: 'green' };
  }
  if (/\bprofitable\b/.test(lower) || /casflow\bpositive\b/.test(lower)) {
    return { label: 'Profitable', variant: 'green' };
  }
  if (/\bexpanding\b/.test(lower) || /\bscaling\b/.test(lower)) {
    return { label: 'Scaling', variant: 'green' };
  }

  // Caution signals
  if (/\bearly.stage\b/.test(lower) || /\bpre.revenue\b/.test(lower) || /\bpilot\b/.test(lower)) {
    return { label: 'Early Stage', variant: 'amber' };
  }
  if (/\bhigh.burn\b/.test(lower) || /\bcash.constrain/.test(lower)) {
    return { label: 'High Burn', variant: 'amber' };
  }
  if (/\bcompetitive\b/.test(lower) || /\bfragmented\b/.test(lower)) {
    return { label: 'Competitive', variant: 'amber' };
  }

  // Risk signals
  if (/\brisk\b/.test(lower) || /\bconcern\b/.test(lower) || /\bchallenge\b/.test(lower)) {
    return { label: 'Risk Signals', variant: 'red' };
  }

  return null;
}

export function VitalSignsGrid({ data, darkMode }: VitalSignsGridProps) {
  const marketTag = deriveFitnessTag(data.market_position, darkMode);
  const financialsTag = deriveFitnessTag(data.financial_outlook, darkMode);

  // Risk derives from external_risk_signals (if present) or risks array
  const riskText = data.external_risk_signals && data.external_risk_signals.trim()
    ? data.external_risk_signals
    : data.risks.length > 0
    ? data.risks.slice(0, 2).join(' · ')
    : '';

  const riskTag =
    data.risks.length === 0 && !data.external_risk_signals
      ? null
      : { label: `${data.risks.length || '?'} risks`, variant: 'amber' as const };

  return (
    <div className="grid grid-cols-3 gap-2">
      <VitalSignCard
        label="Market"
        value={data.market_position || ''}
        tag={marketTag}
        darkMode={darkMode}
      />
      <VitalSignCard
        label="Financials"
        value={data.financial_outlook || ''}
        tag={financialsTag}
        darkMode={darkMode}
      />
      <VitalSignCard
        label="Risk"
        value={riskText}
        tag={riskTag}
        darkMode={darkMode}
      />
    </div>
  );
}

// ── Executive Pulse (hero) ─────────────────────────────────────────────────────

interface ExecutivePulseProps {
  data: LlmInterpretationV1;
  darkMode: boolean;
}

export function ExecutivePulse({ data, darkMode }: ExecutivePulseProps) {
  const borderClass = `rounded-xl border px-4 py-4 ${
    darkMode
      ? 'border-white/10 bg-white/[0.03]'
      : 'border-gray-200 bg-gray-50/50'
  }`;

  return (
    <div className={borderClass}>
      <div className="grid grid-cols-1 lg:grid-cols-[220px,1fr] gap-4">
        {/* Left column: gauge + evidence caveat */}
        <div className="flex flex-col justify-between gap-3">
          <ConfidenceGauge posture={data.posture} confidence={data.confidence} darkMode={darkMode} />
          {data.evidence_caveat && (
            <p className={`text-xs ${darkMode ? 'text-amber-300/70' : 'text-amber-700/80'}`}>
              ⚠ {data.evidence_caveat}
            </p>
          )}
        </div>

        {/* Right column: executive summary + vital signs */}
        <div className="flex flex-col gap-3">
          <p className={`text-sm leading-relaxed font-medium ${darkMode ? 'text-gray-100' : 'text-gray-900'}`}>
            {data.executive_summary}
          </p>
          <VitalSignsGrid data={data} darkMode={darkMode} />
        </div>
      </div>
    </div>
  );
}
