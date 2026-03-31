/**
 * VCScoringV2Panel
 *
 * Renders the VC Scoring V2 output — three independent axes:
 *   Opportunity / Confidence / Risk → Investment Posture + Composite Score
 *
 * Source of truth: packages/core/src/scoring/vc-scoring-v2.ts
 * This component is purely presentational — no computation, no derivation.
 */

import { VCScoringV2InferencePanel } from './VCScoringV2InferencePanel';
import type { VCScoringV2InferenceLike } from '../../../lib/vcInferenceSummary';

// Minimal subset of the VCScoringV2 type that this component needs.
// Pulled from the OrchestratorReportV1.vc_scoring_v2 field in apiClient.ts.
export interface VCScoringV2Like {
  opportunity_score: number;
  confidence_score: number;
  risk_score: number;
  vc_composite_score: number;
  investment_posture: 'PASS' | 'MONITOR' | 'INVESTIGATE' | 'HIGH_PRIORITY_DILIGENCE' | 'INVESTABLE';
  reasoning: string[];
  /** Signal inference trace — present when inference layer ran. */
  inference?: VCScoringV2InferenceLike;
}

interface VCScoringV2PanelProps {
  darkMode: boolean;
  vcScoringV2: VCScoringV2Like | null | undefined;
}

const POSTURE_LABEL: Record<VCScoringV2Like['investment_posture'], string> = {
  INVESTABLE: 'Investable',
  HIGH_PRIORITY_DILIGENCE: 'High Priority Diligence',
  INVESTIGATE: 'Investigate',
  MONITOR: 'Monitor',
  PASS: 'Pass',
};

function postureColorClass(
  posture: VCScoringV2Like['investment_posture'],
  darkMode: boolean
): string {
  switch (posture) {
    case 'INVESTABLE':
      return darkMode
        ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30'
        : 'text-emerald-700 bg-emerald-50 border-emerald-200';
    case 'HIGH_PRIORITY_DILIGENCE':
      return darkMode
        ? 'text-blue-400 bg-blue-500/10 border-blue-500/30'
        : 'text-blue-700 bg-blue-50 border-blue-200';
    case 'INVESTIGATE':
      return darkMode
        ? 'text-amber-400 bg-amber-500/10 border-amber-500/30'
        : 'text-amber-700 bg-amber-50 border-amber-200';
    case 'MONITOR':
      return darkMode
        ? 'text-amber-400/80 bg-amber-500/5 border-amber-500/20'
        : 'text-amber-600 bg-amber-50/60 border-amber-200';
    case 'PASS':
    default:
      return darkMode
        ? 'text-red-400 bg-red-500/10 border-red-500/30'
        : 'text-red-700 bg-red-50 border-red-200';
  }
}

function scoreBarColor(value: number, darkMode: boolean, invert = false): string {
  // For risk: higher is worse so invert the color scale.
  const effective = invert ? 100 - value : value;
  if (effective >= 70) return darkMode ? 'bg-emerald-500' : 'bg-emerald-500';
  if (effective >= 45) return darkMode ? 'bg-amber-500' : 'bg-amber-500';
  return darkMode ? 'bg-red-500' : 'bg-red-500';
}

function scoreTextColor(value: number, darkMode: boolean, invert = false): string {
  const effective = invert ? 100 - value : value;
  if (effective >= 70) return darkMode ? 'text-emerald-400' : 'text-emerald-700';
  if (effective >= 45) return darkMode ? 'text-amber-400' : 'text-amber-600';
  return darkMode ? 'text-red-400' : 'text-red-700';
}

interface AxisBarProps {
  label: string;
  value: number;
  darkMode: boolean;
  invert?: boolean;
}

function AxisBar({ label, value, darkMode, invert = false }: AxisBarProps) {
  const barColor = scoreBarColor(value, darkMode, invert);
  const textColor = scoreTextColor(value, darkMode, invert);
  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center justify-between mb-1">
        <span className={`text-xs ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>{label}</span>
        <span className={`text-xs font-semibold ${textColor}`}>{value}</span>
      </div>
      <div className={`h-1.5 w-full rounded-full ${darkMode ? 'bg-white/10' : 'bg-gray-200'}`}>
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}

export function VCScoringV2Panel({ darkMode, vcScoringV2 }: VCScoringV2PanelProps) {
  if (!vcScoringV2) return null;

  const { opportunity_score, confidence_score, risk_score, vc_composite_score, investment_posture, reasoning, inference } = vcScoringV2;
  const postureClass = postureColorClass(investment_posture, darkMode);

  return (
    <div
      className={`rounded-lg border p-4 mt-4 ${
        darkMode ? 'border-white/10 bg-white/3' : 'border-gray-200 bg-gray-50'
      }`}
    >
      {/* Header row */}
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <span
          className={`text-xs font-semibold uppercase tracking-wide ${
            darkMode ? 'text-gray-400' : 'text-gray-500'
          }`}
        >
          VC Investment Score
        </span>
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded border text-xs font-semibold ${postureClass}`}
          >
            {POSTURE_LABEL[investment_posture]}
          </span>
          <span
            className={`text-sm font-bold ${
              darkMode ? 'text-white' : 'text-gray-900'
            }`}
          >
            {vc_composite_score}
          </span>
        </div>
      </div>

      {/* Three-axis bars */}
      <div className="flex gap-4 flex-wrap sm:flex-nowrap mb-3">
        <AxisBar label="Opportunity" value={opportunity_score} darkMode={darkMode} />
        <AxisBar label="Confidence" value={confidence_score} darkMode={darkMode} />
        <AxisBar label="Risk" value={risk_score} darkMode={darkMode} invert />
      </div>

      {/* Reasoning bullets */}
      {reasoning.length > 0 && (
        <ul className={`mt-2 space-y-1 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
          {reasoning.map((line, i) => (
            <li key={i} className="text-xs flex items-start gap-1.5">
              <span className={darkMode ? 'text-gray-600' : 'text-gray-400'}>•</span>
              {line}
            </li>
          ))}
        </ul>
      )}

      {/* Inference trace — shown when backend ran the inference layer */}
      {inference && (
        <VCScoringV2InferencePanel inference={inference} darkMode={darkMode} />
      )}
    </div>
  );
}
