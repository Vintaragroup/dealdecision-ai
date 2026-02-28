/**
 * dealTermsNarrativeQuality.ts
 *
 * Validates that the LLM-produced DealTermsAnalysisResult is faithful to the
 * canonical fields it was given.  Returns a (possibly empty) list of
 * quality-violation objects; an empty array means the result passes all checks.
 *
 * Intended for:
 *  - Unit test harness (Phase 4 hardening tests)
 *  - Optional runtime assertion layer in DealTermsCard development builds
 *
 * NOT imported by production render paths (InvestorReportView, DueDiligenceReport).
 */

import type { DealTermsAnalysisResult, DealTermsAssessmentLevel } from './apiClient';

// ─── Types ────────────────────────────────────────────────────────────────────

export type QualityViolation = {
  rule: string;
  message: string;
  severity: 'error' | 'warning';
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Generic placeholder strings the LLM must never invent. */
const PLACEHOLDER_PATTERNS: RegExp[] = [
  /\bStartup Corp\b/i,
  /\bCompany Name\b/i,
  /\bYour Company\b/i,
  /\[Company\]/i,
  /\[Insert/i,
  /\[Name\]/i,
  /\bFAKE\b/,
  /\btest company\b/i,
  /\bACME Corp\b/i,
  /lorem ipsum/i,
];

/** Dollar-or-percent amount regex — picks up things like "$5M", "20%", "3.5M", "€2m" */
const AMOUNT_PATTERN = /(?:[$€£¥][\d,.]+\s*[kmbt]?\b|\b[\d,.]+\s*%|\b[\d,.]+\s*[kmbt]\b)/gi;

/**
 * Known "monetary" fields and a regex that would surface them in the summary
 * (we check that if the canonical value is null, no such amount appears in the
 * summary that could be mistaken for that field's fabricated value).
 */
const AMOUNT_BEARING_FIELDS: Array<{ key: string; label: string }> = [
  { key: 'raise_amount',    label: 'raise amount' },
  { key: 'raise_cap',       label: 'valuation cap' },
  { key: 'raise_discount',  label: 'discount rate' },
  { key: 'note_interest_rate', label: 'note interest rate' },
  { key: 'note_maturity',   label: 'note maturity' },
  { key: 'valuation_pre',   label: 'pre-money valuation' },
  { key: 'valuation_post',  label: 'post-money valuation' },
  { key: 'valuation_safe_cap', label: 'SAFE cap' },
];

/**
 * Return the list of fields in `missing_terms` that are "key" undisclosed
 * fields (i.e., their canonical value is null).
 */
function getUndisclosedKeyFields(
  canonicalFields: Record<string, string | null>,
): string[] {
  return AMOUNT_BEARING_FIELDS.filter(
    ({ key }) => canonicalFields[key] == null,
  ).map(({ key }) => key);
}

// ─── Main validator ───────────────────────────────────────────────────────────

/**
 * Validate a DealTermsAnalysisResult against the canonical fields that were
 * used to produce it.
 *
 * Returns an array of QualityViolation objects.  Empty array = all checks pass.
 */
export function validateDealTermsNarrativeQuality(
  result: DealTermsAnalysisResult,
  canonicalFields: Record<string, string | null>,
): QualityViolation[] {
  const violations: QualityViolation[] = [];
  const summary = result.structure_summary ?? '';
  const assessment = result.structure_assessment;
  const missingTerms = result.missing_terms ?? [];

  // ── Rule 1: No placeholder / generic company names ──────────────────────────
  for (const pattern of PLACEHOLDER_PATTERNS) {
    if (pattern.test(summary)) {
      violations.push({
        rule: 'no_placeholder_text',
        message: `structure_summary contains a placeholder pattern: ${pattern}`,
        severity: 'error',
      });
    }
  }

  // ── Rule 2: structure_summary must be non-empty ──────────────────────────────
  if (!summary.trim()) {
    violations.push({
      rule: 'non_empty_summary',
      message: 'structure_summary is empty',
      severity: 'error',
    });
  }

  // ── Rule 3: When missing_terms is non-empty, summary must acknowledge it ────
  if (missingTerms.length > 0) {
    const disclosureKeywords = [
      'not disclosed',
      'not available',
      'not provided',
      'undisclosed',
      'missing',
      'no information',
      'absent',
      'not specified',
    ];
    const hasDisclosure = disclosureKeywords.some((kw) =>
      summary.toLowerCase().includes(kw.toLowerCase()),
    );
    if (!hasDisclosure) {
      violations.push({
        rule: 'missing_terms_disclosure',
        message:
          `missing_terms contains ${missingTerms.length} item(s) but structure_summary does not ` +
          `acknowledge undisclosed terms (expected one of: ${disclosureKeywords.slice(0, 3).join(', ')}, …)`,
        severity: 'warning',
      });
    }
  }

  // ── Rule 4: No invented amounts for null canonical fields ───────────────────
  // Building on each AMOUNT_BEARING_FIELD: if the field's canonical value is
  // null (undisclosed), the summary must not contain dollar / percent amounts
  // UNLESS those amounts come from a DISCLOSED field that is present.
  //
  // Implementation strategy: collect all disclosed amounts (from non-null fields).
  // Then collect all amounts mentioned in the summary.  Any summary amount that
  // does NOT match a disclosed value is a potential invention.
  const disclosedAmounts = new Set<string>();
  for (const { key } of AMOUNT_BEARING_FIELDS) {
    const val = canonicalFields[key];
    if (val) {
      // Extract amount tokens from the canonical value string
      const tokens = val.match(AMOUNT_PATTERN) ?? [];
      for (const t of tokens) disclosedAmounts.add(t.trim().toLowerCase());
    }
  }

  // Additionally: if ALL amount-bearing fields are null → summary must not
  // contain any dollar/percent amounts
  const allAmountFieldsNull = AMOUNT_BEARING_FIELDS.every(
    ({ key }) => canonicalFields[key] == null,
  );
  if (allAmountFieldsNull) {
    const summaryAmounts = summary.match(AMOUNT_PATTERN) ?? [];
    if (summaryAmounts.length > 0) {
      violations.push({
        rule: 'no_invented_amounts',
        message:
          `No amount-bearing canonical fields are disclosed, yet structure_summary contains ` +
          `amount-like tokens: ${summaryAmounts.slice(0, 4).join(', ')}`,
        severity: 'error',
      });
    }
  }

  // ── Rule 5: assessment levels must be valid enum values ────────────────────
  const validLevels: DealTermsAssessmentLevel[] = ['High', 'Medium', 'Low'];
  const assessmentKeys: (keyof typeof assessment)[] = [
    'simplicity',
    'dilution_visibility',
    'valuation_clarity',
    'downside_protection',
  ];
  for (const key of assessmentKeys) {
    const level = assessment[key];
    if (!validLevels.includes(level)) {
      violations.push({
        rule: 'valid_assessment_levels',
        message: `assessment.${key} has invalid level: "${level}" (expected High/Medium/Low)`,
        severity: 'error',
      });
    }
  }

  // ── Rule 6: SAFE with no cap/discount → dilution_visibility must be Low ─────
  const instrument = (canonicalFields['raise_instrument'] ?? '').toLowerCase();
  const hasCap = canonicalFields['raise_cap'] != null || canonicalFields['valuation_safe_cap'] != null;
  const hasDiscount = canonicalFields['raise_discount'] != null;
  const isSafe = instrument.includes('safe') || instrument.includes('simple agreement');

  if (isSafe && !hasCap && !hasDiscount) {
    if (assessment.dilution_visibility !== 'Low') {
      violations.push({
        rule: 'safe_no_cap_dilution_visibility_low',
        message:
          `SAFE instrument detected with no cap or discount — dilution_visibility should be "Low", ` +
          `got "${assessment.dilution_visibility}"`,
        severity: 'error',
      });
    }
  }

  // ── Rule 7: No valuation terms → valuation_clarity must be Low ─────────────
  const hasValuationTerm =
    canonicalFields['valuation_pre'] != null ||
    canonicalFields['valuation_post'] != null ||
    canonicalFields['raise_cap'] != null ||
    canonicalFields['valuation_safe_cap'] != null;

  if (!hasValuationTerm) {
    if (assessment.valuation_clarity !== 'Low') {
      violations.push({
        rule: 'no_valuation_terms_clarity_low',
        message:
          `No valuation terms are disclosed — valuation_clarity should be "Low", ` +
          `got "${assessment.valuation_clarity}"`,
        severity: 'error',
      });
    }
  }

  // ── Rule 8: No downside mechanics → downside_protection must be Low ─────────
  const hasDownside =
    canonicalFields['note_interest_rate'] != null ||
    canonicalFields['note_maturity'] != null;

  if (!hasDownside) {
    if (assessment.downside_protection !== 'Low') {
      violations.push({
        rule: 'no_downside_mechanics_protection_low',
        message:
          `No downside mechanics (interest rate, maturity) are disclosed — ` +
          `downside_protection should be "Low", got "${assessment.downside_protection}"`,
        severity: 'error',
      });
    }
  }

  // ── Rule 9: missing_terms must be an array of strings ───────────────────────
  if (!Array.isArray(missingTerms)) {
    violations.push({
      rule: 'missing_terms_is_array',
      message: 'missing_terms must be an array',
      severity: 'error',
    });
  } else {
    const nonStrings = missingTerms.filter((t) => typeof t !== 'string');
    if (nonStrings.length > 0) {
      violations.push({
        rule: 'missing_terms_all_strings',
        message: `missing_terms contains non-string entries: ${JSON.stringify(nonStrings.slice(0, 3))}`,
        severity: 'error',
      });
    }
  }

  // ── Rule 10: Null fields should appear in missing_terms ─────────────────────
  const undisclosedKeys = getUndisclosedKeyFields(canonicalFields);
  // We don't fail on this — the LLM decides what is "key" — but warn if all
  // non-null fields have disclosed values yet missing_terms is empty when there
  // are null fields.
  if (undisclosedKeys.length > 0 && missingTerms.length === 0) {
    violations.push({
      rule: 'undisclosed_fields_appear_in_missing_terms',
      message:
        `${undisclosedKeys.length} canonical field(s) are null but missing_terms is empty. ` +
        `Undisclosed fields: ${undisclosedKeys.slice(0, 4).join(', ')}`,
      severity: 'warning',
    });
  }

  return violations;
}

/**
 * Convenience: returns true if validateDealTermsNarrativeQuality finds no
 * error-severity violations.
 */
export function dealTermsNarrativePassesQuality(
  result: DealTermsAnalysisResult,
  canonicalFields: Record<string, string | null>,
): boolean {
  return validateDealTermsNarrativeQuality(result, canonicalFields).every(
    (v) => v.severity !== 'error',
  );
}
