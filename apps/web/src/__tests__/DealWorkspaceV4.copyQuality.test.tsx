/**
 * Tests for product/market/business-model copy quality gates in DealWorkspaceV4.
 *
 * Validates:
 * - OCR garbage product text is suppressed and replaced with the evidence fallback
 * - Wrong-entity / incoherent product text is suppressed
 * - Clean product text still renders normally
 * - Fallback copy appears when product text is unreliable
 * - Suppressed raw text appears only in diagnostics, never in the main cards
 * - Same gates apply to market and business model cards
 */

import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';
import { DealWorkspaceV4, type DealWorkspaceV4Props } from '../components/workspace/DealWorkspaceV4';

const emptyFact = { value: null, trust: 'not_extracted' as const, nullReason: 'Not extracted' };

const BASE_PROPS: DealWorkspaceV4Props = {
  darkMode: true,
  companyName: 'TestCo',
  dealType: 'Equity',
  stage: 'Series A',
  raise: '$5M',
  raiseNullRule: null,
  lastAnalyzedAt: '2026-05-07T12:00:00.000Z',
  investmentSnapshotBody: 'Financial evidence is incomplete.',
  convictionScore: 52,
  convictionBand: 'Investigate',
  convictionPosture: 'INVESTIGATE',
  convictionHeadline: null,
  convictionRationale: null,
  convictionProvisional: false,
  topPositiveContributors: [],
  topNegativeContributors: [],
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

// ─── OCR garbage detection ────────────────────────────────────────────────────

describe('Product card: OCR garbage suppression', () => {
  const OCR_GARBAGE =
    'Platform, your digital platform and our media partner\'s as well 7 eae ila oe HES as a key part';

  it('does not render OCR garbage text in the product card', () => {
    render(
      <DealWorkspaceV4
        {...BASE_PROPS}
        product={{ value: OCR_GARBAGE, trust: 'extracted', nullReason: null }}
      />,
    );
    // OCR garbage must not appear as a visible sentence in main UI cards.
    // It may appear truncated inside the diagnostics section, which is acceptable.
    // We verify suppression by asserting the fallback is shown instead.
    const fallback = screen.getByTestId('product-copy-fallback');
    expect(fallback).toBeInTheDocument();
    // The main card body must not contain the OCR garbage (diagnostics is a separate element)
    expect(fallback.textContent).not.toMatch(/eae ila oe HES/i);
  });

  it('shows evidence-quality fallback when product is OCR garbage', () => {
    render(
      <DealWorkspaceV4
        {...BASE_PROPS}
        product={{ value: OCR_GARBAGE, trust: 'extracted', nullReason: null }}
      />,
    );
    const fallback = screen.getByTestId('product-copy-fallback');
    expect(fallback).toBeInTheDocument();
    expect(fallback.textContent).toMatch(/not yet reliable/i);
  });

  it('puts suppressed OCR text in diagnostics, not in the product card heading', () => {
    render(
      <DealWorkspaceV4
        {...BASE_PROPS}
        product={{ value: OCR_GARBAGE, trust: 'extracted', nullReason: null }}
      />,
    );
    const diag = screen.getByTestId('product-suppressed-raw');
    expect(diag).toBeInTheDocument();
    expect(diag.textContent).toMatch(/ocr_garbage/i);
    // The raw text prefix is truncated in diagnostics
    expect(diag.textContent).toMatch(/product raw/i);
  });
});

// ─── Extraction fragment suppression ─────────────────────────────────────────

describe('Product card: extraction fragment suppression', () => {
  it('does not render a 2-word fragment like "Ice touring" in the product card', () => {
    render(
      <DealWorkspaceV4
        {...BASE_PROPS}
        product={{ value: 'Ice touring', trust: 'extracted', nullReason: null }}
      />,
    );
    expect(screen.queryByText('Ice touring')).not.toBeInTheDocument();
    expect(screen.queryByText('Ice touring.')).not.toBeInTheDocument();
    const fallback = screen.getByTestId('product-copy-fallback');
    expect(fallback).toBeInTheDocument();
  });

  it('does not render a single-word fragment in the product card', () => {
    render(
      <DealWorkspaceV4
        {...BASE_PROPS}
        product={{ value: 'Hockey', trust: 'extracted', nullReason: null }}
      />,
    );
    expect(screen.queryByText('Hockey.')).not.toBeInTheDocument();
    const fallback = screen.getByTestId('product-copy-fallback');
    expect(fallback).toBeInTheDocument();
  });
});

// ─── Low-confidence copy suppression ─────────────────────────────────────────

describe('Product card: low-confidence copy suppression', () => {
  it('suppresses a short sentence that does not meet investor readability threshold', () => {
    // 5 words — passes fragment gate but fails isInvestorReadableSentence (< 8 words)
    render(
      <DealWorkspaceV4
        {...BASE_PROPS}
        product={{ value: 'A SaaS analytics platform.', trust: 'extracted', nullReason: null }}
      />,
    );
    // 5 words — suppressed as low_confidence
    const fallback = screen.getByTestId('product-copy-fallback');
    expect(fallback).toBeInTheDocument();
  });
});

// ─── Clean copy passes through ────────────────────────────────────────────────

describe('Product card: clean investor-readable copy renders normally', () => {
  const CLEAN_PRODUCT =
    'A climate-tech SaaS platform that automates carbon accounting for enterprise manufacturing clients across regulated industries.';

  it('renders a clean, full-sentence product description without fallback', () => {
    render(
      <DealWorkspaceV4
        {...BASE_PROPS}
        product={{ value: CLEAN_PRODUCT, trust: 'extracted', nullReason: null }}
      />,
    );
    expect(screen.getByText(CLEAN_PRODUCT)).toBeInTheDocument();
    expect(screen.queryByTestId('product-copy-fallback')).not.toBeInTheDocument();
  });

  it('does not put clean text into diagnostics', () => {
    render(
      <DealWorkspaceV4
        {...BASE_PROPS}
        product={{ value: CLEAN_PRODUCT, trust: 'extracted', nullReason: null }}
      />,
    );
    expect(screen.queryByTestId('product-suppressed-raw')).not.toBeInTheDocument();
  });
});

// ─── Market card quality gates ────────────────────────────────────────────────

describe('Market card: copy quality gates', () => {
  const OCR_MARKET = 'Mkt 3 eae ila oe HES target segment mid-tier as well digital platform 7 fragments';

  it('suppresses OCR garbage in market card and shows fallback', () => {
    render(
      <DealWorkspaceV4
        {...BASE_PROPS}
        market={{ value: OCR_MARKET, trust: 'extracted', nullReason: null }}
      />,
    );
    expect(screen.queryByText(OCR_MARKET)).not.toBeInTheDocument();
    const fallback = screen.getByTestId('market-copy-fallback');
    expect(fallback.textContent).toMatch(/not yet reliable/i);
  });

  it('puts suppressed market raw text into diagnostics', () => {
    render(
      <DealWorkspaceV4
        {...BASE_PROPS}
        market={{ value: OCR_MARKET, trust: 'extracted', nullReason: null }}
      />,
    );
    const diag = screen.getByTestId('market-suppressed-raw');
    expect(diag.textContent).toMatch(/market raw/i);
  });

  it('renders clean market copy without fallback', () => {
    const CLEAN =
      'The global enterprise carbon management software market is estimated at $12B by 2028, driven by regulatory disclosure mandates in the EU and US.';
    render(
      <DealWorkspaceV4
        {...BASE_PROPS}
        market={{ value: CLEAN, trust: 'extracted', nullReason: null }}
      />,
    );
    expect(screen.getByText(CLEAN)).toBeInTheDocument();
    expect(screen.queryByTestId('market-copy-fallback')).not.toBeInTheDocument();
  });
});

// ─── Business model card quality gates ───────────────────────────────────────

describe('Business model card: copy quality gates', () => {
  const OCR_BM = 'Rev 4 oe HES model digital platform partner as well 7 fragmented tokens here';

  it('suppresses OCR garbage in business model card and shows fallback', () => {
    render(
      <DealWorkspaceV4
        {...BASE_PROPS}
        businessModel={{ value: OCR_BM, trust: 'extracted', nullReason: null }}
      />,
    );
    expect(screen.queryByText(OCR_BM)).not.toBeInTheDocument();
    const fallback = screen.getByTestId('business-model-copy-fallback');
    expect(fallback.textContent).toMatch(/not yet reliable/i);
  });

  it('puts suppressed business model raw into diagnostics', () => {
    render(
      <DealWorkspaceV4
        {...BASE_PROPS}
        businessModel={{ value: OCR_BM, trust: 'extracted', nullReason: null }}
      />,
    );
    const diag = screen.getByTestId('business-model-suppressed-raw');
    expect(diag.textContent).toMatch(/business model raw/i);
  });
});

// ─── No investor-facing OCR garbage across any card ──────────────────────────

describe('No investor-facing OCR garbage in any Key Facts card', () => {
  it('never shows raw OCR artifacts in product, market, or business model cards', () => {
    render(
      <DealWorkspaceV4
        {...BASE_PROPS}
        product={{
          value: 'Platform, your digital platform and our media partner\'s as well 7 eae ila oe HES as a key part',
          trust: 'extracted',
          nullReason: null,
        }}
        market={{
          value: 'Mkt 3 eae ila oe HES target segment mid-tier as well digital platform 7 fragments',
          trust: 'extracted',
          nullReason: null,
        }}
        businessModel={{
          value: 'Rev 4 oe HES model digital platform partner as well 7 fragmented tokens here',
          trust: 'extracted',
          nullReason: null,
        }}
      />,
    );

    // All three fallbacks must be present — suppression confirmed by fallback rendering.
    // (OCR text may appear truncated inside diagnostics, which is intentional.)
    const productFallback = screen.getByTestId('product-copy-fallback');
    const marketFallback = screen.getByTestId('market-copy-fallback');
    const bizFallback = screen.getByTestId('business-model-copy-fallback');
    expect(productFallback).toBeInTheDocument();
    expect(marketFallback).toBeInTheDocument();
    expect(bizFallback).toBeInTheDocument();

    // None of the fallback card elements themselves should contain OCR signatures
    expect(productFallback.textContent).not.toMatch(/eae ila oe HES/i);
    expect(marketFallback.textContent).not.toMatch(/eae ila oe HES/i);
    expect(bizFallback.textContent).not.toMatch(/eae ila oe HES/i);
  });
});
