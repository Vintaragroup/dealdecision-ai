import type { Job } from "bullmq";
import path from "path";
import fs from "fs/promises";
import { sanitizeText } from "@dealdecision/core";

import {
	getPool,
	mergeDocumentExtractionMetadata,
	updateDocumentAnalysis,
	getDocumentOriginalFile,
} from "../../lib/db";
import { updateJobProgress } from "../../lib/job-progress";
import { getR2BucketIfEnabled, getDocumentStorageMode } from "../../lib/document-storage-mode";
import { uploadToR2, r2ObjectExists } from "../../lib/r2";
import {
	getVisualPageImagePersistConfig,
	persistRenderedPageImages,
	persistImagePage,
	r2RenderedPageKey,
	convertOfficeToPdfBuffer,
} from "../../lib/rendered-pages";
import { getQueue } from "../../lib/queue";
import { makeJobId } from "../../lib/job-id";
import {
	enqueueExtractVisualsIfPossible,
	getVisionExtractorConfig,
} from "../../lib/visual-extraction";
import { shouldSkipExtractVisualsAfterRenderV1 } from "../../lib/render-followups";
import { resolveWritableUploadDir } from "../../lib/upload-dir-resolver";
import { computeAndPersistVisionRoutingV1 } from "../../lib/vision-routing";
import { updateJob } from "../../lib/worker-utils";

// ── Module-level helpers ─────────────────────────────────────────────────────

async function withTimeout<T>(
	promise: Promise<T>,
	ms: number,
	context: Record<string, unknown>
): Promise<T> {
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
}

// ── Processor ────────────────────────────────────────────────────────────────

export async function renderDocumentPagesProcessor(job: Job) {
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
}
