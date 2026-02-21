import { describe, test, expect } from 'vitest';
import { stripMismatchedScorePhrase, filterMismatchedScoreItems, stripScoreFractions, stripScoreFractionsFromItems } from '../lib/sanitizeScorePhrases';

describe('stripMismatchedScorePhrase', () => {
  test('removes NN/100 when NN does not match canonical score', () => {
    expect(stripMismatchedScorePhrase('Strong recommendation score of 67/100', 48)).toBe('');
  });

  test('keeps NN/100 when NN equals canonical score', () => {
    const result = stripMismatchedScorePhrase('Score is 48/100 for this deal', 48);
    expect(result).toContain('48/100');
  });

  test('removes mismatched value but leaves rest of sentence intact', () => {
    const result = stripMismatchedScorePhrase('Solid team and 67/100 growth metrics', 48);
    // The "67/100" is stripped but the surrounding text should remain
    expect(result).not.toMatch(/67\/100/);
    expect(result).toContain('Solid team');
    expect(result).toContain('growth metrics');
  });

  test('handles "NN / 100" (spaces around slash)', () => {
    const result = stripMismatchedScorePhrase('Rating of 67 / 100 assigned', 48);
    expect(result).not.toMatch(/67\s*\/\s*100/);
  });

  test('returns original text unchanged when canonicalScore is null', () => {
    const text = 'Score of 67/100 assigned';
    expect(stripMismatchedScorePhrase(text, null)).toBe(text);
  });

  test('returns original text unchanged when canonicalScore is undefined', () => {
    const text = 'Score of 67/100 assigned';
    expect(stripMismatchedScorePhrase(text, undefined)).toBe(text);
  });

  test('handles text with no score pattern — pass-through', () => {
    const text = 'Strong early commercial traction in enterprise';
    expect(stripMismatchedScorePhrase(text, 82)).toBe(text);
  });

  test('removes multiple mismatched scores in one string', () => {
    const result = stripMismatchedScorePhrase(
      'Pacing at 72/100, recommendation 67/100, solid execution',
      48,
    );
    expect(result).not.toMatch(/72\/100/);
    expect(result).not.toMatch(/67\/100/);
    expect(result).toContain('solid execution');
  });

  test('keeps 48/100 but removes 67/100 in the same string', () => {
    const result = stripMismatchedScorePhrase('Score 48/100; recommendation 67/100', 48);
    expect(result).toContain('48/100');
    expect(result).not.toMatch(/67\/100/);
  });

  test('returns empty string for "Strong recommendation score of 67/100" with canonical 82', () => {
    const result = stripMismatchedScorePhrase('Strong recommendation score of 67/100', 82);
    expect(result.trim()).toBe('');
  });
});

describe('filterMismatchedScoreItems', () => {
  test('drops items that become empty after stripping', () => {
    const result = filterMismatchedScoreItems(
      ['Strong recommendation score of 67/100', 'Solid MRR growth'],
      82,
    );
    expect(result).not.toContain('Strong recommendation score of 67/100');
    expect(result).toContain('Solid MRR growth');
    expect(result).toHaveLength(1);
  });

  test('passes through items with no score mentions', () => {
    const items = [
      'Strong recurring revenue with 120% NRR',
      'Experienced founding team',
      'Clear product-market fit',
    ];
    expect(filterMismatchedScoreItems(items, 82)).toEqual(items);
  });

  test('passes through items where NN matches canonical', () => {
    const items = ['Score 82/100 — excellent signals'];
    expect(filterMismatchedScoreItems(items, 82)).toEqual(items);
  });

  test('returns all items unchanged when canonicalScore is null (no report applied)', () => {
    const items = ['Score of 67/100 derived', 'Good growth'];
    expect(filterMismatchedScoreItems(items, null)).toEqual(items);
  });
});

describe('stripScoreFractions', () => {
  test('removes all NN/100 patterns unconditionally', () => {
    expect(stripScoreFractions('scored at 67/100 in analyst model')).not.toMatch(/67\/100/);
    expect(stripScoreFractions('scored at 67/100 in analyst model')).toContain('in analyst model');
  });

  test('removes contextual score phrase', () => {
    const result = stripScoreFractions('Strong recommendation score of 72/100 on this dimension.');
    expect(result).not.toMatch(/72\/100/);
    expect(result.trim().length).toBeGreaterThan(0); // surrounding text survives
  });

  test('removes "scored at N" phrase (no fraction)', () => {
    const result = stripScoreFractions('Growth metrics scored at 72 in model');
    expect(result).not.toMatch(/scored at 72/);
  });

  test('passes through text with no score patterns unchanged', () => {
    const text = 'Experienced founding team with deep domain knowledge.';
    expect(stripScoreFractions(text)).toBe(text);
  });

  test('returns empty string when only a score fraction remains', () => {
    expect(stripScoreFractions('67/100').trim()).toBe('');
  });

  test('handles "NN / 100" with spaces', () => {
    const result = stripScoreFractions('Score 67 / 100');
    expect(result).not.toMatch(/67\s*\/\s*100/);
  });
});

describe('stripScoreFractionsFromItems', () => {
  test('strips fractions from all items and removes items that become empty', () => {
    const items = [
      'scored at 67/100 in analyst model',      // fraction stripped, text survives
      '48/100',                                  // becomes empty → dropped
      'Experienced team with domain depth.',     // no change
    ];
    const result = stripScoreFractionsFromItems(items);
    expect(result).toHaveLength(2);
    expect(result[0]).toContain('in analyst model');
    expect(result[0]).not.toMatch(/67\/100/);
    expect(result[1]).toBe('Experienced team with domain depth.');
  });
});
