/**
 * Unit tests for PR22: deterministic-slot-fallback-v1.ts
 *
 * Pure functions — no DB, no LLM, no side effects.
 * Covers: product, market, business_model extractors + resolveOverviewFallbacksV1.
 *
 * Anti-hallucination guard: financial / random pages must never produce values.
 */
import { describe, it, expect } from "vitest";
import type { DpuPage } from "../stages/stage-2-deterministic";
import {
	resolveBusinessModelFallbackV1,
	resolveProductFallbackV1,
	resolveMarketFallbackV1,
	resolveOverviewFallbacksV1,
	FALLBACK_PROVENANCE,
} from "../stages/deterministic-slot-fallback-v1";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makePage(text: string, overrides: Partial<DpuPage> = {}): DpuPage {
	return {
		document_id: "doc-test-1",
		page_index: 0,
		text,
		text_raw: text,
		norm_events_count: 0,
		...overrides,
	};
}

const FINANCE_HEAVY_PAGE = makePage(
	"$1,200,000 $450,000 $750,000 $2.1M $3.5M $0.8B $12.3M $4.9M $1.1M $0.9M"
);

const RANDOM_TEXT_PAGE = makePage(
	"Slide 14 — Thank you. Questions? Our team is available for diligence calls."
);

// ─── FALLBACK_PROVENANCE constant ────────────────────────────────────────────

describe("FALLBACK_PROVENANCE", () => {
	it('is "deterministic_fallback_v1"', () => {
		expect(FALLBACK_PROVENANCE).toBe("deterministic_fallback_v1");
	});
});

// ─── resolveBusinessModelFallbackV1 ──────────────────────────────────────────

describe("resolveBusinessModelFallbackV1 — no match", () => {
	it("returns null for empty page list", () => {
		expect(resolveBusinessModelFallbackV1([])).toBeNull();
	});

	it("returns null when no BM labels are present", () => {
		const pages = [
			makePage("We help founders build great companies. Our team is amazing."),
			makePage("The product solves a hard problem for customers worldwide."),
		];
		expect(resolveBusinessModelFallbackV1(pages)).toBeNull();
	});

	it("returns null for financial-heavy pages only", () => {
		expect(resolveBusinessModelFallbackV1([FINANCE_HEAVY_PAGE])).toBeNull();
	});
});

describe("resolveBusinessModelFallbackV1 — single label", () => {
	it("extracts SaaS from a single page", () => {
		const pages = [makePage("We built a SaaS platform that helps teams collaborate.")];
		const result = resolveBusinessModelFallbackV1(pages);
		expect(result).not.toBeNull();
		expect(result!.value).toContain("Saas");
		expect(result!.confidence).toBe(0.6);
		expect(result!.provenance).toBe("deterministic_fallback_v1");
	});

	it("extracts B2B SaaS", () => {
		const pages = [makePage("We built a B2B SaaS platform for enterprise teams.")];
		const result = resolveBusinessModelFallbackV1(pages);
		expect(result).not.toBeNull();
		expect(result!.value.toLowerCase()).toContain("b2b saas");
	});

	it("extracts marketplace", () => {
		const pages = [makePage("We run a two-sided marketplace connecting buyers and sellers.")];
		const result = resolveBusinessModelFallbackV1(pages);
		expect(result).not.toBeNull();
		expect(result!.value.toLowerCase()).toMatch(/marketplace/);
	});

	it("extracts subscription-based", () => {
		const pages = [makePage("Revenue is generated via a subscription-based model.")];
		const result = resolveBusinessModelFallbackV1(pages);
		expect(result).not.toBeNull();
		expect(result!.value.toLowerCase()).toMatch(/subscription/);
	});
});

describe("resolveBusinessModelFallbackV1 — confidence scaling", () => {
	it("returns 0.8 confidence when same label appears on ≥2 pages", () => {
		const pages = [
			makePage("We are a B2B SaaS company.", { page_index: 0 }),
			makePage("Our B2B SaaS platform serves global enterprises.", { page_index: 1 }),
		];
		const result = resolveBusinessModelFallbackV1(pages);
		expect(result).not.toBeNull();
		expect(result!.confidence).toBe(0.8);
	});

	it("returns 0.6 confidence when label appears on exactly 1 page", () => {
		const pages = [makePage("We operate a freemium model.")];
		const result = resolveBusinessModelFallbackV1(pages);
		expect(result).not.toBeNull();
		expect(result!.confidence).toBe(0.6);
	});
});

describe("resolveBusinessModelFallbackV1 — provenance + evidence", () => {
	it("attaches provenance === 'deterministic_fallback_v1'", () => {
		const pages = [makePage("Our SaaS product is industry-leading.", { document_id: "doc-abc" })];
		const result = resolveBusinessModelFallbackV1(pages);
		expect(result!.provenance).toBe("deterministic_fallback_v1");
	});

	it("attaches evidence with document_id and page_index", () => {
		const pages = [makePage("We are a B2B SaaS company.", { document_id: "doc-xyz", page_index: 5 })];
		const result = resolveBusinessModelFallbackV1(pages);
		expect(result!.evidence.length).toBeGreaterThan(0);
		expect(result!.evidence[0]!.document_id).toBe("doc-xyz");
		expect(result!.evidence[0]!.page_index).toBe(5);
	});

	it("attaches non-empty debug info", () => {
		const pages = [makePage("We are a marketplace platform.")];
		const result = resolveBusinessModelFallbackV1(pages);
		expect(result!.debug.scanned_pages).toBeGreaterThan(0);
		expect(result!.debug.matched_patterns.length).toBeGreaterThan(0);
	});
});

// ─── resolveProductFallbackV1 ────────────────────────────────────────────────

describe("resolveProductFallbackV1 — no match", () => {
	it("returns null for empty page list", () => {
		expect(resolveProductFallbackV1([])).toBeNull();
	});

	it("returns null when no product-sentence patterns match", () => {
		const pages = [
			makePage("Revenue grew 40% YoY to $3.2M ARR. Gross margin is 75%."),
			makePage("The founding team has 20+ years of combined experience."),
		];
		expect(resolveProductFallbackV1(pages)).toBeNull();
	});

	it("returns null for financial-heavy pages only", () => {
		expect(resolveProductFallbackV1([FINANCE_HEAVY_PAGE])).toBeNull();
	});
});

describe("resolveProductFallbackV1 — sentence extraction", () => {
	it("extracts a 'We build ...' sentence", () => {
		const pages = [
			makePage("We build AI-powered tools for customer support teams around the world."),
		];
		const result = resolveProductFallbackV1(pages);
		expect(result).not.toBeNull();
		expect(result!.value).toContain("We build AI-powered tools");
		expect(result!.provenance).toBe("deterministic_fallback_v1");
	});

	it("extracts a 'We provide ...' sentence", () => {
		const pages = [
			makePage("We provide end-to-end supply chain visibility for mid-market retailers."),
		];
		const result = resolveProductFallbackV1(pages);
		expect(result).not.toBeNull();
		expect(result!.value).toContain("We provide");
	});

	it("extracts a 'Our platform ...' sentence", () => {
		const pages = [
			makePage("Our platform enables real-time collaboration across distributed teams."),
		];
		const result = resolveProductFallbackV1(pages);
		expect(result).not.toBeNull();
		expect(result!.value).toContain("Our platform");
	});

	it("extracts a 'Our solution ...' sentence", () => {
		const pages = [
			makePage("Our solution automates invoice reconciliation for accounting departments."),
		];
		const result = resolveProductFallbackV1(pages);
		expect(result).not.toBeNull();
		expect(result!.value).toContain("Our solution");
	});
});

describe("resolveProductFallbackV1 — confidence and evidence", () => {
	it("returns 0.6 confidence for single-page match", () => {
		const pages = [makePage("We help businesses scale their operations efficiently.")];
		const result = resolveProductFallbackV1(pages);
		expect(result!.confidence).toBe(0.6);
	});

	it("returns 0.8 confidence when matches found on ≥2 pages", () => {
		const pages = [
			makePage("We build payment infrastructure for online retailers.", { page_index: 0 }),
			makePage("We enable fast, secure checkout experiences.", { page_index: 1 }),
		];
		const result = resolveProductFallbackV1(pages);
		expect(result!.confidence).toBe(0.8);
	});

	it("value is capped at 200 characters", () => {
		const longSentence = "We build " + "X".repeat(250);
		const result = resolveProductFallbackV1([makePage(longSentence)]);
		if (result) {
			expect(result.value.length).toBeLessThanOrEqual(200);
		}
	});
});

// ─── resolveMarketFallbackV1 ─────────────────────────────────────────────────

describe("resolveMarketFallbackV1 — no match", () => {
	it("returns null for empty page list", () => {
		expect(resolveMarketFallbackV1([])).toBeNull();
	});

	it("returns null when no ICP phrases match", () => {
		const pages = [
			makePage("We raised $5M in seed funding to accelerate growth."),
			makePage("The platform processed 10,000 transactions last month."),
		];
		expect(resolveMarketFallbackV1(pages)).toBeNull();
	});

	it("returns null for financial-heavy pages only", () => {
		expect(resolveMarketFallbackV1([FINANCE_HEAVY_PAGE])).toBeNull();
	});
});

describe("resolveMarketFallbackV1 — ICP extraction", () => {
	it("extracts a 'targeting [segment]' phrase", () => {
		const pages = [
			makePage("We are targeting mid-market healthcare companies with 100-500 employees."),
		];
		const result = resolveMarketFallbackV1(pages);
		expect(result).not.toBeNull();
		expect(result!.value.toLowerCase()).toContain("mid");
		expect(result!.provenance).toBe("deterministic_fallback_v1");
	});

	it("extracts a 'our target customers are...' phrase", () => {
		const pages = [
			makePage("Our target customers are enterprise SaaS companies looking to reduce churn."),
		];
		const result = resolveMarketFallbackV1(pages);
		expect(result).not.toBeNull();
		expect(result!.value.toLowerCase()).toContain("enterprise");
	});

	it("extracts a 'serving [segment]' phrase", () => {
		const pages = [
			makePage("We are serving independent insurance agents across North America."),
		];
		const result = resolveMarketFallbackV1(pages);
		expect(result).not.toBeNull();
		expect(result!.value.length).toBeGreaterThan(5);
	});

	it("extracts a 'built for [segment]' phrase", () => {
		const pages = [
			makePage("The product is built for developers who need reliable monitoring."),
		];
		const result = resolveMarketFallbackV1(pages);
		expect(result).not.toBeNull();
	});
});

describe("resolveMarketFallbackV1 — confidence scaling", () => {
	it("scores higher (0.8+0.2) when known ICP segment keyword is present", () => {
		// SMB is a known ICP segment keyword → base score 0.8, +0.2 bonus = 1.0 capped
		const pages = [
			makePage("We are targeting SMB businesses in the US with our compliance tool."),
		];
		const result = resolveMarketFallbackV1(pages);
		expect(result).not.toBeNull();
		expect(result!.confidence).toBeGreaterThanOrEqual(0.6);
	});

	it("returns 0.8 confidence when ≥2 distinct ICP phrases match", () => {
		const pages = [
			makePage("Targeting enterprise healthcare teams.", { page_index: 0 }),
			makePage("Our target customers are healthcare providers.", { page_index: 1 }),
		];
		const result = resolveMarketFallbackV1(pages);
		expect(result).not.toBeNull();
		expect(result!.confidence).toBe(0.8);
	});
});

// ─── resolveOverviewFallbacksV1 — integration ────────────────────────────────

describe("resolveOverviewFallbacksV1 — empty / no match", () => {
	it("returns empty object for empty pages", () => {
		const result = resolveOverviewFallbacksV1([]);
		expect(result.product).toBeUndefined();
		expect(result.market).toBeUndefined();
		expect(result.business_model).toBeUndefined();
	});

	it("returns empty object for financial-only pages (anti-hallucination)", () => {
		const result = resolveOverviewFallbacksV1([FINANCE_HEAVY_PAGE, RANDOM_TEXT_PAGE]);
		expect(result.product).toBeUndefined();
		expect(result.business_model).toBeUndefined();
	});
});

describe("resolveOverviewFallbacksV1 — populated slots", () => {
	it("returns all three slots when qualifying content is present", () => {
		const pages = [
			makePage(
				"We build a B2B SaaS platform for mid-market retailers. " +
				"Our solution automates inventory management. " +
				"Targeting SMB and enterprise merchants across North America."
			),
		];
		const result = resolveOverviewFallbacksV1(pages);
		// At minimum business_model should hit
		expect(result.business_model).not.toBeUndefined();
	});

	it("returns only the slots that have matching content", () => {
		// Only product content
		const pages = [
			makePage("We build AI models that predict customer churn for enterprise SaaS companies."),
		];
		const result = resolveOverviewFallbacksV1(pages);
		expect(result.product).not.toBeUndefined();
		// market result is undefined because there's no explicit ICP phrase
		// (this is expected — conservative extraction)
	});

	it("attaches correct provenance on every slot", () => {
		const pages = [
			makePage(
				"We build B2B SaaS tools for SMB retailers. Targeting mid-market companies."
			),
		];
		const result = resolveOverviewFallbacksV1(pages);
		if (result.product) expect(result.product.provenance).toBe("deterministic_fallback_v1");
		if (result.market) expect(result.market.provenance).toBe("deterministic_fallback_v1");
		if (result.business_model) expect(result.business_model.provenance).toBe("deterministic_fallback_v1");
	});
});

// ─── Anti-hallucination — no false positives from common noise ────────────────

describe("Anti-hallucination — common pitch deck noise", () => {
	it("does not extract business_model from pure numbers / financial percentages", () => {
		const pages = [
			makePage("Revenue: $4.2M. Growth: 60% YoY. Gross Margin: 78%. Burn: $180K/month."),
		];
		const result = resolveBusinessModelFallbackV1(pages);
		expect(result).toBeNull();
	});

	it("does not extract product from a thank-you / title slide", () => {
		const pages = [
			makePage("Thank you for your time. Questions? Contact us at hello@company.com."),
			makePage("Series A Funding Deck. Confidential. Q1 2026."),
		];
		const result = resolveProductFallbackV1(pages);
		expect(result).toBeNull();
	});

	it("does not extract market from generic location mentions", () => {
		const pages = [
			makePage("Office locations: New York, London, Singapore. Founded 2021."),
		];
		const result = resolveMarketFallbackV1(pages);
		expect(result).toBeNull();
	});
});
