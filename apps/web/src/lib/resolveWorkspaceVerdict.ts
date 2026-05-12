/**
 * resolveWorkspaceVerdict
 *
 * Single authoritative resolver for the primary workspace decision verdict.
 * Replaces duplicated inline derivation in DealWorkspace.tsx.
 *
 * Priority chain (first match wins):
 *   0.  orchReport.canonical_decision.verdict                    → map 5-band → 4-verdict
 *   0.5 report.metadata.canonical_decision_v2.verdict (V2 stub) → map CanonicalVerdictV2 → 4-verdict  [Phase 1]
 *   1.  report.metadata.hard_pass_guardrail_v2.triggered        → HARD_PASS
 *   2.  report.metadata.decision_v1.recommendation_key          → map 6-band → 4-verdict
 *   3.  phase1Signals.recommendation (pre-report state)         → keyword match → verdict
 *   4.  score threshold fallback (≥70 FUND, ≥55 CONSIDER)      → verdict
 *   5.  default                                                  → PASS
 */

import { mapCanonicalVerdictToWorkspace } from './canonicalVerdictDisplay';
import type { CanonicalDecisionWeb } from './apiClient';

export type WorkspaceVerdict = 'HARD_PASS' | 'FUND' | 'INVESTIGATE' | 'CONSIDER' | 'PASS';

export type WorkspaceVerdictSource =
  | 'canonical_decision'
  | 'canonical_v2'
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
 * Map a `decision_v1.recommendation_key` to the canonical 4-verdict.
 *
 * Accepts the machine key emitted by `computeDecisionV1()` — NOT the human label.
 * Also accepts the legacy band key `'consider_caution'` for backward compatibility.
 * Exported so DealWorkspace display sites can use the same mapping without
 * duplicating a switch statement. Returns null when the key is unrecognised.
 *
 * Mapping (recommendation_key values from computeDecisionV1):
 *   hard_pass                                  → HARD_PASS
 *   fund_confident | fund_track | fund_caution → FUND
 *   strong_consider | consider                 → CONSIDER
 *   consider_caution (legacy band key)         → CONSIDER
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
    case 'consider':         // actual recommendation_key emitted by computeDecisionV1 for consider_caution band
    case 'consider_caution': // legacy band key — kept for backward compatibility
      return 'CONSIDER';
    default:
      return null;
  }
}

/** decision_v1.label → WorkspaceVerdict. Returns null if label is unrecognised. */
function mapDecisionV1Label(label: string): WorkspaceVerdict | null {
  return mapDecisionV1LabelInternal(label);
}

/**
 * Maps a `CanonicalVerdictV2` string → `WorkspaceVerdict`.
 * Phase 2: `investigate` and `advance` surface as the first-class INVESTIGATE verdict.
 */
function mapCanonicalV2VerdictToWorkspace(verdict: string): WorkspaceVerdict | null {
  switch (verdict) {
    case 'fund':        return 'FUND';
    case 'advance':     return 'INVESTIGATE'; // Phase 2: advance surfaces as investigate
    case 'investigate': return 'INVESTIGATE'; // Phase 2: first-class verdict
    case 'pass':        return 'PASS';
    case 'hard_pass':   return 'HARD_PASS';
    default:            return null;
  }
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
 * - `orchReport`    — orchestrator-report response (contains canonical_decision). May be null.
 * - `report`        — the raw report API object (`reportFromApi`). May be null/undefined.
 * - `score`         — the current canonical score 0–100, or null.
 * - `phase1Signals` — pre-report LLM signals (used only when report is absent). May be null.
 *
 * Pure function — safe in useMemo, tests, and outside React.
 */
export function resolveWorkspaceVerdict(args: {
  orchReport?: { canonical_decision?: CanonicalDecisionWeb | null } | null;
  report: unknown;
  score: number | null;
  phase1Signals: { recommendation: string | null; score: number | null } | null;
}): ResolvedWorkspaceVerdict {
  const { orchReport, report, score, phase1Signals } = args;

  // ── 0. Canonical decision from orchReport (highest authority when available) ──
  const canonicalVerdict = orchReport?.canonical_decision?.verdict;
  if (canonicalVerdict) {
    return { verdict: mapCanonicalVerdictToWorkspace(canonicalVerdict), source: 'canonical_decision' };
  }

  // ── 0.5 canonical_decision_v2 stub (Phase 1 V2 contract) ──────────────────
  // Preferred over legacy decision_v1 when the V2 stub is present.
  // advance and investigate both map to CONSIDER — WorkspaceVerdict is extended in Phase 2.
  if (report && typeof report === 'object') {
    const r = report as Record<string, unknown>;
    const meta = r['metadata'];
    if (meta && typeof meta === 'object') {
      const m = meta as Record<string, unknown>;
      const cdv2 = m['canonical_decision_v2'];
      if (cdv2 && typeof cdv2 === 'object') {
        const v2 = cdv2 as Record<string, unknown>;
        const v2verdict = v2['verdict'];
        if (typeof v2verdict === 'string' && v2verdict.trim()) {
          const mapped = mapCanonicalV2VerdictToWorkspace(v2verdict.trim());
          if (mapped !== null) {
            if (typeof window !== 'undefined' && (window as any).__DEV__) {
              console.log('[V2-VERDICT] canonical_decision_v2 resolved verdict:', {
                v2_verdict: v2verdict,
                mapped_to: mapped,
                source: 'canonical_v2',
                conflict_detected: Boolean(v2['conflict_detected']),
                stub: v2['stub'] ?? false,
              });
            }
            return { verdict: mapped, source: 'canonical_v2' };
          }
        }
      }
    }
  }

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

  // ── 2. decision_v1.recommendation_key (canonical stored recommendation) ─────
  // NOTE: read recommendation_key (machine key), NOT label (human display string).
  // The label is a presentational field and does not match the switch cases.
  // See SCORING_SOURCE_OF_TRUTH_CONTRACT.md Rule 8.
  if (report && typeof report === 'object') {
    const r = report as Record<string, unknown>;
    const meta = r['metadata'];
    if (meta && typeof meta === 'object') {
      const m = meta as Record<string, unknown>;
      const d1 = m['decision_v1'];
      if (d1 && typeof d1 === 'object') {
        const keyRaw = (d1 as Record<string, unknown>)['recommendation_key'];
        if (typeof keyRaw === 'string' && keyRaw.trim()) {
          const mapped = mapDecisionV1Label(keyRaw.trim());
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
