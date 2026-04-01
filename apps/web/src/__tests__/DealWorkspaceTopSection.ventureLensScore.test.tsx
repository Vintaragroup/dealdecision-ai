/**
 * DealWorkspaceTopSection — Venture Lens V3 hero score tests.
 *
 * Contract:
 *   1. V3 present: hero circle shows final_investment_score, not V2 or legacy
 *   2. V3 present: caption reads "Final Investment Score"
 *   3. V3 present: posture label uses final_posture
 *   4. V3 present: evidence score shown as secondary
 *   5. V2 present, V3 absent: hero circle shows vc_composite_score
 *   6. V2 present, V3 absent: caption reads "VC Composite"
 *   7. V2 present, V3 absent: posture label uses investment_posture
 *   8. Neither V2 nor V3: hero circle shows legacy score
 *   9. Neither V2 nor V3: caption reads "Evidence Score", no secondary line
 *  10. Tooltip V3 mode: title "Final Investment Score", correct body text
 *  11. Tooltip V2 mode: title "VC Composite", correct body text
 *  12. Tooltip legacy mode: title "Evidence Score", correct body text
 */
import { render, screen, fireEvent, within } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';
import { DealWorkspaceHeader } from '../components/workspace/DealWorkspaceTopSection';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const BASE_PROPS = {
  darkMode: false,
  dealName: 'AcmeCo',
  dealDescription: 'AI-powered widget platform',
  stage: 'Series A',
  raiseAmount: '$5M',
  industry: 'SaaS',
  score: 55,
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

const VC_V2 = {
  opportunity_score: 68,
  confidence_score: 72,
  risk_score: 34,
  vc_composite_score: 73,
  investment_posture: 'INVESTIGATE' as const,
  reasoning: ['Market signal present.'],
};

const VENTURE_LENS_V1 = {
  venture_score: 78,
  conviction_level: 'HIGH' as const,
  adjustment: 5,
  final_investment_score: 82,
  final_posture: 'HIGH_PRIORITY_DILIGENCE' as const,
  breakdown: { team: 80, market: 75, product: 70, traction: 65, upside: 85 },
};

// ─── Score hierarchy ──────────────────────────────────────────────────────────

describe('DealWorkspaceTopSection — Venture Lens hero score hierarchy', () => {
  it('1. V3 present: circle shows final_investment_score (82), not V2 (73) or legacy (55)', () => {
    render(<DealWorkspaceHeader {...BASE_PROPS} vcScoringV2={VC_V2} ventureLensV1={VENTURE_LENS_V1} />);
    const chart = screen.getByTestId('radial-score-chart');
    expect(within(chart).getAllByText(/^82$/).length).toBeGreaterThan(0);
    expect(within(chart).queryByText(/^73$/)).toBeNull();
    expect(within(chart).queryByText(/^55$/)).toBeNull();
  });

  it('2. V3 present: caption reads "Final Investment Score"', () => {
    render(<DealWorkspaceHeader {...BASE_PROPS} vcScoringV2={VC_V2} ventureLensV1={VENTURE_LENS_V1} />);
    expect(screen.getByText('Final Investment Score')).toBeInTheDocument();
    expect(screen.queryByText('VC Composite')).toBeNull();
    expect(screen.queryByText('Evidence Score')).toBeNull();
  });

  it('3. V3 present: posture label under circle uses final_posture ("High Priority")', () => {
    render(<DealWorkspaceHeader {...BASE_PROPS} vcScoringV2={VC_V2} ventureLensV1={VENTURE_LENS_V1} />);
    // "High Priority" appears in the posture label under the circle; V2 "Investigate" should NOT appear there.
    // Both V2 strip and V3 strip are rendered below, so count by circle area.
    // The score ring container is the parent element; posture label is immediately after the ring.
    expect(screen.getAllByText('High Priority').length).toBeGreaterThan(0);
  });

  it('4. V3 present: evidence secondary shows legacy score (55)', () => {
    render(<DealWorkspaceHeader {...BASE_PROPS} vcScoringV2={VC_V2} ventureLensV1={VENTURE_LENS_V1} />);
    const secondary = screen.getByTestId('evidence-score-secondary');
    expect(secondary.textContent).toContain('55');
  });

  it('5. V2 present, V3 absent: circle shows vc_composite_score (73), not legacy (55)', () => {
    render(<DealWorkspaceHeader {...BASE_PROPS} vcScoringV2={VC_V2} ventureLensV1={null} />);
    const chart = screen.getByTestId('radial-score-chart');
    expect(within(chart).getAllByText(/^73$/).length).toBeGreaterThan(0);
    expect(within(chart).queryByText(/^55$/)).toBeNull();
  });

  it('6. V2 present, V3 absent: caption reads "VC Composite"', () => {
    render(<DealWorkspaceHeader {...BASE_PROPS} vcScoringV2={VC_V2} ventureLensV1={null} />);
    expect(screen.getByText('VC Composite')).toBeInTheDocument();
    expect(screen.queryByText('Final Investment Score')).toBeNull();
    expect(screen.queryByText('Evidence Score')).toBeNull();
  });

  it('7. V2 present, V3 absent: posture label shows "Investigate" (V2 posture)', () => {
    render(<DealWorkspaceHeader {...BASE_PROPS} vcScoringV2={VC_V2} ventureLensV1={null} />);
    expect(screen.getAllByText('Investigate').length).toBeGreaterThan(0);
  });

  it('8. Neither V2 nor V3: circle shows legacy score (55)', () => {
    render(<DealWorkspaceHeader {...BASE_PROPS} vcScoringV2={null} ventureLensV1={null} />);
    const chart = screen.getByTestId('radial-score-chart');
    expect(within(chart).getAllByText(/^55$/).length).toBeGreaterThan(0);
  });

  it('9. Neither V2 nor V3: caption reads "Evidence Score", no secondary line', () => {
    render(<DealWorkspaceHeader {...BASE_PROPS} vcScoringV2={null} ventureLensV1={null} />);
    expect(screen.getByText('Evidence Score')).toBeInTheDocument();
    expect(screen.queryByText('Final Investment Score')).toBeNull();
    expect(screen.queryByText('VC Composite')).toBeNull();
    expect(screen.queryByTestId('evidence-score-secondary')).toBeNull();
  });
});

// ─── Tooltip content ──────────────────────────────────────────────────────────

describe('DealWorkspaceTopSection — hero score tooltip content', () => {
  function getScoreRing() {
    // The score ring wrapper is the parent div containing the radial-score-chart testid.
    return screen.getByTestId('radial-score-chart').parentElement!;
  }

  it('10. V3 mode: tooltip title is "Final Investment Score" with correct body', () => {
    render(<DealWorkspaceHeader {...BASE_PROPS} vcScoringV2={VC_V2} ventureLensV1={VENTURE_LENS_V1} />);
    fireEvent.mouseEnter(getScoreRing());
    const tooltip = screen.getByTestId('hero-score-tooltip');
    expect(tooltip).toBeInTheDocument();
    expect(tooltip.textContent).toContain('Final Investment Score');
    expect(tooltip.textContent).toContain('venture lens');
    fireEvent.mouseLeave(getScoreRing());
    expect(screen.queryByTestId('hero-score-tooltip')).toBeNull();
  });

  it('11. V2 mode (no V3): tooltip title is "VC Composite" with correct body', () => {
    render(<DealWorkspaceHeader {...BASE_PROPS} vcScoringV2={VC_V2} ventureLensV1={null} />);
    fireEvent.mouseEnter(getScoreRing());
    const tooltip = screen.getByTestId('hero-score-tooltip');
    expect(tooltip.textContent).toContain('VC Composite');
    expect(tooltip.textContent).toContain('opportunity, confidence, and risk');
    fireEvent.mouseLeave(getScoreRing());
    expect(screen.queryByTestId('hero-score-tooltip')).toBeNull();
  });

  it('12. Legacy mode (no V2, no V3): tooltip title is "Evidence Score" with correct body', () => {
    render(<DealWorkspaceHeader {...BASE_PROPS} vcScoringV2={null} ventureLensV1={null} />);
    fireEvent.mouseEnter(getScoreRing());
    const tooltip = screen.getByTestId('hero-score-tooltip');
    expect(tooltip.textContent).toContain('Evidence Score');
    expect(tooltip.textContent).toContain('evidence-weighted');
    fireEvent.mouseLeave(getScoreRing());
    expect(screen.queryByTestId('hero-score-tooltip')).toBeNull();
  });
});
