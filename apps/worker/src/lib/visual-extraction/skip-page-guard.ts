// visual-extraction/skip-page-guard.ts
// Deep scan / extract-visuals outcome builders + shouldSkipExtractVisualsPage — verbatim extraction.

import type {
    DeepScanPageFailureV1,
    DeepScanPageSummaryV1,
    DeepScanOutcomeStatus,
    ExtractVisualsPageFailureV1,
    ExtractVisualsPageSummaryV1,
    ExtractVisualsOutcomeStatus,
} from "./types";

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

