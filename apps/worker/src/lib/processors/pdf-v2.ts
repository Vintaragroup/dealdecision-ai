import * as pdfjs from "pdfjs-dist/legacy/build/pdf.js";

// Ensure pdf.js does not try to spawn a separate worker process in Node.
(pdfjs as any).GlobalWorkerOptions.disableWorker = true;

import { getVisionExtractorConfig } from "../visual-extraction";
import { callPdfV2Worker } from "../pdf_v2/vision-worker-client";
import { extractPDFContent, ocrPdfPageV1, ocrPdfPageV2, type PDFContent, type OcrV2Result } from "./pdf";
import { getPipelineAutomationMode } from "../pipeline-policy";

export type PdfV2ExtractMode = "v2_shadow" | "v2_primary";

type PdfV2NativePage = {
	page_index: number;
	// "pymupdf" is retained for backward compatibility with DB-persisted records
	// from ingestion jobs that ran before PyMuPDF was removed (2026-03-31).
	// New pages from the Python vision_worker will always carry "pdfplumber".
	// Do not remove this union until a DB migration clears all historical records.
	method: "pdfplumber" | "pymupdf";
	text: string;
	word_count: number;
	image_count: number;
	page_width: number;
	page_height: number;
	blocks: Array<{
		text: string;
		bbox: { x: number; y: number; w: number; h: number };
		bbox_units: "normalized";
	}>;
};

type PdfV2NativeResponse = {
	document_id: string;
	extractor_version: string;
	pages: PdfV2NativePage[];
};

type PdfV2PageClassification = {
	kind: "text" | "scanned" | "hybrid";
	reason: string;
	native_word_count: number;
	native_text_len: number;
	image_count: number;
};

type PdfV2UnifiedPage = {
	page_index: number;
	page_number: number;
	classification: PdfV2PageClassification;
	bbox_units: "normalized";
	native: {
		method: PdfV2NativePage["method"];
		text: string;
		word_count: number;
		blocks: PdfV2NativePage["blocks"];
		confidence: number;
	};
	ocr?: {
		provider: "tesseract";
		text: string;
		word_count: number;
		avg_confidence: number; // 0..1
		bbox_units: "pixels";
	};
	ocr_v2?: {
		provider: "tesseract";
		version: "ocr_v2";
		text: string;
		blocks: Array<{
			text: string;
			bbox: { x: number; y: number; w: number; h: number };
			bbox_units: "pixels";
			confidence: number; // 0..1
		}>;
		avg_confidence: number; // 0..1
		bbox_units: "pixels";
		preproc: { mode: "basic"; contrast: number; threshold: number };
		scale: number;
		imageWidth: number;
		imageHeight: number;
		regions: Array<{ x: number; y: number; w: number; h: number }>;
		skippedRegions: number;
		usedFullPageFallback: boolean;
	};
	// Non-fatal OCR errors (shadow/primary should continue). These preserve context for debugging.
	ocr_error?: {
		stage: "pdf_v2_ocr_v1";
		page_index: number;
		timeout_ms: number;
		errorMessage: string;
	};
	ocr_v2_error?: {
		stage: "pdf_v2_ocr_v2";
		page_index: number;
		timeout_ms: number;
		errorMessage: string;
	};
	final: {
		method: "native" | "ocr" | "hybrid";
		text: string;
	};
};

const OCR_TIMEOUT_MS_FALLBACK = 120000;

function parseTimeoutMsFromErrorMessage(msg: string): number {
	const m = String(msg || "").match(/after\s+(\d+)ms/i);
	if (!m) return OCR_TIMEOUT_MS_FALLBACK;
	const n = Number(m[1]);
	return Number.isFinite(n) && n > 0 ? n : OCR_TIMEOUT_MS_FALLBACK;
}

export type PdfV2ShadowArtifacts = {
	status: "ok" | "error";
	mode: PdfV2ExtractMode;
	extractor_version: string;
	document_id: string;
	created_at: string;
	summary?: {
		pages: number;
		native_only_pages: number;
		ocr_pages: number;
		hybrid_pages: number;
		scanned_pages: number;
		text_pages: number;
		native_methods: Record<string, number>;
	};
	pages?: PdfV2UnifiedPage[];
	error?: string;
};

function normalizeText(s: string): string {
	return String(s || "").replace(/\s+/g, " ").trim();
}

function avgConf01(confs: number[]): number {
	if (!confs.length) return 0;
	const sum = confs.reduce((a, b) => a + b, 0);
	return Math.max(0, Math.min(1, sum / confs.length));
}

function classifyPage(native: Pick<PdfV2NativePage, "word_count" | "text" | "image_count">): PdfV2PageClassification {
	const nativeText = normalizeText(native.text);
	const nativeWordCount = Number(native.word_count || 0);
	const nativeTextLen = nativeText.length;
	const imageCount = Number(native.image_count || 0);

	// Conservative classifier:
	// - scanned if essentially no native words AND page has images (very common for scanned PDFs)
	// - scanned if extremely low text overall
	const scannedByImages = nativeWordCount < 5 && imageCount > 0;
	const scannedByLowText = nativeWordCount < 3 && nativeTextLen < 20;

	if (scannedByImages) {
		return { kind: "scanned", reason: "native_text_sparse_and_images_present", native_word_count: nativeWordCount, native_text_len: nativeTextLen, image_count: imageCount };
	}
	if (scannedByLowText) {
		return { kind: "scanned", reason: "native_text_sparse", native_word_count: nativeWordCount, native_text_len: nativeTextLen, image_count: imageCount };
	}

	// Hybrid heuristic: page has both native text and embedded images (common for hybrid PDFs)
	// but the native text may still be incomplete.
	if (imageCount > 0) {
		return { kind: "hybrid", reason: "native_text_present_and_images_present", native_word_count: nativeWordCount, native_text_len: nativeTextLen, image_count: imageCount };
	}

	return { kind: "text", reason: "native_text_present", native_word_count: nativeWordCount, native_text_len: nativeTextLen, image_count: imageCount };
}

type PdfV2OcrMode = "off" | "shadow" | "primary";

function normalizeOcrMode(raw: unknown): PdfV2OcrMode {
	const v = String(raw ?? "").trim().toLowerCase();
	if (!v) return getPipelineAutomationMode(process.env) === "off" ? "off" : "shadow";
	if (v === "shadow") return "shadow";
	if (v === "primary") return "primary";
	if (v === "off" || v === "0" || v === "false") return "off";
	return getPipelineAutomationMode(process.env) === "off" ? "off" : "shadow";
}

function nativeInsufficientForHybrid(classification: PdfV2PageClassification): boolean {
	// Conservative: only treat hybrid as insufficient when native is quite sparse.
	return classification.native_word_count < 20 && classification.native_text_len < 120;
}

function shouldRunOcrV2(ocrMode: PdfV2OcrMode, classification: PdfV2PageClassification): boolean {
	if (ocrMode !== "shadow") return false;
	if (classification.kind === "scanned") return true;
	if (classification.kind === "hybrid") return nativeInsufficientForHybrid(classification);
	return false; // never for text pages
}

export function needsOcr(classification: PdfV2PageClassification): boolean {
	// Deterministic per-page OCR gating:
	// - Always OCR scanned pages
	// - OCR when native text is empty (hybrid PDFs can pass global probes but have empty pages)
	// - Otherwise, OCR only when native is clearly insufficient
	if (classification.kind === "scanned") return true;
	if (classification.native_text_len === 0) return true;
	if (classification.native_word_count === 0) return true;
	return classification.native_word_count < 5 && classification.native_text_len < 50;
}

// V2 primary mode: use v2 classification to decide which pages need OCR,
// then patch v1 output on those pages so downstream contracts remain stable.
// If vision worker is unavailable, this falls back to v1-only extraction.
export async function extractPDFContentV2Primary(
	buffer: Buffer,
	params: { docId: string; fileName?: string }
): Promise<PDFContent> {
	const v1 = await extractPDFContent(buffer, { docId: params.docId });

	const createdAt = new Date().toISOString();
	const docId = params.docId;
	const visionCfg = getVisionExtractorConfig();

	const native = await callPdfV2Worker(visionCfg, {
		document_id: docId,
		pdf_b64: buffer.toString("base64"),
		extractor_version: "pdf_native_v2",
		max_pages: 30,
	});

	if (!native) {
		(v1 as unknown as { pdf_v2?: unknown }).pdf_v2 = {
			status: "error",
			mode: "v2_primary",
			extractor_version: "pdf_v2_primary",
			document_id: docId,
			created_at: createdAt,
			error: "vision_worker_pdf_v2_unavailable",
		};
		return v1;
	}

	const nativePages: PdfV2NativePage[] = (native as PdfV2NativeResponse).pages || [];

	// Load PDF once for OCR on scanned pages.
	const worker = await (pdfjs as any).getDocument({ data: new Uint8Array(buffer) }).promise;

	const unifiedPages: PdfV2UnifiedPage[] = [];
	const nativeMethods: Record<string, number> = {};
	let nativeOnlyPages = 0;
	let ocrPages = 0;
	let hybridPages = 0;
	let scannedPages = 0;
	let textPages = 0;

	for (const p of nativePages) {
		nativeMethods[p.method] = (nativeMethods[p.method] || 0) + 1;
		const classification = classifyPage(p);
		if (classification.kind === "scanned") scannedPages += 1;
		else textPages += 1;

		const nativeText = normalizeText(p.text);
		const base: PdfV2UnifiedPage = {
			page_index: p.page_index,
			page_number: p.page_index + 1,
			classification,
			bbox_units: "normalized",
			native: {
				method: p.method,
				text: nativeText,
				word_count: p.word_count,
				blocks: Array.isArray(p.blocks) ? p.blocks : [],
				confidence: 1.0,
			},
			final: {
				method: "native",
				text: nativeText,
			},
		};

		if (!needsOcr(classification)) {
			nativeOnlyPages += 1;
			unifiedPages.push(base);
			continue;
		}

		try {
			const pageNumber = p.page_index + 1;
			const page = await worker.getPage(pageNumber);
			const ocr = await ocrPdfPageV1(page, pageNumber, false);
			const ocrText = normalizeText(ocr.text);
			const conf01 = avgConf01(
				(ocr.words || [])
					.map((w) => Number(w.conf || 0) / 100)
					.filter((n) => Number.isFinite(n))
			);

			const finalText = ocrText || nativeText;
			const method: PdfV2UnifiedPage["final"]["method"] =
				ocrText && nativeText ? "hybrid" : ocrText ? "ocr" : "native";
			if (method === "ocr") ocrPages += 1;
			else if (method === "hybrid") hybridPages += 1;
			else nativeOnlyPages += 1;

			// Patch v1 output so downstream consumers get the improved per-page OCR.
			if (ocrText && v1.pages[p.page_index]) {
				v1.pages[p.page_index].text = ocrText;
				v1.pages[p.page_index].words = (ocr.words || []).map((w) => ({
					text: w.text,
					x: w.x,
					y: w.y,
					width: w.width,
					height: w.height,
					conf: w.conf,
				}));
				// Avoid inconsistent derived fields (v1 computed these from the old text/words).
				v1.pages[p.page_index].metrics = [];
				v1.pages[p.page_index].tables = [];
				v1.pages[p.page_index].slideTitle = undefined;
			}

			unifiedPages.push({
				...base,
				ocr: {
					provider: "tesseract",
					text: ocrText,
					word_count: (ocr.words || []).length,
					avg_confidence: conf01,
					bbox_units: "pixels",
				},
				final: {
					method,
					text: finalText,
				},
			});
		} catch {
			// If OCR fails, keep v1 page content but record the v2 artifact.
			nativeOnlyPages += 1;
			unifiedPages.push(base);
		}
	}

	// Patch summary counters for accuracy.
	const totalWords = v1.pages.reduce((sum, p) => sum + (p.words?.length || 0), 0);
	v1.summary.totalWords = totalWords;
	v1.summary.ocrUsed = Boolean(v1.summary.ocrUsed || ocrPages > 0 || hybridPages > 0);

	(v1 as unknown as { pdf_v2?: unknown }).pdf_v2 = {
		status: "ok",
		mode: "v2_primary",
		extractor_version: "pdf_v2_primary",
		document_id: docId,
		created_at: createdAt,
		summary: {
			pages: unifiedPages.length,
			native_only_pages: nativeOnlyPages,
			ocr_pages: ocrPages,
			hybrid_pages: hybridPages,
			scanned_pages: scannedPages,
			text_pages: textPages,
			native_methods: nativeMethods,
		},
		pages: unifiedPages,
	} satisfies PdfV2ShadowArtifacts;

	return v1;
}

export async function extractPDFContentV2Shadow(
	buffer: Buffer,
	params: { docId: string; fileName?: string }
): Promise<PdfV2ShadowArtifacts> {
	const createdAt = new Date().toISOString();
	const docId = params.docId;

	const visionCfg = getVisionExtractorConfig();
	const native = await callPdfV2Worker(visionCfg, {
		document_id: docId,
		pdf_b64: buffer.toString("base64"),
		extractor_version: "pdf_native_v2",
		max_pages: 30,
	});

	if (!native) {
		return {
			status: "error",
			mode: "v2_shadow",
			extractor_version: "pdf_v2_shadow",
			document_id: docId,
			created_at: createdAt,
			error: "vision_worker_pdf_v2_unavailable",
		};
	}

	const nativePages: PdfV2NativePage[] = (native as PdfV2NativeResponse).pages || [];
	const ocrMode = normalizeOcrMode(process.env.PDF_V2_OCR_MODE);

	// Load PDF once for OCR fallback.
	// pdf.js expects a Uint8Array (Buffer can throw in newer versions).
	const worker = await (pdfjs as any).getDocument({ data: new Uint8Array(buffer) }).promise;

	const unifiedPages: PdfV2UnifiedPage[] = [];
	const nativeMethods: Record<string, number> = {};

	let nativeOnlyPages = 0;
	let ocrPages = 0;
	let hybridPages = 0;
	let scannedPages = 0;
	let textPages = 0;

	for (const p of nativePages) {
		nativeMethods[p.method] = (nativeMethods[p.method] || 0) + 1;
		const classification = classifyPage(p);
		if (classification.kind === "scanned") scannedPages += 1;
		else textPages += 1;

		const nativeText = normalizeText(p.text);
		const base: PdfV2UnifiedPage = {
			page_index: p.page_index,
			page_number: p.page_index + 1,
			classification,
			bbox_units: "normalized",
			native: {
				method: p.method,
				text: nativeText,
				word_count: p.word_count,
				blocks: Array.isArray(p.blocks) ? p.blocks : [],
				confidence: 1.0,
			},
			final: {
				method: "native",
				text: nativeText,
			},
		};

		if (!needsOcr(classification)) {
			nativeOnlyPages += 1;
			// Still allow OCR v2 for hybrid pages where native appears insufficient.
			if (shouldRunOcrV2(ocrMode, classification)) {
				try {
					const page = await worker.getPage(p.page_index + 1);
					const ocr2: OcrV2Result = await ocrPdfPageV2(page, p.page_index + 1, false);
					unifiedPages.push({
						...base,
						ocr_v2: {
							provider: ocr2.provider,
							version: ocr2.version,
							text: ocr2.text,
							blocks: ocr2.blocks,
							avg_confidence: ocr2.avg_confidence,
							bbox_units: ocr2.bbox_units,
							preproc: ocr2.preproc,
							scale: ocr2.scale,
							imageWidth: ocr2.imageWidth,
							imageHeight: ocr2.imageHeight,
							regions: ocr2.regions,
							skippedRegions: ocr2.skippedRegions,
							usedFullPageFallback: ocr2.usedFullPageFallback,
						},
					});
					continue;
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					unifiedPages.push({
						...base,
						ocr_v2_error: {
							stage: "pdf_v2_ocr_v2",
							page_index: p.page_index,
							timeout_ms: parseTimeoutMsFromErrorMessage(msg),
							errorMessage: msg,
						},
					});
					continue;
				}
			}
			unifiedPages.push(base);
			continue;
		}

		// OCR fallback using existing v1 path (tesseract.js + region detection).
		try {
			const page = await worker.getPage(p.page_index + 1);
			const ocr = await ocrPdfPageV1(page, p.page_index + 1, false);
			const ocrText = normalizeText(ocr.text);
			const conf01 = avgConf01((ocr.words || []).map((w) => (Number(w.conf || 0) / 100)).filter((n) => Number.isFinite(n)));

			const finalText = ocrText || nativeText;
			const method: PdfV2UnifiedPage["final"]["method"] = ocrText && nativeText ? "hybrid" : ocrText ? "ocr" : "native";
			if (method === "ocr") ocrPages += 1;
			else if (method === "hybrid") hybridPages += 1;
			else nativeOnlyPages += 1;

			let ocrV2: PdfV2UnifiedPage["ocr_v2"] | undefined;
			let ocrV2Error: PdfV2UnifiedPage["ocr_v2_error"] | undefined;
			if (shouldRunOcrV2(ocrMode, classification)) {
				try {
					const ocr2: OcrV2Result = await ocrPdfPageV2(page, p.page_index + 1, false);
					ocrV2 = {
						provider: ocr2.provider,
						version: ocr2.version,
						text: ocr2.text,
						blocks: ocr2.blocks,
						avg_confidence: ocr2.avg_confidence,
						bbox_units: ocr2.bbox_units,
						preproc: ocr2.preproc,
						scale: ocr2.scale,
						imageWidth: ocr2.imageWidth,
						imageHeight: ocr2.imageHeight,
						regions: ocr2.regions,
						skippedRegions: ocr2.skippedRegions,
						usedFullPageFallback: ocr2.usedFullPageFallback,
					};
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					ocrV2Error = {
						stage: "pdf_v2_ocr_v2",
						page_index: p.page_index,
						timeout_ms: parseTimeoutMsFromErrorMessage(msg),
						errorMessage: msg,
					};
				}
			}

			unifiedPages.push({
				...base,
				ocr: {
					provider: "tesseract",
					text: ocrText,
					word_count: (ocr.words || []).length,
					avg_confidence: conf01,
					bbox_units: "pixels",
				},
				...(ocrV2 ? { ocr_v2: ocrV2 } : {}),
				...(ocrV2Error ? { ocr_v2_error: ocrV2Error } : {}),
				final: {
					method,
					text: finalText,
				},
			});
		} catch (err) {
			// Shadow mode: if OCR fails, fall back to native.
			nativeOnlyPages += 1;
			const msg = err instanceof Error ? err.message : String(err);
			// Still attempt OCR v2 for scanned/hybrid pages when enabled.
			if (shouldRunOcrV2(ocrMode, classification)) {
				try {
					const page = await worker.getPage(p.page_index + 1);
					const ocr2: OcrV2Result = await ocrPdfPageV2(page, p.page_index + 1, false);
					unifiedPages.push({
						...base,
						ocr_error: {
							stage: "pdf_v2_ocr_v1",
							page_index: p.page_index,
							timeout_ms: parseTimeoutMsFromErrorMessage(msg),
							errorMessage: msg,
						},
						ocr_v2: {
							provider: ocr2.provider,
							version: ocr2.version,
							text: ocr2.text,
							blocks: ocr2.blocks,
							avg_confidence: ocr2.avg_confidence,
							bbox_units: ocr2.bbox_units,
							preproc: ocr2.preproc,
							scale: ocr2.scale,
							imageWidth: ocr2.imageWidth,
							imageHeight: ocr2.imageHeight,
							regions: ocr2.regions,
							skippedRegions: ocr2.skippedRegions,
							usedFullPageFallback: ocr2.usedFullPageFallback,
						},
					});
					continue;
				} catch (err2) {
					const msg2 = err2 instanceof Error ? err2.message : String(err2);
					unifiedPages.push({
						...base,
						ocr_error: {
							stage: "pdf_v2_ocr_v1",
							page_index: p.page_index,
							timeout_ms: parseTimeoutMsFromErrorMessage(msg),
							errorMessage: msg,
						},
						ocr_v2_error: {
							stage: "pdf_v2_ocr_v2",
							page_index: p.page_index,
							timeout_ms: parseTimeoutMsFromErrorMessage(msg2),
							errorMessage: msg2,
						},
					});
					continue;
				}
			}
			unifiedPages.push({
				...base,
				ocr_error: {
					stage: "pdf_v2_ocr_v1",
					page_index: p.page_index,
					timeout_ms: parseTimeoutMsFromErrorMessage(msg),
					errorMessage: msg,
				},
			});
		}
	}

	return {
		status: "ok",
		mode: "v2_shadow",
		extractor_version: "pdf_v2_shadow",
		document_id: docId,
		created_at: createdAt,
		summary: {
			pages: unifiedPages.length,
			native_only_pages: nativeOnlyPages,
			ocr_pages: ocrPages,
			hybrid_pages: hybridPages,
			scanned_pages: scannedPages,
			text_pages: textPages,
			native_methods: nativeMethods,
		},
		pages: unifiedPages,
	};
}
