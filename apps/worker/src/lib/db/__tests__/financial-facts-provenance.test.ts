/**
 * financial-facts-provenance.test.ts
 *
 * Unit tests for packProvenanceMetadata / unpackProvenanceMetadata.
 *
 * Covers:
 *  1. Full round-trip: pack all 16 fields, unpack into a fresh fact → fields restored
 *  2. Empty pack: fact with no provenance fields → null returned
 *  3. Backward compat: unpack(null, fact) → no-op, fact unchanged
 *  4. Backward compat: unpack(undefined, fact) → no-op
 *  5. Partial pack: only some fields present → only those keys in JSONB object
 *  6. formula_dependencies array preserved across pack/unpack
 *  7. resolved_cross_sheet_values array preserved
 *  8. circular_reference_detected boolean preserved (true / false not packed)
 *  9. dependency_depth = null preserved
 * 10. formula = null preserved (vs formula key absent)
 */

import { describe, it, expect, vi } from "vitest";
import type { FinancialFactV1 } from "@dealdecision/core";
import { periodTypeCompatibility } from "@dealdecision/core";
import {
  packProvenanceMetadata,
  unpackProvenanceMetadata,
  getFinancialFactsForDeal,
  FINANCIAL_FACTS_ANALYSIS_LIMIT,
} from "../financial-facts-db.js";

// ─── Minimal valid FinancialFactV1 builder ─────────────────────────────────────

function baseFact(overrides: Partial<FinancialFactV1> = {}): FinancialFactV1 {
  return {
    fact_id: "factv1:deal-1:revenue:annual:FY2024:abc12345",
    deal_id: "00000000-0000-0000-0000-000000000001",
    source_kind: "xlsx",
    metric_key: "revenue",
    period_type: "annual",
    period_label: "FY2024",
    value: 5_000_000,
    unit: "currency",
    currency: "USD",
    confidence: "high",
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("packProvenanceMetadata", () => {
  it("returns null when no provenance fields are set", () => {
    const fact = baseFact();
    expect(packProvenanceMetadata(fact)).toBeNull();
  });

  it("includes only present fields (no undefined keys)", () => {
    const fact = baseFact({ value_kind: "literal" });
    const packed = packProvenanceMetadata(fact);
    expect(packed).not.toBeNull();
    expect(Object.keys(packed!)).toEqual(["value_kind"]);
    expect(packed!["value_kind"]).toBe("literal");
  });

  it("packs formula fields when value_kind = formula", () => {
    const fact = baseFact({
      value_kind: "formula",
      formula: "=SUM(C3:C17)",
      cross_sheet_refs: ["Inputs"],
      named_range_refs: ["GrowthRate"],
    });
    const packed = packProvenanceMetadata(fact);
    expect(packed).not.toBeNull();
    expect(packed!["value_kind"]).toBe("formula");
    expect(packed!["formula"]).toBe("=SUM(C3:C17)");
    expect(packed!["cross_sheet_refs"]).toEqual(["Inputs"]);
    expect(packed!["named_range_refs"]).toEqual(["GrowthRate"]);
  });

  it("packs formula = null (explicit null is preserved as a key)", () => {
    const fact = baseFact({ value_kind: "literal", formula: null });
    const packed = packProvenanceMetadata(fact);
    expect(packed).not.toBeNull();
    expect("formula" in packed!).toBe(true);
    expect(packed!["formula"]).toBeNull();
  });

  it("packs unit scale fields", () => {
    const fact = baseFact({
      unit_scale_factor_applied: 1000,
      unit_scale_source_text: "in thousands",
    });
    const packed = packProvenanceMetadata(fact);
    expect(packed!["unit_scale_factor_applied"]).toBe(1000);
    expect(packed!["unit_scale_source_text"]).toBe("in thousands");
  });

  it("packs period normalisation fields", () => {
    const fact = baseFact({
      normalized_period_label: "Q1 2024",
      original_period_label: "1Q24",
    });
    const packed = packProvenanceMetadata(fact);
    expect(packed!["normalized_period_label"]).toBe("Q1 2024");
    expect(packed!["original_period_label"]).toBe("1Q24");
  });

  it("packs all 16 fields when all are present", () => {
    const fact = baseFact({
      value_kind: "formula",
      formula: "=B2/B3",
      cross_sheet_refs: ["Model"],
      named_range_refs: ["BurnRate"],
      resolved_cross_sheet_values: [{ sheet: "Model", cell: "B2", value: 200000 }],
      formula_dependencies: [{ sheet: "Revenue", cell: "B2" }],
      dependency_depth: 3,
      circular_reference_detected: true,
      temporal_scope: "projected",
      scenario: "Base",
      cross_source_status: "supported",
      unit_scale_factor_applied: 1000,
      unit_scale_source_text: "in thousands",
      normalized_period_label: "Q1 2024",
      original_period_label: "1Q24",
      typing_reason: "header=Revenue col=FY2024",
    });
    const packed = packProvenanceMetadata(fact);
    expect(packed).not.toBeNull();
    expect(Object.keys(packed!)).toHaveLength(16);
  });
});

describe("unpackProvenanceMetadata", () => {
  it("is a no-op when raw is null", () => {
    const fact = baseFact();
    unpackProvenanceMetadata(null, fact);
    expect(fact.value_kind).toBeUndefined();
    expect(fact.formula).toBeUndefined();
  });

  it("is a no-op when raw is undefined", () => {
    const fact = baseFact();
    unpackProvenanceMetadata(undefined, fact);
    expect(fact.value_kind).toBeUndefined();
  });

  it("is a no-op when raw is not an object", () => {
    const fact = baseFact();
    unpackProvenanceMetadata("bad", fact);
    unpackProvenanceMetadata(42, fact);
    unpackProvenanceMetadata([], fact);
    expect(fact.value_kind).toBeUndefined();
  });

  it("restores value_kind and formula from packed JSONB", () => {
    const original = baseFact({
      value_kind: "formula",
      formula: "=SUM(C3:C17)",
    });
    const packed = packProvenanceMetadata(original);

    const target = baseFact();
    unpackProvenanceMetadata(packed, target);

    expect(target.value_kind).toBe("formula");
    expect(target.formula).toBe("=SUM(C3:C17)");
  });

  it("restores formula_dependencies array", () => {
    const deps = [{ sheet: "Revenue", cell: "C3" }, { sheet: "Inputs", cell: "A1" }];
    const original = baseFact({ formula_dependencies: deps });
    const target = baseFact();
    unpackProvenanceMetadata(packProvenanceMetadata(original), target);
    expect(target.formula_dependencies).toEqual(deps);
  });

  it("restores resolved_cross_sheet_values array", () => {
    const rcsv = [{ sheet: "Inputs", cell: "C5", value: 12000 }];
    const original = baseFact({ resolved_cross_sheet_values: rcsv });
    const target = baseFact();
    unpackProvenanceMetadata(packProvenanceMetadata(original), target);
    expect(target.resolved_cross_sheet_values).toEqual(rcsv);
  });

  it("restores circular_reference_detected = true", () => {
    const original = baseFact({ circular_reference_detected: true });
    const target = baseFact();
    unpackProvenanceMetadata(packProvenanceMetadata(original), target);
    expect(target.circular_reference_detected).toBe(true);
  });

  it("does NOT set circular_reference_detected when false (not packed)", () => {
    // false is falsy — pack skips it; after unpack the field stays undefined
    const original = baseFact({ circular_reference_detected: false });
    const packed = packProvenanceMetadata(original);
    // false is not packed (only `true` matters in practice)
    const target = baseFact();
    unpackProvenanceMetadata(packed, target);
    expect(target.circular_reference_detected).toBeUndefined();
  });

  it("restores dependency_depth = null", () => {
    const original = baseFact({ dependency_depth: null });
    const target = baseFact();
    unpackProvenanceMetadata(packProvenanceMetadata(original), target);
    expect(target.dependency_depth).toBeNull();
  });

  it("full round-trip: all 16 fields pack → unpack → unchanged", () => {
    const original = baseFact({
      value_kind: "formula",
      formula: "=B2/B3",
      cross_sheet_refs: ["Model"],
      named_range_refs: ["BurnRate"],
      resolved_cross_sheet_values: [{ sheet: "Model", cell: "B2", value: 200000 }],
      formula_dependencies: [{ sheet: "Revenue", cell: "B2" }],
      dependency_depth: 3,
      circular_reference_detected: true,
      temporal_scope: "projected",
      scenario: "Base",
      cross_source_status: "supported",
      unit_scale_factor_applied: 1000,
      unit_scale_source_text: "in thousands",
      normalized_period_label: "Q1 2024",
      original_period_label: "1Q24",
      typing_reason: "header=Revenue col=FY2024",
    });

    const packed = packProvenanceMetadata(original);
    const target = baseFact();
    unpackProvenanceMetadata(packed, target);

    expect(target.value_kind).toBe(original.value_kind);
    expect(target.formula).toBe(original.formula);
    expect(target.cross_sheet_refs).toEqual(original.cross_sheet_refs);
    expect(target.named_range_refs).toEqual(original.named_range_refs);
    expect(target.resolved_cross_sheet_values).toEqual(original.resolved_cross_sheet_values);
    expect(target.formula_dependencies).toEqual(original.formula_dependencies);
    expect(target.dependency_depth).toBe(original.dependency_depth);
    expect(target.circular_reference_detected).toBe(original.circular_reference_detected);
    expect(target.temporal_scope).toBe(original.temporal_scope);
    expect(target.scenario).toBe(original.scenario);
    expect(target.cross_source_status).toBe(original.cross_source_status);
    expect(target.unit_scale_factor_applied).toBe(original.unit_scale_factor_applied);
    expect(target.unit_scale_source_text).toBe(original.unit_scale_source_text);
    expect(target.normalized_period_label).toBe(original.normalized_period_label);
    expect(target.original_period_label).toBe(original.original_period_label);
    expect(target.typing_reason).toBe(original.typing_reason);
  });
});

// ─── getFinancialFactsForDeal — read round-trip ────────────────────────────────
//
// Verifies that the SELECT in getFinancialFactsForDeal() includes
// provenance_metadata, slide_type, and slide_title, and that rowToFact()
// restores all provenance fields via unpackProvenanceMetadata.
//
// Uses a mock pool so no real DB connection is required.

/** Build a minimal DB row exactly as pg would return it. */
function dbRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    fact_id:               "factv1:deal-1:revenue:annual:FY2024:abc12345",
    deal_id:               "00000000-0000-0000-0000-000000000001",
    document_id:           null,
    source_kind:           "xlsx",
    metric_key:            "revenue",
    metric_label:          "Total Revenue",
    period_type:           "annual",
    period_label:          "FY2024",
    value:                 5_000_000,
    unit:                  "currency",
    currency:              "USD",
    confidence:            "high",
    reconciliation_status: null,
    sheet_name:            "Revenue",
    page_number:           null,
    row_index:             3,
    col_index:             4,
    source_pointer:        null,
    evidence_id:           null,
    excerpt:               null,
    slide_type:            null,
    slide_title:           null,
    provenance_metadata:   null,
    ...overrides,
  };
}

/** Minimal mock pool whose query() returns fixed rows. */
function mockPool(rows: Record<string, unknown>[]) {
  return {
    query: vi.fn().mockResolvedValue({ rows }),
  } as unknown as import("pg").Pool;
}

describe("getFinancialFactsForDeal — read round-trip with provenance_metadata", () => {
  it("restores all provenance fields from provenance_metadata JSONB", async () => {
    const provenanceMeta = packProvenanceMetadata(baseFact({
      value_kind: "formula",
      formula: "=SUM(C3:C17)",
      cross_sheet_refs: ["Inputs"],
      named_range_refs: ["GrowthRate"],
      formula_dependencies: [{ sheet: "Revenue", cell: "C3" }],
      dependency_depth: 2,
      circular_reference_detected: true,
      temporal_scope: "projected",
      scenario: "Base",
      cross_source_status: "supported",
      unit_scale_factor_applied: 1000,
      unit_scale_source_text: "in thousands",
      normalized_period_label: "FY 2024",
      original_period_label: "FY24",
      typing_reason: "header=Revenue col=FY2024",
    }));

    const pool = mockPool([dbRow({ provenance_metadata: provenanceMeta })]);
    const facts = await getFinancialFactsForDeal(pool, "00000000-0000-0000-0000-000000000001");

    expect(facts).toHaveLength(1);
    const f = facts[0];

    // Scalar provenance fields
    expect(f.value_kind).toBe("formula");
    expect(f.formula).toBe("=SUM(C3:C17)");
    expect(f.cross_sheet_refs).toEqual(["Inputs"]);
    expect(f.named_range_refs).toEqual(["GrowthRate"]);
    expect(f.formula_dependencies).toEqual([{ sheet: "Revenue", cell: "C3" }]);
    expect(f.dependency_depth).toBe(2);
    expect(f.circular_reference_detected).toBe(true);

    // Critical integrity-analysis fields
    expect(f.temporal_scope).toBe("projected");
    expect(f.scenario).toBe("Base");
    expect(f.cross_source_status).toBe("supported");

    // Unit-scale fields
    expect(f.unit_scale_factor_applied).toBe(1000);
    expect(f.unit_scale_source_text).toBe("in thousands");

    // Period normalisation fields
    expect(f.normalized_period_label).toBe("FY 2024");
    expect(f.original_period_label).toBe("FY24");
    expect(f.typing_reason).toBe("header=Revenue col=FY2024");
  });

  it("returns a valid fact with no provenance fields when provenance_metadata is null (backward compat)", async () => {
    const pool = mockPool([dbRow({ provenance_metadata: null })]);
    const facts = await getFinancialFactsForDeal(pool, "00000000-0000-0000-0000-000000000001");

    expect(facts).toHaveLength(1);
    const f = facts[0];

    // Scalar fields survive
    expect(f.fact_id).toBe("factv1:deal-1:revenue:annual:FY2024:abc12345");
    expect(f.metric_key).toBe("revenue");
    expect(f.value).toBe(5_000_000);
    expect(f.confidence).toBe("high");

    // Provenance fields are absent (undefined) — not set, not null
    expect(f.temporal_scope).toBeUndefined();
    expect(f.scenario).toBeUndefined();
    expect(f.cross_source_status).toBeUndefined();
    expect(f.formula).toBeUndefined();
    expect(f.value_kind).toBeUndefined();
  });

  it("maps slide_type and slide_title from DB row", async () => {
    const pool = mockPool([dbRow({
      slide_type: "financials",
      slide_title: "Revenue Overview",
      provenance_metadata: null,
    })]);
    const facts = await getFinancialFactsForDeal(pool, "00000000-0000-0000-0000-000000000001");

    expect(facts[0].slide_type).toBe("financials");
    expect(facts[0].slide_title).toBe("Revenue Overview");
  });

  it("returns empty array when pool returns no rows", async () => {
    const pool = mockPool([]);
    const facts = await getFinancialFactsForDeal(pool, "00000000-0000-0000-0000-000000000001");
    expect(facts).toHaveLength(0);
  });
});

// ─── periodTypeCompatibility — temporal_scope field ───────────────────────────
//
// Verifies that the integrity-analyzer function correctly interprets
// temporal_scope once the field is restored from provenance_metadata.
// (Previously this field was always undefined, defaulting to "historical".)

describe("periodTypeCompatibility — uses restored temporal_scope", () => {
  it("FAIL when one fact is projected and the other is historical", () => {
    const historical = baseFact({ temporal_scope: "historical" });
    const projected  = baseFact({ temporal_scope: "projected", period_label: "FY2025" });

    const result = periodTypeCompatibility(historical, projected);

    expect(result.compatible).toBe(false);
    expect(result.severity).toBe("FAIL");
    expect(result.reason).toMatch(/temporal scope mismatch/);
  });

  it("PASS when both facts are projected (no mismatch)", () => {
    const a = baseFact({ temporal_scope: "projected" });
    const b = baseFact({ temporal_scope: "projected", period_label: "FY2025" });

    const result = periodTypeCompatibility(a, b);

    expect(result.severity).not.toBe("FAIL");
    // reason should not mention temporal mismatch
    expect(result.reason).not.toMatch(/temporal scope mismatch/);
  });

  it("FAIL when one fact is scenario and the other is historical (scope treated as projected)", () => {
    const historical = baseFact({ temporal_scope: "historical" });
    const scenario   = baseFact({ temporal_scope: "scenario", period_label: "FY2025" });

    const result = periodTypeCompatibility(historical, scenario);

    expect(result.compatible).toBe(false);
    expect(result.severity).toBe("FAIL");
  });

  it("PASS when both facts lack temporal_scope (treated as historical — the pre-fix default)", () => {
    // temporal_scope undefined → alertIsProjectedFact returns false for both
    const a = baseFact();
    const b = baseFact({ period_label: "FY2025" });

    const result = periodTypeCompatibility(a, b);

    // Both treated as historical — no temporal mismatch FAIL
    expect(result.reason).not.toMatch(/temporal scope mismatch/);
  });
});

// ─── getFinancialFactsForDeal — limit and truncation behavior ─────────────────
//
// Verifies that:
// 1. FINANCIAL_FACTS_ANALYSIS_LIMIT is > 100 (the old hard cap)
// 2. getFinancialFactsForDeal() correctly passes the caller's limit to SQL, up
//    to FINANCIAL_FACTS_ANALYSIS_LIMIT
// 3. Reads of > 100 facts succeed (no silent 100-row cap)
// 4. When the pool returns exactly FINANCIAL_FACTS_ANALYSIS_LIMIT rows callers
//    can detect potential truncation by comparing length to the constant

/** Build N minimal DB rows for a given deal. */
function buildRows(n: number, dealId = "00000000-0000-0000-0000-000000000001"): Record<string, unknown>[] {
  return Array.from({ length: n }, (_, i) => ({
    fact_id:               `factv1:deal-1:revenue:annual:FY${2000 + i}:abc${i.toString().padStart(5, "0")}`,
    deal_id:               dealId,
    document_id:           null,
    source_kind:           "xlsx",
    metric_key:            "revenue",
    metric_label:          "Total Revenue",
    period_type:           "annual",
    period_label:          `FY${2000 + i}`,
    value:                 1_000_000 + i,
    unit:                  "currency",
    currency:              "USD",
    confidence:            "high",
    reconciliation_status: null,
    sheet_name:            "Revenue",
    page_number:           null,
    row_index:             i,
    col_index:             0,
    source_pointer:        null,
    evidence_id:           null,
    excerpt:               null,
    slide_type:            null,
    slide_title:           null,
    provenance_metadata:   null,
  }));
}

describe("FINANCIAL_FACTS_ANALYSIS_LIMIT constant", () => {
  it("is exported and greater than the old hard cap of 100", () => {
    expect(typeof FINANCIAL_FACTS_ANALYSIS_LIMIT).toBe("number");
    expect(FINANCIAL_FACTS_ANALYSIS_LIMIT).toBeGreaterThan(100);
  });

  it("is at least 500 — covers dense multi-period financial models", () => {
    // 20 metrics × 10 periods × 2 sources = 400 facts. 500 is the minimum safe ceiling.
    expect(FINANCIAL_FACTS_ANALYSIS_LIMIT).toBeGreaterThanOrEqual(500);
  });
});

describe("getFinancialFactsForDeal — limit enforcement above old 100-row cap", () => {
  it("returns 150 facts when pool provides 150 and limit=150 is requested", async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: buildRows(150) }) } as unknown as import("pg").Pool;
    const facts = await getFinancialFactsForDeal(pool, "00000000-0000-0000-0000-000000000001", { limit: 150 });
    expect(facts).toHaveLength(150);
  });

  it("returns 200 facts when pool provides 200 and limit=200 is requested (processor path)", async () => {
    // Regression guard: before the fix this was silently capped to 100.
    const pool = { query: vi.fn().mockResolvedValue({ rows: buildRows(200) }) } as unknown as import("pg").Pool;
    const facts = await getFinancialFactsForDeal(pool, "00000000-0000-0000-0000-000000000001", { limit: 200 });
    expect(facts).toHaveLength(200);
  });

  it("returns FINANCIAL_FACTS_ANALYSIS_LIMIT facts when requested at the ceiling", async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: buildRows(FINANCIAL_FACTS_ANALYSIS_LIMIT) }) } as unknown as import("pg").Pool;
    const facts = await getFinancialFactsForDeal(pool, "00000000-0000-0000-0000-000000000001", { limit: FINANCIAL_FACTS_ANALYSIS_LIMIT });
    expect(facts).toHaveLength(FINANCIAL_FACTS_ANALYSIS_LIMIT);
  });

  it("clamps requests above FINANCIAL_FACTS_ANALYSIS_LIMIT to the ceiling", async () => {
    // Caller requests more than the ceiling — pool would return at most ceiling rows from SQL.
    const cappedRows = buildRows(FINANCIAL_FACTS_ANALYSIS_LIMIT);
    const pool = { query: vi.fn().mockResolvedValue({ rows: cappedRows }) } as unknown as import("pg").Pool;

    const facts = await getFinancialFactsForDeal(
      pool,
      "00000000-0000-0000-0000-000000000001",
      { limit: FINANCIAL_FACTS_ANALYSIS_LIMIT + 1000 }
    );

    // The SQL LIMIT in the query is capped to FINANCIAL_FACTS_ANALYSIS_LIMIT —
    // confirm the pool was called with the right clamped value.
    const callArg: string = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0][0];
    // The SQL contains the limit as a parameter — pool receives it as a number in params.
    const params: unknown[] = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0][1];
    const limitParam = params.find((p) => typeof p === "number" && p <= FINANCIAL_FACTS_ANALYSIS_LIMIT);
    expect(limitParam).toBe(FINANCIAL_FACTS_ANALYSIS_LIMIT);
    // Result length matches what pool returned (ceiling rows)
    expect(facts).toHaveLength(FINANCIAL_FACTS_ANALYSIS_LIMIT);
    // Callers can detect truncation by comparing length to constant
    expect(facts.length >= FINANCIAL_FACTS_ANALYSIS_LIMIT).toBe(true);
  });

  it("passes limit=25 to SQL by default", async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [] }) } as unknown as import("pg").Pool;
    await getFinancialFactsForDeal(pool, "00000000-0000-0000-0000-000000000001");
    const params: unknown[] = (pool.query as ReturnType<typeof vi.fn>).mock.calls[0][1];
    const limitParam = params.find((p) => typeof p === "number");
    expect(limitParam).toBe(25);
  });
});
