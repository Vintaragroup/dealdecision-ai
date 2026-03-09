/**
 * InvestorInsightsTab.components.test.tsx — regression coverage for polished components
 *
 * Coverage:
 *   ExecutivePulse
 *     - renders for each posture variant (GO / INVESTIGATE / CAUTION / PASS)
 *     - renders vital-sign cards for market, financials, risk
 *     - renders evidence caveat when present
 *     - omits evidence caveat when absent
 *   SynthesizedNarrative
 *     - renders executive summary paragraph
 *     - renders Business Quality and Capital & Raise labels
 *     - renders source footnotes when corroborations provided
 *     - shows ContradictionCallout chip next to Business Quality when contradiction present
 *     - shows ContradictionCallout chip next to Capital & Raise when contradiction present
 *     - backward compat when contradictions prop is absent
 *   SentimentFilterToggle
 *     - renders All / Positive / Risk / Mixed options
 *     - active option has aria-pressed="true"
 *     - clicking option calls onChange
 *     - shows count badge when counts prop provided
 *     - role="group" with accessible label
 *   ExternalDiligenceSkeleton
 *     - renders aria-busy="true"
 *     - renders default 3 skeleton rows
 *     - renders custom row count
 *   ContradictionCallout — polish
 *     - chipOnly renders plain span, not a button
 *     - expanded panel has data-testid="contradiction-detail"
 *     - reason separator line present when reason given
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

import { ExecutivePulse } from '../components/workspace/investor-insights/ExecutivePulse';
import { SynthesizedNarrative } from '../components/workspace/investor-insights/SynthesizedNarrative';
import { SentimentFilterToggle } from '../components/workspace/investor-insights/SentimentFilterToggle';
import { ExternalDiligenceSkeleton } from '../components/workspace/investor-insights/ExternalDiligenceSkeleton';
import { ContradictionCallout } from '../components/workspace/investor-insights/ContradictionCallout';

import type { LlmInterpretationV1 } from '../components/workspace/investorInsightsUtils';
import type { NarrativeContradictionV1, NarrativeContradictionBundle } from '../components/workspace/investorInsightsUtils';
import type { ClaimCorroboration } from '../components/workspace/investorInsightsUtils';

// ── Shared fixtures ───────────────────────────────────────────────────────────

const BASE_LLM: LlmInterpretationV1 = {
  schema_version: 'llm_interpretation_v1',
  posture: 'INVESTIGATE',
  confidence: 'MEDIUM',
  executive_summary: 'A promising but early-stage opportunity.',
  product_differentiation: 'AI-driven workflow automation.',
  go_to_market_strategy: 'Direct sales to mid-market funds.',
  market_position: 'Nascent market with few competitors.',
  financial_outlook: 'Pre-revenue with strong LOIs indicating near-term conversion.',
  business_quality: 'Experienced founding team with deep domain expertise.',
  capital_and_raise_interpretation: 'Raising $1M seed at $8M pre-money cap.',
  strengths: ['Strong team', 'Clear problem'],
  risks: ['Pre-revenue', 'Small market'],
  key_unknowns: ['Unit economics unproven'],
  next_questions: ['What is the CAC?'],
  evidence_caveat: null,
  external_market_context: '',
  competitive_landscape: '',
  claim_verification_summary: '',
  external_risk_signals: '',
  validated: false,
};

const MIXED_CONTRADICTION: NarrativeContradictionV1 = {
  topic: 'business_quality',
  status: 'mixed',
  reason: 'team_signal_divergence',
  primary_text: 'Team has deep domain expertise in fund operations.',
  secondary_texts: ['No prior exits or institutional experience noted.'],
  notes: [],
};

const CAPITAL_CONTRADICTION: NarrativeContradictionV1 = {
  topic: 'capital_and_raise',
  status: 'conflicting',
  reason: 'valuation_cap_divergence',
  primary_text: 'Pre-money cap stated as $8M.',
  secondary_texts: ['Executive summary cites $12M valuation.'],
  notes: [],
};

// ── ExecutivePulse ────────────────────────────────────────────────────────────

describe('ExecutivePulse', () => {
  test.each([
    ['GO', '◆ GO'],
    ['INVESTIGATE', '◈ INVESTIGATE'],
    ['CAUTION', '⚑ CAUTION'],
    ['PASS', '✕ PASS'],
  ] as const)('renders posture badge for %s', (posture, badgeLabel) => {
    render(
      <ExecutivePulse
        data={{ ...BASE_LLM, posture }}
        darkMode={false}
      />
    );
    expect(screen.getByText(badgeLabel)).toBeTruthy();
  });

  test('renders vital-sign cards for Market, Financials, Risk', () => {
    render(<ExecutivePulse data={BASE_LLM} darkMode={false} />);
    expect(screen.getByTestId('vital-sign-market')).toBeTruthy();
    expect(screen.getByTestId('vital-sign-financials')).toBeTruthy();
    expect(screen.getByTestId('vital-sign-risk')).toBeTruthy();
  });

  test('renders evidence caveat when present', () => {
    const caveat = 'Limited financial data available for this deal.';
    render(
      <ExecutivePulse
        data={{ ...BASE_LLM, evidence_caveat: caveat }}
        darkMode={false}
      />
    );
    expect(screen.getByText(caveat)).toBeTruthy();
  });

  test('omits evidence caveat when absent', () => {
    const { container } = render(
      <ExecutivePulse data={{ ...BASE_LLM, evidence_caveat: null }} darkMode={false} />
    );
    // Find the executive-pulse wrapper
    const wrapper = container.querySelector('[data-testid="executive-pulse"]');
    expect(wrapper).toBeTruthy();
    // No caveat text present
    expect(container.querySelector('[class*="border-l-2"]')).toBeNull();
  });

  test('renders data-testid="executive-pulse" wrapper', () => {
    render(<ExecutivePulse data={BASE_LLM} darkMode={false} />);
    expect(screen.getByTestId('executive-pulse')).toBeTruthy();
  });

  test('renders confidence label (Medium Confidence)', () => {
    render(<ExecutivePulse data={{ ...BASE_LLM, confidence: 'MEDIUM' }} darkMode={false} />);
    expect(screen.getByText('Medium Confidence')).toBeTruthy();
  });

  test('renders High Confidence for HIGH confidence', () => {
    render(<ExecutivePulse data={{ ...BASE_LLM, confidence: 'HIGH' }} darkMode={false} />);
    expect(screen.getByText('High Confidence')).toBeTruthy();
  });

  test('renders Low Confidence for LOW confidence', () => {
    render(<ExecutivePulse data={{ ...BASE_LLM, confidence: 'LOW' }} darkMode={false} />);
    expect(screen.getByText('Low Confidence')).toBeTruthy();
  });

  test('renders in dark mode without error', () => {
    render(<ExecutivePulse data={BASE_LLM} darkMode={true} />);
    expect(screen.getByTestId('executive-pulse')).toBeTruthy();
  });
});

// ── SynthesizedNarrative ──────────────────────────────────────────────────────

describe('SynthesizedNarrative', () => {
  test('renders executive summary paragraph', () => {
    render(<SynthesizedNarrative data={BASE_LLM} darkMode={false} />);
    expect(screen.getByText('A promising but early-stage opportunity.')).toBeTruthy();
  });

  test('renders Business Quality section label', () => {
    render(<SynthesizedNarrative data={BASE_LLM} darkMode={false} />);
    expect(screen.getByText('Business Quality')).toBeTruthy();
  });

  test('renders Capital & Raise section label', () => {
    render(<SynthesizedNarrative data={BASE_LLM} darkMode={false} />);
    expect(screen.getByText('Capital & Raise')).toBeTruthy();
  });

  test('renders source footnotes header when corroborations provided', () => {
    const corroborations: ClaimCorroboration[] = [
      {
        claim_field: 'raise_amount',
        claim_value: '$1M',
        web_signal: 'Crunchbase confirms $1M seed round.',
        source_url: 'https://crunchbase.com/example',
        verdict: 'corroborated',
      },
    ];
    render(
      <SynthesizedNarrative
        data={BASE_LLM}
        corroborations={corroborations}
        darkMode={false}
      />
    );
    expect(screen.getByText('Sources')).toBeTruthy();
  });

  test('backward compat — renders without contradictions prop', () => {
    render(<SynthesizedNarrative data={BASE_LLM} darkMode={false} />);
    // No chip labels should appear when contradictions are absent
    expect(screen.queryByText('Mixed signals')).toBeNull();
    expect(screen.queryByText('Conflicting evidence')).toBeNull();
  });

  test('shows Mixed signals chip next to Business Quality when contradiction present', () => {
    const bundle: NarrativeContradictionBundle = {
      business_quality: MIXED_CONTRADICTION,
    };
    render(
      <SynthesizedNarrative
        data={BASE_LLM}
        contradictions={bundle}
        darkMode={false}
      />
    );
    expect(screen.getByText('Mixed signals')).toBeTruthy();
  });

  test('shows Conflicting evidence chip next to Capital & Raise when contradiction present', () => {
    const bundle: NarrativeContradictionBundle = {
      capital_and_raise: CAPITAL_CONTRADICTION,
    };
    render(
      <SynthesizedNarrative
        data={BASE_LLM}
        contradictions={bundle}
        darkMode={false}
      />
    );
    expect(screen.getByText('Conflicting evidence')).toBeTruthy();
  });

  test('does not show chip when null bundle passed', () => {
    render(
      <SynthesizedNarrative
        data={BASE_LLM}
        contradictions={null}
        darkMode={false}
      />
    );
    expect(screen.queryByText('Mixed signals')).toBeNull();
    expect(screen.queryByText('Conflicting evidence')).toBeNull();
  });

  test('renders in dark mode without error', () => {
    render(<SynthesizedNarrative data={BASE_LLM} darkMode={true} />);
    expect(screen.getByText('Business Quality')).toBeTruthy();
  });
});

// ── SentimentFilterToggle ─────────────────────────────────────────────────────

describe('SentimentFilterToggle', () => {
  test('renders All, Positive, Risk, Mixed filter buttons', () => {
    render(
      <SentimentFilterToggle value="all" onChange={() => {}} darkMode={false} />
    );
    expect(screen.getByText('All')).toBeTruthy();
    expect(screen.getByText('Positive')).toBeTruthy();
    expect(screen.getByText('Risk')).toBeTruthy();
    expect(screen.getByText('Mixed')).toBeTruthy();
  });

  test('has role="group" with accessible label', () => {
    render(
      <SentimentFilterToggle value="all" onChange={() => {}} darkMode={false} />
    );
    expect(screen.getByRole('group', { name: 'Filter by sentiment' })).toBeTruthy();
  });

  test('data-testid="sentiment-filter-toggle" present', () => {
    render(
      <SentimentFilterToggle value="all" onChange={() => {}} darkMode={false} />
    );
    expect(screen.getByTestId('sentiment-filter-toggle')).toBeTruthy();
  });

  test('active button has aria-pressed="true"', () => {
    render(
      <SentimentFilterToggle value="risk" onChange={() => {}} darkMode={false} />
    );
    const riskBtn = screen.getByText('Risk').closest('button')!;
    expect(riskBtn.getAttribute('aria-pressed')).toBe('true');
  });

  test('non-active buttons have aria-pressed="false"', () => {
    render(
      <SentimentFilterToggle value="risk" onChange={() => {}} darkMode={false} />
    );
    const allBtn = screen.getByText('All').closest('button')!;
    expect(allBtn.getAttribute('aria-pressed')).toBe('false');
  });

  test('clicking a filter option calls onChange with correct value', () => {
    const onChange = vi.fn();
    render(
      <SentimentFilterToggle value="all" onChange={onChange} darkMode={false} />
    );
    fireEvent.click(screen.getByText('Positive'));
    expect(onChange).toHaveBeenCalledWith('positive');
  });

  test('clicking currently active option calls onChange again', () => {
    const onChange = vi.fn();
    render(
      <SentimentFilterToggle value="all" onChange={onChange} darkMode={false} />
    );
    fireEvent.click(screen.getByText('All'));
    expect(onChange).toHaveBeenCalledWith('all');
  });

  test('shows count badge when counts prop provided', () => {
    render(
      <SentimentFilterToggle
        value="all"
        onChange={() => {}}
        darkMode={false}
        counts={{ all: 12, positive: 5, risk: 3, mixed: 4 }}
      />
    );
    // All count badge
    expect(screen.getByText('12')).toBeTruthy();
    // Other counts
    expect(screen.getByText('5')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
  });

  test('renders in dark mode without error', () => {
    render(
      <SentimentFilterToggle value="mixed" onChange={() => {}} darkMode={true} />
    );
    const mixedBtn = screen.getByText('Mixed').closest('button')!;
    expect(mixedBtn.getAttribute('aria-pressed')).toBe('true');
  });
});

// ── ExternalDiligenceSkeleton ─────────────────────────────────────────────────

describe('ExternalDiligenceSkeleton', () => {
  test('container has aria-busy="true"', () => {
    render(<ExternalDiligenceSkeleton darkMode={false} />);
    const el = screen.getByLabelText('Loading external due diligence data');
    expect(el.getAttribute('aria-busy')).toBe('true');
  });

  test('renders 3 skeleton rows by default', () => {
    const { container } = render(<ExternalDiligenceSkeleton darkMode={false} />);
    // Each row is a SkeletonCard with a border class
    const cards = container.querySelectorAll('[class*="rounded-lg border"]');
    // 3 cards + possibly header — expect at least 3
    expect(cards.length).toBeGreaterThanOrEqual(3);
  });

  test('renders custom row count', () => {
    const { container } = render(<ExternalDiligenceSkeleton darkMode={false} rows={5} />);
    const cards = container.querySelectorAll('[class*="rounded-lg border"]');
    expect(cards.length).toBeGreaterThanOrEqual(5);
  });

  test('renders in dark mode without error', () => {
    render(<ExternalDiligenceSkeleton darkMode={true} rows={2} />);
    expect(screen.getByLabelText('Loading external due diligence data')).toBeTruthy();
  });
});

// ── ContradictionCallout — polish regression ──────────────────────────────────

describe('ContradictionCallout — polish', () => {
  test('chipOnly renders a span, not a button', () => {
    const { container } = render(
      <ContradictionCallout
        contradiction={MIXED_CONTRADICTION}
        darkMode={false}
        chipOnly
      />
    );
    expect(container.querySelector('button')).toBeNull();
    expect(container.querySelector('span')).toBeTruthy();
  });

  test('expanded panel has data-testid="contradiction-detail"', () => {
    render(
      <ContradictionCallout contradiction={MIXED_CONTRADICTION} darkMode={false} />
    );
    // Not visible by default
    expect(screen.queryByTestId('contradiction-detail')).toBeNull();
    // Click to expand
    fireEvent.click(screen.getByRole('button', { name: /expand contradiction detail/i }));
    expect(screen.getByTestId('contradiction-detail')).toBeTruthy();
  });

  test('expanded panel shows reason with label when reason is present', () => {
    render(
      <ContradictionCallout contradiction={MIXED_CONTRADICTION} darkMode={false} />
    );
    fireEvent.click(screen.getByRole('button'));
    // reason text should appear
    expect(screen.getByText('team_signal_divergence')).toBeTruthy();
    expect(screen.getByText('reason:')).toBeTruthy();
  });

  test('expanded panel omits reason section when reason is null', () => {
    const noReason: NarrativeContradictionV1 = { ...MIXED_CONTRADICTION, reason: null };
    render(<ContradictionCallout contradiction={noReason} darkMode={false} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.queryByText('reason:')).toBeNull();
  });

  test('mixed chip uses amber styling (not red)', () => {
    const { container } = render(
      <ContradictionCallout contradiction={MIXED_CONTRADICTION} darkMode={false} />
    );
    const chip = container.querySelector('button');
    expect(chip?.className).toContain('amber');
    expect(chip?.className).not.toContain('red');
  });

  test('conflicting chip uses red styling', () => {
    const conflicting: NarrativeContradictionV1 = {
      ...MIXED_CONTRADICTION,
      status: 'conflicting',
    };
    const { container } = render(
      <ContradictionCallout contradiction={conflicting} darkMode={false} />
    );
    const chip = container.querySelector('button');
    expect(chip?.className).toContain('red');
  });
});
