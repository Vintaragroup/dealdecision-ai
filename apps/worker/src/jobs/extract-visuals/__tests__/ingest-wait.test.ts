/**
 * Unit tests for the ingest-wait polling helper (waitForIngest).
 *
 * Coverage targets
 * ────────────────
 * 1. Timeout path   — all docs remain blocked after maxWait → timedOut:true, result.ok:false
 * 2. Success path   — docs unblock on first poll → timedOut:false with ready ids
 * 3. updateJob fail — timeout triggers updateJob("failed")
 * 4. updateJob run  — success triggers updateJob("running")
 * 5. Return shape   — timedOut:false carries all required counters
 *
 * Timer strategy: set EXTRACT_VISUALS_WAIT_INGEST_MAX_MS=50 so each test exercises
 * at most one poll loop iteration (poll min is 250ms, which exceeds maxWait after sleeping).
 */

// ── Env must be set BEFORE any imports that touch db.ts ──────────────────────
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://user:pass@localhost:5432/dealdecisionai_test";
process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Job } from "bullmq";

// ── Module-level mocks ────────────────────────────────────────────────────────

vi.mock("../../../lib/worker-utils", () => ({
	makeDevLogger: vi.fn(() => vi.fn()),
	updateJob: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../lib/job-progress", () => ({
	emitJobProgress: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../lib/visual-readiness", async () => {
	const actual = await vi.importActual<typeof import("../../../lib/visual-readiness")>(
		"../../../lib/visual-readiness"
	);
	return {
		...actual,
		evaluateVisualDocReadiness: vi.fn(() => ({ blocked: false, reason: null })),
		getVisualIngestBlockReason: vi.fn(() => null),
	};
});

import { waitForIngest, type BlockedDocEntry } from "../ingest-wait";
import { evaluateVisualDocReadiness, getVisualIngestBlockReason } from "../../../lib/visual-readiness";
import { updateJob } from "../../../lib/worker-utils";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeJob(id = "job-iw-1"): Job {
	return {
		id,
		data: { deal_id: "deal-iw-1", document_id: "doc-iw-1" },
		updateProgress: vi.fn().mockResolvedValue(undefined),
	} as unknown as Job;
}

function makePool(
	overrideRows?: { rows: unknown[] }
): { query: (sql: string, args: unknown[]) => Promise<{ rows: unknown[] }> } {
	return {
		query: async (_sql: string, _args: unknown[]) =>
			overrideRows ?? {
				rows: [
					{
						id: "doc-iw-1",
						title: "Test Doc",
						type: "powerpoint",
						status: "ingesting",
						meta_status: null,
						extraction_metadata: {},
						deleted_at: null,
					},
				],
			},
	};
}

function makeBlockedDoc(overrides: Partial<BlockedDocEntry> = {}): BlockedDocEntry {
	return {
		document_id: "doc-iw-1",
		title: "Test Doc",
		deleted_at: null,
		type: "powerpoint",
		status: "ingesting",
		documents_meta_status: null,
		extraction_metadata_status: null,
		derived_ingest_complete: false,
		block_reason: "meta_status_missing",
		page_count: null,
		has_extraction_metadata: false,
		has_original_bytes: false,
		has_rendered_pages: false,
		reason: "ingest_not_complete",
		...overrides,
	};
}

const BASE_PARAMS = {
	candidateDocumentIds: ["doc-iw-1"],
	initialBlockedDocs: [] as BlockedDocEntry[],
	initialBlockedReasonsCount: {} as Record<string, number>,
	docsTotal: 1,
	dealId: "deal-iw-1",
	documentsMetaStatusOk: false,
	originalFileTablesOk: true,
};

// ── beforeEach/afterEach: restore defaults ────────────────────────────────────

beforeEach(() => {
	vi.clearAllMocks();
	vi.mocked(updateJob).mockResolvedValue(undefined);
	vi.mocked(evaluateVisualDocReadiness).mockReturnValue({ blocked: false, reason: null } as any);
	vi.mocked(getVisualIngestBlockReason).mockReturnValue(null);
	// Default timing for all tests: short enough to avoid real waits
	process.env.EXTRACT_VISUALS_WAIT_INGEST_MAX_MS = "5000";
	process.env.EXTRACT_VISUALS_WAIT_INGEST_POLL_MS = "250";
});

afterEach(() => {
	delete process.env.EXTRACT_VISUALS_WAIT_INGEST_MAX_MS;
	delete process.env.EXTRACT_VISUALS_WAIT_INGEST_POLL_MS;
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("waitForIngest", () => {
	// ── 1. Timeout path ─────────────────────────────────────────────────────────

	describe("timeout path", () => {
		it("returns timedOut:true when all docs remain blocked after maxWait", async () => {
			vi.mocked(evaluateVisualDocReadiness).mockReturnValue({ blocked: true, reason: "ingest_not_complete" } as any);
			vi.mocked(getVisualIngestBlockReason).mockReturnValue("meta_status_missing");
			// maxWait=50ms → after one 250ms poll, time elapsed > maxWait → loop exits
			process.env.EXTRACT_VISUALS_WAIT_INGEST_MAX_MS = "50";

			const result = await waitForIngest({
				...BASE_PARAMS,
				pool: makePool(),
				job: makeJob(),
				initialBlockedDocs: [makeBlockedDoc()],
				initialBlockedReasonsCount: { meta_status_missing: 1 },
			});

			expect(result.timedOut).toBe(true);
			if (result.timedOut) {
				expect(result.result.ok).toBe(false);
				expect((result.result as any).reason).toBe("INGEST_NOT_COMPLETE");
			}
		}, 10_000);

		it("result includes expected guard fields on timeout", async () => {
			vi.mocked(evaluateVisualDocReadiness).mockReturnValue({ blocked: true, reason: "ingest_not_complete" } as any);
			vi.mocked(getVisualIngestBlockReason).mockReturnValue("meta_status_missing");
			process.env.EXTRACT_VISUALS_WAIT_INGEST_MAX_MS = "50";

			const result = await waitForIngest({
				...BASE_PARAMS,
				pool: makePool(),
				job: makeJob(),
				initialBlockedDocs: [makeBlockedDoc()],
				initialBlockedReasonsCount: { meta_status_missing: 1 },
			});

			expect(result.timedOut).toBe(true);
			if (result.timedOut) {
				const r = result.result as any;
				expect(r.docs_total).toBe(1);
				expect(r.docs_ready).toBe(0);
				expect(r.docs_blocked).toBeGreaterThanOrEqual(0);
				expect(r.diagnostics).toBeDefined();
				expect(r.suggested_action).toContain("ingest_documents");
			}
		}, 10_000);

		it("calls updateJob with 'failed' on timeout", async () => {
			vi.mocked(evaluateVisualDocReadiness).mockReturnValue({ blocked: true, reason: "ingest_not_complete" } as any);
			vi.mocked(getVisualIngestBlockReason).mockReturnValue("meta_status_missing");
			process.env.EXTRACT_VISUALS_WAIT_INGEST_MAX_MS = "50";

			await waitForIngest({
				...BASE_PARAMS,
				pool: makePool(),
				job: makeJob(),
				initialBlockedDocs: [makeBlockedDoc()],
				initialBlockedReasonsCount: { meta_status_missing: 1 },
			});

			const failedCalls = vi.mocked(updateJob).mock.calls.filter((c) => c[1] === "failed");
			expect(failedCalls.length).toBeGreaterThanOrEqual(1);
		}, 10_000);
	});

	// ── 2. Success path ──────────────────────────────────────────────────────────

	describe("success path", () => {
		it("returns timedOut:false when doc unblocks on first poll", async () => {
			// evaluateVisualDocReadiness returns blocked:false → doc appears ready during recompute
			vi.mocked(evaluateVisualDocReadiness).mockReturnValue({ blocked: false, reason: null } as any);

			const result = await waitForIngest({
				...BASE_PARAMS,
				pool: makePool(),
				job: makeJob(),
				initialBlockedDocs: [makeBlockedDoc()],
				initialBlockedReasonsCount: { meta_status_missing: 1 },
			});

			expect(result.timedOut).toBe(false);
			if (!result.timedOut) {
				expect(result.docsReady).toBe(1);
				expect(result.readyDocumentIds).toContain("doc-iw-1");
			}
		}, 10_000);

		it("returns correct counters on success", async () => {
			vi.mocked(evaluateVisualDocReadiness).mockReturnValue({ blocked: false, reason: null } as any);

			const result = await waitForIngest({
				...BASE_PARAMS,
				pool: makePool(),
				job: makeJob(),
				initialBlockedDocs: [makeBlockedDoc()],
				initialBlockedReasonsCount: { meta_status_missing: 1 },
			});

			expect(result.timedOut).toBe(false);
			if (!result.timedOut) {
				expect(result.docsBlocked).toBe(0);
				expect(result.docsBlockedPending).toBe(0);
				expect(typeof result.docsReady).toBe("number");
			}
		}, 10_000);

		it("calls updateJob with 'running' on success (never 'failed')", async () => {
			vi.mocked(evaluateVisualDocReadiness).mockReturnValue({ blocked: false, reason: null } as any);

			await waitForIngest({
				...BASE_PARAMS,
				pool: makePool(),
				job: makeJob(),
				initialBlockedDocs: [makeBlockedDoc()],
				initialBlockedReasonsCount: { meta_status_missing: 1 },
			});

			const runningCalls = vi.mocked(updateJob).mock.calls.filter((c) => c[1] === "running");
			expect(runningCalls.length).toBeGreaterThanOrEqual(1);
			const failedCalls = vi.mocked(updateJob).mock.calls.filter((c) => c[1] === "failed");
			expect(failedCalls.length).toBe(0);
		}, 10_000);
	});
});
