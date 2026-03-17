/**
 * Lightweight data-coercion utilities used by worker job processors.
 */

/**
 * Coerces `value` to a finite integer, or `null` if it cannot be parsed.
 *
 * - Numbers are floored.
 * - Strings are parsed via `Number()` then floored.
 * - Everything else (including `Infinity`, `NaN`, objects) returns `null`.
 */
export function parseFiniteInt(value: unknown): number | null {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string"
      ? Number(value)
      : NaN;
  if (!Number.isFinite(n)) return null;
  return Math.floor(n);
}
