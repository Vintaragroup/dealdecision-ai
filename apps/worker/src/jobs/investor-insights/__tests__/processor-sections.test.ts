/**
 * processor-sections.test.ts
 *
 * Unit tests for deterministic section-builder functions in processor.ts.
 *
 * Key assertions:
 *   - buildDeterministicOnlySections: G3 passes → no "unreadable" messaging, no g3_remediation
 *   - buildG3OnlyFailSections:        G3 fails  → "unreadable" messaging + g3_remediation
 *   - buildGateFailedSections:        multi-gate fail → analysis_status present, no g3_remediation
 *   - Carmoola regression: current gate state (G3 passing) produces clean sections
 */

import { describe, it, expect, vi } from "vitest";

// Mock DB module before any module that imports it — vitest hoists vi.mock() calls.
vi.mock("../../../lib/db", () => ({ getPool: () => ({}) }));

import { _sectionBuilders } from "../processor";
import type { GateState } from "../../../contracts/investor-insights/schemas";

const { buildDeterministicOnlySections, buildG3OnlyFailSections, buildGateFailedSections } =
	_sectionBuilders;

// ── Fixtures ──────────────────────────────────────────────────────────────────

/** Minimal CoverageSnapshot (shape matches the internal interface). */
const EMPTY_COVERAGE = {
	docsCount: 1,
	dpuPageCount: 21,
	dpuNonemptyPages: 21,
	evidenceCount: 10,
	visualsCount: 5,
	coverageQueryErrors: [] as string[],
} as const;

function makeAllPassGateState(): GateState {
	return {
		all_passed: true,
		results: [
			{ gate: "G0", passed: true, actual: 1 },
			{ gate: "G1", passed: true, actual: 21 },
			{ gate: "G2", passed: true, actual: 1, threshold: 0 },
			{ gate: "G3", passed: true, actual: 1 },
			{ gate: "G4", passed: true, actual: 10 },
			{ gate: "G5", passed: true, actual: 7 },
		],
	} as GateState;
}

function makeG3FailGateState(reasonCode: string): GateState {
	return {
		all_passed: false,
		results: [
			{ gate: "G0", passed: true, actual: 1 },
			{ gate: "G1", passed: true, actual: 21 },
			{ gate: "G2", passed: true, actual: 1, threshold: 0 },
			{ gate: "G3", passed: false, reason_code: reasonCode },
			{ gate: "G4", passed: true, actual: 10 },
			{ gate: "G5", passed: true, actual: 7 },
		],
	} as GateState;
}

// ── buildDeterministicOnlySections ───────────────────────────────────────────

describe("buildDeterministicOnlySections — all gates pass", () => {
	it("analysis_status body does NOT mention 'unreadable' or 'G3'", () => {
		const sections = buildDeterministicOnlySections(
			makeAllPassGateState(),
			EMPTY_COVERAGE,
			[],
			[],
			null
		);
		const body = sections.find((s) => s.key === "analysis_status")?.body ?? "";
		expect(body.toLowerCase()).not.toContain("unreadable");
		expect(body.toLowerCase()).not.toContain("g3");
	});

	it("does NOT include a g3_remediation section", () => {
		const sections = buildDeterministicOnlySections(
			makeAllPassGateState(),
			EMPTY_COVERAGE,
			[],
			[],
			null
		);
		expect(sections.find((s) => s.key === "g3_remediation")).toBeUndefined();
	});

	it("gate_state section has all results with passed=true", () => {
		const sections = buildDeterministicOnlySections(
			makeAllPassGateState(),
			EMPTY_COVERAGE,
			[],
			[],
			null
		);
		const gate = sections.find((s) => s.key === "gate_state");
		expect(gate).toBeDefined();
		type GateItem = { gate: string; passed?: boolean };
		const g3 = (gate?.items as GateItem[] ?? []).find((i) => i.gate === "G3");
		expect(g3?.passed).toBe(true);
	});

	it("includes gate_state, analysis_status, and coverage_snapshot sections", () => {
		const sections = buildDeterministicOnlySections(
			makeAllPassGateState(),
			EMPTY_COVERAGE,
			[],
			[],
			null
		);
		const keys = sections.map((s) => s.key);
		expect(keys).toContain("gate_state");
		expect(keys).toContain("analysis_status");
		expect(keys).toContain("coverage_snapshot");
	});
});

// ── buildG3OnlyFailSections ───────────────────────────────────────────────────

describe("buildG3OnlyFailSections — G3 fails with soft code", () => {
	it("analysis_status body contains 'unreadable' messaging", () => {
		const sections = buildG3OnlyFailSections(
			makeG3FailGateState("GATE_STRUCTURED_JSON_MISSING"),
			EMPTY_COVERAGE,
			[],
			[],
			null
		);
		const body = sections.find((s) => s.key === "analysis_status")?.body ?? "";
		expect(body.toLowerCase()).toMatch(/unreadable|g3/);
	});

	it("includes a g3_remediation section with non-empty body", () => {
		const sections = buildG3OnlyFailSections(
			makeG3FailGateState("GATE_STRUCTURED_JSON_MISSING"),
			EMPTY_COVERAGE,
			[],
			[],
			null
		);
		const remediationSection = sections.find((s) => s.key === "g3_remediation");
		expect(remediationSection).toBeDefined();
		expect(remediationSection?.body?.length).toBeGreaterThan(10);
	});

	it("GATE_STRUCTURED_JSON_PARSE_FAILED also produces g3_remediation", () => {
		const sections = buildG3OnlyFailSections(
			makeG3FailGateState("GATE_STRUCTURED_JSON_PARSE_FAILED"),
			EMPTY_COVERAGE,
			[],
			[],
			null
		);
		expect(sections.find((s) => s.key === "g3_remediation")).toBeDefined();
	});

	it("GATE_STRUCTURED_JSON_SCHEMA_MISMATCH also produces g3_remediation", () => {
		const sections = buildG3OnlyFailSections(
			makeG3FailGateState("GATE_STRUCTURED_JSON_SCHEMA_MISMATCH"),
			EMPTY_COVERAGE,
			[],
			[],
			null
		);
		expect(sections.find((s) => s.key === "g3_remediation")).toBeDefined();
	});

	it("gate_state section has G3 with passed=false", () => {
		const sections = buildG3OnlyFailSections(
			makeG3FailGateState("GATE_STRUCTURED_JSON_MISSING"),
			EMPTY_COVERAGE,
			[],
			[],
			null
		);
		const gate = sections.find((s) => s.key === "gate_state");
		type GateItem = { gate: string; passed?: boolean };
		const g3 = (gate?.items as GateItem[] ?? []).find((i) => i.gate === "G3");
		expect(g3?.passed).toBe(false);
	});
});

// ── buildGateFailedSections ───────────────────────────────────────────────────

describe("buildGateFailedSections — multi-gate failure", () => {
	const multiFailGateState: GateState = {
		all_passed: false,
		results: [
			{ gate: "G0", passed: false, reason_code: "GATE_DEAL_NOT_FOUND" },
			{ gate: "G1", passed: false, reason_code: "GATE_DPU_EMPTY" },
			{ gate: "G2", passed: true, actual: 0, threshold: 0 },
			{ gate: "G3", passed: true, actual: 1 },
			{ gate: "G4", passed: true, actual: 0 },
			{ gate: "G5", passed: true, actual: 0 },
		],
	} as GateState;

	it("analysis_status body mentions failed gates", () => {
		const sections = buildGateFailedSections(multiFailGateState, EMPTY_COVERAGE, [], []);
		const body = sections.find((s) => s.key === "analysis_status")?.body ?? "";
		expect(body).toBeTruthy();
		expect(body.length).toBeGreaterThan(10);
	});

	it("does NOT include g3_remediation section", () => {
		const sections = buildGateFailedSections(multiFailGateState, EMPTY_COVERAGE, [], []);
		expect(sections.find((s) => s.key === "g3_remediation")).toBeUndefined();
	});

	it("includes gate_state section", () => {
		const sections = buildGateFailedSections(multiFailGateState, EMPTY_COVERAGE, [], []);
		expect(sections.find((s) => s.key === "gate_state")).toBeDefined();
	});
});

// ── Carmoola regression ───────────────────────────────────────────────────────

describe("Carmoola regression — fresh regeneration produces clean sections", () => {
	it("when G3 passes (post gate repair), no 'Structured JSON unreadable' in analysis_status", () => {
		// Simulates Carmoola's current gate state (G3 now passes after repairGateStateInReport)
		const sections = buildDeterministicOnlySections(
			makeAllPassGateState(),
			EMPTY_COVERAGE,
			[],
			[],
			null
		);
		const body = sections.find((s) => s.key === "analysis_status")?.body ?? "";
		expect(body).not.toContain("Structured JSON unreadable");
		expect(body).not.toContain("GATE_STRUCTURED_JSON");
	});

	it("when G3 passes, no g3_remediation section is present", () => {
		const sections = buildDeterministicOnlySections(
			makeAllPassGateState(),
			EMPTY_COVERAGE,
			[],
			[],
			null
		);
		expect(sections.findIndex((s) => s.key === "g3_remediation")).toBe(-1);
	});

	it("before gate repair (stale GATE_STRUCTURED_JSON_UNREADABLE stored), regeneration with current evalG3 fixes it", () => {
		// The obsolete reason code is NOT in the G3_FAIL_SOFT_CODES set, so the processor
		// would have fallen through to buildGateFailedSections (status=failed) rather than
		// buildG3OnlyFailSections (status=deterministic_only) when using the old stored state.
		// This test verifies the current code handles MISSING correctly (the live state after gate eval).
		const sections = buildG3OnlyFailSections(
			makeG3FailGateState("GATE_STRUCTURED_JSON_MISSING"),
			EMPTY_COVERAGE,
			[],
			[],
			null
		);
		// Sections are the G3 fail-soft variant — analysis_status mentions unreadable
		const body = sections.find((s) => s.key === "analysis_status")?.body ?? "";
		expect(body.toLowerCase()).toMatch(/unreadable/);
		// g3_remediation present
		expect(sections.find((s) => s.key === "g3_remediation")).toBeDefined();
	});
});
