import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { DealWorkspaceV4, type DealWorkspaceV4Props } from '../components/workspace/DealWorkspaceV4';

const emptyFact = { value: null, trust: 'not_extracted' as const, nullReason: 'Not extracted' };

const BASE_PROPS: DealWorkspaceV4Props = {
  darkMode: true,
  companyName: 'Acme Robotics',
  dealType: 'Equity',
  stage: 'Series A',
  raise: '$5M',
  raiseNullRule: null,
  lastAnalyzedAt: '2026-05-01T12:00:00.000Z',
  investmentSnapshotBody: 'Financial evidence is incomplete and traction claims need validation.',
  convictionScore: 46,
  convictionBand: 'Investigate',
  convictionPosture: 'INVESTIGATE',
  convictionHeadline: 'Not ready to commit',
  convictionRationale: 'Evidence coverage is thin.',
  convictionProvisional: true,
  topPositiveContributors: [{ key: 'market_demand', label: 'Market demand', scoreDelta: 4 }],
  topNegativeContributors: [{ key: 'financial_truth', label: 'Financial truth', scoreDelta: -12 }],
  requiredNextChecks: ['Submit verified financial statements or a financial model'],
  product: emptyFact,
  market: emptyFact,
  businessModel: emptyFact,
  raiseTerms: emptyFact,
  financialTiles: [],
  financialCoverage: 48,
  underwritingReadiness: 42,
  financialIntegrityStatus: 'unvalidated',
  financialNarrative: null,
  financialCurrentStateSummary: null,
  financialBurnRunwaySummary: null,
  underwritingNarrative: null,
  redFlags: [{ severity: 'high', message: 'Missing verified financial statements' }],
  blockerCount: 1,
  openQuestions: ['How much revenue is recurring'],
  contradictions: [],
  teamHighlights: [],
  useOfFunds: [],
  projectPipeline: [],
  revenueModel: { type: null, unitEconomics: null, detail: null },
  deepDiveReady: false,
  insightsReady: false,
};

describe('DealWorkspaceV4 rerun progress UX', () => {
  it('renders real rerun progress and disables duplicate rerun clicks', () => {
    const onRunAnalysis = vi.fn();

    render(
      <DealWorkspaceV4
        {...BASE_PROPS}
        onRunAnalysis={onRunAnalysis}
        analysisProgress={{
          active: true,
          jobId: 'job-123',
          type: 'analyze_deal',
          status: 'running',
          stage: 'extracting_evidence',
          progressPct: 45,
          message: 'Extracting evidence',
          previousAnalysisVisible: true,
        }}
      />
    );

    const strip = screen.getByTestId('rerun-status-strip');
    expect(strip).toBeInTheDocument();
    expect(strip.textContent).toContain('Re-running analysis');
    expect(strip.textContent).toContain('Extracting evidence');
    expect(strip.textContent).toContain('Previous analysis remains visible');

    const rerunButtons = screen.getAllByRole('button', { name: /re-running/i });
    expect(rerunButtons.length).toBeGreaterThan(0);
    rerunButtons.forEach((button) => expect(button).toBeDisabled());
    fireEvent.click(rerunButtons[0]);
    expect(onRunAnalysis).not.toHaveBeenCalled();
  });

  it('shows a failure state while preserving the previous analysis', () => {
    render(
      <DealWorkspaceV4
        {...BASE_PROPS}
        analysisProgress={{
          active: false,
          terminal: 'error',
          status: 'failed',
          message: 'Analysis rerun failed. Your previous analysis is still visible. Try again.',
          error: 'Analysis rerun failed. Your previous analysis is still visible. Try again.',
          previousAnalysisVisible: true,
        }}
      />
    );

    const strip = screen.getByTestId('rerun-status-strip');
    expect(strip).toBeInTheDocument();
    expect(strip.textContent).toContain('Analysis rerun failed');
    expect(strip.textContent).toContain('Analysis rerun failed. Your previous analysis is still visible. Try again.');
    expect(screen.getByTestId('executive-decision-hero')).toBeInTheDocument();
  });
});
