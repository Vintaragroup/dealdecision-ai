/**
 * deal-fact-v1.ts
 *
 * Canonical non-financial Deal Fact types for Deal Fact Registry v1.
 *
 * Scope: non-financial deal facts extracted from Page Registry, OrchestratorReport,
 *        and EvidenceRegistry. Financial facts live in FinancialFactV1.
 *
 * Hard constraints:
 * - Facts must be evidence-backed (no hallucination).
 * - Unknown > invention: store "unknown" rather than guess.
 * - No writes to canonical deal fields / DIO orchestrator objects.
 * - Deterministic IDs: same inputs always produce same fact_id.
 */

import { createHash } from "crypto";

// ─── DealFactTypeV1 ──────────────────────────────────────────────────────────

export const DEAL_FACT_TYPES_V1 = [
  "raise_amount",
  "valuation",
  "round_stage",
  "use_of_funds",
  "target_customer",
  "business_model",
  "pricing_model",
  "go_to_market",
  "traction_metric",
  "key_customer",
  "key_partner",
  "competitor",
  "team_key_role",
  "product_capability",
  "ai_usage_claim",
  "other",
  "unknown",
] as const;

export type DealFactTypeV1 = (typeof DEAL_FACT_TYPES_V1)[number];

export function isDealFactTypeV1(value: unknown): value is DealFactTypeV1 {
  return typeof value === "string" && (DEAL_FACT_TYPES_V1 as readonly string[]).includes(value);
}

// ─── DealFactValueV1 (discriminated union) ───────────────────────────────────

export type DealFactValueKind =
  | "string"
  | "number"
  | "money"
  | "range"
  | "list"
  | "entity"
  | "unknown";

export interface DealFactValueString {
  kind: "string";
  value: string;
}

export interface DealFactValueNumber {
  kind: "number";
  value: number;
  unit?: "currency" | "percent" | "multiple" | "count" | "unknown";
  currency?: string;
}

export interface DealFactValueMoney {
  kind: "money";
  /** Normalized value (e.g., in whole dollars). */
  value: number;
  /** ISO currency code, or "UNKNOWN" if not detectable. */
  currency: string;
}

export interface DealFactValueRange {
  kind: "range";
  min?: number;
  max?: number;
  unit?: string;
}

export interface DealFactValueList {
  kind: "list";
  /** Max 20 items per fact. */
  items: string[];
}

export interface DealFactValueEntity {
  kind: "entity";
  /** e.g. "company", "person", "product", "technology" */
  kind2: string;
  value: string;
}

export interface DealFactValueUnknown {
  kind: "unknown";
  reason: string;
}

export type DealFactValueV1 =
  | DealFactValueString
  | DealFactValueNumber
  | DealFactValueMoney
  | DealFactValueRange
  | DealFactValueList
  | DealFactValueEntity
  | DealFactValueUnknown;

// ─── DealFactEvidenceV1 ───────────────────────────────────────────────────────

export interface DealFactEvidenceV1 {
  evidence_id: string;
  document_id?: string;
  page_number?: number;
  /** Capped at 280 chars. */
  excerpt?: string;
}

// ─── DealFactV1 (canonical row) ──────────────────────────────────────────────

export type DealFactConfidence = "high" | "medium" | "low";

export interface DealFactPageRef {
  document_id: string;
  page_number: number;
  page_type?: string;
}

export interface DealFactV1 {
  /** Deterministic: `dealfactv1:{deal_id}:{type}:{value_hash}` */
  fact_id: string;
  deal_id: string;
  type: DealFactTypeV1;
  /** Human-readable label e.g. "Raise", "Valuation", "ARR (2025)" */
  label: string;
  value: DealFactValueV1;
  /** e.g. "FY2025", "Q3 2026", "as of Jan 2026" */
  timeframe?: string;
  confidence: DealFactConfidence;
  /** 1–6 evidence entries. */
  sources: DealFactEvidenceV1[];
  /** Optional page navigation references. */
  page_refs?: DealFactPageRef[];
  /** Populated by detectDealFactConflictsV1 pass. */
  conflicts_with_fact_ids?: string[];
  created_at?: string;
  updated_at?: string;
}

// ─── Helpers: string capping ──────────────────────────────────────────────────

export function capDealFactExcerpt(s: string): string {
  if (s.length <= 280) return s;
  return s.slice(0, 277) + "...";
}

export function capDealFactLabel(s: string): string {
  if (s.length <= 80) return s;
  return s.slice(0, 77) + "...";
}

// ─── computeDealFactIdV1 ──────────────────────────────────────────────────────

/**
 * Compute a stable deterministic fact_id.
 *
 * Format: `dealfactv1:{dealId}:{type}:{valueHash}`
 *
 * valueHash = first 12 hex chars of sha256(normalizedKeyParts.join("|"))
 *
 * Normalisation rules:
 * - lowercase, trim, collapse runs of whitespace
 * - numeric values: round to 0 decimals for hash stability (stored value unchanged)
 * - timeframe included when present
 */
export function computeDealFactIdV1(opts: {
  dealId: string;
  type: DealFactTypeV1;
  /** Key strings that uniquely identify this fact's value (label stripped). */
  normalizedKeyParts: string[];
}): string {
  const normalized = opts.normalizedKeyParts
    .map((p) => String(p).toLowerCase().trim().replace(/\s+/g, " "))
    .join("|");

  const hash = createHash("sha256")
    .update(normalized)
    .digest("hex")
    .slice(0, 12);

  return `dealfactv1:${opts.dealId}:${opts.type}:${hash}`;
}

// ─── validateDealFact ─────────────────────────────────────────────────────────

const MAX_SOURCES = 6;
const MAX_PAGE_REFS = 20;
const MAX_CONFLICTS = 50;
const MAX_LIST_ITEMS = 20;

/**
 * Validate and normalise a DealFactV1. Returns null if invalid.
 * Caps arrays, caps excerpts, never throws.
 */
export function validateDealFact(fact: DealFactV1): DealFactV1 | null {
  try {
    if (!fact.fact_id || !fact.deal_id || !fact.type) return null;
    if (!isDealFactTypeV1(fact.type)) return null;
    if (!fact.label) return null;
    if (!["high", "medium", "low"].includes(fact.confidence)) return null;
    if (!fact.value || !fact.value.kind) return null;

    // Cap list items
    const value: DealFactValueV1 = fact.value.kind === "list"
      ? { ...fact.value, items: fact.value.items.slice(0, MAX_LIST_ITEMS) }
      : fact.value;

    const sources = (fact.sources ?? []).slice(0, MAX_SOURCES).map((s) => ({
      ...s,
      excerpt: s.excerpt ? capDealFactExcerpt(s.excerpt) : undefined,
    }));

    return {
      ...fact,
      value,
      label: capDealFactLabel(fact.label),
      sources,
      page_refs: (fact.page_refs ?? []).slice(0, MAX_PAGE_REFS),
      conflicts_with_fact_ids: (fact.conflicts_with_fact_ids ?? []).slice(0, MAX_CONFLICTS),
    };
  } catch {
    return null;
  }
}
