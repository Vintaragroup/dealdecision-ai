/**
 * Deterministic-only recovery classification — WS-A (PR20)
 *
 * Classifies whether a deterministic_only report outcome is recoverable via
 * a structured-JSON-only retry (mode="recover_structured_json").
 *
 * A report is recoverable when the ONLY failing gate is G3 and the reason code
 * indicates a structural/readability issue that the pipeline can re-attempt
 * (e.g. schema mismatch, parse failure, or missing JSON).  DB errors are
 * intentionally excluded: they require infrastructure remediation, not a retry.
 *
 * Pure function — no DB access, no LLM calls, no side effects.
 */

import type { GateState } from "../../../contracts/investor-insights/schemas";

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * G3 reason codes that produce a deterministic_only outcome that can be
 * recovered by re-running the pipeline with mode="recover_structured_json".
 *
 * QUERY_FAILED is intentionally excluded: a DB query failure is an infrastructure
 * issue, not a structured-JSON readability issue.
 *
 * Must stay in sync with G3_FAIL_SOFT_CODES in processor.ts.
 */
export const DETERMINISTIC_ONLY_RECOVERABLE_CODES = new Set<string>([
	"GATE_STRUCTURED_JSON_MISSING",
	"GATE_STRUCTURED_JSON_PARSE_FAILED",
	"GATE_STRUCTURED_JSON_SCHEMA_MISMATCH",
]);

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RecoveryClassification {
	/** True when the deterministic_only outcome is recoverable via mode="recover_structured_json". */
	recoverable: boolean;
	/**
	 * Stable reason code for the recoverable gate failure.
	 * Null when recoverable=false.
	 */
	reason_code: string | null;
	/**
	 * Gate that triggered the recoverable failure.
	 * Always "G3" when recoverable=true, null otherwise.
	 */
	gate: "G3" | null;
}

/**
 * Shape of the recovery metadata persisted to render_package.recovery_metadata
 * when a recovery attempt is made (mode="recover_structured_json").
 */
export interface RecoveryMetadata {
	/** Whether a recovery was attempted in this run. */
	attempted: boolean;
	/** Number of recovery attempts recorded in the current run (≥1 when attempted=true). */
	attempt_count: number;
	/** ISO timestamp of the most recent recovery attempt. */
	last_attempt_at: string;
	/** Outcome of the most recent attempt. */
	last_result: "pending" | "succeeded" | "failed";
	/** Reason code of the gate failure that triggered this recovery. */
	reason_code: string | null;
}

// ─── Classifier ───────────────────────────────────────────────────────────────

/**
 * Classify whether a gate state represents a deterministic_only outcome that
 * is recoverable by re-running the pipeline.
 *
 * Returns recoverable=true only when all three conditions hold:
 *   1. Exactly one gate failed.
 *   2. That gate is G3.
 *   3. The failing reason_code is in DETERMINISTIC_ONLY_RECOVERABLE_CODES.
 */
export function classifyDeterministicOnlyRecoverable(
	gateState: GateState,
): RecoveryClassification {
	const failedGates = gateState.results.filter((r) => !r.passed);

	if (failedGates.length !== 1) {
		return { recoverable: false, reason_code: null, gate: null };
	}

	const failing = failedGates[0]!;
	if (failing.gate !== "G3") {
		return { recoverable: false, reason_code: null, gate: null };
	}

	const reasonCode = failing.reason_code ?? "";
	const recoverable = DETERMINISTIC_ONLY_RECOVERABLE_CODES.has(reasonCode);

	return {
		recoverable,
		reason_code: recoverable ? reasonCode : null,
		gate: recoverable ? "G3" : null,
	};
}

/**
 * Build a RecoveryMetadata object for persistence in render_package.recovery_metadata.
 *
 * Call when the processor is invoked with mode="recover_structured_json".
 * The caller is responsible for incrementing attempt_count by merging with any
 * previously persisted metadata.
 */
export function buildRecoveryMetadata(opts: {
	reason_code: string | null;
	result: "pending" | "succeeded" | "failed";
	prior_attempt_count?: number;
}): RecoveryMetadata {
	return {
		attempted: true,
		attempt_count: (opts.prior_attempt_count ?? 0) + 1,
		last_attempt_at: new Date().toISOString(),
		last_result: opts.result,
		reason_code: opts.reason_code,
	};
}
