import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBrandModel, inferSlideTitleForSlide } from '../src/lib/slide-title';

test('blacklists repeated corner logo and selects headline', () => {
  const pages = [
    {
      ocr_blocks: [
        { text: 'Acme Capital', bbox: { x: 0.02, y: 0.05, w: 0.15, h: 0.02 } },
        { text: 'Seed Strategy Overview', bbox: { x: 0.25, y: 0.12, w: 0.5, h: 0.08 } },
      ],
    },
    {
      ocr_blocks: [
        { text: 'Acme Capital', bbox: { x: 0.80, y: 0.05, w: 0.15, h: 0.02 } },
        { text: 'Traction Highlights', bbox: { x: 0.30, y: 0.14, w: 0.4, h: 0.08 } },
      ],
    },
    {
      ocr_blocks: [
        { text: 'Acme Capital', bbox: { x: 0.02, y: 0.06, w: 0.15, h: 0.02 } },
        { text: 'Market Size', bbox: { x: 0.3, y: 0.15, w: 0.4, h: 0.08 } },
      ],
    },
  ];

  const brandModel = buildBrandModel(pages as any);
  assert.ok(brandModel.phrases.has('acme capital'));

  const res = inferSlideTitleForSlide({ blocks: pages[0].ocr_blocks as any, brandModel, enableDebug: true });

  assert.equal(res.slide_title, 'Seed Strategy Overview');
  assert.equal(res.slide_title_source, 'ocr_layout_v1');
  assert.ok(res.slide_title_confidence > 0.6);
});

test('prefers centered top headline', () => {
  const brandModel = buildBrandModel([]);
  const blocks = [
    { text: 'Northwind Markets', bbox: { x: 0.05, y: 0.06, w: 0.2, h: 0.02 } },
    { text: 'Market Problem', bbox: { x: 0.28, y: 0.18, w: 0.42, h: 0.09 } },
  ];

  const res = inferSlideTitleForSlide({ blocks: blocks as any, brandModel });

  assert.equal(res.slide_title, 'Market Problem');
  assert.equal(res.slide_title_source, 'ocr_layout_v1');
  assert.ok(res.slide_title_confidence >= 0.65);
});

test('falls back to ocr_text when no blocks', () => {
  const brandModel = buildBrandModel([]);
  const res = inferSlideTitleForSlide({
    blocks: null,
    ocr_text: 'Team Overview\nWe build logistics AI',
    brandModel,
  });

  assert.equal(res.slide_title, 'Team Overview');
  assert.equal(res.slide_title_source, 'ocr_fallback');
  assert.ok(res.slide_title_confidence <= 0.75);
});

test('rejects urls and boilerplate', () => {
  const brandModel = buildBrandModel([
    {
      ocr_blocks: [
        { text: 'Confidential', bbox: { x: 0.1, y: 0.04, w: 0.3, h: 0.03 } },
        { text: 'Vision and Roadmap', bbox: { x: 0.2, y: 0.16, w: 0.5, h: 0.08 } },
      ],
    },
  ] as any);

  const res = inferSlideTitleForSlide({
    blocks: [
      { text: 'www.example.com', bbox: { x: 0.2, y: 0.1, w: 0.3, h: 0.05 } },
      { text: 'Vision and Roadmap', bbox: { x: 0.2, y: 0.18, w: 0.5, h: 0.08 } },
    ] as any,
    brandModel,
  });

  assert.equal(res.slide_title, 'Vision and Roadmap');
});

test('confidence is lower for fallback title', () => {
  const brandModel = buildBrandModel([]);
  const strong = inferSlideTitleForSlide({
    blocks: [
      { text: 'Product Overview', bbox: { x: 0.3, y: 0.16, w: 0.45, h: 0.09 } },
      { text: 'ACME', bbox: { x: 0.05, y: 0.05, w: 0.1, h: 0.02 } },
    ] as any,
    brandModel,
  });

  const fallback = inferSlideTitleForSlide({
    blocks: [],
    ocr_text: 'Pipeline status\nMay 2026 update',
    brandModel,
  });

  assert.ok(strong.slide_title_confidence > fallback.slide_title_confidence);
});
