/**
 * Tests for detect-deal-fact-conflicts-v1.ts
 *
 * Coverage:
 *  - two raise_amount facts with different values → both get conflicts_with_fact_ids populated
 *  - two raise_amount facts with same value → no conflict
 *  - different types with same label → no conflict
 *  - three conflicting facts → all three cross-linked
 *  - does not mutate the input array
 *  - never throws
 */

import { describe, it, expect } from "vitest";
import { detectDealFactConflictsV1 } from "../../deal-facts/detect-deal-fact-conflicts-v1";
import type { DealFactV1 } from "@dealdecision/core";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function moneyFact(opts: {
  factId: string;
  dealId: string;
  type: DealFactV1["type"];
  label: string;
  value: number;
  currency?: string;
  timeframe?: string;
}): DealFactV1 {
  return {
    fact_id:    opts.factId,
    deal_id:    opts.dealId,
    type:       opts.type,
    label:      opts.label,
    value:      { kind: "money", value: opts.value, currency: opts.currency ?? "USD" },
    timeframe:  opts.timeframe,
    confidence: "high",
    sources:    [{ evidence_id: "ev1" }],
    conflicts_with_fact_ids: [],
  };
}

// ─── Conflict detection ───────────────────────────────────────────────────────

describe("detectDealFactConflictsV1 — raise_amount conflict", () => {
  it("flags both facts when same label, same type, different values", () => {
    const f1 = moneyFact({ factId: "id1", dealId: "d1", type: "raise_amount", label: "Raise Amount", value: 5_000_000 });
    const f2 = moneyFact({ factId: "id2", dealId: "d1", type: "raise_amount", label: "Raise Amount", value: 3_000_000 });

    const result = detectDealFactConflictsV1([f1, f2]);
    expect(result).toHaveLength(2);

    const r1 = result.find((f) => f.fact_id === "id1")!;
    const r2 = result.find((f) => f.fact_id === "id2")!;

    expect(r1.conflicts_with_fact_ids).toContain("id2");
    expect(r2.conflicts_with_fact_ids).toContain("id1");
  });

  it("does NOT flag conflict when values are identical (after normalization)", () => {
    const f1 = moneyFact({ factId: "id1", dealId: "d1", type: "raise_amount", label: "Raise Amount", value: 5_000_000 });
    const f2 = moneyFact({ factId: "id2", dealId: "d1", type: "raise_amount", label: "Raise Amount", value: 5_000_000 });

    const result = detectDealFactConflictsV1([f1, f2]);
    const r1 = result.find((f) => f.fact_id === "id1")!;
    const r2 = result.find((f) => f.fact_id === "id2")!;
    expect(r1.conflicts_with_fact_ids ?? []).not.toContain("id2");
    expect(r2.conflicts_with_fact_ids ?? []).not.toContain("id1");
  });
});

describe("detectDealFactConflictsV1 — cross-type isolation", () => {
  it("does NOT flag conflict between raise_amount and valuation even if same value", () => {
    const f1 = moneyFact({ factId: "id1", dealId: "d1", type: "raise_amount", label: "Raise Amount", value: 5_000_000 });
    const f2 = moneyFact({ factId: "id2", dealId: "d1", type: "valuation",    label: "Raise Amount", value: 3_000_000 });

    const result = detectDealFactConflictsV1([f1, f2]);
    const r1 = result.find((f) => f.fact_id === "id1")!;
    expect(r1.conflicts_with_fact_ids ?? []).not.toContain("id2");
  });
});

describe("detectDealFactConflictsV1 — three-way conflict", () => {
  it("cross-links all three conflicting facts", () => {
    const f1 = moneyFact({ factId: "id1", dealId: "d1", type: "valuation", label: "Valuation", value: 10_000_000 });
    const f2 = moneyFact({ factId: "id2", dealId: "d1", type: "valuation", label: "Valuation", value: 15_000_000 });
    const f3 = moneyFact({ factId: "id3", dealId: "d1", type: "valuation", label: "Valuation", value: 20_000_000 });

    const result = detectDealFactConflictsV1([f1, f2, f3]);

    const r1 = result.find((f) => f.fact_id === "id1")!;
    const r2 = result.find((f) => f.fact_id === "id2")!;
    const r3 = result.find((f) => f.fact_id === "id3")!;

    expect(r1.conflicts_with_fact_ids).toContain("id2");
    expect(r1.conflicts_with_fact_ids).toContain("id3");
    expect(r2.conflicts_with_fact_ids).toContain("id1");
    expect(r2.conflicts_with_fact_ids).toContain("id3");
    expect(r3.conflicts_with_fact_ids).toContain("id1");
    expect(r3.conflicts_with_fact_ids).toContain("id2");
  });
});

describe("detectDealFactConflictsV1 — immutability", () => {
  it("does not mutate the input array objects", () => {
    const f1 = moneyFact({ factId: "id1", dealId: "d1", type: "raise_amount", label: "Raise", value: 5_000_000 });
    const f2 = moneyFact({ factId: "id2", dealId: "d1", type: "raise_amount", label: "Raise", value: 2_000_000 });

    detectDealFactConflictsV1([f1, f2]);

    // original objects unchanged
    expect(f1.conflicts_with_fact_ids).toEqual([]);
    expect(f2.conflicts_with_fact_ids).toEqual([]);
  });
});

describe("detectDealFactConflictsV1 — resilience", () => {
  it("never throws on empty array", () => {
    expect(() => detectDealFactConflictsV1([])).not.toThrow();
    expect(detectDealFactConflictsV1([])).toEqual([]);
  });

  it("returns single fact unchanged", () => {
    const f = moneyFact({ factId: "id1", dealId: "d1", type: "raise_amount", label: "Raise", value: 5_000_000 });
    const result = detectDealFactConflictsV1([f]);
    expect(result).toHaveLength(1);
    expect(result[0].conflicts_with_fact_ids ?? []).toHaveLength(0);
  });
});

describe("detectDealFactConflictsV1 — traction_metric", () => {
  it("detects conflict between two traction_metric facts with same normalized label", () => {
    const f1: DealFactV1 = {
      fact_id: "tm1", deal_id: "d1", type: "traction_metric", label: "ARR",
      value: { kind: "money", value: 1_000_000, currency: "USD" },
      confidence: "high", sources: [{ evidence_id: "ev1" }],
      conflicts_with_fact_ids: [],
    };
    const f2: DealFactV1 = {
      fact_id: "tm2", deal_id: "d1", type: "traction_metric", label: "ARR",
      value: { kind: "money", value: 2_000_000, currency: "USD" },
      confidence: "high", sources: [{ evidence_id: "ev2" }],
      conflicts_with_fact_ids: [],
    };

    const result = detectDealFactConflictsV1([f1, f2]);
    const r1 = result.find((f) => f.fact_id === "tm1")!;
    const r2 = result.find((f) => f.fact_id === "tm2")!;

    expect(r1.conflicts_with_fact_ids).toContain("tm2");
    expect(r2.conflicts_with_fact_ids).toContain("tm1");
  });
});
