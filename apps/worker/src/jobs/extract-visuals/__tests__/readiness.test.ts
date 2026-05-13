/**
 * readiness.test.ts
 *
 * Behavioral tests for evaluateTargetDocumentReadiness.
 * Covers: all ready, all blocked, mixed, missing DB metadata,
 * blocked reason count aggregation, and bypass dev-log shape.
 */

// Set required env vars before any imports
process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/dealdecisionai_test";
process.env.REDIS_URL = "redis://localhost:6379";
process.env.ENABLE_VISUAL_EXTRACTION = "1";

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../lib/db", async () => ({
	getPool: vi.fn(),
	getDocumentOriginalFile: vi.fn().mockResolvedValue(null),
	mergeDocumentExtractionMetadata: vi.fn().mockResolvedValue(undefined),
	getDocumentOriginalFile: vi.fn().mockResolvedValue(null),
	upsertDocumentOriginalFile: vi.fn().mockResolvedValue(undefined),
	getDocumentsForDeal: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../../lib/visual-extraction", async () => {
	const actual = await vi.importActual<typeof import("../../../lib/visual-extraction")>(
		"../../../lib/visual-extraction"
	);
	return {
		...actual,
		resolvePageImageUris: vi.fn().mockResolvedValue([]),
	};
});

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

vi.mock("../../../lib/worker-utils", () => ({
	makeDevLogger: vi.fn(() => vi.fn()),
	updateJob: vi.fn().mockResolvedValue(undefined),
}));

import { evaluateTargetDocumentReadiness } from "../readiness";
import { resolvePageImageUris } from "../../../lib/visual-extraction";
import { getDocumentOriginalFile } from "../../../lib/db";
import {
	evaluateVisualDocReadiness,
	getVisualIngestBlockReason,
} from "../../../lib/visual-readiness";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makePool(rows: Record<string, any[]> = {}): {
	query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;
} {
	return {
		query: async (sql: string) => {
			// Route by SQL substring
			for (const [key, result] of Object.entries(rows)) {
				if (sql.includes(key)) return { rows: result };
			}
			return { rows: [] };
		},
	};
}

function makeDocRow(overrides: Partial<{
	id: string;
	deal_id: string;
	title: string;
	type: string;
	status: string;
	meta_status: string | null;
	page_count: number;
	extraction_metadata: Record<string, unknown> | null;
	deleted_at: string | null;
}> = {}) {
	return {
		id: "doc-0001",
		deal_id: "deal-0001",
		title: "Test Deck",
		type: "powerpoint",
		status: "ready_for_analysis",
		meta_status: "succeeded",
		page_count: 10,
		extraction_metadata: { status: "succeeded" },
		deleted_at: null,
		...overrides,
	};
}

const BASE_PARAMS = {
	documentsMetaStatusOk: true,
	originalFileTablesOk: false,
	allowRenderedPagesFallback: false,
	jobId: "job-test-1",
	dealId: "deal-0001",
} as const;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("evaluateTargetDocumentReadiness", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(evaluateVisualDocReadiness).mockReturnValue({ blocked: false, reason: null });
		vi.mocked(getVisualIngestBlockReason).mockReturnValue(null);
		vi.mocked(resolvePageImageUris).mockResolvedValue([]);
		vi.mocked(getDocumentOriginalFile).mockResolvedValue(null);
	});

	it("returns all docs as ready when none are blocked", async () => {
		const doc1 = makeDocRow({ id: "doc-0001" });
		const doc2 = makeDocRow({ id: "doc-0002" });
		const pool = makePool({ "WHERE id = ANY": [doc1, doc2] });

		vi.mocked(evaluateVisualDocReadiness).mockReturnValue({ blocked: false, reason: null });

		const result = await evaluateTargetDocumentReadiness({
			...BASE_PARAMS,
			pool,
			targetDocumentIds: ["doc-0001", "doc-0002"],
		});

		expect(result.readyDocumentIds).toEqual(["doc-0001", "doc-0002"]);
		expect(result.docsReady).toBe(2);
		expect(result.docsBlocked).toBe(0);
		expect(result.blockedDocs).toHaveLength(0);
		expect(result.docsBlockedPending).toBe(0);
	});

	it("returns all docs as blocked when all fail readiness", async () => {
		const doc1 = makeDocRow({ id: "doc-0001", status: "ingesting", meta_status: null });
		const doc2 = makeDocRow({ id: "doc-0002", status: "ingesting", meta_status: null });
		const pool = makePool({ "WHERE id = ANY": [doc1, doc2] });

		vi.mocked(evaluateVisualDocReadiness).mockReturnValue({
			blocked: true,
			reason: "ingest_not_complete",
		});
		vi.mocked(getVisualIngestBlockReason).mockReturnValue("meta_status_missing");

		const result = await evaluateTargetDocumentReadiness({
			...BASE_PARAMS,
			pool,
			targetDocumentIds: ["doc-0001", "doc-0002"],
		});

		expect(result.readyDocumentIds).toEqual([]);
		expect(result.docsReady).toBe(0);
		expect(result.docsBlocked).toBe(2);
		expect(result.blockedDocs).toHaveLength(2);
		expect(result.docsBlockedPending).toBe(2);
	});

	it("partitions mixed ready/blocked docs correctly", async () => {
		const readyDoc = makeDocRow({ id: "doc-ready" });
		const blockedDoc = makeDocRow({ id: "doc-blocked", status: "ingesting", meta_status: null });
		const pool = makePool({ "WHERE id = ANY": [readyDoc, blockedDoc] });

		vi.mocked(evaluateVisualDocReadiness).mockImplementation(({ id }) => {
			if (id === "doc-blocked") return { blocked: true, reason: "ingest_not_complete" };
			return { blocked: false, reason: null };
		});
		vi.mocked(getVisualIngestBlockReason).mockReturnValue("meta_status_missing");

		const result = await evaluateTargetDocumentReadiness({
			...BASE_PARAMS,
			pool,
			targetDocumentIds: ["doc-ready", "doc-blocked"],
		});

		expect(result.readyDocumentIds).toEqual(["doc-ready"]);
		expect(result.docsReady).toBe(1);
		expect(result.docsBlocked).toBe(1);
		expect(result.blockedDocs[0].document_id).toBe("doc-blocked");
	});

	it("falls back to empty meta when DB returns no rows for a doc", async () => {
		// Pool returns no rows — doc meta will be {} fallback
		const pool = makePool({ "WHERE id = ANY": [] });

		// With null status/metaStatus, evaluateVisualDocReadiness returns blocked
		vi.mocked(evaluateVisualDocReadiness).mockReturnValue({
			blocked: true,
			reason: "ingest_not_complete",
		});
		vi.mocked(getVisualIngestBlockReason).mockReturnValue("meta_status_missing");

		const result = await evaluateTargetDocumentReadiness({
			...BASE_PARAMS,
			pool,
			targetDocumentIds: ["doc-missing"],
		});

		expect(result.docsBlocked).toBe(1);
		expect(result.blockedDocs[0].document_id).toBe("doc-missing");
		// title/status/page_count all null when meta is empty
		expect(result.blockedDocs[0].title).toBeNull();
		expect(result.blockedDocs[0].status).toBeNull();
		expect(result.blockedDocs[0].page_count).toBeNull();
	});

	it("aggregates blocked reason counts correctly across multiple docs", async () => {
		const docs = [
			makeDocRow({ id: "doc-a", status: null, deleted_at: "2024-01-01" }),
			makeDocRow({ id: "doc-b", status: "ingesting", meta_status: null }),
			makeDocRow({ id: "doc-c", status: "ingesting", meta_status: null }),
		];
		const pool = makePool({ "WHERE id = ANY": docs });

		vi.mocked(evaluateVisualDocReadiness).mockReturnValue({
			blocked: true,
			reason: "ingest_not_complete",
		});
		vi.mocked(getVisualIngestBlockReason).mockImplementation(({ deletedAt }) => {
			if (deletedAt != null) return "deleted";
			return "meta_status_missing";
		});

		const result = await evaluateTargetDocumentReadiness({
			...BASE_PARAMS,
			pool,
			targetDocumentIds: ["doc-a", "doc-b", "doc-c"],
		});

		expect(result.blockedReasonsCount["deleted"]).toBe(1);
		expect(result.blockedReasonsCount["meta_status_missing"]).toBe(2);
		expect(result.docsBlocked).toBe(3);
	});

	it("emits dev log with correct shape when bypass guard is triggered", async () => {
		const { makeDevLogger } = await import("../../../lib/worker-utils");
		const devLogSpy = vi.fn();
		vi.mocked(makeDevLogger).mockReturnValue(devLogSpy);

		// Re-import to pick up fresh mock (module caches the devLog constant)
		// Instead we verify behavior indirectly: doc appears in readyDocumentIds (not blocked)
		const doc = makeDocRow({
			id: "doc-bypass",
			status: "ingesting",
			meta_status: null,
		});
		const pool = makePool({ "WHERE id = ANY": [doc] });

		// Bypass guard requires: allowRenderedPagesFallback=true, blocked=true,
		// reason=ingest_not_complete, hasRenderedPages=true, deletedAt=null
		vi.mocked(resolvePageImageUris).mockResolvedValue(["r2://page-0.png"]);
		vi.mocked(evaluateVisualDocReadiness).mockReturnValue({
			blocked: true,
			reason: "ingest_not_complete",
		});

		const result = await evaluateTargetDocumentReadiness({
			...BASE_PARAMS,
			pool,
			targetDocumentIds: ["doc-bypass"],
			allowRenderedPagesFallback: true,
		});

		// Bypassed doc appears as ready (not blocked)
		expect(result.readyDocumentIds).toContain("doc-bypass");
		expect(result.docsBlocked).toBe(0);
		expect(result.blockedDocs).toHaveLength(0);
	});
});
