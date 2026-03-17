/**
 * Tests for chooseGovernedKeyFact utility.
 *
 * This function drives the value + provenance chip for the four key-fact tiles
 * (product, market, business_model, raise_terms) in the Overview tab.
 *
 * Critical PR25 regression scenario:
 *   When `preferDeterministic` is true (set for raise_terms / business_model
 *   when the investor report is ready), a PR22 deterministic fallback value
 *   like "Unknown" (display-safe but a known sentinel placeholder) was
 *   previously silencing a correctly-produced governed overlay.  The fix
 *   ensures governed overlay wins when the deterministic value is either
 *   non-displayable or a sentinel placeholder.  Real authoritative values
 *   like "Usage-based SaaS (kpi)" or "$3M" continue to win over the overlay.
 *
 * Coverage:
 *   preferDeterministic = true:
 *     - "Unknown" det + governed overlay → chip: Governed   (PR25 regression guard)
 *     - "$2M" det + governed overlay → chip: Deterministic  (canonical value wins)
 *     - governed overlay absent, det present → chip: Authoritative (deterministic)
 *     - non-governed overlay source, det present → chip: deterministic
 *     - fallback overlay quality marks needsReview when not suppressed
 *     - nothing present → missing
 *
 *   preferDeterministic = false (default — used for product / market):
 *     - governed overlay present → chip: Governed
 *     - governed overlay absent + displayable det → chip: deterministic
 *     - non-governed overlay replaces non-displayable det → chip: deterministic
 *     - nothing present → missing
 */

import { describe, it, expect } from 'vitest';
import { chooseGovernedKeyFact } from '../lib/chooseGovernedKeyFact';

const MISSING_TEXT = 'Not extracted from evidence';

// ── Helpers ───────────────────────────────────────────────────────────────────

const governed = (value: string, quality?: string) => ({
  value,
  source: 'governed' as const,
  quality,
});

const deterministicOverlay = (value: string) => ({
  value,
  source: 'deterministic' as const,
});

// ─── preferDeterministic = true (raise / business_model path) ─────────────────

describe('chooseGovernedKeyFact — preferDeterministic: true', () => {
  it('PR25 regression: governed overlay wins over a non-empty deterministic value', () => {
    // Before PR25 fix: "Unknown" (PR22 fallback) would silently shadow "$2.5M pre-seed raise".
    const result = chooseGovernedKeyFact({
      deterministic: 'Unknown',
      overlay: governed('$2.5M pre-seed raise targeting product build-out'),
      preferDeterministic: true,
      missingText: MISSING_TEXT,
    });

    expect(result.value).toBe('$2.5M pre-seed raise targeting product build-out');
    expect(result.provenance.source).toBe('governed');
    expect(result.fromOverlay).toBe(true);
  });

  it('deterministic raise amount wins over governed overlay when it is displayable and non-sentinel', () => {
    // "$2M" is a real displayable value (non-sentinel) so deterministic wins in prefer-deterministic mode.
    // The governed overlay's richer sentence would only win if the deterministic value were a placeholder.
    const result = chooseGovernedKeyFact({
      deterministic: '$2M',
      overlay: governed('$2M pre-seed (SAFE) — closing Q2 2026'),
      preferDeterministic: true,
      missingText: MISSING_TEXT,
    });

    expect(result.value).toBe('$2M');
    expect(result.provenance.source).toBe('deterministic');
    expect(result.fromOverlay).toBe(false);
  });

  it('deterministic wins when overlay is absent', () => {
    const result = chooseGovernedKeyFact({
      deterministic: 'SaaS',
      overlay: null,
      preferDeterministic: true,
      missingText: MISSING_TEXT,
    });

    expect(result.value).toBe('SaaS');
    expect(result.provenance.source).toBe('deterministic');
    expect(result.fromOverlay).toBe(false);
  });

  it('deterministic wins when overlay has deterministic source', () => {
    const result = chooseGovernedKeyFact({
      deterministic: 'SaaS',
      overlay: deterministicOverlay('SaaS (computed)'),
      preferDeterministic: true,
      missingText: MISSING_TEXT,
    });

    expect(result.value).toBe('SaaS');
    expect(result.provenance.source).toBe('deterministic');
  });

  it('returns governed from overlay when det is empty even in prefer-deterministic mode', () => {
    const result = chooseGovernedKeyFact({
      deterministic: '',
      overlay: governed('B2B SaaS — subscription + usage'),
      preferDeterministic: true,
      missingText: MISSING_TEXT,
    });

    expect(result.value).toBe('B2B SaaS — subscription + usage');
    expect(result.provenance.source).toBe('governed');
    expect(result.fromOverlay).toBe(true);
  });

  it('returns missing when nothing is present', () => {
    const result = chooseGovernedKeyFact({
      deterministic: '',
      overlay: null,
      preferDeterministic: true,
      missingText: MISSING_TEXT,
    });

    expect(result.value).toBe(MISSING_TEXT);
    expect(result.provenance.source).toBe('missing');
    expect(result.fromOverlay).toBe(false);
  });

  it('needsReview is set when overlay quality is fallback and suppressNeedsReview is false', () => {
    const result = chooseGovernedKeyFact({
      deterministic: 'Unknown',
      overlay: governed('Subscription model', 'fallback'),
      preferDeterministic: true,
      suppressNeedsReview: false,
      missingText: MISSING_TEXT,
    });

    expect(result.provenance.source).toBe('governed');
    expect(result.provenance.needsReview).toBe(true);
  });

  it('needsReview is falsy when suppressNeedsReview is true', () => {
    const result = chooseGovernedKeyFact({
      deterministic: 'Unknown',
      overlay: governed('Subscription model', 'fallback'),
      preferDeterministic: true,
      suppressNeedsReview: true,
      missingText: MISSING_TEXT,
    });

    expect(result.provenance.source).toBe('governed');
    expect(result.provenance.needsReview).toBeFalsy();
  });

  it('needsReview is falsy when overlay quality is not fallback', () => {
    const result = chooseGovernedKeyFact({
      deterministic: 'Unknown',
      overlay: governed('Subscription model', 'confident'),
      preferDeterministic: true,
      suppressNeedsReview: false,
      missingText: MISSING_TEXT,
    });

    expect(result.provenance.needsReview).toBeFalsy();
  });
});

// ─── preferDeterministic = false (default — product / market path) ────────────

describe('chooseGovernedKeyFact — preferDeterministic: false (default)', () => {
  it('governed overlay wins over a displayable deterministic value', () => {
    const result = chooseGovernedKeyFact({
      deterministic: 'SMBs in accounting',
      overlay: governed('Finance teams at mid-market SaaS companies (~50–500 employees)'),
      preferDeterministic: false,
      missingText: MISSING_TEXT,
    });

    expect(result.value).toBe('Finance teams at mid-market SaaS companies (~50–500 employees)');
    expect(result.provenance.source).toBe('governed');
    expect(result.fromOverlay).toBe(true);
  });

  it('deterministic wins when overlay has no governed source and det is displayable', () => {
    const result = chooseGovernedKeyFact({
      deterministic: 'Clean SaaS sentence',
      overlay: deterministicOverlay('Some longer non-governed text'),
      preferDeterministic: false,
      isDisplayable: () => true,
      missingText: MISSING_TEXT,
    });

    expect(result.value).toBe('Clean SaaS sentence');
    expect(result.provenance.source).toBe('deterministic');
    expect(result.fromOverlay).toBe(false);
  });

  it('overlay replaces non-displayable deterministic (OCR soup), chip stays deterministic', () => {
    const result = chooseGovernedKeyFact({
      deterministic: 'OCR SOUP: ||||| $$ ##### not a real fact',
      overlay: deterministicOverlay('Accounting automation for SMBs'),
      preferDeterministic: false,
      isDisplayable: () => false,
      missingText: MISSING_TEXT,
    });

    expect(result.value).toBe('Accounting automation for SMBs');
    expect(result.provenance.source).toBe('deterministic');
    expect(result.fromOverlay).toBe(true);
  });

  it('returns missing when neither det nor overlay is present', () => {
    const result = chooseGovernedKeyFact({
      deterministic: '',
      overlay: null,
      preferDeterministic: false,
      missingText: MISSING_TEXT,
    });

    expect(result.value).toBe(MISSING_TEXT);
    expect(result.provenance.source).toBe('missing');
  });

  it('returns missing text equals default constant when not supplied', () => {
    const result = chooseGovernedKeyFact({
      deterministic: '',
      overlay: null,
    });

    expect(result.value).toBe('Not extracted from evidence');
  });
});

// ─── Edge cases ───────────────────────────────────────────────────────────────

describe('chooseGovernedKeyFact — edge cases', () => {
  it('strips whitespace from deterministic value before treating as empty', () => {
    const result = chooseGovernedKeyFact({
      deterministic: '   ',
      overlay: governed('Clean governed value'),
      preferDeterministic: true,
      missingText: MISSING_TEXT,
    });

    expect(result.provenance.source).toBe('governed');
  });

  it('treats "—" as empty in deterministic position', () => {
    const result = chooseGovernedKeyFact({
      deterministic: '—',
      overlay: governed('Clean governed value'),
      preferDeterministic: true,
      missingText: MISSING_TEXT,
    });

    expect(result.provenance.source).toBe('governed');
  });

  it('treats "—" as empty in overlay value position', () => {
    const result = chooseGovernedKeyFact({
      deterministic: 'SaaS',
      overlay: { value: '—', source: 'governed' },
      preferDeterministic: false,
      missingText: MISSING_TEXT,
    });

    // "—" overlay is treated as empty, so deterministic wins
    expect(result.value).toBe('SaaS');
    expect(result.provenance.source).toBe('deterministic');
  });
});
