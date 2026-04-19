interface ContributorItem {
  key: string;
  label: string;
  scoreDelta: number | null;
}

interface ClaimSupportItemProp {
  claim: string;
  category: string;
  status: 'supported' | 'incomplete' | 'missing' | 'contradicted';
  reasons: string[];
  evidence_refs: string[];
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
  // Decision Proof Block inputs (Stage 5 challenge_pass data — fallback when claim_support_v1 absent)
  primaryChallengeReason?: string | null;
  missingEvidenceItems?: Array<{
    evidence_type: string;
    description: string;
    verdict_sensitivity: string;
    diligence_question: string;
  }>;
  contradictions?: string[];
  scoreBreakdownSections?: Array<{
    key: string;
    label: string;
    support_status?: string;
    missing_reasons?: string[];
  }>;
  // Primary source for Decision Proof Block — overrides challenge_pass derivation when present.
  claimSupportItems?: ClaimSupportItemProp[] | null;
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
  primaryChallengeReason,
  missingEvidenceItems = [],
  contradictions = [],
  scoreBreakdownSections = [],
  claimSupportItems = null,
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

  // ── Decision Proof Block ──────────────────────────────────────────────────
  // Primary source: claim_support_v1 items (deterministic, all 6 categories).
  // Fallback: challenge_pass signals (primaryChallengeReason, missingEvidenceItems,
  //           contradictions, scoreBreakdownSections).
  const PRIORITY_SECTION_KEYS = new Set([
    'market', 'product', 'financials', 'financial', 'traction', 'revenue', 'customers',
  ]);
  const PRIORITY_EVIDENCE_RE = /market|customer|revenue|financial|arr|burn|traction|churn/i;
  const PRIORITY_CLAIM_CATS = new Set(['market', 'financials', 'traction', 'capital_structure']);

  // Pre-compute claim_support_v1-derived sections (primary path).
  const _csDerived = (() => {
    if (!claimSupportItems || claimSupportItems.length === 0) return null;
    const contradicted = claimSupportItems.filter((i) => i.status === 'contradicted');
    const missing = claimSupportItems.filter((i) => i.status === 'missing');
    const supported = claimSupportItems.filter((i) => i.status === 'supported');
    const missingOrIncomplete = claimSupportItems.filter(
      (i) => i.status === 'missing' || i.status === 'incomplete',
    );

    const pbItem =
      contradicted.find((i) => PRIORITY_CLAIM_CATS.has(i.category)) ??
      missing.find((i) => PRIORITY_CLAIM_CATS.has(i.category)) ??
      contradicted[0] ??
      missing[0] ??
      null;

    const kcItem = contradicted.filter((i) => i !== pbItem)[0] ?? null;

    const topMissing =
      missing.find((i) => PRIORITY_CLAIM_CATS.has(i.category)) ?? missing[0] ?? null;

    return {
      primaryBlocker: pbItem?.reasons[0] ?? null,
      keyConflict: kcItem?.reasons[0] ?? null,
      supportItems: supported.slice(0, 2).map((i): ContributorItem => ({
        key: i.category,
        label: i.claim,
        scoreDelta: null,
      })),
      missingItems: missingOrIncomplete
        .filter((i) => i !== pbItem)
        .sort((a, b) => {
          const aP = PRIORITY_CLAIM_CATS.has(a.category) ? 0 : 1;
          const bP = PRIORITY_CLAIM_CATS.has(b.category) ? 0 : 1;
          if (aP !== bP) return aP - bP;
          return a.status === 'missing' ? -1 : 1;
        })
        .slice(0, 2)
        .flatMap((i) => i.reasons.slice(0, 1)),
      upgradePath: topMissing?.reasons[0]
        ? `This deal strengthens if: ${topMissing.reasons[0]}`
        : null,
    };
  })();

  // 1. Primary Blocker
  const primaryBlocker: string | null = _csDerived
    ? _csDerived.primaryBlocker
    : (() => {
        const highMissing = missingEvidenceItems.find((m) => m.verdict_sensitivity === 'High');
        if (highMissing) return highMissing.description;
        if (primaryChallengeReason) return primaryChallengeReason;
        const unsupportedPriority = scoreBreakdownSections.find(
          (s) => s.support_status === 'missing' && PRIORITY_SECTION_KEYS.has(s.key)
        );
        if (unsupportedPriority) {
          const reason = unsupportedPriority.missing_reasons?.[0];
          return reason
            ? `${unsupportedPriority.label}: ${reason}`
            : `${unsupportedPriority.label} evidence not validated`;
        }
        return null;
      })();

  // 2. Key Conflict
  const keyConflict: string | null = _csDerived
    ? _csDerived.keyConflict
    : (() => {
        if (!contradictions.length) return null;
        const short = contradictions.find((c) => c.length < 200 && c.length > 10);
        if (short) return short;
        const firstSentence = contradictions[0]?.split(/\.\s+/)[0]?.trim();
        return firstSentence && firstSentence.length > 10 ? firstSentence + '.' : null;
      })();

  // 3. What Supports This Deal
  const decisionSupportItems: ContributorItem[] = _csDerived
    ? _csDerived.supportItems
    : topPositiveContributors.slice(0, 2);

  // 4. What Is Missing
  const decisionMissingItems: string[] = _csDerived
    ? _csDerived.missingItems
    : (() => {
        if (!missingEvidenceItems.length) return [];
        return [...missingEvidenceItems]
          .sort((a, b) => {
            const aMatch = PRIORITY_EVIDENCE_RE.test(`${a.evidence_type} ${a.description}`) ? 0 : 1;
            const bMatch = PRIORITY_EVIDENCE_RE.test(`${b.evidence_type} ${b.description}`) ? 0 : 1;
            if (aMatch !== bMatch) return aMatch - bMatch;
            const sensOrder: Record<string, number> = { High: 0, Medium: 1, Low: 2 };
            return (sensOrder[a.verdict_sensitivity] ?? 2) - (sensOrder[b.verdict_sensitivity] ?? 2);
          })
          .slice(0, 2)
          .map((m) => m.description);
      })();

  // 5. Upgrade Path — always prefer a challenge_pass diligence_question (action-oriented) over
  //    a problem-description reason. Returns null when no actionable question is available.
  const upgradePath: string | null = (() => {
    const bestDQ =
      missingEvidenceItems.find((m) => m.verdict_sensitivity === 'High' && m.diligence_question) ??
      missingEvidenceItems.find((m) => m.diligence_question);
    if (bestDQ?.diligence_question) return `This deal could advance if: ${bestDQ.diligence_question}`;
    return null;
  })();

  const hasDecisionProof = !!(
    primaryBlocker || keyConflict || decisionSupportItems.length || decisionMissingItems.length || upgradePath
  );

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
           explanatory note, not a second verdict. */}
      {bandVerdictConflict && (() => {
        // Specific case: workspace says "Investigate" but conviction band is negative (Pass / Hard Pass)
        const isInvestigateVsPass =
          (postureLabel === 'Investigate') &&
          /pass/i.test(bandLabel ?? '');
        return (
          <div className={`px-4 py-2.5 space-y-1 ${darkMode ? 'bg-white/[0.02]' : 'bg-amber-50/50'}`}>
            <div className={`text-xs font-medium uppercase tracking-wider ${muted}`}>Diagnostic Context</div>
            {bandLabel && (
              <div className={`text-xs ${muted}`}>Model signal: {bandLabel}</div>
            )}
            <p className={`text-xs leading-relaxed ${muted} opacity-80`}>
              {isInvestigateVsPass
                ? `The quantitative model leans negative (${bandLabel}), but the system-level verdict recommends further investigation. Mixed signals of this kind typically indicate the deal has merit worth exploring but has not yet cleared the conviction threshold — further diligence can resolve this tension.`
                : 'Deterministic signals are weaker than the governed workspace verdict.'}
            </p>
          </div>
        );
      })()}

      {/* Decision Proof Block — signal-level synthesis from Stage 5 challenge_pass data.
           Shows only when at least one signal is present. No scores are rendered. */}
      {hasDecisionProof && (
        <div className="px-4 py-3 space-y-2">
          <div className={`text-xs font-medium uppercase tracking-wider ${muted}`}>Decision Proof</div>
          {primaryBlocker && (
            <div className={`flex items-start gap-2 text-xs ${sub}`}>
              <span className="mt-0.5 shrink-0 text-red-400">▼</span>
              <span>
                <span className={`font-medium ${darkMode ? 'text-red-300' : 'text-red-600'}`}>Primary Blocker</span>
                {' — '}
                {primaryBlocker}
              </span>
            </div>
          )}
          {keyConflict && (
            <div className={`flex items-start gap-2 text-xs ${sub}`}>
              <span className="mt-0.5 shrink-0 text-amber-400">◆</span>
              <span>
                <span className={`font-medium ${darkMode ? 'text-amber-300' : 'text-amber-700'}`}>Key Conflict</span>
                {' — '}
                {keyConflict}
              </span>
            </div>
          )}
          {decisionSupportItems.map((s) => (
            <div key={s.key} className={`flex items-start gap-2 text-xs ${sub}`}>
              <span className="mt-0.5 shrink-0 text-emerald-400">▲</span>
              <span>
                <span className={`font-medium ${darkMode ? 'text-emerald-300' : 'text-emerald-700'}`}>Supports</span>
                {' — '}
                {s.label}
              </span>
            </div>
          ))}
          {decisionMissingItems.map((m, i) => (
            <div key={i} className={`flex items-start gap-2 text-xs ${sub}`}>
              <span className={`mt-0.5 shrink-0 ${muted}`}>○</span>
              <span>
                <span className={`font-medium ${muted}`}>Missing</span>
                {' — '}
                {m}
              </span>
            </div>
          ))}
          {upgradePath && (
            <div className={`flex items-start gap-2 text-xs`}>
              <span className="mt-0.5 shrink-0 text-blue-400">→</span>
              <span className={`italic ${muted}`}>{upgradePath}</span>
            </div>
          )}
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
