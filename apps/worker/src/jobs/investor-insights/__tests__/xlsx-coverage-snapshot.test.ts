/**
 * Tests for PR21: xlsx_bonus_pages unconditional persistence in coverage_snapshot.
 *
 * Verifies that buildCoverageSnapshotSection always writes xlsx_bonus_pages into
 * the coverage_snapshot body regardless of whether the value is 0 or positive.
 *
 * Pure function tests — no DB, no LLM, no side effects.
 */
import { describe, it, expect } from "vitest";
import { buildCoverageSnapshotSection } from "../stages/stage-1-gates";
import type { CoverageSnapshot } from "../stages/_shared";
import type { GateState } from "../../../contracts/investor-insights/schemas";

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeGateState(g3Passed = true, g5Passed = true): GateState {
	return {
		all_passed: g3Passed && g5Passed,
		results: [
			{ gate: "G0", actual: 1, passed: true },
			{ gate: "G1", actual: 10, passed: true },
			{ gate: "G2", actual: 0.6, passed: true, threshold: 0 },
			{ gate: "G3", actual: 1, passed: g3Passed },
			{ gate: "G4", actual: 5, passed: true },
			{ gate: "G5", actual: 3, passed: g5Passed },
		],
	};
}

function makeSnapshot(overrides?: Partial<CoverageSnapshot>): CoverageSnapshot {
	return {
		docsCount: 2,
		dpuPageCount: 20,
		dpuNonemptyPages: 14,
		evidenceCount: 30,
		visualsCount: 10,
		coverageQueryErrors: [],
		xlsxBonusPages: 0,
		...overrides,
	};
}

function getSnapshotLine(body: string, key: string): string | undefined {
	return body.split("\n").find((l) => l.startsWith(key + ":"));
}

// ─── Test 1: Field always present when xlsx_bonus_pages = 0 ─────────────────

describe("coverage_snapshot body — xlsx_bonus_pages always present", () => {
	it("includes xlsx_bonus_pages: 0 when xlsxBonusPages is 0", () => {
		const section = buildCoverageSnapshotSection(
			makeSnapshot({ xlsxBonusPages: 0 }),
			makeGateState()
		);
		const line = getSnapshotLine(section.body ?? "", "xlsx_bonus_pages");
		expect(line).toBeDefined();
		expect(line).toBe("xlsx_bonus_pages: 0");
	});

	it("body is a string with expected keys", () => {
		const section = buildCoverageSnapshotSection(makeSnapshot(), makeGateState());
		expect(typeof section.body).toBe("string");
		expect(section.body).toContain("xlsx_bonus_pages:");
	});
});

// ─── Test 2: Positive values are persisted ───────────────────────────────────

describe("coverage_snapshot body — positive xlsx_bonus_pages persisted", () => {
	it("includes xlsx_bonus_pages: 3 when xlsxBonusPages = 3", () => {
		const section = buildCoverageSnapshotSection(
			makeSnapshot({ xlsxBonusPages: 3 }),
			makeGateState()
		);
		const line = getSnapshotLine(section.body ?? "", "xlsx_bonus_pages");
		expect(line).toBe("xlsx_bonus_pages: 3");
	});

	it("includes xlsx_bonus_pages: 1 when xlsxBonusPages = 1", () => {
		const section = buildCoverageSnapshotSection(
			makeSnapshot({ xlsxBonusPages: 1 }),
			makeGateState()
		);
		const line = getSnapshotLine(section.body ?? "", "xlsx_bonus_pages");
		expect(line).toBe("xlsx_bonus_pages: 1");
	});

	it("includes xlsx_bonus_pages: 12 for large XLSX-heavy decks", () => {
		const section = buildCoverageSnapshotSection(
			makeSnapshot({ xlsxBonusPages: 12 }),
			makeGateState()
		);
		const line = getSnapshotLine(section.body ?? "", "xlsx_bonus_pages");
		expect(line).toBe("xlsx_bonus_pages: 12");
	});
});

// ─── Test 3: Evidence gate unaffected by xlsx_bonus_pages value ──────────────

describe("coverage_snapshot — evidence gate independence", () => {
	it("does not change dpu_nonempty_pages line for different xlsx_bonus_pages values", () => {
		const base = buildCoverageSnapshotSection(
			makeSnapshot({ dpuNonemptyPages: 14, xlsxBonusPages: 0 }),
			makeGateState()
		);
		const withBonus = buildCoverageSnapshotSection(
			makeSnapshot({ dpuNonemptyPages: 14, xlsxBonusPages: 5 }),
			makeGateState()
		);
		// dpu_nonempty_pages reflects raw DB count — not adjusted by xlsxBonusPages
		const baseLine = getSnapshotLine(base.body ?? "", "dpu_nonempty_pages");
		const bonusLine = getSnapshotLine(withBonus.body ?? "", "dpu_nonempty_pages");
		expect(baseLine).toBe("dpu_nonempty_pages: 14");
		expect(bonusLine).toBe("dpu_nonempty_pages: 14");
	});

	it("xlsx_bonus_pages appears as its own distinct line", () => {
		const section = buildCoverageSnapshotSection(
			makeSnapshot({ dpuNonemptyPages: 14, xlsxBonusPages: 5 }),
			makeGateState()
		);
		// Both lines co-exist independently
		expect(section.body).toContain("dpu_nonempty_pages: 14");
		expect(section.body).toContain("xlsx_bonus_pages: 5");
	});
});

// ─── Test 4: Ordering and section metadata ───────────────────────────────────

describe("coverage_snapshot body — structure", () => {
	it("xlsx_bonus_pages appears after dpu_nonempty_pages", () => {
		const section = buildCoverageSnapshotSection(makeSnapshot({ xlsxBonusPages: 2 }), makeGateState());
		const lines = (section.body ?? "").split("\n");
		const dpuIdx = lines.findIndex((l) => l.startsWith("dpu_nonempty_pages:"));
		const xlsxIdx = lines.findIndex((l) => l.startsWith("xlsx_bonus_pages:"));
		expect(dpuIdx).toBeGreaterThanOrEqual(0);
		expect(xlsxIdx).toBe(dpuIdx + 1);
	});

	it("section key is coverage_snapshot", () => {
		const section = buildCoverageSnapshotSection(makeSnapshot(), makeGateState());
		expect(section.key).toBe("coverage_snapshot");
	});

	it("section fallback is populated", () => {
		const section = buildCoverageSnapshotSection(makeSnapshot(), makeGateState());
		expect(section.fallback).toBeTruthy();
	});
});
