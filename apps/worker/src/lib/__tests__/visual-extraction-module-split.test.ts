/**
 * PR18 — visual-extraction module-split smoke tests.
 *
 * Purpose:
 *  1. Prove the barrel (visual-extraction.ts → index.ts) preserves the full public API.
 *  2. Prove each sub-module exports what is expected.
 *  3. Prove key deterministic functions still produce the correct outputs.
 *
 * Deliberately lightweight — the comprehensive behavioral tests live in the
 * existing xlsx-worker-retries, xlsx-canonical-metadata, vision-retry, etc. suites.
 */

import { describe, it, expect, vi } from "vitest";

// ── Barrel re-export smoke test ──────────────────────────────────────────────
// All imports come from the original barrel path — callers must be unaffected.
import {
	// types
	type VisionExtractorConfig,
	type VisionExtractRequest,
	type VisionBBox,
	type VisionOcrBlock,
	type VisionJobRuntime,
	type ImageUriFetchDiag,
	type VisionExtraction,
	type VisionAsset,
	type VisionExtractResponse,
	type VisionAttemptMeta,
	type VisionRetryOptions,
	type DeepScanPageFailureV1,
	type DeepScanPageSummaryV1,
	type DeepScanOutcomeStatus,
	type ExtractVisualsPageFailureV1,
	type ExtractVisualsPageSummaryV1,
	type ExtractVisualsOutcomeStatus,
	type XlsxWorkerResultOk,
	type XlsxWorkerResultFail,
	type XlsxWorkerResult,
	type XlsxCanonicalStatus,
	type XlsxCanonicalMetadata,
	type VisionRoutingDecisionV1,
	type ExtractVisualsFinalizedMarker,
	// functions from each sub-module
	getVisionExtractorConfig,
	createVisionJobRuntime,
	probeImageUriFetchability,
	callVisionWorker,
	callVisionWorkerWithRetries,
	resolvePageImageUris,
	backfillVisualAssetImageUris,
	hasTable,
	shouldSkipExtractVisualsPage,
	isAuditVisionFailure,
	computeDeepScanOutcomeStatus,
	buildDeepScanPageSummaryV1,
	buildDeepScanExtractionMetadataPatch,
	computeExtractVisualsOutcomeStatusV1,
	buildExtractVisualsPageSummaryV1,
	buildExtractVisualsExtractionMetadataPatchV1,
	buildXlsxCanonicalPatch,
	shouldEmitXlsxFactsMissingGuardrail,
	callXlsxWorker,
	callXlsxWorkerWithRetries,
	upsertVisualAsset,
	upsertVisualExtraction,
	insertEvidenceLinkIfMissing,
	persistVisionResponse,
	deduceDocKind,
	computeVisionRoutingDecisionV1,
	toTextLoose,
	inferSegmentKeyFromStructured,
	resegmentStructuredSyntheticAssets,
	applyVisionHintsToStructuredPowerpointSlides,
	persistSyntheticVisualAssets,
	enqueueExtractVisualsIfPossible,
	buildExtractVisualsFinalizedMarker,
} from "../visual-extraction";

// ── Sub-module direct imports ────────────────────────────────────────────────
import * as typesModule from "../visual-extraction/types";
import * as sharedModule from "../visual-extraction/_shared";
import * as vwcModule from "../visual-extraction/vision-worker-client";
import * as purModule from "../visual-extraction/page-uri-resolver";
import * as spgModule from "../visual-extraction/skip-page-guard";
import * as xwcModule from "../visual-extraction/xlsx-worker-client";
import * as vpModule from "../visual-extraction/visual-persistence";
import * as saModule from "../visual-extraction/synthetic-assets";

// ─────────────────────────────────────────────────────────────────────────────
describe("PR18 visual-extraction module split — barrel exports", () => {
	it("all expected function exports are functions", () => {
		expect(typeof getVisionExtractorConfig).toBe("function");
		expect(typeof createVisionJobRuntime).toBe("function");
		expect(typeof probeImageUriFetchability).toBe("function");
		expect(typeof callVisionWorker).toBe("function");
		expect(typeof callVisionWorkerWithRetries).toBe("function");
		expect(typeof resolvePageImageUris).toBe("function");
		expect(typeof backfillVisualAssetImageUris).toBe("function");
		expect(typeof hasTable).toBe("function");
		expect(typeof shouldSkipExtractVisualsPage).toBe("function");
		expect(typeof isAuditVisionFailure).toBe("function");
		expect(typeof buildXlsxCanonicalPatch).toBe("function");
		expect(typeof callXlsxWorker).toBe("function");
		expect(typeof callXlsxWorkerWithRetries).toBe("function");
		expect(typeof persistVisionResponse).toBe("function");
		expect(typeof deduceDocKind).toBe("function");
		expect(typeof computeVisionRoutingDecisionV1).toBe("function");
		expect(typeof toTextLoose).toBe("function");
		expect(typeof inferSegmentKeyFromStructured).toBe("function");
		expect(typeof persistSyntheticVisualAssets).toBe("function");
		expect(typeof enqueueExtractVisualsIfPossible).toBe("function");
		expect(typeof buildExtractVisualsFinalizedMarker).toBe("function");
	});
});

describe("PR18 — sub-module export surface", () => {
	it("types.ts exports expected type shapes (runtime-detectable exports only)", () => {
		// types.ts has no runtime values — just check it can be imported without throwing
		expect(typesModule).toBeDefined();
	});

	it("_shared.ts exports cross-cutting helpers", () => {
		expect(typeof sharedModule.parseBool).toBe("function");
		expect(typeof sharedModule.parseIntWithDefault).toBe("function");
		expect(typeof sharedModule.normalizeImageUriForDb).toBe("function");
		expect(typeof sharedModule.coerceBBox).toBe("function");
		expect(typeof sharedModule.coerceJsonObject).toBe("function");
		expect(typeof sharedModule.coerceJsonArray).toBe("function");
		expect(typeof sharedModule.coerceSegmentKey).toBe("function");
		expect(typeof sharedModule.mapSlideTypeToSegmentKey).toBe("function");
		expect(typeof sharedModule.classifySegmentKeyFromText).toBe("function");
		expect(Array.isArray(sharedModule.SEGMENT_KEYS)).toBe(true);
	});

	it("vision-worker-client.ts exports correct functions", () => {
		expect(typeof vwcModule.probeImageUriFetchability).toBe("function");
		expect(typeof vwcModule.createVisionJobRuntime).toBe("function");
		expect(typeof vwcModule.getVisionExtractorConfig).toBe("function");
		expect(typeof vwcModule.callVisionWorker).toBe("function");
		expect(typeof vwcModule.callVisionWorkerWithRetries).toBe("function");
	});

	it("page-uri-resolver.ts exports correct functions", () => {
		expect(typeof purModule.resolvePageImageUris).toBe("function");
		expect(typeof purModule.backfillVisualAssetImageUris).toBe("function");
		expect(typeof purModule.hasTable).toBe("function");
	});

	it("skip-page-guard.ts exports correct functions", () => {
		expect(typeof spgModule.shouldSkipExtractVisualsPage).toBe("function");
		expect(typeof spgModule.isAuditVisionFailure).toBe("function");
		expect(typeof spgModule.computeDeepScanOutcomeStatus).toBe("function");
		expect(typeof spgModule.buildDeepScanPageSummaryV1).toBe("function");
		expect(typeof spgModule.computeExtractVisualsOutcomeStatusV1).toBe("function");
	});

	it("xlsx-worker-client.ts exports correct functions and types", () => {
		expect(typeof xwcModule.buildXlsxCanonicalPatch).toBe("function");
		expect(typeof xwcModule.shouldEmitXlsxFactsMissingGuardrail).toBe("function");
		expect(typeof xwcModule.callXlsxWorker).toBe("function");
		expect(typeof xwcModule.callXlsxWorkerWithRetries).toBe("function");
	});

	it("visual-persistence.ts exports correct functions", () => {
		expect(typeof vpModule.upsertVisualAsset).toBe("function");
		expect(typeof vpModule.upsertVisualExtraction).toBe("function");
		expect(typeof vpModule.insertEvidenceLinkIfMissing).toBe("function");
		expect(typeof vpModule.persistVisionResponse).toBe("function");
		expect(typeof vpModule.deduceDocKind).toBe("function");
		expect(typeof vpModule.computeVisionRoutingDecisionV1).toBe("function");
	});

	it("synthetic-assets.ts exports correct functions", () => {
		expect(typeof saModule.toTextLoose).toBe("function");
		expect(typeof saModule.inferSegmentKeyFromStructured).toBe("function");
		expect(typeof saModule.resegmentStructuredSyntheticAssets).toBe("function");
		expect(typeof saModule.applyVisionHintsToStructuredPowerpointSlides).toBe("function");
		expect(typeof saModule.persistSyntheticVisualAssets).toBe("function");
		expect(typeof saModule.enqueueExtractVisualsIfPossible).toBe("function");
		expect(typeof saModule.buildExtractVisualsFinalizedMarker).toBe("function");
	});
});

// ─────────────────────────────────────────────────────────────────────────────
describe("PR18 — buildXlsxCanonicalPatch output shapes", () => {
	const BASE_DURATION = 1234;
	const BASE_UPDATED_AT = "2026-01-01T00:00:00.000Z";

	it("ok:false → status='failed', code and message forwarded", () => {
		const result = buildXlsxCanonicalPatch({
			result: { ok: false, code: "XLSX_WORKER_UNAVAILABLE", message: "service down" },
			pagesPersisted: 0,
			durationMs: BASE_DURATION,
			updatedAt: BASE_UPDATED_AT,
		});
		expect(result.xlsx.status).toBe("failed");
		expect(result.xlsx.code).toBe("XLSX_WORKER_UNAVAILABLE");
		expect(result.xlsx.message).toBe("service down");
		expect(result.xlsx.duration_ms).toBe(BASE_DURATION);
		expect(result.xlsx.attempted).toBe(true);
		// Legacy compat: xlsx_worker_status is the failure result object
		expect(result.xlsx_worker_status).toBeDefined();
		expect((result.xlsx_worker_status as any).code).toBe("XLSX_WORKER_UNAVAILABLE");
		expect((result.xlsx_worker_status as any).ok).toBe(false);
	});

	it("ok:true with pages → status='succeeded', pages_returned and pages_persisted set", () => {
		const result = buildXlsxCanonicalPatch({
			result: { ok: true, payload: { document_id: "d1", extractor_version: "v1", pages: [{} as any, {} as any] } },
			pagesPersisted: 2,
			durationMs: BASE_DURATION,
			updatedAt: BASE_UPDATED_AT,
		});
		expect(result.xlsx.status).toBe("succeeded");
		expect(result.xlsx.pages_returned).toBe(2);
		expect(result.xlsx.pages_persisted).toBe(2);
		expect(result.xlsx_worker_status).toBeUndefined();
	});

	it("ok:true with 0 pages → status='empty'", () => {
		const result = buildXlsxCanonicalPatch({
			result: { ok: true, payload: { document_id: "d1", extractor_version: "v1", pages: [] } },
			pagesPersisted: 0,
			durationMs: BASE_DURATION,
			updatedAt: BASE_UPDATED_AT,
		});
		expect(result.xlsx.status).toBe("empty");
		expect(result.xlsx.pages_returned).toBe(0);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
describe("PR18 — _shared helpers behavior", () => {
	it("parseBool returns true for truthy strings", () => {
		expect(sharedModule.parseBool("1")).toBe(true);
		expect(sharedModule.parseBool("true")).toBe(true);
		expect(sharedModule.parseBool("yes")).toBe(true);
		expect(sharedModule.parseBool("on")).toBe(true);
		expect(sharedModule.parseBool("0")).toBe(false);
		expect(sharedModule.parseBool(undefined)).toBe(false);
	});

	it("coerceBBox returns a bbox with numeric x,y,w,h", () => {
		const bbox = sharedModule.coerceBBox({ x: 10, y: 20, w: 100, h: 50 });
		expect(bbox).toMatchObject({ x: 10, y: 20, w: 100, h: 50 });
	});

	it("coerceBBox coerces missing fields to default values", () => {
		const bbox = sharedModule.coerceBBox({});
		// x and y default to 0, w and h default to 1 (zero-size bbox is invalid geometry)
		expect(bbox.x).toBe(0);
		expect(bbox.y).toBe(0);
		expect(typeof bbox.w).toBe("number");
		expect(typeof bbox.h).toBe("number");
	});

	it("classifySegmentKeyFromText returns expected segment key", () => {
		expect(sharedModule.classifySegmentKeyFromText("total addressable market size opportunity")).toBe("market");
		expect(sharedModule.classifySegmentKeyFromText("net revenue recurring arr mrr growth")).toBe("traction");
	});

	it("normalizeImageUriForDb returns null for empty/null input", () => {
		expect(sharedModule.normalizeImageUriForDb(null)).toBeNull();
		expect(sharedModule.normalizeImageUriForDb("")).toBeNull();
	});

	it("normalizeImageUriForDb returns /uploads/ path unchanged if already canonical", () => {
		const result = sharedModule.normalizeImageUriForDb("/uploads/abc/page-0.webp");
		expect(result).toBe("/uploads/abc/page-0.webp");
	});
});

// ─────────────────────────────────────────────────────────────────────────────
describe("PR18 — skip-page-guard behavior", () => {
	it("shouldSkipExtractVisualsPage returns false for VISION_UNAVAILABLE audit status", () => {
		// Must re-attempt when vision was unavailable
		expect(
			shouldSkipExtractVisualsPage({
				docAuditStatus: "vision_unavailable",
				hasVisualExtractionRow: true,
			})
		).toBe(false);
	});

	it("shouldSkipExtractVisualsPage returns true when extraction exists and audit is clean", () => {
		expect(
			shouldSkipExtractVisualsPage({
				docAuditStatus: "succeeded",
				hasVisualExtractionRow: true,
			})
		).toBe(true);
	});

	it("computeDeepScanOutcomeStatus returns 'succeeded' when all pages pass", () => {
		expect(computeDeepScanOutcomeStatus({ attempted: 3, succeeded: 3 })).toBe("succeeded");
	});

	it("computeDeepScanOutcomeStatus returns 'succeeded_with_warnings' on partial success", () => {
		expect(computeDeepScanOutcomeStatus({ attempted: 3, succeeded: 2 })).toBe("succeeded_with_warnings");
	});

	it("computeDeepScanOutcomeStatus returns 'failed' when all pages fail", () => {
		expect(computeDeepScanOutcomeStatus({ attempted: 3, succeeded: 0 })).toBe("failed");
	});
});

// ─────────────────────────────────────────────────────────────────────────────
describe("PR18 — deduceDocKind", () => {
	it("returns the raw type for simple pdf string", () => {
		expect(deduceDocKind({ type: "pdf" })).toBe("pdf");
	});

	it("returns 'excel' for type string containing 'excel'", () => {
		expect(deduceDocKind({ type: "excel" })).toBe("excel");
	});

	it("returns 'excel' for type ending with xlsx", () => {
		expect(deduceDocKind({ type: "document.xlsx" })).toBe("excel");
	});

	it("returns 'powerpoint' for type string containing 'powerpoint'", () => {
		expect(deduceDocKind({ type: "powerpoint" })).toBe("powerpoint");
	});

	it("returns 'unknown' for empty type", () => {
		expect(deduceDocKind({})).toBe("unknown");
	});
});

// ─────────────────────────────────────────────────────────────────────────────
describe("PR18 — buildExtractVisualsFinalizedMarker", () => {
	it("returns a correctly shaped finalized marker", () => {
		const patch = buildExtractVisualsFinalizedMarker({ jobId: "job-123", docsFinalized: 1 });
		expect(patch.extract_visuals_finalized.ok).toBe(true);
		expect(patch.extract_visuals_finalized.finalized_by_job_id).toBe("job-123");
		expect(patch.extract_visuals_finalized.docs_finalized).toBe(1);
		expect(typeof patch.extract_visuals_finalized.finalized_at).toBe("string");
	});

	it("accepts null jobId", () => {
		const patch = buildExtractVisualsFinalizedMarker({ jobId: null, docsFinalized: 0 });
		expect(patch.extract_visuals_finalized.ok).toBe(true);
		expect(patch.extract_visuals_finalized.finalized_by_job_id).toBeNull();
		expect(patch.extract_visuals_finalized.docs_finalized).toBe(0);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
describe("PR18 — toTextLoose", () => {
	it("returns string for string input", () => {
		expect(toTextLoose("hello world")).toBe("hello world");
	});

	it("extracts strings from arrays of strings", () => {
		const result = toTextLoose(["hello", "world"]);
		expect(result).toContain("hello");
		expect(result).toContain("world");
	});

	it("returns empty string for null/undefined", () => {
		expect(toTextLoose(null)).toBe("");
		expect(toTextLoose(undefined)).toBe("");
	});
});
