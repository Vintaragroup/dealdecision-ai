// visual-extraction/xlsx-worker-client.ts
// callXlsxWorker, callXlsxWorkerWithRetries, buildXlsxCanonicalPatch — verbatim extraction.

import type {
    VisionExtractorConfig,
    VisionExtractResponse,
} from "./types";

type LogLike = Pick<Console, "log" | "warn" | "error">;
type XlsxWorkerLogger = LogLike;

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

// ── XLSX Canonical Metadata ──────────────────────────────────────────────────
/** Lifecycle status stored in extraction_metadata.xlsx after an extraction run. */
export type XlsxCanonicalStatus = "succeeded" | "failed" | "empty" | "synthetic_fallback";

export interface XlsxCanonicalMetadata {
	attempted: boolean;
	status: XlsxCanonicalStatus;
	/** Error code — present only when status="failed". */
	code?: string;
	/** Error message — present only when status="failed". */
	message?: string;
	/** Number of sheet-pages returned by the XLSX worker (ok paths only). */
	pages_returned?: number;
	/** Number of visual_assets rows persisted from this run. */
	pages_persisted?: number;
	/** Wall-clock duration of the callXlsxWorkerWithRetries call in ms. */
	duration_ms?: number;
	/** ISO timestamp of the last write. */
	updated_at: string;
}

/**
 * Builds the canonical extraction_metadata.xlsx patch after a completed
 * callXlsxWorkerWithRetries call. Also emits the legacy xlsx_worker_status
 * key on failure for backward compatibility with existing monitoring queries.
 */

export function buildXlsxCanonicalPatch(params: {
	result: XlsxWorkerResult;
	/** Number of visual_assets rows that were persisted from the XLSX response. */
	pagesPersisted: number;
	durationMs: number;
	/** Override the timestamp (defaults to now). Useful in tests. */
	updatedAt?: string;
}): { xlsx: XlsxCanonicalMetadata; xlsx_worker_status?: Record<string, unknown> } {
	const updatedAt = params.updatedAt ?? new Date().toISOString();
	if (!params.result.ok) {
		return {
			xlsx: {
				attempted: true,
				status: "failed",
				code: params.result.code,
				message: params.result.message,
				duration_ms: params.durationMs,
				updated_at: updatedAt,
			},
			// Legacy key retained for backward compatibility with existing monitoring.
			xlsx_worker_status: {
				ok: false,
				code: params.result.code,
				message: params.result.message,
				ts: updatedAt,
			},
		};
	}
	const pagesReturned = params.result.payload?.pages?.length ?? 0;
	const status: XlsxCanonicalStatus = params.pagesPersisted > 0 ? "succeeded" : "empty";
	return {
		xlsx: {
			attempted: true,
			status,
			pages_returned: pagesReturned,
			pages_persisted: params.pagesPersisted,
			duration_ms: params.durationMs,
			updated_at: updatedAt,
		},
	};
}

/**
 * Returns true when the post-DPU guardrail should emit XLSX_FACTS_MISSING_AFTER_SUCCESS:
 * the document is an XLSX doc, the XLSX worker previously recorded status="succeeded"
 * in extraction_metadata.xlsx, but populateFinancialFactRegistryV1 produced 0 xlsx facts.
 */
export function shouldEmitXlsxFactsMissingGuardrail(params: {
	isXlsxDoc: boolean;
	extractionMetadata: unknown;
	factsXlsx: number;
}): boolean {
	if (!params.isXlsxDoc) return false;
	if (params.factsXlsx > 0) return false;
	const meta =
		params.extractionMetadata && typeof params.extractionMetadata === "object"
			? (params.extractionMetadata as Record<string, unknown>)
			: null;
	const xlsxMeta = meta?.xlsx && typeof meta.xlsx === "object" ? (meta.xlsx as Record<string, unknown>) : null;
	return xlsxMeta?.status === "succeeded";
}


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

