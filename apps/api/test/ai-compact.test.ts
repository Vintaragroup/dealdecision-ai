import { test } from 'node:test';
import assert from 'node:assert/strict';

import { compactForAiSource } from '../src/lib/ai-compact';

test('compactForAiSource returns null when empty', () => {
  assert.equal(compactForAiSource({ structuredJson: null, ocrText: null }), null);
});

test('compactForAiSource compacts excel-like tables', () => {
  const out = compactForAiSource({
    structuredJson: {
      kind: 'excel_sheet',
      sheet_name: 'Revenue',
      table: {
        kind: 'time_series',
        value_cols: ['2024', '2025', '2026'],
        rows: [
          { label: 'Revenue', values: { '2024': { value: 100 }, '2025': { formula: '=A1' } } },
        ],
      },
    },
    ocrText: null,
  });
  assert.ok(out);
  assert.equal(out.kind, 'excel_sheet');
  assert.equal((out as any).sheet_name, 'Revenue');
  assert.ok((out as any).table);
});

test('compactForAiSource includes OCR text fallback', () => {
  const out = compactForAiSource({ structuredJson: null, ocrText: 'Hello world' });
  assert.ok(out);
  assert.equal((out as any).ocr_text, 'Hello world');
});
