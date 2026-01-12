import path from "path";
import fs from "fs/promises";
import os from "os";
import { execFile } from "child_process";
import { promisify } from "util";

import * as pdfjs from "pdfjs-dist/legacy/build/pdf.js";
import { createCanvas, ImageData, loadImage } from "@napi-rs/canvas";

const execFileAsync = promisify(execFile);

// pdf.js render needs ImageData in the Node runtime
(pdfjs as any).GlobalWorkerOptions.disableWorker = true;
(pdfjs as any).GlobalWorkerOptions.workerSrc = undefined;
(pdfjs as any).GlobalWorkerOptions.ImageData = ImageData;

export type VisualPageImagePersistConfig = {
	enabled: boolean;
	persist: boolean;
	maxPages: number;
	format: "png";
	dpi: number;
};

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
	// Default ON so rendered pages are produced even if ENABLE_VISUAL_EXTRACTION is unset.
	const enabledRaw = env.ENABLE_VISUAL_EXTRACTION == null
		? true
		: parseBool(env.ENABLE_VISUAL_EXTRACTION);
	const enabled = opts?.forceEnable ? true : enabledRaw;
	const persist = opts?.forceEnable
		? true
		: env.VISUAL_PAGE_IMAGE_PERSIST != null
			? parseBool(env.VISUAL_PAGE_IMAGE_PERSIST)
			: enabled;

	const maxPagesRaw = parseIntWithDefault(env.VISUAL_PAGE_IMAGE_MAX_PAGES, 50);
	const maxPages = Number.isFinite(maxPagesRaw) ? Math.max(0, Math.min(1000, maxPagesRaw)) : 50;

	const dpiRaw = parseIntWithDefault(env.VISUAL_PAGE_IMAGE_DPI, 200);
	const dpi = Number.isFinite(dpiRaw) ? Math.max(72, Math.min(600, dpiRaw)) : 200;

	// Keep format fixed to png for now; env var accepted for forward compatibility.
	const fmt = (env.VISUAL_PAGE_IMAGE_FORMAT || "png").trim().toLowerCase();
	const format: "png" = fmt === "png" ? "png" : "png";

	return { enabled, persist, maxPages, format, dpi };
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
	return `page_${String(pageIndex).padStart(3, "0")}.${format}`;
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

async function renderPdfToPngFiles(params: {
	buffer: Buffer;
	documentId: string;
	fsImpl: FsLike;
	outDir: string;
	maxPages: number;
	dpi: number;
	format: "png";
	logger: LogLike;
}): Promise<number> {
	const data = new Uint8Array(params.buffer.buffer, params.buffer.byteOffset, params.buffer.byteLength);
	const standardFontDataUrl = path.join(path.dirname(require.resolve("pdfjs-dist/package.json")), "standard_fonts/");

	let pdf: any;
	try {
		pdf = await (pdfjs as any).getDocument({ data, standardFontDataUrl }).promise;
	} catch (err) {
		params.logger.warn(
			`[rendered_pages] failed to load pdf doc=${params.documentId}: ${err instanceof Error ? err.message : String(err)}`
		);
		return 0;
	}

	const totalPages = typeof pdf?.numPages === "number" ? pdf.numPages : 0;
	const pagesToRender = Math.min(Math.max(0, params.maxPages), totalPages);
	const scale = params.dpi / 72;

	let written = 0;
	for (let i = 1; i <= pagesToRender; i += 1) {
		let page: any;
		try {
			page = await pdf.getPage(i);
			const viewport = page.getViewport({ scale });
			const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
			const context = canvas.getContext("2d");
			await page.render({ canvasContext: context as any, viewport } as any).promise;
			const png = canvas.toBuffer("image/png");

			const pageIndex = i - 1;
			const outPath = path.join(params.outDir, stableRenderedPageFilename(pageIndex, params.format));
			await params.fsImpl.writeFile(outPath, png);
			written += 1;
		} catch (err) {
			params.logger.warn(
				`[rendered_pages] failed to render page=${i} doc=${params.documentId}: ${err instanceof Error ? err.message : String(err)}`
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
}): Promise<PersistRenderedPagesResult> {
	const logger = params.logger ?? console;
	const fsImpl = params.fsImpl ?? fs;
	const now = params.now ?? (() => new Date());

	if (!params.config.enabled) return { ok: true, reason: "visual_extraction_disabled" };
	if (!params.config.persist) return { ok: true, reason: "persist_disabled" };
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
			format: params.config.format,
			logger,
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

async function convertOfficeToPdfBuffer(params: {
	buffer: Buffer;
	ext: "pptx" | "ppt" | "docx" | "doc" | "xlsx" | "xls";
	logger?: LogLike;
}): Promise<Buffer | null> {
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
			logger.warn(
				`[rendered_pages] soffice conversion failed ext=${params.ext}: ${
					err instanceof Error ? err.message : String(err)
				}`
			);
			return null;
		}

		try {
			const pdf = await fs.readFile(outputPath);
			if (pdf && pdf.length > 0) return pdf;
		} catch (err) {
			logger.warn(
				`[rendered_pages] soffice produced no pdf ext=${params.ext}: ${
					err instanceof Error ? err.message : String(err)
				}`
			);
			return null;
		}
	} catch (err) {
		logger.warn(
			`[rendered_pages] office conversion setup failed: ${err instanceof Error ? err.message : String(err)}`
		);
		return null;
	} finally {
		if (tmpDir) {
			try {
				await fs.rm(tmpDir, { recursive: true, force: true });
			} catch {
				// ignore cleanup errors
			}
		}
	}

	return null;
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

	const pdfBuffer = await convertOfficeToPdfBuffer({ buffer: params.buffer, ext: ext as any, logger: params.logger });
	if (!pdfBuffer) return { ok: true, reason: "conversion_failed" };

	return persistRenderedPageImages({
		buffer: pdfBuffer,
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
