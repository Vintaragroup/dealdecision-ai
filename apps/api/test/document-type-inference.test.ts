import { test } from 'node:test';
import assert from 'node:assert/strict';

import { inferDocumentTypeFromName } from '../src/lib/document-type-inference';

test('inferDocumentTypeFromName: spreadsheets -> financials', () => {
  assert.equal(inferDocumentTypeFromName({ fileName: 'Financial Model.xlsx' }), 'financials');
  assert.equal(inferDocumentTypeFromName({ fileName: 'data.csv' }), 'financials');
  assert.equal(
    inferDocumentTypeFromName({ mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', title: 'Anything' }),
    'financials'
  );
});

test('inferDocumentTypeFromName: pitch decks -> pitch_deck', () => {
  assert.equal(inferDocumentTypeFromName({ fileName: 'Deck.pptx' }), 'pitch_deck');
  assert.equal(inferDocumentTypeFromName({ title: 'Investor Deck - v3.pdf' }), 'pitch_deck');
  assert.equal(inferDocumentTypeFromName({ title: 'Executive Summary.docx' }), 'pitch_deck');
  assert.equal(inferDocumentTypeFromName({ fileName: 'PD - WebMax Investor Deck 2026.pdf' }), 'pitch_deck');
});

test('inferDocumentTypeFromName: product collateral -> product', () => {
  assert.equal(inferDocumentTypeFromName({ title: 'Cut Sheet - Scrubber Overview' }), 'product');
  assert.equal(inferDocumentTypeFromName({ fileName: 'WP - Scrubber Overview Cut Sheet.docx' }), 'product');
  assert.equal(inferDocumentTypeFromName({ title: 'One-Pager' }), 'product');
});

test('inferDocumentTypeFromName: keyword fallbacks', () => {
  assert.equal(inferDocumentTypeFromName({ title: 'Market TAM SAM SOM analysis' }), 'market');
  assert.equal(inferDocumentTypeFromName({ title: 'Mutual NDA' }), 'legal');
  assert.equal(inferDocumentTypeFromName({ title: 'Team Resume.pdf' }), 'team');
});

test('inferDocumentTypeFromName: unknown -> other', () => {
  assert.equal(inferDocumentTypeFromName({ title: 'Random Notes.txt' }), 'other');
});
