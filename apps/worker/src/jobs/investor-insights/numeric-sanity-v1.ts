/**
 * PR36.5 — Numeric Sanity Validation
 *
 * Deterministic validators for detecting malformed or implausible numeric values
 * that should be suppressed before they reach investor-facing outputs.
 *
 * Problem classes addressed:
 *
 *   1. MALFORMED_CURRENCY — "$000", "£000", "€000" and similar shells where OCR
 *      has produced a currency symbol attached to meaningless zeros. These arise
 *      when spreadsheet column headers or template cells are read as values.
 *
 *   2. PERCENT_SCALE_ERROR — Values like "2350.0%" that appear because OCR has
 *      read a decimal (e.g., 23.50) as a percentage without the scale shift.
 *      Threshold: ≥ 1000% in a financial-context field is virtually always wrong.
 *      Exception: explicit "X,000%" forms are also caught (e.g., "1,200% growth").
 *
 *   3. ZERO_DENOMINATOR — Ambiguous "0%" / "$0" values that may be absent-field
 *      placeholders rather than genuine zeroes.
 *
 * All validators are pure functions — no I/O, no side effects.
 * All reason codes are UPPER_SNAKE_CASE strings.
 */

// ─── Reason codes ─────────────────────────────────────────────────────────────

export const NUMERIC_SANITY_REASON = {
	/** Currency token with no significant digits (e.g., "$000", "£0", "€000") */
	INVALID_MALFORMED_CURRENCY: "INVALID_MALFORMED_CURRENCY",
	/**
	 * Percentage value ≥ 1000 — almost certainly an OCR scale error
	 * (e.g., "2350.0%" when the true value is "23.50%").
	 */
	INVALID_PERCENT_SCALE: "INVALID_PERCENT_SCALE",
	/**
	 * Percentage value of exactly 0 — likely an unpopulated template cell
	 * rather than a genuine zero-percent figure.
	 */
	ZERO_PERCENT_PLACEHOLDER: "ZERO_PERCENT_PLACEHOLDER",
} as const;

export type NumericSanityReason = (typeof NUMERIC_SANITY_REASON)[keyof typeof NUMERIC_SANITY_REASON];

// ─── Internal patterns (compile once) ────────────────────────────────────────

/**
 * MALFORMED_CURRENCY_RE: matches currency symbols followed by only zeros or
 * comma-separated zeros. Handles:
 *   "$000", "£000", "€000", "$0,000", "£0.00", "$0.000", "€0,000.00"
 *   Also catches empty-shell forms: "$-", "£-", "$—" (OCR table cell artifacts)
 */
const MALFORMED_CURRENCY_RE =
	/(?:[€£$]|USD|EUR|GBP)\s*(?:0+(?:[,.]0+)*\b|[-—–]+\s*$)/i;

/**
 * PERCENT_SCALE_ERROR_RE: matches percentage values ≥ 1000.
 * Handles:
 *   "2350.0%", "1,200%", "1000%", "10,000%"
 *   Must be a standalone percentage (word boundary before digit).
 */
const PERCENT_SCALE_ERROR_RE =
	/\b(?:\d{1,3}(?:[,\s]\d{3})+|\d{4,})(?:\.\d+)?\s*%/;

/**
 * ZERO_PERCENT_RE: matches exact "0%" or "0.0%", "0.00%" — common empty-cell
 * placeholders in financial models.
 */
const ZERO_PERCENT_RE = /\b0+(?:\.0+)?\s*%/;

// ─── Public validators ────────────────────────────────────────────────────────

/**
 * Returns true when `value` is a malformed currency token with no significant
 * digits (e.g. "$000", "£0.00", "€-").
 *
 * @example
 *   isMalformedCurrency("$000")         // true
 *   isMalformedCurrency("$0.00")        // true
 *   isMalformedCurrency("$1.5M")        // false
 *   isMalformedCurrency("£0")           // true
 */
export function isMalformedCurrency(value: string): boolean {
	if (!value || typeof value !== "string") return false;
	return MALFORMED_CURRENCY_RE.test(value.trim());
}

/**
 * Returns true when `value` contains a percentage ≥ 1000 that almost certainly
 * represents an OCR scale error (decimal misread as integer percentage).
 *
 * @example
 *   isPercentScaleError("2350.0%")     // true
 *   isPercentScaleError("1,200%")      // true
 *   isPercentScaleError("350%")        // false  (plausible revenue growth)
 *   isPercentScaleError("20%")         // false
 */
export function isPercentScaleError(value: string): boolean {
	if (!value || typeof value !== "string") return false;
	const m = PERCENT_SCALE_ERROR_RE.exec(value);
	if (!m) return false;
	// Parse the numeric portion for confirmation (strip commas/spaces before parse)
	const numeric = parseFloat(m[0].replace(/[,\s%]/g, ""));
	return Number.isFinite(numeric) && numeric >= 1000;
}

/**
 * Returns true when `value` is a zero-percent placeholder (0%, 0.0%).
 * These commonly appear as unpopulated cells in financial model templates.
 *
 * @example
 *   isZeroPercentPlaceholder("0%")      // true
 *   isZeroPercentPlaceholder("0.0%")    // true
 *   isZeroPercentPlaceholder("0.5%")    // false
 */
export function isZeroPercentPlaceholder(value: string): boolean {
	if (!value || typeof value !== "string") return false;
	return ZERO_PERCENT_RE.test(value.trim());
}

// ─── Composite validator ──────────────────────────────────────────────────────

export interface NumericSanityResult {
	valid: boolean;
	reason: NumericSanityReason | null;
}

/**
 * Validate a numeric/currency string against all sanity rules.
 * Returns `{ valid: true, reason: null }` when the value passes all checks.
 * Returns `{ valid: false, reason: <code> }` for the first failing rule.
 *
 * Rules evaluated in order:
 *   1. Malformed currency (no significant digits)
 *   2. Percentage scale error (≥ 1000%)
 *   3. Zero-percent placeholder
 *
 * @example
 *   validateNumericValue("$000")       // { valid: false, reason: "INVALID_MALFORMED_CURRENCY" }
 *   validateNumericValue("2350.0%")    // { valid: false, reason: "INVALID_PERCENT_SCALE" }
 *   validateNumericValue("$2M")        // { valid: true, reason: null }
 */
export function validateNumericValue(value: string): NumericSanityResult {
	if (isMalformedCurrency(value)) {
		return { valid: false, reason: NUMERIC_SANITY_REASON.INVALID_MALFORMED_CURRENCY };
	}
	if (isPercentScaleError(value)) {
		return { valid: false, reason: NUMERIC_SANITY_REASON.INVALID_PERCENT_SCALE };
	}
	if (isZeroPercentPlaceholder(value)) {
		return { valid: false, reason: NUMERIC_SANITY_REASON.ZERO_PERCENT_PLACEHOLDER };
	}
	return { valid: true, reason: null };
}
