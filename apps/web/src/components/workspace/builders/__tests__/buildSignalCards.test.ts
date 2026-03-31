import { describe, expect, test } from 'vitest';

import { buildSignalCards } from '../buildSignalCards';

describe('buildSignalCards', () => {
  test('humanizes snake_case title values', () => {
    const cards = buildSignalCards(['market_icp'], [], 'med');
    expect(cards[0]?.title).toBe('Market Icp');
  });

  test('humanizes inline snake_case keys in sentence titles', () => {
    const cards = buildSignalCards([], ['Add evidence for missing sections: market_icp, business_model.'], 'low');
    expect(cards[0]?.title).toContain('Market Icp');
    expect(cards[0]?.title).toContain('Business Model');
  });
});
