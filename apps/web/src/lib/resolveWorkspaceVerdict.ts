/**
 * resolveWorkspaceVerdict
 *
 * Single authoritative resolver for the primary workspace decision verdict.
 * Replaces duplicated inline derivation in DealWorkspace.tsx.
 *
 * Priority chain (first match wins):
 *   1. report.metadata.hard_pass_guardrail_v2.triggered  → HARD_PASS
 *   2. report.metadata.decision_v1.label                 → map 6-band → 4-verdict
 *   3. phase1Signals.recommendation (pre-report state)   → keyword match → verdict
 *   4. score threshold fallback (≥70 FUND, ≥55 CONSIDER) → verdict
 *   5. default                                           → PASS
 */

export type WorkspaceVerdict = 'HARD_PASS' | 'FUND' | 'CONSIDER' | 'PASS';

export type WorkspaceVerdictSource =
  | 'guardrail'
  | 'decision_v1'
  | 'phase1_signals'
  | 'score_threshold'
  | 'default';

export interface ResolvedWorkspaceVerdict {
  verdict: WorkspaceVerdict;
  source: WorkspaceVerdictSource;
}

/**
 * Map a stored `decision_v1.label` (6-band backend key) to the canonical 4-verdict.
 *
 * Exported so DealWorkspace display sites can use the same mapping without
 * duplicating a switch statement. Returns null when the label is unrecognised.
 *
 * Mapping:
 *   hard_pass                         → HARD_PASS
 *   fund_confident | fund_track | fund_caution → FUND
 *   strong_consider | consider_caution         → CONSIDER
 *   (anything else)                            → null
 */
export function mapDecisionV1LabelToVerdict(label: string): WorkspaceVerdict | null {
  return mapDecisionV1LabelInternal(label);
}

/** Internal alias — used by resolveWorkspaceVerdict without export overhead. */
function mapDecisionV1LabelInternal(label: string): WorkspaceVerdict | null {
  switch (label) {
    case 'hard_pass':
      return 'HARD_PASS';
    case 'fund_confident':
    case 'fund_track':
    case 'fund_caution':
      return 'FUND';
    case 'strong_consider':
    case 'consider_caution':
      return 'CONSIDER';
    default:
      return null;
  }
}

/** decision_v1.label → WorkspaceVerdict. Returns null if label is unrecognised. */
function mapDecisionV1Label(label: string): WorkspaceVerdict | null {
  return mapDecisionV1LabelInternal(label);
}

/** Score-only threshold fallback. */
function scoreToVerdict(score: number): WorkspaceVerdict {
  if (score >= 70) return 'FUND';
  if (score >= 55) return 'CONSIDER';
  return 'PASS';
}

/**
 * Resolve the canonical workspace verdict from the available data sources.
 *
 * - `report`        — the raw report API object (`reportFromApi`). May be null/undefined.
 * - `score`         — the current canonical score 0–100, or null.
 * - `phase1Signals` — pre-report LLM signals (used only when report is absent). May be null.
 *
 * Pure function — safe in useMemo, tests, and outside React.
 */
export function resolveWorkspaceVerdict(args: {
  report: unknown;
  score: number | null;
  phase1Signals: { recommendation: string | null; score: number | null } | null;
}): ResolvedWorkspaceVerdict {
  const { report, score, phase1Signals } = args;

  // ── 1. Hard-pass guardrail (overrides everything) ──────────────────────────
  if (report && typeof report === 'object') {
    const r = report as Record<string, unknown>;
    const meta = r['metadata'];
    if (meta && typeof meta === 'object') {
      const m = meta as Record<string, unknown>;
      const guardrail = m['hard_pass_guardrail_v2'];
      if (guardrail && typeof guardrail === 'object') {
        if (Boolean((guardrail as Record<string, unknown>)['triggered'])) {
          return { verdict: 'HARD_PASS', source: 'guardrail' };
        }
      }
    }
  }

  // ── 2. decision_v1.label (canonical stored recommendation) ─────────────────
  if (report && typeof report === 'object') {
    const r = report as Record<string, unknown>;
    const meta = r['metadata'];
    if (meta && typeof meta === 'object') {
      const m = meta as Record<string, unknown>;
      const d1 = m['decision_v1'];
      if (d1 && typeof d1 === 'object') {
        const labelRaw = (d1 as Record<string, unknown>)['label'];
        if (typeof labelRaw === 'string' && labelRaw.trim()) {
          const mapped = mapDecisionV1Label(labelRaw.trim());
          if (mapped !== null) {
            return { verdict: mapped, source: 'decision_v1' };
          }
        }
      }
    }
  }

  // ── 3. phase1Signals.recommendation (pre-report LLM signal) ────────────────
  if (phase1Signals) {
    const rec = typeof phase1Signals.recommendation === 'string'
      ? phase1Signals.recommendation.toLowerCase().trim()
      : null;
    if (rec) {
      if (rec.includes('pass') || rec.includes('reject')) {
        return { verdict: 'PASS', source: 'phase1_signals' };
      }
      if (rec.includes('go') || rec.includes('invest') || rec.includes('proceed') || rec.includes('fund')) {
        return { verdict: 'FUND', source: 'phase1_signals' };
      }
      if (rec.includes('consider')) {
        return { verdict: 'CONSIDER', source: 'phase1_signals' };
      }
    }
    // phase1 score fallback within phase1 path
    if (typeof phase1Signals.score === 'number' && Number.isFinite(phase1Signals.score)) {
      return { verdict: scoreToVerdict(Math.round(phase1Signals.score)), source: 'phase1_signals' };
    }
  }

  // ── 4. Canonical score threshold fallback ──────────────────────────────────
  if (typeof score === 'number' && Number.isFinite(score)) {
    return { verdict: scoreToVerdict(score), source: 'score_threshold' };
  }

  // ── 5. Default ─────────────────────────────────────────────────────────────
  return { verdict: 'PASS', source: 'default' };
}
