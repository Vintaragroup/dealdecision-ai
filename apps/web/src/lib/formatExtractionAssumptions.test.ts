/**
 * formatExtractionAssumptions.test.ts
 *
 * Unit tests for the formatExtractionAssumptions() and
 * formatExtractionAssumptionsText() utilities.
 *
 * Runs under vitest (apps/web uses vitest).
 */

import { describe, it, expect } from "vitest";
import {
  formatExtractionAssumptions,
  formatExtractionAssumptionsText,
} from "./formatExtractionAssumptions";
import type { FinancialFactV1 } from "@dealdecision/core";

// ─── Fixture ──────────────────────────────────────────────────────────────────

function baseFact(overrides: Partial<FinancialFactV1> = {}): Partial<FinancialFactV1> {
  return {
    fact_id: "factv1:test:revenue:annual:2024:abc12345",
    deal_id: "deal-test",
    metric_key: "revenue",
    period_type: "annual",
    period_label: "2024",
    value: 5_000_000,
    unit: "currency",
    source_kind: "xlsx",
    confidence: "high",
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("formatExtractionAssumptions()", () => {

  it("returns empty array for a minimal fact with no assumption metadata", () => {
    const lines = formatExtractionAssumptions(baseFact());
    expect(lines).toHaveLength(0);
  });

  // ── Scale factor ────────────────────────────────────────────────────────────

  it("emits Scale line when unit_scale_factor_applied is set with source text", () => {
    const lines = formatExtractionAssumptions(
      baseFact({ unit_scale_factor_applied: 1000, unit_scale_source_text: "in thousands" }),
    );
    const line = lines.find((l) => l.label === "Scale");
    expect(line).toBeDefined();
    expect(line!.display).toBe('×1000 ("in thousands")');
  });

  it("emits Scale line without source text when source text is absent", () => {
    const lines = formatExtractionAssumptions(
      baseFact({ unit_scale_factor_applied: 1_000_000 }),
    );
    const line = lines.find((l) => l.label === "Scale");
    expect(line).toBeDefined();
    expect(line!.display).toBe("×1000000");
  });

  it("does not emit Scale line when factor is 1", () => {
    const lines = formatExtractionAssumptions(
      baseFact({ unit_scale_factor_applied: 1 }),
    );
    expect(lines.find((l) => l.label === "Scale")).toBeUndefined();
  });

  // ── Period normalization ────────────────────────────────────────────────────

  it("emits Period line showing original → normalized when they differ", () => {
    const lines = formatExtractionAssumptions(
      baseFact({ original_period_label: "1Q24", normalized_period_label: "Q1 2024" }),
    );
    const line = lines.find((l) => l.label === "Period");
    expect(line).toBeDefined();
    expect(line!.display).toBe("1Q24 → Q1 2024");
  });

  it("does not emit Period line when original and normalized are identical", () => {
    const lines = formatExtractionAssumptions(
      baseFact({ original_period_label: "FY2024", normalized_period_label: "FY2024" }),
    );
    expect(lines.find((l) => l.label === "Period")).toBeUndefined();
  });

  it("emits Period from normalized alone when original is absent", () => {
    const lines = formatExtractionAssumptions(
      baseFact({ normalized_period_label: "Q1 2024" }),
    );
    const line = lines.find((l) => l.label === "Period");
    expect(line).toBeDefined();
    expect(line!.display).toBe("Q1 2024");
  });

  // ── Temporal scope ──────────────────────────────────────────────────────────

  it("emits Scope line for 'projected' scope", () => {
    const lines = formatExtractionAssumptions(
      baseFact({ temporal_scope: "projected" }),
    );
    const line = lines.find((l) => l.label === "Scope");
    expect(line).toBeDefined();
    expect(line!.display).toBe("projected");
  });

  it("does not emit Scope line for 'unknown' scope", () => {
    const lines = formatExtractionAssumptions(
      baseFact({ temporal_scope: "unknown" }),
    );
    expect(lines.find((l) => l.label === "Scope")).toBeUndefined();
  });

  // ── Value kind ──────────────────────────────────────────────────────────────

  it("emits Value kind line for 'formula'", () => {
    const lines = formatExtractionAssumptions(baseFact({ value_kind: "formula" }));
    const line = lines.find((l) => l.label === "Value kind");
    expect(line).toBeDefined();
    expect(line!.display).toBe("formula");
  });

  it("emits Value kind line for 'literal'", () => {
    const lines = formatExtractionAssumptions(baseFact({ value_kind: "literal" }));
    expect(lines.find((l) => l.label === "Value kind")?.display).toBe("literal");
  });

  it("does not emit Value kind line for 'unknown'", () => {
    const lines = formatExtractionAssumptions(baseFact({ value_kind: "unknown" }));
    expect(lines.find((l) => l.label === "Value kind")).toBeUndefined();
  });

  // ── Formula ────────────────────────────────────────────────────────────────

  it("emits Formula line when formula is present", () => {
    const lines = formatExtractionAssumptions(
      baseFact({ value_kind: "formula", formula: "=SUM(C3:C17)" }),
    );
    const line = lines.find((l) => l.label === "Formula");
    expect(line).toBeDefined();
    expect(line!.display).toBe("=SUM(C3:C17)");
  });

  // ── Cross-sheet refs ────────────────────────────────────────────────────────

  it("emits Cross-sheet line when refs are present", () => {
    const lines = formatExtractionAssumptions(
      baseFact({ cross_sheet_refs: ["Inputs", "Revenue Build"] }),
    );
    const line = lines.find((l) => l.label === "Cross-sheet");
    expect(line).toBeDefined();
    expect(line!.display).toBe("Inputs, Revenue Build");
  });

  it("does not emit Cross-sheet line when refs array is empty", () => {
    const lines = formatExtractionAssumptions(baseFact({ cross_sheet_refs: [] }));
    expect(lines.find((l) => l.label === "Cross-sheet")).toBeUndefined();
  });

  // ── Named range refs ──────────────────────────────────────────────

  it("emits Named ranges line when named_range_refs is present", () => {
    const lines = formatExtractionAssumptions(
      baseFact({ named_range_refs: ["ARR_Base", "ChurnRate"] }),
    );
    const line = lines.find((l) => l.label === "Named ranges");
    expect(line).toBeDefined();
    expect(line!.display).toBe("ARR_Base, ChurnRate");
  });

  it("does not emit Named ranges line when ref array is empty", () => {
    const lines = formatExtractionAssumptions(baseFact({ named_range_refs: [] }));
    expect(lines.find((l) => l.label === "Named ranges")).toBeUndefined();
  });

  it("does not emit Named ranges line when field is absent", () => {
    const lines = formatExtractionAssumptions(baseFact());
    expect(lines.find((l) => l.label === "Named ranges")).toBeUndefined();
  });

  // ── Resolved cross-sheet values ──────────────────────────────────────

  it("emits Cross-sheet values line when resolved_cross_sheet_values is present", () => {
    const lines = formatExtractionAssumptions(
      baseFact({
        resolved_cross_sheet_values: [
          { sheet: "Inputs", cell: "C5", value: 12.5 },
          { sheet: "Revenue Build", cell: "D12", value: 450000 },
        ],
      }),
    );
    const line = lines.find((l) => l.label === "Cross-sheet values");
    expect(line).toBeDefined();
    expect(line!.display).toBe("Inputs!C5=12.5, Revenue Build!D12=450000");
  });

  it("renders unresolved ref as SheetName!CellAddr=? when value is null", () => {
    const lines = formatExtractionAssumptions(
      baseFact({
        resolved_cross_sheet_values: [
          { sheet: "Assumptions", cell: "B12", value: null },
        ],
      }),
    );
    const line = lines.find((l) => l.label === "Cross-sheet values");
    expect(line).toBeDefined();
    expect(line!.display).toBe("Assumptions!B12=?");
  });

  it("does not emit Cross-sheet values line when array is empty", () => {
    const lines = formatExtractionAssumptions(
      baseFact({ resolved_cross_sheet_values: [] }),
    );
    expect(lines.find((l) => l.label === "Cross-sheet values")).toBeUndefined();
  });

  it("does not emit Cross-sheet values line when field is absent", () => {
    const lines = formatExtractionAssumptions(baseFact());
    expect(lines.find((l) => l.label === "Cross-sheet values")).toBeUndefined();
  });

  // ── Formula dependencies (Phase 2E) ───────────────────────────────────────

  it("emits Dependencies line when formula_dependencies is present", () => {
    const lines = formatExtractionAssumptions(
      baseFact({
        formula_dependencies: [
          { sheet: "Inputs", cell: "C5" },
          { sheet: "Revenue Build", cell: "D12" },
        ],
      }),
    );
    const line = lines.find((l) => l.label === "Dependencies");
    expect(line).toBeDefined();
    expect(line!.display).toBe("Inputs!C5, Revenue Build!D12");
  });

  it("does not emit Dependencies line when formula_dependencies is empty", () => {
    const lines = formatExtractionAssumptions(
      baseFact({ formula_dependencies: [] }),
    );
    expect(lines.find((l) => l.label === "Dependencies")).toBeUndefined();
  });

  it("does not emit Dependencies line when field is absent", () => {
    const lines = formatExtractionAssumptions(baseFact());
    expect(lines.find((l) => l.label === "Dependencies")).toBeUndefined();
  });

  // ── Dependency depth (Phase 2E) ─────────────────────────────────────────

  it("emits Dep depth line when dependency_depth is a number", () => {
    const lines = formatExtractionAssumptions(
      baseFact({ dependency_depth: 3 }),
    );
    const line = lines.find((l) => l.label === "Dep depth");
    expect(line).toBeDefined();
    expect(line!.display).toBe("3");
  });

  it("emits Dep depth line for depth 1", () => {
    const lines = formatExtractionAssumptions(
      baseFact({ dependency_depth: 1 }),
    );
    expect(lines.find((l) => l.label === "Dep depth")?.display).toBe("1");
  });

  it("does not emit Dep depth line when dependency_depth is null", () => {
    const lines = formatExtractionAssumptions(
      baseFact({ dependency_depth: null }),
    );
    expect(lines.find((l) => l.label === "Dep depth")).toBeUndefined();
  });

  it("does not emit Dep depth line when field is absent", () => {
    const lines = formatExtractionAssumptions(baseFact());
    expect(lines.find((l) => l.label === "Dep depth")).toBeUndefined();
  });

  // ── Circular reference detected (Phase 2E) ──────────────────────────────

  it("emits Circular ref line when circular_reference_detected is true", () => {
    const lines = formatExtractionAssumptions(
      baseFact({ circular_reference_detected: true }),
    );
    const line = lines.find((l) => l.label === "Circular ref");
    expect(line).toBeDefined();
    expect(line!.display).toBe("detected");
  });

  it("does not emit Circular ref line when circular_reference_detected is false", () => {
    const lines = formatExtractionAssumptions(
      baseFact({ circular_reference_detected: false }),
    );
    expect(lines.find((l) => l.label === "Circular ref")).toBeUndefined();
  });

  it("does not emit Circular ref line when field is absent", () => {
    const lines = formatExtractionAssumptions(baseFact());
    expect(lines.find((l) => l.label === "Circular ref")).toBeUndefined();
  });

  // ── Label rule (from typing_reason) ─────────────────────────────────────────

  it("emits Label rule from typing_reason when field_type is matched", () => {
    const lines = formatExtractionAssumptions(
      baseFact({
        typing_reason: 'Row label "Revenue" matched pattern for revenue_canonical_v1; column="FY2024"',
      }),
    );
    const line = lines.find((l) => l.label === "Label rule");
    expect(line).toBeDefined();
    expect(line!.display).toBe("revenue_canonical_v1");
  });

  it("emits Label rule for 'classified as' pattern (catch-all match)", () => {
    const lines = formatExtractionAssumptions(
      baseFact({
        typing_reason: 'Row label "Custom KPI" did not match any canonical pattern; classified as other_metric_v1',
      }),
    );
    const line = lines.find((l) => l.label === "Label rule");
    expect(line).toBeDefined();
    expect(line!.display).toBe("other_metric_v1");
  });

  // ── Full metadata ────────────────────────────────────────────────────────────

  it("returns all lines for a fully-annotated fact", () => {
    const fact = baseFact({
      unit_scale_factor_applied: 1000,
      unit_scale_source_text: "in thousands",
      original_period_label: "1Q24",
      normalized_period_label: "Q1 2024",
      temporal_scope: "projected",
      value_kind: "formula",
      formula: "=Inputs!C5",
      cross_sheet_refs: ["Inputs"],
      named_range_refs: ["Revenue_Budget"],
      resolved_cross_sheet_values: [{ sheet: "Inputs", cell: "C5", value: 5000000 }],
      formula_dependencies: [{ sheet: "Inputs", cell: "C5" }],
      dependency_depth: 2,
      circular_reference_detected: true,
      typing_reason: 'Row label "Revenue" matched pattern for revenue_canonical_v1; column="1Q24"',
    });
    const lines = formatExtractionAssumptions(fact);
    const labels = lines.map((l) => l.label);
    expect(labels).toContain("Scale");
    expect(labels).toContain("Period");
    expect(labels).toContain("Scope");
    expect(labels).toContain("Value kind");
    expect(labels).toContain("Formula");
    expect(labels).toContain("Cross-sheet");
    expect(labels).toContain("Named ranges");
    expect(labels).toContain("Cross-sheet values");
    expect(labels).toContain("Dependencies");
    expect(labels).toContain("Dep depth");
    expect(labels).toContain("Circular ref");
    expect(labels).toContain("Label rule");
  });

  // ── Empty / null inputs ──────────────────────────────────────────────────────

  it("returns empty array for empty object (no crash)", () => {
    expect(() => formatExtractionAssumptions({})).not.toThrow();
    expect(formatExtractionAssumptions({})).toHaveLength(0);
  });
});

// ─── formatExtractionAssumptionsText() ────────────────────────────────────────

describe("formatExtractionAssumptionsText()", () => {
  it("returns empty string for a fact with no metadata", () => {
    expect(formatExtractionAssumptionsText(baseFact())).toBe("");
  });

  it("returns newline-separated label: display lines", () => {
    const text = formatExtractionAssumptionsText(
      baseFact({
        unit_scale_factor_applied: 1000,
        unit_scale_source_text: "in thousands",
        temporal_scope: "historical",
      }),
    );
    expect(text).toContain("Scale:");
    expect(text).toContain("×1000");
    expect(text).toContain("Scope: historical");
    // Lines separated by \n
    expect(text.split("\n").length).toBeGreaterThanOrEqual(2);
  });
});
