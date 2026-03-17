// visual-extraction/vision-worker-client.ts
// probeImageUriFetchability, createVisionJobRuntime, getVisionExtractorConfig,
// callVisionWorker, callVisionWorkerWithRetries — verbatim extraction.

import { defaultVisualExtractionEnabled } from "../pipeline-policy";
import { getR2ObjectUrl } from "../r2";
import type {
    VisionExtractorConfig,
    VisionExtractRequest,
    VisionAttemptMeta,
    VisionRetryOptions,
    VisionExtractResponse,
    VisionJobRuntime,
    ImageUriFetchDiag,
} from "./types";
import { parseBool, parseIntWithDefault } from "./_shared";

type LogLike = Pick<Console, "log" | "warn" | "error">;

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

