import path from "path";
import fs from "fs/promises";
import os from "os";
import { execFile } from "child_process";
import { promisify } from "util";

import * as pdfjs from "pdfjs-dist/legacy/build/pdf.js";
import { createCanvas, ImageData, loadImage } from "@napi-rs/canvas";

import { defaultVisualExtractionEnabled } from "./pipeline-policy";
import { logMemory, yieldToEventLoop } from "./memory";

const execFileAsync = promisify(execFile);

// pdf.js render needs ImageData in the Node runtime
(pdfjs as any).GlobalWorkerOptions.disableWorker = true;
(pdfjs as any).GlobalWorkerOptions.workerSrc = undefined;
(pdfjs as any).GlobalWorkerOptions.ImageData = ImageData;

export type VisualPageImagePersistConfig = {
	enabled: boolean;
	persist: boolean;
	// Max pages to render per chunk. Larger documents are handled via page-range sub-jobs.
	maxPages: number;
	format: "png";
	dpi: number;
	maxPixelsPerPage: number;
};

export type PdfPageChunk = { page_start: number; page_end: number };

export function planPdfRenderChunks(params: { totalPages: number; chunkSize: number }): PdfPageChunk[] {
	const totalPages = Number.isFinite(params.totalPages) ? Math.max(0, Math.floor(params.totalPages)) : 0;
	const chunkSize = Number.isFinite(params.chunkSize) ? Math.max(1, Math.floor(params.chunkSize)) : 10;
	if (!totalPages) return [];
	const out: PdfPageChunk[] = [];
	for (let start = 0; start < totalPages; start += chunkSize) {
		out.push({ page_start: start, page_end: Math.min(totalPages, start + chunkSize) });
	}
	return out;
}

export function r2RenderedPageKey(prefix: string, pageIndex: number): string {
	const safePrefix = String(prefix ?? "").trim().replace(/\/$/, "");
	const idx = Number.isFinite(pageIndex) ? Math.max(0, Math.floor(pageIndex)) : 0;
	return `${safePrefix}/page_${String(idx).padStart(4, "0")}.png`;
}

type LogLike = Pick<Console, "log" | "warn" | "error">;

type FsLike = Pick<typeof fs, "mkdir" | "readdir" | "stat" | "copyFile" | "writeFile">;

function parseBool(input: string | undefined | null): boolean {
	if (!input) return false;
	return ["1", "true", "yes", "on"].includes(input.trim().toLowerCase());
}

function parseIntWithDefault(input: string | undefined, fallback: number): number {
	const v = Number.parseInt(String(input ?? ""), 10);
	return Number.isFinite(v) ? v : fallback;
}

function safeDocIdForPath(documentId: string): string {
	return String(documentId || "").replace(/[^a-zA-Z0-9_\-]/g, "_");
}

async function dirExists(fsImpl: Pick<FsLike, "stat">, dir: string): Promise<boolean> {
	try {
		const s = await fsImpl.stat(dir);
		return s.isDirectory();
	} catch {
		return false;
	}
}

export function getVisualPageImagePersistConfig(env: NodeJS.ProcessEnv = process.env, opts?: { forceEnable?: boolean }): VisualPageImagePersistConfig {
	// Default follows pipeline policy (dev on; prod off unless explicitly opted in).
	const enabledRaw = env.ENABLE_VISUAL_EXTRACTION == null
		? defaultVisualExtractionEnabled(env)
		: parseBool(env.ENABLE_VISUAL_EXTRACTION);
	const enabled = opts?.forceEnable ? true : enabledRaw;
	const persist = opts?.forceEnable
		? true
		: env.VISUAL_PAGE_IMAGE_PERSIST != null
			? parseBool(env.VISUAL_PAGE_IMAGE_PERSIST)
			: enabled;

	// Default small to keep memory bounded; larger docs are handled via page-range sub-jobs.
	const maxPagesRaw = parseIntWithDefault(env.VISUAL_PAGE_IMAGE_MAX_PAGES, 10);
	const maxPages = Number.isFinite(maxPagesRaw) ? Math.max(0, Math.min(1000, maxPagesRaw)) : 10;

	const dpiRaw = parseIntWithDefault(env.VISUAL_PAGE_IMAGE_DPI, 300);
	const dpi = Number.isFinite(dpiRaw) ? Math.max(72, Math.min(600, dpiRaw)) : 300;

	// Hard cap on rendered raster size.
	// At 300 DPI a US Letter page (8.5×11”) is 2550×3300 = 8.4 MP; A3 is ~14.8 MP.
	// Default 15 MP keeps full 300 DPI fidelity for Letter/A4 without OOM risk.
	const maxPixelsRaw = parseIntWithDefault(env.VISUAL_PAGE_IMAGE_MAX_PIXELS, 15_000_000);
	const maxPixelsPerPage = Number.isFinite(maxPixelsRaw)
		? Math.max(250_000, Math.min(50_000_000, maxPixelsRaw))
		: 6_500_000;

	// Keep format fixed to png for now; env var accepted for forward compatibility.
	const fmt = (env.VISUAL_PAGE_IMAGE_FORMAT || "png").trim().toLowerCase();
	const format: "png" = fmt === "png" ? "png" : "png";

	return { enabled, persist, maxPages, format, dpi, maxPixelsPerPage };
}

export type PersistRenderedPagesResult = {
	ok: boolean;
	reason?: string;
	rendered_pages_dir?: string;
	rendered_pages_format?: string;
	rendered_pages_count?: number;
	rendered_pages_max_pages?: number;
	rendered_pages_created_at?: string;
	page_count_detected?: number;
};

function stableRenderedPagesDir(params: { uploadDir: string; documentId: string }): string {
	const safeId = safeDocIdForPath(params.documentId);
	return path.resolve(params.uploadDir, "rendered_pages", safeId);
}

function stableRenderedPageFilename(pageIndex: number, format: "png"): string {
	// Canonical for both local + R2: page_%04d.png
	return `page_${String(pageIndex).padStart(4, "0")}.${format}`;
}

async function bufferToPng(params: { buffer: Buffer; logger: LogLike }): Promise<Buffer | null> {
	try {
		const img = await loadImage(params.buffer);
		const canvas = createCanvas(img.width || 1, img.height || 1);
		const ctx = canvas.getContext("2d");
		ctx.drawImage(img as any, 0, 0);
		return canvas.toBuffer("image/png");
	} catch (err) {
		params.logger.warn(
			`[rendered_pages] failed to decode image buffer to png: ${err instanceof Error ? err.message : String(err)}`
		);
		return null;
	}
}

async function copyFromDebugDir(params: {
	fsImpl: FsLike;
	debugDir: string;
	outDir: string;
	maxPages: number;
	format: "png";
}): Promise<number> {
	if (!(await dirExists(params.fsImpl, params.debugDir))) return 0;

	let names: string[] = [];
	try {
		names = await params.fsImpl.readdir(params.debugDir);
	} catch {
		return 0;
	}

	const matches = names
		.map((n) => {
			const m = n.match(/^page_(\d{3})_raw\.png$/);
			if (!m) return null;
			const pageNumber = Number.parseInt(m[1], 10);
			if (!Number.isFinite(pageNumber)) return null;
			// debug pages are 1-indexed
			const pageIndex = Math.max(0, pageNumber - 1);
			return { name: n, pageIndex };
		})
		.filter(Boolean) as Array<{ name: string; pageIndex: number }>;

	matches.sort((a, b) => a.pageIndex - b.pageIndex);

	let copied = 0;
	for (const m of matches) {
		if (copied >= params.maxPages) break;
		const src = path.join(params.debugDir, m.name);
		const dst = path.join(params.outDir, stableRenderedPageFilename(m.pageIndex, params.format));
		try {
			await params.fsImpl.copyFile(src, dst);
			copied += 1;
		} catch {
			// best-effort
		}
	}

	return copied;
}

/**
 * Pure helper – computes the effective render DPI and whether pixel-cap
 * downscaling was applied. Exported for unit testing.
 *
 * PDF points are 1/72 inch, so scale = dpi / 72.
 * If the resulting pixel count exceeds maxPixelsPerPage the scale is capped
 * proportionally, which effectively lowers the DPI.
 */
export function computeRenderDpiInfo(params: {
	requestedDpi: number;
	maxPixelsPerPage: number;
	/** Unscaled PDF viewport width in PDF points */
	pageWidthPts: number;
	/** Unscaled PDF viewport height in PDF points */
	pageHeightPts: number;
}): { effectiveDpi: number; effectiveScale: number; wasDownscaled: boolean } {
	const scale = params.requestedDpi / 72;
	const basePixels = Math.ceil(params.pageWidthPts) * Math.ceil(params.pageHeightPts);
	const pixelScaleCap = basePixels > 0 ? Math.sqrt(params.maxPixelsPerPage / basePixels) : 1;
	const effectiveScale = Math.max(0.1, Math.min(scale, pixelScaleCap));
	return {
		effectiveDpi: Math.round(effectiveScale * 72),
		effectiveScale,
		wasDownscaled: effectiveScale < scale,
	};
}

async function renderPdfToPngFiles(params: {
	buffer: Buffer;
	documentId: string;
	fsImpl: FsLike;
	outDir: string;
	maxPages: number;
	dpi: number;
	maxPixelsPerPage: number;
	format: "png";
	logger: LogLike;
	pageStart?: number;
	// End is exclusive (0-based page index). If omitted, renders up to maxPages pages.
	pageEnd?: number;
}): Promise<number> {
	const withTimeout = async <T,>(promise: Promise<T>, ms: number, context: Record<string, unknown>): Promise<T> => {
		let timeout: NodeJS.Timeout | null = null;
		try {
			return await new Promise<T>((resolve, reject) => {
				timeout = setTimeout(() => {
					const stage = typeof context.stage === "string" ? context.stage : "unknown";
					const docId = typeof context.document_id === "string" ? context.document_id : "";
					const pageIndex = typeof context.page_index === "number" ? context.page_index : null;
					reject(
						new Error(
							`TIMEOUT stage=${stage} doc_id=${docId}${pageIndex == null ? "" : ` page_index=${pageIndex}`} ms=${ms} context=${JSON.stringify(context)}`
						)
					);
				}, ms);
				promise.then(resolve, reject);
			});
		} finally {
			if (timeout) clearTimeout(timeout);
		}
	};

	const data = new Uint8Array(params.buffer.buffer, params.buffer.byteOffset, params.buffer.byteLength);
	const standardFontDataUrl = path.join(path.dirname(require.resolve("pdfjs-dist/package.json")), "standard_fonts/");

	let pdf: any;
	try {
		logMemory("pdf_render:before_pdf_load", { document_id: params.documentId });
		pdf = await (pdfjs as any).getDocument({ data, standardFontDataUrl }).promise;
		logMemory("pdf_render:after_pdf_load", {
			document_id: params.documentId,
			num_pages: typeof pdf?.numPages === "number" ? pdf.numPages : null,
		});
	} catch (err) {
		params.logger.warn(
			`[rendered_pages] failed to load pdf doc=${params.documentId}: ${err instanceof Error ? err.message : String(err)}`
		);
		return 0;
	}

	const totalPages = typeof pdf?.numPages === "number" ? pdf.numPages : 0;
	const requestedStart = typeof params.pageStart === "number" && Number.isFinite(params.pageStart) ? Math.max(0, params.pageStart) : 0;
	const requestedEndExclusive = typeof params.pageEnd === "number" && Number.isFinite(params.pageEnd) ? Math.max(requestedStart, params.pageEnd) : null;
	const maxByConfig = Math.max(0, params.maxPages);
	const lastPageIndex = totalPages > 0 ? totalPages - 1 : -1;
	const effectiveEndIndex = requestedEndExclusive == null
		? (lastPageIndex >= 0 ? Math.min(lastPageIndex, requestedStart + maxByConfig - 1) : requestedStart + maxByConfig - 1)
		: (lastPageIndex >= 0 ? Math.min(lastPageIndex, requestedEndExclusive - 1) : requestedEndExclusive - 1);

	let written = 0;
	for (let pageIndex = requestedStart; pageIndex <= effectiveEndIndex; pageIndex += 1) {
		let page: any;
		try {
			const pageNumber = pageIndex + 1;
			page = await pdf.getPage(pageNumber);

			// Compute a safe scale that respects max pixels per page.
			const baseViewport = page.getViewport({ scale: 1 });
			const dpiInfo = computeRenderDpiInfo({
				requestedDpi: params.dpi,
				maxPixelsPerPage: params.maxPixelsPerPage,
				pageWidthPts: baseViewport.width,
				pageHeightPts: baseViewport.height,
			});
			const { effectiveScale } = dpiInfo;
			const viewport = page.getViewport({ scale: effectiveScale });
			const w = Math.ceil(viewport.width);
			const h = Math.ceil(viewport.height);

			// One structured log per chunk (first page only) so production logs
			// provide an unambiguous record of the actual render DPI.
			if (pageIndex === requestedStart) {
				params.logger.log(JSON.stringify({
					event: "RENDER_PAGE_DPI",
					document_id: params.documentId,
					page_index: pageIndex,
					output_width_px: w,
					output_height_px: h,
					megapixels: parseFloat(((w * h) / 1_000_000).toFixed(2)),
					requested_dpi: params.dpi,
					effective_dpi: dpiInfo.effectiveDpi,
					was_downscaled: dpiInfo.wasDownscaled,
					max_pixels_per_page: params.maxPixelsPerPage,
					ts: new Date().toISOString(),
				}));
			}

			logMemory("pdf_render:before_page_render", {
				document_id: params.documentId,
				page_index: pageIndex,
				page_number: pageNumber,
				dpi: params.dpi,
				scale: effectiveScale,
				width_px: w,
				height_px: h,
				pixels: w * h,
				max_pixels: params.maxPixelsPerPage,
			});

			const canvas = createCanvas(w || 1, h || 1);
			const context = canvas.getContext("2d");
			await withTimeout(
				page.render({ canvasContext: context as any, viewport } as any).promise,
				120_000,
				{ stage: "render_page", document_id: params.documentId, page_index: pageIndex }
			);
			const png = canvas.toBuffer("image/png");
			const outPath = path.join(params.outDir, stableRenderedPageFilename(pageIndex, params.format));
			await params.fsImpl.writeFile(outPath, png);
			written += 1;
			logMemory("pdf_render:after_page_render", { document_id: params.documentId, page_index: pageIndex });

			// Help BullMQ renew locks and keep RSS stable between pages.
			try {
				await page.cleanup?.();
			} catch {
				// ignore
			}
			try {
				(canvas as any).width = 0;
				(canvas as any).height = 0;
			} catch {
				// ignore
			}
			await yieldToEventLoop();
		} catch (err) {
			params.logger.warn(
				`[rendered_pages] failed to render page=${pageIndex + 1} doc=${params.documentId}: ${err instanceof Error ? err.message : String(err)}`
			);
			continue;
		}
	}

	try {
		await pdf.destroy?.();
	} catch {
		// ignore
	}

	return written;
}

export async function persistRenderedPageImages(params: {
	buffer: Buffer;
	documentId: string;
	pageCount: number;
	uploadDir: string;
	config: VisualPageImagePersistConfig;
	logger?: LogLike;
	fsImpl?: FsLike;
	now?: () => Date;
	pageStart?: number;
	pageEnd?: number;
}): Promise<PersistRenderedPagesResult> {
	const logger = params.logger ?? console;
	const fsImpl = params.fsImpl ?? fs;
	const now = params.now ?? (() => new Date());

	if (!params.config.enabled) return { ok: true, reason: "visual_extraction_disabled" };
	if (!params.config.persist) return { ok: true, reason: "persist_disabled" };

	// Structured log: emit once per invocation so DPI is visible in production logs.
	logger.log(
		JSON.stringify({
			event: "RENDER_PAGES_CONFIG",
			document_id: params.documentId,
			rasterizer: "pdfjs-dist",
			VISUAL_PAGE_IMAGE_DPI: params.config.dpi,
			max_pixels_per_page: params.config.maxPixelsPerPage,
			max_pages: params.config.maxPages,
			format: params.config.format,
			page_start: params.pageStart ?? null,
			page_end: params.pageEnd ?? null,
			page_count_hint: typeof params.pageCount === "number" && Number.isFinite(params.pageCount) ? params.pageCount : null,
			ts: new Date().toISOString(),
		})
	);
	// If pageCount is unknown (older ingests), proceed anyway and let PDF rendering determine page count.
	const pageCountHint = typeof params.pageCount === "number" && Number.isFinite(params.pageCount) ? params.pageCount : 0;

	const safeId = safeDocIdForPath(params.documentId);
	const outDir = stableRenderedPagesDir({ uploadDir: params.uploadDir, documentId: params.documentId });
	const debugDir = path.join("/tmp/pdf_extract_debug", safeId);

	try {
		await fsImpl.mkdir(outDir, { recursive: true } as any);
	} catch (err) {
		logger.warn(
			`[rendered_pages] mkdir failed doc=${params.documentId} dir=${outDir}: ${err instanceof Error ? err.message : String(err)}`
		);
		return { ok: true, reason: "mkdir_failed" };
	}

	// If pageCount is known, cap render count; otherwise we will render up to config.maxPages.
	const maxPages = pageCountHint > 0 ? Math.min(params.config.maxPages, pageCountHint) : params.config.maxPages;
	let written = 0;

	try {
		written = await copyFromDebugDir({
			fsImpl,
			debugDir,
			outDir,
			maxPages,
			format: params.config.format,
		});
	} catch (err) {
		logger.warn(
			`[rendered_pages] copy from debug failed doc=${params.documentId}: ${err instanceof Error ? err.message : String(err)}`
		);
		written = 0;
	}

	let detectedTotalPages: number | undefined = undefined;
	if (written === 0) {
		// Render from PDF directly.
		written = await renderPdfToPngFiles({
			buffer: params.buffer,
			documentId: params.documentId,
			fsImpl,
			outDir,
			maxPages,
			dpi: params.config.dpi,
			maxPixelsPerPage: params.config.maxPixelsPerPage,
			format: params.config.format,
			logger,
			pageStart: params.pageStart,
			pageEnd: params.pageEnd,
		});

		// Best-effort: detect total pages in the PDF so callers can backfill documents.page_count.
		try {
			const data = new Uint8Array(params.buffer.buffer, params.buffer.byteOffset, params.buffer.byteLength);
			const standardFontDataUrl = path.join(path.dirname(require.resolve("pdfjs-dist/package.json")), "standard_fonts/");
			const pdf = await (pdfjs as any).getDocument({ data, standardFontDataUrl }).promise;
			const totalPages = typeof pdf?.numPages === "number" ? pdf.numPages : 0;
			if (Number.isFinite(totalPages) && totalPages > 0) detectedTotalPages = totalPages;
			await pdf.destroy?.();
		} catch {
			// ignore
		}
	}

	const createdAt = now().toISOString();
	return {
		ok: true,
		rendered_pages_dir: outDir,
		rendered_pages_format: params.config.format,
		rendered_pages_count: written,
		rendered_pages_max_pages: params.config.maxPages,
		rendered_pages_created_at: createdAt,
		page_count_detected: detectedTotalPages,
	};
}

type OfficePdfConversionResult = {
	pdf: Buffer | null;
	reason?: string;
};

export async function convertOfficeToPdfBuffer(params: {
	buffer: Buffer;
	ext: "pptx" | "ppt" | "docx" | "doc" | "xlsx" | "xls";
	logger?: LogLike;
}): Promise<OfficePdfConversionResult> {
	const logger = params.logger ?? console;
	let tmpDir: string | null = null;
	try {
		tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ddai-office-render-"));
		const inputPath = path.join(tmpDir, `input.${params.ext}`);
		const outputPath = path.join(tmpDir, "input.pdf");
		await fs.writeFile(inputPath, params.buffer);
		try {
			await execFileAsync("soffice", ["--headless", "--convert-to", "pdf", "--outdir", tmpDir, inputPath], {
				timeout: 20000,
			});
		} catch (err) {
			const code = (err as any)?.code;
			if (code === "ENOENT") {
				logger.warn(`[rendered_pages] soffice missing (ENOENT) ext=${params.ext}`);
				return { pdf: null, reason: "soffice_missing" };
			}
			logger.warn(
				`[rendered_pages] soffice conversion failed ext=${params.ext}: ${
					err instanceof Error ? err.message : String(err)
				}`
			);
			return { pdf: null, reason: "soffice_failed" };
		}

		try {
			const pdf = await fs.readFile(outputPath);
			if (pdf && pdf.length > 0) return { pdf };
		} catch (err) {
			logger.warn(
				`[rendered_pages] soffice produced no pdf ext=${params.ext}: ${
					err instanceof Error ? err.message : String(err)
				}`
			);
			return { pdf: null, reason: "soffice_no_pdf" };
		}
	} catch (err) {
		logger.warn(
			`[rendered_pages] office conversion setup failed: ${err instanceof Error ? err.message : String(err)}`
		);
		return { pdf: null, reason: "conversion_setup_failed" };
	} finally {
		if (tmpDir) {
			try {
				await fs.rm(tmpDir, { recursive: true, force: true });
			} catch {
				// ignore cleanup errors
			}
		}
	}

	return { pdf: null, reason: "unknown" };
}

export async function renderNonPdfToPageImages(params: {
	buffer: Buffer;
	fileExt: string;
	documentId: string;
	uploadDir: string;
	pageCount: number;
	config: VisualPageImagePersistConfig;
	logger?: LogLike;
	fsImpl?: FsLike;
}): Promise<PersistRenderedPagesResult> {
	const ext = params.fileExt.toLowerCase();
	if (!params.config.enabled || !params.config.persist) return { ok: true, reason: "persist_disabled" };
	if (!["ppt", "pptx", "doc", "docx", "xls", "xlsx"].includes(ext)) {
		return { ok: true, reason: "unsupported_extension" };
	}

	const conversion = await convertOfficeToPdfBuffer({ buffer: params.buffer, ext: ext as any, logger: params.logger });
	if (!conversion.pdf) return { ok: true, reason: conversion.reason ?? "conversion_failed" };

	return persistRenderedPageImages({
		buffer: conversion.pdf,
		documentId: params.documentId,
		pageCount: params.pageCount,
		uploadDir: params.uploadDir,
		config: params.config,
		logger: params.logger,
		fsImpl: params.fsImpl,
	});
}

export async function persistImagePage(params: {
	buffer: Buffer;
	documentId: string;
	uploadDir: string;
	config: VisualPageImagePersistConfig;
	logger?: LogLike;
	fsImpl?: FsLike;
}): Promise<PersistRenderedPagesResult> {
	const logger = params.logger ?? console;
	const fsImpl = params.fsImpl ?? fs;
	if (!params.config.enabled || !params.config.persist) return { ok: true, reason: "persist_disabled" };

	const outDir = stableRenderedPagesDir({ uploadDir: params.uploadDir, documentId: params.documentId });
	try {
		await fsImpl.mkdir(outDir, { recursive: true } as any);
	} catch (err) {
		logger.warn(
			`[rendered_pages] mkdir failed doc=${params.documentId} dir=${outDir}: ${
				err instanceof Error ? err.message : String(err)
			}`
		);
		return { ok: true, reason: "mkdir_failed" };
	}

	const png = await bufferToPng({ buffer: params.buffer, logger });
	if (!png) return { ok: true, reason: "image_decode_failed" };
	const outPath = path.join(outDir, stableRenderedPageFilename(0, params.config.format));
	try {
		await fsImpl.writeFile(outPath, png);
	} catch (err) {
		logger.warn(
			`[rendered_pages] write failed doc=${params.documentId} path=${outPath}: ${
				err instanceof Error ? err.message : String(err)
			}`
		);
		return { ok: true, reason: "write_failed" };
	}

	const createdAt = new Date().toISOString();
	return {
		ok: true,
		rendered_pages_dir: outDir,
		rendered_pages_format: params.config.format,
		rendered_pages_count: 1,
		rendered_pages_max_pages: 1,
		rendered_pages_created_at: createdAt,
		page_count_detected: 1,
	};
}
