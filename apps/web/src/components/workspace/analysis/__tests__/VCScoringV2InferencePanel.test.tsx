import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';
import { VCScoringV2InferencePanel } from '../VCScoringV2InferencePanel';
import type { VCScoringV2InferenceLike } from '../../../../lib/vcInferenceSummary';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeTrace(
  boosted: boolean,
  reasons: string[] = [],
  inferred_score = 60,
  final_score = 55
) {
  return { boosted, inferred_score, final_score, reasons };
}

const STRONG_INFERENCE: VCScoringV2InferenceLike = {
  market: makeTrace(true, ['Growth rate signal present — implies expanding market.', 'Revenue evidence without explicit TAM — market implied by traction.'], 83, 72),
  product: makeTrace(true, ['Revenue present — product has demonstrated exchangeability.', 'ARR/MRR present — recurring usage implies product retention.'], 88, 69),
  team: makeTrace(true, ['No team penalty signals — assuming adequate team composition.'], 50, 46),
  traction: makeTrace(true, ['Revenue present — commercial traction confirmed.', 'Growth rate present — directional momentum confirmed.'], 70, 54),
};

const NO_BOOST_INFERENCE: VCScoringV2InferenceLike = {
  market: makeTrace(false, ['No market inference boost — structured market score used as-is.'], 55, 55),
  product: makeTrace(false, ['No product signals — inference at floor.'], 40, 40),
  team: makeTrace(false, ['No team penalty signals — assuming adequate team composition.'], 50, 50),
  traction: makeTrace(false, ['No traction signals — scored at minimum floor.'], 30, 30),
};

// ─── VCScoringV2InferencePanel ────────────────────────────────────────────────

describe('VCScoringV2InferencePanel', () => {
  it('renders the panel container', () => {
    render(<VCScoringV2InferencePanel inference={STRONG_INFERENCE} darkMode={false} />);
    expect(screen.getByTestId('vc-inference-panel')).toBeInTheDocument();
  });

  it('shows "Signal inference active" header badge when any dimension boosted', () => {
    render(<VCScoringV2InferencePanel inference={STRONG_INFERENCE} darkMode={false} />);
    expect(screen.getByText('Signal inference active')).toBeInTheDocument();
  });

  it('does not show "Signal inference active" when no dimensions boosted', () => {
    render(<VCScoringV2InferencePanel inference={NO_BOOST_INFERENCE} darkMode={false} />);
    expect(screen.queryByText('Signal inference active')).not.toBeInTheDocument();
  });

  it('renders Boosted badge for every boosted dimension', () => {
    render(<VCScoringV2InferencePanel inference={STRONG_INFERENCE} darkMode={false} />);
    expect(screen.getByTestId('inference-badge-market')).toHaveTextContent('Boosted');
    expect(screen.getByTestId('inference-badge-product')).toHaveTextContent('Boosted');
    expect(screen.getByTestId('inference-badge-team')).toHaveTextContent('Boosted');
    expect(screen.getByTestId('inference-badge-traction')).toHaveTextContent('Boosted');
  });

  it('renders No Boost badge for unboosted dimensions', () => {
    render(<VCScoringV2InferencePanel inference={NO_BOOST_INFERENCE} darkMode={false} />);
    expect(screen.getByTestId('inference-badge-market')).toHaveTextContent('No Boost');
    expect(screen.getByTestId('inference-badge-product')).toHaveTextContent('No Boost');
    expect(screen.getByTestId('inference-badge-team')).toHaveTextContent('No Boost');
    expect(screen.getByTestId('inference-badge-traction')).toHaveTextContent('No Boost');
  });

  it('shows the final score for each dimension', () => {
    render(<VCScoringV2InferencePanel inference={STRONG_INFERENCE} darkMode={false} />);
    expect(screen.getByTestId('inference-final-market')).toHaveTextContent('72');
    expect(screen.getByTestId('inference-final-product')).toHaveTextContent('69');
    expect(screen.getByTestId('inference-final-team')).toHaveTextContent('46');
    expect(screen.getByTestId('inference-final-traction')).toHaveTextContent('54');
  });

  it('renders reasons for each dimension', () => {
    render(<VCScoringV2InferencePanel inference={STRONG_INFERENCE} darkMode={false} />);
    // Market reasons
    const marketReasons = screen.getByTestId('inference-reasons-market');
    expect(marketReasons).toHaveTextContent('Growth rate signal present');
    // Product reasons
    const productReasons = screen.getByTestId('inference-reasons-product');
    expect(productReasons).toHaveTextContent('Revenue present');
    expect(productReasons).toHaveTextContent('ARR/MRR present');
  });

  it('renders all four dimension labels', () => {
    render(<VCScoringV2InferencePanel inference={STRONG_INFERENCE} darkMode={false} />);
    expect(screen.getByText('Market')).toBeInTheDocument();
    expect(screen.getByText('Product')).toBeInTheDocument();
    expect(screen.getByText('Team')).toBeInTheDocument();
    expect(screen.getByText('Traction')).toBeInTheDocument();
  });

  it('renders cleanly in dark mode without crashing', () => {
    render(<VCScoringV2InferencePanel inference={STRONG_INFERENCE} darkMode={true} />);
    expect(screen.getByTestId('vc-inference-panel')).toBeInTheDocument();
  });

  it('renders cleanly with an empty reasons array', () => {
    const sparseInference: VCScoringV2InferenceLike = {
      ...STRONG_INFERENCE,
      team: makeTrace(true, [], 50, 46),
    };
    render(<VCScoringV2InferencePanel inference={sparseInference} darkMode={false} />);
    // Should not crash — team row renders without reasons list
    expect(screen.getByTestId('inference-badge-team')).toHaveTextContent('Boosted');
  });
});
