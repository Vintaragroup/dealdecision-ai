/**
 * packages/core/src/analyzers/__tests__/financial-integrity-has-facts.test.ts
 *
 * Unit tests for the `has_facts` field on FinancialIntegrityV1.
 *
 * Validates that:
 *  1. `has_facts = false` when the analyzer receives an empty facts array.
 *  2. `has_facts = true` when the analyzer receives one or more facts.
 *  3. The Zod schema default for `has_facts` is false (as used by
 *     buildEmptyFinancialIntegrityV1 and cache-miss code paths).
 *  4. The field propagates correctly through the Zod parse round-trip.
 *
 * Runs under Jest (globals: describe / test / expect).
 */

import { FinancialIntegrityAnalyzerV1 } from "../financial-integrity-analyzer-v1";
import { FinancialIntegrityV1Schema } from "../../types/financial-integrity-v1";
import type { FinancialFactV1 } from "../../financial-facts/financial-fact-v1";

// ─── Fixture helpers ──────────────────────────────────────────────────────────

let seq = 0;

function makeFact(
  overrides: Partial<FinancialFactV1> & Pick<FinancialFactV1, "metric_key" | "value">,
): FinancialFactV1 {
  const id = `has-facts-test-${++seq}`;
  return {
    fact_id: id,
    deal_id: "deal-has-facts-test",
    source_kind: "xlsx",
    period_type: "annual",
    period_label: "FY2024",
    unit: "currency",
    currency: "USD",
    confidence: "high",
    reconciliation_status: "ok",
    temporal_scope: "historical",
    ...overrides,
  } as FinancialFactV1;
}

const analyzer = new FinancialIntegrityAnalyzerV1();

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("FinancialIntegrityV1 — has_facts field", () => {
  describe("analyzer output", () => {
    it("has_facts=false when facts array is empty", async () => {
      const result = await analyzer.analyze({ financial_facts: [] });
      expect(result.has_facts).toBe(false);
    });

    it("has_facts=true when facts array has one fact", async () => {
      const facts = [makeFact({ metric_key: "revenue", value: 1_000_000 })];
      const result = await analyzer.analyze({ financial_facts: facts });
      expect(result.has_facts).toBe(true);
    });

    it("has_facts=true when facts array has multiple facts", async () => {
      const facts = [
        makeFact({ metric_key: "revenue", value: 1_000_000 }),
        makeFact({ metric_key: "arr", value: 800_000 }),
        makeFact({ metric_key: "burn_rate", value: 50_000 }),
      ];
      const result = await analyzer.analyze({ financial_facts: facts });
      expect(result.has_facts).toBe(true);
    });

    it("has_facts=false does not depend on flags length (completeness:no_facts flags may be present)", async () => {
      const result = await analyzer.analyze({ financial_facts: [] });
      // Empty facts still produces completeness flag but has_facts must remain false
      expect(result.has_facts).toBe(false);
    });
  });

  describe("Zod schema defaults (simulates buildEmptyFinancialIntegrityV1 behavior)", () => {
    it("schema default for has_facts is false when field is omitted", () => {
      const parsed = FinancialIntegrityV1Schema.parse({
        computed_at: new Date().toISOString(),
        completeness_score: 0,
        missing_critical: [],
        missing_supplementary: [],
        flags: [],
        // has_facts intentionally omitted → should default to false
      });
      expect(parsed.has_facts).toBe(false);
    });

    it("schema accepts has_facts=true and preserves it", () => {
      const parsed = FinancialIntegrityV1Schema.parse({
        computed_at: new Date().toISOString(),
        completeness_score: 75,
        missing_critical: [],
        missing_supplementary: [],
        flags: [],
        has_facts: true,
      });
      expect(parsed.has_facts).toBe(true);
    });

    it("schema round-trip preserves has_facts from analyzer output", async () => {
      const facts = [makeFact({ metric_key: "revenue", value: 500_000 })];
      const analyzed = await analyzer.analyze({ financial_facts: facts });
      const parsed = FinancialIntegrityV1Schema.parse(analyzed);
      expect(parsed.has_facts).toBe(analyzed.has_facts);
      expect(parsed.has_facts).toBe(true);
    });
  });
});
