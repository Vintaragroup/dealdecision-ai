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
import { monitorDealSignalsProcessor } from "./jobs/monitoring/monitor-deal-signals";
import { maybeEnqueueAnalyzeDealGuarantee } from "./lib/analyze-deal-guarantee";
import { renderDocumentPagesProcessor } from "./jobs/render-document-pages/processor";
import { fetchEvidenceProcessor } from "./jobs/fetch-evidence/processor";
import { remediateExtractionProcessor } from "./jobs/remediate-extraction/processor";
import { deepScanVisualsProcessor } from "./jobs/deep-scan-visuals/processor";
import { resolveWritableUploadDir } from "./lib/upload-dir-resolver";
import { makeDevLogger, updateJob } from "./lib/worker-utils";
import { startHeartbeat } from "./lib/heartbeat";

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
import { analyzeDealProcessor } from "./jobs/analyze-deal/processor";

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

registerWorker("deep_scan_visuals", deepScanVisualsProcessor);

registerWorker("fetch_evidence", fetchEvidenceProcessor);
registerWorker("analyze_deal", analyzeDealProcessor);

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

// Deal Risk Radar — continuous external signal monitoring (PR37)
// Queue: "monitor_deal_signals" | Concurrency: 2 (IO-bound Tavily calls)
registerWorker(QUEUE_NAMES.monitor_deal_signals, monitorDealSignalsProcessor, { concurrency: 2 });

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
