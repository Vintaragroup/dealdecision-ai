/**
 * llm-interpretation-v1.test.ts — PR36
 *
 * Unit tests for the LLM interpretation layer.
 *
 * Test strategy:
 *  - generateLlmInterpretationV1: success path, failure paths, numeric parity,
 *    posture/confidence validation, all field validation, evidence caveat injection,
 *    product_differentiation and go_to_market_strategy fields
 *  - PR36 external intelligence fields: populated when externalDiligenceBody provided,
 *    gracefully empty when absent, parity validation extended to external fields
 *  - serializeLlmInterpretationBody + parseLlmInterpretationBody: round-trip incl. external fields
 *  - POSTURE_VALUES / CONFIDENCE_VALUES: exhaustive set checks
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
	generateLlmInterpretationV1,
	serializeLlmInterpretationBody,
	parseLlmInterpretationBody,
	POSTURE_VALUES,
	CONFIDENCE_VALUES,
	type LlmInterpretationV1,
	type LlmInterpretationArgs,
} from "../llm-interpretation-v1";

// Module-level mock so vi.mock hoisting works correctly.
const mockCompleteFn = vi.hoisted(() => vi.fn());

vi.mock("../../../lib/llm/providers/openai-provider", () => ({
	OpenAIGPT4oProvider: vi.fn().mockImplementation(() => ({
		complete: mockCompleteFn,
	})),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const VALID_OUTPUT: LlmInterpretationV1 = {
	schema_version: "llm_interpretation_v1",
	posture: "INVESTIGATE",
	confidence: "MEDIUM",
	executive_summary: "The company operates in a $500K seed target niche with early traction.",
	product_differentiation: "The platform automates workflow coordination — no competitor addresses this niche.",
	go_to_market_strategy: "Targeting mid-market operations teams via a direct sales motion with a freemium entry tier.",
	strengths: ["Strong founding team", "Early enterprise pipeline"],
	risks: ["Limited ARR visibility", "Competitive market"],
	next_questions: ["What is current MRR?", "Who are the key design partners?"],
	financial_outlook: "Revenue is not disclosed. Burn rate not extractable from provided materials.",
	business_quality: "Team signals are present with early enterprise pipeline. No product-market fit data available.",
	market_position: "Not disclosed.",
	capital_and_raise_interpretation: "Raising $500K in a seed round — specific structure not disclosed.",
	key_unknowns: ["Current ARR/MRR", "Cap table structure"],
	external_market_context: "",
	competitive_landscape: "",
	claim_verification_summary: "",
	external_risk_signals: "",
	evidence_caveat: null,
	validated: true,
};

/** Build a complete valid LLM JSON response payload. */
const makeValidJson = (overrides?: Record<string, unknown>): Record<string, unknown> => ({
	posture: "INVESTIGATE",
	confidence: "MEDIUM",
	executive_summary: "The company is raising $500K seed.",
	product_differentiation: "The platform automates workflow automation for operations teams.",
	go_to_market_strategy: "Direct sales targeting mid-market SMB teams with a freemium motion.",
	strengths: ["Strong founding team"],
	risks: ["Limited ARR visibility"],
	next_questions: ["What is current MRR?"],
	financial_outlook: "Not disclosed.",
	business_quality: "Team signals present, early pipeline.",
	market_position: "Not disclosed.",
	capital_and_raise_interpretation: "Raising $500K seed round.",
	key_unknowns: ["Current ARR"],
	...overrides,
});

const makeArgs = (overrides?: Partial<LlmInterpretationArgs>): LlmInterpretationArgs => ({
	canonicalFieldsBody: "field=raise_amount value=$500K",
	insightSlotsBody: "raise_terms: Computable | value=$500K | evidence=doc1 | reason=detected",
	financialStmtBody: null,
	financialHealthBody: null,
	financialReconciliationBody: null,
	deckFinancialSignalsBody: null,
	productSignalsBundleBody: null,
	gtmSignalsBundleBody: null,
	useOfFundsBody: null,
	conflictsBody: null,
	dealName: "TestCo",
	productNarrativeBody: null,
	externalDiligenceBody: null,
	evidenceCaveat: false,
	...overrides,
});

const mockLlmResponse = (json: Record<string, unknown>) => {
	mockCompleteFn.mockResolvedValueOnce({
		content: JSON.stringify(json),
		model: "gpt-4o-mini",
		finish_reason: "stop",
		usage: { prompt_tokens: 100, completion_tokens: 80 },
	});
};

// ─── POSTURE_VALUES ────────────────────────────────────────────────────────────

describe("POSTURE_VALUES", () => {
	it("contains all four expected posture values", () => {
		expect(POSTURE_VALUES.has("GO")).toBe(true);
		expect(POSTURE_VALUES.has("INVESTIGATE")).toBe(true);
		expect(POSTURE_VALUES.has("CAUTION")).toBe(true);
		expect(POSTURE_VALUES.has("PASS")).toBe(true);
	});

	it("has exactly 4 values", () => {
		expect(POSTURE_VALUES.size).toBe(4);
	});

	it("does not contain legacy posture values", () => {
		expect(POSTURE_VALUES.has("strong_interest")).toBe(false);
		expect(POSTURE_VALUES.has("cautious_interest")).toBe(false);
		expect(POSTURE_VALUES.has("neutral")).toBe(false);
		expect(POSTURE_VALUES.has("pass")).toBe(false); // legacy lowercase
	});
});

// ─── CONFIDENCE_VALUES ─────────────────────────────────────────────────────────

describe("CONFIDENCE_VALUES", () => {
	it("contains all three expected confidence values", () => {
		expect(CONFIDENCE_VALUES.has("HIGH")).toBe(true);
		expect(CONFIDENCE_VALUES.has("MEDIUM")).toBe(true);
		expect(CONFIDENCE_VALUES.has("LOW")).toBe(true);
	});

	it("has exactly 3 values", () => {
		expect(CONFIDENCE_VALUES.size).toBe(3);
	});

	it("does not contain numeric confidence values", () => {
		expect(CONFIDENCE_VALUES.has("0.5")).toBe(false);
		expect(CONFIDENCE_VALUES.has("1")).toBe(false);
	});
});

// ─── generateLlmInterpretationV1 ─────────────────────────────────────────────

describe("generateLlmInterpretationV1", () => {
	const OLD_ENV = process.env;

	beforeEach(() => {
		process.env = { ...OLD_ENV, OPENAI_API_KEY: "test-key-123" };
	});

	afterEach(() => {
		process.env = OLD_ENV;
		vi.clearAllMocks();
	});

	it("returns ok=false when no canonical data is provided", async () => {
		const result = await generateLlmInterpretationV1({
			canonicalFieldsBody: null,
			insightSlotsBody: null,
			financialStmtBody: null,
			financialHealthBody: null,
			financialReconciliationBody: null,
			deckFinancialSignalsBody: null,
			productSignalsBundleBody: null,
			gtmSignalsBundleBody: null,
			useOfFundsBody: null,
			conflictsBody: null,
			externalDiligenceBody: null,
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe("no_canonical_data");
		}
	});

	it("returns ok=false when OPENAI_API_KEY is not set", async () => {
		delete process.env["OPENAI_API_KEY"];
		const result = await generateLlmInterpretationV1(makeArgs());
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe("missing_openai_api_key");
		}
	});

	it("returns ok=false when LLM call throws", async () => {
		mockCompleteFn.mockRejectedValueOnce(new Error("connection refused"));
		const result = await generateLlmInterpretationV1(makeArgs());
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe("llm_call_failed");
		}
	});

	it("returns ok=false when LLM response is empty", async () => {
		mockCompleteFn.mockResolvedValueOnce({ content: "", model: "gpt-4o-mini", finish_reason: "stop", usage: {} });
		const result = await generateLlmInterpretationV1(makeArgs());
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe("llm_empty_response");
		}
	});

	it("returns ok=false when LLM response is not valid JSON", async () => {
		mockCompleteFn.mockResolvedValueOnce({ content: "The deal looks interesting.", model: "gpt-4o-mini", finish_reason: "stop", usage: {} });
		const result = await generateLlmInterpretationV1(makeArgs());
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe("llm_output_not_json");
		}
	});

	it("returns ok=false when posture is invalid", async () => {
		mockLlmResponse(makeValidJson({ posture: "highly_interested" }));
		const result = await generateLlmInterpretationV1(makeArgs());
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe("llm_output_invalid_posture");
		}
	});

	it("returns ok=false when posture uses legacy lowercase format", async () => {
		mockLlmResponse(makeValidJson({ posture: "cautious_interest" }));
		const result = await generateLlmInterpretationV1(makeArgs());
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe("llm_output_invalid_posture");
		}
	});

	it("returns ok=false when confidence is an invalid string", async () => {
		mockLlmResponse(makeValidJson({ confidence: "ULTRA" }));
		const result = await generateLlmInterpretationV1(makeArgs());
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe("llm_output_invalid_confidence");
		}
	});

	it("returns ok=false when confidence is a number (old schema)", async () => {
		mockLlmResponse(makeValidJson({ confidence: 0.72 }));
		const result = await generateLlmInterpretationV1(makeArgs());
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe("llm_output_invalid_confidence");
		}
	});

	it("returns ok=false when executive_summary is missing", async () => {
		const { executive_summary: _omit, ...rest } = makeValidJson() as Record<string, unknown>;
		mockLlmResponse(rest);
		const result = await generateLlmInterpretationV1(makeArgs());
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe("llm_output_schema_mismatch");
		}
	});

	it("returns ok=false when financial_outlook is missing", async () => {
		const { financial_outlook: _omit, ...rest } = makeValidJson() as Record<string, unknown>;
		mockLlmResponse(rest);
		const result = await generateLlmInterpretationV1(makeArgs());
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe("llm_output_schema_mismatch");
		}
	});

	it("returns ok=false when capital_and_raise_interpretation is missing", async () => {
		const { capital_and_raise_interpretation: _omit, ...rest } = makeValidJson() as Record<string, unknown>;
		mockLlmResponse(rest);
		const result = await generateLlmInterpretationV1(makeArgs());
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe("llm_output_schema_mismatch");
		}
	});

	it("returns ok=false when product_differentiation is missing", async () => {
		const { product_differentiation: _omit, ...rest } = makeValidJson() as Record<string, unknown>;
		mockLlmResponse(rest);
		const result = await generateLlmInterpretationV1(makeArgs());
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe("llm_output_schema_mismatch");
		}
	});

	it("returns ok=false when go_to_market_strategy is missing", async () => {
		const { go_to_market_strategy: _omit, ...rest } = makeValidJson() as Record<string, unknown>;
		mockLlmResponse(rest);
		const result = await generateLlmInterpretationV1(makeArgs());
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe("llm_output_schema_mismatch");
		}
	});

	it("returns ok=true with complete valid output for posture=GO", async () => {
		mockLlmResponse(makeValidJson({
			posture: "GO",
			confidence: "HIGH",
			executive_summary: "The company is raising $500K seed with clear demand signals.",
		}));
		const result = await generateLlmInterpretationV1(makeArgs());
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.posture).toBe("GO");
			expect(result.value.confidence).toBe("HIGH");
			expect(result.value.validated).toBe(true);
		}
	});

	it("returns ok=true with complete valid output for posture=INVESTIGATE", async () => {
		mockLlmResponse(makeValidJson({
			posture: "INVESTIGATE",
			confidence: "MEDIUM",
			executive_summary: "The company is raising $500K seed.",
		}));
		const result = await generateLlmInterpretationV1(makeArgs());
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.posture).toBe("INVESTIGATE");
			expect(result.value.confidence).toBe("MEDIUM");
			expect(result.value.executive_summary).toContain("$500K");
			expect(result.value.strengths).toHaveLength(1);
			expect(result.value.risks).toHaveLength(1);
			expect(result.value.next_questions).toHaveLength(1);
		}
	});

	it("returns ok=true with complete valid output for posture=CAUTION", async () => {
		mockLlmResponse(makeValidJson({ posture: "CAUTION", confidence: "LOW" }));
		const result = await generateLlmInterpretationV1(makeArgs());
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.posture).toBe("CAUTION");
			expect(result.value.confidence).toBe("LOW");
		}
	});

	it("returns ok=true with complete valid output for posture=PASS", async () => {
		mockLlmResponse(makeValidJson({ posture: "PASS", confidence: "HIGH" }));
		const result = await generateLlmInterpretationV1(makeArgs());
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.posture).toBe("PASS");
		}
	});

	it("populates all 5 new output fields from LLM response", async () => {
		mockLlmResponse(makeValidJson({
			financial_outlook: "Revenue not disclosed.",
			business_quality: "Early-stage team with strong domain expertise.",
			market_position: "TAM of $1B per deck claims.",
			capital_and_raise_interpretation: "Raising $500K seed at undisclosed valuation.",
			key_unknowns: ["Current MRR", "Churn rate"],
		}));
		const result = await generateLlmInterpretationV1(makeArgs({
			canonicalFieldsBody: "field=raise_amount value=$500K\nfield=tam value=$1B",
		}));
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.financial_outlook).toBe("Revenue not disclosed.");
			expect(result.value.business_quality).toContain("domain expertise");
			expect(result.value.market_position).toContain("$1B");
			expect(result.value.capital_and_raise_interpretation).toContain("$500K");
			expect(result.value.key_unknowns).toHaveLength(2);
		}
	});

	it("truncates arrays to maximum 3 items even if LLM returns more", async () => {
		mockLlmResponse(makeValidJson({
			strengths: ["A", "B", "C", "D", "E"],     // 5 → truncate to 3
			risks: ["X", "Y", "Z", "W"],               // 4 → truncate to 3
			next_questions: ["Q1", "Q2", "Q3", "Q4"], // 4 → truncate to 3
			key_unknowns: ["U1", "U2", "U3", "U4"],   // 4 → truncate to 3
		}));
		const result = await generateLlmInterpretationV1(makeArgs());
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.strengths).toHaveLength(3);
			expect(result.value.risks).toHaveLength(3);
			expect(result.value.next_questions).toHaveLength(3);
			expect(result.value.key_unknowns).toHaveLength(3);
		}
	});

	it("accepts empty arrays for strengths/risks/next_questions/key_unknowns", async () => {
		mockLlmResponse(makeValidJson({
			strengths: [],
			risks: [],
			next_questions: [],
			key_unknowns: [],
		}));
		const result = await generateLlmInterpretationV1(makeArgs());
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.strengths).toHaveLength(0);
			expect(result.value.risks).toHaveLength(0);
			expect(result.value.next_questions).toHaveLength(0);
			expect(result.value.key_unknowns).toHaveLength(0);
		}
	});

	it("sets evidence_caveat string when evidenceCaveat=true", async () => {
		mockLlmResponse(makeValidJson({ posture: "CAUTION", confidence: "LOW" }));
		const result = await generateLlmInterpretationV1(makeArgs({ evidenceCaveat: true }));
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.evidence_caveat).not.toBeNull();
			expect(result.value.evidence_caveat).toContain("Limited coverage");
		}
	});

	it("sets evidence_caveat to null when evidenceCaveat=false", async () => {
		mockLlmResponse(makeValidJson());
		const result = await generateLlmInterpretationV1(makeArgs({ evidenceCaveat: false }));
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.evidence_caveat).toBeNull();
		}
	});

	it("returns ok=false when LLM introduces hallucinated numeric values (parity check)", async () => {
		// canonical has no dollar amounts; LLM invents $50M valuation
		mockLlmResponse(makeValidJson({
			executive_summary: "The company is valued at $50M.",  // $50M NOT in canonical
		}));
		const result = await generateLlmInterpretationV1(makeArgs({
			canonicalFieldsBody: "field=company_stage value=seed",
			insightSlotsBody: "stage: Computable | value=seed | evidence=doc1 | reason=detected",
		}));
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe("numeric_parity_failed");
		}
	});

	it("parity check covers financial_outlook field", async () => {
		mockLlmResponse(makeValidJson({
			financial_outlook: "Revenue is $5M ARR.",  // $5M NOT in canonical
		}));
		const result = await generateLlmInterpretationV1(makeArgs({
			canonicalFieldsBody: "field=company_stage value=early",
			insightSlotsBody: null,
		}));
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe("numeric_parity_failed");
		}
	});

	it("allows numeric values that appear in the canonical corpus", async () => {
		mockLlmResponse(makeValidJson({
			executive_summary: "The company is raising $500K in a seed round.",
			capital_and_raise_interpretation: "Raising $500K seed round with standard terms.",
		}));
		// $500K IS in canonical
		const result = await generateLlmInterpretationV1(makeArgs({
			canonicalFieldsBody: "field=raise_amount value=$500K",
		}));
		expect(result.ok).toBe(true);
	});

	it("uses new financial input args in canonical corpus", async () => {
		mockLlmResponse(makeValidJson({
			financial_outlook: "Company reporting $200K ARR.",
		}));
		const result = await generateLlmInterpretationV1(makeArgs({
			canonicalFieldsBody: "field=raise_amount value=$500K",
			financialHealthBody: "ARR: $200K | growth: not_available",
		}));
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.financial_outlook).toContain("$200K");
		}
	});

	it("extracts JSON from noisy LLM response with preamble text", async () => {
		mockCompleteFn.mockResolvedValueOnce({
			content: `Sure! Here is the JSON output:\n${JSON.stringify(makeValidJson({ posture: "CAUTION", confidence: "LOW" }))}`,
			model: "gpt-4o-mini",
			finish_reason: "stop",
			usage: {},
		});
		const result = await generateLlmInterpretationV1(makeArgs());
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.posture).toBe("CAUTION");
		}
	});

	it("includes insightSlotsBody in canonical corpus when present", async () => {
		mockLlmResponse(makeValidJson({
			executive_summary: "The company operates in an enterprise niche with early signals.",
			capital_and_raise_interpretation: "Raise structure not disclosed.",
			key_unknowns: ["Current ARR"],
		}));
		// Only insightSlotsBody provided (no canonicalFieldsBody, no dollar amounts in output)
		const result = await generateLlmInterpretationV1(makeArgs({
			canonicalFieldsBody: null,
			insightSlotsBody: "company_stage: Computable | value=early | evidence=doc2 | reason=detected",
		}));
		expect(result.ok).toBe(true);
	});

	it("includes deckFinancialSignalsBody in canonical corpus", async () => {
		mockLlmResponse(makeValidJson({
			financial_outlook: "Company mentions $100K MRR in deck.",
		}));
		const result = await generateLlmInterpretationV1(makeArgs({
			canonicalFieldsBody: null,
			deckFinancialSignalsBody: "mrr_mentions: [$100K MRR detected]\nrevenue_mentions: []",
		}));
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.financial_outlook).toContain("$100K");
		}
	});

	it("populates product_differentiation and go_to_market_strategy fields from LLM response", async () => {
		mockLlmResponse(makeValidJson({
			product_differentiation: "The platform automates workflow automation for operations teams.",
			go_to_market_strategy: "Direct sales targeting mid-market SMB teams with freemium entry.",
		}));
		const result = await generateLlmInterpretationV1(makeArgs());
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.product_differentiation).toContain("automates workflow");
			expect(result.value.go_to_market_strategy).toContain("mid-market");
		}
	});

	it("parity check covers product_differentiation field", async () => {
		mockLlmResponse(makeValidJson({
			product_differentiation: "The platform has $99M in revenue.",  // $99M NOT in canonical
		}));
		const result = await generateLlmInterpretationV1(makeArgs({
			canonicalFieldsBody: "field=company_stage value=early",
			insightSlotsBody: null,
		}));
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe("numeric_parity_failed");
		}
	});

	it("parity check covers go_to_market_strategy field", async () => {
		mockLlmResponse(makeValidJson({
			go_to_market_strategy: "Pricing at $45 per seat per month.",  // $45 NOT in canonical
		}));
		const result = await generateLlmInterpretationV1(makeArgs({
			canonicalFieldsBody: "field=company_stage value=seed",
			insightSlotsBody: null,
		}));
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe("numeric_parity_failed");
		}
	});

	it("includes productSignalsBundleBody in canonical corpus when present", async () => {
		mockLlmResponse(makeValidJson({
			product_differentiation: "The platform integrates with Salesforce for workflow automation.",
		}));
		const result = await generateLlmInterpretationV1(makeArgs({
			canonicalFieldsBody: null,
			productSignalsBundleBody: "integrates with Salesforce | automation | workflow",
		}));
		expect(result.ok).toBe(true);
	});

	it("includes gtmSignalsBundleBody in canonical corpus when present", async () => {
		mockLlmResponse(makeValidJson({
			go_to_market_strategy: "Targeting mid-market operations teams via direct sales.",
		}));
		const result = await generateLlmInterpretationV1(makeArgs({
			canonicalFieldsBody: null,
			gtmSignalsBundleBody: "target customer: mid-market operations | pricing: enterprise tier",
		}));
		expect(result.ok).toBe(true);
	});
});

// ─── serializeLlmInterpretationBody + parseLlmInterpretationBody ──────────────

describe("serializeLlmInterpretationBody / parseLlmInterpretationBody", () => {
	it("round-trips a complete LlmInterpretationV1 through serialize→parse", () => {
		const body = serializeLlmInterpretationBody(VALID_OUTPUT);
		const parsed = parseLlmInterpretationBody(body);
		expect(parsed).not.toBeNull();
		expect(parsed?.schema_version).toBe("llm_interpretation_v1");
		expect(parsed?.posture).toBe("INVESTIGATE");
		expect(parsed?.confidence).toBe("MEDIUM");
		expect(parsed?.executive_summary).toBe(VALID_OUTPUT.executive_summary);
		expect(parsed?.product_differentiation).toBe(VALID_OUTPUT.product_differentiation);
		expect(parsed?.go_to_market_strategy).toBe(VALID_OUTPUT.go_to_market_strategy);
		expect(parsed?.strengths).toEqual(VALID_OUTPUT.strengths);
		expect(parsed?.risks).toEqual(VALID_OUTPUT.risks);
		expect(parsed?.next_questions).toEqual(VALID_OUTPUT.next_questions);
		expect(parsed?.financial_outlook).toBe(VALID_OUTPUT.financial_outlook);
		expect(parsed?.business_quality).toBe(VALID_OUTPUT.business_quality);
		expect(parsed?.market_position).toBe(VALID_OUTPUT.market_position);
		expect(parsed?.capital_and_raise_interpretation).toBe(VALID_OUTPUT.capital_and_raise_interpretation);
		expect(parsed?.key_unknowns).toEqual(VALID_OUTPUT.key_unknowns);
		expect(parsed?.evidence_caveat).toBeNull();
		expect(parsed?.validated).toBe(true);
	});

	it("round-trips with evidence_caveat set", () => {
		const withCaveat: LlmInterpretationV1 = {
			...VALID_OUTPUT,
			evidence_caveat: "Limited coverage — interpretation may be incomplete",
		};
		const body = serializeLlmInterpretationBody(withCaveat);
		const parsed = parseLlmInterpretationBody(body);
		expect(parsed?.evidence_caveat).toBe("Limited coverage — interpretation may be incomplete");
	});

	it("serialized body contains posture and confidence tokens", () => {
		const body = serializeLlmInterpretationBody(VALID_OUTPUT);
		expect(body).toContain("INVESTIGATE");
		expect(body).toContain("MEDIUM");
	});

	it("serialized body contains all section headers", () => {
		const body = serializeLlmInterpretationBody(VALID_OUTPUT);
		expect(body).toContain("Executive Summary");
		expect(body).toContain("Product & Differentiation");
		expect(body).toContain("Go-To-Market Strategy");
		expect(body).toContain("Financial Outlook");
		expect(body).toContain("Business Quality");
		expect(body).toContain("Market Position");
		expect(body).toContain("Capital & Raise");
		expect(body).toContain("Strengths");
		expect(body).toContain("Risks");
		expect(body).toContain("Next Questions");
		expect(body).toContain("Key Unknowns");
	});

	it("serialized body contains the JSON delimiter", () => {
		const body = serializeLlmInterpretationBody(VALID_OUTPUT);
		expect(body).toContain("---llm_interpretation_v1_json---");
	});

	it("parseLlmInterpretationBody returns null when delimiter is absent", () => {
		const result = parseLlmInterpretationBody("Some text without any delimiter.");
		expect(result).toBeNull();
	});

	it("parseLlmInterpretationBody returns null when JSON is invalid after delimiter", () => {
		const body = "---llm_interpretation_v1_json---\nnot valid json";
		expect(parseLlmInterpretationBody(body)).toBeNull();
	});

	it("parseLlmInterpretationBody returns null when schema_version mismatches", () => {
		const json = JSON.stringify({ schema_version: "governed_summary_v1", posture: "GO" });
		const body = `---llm_interpretation_v1_json---\n${json}`;
		expect(parseLlmInterpretationBody(body)).toBeNull();
	});

	it("all four posture values serialize with correct tokens in body", () => {
		for (const posture of ["GO", "INVESTIGATE", "CAUTION", "PASS"] as const) {
			const value: LlmInterpretationV1 = { ...VALID_OUTPUT, posture };
			const body = serializeLlmInterpretationBody(value);
			expect(body).toContain(`Investment Posture: ${posture}`);
		}
	});

	it("all three confidence values serialize with correct tokens in body", () => {
		for (const confidence of ["HIGH", "MEDIUM", "LOW"] as const) {
			const value: LlmInterpretationV1 = { ...VALID_OUTPUT, confidence };
			const body = serializeLlmInterpretationBody(value);
			expect(body).toContain(`Confidence: ${confidence}`);
		}
	});

	it("evidence_caveat line appears in body when set", () => {
		const value: LlmInterpretationV1 = {
			...VALID_OUTPUT,
			evidence_caveat: "Limited coverage — interpretation may be incomplete",
		};
		const body = serializeLlmInterpretationBody(value);
		expect(body).toContain("Limited coverage");
	});

	it("evidence_caveat warning symbol is absent from body when null", () => {
		const body = serializeLlmInterpretationBody(VALID_OUTPUT);
		expect(body).not.toContain("⚠");
	});

	it("key_unknowns section is omitted when array is empty", () => {
		const noUnknowns: LlmInterpretationV1 = { ...VALID_OUTPUT, key_unknowns: [] };
		const body = serializeLlmInterpretationBody(noUnknowns);
		expect(body).not.toContain("Key Unknowns");
	});

	it("key_unknowns bullets appear when populated", () => {
		const body = serializeLlmInterpretationBody(VALID_OUTPUT);
		expect(body).toContain("• Current ARR/MRR");
	});

	// ── PR36 serializer coverage ──────────────────────────────────────────────

	it("serialized body omits external sections when all four PR36 fields are empty", () => {
		const body = serializeLlmInterpretationBody(VALID_OUTPUT);
		expect(body).not.toContain("External Market Context");
		expect(body).not.toContain("Competitive Landscape");
		expect(body).not.toContain("Claim Verification");
		expect(body).not.toContain("External Risk Signals");
	});

	it("serialized body includes External Market Context section when non-empty", () => {
		const value: LlmInterpretationV1 = {
			...VALID_OUTPUT,
			external_market_context: "The workflow automation market is growing 25% YoY per Gartner estimates.",
		};
		const body = serializeLlmInterpretationBody(value);
		expect(body).toContain("External Market Context");
		expect(body).toContain("25% YoY");
	});

	it("serialized body includes Competitive Landscape section when non-empty", () => {
		const value: LlmInterpretationV1 = {
			...VALID_OUTPUT,
			competitive_landscape: "WorkflowAI and FlowDash are primary comps.",
		};
		const body = serializeLlmInterpretationBody(value);
		expect(body).toContain("Competitive Landscape");
		expect(body).toContain("WorkflowAI");
	});

	it("serialized body includes Claim Verification section when non-empty", () => {
		const value: LlmInterpretationV1 = {
			...VALID_OUTPUT,
			claim_verification_summary: "The $500K raise is corroborated by TechCrunch coverage.",
		};
		const body = serializeLlmInterpretationBody(value);
		expect(body).toContain("Claim Verification");
		expect(body).toContain("TechCrunch");
	});

	it("serialized body includes External Risk Signals section when non-empty", () => {
		const value: LlmInterpretationV1 = {
			...VALID_OUTPUT,
			external_risk_signals: "No negative news detected. Sector shows no regulatory headwinds.",
		};
		const body = serializeLlmInterpretationBody(value);
		expect(body).toContain("External Risk Signals");
		expect(body).toContain("regulatory headwinds");
	});

	it("round-trips all four PR36 external fields through serialize→parse", () => {
		const value: LlmInterpretationV1 = {
			...VALID_OUTPUT,
			external_market_context: "TAM growing at 25% CAGR per Gartner.",
			competitive_landscape: "Three direct comps: WorkflowAI, FlowDash, AutoOps.",
			claim_verification_summary: "Revenue claim of $500K partially corroborated.",
			external_risk_signals: "No adverse news. Sector regulatory risk is low.",
		};
		const body = serializeLlmInterpretationBody(value);
		const parsed = parseLlmInterpretationBody(body);
		expect(parsed).not.toBeNull();
		expect(parsed?.external_market_context).toBe(value.external_market_context);
		expect(parsed?.competitive_landscape).toBe(value.competitive_landscape);
		expect(parsed?.claim_verification_summary).toBe(value.claim_verification_summary);
		expect(parsed?.external_risk_signals).toBe(value.external_risk_signals);
	});

	it("parseLlmInterpretationBody returns object with empty string external fields when absent from JSON", () => {
		// Simulates legacy stored body that predates PR36
		const legacyJson = JSON.stringify({
			schema_version: "llm_interpretation_v1",
			posture: "INVESTIGATE",
			confidence: "MEDIUM",
			executive_summary: "Legacy deal.",
			product_differentiation: "Some product.",
			go_to_market_strategy: "Some GTM.",
			financial_outlook: "Not disclosed.",
			business_quality: "Early-stage.",
			market_position: "Not disclosed.",
			capital_and_raise_interpretation: "Raising $500K.",
			strengths: [],
			risks: [],
			next_questions: [],
			key_unknowns: [],
			evidence_caveat: null,
			validated: true,
		});
		const body = `---llm_interpretation_v1_json---\n${legacyJson}`;
		const parsed = parseLlmInterpretationBody(body);
		expect(parsed).not.toBeNull();
		// External fields absent in stored JSON should gracefully default (undefined or empty)
		expect(parsed?.external_market_context ?? "").toBe("");
		expect(parsed?.competitive_landscape ?? "").toBe("");
		expect(parsed?.claim_verification_summary ?? "").toBe("");
		expect(parsed?.external_risk_signals ?? "").toBe("");
	});
});

// ─── PR36: generateLlmInterpretationV1 external intelligence fields ───────────

describe("generateLlmInterpretationV1 — PR36 external intelligence fields", () => {
	const OLD_ENV = process.env;

	beforeEach(() => {
		process.env = { ...OLD_ENV, OPENAI_API_KEY: "test-key-123" };
	});

	afterEach(() => {
		process.env = OLD_ENV;
		vi.clearAllMocks();
	});

	it("populates all four external fields when LLM returns them and externalDiligenceBody provided", async () => {
		mockLlmResponse(makeValidJson({
			external_market_context: "The workflow automation market is growing 25% YoY per Gartner estimates.",
			competitive_landscape: "WorkflowAI and FlowDash are primary comps; differentiation claims are not contradicted.",
			claim_verification_summary: "The $500K raise claim is corroborated by TechCrunch coverage.",
			external_risk_signals: "No negative news detected. No regulatory headwinds currently.",
		}));
		const result = await generateLlmInterpretationV1(makeArgs({
			canonicalFieldsBody: "field=raise_amount value=$500K",
			externalDiligenceBody: "market_trends: Growing 25% YoY\ncompetitors: WorkflowAI, FlowDash\nclaim_corroborations: $500K TechCrunch",
		}));
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.external_market_context).toContain("25% YoY");
			expect(result.value.competitive_landscape).toContain("WorkflowAI");
			expect(result.value.claim_verification_summary).toContain("TechCrunch");
			expect(result.value.external_risk_signals).toContain("No negative news");
		}
	});

	it("defaults all four external fields to empty string when LLM omits them", async () => {
		// makeValidJson has no external fields → LLM response doesn't include them
		mockLlmResponse(makeValidJson());
		const result = await generateLlmInterpretationV1(makeArgs({
			externalDiligenceBody: null,
		}));
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.external_market_context).toBe("");
			expect(result.value.competitive_landscape).toBe("");
			expect(result.value.claim_verification_summary).toBe("");
			expect(result.value.external_risk_signals).toBe("");
		}
	});

	it("defaults all four external fields to empty string when externalDiligenceBody is null", async () => {
		mockLlmResponse(makeValidJson());
		const result = await generateLlmInterpretationV1(makeArgs({ externalDiligenceBody: null }));
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.value.external_market_context).toBe("");
			expect(result.value.competitive_landscape).toBe("");
			expect(result.value.claim_verification_summary).toBe("");
			expect(result.value.external_risk_signals).toBe("");
		}
	});

	it("parity check allows numbers in external fields that appear in externalDiligenceBody corpus", async () => {
		mockLlmResponse(makeValidJson({
			external_market_context: "The market is growing at $5B TAM according to external research.",
			competitive_landscape: "WorkflowAI raised $12M Series A.",
		}));
		const result = await generateLlmInterpretationV1(makeArgs({
			canonicalFieldsBody: "field=raise_amount value=$500K",
			externalDiligenceBody: "market_trends: $5B TAM\ncompetitors: WorkflowAI raised $12M Series A",
		}));
		expect(result.ok).toBe(true);
	});

	it("parity check fails when external fields introduce numbers not in any corpus", async () => {
		mockLlmResponse(makeValidJson({
			external_market_context: "The market TAM is $999B according to hallucinated data.",
		}));
		const result = await generateLlmInterpretationV1(makeArgs({
			canonicalFieldsBody: "field=company_stage value=seed",
			externalDiligenceBody: "market_trends: growing market, no specific figures",
		}));
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe("numeric_parity_failed");
		}
	});

	it("parity check covers competitive_landscape field", async () => {
		mockLlmResponse(makeValidJson({
			competitive_landscape: "Competitor raised $75M in a Series B.",  // $75M NOT in corpus
		}));
		const result = await generateLlmInterpretationV1(makeArgs({
			canonicalFieldsBody: "field=company_stage value=early",
			externalDiligenceBody: "competitors: Acme Corp, BetaCo",
		}));
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe("numeric_parity_failed");
		}
	});

	it("parity check covers claim_verification_summary field", async () => {
		mockLlmResponse(makeValidJson({
			claim_verification_summary: "Revenue claim of $8M ARR is not corroborated.",  // $8M NOT in corpus
		}));
		const result = await generateLlmInterpretationV1(makeArgs({
			canonicalFieldsBody: "field=company_stage value=seed",
			externalDiligenceBody: "claim_corroborations: no specific figures found",
		}));
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe("numeric_parity_failed");
		}
	});

	it("parity check covers external_risk_signals field", async () => {
		mockLlmResponse(makeValidJson({
			external_risk_signals: "Company fined $3M by regulator last quarter.",  // $3M NOT in corpus
		}));
		const result = await generateLlmInterpretationV1(makeArgs({
			canonicalFieldsBody: "field=company_stage value=seed",
			externalDiligenceBody: "company_news: regulatory inquiry mentioned, no dollar figures",
		}));
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toBe("numeric_parity_failed");
		}
	});

	it("externalDiligenceBody is included in canonical corpus for parity check", async () => {
		mockLlmResponse(makeValidJson({
			// Override makeValidJson defaults that contain $500K — corpus has no $500K here
			executive_summary: "The company is in early stage with strong market opportunity.",
			capital_and_raise_interpretation: "Raise structure not currently disclosed.",
			external_market_context: "Market growing at $10B TAM.",
		}));
		// $10B is in externalDiligenceBody corpus → should pass parity
		const result = await generateLlmInterpretationV1(makeArgs({
			canonicalFieldsBody: null,
			insightSlotsBody: "company_stage: Computable | value=early | evidence=doc1 | reason=detected",
			externalDiligenceBody: "market_trends: $10B TAM growing fast",
		}));
		expect(result.ok).toBe(true);
	});
});
