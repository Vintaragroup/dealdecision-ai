import { CheckCircle2, AlertTriangle, ShieldCheck, ShieldAlert } from 'lucide-react';

export type DealWorkspaceTopSectionProps = {
  darkMode: boolean;
  score: number; // 0-100
  scoreLabel?: string;
  dealSummary: string;
  strengths: string[];
  weaknesses: string[];
  raise: string;
  revenue: string;
  growth: string;
  customers: string;
  businessModel: string;
  dealType: string;
  confidence: 'High' | 'Medium' | 'Low';
  verified?: boolean;
};

const clampScore0_100 = (value: number): number => {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
};

const scoreTone = (score0_100: number): { stroke: string; text: string; glow: string } => {
  if (score0_100 >= 70) {
    return {
      stroke: '#34d399', // emerald-400
      text: 'text-emerald-300',
      glow: 'drop-shadow-[0_0_12px_rgba(52,211,153,0.28)]',
    };
  }
  if (score0_100 >= 40) {
    return {
      stroke: '#fbbf24', // amber-400
      text: 'text-amber-300',
      glow: 'drop-shadow-[0_0_12px_rgba(251,191,36,0.24)]',
    };
  }
  return {
    stroke: '#f87171', // red-400
    text: 'text-red-300',
    glow: 'drop-shadow-[0_0_12px_rgba(248,113,113,0.24)]',
  };
};

export function DealWorkspaceTopSection({
  darkMode,
  score,
  scoreLabel = 'Fundamentals score',
  dealSummary,
  strengths,
  weaknesses,
  raise,
  revenue,
  growth,
  customers,
  businessModel,
  dealType,
  confidence,
  verified = false,
}: DealWorkspaceTopSectionProps) {
  const score0_100 = clampScore0_100(score);
  const tone = scoreTone(score0_100);

  // SVG ring math (match story: r=85, viewBox 220)
  const radius = 85;
  const circumference = 2 * Math.PI * radius;
  const dash = (circumference * score0_100) / 100;
  const gap = Math.max(0, circumference - dash);

  const visibleStrengths = (Array.isArray(strengths) ? strengths : []).filter(Boolean).slice(0, 3);
  const extraStrengths = Math.max(0, (Array.isArray(strengths) ? strengths : []).filter(Boolean).length - visibleStrengths.length);
  const weaknessList = (Array.isArray(weaknesses) ? weaknesses : []).filter(Boolean);

  const metricCards: Array<{ label: string; value: string; note: string; noteClass: string }> = [
    { label: 'Raise', value: raise, note: 'Target', noteClass: 'text-emerald-400' },
    { label: 'Revenue', value: revenue, note: 'Annual', noteClass: 'text-blue-400' },
    { label: 'Growth', value: growth, note: 'YoY', noteClass: 'text-emerald-400' },
    { label: 'Customers', value: customers, note: 'Active', noteClass: 'text-zinc-400' },
    { label: 'Business Model', value: businessModel, note: 'Recurring', noteClass: 'text-blue-400' },
    { label: 'Deal Type', value: dealType, note: 'Equity', noteClass: 'text-amber-400' },
  ];

  const cardClass = `backdrop-blur-xl border rounded-xl ${darkMode ? 'bg-white/5 border-white/10' : 'bg-white/80 border-gray-200/50'}`;
  const insetClass = `border rounded-xl ${darkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'}`;

  return (
    <section aria-label="Deal top summary" className="w-full space-y-4">
      <h2 className="sr-only">Deal summary and key metrics</h2>

      {/* Top: Score + Key Metrics */}
      <div className={`${cardClass} p-4`}>
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-stretch">
          {/* Left: score donut (1/3 on desktop) */}
          <div className="md:col-span-4 flex items-center justify-center">
            <div
              className="relative w-full max-w-[260px] flex items-center justify-center"
              aria-label={`${scoreLabel}: ${score0_100} out of 100`}
            >
              <svg
                width="220"
                height="220"
                viewBox="0 0 220 220"
                role="img"
                aria-label={`${scoreLabel} ${score0_100} out of 100`}
                className="transform -rotate-90"
              >
                <title>{`${scoreLabel}: ${score0_100}/100`}</title>

                {/* Background ring */}
                <circle cx="110" cy="110" r={radius} fill="none" stroke="rgba(63, 63, 70, 0.3)" strokeWidth="22" />

                {/* Progress ring */}
                <circle
                  cx="110"
                  cy="110"
                  r={radius}
                  fill="none"
                  stroke={tone.stroke}
                  className={`${tone.glow} transition-all duration-700 ease-out`}
                  strokeWidth="22"
                  strokeLinecap="round"
                  strokeDasharray={`${dash} ${gap}`}
                />
              </svg>

              {/* Center text */}
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <div className={`text-4xl font-semibold ${tone.text}`}>
                  {score0_100}
                  <span className="text-zinc-400 text-3xl">/100</span>
                </div>
                <div className="text-xs text-zinc-400 mt-2">{scoreLabel}</div>
              </div>
            </div>
          </div>

          {/* Right: metric cards (2/3 on desktop) */}
          <div className="md:col-span-8">
            <h3 className="sr-only">Key metrics</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {metricCards.map((m) => (
                <div key={m.label} className={`${insetClass} p-4`}>
                  <div className="text-xs text-zinc-500 mb-1">{m.label}</div>
                  <div className="text-2xl text-white mb-0.5 break-words">{m.value}</div>
                  <div className={`text-xs ${m.noteClass}`}>{m.note}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Middle: Deal summary + confidence (equal height tiles) */}
      <div className={`${cardClass} p-4`}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch">
          <div className="h-full min-h-[160px]">
            <h3 className="text-sm text-zinc-300 mb-3">Deal Summary</h3>
            <p className="text-zinc-200 leading-relaxed">{dealSummary}</p>
          </div>

          <div className={`${insetClass} p-4 h-full min-h-[160px] flex flex-col justify-between`}>
            <div>
              <div className="text-xs text-zinc-400 mb-2">Confidence</div>
              <div className="flex items-center justify-between gap-3">
                <div className="text-3xl text-white">{confidence}</div>

                <span
                  className={
                    verified
                      ? 'inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-semibold bg-emerald-500/15 text-emerald-200 border border-emerald-500/25'
                      : 'inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-semibold bg-zinc-500/10 text-zinc-200 border border-white/10'
                  }
                  aria-label={verified ? 'Verified' : 'Not verified'}
                >
                  {verified ? <ShieldCheck className="w-3.5 h-3.5" /> : <ShieldAlert className="w-3.5 h-3.5" />}
                  {verified ? 'Verified' : 'Unverified'}
                </span>
              </div>
            </div>

            <div className="mt-4 text-xs text-zinc-400">
              Confidence reflects evidence quality and completeness.
            </div>
          </div>
        </div>
      </div>

      {/* Bottom: Score understanding */}
      <div className={`${cardClass} p-4`}>
        <h3 className="text-sm text-zinc-300 mb-5">Score Understanding</h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" strokeWidth={1.5} aria-hidden="true" />
              <span className="text-xs text-emerald-300">Strengths</span>
            </div>
            {visibleStrengths.length > 0 ? (
              <ul className="space-y-2 ml-6 list-disc">
                {visibleStrengths.map((strength, index) => (
                  <li key={`${strength}-${index}`} className="text-sm text-zinc-200">
                    {strength}
                  </li>
                ))}
                {extraStrengths > 0 ? (
                  <li className="text-sm text-zinc-400">+{extraStrengths} more</li>
                ) : null}
              </ul>
            ) : (
              <p className="text-sm text-zinc-400">No strengths surfaced yet.</p>
            )}
          </div>

          <div>
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="w-4 h-4 text-amber-400" strokeWidth={1.5} aria-hidden="true" />
              <span className="text-xs text-amber-300">Weaknesses</span>
            </div>
            {weaknessList.length > 0 ? (
              <ul className="space-y-2 ml-6 list-disc">
                {weaknessList.map((weakness, index) => (
                  <li key={`${weakness}-${index}`} className="text-sm text-zinc-200">
                    {weakness}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-zinc-400">No weaknesses flagged yet.</p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
