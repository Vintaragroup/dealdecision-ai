/**
 * verify-uof-parser.test.ts
 *
 * Unit tests for the parser helpers exported from bin/verify-uof-3deals.ts.
 *
 * Covers:
 *  1. parseUofSlotLine  — extracts the `use_of_funds:` line from insight_slots body
 *  2. extractEvidenceRef — extracts a dpu:doc:…:page:N ref from a slot line
 *  3. classifyUofOutcome — classifies the UoF outcome enum from a snapshot
 *     including the WIRING_BUG detection path
 */

import { describe, it, expect } from "vitest";
import {
	parseUofSlotLine,
	extractEvidenceRef,
	classifyUofOutcome,
	type InsightsSnapshot,
	type UofOutcome,
} from "../../../bin/verify-uof-3deals";

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeSnap(overrides: Partial<InsightsSnapshot> = {}): InsightsSnapshot {
	return {
		updated_at:           "2026-03-01T12:00:00.000Z",
		upstream_fingerprint: "abc123",
		status:               "ready",
		gate_all_passed:      true,
		section_keys:         [],
		insight_slots_body:   null,
		use_of_funds_v1_body: null,
		...overrides,
	};
}

/** Build a realistic insight_slots body with the given use_of_funds line. */
function slotsBody(uofLine: string): string {
	return [
		"traction_signal: Computable evidence=dpu:doc:aabbccdd:page:3 reason=DERIVED_FROM_FINANCIALS",
		uofLine,
		"team_strength: NotComputable reason=NO_TEAM_MENTION",
	].join("\n");
}

// ─── parseUofSlotLine ─────────────────────────────────────────────────────────

describe("parseUofSlotLine", () => {
	it("returns null for null body", () => {
		expect(parseUofSlotLine(null)).toBeNull();
	});

	it("returns null when no use_of_funds: line present", () => {
		const body = "traction_signal: Computable\nteam_strength: NotComputable";
		expect(parseUofSlotLine(body)).toBeNull();
	});

	it("extracts a Computable line with evidence", () => {
		const uofLine = "use_of_funds: Computable evidence=dpu:doc:12345678:page:7 reason=DERIVED_FROM_USE_OF_FUNDS";
		const body = slotsBody(uofLine);
		expect(parseUofSlotLine(body)).toBe(uofLine);
	});

	it("extracts a NotComputable line", () => {
		const uofLine = "use_of_funds: NotComputable reason=NO_USE_OF_FUNDS_MENTION";
		const body = slotsBody(uofLine);
		expect(parseUofSlotLine(body)).toBe(uofLine);
	});

	it("only matches lines that start with 'use_of_funds:'", () => {
		const body = "some_other_use_of_funds: x\nuse_of_funds: NotComputable reason=NONE";
		const result = parseUofSlotLine(body);
		expect(result).toBe("use_of_funds: NotComputable reason=NONE");
	});
});

// ─── extractEvidenceRef ───────────────────────────────────────────────────────

describe("extractEvidenceRef", () => {
	it("returns null for null input", () => {
		expect(extractEvidenceRef(null)).toBeNull();
	});

	it("returns null when no dpu: ref present", () => {
		expect(extractEvidenceRef("use_of_funds: NotComputable reason=NONE")).toBeNull();
	});

	it("extracts a valid dpu reference", () => {
		const line = "use_of_funds: Computable evidence=dpu:doc:af2edc64cc44:page:5 reason=DERIVED_FROM_USE_OF_FUNDS";
		expect(extractEvidenceRef(line)).toBe("dpu:doc:af2edc64cc44:page:5");
	});

	it("extracts an 8-char doc-id prefix (min length)", () => {
		const line = "use_of_funds: Computable evidence=dpu:doc:abcd1234:page:1 reason=DERIVED_FROM_USE_OF_FUNDS";
		expect(extractEvidenceRef(line)).toBe("dpu:doc:abcd1234:page:1");
	});

	it("extracts even when there are multiple potential refs — returns first match", () => {
		const line = "use_of_funds: Computable evidence=dpu:doc:11111111:page:2 alt=dpu:doc:22222222:page:3";
		expect(extractEvidenceRef(line)).toBe("dpu:doc:11111111:page:2");
	});
});

// ─── classifyUofOutcome ───────────────────────────────────────────────────────

describe("classifyUofOutcome", () => {
	const computableWithDerived =
		"use_of_funds: Computable evidence=dpu:doc:aabbccdd:page:4 reason=DERIVED_FROM_USE_OF_FUNDS";

	const computableWithText =
		"use_of_funds: Computable evidence=dpu:doc:aabbccdd:page:2 reason=TEXT_MATCH";

	const notComputable =
		"use_of_funds: NotComputable reason=NO_USE_OF_FUNDS_MENTION";

	// ── OK_DERIVED_FROM_USE_OF_FUNDS ─────────────────────────────────────────

	it("returns OK_DERIVED_FROM_USE_OF_FUNDS when use_of_funds_v1 section present AND slot is Computable + DERIVED_FROM_USE_OF_FUNDS", () => {
		const snap = makeSnap({
			section_keys:       ["insight_slots", "use_of_funds_v1"],
			insight_slots_body: slotsBody(computableWithDerived),
		});
		expect(classifyUofOutcome(snap)).toBe<UofOutcome>("OK_DERIVED_FROM_USE_OF_FUNDS");
	});

	// ── WIRING_BUG ────────────────────────────────────────────────────────────

	it("returns WIRING_BUG when use_of_funds_v1 section present but slot is NotComputable", () => {
		const snap = makeSnap({
			section_keys:       ["insight_slots", "use_of_funds_v1"],
			insight_slots_body: slotsBody(notComputable),
		});
		expect(classifyUofOutcome(snap)).toBe<UofOutcome>("WIRING_BUG");
	});

	it("returns WIRING_BUG when use_of_funds_v1 section present but slot is Computable without DERIVED_FROM_USE_OF_FUNDS", () => {
		const snap = makeSnap({
			section_keys:       ["insight_slots", "use_of_funds_v1"],
			insight_slots_body: slotsBody(computableWithText),
		});
		expect(classifyUofOutcome(snap)).toBe<UofOutcome>("WIRING_BUG");
	});

	it("returns WIRING_BUG when use_of_funds_v1 present but insight_slots_body is null", () => {
		const snap = makeSnap({
			section_keys:       ["insight_slots", "use_of_funds_v1"],
			insight_slots_body: null,
		});
		expect(classifyUofOutcome(snap)).toBe<UofOutcome>("WIRING_BUG");
	});

	// ── OK_TEXT ───────────────────────────────────────────────────────────────

	it("returns OK_TEXT when no use_of_funds_v1 section but slot is Computable (text match)", () => {
		const snap = makeSnap({
			section_keys:       ["insight_slots"],
			insight_slots_body: slotsBody(computableWithText),
		});
		expect(classifyUofOutcome(snap)).toBe<UofOutcome>("OK_TEXT");
	});

	it("returns OK_TEXT when use_of_funds_v1 absent but slot is Computable with DERIVED reason", () => {
		// Section absent — can't be WIRING_BUG; the slot text is enough.
		const snap = makeSnap({
			section_keys:       ["insight_slots"],
			insight_slots_body: slotsBody(computableWithDerived),
		});
		expect(classifyUofOutcome(snap)).toBe<UofOutcome>("OK_TEXT");
	});

	// ── NOT_PRESENT ───────────────────────────────────────────────────────────

	it("returns NOT_PRESENT when use_of_funds_v1 absent AND slot is NotComputable", () => {
		const snap = makeSnap({
			section_keys:       ["insight_slots"],
			insight_slots_body: slotsBody(notComputable),
		});
		expect(classifyUofOutcome(snap)).toBe<UofOutcome>("NOT_PRESENT");
	});

	it("returns NOT_PRESENT when insight_slots_body is null and no use_of_funds_v1 section", () => {
		const snap = makeSnap({
			section_keys:       ["insight_slots"],
			insight_slots_body: null,
		});
		expect(classifyUofOutcome(snap)).toBe<UofOutcome>("NOT_PRESENT");
	});

	it("returns NOT_PRESENT when section_keys is empty and no body", () => {
		const snap = makeSnap({
			section_keys:       [],
			insight_slots_body: null,
		});
		expect(classifyUofOutcome(snap)).toBe<UofOutcome>("NOT_PRESENT");
	});
});
