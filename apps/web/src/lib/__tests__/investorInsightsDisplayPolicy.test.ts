/**
 * investorInsightsDisplayPolicy.test.ts — unit tests for PR32.
 *
 * Table-driven coverage for all 5 prompt scenarios + edge cases.
 *
 *  Scenario 1: stale_dpu + active investor_insights run
 *              → shouldSuppressHardStaleDpu=true, backgroundRunningLabel unchanged
 *  Scenario 2: deterministic_only + failed evidence gate + no rerun
 *              → evidenceGateBannerMode='blocked', shouldShowRunAnalysisCta=false
 *  Scenario 3: deterministic_only + failed evidence gate + rerun active
 *              → evidenceGateBannerMode='auto_refreshing', backgroundRunningLabel overridden
 *  Scenario 4: report succeeded
 *              → shouldShowRunAnalysisCta=false, no blocked/refresh banner
 *  Scenario 5: latest report replaced by newer (terminal-success report)
 *              → isBlockedByEvidenceGate=false, shouldShowRunAnalysisCta=false
 */

import { describe, expect, test } from 'vitest';
import { deriveInsightsDisplayState } from '../investorInsightsDisplayPolicy';
import type { InsightsDisplayInput } from '../investorInsightsDisplayPolicy';

// ─── helpers ──────────────────────────────────────────────────────────────────

const GATE_FAILED = { passed: false, blocking_reason: 'EVIDENCE_GATE_LOW_COVERAGE' } as const;
const GATE_PASSED = { passed: true,  blocking_reason: null } as const;

function make(overrides: Partial<InsightsDisplayInput> = {}): InsightsDisplayInput {
  return {
    reportStatus: 'deterministic_only',
    evidenceGate: GATE_FAILED,
    isRunning: false,
    isStaleDpu: false,
    ...overrides,
  };
}

// ─── Scenario 1: stale_dpu + active run ───────────────────────────────────────
describe('Scenario 1 — stale_dpu + active investor_insights run', () => {
  test('shouldSuppressHardStaleDpu=true when isRunning && isStaleDpu', () => {
    const s = deriveInsightsDisplayState(make({ isRunning: true, isStaleDpu: true }));
    expect(s.shouldSuppressHardStaleDpu).toBe(true);
  });

  test('shouldSuppressHardStaleDpu=false when not running', () => {
    const s = deriveInsightsDisplayState(make({ isRunning: false, isStaleDpu: true }));
    expect(s.shouldSuppressHardStaleDpu).toBe(false);
  });

  test('shouldSuppressHardStaleDpu=false when running but not stale', () => {
    const s = deriveInsightsDisplayState(make({ isRunning: true, isStaleDpu: false }));
    expect(s.shouldSuppressHardStaleDpu).toBe(false);
  });
});

// ─── Scenario 2: deterministic_only + failed evidence gate + no rerun ─────────
describe('Scenario 2 — deterministic_only + failed gate + not running', () => {
  const s = deriveInsightsDisplayState(make({ isRunning: false }));

  test('isBlockedByEvidenceGate=true', () => {
    expect(s.isBlockedByEvidenceGate).toBe(true);
  });

  test('evidenceGateBannerMode=blocked', () => {
    expect(s.evidenceGateBannerMode).toBe('blocked');
  });

  test('isAutoRerunInFlight=false', () => {
    expect(s.isAutoRerunInFlight).toBe(false);
  });

  test('shouldShowRunAnalysisCta=false (report is deterministic_only, not null/failed/quarantined)', () => {
    // deterministic_only is NOT in the CTA trigger list — insights already produced
    expect(s.shouldShowRunAnalysisCta).toBe(false);
  });

  test('backgroundRunningLabel is generic (nothing running)', () => {
    expect(s.backgroundRunningLabel).toBe('Analysis running — checking for updates…');
  });

  test('reportStatusLabel is human-readable', () => {
    expect(s.reportStatusLabel).toBe('Deterministic only');
  });
});

// ─── Scenario 3: deterministic_only + failed gate + rerun active ───────────────
describe('Scenario 3 — deterministic_only + failed gate + rerun in flight', () => {
  const s = deriveInsightsDisplayState(make({ isRunning: true }));

  test('isAutoRerunInFlight=true', () => {
    expect(s.isAutoRerunInFlight).toBe(true);
  });

  test('isRefreshingAfterOcr=true (alias of isAutoRerunInFlight)', () => {
    expect(s.isRefreshingAfterOcr).toBe(true);
  });

  test('evidenceGateBannerMode=auto_refreshing', () => {
    expect(s.evidenceGateBannerMode).toBe('auto_refreshing');
  });

  test('backgroundRunningLabel overridden to OCR-specific copy', () => {
    expect(s.backgroundRunningLabel).toBe(
      'Auto-refreshing after OCR improvement — checking for updates…',
    );
  });

  test('shouldSuppressHardStaleDpu=false when isStaleDpu not provided', () => {
    expect(s.shouldSuppressHardStaleDpu).toBe(false);
  });

  test('shouldSuppressHardStaleDpu=true when isStaleDpu also true', () => {
    const s2 = deriveInsightsDisplayState(make({ isRunning: true, isStaleDpu: true }));
    expect(s2.shouldSuppressHardStaleDpu).toBe(true);
  });
});

// ─── Scenario 4: succeeded latest report ──────────────────────────────────────
describe('Scenario 4 — succeeded/complete report', () => {
  test('shouldShowRunAnalysisCta=false for complete', () => {
    const s = deriveInsightsDisplayState(make({ reportStatus: 'complete', evidenceGate: GATE_PASSED }));
    expect(s.shouldShowRunAnalysisCta).toBe(false);
  });

  test('shouldShowRunAnalysisCta=false for succeeded', () => {
    const s = deriveInsightsDisplayState(make({ reportStatus: 'succeeded', evidenceGate: GATE_PASSED }));
    expect(s.shouldShowRunAnalysisCta).toBe(false);
  });

  test('evidenceGateBannerMode=hidden when gate passed', () => {
    const s = deriveInsightsDisplayState(make({ reportStatus: 'complete', evidenceGate: GATE_PASSED }));
    expect(s.evidenceGateBannerMode).toBe('hidden');
  });

  test('isBlockedByEvidenceGate=false for succeeded', () => {
    const s = deriveInsightsDisplayState(make({ reportStatus: 'succeeded', evidenceGate: GATE_PASSED }));
    expect(s.isBlockedByEvidenceGate).toBe(false);
  });

  test('reportStatusLabel for complete is "Complete"', () => {
    const s = deriveInsightsDisplayState(make({ reportStatus: 'complete', evidenceGate: GATE_PASSED }));
    expect(s.reportStatusLabel).toBe('Complete');
  });

  test('reportStatusLabel for succeeded is "Complete"', () => {
    const s = deriveInsightsDisplayState(make({ reportStatus: 'succeeded', evidenceGate: GATE_PASSED }));
    expect(s.reportStatusLabel).toBe('Complete');
  });
});

// ─── Scenario 5: latest report replaced by newer (newer report in terminal-success state) ───
describe('Scenario 5 — newer succeeded report replaces old deterministic_only', () => {
  // Simulates the state AFTER the auto-rerun completes and produces a succeeded report.
  const s = deriveInsightsDisplayState({
    reportStatus: 'succeeded',
    evidenceGate: GATE_PASSED,
    isRunning: false,
  });

  test('isBlockedByEvidenceGate=false', () => {
    expect(s.isBlockedByEvidenceGate).toBe(false);
  });

  test('isAutoRerunInFlight=false', () => {
    expect(s.isAutoRerunInFlight).toBe(false);
  });

  test('evidenceGateBannerMode=hidden', () => {
    expect(s.evidenceGateBannerMode).toBe('hidden');
  });

  test('shouldShowRunAnalysisCta=false', () => {
    expect(s.shouldShowRunAnalysisCta).toBe(false);
  });
});

// ─── Edge cases ───────────────────────────────────────────────────────────────
describe('Edge cases', () => {
  test('null evidenceGate → isBlockedByEvidenceGate=false even for deterministic_only', () => {
    const s = deriveInsightsDisplayState(make({ evidenceGate: null }));
    expect(s.isBlockedByEvidenceGate).toBe(false);
    expect(s.evidenceGateBannerMode).toBe('hidden');
  });

  test('null reportStatus → shouldShowRunAnalysisCta=true (nothing started yet)', () => {
    const s = deriveInsightsDisplayState({
      reportStatus: null,
      evidenceGate: null,
      isRunning: false,
    });
    expect(s.shouldShowRunAnalysisCta).toBe(true);
  });

  test('not_started → shouldShowRunAnalysisCta=true', () => {
    const s = deriveInsightsDisplayState({
      reportStatus: 'not_started',
      evidenceGate: null,
      isRunning: false,
    });
    expect(s.shouldShowRunAnalysisCta).toBe(true);
  });

  test('failed report → shouldShowRunAnalysisCta=true', () => {
    const s = deriveInsightsDisplayState({
      reportStatus: 'failed',
      evidenceGate: null,
      isRunning: false,
    });
    expect(s.shouldShowRunAnalysisCta).toBe(true);
  });

  test('failed report + isRunning → shouldShowRunAnalysisCta=false (job already in flight)', () => {
    const s = deriveInsightsDisplayState({
      reportStatus: 'failed',
      evidenceGate: null,
      isRunning: true,
    });
    expect(s.shouldShowRunAnalysisCta).toBe(false);
  });

  test('report running (not deterministic_only) → evidenceGateBannerMode=hidden', () => {
    const s = deriveInsightsDisplayState({
      reportStatus: 'running',
      evidenceGate: GATE_FAILED,
      isRunning: true,
    });
    // Gate failed but report isn't deterministic_only — no blocked banner
    expect(s.evidenceGateBannerMode).toBe('hidden');
    expect(s.isBlockedByEvidenceGate).toBe(false);
  });

  test('isStaleDpu defaults to false when omitted', () => {
    const s = deriveInsightsDisplayState({
      reportStatus: 'not_started',
      evidenceGate: null,
      isRunning: true,
      // isStaleDpu not passed
    });
    expect(s.shouldSuppressHardStaleDpu).toBe(false);
  });

  test('unknown reportStatus → label falls back to the raw string', () => {
    const s = deriveInsightsDisplayState({ reportStatus: 'exotic_status', evidenceGate: null, isRunning: false });
    expect(s.reportStatusLabel).toBe('exotic_status');
  });

  test('null reportStatus → label is "Unknown"', () => {
    const s = deriveInsightsDisplayState({ reportStatus: null, evidenceGate: null, isRunning: false });
    expect(s.reportStatusLabel).toBe('Unknown');
  });

  test('backgroundRunningLabel is generic when not auto-rerun', () => {
    const s = deriveInsightsDisplayState({
      reportStatus: 'running',
      evidenceGate: null,
      isRunning: true,
    });
    expect(s.backgroundRunningLabel).toBe('Analysis running — checking for updates…');
  });

  test('deterministic_only + gate passed → evidenceGateBannerMode=hidden', () => {
    const s = deriveInsightsDisplayState(make({ evidenceGate: GATE_PASSED, isRunning: false }));
    expect(s.evidenceGateBannerMode).toBe('hidden');
    expect(s.isBlockedByEvidenceGate).toBe(false);
  });

  test('quarantined report → shouldShowRunAnalysisCta=true', () => {
    const s = deriveInsightsDisplayState({
      reportStatus: 'quarantined',
      evidenceGate: null,
      isRunning: false,
    });
    expect(s.shouldShowRunAnalysisCta).toBe(true);
  });
});

// ─── Phase 2: first-pass label ────────────────────────────────────────────────
describe('Phase 2 — isFirstPassResult banner label', () => {
  test('backgroundRunningLabel shows "Quick preview" copy when isFirstPassResult=true', () => {
    const s = deriveInsightsDisplayState({
      reportStatus: 'succeeded',
      evidenceGate: null,
      isRunning: false,
      isFirstPassResult: true,
    });
    expect(s.backgroundRunningLabel).toBe(
      'Quick preview — extracting remaining pages and running full analysis…'
    );
  });

  test('backgroundRunningLabel is generic when isFirstPassResult=false (default)', () => {
    const s = deriveInsightsDisplayState({
      reportStatus: 'running',
      evidenceGate: null,
      isRunning: true,
      isFirstPassResult: false,
    });
    expect(s.backgroundRunningLabel).toBe('Analysis running — checking for updates…');
  });

  test('auto-rerun label takes precedence over first-pass label', () => {
    // isAutoRerunInFlight = true (running + deterministic_only + gate failed)
    const s = deriveInsightsDisplayState(make({ isRunning: true, isFirstPassResult: true }));
    expect(s.backgroundRunningLabel).toBe(
      'Auto-refreshing after OCR improvement — checking for updates…'
    );
  });
});
