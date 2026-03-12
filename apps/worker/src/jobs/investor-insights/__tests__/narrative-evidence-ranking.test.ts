/**
 * narrative-evidence-ranking.test.ts — PR36.8
 *
 * Unit tests for the deterministic evidence ranking and selection layer.
 *
 * Required test scenarios (from spec):
 *   1. Generic tagline vs concrete product workflow description
 *   2. Vague GTM copy vs pricing/channel evidence
 *   3. Malformed/placeholder financial text vs real financial metric
 *   4. Raw market number without context vs contextual market statement
 *   5. All candidates below threshold → selectBestNarrativeCandidate returns null
 *   6. Repeated duplicate snippets do not overpower a better unique snippet
 *
 * Additional coverage:
 *   - scoreNarrativeCandidate per-topic signal tests
 *   - GENERIC_SUPPRESSION_SIGNALS penalty coverage
 *   - Universal positive signals (quantitative, sentence completeness, comparative)
 *   - Source type bonus table
 *   - Confidence level bonus table
 *   - Near-duplicate deduplication
 *   - rankNarrativeCandidates returns sorted descending
 *   - TOPIC_MIN_THRESHOLD: score below threshold → selectBest returns null
 */

import { describe, it, expect } from "vitest";

import {
	scoreNarrativeCandidate,
	rankNarrativeCandidates,
	selectBestNarrativeCandidate,
	TOPIC_MIN_THRESHOLD,
	GENERIC_SUPPRESSION_SIGNALS,
	type NarrativeCandidate,
	type NarrativeTopic,
} from "../narrative-evidence-ranking.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function score(text: string, topic: NarrativeTopic = "product_differentiation") {
	return scoreNarrativeCandidate(text, topic).score;
}

function signals(text: string, topic: NarrativeTopic = "product_differentiation") {
	return scoreNarrativeCandidate(text, topic).signals;
}

// ─── Required scenario 1: Generic tagline vs concrete product description ─────

describe("Scenario 1 — generic tagline loses to concrete product description", () => {
	const genericTagline: NarrativeCandidate = {
		text: "We are an innovative platform designed to enhance modern business workflows.",
	};
	const concreteProduct: NarrativeCandidate = {
		text: "StackFactor automates due diligence workflows by integrating with CRM, email, and data room platforms, reducing analyst time by 60%.",
	};

	it("concrete product candidate scores higher than generic tagline", () => {
		expect(score(concreteProduct.text)).toBeGreaterThan(score(genericTagline.text));
	});

	it("concrete product candidate wins selection", () => {
		const result = selectBestNarrativeCandidate(
			[genericTagline, concreteProduct],
			"product_differentiation",
		);
		expect(result).toContain("automates due diligence");
	});

	it("generic tagline scores below product_differentiation threshold", () => {
		const threshold = TOPIC_MIN_THRESHOLD["product_differentiation"];
		expect(score(genericTagline.text)).toBeLessThan(threshold);
	});

	it("concrete product scores above threshold", () => {
		const threshold = TOPIC_MIN_THRESHOLD["product_differentiation"];
		expect(score(concreteProduct.text)).toBeGreaterThan(threshold);
	});
});

// ─── Required scenario 2: Vague GTM copy vs pricing/channel evidence ──────────

describe("Scenario 2 — vague GTM copy loses to pricing/channel evidence", () => {
	const vagueGtm: NarrativeCandidate = {
		text: "We have a comprehensive go-to-market strategy that targets a large and growing market.",
	};
	const pricingEvidence: NarrativeCandidate = {
		text: "We target SMBs in the financial services sector using a direct sales motion with $299/seat/year pricing and a freemium entry tier. Our channel partners include 3 regional SIs.",
	};

	it("pricing/channel evidence scores higher than vague GTM copy", () => {
		const vagueScore = score(vagueGtm.text, "go_to_market_strategy");
		const pricingScore = score(pricingEvidence.text, "go_to_market_strategy");
		expect(pricingScore).toBeGreaterThan(vagueScore);
	});

	it("pricing/channel evidence wins selection", () => {
		const result = selectBestNarrativeCandidate(
			[vagueGtm, pricingEvidence],
			"go_to_market_strategy",
		);
		expect(result).toContain("$299");
	});

	it("vague GTM copy scores below go_to_market_strategy threshold", () => {
		const threshold = TOPIC_MIN_THRESHOLD["go_to_market_strategy"];
		expect(score(vagueGtm.text, "go_to_market_strategy")).toBeLessThan(threshold);
	});
});

// ─── Required scenario 3: Placeholder vs real financial metric ────────────────

describe("Scenario 3 — placeholder financial text loses to real metric", () => {
	const placeholder: NarrativeCandidate = {
		text: "Revenue is not determinable at this stage. Financial information not available.",
	};
	const realMetric: NarrativeCandidate = {
		text: "ARR of $2.4M as of Q4 2024, growing at 115% YoY. Gross margin of 78%.",
	};

	it("real financial metric scores higher than placeholder", () => {
		const placeholderScore = score(placeholder.text, "financial_outlook");
		const realScore = score(realMetric.text, "financial_outlook");
		expect(realScore).toBeGreaterThan(placeholderScore);
	});

	it("placeholder text receives placeholder penalty signal", () => {
		const placeholderSignals = signals(placeholder.text, "financial_outlook");
		expect(placeholderSignals.some((s) => s.includes("placeholder_text"))).toBe(true);
	});

	it("placeholder scores well below threshold", () => {
		const threshold = TOPIC_MIN_THRESHOLD["financial_outlook"];
		expect(score(placeholder.text, "financial_outlook")).toBeLessThan(threshold);
	});

	it("real metric wins selection", () => {
		const result = selectBestNarrativeCandidate(
			[placeholder, realMetric],
			"financial_outlook",
		);
		expect(result).toContain("ARR");
	});
});

// ─── Required scenario 4: Bare market number vs contextual market statement ───

describe("Scenario 4 — bare market number loses to contextual market statement", () => {
	const bareNumber: NarrativeCandidate = {
		text: "$45B market.",
	};
	const contextualStatement: NarrativeCandidate = {
		text: "The SMB financial operations SAM is $8.4B, growing at 22% CAGR. Incumbent solutions like QuickBooks and Xero leave a gap in AI-native workflow automation.",
	};

	it("contextual statement scores higher than bare number", () => {
		const bareScore = score(bareNumber.text, "market_position");
		const contextualScore = score(contextualStatement.text, "market_position");
		expect(contextualScore).toBeGreaterThan(bareScore);
	});

	it("bare number scores below threshold", () => {
		const threshold = TOPIC_MIN_THRESHOLD["market_position"];
		expect(score(bareNumber.text, "market_position")).toBeLessThan(threshold);
	});

	it("contextual market statement wins selection", () => {
		const result = selectBestNarrativeCandidate(
			[bareNumber, contextualStatement],
			"market_position",
		);
		expect(result).toContain("SAM");
	});
});

// ─── Required scenario 5: All candidates below threshold → null ───────────────

describe("Scenario 5 — all candidates below threshold returns null", () => {
	it("product_differentiation: all generic candidates → null", () => {
		const candidates: NarrativeCandidate[] = [
			{ text: "We are an innovative platform." },
			{ text: "By leveraging AI we enhance productivity." },
			{ text: "Our cutting-edge solution." },
		];
		const result = selectBestNarrativeCandidate(candidates, "product_differentiation");
		expect(result).toBeNull();
	});

	it("financial_outlook: no financial signals → null", () => {
		const candidates: NarrativeCandidate[] = [
			{ text: "We have a strong financial foundation and are growing rapidly." },
			{ text: "Our business model is designed to be scalable and profitable." },
		];
		const result = selectBestNarrativeCandidate(candidates, "financial_outlook");
		expect(result).toBeNull();
	});

	it("empty candidates array → null", () => {
		expect(selectBestNarrativeCandidate([], "traction")).toBeNull();
	});

	it("capital_and_raise: no raise signals → null", () => {
		const candidates: NarrativeCandidate[] = [
			{ text: "We are seeking to grow our business significantly." },
		];
		expect(selectBestNarrativeCandidate(candidates, "capital_and_raise")).toBeNull();
	});
});

// ─── Required scenario 6: Duplicate snippets don't overpower unique better ────

describe("Scenario 6 — duplicate snippets do not overpower a better unique snippet", () => {
	it("deduplication removes near-identical copies; unique winner still wins", () => {
		const duplicate: NarrativeCandidate = {
			text: "StackFactor automates analysis workflows, processing 500 deals per month.",
		};
		const duplicate2: NarrativeCandidate = {
			text: "StackFactor automates analysis workflows, processing 500 deals per month.",
		};
		const unique: NarrativeCandidate = {
			text: "StackFactor reduces analyst time by 75% through AI-powered workflow automation and native integrations with 15+ data providers — unlike manual spreadsheet-based alternatives.",
		};

		const result = selectBestNarrativeCandidate(
			[duplicate, duplicate2, unique],
			"product_differentiation",
			{ topN: 2, maxChars: 1000 },
		);

		// Result should include the unique candidate (it scores higher)
		expect(result).toContain("75%");
		// Duplicate should only appear once (deduplication)
		if (result) {
			const occurrences = (result.match(/StackFactor automates analysis workflows/g) ?? []).length;
			expect(occurrences).toBeLessThanOrEqual(1);
		}
	});

	it("rankNarrativeCandidates deduplicates before scoring", () => {
		const candidates: NarrativeCandidate[] = [
			{ text: "Platform integrates with Salesforce to automate workflows, saving 40% of analyst time." },
			{ text: "Platform integrates with Salesforce to automate workflows, saving 40% of analyst time." },
			{ text: "Platform integrates with Salesforce to automate workflows, saving 40% of analyst time." },
		];
		const ranked = rankNarrativeCandidates(candidates, "product_differentiation");
		// All 3 are identical → deduped to 1
		expect(ranked).toHaveLength(1);
	});
});

// ─── scoreNarrativeCandidate: universal positive signals ─────────────────────

describe("scoreNarrativeCandidate — universal positive signals", () => {
	it("quantitative detail (+15) fires for currency amounts", () => {
		const s = signals("Revenue of $2.4M as of Q4.");
		expect(s.some((x) => x.includes("quantitative_detail"))).toBe(true);
	});

	it("quantitative detail fires for percentages", () => {
		const s = signals("Gross margin of 78%.");
		expect(s.some((x) => x.includes("quantitative_detail"))).toBe(true);
	});

	it("quantitative detail fires for multipliers", () => {
		const s = signals("Growing 3x year over year with 200 customers.");
		expect(s.some((x) => x.includes("quantitative_detail"))).toBe(true);
	});

	it("complete sentence bonus fires for capital start + terminal punctuation", () => {
		const s = signals("We automate accounting workflows for SMBs.");
		expect(s.some((x) => x.includes("complete_sentence"))).toBe(true);
	});

	it("multi-sentence bonus fires when text has continuation sentence", () => {
		const s = signals("We automate workflows. The platform integrates with 15 tools.");
		expect(s.some((x) => x.includes("multi_sentence"))).toBe(true);
	});

	it("comparative language bonus fires for 'versus'", () => {
		const s = signals("Our solution processes 10x faster versus legacy systems.");
		expect(s.some((x) => x.includes("comparative_language"))).toBe(true);
	});

	it("evidence-backed bonus fires for 'we achieved'", () => {
		const s = signals("We achieved 115% net revenue retention in FY24.");
		expect(s.some((x) => x.includes("evidence_backed"))).toBe(true);
	});

	it("too_short penalty fires for text under 20 chars", () => {
		const result = scoreNarrativeCandidate("Short text.", "traction");
		expect(result.signals.some((s) => s.includes("too_short"))).toBe(true);
		expect(result.score).toBeLessThanOrEqual(-20);
	});

	it("short(<50) penalty fires for text 20-49 chars", () => {
		const s = signals("We build software for financial teams.", "business_quality");
		expect(s.some((x) => x.includes("short(<50chars)"))).toBe(true);
	});

	it("adequate_length bonus fires for text >= 100 chars", () => {
		const longText = "We build workflow automation software that integrates with CRM platforms and reduces manual data entry for financial analysts by 60%.";
		const s = signals(longText);
		expect(s.some((x) => x.includes("adequate_length"))).toBe(true);
	});

	it("placeholder_text penalty fires for 'not determinable'", () => {
		const s = signals("Revenue: not determinable at this point.", "financial_outlook");
		expect(s.some((x) => x.includes("placeholder_text"))).toBe(true);
	});

	it("placeholder_text penalty fires for 'tbd'", () => {
		const s = signals("Raise amount TBD. Terms to be determined.", "capital_and_raise");
		expect(s.some((x) => x.includes("placeholder_text"))).toBe(true);
	});
});

// ─── scoreNarrativeCandidate: generic suppression signals (Phase 5) ──────────

describe("scoreNarrativeCandidate — GENERIC_SUPPRESSION_SIGNALS", () => {
	it("covers all 21 defined suppression patterns (each has a label)", () => {
		// Ensure the suppression array is fully populated (15 original + 6 capital-raise)
		expect(GENERIC_SUPPRESSION_SIGNALS).toHaveLength(21);
	});

	it("'innovative platform' triggers generic suppression penalty", () => {
		const s = signals("We are an innovative platform serving financial institutions.");
		expect(s.some((x) => x.includes("suppress:"))).toBe(true);
	});

	it("'cutting-edge' triggers suppression", () => {
		const s = signals(
			"Our cutting-edge technology delivers real-time financial insights.",
			"product_differentiation",
		);
		expect(s.some((x) => x.includes("generic:cutting_edge"))).toBe(true);
	});

	it("'world-class' triggers suppression", () => {
		const s = signals("We have a world-class team with deep domain expertise.");
		expect(s.some((x) => x.includes("generic:world_class"))).toBe(true);
	});

	it("'game-changing' triggers suppression", () => {
		const s = signals("Our game-changing approach disrupts legacy workflows.");
		expect(s.some((x) => x.includes("generic:game_changing"))).toBe(true);
	});

	it("'state-of-the-art' triggers suppression", () => {
		const s = signals("Built on state-of-the-art infrastructure.");
		expect(s.some((x) => x.includes("generic:state_of_the_art"))).toBe(true);
	});

	it("'revolutionary' triggers suppression", () => {
		const s = signals("Our revolutionary approach is transforming the industry.");
		expect(s.some((x) => x.includes("generic:revolutionary"))).toBe(true);
	});

	it("'leverages AI' without outcome clause triggers suppression", () => {
		const s = signals("The platform leverages AI to help businesses succeed.");
		expect(s.some((x) => x.includes("generic:leverages_ai_ungrounded"))).toBe(true);
	});

	it("generic penalty is capped at 30 total across multiple suppressions", () => {
		// Three suppression triggers present
		const text =
			"We are an innovative platform with a game-changing approach and cutting-edge state-of-the-art technology.";
		const result = scoreNarrativeCandidate(text, "product_differentiation");
		const suppressPenalty = result.signals
			.filter((s) => s.startsWith("suppress:"))
			.reduce((acc, s) => {
				const match = s.match(/\(-(\d+)\)$/);
				return acc + (match ? parseInt(match[1], 10) : 0);
			}, 0);
		expect(suppressPenalty).toBeLessThanOrEqual(30);
	});

	// ── Capital-raise boilerplate suppression (added for Palm regression) ──────

	it("'strategic hires' triggers suppression", () => {
		const s = signals(
			"This seed round will fund strategic hires to scale the sales team.",
			"product_differentiation",
		);
		expect(s.some((x) => x.includes("generic:strategic_hires"))).toBe(true);
	});

	it("'unlock the growth' triggers suppression", () => {
		const s = signals(
			"Opportunity. Proof of Concept. Unlock the growth potential in our market.",
			"product_differentiation",
		);
		expect(s.some((x) => x.includes("generic:unlock_growth"))).toBe(true);
	});

	it("'seed round will enable' triggers suppression", () => {
		const s = signals(
			"This seed round will enable Palm to scale marketing while brand relevance is growing.",
			"product_differentiation",
		);
		expect(s.some((x) => x.includes("generic:raise_enables_verb"))).toBe(true);
	});

	it("'capital allocation' triggers suppression", () => {
		const s = signals(
			"CAPITAL ALLOCATION — Strategic Hires. To recognise our growth opportunity.",
			"product_differentiation",
		);
		expect(s.some((x) => x.includes("generic:capital_allocation"))).toBe(true);
	});

	it("'scale our marketing' triggers suppression", () => {
		const s = signals(
			"Proceeds will allow us to scale our marketing efforts across key channels.",
			"product_differentiation",
		);
		expect(s.some((x) => x.includes("generic:scale_marketing"))).toBe(true);
	});

	it("'engage the necessary talent' triggers suppression", () => {
		const s = signals(
			"We will engage the necessary talent to drive growth in the next 18 months.",
			"product_differentiation",
		);
		expect(s.some((x) => x.includes("generic:engage_talent"))).toBe(true);
	});

	it("genuine product description (Palm page 13) does NOT trigger capital-raise suppression", () => {
		const s = signals(
			"Palm enables the lifestyle of golf. Our apparel and accessories are rooted in the game of golf but are worn by lovers of golf on and off the course.",
			"product_differentiation",
		);
		expect(s.some((x) => x.includes("generic:strategic_hires"))).toBe(false);
		expect(s.some((x) => x.includes("generic:capital_allocation"))).toBe(false);
		expect(s.some((x) => x.includes("generic:scale_marketing"))).toBe(false);
	});
});

// ─── scoreNarrativeCandidate: topic-specific signals ─────────────────────────

describe("scoreNarrativeCandidate — product_differentiation topic signals", () => {
	it("workflow/automation signal fires", () => {
		const s = signals("We automate due diligence workflows across deal teams.");
		expect(s.some((x) => x.includes("product:workflow_automation"))).toBe(true);
	});

	it("integration signal fires for 'integrating with'", () => {
		const s = signals("Our platform integrates with Salesforce, HubSpot, and Notion.");
		expect(s.some((x) => x.includes("product:integration"))).toBe(true);
	});

	it("proprietary claim fires", () => {
		const s = signals(
			"Our proprietary scoring algorithm uses 200+ signals to rank deal quality.",
		);
		expect(s.some((x) => x.includes("product:proprietary_claim"))).toBe(true);
	});

	it("why_better fires for 'unlike'", () => {
		const s = signals(
			"Unlike spreadsheet-based tools, we provide real-time structured extraction.",
		);
		expect(s.some((x) => x.includes("product:why_better"))).toBe(true);
	});

	it("use_case_language fires for 'how it works'", () => {
		const s = signals("Here is how it works: upload a PDF and receive a structured report.");
		expect(s.some((x) => x.includes("product:use_case_language"))).toBe(true);
	});
});

describe("scoreNarrativeCandidate — go_to_market_strategy topic signals", () => {
	it("icp_segment fires for 'ICP'", () => {
		const s = signals("Our ICP is Series-A fintech startups with 20-200 employees.", "go_to_market_strategy");
		expect(s.some((x) => x.includes("gtm:icp_segment"))).toBe(true);
	});

	it("per_unit_pricing fires for '$299/seat/year'", () => {
		const s = signals("Pricing is $299/seat/year with a free trial available.", "go_to_market_strategy");
		expect(s.some((x) => x.includes("gtm:per_unit_pricing"))).toBe(true);
	});

	it("pricing_model fires for 'freemium'", () => {
		const s = signals("We use a freemium model with enterprise plan upgrades.", "go_to_market_strategy");
		expect(s.some((x) => x.includes("gtm:pricing_model"))).toBe(true);
	});

	it("channel_partner fires for 'partnerships'", () => {
		const s = signals("We distribute through partnerships with 3 regional SIs.", "go_to_market_strategy");
		expect(s.some((x) => x.includes("gtm:channel_partner"))).toBe(true);
	});

	it("segment_clarity fires for 'SMB'", () => {
		const s = signals("We focus exclusively on SMB financial teams.", "go_to_market_strategy");
		expect(s.some((x) => x.includes("gtm:segment_clarity"))).toBe(true);
	});
});

describe("scoreNarrativeCandidate — financial_outlook topic signals", () => {
	it("arr_mrr fires for 'ARR'", () => {
		const s = signals("ARR of $2.4M as of Q4 2024.", "financial_outlook");
		expect(s.some((x) => x.includes("financial:arr_mrr"))).toBe(true);
	});

	it("growth_rate fires for percentage + YoY", () => {
		const s = signals("Revenue grew at 115% YoY with strong enterprise momentum.", "financial_outlook");
		expect(s.some((x) => x.includes("financial:growth_rate"))).toBe(true);
	});

	it("unit_economics fires for 'LTV/CAC'", () => {
		const s = signals("LTV/CAC ratio of 4.2x with 18-month payback period.", "financial_outlook");
		expect(s.some((x) => x.includes("financial:unit_economics"))).toBe(true);
	});

	it("burn_runway fires", () => {
		const s = signals("Current monthly burn of $180K with 18 months of runway.", "financial_outlook");
		expect(s.some((x) => x.includes("financial:burn_runway"))).toBe(true);
	});
});

describe("scoreNarrativeCandidate — capital_and_raise topic signals", () => {
	it("raise_with_amount fires for 'raising $X'", () => {
		const s = signals("We are raising $3M in a Series A round.", "capital_and_raise");
		expect(s.some((x) => x.includes("capital:raise_with_amount"))).toBe(true);
	});

	it("instrument fires for 'SAFE'", () => {
		const s = signals("The raise is structured as a SAFE with a $12M valuation cap.", "capital_and_raise");
		expect(s.some((x) => x.includes("capital:instrument"))).toBe(true);
	});

	it("use_of_funds fires", () => {
		const s = signals("Use of funds: 60% product development, 40% sales hires.", "capital_and_raise");
		expect(s.some((x) => x.includes("capital:use_of_funds"))).toBe(true);
	});
});

describe("scoreNarrativeCandidate — traction topic signals", () => {
	it("customer_count fires for '50 customers'", () => {
		const s = signals("We have 50 paying customers as of Q4.", "traction");
		expect(s.some((x) => x.includes("traction:customer_count"))).toBe(true);
	});

	it("retention fires for 'NRR'", () => {
		const s = signals("NRR of 118% indicates strong expansion revenue.", "traction");
		expect(s.some((x) => x.includes("traction:retention"))).toBe(true);
	});

	it("numeric_growth fires for 'grew 3x'", () => {
		const s = signals("Revenue grew 3x YoY in 2024.", "traction");
		expect(s.some((x) => x.includes("traction:numeric_growth"))).toBe(true);
	});
});

describe("scoreNarrativeCandidate — market_position topic signals", () => {
	it("tam_sam_som fires for 'TAM'", () => {
		const s = signals("Total addressable market (TAM) of $45B.", "market_position");
		expect(s.some((x) => x.includes("market:tam_sam_som"))).toBe(true);
	});

	it("competitor_mention fires for 'incumbent'", () => {
		const s = signals(
			"Incumbent solutions like QuickBooks leave a significant gap.",
			"market_position",
		);
		expect(s.some((x) => x.includes("market:competitor_mention"))).toBe(true);
	});

	it("growth_context fires for 'CAGR'", () => {
		const s = signals("The market is growing at 22% CAGR through 2028.", "market_position");
		expect(s.some((x) => x.includes("market:growth_context"))).toBe(true);
	});
});

describe("scoreNarrativeCandidate — business_quality topic signals", () => {
	it("unit_economics fires for 'LTV'", () => {
		const s = signals("LTV of $24K with a 12-month payback on CAC.", "business_quality");
		expect(s.some((x) => x.includes("biz:unit_economics"))).toBe(true);
	});

	it("defensibility fires for 'network effects'", () => {
		const s = signals(
			"As more investors join, network effects compound deal quality.",
			"business_quality",
		);
		expect(s.some((x) => x.includes("biz:defensibility"))).toBe(true);
	});

	it("recurring_model fires for 'ARR-based'", () => {
		const s = signals(
			"Our ARR-based subscription model provides highly predictable revenue.",
			"business_quality",
		);
		expect(s.some((x) => x.includes("biz:recurring_model"))).toBe(true);
	});
});

// ─── Source type bonus ────────────────────────────────────────────────────────

describe("scoreNarrativeCandidate — source type bonus", () => {
	const baseText =
		"We automate workflow processes for financial institutions, saving analysts 40% of manual effort per deal.";

	it("canonical_fact gets +5 bonus", () => {
		const withBonus = scoreNarrativeCandidate(baseText, "product_differentiation", {
			sourceType: "canonical_fact",
		});
		const withoutBonus = scoreNarrativeCandidate(baseText, "product_differentiation");
		expect(withBonus.score - withoutBonus.score).toBe(5);
	});

	it("structured_section gets +3 bonus", () => {
		const withBonus = scoreNarrativeCandidate(baseText, "product_differentiation", {
			sourceType: "structured_section",
		});
		const withoutBonus = scoreNarrativeCandidate(baseText, "product_differentiation");
		expect(withBonus.score - withoutBonus.score).toBe(3);
	});

	it("focused_bundle gets +1 bonus", () => {
		const withBonus = scoreNarrativeCandidate(baseText, "product_differentiation", {
			sourceType: "focused_bundle",
		});
		const withoutBonus = scoreNarrativeCandidate(baseText, "product_differentiation");
		expect(withBonus.score - withoutBonus.score).toBe(1);
	});

	it("raw_ocr_page gets no bonus", () => {
		const withBonus = scoreNarrativeCandidate(baseText, "product_differentiation", {
			sourceType: "raw_ocr_page",
		});
		const withoutBonus = scoreNarrativeCandidate(baseText, "product_differentiation");
		expect(withBonus.score - withoutBonus.score).toBe(0);
	});

	it("canonical_fact scores higher than raw_ocr_page for same text", () => {
		const canonical = scoreNarrativeCandidate(baseText, "product_differentiation", {
			sourceType: "canonical_fact",
		});
		const raw = scoreNarrativeCandidate(baseText, "product_differentiation", {
			sourceType: "raw_ocr_page",
		});
		expect(canonical.score).toBeGreaterThan(raw.score);
	});
});

// ─── Confidence level bonus (PR36.6) ─────────────────────────────────────────

describe("scoreNarrativeCandidate — confidence level bonus", () => {
	const baseText =
		"ARR of $2.4M growing at 115% YoY. Gross margin of 78%, with 18 months of runway.";

	it("STRONG_EVIDENCE gets +5 bonus", () => {
		const with_ = scoreNarrativeCandidate(baseText, "financial_outlook", {
			confidenceLevel: "STRONG_EVIDENCE",
		});
		const without_ = scoreNarrativeCandidate(baseText, "financial_outlook");
		expect(with_.score - without_.score).toBe(5);
	});

	it("VERIFIED gets +5 bonus", () => {
		const with_ = scoreNarrativeCandidate(baseText, "financial_outlook", {
			confidenceLevel: "VERIFIED",
		});
		const without_ = scoreNarrativeCandidate(baseText, "financial_outlook");
		expect(with_.score - without_.score).toBe(5);
	});

	it("WEAK_EVIDENCE gets -2 penalty", () => {
		const with_ = scoreNarrativeCandidate(baseText, "financial_outlook", {
			confidenceLevel: "WEAK_EVIDENCE",
		});
		const without_ = scoreNarrativeCandidate(baseText, "financial_outlook");
		expect(with_.score - without_.score).toBe(-2);
	});

	it("CONFLICTING gets -15 penalty", () => {
		const with_ = scoreNarrativeCandidate(baseText, "financial_outlook", {
			confidenceLevel: "CONFLICTING",
		});
		const without_ = scoreNarrativeCandidate(baseText, "financial_outlook");
		expect(with_.score - without_.score).toBe(-15);
	});

	it("PROVISIONAL gets -5 penalty", () => {
		const with_ = scoreNarrativeCandidate(baseText, "financial_outlook", {
			confidenceLevel: "PROVISIONAL",
		});
		const without_ = scoreNarrativeCandidate(baseText, "financial_outlook");
		expect(with_.score - without_.score).toBe(-5);
	});

	it("SUPPRESSED gets -50 penalty (effectively removes from selection)", () => {
		const with_ = scoreNarrativeCandidate(baseText, "financial_outlook", {
			confidenceLevel: "SUPPRESSED",
		});
		const without_ = scoreNarrativeCandidate(baseText, "financial_outlook");
		expect(with_.score - without_.score).toBe(-50);
	});

	it("SUPPRESSED candidate does not win selection over unconfidenced one", () => {
		const suppressed: NarrativeCandidate = {
			text: baseText,
			meta: { confidenceLevel: "SUPPRESSED" },
		};
		const normal: NarrativeCandidate = {
			text: "ARR of $1.8M with 90% gross margin and 24-month runway at current burn.",
		};
		const result = selectBestNarrativeCandidate([suppressed, normal], "financial_outlook");
		expect(result).toContain("$1.8M");
	});
});

// ─── rankNarrativeCandidates ──────────────────────────────────────────────────

describe("rankNarrativeCandidates", () => {
	it("returns candidates sorted descending by score", () => {
		const candidates: NarrativeCandidate[] = [
			{
				text: "We are an innovative solution for modern businesses.",
			},
			{
				text: "Our workflow automation reduces analyst time by 60% by integrating with CRM platforms unlike legacy tools.",
			},
			{
				text: "Platform processes 200 deals per month with proprietary scoring algorithms.",
			},
		];
		const ranked = rankNarrativeCandidates(candidates, "product_differentiation");
		expect(ranked.length).toBeGreaterThanOrEqual(2);
		for (let i = 1; i < ranked.length; i++) {
			expect(ranked[i - 1].score).toBeGreaterThanOrEqual(ranked[i].score);
		}
	});

	it("includes score and signals in returned objects", () => {
		const candidates: NarrativeCandidate[] = [
			{
				text: "We automate financial workflows with native integrations, saving 40% of analyst time.",
				meta: { sourceType: "raw_ocr_page" },
			},
		];
		const ranked = rankNarrativeCandidates(candidates, "product_differentiation");
		expect(typeof ranked[0].score).toBe("number");
		expect(Array.isArray(ranked[0].signals)).toBe(true);
		expect(ranked[0].signals.length).toBeGreaterThan(0);
	});

	it("deduplicates before ranking", () => {
		const text =
			"We automate due diligence workflows for 50+ VC firms, reducing analyst time by 60%.";
		const candidates: NarrativeCandidate[] = [
			{ text },
			{ text },
			{ text: "Our platform integrates with Salesforce and reduces deal review to under 2 hours." },
		];
		const ranked = rankNarrativeCandidates(candidates, "product_differentiation");
		expect(ranked).toHaveLength(2);
	});
});

// ─── selectBestNarrativeCandidate ─────────────────────────────────────────────

describe("selectBestNarrativeCandidate", () => {
	it("respects maxChars option", () => {
		const candidates: NarrativeCandidate[] = [
			{
				text: "We automate due diligence workflows for VC firms, integrating with 15+ data providers and reducing analyst time by 60% versus legacy spreadsheet tools. Our proprietary scoring model processes 200+ signals.",
			},
		];
		const result = selectBestNarrativeCandidate(candidates, "product_differentiation", {
			topN: 1,
			maxChars: 50,
		});
		expect(result).not.toBeNull();
		expect(result!.length).toBeLessThanOrEqual(50);
	});

	it("combines topN candidates with double newline separator", () => {
		const candidates: NarrativeCandidate[] = [
			{
				text: "We automate due diligence workflows for VC firms, reducing analyst time by 60%.",
			},
			{
				text: "Our platform integrates with Salesforce, HubSpot, and 13 other CRMs unlike any spreadsheet tool.",
			},
			{
				text: "Using proprietary AI algorithms, we process 200+ signals per document.",
			},
		];
		const result = selectBestNarrativeCandidate(candidates, "product_differentiation", {
			topN: 3,
			maxChars: 2000,
		});
		expect(result).not.toBeNull();
		// Multiple candidates joined with \n\n
		expect(result).toContain("\n\n");
	});

	it("returns single best candidate when topN=1", () => {
		const candidates: NarrativeCandidate[] = [
			{
				text: "We automate due diligence workflows, saving analysts 60% of their time.",
			},
			{
				text: "Our proprietary scoring model processes 200+ signals to rank deal quality.",
			},
		];
		const result = selectBestNarrativeCandidate(candidates, "product_differentiation", {
			topN: 1,
			maxChars: 500,
		});
		expect(result).not.toBeNull();
		// With topN=1, no double newline separator
		expect(result).not.toContain("\n\n");
	});

	it("returns null when best candidate is below TOPIC_MIN_THRESHOLD", () => {
		const candidates: NarrativeCandidate[] = [
			{ text: "We are a next-generation platform designed to enhance business outcomes." },
		];
		const result = selectBestNarrativeCandidate(candidates, "product_differentiation");
		expect(result).toBeNull();
	});

	it("traction has lower threshold — specific but brief claim qualifies", () => {
		const candidates: NarrativeCandidate[] = [
			{ text: "We have 50 paying customers as of Q3." },
		];
		const result = selectBestNarrativeCandidate(candidates, "traction");
		expect(result).not.toBeNull();
	});

	it("source type bonus can push borderline candidate above threshold", () => {
		// This text has topic signals but may be borderline without bonus
		const borderline =
			"Our NRR of 112% demonstrates strong retention among enterprise accounts.";
		const withoutBonus = scoreNarrativeCandidate(borderline, "business_quality");
		const withBonus = scoreNarrativeCandidate(borderline, "business_quality", {
			sourceType: "canonical_fact",
		});

		// Both should be above threshold in this case, confirming bonus adds value
		expect(withBonus.score).toBeGreaterThan(withoutBonus.score);
		expect(withBonus.score).toBeGreaterThanOrEqual(TOPIC_MIN_THRESHOLD["business_quality"]);
	});
});

// ─── TOPIC_MIN_THRESHOLD ──────────────────────────────────────────────────────

describe("TOPIC_MIN_THRESHOLD covers all 7 topics", () => {
	const topics: NarrativeTopic[] = [
		"product_differentiation",
		"go_to_market_strategy",
		"market_position",
		"financial_outlook",
		"capital_and_raise",
		"traction",
		"business_quality",
	];

	for (const topic of topics) {
		it(`${topic} threshold is a positive number`, () => {
			expect(TOPIC_MIN_THRESHOLD[topic]).toBeGreaterThan(0);
		});
	}

	it("traction and business_quality have lower thresholds than financial topics", () => {
		expect(TOPIC_MIN_THRESHOLD["traction"]).toBeLessThan(
			TOPIC_MIN_THRESHOLD["financial_outlook"],
		);
		expect(TOPIC_MIN_THRESHOLD["business_quality"]).toBeLessThan(
			TOPIC_MIN_THRESHOLD["capital_and_raise"],
		);
	});
});

// ─── Edge cases ───────────────────────────────────────────────────────────────

describe("edge cases", () => {
	it("empty string scores -100", () => {
		const result = scoreNarrativeCandidate("", "traction");
		expect(result.score).toBe(-100);
	});

	it("single word scores negatively", () => {
		expect(score("Automation.")).toBeLessThan(0);
	});

	it("very long candidate is trimmed to maxChars in output", () => {
		const longText = "A".repeat(5000);
		const candidates: NarrativeCandidate[] = [
			{
				text: `We automate due diligence workflows. ${longText} With NRR of 120%.`,
			},
		];
		const result = selectBestNarrativeCandidate(candidates, "product_differentiation", {
			maxChars: 200,
		});
		if (result) {
			expect(result.length).toBeLessThanOrEqual(200);
		}
	});

	it("near-duplicate detection is case/whitespace insensitive", () => {
		const candidates: NarrativeCandidate[] = [
			{
				text: "We automate  due diligence workflows for 50 VC firms, reducing analyst time by 60%.",
			},
			{
				text: "we automate due diligence workflows for 50 vc firms, reducing analyst time by 60%.",
			},
		];
		const ranked = rankNarrativeCandidates(candidates, "product_differentiation");
		expect(ranked).toHaveLength(1);
	});

	it("combined sourceType and confidenceLevel signals both appear", () => {
		const text =
			"Our workflow automation integrates with 15+ CRMs, reducing analyst time by 60%.";
		const result = scoreNarrativeCandidate(text, "product_differentiation", {
			sourceType: "canonical_fact",
			confidenceLevel: "STRONG_EVIDENCE",
		});
		expect(result.signals.some((s) => s.includes("source:"))).toBe(true);
		expect(result.signals.some((s) => s.includes("confidence:"))).toBe(true);
	});
});
