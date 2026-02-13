import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeCanonicalFact } from '../lib/canonical/canonical-fact-normalizer';

test('normalizeCanonicalFact cleans separator-heavy OCR soup into a sentence-like fact', () => {
  const raw = 'PRODUCT | PLATFORM | API | WORKFLOW | AUTOMATION';
  const out = normalizeCanonicalFact(raw, { kind: 'product', maxLen: 220 });
  assert.ok(out.display_text);
  assert.doesNotMatch(out.display_text, /\|/);
  assert.match(out.display_text, /\.$/);
  assert.ok(out.meta.rules_applied.includes('replace_heavy_separators'));
});

test('normalizeCanonicalFact adds a kind prefix when input is a short phrase (not sentence-like)', () => {
  const raw = 'Premium golf gloves and hats';
  const out = normalizeCanonicalFact(raw, { kind: 'product', maxLen: 220 });
  assert.ok(out.display_text);
  assert.match(out.display_text, /gloves/i);
  assert.match(out.display_text, /\.$/);
});

test('normalizeCanonicalFact preserves numeric-heavy raise terms by adding context words', () => {
  const raw = '$5M SAFE @ $20M cap, 20% discount';
  const out = normalizeCanonicalFact(raw, { kind: 'raise', maxLen: 220 });
  assert.ok(out.display_text);
  assert.match(out.display_text, /^Raise terms:\s+/i);
  assert.match(out.display_text, /\$5M/i);
  assert.match(out.display_text, /20%/);
  assert.match(out.display_text, /\.$/);
});

test('normalizeCanonicalFact does not add prefixes to already-labeled canonical sentences', () => {
  const raw = 'Serves: core 18–34 male golfers, expanding into women and youth.';
  const out = normalizeCanonicalFact(raw, { kind: 'market_target', maxLen: 220 });
  assert.ok(out.display_text);
  assert.match(out.display_text, /^Serves:\s+/i);
  assert.match(out.display_text, /18\s*[-–]\s*34/i);
  assert.match(out.display_text, /women/i);
  assert.match(out.display_text, /youth/i);
  assert.ok(!out.meta.rules_applied.includes('add_kind_prefix'));
});
