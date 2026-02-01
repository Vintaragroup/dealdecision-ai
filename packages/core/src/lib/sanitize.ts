/**
 * Postgres TEXT/JSON cannot contain NUL (0x00). Some PDF extractors/OCR pipelines
 * can accidentally emit \u0000 or other control characters.
 * 
 * This module provides utilities to sanitize strings and deep objects before
 * writing to Postgres, preventing "invalid byte sequence for encoding UTF8: 0x00" errors.
 */

/**
 * Sanitize a single text value by removing NUL bytes and C0 control characters
 * (except tab, newline, carriage return)
 */
export function sanitizeText(input: unknown): string {
  if (input === null || input === undefined) return "";
  let s = String(input);

  // Hard remove NUL bytes (primary cause of: invalid byte sequence for encoding "UTF8": 0x00)
  s = s.replace(/\u0000/g, "");

  // Remove other C0 controls except tab/newline/carriage-return.
  // (0x01-0x08, 0x0B-0x0C, 0x0E-0x1F, 0x7F)
  s = s.replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ");

  // Collapse excessive whitespace while preserving tab/newline/carriage-return.
  // NOTE: We intentionally do NOT collapse \n/\t/\r to spaces, because callers
  // may depend on these separators for readability.
  const TAB = "\uE000";
  const NL = "\uE001";
  const CR = "\uE002";
  s = s
    .replace(/\t/g, TAB)
    .replace(/\n/g, NL)
    .replace(/\r/g, CR);

  s = s.replace(/\s+/g, " ").trim();

  s = s
    .replace(new RegExp(TAB, "g"), "\t")
    .replace(new RegExp(NL, "g"), "\n")
    .replace(new RegExp(CR, "g"), "\r");

  // Remove spaces adjacent to newlines/CR introduced by collapsing.
  s = s
    .replace(/ *\n */g, "\n")
    .replace(/ *\r */g, "\r");

  return s;
}

/**
 * Recursively sanitize all strings in an object, array, or primitive value
 */
export function sanitizeDeep<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return sanitizeText(value) as any;
  if (typeof value !== "object") return value;

  if (Array.isArray(value)) {
    return value.map((v) => sanitizeDeep(v)) as any;
  }

  const out: any = {};
  for (const [k, v] of Object.entries(value as any)) {
    out[k] = sanitizeDeep(v);
  }
  return out;
}

/**
 * Sanitize text but preserve null/undefined (useful for optional fields)
 */
export function sanitizeNullableText(input: unknown): string | null {
  if (input === null || input === undefined) return null;
  const s = sanitizeText(input);
  return s.length ? s : null;
}
