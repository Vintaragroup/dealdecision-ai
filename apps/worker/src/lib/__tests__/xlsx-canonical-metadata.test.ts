/**
 * PR5 — XLSX Canonicalization: unit tests for buildXlsxCanonicalPatch and
 * shouldEmitXlsxFactsMissingGuardrail.
 *
 * Coverage:
 *  buildXlsxCanonicalPatch:
 *   - ok:false  → status='failed', code+message forwarded, legacy xlsx_worker_status included
 *   - ok:true, pages persisted > 0  → status='succeeded', pages_returned + pages_persisted set
 *   - ok:true, pages persisted = 0  → status='empty', pages_returned set, pages_persisted=0
 *   - duration_ms forwarded on all paths
 *   - updatedAt override respected
 *   - ok:true path never includes xlsx_worker_status
 *
 *  shouldEmitXlsxFactsMissingGuardrail:
 *   - isXlsxDoc=false  → false (irrelevant doc kind)
 *   - factsXlsx > 0    → false (facts present; no issue)
 *   - xlsx.status='succeeded' + factsXlsx=0  → true (emit guardrail)
 *   - xlsx.status='failed'   + factsXlsx=0  → false (XLSX never succeeded)
 *   - xlsx.status='empty'    + factsXlsx=0  → false (XLSX produced no sheets)
 *   - xlsx.status='synthetic_fallback' + factsXlsx=0 → false (XLSX not attempted)
 *   - extractionMetadata=null              → false
 *   - extractionMetadata without xlsx key  → false
 *   - xlsx key present but wrong value type → false
 */
import { describe, it, expect } from "vitest";
import {
	buildXlsxCanonicalPatch,
	shouldEmitXlsxFactsMissingGuardrail,
} from "../visual-extraction";
import type { XlsxWorkerResult } from "../visual-extraction";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const FAIL_RESULT: XlsxWorkerResult = {
	ok: false,
	code: "XLSX_WORKER_UNAVAILABLE",
	message: "Connection refused",
	retryable: true,
};

const OK_RESULT_WITH_PAGES: XlsxWorkerResult = {
	ok: true,
	payload: {
		document_id: "doc-1",
		extractor_version: "excel_py_v1",
		pages: [
			{ document_id: "doc-1", page_index: 0, extractor_version: "excel_py_v1", assets: [] },
			{ document_id: "doc-1", page_index: 1, extractor_version: "excel_py_v1", assets: [] },
		],
	},
};

const OK_RESULT_EMPTY_PAGES: XlsxWorkerResult = {
	ok: true,
	payload: {
		document_id: "doc-1",
		extractor_version: "excel_py_v1",
		pages: [],
	},
};

const FIXED_TS = "2026-01-15T10:00:00.000Z";

// ── buildXlsxCanonicalPatch ───────────────────────────────────────────────────

describe("buildXlsxCanonicalPatch — failure path", () => {
	it("returns status='failed' for ok:false result", () => {
		const patch = buildXlsxCanonicalPatch({
			result: FAIL_RESULT,
			pagesPersisted: 0,
			durationMs: 1500,
			updatedAt: FIXED_TS,
		});
		expect(patch.xlsx.status).toBe("failed");
	});

	it("forwards code and message on failure", () => {
		const patch = buildXlsxCanonicalPatch({
			result: FAIL_RESULT,
			pagesPersisted: 0,
			durationMs: 800,
			updatedAt: FIXED_TS,
		});
		expect(patch.xlsx.code).toBe("XLSX_WORKER_UNAVAILABLE");
		expect(patch.xlsx.message).toBe("Connection refused");
	});

	it("sets attempted=true on failure", () => {
		const patch = buildXlsxCanonicalPatch({
			result: FAIL_RESULT,
			pagesPersisted: 0,
			durationMs: 100,
			updatedAt: FIXED_TS,
		});
		expect(patch.xlsx.attempted).toBe(true);
	});

	it("includes duration_ms on failure", () => {
		const patch = buildXlsxCanonicalPatch({
			result: FAIL_RESULT,
			pagesPersisted: 0,
			durationMs: 2345,
			updatedAt: FIXED_TS,
		});
		expect(patch.xlsx.duration_ms).toBe(2345);
	});

	it("emits legacy xlsx_worker_status on failure for backward compatibility", () => {
		const patch = buildXlsxCanonicalPatch({
			result: FAIL_RESULT,
			pagesPersisted: 0,
			durationMs: 100,
			updatedAt: FIXED_TS,
		});
		expect(patch.xlsx_worker_status).toBeDefined();
		expect((patch.xlsx_worker_status as any)?.ok).toBe(false);
		expect((patch.xlsx_worker_status as any)?.code).toBe("XLSX_WORKER_UNAVAILABLE");
	});

	it("sets updated_at to the provided updatedAt", () => {
		const patch = buildXlsxCanonicalPatch({
			result: FAIL_RESULT,
			pagesPersisted: 0,
			durationMs: 100,
			updatedAt: FIXED_TS,
		});
		expect(patch.xlsx.updated_at).toBe(FIXED_TS);
	});
});

describe("buildXlsxCanonicalPatch — success path (pages persisted)", () => {
	it("returns status='succeeded' when pagesPersisted > 0", () => {
		const patch = buildXlsxCanonicalPatch({
			result: OK_RESULT_WITH_PAGES,
			pagesPersisted: 3,
			durationMs: 500,
			updatedAt: FIXED_TS,
		});
		expect(patch.xlsx.status).toBe("succeeded");
	});

	it("sets pages_returned to the number of pages in the payload", () => {
		const patch = buildXlsxCanonicalPatch({
			result: OK_RESULT_WITH_PAGES,
			pagesPersisted: 3,
			durationMs: 500,
			updatedAt: FIXED_TS,
		});
		expect(patch.xlsx.pages_returned).toBe(2);
	});

	it("sets pages_persisted to the provided count", () => {
		const patch = buildXlsxCanonicalPatch({
			result: OK_RESULT_WITH_PAGES,
			pagesPersisted: 3,
			durationMs: 500,
			updatedAt: FIXED_TS,
		});
		expect(patch.xlsx.pages_persisted).toBe(3);
	});

	it("sets attempted=true on success", () => {
		const patch = buildXlsxCanonicalPatch({
			result: OK_RESULT_WITH_PAGES,
			pagesPersisted: 1,
			durationMs: 400,
			updatedAt: FIXED_TS,
		});
		expect(patch.xlsx.attempted).toBe(true);
	});

	it("does NOT include xlsx_worker_status on success", () => {
		const patch = buildXlsxCanonicalPatch({
			result: OK_RESULT_WITH_PAGES,
			pagesPersisted: 1,
			durationMs: 400,
			updatedAt: FIXED_TS,
		});
		expect(patch.xlsx_worker_status).toBeUndefined();
	});

	it("does NOT include code or message on success", () => {
		const patch = buildXlsxCanonicalPatch({
			result: OK_RESULT_WITH_PAGES,
			pagesPersisted: 2,
			durationMs: 300,
			updatedAt: FIXED_TS,
		});
		expect(patch.xlsx.code).toBeUndefined();
		expect(patch.xlsx.message).toBeUndefined();
	});

	it("includes duration_ms on success", () => {
		const patch = buildXlsxCanonicalPatch({
			result: OK_RESULT_WITH_PAGES,
			pagesPersisted: 1,
			durationMs: 999,
			updatedAt: FIXED_TS,
		});
		expect(patch.xlsx.duration_ms).toBe(999);
	});
});

describe("buildXlsxCanonicalPatch — empty path (worker ok but nothing persisted)", () => {
	it("returns status='empty' when pagesPersisted=0 even if payload has pages", () => {
		const patch = buildXlsxCanonicalPatch({
			result: OK_RESULT_WITH_PAGES,
			pagesPersisted: 0,
			durationMs: 200,
			updatedAt: FIXED_TS,
		});
		expect(patch.xlsx.status).toBe("empty");
	});

	it("returns status='empty' when payload.pages is empty []", () => {
		const patch = buildXlsxCanonicalPatch({
			result: OK_RESULT_EMPTY_PAGES,
			pagesPersisted: 0,
			durationMs: 100,
			updatedAt: FIXED_TS,
		});
		expect(patch.xlsx.status).toBe("empty");
	});

	it("sets pages_returned=0 when payload has no pages", () => {
		const patch = buildXlsxCanonicalPatch({
			result: OK_RESULT_EMPTY_PAGES,
			pagesPersisted: 0,
			durationMs: 100,
			updatedAt: FIXED_TS,
		});
		expect(patch.xlsx.pages_returned).toBe(0);
	});

	it("does NOT include xlsx_worker_status on empty path", () => {
		const patch = buildXlsxCanonicalPatch({
			result: OK_RESULT_EMPTY_PAGES,
			pagesPersisted: 0,
			durationMs: 100,
			updatedAt: FIXED_TS,
		});
		expect(patch.xlsx_worker_status).toBeUndefined();
	});
});

describe("buildXlsxCanonicalPatch — updatedAt defaults to now when omitted", () => {
	it("sets a valid ISO timestamp when updatedAt is not provided", () => {
		const before = Date.now();
		const patch = buildXlsxCanonicalPatch({
			result: OK_RESULT_WITH_PAGES,
			pagesPersisted: 1,
			durationMs: 50,
		});
		const after = Date.now();
		const ts = new Date(patch.xlsx.updated_at).getTime();
		expect(ts).toBeGreaterThanOrEqual(before);
		expect(ts).toBeLessThanOrEqual(after);
	});
});

// ── shouldEmitXlsxFactsMissingGuardrail ──────────────────────────────────────

describe("shouldEmitXlsxFactsMissingGuardrail", () => {
	it("returns false when isXlsxDoc=false regardless of xlsx status", () => {
		expect(
			shouldEmitXlsxFactsMissingGuardrail({
				isXlsxDoc: false,
				extractionMetadata: { xlsx: { status: "succeeded" } },
				factsXlsx: 0,
			})
		).toBe(false);
	});

	it("returns false when factsXlsx > 0 (facts present; no missing issue)", () => {
		expect(
			shouldEmitXlsxFactsMissingGuardrail({
				isXlsxDoc: true,
				extractionMetadata: { xlsx: { status: "succeeded" } },
				factsXlsx: 5,
			})
		).toBe(false);
	});

	it("returns true when xlsx.status='succeeded' AND factsXlsx=0", () => {
		expect(
			shouldEmitXlsxFactsMissingGuardrail({
				isXlsxDoc: true,
				extractionMetadata: { xlsx: { status: "succeeded", pages_persisted: 3 } },
				factsXlsx: 0,
			})
		).toBe(true);
	});

	it("returns false when xlsx.status='failed' and factsXlsx=0 (XLSX never succeeded)", () => {
		expect(
			shouldEmitXlsxFactsMissingGuardrail({
				isXlsxDoc: true,
				extractionMetadata: { xlsx: { status: "failed", code: "XLSX_TIMEOUT" } },
				factsXlsx: 0,
			})
		).toBe(false);
	});

	it("returns false when xlsx.status='empty' and factsXlsx=0 (XLSX produced no sheets)", () => {
		expect(
			shouldEmitXlsxFactsMissingGuardrail({
				isXlsxDoc: true,
				extractionMetadata: { xlsx: { status: "empty" } },
				factsXlsx: 0,
			})
		).toBe(false);
	});

	it("returns false when xlsx.status='synthetic_fallback' and factsXlsx=0 (XLSX not attempted)", () => {
		expect(
			shouldEmitXlsxFactsMissingGuardrail({
				isXlsxDoc: true,
				extractionMetadata: { xlsx: { status: "synthetic_fallback" } },
				factsXlsx: 0,
			})
		).toBe(false);
	});

	it("returns false when extractionMetadata is null", () => {
		expect(
			shouldEmitXlsxFactsMissingGuardrail({
				isXlsxDoc: true,
				extractionMetadata: null,
				factsXlsx: 0,
			})
		).toBe(false);
	});

	it("returns false when extractionMetadata has no xlsx key", () => {
		expect(
			shouldEmitXlsxFactsMissingGuardrail({
				isXlsxDoc: true,
				extractionMetadata: { visual_extraction: { status: "succeeded" } },
				factsXlsx: 0,
			})
		).toBe(false);
	});

	it("returns false when extractionMetadata.xlsx is not an object", () => {
		expect(
			shouldEmitXlsxFactsMissingGuardrail({
				isXlsxDoc: true,
				extractionMetadata: { xlsx: "succeeded" },
				factsXlsx: 0,
			})
		).toBe(false);
	});

	it("returns false when extractionMetadata is not an object", () => {
		expect(
			shouldEmitXlsxFactsMissingGuardrail({
				isXlsxDoc: true,
				extractionMetadata: "bad-value",
				factsXlsx: 0,
			})
		).toBe(false);
	});

	it("returns false when extractionMetadata is undefined", () => {
		expect(
			shouldEmitXlsxFactsMissingGuardrail({
				isXlsxDoc: true,
				extractionMetadata: undefined,
				factsXlsx: 0,
			})
		).toBe(false);
	});
});
