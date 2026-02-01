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

test('TIE-BREAK (vision): "Launch Markets" resolves market vs distribution', () => {
  // Keep distribution terms out of the inferred title/headings (first ~12 OCR lines)
  // so we exercise the tie-breaker rather than the TITLE_MATCH override.
  const filler = Array.from({ length: 12 }, (_, i) => `Filler line ${i + 1}`).join('\n');
  const out = classifySegment({
    ocr_text: `Market TAM SAM\nInitial Launch Markets\n${filler}\nSales Marketing Partnerships`,
    quality_source: 'vision_v1',
    extractor_version: 'vision_v1',
    enable_debug: true,
  });

  assert.equal(out.segment, 'market');
  assert.equal((out.debug as any)?.override_rule_id, 'TIE_BREAK_STRONG_CUE');
});

test('VISION: Garbled OCR title but intro body routes to overview (early pages)', () => {
  const out = classifySegment({
    // First line resembles a bad title OCR; later lines carry the actual intro.
    ocr_text: [
      'SiGe eNlelie OW lel Hee iy',
      '3ICE is a healthy social beverage brand',
      'Our mission is to help you celebrate responsibly wherever people socialize',
    ].join('\n'),
    page_index: 0,
    quality_source: 'vision_v1',
    extractor_version: 'vision_v1',
    enable_debug: true,
  });

  assert.equal(out.segment, 'overview');
  assert.ok(out.confidence >= 0.5);
});

test('VISION: CPG product description without "Product" heading routes to product', () => {
  const out = classifySegment({
    ocr_text:
      'VERSE IS A HEALTHY SOCIAL BEVERAGE THAT HELPS YOU CELEBRATE RESPONSIBLY\n'
      + 'Functional Ingredients that elevate mood, detoxify the body, and provide everyday vitality\n'
      + 'Non-Carbonated Fruit Juice Flavors\n'
      + 'Zero-sugar: Cranberry Orange Pineapple\n'
      + 'Carbonated Flavor to Expand\n'
      + 'Sizes: Social Size 1L | Individual Size 375mL',
    page_index: 3,
    quality_source: 'vision_v1',
    extractor_version: 'vision_v1',
    enable_debug: true,
  });

  assert.equal(out.segment, 'product');
  assert.ok(out.confidence >= 0.5);
});

test('VISION: "Market Overview" should not route to overview', () => {
  const out = classifySegment({
    ocr_text: 'Market Overview\nTAM SAM SOM\nCAGR and market sizing',
    page_index: 2,
    quality_source: 'vision_v1',
    extractor_version: 'vision_v1',
    enable_debug: true,
  });
  assert.equal(out.segment, 'market');
});

test('VISION: Detected header is validated against copy (header mismatch does not force segment)', () => {
  const out = classifySegment({
    // OCR-derived "title" would be "Traction" (first line), but body copy is clearly pricing/business model.
    ocr_text: [
      'Traction',
      'Pricing',
      'Subscription plans and tiers',
      'Unit economics: ARPU take rate',
      'How we make money',
    ].join('\n'),
    page_index: 4,
    quality_source: 'vision_v1',
    extractor_version: 'vision_v1',
    enable_debug: true,
  });

  assert.equal(out.segment, 'business_model');
  assert.equal((out.debug as any)?.applied_header, 'Business Model');
});
