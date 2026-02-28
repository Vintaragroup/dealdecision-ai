/**
 * dealTermsNarrativeQuality.test.ts
 *
 * Unit tests for the validateDealTermsNarrativeQuality and
 * dealTermsNarrativePassesQuality helpers (Phase 4 hardening).
 *
 * Each test group targets one quality rule.  All tests run in Vitest with the
 * same config as the rest of the web package.
 */
import { describe, expect, test } from 'vitest';
import {
  dealTermsNarrativePassesQuality,
  validateDealTermsNarrativeQuality,
  type QualityViolation,
} from '../lib/dealTermsNarrativeQuality';
import type { DealTermsAnalysisResult } from '../lib/apiClient';

// ─── Shared builders ──────────────────────────────────────────────────────────

function makeResult(overrides: Partial<DealTermsAnalysisResult> = {}): DealTermsAnalysisResult {
  return {
    structure_summary:
      'The company is raising $2M on a priced seed round at a $10M pre-money valuation. ' +
      'Note interest rate and maturity are not disclosed.',
    structure_assessment: {
      simplicity: 'High',
      dilution_visibility: 'High',
      valuation_clarity: 'High',
      downside_protection: 'Low',
    },
    missing_terms: ['note interest rate', 'note maturity'],
    ...overrides,
  };
}

function makeFields(overrides: Record<string, string | null> = {}): Record<string, string | null> {
  return {
    raise_amount: '$2M',
    raise_round: 'Seed',
    raise_instrument: 'Priced equity',
    raise_cap: null,
    raise_discount: null,
    note_interest_rate: null,
    note_maturity: null,
    valuation_pre: '$10M',
    valuation_post: '$12M',
    valuation_safe_cap: null,
    ...overrides,
  };
}

function violationRules(violations: QualityViolation[]): string[] {
  return violations.map((v) => v.rule);
}

// ─── Rule 1 — no_placeholder_text ────────────────────────────────────────────

describe('Rule 1 — no_placeholder_text', () => {
  test('passes a clean summary with no placeholders', () => {
    const violations = validateDealTermsNarrativeQuality(makeResult(), makeFields());
    expect(violationRules(violations)).not.toContain('no_placeholder_text');
  });

  test.each([
    ['Startup Corp', 'The startup is raising $2M. Startup Corp is well positioned.'],
    ['Company Name', 'Company Name seeks investment.'],
    ['[Company]', 'Terms are favorable for [Company].'],
    ['[Insert', 'Please review [Insert terms here].'],
    ['lorem ipsum', 'lorem ipsum dolor sit amet.'],
    ['ACME Corp', 'ACME Corp is a leading provider.'],
  ])('flags placeholder "%s" in summary', (_label, badSummary) => {
    const result = makeResult({ structure_summary: badSummary });
    const fields = makeFields();
    const violations = validateDealTermsNarrativeQuality(result, fields);
    expect(violationRules(violations)).toContain('no_placeholder_text');
    expect(violations.find((v) => v.rule === 'no_placeholder_text')!.severity).toBe('error');
  });
});

// ─── Rule 2 — non_empty_summary ───────────────────────────────────────────────

describe('Rule 2 — non_empty_summary', () => {
  test('passes a non-empty summary', () => {
    const violations = validateDealTermsNarrativeQuality(makeResult(), makeFields());
    expect(violationRules(violations)).not.toContain('non_empty_summary');
  });

  test.each([[''], ['   ']])('flags empty/whitespace summary ("%s")', (summary) => {
    const result = makeResult({ structure_summary: summary });
    const violations = validateDealTermsNarrativeQuality(result, makeFields());
    expect(violationRules(violations)).toContain('non_empty_summary');
  });
});

// ─── Rule 3 — missing_terms_disclosure ────────────────────────────────────────

describe('Rule 3 — missing_terms_disclosure', () => {
  test('passes when missing_terms is empty', () => {
    const result = makeResult({
      missing_terms: [],
      structure_summary: 'All terms are fully disclosed.',
    });
    const violations = validateDealTermsNarrativeQuality(result, makeFields());
    expect(violationRules(violations)).not.toContain('missing_terms_disclosure');
  });

  test.each([
    ['not disclosed'],
    ['not available'],
    ['undisclosed'],
    ['not provided'],
    ['absent'],
    ['not specified'],
  ])('passes when summary contains "%s"', (phrase) => {
    const result = makeResult({
      missing_terms: ['note maturity'],
      structure_summary: `Some terms are ${phrase}.`,
    });
    const violations = validateDealTermsNarrativeQuality(result, makeFields());
    expect(violationRules(violations)).not.toContain('missing_terms_disclosure');
  });

  test('warns when missing_terms non-empty but summary has no disclosure phrase', () => {
    const result = makeResult({
      missing_terms: ['note maturity', 'discount rate'],
      structure_summary: 'The company is raising funds.',
    });
    const violations = validateDealTermsNarrativeQuality(result, makeFields());
    expect(violationRules(violations)).toContain('missing_terms_disclosure');
    expect(violations.find((v) => v.rule === 'missing_terms_disclosure')!.severity).toBe('warning');
  });
});

// ─── Rule 4 — no_invented_amounts ─────────────────────────────────────────────

describe('Rule 4 — no_invented_amounts', () => {
  test('passes when all amount fields are null and summary mentions no amounts', () => {
    const allNull = makeFields({
      raise_amount: null,
      raise_cap: null,
      raise_discount: null,
      note_interest_rate: null,
      note_maturity: null,
      valuation_pre: null,
      valuation_post: null,
      valuation_safe_cap: null,
    });
    const result = makeResult({
      structure_summary: 'No terms are disclosed. The structure is completely undisclosed.',
      structure_assessment: {
        simplicity: 'Low',
        dilution_visibility: 'Low',
        valuation_clarity: 'Low',
        downside_protection: 'Low',
      },
      missing_terms: ['raise amount', 'valuation cap'],
    });
    const violations = validateDealTermsNarrativeQuality(result, allNull);
    expect(violationRules(violations)).not.toContain('no_invented_amounts');
  });

  test('flags invented dollar amount when all amount fields are null', () => {
    const allNull = makeFields({
      raise_amount: null,
      raise_cap: null,
      raise_discount: null,
      note_interest_rate: null,
      note_maturity: null,
      valuation_pre: null,
      valuation_post: null,
      valuation_safe_cap: null,
    });
    const result = makeResult({
      structure_summary: 'The company is raising $5M at a $20M cap.',
      structure_assessment: {
        simplicity: 'High',
        dilution_visibility: 'Low',
        valuation_clarity: 'Low',
        downside_protection: 'Low',
      },
      missing_terms: ['raise amount', 'valuation cap'],
    });
    const violations = validateDealTermsNarrativeQuality(result, allNull);
    expect(violationRules(violations)).toContain('no_invented_amounts');
    expect(violations.find((v) => v.rule === 'no_invented_amounts')!.severity).toBe('error');
  });
});

// ─── Rule 5 — valid_assessment_levels ─────────────────────────────────────────

describe('Rule 5 — valid_assessment_levels', () => {
  test('passes with all valid levels', () => {
    const violations = validateDealTermsNarrativeQuality(makeResult(), makeFields());
    expect(violationRules(violations)).not.toContain('valid_assessment_levels');
  });

  test.each([
    ['simplicity', 'Excellent'],
    ['dilution_visibility', 'unknown'],
    ['valuation_clarity', ''],
    ['downside_protection', 'N/A'],
  ])('flags invalid level "%s" for assessment.%s', (key, badLevel) => {
    const result = makeResult({
      structure_assessment: {
        ...makeResult().structure_assessment,
        [key]: badLevel as any,
      },
    });
    const violations = validateDealTermsNarrativeQuality(result, makeFields());
    expect(violationRules(violations)).toContain('valid_assessment_levels');
    const v = violations.find((x) => x.rule === 'valid_assessment_levels');
    expect(v!.message).toContain(key);
  });
});

// ─── Rule 6 — safe_no_cap_dilution_visibility_low ─────────────────────────────

describe('Rule 6 — SAFE with no cap/discount → dilution_visibility must be Low', () => {
  test('passes when SAFE has no cap/discount and dilution_visibility is Low', () => {
    const fields = makeFields({
      raise_instrument: 'SAFE',
      raise_cap: null,
      raise_discount: null,
      valuation_safe_cap: null,
    });
    const result = makeResult({
      structure_assessment: {
        ...makeResult().structure_assessment,
        dilution_visibility: 'Low',
        valuation_clarity: 'Low',
      },
    });
    const violations = validateDealTermsNarrativeQuality(result, fields);
    expect(violationRules(violations)).not.toContain('safe_no_cap_dilution_visibility_low');
  });

  test('flags when SAFE has no cap/discount but dilution_visibility is High', () => {
    const fields = makeFields({
      raise_instrument: 'SAFE',
      raise_cap: null,
      raise_discount: null,
      valuation_safe_cap: null,
      valuation_pre: null,
      valuation_post: null,
    });
    const result = makeResult({
      structure_assessment: {
        ...makeResult().structure_assessment,
        dilution_visibility: 'High',
        valuation_clarity: 'Low',
      },
    });
    const violations = validateDealTermsNarrativeQuality(result, fields);
    expect(violationRules(violations)).toContain('safe_no_cap_dilution_visibility_low');
    expect(violations.find((v) => v.rule === 'safe_no_cap_dilution_visibility_low')!.severity).toBe('error');
  });

  test('passes when SAFE has a cap — dilution_visibility can be High', () => {
    const fields = makeFields({
      raise_instrument: 'SAFE',
      raise_cap: '$8M',
      raise_discount: null,
      valuation_safe_cap: null,
    });
    const result = makeResult({
      structure_assessment: {
        ...makeResult().structure_assessment,
        dilution_visibility: 'High',
        valuation_clarity: 'High',
      },
    });
    const violations = validateDealTermsNarrativeQuality(result, fields);
    expect(violationRules(violations)).not.toContain('safe_no_cap_dilution_visibility_low');
  });

  test('passes for non-SAFE instrument regardless of cap presence', () => {
    const fields = makeFields({ raise_instrument: 'Convertible Note', raise_cap: null });
    const result = makeResult({
      structure_assessment: {
        ...makeResult().structure_assessment,
        dilution_visibility: 'Medium',
        valuation_clarity: 'Low',
      },
    });
    const violations = validateDealTermsNarrativeQuality(result, fields);
    expect(violationRules(violations)).not.toContain('safe_no_cap_dilution_visibility_low');
  });
});

// ─── Rule 7 — no_valuation_terms_clarity_low ──────────────────────────────────

describe('Rule 7 — no valuation terms → valuation_clarity must be Low', () => {
  test('passes when valuation terms are absent and clarity is Low', () => {
    const fields = makeFields({
      raise_cap: null,
      valuation_pre: null,
      valuation_post: null,
      valuation_safe_cap: null,
    });
    const result = makeResult({
      structure_assessment: {
        ...makeResult().structure_assessment,
        valuation_clarity: 'Low',
      },
    });
    const violations = validateDealTermsNarrativeQuality(result, fields);
    expect(violationRules(violations)).not.toContain('no_valuation_terms_clarity_low');
  });

  test('flags when valuation terms absent but clarity is High', () => {
    const fields = makeFields({
      raise_cap: null,
      valuation_pre: null,
      valuation_post: null,
      valuation_safe_cap: null,
    });
    const result = makeResult({
      structure_assessment: {
        ...makeResult().structure_assessment,
        valuation_clarity: 'High',
      },
    });
    const violations = validateDealTermsNarrativeQuality(result, fields);
    expect(violationRules(violations)).toContain('no_valuation_terms_clarity_low');
  });

  test('passes when valuation_pre is disclosed and clarity is High', () => {
    const fields = makeFields({ valuation_pre: '$10M' });
    const violations = validateDealTermsNarrativeQuality(
      makeResult(),
      fields,
    );
    expect(violationRules(violations)).not.toContain('no_valuation_terms_clarity_low');
  });
});

// ─── Rule 8 — no_downside_mechanics_protection_low ────────────────────────────

describe('Rule 8 — no downside mechanics → downside_protection must be Low', () => {
  test('passes when no downside mechanics and protection is Low', () => {
    const fields = makeFields({
      note_interest_rate: null,
      note_maturity: null,
    });
    const result = makeResult({
      structure_assessment: {
        ...makeResult().structure_assessment,
        downside_protection: 'Low',
      },
    });
    const violations = validateDealTermsNarrativeQuality(result, fields);
    expect(violationRules(violations)).not.toContain('no_downside_mechanics_protection_low');
  });

  test('flags when no downside mechanics but protection is High', () => {
    const fields = makeFields({
      note_interest_rate: null,
      note_maturity: null,
    });
    const result = makeResult({
      structure_assessment: {
        ...makeResult().structure_assessment,
        downside_protection: 'High',
      },
    });
    const violations = validateDealTermsNarrativeQuality(result, fields);
    expect(violationRules(violations)).toContain('no_downside_mechanics_protection_low');
    expect(violations.find((v) => v.rule === 'no_downside_mechanics_protection_low')!.severity).toBe('error');
  });

  test('passes when note_interest_rate is present and protection is High', () => {
    const fields = makeFields({ note_interest_rate: '5%', note_maturity: '24 months' });
    const result = makeResult({
      structure_assessment: {
        ...makeResult().structure_assessment,
        downside_protection: 'High',
      },
      structure_summary: 'Interest rate is 5% and note matures in 24 months.',
    });
    const violations = validateDealTermsNarrativeQuality(result, fields);
    expect(violationRules(violations)).not.toContain('no_downside_mechanics_protection_low');
  });
});

// ─── Rule 9 — missing_terms type safety ───────────────────────────────────────

describe('Rule 9 — missing_terms must be an array of strings', () => {
  test('passes with string array', () => {
    const violations = validateDealTermsNarrativeQuality(makeResult(), makeFields());
    expect(violationRules(violations)).not.toContain('missing_terms_is_array');
    expect(violationRules(violations)).not.toContain('missing_terms_all_strings');
  });

  test('flags non-array missing_terms', () => {
    const result = makeResult({ missing_terms: 'note maturity' as any });
    const violations = validateDealTermsNarrativeQuality(result, makeFields());
    expect(violationRules(violations)).toContain('missing_terms_is_array');
  });

  test('flags array with non-string entries', () => {
    const result = makeResult({ missing_terms: [42, 'valid', null] as any });
    const violations = validateDealTermsNarrativeQuality(result, makeFields());
    expect(violationRules(violations)).toContain('missing_terms_all_strings');
  });
});

// ─── Rule 10 — undisclosed_fields_appear_in_missing_terms ─────────────────────

describe('Rule 10 — undisclosed fields should appear in missing_terms', () => {
  test('passes when null fields are reflected in missing_terms', () => {
    const fields = makeFields({ note_interest_rate: null, note_maturity: null });
    const result = makeResult({ missing_terms: ['note interest rate', 'note maturity'] });
    const violations = validateDealTermsNarrativeQuality(result, fields);
    expect(violationRules(violations)).not.toContain('undisclosed_fields_appear_in_missing_terms');
  });

  test('warns when null fields present but missing_terms is empty', () => {
    const fields = makeFields({ note_interest_rate: null, note_maturity: null });
    const result = makeResult({
      missing_terms: [],
      structure_summary: 'All remaining terms are not disclosed.',
    });
    const violations = validateDealTermsNarrativeQuality(result, fields);
    expect(violationRules(violations)).toContain('undisclosed_fields_appear_in_missing_terms');
    // Should only be a warning, not an error
    expect(violations.find((v) => v.rule === 'undisclosed_fields_appear_in_missing_terms')!.severity).toBe('warning');
  });
});

// ─── dealTermsNarrativePassesQuality convenience function ─────────────────────

describe('dealTermsNarrativePassesQuality', () => {
  test('returns true for a fully valid result', () => {
    expect(dealTermsNarrativePassesQuality(makeResult(), makeFields())).toBe(true);
  });

  test('returns false when there is an error-severity violation', () => {
    const result = makeResult({ structure_summary: 'Startup Corp is a great company.' });
    expect(dealTermsNarrativePassesQuality(result, makeFields())).toBe(false);
  });

  test('returns true even when there are only warning-severity violations', () => {
    // missing_terms populated but summary lacks disclosure keyword → warning only
    const result = makeResult({
      missing_terms: ['note maturity'],
      structure_summary: 'The company is raising funds. Terms are pending.',
    });
    // makeFields() has note_interest_rate null, note_maturity null → would flag
    // undisclosed_fields_appear_in_missing_terms only if missing_terms is empty.
    // Here missing_terms = ['note maturity'], so rule 10 won't fire.
    // Rule 3 fires (no disclosure phrase in summary) → warning only.
    expect(dealTermsNarrativePassesQuality(result, makeFields())).toBe(true);
  });
});

// ─── Integration scenario: realistic full deal ────────────────────────────────

describe('Full realistic deal scenario', () => {
  test('passes quality checks for a well-formed SAFE with cap', () => {
    const fields: Record<string, string | null> = {
      raise_amount: '$1.5M',
      raise_round: 'Pre-Seed',
      raise_instrument: 'SAFE',
      raise_cap: '$8M',
      raise_discount: '20%',
      note_interest_rate: null,
      note_maturity: null,
      valuation_pre: null,
      valuation_post: null,
      valuation_safe_cap: '$8M',
    };

    const result: DealTermsAnalysisResult = {
      structure_summary:
        'The company is raising $1.5M on a pre-seed SAFE at an $8M valuation cap with a 20% discount. ' +
        'Note interest rate and maturity are not disclosed as this is an uncapped structure with standard SAFE mechanics. ' +
        'Dilution visibility is moderate given the cap, though absence of interest/maturity terms limits downside protection.',
      structure_assessment: {
        simplicity: 'High',
        dilution_visibility: 'High',
        valuation_clarity: 'High',
        downside_protection: 'Low',
      },
      missing_terms: ['note interest rate', 'note maturity'],
    };

    const violations = validateDealTermsNarrativeQuality(result, fields);
    const errors = violations.filter((v) => v.severity === 'error');
    expect(errors).toHaveLength(0);
  });

  test('surfaces errors for a malformed result', () => {
    const fields: Record<string, string | null> = {
      raise_amount: null,
      raise_round: null,
      raise_instrument: 'SAFE',
      raise_cap: null,
      raise_discount: null,
      note_interest_rate: null,
      note_maturity: null,
      valuation_pre: null,
      valuation_post: null,
      valuation_safe_cap: null,
    };

    // LLM invented a $5M cap even though all fields are null and chose wrong levels
    const result: DealTermsAnalysisResult = {
      structure_summary: 'Startup Corp is raising $5M at a $20M cap — not disclosed.',
      structure_assessment: {
        simplicity: 'High',
        dilution_visibility: 'High', // wrong — SAFE no cap
        valuation_clarity: 'High',   // wrong — no valuation terms
        downside_protection: 'High', // wrong — no downside mechanics
      },
      missing_terms: ['raise amount', 'valuation cap'],
    };

    const violations = validateDealTermsNarrativeQuality(result, fields);
    const errorRules = violations.filter((v) => v.severity === 'error').map((v) => v.rule);

    // Should catch: placeholder, invented amounts, SAFE dilution rule, valuation rule, downside rule
    expect(errorRules).toContain('no_placeholder_text');
    expect(errorRules).toContain('no_invented_amounts');
    expect(errorRules).toContain('safe_no_cap_dilution_visibility_low');
    expect(errorRules).toContain('no_valuation_terms_clarity_low');
    expect(errorRules).toContain('no_downside_mechanics_protection_low');
  });
});
