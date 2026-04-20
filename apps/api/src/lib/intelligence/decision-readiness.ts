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
  challenge_factors: Array<{ code?: string; severity?: string }>;
  /** challenge_pass.missing_evidence */
  missing_evidence: Array<{ evidence_type?: string; verdict_sensitivity?: string }>;
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
}

/** Evidence types that are critical for investment decisions. */
const CRITICAL_EVIDENCE_TYPES = new Set(['runway', 'burn_rate', 'structured_arr']);

/** Severity values that count as "high" for NOT_INVESTABLE gating. */
const HIGH_SEVERITY_VALUES = new Set(['critical', 'high']);

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
    };
  }

  // ── Rule 3: CONDITIONAL ──────────────────────────────────────────────────
  if (score !== null && score >= 40 && score < 65 && contradiction_count < 2) {
    const gapNote =
      missingCriticalCount > 0
        ? `${missingCriticalCount} critical evidence gap${missingCriticalCount !== 1 ? 's' : ''} resolvable`
        : 'No structural contradictions';
    return {
      readiness: 'CONDITIONAL',
      reason: `Moderate conviction (${score}/100) with resolvable gaps — conditional on providing additional evidence.`,
      signals: [`Conviction score ${score}/100`, gapNote],
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

  return {
    readiness: 'NOT_READY',
    reason:
      missingCriticalCount > 0
        ? `Missing critical financial evidence (${missingCritical.map((e) => e.evidence_type).join(', ')}) required before an investment decision can be made.`
        : `Insufficient conviction (${score ?? '—'}/100) for investment consideration — deal fundamentals need further development.`,
    signals: notReadySignals,
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

  const challengeFactors: Array<{ code?: string; severity?: string }> = Array.isArray(cp?.challenge_factors)
    ? (cp.challenge_factors as unknown[]).filter(
        (x): x is Record<string, unknown> => x !== null && typeof x === 'object'
      )
    : [];

  const missingEvidence: Array<{ evidence_type?: string; verdict_sensitivity?: string }> = Array.isArray(
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
