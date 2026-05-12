/**
 * KPI Guard — centralized validation for structured_summary KPI propagation.
 *
 * Provides `validateKPI` and `logGuardrailBlock` as the single enforcement point
 * for hard guardrails across:
 *   - promoted fact selection (confidence === 0 blocking)
 *   - structured_summary build (null_rule propagation prevention)
 *   - scoring inputs (nulled-by-guard treated as missing, not negative signal)
 *
 * Rules — a KPI value is BLOCKED if ANY of the following are true:
 *   1. value is null or undefined
 *   2. value is an empty string
 *   3. confidence === 0 (explicitly invalid extraction)
 *   4. null_rule is set (final_publish_guard or field_authority_guard nulled it)
 *
 * IMPORTANT: blocked ≠ negative signal.
 * A blocked value means the data is UNKNOWN, not zero or bad.
 * Scoring must treat blocked KPIs as "missing data" and degrade confidence,
 * not penalise the deal.
 */

export type KpiValidationResult = {
  /** True only when the value should propagate. */
  isValid: boolean;
  /** True when the value was explicitly rejected by a guardrail rule. */
  blocked: boolean;
  /** Machine-readable reason code when blocked, null when valid. */
  reason: string | null;
};

export type GuardrailBlockParams = {
  /** KPI field name, e.g. "raise", "business_model", "revenue". */
  field: string;
  /** Machine-readable reason code. */
  reason: string;
  /** Confidence value from the fact / KPI node. */
  confidence: number | null | undefined;
  /** Source path or document/page reference for traceability. */
  source?: string | null;
};

/**
 * Validate a KPI value before it propagates to structured_summary, deal_summary,
 * IAO, or scoring inputs.
 *
 * @param value      The extracted KPI value (string, number, object, or null).
 * @param confidence Confidence score from the extraction (0–1).
 * @param metadata   Optional: null_rule / null_reason from a guard-nulled field.
 */
export function validateKPI(
  value: unknown,
  confidence: number | null | undefined,
  metadata?: { null_rule?: string | null; null_reason?: string | null } | null,
): KpiValidationResult {
  // Block: value is null or undefined.
  if (value == null) {
    return { isValid: false, blocked: true, reason: 'NULL_VALUE' };
  }

  // Block: empty string value.
  if (typeof value === 'string' && !value.trim()) {
    return { isValid: false, blocked: true, reason: 'EMPTY_VALUE' };
  }

  // Block: confidence is exactly 0 — this means the extraction was explicitly
  // marked invalid by a guard (final_publish_guard, field_authority_guard) or
  // the worker assigned zero confidence (e.g., no pattern match).
  if (typeof confidence === 'number' && confidence === 0) {
    return { isValid: false, blocked: true, reason: 'CONFIDENCE_ZERO' };
  }

  // Block: null_rule was set by final_publish_guard or field_authority_guard.
  // The value was already nulled upstream — do not re-propagate the stale value.
  if (metadata?.null_rule) {
    return { isValid: false, blocked: true, reason: `NULL_RULE:${metadata.null_rule}` };
  }

  return { isValid: true, blocked: false, reason: null };
}

/**
 * Log a guardrail block event to a structured warning.
 *
 * Output format (one line):
 *   [GUARDRAIL_BLOCK] field=<field> reason=<reason> confidence=<confidence> source=<source>
 *
 * This is intentionally a console.warn (not console.error) because blocked values
 * represent expected guardrail enforcement — not an unhandled runtime error.
 */
export function logGuardrailBlock({ field, reason, confidence, source }: GuardrailBlockParams): void {
  const confStr = confidence != null ? String(confidence) : 'unknown';
  const srcStr = source ?? 'unknown';
  console.warn(`[GUARDRAIL_BLOCK] field=${field} reason=${reason} confidence=${confStr} source=${srcStr}`);
}
