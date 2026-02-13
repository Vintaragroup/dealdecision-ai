import { describe, expect, test } from 'vitest';

import { deterministicIsDisplayable } from './deterministicDisplayPolicy';

describe('deterministicIsDisplayable', () => {
  test('rejects OCR soup / header fragments', () => {
    expect(
      deterministicIsDisplayable(
        'From Visa/Mastercard From Users FREE to use + monetized via premium features Ze Ze € 1.9% 1% 10 imo',
      ),
    ).toBe(false);
  });

  test('rejects long slide-dump strings', () => {
    expect(
      deterministicIsDisplayable(
        'a Powering Every Shared Payment Market Cino’s target (100M users ICP) (annual) Cino Card (Today) €15.5B €155M 10% penet…. Market context: | a Were growing a. Organic',
      ),
    ).toBe(false);
  });

  test('accepts short clean strings', () => {
    expect(deterministicIsDisplayable('DTC Ecommerce')).toBe(true);
    expect(deterministicIsDisplayable('Usage-based SaaS')).toBe(true);
    expect(deterministicIsDisplayable('$2M Seed')).toBe(true);
  });
});
