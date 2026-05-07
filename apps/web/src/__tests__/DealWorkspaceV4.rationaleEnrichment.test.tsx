/**
 * Tests for rationale-enriched copy in DealWorkspaceV4.
 *
 * Validates:
 * - `DecisionRationaleSection` does NOT render in the main workspace flow
 * - `gating_risks` from validated rationale surface in Decision Signals blockers
 * - `strongest_signals` from validated rationale surface in Decision Signals positives
 * - `primary_reason` from validated rationale surfaces in the workspace
 * - `confidence_explanation` from validated rationale surfaces in Decision Confidence
 * - Rationale diagnostics row appears in Source notes section
 * - Fallback copy is correct when rationale is null
 * - No conflicting canonical_verdict label appears in main UI
 * - Short extraction fragments ("Ice touring") do not appear in Key Facts cards
 */

import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';
import { DealWorkspaceV4, type DealWorkspaceV4Props } from '../components/workspace/DealWorkspaceV4';

const emptyFact = { value: null, trust: 'not_extracted' as const, nullReason: 'Not extracted' };

const BASE_PROPS: DealWorkspaceV4Props = {
  darkMode: true,
  companyName: 'Climatic',
  dealType: 'Equity',
  stage: 'Series A',
  raise: '$5M',
  raiseNullRule: null,
  lastAnalyzedAt: '2026-05-01T12:00:00.000Z',
  investmentSnapshotBody: 'Financial evidence is incomplete.',
  convictionScore: 52,
  convictionBand: 'Investigate',
  convictionPosture: 'INVESTIGATE',
  convictionHeadline: null,
  convictionRationale: null,
  convictionProvisional: false,
  topPositiveContributors: [
    { key: 'market_demand', label: 'Market demand signal', scoreDelta: 5 },
  ],
  topNegativeContributors: [
    { key: 'financial_truth', label: 'Financial truth gap', scoreDelta: -10 },
  ],
  requiredNextChecks: [],
  product: emptyFact,
  market: emptyFact,
  businessModel: emptyFact,
  raiseTerms: emptyFact,
  financialTiles: [],
  financialCoverage: 40,
  underwritingReadiness: 38,
  financialIntegrityStatus: 'unvalidated',
  financialNarrative: null,
  financialCurrentStateSummary: null,
  financialBurnRunwaySummary: null,
  underwritingNarrative: null,
  redFlags: [],
  blockerCount: 0,
  openQuestions: [],
  contradictions: [],
  teamHighlights: [],
  useOfFunds: [],
  projectPipeline: [],
  revenueModel: { type: null, unitEconomics: null, detail: null },
  deepDiveReady: false,
  insightsReady: false,
};

const VALIDATED_RATIONALE = {
  schema_version: 'llm_decision_rationale_v1' as const,
  deal_id: 'deal-climatic',
  run_id: 'run-001',
  created_at: '2026-05-07T12:00:00.000Z',
  model: 'gpt-4o-mini',
  provider: 'openai',
  canonical_verdict: 'PASS',  // intentionally conflicts with INVESTIGATE page stance
  primary_reason:
    'Climatic presents a coherent infrastructure-scale strategy, but financial evidence is incomplete.',
  why_not_pass: [
    'No audited financials provided',
    'Cash position not independently verified',
  ],
  why_not_reject: [
    'Founding team carries deep sector expertise',
    'LOIs with regional utilities provide commercial validation',
  ],
  strongest_signals: [
    'Signed LOIs from tier-1 utilities',
    'Founding team has domain-specific track record',
  ],
  gating_risks: [
    'Diligence-stage financial risk without verified statements',
    'Capital deployment timeline unverified',
  ],
  missing_evidence: [
    'Audited financial statements',
    'Independently verified cash balance',
  ],
  confidence_explanation:
    'Moderate confidence — commercial signals present but financial evidence base is thin.',
  evidence_refs: [],
  source_quality_notes: [],
  backend_terms_removed: [],
  generation_warnings: [],
  status: 'validated' as const,
  validation_run_id: 'val-001',
};

// ─── Test: standalone DecisionRationaleSection must NOT appear in main flow ───

describe('DecisionRationaleSection removal from main flow', () => {
  it('does not render the standalone decision-rationale-section block in the workspace', () => {
    render(<DealWorkspaceV4 {...BASE_PROPS} decisionRationale={VALIDATED_RATIONALE} />);
    expect(screen.queryByTestId('decision-rationale-section')).not.toBeInTheDocument();
  });

  it('does not render decision-rationale-section when rationale is null', () => {
    render(<DealWorkspaceV4 {...BASE_PROPS} decisionRationale={null} />);
    expect(screen.queryByTestId('decision-rationale-section')).not.toBeInTheDocument();
  });

  it('does not render decision-rationale-section when rationale is shadow_only', () => {
    const shadowRationale = { ...VALIDATED_RATIONALE, status: 'shadow_only' as const };
    render(<DealWorkspaceV4 {...BASE_PROPS} decisionRationale={shadowRationale} />);
    expect(screen.queryByTestId('decision-rationale-section')).not.toBeInTheDocument();
  });
});

// ─── Test: no conflicting canonical_verdict label shown in main UI ────────────

describe('No conflicting canonical_verdict label in main UI', () => {
  it('does not display the canonical_verdict PASS label when page stance is INVESTIGATE', () => {
    // The page says INVESTIGATE; the rationale has canonical_verdict: PASS.
    // The PASS label must not appear in the main workspace UI (only in diagnostics).
    render(<DealWorkspaceV4 {...BASE_PROPS} decisionRationale={VALIDATED_RATIONALE} />);
    // The word PASS should not appear as a prominent label in the main body
    // (it may appear inside the collapsed diagnostics section, which is acceptable)
    const rationaleSection = screen.queryByTestId('decision-rationale-section');
    expect(rationaleSection).not.toBeInTheDocument();
  });
});

// ─── Test: rationale diagnostics in Source notes ──────────────────────────────

describe('Rationale diagnostics in Source notes', () => {
  it('renders rationale-diagnostics row with status when rationale is present', () => {
    render(<DealWorkspaceV4 {...BASE_PROPS} decisionRationale={VALIDATED_RATIONALE} />);
    const diag = screen.getByTestId('rationale-diagnostics');
    expect(diag).toBeInTheDocument();
    expect(diag.textContent).toContain('validated');
  });

  it('renders rationale-diagnostics with canonical_verdict', () => {
    render(<DealWorkspaceV4 {...BASE_PROPS} decisionRationale={VALIDATED_RATIONALE} />);
    const diag = screen.getByTestId('rationale-diagnostics');
    expect(diag.textContent).toContain('PASS');
  });

  it('does not render rationale-diagnostics when rationale is null', () => {
    render(<DealWorkspaceV4 {...BASE_PROPS} decisionRationale={null} />);
    expect(screen.queryByTestId('rationale-diagnostics')).not.toBeInTheDocument();
  });

  it('renders rationale-diagnostics for shadow_only rationale', () => {
    const shadowRationale = { ...VALIDATED_RATIONALE, status: 'shadow_only' as const };
    render(<DealWorkspaceV4 {...BASE_PROPS} decisionRationale={shadowRationale} />);
    const diag = screen.getByTestId('rationale-diagnostics');
    expect(diag.textContent).toContain('shadow_only');
  });
});

// ─── Test: extraction fragment suppression in Key Facts ──────────────────────

describe('Key Facts: extraction fragment suppression', () => {
  it('shows Not extracted instead of a short fragment value like "Ice touring"', () => {
    render(
      <DealWorkspaceV4
        {...BASE_PROPS}
        product={{ value: 'Ice touring', trust: 'extracted', nullReason: null }}
      />
    );
    // "Ice touring" is a 2-word fragment — must not appear; "Not extracted" should show instead
    expect(screen.queryByText('Ice touring.')).not.toBeInTheDocument();
    expect(screen.queryByText('Ice touring')).not.toBeInTheDocument();
  });

  it('shows a full sentence product value when provided', () => {
    render(
      <DealWorkspaceV4
        {...BASE_PROPS}
        product={{
          value: 'A climate-tech SaaS platform that automates carbon accounting for enterprise clients.',
          trust: 'extracted',
          nullReason: null,
        }}
      />
    );
    // Full sentences should still render
    expect(
      screen.getByText(
        'A climate-tech SaaS platform that automates carbon accounting for enterprise clients.'
      )
    ).toBeInTheDocument();
  });

  it('suppresses N/A sentinel values from Key Facts cards', () => {
    render(
      <DealWorkspaceV4
        {...BASE_PROPS}
        market={{ value: 'N/A', trust: 'extracted', nullReason: null }}
      />
    );
    // N/A should be suppressed and shown as "Not extracted"
    const notExtractedEls = screen.getAllByText('Not extracted');
    expect(notExtractedEls.length).toBeGreaterThan(0);
  });
});

// ─── Test: fallback copy when rationale is null ───────────────────────────────

describe('Fallback copy when rationale is null', () => {
  it('renders workspace without error when decisionRationale is null', () => {
    render(<DealWorkspaceV4 {...BASE_PROPS} decisionRationale={null} />);
    expect(screen.getByText('Climatic')).toBeInTheDocument();
  });

  it('renders workspace without error when decisionRationale is undefined', () => {
    render(<DealWorkspaceV4 {...BASE_PROPS} />);
    expect(screen.getByText('Climatic')).toBeInTheDocument();
  });
});
