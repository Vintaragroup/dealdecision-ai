import { describe, expect, test } from 'vitest';
import { selectDealWorkspaceOverviewModel } from '../lib/selectors/selectDealWorkspaceOverviewModel';

describe('selectDealWorkspaceOverviewModel', () => {
  test('prefers deterministic values over overlay', () => {
    const model = selectDealWorkspaceOverviewModel({
      deterministic: {
        summaries: {
          short: { value: 'Det short' },
          long: { value: null },
          longParagraphsFallback: ['Det para 1'],
        },
        keyFacts: {
          product: { value: 'Det product' },
          market: { value: '' },
          business_model: { value: '—' },
          raise_terms: { value: null },
        },
      },
      overlay: {
        summaries: {
          short: { value: 'Overlay short' },
          longParagraphs: ['Overlay para'],
        },
        keyFacts: {
          product: { value: 'Overlay product' },
          market: { value: 'Overlay market' },
          business_model: { value: 'Overlay bm' },
          raise_terms: { value: 'Overlay raise' },
        },
      },
    });

    expect(model.summaries.short.value).toBe('Det short');
    expect(model.summaries.long.paragraphs).toEqual(['Det para 1']);
    expect(model.keyFacts.product.value).toBe('Det product');

    // Deterministic market missing => overlay fills it.
    expect(model.keyFacts.market.value).toBe('Overlay market');
    expect(model.keyFacts.market.origin).toBe('overlay');

    // Missing + overlay raise fills it.
    expect(model.keyFacts.raise_terms.value).toBe('Overlay raise');
    expect(model.keyFacts.raise_terms.origin).toBe('overlay');
  });

  test('returns missing sentinel when both sources are empty', () => {
    const model = selectDealWorkspaceOverviewModel({
      deterministic: {
        summaries: { short: { value: null }, long: { value: null } },
        keyFacts: {
          product: { value: null },
          market: { value: null },
          business_model: { value: null },
          raise_terms: { value: null },
        },
      },
      overlay: null,
    } as any);

    expect(model.summaries.short.origin).toBe('missing');
    expect(model.summaries.short.value).toBe('—');
    expect(model.keyFacts.product.value).toBe('—');
  });
});
