/**
 * Evidence Gate v1 — deterministic quality check before LLM stages.
 *
 * Evaluates whether the extracted evidence is sufficient to proceed with
 * LLM-governed interpretation. When the gate fails, the processor persists a
 * deterministic-only report and skips all LLM calls.
 *
 * Pure function — no DB access, no side effects. All DB gathering happens
 * upstream in loadCoverageSnapshot(); this module only computes from the result.
 *
 * Binding thresholds (v1):
 *   E0  docs_count          >= 1
 *   E1  expected_pages_total >= 1
 *   E2  coverage_pct         >= 0.55  (dpu_nonempty_pages / expected_pages_total)
 *   E3  evidence_count       >= 25
 *   E4  hard_missing_pages_total === 0  (only evaluated when input is provided)
 */

// ─── Constants ────────────────────────────────────────────────────────────────

/** Coverage fraction threshold (E2). 55% of pages must have non-empty DPU text. */
export const EVIDENCE_GATE_COVERAGE_THRESHOLD = 0.55;

/** Minimum evidence item count (E3). */
export const EVIDENCE_GATE_MIN_EVIDENCE_COUNT = 25;

// ─── Types ────────────────────────────────────────────────────────────────────

/** Input shape — mirrors the `CoverageSnapshot` produced by loadCoverageSnapshot(). */
export interface EvidenceGateInput {
	/** Number of documents in the deal (from documents table). */
	docs_count: number;
	/** Total DPU pages present (proxy for expected_pages_total). */
	expected_pages_total: number;
	/** DPU pages with non-empty page_text. */
	dpu_nonempty_pages: number;
	/** Total evidence_items rows for the deal. */
	evidence_count: number;
	/**
	 * Optional: number of pages explicitly marked as hard-missing by the extraction
	 * pipeline. When undefined or null, gate E4 is omitted from results.
	 */
	hard_missing_pages_total?: number | null;
}

/** Per-gate result (E0–E4). */
export interface EvidenceGateResult {
	gate: "E0" | "E1" | "E2" | "E3" | "E4";
	passed: boolean;
	/** Observed value (count or ratio). Null when not computable (e.g. guard path). */
	actual: number | null;
	/** The minimum required value for the gate to pass. Null when binary / no threshold. */
	threshold: number | null;
	/** Machine-readable failure reason. Null when the gate passed. */
	reason_code: string | null;
}

/** Full output of computeEvidenceGateV1(). */
export interface EvidenceGateState {
	/** True only when ALL evaluated gates pass. */
	passed: boolean;
	/** The reason_code of the first failing gate, or null when all pass. */
	blocking_reason: string | null;
	/** Ordered gate results. E4 is absent when hard_missing_pages_total is not provided. */
	results: EvidenceGateResult[];
	/** Snapshot of the raw metrics used for evaluation (for persistence / debugging). */
	metrics: {
		docs_count: number;
		expected_pages_total: number;
		coverage_pct: number;
		evidence_count: number;
		hard_missing_pages_total: number | null;
	};
}

// ─── Pure evaluator ───────────────────────────────────────────────────────────

/**
 * Evaluate the Evidence Gate v1 check.
 *
 * Safe to call with any numeric inputs; guards against division-by-zero (returns
 * coverage_pct = 0 instead of NaN when expected_pages_total === 0).
 *
 * Gate E4 is only included in results when `hard_missing_pages_total` is a
 * non-null number — callers that do not track this metric can omit it and the
 * gate will not be evaluated, preventing spurious failures.
 */
export function computeEvidenceGateV1(input: EvidenceGateInput): EvidenceGateState {
	const {
		docs_count,
		expected_pages_total,
		dpu_nonempty_pages,
		evidence_count,
	} = input;

	// Safe coverage fraction — avoid NaN on division by zero.
	const coverage_pct =
		expected_pages_total > 0 ? dpu_nonempty_pages / expected_pages_total : 0;

	const hard_missing =
		typeof input.hard_missing_pages_total === "number" && input.hard_missing_pages_total !== null
			? input.hard_missing_pages_total
			: null;

	const results: EvidenceGateResult[] = [];

	// ── E0: at least one document ─────────────────────────────────────────────
	const e0Passed = docs_count >= 1;
	results.push({
		gate: "E0",
		passed: e0Passed,
		actual: docs_count,
		threshold: 1,
		reason_code: e0Passed ? null : "EVIDENCE_GATE_NO_DOCUMENTS",
	});

	// ── E1: at least one expected page ────────────────────────────────────────
	const e1Passed = expected_pages_total >= 1;
	results.push({
		gate: "E1",
		passed: e1Passed,
		actual: expected_pages_total,
		threshold: 1,
		reason_code: e1Passed ? null : "EVIDENCE_GATE_NO_PAGES",
	});

	// ── E2: coverage fraction >= threshold ────────────────────────────────────
	// Guard: if expected_pages_total === 0 the coverage_pct is 0 by definition;
	// the failure reason propagates from E1 so E2 uses the same guard code.
	const e2Passed =
		expected_pages_total > 0 && coverage_pct >= EVIDENCE_GATE_COVERAGE_THRESHOLD;
	results.push({
		gate: "E2",
		passed: e2Passed,
		actual: coverage_pct,
		threshold: EVIDENCE_GATE_COVERAGE_THRESHOLD,
		reason_code: e2Passed
			? null
			: expected_pages_total === 0
				? "EVIDENCE_GATE_NO_PAGES"
				: "EVIDENCE_GATE_LOW_COVERAGE",
	});

	// ── E3: sufficient evidence_items ─────────────────────────────────────────
	const e3Passed = evidence_count >= EVIDENCE_GATE_MIN_EVIDENCE_COUNT;
	results.push({
		gate: "E3",
		passed: e3Passed,
		actual: evidence_count,
		threshold: EVIDENCE_GATE_MIN_EVIDENCE_COUNT,
		reason_code: e3Passed ? null : "EVIDENCE_GATE_LOW_EVIDENCE",
	});

	// ── E4: no hard-missing pages (optional gate) ─────────────────────────────
	if (hard_missing !== null) {
		const e4Passed = hard_missing === 0;
		results.push({
			gate: "E4",
			passed: e4Passed,
			actual: hard_missing,
			threshold: 0,
			reason_code: e4Passed ? null : "EVIDENCE_GATE_HARD_MISSING_PAGES",
		});
	}

	// ── Aggregate ─────────────────────────────────────────────────────────────
	const firstFailing = results.find((r) => !r.passed) ?? null;
	const passed = firstFailing === null;

	return {
		passed,
		blocking_reason: firstFailing?.reason_code ?? null,
		results,
		metrics: {
			docs_count,
			expected_pages_total,
			coverage_pct,
			evidence_count,
			hard_missing_pages_total: hard_missing,
		},
	};
}
