import type { Job } from "bullmq";
import { sanitizeText } from "@dealdecision/core";
import {
	getPool,
	mergeDocumentExtractionMetadata,
	getDocumentsForDeal,
} from "../../lib/db";
import {
	callVisionWorkerWithRetries,
	createVisionJobRuntime,
	getVisionExtractorConfig,
	buildDeepScanExtractionMetadataPatch,
	buildDeepScanPageSummaryV1,
	computeDeepScanOutcomeStatus,
	hasTable,
	persistVisionResponse,
	resolvePageImageUris,
} from "../../lib/visual-extraction";
import { computeAndPersistVisionRoutingV1 } from "../../lib/vision-routing";
import { logMemory, yieldToEventLoop } from "../../lib/memory";
import { updateJobProgress, emitJobProgress } from "../../lib/job-progress";
import { verifyVisionServiceForJob } from "../../lib/vision-verification";
import { enqueuePersistedJob } from "../../lib/job-enqueue";
import { planChunkEnqueues } from "../../lib/page-chunks";
import { tryReadImageB64ForVision, headCheckImageUri } from "../../lib/vision-image";
import { updateJob } from "../../lib/worker-utils";

// ── Processor ─────────────────────────────────────────────────────────────────

export async function deepScanVisualsProcessor(job: Job): Promise<any> {
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
}
