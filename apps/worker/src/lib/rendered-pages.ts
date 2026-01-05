import path from "path";
import fs from "fs/promises";

import * as pdfjs from "pdfjs-dist/legacy/build/pdf.js";
import { createCanvas, ImageData } from "@napi-rs/canvas";

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

export function getVisualPageImagePersistConfig(env: NodeJS.ProcessEnv = process.env): VisualPageImagePersistConfig {
	const enabled = parseBool(env.ENABLE_VISUAL_EXTRACTION);
	const persist =
		env.VISUAL_PAGE_IMAGE_PERSIST != null
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
};

function stableRenderedPagesDir(params: { uploadDir: string; documentId: string }): string {
	const safeId = safeDocIdForPath(params.documentId);
	return path.resolve(params.uploadDir, "rendered_pages", safeId);
}

function stableRenderedPageFilename(pageIndex: number, format: "png"): string {
	return `page_${String(pageIndex).padStart(3, "0")}.${format}`;
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
	if (params.pageCount <= 0) return { ok: true, reason: "no_pages" };

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

	const maxPages = Math.min(params.config.maxPages, params.pageCount);
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

	if (written === 0) {
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
	}

	const createdAt = now().toISOString();
	return {
		ok: true,
		rendered_pages_dir: outDir,
		rendered_pages_format: params.config.format,
		rendered_pages_count: written,
		rendered_pages_max_pages: params.config.maxPages,
		rendered_pages_created_at: createdAt,
	};
}
