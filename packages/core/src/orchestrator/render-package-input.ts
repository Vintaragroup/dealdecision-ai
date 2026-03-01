/**
 * Minimal duck-typed interface for the investor insights render package
 * as used by the orchestrator composition layer.
 *
 * This avoids a hard cross-package dependency on the worker's schema
 * while still providing full type safety for the fields we access.
 */

export interface OrchestratorRenderPackageSection {
  key: string;
  title?: string | null;
  kind?: string | null;
  body?: string | null;
  items?: unknown[];
  fallback?: string | null;
}

export interface OrchestratorGateResult {
  gate: string;
  passed: boolean;
  reason_code?: string | null;
  threshold?: number;
  actual?: number;
}

export interface OrchestratorGateState {
  all_passed: boolean;
  results: OrchestratorGateResult[];
}

/**
 * The subset of the investor insights render_package that the orchestrator
 * composer reads. Any object that satisfies this shape is accepted.
 */
export interface OrchestratorRenderPackageInput {
  schema_version: string;
  upstream_fingerprint: string;
  sections: OrchestratorRenderPackageSection[];
  gate_state: OrchestratorGateState;
}
