interface ContributorItem {
  key: string;
  label: string;
  scoreDelta: number | null;
}

interface Props {
  convictionHeadline: string | null;
  convictionRationale: string | null;
  convictionPosture: string | null;
  convictionBand: string | null;
  convictionScore: number | null;
  topPositiveContributors: ContributorItem[];
  topNegativeContributors: ContributorItem[];
  requiredNextChecks: string[];
  insightsReady: boolean;
  darkMode: boolean;
  onOpenFull?: () => void;
  onGenerate?: () => void;
}

export function WorkbenchInsightsSummary({
  convictionHeadline,
  convictionRationale,
  convictionPosture,
  convictionBand,
  // convictionScore is wired from DealWorkspace but not rendered in the compact panel
  // (the governed score is shown only in Investment Snapshot to avoid competing numerics).
  convictionScore: _convictionScore,
  topPositiveContributors,
  topNegativeContributors,
  requiredNextChecks,
  insightsReady,
  darkMode,
  onOpenFull,
  onGenerate,
}: Props) {
  const border = darkMode ? 'border-white/10' : 'border-gray-200';
  const muted = darkMode ? 'text-gray-400' : 'text-gray-500';
  const sub = darkMode ? 'text-gray-300' : 'text-gray-700';
  const cardBg = darkMode ? 'bg-white/[0.03]' : 'bg-gray-50';

  const hasAnyData =
    convictionHeadline ||
    convictionRationale ||
    topPositiveContributors.length > 0 ||
    topNegativeContributors.length > 0 ||
    requiredNextChecks.length > 0;

  if (!hasAnyData) {
    return (
      <div className={`p-4 border-t ${border}`}>
        <div className={`text-xs ${muted} mb-3`}>
          {insightsReady ? 'Summary not available yet.' : 'Investor Insights not generated yet.'}
        </div>
        <div className="flex items-center gap-3">
          {onGenerate && (
            <button
              onClick={onGenerate}
              className={`text-xs font-medium underline underline-offset-2 transition-opacity hover:opacity-70 ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}
            >
              Generate insights
            </button>
          )}
          {onOpenFull && (
            <button
              onClick={onOpenFull}
              className={`text-xs font-medium underline underline-offset-2 transition-opacity hover:opacity-70 ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}
            >
              Open full diagnostics
            </button>
          )}
        </div>
      </div>
    );
  }

  const postureClass =
    convictionPosture === 'INVEST' || convictionPosture === 'YES' || convictionPosture === 'STRONG_YES'
      ? darkMode ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20' : 'bg-emerald-50 text-emerald-700 border-emerald-200'
      : convictionPosture === 'CONSIDER' || convictionPosture === 'INVESTIGATE'
      ? darkMode ? 'bg-amber-500/10 text-amber-300 border-amber-500/20' : 'bg-amber-50 text-amber-700 border-amber-200'
      : convictionPosture === 'PASS' || convictionPosture === 'HARD_PASS'
      ? darkMode ? 'bg-red-500/10 text-red-300 border-red-500/20' : 'bg-red-50 text-red-700 border-red-200'
      : darkMode ? 'bg-white/5 text-gray-300 border-white/10' : 'bg-gray-50 text-gray-600 border-gray-200';

  // postureLabel is ALWAYS derived from convictionPosture (the governed verdict from
  // resolveWorkspaceVerdict). convictionBand is conviction_v1.conviction_band — an
  // explanation field that must NOT override the workspace verdict display.
  const postureLabel =
    convictionPosture === 'INVEST' || convictionPosture === 'YES' || convictionPosture === 'STRONG_YES'
      ? 'Proceed'
      : convictionPosture === 'CONSIDER'
      ? 'Consider'
      : convictionPosture === 'INVESTIGATE'
      ? 'Investigate'
      : convictionPosture === 'PASS'
      ? 'Pass'
      : convictionPosture === 'HARD_PASS'
      ? 'Hard Pass'
      : null;

  // convictionBand is rendered as a separate diagnostic context block only when it disagrees
  // with the governed workspace verdict (postureLabel). Placing it in the badge row made the
  // two signals look like competing recommendations. It is now shown beneath the headline as
  // an explanatory note, not a second verdict.
  const bandSecondary = convictionBand && convictionBand.toUpperCase() !== postureLabel?.toUpperCase()
    ? convictionBand
    : null;
  const bandVerdictConflict = bandSecondary != null;  // true when models disagree

  // Human-readable band label.
  const bandLabel = bandSecondary
    ? bandSecondary.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
    : null;

  // Strip mechanical conviction score strings from the rationale before rendering.
  // These are auto-generated phrases that leak the conviction_v1 score into prose —
  // redundant and confusing when the diagnostic context block already shows the score.
  const usableRationale = (() => {
    const r = convictionRationale?.trim();
    if (!r) return null;
    if (/^conviction\s+\d+\/100/i.test(r)) return null;
    if (/^primary deterministic support is led by/i.test(r)) return null;
    if (/^conviction is constrained by/i.test(r)) return null;
    // Strip inline "Conviction N/100" fragments embedded mid-sentence.
    const stripped = r.replace(/\bconviction\s+\d+\/100\b[^.]*\.?\s*/gi, '').trim();
    return stripped.length > 15 ? stripped : null;
  })();

  return (
    <div className={`border-t ${border} divide-y ${darkMode ? 'divide-white/5' : 'divide-gray-100'}`}>

      {/* Conviction headline + posture */}
      {(convictionHeadline || postureLabel) && (
        <div className="px-4 py-3 space-y-2">
          {postureLabel && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`inline-flex text-xs px-2 py-0.5 rounded border font-medium ${postureClass}`}>
                {postureLabel}
              </span>
            </div>
          )}
          {convictionHeadline && (
            <p className={`text-xs leading-relaxed ${sub}`}>{convictionHeadline}</p>
          )}
        </div>
      )}

      {/* Diagnostic context — only shown when conviction_v1 band disagrees with the governed
           workspace verdict. No numeric score is shown here — only the band label and an
           explanatory sentence. The governed score is visible in Investment Snapshot only. */}
      {bandVerdictConflict && (
        <div className={`px-4 py-2.5 space-y-1 ${darkMode ? 'bg-white/[0.02]' : 'bg-amber-50/50'}`}>
          <div className={`text-xs font-medium uppercase tracking-wider ${muted}`}>Diagnostic Context</div>
          {bandLabel && (
            <div className={`text-xs ${muted}`}>Band: {bandLabel}</div>
          )}
          <p className={`text-xs leading-relaxed ${muted} opacity-80`}>
            Deterministic signals are weaker than the governed workspace verdict.
          </p>
        </div>
      )}

      {/* Positive drivers */}
      {topPositiveContributors.length > 0 && (
        <div className="px-4 py-3 space-y-1.5">
          <div className={`text-xs font-medium uppercase tracking-wider ${muted}`}>Positive Drivers</div>
          {topPositiveContributors.slice(0, 3).map((c) => (
            <div key={c.key} className={`flex items-start gap-2 text-xs ${sub}`}>
              <span className="mt-0.5 shrink-0 text-emerald-400">▲</span>
              <span>{c.label}</span>
            </div>
          ))}
        </div>
      )}

      {/* Negative drivers */}
      {topNegativeContributors.length > 0 && (
        <div className="px-4 py-3 space-y-1.5">
          <div className={`text-xs font-medium uppercase tracking-wider ${muted}`}>Negative Drivers</div>
          {topNegativeContributors.slice(0, 3).map((c) => (
            <div key={c.key} className={`flex items-start gap-2 text-xs ${sub}`}>
              <span className="mt-0.5 shrink-0 text-red-400">▼</span>
              <span>{c.label}</span>
            </div>
          ))}
        </div>
      )}

      {/* Missing signals / what could change decision */}
      {requiredNextChecks.length > 0 && (
        <div className="px-4 py-3 space-y-1.5">
          <div className={`text-xs font-medium uppercase tracking-wider ${muted}`}>What Could Change This</div>
          {requiredNextChecks.slice(0, 3).map((c, i) => (
            <div key={i} className={`flex items-start gap-2 text-xs ${sub}`}>
              <span className="mt-0.5 shrink-0 text-amber-400">◆</span>
              <span>{c}</span>
            </div>
          ))}
        </div>
      )}

      {/* Rationale */}
      {usableRationale && (
        <div className="px-4 py-3">
          <div className={`text-xs font-medium uppercase tracking-wider mb-1.5 ${muted}`}>Why This Decision</div>
          <p className={`text-xs leading-relaxed ${muted}`}>{usableRationale}</p>
        </div>
      )}

      {/* CTA footer */}
      {onOpenFull && (
        <div className={`px-4 py-3 ${cardBg}`}>
          <button
            onClick={onOpenFull}
            className={`text-xs font-medium underline underline-offset-2 transition-opacity hover:opacity-70 ${darkMode ? 'text-blue-400' : 'text-blue-600'}`}
          >
            Open full diagnostics →
          </button>
        </div>
      )}
    </div>
  );
}
