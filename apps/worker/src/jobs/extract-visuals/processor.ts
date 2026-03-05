import type { Job } from "bullmq";
import { createHash } from "crypto";
import path from "path";
import fs from "fs/promises";
import { sanitizeText, getDocumentCapabilities, getInitialRenderedPagesChunk, QUEUE_NAMES } from "@dealdecision/core";
import type { JobProgressEventV1, JobStatus } from "@dealdecision/contracts";
import { getPool, mergeDocumentExtractionMetadata, getDocumentOriginalFile, upsertDocumentOriginalFile, getDocumentsForDeal } from "../../lib/db";
import { updateJobProgress, emitJobProgress } from "../../lib/job-progress";
import { enqueuePersistedJob } from "../../lib/job-enqueue";
import { makeJobId } from "../../lib/job-id";
import { getQueue, connection } from "../../lib/queue";
import { planChunkEnqueues } from "../../lib/page-chunks";
import { logMemory, yieldToEventLoop } from "../../lib/memory";
import { evaluateVisualDocReadiness, getVisualIngestBlockReason } from "../../lib/visual-readiness";
import {
  getVisionExtractorConfig, createVisionJobRuntime, hasTable, resolvePageImageUris,
  backfillVisualAssetImageUris, persistSyntheticVisualAssets, persistVisionResponse,
  callVisionWorkerWithRetries, callXlsxWorkerWithRetries, buildXlsxCanonicalPatch,
  deduceDocKind, resegmentStructuredSyntheticAssets, applyVisionHintsToStructuredPowerpointSlides,
  buildExtractVisualsExtractionMetadataPatchV1, buildExtractVisualsPageSummaryV1,
  computeExtractVisualsOutcomeStatusV1, shouldSkipExtractVisualsPage, isAuditVisionFailure,
  buildExtractVisualsFinalizedMarker,
} from "../../lib/visual-extraction";
import {
  getVisualPageImagePersistConfig, persistRenderedPageImages, persistImagePage,
  renderNonPdfToPageImages, r2RenderedPageKey, formatRenderedPageKey,
} from "../../lib/rendered-pages";
import { r2ObjectExists, uploadToR2 } from "../../lib/r2";
import { computeChunkRangeForPage } from "../../lib/r2-probe";
import { persistPdfV2TextRegionAssetsV1Shadow } from "../../lib/pdf_v2/pdf-text-region-assets-v1";
import { persistPdfPageUnderstandingV1Shadow } from "../../lib/pdf_v2/page-understanding-v1";
import { applySlideUnderstandingV1Shadow } from "../../lib/pdf_v2/slide-understanding-v1";
import { populateDocumentPageUnderstandingFromVisualExtractions } from "../../lib/document-page-understanding";
import { promoteSlideFactsFromDocumentPageUnderstanding } from "../../lib/promote-slide-facts";
import { ensureOcrFallbackForVisionResponse } from "../../lib/vision-ocr-fallback";
import { computeVisualQualityAuditForDeal } from "../../lib/visual-quality-audit";
import {
  selectDocumentsForDocumentIntelligenceBatch, loadActiveDocumentIntelligenceJobs,
  planDocumentIntelligenceBatch, enqueueDocumentIntelligenceExtractJobs,
  pollJobsToTerminal, insertBlockedAnalyzeJob,
} from "../../lib/document-intelligence-batch";
import { startNamedStepRunLedger, finishStepRunLedger } from "../../lib/pipeline-run-ledger";
import { enqueueAnalyzeDeal } from "../../lib/enqueue-analyze-deal";
import { verifyVisionServiceForJob } from "../../lib/vision-verification";
import { tryReadImageB64ForVision, headCheckImageUri } from "../../lib/vision-image";
import { pickDownloadUrlFromExtractionMetadata } from "../../lib/original-file-url";
import { promoteVisualOcrToDocumentFullText } from "../../lib/visual-ocr-promoter";
import { resolveWritableUploadDir } from "../../lib/upload-dir-resolver";
import { computeAndPersistVisionRoutingV1 } from "../../lib/vision-routing";
import { makeDevLogger, updateJob } from "../../lib/worker-utils";

// ── Local helpers ──────────────────────────────────────────────────────────────

const devLog = makeDevLogger();

// ── Processor ─────────────────────────────────────────────────────────────────

export async function extractVisualsProcessor(job: Job) {
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
}
