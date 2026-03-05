import type { Job } from "bullmq";
import { randomUUID, createHash } from "crypto";
import path from "path";
import fs from "fs/promises";
import { execSync } from "child_process";
import type { JobProgressEventV1, JobStatus, JobStatusDetail } from "@dealdecision/contracts";
import {
	QUEUE_NAMES,
	sanitizeText,
	getDocumentCapabilities,
	getInitialRenderedPagesChunk,
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
} from "@dealdecision/core";
import { connection, createWorker, getBullmqRuntimeInfo, getQueue, logWorkerQueueConfig } from "./lib/queue";
import { evaluateVisualDocReadiness, getVisualIngestBlockReason } from "./lib/visual-readiness";
import {
	getPool,
	closePool,
	markDbShuttingDown,
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
	callVisionWorkerWithRetries,
	createVisionJobRuntime,
	enqueueExtractVisualsIfPossible,
	getVisionExtractorConfig,
	buildExtractVisualsExtractionMetadataPatchV1,
	buildExtractVisualsPageSummaryV1,
	computeExtractVisualsOutcomeStatusV1,
	shouldSkipExtractVisualsPage,
	isAuditVisionFailure,
	buildDeepScanExtractionMetadataPatch,
	buildDeepScanPageSummaryV1,
	computeDeepScanOutcomeStatus,
	hasTable,
	persistVisionResponse,
	resolvePageImageUris,
	backfillVisualAssetImageUris,
	persistSyntheticVisualAssets,
	deduceDocKind,
	resegmentStructuredSyntheticAssets,
	applyVisionHintsToStructuredPowerpointSlides,
	callXlsxWorker,
	callXlsxWorkerWithRetries,
	buildXlsxCanonicalPatch,
	computeVisionRoutingDecisionV1,
	probeImageUriFetchability,
	buildExtractVisualsFinalizedMarker,
	type ImageUriFetchDiag,
} from "./lib/visual-extraction";
import { shouldSkipExtractVisualsAfterRenderV1 } from "./lib/render-followups";
import { normalizeToCanonical } from "./lib/normalization";
import { processDocument } from "./lib/processors";
import { verifyDocumentExtraction } from "./lib/verification";
import { remediateStructuredData } from "./lib/remediation";
import { persistPdfV2TextRegionAssetsV1Shadow } from "./lib/pdf_v2/pdf-text-region-assets-v1";
import os from "os";
import { loadOriginalBytesFromDocumentStorage } from "./lib/ingest/from-storage";
import { assertProductionStorageContract, getDocumentStorageMode, getR2BucketIfEnabled, resolveR2Endpoint } from "./lib/document-storage-mode";
import { decideIngestOutcomeForError, isOcrishError } from "./lib/ingest/ocrish-error-semantics";
import { getR2ObjectUrl, r2ObjectExists, uploadToR2 } from "./lib/r2";
import { runJobWatchdogOnce } from "./lib/job-watchdog";
import { selectReextractCandidates } from "./lib/reextract-selection";
import { assertSchema } from "./lib/schema-check";
import {
	selectDocumentsForDocumentIntelligenceBatch,
	loadActiveDocumentIntelligenceJobs,
	planDocumentIntelligenceBatch,
	enqueueDocumentIntelligenceExtractJobs,
	pollJobsToTerminal,
	insertBlockedAnalyzeJob,
} from "./lib/document-intelligence-batch";
import { populateDocumentPageUnderstandingFromVisualExtractions } from "./lib/document-page-understanding";
import { promoteSlideFactsFromDocumentPageUnderstanding } from "./lib/promote-slide-facts";
import { ensureOcrFallbackForVisionResponse } from "./lib/vision-ocr-fallback";
import { finishStepRunLedger, startNamedStepRunLedger, reconcileStuckPipelineRuns } from "./lib/pipeline-run-ledger";
import { generateAndPersistGovernedLlmOverviewBestEffort } from "./lib/governed-llm-overlay";
import { computeChunkRangeForPage } from "./lib/r2-probe";
import { makeJobId } from "./lib/job-id";
import { reextractDocumentsProcessor } from "./jobs/reextract-documents";
import { documentIntelligenceExtractProcessor } from "./jobs/document-intelligence-extract";
import { populateDocumentPageUnderstandingProcessor } from "./jobs/populate-document-page-understanding";
import { generateInvestorInsightsProcessor } from "./jobs/investor-insights/processor";
import { exportReportPdfProcessor } from "./jobs/export-report-pdf/processor";
import { maybeEnqueueAnalyzeDealGuarantee } from "./lib/analyze-deal-guarantee";
import { renderDocumentPagesProcessor } from "./jobs/render-document-pages/processor";
import { fetchEvidenceProcessor } from "./jobs/fetch-evidence/processor";
import { remediateExtractionProcessor } from "./jobs/remediate-extraction/processor";
import { resolveWritableUploadDir } from "./lib/upload-dir-resolver";
import { makeDevLogger, updateJob } from "./lib/worker-utils";

// Deterministic startup instrumentation (must run at boot, before any queues are registered).
(() => {
	const ts = new Date().toISOString();
	console.log(
		JSON.stringify({
			event: "release_stamp",
			service: "worker",
			git_sha: typeof process.env.RENDER_GIT_COMMIT === "string" ? process.env.RENDER_GIT_COMMIT : null,
			ts,
		})
	);

	const visionBaseUrlRaw = process.env.VISION_BASE_URL || process.env.VISION_WORKER_URL || null;
	const visionBaseUrl = typeof visionBaseUrlRaw === "string" && visionBaseUrlRaw.trim().length > 0 ? visionBaseUrlRaw.trim() : null;
	const r2Bucket = typeof process.env.R2_BUCKET === "string" && process.env.R2_BUCKET.trim().length > 0 ? "set" : "missing";
	const storageDriverRaw = process.env.STORAGE_DRIVER;
	const storageDriver = typeof storageDriverRaw === "string" && storageDriverRaw.trim().length > 0 ? storageDriverRaw.trim() : null;
	const detRaw = typeof process.env.DETERMINISTIC_SCORE_V1_ENABLED === "string" ? process.env.DETERMINISTIC_SCORE_V1_ENABLED : "";
	const detEnabled = (() => {
		const s = detRaw.trim().toLowerCase();
		return s === "1" || s === "true" || s === "yes" || s === "on";
	})();
	console.log(
		JSON.stringify({
			event: "runtime_env_stamp",
			vision_base_url: visionBaseUrl,
			r2_bucket: r2Bucket,
			storage_driver: storageDriver,
			DETERMINISTIC_SCORE_V1_ENABLED: detEnabled,
			deterministic_score_v1_enabled_raw: detRaw.trim() || null,
		})
	);
})();

// ── Shutdown state ───────────────────────────────────────────────────────────
// Module-level guards so shutdown() is idempotent and handlers are registered
// exactly once, even if the startup path calls process.exit for schema errors.
let isShuttingDown = false;
let handlersRegistered = false;

import { computeAndPersistVisionRoutingV1 } from "./lib/vision-routing";
import { persistPdfPageUnderstandingV1Shadow } from "./lib/pdf_v2/page-understanding-v1";
import { applySlideUnderstandingV1Shadow } from "./lib/pdf_v2/slide-understanding-v1";
import { parseIngestDocumentsJobData, validateIngestDocumentsPayload } from "./lib/ingest/ingest-payload";
import { buildPhase1DealOverviewV2, buildPhase1DealUnderstandingV1, buildPhase1UpdateReportV1 } from "./lib/phase1/dealOverviewV2";
import { computeVisualQualityAuditForDeal } from "./lib/visual-quality-audit";
import { buildPhase1BusinessArchetypeV1 } from "./lib/phase1/businessArchetypeV1";
import { getVisualPageImagePersistConfig, persistRenderedPageImages, persistImagePage, renderNonPdfToPageImages, r2RenderedPageKey, formatRenderedPageKey, convertOfficeToPdfBuffer } from "./lib/rendered-pages";
import type { DocumentAnalysis, ExtractedContent } from "./lib/processors";
import type { VerificationResult } from "./lib/verification";
import { OpenAIGPT4oProvider } from "./lib/llm/providers/openai-provider";
import type { ProviderConfig } from "./lib/llm/types";
import { extractPhaseBFeaturesV1, fetchPhaseBVisualsFromDb } from "./lib/phaseb/extract";
import { materializePhaseBVisualEvidenceForDeal } from "./lib/phaseb/materialize-evidence";
import { logMemory, yieldToEventLoop } from "./lib/memory";
import { updateJobProgress, emitJobProgress } from "./lib/job-progress";
import { enqueueAnalyzeDeal } from "./lib/enqueue-analyze-deal";
import { verifyVisionServiceForJob, type VisionServiceVerification } from "./lib/vision-verification";
import { tryReadImageB64ForVision, headCheckImageUri, type HeadCheckResult } from "./lib/vision-image";
import { pickDownloadUrlFromExtractionMetadata } from "./lib/original-file-url";
import { promoteVisualOcrToDocumentFullText } from "./lib/visual-ocr-promoter";
import { enqueuePersistedJob } from "./lib/job-enqueue";
import { decideLowContentOutcome } from "./lib/ingest-low-content";
import { shouldRunOcr } from "./lib/ingest/should-run-ocr";
import { planChunkEnqueues } from "./lib/page-chunks";

// Deterministic startup log for Docker verification.
// Do not log secrets; only the explicit flag value.
console.info(
	`VISUAL_EXTRACTION_FLAG: ENABLE_VISUAL_EXTRACTION=${process.env.ENABLE_VISUAL_EXTRACTION || "(unset)"}`
);

// Log the resolved vision service URL once at startup (helps catch accidental localhost wiring in production).
const visionCfg = getVisionExtractorConfig();
console.log(
	JSON.stringify({
		event: "VISION_SERVICE_URL_RESOLVED",
		service: "worker",
		vision_base_url: visionCfg.visionWorkerUrl,
		vision_enabled: visionCfg.enabled,
		extractor_version: visionCfg.extractorVersion,
		legacy_env_vision_worker_url_set: Boolean(process.env.VISION_WORKER_URL && !process.env.VISION_BASE_URL),
	})
);
if (typeof visionCfg.visionWorkerUrl === "string" && visionCfg.visionWorkerUrl.includes("dealdecision-vision.onrender.com")) {
	console.warn(
		JSON.stringify({
			event: "VISION_SERVICE_URL_LEGACY_ORIGIN",
			service: "worker",
			message: "Vision base URL appears to be the legacy origin; verify VISION_BASE_URL is set to the v2 service.",
			vision_base_url: visionCfg.visionWorkerUrl,
		})
	);
}
if (process.env.VISION_WORKER_URL && !process.env.VISION_BASE_URL) {
	console.warn(
		JSON.stringify({
			event: "VISION_WORKER_URL_DEPRECATED",
			service: "worker",
			message: "VISION_WORKER_URL is deprecated; prefer VISION_BASE_URL",
		})
	);
}

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

const devLog = makeDevLogger();

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
type HeartbeatHandle = { stop: () => void };

function startHeartbeat(
	job: Job,
	options: {
		// Allow arbitrary stages so long-running jobs (e.g. analyze_deal) can emit
		// generic heartbeat updates without expanding the shared contract.
		stage: string;
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
				stage: options.stage as any,
				percent,
				message: msg,
				meta: { heartbeat: true },
			} as any);
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

async function ensureNeedsOcrFlowEnqueued(params: {
	documentId: string;
	dealId: string;
	reason: string;
	triggerJobId: string | null;
	parentJobId: string | null;
}) {
	const docId = params.documentId;
	const dealIdSafe = params.dealId;
	const pool = getPool();
	const nowIso = new Date().toISOString();

	let existingFlow: any = null;
	try {
		const { rows } = await pool.query<{ extraction_metadata: unknown | null }>(
			"SELECT extraction_metadata FROM documents WHERE id = $1 LIMIT 1",
			[sanitizeText(docId)]
		);
		const metaObj = rows?.[0]?.extraction_metadata && typeof rows[0].extraction_metadata === "object"
			? (rows[0].extraction_metadata as any)
			: null;
		existingFlow = metaObj?.needs_ocr_flow && typeof metaObj.needs_ocr_flow === "object" ? metaObj.needs_ocr_flow : null;
	} catch {
		existingFlow = null;
	}

	const existingState = typeof existingFlow?.state === "string" ? String(existingFlow.state).trim().toLowerCase() : "";
	if (existingState === "completed" || existingState === "reextract_enqueued") {
		return { ok: true, skipped: true, skipped_reason: "already_terminal", state: existingState };
	}

	const preserveRequestedAt = typeof existingFlow?.requested_at === "string" ? existingFlow.requested_at : nowIso;
	const triggerJobId = typeof existingFlow?.trigger_job_id === "string" ? existingFlow.trigger_job_id : params.triggerJobId;

	const diJobId =
		typeof existingFlow?.document_intelligence_job_id === "string"
			? existingFlow.document_intelligence_job_id
			: makeJobId("document_intelligence_extract", [docId, "needs_ocr_flow", "v1"]);
	const renderJobId =
		typeof existingFlow?.render_job_id === "string"
			? existingFlow.render_job_id
			: makeJobId("render_document_pages", [docId, "needs_ocr_flow", "force_ocr", "v1"]);

	// IMPORTANT: bootstrap render even when page_count is unknown/0; the render job detects page count.
	const persistCfg = { ...getVisualPageImagePersistConfig(process.env, { forceEnable: true }), enabled: true, persist: true };
	const chunkSize = Math.max(1, Math.floor(persistCfg.maxPages || 10));
	const firstEnd = chunkSize;

	// Persist/merge flow state before enqueue so crashes still leave evidence.
	await mergeDocumentExtractionMetadata({
		documentId: docId,
		patch: {
			needs_ocr_flow: {
				...(existingFlow && typeof existingFlow === "object" ? existingFlow : {}),
				state: existingState || "requested",
				reason: params.reason,
				requested_at: preserveRequestedAt,
				trigger_job_id: triggerJobId,
				document_intelligence_job_id: diJobId,
				render_job_id: renderJobId,
			},
		},
	});

	try {
		await enqueuePersistedJob({
			job_id: diJobId,
			idempotent: true,
			type: "document_intelligence_extract",
			deal_id: dealIdSafe,
			document_id: docId,
			payload: { deal_id: dealIdSafe, document_id: docId, reason: "needs_ocr_flow" },
			parent_job_id: params.parentJobId,
		});
	} catch (err) {
		console.warn(
			`[ingest_document] enqueue document_intelligence_extract failed doc=${docId}: ${
				err instanceof Error ? err.message : String(err)
			}`
		);
	}

	try {
		await enqueuePersistedJob({
			job_id: renderJobId,
			idempotent: true,
			type: "render_document_pages",
			deal_id: dealIdSafe,
			document_id: docId,
			page_start: 0,
			page_end: firstEnd,
			payload: {
				deal_id: dealIdSafe,
				document_id: docId,
				page_start: 0,
				page_end: firstEnd,
				force_ocr: true,
			},
			parent_job_id: params.parentJobId,
		});
	} catch (err) {
		console.warn(
			`[ingest_document] enqueue render_document_pages(force_ocr) failed doc=${docId}: ${
				err instanceof Error ? err.message : String(err)
			}`
		);
	}

	try {
		await mergeDocumentExtractionMetadata({
			documentId: docId,
			patch: {
				needs_ocr_flow: {
					...(existingFlow && typeof existingFlow === "object" ? existingFlow : {}),
					state: "enqueued",
					reason: params.reason,
					requested_at: preserveRequestedAt,
					enqueued_at: typeof existingFlow?.enqueued_at === "string" ? existingFlow.enqueued_at : nowIso,
					trigger_job_id: triggerJobId,
					document_intelligence_job_id: diJobId,
					render_job_id: renderJobId,
					trigger_enqueued_by_job_id: params.triggerJobId,
				},
			},
		});
	} catch {
		// best-effort
	}

	try {
		console.log(
			JSON.stringify({
				event: "OCR_ENQUEUED",
				deal_id: dealIdSafe,
				document_id: docId,
				reason: params.reason,
				render_job_id: renderJobId,
				document_intelligence_job_id: diJobId,
				page_end: firstEnd,
				ts: nowIso,
			})
		);
	} catch {
		// ignore
	}

	return { ok: true, skipped: false, render_job_id: renderJobId, document_intelligence_job_id: diJobId };
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
				const url = await pickDownloadUrlFromExtractionMetadata(meta);
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
			analysis = await processDocument(buffer, fileNameSafe, docId, dealIdSafe, {
				onPdfTextProbe: async (probe) => {
					// Persist the decision BEFORE any OCR starts, so crashes/restarts still leave evidence.
					try {
						await mergeDocumentExtractionMetadata({
							documentId: docId,
							patch: {
								needsOcr: probe.needsOcr,
								pdf_text_probe: probe,
								pageOcr: { attempted: false },
								ocrDecisionPersistedAt: probe.decided_at,
							},
						});
					} catch {
						// best-effort; never fail ingestion due to metadata persistence
					}
				},
			});
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
		const pdfSummary =
			analysis.contentType === "pdf" && analysis.content && typeof (analysis.content as any)?.summary === "object"
				? ((analysis.content as any).summary as any)
				: null;
		const pdfNeedsOcr = typeof pdfSummary?.needsOcr === "boolean" ? Boolean(pdfSummary.needsOcr) : false;
		const pdfTextProbe = pdfSummary?.textProbe ?? null;
		const pdfPageOcr = pdfSummary?.pageOcr ?? null;
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
			needsOcr: analysis.contentType === "pdf" ? pdfNeedsOcr : false,
			textProbe: analysis.contentType === "pdf" ? pdfTextProbe : null,
			pageOcr: analysis.contentType === "pdf" ? pdfPageOcr : null,
		};

		if (!analysis.metadata.extractionSuccess) {
			const message = analysis.metadata.errorMessage || "Extraction failed";
			const needsOcr =
				analysis.contentType === "pdf"
					? /no\s+text\s+extracted/i.test(message) || /even\s+after\s+ocr/i.test(message)
					: message.toLowerCase().includes("no text extracted") || message.toLowerCase().includes("image-only");
			extractionMetadata.needsOcr = needsOcr;
			const fullText = extractFullText(analysis.content, analysis.contentType);
			const pageCount = getPageCount(analysis.content, analysis.contentType);
			const fullTextAbsentReason = fullText && fullText.trim().length > 0
				? null
				: needsOcr
					? "no_text_extracted_needs_ocr"
					: "no_text_extracted";
			try {
				if (analysis.contentType === "pdf") {
					console.log(
						JSON.stringify({
							event: "PDF_TEXT_EXTRACTED",
							deal_id: dealIdSafe,
							document_id: docId,
							success: false,
							chars: typeof fullText === "string" ? fullText.length : 0,
							page_count: typeof pageCount === "number" && Number.isFinite(pageCount) ? pageCount : null,
							needs_ocr: Boolean(needsOcr),
							absent_reason: fullTextAbsentReason,
							ts: new Date().toISOString(),
						})
					);
				}
			} catch {
				// ignore
			}
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
			if (needsOcr && analysis.contentType === "pdf") {
				try {
					await ensureNeedsOcrFlowEnqueued({
						documentId: docId,
						dealId: dealIdSafe,
						reason: `failed_extract:${fullTextAbsentReason ?? "no_text"}`,
						triggerJobId: job.id ? String(job.id) : null,
						parentJobId: job.id ? String(job.id) : null,
					});
				} catch (err) {
					console.warn(
						`[ingest_document] failed-extract needs_ocr enqueue failed doc=${docId}: ${
							err instanceof Error ? err.message : String(err)
						}`
					);
				}
				await updateJob(job, "succeeded_with_warnings", message, 100);
				return { ok: false, analysis, needs_ocr: true };
			}

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
		try {
			if (analysis.contentType === "pdf") {
				console.log(
					JSON.stringify({
						event: "PDF_TEXT_EXTRACTED",
						deal_id: dealIdSafe,
						document_id: docId,
						success: true,
						chars: typeof fullText === "string" ? fullText.length : 0,
						page_count: typeof pageCount === "number" && Number.isFinite(pageCount) ? pageCount : null,
						needs_ocr: Boolean(pdfNeedsOcr),
						absent_reason: fullTextAbsentReason,
						ts: new Date().toISOString(),
					})
				);
			}
		} catch {
			// ignore
		}

		const uploadDir = await resolveWritableUploadDir(process.env);
		
		// Determine content threshold based on document type
		// Word docs (cut sheets, whitepapers) can be valid with minimal content
		// Other formats need more substantial content
		let contentThreshold = 0.5;
		if (analysis.contentType === "word") {
			contentThreshold = 0.25; // Lower threshold for Word docs
		}
		
		const lowContent = completeness.score < contentThreshold;

		if (lowContent) {
			const decision = decideLowContentOutcome({
				contentType: analysis.contentType,
				attempt,
				completenessReason: completeness.reason,
			});
			const message = decision.message;
			if (decision.kind === "needs_ocr") {
				(extractionMetadata as any).needsOcr = true;
				(extractionMetadata as any).errorMessage = null;
			} else {
				extractionMetadata.errorMessage = message;
			}

			await updateDocumentAnalysis({
				documentId: docId,
				status: decision.kind === "needs_ocr" ? "needs_ocr" : undefined,
				structuredData: analysis.structuredData,
				extractionMetadata,
				fullContent: analysis.content,
				fullText: fullText || undefined,
				fullTextAbsentReason: fullTextAbsentReason ?? undefined,
				pageCount: pageCount || undefined,
			});

			if (decision.kind === "retry") {
				await updateDocumentStatus(docId, decision.docStatus);
				await updateJob(job, decision.jobStatus, message, 100);
				console.warn(`[ingest_document] low content, requeuing attempt ${decision.nextAttempt}`);
				await enqueuePersistedJob({
					type: "ingest_documents",
					deal_id: dealIdSafe,
					document_id: docId,
					payload: { ...((job.data as any) ?? {}), attempt: decision.nextAttempt },
					parent_job_id: job.id ? String(job.id) : null,
				});
				return { ok: false, analysis, completeness };
			}

			if (decision.kind === "needs_ocr") {
				await updateDocumentStatus(docId, decision.docStatus);

				try {
					await ensureNeedsOcrFlowEnqueued({
						documentId: docId,
						dealId: dealIdSafe,
						reason: `low_content:${completeness.reason}`,
						triggerJobId: job.id ? String(job.id) : null,
						parentJobId: job.id ? String(job.id) : null,
					});
				} catch (err) {
					console.warn(
						`[ingest_document] needs_ocr_flow enqueue/setup failed doc=${docId}: ${
							err instanceof Error ? err.message : String(err)
						}`
					);
				}

				await updateJob(job, decision.jobStatus, message, 100);
				console.warn(`[ingest_document] pdf needs_ocr after low content documentId=${docId}`);
				return { ok: false, analysis, completeness };
			}

			// decision.kind === "fail"
			await updateDocumentStatus(docId, decision.docStatus);
			await updateJob(job, decision.jobStatus, message, 100);
			console.warn(`[ingest_document] low content after retries documentId=${docId}`);
			return { ok: false, analysis, completeness };
		}

		{
			let ocrPlan: ReturnType<typeof shouldRunOcr> | null = null;
			let priorNeedsOcrFlowState: string | null = null;
			if (analysis.contentType === "pdf") {
				try {
					const { rows } = await getPool().query<{ extraction_metadata: unknown | null }>(
						"SELECT extraction_metadata FROM documents WHERE id = $1 LIMIT 1",
						[sanitizeText(docId)]
					);
					const metaObj = rows?.[0]?.extraction_metadata && typeof rows[0].extraction_metadata === "object"
						? (rows[0].extraction_metadata as any)
						: null;
					const flow = metaObj?.needs_ocr_flow && typeof metaObj.needs_ocr_flow === "object" ? metaObj.needs_ocr_flow : null;
					priorNeedsOcrFlowState = typeof flow?.state === "string" ? String(flow.state) : null;
				} catch {
					priorNeedsOcrFlowState = null;
				}
				ocrPlan = shouldRunOcr({
					contentType: analysis.contentType,
					attempt,
					fullText: typeof fullText === "string" ? fullText : null,
					fullTextAbsentReason: typeof fullTextAbsentReason === "string" ? fullTextAbsentReason : null,
					textProbe: pdfTextProbe,
					pageOcr: pdfPageOcr,
					priorNeedsOcrFlowState,
					env: process.env,
				});

				try {
					console.log(
						JSON.stringify({
							event: "OCR_DECISION",
							deal_id: dealIdSafe,
							document_id: docId,
							run: ocrPlan.run,
							reason: ocrPlan.reason,
							prior_needs_ocr_flow_state: priorNeedsOcrFlowState,
							min_text_threshold_chars: ocrPlan.minTextThresholdChars,
							full_text_len: typeof fullText === "string" ? fullText.trim().length : 0,
							full_text_absent_reason: fullTextAbsentReason ?? null,
							probe_decision: typeof pdfTextProbe?.decision === "string" ? pdfTextProbe.decision : null,
							page_ocr_attempted: typeof pdfPageOcr?.attempted === "boolean" ? pdfPageOcr.attempted : null,
							quality: ocrPlan.quality ?? null,
							ts: new Date().toISOString(),
						})
					);
				} catch {
					// ignore
				}
			}

			const runOcrFlow = Boolean(ocrPlan?.run);
			if (runOcrFlow) {
				(extractionMetadata as any).needsOcr = true;
				try {
					await updateDocumentStatus(docId, "needs_ocr");
				} catch {
					// best-effort
				}
				try {
					await ensureNeedsOcrFlowEnqueued({
						documentId: docId,
						dealId: dealIdSafe,
						reason: `probe:${ocrPlan?.reason ?? "unknown"}`,
						triggerJobId: job.id ? String(job.id) : null,
						parentJobId: job.id ? String(job.id) : null,
					});
				} catch (err) {
					console.warn(
						`[ingest_document] probe-driven needs_ocr enqueue failed doc=${docId}: ${
							err instanceof Error ? err.message : String(err)
						}`
					);
				}
			}

			const finalDocStatus = runOcrFlow ? "needs_ocr" : "ready_for_analysis";
			const finalJobStatus: JobStatus = runOcrFlow ? "succeeded_with_warnings" : "succeeded";
			const finalAbsentReason =
				runOcrFlow && (!fullText || fullText.trim().length === 0) ? "no_text_extracted_needs_ocr" : fullTextAbsentReason;

			await updateDocumentAnalysis({
				documentId: docId,
				status: finalDocStatus,
				structuredData: analysis.structuredData,
				extractionMetadata,
				fullContent: analysis.content,
				fullText: fullText || undefined,
				fullTextAbsentReason: finalAbsentReason ?? undefined,
				pageCount: pageCount || undefined,
				// Mark the document as ready for downstream steps (extract_visuals, analyze_deal).
				// Only set when not entering the OCR remediation flow; COALESCE in SQL prevents
				// overwriting an existing value if ingest ran more than once.
				readyForAnalysisAt: finalDocStatus === "ready_for_analysis" ? new Date() : undefined,
			});
			await updateJob(
				job,
				finalJobStatus,
				runOcrFlow
					? `Extracted content; OCR follow-up enqueued (${ocrPlan?.reason ?? "needs_ocr"})`
					: `Extracted ${analysis.structuredData.keyMetrics.length} metrics, ${analysis.structuredData.mainHeadings.length} headings (score=${completeness.score.toFixed(2)})`,
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

			// Render page images in chunks (best-effort; does not block ingestion).
			// For Office docs (XLSX/DOCX/PPTX), render_document_pages converts to PDF via LibreOffice first.
			// For images, render_document_pages persists a single page image.
			if (
				!runOcrFlow &&
				(
					analysis.contentType === "pdf" ||
					analysis.contentType === "excel" ||
					analysis.contentType === "powerpoint" ||
					analysis.contentType === "word" ||
					analysis.contentType === "image"
				)
			) {
				try {
					const persistCfg = { ...getVisualPageImagePersistConfig(process.env, { forceEnable: true }), enabled: true, persist: true };
					const chunkSize = persistCfg.maxPages;
					const totalPages =
						analysis.contentType === "pdf"
							? (finalPageCountForLog || pageCount || 0)
							: analysis.contentType === "image"
								? 1
								: 0;
					const r2Bucket = getR2BucketIfEnabled(process.env);
					const prefix = `deals/${dealIdSafe}/documents/${docId}/rendered_pages`;
					if (r2Bucket) renderedPagesR2ForLog = { bucket: r2Bucket, prefix };
					await mergeDocumentExtractionMetadata({
						documentId: docId,
						patch: {
							...(r2Bucket ? { rendered_pages_r2: { bucket: r2Bucket, prefix, format: "page_%04d.png" } } : {}),
							// For PDFs we know total pages; for Office docs, render_document_pages will fill this in.
							rendered_pages_count: totalPages,
							rendered_pages_rendered: 0,
							rendered_pages_dir: `${(process.env.UPLOAD_DIR || "/app/uploads").trim() || "/app/uploads"}/rendered_pages/${docId}`,
							storage_mode: getDocumentStorageMode(process.env),
						},
					});

					const renderQueue = getQueue("render_document_pages");
					const firstEnd = totalPages > 0 ? Math.min(totalPages, chunkSize) : chunkSize;
					const renderJobId = makeJobId("render_document_pages", [docId, `0-${firstEnd}`]);
					console.log(
						JSON.stringify({
							event: "INGEST_ENQUEUED_RENDER_DOCUMENT_PAGES",
							deal_id: dealIdSafe,
							document_id: docId,
							job_id: renderJobId,
							page_start: 0,
							page_end: firstEnd,
							content_type: analysis.contentType,
							storage_mode: getDocumentStorageMode(process.env),
						})
					);
					await renderQueue.add(
						"render_document_pages",
						{ deal_id: dealIdSafe, document_id: docId, page_start: 0, page_end: firstEnd },
						{ jobId: renderJobId, removeOnComplete: true, removeOnFail: false, attempts: 3, backoff: { type: "exponential", delay: 1000 } }
					);
				} catch (err) {
					console.warn(
						`[ingest_document] enqueue render_document_pages failed doc=${docId}: ${
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
				);
			}

			// Queue verification job for this document
			const verifyQueue = getQueue("verify_documents");
			try {
				const verifyJobId = makeJobId("verify_documents", [docId]);
				console.log(
					JSON.stringify({
						event: "INGEST_ENQUEUED_VERIFY_DOCUMENTS",
						deal_id: dealIdSafe,
						document_id: docId,
						job_id: verifyJobId,
					})
				);
				await verifyQueue.add(
					"verify_documents",
					{
						deal_id: dealIdSafe,
						document_ids: [docId],
					},
					{
						jobId: verifyJobId,
						removeOnComplete: true,
						removeOnFail: false,
						delay: 500,
						attempts: 3,
						backoff: { type: "exponential", delay: 1000 },
					}
				);
			} catch (err) {
				// Best-effort dedupe: if a job with this ID already exists, treat as already enqueued.
				const msg = err instanceof Error ? err.message : String(err);
				if (!msg.toLowerCase().includes("job") || !msg.toLowerCase().includes("exists")) {
					console.warn(`[ingest_document] verify_documents enqueue failed doc=${docId}: ${msg}`);
				}
			}

			// NOTE: Do not enqueue extract_visuals here. It is triggered only after rendered pages are complete
			// (final chunk in render_document_pages), to avoid ingest_not_complete races.
		}
		return { ok: true, analysis };
	} catch (err) {
		const message = err instanceof Error ? err.message : typeof err === "string" ? err : "Unknown error";
		const nowIso = new Date().toISOString();
		const isOcrish = isOcrishError(err);

		// Default heuristic only used if we haven't persisted a deterministic needsOcr decision.
		const needsOcrHeuristic =
			typeof message === "string" &&
			(message.toLowerCase().includes("no text extracted") || message.toLowerCase().includes("image-only"));

		let persistedNeedsOcr: boolean | null = null;
		let existingWarnings: unknown[] = [];
		let existingTextLen = 0;
		try {
			if (documentId) {
				const pool = getPool();
				const { rows } = await pool.query<{
					extraction_metadata: unknown | null;
					full_text: string | null;
					structured_data: unknown | null;
				}>(
					"SELECT extraction_metadata, full_text, structured_data FROM documents WHERE id = $1 LIMIT 1",
					[sanitizeText(documentId)]
				);
				const metaObj = rows?.[0]?.extraction_metadata && typeof rows[0].extraction_metadata === "object" ? (rows[0].extraction_metadata as any) : null;
				persistedNeedsOcr = typeof metaObj?.needsOcr === "boolean" ? Boolean(metaObj.needsOcr) : null;
				existingWarnings = Array.isArray(metaObj?.warnings) ? metaObj.warnings : [];
				existingTextLen = typeof rows?.[0]?.full_text === "string" ? rows[0].full_text.length : 0;
				// If we have structured data but no full_text, still treat it as “some extraction exists”.
				if (existingTextLen <= 0 && rows?.[0]?.structured_data && typeof rows[0].structured_data === "object") {
					existingTextLen = 1;
				}
			}
		} catch {
			// best-effort
		}

		const needsOcr = persistedNeedsOcr ?? needsOcrHeuristic;
		const minTextThresholdChars = Number.isFinite(Number(process.env.PDF_MIN_TEXT_THRESHOLD_CHARS))
			? Number(process.env.PDF_MIN_TEXT_THRESHOLD_CHARS)
			: 800;

		if (documentId && isOcrish) {
			const outcome = decideIngestOutcomeForError({
				err,
				needsOcr,
				existingTextLen,
				minTextThresholdChars,
				nowIso,
			});

			if (outcome.kind === "succeeded_with_warnings") {
				// Do NOT clobber existing outputs. Record warning, clear top-level errorMessage,
				// and ensure document is not marked failed.
				const appendedWarnings = Array.isArray(existingWarnings)
					? [...existingWarnings, ...(Array.isArray((outcome.extractionMetadataPatch as any).warnings) ? (outcome.extractionMetadataPatch as any).warnings : [])]
					: Array.isArray((outcome.extractionMetadataPatch as any).warnings)
						? (outcome.extractionMetadataPatch as any).warnings
						: [];

				await mergeDocumentExtractionMetadata({
					documentId,
					patch: {
						...outcome.extractionMetadataPatch,
						needsOcr,
						warnings: appendedWarnings,
						ocrish_nonfatal: true,
					},
				});

				// Only flip the document out of "processing" if we already have content.
				if (existingTextLen > 0) {
					await updateDocumentStatus(documentId, "completed");
				}
				await updateJob(job, "succeeded", `Succeeded with warnings: ${message}`, 100);
				console.warn(`[ingest_document] non-fatal OCR-ish error doc=${documentId} needsOcr=${needsOcr}: ${message}`);
				return { ok: true };
			}
		}

		// Default: treat as failure.
		if (documentId) {
			await mergeDocumentExtractionMetadata({
				documentId,
				patch: {
					doc_kind: fileName?.toLowerCase().split(".").pop() ?? null,
					extractor_name: "worker.unknown",
					extractor_version: process.env.DOC_EXTRACTOR_VERSION || "1.0.0",
					finished_at: nowIso,
					status: "failed",
					contentType: fileName?.toLowerCase().split(".").pop() ?? null,
					attempt,
					errorMessage: message,
					needsOcr,
					...(isOcrish ? { ocrish_error: true } : {}),
				},
			});
			await updateDocumentAnalysis({ documentId, fullTextAbsentReason: "extraction_failed" });
			await updateDocumentStatus(documentId, "failed");
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
	processor: Parameters<typeof createWorker>[1],
	options?: Parameters<typeof createWorker>[2]
) => {
	registeredWorkers.push(name);
	return createWorker(name, processor, options);
};

function assertQueueNamesRuntimeExport() {
	if (!QUEUE_NAMES || typeof QUEUE_NAMES !== "object") {
		throw new Error(
			"QUEUE_NAMES is missing at runtime. Ensure worker imports QUEUE_NAMES from @dealdecision/core (runtime export), not a type-only path."
		);
	}

	const requiredKeys = ["populate_document_page_understanding", "finalize_extract_visuals"] as const;
	for (const key of requiredKeys) {
		if (!(key in QUEUE_NAMES)) {
			throw new Error(`QUEUE_NAMES is missing required key: ${key}`);
		}
	}
}

assertQueueNamesRuntimeExport();

function assertRequiredQueuesRegistered() {
	const required = Object.values(QUEUE_NAMES);
	const registered = new Set(registeredWorkers.map((w) => String(w)));
	const missing = required.filter((q) => !registered.has(q));
	if (missing.length === 0) return;

	const payload = {
		event: "WORKER_QUEUE_MISMATCH",
		service: "worker",
		missing,
		required,
		registered: Array.from(registered),
	};

	try {
		console.error(JSON.stringify(payload));
	} catch {
		// ignore
	}

	// Fail fast in dev/test to prevent readiness deadlocks.
	if (process.env.NODE_ENV !== "production") {
		throw new Error(`Worker missing queue processors: ${missing.join(", ")}`);
	}
}

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
		await enqueuePersistedJob({
			type: "ingest_documents",
			deal_id: doc.deal_id,
			document_id: doc.id,
			payload: { document_id: doc.id, deal_id: doc.deal_id, file_name: name, mode: "from_storage", attempt: 1 },
			parent_job_id: job.id ? String(job.id) : null,
		});
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
registerWorker("render_document_pages", renderDocumentPagesProcessor);


registerWorker(QUEUE_NAMES.populate_document_page_understanding, async (job: Job) => {
	return populateDocumentPageUnderstandingProcessor(job);
});

import { extractVisualsProcessor } from "./jobs/extract-visuals/processor";

const extractVisualsConcurrency = (() => {
	const raw = process.env.EXTRACT_VISUALS_CONCURRENCY;
	if (raw != null && raw.trim() !== "") {
		const parsed = Number(raw);
		if (Number.isFinite(parsed) && Number.isInteger(parsed) && parsed >= 1) return parsed;
		console.warn(`[worker] Invalid EXTRACT_VISUALS_CONCURRENCY=${raw}; using default`);
	}
	// Local dev/test often enqueues many extract_visuals jobs (per-doc + deal-level coordinator). A small bump
	// helps prevent head-of-line blocking without changing the global WORKER_CONCURRENCY cap.
	return process.env.NODE_ENV === "production" ? 1 : 2;
})();

registerWorker("extract_visuals", extractVisualsProcessor, { concurrency: extractVisualsConcurrency });

registerWorker("deep_scan_visuals", async (job: Job) => {
	const data = (job.data ?? {}) as {
		deal_id?: string;
		document_ids?: string[];
		force_refresh?: boolean;
		force_reextract?: boolean;
		parent_job_id?: string | null;
		page_start?: number;
		page_end?: number;
	};
	let dealId = typeof data.deal_id === "string" ? data.deal_id : undefined;
	const explicitDocumentIds = Array.isArray(data.document_ids)
		? data.document_ids.filter((id) => typeof id === "string" && id.trim().length > 0)
		: [];
	const forceRefresh = Boolean((data as any).force_refresh);
	const forceReextract = Boolean((data as any).force_reextract);
	const pageStartRaw = (data as any).page_start;
	const pageEndRaw = (data as any).page_end;
	const isChunkJob = pageStartRaw != null || pageEndRaw != null;
	const requestedPageStart =
		typeof pageStartRaw === "number" && Number.isFinite(pageStartRaw) ? Math.max(0, Math.floor(pageStartRaw)) : 0;
	const requestedPageEnd =
		typeof pageEndRaw === "number" && Number.isFinite(pageEndRaw) ? Math.max(0, Math.floor(pageEndRaw)) : undefined;

	const pool = getPool();
	if (!dealId && explicitDocumentIds.length > 0) {
		try {
			const { rows } = await pool.query<{ deal_id: string | null }>(
				"SELECT deal_id FROM documents WHERE id = $1 LIMIT 1",
				[sanitizeText(explicitDocumentIds[0])]
			);
			const derived = rows?.[0]?.deal_id;
			dealId = typeof derived === "string" && derived.trim().length > 0 ? derived.trim() : undefined;
		} catch {
			dealId = undefined;
		}
	}
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

	const visionRuntime = createVisionJobRuntime({
		config,
		logger: console,
		logMeta: {
			job_id: job.id ? String(job.id) : null,
			deal_id: dealId,
			stage: "deep_scan_visuals",
		},
	});

	const visionVerification = await verifyVisionServiceForJob(config.visionWorkerUrl);
	if (!visionVerification.ok) {
		console.warn(
			JSON.stringify({
				event: "VISION_SERVICE_VERIFICATION_FAILED",
				job_id: job.id ? String(job.id) : null,
				deal_id: dealId,
				stage: "deep_scan_visuals",
				vision_base_url: config.visionWorkerUrl,
				reason: visionVerification.reason ?? "unknown",
				details: visionVerification,
			})
		);

		// Persist a deterministic skip marker in document metadata before failing the deep scan job.
		try {
			let docIds: string[] = [];
			if (explicitDocumentIds.length > 0) {
				docIds = explicitDocumentIds;
			} else {
				const docs = await getDocumentsForDeal(dealId);
				docIds = (docs as any[])
					.map((d: any) => d?.document_id)
					.filter((id: any) => typeof id === "string" && id.trim().length > 0);
			}
			const nowIso = new Date().toISOString();
			await Promise.all(
				docIds.slice(0, 100).map(async (docId) => {
					try {
						await mergeDocumentExtractionMetadata({
							documentId: docId,
							patch: {
								deep_scan_visuals: {
									status: "skipped",
									reason: "vision_unavailable",
									at: nowIso,
									vision_base_url: config.visionWorkerUrl,
									verification: visionVerification,
								},
							},
						});
					} catch {
						// best-effort
					}
				})
			);
		} catch {
			// best-effort
		}

		throw new Error(`VISION_UNAVAILABLE: ${visionVerification.reason ?? "unknown"}`);
	}

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
	let pagesSucceeded = 0;
	let pagesFailed = 0;
	let docsSkippedPolicy = 0;
	const perDocSummaries: Array<{ document_id: string; attempted: number; succeeded: number; failed: number; failures: any[] }> = [];

	for (let docIndex = 0; docIndex < targetDocumentIds.length; docIndex += 1) {
		const docId = targetDocumentIds[docIndex];
		let derivedDealId: string | null = dealId;
		let existingVisualExtraction: Record<string, unknown> | null = null;
		try {
			const { rows } = await pool.query<{ deal_id: string | null; extraction_metadata: any }>(
				"SELECT deal_id, extraction_metadata FROM documents WHERE id = $1 LIMIT 1",
				[sanitizeText(docId)]
			);
			const row = rows?.[0];
			if (typeof row?.deal_id === "string" && row.deal_id.trim().length > 0) derivedDealId = row.deal_id.trim();
			const ve = row?.extraction_metadata && typeof row.extraction_metadata === "object" ? (row.extraction_metadata as any).visual_extraction : null;
			existingVisualExtraction = ve && typeof ve === "object" ? ve : null;
		} catch {
			// best-effort
		}

		const routing = await computeAndPersistVisionRoutingV1({
			pool,
			documentId: docId,
			stage: "deep_scan_visuals",
			jobId: job.id ? String(job.id) : null,
		});
		if (!routing.decision.vision_fallback_allowed) {
			docsSkippedPolicy += 1;
			try {
				await mergeDocumentExtractionMetadata({
					documentId: docId,
					patch: {
						deep_scan_policy_v1: {
							status: "skipped_policy",
							at: new Date().toISOString(),
							vision_fallback_allowed: false,
							reason: routing.decision.reason,
						},
					},
				});
			} catch {
				// best-effort
			}
			console.log(
				JSON.stringify({
					event: "DEEP_SCAN_SKIPPED_POLICY",
					job_id: job.id ? String(job.id) : null,
					deal_id: derivedDealId,
					document_id: docId,
					doc_kind: routing.doc_kind,
					reason: routing.decision.reason,
				})
			);
			docsProcessed += 1;
			continue;
		}

		let uris: string[] = [];
		try {
			uris = await resolvePageImageUris(pool, docId, { env: process.env, logger: console });
		} catch {
			uris = [];
		}

		if (uris.length === 0) {
			// Persist fatal marker for UI/debugging.
			try {
				const summary = buildDeepScanPageSummaryV1({ attempted: 0, succeeded: 0, failures: [], completedAt: new Date().toISOString() });
				await mergeDocumentExtractionMetadata({
					documentId: docId,
					patch: buildDeepScanExtractionMetadataPatch({
						existingVisualExtraction,
						summary,
						status: "failed",
					}),
				});
			} catch {
				// best-effort
			}
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
				const planned = planChunkEnqueues({ totalPages, chunkSize });
				for (const range of planned.ranges) {
					await enqueuePersistedJob({
						type: "deep_scan_visuals",
						deal_id: dealId,
						document_id: docId,
						parent_job_id: parentJobId,
						page_start: range.start,
						page_end: range.end,
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
						chunks_enqueued: planned.chunks_enqueued,
					})
				);

				// Coordinator job: avoid double-processing the first chunk.
				docsProcessed += 1;
				continue;
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

		let docAttempted = 0;
		let docSucceeded = 0;
		const docFailures: any[] = [];
		for (let pageIndex = pageStart; pageIndex < pageEndExclusive; pageIndex += 1) {
			pagesConsidered += 1;
			const image_uri = uris[pageIndex];

			// Strict rerun guard: only skip this page if BOTH a visual_assets row AND a
			// visual_extractions row exist for it. A visual_assets row alone is insufficient —
			// it can be present even when OCR/vision was skipped (e.g., vision_unavailable),
			// leaving visual_extractions empty. In that case, we must re-attempt.
			if (!forceReextract) {
				try {
					const { rows } = await pool.query(
						`
							SELECT 1
							  FROM visual_assets va
							  JOIN visual_extractions ve_row
							    ON ve_row.visual_asset_id = va.id
							   AND ve_row.extractor_version = $3
							 WHERE va.document_id = $1
							   AND va.page_index = $2
							   AND va.extractor_version = $3
							 LIMIT 1
						`,
						[sanitizeText(docId), pageIndex, sanitizeText(baseExtractorVersion)]
					);
					if ((rows?.length ?? 0) > 0) {
						pagesSkippedExisting += 1;
						continue;
					}
				} catch (err) {
					// Best-effort: if precheck fails, proceed with extraction rather than skipping.
					console.warn(
						`[deep_scan_visuals] existing-page precheck failed doc=${docId} page=${pageIndex}: ${err instanceof Error ? err.message : String(err)}`
					);
				}
			}

			if (!forceRefresh) {
				const hasVu = await pageHasVisionUnderstanding(docId, pageIndex);
				if (hasVu) {
					pagesSkippedExisting += 1;
					continue;
				}
			}

			pagesAttempted += 1;
			docAttempted += 1;
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
			if (pageIndex === pageStart) {
				const uriToCheck = typeof safe_image_uri === "string" ? safe_image_uri : "";
				const diag = await headCheckImageUri(uriToCheck);
				console.log(
					JSON.stringify({
						event: "VISION_IMAGE_URI_FETCH_DIAG",
						stage: "deep_scan_visuals",
						document_id: docId,
						page_index: pageIndex,
						image_uri: uriToCheck,
						diag,
					})
				);
				if (!diag.ok) {
					throw new Error(
						`RETRYABLE_IMAGE_URI_UNREACHABLE: doc=${docId} page=${pageIndex} status=${diag.status ?? "null"} method=${diag.method}`
					);
				}
			}
			const logMeta = {
				stage: "deep_scan_visuals",
				job_id: job.id ? String(job.id) : "",
				deal_id: typeof derivedDealId === "string" && derivedDealId.trim().length > 0 ? derivedDealId.trim() : "",
				document_id: typeof docId === "string" ? docId : "",
				page_index: pageIndex,
				doc_kind: typeof routing.doc_kind === "string" && routing.doc_kind.trim().length > 0 ? routing.doc_kind : "unknown",
				page_range: { start: pageStart, end: pageEndExclusive },
				chunk: { page_start: pageStart, page_end: pageEndExclusive },
				vision_base_url: config.visionWorkerUrl,
			};
			const timeoutsMs = [20_000, 60_000, 90_000];
			const { response, attempts } = await callVisionWorkerWithRetries(
				config,
				{
					document_id: docId,
					page_index: pageIndex,
					image_uri: safe_image_uri,
					image_b64: image_b64 ?? undefined,
					extractor_version: forceExtractorVersion,
				},
				{
					logger: console,
					runtime: visionRuntime,
					logMeta,
					timeoutsMs,
					backoffMs: [500, 1500],
				}
			);

			if (!response || !Array.isArray((response as any).assets) || response.assets.length === 0) {
				pagesErrored += 1;
				pagesFailed += 1;
				const last = Array.isArray(attempts) && attempts.length > 0 ? attempts[attempts.length - 1] : null;
				const reason =
					(typeof last?.error === "string" && last.error.trim().length > 0)
						? last.error
						: (typeof last?.status_code === "number" && Number.isFinite(last.status_code))
							? `HTTP_${last.status_code}`
							: (typeof last?.error_kind === "string" && last.error_kind)
								? String(last.error_kind)
								: "VISION_NO_ASSETS";
				docFailures.push({
					page_index: pageIndex,
					reason,
					attempts_used: Array.isArray(attempts) ? attempts.length : 1,
					elapsed_ms: typeof last?.elapsed_ms === "number" ? last.elapsed_ms : undefined,
					status_code: typeof last?.status_code === "number" ? last.status_code : null,
				});
				continue;
			}

			// Persist results into the canonical extractor version so the API/UI sees it.
			(response as any).extractor_version = baseExtractorVersion;

			try {
				const { persisted } = await persistVisionResponse(pool, response, { pageImageUri: image_uri });
				persistedAssets += persisted;
				pagesUpdated += 1;
				pagesSucceeded += 1;
				docSucceeded += 1;
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
			} catch (err) {
				pagesErrored += 1;
				pagesFailed += 1;
				docFailures.push({
					page_index: pageIndex,
					reason: err instanceof Error ? err.message : String(err),
					attempts_used: 0,
				});
			}
			await yieldToEventLoop();
		}

		const summary = buildDeepScanPageSummaryV1({ attempted: docAttempted, succeeded: docSucceeded, failures: docFailures });
		const status = computeDeepScanOutcomeStatus({ attempted: summary.attempted, succeeded: summary.succeeded, fatal: false });
		perDocSummaries.push({ document_id: docId, attempted: summary.attempted, succeeded: summary.succeeded, failed: summary.failed, failures: summary.failures });
		try {
			await mergeDocumentExtractionMetadata({
				documentId: docId,
				patch: buildDeepScanExtractionMetadataPatch({ existingVisualExtraction, summary, status }),
			});
		} catch {
			// best-effort
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

	const status = computeDeepScanOutcomeStatus({ attempted: pagesAttempted, succeeded: pagesSucceeded, fatal: pagesAttempted === 0 });
	const finishedWithWarnings = status === "succeeded_with_warnings";
	const summary = {
		deal_id: dealId,
		extractor_version: baseExtractorVersion,
		docs_total: targetDocumentIds.length,
		docs_processed: docsProcessed,
		docs_skipped_policy: docsSkippedPolicy,
		pages_total: pagesTotal,
		pages_with_vision_understanding_v1: pagesWithVu,
		pages_considered: pagesConsidered,
		pages_attempted: pagesAttempted,
		pages_updated: pagesUpdated,
		pages_skipped_existing: pagesSkippedExisting,
		pages_errored: pagesErrored,
		pages_succeeded: pagesSucceeded,
		pages_failed: pagesFailed,
		persisted_assets: persistedAssets,
		asset_type_counts: assetTypeCounts,
		status,
		per_document: perDocSummaries.slice(0, 25),
	};

	console.log(
		JSON.stringify({
			event: "DEEP_SCAN_VISUALS_SUMMARY",
			deal_id: dealId,
			document_ids_total: targetDocumentIds.length,
			document_ids: targetDocumentIds.slice(0, 50),
			attempted: pagesAttempted,
			succeeded: pagesSucceeded,
			failed: pagesFailed,
			failed_pages: perDocSummaries.flatMap((d) => (d.failures ?? []).map((f: any) => ({ document_id: d.document_id, page_index: f.page_index })) ).slice(0, 50),
			extractor_version: baseExtractorVersion,
			vision_base_url: config.visionWorkerUrl,
			finished_with_warnings: finishedWithWarnings,
			status,
		})
	);

	await updateJob(
		job,
		status,
		status === "failed"
			? `Deep scan failed (attempted=${pagesAttempted}, succeeded=${pagesSucceeded}, failed=${pagesFailed})`
			: status === "succeeded_with_warnings"
				? `Deep scan complete with warnings (pages_updated=${pagesUpdated}, pages_errored=${pagesErrored})`
				: `Deep scan complete (pages_updated=${pagesUpdated}, pages_errored=${pagesErrored})`,
		100
	);
	await emitJobProgress(job, {
		job_id: job.id ? String(job.id) : "",
		deal_id: dealId,
		stage: "finalize",
		percent: 100,
		message:
			status === "failed"
				? "Deep scan failed"
				: status === "succeeded_with_warnings"
					? "Deep scan complete with warnings"
					: "Deep scan complete",
		meta: summary,
	});

	return { ok: status !== "failed", summary };
});
registerWorker("fetch_evidence", fetchEvidenceProcessor);
registerWorker("analyze_deal", async (job: Job) => {
	const dealId =
		(job.data as { deal_id?: string } | undefined)?.deal_id ??
		(await getDealIdForJob(job));
	const requirePageUnderstanding = Boolean((job.data as any)?.payload?.require_page_understanding);
	const pageUnderstandingVersionRaw = (job.data as any)?.payload?.page_understanding_version;
	const pageUnderstandingVersion =
		typeof pageUnderstandingVersionRaw === "string" && pageUnderstandingVersionRaw.trim().length > 0
			? pageUnderstandingVersionRaw.trim()
			: "page_understanding_v1";
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
		let phase1_deal_overview_v2 = buildPhase1DealOverviewV2({
			nowIso,
			documents: phase1Documents,
		});

		// Prefer per-slide promoted facts (from document_page_understanding) for raise + business model.
		// This keeps Phase 1 consistent with /report structured_summary and provides page-level citations.
		try {
			const pool = getPool();
			type EvidenceRow = {
				source_document_id: string | null;
				source_path: string | null;
				extracted_at: string | null;
				confidence: number | null;
				content_json: any;
				meta: any;
			};
			const loadPromoted = async (factType: "raise_terms_v1" | "business_model_v1"): Promise<{ display: string; docId: string | null; pageIndex: number | null } | null> => {
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
				const prov = (row.content_json as any)?.provenance ?? null;
				const pageIndex = typeof prov?.page_index === "number" && Number.isFinite(prov.page_index)
					? Math.floor(prov.page_index)
					: typeof row.meta?.page_index === "number" && Number.isFinite(row.meta.page_index)
						? Math.floor(row.meta.page_index)
						: null;
				const docId = typeof row.source_document_id === "string" && row.source_document_id.trim() ? row.source_document_id.trim() : null;
				return { display, docId, pageIndex };
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
				phase1_deal_overview_v2 = {
					...phase1_deal_overview_v2,
					business_model: promotedModel.display,
					sources: mergeSources((phase1_deal_overview_v2 as any)?.sources, [
						{
							document_id: promotedModel.docId ?? (phase1Documents[0]?.document_id ?? "unknown"),
							...(typeof promotedModel.pageIndex === "number" ? { page_range: [promotedModel.pageIndex + 1, promotedModel.pageIndex + 1] as [number, number] } : {}),
							note: typeof promotedModel.pageIndex === "number" ? `promoted business_model_v1 (dpu page_index=${promotedModel.pageIndex})` : "promoted business_model_v1",
						},
					]),
				};
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

				const compiledReport = promotedFacts.length > 0
					? compileDIOToReportWithPromotedFacts(result.dio as any, { promotedFacts })
					: compileDIOToReport(result.dio as any);

				const persisted = await pool.query<{ persisted: boolean }>(
					`UPDATE deal_intelligence_objects
						SET dio_data = jsonb_set(
							COALESCE(dio_data, '{}'::jsonb),
							'{report}',
							$1::jsonb,
							true
						)
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
			overview = await generateAndPersistGovernedLlmOverviewBestEffort({
				pool: getPool(),
				dealId,
				runId: job.id ? String(job.id) : null,
				stepRunId: null,
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
		if (overviewOk && process.env.INVESTOR_INSIGHTS_ENABLED === "true") {
			try {
				const insightsQueue = getQueue("investor_insights");
				const insightsJobId = makeJobId("investor_insights", [dealId, "v1", "overlay_complete"]);
				await insightsQueue.add(
					"generate_investor_insights",
					{ deal_id: dealId, engine_version: "v1", triggered_by: "overlay_complete" },
					{ jobId: insightsJobId, removeOnComplete: true, removeOnFail: false, attempts: 3, backoff: { type: "exponential", delay: 1000 } }
				);
				console.log(
					JSON.stringify({
						event: "INVESTOR_INSIGHTS_ENQUEUED",
						deal_id: dealId,
						job_id: insightsJobId,
						triggered_by: "overlay_complete",
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
		attempts: 3,
		backoff: { type: "exponential", delay: 1000 },
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
registerWorker("remediate_extraction", remediateExtractionProcessor);

/**
 * True re-extraction job: re-runs extraction from the persisted original file bytes.
 *
 * Selection behavior:
 * - If document_ids provided: re-extract those documents.
 * - Else: re-extract documents that are failed OR have overall_score < threshold_low.
 */
registerWorker("reextract_documents", async (job: Job) => {
	return await reextractDocumentsProcessor(job);
});

/**
 * Document intelligence job: signals-only extraction from existing artifacts,
 * persisted as canonical evidence_items (with run/step provenance when available).
 */
registerWorker("document_intelligence_extract", async (job: Job) => {
	return await documentIntelligenceExtractProcessor(job);
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
			analysisVersion: 0,
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


// Investor Insight Engine – Stage 0 (PR1)
// Queue: "investor_insights" | Job: "generate_investor_insights" | Concurrency: 1
registerWorker("investor_insights", generateInvestorInsightsProcessor, { concurrency: 1 });

// PDF Export — renders due-diligence reports server-side via Playwright
// Queue: "export_report_pdf" | Concurrency: 1 (Playwright is resource-intensive)
registerWorker("export_report_pdf", exportReportPdfProcessor, { concurrency: 1 });

// ─── Extract Visuals Finalize Recovery ───────────────────────────────────────
// Queue: "finalize_extract_visuals"
// Enqueued when a chunk job detects the finalize lock is already held (lock-skip
// recovery path).  Runs the full finalization sequence idempotently: writes
// page_segments_v1, extract_visuals_finalized marker, promotes OCR text, and
// enqueues analyze_deal.  Uses the same Redis lock as the primary chunk path so
// only one runner wins when parallel recovery jobs are enqueued.
registerWorker(QUEUE_NAMES.finalize_extract_visuals, async (job: Job) => {
	const data = (job.data ?? {}) as {
		deal_id?: string | null;
		document_ids?: string[];
		from_chunk_job_id?: string | null;
	};
	const pool = getPool();
	const dealId = typeof data.deal_id === "string" && data.deal_id.trim() ? data.deal_id.trim() : null;
	const rawDocIds = Array.isArray(data.document_ids) ? data.document_ids : [];
	const docIds = rawDocIds.filter((d): d is string => typeof d === "string" && d.trim().length > 0);

	if (!dealId || docIds.length === 0) {
		console.warn(
			JSON.stringify({
				event: "FINALIZE_EXTRACT_VISUALS_SKIP",
				reason: "missing_deal_id_or_document_ids",
				deal_id: dealId,
				document_ids: docIds,
				job_id: job.id ? String(job.id) : null,
			})
		);
		return { ok: false, reason: "missing_deal_id_or_document_ids" };
	}

	const FINALIZE_LOCK_TTL_S = 300;
	const FINALIZE_LOCK_STALE_TAKEOVER_S = 120;
	const lockKey = `extract_visuals:finalized:${dealId}:${docIds.length === 1 ? docIds[0] : "multi"}`;
	const triggerJobId = job.id ? String(job.id) : "unknown";
	const lockValue = JSON.stringify({ job_id: triggerJobId, acquired_at: Date.now() });
	let lockAcquired = false;

	try {
		const res = await (connection as any).set(lockKey, lockValue, "NX", "EX", FINALIZE_LOCK_TTL_S);
		if (res === "OK") {
			lockAcquired = true;
		} else {
			// Check if the existing holder is stale — if so, take over.
			try {
				const existing = await (connection as any).get(lockKey);
				const parsed = existing ? JSON.parse(existing) : null;
				const ageMs = parsed?.acquired_at ? Date.now() - Number(parsed.acquired_at) : Infinity;
				if (ageMs / 1000 > FINALIZE_LOCK_STALE_TAKEOVER_S) {
					await (connection as any).set(lockKey, lockValue, "EX", FINALIZE_LOCK_TTL_S);
					lockAcquired = true;
				} else {
					// Fresh lock — another runner is currently finalizing. Skip.
					console.log(
						JSON.stringify({
							event: "FINALIZE_EXTRACT_VISUALS_LOCK_SKIP",
							deal_id: dealId,
							reason: "lock_held_by_concurrent_runner",
							holder_job_id: parsed?.job_id ?? null,
							holder_age_ms: Math.round(ageMs),
						})
					);
					return { ok: true, reason: "lock_held_by_concurrent_runner" };
				}
			} catch {
				// Cannot read lock — skip to avoid racing.
				return { ok: true, reason: "lock_read_error_skipping" };
			}
		}

		// ── Per-document: page_segments_v1 + finalized marker ──────────────────
		for (const docId of docIds) {
			try {
				const { rows } = await pool.query(
					"SELECT deal_id, type, extraction_metadata, full_content, page_count FROM documents WHERE id = $1 LIMIT 1",
					[sanitizeText(docId)]
				);
				const row = rows?.[0] as any;
				const existing =
					row?.extraction_metadata && typeof row.extraction_metadata === "object" ? row.extraction_metadata : null;

				if (existing && (existing as any)?.page_segments_v1) {
					// Already written — just ensure finalized marker is present.
					await mergeDocumentExtractionMetadata({
						documentId: docId,
						patch: buildExtractVisualsFinalizedMarker({ jobId: triggerJobId, docsFinalized: 1 }),
					});
					continue;
				}

				const fullContent = row?.full_content ?? {};
				const pdfV2 =
					(fullContent as any)?.pdf_v2 && typeof (fullContent as any).pdf_v2 === "object"
						? (fullContent as any).pdf_v2
						: fullContent;
				const pages: any[] = Array.isArray((pdfV2 as any)?.pages) ? (pdfV2 as any).pages : [];

				const mapSlideType = (raw: unknown): string => {
					const s = typeof raw === "string" ? raw.trim().toLowerCase() : "";
					if (!s || s === "other") return "unknown";
					if (s === "go_to_market") return "distribution";
					if (s === "use_of_funds") return "raise_terms";
					return s;
				};

				const ordered = pages
					.map((p) => {
						const pageIndex =
							typeof p?.page_index === "number" && Number.isFinite(p.page_index) ? p.page_index : null;
						if (pageIndex == null || pageIndex < 0) return null;
						const u = p?.understanding_v1;
						return {
							page_index: pageIndex,
							slide_type: typeof u?.slide_type === "string" ? String(u.slide_type) : "other",
							slide_type_confidence:
								typeof u?.slide_type_confidence === "number" && Number.isFinite(u.slide_type_confidence)
									? u.slide_type_confidence
									: null,
							title: typeof u?.title === "string" ? String(u.title) : "",
							segment_key: mapSlideType(u?.slide_type),
						};
					})
					.filter(Boolean)
					.sort((a: any, b: any) => a.page_index - b.page_index);

				if (ordered.length === 0) {
					// XLSX / no-pages doc: write finalized marker so downstream knows finalize ran.
					await mergeDocumentExtractionMetadata({
						documentId: docId,
						patch: buildExtractVisualsFinalizedMarker({ jobId: triggerJobId, docsFinalized: 1 }),
					});
					continue;
				}

				const segments: any[] = [];
				let cur: any | null = null;
				for (const p of ordered as any[]) {
					const key =
						typeof p.segment_key === "string" && p.segment_key.trim() ? p.segment_key : "unknown";
					if (!cur || cur.segment_key !== key) {
						if (cur) segments.push(cur);
						cur = {
							segment_index: segments.length,
							segment_key: key,
							segment_label: key.replace(/_/g, " "),
							page_start: p.page_index,
							page_end: p.page_index,
							title_hint: p.title || null,
							avg_confidence: p.slide_type_confidence,
							pages: 1,
						};
					} else {
						cur.page_end = p.page_index;
						cur.pages += 1;
						if (typeof p.slide_type_confidence === "number") {
							const prev = typeof cur.avg_confidence === "number" ? cur.avg_confidence : 0;
							cur.avg_confidence = (prev * (cur.pages - 1) + p.slide_type_confidence) / cur.pages;
						}
						if (!cur.title_hint && p.title) cur.title_hint = p.title;
					}
				}
				if (cur) segments.push(cur);

				await mergeDocumentExtractionMetadata({
					documentId: docId,
					patch: {
						page_segments_v1: {
							version: "page_segments_v1",
							generated_at: new Date().toISOString(),
							segments,
						},
					},
				});
				await mergeDocumentExtractionMetadata({
					documentId: docId,
					patch: buildExtractVisualsFinalizedMarker({ jobId: triggerJobId, docsFinalized: 1 }),
				});
				console.log(
					JSON.stringify({
						event: "PAGE_SEGMENTS_V1_WRITTEN",
						document_id: docId,
						deal_id: dealId,
						segments_count: segments.length,
						source: "finalize_extract_visuals_recovery",
						job_id: triggerJobId,
					})
				);
			} catch (err) {
				console.warn(
					`[finalize_extract_visuals] page_segments write failed doc=${docId}: ${err instanceof Error ? err.message : String(err)}`
				);
			}
		}

		// ── Post-finalize: DPU populate + OCR promote + analyze_deal ───────────
		try {
			await populateDocumentPageUnderstandingFromVisualExtractions(pool as any, {
				dealId,
				version: "page_understanding_v1",
			});
		} catch (err) {
			console.warn(
				`[finalize_extract_visuals] dpu populate failed: ${err instanceof Error ? err.message : String(err)}`
			);
		}

		for (const docId of docIds) {
			try {
				await promoteVisualOcrToDocumentFullText({
					pool,
					documentId: docId,
					dealId,
					triggerJobId,
				});
			} catch {
				// best-effort
			}
		}

		try {
			await maybeEnqueueAnalyzeDealGuarantee({
				deal_id: dealId,
				trigger: "finalize_extract_visuals_recovery",
				triggerJobId,
				pool: pool as any,
				logger: console as any,
				enqueueCallback: () =>
					enqueueAnalyzeDeal({
						dealId,
						reason: "finalize_extract_visuals_recovery",
						triggerJobId,
						shouldEnqueue: true,
						extra: { finalize_extract_visuals: { recovery: true, document_ids: docIds } },
					}),
			});
		} catch {
			// best-effort
		}

		console.log(
			JSON.stringify({
				event: "EXTRACT_VISUALS_FINALIZE_SUCCESS",
				source: "finalize_extract_visuals_recovery",
				deal_id: dealId,
				document_ids: docIds,
				job_id: triggerJobId,
				ts: new Date().toISOString(),
			})
		);
		return { ok: true };
	} finally {
		if (lockAcquired) {
			try {
				await (connection as any).del(lockKey);
			} catch {
				// lock expires via TTL
			}
		}
	}
});

logWorkerQueueConfig("worker", Array.from(new Set(registeredWorkers)));

assertRequiredQueuesRegistered();

console.log(
	JSON.stringify({
		event: "worker_startup",
		service: "worker",
		bullmq: getBullmqRuntimeInfo(),
		registered_queues: Array.from(new Set(registeredWorkers)),
	})
);

// Storage contract: in production, never silently fall back to local disk.
// Also emit a single boot log line with active backend + endpoint + bucket.
try {
	const contract = assertProductionStorageContract(process.env);
	console.log(
		JSON.stringify({
			event: "storage_backend",
			service: "worker",
			storage_mode: contract.storage_mode,
			r2_bucket: contract.r2_bucket,
			r2_endpoint: contract.r2_endpoint,
		})
	);
} catch (err) {
	console.error(
		JSON.stringify({
			event: "storage_backend_invalid",
			service: "worker",
			err: err instanceof Error ? err.message : String(err),
			storage_mode: getDocumentStorageMode(process.env),
			r2_bucket: getR2BucketIfEnabled(process.env),
			r2_endpoint: resolveR2Endpoint(process.env),
		})
	);
	process.exit(1);
}

// Optional: log LibreOffice presence for debugging Render deployments.
// Must not crash the worker if `soffice` isn't installed.
try {
	const v = execSync("soffice --version").toString().trim();
	console.log(
		JSON.stringify({
			event: "soffice_available",
			service: "worker",
			version: v,
		})
	);
} catch {
	console.warn(
		JSON.stringify({
			event: "soffice_missing",
			service: "worker",
		})
	);
}

// One-time DB fingerprint + schema assertion.
// - Do NOT log credentials or DATABASE_URL.
// - If schema is missing required columns, log schema_check_failed once and exit non-zero.
// - If DB is unreachable, retry briefly and exit non-zero (unless explicitly allowed).

const __isWorkerEntrypoint = (() => {
	try {
		// CommonJS entrypoint guard: avoids starting long-running intervals when imported by unit tests.
		return typeof require !== "undefined" && typeof module !== "undefined" && require.main === module;
	} catch {
		return false;
	}
})();

if (__isWorkerEntrypoint) {
	void (async () => {
	const allowWithoutDbRaw = process.env.WORKER_ALLOW_START_WITHOUT_DB;
	const allowWithoutDb = allowWithoutDbRaw === "1" || allowWithoutDbRaw === "true";
	const maxWaitMsRaw = process.env.WORKER_DB_CONNECT_TIMEOUT_MS;
	const maxWaitMs = Number.isFinite(Number(maxWaitMsRaw)) ? Math.max(0, Number(maxWaitMsRaw)) : 60_000;
	const startedAt = Date.now();
	let attempt = 0;

	try {
		const pool = getPool();
		// Wait briefly for Postgres to become reachable (common during boot / cold starts).
		while (true) {
			try {
				attempt += 1;
				await pool.query("SELECT 1 AS ok");
				break;
			} catch (err) {
				const elapsed = Date.now() - startedAt;
				const msg = err instanceof Error ? err.message : String(err);
				if (elapsed >= maxWaitMs) {
					console.log(
						JSON.stringify({
							event: "db_connect_failed",
							service: "worker",
							attempt,
							elapsed_ms: elapsed,
							err: msg,
						})
					);
					if (!allowWithoutDb) {
						process.exit(1);
					}
					break;
				}
				if (attempt === 1 || attempt % 5 === 0) {
					console.warn(
						JSON.stringify({
							event: "db_connect_retry",
							service: "worker",
							attempt,
							elapsed_ms: elapsed,
							err: msg,
						})
					);
				}
				await new Promise((r) => setTimeout(r, 1000));
			}
		}

		const { rows } = await pool.query<{ db: string; ip: string | null; port: number | null }>(
			`SELECT
				current_database() AS db,
				inet_server_addr() AS ip,
				inet_server_port() AS port;`
		);
		const row = rows?.[0];
		const fingerprint = {
			db: row?.db ?? null,
			ip: row?.ip ?? null,
			port: row?.port ?? null,
		};

		try {
			await assertSchema({ fingerprint });
		} catch (schemaErr) {
			const missing = Array.isArray((schemaErr as any)?.missing) ? (schemaErr as any).missing : [];
			console.log(
				JSON.stringify({
					event: "schema_check_failed",
					missing,
					...fingerprint,
				})
			);
			markDbShuttingDown();
			await closePool();
			process.exit(1);
		}

		console.log(
			JSON.stringify({
				event: "db_fingerprint",
				service: "worker",
				...fingerprint,
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
		if (!(process.env.WORKER_ALLOW_START_WITHOUT_DB === "1" || process.env.WORKER_ALLOW_START_WITHOUT_DB === "true")) {
			process.exit(1);
		}
	}
})();

// Job watchdog: mark stale running jobs as failed so new work can proceed.
// Enabled by default; can be disabled by setting JOB_WATCHDOG_ENABLED=0.
	// Job watchdog: mark stale running jobs as failed so new work can proceed.
	// Enabled by default; can be disabled by setting JOB_WATCHDOG_ENABLED=0.
	void (async () => {
	const enabled = process.env.JOB_WATCHDOG_ENABLED;
	if (enabled === "0" || enabled === "false") return;

	const intervalMsRaw = process.env.JOB_WATCHDOG_INTERVAL_MS;
	const intervalMs = intervalMsRaw == null ? 5 * 60_000 : Number(intervalMsRaw);
	const safeIntervalMs = Number.isFinite(intervalMs) ? Math.max(60_000, Math.floor(intervalMs)) : 5 * 60_000;

	const tick = async () => {
		try {
			const res = await runJobWatchdogOnce();
			if (res.failed > 0) {
				console.log(
					JSON.stringify({
						event: "job_watchdog_stale_jobs_failed",
						scanned: res.scanned,
						failed: res.failed,
					})
				);
			}
		} catch (err) {
			console.warn(
				JSON.stringify({
					event: "job_watchdog_error",
					err: err instanceof Error ? err.message : String(err),
				})
			);
		}
	};

	// Run once on startup.
	void tick();
	setInterval(() => void tick(), safeIntervalMs);
})();

	// Pipeline run reconciler: safety net to finalize runs when all steps are terminal.
	// Enabled by default; can be disabled by setting PIPELINE_RUN_RECONCILER_ENABLED=0.
	void (async () => {
		const enabled = process.env.PIPELINE_RUN_RECONCILER_ENABLED;
		if (enabled === "0" || enabled === "false") return;

		const intervalMsRaw = process.env.PIPELINE_RUN_RECONCILER_INTERVAL_MS;
		const intervalMs = intervalMsRaw == null ? 60_000 : Number(intervalMsRaw);
		const safeIntervalMs = Number.isFinite(intervalMs) ? Math.max(10_000, Math.floor(intervalMs)) : 60_000;

		const batchRaw = process.env.PIPELINE_RUN_RECONCILER_BATCH_SIZE;
		const batchSize = batchRaw == null ? 25 : Number(batchRaw);
		const safeBatchSize = Number.isFinite(batchSize) ? Math.max(1, Math.floor(batchSize)) : 25;

		const tick = async () => {
			try {
				const pool = getPool();
				const res = await reconcileStuckPipelineRuns(pool, { batchSize: safeBatchSize });
				if (res.finalized > 0) {
					console.log(
						JSON.stringify({
							event: "pipeline_run_reconciler_finalized",
							scanned: res.scanned,
							finalized: res.finalized,
							succeeded: res.succeeded,
							failed: res.failed,
						})
					);
				}
			} catch (err) {
				console.warn(
					JSON.stringify({
						event: "pipeline_run_reconciler_error",
						err: err instanceof Error ? err.message : String(err),
					})
				);
			}
		};

		// Run once on startup.
		void tick();
		setInterval(() => void tick(), safeIntervalMs);
	})();

	const shutdown = async (source: string = "unknown") => {
		if (isShuttingDown) return;
		isShuttingDown = true;
		console.log(
			JSON.stringify({ event: "shutdown_start", source, service: "worker" })
		);
		markDbShuttingDown();
		await closePool();
		process.exit(0);
	};

	if (!handlersRegistered) {
		handlersRegistered = true;
		process.on("SIGINT", () => void shutdown("SIGINT"));
		process.on("SIGTERM", () => void shutdown("SIGTERM"));
	}

	console.log("DealDecision worker started");

	// Keep-alive interval to ensure process doesn't exit
	setInterval(() => {
		// Just keep the process alive
	}, 30000);
}
