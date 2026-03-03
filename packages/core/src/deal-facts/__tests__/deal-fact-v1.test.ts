/**
 * Core unit tests for deal-fact-v1.ts helpers.
 *
 * Coverage:
 *  - computeDealFactIdV1: stability + uniqueness
 *  - validateDealFact: array caps, excerpt cap, label cap, invalid type → null
 *  - capDealFactExcerpt: truncates at 280
 *  - capDealFactLabel:   truncates at 80
 */

import { describe, it, expect } from "@jest/globals";
import {
  computeDealFactIdV1,
  validateDealFact,
  capDealFactExcerpt,
  capDealFactLabel,
} from "../deal-fact-v1";
import type { DealFactV1 } from "../deal-fact-v1";

// ─── computeDealFactIdV1 ──────────────────────────────────────────────────────

describe("computeDealFactIdV1", () => {
  it("produces a stable id for the same inputs", () => {
    const a = computeDealFactIdV1({ dealId: "deal-abc", type: "raise_amount", normalizedKeyParts: ["5m"] });
    const b = computeDealFactIdV1({ dealId: "deal-abc", type: "raise_amount", normalizedKeyParts: ["5m"] });
    expect(a).toBe(b);
  });

  it("starts with the expected prefix", () => {
    const id = computeDealFactIdV1({ dealId: "d1", type: "valuation", normalizedKeyParts: ["10m"] });
    expect(id).toMatch(/^dealfactv1:d1:valuation:[0-9a-f]{12}$/);
  });

  it("produces different ids for different types", () => {
    const a = computeDealFactIdV1({ dealId: "d1", type: "raise_amount", normalizedKeyParts: ["5m"] });
    const b = computeDealFactIdV1({ dealId: "d1", type: "valuation",    normalizedKeyParts: ["5m"] });
    expect(a).not.toBe(b);
  });

  it("produces different ids for different deal ids", () => {
    const a = computeDealFactIdV1({ dealId: "d1", type: "raise_amount", normalizedKeyParts: ["5m"] });
    const b = computeDealFactIdV1({ dealId: "d2", type: "raise_amount", normalizedKeyParts: ["5m"] });
    expect(a).not.toBe(b);
  });

  it("produces different ids for different key parts", () => {
    const a = computeDealFactIdV1({ dealId: "d1", type: "traction_metric", normalizedKeyParts: ["arr"] });
    const b = computeDealFactIdV1({ dealId: "d1", type: "traction_metric", normalizedKeyParts: ["mrr"] });
    expect(a).not.toBe(b);
  });
});

// ─── capDealFactExcerpt / capDealFactLabel ────────────────────────────────────

describe("capDealFactExcerpt", () => {
  it("passes through strings ≤ 280 chars", () => {
    const s = "a".repeat(280);
    expect(capDealFactExcerpt(s)).toBe(s);
  });

  it("truncates strings > 280 chars to 280", () => {
    const s = "b".repeat(400);
    expect(capDealFactExcerpt(s).length).toBe(280);
  });
});

describe("capDealFactLabel", () => {
  it("passes through strings ≤ 80 chars", () => {
    const s = "c".repeat(80);
    expect(capDealFactLabel(s)).toBe(s);
  });

  it("truncates strings > 80 chars to 80", () => {
    const s = "d".repeat(120);
    expect(capDealFactLabel(s).length).toBe(80);
  });
});

// ─── validateDealFact ─────────────────────────────────────────────────────────

function minimalFact(overrides?: Partial<DealFactV1>): DealFactV1 {
  return {
    fact_id:    "dealfactv1:d1:raise_amount:abc123456789",
    deal_id:    "d1",
    type:       "raise_amount",
    label:      "Raising",
    value:      { kind: "money", value: 5_000_000, currency: "USD" },
    confidence: "high",
    sources:    [{ evidence_id: "ev1" }],
    ...overrides,
  };
}

describe("validateDealFact", () => {
  it("returns the valid fact — key fields preserved", () => {
    const f = minimalFact();
    const result = validateDealFact(f);
    expect(result).not.toBeNull();
    expect(result!.fact_id).toBe(f.fact_id);
    expect(result!.deal_id).toBe(f.deal_id);
    expect(result!.type).toBe(f.type);
    expect(result!.label).toBe(f.label);
    expect(result!.confidence).toBe(f.confidence);
    expect(result!.value).toEqual(f.value);
  });

  it("caps sources array at 6", () => {
    const f = minimalFact({
      sources: Array.from({ length: 10 }, (_, i) => ({ evidence_id: `ev${i}` })),
    });
    const result = validateDealFact(f);
    expect(result).not.toBeNull();
    expect(result!.sources.length).toBe(6);
  });

  it("caps page_refs array at 20", () => {
    const f = minimalFact({
      page_refs: Array.from({ length: 25 }, (_, i) => ({ document_id: "doc1", page_number: i + 1, page_summary: "" })),
    });
    const result = validateDealFact(f);
    expect(result).not.toBeNull();
    expect(result!.page_refs!.length).toBe(20);
  });

  it("caps conflicts_with_fact_ids at 50", () => {
    const f = minimalFact({
      conflicts_with_fact_ids: Array.from({ length: 60 }, (_, i) => `id${i}`),
    });
    const result = validateDealFact(f);
    expect(result).not.toBeNull();
    expect(result!.conflicts_with_fact_ids!.length).toBe(50);
  });

  it("truncates label to 80 chars", () => {
    const f = minimalFact({ label: "x".repeat(120) });
    const result = validateDealFact(f);
    expect(result).not.toBeNull();
    expect(result!.label.length).toBe(80);
  });

  it("truncates excerpt in sources to 280 chars", () => {
    const f = minimalFact({
      sources: [{ evidence_id: "ev1", excerpt: "z".repeat(400) }],
    });
    const result = validateDealFact(f);
    expect(result).not.toBeNull();
    expect(result!.sources[0].excerpt!.length).toBe(280);
  });

  it("returns null for an invalid type", () => {
    const f = minimalFact({ type: "not_a_real_type" as DealFactV1["type"] });
    expect(validateDealFact(f)).toBeNull();
  });
});
