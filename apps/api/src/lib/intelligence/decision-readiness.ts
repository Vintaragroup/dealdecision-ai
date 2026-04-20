/**
 * Decision Readiness Classification
 *
 * Pure deterministic function — no DB access, no LLM, no side effects.
 * Classifies a deal into one of four investment-readiness buckets based on
 * existing conviction_v1 and challenge_pass signals.
 *
 * Priority order (first match wins):
 *   1. NOT_INVESTABLE — structural contradictions or low conviction + critical flags
 *   2. INVESTABLE     — high conviction, no critical flags, critical evidence complete
 *   3. CONDITIONAL    — moderate conviction, resolvable gaps, no structural contradictions
 *   4. NOT_READY      — default: missing critical evidence or insufficient conviction
 */

export type DecisionReadiness = 'NOT_INVESTABLE' | 'NOT_READY' | 'CONDITIONAL' | 'INVESTABLE';

export interface DecisionReadinessInput {
  /** conviction_v1.conviction_score_0_100 */
  conviction_score: number | null;
  /** challenge_pass.challenge_factors */
  challenge_factors: Array<{ code?: string; severity?: string; title?: string; label?: string }>;
  /** challenge_pass.missing_evidence */
  missing_evidence: Array<{ evidence_type?: string; verdict_sensitivity?: string; description?: string; diligence_question?: string }>;
  /**
   * Max of:
   *   - conviction_v1.contradictions.length
   *   - challenge_pass.contradiction_explanations.length
   */
  contradiction_count: number;
  /** challenge_pass.flag_count_critical */
  flag_count_critical: number;
}

export interface DecisionReadinessResult {
  readiness: DecisionReadiness;
  /** Single human-readable sentence for UI display. */
  reason: string;
  /** Contributing signal labels for tooltip / expanded view. */
  signals: string[];
  /** Prioritized investor-facing next steps derived from the deal's signals. */
  next_actions: string[];
}

/** Evidence types that are critical for investment decisions. */
const CRITICAL_EVIDENCE_TYPES = new Set(['runway', 'burn_rate', 'structured_arr']);

/** Severity values that count as "high" for NOT_INVESTABLE gating. */
const HIGH_SEVERITY_VALUES = new Set(['critical', 'high']);

/** Maps a missing evidence item to an investor-facing action sentence. */
function evidenceToAction(e: {
  evidence_type?: string;
  diligence_question?: string;
  description?: string;
}): string {
  if (e.diligence_question) {
    const q = e.diligence_question.trim();
    return q.endsWith('.') || q.endsWith('?') ? q : `${q}.`;
  }
  const et = (e.evidence_type ?? '').toLowerCase();
  if (et === 'runway') return 'Provide verified runway data (months remaining) via bank statements or CFO sign-off.';
  if (et === 'burn_rate') return 'Submit monthly burn rate from signed accounts or CFO confirmation.';
  if (et === 'structured_arr') return 'Provide a structured ARR/MRR breakdown from the accounting system or financial model.';
  const label = (e.evidence_type ?? 'financial evidence').replace(/_/g, ' ');
  return `Provide ${label} required for a complete investment assessment.`;
}

/** Maps a challenge factor to an investor-facing action sentence, or null if not actionable. */
function factorToAction(f: { code?: string; title?: string; label?: string }): string | null {
  if (f.title) { const t = f.title.trim(); return t.endsWith('.') ? t : `${t}.`; }
  if (f.label) { const l = f.label.trim(); return l.endsWith('.') ? l : `${l}.`; }
  const code = (f.code ?? '').toLowerCase();
  if (code === 'financial_evidence_weak') return 'Obtain primary source financial data to replace deck-derived assumptions.';
  if (code === 'contradiction_cluster') return 'Reconcile contradicting claims across submitted documents.';
  if (code === 'single_contradiction') return 'Resolve the identified factual contradiction before proceeding.';
  if (code === 'deterministic_only') return 'Supplement the data room with verified evidence beyond the pitch deck.';
  return null;
}

export function classifyDecisionReadiness(
  input: DecisionReadinessInput
): DecisionReadinessResult {
  const {
    conviction_score,
    challenge_factors,
    missing_evidence,
    contradiction_count,
    flag_count_critical,
  } = input;

  const score = typeof conviction_score === 'number' && Number.isFinite(conviction_score)
    ? conviction_score
    : null;

  const hasFinancialEvidenceWeak = challenge_factors.some(
    (f) => typeof f.code === 'string' && f.code.toLowerCase() === 'financial_evidence_weak'
  );

  const hasHighSeverityFlag =
    flag_count_critical > 0 ||
    challenge_factors.some((f) => HIGH_SEVERITY_VALUES.has(f.severity?.toLowerCase() ?? ''));

  const missingCritical = missing_evidence.filter(
    (e) => CRITICAL_EVIDENCE_TYPES.has(e.evidence_type?.toLowerCase() ?? '')
  );
  const missingCriticalCount = missingCritical.length;

  // ── Rule 1: NOT_INVESTABLE ───────────────────────────────────────────────
  if (contradiction_count >= 2 && hasFinancialEvidenceWeak) {
    return {
      readiness: 'NOT_INVESTABLE',
      reason: `Structural contradictions (${contradiction_count}) combined with weak financial evidence make this deal not investable at this stage.`,
      signals: [
        `${contradiction_count} contradictions detected`,
        'Financial evidence weak',
      ],
      next_actions: [
        'Resolve conflicting claims across submitted materials before relying on any financial projection.',
        'Obtain primary source financial data (bank statements, signed accounts) to replace deck-derived assumptions.',
        ...challenge_factors
          .filter((f) => f.code?.toLowerCase() !== 'financial_evidence_weak' && HIGH_SEVERITY_VALUES.has(f.severity?.toLowerCase() ?? ''))
          .slice(0, 1)
          .map(factorToAction)
          .filter((a): a is string => a !== null),
      ].slice(0, 4),
    };
  }

  if (score !== null && score < 35 && hasHighSeverityFlag) {
    return {
      readiness: 'NOT_INVESTABLE',
      reason: `Low conviction score (${score}/100) with high-severity flags indicates this deal is not investable without fundamental changes.`,
      signals: [
        `Conviction score ${score}/100`,
        'High-severity flags present',
      ],
      next_actions: [
        'Address the high-severity structural concerns identified before re-evaluating this deal.',
        ...challenge_factors
          .filter((f) => HIGH_SEVERITY_VALUES.has(f.severity?.toLowerCase() ?? ''))
          .slice(0, 2)
          .map(factorToAction)
          .filter((a): a is string => a !== null),
        'Re-submit with verified financial evidence once structural issues are resolved.',
      ].slice(0, 4),
    };
  }

  if (contradiction_count >= 3) {
    return {
      readiness: 'NOT_INVESTABLE',
      reason: `Multiple document contradictions (${contradiction_count}) make the deal model unreliable — the submitted materials cannot be reconciled.`,
      signals: [
        `${contradiction_count} document contradictions`,
        'Deal model cannot be trusted',
      ],
      next_actions: [
        'Reconcile document-level contradictions across submitted materials — the deal model cannot be relied upon until resolved.',
        ...challenge_factors
          .filter((f) => f.code?.toLowerCase() === 'contradiction_cluster')
          .slice(0, 1)
          .map(factorToAction)
          .filter((a): a is string => a !== null),
        'Re-submit a consolidated data room with consistent figures across all documents.',
      ].slice(0, 4),
    };
  }

  // ── Rule 2: INVESTABLE ───────────────────────────────────────────────────
  if (score !== null && score >= 65 && flag_count_critical === 0 && missingCriticalCount === 0) {
    return {
      readiness: 'INVESTABLE',
      reason: `Strong conviction (${score}/100) with no critical flags and complete critical evidence supports investment consideration.`,
      signals: [
        `Conviction score ${score}/100`,
        'No critical flags',
        'Critical evidence complete',
      ],
      next_actions: [
        'Confirm cap table accuracy and current ownership structure before term sheet.',
        'Complete final legal and compliance review.',
        'Obtain updated financial model with trailing 12-month actuals.',
        'Schedule management presentation to confirm team and execution capability.',
      ],
    };
  }

  // ── Rule 3: CONDITIONAL ──────────────────────────────────────────────────
  if (score !== null && score >= 40 && score < 65 && contradiction_count < 2) {
    const gapNote =
      missingCriticalCount > 0
        ? `${missingCriticalCount} critical evidence gap${missingCriticalCount !== 1 ? 's' : ''} resolvable`
        : 'No structural contradictions';
    const conditionalActions: string[] = [];
    missingCritical.slice(0, 3).forEach((e) => conditionalActions.push(evidenceToAction(e)));
    if (conditionalActions.length === 0) {
      challenge_factors
        .filter((f) => f.code?.toLowerCase() !== 'financial_evidence_weak')
        .slice(0, 3)
        .map(factorToAction)
        .filter((a): a is string => a !== null)
        .forEach((a) => conditionalActions.push(a));
    }
    if (conditionalActions.length === 0) {
      conditionalActions.push('Provide supporting evidence to confirm the core investment thesis.');
    }
    return {
      readiness: 'CONDITIONAL',
      reason: `Moderate conviction (${score}/100) with resolvable gaps — conditional on providing additional evidence.`,
      signals: [`Conviction score ${score}/100`, gapNote],
      next_actions: conditionalActions.slice(0, 4),
    };
  }

  // ── Rule 4: NOT_READY (default) ──────────────────────────────────────────
  const notReadySignals: string[] = [];
  if (missingCriticalCount > 0) {
    const types = missingCritical.map((e) => e.evidence_type ?? 'unknown').join(', ');
    notReadySignals.push(`Missing critical evidence: ${types}`);
  }
  if (score !== null) {
    notReadySignals.push(`Conviction score ${score}/100`);
  }

  const notReadyActions: string[] = [];
  if (missingCriticalCount > 0) {
    missingCritical.slice(0, 3).forEach((e) => notReadyActions.push(evidenceToAction(e)));
  } else {
    notReadyActions.push('Strengthen revenue quality evidence — provide recurring revenue breakdown and signed customer contracts.');
    notReadyActions.push('Submit audited or signed financial statements to substantiate the current growth narrative.');
    notReadyActions.push('Provide an updated financial model with trailing actuals and 18-month projections.');
  }

  return {
    readiness: 'NOT_READY',
    reason:
      missingCriticalCount > 0
        ? `Missing critical financial evidence (${missingCritical.map((e) => e.evidence_type).join(', ')}) required before an investment decision can be made.`
        : `Insufficient conviction (${score ?? '—'}/100) for investment consideration — deal fundamentals need further development.`,
    signals: notReadySignals,
    next_actions: notReadyActions.slice(0, 4),
  };
}

/**
 * Extracts a `DecisionReadinessInput` from the compiled report object.
 * Fail-safe: any missing field returns a safe default.
 */
export function buildDecisionReadinessInputFromReport(report: unknown): DecisionReadinessInput {
  const r = report && typeof report === 'object' ? (report as Record<string, any>) : {};

  const cv1 = r['conviction_v1'] ?? null;
  const cp = r['challenge_pass'] ?? null;

  const score =
    typeof cv1?.conviction_score_0_100 === 'number' && Number.isFinite(cv1.conviction_score_0_100)
      ? (cv1.conviction_score_0_100 as number)
      : null;

  const challengeFactors: Array<{ code?: string; severity?: string; title?: string; label?: string }> = Array.isArray(cp?.challenge_factors)
    ? (cp.challenge_factors as unknown[]).filter(
        (x): x is Record<string, unknown> => x !== null && typeof x === 'object'
      )
    : [];

  const missingEvidence: Array<{ evidence_type?: string; verdict_sensitivity?: string; description?: string; diligence_question?: string }> = Array.isArray(
    cp?.missing_evidence
  )
    ? (cp.missing_evidence as unknown[]).filter(
        (x): x is Record<string, unknown> => x !== null && typeof x === 'object'
      )
    : [];

  // Use maximum of conviction_v1.contradictions and challenge_pass.contradiction_explanations
  const cv1ContradictionCount = Array.isArray(cv1?.contradictions) ? cv1.contradictions.length : 0;
  const cpContradictionCount = Array.isArray(cp?.contradiction_explanations)
    ? cp.contradiction_explanations.length
    : 0;
  const contradictionCount = Math.max(cv1ContradictionCount, cpContradictionCount);

  const flagCountCritical =
    typeof cp?.flag_count_critical === 'number' && Number.isFinite(cp.flag_count_critical)
      ? cp.flag_count_critical
      : 0;

  return {
    conviction_score: score,
    challenge_factors: challengeFactors,
    missing_evidence: missingEvidence,
    contradiction_count: contradictionCount,
    flag_count_critical: flagCountCritical,
  };
}
