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

import { describe, it, expect } from "vitest";
import type { FinancialFactV1 } from "@dealdecision/core";
import {
  packProvenanceMetadata,
  unpackProvenanceMetadata,
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
