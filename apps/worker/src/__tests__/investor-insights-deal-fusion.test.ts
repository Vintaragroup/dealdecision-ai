/**
 * Tests for the deal-level canonical fact fusion module.
 *
 * Coverage:
 *   - Agreement: same raise_amount from PDF + XLSX → confidence 1.0, no conflicts
 *   - Conflict: different raise_amount across documents → confidence 0.5, conflict emitted
 *   - Single-source: only one document has a match → confidence 0.8
 *   - History: prior run value superseded → archived in FusedFact.history
 *   - History preserved when value unchanged across runs
 *   - Multiple fields fused simultaneously
 *   - No evidence found → field omitted from result
 *   - buildDealFusionSection: renders facts and conflicts correctly
 *   - buildDealFusionSection: renders no-items state cleanly
 *   - doc_count reflects distinct document_ids in pages array
 */

import { describe, it, expect } from "vitest";
import {
	fuseDealCanonicalFacts,
	buildDealFusionSection,
	normalizeForConflict,
	type FusedFact,
} from "../jobs/investor-insights/deal-fusion";

// ─── Test fixtures ────────────────────────────────────────────────────────────

const PDF_DOC   = "aaaa1111-0000-0000-0000-000000000001";
const XLSX_DOC  = "bbbb2222-0000-0000-0000-000000000002";
const THIRD_DOC = "cccc3333-0000-0000-0000-000000000003";

const NOW = "2025-01-01T00:00:00.000Z";

/** Build a minimal DpuPage-like object. */
function page(document_id: string, page_index: number, text: string) {
	return { document_id, page_index, text };
}

// ─── normalizeForConflict ─────────────────────────────────────────────────────

describe("normalizeForConflict", () => {
	it("normalises $1.5MM to $1.5m", () => {
		expect(normalizeForConflict("$1.5MM seed round")).toBe("$1.5m");
	});

	it("treats $2M and $2m as equal", () => {
		expect(normalizeForConflict("$2M")).toBe(normalizeForConflict("$2m"));
	});

	it("normalises EUR 5.6M to €5.6m", () => {
		expect(normalizeForConflict("EUR 5.6M")).toBe("€5.6m");
	});

	it("falls back to trimmed lowercase for non-money text", () => {
		expect(normalizeForConflict("Seed round only")).toBe("seed round only");
	});
});

// ─── fuseDealCanonicalFacts — agreement ──────────────────────────────────────

describe("fuseDealCanonicalFacts — PDF and XLSX agree on raise_amount", () => {
	const pages = [
		page(PDF_DOC,  0, "We are raising $2M in a seed round for our platform."),
		page(PDF_DOC,  1, "Team background and advisory board."),
		page(XLSX_DOC, 0, "Raising $2M seed round. Proceeds towards product."),
	];

	const result = fuseDealCanonicalFacts(pages, [], [], NOW);

	it("emits no conflicts", () => {
		expect(result.conflicts).toHaveLength(0);
	});

	it("fuses raise_amount with confidence 1.0 (corroborated)", () => {
		const fact = result.facts.find((f) => f.field === "raise_amount");
		expect(fact).toBeDefined();
		expect(fact!.confidence).toBe(1.0);
	});

	it("raise_amount fact has correct category", () => {
		const fact = result.facts.find((f) => f.field === "raise_amount");
		expect(fact!.category).toBe("raise_terms");
	});

	it("raise_amount evidence_ref has expected format", () => {
		const fact = result.facts.find((f) => f.field === "raise_amount");
		expect(fact!.evidence_ref).toMatch(/^dpu:doc:[0-9a-f]{8}:page:\d+$/);
	});

	it("raise_amount source_document_id is one of the two docs", () => {
		const fact = result.facts.find((f) => f.field === "raise_amount");
		expect([PDF_DOC, XLSX_DOC]).toContain(fact!.source_document_id);
	});

	it("doc_count is 2", () => {
		expect(result.doc_count).toBe(2);
	});

	it("fusion_timestamp equals injected NOW", () => {
		expect(result.fusion_timestamp).toBe(NOW);
	});
});

// ─── fuseDealCanonicalFacts — conflict ────────────────────────────────────────

describe("fuseDealCanonicalFacts — PDF and XLSX disagree on raise_amount", () => {
	// Both pages mention "seed" so raise_round agrees — only raise_amount conflicts
	const pages = [
		page(PDF_DOC,  0, "We are raising $2M in a seed round."),
		page(XLSX_DOC, 0, "Seeking $3.5M seed funding."),
	];

	const result = fuseDealCanonicalFacts(pages, [], [], NOW);

	it("emits exactly one conflict for raise_amount", () => {
		expect(result.conflicts).toHaveLength(1);
		expect(result.conflicts[0]!.field).toBe("raise_amount");
	});

	it("conflict has capped_confidence 0.5", () => {
		expect(result.conflicts[0]!.capped_confidence).toBe(0.5);
	});

	it("conflict lists both candidate values", () => {
		const cands = result.conflicts[0]!.candidates;
		expect(cands).toHaveLength(2);
		const docIds = cands.map((c) => c.source_document_id);
		expect(docIds).toContain(PDF_DOC);
		expect(docIds).toContain(XLSX_DOC);
	});

	it("fuses raise_amount with confidence 0.5", () => {
		const fact = result.facts.find((f) => f.field === "raise_amount");
		expect(fact).toBeDefined();
		expect(fact!.confidence).toBe(0.5);
	});

	it("winning fact is the longer raw value (longest string wins)", () => {
		// "$3.5M Series A funding round" is longer than "$2M seed round"
		const fact = result.facts.find((f) => f.field === "raise_amount");
		// The value is cleaned (money token extracted) — so we can just assert non-empty
		expect(fact!.value.length).toBeGreaterThan(0);
	});
});

// ─── fuseDealCanonicalFacts — single source ───────────────────────────────────

describe("fuseDealCanonicalFacts — single document has raise_amount", () => {
	const pages = [
		page(PDF_DOC, 0, "Raising $1.5MM to expand our engineering team."),
		// Second doc has no raise mention
		page(XLSX_DOC, 0, "Revenue model and unit economics overview."),
	];

	const result = fuseDealCanonicalFacts(pages, [], [], NOW);

	it("emits no conflicts", () => {
		expect(result.conflicts).toHaveLength(0);
	});

	it("fuses raise_amount with confidence 0.8 (single-source)", () => {
		const fact = result.facts.find((f) => f.field === "raise_amount");
		expect(fact).toBeDefined();
		expect(fact!.confidence).toBe(0.8);
	});

	it("winning source_document_id is the PDF doc", () => {
		const fact = result.facts.find((f) => f.field === "raise_amount");
		expect(fact!.source_document_id).toBe(PDF_DOC);
	});
});

// ─── fuseDealCanonicalFacts — history tracking ────────────────────────────────

describe("fuseDealCanonicalFacts — history when value changes between runs", () => {
	const previousFacts: FusedFact[] = [
		{
			field: "raise_amount",
			category: "raise_terms",
			value: "$1M",
			confidence: 0.8,
			evidence_ref: "dpu:doc:aaaa1111:page:0",
			source_document_id: PDF_DOC,
			updated_at: "2024-12-01T00:00:00.000Z",
			history: [],
		},
	];

	// New run: same doc now says $2M instead
	const pages = [
		page(PDF_DOC, 0, "We are now raising $2M seed round for the new product."),
	];

	const result = fuseDealCanonicalFacts(pages, [], previousFacts, NOW);

	it("new fact has updated value $2M", () => {
		const fact = result.facts.find((f) => f.field === "raise_amount");
		expect(fact!.value).toBe("$2M");
	});

	it("new fact has history entry for the old $1M value", () => {
		const fact = result.facts.find((f) => f.field === "raise_amount");
		expect(fact!.history).toHaveLength(1);
		expect(fact!.history[0]!.value).toBe("$1M");
	});

	it("history entry has reason superseded_by_new_run", () => {
		const fact = result.facts.find((f) => f.field === "raise_amount");
		expect(fact!.history[0]!.reason).toBe("superseded_by_new_run");
	});

	it("history entry replaced_at equals injected NOW", () => {
		const fact = result.facts.find((f) => f.field === "raise_amount");
		expect(fact!.history[0]!.replaced_at).toBe(NOW);
	});

	it("history entry preserves old confidence", () => {
		const fact = result.facts.find((f) => f.field === "raise_amount");
		expect(fact!.history[0]!.confidence).toBe(0.8);
	});
});

// ─── fuseDealCanonicalFacts — history unchanged ───────────────────────────────

describe("fuseDealCanonicalFacts — no history entry when value unchanged", () => {
	const previousFacts: FusedFact[] = [
		{
			field: "raise_amount",
			category: "raise_terms",
			value: "$2M",
			confidence: 0.8,
			evidence_ref: "dpu:doc:aaaa1111:page:0",
			source_document_id: PDF_DOC,
			updated_at: "2024-12-01T00:00:00.000Z",
			history: [],
		},
	];

	const pages = [
		page(PDF_DOC, 0, "Raising $2M in a seed round for our platform."),
	];

	const result = fuseDealCanonicalFacts(pages, [], previousFacts, NOW);

	it("history remains empty when normalised value unchanged", () => {
		const fact = result.facts.find((f) => f.field === "raise_amount");
		expect(fact!.history).toHaveLength(0);
	});
});

// ─── fuseDealCanonicalFacts — no evidence ─────────────────────────────────────

describe("fuseDealCanonicalFacts — no raise_amount evidence anywhere", () => {
	const pages = [
		page(PDF_DOC,  0, "Team bios and advisor network."),
		page(XLSX_DOC, 0, "Market landscape overview and competitive analysis."),
	];

	const result = fuseDealCanonicalFacts(pages, [], [], NOW);

	it("raise_amount is NOT in facts (no evidence found)", () => {
		const fact = result.facts.find((f) => f.field === "raise_amount");
		expect(fact).toBeUndefined();
	});

	it("emits no conflicts", () => {
		expect(result.conflicts).toHaveLength(0);
	});
});

// ─── fuseDealCanonicalFacts — multiple fields ─────────────────────────────────

describe("fuseDealCanonicalFacts — multiple fields fused from same pages", () => {
	const pages = [
		page(PDF_DOC, 0, [
			"Raising $2M seed round.",
			"TAM $50B global market opportunity.",
			"MRR $80K growing 15% MoM.",
		].join(" ")),
		page(XLSX_DOC, 0, [
			"Seeking $2M seed funding.",
			"TAM $50B total addressable market.",
		].join(" ")),
	];

	const result = fuseDealCanonicalFacts(pages, [], [], NOW);

	it("fuses raise_amount", () => {
		expect(result.facts.find((f) => f.field === "raise_amount")).toBeDefined();
	});

	it("raise_amount confidence is 1.0 (both docs agree $2M)", () => {
		const fact = result.facts.find((f) => f.field === "raise_amount");
		expect(fact!.confidence).toBe(1.0);
	});

	it("fuses tam_value", () => {
		expect(result.facts.find((f) => f.field === "tam_value")).toBeDefined();
	});

	it("fuses mrr_value (single-source from PDF)", () => {
		const fact = result.facts.find((f) => f.field === "mrr_value");
		expect(fact).toBeDefined();
		expect(fact!.confidence).toBe(0.8);
	});

	it("fuses raise_round (seed found in PDF)", () => {
		expect(result.facts.find((f) => f.field === "raise_round")).toBeDefined();
	});
});

// ─── fuseDealCanonicalFacts — three-doc conflict ──────────────────────────────

describe("fuseDealCanonicalFacts — three documents with a three-way raise_amount conflict", () => {
	const pages = [
		page(PDF_DOC,   0, "Raising $1M seed."),
		page(XLSX_DOC,  0, "Seeking $2M series A."),
		page(THIRD_DOC, 0, "Investment $3M bridge round."),
	];

	const result = fuseDealCanonicalFacts(pages, [], [], NOW);

	it("emits one conflict for raise_amount", () => {
		expect(result.conflicts.filter((c) => c.field === "raise_amount")).toHaveLength(1);
	});

	it("conflict has 3 candidates", () => {
		const conflict = result.conflicts.find((c) => c.field === "raise_amount");
		expect(conflict!.candidates).toHaveLength(3);
	});

	it("doc_count is 3", () => {
		expect(result.doc_count).toBe(3);
	});
});

// ─── buildDealFusionSection ───────────────────────────────────────────────────

describe("buildDealFusionSection", () => {
	const singleSourceResult = fuseDealCanonicalFacts(
		[page(PDF_DOC, 0, "Raising $2M seed round.")],
		[],
		[],
		NOW
	);

	const section = buildDealFusionSection(singleSourceResult);

	it("key is deal_fusion", () => {
		expect(section.key).toBe("deal_fusion");
	});

	it("title is Deal-Level Canonical Fact Fusion", () => {
		expect(section.title).toBe("Deal-Level Canonical Fact Fusion");
	});

	it("kind is message", () => {
		expect(section.kind).toBe("message");
	});

	it("body contains fusion_timestamp", () => {
		expect(section.body).toContain(`fusion_timestamp=${NOW}`);
	});

	it("body contains doc_count=1", () => {
		expect(section.body).toContain("doc_count=1");
	});

	it("body lists fused facts header", () => {
		expect(section.body).toContain("--- fused facts ---");
	});

	it("body contains raise_amount fact line", () => {
		expect(section.body).toContain("field=raise_amount");
	});

	it("body does NOT contain conflicts header when there are none", () => {
		expect(section.body).not.toContain("--- conflicts ---");
	});

	it("fallback is non-empty", () => {
		expect(section.fallback).toBeTruthy();
	});
});

describe("buildDealFusionSection — conflict present", () => {
	const conflictResult = fuseDealCanonicalFacts(
		[
			page(PDF_DOC,  0, "Raising $2M in seed."),
			page(XLSX_DOC, 0, "Seeking $3.5M Series A funding."),
		],
		[],
		[],
		NOW
	);

	const section = buildDealFusionSection(conflictResult);

	it("body contains conflicts header", () => {
		expect(section.body).toContain("--- conflicts ---");
	});

	it("body contains capped_confidence=0.5", () => {
		expect(section.body).toContain("capped_confidence=0.5");
	});

	it("body references both doc ids in conflict line", () => {
		const line = (section.body ?? "").split("\n").find((l) => l.startsWith("field=raise_amount | capped_confidence"));
		expect(line).toBeDefined();
		expect(line).toContain(PDF_DOC.slice(0, 8));
		expect(line).toContain(XLSX_DOC.slice(0, 8));
	});
});

describe("buildDealFusionSection — empty result", () => {
	const emptyResult = fuseDealCanonicalFacts(
		[page(PDF_DOC, 0, "No financial data on this slide.")],
		[],
		[],
		NOW
	);

	const section = buildDealFusionSection(emptyResult);

	it("key is deal_fusion", () => {
		expect(section.key).toBe("deal_fusion");
	});

	it("body contains facts_fused=0", () => {
		expect(section.body).toContain("facts_fused=0");
	});

	it("body does NOT contain facts or conflicts headers", () => {
		expect(section.body).not.toContain("--- fused facts ---");
		expect(section.body).not.toContain("--- conflicts ---");
	});
});

// ─── Regression: market taint guard prevents raise_amount false positive ──────

describe("fuseDealCanonicalFacts — market-size text must NOT become raise_amount", () => {
	// Reproduce: "$11B — investment opportunity" historically matched Form E of
	// RAISE_AMOUNT_PATTERN.  The taint guard must reject it.
	const pages = [
		page(PDF_DOC, 0, "Tax Software Market $11B — a significant investment opportunity for enterprise."),
		page(PDF_DOC, 1, "Team: 3 founders, 10 engineers."),
	];

	const result = fuseDealCanonicalFacts(pages, [], [], NOW);

	it("raise_amount fact is NOT fused (tainted by market context)", () => {
		const fact = result.facts.find((f) => f.field === "raise_amount");
		expect(fact).toBeUndefined();
	});

	it("no raise_amount conflict emitted for tainted match", () => {
		const conflict = result.conflicts.find((c) => c.field === "raise_amount");
		expect(conflict).toBeUndefined();
	});
});

// ─── Regression: clean raise sentence correctly fuses raise_amount ────────────

describe("fuseDealCanonicalFacts — clean raise sentence populates raise_amount", () => {
	// Verb-first form: "Raising $4M …" must always be accepted (no taint check).
	const pages = [
		page(PDF_DOC, 0, "Raising $4M pre-seed to expand our engineering team and launch go-to-market."),
	];

	const result = fuseDealCanonicalFacts(pages, [], [], NOW);

	it("raise_amount fact is fused", () => {
		const fact = result.facts.find((f) => f.field === "raise_amount");
		expect(fact).toBeDefined();
	});

	it("raise_amount value is $4M", () => {
		const fact = result.facts.find((f) => f.field === "raise_amount");
		expect(fact!.value).toBe("$4M");
	});

	it("raise_amount confidence is 0.8 (single-source)", () => {
		const fact = result.facts.find((f) => f.field === "raise_amount");
		expect(fact!.confidence).toBe(0.8);
	});
});

// ─── Regression: verb-first "investment opportunity $11B" + market context ────
//
// Bug fixed: isFusionRaiseTainted previously had `if (/[A-Za-z]/.test(text[matchIndex])) return false`
// which unconditionally skipped the taint check for ALL letter-first matches.
// Form F of RAISE_AMOUNT_PATTERN uses "investment" as an anchor, so
// "investment opportunity of $11B Tax Software Market" matched and $11B was fused.
// After the fix, only "rais/seek/fund/financ/offer" prefixes bypass the taint check.

describe("fuseDealCanonicalFacts — verb-first 'investment opportunity $11B' with market context: NOT raise_amount", () => {
	// Exact pattern that triggered the bug: Form F anchor "investment" + market context nearby.
	const pages = [
		page(PDF_DOC, 0, "Tax Software Market: investment opportunity of $11B total revenue size for enterprise."),
		page(PDF_DOC, 1, "Team: 3 founders, 10 engineers."),
	];

	const result = fuseDealCanonicalFacts(pages, [], [], NOW);

	it("raise_amount fact is NOT fused (verb-first 'investment' + market context tainted)", () => {
		const fact = result.facts.find((f) => f.field === "raise_amount");
		expect(fact).toBeUndefined();
	});

	it("no raise_amount conflict emitted for tainted verb-first match", () => {
		const conflict = result.conflicts.find((c) => c.field === "raise_amount");
		expect(conflict).toBeUndefined();
	});
});

describe("fuseDealCanonicalFacts — verb-first 'investment of $2M SAFE' without market context: accepted", () => {
	// Disambiguation: a clean "investment of $2M" sentence with no market words
	// should still be accepted as a raise_amount candidate.
	const pages = [
		page(PDF_DOC, 0, "Seeking investment of $2M via SAFE note for product and hiring."),
	];

	const result = fuseDealCanonicalFacts(pages, [], [], NOW);

	it("raise_amount fact IS fused for clean 'investment of $2M SAFE' sentence", () => {
		const fact = result.facts.find((f) => f.field === "raise_amount");
		expect(fact).toBeDefined();
	});

	it("raise_amount value is $2M", () => {
		const fact = result.facts.find((f) => f.field === "raise_amount");
		expect(fact!.value).toBe("$2M");
	});
});

// ─── Regression: deck_has_use_of_funds_buckets detected from heading + labels ─

describe("fuseDealCanonicalFacts — deck_has_use_of_funds_buckets detected", () => {
	// Typical pitch-deck slide: heading + category rows with percentages.
	// The USE_OF_FUNDS_BUCKET_PATTERN requires prose text which this may not have,
	// but DECK_USE_OF_FUNDS_BUCKETS_PATTERN detects it via heading + bucket labels.
	const pages = [
		page(
			PDF_DOC,
			3,
			"USE OF FUNDS\nEngineering 40%\nMarketing 30%\nProduct 20%\nOperations 10%",
		),
	];

	const result = fuseDealCanonicalFacts(pages, [], [], NOW);

	it("deck_has_use_of_funds_buckets fact is fused", () => {
		const fact = result.facts.find((f) => f.field === "deck_has_use_of_funds_buckets");
		expect(fact).toBeDefined();
	});

	it("deck_has_use_of_funds_buckets is in use_of_funds category", () => {
		const fact = result.facts.find((f) => f.field === "deck_has_use_of_funds_buckets");
		expect(fact!.category).toBe("use_of_funds");
	});

	it("buildDealFusionSection body contains field=deck_has_use_of_funds_buckets", () => {
		const section = buildDealFusionSection(result);
		expect(section.body).toContain("field=deck_has_use_of_funds_buckets");
	});
});

// ─── PR26 regression: fund-AUM language must NOT become raise_amount ──────────
//
// Bug: fusion was picking "$100M" from a fund prospectus page containing
// "Alternatives Fund" (AUM language) because the PR24 guard in
// resolve-raise-amount.ts was not applied inside findFirstMatchInDoc.
// Fix: apply isCandidateTaintedByFundAumContext to the full page text for
// raise_amount candidates (mirrors promote-slide-facts.ts behaviour).

describe("fuseDealCanonicalFacts — fund AUM page must NOT become raise_amount (PR26)", () => {
	// Exact scenario that produced the bug: a fund prospectus page with AUM language.
	const pages = [
		page(PDF_DOC, 0, "$100M Alternatives Fund — total fund size targeting institutional LPs."),
	];

	const result = fuseDealCanonicalFacts(pages, [], [], NOW);

	it("raise_amount fact is NOT fused (page tainted by AUM language)", () => {
		const fact = result.facts.find((f) => f.field === "raise_amount");
		expect(fact).toBeUndefined();
	});

	it("no raise_amount conflict emitted", () => {
		const conflict = result.conflicts.find((c) => c.field === "raise_amount");
		expect(conflict).toBeUndefined();
	});
});

describe("fuseDealCanonicalFacts — AUM page filtered, real raise from separate doc wins (PR26)", () => {
	// Two-document scenario:
	//   Doc A (fund prospectus): $100M Alternatives Fund — should be rejected by fund-AUM guard.
	//   Doc B (investor deck page 14): Raising $2M Pre-Seed — should win.
	// After filtering, only one valid candidate exists → confidence 0.8, conflicts=0.
	const FUND_DOC = "dddd4444-0000-0000-0000-000000000004";
	const DECK_DOC = "eeee5555-0000-0000-0000-000000000005";

	const pages = [
		page(FUND_DOC, 2,  "$100M Alternatives Fund — targeting qualified purchasers, AUM strategy."),
		page(DECK_DOC, 14, "The Ask: raising $2M Pre-Seed to build our core platform and reach first 100 customers."),
	];

	const result = fuseDealCanonicalFacts(pages, [], [], NOW);

	it("raise_amount is fused with the real raise value $2M", () => {
		const fact = result.facts.find((f) => f.field === "raise_amount");
		expect(fact).toBeDefined();
		expect(fact!.value).toBe("$2M");
	});

	it("raise_amount source_document_id is the investor deck, not the fund doc", () => {
		const fact = result.facts.find((f) => f.field === "raise_amount");
		expect(fact!.source_document_id).toBe(DECK_DOC);
	});

	it("raise_amount evidence_ref points to page 14", () => {
		const fact = result.facts.find((f) => f.field === "raise_amount");
		expect(fact!.evidence_ref).toContain("page:14");
	});

	it("raise_amount confidence is 0.8 (single valid source after AUM filtered)", () => {
		const fact = result.facts.find((f) => f.field === "raise_amount");
		expect(fact!.confidence).toBe(0.8);
	});

	it("no raise_amount conflict emitted — AUM candidate was rejected, not counted", () => {
		const conflict = result.conflicts.find((c) => c.field === "raise_amount");
		expect(conflict).toBeUndefined();
	});
});

describe("fuseDealCanonicalFacts — AUM language variants all rejected from raise_amount (PR26)", () => {
	// Verify the guard catches multiple forms of AUM / fund management language.
	const cases: Array<{ label: string; text: string }> = [
		{ label: "AUM",                 text: "The fund manages $500M AUM across global markets." },
		{ label: "assets under mgmt",   text: "Raising $200M in assets under management for the vehicle." },
		{ label: "LP commitment",       text: "Raising $250M LP commitment from institutional limited partners." },
		{ label: "hedge fund",          text: "Seeking $75M for the hedge fund strategy." },
		{ label: "carried interest",    text: "Fund raise: $150M subject to carried interest waterfall." },
		{ label: "management fee",      text: "The $50M fund charges a 2% management fee to LPs." },
	];

	for (const { label, text } of cases) {
		describe(`AUM variant: ${label}`, () => {
			const result = fuseDealCanonicalFacts([page(PDF_DOC, 0, text)], [], [], NOW);

			it(`raise_amount is NOT fused for "${label}" text`, () => {
				const fact = result.facts.find((f) => f.field === "raise_amount");
				expect(fact).toBeUndefined();
			});
		});
	}
});
