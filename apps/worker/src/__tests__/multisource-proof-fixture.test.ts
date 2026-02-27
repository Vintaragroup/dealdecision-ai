/**
 * Fixture CI test for multisource-proof-financials-3deals.
 *
 * No HTTP. No DB. Pure unit assertions against in-memory DealSnapshot fixtures.
 * Validates:
 *   - classifySourceType() detection logic
 *   - parseCanonicalFields() line-parser
 *   - buildDealAssertions() for all 3 target deals (StackFactor, DealDecision, WebMax)
 */

import { describe, it, expect } from "vitest";
import {
	DEALS,
	buildDealAssertions,
	classifySourceType,
	parseCanonicalFields,
	parseReconciliationConfidence,
	type DealSnapshot,
	type CanonicalField,
} from "../bin/proof-multisource-financials-3deals";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal DealSnapshot from explicit canonical field objects. */
function makeSnap(
	overrides: Partial<DealSnapshot> & {
		canonical_fields_direct: CanonicalField[];
	},
): DealSnapshot {
	const { canonical_fields_direct, ...rest } = overrides;
	return {
		deal_id:               "test-id",
		deal_name:             "Test Deal",
		updated_at:            "2025-01-01T00:00:00Z",
		upstream_fingerprint:  "abc123",
		status:                "complete",
		gate_all_passed:       true,
		section_keys:          ["canonical_fields", "financial_reconciliation_v1"],
		canonical_fields:      canonical_fields_direct,
		has_use_of_funds_v1:   false,
		has_financial_health:  false,
		has_reconciliation:    true,
		reconciliation_confidence: 0.75,
		insight_slots_body:    null,
		...rest,
	};
}

/** Make a Computable field attributed to XLSX. */
function xlsxField(field: string, category = "raise_terms"): CanonicalField {
	return {
		category,
		field,
		computability: "Computable",
		value:         "$2M",
		evidence:      "excel_sheet:use_of_funds:row_3",
		reason:        "DERIVED_FROM_USE_OF_FUNDS",
		source_type:   "XLSX",
	};
}

/** Make a Computable field attributed to DECK_PDF. */
function deckField(field: string, category = "raise_terms"): CanonicalField {
	return {
		category,
		field,
		computability: "Computable",
		value:         "Series A",
		evidence:      "dpu:doc:abc001ff:page:4",
		reason:        "PATTERN_MATCH",
		source_type:   "DECK_PDF",
	};
}

// ─── classifySourceType ───────────────────────────────────────────────────────

describe("classifySourceType", () => {
	it("returns XLSX for DERIVED_FROM_USE_OF_FUNDS reason", () => {
		expect(classifySourceType("DERIVED_FROM_USE_OF_FUNDS", "any")).toBe("XLSX");
	});

	it("returns XLSX for FROM_EXCEL reason", () => {
		expect(classifySourceType("FROM_EXCEL", "any")).toBe("XLSX");
	});

	it("returns XLSX for FROM_XLSX reason", () => {
		expect(classifySourceType("FROM_XLSX", "any")).toBe("XLSX");
	});

	it("returns XLSX for EXCEL_BRIDGE reason", () => {
		expect(classifySourceType("EXCEL_BRIDGE_CALCULATION", "any")).toBe("XLSX");
	});

	it("returns XLSX for use_of_funds_v1 reason (case-insensitive)", () => {
		expect(classifySourceType("use_of_funds_v1_total", "none")).toBe("XLSX");
	});

	it("returns DECK_PDF for dpu:doc evidence reference", () => {
		expect(classifySourceType("NO_SIGNAL", "dpu:doc:abc001ff:page:0")).toBe("DECK_PDF");
	});

	it("returns DECK_PDF for PATTERN_MATCH reason", () => {
		expect(classifySourceType("PATTERN_MATCH_REGEX", "none")).toBe("DECK_PDF");
	});

	it("returns DECK_PDF for OCR_TEXT reason", () => {
		expect(classifySourceType("OCR_TEXT_EXTRACTION", "none")).toBe("DECK_PDF");
	});

	it("returns DECK_PDF for SLIDE_TEXT reason", () => {
		expect(classifySourceType("SLIDE_TEXT_FOUND", "none")).toBe("DECK_PDF");
	});

	it("returns UNKNOWN when no signals match", () => {
		expect(classifySourceType("NO_RAISE_AMOUNT_MENTION", "none")).toBe("UNKNOWN");
	});

	it("XLSX signal takes priority over dpu evidence", () => {
		// reason is XLSX signal → XLSX wins regardless of evidence
		expect(classifySourceType("DERIVED_FROM_USE_OF_FUNDS", "dpu:doc:abc001ff:page:1")).toBe("XLSX");
	});

	// source= token tests (Phase M fixes)
	it("returns XLSX when sourceToken=xlsx regardless of reason/evidence", () => {
		expect(classifySourceType("none", "dpu:doc:abc001ff:page:1", "xlsx")).toBe("XLSX");
	});

	it("returns DECK_PDF when sourceToken=deck", () => {
		expect(classifySourceType("none", "none", "deck")).toBe("DECK_PDF");
	});

	it("sourceToken=xlsx overrides dpu evidence-based DECK_PDF detection", () => {
		expect(classifySourceType("none", "dpu:doc:abc123:page:0", "xlsx")).toBe("XLSX");
	});

	// New DERIVED_FROM_* reason codes (Phase M)
	it("returns XLSX for DERIVED_FROM_FINANCIALS reason", () => {
		expect(classifySourceType("DERIVED_FROM_FINANCIALS", "none")).toBe("XLSX");
	});

	it("returns XLSX for DERIVED_FROM_BUDGET_MODEL reason", () => {
		expect(classifySourceType("DERIVED_FROM_BUDGET_MODEL", "none")).toBe("XLSX");
	});

	it("returns XLSX for DERIVED_FROM_SAAS_KPI reason", () => {
		expect(classifySourceType("DERIVED_FROM_SAAS_KPI", "none")).toBe("XLSX");
	});

	it("returns XLSX for DERIVED_FROM_BALANCE_SHEET reason", () => {
		expect(classifySourceType("DERIVED_FROM_BALANCE_SHEET", "none")).toBe("XLSX");
	});

	it("returns XLSX for DERIVED_FROM_CASH_FLOW reason", () => {
		expect(classifySourceType("DERIVED_FROM_CASH_FLOW", "none")).toBe("XLSX");
	});

	it("returns XLSX for DERIVED_FROM_CAP_TABLE reason", () => {
		expect(classifySourceType("DERIVED_FROM_CAP_TABLE", "none")).toBe("XLSX");
	});

	it("returns XLSX for DERIVED_FROM_INCOME_STATEMENT reason", () => {
		expect(classifySourceType("DERIVED_FROM_INCOME_STATEMENT", "none")).toBe("XLSX");
	});
});

// ─── parseCanonicalFields ────────────────────────────────────────────────────

describe("parseCanonicalFields", () => {
	it("returns empty array for null body", () => {
		expect(parseCanonicalFields(null)).toEqual([]);
	});

	it("returns empty array for empty string", () => {
		expect(parseCanonicalFields("")).toEqual([]);
	});

	it("skips comment lines and section separators", () => {
		const body = [
			"# canonical fields",
			"---",
			"category=raise_terms | field=raise_amount | computability=Computable | value=$2M | evidence=excel_sheet:row_1 | reason=DERIVED_FROM_USE_OF_FUNDS",
		].join("\n");
		const fields = parseCanonicalFields(body);
		expect(fields).toHaveLength(1);
	});

	it("parses a single Computable XLSX line correctly", () => {
		const body =
			"category=raise_terms | field=raise_amount | computability=Computable | value=$2M | evidence=excel_sheet:row_1 | reason=DERIVED_FROM_USE_OF_FUNDS";
		const [f] = parseCanonicalFields(body);
		expect(f).toBeDefined();
		expect(f!.category).toBe("raise_terms");
		expect(f!.field).toBe("raise_amount");
		expect(f!.computability).toBe("Computable");
		expect(f!.value).toBe("$2M");
		expect(f!.source_type).toBe("XLSX");
	});

	it("parses a DECK_PDF line via evidence reference", () => {
		const body =
			"category=raise_terms | field=raise_round | computability=Computable | value=Series A | evidence=dpu:doc:abc001ff:page:3 | reason=NO_SIGNAL";
		const [f] = parseCanonicalFields(body);
		expect(f!.source_type).toBe("DECK_PDF");
		expect(f!.field).toBe("raise_round");
	});

	it("parses multiple lines into separate records", () => {
		const body = [
			"category=raise_terms | field=raise_amount | computability=Computable | value=$1M | evidence=excel_sheet:row_1 | reason=FROM_XLSX",
			"category=raise_terms | field=raise_round | computability=Computable | value=Seed | evidence=dpu:doc:bcd002ff:page:2 | reason=OCR_TEXT",
			"category=raise_terms | field=raise_instrument | computability=NotComputable | value=SAFE | evidence=none | reason=NOT_FOUND",
		].join("\n");
		const fields = parseCanonicalFields(body);
		expect(fields).toHaveLength(3);
		expect(fields[0]!.source_type).toBe("XLSX");
		expect(fields[1]!.source_type).toBe("DECK_PDF");
		expect(fields[2]!.source_type).toBe("UNKNOWN");
	});

	it("skips lines without a field= segment", () => {
		const body = [
			"this line has no field key",
			"category=raise_terms | field=raise_round | computability=Computable | value=Seed | evidence=dpu:doc:ef3456:page:0 | reason=OCR_TEXT",
		].join("\n");
		expect(parseCanonicalFields(body)).toHaveLength(1);
	});

	// source= token parsing (Phase M)
	it("classifies as XLSX when source=xlsx token present (even if evidence is dpu ref)", () => {
		const body =
			"category=financial_health | field=cash_balance | computability=Computable | value=\"$500K (XLSX)\" | evidence=dpu:doc:58595eb2:page:0 | reason=DERIVED_FROM_BALANCE_SHEET | source=xlsx";
		const [f] = parseCanonicalFields(body);
		expect(f!.source_type).toBe("XLSX");
	});

	it("classifies as DECK_PDF when source=deck token present", () => {
		const body =
			"category=raise_terms | field=raise_amount | computability=Computable | value=\"$2M\" | evidence=dpu:doc:abc001ff:page:3 | reason=none | source=deck";
		const [f] = parseCanonicalFields(body);
		expect(f!.source_type).toBe("DECK_PDF");
	});

	it("parses source=xlsx fields from ICA budget model cascade", () => {
		const body =
			"category=use_of_funds | field=use_of_funds_buckets | computability=Computable | value=\"Engineering $120K 40.0%\" | evidence=dpu:doc:3abc1234:page:1 | reason=DERIVED_FROM_BUDGET_MODEL | source=xlsx";
		const [f] = parseCanonicalFields(body);
		expect(f!.source_type).toBe("XLSX");
		expect(f!.field).toBe("use_of_funds_buckets");
	});
});

// ─── parseReconciliationConfidence ───────────────────────────────────────────

describe("parseReconciliationConfidence", () => {
	it("returns null for null body", () => {
		expect(parseReconciliationConfidence(null)).toBeNull();
	});

	it("extracts confidence_score float", () => {
		const body = "gate: PASS\nconfidence_score: 0.82\ncomments: none";
		expect(parseReconciliationConfidence(body)).toBe(0.82);
	});

	it("returns null when confidence_score not in body", () => {
		const body = "gate: PASS\ncomments: none";
		expect(parseReconciliationConfidence(body)).toBeNull();
	});
});

// ─── buildDealAssertions — StackFactor (has_xlsx=true) ───────────────────────

describe("buildDealAssertions — StackFactor", () => {
	const config = DEALS.find((d) => d.name === "StackFactor")!;

	it("DEALS registry has StackFactor config", () => {
		expect(config).toBeDefined();
		expect(config.has_xlsx).toBe(true);
	});

	it("all assertions pass for a well-formed StackFactor snapshot", () => {
		const snap = makeSnap({
			deal_id:    config.deal_id,
			deal_name:  "StackFactor",
			section_keys: ["canonical_fields", "financial_reconciliation_v1", "use_of_funds_v1"],
			has_use_of_funds_v1: true,
			has_reconciliation: true,
			reconciliation_confidence: 0.72,
			canonical_fields_direct: [
				xlsxField("raise_amount"),
				xlsxField("use_of_funds_buckets", "use_of_funds"),
				deckField("raise_round"),
				deckField("raise_instrument"),
			],
		});

		const results = buildDealAssertions(snap, config);
		const failures = results.filter((r) => !r.passed);
		expect(failures, `Unexpected assertion failures:\n${failures.map((f) => `  ${f.name}: ${f.detail}`).join("\n")}`).toHaveLength(0);
	});

	it("fails canonical_fields_section_present when section key missing", () => {
		const snap = makeSnap({
			section_keys: ["financial_reconciliation_v1"],
			has_reconciliation: true,
			reconciliation_confidence: 0.5,
			canonical_fields_direct: [xlsxField("raise_amount"), deckField("raise_round"), deckField("raise_instrument")],
		});
		const results = buildDealAssertions(snap, config);
		const a1 = results.find((r) => r.name === "canonical_fields_section_present")!;
		expect(a1.passed).toBe(false);
	});

	it("fails canonical_fields_has_computable when all fields are NotComputable", () => {
		const snap = makeSnap({
			section_keys: ["canonical_fields", "financial_reconciliation_v1"],
			has_reconciliation: true,
			reconciliation_confidence: 0.5,
			canonical_fields_direct: [
				{ ...xlsxField("raise_amount"), computability: "NotComputable" },
				{ ...deckField("raise_round"),  computability: "NotComputable" },
				{ ...deckField("raise_instrument"), computability: "NotComputable" },
			],
		});
		const results = buildDealAssertions(snap, config);
		const a2 = results.find((r) => r.name === "canonical_fields_has_computable")!;
		expect(a2.passed).toBe(false);
	});

	it("fails required_field_raise_amount when field absent", () => {
		const snap = makeSnap({
			section_keys: ["canonical_fields", "financial_reconciliation_v1"],
			has_reconciliation: true,
			reconciliation_confidence: 0.5,
			canonical_fields_direct: [deckField("raise_round"), deckField("raise_instrument")],
		});
		const results = buildDealAssertions(snap, config);
		const missing = results.find((r) => r.name === "required_field_raise_amount")!;
		expect(missing.passed).toBe(false);
	});

	it("fails xlsx_source_attributed when no XLSX Computable fields", () => {
		const snap = makeSnap({
			section_keys: ["canonical_fields", "financial_reconciliation_v1"],
			has_reconciliation: true,
			reconciliation_confidence: 0.5,
			canonical_fields_direct: [
				deckField("raise_amount"),
				deckField("raise_round"),
				deckField("raise_instrument"),
			],
		});
		const results = buildDealAssertions(snap, config);
		const a6 = results.find((r) => r.name === "xlsx_source_attributed")!;
		expect(a6.passed).toBe(false);
	});

	it("fails reconciliation_section_present when has_reconciliation=false", () => {
		const snap = makeSnap({
			section_keys: ["canonical_fields"],
			has_reconciliation: false,
			reconciliation_confidence: null,
			canonical_fields_direct: [
				xlsxField("raise_amount"), deckField("raise_round"), deckField("raise_instrument"),
			],
		});
		const results = buildDealAssertions(snap, config);
		const a4 = results.find((r) => r.name === "reconciliation_section_present")!;
		expect(a4.passed).toBe(false);
	});

	it("fails reconciliation_confidence_valid when confidence out of range", () => {
		const snap = makeSnap({
			section_keys: ["canonical_fields", "financial_reconciliation_v1"],
			has_reconciliation: true,
			reconciliation_confidence: 1.5, // out of [0, 1]
			canonical_fields_direct: [
				xlsxField("raise_amount"), deckField("raise_round"), deckField("raise_instrument"),
			],
		});
		const results = buildDealAssertions(snap, config);
		const a5 = results.find((r) => r.name === "reconciliation_confidence_valid")!;
		expect(a5.passed).toBe(false);
	});

	it("fails computable_fields_have_evidence when evidence is empty string", () => {
		const snap = makeSnap({
			section_keys: ["canonical_fields", "financial_reconciliation_v1"],
			has_reconciliation: true,
			reconciliation_confidence: 0.5,
			canonical_fields_direct: [
				{ ...xlsxField("raise_amount"), evidence: "" }, // no evidence
				deckField("raise_round"),
				deckField("raise_instrument"),
			],
		});
		const results = buildDealAssertions(snap, config);
		const a9 = results.find((r) => r.name === "computable_fields_have_evidence")!;
		expect(a9.passed).toBe(false);
	});
});

// ─── buildDealAssertions — DealDecision (has_xlsx=false) ─────────────────────

describe("buildDealAssertions — DealDecision", () => {
	const config = DEALS.find((d) => d.name === "DealDecision")!;

	it("DEALS registry has DealDecision config with has_xlsx=false", () => {
		expect(config).toBeDefined();
		expect(config.has_xlsx).toBe(false);
	});

	it("all assertions pass for a well-formed DealDecision snapshot", () => {
		const snap = makeSnap({
			deal_id:   config.deal_id,
			deal_name: "DealDecision",
			section_keys: ["canonical_fields", "financial_reconciliation_v1"],
			has_use_of_funds_v1: false,
			has_reconciliation: true,
			reconciliation_confidence: 0.65,
			canonical_fields_direct: [
				deckField("raise_round"),
				deckField("raise_instrument"),
			],
		});

		const results = buildDealAssertions(snap, config);
		const failures = results.filter((r) => !r.passed);
		expect(failures, `Unexpected failures:\n${failures.map((f) => `  ${f.name}: ${f.detail}`).join("\n")}`).toHaveLength(0);
	});

	it("does NOT include xlsx_source_attributed assertion (no XLSX)", () => {
		const snap = makeSnap({
			has_reconciliation: true,
			reconciliation_confidence: 0.5,
			canonical_fields_direct: [deckField("raise_round"), deckField("raise_instrument")],
		});
		const results = buildDealAssertions(snap, config);
		const a6 = results.find((r) => r.name === "xlsx_source_attributed");
		expect(a6).toBeUndefined();
	});

	it("does NOT include deck_pdf_source_attributed assertion (no XLSX)", () => {
		const snap = makeSnap({
			has_reconciliation: true,
			reconciliation_confidence: 0.5,
			canonical_fields_direct: [deckField("raise_round"), deckField("raise_instrument")],
		});
		const results = buildDealAssertions(snap, config);
		const a7 = results.find((r) => r.name === "deck_pdf_source_attributed");
		expect(a7).toBeUndefined();
	});
});

// ─── buildDealAssertions — WebMax (has_xlsx=true) ────────────────────────────

describe("buildDealAssertions — WebMax", () => {
	const config = DEALS.find((d) => d.name === "WebMax")!;

	it("DEALS registry has WebMax config with has_xlsx=true and use_of_funds_buckets signal", () => {
		expect(config).toBeDefined();
		expect(config.has_xlsx).toBe(true);
		expect(config.expected_xlsx_signals).toContain("use_of_funds_buckets");
		expect(config.expected_xlsx_signals).toContain("raise_round");
	});

	it("all assertions pass for a well-formed WebMax snapshot", () => {
		const snap = makeSnap({
			deal_id:   config.deal_id,
			deal_name: "WebMax",
			section_keys: ["canonical_fields", "financial_reconciliation_v1", "use_of_funds_v1"],
			has_use_of_funds_v1: true,
			has_reconciliation: true,
			reconciliation_confidence: 0.81,
			canonical_fields_direct: [
				xlsxField("raise_amount"),
				xlsxField("use_of_funds_buckets", "use_of_funds"),
				xlsxField("raise_round"),
				deckField("raise_instrument"),
			],
		});

		const results = buildDealAssertions(snap, config);
		const failures = results.filter((r) => !r.passed);
		expect(failures, `Unexpected failures:\n${failures.map((f) => `  ${f.name}: ${f.detail}`).join("\n")}`).toHaveLength(0);
	});

	it("includes use_of_funds_v1_section_present as soft-pass assertion", () => {
		// Even without use_of_funds_v1 section, passed=true (soft check)
		const snap = makeSnap({
			section_keys: ["canonical_fields", "financial_reconciliation_v1"],
			has_use_of_funds_v1: false,
			has_reconciliation: true,
			reconciliation_confidence: 0.5,
			canonical_fields_direct: [
				xlsxField("raise_amount"),
				xlsxField("use_of_funds_buckets", "use_of_funds"),
				xlsxField("raise_round"),
				deckField("raise_instrument"),
			],
		});
		const results = buildDealAssertions(snap, config);
		const a8 = results.find((r) => r.name === "use_of_funds_v1_section_present")!;
		expect(a8).toBeDefined();
		expect(a8.passed).toBe(true); // always soft-pass
	});
});

// ─── DEALS registry integrity ─────────────────────────────────────────────────

describe("DEALS registry", () => {
	it("has exactly 3 deal configs", () => {
		expect(DEALS).toHaveLength(3);
	});

	it("each config has unique deal_id", () => {
		const ids = DEALS.map((d) => d.deal_id);
		expect(new Set(ids).size).toBe(3);
	});

	it("each config has required_fields array", () => {
		for (const d of DEALS) {
			expect(Array.isArray(d.required_fields)).toBe(true);
			expect(d.required_fields.length).toBeGreaterThan(0);
		}
	});

	it("XLSX deals have at least one expected_xlsx_signal", () => {
		for (const d of DEALS.filter((d) => d.has_xlsx)) {
			expect(d.expected_xlsx_signals.length).toBeGreaterThan(0);
		}
	});

	it("non-XLSX deals have empty expected_xlsx_signals", () => {
		for (const d of DEALS.filter((d) => !d.has_xlsx)) {
			expect(d.expected_xlsx_signals).toHaveLength(0);
		}
	});
});
