/**
 * formatExtractionAssumptions.ts
 *
 * Formats FinancialFactV1 extraction assumption metadata into concise,
 * analyst-readable display lines.
 *
 * Design rules:
 *  - Pure function — no side effects, no imports from API/DB layers.
 *  - Returns an empty array when no assumption metadata is present.
 *  - Each line is a short human-readable string suitable for a tooltip,
 *    expandable drawer, or debug panel.
 *  - Never throws — all fields are optional/nullable.
 */

import type { FinancialFactV1 } from "@dealdecision/core";

/**
 * One display line describing a single extraction assumption.
 *
 * `label`   — short category label (e.g. "Scale", "Period", "Value kind")
 * `display` — human-readable value string (e.g. "×1000 ("in thousands")")
 */
export interface ExtractionAssumptionLine {
  label: string;
  display: string;
}

/**
 * Produce display lines for extraction assumption metadata on a FinancialFactV1.
 *
 * Lines are only emitted when the relevant field is present and meaningful.
 * Callers should hide the section entirely when the returned array is empty.
 *
 * Example output for a scaled XLSX fact with a cross-tab formula:
 * ```
 * [
 *   { label: "Scale",          display: "×1000 ("in thousands")" },
 *   { label: "Period",         display: "1Q24 → Q1 2024" },
 *   { label: "Scope",          display: "projected" },
 *   { label: "Value kind",     display: "formula" },
 *   { label: "Formula",        display: "=SUM(Inputs!C3:C17)" },
 *   { label: "Cross-sheet",    display: "Inputs, Revenue Build" },
 *   { label: "Label rule",     display: "revenue_canonical_v1" },
 * ]
 * ```
 */
export function formatExtractionAssumptions(
  fact: Partial<FinancialFactV1>,
): ExtractionAssumptionLine[] {
  const lines: ExtractionAssumptionLine[] = [];

  // Scale factor
  if (fact.unit_scale_factor_applied != null && fact.unit_scale_factor_applied > 1) {
    const scaleText = fact.unit_scale_source_text
      ? `×${fact.unit_scale_factor_applied} ("${fact.unit_scale_source_text}")`
      : `×${fact.unit_scale_factor_applied}`;
    lines.push({ label: "Scale", display: scaleText });
  }

  // Period normalization (only when raw ≠ normalized)
  if (fact.original_period_label && fact.normalized_period_label) {
    if (fact.original_period_label !== fact.normalized_period_label) {
      lines.push({
        label: "Period",
        display: `${fact.original_period_label} → ${fact.normalized_period_label}`,
      });
    }
  } else if (fact.normalized_period_label) {
    lines.push({ label: "Period", display: fact.normalized_period_label });
  }

  // Temporal scope (omit "unknown" — conveys no actionable information)
  if (fact.temporal_scope && fact.temporal_scope !== "unknown") {
    lines.push({ label: "Scope", display: fact.temporal_scope });
  }

  // Value kind (formula / literal / unknown)
  if (fact.value_kind && fact.value_kind !== "unknown") {
    lines.push({ label: "Value kind", display: fact.value_kind });
  }

  // Formula string
  if (fact.formula) {
    lines.push({ label: "Formula", display: fact.formula });
  }

  // Cross-sheet references
  if (fact.cross_sheet_refs && fact.cross_sheet_refs.length > 0) {
    lines.push({ label: "Cross-sheet", display: fact.cross_sheet_refs.join(", ") });
  }

  // Named range references — workbook-level named cells/ranges used in the formula.
  // Only shown when detected; empty arrays are omitted cleanly.
  if (fact.named_range_refs && fact.named_range_refs.length > 0) {
    lines.push({ label: "Named ranges", display: fact.named_range_refs.join(", ") });
  }

  // Resolved cross-sheet values — direct single-cell refs resolved to their workbook values.
  // Format: SheetName!CellAddr=value, e.g. "Inputs!C5=12.5, Revenue Build!D12=450000"
  // Only shown when at least one ref was resolved; hides cleanly when absent or empty.
  if (fact.resolved_cross_sheet_values && fact.resolved_cross_sheet_values.length > 0) {
    const resolvedDisplay = fact.resolved_cross_sheet_values
      .map(({ sheet, cell, value }) =>
        value !== null ? `${sheet}!${cell}=${value}` : `${sheet}!${cell}=?`
      )
      .join(", ");
    lines.push({ label: "Cross-sheet values", display: resolvedDisplay });
  }

  // Formula dependencies — direct single-cell deps (same-sheet + cross-sheet).
  // Format: "Inputs!C5, Revenue!D3" — sheet-qualified cell addresses.
  // Absent when the formula has no direct cell references or formula metadata is unavailable.
  if (fact.formula_dependencies && fact.formula_dependencies.length > 0) {
    const depsDisplay = fact.formula_dependencies
      .map(({ sheet, cell }) => `${sheet}!${cell}`)
      .join(", ");
    lines.push({ label: "Dependencies", display: depsDisplay });
  }

  // Dependency depth — how many formula hops from literal leaf inputs.
  // Absent when depth is null (circular ref) or unavailable.
  if (fact.dependency_depth != null) {
    lines.push({ label: "Dep depth", display: String(fact.dependency_depth) });
  }

  // Circular reference detection — flag when any direct dep is in a cycle.
  // Only shown when detected (true); hidden cleanly when absent.
  if (fact.circular_reference_detected) {
    lines.push({ label: "Circular ref", display: "detected" });
  }

  // Label rule — extract the matched field_type from typing_reason
  if (fact.typing_reason) {
    const ruleMatch = /matched pattern for (\w+_v1)|classified as (\w+_v1)/i.exec(fact.typing_reason);
    if (ruleMatch) {
      const rule = ruleMatch[1] ?? ruleMatch[2];
      if (rule) lines.push({ label: "Label rule", display: rule });
    }
  }

  return lines;
}

/**
 * Formats assumptions as a plain-text multi-line string.
 * Useful for tooltips and \`title\` attributes where JSX is unavailable.
 *
 * Returns an empty string when no assumption metadata is present.
 */
export function formatExtractionAssumptionsText(
  fact: Partial<FinancialFactV1>,
): string {
  const lines = formatExtractionAssumptions(fact);
  return lines.map((l) => `${l.label}: ${l.display}`).join("\n");
}
