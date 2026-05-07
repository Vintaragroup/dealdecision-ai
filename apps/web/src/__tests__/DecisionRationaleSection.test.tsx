/**
 * Tests for DecisionRationaleSection (Phase 5)
 *
 * Validates:
 * - rationale renders when status === 'validated'
 * - rationale does NOT render when status is draft/shadow_only/rejected
 * - missing rationale (null/undefined) does not break report
 * - section displays correct validation badges
 * - all sub-sections render with correct data
 * - disclaimer is always shown when rendered
 */

import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';
import {
  DecisionRationaleSection,
  type DecisionRationaleV1,
} from '../components/workspace/analysis/DecisionRationaleSection';

// ─── Test fixtures ────────────────────────────────────────────────────────────

const VALIDATED_RATIONALE: DecisionRationaleV1 = {
  schema_version: 'llm_decision_rationale_v1',
  deal_id: 'deal-abc123',
  run_id: 'run-xyz789',
  created_at: '2026-05-07T12:00:00.000Z',
  model: 'gpt-4o-mini',
  provider: 'openai',
  canonical_verdict: 'INVESTIGATE',
  primary_reason:
    'Climatic presents a coherent infrastructure-scale strategy, but the current package lacks underwriting-grade financial evidence.',
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
  evidence_refs: ['ev-001', 'ev-002'],
  source_quality_notes: ['Revenue figures are management-provided projections'],
  backend_terms_removed: [],
  generation_warnings: [],
  status: 'validated',
  validation_run_id: 'val-run-001',
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('DecisionRationaleSection', () => {
  it('renders when status is validated', () => {
    render(<DecisionRationaleSection rationale={VALIDATED_RATIONALE} />);
    expect(screen.getByTestId('decision-rationale-section')).toBeInTheDocument();
  });

  it('shows primary reason text', () => {
    render(<DecisionRationaleSection rationale={VALIDATED_RATIONALE} />);
    expect(screen.getByTestId('rationale-primary-reason')).toHaveTextContent(
      'Climatic presents a coherent'
    );
  });

  it('shows AI-generated badge', () => {
    render(<DecisionRationaleSection rationale={VALIDATED_RATIONALE} />);
    expect(screen.getByTestId('rationale-ai-badge')).toBeInTheDocument();
    expect(screen.getByTestId('rationale-ai-badge')).toHaveTextContent('AI-generated rationale');
  });

  it('shows Validated badge', () => {
    render(<DecisionRationaleSection rationale={VALIDATED_RATIONALE} />);
    expect(screen.getByTestId('rationale-validated-badge')).toBeInTheDocument();
    expect(screen.getByTestId('rationale-validated-badge')).toHaveTextContent('Validated');
  });

  it('shows why_not_pass panel', () => {
    render(<DecisionRationaleSection rationale={VALIDATED_RATIONALE} />);
    const panel = screen.getByTestId('rationale-why-not-pass');
    expect(panel).toBeInTheDocument();
    expect(panel).toHaveTextContent('No audited financials provided');
  });

  it('shows why_not_reject panel', () => {
    render(<DecisionRationaleSection rationale={VALIDATED_RATIONALE} />);
    const panel = screen.getByTestId('rationale-why-not-reject');
    expect(panel).toBeInTheDocument();
    expect(panel).toHaveTextContent('Founding team carries deep sector expertise');
  });

  it('shows strongest_signals panel', () => {
    render(<DecisionRationaleSection rationale={VALIDATED_RATIONALE} />);
    const panel = screen.getByTestId('rationale-strongest-signals');
    expect(panel).toBeInTheDocument();
    expect(panel).toHaveTextContent('Signed LOIs from tier-1 utilities');
  });

  it('shows gating_risks panel', () => {
    render(<DecisionRationaleSection rationale={VALIDATED_RATIONALE} />);
    const panel = screen.getByTestId('rationale-gating-risks');
    expect(panel).toBeInTheDocument();
    expect(panel).toHaveTextContent('Diligence-stage financial risk');
  });

  it('shows missing_evidence panel', () => {
    render(<DecisionRationaleSection rationale={VALIDATED_RATIONALE} />);
    const panel = screen.getByTestId('rationale-missing-evidence');
    expect(panel).toBeInTheDocument();
    expect(panel).toHaveTextContent('Audited financial statements');
  });

  it('shows confidence explanation', () => {
    render(<DecisionRationaleSection rationale={VALIDATED_RATIONALE} />);
    expect(screen.getByTestId('rationale-confidence-explanation')).toHaveTextContent(
      'Moderate confidence'
    );
  });

  it('shows disclaimer footer', () => {
    render(<DecisionRationaleSection rationale={VALIDATED_RATIONALE} />);
    expect(screen.getByTestId('rationale-disclaimer')).toHaveTextContent(
      'For decision support only'
    );
  });

  it('does NOT render when status is shadow_only', () => {
    const rationale: DecisionRationaleV1 = { ...VALIDATED_RATIONALE, status: 'shadow_only' };
    const { container } = render(<DecisionRationaleSection rationale={rationale} />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId('decision-rationale-section')).not.toBeInTheDocument();
  });

  it('does NOT render when status is draft', () => {
    const rationale: DecisionRationaleV1 = { ...VALIDATED_RATIONALE, status: 'draft' };
    const { container } = render(<DecisionRationaleSection rationale={rationale} />);
    expect(container.firstChild).toBeNull();
  });

  it('does NOT render when status is rejected', () => {
    const rationale: DecisionRationaleV1 = { ...VALIDATED_RATIONALE, status: 'rejected' };
    const { container } = render(<DecisionRationaleSection rationale={rationale} />);
    expect(container.firstChild).toBeNull();
  });

  it('does NOT render when rationale is null', () => {
    const { container } = render(<DecisionRationaleSection rationale={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('does NOT render when rationale is undefined', () => {
    const { container } = render(<DecisionRationaleSection rationale={undefined} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders without error when arrays are empty', () => {
    const sparse: DecisionRationaleV1 = {
      ...VALIDATED_RATIONALE,
      why_not_pass: [],
      why_not_reject: [],
      strongest_signals: [],
      gating_risks: [],
      missing_evidence: [],
      confidence_explanation: '',
    };
    render(<DecisionRationaleSection rationale={sparse} />);
    // Section still renders (status is validated), but optional panels are absent
    expect(screen.getByTestId('decision-rationale-section')).toBeInTheDocument();
    expect(screen.queryByTestId('rationale-why-not-pass')).not.toBeInTheDocument();
    expect(screen.queryByTestId('rationale-why-not-reject')).not.toBeInTheDocument();
    expect(screen.queryByTestId('rationale-strongest-signals')).not.toBeInTheDocument();
    expect(screen.queryByTestId('rationale-gating-risks')).not.toBeInTheDocument();
    expect(screen.queryByTestId('rationale-missing-evidence')).not.toBeInTheDocument();
  });

  it('shows canonical_verdict in header', () => {
    render(<DecisionRationaleSection rationale={VALIDATED_RATIONALE} />);
    expect(screen.getByTestId('decision-rationale-section')).toHaveTextContent('INVESTIGATE');
  });

  it('renders in dark mode without errors', () => {
    render(<DecisionRationaleSection rationale={VALIDATED_RATIONALE} darkMode={true} />);
    expect(screen.getByTestId('decision-rationale-section')).toBeInTheDocument();
    expect(screen.getByTestId('rationale-ai-badge')).toBeInTheDocument();
  });
});
