/**
 * narrative-contradiction-detector.test.ts — PR36.9 Phase 7
 *
 * Unit tests for all public exports of narrative-contradiction-detector.ts:
 *   - extractLeadingMonetaryAmount
 *   - extractAllMonetaryAmounts
 *   - hasMeaningfulTopicDisagreement
 *   - classifyNarrativeDisagreement
 *   - detectNarrativeContradiction
 *
 * Also tests serializeContradictionMarkersBody from narrative-contradiction-v1.ts
 * since it is the downstream consumer of the detector output.
 *
 * Integration scenarios cover representative deal archetypes discovered in discovery:
 *   - Carmoola: personal finance vs enterprise B2B category drift
 *   - StackFactor: workflow automation SaaS vs marketplace category drift
 *   - WebMax-style: equity raise vs GMV metric confusion
 *   - Clean SaaS deal: no contradictions expected
 */

import { describe, it, expect } from "vitest";
import {
	extractLeadingMonetaryAmount,
	extractAllMonetaryAmounts,
	hasMeaningfulTopicDisagreement,
	classifyNarrativeDisagreement,
	detectNarrativeContradiction,
} from "../narrative-contradiction-detector";
import {
	serializeContradictionMarkersBody,
} from "../narrative-contradiction-v1";
import type { ScoredNarrativeCandidate } from "../narrative-evidence-ranking";
import type { NarrativeContradictionBundle } from "../narrative-contradiction-v1";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Build a minimal ScoredNarrativeCandidate for test use. */
function candidate(text: string, score: number): ScoredNarrativeCandidate {
	return { text, meta: {}, score, signals: [] };
}

// ─── extractLeadingMonetaryAmount ──────────────────────────────────────────────

describe("extractLeadingMonetaryAmount", () => {
	it("parses $5M as 5_000_000", () => {
		expect(extractLeadingMonetaryAmount("Raising $5M in initial funding")).toBe(5_000_000);
	});

	it("parses $2.4M as 2_400_000", () => {
		expect(extractLeadingMonetaryAmount("Revenue of $2.4M ARR")).toBe(2_400_000);
	});

	it("parses $200K as 200_000", () => {
		expect(extractLeadingMonetaryAmount("Monthly burn of $200K")).toBe(200_000);
	});

	it("parses $1.2B as 1_200_000_000", () => {
		expect(extractLeadingMonetaryAmount("TAM of $1.2B in 2025")).toBe(1_200_000_000);
	});

	it("parses $50 million as 50_000_000", () => {
		expect(extractLeadingMonetaryAmount("Raised $50 million to date")).toBe(50_000_000);
	});

	it("parses $500 thousand as 500_000", () => {
		expect(extractLeadingMonetaryAmount("$500 thousand in initial investment")).toBe(500_000);
	});

	it("parses £3M as 3_000_000 (pound sign)", () => {
		expect(extractLeadingMonetaryAmount("Raising £3M SAFE note")).toBe(3_000_000);
	});

	it("returns null when no amount present", () => {
		expect(extractLeadingMonetaryAmount("No financial data available")).toBeNull();
	});

	it("returns null for empty string", () => {
		expect(extractLeadingMonetaryAmount("")).toBeNull();
	});

	it("handles comma-separated amounts: $3,500,000", () => {
		expect(extractLeadingMonetaryAmount("Annual revenue of $3,500,000")).toBe(3_500_000);
	});
});

// ─── extractAllMonetaryAmounts ────────────────────────────────────────────────

describe("extractAllMonetaryAmounts", () => {
	it("extracts and sorts multiple amounts ascending", () => {
		const text = "Revenue $2M, TAM $500M, raising $5M";
		const amounts = extractAllMonetaryAmounts(text);
		expect(amounts).toEqual([2_000_000, 5_000_000, 500_000_000]);
	});

	it("returns empty array when no amounts present", () => {
		expect(extractAllMonetaryAmounts("No figures in this text")).toEqual([]);
	});

	it("handles single amount", () => {
		expect(extractAllMonetaryAmounts("Raising $3M")).toEqual([3_000_000]);
	});
});

// ─── hasMeaningfulTopicDisagreement ───────────────────────────────────────────

describe("hasMeaningfulTopicDisagreement", () => {
	it("returns false when candidates describe the same product category", () => {
		const a = "StackFactor automates financial due diligence workflow for investment analysts";
		const b = "Our platform provides automated workflow tools for financial teams and analysts";
		expect(hasMeaningfulTopicDisagreement(a, b, "product_differentiation")).toBe(false);
	});

	it("returns true when candidates describe conflicting product categories", () => {
		const a = "StackFactor automates due diligence workflows with AI-powered automation tools";
		const b = "StackFactor is a marketplace connecting investors to deal flow with platform fees";
		expect(hasMeaningfulTopicDisagreement(a, b, "product_differentiation")).toBe(true);
	});

	it("returns false when texts are too short", () => {
		expect(hasMeaningfulTopicDisagreement("SaaS", "marketplace", "product_differentiation")).toBe(false);
	});

	it("returns true when GTM motions are clearly divergent (PLG vs outbound)", () => {
		const a = "Our product-led growth PLG model drives self-serve virality with no sales team";
		const b = "Our outbound direct sales team with SDRs and account executives sources all revenue";
		expect(hasMeaningfulTopicDisagreement(a, b, "go_to_market_strategy")).toBe(true);
	});

	it("returns false when GTM candidates consistently describe a direct sales motion", () => {
		const a = "We sell direct to enterprise clients with account executives and enterprise deals";
		const b = "Our inside sales team runs direct sales cycles targeting Fortune 500 enterprise buyers";
		expect(hasMeaningfulTopicDisagreement(a, b, "go_to_market_strategy")).toBe(false);
	});
});

// ─── classifyNarrativeDisagreement — product_differentiation ─────────────────

describe("classifyNarrativeDisagreement / product_differentiation", () => {
	it("marketplace vs SaaS workflow tool → conflicting / category_divergence", () => {
		const a = "Carmoola is a workflow automation SaaS platform for car dealerships";
		const b = "Carmoola is a marketplace connecting buyers and sellers of used vehicles";
		const result = classifyNarrativeDisagreement(a, b, "product_differentiation");
		expect(result.status).toBe("conflicting");
		expect(result.reason).toBe("category_divergence");
		expect(result.notes.length).toBeGreaterThan(0);
	});

	it("B2C consumer product vs B2B enterprise tool → conflicting / category_divergence", () => {
		const a = "We serve individual consumers with a personal finance app for everyday users";
		const b = "Our enterprise software solution serves B2B business teams with workflow tools";
		const result = classifyNarrativeDisagreement(a, b, "product_differentiation");
		expect(result.status).toBe("conflicting");
		expect(result.reason).toBe("category_divergence");
	});

	it("consistent SaaS descriptions → none", () => {
		const a = "Our SaaS platform automates document workflow for financial teams";
		const b = "API-first embedded tool for workflow automation in financial services";
		const result = classifyNarrativeDisagreement(a, b, "product_differentiation");
		expect(result.status).toBe("none");
	});

	it("two-sided marketplace variants → none (not category conflict)", () => {
		const a = "A marketplace connecting buyers and sellers of commercial property with platform fees";
		const b = "Our two-sided platform connects lenders and borrowers via commission-based matching";
		const result = classifyNarrativeDisagreement(a, b, "product_differentiation");
		expect(result.status).toBe("none");
	});
});

// ─── classifyNarrativeDisagreement — go_to_market_strategy ───────────────────

describe("classifyNarrativeDisagreement / go_to_market_strategy", () => {
	it("PLG-only vs direct sales-only → mixed / semantic_divergence", () => {
		const a = "Our product-led growth PLG approach drives self-serve sign-up with a free tier and no sales team";
		const b = "We run outbound direct sales with dedicated SDRs and account executives targeting enterprise deals";
		const result = classifyNarrativeDisagreement(a, b, "go_to_market_strategy");
		expect(result.status).toBe("mixed");
		expect(result.reason).toBe("semantic_divergence");
	});

	it("enterprise segment vs SMB segment → mixed / semantic_divergence", () => {
		const a = "We target Fortune 500 enterprise clients with annual enterprise contracts";
		const b = "Our customers are small businesses, startups, and freelancers in early stages";
		const result = classifyNarrativeDisagreement(a, b, "go_to_market_strategy");
		expect(result.status).toBe("mixed");
		expect(result.reason).toBe("semantic_divergence");
	});

	it("consistent PLG descriptions → none", () => {
		const a = "Product-led growth with freemium tier and bottom-up viral adoption";
		const b = "Users sign up via self-serve free tier with viral growth coefficient driving expansion";
		const result = classifyNarrativeDisagreement(a, b, "go_to_market_strategy");
		expect(result.status).toBe("none");
	});
});

// ─── classifyNarrativeDisagreement — financial_outlook ───────────────────────

describe("classifyNarrativeDisagreement / financial_outlook", () => {
	it("pre-revenue stage vs $X ARR → conflicting / stage_vs_metric_divergence", () => {
		const a = "We are pre-revenue seeking our first paying customer with an early MVP";
		const b = "Our ARR of $2.4M growing 120% YoY reflects strong product-market fit";
		const result = classifyNarrativeDisagreement(a, b, "financial_outlook");
		expect(result.status).toBe("conflicting");
		expect(result.reason).toBe("stage_vs_metric_divergence");
	});

	it("ARR amounts differing by 5× → conflicting / numeric_divergence", () => {
		const a = "Annual recurring revenue ARR of $1M with strong NRR";
		const b = "ARR of $5M with 150% net revenue retention and expansion motion";
		const result = classifyNarrativeDisagreement(a, b, "financial_outlook");
		expect(result.status).toBe("conflicting");
		expect(result.reason).toBe("numeric_divergence");
	});

	it("ARR amounts differing by 3× → mixed / numeric_divergence", () => {
		const a = "Annual recurring revenue ARR of $1M";
		const b = "ARR is $3M with solid recurring revenue growth";
		const result = classifyNarrativeDisagreement(a, b, "financial_outlook");
		expect(result.status).toBe("mixed");
		expect(result.reason).toBe("numeric_divergence");
	});

	it("consistent post-revenue descriptions → none", () => {
		const a = "We have ARR of $2.4M growing 120% year-over-year with strong margins";
		const b = "ARR is $2.4M with monthly recurring revenue MRR of $200K and improving unit economics";
		const result = classifyNarrativeDisagreement(a, b, "financial_outlook");
		expect(result.status).toBe("none");
	});
});

// ─── classifyNarrativeDisagreement — capital_and_raise ───────────────────────

describe("classifyNarrativeDisagreement / capital_and_raise", () => {
	it("equity raise vs GMV volume metric → conflicting / source_divergence", () => {
		const a = "We are raising $10M SAFE convertible note for product development and growth";
		const b = "Our GMV is $10M representing total transaction volume processed through the platform";
		const result = classifyNarrativeDisagreement(a, b, "capital_and_raise");
		expect(result.status).toBe("conflicting");
		expect(result.reason).toBe("source_divergence");
		expect(result.notes.some((n) => /GMV is not equity raised/i.test(n))).toBe(true);
	});

	it("equity raise vs gross merchandise value → conflicting / source_divergence", () => {
		const a = "Raising $5M in Series A equity financing to scale operations";
		const b = "Gross merchandise value GTV of $5M processed through the marketplace to date";
		const result = classifyNarrativeDisagreement(a, b, "capital_and_raise");
		expect(result.status).toBe("conflicting");
		expect(result.reason).toBe("source_divergence");
	});

	it("two raise amounts differing by 5× → conflicting / numeric_divergence", () => {
		const a = "We are raising $1M SAFE in an initial seed round financing";
		const b = "The equity raise of $5M Seed round is targeted with a $20M cap";
		const result = classifyNarrativeDisagreement(a, b, "capital_and_raise");
		expect(result.status).toBe("conflicting");
		expect(result.reason).toBe("numeric_divergence");
	});

	it("consistent raise descriptions → none", () => {
		const a = "We are raising $3M SAFE convertible note for product and team expansion";
		const b = "A $3M SAFE raise with a $15M cap to fund 18 months of runway";
		const result = classifyNarrativeDisagreement(a, b, "capital_and_raise");
		expect(result.status).toBe("none");
	});
});

// ─── classifyNarrativeDisagreement — traction ────────────────────────────────

describe("classifyNarrativeDisagreement / traction", () => {
	it("early-stage traction vs NRR/expansion signals → mixed / stage_vs_metric_divergence", () => {
		const a = "Early adopter traction with our first beta customer engaged in a pilot";
		const b = "Net revenue retention NRR of 135% across 45+ customers with expansion revenue";
		const result = classifyNarrativeDisagreement(a, b, "traction");
		expect(result.status).toBe("mixed");
		expect(result.reason).toBe("stage_vs_metric_divergence");
	});

	it("consistent mature traction signals → none", () => {
		const a = "85 paying customers with 140% NRR and strong expansion signal across cohorts";
		const b = "Net revenue retention of 140% with 85+ enterprise clients expanding usage monthly";
		const result = classifyNarrativeDisagreement(a, b, "traction");
		expect(result.status).toBe("none");
	});
});

// ─── classifyNarrativeDisagreement — market_position ─────────────────────────

describe("classifyNarrativeDisagreement / market_position", () => {
	it("insurance market vs e-commerce market → mixed / category_divergence", () => {
		const a = "The global insurance market opportunity with underwriting and policy premiums";
		const b = "Our e-commerce and online retail platform addresses D2C digital commerce growth";
		const result = classifyNarrativeDisagreement(a, b, "market_position");
		expect(result.status).toBe("mixed");
		expect(result.reason).toBe("category_divergence");
	});

	it("TAM amounts differing 5× → conflicting / numeric_divergence", () => {
		const a = "Total addressable market TAM of $1B supported by recent industry reports";
		const b = "Market size and total addressable market TAM estimated at $5B for this sector";
		const result = classifyNarrativeDisagreement(a, b, "market_position");
		expect(result.status).toBe("conflicting");
		expect(result.reason).toBe("numeric_divergence");
	});

	it("consistent market descriptions → none", () => {
		const a = "Total addressable market of $3B in the fintech payments infrastructure space";
		const b = "The fintech payments infrastructure market TAM is approximately $3B";
		const result = classifyNarrativeDisagreement(a, b, "market_position");
		expect(result.status).toBe("none");
	});
});

// ─── detectNarrativeContradiction ─────────────────────────────────────────────

describe("detectNarrativeContradiction", () => {
	it("returns status=none when 0 candidates provided", () => {
		const result = detectNarrativeContradiction([], "product_differentiation");
		expect(result.status).toBe("none");
		expect(result.primary_text).toBe("");
	});

	it("returns status=none when only 1 candidate qualifies", () => {
		const candidates = [
			candidate("StackFactor automates due diligence workflows with AI-powered tooling for investment teams", 0.9),
		];
		const result = detectNarrativeContradiction(candidates, "product_differentiation");
		expect(result.status).toBe("none");
		expect(result.secondary_texts).toHaveLength(0);
	});

	it("returns status=none when all candidates score below threshold (no qualified pair)", () => {
		const candidates = [
			// Low scores that won't qualify
			candidate("SaaS workflow automation platform for enterprise users", 0.05),
			candidate("Marketplace connecting buyers and sellers via commission-based fees", 0.04),
		];
		const result = detectNarrativeContradiction(candidates, "product_differentiation");
		expect(result.status).toBe("none");
	});

	it("returns status=conflicting for marketplace vs SaaS tool when both candidates qualify", () => {
		const candidates = [
			candidate(
				"StackFactor automates due diligence workflows with AI-powered automation tools for financial analysts",
				9.0
			),
			candidate(
				"StackFactor is a two-sided marketplace platform connecting investors to deal sources with platform fees",
				8.5
			),
		];
		const result = detectNarrativeContradiction(candidates, "product_differentiation");
		expect(result.status).toBe("conflicting");
		expect(result.reason).toBe("category_divergence");
		expect(result.primary_text).toBeTruthy();
		expect(result.secondary_texts.length).toBeGreaterThan(0);
		expect(result.notes.length).toBeGreaterThan(0);
	});

	it("returns status=mixed for divergent GTM motions when both candidates qualify", () => {
		const candidates = [
			candidate(
				"Our product-led growth PLG model drives self-serve sign-up with a free tier and no dedicated sales team",
				9.0
			),
			candidate(
				"We run outbound direct sales with dedicated SDRs and account executives targeting enterprise deals",
				8.5
			),
		];
		const result = detectNarrativeContradiction(candidates, "go_to_market_strategy");
		expect(result.status).toBe("mixed");
		expect(result.reason).toBe("semantic_divergence");
	});

	it("preserves primary_text as the highest-scoring candidate text", () => {
		const candidates = [
			candidate(
				"StackFactor automates due diligence workflow SaaS automation tools for analysts",
				0.90
			),
			candidate(
				"StackFactor is a marketplace listing platform connecting investors with commission fees",
				0.70
			),
		];
		const result = detectNarrativeContradiction(candidates, "product_differentiation");
		expect(result.primary_text).toContain("automates due diligence");
	});

	it("returns status=none for candidates that agree on GTM even with different framing", () => {
		const candidates = [
			candidate(
				"We sell directly to enterprise clients using an account executive-driven sales motion",
				0.85
			),
			candidate(
				"Our inside sales team runs direct sales cycles targeting Fortune 500 enterprise buyers",
				0.78
			),
		];
		const result = detectNarrativeContradiction(candidates, "go_to_market_strategy");
		expect(result.status).toBe("none");
	});
});

// ─── serializeContradictionMarkersBody ────────────────────────────────────────

describe("serializeContradictionMarkersBody", () => {
	it("returns null when bundle is null", () => {
		expect(serializeContradictionMarkersBody(null)).toBeNull();
	});

	it("returns null when all topics are status=none", () => {
		const bundle: NarrativeContradictionBundle = {
			product_differentiation: {
				topic: "product_differentiation",
				status: "none",
				reason: null,
				primary_text: "Some product text",
				secondary_texts: [],
				notes: [],
			},
			go_to_market_strategy: null,
		};
		expect(serializeContradictionMarkersBody(bundle)).toBeNull();
	});

	it("serializes a conflicting topic correctly", () => {
		const bundle: NarrativeContradictionBundle = {
			product_differentiation: {
				topic: "product_differentiation",
				status: "conflicting",
				reason: "category_divergence",
				primary_text: "StackFactor automates due diligence workflows for investment analysts",
				secondary_texts: [
					"StackFactor is a marketplace connecting investors to deal sources",
				],
				notes: [
					"Candidates imply mutually exclusive product categories.",
					"Do NOT write a single settled claim.",
				],
			},
		};
		const body = serializeContradictionMarkersBody(bundle);
		expect(body).not.toBeNull();
		expect(body).toContain("status=CONFLICTING");
		expect(body).toContain("reason=category_divergence");
		expect(body).toContain("[primary]");
		expect(body).toContain("[runner-up]");
		expect(body).toContain("note:");
	});

	it("serializes a mixed topic correctly", () => {
		const bundle: NarrativeContradictionBundle = {
			go_to_market_strategy: {
				topic: "go_to_market_strategy",
				status: "mixed",
				reason: "semantic_divergence",
				primary_text: "Product-led growth with freemium and self-serve sign-up",
				secondary_texts: [
					"Outbound direct sales with SDRs and account executives targeting enterprise",
				],
				notes: ["Both framings may coexist in a land-and-expand model."],
			},
		};
		const body = serializeContradictionMarkersBody(bundle);
		expect(body).not.toBeNull();
		expect(body).toContain("status=MIXED");
		expect(body).toContain("reason=semantic_divergence");
	});

	it("omits none topics and only renders non-none topics", () => {
		const bundle: NarrativeContradictionBundle = {
			product_differentiation: {
				topic: "product_differentiation",
				status: "none",
				reason: null,
				primary_text: "Clean signal",
				secondary_texts: [],
				notes: [],
			},
			go_to_market_strategy: {
				topic: "go_to_market_strategy",
				status: "conflicting",
				reason: "semantic_divergence",
				primary_text: "PLG self-serve model with no outbound",
				secondary_texts: ["Direct enterprise sales with SDRs and AEs"],
				notes: ["Diverging GTM motions."],
			},
		};
		const body = serializeContradictionMarkersBody(bundle);
		expect(body).not.toContain("product_differentiation");
		expect(body).toContain("go_to_market_strategy");
	});
});

// ─── Integration: deal archetypes ─────────────────────────────────────────────

describe("Integration: Carmoola-style personal finance vs B2B ambiguity", () => {
	it("detects B2C vs B2B category drift as conflicting", () => {
		// Carmoola-inspired: one slide describes consumer personal car finance,
		// another slide (e.g. corporate deck intro) describes a B2B enterprise solution
		const a =
			"Carmoola provides a personal finance app for individual consumers seeking car loans. " +
			"Our B2C product serves retail customers who want to buy vehicles without visiting a dealership.";
		const b =
			"Carmoola is an enterprise software solution helping B2B dealership groups manage finance workflows. " +
			"Our business tool integrates with dealership CRMs to automate the finance origination process.";
		const result = classifyNarrativeDisagreement(a, b, "product_differentiation");
		expect(result.status).toBe("conflicting");
		expect(result.reason).toBe("category_divergence");
	});
});

describe("Integration: StackFactor-style workflow automation vs marketplace drift", () => {
	it("detects SaaS automation vs marketplace as conflicting", () => {
		const a =
			"StackFactor is an API-first workflow automation platform for financial due diligence. " +
			"Our no-code automation tool integrates with existing data rooms without human intervention.";
		const b =
			"StackFactor is a marketplace connecting early-stage investors to pre-vetted deal flow. " +
			"Platform fees are charged on completed investments via our two-sided commission-based model.";
		const result = classifyNarrativeDisagreement(a, b, "product_differentiation");
		expect(result.status).toBe("conflicting");
		expect(result.reason).toBe("category_divergence");
	});
});

describe("Integration: WebMax-style raise vs GMV confusion", () => {
	it("detects equity raise vs transaction volume as conflicting", () => {
		const a =
			"WebMax is raising $10M SAFE convertible note to fund customer acquisition and product development.";
		const b =
			"WebMax has processed $10M in GMV representing total transaction volume on our marketplace.";
		const result = classifyNarrativeDisagreement(a, b, "capital_and_raise");
		expect(result.status).toBe("conflicting");
		expect(result.reason).toBe("source_divergence");
	});
});

describe("Integration: clean SaaS deal with no contradictions", () => {
	it("returns status=none for consistently described SaaS product", () => {
		const candidates = [
			candidate(
				"Our SaaS workflow automation platform integrates with enterprise CRM tools for automated reporting",
				0.88
			),
			candidate(
				"The dashboard provides real-time analytics for business teams with API-first embedded tooling",
				0.82
			),
			candidate(
				"An enterprise-grade no-code automation tool used by B2B finance teams for workflow orchestration",
				0.76
			),
		];
		const result = detectNarrativeContradiction(candidates, "product_differentiation");
		expect(result.status).toBe("none");
	});

	it("returns null from serializeContradictionMarkersBody for entirely clean deal", () => {
		const bundle: NarrativeContradictionBundle = {
			product_differentiation: null,
			go_to_market_strategy: null,
			market_position: null,
			financial_outlook: null,
			capital_and_raise: null,
			traction: null,
			business_quality: null,
		};
		expect(serializeContradictionMarkersBody(bundle)).toBeNull();
	});
});
