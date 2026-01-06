import { describe, expect, it } from 'vitest';

import {
  formatBarChartTruncationLabel,
  getBarChartPreviewModel,
} from '../components/deals/tabs/DealAnalystTab';

describe('getBarChartPreviewModel', () => {
  it('returns null for malformed structured_json', () => {
    expect(getBarChartPreviewModel(null)).toBeNull();
    expect(getBarChartPreviewModel({})).toBeNull();
    expect(getBarChartPreviewModel({ chart: {} })).toBeNull();
    expect(getBarChartPreviewModel({ chart: { type: 'bar' } })).toBeNull();
    expect(
      getBarChartPreviewModel({ chart: { type: 'bar', series: [{ values: [] }] } })
    ).toBeNull();
  });

  it('caps bars and returns truncation label', () => {
    const values = Array.from({ length: 30 }, (_, i) => i + 1);
    const model = getBarChartPreviewModel(
      {
        chart: {
          type: 'bar',
          method: 'bar_pixels_v1',
          confidence: 0.66,
          series: [{ values }],
        },
      },
      { maxBars: 24 }
    );

    expect(model).not.toBeNull();
    expect(model?.totalBars).toBe(30);
    expect(model?.shownBars).toBe(24);
    expect(model?.truncated).toBe(true);
    expect(formatBarChartTruncationLabel(model!)).toBe('Showing first 24 of 30 bars');
    expect(model?.values).toHaveLength(24);
    expect(model?.labels).toHaveLength(24);
  });

  it('uses x_labels when lengths match; otherwise falls back to indices', () => {
    const withLabels = getBarChartPreviewModel({
      chart: {
        type: 'bar',
        x_labels: ['A', 'B', 'C'],
        series: [{ values: [10, 20, 30] }],
      },
    });
    expect(withLabels?.labels).toEqual(['A', 'B', 'C']);

    const mismatch = getBarChartPreviewModel({
      chart: {
        type: 'bar',
        x_labels: ['A', 'B'],
        series: [{ values: [10, 20, 30] }],
      },
    });
    expect(mismatch?.labels).toEqual(['1', '2', '3']);
  });

  it('sets normalized warning when values_are_normalized is true', () => {
    const model = getBarChartPreviewModel({
      chart: {
        type: 'bar',
        series: [{ values: [0.5, 1, 0.25], values_are_normalized: true }],
      },
    });
    expect(model?.valuesAreNormalized).toBe(true);
  });
});
