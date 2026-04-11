/**
 * P5 Phase 2 — deal-summary-v1-deterministic sanitization tests.
 *
 * Tests for:
 *   - "Unknown" sentinel suppression from KPI display fields
 *   - OCR percentage shard detection and suppression
 *   - Projected revenue labeling in deep tier
 */
import { buildDeterministicDealSummaryV1FromStructuredSummary } from '../deal-summary-v1-deterministic';

// ─── "Unknown" sentinel suppression ──────────────────────────────────────────

describe('buildDeterministicDealSummaryV1 — Phase 2: Unknown sentinel suppression', () => {
  it('suppresses "Unknown" from revenue display in deep tier', () => {
    const ss: any = {
      product_summary_v1: { value: 'AI-powered compliance platform.', sources: [] },
      revenue: { value: 'Unknown', sources: [] },
    };
    const result = buildDeterministicDealSummaryV1FromStructuredSummary({ structured_summary: ss });
    expect(result.tiers.deep).not.toContain('Unknown');
    expect(result.tiers.deep).not.toContain('Revenue');
  });

  it('suppresses "Unknown" from customers display in deep tier', () => {
    const ss: any = {
      product_summary_v1: { value: 'SaaS analytics platform.', sources: [] },
      customers: { value: 'Unknown', sources: [] },
    };
    const result = buildDeterministicDealSummaryV1FromStructuredSummary({ structured_summary: ss });
    expect(result.tiers.deep).not.toContain('Unknown');
    expect(result.tiers.deep).not.toContain('Customers');
  });

  it('suppresses "Unknown" from growth display in deep tier', () => {
    const ss: any = {
      product_summary_v1: { value: 'Marketplace platform.', sources: [] },
      growth: { value: 'Unknown', sources: [] },
    };
    const result = buildDeterministicDealSummaryV1FromStructuredSummary({ structured_summary: ss });
    expect(result.tiers.deep).not.toContain('Unknown');
    expect(result.tiers.deep).not.toContain('Growth');
  });

  it('keeps valid revenue value in deep tier', () => {
    const ss: any = {
      product_summary_v1: { value: 'Platform for supply chain.', sources: [] },
      revenue: { value: { raw: '$500K', amount: 500_000 }, sources: [] },
    };
    const result = buildDeterministicDealSummaryV1FromStructuredSummary({ structured_summary: ss });
    expect(result.tiers.deep).toContain('Revenue');
    expect(result.tiers.deep).toContain('$500K');
  });

  it('keeps valid customers value in deep tier', () => {
    const ss: any = {
      product_summary_v1: { value: 'B2B HR platform.', sources: [] },
      customers: { value: '45 enterprise clients', sources: [] },
    };
    const result = buildDeterministicDealSummaryV1FromStructuredSummary({ structured_summary: ss });
    expect(result.tiers.deep).toContain('Customers');
    expect(result.tiers.deep).toContain('45 enterprise clients');
  });

  it('raise "Unknown" sentinel is suppressed from overview tier', () => {
    // Raise guard already handled — value = "Unknown" should not surface in overview.
    const ss: any = {
      product_summary_v1: { value: 'AI SaaS platform.', sources: [] },
      raise: { value: 'Unknown', sources: [] },
    };
    const result = buildDeterministicDealSummaryV1FromStructuredSummary({ structured_summary: ss });
    expect(result.tiers.overview).not.toContain('Unknown');
  });
});

// ─── OCR shard suppression ────────────────────────────────────────────────────

describe('buildDeterministicDealSummaryV1 — Phase 2: OCR percentage shard suppression', () => {
  it('suppresses product_summary with bare percentage allocation shard from hero tier', () => {
    const ss: any = {
      product_summary_v1: { value: '20% 35% 45%', sources: [] },
      market_summary_v1: { value: 'Targets mid-market PE firms.', sources: [] },
    };
    const result = buildDeterministicDealSummaryV1FromStructuredSummary({ structured_summary: ss });
    // Hero falls back to market text (not the OCR shard)
    expect(result.tiers.hero).not.toContain('35%');
    expect(result.tiers.hero).toContain('mid-market');
  });

  it('suppresses product_summary with budget allocation shard from hero tier', () => {
    const ss: any = {
      product_summary_v1: { value: '50% Engineering 25% Sales 25% Operations', sources: [] },
      market_summary_v1: { value: 'B2B fintech platform targeting SMBs.', sources: [] },
    };
    const result = buildDeterministicDealSummaryV1FromStructuredSummary({ structured_summary: ss });
    expect(result.tiers.hero).not.toContain('Engineering');
    expect(result.tiers.hero).toContain('B2B fintech');
  });

  it('suppresses market_summary OCR shard from overview tier', () => {
    const ss: any = {
      product_summary_v1: { value: 'AI diagnostic tools for radiologists.', sources: [] },
      market_summary_v1: { value: '30% 40% 30%', sources: [] },
    };
    const result = buildDeterministicDealSummaryV1FromStructuredSummary({ structured_summary: ss });
    expect(result.tiers.overview).not.toContain('30%');
    // Overview should not include "Raise:" when there's no raise, and no market text
    expect(result.tiers.overview).toBe('');
  });

  it('suppresses BM shard from deep tier', () => {
    const ss: any = {
      product_summary_v1: { value: 'Healthcare SaaS.', sources: [] },
      business_model: { value: '60% Subscription 25% Services 15% Licensing', sources: [] },
    };
    const result = buildDeterministicDealSummaryV1FromStructuredSummary({ structured_summary: ss });
    expect(result.tiers.deep).not.toContain('Subscription');
    expect(result.tiers.deep).not.toContain('Business model');
  });

  it('leaves valid product text with a single percentage reference intact', () => {
    const ss: any = {
      product_summary_v1: { value: 'SaaS platform capturing 15% of SMB market with AI tools.', sources: [] },
    };
    const result = buildDeterministicDealSummaryV1FromStructuredSummary({ structured_summary: ss });
    expect(result.tiers.hero).toContain('SaaS platform');
    expect(result.tiers.hero).toContain('15%');
  });

  it('leaves valid text with two percentage references intact', () => {
    const ss: any = {
      product_summary_v1: { value: 'Platform enabling 30% cost reduction and 20% efficiency gains.', sources: [] },
    };
    const result = buildDeterministicDealSummaryV1FromStructuredSummary({ structured_summary: ss });
    expect(result.tiers.hero).toContain('30% cost reduction');
    expect(result.tiers.hero).toContain('20% efficiency gains');
  });
});

// ─── Projected revenue labeling ───────────────────────────────────────────────

describe('buildDeterministicDealSummaryV1 — Phase 2: projected revenue labeling', () => {
  it('labels revenue as "Revenue (projected):" when is_projected=true', () => {
    const ss: any = {
      product_summary_v1: { value: 'AI data platform.', sources: [] },
      revenue: {
        value: { raw: '$2M', amount: 2_000_000 },
        is_projected: true,
        sources: [],
      },
    };
    const result = buildDeterministicDealSummaryV1FromStructuredSummary({ structured_summary: ss });
    expect(result.tiers.deep).toContain('Revenue (projected):');
    expect(result.tiers.deep).toContain('$2M');
  });

  it('uses standard "Revenue:" label when is_projected=false', () => {
    const ss: any = {
      product_summary_v1: { value: 'Revenue-generating SaaS.', sources: [] },
      revenue: {
        value: { raw: '$1.5M', amount: 1_500_000 },
        is_projected: false,
        sources: [],
      },
    };
    const result = buildDeterministicDealSummaryV1FromStructuredSummary({ structured_summary: ss });
    expect(result.tiers.deep).not.toContain('projected');
    expect(result.tiers.deep).toContain('Revenue:');
    expect(result.tiers.deep).toContain('$1.5M');
  });

  it('uses standard "Revenue:" label when is_projected flag is absent', () => {
    const ss: any = {
      product_summary_v1: { value: 'Revenue-generating SaaS.', sources: [] },
      revenue: { value: { raw: '$3M' }, sources: [] },
    };
    const result = buildDeterministicDealSummaryV1FromStructuredSummary({ structured_summary: ss });
    expect(result.tiers.deep).not.toContain('projected');
    expect(result.tiers.deep).toContain('Revenue:');
  });
});

// ─── Regression: existing behavior unchanged ──────────────────────────────────

describe('buildDeterministicDealSummaryV1 — Phase 2 regression: valid inputs unchanged', () => {
  it('valid product + market + raise produce correct tiers', () => {
    const ss: any = {
      raise: {
        value: '$2M',
        value_json: { amount: { amount: 2_000_000, currency: 'USD' } },
        round_label: 'Seed',
        sources: [],
      },
      product_summary_v1: { value: 'WebMax builds diligence tooling for investors.', sources: [] },
      market_summary_v1: { value: 'Targets mid-market PE firms and VC analysts.', sources: [] },
    };
    const result = buildDeterministicDealSummaryV1FromStructuredSummary({ structured_summary: ss });
    expect(result.ready).toBe(true);
    expect(result.tiers.hero).toContain('WebMax');
    expect(result.tiers.overview).toContain('Raise: $2M');
    expect(result.tiers.overview).toContain('mid-market PE');
  });

  it('revenue without projection flag surfaces as plain "Revenue:" label', () => {
    const ss: any = {
      product_summary_v1: { value: 'Payments infra startup.', sources: [] },
      revenue: { value: { raw: '$750K' }, sources: [] },
      business_model: { value: 'SaaS', sources: [] },
    };
    const result = buildDeterministicDealSummaryV1FromStructuredSummary({ structured_summary: ss });
    expect(result.tiers.deep).toContain('Revenue: $750K');
    expect(result.tiers.deep).toContain('Business model: SaaS');
  });
});
