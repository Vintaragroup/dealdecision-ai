import { CheckCircle2, AlertTriangle, ShieldCheck, ShieldAlert } from 'lucide-react';

export type DealWorkspaceTopSectionProps = {
  darkMode: boolean;
  score: number; // 0-100
  scoreLabel?: string;
  scoreBandLabel?: string | null;
  hardPassGuardrailTriggered?: boolean;
  hardPassGuardrailNote?: string | null;
  hardPassGuardrailCriteriaSnapshot?: any | null;
  decisionV1?: {
    recommendation_key?: string;
    label?: string;
    severity?: 'danger' | 'warn' | 'info' | 'success';
    reasons?: string[];
  } | null;
  dealSummary: string;
  dealSummaryTitle?: string;
  dealSummarySource?: 'canonical' | 'legacy' | 'overlay';
  strengths: string[];
  weaknesses: string[];
  raise: string | null;
  raiseLabel?: string | null;
  raiseConflict?: boolean;
  raiseConflictOverlayValue?: string | null;
  revenue: string | null;
  revenueLabel?: string | null;
  revenueTooltip?: string | null;
  revenueConflict?: boolean;
  revenueConflictOverlayValue?: string | null;
  growth: string | null;
  growthLabel?: string | null;
  growthNote?: string | null;
  growthTooltip?: string | null;
  growthConflict?: boolean;
  growthConflictOverlayValue?: string | null;
  customers: string | null;
  customersLabel?: string | null;
  customersTooltip?: string | null;
  customersConflict?: boolean;
  customersConflictOverlayValue?: string | null;
  businessModel: string | null;
  businessModelLabel?: string | null;
  businessModelTooltip?: string | null;
  businessModelConflict?: boolean;
  businessModelConflictOverlayValue?: string | null;
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
  scoreBandLabel = null,
  hardPassGuardrailTriggered = false,
  hardPassGuardrailNote = null,
  hardPassGuardrailCriteriaSnapshot = null,
  decisionV1 = null,
  dealSummary,
  dealSummaryTitle = 'Deal Summary',
  dealSummarySource = 'legacy',
  strengths,
  weaknesses,
  raise,
  raiseLabel = null,
  raiseConflict = false,
  raiseConflictOverlayValue = null,
  revenue,
  revenueLabel = null,
  revenueTooltip = null,
  revenueConflict = false,
  revenueConflictOverlayValue = null,
  growth,
  growthLabel = null,
  growthNote = null,
  growthTooltip = null,
  growthConflict = false,
  growthConflictOverlayValue = null,
  customers,
  customersLabel = null,
  customersTooltip = null,
  customersConflict = false,
  customersConflictOverlayValue = null,
  businessModel,
  businessModelLabel = null,
  businessModelTooltip = null,
  businessModelConflict = false,
  businessModelConflictOverlayValue = null,
  dealType,
  confidence,
  verified = false,
}: DealWorkspaceTopSectionProps) {
  const summaryParagraphs = (() => {
    const raw = typeof dealSummary === 'string' ? dealSummary : '';
    const normalized = raw
      // Convert literal backslash-n sequences into real newlines.
      .replace(/\\r\\n/g, '\n')
      .replace(/\\n/g, '\n')
      .replace(/\r\n/g, '\n')
      .trim();
    if (!normalized) return [];
    return normalized
      .split(/\n{2,}/g)
      .map((p) => p.split(/\n+/g).join(' ').trim())
      .filter(Boolean)
      .slice(0, 6);
  })();

  const score0_100 = clampScore0_100(score);
  const tone = scoreTone(score0_100);

  const decisionLabel = typeof decisionV1?.label === 'string' && decisionV1.label.trim() ? decisionV1.label.trim() : null;
  const decisionReasons = Array.isArray(decisionV1?.reasons) ? decisionV1!.reasons!.filter((r) => typeof r === 'string' && r.trim()).slice(0, 12) : [];
  const guardrailNote = typeof hardPassGuardrailNote === 'string' && hardPassGuardrailNote.trim() ? hardPassGuardrailNote.trim() : null;
  const bandLabel = typeof scoreBandLabel === 'string' && scoreBandLabel.trim() ? scoreBandLabel.trim() : null;

  const showDecisionDetails = Boolean(decisionLabel || decisionReasons.length > 0 || hardPassGuardrailCriteriaSnapshot);

  // SVG ring math (match story: r=85, viewBox 220)
  const radius = 85;
  const circumference = 2 * Math.PI * radius;
  const dash = (circumference * score0_100) / 100;
  const gap = Math.max(0, circumference - dash);

  const visibleStrengths = (Array.isArray(strengths) ? strengths : []).filter(Boolean).slice(0, 3);
  const extraStrengths = Math.max(0, (Array.isArray(strengths) ? strengths : []).filter(Boolean).length - visibleStrengths.length);
  const weaknessList = (Array.isArray(weaknesses) ? weaknesses : []).filter(Boolean);

  const revenueNote = (() => {
    const b = String(revenueLabel ?? '').trim().toLowerCase();
    if (!b) return 'Annual';
    if (b.includes('attributed')) return 'Attributed';
    if (b.includes('ytd')) return 'YTD';
    return 'Annual';
  })();

  const metricCards: Array<{ label: string; value: string | null; note: string; noteClass: string; tooltip?: string | null; badge?: string | null; conflict?: boolean; conflictOverlayValue?: string | null }> = [
    { label: 'Raise', value: raise, note: 'Target', noteClass: 'text-emerald-400', badge: raiseLabel, conflict: raiseConflict, conflictOverlayValue: raiseConflictOverlayValue },
    {
      label: 'Revenue',
      value: revenue,
      note: revenueNote,
      noteClass: 'text-blue-400',
      tooltip: revenueTooltip,
      badge: revenueLabel,
      conflict: revenueConflict,
      conflictOverlayValue: revenueConflictOverlayValue,
    },
    {
      label: 'Growth',
      value: growth,
      note: growthNote || 'YoY',
      noteClass: 'text-emerald-400',
      tooltip: growthTooltip,
      badge: growthLabel,
      conflict: growthConflict,
      conflictOverlayValue: growthConflictOverlayValue,
    },
    {
      label: 'Customers',
      value: customers,
      note: 'Active',
      noteClass: 'text-zinc-400',
      tooltip: customersTooltip,
      badge: customersLabel,
      conflict: customersConflict,
      conflictOverlayValue: customersConflictOverlayValue,
    },
    {
      label: 'Business Model',
      value: businessModel,
      note: 'Recurring',
      noteClass: 'text-blue-400',
      tooltip: businessModelTooltip,
      badge: businessModelLabel,
      conflict: businessModelConflict,
      conflictOverlayValue: businessModelConflictOverlayValue,
    },
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
            <div className="w-full max-w-[300px]">
              {/* Deterministic band/guardrail badges */}
              {(bandLabel || hardPassGuardrailTriggered) ? (
                <div className="flex flex-wrap items-center justify-center gap-2 mb-3">
                  {bandLabel ? (
                    <span
                      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold border ${
                        darkMode
                          ? 'bg-white/5 text-zinc-200 border-white/10'
                          : 'bg-white text-zinc-800 border-gray-200'
                      }`}
                    >
                      {bandLabel}
                    </span>
                  ) : null}

                  {hardPassGuardrailTriggered ? (
                    <span className="inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold bg-red-500/15 text-red-200 border border-red-500/30">
                      Hard Pass (Full Coverage)
                    </span>
                  ) : null}
                </div>
              ) : null}

              {hardPassGuardrailTriggered && guardrailNote ? (
                <div className="text-xs text-center text-red-200/90 mb-3">
                  {guardrailNote}
                </div>
              ) : null}

              <div
                className="relative w-full max-w-[260px] mx-auto flex items-center justify-center"
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

            {showDecisionDetails ? (
              <details className="mt-3">
                <summary className={`cursor-pointer select-none text-xs ${darkMode ? 'text-zinc-300' : 'text-zinc-700'}`}>
                  Details
                </summary>
                <div className={`mt-2 text-xs space-y-2 ${darkMode ? 'text-zinc-200' : 'text-zinc-800'}`}>
                  {decisionLabel ? (
                    <div>
                      <span className="text-zinc-400">Recommendation:</span> <span className="font-semibold">{decisionLabel}</span>
                    </div>
                  ) : null}

                  {decisionReasons.length > 0 ? (
                    <div>
                      <div className="text-zinc-400">Reasons</div>
                      <ul className="list-disc pl-5 space-y-1">
                        {decisionReasons.map((r) => (
                          <li key={r}>{r}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {hardPassGuardrailCriteriaSnapshot ? (
                    <div>
                      <div className="text-zinc-400">Guardrail snapshot</div>
                      <div className={`mt-1 border rounded-lg p-2 ${darkMode ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-white'}`}>
                        <pre className="whitespace-pre-wrap break-words text-[11px] leading-snug">
                          {JSON.stringify(hardPassGuardrailCriteriaSnapshot, null, 2)}
                        </pre>
                      </div>
                    </div>
                  ) : null}
                </div>
              </details>
            ) : null}
            </div>
          </div>

          {/* Right: metric cards (2/3 on desktop) */}
          <div className="md:col-span-8">
            <h3 className="sr-only">Key metrics</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {metricCards.map((m) => (
                <div
                  key={m.label}
                  className={`${insetClass} p-4`}
                  title={m.conflict
                    ? `Conflict detected — overlay: ${m.conflictOverlayValue ?? '—'} · deterministic: ${typeof m.value === 'string' && m.value.trim() ? m.value.trim() : '—'}`
                    : (m.tooltip || undefined)}
                >
                  {(() => {
                    const displayValue = typeof m.value === 'string' && m.value.trim() ? m.value.trim() : '—';
                    return (
                      <>
                  <div className="text-xs text-zinc-500 mb-1">{m.label}</div>
                  <div className="text-2xl text-white mb-0.5 break-words">{displayValue}</div>
                  <div className="flex items-center gap-2">
                    <div className={`text-xs ${m.noteClass}`}>{m.note}</div>
                    {m.conflict ? (
                      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold bg-amber-500/15 text-amber-200 border border-amber-500/25">
                        Conflict
                      </span>
                    ) : null}
                    {m.badge ? (
                      <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold bg-white/5 text-zinc-200 border border-white/10">
                        {m.badge}
                      </span>
                    ) : null}
                  </div>
                      </>
                    );
                  })()}
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
            <div className="flex items-center gap-2 mb-3">
              <h3 className="text-sm text-zinc-300">{dealSummaryTitle}</h3>
              {dealSummarySource === 'canonical' ? (
                <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold bg-emerald-500/15 text-emerald-200 border border-emerald-500/25">
                  Canonical
                </span>
              ) : dealSummarySource === 'overlay' ? (
                <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold bg-blue-500/15 text-blue-200 border border-blue-500/25">
                  Overlay (non-authoritative)
                </span>
              ) : (
                <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold bg-white/5 text-zinc-200 border border-white/10">
                  Legacy
                </span>
              )}
            </div>

            {summaryParagraphs.length > 0 ? (
              <div className="space-y-2">
                {summaryParagraphs.map((p) => (
                  <p key={p} className="text-zinc-200 leading-relaxed">
                    {p}
                  </p>
                ))}
              </div>
            ) : (
              <p className="text-zinc-200 leading-relaxed">—</p>
            )}
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
