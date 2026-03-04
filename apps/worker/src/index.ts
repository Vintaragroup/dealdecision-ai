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

async function countVisualAssetsForDeal(pool: ReturnType<typeof getPool>, dealId: string): Promise<number | null> {
	try {
		const { rows } = await pool.query<{ c: number }>(
			`SELECT COUNT(*)::int AS c
			   FROM visual_assets va
			   JOIN documents d ON d.id = va.document_id
			  WHERE d.deal_id = $1`,
			[sanitizeText(dealId)]
		);
		return typeof rows?.[0]?.c === "number" ? rows[0].c : null;
	} catch {
		return null;
	}
}

async function enqueueAnalyzeDeal(params: {
	dealId: string | null | undefined;
	reason: string;
	triggerJobId?: string | null;
	shouldEnqueue?: boolean;
	skipReason?: string | null;
	prereq?: Record<string, unknown>;
	extra?: Record<string, unknown>;
}): Promise<{ enqueued: boolean; jobId: string | null }> {
	const dealId = typeof params.dealId === "string" ? params.dealId.trim() : "";
	const mergedExtra = {
		...(params.prereq ?? {}),
		...(params.extra ?? {}),
	};
	if (params.shouldEnqueue === false) {
		console.warn(
			JSON.stringify({
				event: "ANALYZE_DEAL_SKIPPED",
				deal_id: dealId || null,
				reason: params.reason,
				gate: params.skipReason ?? "gated",
				trigger_job_id: params.triggerJobId ?? null,
				extra: mergedExtra,
			})
		);
		return { enqueued: false, jobId: null };
	}
	if (!dealId) {
		console.warn(
			JSON.stringify({
				event: "ANALYZE_DEAL_SKIPPED",
				reason: params.reason,
				gate: "missing_deal_id",
				trigger_job_id: params.triggerJobId ?? null,
				extra: mergedExtra,
			})
		);
		return { enqueued: false, jobId: null };
	}

	// IMPORTANT: jobs are tracked in Postgres via job_id. Persist before BullMQ picks up.
	// Use enqueuePersistedJob so the same job_id is used for both DB and BullMQ.
	try {
		const pool = getPool();
		const visualAssetsTotal = await countVisualAssetsForDeal(pool, dealId);
		const prereq = { ...mergedExtra, visual_assets_total: visualAssetsTotal };

		const payload = {
			deal_id: dealId,
			reason: params.reason,
			...(params.triggerJobId ? { parent_job_id: params.triggerJobId } : {}),
			prereq,
		};

		const persisted = await enqueuePersistedJob({
			type: "analyze_deal",
			deal_id: dealId,
			parent_job_id: params.triggerJobId ?? null,
			payload,
		});

		console.log(
			JSON.stringify({
				event: "ANALYZE_DEAL_ENQUEUED",
				deal_id: dealId,
				reason: params.reason,
				job_id: persisted.job_id,
				trigger_job_id: params.triggerJobId ?? null,
				prereq,
			})
		);
		return { enqueued: true, jobId: persisted.job_id };
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (msg.toLowerCase().includes("exists") || msg.toLowerCase().includes("already exists")) {
			console.warn(
				JSON.stringify({
					event: "ANALYZE_DEAL_SKIPPED",
					deal_id: dealId,
					reason: params.reason,
					gate: "already_enqueued",
					trigger_job_id: params.triggerJobId ?? null,
					error: msg,
				})
			);
			return { enqueued: false, jobId: null };
		}
		console.warn(
			JSON.stringify({
				event: "ANALYZE_DEAL_ENQUEUE_FAILED",
				deal_id: dealId,
				reason: params.reason,
				trigger_job_id: params.triggerJobId ?? null,
				error: msg,
			})
		);
		return { enqueued: false, jobId: null };
	}
}

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

async function pickDownloadUrlFromExtractionMetadata(meta: unknown): Promise<string | null> {
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

	// Stable R2 reference case: mint a signed URL on demand.
	try {
		const bucket = typeof m?.upload?.bucket === "string" ? m.upload.bucket.trim() : "";
		const key = typeof m?.upload?.key === "string" ? m.upload.key.trim() : "";
		if (key) {
			return await getR2ObjectUrl({ bucket: bucket || null, key, env: process.env });
		}
	} catch {
		// ignore
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
	// Policy: NEVER embed base64 for HTTP(S) URIs; always prefer image_uri-only.
	const trimmed = String(imageUri || "").trim();
	if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return null;

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

function getMinPdfTextThresholdChars(env: NodeJS.ProcessEnv = process.env): number {
	const v = Number(env.PDF_MIN_TEXT_THRESHOLD_CHARS);
	return Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 800;
}

async function computeAndPersistVisionRoutingV1(params: {
	pool: ReturnType<typeof getPool>;
	documentId: string;
	stage: "render_document_pages" | "extract_visuals" | "deep_scan_visuals";
	jobId: string | null;
	force_ocr?: boolean;
}): Promise<{
	doc_kind: string;
	full_text_len: number;
	decision: ReturnType<typeof computeVisionRoutingDecisionV1>;
}> {
	const minTextThresholdChars = getMinPdfTextThresholdChars(process.env);
	let docKind = "unknown";
	let extractionMetadata: any = null;
	let docType: string | null = null;
	let fullTextLen = 0;
	let fullContent: any = null;
	let pageCount: number | null = null;
	let pagesWithText: number | null = null;
	let totalPages: number | null = null;
	let coverage: number | null = null;
	let completenessScore: number | null = null;
	let summaryLength: number | null = null;
	try {
		const { rows } = await params.pool.query<{ extraction_metadata: any; type: string | null; full_text_len: number; full_content: any; page_count: number | null }>(
			"SELECT extraction_metadata, type, full_content, page_count, length(coalesce(full_text,''))::int AS full_text_len FROM documents WHERE id = $1 LIMIT 1",
			[sanitizeText(params.documentId)]
		);
		extractionMetadata = rows?.[0]?.extraction_metadata ?? null;
		docType = typeof rows?.[0]?.type === "string" ? rows[0].type : null;
		fullContent = rows?.[0]?.full_content ?? null;
		pageCount = typeof rows?.[0]?.page_count === "number" && Number.isFinite(rows[0].page_count) ? Math.max(0, Math.floor(rows[0].page_count)) : null;
		fullTextLen = typeof rows?.[0]?.full_text_len === "number" ? rows[0].full_text_len : 0;
		docKind = deduceDocKind({ extraction_metadata: extractionMetadata, type: docType });

		// Compute page-level text coverage for PDFs. Prefer stored full_content pages so hybrid OCR merges are reflected.
		if (docKind === "pdf") {
			const fc = fullContent && typeof fullContent === "object" ? fullContent : null;
			const pages = Array.isArray(fc?.pages) ? fc.pages : null;
			if (pages) {
				totalPages = pages.length;
				pagesWithText = pages.filter((p: any) => typeof p?.text === "string" && p.text.trim().length > 0).length;
			} else {
				totalPages = pageCount;
				pagesWithText = null;
			}
			if (typeof totalPages === "number" && totalPages > 0 && typeof pagesWithText === "number") {
				coverage = pagesWithText / totalPages;
			}
		}

		const metaObj = extractionMetadata && typeof extractionMetadata === "object" ? extractionMetadata : null;
		completenessScore = typeof metaObj?.completeness?.score === "number" && Number.isFinite(metaObj.completeness.score) ? metaObj.completeness.score : null;
		summaryLength = typeof metaObj?.summaryLength === "number" && Number.isFinite(metaObj.summaryLength) ? Math.max(0, Math.floor(metaObj.summaryLength)) : null;
	} catch {
		// best-effort
	}

	const decision = computeVisionRoutingDecisionV1({
		doc_kind: docKind,
		extraction_metadata: extractionMetadata,
		full_text_len: fullTextLen,
		min_text_threshold_chars: minTextThresholdChars,
		force_ocr: params.force_ocr,
		page_coverage: { pages_with_text: pagesWithText, total_pages: totalPages, coverage },
		completeness_score: completenessScore,
		summary_length: summaryLength,
	});

	try {
		await mergeDocumentExtractionMetadata({
			documentId: params.documentId,
			patch: {
				vision_routing_v1: {
					decided_at: new Date().toISOString(),
					doc_kind: docKind,
					vision_fallback_allowed: decision.vision_fallback_allowed,
					reason: decision.reason,
					inputs: {
						...decision.inputs,
					},
				},
			},
		});
	} catch {
		// best-effort
	}

	return { doc_kind: docKind, full_text_len: fullTextLen, decision };
}
import { persistPdfPageUnderstandingV1Shadow } from "./lib/pdf_v2/page-understanding-v1";
import { applySlideUnderstandingV1Shadow } from "./lib/pdf_v2/slide-understanding-v1";
import { parseIngestDocumentsJobData, validateIngestDocumentsPayload } from "./lib/ingest/ingest-payload";
import { buildPhase1DealOverviewV2, buildPhase1DealUnderstandingV1, buildPhase1UpdateReportV1 } from "./lib/phase1/dealOverviewV2";
import { computeVisualQualityAuditForDeal } from "./lib/visual-quality-audit";
import { buildPhase1BusinessArchetypeV1 } from "./lib/phase1/businessArchetypeV1";
import { getVisualPageImagePersistConfig, persistRenderedPageImages, persistImagePage, renderNonPdfToPageImages, r2RenderedPageKey, convertOfficeToPdfBuffer } from "./lib/rendered-pages";
import type { DocumentAnalysis, ExtractedContent } from "./lib/processors";
import type { VerificationResult } from "./lib/verification";
import { OpenAIGPT4oProvider } from "./lib/llm/providers/openai-provider";
import type { ProviderConfig } from "./lib/llm/types";
import { extractPhaseBFeaturesV1, fetchPhaseBVisualsFromDb } from "./lib/phaseb/extract";
import { materializePhaseBVisualEvidenceForDeal } from "./lib/phaseb/materialize-evidence";
import { logMemory, yieldToEventLoop } from "./lib/memory";
import { updateJobProgress } from "./lib/job-progress";
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

type VisionServiceVerification = {
	ok: boolean;
	reason?: string;
	health?: { status: number; body_ok: boolean; duration_ms: number };
	openapi?: { status: number; has_extract_visuals: boolean; duration_ms: number };
};

async function fetchWithTimeout(url: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<Response> {
	const timeoutMs = typeof init.timeoutMs === "number" && Number.isFinite(init.timeoutMs) ? Math.max(100, init.timeoutMs) : 5000;
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const { timeoutMs: _ignored, ...rest } = init as any;
		return await fetch(url, { ...rest, signal: controller.signal });
	} finally {
		clearTimeout(timer);
	}
}

async function verifyVisionServiceForJob(baseUrl: string): Promise<VisionServiceVerification> {
	const base = String(baseUrl || "").trim().replace(/\/$/, "");
	if (!base) return { ok: false, reason: "missing_vision_base_url" };

	const healthUrl = `${base}/health`;
	const openapiUrl = `${base}/openapi.json`;

	try {
		const healthStarted = Date.now();
		const healthRes = await fetchWithTimeout(healthUrl, { method: "GET", timeoutMs: 5000 });
		const healthBodyText = await healthRes.text().catch(() => "");
		let bodyOk = false;
		try {
			const parsed = JSON.parse(healthBodyText || "{}") as any;
			bodyOk = parsed?.status === "ok";
		} catch {
			bodyOk = false;
		}
		const health = { status: healthRes.status, body_ok: bodyOk, duration_ms: Date.now() - healthStarted };
		if (!healthRes.ok || !bodyOk) {
			return { ok: false, reason: "vision_health_check_failed", health };
		}

		const openapiStarted = Date.now();
		const openapiRes = await fetchWithTimeout(openapiUrl, { method: "GET", timeoutMs: 5000 });
		const openapiText = await openapiRes.text().catch(() => "");
		let hasExtract = false;
		try {
			const spec = JSON.parse(openapiText || "{}") as any;
			hasExtract = Boolean(spec?.paths?.["/extract-visuals"]?.post) || Boolean(spec?.paths?.["/extract_visuals"]?.post);
		} catch {
			hasExtract = false;
		}
		const openapi = { status: openapiRes.status, has_extract_visuals: hasExtract, duration_ms: Date.now() - openapiStarted };
		if (!openapiRes.ok || !hasExtract) {
			return { ok: false, reason: "vision_openapi_check_failed", health, openapi };
		}

		return { ok: true, health, openapi };
	} catch (err) {
		return { ok: false, reason: err instanceof Error ? err.message : "vision_check_error" };
	}
}

type HeadCheckResult = ImageUriFetchDiag | { ok: boolean; status: number | null; content_type: string | null; duration_ms: number; method: "FILE"; error?: string };

async function headCheckImageUri(uri: string): Promise<HeadCheckResult> {
	const u = String(uri || "").trim();
	if (!u) {
		return { ok: false, status: null, content_type: null, duration_ms: 0, method: "GET_RANGE", error: "empty_uri" };
	}

	const started = Date.now();

	// Local-dev / docker-dev: we often pass a shared-volume filesystem path (e.g. /app/uploads/.../page_0000.png)
	// through to the vision service. Treat absolute paths and file:// URIs as local files.
	let localPath: string | null = null;
	if (u.startsWith("file://")) {
		try {
			localPath = new URL(u).pathname;
		} catch {
			localPath = null;
		}
	} else if (path.isAbsolute(u)) {
		localPath = u;
	}
	if (localPath) {
		try {
			await fs.access(localPath);
			const ext = path.extname(localPath).toLowerCase();
			const ct =
				ext === ".png"
					? "image/png"
					: ext === ".jpg" || ext === ".jpeg"
						? "image/jpeg"
						: ext === ".webp"
							? "image/webp"
							: null;
			return { ok: true, status: 200, content_type: ct, duration_ms: Date.now() - started, method: "FILE" };
		} catch (err) {
			return {
				ok: false,
				status: 404,
				content_type: null,
				duration_ms: Date.now() - started,
				method: "FILE",
				error: err instanceof Error ? err.message : "file_not_found",
			};
		}
	}

	if (!u.startsWith("http://") && !u.startsWith("https://")) {
		return { ok: false, status: null, content_type: null, duration_ms: Date.now() - started, method: "GET_RANGE", error: "unsupported_uri" };
	}
	return await probeImageUriFetchability(u, { timeoutMs: 5000 });
}

function formatRenderedPageKey(params: { prefix: string; format?: string | null; pageIndex: number }): string {
	const safePrefix = String(params.prefix ?? "").trim().replace(/\/$/, "");
	const idx = Number.isFinite(params.pageIndex) ? Math.max(0, Math.floor(params.pageIndex)) : 0;
	const raw = typeof params.format === "string" ? params.format.trim() : "";
	const fmt = raw && !raw.includes("/") ? raw : "page_%04d.png";
	if (fmt === "page_%04d.png") return r2RenderedPageKey(safePrefix, idx);
	const m = fmt.match(/%0(\d+)d/);
	if (m) {
		const width = Number.parseInt(m[1], 10);
		const padded = String(idx).padStart(Number.isFinite(width) ? Math.max(1, width) : 4, "0");
		return `${safePrefix}/${fmt.replace(m[0], padded)}`;
	}
	if (fmt.includes("%d")) return `${safePrefix}/${fmt.replace("%d", String(idx))}`;
	return r2RenderedPageKey(safePrefix, idx);
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

async function promoteVisualOcrToDocumentFullText(params: {
	pool: any;
	documentId: string;
	dealId?: string | null;
	triggerJobId?: string | null;
}): Promise<{ promoted: boolean; ocrChars: number; pages: number; reason: string }> {
	const pool = params.pool;
	const documentId = sanitizeText(params.documentId);
	if (!documentId) return { promoted: false, ocrChars: 0, pages: 0, reason: "invalid_document_id" };

	let docRow: any = null;
	try {
		const { rows } = await pool.query(
			"SELECT full_text, full_text_absent_reason, extraction_metadata FROM documents WHERE id = $1 LIMIT 1",
			[documentId]
		);
		docRow = rows?.[0] ?? null;
	} catch {
		return { promoted: false, ocrChars: 0, pages: 0, reason: "document_lookup_failed" };
	}

	const existingMeta = docRow?.extraction_metadata && typeof docRow.extraction_metadata === "object" ? docRow.extraction_metadata : null;
	const existingSearchIndex =
		existingMeta?.search_index && typeof existingMeta.search_index === "object" ? existingMeta.search_index : null;
	const existingSha = typeof existingSearchIndex?.visual_ocr_sha256 === "string" ? String(existingSearchIndex.visual_ocr_sha256) : "";

	let ocrRows: Array<{ page_index: number | null; ocr_text: string | null }> = [];
	try {
		const { rows } = await pool.query(
			`
			SELECT va.page_index, ve.ocr_text
			  FROM visual_assets va
			  JOIN visual_extractions ve ON ve.visual_asset_id = va.id
			 WHERE va.document_id = $1
			   AND ve.ocr_text IS NOT NULL
			   AND length(ve.ocr_text) > 0
			 ORDER BY va.page_index ASC
			`,
			[documentId]
		);
		ocrRows = (rows ?? []) as any;
	} catch (err: any) {
		const msg = err instanceof Error ? err.message : String(err);
		if (/relation\s+\"?(visual_assets|visual_extractions)\"?\s+does\s+not\s+exist/i.test(msg)) {
			return { promoted: false, ocrChars: 0, pages: 0, reason: "visual_tables_missing" };
		}
		return { promoted: false, ocrChars: 0, pages: 0, reason: "ocr_query_failed" };
	}

	const parts: string[] = [];
	const seenPages = new Set<number>();
	let chars = 0;
	const maxOcrChars = 120_000;
	for (const r of ocrRows) {
		const t = typeof r?.ocr_text === "string" ? r.ocr_text : "";
		if (!t.trim()) continue;
		const pageIndex = typeof r?.page_index === "number" && Number.isFinite(r.page_index) ? r.page_index : null;
		if (pageIndex != null) seenPages.add(pageIndex);
		const header = pageIndex != null ? `\n\n[OCR page ${pageIndex + 1}]\n` : "\n\n[OCR]\n";
		const chunk = header + t.trim();
		if (chars + chunk.length > maxOcrChars) {
			const remaining = Math.max(0, maxOcrChars - chars);
			if (remaining > 0) {
				parts.push(chunk.slice(0, remaining));
				chars += Math.min(remaining, chunk.length);
			}
			break;
		}
		parts.push(chunk);
		chars += chunk.length;
	}

	const ocrText = parts.join("").trim();
	if (!ocrText) return { promoted: false, ocrChars: 0, pages: 0, reason: "no_ocr_text" };

	const sha = createHash("sha256").update(ocrText).digest("hex");
	if (existingSha && existingSha === sha) {
		return { promoted: false, ocrChars: ocrText.length, pages: seenPages.size, reason: "already_promoted" };
	}

	const existingFullText = typeof docRow?.full_text === "string" ? String(docRow.full_text) : "";
	const maxFullText = 1024 * 1024;
	let nextFullText = "";
	if (existingFullText.trim()) {
		nextFullText = (existingFullText + "\n\n---\nOCR (visual extraction)\n" + ocrText).slice(0, maxFullText);
	} else {
		nextFullText = ocrText.slice(0, maxFullText);
	}

	try {
		await pool.query(
			`UPDATE documents
			    SET full_text = $2,
			        full_text_absent_reason = NULL,
			        updated_at = now()
			  WHERE id = $1`,
			[documentId, nextFullText]
		);
	} catch {
		return { promoted: false, ocrChars: ocrText.length, pages: seenPages.size, reason: "document_full_text_update_failed" };
	}

	try {
		await mergeDocumentExtractionMetadata({
			documentId,
			patch: {
				search_index: {
					visual_ocr_sha256: sha,
					visual_ocr_promoted_at: new Date().toISOString(),
					visual_ocr_char_count: ocrText.length,
					visual_ocr_pages: seenPages.size,
					trigger_job_id: params.triggerJobId ?? null,
				},
			},
		});
	} catch {
		// best-effort
	}

	try {
		console.log(
			JSON.stringify({
				event: "SEARCH_INDEX_UPDATED",
				deal_id: params.dealId ?? null,
				document_id: documentId,
				method: "postgres_documents_full_text",
				ocr_chars: ocrText.length,
				ocr_pages: seenPages.size,
				trigger_job_id: params.triggerJobId ?? null,
				ts: new Date().toISOString(),
			})
		);
	} catch {
		// ignore
	}

	return { promoted: true, ocrChars: ocrText.length, pages: seenPages.size, reason: "promoted" };
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
registerWorker("render_document_pages", async (job: Job) => {
	const data = (job.data ?? {}) as {
		deal_id?: string;
		document_id?: string;
		page_start?: number;
		page_end?: number;
		force_ocr?: boolean;
		payload?: Record<string, unknown>;
	};
	// Normalize payload shape (tolerate nested payload wrappers).
	const normalized: any = (() => {
		const nested = (data as any)?.payload;
		if (nested && typeof nested === "object" && !Array.isArray(nested)) {
			const merged = { ...(nested as any), ...(data as any) };
			delete (merged as any).payload;
			return merged;
		}
		return data as any;
	})();
	const dealIdSafe = typeof data.deal_id === "string" ? data.deal_id : "";
	const docId = typeof normalized.document_id === "string" ? normalized.document_id : "";
	const pageStartRaw = (normalized as any).page_start;
	const pageEndRaw = (normalized as any).page_end;
	const forceOcr = Boolean((normalized as any).force_ocr);
	const pageStart = typeof pageStartRaw === "number" && Number.isFinite(pageStartRaw) ? Math.max(0, Math.floor(pageStartRaw)) : 0;
	const pageEnd = typeof pageEndRaw === "number" && Number.isFinite(pageEndRaw) ? Math.max(pageStart, Math.floor(pageEndRaw)) : undefined;
	const jobId = job.id ? String(job.id) : null;

	const withTimeout = async <T,>(promise: Promise<T>, ms: number, context: Record<string, unknown>): Promise<T> => {
		let timeout: NodeJS.Timeout | null = null;
		try {
			return await new Promise<T>((resolve, reject) => {
				timeout = setTimeout(() => {
					const stage = typeof context.stage === "string" ? context.stage : "unknown";
					const documentId = typeof context.document_id === "string" ? context.document_id : "";
					const pageIndex = typeof context.page_index === "number" ? context.page_index : null;
					const msg = `TIMEOUT stage=${stage} doc_id=${documentId}${pageIndex == null ? "" : ` page_index=${pageIndex}`}`;
					reject(new Error(`${msg} ms=${ms} context=${JSON.stringify(context)}`));
				}, ms);
				promise.then(resolve, reject);
			});
		} finally {
			if (timeout) clearTimeout(timeout);
		}
	};

	if (!docId) {
		await updateJob(job, "failed", "Missing document_id", 100);
		return { ok: false, reason: "missing_document_id" };
	}

	await updateJob(job, "running", `Rendering pages chunk start=${pageStart} end=${pageEnd ?? "?"}`, 5);

	const pool = getPool();
	let dealIdResolved: string | null = dealIdSafe || null;
	let pageCount: number = 0;
	let renderedPagesPrefixFromMeta: string | null = null;
	const logStage = (stage: string, extra: Record<string, unknown> = {}) => {
		console.log(
			JSON.stringify({
				event: "REEXTRACT_STAGE",
				job_id: jobId,
				deal_id: (dealIdResolved || dealIdSafe || null),
				stage,
				...extra,
			})
		);
	};

	logStage("job_start", {
		document_id: docId,
		page_start: pageStart,
		page_end: pageEnd ?? null,
	});
	try {
		await updateJobProgress(job, {
			stage: "docs_selected",
			current: 0,
			total: 0,
			message: "Starting render",
			meta: {
				idx: 0,
				total: 0,
				document_id: docId,
				page_start: pageStart,
				page_end: pageEnd ?? null,
			},
		});
	} catch {
		// Best-effort progress update.
	}
	try {
		const { rows } = await pool.query<{ page_count: number | null; extraction_metadata: unknown | null; deal_id: string | null }>(
			"SELECT page_count, extraction_metadata, deal_id FROM documents WHERE id = $1 LIMIT 1",
			[sanitizeText(docId)]
		);
		const stored = typeof rows?.[0]?.page_count === "number" && Number.isFinite(rows[0].page_count) ? rows[0].page_count : 0;
		pageCount = stored > 0 ? stored : 0;
		if (!dealIdResolved && typeof rows?.[0]?.deal_id === "string" && rows[0].deal_id.trim()) {
			dealIdResolved = rows[0].deal_id.trim();
		}
		const metaObj = rows?.[0]?.extraction_metadata && typeof rows[0].extraction_metadata === "object" ? (rows[0].extraction_metadata as any) : null;
		const renderedR2 = metaObj?.rendered_pages_r2 && typeof metaObj.rendered_pages_r2 === "object" ? (metaObj.rendered_pages_r2 as any) : null;
		const prefixRaw = typeof renderedR2?.prefix === "string" ? renderedR2.prefix.trim().replace(/\/$/, "") : "";
		if (prefixRaw) {
			// Cleanup guard: if old metadata used /pages, upgrade it for all future writes.
			renderedPagesPrefixFromMeta = prefixRaw.endsWith("/pages") && !prefixRaw.endsWith("/rendered_pages")
				? prefixRaw.replace(/\/pages$/, "/rendered_pages")
				: prefixRaw;
		}
	} catch {
		pageCount = 0;
	}

	// Fetch original bytes so we can render without relying on API filesystem.
	let original: any = null;
	try {
		logStage("pdf_load_start", { document_id: docId });
		original = await withTimeout(
			getDocumentOriginalFile(docId),
			10 * 60_000,
			{ stage: "pdf_load", document_id: docId }
		);
	} catch (err) {
		await updateJob(job, "failed", err instanceof Error ? err.message : "missing original bytes", 100);
		return { ok: false, reason: "missing_original_bytes" };
	}
	const buffer: Buffer | null = original?.bytes && Buffer.isBuffer(original.bytes) ? original.bytes : null;
	if (!buffer || buffer.length === 0) {
		await updateJob(job, "failed", "missing original bytes", 100);
		return { ok: false, reason: "missing_original_bytes" };
	}
	logStage("pdf_load_done", { document_id: docId, bytes: buffer.length });

	const looksLikePdf = (b: Buffer) => b.length >= 5 && b.slice(0, 5).toString("utf8") === "%PDF-";
	let renderBuffer: Buffer = buffer;
	const name = typeof original?.file_name === "string" ? original.file_name : "";
	const mt = typeof original?.mime_type === "string" ? original.mime_type : "";
	const ext = name.toLowerCase().split(".").pop() ?? "";
	const isImage = mt.toLowerCase().startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "tif", "tiff", "bmp"].includes(ext);
	const isPdfLike = looksLikePdf(renderBuffer) || ext === "pdf" || mt.toLowerCase().includes("application/pdf");

	// Images: normalize into a single rendered page and upload as page_0000.png.
	if (isImage) {
		const uploadDir = await resolveWritableUploadDir(process.env);
		const persistCfg = { ...getVisualPageImagePersistConfig(process.env, { forceEnable: true }), enabled: true, persist: true };

		const effectiveStart = 0;
		const effectiveEnd = 1;
		await updateJob(job, "running", `Rendering image page start=${effectiveStart} end=${effectiveEnd}`, 10);
		logStage("render_start", {
			document_id: docId,
			page_start: effectiveStart,
			page_end: effectiveEnd,
			page_count_hint: 1,
		});
		const resImg = await withTimeout(
			persistImagePage({ buffer: renderBuffer, documentId: docId, uploadDir, config: persistCfg, logger: console }),
			10 * 60_000,
			{ stage: "render_image", document_id: docId }
		);
		const totalPages = 1;
		// Upload page_0000.png to R2 and persist metadata using the existing common path.
		const r2Bucket = getR2BucketIfEnabled(process.env);
		const prefix =
			renderedPagesPrefixFromMeta ?? `deals/${(dealIdResolved || dealIdSafe || "unknown")}/documents/${docId}/rendered_pages`;
		if (r2Bucket && resImg.rendered_pages_dir) {
			try {
				const localName = `page_${String(0).padStart(4, "0")}.png`;
				const localPath = path.join(resImg.rendered_pages_dir, localName);
				const bytes = await fs.readFile(localPath);
				if (bytes && bytes.length > 0) {
					await withTimeout(
						uploadToR2({
							bucket: r2Bucket,
							key: r2RenderedPageKey(prefix, 0),
							body: bytes,
							contentType: "image/png",
							env: process.env,
						}),
						120_000,
						{ stage: "upload_page", document_id: docId, page_index: 0, bucket: r2Bucket, prefix }
					);
				}

				await withTimeout(
					mergeDocumentExtractionMetadata({
						documentId: docId,
						patch: {
							rendered_pages_r2: { bucket: r2Bucket, prefix, format: "page_%04d.png" },
							rendered_pages_count: totalPages,
							rendered_pages_rendered: 1,
							rendered_pages_last_chunk: { page_start: 0, page_end: 1 },
						},
					}),
					10 * 60_000,
					{ stage: "ingest", document_id: docId }
				);
			} catch (err) {
				console.warn(
					`[render_document_pages] image R2 upload failed doc=${docId}: ${err instanceof Error ? err.message : String(err)}`
				);
			}
		}

		// Always persist local rendered pages metadata (even if R2 is disabled/unconfigured).
		if (resImg.rendered_pages_dir) {
			try {
				await withTimeout(
					mergeDocumentExtractionMetadata({
						documentId: docId,
						patch: {
							rendered_pages_dir: resImg.rendered_pages_dir,
							rendered_pages_count: 1,
							rendered_pages_rendered: 1,
							rendered_pages_last_chunk: { page_start: 0, page_end: 1 },
							storage_mode: getDocumentStorageMode(process.env),
						},
					}),
					10 * 60_000,
					{ stage: "persist_local_meta", document_id: docId }
				);
			} catch {
				// best-effort
			}
		}

		await updateJob(job, "succeeded", `Rendered image page (1)`, 100);
		logStage("job_complete", {
			document_id: docId,
			rendered: 1,
			total_pages: 1,
		});
		return { ok: true, rendered: 1, total_pages: 1 };
	}

	if (!isPdfLike) {
		const officeExt = (["xlsx", "xls", "pptx", "ppt", "docx", "doc"] as const).includes(ext as any)
			? (ext as any)
			: mt.toLowerCase().includes("spreadsheet")
				? ("xlsx" as const)
				: mt.toLowerCase().includes("presentation")
					? ("pptx" as const)
					: mt.toLowerCase().includes("word")
						? ("docx" as const)
						: null;
		if (officeExt) {
			logStage("office_convert_start", { document_id: docId, ext: officeExt, file_name: name || null, mime_type: mt || null });
			const conv = await withTimeout(
				convertOfficeToPdfBuffer({ buffer: renderBuffer, ext: officeExt, logger: console }),
				10 * 60_000,
				{ stage: "office_convert", document_id: docId, ext: officeExt }
			);
			if (!conv.pdf || conv.pdf.length === 0) {
				await updateJob(job, "failed", `office_to_pdf_failed: ${conv.reason ?? "unknown"}`, 100);
				logStage("office_convert_failed", { document_id: docId, reason: conv.reason ?? null });
				return { ok: false, reason: "office_to_pdf_failed" };
			}
			renderBuffer = conv.pdf;
			logStage("office_convert_done", { document_id: docId, bytes: conv.pdf.length });
		}
	}

	const uploadDir = await resolveWritableUploadDir(process.env);
	const persistCfg = { ...getVisualPageImagePersistConfig(process.env, { forceEnable: true }), enabled: true, persist: true };

	const renderStarted = Date.now();
	logStage("render_start", {
		document_id: docId,
		page_start: pageStart,
		page_end: pageEnd ?? null,
		page_count_hint: pageCount || null,
	});
	const res = await withTimeout(
		persistRenderedPageImages({
			buffer: renderBuffer,
			documentId: docId,
			pageCount: pageCount || 0,
			uploadDir,
			config: persistCfg,
			logger: console,
			pageStart,
			pageEnd,
		}),
		10 * 60_000,
		{ stage: "render", document_id: docId, page_start: pageStart, page_end: pageEnd ?? null }
	);
	logStage("render_done", {
		document_id: docId,
		rendered_pages_written: res.rendered_pages_count ?? 0,
		rendered_pages_dir: res.rendered_pages_dir ?? null,
		duration_ms: Date.now() - renderStarted,
	});

	const totalPages = Math.max(pageCount || 0, res.page_count_detected || 0);
	if (totalPages > 0 && totalPages !== pageCount) {
		try {
			await updateDocumentAnalysis({ documentId: docId, pageCount: totalPages });
			pageCount = totalPages;
		} catch {
			// ignore
		}
	}

	console.log(
		JSON.stringify({
			event: "PDF_RENDERED_PAGES_CHUNK",
			document_id: docId,
			deal_id: dealIdResolved || dealIdSafe || null,
			page_count_total: totalPages || null,
			page_range: { start: pageStart, end: pageEnd ?? null },
			rendered_pages_dir: res.rendered_pages_dir ?? null,
			rendered_pages_chunk_written: res.rendered_pages_count ?? 0,
			duration_ms: Date.now() - renderStarted,
		})
	);

	console.log(
		JSON.stringify({
			event: "RENDER_CHUNK_DONE",
			document_id: docId,
			deal_id: dealIdResolved || dealIdSafe || null,
			page_count_total: totalPages || null,
			page_range: { start: pageStart, end: pageEnd ?? null },
			rendered_pages_chunk_written: res.rendered_pages_count ?? 0,
			duration_ms: Date.now() - renderStarted,
		})
	);

	// Upload just this chunk to R2.
	const r2Bucket = getR2BucketIfEnabled(process.env);
	const prefix =
		renderedPagesPrefixFromMeta ?? `deals/${(dealIdResolved || dealIdSafe || "unknown")}/documents/${docId}/rendered_pages`;
	if (r2Bucket && res.rendered_pages_dir) {
		try {
			const chunkStart = pageStart;
			const chunkEnd = pageEnd ?? (pageCount > 0 ? Math.min(pageCount, pageStart + persistCfg.maxPages) : pageStart + persistCfg.maxPages);
			const chunkTotal = Math.max(0, chunkEnd - chunkStart);
			logStage("upload_start", {
				document_id: docId,
				bucket: r2Bucket,
				prefix,
				page_range: { start: chunkStart, end: chunkEnd },
			});
			for (let i = chunkStart; i < chunkEnd; i += 1) {
				const localName = `page_${String(i).padStart(4, "0")}.png`;
				const localPath = path.join(res.rendered_pages_dir, localName);
				let bytes: Buffer;
				try {
					bytes = await fs.readFile(localPath);
				} catch {
					continue;
				}
				if (!bytes || bytes.length === 0) continue;
				// Throttle UI progress: update every ~2 pages (plus last page).
				if (((i - chunkStart) % 2 === 0) || i === chunkEnd - 1) {
					try {
						await updateJobProgress(job, {
							stage: "render_page",
							current: Math.min(chunkTotal, (i - chunkStart) + 1),
							total: chunkTotal,
							message: `Rendering page ${i + 1}`,
							meta: {
								page_index: i,
								total_pages: totalPages || pageCount || null,
								page_start: chunkStart,
								page_end: chunkEnd,
								document_id: docId,
							},
						});
					} catch {
						// Best-effort progress update.
					}
				}
				logStage("render_page_start", { document_id: docId, page_index: i, bytes: bytes.length });
				await withTimeout(
					uploadToR2({ bucket: r2Bucket, key: r2RenderedPageKey(prefix, i), body: bytes, contentType: "image/png", env: process.env }),
					120_000,
					{ stage: "upload_page", document_id: docId, page_index: i, bucket: r2Bucket, prefix }
				);
				logStage("render_page_done", { document_id: docId, page_index: i });
			}

			// Post-upload verification: ensure a representative mid-document key exists.
			// Specifically requested: verify page 10 for a 15-page doc (this chunk should be 10-15).
			if ((totalPages || pageCount || 0) >= 11 && chunkStart <= 10 && 10 < chunkEnd) {
				const key10 = r2RenderedPageKey(prefix, 10);
				const ok10 = await r2ObjectExists({ bucket: r2Bucket, key: key10, env: process.env });
				if (!ok10) {
					throw new Error(`R2_UPLOAD_VERIFY_FAILED: missing key after upload doc=${docId} key=${key10}`);
				}
			}

			logStage("ingest_start", {
				document_id: docId,
				rendered_pages_count: totalPages || pageCount || 0,
			});
			await withTimeout(
				mergeDocumentExtractionMetadata({
					documentId: docId,
					patch: {
						rendered_pages_r2: { bucket: r2Bucket, prefix, format: "page_%04d.png" },
						// Required: total PDF pages (not just this chunk).
						rendered_pages_count: totalPages || pageCount || 0,
						// Optional: progress (best-effort).
						rendered_pages_rendered: Math.min(totalPages || pageCount || 0, chunkStart + (res.rendered_pages_count ?? 0)),
						rendered_pages_last_chunk: { page_start: chunkStart, page_end: chunkEnd },
					},
				}),
				10 * 60_000,
				{ stage: "ingest", document_id: docId }
			);
			logStage("ingest_done", { document_id: docId });
			logStage("upload_done", { document_id: docId });
		} catch (err) {
			console.warn(
				`[render_document_pages] R2 upload failed doc=${docId}: ${err instanceof Error ? err.message : String(err)}`
			);
		}
	}

	logStage("enqueue_followups_start", {
		document_id: docId,
		page_range: { start: pageStart, end: pageEnd ?? null },
	});

	// Schedule the next chunk (serializes work to avoid OOM).
	const chunkSize = persistCfg.maxPages;
	const total = totalPages || pageCount || 0;
	const thisEnd = pageEnd ?? Math.min(total || (pageStart + chunkSize), pageStart + chunkSize);

	// Always persist local rendered pages metadata (even if R2 is disabled/unconfigured).
	if (res.rendered_pages_dir) {
		try {
			await withTimeout(
				mergeDocumentExtractionMetadata({
					documentId: docId,
					patch: {
						rendered_pages_dir: res.rendered_pages_dir,
						rendered_pages_count: total,
						rendered_pages_rendered: Math.min(total, pageStart + (res.rendered_pages_count ?? 0)),
						rendered_pages_last_chunk: { page_start: pageStart, page_end: thisEnd },
						storage_mode: getDocumentStorageMode(process.env),
					},
				}),
				10 * 60_000,
				{ stage: "persist_local_meta", document_id: docId }
			);
		} catch {
			// best-effort
		}
	}

	if (total > 0 && thisEnd < total) {
		const nextStart = thisEnd;
		const nextEnd = Math.min(total, nextStart + chunkSize);
		try {
			const q = getQueue("render_document_pages");
			await q.add(
				"render_document_pages",
				{ deal_id: dealIdSafe, document_id: docId, page_start: nextStart, page_end: nextEnd, force_ocr: forceOcr },
				{
					jobId: makeJobId("render_document_pages", [docId, `${nextStart}-${nextEnd}`]),
					removeOnComplete: true,
					removeOnFail: false,
				}
			);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			if (!msg.toLowerCase().includes("exists")) {
				console.warn(`[render_document_pages] enqueue next chunk failed doc=${docId}: ${msg}`);
			}
		}
	}

	// If this was the final chunk, trigger visual extraction (best-effort).
	if (total > 0 && thisEnd >= total) {
		// If this render run was part of a needs_ocr flow, mark it completed.
		if (forceOcr) {
			try {
				const { rows } = await pool.query<{ status: string | null; extraction_metadata: unknown | null }>(
					"SELECT status, extraction_metadata FROM documents WHERE id = $1 LIMIT 1",
					[sanitizeText(docId)]
				);
				const status = typeof rows?.[0]?.status === "string" ? rows[0].status.toLowerCase() : "";
				const metaObj = rows?.[0]?.extraction_metadata && typeof rows[0].extraction_metadata === "object" ? (rows[0].extraction_metadata as any) : null;
				const flow = metaObj?.needs_ocr_flow && typeof metaObj.needs_ocr_flow === "object" ? metaObj.needs_ocr_flow : null;
				const flowState = typeof flow?.state === "string" ? String(flow.state) : "";
				const alreadyTerminal = flowState === "completed" || flowState === "reextract_enqueued";
				if (status === "needs_ocr" && flow && !alreadyTerminal) {
					await mergeDocumentExtractionMetadata({
						documentId: docId,
						patch: {
							needs_ocr_flow: {
								...(flow && typeof flow === "object" ? flow : {}),
								state: "completed",
								completed_at: new Date().toISOString(),
								render_completed_job_id: job.id ? String(job.id) : null,
							},
						},
					});
				}

				// Promote needs_ocr docs to ready_for_analysis once rendering has completed.
				// This avoids downstream guard stalls (visual extraction + analysis) when ingest succeeded.
				const metaStatus = typeof metaObj?.status === "string" ? String(metaObj.status).toLowerCase() : "";
				if (status === "needs_ocr" && metaStatus === "succeeded") {
					await pool.query(
						`UPDATE documents
						   SET status = 'ready_for_analysis',
						       ready_for_analysis_at = COALESCE(ready_for_analysis_at, now()),
						       updated_at = now()
						 WHERE id = $1 AND status = 'needs_ocr'`,
						[sanitizeText(docId)]
					);
				}
			} catch {
				// best-effort
			}
		}

		const visionCfg = getVisionExtractorConfig();
		if (visionCfg.enabled) {
			try {
				const visualsQueue = getQueue("extract_visuals");
				const r2BucketConfigured = !!getR2BucketIfEnabled(process.env);
				const effectiveDealId = (dealIdResolved || dealIdSafe || "").trim();
				const dealIdForEnqueue = effectiveDealId || (typeof (job.data as any)?.deal_id === "string" ? String((job.data as any).deal_id) : "");

				// Policy gate: vision worker is last-resort only.
				const routing = await computeAndPersistVisionRoutingV1({
					pool,
					documentId: docId,
					stage: "render_document_pages",
					jobId: job.id ? String(job.id) : null,
					force_ocr: forceOcr,
				});
				const shouldSkip = shouldSkipExtractVisualsAfterRenderV1({
					doc_kind: routing.doc_kind,
					page_count_total: total,
					vision_fallback_allowed: routing.decision.vision_fallback_allowed,
				});
				if (shouldSkip) {
					const nowIso = new Date().toISOString();
					try {
						await mergeDocumentExtractionMetadata({
							documentId: docId,
							patch: {
								extract_visuals_policy_v1: {
									status: "skipped_policy",
									at: nowIso,
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
							event: "RENDER_COMPLETE_SKIPPED_EXTRACT_VISUALS_POLICY",
							document_id: docId,
							deal_id: dealIdForEnqueue || null,
							doc_kind: routing.doc_kind,
							full_text_len: routing.full_text_len,
							reason: routing.decision.reason,
						})
					);
					// Skip enqueue.
				} else {
					if (routing.doc_kind === "pdf" && total > 0 && total <= 80 && !routing.decision.vision_fallback_allowed) {
						console.log(
							JSON.stringify({
								event: "RENDER_COMPLETE_OVERRIDE_EXTRACT_VISUALS_POLICY",
								document_id: docId,
								deal_id: dealIdForEnqueue || null,
								doc_kind: routing.doc_kind,
								page_count_total: total,
								reason: routing.decision.reason,
							})
						);
					}
					const enqueued = await enqueueExtractVisualsIfPossible({
						pool: getPool(),
						queue: visualsQueue,
						config: visionCfg,
						documentId: docId,
						dealId: dealIdForEnqueue || "unknown",
								requireRenderedPagesR2: getDocumentStorageMode(process.env) === "r2" && r2BucketConfigured,
						jobDataOverride: forceOcr ? { force_ocr: true } : undefined,
					});
					if (enqueued) {
						console.log(
							JSON.stringify({
								event: "RENDER_COMPLETE_TRIGGERED_EXTRACTION",
								document_id: docId,
								deal_id: dealIdForEnqueue || null,
								page_count_total: total,
								extract_visuals_enqueued: true,
							})
						);
					}
				}
			} catch (err) {
				console.warn(
					`[render_document_pages] render-complete extraction enqueue failed doc=${docId}: ${err instanceof Error ? err.message : String(err)}`
				);
			}
		}
	}
	logStage("enqueue_followups_done", { document_id: docId });

	await updateJob(job, "succeeded", `Rendered pages chunk (${res.rendered_pages_count ?? 0})`, 100);
	logStage("job_complete", {
		document_id: docId,
		rendered: res.rendered_pages_count ?? 0,
		total_pages: total,
	});
	return { ok: true, rendered: res.rendered_pages_count ?? 0, total_pages: total };
});

registerWorker(QUEUE_NAMES.populate_document_page_understanding, async (job: Job) => {
	return populateDocumentPageUnderstandingProcessor(job);
});

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

registerWorker("extract_visuals", async (job: Job) => {
	const data = (job.data ?? {}) as {
		deal_id?: string;
		document_id?: string;
		document_ids?: string[];
		image_uris?: string[];
		extractor_version?: string;
		force_resegment?: boolean;
		force_reextract?: boolean;
		force_ocr?: boolean;
		enqueue_deep_scan?: boolean;
		page_start?: number;
		page_end?: number;
		chunk?: { page_start?: number; page_end?: number };
		// Some callers wrap job args inside a nested payload object.
		payload?: Record<string, unknown>;
	};
	// Normalize payload shape: allow either top-level fields OR nested `payload` fields.
	// This is important for flags like force_ocr so coordinator-enqueued chunk jobs inherit them.
	const normalized: any = (() => {
		const nested = (data as any)?.payload;
		if (nested && typeof nested === "object" && !Array.isArray(nested)) {
			const merged = { ...(nested as any), ...(data as any) };
			delete (merged as any).payload;
			return merged;
		}
		return data as any;
	})();
	const documentId = typeof normalized.document_id === "string" ? normalized.document_id : undefined;
	const dealId = typeof normalized.deal_id === "string" ? normalized.deal_id : undefined;
	const payload: any = normalized;
	if (!payload.chunk || typeof payload.chunk !== "object") {
		const ps = (payload as any).page_start;
		const pe = (payload as any).page_end;
		if (ps != null && pe != null) {
			payload.chunk = { page_start: ps, page_end: pe };
		}
	}
	const isChunkJob = Boolean(payload.chunk && payload.chunk.page_start != null && payload.chunk.page_end != null);
	const isCoordinator = !isChunkJob;
	let dealIdForAudit: string | undefined = typeof dealId === "string" && dealId.trim().length > 0 ? dealId.trim() : undefined;
	if (!dealIdForAudit) {
		const payloadDealId = typeof (data as any)?.deal_id === "string" ? String((data as any).deal_id).trim() : "";
		dealIdForAudit = payloadDealId.length > 0 ? payloadDealId : undefined;
	}
	const imageUris = Array.isArray(normalized.image_uris) ? normalized.image_uris : undefined;
	const extractorVersionOverride = typeof normalized.extractor_version === "string" ? normalized.extractor_version : undefined;
	const forceResegment = Boolean((normalized as any).force_resegment);
	const forceReextract = Boolean((normalized as any).force_reextract);
	const forceOcr = Boolean((normalized as any).force_ocr);
	const enqueueDeepScan = Boolean((normalized as any).enqueue_deep_scan);
	const pageStartRaw = payload?.chunk?.page_start;
	const pageEndRaw = payload?.chunk?.page_end;
	const requestedPageStart =
		typeof pageStartRaw === "number" && Number.isFinite(pageStartRaw) ? Math.max(0, Math.floor(pageStartRaw)) : 0;
	const requestedPageEnd =
		typeof pageEndRaw === "number" && Number.isFinite(pageEndRaw) ? Math.max(0, Math.floor(pageEndRaw)) : undefined;

	const explicitDocumentIds = Array.isArray(normalized.document_ids)
		? (normalized.document_ids as any[]).filter((id) => typeof id === "string" && id.trim().length > 0)
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
		try {
			await enqueueAnalyzeDeal({
				dealId: dealIdForAudit,
				reason: "extract_visuals_start",
				triggerJobId: job.id ? String(job.id) : null,
				shouldEnqueue: false,
				skipReason: "missing_target_documents",
				extra: {
					document_id: documentId ?? null,
					document_ids: explicitDocumentIds,
				},
			});
		} catch {
			// never block failure reporting
		}
		await updateJob(job, "failed", "Missing document_id (or deal_id with documents)", 100);
		return { ok: false };
	}

	const config = getVisionExtractorConfig();
	if (!config.enabled) {
		try {
			await enqueueAnalyzeDeal({
				dealId: dealIdForAudit,
				reason: "extract_visuals_start",
				triggerJobId: job.id ? String(job.id) : null,
				shouldEnqueue: false,
				skipReason: "visual_extraction_disabled",
				extra: {
					enable_flag: "ENABLE_VISUAL_EXTRACTION",
				},
			});
		} catch {
			// never block
		}
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
			deal_id: dealId ?? null,
			stage: "extract_visuals",
		},
	});

	const visionVerification = await verifyVisionServiceForJob(config.visionWorkerUrl);
	const visionEnabledForJob = config.enabled && visionVerification.ok;
	if (!visionVerification.ok) {
		console.warn(
			JSON.stringify({
				event: "VISION_SERVICE_VERIFICATION_FAILED",
				job_id: job.id ? String(job.id) : null,
				deal_id: dealId ?? null,
				vision_base_url: config.visionWorkerUrl,
				reason: visionVerification.reason ?? "unknown",
				details: visionVerification,
			})
		);
	} else {
		console.log(
			JSON.stringify({
				event: "VISION_SERVICE_VERIFICATION_OK",
				job_id: job.id ? String(job.id) : null,
				deal_id: dealId ?? null,
				vision_base_url: config.visionWorkerUrl,
				details: visionVerification,
			})
		);
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
		try {
			await enqueueAnalyzeDeal({
				dealId: dealIdForAudit,
				reason: "extract_visuals_start",
				triggerJobId: job.id ? String(job.id) : null,
				shouldEnqueue: false,
				skipReason: "visual_tables_missing",
				extra: {
					required_tables: ["visual_assets", "visual_extractions", "evidence_links"],
				},
			});
		} catch {
			// never block
		}
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

	const allowRenderedPagesFallback = (() => {
		const raw = process.env.EXTRACT_VISUALS_ALLOW_RENDERED_PAGES_FALLBACK;
		if (raw != null) return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
		return process.env.NODE_ENV !== "production";
	})();

	let docsBlockedPending = 0;
	const blockedDocs: {
		document_id: string;
		title: string | null;
		deleted_at: string | null;
		type: string | null;
		status: string | null;
		documents_meta_status: string | null;
		extraction_metadata_status: string | null;
		derived_ingest_complete: boolean;
		block_reason: "deleted" | "status_not_ready" | "meta_status_missing" | "meta_status_not_succeeded";
		page_count: number | null;
		has_extraction_metadata: boolean;
		has_original_bytes: boolean;
		has_rendered_pages: boolean;
		reason?: string | null;
	}[] = [];

	let blockedReasonsCount: Record<string, number> = {};

	const hasDocumentsMetaStatusColumn = async (): Promise<boolean> => {
		try {
			const { rows } = await pool.query(
				`SELECT 1 as ok
				   FROM information_schema.columns
				  WHERE table_schema = 'public'
				    AND table_name = 'documents'
				    AND column_name = 'meta_status'
				  LIMIT 1`,
				[]
			);
			return Array.isArray(rows) && rows.length > 0;
		} catch {
			return false;
		}
	};

	const documentsMetaStatusOk = await hasDocumentsMetaStatusColumn();

	try {
		const { rows: metaRows } = await pool.query(
			documentsMetaStatusOk
				? "SELECT id, deal_id, title, type, status, meta_status, page_count, extraction_metadata, deleted_at FROM documents WHERE id = ANY($1)"
				: "SELECT id, deal_id, title, type, status, NULL::text AS meta_status, page_count, extraction_metadata, deleted_at FROM documents WHERE id = ANY($1)",
			[targetDocumentIds]
		);
		const metaMap = new Map<string, any>();
		for (const row of metaRows ?? []) metaMap.set(row.id, row);

		for (const docId of targetDocumentIds) {
			const meta = metaMap.get(docId) ?? {};
			const status = typeof meta.status === "string" ? meta.status : null;
			const deletedAt = meta.deleted_at != null ? String(meta.deleted_at) : null;
			const extractionMetadataStatus = (() => {
				const em = meta.extraction_metadata;
				if (!em || typeof em !== "object") return null;
				const raw = (em as any).status;
				return typeof raw === "string" ? raw : null;
			})();
			const documentsMetaStatus = (() => {
				const raw = (meta as any).meta_status;
				return typeof raw === "string" ? raw : null;
			})();
			// Source of truth: documents.meta_status; fallback: extraction_metadata.status
			const metaStatus = documentsMetaStatus ?? extractionMetadataStatus;

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
				deletedAt,
				metaStatus,
			});
			const bypassIngestGuard =
				allowRenderedPagesFallback &&
				readiness.blocked &&
				readiness.reason === "ingest_not_complete" &&
				hasRenderedPages &&
				deletedAt == null;
			if (readiness.blocked && !bypassIngestGuard) {
				const blockReason = getVisualIngestBlockReason({
					status,
					deletedAt,
					metaStatus,
				});
				const derivedIngestComplete = blockReason == null;
				const br = (blockReason ?? "meta_status_missing") as
					| "deleted"
					| "status_not_ready"
					| "meta_status_missing"
					| "meta_status_not_succeeded";
				blockedReasonsCount[br] = (blockedReasonsCount[br] ?? 0) + 1;

				docsBlockedPending += 1;
				blockedDocs.push({
					document_id: docId,
					title: typeof meta.title === "string" ? meta.title : null,
					deleted_at: deletedAt,
					type: typeof meta.type === "string" ? meta.type : null,
					status,
					documents_meta_status: documentsMetaStatus,
					extraction_metadata_status: extractionMetadataStatus,
					derived_ingest_complete: derivedIngestComplete,
					block_reason: br,
					page_count: pageCount,
					has_extraction_metadata: meta.extraction_metadata != null,
					has_original_bytes: hasOriginalBytes,
					has_rendered_pages: hasRenderedPages,
					reason: readiness.reason,
				});
			} else if (bypassIngestGuard) {
				devLog("worker_extract_visuals_ingest_guard_bypassed", {
					job_id: job.id ? String(job.id) : null,
					deal_id: dealId ?? null,
					document_id: docId,
					reason: "rendered_pages_present",
					status,
					meta_status: metaStatus,
					allow_rendered_pages_fallback: true,
				});
			}
		}
	} catch (err) {
		console.warn(
			`[extract_visuals] guard precheck failed: ${err instanceof Error ? err.message : String(err)}`
		);
	}

	const candidateDocumentIds = [...targetDocumentIds];
	const blockedDocIds = new Set(blockedDocs.map((d) => d.document_id));
	let readyDocumentIds = targetDocumentIds.filter((id) => !blockedDocIds.has(id));
	let docsReady = readyDocumentIds.length;
	let docsBlocked = blockedDocs.length;
	docsBlockedPending = docsBlocked;
	targetDocumentIds = readyDocumentIds;

	const maxDebugDocs = 50;
	let blockedDocsDebug = blockedDocs.slice(0, maxDebugDocs);
	let docsTruncated = blockedDocs.length > maxDebugDocs;
	let blockedDocumentIds = blockedDocs.map((d) => d.document_id);
	let blockedDocumentIdsTruncated = blockedDocumentIds.slice(0, maxDebugDocs);

	if (docsReady === 0) {
		const maxWaitMsRaw = Number(process.env.EXTRACT_VISUALS_WAIT_INGEST_MAX_MS);
		const pollMsRaw = Number(process.env.EXTRACT_VISUALS_WAIT_INGEST_POLL_MS);
		const maxWaitMs = Number.isFinite(maxWaitMsRaw) ? Math.max(0, Math.floor(maxWaitMsRaw)) : 120_000;
		const pollMs = Number.isFinite(pollMsRaw) ? Math.max(250, Math.floor(pollMsRaw)) : 5_000;
		const waitStart = Date.now();
		let attempts = 0;

		const recomputeReadiness = async (): Promise<{
			ready_ids: string[];
			blocked_docs: typeof blockedDocs;
			blocked_reasons_count: Record<string, number>;
		}> => {
			const nextBlockedDocs: typeof blockedDocs = [];
			const nextReasons: Record<string, number> = {};
			try {
				const { rows: metaRows } = await pool.query(
					documentsMetaStatusOk
						? "SELECT id, title, type, status, meta_status, extraction_metadata, deleted_at FROM documents WHERE id = ANY($1)"
						: "SELECT id, title, type, status, NULL::text AS meta_status, extraction_metadata, deleted_at FROM documents WHERE id = ANY($1)",
					[candidateDocumentIds]
				);
				const metaMap = new Map<string, any>();
				for (const row of metaRows ?? []) metaMap.set(row.id, row);
				for (const docId of candidateDocumentIds) {
					const meta = metaMap.get(docId) ?? {};
					const status = typeof meta.status === "string" ? meta.status : null;
					const deletedAt = meta.deleted_at != null ? String(meta.deleted_at) : null;
					const extractionMetadataStatus = (() => {
						const em = meta.extraction_metadata;
						if (!em || typeof em !== "object") return null;
						const raw = (em as any).status;
						return typeof raw === "string" ? raw : null;
					})();
					const documentsMetaStatus = (() => {
						const raw = (meta as any).meta_status;
						return typeof raw === "string" ? raw : null;
					})();
					const metaStatus = documentsMetaStatus ?? extractionMetadataStatus;
					const readiness = evaluateVisualDocReadiness({ id: docId, status, deletedAt, metaStatus });
					if (readiness.blocked) {
						const blockReason = getVisualIngestBlockReason({ status, deletedAt, metaStatus });
						const derivedIngestComplete = blockReason == null;
						const br = (blockReason ?? "meta_status_missing") as
							| "deleted"
							| "status_not_ready"
							| "meta_status_missing"
							| "meta_status_not_succeeded";
						nextReasons[br] = (nextReasons[br] ?? 0) + 1;
						nextBlockedDocs.push({
							document_id: docId,
							title: typeof meta.title === "string" ? meta.title : null,
							deleted_at: deletedAt,
							type: typeof meta.type === "string" ? meta.type : null,
							status,
							documents_meta_status: documentsMetaStatus,
							extraction_metadata_status: extractionMetadataStatus,
							derived_ingest_complete: derivedIngestComplete,
							block_reason: br,
							page_count: null,
							has_extraction_metadata: meta.extraction_metadata != null,
							has_original_bytes: false,
							has_rendered_pages: false,
							reason: readiness.reason,
						});
					}
				}
			} catch (err) {
				console.warn(
					`[extract_visuals] ingest-wait readiness recompute failed: ${err instanceof Error ? err.message : String(err)}`
				);
			}
			const blockedIds = new Set(nextBlockedDocs.map((d) => d.document_id));
			const readyIds = candidateDocumentIds.filter((id) => !blockedIds.has(id));
			return { ready_ids: readyIds, blocked_docs: nextBlockedDocs, blocked_reasons_count: nextReasons };
		};

		await updateJob(job, "running", `Waiting for ingest to complete (docs_blocked=${docsBlocked}/${docsTotal})`, 2);
		await emitJobProgress(job, {
			job_id: job.id ? String(job.id) : "",
			deal_id: dealId ?? undefined,
			stage: "blocked",
			percent: 2,
			message: `Waiting for ingest to complete (docs_blocked=${docsBlocked}/${docsTotal})`,
			reason: "INGEST_NOT_COMPLETE",
			meta: {
				docs_total: docsTotal,
				docs_ready: 0,
				docs_blocked: docsBlocked,
				blocked_document_ids: blockedDocumentIdsTruncated,
				blocked_document_ids_total: blockedDocumentIds.length,
				blocked_reasons_count: blockedReasonsCount,
				wait_max_ms: maxWaitMs,
				wait_poll_ms: pollMs,
			},
		});

		while (docsReady === 0 && Date.now() - waitStart < maxWaitMs) {
			attempts += 1;
			await new Promise<void>((resolve) => setTimeout(resolve, pollMs));
			const snap = await recomputeReadiness();
			readyDocumentIds = snap.ready_ids;
			docsReady = readyDocumentIds.length;
			blockedDocsDebug = snap.blocked_docs.slice(0, maxDebugDocs);
			docsTruncated = snap.blocked_docs.length > maxDebugDocs;
			blockedDocumentIds = snap.blocked_docs.map((d) => d.document_id);
			blockedDocumentIdsTruncated = blockedDocumentIds.slice(0, maxDebugDocs);
			blockedReasonsCount = snap.blocked_reasons_count;
			docsBlocked = snap.blocked_docs.length;
			docsBlockedPending = docsBlocked;

			if (docsReady > 0) {
				break;
			}

			const waitedMs = Date.now() - waitStart;
			await updateJob(
				job,
				"running",
				`Waiting for ingest to complete (attempt=${attempts}, waited=${Math.round(waitedMs / 1000)}s)`,
				2
			);
			await emitJobProgress(job, {
				job_id: job.id ? String(job.id) : "",
				deal_id: dealId ?? undefined,
				stage: "blocked",
				percent: 2,
				message: `Waiting for ingest to complete (attempt=${attempts}, waited=${Math.round(waitedMs / 1000)}s)`,
				reason: "INGEST_NOT_COMPLETE",
				meta: {
					docs_total: docsTotal,
					docs_ready: 0,
					docs_blocked: docsBlocked,
					blocked_document_ids: blockedDocumentIdsTruncated,
					blocked_document_ids_total: blockedDocumentIds.length,
					docs_truncated: docsTruncated,
					blocked_reasons_count: blockedReasonsCount,
					waited_ms: waitedMs,
					attempts,
				},
			});
		}

		if (docsReady === 0) {
			const waitedMs = Date.now() - waitStart;
			const guardPayload = {
				reason: "INGEST_NOT_COMPLETE",
				blocked_docs: blockedDocsDebug,
				blocked_document_ids: blockedDocumentIdsTruncated,
				blocked_document_ids_total: blockedDocumentIds.length,
				docs_total: docsTotal,
				docs_ready: docsReady,
				docs_blocked: docsBlocked,
				docs_truncated: docsTruncated,
				blocked_reasons_count: blockedReasonsCount,
				suggested_action:
					"wait for ingest_documents to complete (or run reconcile-ingest), then re-run extract_visuals",
				diagnostics: {
					docs_total: docsTotal,
					docs_blocked_pending: docsBlockedPending,
					document_file_tables_present: originalFileTablesOk,
					waited_ms: waitedMs,
					wait_max_ms: maxWaitMs,
					wait_poll_ms: pollMs,
				},
			};
			await updateJob(
				job,
				"failed",
				`Visual extraction blocked: ingest not complete after ${Math.round(waitedMs / 1000)}s (docs_blocked=${docsBlocked})`,
				100
			);
			devLog("worker_extract_visuals_finish", {
				job_id: job.id ? String(job.id) : null,
				deal_id: dealId ?? null,
				docs_total: docsTotal,
				docs_blocked_pending: docsBlockedPending,
				guard_triggered: true,
				guard_waited_ms: waitedMs,
				guard_wait_max_ms: maxWaitMs,
				guard_poll_ms: pollMs,
			});
			return { ok: false, ...guardPayload };
		}

		// Ready docs became available; proceed.
		targetDocumentIds = readyDocumentIds;
		await updateJob(
			job,
			"running",
			`Ingest complete for some docs; proceeding (ready=${docsReady}/${docsTotal})`,
			5
		);
		await emitJobProgress(job, {
			job_id: job.id ? String(job.id) : "",
			deal_id: dealId ?? undefined,
			stage: "blocked",
			percent: 5,
			message: `Ingest complete for some docs; proceeding (ready=${docsReady}/${docsTotal})`,
			reason: "INGEST_NOT_COMPLETE",
			meta: {
				docs_total: docsTotal,
				docs_ready: docsReady,
				docs_blocked: docsBlocked,
				blocked_document_ids: blockedDocumentIdsTruncated,
				blocked_document_ids_total: blockedDocumentIds.length,
				docs_truncated: docsTruncated,
				blocked_reasons_count: blockedReasonsCount,
			},
		});
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
	let docsSofficeMissing = 0;
	let docsSyntheticAssetsUsed = 0;
	let docsPdfTextRegionAssetsUsed = 0;
	let docsExcelSkippedVision = 0;
	let docsExcelPyAssetsUsed = 0;
	let pagesVisionAttempted = 0;
	let pagesVisionSucceeded = 0;
	let pagesVisionFailed = 0;
	let pagesWithOcr = 0;
	let pagesSkippedPolicy = 0;
	let docsVisionSkippedPolicy = 0;
	let docsWithVisionFailures = 0;
	let imageUrisBackfilled = 0;
	const docsMissingOriginalBytesIds: string[] = [];
	const docsMissingPageImagesIds: string[] = [];
	let chunksEnqueued = false;
	let chunksEnqueuedCount = 0;
	let chunksEnqueuedAny = false;
	let chunkJobIsLastChunk: boolean | null = null;
	let chunkJobTotalPages: number | null = null;

	for (let docIndex = 0; docIndex < targetDocumentIds.length; docIndex += 1) {
		const docId = targetDocumentIds[docIndex];
		const basePct = Math.min(
			95,
			Math.round(((docIndex / Math.max(1, targetDocumentIds.length)) * 90) + 5)
		);


		let docMeta: {
			deal_id?: string | null;
			type?: string | null;
			mime_type?: string | null;
			extraction_metadata?: unknown;
			structured_data?: unknown;
			full_content?: unknown;
			full_text?: string | null;
			full_text_absent_reason?: string | null;
			page_count?: number | null;
			title?: string | null;
		} | null = null;
		try {
			const { rows } = await pool.query(
				"SELECT deal_id, type, mime_type, title, extraction_metadata, structured_data, full_content, full_text, full_text_absent_reason, page_count FROM documents WHERE id = $1 LIMIT 1",
				[sanitizeText(docId)]
			);
			docMeta = rows?.[0] ?? null;
		} catch {
			// best-effort metadata fetch
		}
		if (!dealIdForAudit && typeof docMeta?.deal_id === "string" && docMeta.deal_id.trim().length > 0) {
			dealIdForAudit = docMeta.deal_id.trim();
		}

		// Resolve page image URIs early so coordinator runs can enqueue chunks and exit without
		// performing any persistence or vision calls.
		let uris: string[] = [];
		if (targetDocumentIds.length === 1 && Array.isArray(imageUris)) {
			uris = imageUris.filter((u) => typeof u === "string" && u.length > 0);
		}
		if (uris.length === 0) {
			uris = await resolvePageImageUris(pool, docId, { env: process.env, logger: console });
		}

		// Confirmation instrumentation: capture what resolvePageImageUris returned in prod.
		try {
			const firstUri = uris.length > 0 ? uris[0] : null;
			const sampleKind = (() => {
				const u = typeof firstUri === "string" ? firstUri.trim() : "";
				if (!u) return "r2_key";
				if (u.startsWith("http://") || u.startsWith("https://")) return "http";
				if (u.startsWith("/uploads/") || u.startsWith("/")) return "file_path";
				return "r2_key";
			})();
			console.log(
				JSON.stringify({
					event: "EXTRACT_VISUALS_URIS_RESOLVED",
					job_id: job.id ? String(job.id) : null,
					deal_id: (typeof dealId === "string" ? dealId : null) ?? null,
					document_id: docId,
					uris_count: uris.length,
					first_uri: typeof firstUri === "string" ? firstUri : null,
					uri_sample_kind: sampleKind,
					ts: new Date().toISOString(),
				})
			);
		} catch {
			// never block extraction on logging
		}

		const docPageCount =
			typeof docMeta?.page_count === "number" && Number.isFinite(docMeta.page_count) ? docMeta.page_count : null;
		const chunkSize = config.maxPages;
		const totalPages = uris.length;
		const totalPagesForChunking = Math.max(totalPages, typeof docPageCount === "number" ? docPageCount : 0);

		// Instrumentation: log the plan immediately after URI resolution so production can prove why
		// we may skip pages (e.g., page_count > uris.length in eventual consistency scenarios).
		try {
			const skipExisting = !forceReextract && !forceOcr;
			const totalPagesForRange = totalPagesForChunking > 0 ? totalPagesForChunking : totalPages;
			const plannedPageStart = Math.min(requestedPageStart, Math.max(0, totalPagesForRange - 1));
			const plannedPageEndExclusive =
				typeof requestedPageEnd === "number"
					? Math.min(Math.max(plannedPageStart, requestedPageEnd), totalPagesForRange)
					: Math.min(plannedPageStart + chunkSize, totalPagesForRange);
			console.log(
				JSON.stringify({
					event: "EXTRACT_VISUALS_DOC_PLAN",
					job_id: job.id ? String(job.id) : null,
					deal_id: (typeof dealId === "string" ? dealId : null) ?? null,
					document_id: docId,
					total_pages: totalPages,
					total_pages_for_range: totalPagesForRange,
					page_range_start: plannedPageStart,
					page_range_end: plannedPageEndExclusive,
					max_pages: chunkSize,
					extractor_version: extractorVersion,
					skip_existing: skipExisting,
					rerun_flags: {
						force_resegment: forceResegment,
						force_reextract: forceReextract,
						force_ocr: forceOcr,
						enqueue_deep_scan: enqueueDeepScan,
					},
					is_coordinator: isCoordinator,
					is_chunk_job: isChunkJob,
					ts: new Date().toISOString(),
				})
			);
		} catch {
			// never block extraction on logging
		}

		// Coordinator behavior: only enqueue chunk jobs and exit without processing pages or finalizing.
		if (isCoordinator) {
			try {
				const parentJobId = job.id ? String(job.id) : null;
				chunksEnqueuedAny = true;
				chunksEnqueued = true;
				const planned = planChunkEnqueues({
					totalPages: totalPagesForChunking > 0 ? totalPagesForChunking : chunkSize,
					chunkSize,
				});
				chunksEnqueuedCount += planned.chunks_enqueued;
				const chunkJobIds: string[] = [];
				for (const range of planned.ranges) {
					const derivedChunkJobId = parentJobId
						? makeJobId("extract_visuals", [
								`parent:${parentJobId}`,
								`doc:${docId}`,
								`range:${range.start}-${range.end}`,
						  ])
						: undefined;
					const persisted = await enqueuePersistedJob({
						type: "extract_visuals",
						...(derivedChunkJobId ? { job_id: derivedChunkJobId } : {}),
						deal_id: dealId ?? (typeof docMeta?.deal_id === "string" ? docMeta.deal_id : undefined),
						document_id: docId,
						parent_job_id: parentJobId,
						page_start: range.start,
						page_end: range.end,
						payload: {
							extractor_version: extractorVersionOverride,
							force_resegment: forceResegment,
							force_reextract: forceReextract,
							force_ocr: forceOcr,
							chunk: { page_start: range.start, page_end: range.end },
						},
					});
					chunkJobIds.push(persisted.job_id);
				}

				// IMPORTANT: Even when chunking, PDF documents may be disallowed for vision fallback
				// (e.g. editable/text PDFs). In that case, chunk jobs will skip vision and persist
				// zero visual_assets/extractions, which would otherwise leave DPU stuck with
				// placeholders (missing_visual_extraction). Persist pdf_v2 shadow assets + per-page
				// understanding here in the coordinator pass so readiness can advance.
				try {
					const docKind = deduceDocKind({ extraction_metadata: docMeta?.extraction_metadata, type: docMeta?.type ?? null });
					const mimeType = typeof docMeta?.mime_type === "string" ? docMeta.mime_type : "";
					const isPdfByMime = mimeType.trim().toLowerCase().startsWith("application/pdf");
					const isPdf = isPdfByMime || (docMeta?.type ?? "").toLowerCase() === "pdf" || docKind === "pdf";
					if (isPdf) {
						// Ensure pdf_v2.pages[*].understanding_v1 exists; persist helpers require it.
						try {
							const fullContent = (docMeta as any)?.full_content ?? {};
							const pdfV2 =
								(fullContent as any)?.pdf_v2 && typeof (fullContent as any).pdf_v2 === "object"
									? (fullContent as any).pdf_v2
									: fullContent;
							const wrapper = {
								pages: Array.isArray((fullContent as any)?.pages) ? (fullContent as any).pages : [],
								pdf_v2: pdfV2,
							};
							const applied = applySlideUnderstandingV1Shadow(wrapper as any);
							if (applied.applied) {
								console.log(JSON.stringify({ event: "PDF_SLIDE_UNDERSTANDING_APPLIED", document_id: docId }));
							}
						} catch (err) {
							console.warn(
								`[extract_visuals] pdf slide understanding apply failed (coordinator) doc=${docId}: ${
									err instanceof Error ? err.message : String(err)
								}`
							);
						}

						try {
							const fullContent = (docMeta as any)?.full_content ?? {};
							const persistedLocal = await persistPdfV2TextRegionAssetsV1Shadow({
								pool,
								documentId: docId,
								dealId: dealId ?? (typeof docMeta?.deal_id === "string" ? docMeta.deal_id : null),
								fullContent,
								env: process.env,
							});
							if (persistedLocal > 0) {
								console.log(JSON.stringify({ event: "PDF_TEXT_REGION_ASSETS_PERSISTED", document_id: docId, persisted_assets: persistedLocal }));
							}
						} catch (err) {
							console.warn(
								`[extract_visuals] pdf text region assets failed (coordinator) doc=${docId}: ${
									err instanceof Error ? err.message : String(err)
								}`
							);
						}

						try {
							const fullContent = (docMeta as any)?.full_content ?? {};
							const res = await persistPdfPageUnderstandingV1Shadow({
								pool,
								documentId: docId,
								dealId: dealId ?? (typeof docMeta?.deal_id === "string" ? docMeta.deal_id : null),
								fullContent,
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
								`[extract_visuals] pdf page understanding failed (coordinator) doc=${docId}: ${
									err instanceof Error ? err.message : String(err)
								}`
							);
						}
					}
				} catch {
					// best-effort only
				}

				console.log(
					JSON.stringify({
						event: "EXTRACT_VISUALS_ENQUEUE",
						deal_id: dealId ?? (typeof docMeta?.deal_id === "string" ? docMeta.deal_id : null) ?? null,
						document_id: docId,
						page_start: 0,
						page_end: totalPagesForChunking,
						chunk_size: chunkSize,
						parent_job_id: parentJobId,
						chunk_job_ids: chunkJobIds,
						chunks_enqueued: planned.chunks_enqueued,
					})
				);

				// Coordinator job: never process pages.
				docsProcessed += 1;
				continue;
			} catch (err) {
				console.warn(
					`[extract_visuals] coordinator failed to enqueue chunk jobs doc=${docId}: ${err instanceof Error ? err.message : String(err)}`
				);
				await updateJob(job, "failed", `Failed to enqueue chunk jobs for doc=${docId}`, 100);
				return { ok: false };
			}
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
		const mimeType = typeof docMeta?.mime_type === "string" ? docMeta.mime_type : "";
		const isPdfByMime = mimeType.trim().toLowerCase().startsWith("application/pdf");
		const isPdf = isPdfByMime || (docMeta?.type ?? "").toLowerCase() === "pdf" || docKind === "pdf";
		const fullTextRaw = typeof docMeta?.full_text === "string" ? docMeta.full_text : "";
		const fullTextIsEmpty = fullTextRaw.trim().length === 0;
		const fullTextAbsentReason = typeof docMeta?.full_text_absent_reason === "string" ? docMeta.full_text_absent_reason : null;
		const extractionMetaObj = (docMeta as any)?.extraction_metadata;
		const ingestMarkedNeedsOcr = (() => {
			if (!extractionMetaObj || typeof extractionMetaObj !== "object") return false;
			const needs = (extractionMetaObj as any).needsOcr;
			if (typeof needs === "boolean") return needs;
			const probeNeeds = (extractionMetaObj as any)?.textProbe?.needsOcr;
			if (typeof probeNeeds === "boolean") return probeNeeds;
			const decision = (extractionMetaObj as any)?.textProbe?.decision;
			return typeof decision === "string" && decision === "text_sparse_needs_ocr";
		})();
		const needsOcr =
			isPdf &&
			(
				forceOcr ||
				ingestMarkedNeedsOcr ||
				fullTextIsEmpty ||
				(typeof fullTextAbsentReason === "string" && fullTextAbsentReason.trim().length > 0)
			);
		const caps = getDocumentCapabilities({ kindHint: docKind });
		if (!caps.supports_visual_extraction) {
			// Explicitly record why this doc is not processed (avoid silent success).
			try {
				await mergeDocumentExtractionMetadata({
					documentId: docId,
					patch: {
						visual_extraction: {
							status: "skipped",
							reason: "capability_visual_not_supported",
							at: new Date().toISOString(),
							kind: caps.kind,
						},
					},
				});
			} catch {
				// best-effort
			}
			docsSkipped += 1;
			continue;
		}
		// From here on, this execution is a chunk job (page-range processing).
		// Note: for non-chunk legacy jobs, coordinator logic above should have enqueued a chunk job instead.
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
		// IMPORTANT: only do this work in the coordinator job (non-chunk) to avoid duplicate writes.
		if (docKind === "pdf" && !isChunkJob) {
			// Ensure pdf_v2.pages[*].understanding_v1 exists; persist helpers require it.
			try {
				const fullContent = docMeta?.full_content ?? {};
				const pdfV2 =
					(fullContent as any)?.pdf_v2 && typeof (fullContent as any).pdf_v2 === "object"
						? (fullContent as any).pdf_v2
						: fullContent;
				const wrapper = {
					pages: Array.isArray((fullContent as any)?.pages) ? (fullContent as any).pages : [],
					pdf_v2: pdfV2,
				};
				const applied = applySlideUnderstandingV1Shadow(wrapper as any);
				if (applied.applied) {
					console.log(
						JSON.stringify({
							event: "PDF_SLIDE_UNDERSTANDING_APPLIED",
							document_id: docId,
						})
					);
				}
			} catch (err) {
				console.warn(
					`[extract_visuals] pdf slide understanding apply failed doc=${docId}: ${err instanceof Error ? err.message : String(err)}`
				);
			}

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

		const totalPagesForRange = totalPagesForChunking > 0 ? totalPagesForChunking : totalPages;
		const pageStart = Math.min(requestedPageStart, Math.max(0, totalPagesForRange - 1));
		const pageEndExclusive =
			typeof requestedPageEnd === "number"
				? Math.min(Math.max(pageStart, requestedPageEnd), totalPagesForRange)
				: Math.min(pageStart + chunkSize, totalPagesForRange);

		const dpuVersion = "page_understanding_v1";

		let dpuAttemptedForDoc = false;
		const tryPopulateDpuForChunkRange = async (reason: string) => {
			if (dpuAttemptedForDoc) return;
			dpuAttemptedForDoc = true;
			try {
				let dbHost: string | null = null;
				let dbName: string | null = null;
				try {
					const meta = await pool.query<{ db_host: string | null; db_name: string }>(
						"SELECT inet_server_addr()::text AS db_host, current_database() AS db_name"
					);
					dbHost = meta.rows?.[0]?.db_host ?? null;
					dbName = meta.rows?.[0]?.db_name ?? null;
				} catch {
					// ignore metadata failures; DPU population should still proceed
				}

				console.log(
					JSON.stringify({
						event: "POPULATE_DOCUMENT_PAGE_UNDERSTANDING_CALL",
						document_id: docId,
						page_start: pageStart,
						page_end: pageEndExclusive,
						version: dpuVersion,
						db_host: dbHost,
						db_name: dbName,
						ts: new Date().toISOString(),
					})
				);

				const res = await populateDocumentPageUnderstandingFromVisualExtractions(pool as any, {
					documentId: docId,
					dealId: derivedDealId ?? undefined,
					pageStart,
					pageEnd: pageEndExclusive,
					version: dpuVersion,
				});
				console.log(
					JSON.stringify({
						event: "POPULATE_DOCUMENT_PAGE_UNDERSTANDING",
						deal_id: derivedDealId ?? null,
						document_id: docId,
						page_start: pageStart,
						page_end: pageEndExclusive,
						upserted: res.upserted,
						page_text_empty: res.page_text_empty,
						version: dpuVersion,
						reason,
						ts: new Date().toISOString(),
					})
				);

				// Deterministic fact promotion: extract obvious raise + business model facts from DPU payloads.
				if (derivedDealId) {
					try {
						const promoted = await promoteSlideFactsFromDocumentPageUnderstanding(pool as any, {
							dealId: derivedDealId,
							documentId: docId,
							pageStart,
							pageEnd: pageEndExclusive,
							version: dpuVersion,
						});
						const attempted = Array.isArray(promoted.facts) ? promoted.facts.length : 0;
						if (attempted <= 0) {
							console.warn(
								JSON.stringify({
									event: "PROMOTE_SLIDE_FACTS_ZERO_FACTS",
									deal_id: derivedDealId,
									document_id: docId,
									page_start: pageStart,
									page_end: pageEndExclusive,
									version: dpuVersion,
									attempted,
									inserted: promoted.inserted,
									updated: promoted.updated,
									warnings: promoted.warnings,
									ts: new Date().toISOString(),
								})
							)
						}
						console.log(
							JSON.stringify({
								event: "PROMOTE_SLIDE_FACTS",
								deal_id: derivedDealId,
								document_id: docId,
								page_start: pageStart,
								page_end: pageEndExclusive,
								attempted,
								inserted: promoted.inserted,
								updated: promoted.updated,
								fact_types: promoted.facts.map((f) => f.fact_type),
								warnings: promoted.warnings,
								ts: new Date().toISOString(),
							})
						);
					} catch (err) {
						console.warn(
							`[extract_visuals] promote_slide_facts failed doc=${docId} range=${pageStart}-${pageEndExclusive}: ${
								err instanceof Error ? err.message : String(err)
							}`
						);
					}
				}
			} catch (err) {
				console.warn(
					`[extract_visuals] populate_document_page_understanding chunk failed doc=${docId} range=${pageStart}-${pageEndExclusive}: ${
						err instanceof Error ? err.message : String(err)
					}`
				);
			}
		};

		if (targetDocumentIds.length === 1) {
			chunkJobTotalPages = totalPagesForChunking;
			chunkJobIsLastChunk = typeof requestedPageEnd === "number" && Number.isFinite(requestedPageEnd)
				? requestedPageEnd >= totalPagesForChunking
				: pageEndExclusive >= totalPagesForChunking;
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
					const url = await pickDownloadUrlFromExtractionMetadata(docMeta.extraction_metadata);
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

				const uploadDir = await resolveWritableUploadDir(process.env);
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

					// Best-effort: store count/timestamp even if we ultimately rely on R2 URLs.
					try {
						await mergeDocumentExtractionMetadata({
							documentId: docId,
							patch: {
								rendered_pages_count: renderRes.rendered_pages_count,
								rendered_pages_created_at: renderRes.rendered_pages_created_at,
								rendered_pages_max_pages: renderRes.rendered_pages_max_pages,
								rendered_pages_format: renderRes.rendered_pages_format,
							},
						});
					} catch {
						// best-effort
					}

					if (!existingPageCount && renderRes.page_count_detected && renderRes.page_count_detected > 0) {
						await pool.query(
							"UPDATE documents SET page_count = $2, updated_at = now() WHERE id = $1 AND (page_count IS NULL OR page_count <= 0)",
							[docId, renderRes.page_count_detected]
						);
					}

					// Critical for separated API+worker deployments: persist rendered pages to R2 so both services
					// can access page images via HTTP(S) URLs.
					try {
						const r2Bucket = (process.env.R2_BUCKET || "").trim();
						const dealIdForPrefix = dealId ?? (typeof docMeta?.deal_id === "string" ? docMeta.deal_id : null);
						const prefix = dealIdForPrefix
							? `deals/${dealIdForPrefix}/documents/${docId}/rendered_pages`
							: `documents/${docId}/rendered_pages`;
						if (r2Bucket && renderRes.rendered_pages_dir) {
							let names: string[] = [];
							try {
								names = await fs.readdir(renderRes.rendered_pages_dir);
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
								const localPath = path.join(renderRes.rendered_pages_dir, f.name);
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
							`[extract_visuals] rendered page R2 upload failed doc=${docId}: ${
								err instanceof Error ? err.message : String(err)
							}`
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

					// If LibreOffice isn't installed (soffice missing), treat Office rendering as a skipped path
					// with an explicit reason so jobs don't silently do nothing.
					if (renderRes.reason === "soffice_missing" && docKind === "excel") {
						docsSofficeMissing += 1;
						try {
							await mergeDocumentExtractionMetadata({
								documentId: docId,
								patch: {
									visual_extraction: {
										status: "skipped",
										reason: "soffice_missing",
										at: new Date().toISOString(),
										file_ext: fileExt,
									},
								},
							});
						} catch {
							// best-effort
						}
					}

					uris = await resolvePageImageUris(pool, docId, { env: process.env, logger: console });
				}

				// Image docs: normalize into rendered_pages/page_0000.png
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
					// Even when we have no page images (vision skipped), synthetic visual_extractions may exist.
					// Always attempt DPU population for this chunk range.
					await tryPopulateDpuForChunkRange("synthetic_only_no_page_images");
					docsProcessed += 1;
					continue;
				}

				// Self-heal: if this doc supports rendering, enqueue render_document_pages and retry later.
				if (caps.supports_page_rendering) {
					try {
						const persistCfg = { ...getVisualPageImagePersistConfig(process.env, { forceEnable: true }), enabled: true, persist: true };
						const range = getInitialRenderedPagesChunk({
							capabilities: caps,
							maxPagesPerChunk: persistCfg.maxPages,
							totalPagesHint: docPageCount,
						});
						const dealIdForRender = dealId ?? (typeof (docMeta as any)?.deal_id === "string" ? String((docMeta as any).deal_id) : undefined);
						if (range && dealIdForRender) {
							const q = getQueue("render_document_pages");
							await q.add(
								"render_document_pages",
								{
									deal_id: dealIdForRender,
									document_id: docId,
									page_start: range.page_start,
									page_end: range.page_end,
									force_ocr: forceOcr,
								},
								{
									jobId: makeJobId("render_document_pages", [docId, `${range.page_start}-${range.page_end}`]),
									removeOnComplete: true,
									removeOnFail: false,
								}
							);
						}
						await mergeDocumentExtractionMetadata({
							documentId: docId,
							patch: {
								visual_extraction: {
									status: "blocked",
									reason: "render_enqueued_missing_pages",
									at: new Date().toISOString(),
								},
							},
						});
					} catch {
						// best-effort
					}
					throw new Error(`RETRYABLE_NO_PAGE_IMAGES_AVAILABLE: render enqueued (doc=${docId})`);
				}

				docsMissingPageImages += 1;
				docsMissingPageImagesIds.push(docId);
				try {
					await mergeDocumentExtractionMetadata({
						documentId: docId,
						patch: {
							visual_extraction: {
								status: "skipped",
								reason: "NO_PAGE_IMAGES_AVAILABLE",
								at: new Date().toISOString(),
							},
						},
					});
				} catch {
					// best-effort
				}
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
				dealId: String(dealId ?? ""),
				jobId: String(job.id ?? ""),
				documentId: docId,
				pageImageUris: uris,
				structuredExtractorVersion: structuredExtractorVersion,
				visionConfig: config,
				visionRuntime,
				env: process.env,
				logger: console,
				forceReextract,
			});
			// Always emit summary log, even if attempted=0.
			console.log(
				JSON.stringify({
					event: "STRUCTURED_POWERPOINT_VISION_HINTS",
					document_id: docId,
					attempted: res.attempted,
					skipped_has_content: (res as any).skipped_has_content ?? 0,
					skipped_existing: (res as any).skipped_existing ?? 0,
					updated: res.updated,
					errors: res.errors,
				})
			);
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
						const xlsxStartMs = Date.now();
						console.log(
							JSON.stringify({
								event: "XLSX_CANONICAL_ATTEMPT",
								document_id: docId,
								deal_id: dealId ?? null,
								job_id: String(job.id ?? ""),
								extractor_version: excelPyExtractorVersion,
								ts: new Date().toISOString(),
							})
						);
						const xlsxResult = await callXlsxWorkerWithRetries(config, {
							document_id: docId,
							xlsx_b64: original.bytes.toString("base64"),
							extractor_version: excelPyExtractorVersion,
							max_sheets: 50,
							max_tables_per_sheet: 24,
						}, {
							logMeta: { deal_id: dealId, job_id: String(job.id ?? "") },
						});
						const xlsxDurationMs = Date.now() - xlsxStartMs;
						if (!xlsxResult.ok) {
							try {
								await mergeDocumentExtractionMetadata({
									documentId: docId,
									patch: buildXlsxCanonicalPatch({ result: xlsxResult, pagesPersisted: 0, durationMs: xlsxDurationMs }),
								});
							} catch {
								// best-effort — don't let metadata write block pipeline
							}
							console.log(
								JSON.stringify({
									event: "XLSX_CANONICAL_RESULT",
									document_id: docId,
									deal_id: dealId ?? null,
									job_id: String(job.id ?? ""),
									status: "failed",
									code: xlsxResult.code,
									message: xlsxResult.message,
									duration_ms: xlsxDurationMs,
									ts: new Date().toISOString(),
								})
							);
						}
						if (xlsxResult.ok) {
							const xlsxPages = xlsxResult.payload?.pages ?? [];
							let persistedLocal = 0;
							for (const page of xlsxPages) {
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
							const canonicalPatch = buildXlsxCanonicalPatch({ result: xlsxResult, pagesPersisted: persistedLocal, durationMs: xlsxDurationMs });
							try {
								await mergeDocumentExtractionMetadata({
									documentId: docId,
									patch: canonicalPatch,
								});
							} catch {
								// best-effort — don't let metadata write block pipeline
							}
							console.log(
								JSON.stringify({
									event: "XLSX_CANONICAL_RESULT",
									document_id: docId,
									deal_id: dealId ?? null,
									job_id: String(job.id ?? ""),
									status: canonicalPatch.xlsx.status,
									pages_returned: canonicalPatch.xlsx.pages_returned ?? 0,
									pages_persisted: canonicalPatch.xlsx.pages_persisted ?? 0,
									duration_ms: xlsxDurationMs,
									ts: new Date().toISOString(),
								})
							);
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
							visionRuntime,
							env: process.env,
						});
						if (syntheticPersisted > 0) {
							docsSyntheticAssetsUsed += 1;
							persisted += syntheticPersisted;
						}
						// Record that synthetic fallback was used so downstream can distinguish
						// "XLSX not attempted" from "XLSX attempted and succeeded".
						try {
							await mergeDocumentExtractionMetadata({
								documentId: docId,
								patch: {
									xlsx: {
										attempted: false,
										status: "synthetic_fallback",
										pages_persisted: syntheticPersisted,
										updated_at: new Date().toISOString(),
									},
								},
							});
						} catch {
							// best-effort
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

		// If vision is unavailable for this job, skip vision calls but still keep the pipeline explicit.
		if (!visionEnabledForJob) {
			try {
				await mergeDocumentExtractionMetadata({
					documentId: docId,
					patch: {
						visual_extraction: {
							status: "skipped",
							reason: "vision_unavailable",
							at: new Date().toISOString(),
							vision_base_url: config.visionWorkerUrl,
							verification: visionVerification,
						},
					},
				});
			} catch {
				// best-effort
			}
			if ((syntheticPersisted + pdfTextRegionPersisted) <= 0) {
				docsSkipped += 1;
			}
			continue;
		}

		let derivedDealId: string | null =
			typeof dealId === "string" && dealId.trim().length > 0
				? dealId.trim()
				: (typeof docMeta?.deal_id === "string" && docMeta.deal_id.trim().length > 0 ? docMeta.deal_id.trim() : null);
		if (!derivedDealId && typeof dealIdForAudit === "string" && dealIdForAudit.trim().length > 0) {
			derivedDealId = dealIdForAudit.trim();
		}
		if (!derivedDealId) {
			// Last-resort: ensure we can still log deal_id even if docMeta fetch failed earlier.
			try {
				const { rows } = await pool.query<{ deal_id: string | null }>(
					"SELECT deal_id FROM documents WHERE id = $1 LIMIT 1",
					[sanitizeText(docId)]
				);
				const rowDealId = rows?.[0]?.deal_id;
				if (typeof rowDealId === "string" && rowDealId.trim().length > 0) derivedDealId = rowDealId.trim();
			} catch {
				// best-effort
			}
		}
		if (!derivedDealId) {
			console.warn(
				JSON.stringify({
					event: "VISION_REQUEST_MISSING_DEAL_ID",
					job_id: job.id ? String(job.id) : null,
					document_id: docId,
					job_deal_id: typeof dealId === "string" ? dealId : null,
					doc_meta: docMeta && typeof docMeta === "object" ? docMeta : null,
				})
			);
		}

		const routing = await computeAndPersistVisionRoutingV1({
			pool,
			documentId: docId,
			stage: "extract_visuals",
			jobId: job.id ? String(job.id) : null,
			force_ocr: forceOcr,
		});
		const baseVisionFallbackAllowedForDoc = routing.decision.vision_fallback_allowed;
		const visionFallbackAllowedForDoc = baseVisionFallbackAllowedForDoc;
		if (!baseVisionFallbackAllowedForDoc) {
			docsVisionSkippedPolicy += 1;
			try {
				await mergeDocumentExtractionMetadata({
					documentId: docId,
					patch: {
						extract_visuals_policy_v1: {
							status: "vision_disallowed",
							at: new Date().toISOString(),
							vision_fallback_allowed: false,
							reason: routing.decision.reason,
						},
					},
				});
			} catch {
				// best-effort
			}
		}

		const pagesInJob = Math.max(0, pageEndExclusive - pageStart);
		console.log(
			JSON.stringify({
				event: "VISION_REQUEST_DOC_START",
				deal_id: derivedDealId,
				document_id: docId,
				doc_kind: docKind,
				mime_type: mimeType,
				pages_in_job: pagesInJob,
				total_pages: totalPages,
				sample_image_uri: uris[pageStart] ?? null,
				vision_base_url: config.visionWorkerUrl,
				extractor_version: extractorVersion,
				needs_ocr: needsOcr,
				ocr_flags: needsOcr ? { include_ocr: true, mode: "ocr", return_blocks: true, return_structured: true } : {},
			})
		);
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

		const existingVisualExtraction = (() => {
			const em = docMeta?.extraction_metadata;
			const ve = em && typeof em === "object" ? (em as any).visual_extraction : null;
			return ve && typeof ve === "object" ? ve : {};
		})();
		let docVisionAttempted = 0;
		let docVisionSucceeded = 0;
		let docPagesSkippedExisting = 0;
		let docPagesWithOcr = 0;
		const docVisionFailures: Array<{ page_index: number; reason: string; attempts: any[] }> = [];

		let pagesCompletedInJob = 0;
		let lastReportedCompleted = 0;
		let lastSkipReportMs = 0;
		let docPagesConsidered = 0;
		let docPagesSkipped = 0;
		let docPagesProcessed = 0;
		let docVisionCallsStarted = 0;
		let docVisionCallsDone = 0;

		for (let i = pageStart; i < pageEndExclusive; i += 1) {
			docPagesConsidered += 1;
			let visionStartedForPage = false;
			try {
			if (!visionFallbackAllowedForDoc) {
				pagesSkippedPolicy += 1;
				docPagesSkipped += 1;
				pagesCompletedInJob += 1;
				try {
					console.log(
						JSON.stringify({
							event: "EXTRACT_VISUALS_PAGE_SKIPPED",
							job_id: job.id ? String(job.id) : null,
							deal_id: derivedDealId ?? null,
							document_id: docId,
							page_index: i,
							reason_code: "other",
							ts: new Date().toISOString(),
						})
					);
				} catch {
					// ignore
				}
				const nowMs = Date.now();
				const shouldReport =
					(pagesCompletedInJob - lastReportedCompleted) >= 3 ||
					lastSkipReportMs === 0 ||
					nowMs - lastSkipReportMs >= 1500 ||
					pagesCompletedInJob >= pagesInJob;
				if (shouldReport) {
					lastReportedCompleted = pagesCompletedInJob;
					lastSkipReportMs = nowMs;
					await updateJobProgress(job, {
						stage: "extract_visual_assets",
						current: Math.min(pagesInJob, pagesCompletedInJob),
						total: pagesInJob,
						message: `Skipping by policy page ${i + 1}/${totalPages}`,
						page_start: pageStart,
						page_end: pageEndExclusive,
						meta: {
							document_id: docId,
							page_index: i,
							skipped_policy: true,
							reason: routing.decision.reason,
							range: { start: pageStart, end: pageEndExclusive },
						},
					});
				}
				continue;
			}

			// If doc_page_count > uris.length, the loop may iterate beyond resolved image URIs.
			if (i >= uris.length) {
				docPagesSkipped += 1;
				pagesCompletedInJob += 1;
				try {
					console.log(
						JSON.stringify({
							event: "EXTRACT_VISUALS_PAGE_SKIPPED",
							job_id: job.id ? String(job.id) : null,
							deal_id: derivedDealId ?? null,
							document_id: docId,
							page_index: i,
							reason_code: "out_of_range",
							ts: new Date().toISOString(),
						})
					);
				} catch {
					// ignore
				}
				continue;
			}
			// Defensive: for R2-backed rendered pages, verify the object exists before calling vision.
			// If missing, enqueue the render chunk and throw so BullMQ retries after render completes.
			const renderedR2 =
				docMeta?.extraction_metadata && typeof (docMeta.extraction_metadata as any)?.rendered_pages_r2 === "object"
					? ((docMeta.extraction_metadata as any).rendered_pages_r2 as any)
					: null;
			let resolvedR2Bucket: string | null = null;
			let resolvedR2Key: string | null = null;
			if (renderedR2) {
				const resolvedBucket =
					typeof renderedR2.bucket === "string" && renderedR2.bucket.trim()
						? renderedR2.bucket.trim()
						: (process.env.R2_BUCKET || "").trim() || null;
				const resolvedPrefix = typeof renderedR2.prefix === "string" ? renderedR2.prefix.trim().replace(/\/$/, "") : "";
				const resolvedKey = resolvedPrefix ? formatRenderedPageKey({ prefix: resolvedPrefix, format: renderedR2.format, pageIndex: i }) : "";
				resolvedR2Bucket = resolvedBucket;
				resolvedR2Key = resolvedKey || null;

				if (resolvedBucket && resolvedKey) {
					const exists = await r2ObjectExists({ bucket: resolvedBucket, key: resolvedKey, env: process.env });
					if (!exists) {
						const persistCfg = { ...getVisualPageImagePersistConfig(process.env, { forceEnable: true }), enabled: true, persist: true };
						const renderChunkSize = persistCfg.maxPages;
						const totalForChunk = typeof docPageCount === "number" && docPageCount > 0 ? docPageCount : totalPages;
						const range = computeChunkRangeForPage({ pageIndex: i, totalPages: totalForChunk, chunkSize: renderChunkSize });
						const dealIdForRender = derivedDealId ?? undefined;

						console.log(
							JSON.stringify({
								event: "VISION_PAGE_MISSING_TRIGGER_RENDER",
								deal_id: dealIdForRender ?? null,
								document_id: docId,
								page_index: i,
								resolved_bucket: resolvedBucket,
								resolved_prefix: resolvedPrefix,
								resolved_key: resolvedKey,
								vision_service_url: config.visionWorkerUrl,
								render_chunk: range,
								parent_job_id: job.id ? String(job.id) : null,
							})
						);

						if (dealIdForRender) {
							try {
								const q = getQueue("render_document_pages");
								await q.add(
									"render_document_pages",
									{ deal_id: dealIdForRender, document_id: docId, page_start: range.start, page_end: range.end },
												{
													jobId: makeJobId("render_document_pages", [docId, `${range.start}-${range.end}`]),
													removeOnComplete: true,
													removeOnFail: false,
												}
								);
							} catch (err) {
								const msg = err instanceof Error ? err.message : String(err);
								if (!msg.toLowerCase().includes("exists")) {
									console.warn(`[extract_visuals] render enqueue on missing page failed doc=${docId}: ${msg}`);
								}
							}
						}

						throw new Error(`RETRYABLE_VISION_PAGE_MISSING: missing rendered page (doc=${docId} page=${i}) - render enqueued`);
					}
				}
			}

			const image_uri = uris[i];
			if (typeof image_uri !== "string" || image_uri.trim().length === 0) {
				docPagesSkipped += 1;
				pagesCompletedInJob += 1;
				try {
					console.log(
						JSON.stringify({
							event: "EXTRACT_VISUALS_PAGE_SKIPPED",
							job_id: job.id ? String(job.id) : null,
							deal_id: derivedDealId ?? null,
							document_id: docId,
							page_index: i,
							reason_code: "page_missing_uri",
							ts: new Date().toISOString(),
						})
					);
				} catch {
					// ignore
				}
				continue;
			}
			const signedUrlPrefix = (() => {
				if (typeof image_uri !== "string" || !image_uri) return null;
				try {
					const u = new URL(image_uri);
					const pathParts = u.pathname.split("/").filter(Boolean);
					if (pathParts.length <= 1) return `${u.origin}${u.pathname}`;
					pathParts.pop();
					return `${u.origin}/${pathParts.join("/")}`;
				} catch {
					const q = image_uri.indexOf("?");
					const noQuery = q >= 0 ? image_uri.slice(0, q) : image_uri;
					const lastSlash = noQuery.lastIndexOf("/");
					return lastSlash > 0 ? noQuery.slice(0, lastSlash) : noQuery;
				}
			})();
			const signedUrlPrefixKind = renderedR2
				? "rendered_pages"
				: typeof signedUrlPrefix === "string" && signedUrlPrefix.includes("rendered_pages")
					? "rendered_pages"
					: "pages";
			const image_b64 = await tryReadImageB64ForVision(image_uri, process.env);
			const safe_image_uri =
				image_b64 && (image_uri.startsWith("http://") || image_uri.startsWith("https://"))
					? undefined
					: image_uri;

			const pageExtractorVersion = extractorVersion;

			// If we've already extracted this page for this extractor version, don't re-run.
			// This prevents repeated OCR/vision-understanding passes on the same slide across extractions.
			// IMPORTANT: We require a visual_extractions row to confirm OCR/vision actually ran.
			// A visual_assets row alone is NOT sufficient — it can exist when vision was skipped
			// (e.g., audit status="skipped", reason="vision_unavailable"). In that case we must
			// re-attempt so that visual_extractions rows are produced for downstream evidence.
			if (!forceReextract && !forceOcr) {
				// If the doc-level audit recorded a skipped or failed extraction, treat every page
				// as not-extracted regardless of what visual_assets contains. This covers the case
				// where vision was unavailable when assets were first written.
				// Pull all three audit signals for robust failure detection.
				const docAuditStatus =
					typeof existingVisualExtraction?.status === "string"
						? existingVisualExtraction.status
						: null;
				const docAuditReason =
					typeof existingVisualExtraction?.reason === "string"
						? existingVisualExtraction.reason
						: null;
				const docAuditHealthStatus =
					typeof existingVisualExtraction?.health_status === "number"
						? existingVisualExtraction.health_status
						: null;

				// Fast-path: if the audit already tells us vision failed, bypass the DB query.
				// isAuditVisionFailure covers status strings, reason substrings, and HTTP codes.
				const docAuditFailed = isAuditVisionFailure({
					status: docAuditStatus,
					reason: docAuditReason,
					healthStatus: docAuditHealthStatus,
				});

				if (!docAuditFailed) {
					try {
						// Query returns one aggregate row with two boolean flags:
						//   has_va  – a visual_assets row exists for this page + extractor version
						//   has_ve  – a visual_extractions row exists (OCR/vision actually ran)
						//
						// Using LEFT JOIN + aggregate lets us fire the canary log when va exists
						// but ve is absent — the exact signature of the old bug.
						//
						// Extractor-version aware: both va and ve_row are filtered on $3 so a
						// page reprocessed with a newer extractor is never incorrectly skipped.
						const { rows } = await pool.query(
							`
								SELECT
								  (COUNT(va.id) > 0)               AS has_va,
								  (COUNT(ve_row.visual_asset_id) > 0) AS has_ve
								  FROM visual_assets va
								  LEFT JOIN visual_extractions ve_row
								    ON ve_row.visual_asset_id = va.id
								   AND ve_row.extractor_version = $3
								 WHERE va.document_id = $1
								   AND va.page_index = $2
								   AND va.extractor_version = $3
							`,
							[sanitizeText(docId), i, sanitizeText(pageExtractorVersion)]
						);
						const hasVisualAssetRow      = rows[0]?.has_va === true;
						const hasVisualExtractionRow = rows[0]?.has_ve === true;

						// Canary guardrail: log the old-bug signature so it is detectable in
						// production logs even if somehow the fix regresses. This event MUST
						// never continue to a `skip` decision (the gate below prevents it).
						if (hasVisualAssetRow && !hasVisualExtractionRow) {
							try {
								console.log(
									JSON.stringify({
										event: "EXTRACT_VISUALS_SKIPPED_WITHOUT_VE_ROW",
										job_id: job.id ? String(job.id) : null,
										deal_id: derivedDealId ?? null,
										document_id: docId,
										page_index: i,
										extractor_version: pageExtractorVersion,
										doc_audit_status: docAuditStatus,
										doc_audit_reason: docAuditReason,
										note: "visual_assets row exists but visual_extractions absent — will NOT skip (regression guard)",
										ts: new Date().toISOString(),
									})
								);
							} catch {
								// ignore
							}
						}

						if (shouldSkipExtractVisualsPage({
							docAuditStatus,
							docAuditReason,
							docAuditHealthStatus,
							hasVisualExtractionRow,
						})) {
							pagesSkippedExisting += 1;
							docPagesSkippedExisting += 1;
							docPagesSkipped += 1;
							pagesCompletedInJob += 1;
							try {
								console.log(
									JSON.stringify({
										event: "EXTRACT_VISUALS_PAGE_SKIPPED",
										job_id: job.id ? String(job.id) : null,
										deal_id: derivedDealId ?? null,
										document_id: docId,
										page_index: i,
										reason_code: "already_has_visual_extraction",
										has_visual_extractions: hasVisualExtractionRow,
										extractor_version: pageExtractorVersion,
										doc_audit_status: docAuditStatus,
										doc_audit_reason: docAuditReason,
										ts: new Date().toISOString(),
									})
								);
							} catch {
								// ignore
							}
						const nowMs = Date.now();
						const shouldReport =
							(pagesCompletedInJob - lastReportedCompleted) >= 3 ||
							lastSkipReportMs === 0 ||
							nowMs - lastSkipReportMs >= 1500 ||
							pagesCompletedInJob >= pagesInJob;
						if (shouldReport) {
							lastReportedCompleted = pagesCompletedInJob;
							lastSkipReportMs = nowMs;
							await updateJobProgress(job, {
								stage: "extract_visual_assets",
								current: Math.min(pagesInJob, pagesCompletedInJob),
								total: pagesInJob,
								message: `Skipping existing page ${i + 1}/${totalPages}`,
								page_start: pageStart,
								page_end: pageEndExclusive,
								meta: {
									document_id: docId,
									page_index: i,
									skipped_existing: true,
									range: { start: pageStart, end: pageEndExclusive },
								},
							});
						}
						continue;
					}
				} catch (err) {
					// Best-effort: if precheck fails, proceed with extraction rather than skipping.
					console.warn(
						`[extract_visuals] existing-page precheck failed doc=${docId} page=${i}: ${err instanceof Error ? err.message : String(err)}`
					);
				}
				} // end if (!docAuditFailed)
			}

				const dealIdForVision: string | null =
					(typeof dealId === "string" && dealId.trim().length > 0)
						? dealId.trim()
						: (typeof docMeta?.deal_id === "string" && docMeta.deal_id.trim().length > 0)
							? docMeta.deal_id.trim()
							: derivedDealId;

			const visionLogMeta = {
				stage: "extract_visual_assets",
				job_id: job.id ? String(job.id) : "",
				deal_id: typeof dealIdForVision === "string" && dealIdForVision.trim().length > 0 ? dealIdForVision : "",
				document_id: typeof docId === "string" ? docId : "",
				page_index: i,
				doc_kind: typeof docKind === "string" && docKind.trim().length > 0 ? docKind : "unknown",
				page_range: { start: pageStart, end: pageEndExclusive },
				chunk: { page_start: pageStart, page_end: pageEndExclusive },
				vision_base_url: config.visionWorkerUrl,
				image_url_prefix_kind: signedUrlPrefixKind,
				image_url_prefix: signedUrlPrefix,
				r2_bucket: resolvedR2Bucket,
				r2_key: resolvedR2Key,
			};

			// Image URI fetchability guarantee: validate reachability before sending to vision.
			// To keep overhead bounded, we only probe the first page in this chunk.
			if (i === pageStart) {
				const uriToCheck = typeof safe_image_uri === "string" ? safe_image_uri : "";
				const diag = await headCheckImageUri(uriToCheck);
				console.log(
					JSON.stringify({
						event: "VISION_IMAGE_URI_FETCH_DIAG",
						deal_id: dealIdForVision,
						document_id: docId,
						page_index: i,
						image_uri: uriToCheck,
						diag,
					})
				);
				if (!diag.ok) {
					try {
						await mergeDocumentExtractionMetadata({
							documentId: docId,
							patch: {
								visual_extraction: {
									status: "blocked",
									reason: "image_uri_unreachable",
									at: new Date().toISOString(),
									page_index: i,
									diag,
								},
							},
						});
					} catch {
						// best-effort
					}
					throw new Error(
						`RETRYABLE_IMAGE_URI_UNREACHABLE: doc=${docId} page=${i} status=${diag.status ?? "null"} method=${diag.method}`
					);
				}
			}
			const ocrFlags = needsOcr ? { include_ocr: true, mode: "ocr", return_blocks: true, return_structured: true } : {};
			try {
				console.log(
					JSON.stringify({
						event: "OCR_REQUEST_START",
						deal_id: dealIdForVision,
						document_id: docId,
						page_index: i,
						extractor_version: pageExtractorVersion,
						needs_ocr: needsOcr,
						ocr_flags: ocrFlags,
						reason: fullTextAbsentReason ?? (fullTextIsEmpty ? "full_text_empty" : null),
						ts: new Date().toISOString(),
					})
				);
			} catch {
				// ignore
			}

			docVisionAttempted += 1;
			visionStartedForPage = true;
			docVisionCallsStarted += 1;
			docPagesProcessed += 1;
			pagesVisionAttempted += 1;
			const timeoutsMs = docKind === "powerpoint" ? [20_000, 60_000, 90_000] : [20_000, 60_000];
			try {
				console.log(
					JSON.stringify({
						event: "VISION_REQUEST_PREP",
						job_id: job.id ? String(job.id) : null,
						deal_id: dealIdForVision,
						document_id: docId,
						page_index: i,
						url: `${config.visionWorkerUrl}/extract-visuals`,
						page_image_uri: typeof safe_image_uri === "string" ? safe_image_uri : null,
						timeout_ms: Array.isArray(timeoutsMs) && typeof timeoutsMs[0] === "number" ? timeoutsMs[0] : null,
						ts: new Date().toISOString(),
					})
				);
			} catch {
				// ignore
			}

			const { response, attempts } = await callVisionWorkerWithRetries(
				config,
				{
					document_id: docId,
					page_index: i,
					image_uri: safe_image_uri,
					image_b64: image_b64 ?? undefined,
					extractor_version: pageExtractorVersion,
					...(needsOcr ? ocrFlags : {}),
				},
				{ logger: console, logMeta: visionLogMeta, runtime: visionRuntime, timeoutsMs, backoffMs: [500, 1500] }
			);

			try {
				const last = Array.isArray(attempts) && attempts.length > 0 ? attempts[attempts.length - 1] : null;
				const hasAssets = Boolean(response && Array.isArray((response as any).assets) && (response as any).assets.length > 0);
				let responseBytes: number | null = null;
				try {
					responseBytes = response ? Buffer.byteLength(JSON.stringify(response), "utf8") : 0;
				} catch {
					responseBytes = null;
				}
				console.log(
					JSON.stringify({
						event: "VISION_RESPONSE_META",
						job_id: job.id ? String(job.id) : null,
						deal_id: dealIdForVision,
						document_id: docId,
						page_index: i,
						status: typeof (last as any)?.status_code === "number" ? (last as any).status_code : null,
						ok: Boolean(response),
						response_bytes: responseBytes,
						has_assets: hasAssets,
						ts: new Date().toISOString(),
					})
				);
			} catch {
				// ignore
			}
			docVisionCallsDone += 1;
			let resolvedResponse = response;
			if (!resolvedResponse) {
				console.warn(
					JSON.stringify({
						event: "VISION_CALL_FAILED",
						deal_id: dealIdForVision,
						document_id: docId,
						page_index: i,
						vision_service_url: config.visionWorkerUrl,
						extractor_version: pageExtractorVersion,
						attempts,
					})
				);
			}

			if (!resolvedResponse || !Array.isArray(resolvedResponse.assets) || resolvedResponse.assets.length === 0) {
				const last = Array.isArray(attempts) && attempts.length > 0 ? attempts[attempts.length - 1] : null;
				const reason =
					(typeof last?.error === "string" && last.error.trim().length > 0)
						? last.error
						: (typeof last?.status_code === "number" && Number.isFinite(last.status_code))
							? `HTTP_${last.status_code}`
							: (typeof last?.error_kind === "string" && last.error_kind)
								? String(last.error_kind)
								: "VISION_NO_ASSETS";
				docVisionFailures.push({ page_index: i, reason, attempts });
				pagesVisionFailed += 1;
				console.warn(`[extract_visuals] Vision worker returned no assets for doc=${docId} page=${i}, persisting fallback`);
				resolvedResponse = {
					document_id: docId,
					page_index: i,
					extractor_version: pageExtractorVersion,
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
			} else {
				docVisionSucceeded += 1;
				pagesVisionSucceeded += 1;
			}

			// Per-page text guarantee: if structured extraction yields little/no usable text and OCR wasn't requested,
			// run a local OCR fallback (tesseract) and attach ocr_text onto the response so persistence + DPU can use it.
			// Also emit per-page text length diagnostics.
			try {
				const ensured = await ensureOcrFallbackForVisionResponse({
					response: resolvedResponse as any,
					pageImageUri: !needsOcr && typeof safe_image_uri === "string" ? safe_image_uri : null,
					minPrimaryChars: 40,
					minOcrChars: 20,
					logger: console,
					logMeta: {
						deal_id: dealIdForVision,
						document_id: docId,
						page_index: i,
						extractor_version: pageExtractorVersion,
						needs_ocr: needsOcr,
					},
					force: false,
				});
				// Only apply local OCR mutations when we didn't already ask the vision service for OCR.
				if (!needsOcr) {
					resolvedResponse = ensured.response as any;
				}
				console.log(
					JSON.stringify({
						event: "VISION_PAGE_TEXT_LENS",
						deal_id: dealIdForVision,
						document_id: docId,
						page_index: i,
						primary_text_len: ensured.diag.primary_text_len,
						ocr_text_len: ensured.diag.ocr_text_len,
						final_page_text_len: ensured.diag.final_page_text_len,
						fallback_used: (!needsOcr) && ensured.diag.fallback_used,
						needs_ocr: needsOcr,
						ts: new Date().toISOString(),
					})
				);
			} catch {
				// Best-effort; never block persistence on diagnostics/OCR helper.
			}

			const ocrDiag = (() => {
				const assets = Array.isArray((resolvedResponse as any)?.assets) ? (resolvedResponse as any).assets : [];
				let ocrText = "";
				let ocrBlocks: any[] = [];
				let hasAnyOcrField = false;
				for (const a of assets) {
					const extractionObj = (a as any)?.extraction;
					if (extractionObj && typeof extractionObj === "object") {
						if ("ocr_text" in extractionObj || "ocr_blocks" in extractionObj) hasAnyOcrField = true;
						if (!ocrText && typeof extractionObj.ocr_text === "string") ocrText = String(extractionObj.ocr_text);
						if (ocrBlocks.length === 0 && Array.isArray(extractionObj.ocr_blocks)) ocrBlocks = extractionObj.ocr_blocks;
					}
				}
				const top = resolvedResponse as any;
				if (top && typeof top === "object") {
					if ("ocr_text" in top || "ocr_blocks" in top || "ocr" in top) hasAnyOcrField = true;
					if (!ocrText && typeof top.ocr_text === "string") ocrText = String(top.ocr_text);
					if (ocrBlocks.length === 0 && Array.isArray(top.ocr_blocks)) ocrBlocks = top.ocr_blocks;
					const ocrObj = top.ocr;
					if (ocrObj && typeof ocrObj === "object") {
						if (!ocrText && typeof (ocrObj as any).text === "string") ocrText = String((ocrObj as any).text);
						if (ocrBlocks.length === 0 && Array.isArray((ocrObj as any).blocks)) ocrBlocks = (ocrObj as any).blocks;
					}
				}
				const chars = typeof ocrText === "string" ? ocrText.length : 0;
				const blocksCount = Array.isArray(ocrBlocks) ? ocrBlocks.length : 0;
				return { chars, blocksCount, hasAnyOcrField, topKeys: top && typeof top === "object" ? Object.keys(top) : [] };
			})();
			try {
				console.log(
					JSON.stringify({
						event: "OCR_REQUEST_DONE",
						deal_id: dealIdForVision,
						document_id: docId,
						page_index: i,
						extractor_version: pageExtractorVersion,
						needs_ocr: needsOcr,
						ocr_flags: ocrFlags,
						ocr_chars: ocrDiag.chars,
						ocr_blocks_length: ocrDiag.blocksCount,
						response_top_level_keys: ocrDiag.topKeys,
						ts: new Date().toISOString(),
					})
				);
			} catch {
				// ignore
			}
			if (needsOcr && !ocrDiag.hasAnyOcrField) {
				try {
					console.warn(
						JSON.stringify({
							event: "OCR_MISSING_IN_RESPONSE",
							deal_id: dealIdForVision,
							document_id: docId,
							page_index: i,
							extractor_version: pageExtractorVersion,
							needs_ocr: needsOcr,
							response_top_level_keys: ocrDiag.topKeys,
							ts: new Date().toISOString(),
						})
					);
				} catch {
					// ignore
				}
			}

			try {
				const { persisted: pCount, withImageUri } = await persistVisionResponse(pool, resolvedResponse as any, { pageImageUri: image_uri });
				try {
					console.log(
						JSON.stringify({
							event: "VISION_PERSIST_RESULT",
							job_id: job.id ? String(job.id) : null,
							deal_id: dealIdForVision,
							document_id: docId,
							page_index: i,
							persisted: pCount,
							withImageUri,
							ts: new Date().toISOString(),
						})
					);
				} catch {
					// ignore
				}
				persisted += pCount;
				docPersisted += pCount;
				docPersistedWithImageUri += withImageUri;
				if (ocrDiag.chars > 0 || ocrDiag.blocksCount > 0) {
					pagesWithOcr += 1;
					docPagesWithOcr += 1;
				}
				pagesCompletedInJob += 1;
				await updateJobProgress(job, {
					stage: "extract_visual_assets",
					current: Math.min(pagesInJob, pagesCompletedInJob),
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
				try {
					console.log(
						JSON.stringify({
							event: "VISION_PERSIST_RESULT",
							job_id: job.id ? String(job.id) : null,
							deal_id: dealIdForVision,
							document_id: docId,
							page_index: i,
							persisted: null,
							withImageUri: null,
							error: err instanceof Error ? err.message : String(err),
							ts: new Date().toISOString(),
						})
					);
				} catch {
					// ignore
				}
				console.warn(
					`[extract_visuals] Persist failed doc=${docId} page=${i}: ${err instanceof Error ? err.message : String(err)}`
				);
			}
			await yieldToEventLoop();
			} catch (err) {
				if (!visionStartedForPage) {
					const msg = err instanceof Error ? err.message : String(err);
					const stack = err instanceof Error ? err.stack : undefined;
					try {
						console.warn(
							JSON.stringify({
								event: "EXTRACT_VISUALS_DOC_ERROR_BEFORE_VISION",
								job_id: job.id ? String(job.id) : null,
								deal_id: derivedDealId ?? null,
								document_id: docId,
								page_index: i,
								message: msg,
								stack,
								ts: new Date().toISOString(),
							})
						);
					} catch {
						// ignore
					}
				}
				throw err;
			}
		}

		try {
			console.log(
				JSON.stringify({
					event: "EXTRACT_VISUALS_DOC_SUMMARY",
					job_id: job.id ? String(job.id) : null,
					deal_id: derivedDealId ?? null,
					document_id: docId,
					page_range_start: pageStart,
					page_range_end: pageEndExclusive,
					total_pages: uris.length,
					pages_considered: docPagesConsidered,
					pages_skipped: docPagesSkipped,
					pages_processed: docPagesProcessed,
					vision_calls_started: docVisionCallsStarted,
					vision_calls_done: docVisionCallsDone,
					persisted_assets_total: docPersisted,
					extractor_version: extractorVersion,
					skip_existing: !forceReextract && !forceOcr,
					ts: new Date().toISOString(),
				})
			);
		} catch {
			// ignore
		}

		// Populate document_page_understanding per chunk, immediately after this chunk's visual_assets + visual_extractions
		// persistence has completed. This avoids relying on finalize-lock acquisition and does not depend on docKind.
		await tryPopulateDpuForChunkRange("chunk_end");

		const docVisionFailed = Math.max(0, docVisionAttempted - docVisionSucceeded);
		if (docVisionFailed > 0) docsWithVisionFailures += 1;

		const completedAt = new Date().toISOString();
		const summary = buildExtractVisualsPageSummaryV1({
			visionAttempted: docVisionAttempted,
			visionSucceeded: docVisionSucceeded,
			skippedExisting: docPagesSkippedExisting,
			failures: docVisionFailures
				.slice(0, 50)
				.map((f) => {
					const attempts = Array.isArray(f.attempts) ? f.attempts : [];
					const last = attempts.length > 0 ? attempts[attempts.length - 1] : null;
					const statusCode = typeof (last as any)?.status_code === "number" ? Number((last as any).status_code) : null;
					const elapsedMs = typeof (last as any)?.elapsed_ms === "number" ? Number((last as any).elapsed_ms) : undefined;
					return {
						page_index: f.page_index,
						reason: f.reason,
						attempts_used: attempts.length,
						...(elapsedMs != null ? { elapsed_ms: elapsedMs } : {}),
						status_code: statusCode,
					};
				}),
			completedAt,
		});

		const docStatus = computeExtractVisualsOutcomeStatusV1({
			visionAttempted: docVisionAttempted,
			visionSucceeded: docVisionSucceeded,
			skippedExisting: docPagesSkippedExisting,
		});
		try {
			await mergeDocumentExtractionMetadata({
				documentId: docId,
				patch: buildExtractVisualsExtractionMetadataPatchV1({
					existingVisualExtraction,
					summary,
					status: docStatus,
					extractorVersion,
					ocr: needsOcr
						? {
							pages_with_ocr: docPagesWithOcr,
							extractor_version: extractorVersion,
							reason: fullTextAbsentReason ?? (fullTextIsEmpty ? "full_text_empty" : null),
						}
						: null,
				}),
			});
		} catch {
			// best-effort
		}
		console.log(
			JSON.stringify({
				event: "EXTRACT_VISUALS_SUMMARY",
				stage: "extract_visual_assets",
				job_id: job.id ? String(job.id) : null,
				deal_id: derivedDealId,
				document_id: docId,
				extract_visuals_status: docStatus,
				extract_visuals_page_summary_v1: summary,
				page_range: { start: pageStart, end: pageEndExclusive },
				extractor_version: extractorVersion,
				needs_ocr: needsOcr,
				ocr_pages_with_text: docPagesWithOcr,
				ocr_reason: fullTextAbsentReason ?? (fullTextIsEmpty ? "full_text_empty" : null),
			})
		);

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

	// Coordinator: this execution is only responsible for enqueuing chunk jobs.
	// It must never finalize nor enqueue analyze_deal.
	if (isCoordinator && chunksEnqueued) {
		const msg = `Enqueued ${chunksEnqueuedCount} extract_visuals chunk job(s) (coordinator complete)`;
		await updateJob(job, "succeeded", msg, 100);
		await emitJobProgress(job, {
			job_id: job.id ? String(job.id) : "",
			deal_id: dealIdForAudit ?? undefined,
			stage: "finalize",
			percent: 100,
			message: msg,
			meta: {
				coordinator: true,
				chunks_enqueued: chunksEnqueuedCount,
			},
		});
		await updateJobProgress(job, {
			status: "succeeded" as any,
			stage: "finalize",
			current: 100,
			total: 100,
			message: msg,
		});
		return {
			ok: true,
			status: "succeeded",
			coordinator: true,
			chunks_enqueued: chunksEnqueuedCount,
		};
	}

	const jobCounters = {
		docs_total: docsTotal,
		docs_ready: targetDocumentIds.length,
		docs_processed: docsProcessed,
		pages_skipped_existing: pagesSkippedExisting,
		pages_skipped_policy: pagesSkippedPolicy,
		pages_vision_attempted: pagesVisionAttempted,
		pages_vision_succeeded: pagesVisionSucceeded,
		pages_vision_failed: pagesVisionFailed,
		pages_with_ocr: pagesWithOcr,
		docs_vision_skipped_policy: docsVisionSkippedPolicy,
		docs_with_vision_failures: docsWithVisionFailures,
		docs_blocked_pending: docsBlockedPending,
		docs_missing_original_bytes: docsMissingOriginalBytes,
		docs_missing_page_images: docsMissingPageImages,
		docs_rendered_via_pdf: docsRenderedViaPdf,
		docs_rendered_via_libreoffice: docsRenderedViaLibreoffice,
		docs_soffice_missing: docsSofficeMissing,
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
		if (!dealIdForAudit) {
			try {
				const { rows } = await pool.query<{ deal_id: string | null }>(
					"SELECT deal_id FROM documents WHERE id = $1",
					[targetDocumentIds[0]]
				);
				dealIdForAudit = rows?.[0]?.deal_id ?? undefined;
			} catch {
				dealIdForAudit = undefined;
			}
		}
		try {
			await enqueueAnalyzeDeal({
				dealId: dealIdForAudit,
				reason: "extract_visuals_complete",
				triggerJobId: job.id ? String(job.id) : null,
				shouldEnqueue: false,
				skipReason: "no_docs_processed",
				extra: { diag },
			});
		} catch {
			// never block
		}
		await updateJob(
			job,
			"succeeded_with_warnings",
			`Visual extraction produced no page assets (NO_PAGE_IMAGES_AVAILABLE). Skipped with diagnostics=${JSON.stringify(diag)}.`,
			100
		);
		devLog("worker_extract_visuals_finish", {
			job_id: job.id ? String(job.id) : null,
			deal_id: dealId ?? null,
			guard_triggered: false,
			status: "succeeded_with_warnings",
			...jobCounters,
		});
		return { ok: true, persisted, docs_processed: docsProcessed, docs_skipped: docsSkipped, job_counters: jobCounters, status: "succeeded_with_warnings" };
	}

	const effectiveSucceeded = pagesVisionSucceeded + pagesSkippedExisting;
	const visionFullyDown = pagesVisionAttempted > 0 && effectiveSucceeded === 0;
	const hadWarnings =
		docsBlocked > 0 ||
		docsMissingPageImages > 0 ||
		docsMissingOriginalBytes > 0 ||
		pagesVisionFailed > 0 ||
		docsWithVisionFailures > 0;
	const finalStatus = visionFullyDown ? "failed" : hadWarnings ? "succeeded_with_warnings" : "succeeded";
	const finalMessage =
		visionFullyDown
			? `Visual extraction failed (vision attempted but returned no successful pages). counters=${JSON.stringify(jobCounters)}`
			: hadWarnings
				? `Visual extraction succeeded with warnings (blocked=${docsBlocked}, processed=${docsProcessed}, skipped=${docsSkipped}, pages_skipped_existing=${pagesSkippedExisting}, missing_page_images=${docsMissingPageImages}, missing_original_bytes=${docsMissingOriginalBytes}, pages_vision_failed=${pagesVisionFailed}) counters=${JSON.stringify(jobCounters)}`
				: `Visual extraction complete (persisted=${persisted}, docs_processed=${docsProcessed}, docs_skipped=${docsSkipped}, pages_skipped_existing=${pagesSkippedExisting}) counters=${JSON.stringify(jobCounters)}`;

	if (!dealIdForAudit) {
		try {
			const { rows } = await pool.query<{ deal_id: string | null }>(
				"SELECT deal_id FROM documents WHERE id = $1",
				[targetDocumentIds[0]]
			);
			dealIdForAudit = rows?.[0]?.deal_id ?? undefined;
		} catch {
			dealIdForAudit = undefined;
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
	try {
		console.log(
			JSON.stringify({
				event: "EXTRACT_VISUALS_JOB_SUMMARY",
				job_id: job.id ? String(job.id) : null,
				deal_id: dealId ?? null,
				status: finalStatus,
				completed_at: new Date().toISOString(),
				counters: jobCounters,
			})
		);
	} catch {
		// ignore
	}
	await emitJobProgress(job, {
		job_id: job.id ? String(job.id) : "",
		deal_id: dealId ?? undefined,
		stage: "finalize",
		percent: 100,
		message: finalStatus === "succeeded_with_warnings"
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

	const chunkIsLast = chunkJobIsLastChunk === true;
	const shouldFinalize = isChunkJob && chunkIsLast === true;

	// Optional safety: ensure finalization/analyze happens exactly once per (deal, document) for a short window.
	// This prevents duplicate final-chunk jobs (retries, concurrent runs) from racing.
	// Lock is always released explicitly in the finally block below; TTL is a safety net for crashes.
	const FINALIZE_LOCK_TTL_S = 300; // 5 min safety-net TTL; explicit release happens first
	const FINALIZE_LOCK_STALE_TAKEOVER_S = 120; // take over if holder appears stuck > 2 min
	let finalizeLockKey: string | null = null;
	let finalizeLockAcquired = true;
	if (shouldFinalize && dealIdForAudit) {
		finalizeLockKey = `extract_visuals:finalized:${dealIdForAudit}:${targetDocumentIds.length === 1 ? targetDocumentIds[0] : "multi"}`;
		try {
			const triggerJobId = job.id ? String(job.id) : "";
			const lockValue = JSON.stringify({ job_id: triggerJobId || "unknown", acquired_at: Date.now() });
			const res = await (connection as any).set(finalizeLockKey, lockValue, "NX", "EX", FINALIZE_LOCK_TTL_S);
			if (res === "OK") {
				finalizeLockAcquired = true;
			} else {
				// Lock already held — check if the previous holder is stale.
				try {
					const existing = await (connection as any).get(finalizeLockKey);
					const parsed = existing ? JSON.parse(existing) : null;
					const ageMs = parsed?.acquired_at ? Date.now() - Number(parsed.acquired_at) : Infinity;
					const ageS = ageMs / 1000;
					if (ageS > FINALIZE_LOCK_STALE_TAKEOVER_S) {
						// Previous holder likely crashed. Take over.
						await (connection as any).set(finalizeLockKey, lockValue, "EX", FINALIZE_LOCK_TTL_S);
						finalizeLockAcquired = true;
						console.log(
							JSON.stringify({
								event: "EXTRACT_VISUALS_FINALIZE_LOCK_TAKEOVER",
								deal_id: dealIdForAudit ?? null,
								document_id: targetDocumentIds.length === 1 ? targetDocumentIds[0] : null,
								stale_holder_job_id: parsed?.job_id ?? null,
								age_s: Math.round(ageS),
								reason: "stale_lock",
							})
						);
					} else {
						finalizeLockAcquired = false;
						console.log(
							JSON.stringify({
								event: "EXTRACT_VISUALS_FINALIZE_LOCK_SKIP",
								deal_id: dealIdForAudit ?? null,
								document_id: targetDocumentIds.length === 1 ? targetDocumentIds[0] : null,
								reason: "lock_already_held",
								holder_job_id: parsed?.job_id ?? null,
								holder_age_s: Math.round(ageS),
								should_finalize: true,
							})
						);
						// Enqueue a recovery job so finalization is not permanently lost if the
						// lock holder crashed before completing.  Delayed by 15 s to give the
						// current holder time to finish first; the recovery job will re-check
						// the lock on arrival and skip if finalization already succeeded.
						try {
							await enqueuePersistedJob({
								type: "finalize_extract_visuals",
								deal_id: dealIdForAudit ?? undefined,
								payload: {
									deal_id: dealIdForAudit ?? null,
									document_ids: targetDocumentIds,
									from_chunk_job_id: job.id ? String(job.id) : null,
								},
								parent_job_id: job.id ? String(job.id) : null,
								idempotent: true,
								delay_ms: 15_000,
							});
						} catch {
							// Best-effort: stale-takeover (120 s) is the fallback if enqueue fails.
						}
					}
				} catch {
					finalizeLockAcquired = false;
					console.log(
						JSON.stringify({
							event: "EXTRACT_VISUALS_FINALIZE_LOCK_SKIP",
							deal_id: dealIdForAudit ?? null,
							document_id: targetDocumentIds.length === 1 ? targetDocumentIds[0] : null,
							reason: "lock_already_held",
							should_finalize: true,
						})
					);
					// Enqueue recovery job (same intent as the non-stale branch above).
					try {
						await enqueuePersistedJob({
							type: "finalize_extract_visuals",
							deal_id: dealIdForAudit ?? undefined,
							payload: {
								deal_id: dealIdForAudit ?? null,
								document_ids: targetDocumentIds,
								from_chunk_job_id: job.id ? String(job.id) : null,
							},
							parent_job_id: job.id ? String(job.id) : null,
							idempotent: true,
							delay_ms: 15_000,
						});
					} catch {
						// Best-effort.
					}
				}
			}
		} catch {
			finalizeLockAcquired = true;
		}
	}

	const shouldRunFinalize = shouldFinalize && finalizeLockAcquired;

	// Finalize: write page_segments_v1 once (idempotent) when this job is the finalizing job.
	// Stored as stable metadata and references rendered_pages_r2 keys (no signed URLs).
	if (isCoordinator) {
		console.log(
			JSON.stringify({
				event: "PAGE_SEGMENTS_V1_SKIP",
				document_id: targetDocumentIds.length === 1 ? targetDocumentIds[0] : null,
				deal_id: dealIdForAudit ?? null,
				reason: "coordinator",
				should_finalize: false,
			})
		);
		// Belt + suspenders: coordinator must never finalize or enqueue analyze.
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
	}

	if (shouldRunFinalize) {
		console.log(
			JSON.stringify({
				event: "EXTRACT_VISUALS_FINALIZE_START",
				deal_id: dealIdForAudit ?? null,
				document_ids: targetDocumentIds,
				job_id: job.id ? String(job.id) : null,
				docs_count: targetDocumentIds.length,
				ts: new Date().toISOString(),
			})
		);
		for (const docId of targetDocumentIds) {
			try {
				const { rows } = await pool.query(
					"SELECT deal_id, type, extraction_metadata, full_content, page_count FROM documents WHERE id = $1 LIMIT 1",
					[sanitizeText(docId)]
				);
				const row = rows?.[0] as any;
				const existing = row?.extraction_metadata && typeof row.extraction_metadata === "object" ? row.extraction_metadata : null;
				if (existing && (existing as any)?.page_segments_v1) {
					console.log(
						JSON.stringify({
							event: "PAGE_SEGMENTS_V1_SKIP",
							document_id: docId,
							deal_id: (typeof row?.deal_id === "string" ? row.deal_id : null) ?? null,
							reason: "already_present",
							should_finalize: true,
						})
					);
					// Even when page_segments_v1 already present, ensure the finalized marker is
					// written so downstream can confirm finalization ran for this document.
					await mergeDocumentExtractionMetadata({
						documentId: docId,
						patch: buildExtractVisualsFinalizedMarker({ jobId: job.id ? String(job.id) : null, docsFinalized: 1 }),
					});
					continue;
				}

				const renderedPagesR2 = existing && typeof (existing as any)?.rendered_pages_r2 === "object" ? (existing as any).rendered_pages_r2 : null;
				const renderedPagesR2Ref = renderedPagesR2
					? {
							bucket:
								typeof renderedPagesR2.bucket === "string" && renderedPagesR2.bucket.trim()
									? renderedPagesR2.bucket.trim()
									: (process.env.R2_BUCKET || "").trim() || null,
							prefix: typeof renderedPagesR2.prefix === "string" ? renderedPagesR2.prefix : null,
							format: typeof renderedPagesR2.format === "string" ? renderedPagesR2.format : null,
							page_count:
								typeof row?.page_count === "number" && Number.isFinite(row.page_count) && row.page_count > 0
									? row.page_count
									: typeof (existing as any)?.rendered_pages_count === "number" && Number.isFinite((existing as any).rendered_pages_count)
										? (existing as any).rendered_pages_count
										: null,
						}
					: null;

				const fullContent = row?.full_content ?? {};
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

				const mapSlideTypeToSegmentKey = (slideTypeRaw: unknown): string => {
					const s = typeof slideTypeRaw === "string" ? slideTypeRaw.trim().toLowerCase() : "";
					if (!s || s === "other") return "unknown";
					if (s === "go_to_market") return "distribution";
					if (s === "use_of_funds") return "raise_terms";
					return s;
				};

				const ordered = pages
					.map((p) => {
						const pageIndex = typeof p?.page_index === "number" && Number.isFinite(p.page_index) ? p.page_index : null;
						if (pageIndex == null || pageIndex < 0) return null;
						const u = p?.understanding_v1;
						const slideType = typeof u?.slide_type === "string" ? String(u.slide_type) : "other";
						const slideTypeConf =
							typeof u?.slide_type_confidence === "number" && Number.isFinite(u.slide_type_confidence)
								? u.slide_type_confidence
								: null;
						const title = typeof u?.title === "string" ? String(u.title) : "";
						const segmentKey = mapSlideTypeToSegmentKey(slideType);
						return {
							page_index: pageIndex,
							slide_type: slideType,
							slide_type_confidence: slideTypeConf,
							title,
							segment_key: segmentKey,
						};
					})
					.filter(Boolean)
					.sort((a: any, b: any) => a.page_index - b.page_index);

				if (ordered.length === 0) {
					// Fallback: treat DPU page_text OR text_snippet as "understanding".
					// This keeps segmentation/disclosure logic aligned with DPU population rules.
					let dpuFallback:
						| { page_start: number; page_end: number; pages_with_understanding: number; title_hint: string | null }
						| null = null;
					try {
						const res = await pool.query(
							`
							WITH has_u AS (
								SELECT
									page_index,
									NULLIF(BTRIM(COALESCE(payload->'text_blocks'->>'title','')), '') AS title_hint
								  FROM public.document_page_understanding
								 WHERE document_id = $1::uuid
								   AND version = 'page_understanding_v1'
								   AND (
										NULLIF(BTRIM(COALESCE(payload->>'page_text','')), '') IS NOT NULL
									 OR NULLIF(BTRIM(COALESCE(payload->'text_blocks'->>'text_snippet','')), '') IS NOT NULL
								   )
							)
							SELECT
								COUNT(*)::int AS pages_with_understanding,
								MIN(page_index)::int AS page_start,
								MAX(page_index)::int AS page_end,
								(
									SELECT title_hint
									  FROM has_u
									 WHERE title_hint IS NOT NULL
									 ORDER BY page_index ASC
									 LIMIT 1
								) AS title_hint
							FROM has_u;
							`,
							[sanitizeText(docId)]
						);
						const r = res?.rows?.[0] as any;
						const pagesWith = typeof r?.pages_with_understanding === "number" ? r.pages_with_understanding : 0;
						const pageStart = typeof r?.page_start === "number" ? r.page_start : null;
						const pageEnd = typeof r?.page_end === "number" ? r.page_end : null;
						const titleHint = typeof r?.title_hint === "string" && r.title_hint.trim() ? r.title_hint.trim() : null;
						if (pagesWith > 0 && pageStart != null && pageEnd != null) {
							dpuFallback = {
								page_start: Math.max(0, pageStart),
								page_end: Math.max(Math.max(0, pageStart), pageEnd),
								pages_with_understanding: pagesWith,
								title_hint: titleHint,
							};
						}
					} catch {
						// best-effort
					}

					if (!dpuFallback) {
						console.log(
							JSON.stringify({
								event: "PAGE_SEGMENTS_V1_SKIP",
								document_id: docId,
								deal_id: (typeof row?.deal_id === "string" ? row.deal_id : null) ?? null,
								reason: "no_pages_with_understanding",
								should_finalize: true,
							})
						);
						// Write finalized marker even for XLSX/no-PDF docs with no DPU pages so that
						// downstream services know finalization ran for this document.
						try {
							await mergeDocumentExtractionMetadata({
								documentId: docId,
								patch: buildExtractVisualsFinalizedMarker({ jobId: job.id ? String(job.id) : null, docsFinalized: 1 }),
							});
						} catch {
							// Best-effort; PAGE_SEGMENTS_V1_SKIP is already logged.
						}
						continue;
					}

					const segments = [
						{
							segment_index: 0,
							segment_key: "unknown",
							segment_label: "unknown",
							page_start: dpuFallback.page_start,
							page_end: dpuFallback.page_end,
							title_hint: dpuFallback.title_hint,
							avg_confidence: null,
							pages: dpuFallback.pages_with_understanding,
						},
					];

					await mergeDocumentExtractionMetadata({
						documentId: docId,
						patch: {
							page_segments_v1: {
								version: "page_segments_v1",
								generated_at: new Date().toISOString(),
								rendered_pages_r2: renderedPagesR2Ref,
								segments,
							},
						},
					});
					console.log(
						JSON.stringify({
							event: "PAGE_SEGMENTS_V1_WRITTEN",
							document_id: docId,
							deal_id: (typeof row?.deal_id === "string" ? row.deal_id : null) ?? null,
							segments_count: segments.length,
							source: "dpu_fallback",
							should_finalize: true,
						})
					);
					await mergeDocumentExtractionMetadata({
						documentId: docId,
						patch: buildExtractVisualsFinalizedMarker({ jobId: job.id ? String(job.id) : null, docsFinalized: 1 }),
					});
					continue;
				}

				const segments: any[] = [];
				let cur: any | null = null;
				for (const p of ordered as any[]) {
					const key = typeof p.segment_key === "string" && p.segment_key.trim() ? p.segment_key : "unknown";
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
							rendered_pages_r2: renderedPagesR2Ref,
							segments,
						},
					},
				});
				console.log(
					JSON.stringify({
						event: "PAGE_SEGMENTS_V1_WRITTEN",
						document_id: docId,
						deal_id: (typeof row?.deal_id === "string" ? row.deal_id : null) ?? null,
						segments_count: segments.length,
						should_finalize: true,
					})
				);
				await mergeDocumentExtractionMetadata({
					documentId: docId,
					patch: buildExtractVisualsFinalizedMarker({ jobId: job.id ? String(job.id) : null, docsFinalized: 1 }),
				});
			} catch (err) {
				console.warn(
					`[extract_visuals] page_segments_v1 finalize write failed doc=${docId}: ${err instanceof Error ? err.message : String(err)}`
				);
			}
		}
		console.log(
			JSON.stringify({
				event: "EXTRACT_VISUALS_FINALIZE_SUCCESS",
				deal_id: dealIdForAudit ?? null,
				document_ids: targetDocumentIds,
				job_id: job.id ? String(job.id) : null,
				docs_count: targetDocumentIds.length,
				ts: new Date().toISOString(),
			})
		);
	} else {
		console.log(
			JSON.stringify({
				event: "PAGE_SEGMENTS_V1_SKIP",
				document_id: targetDocumentIds.length === 1 ? targetDocumentIds[0] : null,
				deal_id: dealIdForAudit ?? null,
				reason: shouldFinalize ? "finalize_lock_not_acquired" : "not_finalizing",
				should_finalize: false,
			})
		);
	}

	let analysisBlockedBy: string | null = null;

	// Follow-up: enqueue analyze_deal when extract_visuals completes and this job is the finalizing job.
	// This is intentionally best-effort, but should emit clear ENQUEUED/SKIPPED logs for production debugging.
	if (shouldRunFinalize && !isCoordinator) {
		// Populate document_page_understanding for PPTX documents from visual_extractions.
		// Must run after visual_extractions writes; running in the finalizing job ensures chunk jobs have completed.
		let dpuLedgerIds: { run_id: string; step_run_id: string } | null = null;
		try {
			const extractJobId = job.id ? String(job.id) : null;
			const ledger = (job.data as any)?.__pipeline_ledger as { run_id: string; step_run_id: string } | undefined;
			const runId = typeof ledger?.run_id === "string" ? ledger.run_id : null;

			dpuLedgerIds =
				runId && extractJobId && dealIdForAudit
					? await startNamedStepRunLedger(pool as any, {
						run_id: runId,
						step_name: "populate_document_page_understanding",
						job_id: extractJobId,
						input: {
							deal_id: dealIdForAudit,
							version: "page_understanding_v1",
						},
					})
					: null;

			const res = dealIdForAudit
				? await populateDocumentPageUnderstandingFromVisualExtractions(pool as any, {
						dealId: dealIdForAudit,
						version: "page_understanding_v1",
					})
				: { upserted: 0, page_text_empty: 0 };

			// Log DB connection details alongside upsert count so we can detect split-brain
			// scenarios where worker and API talk to different DB hosts.
			let finalizeDbHost: string | null = null;
			let finalizeDbName: string | null = null;
			try {
				const meta = await pool.query<{ db_host: string | null; db_name: string }>(
					"SELECT inet_server_addr()::text AS db_host, current_database() AS db_name"
				);
				finalizeDbHost = meta.rows?.[0]?.db_host ?? null;
				finalizeDbName = meta.rows?.[0]?.db_name ?? null;
			} catch {
				// ignore metadata failures
			}

			console.log(
				JSON.stringify({
					event: "POPULATE_DOCUMENT_PAGE_UNDERSTANDING",
					deal_id: dealIdForAudit ?? null,
					job_id: extractJobId,
					upserted: res.upserted,
					page_text_empty: res.page_text_empty,
					candidates_found: (res as any).candidates_found ?? null,
					rows_with_text: (res as any).rows_with_text ?? null,
					rows_missing_text: (res as any).rows_missing_text ?? null,
					version: "page_understanding_v1",
					db_host: finalizeDbHost,
					db_name: finalizeDbName,
					ts: new Date().toISOString(),
				})
			);

			if (dpuLedgerIds) {
				await finishStepRunLedger(pool as any, dpuLedgerIds, "succeeded", {
					summary: {
						upserted: res.upserted,
						page_text_empty: res.page_text_empty,
						version: "page_understanding_v1",
					},
					error: null,
				});
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.warn(`[extract_visuals] populate_document_page_understanding failed: ${msg}`);
			try {
				if (dpuLedgerIds) {
					await finishStepRunLedger(pool as any, dpuLedgerIds, "failed", {
						summary: { ok: false },
						error: { message: msg },
					});
				}
			} catch {
				// never block
			}
		}

		// Before analyze: promote OCR output (vision lane) into documents.full_text so full-text search works.
		const dpuRebuildDocumentIds = new Set<string>();
		for (const docId of targetDocumentIds) {
			try {
				const res = await promoteVisualOcrToDocumentFullText({
					pool,
					documentId: docId,
					dealId: dealIdForAudit ?? null,
					triggerJobId: job.id ? String(job.id) : null,
				});
				if (res.promoted) dpuRebuildDocumentIds.add(docId);
				console.log(
					JSON.stringify({
						event: "OCR_TEXT_PROMOTED",
						deal_id: dealIdForAudit ?? null,
						document_id: docId,
						promoted: res.promoted,
						reason: res.reason,
						ocr_chars: res.ocrChars,
						ocr_pages: res.pages,
						trigger_job_id: job.id ? String(job.id) : null,
						ts: new Date().toISOString(),
					})
				);
			} catch {
				// never block extraction completion
			}
		}

		// If OCR was newly promoted, rebuild DPU so readiness reflects meaningful text content.
		// This is best-effort and idempotent; failures should not block finalization.
		if (dpuRebuildDocumentIds.size > 0) {
			for (const docId of dpuRebuildDocumentIds) {
				try {
					const parentJobId = job.id ? String(job.id) : null;
					const enqueueRes = await enqueuePersistedJob({
						type: "populate_document_page_understanding",
						deal_id: dealIdForAudit ?? undefined,
						document_id: docId,
						payload: {
							page_understanding_version: "page_understanding_v1",
							reason: "after_ocr_promotion",
							trigger_job_id: parentJobId,
						},
						parent_job_id: parentJobId,
						idempotent: true,
					});
					console.log(
						JSON.stringify({
							event: "DPU_REBUILD_ENQUEUED_AFTER_OCR",
							deal_id: dealIdForAudit ?? null,
							document_id: docId,
							job_id: enqueueRes.job_id,
							version: "page_understanding_v1",
							ts: new Date().toISOString(),
						})
					);
				} catch {
					// never block
				}
			}
		}

		// Pattern A prerequisite gate: run Document Intelligence batch before enqueueing analyze_deal.
		let diGateOk = true;
		try {
			const extractJobId = job.id ? String(job.id) : null;
			const ledger = (job.data as any)?.__pipeline_ledger as { run_id: string; step_run_id: string } | undefined;
			const runId = typeof ledger?.run_id === "string" ? ledger.run_id : null;

			const timeoutMsRaw = process.env.DOCUMENT_INTELLIGENCE_BATCH_TIMEOUT_MS;
			const pollMsRaw = process.env.DOCUMENT_INTELLIGENCE_BATCH_POLL_MS;
			const diTimeoutMs = Number.isFinite(Number(timeoutMsRaw))
				? Math.max(10_000, Math.floor(Number(timeoutMsRaw)))
				: 4 * 60_000;
			const diPollMs = Number.isFinite(Number(pollMsRaw)) ? Math.max(500, Math.floor(Number(pollMsRaw))) : 2000;

			const selected = dealIdForAudit ? await selectDocumentsForDocumentIntelligenceBatch(pool as any, dealIdForAudit) : [];
			const selectedDocIds = selected.map((r) => r.id).filter((id) => typeof id === "string" && id.length > 0);
			const activeJobsByDocId = dealIdForAudit
				? await loadActiveDocumentIntelligenceJobs(pool as any, dealIdForAudit, selectedDocIds)
				: new Map<string, string[]>();
			const plan = planDocumentIntelligenceBatch(selectedDocIds, activeJobsByDocId);

			const batchLedgerIds =
				runId && extractJobId
					? await startNamedStepRunLedger(pool as any, {
						run_id: runId,
						step_name: "document_intelligence_batch",
						job_id: extractJobId,
						input: {
							deal_id: dealIdForAudit,
							document_ids: plan.doc_ids_selected,
						},
					})
					: null;

			const enqueuedJobIds =
				dealIdForAudit && extractJobId
					? await enqueueDocumentIntelligenceExtractJobs({
							dealId: dealIdForAudit,
							documentIds: plan.doc_ids_to_enqueue,
							parentJobId: extractJobId,
							run_id: batchLedgerIds?.run_id ?? null,
							step_run_id: batchLedgerIds?.step_run_id ?? null,
						})
					: [];

			const allJobIds = [...plan.active_job_ids, ...enqueuedJobIds].sort((a, b) => a.localeCompare(b));
			const outcome = await pollJobsToTerminal(pool as any, allJobIds, { timeoutMs: diTimeoutMs, pollMs: diPollMs });

			const stepSummary = {
				ok: outcome.ok,
				timed_out: outcome.timed_out,
				docs_selected: plan.doc_ids_selected.length,
				docs_enqueued: plan.doc_ids_to_enqueue.length,
				docs_skipped_active: plan.doc_ids_skipped_active.length,
				jobs_total: allJobIds.length,
				jobs_failed: outcome.failed_job_ids.length,
				jobs_cancelled: outcome.cancelled_job_ids.length,
			};

			if (batchLedgerIds) {
				await finishStepRunLedger(pool as any, batchLedgerIds, outcome.ok ? "succeeded" : "failed", {
					summary: stepSummary,
					error: outcome.ok
						? null
						: {
							message: outcome.timed_out
								? "document_intelligence_batch timed out"
								: "document_intelligence_batch failed",
						},
				});
			}

			diGateOk = outcome.ok;
			if (!outcome.ok && dealIdForAudit && extractJobId) {
				const msg = outcome.timed_out
					? "Document intelligence batch timed out; analysis blocked"
					: "Document intelligence batch failed; analysis blocked";
				await insertBlockedAnalyzeJob(pool as any, {
					dealId: dealIdForAudit,
					parentJobId: extractJobId,
					reason: "document_intelligence_batch",
					message: msg,
					details: stepSummary,
				});
			}
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.warn(`[extract_visuals] document_intelligence_batch gate error; blocking analysis: ${msg}`);
			diGateOk = false;
			try {
				const extractJobId = job.id ? String(job.id) : null;
				if (dealIdForAudit && extractJobId) {
					await insertBlockedAnalyzeJob(pool as any, {
						dealId: dealIdForAudit,
						parentJobId: extractJobId,
						reason: "document_intelligence_batch",
						message: `Document intelligence batch error; analysis blocked (${msg})`,
						details: { ok: false, error: msg },
					});
				}
			} catch {
				// never block extraction completion
			}
		}

		// If any docs were marked needs_ocr during ingest, OCR promotion + DI batch should now be done (or timed out).
		// Re-drive ingest from storage to rebuild structured extraction (metrics/headings/summary) from OCR-promoted text.
		try {
			if (dealIdForAudit && targetDocumentIds.length > 0) {
				const { rows } = await pool.query<{
					id: string;
					status: string | null;
					full_text: string | null;
					extraction_metadata: unknown | null;
				}>(
					// Cast param to uuid[] so PostgreSQL can use the uuid index on documents.id.
					// Passing ::text[] causes "operator does not exist: uuid = text".
					"SELECT id, status, full_text, extraction_metadata FROM documents WHERE id = ANY($1::uuid[])",
					[targetDocumentIds.map((d) => sanitizeText(d))]
				);

				for (const r of rows ?? []) {
					const docId = typeof r?.id === "string" ? r.id : "";
					if (!docId) continue;
					if (String(r?.status ?? "").toLowerCase() !== "needs_ocr") continue;

					const meta = r?.extraction_metadata && typeof r.extraction_metadata === "object" ? (r.extraction_metadata as any) : null;
					const flow = meta?.needs_ocr_flow && typeof meta.needs_ocr_flow === "object" ? meta.needs_ocr_flow : null;
					const alreadyEnqueued = typeof flow?.reextract_enqueued_at === "string" && flow.reextract_enqueued_at.trim().length > 0;
					if (alreadyEnqueued) continue;

					const searchIndex = meta?.search_index && typeof meta.search_index === "object" ? meta.search_index : null;
					const ocrChars = typeof searchIndex?.visual_ocr_char_count === "number" ? searchIndex.visual_ocr_char_count : 0;
					const fullTextLen = typeof r?.full_text === "string" ? r.full_text.length : 0;
					const hasEnoughText = Math.max(ocrChars, fullTextLen) >= 200;
					if (!hasEnoughText) continue;

					await mergeDocumentExtractionMetadata({
						documentId: docId,
						patch: {
							needs_ocr_flow: {
								...(flow && typeof flow === "object" ? flow : {}),
								state: "reextract_enqueued",
								reextract_enqueued_at: new Date().toISOString(),
								reextract_trigger_job_id: job.id ? String(job.id) : null,
							},
						},
					});

					const reextractJobId = makeJobId("reextract_documents", [dealIdForAudit, docId, "needs_ocr"]);
					try {
						await enqueuePersistedJob({
							job_id: reextractJobId,
							type: "reextract_documents",
							deal_id: dealIdForAudit,
							payload: {
								deal_id: dealIdForAudit,
								document_ids: [docId],
								mode: "needs_ocr",
								force: true,
							},
							parent_job_id: job.id ? String(job.id) : null,
						});
						console.log(
							JSON.stringify({
								event: "NEEDS_OCR_ENQUEUED_REEXTRACT",
								deal_id: dealIdForAudit,
								document_id: docId,
								reextract_job_id: reextractJobId,
								trigger_job_id: job.id ? String(job.id) : null,
								ts: new Date().toISOString(),
							})
						);
					} catch (err) {
						const msg = err instanceof Error ? err.message : String(err);
						if (!msg.toLowerCase().includes("duplicate") && !msg.toLowerCase().includes("already exists")) {
							console.warn(`[extract_visuals] reextract_documents enqueue failed doc=${docId}: ${msg}`);
						}
					}
				}
			}
		} catch (err) {
			console.warn(
				`[extract_visuals] needs_ocr reextract follow-up failed: ${err instanceof Error ? err.message : String(err)}`
			);
		}

		if (!diGateOk) {
			analysisBlockedBy = "document_intelligence_batch";
		} else {
			try {
				await enqueueAnalyzeDeal({
					dealId: dealIdForAudit ?? "",
					reason: "extract_visuals_complete",
					triggerJobId: job.id ? String(job.id) : null,
					shouldEnqueue: true,
					extra: {
						extract_visuals: {
							status: finalStatus,
							is_chunk_job: isChunkJob,
							chunk_is_last: chunkJobIsLastChunk,
							chunk_total_pages: chunkJobTotalPages,
							chunks_enqueued_any: chunksEnqueuedAny,
							should_finalize: shouldFinalize,
							persisted_assets: persisted,
							docs_processed: docsProcessed,
							docs_skipped: docsSkipped,
							docs_blocked: docsBlocked,
						},
					},
				});
			} catch {
				// never block extraction completion
			}
		}
	}

	// Release finalize lock so immediate retries can proceed if needed.
	// Lock has a short TTL (FINALIZE_LOCK_TTL_S) as a safety net; explicit release is the primary mechanism.
	if (finalizeLockKey && finalizeLockAcquired) {
		try {
			await (connection as any).del(finalizeLockKey);
			console.log(
				JSON.stringify({
					event: "EXTRACT_VISUALS_FINALIZE_LOCK_RELEASED",
					deal_id: dealIdForAudit ?? null,
					document_id: targetDocumentIds.length === 1 ? targetDocumentIds[0] : null,
					lock_key: finalizeLockKey,
				})
			);
		} catch {
			// Best-effort: lock will expire via TTL if explicit release fails.
		}
	}

	// Optional follow-up: enqueue a deep scan pass to force vision-understanding hints.
	// This is intentionally best-effort and should never block the quick extraction.
	if (enqueueDeepScan && dealId && (finalStatus === "succeeded" || finalStatus === "succeeded_with_warnings")) {
		try {
			const deepScanQueue = getQueue("deep_scan_visuals");
			await deepScanQueue.add(
				"deep_scan_visuals",
				{ deal_id: dealId, parent_job_id: job.id ? String(job.id) : null },
				{ removeOnComplete: true, removeOnFail: false, delay: 500, attempts: 3, backoff: { type: "exponential", delay: 1000 } }
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

	// IMPORTANT: Make the parent job terminal at the very end, with stage=finalize.
	// This avoids debounce ordering or later progress-only updates leaving the job stuck as running.
	await updateJobProgress(job, {
		status: finalStatus as any,
		stage: "finalize",
		current: 100,
		total: 100,
		message: finalMessage,
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
		analysis_blocked_by: analysisBlockedBy,
	};
}, { concurrency: extractVisualsConcurrency });

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
			await enqueueAnalyzeDeal({
				dealId,
				reason: "finalize_extract_visuals_recovery",
				triggerJobId,
				shouldEnqueue: true,
				extra: { finalize_extract_visuals: { recovery: true, document_ids: docIds } },
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
