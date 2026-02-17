import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeCanonicalFact } from '../lib/canonical/canonical-fact-normalizer';

test('normalizeCanonicalFact cleans separator-heavy OCR soup into a sentence-like fact', () => {
  const raw = 'We provide a product | platform | API for workflow automation.';
  const out = normalizeCanonicalFact(raw, { kind: 'product', maxLen: 220 });
  assert.ok(out.display_text);
  assert.doesNotMatch(out.display_text, /\|/);
  assert.match(out.display_text, /\.$/);
  assert.ok(out.meta.rules_applied.includes('replace_heavy_separators'));
});

test('normalizeCanonicalFact downgrades to ok when text is clause-like but lacks a verb-like token', () => {
  const raw = 'Premium golf gloves for everyday players';
  const out = normalizeCanonicalFact(raw, { kind: 'product', maxLen: 220 });
  assert.ok(out.display_text);
  assert.match(out.display_text, /gloves/i);
  assert.match(out.display_text, /\.$/);
  assert.equal(out.quality, 'ok');
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

test('normalizeCanonicalFact collapses mid-word hard wraps (newline between letters)', () => {
  const raw = 'We support shared payment\ns for groups.';
  const out = normalizeCanonicalFact(raw, { kind: 'product', maxLen: 220 });
  assert.ok(out.display_text);
  assert.match(out.display_text, /shared payments/i);
  assert.ok(out.meta.rules_applied.includes('collapse_midword_newlines'));
});

test('normalizeCanonicalFact collapses hyphenated line-wraps ("inter-\nchange" -> "interchange")', () => {
  const raw = 'We reduce inter-\nchange fees for merchants.';
  const out = normalizeCanonicalFact(raw, { kind: 'product', maxLen: 220 });
  assert.ok(out.display_text);
  assert.match(out.display_text, /interchange fees/i);
  assert.ok(out.meta.rules_applied.includes('collapse_midword_newlines'));
});

test('normalizeCanonicalFact does not join words across a normal word-boundary newline', () => {
  const raw = 'We support shared payment\n platform for groups.';
  const out = normalizeCanonicalFact(raw, { kind: 'product', maxLen: 220 });
  assert.ok(out.display_text);
  assert.match(out.display_text, /shared payment platform/i);
  assert.doesNotMatch(out.display_text, /paymentplatform/i);
  assert.ok(!out.meta.rules_applied.includes('collapse_midword_newlines'));
});

test('normalizeCanonicalFact does not collapse paragraph breaks into mid-word joins', () => {
  const raw = 'Line one.\n\nLine two.';
  const out = normalizeCanonicalFact(raw, { kind: 'generic', maxLen: 220 });
  assert.ok(out.display_text);
  assert.match(out.display_text, /Line one\./);
  assert.match(out.display_text, /Line two\./);
  assert.doesNotMatch(out.display_text, /Line one\.Line two\./);
  assert.ok(!out.meta.rules_applied.includes('collapse_midword_newlines'));
});

test('normalizeCanonicalFact deterministically reconstructs a coherent market_target sentence when given an incoherent heading-like fragment with components', () => {
  const raw = "a Powering Every Shared Payment Market Cino’s target (100M users ICP)";
  const out = normalizeCanonicalFact(raw, { kind: 'market_target', maxLen: 220 });
  assert.equal(out.display_text, 'The company targets approximately 100M users in the shared payment market.');
  assert.ok(out.meta.rules_applied.includes('deterministic_reconstruction_v1'));
  assert.ok(!out.suppressed_reasons.includes('not_coherent_sentence_like'));
});

test('normalizeCanonicalFact does not reconstruct market_target when fewer than two components exist', () => {
  const raw = 'Shared payment market';
  const out = normalizeCanonicalFact(raw, { kind: 'market_target', maxLen: 220 });
  assert.equal(out.display_text, null);
  assert.ok(!out.meta.rules_applied.includes('deterministic_reconstruction_v1'));
  assert.ok(out.suppressed_reasons.includes('not_coherent_sentence_like'));
});

test('normalizeCanonicalFact deterministically reconstructs a coherent product sentence when category and monetization are present but coherence fails', () => {
  const raw = 'Platform — subscription';
  const out = normalizeCanonicalFact(raw, { kind: 'product', maxLen: 220 });
  assert.ok(out.display_text);
  assert.match(out.display_text, /^The product is a platform monetized via subscription\.$/);
  assert.ok(out.meta.rules_applied.includes('deterministic_reconstruction_v1'));
});

test('normalizeCanonicalFact suppresses AI disclaimer boilerplate', () => {
  const raw = 'As an AI language model, I cannot provide financial advice.';
  const out = normalizeCanonicalFact(raw, { kind: 'product', maxLen: 220 });
  assert.equal(out.display_text, null);
  assert.equal(out.quality, 'garbage');
  assert.ok(out.suppressed_reasons.includes('boilerplate_marker'));
  assert.ok(out.meta.rules_applied.includes('suppress_disclaimer_boilerplate_v1'));
});

test('normalizeCanonicalFact suppresses templated company-summary boilerplate', () => {
  const raw = 'This is a company in product. It sells via B2B sales.';
  const out = normalizeCanonicalFact(raw, { kind: 'market', maxLen: 220 });
  assert.equal(out.display_text, null);
  assert.equal(out.quality, 'garbage');
  assert.ok(out.suppressed_reasons.includes('boilerplate_marker'));
  assert.ok(out.meta.rules_applied.includes('suppress_disclaimer_boilerplate_v1'));
});
