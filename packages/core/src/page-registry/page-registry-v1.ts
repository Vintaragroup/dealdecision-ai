/**
 * page-registry-v1.ts — Canonical per-page index types.
 *
 * One row = one page × one document × one deal.
 * Persisted in: page_registry_v1 table.
 * Consumed by: deal chat (read), API (read), orchestrator (read-only future).
 *
 * Design rules:
 * - Deterministic-first: numeric_claims extracted by regex, entities by heuristics.
 * - No LLM for extraction; page_type may use rules only (LLM assist is optional/future).
 * - page_id is deterministic and stable across re-runs for the same inputs.
 * - excerpt capped at 280 chars.
 */

// ─── PageTypeV1 ───────────────────────────────────────────────────────────────

export type PageTypeV1 =
  | "ask"
  | "product"
  | "market"
  | "team"
  | "traction"
  | "financials"
  | "competition"
  | "gtm"
  | "use_of_funds"
  | "risks"
  | "other"
  | "unknown";

export const PAGE_TYPES_V1: PageTypeV1[] = [
  "ask",
  "product",
  "market",
  "team",
  "traction",
  "financials",
  "competition",
  "gtm",
  "use_of_funds",
  "risks",
  "other",
  "unknown",
];

export function isPageTypeV1(v: unknown): v is PageTypeV1 {
  return typeof v === "string" && PAGE_TYPES_V1.includes(v as PageTypeV1);
}

// ─── PageEntityV1 ─────────────────────────────────────────────────────────────

export type PageEntityKindV1 =
  | "company"
  | "product"
  | "customer"
  | "competitor"
  | "metric"
  | "technology"
  | "person"
  | "location"
  | "other";

export interface PageEntityV1 {
  kind: PageEntityKindV1;
  /** Normalized entity value (trimmed, max 120 chars). */
  value: string;
}

// ─── NumericClaimV1 ───────────────────────────────────────────────────────────

export type NumericClaimUnitV1 =
  | "currency"
  | "percent"
  | "multiple"
  | "count"
  | "unknown";

export interface NumericClaimV1 {
  /** Exact matched text from source. */
  raw: string;
  /** Parsed numeric value (always finite). */
  value: number;
  unit: NumericClaimUnitV1;
  /** ISO 4217 currency code when unit="currency". */
  currency?: string;
  /** Surrounding context snippet, <= 160 chars. */
  context: string;
  /**
   * Optional best-effort normalization label.
   * Only set when highly confident — never guessed.
   * Examples: "raise_amount", "valuation", "revenue", "arr", "mrr"
   */
  normalized_label?: string;
}

// ─── PageClaimV1 ─────────────────────────────────────────────────────────────

export interface PageClaimV1 {
  /** Extractive claim (never generated), <= 220 chars. */
  text: string;
}

// ─── PageConfidenceV1 ────────────────────────────────────────────────────────

export type PageConfidenceV1 = "high" | "medium" | "low";

// ─── PageRegistryRowV1 ───────────────────────────────────────────────────────

export interface PageRegistryRowV1 {
  /**
   * Deterministic stable identifier.
   * Format: `pagev1:{deal_id}:{document_id}:{page_number}`
   */
  page_id: string;
  deal_id: string;
  document_id: string;
  page_number: number;
  page_type: PageTypeV1;
  /** Classification confidence. */
  confidence: PageConfidenceV1;
  /** Extracted entities, max 20. */
  entities: PageEntityV1[];
  /** Regex-extracted numeric claims, max 20. */
  numeric_claims: NumericClaimV1[];
  /** Extractive key claims, max 8. */
  key_claims: PageClaimV1[];
  /** Linked evidence_item IDs. */
  evidence_ids: string[];
  /** Best representative excerpt, <= 280 chars. */
  excerpt?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Compute a deterministic page_id.
 * Format: `pagev1:{deal_id}:{document_id}:{page_number}`
 */
export function computePageId(opts: {
  deal_id: string;
  document_id: string;
  page_number: number;
}): string {
  return `pagev1:${opts.deal_id}:${opts.document_id}:${opts.page_number}`;
}

/**
 * Cap a string to 280 characters (excerpt cap).
 */
export function capPageExcerpt(s: string): string {
  return s.length <= 280 ? s : s.slice(0, 277) + "...";
}

/**
 * Cap a claim text to 220 characters.
 */
export function capClaimText(s: string): string {
  return s.length <= 220 ? s : s.slice(0, 217) + "...";
}

/**
 * Cap a context snippet to 160 characters.
 */
export function capContext(s: string): string {
  return s.length <= 160 ? s : s.slice(0, 157) + "...";
}

/**
 * Validate a PageRegistryRowV1 draft before persistence.
 * Returns null if required fields are missing or page_number is invalid.
 */
export function validatePageRegistryRow(
  row: PageRegistryRowV1
): PageRegistryRowV1 | null {
  if (!row.page_id || !row.deal_id || !row.document_id) return null;
  if (!Number.isFinite(row.page_number) || row.page_number < 0) return null;
  if (!isPageTypeV1(row.page_type)) return null;
  return {
    ...row,
    entities: row.entities.slice(0, 20),
    numeric_claims: row.numeric_claims.slice(0, 20),
    key_claims: row.key_claims.slice(0, 8),
    evidence_ids: row.evidence_ids.slice(0, 10),
    excerpt: row.excerpt ? capPageExcerpt(row.excerpt) : undefined,
  };
}
