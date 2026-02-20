import { describe, expect, test } from 'vitest';
import { normalizeDealSummaryParagraphs } from '../lib/normalizeDealSummaryParagraphs';

describe('normalizeDealSummaryParagraphs', () => {
  test('splits on blank lines, trims, and dedupes', () => {
    const input = 'Para 1\n\nPara 2\n\nPara 1\n\n  Para 3  ';
    expect(normalizeDealSummaryParagraphs(input)).toEqual(['Para 1', 'Para 2', 'Para 3']);
  });

  test('accepts arrays and ignores non-strings', () => {
    const input = [' A ', null as any, 'B', 'a', ''];
    expect(normalizeDealSummaryParagraphs(input, { maxParagraphs: 10 })).toEqual(['A', 'B']);
  });
});
