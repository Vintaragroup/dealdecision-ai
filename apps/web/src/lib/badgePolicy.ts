/**
 * Badge Policy — pure functions for Overview tab badge suppression.
 *
 * These functions determine whether "Needs review" and "No explicit citation"
 * badges should be shown or suppressed based on report gating state.
 *
 * They are intentionally pure (no React dependencies) so they can be unit
 * tested in isolation from component rendering.
 *
 * Call sites:
 *   - DealWorkspace.tsx    → chooseGovernedFirst() — suppresses needsReview in provenance
 *   - dealworkspace_overview_comp.tsx → renderProvenanceChips(), renderFieldEvidence()
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type BadgePolicyGatingState = {
  /**
   * True when the report status field equals `'deterministic_only'`.
   * This is the ONLY terminal status the investor engine emits — it applies
   * on all code paths (gate failure, LLM stage failure, and the happy path).
   */
  isDeterministicOnly: boolean;

  /**
   * Whether the Evidence Gate v1 was evaluated and passed.
   *
   * - `true`:    Gate passed — LLM stages were called (even if some failed).
   * - `false`:   Gate failed — LLM stages were skipped entirely.
   * - `null`:    Gate not present — either old engine (pre-gate) or report not loaded.
   */
  evidenceGatePassed: boolean | null;
};

// ── Derivation ────────────────────────────────────────────────────────────────

/**
 * Derive the badge policy gating state from the report fields already
 * available in the UI.
 *
 * Accepts either `status_summary.evidence_gate` (preferred) or
 * `render_package.evidence_gate` — both have a `.passed` boolean.
 */
export function deriveGatingState(opts: {
  reportStatus?: string | null;
  evidenceGate?: { passed: boolean; blocking_reason?: string | null } | null;
}): BadgePolicyGatingState {
  return {
    isDeterministicOnly: opts.reportStatus === 'deterministic_only',
    evidenceGatePassed: opts.evidenceGate != null ? opts.evidenceGate.passed : null,
  };
}

// ── Rules ─────────────────────────────────────────────────────────────────────

/**
 * Returns `true` when the **"Needs review"** badge should be **suppressed**.
 *
 * ### When suppressed
 * - `isDeterministicOnly === true` AND
 * - `evidenceGatePassed !== true` (i.e. gate failed or was absent / old engine)
 *
 * ### Rationale
 * "Needs review" implies an LLM produced output that a human should scrutinise.
 * When the evidence gate blocked the LLM stages from running at all, there is
 * nothing governed to review — showing the badge is misleading.  The correct
 * label for that state is "Not generated (gated)" (see `getGatedLabel()`).
 *
 * **Exception:** when the evidence gate *passed* but a governed section is
 * still missing (e.g. `GOVERNED_SUMMARY_V1_SKIP` due to validation failure),
 * the badge is kept — something ran, something was unexpected, a human should
 * look.
 */
export function shouldSuppressNeedsReview(gating: BadgePolicyGatingState): boolean {
  if (!gating.isDeterministicOnly) return false;
  // Gate passed → LLM stages were attempted → "Needs review" may be legitimate.
  if (gating.evidenceGatePassed === true) return false;
  // Gate failed (false) or absent (null / old engine) → LLM never ran → suppress.
  return true;
}

/**
 * Returns `true` when the **"No explicit citation"** badge should be
 * **suppressed**.
 *
 * ### When suppressed
 * - `isDeterministicOnly === true`
 *
 * ### Rationale
 * "No explicit citation" implies the system searched for source evidence and
 * found none.  Deterministic fields are derived from structured extraction, not
 * from evidence-blob citations per the UI evidence model — showing the badge
 * implies a failed search that never happened.
 */
export function shouldSuppressNoCitation(gating: BadgePolicyGatingState): boolean {
  return gating.isDeterministicOnly;
}

/**
 * Returns a human-readable label when the field was **not generated** due to
 * engine gating, or `null` when the field should render normally.
 *
 * ### When non-null
 * - `isDeterministicOnly === true` AND `evidenceGatePassed === false`
 *
 * The label text is intentionally terse so it fits inline with existing chips.
 */
export function getGatedLabel(gating: BadgePolicyGatingState): string | null {
  if (gating.isDeterministicOnly && gating.evidenceGatePassed === false) {
    return 'Not generated (gated)';
  }
  return null;
}
