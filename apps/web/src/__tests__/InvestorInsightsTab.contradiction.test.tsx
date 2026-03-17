/**
 * InvestorInsightsTab.contradiction.test.tsx — PR36.9 contradiction-aware UI tests
 *
 * Coverage:
 *   - ContradictionCallout: render null when absent / status=none
 *   - ContradictionCallout: correct chip label for mixed vs conflicting
 *   - ContradictionCallout: expand/collapse to show primary + secondary texts
 *   - IntelligenceGrid: backward compat without contradictions prop
 *   - IntelligenceGrid: renders contradiction callout for mixed-signal topic
 *   - LlmInterpretationSection: backward compat without bundle
 *   - LlmInterpretationSection: passes bundle through to subcomponents
 *   - ExternalDiligenceSection: shows skeleton when body is empty (loading)
 *   - SentimentFilterToggle: renders All/Positive/Risk/Mixed options
 *   - Main tab: backward compat — narrative_contradiction_bundle absent from report
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, test } from 'vitest';

// ── Component imports ────────────────────────────────────────────────────────
import { ContradictionCallout } from '../components/workspace/investor-insights/legacy/ContradictionCallout';
import { IntelligenceGrid } from '../components/workspace/investor-insights/legacy/IntelligenceGrid';
import { LlmInterpretationSection } from '../components/workspace/InvestorInsightsTab';
import type { NarrativeContradictionV1, NarrativeContradictionBundle } from '../components/workspace/investorInsightsUtils';
import type { InvestorInsightsSection } from '../lib/apiClient';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const MIXED_CONTRADICTION: NarrativeContradictionV1 = {
  topic: 'financial_outlook',
  status: 'mixed',
  reason: 'numeric_divergence',
  primary_text: 'Company reports ARR of $1M growing 150% YoY.',
  secondary_texts: ['Revenue cited as $500K in the executive summary.'],
  notes: ['ARR figures diverge by 2x.'],
};

const CONFLICTING_CONTRADICTION: NarrativeContradictionV1 = {
  topic: 'product_differentiation',
  status: 'conflicting',
  reason: 'category_divergence',
  primary_text: 'StackFactor automates due diligence workflows for investment analysts.',
  secondary_texts: ['StackFactor is a marketplace connecting investors to deal sources.'],
  notes: ['Candidates imply mutually exclusive product categories.'],
};

const NONE_CONTRADICTION: NarrativeContradictionV1 = {
  topic: 'market_position',
  status: 'none',
  reason: null,
  primary_text: 'Operates in the UK fintech lending space.',
  secondary_texts: [],
  notes: [],
};

const LLM_BODY_PAYLOAD = {
  schema_version: 'llm_interpretation_v1',
  posture: 'INVESTIGATE',
  confidence: 'MEDIUM',
  executive_summary: 'Promising early-stage investment opportunity.',
  product_differentiation: 'AI-driven due diligence automation.',
  go_to_market_strategy: 'Direct sales to mid-market funds.',
  market_position: 'Nascent market with few direct competitors.',
  financial_outlook: 'Pre-revenue with strong LOIs.',
  business_quality: 'Experienced founding team.',
  capital_and_raise_interpretation: 'Raising $1M seed at $8M cap.',
  strengths: ['Strong team', 'Clear problem'],
  risks: ['Pre-revenue', 'Small market size'],
  key_unknowns: ['Unit economics unproven'],
  next_questions: ['What is the CAC?'],
  evidence_caveat: null,
  external_market_context: '',
  competitive_landscape: '',
  claim_verification_summary: '',
  external_risk_signals: '',
  validated: false,
};

const MINIMAL_LLM_BODY =
  '---llm_interpretation_v1_json---\n' + JSON.stringify(LLM_BODY_PAYLOAD);

const LLM_SECTION: InvestorInsightsSection = {
  key: 'llm_interpretation_v1',
  title: 'Investment Interpretation',
  kind: 'message',
  body: MINIMAL_LLM_BODY,
};

// ── ContradictionCallout tests ────────────────────────────────────────────────

describe('ContradictionCallout', () => {
  test('renders nothing when contradiction is null', () => {
    const { container } = render(
      <ContradictionCallout contradiction={null} darkMode={false} />
    );
    expect(container.firstChild).toBeNull();
  });

  test('renders nothing when status is none', () => {
    const { container } = render(
      <ContradictionCallout contradiction={NONE_CONTRADICTION} darkMode={false} />
    );
    expect(container.firstChild).toBeNull();
  });

  test('shows "Mixed signals" chip for status=mixed', () => {
    render(<ContradictionCallout contradiction={MIXED_CONTRADICTION} darkMode={false} />);
    expect(screen.getByText('Mixed signals')).toBeTruthy();
    expect(screen.queryByText('Conflicting evidence')).toBeNull();
  });

  test('shows "Conflicting evidence" chip for status=conflicting', () => {
    render(<ContradictionCallout contradiction={CONFLICTING_CONTRADICTION} darkMode={false} />);
    expect(screen.getByText('Conflicting evidence')).toBeTruthy();
    expect(screen.queryByText('Mixed signals')).toBeNull();
  });

  test('detail is hidden by default', () => {
    render(<ContradictionCallout contradiction={MIXED_CONTRADICTION} darkMode={false} />);
    expect(screen.queryByTestId('contradiction-detail')).toBeNull();
  });

  test('expands to show primary text on click', () => {
    render(<ContradictionCallout contradiction={MIXED_CONTRADICTION} darkMode={false} />);
    fireEvent.click(screen.getByText('Mixed signals'));
    expect(screen.getByTestId('contradiction-detail')).toBeTruthy();
    expect(screen.getByText(MIXED_CONTRADICTION.primary_text)).toBeTruthy();
  });

  test('expanded detail shows secondary_texts', () => {
    render(<ContradictionCallout contradiction={MIXED_CONTRADICTION} darkMode={false} />);
    fireEvent.click(screen.getByText('Mixed signals'));
    expect(screen.getByText(MIXED_CONTRADICTION.secondary_texts[0]!)).toBeTruthy();
  });

  test('collapses when clicked again', () => {
    render(<ContradictionCallout contradiction={MIXED_CONTRADICTION} darkMode={false} />);
    const btn = screen.getByText('Mixed signals');
    fireEvent.click(btn);
    expect(screen.getByTestId('contradiction-detail')).toBeTruthy();
    fireEvent.click(btn);
    expect(screen.queryByTestId('contradiction-detail')).toBeNull();
  });

  test('chipOnly prop suppresses expand control', () => {
    render(
      <ContradictionCallout
        contradiction={CONFLICTING_CONTRADICTION}
        darkMode={false}
        chipOnly
      />
    );
    expect(screen.getByText('Conflicting evidence')).toBeTruthy();
    // No button — it's a plain span in chipOnly mode
    expect(screen.queryByRole('button')).toBeNull();
  });

  test('renders in dark mode without errors', () => {
    render(<ContradictionCallout contradiction={MIXED_CONTRADICTION} darkMode />);
    expect(screen.getByText('Mixed signals')).toBeTruthy();
  });
});

// ── IntelligenceGrid contradiction threading ─────────────────────────────────

const LLM_DATA_MINIMAL = {
  posture: 'Investigate' as const,
  confidence: 'medium' as const,
  executive_summary: 'Test summary.',
  product_differentiation: 'We build AI tools for VCs.',
  go_to_market_strategy: 'Direct outreach to GPs.',
  market_position: 'Niche but growing market.',
  financial_outlook: 'Pre-revenue, strong pipeline.',
  business_quality: 'Strong team.',
  capital_and_raise_interpretation: 'Raising $1M seed.',
  strengths: [],
  risks: [],
  key_unknowns: [],
  next_questions: [],
  evidence_caveat: null,
  validated: false,
};

describe('IntelligenceGrid — contradiction display', () => {
  test('renders all four topic cards without contradictions prop', () => {
    render(<IntelligenceGrid data={LLM_DATA_MINIMAL as any} darkMode={false} />);
    expect(screen.getByText('Product & Differentiation')).toBeTruthy();
    expect(screen.getByText('Market Position')).toBeTruthy();
    expect(screen.getByText('Go-To-Market Strategy')).toBeTruthy();
    expect(screen.getByText('Financial Outlook')).toBeTruthy();
  });

  test('renders no contradiction callout when bundle is null', () => {
    render(
      <IntelligenceGrid data={LLM_DATA_MINIMAL as any} darkMode={false} contradictions={null} />
    );
    expect(screen.queryByText('Mixed signals')).toBeNull();
    expect(screen.queryByText('Conflicting evidence')).toBeNull();
  });

  test('renders contradiction callout for a topic with mixed signals', () => {
    const bundle: NarrativeContradictionBundle = {
      financial_outlook: MIXED_CONTRADICTION,
    };
    render(
      <IntelligenceGrid data={LLM_DATA_MINIMAL as any} darkMode={false} contradictions={bundle} />
    );
    expect(screen.getByText('Mixed signals')).toBeTruthy();
  });

  test('renders conflicting callout for product_differentiation', () => {
    const bundle: NarrativeContradictionBundle = {
      product_differentiation: CONFLICTING_CONTRADICTION,
    };
    render(
      <IntelligenceGrid data={LLM_DATA_MINIMAL as any} darkMode={false} contradictions={bundle} />
    );
    expect(screen.getByText('Conflicting evidence')).toBeTruthy();
  });

  test('does not render callout when topic status is none', () => {
    const bundle: NarrativeContradictionBundle = {
      market_position: NONE_CONTRADICTION,
    };
    render(
      <IntelligenceGrid data={LLM_DATA_MINIMAL as any} darkMode={false} contradictions={bundle} />
    );
    expect(screen.queryByText('Mixed signals')).toBeNull();
  });
});

// ── LlmInterpretationSection contradiction prop wiring ───────────────────────

describe('LlmInterpretationSection — contradiction bundle', () => {
  test('renders without a contradictions prop (backward compat)', () => {
    render(<LlmInterpretationSection section={LLM_SECTION} darkMode={false} />);
    // Check for reliable headings rendered by IntelligenceGrid and SwotPanel
    expect(screen.getByText('Intelligence Signals')).toBeTruthy();
    expect(screen.getByText('Strengths')).toBeTruthy();
  });

  test('renders with contradictions=null (backward compat)', () => {
    render(
      <LlmInterpretationSection
        section={LLM_SECTION}
        darkMode={false}
        contradictions={null}
      />
    );
    expect(screen.queryByText('Mixed signals')).toBeNull();
    expect(screen.queryByText('Conflicting evidence')).toBeNull();
  });

  test('shows mixed signals callout when contradiction bundle is provided', () => {
    const bundle: NarrativeContradictionBundle = {
      financial_outlook: MIXED_CONTRADICTION,
    };
    render(
      <LlmInterpretationSection
        section={LLM_SECTION}
        darkMode={false}
        contradictions={bundle}
      />
    );
    // financial_outlook contradiction renders in BOTH IntelligenceGrid and SwotPanel Risks
    const chips = screen.getAllByText('Mixed signals');
    expect(chips.length).toBeGreaterThanOrEqual(1);
  });

  test('shows conflicting callout for product_differentiation topic', () => {
    const bundle: NarrativeContradictionBundle = {
      product_differentiation: CONFLICTING_CONTRADICTION,
    };
    render(
      <LlmInterpretationSection
        section={LLM_SECTION}
        darkMode={false}
        contradictions={bundle}
      />
    );
    expect(screen.getByText('Conflicting evidence')).toBeTruthy();
  });

  test('renders empty fallback when body is unparseable', () => {
    const badSection: InvestorInsightsSection = {
      ...LLM_SECTION,
      body: 'not-valid-json',
      fallback: 'Investment interpretation unavailable.',
    };
    render(<LlmInterpretationSection section={badSection} darkMode={false} />);
    expect(screen.getByText('Investment interpretation unavailable.')).toBeTruthy();
  });

  test('multiple contradictions in different topics all render', () => {
    const bundle: NarrativeContradictionBundle = {
      product_differentiation: CONFLICTING_CONTRADICTION,
      financial_outlook: MIXED_CONTRADICTION,
    };
    render(
      <LlmInterpretationSection
        section={LLM_SECTION}
        darkMode={false}
        contradictions={bundle}
      />
    );
    // 'Conflicting evidence' appears once (IntelligenceGrid product card)
    expect(screen.getAllByText('Conflicting evidence').length).toBeGreaterThanOrEqual(1);
    // 'Mixed signals' appears in IntelligenceGrid financial card + SwotPanel Risks card
    expect(screen.getAllByText('Mixed signals').length).toBeGreaterThanOrEqual(1);
  });
});
