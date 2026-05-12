/**
 * canonicalVerdictDisplay.ts
 *
 * Shared display helpers for CanonicalVerdictWeb (5-band) used by
 * OrchestratorSummaryCard, DecisionOverlay, and resolveWorkspaceVerdict.
 *
 * Vocabulary:  strong_yes | yes | watch | pass | strong_pass
 *
 * No imports from packages/core — web-side only via CanonicalVerdictWeb from apiClient.
 */

import type { CanonicalVerdictWeb } from './apiClient';
import type { WorkspaceVerdict } from './resolveWorkspaceVerdict';

// ─────────────────────────────────────────────────────────────────────────────
// Human-readable labels
// ─────────────────────────────────────────────────────────────────────────────

const VERDICT_LABELS: Record<CanonicalVerdictWeb, string> = {
  strong_yes: 'Strong Invest',
  yes: 'Invest',
  watch: 'Watch',
  pass: 'Pass',
  strong_pass: 'Strong Pass',
};

export function getCanonicalVerdictLabel(verdict: CanonicalVerdictWeb): string {
  return VERDICT_LABELS[verdict] ?? verdict;
}

// ─────────────────────────────────────────────────────────────────────────────
// Color tokens  (tailwind class strings — dark / light mode)
// ─────────────────────────────────────────────────────────────────────────────

export type CanonicalVerdictColors = {
  bg: string;
  text: string;
  dot: string;
  barFill: string;
  border: string;
};

export function getCanonicalVerdictColors(
  verdict: CanonicalVerdictWeb,
  darkMode: boolean,
): CanonicalVerdictColors {
  switch (verdict) {
    case 'strong_yes':
      return {
        bg: darkMode ? 'bg-emerald-500/20 border-emerald-400/40' : 'bg-emerald-100 border-emerald-300',
        text: darkMode ? 'text-emerald-300' : 'text-emerald-800',
        dot: 'bg-emerald-500',
        barFill: 'bg-emerald-500',
        border: darkMode ? 'border-emerald-400/30' : 'border-emerald-300',
      };
    case 'yes':
      return {
        bg: darkMode ? 'bg-emerald-500/15 border-emerald-400/30' : 'bg-emerald-50 border-emerald-300',
        text: darkMode ? 'text-emerald-400' : 'text-emerald-700',
        dot: 'bg-emerald-500',
        barFill: 'bg-emerald-500',
        border: darkMode ? 'border-emerald-400/20' : 'border-emerald-200',
      };
    case 'watch':
      return {
        bg: darkMode ? 'bg-amber-500/15 border-amber-400/30' : 'bg-amber-50 border-amber-300',
        text: darkMode ? 'text-amber-400' : 'text-amber-700',
        dot: 'bg-amber-500',
        barFill: 'bg-amber-500',
        border: darkMode ? 'border-amber-400/30' : 'border-amber-300',
      };
    case 'pass':
      return {
        bg: darkMode ? 'bg-red-500/15 border-red-400/30' : 'bg-red-50 border-red-300',
        text: darkMode ? 'text-red-400' : 'text-red-600',
        dot: 'bg-red-500',
        barFill: 'bg-red-500',
        border: darkMode ? 'border-red-400/30' : 'border-red-300',
      };
    case 'strong_pass':
      return {
        bg: darkMode ? 'bg-red-500/20 border-red-400/40' : 'bg-red-100 border-red-300',
        text: darkMode ? 'text-red-300' : 'text-red-800',
        dot: 'bg-red-600',
        barFill: 'bg-red-600',
        border: darkMode ? 'border-red-400/40' : 'border-red-400',
      };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Mapping to legacy WorkspaceVerdict (4-band)
//
// Used by resolveWorkspaceVerdict.ts to bridge canonical → UI verdict.
//   strong_yes → FUND
//   yes        → FUND
//   watch      → CONSIDER
//   pass       → PASS
//   strong_pass → HARD_PASS
// ─────────────────────────────────────────────────────────────────────────────

export function mapCanonicalVerdictToWorkspace(verdict: CanonicalVerdictWeb): WorkspaceVerdict {
  switch (verdict) {
    case 'strong_yes':
    case 'yes':
      return 'FUND';
    case 'watch':
      return 'CONSIDER';
    case 'pass':
      return 'PASS';
    case 'strong_pass':
      return 'HARD_PASS';
  }
}
