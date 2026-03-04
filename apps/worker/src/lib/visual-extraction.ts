import { sanitizeDeep, sanitizeText } from "@dealdecision/core";
import type { Pool } from "pg";
import path from "path";
import fs from "fs/promises";
import { createHash } from "crypto";
import { defaultVisualExtractionEnabled } from "./pipeline-policy";
import { getR2ObjectUrl, r2ObjectExists } from "./r2";
import { makeJobId, sanitizeJobId } from "./job-id";

export type VisionExtractorConfig = {
	enabled: boolean;
	visionWorkerUrl: string;
	extractorVersion: string;
	timeoutMs: number;
	maxPages: number;
};

type LogLike = Pick<Console, "log" | "warn" | "error">;

type FsLike = Pick<typeof fs, "readdir" | "stat">;

export type VisionExtractRequest = {
	document_id: string;
	page_index: number;
	image_uri?: string;
	image_b64?: string;
	extractor_version: string;
	// Optional OCR controls (vision service may ignore unknown fields).
	include_ocr?: boolean;
	mode?: string;
	return_blocks?: boolean;
	return_structured?: boolean;
};

// Normalize vision request image_uri for the vision worker: convert R2 keys to HTTP URLs, treat empty as missing.
async function normalizeVisionRequestImageUri(
	request: VisionExtractRequest,
	env: NodeJS.ProcessEnv = process.env
): Promise<VisionExtractRequest> {
	const raw = typeof request.image_uri === "string" ? request.image_uri.trim() : "";
	// Treat empty string as missing.
	if (!raw) return { ...request, image_uri: undefined };
	// Already acceptable for API.
	if (raw.startsWith("http://") || raw.startsWith("https://") || raw.startsWith("/uploads/")) return request;

	// If the caller provided an R2 object key (preferred DB format), convert it to a fetchable URL.
	// This is required because the vision worker can only fetch via HTTP(S), and our preflight
	// reachability checks expect HTTP(S).
	const bucket = typeof env.R2_BUCKET === "string" && env.R2_BUCKET.trim() ? env.R2_BUCKET.trim() : null;
	if (!bucket) return { ...request, image_uri: undefined };

	try {
		const key = raw.replace(/^\//, "");
		const url = await getR2ObjectUrl({ bucket, key, env });
		return { ...request, image_uri: url };
	} catch {
		return { ...request, image_uri: undefined };
	}
}

export type VisionBBox = { x: number; y: number; w: number; h: number };

export type VisionOcrBlock = {
	text: string;
	bbox: VisionBBox;
	confidence?: number | null;
};

export type VisionJobRuntime = {
	visionBaseUrl: string;
	disabled: boolean;
	disabledEvent: string | null;
	disable: (event: string, payload: Record<string, unknown>) => void;
	ensureReady: (options: {
		fetchImpl: typeof fetch;
		logger?: LogLike;
		logMeta?: Record<string, unknown>;
		timeoutMs: number;
	}) => Promise<boolean>;
};

function isRenderNoServer(res: { headers?: { get?: (key: string) => string | null } } | null | undefined): boolean {
	try {
		const v = res?.headers?.get?.("x-render-routing");
		return typeof v === "string" && v.trim().toLowerCase() === "no-server";
	} catch {
		return false;
	}
}

async function fetchWithTimeout(fetchImpl: typeof fetch, url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		return await fetchImpl(url, { ...init, signal: controller.signal });
	} finally {
		clearTimeout(timer);
	}
}

export type ImageUriFetchDiag = {
	ok: boolean;
	status: number | null;
	content_type: string | null;
	duration_ms: number;
	method: "GET_RANGE";
	error?: string;
};

export async function probeImageUriFetchability(url: string, options?: { fetchImpl?: typeof fetch; timeoutMs?: number }): Promise<ImageUriFetchDiag> {
	const u = String(url || "").trim();
	if (!u) {
		return { ok: false, status: null, content_type: null, duration_ms: 0, method: "GET_RANGE", error: "empty_uri" };
	}
	if (!u.startsWith("http://") && !u.startsWith("https://")) {
		return { ok: false, status: null, content_type: null, duration_ms: 0, method: "GET_RANGE", error: "unsupported_uri" };
	}

	const started = Date.now();
	const fetchImpl = options?.fetchImpl ?? fetch;
	const timeoutMs = typeof options?.timeoutMs === "number" && Number.isFinite(options.timeoutMs) ? Math.max(500, options.timeoutMs) : 5000;

	// Cloudflare R2 signed URLs may return 403 for HEAD while still succeeding for ranged GET (206).
	// Use a minimal ranged GET probe to avoid false negatives.
	try {
		const res = await fetchWithTimeout(fetchImpl, u, { method: "GET", headers: { Range: "bytes=0-0" } }, timeoutMs);
		const ct = res.headers.get("content-type");
		try {
			await res.arrayBuffer();
		} catch {
			// ignore
		}
		const ok = res.status === 200 || res.status === 206;
		return {
			ok,
			status: res.status,
			content_type: ct,
			duration_ms: Date.now() - started,
			method: "GET_RANGE",
		};
	} catch (err) {
		return {
			ok: false,
			status: null,
			content_type: null,
			duration_ms: Date.now() - started,
			method: "GET_RANGE",
			error: err instanceof Error ? err.message : String(err),
		};
	}
}

export function createVisionJobRuntime(params: {
	config: VisionExtractorConfig;
	logger?: LogLike;
	logMeta?: Record<string, unknown>;
}): VisionJobRuntime {
	const logger = params.logger ?? console;
	const baseUrl = params.config.visionWorkerUrl;
	const logMeta = params.logMeta ?? {};
	const logged = new Set<string>();
	let readyPromise: Promise<boolean> | null = null;
	let ready = false;
	let disabled = false;
	let disabledEvent: string | null = null;

	const logOnce = (event: string, payload: Record<string, unknown>) => {
		if (logged.has(event)) return;
		logged.add(event);
		try {
			logger.warn(JSON.stringify({ event, vision_base_url: baseUrl, ...logMeta, ...payload }));
		} catch {
			// ignore
		}
	};

	const disable = (event: string, payload: Record<string, unknown>) => {
		if (disabled) return;
		disabled = true;
		disabledEvent = event;
		logOnce(event, payload);
	};

	const ensureReady = async (options: { fetchImpl: typeof fetch; timeoutMs: number; logger?: LogLike; logMeta?: Record<string, unknown> }) => {
		if (disabled) return false;
		if (ready) return true;
		if (readyPromise) return readyPromise;

		const fetchImpl = options.fetchImpl;
		const timeoutMs = Math.max(1000, Math.min(10_000, options.timeoutMs));
		readyPromise = (async () => {
			// Health check
			try {
				const res = await fetchWithTimeout(fetchImpl, `${baseUrl}/health`, { method: "GET" }, timeoutMs);
				if (isRenderNoServer(res) || res.status === 404) {
					disable("VISION_DISABLED_NO_SERVER", { where: "health", status_code: res.status });
					return false;
				}
				if (!res.ok) {
					disable("VISION_DISABLED_HEALTH_CHECK_FAILED", { where: "health", status_code: res.status });
					return false;
				}
			} catch (err) {
				disable("VISION_DISABLED_HEALTH_CHECK_FAILED", { where: "health", error: err instanceof Error ? err.message : String(err) });
				return false;
			}

			// OpenAPI route verification
			try {
				const res = await fetchWithTimeout(fetchImpl, `${baseUrl}/openapi.json`, { method: "GET" }, timeoutMs);
				if (isRenderNoServer(res) || res.status === 404) {
					disable("VISION_DISABLED_NO_SERVER", { where: "openapi", status_code: res.status });
					return false;
				}
				if (!res.ok) {
					disable("VISION_DISABLED_OPENAPI_CHECK_FAILED", { where: "openapi", status_code: res.status });
					return false;
				}
				const json = (await res.json()) as any;
				const paths = json && typeof json === "object" ? (json as any).paths : null;
				const extractVisuals = paths && typeof paths === "object" ? (paths as any)["/extract-visuals"] : null;
				const hasPost = extractVisuals && typeof extractVisuals === "object" ? Boolean((extractVisuals as any).post) : false;
				if (!hasPost) {
					disable("VISION_DISABLED_OPENAPI_MISSING_ROUTE", { where: "openapi", missing: "POST /extract-visuals" });
					return false;
				}
			} catch (err) {
				disable("VISION_DISABLED_OPENAPI_CHECK_FAILED", { where: "openapi", error: err instanceof Error ? err.message : String(err) });
				return false;
			}

			ready = true;
			return true;
		})();
		return readyPromise;
	};

	return {
		visionBaseUrl: baseUrl,
		get disabled() {
			return disabled;
		},
		get disabledEvent() {
			return disabledEvent;
		},
		disable,
		ensureReady,
	};
}

function cleanSnippetText(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

function looksLikeJunkLine(line: string): boolean {
	const s = cleanSnippetText(line);
	if (!s) return true;
	// URLs/emails/page numbers are rarely useful for scoring evidence.
	if (/\bhttps?:\/\//i.test(s) || /\bwww\./i.test(s) || /\b\S+@\S+\b/.test(s)) return true;
	if (/^\(?\d{1,3}\)?$/.test(s)) return true;
	if (/^(?:slide|page)\s*\d+\b/i.test(s)) return true;
	// Excess symbol soup.
	const noSpace = s.replace(/\s/g, "");
	const letters = (noSpace.match(/[A-Za-z]/g) ?? []).length;
	const digits = (noSpace.match(/[0-9]/g) ?? []).length;
	const other = Math.max(0, noSpace.length - letters - digits);
	if (noSpace.length >= 10 && other / Math.max(1, noSpace.length) >= 0.35) return true;
	return false;
}

function deriveEvidenceSnippetV2(params: {
	ocrText: string | null;
	ocrBlocks: VisionOcrBlock[];
	structuredJson: Record<string, unknown> | null;
	maxChars?: number;
}): { snippet: string | null; source: string } {
	const maxChars = params.maxChars ?? 500;
	const blocks = Array.isArray(params.ocrBlocks) ? params.ocrBlocks : [];

	const usable = blocks
		.map((b) => {
			const text = typeof b?.text === "string" ? b.text.trim() : "";
			const conf = typeof b?.confidence === "number" && Number.isFinite(b.confidence) ? b.confidence : 0.4;
			const y = typeof b?.bbox?.y === "number" && Number.isFinite(b.bbox.y) ? b.bbox.y : null;
			const x = typeof b?.bbox?.x === "number" && Number.isFinite(b.bbox.x) ? b.bbox.x : null;
			return { text, conf, y, x };
		})
		.filter((b) => b.text.length >= 2)
		// Confidence filter: keep higher-signal words.
		.filter((b) => b.conf >= 0.55)
		// Avoid tiny header/footer noise; keep the body region.
		.filter((b) => b.y == null || (b.y >= 0.06 && b.y <= 0.92))
		.sort((a, b) => {
			const dy = (a.y ?? 0) - (b.y ?? 0);
			if (Math.abs(dy) > 0.01) return dy;
			return (a.x ?? 0) - (b.x ?? 0);
		});

	if (usable.length > 0) {
		// Group into rough lines by y proximity.
		const lines: Array<{ y: number; confs: number[]; parts: string[] }> = [];
		for (const b of usable) {
			const y = b.y ?? 0;
			const last = lines[lines.length - 1];
			if (!last || Math.abs(last.y - y) > 0.018) {
				lines.push({ y, confs: [b.conf], parts: [b.text] });
				continue;
			}
			last.confs.push(b.conf);
			last.parts.push(b.text);
		}

		const candidateLines = lines
			.map((l) => {
				const text = cleanSnippetText(l.parts.join(" "));
				const avg = l.confs.reduce((a, c) => a + c, 0) / Math.max(1, l.confs.length);
				return { y: l.y, avg, text };
			})
			.filter((l) => l.text.length >= 6)
			.filter((l) => !looksLikeJunkLine(l.text));

		if (candidateLines.length > 0) {
			// Prefer early body lines while skipping the very top-most line if it's short (often a brand/header).
			const picked: string[] = [];
			for (const l of candidateLines) {
				if (picked.length === 0 && l.y <= 0.12 && l.text.length <= 28) continue;
				picked.push(l.text);
				if (picked.join(" ").length >= maxChars) break;
				if (picked.length >= 6) break;
			}
			const joined = cleanSnippetText(picked.join(" "));
			if (joined) return { snippet: joined.length > maxChars ? `${joined.slice(0, maxChars - 3)}...` : joined, source: "ocr_blocks_filtered_v2" };
		}
	}

	// Fallbacks
	const sj = params.structuredJson && typeof params.structuredJson === "object" ? params.structuredJson : null;
	const structuredTitle = sj && typeof (sj as any).title === "string" ? String((sj as any).title).trim() : "";
	if (structuredTitle) {
		const s = structuredTitle.length > maxChars ? `${structuredTitle.slice(0, maxChars - 3)}...` : structuredTitle;
		return { snippet: s, source: "structured_title_fallback" };
	}

	const raw = typeof params.ocrText === "string" ? params.ocrText.trim() : "";
	if (raw) {
		const s = raw.length > maxChars ? `${raw.slice(0, maxChars - 3)}...` : raw;
		return { snippet: s, source: "ocr_text_truncate_fallback" };
	}

	return { snippet: null, source: "none" };
}

export type VisionExtraction = {
	ocr_text?: string | null;
	ocr_blocks: VisionOcrBlock[];
	structured_json: Record<string, unknown>;
	units?: string | null;
	labels: Record<string, unknown>;
	model_version?: string | null;
	confidence: number;
};

export type VisionAsset = {
	asset_type: "chart" | "table" | "map" | "diagram" | "image_text" | "unknown";
	bbox: VisionBBox;
	confidence: number;
	quality_flags: Record<string, unknown>;
	image_uri?: string | null;
	image_hash?: string | null;
	extraction: VisionExtraction;
};

export type VisionExtractResponse = {
	document_id: string;
	page_index: number;
	extractor_version: string;
	assets: VisionAsset[];
};

const SEGMENT_KEYS = [
	"overview",
	"problem",
	"solution",
	"product",
	"market",
	"traction",
	"business_model",
	"competition",
	"team",
	"distribution",
	"raise_terms",
	"exit",
	"risks",
	"financials",
	"unknown",
] as const;

type SegmentKey = (typeof SEGMENT_KEYS)[number];

function coerceSegmentKey(value: unknown): SegmentKey | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	if (!trimmed) return null;
	return (SEGMENT_KEYS as readonly string[]).includes(trimmed) ? (trimmed as SegmentKey) : null;
}

function mapSlideTypeToSegmentKey(slideTypeRaw: unknown): SegmentKey | null {
	const s = typeof slideTypeRaw === "string" ? slideTypeRaw.trim().toLowerCase() : "";
	if (!s) return null;
	// slide_understanding_v1 types -> platform segment keys
	if (s === "problem") return "problem";
	if (s === "solution") return "solution";
	if (s === "product") return "product";
	if (s === "traction") return "traction";
	if (s === "market") return "market";
	if (s === "business_model") return "business_model";
	if (s === "competition") return "competition";
	if (s === "team") return "team";
	if (s === "financials") return "financials";
	if (s === "raise_terms" || s === "use_of_funds") return "raise_terms";
	if (s === "risks") return "risks";
	if (s === "go_to_market") return "distribution";
	// Unknown/other -> no mapping
	return null;
}

function coerceJsonObject(value: unknown): Record<string, unknown> {
	if (!value) return {};
	if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
	if (typeof value === "string") {
		try {
			const parsed = JSON.parse(value);
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
		} catch {
			// ignore
		}
	}
	return {};
}

function coerceJsonArray<T = unknown>(value: unknown): T[] {
	if (Array.isArray(value)) return value as T[];
	if (typeof value === "string") {
		try {
			const parsed = JSON.parse(value);
			if (Array.isArray(parsed)) return parsed as T[];
		} catch {
			// ignore
		}
	}
	return [];
}

function coerceBBox(value: unknown): VisionBBox {
	const obj = coerceJsonObject(value);
	const x = typeof obj.x === "number" ? obj.x : Number(obj.x);
	const y = typeof obj.y === "number" ? obj.y : Number(obj.y);
	const w = typeof obj.w === "number" ? obj.w : Number(obj.w);
	const h = typeof obj.h === "number" ? obj.h : Number(obj.h);

	return {
		x: Number.isFinite(x) ? x : 0,
		y: Number.isFinite(y) ? y : 0,
		w: Number.isFinite(w) ? w : 1,
		h: Number.isFinite(h) ? h : 1,
	};
}

function normalizeImageUriForApi(imageUri: string | null, env: NodeJS.ProcessEnv = process.env): string | null {
	if (!imageUri) return null;
	const trimmed = String(imageUri).trim();
	if (!trimmed) return null;
	if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
	if (trimmed.startsWith("/uploads/")) return trimmed;

	// Best-effort: map absolute file paths under UPLOAD_DIR to an API-relative URL under /uploads.
	const uploadDir = env.UPLOAD_DIR ? path.resolve(env.UPLOAD_DIR) : null;
	if (uploadDir && trimmed.startsWith("/")) {
		try {
			const rel = path.relative(uploadDir, trimmed);
			if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) {
				return `/uploads/${rel.split(path.sep).join("/")}`;
			}
		} catch {
			// fall through
		}
	}

	// Anything else (e.g. /tmp/*) is not web-served.
	return null;
}

function stripUrlQueryAndHash(input: string): string {
	const s = String(input ?? "").trim();
	if (!s) return "";
	if (!(s.startsWith("http://") || s.startsWith("https://"))) {
		return s.split("?")[0]?.split("#")[0] ?? s;
	}
	try {
		const u = new URL(s);
		u.search = "";
		u.hash = "";
		return u.toString();
	} catch {
		return s.split("?")[0]?.split("#")[0] ?? s;
	}
}

function tryExtractR2KeyFromUrl(input: string, env: NodeJS.ProcessEnv = process.env): string | null {
	const raw = String(input ?? "").trim();
	if (!(raw.startsWith("http://") || raw.startsWith("https://"))) return null;

	let parsed: URL;
	try {
		parsed = new URL(raw);
	} catch {
		return null;
	}

	// Public base URL (CDN / public bucket) case.
	const publicBase = typeof env.R2_PUBLIC_BASE_URL === "string" ? env.R2_PUBLIC_BASE_URL.trim().replace(/\/$/, "") : "";
	if (publicBase) {
		try {
			const base = new URL(publicBase);
			if (parsed.origin === base.origin && parsed.pathname.startsWith(base.pathname.replace(/\/$/, "") + "/")) {
				const prefix = base.pathname.replace(/\/$/, "") + "/";
				const remainder = parsed.pathname.slice(prefix.length);
				const key = remainder
					.split("/")
					.filter(Boolean)
					.map((seg) => {
						try {
							return decodeURIComponent(seg);
						} catch {
							return seg;
						}
					})
					.join("/");
				return key || null;
			}
		} catch {
			// ignore
		}
	}

	// Signed URL / endpoint (path-style: /<bucket>/<key>) case.
	// Canonical env: R2_ENDPOINT. Back-compat: R2_S3_ENDPOINT.
	const endpointRaw = (() => {
		const v1 = typeof env.R2_ENDPOINT === "string" ? env.R2_ENDPOINT.trim() : "";
		if (v1) return v1;
		return typeof env.R2_S3_ENDPOINT === "string" ? env.R2_S3_ENDPOINT.trim() : "";
	})();
	const bucket = typeof env.R2_BUCKET === "string" ? env.R2_BUCKET.trim() : "";
	if (!endpointRaw || !bucket) return null;

	try {
		const endpoint = new URL(endpointRaw);
		if (parsed.origin !== endpoint.origin) return null;

		const endpointPath = endpoint.pathname.replace(/\/$/, "");
		let pathRemainder = parsed.pathname;
		if (endpointPath && endpointPath !== "/") {
			const prefix = endpointPath + "/";
			if (!pathRemainder.startsWith(prefix)) return null;
			pathRemainder = pathRemainder.slice(prefix.length);
		} else {
			pathRemainder = pathRemainder.replace(/^\//, "");
		}

		const parts = pathRemainder.split("/").filter(Boolean);
		if (parts.length < 2) return null;
		if (parts[0] !== bucket) return null;
		const key = parts
			.slice(1)
			.map((seg) => {
				try {
					return decodeURIComponent(seg);
				} catch {
					return seg;
				}
			})
			.join("/");
		return key || null;
	} catch {
		return null;
	}
}

function normalizeImageUriForDb(imageUri: string | null, env: NodeJS.ProcessEnv = process.env): string | null {
	if (!imageUri) return null;
	const trimmed = String(imageUri).trim();
	if (!trimmed) return null;

	// Already a key (preferred storage format).
	if (!trimmed.startsWith("/") && !(trimmed.startsWith("http://") || trimmed.startsWith("https://"))) {
		return trimmed;
	}

	// Preserve /uploads URLs, but never persist query strings.
	if (trimmed.startsWith("/uploads/")) return stripUrlQueryAndHash(trimmed) || null;

	// Best-effort: map absolute file paths under UPLOAD_DIR to an API-relative URL under /uploads.
	const uploadDir = env.UPLOAD_DIR ? path.resolve(env.UPLOAD_DIR) : null;
	if (uploadDir && trimmed.startsWith("/")) {
		try {
			const rel = path.relative(uploadDir, trimmed);
			if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) {
				return `/uploads/${rel.split(path.sep).join("/")}`;
			}
		} catch {
			// fall through
		}
	}

	// For HTTP(S): prefer extracting the R2 object key; otherwise strip query so we never persist signed URLs.
	if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
		return tryExtractR2KeyFromUrl(trimmed, env) ?? (stripUrlQueryAndHash(trimmed) || null);
	}

	return null;
}

function parseBool(input: string | undefined | null): boolean {
	if (!input) return false;
	return ["1", "true", "yes", "on"].includes(input.trim().toLowerCase());
}

function parseIntWithDefault(input: string | undefined, fallback: number): number {
	const v = Number.parseInt(String(input ?? ""), 10);
	return Number.isFinite(v) ? v : fallback;
}

let didWarnVisualExtractionDisabled = false;

export function getVisionExtractorConfig(env: NodeJS.ProcessEnv = process.env): VisionExtractorConfig {
	const enabledRaw = env.ENABLE_VISUAL_EXTRACTION;
	const enabled = enabledRaw == null ? defaultVisualExtractionEnabled(env) : parseBool(enabledRaw);
	const envUrlRaw = (env.VISION_BASE_URL || env.VISION_WORKER_URL || "").trim();
	if (enabled && env.NODE_ENV === "production" && !envUrlRaw) {
		throw new Error("VISION_BASE_URL is required when ENABLE_VISUAL_EXTRACTION=1 (set VISION_BASE_URL to your vision service origin)");
	}
	return {
		enabled,
		visionWorkerUrl: (envUrlRaw || "http://localhost:8000").replace(/\/$/, ""),
		extractorVersion: env.VISION_EXTRACTOR_VERSION || "vision_v1",
		timeoutMs: parseIntWithDefault(env.VISION_TIMEOUT_MS, 8000),
		// Default small to keep memory bounded; larger documents are processed via page-range sub-jobs.
		maxPages: parseIntWithDefault(env.VISION_MAX_PAGES, 10),
	};
}

function safeDocIdForPath(documentId: string): string {
	return String(documentId || "").replace(/[^a-zA-Z0-9_\-]/g, "_");
}

async function dirExists(fsImpl: FsLike, dir: string): Promise<boolean> {
	try {
		const s = await fsImpl.stat(dir);
		return s.isDirectory();
	} catch {
		return false;
	}
}

function candidateArtifactDirs(params: {
	documentId: string;
	meta?: unknown;
	env?: NodeJS.ProcessEnv;
}): string[] {
	const env = params.env ?? process.env;
	const safeId = safeDocIdForPath(params.documentId);
	const uploadDir = env.UPLOAD_DIR ? path.resolve(env.UPLOAD_DIR) : path.resolve(process.cwd(), "uploads");

	const dirs: string[] = [];
	const metaObj = params.meta && typeof params.meta === "object" ? (params.meta as any) : null;
	for (const key of ["debug_dir", "debugDir", "artifacts_dir", "artifactsDir", "rendered_pages_dir", "renderedPagesDir"]) {
		const v = metaObj?.[key];
		if (typeof v !== "string" || !v.trim()) continue;
		const trimmed = v.trim();
		// In a separated API+worker setup (e.g. Render), documents.extraction_metadata may contain
		// an absolute path from the API service filesystem. The worker must not depend on that path.
		// Only consider absolute paths that live under the worker's UPLOAD_DIR.
		if (path.isAbsolute(trimmed)) {
			try {
				const abs = path.resolve(trimmed);
				const rel = path.relative(uploadDir, abs);
				const isUnderUploadDir = rel && !rel.startsWith("..") && !path.isAbsolute(rel);
				if (!isUnderUploadDir) continue;
			} catch {
				continue;
			}
		}
		dirs.push(trimmed);
	}

	// Known extractor debug location (only exists if PDF_EXTRACT_DEBUG=1 at extraction time)
	dirs.push(path.join("/tmp/pdf_extract_debug", safeId));

	// Common “uploads/artifacts” patterns (best-effort; may not exist)
	dirs.push(path.join(uploadDir, "rendered_pages", safeId));
	dirs.push(path.join(uploadDir, "page_images", safeId));
	dirs.push(path.join(uploadDir, "extracted_images", safeId));
	dirs.push(path.join(uploadDir, "artifacts", safeId, "pages"));
	dirs.push(path.join(uploadDir, "artifacts", safeId));
	dirs.push(path.join(uploadDir, safeId, "pages"));
	dirs.push(path.join(uploadDir, safeId));

	// Dedupe while preserving order
	return Array.from(new Set(dirs));
}

function parsePageIndexFromFilename(fileName: string): number | null {
	const name = fileName.toLowerCase();
	if (!(name.endsWith(".png") || name.endsWith(".jpg") || name.endsWith(".jpeg"))) return null;

	// Examples: page_001_raw.png, page-12.png, page12.jpg
	const m = name.match(/page[_\-]?0*(\d{1,6})/);
	if (!m) return null;
	const n = Number.parseInt(m[1], 10);
	return Number.isFinite(n) ? n : null;
}

function pickBestPerPage(candidates: string[]): string {
	// Prefer “raw” over “pre” over anything else.
	const rank = (p: string) => {
		const n = p.toLowerCase();
		if (n.includes("_raw")) return 3;
		if (n.includes("_pre")) return 2;
		return 1;
	};
	return candidates.sort((a, b) => rank(b) - rank(a))[0];
}

export async function resolvePageImageUris(
	pool: Pool,
	documentId: string,
	options?: {
		logger?: LogLike;
		fsImpl?: FsLike;
		env?: NodeJS.ProcessEnv;
	}
): Promise<string[]> {
	const logger = options?.logger ?? console;
	const fsImpl = options?.fsImpl ?? fs;
	const env = options?.env ?? process.env;

	try {
		const { rows } = await pool.query<{ page_count: number | null; extraction_metadata: unknown | null }>(
			`SELECT page_count, extraction_metadata
			   FROM documents
			  WHERE id = $1
			  LIMIT 1`,
			[sanitizeText(documentId)]
		);
		const row = rows?.[0];
		const pageCount = typeof row?.page_count === "number" && Number.isFinite(row.page_count) ? row.page_count : 0;

		// If extraction_metadata already contains page image URLs (e.g. object storage), prefer them.
		const metaObj = row?.extraction_metadata && typeof row.extraction_metadata === "object" ? (row.extraction_metadata as any) : null;
		const metaListCandidates: unknown[] = [
			metaObj?.page_image_uris,
			metaObj?.page_image_urls,
			metaObj?.page_images,
			metaObj?.rendered_page_uris,
			metaObj?.rendered_page_urls,
			metaObj?.rendered_pages_urls,
			metaObj?.rendered_pages_uris,
		];

		const prefixCandidates: unknown[] = [
			metaObj?.rendered_pages_url_prefix,
			metaObj?.rendered_pages_uri_prefix,
			metaObj?.page_images_url_prefix,
			metaObj?.page_images_uri_prefix,
			metaObj?.page_image_url_prefix,
		];

		const shouldSignR2KeysForRemoteVision = (() => {
			const visionBase = (env.VISION_BASE_URL || env.VISION_WORKER_URL || "").trim();
			const remoteVision = visionBase.startsWith("https://");
			const r2Bucket = (env.R2_BUCKET ?? "").trim();
			return remoteVision && r2Bucket.length > 0;
		})();

		const normalizeLegacyMetaUri = async (raw: string): Promise<string> => {
			const v = raw.trim();
			if (!v) return "";
			if (v.startsWith("http://") || v.startsWith("https://") || v.startsWith("/uploads/")) return v;
			// Avoid attempting to sign obvious local filesystem paths.
			if (v.startsWith("/")) return v;
			if (!shouldSignR2KeysForRemoteVision) return v;
			const bucket = (env.R2_BUCKET ?? "").trim();
			if (!bucket) return v;
			try {
				const key = v.replace(/^\/+/, "");
				return await getR2ObjectUrl({ bucket, key, env });
			} catch {
				return v;
			}
		};

		const legacyCandidateCounts = { list_urls: 0, prefix: 0 };
		for (const cand of metaListCandidates) {
			if (!Array.isArray(cand)) continue;
			legacyCandidateCounts.list_urls += cand.filter((u) => typeof u === "string" && u.trim().length > 0).length;
		}
		for (const cand of prefixCandidates) {
			if (typeof cand !== "string") continue;
			const prefix = cand.trim();
			if (prefix) legacyCandidateCounts.prefix += 1;
		}

		// Preferred Render-safe location: R2-backed rendered pages.
		// When present, always prefer it over any legacy URL lists/prefixes.
		const renderedR2 =
			metaObj?.rendered_pages_r2 && typeof metaObj.rendered_pages_r2 === "object" ? (metaObj.rendered_pages_r2 as any) : null;
		if (renderedR2) {
			const bucket = typeof renderedR2.bucket === "string" ? renderedR2.bucket.trim() : null;
			let prefix = typeof renderedR2.prefix === "string" ? renderedR2.prefix.trim().replace(/\/$/, "") : "";
			// Cleanup guard: older workers accidentally wrote /pages as the prefix.
			// Treat rendered_pages/ as canonical and auto-upgrade the prefix for reads.
			if (prefix.endsWith("/pages") && !prefix.endsWith("/rendered_pages")) {
				const upgraded = prefix.replace(/\/pages$/, "/rendered_pages");
				logger.warn(
					JSON.stringify({
						event: "RENDERED_PAGES_R2_PREFIX_CANONICALIZED",
						document_id: documentId,
						from: prefix,
						to: upgraded,
					})
				);
				prefix = upgraded;
			}
			const formatRaw = typeof renderedR2.format === "string" ? renderedR2.format.trim() : "";
			const format = formatRaw && !formatRaw.includes("/") ? formatRaw : "page_%04d.png";
			const formatFilename = (pageIndex: number) => {
				const idx = Number.isFinite(pageIndex) ? Math.max(0, Math.floor(pageIndex)) : 0;
				const m = format.match(/%0(\d+)d/);
				if (m) {
					const width = Number.parseInt(m[1], 10);
					const padded = String(idx).padStart(Number.isFinite(width) ? Math.max(1, width) : 4, "0");
					return format.replace(m[0], padded);
				}
				if (format.includes("%d")) return format.replace("%d", String(idx));
				return `page_${String(idx).padStart(4, "0")}.png`;
			};

			const metaRenderedCount =
				typeof metaObj?.rendered_pages_count === "number" && Number.isFinite(metaObj.rendered_pages_count)
					? metaObj.rendered_pages_count
					: 0;
			const metaRenderedSoFar =
				typeof metaObj?.rendered_pages_rendered === "number" && Number.isFinite(metaObj.rendered_pages_rendered)
					? metaObj.rendered_pages_rendered
					: null;
			if (metaRenderedCount > 0 && metaRenderedSoFar != null && metaRenderedSoFar < metaRenderedCount) {
				logger.log(
					JSON.stringify({
						event: "RENDERED_PAGES_R2_NOT_READY",
						document_id: documentId,
						rendered_pages_count: metaRenderedCount,
						rendered_pages_rendered: metaRenderedSoFar,
						reason: "render_incomplete",
					})
				);

				// R2-aware backfill: if the last expected page exists, treat as ready and patch metadata.
				if (prefix) {
					const lastIndex = Math.max(0, metaRenderedCount - 1);
					const lastKey = `${prefix}/${formatFilename(lastIndex)}`;
					try {
						const exists = await r2ObjectExists({ bucket, key: lastKey, env: options?.env });
						if (exists) {
							logger.log(
								JSON.stringify({
									event: "RENDERED_PAGES_R2_PROBE_OVERRIDE",
									document_id: documentId,
									key_checked: lastKey,
									rendered_pages_count: metaRenderedCount,
									rendered_pages_rendered_previous: metaRenderedSoFar,
								})
							);
							try {
								await pool.query(
									"UPDATE documents SET extraction_metadata = COALESCE(extraction_metadata, '{}'::jsonb) || $2::jsonb WHERE id = $1",
									[
										sanitizeText(documentId),
										JSON.stringify({
											rendered_pages_rendered: metaRenderedCount,
											rendered_pages_count: metaRenderedCount,
										}),
									]
								);
							} catch (err) {
								logger.warn(
									JSON.stringify({
										event: "RENDERED_PAGES_R2_BACKFILL_FAILED",
										document_id: documentId,
										error: err instanceof Error ? err.message : String(err),
									})
								);
							}
						} else {
							return [];
						}
					} catch (err) {
						logger.warn(
							JSON.stringify({
								event: "RENDERED_PAGES_R2_PROBE_FAILED",
								document_id: documentId,
								key_checked: lastKey,
								error: err instanceof Error ? err.message : String(err),
							})
						);
						return [];
					}
				} else {
					return [];
				}
			}
			const effectiveCount = pageCount && pageCount > 0 ? pageCount : metaRenderedCount;
			if (prefix && effectiveCount && effectiveCount > 0) {
				try {
					if (legacyCandidateCounts.list_urls > 0 || legacyCandidateCounts.prefix > 0) {
						logger.warn(
							JSON.stringify({
								event: "RENDERED_PAGES_R2_PREFERRED_OVER_LEGACY",
								document_id: documentId,
								legacy_candidate_counts: legacyCandidateCounts,
							})
						);
					}

					const exampleKey0 = `${prefix}/${formatFilename(0)}`;
					const exampleKey10 = `${prefix}/${formatFilename(10)}`;
					logger.log(
						JSON.stringify({
							event: "RENDERED_PAGES_R2_RESOLVE",
							document_id: documentId,
							bucket: bucket,
							prefix,
							format,
							page_count: effectiveCount,
							example_keys: { page_0000: exampleKey0, page_0010: exampleKey10 },
						})
					);

					const urls: string[] = [];
					for (let i = 0; i < effectiveCount; i += 1) {
						const key = `${prefix}/${formatFilename(i)}`;
						urls.push(await getR2ObjectUrl({ bucket, key, env: options?.env }));
					}
					logger.log(
						JSON.stringify({
							event: "PAGE_IMAGE_URIS_FROM_RENDERED_PAGES_R2",
							document_id: documentId,
							count: urls.length,
							page_count: effectiveCount,
						})
					);
					return urls;
				} catch (err) {
					logger.warn(
						`[visual_extraction] rendered_pages_r2 url generation failed doc=${documentId}: ${err instanceof Error ? err.message : String(err)}`
					);
					// fall through to legacy metadata and/or filesystem discovery
				}
			}
		}

		for (const cand of metaListCandidates) {
			if (!Array.isArray(cand)) continue;
			const raw = cand.filter((u) => typeof u === "string" && u.trim().length > 0).map((u) => String(u));
			const urls = shouldSignR2KeysForRemoteVision
				? (await Promise.all(raw.map((u) => normalizeLegacyMetaUri(u)))).filter((u) => typeof u === "string" && u.trim().length > 0)
				: raw.map((u) => u.trim());
			if (urls.length > 0) {
				logger.log(
					JSON.stringify({
						event: "PAGE_IMAGE_URIS_FROM_METADATA",
						document_id: documentId,
						count: urls.length,
						signed_r2_keys: shouldSignR2KeysForRemoteVision,
					})
				);
				return urls;
			}
		}
		for (const cand of prefixCandidates) {
			if (typeof cand !== "string") continue;
			const prefix = cand.trim().replace(/\/$/, "");
			if (!prefix || !(prefix.startsWith("http://") || prefix.startsWith("https://"))) continue;
			if (!pageCount || pageCount <= 0) continue;
			const urls = Array.from({ length: pageCount }, (_, i) => `${prefix}/page_${String(i).padStart(3, "0")}.png`);
			logger.log(
				JSON.stringify({
					event: "PAGE_IMAGE_URIS_FROM_METADATA_PREFIX",
					document_id: documentId,
					count: urls.length,
					page_count: pageCount,
				})
			);
			return urls;
		}

		const dirs = candidateArtifactDirs({ documentId, meta: row?.extraction_metadata, env: options?.env });
		const envNode = (options?.env?.NODE_ENV ?? process.env.NODE_ENV ?? "").trim().toLowerCase();
		const r2BucketConfigured = ((options?.env?.R2_BUCKET ?? process.env.R2_BUCKET ?? "") as string).trim().length > 0;
		if (envNode === "production" && r2BucketConfigured) {
			logger.log(
				JSON.stringify({
					event: "NO_PAGE_IMAGES_AVAILABLE",
					document_id: documentId,
					reason: "rendered_pages_missing_prod",
					searched_dirs: [],
				})
			);
			return [];
		}
		for (const dir of dirs) {
			if (!(await dirExists(fsImpl, dir))) continue;
			let files: string[] = [];
			try {
				files = await fsImpl.readdir(dir);
			} catch {
				continue;
			}

			const hasZero = files.some((f) => parsePageIndexFromFilename(f) === 0);
			const byIndex = new Map<number, string[]>();
			for (const f of files) {
				const parsed = parsePageIndexFromFilename(f);
				if (parsed === null) continue;
				const pageIndex = hasZero ? parsed : parsed - 1;
				if (pageIndex < 0) continue;
				if (pageCount && pageCount > 0 && pageIndex >= pageCount) continue;
				const full = path.join(dir, f);
				const list = byIndex.get(pageIndex) ?? [];
				list.push(full);
				byIndex.set(pageIndex, list);
			}

			const inferredPageCount =
				pageCount && pageCount > 0
					? pageCount
					: byIndex.size > 0
						? Math.max(...Array.from(byIndex.keys())) + 1
						: 0;

			const ordered: string[] = [];
			for (let i = 0; i < inferredPageCount; i += 1) {
				const cands = byIndex.get(i);
				if (!cands || cands.length === 0) continue;
				ordered.push(pickBestPerPage(cands));
			}

			if (ordered.length > 0) {
				// If the document row never had page_count, infer it from rendered pages so downstream
				// extraction (and UI) can behave deterministically.
				if ((!pageCount || pageCount <= 0) && inferredPageCount > 0) {
					try {
						await pool.query(
							"UPDATE documents SET page_count = $2, updated_at = now() WHERE id = $1 AND (page_count IS NULL OR page_count <= 0)",
							[sanitizeText(documentId), inferredPageCount]
						);
						logger.log(
							JSON.stringify({
								event: "PAGE_COUNT_INFERRED_FROM_RENDERED_PAGES",
								document_id: documentId,
								page_count: inferredPageCount,
								dir,
							})
						);
					} catch {
						// ignore
					}
				}
				return ordered;
			}
		}

		if (!pageCount || pageCount <= 0) {
			logger.log(
				JSON.stringify({
					event: "NO_PAGE_IMAGES_AVAILABLE",
					document_id: documentId,
					reason: "page_count_missing_and_no_images_found",
					searched_dirs: dirs,
				})
			);
			return [];
		}

		logger.log(
			JSON.stringify({
				event: "NO_PAGE_IMAGES_AVAILABLE",
				document_id: documentId,
				reason: "no_matching_files",
				searched_dirs: dirs,
				page_count: pageCount,
			})
		);
		return [];
	} catch (err) {
		logger.warn(
			`[visual_extraction] resolvePageImageUris failed doc=${documentId}: ${
				err instanceof Error ? err.message : String(err)
			}`
		);
		return [];
	}
}

export async function backfillVisualAssetImageUris(params: {
	pool: Pool;
	documentId: string;
	pageImageUris: string[];
	env?: NodeJS.ProcessEnv;
}): Promise<{ updated: number }> {
	const env = params.env ?? process.env;
	let updated = 0;

	for (let i = 0; i < params.pageImageUris.length; i += 1) {
		const normalized = normalizeImageUriForDb(params.pageImageUris[i], env);
		if (!normalized) continue;
		try {
			const res = await params.pool.query<{ rowCount?: number }>(
				`UPDATE visual_assets
					 SET image_uri = $3
				 WHERE document_id = $1
				   AND page_index = $2
				   AND (image_uri IS NULL OR image_uri = '')`,
				[sanitizeText(params.documentId), i, normalized]
			);
			updated += res.rowCount ?? 0;
		} catch (err) {
			console.warn(
				`[visual_extraction] backfill image_uri failed doc=${params.documentId} page=${i}: ${
					err instanceof Error ? err.message : String(err)
				}`
			);
		}
	}

	return { updated };
}

export async function hasTable(pool: Pool, table: string): Promise<boolean> {
	try {
		const { rows } = await pool.query<{ oid: string | null }>("SELECT to_regclass($1) as oid", [table]);
		return rows?.[0]?.oid !== null;
	} catch {
		return false;
	}
}

export async function callVisionWorker(
	config: VisionExtractorConfig,
	request: VisionExtractRequest,
	fetchImplOrOptions:
		| typeof fetch
		| {
				fetchImpl?: typeof fetch;
				timeoutMs?: number;
				logger?: LogLike | null;
				logMeta?: Record<string, unknown>;
				attempt?: number;
				runtime?: VisionJobRuntime;
		  }
		| undefined = fetch
): Promise<VisionExtractResponse | null> {
	// If a caller provides a logger but forgets logMeta, inject a minimal object so
	// VISION_REQUEST_* logs still have a stable meta shape and we avoid noisy
	// VISION_LOGMETA_MISSING warnings.
	let normalized = fetchImplOrOptions;
	if (normalized && typeof normalized === "object") {
		const anyOpt = normalized as any;
		const loggerProvided = anyOpt.logger != null;
		const logMetaProvided = anyOpt.logMeta && typeof anyOpt.logMeta === "object";
		if (loggerProvided && !logMetaProvided) {
			normalized = {
				...anyOpt,
				logMeta: {
					stage: "call_vision_worker",
					deal_id: null,
					job_id: null,
				},
			};
		}
	}

	// Normalize the vision request image_uri for the worker.
	request = await normalizeVisionRequestImageUri(request, process.env);
	// Policy: never embed base64 when a fetchable image_uri exists (prefer image_uri-only).
	// Only allow image_b64 as a last resort when image_uri cannot be normalized/resolved.
	if (typeof request.image_uri === "string" && request.image_uri.trim().length > 0) {
		request = { ...request, image_b64: undefined };
	}

	const attempted = await callVisionWorkerAttempt(config, request, normalized);
	return attempted.response;
}

type VisionAttemptErrorKind = "http" | "timeout" | "abort" | "network" | "unknown";

export type VisionAttemptMeta = {
	attempt: number;
	timeout_ms: number;
	elapsed_ms: number;
	status_code: number | null;
	error: string | null;
	error_kind: VisionAttemptErrorKind;
};

type VisionAttemptResult = {
	response: VisionExtractResponse | null;
	meta: VisionAttemptMeta;
};

function classifyVisionErrorKind(args: { err: unknown; elapsedMs: number; timeoutMs: number }): VisionAttemptErrorKind {
	const e = args.err as any;
	const name = typeof e?.name === "string" ? e.name : "";
	const msg = typeof e?.message === "string" ? e.message : String(args.err);
	if (name === "AbortError") return "abort";
	// Node's undici + AbortController often yields this message.
	if (msg.toLowerCase().includes("aborted") || msg.toLowerCase().includes("abort")) return "abort";
	if (args.elapsedMs >= Math.max(0, args.timeoutMs - 5)) return "timeout";
	if (msg.toLowerCase().includes("fetch") || msg.toLowerCase().includes("network") || msg.toLowerCase().includes("socket")) return "network";
	return "unknown";
}

function sleepMs(ms: number): Promise<void> {
	const dur = Number.isFinite(ms) ? Math.max(0, Math.floor(ms)) : 0;
	return new Promise((resolve) => setTimeout(resolve, dur));
}

function withJitter(baseMs: number, jitterPct = 0.2): number {
	const base = Number.isFinite(baseMs) ? Math.max(0, Math.floor(baseMs)) : 0;
	if (base <= 0) return 0;
	const pct = Number.isFinite(jitterPct) ? Math.max(0, Math.min(1, jitterPct)) : 0.2;
	const span = base * pct;
	return Math.max(0, Math.floor(base + (Math.random() * 2 - 1) * span));
}

async function callVisionWorkerAttempt(
	config: VisionExtractorConfig,
	request: VisionExtractRequest,
	fetchImplOrOptions:
		| typeof fetch
		| {
				fetchImpl?: typeof fetch;
				timeoutMs?: number;
				logger?: LogLike | null;
				logMeta?: Record<string, unknown>;
				attempt?: number;
				runtime?: VisionJobRuntime;
		  }
		| undefined
): Promise<VisionAttemptResult> {
	const options =
		typeof fetchImplOrOptions === "function"
			? { fetchImpl: fetchImplOrOptions, timeoutMs: undefined }
			: (fetchImplOrOptions ?? {});
	const fetchImpl = options.fetchImpl ?? fetch;
	const timeoutMs = typeof options.timeoutMs === "number" && Number.isFinite(options.timeoutMs) ? options.timeoutMs : config.timeoutMs;
	const loggerOption = (options as any).logger;
	const logger: LogLike | undefined =
		typeof fetchImplOrOptions === "function" ? undefined : loggerOption === null ? undefined : (loggerOption ?? console);

	// Only warn when the caller genuinely *omitted* logMeta (not when it is present-but-empty or normalized upstream).
	const hasLogMetaProp =
		typeof fetchImplOrOptions === "function"
			? false
			: Boolean(options && typeof options === "object" && Object.prototype.hasOwnProperty.call(options as any, "logMeta"));
	const rawLogMeta = (options as any).logMeta;
	const logMeta: Record<string, unknown> = rawLogMeta && typeof rawLogMeta === "object" ? rawLogMeta : {};
	const attempt = typeof (options as any).attempt === "number" && Number.isFinite((options as any).attempt) ? (options as any).attempt : 1;
	const runtime = (options as any).runtime as VisionJobRuntime | undefined;
	const url = `${config.visionWorkerUrl}/extract-visuals`;

	if (logger && !hasLogMetaProp) {
		logger.warn(
			JSON.stringify({
				event: "VISION_LOGMETA_MISSING",
				document_id: request.document_id,
				page_index: request.page_index,
			})
		);
	}

	if (runtime) {
		const ok = await runtime.ensureReady({ fetchImpl, timeoutMs, logger, logMeta });
		if (!ok || runtime.disabled) {
			return {
				response: null,
				meta: {
					attempt,
					timeout_ms: timeoutMs,
					elapsed_ms: 0,
					status_code: null,
					error: "VISION_DISABLED",
					error_kind: "unknown",
				},
			};
		}
	}

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	const startedAt = Date.now();
	if (logger) {
		logger.log(
			JSON.stringify({
				event: "VISION_REQUEST_START",
				...logMeta,
				deal_id: (logMeta as any)?.deal_id ?? null,
				job_id: (logMeta as any)?.job_id ?? null,
				document_id: request.document_id,
				page_index: request.page_index,
				vision_base_url: config.visionWorkerUrl,
				url,
				attempt,
				timeout_ms: timeoutMs,
				extractor_version: request.extractor_version,
			})
		);
	}

	try {
		const res = await fetchImpl(url, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(request),
			signal: controller.signal,
		});

		if (runtime && (isRenderNoServer(res as any) || res.status === 404)) {
			// Render may route to a no-server shard and return a fast 404; disable to avoid spamming.
			runtime.disable("VISION_DISABLED_NO_SERVER", { where: "extract-visuals", status_code: res.status });
		}

		const elapsedMs = Date.now() - startedAt;
		const error = res.ok ? null : `HTTP_${res.status}`;
		if (logger) {
			logger.log(
				JSON.stringify({
					event: "VISION_REQUEST_DONE",
					...logMeta,
					deal_id: (logMeta as any)?.deal_id ?? null,
					job_id: (logMeta as any)?.job_id ?? null,
					document_id: request.document_id,
					page_index: request.page_index,
					vision_base_url: config.visionWorkerUrl,
					url,
					attempt,
					status_code: res.status,
					elapsed_ms: elapsedMs,
					error,
					extractor_version: request.extractor_version,
				})
			);
		}

		if (!res.ok) {
			return {
				response: null,
				meta: {
					attempt,
					timeout_ms: timeoutMs,
					elapsed_ms: elapsedMs,
					status_code: res.status,
					error,
					error_kind: "http",
				},
			};
		}

		const json = (await res.json()) as VisionExtractResponse;
		if (!json || typeof json !== "object" || !Array.isArray((json as any).assets)) {
			return {
				response: null,
				meta: {
					attempt,
					timeout_ms: timeoutMs,
					elapsed_ms: elapsedMs,
					status_code: res.status,
					error: "INVALID_RESPONSE",
					error_kind: "unknown",
				},
			};
		}
		return {
			response: json,
			meta: {
				attempt,
				timeout_ms: timeoutMs,
				elapsed_ms: elapsedMs,
				status_code: res.status,
				error: null,
				error_kind: "unknown",
			},
		};
	} catch (err) {
		const elapsedMs = Date.now() - startedAt;
		const errorKind = classifyVisionErrorKind({ err, elapsedMs, timeoutMs });
		if (logger) {
			logger.warn(
				JSON.stringify({
					event: "VISION_REQUEST_DONE",
					...logMeta,
					deal_id: (logMeta as any)?.deal_id ?? null,
					job_id: (logMeta as any)?.job_id ?? null,
					document_id: request.document_id,
					page_index: request.page_index,
					vision_base_url: config.visionWorkerUrl,
					url,
					attempt,
					status_code: null,
					elapsed_ms: elapsedMs,
					error: err instanceof Error ? err.message : String(err),
					extractor_version: request.extractor_version,
				})
			);
		}
		return {
			response: null,
			meta: {
				attempt,
				timeout_ms: timeoutMs,
				elapsed_ms: elapsedMs,
				status_code: null,
				error: err instanceof Error ? err.message : String(err),
				error_kind: errorKind,
			},
		};
	} finally {
		clearTimeout(timer);
	}
}

export type VisionRetryOptions = {
	logger?: LogLike | null;
	logMeta?: Record<string, unknown>;
	runtime?: VisionJobRuntime;
	fetchImpl?: typeof fetch;
	timeoutsMs: number[];
	backoffMs?: number[];
	jitterPct?: number;
};

export async function callVisionWorkerWithRetries(
	config: VisionExtractorConfig,
	request: VisionExtractRequest,
	options: VisionRetryOptions
): Promise<{ response: VisionExtractResponse | null; attempts: VisionAttemptMeta[] } > {
	const { logger: loggerOpt, logMeta: logMetaOpt, runtime, timeoutsMs, backoffMs, jitterPct: jitterPctOpt, fetchImpl } = options;
	const logger = loggerOpt === null ? undefined : (loggerOpt ?? console);
	const logMeta: Record<string, unknown> =
		logMetaOpt && typeof logMetaOpt === "object"
			? logMetaOpt
			: logger
				? {
					stage: "call_vision_worker_with_retries",
					deal_id: null,
					job_id: null,
				}
				: {};
	const timeouts = Array.isArray(timeoutsMs) ? timeoutsMs.filter((n) => typeof n === "number" && Number.isFinite(n) && n > 0) : [];
	const explicitBackoff = Array.isArray(backoffMs) && backoffMs.length > 0
		? backoffMs.filter((n) => typeof n === "number" && Number.isFinite(n) && n >= 0)
		: null;
	const expBackoffBaseMs = 500;
	const expBackoffCapMs = 30_000;
	const jitterPct = typeof jitterPctOpt === "number" && Number.isFinite(jitterPctOpt) ? jitterPctOpt : 0.2;
	const attempts: VisionAttemptMeta[] = [];

	// Normalize the vision request image_uri once before retry loop.
	request = await normalizeVisionRequestImageUri(request, process.env);

	const isRetryable = (meta: VisionAttemptMeta): { retryable: boolean; reason: string } => {
		if (meta.error_kind === "timeout" || meta.error_kind === "abort") return { retryable: true, reason: meta.error_kind };
		if (meta.error_kind === "network") return { retryable: true, reason: "network" };
		if (meta.error_kind === "http") {
			const sc = meta.status_code ?? 0;
			if (sc === 429) return { retryable: true, reason: "http_429" };
			if (sc >= 500 && sc <= 599) return { retryable: true, reason: "http_5xx" };
		}
		return { retryable: false, reason: meta.error ?? "non_retryable" };
	};

	for (let idx = 0; idx < timeouts.length; idx += 1) {
		const attempt = idx + 1;
		const timeoutMs = timeouts[idx];
		const attempted = await callVisionWorkerAttempt(config, request, {
			fetchImpl,
			timeoutMs,
			logger,
			logMeta,
			attempt,
			runtime,
		});
		attempts.push(attempted.meta);
		if (attempted.response) return { response: attempted.response, attempts };

		const retry = isRetryable(attempted.meta);
		const hasNext = idx < timeouts.length - 1;
		if (!hasNext || !retry.retryable) break;

		const nextTimeoutMs = timeouts[idx + 1];
		if (logger) {
			logger.log(
				JSON.stringify({
					event: "VISION_REQUEST_RETRY",
					...logMeta,
					deal_id: (logMeta as any)?.deal_id ?? null,
					job_id: (logMeta as any)?.job_id ?? null,
					document_id: request.document_id,
					page_index: request.page_index,
					attempt,
					next_timeout_ms: nextTimeoutMs,
					reason: retry.reason,
				})
			);
		}

		const delayBase = (() => {
			if (explicitBackoff && explicitBackoff.length > 0) {
				const raw = idx < explicitBackoff.length ? explicitBackoff[idx] : explicitBackoff[explicitBackoff.length - 1];
				return typeof raw === "number" && Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;
			}
			// Default: exponential backoff (500ms, 1s, 2s, 4s...) capped.
			const exp = Math.min(20, Math.max(0, idx));
			return Math.min(expBackoffCapMs, expBackoffBaseMs * Math.pow(2, exp));
		})();
		await sleepMs(withJitter(delayBase, jitterPct));
	}

	return { response: null, attempts };
}

export type DeepScanPageFailureV1 = {
	page_index: number;
	reason: string;
	attempts_used: number;
	elapsed_ms?: number;
	status_code?: number | null;
};

export type DeepScanPageSummaryV1 = {
	version: 1;
	attempted: number;
	succeeded: number;
	failed: number;
	failures: DeepScanPageFailureV1[];
	completed_at: string;
};

export type DeepScanOutcomeStatus = "succeeded" | "succeeded_with_warnings" | "failed";

export function computeDeepScanOutcomeStatus(params: {
	attempted: number;
	succeeded: number;
	fatal?: boolean;
}): DeepScanOutcomeStatus {
	if (params.fatal) return "failed";
	if (params.attempted > 0 && params.succeeded === 0) return "failed";
	if (params.attempted === 0) return "failed";
	return params.succeeded < params.attempted ? "succeeded_with_warnings" : "succeeded";
}

export function buildDeepScanPageSummaryV1(params: {
	attempted: number;
	succeeded: number;
	failures: DeepScanPageFailureV1[];
	completedAt?: string;
}): DeepScanPageSummaryV1 {
	const attempted = Number.isFinite(params.attempted) ? Math.max(0, Math.floor(params.attempted)) : 0;
	const succeeded = Number.isFinite(params.succeeded) ? Math.max(0, Math.floor(params.succeeded)) : 0;
	const failed = Math.max(0, attempted - succeeded);
	return {
		version: 1,
		attempted,
		succeeded,
		failed,
		failures: Array.isArray(params.failures) ? params.failures : [],
		completed_at: params.completedAt ?? new Date().toISOString(),
	};
}

export function buildDeepScanExtractionMetadataPatch(params: {
	existingVisualExtraction: Record<string, unknown> | null | undefined;
	summary: DeepScanPageSummaryV1;
	status: DeepScanOutcomeStatus;
}): Record<string, unknown> {
	const existing = params.existingVisualExtraction && typeof params.existingVisualExtraction === "object" ? params.existingVisualExtraction : {};
	return {
		visual_extraction: {
			...existing,
			deep_scan_status: params.status,
			deep_scan_page_summary_v1: params.summary,
			deep_scan_completed_at: params.summary.completed_at,
		},
	};
}

export type ExtractVisualsPageFailureV1 = {
	page_index: number;
	reason: string;
	attempts_used: number;
	elapsed_ms?: number;
	status_code?: number | null;
};

export type ExtractVisualsPageSummaryV1 = {
	version: 1;
	attempted: number;
	succeeded: number;
	failed: number;
	failures: ExtractVisualsPageFailureV1[];
	completed_at: string;
	skipped_existing?: number;
};

export type ExtractVisualsOutcomeStatus = "succeeded" | "succeeded_with_warnings" | "failed";

export function computeExtractVisualsOutcomeStatusV1(params: {
	visionAttempted: number;
	visionSucceeded: number;
	skippedExisting?: number;
	fatal?: boolean;
}): ExtractVisualsOutcomeStatus {
	if (params.fatal) return "failed";
	const skippedExisting = Number.isFinite(params.skippedExisting) ? Math.max(0, Math.floor(params.skippedExisting ?? 0)) : 0;
	const visionAttempted = Number.isFinite(params.visionAttempted) ? Math.max(0, Math.floor(params.visionAttempted)) : 0;
	const visionSucceeded = Number.isFinite(params.visionSucceeded) ? Math.max(0, Math.floor(params.visionSucceeded)) : 0;
	const effectiveAttempted = visionAttempted + skippedExisting;
	const effectiveSucceeded = visionSucceeded + skippedExisting;
	if (visionAttempted > 0 && effectiveSucceeded === 0) return "failed";
	return effectiveSucceeded < effectiveAttempted ? "succeeded_with_warnings" : "succeeded";
}

export function buildExtractVisualsPageSummaryV1(params: {
	visionAttempted: number;
	visionSucceeded: number;
	skippedExisting?: number;
	failures: ExtractVisualsPageFailureV1[];
	completedAt?: string;
}): ExtractVisualsPageSummaryV1 {
	const skippedExisting = Number.isFinite(params.skippedExisting) ? Math.max(0, Math.floor(params.skippedExisting ?? 0)) : 0;
	const visionAttempted = Number.isFinite(params.visionAttempted) ? Math.max(0, Math.floor(params.visionAttempted)) : 0;
	const visionSucceeded = Number.isFinite(params.visionSucceeded) ? Math.max(0, Math.floor(params.visionSucceeded)) : 0;
	const attempted = visionAttempted + skippedExisting;
	const succeeded = visionSucceeded + skippedExisting;
	const failed = Math.max(0, visionAttempted - visionSucceeded);
	return {
		version: 1,
		attempted,
		succeeded,
		failed,
		failures: Array.isArray(params.failures) ? params.failures : [],
		completed_at: params.completedAt ?? new Date().toISOString(),
		...(skippedExisting > 0 ? { skipped_existing: skippedExisting } : {}),
	};
}

export function buildExtractVisualsExtractionMetadataPatchV1(params: {
	existingVisualExtraction: Record<string, unknown> | null | undefined;
	summary: ExtractVisualsPageSummaryV1;
	status: ExtractVisualsOutcomeStatus;
	extractorVersion?: string;
	ocr?:
		| {
				pages_with_ocr: number;
				extractor_version: string;
				reason?: string | null;
		  }
		| null;
}): Record<string, unknown> {
	const existing = params.existingVisualExtraction && typeof params.existingVisualExtraction === "object" ? params.existingVisualExtraction : {};
	const ocrPages =
		params.ocr && typeof (params.ocr as any).pages_with_ocr === "number" && Number.isFinite((params.ocr as any).pages_with_ocr)
			? Math.max(0, Math.floor((params.ocr as any).pages_with_ocr))
			: null;
	const ocrExtractor = params.ocr && typeof (params.ocr as any).extractor_version === "string" ? String((params.ocr as any).extractor_version) : null;
	const ocrReason = params.ocr && typeof (params.ocr as any).reason === "string" ? String((params.ocr as any).reason) : null;
	return {
		visual_extraction: {
			...existing,
			// Canonical fields (do not preserve stale failures across reruns)
			extract_visuals_status: params.status,
			extract_visuals_page_summary_v1: params.summary,
			extract_visuals_completed_at: params.summary.completed_at,
			// Back-compat fields used by older UI/rollups
			status: params.status,
			page_summary_v1: params.summary,
			at: params.summary.completed_at,
			...(params.extractorVersion ? { extractor_version: params.extractorVersion } : {}),
			...(ocrPages != null && ocrExtractor
				? {
					extract_visuals_ocr_summary_v1: {
						version: 1,
						pages_with_ocr: ocrPages,
						extractor_version: ocrExtractor,
						...(ocrReason ? { reason: ocrReason } : {}),
						at: params.summary.completed_at,
					},
					ocr_pages_with_text: ocrPages,
					ocr_extractor_version: ocrExtractor,
				}
				: {}),
		},
	};
}

/**
 * Determines whether an `extract_visuals` page-loop iteration should skip re-processing.
 *
 * A page MUST NOT be skipped unless BOTH of these conditions hold:
 *   1. The doc-level audit status does NOT indicate a prior skipped/failed extraction.
 *   2. A `visual_extractions` row already exists, confirming OCR/vision actually ran.
 *
 * Why `visual_assets` alone is insufficient:
 *   A `visual_assets` row can be written even when vision is unavailable (audit.status=
 *   "skipped" / "vision_unavailable"), which leaves `visual_extractions` empty. Downstream
 *   evidence pipelines (materialize-evidence, governed overlay) require `visual_extractions`
 *   rows — so pages in this state must be re-attempted on every rerun until they succeed.
 *
 * @param docAuditStatus      - value of `extraction_metadata.visual_extraction.status`, or null
 * @param docAuditReason      - optional `reason` field from the same audit object
 * @param docAuditHealthStatus - optional `health_status` (HTTP code) recorded during the run
 * @param hasVisualExtractionRow - whether a `visual_extractions` row exists for this page
 * @returns true  → caller should skip this page (already fully extracted)
 *          false → caller must attempt extraction for this page
 */

/**
 * Robustly determine whether a doc-level audit object indicates that vision/OCR
 * extraction previously failed or was unavailable.
 *
 * Coverage:
 *   - `status` is one of "skipped" | "failed" | "vision_unavailable"
 *   - `reason` contains the substring "vision_unavailable" or "health_check_failed"
 *   - `healthStatus` (HTTP response code from the vision worker) is ≥ 400
 *
 * All three axes are checked independently so that partial audit records (e.g.
 * only reason recorded, no status) are still caught.
 */
export function isAuditVisionFailure(params: {
	status: string | null | undefined;
	reason?: string | null | undefined;
	healthStatus?: number | null | undefined;
}): boolean {
	const { status, reason, healthStatus } = params;

	// 1. Canonical status strings.
	const FAILURE_STATUSES = new Set(["skipped", "failed", "vision_unavailable"]);
	if (typeof status === "string" && FAILURE_STATUSES.has(status)) return true;

	// 2. Reason substrings (handles free-form reason fields from varied code paths).
	if (typeof reason === "string") {
		const r = reason.toLowerCase();
		if (r.includes("vision_unavailable") || r.includes("health_check_failed")) return true;
	}

	// 3. HTTP health-check status from vision worker (≥400 = server or client error).
	if (typeof healthStatus === "number" && Number.isFinite(healthStatus) && healthStatus >= 400) return true;

	return false;
}

export function shouldSkipExtractVisualsPage(params: {
	docAuditStatus: string | null | undefined;
	/** Optional reason field from the same audit object — enables substring-based failure detection. */
	docAuditReason?: string | null | undefined;
	/** Optional HTTP status code from the vision-worker health check recorded in the audit. */
	docAuditHealthStatus?: number | null | undefined;
	hasVisualExtractionRow: boolean;
}): boolean {
	const { docAuditStatus, docAuditReason, docAuditHealthStatus, hasVisualExtractionRow } = params;
	if (isAuditVisionFailure({ status: docAuditStatus, reason: docAuditReason, healthStatus: docAuditHealthStatus })) {
		return false; // must re-attempt regardless of DB state
	}
	return hasVisualExtractionRow; // skip only when extraction row is confirmed
}

type ExcelXlsxExtractRequest = {
	document_id: string;
	xlsx_b64: string;
	extractor_version?: string;
	max_sheets?: number;
	max_tables_per_sheet?: number;
};

type ExcelXlsxExtractResponse = {
	document_id: string;
	extractor_version: string;
	pages: VisionExtractResponse[];
};

// ── XLSX Worker Result ──────────────────────────────────────────────────────
export type XlsxWorkerResultOk = {
	ok: true;
	payload: ExcelXlsxExtractResponse;
	warnings?: string[];
};

export type XlsxWorkerResultFail = {
	ok: false;
	code: "XLSX_WORKER_UNAVAILABLE" | "XLSX_PARSE_FAILED" | "XLSX_TIMEOUT" | "XLSX_BAD_INPUT" | "XLSX_UNKNOWN";
	message: string;
	details?: unknown;
	retryable: boolean;
};

export type XlsxWorkerResult = XlsxWorkerResultOk | XlsxWorkerResultFail;

type XlsxWorkerLogger = { log: (msg: string) => void; error: (msg: string) => void } | null;

type ExcelXlsxWorkerCallOptions = {
	fetchImpl?: typeof fetch;
	timeoutMs?: number;
	/** Structured log fields merged into every log event (e.g. deal_id, job_id). */
	logMeta?: Record<string, unknown>;
	/** Injectable logger — set to null to suppress all internal logs. */
	logger?: XlsxWorkerLogger;
	/** Attempt number for logging (1-based). */
	attempt?: number;
};

export async function callXlsxWorker(
	config: VisionExtractorConfig,
	request: ExcelXlsxExtractRequest,
	options: ExcelXlsxWorkerCallOptions = {}
): Promise<XlsxWorkerResult> {
	const fetchImpl = options.fetchImpl ?? fetch;
	const timeoutMs =
		typeof options.timeoutMs === "number" && Number.isFinite(options.timeoutMs)
			? options.timeoutMs
			: Math.max(15000, config.timeoutMs);
	const logger = options.logger === null ? undefined : (options.logger ?? console);
	const logMeta = options.logMeta ?? {};
	const attempt = options.attempt ?? 1;

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	const startMs = Date.now();

	logger?.log(
		JSON.stringify({
			event: "XLSX_WORKER_CALL",
			...logMeta,
			document_id: request.document_id,
			timeout_ms: timeoutMs,
			attempt,
			ts: new Date().toISOString(),
		})
	);

	try {
		const res = await fetchImpl(`${config.visionWorkerUrl}/extract-xlsx`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(request),
			signal: controller.signal,
		});

		if (!res.ok) {
			const statusCode = res.status;
			const code: XlsxWorkerResultFail["code"] = statusCode >= 500 ? "XLSX_WORKER_UNAVAILABLE" : "XLSX_BAD_INPUT";
			const result: XlsxWorkerResultFail = {
				ok: false,
				code,
				message: `HTTP ${statusCode} from ${config.visionWorkerUrl}/extract-xlsx`,
				details: { status_code: statusCode },
				retryable: statusCode >= 500,
			};
			logger?.error(
				JSON.stringify({
					event: "XLSX_WORKER_FAILURE",
					...logMeta,
					document_id: request.document_id,
					code: result.code,
					message: result.message,
					retryable: result.retryable,
					duration_ms: Date.now() - startMs,
					ts: new Date().toISOString(),
				})
			);
			return result;
		}

		let json: ExcelXlsxExtractResponse;
		try {
			json = (await res.json()) as ExcelXlsxExtractResponse;
		} catch (parseErr) {
			const result: XlsxWorkerResultFail = {
				ok: false,
				code: "XLSX_PARSE_FAILED",
				message: `JSON parse error: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`,
				retryable: false,
			};
			logger?.error(
				JSON.stringify({
					event: "XLSX_WORKER_FAILURE",
					...logMeta,
					document_id: request.document_id,
					code: result.code,
					message: result.message,
					retryable: result.retryable,
					duration_ms: Date.now() - startMs,
					ts: new Date().toISOString(),
				})
			);
			return result;
		}

		if (!json || typeof json !== "object" || !Array.isArray((json as any).pages)) {
			const result: XlsxWorkerResultFail = {
				ok: false,
				code: "XLSX_PARSE_FAILED",
				message: "Response missing required 'pages' array",
				details: { keys: Object.keys(json ?? {}) },
				retryable: false,
			};
			logger?.error(
				JSON.stringify({
					event: "XLSX_WORKER_FAILURE",
					...logMeta,
					document_id: request.document_id,
					code: result.code,
					message: result.message,
					retryable: result.retryable,
					duration_ms: Date.now() - startMs,
					ts: new Date().toISOString(),
				})
			);
			return result;
		}

		const result: XlsxWorkerResultOk = { ok: true, payload: json };
		logger?.log(
			JSON.stringify({
				event: "XLSX_WORKER_SUCCESS",
				...logMeta,
				document_id: request.document_id,
				extracted_pages_count: json.pages.length,
				duration_ms: Date.now() - startMs,
				ts: new Date().toISOString(),
			})
		);
		return result;
	} catch (err) {
		const isAbort =
			err instanceof Error && (err.name === "AbortError" || err.message.toLowerCase().includes("abort"));
		const code: XlsxWorkerResultFail["code"] = isAbort ? "XLSX_TIMEOUT" : "XLSX_WORKER_UNAVAILABLE";
		const result: XlsxWorkerResultFail = {
			ok: false,
			code,
			message: err instanceof Error ? err.message : String(err),
			retryable: true,
		};
		logger?.error(
			JSON.stringify({
				event: "XLSX_WORKER_FAILURE",
				...logMeta,
				document_id: request.document_id,
				code: result.code,
				message: result.message,
				retryable: result.retryable,
				duration_ms: Date.now() - startMs,
				ts: new Date().toISOString(),
			})
		);
		return result;
	} finally {
		clearTimeout(timer);
	}
}

type XlsxRetryOptions = {
	/** Max total attempts. Default: 3 */
	maxAttempts?: number;
	/**
	 * Inter-attempt pause in ms indexed by attempt number (0 = after attempt 1, etc.).
	 * Default: [250, 750, 2000]
	 */
	backoffMs?: number[];
	/** Jitter fraction applied to each backoff delay. Default: 0.2 (±20 %) */
	jitterPct?: number;
	fetchImpl?: typeof fetch;
	timeoutMs?: number;
	logMeta?: Record<string, unknown>;
	logger?: XlsxWorkerLogger;
};

export async function callXlsxWorkerWithRetries(
	config: VisionExtractorConfig,
	request: ExcelXlsxExtractRequest,
	options: XlsxRetryOptions = {}
): Promise<XlsxWorkerResult> {
	const maxAttempts = typeof options.maxAttempts === "number" && options.maxAttempts > 0 ? options.maxAttempts : 3;
	const backoffDelays = Array.isArray(options.backoffMs) && options.backoffMs.length > 0 ? options.backoffMs : [250, 750, 2000];
	const jitterPct = typeof options.jitterPct === "number" ? options.jitterPct : 0.2;
	const logger: XlsxWorkerLogger = options.logger === undefined ? console : options.logger;
	const logMeta = options.logMeta ?? {};

	let lastResult: XlsxWorkerResult | undefined;

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		lastResult = await callXlsxWorker(config, request, {
			fetchImpl: options.fetchImpl,
			timeoutMs: options.timeoutMs,
			logMeta,
			logger,
			attempt,
		});
		if (lastResult.ok) return lastResult;

		const shouldRetry =
			lastResult.retryable ||
			lastResult.code === "XLSX_WORKER_UNAVAILABLE" ||
			lastResult.code === "XLSX_TIMEOUT";
		const hasNext = attempt < maxAttempts;
		if (!shouldRetry || !hasNext) break;

		const baseDelay = backoffDelays[attempt - 1] ?? backoffDelays[backoffDelays.length - 1] ?? 2000;
		const jitter = baseDelay * jitterPct * (Math.random() * 2 - 1);
		const delay = Math.max(0, Math.round(baseDelay + jitter));

		const effectiveLogger = logger === null ? undefined : (logger ?? console);
		effectiveLogger?.log(
			JSON.stringify({
				event: "XLSX_WORKER_RETRY",
				...logMeta,
				document_id: request.document_id,
				attempt,
				next_attempt: attempt + 1,
				delay_ms: delay,
				code: lastResult.code,
				ts: new Date().toISOString(),
			})
		);
		await new Promise<void>((resolve) => setTimeout(resolve, delay));
	}

	if (lastResult && !lastResult.ok) {
		const effectiveLogger = logger === null ? undefined : (logger ?? console);
		effectiveLogger?.error(
			JSON.stringify({
				event: "XLSX_WORKER_EXHAUSTED",
				...logMeta,
				document_id: request.document_id,
				total_attempts: maxAttempts,
				code: lastResult.code,
				message: lastResult.message,
				ts: new Date().toISOString(),
			})
		);
	}

	return lastResult!;
}

type UpsertVisualAssetInput = {
	documentId: string;
	pageIndex: number;
	assetType: VisionAsset["asset_type"];
	bbox: VisionBBox;
	imageUri: string | null;
	imageHash: string | null;
	extractorVersion: string;
	confidence: number;
	qualityFlags: Record<string, unknown>;
};

export async function upsertVisualAsset(pool: Pool, input: UpsertVisualAssetInput): Promise<string> {
	const baseParams = [
		sanitizeText(input.documentId),
		input.pageIndex,
		sanitizeText(input.assetType),
		JSON.stringify(sanitizeDeep(input.bbox)),
		input.imageUri,
		input.imageHash,
		sanitizeText(input.extractorVersion),
		input.confidence,
		JSON.stringify(sanitizeDeep(input.qualityFlags ?? {})),
	];

	if (input.imageHash) {
		const { rows } = await pool.query<{ id: string }>(
			`INSERT INTO visual_assets (
			   document_id, page_index, asset_type, bbox, image_uri, image_hash, extractor_version, confidence, quality_flags
			 ) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9::jsonb)
			 ON CONFLICT (document_id, page_index, extractor_version, image_hash)
			 DO UPDATE SET
			   asset_type = EXCLUDED.asset_type,
			   bbox = EXCLUDED.bbox,
			   image_uri = COALESCE(NULLIF(visual_assets.image_uri,''), EXCLUDED.image_uri),
			   confidence = GREATEST(visual_assets.confidence, EXCLUDED.confidence),
			   quality_flags = visual_assets.quality_flags || EXCLUDED.quality_flags
			 RETURNING id`,
			baseParams
		);
		return rows[0].id;
	}

	const { rows } = await pool.query<{ id: string }>(
		`INSERT INTO visual_assets (
		   document_id, page_index, asset_type, bbox, image_uri, image_hash, extractor_version, confidence, quality_flags
		 ) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9::jsonb)
		 ON CONFLICT (document_id, page_index, extractor_version) WHERE image_hash IS NULL
		 DO UPDATE SET
		   asset_type = EXCLUDED.asset_type,
		   bbox = EXCLUDED.bbox,
		   image_uri = COALESCE(NULLIF(visual_assets.image_uri,''), EXCLUDED.image_uri),
		   confidence = GREATEST(visual_assets.confidence, EXCLUDED.confidence),
		   quality_flags = visual_assets.quality_flags || EXCLUDED.quality_flags
		 RETURNING id`,
		baseParams
	);
	return rows[0].id;
}

type UpsertVisualExtractionInput = {
	visualAssetId: string;
	extractorVersion: string;
	ocrText: string | null;
	ocrBlocks: VisionOcrBlock[];
	structuredJson: Record<string, unknown>;
	units: string | null;
	labels: Record<string, unknown>;
	modelVersion: string | null;
	confidence: number;
};

export async function upsertVisualExtraction(pool: Pool, input: UpsertVisualExtractionInput): Promise<void> {
	await pool.query(
		`INSERT INTO visual_extractions (
		   visual_asset_id, ocr_text, ocr_blocks, structured_json, units, labels,
		   extractor_version, model_version, confidence
		 ) VALUES ($1,$2,$3::jsonb,$4::jsonb,$5,$6::jsonb,$7,$8,$9)
		 ON CONFLICT (visual_asset_id, extractor_version)
		 DO UPDATE SET
		   ocr_text = COALESCE(EXCLUDED.ocr_text, visual_extractions.ocr_text),
		   ocr_blocks = CASE
		     WHEN jsonb_typeof(EXCLUDED.ocr_blocks) = 'array' AND jsonb_array_length(EXCLUDED.ocr_blocks) > 0 THEN EXCLUDED.ocr_blocks
		     ELSE visual_extractions.ocr_blocks
		   END,
		   structured_json = visual_extractions.structured_json || EXCLUDED.structured_json,
		   units = COALESCE(EXCLUDED.units, visual_extractions.units),
		   labels = visual_extractions.labels || EXCLUDED.labels,
		   model_version = COALESCE(EXCLUDED.model_version, visual_extractions.model_version),
		   confidence = GREATEST(visual_extractions.confidence, EXCLUDED.confidence)
		`,
		[
			sanitizeText(input.visualAssetId),
			input.ocrText,
			JSON.stringify(sanitizeDeep(Array.isArray(input.ocrBlocks) ? input.ocrBlocks : [])),
			JSON.stringify(
				sanitizeDeep(
					input.structuredJson && typeof input.structuredJson === "object" && !Array.isArray(input.structuredJson)
						? input.structuredJson
						: {}
				)
			),
			input.units,
			JSON.stringify(
				sanitizeDeep(input.labels && typeof input.labels === "object" && !Array.isArray(input.labels) ? input.labels : {})
			),
			sanitizeText(input.extractorVersion),
			input.modelVersion,
			input.confidence,
		]
	);
}

export async function insertEvidenceLinkIfMissing(pool: Pool, input: {
	documentId: string;
	pageIndex: number | null;
	evidenceType: string;
	visualAssetId: string | null;
	ref: Record<string, unknown>;
	snippet: string | null;
	confidence: number;
}) {
	// IMPORTANT: evidence snippets are scoring-critical. When we re-extract visuals with improved OCR/preprocessing,
	// we must be able to refresh the persisted snippet/ref instead of permanently keeping the first (possibly-garbled)
	// OCR output.
	//
	// The table does not reliably have a unique constraint across these columns, so we do an UPDATE-first pattern.
	const params = [
		sanitizeText(input.documentId),
		input.pageIndex,
		sanitizeText(input.evidenceType),
		input.visualAssetId ? sanitizeText(input.visualAssetId) : null,
		JSON.stringify(sanitizeDeep(input.ref ?? {})),
		input.snippet,
		input.confidence,
	];

	const updateRes = await pool.query(
		`UPDATE evidence_links
		   SET ref = $5::jsonb,
		       snippet = $6,
		       confidence = $7
		 WHERE document_id = $1
		   AND page_index IS NOT DISTINCT FROM $2
		   AND evidence_type = $3
		   AND visual_asset_id IS NOT DISTINCT FROM $4`,
		params
	);
	const updated = typeof (updateRes as any)?.rowCount === "number" ? (updateRes as any).rowCount : 0;
	if (updated > 0) return;

	await pool.query(
		`INSERT INTO evidence_links (document_id, page_index, evidence_type, visual_asset_id, ref, snippet, confidence)
		 VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
		params
	);
}

export async function persistVisionResponse(
	pool: Pool,
	response: VisionExtractResponse,
	options?: { pageImageUri?: string | null; env?: NodeJS.ProcessEnv }
): Promise<{ persisted: number; withImageUri: number }> {
	let persisted = 0;
	let withImageUri = 0;
	const env = options?.env ?? process.env;
	const pageImageUri = options?.pageImageUri ?? null;
	const pageImageUriNormalized = normalizeImageUriForDb(pageImageUri, env);

	const docKind = await (async () => {
		try {
			const res = await pool.query(
				`SELECT type, extraction_metadata
				   FROM documents
				  WHERE id = $1
				  LIMIT 1`,
				[sanitizeText(response.document_id)]
			);
			const row = res.rows?.[0] as any;
			return deduceDocKind({ type: row?.type ?? null, extraction_metadata: row?.extraction_metadata ?? null });
		} catch {
			return "unknown";
		}
	})();

	const excelVisionEnabled = (() => {
		const raw = env.ENABLE_EXCEL_VISION_EXTRACTION;
		if (raw == null) return false;
		return ["1", "true", "yes", "on"].includes(String(raw).trim().toLowerCase());
	})();

	const persistExcelImageText = (() => {
		const raw = env.PERSIST_EXCEL_IMAGE_TEXT;
		if (raw == null) return false;
		return ["1", "true", "yes", "on"].includes(String(raw).trim().toLowerCase());
	})();

	// Optional: enrich segment assignment from per-page understanding (PDF-only).
	let pageUnderstanding: any | null = null;
	try {
		const res = await pool.query(
			"SELECT payload FROM document_page_understanding WHERE document_id = $1 AND page_index = $2 AND version = 'page_understanding_v1' LIMIT 1",
			[sanitizeText(response.document_id), response.page_index]
		);
		pageUnderstanding = (res as any)?.rows?.[0]?.payload ?? null;
	} catch {
		pageUnderstanding = null;
	}
	const pageUnderstandingTitle =
		pageUnderstanding && typeof pageUnderstanding === "object" && typeof (pageUnderstanding as any).resolved_title === "string"
			? String((pageUnderstanding as any).resolved_title)
			: "";
	const pageUnderstandingSlideType =
		pageUnderstanding && typeof pageUnderstanding === "object" && typeof (pageUnderstanding as any).resolved_slide_type === "string"
			? String((pageUnderstanding as any).resolved_slide_type)
			: "";
	const pageUnderstandingSeg = mapSlideTypeToSegmentKey(pageUnderstandingSlideType);

	for (const asset of response.assets ?? []) {
		const normalizedAssetImageUri = normalizeImageUriForDb(asset.image_uri ?? null, env) ?? pageImageUriNormalized;
		const assetBBox = coerceBBox((asset as any)?.bbox);
		const assetQualityFlags = coerceJsonObject((asset as any)?.quality_flags) ?? {};
		const extractionObj = (asset as any)?.extraction;
		const ocrTextFromAsset = typeof extractionObj?.ocr_text === "string" ? extractionObj.ocr_text : null;
		const ocrBlocksFromAsset = coerceJsonArray<VisionOcrBlock>(extractionObj?.ocr_blocks);
		// Fallback: some OCR endpoints may return page-level OCR fields instead of per-asset extraction.
		// Supported shapes:
		// - response.ocr_text / response.ocr_blocks
		// - response.ocr.text / response.ocr.blocks
		const ocrObj = (response as any)?.ocr;
		const ocrTextFromResponseTop = typeof (response as any)?.ocr_text === "string" ? String((response as any).ocr_text) : null;
		const ocrBlocksFromResponseTop = coerceJsonArray<VisionOcrBlock>((response as any)?.ocr_blocks);
		const ocrTextFromResponseNested = typeof ocrObj?.text === "string" ? String(ocrObj.text) : null;
		const ocrBlocksFromResponseNested = coerceJsonArray<VisionOcrBlock>(ocrObj?.blocks);
		const ocrTextFromResponse = ocrTextFromResponseTop ?? ocrTextFromResponseNested;
		const ocrBlocksFromResponse =
			(ocrBlocksFromResponseTop && ocrBlocksFromResponseTop.length > 0)
				? ocrBlocksFromResponseTop
				: ocrBlocksFromResponseNested;
		const ocrText = ocrTextFromAsset ?? ocrTextFromResponse;
		const ocrBlocks = (ocrBlocksFromAsset && ocrBlocksFromAsset.length > 0) ? ocrBlocksFromAsset : ocrBlocksFromResponse;
		const structuredJson = coerceJsonObject(extractionObj?.structured_json);
		const labels = coerceJsonObject(extractionObj?.labels);
		const extractionConfidence =
			typeof extractionObj?.confidence === "number" && Number.isFinite(extractionObj.confidence)
				? extractionObj.confidence
				: typeof (asset as any)?.confidence === "number" && Number.isFinite((asset as any).confidence)
					? (asset as any).confidence
					: 0;
		const titleFromLabels = typeof (labels as any)?.title === "string" ? String((labels as any).title) : "";
		const titleFromStructured = typeof (structuredJson as any)?.title === "string" ? String((structuredJson as any).title) : "";
		const vuObj = (structuredJson as any)?.vision_understanding_v1;
		const titleFromVision = typeof vuObj?.title === "string" ? String(vuObj.title) : "";
		const visionConfidence =
			typeof vuObj?.confidence === "number" && Number.isFinite(vuObj.confidence) ? vuObj.confidence : null;
		const hasAnyTextSignal = Boolean(
			titleFromLabels.trim() ||
			titleFromStructured.trim() ||
			titleFromVision.trim() ||
			pageUnderstandingTitle.trim() ||
			(ocrText && ocrText.trim())
		);

		// Persist a stable segment assignment for vision assets (PDF/images).
		// Resolution order: quality_flags.segment_key -> structured_json.segment_key -> infer from OCR/labels.
		const existingFromQuality = coerceSegmentKey((assetQualityFlags as any)?.segment_key);
		const existingFromStructured = coerceSegmentKey((structuredJson as any)?.segment_key);
		let segmentKey: SegmentKey | null = existingFromQuality ?? existingFromStructured;
		let segmentWasInferred = false;
		let segmentSourceHint: string | null = null;
		let unknownReasonCode: string | null = null;
		if (!segmentKey) {
			const combined = [
				titleFromLabels,
				titleFromStructured,
				titleFromVision,
				pageUnderstandingTitle,
				pageUnderstandingSlideType,
				ocrText,
			]
				.filter(Boolean)
				.join("\n");
			segmentKey = classifySegmentKeyFromText(combined, "unknown");
			segmentWasInferred = true;
			if (segmentKey === "unknown") {
				unknownReasonCode = combined.trim().length === 0 ? "NO_TEXT" : "LOW_SIGNAL";
			}
		} else if (segmentKey === "unknown") {
			unknownReasonCode = hasAnyTextSignal ? "LOW_SIGNAL" : "NO_TEXT";
		}

		// Prefer deterministic segmenting from page_understanding_v1 when present.
		if ((!segmentKey || segmentKey === "unknown") && pageUnderstandingSeg && !existingFromQuality) {
			segmentKey = pageUnderstandingSeg;
			segmentWasInferred = true;
			segmentSourceHint = "page_understanding_v1";
			unknownReasonCode = null;
		}

		// For XLSX-derived page images, treat the segment assignment as a structured pipeline output.
		// This lets the API treat segment_key as persisted/promoted (instead of "hint-only") and avoids "unknown" grouping.
		const isExcelDoc = docKind === "excel";
		if (isExcelDoc && (typeof (assetQualityFlags as any)?.source !== "string" || !String((assetQualityFlags as any).source).startsWith("structured_"))) {
			(assetQualityFlags as any).source = "structured_excel_render_v1";
			(assetQualityFlags as any).original_source = response.extractor_version;
		}


		// Excel: OCR/vision on rendered sheet images is disabled by default.
		// We only persist structured (cell-based) assets unless ENABLE_EXCEL_VISION_EXTRACTION is explicitly turned on.
		if (isExcelDoc && asset.asset_type === "image_text" && !excelVisionEnabled && !persistExcelImageText) {
			continue;
		}

		// Skip persisting empty page-image artifacts for Excel documents even when vision is enabled.
		// These frequently have no OCR/title signal, become segment_key=unknown, and add noise to the graph.
		if (
			isExcelDoc &&
			excelVisionEnabled &&
			asset.asset_type === "image_text" &&
			!hasAnyTextSignal &&
			(!segmentKey || segmentKey === "unknown")
		) {
			continue;
		}

		const qualityFlagsWithSeg: any = { ...(assetQualityFlags ?? {}) };
		if (typeof qualityFlagsWithSeg.source !== "string" || !qualityFlagsWithSeg.source.trim()) {
			qualityFlagsWithSeg.source = response.extractor_version;
		}
		if (segmentKey && !existingFromQuality) {
			qualityFlagsWithSeg.segment_key = segmentKey;
			if (segmentSourceHint && (typeof qualityFlagsWithSeg.segment_source !== "string" || !qualityFlagsWithSeg.segment_source.trim())) {
				qualityFlagsWithSeg.segment_source = segmentSourceHint;
			} else if (segmentWasInferred && (typeof qualityFlagsWithSeg.segment_source !== "string" || !qualityFlagsWithSeg.segment_source.trim())) {
				qualityFlagsWithSeg.segment_source = "inferred_ocr_v1";
			}
		}
		if (segmentKey === "unknown" && unknownReasonCode && (typeof qualityFlagsWithSeg.unknown_reason_code !== "string" || !qualityFlagsWithSeg.unknown_reason_code.trim())) {
			qualityFlagsWithSeg.unknown_reason_code = unknownReasonCode;
		}

		// Persist an explicit acceptance marker so the pipeline can safely skip re-processing the same page.
		// Acceptance is conservative: segment must be non-unknown and we need a title/text signal with reasonable confidence.
		const segmentSource = typeof qualityFlagsWithSeg.segment_source === "string" ? String(qualityFlagsWithSeg.segment_source) : "";
		const isHumanOverride = segmentSource === "human_override" || segmentSource === "human_override_v1" || segmentSource.startsWith("human_override_");
		const isPromoted = segmentSource.startsWith("promoted");
		const titleCandidate = (titleFromLabels || titleFromStructured || titleFromVision).trim();
		const ocrLen = typeof ocrText === "string" ? ocrText.trim().length : 0;
		const hasTitle = titleCandidate.length >= 4;
		const hasOcrText = ocrLen >= 30;
		const okByVision = hasTitle && (visionConfidence == null ? false : visionConfidence >= 0.55);
		const okByOcr = hasOcrText && extractionConfidence >= 0.30;
		const okByStructuredTitle = hasTitle && extractionConfidence >= 0.50;
		const acceptedV1 = Boolean(
			segmentKey &&
			segmentKey !== "unknown" &&
			(isHumanOverride || isPromoted || okByVision || okByOcr || okByStructuredTitle)
		);
		if (typeof qualityFlagsWithSeg.accepted_v1 !== "boolean") {
			qualityFlagsWithSeg.accepted_v1 = acceptedV1;
			qualityFlagsWithSeg.accepted_reason_v1 = isHumanOverride
				? "human_override"
				: isPromoted
					? "promoted"
					: okByVision
						? "vision_understanding"
						: okByOcr
							? "ocr_text"
							: okByStructuredTitle
								? "structured_title"
								: "not_accepted";
		}
		const structuredJsonWithSeg = segmentKey && !existingFromStructured
			? { ...structuredJson, segment_key: segmentKey }
			: structuredJson;

		const visualAssetId = await upsertVisualAsset(pool, {
			documentId: response.document_id,
			pageIndex: response.page_index,
			assetType: asset.asset_type,
			bbox: assetBBox,
			imageUri: normalizedAssetImageUri,
			imageHash: asset.image_hash ?? null,
			extractorVersion: response.extractor_version,
			confidence: asset.confidence ?? 0,
			qualityFlags: qualityFlagsWithSeg,
		});

		if (normalizedAssetImageUri) withImageUri += 1;

		await upsertVisualExtraction(pool, {
			visualAssetId,
			extractorVersion: response.extractor_version,
			ocrText: ocrText,
			ocrBlocks: ocrBlocks,
			structuredJson: structuredJsonWithSeg,
			units: asset.extraction?.units ?? null,
			labels: labels,
			modelVersion: asset.extraction?.model_version ?? null,
			confidence: asset.extraction?.confidence ?? asset.confidence ?? 0,
		});

		const { snippet, source: snippetSource } = deriveEvidenceSnippetV2({
			ocrText: ocrText,
			ocrBlocks,
			structuredJson: structuredJsonWithSeg as any,
			maxChars: 500,
		});

		await insertEvidenceLinkIfMissing(pool, {
			documentId: response.document_id,
			pageIndex: response.page_index,
			evidenceType: "visual_asset",
			visualAssetId,
			ref: {
				asset_type: asset.asset_type,
				bbox: assetBBox,
				image_uri: normalizedAssetImageUri,
				page_image_uri: pageImageUriNormalized,
				image_hash: asset.image_hash ?? null,
				extractor_version: response.extractor_version,
				snippet_source: snippetSource,
			},
			snippet,
			confidence: asset.confidence ?? 0,
		});

		persisted += 1;
	}

	return { persisted, withImageUri };
}

export function deduceDocKind(meta: { extraction_metadata?: any; type?: string | null }): string {
	const fromMeta = meta.extraction_metadata && typeof meta.extraction_metadata === "object"
		? ((meta.extraction_metadata as any).doc_kind ?? (meta.extraction_metadata as any).contentType ?? null)
		: null;
	const kindRaw = (fromMeta || meta.type || "").toString().toLowerCase();
	if (kindRaw.includes("excel") || kindRaw.endsWith("xlsx") || kindRaw === "xls") return "excel";
	if (kindRaw.includes("powerpoint") || kindRaw.includes("ppt")) return "powerpoint";
	if (kindRaw.includes("word") || kindRaw.includes("doc")) return "word";
	if (kindRaw.includes("image")) return "image";
	return kindRaw || "unknown";
}

export type VisionRoutingDecisionV1 = {
	vision_fallback_allowed: boolean;
	reason: string;
	inputs: {
		force_ocr?: boolean;
		needs_ocr: boolean | null;
		page_ocr_attempted: boolean | null;
		full_text_len: number | null;
		pages_with_text: number | null;
		total_pages: number | null;
		coverage: number | null;
		completeness_score: number | null;
		summary_length: number | null;
		min_text_threshold_chars: number;
	};
};

function coerceNumberOrNull(v: unknown): number | null {
	if (typeof v !== "number") return null;
	if (!Number.isFinite(v)) return null;
	return v;
}

function coerceIntOrNull(v: unknown): number | null {
	const n = coerceNumberOrNull(v);
	if (n == null) return null;
	return Math.max(0, Math.floor(n));
}

function coerceBoolOrNull(v: unknown): boolean | null {
	if (typeof v === "boolean") return v;
	return null;
}

function readNeedsOcrFromExtractionMetadata(extractionMetadata: unknown): boolean | null {
	const m = extractionMetadata && typeof extractionMetadata === "object" ? (extractionMetadata as any) : null;
	// Prefer the canonical persisted field.
	const direct = coerceBoolOrNull(m?.needsOcr);
	if (direct != null) return direct;
	// Older/alternate shapes.
	const probe = coerceBoolOrNull(m?.pdf_text_probe?.needsOcr);
	if (probe != null) return probe;
	const probe2 = coerceBoolOrNull(m?.textProbe?.needsOcr);
	if (probe2 != null) return probe2;
	return null;
}

function readPageOcrAttemptedFromExtractionMetadata(extractionMetadata: unknown): boolean | null {
	const m = extractionMetadata && typeof extractionMetadata === "object" ? (extractionMetadata as any) : null;
	const attempted = coerceBoolOrNull(m?.pageOcr?.attempted);
	if (attempted != null) return attempted;
	// Fallback: if we ever persist a different summary key, tolerate it.
	return coerceBoolOrNull(m?.page_ocr_attempted);
}

/**
 * Computes whether vision-worker fallback is allowed for this document.
 * Policy:
 * - Office docs (excel/powerpoint/word): NEVER
 * - Editable PDFs: NEVER
 * - Image-only PDFs: ONLY if local OCR was attempted and full_text remains below threshold
 * - Images: allowed
 */
export function computeVisionRoutingDecisionV1(params: {
	doc_kind: string;
	extraction_metadata: unknown;
	full_text_len: number;
	min_text_threshold_chars: number;
	force_ocr?: boolean;
	page_coverage?: { pages_with_text: number | null; total_pages: number | null; coverage: number | null };
	completeness_score?: number | null;
	summary_length?: number | null;
}): VisionRoutingDecisionV1 {
	const docKind = String(params.doc_kind || "unknown").trim().toLowerCase();
	const minTextThresholdChars = Number.isFinite(params.min_text_threshold_chars)
		? Math.max(0, Math.floor(params.min_text_threshold_chars))
		: 800;
	const fullTextLen = Number.isFinite(params.full_text_len) ? Math.max(0, Math.floor(params.full_text_len)) : 0;

	const metaObj = params.extraction_metadata && typeof params.extraction_metadata === "object" ? (params.extraction_metadata as any) : null;
	const completenessScore = params.completeness_score ?? coerceNumberOrNull(metaObj?.completeness?.score);
	const summaryLength = params.summary_length ?? coerceIntOrNull(metaObj?.summaryLength);

	const pagesWithTextFromMeta = (() => {
		const probe = metaObj?.pdf_text_probe && typeof metaObj.pdf_text_probe === "object" ? metaObj.pdf_text_probe : null;
		const probe2 = metaObj?.textProbe && typeof metaObj.textProbe === "object" ? metaObj.textProbe : null;
		return coerceIntOrNull(probe?.pages_with_text ?? probe2?.pages_with_text);
	})();
	const totalPagesFromMeta = coerceIntOrNull(metaObj?.totalPages ?? metaObj?.pagesProcessed ?? metaObj?.pages_probed);

	const pagesWithText = params.page_coverage?.pages_with_text ?? pagesWithTextFromMeta;
	const totalPages = params.page_coverage?.total_pages ?? totalPagesFromMeta;
	const coverage = params.page_coverage?.coverage ?? (totalPages && totalPages > 0 && pagesWithText != null ? pagesWithText / totalPages : null);
	const weakCoverageOrLowContent =
		(coverage != null && coverage < 0.7) ||
		(completenessScore != null && completenessScore < 0.8) ||
		(summaryLength != null && summaryLength < 50);

	const isOffice = docKind === "excel" || docKind === "powerpoint" || docKind === "word";
	const isPdf = docKind === "pdf";
	const isImage = docKind === "image";
	const forceOcr = Boolean(params.force_ocr);

	const needsOcr = readNeedsOcrFromExtractionMetadata(params.extraction_metadata);
	const pageOcrAttempted = readPageOcrAttemptedFromExtractionMetadata(params.extraction_metadata);

	let visionFallbackAllowed = false;
	let reason = "unknown_disallowed";
	if (isOffice) {
		visionFallbackAllowed = false;
		reason = "office_disallowed";
	} else if (isImage) {
		visionFallbackAllowed = true;
		reason = "image_allowed";
	} else if (isPdf) {
		// IMPORTANT: OCR gating and visual extraction are different concerns.
		// For normal pitch-deck sized PDFs, we always allow vision fallback so we can
		// run `extract_visuals` and populate page understanding/key metrics, even if
		// native PDF text is "ok".
		const isPitchDeckSized = typeof totalPages === "number" && Number.isFinite(totalPages) && totalPages > 0 && totalPages <= 80;

		if (forceOcr) {
			visionFallbackAllowed = true;
			reason = "force_ocr";
		} else if (weakCoverageOrLowContent) {
			visionFallbackAllowed = true;
			reason = "pdf_weak_coverage_or_low_content";
		} else if (isPitchDeckSized) {
			visionFallbackAllowed = true;
			reason = "pdf_pitch_deck_allow_extract_visuals";
		} else if (needsOcr !== true) {
			visionFallbackAllowed = false;
			reason = "pdf_text_ok";
		} else if (pageOcrAttempted !== true) {
			visionFallbackAllowed = false;
			reason = "pdf_ocr_not_attempted";
		} else if (fullTextLen >= minTextThresholdChars) {
			visionFallbackAllowed = false;
			reason = "pdf_text_above_threshold_after_ocr";
		} else {
			visionFallbackAllowed = true;
			reason = "pdf_image_only_low_text_after_ocr";
		}
	} else {
		visionFallbackAllowed = false;
		reason = "unsupported_kind_disallowed";
	}

	return {
		vision_fallback_allowed: visionFallbackAllowed,
		reason,
		inputs: {
			force_ocr: forceOcr,
			needs_ocr: needsOcr,
			page_ocr_attempted: pageOcrAttempted,
			full_text_len: fullTextLen,
			pages_with_text: pagesWithText,
			total_pages: totalPages,
			coverage,
			completeness_score: completenessScore,
			summary_length: summaryLength,
			min_text_threshold_chars: minTextThresholdChars,
		},
	};
}

type SyntheticAssetBuild = {
	pageIndex: number;
	asset: VisionAsset;
};

function hashKey(parts: Array<string | number>): string {
	return createHash("sha256").update(parts.map((p) => String(p)).join("|"), "utf8").digest("hex");
}

export function toTextLoose(node: unknown): string {
	const seen = new WeakSet<object>();

	const stripPoison = (s: string) => {
		// Never allow implicit object stringification markers to leak into classifier text.
		const cleaned = s.replace(/\[object Object\]/g, " ");
		return cleaned.replace(/\s+/g, " ").trim();
	};

	const walk = (value: unknown, depth: number): string => {
		if (value == null) return "";
		if (typeof value === "string") return stripPoison(value);
		if (typeof value === "number" || typeof value === "boolean") return String(value);
		if (Array.isArray(value)) {
			const parts = value.map((v) => walk(v, depth - 1)).filter(Boolean);
			return stripPoison(parts.join("\n"));
		}
		if (typeof value !== "object") return "";
		if (depth <= 0) return "";

		const obj = value as any;
		if (seen.has(obj)) return "";
		seen.add(obj);

		const parts: string[] = [];

		// Common direct keys.
		for (const k of ["text", "value", "content"]) {
			const v = obj?.[k];
			const t = walk(v, depth - 1);
			if (t) parts.push(t);
		}

		// Common rich-text container keys.
		if (Array.isArray(obj?.runs)) {
			const runText = obj.runs.map((r: any) => walk(r, depth - 1)).filter(Boolean).join("");
			if (runText) parts.push(stripPoison(runText));
		}

		for (const k of ["children", "items", "elements"]) {
			if (!Array.isArray(obj?.[k])) continue;
			const t = (obj[k] as any[]).map((c) => walk(c, depth - 1)).filter(Boolean).join("\n");
			if (t) parts.push(stripPoison(t));
		}

		return stripPoison(parts.join("\n"));
	};

	return walk(node, 8);
}

function cleanTextForClassification(input: unknown): string {
	const raw = toTextLoose(input);
	if (!raw) return "";
	// Guard: strip any remaining poisoning artifacts (defensive in case upstream already persisted it).
	return raw.replace(/\[object Object\]/g, " ").replace(/\s+/g, " ").trim();
}

type ExcelSheetUnderstandingV1 = {
	schema_version: "excel_sheet_understanding_v1";
	sheet_name: string;
	detected_type:
		| "revenue"
		| "expenses"
		| "cash_flow"
		| "use_of_funds"
		| "valuation"
		| "cap_table"
		| "financial_model"
		| "unknown";
	confidence: number; // 0..1
	segment_key?: SegmentKey;

	metrics_v1?: ExcelSheetMetricsV1;

	structure: {
		row_count?: number;
		header_count?: number;
		headers_sample: string[];
		row_labels_sample: string[];
		numeric_columns_sample: string[];
	};

	time: {
		granularity: "monthly" | "quarterly" | "annual" | "unknown";
		headers_detected: boolean;
		time_headers_sample: string[];
	};

	units: {
		currency_hint: string | null;
	};

	flags: string[];
};

type ExcelTimeSeriesTableLite = {
	kind?: string;
	name?: string;
	label_col?: string;
	value_cols: Array<{ col: string; header: string }>;
	rows: Array<{ label: string; values: Record<string, { value?: unknown; formula?: string }> }>;
};
type ExcelSheetMetricsV1 = {
	schema_version: "excel_sheet_metrics_v1";
	source: "time_series_table" | "sheet_rows" | "grid_preview" | "none";

	time_series?: {
		period_count: number;
		first_period_label: string | null;
		last_period_label: string | null;
		granularity: ExcelSheetUnderstandingV1["time"]["granularity"];
	};

	key_series?: {
		label: string;
		start_value: number | null;
		end_value: number | null;
		growth_pct: number | null;
		start_period_label: string | null;
		end_period_label: string | null;
		missing_ratio: number;
	};

	distribution?: {
		total_value: number;
		top_categories: Array<{ label: string; value: number; pct_of_total: number }>;
		percent_column_sum?: { value: number; expected: 1 | 100; within_tolerance: boolean };
	};

	quality: {
		numeric_cells: number;
		total_cells_scanned: number;
		numeric_ratio: number;
	};

	flags: string[];
};

function parseExcelNumeric(value: unknown): number | null {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "bigint") return Number(value);
	if (typeof value !== "string") return null;
	let t = value.trim();
	if (!t) return null;
	// Handle (123) negative accounting format.
	let negative = false;
	if (/^\(.*\)$/.test(t)) {
		negative = true;
		t = t.replace(/^\(|\)$/g, "");
	}
	// Remove currency symbols and thousand separators.
	t = t.replace(/[$€£,\s]/g, "");
	if (!t) return null;
	let isPercent = false;
	if (/%$/.test(t)) {
		isPercent = true;
		t = t.replace(/%$/, "");
	}
	// Common suffixes like k/m/b.
	let multiplier = 1;
	if (/^[+-]?[0-9]*\.?[0-9]+[kmb]$/i.test(t)) {
		const suffix = t.slice(-1).toLowerCase();
		t = t.slice(0, -1);
		if (suffix === "k") multiplier = 1_000;
		if (suffix === "m") multiplier = 1_000_000;
		if (suffix === "b") multiplier = 1_000_000_000;
	}
	const n = Number(t);
	if (!Number.isFinite(n)) return null;
	let out = n * multiplier;
	if (isPercent) out = out / 100;
	if (negative) out = -out;
	return out;
}

function formatCompactNumber(n: number, currencyHint: string | null): string {
	const abs = Math.abs(n);
	const sign = n < 0 ? "-" : "";
	const prefix = currencyHint === "USD" ? "$" : currencyHint === "EUR" ? "€" : currencyHint === "GBP" ? "£" : "";
	const fmt = (v: number, suffix: string) => `${sign}${prefix}${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)}${suffix}`;
	if (abs >= 1_000_000_000) return fmt(abs / 1_000_000_000, "B");
	if (abs >= 1_000_000) return fmt(abs / 1_000_000, "M");
	if (abs >= 1_000) return fmt(abs / 1_000, "K");
	return `${sign}${prefix}${abs.toFixed(abs >= 100 ? 0 : abs >= 10 ? 1 : 2)}`;
}

function formatPct(p: number): string {
	return `${(p * 100).toFixed(Math.abs(p) >= 1 ? 0 : 1)}%`;
}

function parseTimeSortKey(header: string): { sortKey: number | null; label: string } {
	const raw = cleanTextForClassification(header);
	const t = raw.toLowerCase();
	if (!t) return { sortKey: null, label: raw };

	// Month N
	const mN = t.match(/^month\s*(\d+)\b/);
	if (mN) return { sortKey: Number(mN[1]), label: raw };

	// Month name
	const monthMap: Record<string, number> = {
		jan: 1,
		january: 1,
		feb: 2,
		february: 2,
		mar: 3,
		march: 3,
		apr: 4,
		april: 4,
		may: 5,
		jun: 6,
		june: 6,
		jul: 7,
		july: 7,
		aug: 8,
		august: 8,
		sep: 9,
		september: 9,
		oct: 10,
		october: 10,
		nov: 11,
		november: 11,
		dec: 12,
		december: 12,
	};
	if (monthMap[t] != null) return { sortKey: monthMap[t], label: raw };

	// Quarter (optionally with year)
	const q = t.match(/\bq([1-4])\b(?:\s*(\d{4}))?/);
	if (q) {
		const qn = Number(q[1]);
		const yr = q[2] ? Number(q[2]) : 0;
		return { sortKey: yr ? yr * 10 + qn : qn, label: raw };
	}

	// FY / Year
	const fy = t.match(/^fy\s*(\d{2,4})$/);
	if (fy) {
		let year = Number(fy[1]);
		if (year < 100) year = 2000 + year;
		return { sortKey: year, label: raw };
	}
	const year = t.match(/^(\d{4})$/);
	if (year) return { sortKey: Number(year[1]), label: raw };

	return { sortKey: null, label: raw };
}

function buildMetricsFromTimeSeriesTable(input: {
	detectedType: ExcelSheetUnderstandingV1["detected_type"];
	granularity: ExcelSheetUnderstandingV1["time"]["granularity"];
	currencyHint: string | null;
	table: ExcelTimeSeriesTableLite;
}): { metrics: ExcelSheetMetricsV1; investorEvidence: string[]; analystEvidence: string[] } {
	const flags: string[] = [];
	const cols = Array.isArray(input.table?.value_cols) ? input.table.value_cols : [];
	const rows = Array.isArray(input.table?.rows) ? input.table.rows : [];

	const colMeta = cols
		.map((c) => {
			const header = cleanTextForClassification(c?.header ?? c?.col);
			const parsed = parseTimeSortKey(header);
			return { col: String(c?.col ?? ""), header, sortKey: parsed.sortKey, label: parsed.label };
		})
		.filter((c) => c.col);

	// Keep original order if we cannot sort meaningfully.
	const canSort = colMeta.some((c) => c.sortKey != null);
	const ordered = canSort
		? [...colMeta].sort((a, b) => {
			if (a.sortKey == null && b.sortKey == null) return 0;
			if (a.sortKey == null) return 1;
			if (b.sortKey == null) return -1;
			return a.sortKey - b.sortKey;
		})
		: colMeta;

	const pickRowScore = (labelRaw: string): number => {
		const label = labelRaw.toLowerCase();
		if (!label.trim()) return 0;
		if (input.detectedType === "revenue") {
			if (/\b(total\s*)?(revenue|sales)\b/.test(label)) return 6;
			if (/\b(arr|mrr)\b/.test(label)) return 5;
			if (/\btotal\b/.test(label)) return 4;
		}
		if (input.detectedType === "expenses") {
			if (/\b(total\s*)?(expense|opex|cogs)\b/.test(label)) return 6;
			if (/\btotal\b/.test(label)) return 4;
		}
		if (input.detectedType === "cash_flow") {
			if (/\b(cash\s*flow|burn|runway|cash\s*balance)\b/.test(label)) return 6;
		}
		return 1;
	};

	type SeriesCandidate = {
		label: string;
		values: Array<number | null>;
		missing: number;
		numericCount: number;
		score: number;
		endValue: number | null;
	};
	let best: SeriesCandidate | null = null;
	let bestAny: SeriesCandidate | null = null;

	let numericCells = 0;
	let totalCells = 0;

	const isLikelyRatioRowLabel = (label: string): boolean => {
		const t = label.toLowerCase();
		return /\b(retention|ratio|margin|%|percent|pct)\b/.test(t);
	};

	const isLikelyTotalRowLabel = (label: string): boolean => {
		const t = label.toLowerCase();
		return /\b(total|subtotal|sum)\b/.test(t);
	};

	const isLikelyHeaderRowLabel = (label: string): boolean => {
		const t = label.toLowerCase();
		// Avoid selecting section headers like "Revenue" with no values.
		return /^(revenue|sales|expenses|opex|cogs|cash\s*flow|runway|burn)$/i.test(t);
	};

	const computeCandidate = (r: any): SeriesCandidate => {
		const label = cleanTextForClassification(r?.label);
		const series: Array<number | null> = [];
		let missing = 0;
		let numericCount = 0;
		let endValue: number | null = null;
		for (const c of ordered) {
			totalCells += 1;
			// NOTE: excel.ts stores time-series row values keyed by the header string (e.g. "Month 1"),
			// not by the column letter. Prefer header key and fall back to column letter.
			const valuesObj = (r as any)?.values ?? {};
			const cell = valuesObj?.[c.header] ?? valuesObj?.[c.label] ?? valuesObj?.[c.col];
			const n = parseExcelNumeric(cell?.value);
			if (n == null) missing += 1;
			else {
				numericCells += 1;
				numericCount += 1;
				endValue = n;
			}
			series.push(n);
		}
		const score = pickRowScore(label);
		return { label, values: series, missing, numericCount, score, endValue };
	};

	for (const r of rows.slice(0, 120)) {
		const cand = computeCandidate(r);
		// Track best-any regardless of data coverage (debugging / fallback)
		if (!bestAny) bestAny = cand;
		else {
			const betterScore = cand.score > bestAny.score;
			const betterEnd = (cand.endValue ?? -Infinity) > (bestAny.endValue ?? -Infinity);
			const fewerMissing = cand.missing < bestAny.missing;
			if (betterScore || (cand.score === bestAny.score && (betterEnd || fewerMissing))) {
				bestAny = cand;
			}
		}

		// Only consider as key series if it has enough numeric coverage.
		// NOTE: do not exclude labels like "Revenue" here; many real sheets have a numeric Revenue row.
		const viable = cand.numericCount >= 2;
		if (!viable) continue;
		if (!best) best = cand;
		else {
			// Prefer higher semantic score, then higher numeric coverage, then fewer missing.
			const betterScore = cand.score > best.score;
			const betterCoverage = cand.numericCount > best.numericCount;
			const fewerMissing = cand.missing < best.missing;
			if (betterScore || (cand.score === best.score && (betterCoverage || fewerMissing))) {
				best = cand;
			}
		}
	}

	const periodCount = ordered.length;
	const firstPeriod = ordered[0]?.label ?? null;
	const lastPeriod = ordered[ordered.length - 1]?.label ?? null;

	const metrics: ExcelSheetMetricsV1 = {
		schema_version: "excel_sheet_metrics_v1",
		source: "time_series_table",
		time_series: {
			period_count: periodCount,
			first_period_label: firstPeriod,
			last_period_label: lastPeriod,
			granularity: input.granularity,
		},
		quality: {
			numeric_cells: numericCells,
			total_cells_scanned: totalCells,
			numeric_ratio: totalCells > 0 ? numericCells / totalCells : 0,
		},
		flags,
	};

	const investorEvidence: string[] = [];
	const analystEvidence: string[] = [];

	// If the expected headline row (e.g. "Revenue") exists but has no values, derive a usable series from line items.
	const maybeDeriveSumSeries = (): SeriesCandidate | null => {
		if (periodCount < 2) return null;
		if (input.detectedType !== "revenue" && input.detectedType !== "expenses" && input.detectedType !== "cash_flow") return null;

		// Build per-row numeric series once for summation.
		const candidates: Array<{ label: string; values: Array<number | null>; numericCount: number }> = [];
		for (const r of rows.slice(0, 150)) {
			const label = cleanTextForClassification((r as any)?.label);
			if (!label) continue;
			if (isLikelyRatioRowLabel(label)) continue;
			if (isLikelyTotalRowLabel(label)) continue;
			// Do not include blank header-like rows (they tend to be section labels).
			if (isLikelyHeaderRowLabel(label)) continue;
			const valuesObj = (r as any)?.values ?? {};
			const series = ordered.map((c) => {
				const cell = valuesObj?.[c.header] ?? valuesObj?.[c.label] ?? valuesObj?.[c.col];
				return parseExcelNumeric(cell?.value);
			});
			const numericCount = series.filter((v) => v != null).length;
			if (numericCount < 2) continue;
			candidates.push({ label, values: series, numericCount });
		}
		if (candidates.length < 2) return null;

		const sumSeries: Array<number | null> = [];
		let missing = 0;
		let numericCount = 0;
		let endValue: number | null = null;
		for (let i = 0; i < periodCount; i++) {
			let s = 0;
			let count = 0;
			for (const r of candidates) {
				const v = r.values[i];
				if (v == null) continue;
				s += v;
				count += 1;
			}
			if (count === 0) {
				missing += 1;
				sumSeries.push(null);
			} else {
				numericCount += 1;
				endValue = s;
				sumSeries.push(s);
			}
		}

		const label = input.detectedType === "expenses" ? "Estimated total expenses (sum of line items)" : "Estimated total (sum of line items)";
		return { label, values: sumSeries, missing, numericCount, score: 2, endValue };
	};

	// If we're a revenue/expenses/cash-flow sheet and the semantic "total" row is present but empty,
	// a derived sum-of-lines series is usually a better investor-facing headline than picking a random line item.
	const derivedPreferred = (() => {
		const derived = maybeDeriveSumSeries();
		if (!derived) return null;
		if (!bestAny) return null;
		if (bestAny.numericCount >= 2) return null;
		// Only prefer derivation when the strongest semantic match is a header-ish total row with no values.
		if (bestAny.score < 4) return null;
		if (!isLikelyHeaderRowLabel(bestAny.label)) return null;
		return derived;
	})();

	if ((derivedPreferred || best) && periodCount >= 2) {
		const chosen = derivedPreferred ?? best!;
		const firstIdx = chosen.values.findIndex((v) => v != null);
		const lastIdx = (() => {
			for (let i = chosen.values.length - 1; i >= 0; i--) if (chosen.values[i] != null) return i;
			return -1;
		})();
		const start = firstIdx >= 0 ? (chosen.values[firstIdx] as number) : null;
		const end = lastIdx >= 0 ? (chosen.values[lastIdx] as number) : null;
		const startLabel = ordered[firstIdx]?.label ?? firstPeriod;
		const endLabel = ordered[lastIdx]?.label ?? lastPeriod;
		const missingRatio = periodCount > 0 ? chosen.missing / periodCount : 1;
		let growthPct: number | null = null;
		if (start != null && end != null && Math.abs(start) > 1e-9) growthPct = (end - start) / Math.abs(start);

		metrics.key_series = {
			label: chosen.label || "(unlabeled)",
			start_value: start,
			end_value: end,
			growth_pct: growthPct,
			start_period_label: startLabel ?? null,
			end_period_label: endLabel ?? null,
			missing_ratio: missingRatio,
		};
		if (derivedPreferred) flags.push("derived_key_series_sum_of_rows");

		if (start != null && end != null) {
			const startTxt = formatCompactNumber(start, input.currencyHint);
			const endTxt = formatCompactNumber(end, input.currencyHint);
			const growthTxt = growthPct != null ? ` (${formatPct(growthPct)} change)` : "";
			investorEvidence.push(
				`${chosen.label || "Key series"} changes from ${startTxt} to ${endTxt} from ${startLabel ?? "(start)"} to ${endLabel ?? "(end)"}${growthTxt}.`
			);
			analystEvidence.push(
				`metrics_v1(time_series_table): key_series=${chosen.label || "(unlabeled)"}, periods=${periodCount}, missing_ratio=${missingRatio.toFixed(2)}.`
			);
		} else {
			analystEvidence.push(
				`metrics_v1(time_series_table): selected key_series=${chosen.label || "(unlabeled)"}, but could not compute start/end (insufficient numeric values).`
			);
			flags.push("key_series_missing_values");
		}
	}

	// Fallback: if no viable series was found, try deriving a series from row sums.
	if (!metrics.key_series && (!best || (best.numericCount < 2 && periodCount >= 2)) && periodCount >= 2) {
		const derived = maybeDeriveSumSeries();
		if (derived) {
			const firstIdx = derived.values.findIndex((v) => v != null);
			const lastIdx = (() => {
				for (let i = derived.values.length - 1; i >= 0; i--) if (derived.values[i] != null) return i;
				return -1;
			})();
			const start = firstIdx >= 0 ? (derived.values[firstIdx] as number) : null;
			const end = lastIdx >= 0 ? (derived.values[lastIdx] as number) : null;
			const startLabel = ordered[firstIdx]?.label ?? firstPeriod;
			const endLabel = ordered[lastIdx]?.label ?? lastPeriod;
			const missingRatio = periodCount > 0 ? derived.missing / periodCount : 1;
			let growthPct: number | null = null;
			if (start != null && end != null && Math.abs(start) > 1e-9) growthPct = (end - start) / Math.abs(start);

			metrics.key_series = {
				label: derived.label,
				start_value: start,
				end_value: end,
				growth_pct: growthPct,
				start_period_label: startLabel ?? null,
				end_period_label: endLabel ?? null,
				missing_ratio: missingRatio,
			};
			flags.push("derived_key_series_sum_of_rows");
			if (start != null && end != null) {
				investorEvidence.push(
					`${derived.label} changes from ${formatCompactNumber(start, input.currencyHint)} to ${formatCompactNumber(end, input.currencyHint)} from ${startLabel ?? "(start)"} to ${endLabel ?? "(end)"}${growthPct != null ? ` (${formatPct(growthPct)} change)` : ""}.`
				);
				analystEvidence.push(
					`metrics_v1(time_series_table): derived key_series from sum of line items; periods=${periodCount}, missing_ratio=${missingRatio.toFixed(2)}.`
				);
			} else {
				analystEvidence.push(
					"metrics_v1(time_series_table): attempted to derive a key series from row sums, but still could not compute start/end."
				);
				flags.push("key_series_missing_values");
			}
		}
	}

	if (metrics.quality.numeric_ratio < 0.15) flags.push("low_numeric_ratio");
	if (periodCount > 0 && metrics.key_series && metrics.key_series.missing_ratio > 0.5) flags.push("high_missing_ratio");

	return { metrics, investorEvidence, analystEvidence };
}

function buildMetricsFromGridPreview(input: {
	detectedType: ExcelSheetUnderstandingV1["detected_type"];
	granularity: ExcelSheetUnderstandingV1["time"]["granularity"];
	currencyHint: string | null;
	headers: string[];
	gridCells: any[];
}): { metrics: ExcelSheetMetricsV1; investorEvidence: string[]; analystEvidence: string[] } {
	const flags: string[] = [];
	const cells = Array.isArray(input.gridCells) ? input.gridCells : [];
	const byAddr = new Map<string, any>();
	for (const c of cells) {
		const a = typeof c?.a === "string" ? c.a : "";
		if (!a) continue;
		byAddr.set(a.toUpperCase(), c);
	}

	// Attempt: header row is row 1.
	const headerCols: Array<{ col: string; header: string }> = [];
	for (let i = 0; i < Math.min(20, input.headers.length); i++) {
		const colLetter = String.fromCharCode("A".charCodeAt(0) + i);
		const addr = `${colLetter}1`;
		const c = byAddr.get(addr);
		const h = cleanTextForClassification(c?.w ?? c?.v ?? input.headers[i]);
		if (!h) continue;
		headerCols.push({ col: colLetter, header: h });
	}

	const numericCols = headerCols.filter((c) => isMonthHeaderToken(c.header) || /\b(month|q[1-4]|fy|\d{4})\b/i.test(c.header));
	const ordered = numericCols
		.map((c) => ({ ...c, ...parseTimeSortKey(c.header) }))
		.sort((a, b) => {
			if (a.sortKey == null && b.sortKey == null) return 0;
			if (a.sortKey == null) return 1;
			if (b.sortKey == null) return -1;
			return a.sortKey - b.sortKey;
		});

	let numericCells = 0;
	let totalCells = 0;

	// Find a candidate label row (prefer row 2..15).
	const candidateRows: Array<{ row: number; label: string; values: Array<number | null>; missing: number }> = [];
	for (let rr = 2; rr <= 18; rr++) {
		const labelCell = byAddr.get(`A${rr}`);
		const label = cleanTextForClassification(labelCell?.w ?? labelCell?.v);
		if (!label) continue;
		const values: Array<number | null> = [];
		let missing = 0;
		for (const c of ordered) {
			totalCells += 1;
			const vCell = byAddr.get(`${c.col}${rr}`);
			const n = parseExcelNumeric(vCell?.v ?? vCell?.w);
			if (n == null) missing += 1;
			else numericCells += 1;
			values.push(n);
		}
		candidateRows.push({ row: rr, label, values, missing });
	}

	const pickRowScore = (labelRaw: string): number => {
		const label = labelRaw.toLowerCase();
		if (input.detectedType === "revenue") {
			if (/\b(total\s*)?(revenue|sales)\b/.test(label)) return 6;
			if (/\b(arr|mrr)\b/.test(label)) return 5;
		}
		if (input.detectedType === "use_of_funds") {
			if (/\b(total|sum)\b/.test(label)) return 3;
		}
		return 1;
	};

	let best = candidateRows
		.map((r) => ({ ...r, score: pickRowScore(r.label) }))
		.sort((a, b) => {
			if (a.score !== b.score) return b.score - a.score;
			const aEnd = (() => {
				for (let i = a.values.length - 1; i >= 0; i--) if (a.values[i] != null) return a.values[i] as number;
				return -Infinity;
			})();
			const bEnd = (() => {
				for (let i = b.values.length - 1; i >= 0; i--) if (b.values[i] != null) return b.values[i] as number;
				return -Infinity;
			})();
			return bEnd - aEnd;
		})[0];

	const periodCount = ordered.length;
	const firstPeriod = ordered[0]?.label ?? null;
	const lastPeriod = ordered[ordered.length - 1]?.label ?? null;

	const metrics: ExcelSheetMetricsV1 = {
		schema_version: "excel_sheet_metrics_v1",
		source: "grid_preview",
		time_series: periodCount
			? { period_count: periodCount, first_period_label: firstPeriod, last_period_label: lastPeriod, granularity: input.granularity }
			: undefined,
		quality: {
			numeric_cells: numericCells,
			total_cells_scanned: totalCells,
			numeric_ratio: totalCells > 0 ? numericCells / totalCells : 0,
		},
		flags,
	};

	const investorEvidence: string[] = [];
	const analystEvidence: string[] = [];

	if (best && periodCount >= 2) {
		const firstIdx = best.values.findIndex((v) => v != null);
		const lastIdx = (() => {
			for (let i = best.values.length - 1; i >= 0; i--) if (best.values[i] != null) return i;
			return -1;
		})();
		const start = firstIdx >= 0 ? (best.values[firstIdx] as number) : null;
		const end = lastIdx >= 0 ? (best.values[lastIdx] as number) : null;
		const startLabel = ordered[firstIdx]?.label ?? firstPeriod;
		const endLabel = ordered[lastIdx]?.label ?? lastPeriod;
		const missingRatio = periodCount > 0 ? best.missing / periodCount : 1;
		let growthPct: number | null = null;
		if (start != null && end != null && Math.abs(start) > 1e-9) growthPct = (end - start) / Math.abs(start);
		metrics.key_series = {
			label: best.label,
			start_value: start,
			end_value: end,
			growth_pct: growthPct,
			start_period_label: startLabel ?? null,
			end_period_label: endLabel ?? null,
			missing_ratio: missingRatio,
		};
		if (start != null && end != null) {
			const startTxt = formatCompactNumber(start, input.currencyHint);
			const endTxt = formatCompactNumber(end, input.currencyHint);
			const growthTxt = growthPct != null ? ` (${formatPct(growthPct)} change)` : "";
			investorEvidence.push(
				`${best.label} changes from ${startTxt} to ${endTxt} from ${startLabel ?? "(start)"} to ${endLabel ?? "(end)"}${growthTxt}.`
			);
			analystEvidence.push(`metrics_v1(grid_preview): key_series=${best.label}, periods=${periodCount}, missing_ratio=${missingRatio.toFixed(2)}.`);
		}
	}

	if (metrics.quality.numeric_ratio < 0.08) flags.push("low_numeric_ratio");
	return { metrics, investorEvidence, analystEvidence };
}

function buildUseOfFundsDistributionFromSheetRows(input: {
	headers: string[];
	rows: Array<Record<string, unknown>>;
	currencyHint: string | null;
}): {
	distribution: ExcelSheetMetricsV1["distribution"] | null;
	flags: string[];
	evidence: { investor: string[]; analyst: string[] };
} {
	const flags: string[] = [];
	const investor: string[] = [];
	const analyst: string[] = [];

	const headers = Array.isArray(input.headers) ? input.headers.map((h) => cleanTextForClassification(h)).filter(Boolean) : [];
	const rows = Array.isArray(input.rows) ? input.rows : [];
	if (headers.length === 0 || rows.length === 0) {
		return { distribution: null, flags: ["use_of_funds:no_headers_or_rows"], evidence: { investor, analyst } };
	}

	const headerNorm = (h: string) => h.toLowerCase().replace(/\s+/g, " ").trim();
	const labelHints = ["category", "categories", "purpose", "use", "allocation", "item", "line item", "metric", "description", "col_a", "col a", "label"];
	const amountHints = ["amount", "budget", "cost", "spend", "allocated", "usd", "value", "total"];
	const pctHints = ["%", "percent", "pct", "percentage", "share", "portion"];

	const headerScores = headers.map((h) => {
		const n = headerNorm(h);
		const labelScore = labelHints.some((k) => n.includes(k)) ? 3 : 0;
		const amountScore = amountHints.some((k) => n.includes(k)) ? 2 : 0;
		const pctScore = pctHints.some((k) => n.includes(k)) ? 2 : 0;
		return { h, n, labelScore, amountScore, pctScore };
	});

	const getColumnStats = (header: string) => {
		let numericCount = 0;
		let total = 0;
		let max = -Infinity;
		let sum = 0;
		for (const r of rows.slice(0, 250)) {
			const v = (r as any)?.[header];
			const n = parseExcelNumeric(v);
			total += 1;
			if (n == null) continue;
			numericCount += 1;
			sum += n;
			if (n > max) max = n;
		}
		return {
			numericCount,
			total,
			numericRatio: total > 0 ? numericCount / total : 0,
			max: numericCount > 0 ? max : null,
			sum: numericCount > 0 ? sum : 0,
		};
	};

	let labelCol = headerScores.sort((a, b) => b.labelScore - a.labelScore).find((s) => s.labelScore > 0)?.h;
	if (!labelCol) labelCol = headers[0];

	const candidates = headers.map((h) => ({ h, stats: getColumnStats(h), score: headerScores.find((s) => s.h === h) }));
	const amountCol = candidates
		.map((c) => {
			const hint = c.score?.amountScore ?? 0;
			const statScore = c.stats.numericRatio;
			const magnitudeScore = c.stats.max != null ? Math.min(3, Math.log10(Math.max(1, Math.abs(c.stats.max))) / 2) : 0;
			return { h: c.h, totalScore: hint + statScore + magnitudeScore };
		})
		.sort((a, b) => b.totalScore - a.totalScore)[0]?.h;

	const pctCol = candidates
		.map((c) => {
			const hint = c.score?.pctScore ?? 0;
			if (c.stats.numericRatio < 0.3 || c.stats.max == null) return { h: c.h, totalScore: -1 };
			const max = Math.abs(c.stats.max);
			const rangeScore = max <= 1.2 ? 3 : max <= 120 ? 2 : 0;
			return { h: c.h, totalScore: hint + rangeScore + c.stats.numericRatio };
		})
		.sort((a, b) => b.totalScore - a.totalScore)[0]?.h;

	if (!amountCol) return { distribution: null, flags: ["use_of_funds:no_amount_col"], evidence: { investor, analyst } };

	const items: Array<{ label: string; value: number; pctRaw: number | null }> = [];
	for (const r of rows.slice(0, 500)) {
		const labelRaw = cleanTextForClassification((r as any)?.[labelCol]);
		if (!labelRaw) continue;
		const label = labelRaw.trim();
		if (!label) continue;
		if (/^total\b|\bsum\b|\bsubtotal\b/i.test(label)) continue;
		const value = parseExcelNumeric((r as any)?.[amountCol]);
		if (value == null) continue;
		const pctRaw = pctCol ? parseExcelNumeric((r as any)?.[pctCol]) : null;
		items.push({ label, value, pctRaw });
		if (items.length >= 120) break;
	}
	if (items.length < 2) return { distribution: null, flags: ["use_of_funds:insufficient_items"], evidence: { investor, analyst } };

	const totalValue = items.reduce((acc, it) => acc + it.value, 0);
	if (!Number.isFinite(totalValue) || Math.abs(totalValue) < 1e-9) return { distribution: null, flags: ["use_of_funds:bad_total"], evidence: { investor, analyst } };

	const top = [...items]
		.sort((a, b) => b.value - a.value)
		.slice(0, 5)
		.map((it) => ({ label: it.label, value: it.value, pct_of_total: it.value / totalValue }));

	let percentColumnSum: NonNullable<ExcelSheetMetricsV1["distribution"]>["percent_column_sum"] | undefined;
	if (pctCol) {
		const pctVals = items.map((it) => it.pctRaw).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
		if (pctVals.length >= Math.min(6, Math.ceil(items.length * 0.4))) {
			const max = Math.max(...pctVals.map((v) => Math.abs(v)));
			const expected: 1 | 100 = max <= 1.2 ? 1 : 100;
			const sum = pctVals.reduce((a, b) => a + b, 0);
			const within = expected === 1 ? Math.abs(sum - 1) <= 0.03 : Math.abs(sum - 100) <= 3;
			percentColumnSum = { value: sum, expected, within_tolerance: within };
			flags.push(within ? "use_of_funds:percent_sum_ok" : "use_of_funds:percent_sum_off");
		}
	}

	const distribution: ExcelSheetMetricsV1["distribution"] = {
		total_value: totalValue,
		top_categories: top,
		percent_column_sum: percentColumnSum,
	};

	const top1 = top[0];
	if (top1) {
		investor.push(
			`Top allocation appears to be ${top1.label} at ${formatCompactNumber(top1.value, input.currencyHint)} (${formatPct(top1.pct_of_total)} of total).`
		);
	}
	if (percentColumnSum) {
		analyst.push(
			`metrics_v1(use_of_funds): percent_col_sum=${percentColumnSum.value.toFixed(2)} vs expected=${percentColumnSum.expected} (within_tolerance=${percentColumnSum.within_tolerance}).`
		);
	}

	return { distribution, flags, evidence: { investor, analyst } };
}

function buildUseOfFundsDistributionFromGridPreview(input: {
	headers: string[];
	gridCells: any[];
	currencyHint: string | null;
}): {
	distribution: ExcelSheetMetricsV1["distribution"] | null;
	flags: string[];
	evidence: { investor: string[]; analyst: string[] };
} {
	const flags: string[] = [];
	const investor: string[] = [];
	const analyst: string[] = [];

	const cells = Array.isArray(input.gridCells) ? input.gridCells : [];
	if (cells.length === 0) return { distribution: null, flags: ["use_of_funds:no_grid_preview"], evidence: { investor, analyst } };

	const byAddr = new Map<string, any>();
	for (const c of cells) {
		const a = typeof c?.a === "string" ? c.a : "";
		if (!a) continue;
		byAddr.set(a.toUpperCase(), c);
	}

	const headers = Array.isArray(input.headers) ? input.headers.map((h) => cleanTextForClassification(h)).filter(Boolean) : [];
	const maxCols = Math.min(12, Math.max(3, headers.length));

	const getHeaderAt = (colLetter: string): string => {
		const c = byAddr.get(`${colLetter}1`);
		const h = cleanTextForClassification(c?.w ?? c?.v);
		if (h) return h;
		const idx = colLetter.charCodeAt(0) - "A".charCodeAt(0);
		return headers[idx] ?? colLetter;
	};

	const headerNorm = (h: string) => h.toLowerCase().replace(/\s+/g, " ").trim();
	const labelHints = ["category", "purpose", "allocation", "item", "description", "metric", "label", "col a", "col_a"];
	const amountHints = ["amount", "budget", "cost", "spend", "allocated", "usd", "value", "total"];
	const pctHints = ["%", "percent", "pct", "percentage", "share"];

	// Determine candidate columns A.. up to maxCols.
	const cols: Array<{ col: string; header: string }> = [];
	for (let i = 0; i < maxCols; i++) {
		cols.push({ col: String.fromCharCode("A".charCodeAt(0) + i), header: getHeaderAt(String.fromCharCode("A".charCodeAt(0) + i)) });
	}

	const colScores = cols.map((c) => {
		const n = headerNorm(c.header);
		return {
			...c,
			labelScore: labelHints.some((k) => n.includes(k)) ? 3 : 0,
			amountScore: amountHints.some((k) => n.includes(k)) ? 2 : 0,
			pctScore: pctHints.some((k) => n.includes(k)) ? 2 : 0,
		};
	});

	let labelCol = colScores.sort((a, b) => b.labelScore - a.labelScore)[0]?.col ?? "A";
	if (!labelCol) labelCol = "A";

	// Score amount column by numeric density in rows 2..18.
	const amountCandidates = cols
		.filter((c) => c.col !== labelCol)
		.map((c) => {
			let numericCount = 0;
			let total = 0;
			let max = -Infinity;
			for (let rr = 2; rr <= 18; rr++) {
				total += 1;
				const cell = byAddr.get(`${c.col}${rr}`);
				const n = parseExcelNumeric(cell?.v ?? cell?.w);
				if (n == null) continue;
				numericCount += 1;
				if (n > max) max = n;
			}
			const headerHint = colScores.find((s) => s.col === c.col)?.amountScore ?? 0;
			const density = total > 0 ? numericCount / total : 0;
			const mag = Number.isFinite(max) ? Math.min(3, Math.log10(Math.max(1, Math.abs(max))) / 2) : 0;
			return { col: c.col, header: c.header, score: headerHint + density + mag };
		})
		.sort((a, b) => b.score - a.score);

	const amountCol = amountCandidates[0]?.col;
	if (!amountCol) return { distribution: null, flags: ["use_of_funds:no_amount_col_grid"], evidence: { investor, analyst } };

	// Percent column detection.
	const pctCandidates = cols
		.filter((c) => c.col !== labelCol && c.col !== amountCol)
		.map((c) => {
			let numericCount = 0;
			let total = 0;
			let max = -Infinity;
			for (let rr = 2; rr <= 18; rr++) {
				total += 1;
				const cell = byAddr.get(`${c.col}${rr}`);
				const n = parseExcelNumeric(cell?.v ?? cell?.w);
				if (n == null) continue;
				numericCount += 1;
				if (n > max) max = n;
			}
			const hint = colScores.find((s) => s.col === c.col)?.pctScore ?? 0;
			const density = total > 0 ? numericCount / total : 0;
			const rangeScore = Number.isFinite(max) ? (Math.abs(max) <= 1.2 ? 3 : Math.abs(max) <= 120 ? 2 : 0) : 0;
			return { col: c.col, header: c.header, score: hint + density + rangeScore };
		})
		.sort((a, b) => b.score - a.score);
	const pctCol = pctCandidates[0]?.score > 1.5 ? pctCandidates[0].col : null;

	const items: Array<{ label: string; value: number; pctRaw: number | null }> = [];
	for (let rr = 2; rr <= 40; rr++) {
		const labelCell = byAddr.get(`${labelCol}${rr}`);
		const label = cleanTextForClassification(labelCell?.w ?? labelCell?.v)?.trim();
		if (!label) continue;
		if (/^total\b|\bsum\b|\bsubtotal\b/i.test(label)) continue;
		const valueCell = byAddr.get(`${amountCol}${rr}`);
		const value = parseExcelNumeric(valueCell?.v ?? valueCell?.w);
		if (value == null) continue;
		const pct = pctCol ? parseExcelNumeric(byAddr.get(`${pctCol}${rr}`)?.v ?? byAddr.get(`${pctCol}${rr}`)?.w) : null;
		items.push({ label, value, pctRaw: pct });
		if (items.length >= 40) break;
	}

	if (items.length < 2) return { distribution: null, flags: ["use_of_funds:insufficient_items_grid"], evidence: { investor, analyst } };

	const totalValue = items.reduce((acc, it) => acc + it.value, 0);
	if (!Number.isFinite(totalValue) || Math.abs(totalValue) < 1e-9) return { distribution: null, flags: ["use_of_funds:bad_total_grid"], evidence: { investor, analyst } };

	const top = [...items]
		.sort((a, b) => b.value - a.value)
		.slice(0, 5)
		.map((it) => ({ label: it.label, value: it.value, pct_of_total: it.value / totalValue }));

	let percentColumnSum: NonNullable<ExcelSheetMetricsV1["distribution"]>["percent_column_sum"] | undefined;
	if (pctCol) {
		const pctVals = items.map((it) => it.pctRaw).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
		if (pctVals.length >= Math.min(4, Math.ceil(items.length * 0.4))) {
			const max = Math.max(...pctVals.map((v) => Math.abs(v)));
			const expected: 1 | 100 = max <= 1.2 ? 1 : 100;
			const sum = pctVals.reduce((a, b) => a + b, 0);
			const within = expected === 1 ? Math.abs(sum - 1) <= 0.05 : Math.abs(sum - 100) <= 5;
			percentColumnSum = { value: sum, expected, within_tolerance: within };
			flags.push(within ? "use_of_funds:percent_sum_ok" : "use_of_funds:percent_sum_off");
		}
	}

	const distribution: ExcelSheetMetricsV1["distribution"] = {
		total_value: totalValue,
		top_categories: top,
		percent_column_sum: percentColumnSum,
	};

	const top1 = top[0];
	if (top1) {
		investor.push(
			`Top allocation appears to be ${top1.label} at ${formatCompactNumber(top1.value, input.currencyHint)} (${formatPct(top1.pct_of_total)} of total).`
		);
	}
	if (percentColumnSum) {
		analyst.push(
			`metrics_v1(use_of_funds:grid_preview): percent_col_sum=${percentColumnSum.value.toFixed(2)} vs expected=${percentColumnSum.expected} (within_tolerance=${percentColumnSum.within_tolerance}).`
		);
	}

	return { distribution, flags, evidence: { investor, analyst } };
}

function isMonthHeaderToken(s: string): boolean {
	const t = String(s ?? "").trim().toLowerCase();
	if (!t) return false;
	if (/^month\s*\d+\b/.test(t)) return true;
	if (/^(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|jun(e)?|jul(y)?|aug(ust)?|sep(tember)?|oct(ober)?|nov(ember)?|dec(ember)?)$/.test(t)) return true;
	if (/\bq[1-4]\b/.test(t)) return true;
	if (/^fy\s*\d{2,4}$/.test(t)) return true;
	if (/^\d{4}$/.test(t)) return true;
	return false;
}

function inferExcelDetectedType(textRaw: string): { type: ExcelSheetUnderstandingV1["detected_type"]; confidence: number; flags: string[] } {
	const t = String(textRaw ?? "").toLowerCase();
	const flags: string[] = [];
	if (!t.trim()) return { type: "unknown", confidence: 0.3, flags };

	const hasRevenue = /\b(revenue|revenues|sales|arr|mrr)\b/.test(t);
	const hasExpenses = /\b(expense|expenses|opex|operating expense|cogs|cost of goods)\b/.test(t);
	const hasCashFlow = /\b(cash flow|cashflow|burn|runway|cash balance)\b/.test(t);
	const hasUseOfFunds = /\b(use of funds|allocation of funds|funds allocation)\b/.test(t);
	const hasValuation = /\b(valuation|pre-money|post-money|waterfall|return multiple|exit)\b/.test(t);
	const hasCapTable = /\b(cap table|captable|ownership|dilution|option pool|share)\b/.test(t);

	if (hasUseOfFunds) return { type: "use_of_funds", confidence: 0.9, flags: ["matched:use_of_funds"] };
	if (hasCapTable) return { type: "cap_table", confidence: 0.85, flags: ["matched:cap_table"] };
	if (hasValuation) return { type: "valuation", confidence: 0.85, flags: ["matched:valuation"] };
	if (hasCashFlow) return { type: "cash_flow", confidence: 0.8, flags: ["matched:cash_flow"] };
	if (hasRevenue && !hasExpenses) return { type: "revenue", confidence: 0.75, flags: ["matched:revenue"] };
	if (hasExpenses && !hasRevenue) return { type: "expenses", confidence: 0.75, flags: ["matched:expenses"] };
	if (hasRevenue && hasExpenses) return { type: "financial_model", confidence: 0.7, flags: ["matched:revenue+expenses"] };

	return { type: "financial_model", confidence: 0.55, flags: ["default:financial_model"] };
}

function inferCurrencyHint(textRaw: string): string | null {
	const t = String(textRaw ?? "");
	if (!t) return null;
	if (/(\$|usd\b)/i.test(t)) return "USD";
	if (/(€|eur\b)/i.test(t)) return "EUR";
	if (/(£|gbp\b)/i.test(t)) return "GBP";
	return null;
}

function buildExcelSheetUnderstandingV1(input: {
	sheetName: string;
	segmentKey?: SegmentKey;
	headers: string[];
	rowCount?: number;
	numericColumns: string[];
	gridCells: any[];
	table?: ExcelTimeSeriesTableLite;
	sheetRows?: Array<Record<string, unknown>>;
}): { understanding: ExcelSheetUnderstandingV1; investor_summary: string; analyst_summary: string } {
	const headersSample = (Array.isArray(input.headers) ? input.headers : []).slice(0, 18).map((h) => cleanTextForClassification(h)).filter(Boolean);
	const numericColumnsSample = (Array.isArray(input.numericColumns) ? input.numericColumns : []).slice(0, 10).map((h) => cleanTextForClassification(h)).filter(Boolean);

	const colALabels: string[] = [];
	for (const c of Array.isArray(input.gridCells) ? input.gridCells : []) {
		const addr = typeof c?.a === "string" ? c.a : "";
		if (!addr) continue;
		// Prefer column A labels as the most common “row label” column.
		if (!/^A\d+$/i.test(addr)) continue;
		const label = cleanTextForClassification(c?.w ?? c?.v);
		if (!label) continue;
		// Skip obvious header-ish tokens
		if (isMonthHeaderToken(label)) continue;
		if (!colALabels.includes(label)) colALabels.push(label);
		if (colALabels.length >= 12) break;
	}

	// If there is no grid preview (common for structured-native Excel), fall back to table row labels.
	if (colALabels.length === 0 && input.table && Array.isArray(input.table.rows) && input.table.rows.length > 0) {
		for (const r of input.table.rows.slice(0, 18)) {
			const label = cleanTextForClassification((r as any)?.label);
			if (!label) continue;
			if (!colALabels.includes(label)) colALabels.push(label);
			if (colALabels.length >= 12) break;
		}
	}

	const classifyText = [
		input.sheetName ? `sheet: ${input.sheetName}` : "",
		headersSample.length ? `headers: ${headersSample.join(" ")}` : "",
		numericColumnsSample.length ? `numeric: ${numericColumnsSample.join(" ")}` : "",
		colALabels.length ? `labels: ${colALabels.join(" ")}` : "",
	]
		.filter(Boolean)
		.join("\n");

	const detected = inferExcelDetectedType(classifyText);
	const currencyHint = inferCurrencyHint(classifyText);

	const timeHeadersSample = headersSample.filter(isMonthHeaderToken).slice(0, 10);
	const timeHeadersDetected = timeHeadersSample.length >= 2;
	let granularity: ExcelSheetUnderstandingV1["time"]["granularity"] = "unknown";
	if (timeHeadersDetected) {
		const joined = timeHeadersSample.join(" ").toLowerCase();
		if (/(month\s*\d+|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/.test(joined)) granularity = "monthly";
		else if (/\bq[1-4]\b/.test(joined)) granularity = "quarterly";
		else if (/\b\d{4}\b|\bfy\b/.test(joined)) granularity = "annual";
	}

	const baseFlags = [
		...detected.flags,
		...(timeHeadersDetected ? ["time_headers_detected"] : ["time_headers_missing"]),
		...(currencyHint ? [`currency:${currencyHint}`] : []),
	].filter(Boolean);

	let metrics: ExcelSheetMetricsV1 | undefined;
	const investorEvidence: string[] = [];
	const analystEvidence: string[] = [];
	if (input.table && Array.isArray(input.table.value_cols) && Array.isArray(input.table.rows) && input.table.value_cols.length >= 2) {
		const res = buildMetricsFromTimeSeriesTable({
			detectedType: detected.type,
			granularity,
			currencyHint,
			table: input.table,
		});
		metrics = res.metrics;
		investorEvidence.push(...res.investorEvidence);
		analystEvidence.push(...res.analystEvidence);
	} else if (Array.isArray(input.gridCells) && input.gridCells.length > 0) {
		const res = buildMetricsFromGridPreview({
			detectedType: detected.type,
			granularity,
			currencyHint,
			headers: input.headers,
			gridCells: input.gridCells,
		});
		metrics = res.metrics;
		investorEvidence.push(...res.investorEvidence);
		analystEvidence.push(...res.analystEvidence);
	}

	// For use-of-funds style sheets, compute a distribution summary from sheet rows if available.
	if (detected.type === "use_of_funds" && Array.isArray(input.sheetRows) && input.sheetRows.length > 0) {
		const dist = buildUseOfFundsDistributionFromSheetRows({
			headers: Array.isArray(input.headers) ? input.headers : [],
			rows: input.sheetRows,
			currencyHint,
		});
		if (dist.distribution) {
			if (!metrics) {
				metrics = {
					schema_version: "excel_sheet_metrics_v1",
					source: "sheet_rows",
					distribution: dist.distribution,
					quality: { numeric_cells: 0, total_cells_scanned: 0, numeric_ratio: 0 },
					flags: [...dist.flags],
				};
			} else {
				metrics.distribution = dist.distribution;
				metrics.flags.push(...dist.flags);
				// If we already had another source, keep it but mark the distribution came from rows.
				if (metrics.source === "grid_preview" || metrics.source === "time_series_table") metrics.source = "sheet_rows";
			}
			// For use-of-funds, distribution evidence is usually the most relevant.
			investorEvidence.unshift(...dist.evidence.investor);
			analystEvidence.unshift(...dist.evidence.analyst);
		}
	}

	// Fallback: if we couldn't compute distribution from rows, try the grid preview.
	if (detected.type === "use_of_funds" && (!metrics?.distribution || metrics.distribution.top_categories.length === 0) && Array.isArray(input.gridCells)) {
		const dist = buildUseOfFundsDistributionFromGridPreview({
			headers: Array.isArray(input.headers) ? input.headers : [],
			gridCells: input.gridCells,
			currencyHint,
		});
		if (dist.distribution) {
			if (!metrics) {
				metrics = {
					schema_version: "excel_sheet_metrics_v1",
					source: "grid_preview",
					distribution: dist.distribution,
					quality: { numeric_cells: 0, total_cells_scanned: 0, numeric_ratio: 0 },
					flags: [...dist.flags],
				};
			} else {
				metrics.distribution = dist.distribution;
				metrics.flags.push(...dist.flags);
			}
			investorEvidence.unshift(...dist.evidence.investor);
			analystEvidence.unshift(...dist.evidence.analyst);
		}
	}

	const flags = [
		...baseFlags,
		...(metrics?.flags?.length
			? metrics.flags.map((f) => {
				const cleaned = String(f || "").replace(/^metrics:/, "");
				return cleaned ? `metrics:${cleaned}` : "";
			})
			: []),
	].filter(Boolean);

	const understanding: ExcelSheetUnderstandingV1 = {
		schema_version: "excel_sheet_understanding_v1",
		sheet_name: input.sheetName,
		detected_type: detected.type,
		confidence: Math.max(0.05, Math.min(1, detected.confidence)),
		segment_key: input.segmentKey,
		metrics_v1: metrics,
		structure: {
			row_count: typeof input.rowCount === "number" ? input.rowCount : undefined,
			header_count: Array.isArray(input.headers) ? input.headers.length : undefined,
			headers_sample: headersSample,
			row_labels_sample: colALabels,
			numeric_columns_sample: numericColumnsSample,
		},
		time: {
			granularity,
			headers_detected: timeHeadersDetected,
			time_headers_sample: timeHeadersSample,
		},
		units: {
			currency_hint: currencyHint,
		},
		flags,
	};

	const rowCountText = typeof understanding.structure.row_count === "number" ? `${understanding.structure.row_count}` : "an unknown number of";
	const headerCountText = typeof understanding.structure.header_count === "number" ? `${understanding.structure.header_count}` : "an unknown number of";
	const typeLabel = understanding.detected_type.replace(/_/g, " ");
	const timeText = understanding.time.headers_detected
		? `It appears to be organized as a ${understanding.time.granularity} time series.`
		: "Time-series headers were not clearly detected.";
	const buildInvestorHeadline = (): string => {
		const m = understanding.metrics_v1;
		if (understanding.detected_type === "use_of_funds" && m?.distribution) {
			const total = formatCompactNumber(m.distribution.total_value, understanding.units.currency_hint);
			const top1 = m.distribution.top_categories?.[0];
			const topText = top1
				? `Largest line item is ${top1.label} at ${formatCompactNumber(top1.value, understanding.units.currency_hint)} (${formatPct(top1.pct_of_total)} of total).`
				: "";
			const pctOk = m.distribution.percent_column_sum
				? m.distribution.percent_column_sum.within_tolerance
					? "Percent column sums look consistent."
					: "Percent column does not sum cleanly; treat the % breakdown as suspect until verified."
				: "";
			return [`Use of funds totals ${total}.`, topText, pctOk].filter(Boolean).join(" ").trim();
		}
		if (m?.key_series && m.key_series.start_value != null && m.key_series.end_value != null) {
			const startTxt = formatCompactNumber(m.key_series.start_value, understanding.units.currency_hint);
			const endTxt = formatCompactNumber(m.key_series.end_value, understanding.units.currency_hint);
			const growthTxt = typeof m.key_series.growth_pct === "number" ? ` (${formatPct(m.key_series.growth_pct)} change)` : "";
			const trend =
				typeof m.key_series.growth_pct === "number"
					? m.key_series.growth_pct > 0.2
						? "This suggests strong growth over the period."
						: m.key_series.growth_pct < -0.1
							? "This suggests a declining trajectory over the period."
							: "This suggests relatively stable performance over the period."
					: "";
			return [
				`${m.key_series.label} changes from ${startTxt} to ${endTxt} from ${m.key_series.start_period_label ?? "(start)"} to ${m.key_series.end_period_label ?? "(end)"}${growthTxt}.`,
				trend,
				m.key_series.missing_ratio > 0.35 ? "Note: many period values are missing." : "",
			]
				.filter(Boolean)
				.join(" ")
				.trim();
		}
		return "";
	};

	const investorHeadline = buildInvestorHeadline();
	const investor_summary = [
		investorHeadline,
		`${understanding.sheet_name} is classified as ${typeLabel}.`,
		timeText,
		understanding.units.currency_hint ? `Currency hint: ${understanding.units.currency_hint}.` : "",
		// Keep a secondary evidence sentence (if present) to help UI previews.
		investorEvidence.length && investorEvidence[0] !== investorHeadline ? investorEvidence[0] : "",
		`Structure: ${rowCountText} rows, ${headerCountText} columns.`,
	]
		.filter(Boolean)
		.join(" ")
		.trim();

	const analyst_summary = [
		`Detected type=${understanding.detected_type} (confidence=${understanding.confidence.toFixed(2)}), segment_key=${understanding.segment_key ?? "(none)"}.`,
		understanding.metrics_v1
			? `metrics_v1(source=${understanding.metrics_v1.source}): numeric_ratio=${understanding.metrics_v1.quality.numeric_ratio.toFixed(2)}.`
			: "metrics_v1: (none)",
		`Headers sample: ${understanding.structure.headers_sample.slice(0, 10).join(" | ") || "(none)"}.`,
		understanding.structure.row_labels_sample.length
			? `Row label sample (col A): ${understanding.structure.row_labels_sample.join(" | ")}.`
			: "Row label sample: (none detected from grid preview).",
		analystEvidence.length ? analystEvidence[0] : "",
		`Flags: ${understanding.flags.join(", ") || "(none)"}.`,
	]
		.filter(Boolean)
		.join(" ")
		.trim();

	return { understanding, investor_summary, analyst_summary };
}

function normalizeTextList(value: unknown, maxItems: number): string[] {
	const arr = Array.isArray(value) ? value : [];
	const out: string[] = [];
	for (const item of arr) {
		const t = cleanTextForClassification(item).trim();
		if (!t) continue;
		out.push(t);
		if (out.length >= maxItems) break;
	}
	return out;
}

function classifySegmentKeyFromText(textRaw: string, defaultKey: SegmentKey = "unknown"): SegmentKey {
	const text = String(textRaw || "")
		.toLowerCase()
		.replace(/\s+/g, " ")
		.trim();
	if (!text) return defaultKey;

	// API-aligned keyword sets (keep in sync with apps/api classifySegment headingSets).
	const keywordSets: Record<SegmentKey, string[]> = {
		overview: ["overview", "summary", "executive summary"],
		problem: ["problem", "pain", "challenge", "issue", "gap", "why this matters"],
		solution: ["solution", "approach", "value proposition", "why us"],
		product: ["product", "products", "technology", "features", "feature", "demo", "roadmap", "how it works"],
		market: ["market", "tam", "sam", "som", "opportunity", "segment", "sizing", "cagr"],
		traction: [
			"traction",
			"growth",
			"users",
			"customers",
			"mrr",
			"arr",
			"revenue",
			"retention",
			"pipeline",
			"gmv",
			"kpi",
			"conversion",
			"demo-to-close",
			"demo to close",
			"lift",
		],
		business_model: [
			"business model",
			"pricing",
			"revenue model",
			"unit economics",
			"how we make money",
			"saas",
			"platform",
			"add-ons",
			"addons",
			"subscription",
		],
		distribution: [
			"distribution",
			"go-to-market",
			"go to market",
			"gtm",
			"channels",
			"sales",
			"partnerships",
			"marketing",
			"reseller",
			"partners",
			"channel",
		],
		team: ["team", "founder", "ceo", "cto", "cfo", "bio", "leadership", "advisors", "founders", "meet our team"],
		competition: ["competition", "competitor", "alternative", "compare", "landscape", "moat"],
		risks: ["risk", "challenge", "threat", "mitigation", "compliance", "regulation", "limitation"],
		financials: [
			"financial",
			"financial strategy",
			"profit",
			"loss",
			"p&l",
			"balance",
			"cash",
			"projection",
			"forecast",
			"projections",
			"ebitda",
			"budget",
			"expenses",
			"gross margin",
			"revenue",
			"margin",
			"unit economics",
		],
		raise_terms: ["raise", "funding", "round", "terms", "cap table", "valuation", "use of funds", "investment"],
		exit: ["exit", "exit strategy", "acquisition", "m&a", "strategic options", "acquirer", "acquirers", "strategic buyers"],
		unknown: [],
	};

	const weights: Record<SegmentKey, number> = {
		overview: 1,
		problem: 3,
		solution: 3,
		product: 3,
		market: 3,
		traction: 3,
		business_model: 2,
		distribution: 2,
		team: 2,
		competition: 2,
		risks: 2,
		financials: 3,
		raise_terms: 3,
		exit: 2,
		unknown: 0,
	};

	const scoreByKey = new Map<SegmentKey, number>();
	for (const [key, phrases] of Object.entries(keywordSets) as Array<[SegmentKey, string[]]>) {
		if (key === "unknown") continue;
		let score = 0;
		for (const phrase of phrases) {
			if (!phrase) continue;
			if (text.includes(phrase.toLowerCase())) score += weights[key];
		}
		if (score > 0) scoreByKey.set(key, score);
	}

	let best: SegmentKey = defaultKey;
	let bestScore = 0;
	let secondScore = 0;
	for (const [k, s] of scoreByKey.entries()) {
		if (s > bestScore) {
			secondScore = bestScore;
			bestScore = s;
			best = k;
		} else if (s > secondScore) {
			secondScore = s;
		}
	}

	// Confidence gating: keep deterministic, but avoid over-assigning from weak signal.
	const MIN_SCORE = 2;
	const MIN_MARGIN = 1;
	if (bestScore < MIN_SCORE) return defaultKey;
	if (secondScore > 0 && bestScore < secondScore + MIN_MARGIN) return defaultKey;
	return best;
}

export function inferSegmentKeyFromStructured(params: {
	structuredJson: unknown;
	source: string;
	documentTitle?: string | null;
}): SegmentKey {
	const sj = (params.structuredJson ?? {}) as any;
	const docTitle = typeof params.documentTitle === "string" ? params.documentTitle : "";
	const title = cleanTextForClassification(sj?.title);
	const textSnippet = cleanTextForClassification(sj?.text_snippet);
	const heading = cleanTextForClassification(sj?.heading);
	const bullets = normalizeTextList(sj?.bullets, 20).join("\n");
	const paragraphs = normalizeTextList(sj?.paragraphs, 20).join("\n");
	const sheetName = cleanTextForClassification(sj?.sheet_name);
	const headers = normalizeTextList(sj?.headers, 20).join("\n");
	const numericColumns = normalizeTextList(sj?.numeric_columns, 20).join("\n");
	const sampleRows = Array.isArray(sj?.sample_rows) ? sj.sample_rows : [];
	const firstRowPreview = Array.isArray(sampleRows?.[0])
		? sampleRows[0].slice(0, 20).map((v: any) => cleanTextForClassification(v)).filter(Boolean).join(" ")
		: "";

	const combined = [
		docTitle,
		title,
		heading,
		textSnippet,
		bullets,
		paragraphs,
		sheetName ? `sheet: ${sheetName}` : "",
		headers ? `headers: ${headers}` : "",
		numericColumns ? `numeric: ${numericColumns}` : "",
		firstRowPreview ? `row0: ${firstRowPreview}` : "",
	]
		.filter(Boolean)
		.join("\n");

	// Excel defaults to financials unless there's a stronger signal.
	if (params.source === "structured_excel") {
		const inferred = classifySegmentKeyFromText(combined, "financials");
		return inferred || "financials";
	}

	return classifySegmentKeyFromText(combined, "unknown");
}

export async function resegmentStructuredSyntheticAssets(params: {
	pool: Pool;
	documentId: string;
	documentTitle?: string | null;
}): Promise<{ updated_assets: number; updated_extractions: number }> {
	const sources = ["structured_word", "structured_powerpoint", "structured_excel"];
	const { rows } = await params.pool.query<{
		id: string;
		quality_flags: any;
		structured_json: any;
	}> (
		`SELECT va.id,
		        va.quality_flags,
		        ve.structured_json
		   FROM visual_assets va
		   LEFT JOIN visual_extractions ve
		     ON ve.visual_asset_id = va.id
		    AND ve.extractor_version = va.extractor_version
		  WHERE va.document_id = $1
		    AND (va.quality_flags->>'source') = ANY($2)`,
		[sanitizeText(params.documentId), sources]
	);

	let updatedAssets = 0;
	let updatedExtractions = 0;
	for (const row of rows) {
		const source = typeof row?.quality_flags?.source === "string" ? row.quality_flags.source : "";
		if (!source) continue;
		const inferred = inferSegmentKeyFromStructured({
			structuredJson: row.structured_json,
			source,
			documentTitle: params.documentTitle ?? null,
		});
		if (!inferred) continue;

		const seg = String(inferred);
		// Update visual_assets.quality_flags.segment_key
		const res1 = await params.pool.query(
			`UPDATE visual_assets
			    SET quality_flags = jsonb_set(COALESCE(quality_flags, '{}'::jsonb), '{segment_key}', to_jsonb($2::text), true)
			  WHERE id = $1`,
			[sanitizeText(row.id), seg]
		);
		updatedAssets += (res1 as any)?.rowCount ?? 0;

		// Update visual_extractions.structured_json.segment_key (debug/secondary)
		const res2 = await params.pool.query(
			`UPDATE visual_extractions
			    SET structured_json = jsonb_set(COALESCE(structured_json, '{}'::jsonb), '{segment_key}', to_jsonb($2::text), true)
			  WHERE visual_asset_id = $1`,
			[sanitizeText(row.id), seg]
		);
		updatedExtractions += (res2 as any)?.rowCount ?? 0;
	}

	return { updated_assets: updatedAssets, updated_extractions: updatedExtractions };
}

export async function applyVisionHintsToStructuredPowerpointSlides(params: {
	pool: Pool;
	dealId?: string;
	jobId?: string;
	documentId: string;
	pageImageUris: string[];
	structuredExtractorVersion?: string;
	visionConfig: VisionExtractorConfig;
	visionRuntime?: VisionJobRuntime;
	env?: NodeJS.ProcessEnv;
	logger?: LogLike;
	forceReextract?: boolean;
	callVisionWorkerWithRetries?: typeof callVisionWorkerWithRetries;
}): Promise<{
	attempted: number;
	updated: number;
	skipped_has_content: number;
	skipped_existing: number;
	skipped_no_uri: number;
	skipped_has_text: number;
	skipped_has_segment: number;
	errors: number;
}> {
	const env = params.env ?? process.env;
	const logger = params.logger ?? console;
	const dealId = typeof params.dealId === "string" ? params.dealId : "";
	const jobId = typeof params.jobId === "string" ? params.jobId : "";
	const forceReextract = Boolean(params.forceReextract);
	const callVisionWithRetries = params.callVisionWorkerWithRetries ?? callVisionWorkerWithRetries;
	const structuredExtractorVersion = params.structuredExtractorVersion ?? "structured_native_v1";
	// Force-vu is request-mode only; all canonical/dedupe is done on baseExtractorVersion.
	const baseExtractorVersion = String(params.visionConfig?.extractorVersion ?? "").replace(/_force_vu$/, "");
	const forcedExtractorVersion = `${baseExtractorVersion}_force_vu`;
	const extractorVersionsForDedupe = [baseExtractorVersion, forcedExtractorVersion].filter(Boolean);
	const persistSegmentMinConf = (() => {
		const raw = env.STRUCTURED_VISION_HINT_PERSIST_MIN_CONFIDENCE;
		const parsed = typeof raw === "string" ? Number(raw) : Number.NaN;
		if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) return parsed;
		return 0.55;
	})();

	const enableStructuredVisionHints = parseBool(
		env.ENABLE_STRUCTURED_VISION_HINTS ?? ((env.VISION_BASE_URL || env.VISION_WORKER_URL) && String(env.VISION_BASE_URL || env.VISION_WORKER_URL).trim() ? "1" : "0")
	);
	if (!enableStructuredVisionHints) {
		return {
			attempted: 0,
			updated: 0,
			skipped_has_content: 0,
			skipped_existing: 0,
			skipped_no_uri: 0,
			skipped_has_text: 0,
			skipped_has_segment: 0,
			errors: 0,
		};
	}
	if (!params.visionConfig?.enabled) {
		return {
			attempted: 0,
			updated: 0,
			skipped_has_content: 0,
			skipped_existing: 0,
			skipped_no_uri: 0,
			skipped_has_text: 0,
			skipped_has_segment: 0,
			errors: 0,
		};
	}
	if (!Array.isArray(params.pageImageUris) || params.pageImageUris.length === 0) {
		return {
			attempted: 0,
			updated: 0,
			skipped_has_content: 0,
			skipped_existing: 0,
			skipped_no_uri: 0,
			skipped_has_text: 0,
			skipped_has_segment: 0,
			errors: 0,
		};
	}

	// Candidates: structured_powerpoint synthetic assets with unknown segment and no prior vision_understanding_v1.
	// We do additional “no-text” gating in JS to avoid over-writing legitimate structured classification.
	const { rows } = await params.pool.query<{
		visual_asset_id: string;
		visual_extraction_id: string;
		page_index: number;
		quality_flags: any;
		structured_json: any;
	}>(
		`
			SELECT va.id AS visual_asset_id,
			       ve.id AS visual_extraction_id,
			       va.page_index,
			       va.quality_flags,
			       ve.structured_json
			  FROM visual_assets va
			  JOIN visual_extractions ve
			    ON ve.visual_asset_id = va.id
			   AND ve.extractor_version = va.extractor_version
			 WHERE va.document_id = $1
			   AND va.extractor_version = $2
			   AND (va.quality_flags->>'source') = 'structured_powerpoint'
			   AND COALESCE(va.quality_flags->>'segment_key','unknown') = 'unknown'
			   AND COALESCE(ve.structured_json->>'segment_key','unknown') = 'unknown'
			   AND NOT (ve.structured_json ? 'vision_understanding_v1')
			 ORDER BY va.page_index ASC
			 LIMIT 200
		`,
		[sanitizeText(params.documentId), sanitizeText(structuredExtractorVersion)]
	);

	let attempted = 0;
	let updated = 0;
	let skippedHasContent = 0;
	let skippedExisting = 0;
	let skippedNoUri = 0;
	let skippedHasText = 0;
	let skippedHasSegment = 0;
	let errors = 0;

	const hasMeaningfulContent = (slide: any): boolean => {
		const sj = (slide ?? {}) as any;
		const title = typeof sj?.title === "string" ? sj.title.trim() : "";
		if (title.length >= 3) return true;

		const bullets = Array.isArray(sj?.bullets) ? sj.bullets : [];
		const bulletCount = bullets.filter((b: any) => typeof b === "string" && b.trim().length >= 3).length;
		if (bulletCount >= 1) return true;

		const notes = typeof sj?.notes === "string" ? sj.notes.trim() : "";
		if (notes.length >= 10) return true;

		const snippet = typeof sj?.text_snippet === "string" ? sj.text_snippet.trim() : "";
		if (snippet.length >= 20) return true;

		// Structured objects: some extractors may include table/image metadata arrays.
		const hasStructuredObjects = (() => {
			const candidates: unknown[] = [sj?.tables, sj?.images, sj?.charts, sj?.shapes, sj?.objects, sj?.media];
			for (const c of candidates) {
				if (Array.isArray(c) && c.length > 0) return true;
				if (c && typeof c === "object" && !Array.isArray(c) && Object.keys(c as any).length > 0) return true;
			}
			return false;
		})();
		return hasStructuredObjects;
	};

	for (const row of rows ?? []) {
		const pageIndex = typeof row.page_index === "number" ? row.page_index : -1;
		if (pageIndex < 0) continue;
		const pageImageUri = pageIndex < params.pageImageUris.length ? params.pageImageUris[pageIndex] : null;
		if (!pageImageUri) {
			skippedNoUri += 1;
			continue;
		}

		const qf = (row.quality_flags ?? {}) as any;
		const existingSeg = coerceSegmentKey(qf?.segment_key);
		if (existingSeg && existingSeg !== "unknown") {
			skippedHasSegment += 1;
			continue;
		}

		const sj = (row.structured_json ?? {}) as any;
		const kind = typeof sj?.kind === "string" ? sj.kind : "";
		if (kind !== "powerpoint_slide") continue;
		const alreadyHasVu = Boolean(sj && typeof sj === "object" && (sj as any).vision_understanding_v1 != null);
		const alreadyHasSlideTypeHint = (() => {
			const st = (sj as any).resolved_slide_type ?? (sj as any).slide_type ?? (sj as any).slide_type_hint;
			return typeof st === "string" && st.trim().length > 0;
		})();
		const sjSegment = coerceSegmentKey(typeof (sj as any).segment_key === "string" ? (sj as any).segment_key : null);
		const alreadyHasSegmentHint = Boolean(sjSegment && sjSegment !== "unknown");
		if (!forceReextract && (alreadyHasVu || alreadyHasSlideTypeHint || alreadyHasSegmentHint)) {
			skippedExisting += 1;
			continue;
		}

		// Tight gating: we ONLY run vision hints when content is missing.
		// Do not call vision just because classification is unknown.
		if (hasMeaningfulContent(sj)) {
			skippedHasContent += 1;
			continue;
		}
		// Intentionally do not gate on having title/bullets/text: if deterministic structured classification
		// still produced segment_key=unknown, try vision-understanding as a rescue signal.

		// Strict rerun guard: if the per-page vision extraction already exists (either base or forced
		// version), do not call the vision worker again.
		if (!forceReextract) {
			try {
				const { rows: existing } = await params.pool.query(
					`
						SELECT 1
						  FROM visual_assets
						 WHERE document_id = $1
						   AND page_index = $2
						   AND extractor_version = ANY($3::text[])
						 LIMIT 1
					`,
					[sanitizeText(params.documentId), pageIndex, extractorVersionsForDedupe]
				);
				if ((existing?.length ?? 0) > 0) {
					skippedExisting += 1;
					continue;
				}
			} catch {
				// best-effort; if the guard query fails, continue with the vision call.
			}
		}

		attempted += 1;
		try {
			const { response: visionResp } = await callVisionWithRetries(
				params.visionConfig,
				{
					document_id: params.documentId,
					page_index: pageIndex,
					image_uri: pageImageUri,
					// Request-mode only; do not treat this as a canonical persisted extractor version.
					extractor_version: forcedExtractorVersion,
				},
				{
					timeoutsMs: [20_000],
					runtime: params.visionRuntime,
					logger,
					logMeta: {
						caller: "structured_ppt_vision_hints",
						stage: "structured_powerpoint_vision_hints",
						deal_id: String(dealId ?? ""),
						job_id: String(jobId ?? ""),
						document_id: String(params.documentId ?? ""),
						page_index: pageIndex,
						structured_extractor_version: String(structuredExtractorVersion ?? ""),
						base_extractor_version: String(baseExtractorVersion ?? ""),
						forced_extractor_version: String(forcedExtractorVersion ?? ""),
					},
				}
			);

			const bestVu = (() => {
				const assets = Array.isArray(visionResp?.assets) ? visionResp!.assets : [];
				let best: any | null = null;
				let bestConf = -1;
				for (const va of assets) {
					const sj2 = (va as any)?.extraction?.structured_json;
					const vu = sj2 && typeof sj2 === "object" ? (sj2 as any).vision_understanding_v1 : null;
					if (!vu || typeof vu !== "object") continue;
					const confRaw = (vu as any).confidence;
					const conf = typeof confRaw === "number" && Number.isFinite(confRaw) ? confRaw : 0;
					if (conf > bestConf) {
						bestConf = conf;
						best = vu;
					}
				}
				return best;
			})();
			const vuToPersist: any = (() => {
				if (bestVu && typeof bestVu === "object") return { ...bestVu, extractor_version: baseExtractorVersion };
				return {
					segment_hint: "unknown",
					confidence: 0,
					note: "no_vision_understanding_v1_found",
					extractor_version: baseExtractorVersion,
				};
			})();

			const hintSeg = coerceSegmentKey(typeof vuToPersist.segment_hint === "string" ? vuToPersist.segment_hint : null);
			const hintConfRaw = vuToPersist.confidence;
			const hintConf = typeof hintConfRaw === "number" && Number.isFinite(hintConfRaw) ? hintConfRaw : null;
			const persistSegment = Boolean(hintSeg && hintSeg !== "unknown" && hintConf != null && hintConf >= persistSegmentMinConf);

			// Always persist vision_understanding_v1; persist segment_key only if hint is strong.
			await params.pool.query(
				`
					UPDATE visual_extractions
					   SET structured_json = jsonb_set(COALESCE(structured_json, '{}'::jsonb), '{vision_understanding_v1}', $2::jsonb, true)
					 WHERE id = $1
				`,
				[sanitizeText(row.visual_extraction_id), JSON.stringify(vuToPersist)]
			);

			if (persistSegment) {
				// Write-through a confident segment assignment.
				await params.pool.query(
					`UPDATE visual_extractions
					   SET structured_json = jsonb_set(COALESCE(structured_json, '{}'::jsonb), '{segment_key}', to_jsonb($2::text), true)
					 WHERE id = $1`,
					[sanitizeText(row.visual_extraction_id), hintSeg]
				);

				await params.pool.query(
					`
						UPDATE visual_assets
						   SET quality_flags = jsonb_set(
								jsonb_set(
									jsonb_set(
										jsonb_set(COALESCE(quality_flags, '{}'::jsonb), '{segment_key}', to_jsonb($2::text), true),
										'{segment_source}', to_jsonb('structured_vision_understanding_v1'::text), true
									),
									'{accepted_v1}', 'true'::jsonb, true
								),
								'{accepted_reason_v1}', to_jsonb('structured_powerpoint_no_text_vision_hint'::text), true
							 )
						 WHERE id = $1
					`,
					[sanitizeText(row.visual_asset_id), hintSeg]
				);
				if (hintConf != null) {
					await params.pool.query(
						`UPDATE visual_assets
						   SET quality_flags = jsonb_set(COALESCE(quality_flags, '{}'::jsonb), '{segment_confidence}', to_jsonb($2::numeric), true)
						 WHERE id = $1`,
						[sanitizeText(row.visual_asset_id), hintConf]
					);
				}
				updated += 1;
			}
		} catch (err) {
			errors += 1;
			logger.warn(
				`[extract_visuals] structured PowerPoint vision hint failed doc=${params.documentId} page=${pageIndex}: ${
					err instanceof Error ? err.message : String(err)
				}`
			);
		}
	}

	return {
		attempted,
		updated,
		skipped_has_content: skippedHasContent,
		skipped_existing: skippedExisting,
		skipped_no_uri: skippedNoUri,
		skipped_has_text: skippedHasText,
		skipped_has_segment: skippedHasSegment,
		errors,
	};
}

function buildSyntheticAssets(params: {
	docKind: string;
	structuredData: any;
	fullContent: any;
}): SyntheticAssetBuild[] {
	const out: SyntheticAssetBuild[] = [];
	const kind = params.docKind;

	const coalesceWordSections = (sectionsIn: any[]): any[] => {
		// Goal: preserve text fidelity while producing a bounded number of nodes suitable for
		// per-segment scoring. We bucket paragraph-level text into segment-specific chunks.
		const MAX_SECTIONS_SCANNED = 200;
		const MAX_CHUNKS_EMITTED = 25;
		const MAX_PARAGRAPHS_PER_CHUNK = 18;
		const MAX_CLASSIFY_TEXT_CHARS = 2400;
		const MAX_TEXT_SNIPPET_CHARS = 900;

		type NormSection = {
			heading: string | null;
			level: number | null;
			paragraphs: string[];
			tableRows: unknown[];
			textSnippet: string;
			segmentKey: SegmentKey;
		};

		const normalizeSection = (section: any): NormSection | null => {
			const heading = cleanTextForClassification(section?.heading) || null;
			const paragraphsRawUnknown = Array.isArray(section?.paragraphs) ? section.paragraphs : [];
			const paragraphsRaw = paragraphsRawUnknown
				.map((p: unknown) => toTextLoose(p))
				.map((p: string) => p.trim())
				.filter(Boolean);
			const paragraphs = normalizeTextList(paragraphsRaw, 30);
			const tableRows = Array.isArray(section?.tables?.[0]?.rows) ? section.tables[0].rows.slice(0, 5) : [];
			const sectionText = cleanTextForClassification(section?.text);
			const textSnippetBase = sectionText || paragraphs.join(" ");
			const textSnippet = textSnippetBase ? textSnippetBase.slice(0, MAX_TEXT_SNIPPET_CHARS) : "";

			if (isEmptyWordSection({ heading, textSnippet, paragraphs, tableRows })) return null;

			const classifyText = [heading ?? "", textSnippet, paragraphs.join("\n")].filter(Boolean).join("\n");
			const segmentKey = classifySegmentKeyFromText(classifyText, "unknown");
			return {
				heading,
				level: typeof section?.level === "number" ? section.level : null,
				paragraphs,
				tableRows,
				textSnippet,
				segmentKey,
			};
		};

		type SegmentBucket = {
			headings: string[];
			paragraphs: string[];
			unit_count: number;
		};

		const tableItems: any[] = [];
		const buckets = new Map<SegmentKey, SegmentBucket>();
		const getBucket = (k: SegmentKey): SegmentBucket => {
			const existing = buckets.get(k);
			if (existing) return existing;
			const created: SegmentBucket = { headings: [], paragraphs: [], unit_count: 0 };
			buckets.set(k, created);
			return created;
		};

		const sections = sectionsIn.slice(0, MAX_SECTIONS_SCANNED).map(normalizeSection).filter(Boolean) as NormSection[];
		for (const s of sections) {
			// Emit tables as their own items (high signal, often financials/traction).
			if (Array.isArray(s.tableRows) && s.tableRows.length > 0) {
				const cellTexts: string[] = [];
				for (const row of s.tableRows.slice(0, 6) as any[]) {
					if (!Array.isArray(row)) continue;
					for (const cell of row.slice(0, 10)) {
						const t = cleanTextForClassification(cell);
						if (t) cellTexts.push(t);
						if (cellTexts.length >= 60) break;
					}
					if (cellTexts.length >= 60) break;
				}
				const classifyText = [s.heading ?? "", cellTexts.join(" "), s.textSnippet].filter(Boolean).join("\n").slice(0, MAX_CLASSIFY_TEXT_CHARS);
				const segmentKey = classifySegmentKeyFromText(classifyText, "unknown");
				tableItems.push({
					kind: "word_section",
					segment_key: segmentKey,
					heading: s.heading,
					level: s.level,
					text_snippet: s.textSnippet,
					paragraphs: [],
					table_rows: s.tableRows,
					member_count: 1,
					member_segment_keys: [segmentKey],
				});
			}

			const headingKey = s.heading ? classifySegmentKeyFromText(s.heading, "unknown") : "unknown";
			const unitTexts = s.paragraphs.length > 0 ? s.paragraphs : s.textSnippet ? [s.textSnippet] : [];
			for (const unit of unitTexts) {
				const combined = [s.heading ?? "", unit].filter(Boolean).join("\n");
				let seg = classifySegmentKeyFromText(combined, "unknown");
				if (seg === "unknown" && headingKey !== "unknown") seg = headingKey;
				const bucket = getBucket(seg);
				if (s.heading) bucket.headings.push(s.heading);
				bucket.paragraphs.push(unit);
				bucket.unit_count += 1;
			}
		}

		const outItems: any[] = [];
		// Prefer deterministic segment order; emit unknown last.
		const orderedSegments: SegmentKey[] = [...SEGMENT_KEYS];
		for (const seg of orderedSegments) {
			const bucket = buckets.get(seg);
			if (!bucket) continue;
			const headings = normalizeTextList(bucket.headings, 12);
			// Split into multiple chunks if needed.
			let chunkIndex = 0;
			let cursor = 0;
			while (cursor < bucket.paragraphs.length && outItems.length < MAX_CHUNKS_EMITTED) {
				chunkIndex += 1;
				const paras = bucket.paragraphs.slice(cursor, cursor + MAX_PARAGRAPHS_PER_CHUNK);
				cursor += MAX_PARAGRAPHS_PER_CHUNK;
				const paragraphs = normalizeTextList(paras, MAX_PARAGRAPHS_PER_CHUNK);
				const heading = seg !== "unknown" ? seg : headings[0] ?? null;
				const textSnippet = cleanTextForClassification(paragraphs.join("\n")).slice(0, MAX_TEXT_SNIPPET_CHARS);
				const classifyText = [headings.join("\n"), textSnippet, paragraphs.join("\n")]
					.filter(Boolean)
					.join("\n")
					.slice(0, MAX_CLASSIFY_TEXT_CHARS);
				const stableSeg = seg !== "unknown" ? seg : classifySegmentKeyFromText(classifyText, "unknown");

				outItems.push({
					kind: "word_section",
					segment_key: stableSeg,
					heading,
					headings,
					level: null,
					text_snippet: textSnippet,
					paragraphs,
					table_rows: [],
					member_count: paragraphs.length,
					member_segment_keys: Array.from({ length: paragraphs.length }).map(() => stableSeg),
					chunk_index: chunkIndex,
				});
			}
		}

		return [...tableItems, ...outItems].slice(0, MAX_CHUNKS_EMITTED);
	};

	const hasAnyTableContent = (rows: unknown): boolean => {
		if (!Array.isArray(rows) || rows.length === 0) return false;
		for (const row of rows) {
			if (!Array.isArray(row)) continue;
			for (const cell of row) {
				const t = cleanTextForClassification(cell);
				if (t) return true;
			}
		}
		return false;
	};

	const isEmptyWordSection = (section: {
		heading: string | null;
		textSnippet: string;
		paragraphs: string[];
		tableRows: unknown[];
	}): boolean => {
		const hasHeading = typeof section.heading === "string" && section.heading.trim().length > 0;
		const hasSnippet = typeof section.textSnippet === "string" && section.textSnippet.trim().length > 0;
		const hasParagraphs = Array.isArray(section.paragraphs) && section.paragraphs.some((p) => typeof p === "string" && p.trim().length > 0);
		const hasTable = hasAnyTableContent(section.tableRows);
		return !hasHeading && !hasSnippet && !hasParagraphs && !hasTable;
	};

	if (kind === "excel") {
		const forceExcelSegmentKey = (segmentKey: SegmentKey, classifyText: string): SegmentKey => {
			const t = (classifyText ?? "").toLowerCase();
			const financialSignal = /\b(revenue|revenues|cogs|cost of goods|gross margin|gross profit|expenses|opex|operating expense|p\s*&\s*l|income statement|ebitda|cash balance|cashflow|cash flow|burn|runway|balance sheet|arr|mrr|unit economics)\b/.test(
				t
			);
			const raiseSignal = /\b(cap table|captable|ownership|dilution|valuation|pre-money|post-money|round|financing|raise|use of funds|allocation of funds|term sheet|safe\b|convertible note|note\b)\b/.test(
				t
			);
			if (financialSignal && !raiseSignal) return "financials";
			if (raiseSignal && !financialSignal) return "raise_terms";
			return segmentKey;
		};

		const sheets = Array.isArray(params.fullContent?.sheets) ? params.fullContent.sheets : [];
		sheets.forEach((sheet: any, idx: number) => {
			const sheetName = sheet?.name ?? `Sheet ${idx + 1}`;
			const sheetPageIndex = idx;
			const headers = Array.isArray(sheet?.headers) ? sheet.headers.slice(0, 50) : [];
			const rowCount = typeof sheet?.summary?.totalRows === "number" ? sheet.summary.totalRows : (Array.isArray(sheet?.rows) ? sheet.rows.length : 0);
			const numericColumns = Array.isArray(sheet?.summary?.numericColumns) ? sheet.summary.numericColumns.slice(0, 25) : [];
			const tables = Array.isArray(sheet?.tables) ? sheet.tables : [];
			const gridCells = Array.isArray(sheet?.gridPreview?.cells) ? sheet.gridPreview.cells : [];

			const gridPreviewText = gridCells
				.slice(0, 60)
				.map((c: any) => cleanTextForClassification(c?.w ?? c?.v ?? c?.f))
				.filter(Boolean)
				.join(" ")
				.slice(0, 800);

			// Prefer table-derived structured assets (more signal) if present.
			if (tables.length > 0) {
				for (const [tableIdx, t] of tables.slice(0, 6).entries()) {
					const cols = Array.isArray(t?.value_cols) ? t.value_cols : [];
					const rowLabels = Array.isArray(t?.rows) ? t.rows.slice(0, 10).map((r: any) => cleanTextForClassification(r?.label)).filter(Boolean) : [];
					const classifyText = [
						sheetName ? `sheet: ${sheetName}` : "",
						t?.name ? `table: ${t.name}` : "",
						cols.length ? `cols: ${cols.map((c: any) => c?.header ?? c?.col).filter(Boolean).join(" ")}` : "",
						rowLabels.length ? `rows: ${rowLabels.join(" ")}` : "",
					]
						.filter(Boolean)
						.join("\n");
					const segmentKey = forceExcelSegmentKey(classifySegmentKeyFromText(classifyText, "financials"), classifyText);
					const summary = buildExcelSheetUnderstandingV1({
						sheetName,
						segmentKey,
						headers: normalizeTextList(cols.map((c: any) => c?.header ?? c?.col), 40),
						rowCount: Array.isArray(t?.rows) ? t.rows.length : undefined,
						numericColumns: normalizeTextList(cols.map((c: any) => c?.header ?? c?.col), 25),
						gridCells,
						table: t as any,
					});
					const structuredJson = {
						kind: "excel_sheet",
						segment_key: segmentKey,
						sheet_name: sheetName,
						table: t,
						summary: sheet?.summary ?? {},
						understanding_v1: summary.understanding,
						summary_text_investor: summary.investor_summary,
						summary_text_analyst: summary.analyst_summary,
					};
					out.push({
						pageIndex: sheetPageIndex,
						asset: {
							asset_type: "table",
							bbox: { x: 0, y: 0, w: 1, h: 1 },
							confidence: 0.9,
							quality_flags: { source: "structured_excel", segment_key: segmentKey },
							image_uri: null,
							image_hash: hashKey([params.docKind, sheetName, t?.name ?? tableIdx, "table"]),
							extraction: {
								ocr_text: null,
								ocr_blocks: [],
								structured_json: structuredJson,
								units: null,
								labels: { source: "structured_excel" },
								model_version: null,
								confidence: 0.9,
							},
						},
					});
				}
			}

			// Fallback: emit a sheet-summary synthetic asset.
			const classifyText = [
				sheetName ? `sheet: ${sheetName}` : "",
				headers?.length ? `headers: ${headers.join(" ")}` : "",
				numericColumns?.length ? `numeric: ${numericColumns.join(" ")}` : "",
				gridPreviewText ? `preview: ${gridPreviewText}` : "",
			]
				.filter(Boolean)
				.join("\n");
			const segmentKey = forceExcelSegmentKey(classifySegmentKeyFromText(classifyText, "financials"), classifyText);
			const summary = buildExcelSheetUnderstandingV1({
				sheetName,
				segmentKey,
				headers,
				rowCount,
				numericColumns,
				gridCells,
				sheetRows: Array.isArray(sheet?.rows) ? (sheet.rows as any[]) : undefined,
			});
			const structuredJson = {
				kind: "excel_sheet",
				segment_key: segmentKey,
				sheet_name: sheetName,
				headers,
				row_count: rowCount,
				grid_preview: { maxRows: sheet?.gridPreview?.maxRows, maxCols: sheet?.gridPreview?.maxCols, cells: gridCells.slice(0, 200) },
				summary: sheet?.summary ?? {},
				understanding_v1: summary.understanding,
				summary_text_investor: summary.investor_summary,
				summary_text_analyst: summary.analyst_summary,
			};
			out.push({
				pageIndex: sheetPageIndex,
				asset: {
					asset_type: "table",
					bbox: { x: 0, y: 0, w: 1, h: 1 },
					confidence: 0.9,
					quality_flags: { source: "structured_excel", segment_key: segmentKey },
					image_uri: null,
					image_hash: hashKey([params.docKind, sheetName, "sheet"]),
					extraction: {
						ocr_text: null,
						ocr_blocks: [],
						structured_json: structuredJson,
						units: null,
						labels: { source: "structured_excel" },
						model_version: null,
						confidence: 0.9,
					},
				},
			});
		});
		return out;
	}

	if (kind === "word") {
		const sections = Array.isArray(params.fullContent?.sections) ? params.fullContent.sections : [];
		const coalesced = coalesceWordSections(sections);
		coalesced.forEach((structuredJson: any, idx: number) => {
			const segmentKey = coerceSegmentKey(structuredJson?.segment_key) ?? "unknown";
			const heading = cleanTextForClassification(structuredJson?.heading) || null;
			const tableRows = Array.isArray(structuredJson?.table_rows) ? structuredJson.table_rows : [];
			out.push({
				pageIndex: idx,
				asset: {
					asset_type: tableRows.length > 0 ? "table" : "image_text",
					bbox: { x: 0, y: 0, w: 1, h: 1 },
					confidence: 0.85,
					quality_flags: { source: "structured_word", segment_key: segmentKey },
					image_uri: null,
					image_hash: hashKey([params.docKind, heading ?? idx, tableRows.length > 0 ? "table" : "text"]),
					extraction: {
						ocr_text: null,
						ocr_blocks: [],
						structured_json: structuredJson,
						units: null,
						labels: { source: "structured_word" },
						model_version: null,
						confidence: 0.85,
					},
				},
			});
		});
		return out;
	}

	if (kind === "powerpoint") {
		const slides = Array.isArray(params.fullContent?.slides) ? params.fullContent.slides : [];
		slides.slice(0, 50).forEach((slide: any, idx: number) => {
			const bullets = normalizeTextList(slide?.bullets, 15);
			const title = typeof slide?.title === "string" ? slide.title : null;
			const textSnippet = typeof slide?.text === "string" ? slide.text.slice(0, 500) : "";
			const classifyText = [title ?? "", textSnippet, bullets.join("\n")].filter(Boolean).join("\n");
			const segmentKey = classifySegmentKeyFromText(classifyText, "unknown");
			const structuredJson = {
				kind: "powerpoint_slide",
				segment_key: segmentKey,
				slide_number: typeof slide?.slideNumber === "number" ? slide.slideNumber : idx + 1,
				title,
				bullets,
				text_snippet: textSnippet,
				notes: typeof slide?.notes === "string" ? slide.notes.slice(0, 500) : null,
				images: Array.isArray(slide?.images) ? slide.images : [],
			};
			out.push({
				pageIndex: idx,
				asset: {
					asset_type: "image_text",
					bbox: { x: 0, y: 0, w: 1, h: 1 },
					confidence: 0.85,
					quality_flags: { source: "structured_powerpoint", segment_key: segmentKey },
					image_uri: null,
					image_hash: hashKey([params.docKind, structuredJson.slide_number ?? idx]),
					extraction: {
						ocr_text: null,
						ocr_blocks: [],
						structured_json: structuredJson,
						units: null,
						labels: { source: "structured_powerpoint" },
						model_version: null,
						confidence: 0.85,
					},
				},
			});
		});
	}

	return out;
}

export async function persistSyntheticVisualAssets(params: {
	pool: Pool;
	documentId: string;
	docKind: string;
	structuredData: any;
	fullContent: any;
	extractorVersion?: string;
	visionRuntime?: VisionJobRuntime;
	env?: NodeJS.ProcessEnv;
}): Promise<number> {
	const env = params.env ?? process.env;
	const extractorVersion = params.extractorVersion ?? "structured_native_v1";

	const enableStructuredVisionHints = parseBool(
		env.ENABLE_STRUCTURED_VISION_HINTS ?? ((env.VISION_BASE_URL || env.VISION_WORKER_URL) && String(env.VISION_BASE_URL || env.VISION_WORKER_URL).trim() ? "1" : "0")
	);

	const pageImageUris = await (async (): Promise<string[]> => {
		if (!enableStructuredVisionHints) return [];
		try {
			return await resolvePageImageUris(params.pool, params.documentId, { env });
		} catch {
			return [];
		}
	})();

	const visionConfig = enableStructuredVisionHints ? getVisionExtractorConfig(env) : null;
	const visionRuntime = visionConfig
		? (params.visionRuntime ??
				createVisionJobRuntime({
					config: visionConfig,
					logger: console,
					logMeta: { stage: "persist_synthetic_visual_assets", document_id: params.documentId },
				}))
		: null;

	const cleanupStaleExcelSheetSummaries = async (): Promise<void> => {
		if (params.docKind !== "excel") return;
		const sheets = Array.isArray(params.fullContent?.sheets) ? params.fullContent.sheets : [];
		const sheetNames = sheets
			.map((s: any, idx: number) => (typeof s?.name === "string" && s.name.trim() ? s.name.trim() : `Sheet ${idx + 1}`))
			.filter((n: any) => typeof n === "string" && n.length > 0);
		if (sheetNames.length === 0) return;
		const stableSheetHashes = sheetNames.map((name: string) => hashKey(["excel", name, "sheet"]));

		// Remove stale/legacy synthetic sheet-summary assets so lineage doesn't accumulate duplicates.
		// Criteria:
		// - structured synthetic extractor version
		// - kind=excel_sheet + has headers (sheet-summary, not table-derived)
		// - sheet_name in this document's current sheets
		// - either image_hash is not one of the stable per-sheet hashes OR headers contain __EMPTY*
		await params.pool.query(
			`
			WITH stale AS (
				SELECT va.id
				FROM visual_assets va
				JOIN visual_extractions ve
				  ON ve.visual_asset_id = va.id
				 AND ve.extractor_version = va.extractor_version
				WHERE va.document_id = $1
				  AND va.extractor_version = $2
				  AND (ve.structured_json->>'kind') = 'excel_sheet'
				  AND (ve.structured_json ? 'headers')
				  AND (ve.structured_json->>'sheet_name') = ANY($3::text[])
				  AND (
					va.image_hash IS NULL
					OR NOT (va.image_hash = ANY($4::text[]))
					OR EXISTS (
						SELECT 1
						FROM jsonb_array_elements_text(ve.structured_json->'headers') AS h(value)
						WHERE value ILIKE '__empty%'
					)
				  )
			)
			DELETE FROM visual_assets
			WHERE id IN (SELECT id FROM stale)
			`,
			[params.documentId, extractorVersion, sheetNames, stableSheetHashes]
		);
	};

	await cleanupStaleExcelSheetSummaries();
	const assets = buildSyntheticAssets({ docKind: params.docKind, structuredData: params.structuredData, fullContent: params.fullContent });
	if (assets.length === 0) return 0;

	let persisted = 0;
	const grouped = new Map<number, VisionAsset[]>();
	for (const entry of assets) {
		const list = grouped.get(entry.pageIndex) ?? [];
		list.push(entry.asset);
		grouped.set(entry.pageIndex, list);
	}

	for (const [pageIndex, assetList] of grouped.entries()) {
		const pageImageUri = pageIndex >= 0 && pageIndex < pageImageUris.length ? pageImageUris[pageIndex] : null;

		// Lightweight vision-understanding hints for structured PowerPoint slides that have unknown segment_key.
		// This reduces downstream default fallbacks without changing computed_v1 determinism.
		if (enableStructuredVisionHints && visionConfig && pageImageUri) {
			try {
				const needsVisionHint = assetList.some((a) => {
					const qf = (a?.quality_flags ?? {}) as any;
					if (typeof qf?.source !== "string" || qf.source !== "structured_powerpoint") return false;
					const seg = coerceSegmentKey(qf?.segment_key);
					if (seg && seg !== "unknown") return false;
					const sj = (a?.extraction?.structured_json ?? {}) as any;
					const kind = typeof sj?.kind === "string" ? sj.kind : "";
					if (kind !== "powerpoint_slide") return false;
					// If slide text already exists, prefer structured classification; otherwise use vision hint.
					const title = typeof sj?.title === "string" ? sj.title.trim() : "";
					const snippet = typeof sj?.text_snippet === "string" ? sj.text_snippet.trim() : "";
					const bullets = Array.isArray(sj?.bullets) ? sj.bullets.filter((b: any) => typeof b === "string" && b.trim()).length : 0;
					return !(title || snippet || bullets > 0);
				});

				if (needsVisionHint) {
					const visionResp = await callVisionWorker(
						visionConfig,
						{
							document_id: params.documentId,
							page_index: pageIndex,
							image_uri: pageImageUri,
							extractor_version: visionConfig.extractorVersion,
						},
						{ runtime: visionRuntime ?? undefined }
					);

					const bestVu = (() => {
						const assets = Array.isArray(visionResp?.assets) ? visionResp!.assets : [];
						let best: any | null = null;
						let bestConf = -1;
						for (const va of assets) {
							const sj = (va as any)?.extraction?.structured_json;
							const vu = sj && typeof sj === "object" ? (sj as any).vision_understanding_v1 : null;
							if (!vu || typeof vu !== "object") continue;
							const confRaw = (vu as any).confidence;
							const conf = typeof confRaw === "number" && Number.isFinite(confRaw) ? confRaw : 0;
							if (conf > bestConf) {
								bestConf = conf;
								best = vu;
							}
						}
						return best;
					})();

					if (bestVu && typeof bestVu === "object") {
						const hintSeg = coerceSegmentKey(typeof (bestVu as any).segment_hint === "string" ? (bestVu as any).segment_hint : null);
						const hintConfRaw = (bestVu as any).confidence;
						const hintConf = typeof hintConfRaw === "number" && Number.isFinite(hintConfRaw) ? hintConfRaw : null;

						for (let k = 0; k < assetList.length; k++) {
							const a = assetList[k];
							const qf = { ...((a?.quality_flags ?? {}) as any) };
							if (qf.source !== "structured_powerpoint") continue;
							const existingSeg = coerceSegmentKey(qf.segment_key);
							if (existingSeg && existingSeg !== "unknown") continue;

							const extraction = (a as any)?.extraction;
							const sj = { ...(((extraction?.structured_json ?? {}) as any) ?? {}) };
							if (typeof sj.vision_understanding_v1 !== "object" || sj.vision_understanding_v1 == null) {
								sj.vision_understanding_v1 = bestVu;
							}

							if (hintSeg && hintSeg !== "unknown") {
								qf.segment_key = hintSeg;
								if (typeof qf.segment_source !== "string" || !qf.segment_source.trim()) qf.segment_source = "vision_understanding_v1";
								if (hintConf != null) qf.segment_confidence = hintConf;
								// Also update structured_json.segment_key so API can use persisted segment fallback.
								if (typeof sj.segment_key !== "string" || sj.segment_key === "unknown") sj.segment_key = hintSeg;
							}

							assetList[k] = {
								...a,
								quality_flags: qf,
								extraction: {
									...extraction,
									structured_json: sj,
								},
							};
						}
					}
				}
			} catch {
				// best-effort only
			}
		}

		const response: VisionExtractResponse = {
			document_id: params.documentId,
			page_index: pageIndex,
			extractor_version: extractorVersion,
			assets: assetList,
		};
		const { persisted: pCount } = await persistVisionResponse(params.pool, response, { pageImageUri, env });
		persisted += pCount;
	}

	return persisted;
}

export async function enqueueExtractVisualsIfPossible(params: {
	pool: Pool;
	queue: { add: (name: string, data: any, opts?: any) => Promise<unknown> };
	config: VisionExtractorConfig;
	documentId: string;
	dealId: string;
	logger?: LogLike;
	resolveOptions?: { fsImpl?: FsLike; env?: NodeJS.ProcessEnv };
	imageUrisOverride?: string[];
	/**
	 * Optional override/extra fields to include in the enqueued extract_visuals job payload.
	 * Intended for one-off debugging/verification without changing default behavior.
	 */
	jobDataOverride?: Record<string, unknown>;
	/**
	 * When true, requires rendered_pages_r2 metadata to exist and be complete before enqueueing.
	 * Defaults to true in production.
	 */
	requireRenderedPagesR2?: boolean;
}): Promise<boolean> {
	const logger = params.logger ?? console;
	if (!params.config.enabled) {
		// Optional fail-safe warning: once per process, when ingest completion tries to enqueue visuals.
		// Only warn for unset or explicit "0" to avoid noisy logs for other falsey values.
		const raw = process.env.ENABLE_VISUAL_EXTRACTION;
		const normalized = typeof raw === "string" ? raw.trim() : "";
		if (!didWarnVisualExtractionDisabled && (normalized.length === 0 || normalized === "0")) {
			didWarnVisualExtractionDisabled = true;
			logger.warn("Visual extraction disabled: ENABLE_VISUAL_EXTRACTION not set");
		}
		return false;
	}

	const envNode = (params.resolveOptions?.env?.NODE_ENV ?? process.env.NODE_ENV ?? "").trim().toLowerCase();
	const requireRenderedPagesR2 =
		typeof params.requireRenderedPagesR2 === "boolean" ? params.requireRenderedPagesR2 : envNode === "production";

	const imageUrisOverride = Array.isArray(params.imageUrisOverride)
		? params.imageUrisOverride.filter((u) => typeof u === "string" && u.length > 0)
		: null;

	// Hard guardrail: in production (or when explicitly required), only enqueue visuals when rendered_pages_r2 is present and complete.
	// This prevents enqueueing extract_visuals too early (before render_document_pages finishes writing page images).
	if (requireRenderedPagesR2 && !imageUrisOverride) {
		try {
			const { rows } = await params.pool.query<{ extraction_metadata: unknown | null }>(
				"SELECT extraction_metadata FROM documents WHERE id = $1 LIMIT 1",
				[sanitizeText(params.documentId)]
			);
			const metaObj = rows?.[0]?.extraction_metadata && typeof rows[0].extraction_metadata === "object" ? (rows[0].extraction_metadata as any) : null;
			const renderedR2 =
				metaObj?.rendered_pages_r2 && typeof metaObj.rendered_pages_r2 === "object" ? (metaObj.rendered_pages_r2 as any) : null;
			if (!renderedR2) {
				logger.log(
					JSON.stringify({
						event: "extract_visuals_enqueue_skipped",
						document_id: params.documentId,
						reason: "rendered_pages_r2_missing",
					})
				);
				return false;
			}
			const renderedCount =
				typeof metaObj?.rendered_pages_count === "number" && Number.isFinite(metaObj.rendered_pages_count)
					? metaObj.rendered_pages_count
					: 0;
			const renderedSoFar =
				typeof metaObj?.rendered_pages_rendered === "number" && Number.isFinite(metaObj.rendered_pages_rendered)
					? metaObj.rendered_pages_rendered
					: null;
			if (!renderedCount || renderedCount <= 0) {
				logger.log(
					JSON.stringify({
						event: "extract_visuals_enqueue_skipped",
						document_id: params.documentId,
						reason: "rendered_pages_count_missing",
						rendered_pages_count: renderedCount,
						rendered_pages_rendered: renderedSoFar,
					})
				);
				return false;
			}
			if (renderedSoFar == null || renderedSoFar < renderedCount) {
				logger.log(
					JSON.stringify({
						event: "extract_visuals_enqueue_skipped",
						document_id: params.documentId,
						reason: "render_incomplete",
						rendered_pages_count: renderedCount,
						rendered_pages_rendered: renderedSoFar,
					})
				);
				return false;
			}
		} catch (err) {
			logger.warn(
				JSON.stringify({
					event: "extract_visuals_enqueue_guard_failed",
					document_id: params.documentId,
					error: err instanceof Error ? err.message : String(err),
				})
			);
			return false;
		}
	}

	const imageUris = imageUrisOverride
		? imageUrisOverride
		: await resolvePageImageUris(params.pool, params.documentId, {
				logger,
				fsImpl: params.resolveOptions?.fsImpl,
				env: params.resolveOptions?.env,
		  });
	if (imageUris.length === 0) {
		logger.log(
			JSON.stringify({
				event: "extract_visuals_enqueue_skipped",
				document_id: params.documentId,
				reason: "no_page_images_available",
			})
		);
		return false;
	}

	try {
		const safeJobId = sanitizeJobId(makeJobId("extract_visuals", [params.documentId]));
		await params.queue.add(
			"extract_visuals",
			{
				...(params.jobDataOverride && typeof params.jobDataOverride === "object" ? params.jobDataOverride : {}),
				document_id: params.documentId,
				deal_id: params.dealId,
				extractor_version: params.config.extractorVersion,
				image_uris: imageUris,
			},
			{
				jobId: safeJobId,
				removeOnComplete: true,
				removeOnFail: false,
				delay: 750,
			}
		);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (msg.toLowerCase().includes("exists")) {
			logger.log(
				JSON.stringify({
					event: "extract_visuals_already_enqueued",
					document_id: params.documentId,
					pages: imageUris.length,
				})
			);
			return true;
		}
		throw err;
	}
	logger.log(
		JSON.stringify({
			event: "extract_visuals_enqueued",
			document_id: params.documentId,
			pages: imageUris.length,
		})
	);
	return true;
}
