import { describe, expect, it } from 'vitest';

import { formatBboxLabel, getQualityFlagChips } from '../components/deals/tabs/DealAnalystTab';

describe('evidence formatters', () => {
  it('formats bbox values to 2 decimals', () => {
    expect(formatBboxLabel({ x: 0.1234, y: 0.5, w: 0.3333, h: 0.9876 })).toBe(
      'bbox x=0.12 y=0.50 w=0.33 h=0.99'
    );

    expect(formatBboxLabel(null)).toBeNull();
    expect(formatBboxLabel({ x: 'nope', y: 0, w: 1, h: 1 })).toBeNull();
  });

  it('extracts quality flag chips from object and caps with +N more', () => {
    const res = getQualityFlagChips(
      {
        low_contrast: true,
        blurry: true,
        empty: false,
        note: 'something',
      },
      { maxChips: 2 }
    );

    expect(res.chips).toEqual(['blurry', 'low_contrast']);
    expect(res.moreCount).toBe(1);
  });

  it('extracts quality flag chips from array', () => {
    const res = getQualityFlagChips(['a', 'b', 'a', ''], { maxChips: 8 });
    expect(res.chips).toEqual(['a', 'b']);
    expect(res.moreCount).toBe(0);
  });
});
