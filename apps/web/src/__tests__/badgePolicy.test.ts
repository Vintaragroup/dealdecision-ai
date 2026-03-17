import { describe, it, expect } from 'vitest';
import {
  deriveGatingState,
  shouldSuppressNeedsReview,
  shouldSuppressNoCitation,
  getGatedLabel,
  type BadgePolicyGatingState,
} from '../lib/badgePolicy';

// ── deriveGatingState ─────────────────────────────────────────────────────────

describe('badgePolicy — deriveGatingState', () => {
  it('sets isDeterministicOnly=true for "deterministic_only" status', () => {
    const g = deriveGatingState({ reportStatus: 'deterministic_only' });
    expect(g.isDeterministicOnly).toBe(true);
  });

  it.each([
    'succeeded', 'ready', 'running', 'not_started', 'failed', undefined, null,
  ] as const)('sets isDeterministicOnly=false for status=%s', (status) => {
    const g = deriveGatingState({ reportStatus: status });
    expect(g.isDeterministicOnly).toBe(false);
  });

  it('extracts evidenceGatePassed: true', () => {
    const g = deriveGatingState({
      reportStatus: 'deterministic_only',
      evidenceGate: { passed: true, blocking_reason: null },
    });
    expect(g.evidenceGatePassed).toBe(true);
  });

  it('extracts evidenceGatePassed: false', () => {
    const g = deriveGatingState({
      reportStatus: 'deterministic_only',
      evidenceGate: { passed: false, blocking_reason: 'EVIDENCE_GATE_LOW_COVERAGE' },
    });
    expect(g.evidenceGatePassed).toBe(false);
  });

  it('sets evidenceGatePassed=null when evidenceGate is null', () => {
    const g = deriveGatingState({ reportStatus: 'deterministic_only', evidenceGate: null });
    expect(g.evidenceGatePassed).toBeNull();
  });

  it('sets evidenceGatePassed=null when evidenceGate is omitted', () => {
    const g = deriveGatingState({ reportStatus: 'deterministic_only' });
    expect(g.evidenceGatePassed).toBeNull();
  });
});

// ── shouldSuppressNeedsReview ─────────────────────────────────────────────────

describe('badgePolicy — shouldSuppressNeedsReview', () => {
  const table: Array<{
    desc: string;
    gating: BadgePolicyGatingState;
    expected: boolean;
  }> = [
    // ── suppress cases ──────────────────────────────────────────────────────
    {
      desc: 'deterministic_only + gate failed → SUPPRESS (LLM never ran)',
      gating: { isDeterministicOnly: true, evidenceGatePassed: false },
      expected: true,
    },
    {
      desc: 'deterministic_only + gate absent (null / old engine) → SUPPRESS',
      gating: { isDeterministicOnly: true, evidenceGatePassed: null },
      expected: true,
    },

    // ── keep cases ──────────────────────────────────────────────────────────
    {
      desc: 'deterministic_only + gate PASSED → KEEP (LLM ran, may genuinely need review)',
      gating: { isDeterministicOnly: true, evidenceGatePassed: true },
      expected: false,
    },
    {
      desc: 'not deterministic_only + gate failed → KEEP',
      gating: { isDeterministicOnly: false, evidenceGatePassed: false },
      expected: false,
    },
    {
      desc: 'not deterministic_only + gate passed → KEEP',
      gating: { isDeterministicOnly: false, evidenceGatePassed: true },
      expected: false,
    },
    {
      desc: 'not deterministic_only + gate absent → KEEP',
      gating: { isDeterministicOnly: false, evidenceGatePassed: null },
      expected: false,
    },
  ];

  for (const { desc, gating, expected } of table) {
    it(desc, () => {
      expect(shouldSuppressNeedsReview(gating)).toBe(expected);
    });
  }
});

// ── shouldSuppressNoCitation ──────────────────────────────────────────────────

describe('badgePolicy — shouldSuppressNoCitation', () => {
  const table: Array<{
    desc: string;
    gating: BadgePolicyGatingState;
    expected: boolean;
  }> = [
    {
      desc: 'deterministic_only + gate failed → SUPPRESS (no citation search ran)',
      gating: { isDeterministicOnly: true, evidenceGatePassed: false },
      expected: true,
    },
    {
      desc: 'deterministic_only + gate passed → SUPPRESS (deterministic output, no evidence-blob citations)',
      gating: { isDeterministicOnly: true, evidenceGatePassed: true },
      expected: true,
    },
    {
      desc: 'deterministic_only + gate absent → SUPPRESS',
      gating: { isDeterministicOnly: true, evidenceGatePassed: null },
      expected: true,
    },
    {
      desc: 'succeeded (not deterministic_only) + gate passed → KEEP',
      gating: { isDeterministicOnly: false, evidenceGatePassed: true },
      expected: false,
    },
    {
      desc: 'not_started (not deterministic_only) + gate absent → KEEP',
      gating: { isDeterministicOnly: false, evidenceGatePassed: null },
      expected: false,
    },
  ];

  for (const { desc, gating, expected } of table) {
    it(desc, () => {
      expect(shouldSuppressNoCitation(gating)).toBe(expected);
    });
  }
});

// ── getGatedLabel ─────────────────────────────────────────────────────────────

describe('badgePolicy — getGatedLabel', () => {
  it('returns "Not generated (gated)" when deterministic_only + gate failed', () => {
    const label = getGatedLabel({ isDeterministicOnly: true, evidenceGatePassed: false });
    expect(label).toBe('Not generated (gated)');
  });

  it('returns null when deterministic_only + gate passed (LLM ran; different label applies)', () => {
    expect(getGatedLabel({ isDeterministicOnly: true, evidenceGatePassed: true })).toBeNull();
  });

  it('returns null when deterministic_only + gate absent (old engine; state unknown, no label)', () => {
    expect(getGatedLabel({ isDeterministicOnly: true, evidenceGatePassed: null })).toBeNull();
  });

  it('returns null when not deterministic_only + gate failed', () => {
    expect(getGatedLabel({ isDeterministicOnly: false, evidenceGatePassed: false })).toBeNull();
  });

  it('returns null when not deterministic_only + gate absent', () => {
    expect(getGatedLabel({ isDeterministicOnly: false, evidenceGatePassed: null })).toBeNull();
  });
});
