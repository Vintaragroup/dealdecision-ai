// visual-extraction/types.ts
// Pure exported type/interface declarations — no runtime logic, no imports.

export type VisionExtractorConfig = {
	enabled: boolean;
	visionWorkerUrl: string;
	extractorVersion: string;
	timeoutMs: number;
	maxPages: number;
};

type LogLike = Pick<Console, "log" | "warn" | "error">;


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

export type ImageUriFetchDiag = {
	ok: boolean;
	status: number | null;
	content_type: string | null;
	duration_ms: number;
	method: "GET_RANGE";
	error?: string;
};

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


type VisionAttemptErrorKind = "http" | "timeout" | "abort" | "network" | "unknown";

export type VisionAttemptMeta = {
	attempt: number;
	timeout_ms: number;
	elapsed_ms: number;
	status_code: number | null;
	error: string | null;
	error_kind: VisionAttemptErrorKind;
};


export type VisionRetryOptions = {
	logger?: LogLike | null;
	logMeta?: Record<string, unknown>;
	runtime?: VisionJobRuntime;
	fetchImpl?: typeof fetch;
	timeoutsMs: number[];
	backoffMs?: number[];
	jitterPct?: number;
};


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


export interface ExtractVisualsFinalizedMarker {
	/** Always true when present — false is never written. */
	ok: boolean;
	/** ISO-8601 timestamp of when finalization completed. */
	finalized_at: string;
	/** BullMQ job_id of the job that ran finalization, or null if unavailable. */
	finalized_by_job_id: string | null;
	/** Number of documents that were finalized in this run (normally 1). */
	docs_finalized: number;
}

