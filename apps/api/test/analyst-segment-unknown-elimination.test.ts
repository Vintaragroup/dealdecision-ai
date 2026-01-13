import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classifySegment } from '../src/lib/analyst-segment';

test('TITLE-FIRST: "Products" routes to product (not distribution)', () => {
  const out = classifySegment({
    structured_json: { kind: 'powerpoint_slide', title: 'Products', bullets: ['Channels', 'GTM'], notes: '' },
    quality_source: 'structured_powerpoint',
    extractor_version: 'structured_native_v1',
    enable_debug: true,
  });

  assert.equal(out.segment, 'product');
  assert.equal(out.confidence, 0.95);
});

test('TITLE-FIRST: "Market Problem" routes to problem (not market sizing)', () => {
  const out = classifySegment({
    structured_json: { kind: 'powerpoint_slide', title: 'Market Problem', bullets: ['Pain points', 'Inefficient'], notes: '' },
    quality_source: 'structured_powerpoint',
    extractor_version: 'structured_native_v1',
    enable_debug: true,
  });

  assert.equal(out.segment, 'problem');
  assert.equal(out.confidence, 0.95);
});

test('TITLE-FIRST: "Traction" does not classify as raise_terms', () => {
  const out = classifySegment({
    structured_json: { kind: 'powerpoint_slide', title: 'Traction', bullets: ['ARR $2.5M', 'Customers: 120'], notes: '' },
    quality_source: 'structured_powerpoint',
    extractor_version: 'structured_native_v1',
    enable_debug: true,
  });

  assert.equal(out.segment, 'traction');
  assert.notEqual(out.segment, 'raise_terms');
});

test('Unknown reason codes are limited to NO_TEXT | LOW_SIGNAL | AMBIGUOUS_TIE', () => {
  const noText = classifySegment({
    ocr_text: '',
    quality_source: 'vision_v1',
    extractor_version: 'vision_v1',
    enable_debug: true,
    include_debug_text_snippet: true,
  });
  assert.equal(noText.segment, 'unknown');
  assert.equal((noText.debug as any)?.unknown_reason_code, 'NO_TEXT');

  const lowSignal = classifySegment({
    ocr_text: 'Section header and intro',
    quality_source: 'vision_v1',
    extractor_version: 'vision_v1',
    enable_debug: true,
    include_debug_text_snippet: true,
  });
  assert.equal(lowSignal.segment, 'unknown');
  assert.equal((lowSignal.debug as any)?.unknown_reason_code, 'LOW_SIGNAL');

  const ambiguous = classifySegment({
    structured_json: {
      kind: 'word_section',
      heading: 'Details',
      // Deliberately includes strong terms from two segments.
      paragraphs: ['Pricing and unit economics', 'Customers ARR MRR revenue'],
    },
    quality_source: 'structured_word',
    extractor_version: 'structured_native_v1',
    enable_debug: true,
    include_debug_text_snippet: true,
  });
  assert.equal(ambiguous.segment, 'unknown');
  assert.equal((ambiguous.debug as any)?.unknown_reason_code, 'AMBIGUOUS_TIE');

  for (const out of [noText, lowSignal, ambiguous]) {
    const code = (out.debug as any)?.unknown_reason_code;
    assert.ok(['NO_TEXT', 'LOW_SIGNAL', 'AMBIGUOUS_TIE'].includes(code), `unexpected unknown_reason_code: ${String(code)}`);
  }
});
