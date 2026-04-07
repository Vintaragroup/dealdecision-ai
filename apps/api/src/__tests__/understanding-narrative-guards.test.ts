/**
 * understanding-narrative-guards.test.ts
 *
 * Regression lock for the narrative guards in understanding.ts:
 *
 *   1. stripHypotheticalDollarProjectionSentences — removes sentences that combine
 *      a large-dollar amount (≥$50M) with hypothetical/projection keywords.
 *
 *   2. suppressIfRaiseAmountOverstated — suppresses LLM-generated paragraphs that
 *      assert a raise amount ≥ 20× larger than the trusted structured raise value.
 *
 *   3. rejectIfNumericDominated — returns "" when >40% of tokens (min 8 tokens)
 *      are bare numeric values, catching XLSX chart-coordinate leaks like the
 *      StackFactor go_to_market "25 729.21875 1139.53125..." incident.
 *
 * Known incidents locked by these tests:
 *   - Probility go_to_market: "yielding ~$139M ARR"
 *   - Verse market_positioning: "proposed raise is set at $375 million through a SAFE agreement"
 *   - StackFactor go_to_market: "25 729.21875 1139.53125 1560.9375..." (XLSX chart series)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  stripHypotheticalDollarProjectionSentences,
  suppressIfRaiseAmountOverstated,
  rejectIfNumericDominated,
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

// ---------------------------------------------------------------------------
// rejectIfNumericDominated
// ---------------------------------------------------------------------------

test('rejectIfNumericDominated: returns "" for StackFactor XLSX chart coordinate series (exact incident)', () => {
  const input =
    '25 729.21875 1139.53125 1560.9375 2211.5241555606617 2644.589080810547 3223.2895890526147 Channel Partners ($000) 25 100 150 200';
  assert.strictEqual(rejectIfNumericDominated(input), '');
});

test('rejectIfNumericDominated: returns "" for XLSX "For Charts" backing data', () => {
  const input = 'Sheet For Charts Total Number 2 5 11 20 35 Total End Users 200 1800 3500 6000 10000';
  assert.strictEqual(rejectIfNumericDominated(input), '');
});

test('rejectIfNumericDominated: keeps legitimate narrative GTM text', () => {
  const input =
    'We target enterprise fund managers through warm introductions via investor networks, conference demos, and LinkedIn outbound to fund ops leads.';
  assert.ok(rejectIfNumericDominated(input).length > 0);
});

test('rejectIfNumericDominated: keeps text with incidental numbers (below 40% numeric tokens)', () => {
  const input =
    'Our go-to-market strategy focuses on 3 channels: direct enterprise sales, channel partners in 4 regions, and inbound from 2 large platforms.';
  assert.ok(rejectIfNumericDominated(input).length > 0);
});

test('rejectIfNumericDominated: keeps short text regardless of numeric density (fewer than 8 tokens)', () => {
  // 4 tokens, all numbers — but too short to trigger the guard
  const input = '25 729.21 1139.53 1560.94';
  assert.strictEqual(rejectIfNumericDominated(input), input);
});

test('rejectIfNumericDominated: returns "" for empty input', () => {
  assert.strictEqual(rejectIfNumericDominated(''), '');
});

test('rejectIfNumericDominated: rejects text over the 40% numeric threshold', () => {
  // 5 numeric tokens out of 10 total = 50% — above threshold
  const input = 'Channel 100 200 300 400 500 Strategy inbound outbound direct';
  assert.strictEqual(rejectIfNumericDominated(input), '');
});

test('rejectIfNumericDominated: keeps text at exactly the 40% boundary (not strictly greater)', () => {
  // 4 numeric tokens / 10 total = 40% — NOT > 40%, should pass
  const input = 'Channel Partners 100 200 Strategy inbound outbound direct enterprise sales';
  assert.ok(rejectIfNumericDominated(input).length > 0);
});
