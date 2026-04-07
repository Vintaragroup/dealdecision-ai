/**
 * Canonical Decision Resolver — Scoring Authority Unification
 *
 * PURPOSE:
 *   Produce ONE authoritative CanonicalDecision from all scoring tracks
 *   that exist in the DealDecisionAI system.
 *
 * SCORE TRACK PRIORITY:
 *   1. overall_score (Track 1, PRIMARY)   — from analyze_deal → deals.overall_score
 *   2. ORS (Track 2, FALLBACK)            — from orchestrator; used when T1 is absent
 *   3. VCScoringV2 (Track 3, SUPPORTING)  — investment posture; validation signal
 *   4. VentureLensV1 (Track 3b, ADVISORY) — conviction overlay on V2
 *
 *   Track 4 (LimitedScoringV1) is internal to Stage 2 of the investor insights
 *   pipeline. It does not produce a score visible in the orchestrator report and
 *   is NOT included as a canonical decision input.
 *
 * VERDICT UNIFICATION:
 *   All existing verdict/recommendation vocabularies are translated into ONE
 *   five-value CanonicalVerdict. See mapping functions below for explicit tables.
 *
 * KNOWN GAP — VentureLensV1 team dimension [G2]:
 *   VentureLensV1.venture_score permanently defaults the team dimension to 50
 *   (neutral) because `dimension_scores.team` is not wired from the DIO pipeline
 *   into the orchestrator render package. Until this is resolved:
 *     - ventureLens.final_investment_score is used as a soft advisory signal only
 *     - It is excluded from hard conflict detection
 *   TODO [G2]: Wire StageWeightedScoringV1.dimensions.team into the render package
 *              to activate the full VentureLensV1 team conviction signal.
 *   See: packages/core/src/scoring/vc-venture-lens-v1.ts (team null fallback note)
 *        packages/core/src/orchestrator/build-orchestrator-report-v1.ts
 *        docs/Supporting/audit/deal-understanding-task-reports/
 *        2026-04-07-intelligence-scoring-discovery-report.md — §6.2, G2
 */

// ─── Public verdict vocabulary ────────────────────────────────────────────────

/**
 * The ONE canonical verdict for a deal. All existing verdict systems are
 * mapped into this 5-value enum.
 *
 * Mapping summary:
 *
 * | From                    | Value             | → CanonicalVerdict |
 * |-------------------------|-------------------|--------------------|
 * | scoreband: fund_confident (85-100)  | strong_yes        |
 * | scoreband: fund_track (75-84)        | strong_yes        |
 * | scoreband: fund_caution (65-74)      | yes               |
 * | scoreband: strong_consider (55-64)   | watch             |
 * | scoreband: consider_caution (45-54)  | pass              |
 * | scoreband: hard_pass (0-44)          | strong_pass       |
 * | ORS decision: GO (ORS >= 80)         | strong_yes        |
 * | ORS decision: GO (ORS < 80)          | yes               |
 * | ORS decision: CONSIDER               | watch             |
 * | ORS decision: NO_GO                  | strong_pass       |
 * | VCScoringV2 posture: INVESTABLE      | strong_yes        |
 * | VCScoringV2 posture: HIGH_PRIORITY   | yes               |
 * | VCScoringV2 posture: INVESTIGATE     | watch             |
 * | VCScoringV2 posture: MONITOR         | pass              |
 * | VCScoringV2 posture: PASS            | strong_pass       |
 * | WorkspaceVerdict: FUND + score >= 75 | strong_yes        |
 * | WorkspaceVerdict: FUND               | yes               |
 * | WorkspaceVerdict: CONSIDER           | watch             |
 * | WorkspaceVerdict: PASS               | pass              |
 * | WorkspaceVerdict: HARD_PASS          | strong_pass       |
 */
export type CanonicalVerdict =
  | "strong_yes"   // Fund (High Confidence) / INVESTABLE / GO at ORS>=80
  | "yes"          // Fund (Caution or Track) / HIGH_PRIORITY_DILIGENCE / GO at ORS<80
  | "watch"        // Strong Consider / INVESTIGATE / CONSIDER
  | "pass"         // Consider (Caution) / MONITOR
  | "strong_pass"; // Hard Pass / PASS / NO_GO

// ─── Source breakdown ─────────────────────────────────────────────────────────

/** Traceability record: all contributing scores, normalized to 0–100. */
export interface CanonicalDecisionSourceBreakdown {
  /** Track 1 — primary authority. From analyze_deal → deals.overall_score. */
  overall_score?: number;
  /**
   * Track 3b — VentureLensV1 final_investment_score (conviction overlay on V2).
   * NOTE: advisory only until VentureLensV1 team dimension is wired (G2).
   */
  venture_lens?: number;
  /** Track 3 — VCScoringV2 composite score. Does not include the VentureLens adjustment. */
  vc_scoring?: number;
  /** Track 2 — orchestrator deterministic scores. */
  orchestrator?: {
    ORS?: number;
    DCI?: number;
    FHC?: number | null;
    URSS?: number;
  };
}

// ─── Canonical decision ───────────────────────────────────────────────────────

export interface CanonicalDecision {
  /**
   * Authoritative normalized score 0–100.
   * Primary source: overall_score (Track 1 — analyze_deal pipeline).
   * Fallback:       ORS (Track 2 — orchestrator) when overall_score is absent.
   */
  score: number;

  /**
   * Authoritative verdict from the unified CanonicalVerdict vocabulary.
   * Derived deterministically from the authoritative score.
   */
  verdict: CanonicalVerdict;

  /**
   * Confidence in this decision, 0–1.
   * Factors that increase confidence:
   *   - Track 1 (overall_score) availability: +0.10
   *   - Intelligence layer earned_confidence present: +0.05
   *   - High DCI (document coverage): proportional contribution
   * Factors that decrease confidence:
   *   - System conflict (>15pt variance between T1 and T2 scores): −0.20
   */
  confidence: number;

  /**
   * Key reasons driving the verdict. Sources:
   *   - orchestrator executive_summary.strengths
   *   - ventureLens.reasons
   *   - conflict detection messages
   *   - score authority diagnostics
   */
  drivers: string[];

  /**
   * Key risk signals. Sources:
   *   - orchestrator risk_verification.top_risks
   *   - URSS threshold breach
   *   - intelligence earned_confidence below 50
   *   - ventureLens LOW conviction
   */
  risks: string[];

  /** All contributing score signals. For traceability only — not authoritative. */
  source_breakdown: CanonicalDecisionSourceBreakdown;

  /**
   * True when Track 1 (overall_score) and Track 2 (ORS) differ by >15 points.
   * When true, confidence is reduced and a driver message is injected.
   * VentureLensV1 score is excluded from conflict detection (see G2 note).
   */
  conflict_detected: boolean;

  /**
   * Diagnostic note. Example:
   *   "authority=overall_score[T1]; sources=[overall_score[T1], ORS[T2], VCScoringV2[T3]]; conflict=true"
   */
  resolver_note: string;
}

// ─── Verdict mapping functions ────────────────────────────────────────────────

/**
 * Map a 0–100 numeric score to a CanonicalVerdict.
 * Uses the same breakpoints as ScoreBandV2 defined in score-bands-v2.ts.
 *
 * 75–100 → strong_yes   (fund_track / fund_confident)
 * 65–74  → yes          (fund_caution)
 * 55–64  → watch        (strong_consider)
 * 45–54  → pass         (consider_caution)
 * 0–44   → strong_pass  (hard_pass)
 */
export function mapScoreToCanonicalVerdict(score: number): CanonicalVerdict {
  const s = Math.round(Math.min(100, Math.max(0, score)));
  if (s >= 75) return "strong_yes";
  if (s >= 65) return "yes";
  if (s >= 55) return "watch";
  if (s >= 45) return "pass";
  return "strong_pass";
}

/**
 * Map ORS DecisionLabel ("GO" | "CONSIDER" | "NO_GO") to CanonicalVerdict.
 *
 * GO (ORS >= 80) → strong_yes
 * GO (ORS <  80) → yes
 * CONSIDER       → watch
 * NO_GO          → strong_pass
 * unknown        → watch (conservative fallback)
 */
export function mapOrchestratorDecisionToVerdict(
  label: string,
  ors?: number | null
): CanonicalVerdict {
  switch (label) {
    case "GO":
      return typeof ors === "number" && Number.isFinite(ors) && ors >= 80
        ? "strong_yes"
        : "yes";
    case "CONSIDER":
      return "watch";
    case "NO_GO":
      return "strong_pass";
    default:
      return "watch";
  }
}

/**
 * Map VCScoringV2 InvestmentPosture to CanonicalVerdict.
 *
 * INVESTABLE              → strong_yes
 * HIGH_PRIORITY_DILIGENCE → yes
 * INVESTIGATE             → watch
 * MONITOR                 → pass
 * PASS                    → strong_pass
 * unknown                 → watch (conservative fallback)
 */
export function mapPostureToVerdict(posture: string): CanonicalVerdict {
  switch (posture) {
    case "INVESTABLE":              return "strong_yes";
    case "HIGH_PRIORITY_DILIGENCE": return "yes";
    case "INVESTIGATE":             return "watch";
    case "MONITOR":                 return "pass";
    case "PASS":                    return "strong_pass";
    default:                        return "watch";
  }
}

/**
 * Map WorkspaceVerdict ("HARD_PASS" | "FUND" | "CONSIDER" | "PASS") to CanonicalVerdict.
 * `score` is used to distinguish strong_yes from yes within "FUND".
 *
 * HARD_PASS            → strong_pass
 * PASS                 → pass
 * CONSIDER             → watch
 * FUND (score >= 75)   → strong_yes
 * FUND (score <  75)   → yes
 */
export function mapWorkspaceVerdictToCanonical(
  verdict: string,
  score?: number | null
): CanonicalVerdict {
  switch (verdict) {
    case "HARD_PASS": return "strong_pass";
    case "PASS":      return "pass";
    case "CONSIDER":  return "watch";
    case "FUND":
      return typeof score === "number" && Number.isFinite(score) && score >= 75
        ? "strong_yes"
        : "yes";
    default:          return "watch";
  }
}

// ─── Conflict detection ───────────────────────────────────────────────────────

/** Scores further apart than this (on a 0–100 scale) trigger conflict_detected. */
const CONFLICT_THRESHOLD_PTS = 15;

/** Returns true when any two valid scores differ by more than CONFLICT_THRESHOLD_PTS. */
function detectScoreConflict(scores: Array<number | undefined | null>): boolean {
  const valid = scores.filter(
    (s): s is number => typeof s === "number" && Number.isFinite(s)
  );
  if (valid.length < 2) return false;
  return Math.max(...valid) - Math.min(...valid) > CONFLICT_THRESHOLD_PTS;
}

// ─── Confidence computation ───────────────────────────────────────────────────

/**
 * Compute resolver confidence 0–1.
 *
 * DCI (0–100) provides the base coverage quality contribution.
 * Modifications:
 *   +0.10 when overall_score (Track 1) is available
 *   +0.05 when Stage 5 intelligence earned_confidence is available
 *   −0.20 when scoring systems disagree by >15 pts
 * Result is clamped to [0, 1] and rounded to 2 decimal places.
 */
function computeResolverConfidence(opts: {
  dci_score: number | undefined | null;
  primary_available: boolean;
  conflict_detected: boolean;
  intelligence_available: boolean;
}): number {
  let conf =
    typeof opts.dci_score === "number" && Number.isFinite(opts.dci_score)
      ? opts.dci_score / 100
      : 0.5; // neutral default when DCI not available

  if (opts.primary_available)         conf += 0.10;
  if (opts.intelligence_available)    conf += 0.05;
  if (opts.conflict_detected)         conf -= 0.20;

  return Math.min(1, Math.max(0, Math.round(conf * 100) / 100));
}

// ─── Resolver input type ──────────────────────────────────────────────────────

/** Input to resolveCanonicalDecision. All fields optional for graceful degradation. */
export interface CanonicalDecisionInput {
  /**
   * Track 1 PRIMARY: from deals.overall_score.
   * This is the single most authoritative score in the system.
   * When present, all other scores become supporting signals.
   */
  overall_score?: number | null;

  /**
   * Track 3b ADVISORY: VentureLensV1 result.
   * NOTE: advisory only — team dimension is neutral until G2 is resolved.
   * TODO [G2]: Do not use final_investment_score as a conflict trigger until
   *            dimension_scores.team is wired from the DIO pipeline.
   */
  ventureLens?: {
    final_investment_score?: number;
    final_posture?: string;
    venture_score?: number;
    conviction_level?: string;
    reasons?: string[];
  } | null;

  /**
   * Track 3 SUPPORTING: VCScoringV2 result.
   * Provides an independent investment posture based on opportunity/confidence/risk axes.
   */
  vcScoring?: {
    vc_composite_score?: number;
    investment_posture?: string;
  } | null;

  /**
   * Track 2 SUPPORTING/FALLBACK: orchestrator deterministic scores + decision.
   * ORS is the fallback authoritative score when overall_score is absent.
   * DCI feeds confidence computation. URSS feeds risk signal injection.
   */
  orchestrator?: {
    ORS?: number;
    DCI?: number;
    FHC?: number | null;
    URSS?: number;
    /** ORS decision label: "GO" | "CONSIDER" | "NO_GO" */
    decision_label?: string;
  } | null;

  /**
   * Stage 5 intelligence signals.
   * earned_confidence: output from confidence-engine/service.ts (base − penalties + memory adj).
   */
  intelligence?: {
    earned_confidence?: number | null;
  } | null;

  /**
   * Key driver strings. Pass orchestrator executive_summary.strengths or similar.
   * These are included verbatim in CanonicalDecision.drivers.
   */
  drivers?: string[];

  /**
   * Key risk strings. Pass orchestrator risk_verification.top_risks[].risk or similar.
   * These are included verbatim in CanonicalDecision.risks.
   */
  risks?: string[];
}

// ─── Main resolver ────────────────────────────────────────────────────────────

/**
 * Resolve all scoring inputs into ONE authoritative CanonicalDecision.
 *
 * Authority rules:
 *   1. overall_score (T1) is the primary score when present. All others are supporting.
 *   2. ORS (T2) is the fallback score when overall_score is absent.
 *   3. VCScoringV2 (T3) is a supporting validation signal.
 *   4. VentureLensV1 (T3b) is an advisory signal. NOT a conflict trigger. (See G2)
 *
 * Conflict detection:
 *   - Only T1 vs T2 (and T1 vs T3) scores are compared.
 *   - T3b (VentureLensV1) excluded due to permanent team neutral default (G2).
 *   - >15pt variance triggers conflict flag, reduces confidence, injects driver message.
 *
 * TODO [G2]: Once dimension_scores.team is wired from the DIO pipeline:
 *   - Include ventureLensScore in conflict detection
 *   - Weight ventureLens conviction in confidence computation
 */
export function resolveCanonicalDecision(
  input: CanonicalDecisionInput
): CanonicalDecision {
  // ─── 1. Extract and clamp individual scores ────────────────────────────────

  const primaryScore =
    typeof input.overall_score === "number" && Number.isFinite(input.overall_score)
      ? Math.round(Math.min(100, Math.max(0, input.overall_score)))
      : null;

  const orsScore =
    typeof input.orchestrator?.ORS === "number" && Number.isFinite(input.orchestrator.ORS)
      ? Math.round(Math.min(100, Math.max(0, input.orchestrator.ORS)))
      : null;

  const vcCompositeScore =
    typeof input.vcScoring?.vc_composite_score === "number" &&
    Number.isFinite(input.vcScoring.vc_composite_score)
      ? Math.round(Math.min(100, Math.max(0, input.vcScoring.vc_composite_score)))
      : null;

  // Advisory only — excluded from conflict detection until G2 resolved.
  // TODO [G2]: Remove advisory-only annotation and include in conflict detection
  //            after dimension_scores.team is wired from the DIO pipeline.
  const ventureLensScore =
    typeof input.ventureLens?.final_investment_score === "number" &&
    Number.isFinite(input.ventureLens.final_investment_score)
      ? Math.round(Math.min(100, Math.max(0, input.ventureLens.final_investment_score)))
      : null;

  // ─── 2. Select authoritative score ────────────────────────────────────────

  // Track 1 is the primary authority. ORS is the fallback. 50 is the baseline
  // when neither is available (neutral, not a scoring decision).
  const authoritative_score = primaryScore ?? orsScore ?? 50;
  const primary_available = primaryScore !== null;

  // ─── 3. Resolve authoritative verdict ─────────────────────────────────────

  const verdict = mapScoreToCanonicalVerdict(authoritative_score);

  // ─── 4. Conflict detection ────────────────────────────────────────────────
  // Compare the authoritative score against T2 (ORS) and T3 (VCScoringV2).
  // T3b (VentureLensV1) is excluded: team dimension is neutral by default (G2).
  const conflict_detected = detectScoreConflict([
    authoritative_score,
    orsScore,
    vcCompositeScore,
    // ventureLensScore excluded — see TODO [G2]
  ]);

  // ─── 5. Confidence ────────────────────────────────────────────────────────

  const intelligence_available =
    typeof input.intelligence?.earned_confidence === "number" &&
    Number.isFinite(input.intelligence.earned_confidence);

  const confidence = computeResolverConfidence({
    dci_score: input.orchestrator?.DCI,
    primary_available,
    conflict_detected,
    intelligence_available,
  });

  // ─── 6. Assemble drivers + risks ──────────────────────────────────────────

  const drivers: string[] = [...(input.drivers ?? [])];
  const risks: string[]   = [...(input.risks ?? [])];

  if (conflict_detected) {
    drivers.push("Conflicting signals across scoring models");
  }

  if (!primary_available) {
    drivers.push("Primary score (overall_score) unavailable — ORS used as fallback authority");
  }

  // VentureLens conviction injection (advisory, not authoritative)
  const vlConviction = input.ventureLens?.conviction_level;
  if (vlConviction === "HIGH") {
    drivers.push("High venture conviction signal (VentureLens)");
  } else if (vlConviction === "LOW") {
    risks.push("Low venture conviction signal (VentureLens)");
  }

  // URSS risk injection
  if (typeof input.orchestrator?.URSS === "number" && input.orchestrator.URSS > 60) {
    risks.push(`High risk severity score (URSS: ${input.orchestrator.URSS})`);
  }

  // Intelligence confidence injection
  if (
    intelligence_available &&
    typeof input.intelligence!.earned_confidence === "number" &&
    input.intelligence!.earned_confidence < 50
  ) {
    risks.push(`Low earned confidence from intelligence layer (${input.intelligence!.earned_confidence}/100)`);
  }

  // ─── 7. Build source breakdown ────────────────────────────────────────────

  const source_breakdown: CanonicalDecisionSourceBreakdown = {};
  if (primaryScore !== null)      source_breakdown.overall_score = primaryScore;
  if (ventureLensScore !== null)   source_breakdown.venture_lens  = ventureLensScore;
  if (vcCompositeScore !== null)   source_breakdown.vc_scoring    = vcCompositeScore;
  if (input.orchestrator) {
    const o: CanonicalDecisionSourceBreakdown["orchestrator"] = {};
    if (typeof input.orchestrator.ORS  === "number") o.ORS  = input.orchestrator.ORS;
    if (typeof input.orchestrator.DCI  === "number") o.DCI  = input.orchestrator.DCI;
    if (input.orchestrator.FHC !== undefined)        o.FHC  = input.orchestrator.FHC ?? null;
    if (typeof input.orchestrator.URSS === "number") o.URSS = input.orchestrator.URSS;
    source_breakdown.orchestrator = o;
  }

  // ─── 8. Resolver note ─────────────────────────────────────────────────────

  const sourcesPresent: string[] = [];
  if (primary_available)               sourcesPresent.push("overall_score[T1]");
  if (orsScore !== null)               sourcesPresent.push("ORS[T2]");
  if (vcCompositeScore !== null)        sourcesPresent.push("VCScoringV2[T3]");
  if (ventureLensScore !== null)        sourcesPresent.push("VentureLensV1[T3b-advisory]");
  if (intelligence_available)          sourcesPresent.push("Intelligence[Stage5]");

  const resolver_note = [
    `authority=${primary_available ? "overall_score[T1]" : (orsScore !== null ? "ORS[T2]" : "default-50")}`,
    `sources=[${sourcesPresent.join(", ")}]`,
    conflict_detected ? "conflict=true" : null,
  ]
    .filter(Boolean)
    .join("; ");

  // ─── 9. Return ────────────────────────────────────────────────────────────

  return {
    score: authoritative_score,
    verdict,
    confidence,
    drivers,
    risks,
    source_breakdown,
    conflict_detected,
    resolver_note,
  };
}
