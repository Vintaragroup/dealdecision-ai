import type { Job } from "bullmq";
import { createHash } from "crypto";
import {
  generatePhase1DIOV1,
  DealOrchestrator,
  DIOStorageImpl,
  compileDIOToReport,
  compileDIOToReportWithPromotedFacts,
  SlideSequenceAnalyzer,
  MetricBenchmarkValidator,
  VisualDesignScorer,
  NarrativeArcDetector,
  FinancialHealthCalculator,
  RiskAssessmentEngine,
  FinancialIntegrityAnalyzerV1,
  sanitizeText,
} from "@dealdecision/core";
import {
  getPool,
  getDocumentsForDealWithAnalysis,
  insertPhaseBRun,
  getLatestPhaseBRun,
} from "../../lib/db";
import { hasTable } from "../../lib/visual-extraction";
import { updateJob } from "../../lib/worker-utils";
import { updateJobProgress, emitJobProgress } from "../../lib/job-progress";
import { getQueue } from "../../lib/queue";
import { makeJobId } from "../../lib/job-id";
import { startHeartbeat } from "../../lib/heartbeat";
import {
  buildPhase1DealOverviewV2,
  buildPhase1DealUnderstandingV1,
  buildPhase1UpdateReportV1,
} from "../../lib/phase1/dealOverviewV2";
import { buildPhase1BusinessArchetypeV1 } from "../../lib/phase1/businessArchetypeV1";
import {
  extractPhaseBFeaturesV1,
  fetchPhaseBVisualsFromDb,
} from "../../lib/phaseb/extract";
import { materializePhaseBVisualEvidenceForDeal } from "../../lib/phaseb/materialize-evidence";
import { generateAndPersistGovernedLlmOverviewBestEffort } from "../../lib/governed-llm-overlay";
import { promoteSlideFactsFromDocumentPageUnderstanding } from "../../lib/promote-slide-facts";
import { populateDocumentPageUnderstandingFromVisualExtractions } from "../../lib/document-page-understanding";
import { OpenAIGPT4oProvider } from "../../lib/llm/providers/openai-provider";
import type { ProviderConfig } from "../../lib/llm/types";
import type { JobStatus } from "@dealdecision/contracts";
import { applySlideUnderstandingV1Shadow } from "../../lib/pdf_v2/slide-understanding-v1";
import {
	composePolicyAwareSystemPrompt,
	getSelectedPolicyIdFromAnyLike,
	validatePolicyAwareOutputTemplateV2,
} from "../../lib/policy-aware-prompt-runtime";
import { getFinancialFactsForDeal, getDocumentsForReport, FINANCIAL_FACTS_ANALYSIS_LIMIT } from "../../lib/db/financial-facts-db";
import { populatePageRegistryV1 } from "../../lib/page-registry/populate-page-registry-v1";
import { populateDealFactRegistryV1 } from "../../lib/deal-facts/populate-deal-fact-registry-v1";
import { populateFinancialFactRegistryV1 } from "../../lib/financial-facts/populate-financial-fact-registry-v1";

// -- safeJsonParseObject (local helper used by generateDealSummaryV2FromPhase1)
function safeJsonParseObject(raw: string): Record<string, unknown> | null {
	const trimmed = (raw ?? "").trim();
	if (!trimmed) return null;
	try {
		const parsed = JSON.parse(trimmed);
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
	} catch {
		// Best-effort recovery: extract first {...} block.
		const start = trimmed.indexOf("{");
		const end = trimmed.lastIndexOf("}");
		if (start >= 0 && end > start) {
			const candidate = trimmed.slice(start, end + 1);
			try {
				const parsed = JSON.parse(candidate);
				return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
			} catch {
				return null;
			}
		}
		return null;
	}
}

// -- DealSummaryV2 helpers
function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((v) => typeof v === "string");
}

type DealSummaryV2 = {
	generated_at: string;
	model: string;
	summary: {
		one_liner: string;
		paragraphs: [string, string, string];
	};
	strengths: string[];
	risks: string[];
	open_questions: string[];
};

function countWords(value: string): number {
	const s = String(value ?? "");
	const words = s.trim().split(/\s+/).filter(Boolean);
	return words.length;
}

const SUMMARY_BROKEN_ARTICLE_RX = /\bis an\s+for\b/gi;
const SUMMARY_INVESTMENT_KEYWORDS_RX =
	/\b(invest|investment|conviction|recommend|recommendation|proceed|pass|hold|score|risk|raise|round|valuation|diligence|gating)\b/i;

function cleanupSummarySentence(text: string): string {
	if (!text) return text;
	let out = text.replace(SUMMARY_BROKEN_ARTICLE_RX, "is for");
	out = out.replace(/\s+/g, " ").trim();
	return out;
}

function enforceInvestmentOneLiner(text: string, opts: { recommendation?: string | null }): string {
	const cleaned = cleanupSummarySentence(text);
	if (!cleaned) return cleaned;
	if (SUMMARY_INVESTMENT_KEYWORDS_RX.test(cleaned)) return cleaned;
	const rec = typeof opts.recommendation === "string" && opts.recommendation.trim().length > 0 ? opts.recommendation.trim() : null;
	const prefix = rec ? `Investment view (${rec})` : "Investment view";
	return `${prefix}: ${cleaned}`;
}

function countSentences(value: string): number {
	const s = String(value ?? "").trim();
	if (!s) return 0;
	const parts = s.split(/[.!?]+\s*/).map((p) => p.trim()).filter(Boolean);
	return parts.length;
}

function ensureParagraphConstraints(paragraph: string, opts: { minWords: number; minSentences: number; maxSentences: number; padSentences: string[] }): string {
	let p = String(paragraph ?? "").replace(/\s+/g, " ").trim();
	if (!p) p = "Key details are not provided in Phase 1 yet.";

	const makeSentence = (s: string) => {
		let t = String(s ?? "").replace(/\s+/g, " ").trim();
		if (!t) return "";
		if (!/[.!?]$/.test(t)) t += ".";
		return t;
	};

	if (!/[.!?]$/.test(p)) p += ".";

	let sentences = p.split(/[.!?]+\s*/).map((s) => s.trim()).filter(Boolean);
	while (sentences.length > opts.maxSentences) {
		sentences = [sentences.slice(0, opts.maxSentences - 1).join("; "), ...sentences.slice(opts.maxSentences - 1)];
	}

	let padIdx = 0;
	while (sentences.length < opts.minSentences && padIdx < opts.padSentences.length) {
		const s = makeSentence(opts.padSentences[padIdx++]);
		if (s) sentences.push(s.replace(/[.!?]$/, ""));
	}

	p = sentences.map((s) => makeSentence(s)).join(" ").trim();
	while (countWords(p) < opts.minWords && padIdx < opts.padSentences.length) {
		const s = makeSentence(opts.padSentences[padIdx++]);
		if (s) p = (p + " " + s).trim();
		if (countSentences(p) > opts.maxSentences) {
			const parts = p.split(/[.!?]+\s*/).map((x) => x.trim()).filter(Boolean);
			const clamped = [parts.slice(0, opts.maxSentences - 1).join("; "), ...parts.slice(opts.maxSentences - 1)];
			p = clamped.map((s2) => makeSentence(s2)).join(" ").trim();
		}
	}
	return p;
}

function normalizeParagraphs(value: unknown, padSentences: string[]): [string, string, string] | null {
	if (!Array.isArray(value) || value.length !== 3) return null;
	const raw = value.map((p) => (typeof p === "string" ? p.replace(/\s+/g, " ").trim() : ""));
	const p1 = ensureParagraphConstraints(raw[0], { minWords: 60, minSentences: 2, maxSentences: 4, padSentences });
	const p2 = ensureParagraphConstraints(raw[1], { minWords: 60, minSentences: 2, maxSentences: 4, padSentences });
	const p3 = ensureParagraphConstraints(raw[2], { minWords: 60, minSentences: 2, maxSentences: 4, padSentences });
	return [p1, p2, p3];
}

function coerceDealSummaryV2(parsed: Record<string, unknown>, nowIso: string, padSentences: string[]): DealSummaryV2 | null {
	const summaryNode = (parsed as any).summary;
	const oneLinerRaw =
		summaryNode && typeof summaryNode === "object" && typeof (summaryNode as any).one_liner === "string"
			? (summaryNode as any).one_liner
			: "";
	const one_liner = oneLinerRaw.replace(/\s+/g, " ").trim();
	if (!one_liner) return null;

	const paragraphs =
		summaryNode && typeof summaryNode === "object" ? normalizeParagraphs((summaryNode as any).paragraphs, padSentences) : null;
	if (!paragraphs) return null;

	const strengths =
		isStringArray(parsed.strengths)
			? parsed.strengths
			: isStringArray((parsed as any).key_strengths)
				? (parsed as any).key_strengths
				: [];
	const risks =
		isStringArray(parsed.risks)
			? parsed.risks
			: isStringArray((parsed as any).key_risks)
				? (parsed as any).key_risks
				: [];
	const open_questions =
		isStringArray(parsed.open_questions)
			? parsed.open_questions
			: isStringArray((parsed as any).openQuestions)
				? (parsed as any).openQuestions
				: [];
	const model = typeof parsed.model === "string" ? parsed.model : "gpt-4o-mini";
	return {
		generated_at: typeof parsed.generated_at === "string" ? parsed.generated_at : nowIso,
		model,
		summary: {
			one_liner,
			paragraphs,
		},
		strengths,
		risks,
		open_questions,
	};
}

function isRealEstatePolicyId(policyId: string | null | undefined): boolean {
	const v = typeof policyId === "string" ? policyId.trim().toLowerCase() : "";
	return v === "real_estate_underwriting" || v.includes("real_estate");
}

const STARTUP_BUSINESS_MODEL_RE = /\b(omnichannel|dtc|wholesale|retail|consumer|subscription|saas|ecommerce)\b/i;
const PLACEHOLDER_BUSINESS_MODEL_RE = /^(unknown|n\/a|na|none|tbd)$/i;

export function resolvePromotedBusinessModelForPolicy(input: {
	selectedPolicyId: string | null;
	promotedDisplay: string;
	promotedRawText?: string | null;
	currentDisplay?: string | null;
}): { action: "accept" | "replace" | "suppress"; display: string | null; reason: string } {
	const promoted = String(input.promotedDisplay ?? "").trim();
	if (!promoted) return { action: "suppress", display: null, reason: "empty_promoted_display" };

	if (PLACEHOLDER_BUSINESS_MODEL_RE.test(promoted)) {
		return { action: "suppress", display: null, reason: "placeholder_promoted_display" };
	}

	if (!isRealEstatePolicyId(input.selectedPolicyId)) {
		// SPV/fund guard: if the stored promoted display is a consumer channel label but the raw
		// slide text is dominated by fund/SPV language without an explicit DTC keyword, suppress.
		const rawText = String(input.promotedRawText ?? "").toLowerCase();
		const currentDisplay = String(input.currentDisplay ?? "").toLowerCase();
		const isDtcLabel = /\b(dtc\s*ecommerce|direct[\s-]to[\s-]consumer|omnichannel)\b/i.test(promoted);
		if (process.env.DDAI_DEBUG_POLICY_GUARD === "1" || process.env.DEBUG_PHASE1_OVERVIEW_V2 === "1") {
			console.log(JSON.stringify({ event: "DEBUG_POLICY_GUARD", isDtcLabel, rawText_len: rawText.length, currentDisplay_head: currentDisplay.slice(0, 80) }));
		}
		if (isDtcLabel) {
			// Case 1: rawText present — check for SPV/fund dominance without explicit DTC
			if (rawText) {
				const hasFundSpvInRaw = /\b(spvs?|special\s+purpose\s+vehicle|fund\s+vehicle|co-?investment|non-?dilutive|carried\s+interest|general\s+partner|limited\s+partner)\b/.test(rawText);
				const hasExplicitDtcKeyword = /\b(dtc\b|d2c\b|direct[\s-]to[\s-]consumer|direct\s+via\s+website|website\s+sales)/.test(rawText);
				if (hasFundSpvInRaw && !hasExplicitDtcKeyword) {
					return { action: "suppress", display: null, reason: "fund_spv_signals_block_dtc_without_explicit_dtc_keyword" };
				}
			}
			// Case 2: rawText empty — if the current live DPU analysis is clearly non-DTC (enterprise/AI/tech/fund),
			// or if there is no current context at all (rawText=null means stored fact has no supporting evidence),
			// treat stored DTC label as stale and suppress it.
			if (!rawText) {
				if (!currentDisplay) {
					// No raw evidence and no current context: stored label has no support — suppress.
					return { action: "suppress", display: null, reason: "stale_dtc_label_no_supporting_evidence" };
				}
				// If the current deterministic analysis does NOT detect DTC/ecommerce signals, the stored
				// DTC label is a stale artefact — suppress it. "SaaS", "Fund", "Licensing", etc. all lack DTC.
				const currentHasDtc = /\b(dtc\b|d2c\b|direct[\s-]to[\s-]consumer|ecommerce|consumer\s*\/\s*commerce)\b/i.test(currentDisplay);
				if (!currentHasDtc) {
					return { action: "suppress", display: null, reason: "stale_dtc_label_conflicts_with_current_non_dtc_signals" };
				}
			}
		}
		return { action: "accept", display: promoted, reason: "policy_non_real_estate" };
	}

	if (!STARTUP_BUSINESS_MODEL_RE.test(promoted)) {
		return { action: "accept", display: promoted, reason: "already_policy_compatible" };
	}

	const context = [promoted, input.promotedRawText ?? "", input.currentDisplay ?? ""].join(" ");
	const preferredEquity = /\bpreferred\s+equity\b/i.test(context);
	if (preferredEquity) {
		return {
			action: "replace",
			display: "Real estate investment (preferred equity)",
			reason: "startup_label_replaced_for_real_estate_preferred_equity",
		};
	}

	return {
		action: "replace",
		display: "Real estate structured investment",
		reason: "startup_label_replaced_for_real_estate",
	};
}

function buildDeterministicDealSummaryV2Fallback(nowIso: string, input: {
	dealId: string;
	dealName?: string | null;
	phase1_deal_overview_v2: unknown;
	phase1_executive_summary_v2: unknown;
	phase1_decision_summary_v1: unknown;
	eligibleDocuments: Array<{ id: string; title: string | null; type: string | null; page_count: number | null }>;
}): DealSummaryV2 {
	const overview = input.phase1_deal_overview_v2 && typeof input.phase1_deal_overview_v2 === "object" ? (input.phase1_deal_overview_v2 as any) : {};
	const exec = input.phase1_executive_summary_v2 && typeof input.phase1_executive_summary_v2 === "object" ? (input.phase1_executive_summary_v2 as any) : {};
	const signals = exec.signals && typeof exec.signals === "object" ? exec.signals : {};
	const score = typeof signals.score === "number" && Number.isFinite(signals.score) ? signals.score : null;
	const recommendation = typeof signals.recommendation === "string" ? signals.recommendation : null;
	const confidence = typeof signals.confidence === "string" ? signals.confidence : null;

	const product = typeof overview.product_solution === "string" && overview.product_solution.trim() ? overview.product_solution.trim() : "Product not provided in Phase 1.";
	const icp = typeof overview.market_icp === "string" && overview.market_icp.trim() ? overview.market_icp.trim() : "ICP not provided in Phase 1.";
	const model = typeof overview.business_model === "string" && overview.business_model.trim() ? overview.business_model.trim() : "Business model not provided in Phase 1.";
	const missing = Array.isArray(exec.missing) ? exec.missing.filter((x: any) => typeof x === "string" && x.trim()).map((x: string) => x.trim()).slice(0, 8) : [];
	const tractionSignals = Array.isArray(overview.traction_signals) ? overview.traction_signals.filter((x: any) => typeof x === "string" && x.trim()).map((x: string) => x.trim()).slice(0, 5) : [];

	const docCount = input.eligibleDocuments.length;
	const totalPages = input.eligibleDocuments.reduce((sum, d) => sum + (typeof d.page_count === "number" ? d.page_count : 0), 0);
	const dealName = typeof input.dealName === "string" && input.dealName.trim() ? input.dealName.trim() : "This deal";
	const one_liner = `${dealName}: ${product.length > 140 ? product.slice(0, 140).trimEnd() + "…" : product}`;

	const padSentences = [
		`What it is: ${product}`,
		`Target customer / ICP: ${icp}`,
		`Business model signal: ${model}`,
		recommendation && score != null && confidence ? `Phase 1 signal: ${recommendation} (${score}/100, confidence ${confidence}).` : "Phase 1 signal exists but scoring details may be incomplete.",
		missing.length > 0 ? `Coverage gaps flagged in Phase 1 include: ${missing.join(", ")}.` : "Coverage gaps were not explicitly listed in Phase 1 output.",
		`Inputs available at this stage come from ${docCount} extracted document(s) (${totalPages} page(s) total) and Phase 1 structured summaries; treat unknowns as open diligence items.`,
	];

	const p1 = ensureParagraphConstraints("", { minWords: 60, minSentences: 2, maxSentences: 4, padSentences });
	const p2 = ensureParagraphConstraints("", { minWords: 60, minSentences: 2, maxSentences: 4, padSentences });
	const p3 = ensureParagraphConstraints(
		tractionSignals.length > 0 ? `Traction signals observed: ${tractionSignals.join(", ")}.` : "Traction signals were not evidenced in Phase 1.",
		{ minWords: 60, minSentences: 2, maxSentences: 4, padSentences }
	);

	const strengths: string[] = [];
	if (typeof overview.product_solution === "string" && overview.product_solution.trim()) strengths.push("Clear product description present in Phase 1.");
	if (typeof overview.market_icp === "string" && overview.market_icp.trim()) strengths.push("Identified ICP / target customer.");
	if (tractionSignals.length > 0) strengths.push(`Traction signals: ${tractionSignals.slice(0, 2).join(", ")}.`);
	if (strengths.length === 0) strengths.push("Phase 1 provides a starting point but coverage is limited.");

	const risks = missing.length > 0 ? missing.slice(0, 5).map((m: string) => `Missing: ${m}.`) : ["Missing key diligence details (raise/terms, go-to-market, risks)."];
	const open_questions = missing.length > 0 ? missing.slice(0, 6).map((m: string) => `Clarify: ${m}.`) : ["Clarify raise amount and terms.", "Clarify go-to-market strategy.", "Clarify traction metrics and unit economics."];

	return {
		generated_at: nowIso,
		model: "gpt-4o-mini",
		summary: {
			one_liner,
			paragraphs: [p1, p2, p3],
		},
		strengths,
		risks,
		open_questions,
	};
}

async function generateDealSummaryV2FromPhase1(input: {
	nowIso: string;
	dealId: string;
	dealName?: string | null;
	selected_policy_id?: string | null;
	phase1_deal_overview_v2: unknown;
	phase1_business_archetype_v1: unknown;
	phase1_update_report_v1: unknown;
	phase1_executive_summary_v2: unknown;
	phase1_decision_summary_v1: unknown;
	eligibleDocuments: Array<{ id: string; title: string | null; type: string | null; page_count: number | null }>;
}): Promise<{
	summary: DealSummaryV2;
	llm_call: {
		purpose: "narrative_synthesis";
		called_at: string;
		token_usage: {
			input_tokens: number;
			output_tokens: number;
			total_tokens: number;
			estimated_cost: number;
		};
		duration_ms: number;
		success: boolean;
		selected_policy_id?: string;
		prompt_runtime?: {
			template_version: string;
			prompt_artifacts: Array<{ id: string; file: string; version: string; sha256: string }>;
		};
		output_validation?: {
			ok: boolean;
			degraded: boolean;
			missing_sections: string[];
			policy_mapping_valid: boolean;
			warnings: string[];
		};
		error?: string;
	};
} | null> {
	const apiKey = process.env.OPENAI_API_KEY;
	if (!apiKey) {
		console.warn(
			JSON.stringify({
				event: "phase1_deal_summary_v2_skipped",
				deal_id: input.dealId,
				reason: "missing_openai_api_key",
			})
		);
		return null;
	}

	const providerConfig: ProviderConfig = {
		type: "openai",
		enabled: true,
		priority: 1,
		apiKey,
		// Keep this lightweight; rely on provider's built-in retry/backoff.
		timeout: 30_000,
		retries: 2,
	};

	const provider = new OpenAIGPT4oProvider(providerConfig);

	const promptRuntime = composePolicyAwareSystemPrompt({
		kind: "deal_summary_v2",
		selectedPolicyId: input.selected_policy_id,
		additionalInstructions: [
			"Use ONLY the provided Phase 1 artifacts and document metadata. Do not invent facts or numbers.",
			"If a detail is missing, state it explicitly as a gap (e.g., 'Raise/terms not provided').",
			"Output MUST be valid JSON only (no markdown, no backticks, no extra text).",
			"Return JSON with EXACT schema and keys: {\"generated_at\": string, \"model\": \"gpt-4o-mini\", \"summary\": {\"one_liner\": string, \"paragraphs\": [string,string,string]}, \"strengths\": string[], \"risks\": string[], \"open_questions\": string[]}.",
			"Investment framing requirements:",
			"- summary.one_liner MUST read like an investment viewpoint (recommendation, conviction, or gating raise context). Do NOT write 'Company X is a...' marketing blurbs.",
			"- summary.paragraphs[0]: describe what the deal is (raise/instrument/stage) and the current recommendation posture.",
			"- summary.paragraphs[1]: describe the top conviction drivers (team/product/traction) referencing available quantitative or qualitative proof.",
			"- summary.paragraphs[2]: describe the key risks, gaps, or next diligence items blocking full conviction.",
			"Requirements: summary.paragraphs MUST be exactly 3 paragraphs.",
			"Each paragraph MUST be 2–4 sentences and at least 60 words.",
			"No bullet points in paragraphs. Use investor-grade, analytical language, referencing recommendation/score when provided.",
			"Prefer deal_overview_v2 for product/ICP/model, executive_summary_v2.signals for recommendation/score/confidence, and decision_summary_v1 for open risks.",
		],
	});
	const system = promptRuntime.systemPrompt;

	const payload = {
		deal: {
			id: input.dealId,
			name: typeof input.dealName === "string" ? input.dealName : null,
		},
		phase1: {
			deal_overview_v2: input.phase1_deal_overview_v2,
			executive_summary_v2: input.phase1_executive_summary_v2,
			business_archetype_v1: input.phase1_business_archetype_v1,
			decision_summary_v1: input.phase1_decision_summary_v1,
			update_report_v1: input.phase1_update_report_v1,
		},
		documents: input.eligibleDocuments,
	};

	const response = await provider.complete({
		task: "synthesis",
		model: "gpt-4o-mini" as any,
		temperature: 0,
		max_tokens: 1000,
		messages: [
			{ role: "system", content: system },
			{ role: "user", content: JSON.stringify(payload) },
		],
		metadata: { dealId: input.dealId, kind: "deal_summary_v2" },
	});

	const baseCallLog = {
		purpose: "narrative_synthesis" as const,
		called_at: input.nowIso,
		selected_policy_id: promptRuntime.runtimeMetadata.selected_policy_id,
		prompt_runtime: {
			template_version: promptRuntime.runtimeMetadata.template_version,
			prompt_artifacts: promptRuntime.runtimeMetadata.prompt_artifacts,
		},
		token_usage: {
			input_tokens: Number(response?.usage?.prompt_tokens ?? 0),
			output_tokens: Number(response?.usage?.completion_tokens ?? 0),
			total_tokens: Number(response?.usage?.total_tokens ?? 0),
			estimated_cost: Number(response?.cost ?? 0),
		},
		duration_ms: Number(response?.latency_ms ?? 0),
		success: true,
	} as const;

	const parsed = safeJsonParseObject(response.content);
	if (!parsed) {
		console.warn(
			JSON.stringify({
				event: "phase1_deal_summary_v2_failed",
				deal_id: input.dealId,
				reason: "json_parse_failed",
				content_head: String(response.content ?? "").slice(0, 220),
			})
		);
		const fallback = buildDeterministicDealSummaryV2Fallback(input.nowIso, {
			dealId: input.dealId,
			dealName: input.dealName,
			phase1_deal_overview_v2: input.phase1_deal_overview_v2,
			phase1_executive_summary_v2: input.phase1_executive_summary_v2,
			phase1_decision_summary_v1: input.phase1_decision_summary_v1,
			eligibleDocuments: input.eligibleDocuments,
		});
		console.log(
			JSON.stringify({
				event: "phase1_deal_summary_v2_fallback_used",
				deal_id: input.dealId,
				reason: "json_parse_failed",
				paragraph_words: fallback.summary.paragraphs.map((p) => countWords(p)),
			})
		);
		return { summary: fallback, llm_call: { ...baseCallLog, success: false, error: "json_parse_failed" } };
	}
	const outputValidation = validatePolicyAwareOutputTemplateV2({
		kind: "deal_summary_v2",
		selectedPolicyId: promptRuntime.runtimeMetadata.selected_policy_id,
		output: parsed,
	});
	if (!outputValidation.ok) {
		console.warn(
			JSON.stringify({
				event: "phase1_deal_summary_v2_policy_template_invalid",
				deal_id: input.dealId,
				selected_policy_id: promptRuntime.runtimeMetadata.selected_policy_id,
				missing_sections: outputValidation.missing_sections,
				policy_mapping_valid: outputValidation.policy_mapping_valid,
				warnings: outputValidation.warnings,
			})
		);
	}
	const padSentences = [
		`What it is: ${typeof (input.phase1_deal_overview_v2 as any)?.product_solution === "string" ? (input.phase1_deal_overview_v2 as any).product_solution : "not provided"}`,
		`Target customer / ICP: ${typeof (input.phase1_deal_overview_v2 as any)?.market_icp === "string" ? (input.phase1_deal_overview_v2 as any).market_icp : "not provided"}`,
		`Business model signal: ${typeof (input.phase1_deal_overview_v2 as any)?.business_model === "string" ? (input.phase1_deal_overview_v2 as any).business_model : "not provided"}`,
		"This summary is Phase 1 only; if a detail is missing, treat it as an open diligence gap.",
	];
	const coerced = coerceDealSummaryV2(parsed, input.nowIso, padSentences);
	if (!coerced) {
		console.warn(
			JSON.stringify({
				event: "phase1_deal_summary_v2_failed",
				deal_id: input.dealId,
				reason: "schema_coercion_failed",
				parsed_keys: Object.keys(parsed),
			})
		);
		const fallback = buildDeterministicDealSummaryV2Fallback(input.nowIso, {
			dealId: input.dealId,
			dealName: input.dealName,
			phase1_deal_overview_v2: input.phase1_deal_overview_v2,
			phase1_executive_summary_v2: input.phase1_executive_summary_v2,
			phase1_decision_summary_v1: input.phase1_decision_summary_v1,
			eligibleDocuments: input.eligibleDocuments,
		});
		console.log(
			JSON.stringify({
				event: "phase1_deal_summary_v2_fallback_used",
				deal_id: input.dealId,
				reason: "schema_coercion_failed",
				paragraph_words: fallback.summary.paragraphs.map((p) => countWords(p)),
			})
		);
		return {
			summary: fallback,
			llm_call: {
				...baseCallLog,
				success: false,
				error: "schema_coercion_failed",
				output_validation: {
					ok: outputValidation.ok,
					degraded: outputValidation.degraded,
					missing_sections: outputValidation.missing_sections,
					policy_mapping_valid: outputValidation.policy_mapping_valid,
					warnings: outputValidation.warnings,
				},
			},
		};
	}
	// Ensure model matches the required one even if the model omits it.
	coerced.model = "gpt-4o-mini";
	const execSummarySignals = input.phase1_executive_summary_v2 && typeof input.phase1_executive_summary_v2 === "object"
		? (input.phase1_executive_summary_v2 as any)
		: null;
	const recommendation = typeof execSummarySignals?.recommendation === "string" ? execSummarySignals.recommendation : null;
	coerced.summary.one_liner = enforceInvestmentOneLiner(coerced.summary.one_liner, { recommendation });
	console.log(
		JSON.stringify({
			event: "phase1_deal_summary_v2_built",
			deal_id: input.dealId,
			model: coerced.model,
			one_liner_len: coerced.summary.one_liner.length,
			paragraph_words: coerced.summary.paragraphs.map((p) => countWords(p)),
			strengths: coerced.strengths.length,
			risks: coerced.risks.length,
			open_questions: coerced.open_questions.length,
		})
	);
	return {
		summary: coerced,
		llm_call: {
			...baseCallLog,
			output_validation: {
				ok: outputValidation.ok,
				degraded: outputValidation.degraded,
				missing_sections: outputValidation.missing_sections,
				policy_mapping_valid: outputValidation.policy_mapping_valid,
				warnings: outputValidation.warnings,
			},
		},
	};
}

// -- getDealIdForJob
async function getDealIdForJob(job: Job): Promise<string | null> {
	const pool = getPool();
	const jobId = (job.id ?? job.name)?.toString();
	if (!jobId) return null;

	const { rows } = await pool.query<{ deal_id: string | null }>(
		`SELECT deal_id FROM jobs WHERE job_id = $1`,
		[sanitizeText(jobId)]
	);
	return rows?.[0]?.deal_id ?? null;
}

// -- Processor
export async function analyzeDealProcessor(job: Job): Promise<any> {
	const dealId =
		(job.data as { deal_id?: string } | undefined)?.deal_id ??
		(await getDealIdForJob(job));
	const requirePageUnderstanding = Boolean((job.data as any)?.payload?.require_page_understanding);
	const pageUnderstandingVersionRaw = (job.data as any)?.payload?.page_understanding_version;
	const pageUnderstandingVersion =
		typeof pageUnderstandingVersionRaw === "string" && pageUnderstandingVersionRaw.trim().length > 0
			? pageUnderstandingVersionRaw.trim()
			: "page_understanding_v1";
	// Phase 2: first-pass jobs are triggered by the first chunk of extract_visuals before all
	// pages have finished.  They intentionally skip investor_insights so that the expensive
	// multi-stage pipeline only runs once — from the full analyze_deal triggered at finalize.
	const isFirstPass = (job.data as any)?.reason === "first_pass_pages_ready"
		|| Boolean((job.data as any)?.prereq?.first_pass);
	// User-triggered force-refresh: bypass investor_insights dedup so Stage 5 executes and
	// writes financial_truth_summary + a fresh deal_challenge_pass_results row.
	// Automated/scheduled runs keep existing dedup behavior (force_recompute stays false).
	const isForceRefresh = Boolean((job.data as any)?.force_refresh) || Boolean((job.data as any)?.payload?.force_refresh);
	const minDpuCreatedAtRaw = (job.data as any)?.min_dpu_created_at ?? (job.data as any)?.payload?.min_dpu_created_at;
	const minDpuCreatedAt =
		typeof minDpuCreatedAtRaw === "string" && minDpuCreatedAtRaw.trim().length > 0
			? minDpuCreatedAtRaw.trim()
			: null;
	if (!dealId) {
		await updateJob(job, "failed", "Missing deal_id for analysis", 100);
		return { ok: false };
	}

	try {
		// Phase 7: observability — log the analysis mode so first-pass jobs are clearly
		// distinguishable in production logs without having to scan job payloads.
		console.log(
			JSON.stringify({
				event: "ANALYZE_DEAL_START",
				deal_id: dealId,
				job_id: job.id ? String(job.id) : null,
				is_first_pass: isFirstPass,
				is_force_refresh: isForceRefresh,
				reason: (job.data as any)?.reason ?? null,
				ts: new Date().toISOString(),
			})
		);
		await updateJob(job, "running", "Loading documents for analysis", 10);
		const rows = await getDocumentsForDealWithAnalysis(dealId);
		const eligible = rows.filter(
			(doc) => (doc.status === "completed" || doc.status === "ready_for_analysis") && doc.extraction_metadata
		);
		if (eligible.length === 0) {
			await updateJob(job, "failed", "No extracted documents available for analysis", 100);
			return { ok: false };
		}

		// Phase 1 needs *semantic* text coverage. For pitch decks, important signals (raise amount, ICP, product)
		// are often present only in slide OCR stored in `visual_extractions.ocr_text`.
		// Enrich Phase 1 inputs with a capped concatenation of per-page OCR to avoid "missing" summaries.
		const looksLikePitchDeckContent = (value: unknown): boolean => {
			if (!value || typeof value !== "object") return false;
			const pages = (value as any).pages;
			if (!Array.isArray(pages) || pages.length === 0) return false;
			const p0 = pages[0];
			if (!p0 || typeof p0 !== "object") return true;
			// Evidence of slide/pitch-deck extraction shapes.
			if (Array.isArray((p0 as any).words)) return true;
			if ((p0 as any).understanding_v1 || (p0 as any).understandingV1) return true;
			return true;
		};
		const inferAnalysisDocType = (doc: any): string => {
			if (doc?.type === "pitch_deck") return "pitch_deck";
			const structured = (doc?.structured_data && typeof doc.structured_data === "object")
				? (doc.structured_data as Record<string, unknown>)
				: {};
			const fromDb = looksLikePitchDeckContent(doc?.full_content);
			const fromStructured = looksLikePitchDeckContent((structured as any).full_content);
			return (fromDb || fromStructured) ? "pitch_deck" : (typeof doc?.type === "string" ? doc.type : "other");
		};

		const allowAppendVisualOcr = process.env.PHASE1_APPEND_VISUAL_OCR !== "0";
		const visualOcrByDocumentId = new Map<string, string>();
		if (allowAppendVisualOcr) {
			try {
				const pool = getPool();
				const tablesOk = (await hasTable(pool, "visual_assets")) && (await hasTable(pool, "visual_extractions"));
				if (tablesOk) {
					const pitchDeckIds = eligible
						.filter((d) => inferAnalysisDocType(d) === "pitch_deck")
						.map((d) => String(d.id))
						.filter((id) => id.trim().length > 0);
					if (pitchDeckIds.length > 0) {
						const { rows: ocrRows } = await pool.query<{ document_id: string; page_index: number; ocr_text: string }>(
							`
								SELECT va.document_id, va.page_index, ve.ocr_text
								  FROM visual_assets va
								  JOIN visual_extractions ve ON ve.visual_asset_id = va.id
								 WHERE va.document_id = ANY($1::uuid[])
								   AND ve.ocr_text IS NOT NULL
								   AND length(ve.ocr_text) > 0
								 ORDER BY va.document_id, va.page_index
							`,
							[pitchDeckIds]
						);

						const partsByDoc = new Map<string, string[]>();
						for (const r of ocrRows) {
							const docId = typeof r.document_id === "string" ? r.document_id : "";
							if (!docId) continue;
							const txt = typeof r.ocr_text === "string" ? r.ocr_text : "";
							if (!txt.trim()) continue;
							const arr = partsByDoc.get(docId) ?? [];
							// Keep deterministic ordering and add a lightweight page marker.
							arr.push(`\n\n[page ${Number(r.page_index ?? 0) + 1}]\n${txt}`);
							partsByDoc.set(docId, arr);
						}

						for (const [docId, parts] of partsByDoc.entries()) {
							const joined = parts.join("\n");
							// Cap to keep Phase 1 deterministic and avoid ballooning payloads.
							visualOcrByDocumentId.set(docId, joined.slice(0, 80_000));
						}
					}
				}
			} catch (err) {
				console.warn(
					JSON.stringify({
						event: "phase1_visual_ocr_append_failed",
						deal_id: dealId,
						reason: err instanceof Error ? err.message : String(err),
					})
				);
			}
		}

		const extractTextAppendFromFullContent = (fullContent: unknown): string => {
			let fc: any = fullContent;
			if (typeof fc === "string") {
				try {
					fc = JSON.parse(fc);
				} catch {
					return "";
				}
			}
			if (!fc || typeof fc !== "object") return "";

			const out: string[] = [];
			const pushText = (t: unknown) => {
				if (typeof t !== "string") return;
				const s = t.trim();
				if (!s) return;
				out.push(s);
			};

			const readUnderstanding = (u: any) => {
				if (!u || typeof u !== "object") return;
				pushText(u.text);
				const regions = Array.isArray(u.regions) ? u.regions : [];
				for (const r of regions) {
					if (!r || typeof r !== "object") continue;
					// Common shapes: {text}, {lines:[{text}]}, {tokens:[{text}]}
					pushText(r.text);
					if (Array.isArray(r.lines)) {
						for (const ln of r.lines) pushText(ln?.text);
					}
					if (Array.isArray(r.tokens)) {
						for (const tk of r.tokens) pushText(tk?.text);
					}
				}
			};

			const readPages = (pages: any[]) => {
				for (const p of pages) {
					if (!p || typeof p !== "object") continue;
					readUnderstanding(p.understanding_v1);
					readUnderstanding(p.understandingV1);
				}
			};

			if (Array.isArray(fc.pages)) readPages(fc.pages);
			if (fc.pdf_v2 && Array.isArray(fc.pdf_v2.pages)) readPages(fc.pdf_v2.pages);
			if (fc.understanding_v1) readUnderstanding(fc.understanding_v1);
			if (fc.understandingV1) readUnderstanding(fc.understandingV1);

			// Cap aggressively: this is an append-only hint stream.
			return out.join("\n").slice(0, 80_000);
		};

		// Build two document arrays:
		// A) `phase1Documents`: Phase 1 deterministic builders may use minimal pitch-deck layout tokens
		// B) `documentsForAnalyzers`: downstream analyzers remain canonical-only (no `full_content`)
		const pickPages = (value: unknown): any[] | null => {
			if (!value || typeof value !== "object") return null;
			const pages = (value as any).pages;
			if (!Array.isArray(pages)) return null;
			return pages as any[];
		};

		type Phase1Doc = { document_id: string; title?: string | null; type?: string | null; full_text?: string | null; full_content?: unknown | null };
		const phase1Documents: Phase1Doc[] = eligible.map((doc) => {
			const structured = (doc.structured_data && typeof doc.structured_data === "object")
				? (doc.structured_data as Record<string, unknown>)
				: {};
			const analysisType = inferAnalysisDocType({ ...doc, structured_data: structured });

			let minimalFullContent: unknown | undefined = undefined;
			if (analysisType === "pitch_deck") {
				const fromDb = pickPages(doc.full_content);
				const fromStructured = pickPages((structured as any).full_content);
				const pages = fromDb ?? fromStructured;
				if (pages && pages.length > 0) {
					minimalFullContent = {
						pages: pages.map((p: any, idx: number) => ({
							page: (p?.page ?? idx + 1) as any,
							words: Array.isArray(p?.words) ? p.words : [],
						})),
					};
				}
			}

			const baseFullText = typeof doc.full_text === "string" ? doc.full_text : "";
			const contentAppend = [
				extractTextAppendFromFullContent(doc.full_content),
				extractTextAppendFromFullContent((structured as any).full_content),
			]
				.filter((s) => typeof s === "string" && s.trim().length > 0)
				.join("\n\n");
			const ocrAppend = visualOcrByDocumentId.get(String(doc.id)) ?? "";
			const enrichedFullText = (
				baseFullText +
				(contentAppend ? `\n\n${contentAppend}` : "") +
				(ocrAppend ? `\n\n${ocrAppend}` : "")
			).slice(0, 120_000);

			return {
				document_id: doc.id,
				title: doc.title,
				type: analysisType,
				full_text: enrichedFullText.trim() ? enrichedFullText : null,
				// For pitch_deck: use the pre-built minimalFullContent (words-only projection).
				// For PPTX-format docs classified as "other" (full_content has slides array):
				// pass the raw full_content so extractPagesFromFullContent can extract slide text.
				...(minimalFullContent
					? { full_content: minimalFullContent }
					: (doc.full_content && typeof doc.full_content === "object" && Array.isArray((doc.full_content as any).slides)
						? { full_content: doc.full_content }
						: {})),
			};
		});

		const documentsForAnalyzers = eligible.map((doc) => {
			const structured = (doc.structured_data && typeof doc.structured_data === "object")
				? (doc.structured_data as Record<string, unknown>)
				: {};
			const analysisType = inferAnalysisDocType({ ...doc, structured_data: structured });
			const canonical = (structured as any)?.canonical && typeof (structured as any).canonical === "object"
				? (structured as any).canonical
				: undefined;
			const canonicalMetrics = (canonical as any)?.financials?.canonical_metrics && typeof (canonical as any).financials.canonical_metrics === "object"
				? ((canonical as any).financials.canonical_metrics as Record<string, unknown>)
				: {};
			const canonicalKeyMetrics = Object.entries(canonicalMetrics)
				.filter(([, v]) => typeof v === "number" && Number.isFinite(v as number))
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([k, v]) => ({ key: k, value: v, source: "canonical" }));

			const baseFullText = typeof doc.full_text === "string" ? doc.full_text : "";
			const contentAppend = [
				extractTextAppendFromFullContent(doc.full_content),
				extractTextAppendFromFullContent((structured as any).full_content),
			]
				.filter((s) => typeof s === "string" && s.trim().length > 0)
				.join("\n\n");
			const ocrAppend = visualOcrByDocumentId.get(String(doc.id)) ?? "";
			const enrichedFullText = (
				baseFullText +
				(contentAppend ? `\n\n${contentAppend}` : "") +
				(ocrAppend ? `\n\n${ocrAppend}` : "")
			).slice(0, 120_000);

			return {
				document_id: doc.id,
				title: doc.title,
				type: analysisType,
				page_count: doc.page_count ?? undefined,
				verification_status: doc.verification_status ?? null,
				verification_result: doc.verification_result ?? null,
				canonical: canonical ?? {
					company: {},
					deal: {},
					traction: {},
					financials: { canonical_metrics: {} },
					risks: {},
				},
				keyMetrics: canonicalKeyMetrics,
				mainHeadings: [],
				textSummary: "",
				full_text: enrichedFullText.trim() ? enrichedFullText : undefined,
				full_text_absent_reason: typeof doc.full_text_absent_reason === "string" ? doc.full_text_absent_reason : undefined,
			};
		});

		const dio_context = {
			primary_doc_type: documentsForAnalyzers.some((d: any) => d.type === "pitch_deck") ? "pitch_deck" : "other",
			deal_type: "other",
			vertical: "other",
			stage: "unknown",
			confidence: 0.5,
		};

		await updateJob(job, "running", `Running analysis (${documentsForAnalyzers.length} document(s))`, 40);

		const databaseUrl = process.env.DATABASE_URL;
		if (!databaseUrl) {
			throw new Error("DATABASE_URL is required for analyze_deal");
		}
		const storage = new DIOStorageImpl(databaseUrl);
		let previousDio: any | null = null;
		try {
			previousDio = await storage.getLatestDIO(dealId);
		} catch {
			previousDio = null;
		}

		const nowIso = new Date().toISOString();
		if (process.env.NODE_ENV !== "production" && process.env.DEBUG_PHASE1_LAYOUT === "1") {
			for (const d of phase1Documents) {
				if (d.type !== "pitch_deck") continue;
				const pages = (d.full_content && typeof d.full_content === "object" && Array.isArray((d.full_content as any).pages))
					? ((d.full_content as any).pages as any[])
					: [];
				let wordsTotal = 0;
				for (const p of pages) {
					const words = Array.isArray((p as any)?.words) ? ((p as any).words as any[]) : [];
					wordsTotal += words.length;
				}
				const fullTextLen = typeof d.full_text === "string" ? d.full_text.length : 0;
				console.log(
					JSON.stringify({
						event: "phase1_documents_layout_presence",
						deal_id: dealId,
						document_id: d.document_id,
						pages_count: pages.length,
						words_total: wordsTotal,
						full_text_len: fullTextLen,
					})
				);
			}
		}

		// Phase 1 deterministic builders (may use pitch deck OCR/layout tokens).
		// Keep raw `full_content` out of orchestrator input documents.
		// Note: Overview V2 internally uses Deal Understanding V1 extraction.
		buildPhase1DealUnderstandingV1({ nowIso, documents: phase1Documents });
		let phase1_deal_overview_v2 = buildPhase1DealOverviewV2({
			nowIso,
			documents: phase1Documents,
		});

		// Prefer per-slide promoted facts (from document_page_understanding) for raise + business model.
		// This keeps Phase 1 consistent with /report structured_summary and provides page-level citations.
		try {
			const pool = getPool();
			const selectedPolicyIdForPromotedFacts =
				getSelectedPolicyIdFromAnyLike(previousDio as any) ?? null;
			type EvidenceRow = {
				source_document_id: string | null;
				source_path: string | null;
				extracted_at: string | null;
				confidence: number | null;
				content_json: any;
				meta: any;
			};
			const loadPromoted = async (factType: "raise_terms_v1" | "business_model_v1"): Promise<{ display: string; rawText: string | null; docId: string | null; pageIndex: number | null } | null> => {
				const evidenceId = `deal:${dealId}:fact:${factType}`;
				let row: EvidenceRow | null = null;
				try {
					const res = await pool.query<EvidenceRow>(
						`SELECT source_document_id::text as source_document_id,
						        source_path::text as source_path,
						        extracted_at::text as extracted_at,
						        confidence,
						        content_json,
						        meta
						   FROM evidence_items
						  WHERE evidence_id = $1
						    AND deal_id = $2::uuid
						  LIMIT 1`,
						[evidenceId, dealId]
					);
					row = (res.rows?.[0] as any) ?? null;
				} catch {
					row = null;
				}
				if (!row || !row.content_json || typeof row.content_json !== "object") return null;
				const vj = (row.content_json as any)?.value_json ?? null;
				const display = typeof vj?.display === "string" && vj.display.trim()
					? vj.display.trim()
					: typeof vj?.raw_text === "string" && vj.raw_text.trim()
						? vj.raw_text.trim()
						: null;
				if (!display) return null;
				const rawText = typeof vj?.raw_text === "string" && vj.raw_text.trim() ? vj.raw_text.trim() : null;
				const prov = (row.content_json as any)?.provenance ?? null;
				const pageIndex = typeof prov?.page_index === "number" && Number.isFinite(prov.page_index)
					? Math.floor(prov.page_index)
					: typeof row.meta?.page_index === "number" && Number.isFinite(row.meta.page_index)
						? Math.floor(row.meta.page_index)
						: null;
				const docId = typeof row.source_document_id === "string" && row.source_document_id.trim() ? row.source_document_id.trim() : null;
				return { display, rawText, docId, pageIndex };
			};

			const mergeSources = (
				existing: any,
				add: Array<{ document_id: string; page_range?: [number, number]; note?: string }>
			): Array<{ document_id: string; page_range?: [number, number]; note?: string }> => {
				const cur = Array.isArray(existing) ? existing : [];
				const out: Array<{ document_id: string; page_range?: [number, number]; note?: string }> = [];
				const seen = new Set<string>();
				for (const s of [...cur, ...add]) {
					if (!s || typeof s.document_id !== "string" || !s.document_id.trim()) continue;
					const k = `${s.document_id}|${Array.isArray((s as any).page_range) ? (s as any).page_range.join(",") : ""}|${typeof (s as any).note === "string" ? (s as any).note : ""}`;
					if (seen.has(k)) continue;
					seen.add(k);
					out.push(s);
				}
				return out;
			};

			let promotedRaise = await loadPromoted("raise_terms_v1");
			let promotedModel = await loadPromoted("business_model_v1");

			// Best-effort self-heal: if evidence_items does not contain promoted facts yet,
			// try promoting from existing document_page_understanding for pitch deck docs.
			if (!promotedRaise || !promotedModel) {
				try {
					const dpuVersion = pageUnderstandingVersion;
					const runId = job.id ? String(job.id) : null;
					for (const doc of eligible) {
						const structured = (doc.structured_data && typeof doc.structured_data === "object")
							? (doc.structured_data as Record<string, unknown>)
							: {};
						const analysisType = inferAnalysisDocType({ ...doc, structured_data: structured });
						if (analysisType !== "pitch_deck") continue;
						const pageCount = typeof (doc as any)?.page_count === "number" && Number.isFinite((doc as any).page_count)
							? Math.max(0, Math.floor((doc as any).page_count))
							: 0;
						await promoteSlideFactsFromDocumentPageUnderstanding(pool as any, {
							dealId,
							documentId: String(doc.id),
							pageStart: 0,
							// Allow promotion to infer page range if page_count is missing.
							pageEnd: pageCount > 0 ? pageCount : 0,
							selectedPolicyId: selectedPolicyIdForPromotedFacts,
							version: dpuVersion,
							runId,
							stepRunId: null,
						});
					}
				} catch {
					// fail open
				}
				promotedRaise = promotedRaise ?? (await loadPromoted("raise_terms_v1"));
				promotedModel = promotedModel ?? (await loadPromoted("business_model_v1"));
			}

			if (promotedRaise && typeof promotedRaise.display === "string" && promotedRaise.display.trim()) {
				phase1_deal_overview_v2 = {
					...phase1_deal_overview_v2,
					raise: promotedRaise.display,
					sources: mergeSources((phase1_deal_overview_v2 as any)?.sources, [
						{
							document_id: promotedRaise.docId ?? (phase1Documents[0]?.document_id ?? "unknown"),
							...(typeof promotedRaise.pageIndex === "number" ? { page_range: [promotedRaise.pageIndex + 1, promotedRaise.pageIndex + 1] as [number, number] } : {}),
							note: typeof promotedRaise.pageIndex === "number" ? `promoted raise_terms_v1 (dpu page_index=${promotedRaise.pageIndex})` : "promoted raise_terms_v1",
						},
					]),
				};
			}

			if (promotedModel && typeof promotedModel.display === "string" && promotedModel.display.trim()) {
				const policyResolution = resolvePromotedBusinessModelForPolicy({
					selectedPolicyId: selectedPolicyIdForPromotedFacts,
					promotedDisplay: promotedModel.display,
					promotedRawText: promotedModel.rawText,
					currentDisplay: (phase1_deal_overview_v2 as any)?.business_model,
				});

				console.log(
					JSON.stringify({
						event: "phase1_promoted_business_model_policy_guard",
						deal_id: dealId,
						selected_policy_id: selectedPolicyIdForPromotedFacts,
						action: policyResolution.action,
						reason: policyResolution.reason,
						promoted_head: promotedModel.display.slice(0, 140),
						resolved_head: typeof policyResolution.display === "string" ? policyResolution.display.slice(0, 140) : null,
					})
				);

				if (policyResolution.display) {
					phase1_deal_overview_v2 = {
						...phase1_deal_overview_v2,
						business_model: policyResolution.display,
						sources: mergeSources((phase1_deal_overview_v2 as any)?.sources, [
							{
								document_id: promotedModel.docId ?? (phase1Documents[0]?.document_id ?? "unknown"),
								...(typeof promotedModel.pageIndex === "number" ? { page_range: [promotedModel.pageIndex + 1, promotedModel.pageIndex + 1] as [number, number] } : {}),
								note: typeof promotedModel.pageIndex === "number"
									? `promoted business_model_v1 (${policyResolution.action}; dpu page_index=${promotedModel.pageIndex})`
									: `promoted business_model_v1 (${policyResolution.action})`,
							},
						]),
					};
				} else if (policyResolution.action === "suppress") {
					// The stale promoted fact was suppressed. Delete the evidence_items record so the
					// report compiler cannot read it and re-surface the stale label. The report will
					// fall back to DPU-derived facts which can now classify correctly.
					try {
						const suppressedEvidenceId = `deal:${dealId}:fact:business_model_v1`;
						await pool.query(
							`DELETE FROM evidence_items WHERE evidence_id = $1 AND deal_id = $2::uuid`,
							[suppressedEvidenceId, dealId]
						);
						console.log(
							JSON.stringify({
								event: "phase1_promoted_business_model_stale_record_deleted",
								deal_id: dealId,
								evidence_id: suppressedEvidenceId,
								reason: policyResolution.reason,
							})
						);
					} catch (deleteErr) {
						// Non-fatal: log but don't fail the analysis job.
						console.warn(
							JSON.stringify({
								event: "phase1_promoted_business_model_stale_record_delete_failed",
								deal_id: dealId,
								error: String(deleteErr),
							})
						);
					}
				}
			}
		} catch {
			// Never fail analysis due to promoted fact hydration.
		}
		const phase1_business_archetype_v1 = buildPhase1BusinessArchetypeV1({
			nowIso,
			documents: phase1Documents,
		});

		// Additive: disclosure when no pages have understanding (PAGE_SEGMENTS_V1_SKIP reason=no_pages_with_understanding).
		// This is disclosure-only: no scoring math changes.
		const phase1_disclosures_v1: Array<{ code: string; message: string }> = [];
		try {
			const hasUnderstandingPages = (doc: any): boolean => {
				const fullContent = doc?.full_content ?? {};
				const pdfV2 =
					(fullContent as any)?.pdf_v2 && typeof (fullContent as any).pdf_v2 === "object"
						? (fullContent as any).pdf_v2
						: fullContent;
				const wrapper = {
					pages: Array.isArray((fullContent as any)?.pages) ? (fullContent as any).pages : [],
					pdf_v2: pdfV2,
				};
				try {
					applySlideUnderstandingV1Shadow(wrapper as any);
				} catch {
					// best-effort
				}
				const pages = Array.isArray((pdfV2 as any)?.pages) ? ((pdfV2 as any).pages as any[]) : [];
				const ordered = pages
					.map((p: any) => {
						const pageIndex = typeof p?.page_index === "number" && Number.isFinite(p.page_index) ? p.page_index : null;
						if (pageIndex == null || pageIndex < 0) return null;
						const u = p?.understanding_v1;
						const slideType = typeof u?.slide_type === "string" ? String(u.slide_type) : "";
						if (!slideType) return null;
						return { page_index: pageIndex };
					})
					.filter(Boolean);
				return ordered.length > 0;
			};

			const pitchDeckDocs = eligible.filter((doc) => {
				const structured = (doc.structured_data && typeof doc.structured_data === "object")
					? (doc.structured_data as Record<string, unknown>)
					: {};
				return inferAnalysisDocType({ ...doc, structured_data: structured }) === "pitch_deck";
			});

			const affected = pitchDeckDocs.filter((doc: any) => {
				const pageCount = typeof doc?.page_count === "number" && Number.isFinite(doc.page_count) ? doc.page_count : 0;
				if (pageCount <= 0) return false;
				return !hasUnderstandingPages(doc);
			});

			if (affected.length > 0) {
				phase1_disclosures_v1.push({
					code: "no_pages_with_understanding",
					message: `No pitch deck pages contained usable text understanding (${affected.length} document(s)); slide segmentation and narrative signals may be incomplete.`,
				});
			}
		} catch {
			// Never fail analysis due to disclosure detection.
		}

		// Deterministic docs fingerprint for change acknowledgement.
		const docsFingerprint = createHash("sha256")
			.update(
				eligible
					.map((d) => ({
						id: String(d.id ?? ""),
						type: typeof d.type === "string" ? d.type : "",
						title: typeof d.title === "string" ? d.title : "",
					}))
					.sort((a, b) => a.id.localeCompare(b.id))
					.map((d) => `${d.id}|${d.type}|${d.title}`)
					.join("\n")
			)
			.digest("hex");
		const previousDocsFingerprint =
			(typeof (previousDio as any)?.dio?.phase1?.update_report_v1?.docs_fingerprint === "string")
				? (previousDio as any).dio.phase1.update_report_v1.docs_fingerprint
				: undefined;

		// Compute a deterministic current Phase 1 snapshot (no LLM; no new mining) so we can diff
		// coverage/decision/missing against the previous stored Phase 1.
		const currentPhase1 = generatePhase1DIOV1({
			deal: {
				deal_id: dealId,
				name:
					(typeof (previousDio as any)?.deal?.name === "string" ? (previousDio as any).deal.name : undefined)
					?? (typeof phase1_deal_overview_v2.deal_name === "string" ? phase1_deal_overview_v2.deal_name : undefined),
			},
			inputDocuments: documentsForAnalyzers,
			deal_overview_v2: phase1_deal_overview_v2,
			business_archetype_v1: phase1_business_archetype_v1,
		});

		// Phase B diagnostic-only persistence (fail-open)
		try {
			let phaseBVisualsSummary = null as Awaited<ReturnType<typeof fetchPhaseBVisualsFromDb>>;
			try {
				phaseBVisualsSummary = await fetchPhaseBVisualsFromDb(getPool(), dealId);
			} catch (summaryErr) {
				console.warn(
					JSON.stringify({
						event: "phase_b_visuals_summary_failed",
						deal_id: dealId,
						reason: summaryErr instanceof Error ? summaryErr.message : String(summaryErr),
					})
				);
			}

			const phaseB_features = extractPhaseBFeaturesV1({
				dealId,
				phase1: currentPhase1,
				docs: documentsForAnalyzers,
				visualsFromDb: phaseBVisualsSummary,
			});

			let versionOverride: number | null = null;
			try {
				const latest = await getLatestPhaseBRun(dealId);
				versionOverride = (latest?.version ?? 0) + 1;
			} catch (versionErr) {
				console.warn(
					JSON.stringify({
						event: "phase_b_version_lookup_failed",
						deal_id: dealId,
						reason: versionErr instanceof Error ? versionErr.message : String(versionErr),
					})
				);
			}

			try {
				await insertPhaseBRun({
					dealId,
					phaseBResult: { status: "features_only", schema_version: 1 },
					phaseBFeatures: phaseB_features,
					sourceRunId: job.id ? String(job.id) : null,
					versionOverride: versionOverride ?? undefined,
				});
			} catch (persistErr) {
				console.warn(
					JSON.stringify({
						event: "phase_b_persist_failed",
						deal_id: dealId,
						reason: persistErr instanceof Error ? persistErr.message : String(persistErr),
					})
				);
			}

			if (process.env.DDAI_DEBUG_PHASE_B === "1") {
				console.log(
					JSON.stringify({
						event: "phase_b_features_only",
						deal_id: dealId,
						coverage: phaseB_features.coverage,
					})
				);
			}
		} catch (err) {
			if (process.env.DDAI_DEBUG_PHASE_B === "1") {
				console.warn(
					JSON.stringify({
						event: "phase_b_features_failed",
						deal_id: dealId,
						reason: err instanceof Error ? err.message : String(err),
					})
				);
			}
		}

		// Optional v1 integration: materialize Phase B visuals into evidence rows.
		// This is fail-open and guarded by env flag to keep analysis stable.
		try {
			const phaseB = await materializePhaseBVisualEvidenceForDeal(getPool(), dealId);
			if (process.env.DDAI_DEBUG_PHASE_B === "1") {
				console.log(
					JSON.stringify({
						event: "phaseb_visual_evidence_materialized",
						deal_id: dealId,
						...phaseB,
					})
				);
			}
		} catch (err) {
			if (process.env.DDAI_DEBUG_PHASE_B === "1") {
				console.warn(
					JSON.stringify({
						event: "phaseb_visual_evidence_materialization_failed",
						deal_id: dealId,
						reason: err instanceof Error ? err.message : String(err),
					})
				);
			}
		}
		if (process.env.DEBUG_PHASE1_OVERVIEW_V2 === "1") {
			console.log(
				JSON.stringify({
					event: "phase1_deal_overview_v2_selected",
					deal_id: dealId,
					product_solution: phase1_deal_overview_v2.product_solution ?? null,
					market_icp: phase1_deal_overview_v2.market_icp ?? null,
					sources: Array.isArray(phase1_deal_overview_v2.sources) ? phase1_deal_overview_v2.sources : [],
				})
			);
		}
		const phase1_update_report_v1 = buildPhase1UpdateReportV1({
			previousDio,
			currentOverview: phase1_deal_overview_v2,
			currentPhase1,
			docsFingerprint,
			previousDocsFingerprint,
			nowIso,
		});

		// One lightweight investor-readable synthesis step (Phase 1 only).
		// Must not alter orchestration order or scoring; stored as dio.phase1.deal_summary_v2.
		let phase1_deal_summary_v2: DealSummaryV2 | null = null;
		const llm_calls: any[] = [];
		try {
			const selectedPolicyId =
				getSelectedPolicyIdFromAnyLike(previousDio as any) ??
				getSelectedPolicyIdFromAnyLike(currentPhase1 as any) ??
				getSelectedPolicyIdFromAnyLike(phase1_business_archetype_v1 as any);
			const dealName =
				(typeof (previousDio as any)?.deal?.name === "string" ? (previousDio as any).deal.name : undefined) ??
				(typeof phase1_deal_overview_v2.deal_name === "string" ? phase1_deal_overview_v2.deal_name : undefined) ??
				null;
			const synthesized = await generateDealSummaryV2FromPhase1({
				nowIso,
				dealId,
				dealName,
				selected_policy_id: selectedPolicyId,
				phase1_deal_overview_v2,
				phase1_business_archetype_v1,
				phase1_update_report_v1,
				phase1_executive_summary_v2: (currentPhase1 as any).executive_summary_v2,
				phase1_decision_summary_v1: (currentPhase1 as any).decision_summary_v1,
				eligibleDocuments: eligible.map((d) => ({
					id: String(d.id ?? ""),
					title: typeof d.title === "string" ? d.title : null,
					type: typeof d.type === "string" ? d.type : null,
					page_count: typeof (d as any).page_count === "number" ? (d as any).page_count : null,
				})),
			});
			phase1_deal_summary_v2 = synthesized?.summary ?? null;
			if (synthesized?.llm_call) llm_calls.push(synthesized.llm_call);
		} catch (err) {
			// Best-effort: do not fail the deal analysis if summary generation fails.
			console.warn(
				JSON.stringify({
					event: "phase1_deal_summary_v2_failed",
					deal_id: dealId,
					reason: "exception",
					error: err instanceof Error ? err.message : String(err),
				})
			);
			phase1_deal_summary_v2 = null;
		}

		// Reruns must not erase previously good summaries.
		if (!phase1_deal_summary_v2) {
			const prev = (previousDio as any)?.dio?.phase1?.deal_summary_v2;
			if (prev && typeof prev === "object") {
				phase1_deal_summary_v2 = prev as DealSummaryV2;
				console.log(
					JSON.stringify({
						event: "phase1_deal_summary_v2_preserved",
						deal_id: dealId,
					})
				);
			}
		}
		{
			const hasPrevDio = !!previousDio;
			const prevDioHasPhase1 = !!(previousDio as any)?.dio?.phase1;
			const t = typeof phase1_update_report_v1;
			const isObj = !!phase1_update_report_v1 && t === "object";
			const keys = isObj ? Object.keys(phase1_update_report_v1 as any) : [];
			const summary =
				isObj && typeof (phase1_update_report_v1 as any).summary === "string" ? (phase1_update_report_v1 as any).summary : "";
			const summary_head = summary ? summary.slice(0, 80) : "";
			console.log(
				JSON.stringify({
					event: "phase1_update_report_v1_built",
					deal_id: dealId,
					hasPrevDio,
					prevDioHasPhase1,
					typeof_phase1_update_report_v1: t,
					update_report_v1_keys: keys,
					update_report_v1_summary_head: summary_head,
				})
			);
		}
		const analyzers = {
			slideSequence: new SlideSequenceAnalyzer(),
			metricBenchmark: new MetricBenchmarkValidator(),
			visualDesign: new VisualDesignScorer(),
			narrativeArc: new NarrativeArcDetector(),
			financialHealth: new FinancialHealthCalculator(),
			riskAssessment: new RiskAssessmentEngine(),
			financialIntegrity: new FinancialIntegrityAnalyzerV1(),
		};

		const orchestrator = new DealOrchestrator(analyzers as any, storage as any, {
			maxRetries: parseInt(process.env.ORCHESTRATOR_MAX_RETRIES || "2"),
			analyzerTimeout: parseInt(process.env.ORCHESTRATOR_TIMEOUT || "60000"),
			continueOnError: process.env.ORCHESTRATOR_CONTINUE_ON_ERROR !== "false",
			debug: process.env.ORCHESTRATOR_DEBUG === "true",
		});

		if (process.env.DEBUG_PHASE1_DEAL_SUMMARY_V2 === "1") {
			console.log(
				JSON.stringify({
					event: "phase1_deal_summary_v2_pre_orchestrator",
					deal_id: dealId,
					has_openai_key: typeof process.env.OPENAI_API_KEY === "string" && process.env.OPENAI_API_KEY.length > 0,
					eligible_docs_count: eligible.length,
					phase1_deal_summary_v2_is_null: phase1_deal_summary_v2 == null,
					phase1_deal_summary_v2_summary_len:
						phase1_deal_summary_v2 && typeof (phase1_deal_summary_v2 as any).summary === "string"
							? (phase1_deal_summary_v2 as any).summary.length
							: null,
				})
			);
		}

		// Self-heal: if financial_facts_v1 is empty for this deal but DPU coverage exists,
		// run the full population pipeline inline before the orchestrator reads facts.
		// All three steps are idempotent and best-effort — never block orchestration.
		//
		// Implementation mirrors audit-populate-registries.ts exactly:
		//   • queries DPU docs via dpu.deal_id (not documents.deal_id) with LEFT JOIN
		//   • detects XLSX via title regex matching /\.xlsx?$/i (same as audit script)
		//   • calls populatePageRegistryV1 → populateDealFactRegistryV1 → populateFinancialFactRegistryV1 per doc
		try {
			const { rows: factCountRows } = await getPool().query<{ c: string }>(
				`SELECT COUNT(*)::text AS c FROM financial_facts_v1 WHERE deal_id = $1`,
				[sanitizeText(dealId)]
			);
			const existingFactCount = Number.parseInt(factCountRows[0]?.c ?? "0", 10);
			if (existingFactCount === 0) {
				// Mirror the audit script query: filter on dpu.deal_id, LEFT JOIN documents,
				// select title (for xlsx detection) and mime_type + extraction_metadata.
				const { rows: dpuDocs } = await getPool().query<{
					document_id: string;
					doc_title: string | null;
					mime_type: string | null;
					extraction_metadata: unknown;
				}>(
					`SELECT DISTINCT
					        dpu.document_id,
					        COALESCE(d.title, dpu.document_id::text) AS doc_title,
					        d.mime_type,
					        d.extraction_metadata
					   FROM document_page_understanding dpu
					   LEFT JOIN documents d ON d.id = dpu.document_id
					  WHERE dpu.deal_id = $1
					    AND (d.deleted_at IS NULL OR d.id IS NULL)`,
					[sanitizeText(dealId)]
				);
				if (dpuDocs.length > 0) {
					job.log(`[analyze-deal] financial_facts_v1 empty — self-heal population for ${dpuDocs.length} doc(s)`);
					for (const doc of dpuDocs) {
						// Detect XLSX using the same heuristics as audit-populate-registries.ts:
						//   1. Title/filename ends with .xlsx or .xls (primary — title always set)
						//   2. MIME type contains spreadsheet/excel (robust fallback)
						//   3. extraction_metadata.doc_kind === 'excel' (structured signal)
						const docTitle = typeof doc.doc_title === "string" ? doc.doc_title : "";
						const mimeType = typeof doc.mime_type === "string" ? doc.mime_type : "";
						const meta = doc.extraction_metadata && typeof doc.extraction_metadata === "object"
							? (doc.extraction_metadata as Record<string, unknown>)
							: {};
						const isXlsxDoc =
							/\.xlsx?$/i.test(docTitle) ||
							mimeType.includes("spreadsheetml") ||
							mimeType.includes("excel") ||
							(meta as any)?.doc_kind === "excel";
						await populatePageRegistryV1(getPool(), { dealId, documentId: doc.document_id });
						await populateDealFactRegistryV1(getPool(), { dealId, documentId: doc.document_id });
						await populateFinancialFactRegistryV1(getPool(), {
							deal_id: dealId,
							document_id: doc.document_id,
							xlsx_doc: isXlsxDoc,
						});
					}
				}
			}
		} catch (selfHealErr) {
			// Best-effort — never block orchestration
			const selfHealMsg = selfHealErr instanceof Error ? selfHealErr.message : String(selfHealErr);
			job.log(`[analyze-deal] financial_facts_v1 self-heal failed (non-blocking): ${selfHealMsg}`);
		}

		// Load financial facts for the financial integrity analyzer (fail-open: empty array is safe).
		// Uses FINANCIAL_FACTS_ANALYSIS_LIMIT to ensure dense multi-period models are not silently truncated.
		let financialFactsForOrchestrator: Awaited<ReturnType<typeof getFinancialFactsForDeal>> = [];
		try {
			financialFactsForOrchestrator = await getFinancialFactsForDeal(getPool(), dealId, { limit: FINANCIAL_FACTS_ANALYSIS_LIMIT });
			if (financialFactsForOrchestrator.length >= FINANCIAL_FACTS_ANALYSIS_LIMIT) {
				job.log(
					`[analyze-deal] financial_facts truncation warning: returned ${financialFactsForOrchestrator.length} rows — deal may have more facts than the analysis ceiling (${FINANCIAL_FACTS_ANALYSIS_LIMIT}). Integrity analysis may be incomplete.`
				);
			}
		} catch {
			// Integrity analysis degrades gracefully with no facts — never block orchestration.
		}

		const heartbeat = startHeartbeat(job, {
			stage: "running",
			dealId,
			startPercent: 42,
			maxPercent: 95,
			intervalMs: 20000,
			message: "Running analysis (heartbeat)",
		});

		let result: Awaited<ReturnType<typeof orchestrator.analyze>>;
		try {
			result = await orchestrator.analyze({
				deal_id: dealId,
				analysis_cycle: 1,
				input_data: {
					documents: documentsForAnalyzers,
					dio_context,
					phase1_deal_overview_v2,
					phase1_business_archetype_v1,
					phase1_disclosures_v1,
					phase1_update_report_v1,
					phase1_deal_summary_v2,
					llm_calls,
					financial_facts: financialFactsForOrchestrator,
				},
			});
		} finally {
			heartbeat.stop();
		}

		if (!result.success || !result.storage_result) {
			await updateJob(job, "failed", result.error || "Analysis failed", 100);
			return { ok: false, error: result.error || "Analysis failed" };
		}

		// Persist analysis provenance into the stored DIO JSON for correct downstream gating.
		// This is best-effort and should never fail the analysis job.
		if (minDpuCreatedAt) {
			try {
				const pool = getPool();
				let dioIdToUpdate: string | null =
					typeof (result.storage_result as any)?.dio_id === "string" && String((result.storage_result as any).dio_id).trim()
						? String((result.storage_result as any).dio_id).trim()
						: null;

				// Some storage implementations may not return dio_id. Fall back to looking up the
				// latest DIO row for this deal/version (or just the latest row for the deal).
				if (!dioIdToUpdate) {
					const versionRaw = (result.storage_result as any)?.version;
					const version = typeof versionRaw === "number" && Number.isFinite(versionRaw) ? Math.trunc(versionRaw) : null;
					try {
						const lookup = version != null
							? await pool.query<{ dio_id: string }>(
								`SELECT dio_id
								   FROM deal_intelligence_objects
								  WHERE deal_id = $1::uuid
								    AND analysis_version = $2::int
								  ORDER BY updated_at DESC NULLS LAST, dio_id DESC
								  LIMIT 1`,
								[dealId, version]
							)
							: await pool.query<{ dio_id: string }>(
								`SELECT dio_id
								   FROM deal_intelligence_objects
								  WHERE deal_id = $1::uuid
								  ORDER BY analysis_version DESC, updated_at DESC NULLS LAST, dio_id DESC
								  LIMIT 1`,
								[dealId]
							);
						dioIdToUpdate = typeof lookup.rows?.[0]?.dio_id === "string" ? lookup.rows[0].dio_id : null;
					} catch {
						dioIdToUpdate = null;
					}
				}

				if (!dioIdToUpdate) {
					console.warn(
						JSON.stringify({
							event: "dio_meta_min_dpu_created_at_persist_skipped",
							deal_id: dealId,
							job_id: job.id ? String(job.id) : null,
							reason: "missing_dio_id",
							min_dpu_created_at: minDpuCreatedAt,
							ts: new Date().toISOString(),
						})
					);
				} else {
					const persisted = await pool.query<{ persisted_min: string | null }>(
						`UPDATE deal_intelligence_objects
							SET dio_data = jsonb_set(
								COALESCE(dio_data, '{}'::jsonb),
								'{meta}',
								COALESCE(dio_data->'meta', '{}'::jsonb) || jsonb_build_object('min_dpu_created_at', $1::text),
								true
							)
						 WHERE dio_id = $2::uuid
						 RETURNING (dio_data->'meta'->>'min_dpu_created_at')::text as persisted_min`,
						[minDpuCreatedAt, dioIdToUpdate]
					);
					console.log(
						JSON.stringify({
							event: "dio_meta_min_dpu_created_at_persisted",
							deal_id: dealId,
							job_id: job.id ? String(job.id) : null,
							dio_id: dioIdToUpdate,
							min_dpu_created_at: minDpuCreatedAt,
							row_count: persisted.rowCount,
							persisted_min: persisted.rows?.[0]?.persisted_min ?? null,
							ts: new Date().toISOString(),
						})
					);
				}
			} catch (err) {
				console.warn(
					JSON.stringify({
						event: "dio_meta_min_dpu_created_at_persist_failed",
						deal_id: dealId,
						job_id: job.id ? String(job.id) : null,
						min_dpu_created_at: minDpuCreatedAt,
						reason: err instanceof Error ? err.message : String(err),
						ts: new Date().toISOString(),
					})
				);
			}
		}

		// Persist a deterministic compiled report artifact alongside the stored DIO JSON.
		// Goal: make /report read from a canonical persisted report (idempotent upsert).
		// This is best-effort and should not fail the analysis job; API can still compile-on-demand as a fallback.
		try {
			const pool = getPool();
			let dioIdToUpdate: string | null =
				typeof (result.storage_result as any)?.dio_id === "string" && String((result.storage_result as any).dio_id).trim()
					? String((result.storage_result as any).dio_id).trim()
					: null;

			if (!dioIdToUpdate) {
				const versionRaw = (result.storage_result as any)?.version;
				const version = typeof versionRaw === "number" && Number.isFinite(versionRaw) ? Math.trunc(versionRaw) : null;
				try {
					const lookup = version != null
						? await pool.query<{ dio_id: string }>(
							`SELECT dio_id
							   FROM deal_intelligence_objects
							  WHERE deal_id = $1::uuid
							    AND analysis_version = $2::int
							  ORDER BY updated_at DESC NULLS LAST, dio_id DESC
							  LIMIT 1`,
							[dealId, version]
						)
						: await pool.query<{ dio_id: string }>(
							`SELECT dio_id
							   FROM deal_intelligence_objects
							  WHERE deal_id = $1::uuid
							  ORDER BY analysis_version DESC, updated_at DESC NULLS LAST, dio_id DESC
							  LIMIT 1`,
							[dealId]
						);
					dioIdToUpdate = typeof lookup.rows?.[0]?.dio_id === "string" ? lookup.rows[0].dio_id : null;
				} catch {
					dioIdToUpdate = null;
				}
			}

			if (!dioIdToUpdate) {
				console.warn(
					JSON.stringify({
						event: "dio_report_persist_skipped",
						deal_id: dealId,
						job_id: job.id ? String(job.id) : null,
						reason: "missing_dio_id",
						ts: new Date().toISOString(),
					})
				);
			} else {
				// Load promoted facts (if evidence_items exists) to enrich structured_summary with citations.
				let promotedFacts: any[] = [];
				try {
					const evidenceOk = await hasTable(pool, "evidence_items");
					if (evidenceOk) {
						await pool.query("SELECT 1 FROM evidence_items LIMIT 1");
						const res = await pool.query(
							`SELECT evidence_id::text,
							        deal_id::text,
							        source_type,
							        source_path,
							        source_document_id::text as source_document_id,
							        confidence,
							        extracted_at::text,
							        content_json,
							        meta
						   FROM evidence_items
						  WHERE deal_id = $1::uuid
						    AND source_type IN ('promoted_slide_fact','business_model_fact')
						    AND content_json IS NOT NULL
						    AND (content_json->>'fact_type') IN (
						      'raise_terms_v1',
						      'business_model_v1',
						      'revenue_v1',
						      'customers_v1',
						      'growth_v1',
						      'growth_outlook_v1',
						      'marketing_attributed_revenue_v1'
						    )
						  ORDER BY confidence DESC, extracted_at DESC, evidence_id ASC`,
							[dealId]
						);
						promotedFacts = (res.rows ?? []) as any[];
					}
				} catch {
					promotedFacts = [];
				}

				// Load enriched document metadata (filename + MIME) for the compiler so
				// cap-table and XLSX detection work the same as the API recompile path.
				// Fail-open: any error defaults to empty array, which degrades gracefully.
				let documentsForCompile: Awaited<ReturnType<typeof getDocumentsForReport>> = [];
				try {
					documentsForCompile = await getDocumentsForReport(pool, dealId);
				} catch {
					// Non-blocking — compiler falls back to DIO inputs.documents
				}

				let companyName: string | null = null;
				try {
					const dealNameResult = await pool.query<{ name: string | null }>(
						`SELECT name FROM deals WHERE id = $1::uuid AND deleted_at IS NULL LIMIT 1`,
						[dealId]
					);
					const rawName = dealNameResult.rows?.[0]?.name;
					if (typeof rawName === 'string' && rawName.trim().length > 0) {
						companyName = rawName.trim();
					}
				} catch { /* fail-open */ }

				const compiledReport = (() => {
					// Always use the WithPromotedFacts variant so financialFacts and documents
					// can be supplied for consistent has_xlsx / has_cap_table / has_facts output
					// regardless of whether any promoted facts were found this run.
					return compileDIOToReportWithPromotedFacts(result.dio as any, {
						promotedFacts,
						financialFacts: financialFactsForOrchestrator,
						documents: documentsForCompile,
						companyName: companyName ?? undefined,
					});
				})();

				// Explicitly stamp updated_at so the staleness detector can use DIO.updated_at
				// as the authoritative freshness anchor for the financial snapshot.
				const persisted = await pool.query<{ persisted: boolean }>(
					`UPDATE deal_intelligence_objects
						SET dio_data = jsonb_set(
							COALESCE(dio_data, '{}'::jsonb),
							'{report}',
							$1::jsonb,
							true
						),
						updated_at = now()
					 WHERE dio_id = $2::uuid
					 RETURNING true as persisted`,
					[JSON.stringify(compiledReport), dioIdToUpdate]
				);

				console.log(
					JSON.stringify({
						event: "dio_report_persisted",
						deal_id: dealId,
						job_id: job.id ? String(job.id) : null,
						dio_id: dioIdToUpdate,
						analysis_version: (result.storage_result as any)?.version ?? null,
						row_count: persisted.rowCount,
						report_version: (compiledReport as any)?.version ?? null,
						ts: new Date().toISOString(),
					})
				);
				console.log(
					JSON.stringify({
						// Stale detector reads DIO.updated_at as the freshness anchor.
						// Stamping now() here marks financial snapshot as fresh for this run.
						event: "FINANCIAL_SNAPSHOT_FRESHNESS_UPDATED",
						deal_id: dealId,
						job_id: job.id ? String(job.id) : null,
						dio_id: dioIdToUpdate,
						analysis_version: (result.storage_result as any)?.version ?? null,
						ts: new Date().toISOString(),
					})
				);

				// Invalidate the ingestion_reports cache for this deal so the next /report
				// call compiles fresh from the updated DIO and live financial_facts_v1.
				// Best-effort: never block the job on failure.
				try {
					const del = await pool.query(
						`DELETE FROM ingestion_reports WHERE deal_id = $1::uuid`,
						[dealId]
					);
					console.log(
						JSON.stringify({
							event: "ingestion_reports_cache_invalidated",
							deal_id: dealId,
							job_id: job.id ? String(job.id) : null,
							rows_deleted: del.rowCount ?? 0,
							ts: new Date().toISOString(),
						})
					);
				} catch (cacheErr) {
					console.warn(
						JSON.stringify({
							event: "ingestion_reports_cache_invalidate_failed",
							deal_id: dealId,
							job_id: job.id ? String(job.id) : null,
							reason: cacheErr instanceof Error ? cacheErr.message : String(cacheErr),
							ts: new Date().toISOString(),
						})
					);
				}
			}
		} catch (err) {
			console.warn(
				JSON.stringify({
					event: "dio_report_persist_failed",
					deal_id: dealId,
					job_id: job.id ? String(job.id) : null,
					reason: err instanceof Error ? err.message : String(err),
					ts: new Date().toISOString(),
				})
			);
		}

		const overallScore = (result.dio as any)?.overall_score
			?? (result.dio as any)?.score_explanation?.totals?.overall_score
			?? null;

		// Governed overview persistence is part of the terminal-success contract for analyze_deal.
		// If it fails, we still complete the job but downgrade to succeeded_with_warnings.
		const overviewPersistStartedAt = Date.now();
		console.log(
			JSON.stringify({
				event: "OVERVIEW_PERSIST_START",
				deal_id: dealId,
				job_id: job.id ? String(job.id) : null,
				dio_id: result.storage_result.dio_id ?? null,
				dio_version: result.storage_result.version ?? null,
				is_duplicate: Boolean(result.storage_result.is_duplicate),
				ts: new Date().toISOString(),
			})
		);

		let overview: Awaited<ReturnType<typeof generateAndPersistGovernedLlmOverviewBestEffort>> | null = null;
		try {
			const selectedPolicyIdForOverview =
				getSelectedPolicyIdFromAnyLike((result as any)?.dio) ??
				getSelectedPolicyIdFromAnyLike((result as any)?.storage_result?.dio_data) ??
				getSelectedPolicyIdFromAnyLike(previousDio as any) ??
				null;
			overview = await generateAndPersistGovernedLlmOverviewBestEffort({
				pool: getPool(),
				dealId,
				runId: job.id ? String(job.id) : null,
				stepRunId: null,
				selectedPolicyId: selectedPolicyIdForOverview,
				dealName:
					(typeof (previousDio as any)?.deal?.name === "string" ? (previousDio as any).deal.name : undefined) ??
					(typeof phase1_deal_overview_v2.deal_name === "string" ? phase1_deal_overview_v2.deal_name : undefined) ??
					null,
				phase1_deal_overview_v2,
				phase1_business_archetype_v1,
				phase1_update_report_v1,
				phase1_deal_summary_v2,
				phase1_documents: phase1Documents.map((d) => ({ document_id: d.document_id, type: d.type ?? null })),
			});
		} catch (err) {
			overview = { ok: false, inserted: false, input_hash: null, validation_failed: false };
			console.warn(
				JSON.stringify({
					event: "OVERVIEW_PERSIST_FAIL",
					deal_id: dealId,
					job_id: job.id ? String(job.id) : null,
					reason: err instanceof Error ? err.message : String(err),
					duration_ms: Date.now() - overviewPersistStartedAt,
					ts: new Date().toISOString(),
				})
			);
		}

		const overviewOk = Boolean(overview?.ok) && typeof overview?.input_hash === "string" && overview.input_hash.trim().length > 0;
		if (overviewOk) {
			console.log(
				JSON.stringify({
					event: "OVERVIEW_PERSIST_OK",
					deal_id: dealId,
					job_id: job.id ? String(job.id) : null,
					input_hash: overview?.input_hash ?? null,
					inserted: Boolean(overview?.inserted),
					validation_failed: Boolean(overview?.validation_failed),
					duration_ms: Date.now() - overviewPersistStartedAt,
					ts: new Date().toISOString(),
				})
			);
		} else {
			console.warn(
				JSON.stringify({
					event: "OVERVIEW_PERSIST_FAIL",
					deal_id: dealId,
					job_id: job.id ? String(job.id) : null,
					reason: overview?.ok === false ? "overlay_generation_failed" : "overlay_not_persisted",
					input_hash: overview?.input_hash ?? null,
					duration_ms: Date.now() - overviewPersistStartedAt,
					ts: new Date().toISOString(),
				})
			);
		}

		// Investor Insight Engine – enqueue Stage 0 once the governed overlay is confirmed complete.
		// Gated by INVESTOR_INSIGHTS_ENABLED=true; fail-open so a queue error never blocks the
		// analyze_deal terminal status update.
		//
		// Phase J invariant: governed summary must resolve via resolveGovernedSummaryWithCache.
		// This trigger enqueues the same worker job as the API /generate and /regenerate routes.
		// All governed summary generation is handled exclusively inside the worker processor.
		//
		// Phase 2: skip for first-pass jobs — investor_insights runs once, from the full analyze_deal
		// triggered at extract_visuals finalize, so we avoid a redundant multi-stage insights run.
		if (overviewOk && isFirstPass) {
			// Phase 7 observability: emit explicit skip event so first-pass jobs are traceable.
			console.log(
				JSON.stringify({
					event: "INVESTOR_INSIGHTS_SKIPPED_FIRST_PASS",
					deal_id: dealId,
					job_id: job.id ? String(job.id) : null,
					reason: "first_pass_job",
					ts: new Date().toISOString(),
				})
			);
		}
		if (overviewOk && process.env.INVESTOR_INSIGHTS_ENABLED === "true" && !isFirstPass) {
			try {
				const insightsQueue = getQueue("investor_insights");
				const insightsJobId = makeJobId("investor_insights", [dealId, "v1", "overlay_complete"]);
				await insightsQueue.add(
					"generate_investor_insights",
					{
						deal_id: dealId,
						engine_version: "v1",
						triggered_by: "overlay_complete",
						...(isForceRefresh ? { force_recompute: true } : {}),
					},
					{ jobId: insightsJobId, removeOnComplete: true, removeOnFail: false, attempts: 3, backoff: { type: "exponential", delay: 1000 } }
				);
				console.log(
					JSON.stringify({
						event: "INVESTOR_INSIGHTS_ENQUEUED",
						deal_id: dealId,
						job_id: insightsJobId,
						triggered_by: "overlay_complete",
						force_recompute: isForceRefresh,
						ts: new Date().toISOString(),
					})
				);
			} catch (err) {
				console.warn(
					JSON.stringify({
						event: "INVESTOR_INSIGHTS_ENQUEUE_FAILED",
						deal_id: dealId,
						reason: err instanceof Error ? err.message : String(err),
						ts: new Date().toISOString(),
					})
				);
			}
		}

		const terminalStatus: JobStatus = overviewOk ? "succeeded" : "succeeded_with_warnings";
		const terminalSuffix = result.storage_result.is_duplicate ? ", refreshed" : "";
		const warningSuffix = overviewOk ? "" : "; governed overview pending/failed";
		await updateJob(
			job,
			terminalStatus,
			`Analysis complete (version=${result.storage_result.version}${terminalSuffix})${warningSuffix}`,
			100
		);

		if (requirePageUnderstanding) {
			try {
				const pool = getPool();
				const dpuOk = await hasTable(pool, "document_page_understanding");
				if (dpuOk) {
					const { rows: docRows } = await pool.query<{
						document_id: string;
						title: string | null;
						page_count: number;
						missing_pages: number[];
					}>(
						`
						WITH docs AS (
							SELECT id AS document_id,
							       title,
							       COALESCE(page_count, 0) AS page_count
							  FROM documents
							 WHERE deal_id = $1
							   AND deleted_at IS NULL
						),
						expected AS (
							SELECT document_id, generate_series(0, page_count - 1) AS page_index
							  FROM docs
							 WHERE page_count > 0
						),
						present AS (
							SELECT dpu.document_id, dpu.page_index
							  FROM document_page_understanding dpu
							  JOIN docs d ON d.document_id = dpu.document_id
							 WHERE dpu.version = $2
						),
						missing AS (
							SELECT e.document_id, e.page_index
							  FROM expected e
							  LEFT JOIN present p
							    ON p.document_id = e.document_id
							   AND p.page_index = e.page_index
							 WHERE p.page_index IS NULL
						)
						SELECT d.document_id,
						       d.title,
						       d.page_count,
						       COALESCE((SELECT array_agg(m.page_index ORDER BY m.page_index) FROM missing m WHERE m.document_id = d.document_id), '{}'::int[]) AS missing_pages
						  FROM docs d
						 ORDER BY d.title NULLS LAST, d.document_id;
						`,
						[dealId, pageUnderstandingVersion]
					);

					const gaps = (docRows ?? []).filter((d) => Array.isArray(d.missing_pages) && d.missing_pages.length > 0);
					if (gaps.length > 0) {
						const missingPagesTotal = gaps.reduce((sum, d) => sum + (Array.isArray(d.missing_pages) ? d.missing_pages.length : 0), 0);
						console.warn(
							JSON.stringify({
								event: "READINESS_GAP",
								deal_id: dealId,
								version: pageUnderstandingVersion,
								missing_documents: gaps.length,
								missing_pages_total: missingPagesTotal,
								documents: gaps.map((d) => ({
									document_id: d.document_id,
									title: d.title ?? null,
									page_count: d.page_count ?? 0,
									missing_pages: d.missing_pages,
								})),
							})
						);
					}
				}
			} catch (err) {
				console.warn(
					JSON.stringify({
						event: "READINESS_GAP_CHECK_FAILED",
						deal_id: dealId,
						version: pageUnderstandingVersion,
						reason: err instanceof Error ? err.message : String(err),
					})
				);
			}
		}

		console.log(
			JSON.stringify({
				event: "ANALYZE_DEAL_COMPLETED",
				deal_id: dealId,
				job_id: job.id ? String(job.id) : null,
			})
		);

		return {
			ok: true,
			dio_id: result.storage_result.dio_id,
			version: result.storage_result.version,
			is_duplicate: result.storage_result.is_duplicate,
			overall_score: overallScore,
		};
	} catch (err) {
		const message = err instanceof Error ? err.message : "Analysis failed";
		await updateJob(job, "failed", message, 100);
		throw err;
	}

}
