import fs from "node:fs/promises";

import { safeTesseractRecognizeBuffer } from "./ocr/safe-tesseract";

type LogLike = Pick<Console, "log" | "warn">;

export type VisionExtractResponseLike = {
	document_id?: string;
	page_index?: number;
	extractor_version?: string;
	assets?: Array<any>;
	ocr_text?: string | null;
	ocr_blocks?: any[];
	ocr?: { text?: string | null; blocks?: any[] } | null;
};

export type EnsureOcrFallbackResult = {
	response: VisionExtractResponseLike;
	diag: {
		primary_text_len: number;
		ocr_text_len: number;
		final_page_text_len: number;
		fallback_used: boolean;
	};
};

const DEFAULT_MIN_PRIMARY_CHARS = 40;
const DEFAULT_MIN_OCR_CHARS = 20;

function trimOrNull(s: unknown): string | null {
	if (typeof s !== "string") return null;
	const t = s.trim();
	return t.length > 0 ? t : null;
}

function coerceStringArray(v: unknown): string[] {
	if (!Array.isArray(v)) return [];
	return v.filter((x) => typeof x === "string").map((x) => String(x));
}

function extractStructuredTextFromStructuredJson(structured: any): string {
	if (!structured || typeof structured !== "object") return "";
	const title = trimOrNull(structured.title) ?? "";
	const notes = trimOrNull(structured.notes) ?? "";
	const snippet = trimOrNull(structured.text_snippet) ?? "";
	const bullets = coerceStringArray(structured.bullets)
		.map((b) => b.trim())
		.filter(Boolean)
		.join("\n");

	return [title, bullets, notes, snippet].filter((p) => String(p).trim().length > 0).join("\n");
}

export function extractPrimaryTextFromVisionResponse(response: VisionExtractResponseLike): string {
	const assets = Array.isArray(response?.assets) ? response.assets : [];
	for (const a of assets) {
		const extraction = (a as any)?.extraction;
		const structured = extraction && typeof extraction === "object" ? (extraction as any).structured_json : null;
		const text = extractStructuredTextFromStructuredJson(structured);
		if (text.trim().length > 0) return text;
	}
	return "";
}

export function extractOcrTextFromVisionResponse(response: VisionExtractResponseLike): string {
	const assets = Array.isArray(response?.assets) ? response.assets : [];
	for (const a of assets) {
		const extraction = (a as any)?.extraction;
		if (extraction && typeof extraction === "object") {
			const t = trimOrNull((extraction as any).ocr_text);
			if (t) return t;
		}
	}
	const top = trimOrNull(response?.ocr_text);
	if (top) return top;
	const nested = trimOrNull(response?.ocr?.text);
	if (nested) return nested;
	return "";
}

async function fetchImageBufferFromUri(uri: string): Promise<Buffer> {
	const u = String(uri || "").trim();
	if (!u) throw new Error("empty_image_uri");

	if (u.startsWith("data:")) {
		const comma = u.indexOf(",");
		if (comma < 0) throw new Error("invalid_data_uri");
		const meta = u.slice(0, comma);
		const payload = u.slice(comma + 1);
		if (!/;base64$/i.test(meta)) throw new Error("unsupported_data_uri_encoding");
		return Buffer.from(payload, "base64");
	}

	if (u.startsWith("file://")) {
		const p = decodeURIComponent(u.slice("file://".length));
		return await fs.readFile(p);
	}

	if (!u.startsWith("http://") && !u.startsWith("https://")) {
		throw new Error("unsupported_image_uri");
	}

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 20_000);
	try {
		const res = await fetch(u, { method: "GET", signal: controller.signal });
		if (!res.ok) throw new Error(`fetch_failed status=${res.status}`);
		const ab = await res.arrayBuffer();
		return Buffer.from(ab);
	} finally {
		clearTimeout(timer);
	}
}

export async function ensureOcrFallbackForVisionResponse(params: {
	response: VisionExtractResponseLike;
	pageImageUri: string | null;
	minPrimaryChars?: number;
	minOcrChars?: number;
	logger?: LogLike;
	logMeta?: Record<string, unknown>;
	force?: boolean;
}): Promise<EnsureOcrFallbackResult> {
	const logger = params.logger ?? console;
	const minPrimaryChars =
		typeof params.minPrimaryChars === "number" && Number.isFinite(params.minPrimaryChars)
			? Math.max(0, Math.floor(params.minPrimaryChars))
			: DEFAULT_MIN_PRIMARY_CHARS;
	const minOcrChars =
		typeof params.minOcrChars === "number" && Number.isFinite(params.minOcrChars)
			? Math.max(0, Math.floor(params.minOcrChars))
			: DEFAULT_MIN_OCR_CHARS;

	const primaryText = extractPrimaryTextFromVisionResponse(params.response);
	const primaryLen = primaryText.trim().length;
	const existingOcrText = extractOcrTextFromVisionResponse(params.response);
	const existingOcrLen = existingOcrText.trim().length;

	let fallbackUsed = false;
	let finalOcrText = existingOcrText;

	const shouldFallback = Boolean(params.force) || (primaryLen < minPrimaryChars && existingOcrLen < minOcrChars);
	if (shouldFallback) {
		const uri = typeof params.pageImageUri === "string" ? params.pageImageUri.trim() : "";
		if (uri) {
			try {
				const buffer = await fetchImageBufferFromUri(uri);
				const ocr = await safeTesseractRecognizeBuffer({ buffer, lang: "eng", timeoutMs: 120_000 });
				const txt = trimOrNull(ocr?.text) ?? "";
				if (txt.trim().length >= minOcrChars) {
					fallbackUsed = true;
					finalOcrText = txt;
					(params.response as any).ocr_text = txt;
				}
			} catch (err) {
				try {
					logger.warn(
						JSON.stringify({
							event: "VISION_LOCAL_OCR_FALLBACK_FAILED",
							...(params.logMeta ?? {}),
							error: err instanceof Error ? err.message : String(err),
						})
					);
				} catch {
					// ignore
				}
			}
		}
	}

	const ocrLen = finalOcrText.trim().length;
	const finalLen = primaryLen >= minPrimaryChars ? primaryLen : ocrLen;

	return {
		response: params.response,
		diag: {
			primary_text_len: primaryLen,
			ocr_text_len: ocrLen,
			final_page_text_len: finalLen,
			fallback_used: fallbackUsed,
		},
	};
}
