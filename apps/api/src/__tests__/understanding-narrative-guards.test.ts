/**
 * understanding-narrative-guards.test.ts
 *
 * Regression lock for the two narrative numeric-consistency guards added to
 * apps/api/src/routes/understanding.ts:
 *
 *   1. stripHypotheticalDollarProjectionSentences — removes sentences that combine
 *      a large-dollar amount (≥$50M) with hypothetical/projection keywords.
 *
 *   2. suppressIfRaiseAmountOverstated — suppresses LLM-generated paragraphs that
 *      assert a raise amount ≥ 20× larger than the trusted structured raise value.
 *
 * These tests lock the exact bad-value cases from the known incidents:
 *   - Probility go_to_market: "yielding ~$139M ARR"
 *   - Verse market_positioning: "proposed raise is set at $375 million through a SAFE agreement"
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  stripHypotheticalDollarProjectionSentences,
  suppressIfRaiseAmountOverstated,
} from '../routes/understanding';

// ---------------------------------------------------------------------------
// stripHypotheticalDollarProjectionSentences
// ---------------------------------------------------------------------------

test('strip: removes the Probility $139M ARR sentence (exact incident)', () => {
  const input =
    "bal betting/fantasy users will pay for Probility's data, yielding ~$139M ARR.";
  assert.strictEqual(stripHypotheticalDollarProjectionSentences(input), '');
});

test('strip: keeps text when no projection keyword is present', () => {
  const input = 'Probility charges $5 per user per month via a SaaS subscription model.';
  assert.match(stripHypotheticalDollarProjectionSentences(input), /\$5 per user/);
});

test('strip: keeps text when dollar amount is below $50M threshold', () => {
  const input = 'Sales strategy targets $4M in year one through channel partnerships.';
  assert.ok(stripHypotheticalDollarProjectionSentences(input).length > 0);
});

test("strip: removes 'projected' + large-dollar sentence while keeping clean sentences", () => {
  const input =
    'We sell direct to enterprise clients. Revenue is projected to reach $200M by 2027. Our NPS is 72.';
  const result = stripHypotheticalDollarProjectionSentences(input);
  assert.ok(!result.includes('$200M'), 'expected $200M sentence to be stripped');
  assert.match(result, /direct to enterprise/);
  assert.match(result, /NPS/);
});

test("strip: removes 'forecast' + large-dollar sentence", () => {
  const input =
    'Total addressable market is forecast to yield $500M in annual license revenue.';
  assert.strictEqual(stripHypotheticalDollarProjectionSentences(input), '');
});

test("strip: removes 'could reach' with billion amount", () => {
  const input =
    'Platform could reach $1B in GMV within five years based on current trajectory.';
  assert.strictEqual(stripHypotheticalDollarProjectionSentences(input), '');
});

test('strip: returns empty string for empty input', () => {
  assert.strictEqual(stripHypotheticalDollarProjectionSentences(''), '');
});

test('strip: does not strip Verse go_to_market (sales strategy, sub-threshold $4M amount)', () => {
  const input =
    'Sales Strategy 11 $ 4M Pre - sales From 27 LOIs On - Premise Retailers That Take Others 5 Years+ to Close.';
  // $4M < $50M → no strip
  assert.ok(stripHypotheticalDollarProjectionSentences(input).length > 0);
});

// ---------------------------------------------------------------------------
// suppressIfRaiseAmountOverstated
// ---------------------------------------------------------------------------

test('suppress: removes the Verse $375M paragraph when trusted raise is $2MM (exact incident)', () => {
  const text =
    'The deal centers around a startup that provides functional ingredients designed to elevate mood, ' +
    'detoxify the body, and enhance everyday vitality. ' +
    'The company operates under an omnichannel business model, ' +
    'combining direct-to-consumer (DTC) sales with wholesale and retail distribution. ' +
    'The proposed raise is set at $375 million through a SAFE agreement, ' +
    'indicating a significant capital requirement to support its growth and market penetration.';
  assert.strictEqual(suppressIfRaiseAmountOverstated(text, '$2MM'), '');
});

test('suppress: keeps text when claimed raise is within 20× of trusted raise', () => {
  const text = 'The company is raising a $10 million Series A to accelerate growth.';
  // trusted = $4MM → 10M / 4M = 2.5× < 20 → keep
  assert.match(suppressIfRaiseAmountOverstated(text, '$4MM'), /\$10 million/);
});

test('suppress: keeps text with large market size number (no raise assertion)', () => {
  const text = 'The addressable market is estimated at $2 billion globally.';
  assert.match(suppressIfRaiseAmountOverstated(text, '$2MM'), /\$2 billion/);
});

test('suppress: keeps text when trusted raise is unknown (null)', () => {
  const text = 'The proposed raise is set at $500 million.';
  assert.strictEqual(suppressIfRaiseAmountOverstated(text, null), text);
});

test('suppress: keeps text when trusted raise is unknown (empty string)', () => {
  const text = 'Raising $200 million Series B.';
  assert.strictEqual(suppressIfRaiseAmountOverstated(text, ''), text);
});

test('suppress: removes paragraph for "raising $200M" when trusted raise is $1MM (200× ratio)', () => {
  const text =
    'The founders bring deep consumer experience. The company is raising $200 million via a convertible note.';
  assert.strictEqual(suppressIfRaiseAmountOverstated(text, '$1MM'), '');
});

test('suppress: keeps Probility market_positioning (no raise assertion in text)', () => {
  const text =
    'This deal involves a consumer e-commerce brand operating within the wholesale and retail sector. ' +
    'The company has demonstrated traction through various signals, including mentions of annual recurring ' +
    'revenue (ARR), overall revenue, user growth, and partnerships.';
  // No "proposed raise" pattern → not suppressed
  assert.strictEqual(suppressIfRaiseAmountOverstated(text, '$4MM'), text);
});

test('suppress: returns empty string for empty input', () => {
  assert.strictEqual(suppressIfRaiseAmountOverstated('', '$2MM'), '');
});
