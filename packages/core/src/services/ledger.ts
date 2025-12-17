/**
 * Ledger Service
 * Manages fact table and audit trail
 * Tracks confidence, citations, and analysis quality metrics
 */

import type {
  FactRow,
  LedgerManifest,
  Citation,
  CalibrateMetrics,
} from "../types/hrmdd";
import type { CycleType, Finding } from "../types/analysis";
import {
  FACT_VALIDATION,
  CITATION_RULES,
  CALIBRATION_RANGES,
} from "../types/validation";

/**
 * Initialize empty ledger manifest
 */
export function initializeLedgerManifest(): LedgerManifest {
  return {
    cycles: 0,
    depth_delta: [],
    subgoals: 0,
    constraints: 0,
    dead_ends: 0,
    paraphrase_invariance: 1.0,
    calibration: { brier: 0.0 },
  };
}

/**
 * Validate a fact row meets requirements
 */
export function validateFactRow(fact: FactRow): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // Claim length
  if (fact.claim.length < FACT_VALIDATION.CLAIM_MIN_LENGTH) {
    errors.push(
      `Claim too short (min ${FACT_VALIDATION.CLAIM_MIN_LENGTH} chars)`
    );
  }
  if (fact.claim.length > FACT_VALIDATION.CLAIM_MAX_LENGTH) {
    errors.push(
      `Claim too long (max ${FACT_VALIDATION.CLAIM_MAX_LENGTH} chars)`
    );
  }

  // Source validation
  const isAllowedSource =
    fact.source === "deck.pdf" ||
    fact.source === "uncertain" ||
    fact.source.startsWith("http");
  if (!isAllowedSource) {
    errors.push(`Source must be deck.pdf, URL, or uncertain`);
  }

  // Confidence range
  if (fact.confidence < FACT_VALIDATION.CONFIDENCE_MIN) {
    errors.push(`Confidence below ${FACT_VALIDATION.CONFIDENCE_MIN}`);
  }
  if (fact.confidence > FACT_VALIDATION.CONFIDENCE_MAX) {
    errors.push(`Confidence above ${FACT_VALIDATION.CONFIDENCE_MAX}`);
  }

  // Cycle reference
  if (fact.created_cycle < 1 || fact.created_cycle > 3) {
    errors.push("created_cycle must be 1, 2, or 3");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Add fact to ledger, with validation
 */
export function addFact(
  factTable: FactRow[],
  fact: FactRow
): {
  added: boolean;
  fact?: FactRow;
  error?: string;
} {
  const validation = validateFactRow(fact);
  if (!validation.valid) {
    return { added: false, error: validation.errors.join("; ") };
  }

  // Check for duplicates (same claim in same cycle)
  const duplicate = factTable.find(
    (f) => f.claim === fact.claim && f.created_cycle === fact.created_cycle
  );
  if (duplicate) {
    return { added: false, error: "Fact already exists in this cycle" };
  }

  return { added: true, fact };
}

/**
 * Update fact confidence
 */
export function updateFactConfidence(
  factTable: FactRow[],
  factId: string,
  newConfidence: number
): FactRow[] {
  return factTable.map((f) =>
    f.id === factId
      ? { ...f, confidence: Math.max(0, Math.min(1, newConfidence)) }
      : f
  );
}

/**
 * Get facts created in specific cycle
 */
export function getFactsByCycle(
  factTable: FactRow[],
  cycle: CycleType
): FactRow[] {
  return factTable.filter((f) => f.created_cycle === cycle);
}

/**
 * Get facts above confidence threshold
 */
export function getHighConfidenceFacts(
  factTable: FactRow[],
  threshold: number
): FactRow[] {
  return factTable.filter((f) => f.confidence >= threshold);
}

/**
 * Get facts from specific source
 */
export function getFactsBySource(
  factTable: FactRow[],
  source: string
): FactRow[] {
  return factTable.filter((f) => f.source === source);
}

/**
 * Count facts needing citations
 */
export function countUncitedFacts(factTable: FactRow[]): number {
  return factTable.filter((f) => f.source === "uncertain").length;
}

/**
 * Calculate citation compliance percentage
 */
export function calculateCitationCompliance(factTable: FactRow[]): number {
  if (factTable.length === 0) return 1.0;
  const cited = factTable.filter((f) => f.source !== "uncertain").length;
  return cited / factTable.length;
}

/**
 * Calculate average confidence
 */
export function calculateAverageConfidence(factTable: FactRow[]): number {
  if (factTable.length === 0) return 0.0;
  const total = factTable.reduce((sum, f) => sum + f.confidence, 0);
  return total / factTable.length;
}

/**
 * Record depth delta for a cycle
 */
export function recordDepthDelta(
  manifest: LedgerManifest,
  cycle: CycleType,
  depth: number
): LedgerManifest {
  return {
    ...manifest,
    depth_delta: [...manifest.depth_delta, depth],
    cycles: Math.max(manifest.cycles, cycle),
  };
}

/**
 * Increment subgoals addressed
 */
export function incrementSubgoalsAddressed(
  manifest: LedgerManifest,
  count: number = 1
): LedgerManifest {
  return {
    ...manifest,
    subgoals: manifest.subgoals + count,
  };
}

/**
 * Increment constraints checked
 */
export function incrementConstraintsChecked(
  manifest: LedgerManifest,
  count: number = 1
): LedgerManifest {
  return {
    ...manifest,
    constraints: manifest.constraints + count,
  };
}

/**
 * Increment dead ends (disproven hypotheses)
 */
export function incrementDeadEnds(
  manifest: LedgerManifest,
  count: number = 1
): LedgerManifest {
  return {
    ...manifest,
    dead_ends: manifest.dead_ends + count,
  };
}

/**
 * Update calibration metrics
 */
export function updateCalibrationMetrics(
  manifest: LedgerManifest,
  metrics: Partial<CalibrateMetrics>
): LedgerManifest {
  return {
    ...manifest,
    calibration: {
      ...manifest.calibration,
      ...(metrics.brier !== undefined && { brier: metrics.brier }),
    },
    paraphrase_invariance:
      metrics.paraphrase_invariance ?? manifest.paraphrase_invariance,
  };
}

/**
 * Quality assessment of ledger state
 */
export function assessQuality(manifest: LedgerManifest): {
  citationQuality: "excellent" | "good" | "acceptable" | "poor";
  paraphraseQuality: "excellent" | "good" | "acceptable" | "poor";
  calibrationQuality: "excellent" | "good" | "acceptable" | "poor";
  overallScore: number;
} {
  let overallScore = 0;

  // Citation quality (assume from ledger data)
  const citationQuality =
    manifest.depth_delta.length > 0 ? "good" : "acceptable";
  overallScore += 25;

  // Paraphrase invariance
  let paraphraseQuality: "excellent" | "good" | "acceptable" | "poor";
  if (manifest.paraphrase_invariance >= CALIBRATION_RANGES.PARAPHRASE_INVARIANCE_EXCELLENT) {
    paraphraseQuality = "excellent";
    overallScore += 30;
  } else if (manifest.paraphrase_invariance >= CALIBRATION_RANGES.PARAPHRASE_INVARIANCE_GOOD) {
    paraphraseQuality = "good";
    overallScore += 25;
  } else if (manifest.paraphrase_invariance >= CALIBRATION_RANGES.PARAPHRASE_INVARIANCE_ACCEPTABLE) {
    paraphraseQuality = "acceptable";
    overallScore += 15;
  } else {
    paraphraseQuality = "poor";
    overallScore += 5;
  }

  // Calibration quality (Brier score)
  const brier = manifest.calibration.brier ?? 0.5;
  let calibrationQuality: "excellent" | "good" | "acceptable" | "poor";
  if (brier < CALIBRATION_RANGES.BRIER_EXCELLENT) {
    calibrationQuality = "excellent";
    overallScore += 25;
  } else if (brier < CALIBRATION_RANGES.BRIER_GOOD) {
    calibrationQuality = "good";
    overallScore += 20;
  } else if (brier < CALIBRATION_RANGES.BRIER_ACCEPTABLE) {
    calibrationQuality = "acceptable";
    overallScore += 10;
  } else {
    calibrationQuality = "poor";
    overallScore += 5;
  }

  // Citation quality bonus
  overallScore += 20;

  return {
    citationQuality,
    paraphraseQuality,
    calibrationQuality,
    overallScore: Math.min(100, overallScore),
  };
}

/**
 * Summary of ledger state
 */
export function summarizeLedger(manifest: LedgerManifest): string {
  return (
    `Cycles: ${manifest.cycles} | ` +
    `Facts: ${manifest.subgoals} | ` +
    `Constraints: ${manifest.constraints} | ` +
    `Dead Ends: ${manifest.dead_ends} | ` +
    `Paraphrase Invariance: ${(manifest.paraphrase_invariance * 100).toFixed(0)}% | ` +
    `Brier: ${(manifest.calibration.brier ?? 0).toFixed(2)}`
  );
}

/**
 * Export ledger as JSON
 */
export function serializeLedger(manifest: LedgerManifest): string {
  return JSON.stringify(manifest, null, 2);
}

/**
 * Import ledger from JSON
 */
export function deserializeLedger(json: string): LedgerManifest {
  return JSON.parse(json) as LedgerManifest;
}
