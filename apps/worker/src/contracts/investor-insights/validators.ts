import { GateStateSchema, RenderPackageSchema, type RenderPackage } from "./schemas";

/**
 * Investor Insights – Deterministic Validators (Binding)
 * These functions convert governance requirements into code-level enforcement.
 */

export function validateGateState(input: unknown) {
  return GateStateSchema.parse(input);
}

export function validateRenderPackage(input: unknown): RenderPackage {
  return RenderPackageSchema.parse(input);
}

/**
 * No-empty-block enforcement:
 * Each section must have either:
 * - non-empty items, OR
 * - a non-empty body, OR
 * - a non-empty fallback string.
 */
export function validateNoEmptyBlocks(pkg: RenderPackage): void {
  for (const s of pkg.sections) {
    const itemsOk = Array.isArray((s as any).items) && (s as any).items.length > 0;
    const bodyOk = typeof (s as any).body === "string" && (s as any).body.trim().length > 0;
    const fallbackOk = typeof (s as any).fallback === "string" && (s as any).fallback.trim().length > 0;
    if (!itemsOk && !bodyOk && !fallbackOk) {
      throw new Error(`COMPLIANCE_EMPTY_BLOCK_RENDER_VIOLATION: section=${s.key}`);
    }
  }
}

/**
 * Reason-code format enforcement (PR1):
 * - reason codes must be UPPER_SNAKE_CASE when present.
 */
export function validateReasonCodeFormat(reasonCode?: string): void {
  if (!reasonCode) return;
  if (!/^[A-Z0-9_]+$/.test(reasonCode)) {
    throw new Error(`COMPLIANCE_REASON_CODE_NOT_IN_REGISTRY: reason_code=${reasonCode}`);
  }
}
