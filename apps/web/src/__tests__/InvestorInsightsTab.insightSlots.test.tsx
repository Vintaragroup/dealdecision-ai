/**
 * Tests for the insight_slots section renderer in InvestorInsightsTab.
 *
 * Verifies that slot rows are parsed from the body text and rendered as a
 * table with correct slot names and status badges.
 */
import { render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import { InsightSlotsSection, InvestorInsightsTab } from '../components/workspace/InvestorInsightsTab';
import { apiGetInvestorInsights } from '../lib/apiClient';
import type { InvestorInsightsSection } from '../lib/apiClient';

vi.mock('../lib/apiClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/apiClient')>();
  return {
    ...actual,
    apiGetInvestorInsights: vi.fn(async () => ({ status: 'not_started' } as any)),
    apiGenerateInvestorInsights: vi.fn(async () => ({ ok: true })),
  };
});

function makeSection(body: string): InvestorInsightsSection {
  return { key: 'insight_slots', title: 'Insight Slots', kind: 'message', body } as InvestorInsightsSection;
}

// Report with a mix of Computable and NotComputable slot rows.
const INSIGHT_SLOTS_BODY = [
  'raise_terms: Computable | value="$2M SAFE" | evidence=dpu:doc:a1b2c3d4:page:3 | reason=none',
  'market_claims: NotComputable | value=none | evidence=none | reason=NO_MARKET_CLAIM_MENTION',
].join('\n');

const REPORT_WITH_SLOTS = {
  status: 'deterministic_only',
  render_package: {
    sections: [
      {
        key: 'insight_slots',
        title: 'Insight Slots',
        kind: 'message',
        body: INSIGHT_SLOTS_BODY,
      },
    ],
  },
} as any;

describe('InvestorInsightsTab – insight_slots section', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('renders both slot names from the body text', () => {
    render(<InsightSlotsSection section={makeSection(INSIGHT_SLOTS_BODY)} darkMode={false} />);

    // Both human-readable slot labels should appear in the table.
    screen.getByText('Raise Terms');
    screen.getByText('Market Claims');
  });

  test('Computable badge appears for the Computable slot', () => {
    render(<InsightSlotsSection section={makeSection(INSIGHT_SLOTS_BODY)} darkMode={false} />);

    screen.getByText('Raise Terms');

    // At least one "Computable" badge should be visible.
    expect(screen.getAllByText('Computable').length).toBeGreaterThanOrEqual(1);
  });

  test('NotComputable badge and reason code appear for the NotComputable slot', () => {
    render(<InsightSlotsSection section={makeSection(INSIGHT_SLOTS_BODY)} darkMode={false} />);

    screen.getByText('Market Claims');

    expect(screen.getByText('NotComputable')).toBeTruthy();
    expect(screen.getByText('NO_MARKET_CLAIM_MENTION')).toBeTruthy();
  });

  test('evidence ref is rendered as monospace pill for Computable slot', () => {
    render(<InsightSlotsSection section={makeSection(INSIGHT_SLOTS_BODY)} darkMode={false} />);

    screen.getByText('Raise Terms');

    expect(screen.getByText('dpu:doc:a1b2c3d4:page:3')).toBeTruthy();
  });

  test('value is displayed with quotes stripped for Computable slot', () => {
    render(<InsightSlotsSection section={makeSection(INSIGHT_SLOTS_BODY)} darkMode={false} />);

    screen.getByText('Raise Terms');

    // Surrounding quotes should be stripped: "$2M SAFE" → $2M SAFE
    expect(screen.getByText('$2M SAFE')).toBeTruthy();
  });

  test('value containing "/" (sanitized from "|") is rendered fully — pipe-in-value regression', () => {
    // Guard against the bug where a "|" inside the value (e.g. from Excel structured text
    // "Retention ratio | 60.00%") fractures the pipe-delimited line and the value is truncated.
    // The worker sanitizes "|" → "/" before persisting, so the body uses "/".
    const body = 'traction_signal: Computable | value="Retention ratio / 60.00%" | evidence=dpu:doc:58595eb2:page:1 | reason=none';

    render(<InsightSlotsSection section={makeSection(body)} darkMode={false} />);

    screen.getByText('Traction Signal');
    // Full value must appear (not truncated at the slash)
    expect(screen.getByText('Retention ratio / 60.00%')).toBeTruthy();
    // Evidence ref must also survive
    expect(screen.getByText('dpu:doc:58595eb2:page:1')).toBeTruthy();
  });

  // ── Regression: 3ICE — "raising approximately $10M" adverb fix ──────────────
  //
  // The worker's _RAISE_ADVERB fix lets processor.ts detect "raising approximately $10M".
  // This test verifies the UI correctly renders the unquoted value "raising approximately $10M"
  // and shows Computable status with the correct evidence ref.

  test('renders "raising approximately $10M" value — 3ICE real DPU reference (adverb regression)', () => {
    const body = [
      'raise_terms: Computable | value="raising approximately $10M" | evidence=dpu:doc:6af4720f:page:33 | reason=none',
      'market_claims: NotComputable | value=none | evidence=none | reason=NO_MARKET_CLAIM_MENTION',
    ].join('\n');

    render(<InsightSlotsSection section={makeSection(body)} darkMode={false} />);

    screen.getByText('Raise Terms');
    // Value must be displayed with surrounding quotes stripped.
    expect(screen.getByText('raising approximately $10M')).toBeTruthy();
    // Evidence ref must be present as a copyable pill.
    expect(screen.getByText('dpu:doc:6af4720f:page:33')).toBeTruthy();
    // Status badge must show Computable.
    expect(screen.getAllByText('Computable').length).toBeGreaterThanOrEqual(1);
    // Market Claims must be NotComputable — no false positives.
    expect(screen.getByText('Market Claims')).toBeTruthy();
  });
});

// ── Gate rendering from render_package.gate_state ─────────────────────────────
//
// BUG: The real API returns gate results at render_package.gate_state.results.
//      The gate_state section in sections[] intentionally has NO items.
//      Previously, GateStateSection read section.items → got [] → showed
//      "Gate data unavailable." instead of the actual gate table.
//
// FIX: InvestorInsightsTab now injects render_package.gate_state.results into
//      the gate_state section items before rendering, so GateStateSection always
//      has the right data.

describe('InvestorInsightsTab – gate rendering from render_package.gate_state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('renders G3 Fail from render_package.gate_state when gate_state section has no items — Carmoola regression', async () => {
    const REPORT_WITH_PKG_GATES = {
      status: 'deterministic_only',
      render_package: {
        // Source of truth for gates — real API shape.
        gate_state: {
          all_passed: false,
          results: [
            { gate: 'G0', passed: true },
            { gate: 'G1', passed: true },
            { gate: 'G2', passed: true },
            { gate: 'G3', passed: false, reason_code: 'GATE_STRUCTURED_JSON_UNREADABLE' },
            { gate: 'G4', passed: true },
            { gate: 'G5', passed: true },
          ],
        },
        sections: [
          {
            key: 'gate_state',
            title: 'Gate Evaluation',
            kind: 'gate_state',
            // No items — this is exactly how the real API responds.
          },
          {
            key: 'insight_slots',
            title: 'Insight Slots',
            kind: 'message',
            body: 'raise_terms: Computable | value="raising approximately $10M" | evidence=dpu:doc:6af4720f:page:33 | reason=none',
          },
        ],
      },
    } as any;

    vi.mocked(apiGetInvestorInsights).mockResolvedValue(REPORT_WITH_PKG_GATES);
    render(<InvestorInsightsTab darkMode={false} dealId="61ef36dd-391a-4a4e-b30b-1f5d1f19f91e" />);

    // Gate rows must be present from render_package.gate_state (not section.items).
    await screen.findByText('G3');
    expect(screen.getByText('GATE_STRUCTURED_JSON_UNREADABLE')).toBeTruthy();

    // G0 must show Pass (confirming multiple rows render, not just G3).
    expect(screen.getByText('G0')).toBeTruthy();

    // insight_slots is now in the Data tab — no longer rendered in InvestorInsightsTab.

    // Must NOT show the empty fallback text.
    expect(screen.queryByText(/gate data unavailable/i)).toBeNull();
  });

  test('gate section shows all-pass when render_package.gate_state.all_passed is true', async () => {
    const ALL_PASS_REPORT = {
      status: 'deterministic_only',
      render_package: {
        gate_state: {
          all_passed: true,
          results: [
            { gate: 'G0', passed: true },
            { gate: 'G1', passed: true },
            { gate: 'G2', passed: true },
            { gate: 'G3', passed: true },
            { gate: 'G4', passed: true },
            { gate: 'G5', passed: true },
          ],
        },
        sections: [
          {
            key: 'gate_state',
            title: 'Gate Evaluation',
            kind: 'gate_state',
            // No items — real API shape.
          },
        ],
      },
    } as any;

    vi.mocked(apiGetInvestorInsights).mockResolvedValue(ALL_PASS_REPORT);
    render(<InvestorInsightsTab darkMode={false} dealId="deal-all-pass" />);

    await screen.findByText('G0');

    // All 6 gates should be present.
    ['G0', 'G1', 'G2', 'G3', 'G4', 'G5'].forEach((gate) => {
      expect(screen.getByText(gate)).toBeTruthy();
    });

    // No reason codes — all passed.
    expect(screen.queryByText(/GATE_/)).toBeNull();

    // Must NOT show empty fallback.
    expect(screen.queryByText(/gate data unavailable/i)).toBeNull();
  });

  test('legacy test mocks with section.items still work when render_package.gate_state is absent', async () => {
    // Backward compat: test mocks that haven't been updated to use render_package.gate_state
    // should continue to work because the injection only happens when render_package.gate_state
    // is present.
    const LEGACY_MOCK = {
      status: 'failed',
      render_package: {
        // No gate_state at render_package level (legacy / test mock shape).
        sections: [
          {
            key: 'gate_state',
            title: 'Gate Evaluation',
            kind: 'gate_state',
            items: [{ gate: 'G1', passed: false, reason_code: 'GATE_DPU_MISSING' }],
          },
        ],
      },
    } as any;

    vi.mocked(apiGetInvestorInsights).mockResolvedValue(LEGACY_MOCK);
    render(<InvestorInsightsTab darkMode={false} dealId="deal-legacy" />);

    // section.items is preserved when render_package.gate_state is absent.
    await screen.findByText('G1');
    expect(screen.getByText('GATE_DPU_MISSING')).toBeTruthy();
    expect(screen.queryByText(/gate data unavailable/i)).toBeNull();
  });
});
