import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildClassificationText, buildSegmentFeatures } from '../src/lib/analyst-segment';

test('buildSegmentFeatures: PPTX uses structured_json.title and bullets/notes as body', () => {
  const features = buildSegmentFeatures({
    extractor_version: 'structured_native_v1',
    quality_source: 'structured_powerpoint',
    structured_json: {
      kind: 'powerpoint_slide',
      title: 'Market Opportunity',
      bullets: ['TAM $10B', 'CAGR 20%'],
      notes: 'These are speaker notes',
      text_snippet: 'Additional context',
    },
    page_index: 0,
    evidence_snippets: [],
  });

  assert.equal(features.source_kind, 'pptx');
  assert.ok(features.title.length > 0);
  assert.ok(features.body.includes('TAM $10B'));
  assert.ok(features.body.includes('speaker'));
  assert.equal(features.has_title, true);

  const text = buildClassificationText(features);
  assert.match(text, /TITLE:/);
  assert.match(text, /BODY:/);
  assert.ok(!text.toLowerCase().includes('page_index'));
});

test('buildSegmentFeatures: DOCX uses heading as title and paragraphs as body', () => {
  const features = buildSegmentFeatures({
    extractor_version: 'structured_native_v1',
    quality_source: 'structured_word',
    structured_json: {
      kind: 'word_section',
      heading: 'Traction',
      paragraphs: ['We reached $1M ARR', 'Retention is 120%'],
      text_snippet: 'Summary snippet',
    },
    page_index: 3,
    evidence_snippets: ['Evidence snippet 1'],
  });

  assert.equal(features.source_kind, 'docx');
  assert.equal(features.title, 'Traction');
  assert.ok(features.body.includes('$1M ARR'));
  assert.equal(features.has_title, true);

  const text = buildClassificationText(features);
  assert.match(text, /TITLE: Traction/);
  assert.match(text, /EVIDENCE:/);
});
