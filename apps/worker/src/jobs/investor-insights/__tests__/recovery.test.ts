/**
 * Unit tests for WS-A (PR20): classifyDeterministicOnlyRecoverable + buildRecoveryMetadata
 *
 * Pure functions — no DB, no LLM, no side effects.
 */
import { describe, it, expect } from "vitest";
import {
	classifyDeterministicOnlyRecoverable,
	buildRecoveryMetadata,
	DETERMINISTIC_ONLY_RECOVERABLE_CODES,
} from "../stages/recovery";
import type { GateState } from "../../../contracts/investor-insights/schemas";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeG3OnlyFailState(reasonCode: string): GateState {
	return {
		all_passed: false,
		results: [
			{ gate: "G0", passed: true, actual: 1 },
			{ gate: "G1", passed: true, actual: 10 },
			{ gate: "G2", passed: true, actual: 1, threshold: 0 },
			{ gate: "G3", passed: false, reason_code: reasonCode },
			{ gate: "G4", passed: true, actual: 30 },
			{ gate: "G5", passed: true, actual: 5 },
		],
	} as GateState;
}

function makeAllPassState(): GateState {
	return {
		all_passed: true,
		results: [
			{ gate: "G0", passed: true, actual: 1 },
			{ gate: "G1", passed: true, actual: 10 },
			{ gate: "G2", passed: true, actual: 1, threshold: 0 },
			{ gate: "G3", passed: true, actual: 1 },
			{ gate: "G4", passed: true, actual: 30 },
			{ gate: "G5", passed: true, actual: 5 },
		],
	} as GateState;
}

function makeMultiFailState(): GateState {
	return {
		all_passed: false,
		results: [
			{ gate: "G0", passed: false, reason_code: "GATE_NO_DOCUMENTS" },
			{ gate: "G3", passed: false, reason_code: "GATE_STRUCTURED_JSON_MISSING" },
		],
	} as GateState;
}

// ─── DETERMINISTIC_ONLY_RECOVERABLE_CODES constants ───────────────────────────

describe("DETERMINISTIC_ONLY_RECOVERABLE_CODES", () => {
	it("contains exactly the three G3 soft codes", () => {
		expect([...DETERMINISTIC_ONLY_RECOVERABLE_CODES]).toEqual(
			expect.arrayContaining([
				"GATE_STRUCTURED_JSON_MISSING",
				"GATE_STRUCTURED_JSON_PARSE_FAILED",
				"GATE_STRUCTURED_JSON_SCHEMA_MISMATCH",
			])
		);
		expect(DETERMINISTIC_ONLY_RECOVERABLE_CODES.size).toBe(3);
	});

	it("does NOT contain QUERY_FAILED", () => {
		expect(DETERMINISTIC_ONLY_RECOVERABLE_CODES.has("QUERY_FAILED")).toBe(false);
	});
});

// ─── classifyDeterministicOnlyRecoverable ─────────────────────────────────────

describe("classifyDeterministicOnlyRecoverable — recoverable cases", () => {
	it.each([
		"GATE_STRUCTURED_JSON_MISSING",
		"GATE_STRUCTURED_JSON_PARSE_FAILED",
		"GATE_STRUCTURED_JSON_SCHEMA_MISMATCH",
	])("returns recoverable=true for reason_code=%s (G3 only)", (code) => {
		const result = classifyDeterministicOnlyRecoverable(makeG3OnlyFailState(code));
		expect(result.recoverable).toBe(true);
		expect(result.reason_code).toBe(code);
		expect(result.gate).toBe("G3");
	});
});

describe("classifyDeterministicOnlyRecoverable — non-recoverable cases", () => {
	it("returns recoverable=false when all gates pass", () => {
		const result = classifyDeterministicOnlyRecoverable(makeAllPassState());
		expect(result.recoverable).toBe(false);
		expect(result.reason_code).toBeNull();
		expect(result.gate).toBeNull();
	});

	it("returns recoverable=false when multiple gates fail", () => {
		const result = classifyDeterministicOnlyRecoverable(makeMultiFailState());
		expect(result.recoverable).toBe(false);
		expect(result.gate).toBeNull();
	});

	it("returns recoverable=false when only G3 fails with non-soft code (QUERY_FAILED)", () => {
		const result = classifyDeterministicOnlyRecoverable(
			makeG3OnlyFailState("QUERY_FAILED")
		);
		expect(result.recoverable).toBe(false);
		expect(result.reason_code).toBeNull();
	});

	it("returns recoverable=false when non-G3 gate is the sole failure", () => {
		const state: GateState = {
			all_passed: false,
			results: [
				{ gate: "G0", passed: false, reason_code: "GATE_NO_DOCUMENTS" },
				{ gate: "G1", passed: true, actual: 10 },
				{ gate: "G2", passed: true, actual: 1, threshold: 0 },
				{ gate: "G3", passed: true, actual: 1 },
			],
		} as GateState;
		const result = classifyDeterministicOnlyRecoverable(state);
		expect(result.recoverable).toBe(false);
		expect(result.gate).toBeNull();
	});
});

// ─── buildRecoveryMetadata ────────────────────────────────────────────────────

describe("buildRecoveryMetadata", () => {
	it("sets attempted=true and attempt_count=1 on first attempt", () => {
		const meta = buildRecoveryMetadata({
			reason_code: "GATE_STRUCTURED_JSON_MISSING",
			result: "succeeded",
		});
		expect(meta.attempted).toBe(true);
		expect(meta.attempt_count).toBe(1);
		expect(meta.last_result).toBe("succeeded");
		expect(meta.reason_code).toBe("GATE_STRUCTURED_JSON_MISSING");
	});

	it("increments attempt_count from prior_attempt_count", () => {
		const meta = buildRecoveryMetadata({
			reason_code: "GATE_STRUCTURED_JSON_PARSE_FAILED",
			result: "failed",
			prior_attempt_count: 2,
		});
		expect(meta.attempt_count).toBe(3);
		expect(meta.last_result).toBe("failed");
	});

	it("sets last_attempt_at as a valid ISO datetime", () => {
		const meta = buildRecoveryMetadata({ reason_code: null, result: "pending" });
		expect(() => new Date(meta.last_attempt_at)).not.toThrow();
		expect(new Date(meta.last_attempt_at).getTime()).toBeGreaterThan(0);
	});
});
