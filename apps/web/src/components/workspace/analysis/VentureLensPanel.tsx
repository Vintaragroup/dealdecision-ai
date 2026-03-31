/**
 * VentureLensPanel
 *
 * Renders the Venture Lens V1 output — conviction scoring on top of VC Scoring V2.
 * Five venture dimensions: Team · Market · Product · Traction · Upside
 *
 * Source of truth: packages/core/src/scoring/vc-venture-lens-v1.ts
 * This component is purely presentational — no computation, no derivation.
 *
 * ⚠️ Team fallback notice (displayed in UI):
 * Team score defaults to 50 (neutral) when dimension scores are unavailable in the
 * current pipeline. This is a temporary fallback — not a true team quality read.
 */

// Minimal subset of VentureLensV1 that this component needs.
export interface VentureLensV1Like {
  venture_score: number;
  conviction_level: 'LOW' | 'MEDIUM' | 'HIGH';
  adjustment: number;
  final_investment_score: number;
  final_posture: 'PASS' | 'MONITOR' | 'INVESTIGATE' | 'HIGH_PRIORITY_DILIGENCE' | 'INVESTABLE';
  reasons: string[];
  breakdown: {
    team: number;
    market: number;
    product: number;
    traction: number;
    upside: number;
  };
}

interface VentureLensPanelProps {
  darkMode: boolean;
  ventureLens: VentureLensV1Like | null | undefined;
}

type Posture = VentureLensV1Like['final_posture'];
type Conviction = VentureLensV1Like['conviction_level'];

const POSTURE_LABEL: Record<Posture, string> = {
  INVESTABLE: 'Investable',
  HIGH_PRIORITY_DILIGENCE: 'High Priority Diligence',
  INVESTIGATE: 'Investigate',
  MONITOR: 'Monitor',
  PASS: 'Pass',
};

function postureColorClass(posture: Posture, darkMode: boolean): string {
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

function convictionColorClass(conviction: Conviction, darkMode: boolean): string {
  switch (conviction) {
    case 'HIGH':
      return darkMode ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30' : 'text-emerald-700 bg-emerald-50 border-emerald-200';
    case 'MEDIUM':
      return darkMode ? 'text-amber-400 bg-amber-500/10 border-amber-500/30' : 'text-amber-700 bg-amber-50 border-amber-200';
    case 'LOW':
    default:
      return darkMode ? 'text-red-400 bg-red-500/10 border-red-500/30' : 'text-red-700 bg-red-50 border-red-200';
  }
}

function dimensionBarColor(value: number, darkMode: boolean): string {
  if (value >= 70) return darkMode ? 'bg-emerald-500' : 'bg-emerald-500';
  if (value >= 45) return darkMode ? 'bg-amber-500' : 'bg-amber-500';
  return darkMode ? 'bg-red-500' : 'bg-red-500';
}

function dimensionTextColor(value: number, darkMode: boolean): string {
  if (value >= 70) return darkMode ? 'text-emerald-400' : 'text-emerald-700';
  if (value >= 45) return darkMode ? 'text-amber-400' : 'text-amber-600';
  return darkMode ? 'text-red-400' : 'text-red-700';
}

interface DimensionBarProps {
  label: string;
  value: number;
  darkMode: boolean;
  /** When true, show a tooltip that this dimension uses a neutral fallback. */
  teamFallback?: boolean;
}

function DimensionBar({ label, value, darkMode, teamFallback = false }: DimensionBarProps) {
  const barColor = dimensionBarColor(value, darkMode);
  const textColor = dimensionTextColor(value, darkMode);
  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center justify-between mb-1">
        <span className={`text-xs flex items-center gap-1 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
          {label}
          {teamFallback && (
            <span
              title="Team score defaults to neutral (50) — no team signals available in current pipeline"
              className={`text-[9px] px-1 py-0 rounded border ${darkMode ? 'text-gray-600 border-gray-700' : 'text-gray-400 border-gray-300'}`}
            >
              ~
            </span>
          )}
        </span>
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

export function VentureLensPanel({ darkMode, ventureLens }: VentureLensPanelProps) {
  if (!ventureLens) return null;

  const {
    venture_score,
    conviction_level,
    adjustment,
    final_investment_score,
    final_posture,
    reasons,
    breakdown,
  } = ventureLens;

  const postureClass = postureColorClass(final_posture, darkMode);
  const convictionClass = convictionColorClass(conviction_level, darkMode);
  const adjSign = adjustment > 0 ? '+' : '';

  return (
    <div
      className={`rounded-lg border p-4 mt-4 ${
        darkMode ? 'border-white/10 bg-white/3' : 'border-gray-200 bg-gray-50'
      }`}
    >
      {/* Header row */}
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <div className="flex items-center gap-2">
          <span
            className={`text-xs font-semibold uppercase tracking-wide ${
              darkMode ? 'text-gray-400' : 'text-gray-500'
            }`}
          >
            Venture Lens
          </span>
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded border text-[10px] font-medium ${convictionClass}`}
          >
            {conviction_level} conviction
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded border text-xs font-semibold ${postureClass}`}
          >
            {POSTURE_LABEL[final_posture]}
          </span>
          <span
            className={`text-sm font-bold ${darkMode ? 'text-white' : 'text-gray-900'}`}
          >
            {final_investment_score}
          </span>
        </div>
      </div>

      {/* Venture score + adjustment line */}
      <div className={`flex items-center gap-3 mb-4 text-xs ${darkMode ? 'text-gray-500' : 'text-gray-500'}`}>
        <span>
          Venture Score <span className={`font-semibold ${darkMode ? 'text-gray-300' : 'text-gray-700'}`}>{venture_score}/100</span>
        </span>
        <span className={darkMode ? 'text-gray-700' : 'text-gray-400'}>·</span>
        <span>
          V2 Adjustment{' '}
          <span
            className={`font-semibold ${
              adjustment > 0
                ? (darkMode ? 'text-emerald-400' : 'text-emerald-600')
                : adjustment < 0
                  ? (darkMode ? 'text-red-400' : 'text-red-600')
                  : (darkMode ? 'text-gray-400' : 'text-gray-500')
            }`}
          >
            {adjSign}{adjustment}
          </span>
        </span>
        <span className={darkMode ? 'text-gray-700' : 'text-gray-400'}>→</span>
        <span>
          Final <span className={`font-semibold ${darkMode ? 'text-white' : 'text-gray-900'}`}>{final_investment_score}</span>
        </span>
      </div>

      {/* Five dimension bars */}
      <div className="flex gap-3 flex-wrap sm:flex-nowrap mb-3">
        <DimensionBar label="Team" value={breakdown.team} darkMode={darkMode} teamFallback />
        <DimensionBar label="Market" value={breakdown.market} darkMode={darkMode} />
        <DimensionBar label="Product" value={breakdown.product} darkMode={darkMode} />
        <DimensionBar label="Traction" value={breakdown.traction} darkMode={darkMode} />
        <DimensionBar label="Upside" value={breakdown.upside} darkMode={darkMode} />
      </div>

      {/* Team fallback notice */}
      <div className={`text-[10px] mb-3 ${darkMode ? 'text-gray-700' : 'text-gray-400'}`}>
        ~ Team score is a neutral fallback (50) — team signals not yet available in pipeline.
      </div>

      {/* Reasons */}
      {reasons.length > 0 && (
        <ul className={`mt-1 space-y-1 ${darkMode ? 'text-gray-400' : 'text-gray-600'}`}>
          {reasons.map((line, i) => (
            <li key={i} className="text-xs flex items-start gap-1.5">
              <span className={darkMode ? 'text-gray-600' : 'text-gray-400'}>•</span>
              {line}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
