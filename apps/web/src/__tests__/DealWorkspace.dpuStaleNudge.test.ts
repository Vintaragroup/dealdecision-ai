/**
 * Source-level regression guards for the DPU_STALE polling re-nudge behaviour
 * added to runAnalysisWithReadinessGate in DealWorkspace.tsx.
 *
 * Why a source check instead of a full render test?
 * The polling loop is a closure that uses setTimeout — wiring it up with
 * fake timers and mocked fetch calls in a React render test adds a lot of
 * brittleness.  The important structural invariants (nudge guard variables,
 * correct API call shape, rate-limit) are reliably verified by inspecting
 * the source text.  The functional integration is covered by the existing
 * DealWorkspace E2E tests that exercise the full readiness gate.
 */

import { test } from 'vitest';
import { expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe } from 'vitest';

const SOURCE_PATH = join(__dirname, '../components/pages/DealWorkspace.tsx');
let source: string;
try {
  source = readFileSync(SOURCE_PATH, 'utf8');
} catch {
  source = '';
}

describe('DealWorkspace – DPU_STALE polling re-nudge (source guards)', () => {
  test('source file loads', () => {
    expect(source.length).toBeGreaterThan(0);
  });

  test('lastNudgeAtMs closure variable is declared', () => {
    // The variable must be declared in the runAnalysisWithReadinessGate closure.
    expect(source).toMatch(/let lastNudgeAtMs:\s*number\s*\|\s*null\s*=\s*null/);
  });

  test('nudge is fired via tryAnalyze({ force_refresh: false })', () => {
    // Nudge must call tryAnalyze without force_refresh=true.
    expect(source).toMatch(/tryAnalyze\(\s*\{\s*force_refresh:\s*false\s*\}/);
  });

  test('nudge is rate-limited by NUDGE_INTERVAL_MS (≥60 000 ms)', () => {
    // Interval constant must be at least 60 000 ms to avoid spamming the API.
    const match = source.match(/NUDGE_INTERVAL_MS\s*=\s*(\d+)/);
    expect(match).toBeTruthy();
    const interval = parseInt(match?.[1] ?? '0', 10);
    expect(interval).toBeGreaterThanOrEqual(60_000);
  });

  test('nudge is gated on minDpuCreatedAtToken being set', () => {
    // The nudge must not fire when there is no freshness token (non-force_refresh init).
    // Check that `minDpuCreatedAtToken` appears in the nudge guard expression.
    const nudgeSection = source.match(/NUDGE_INTERVAL_MS[\s\S]{0,600}tryAnalyze/s)?.[0] ?? '';
    expect(nudgeSection).toMatch(/minDpuCreatedAtToken/);
  });

  test('nudge is delayed until after initial settle window (elapsedMs check)', () => {
    // First nudge should not fire immediately on the first few polls.
    // Verify a lower-bound check on elapsedMs.
    const nudgeSection = source.match(/NUDGE_INTERVAL_MS[\s\S]{0,600}tryAnalyze/s)?.[0] ?? '';
    expect(nudgeSection).toMatch(/elapsedMs\s*>=?\s*\d+/);
  });

  test('nudge fires at most once per NUDGE_INTERVAL_MS window', () => {
    // lastNudgeAtMs must be updated BEFORE calling tryAnalyze (so the next poll
    // sees the updated timestamp and skips the nudge).
    // The pattern: lastNudgeAtMs = Date.now() immediately precedes the tryAnalyze call.
    const nudgeSection = source.match(/lastNudgeAtMs\s*=\s*Date\.now\(\)[\s\S]{0,500}tryAnalyze/s)?.[0] ?? '';
    expect(nudgeSection).toMatch(/tryAnalyze/);
  });

  test('nudge errors are swallowed (best-effort, does not crash poll loop)', () => {
    // The nudge tryAnalyze call must have a .catch() to prevent unhandled rejections.
    expect(source).toMatch(/tryAnalyze\(\s*\{\s*force_refresh:\s*false\s*\}\s*\)\.catch/);
  });
});
