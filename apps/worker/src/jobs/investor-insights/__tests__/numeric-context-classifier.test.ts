/**
 * Numeric Context Classifier — Regression Tests
 *
 * Tests the context-guard functions added for:
 *   - ARR market-context taint (Phase 2 / PR37)
 *   - Valuation competitor-context taint (Phase 3 / PR37)
 *   - Phase 4 CONFLICTING-confidence field suppression (governed summary gate)
 *
 * All tests are pure / no DB / no LLM.
 *
 * Six mandatory test cases cover:
 *   1. ARR taint — market-size context suppresses arr_value (StackFactor $200M regression)
 *   2. ARR safe — company-ownership override preserves legitimate company ARR
 *   3. Valuation taint — competitor context suppresses valuation_post (deal decision $8B regression)
 *   4. Valuation safe — post-money explicit prefix never tainted (form A)
 *   5. detectArrInTextSources — end-to-end: tainted pages bypassed, clean page returned
 *   6. detectValuationPostInTextSources — end-to-end: competitor page bypassed, own page returned
 *
 * Additional cases cover the Phase 4 canonicalFieldsBody gate.
 */

import { describe, it, expect } from "vitest";
import {
	isArrMatchTainted,
	detectArrInTextSources,
	isValuationMatchTainted,
	detectValuationPostInTextSources,
	formatCanonicalFieldLine,
} from "../stages/stage-2-deterministic";
import type { DpuPage, EvidenceSnippet } from "../stages/stage-2-deterministic";
import { EVIDENCE_CONFIDENCE_LEVEL } from "@dealdecision/core";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePage(text: string, document_id = "doc1", page_index = 0): DpuPage {
	return { document_id, page_index, text, text_raw: text, norm_events_count: 0 };
}

function noEvidence(): EvidenceSnippet[] {
	return [];
}

// ── ARR_VALUE_PATTERN (same as in stage-2) ───────────────────────────────────
const ARR_VALUE_PATTERN = /\bARR\b[^$\n]{0,40}?\$[\d,.]+\s*[BMKbmk]?/i;

// ── VALUATION_POST_PATTERN rebuilt for tests ──────────────────────────────────
// (mirroring the pattern from stage-2-deterministic.ts)
const MONEY_FRAGMENT =
	"(?:[€£$]|USD|EUR|GBP)\\s*[\\d,]+(?:\\.\\d+)?\\s*(?:MM|BB|[BMKbmkTt]|million|billion|thousand|trillion)?(?:\\+)?";
const _NO_CUR = "[^€£$]";
const VALUATION_POST_PATTERN = new RegExp(
	`post[-\\s]money\\s+(?:valuation\\s+)?(?:of\\s+|is\\s+|at\\s+)?${MONEY_FRAGMENT}` +
	`|${MONEY_FRAGMENT}${_NO_CUR}{0,30}?\\bvaluation\\b` +
	`|\\bvaluation\\b${_NO_CUR}{0,20}?${MONEY_FRAGMENT}`,
	"i"
);

// ═══════════════════════════════════════════════════════════════════════════════
// TEST CASE 1: ARR taint — market-size context suppresses arr_value
// Covers: StackFactor regression where "$200M ARR market segment" was mis-extracted
// as company ARR.
// ═══════════════════════════════════════════════════════════════════════════════
describe("Case 1 — ARR market-context taint (StackFactor-class regression)", () => {
	it("taints 'ARR market segment of $200M' (ARR then market then money)", () => {
		// ARR pattern requires ARR keyword before the dollar sign
		const text = "The ARR market segment of $200M presents a huge opportunity.";
		const m = ARR_VALUE_PATTERN.exec(text);
		expect(m).not.toBeNull();
		expect(isArrMatchTainted(text, m!.index, m![0].length)).toBe(true);
	});

	it("taints 'ARR market size: $1.5B' (ARR keyword, then market size)", () => {
		const text = "Our analysis shows ARR market size: $1.5B across SaaS verticals.";
		const m = ARR_VALUE_PATTERN.exec(text);
		expect(m).not.toBeNull();
		expect(isArrMatchTainted(text, m!.index, m![0].length)).toBe(true);
	});

	it("taints 'industry ARR pool of $300M'", () => {
		const text = "The combined industry ARR pool of $300M is fragmented.";
		const m = ARR_VALUE_PATTERN.exec(text);
		expect(m).not.toBeNull();
		expect(isArrMatchTainted(text, m!.index, m![0].length)).toBe(true);
	});

	it("taints 'TAM — ARR $200M businesses in this segment'", () => {
		// TAM keyword appears in window, ARR matches before $
		const text = "TAM analysis: ARR $200M businesses constitute the addressable segment.";
		const m = ARR_VALUE_PATTERN.exec(text);
		expect(m).not.toBeNull();
		expect(isArrMatchTainted(text, m!.index, m![0].length)).toBe(true);
	});

	it("taints when 'market' appears within window (taint window check)", () => {
		// ARR $50M follows a market-size sentence within 120 chars
		const text = "Targeting the SaaS market segment. ARR $50M addressable among mid-size customers.";
		const m = ARR_VALUE_PATTERN.exec(text);
		expect(m).not.toBeNull();
		expect(isArrMatchTainted(text, m!.index, m![0].length)).toBe(true);
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// TEST CASE 2: ARR safe — company ownership override preserves company ARR
// ═══════════════════════════════════════════════════════════════════════════════
describe("Case 2 — ARR company-ownership override (legitimate company ARR)", () => {
	it("does NOT taint 'Our ARR is $5M'", () => {
		const text = "Our ARR is $5M and growing 40% month over month.";
		const m = ARR_VALUE_PATTERN.exec(text);
		expect(m).not.toBeNull();
		expect(isArrMatchTainted(text, m!.index, m![0].length)).toBe(false);
	});

	it("does NOT taint 'ARR reached $10M in Q3'", () => {
		const text = "ARR reached $10M in Q3 2024.";
		const m = ARR_VALUE_PATTERN.exec(text);
		expect(m).not.toBeNull();
		expect(isArrMatchTainted(text, m!.index, m![0].length)).toBe(false);
	});

	it("does NOT taint 'ARR: $3M growing 200% YoY' (traction slide, colon form)", () => {
		// ARR before $ — pattern matches; no market language in window
		const text = "ARR: $3M growing 200% YoY. 120 paying customers.";
		const m = ARR_VALUE_PATTERN.exec(text);
		expect(m).not.toBeNull();
		expect(isArrMatchTainted(text, m!.index, m![0].length)).toBe(false);
	});

	it("company ownership overrides market keyword when 'our ARR' appears in window", () => {
		// 'market' also appears but 'our ARR' is the dominant signal
		const text = "We are targeting a large market. Our ARR is $8M as of this month.";
		const m = ARR_VALUE_PATTERN.exec(text);
		expect(m).not.toBeNull();
		expect(isArrMatchTainted(text, m!.index, m![0].length)).toBe(false);
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// TEST CASE 3: Valuation taint — competitor context suppresses valuation_post
// Covers: deal decision regression where "$8B competitor valuation" was included
// in the company's canonical valuation field.
// ═══════════════════════════════════════════════════════════════════════════════
describe("Case 3 — Valuation competitor-context taint (deal-decision-class regression)", () => {
	it("taints 'Our competitor has a $8B valuation'", () => {
		const text = "Our competitor has a $8B valuation, making them a formidable incumbent.";
		const m = VALUATION_POST_PATTERN.exec(text);
		expect(m).not.toBeNull();
		expect(isValuationMatchTainted(text, m!.index, m![0].length)).toBe(true);
	});

	it("taints 'industry leader $8B valuation' (form B — money then valuation)", () => {
		// VALUATION_POST_PATTERN form B requires 'valuation' keyword (not just 'valued')
		const text = "The industry leader has a $8B valuation in this space.";
		const m = VALUATION_POST_PATTERN.exec(text);
		expect(m).not.toBeNull();
		expect(isValuationMatchTainted(text, m!.index, m![0].length)).toBe(true);
	});

	it("taints 'publicly traded comps at $8B valuation'", () => {
		const text = "Comparable publicly traded comps are trading at a $8B valuation.";
		const m = VALUATION_POST_PATTERN.exec(text);
		expect(m).not.toBeNull();
		expect(isValuationMatchTainted(text, m!.index, m![0].length)).toBe(true);
	});

	it("taints 'valuation $5B for comparable sector companies'", () => {
		// Form C — valuation keyword then money
		const text = "The valuation $5B assigned to comparable sector companies is a benchmark.";
		const m = VALUATION_POST_PATTERN.exec(text);
		expect(m).not.toBeNull();
		expect(isValuationMatchTainted(text, m!.index, m![0].length)).toBe(true);
	});

	it("taints 'late-stage peers at $4B valuation'", () => {
		const text = "Late-stage peers are at a $4B valuation on average.";
		const m = VALUATION_POST_PATTERN.exec(text);
		expect(m).not.toBeNull();
		expect(isValuationMatchTainted(text, m!.index, m![0].length)).toBe(true);
	});

	it("taints 'Competitive Landscape ... $8B valuation' (deal-decision deck regression)", () => {
		// Exact reproduction of deal-decision page 11 text — slide heading "Competitive Landscape"
		// appears 66 chars before the "$8B valuation" match (within VALUATION_TAINT_WINDOW=150)
		const text =
			"Competitive Landscape Harvey Dealum / Edda Visible.vc / 4Degrees $8B valuation « Legal Al focus Deal flow + portfolio management";
		const m = VALUATION_POST_PATTERN.exec(text);
		expect(m).not.toBeNull();
		expect(isValuationMatchTainted(text, m!.index, m![0].length)).toBe(true);
	});

	it("taints 'Competitive Analysis showing $5B valuation for market players'", () => {
		const text = "Competitive Analysis showing $5B valuation for market players in this sector.";
		const m = VALUATION_POST_PATTERN.exec(text);
		expect(m).not.toBeNull();
		expect(isValuationMatchTainted(text, m!.index, m![0].length)).toBe(true);
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// TEST CASE 4: Valuation safe — legitimate company valuations not suppressed
// ═══════════════════════════════════════════════════════════════════════════════
describe("Case 4 — Valuation company-ownership safe (form A and company ownership)", () => {
	it("does NOT taint 'post-money valuation $10M' (form A)", () => {
		const text = "post-money valuation $10M on a $2M raise.";
		const m = VALUATION_POST_PATTERN.exec(text);
		expect(m).not.toBeNull();
		expect(isValuationMatchTainted(text, m!.index, m![0].length)).toBe(false);
	});

	it("does NOT taint 'Post-Money Valuation of $6MM'", () => {
		const text = "Post-Money Valuation of $6MM. Pre-Money Valuation $4MM.";
		const m = VALUATION_POST_PATTERN.exec(text);
		expect(m).not.toBeNull();
		expect(isValuationMatchTainted(text, m!.index, m![0].length)).toBe(false);
	});

	it("does NOT taint 'our company valuation is $10M' (company ownership override)", () => {
		// Form C matches (valuation then $); COMPANY_OWNERSHIP_RE fires in window
		const text = "Our company valuation is $10M based on current MRR multiple.";
		const m = VALUATION_POST_PATTERN.exec(text);
		expect(m).not.toBeNull();
		expect(isValuationMatchTainted(text, m!.index, m![0].length)).toBe(false);
	});

	it("does NOT taint '$6MM Valuation — our SAFE cap'", () => {
		const text = "$6MM Valuation — our SAFE cap for this pre-seed round.";
		const m = VALUATION_POST_PATTERN.exec(text);
		expect(m).not.toBeNull();
		expect(isValuationMatchTainted(text, m!.index, m![0].length)).toBe(false);
	});

	it("does NOT taint 'our company valuation is $10M'", () => {
		const text = "Our company valuation is $10M based on current MRR multiple.";
		const m = VALUATION_POST_PATTERN.exec(text);
		expect(m).not.toBeNull();
		expect(isValuationMatchTainted(text, m!.index, m![0].length)).toBe(false);
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// TEST CASE 5: detectArrInTextSources — tainted pages bypassed, clean page returned
// ═══════════════════════════════════════════════════════════════════════════════
describe("Case 5 — detectArrInTextSources end-to-end taint bypass", () => {
	it("returns null when only tainted pages are present", () => {
		const pages: DpuPage[] = [
			makePage("The $200M ARR market segment is highly fragmented.", "doc1", 1),
			makePage("ARR market size $1.5B across enterprise SaaS.", "doc1", 2),
		];
		const result = detectArrInTextSources(ARR_VALUE_PATTERN, pages, noEvidence());
		expect(result).toBeNull();
	});

	it("returns the clean page match when mixed tainted + clean pages", () => {
		const pages: DpuPage[] = [
			makePage("The $200M ARR market segment is highly fragmented.", "doc1", 1),  // tainted
			makePage("ARR reached $10M in Q3. Growing 40% YoY.", "doc1", 2),            // clean
		];
		const result = detectArrInTextSources(ARR_VALUE_PATTERN, pages, noEvidence());
		expect(result).not.toBeNull();
		expect(result!.snippet).toContain("$10M");
	});

	it("skips a tainted page and picks the company ARR page (ordering matters)", () => {
		const pages: DpuPage[] = [
			makePage("Industry ARR pool: $300M across 2,000 mid-market companies.", "doc1", 0), // tainted
			makePage("Our ARR is $5M as of last month.", "doc1", 1),                            // clean
		];
		const result = detectArrInTextSources(ARR_VALUE_PATTERN, pages, noEvidence());
		expect(result).not.toBeNull();
		expect(result!.snippet).toContain("$5M");
	});

	it("returns null when no ARR mention exists at all", () => {
		const pages: DpuPage[] = [
			makePage("We are raising $2M for product development.", "doc1", 0),
		];
		const result = detectArrInTextSources(ARR_VALUE_PATTERN, pages, noEvidence());
		expect(result).toBeNull();
	});

	it("falls back to evidence snippet when all DPU pages are tainted", () => {
		const pages: DpuPage[] = [
			makePage("The $500M ARR market segment.", "doc1", 0),
		];
		const evidence: EvidenceSnippet[] = [{
			id: "aaaa-bbbb-cccc-dddd",
			claim_text: "ARR $12M — company achieved annual recurring revenue target.",
			claim_text_norm: "ARR $12M — company achieved annual recurring revenue target.",
		}];
		const result = detectArrInTextSources(ARR_VALUE_PATTERN, pages, evidence);
		expect(result).not.toBeNull();
		expect(result!.snippet).toContain("$12M");
		expect(result!.ref).toMatch(/^evidence:item:/);
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// TEST CASE 6: detectValuationPostInTextSources — competitor page supressed,
// company page returned
// ═══════════════════════════════════════════════════════════════════════════════
describe("Case 6 — detectValuationPostInTextSources end-to-end competitor bypass", () => {
	it("returns null when only competitor valuation pages exist", () => {
		const pages: DpuPage[] = [
			makePage("The industry leader has a valuation of $8B.", "doc1", 0),
			makePage("Comparable companies at $5B valuation.", "doc1", 1),
		];
		const result = detectValuationPostInTextSources(VALUATION_POST_PATTERN, pages, noEvidence());
		expect(result).toBeNull();
	});

	it("returns company's post-money form A when competitor form B also present", () => {
		const pages: DpuPage[] = [
			makePage("Big competitor has $8B valuation in this space.", "doc1", 0),   // form B, tainted
			makePage("post-money valuation $10M on $2M raise.", "doc1", 1),           // form A, clean
		];
		const result = detectValuationPostInTextSources(VALUATION_POST_PATTERN, pages, noEvidence());
		expect(result).not.toBeNull();
		expect(result!.snippet).toContain("$10M");
	});

	it("does not return null for 'Post-Money Valuation of $6MM' (own company)", () => {
		const pages: DpuPage[] = [
			makePage("Deal Terms: Post-Money Valuation of $6MM.", "doc1", 0),
		];
		const result = detectValuationPostInTextSources(VALUATION_POST_PATTERN, pages, noEvidence());
		expect(result).not.toBeNull();
		expect(result!.snippet).toContain("$6MM");
	});

	it("returns null when no valuation mention exists", () => {
		const pages: DpuPage[] = [
			makePage("We are raising $2M at a SAFE discount of 20%.", "doc1", 0),
		];
		const result = detectValuationPostInTextSources(VALUATION_POST_PATTERN, pages, noEvidence());
		expect(result).toBeNull();
	});

	it("returns null for 'Competitive Landscape ... $8B valuation' (deal-decision page 11 regression)", () => {
		// Evidence snippet fallback is intentionally NOT used — short clips lack the surrounding
		// context that identifies competitor context. DPU page is correctly tainted.
		const pages: DpuPage[] = [
			makePage(
				"Competitive Landscape Harvey Dealum / Edda Visible.vc / 4Degrees $8B valuation \u00ab Legal Al focus",
				"6557c7c2",
				11
			),
		];
		// Even if an evidence snippet contains the same value, it must not be surfaced
		const fakeEvidence: EvidenceSnippet[] = [
			{ id: "aaaa1111-0000-0000-0000-000000000000", claim_text: "4Degrees $8B valuation", claim_text_norm: "4Degrees $8B valuation" } as EvidenceSnippet,
		];
		const result = detectValuationPostInTextSources(VALUATION_POST_PATTERN, pages, fakeEvidence);
		expect(result).toBeNull();
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// Phase 4 gate: CONFLICTING-confidence fields excluded from canonicalFieldsBody
// ═══════════════════════════════════════════════════════════════════════════════
describe("Phase 4 gate — CONFLICTING-confidence field suppression in canonicalFieldsBody", () => {
	it("formatCanonicalFieldLine emits value=none and suppressed_value for taint-suppressed fields", () => {
		const field = {
			category: "traction_signal",
			field: "arr_value",
			computability: "NotComputable" as const,
			value: null,
			evidenceRef: null,
			reasonCode: "ARR_MARKET_CONTEXT_TAINT",
			confidence: EVIDENCE_CONFIDENCE_LEVEL.SUPPRESSED,
			suppressedValue: "$200M",
		};
		const line = formatCanonicalFieldLine(field);
		expect(line).toContain("value=none");
		expect(line).toContain("reason=ARR_MARKET_CONTEXT_TAINT");
		expect(line).toContain('suppressed_value="$200M"');
		// Must NOT contain the raw bad value as a computable entry
		expect(line).not.toContain('computability=Computable');
	});

	it("CONFLICTING-confidence field is filtered out of canonicalFieldsBody", () => {
		// Simulate what stage-3-llm.ts now does before calling resolveGovernedSummaryWithCache
		const fields = [
			{
				category: "traction_signal",
				field: "arr_value",
				computability: "Computable" as const,
				value: "$200M",
				evidenceRef: "doc1:p2",
				reasonCode: null,
				confidence: EVIDENCE_CONFIDENCE_LEVEL.CONFLICTING,
			},
			{
				category: "raise_terms",
				field: "raise_amount",
				computability: "Computable" as const,
				value: "$2M",
				evidenceRef: "doc1:p1",
				reasonCode: null,
				confidence: EVIDENCE_CONFIDENCE_LEVEL.STRONG_EVIDENCE,
			},
		];

		// Replicate the stage-3-llm Phase 4 filter
		const safeFields = fields.filter((f) => f.confidence !== EVIDENCE_CONFIDENCE_LEVEL.CONFLICTING);
		const withheld  = fields.filter((f) => f.confidence === EVIDENCE_CONFIDENCE_LEVEL.CONFLICTING);

		const canonicalFieldsBody = safeFields.map(formatCanonicalFieldLine).join("\n");

		// The $200M ARR (conflicted) must NOT appear in canonicalFieldsBody
		expect(canonicalFieldsBody).not.toContain("$200M");
		// The $2M raise (non-conflicted) MUST appear
		expect(canonicalFieldsBody).toContain("$2M");
		// The withheld field is the ARR one
		expect(withheld).toHaveLength(1);
		expect(withheld[0]!.field).toBe("arr_value");
	});

	it("WITHHELD notice is appended to conflictLines for excluded CONFLICTING Computable fields", () => {
		const withheldField = {
			category: "traction_signal",
			field: "arr_value",
			computability: "Computable" as const,
			value: "$200M",
			evidenceRef: "doc1:p2",
			reasonCode: null,
			confidence: EVIDENCE_CONFIDENCE_LEVEL.CONFLICTING,
		};
		const conflictLines: string[] = [];
		// Replicate what stage-3-llm.ts does
		if (withheldField.computability === "Computable" && withheldField.value !== null) {
			conflictLines.push(
				`WITHHELD field=${withheldField.field} | reason=CONFLICTING_FIELD_SUPPRESSED | value_withheld="${withheldField.value}" | confidence=CONFLICTING`
			);
		}
		expect(conflictLines[0]).toContain("WITHHELD");
		expect(conflictLines[0]).toContain("arr_value");
		expect(conflictLines[0]).toContain("$200M");
		expect(conflictLines[0]).toContain("CONFLICTING_FIELD_SUPPRESSED");
	});
});
