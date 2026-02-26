/**
 * audit-investor-insights-coverage.test.ts
 *
 * Unit tests for the Portfolio DPU Coverage Audit helpers.
 * No DB connection required — all tests operate on in-memory data.
 */

import { describe, it, expect } from "vitest";

import {
	parseStoredSlots,
	semanticScan,
	STRICT_DETECTORS,
	runCoverageAudit,
	printCoverageMarkdown,
	extractHeaderLike,
	computeTighteningCandidates,
	selectNextSlot,
	type StrictPage,
	type ParsedStoredSlot,
	type CoverageAuditReport,
	type TighteningCandidate,
	type DealCoverageResult,
} from "../audit-investor-insights-coverage";
import type { Pool } from "pg";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makePage(
	documentId: string,
	pageIndex: number,
	text: string
): StrictPage {
	return { document_id: documentId, page_index: pageIndex, text, text_raw: text };
}

/** Minimal mock pool that returns preset data for AUDIT_QUERY_SQL calls. */
function mockPool(overrides: {
	dpu_pages?: Array<{ document_id: string; page_index: number; page_text: string | null }>;
	report?: {
		status: string;
		engine_version: string;
		upstream_fingerprint: string;
		render_package: unknown;
		gate_state: unknown;
		updated_at: string;
	} | null;
}): Pool {
	const rows = [
		{
			documents: null,
			dpu_pages: overrides.dpu_pages ?? null,
			report:    overrides.report === undefined ? null : overrides.report,
		},
	];
	return {
		query: () => Promise.resolve({ rows, rowCount: rows.length }),
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
	} as any as Pool;
}

// ═══════════════════════════════════════════════════════════════════════
// parseStoredSlots
// ═══════════════════════════════════════════════════════════════════════

describe("parseStoredSlots", () => {
	it("parses a Computable slot line", () => {
		const body = `raise_terms: Computable | value="raising approximately $10M" | evidence=dpu:doc:6af4720f:page:33 | reason=none`;
		const slots = parseStoredSlots(body);
		const rt = slots.get("raise_terms");
		expect(rt?.status).toBe("Computable");
		expect(rt?.value).toBe("raising approximately $10M");
		expect(rt?.evidence).toBe("dpu:doc:6af4720f:page:33");
	});

	it("parses a NotComputable slot line", () => {
		const body = `use_of_funds: NotComputable | value=none | evidence=none | reason=NO_USE_OF_FUNDS_MENTION`;
		const slots = parseStoredSlots(body);
		const uof = slots.get("use_of_funds");
		expect(uof?.status).toBe("NotComputable");
		expect(uof?.value).toBeNull();
		expect(uof?.evidence).toBeNull();
	});

	it("parses a multi-line body with mixed results", () => {
		const body = [
			`raise_terms: Computable | value="Raising $2M" | evidence=dpu:doc:aabbccdd:page:5 | reason=none`,
			`market_claims: NotComputable | value=none | evidence=none | reason=NO_MARKET_CLAIM_MENTION`,
			`traction_signal: NotComputable | value=none | evidence=none | reason=NO_TRACTION_SIGNAL_MENTION`,
			`valuation_terms: NotComputable | value=none | evidence=none | reason=NO_VALUATION_MENTION`,
			`use_of_funds: NotComputable | value=none | evidence=none | reason=NO_USE_OF_FUNDS_MENTION`,
		].join("\n");
		const slots = parseStoredSlots(body);
		expect(slots.size).toBe(5);
		expect(slots.get("raise_terms")?.status).toBe("Computable");
		expect(slots.get("market_claims")?.status).toBe("NotComputable");
	});

	it("returns empty map for empty body", () => {
		const slots = parseStoredSlots("");
		expect(slots.size).toBe(0);
	});

	it("ignores lines without a colon", () => {
		const body = `raise_terms: Computable | value="$1M" | evidence=dpu:doc:aabbccdd:page:1 | reason=none\ngarbage line\nmarket_claims: NotComputable | value=none | evidence=none | reason=NO_MARKET_CLAIM_MENTION`;
		const slots = parseStoredSlots(body);
		expect(slots.size).toBe(2);
	});
});

// ═══════════════════════════════════════════════════════════════════════
// STRICT_DETECTORS — raise_terms (with _RAISE_ADVERB)
// ═══════════════════════════════════════════════════════════════════════

describe("STRICT_DETECTORS — raise_terms", () => {
	const detector = STRICT_DETECTORS.find((d) => d.name === "raise_terms")!;

	it("detects simple raise: 'Raising $2M seed round'", () => {
		const pages = [makePage("aabb0000-0000-0000-0000-000000000000", 1, "Raising $2M seed round")];
		const result = detector.detect(pages);
		expect(result.computable).toBe(true);
		expect(result.value).toMatch(/\$2M/);
	});

	it("detects raise with adverb: 'raising approximately $10M' (3ICE fix)", () => {
		const pages = [makePage("aabb0000-0000-0000-0000-000000000000", 33, "We are raising approximately $10M")];
		const result = detector.detect(pages);
		expect(result.computable).toBe(true);
		expect(result.value).toMatch(/approximately/i);
	});

	it("detects raise with adverb: 'seeking about $500K'", () => {
		const pages = [makePage("aabb0000-0000-0000-0000-000000000000", 1, "We are seeking about $500K to accelerate growth")];
		const result = detector.detect(pages);
		expect(result.computable).toBe(true);
	});

	it("detects raise range: 'raising $2M–$4M'", () => {
		const pages = [makePage("aabb0000-0000-0000-0000-000000000000", 1, "We are raising $2M–$4M this round")];
		const result = detector.detect(pages);
		expect(result.computable).toBe(true);
		expect(result.value).toMatch(/\$2M/);
	});

	it("returns NotComputable when no raise text present", () => {
		const pages = [makePage("aabb0000-0000-0000-0000-000000000000", 1, "Our product is a SaaS platform for HR teams.")];
		const result = detector.detect(pages);
		expect(result.computable).toBe(false);
	});

	it("returns NotComputable for empty pages", () => {
		const result = detector.detect([]);
		expect(result.computable).toBe(false);
	});

	it("sets evidence ref in correct format: dpu:doc:<8hex>:page:<n>", () => {
		const pages = [makePage("6af4720f-0000-0000-0000-000000000000", 33, "raising approximately $10M in seed")];
		const result = detector.detect(pages);
		expect(result.evidence).toBe("dpu:doc:6af4720f:page:33");
	});
});

// ═══════════════════════════════════════════════════════════════════════
// STRICT_DETECTORS — market_claims, traction_signal, valuation_terms, use_of_funds
// ═══════════════════════════════════════════════════════════════════════

describe("STRICT_DETECTORS — market_claims", () => {
	const detector = STRICT_DETECTORS.find((d) => d.name === "market_claims")!;

	// ── Existing forms (regression guard) ──────────────────────────────
	it("detects TAM reference: 'TAM $50B opportunity'", () => {
		const pages = [makePage("aaaa0000-0000-0000-0000-000000000000", 1, "TAM $50B opportunity in fintech")];
		const result = detector.detect(pages);
		expect(result.computable).toBe(true);
	});

	it("detects SAM dollar-first: '$12.4M TAM'", () => {
		const pages = [makePage("aaaa0001-0000-0000-0000-000000000000", 2, "Sportsbook Executive General Managers | $12.4M TAM Sportsbook Operators $12M TAM")];
		const result = detector.detect(pages);
		expect(result.computable).toBe(true);
	});

	it("detects '$600-900M TAM SAM SOM'", () => {
		const pages = [makePage("aaaa0002-0000-0000-0000-000000000000", 0, "$600-900M TAM SAM SOM Alternative Investment Platform")];
		const result = detector.detect(pages);
		expect(result.computable).toBe(true);
	});

	it("returns NotComputable for no market text", () => {
		const pages = [makePage("aaaa0000-0000-0000-0000-000000000000", 1, "Our team has 10 years of experience.")];
		const result = detector.detect(pages);
		expect(result.computable).toBe(false);
	});

	// ── Form C: "market size[s]" keyword-first ────────────────────────
	// Audit evidence: Carmoola page 9 — "Used Car Finance Market Sizes (USD) $212B"
	it("detects 'Market Sizes (USD)' followed by dollar amount (Form C — Carmoola evidence)", () => {
		const pages = [makePage("da96b5a9-e5b2-46c1-a6ef-da037f876426", 9, "2024 Used Car Finance Market Sizes (USD) $212B D2C seg $770B")];
		const result = detector.detect(pages);
		expect(result.computable).toBe(true);
	});

	it("detects 'Market Size: $5B' (Form C)", () => {
		const pages = [makePage("aaaa0003-0000-0000-0000-000000000000", 1, "Market Size: $5B growing at 12% CAGR")];
		const result = detector.detect(pages);
		expect(result.computable).toBe(true);
	});

	it("detects 'market size of $1.2B' (Form C)", () => {
		const pages = [makePage("aaaa0004-0000-0000-0000-000000000000", 1, "total addressable market size of $1.2B for used car finance")];
		const result = detector.detect(pages);
		expect(result.computable).toBe(true);
	});

	// ── Form D: dollar-first → "market size[s]" ──────────────────────
	// Audit evidence: Carmoola — "$212B D2C seg er 2024 Used Car Finance Market Sizes"
	it("detects dollar-first 'Market Sizes' (Form D — Carmoola text order)", () => {
		const pages = [makePage("da96b5a9-e5b2-46c1-a6ef-da037f876426", 9, "$212B D2C seg er 2024 Used Car Finance Market Sizes (USD)")];
		const result = detector.detect(pages);
		expect(result.computable).toBe(true);
	});

	it("detects '$770M market size for automotive' (Form D)", () => {
		const pages = [makePage("aaaa0005-0000-0000-0000-000000000000", 3, "$770M market size for automotive finance in 2025")];
		const result = detector.detect(pages);
		expect(result.computable).toBe(true);
	});

	// ── Negative controls for Forms C/D ──────────────────────────────
	it("does NOT trigger on 'Market Size' header with no dollar amount", () => {
		const pages = [makePage("aaaa0006-0000-0000-0000-000000000000", 0, "Target Demo | Market Size | Go-to-Market Strategy")];
		const result = detector.detect(pages);
		expect(result.computable).toBe(false);
	});

	it("does NOT trigger on 'market sizing is important' prose (no dollar)", () => {
		const pages = [makePage("aaaa0007-0000-0000-0000-000000000000", 1, "Understanding market sizing is important before building your GTM.")];
		const result = detector.detect(pages);
		expect(result.computable).toBe(false);
	});

	it("does NOT trigger on '$500 budget' without market size keyword", () => {
		const pages = [makePage("aaaa0008-0000-0000-0000-000000000000", 2, "$500 budget allocated to marketing this quarter")];
		const result = detector.detect(pages);
		expect(result.computable).toBe(false);
	});
});

describe("STRICT_DETECTORS — traction_signal", () => {
	const detector = STRICT_DETECTORS.find((d) => d.name === "traction_signal")!;

	it("detects ARR: 'ARR $1.2M'", () => {
		const pages = [makePage("bbbb0000-0000-0000-0000-000000000000", 2, "Our ARR $1.2M growing 20% MoM")];
		const result = detector.detect(pages);
		expect(result.computable).toBe(true);
	});

	it("detects percentage traction: '85% demo-to-close rate'", () => {
		const pages = [makePage("bbbb0000-0000-0000-0000-000000000000", 3, "85% demo-to-close rate across enterprise")];
		const result = detector.detect(pages);
		expect(result.computable).toBe(true);
	});

	it("returns NotComputable for no traction text", () => {
		const pages = [makePage("bbbb0000-0000-0000-0000-000000000000", 1, "Founded in 2020 by two engineers.")];
		const result = detector.detect(pages);
		expect(result.computable).toBe(false);
	});
});

describe("STRICT_DETECTORS — valuation_terms", () => {
	const detector = STRICT_DETECTORS.find((d) => d.name === "valuation_terms")!;

	it("detects 'post-money valuation'", () => {
		const pages = [makePage("cccc0000-0000-0000-0000-000000000000", 1, "post-money valuation of $20M")];
		const result = detector.detect(pages);
		expect(result.computable).toBe(true);
	});
});

describe("STRICT_DETECTORS — use_of_funds", () => {
	const detector = STRICT_DETECTORS.find((d) => d.name === "use_of_funds")!;

	// ── Existing forms (regression guard) ──────────────────────────────
	it("detects 'use of funds'", () => {
		const pages = [makePage("dddd0000-0000-0000-0000-000000000000", 1, "Use of funds: 40% engineering, 40% sales")];
		const result = detector.detect(pages);
		expect(result.computable).toBe(true);
	});

	it("detects 'use of proceeds'", () => {
		const pages = [makePage("dddd0000-0000-0000-0000-000000000000", 1, "The proceeds will be used for product development")];
		const result = detector.detect(pages);
		expect(result.computable).toBe(true);
	});

	it("detects 'allocation of proceeds'", () => {
		const pages = [makePage("dddd0000-0000-0000-0000-000000000000", 1, "Allocation of proceeds: 50% sales, 30% product, 20% ops")];
		const result = detector.detect(pages);
		expect(result.computable).toBe(true);
	});

	// ── Form U1: "use of capital" ─────────────────────────────────────
	// Audit evidence: common slide-header variant on investor decks.
	it("detects 'use of capital' (Form U1)", () => {
		const pages = [makePage("dddd0001-0000-0000-0000-000000000000", 0, "Use of Capital marketing 40% product 30% ops 30%")];
		const result = detector.detect(pages);
		expect(result.computable).toBe(true);
	});

	it("detects 'use of capital' case-insensitively (Form U1)", () => {
		const pages = [makePage("dddd0001-0000-0000-0000-000000000000", 1, "USE OF CAPITAL. Below is how we plan to deploy the raise.")];
		const result = detector.detect(pages);
		expect(result.computable).toBe(true);
	});

	// ── Form U2: "allocation of funds" ───────────────────────────────
	// Audit evidence: referenced in prompt; logical complement of "allocation of proceeds".
	it("detects 'allocation of funds' (Form U2)", () => {
		const pages = [makePage("dddd0002-0000-0000-0000-000000000000", 0, "allocation of funds: $2M engineering $1M marketing $500K G&A")];
		const result = detector.detect(pages);
		expect(result.computable).toBe(true);
	});

	// ── Form U3: "capital allocation" ────────────────────────────────
	// Audit evidence: Palm ("CAPITAL ALLOCATION __") and Palm3 ("Capital Allocation Detail.")
	it("detects 'CAPITAL ALLOCATION' slide header (Form U3 — Palm audit evidence)", () => {
		const pages = [makePage("c4f10092-1c94-4116-b4f0-78874868f92b", 12, "CAPITAL ALLOCATION Strategic Hires To strategically recognize our growth opportunity")];
		const result = detector.detect(pages);
		expect(result.computable).toBe(true);
	});

	it("detects 'Capital Allocation Detail' section header (Form U3 — Palm3 audit evidence)", () => {
		const pages = [makePage("5c8c7d6e-c992-4be7-8b10-268eac36f663", 18, "Capital Allocation Detail. Omnichannel Marketing/Branding Palm's existing growth has come")];
		const result = detector.detect(pages);
		expect(result.computable).toBe(true);
	});

	it("detects 'capital allocation' lower-case (Form U3)", () => {
		const pages = [makePage("dddd0003-0000-0000-0000-000000000000", 3, "our capital allocation plan covers product development, sales and marketing")];
		const result = detector.detect(pages);
		expect(result.computable).toBe(true);
	});

	// ── Form U4: "funds will be (used|deployed|allocated)" ───────────
	it("detects 'funds will be used' (Form U4)", () => {
		const pages = [makePage("dddd0004-0000-0000-0000-000000000000", 0, "The funds will be used primarily for engineering hiring and GTM.")];
		const result = detector.detect(pages);
		expect(result.computable).toBe(true);
	});

	it("detects 'funds will be deployed' (Form U4)", () => {
		const pages = [makePage("dddd0004-0000-0000-0000-000000000000", 1, "Funds will be deployed toward R&D expansion and market entry.")];
		const result = detector.detect(pages);
		expect(result.computable).toBe(true);
	});

	it("detects 'funds will be allocated' (Form U4)", () => {
		const pages = [makePage("dddd0004-0000-0000-0000-000000000000", 2, "Raise proceeds: funds will be allocated as follows: 60% product 40% sales.")];
		const result = detector.detect(pages);
		expect(result.computable).toBe(true);
	});

	// ── Negative controls — must NOT match ───────────────────────────
	it("does NOT match 'equity allocation' (not a use-of-funds phrase)", () => {
		const pages = [makePage("dddd0099-0000-0000-0000-000000000000", 0, "equity allocation among founders: 60/40 split")];
		const result = detector.detect(pages);
		expect(result.computable).toBe(false);
	});

	it("does NOT match 'budget allocation for Q3' (departmental budget, not use of raise)", () => {
		const pages = [makePage("dddd0099-0000-0000-0000-000000000000", 1, "budget allocation for Q3 is fixed at $300K across R&D and ops")];
		const result = detector.detect(pages);
		expect(result.computable).toBe(false);
	});

	it("does NOT match 'marketing spend' alone (no use-of-funds anchor)", () => {
		const pages = [makePage("dddd0099-0000-0000-0000-000000000000", 2, "increased marketing spend drove 43% growth in August")];
		const result = detector.detect(pages);
		expect(result.computable).toBe(false);
	});

	it("does NOT match 'use of proprietary technology' (non-funds form)", () => {
		const pages = [makePage("dddd0099-0000-0000-0000-000000000000", 3, "use of proprietary technology enables 10x faster processing")];
		const result = detector.detect(pages);
		expect(result.computable).toBe(false);
	});

	it("does NOT match 'capital expenditure' (capex, not allocation of raise)", () => {
		const pages = [makePage("dddd0099-0000-0000-0000-000000000000", 4, "capital expenditure is projected at $200K for hardware")];
		const result = detector.detect(pages);
		expect(result.computable).toBe(false);
	});
});

// ═══════════════════════════════════════════════════════════════════════
// semanticScan — DETECTOR_GAP vs TRUE_ABSENCE
// ═══════════════════════════════════════════════════════════════════════

describe("semanticScan", () => {
	it("returns candidate pages matching raise keywords", () => {
		const pages = [
			makePage("aaaa0000-0000-0000-0000-000000000000", 1, "We plan to raise additional capital next quarter"),
			makePage("aaaa0000-0000-0000-0000-000000000000", 2, "Our product roadmap is focused on AI integrations"),
		];
		const candidates = semanticScan("raise_terms", pages);
		expect(candidates.length).toBeGreaterThan(0);
		const refs = candidates.map((c) => c.ref);
		expect(refs).toContain("dpu:doc:aaaa0000:page:1");
		expect(refs).not.toContain("dpu:doc:aaaa0000:page:2");
	});

	it("returns empty array when no keywords match (TRUE_ABSENCE signal)", () => {
		const pages = [
			makePage("aaaa0000-0000-0000-0000-000000000000", 1, "Our team is composed of experienced engineers"),
		];
		const candidates = semanticScan("use_of_funds", pages);
		expect(candidates.length).toBe(0);
	});

	it("includes triggered keywords in CandidatePage", () => {
		const pages = [
			makePage("bbbb0000-0000-0000-0000-000000000000", 5, "TAM is estimated at $2 billion for this market"),
		];
		const candidates = semanticScan("market_claims", pages);
		expect(candidates.length).toBeGreaterThan(0);
		const kws = candidates[0]!.triggeredKeywords;
		expect(kws.some((k) => k.toLowerCase().includes("tam") || k.toLowerCase().includes("billion"))).toBe(true);
	});

	it("returns empty array for unknown slot name", () => {
		const pages = [makePage("aaaa0000-0000-0000-0000-000000000000", 1, "Some text about anything at all")];
		const candidates = semanticScan("unknown_slot", pages);
		expect(candidates.length).toBe(0);
	});

	it("returns empty array for empty pages list", () => {
		const candidates = semanticScan("raise_terms", []);
		expect(candidates.length).toBe(0);
	});
});

// ═══════════════════════════════════════════════════════════════════════
// runCoverageAudit — integration-style tests with mock pool
// ═══════════════════════════════════════════════════════════════════════

describe("runCoverageAudit", () => {
	const DEAL_ID = "61ef36dd-391a-4a4e-b30b-1f5d1f19f91e";
	const LABELS = { [DEAL_ID]: "3ICE" };

	it("classifies OK_MATCH when stored and recomputed both Computable", async () => {
		const storedBody = [
			`raise_terms: Computable | value="raising approximately $10M" | evidence=dpu:doc:6af4720f:page:33 | reason=none`,
			`market_claims: NotComputable | value=none | evidence=none | reason=NO_MARKET_CLAIM_MENTION`,
			`traction_signal: NotComputable | value=none | evidence=none | reason=NO_TRACTION_SIGNAL_MENTION`,
			`valuation_terms: NotComputable | value=none | evidence=none | reason=NO_VALUATION_MENTION`,
			`use_of_funds: NotComputable | value=none | evidence=none | reason=NO_USE_OF_FUNDS_MENTION`,
		].join("\n");

		const pool = mockPool({
			dpu_pages: [
				{ document_id: "6af4720f-0000-0000-0000-000000000000", page_index: 33, page_text: "We are raising approximately $10M in seed funding" },
			],
			report: {
				status: "complete",
				engine_version: "v1",
				upstream_fingerprint: "abc",
				render_package: {
					sections: [
						{ key: "insight_slots", title: "Slots", kind: "message", body: storedBody, fallback: "" },
					],
				},
				gate_state: null,
				updated_at: "2026-01-01T00:00:00",
			},
		});

		const report = await runCoverageAudit(pool, [DEAL_ID], { labels: LABELS });
		const deal = report.deals[0]!;
		const rt = deal.slot_results.find((s) => s.slot === "raise_terms")!;
		expect(rt.classification).toBe("OK_MATCH");
		expect(rt.stored_status).toBe("Computable");
		expect(rt.recomputed_status).toBe("Computable");
	});

	it("classifies STALE_STORED when stored=NotComputable but recomputed=Computable", async () => {
		const storedBody = [
			`raise_terms: NotComputable | value=none | evidence=none | reason=NO_RAISE_MENTION`,
			`market_claims: NotComputable | value=none | evidence=none | reason=NO_MARKET_CLAIM_MENTION`,
			`traction_signal: NotComputable | value=none | evidence=none | reason=NO_TRACTION_SIGNAL_MENTION`,
			`valuation_terms: NotComputable | value=none | evidence=none | reason=NO_VALUATION_MENTION`,
			`use_of_funds: NotComputable | value=none | evidence=none | reason=NO_USE_OF_FUNDS_MENTION`,
		].join("\n");

		const pool = mockPool({
			dpu_pages: [
				{
					document_id: "6af4720f-0000-0000-0000-000000000000",
					page_index: 33,
					// This now matches the updated RAISE_AMOUNT_PATTERN with _RAISE_ADVERB
					page_text: "We are raising approximately $10M in seed funding",
				},
			],
			report: {
				status: "complete",
				engine_version: "v1",
				upstream_fingerprint: "abc",
				render_package: {
					sections: [
						{ key: "insight_slots", title: "Slots", kind: "message", body: storedBody, fallback: "" },
					],
				},
				gate_state: null,
				updated_at: "2026-01-01T00:00:00",
			},
		});

		const report = await runCoverageAudit(pool, [DEAL_ID], { labels: LABELS });
		const deal = report.deals[0]!;
		const rt = deal.slot_results.find((s) => s.slot === "raise_terms")!;
		expect(rt.classification).toBe("STALE_STORED");
		expect(deal.summary.stale_stored).toBeGreaterThan(0);
	});

	it("classifies DETECTOR_GAP when both NotComputable but semantic keywords present", async () => {
		const storedBody = [
			`raise_terms: NotComputable | value=none | evidence=none | reason=NO_RAISE_MENTION`,
			`market_claims: NotComputable | value=none | evidence=none | reason=NO_MARKET_CLAIM_MENTION`,
			`traction_signal: NotComputable | value=none | evidence=none | reason=NO_TRACTION_SIGNAL_MENTION`,
			`valuation_terms: NotComputable | value=none | evidence=none | reason=NO_VALUATION_MENTION`,
			`use_of_funds: NotComputable | value=none | evidence=none | reason=NO_USE_OF_FUNDS_MENTION`,
		].join("\n");

		const pool = mockPool({
			dpu_pages: [
				{
					document_id: "aaaa0000-0000-0000-0000-000000000000",
					page_index: 1,
					// Contains "raise" keyword but not in the strict pattern form
					page_text: "We will raise more funds in the future when conditions improve",
				},
			],
			report: {
				status: "complete",
				engine_version: "v1",
				upstream_fingerprint: "abc",
				render_package: {
					sections: [
						{ key: "insight_slots", title: "Slots", kind: "message", body: storedBody, fallback: "" },
					],
				},
				gate_state: null,
				updated_at: "2026-01-01T00:00:00",
			},
		});

		const report = await runCoverageAudit(pool, [DEAL_ID], { labels: LABELS });
		const deal = report.deals[0]!;
		const rt = deal.slot_results.find((s) => s.slot === "raise_terms")!;
		// "raise" keyword should trigger semantic scan → DETECTOR_GAP
		expect(rt.classification).toBe("DETECTOR_GAP");
		expect(rt.candidate_pages.length).toBeGreaterThan(0);
		expect(deal.summary.detector_gap).toBeGreaterThan(0);
	});

	it("classifies TRUE_ABSENCE when both NotComputable and no semantic keywords", async () => {
		const storedBody = [
			`raise_terms: NotComputable | value=none | evidence=none | reason=NO_RAISE_MENTION`,
			`market_claims: NotComputable | value=none | evidence=none | reason=NO_MARKET_CLAIM_MENTION`,
			`traction_signal: NotComputable | value=none | evidence=none | reason=NO_TRACTION_SIGNAL_MENTION`,
			`valuation_terms: NotComputable | value=none | evidence=none | reason=NO_VALUATION_MENTION`,
			`use_of_funds: NotComputable | value=none | evidence=none | reason=NO_USE_OF_FUNDS_MENTION`,
		].join("\n");

		const pool = mockPool({
			dpu_pages: [
				{
					document_id: "bbbb0000-0000-0000-0000-000000000000",
					page_index: 1,
					page_text: "Our mission is to create a better world through technology",
				},
			],
			report: {
				status: "complete",
				engine_version: "v1",
				upstream_fingerprint: "abc",
				render_package: {
					sections: [
						{ key: "insight_slots", title: "Slots", kind: "message", body: storedBody, fallback: "" },
					],
				},
				gate_state: null,
				updated_at: "2026-01-01T00:00:00",
			},
		});

		const report = await runCoverageAudit(pool, [DEAL_ID], { labels: LABELS });
		const deal = report.deals[0]!;
		const rt = deal.slot_results.find((s) => s.slot === "use_of_funds")!;
		// No use-of-funds keywords → TRUE_ABSENCE
		expect(rt.classification).toBe("TRUE_ABSENCE");
	});

	it("classifies MISSING_REPORT when no investor_insight_reports row", async () => {
		const pool = mockPool({ dpu_pages: [], report: null });
		const report = await runCoverageAudit(pool, [DEAL_ID], { labels: LABELS });
		const deal = report.deals[0]!;
		expect(deal.audit_status).toBe("no_report");
		for (const sr of deal.slot_results) {
			expect(sr.classification).toBe("MISSING_REPORT");
		}
	});

	it("classifies DPU_LOAD_FAILED when no DPU pages and a report exists", async () => {
		const storedBody = `raise_terms: Computable | value="$5M" | evidence=dpu:doc:aabb0000:page:1 | reason=none\nmarket_claims: NotComputable | value=none | evidence=none | reason=NO_MARKET_CLAIM_MENTION\ntraction_signal: NotComputable | value=none | evidence=none | reason=NO_TRACTION_SIGNAL_MENTION\nvaluation_terms: NotComputable | value=none | evidence=none | reason=NO_VALUATION_MENTION\nuse_of_funds: NotComputable | value=none | evidence=none | reason=NO_USE_OF_FUNDS_MENTION`;
		const pool = mockPool({
			dpu_pages: [], // zero pages
			report: {
				status: "complete",
				engine_version: "v1",
				upstream_fingerprint: "abc",
				render_package: {
					sections: [{ key: "insight_slots", title: "Slots", kind: "message", body: storedBody, fallback: "" }],
				},
				gate_state: null,
				updated_at: "2026-01-01T00:00:00",
			},
		});

		const report = await runCoverageAudit(pool, [DEAL_ID], { labels: LABELS });
		const deal = report.deals[0]!;
		expect(deal.audit_status).toBe("dpu_empty");
		for (const sr of deal.slot_results) {
			expect(sr.classification).toBe("DPU_LOAD_FAILED");
		}
	});

	it("multi-doc scenario: pages from different documents are all scanned", async () => {
		const storedBody = `raise_terms: NotComputable | value=none | evidence=none | reason=NO_RAISE_MENTION\nmarket_claims: NotComputable | value=none | evidence=none | reason=NO_MARKET_CLAIM_MENTION\ntraction_signal: NotComputable | value=none | evidence=none | reason=NO_TRACTION_SIGNAL_MENTION\nvaluation_terms: NotComputable | value=none | evidence=none | reason=NO_VALUATION_MENTION\nuse_of_funds: NotComputable | value=none | evidence=none | reason=NO_USE_OF_FUNDS_MENTION`;
		const pool = mockPool({
			dpu_pages: [
				// PDF doc — raise info on page 5
				{ document_id: "pdf00000-0000-0000-0000-000000000000", page_index: 5, page_text: "Raising $3M Series A" },
				// XLSX doc — no raise info
				{ document_id: "xlsx0000-0000-0000-0000-000000000000", page_index: 1, page_text: "Revenue: $1.2M ARR $100K" },
			],
			report: {
				status: "complete",
				engine_version: "v1",
				upstream_fingerprint: "abc",
				render_package: {
					sections: [{ key: "insight_slots", title: "Slots", kind: "message", body: storedBody, fallback: "" }],
				},
				gate_state: null,
				updated_at: "2026-01-01T00:00:00",
			},
		});

		const report = await runCoverageAudit(pool, [DEAL_ID], { labels: LABELS });
		const deal = report.deals[0]!;
		const rt = deal.slot_results.find((s) => s.slot === "raise_terms")!;
		// Should find raise in PDF doc → STALE_STORED
		expect(rt.classification).toBe("STALE_STORED");
		expect(rt.recomputed_status).toBe("Computable");

		const ts = deal.slot_results.find((s) => s.slot === "traction_signal")!;
		// ARR $100K is in XLSX doc → should find traction
		expect(ts.recomputed_status).toBe("Computable");
		expect(ts.classification).toBe("STALE_STORED");
	});

	it("produces correct portfolio summary counts", async () => {
		const pool = mockPool({ dpu_pages: [], report: null });
		const report = await runCoverageAudit(pool, [DEAL_ID, DEAL_ID], { labels: LABELS });
		expect(report.portfolio_summary.total_deals).toBe(2);
		expect(report.portfolio_summary.deals_ok).toBe(0);
	});
});

// ═══════════════════════════════════════════════════════════════════════
// printCoverageMarkdown
// ═══════════════════════════════════════════════════════════════════════

describe("printCoverageMarkdown", () => {
	it("includes portfolio summary header", async () => {
		const pool = mockPool({ dpu_pages: [], report: null });
		const report = await runCoverageAudit(pool, ["61ef36dd-391a-4a4e-b30b-1f5d1f19f91e"], { labels: { "61ef36dd-391a-4a4e-b30b-1f5d1f19f91e": "3ICE" } });
		const md = printCoverageMarkdown(report);
		expect(md).toContain("# Investor Insights");
		expect(md).toContain("Portfolio Summary");
		expect(md).toContain("Slot Breakdown");
		expect(md).toContain("Per-Deal Results");
		expect(md).toContain("Legend");
	});

	it("includes generated_at in the Markdown header", async () => {
		const report: CoverageAuditReport = {
			generated_at: "2026-01-01T00:00:00.000Z",
			meta: { selected_slot: null, selected_slot_rationale: "no DETECTOR_GAP slots found" },
			deals: [],
			portfolio_summary: { total_deals: 0, deals_ok: 0, deals_with_gaps: 0, deals_with_stale: 0, deals_with_regressions: 0, slot_breakdown: [] },
			tightening_candidates: [],
		};
		const md = printCoverageMarkdown(report);
		expect(md).toContain("**Generated:** 2026-01-01T00:00:00.000Z");
	});

	it("is non-empty string", async () => {
		const pool = mockPool({ dpu_pages: [], report: null });
		const report = await runCoverageAudit(pool, ["61ef36dd-391a-4a4e-b30b-1f5d1f19f91e"], {});
		const md = printCoverageMarkdown(report);
		expect(typeof md).toBe("string");
		expect(md.length).toBeGreaterThan(100);
	});
});

// ═══════════════════════════════════════════════════════════════════════
// extractHeaderLike
// ═══════════════════════════════════════════════════════════════════════

describe("extractHeaderLike", () => {
	// ── Positive cases ─────────────────────────────────────────────────────────────
	it("detects ALL CAPS header with keyword: 'CAPITAL ALLOCATION'", () => {
		const headers = extractHeaderLike("CAPITAL ALLOCATION\nsome other text");
		expect(headers).toContain("CAPITAL ALLOCATION");
	});

	it("detects ALL CAPS header: 'USE OF FUNDS'", () => {
		const headers = extractHeaderLike("USE OF FUNDS\nline 2");
		expect(headers).toContain("USE OF FUNDS");
	});

	it("detects ALL CAPS: 'VALUATION'", () => {
		const headers = extractHeaderLike("VALUATION\npost-money valuation of $20M");
		expect(headers).toContain("VALUATION");
	});

	it("detects ALL CAPS multi-word: 'MARKET SIZE OVERVIEW'", () => {
		const headers = extractHeaderLike("MARKET SIZE OVERVIEW");
		expect(headers).toContain("MARKET SIZE OVERVIEW");
	});

	it("detects Title Case: 'Capital Allocation Detail'", () => {
		const headers = extractHeaderLike("Capital Allocation Detail");
		expect(headers).toContain("Capital Allocation Detail");
	});

	it("detects Title Case: 'Use of Funds Breakdown'", () => {
		const headers = extractHeaderLike("Use of Funds Breakdown");
		expect(headers).toContain("Use of Funds Breakdown");
	});

	it("detects Title Case: 'Market Opportunity'", () => {
		const headers = extractHeaderLike("Market Opportunity");
		expect(headers).toContain("Market Opportunity");
	});

	it("detects mixed with other lines in snippet", () => {
		const text = "some random lowercase text here\nCAPITAL ALLOCATION\nmore text below";
		const headers = extractHeaderLike(text);
		expect(headers).toContain("CAPITAL ALLOCATION");
		expect(headers).toHaveLength(1);
	});

	// ── Negative controls ─────────────────────────────────────────────────────
	it("does NOT match lowercase prose", () => {
		const headers = extractHeaderLike("the allocation of funds will be determined later");
		expect(headers).toHaveLength(0);
	});

	it("does NOT match a long ALL-CAPS sentence (>60 chars)", () => {
		const long = "CAPITAL ALLOCATION BREAKDOWN INTO MARKETING AND ENGINEERING AND SALES AND OPS";
		expect(long.length).toBeGreaterThan(60);
		const headers = extractHeaderLike(long);
		expect(headers).toHaveLength(0);
	});

	it("does NOT match ALL CAPS without domain keyword", () => {
		const headers = extractHeaderLike("TEAM COMPOSITION");
		expect(headers).toHaveLength(0);
	});

	it("does NOT match Title Case without domain keyword", () => {
		const headers = extractHeaderLike("Product Roadmap Overview");
		expect(headers).toHaveLength(0);
	});

	it("does NOT match empty string", () => {
		expect(extractHeaderLike("")).toHaveLength(0);
	});
});

// ═══════════════════════════════════════════════════════════════════════
// computeTighteningCandidates
// ═══════════════════════════════════════════════════════════════════════

/** Build a minimal DealCoverageResult with one DETECTOR_GAP slot result. */
function makeGapDeal(
	dealId: string,
	slot: string,
	keywords: string[],
	snippet = "some snippet text"
): DealCoverageResult {
	return {
		deal_id:        dealId,
		deal_label:     dealId.slice(0, 8),
		audit_status:   "partial",
		error:          null,
		dpu_pages_total: 10,
		slot_results: [
			{
				slot,
				stored_status:     "NotComputable",
				stored_value:      null,
				recomputed_status: "NotComputable",
				recomputed_value:  null,
				classification:    "DETECTOR_GAP",
				dpu_pages_scanned: 10,
				candidate_pages: [
					{ ref: `dpu:doc:${dealId.slice(0, 8)}:page:1`, triggeredKeywords: keywords, snippet },
				],
			},
		],
		summary: { ok_match: 0, stale_stored: 0, regressed: 0, detector_gap: 1, true_absence: 0, dpu_load_failed: 0, evidence_ref_missing: 0 },
	};
}

describe("computeTighteningCandidates", () => {
	it("returns empty array when no DETECTOR_GAP slots", () => {
		const result = computeTighteningCandidates([], [{ slot: "raise_terms", ok_match: 5, stale_stored: 0, regressed: 0, detector_gap: 0, true_absence: 0 }]);
		expect(result).toHaveLength(0);
	});

	it("maps keyword counts correctly", () => {
		const deals: DealCoverageResult[] = [
			makeGapDeal("aaaa0000-0000-0000-0000-000000000001", "use_of_funds", ["budget", "spend"]),
			makeGapDeal("aaaa0000-0000-0000-0000-000000000002", "use_of_funds", ["budget", "runway"]),
		];
		const breakdown = [{ slot: "use_of_funds", ok_match: 0, stale_stored: 0, regressed: 0, detector_gap: 2, true_absence: 0 }];
		const result = computeTighteningCandidates(deals, breakdown);
		expect(result).toHaveLength(1);
		const uof = result[0]!;
		expect(uof.slot).toBe("use_of_funds");
		expect(uof.detector_gap).toBe(2);
		// "budget" appears in both deals → count=2; should be top keyword
		expect(uof.top_keywords[0]?.keyword).toBe("budget");
		expect(uof.top_keywords[0]?.count).toBe(2);
	});

	it("sorts descending by detector_gap, then slot name alphabetically", () => {
		const deals: DealCoverageResult[] = [
			makeGapDeal("dd000000-0000-0000-0000-000000000001", "use_of_funds",    ["budget"]),
			makeGapDeal("dd000000-0000-0000-0000-000000000002", "market_claims",   ["tam"]),
			makeGapDeal("dd000000-0000-0000-0000-000000000003", "market_claims",   ["tam"]),
			makeGapDeal("dd000000-0000-0000-0000-000000000004", "traction_signal", ["arr"]),
			makeGapDeal("dd000000-0000-0000-0000-000000000005", "traction_signal", ["arr"]),
			makeGapDeal("dd000000-0000-0000-0000-000000000006", "traction_signal", ["arr"]),
		];
		const breakdown = [
			{ slot: "use_of_funds",    ok_match: 0, stale_stored: 0, regressed: 0, detector_gap: 1, true_absence: 0 },
			{ slot: "market_claims",   ok_match: 0, stale_stored: 0, regressed: 0, detector_gap: 2, true_absence: 0 },
			{ slot: "traction_signal", ok_match: 0, stale_stored: 0, regressed: 0, detector_gap: 3, true_absence: 0 },
		];
		const result = computeTighteningCandidates(deals, breakdown);
		// Sorted descending by detector_gap
		expect(result[0]?.slot).toBe("traction_signal"); // gap=3
		expect(result[1]?.slot).toBe("market_claims");   // gap=2
		expect(result[2]?.slot).toBe("use_of_funds");    // gap=1
	});

	it("breaks gap tie alphabetically by slot name", () => {
		const deals: DealCoverageResult[] = [
			makeGapDeal("ee000000-0000-0000-0000-000000000001", "market_claims",   ["tam"]),
			makeGapDeal("ee000000-0000-0000-0000-000000000002", "traction_signal", ["arr"]),
		];
		const breakdown = [
			{ slot: "market_claims",   ok_match: 0, stale_stored: 0, regressed: 0, detector_gap: 1, true_absence: 0 },
			{ slot: "traction_signal", ok_match: 0, stale_stored: 0, regressed: 0, detector_gap: 1, true_absence: 0 },
		];
		const result = computeTighteningCandidates(deals, breakdown);
		// Tied at gap=1 → alpha: market_claims < traction_signal
		expect(result[0]?.slot).toBe("market_claims");
		expect(result[1]?.slot).toBe("traction_signal");
	});

	it("surfaces top-3 unique refs", () => {
		const deals: DealCoverageResult[] = [
			{
				deal_id: "ff000000-0000-0000-0000-000000000001", deal_label: "A",
				audit_status: "partial", error: null, dpu_pages_total: 10,
				slot_results: [{
					slot: "market_claims", stored_status: "NotComputable", stored_value: null,
					recomputed_status: "NotComputable", recomputed_value: null,
					classification: "DETECTOR_GAP", dpu_pages_scanned: 10,
					candidate_pages: [
						{ ref: "dpu:doc:aaaa0000:page:1", triggeredKeywords: ["tam"], snippet: "snippet1" },
						{ ref: "dpu:doc:bbbb0000:page:2", triggeredKeywords: ["tam"], snippet: "snippet2" },
						{ ref: "dpu:doc:cccc0000:page:3", triggeredKeywords: ["tam"], snippet: "snippet3" },
						{ ref: "dpu:doc:dddd0000:page:4", triggeredKeywords: ["tam"], snippet: "snippet4" },
					],
				}],
				summary: { ok_match: 0, stale_stored: 0, regressed: 0, detector_gap: 1, true_absence: 0, dpu_load_failed: 0, evidence_ref_missing: 0 },
			},
		];
		const breakdown = [{ slot: "market_claims", ok_match: 0, stale_stored: 0, regressed: 0, detector_gap: 1, true_absence: 0 }];
		const result = computeTighteningCandidates(deals, breakdown);
		expect(result[0]?.top_refs).toHaveLength(3); // capped at 3
		expect(result[0]?.top_refs[0]?.ref).toBe("dpu:doc:aaaa0000:page:1");
	});

	it("extracts header-like patterns from snippet text", () => {
		const deals: DealCoverageResult[] = [
			makeGapDeal(
				"gg000000-0000-0000-0000-000000000001", "use_of_funds", ["budget"],
				"CAPITAL ALLOCATION\nbudget 40% engineering 60% sales"
			),
			makeGapDeal(
				"gg000000-0000-0000-0000-000000000002", "use_of_funds", ["budget"],
				"CAPITAL ALLOCATION\nbudget for Q4 operations"
			),
		];
		const breakdown = [{ slot: "use_of_funds", ok_match: 0, stale_stored: 0, regressed: 0, detector_gap: 2, true_absence: 0 }];
		const result = computeTighteningCandidates(deals, breakdown);
		const headers = result[0]?.top_headers ?? [];
		expect(headers.find((h) => h.text === "CAPITAL ALLOCATION")?.count).toBe(2);
	});
});

// ═══════════════════════════════════════════════════════════════════════
// selectNextSlot
// ═══════════════════════════════════════════════════════════════════════

describe("selectNextSlot", () => {
	function makeCandidate(slot: string, gap: number, topKw = "retention", kwCount = 3): TighteningCandidate {
		return {
			slot, detector_gap: gap,
			top_keywords: [{ keyword: topKw, count: kwCount }],
			top_headers: [], top_refs: [],
		};
	}

	it("returns null for empty candidates", () => {
		const { slot } = selectNextSlot([]);
		expect(slot).toBeNull();
	});

	it("selects single highest-gap slot directly", () => {
		const candidates = [
			makeCandidate("market_claims",   6),
			makeCandidate("traction_signal", 5),
			makeCandidate("use_of_funds",    6),
		].sort((a, b) => b.detector_gap - a.detector_gap || a.slot.localeCompare(b.slot));
		const { slot } = selectNextSlot(candidates);
		// Both market_claims and use_of_funds have gap=6; tie-break by priority
		// SLOT_PRIORITY: raise_terms > traction_signal > valuation_terms > use_of_funds > market_claims
		// use_of_funds = index 3, market_claims = index 4 → use_of_funds wins
		expect(slot).toBe("use_of_funds");
	});

	it("breaks tie by keyword concentration", () => {
		// Both slots have gap=3
		// market_claims: topKw=8, totalKw=8 → concentration=1.0
		// traction_signal: topKw=2, totalKw=8 → concentration=0.25
		const candidates: TighteningCandidate[] = [
			{
				slot: "market_claims", detector_gap: 3,
				top_keywords: [{ keyword: "tam", count: 8 }],
				top_headers: [], top_refs: [],
			},
			{
				slot: "traction_signal", detector_gap: 3,
				top_keywords: [{ keyword: "arr", count: 2 }, { keyword: "retention", count: 2 }, { keyword: "%", count: 2 }, { keyword: "churn", count: 2 }],
				top_headers: [], top_refs: [],
			},
		];
		// market_claims has higher concentration (1.0 vs 0.25) → market_claims wins
		const { slot } = selectNextSlot(candidates);
		expect(slot).toBe("market_claims");
	});

	it("breaks tie by priority order when concentration is equal", () => {
		const candidates: TighteningCandidate[] = [
			makeCandidate("use_of_funds",    4),
			makeCandidate("market_claims",   4),
		]; // both concentration = 1.0 (single keyword each)
		const { slot } = selectNextSlot(candidates);
		// SLOT_PRIORITY: use_of_funds (index 3) < market_claims (index 4) → use_of_funds wins
		expect(slot).toBe("use_of_funds");
	});

	it("rationale includes gap count and top keywords", () => {
		const candidates = [makeCandidate("traction_signal", 5, "retention", 3)];
		const { rationale } = selectNextSlot(candidates);
		expect(rationale).toContain("gaps=5");
		expect(rationale).toContain("retention");
	});
});

// ═══════════════════════════════════════════════════════════════════════
// printCoverageMarkdown — Top Tightening Candidates section
// ═══════════════════════════════════════════════════════════════════════

describe("printCoverageMarkdown — Top Tightening Candidates", () => {
	function makeMinimalReport(candidates: TighteningCandidate[], selected: string | null): CoverageAuditReport {
		return {
			generated_at: "2026-01-01T00:00:00.000Z",
			meta: {
				selected_slot: selected,
				selected_slot_rationale: selected ? `highest gaps=6; top keywords: tam(3)` : "no DETECTOR_GAP slots found",
			},
			deals: [],
			portfolio_summary: {
				total_deals: 0, deals_ok: 0, deals_with_gaps: 0,
				deals_with_stale: 0, deals_with_regressions: 0,
				slot_breakdown: [],
			},
			tightening_candidates: candidates,
		};
	}

	it("includes '## 🎯 Top Tightening Candidates' section in Markdown output", () => {
		const report = makeMinimalReport(
			[{ slot: "market_claims", detector_gap: 6, top_keywords: [{ keyword: "tam", count: 3 }], top_headers: [], top_refs: [] }],
			"market_claims"
		);
		const md = printCoverageMarkdown(report);
		expect(md).toContain("## 🎯 Top Tightening Candidates");
	});

	it("shows selected slot callout when slot is set", () => {
		const report = makeMinimalReport(
			[{ slot: "use_of_funds", detector_gap: 5, top_keywords: [], top_headers: [], top_refs: [] }],
			"use_of_funds"
		);
		const md = printCoverageMarkdown(report);
		expect(md).toContain("`use_of_funds`");
		expect(md).toContain("Next slot to tighten");
	});

	it("shows fully-covered message when no candidates", () => {
		const report = makeMinimalReport([], null);
		const md = printCoverageMarkdown(report);
		expect(md).toContain("No DETECTOR");
	});

	it("renders candidates in descending gap order (summary table rows)", () => {
		// tightening_candidates is pre-sorted descending by computeTighteningCandidates;
		// printCoverageMarkdown renders them in the order provided.
		const report = makeMinimalReport(
			[
				// market_claims (gap=6) must come first in the pre-sorted array
				{ slot: "market_claims",   detector_gap: 6, top_keywords: [{ keyword: "tam", count: 3 }], top_headers: [], top_refs: [] },
				{ slot: "traction_signal", detector_gap: 5, top_keywords: [{ keyword: "arr", count: 2 }], top_headers: [], top_refs: [] },
			],
			"market_claims"
		);
		const md = printCoverageMarkdown(report);
		// market_claims should appear in rank-1 row, traction_signal in rank-2
		const mcIdx = md.indexOf("| 1 | market_claims");
		const tsIdx = md.indexOf("| 2 | traction_signal");
		expect(mcIdx).toBeGreaterThanOrEqual(0);
		expect(tsIdx).toBeGreaterThanOrEqual(0);
		expect(mcIdx).toBeLessThan(tsIdx);
	});

	it("appended section appears before Portfolio Summary", () => {
		const report = makeMinimalReport(
			[{ slot: "valuation_terms", detector_gap: 3, top_keywords: [], top_headers: [], top_refs: [] }],
			"valuation_terms"
		);
		const md = printCoverageMarkdown(report);
		const tcIdx     = md.indexOf("🎯 Top Tightening Candidates");
		const summaryIdx = md.indexOf("## Portfolio Summary");
		expect(tcIdx).toBeGreaterThanOrEqual(0);
		expect(summaryIdx).toBeGreaterThan(tcIdx);
	});

	it("runCoverageAudit report has meta.selected_slot set", async () => {
		const storedBody = `raise_terms: NotComputable | value=none | evidence=none | reason=NO_RAISE_MENTION\nmarket_claims: NotComputable | value=none | evidence=none | reason=NO_MARKET_CLAIM_MENTION\ntraction_signal: NotComputable | value=none | evidence=none | reason=NO_TRACTION_SIGNAL_MENTION\nvaluation_terms: NotComputable | value=none | evidence=none | reason=NO_VALUATION_MENTION\nuse_of_funds: NotComputable | value=none | evidence=none | reason=NO_USE_OF_FUNDS_MENTION`;
		const pool = mockPool({
			dpu_pages: [
				{ document_id: "doc10000-0000-0000-0000-000000000001", page_index: 0, page_text: "our retention rate is 80%; churn dropped 5% YoY" },
			],
			report: {
				status: "complete", engine_version: "v1", upstream_fingerprint: "fp",
				render_package: { sections: [{ key: "insight_slots", title: "Slots", kind: "message", body: storedBody, fallback: "" }] },
				gate_state: null, updated_at: "2026-01-01T00:00:00",
			},
		});
		const report = await runCoverageAudit(pool, ["adb2a1cf-bbb1-4f3b-8735-e2249415124f"], { labels: { "adb2a1cf-bbb1-4f3b-8735-e2249415124f": "TestDeal" } });
		// meta should exist
		expect(report.meta).toBeDefined();
		// tightening_candidates should be an array
		expect(Array.isArray(report.tightening_candidates)).toBe(true);
		// If any DETECTOR_GAP exists, selected_slot should be a non-empty string
		const anyGap = report.portfolio_summary.slot_breakdown.some((s) => s.detector_gap > 0);
		if (anyGap) {
			expect(typeof report.meta.selected_slot).toBe("string");
			expect(report.meta.selected_slot).toBeTruthy();
		} else {
			expect(report.meta.selected_slot).toBeNull();
		}
	});
});
