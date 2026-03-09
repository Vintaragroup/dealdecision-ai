/**
 * evidence-confidence.ts
 *
 * Central Evidence Confidence Model — PR36.6
 *
 * Defines the confidence classification system for canonical facts before they
 * are promoted to investor-facing output (deal_overview_v2, display_facts_v1,
 * governed summaries, llm_interpretation_v1, investor insights UI).
 *
 * Design contract:
 *  - Every Computable canonical field receives exactly one EvidenceConfidenceLevel.
 *  - NotComputable fields receive SUPPRESSED automatically.
 *  - The confidence level travels with the field through the pipeline and is:
 *    (a) serialised as `confidence=...` in canonical_fields section body
 *    (b) parsed back by render-package-helpers and web hooks for UI rendering
 *    (c) passed to the LLM as context metadata (rule 14 / PR36.6)
 *
 * Routing summary:
 *  VERIFIED        → always promotable; no UI label
 *  STRONG_EVIDENCE → promotable; no UI label
 *  WEAK_EVIDENCE   → promotable with "limited evidence" label
 *  CONFLICTING     → not promotable as a fact; must appear as "conflicting signals"
 *  PROVISIONAL     → suppressed from summary cards; may appear in data tab
 *  SUPPRESSED      → never shown in any investor-facing surface
 */

// ─── Confidence Levels ────────────────────────────────────────────────────────

/**
 * Ordered confidence levels from strongest to weakest.
 * String values are serialised verbatim into canonical_fields KV lines.
 */
export const EVIDENCE_CONFIDENCE_LEVEL = {
  /**
   * Multiple strong, independent evidence sources agree on this value.
   * Example: raise_amount confirmed on deck slide AND structured XLSX model.
   */
  VERIFIED: "VERIFIED",

  /**
   * Single strong source or high-quality evidence with no contradictions.
   * Example: ARR appears once in structured financial XLSX with a clear label.
   */
  STRONG_EVIDENCE: "STRONG_EVIDENCE",

  /**
   * Weak OCR extraction, low signal candidate, or single unverified deck mention.
   * Example: product_solution candidate from a fragmented OCR page.
   * Promotable only with uncertainty language ("limited evidence").
   */
  WEAK_EVIDENCE: "WEAK_EVIDENCE",

  /**
   * Multiple candidates disagree — deck and XLSX (or two deck pages) report
   * different values for the same field.
   * Must not appear as a definitive fact; must surface as "conflicting signals".
   */
  CONFLICTING: "CONFLICTING",

  /**
   * Value is inferred or derived but not directly supported by an explicit
   * evidence reference. Example: use_of_funds derived from budget model algebra.
   * Suppressed from summary cards; may appear in data tab with caveat.
   */
  PROVISIONAL: "PROVISIONAL",

  /**
   * Blocked by sanity filters, quality gates, or the field could not be computed.
   * NotComputable fields and malformed/implausible values receive this level.
   * Never shown in any investor-facing surface.
   */
  SUPPRESSED: "SUPPRESSED",
} as const;

export type EvidenceConfidenceLevel =
  (typeof EVIDENCE_CONFIDENCE_LEVEL)[keyof typeof EVIDENCE_CONFIDENCE_LEVEL];

/** All valid confidence level values for exhaustive validation. */
export const ALL_CONFIDENCE_LEVELS: ReadonlySet<EvidenceConfidenceLevel> = new Set(
  Object.values(EVIDENCE_CONFIDENCE_LEVEL),
);

// ─── Signal inputs ────────────────────────────────────────────────────────────

/**
 * Input signals used to compute a confidence level for a single canonical field.
 * All signals are derivable from the deterministic extraction stage — no LLM
 * calls or DB lookups required.
 */
export interface EvidenceConfidenceSignals {
  /**
   * Whether the deterministic extractor was able to compute a value.
   * NotComputable always yields SUPPRESSED.
   */
  computability: "Computable" | "NotComputable";

  /**
   * Number of distinct evidence references backing this field.
   * 0 = no evidence (placeholder / default); 1 = single source; 2+ = cross-validated.
   * Currently the pipeline stores at most 1 evidenceRef per canonical field;
   * 2+ will be set when cross-source agreement is explicitly detected.
   */
  evidence_count: number;

  /**
   * Source classification:
   *  "xlsx"    — value came from structured spreadsheet data (high reliability)
   *  "deck"    — value extracted from PDF/presentation text or OCR
   *  "derived" — value inferred from computations on other fields (no direct citation)
   *  "unknown" — source classification unavailable
   */
  source_type: "xlsx" | "deck" | "derived" | "unknown";

  /**
   * True when this field name appears in the ConflictEntry registry,
   * indicating deck and XLSX (or two separate text mentions) report
   * different values for the same field.
   */
  has_cross_source_conflict: boolean;

  /**
   * Did the value pass numeric sanity checks (malformed currency, percent scale,
   * zero-denominator)?  False means the value would have been blocked; true means
   * it either passed or no numeric check applies to this field.
   */
  numeric_sanity_pass: boolean;

  /**
   * Did the text pass text-candidate quality checks (spreadsheet fragment,
   * OCR continuation, incoherent noun list)?  False means the candidate was
   * detected as low-quality text.
   */
  text_quality_pass: boolean;

  /**
   * True when external diligence (Phase 7) has confirmed this fact via a
   * corroborating external source.  Can upgrade WEAK_EVIDENCE → STRONG_EVIDENCE
   * or STRONG_EVIDENCE → VERIFIED.  Defaults to false until external processing
   * runs.
   */
  external_corroborated: boolean;
}

// ─── Scored output ────────────────────────────────────────────────────────────

/**
 * The scored confidence result attached to a canonical fact.
 * `level` is the primary output used for promotion gating and UI rendering.
 * `signals` is retained for debugging and audit purposes.
 */
export interface FactConfidenceState {
  /** Computed confidence level for this canonical field. */
  level: EvidenceConfidenceLevel;
  /** Snapshot of the signals used to compute the level. */
  signals: EvidenceConfidenceSignals;
  /**
   * Human-readable reason explaining the assigned level.
   * Surfaced in debug/audit output; not shown in investor-facing UI.
   */
  reason: string;
}
