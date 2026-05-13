/**
 * precheck.ts
 *
 * Extracted setup/precheck block from runExtractVisualsCoordinator.
 * Handles payload normalization, job mode detection, target document ID resolution,
 * vision config and service verification, table existence checks, and pool setup.
 *
 * Contract: behavior-preserving extraction only — no logic changes from coordinator.ts.
 */
import type { Job } from "bullmq";
import { getPool, getDocumentsForDeal } from "../../lib/db";
import {
	getVisionExtractorConfig,
	createVisionJobRuntime,
	hasTable,
} from "../../lib/visual-extraction";
import { verifyVisionServiceForJob } from "../../lib/vision-verification";
import { enqueueAnalyzeDeal } from "../../lib/enqueue-analyze-deal";
import { logMemory } from "../../lib/memory";
import { makeDevLogger, updateJob } from "../../lib/worker-utils";

const devLog = makeDevLogger();

// ── Types ─────────────────────────────────────────────────────────────────────

export type ExtractVisualsPrecheckContext = {
	pool: ReturnType<typeof getPool>;
	payload: any;
	documentId: string | undefined;
	dealId: string | undefined;
	dealIdForAudit: string | undefined;
	targetDocumentIds: string[];
	config: ReturnType<typeof getVisionExtractorConfig>;
	visionRuntime: ReturnType<typeof createVisionJobRuntime>;
	visionEnabledForJob: boolean;
	extractorVersion: string;
	structuredExtractorVersion: string;
	allowRenderedPagesFallback: boolean;
	nonPdfRenderEnabled: boolean;
	tablesOk: boolean;
	originalFileTablesOk: boolean;
	documentsMetaStatusOk: boolean;
	forceResegment: boolean;
	forceReextract: boolean;
	forceOcr: boolean;
	enqueueDeepScan: boolean;
	requestedPageStart: number;
	requestedPageEnd: number | undefined;
	imageUris: string[] | undefined;
	extractorVersionOverride: string | undefined;
	isChunkJob: boolean;
	isCoordinator: boolean;
};

export type PrecheckOutcome =
	| {
			failed: true;
			result: {
				ok: false;
				skipped?: boolean;
				reason?: string;
			};
	  }
	| {
			failed: false;
			context: ExtractVisualsPrecheckContext;
	  };

// ── Helper ────────────────────────────────────────────────────────────────────

/**
 * Run all setup and validation checks required before visual extraction begins.
 *
 * Returns `{ failed: true, result }` for any early-exit condition (disabled flag,
 * missing documents, missing tables, DB error).
 * Returns `{ failed: false, context }` with all downstream values ready for use.
 */
export async function runExtractVisualsPrecheck(
	job: Job,
	data: Record<string, unknown>
): Promise<PrecheckOutcome> {
	// ── Payload normalization ────────────────────────────────────────────────────
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

	const isChunkJob = Boolean(
		payload.chunk && payload.chunk.page_start != null && payload.chunk.page_end != null
	);
	const isCoordinator = !isChunkJob;

	let dealIdForAudit: string | undefined =
		typeof dealId === "string" && dealId.trim().length > 0 ? dealId.trim() : undefined;
	if (!dealIdForAudit) {
		const payloadDealId =
			typeof (data as any)?.deal_id === "string" ? String((data as any).deal_id).trim() : "";
		dealIdForAudit = payloadDealId.length > 0 ? payloadDealId : undefined;
	}

	const imageUris = Array.isArray(normalized.image_uris) ? normalized.image_uris : undefined;
	const extractorVersionOverride =
		typeof normalized.extractor_version === "string" ? normalized.extractor_version : undefined;
	const forceResegment = Boolean((normalized as any).force_resegment);
	const forceReextract = Boolean((normalized as any).force_reextract);
	const forceOcr = Boolean((normalized as any).force_ocr);
	const enqueueDeepScan = Boolean((normalized as any).enqueue_deep_scan);

	const pageStartRaw = payload?.chunk?.page_start;
	const pageEndRaw = payload?.chunk?.page_end;
	const requestedPageStart =
		typeof pageStartRaw === "number" && Number.isFinite(pageStartRaw)
			? Math.max(0, Math.floor(pageStartRaw))
			: 0;
	const requestedPageEnd =
		typeof pageEndRaw === "number" && Number.isFinite(pageEndRaw)
			? Math.max(0, Math.floor(pageEndRaw))
			: undefined;

	// ── Target document ID resolution ────────────────────────────────────────────
	const explicitDocumentIds = Array.isArray(normalized.document_ids)
		? (normalized.document_ids as any[]).filter(
				(id) => typeof id === "string" && id.trim().length > 0
		  )
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
			await updateJob(
				job,
				"failed",
				err instanceof Error ? err.message : "Failed to load deal documents",
				100
			);
			return { failed: true, result: { ok: false } };
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
		return { failed: true, result: { ok: false } };
	}

	// ── Vision config ────────────────────────────────────────────────────────────
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
		return { failed: true, result: { ok: false, skipped: true, reason: "disabled" } };
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

	const extractorVersion =
		typeof extractorVersionOverride === "string" && extractorVersionOverride.trim()
			? extractorVersionOverride.trim()
			: config.extractorVersion;
	const structuredExtractorVersion =
		process.env.STRUCTURED_VISION_EXTRACTOR_VERSION || "structured_native_v1";
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

	// ── Pool + table checks ───────────────────────────────────────────────────────
	const pool = getPool();
	const docsTotal = targetDocumentIds.length;
	logMemory("extract_visuals:job_start", {
		job_id: job.id ? String(job.id) : null,
		deal_id: dealId ?? null,
		docs_total: docsTotal,
		chunk: isChunkJob
			? { page_start: requestedPageStart, page_end: requestedPageEnd ?? null }
			: null,
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
		return { failed: true, result: { ok: false, skipped: true, reason: "tables_missing" } };
	}

	const originalFileTablesOk =
		(await hasTable(pool, "document_files")) &&
		(await hasTable(pool, "document_file_blobs"));

	const allowRenderedPagesFallback = (() => {
		const raw = process.env.EXTRACT_VISUALS_ALLOW_RENDERED_PAGES_FALLBACK;
		if (raw != null) return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase());
		return process.env.NODE_ENV !== "production";
	})();

	// ── Column existence check ───────────────────────────────────────────────────
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

	return {
		failed: false,
		context: {
			pool,
			payload,
			documentId,
			dealId,
			dealIdForAudit,
			targetDocumentIds,
			config,
			visionRuntime,
			visionEnabledForJob,
			extractorVersion,
			structuredExtractorVersion,
			allowRenderedPagesFallback,
			nonPdfRenderEnabled,
			tablesOk,
			originalFileTablesOk,
			documentsMetaStatusOk,
			forceResegment,
			forceReextract,
			forceOcr,
			enqueueDeepScan,
			requestedPageStart,
			requestedPageEnd,
			imageUris,
			extractorVersionOverride,
			isChunkJob,
			isCoordinator,
		},
	};
}
