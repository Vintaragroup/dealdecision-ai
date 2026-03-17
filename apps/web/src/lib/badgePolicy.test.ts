/**
 * badgePolicy — unit tests for computeSlotChipPolicy (PR23).
 *
 * The four cases below cover the chip policy for an Overview slot:
 *
 *   1. Gate failed + slot empty          → "Not generated (gated)" visible
 *   2. Gate failed + PR22 deterministic  → gated chip suppressed, det chip shown
 *   3. Gate passed + governed overlay    → standard governed chip, no gated chip
 *   4. Gate passed + authoritative det   → deterministic chip, no gated chip
 */

import { describe, expect, test } from 'vitest';

import {
  computeSlotChipPolicy,
  deriveGatingState,
  type BadgePolicyGatingState,
} from './badgePolicy';

// ── helpers ───────────────────────────────────────────────────────────────────

const gatingGateFailed: BadgePolicyGatingState = {
  isDeterministicOnly: true,
  evidenceGatePassed: false,
};

const gatingGatePassed: BadgePolicyGatingState = {
  isDeterministicOnly: true,
  evidenceGatePassed: true,
};

// ── tests ─────────────────────────────────────────────────────────────────────

describe('computeSlotChipPolicy', () => {
  test('case 1 — gate failed + slot empty → shows gated chip, not needs-review', () => {
    const result = computeSlotChipPolicy({
      gating: gatingGateFailed,
      source: 'missing',
    });

    expect(result.showGatedChip).toBe(true);
    expect(result.gatedLabel).toBe('Not generated (gated)');
    expect(result.showNeedsReview).toBe(false);
  });

  test('case 2 — gate failed + PR22 deterministic fallback value → gated chip suppressed', () => {
    // This is the PR23 fix: even though the gate failed, the PR22 deterministic
    // fallback populated the slot. "Not generated (gated)" would be incorrect.
    const result = computeSlotChipPolicy({
      gating: gatingGateFailed,
      source: 'deterministic',
    });

    expect(result.showGatedChip).toBe(false);
    expect(result.gatedLabel).toBe('Not generated (gated)'); // label computed, but NOT shown
    expect(result.showNeedsReview).toBe(false);
  });

  test('case 3 — gate passed + governed overlay → governed chip, no gated chip', () => {
    const result = computeSlotChipPolicy({
      gating: gatingGatePassed,
      source: 'governed',
      needsReview: false,
    });

    expect(result.showGatedChip).toBe(false);
    expect(result.gatedLabel).toBeNull(); // gate passed → no gated label at all
    expect(result.showNeedsReview).toBe(false);
  });

  test('case 3b — gate passed + governed overlay + needs-review → needs-review chip shown', () => {
    const result = computeSlotChipPolicy({
      gating: gatingGatePassed,
      source: 'governed',
      needsReview: true,
    });

    expect(result.showNeedsReview).toBe(true);
    expect(result.showGatedChip).toBe(false);
    expect(result.gatedLabel).toBeNull();
  });

  test('case 4 — gate passed + authoritative deterministic → deterministic chip, no gated chip', () => {
    const result = computeSlotChipPolicy({
      gating: gatingGatePassed,
      source: 'deterministic',
    });

    expect(result.showGatedChip).toBe(false);
    expect(result.gatedLabel).toBeNull();
    expect(result.showNeedsReview).toBe(false);
  });

  test('gate failed + governed source (edge) → governed chip wins, gated chip suppressed', () => {
    // If the gate failed but a governed value somehow exists in the slot,
    // the slot has real content — suppress the gated chip.
    const result = computeSlotChipPolicy({
      gating: gatingGateFailed,
      source: 'governed',
    });

    expect(result.showGatedChip).toBe(false);
    expect(result.gatedLabel).toBe('Not generated (gated)'); // computed, not shown
    expect(result.showNeedsReview).toBe(false);
  });

  test('gate absent (null) → no gated chip regardless of source', () => {
    const gatingGateAbsent = deriveGatingState({
      reportStatus: 'deterministic_only',
      evidenceGate: null,
    });
    // evidenceGatePassed === null → getGatedLabel returns null
    const result = computeSlotChipPolicy({
      gating: gatingGateAbsent,
      source: 'missing',
    });

    expect(result.gatedLabel).toBeNull();
    expect(result.showGatedChip).toBe(false);
  });
});
