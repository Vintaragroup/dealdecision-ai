/**
 * page-registry-v1.test.ts
 *
 * Unit tests for PageRegistryRowV1 type helpers:
 * - computePageId: deterministic ID format
 * - capPageExcerpt: 280-char cap
 * - capClaimText: 220-char cap
 * - capContext: 160-char cap
 * - validatePageRegistryRow: validation rules
 * - isPageTypeV1: type guard
 */

import {
  computePageId,
  capPageExcerpt,
  capClaimText,
  capContext,
  validatePageRegistryRow,
  isPageTypeV1,
  PAGE_TYPES_V1,
} from "../page-registry-v1";
import type { PageRegistryRowV1 } from "../page-registry-v1";

const DEAL_ID = "00000000-0000-0000-0000-000000000001";
const DOC_ID = "00000000-0000-0000-0000-000000000002";

// ─── computePageId ────────────────────────────────────────────────────────────

describe("computePageId", () => {
  test("produces deterministic ID with correct format", () => {
    const id = computePageId({ deal_id: DEAL_ID, document_id: DOC_ID, page_number: 5 });
    expect(id).toBe(`pagev1:${DEAL_ID}:${DOC_ID}:5`);
  });

  test("produces same ID on re-run", () => {
    const a = computePageId({ deal_id: DEAL_ID, document_id: DOC_ID, page_number: 0 });
    const b = computePageId({ deal_id: DEAL_ID, document_id: DOC_ID, page_number: 0 });
    expect(a).toBe(b);
  });

  test("different page_numbers produce different IDs", () => {
    const a = computePageId({ deal_id: DEAL_ID, document_id: DOC_ID, page_number: 1 });
    const b = computePageId({ deal_id: DEAL_ID, document_id: DOC_ID, page_number: 2 });
    expect(a).not.toBe(b);
  });
});

// ─── capPageExcerpt ───────────────────────────────────────────────────────────

describe("capPageExcerpt", () => {
  test("does not modify strings <= 280 chars", () => {
    const s = "a".repeat(280);
    expect(capPageExcerpt(s)).toBe(s);
  });

  test("caps at 280 chars with ellipsis for longer strings", () => {
    const s = "a".repeat(400);
    const result = capPageExcerpt(s);
    expect(result.length).toBe(280);
    expect(result.endsWith("...")).toBe(true);
  });
});

// ─── capClaimText ─────────────────────────────────────────────────────────────

describe("capClaimText", () => {
  test("caps at 220 chars with ellipsis", () => {
    const s = "x".repeat(300);
    const result = capClaimText(s);
    expect(result.length).toBe(220);
    expect(result.endsWith("...")).toBe(true);
  });

  test("returns short string unchanged", () => {
    expect(capClaimText("short")).toBe("short");
  });
});

// ─── capContext ───────────────────────────────────────────────────────────────

describe("capContext", () => {
  test("caps at 160 chars with ellipsis", () => {
    const s = "z".repeat(200);
    const result = capContext(s);
    expect(result.length).toBe(160);
  });
});

// ─── isPageTypeV1 ─────────────────────────────────────────────────────────────

describe("isPageTypeV1", () => {
  test("returns true for all valid page types", () => {
    for (const t of PAGE_TYPES_V1) {
      expect(isPageTypeV1(t)).toBe(true);
    }
  });

  test("returns false for invalid values", () => {
    expect(isPageTypeV1("slide")).toBe(false);
    expect(isPageTypeV1("")).toBe(false);
    expect(isPageTypeV1(null)).toBe(false);
    expect(isPageTypeV1(undefined)).toBe(false);
    expect(isPageTypeV1(42)).toBe(false);
  });
});

// ─── validatePageRegistryRow ─────────────────────────────────────────────────

function makeValidRow(): PageRegistryRowV1 {
  return {
    page_id: computePageId({ deal_id: DEAL_ID, document_id: DOC_ID, page_number: 0 }),
    deal_id: DEAL_ID,
    document_id: DOC_ID,
    page_number: 0,
    page_type: "product",
    confidence: "medium",
    entities: [],
    numeric_claims: [],
    key_claims: [],
    evidence_ids: [],
  };
}

describe("validatePageRegistryRow", () => {
  test("accepts a valid row", () => {
    const row = makeValidRow();
    expect(validatePageRegistryRow(row)).not.toBeNull();
  });

  test("returns null for missing page_id", () => {
    const row = { ...makeValidRow(), page_id: "" };
    expect(validatePageRegistryRow(row)).toBeNull();
  });

  test("returns null for invalid page_type", () => {
    const row = { ...makeValidRow(), page_type: "slide" as any };
    expect(validatePageRegistryRow(row)).toBeNull();
  });

  test("returns null for negative page_number", () => {
    const row = { ...makeValidRow(), page_number: -1 };
    expect(validatePageRegistryRow(row)).toBeNull();
  });

  test("caps entities to 20", () => {
    const row = {
      ...makeValidRow(),
      entities: Array(30).fill({ kind: "other" as const, value: "x" }),
    };
    const result = validatePageRegistryRow(row);
    expect(result?.entities.length).toBe(20);
  });

  test("caps numeric_claims to 20", () => {
    const claim = { raw: "$1M", value: 1_000_000, unit: "currency" as const, context: "context" };
    const row = { ...makeValidRow(), numeric_claims: Array(25).fill(claim) };
    const result = validatePageRegistryRow(row);
    expect(result?.numeric_claims.length).toBe(20);
  });

  test("caps key_claims to 8", () => {
    const row = {
      ...makeValidRow(),
      key_claims: Array(12).fill({ text: "We raised $5M" }),
    };
    const result = validatePageRegistryRow(row);
    expect(result?.key_claims.length).toBe(8);
  });

  test("caps excerpt to 280", () => {
    const row = { ...makeValidRow(), excerpt: "e".repeat(400) };
    const result = validatePageRegistryRow(row);
    expect(result?.excerpt?.length).toBe(280);
  });
});
