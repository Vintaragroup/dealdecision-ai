/**
 * Tests for updateDocumentAnalysis — specifically the ready_for_analysis_at field.
 *
 * The ingest_documents success path sets status='ready_for_analysis' + readyForAnalysisAt
 * atomically so that the extract_visuals guard does not stall.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Must be set before any import that transitively requires pg and DATABASE_URL.
process.env.DATABASE_URL = "postgres://test-host/test-db";

// Mock pg so we never open a real connection.
const queryCalls: Array<{ sql: string; params: unknown[] }> = [];
vi.mock("pg", () => {
	class MockPool {
		async query(sql: string, params?: unknown[]) {
			queryCalls.push({ sql: String(sql), params: params ?? [] });
			return { rows: [] };
		}
	}
	return { Pool: MockPool };
});

// Import AFTER mocks are registered.
const { updateDocumentAnalysis } = await import("../db");

beforeEach(() => {
	queryCalls.length = 0;
});

describe("updateDocumentAnalysis – ready_for_analysis_at", () => {
	it("includes ready_for_analysis_at in the SQL with COALESCE guard when provided", async () => {
		const ts = new Date("2026-02-21T12:00:00.000Z");

		await updateDocumentAnalysis({
			documentId: "doc-abc",
			status: "ready_for_analysis",
			readyForAnalysisAt: ts,
		});

		expect(queryCalls).toHaveLength(1);
		const { sql, params } = queryCalls[0]!;

		// Verify the COALESCE pattern is present — never overwrites an already-set value.
		expect(sql).toContain("COALESCE(ready_for_analysis_at");
		// Verify we guard against deleted documents.
		expect(sql).toContain("deleted_at IS NULL");
		// updated_at must always be refreshed.
		expect(sql).toContain("updated_at = now()");
		// The timestamp must appear in params as $9.
		expect(params[8]).toStrictEqual(ts);
	});

	it("passes null for ready_for_analysis_at when not supplied (e.g., needs_ocr path)", async () => {
		await updateDocumentAnalysis({
			documentId: "doc-xyz",
			status: "needs_ocr",
		});

		expect(queryCalls).toHaveLength(1);
		const { params } = queryCalls[0]!;
		// $9 must be null so the CASE branch is a no-op.
		expect(params[8]).toBeNull();
	});

	it("passes null for ready_for_analysis_at when explicitly null", async () => {
		await updateDocumentAnalysis({
			documentId: "doc-xyz",
			status: "ready_for_analysis",
			readyForAnalysisAt: null,
		});

		expect(queryCalls).toHaveLength(1);
		expect(queryCalls[0]!.params[8]).toBeNull();
	});
});
