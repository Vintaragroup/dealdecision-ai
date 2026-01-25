import type { Job } from "bullmq";
import { randomUUID, createHash } from "crypto";
import path from "path";
import fs from "fs/promises";
import type { JobProgressEventV1, JobStatus, JobStatusDetail } from "@dealdecision/contracts";
import {
	sanitizeText,
	generatePhase1DIOV1,
	DealOrchestrator,
	DIOStorageImpl,
	SlideSequenceAnalyzer,
	MetricBenchmarkValidator,
	VisualDesignScorer,
	NarrativeArcDetector,
	FinancialHealthCalculator,
	RiskAssessmentEngine,
} from "@dealdecision/core";
import { createWorker, getQueue, logWorkerQueueConfig } from "./lib/queue";
import { evaluateVisualDocReadiness } from "./lib/visual-readiness";
import {
	getPool,
	closePool,
	updateDocumentStatus,
	updateDocumentAnalysis,
	mergeDocumentExtractionMetadata,
	insertEvidence,
	deleteExtractionEvidenceForDeal,
	deleteExtractionEvidenceForDocument,
	getDocumentsForDeal,
	getDocumentsForDealWithAnalysis,
	getEvidenceDocumentIds,
	updateDocumentVerification,
	saveIngestionReport,
	getDocumentsByIds,
	getDocumentsForDealWithVerification,
	insertDocumentExtractionAudit,
	getDocumentOriginalFile,
	upsertDocumentOriginalFile,
	insertPhaseBRun,
	getLatestPhaseBRun,
} from "./lib/db";
import { deriveEvidenceDrafts } from "./lib/evidence";
import {
	callVisionWorker,
	enqueueExtractVisualsIfPossible,
	getVisionExtractorConfig,
	hasTable,
	persistVisionResponse,
	resolvePageImageUris,
	backfillVisualAssetImageUris,
	persistSyntheticVisualAssets,
	deduceDocKind,
	resegmentStructuredSyntheticAssets,
	applyVisionHintsToStructuredPowerpointSlides,
	callXlsxWorker,
} from "./lib/visual-extraction";
import { normalizeToCanonical } from "./lib/normalization";
import { processDocument } from "./lib/processors";
import { verifyDocumentExtraction } from "./lib/verification";
import { remediateStructuredData } from "./lib/remediation";
import { persistPdfV2TextRegionAssetsV1Shadow } from "./lib/pdf_v2/pdf-text-region-assets-v1";
import os from "os";
import { loadOriginalBytesFromDocumentStorage } from "./lib/ingest/from-storage";
import { uploadToR2 } from "./lib/r2";

let didWarnUploadDirFallback = false;

async function resolveWritableUploadDir(env: NodeJS.ProcessEnv, logger: Pick<Console, "log" | "warn"> = console): Promise<string> {
	const configured = env.UPLOAD_DIR ? path.resolve(env.UPLOAD_DIR) : path.resolve(process.cwd(), "uploads");
	const fallback = path.resolve(os.tmpdir(), "dealdecisionai", "uploads");

	const tryDir = async (dir: string): Promise<boolean> => {
		try {
			await fs.mkdir(dir, { recursive: true });
			const probe = path.join(dir, `.write_test_${process.pid}_${Date.now()}`);
			await fs.writeFile(probe, "ok");
			await fs.unlink(probe);
			return true;
		} catch {
			return false;
		}
	};

	if (await tryDir(configured)) return configured;
	if (await tryDir(fallback)) {
		if (!didWarnUploadDirFallback) {
			didWarnUploadDirFallback = true;
			logger.warn(
				JSON.stringify({
					event: "WORKER_UPLOAD_DIR_FALLBACK",
					configured_upload_dir: env.UPLOAD_DIR ?? null,
					using_upload_dir: fallback,
				})
			);
		}
		return fallback;
	}

	// Last resort: use configured even if not writable; downstream will handle failures.
	return configured;
}

function pickDownloadUrlFromExtractionMetadata(meta: unknown): string | null {
	if (!meta || typeof meta !== "object") return null;
	const m = meta as any;
	const candidates: unknown[] = [
		m?.upload?.signed_url,
		m?.upload?.signedUrl,
		m?.upload?.download_url,
		m?.upload?.downloadUrl,
		m?.upload?.url,
		m?.upload?.file_url,
		m?.upload?.fileUrl,
		m?.original_url,
		m?.originalUrl,
		m?.source_url,
		m?.sourceUrl,
		m?.r2_signed_url,
		m?.r2_url,
		m?.r2?.signed_url,
		m?.r2?.url,
		m?.storage?.signed_url,
		m?.storage?.url,
	];
	for (const c of candidates) {
		if (typeof c !== "string") continue;
		const s = c.trim();
		if (s.startsWith("http://") || s.startsWith("https://")) return s;
	}
	return null;
}

function resolveLocalImagePath(imageUri: string, env: NodeJS.ProcessEnv = process.env): string | null {
	const trimmed = String(imageUri || "").trim();
	if (!trimmed) return null;
	if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return null;
	if (trimmed.startsWith("/uploads/")) {
		const uploadDir = env.UPLOAD_DIR ? path.resolve(env.UPLOAD_DIR) : path.resolve(process.cwd(), "uploads");
		return path.join(uploadDir, trimmed.slice("/uploads".length));
	}
	if (trimmed.startsWith("/")) return trimmed;
	// Treat relative paths as relative to cwd.
	return path.resolve(process.cwd(), trimmed);
}

async function tryReadImageB64ForVision(imageUri: string, env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
	const trimmed = String(imageUri || "").trim();
	if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
		try {
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), 15000);
			const res = await fetch(trimmed, { signal: controller.signal });
			clearTimeout(timer);
			if (!res.ok) return null;
			const ab = await res.arrayBuffer();
			const bytes = Buffer.from(ab);
			if (!bytes || bytes.length === 0) return null;
			return bytes.toString("base64");
		} catch {
			return null;
		}
	}

	const localPath = resolveLocalImagePath(imageUri, env);
	if (!localPath) return null;
	try {
		const bytes = await fs.readFile(localPath);
		if (!bytes || bytes.length === 0) return null;
		return bytes.toString("base64");
	} catch {
		return null;
	}
}
import { persistPdfPageUnderstandingV1Shadow } from "./lib/pdf_v2/page-understanding-v1";
import { parseIngestDocumentsJobData, validateIngestDocumentsPayload } from "./lib/ingest/ingest-payload";
import { buildPhase1DealOverviewV2, buildPhase1DealUnderstandingV1, buildPhase1UpdateReportV1 } from "./lib/phase1/dealOverviewV2";
import { computeVisualQualityAuditForDeal } from "./lib/visual-quality-audit";
import { buildPhase1BusinessArchetypeV1 } from "./lib/phase1/businessArchetypeV1";
import { getVisualPageImagePersistConfig, persistRenderedPageImages, persistImagePage, renderNonPdfToPageImages } from "./lib/rendered-pages";
import type { DocumentAnalysis, ExtractedContent } from "./lib/processors";
import type { VerificationResult } from "./lib/verification";
import { OpenAIGPT4oProvider } from "./lib/llm/providers/openai-provider";
import type { ProviderConfig } from "./lib/llm/types";
import { extractPhaseBFeaturesV1, fetchPhaseBVisualsFromDb } from "./lib/phaseb/extract";
import { materializePhaseBVisualEvidenceForDeal } from "./lib/phaseb/materialize-evidence";
import { logMemory, yieldToEventLoop } from "./lib/memory";
import { updateJobProgress } from "./lib/job-progress";
import { enqueuePersistedJob } from "./lib/job-enqueue";

// Deterministic startup log for Docker verification.
// Do not log secrets; only the explicit flag value.
console.info(
	`VISUAL_EXTRACTION_FLAG: ENABLE_VISUAL_EXTRACTION=${process.env.ENABLE_VISUAL_EXTRACTION || "(unset)"}`
);

// Polyfill Promise.withResolvers for Node runtimes that don't provide it yet (Node < 22)
if (typeof (Promise as any).withResolvers !== "function") {
	(Promise as any).withResolvers = function <T = unknown>() {
		let resolve!: (value: T | PromiseLike<T>) => void;
		let reject!: (reason?: unknown) => void;
		const promise = new Promise<T>((res, rej) => {
			resolve = res;
			reject = rej;
		});
		return { promise, resolve, reject };
	};
}

const devLogEnabled = process.env.NODE_ENV !== "production" || process.env.DEBUG_WORKER_LOGS === "1";
const devLog = (event: string, payload: Record<string, unknown>) => {
	if (!devLogEnabled) return;
	try {
		console.log(JSON.stringify({ event, ...payload }));
	} catch (err) {
		console.warn(`[devLog] failed to stringify event=${event}: ${err instanceof Error ? err.message : String(err)}`);
	}
};

/**
 * Extract full text from extracted content for full-text search indexing
 */
function extractFullText(content: ExtractedContent | null, contentType: string): string {
	if (!content) return "";

	const parts: string[] = [];

	switch (contentType) {
		case "pdf": {
			const pdf = content as any;
			if (pdf.pages && Array.isArray(pdf.pages)) {
				for (const page of pdf.pages) {
					if (page.text) parts.push(page.text);
					if (page.slideTitle) parts.push(page.slideTitle);
				}
			}
			break;
		}
		case "excel": {
			const excel = content as any;
			if (excel.sheets && Array.isArray(excel.sheets)) {
				for (const sheet of excel.sheets) {
					if (sheet.name) parts.push(`Sheet: ${sheet.name}`);
					if (sheet.headers) parts.push(sheet.headers.join(" "));
					if (sheet.rows && Array.isArray(sheet.rows)) {
						for (const row of sheet.rows) {
							parts.push(Object.values(row).map(v => String(v)).join(" "));
						}
					}
				}
			}
			break;
		}
		case "powerpoint": {
			const ppt = content as any;
			if (ppt.slides && Array.isArray(ppt.slides)) {
				for (const slide of ppt.slides) {
					if (slide.title) parts.push(slide.title);
					if (slide.notes) parts.push(slide.notes);
					if (slide.textContent) parts.push(slide.textContent);
				}
			}
			break;
		}
		case "word": {
			const word = content as any;
			if (word.paragraphs && Array.isArray(word.paragraphs)) {
				for (const para of word.paragraphs) {
					if (para.text) parts.push(para.text);
				}
			}
			if (word.summary?.totalText) parts.push(word.summary.totalText);
			break;
		}
		case "image": {
			const image = content as any;
			if (image.ocrText) parts.push(image.ocrText);
			break;
		}
	}

	return parts.join(" ").substring(0, 1000000); // Cap at 1MB for storage
}

/**
 * Get page count from extracted content
 */
function getPageCount(content: ExtractedContent | null, contentType: string): number {
	if (!content) return 0;

	switch (contentType) {
		case "pdf": {
			const pdf = content as any;
			return pdf.metadata?.pages || pdf.summary?.totalPages || 0;
		}
		case "excel": {
			const excel = content as any;
			return excel.metadata?.totalSheets || 0;
		}
		case "powerpoint": {
			const ppt = content as any;
			return ppt.slides?.length || 0;
		}
		case "word": {
			const word = content as any;
			return 1; // Word documents are typically single file
		}
		case "image": {
			return 1; // Single image file
		}
		default:
			return 0;
	}
}

function computeCompleteness(analysis: DocumentAnalysis) {
	const headings = analysis.structuredData.mainHeadings?.length ?? 0;
	const metrics = analysis.structuredData.keyMetrics?.length ?? 0;
	const summaryLen = analysis.structuredData.textSummary?.length ?? 0;

	let score = 0;
	if (summaryLen >= 100) score += 0.4;
	else if (summaryLen >= 20) score += 0.2;
	if (headings >= 3) score += 0.3;
	else if (headings >= 1) score += 0.15;
	if (metrics >= 5) score += 0.3;
	else if (metrics >= 1) score += 0.15;

	const reason = `summary=${summaryLen} chars, headings=${headings}, metrics=${metrics}, score=${score.toFixed(2)}`;
	return { score, reason, summaryLen, headings, metrics };
}

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

	const system =
		"You are a deal analyst writing for professional investors. " +
		"Use ONLY the provided Phase 1 artifacts and document metadata. Do not invent facts or numbers. " +
		"If a detail is missing, state it explicitly as a gap (e.g., 'Raise/terms not provided'). " +
		"Output MUST be valid JSON only (no markdown, no backticks, no extra text). " +
		"Return JSON with EXACT schema and keys: {" +
		"\"generated_at\": string, " +
		"\"model\": \"gpt-4o-mini\", " +
		"\"summary\": {\"one_liner\": string, \"paragraphs\": [string,string,string]}, " +
		"\"strengths\": string[], \"risks\": string[], \"open_questions\": string[]" +
		"}. " +
		"Requirements: summary.paragraphs MUST be exactly 3 paragraphs. " +
		"Each paragraph MUST be 2–4 sentences and at least 60 words. " +
		"No bullet points in paragraphs. Use investor-grade, neutral language. " +
		"Prefer deal_overview_v2 for product/ICP/model and executive_summary_v2.signals for recommendation/score/confidence.";

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
		return { summary: fallback, llm_call: { ...baseCallLog, success: false, error: "schema_coercion_failed" } };
	}
	// Ensure model matches the required one even if the model omits it.
	coerced.model = "gpt-4o-mini";
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
	return { summary: coerced, llm_call: baseCallLog };
}
const progressEmitCache = new Map<string, { ts: number; stage?: string }>();

type HeartbeatHandle = { stop: () => void };

function startHeartbeat(
	job: Job,
	options: {
		stage: JobProgressEventV1["stage"];
		dealId?: string;
		documentId?: string;
		startPercent?: number;
		maxPercent?: number;
		intervalMs?: number;
		message: string;
	}
): HeartbeatHandle {
	const intervalMs = options.intervalMs ?? 20000;
	const maxPercent = options.maxPercent ?? 45;
	let percent = options.startPercent ?? 20;
	let stopped = false;

	const tick = async () => {
		if (stopped) return;
		percent = Math.min(maxPercent, percent + 2);
		const msg = options.message;
		try {
			await updateJob(job, "running", msg, percent);
			await emitJobProgress(job, {
				job_id: job.id ? String(job.id) : "",
				deal_id: options.dealId,
				document_id: options.documentId,
				stage: options.stage,
				percent,
				message: msg,
				meta: { heartbeat: true },
			});
		} catch (err) {
			console.warn(
				`[heartbeat] progress emit failed job=${job.id ?? job.name}: ${err instanceof Error ? err.message : String(err)}`
			);
		}
	};

	const timer = setInterval(() => {
		void tick();
	}, intervalMs);

	return {
		stop: () => {
			stopped = true;
			clearInterval(timer);
		},
	};
}

async function updateJob(job: Job, status: JobStatus, message?: string, progressPct?: number | null) {
	await updateJobProgress(job, {
		status: status as any,
		stage: "status_update",
		current: typeof progressPct === "number" ? progressPct : undefined,
		total: typeof progressPct === "number" ? 100 : undefined,
		message,
		error: status === "failed" ? message ?? "failed" : undefined,
	});
}

async function emitJobProgress(job: Job, progress: JobProgressEventV1) {
	const jobId = (job.id ?? job.name)?.toString();
	if (!jobId) return;
	const now = Date.now();
	const prev = progressEmitCache.get(jobId);
	if (prev && prev.stage === progress.stage && now - prev.ts < 1000) return;
	progressEmitCache.set(jobId, { ts: now, stage: progress.stage });

	await updateJobProgress(job, {
		stage: progress.stage,
		current: typeof progress.percent === "number" ? progress.percent : undefined,
		total: typeof progress.percent === "number" ? 100 : undefined,
		message: progress.message,
		meta: (progress as any).meta,
		page_start: typeof (progress as any)?.meta?.page_start === "number" ? (progress as any).meta.page_start : undefined,
		page_end: typeof (progress as any)?.meta?.page_end === "number" ? (progress as any).meta.page_end : undefined,
	});
}

async function failLatestIngestJob(documentId: string) {
	const pool = getPool();
	try {
		const { rows } = await pool.query<{ job_id: string }>(
			`SELECT job_id
			   FROM jobs
			  WHERE status <> 'succeeded'
			    AND (status_detail->'progress'->>'document_id') = $1
			  ORDER BY updated_at DESC
			  LIMIT 1`,
			[sanitizeText(documentId)]
		);
		const jobId = rows?.[0]?.job_id;
		if (!jobId) return;
		await pool.query(
			`UPDATE jobs
				SET status = 'failed',
				    message = 'reconciled_pdf_ingest_restart',
				    updated_at = now()
			 WHERE job_id = $1`,
			[sanitizeText(jobId)]
		);
	} catch (err) {
		console.warn(
			`[reconcile_ingest] failLatestIngestJob skipped doc=${documentId}: ${
				err instanceof Error ? err.message : String(err)
			}`
		);
	}
}

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

async function ingestDocumentProcessor(job: Job) {
	const parsed = parseIngestDocumentsJobData(job.data);
	const documentId = parsed.documentId;
	const dealId = parsed.dealId;
	const mode = parsed.mode;
	let fileBufferB64 = parsed.fileBufferB64;
	let fileName = parsed.fileName;
	const attempt = parsed.attempt;
	let storedMimeType: string | null = null;
	let ingestSource: "r2" | "blob" | "signed_url" | "local" = "local";
	let r2StorageBucket: string | null = null;
	let r2StorageKey: string | null = null;

	console.log(
		`[ingest_document] start job=${job.id} doc=${documentId ?? ""} deal=${dealId ?? ""} attempt=${attempt} payloadSize=${fileBufferB64?.length ?? 0} mode=${mode ?? "upload"}`
	);

	const isFromStorage = mode === "from_storage";

	function inferFileNameForStorageFallback(docId: string, mimeType: string | null): string {
		const mt = (mimeType ?? "").toLowerCase();
		if (mt.includes("pdf")) return `${docId}.pdf`;
		if (mt.includes("powerpoint") || mt.includes("presentation")) return `${docId}.pptx`;
		if (mt.includes("word")) return `${docId}.docx`;
		if (mt.includes("excel") || mt.includes("spreadsheet")) return `${docId}.xlsx`;
		if (mt.includes("png")) return `${docId}.png`;
		if (mt.includes("jpeg") || mt.includes("jpg")) return `${docId}.jpg`;
		return `${docId}.bin`;
	}

	// from_storage mode: load bytes from DB if buffer not provided
	if ((!fileBufferB64 || fileBufferB64.length === 0) && isFromStorage && documentId) {
		try {
			const original = await getDocumentOriginalFile(documentId);
			storedMimeType = original?.mime_type ?? null;
			if (original?.bytes?.length) {
				ingestSource = "blob";
				fileBufferB64 = original.bytes.toString("base64");
				if (!fileName) {
					fileName = original.file_name ?? inferFileNameForStorageFallback(documentId, storedMimeType);
				}
				console.log(
					`[ingest_document] loaded original bytes from storage sha256=${original.sha256} size=${original.bytes.length} doc=${documentId}`
				);
				await emitJobProgress(job, {
					job_id: job.id ? String(job.id) : "",
					deal_id: dealId ?? undefined,
					document_id: documentId ?? undefined,
					stage: "fetch_original_bytes",
					percent: 8,
					message: "Loaded original bytes from storage",
				});
			} else {
				console.error(`[ingest_document] storage fetch missing bytes doc=${documentId}`);
			}
		} catch (err) {
			console.error(
				`[ingest_document] storage fetch failed doc=${documentId}: ${err instanceof Error ? err.message : String(err)}`
			);
		}
	}

	// from_storage recovery: if the blob table is empty, attempt to fetch from a URL in extraction_metadata (R2/S3 signed URL)
	if ((!fileBufferB64 || fileBufferB64.length === 0) && isFromStorage && documentId) {
		try {
			const pool = getPool();
			const { rows } = await pool.query<{ extraction_metadata: unknown | null; mime_type: string | null }>(
				"SELECT extraction_metadata, mime_type FROM documents WHERE id = $1 LIMIT 1",
				[sanitizeText(documentId)]
			);
			const meta = rows?.[0]?.extraction_metadata ?? null;
			if (!storedMimeType) storedMimeType = rows?.[0]?.mime_type ?? null;

			if (meta) {
				const url = pickDownloadUrlFromExtractionMetadata(meta);
				if (url) {
					try {
						const controller = new AbortController();
						const timer = setTimeout(() => controller.abort(), 30000);
						const res = await fetch(url, { signal: controller.signal });
						clearTimeout(timer);
						if (res.ok) {
							const ab = await res.arrayBuffer();
							const bytes = Buffer.from(ab);
							if (bytes.length > 0) {
								ingestSource = "signed_url";
								const sha256 = createHash("sha256").update(bytes).digest("hex");
								const inferredName =
									(typeof meta === "object" && meta !== null && typeof (meta as any)?.upload?.file_name === "string"
										? String((meta as any).upload.file_name)
										: null) ||
									inferFileNameForStorageFallback(documentId, storedMimeType);
								try {
									await upsertDocumentOriginalFile({
										documentId,
										sha256,
										bytes,
										sizeBytes: bytes.length,
										fileName: inferredName,
										mimeType: storedMimeType,
									});
								} catch {
									// ignore persistence failures
								}
								fileBufferB64 = bytes.toString("base64");
								if (!fileName) fileName = inferredName;
								console.log(
									`[ingest_document] fetched original bytes from url size=${bytes.length} doc=${documentId}`
								);
								await emitJobProgress(job, {
									job_id: job.id ? String(job.id) : "",
									deal_id: dealId ?? undefined,
									document_id: documentId ?? undefined,
									stage: "fetch_original_bytes",
									percent: 8,
									message: "Fetched original bytes from download URL",
								});
							}
						}
					} catch (err) {
						console.warn(
							`[ingest_document] failed to fetch original bytes from url doc=${documentId}: ${
								err instanceof Error ? err.message : String(err)
							}`
						);
					}
				}
			}
		} catch (err) {
			console.warn(
				`[ingest_document] from_storage url recovery failed doc=${documentId}: ${err instanceof Error ? err.message : String(err)}`
			);
		}
	}

	// from_storage recovery: if we still don't have bytes, attempt to download directly from R2 using documents.storage_bucket/storage_key.
	if ((!fileBufferB64 || fileBufferB64.length === 0) && isFromStorage && documentId) {
		try {
			const pool = getPool();
			const r2 = await loadOriginalBytesFromDocumentStorage({ pool, documentId, env: process.env, logger: console });
			if (r2?.bytes?.length) {
				const bytes = r2.bytes;
				ingestSource = "r2";
				r2StorageBucket = r2.bucket || null;
				r2StorageKey = r2.key || null;
				storedMimeType = storedMimeType ?? r2.mime_type ?? null;
				const sha256 = createHash("sha256").update(bytes).digest("hex");
				const inferredName = inferFileNameForStorageFallback(documentId, storedMimeType);
				try {
					await upsertDocumentOriginalFile({
						documentId,
						sha256,
						bytes,
						sizeBytes: bytes.length,
						fileName: fileName ?? inferredName,
						mimeType: storedMimeType,
					});
				} catch {
					// ignore persistence failures
				}
				fileBufferB64 = bytes.toString("base64");
				if (!fileName) fileName = inferredName;
				console.log(`[ingest_document] fetched original bytes from r2 size=${bytes.length} doc=${documentId}`);
				await emitJobProgress(job, {
					job_id: job.id ? String(job.id) : "",
					deal_id: dealId ?? undefined,
					document_id: documentId ?? undefined,
					stage: "fetch_original_bytes",
					percent: 9,
					message: "Fetched original bytes from R2",
				});
			}
		} catch (err) {
			console.warn(
				`[ingest_document] from_storage r2 recovery failed doc=${documentId}: ${
					err instanceof Error ? err.message : String(err)
				}`
			);
		}
	}

	// If from_storage was requested but we still don't have bytes, fail clearly.
	if (isFromStorage && (!fileBufferB64 || fileBufferB64.length === 0)) {
		console.error(`[ingest_document] from_storage missing blob bytes doc=${documentId ?? ""} deal=${dealId ?? ""}`);
		await updateJob(job, "failed", "from_storage missing blob bytes");
		if (documentId) await updateDocumentStatus(documentId, "failed");
		return { ok: false };
	}

	// In from_storage mode, fileName is optional; infer if still absent.
	if (isFromStorage && documentId && !fileName) {
		fileName = inferFileNameForStorageFallback(documentId, storedMimeType);
	}

	const validation = validateIngestDocumentsPayload({
		documentId,
		dealId,
		fileName,
		fileBufferB64,
		mode,
		attempt,
	});
	if (!validation.ok) {
		console.error(`[ingest_document] ${validation.errorMessage}`, {
			documentId,
			dealId,
			fileName,
			fileBufferB64: !!fileBufferB64,
			mode,
		});
		await updateJob(job, "failed", validation.errorMessage ?? "Missing required fields");
		return { ok: false };
	}

	// Validation guarantees these are present in the supported modes.
	const docId = documentId as string;
	const dealIdSafe = dealId as string;
	const fileNameSafe = fileName as string;
	let fileBufferB64Safe = fileBufferB64 as string;

	try {
		const extractionStartedAt = new Date().toISOString();
		await updateJob(job, "running", `Starting document extraction (attempt ${attempt})`, 5);
		await emitJobProgress(job, {
			job_id: job.id ? String(job.id) : "",
			deal_id: dealIdSafe,
			document_id: docId,
			stage: "fetch_original_bytes",
			percent: 5,
			message: `Starting document extraction (attempt ${attempt})`,
			at: extractionStartedAt,
		});
		await updateDocumentStatus(docId, "processing");

		logMemory("ingest_document:before_decode_b64", {
			document_id: docId,
			deal_id: dealIdSafe,
			file_name: fileNameSafe,
			b64_chars: fileBufferB64Safe.length,
		});

		// Decode base64 buffer (drop the base64 reference ASAP to reduce peak RSS)
		let buffer: Buffer | null = Buffer.from(fileBufferB64Safe, "base64");
		const decodedBytes = buffer.length;
		try {
			if (job.data && typeof job.data === "object") {
				(job.data as any).fileBufferB64 = undefined;
			}
		} catch {
			// best-effort
		}
		fileBufferB64Safe = "";
		logMemory("ingest_document:after_decode_b64", {
			document_id: docId,
			deal_id: dealIdSafe,
			decoded_bytes: decodedBytes,
		});
		await yieldToEventLoop();
		console.log(
			`[ingest_document] decoded bytes=${decodedBytes} doc=${docId} deal=${dealIdSafe} attempt=${attempt}`
		);
		if (decodedBytes === 0) {
			await updateJob(job, "failed", "Decoded file buffer is empty", 100);
			await updateDocumentStatus(docId, "failed");
			console.error(`[ingest_document] decoded empty buffer doc=${docId} deal=${dealIdSafe} attempt=${attempt}`);
			return { ok: false };
		}
		await updateJob(job, "running", `Decoded file (${decodedBytes} bytes)`, 15);
		await emitJobProgress(job, {
			job_id: job.id ? String(job.id) : "",
			deal_id: dealIdSafe,
			document_id: docId,
			stage: "persist_document",
			percent: 15,
			message: `Decoded file (${decodedBytes} bytes)`,
		});

		// Persist original bytes for future true re-extraction
		let originalBytesPersisted = false;
		let originalBytesSha256: string | null = null;
		let originalBytesPersistError: string | null = null;
		try {
			const sha256 = createHash("sha256").update(buffer).digest("hex");
			await upsertDocumentOriginalFile({
				documentId: docId,
				sha256,
				bytes: buffer,
				sizeBytes: decodedBytes,
				fileName: fileNameSafe,
				mimeType: storedMimeType,
			});
			originalBytesPersisted = true;
			originalBytesSha256 = sha256;
			console.log(`[ingest_document] stored original bytes sha256=${sha256} doc=${documentId}`);
			await emitJobProgress(job, {
				job_id: job.id ? String(job.id) : "",
				deal_id: dealIdSafe,
				document_id: docId,
				stage: "persist_document",
				percent: 20,
				message: "Persisted original bytes",
			});
		} catch (err) {
			// Do not fail ingestion if original-byte persistence fails; extraction can still proceed.
			originalBytesPersisted = false;
			originalBytesPersistError = err instanceof Error ? err.message : "unknown";
			console.warn(
				`[ingest_document] failed to store original bytes doc=${documentId}: ${originalBytesPersistError}`
			);
		}
		logMemory("ingest_document:after_persist_original_bytes", {
			document_id: docId,
			deal_id: dealIdSafe,
			original_bytes_persisted: originalBytesPersisted,
		});
		await yieldToEventLoop();


		const heartbeat = startHeartbeat(job, {
			stage: fileNameSafe.toLowerCase().endsWith(".pdf") ? "render_pages" : "extract_text",
			dealId: dealIdSafe,
			documentId: docId,
			startPercent: 18,
			maxPercent: 45,
			message: "Processing document (heartbeat)",
			intervalMs: 20000,
		});

		// Process document
		let analysis: DocumentAnalysis;
		try {
			logMemory("ingest_document:before_process_document", {
				document_id: docId,
				deal_id: dealIdSafe,
				decoded_bytes: decodedBytes,
			});
			await yieldToEventLoop();
			analysis = await processDocument(
				buffer,
				fileNameSafe,
				docId,
				dealIdSafe
			);
		} finally {
			heartbeat.stop();
		}
		logMemory("ingest_document:after_process_document", {
			document_id: docId,
			deal_id: dealIdSafe,
			content_type: analysis.contentType,
		});
		buffer = null;
		await yieldToEventLoop();

		await emitJobProgress(job, {
			job_id: job.id ? String(job.id) : "",
			deal_id: dealId ?? undefined,
			document_id: documentId ?? undefined,
			stage: "extract_text",
			percent: 48,
			message: `Processed ${analysis.contentType} bytes`,
		});

		// Normalization (always runs): ensure structured_data.canonical.* exists.
		const normalized = normalizeToCanonical({
			contentType: analysis.contentType,
			content: analysis.content,
			structuredData: analysis.structuredData,
		});
		analysis.structuredData = normalized.structuredData;

		await updateJob(
			job,
			"running",
			`Extracted ${analysis.contentType} (${Math.round(analysis.metadata.processingTimeMs)}ms)` ,
			50
		);
		await emitJobProgress(job, {
			job_id: job.id ? String(job.id) : "",
			deal_id: dealId ?? undefined,
			document_id: documentId ?? undefined,
			stage: "extract_text",
			percent: 50,
			message: `Extracted ${analysis.contentType} (${Math.round(analysis.metadata.processingTimeMs)}ms)`,
		});

		const completeness = computeCompleteness(analysis);
		const extractorNameByKind: Record<string, string> = {
			pdf: "worker.pdf",
			excel: "worker.excel",
			powerpoint: "worker.powerpoint",
			word: "worker.word",
			image: "worker.ocr",
			unknown: "worker.unknown",
		};
		const docKind = analysis.contentType;
		const extractionFinishedAt = new Date().toISOString();
		const extractionMetadata: any = {
			// DoD-required fields
			doc_kind: docKind,
			extractor_name: extractorNameByKind[docKind] ?? "worker.unknown",
			extractor_version: process.env.DOC_EXTRACTOR_VERSION || "1.0.0",
			started_at: extractionStartedAt,
			finished_at: extractionFinishedAt,
			status: analysis.metadata.extractionSuccess ? "succeeded" : "failed",

			// Original file persistence (enables true re-extraction + visual page rendering)
			original_bytes_persisted: originalBytesPersisted,
			original_bytes_sha256: originalBytesSha256,
			original_bytes_persist_error: originalBytesPersistError,

			// Existing fields kept for compatibility
			contentType: analysis.contentType,
			fileSizeBytes: decodedBytes,
			processingTimeMs: analysis.metadata.processingTimeMs,
			attempt,
			decodedBytes,
			pagesProcessed: analysis.contentType === "pdf" ? (analysis.content as any)?.summary?.processedPages ?? null : null,
			totalPages: analysis.contentType === "pdf" ? (analysis.content as any)?.summary?.totalPages ?? null : null,
			totalWords: analysis.contentType === "pdf" ? (analysis.content as any)?.summary?.totalWords ?? null : null,
			textItems: analysis.contentType === "pdf" ? (analysis.content as any)?.summary?.textItems ?? null : null,
			headingsCount: analysis.structuredData.mainHeadings?.length ?? 0,
			summaryLength: analysis.structuredData.textSummary?.length ?? 0,
			completeness,
			errorMessage: analysis.metadata.errorMessage,
			needsOcr: false,
		};

		if (!analysis.metadata.extractionSuccess) {
			const message = analysis.metadata.errorMessage || "Extraction failed";
			const needsOcr = message.toLowerCase().includes("no text extracted") || message.toLowerCase().includes("image-only");
			extractionMetadata.needsOcr = needsOcr;
			const fullText = extractFullText(analysis.content, analysis.contentType);
			const pageCount = getPageCount(analysis.content, analysis.contentType);
			const fullTextAbsentReason = fullText && fullText.trim().length > 0
				? null
				: needsOcr
					? "no_text_extracted_needs_ocr"
					: "no_text_extracted";
			await updateDocumentAnalysis({
				documentId: docId,
				structuredData: analysis.structuredData,
				extractionMetadata,
				fullContent: analysis.content,
				fullText: fullText || undefined,
				fullTextAbsentReason: fullTextAbsentReason ?? undefined,
				pageCount: pageCount || undefined,
			});

			// Evidence emission (best-effort): even on failed extraction, canonical may contain derived/null metrics.
			// Only emit when we have concrete detected values.
			for (const ev of normalized.canonicalEvidence) {
				await insertEvidence({
					deal_id: dealIdSafe,
					document_id: docId,
					source: "extraction",
					kind: "canonical_metric",
					text: `${ev.metric_key}: ${ev.value} • ${ev.source_pointer}`,
					confidence: 0.9,
				});
			}
			await updateDocumentStatus(docId, needsOcr ? "needs_ocr" : "failed");
			await updateJob(job, "failed", message);
			return { ok: false, analysis };
		}

		// Store analysis in evidence - now capturing ALL metrics and headings, not just top 10
		let metricsInserted = 0;
		for (const metric of analysis.structuredData.keyMetrics) {
			const key = typeof (metric as any)?.key === "string" ? String((metric as any).key) : "metric";
			const rawValue = (metric as any)?.value;
			const value = typeof rawValue === "string"
				? rawValue
				: typeof rawValue === "number"
					? String(rawValue)
					: rawValue == null
						? ""
						: JSON.stringify(rawValue);
			const context = typeof (metric as any)?.source === "string" ? String((metric as any).source) : "";
			const isNumericValue = key.trim().toLowerCase() === "numeric_value";
			const label = isNumericValue ? "extracted_number" : key;
			const textParts = [`${label}${value ? `: ${value}` : ""}`];
			if (context) textParts.push(`source: ${context}`);
			await insertEvidence({
				deal_id: dealIdSafe,
				document_id: docId,
				source: "extraction",
				kind: "metric",
				text: textParts.join(" • "),
				confidence: 0.8,
			});
			metricsInserted += 1;
		}

		let headingsInserted = 0;
		for (const heading of analysis.structuredData.mainHeadings) {
			await insertEvidence({
				deal_id: dealIdSafe,
				document_id: docId,
				source: "extraction",
				kind: "section",
				text: heading,
				confidence: 0.9,
			});
			headingsInserted += 1;
		}

		// Store summary
		if (analysis.structuredData.textSummary) {
			await insertEvidence({
				deal_id: dealIdSafe,
				document_id: docId,
				source: "extraction",
				kind: "summary",
				text: analysis.structuredData.textSummary,
				confidence: 0.85,
			});
		}

		await updateJob(job, "running", `Inserted evidence (metrics=${metricsInserted}, headings=${headingsInserted})`, 80);

		// Evidence emission (DoD): canonical metrics with pointers (esp. Excel)
		let canonicalInserted = 0;
		for (const ev of normalized.canonicalEvidence) {
			await insertEvidence({
				deal_id: dealIdSafe,
				document_id: docId,
				source: "extraction",
				kind: "canonical_metric",
				text: `${ev.metric_key}: ${ev.value} • ${ev.source_pointer}`,
				confidence: 0.9,
			});
			canonicalInserted += 1;
		}
		if (canonicalInserted > 0) {
			await updateJob(job, "running", `Inserted canonical metric evidence (${canonicalInserted})`, 82);
		}

		const fullText = extractFullText(analysis.content, analysis.contentType);
		const pageCount = getPageCount(analysis.content, analysis.contentType);
		let finalPageCountForLog: number | null = typeof pageCount === "number" && Number.isFinite(pageCount) ? pageCount : null;
		let renderedPagesDirForLog: string | null = null;
		let renderedPagesR2ForLog: { bucket: string; prefix: string } | null = null;
		const fullTextAbsentReason = fullText && fullText.trim().length > 0
			? null
			: analysis.contentType === "excel"
				? "excel_has_no_full_text"
				: "no_text_extracted";

		const uploadDir = await resolveWritableUploadDir(process.env);
		
		// Determine content threshold based on document type
		// Word docs (cut sheets, whitepapers) can be valid with minimal content
		// Other formats need more substantial content
		let contentThreshold = 0.5;
		if (analysis.contentType === "word") {
			contentThreshold = 0.25; // Lower threshold for Word docs
		}
		
		const lowContent = completeness.score < contentThreshold;
		
		if (lowContent && attempt < 2) {
			const message = `Low-content extraction (${completeness.reason}); retrying`;
			extractionMetadata.errorMessage = message;
			await updateDocumentAnalysis({
				documentId: docId,
				structuredData: analysis.structuredData,
				extractionMetadata,
				fullContent: analysis.content,
				fullText: fullText || undefined,
				fullTextAbsentReason: fullTextAbsentReason ?? undefined,
				pageCount: pageCount || undefined,
			});
			await updateDocumentStatus(docId, "pending");
			await updateJob(job, "failed", message, 100);
			console.warn(`[ingest_document] low content, requeuing attempt ${attempt + 1}`);
			const ingestQueue = getQueue("ingest_documents");
			await ingestQueue.add("ingest_documents", { ...job.data, attempt: attempt + 1 }, { removeOnComplete: true, removeOnFail: false });
			return { ok: false, analysis, completeness };
		} else if (lowContent) {
			const message = `Low-content extraction after retries (${completeness.reason})`;
			extractionMetadata.errorMessage = message;
			await updateDocumentAnalysis({
				documentId: docId,
				structuredData: analysis.structuredData,
				extractionMetadata,
				fullContent: analysis.content,
				fullText: fullText || undefined,
				fullTextAbsentReason: fullTextAbsentReason ?? undefined,
				pageCount: pageCount || undefined,
			});
			await updateDocumentStatus(docId, "failed");
			await updateJob(job, "failed", message, 100);
			console.warn(`[ingest_document] low content after retries documentId=${docId}`);
			return { ok: false, analysis, completeness };
		} else {
			await updateDocumentAnalysis({
				documentId: docId,
				status: "completed",
				structuredData: analysis.structuredData,
				extractionMetadata,
				fullContent: analysis.content,
				fullText: fullText || undefined,
				fullTextAbsentReason: fullTextAbsentReason ?? undefined,
				pageCount: pageCount || undefined,
			});
			await updateJob(
				job,
				"succeeded",
				`Extracted ${analysis.structuredData.keyMetrics.length} metrics, ${analysis.structuredData.mainHeadings.length} headings (score=${completeness.score.toFixed(2)})`,
				100
			);
			await emitJobProgress(job, {
				job_id: job.id ? String(job.id) : "",
				deal_id: dealIdSafe,
				document_id: docId,
				stage: "finalize",
				percent: 100,
				message: `Extracted ${analysis.structuredData.keyMetrics.length} metrics, ${analysis.structuredData.mainHeadings.length} headings (score=${completeness.score.toFixed(2)})`,
			});

			console.log(
				`[ingest_document] documentId=${docId} dealId=${dealIdSafe} type=${analysis.contentType} success=true metrics=${metricsInserted} headings=${headingsInserted} score=${completeness.score.toFixed(2)}`
			);

			// Step 6: persist rendered page images to a stable artifacts directory (best-effort)
			if (analysis.contentType === "pdf") {
				try {
					const persistCfg = { ...getVisualPageImagePersistConfig(process.env, { forceEnable: true }), enabled: true, persist: true };
					if (persistCfg.enabled && persistCfg.persist) {
						if (!buffer) {
							console.warn(`[ingest_document] Skipping persistRenderedPageImages: missing buffer doc=${docId}`);
						} else {
							const renderStarted = Date.now();
							const res = await persistRenderedPageImages({
								buffer,
								documentId: docId,
								pageCount: pageCount || 0,
								uploadDir,
								config: persistCfg,
								logger: console,
							});

							console.log(
								JSON.stringify({
									event: "PDF_RENDERED_PAGES",
									document_id: documentId,
									page_count_input: pageCount || 0,
									rendered_pages_dir: res.rendered_pages_dir ?? null,
									rendered_pages_count: res.rendered_pages_count ?? 0,
									page_count_detected: res.page_count_detected ?? null,
									reason: res.reason ?? null,
									duration_ms: Date.now() - renderStarted,
								})
							);

							if (res.rendered_pages_dir) {
								renderedPagesDirForLog = res.rendered_pages_dir;
								await mergeDocumentExtractionMetadata({
									documentId: docId,
									patch: {
										rendered_pages_dir: res.rendered_pages_dir,
										rendered_pages_format: res.rendered_pages_format,
										rendered_pages_count: res.rendered_pages_count,
										rendered_pages_max_pages: res.rendered_pages_max_pages,
										rendered_pages_created_at: res.rendered_pages_created_at,
									},
								});
								if (res.page_count_detected && res.page_count_detected > 0) {
									await updateDocumentAnalysis({ documentId: docId, pageCount: res.page_count_detected });
									finalPageCountForLog = res.page_count_detected;
								}

								// Persist rendered pages to R2 so the API + worker (separate services on Render) can access them.
								try {
									const r2Bucket = (process.env.R2_BUCKET || "").trim();
									const prefix = `deals/${dealIdSafe}/documents/${docId}/pages`;
									if (r2Bucket && res.rendered_pages_dir) {
										let names: string[] = [];
										try {
											names = await fs.readdir(res.rendered_pages_dir);
										} catch {
											names = [];
										}

										const pageFiles = names
											.map((n) => {
												const m = n.match(/^page_(\d{3})\.png$/);
												if (!m) return null;
												const pageIndex = Number.parseInt(m[1], 10);
												if (!Number.isFinite(pageIndex)) return null;
												return { name: n, pageIndex };
											})
											.filter(Boolean) as Array<{ name: string; pageIndex: number }>;

										pageFiles.sort((a, b) => a.pageIndex - b.pageIndex);
										for (const f of pageFiles) {
											const localPath = path.join(res.rendered_pages_dir, f.name);
											const bytes = await fs.readFile(localPath);
											if (!bytes || bytes.length === 0) continue;
											const key = `${prefix}/page_${String(f.pageIndex).padStart(4, "0")}.png`;
											await uploadToR2({
												bucket: r2Bucket,
												key,
												body: bytes,
												contentType: "image/png",
												env: process.env,
											});
										}

										renderedPagesR2ForLog = { bucket: r2Bucket, prefix };
										await mergeDocumentExtractionMetadata({
											documentId: docId,
											patch: {
												rendered_pages_r2: {
													bucket: r2Bucket,
													prefix,
													format: "page_%04d.png",
											},
										},
									});
									}
								} catch (err) {
									console.warn(
										`[ingest_document] rendered page R2 upload failed doc=${docId}: ${
											err instanceof Error ? err.message : String(err)
										}`
									);
								}
							}

							await emitJobProgress(job, {
								job_id: job.id ? String(job.id) : "",
								deal_id: dealIdSafe,
								document_id: docId,
								stage: "render_pages",
								percent: 90,
								message: `Rendered PDF pages (${res.rendered_pages_count ?? 0})`,
							});
						}
					}
				} catch (err) {
					console.warn(
						`[ingest_document] rendered page persistence failed doc=${docId}: ${
							err instanceof Error ? err.message : String(err)
						}`
					);
				}
			}

				// Ensure PDFs end with a concrete page_count before queuing downstream steps.
				if (analysis.contentType === "pdf") {
					try {
						const { rows } = await getPool().query<{ page_count: number | null }>(
							"SELECT page_count FROM documents WHERE id = $1 LIMIT 1",
							[sanitizeText(docId)]
						);
						const storedPageCount = typeof rows?.[0]?.page_count === "number" ? rows[0].page_count : null;
						const extractedPages = getPageCount(analysis.content, analysis.contentType) || 0;
						const finalPageCount = Math.max(storedPageCount ?? 0, extractedPages);
						finalPageCountForLog = finalPageCount > 0 ? finalPageCount : finalPageCountForLog;
						if (finalPageCount > 0 && finalPageCount !== storedPageCount) {
							await updateDocumentAnalysis({ documentId: docId, pageCount: finalPageCount });
						}
						if (!finalPageCount || finalPageCount <= 0) {
							await updateDocumentStatus(docId, "failed");
							await updateJob(job, "failed", "PDF ingest produced no pages", 100);
							console.error(`[ingest_document] pdf page_count missing doc=${docId}`);
							return { ok: false, analysis, completeness };
						}
					} catch (err) {
						console.warn(
							`[ingest_document] page_count guard failed doc=${docId}: ${
								err instanceof Error ? err.message : String(err)
							}`
						);
					}
				}

				// Structured one-line log for Render debugging: confirms page_count + rendered pages location.
				if (analysis.contentType === "pdf") {
					console.log(
						JSON.stringify({
							event: "pdf_ingest_done",
							deal_id: dealIdSafe,
							document_id: docId,
							page_count: finalPageCountForLog,
							rendered_pages_dir: renderedPagesDirForLog,
							source: ingestSource,
							rendered_pages_r2: renderedPagesR2ForLog,
							storage_bucket: ingestSource === "r2" ? r2StorageBucket : null,
							storage_key: ingestSource === "r2" ? r2StorageKey : null,
						})
					)
				}

			// Queue verification job for this document
			const verifyQueue = getQueue("verify_documents");
			try {
				await verifyQueue.add(
					"verify_documents",
					{
						deal_id: dealIdSafe,
						document_ids: [docId],
					},
					{
						jobId: `verify_documents:${docId}`,
						removeOnComplete: true,
						removeOnFail: false,
						delay: 500,
					}
				);
			} catch (err) {
				// Best-effort dedupe: if a job with this ID already exists, treat as already enqueued.
				const msg = err instanceof Error ? err.message : String(err);
				if (!msg.toLowerCase().includes("job") || !msg.toLowerCase().includes("exists")) {
					console.warn(`[ingest_document] verify_documents enqueue failed doc=${docId}: ${msg}`);
				}
			}

			// Optional: queue visual extraction (best-effort, never blocks ingestion)
			const visionCfg = getVisionExtractorConfig();
			if (visionCfg.enabled) {
				try {
					const visualsQueue = getQueue("extract_visuals");
					const enqueued = await enqueueExtractVisualsIfPossible({
						pool: getPool(),
						queue: visualsQueue,
						config: visionCfg,
						documentId: docId,
						dealId: dealIdSafe,
					});
					if (!enqueued) {
						console.log(
							`[ingest_document] visual extraction skipped doc=${docId} (NO_PAGE_IMAGES_AVAILABLE)`
						);
					}
				} catch (err) {
					console.warn(
						`[ingest_document] visual extraction enqueue failed doc=${docId}: ${
							err instanceof Error ? err.message : String(err)
						}`
					);
				}
			}
		}
		return { ok: true, analysis };
	} catch (err) {
		const message = err instanceof Error ? err.message : "Unknown error";
		const needsOcr = typeof message === "string" && (message.toLowerCase().includes("no text extracted") || message.toLowerCase().includes("image-only"));
		if (documentId) {
			await updateDocumentAnalysis({
				documentId,
				extractionMetadata: {
					doc_kind: fileName?.toLowerCase().split(".").pop() ?? null,
					extractor_name: "worker.unknown",
					extractor_version: process.env.DOC_EXTRACTOR_VERSION || "1.0.0",
					started_at: null,
					finished_at: new Date().toISOString(),
					status: "failed",
					contentType: fileName?.toLowerCase().split(".").pop() ?? null,
					attempt,
					errorMessage: message,
					needsOcr,
				},
				fullTextAbsentReason: "extraction_failed",
			});
			await updateDocumentStatus(documentId, needsOcr ? "needs_ocr" : "failed");
		}
		await updateJob(job, "failed", `Document extraction failed: ${message}`, 100);
		console.error(`[ingest_document] error:`, err);
		throw err;
	}
}

function baseProcessor(statusOnStart: JobStatus, statusOnComplete: JobStatus) {
	return async (job: Job) => {
		await updateJob(job, statusOnStart);
		// Placeholder: perform actual work here
		await updateJob(job, statusOnComplete);
		return { ok: true };
	};
}

const registeredWorkers: Array<Parameters<typeof createWorker>[0]> = [];
const registerWorker = (
	name: Parameters<typeof createWorker>[0],
	processor: Parameters<typeof createWorker>[1]
) => {
	registeredWorkers.push(name);
	return createWorker(name, processor);
};

registerWorker("reconcile_ingest", async (job: Job) => {
	const data = (job.data ?? {}) as { deal_id?: string; document_ids?: string[] };
	const dealId = typeof data.deal_id === "string" ? data.deal_id : undefined;
	const limitToDocs = Array.isArray(data.document_ids)
		? data.document_ids.filter((d) => typeof d === "string" && d.trim().length > 0)
		: [];

	if (!dealId) {
		await updateJob(job, "failed", "Missing deal_id");
		return { ok: false, reason: "missing_deal_id" };
	}

	await updateJob(job, "running", "Reconciling PDF ingest", 5);

	const pool = getPool();
	const candidates: Array<{
		id: string;
		deal_id: string;
		title: string | null;
		type: string | null;
		status: string | null;
		page_count: number | null;
		extraction_metadata: unknown | null;
		file_name: string | null;
		mime_type: string | null;
		has_bytes: boolean;
	}> = [];

	try {
		const { rows } = await pool.query(
			`SELECT d.id,
			        d.deal_id,
			        d.title,
			        d.type,
			        d.status,
			        d.page_count,
			        d.extraction_metadata,
			        df.file_name,
			        df.mime_type,
			        (b.bytes IS NOT NULL AND octet_length(b.bytes) > 0) AS has_bytes
			   FROM documents d
			   LEFT JOIN document_files df ON df.document_id = d.id
			   LEFT JOIN document_file_blobs b ON b.sha256 = df.sha256
			  WHERE d.deal_id = $1
			    AND (
			      lower(coalesce(d.type, '')) LIKE '%pdf%'
			      OR lower(coalesce(df.mime_type, '')) LIKE '%pdf%'
			      OR lower(coalesce(df.file_name, '')) LIKE '%.pdf'
			    )
			    AND (
			      d.status IN ('pending','processing')
			      OR COALESCE(d.page_count, 0) <= 0
			      OR d.extraction_metadata IS NULL
			    )
			    AND ($2::uuid[] = '{}'::uuid[] OR d.id = ANY($2::uuid[]))`,
			[dealId, limitToDocs.length > 0 ? limitToDocs : []]
		);
		for (const row of rows ?? []) candidates.push(row as any);
	} catch (err) {
		await updateJob(job, "failed", err instanceof Error ? err.message : "reconcile query failed", 100);
		return { ok: false, error: err instanceof Error ? err.message : String(err) };
	}

	if (candidates.length === 0) {
		await updateJob(job, "succeeded", "No PDF documents to reconcile", 100);
		return { ok: true, reconciled: 0, skipped_no_bytes: 0 };
	}

	const ingestQueue = getQueue("ingest_documents");
	let reconciled = 0;
	let skippedNoBytes = 0;

	for (const doc of candidates) {
		const hasBytes = !!doc.has_bytes;
		if (!hasBytes) {
			skippedNoBytes += 1;
			console.warn(
				`[reconcile_ingest] missing original bytes doc=${doc.id} status=${doc.status ?? ""}`
			);
			continue;
		}

		try {
			await insertDocumentExtractionAudit({
				documentId: doc.id,
				dealId: doc.deal_id,
				structuredData: null,
				extractionMetadata: doc.extraction_metadata,
				fullContent: null,
				fullText: null,
				verificationStatus: null,
				verificationResult: null,
				reason: "reconcile_pdf_ingest",
				triggeredByJobId: job.id ? String(job.id) : undefined,
			});
		} catch {
			// audit is best-effort
		}

		await failLatestIngestJob(doc.id);
		await updateDocumentStatus(doc.id, "pending");
		const name = typeof doc.file_name === "string" && doc.file_name.trim() ? doc.file_name : `${doc.id}.pdf`;
		await ingestQueue.add(
			"ingest_documents",
			{ document_id: doc.id, deal_id: doc.deal_id, file_name: name, mode: "from_storage", attempt: 1 },
			{ removeOnComplete: true, removeOnFail: false }
		);
		reconciled += 1;
	}

	await updateJob(
		job,
		"succeeded",
		`Requeued ${reconciled} pdf(s); skipped_no_bytes=${skippedNoBytes}`,
		100
	);

	return { ok: true, reconciled, skipped_no_bytes: skippedNoBytes };
});

registerWorker("ingest_documents", ingestDocumentProcessor);

registerWorker("extract_visuals", async (job: Job) => {
	const data = (job.data ?? {}) as {
		deal_id?: string;
		document_id?: string;
		document_ids?: string[];
		image_uris?: string[];
		extractor_version?: string;
		force_resegment?: boolean;
		force_reextract?: boolean;
		enqueue_deep_scan?: boolean;
		page_start?: number;
		page_end?: number;
	};
	const documentId = typeof data.document_id === "string" ? data.document_id : undefined;
	const dealId = typeof data.deal_id === "string" ? data.deal_id : undefined;
	const imageUris = Array.isArray(data.image_uris) ? data.image_uris : undefined;
	const extractorVersionOverride = typeof data.extractor_version === "string" ? data.extractor_version : undefined;
	const forceResegment = Boolean((data as any).force_resegment);
	const forceReextract = Boolean((data as any).force_reextract);
	const enqueueDeepScan = Boolean((data as any).enqueue_deep_scan);
	const pageStartRaw = (data as any).page_start;
	const pageEndRaw = (data as any).page_end;
	const isChunkJob = pageStartRaw != null || pageEndRaw != null;
	const requestedPageStart =
		typeof pageStartRaw === "number" && Number.isFinite(pageStartRaw) ? Math.max(0, Math.floor(pageStartRaw)) : 0;
	const requestedPageEnd =
		typeof pageEndRaw === "number" && Number.isFinite(pageEndRaw) ? Math.max(0, Math.floor(pageEndRaw)) : undefined;

	const explicitDocumentIds = Array.isArray(data.document_ids)
		? data.document_ids.filter((id) => typeof id === "string" && id.trim().length > 0)
		: [];

	let targetDocumentIds: string[] = [];
	if (documentId) {
		targetDocumentIds = [documentId];
	} else if (explicitDocumentIds.length > 0) {
		targetDocumentIds = explicitDocumentIds;
	} else if (dealId) {
		try {
			const docs = await getDocumentsForDeal(dealId);
			targetDocumentIds = docs
				.map((d: any) => d.document_id)
				.filter((id: any) => typeof id === "string" && id.length > 0);
		} catch (err) {
			await updateJob(job, "failed", err instanceof Error ? err.message : "Failed to load deal documents", 100);
			return { ok: false };
		}
	}

	if (targetDocumentIds.length === 0) {
		console.warn("[extract_visuals] Missing document_id (or deal_id with documents)");
		await updateJob(job, "failed", "Missing document_id (or deal_id with documents)", 100);
		return { ok: false };
	}

	const config = getVisionExtractorConfig();
	if (!config.enabled) {
		await updateJob(
			job,
			"failed",
			"Visual extraction is disabled in the worker (set ENABLE_VISUAL_EXTRACTION=1)",
			100
		);
		return { ok: false, skipped: true, reason: "disabled" };
	}

	const extractorVersion = typeof extractorVersionOverride === "string" && extractorVersionOverride.trim()
		? extractorVersionOverride.trim()
		: config.extractorVersion;
	const structuredExtractorVersion = process.env.STRUCTURED_VISION_EXTRACTOR_VERSION || "structured_native_v1";
	const nonPdfRenderEnabled = (() => {
		const raw = process.env.ENABLE_NONPDF_RENDER_PAGES;
		if (raw == null) return true; // default ON to ensure Office docs render
		return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
	})();
	if (!nonPdfRenderEnabled) {
		console.warn(
			JSON.stringify({ event: "nonpdf_render_disabled", reason: "ENABLE_NONPDF_RENDER_PAGES=0" })
		);
	}

	const pool = getPool();
	const docsTotal = targetDocumentIds.length;
	logMemory("extract_visuals:job_start", {
		job_id: job.id ? String(job.id) : null,
		deal_id: dealId ?? null,
		docs_total: docsTotal,
		chunk: isChunkJob ? { page_start: requestedPageStart, page_end: requestedPageEnd ?? null } : null,
	});
	devLog("worker_extract_visuals_start", {
		job_id: job.id ? String(job.id) : null,
		deal_id: dealId ?? null,
		docs_total: docsTotal,
	});
	const tablesOk =
		(await hasTable(pool, "visual_assets")) &&
		(await hasTable(pool, "visual_extractions")) &&
		(await hasTable(pool, "evidence_links"));

	if (!tablesOk) {
		console.warn(
			`[extract_visuals] Visual tables missing; skipping (did you run migrations?)`
		);
		await updateJob(
			job,
			"failed",
			"Visual tables missing (run DB migrations before extracting visuals)",
			100
		);
		return { ok: false, skipped: true, reason: "tables_missing" };
	}

	const originalFileTablesOk =
		(await hasTable(pool, "document_files")) &&
		(await hasTable(pool, "document_file_blobs"));

	let docsBlockedPending = 0;
	const blockedDocs: {
		document_id: string;
		title: string | null;
		type: string | null;
		status: string | null;
		page_count: number | null;
		has_extraction_metadata: boolean;
		has_original_bytes: boolean;
		has_rendered_pages: boolean;
		reason?: string | null;
	}[] = [];

	try {
		const { rows: metaRows } = await pool.query(
			"SELECT id, title, type, status, page_count, extraction_metadata FROM documents WHERE id = ANY($1)",
			[targetDocumentIds]
		);
		const metaMap = new Map<string, any>();
		for (const row of metaRows ?? []) metaMap.set(row.id, row);

		for (const docId of targetDocumentIds) {
			const meta = metaMap.get(docId) ?? {};
			const status = typeof meta.status === "string" ? meta.status : null;
			const hasExtractionMetadata = !!meta.extraction_metadata;
			const pageCountRaw = meta.page_count;
			const pageCount = typeof pageCountRaw === "number" && Number.isFinite(pageCountRaw) ? pageCountRaw : null;
			let hasRenderedPages = false;
			try {
				const previewUris = await resolvePageImageUris(pool, docId, { env: process.env, logger: console });
				hasRenderedPages = Array.isArray(previewUris) && previewUris.length > 0;
			} catch (err) {
				console.warn(
					`[extract_visuals] preview resolve failed doc=${docId}: ${err instanceof Error ? err.message : String(err)}`
				);
			}

			let hasOriginalBytes = false;
			if (originalFileTablesOk) {
				try {
					const original = await getDocumentOriginalFile(docId);
					hasOriginalBytes = !!(original?.bytes && original.bytes.length > 0);
				} catch {
					hasOriginalBytes = false;
				}
			}

			const readiness = evaluateVisualDocReadiness({
				id: docId,
				status,
				hasExtractionMetadata,
				pageCount,
				hasRenderedPages,
				hasOriginalBytes,
			});
			if (readiness.blocked) {
				docsBlockedPending += 1;
				blockedDocs.push({
					document_id: docId,
					title: typeof meta.title === "string" ? meta.title : null,
					type: typeof meta.type === "string" ? meta.type : null,
					status,
					page_count: pageCount,
					has_extraction_metadata: hasExtractionMetadata,
					has_original_bytes: hasOriginalBytes,
					has_rendered_pages: hasRenderedPages,
					reason: readiness.reason,
				});
			}
		}
	} catch (err) {
		console.warn(
			`[extract_visuals] guard precheck failed: ${err instanceof Error ? err.message : String(err)}`
		);
	}

	const blockedDocIds = new Set(blockedDocs.map((d) => d.document_id));
	const readyDocumentIds = targetDocumentIds.filter((id) => !blockedDocIds.has(id));
	const docsReady = readyDocumentIds.length;
	const docsBlocked = blockedDocs.length;
	docsBlockedPending = docsBlocked;
	targetDocumentIds = readyDocumentIds;

	if (docsReady === 0) {
		const guardPayload = {
			reason: "INGEST_NOT_COMPLETE",
			blocked_docs: blockedDocs,
			blocked_document_ids: blockedDocs.map((d) => d.document_id),
			docs_total: docsTotal,
			docs_ready: docsReady,
			docs_blocked: docsBlocked,
			suggested_action:
				"run reconcile-ingest or wait for ingest_documents to complete, then re-run extract_visuals",
			diagnostics: {
				docs_total: docsTotal,
				docs_blocked_pending: docsBlockedPending,
				document_file_tables_present: originalFileTablesOk,
			},
		};
		await updateJob(
			job,
			"failed",
			`Visual extraction blocked (ingest not complete) docs_blocked=${blockedDocs.length}`,
			100
		);
		devLog("worker_extract_visuals_finish", {
			job_id: job.id ? String(job.id) : null,
			deal_id: dealId ?? null,
			docs_total: docsTotal,
			docs_blocked_pending: docsBlockedPending,
			guard_triggered: true,
		});
		return { ok: false, ...guardPayload };
	}

	if (docsBlocked > 0) {
		await updateJob(
			job,
			"running",
			`Proceeding with ready docs (ready=${docsReady}/${docsTotal}, blocked=${docsBlocked})`,
			5
		);
		await emitJobProgress(job, {
			job_id: job.id ? String(job.id) : "",
			deal_id: dealId ?? undefined,
			stage: "blocked",
			percent: 5,
			message: `Proceeding with ready docs (ready=${docsReady}/${docsTotal}, blocked=${docsBlocked})`,
			reason: "INGEST_NOT_COMPLETE",
			meta: {
				docs_total: docsTotal,
				docs_ready: docsReady,
				docs_blocked: docsBlocked,
				blocked_document_ids: blockedDocs.map((d) => d.document_id),
			},
		});
	} else {
		await updateJob(job, "running", `Starting visual extraction (docs=${targetDocumentIds.length})`, 5);
		await emitJobProgress(job, {
			job_id: job.id ? String(job.id) : "",
			deal_id: dealId ?? undefined,
			stage: "collect_image_uris",
			percent: 5,
			message: `Starting visual extraction (docs=${targetDocumentIds.length})`,
		});
	}

	let persisted = 0;
	let docsProcessed = 0;
	let docsSkipped = docsBlocked;
	let pagesSkippedExisting = 0;
	let docsMissingOriginalBytes = 0;
	let docsMissingPageImages = 0;
	let docsHadPageCountMissing = 0;
	let docsRenderedViaPdf = 0;
	let docsRenderedViaLibreoffice = 0;
	let docsSyntheticAssetsUsed = 0;
	let docsPdfTextRegionAssetsUsed = 0;
	let docsExcelSkippedVision = 0;
	let docsExcelPyAssetsUsed = 0;
	let imageUrisBackfilled = 0;
	const docsMissingOriginalBytesIds: string[] = [];
	const docsMissingPageImagesIds: string[] = [];

	for (let docIndex = 0; docIndex < targetDocumentIds.length; docIndex += 1) {
		const docId = targetDocumentIds[docIndex];
		const basePct = Math.min(
			95,
			Math.round(((docIndex / Math.max(1, targetDocumentIds.length)) * 90) + 5)
		);


		let docMeta: {
			deal_id?: string | null;
			type?: string | null;
			extraction_metadata?: unknown;
			structured_data?: unknown;
			full_content?: unknown;
			page_count?: number | null;
			title?: string | null;
		} | null = null;
		try {
			const { rows } = await pool.query(
				"SELECT deal_id, type, title, extraction_metadata, structured_data, full_content, page_count FROM documents WHERE id = $1 LIMIT 1",
				[sanitizeText(docId)]
			);
			docMeta = rows?.[0] ?? null;
		} catch {
			// best-effort metadata fetch
		}

		// Optional maintenance: recompute segment_key for existing structured synthetic assets.
		if (forceResegment) {
			try {
				const title = typeof docMeta?.title === "string" ? docMeta.title : null;
				const res = await resegmentStructuredSyntheticAssets({ pool, documentId: docId, documentTitle: title });
				console.log(
					JSON.stringify({
						event: "resegment_structured_synthetic_assets",
						document_id: docId,
						updated_assets: res.updated_assets,
						updated_extractions: res.updated_extractions,
					})
				);
			} catch (err) {
				console.warn(
					`[extract_visuals] force_resegment failed doc=${docId}: ${err instanceof Error ? err.message : String(err)}`
				);
			}
		}

		const docKind = deduceDocKind({ extraction_metadata: docMeta?.extraction_metadata, type: docMeta?.type ?? null });
		const docPageCount = typeof docMeta?.page_count === "number" && Number.isFinite(docMeta.page_count) ? docMeta.page_count : null;
		let syntheticPersisted = 0;
		let pdfTextRegionPersisted = 0;
		// Always persist structured synthetic assets for Office docs when available.
		// These are complementary to vision/OCR page assets and keep lineage/scoring grounded in text.
		const pyExcelEnabled = (() => {
			const raw = process.env.ENABLE_PY_EXCEL_EXTRACTION;
			if (raw == null) return true; // default ON
			return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
		})();
		const deferExcelSynthetic = docKind === "excel" && pyExcelEnabled;
		if (["word", "powerpoint"].includes(docKind) || (docKind === "excel" && !deferExcelSynthetic)) {
			try {
				syntheticPersisted = await persistSyntheticVisualAssets({
					pool,
					documentId: docId,
					docKind,
					structuredData: docMeta?.structured_data ?? {},
					fullContent: docMeta?.full_content ?? {},
					extractorVersion: structuredExtractorVersion,
					env: process.env,
				});
				if (syntheticPersisted > 0) {
					docsSyntheticAssetsUsed += 1;
					persisted += syntheticPersisted;
				}
			} catch (err) {
				console.warn(
					`[extract_visuals] persistSyntheticVisualAssets failed doc=${docId}: ${err instanceof Error ? err.message : String(err)}`
				);
			}
		}

		// PDF-only synthetic assets: stable text region nodes built from pdf_v2 slide-understanding regions.
		// Shadow-only in this PR: persists assets for future lineage/scoring adoption without changing analyzers.
		if (docKind === "pdf") {
			try {
				pdfTextRegionPersisted = await persistPdfV2TextRegionAssetsV1Shadow({
					pool,
					documentId: docId,
					dealId: dealId ?? (typeof docMeta?.deal_id === "string" ? docMeta.deal_id : null),
					fullContent: docMeta?.full_content ?? {},
					env: process.env,
				});
				if (pdfTextRegionPersisted > 0) {
					docsPdfTextRegionAssetsUsed += 1;
					persisted += pdfTextRegionPersisted;
				}
			} catch (err) {
				console.warn(
					`[extract_visuals] pdf text region assets failed doc=${docId}: ${err instanceof Error ? err.message : String(err)}`
				);
			}

			// PDF-only canonical per-page understanding snapshot (shadow-first).
			// Additive: persists to document_page_understanding; does not change scoring/title/segment behavior.
			try {
				const res = await persistPdfPageUnderstandingV1Shadow({
					pool,
					documentId: docId,
					dealId: dealId ?? (typeof docMeta?.deal_id === "string" ? docMeta.deal_id : null),
					fullContent: docMeta?.full_content ?? {},
					env: process.env,
				});
				if (res.persisted_pages > 0) {
					console.log(
						JSON.stringify({
							event: "PDF_PAGE_UNDERSTANDING_PERSISTED",
							document_id: docId,
							persisted_pages: res.persisted_pages,
							attempted_pages: res.attempted_pages,
						})
					);
				}
			} catch (err) {
				console.warn(
					`[extract_visuals] pdf page understanding failed doc=${docId}: ${err instanceof Error ? err.message : String(err)}`
				);
			}
		}
		await updateJob(
			job,
			"running",
			`Extracting visuals (doc ${docIndex + 1}/${targetDocumentIds.length})`,
			basePct
		);
		await emitJobProgress(job, {
			job_id: job.id ? String(job.id) : "",
			deal_id: dealId ?? undefined,
			document_id: docId,
			stage: "extract_visual_assets",
			percent: basePct,
			message: `Extracting visuals (doc ${docIndex + 1}/${targetDocumentIds.length})`,
		});

		// Use explicit image_uris only for single-document jobs; otherwise resolve from rendered pages.
		let uris: string[] = [];
		if (targetDocumentIds.length === 1 && Array.isArray(imageUris)) {
			uris = imageUris.filter((u) => typeof u === "string" && u.length > 0);
		}
		if (uris.length === 0) {
			uris = await resolvePageImageUris(pool, docId, { env: process.env, logger: console });
		}

		const chunkSize = config.maxPages;
		const totalPages = uris.length;
		const pageStart = isChunkJob ? Math.min(requestedPageStart, Math.max(0, totalPages - 1)) : 0;
		const pageEndExclusive =
			typeof requestedPageEnd === "number"
				? Math.min(Math.max(pageStart, requestedPageEnd), totalPages)
				: Math.min(pageStart + chunkSize, totalPages);

		// If this doc has more pages than we can safely process in one job, enqueue follow-up chunk jobs.
		if (!isChunkJob && totalPages > chunkSize) {
			try {
				const parentJobId = job.id ? String(job.id) : null;
				for (let start = chunkSize; start < totalPages; start += chunkSize) {
					const end = Math.min(start + chunkSize, totalPages);
					await enqueuePersistedJob({
						type: "extract_visuals",
						deal_id: dealId ?? (typeof docMeta?.deal_id === "string" ? docMeta.deal_id : undefined),
						document_id: docId,
						parent_job_id: parentJobId,
						page_start: start,
						page_end: end,
						payload: {
							extractor_version: extractorVersion,
							force_resegment: forceResegment,
							force_reextract: forceReextract,
						},
					});
				}
				console.log(
					JSON.stringify({
						event: "EXTRACT_VISUALS_CHUNK_ENQUEUED",
						document_id: docId,
						total_pages: totalPages,
						chunk_size: chunkSize,
						chunks_enqueued: Math.ceil(totalPages / chunkSize) - 1,
					})
				);
			} catch (err) {
				console.warn(
					`[extract_visuals] failed to enqueue chunk jobs doc=${docId}: ${err instanceof Error ? err.message : String(err)}`
				);
			}
		}

		if (uris.length === 0) {
			// Best-effort recovery: for PDF documents, generate rendered page images from the stored original
			// file and retry resolving images. This aligns behavior across deals where older ingests did not
			// persist rendered pages.
			try {
				try {
					const { rows } = await pool.query<{ page_count: number | null }>(
						"SELECT page_count FROM documents WHERE id = $1 LIMIT 1",
						[docId]
					);
					const pc = typeof rows?.[0]?.page_count === "number" && Number.isFinite(rows[0].page_count) ? rows[0].page_count : 0;
					if (!pc || pc <= 0) docsHadPageCountMissing += 1;
				} catch {
					// ignore
				}
				const original = await getDocumentOriginalFile(docId);
				let originalBytes: Buffer | null = original?.bytes ?? null;
				const originalFileName: string | null = typeof original?.file_name === "string" ? original.file_name : null;
				const originalMimeType: string | null = typeof original?.mime_type === "string" ? original.mime_type : null;

				// If DB blob is missing (common in prod setups), attempt to fetch bytes from a URL stored in extraction_metadata.
				if ((!originalBytes || originalBytes.length === 0) && docMeta?.extraction_metadata) {
					const url = pickDownloadUrlFromExtractionMetadata(docMeta.extraction_metadata);
					if (url) {
						try {
							const controller = new AbortController();
							const timer = setTimeout(() => controller.abort(), 20000);
							const res = await fetch(url, { signal: controller.signal });
							clearTimeout(timer);
							if (res.ok) {
								const ab = await res.arrayBuffer();
								originalBytes = Buffer.from(ab);
								console.log(
									JSON.stringify({
										event: "FETCHED_ORIGINAL_BYTES_FROM_URL",
										document_id: docId,
										url_host: (() => {
											try {
												return new URL(url).host;
											} catch {
												return null;
											}
										})(),
										size_bytes: originalBytes.length,
									})
								);

								// Best-effort: persist for future re-runs.
								try {
									const sha256 = createHash("sha256").update(originalBytes).digest("hex");
									const inferredName =
										(typeof (docMeta as any)?.extraction_metadata === "object" &&
											(typeof (docMeta as any)?.extraction_metadata?.upload?.file_name === "string"
												? (docMeta as any).extraction_metadata.upload.file_name
												: null)) ||
										originalFileName ||
										`${docId}.bin`;
									await upsertDocumentOriginalFile({
										documentId: docId,
										sha256,
										bytes: originalBytes,
										sizeBytes: originalBytes.length,
										fileName: inferredName,
										mimeType: originalMimeType,
									});
								} catch {
									// ignore persistence errors
								}
							}
						} catch (err) {
							console.warn(
								`[extract_visuals] failed to fetch original bytes from url doc=${docId}: ${
									err instanceof Error ? err.message : String(err)
								}`
							);
						}
					}
				}

				const isPdf =
					(originalMimeType && originalMimeType.toLowerCase().includes("pdf")) ||
					(originalFileName && originalFileName.toLowerCase().endsWith(".pdf")) ||
					docKind === "pdf";
				if (!originalBytes || originalBytes.length === 0) {
					docsMissingOriginalBytes += 1;
					docsMissingOriginalBytesIds.push(docId);
				}

				const uploadDir = process.env.UPLOAD_DIR
					? path.resolve(process.env.UPLOAD_DIR)
					: path.resolve(process.cwd(), "uploads");
				const persistCfg = getVisualPageImagePersistConfig();

				// PDF rendering fallback
				if (originalBytes && isPdf) {
					const { rows } = await pool.query<{ page_count: number | null }>(
						"SELECT page_count FROM documents WHERE id = $1 LIMIT 1",
						[docId]
					);
					const existingPageCount =
						typeof rows?.[0]?.page_count === "number" && Number.isFinite(rows[0].page_count)
							? rows[0].page_count
							: 0;

					const renderRes = await persistRenderedPageImages({
						buffer: originalBytes,
						documentId: docId,
						pageCount: existingPageCount || 0,
						uploadDir,
						config: persistCfg,
						logger: console,
					});

					if ((renderRes.rendered_pages_count ?? 0) > 0) {
						docsRenderedViaPdf += 1;
					}

					if (!existingPageCount && renderRes.page_count_detected && renderRes.page_count_detected > 0) {
						await pool.query(
							"UPDATE documents SET page_count = $2, updated_at = now() WHERE id = $1 AND (page_count IS NULL OR page_count <= 0)",
							[docId, renderRes.page_count_detected]
						);
					}

					uris = await resolvePageImageUris(pool, docId, { env: process.env, logger: console });
				}

				// Non-PDF rendering (LibreOffice -> PDF -> pages) when enabled
				if (originalBytes && nonPdfRenderEnabled && ["powerpoint", "word", "excel"].includes(docKind)) {
					const fileExt = typeof originalFileName === "string"
						? originalFileName.split(".").pop() ?? docKind
						: docKind;
					const { rows } = await pool.query<{ page_count: number | null }>(
						"SELECT page_count FROM documents WHERE id = $1 LIMIT 1",
						[docId]
					);
					const existingPageCount =
						typeof rows?.[0]?.page_count === "number" && Number.isFinite(rows[0].page_count)
							? rows[0].page_count
							: 0;

					const renderRes = await renderNonPdfToPageImages({
						buffer: originalBytes,
						fileExt,
						documentId: docId,
						uploadDir,
						pageCount: existingPageCount || 0,
						config: persistCfg,
						logger: console,
					});

					if ((renderRes.rendered_pages_count ?? 0) > 0) {
						docsRenderedViaLibreoffice += 1;
					}

					console.log(
						JSON.stringify({
							event: "NONPDF_RENDERED_PAGES",
							document_id: docId,
							doc_kind: docKind,
							file_ext: fileExt,
							page_count_input: existingPageCount || 0,
							rendered_pages_dir: renderRes.rendered_pages_dir ?? null,
							rendered_pages_count: renderRes.rendered_pages_count ?? 0,
							reason: renderRes.reason ?? null,
						})
					);

					if (!existingPageCount && renderRes.page_count_detected && renderRes.page_count_detected > 0) {
						await pool.query(
							"UPDATE documents SET page_count = $2, updated_at = now() WHERE id = $1 AND (page_count IS NULL OR page_count <= 0)",
							[docId, renderRes.page_count_detected]
						);
					}

					if (renderRes.rendered_pages_dir) {
						await mergeDocumentExtractionMetadata({
							documentId: docId,
							patch: {
								rendered_pages_dir: renderRes.rendered_pages_dir,
								rendered_pages_format: renderRes.rendered_pages_format,
								rendered_pages_count: renderRes.rendered_pages_count,
								rendered_pages_max_pages: renderRes.rendered_pages_max_pages,
								rendered_pages_created_at: renderRes.rendered_pages_created_at,
							},
						});
					}

					uris = await resolvePageImageUris(pool, docId, { env: process.env, logger: console });
				}

				// Image docs: normalize into rendered_pages/page_000.png
				if (originalBytes && docKind === "image") {
					const res = await persistImagePage({
						buffer: originalBytes,
						documentId: docId,
						uploadDir,
						config: persistCfg,
						logger: console,
					});
					console.log(
						JSON.stringify({
							event: "IMAGE_RENDERED_PAGE",
							document_id: docId,
							rendered_pages_dir: res.rendered_pages_dir ?? null,
							rendered_pages_count: res.rendered_pages_count ?? 0,
							reason: res.reason ?? null,
						})
					);
					if (res.rendered_pages_dir) {
						await mergeDocumentExtractionMetadata({
							documentId: docId,
							patch: {
								rendered_pages_dir: res.rendered_pages_dir,
								rendered_pages_format: res.rendered_pages_format,
								rendered_pages_count: res.rendered_pages_count,
								rendered_pages_max_pages: res.rendered_pages_max_pages,
								rendered_pages_created_at: res.rendered_pages_created_at,
							},
						});
					}

					uris = await resolvePageImageUris(pool, docId, { env: process.env, logger: console });
				}
			} catch (err) {
				console.warn(
					`[extract_visuals] Could not generate rendered pages doc=${docId}: ${
						err instanceof Error ? err.message : String(err)
					}`
				);
			}

			if (uris.length === 0) {
				if (syntheticPersisted > 0) {
					docsProcessed += 1;
					continue;
				}

				docsMissingPageImages += 1;
				docsMissingPageImagesIds.push(docId);
				docsSkipped += 1;
				continue;
			}
		}

		docsProcessed += 1;
		let docPersisted = 0;
		let docPersistedWithImageUri = 0;
		let docBackfilled = 0;

		try {
			const backfillRes = await backfillVisualAssetImageUris({
				pool,
				documentId: docId,
				pageImageUris: uris,
				env: process.env,
			});
			docBackfilled = backfillRes.updated;
			imageUrisBackfilled += docBackfilled;
		} catch (err) {
			console.warn(
				`[extract_visuals] backfill image_uri failed doc=${docId}: ${err instanceof Error ? err.message : String(err)}`
			);
		}

		// Post-render pass: for structured PowerPoint synthetic slides that have no text and unknown segment,
		// call the local vision-understanding model and persist segment hints into the structured assets.
		// Note: some decks are typed as pdf/pitch_deck even if full_content has slides, so we always attempt
		// this pass (it self-selects candidates in SQL).
		try {
			const res = await applyVisionHintsToStructuredPowerpointSlides({
				pool,
				documentId: docId,
				pageImageUris: uris,
				structuredExtractorVersion: structuredExtractorVersion,
				visionConfig: config,
				env: process.env,
				logger: console,
			});
			if (res.attempted > 0 || res.updated > 0 || res.errors > 0) {
				console.log(
					JSON.stringify({
						event: "STRUCTURED_POWERPOINT_VISION_HINTS",
						document_id: docId,
						...res,
					})
				);
			}
		} catch (err) {
			console.warn(
				`[extract_visuals] structured PowerPoint vision hints pass failed doc=${docId}: ${
					err instanceof Error ? err.message : String(err)
				}`
			);
		}

		// Excel: prefer structured, cell-based extraction over OCR/vision.
		// Default behavior:
		// - ENABLE_PY_EXCEL_EXTRACTION=1 (default): call vision_worker /extract-xlsx (openpyxl) and persist table/range nodes.
		// - ENABLE_EXCEL_VISION_EXTRACTION=1: force OCR/vision on rendered sheet images (not recommended).
		// - If Python extraction fails, fall back to existing structured synthetic extraction.
		const excelVisionEnabled = (() => {
			const raw = process.env.ENABLE_EXCEL_VISION_EXTRACTION;
			if (raw == null) return false;
			return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
		})();
		if (docKind === "excel" && !excelVisionEnabled) {
			let excelStructuredPersisted = 0;
			let usedPython = false;

			if (pyExcelEnabled) {
				try {
					if (!forceReextract) {
						const { rows } = await pool.query(
							`
									SELECT 1
									  FROM visual_assets va
									  JOIN visual_extractions ve ON ve.visual_asset_id = va.id
									 WHERE va.document_id = $1
									   AND ve.extractor_version = $2
									   AND (
											(ve.structured_json->>'kind') LIKE 'excel_%'
											OR (ve.structured_json->>'kind') = 'table'
											OR (ve.structured_json->>'kind') = 'excel_range'
									   )
									 LIMIT 1
							`,
							[sanitizeText(docId), sanitizeText(process.env.EXCEL_PY_EXTRACTOR_VERSION || "excel_py_v1")]
						);
						if ((rows?.length ?? 0) > 0) {
							docsExcelSkippedVision += 1;
							console.log(
								JSON.stringify({
									event: "EXCEL_SKIP_VISION_EXTRACTION",
									document_id: docId,
									reason: "excel_py_assets_already_present",
								})
							);
							continue;
						}
					}

					const original = await getDocumentOriginalFile(docId);
					if (original?.bytes && original.bytes.length > 0) {
						const excelPyExtractorVersion = process.env.EXCEL_PY_EXTRACTOR_VERSION || "excel_py_v1";
						const xlsxResp = await callXlsxWorker(config, {
							document_id: docId,
							xlsx_b64: original.bytes.toString("base64"),
							extractor_version: excelPyExtractorVersion,
							max_sheets: 50,
							max_tables_per_sheet: 24,
						});
						if (xlsxResp?.pages?.length) {
							let persistedLocal = 0;
							for (const page of xlsxResp.pages) {
								const pageIdx = typeof (page as any)?.page_index === "number" ? (page as any).page_index : 0;
								const pageImageUri = pageIdx >= 0 && pageIdx < uris.length ? uris[pageIdx] : null;
								const res = await persistVisionResponse(pool, page as any, { pageImageUri, env: process.env });
								persistedLocal += res.persisted;
							}
							excelStructuredPersisted = persistedLocal;
							persisted += persistedLocal;
							if (persistedLocal > 0) {
								usedPython = true;
								docsExcelPyAssetsUsed += 1;
							}
						}
					}
				} catch (err) {
					console.warn(
						`[extract_visuals] excel python extraction failed doc=${docId}: ${err instanceof Error ? err.message : String(err)}`
					);
				}
			}

			if (!usedPython) {
				// Fallback: use existing structured synthetic Excel assets from the JS extractor.
				if (deferExcelSynthetic) {
					try {
						syntheticPersisted = await persistSyntheticVisualAssets({
							pool,
							documentId: docId,
							docKind,
							structuredData: docMeta?.structured_data ?? {},
							fullContent: docMeta?.full_content ?? {},
							extractorVersion: structuredExtractorVersion,
							env: process.env,
						});
						if (syntheticPersisted > 0) {
							docsSyntheticAssetsUsed += 1;
							persisted += syntheticPersisted;
						}
					} catch (err) {
						console.warn(
							`[extract_visuals] excel synthetic fallback failed doc=${docId}: ${err instanceof Error ? err.message : String(err)}`
						);
					}
				}
			}

			docsExcelSkippedVision += 1;
			console.log(
				JSON.stringify({
					event: "EXCEL_SKIP_VISION_EXTRACTION",
					document_id: docId,
					reason: usedPython ? "excel_py_structured" : "structured_synthetic_fallback",
					excel_py_persisted: excelStructuredPersisted,
					synthetic_persisted: syntheticPersisted,
				})
			);
			continue;
		}

		const pagesInJob = Math.max(0, pageEndExclusive - pageStart);
		await updateJobProgress(job, {
			status: "running" as any,
			stage: "extract_visual_assets",
			current: 0,
			total: pagesInJob,
			message: `Extracting visuals (${pagesInJob} page(s))`,
			page_start: pageStart,
			page_end: pageEndExclusive,
			meta: {
				document_id: docId,
				total_pages: totalPages,
				range: { start: pageStart, end: pageEndExclusive },
			},
		});

		for (let i = pageStart; i < pageEndExclusive; i += 1) {
			const image_uri = uris[i];
			const image_b64 = await tryReadImageB64ForVision(image_uri, process.env);
			const safe_image_uri =
				image_b64 && (image_uri.startsWith("http://") || image_uri.startsWith("https://"))
					? undefined
					: image_uri;

			// If we've already extracted this page for this extractor version, don't re-run.
			// This prevents repeated OCR/vision-understanding passes on the same slide across extractions.
			if (!forceReextract) {
				try {
					const { rows } = await pool.query(
						`
							SELECT 1
							  FROM visual_assets va
							  JOIN visual_extractions ve ON ve.visual_asset_id = va.id
							 WHERE va.document_id = $1
							   AND va.page_index = $2
							   AND ve.extractor_version = $3
							   AND (
								(va.quality_flags->>'accepted_v1') = 'true'
								OR (
									COALESCE(length(btrim(ve.ocr_text)), 0) > 120
									OR ve.confidence > 0.55
									OR (ve.structured_json IS NOT NULL AND ve.structured_json <> '{}'::jsonb)
								)
							)
							 LIMIT 1
						`,
						[sanitizeText(docId), i, sanitizeText(extractorVersion)]
					);
					if ((rows?.length ?? 0) > 0) {
						pagesSkippedExisting += 1;
						continue;
					}
				} catch (err) {
					// Best-effort: if precheck fails, proceed with extraction rather than skipping.
					console.warn(
						`[extract_visuals] existing-page precheck failed doc=${docId} page=${i}: ${err instanceof Error ? err.message : String(err)}`
					);
				}
			}

			let response = await callVisionWorker(config, {
				document_id: docId,
				page_index: i,
				image_uri: safe_image_uri,
				image_b64: image_b64 ?? undefined,
				extractor_version: extractorVersion,
			});

			if (!response || !Array.isArray(response.assets) || response.assets.length === 0) {
				console.warn(`[extract_visuals] Vision worker returned no assets for doc=${docId} page=${i}, persisting fallback`);
				response = {
					document_id: docId,
					page_index: i,
					extractor_version: extractorVersion,
					assets: [
						{
							asset_type: "image_text",
							bbox: { x: 0, y: 0, w: 1, h: 1 },
							confidence: 0,
							quality_flags: { source: "page_image_fallback" },
							image_uri,
							image_hash: null,
							extraction: {
								ocr_text: null,
								ocr_blocks: [],
								structured_json: {},
								units: null,
								labels: {},
								model_version: null,
								confidence: 0,
							},
						},
					],
				};
			}

			try {
				const { persisted: pCount, withImageUri } = await persistVisionResponse(pool, response, { pageImageUri: image_uri });
				persisted += pCount;
				docPersisted += pCount;
				docPersistedWithImageUri += withImageUri;
				await updateJobProgress(job, {
					stage: "extract_visual_assets",
					current: Math.min(pagesInJob, (i - pageStart) + 1),
					total: pagesInJob,
					message: `Extracted page ${i + 1}/${totalPages}`,
					page_start: pageStart,
					page_end: pageEndExclusive,
					meta: {
						document_id: docId,
						page_index: i,
						range: { start: pageStart, end: pageEndExclusive },
					},
				});
				if ((i - pageStart) % 2 === 0) {
					logMemory("extract_visuals:page_persisted", {
						document_id: docId,
						page_index: i,
						persisted_assets: pCount,
						page_range: { start: pageStart, end: pageEndExclusive },
					});
					await emitJobProgress(job, {
						job_id: job.id ? String(job.id) : "",
						deal_id: dealId ?? undefined,
						document_id: docId,
						stage: "extract_visual_assets",
						percent: basePct,
						message: `Extracted page ${i + 1}/${totalPages} (range ${pageStart + 1}-${pageEndExclusive})`,
						meta: {
							page_index: i,
							page_start: pageStart,
							page_end: pageEndExclusive,
							total_pages: totalPages,
						},
					});
				}
			} catch (err) {
				console.warn(
					`[extract_visuals] Persist failed doc=${docId} page=${i}: ${
						err instanceof Error ? err.message : String(err)
					}`
				);
			}
			await yieldToEventLoop();
		}

		console.log(
			JSON.stringify({
				event: "VISUAL_IMAGE_URI_DIAG",
				document_id: docId,
				doc_kind: docKind,
				page_count: docPageCount,
				rendered_pages_found: uris.length,
				persisted_assets: docPersisted,
				persisted_with_image_uri: docPersistedWithImageUri,
				backfilled_image_uri: docBackfilled,
			})
		);
	}

	const jobCounters = {
		docs_total: docsTotal,
		docs_ready: targetDocumentIds.length,
		docs_processed: docsProcessed,
		pages_skipped_existing: pagesSkippedExisting,
		docs_blocked_pending: docsBlockedPending,
		docs_missing_original_bytes: docsMissingOriginalBytes,
		docs_missing_page_images: docsMissingPageImages,
		docs_rendered_via_pdf: docsRenderedViaPdf,
		docs_rendered_via_libreoffice: docsRenderedViaLibreoffice,
		docs_synthetic_assets_used: docsSyntheticAssetsUsed,
		docs_pdf_text_region_assets_used: docsPdfTextRegionAssetsUsed,
		docs_excel_skipped_vision: docsExcelSkippedVision,
		docs_excel_py_assets_used: docsExcelPyAssetsUsed,
		image_uri_backfilled: imageUrisBackfilled,
	};

	if (docsProcessed === 0) {
		const diag = {
			docs_targeted: targetDocumentIds.length,
			docs_skipped: docsSkipped,
			docs_blocked: docsBlocked,
			page_count_missing: docsHadPageCountMissing,
			original_bytes_missing: docsMissingOriginalBytes,
			page_images_missing: docsMissingPageImages,
			original_file_tables_ok: originalFileTablesOk,
			missing_original_bytes_doc_ids: docsMissingOriginalBytesIds.slice(0, 5),
			missing_page_images_doc_ids: docsMissingPageImagesIds.slice(0, 5),
			job_counters: jobCounters,
		};
		await updateJob(
			job,
			"failed",
			`No page images available for visual extraction. Diagnostics: ${JSON.stringify(diag)}. Fix: if original_file_tables_ok=false, run migration infra/migrations/2025-12-22-002-add-document-original-files.sql and re-ingest. If original_bytes_missing>0, re-upload/re-ingest so document_files is populated. Otherwise ensure rendered pages exist under UPLOAD_DIR (uploads/rendered_pages/<documentId>/page_000.png, etc).`,
			100
		);
		devLog("worker_extract_visuals_finish", {
			job_id: job.id ? String(job.id) : null,
			deal_id: dealId ?? null,
			guard_triggered: false,
			status: "failed",
			...jobCounters,
		});
		return { ok: false, persisted, docs_processed: docsProcessed, docs_skipped: docsSkipped, job_counters: jobCounters };
	}

	const finalStatus = docsBlocked > 0 ? "succeeded_with_warnings" : "succeeded";
	const finalMessage =
		docsBlocked > 0
			? `Visual extraction succeeded with warnings (blocked=${docsBlocked}, processed=${docsProcessed}, skipped=${docsSkipped}, pages_skipped_existing=${pagesSkippedExisting}) counters=${JSON.stringify(jobCounters)}`
			: `Visual extraction complete (persisted=${persisted}, docs_processed=${docsProcessed}, docs_skipped=${docsSkipped}, pages_skipped_existing=${pagesSkippedExisting}) counters=${JSON.stringify(jobCounters)}`;

	let dealIdForAudit: string | null = dealId ?? null;
	if (!dealIdForAudit) {
		try {
			const { rows } = await pool.query<{ deal_id: string | null }>(
				"SELECT deal_id FROM documents WHERE id = $1",
				[targetDocumentIds[0]]
			);
			dealIdForAudit = rows?.[0]?.deal_id ?? null;
		} catch {
			dealIdForAudit = null;
		}
	}

	let visualQualityAudit: any = null;
	if (dealIdForAudit) {
		try {
			visualQualityAudit = await computeVisualQualityAuditForDeal(pool as any, dealIdForAudit);
		} catch (err) {
			console.warn(
				`[extract_visuals] visual quality audit failed deal=${dealIdForAudit}: ${err instanceof Error ? err.message : String(err)}`
			);
			visualQualityAudit = null;
		}
	}

	await updateJob(job, finalStatus, finalMessage, 100);
	await emitJobProgress(job, {
		job_id: job.id ? String(job.id) : "",
		deal_id: dealId ?? undefined,
		stage: "finalize",
		percent: 100,
		message: docsBlocked > 0
			? `Visual extraction succeeded with warnings (blocked=${docsBlocked}, processed=${docsProcessed})`
			: `Visual extraction complete (persisted=${persisted}, docs_processed=${docsProcessed}, docs_skipped=${docsSkipped})`,
		reason: docsBlocked > 0 ? "INGEST_NOT_COMPLETE" : undefined,
		meta: {
			...jobCounters,
			docs_blocked: docsBlocked,
			blocked_document_ids: blockedDocs.map((d) => d.document_id),
			...(visualQualityAudit ? { visual_quality_audit: visualQualityAudit } : {}),
			...(docsMissingPageImagesIds.length > 0
				? { docs_missing_page_images_doc_ids: docsMissingPageImagesIds.slice(0, 50) }
				: {}),
			...(docsMissingOriginalBytesIds.length > 0
				? { docs_missing_original_bytes_doc_ids: docsMissingOriginalBytesIds.slice(0, 50) }
				: {}),
		},
	});

	// Optional follow-up: enqueue a deep scan pass to force vision-understanding hints.
	// This is intentionally best-effort and should never block the quick extraction.
	if (enqueueDeepScan && dealId && (finalStatus === "succeeded" || finalStatus === "succeeded_with_warnings")) {
		try {
			const deepScanQueue = getQueue("deep_scan_visuals");
			await deepScanQueue.add(
				"deep_scan_visuals",
				{ deal_id: dealId, parent_job_id: job.id ? String(job.id) : null },
				{ removeOnComplete: true, removeOnFail: false, delay: 500 }
			);
		} catch (err) {
			console.warn(
				`[extract_visuals] deep scan enqueue failed deal=${dealId}: ${err instanceof Error ? err.message : String(err)}`
			);
		}
	}
	devLog("worker_extract_visuals_finish", {
		job_id: job.id ? String(job.id) : null,
		deal_id: dealId ?? null,
		guard_triggered: false,
		status: finalStatus,
		...jobCounters,
	});
	return {
		ok: true,
		persisted,
		docs_processed: docsProcessed,
		docs_skipped: docsSkipped,
		job_counters: jobCounters,
		status: finalStatus,
		docs_blocked: docsBlocked,
		blocked_document_ids: blockedDocs.map((d) => d.document_id),
		docs_ready: targetDocumentIds.length,
		docs_total: docsTotal,
	};
});

registerWorker("deep_scan_visuals", async (job: Job) => {
	const data = (job.data ?? {}) as {
		deal_id?: string;
		document_ids?: string[];
		force_refresh?: boolean;
		parent_job_id?: string | null;
		page_start?: number;
		page_end?: number;
	};
	const dealId = typeof data.deal_id === "string" ? data.deal_id : undefined;
	const explicitDocumentIds = Array.isArray(data.document_ids)
		? data.document_ids.filter((id) => typeof id === "string" && id.trim().length > 0)
		: [];
	const forceRefresh = Boolean((data as any).force_refresh);
	const pageStartRaw = (data as any).page_start;
	const pageEndRaw = (data as any).page_end;
	const isChunkJob = pageStartRaw != null || pageEndRaw != null;
	const requestedPageStart =
		typeof pageStartRaw === "number" && Number.isFinite(pageStartRaw) ? Math.max(0, Math.floor(pageStartRaw)) : 0;
	const requestedPageEnd =
		typeof pageEndRaw === "number" && Number.isFinite(pageEndRaw) ? Math.max(0, Math.floor(pageEndRaw)) : undefined;

	if (!dealId) {
		await updateJob(job, "failed", "Missing deal_id", 100);
		return { ok: false, reason: "missing_deal_id" };
	}

	const config = getVisionExtractorConfig();
	if (!config.enabled) {
		await updateJob(
			job,
			"failed",
			"Visual extraction is disabled in the worker (set ENABLE_VISUAL_EXTRACTION=1)",
			100
		);
		return { ok: false, skipped: true, reason: "disabled" };
	}

	const pool = getPool();
	const tablesOk = (await hasTable(pool, "visual_assets")) && (await hasTable(pool, "visual_extractions"));
	if (!tablesOk) {
		await updateJob(job, "failed", "Visual tables missing (run DB migrations)", 100);
		return { ok: false, skipped: true, reason: "tables_missing" };
	}

	await updateJob(job, "running", "Deep scan started", 1);
	await emitJobProgress(job, {
		job_id: job.id ? String(job.id) : "",
		deal_id: dealId,
		stage: "deep_scan_visuals",
		percent: 1,
		message: "Deep scan started",
		meta: { force_refresh: forceRefresh, parent_job_id: (data as any).parent_job_id ?? null },
	});
	logMemory("deep_scan_visuals:job_start", {
		job_id: job.id ? String(job.id) : null,
		deal_id: dealId,
		chunk: isChunkJob ? { page_start: requestedPageStart, page_end: requestedPageEnd ?? null } : null,
	});

	let targetDocumentIds: string[] = [];
	if (explicitDocumentIds.length > 0) {
		targetDocumentIds = explicitDocumentIds;
	} else {
		try {
			const docs = await getDocumentsForDeal(dealId);
			targetDocumentIds = docs
				.map((d: any) => d.document_id)
				.filter((id: any) => typeof id === "string" && id.length > 0);
		} catch (err) {
			await updateJob(job, "failed", err instanceof Error ? err.message : "Failed to load deal documents", 100);
			return { ok: false };
		}
	}

	if (targetDocumentIds.length === 0) {
		await updateJob(job, "failed", "No documents found for deal", 100);
		return { ok: false, reason: "no_documents" };
	}

	const baseExtractorVersion = config.extractorVersion;
	const forceExtractorVersion = `${baseExtractorVersion}_force_vu`;

	const pageHasVisionUnderstanding = async (documentId: string, pageIndex: number): Promise<boolean> => {
		try {
			const { rows } = await pool.query(
				`
					SELECT 1
					  FROM visual_assets va
					  JOIN visual_extractions ve ON ve.visual_asset_id = va.id
					 WHERE va.document_id = $1
					   AND va.page_index = $2
					   AND ve.extractor_version = $3
					   AND (ve.structured_json->'vision_understanding_v1') IS NOT NULL
					 LIMIT 1
				`,
				[sanitizeText(documentId), pageIndex, sanitizeText(baseExtractorVersion)]
			);
			return (rows?.length ?? 0) > 0;
		} catch {
			return false;
		}
	};

	let docsProcessed = 0;
	let pagesConsidered = 0;
	let pagesSkippedExisting = 0;
	let pagesAttempted = 0;
	let pagesUpdated = 0;
	let pagesErrored = 0;
	let persistedAssets = 0;

	for (let docIndex = 0; docIndex < targetDocumentIds.length; docIndex += 1) {
		const docId = targetDocumentIds[docIndex];
		let uris: string[] = [];
		try {
			uris = await resolvePageImageUris(pool, docId, { env: process.env, logger: console });
		} catch {
			uris = [];
		}

		if (uris.length === 0) {
			docsProcessed += 1;
			continue;
		}

		const chunkSize = config.maxPages;
		const totalPages = uris.length;
		const pageStart = isChunkJob ? Math.min(requestedPageStart, Math.max(0, totalPages - 1)) : 0;
		const pageEndExclusive =
			typeof requestedPageEnd === "number"
				? Math.min(Math.max(pageStart, requestedPageEnd), totalPages)
				: Math.min(pageStart + chunkSize, totalPages);

		if (!isChunkJob && totalPages > chunkSize) {
			try {
				const parentJobId = job.id ? String(job.id) : null;
				for (let start = chunkSize; start < totalPages; start += chunkSize) {
					const end = Math.min(start + chunkSize, totalPages);
					await enqueuePersistedJob({
						type: "deep_scan_visuals",
						deal_id: dealId,
						document_id: docId,
						parent_job_id: parentJobId,
						page_start: start,
						page_end: end,
						payload: {
							deal_id: dealId,
							document_ids: [docId],
							force_refresh: forceRefresh,
							parent_job_id: parentJobId,
						},
					});
				}
				console.log(
					JSON.stringify({
						event: "DEEP_SCAN_VISUALS_CHUNK_ENQUEUED",
						document_id: docId,
						total_pages: totalPages,
						chunk_size: chunkSize,
						chunks_enqueued: Math.ceil(totalPages / chunkSize) - 1,
					})
				);
			} catch (err) {
				console.warn(
					`[deep_scan_visuals] failed to enqueue chunk jobs doc=${docId}: ${err instanceof Error ? err.message : String(err)}`
				);
			}
		}

		const pagesInJob = Math.max(0, pageEndExclusive - pageStart);
		await updateJobProgress(job, {
			status: "running" as any,
			stage: "deep_scan_visuals",
			current: 0,
			total: pagesInJob,
			message: `Deep scanning visuals (${pagesInJob} page(s))`,
			page_start: pageStart,
			page_end: pageEndExclusive,
			meta: {
				document_id: docId,
				total_pages: totalPages,
				range: { start: pageStart, end: pageEndExclusive },
			},
		});

		for (let pageIndex = pageStart; pageIndex < pageEndExclusive; pageIndex += 1) {
			pagesConsidered += 1;
			const image_uri = uris[pageIndex];
			if (!forceRefresh) {
				const hasVu = await pageHasVisionUnderstanding(docId, pageIndex);
				if (hasVu) {
					pagesSkippedExisting += 1;
					continue;
				}
			}

			pagesAttempted += 1;
			const pct = Math.min(
				98,
				Math.round(((pagesAttempted / Math.max(1, targetDocumentIds.length * config.maxPages)) * 95) + 3)
			);
			if (pagesAttempted % 10 === 1) {
				await updateJob(job, "running", `Deep scanning visuals (${pagesAttempted} pages)`, pct);
				await emitJobProgress(job, {
					job_id: job.id ? String(job.id) : "",
					deal_id: dealId,
					document_id: docId,
					stage: "deep_scan_visuals",
					percent: pct,
					message: `Deep scanning visuals (${pagesAttempted} pages)`,
					meta: {
						pages_considered: pagesConsidered,
						pages_attempted: pagesAttempted,
						pages_updated: pagesUpdated,
						pages_skipped_existing: pagesSkippedExisting,
						pages_errored: pagesErrored,
					},
				});
			}

			const image_b64 = await tryReadImageB64ForVision(image_uri, process.env);
			const safe_image_uri =
				image_b64 && (image_uri.startsWith("http://") || image_uri.startsWith("https://"))
					? undefined
					: image_uri;
			let response = await callVisionWorker(config, {
				document_id: docId,
				page_index: pageIndex,
				image_uri: safe_image_uri,
				image_b64: image_b64 ?? undefined,
				extractor_version: forceExtractorVersion,
			});

			if (!response || !Array.isArray((response as any).assets) || response.assets.length === 0) {
				pagesErrored += 1;
				continue;
			}

			// Persist results into the canonical extractor version so the API/UI sees it.
			(response as any).extractor_version = baseExtractorVersion;

			try {
				const { persisted } = await persistVisionResponse(pool, response, { pageImageUri: image_uri });
				persistedAssets += persisted;
				pagesUpdated += 1;
				await updateJobProgress(job, {
					stage: "deep_scan_visuals",
					current: Math.min(pagesInJob, (pageIndex - pageStart) + 1),
					total: pagesInJob,
					message: `Deep scanned page ${pageIndex + 1}/${totalPages}`,
					page_start: pageStart,
					page_end: pageEndExclusive,
					meta: { document_id: docId, page_index: pageIndex, range: { start: pageStart, end: pageEndExclusive } },
				});
				if ((pageIndex - pageStart) % 2 === 0) {
					logMemory("deep_scan_visuals:page_persisted", {
						document_id: docId,
						page_index: pageIndex,
						persisted_assets: persisted,
						page_range: { start: pageStart, end: pageEndExclusive },
					});
				}
			} catch {
				pagesErrored += 1;
			}
			await yieldToEventLoop();
		}

		docsProcessed += 1;
	}

	// Build summary stats (what a dashboard can display without custom tables).
	let pagesWithVu = 0;
	let pagesTotal = 0;
	let assetTypeCounts: Record<string, number> = {};
	try {
		const pagesRes = await pool.query<{
			pages_total: number;
			pages_with_vu: number;
		}>(
			`
				SELECT
					COUNT(DISTINCT (va.document_id, va.page_index))::int AS pages_total,
					COUNT(DISTINCT (CASE WHEN (ve.structured_json->'vision_understanding_v1') IS NOT NULL THEN (va.document_id, va.page_index) END))::int AS pages_with_vu
				  FROM visual_assets va
				  JOIN visual_extractions ve ON ve.visual_asset_id = va.id
				  JOIN documents d ON d.id = va.document_id
				 WHERE d.deal_id = $1
				   AND ve.extractor_version = $2
			`,
			[sanitizeText(dealId), sanitizeText(baseExtractorVersion)]
		);
		pagesTotal = pagesRes.rows?.[0]?.pages_total ?? 0;
		pagesWithVu = pagesRes.rows?.[0]?.pages_with_vu ?? 0;
	} catch {
		// ignore
	}
	try {
		const byType = await pool.query<{ asset_type: string; count: string }>(
			`
				SELECT va.asset_type, COUNT(*)::text AS count
				  FROM visual_assets va
				  JOIN documents d ON d.id = va.document_id
				 WHERE d.deal_id = $1
				   AND va.extractor_version = $2
				 GROUP BY va.asset_type
			`,
			[sanitizeText(dealId), sanitizeText(baseExtractorVersion)]
		);
		assetTypeCounts = Object.fromEntries(
			(byType.rows ?? []).map((r) => [r.asset_type, Number.parseInt(String(r.count), 10) || 0])
		);
	} catch {
		assetTypeCounts = {};
	}

	const summary = {
		deal_id: dealId,
		extractor_version: baseExtractorVersion,
		docs_total: targetDocumentIds.length,
		docs_processed: docsProcessed,
		pages_total: pagesTotal,
		pages_with_vision_understanding_v1: pagesWithVu,
		pages_considered: pagesConsidered,
		pages_attempted: pagesAttempted,
		pages_updated: pagesUpdated,
		pages_skipped_existing: pagesSkippedExisting,
		pages_errored: pagesErrored,
		persisted_assets: persistedAssets,
		asset_type_counts: assetTypeCounts,
	};

	await updateJob(job, "succeeded", `Deep scan complete (pages_updated=${pagesUpdated}, pages_errored=${pagesErrored})`, 100);
	await emitJobProgress(job, {
		job_id: job.id ? String(job.id) : "",
		deal_id: dealId,
		stage: "finalize",
		percent: 100,
		message: "Deep scan complete",
		meta: summary,
	});

	return { ok: true, summary };
});
registerWorker("fetch_evidence", async (job: Job) => {
	const dealId = (job.data as { deal_id?: string } | undefined)?.deal_id;
	const filter = (job.data as { filter?: string } | undefined)?.filter;
	if (!dealId) {
		await updateJob(job, "failed", "Missing deal_id for evidence fetch");
		return { ok: false };
	}

	try {
		await updateJob(job, "running", "Fetching evidence", 5);
		// Also rebuild extraction evidence from stored structured_data so the UI shows
		// metric values/context (not just keys like numeric_value).
		const docsForAnalysis = await getDocumentsForDealWithAnalysis(dealId);
		if (docsForAnalysis.length === 0) {
			await updateJob(job, "succeeded", "No documents available for evidence");
			return { inserted: 0 };
		}

		// Important: wipe all existing extraction evidence for this deal before rebuilding.
		// This removes stale/orphaned rows (e.g. evidence tied to documents that were deleted)
		// and prevents legacy metrics like plain `numeric_value` from lingering.
		await deleteExtractionEvidenceForDeal({ dealId });

		let rebuilt = 0;
		for (const doc of docsForAnalysis) {
			const structured = (doc.structured_data && typeof doc.structured_data === "object")
				? (doc.structured_data as any)
				: null;
			if (!structured) continue;

			// Defensive: deal-level delete above should already remove these, but keep the
			// per-document delete as a safeguard if this code is reused elsewhere.
			await deleteExtractionEvidenceForDocument({ documentId: doc.id });

			// Metrics
			const metrics = Array.isArray(structured?.keyMetrics) ? structured.keyMetrics : [];
			for (const metric of metrics) {
				const key = typeof metric?.key === "string" ? String(metric.key) : "metric";
				const rawValue = metric?.value;
				const value = typeof rawValue === "string"
					? rawValue
					: typeof rawValue === "number"
						? String(rawValue)
						: rawValue == null
							? ""
							: JSON.stringify(rawValue);
				const context = typeof metric?.source === "string" ? String(metric.source) : "";
				const isNumericValue = key.trim().toLowerCase() === "numeric_value";
				const label = isNumericValue ? "extracted_number" : key;
				const textParts = [`${label}${value ? `: ${value}` : ""}`];
				if (context) textParts.push(`source: ${context}`);
				await insertEvidence({
					deal_id: dealId,
					document_id: doc.id,
					source: "extraction",
					kind: "metric",
					text: textParts.join(" • "),
					confidence: 0.8,
				});
			}

			// Sections/headings
			const headings = Array.isArray(structured?.mainHeadings) ? structured.mainHeadings : [];
			for (const heading of headings) {
				if (typeof heading !== "string" || !heading.trim()) continue;
				await insertEvidence({
					deal_id: dealId,
					document_id: doc.id,
					source: "extraction",
					kind: "section",
					text: heading,
					confidence: 0.9,
				});
			}

			// Summary
			if (typeof structured?.textSummary === "string" && structured.textSummary.trim()) {
				await insertEvidence({
					deal_id: dealId,
					document_id: doc.id,
					source: "extraction",
					kind: "summary",
					text: structured.textSummary,
					confidence: 0.85,
				});
			}

			rebuilt += 1;
		}

		await updateJob(job, "running", `Rebuilt extraction evidence (docs=${rebuilt})`, 40);

		// Optionally materialize Phase B visual evidence into the canonical evidence table
		// so it appears on the Evidence tab (and becomes resolvable via /evidence/resolve).
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
			console.warn(
				JSON.stringify({
					event: "phaseb_visual_evidence_materialization_failed",
					deal_id: dealId,
					reason: err instanceof Error ? err.message : String(err),
				})
			);
		}

		const documents = docsForAnalysis.map((d) => ({
			document_id: d.id,
			deal_id: d.deal_id,
			title: d.title,
			type: d.type,
			status: d.status,
			uploaded_at: d.uploaded_at,
			updated_at: d.updated_at,
		}));

		const existingDocIds = await getEvidenceDocumentIds(dealId);
		const drafts = deriveEvidenceDrafts(documents, { filter, excludeDocumentIds: existingDocIds });
		let inserted = 0;

		for (const draft of drafts) {
			await insertEvidence({
				deal_id: dealId,
				document_id: draft.document_id,
				source: draft.source,
				kind: draft.kind,
				text: draft.text,
				confidence: 0.7,
			});
			inserted += 1;
		}

		const message = inserted === 0
			? `No new fetch_evidence items created (rebuilt extraction evidence for ${rebuilt} doc(s))`
			: `Created ${inserted} fetch_evidence item(s) (rebuilt extraction evidence for ${rebuilt} doc(s))`;
		await updateJob(job, "succeeded", message, 100);
		console.log(`[fetch_evidence] deal=${dealId} inserted=${inserted} rebuilt=${rebuilt} filter=${filter ?? ""}`);
		return { inserted };
	} catch (err) {
		const message = err instanceof Error ? err.message : "Failed to fetch evidence";
		await updateJob(job, "failed", message);
		throw err;
	}
});
registerWorker("analyze_deal", async (job: Job) => {
	const dealId =
		(job.data as { deal_id?: string } | undefined)?.deal_id ??
		(await getDealIdForJob(job));
	if (!dealId) {
		await updateJob(job, "failed", "Missing deal_id for analysis", 100);
		return { ok: false };
	}

	try {
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
				...(minimalFullContent ? { full_content: minimalFullContent } : {}),
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
		const phase1_deal_overview_v2 = buildPhase1DealOverviewV2({
			nowIso,
			documents: phase1Documents,
		});
		const phase1_business_archetype_v1 = buildPhase1BusinessArchetypeV1({
			nowIso,
			documents: phase1Documents,
		});

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
			const dealName =
				(typeof (previousDio as any)?.deal?.name === "string" ? (previousDio as any).deal.name : undefined) ??
				(typeof phase1_deal_overview_v2.deal_name === "string" ? phase1_deal_overview_v2.deal_name : undefined) ??
				null;
			const synthesized = await generateDealSummaryV2FromPhase1({
				nowIso,
				dealId,
				dealName,
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

		const result = await orchestrator.analyze({
			deal_id: dealId,
			analysis_cycle: 1,
			input_data: {
				documents: documentsForAnalyzers,
				dio_context,
				phase1_deal_overview_v2,
				phase1_business_archetype_v1,
				phase1_update_report_v1,
				phase1_deal_summary_v2,
				llm_calls,
			},
		});

		if (!result.success || !result.storage_result) {
			await updateJob(job, "failed", result.error || "Analysis failed", 100);
			return { ok: false, error: result.error || "Analysis failed" };
		}

		const overallScore = (result.dio as any)?.overall_score
			?? (result.dio as any)?.score_explanation?.totals?.overall_score
			?? null;

		await updateJob(
			job,
			"succeeded",
			`Analysis complete (version=${result.storage_result.version}${result.storage_result.is_duplicate ? ", refreshed" : ""})`,
			100
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
});

registerWorker("orchestration", async (job: Job) => {
	const data = (job.data ?? {}) as Record<string, unknown>;
	const dealId = typeof data.deal_id === "string" ? data.deal_id : undefined;
	const leafQueues: Array<Parameters<typeof getQueue>[0]> = [
		"ingest_documents",
		"extract_visuals",
		"fetch_evidence",
		"analyze_deal",
		"verify_documents",
		"remediate_extraction",
		"reextract_documents",
	];

	const resolveTargetQueue = (): Parameters<typeof getQueue>[0] | null => {
		switch (job.name) {
			case "analyze-deal":
			case "run-pipeline":
				return "analyze_deal";
			default: {
				const explicit = typeof (data as any).target_queue === "string" ? (data as any).target_queue : null;
				return leafQueues.includes(explicit as any) ? (explicit as Parameters<typeof getQueue>[0]) : null;
			}
		}
	};

	const targetQueue = resolveTargetQueue();
	if (!targetQueue) {
		console.warn(
			JSON.stringify({
				event: "orchestration_unhandled_job",
				job_id: job.id,
				job_name: job.name,
				deal_id: dealId ?? null,
				reason: "unsupported_job_name",
			})
		);
		return { ok: false, reason: "unsupported_job_name" };
	}

	const queue = getQueue(targetQueue);
	console.log(
		JSON.stringify({
			event: "orchestration_dispatch",
			job_id: job.id,
			job_name: job.name,
			deal_id: dealId ?? null,
			target_queue: targetQueue,
		})
	);

	const forwarded = await queue.add(targetQueue, { ...data }, {
		removeOnComplete: true,
		removeOnFail: false,
	});

	console.log(
		JSON.stringify({
			event: "orchestration_forwarded",
			job_id: job.id,
			job_name: job.name,
			forwarded_job_id: forwarded.id,
			forwarded_queue: targetQueue,
			deal_id: dealId ?? null,
		})
	);

	return { ok: true, forwarded_job_id: forwarded.id, forwarded_queue: targetQueue };
});

/**
 * Verification job: Runs after extraction to verify data quality and readiness
 */
registerWorker("verify_documents", async (job: Job) => {
	const dealId = (job.data as { deal_id?: string } | undefined)?.deal_id;
	const documentIds = (job.data as { document_ids?: string[] } | undefined)?.document_ids;

	if (!dealId || !documentIds || documentIds.length === 0) {
		await updateJob(job, "failed", "Missing deal_id or document_ids");
		return { ok: false };
	}

	try {
		await updateJob(job, "running", `Verifying ${documentIds.length} document(s)...`, 10);

		const pool = getPool();
		const documents = await getDocumentsByIds(documentIds);

		if (documents.length === 0) {
			await updateJob(job, "failed", "Documents not found");
			return { ok: false };
		}

		const verificationResults: Record<string, VerificationResult> = {};
		let passCount = 0;
		let warnCount = 0;
		let failCount = 0;

		// Verify each document
		for (let i = 0; i < documents.length; i++) {
			const doc = documents[i];
			const progressPct = Math.round((i / documents.length) * 80) + 10;

			try {
				// Get the structured analysis data
				const structuredData = (doc.structured_data as Partial<DocumentAnalysis["structuredData"]> | null) ?? {};
				const analysis: DocumentAnalysis = {
					documentId: doc.id,
					dealId: doc.deal_id,
					fileType: "unknown",
					fileName: doc.title,
					extractedAt: new Date(doc.updated_at || doc.uploaded_at).toISOString(),
					contentType: "unknown",
					content: (doc.full_content as ExtractedContent | null) ?? null,
					metadata: {
						fileSizeBytes: 0,
						processingTimeMs: 0,
						extractionSuccess: doc.status === "completed",
						errorMessage: undefined,
					},
					structuredData: {
						keyFinancialMetrics: structuredData.keyFinancialMetrics,
						keyMetrics: structuredData.keyMetrics ?? [],
						mainHeadings: structuredData.mainHeadings ?? [],
						textSummary: structuredData.textSummary ?? "",
						entities: structuredData.entities ?? [],
					},
				};

				const verificationResult = verifyDocumentExtraction({
					analysis,
					fullText: doc.full_text ?? undefined,
					pageCount: doc.page_count || 0,
					extractionMetadata: doc.extraction_metadata,
				});

				verificationResults[doc.id] = verificationResult;

				// Determine status based on overall score
				const verificationStatus = verificationResult.overall_score >= 0.8
					? "verified"
					: verificationResult.overall_score >= 0.5
					? "warnings"
					: "failed";

				if (verificationStatus === "verified") passCount++;
				else if (verificationStatus === "warnings") warnCount++;
				else failCount++;

				// Update document with verification result
				await updateDocumentVerification({
					documentId: doc.id,
					verificationStatus,
					verificationResult,
					readyForAnalysisAt: verificationStatus === "verified" ? new Date() : undefined,
				});

				// Mark as ready if verified
				if (verificationStatus === "verified") {
					await updateDocumentStatus(doc.id, "ready_for_analysis");
				}

				await updateJob(
					job,
					"running",
					`Verified ${doc.title} (score: ${(verificationResult.overall_score * 100).toFixed(0)}%)`,
					progressPct
				);
			} catch (err) {
				console.error(`[verify_documents] error verifying ${doc.id}:`, err);
				await updateDocumentVerification({
					documentId: doc.id,
					verificationStatus: "failed",
					verificationResult: {
						error: err instanceof Error ? err.message : "Unknown error",
					},
				});
				failCount++;
			}
		}

		const message = `Verification complete: ${passCount} verified, ${warnCount} warnings, ${failCount} failed`;
		await updateJob(job, "succeeded", message, 100);
		console.log(`[verify_documents] deal=${dealId} ${message}`);

		return { ok: true, passCount, warnCount, failCount, verificationResults };
	} catch (err) {
		const message = err instanceof Error ? err.message : "Verification failed";
		await updateJob(job, "failed", message);
		console.error(`[verify_documents] error:`, err);
		throw err;
	}
});

/**
 * Remediation job: Canonicalizes extracted data to eliminate common artifacts
 * while preserving raw extraction fields (full_text/full_content) in the DB.
 *
 * Important constraint: we cannot re-extract from the original binary unless the
 * original file bytes are available (they are only present at upload time).
 */
registerWorker("remediate_extraction", async (job: Job) => {
	const dealId = (job.data as { deal_id?: string } | undefined)?.deal_id;
	const includeWarnings = Boolean((job.data as { include_warnings?: boolean } | undefined)?.include_warnings);

	if (!dealId) {
		await updateJob(job, "failed", "Missing deal_id");
		return { ok: false };
	}

	try {
		await updateJob(job, "running", "Scanning documents needing remediation", 5);
		const documents = await getDocumentsForDealWithVerification(dealId);
		if (documents.length === 0) {
			await updateJob(job, "succeeded", "No documents found", 100);
			return { ok: true, remediated: 0 };
		}

		const candidates = documents.filter((d) => {
			if (d.status !== "completed" && d.status !== "ready_for_analysis") return false;
			if (d.verification_status === "failed") return true;
			if (includeWarnings && d.verification_status === "warnings") return true;
			// If never verified but has extracted content, allow remediation only when includeWarnings.
			if (includeWarnings && (d.verification_status == null)) return true;
			return false;
		});

		if (candidates.length === 0) {
			await updateJob(job, "succeeded", "No documents matched remediation criteria", 100);
			return { ok: true, remediated: 0 };
		}

		await updateJob(job, "running", `Remediating ${candidates.length} document(s)`, 10);

		let remediated = 0;
		let verifiedAfter = 0;
		let warningsAfter = 0;
		let failedAfter = 0;

		for (let i = 0; i < candidates.length; i++) {
			const doc = candidates[i];
			const progressPct = Math.round((i / candidates.length) * 80) + 10;

			await insertDocumentExtractionAudit({
				documentId: doc.id,
				dealId: doc.deal_id,
				structuredData: doc.structured_data ?? null,
				extractionMetadata: doc.extraction_metadata ?? null,
				fullContent: doc.full_content ?? null,
				fullText: doc.full_text ?? null,
				verificationStatus: doc.verification_status ?? null,
				verificationResult: doc.verification_result ?? null,
				reason: "remediate_extraction",
				triggeredByJobId: job.id?.toString(),
			});

			const structuredData = (doc.structured_data as Partial<DocumentAnalysis["structuredData"]> | null) ?? {
				keyMetrics: [],
				mainHeadings: [],
				textSummary: "",
				entities: [],
			};

			const remediation = remediateStructuredData({
				structuredData: {
					keyFinancialMetrics: structuredData.keyFinancialMetrics,
					keyMetrics: structuredData.keyMetrics ?? [],
					mainHeadings: structuredData.mainHeadings ?? [],
					textSummary: structuredData.textSummary ?? "",
					entities: structuredData.entities ?? [],
				},
				fullText: doc.full_text,
			});

			// Preserve raw fields; only update canonical structured_data + metadata.
			const prevMeta = (doc.extraction_metadata && typeof doc.extraction_metadata === "object")
				? (doc.extraction_metadata as Record<string, unknown>)
				: {};
			const history = Array.isArray((prevMeta as any).remediation_history)
				? ([...(prevMeta as any).remediation_history] as unknown[])
				: [];
			history.push({
				at: new Date().toISOString(),
				type: "canonicalize_structured_data",
				changes: remediation.changes,
			});

			const nextMeta = {
				...prevMeta,
				remediation_history: history,
			};

			await updateDocumentAnalysis({
				documentId: doc.id,
				structuredData: remediation.structuredData,
				extractionMetadata: nextMeta,
			});

			// Re-verify after remediation.
			const analysis: DocumentAnalysis = {
				documentId: doc.id,
				dealId: doc.deal_id,
				fileType: "unknown",
				fileName: doc.title,
				extractedAt: new Date(doc.updated_at || doc.uploaded_at).toISOString(),
				contentType: "unknown",
				content: (doc.full_content as ExtractedContent | null) ?? null,
				metadata: {
					fileSizeBytes: 0,
					processingTimeMs: 0,
					extractionSuccess: doc.status === "completed" || doc.status === "ready_for_analysis",
					errorMessage: undefined,
				},
				structuredData: remediation.structuredData,
			};

			const verificationResult = verifyDocumentExtraction({
				analysis,
				fullText: doc.full_text ?? undefined,
				pageCount: doc.page_count || 0,
				extractionMetadata: nextMeta,
			});

			const verificationStatus = verificationResult.overall_score >= 0.8
				? "verified"
				: verificationResult.overall_score >= 0.5
				? "warnings"
				: "failed";

			if (verificationStatus === "verified") verifiedAfter++;
			else if (verificationStatus === "warnings") warningsAfter++;
			else failedAfter++;

			await updateDocumentVerification({
				documentId: doc.id,
				verificationStatus,
				verificationResult,
				readyForAnalysisAt: verificationStatus === "verified" ? new Date() : undefined,
			});

			if (verificationStatus === "verified") {
				await updateDocumentStatus(doc.id, "ready_for_analysis");
			}

			remediated++;
			await updateJob(
				job,
				"running",
				`Remediated ${doc.title} → ${verificationStatus} (${(verificationResult.overall_score * 100).toFixed(0)}%)`,
				progressPct
			);
		}

		const message = `Remediation complete: ${remediated} processed (${verifiedAfter} verified, ${warningsAfter} warnings, ${failedAfter} failed)`;
		await updateJob(job, "succeeded", message, 100);
		return { ok: true, remediated, verifiedAfter, warningsAfter, failedAfter };
	} catch (err) {
		const message = err instanceof Error ? err.message : "Remediation failed";
		await updateJob(job, "failed", message, 100);
		throw err;
	}
});

/**
 * True re-extraction job: re-runs extraction from the persisted original file bytes.
 *
 * Selection behavior:
 * - If document_ids provided: re-extract those documents.
 * - Else: re-extract documents that are failed OR have overall_score < threshold_low.
 */
registerWorker("reextract_documents", async (job: Job) => {
	const dealId = (job.data as { deal_id?: string } | undefined)?.deal_id;
	const documentIds = (job.data as { document_ids?: string[] } | undefined)?.document_ids;
	const thresholdLow = Number((job.data as { threshold_low?: number } | undefined)?.threshold_low ?? 0.75);
	const includeWarnings = Boolean((job.data as { include_warnings?: boolean } | undefined)?.include_warnings);

	if (!dealId) {
		await updateJob(job, "failed", "Missing deal_id");
		return { ok: false };
	}

	try {
		await updateJob(job, "running", "Scanning documents for re-extraction", 5);

		const sourceDocs = Array.isArray(documentIds) && documentIds.length > 0
			? await getDocumentsByIds(documentIds)
			: await getDocumentsForDealWithVerification(dealId);
		const explicitDocIds = Array.isArray(documentIds) && documentIds.length > 0;

		const candidates = sourceDocs.filter((d) => {
			if (d.deal_id !== dealId) return false;
			// If specific document_ids were requested, always attempt re-extraction
			// (regardless of current status/verification gating).
			if (explicitDocIds) return true;
			if (d.status !== "completed" && d.status !== "ready_for_analysis") return false;
			if (d.verification_status === "failed") return true;
			if (includeWarnings && d.verification_status === "warnings") return true;
			const score = (d.verification_result as any)?.overall_score;
			if (typeof score === "number" && Number.isFinite(score) && score < thresholdLow) return true;
			return false;
		});

		if (candidates.length === 0) {
			await updateJob(job, "succeeded", "No documents matched re-extraction criteria", 100);
			return { ok: true, reextracted: 0 };
		}

		await updateJob(job, "running", `Re-extracting ${candidates.length} document(s)`, 10);
		let reextracted = 0;
		let skippedNoFile = 0;

		for (let i = 0; i < candidates.length; i++) {
			const doc = candidates[i];
			const progressPct = Math.round((i / candidates.length) * 80) + 10;

			const original = await getDocumentOriginalFile(doc.id);
			if (!original) {
				skippedNoFile += 1;
				await updateJob(
					job,
					"running",
					`Skipping ${doc.title}: no stored original file bytes`,
					progressPct
				);
				continue;
			}

			await insertDocumentExtractionAudit({
				documentId: doc.id,
				dealId: doc.deal_id,
				structuredData: doc.structured_data ?? null,
				extractionMetadata: doc.extraction_metadata ?? null,
				fullContent: doc.full_content ?? null,
				fullText: doc.full_text ?? null,
				verificationStatus: doc.verification_status ?? null,
				verificationResult: doc.verification_result ?? null,
				reason: "reextract_documents",
				triggeredByJobId: job.id?.toString(),
			});

			await updateDocumentStatus(doc.id, "processing");
			await updateJob(job, "running", `Re-extracting ${doc.title}`, progressPct);

			// Clear prior extraction evidence for this document to avoid duplicates.
			await deleteExtractionEvidenceForDocument({ documentId: doc.id });

			const buffer = original.bytes;
			const fileName = original.file_name ?? doc.title;

			const analysis: DocumentAnalysis = await processDocument(
				buffer,
				fileName,
				doc.id,
				doc.deal_id
			);

			devLog("reextract_documents.classification", {
				dealId: doc.deal_id,
				documentId: doc.id,
				fileName,
				fileExt: path.extname(fileName).toLowerCase(),
				analysisContentType: analysis.contentType,
				bufferBytes: buffer.length,
			});

			// Normalization (parity with ingest): ensure structured_data.canonical.* exists.
			const normalized = normalizeToCanonical({
				contentType: analysis.contentType,
				content: analysis.content,
				structuredData: analysis.structuredData,
			});
			analysis.structuredData = normalized.structuredData;
			const structuredDataToPersist = normalized.structuredData;
			const canonicalMetrics = (structuredDataToPersist as any)?.canonical?.financials?.canonical_metrics;
			devLog("reextract_documents.normalized", {
				dealId: doc.deal_id,
				documentId: doc.id,
				analysisContentType: analysis.contentType,
				hasCanonicalMetrics: canonicalMetrics != null,
				nonNullCanonicalMetricCount: canonicalMetrics
					? Object.values(canonicalMetrics as Record<string, unknown>).filter((v) => v != null).length
					: 0,
			});

			const decodedBytes = buffer.length;
			const completeness = computeCompleteness(analysis);
			const prevMeta = (doc.extraction_metadata && typeof doc.extraction_metadata === "object")
				? (doc.extraction_metadata as Record<string, unknown>)
				: {};
			const history = Array.isArray((prevMeta as any).reextraction_history)
				? ([...(prevMeta as any).reextraction_history] as unknown[])
				: [];
			history.push({
				at: new Date().toISOString(),
				type: "reextract_from_original",
				sha256: original.sha256,
				result: {
					contentType: analysis.contentType,
					score: completeness.score,
					reason: completeness.reason,
				},
			});

			const extractionMetadata = {
				...prevMeta,
				contentType: analysis.contentType,
				fileSizeBytes: decodedBytes,
				processingTimeMs: analysis.metadata.processingTimeMs,
				reextraction_history: history,
				completeness,
				errorMessage: analysis.metadata.errorMessage,
			};

			if (!analysis.metadata.extractionSuccess) {
				const message = analysis.metadata.errorMessage || "Re-extraction failed";
				const fullText = extractFullText(analysis.content, analysis.contentType);
				const pageCount = getPageCount(analysis.content, analysis.contentType);
				await updateDocumentAnalysis({
					documentId: doc.id,
					structuredData: structuredDataToPersist,
					extractionMetadata,
					fullContent: analysis.content,
					fullText: fullText || undefined,
					pageCount: pageCount || undefined,
				});

				if (devLogEnabled) {
					const pool = getPool();
					const { rows } = await pool.query<{ cm: unknown }>(
						"SELECT structured_data #> '{canonical,financials,canonical_metrics}' AS cm FROM documents WHERE id = $1",
						[doc.id]
					);
					devLog("reextract_documents.persist_check", {
						dealId: doc.deal_id,
						documentId: doc.id,
						hasCanonicalMetricsAfterPersist: rows?.[0]?.cm != null,
					});
				}

				// Evidence emission (parity with ingest): canonical metrics with pointers.
				for (const ev of normalized.canonicalEvidence) {
					await insertEvidence({
						deal_id: doc.deal_id,
						document_id: doc.id,
						source: "extraction",
						kind: "canonical_metric",
						text: `${ev.metric_key}: ${ev.value} • ${ev.source_pointer}`,
						confidence: 0.9,
					});
				}

				await updateDocumentStatus(doc.id, "failed");
				await updateJob(job, "running", `Failed ${doc.title}: ${message}`, progressPct);
				continue;
			}

			// Persist extracted content
			const fullText = extractFullText(analysis.content, analysis.contentType);
			const pageCount = getPageCount(analysis.content, analysis.contentType);
			await updateDocumentAnalysis({
				documentId: doc.id,
				status: "completed",
				structuredData: structuredDataToPersist,
				extractionMetadata,
				fullContent: analysis.content,
				fullText: fullText || undefined,
				pageCount: pageCount || undefined,
			});

			if (devLogEnabled) {
				const pool = getPool();
				const { rows } = await pool.query<{ cm: unknown }>(
					"SELECT structured_data #> '{canonical,financials,canonical_metrics}' AS cm FROM documents WHERE id = $1",
					[doc.id]
				);
				devLog("reextract_documents.persist_check", {
					dealId: doc.deal_id,
					documentId: doc.id,
					hasCanonicalMetricsAfterPersist: rows?.[0]?.cm != null,
				});
			}

			// Evidence emission (parity with ingest): canonical metrics with pointers.
			for (const ev of normalized.canonicalEvidence) {
				await insertEvidence({
					deal_id: doc.deal_id,
					document_id: doc.id,
					source: "extraction",
					kind: "canonical_metric",
					text: `${ev.metric_key}: ${ev.value} • ${ev.source_pointer}`,
					confidence: 0.9,
				});
			}

			// Re-insert evidence for metrics/headings/summary
			for (const metric of analysis.structuredData.keyMetrics) {
				await insertEvidence({
					deal_id: doc.deal_id,
					document_id: doc.id,
					source: "extraction",
					kind: "metric",
					text: String(metric.key),
					confidence: 0.8,
				});
			}
			for (const heading of analysis.structuredData.mainHeadings) {
				await insertEvidence({
					deal_id: doc.deal_id,
					document_id: doc.id,
					source: "extraction",
					kind: "section",
					text: heading,
					confidence: 0.9,
				});
			}
			if (analysis.structuredData.textSummary) {
				await insertEvidence({
					deal_id: doc.deal_id,
					document_id: doc.id,
					source: "extraction",
					kind: "summary",
					text: analysis.structuredData.textSummary,
					confidence: 0.85,
				});
			}

			// Re-verify after re-extraction
			const verifyQueue = getQueue("verify_documents");
			await verifyQueue.add(
				"verify_documents",
				{ deal_id: doc.deal_id, document_ids: [doc.id] },
				{ removeOnComplete: true, removeOnFail: false, delay: 500 }
			);

			reextracted += 1;
		}

		const message = `Re-extraction complete: reextracted=${reextracted}, skipped_no_file=${skippedNoFile}`;
		await updateJob(job, "succeeded", message, 100);
		console.log(`[reextract_documents] deal=${dealId} ${message}`);
		return { ok: true, reextracted, skippedNoFile };
	} catch (err) {
		const message = err instanceof Error ? err.message : "Re-extraction failed";
		await updateJob(job, "failed", message);
		console.error(`[reextract_documents] error:`, err);
		throw err;
	}
});

/**
 * Ingestion report job: Generates summary report after all docs are extracted and verified
 */
registerWorker("generate_ingestion_report", async (job: Job) => {
	const dealId = (job.data as { deal_id?: string } | undefined)?.deal_id;
	const documentIds = (job.data as { document_ids?: string[] } | undefined)?.document_ids;

	if (!dealId || !documentIds || documentIds.length === 0) {
		await updateJob(job, "failed", "Missing deal_id or document_ids");
		return { ok: false };
	}

	try {
		await updateJob(job, "running", "Generating ingestion report...", 20);

		const documents = await getDocumentsByIds(documentIds);

		const documentSummaries = documents.map(doc => {
			const structuredData = doc.structured_data as any;
			const extractionMetadata = doc.extraction_metadata as any;
			const verificationResult = doc.verification_result as VerificationResult | null;

			return {
				title: doc.title,
				type: doc.type,
				status: doc.status,
				verification_status: doc.verification_status,
				pages: doc.page_count || 0,
				file_size_bytes: extractionMetadata?.fileSizeBytes || 0,
				extraction_quality_score: (verificationResult?.overall_score ?? 0.5),
				metrics_extracted: structuredData?.keyMetrics?.length || 0,
				sections_found: structuredData?.mainHeadings?.length || 0,
				ocr_avg_confidence: verificationResult?.quality_checks?.ocr_confidence?.avg || 100,
				verification_warnings: verificationResult?.warnings || [],
			};
		});

		// Calculate overall metrics
		const totalPages = documents.reduce((sum, d) => sum + (d.page_count || 0), 0);
		const totalMetrics = documents.reduce((sum, d) => {
			const sd = d.structured_data as any;
			return sum + (sd?.keyMetrics?.length || 0);
		}, 0);
		const totalSections = documents.reduce((sum, d) => {
			const sd = d.structured_data as any;
			return sum + (sd?.mainHeadings?.length || 0);
		}, 0);
		const avgQualityScore = documents.length > 0
			? documentSummaries.reduce((sum, d) => sum + d.extraction_quality_score, 0) / documents.length
			: 0;

		// Determine overall readiness
		const verifiedCount = documents.filter(d => d.verification_status === "verified").length;
		const warningCount = documents.filter(d => d.verification_status === "warnings").length;
		const failedCount = documents.filter(d => d.verification_status === "failed").length;

		let overallReadiness: "ready" | "needs_review" | "failed" = "ready";
		let readinessDetails = "All documents verified and ready for analysis";

		if (failedCount > 0) {
			overallReadiness = "failed";
			readinessDetails = `${failedCount} document(s) failed verification. Please review and re-upload.`;
		} else if (warningCount > 0) {
			overallReadiness = "needs_review";
			readinessDetails = `${warningCount} document(s) have warnings. Review before proceeding.`;
		}

		const summary = {
			files_uploaded: documentIds.length,
			total_pages: totalPages,
			total_metrics: totalMetrics,
			total_sections: totalSections,
			avg_quality_score: avgQualityScore,
			documents: documentSummaries,
			overall_readiness: overallReadiness,
			readiness_details: readinessDetails,
			verification_summary: {
				verified: verifiedCount,
				warnings: warningCount,
				failed: failedCount,
			},
			completed_at: new Date().toISOString(),
			next_steps: overallReadiness === "ready"
				? "Proceed to deal analysis with uploaded documents"
				: "Address warnings/failures before proceeding",
		};

		const reportId = randomUUID();
		await saveIngestionReport({
			reportId,
			dealId,
			summary,
			documentIds,
		});

		// Update all documents with ingestion summary
		for (const doc of documents) {
			const pool = getPool();
			await pool.query(
				`UPDATE documents SET ingestion_summary = $2 WHERE id = $1`,
				[doc.id, summary]
			);
		}

		await updateJob(
			job,
			"succeeded",
			`Report generated: ${verifiedCount} verified, ${warningCount} warnings, ${failedCount} failed`,
			100
		);

		console.log(`[generate_ingestion_report] deal=${dealId} report_id=${reportId} readiness=${overallReadiness}`);

		return { ok: true, report_id: reportId, summary };
	} catch (err) {
		const message = err instanceof Error ? err.message : "Report generation failed";
		await updateJob(job, "failed", message);
		console.error(`[generate_ingestion_report] error:`, err);
		throw err;
	}
});


logWorkerQueueConfig("worker", Array.from(new Set(registeredWorkers)));

// One-time DB fingerprint log to confirm which Postgres instance this worker is connected to.
// Do NOT log credentials or DATABASE_URL.
// Runs after pool initialization and before the worker starts processing jobs.
void (async () => {
	try {
		const pool = getPool();
		const { rows } = await pool.query<{ db: string; ip: string | null; port: number | null }>(
			`SELECT
				current_database() AS db,
				inet_server_addr() AS ip,
				inet_server_port() AS port;`
		);
		const row = rows?.[0];
		console.log(
			JSON.stringify({
				event: "db_fingerprint",
				service: "worker",
				db: row?.db ?? null,
				ip: row?.ip ?? null,
				port: row?.port ?? null,
			})
		);
	} catch (err) {
		console.log(
			JSON.stringify({
				event: "db_fingerprint_error",
				service: "worker",
				err: err instanceof Error ? err.message : String(err),
			})
		);
	}
})();

const shutdown = async () => {
	await closePool();
	process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log("DealDecision worker started");

// Keep-alive interval to ensure process doesn't exit
setInterval(() => {
	// Just keep the process alive
}, 30000);
