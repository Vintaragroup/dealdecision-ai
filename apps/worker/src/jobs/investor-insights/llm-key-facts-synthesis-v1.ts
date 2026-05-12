/**
 * llm-key-facts-synthesis-v1.ts
 *
 * Global Key Facts recovery path:
 *   bad extraction → detect quality issue → synthesize from broader evidence → validate
 *
 * Produces investor-readable 1–2 sentence narratives for the four Key Facts cards:
 *   product_narrative, market_narrative, business_model_narrative, raise_terms_narrative
 *
 * Per-field diagnostics cover:
 *   raw_quality, recovery_triggered, synthesis_status, confidence, final_source,
 *   validator_status, rejection_reason, repair_attempted, entity_confusion_detected
 *
 * Design contract:
 *  - Only state facts present in the provided corpus — no invention.
 *  - Distinguish company-level facts from portfolio / project / customer examples.
 *  - Never reuse OCR garbage verbatim.
 *  - Each narrative ≤ 2 sentences, investor-readable.
 *  - Return null narratives when evidence is insufficient — do not fabricate.
 */

import { OpenAIGPT4oProvider } from "../../lib/llm/providers/openai-provider";
import type { ProviderConfig } from "../../lib/llm/types";

// ─── Types ───────────────────────────────────────────────────────────────────

export type KeyFactsRawQuality =
	| "clean"
	| "noisy"
	| "ocr_garbage"
	| "fragment"
	| "wrong_entity_suspected"
	| "insufficient";

export type KeyFactsSynthesisStatus =
	| "synthesized"
	| "fallback"
	| "rejected"
	| "insufficient_evidence"
	| "structured_field_used";

export type KeyFactsFinalSource =
	| "llm_synthesis"
	| "structured_field"
	| "fallback";

export type KeyFactsValidatorStatus =
	| "passed"
	| "rejected"
	| "repaired"
	| "not_run";

export interface KeyFactsFieldDiagnostics {
	raw_quality: KeyFactsRawQuality;
	recovery_triggered: boolean;
	evidence_chunks_used: number;
	synthesis_status: KeyFactsSynthesisStatus;
	confidence: "high" | "medium" | "low" | "none";
	final_source: KeyFactsFinalSource;
	validator_status: KeyFactsValidatorStatus;
	rejection_reason: string | null;
	repair_attempted: boolean;
	entity_confusion_detected: boolean;
}

export interface KeyFactsSynthesisV1 {
	product_narrative: string | null;
	market_narrative: string | null;
	business_model_narrative: string | null;
	raise_terms_narrative: string | null;
	diagnostics: {
		product: KeyFactsFieldDiagnostics;
		market: KeyFactsFieldDiagnostics;
		business_model: KeyFactsFieldDiagnostics;
		raise_terms: KeyFactsFieldDiagnostics;
	};
}

export interface KeyFactsSynthesisInput {
	/**
	 * Serialized ProductProfileV1 JSON string (from product_profile_v1 section body).
	 * Used as prior context for product + market synthesis.
	 */
	productProfileBody: string | null;
	/**
	 * Broader DPU deck text containing product/market/business model content.
	 * Up to 800 chars from non-financial slide pages.
	 */
	productNarrativeBody: string | null;
	/**
	 * Structured insight slots body (market claims, traction signals, raise signals).
	 * Contains slot labels and detected values from deterministic extraction.
	 */
	insightSlotsBody: string | null;
	/**
	 * Phase-2 canonical fields body (raise amount, stage, revenue model labels).
	 */
	canonicalFieldsBody: string | null;
	/**
	 * Up to 8 evidence snippets with IDs.
	 */
	evidenceSnippets: { id: string; text: string }[];
	/**
	 * CRM deal name (may differ from brand name in deck).
	 */
	dealName?: string;
}

export type KeyFactsSynthesisResult =
	| { ok: true; value: KeyFactsSynthesisV1 }
	| { ok: false; reason: string };

// ─── Serialization ──────────────────────────────────────────────────────────

export function serializeKeyFactsSynthesisBody(value: KeyFactsSynthesisV1): string {
	return JSON.stringify(value);
}

// ─── OCR / quality detection helpers (reused from worker side) ──────────────

const OCR_GARBAGE_PATTERNS = [
	// Isolated non-letter tokens mid-sentence: "eae ila oe HES"
	/\b[a-z]{2,3}\b\s+\b[a-z]{2,3}\b\s+\b[a-z]{2,3}\b/i,
	// High density of very short tokens
	// (checked via token analysis below — not regex)
];

const ALL_CAPS_RE = /^[A-Z0-9\s,.:;!?()-]{15,}$/;
const BROKEN_SPACING_RE = /\s{3,}/;
const ENTITY_CONFUSION_MARKERS = [
	/\bProject\s+[A-Z]\b/,               // "Project S", "Project Alpha"
	/\bphase\s+[1-9I]+\b/i,              // "Phase 1", "Phase II"
	/\bcustomer\s+case\s+study\b/i,
	/\bportfolio\s+(?:company|asset|project)\b/i,
];

function detectRawQuality(text: string | null | undefined): KeyFactsRawQuality {
	if (!text || text.trim().length === 0) return "insufficient";
	const trimmed = text.trim();
	const tokens = trimmed.split(/\s+/);

	// Fragment: fewer than 4 meaningful words
	const realWords = tokens.filter((t) => /^[a-zA-Z''-]{3,}$/.test(t));
	if (realWords.length < 4) return "fragment";

	// All-caps noise
	if (ALL_CAPS_RE.test(trimmed)) return "ocr_garbage";

	// Broken spacing
	if (BROKEN_SPACING_RE.test(trimmed)) return "noisy";

	// High ratio of very short tokens → OCR garbage
	const shortTokenRatio =
		tokens.filter((t) => t.replace(/[^a-zA-Z]/g, "").length <= 2).length / tokens.length;
	if (tokens.length > 5 && shortTokenRatio > 0.45) return "ocr_garbage";

	// High non-alphabetic ratio
	const alphaChars = (trimmed.match(/[a-zA-Z]/g) ?? []).length;
	const spaceChars = (trimmed.match(/\s/g) ?? []).length;
	const nonAlpha = trimmed.length - alphaChars - spaceChars;
	if (alphaChars > 0 && nonAlpha / alphaChars > 0.25) return "ocr_garbage";

	// Real word ratio too low → noisy
	if (tokens.length >= 6 && realWords.length / tokens.length < 0.55) return "noisy";

	// Entity confusion markers → flag potential wrong entity
	for (const pattern of ENTITY_CONFUSION_MARKERS) {
		if (pattern.test(trimmed)) return "wrong_entity_suspected";
	}

	// At least 8 real words AND investor-readable
	if (realWords.length >= 8) return "clean";
	return "noisy";
}

// ─── Narrative validator ─────────────────────────────────────────────────────

interface ValidatorResult {
	status: KeyFactsValidatorStatus;
	rejection_reason: string | null;
	entity_confusion_detected: boolean;
}

function validateNarrative(text: string | null): ValidatorResult {
	if (!text || text.trim().length === 0) {
		return { status: "rejected", rejection_reason: "empty_narrative", entity_confusion_detected: false };
	}

	const trimmed = text.trim();
	const tokens = trimmed.split(/\s+/);

	// Reject OCR artifacts
	const quality = detectRawQuality(trimmed);
	if (quality === "ocr_garbage") {
		return { status: "rejected", rejection_reason: "ocr_artifacts_in_output", entity_confusion_detected: false };
	}

	// Reject if too short (< 6 real words)
	const realWords = tokens.filter((t) => /^[a-zA-Z''-]{3,}$/.test(t));
	if (realWords.length < 6) {
		return { status: "rejected", rejection_reason: "too_short", entity_confusion_detected: false };
	}

	// Reject entity confusion (project-level not company-level)
	for (const pattern of ENTITY_CONFUSION_MARKERS) {
		if (pattern.test(trimmed)) {
			return { status: "rejected", rejection_reason: "entity_confusion", entity_confusion_detected: true };
		}
	}

	// Reject too-generic boilerplate
	const GENERIC_BOILERPLATE_RE =
		/^(?:the company|this company|a company|the platform|this platform)\s+(?:is|provides|offers|enables|helps)\s+[a-z]/i;
	if (GENERIC_BOILERPLATE_RE.test(trimmed) && tokens.length < 15) {
		return { status: "rejected", rejection_reason: "too_generic", entity_confusion_detected: false };
	}

	// Reject if > 4 sentences (too long for a Key Facts card)
	const sentenceCount = (trimmed.match(/[.!?](?:\s|$)/g) ?? []).length;
	if (sentenceCount > 4) {
		return { status: "rejected", rejection_reason: "too_long", entity_confusion_detected: false };
	}

	return { status: "passed", rejection_reason: null, entity_confusion_detected: false };
}

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an AI investment analyst synthesizing investor-readable Key Facts cards from pitch deck materials.

GOVERNANCE RULES — MUST FOLLOW:
1. Only state facts explicitly present in the provided corpus. Do not invent features, revenue, customers, or market claims.
2. Write 1–2 concise, investor-readable sentences per field. No bullet points, no headers.
3. ENTITY DISTINCTION — CRITICAL: If the corpus describes multiple projects, portfolio assets, financed deals, or customer case studies, you MUST describe what the COMPANY ITSELF builds, sells, or operates. Do NOT describe a portfolio project or customer as the company's product. If the company is a lender, describe the lending platform — not the loans.
4. Do NOT reuse OCR garbage text verbatim. Synthesize a clean sentence from the concept, not the noisy source text.
5. If evidence for a field is absent or ambiguous, return null for that field. Do not fabricate.
6. product_narrative: What does the company build or do? (1–2 sentences, company-level)
7. market_narrative: What market does it serve, and what is the approximate scale? (1–2 sentences, only if TAM or market claim is present)
8. business_model_narrative: How does the company make money? (1–2 sentences — delivery model, revenue type)
9. raise_terms_narrative: What are the raise terms? (1 sentence: amount + round type + key terms if available)
10. If product_profile context is provided, use it as a grounding reference — but synthesize fresh sentences, do not copy verbatim.

Return exactly this JSON schema — no extra keys:
{
  "product_narrative": "<1-2 sentences or null>",
  "market_narrative": "<1-2 sentences or null>",
  "business_model_narrative": "<1-2 sentences or null>",
  "raise_terms_narrative": "<1 sentence or null>"
}`;

// ─── Generator ───────────────────────────────────────────────────────────────

export async function generateKeyFactsSynthesisV1(
	input: KeyFactsSynthesisInput,
): Promise<KeyFactsSynthesisResult> {
	const {
		productProfileBody,
		productNarrativeBody,
		insightSlotsBody,
		canonicalFieldsBody,
		evidenceSnippets,
		dealName,
	} = input;

	// Require at minimum product narrative or insight slots (some deck evidence)
	const hasCorpus =
		(productNarrativeBody && productNarrativeBody.trim().length >= 30) ||
		(insightSlotsBody && insightSlotsBody.trim().length >= 30) ||
		(productProfileBody && productProfileBody.trim().length >= 20);

	if (!hasCorpus) {
		return { ok: false, reason: "insufficient_corpus" };
	}

	const apiKey = process.env.OPENAI_API_KEY;
	if (!apiKey) {
		return { ok: false, reason: "missing_openai_api_key" };
	}

	// Build corpus
	const corpusParts: string[] = [];
	if (dealName) {
		corpusParts.push(`## Deal Name (CRM label — may differ from brand name in materials)\n${dealName}`);
	}

	if (productProfileBody) {
		// Extract key fields from product_profile_v1 for grounding context
		try {
			const pp = JSON.parse(productProfileBody) as Record<string, unknown>;
			const fields: string[] = [];
			if (pp.company_description && typeof pp.company_description === "string") {
				fields.push(`Company description (prior synthesis): ${pp.company_description}`);
			}
			if (pp.solution_summary && typeof pp.solution_summary === "string") {
				fields.push(`Solution summary (prior synthesis): ${pp.solution_summary}`);
			}
			if (pp.target_customer && typeof pp.target_customer === "string") {
				fields.push(`Target customer: ${pp.target_customer}`);
			}
			if (pp.delivery_model && typeof pp.delivery_model === "string" && pp.delivery_model !== "Unknown") {
				fields.push(`Delivery model: ${pp.delivery_model}`);
			}
			if (pp.product_type && typeof pp.product_type === "string" && pp.product_type !== "Unknown") {
				fields.push(`Product type: ${pp.product_type}`);
			}
			if (fields.length > 0) {
				corpusParts.push(`## Product Profile Context\n${fields.join("\n")}`);
			}
		} catch {
			// JSON parse failed — skip product profile context
		}
	}

	if (productNarrativeBody) {
		corpusParts.push(`## Deck Narrative\n${productNarrativeBody.slice(0, 1200)}`);
	}

	if (insightSlotsBody) {
		corpusParts.push(`## Insight Signals\n${insightSlotsBody.slice(0, 800)}`);
	}

	if (canonicalFieldsBody) {
		corpusParts.push(`## Canonical Fields\n${canonicalFieldsBody.slice(0, 600)}`);
	}

	if (evidenceSnippets.length > 0) {
		const evidenceLines = evidenceSnippets
			.slice(0, 8)
			.map((s) => `[${s.id}] ${s.text.slice(0, 250)}`)
			.join("\n");
		corpusParts.push(`## Evidence Snippets\n${evidenceLines}`);
	}

	const corpus = corpusParts.join("\n\n");

	const providerConfig: ProviderConfig = {
		type: "openai",
		enabled: true,
		priority: 1,
		apiKey,
		timeout: 40_000,
		retries: 2,
	};

	const provider = new OpenAIGPT4oProvider(providerConfig);

	let response: Awaited<ReturnType<typeof provider.complete>>;
	try {
		response = await provider.complete({
			task: "synthesis",
			model: "gpt-4o-mini" as any,
			temperature: 0,
			max_tokens: 600,
			messages: [
				{ role: "system", content: SYSTEM_PROMPT },
				{ role: "user", content: corpus },
			],
			metadata: { kind: "key_facts_synthesis_v1" },
		});
	} catch {
		return { ok: false, reason: "llm_call_failed" };
	}

	if (!response?.content) {
		return { ok: false, reason: "llm_empty_response" };
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(response.content.trim());
	} catch {
		const jsonMatch = /\{[\s\S]*\}/.exec(response.content);
		if (!jsonMatch) return { ok: false, reason: "llm_output_not_json" };
		try {
			parsed = JSON.parse(jsonMatch[0]);
		} catch {
			return { ok: false, reason: "llm_output_not_json" };
		}
	}

	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		return { ok: false, reason: "llm_output_not_object" };
	}

	const p = parsed as Record<string, unknown>;
	const strOrNull = (v: unknown): string | null =>
		typeof v === "string" && v.trim() ? v.trim().slice(0, 400) : null;

	const rawProduct = strOrNull(p.product_narrative);
	const rawMarket = strOrNull(p.market_narrative);
	const rawBizModel = strOrNull(p.business_model_narrative);
	const rawRaise = strOrNull(p.raise_terms_narrative);

	const evidenceCount = evidenceSnippets.length;

	// Validate each field and build diagnostics
	const buildFieldDiagnostics = (
		rawText: string | null,
		fieldName: keyof KeyFactsSynthesisV1["diagnostics"],
	): { text: string | null; diagnostics: KeyFactsFieldDiagnostics } => {
		// Assess raw quality from the synthesized output
		const rawQuality = detectRawQuality(rawText);
		const recoveryTriggered = rawQuality !== "clean" && rawQuality !== "insufficient";

		if (!rawText) {
			return {
				text: null,
				diagnostics: {
					raw_quality: "insufficient",
					recovery_triggered: false,
					evidence_chunks_used: 0,
					synthesis_status: "insufficient_evidence",
					confidence: "none",
					final_source: "fallback",
					validator_status: "not_run",
					rejection_reason: "null_from_llm",
					repair_attempted: false,
					entity_confusion_detected: false,
				},
			};
		}

		const validation = validateNarrative(rawText);

		if (validation.status === "passed") {
			return {
				text: rawText,
				diagnostics: {
					raw_quality: rawQuality,
					recovery_triggered: recoveryTriggered,
					evidence_chunks_used: evidenceCount,
					synthesis_status: "synthesized",
					confidence: evidenceCount >= 3 ? "high" : evidenceCount >= 1 ? "medium" : "low",
					final_source: "llm_synthesis",
					validator_status: "passed",
					rejection_reason: null,
					repair_attempted: false,
					entity_confusion_detected: false,
				},
			};
		}

		// Validation failed
		// For entity_confusion, attempt a repair: strip the entity-confused sentence
		if (validation.rejection_reason === "entity_confusion") {
			const sentences = rawText.split(/(?<=[.!?])\s+/);
			const repairedSentences = sentences.filter(
				(s) => !ENTITY_CONFUSION_MARKERS.some((re) => re.test(s)),
			);
			const repairedText = repairedSentences.join(" ").trim();

			if (repairedText && repairedText.length >= 20) {
				const revalidation = validateNarrative(repairedText);
				if (revalidation.status === "passed") {
					return {
						text: repairedText,
						diagnostics: {
							raw_quality: rawQuality,
							recovery_triggered: true,
							evidence_chunks_used: evidenceCount,
							synthesis_status: "synthesized",
							confidence: "medium",
							final_source: "llm_synthesis",
							validator_status: "repaired",
							rejection_reason: null,
							repair_attempted: true,
							entity_confusion_detected: true,
						},
					};
				}
			}

			// Repair failed
			return {
				text: null,
				diagnostics: {
					raw_quality: rawQuality,
					recovery_triggered: true,
					evidence_chunks_used: evidenceCount,
					synthesis_status: "rejected",
					confidence: "none",
					final_source: "fallback",
					validator_status: "rejected",
					rejection_reason: validation.rejection_reason,
					repair_attempted: true,
					entity_confusion_detected: true,
				},
			};
		}

		// For too_long: truncate to first 2 sentences
		if (validation.rejection_reason === "too_long") {
			const sentences = rawText.split(/(?<=[.!?])\s+/);
			const truncated = sentences.slice(0, 2).join(" ").trim();
			const revalidation = validateNarrative(truncated);
			if (revalidation.status === "passed") {
				return {
					text: truncated,
					diagnostics: {
						raw_quality: rawQuality,
						recovery_triggered: recoveryTriggered,
						evidence_chunks_used: evidenceCount,
						synthesis_status: "synthesized",
						confidence: evidenceCount >= 3 ? "high" : "medium",
						final_source: "llm_synthesis",
						validator_status: "repaired",
						rejection_reason: null,
						repair_attempted: true,
						entity_confusion_detected: false,
					},
				};
			}
		}

		// All other rejection reasons → rejected
		return {
			text: null,
			diagnostics: {
				raw_quality: rawQuality,
				recovery_triggered: recoveryTriggered,
				evidence_chunks_used: evidenceCount,
				synthesis_status: "rejected",
				confidence: "none",
				final_source: "fallback",
				validator_status: "rejected",
				rejection_reason: validation.rejection_reason,
				repair_attempted: false,
				entity_confusion_detected: validation.entity_confusion_detected,
			},
		};
	};

	const productResult = buildFieldDiagnostics(rawProduct, "product");
	const marketResult = buildFieldDiagnostics(rawMarket, "market");
	const bizModelResult = buildFieldDiagnostics(rawBizModel, "business_model");
	const raiseResult = buildFieldDiagnostics(rawRaise, "raise_terms");

	const synthesis: KeyFactsSynthesisV1 = {
		product_narrative: productResult.text,
		market_narrative: marketResult.text,
		business_model_narrative: bizModelResult.text,
		raise_terms_narrative: raiseResult.text,
		diagnostics: {
			product: productResult.diagnostics,
			market: marketResult.diagnostics,
			business_model: bizModelResult.diagnostics,
			raise_terms: raiseResult.diagnostics,
		},
	};

	return { ok: true, value: synthesis };
}
