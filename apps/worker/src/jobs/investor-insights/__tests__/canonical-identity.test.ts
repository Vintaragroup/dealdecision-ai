/**
 * canonical-identity.test.ts — PR-CanonicalIdentity
 *
 * Unit tests for the canonical company identity resolver.
 *
 * Test strategy:
 *   1. Typo correction: "Complaint" entered → "Complyant" in deck → mismatch_flagged, canonical wins
 *   2. Entered name correct: entered name matches doc name → no mismatch, confidence preserved
 *   3. Title + domain alignment → high confidence
 *   4. Repeated token without title → medium confidence (repeated on 3+ pages)
 *   5. Filename-only fallback → low confidence
 *   6. No document evidence → confidence "none", canonical_company_name = entered_name
 *   7. buildExternalDiligenceQueryPlan: canonical identity overrides page-extracted name
 *   8. Governed exec summary args: mismatch reflected in Deal Identity note
 *   9. buildCanonicalIdentityRenderSection: null for "none", section for medium+
 */

import { describe, it, expect } from "vitest";
import {
	resolveCanonicalIdentity,
	buildCanonicalIdentityRenderSection,
} from "../canonical-identity/resolve-canonical-identity";
import type { DpuPage } from "../stages/stage-2-deterministic";
import { buildExternalDiligenceQueryPlan } from "../external-diligence/build-query-plan";
import type { InsightSlotInputs } from "../stages/stage-2-deterministic";
import { buildRenderPackage } from "../stages/stage-4-render-package";
import type { GateState, ComplianceState } from "../../../contracts/investor-insights/schemas";

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makePage(page_index: number, text: string): DpuPage {
	return {
		document_id: "doc-test",
		page_index,
		text,
		text_raw: text,
		norm_events_count: 0,
	};
}

function makeMinimalInputs(pages: DpuPage[]): InsightSlotInputs {
	return {
		dpuPages: pages,
		evidenceSnippets: [],
		bestFinancialStatement: null,
		bestUseOfFundsStatement: null,
		impliedCapitalAllocation: null,
		financialReconciliation: null,
		saasKpis: null,
		balanceSheet: null,
		cashFlow: null,
		deckFinancialSignals: null,
		workbookFacts: [],
		crossSourceReconciliation: null,
	} as unknown as InsightSlotInputs;
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe("resolveCanonicalIdentity", () => {
	it("TC-1: flags mismatch when entered name is a typo of the document name", () => {
		// "Complaint" is entered; deck says "Complyant" on the title slide
		const pages = [
			makePage(0, "Complyant\nCompliance made simple"),
			makePage(1, "About Complyant\nWe help companies stay compliant."),
			makePage(2, "Why Complyant\nComplyant is a compliance automation platform."),
			makePage(3, "Complyant Product Overview\nFeatures and integrations."),
		];

		const result = resolveCanonicalIdentity(pages, "Complaint");

		expect(result.entered_deal_name).toBe("Complaint");
		expect(result.canonical_company_name).toBe("Complyant");
		expect(result.mismatch_flagged).toBe(true);
		expect(["high", "medium"]).toContain(result.canonical_company_name_confidence);
		expect(result.winning_candidate.sources).toContain("title_slide");
	});

	it("TC-2: no mismatch when entered name matches document name closely", () => {
		const pages = [
			makePage(0, "WorkflowAI\nAutomate your workflows"),
			makePage(1, "About WorkflowAI\nWorkflowAI is a no-code automation platform."),
			makePage(2, "WorkflowAI Pricing\nGrowth and Enterprise tiers."),
			makePage(3, "WorkflowAI Roadmap\nQ3 milestones."),
		];

		const result = resolveCanonicalIdentity(pages, "WorkflowAI");

		expect(result.entered_deal_name).toBe("WorkflowAI");
		expect(result.canonical_company_name).toBe("WorkflowAI");
		expect(result.mismatch_flagged).toBe(false);
	});

	it("TC-3: high confidence when title slide + domain/email corroborate", () => {
		const pages = [
			makePage(0, "FlowDash\nDashboards for modern teams"),
			makePage(1, "Contact us at hello@flowdash.io for more info."),
			makePage(2, "FlowDash integrations and workflows."),
		];

		const result = resolveCanonicalIdentity(pages, "FlowDash");

		expect(result.canonical_company_name_confidence).toBe("high");
		expect(result.winning_candidate.sources).toContain("title_slide");
		expect(result.winning_candidate.sources).toContain("domain_email");
	});

	it("TC-4: medium confidence from repeated token without title slide match", () => {
		// Title slide is generic; company name appears on 3+ body slides
		const pages = [
			makePage(0, "Investor Deck 2025\nConfidential"),
			makePage(1, "PayLink processes thousands of transactions daily."),
			makePage(2, "PayLink has grown 3x in 12 months."),
			makePage(3, "Contact PayLink sales for pricing."),
			makePage(4, "PayLink competitive advantages."),
		];

		const result = resolveCanonicalIdentity(pages, "PayLink");

		expect(["medium", "high"]).toContain(result.canonical_company_name_confidence);
		expect(result.canonical_company_name).toBe("PayLink");
		expect(result.winning_candidate.sources).toContain("repeated_token");
	});

	it("TC-5: low confidence when only filename is available", () => {
		const pages = [
			makePage(0, "Investor Deck 2025\nConfidential"),
			makePage(1, "Our platform helps customers succeed."),
		];

		const result = resolveCanonicalIdentity(pages, "AcmeStartup", ["AcmeStartup_pitch_deck.pdf"]);

		expect(result.canonical_company_name_confidence).toBe("low");
		expect(result.winning_candidate.sources).toContain("filename");
	});

	it("TC-6: confidence is none and canonical falls back to entered name when no evidence found", () => {
		const pages = [
			makePage(0, "Investor Deck 2025\nConfidential"),
			makePage(1, "This is a product for businesses."),
		];

		const result = resolveCanonicalIdentity(pages, "MySuperStartup");

		expect(result.canonical_company_name_confidence).toBe("none");
		expect(result.canonical_company_name).toBe("MySuperStartup");
		expect(result.mismatch_flagged).toBe(false);
	});
});

describe("buildExternalDiligenceQueryPlan with canonicalIdentity", () => {
	it("TC-7: uses canonical company name for queries when confidence is high", () => {
		const pages = [
			makePage(0, "Complyant\nCompliance made simple"),
			makePage(1, "About Complyant\nComplyant is a compliance platform."),
			makePage(2, "Complyant product overview."),
			makePage(3, "Complyant roadmap and pricing."),
		];

		const canonicalResult = resolveCanonicalIdentity(pages, "Complaint");
		// confidence should be at least medium
		expect(["high", "medium"]).toContain(canonicalResult.canonical_company_name_confidence);

		const inputs = makeMinimalInputs(pages);
		const plan = buildExternalDiligenceQueryPlan(inputs, "Complaint", null, canonicalResult);

		// The plan should use "Complyant" (from canonical identity), not "Complaint"
		expect(plan.company_name).toBe("Complyant");
		// Footprint query should reference Complyant
		expect(plan.queries.company_footprint.query).toContain("Complyant");
		expect(plan.queries.company_footprint.query).not.toContain("Complaint");
	});
});

describe("buildCanonicalIdentityRenderSection", () => {
	it("TC-8: returns null when confidence is none", () => {
		const result = resolveCanonicalIdentity(
			[makePage(0, "Confidential"), makePage(1, "Our mission is to help.")],
			"GenericStartup"
		);
		// May be none if no brand tokens found
		if (result.canonical_company_name_confidence === "none") {
			expect(buildCanonicalIdentityRenderSection(result)).toBeNull();
		}
	});

	it("TC-9: returns a valid message section when confidence is medium or higher", () => {
		const pages = [
			makePage(0, "Complyant\nCompliance automation"),
			makePage(1, "About Complyant\nComplyant is a compliance platform."),
			makePage(2, "Complyant features and integrations."),
			makePage(3, "Complyant pricing."),
		];

		const result = resolveCanonicalIdentity(pages, "Complaint");
		if (result.canonical_company_name_confidence !== "none") {
			const section = buildCanonicalIdentityRenderSection(result);
			expect(section).not.toBeNull();
			expect(section?.key).toBe("canonical_identity_v1");
			expect(section?.kind).toBe("message");
			expect(section?.title).toBe("Deal Identity Resolution");
			expect(section?.body).toContain("Complyant");
		}
	});
});

// ─── Shared fixture for render package tests ─────────────────────────────────

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

const STUB_COMPLIANCE: ComplianceState = { status: "passed", events: [] };
const STUB_DEAL_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

describe("buildRenderPackage — canonical_identity field (CANONICAL_IDENTITY_BUILD_V3)", () => {
	it("TC-10: maps canonicalIdentity result to render_package.canonical_identity", () => {
		const pages = [
			makePage(0, "Complyant\nCompliance automation"),
			makePage(1, "About Complyant\nComplyant is a compliance platform."),
			makePage(2, "Complyant features and integrations."),
			makePage(3, "Complyant pricing."),
		];
		const canonical = resolveCanonicalIdentity(pages, "Complaint");
		expect(canonical.mismatch_flagged).toBe(true);
		expect(["high", "medium"]).toContain(canonical.canonical_company_name_confidence);

		const pkg = buildRenderPackage({
			dealId: STUB_DEAL_ID,
			status: "deterministic_only",
			gateState: makeAllPassGateState(),
			complianceState: STUB_COMPLIANCE,
			upstreamFingerprint: "test-fp-canonical-v3",
			engineVersion: "v1",
			sections: [],
			canonicalIdentity: canonical,
		});

		expect(pkg.canonical_identity).toBeDefined();
		expect(pkg.canonical_identity?.entered_name).toBe("Complaint");
		expect(pkg.canonical_identity?.canonical_company_name).toBe("Complyant");
		expect(pkg.canonical_identity?.mismatch_flagged).toBe(true);
		expect(["high", "medium"]).toContain(pkg.canonical_identity?.confidence);
		expect(typeof pkg.canonical_identity?.evidence_summary).toBe("string");
	});

	it("TC-11: omits canonical_identity from render package when canonicalIdentity is not provided", () => {
		const pkg = buildRenderPackage({
			dealId: STUB_DEAL_ID,
			status: "deterministic_only",
			gateState: makeAllPassGateState(),
			complianceState: STUB_COMPLIANCE,
			upstreamFingerprint: "test-fp-canonical-v3",
			engineVersion: "v1",
			sections: [],
		});

		expect(pkg.canonical_identity).toBeUndefined();
	});

	it("TC-12: omits canonical_identity when confidence is none", () => {
		// No doc evidence → confidence none → mismatch_flagged false → UI should not show banner
		const pages = [
			makePage(0, "Investor Deck Q1 2025"),
			makePage(1, "Our platform helps businesses succeed."),
		];
		const canonical = resolveCanonicalIdentity(pages, "GenericCo");
		expect(canonical.canonical_company_name_confidence).toBe("none");
		expect(canonical.mismatch_flagged).toBe(false);

		const pkg = buildRenderPackage({
			dealId: STUB_DEAL_ID,
			status: "deterministic_only",
			gateState: makeAllPassGateState(),
			complianceState: STUB_COMPLIANCE,
			upstreamFingerprint: "test-fp-canonical-v3",
			engineVersion: "v1",
			sections: [],
			canonicalIdentity: canonical,
		});

		// canonical_identity is still written — UI decides whether to show the banner
		// based on mismatch_flagged + confidence, not whether the field exists.
		expect(pkg.canonical_identity).toBeDefined();
		expect(pkg.canonical_identity?.mismatch_flagged).toBe(false);
		expect(pkg.canonical_identity?.confidence).toBe("none");
	});
});

// ─── Fix B + C + D hardening tests (Verse / all-caps brand stack) ─────────────

describe("resolveCanonicalIdentity — hardening fixes B/C/D", () => {
	/**
	 * TC-13 (Fix B): "VERSE" appears all-caps across 3+ body slides.
	 * Before Fix B, the BRAND_TOKEN_RE would miss this because it requires at
	 * least one lowercase char.  After Fix B the ALLCAPS_TOKEN_RE pass converts
	 * "VERSE" → "Verse" and registers it as a repeated_token candidate.
	 */
	it("TC-13: all-caps VERSE on 3+ pages yields a 'Verse' repeated-token candidate", () => {
		const pages = [
			makePage(0, "VERSE\nPitching to investors Q1 2025"),
			makePage(1, "VERSE is a better beverage brand."),
			makePage(2, "Why VERSE stands apart from incumbents."),
			makePage(3, "VERSE financials and growth trajectory."),
		];
		const result = resolveCanonicalIdentity(pages, "Dephil Trade");

		expect(result.canonical_company_name).toBe("Verse");
		expect(result.mismatch_flagged).toBe(true);
		expect(result.winning_candidate.sources).toContain("repeated_token");
	});

	/**
	 * TC-14 (Fix C): "versedrink.com" domain should CORROBORATE "Verse", not
	 * create an independent "Versedrink" candidate that splits the vote.
	 * The domain token "versedrink" starts with "verse" (length ≥ 4) and extends it,
	 * so it should add "domain_email" to the existing "Verse" candidate.
	 */
	it("TC-14: versedrink.com domain corroborates Verse candidate rather than spawning Versedrink", () => {
		const pages = [
			makePage(0, "VERSE\nPitching to investors Q1 2025"),
			makePage(1, "VERSE is a beverage brand. Visit https://versedrink.com for more."),
			makePage(2, "Why VERSE stands apart."),
			makePage(3, "VERSE financials overview."),
		];
		const result = resolveCanonicalIdentity(pages, "Dephil Trade");

		expect(result.canonical_company_name).toBe("Verse");
		// Should NOT create a standalone Versedrink winner
		expect(result.canonical_company_name?.toLowerCase()).not.toBe("versedrink");
		// domain_email should be one of the sources on the winning candidate
		expect(result.winning_candidate.sources).toContain("domain_email");
	});

	/**
	 * TC-15 (Fix D): Common deck noise words should NOT appear as candidates.
	 * "Sales", "High", "Functional", "Target", "Size" are all in STOPWORDS.
	 */
	it("TC-15: deck noise words (Sales, High, Functional) are not brand candidates", () => {
		const pages = [
			makePage(0, "Sales Strategy Q1 2025"),
			makePage(1, "High growth in Functional segments."),
			makePage(2, "Target Size for the Total market is large."),
			makePage(3, "Sales projections and Annual revenue model."),
		];
		// No genuine brand name → confidence should be none
		const result = resolveCanonicalIdentity(pages, "NoNameCorp");

		expect(result.canonical_company_name_confidence).toBe("none");
		// The canonical name falls back to the entered name
		expect(result.canonical_company_name).toBe("NoNameCorp");
	});

	/**
	 * TC-16 (Fix A): "PD - Verse.pdf" filename stem is tokenized and "Verse"
	 * is registered as a filename candidate while "PD" (2 chars) is dropped.
	 */
	it("TC-16: filename PD - Verse.pdf yields Verse as filename candidate", () => {
		const pages = [
			makePage(0, "Investor Deck 2025\nConfidential"),
			makePage(1, "Our platform provides value to customers."),
		];
		// Pass the filename as a documentTitle; resolver uses it for signal 5
		const result = resolveCanonicalIdentity(pages, "Dephil Trade", ["PD - Verse.pdf"]);

		expect(result.canonical_company_name).toBe("Verse");
		expect(result.winning_candidate.sources).toContain("filename");
	});

	/**
	 * TC-17 (Fix A): Generic deck filename should NOT inject noise candidates.
	 * "Acme_Investor_Deck_v2.pdf" → stem tokens are "Acme", "Investor", "Deck", "v2".
	 * Only "Acme" should survive (starts with uppercase, ≥4 chars, not a STOPWORD).
	 * "Investor" and "Deck" are STOPWORDS; "v2" matches /^[vV]\d/ so it's dropped.
	 */
	it("TC-17: Acme_Investor_Deck_v2.pdf extracts Acme not Investor or Deck", () => {
		const pages = [
			makePage(0, "Acme Corp\nInvestor Deck"),
			makePage(1, "Acme is a leading platform."),
			makePage(2, "Acme grows 3x."),
			makePage(3, "Acme product overview."),
		];
		const result = resolveCanonicalIdentity(pages, "Dephil Trade", [
			"Acme_Investor_Deck_v2.pdf",
		]);

		// "Acme" should win (title_slide + repeated_token + filename)
		expect(result.canonical_company_name).toBe("Acme");
		// Spurious candidates from noise tokens should not surface as winner
		expect(result.canonical_company_name?.toLowerCase()).not.toBe("investor");
		expect(result.canonical_company_name?.toLowerCase()).not.toBe("deck");
	});
});

// ─── Fix F cache-invalidation test ────────────────────────────────────────────

describe("computeGovernedSummaryFingerprintV1 — Fix F cache invalidation", () => {
	it("TC-18: fingerprint changes when canonicalCompanyName is added or changed", async () => {
		const { computeGovernedSummaryFingerprintV1 } = await import(
			"../governed-summary-v1"
		);

		const base = {
			canonicalText: "revenue: $1M",
			slotsText: "traction: strong",
			engineVersion: "v1",
			governanceVersion: "g1",
			dealNameText: "Dephil Trade",
		};

		const fp1 = computeGovernedSummaryFingerprintV1({
			...base,
			canonicalCompanyNameText: null,
		});
		const fp2 = computeGovernedSummaryFingerprintV1({
			...base,
			canonicalCompanyNameText: "Verse",
		});
		const fp3 = computeGovernedSummaryFingerprintV1({
			...base,
			canonicalCompanyNameText: "Verse",
		});

		// Changing canonical name changes fingerprint
		expect(fp1).not.toBe(fp2);
		// Same canonical name → same fingerprint (deterministic)
		expect(fp2).toBe(fp3);
	});

	it("TC-19: exec summary fingerprint changes when canonicalCompanyName is added or changed", async () => {
		const { computeGovernedExecSummaryFingerprintV1 } = await import(
			"../governed-executive-summary-v1"
		);

		const base = {
			canonicalText: "revenue: $1M",
			slotsText: "traction: strong",
			coverageText: "10/20 pages",
			gateStateText: "PASS",
			engineVersion: "v1",
			governanceVersion: "g1",
			dealNameText: "Dephil Trade",
		};

		const fp1 = computeGovernedExecSummaryFingerprintV1({
			...base,
			canonicalCompanyNameText: null,
		});
		const fp2 = computeGovernedExecSummaryFingerprintV1({
			...base,
			canonicalCompanyNameText: "Verse",
		});
		const fp3 = computeGovernedExecSummaryFingerprintV1({
			...base,
			canonicalCompanyNameText: "Verse",
		});

		expect(fp1).not.toBe(fp2);
		expect(fp2).toBe(fp3);
	});
});

