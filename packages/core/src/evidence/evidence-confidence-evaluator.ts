/**
 * evidence-confidence-evaluator.ts
 *
 * Evidence Confidence Evaluator — PR36.6 (Phase 2)
 *
 * Pure function: no I/O, no DB, no LLM calls.
 *
 * Scoring algorithm (precedence order, first match wins):
 *
 *   1. NotComputable          → SUPPRESSED  (cannot promote what wasn't extracted)
 *   2. numeric_sanity_pass=false → SUPPRESSED  (malformed value — hard block)
 *   3. has_cross_source_conflict → CONFLICTING  (sources disagree — show as signal)
 *   4. source_type = "derived"  → PROVISIONAL  (inferred, not directly cited)
 *   5. text_quality_pass=false  → WEAK_EVIDENCE  (OCR/format quality concern)
 *   6. evidence_count >= 2      → VERIFIED  (cross-validated from multiple refs)
 *   7. source_type = "xlsx"     → STRONG_EVIDENCE  (structured financial data)
 *   8. evidence_count >= 1      → STRONG_EVIDENCE  (single good source)
 *   9. (fallback)               → WEAK_EVIDENCE
 *
 *  External corroboration post-processing (Phase 7 upgrade):
 *   WEAK_EVIDENCE  + external_corroborated → STRONG_EVIDENCE
 *   STRONG_EVIDENCE + external_corroborated → VERIFIED
 */

import {
  EVIDENCE_CONFIDENCE_LEVEL,
  type EvidenceConfidenceLevel,
  type EvidenceConfidenceSignals,
  type FactConfidenceState,
} from "./evidence-confidence";

// ─── Core evaluator ──────────────────────────────────────────────────────────

/**
 * Compute the evidence confidence level for a single canonical field.
 *
 * @param signals - Signal bundle assembled by the deterministic extraction stage.
 * @returns Fully scored FactConfidenceState with level + reason.
 *
 * @example
 * ```ts
 * const state = computeEvidenceConfidence({
 *   computability: 'Computable',
 *   evidence_count: 1,
 *   source_type: 'xlsx',
 *   has_cross_source_conflict: false,
 *   numeric_sanity_pass: true,
 *   text_quality_pass: true,
 *   external_corroborated: false,
 * });
 * // state.level === 'STRONG_EVIDENCE'
 * ```
 */
export function computeEvidenceConfidence(
  signals: EvidenceConfidenceSignals,
): FactConfidenceState {
  let level: EvidenceConfidenceLevel;
  let reason: string;

  // ── Blocking conditions ──────────────────────────────────────────────────

  if (signals.computability === "NotComputable") {
    return {
      level: EVIDENCE_CONFIDENCE_LEVEL.SUPPRESSED,
      signals,
      reason: "Field is NotComputable — no value was extracted",
    };
  }

  if (!signals.numeric_sanity_pass) {
    return {
      level: EVIDENCE_CONFIDENCE_LEVEL.SUPPRESSED,
      signals,
      reason: "Value failed numeric sanity check (malformed currency, percent scale error, or zero placeholder)",
    };
  }

  // ── Conflict — must surface as signal, not fact ──────────────────────────

  if (signals.has_cross_source_conflict) {
    return {
      level: EVIDENCE_CONFIDENCE_LEVEL.CONFLICTING,
      signals,
      reason: "Field appears in conflict registry — deck and XLSX (or two sources) report different values",
    };
  }

  // ── Derived (inferred, no direct citation) ───────────────────────────────

  if (signals.source_type === "derived") {
    // Derived values can be upgraded by external corroboration
    if (signals.external_corroborated) {
      return {
        level: EVIDENCE_CONFIDENCE_LEVEL.STRONG_EVIDENCE,
        signals,
        reason: "Derived value externally corroborated — upgraded from PROVISIONAL to STRONG_EVIDENCE",
      };
    }
    return {
      level: EVIDENCE_CONFIDENCE_LEVEL.PROVISIONAL,
      signals,
      reason: "Value is inferred from computations on other fields — no direct evidence citation",
    };
  }

  // ── Text quality failure → weaker but not blocked ───────────────────────

  if (!signals.text_quality_pass) {
    level = EVIDENCE_CONFIDENCE_LEVEL.WEAK_EVIDENCE;
    reason = "Text candidate failed quality gate (spreadsheet fragment, OCR continuation, or incoherent text)";
    // External corroboration can upgrade even low-quality text
    if (signals.external_corroborated) {
      return {
        level: EVIDENCE_CONFIDENCE_LEVEL.STRONG_EVIDENCE,
        signals,
        reason: "Weak text candidate externally corroborated — upgraded to STRONG_EVIDENCE",
      };
    }
    return { level, signals, reason };
  }

  // ── Base confidence from evidence count and source type ──────────────────

  if (signals.evidence_count >= 2) {
    // Cross-validated: multiple independent evidence refs agree
    level = EVIDENCE_CONFIDENCE_LEVEL.VERIFIED;
    reason = `Cross-validated — ${signals.evidence_count} independent evidence references agree`;
  } else if (signals.source_type === "xlsx") {
    // Structured financial data is intrinsically reliable at single-source
    level = EVIDENCE_CONFIDENCE_LEVEL.STRONG_EVIDENCE;
    reason = "Value derived from structured XLSX financial data (high reliability)";
  } else if (signals.evidence_count >= 1) {
    // Single good text evidence reference
    level = EVIDENCE_CONFIDENCE_LEVEL.STRONG_EVIDENCE;
    reason = "Single evidence reference found — text extraction quality passed";
  } else {
    // Has a value but no traceable evidence reference
    level = EVIDENCE_CONFIDENCE_LEVEL.WEAK_EVIDENCE;
    reason = "No traceable evidence reference — value is present but uncited";
  }

  // ── Phase 7: External corroboration upgrade ──────────────────────────────

  if (signals.external_corroborated) {
    if (level === EVIDENCE_CONFIDENCE_LEVEL.WEAK_EVIDENCE) {
      return {
        level: EVIDENCE_CONFIDENCE_LEVEL.STRONG_EVIDENCE,
        signals,
        reason: reason + " (upgraded by external corroboration: WEAK → STRONG)",
      };
    }
    if (level === EVIDENCE_CONFIDENCE_LEVEL.STRONG_EVIDENCE) {
      return {
        level: EVIDENCE_CONFIDENCE_LEVEL.VERIFIED,
        signals,
        reason: reason + " (upgraded by external corroboration: STRONG → VERIFIED)",
      };
    }
  }

  return { level, signals, reason };
}

// ─── Utility: signals from canonical field attributes ────────────────────────

/**
 * Build EvidenceConfidenceSignals from the flat attributes available on a
 * canonical field entry.  Called in stage-2-deterministic.ts after the full
 * fields + conflicts lists are assembled.
 *
 * @param computability      - Field computability
 * @param evidenceRef        - Evidence reference string (null = no reference)
 * @param source             - Source classification from the extraction pipeline
 * @param reasonCode         - Slot reason code from extraction
 * @param hasConflict        - True when this field.name appears in the conflicts list
 * @param corroborationCount - Number of distinct evidence sources that agree on this value.
 *                             When ≥ 2, evidence_count is set to 2 → enables VERIFIED tier.
 *                             Defaults to 0 (no explicit corroboration count supplied).
 * @param externalCorroborated - True when Phase 7 external diligence confirms it
 */
export function buildConfidenceSignals({
  computability,
  evidenceRef,
  source,
  reasonCode,
  hasConflict,
  corroborationCount = 0,
  externalCorroborated = false,
}: {
  computability: "Computable" | "NotComputable";
  evidenceRef: string | null;
  source: "xlsx" | "deck" | "derived" | "unknown" | null | undefined;
  reasonCode: string | null | undefined;
  hasConflict: boolean;
  /** Number of distinct evidence refs that agree on this value (enables VERIFIED when ≥ 2). */
  corroborationCount?: number;
  externalCorroborated?: boolean;
}): EvidenceConfidenceSignals {
  const isDerived = typeof reasonCode === "string" && reasonCode.startsWith("DERIVED_FROM_");
  const resolvedSource: EvidenceConfidenceSignals["source_type"] = isDerived
    ? "derived"
    : (source ?? "unknown");

  // Corroboration count drives evidence_count:
  //   ≥ 2 independent refs agree → evidence_count = 2 → VERIFIED tier
  //   exactly 1 ref (or a non-null evidenceRef with no explicit count) → 1 → STRONG_EVIDENCE
  //   0 → no traceable reference → WEAK_EVIDENCE
  const evidenceCount = corroborationCount >= 2 ? 2 : (evidenceRef != null ? 1 : 0);

  return {
    computability,
    evidence_count: evidenceCount,
    source_type: resolvedSource,
    has_cross_source_conflict: hasConflict,
    // Fields that have passed stage-2 deterministic extraction are treated as
    // having passed numeric sanity and text quality by default.  Stage-2 already
    // suppresses malformed values before creating Computable CanonicalFields.
    // Override these if additional validation results become available.
    numeric_sanity_pass: true,
    text_quality_pass: true,
    external_corroborated: externalCorroborated,
  };
}
