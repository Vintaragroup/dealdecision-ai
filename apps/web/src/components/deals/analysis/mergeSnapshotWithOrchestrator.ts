/**
 * mergeSnapshotWithOrchestrator — pure overlay mapper
 *
 * Merges server-driven OrchestratorReportV1 values onto a locally-computed
 * DealAnalysis snapshot. Only overrides fields with direct server equivalents;
 * all other fields retain their locally-computed values.
 *
 * Decision label policy (Policy A — canonical labels):
 *   When orch.decision.label is present, merged.grade is set to that label
 *   verbatim: 'GO', 'CONSIDER', or 'NO_GO'.
 * When orch is absent or decision is missing, local grade is unchanged.
 *
 * Pure function — no side effects, no DOM, no hooks.
 */

import type { DealAnalysis } from './AnalysisSnapshotDashboard';
import type {
  OrchestratorReportV1,
  OrchestratorVerificationRequest,
} from '../../../lib/apiClient';

// Slice limits prevent overflowing the snapshot UI with large server payloads.
const RED_FLAG_CAP = 8;
const GREEN_FLAG_CAP = 8;

export function mergeSnapshotWithOrchestrator(
  local: DealAnalysis,
  orch?: OrchestratorReportV1 | null
): DealAnalysis {
  if (!orch) return local;

  const merged: DealAnalysis = { ...local, categories: [...local.categories] };

  // ── Overall Score ──────────────────────────────────────────────────────────
  const ors = orch.scores?.overall_recommendation_score;
  if (typeof ors === 'number' && isFinite(ors) && ors >= 0) {
    merged.overallScore = Math.round(ors);
  }

  // ── Grade (from decision label — Policy A: canonical label, no remap) ───────
  // Assigns the server label verbatim: 'GO', 'CONSIDER', or 'NO_GO'.
  // Absent / unknown labels leave local grade unchanged.
  const label = orch.decision?.label;
  if (label === 'GO' || label === 'CONSIDER' || label === 'NO_GO') {
    merged.grade = label;
  }

  // ── Category Score Overrides (server-sourced only) ─────────────────────────
  // Matches by exact category name. Unknown names are silently skipped
  // (local score left unchanged — no throws).
  const marketRaw = orch.scores?.market_score?.raw;
  const financialScore = orch.scores?.financial_health_score?.score;
  merged.categories = local.categories.map((cat) => {
    if (
      cat.name === 'Market Opportunity' &&
      typeof marketRaw === 'number' &&
      isFinite(marketRaw)
    ) {
      return { ...cat, score: Math.round(marketRaw) };
    }
    if (
      cat.name === 'Financial Health' &&
      typeof financialScore === 'number' &&
      isFinite(financialScore)
    ) {
      return { ...cat, score: Math.round(financialScore) };
    }
    return cat;
  });

  // ── Red Flags (P0/P1 verification requests only) ───────────────────────────
  // Stable sort: P0 before P1, then alphabetical by request string.
  // Deduplicates by request string. Capped at RED_FLAG_CAP.
  const vRequests = orch.segments?.risk_verification?.verification_requests;
  if (Array.isArray(vRequests) && vRequests.length > 0) {
    const seen = new Set<string>();
    const highPriority = vRequests
      .filter(
        (r: OrchestratorVerificationRequest) =>
          r.priority === 'P0' || r.priority === 'P1'
      )
      .sort((a, b) => {
        if (a.priority !== b.priority) return a.priority === 'P0' ? -1 : 1;
        return a.request.localeCompare(b.request);
      })
      .filter((r: OrchestratorVerificationRequest) => {
        if (seen.has(r.request)) return false;
        seen.add(r.request);
        return true;
      })
      .slice(0, RED_FLAG_CAP);

    if (highPriority.length > 0) {
      merged.redFlags = highPriority.map((r: OrchestratorVerificationRequest) => ({
        severity: r.priority === 'P0' ? ('high' as const) : ('medium' as const),
        message: r.request,
        action: r.why,
      }));
    }
  }

  // ── Green Flags (decision rationale bullets) ───────────────────────────────
  // Preserves original bullet order. Deduplicates and strips empty strings.
  // Capped at GREEN_FLAG_CAP. Only replaces local flags when server has content.
  const bullets = orch.decision?.rationale_bullets;
  if (Array.isArray(bullets)) {
    const seen = new Set<string>();
    const clean = bullets
      .filter((b): b is string => typeof b === 'string' && b.trim().length > 0)
      .filter((b) => {
        if (seen.has(b)) return false;
        seen.add(b);
        return true;
      })
      .slice(0, GREEN_FLAG_CAP);
    if (clean.length > 0) {
      merged.greenFlags = clean;
    }
  }

  return merged;
}
