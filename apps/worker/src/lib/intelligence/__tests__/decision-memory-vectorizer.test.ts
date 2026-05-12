/**
 * Tests — Decision Memory: Vectorizer + Matcher
 * Pure functions only (no DB).
 */

import { describe, it, expect } from "vitest";
import { vectorizeMemorySnapshot, VECTOR_DIMENSION_WEIGHTS } from "../decision-memory/vectorizer.js";
import { weightedEuclideanDistance, findSimilarDeals } from "../decision-memory/matcher.js";
import type { StoredMemoryRow } from "../decision-memory/matcher.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function baseSnapshot(
  overrides: Partial<Parameters<typeof vectorizeMemorySnapshot>[0]> = {}
): Parameters<typeof vectorizeMemorySnapshot>[0] {
  return {
    ors_score: 70,
    dci_score: 65,
    fhc_score: 60,
    urss_score: 30,
    arr_value: 1_000_000,
    burn_rate_monthly: 100_000,
    runway_months: 18,
    raise_amount: 3_000_000,
    evidence_count: 15,
    contradiction_count: 0,
    financial_completeness_pct: 80,
    key_risk_count: 2,
    key_strength_count: 5,
    stage: "SeriesA",
    has_xlsx: true,
    document_quality_score: 75,
    verdict: "GO",
    ...overrides,
  };
}

// ─── vectorizeMemorySnapshot ───────────────────────────────────────────────

describe("vectorizeMemorySnapshot", () => {
  it("produces a vector of length 18", () => {
    const { vector } = vectorizeMemorySnapshot(baseSnapshot());
    expect(vector).toHaveLength(18);
  });

  it("all vector values are in [0, 1]", () => {
    const { vector } = vectorizeMemorySnapshot(baseSnapshot());
    for (const v of vector) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("null_mask is false for all dims when input is fully present", () => {
    const { null_mask } = vectorizeMemorySnapshot(baseSnapshot());
    for (const b of null_mask) {
      expect(b).toBe(false);
    }
  });

  it("null_mask sets true for null ARR", () => {
    const { null_mask } = vectorizeMemorySnapshot(baseSnapshot({ arr_value: null }));
    expect(null_mask[4]).toBe(true); // dim 4 = ARR
  });

  it("null_mask sets true for null runway_months", () => {
    const { null_mask } = vectorizeMemorySnapshot(baseSnapshot({ runway_months: null }));
    expect(null_mask[6]).toBe(true); // dim 6 = runway
  });

  it("GO verdict encodes to 1.0", () => {
    const { vector } = vectorizeMemorySnapshot(baseSnapshot({ verdict: "GO" }));
    expect(vector[16]).toBe(1.0); // dim 16 = verdict
  });

  it("NO_GO verdict encodes to 0.0", () => {
    const { vector } = vectorizeMemorySnapshot(baseSnapshot({ verdict: "NO_GO" }));
    expect(vector[16]).toBe(0.0);
  });

  it("CONSIDER verdict encodes to 0.5", () => {
    const { vector } = vectorizeMemorySnapshot(baseSnapshot({ verdict: "CONSIDER" }));
    expect(vector[16]).toBe(0.5);
  });

  it("null inputs get 0.5 NULL_FILL", () => {
    const { vector } = vectorizeMemorySnapshot(
      baseSnapshot({ arr_value: null, runway_months: null, raise_amount: null })
    );
    // dims 4, 6, 7 should be NULL_FILL=0.5
    expect(vector[4]).toBe(0.5);
    expect(vector[6]).toBe(0.5);
    expect(vector[7]).toBe(0.5);
  });
});

// ─── weightedEuclideanDistance ─────────────────────────────────────────────

describe("weightedEuclideanDistance", () => {
  const weights = [1, 1, 1];

  it("distance of identical vectors is 0", () => {
    const a = [0.5, 0.5, 0.5];
    expect(weightedEuclideanDistance(a, a, weights)).toBe(0);
  });

  it("distance is symmetric", () => {
    const a = [0.2, 0.8, 0.5];
    const b = [0.9, 0.1, 0.3];
    const d1 = weightedEuclideanDistance(a, b, weights);
    const d2 = weightedEuclideanDistance(b, a, weights);
    expect(d1).toBeCloseTo(d2, 5);
  });

  it("distance is positive for different vectors", () => {
    const a = [0.0, 0.0, 0.0];
    const b = [1.0, 1.0, 1.0];
    expect(weightedEuclideanDistance(a, b, weights)).toBeGreaterThan(0);
  });

  it("higher weight amplifies distance contribution", () => {
    const a = [0.0];
    const b = [1.0];
    const d1 = weightedEuclideanDistance(a, b, [1]);
    const d2 = weightedEuclideanDistance(a, b, [4]);
    expect(d2).toBeGreaterThan(d1);
  });
});

// ─── findSimilarDeals ──────────────────────────────────────────────────────

describe("findSimilarDeals", () => {
  function makeRow(id: string, vector: number[]): StoredMemoryRow {
    return {
      deal_id: id,
      feature_vector: vector,
      ors_score: 70,
      dci_score: 65,
      fhc_score: 60,
      urss_score: 30,
      verdict: "GO",
      scoreband_key: "strong_consider",
    };
  }

  it("returns empty list when no candidates provided", () => {
    const { vector } = vectorizeMemorySnapshot(baseSnapshot());
    const results = findSimilarDeals(vector, [], { deal_id: "query" });
    expect(results).toHaveLength(0);
  });

  it("returns the closest vector first", () => {
    const { vector: queryVec } = vectorizeMemorySnapshot(baseSnapshot());
    const close = makeRow("close", queryVec.map((v, i) => v + (i < 9 ? 0.01 : 0)));
    const far   = makeRow("far",   queryVec.map(() => 0.99));

    const results = findSimilarDeals(queryVec, [far, close], { deal_id: "query" });
    expect(results[0].deal_id).toBe("close");
  });

  it("excludes the query deal_id from results", () => {
    const { vector } = vectorizeMemorySnapshot(baseSnapshot());
    const self = makeRow("self-deal", vector);
    const other = makeRow("other-deal", vector.map((v) => v + 0.1));

    const results = findSimilarDeals(vector, [self, other], { deal_id: "self-deal" });
    const ids = results.map((r) => r.deal_id);
    expect(ids).not.toContain("self-deal");
  });

  it("respects topK limit", () => {
    const { vector } = vectorizeMemorySnapshot(baseSnapshot());
    const candidates = Array.from({ length: 10 }, (_, i) =>
      makeRow(`deal-${i}`, VECTOR_DIMENSION_WEIGHTS.map(() => Math.random()))
    );
    const results = findSimilarDeals(vector, candidates, { deal_id: "query", top_n: 3 });
    expect(results.length).toBeLessThanOrEqual(3);
  });
});
