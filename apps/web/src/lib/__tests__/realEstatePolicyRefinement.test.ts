import { describe, expect, test } from 'vitest';

import {
  applyPolicyAwareAdvisoryAsks,
  getRealEstateDealStructureFallback,
  selectBestRealEstateSemanticField,
} from '../realEstatePolicyRefinement';

describe('selectBestRealEstateSemanticField', () => {
  test('asset/facility chooses facility identity over generic bullet', () => {
    const result = selectBestRealEstateSemanticField('asset_facility', [
      { value: 'Protection against final costs', source: 'generic-bullet', lane: 'deterministic' },
      { value: 'Build-to-suit 48-bed inpatient rehabilitation facility in Albuquerque', source: 'structured-summary', lane: 'governed' },
    ]);

    expect(result.value).toBe('Build-to-suit 48-bed inpatient rehabilitation facility in Albuquerque');
    expect(result.lane).toBe('governed');
    expect(result.source).toBe('structured-summary');
  });

  test('submarket/demand chooses referral/location demand text', () => {
    const result = selectBestRealEstateSemanticField('submarket_demand', [
      { value: 'Large market opportunity', source: 'generic', lane: 'fallback' },
      { value: 'Located near major hospitals with limited IRF competition and strong referral density', source: 'market-summary', lane: 'deterministic' },
    ]);

    expect(result.value).toContain('major hospitals');
    expect(result.value).toContain('referral');
  });

  test('submarket/demand rejects lease-heavy sentence when demand/location context exists', () => {
    const result = selectBestRealEstateSemanticField('submarket_demand', [
      {
        value: '20-year NNN lease with annual escalations and construction timeline milestones',
        source: 'lease-heavy',
        lane: 'governed',
      },
      {
        value: 'Albuquerque medical corridor with proximity to four major hospitals and strong referral demand',
        source: 'demand-location',
        lane: 'deterministic',
      },
    ]);

    expect(result.source).toBe('demand-location');
    expect(result.value).toContain('Albuquerque');
    expect(result.rejected.some((r) => r.source === 'lease-heavy' && r.reason === 'lease_heavy_mismatch')).toBe(true);
  });

  test('deal structure rejects operator model and prefers capital/lease structure', () => {
    const result = selectBestRealEstateSemanticField('deal_structure', [
      { value: 'Operator delivers high-quality patient care model', source: 'operator-summary', lane: 'deterministic' },
      { value: '75% LTC construction loan plus preferred equity and sponsor equity with 20-year NNN lease', source: 'raise-terms', lane: 'governed' },
    ]);

    expect(result.value).toContain('preferred equity');
    expect(result.value).toContain('NNN lease');
    expect(result.rejected.some((r) => r.source === 'operator-summary')).toBe(true);
  });

  test('returns null when only weak generic candidates exist', () => {
    const result = selectBestRealEstateSemanticField('asset_facility', [
      { value: 'Strong management team', source: 'generic-a', lane: 'fallback' },
      { value: 'Large market opportunity', source: 'generic-b', lane: 'deterministic' },
    ]);

    expect(result.value).toBeNull();
    expect(result.lane).toBe('missing');
  });

  test('suppresses duplicates when excluded values are provided', () => {
    const result = selectBestRealEstateSemanticField(
      'submarket_demand',
      [
        {
          value: 'Build-to-suit 48-bed inpatient rehabilitation facility in Albuquerque',
          source: 'market-candidate-duplicate',
          lane: 'governed',
        },
        {
          value: 'Under-supplied submarket with strong referral demand from nearby hospitals',
          source: 'market-candidate-unique',
          lane: 'deterministic',
        },
      ],
      {
        excludeValues: ['Build-to-suit 48-bed inpatient rehabilitation facility in Albuquerque'],
      },
    );

    expect(result.value).toContain('Under-supplied submarket');
    expect(result.rejected.some((r) => r.source === 'market-candidate-duplicate' && r.reason === 'duplicate_value')).toBe(true);
  });

  test('uses lane and input order as deterministic tie-breaks', () => {
    const result = selectBestRealEstateSemanticField('asset_facility', [
      { value: 'Single-tenant healthcare facility with long-term lease', source: 'det-a', lane: 'deterministic' },
      { value: 'Single-tenant healthcare facility with long-term lease', source: 'gov-b', lane: 'governed' },
      { value: 'Single-tenant healthcare facility with long-term lease', source: 'gov-c', lane: 'governed' },
    ]);

    expect(result.source).toBe('gov-b');
    expect(result.lane).toBe('governed');
  });
});

describe('applyPolicyAwareAdvisoryAsks', () => {
  test('suppresses startup asks and injects real-estate underwriting asks', () => {
    const refined = applyPolicyAwareAdvisoryAsks({
      policyFamily: 'real_estate',
      asks: [
        'Confirm ARR/MRR trend and payback period.',
        'Validate CAC/LTV assumptions.',
        'Confirm burn and runway sensitivity.',
      ],
    });

    const all = refined.asks.join(' | ').toLowerCase();
    expect(all).not.toMatch(/arr|mrr|cac|ltv|payback|burn|runway/);
    expect(all).toContain('noi');
    expect(all).toContain('lease term');
    expect(all).toContain('ltc');
    expect(refined.replacementApplied).toBe(true);
    expect(refined.source).toBe('real_estate_refined');
  });

  test('keeps startup asks unchanged for startup policy', () => {
    const asks = ['Confirm ARR growth trajectory.', 'Validate CAC payback period.'];
    const refined = applyPolicyAwareAdvisoryAsks({
      policyFamily: 'startup',
      asks,
    });

    expect(refined.asks).toEqual(asks);
    expect(refined.replacementApplied).toBe(false);
    expect(refined.source).toBe('original');
  });
});

describe('getRealEstateDealStructureFallback', () => {
  test('returns preferred-equity fallback when context indicates preferred equity', () => {
    expect(getRealEstateDealStructureFallback('real estate preferred equity investment with sponsor equity')).toBe('Preferred equity development investment');
  });

  test('returns structured investment fallback otherwise', () => {
    expect(getRealEstateDealStructureFallback('general real estate development')).toBe('Real estate structured investment');
  });
});
