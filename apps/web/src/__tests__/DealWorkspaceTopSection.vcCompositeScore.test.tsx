/**
 * DealWorkspaceTopSection — VC Composite Score circle swap tests.
 *
 * Contract:
 *   1. When vcScoringV2 is absent, the circle shows the legacy evidence score.
 *   2. When vcScoringV2 is present, the circle shows vc_composite_score.
 *   3. When vcScoringV2 is present, the label below the circle shows the posture label.
 *   4. When vcScoringV2 is present, the caption reads "VC Composite Score".
 *   5. When vcScoringV2 is present, the demoted evidence score secondary line is visible.
 */
import { render, screen, within } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';
import { DealWorkspaceHeader } from '../components/workspace/DealWorkspaceTopSection';

// ─── Minimal prop fixture ─────────────────────────────────────────────────────

const BASE_PROPS = {
  darkMode: false,
  dealName: 'AcmeCo',
  dealDescription: 'AI-powered widget platform',
  stage: 'Series A',
  raiseAmount: '$5M',
  industry: 'SaaS',
  score: 65,
  verdict: 'CONSIDER' as const,
  primaryIssues: [],
  blockers: 0,
  concerns: 1,
  strengths: 2,
  metrics: { financials: [], traction: [], deal: [], businessModel: [] },
  onRefreshInsights: () => undefined,
  onUploadDocument: () => undefined,
  onMoreActions: () => undefined,
  analyzing: false,
  isFounder: false,
};

const VC_V2_INVESTIGATE = {
  opportunity_score: 68,
  confidence_score: 72,
  risk_score: 34,
  vc_composite_score: 73,
  investment_posture: 'INVESTIGATE' as const,
  reasoning: ['Market signal present.'],
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('DealWorkspaceTopSection — VC composite score circle swap', () => {
  it('1. without vcScoringV2: circle shows legacy evidence score (65)', () => {
    render(<DealWorkspaceHeader {...BASE_PROPS} vcScoringV2={null} />);
    const chart = screen.getByTestId('radial-score-chart');
    expect(within(chart).getAllByText(/^65$/).length).toBeGreaterThan(0);
  });

  it('2. with vcScoringV2: circle shows vc_composite_score (73), not legacy score (65)', () => {
    render(<DealWorkspaceHeader {...BASE_PROPS} vcScoringV2={VC_V2_INVESTIGATE} />);
    const chart = screen.getByTestId('radial-score-chart');
    expect(within(chart).getAllByText(/^73$/).length).toBeGreaterThan(0);
    expect(within(chart).queryByText(/^65$/)).toBeNull();
  });

  it('3. with vcScoringV2 INVESTIGATE: label below circle shows "Investigate"', () => {
    render(<DealWorkspaceHeader {...BASE_PROPS} vcScoringV2={VC_V2_INVESTIGATE} />);
    // The posture label appears (may appear in both the circle label and LAYER 2b badge)
    expect(screen.getAllByText('Investigate').length).toBeGreaterThan(0);
  });

  it('4. with vcScoringV2: caption reads "VC Composite Score"', () => {
    render(<DealWorkspaceHeader {...BASE_PROPS} vcScoringV2={VC_V2_INVESTIGATE} />);
    expect(screen.getByText('VC Composite Score')).toBeInTheDocument();
    expect(screen.queryByText('Evidence Score')).toBeNull();
  });

  it('5. with vcScoringV2: demoted evidence secondary shows legacy score (65)', () => {
    render(<DealWorkspaceHeader {...BASE_PROPS} vcScoringV2={VC_V2_INVESTIGATE} />);
    const secondary = screen.getByTestId('evidence-score-secondary');
    expect(secondary.textContent).toContain('65');
  });

  it('5b. without vcScoringV2: "Evidence Score" caption shown, no secondary line', () => {
    render(<DealWorkspaceHeader {...BASE_PROPS} vcScoringV2={null} />);
    expect(screen.getByText('Evidence Score')).toBeInTheDocument();
    expect(screen.queryByTestId('evidence-score-secondary')).toBeNull();
  });

  it('posture INVESTABLE: label shows "Investable" and circle shows composite score (88)', () => {
    render(
      <DealWorkspaceHeader
        {...BASE_PROPS}
        vcScoringV2={{ ...VC_V2_INVESTIGATE, investment_posture: 'INVESTABLE', vc_composite_score: 88 }}
      />
    );
    expect(screen.getAllByText('Investable').length).toBeGreaterThan(0);
    const chart = screen.getByTestId('radial-score-chart');
    expect(within(chart).getAllByText(/^88$/).length).toBeGreaterThan(0);
  });
});
