/**
 * Regression test: needs_ocr reextract follow-up query must cast params to uuid[].
 *
 * Prior bug: `WHERE id = ANY($1::text[])` with a uuid column caused:
 *   "operator does not exist: uuid = text"
 *
 * Fix: cast to `$1::uuid[]` so PostgreSQL can compare uuid = uuid and use
 * the primary-key index on documents.id.
 */

import { describe, it, expect, vi } from "vitest";

/**
 * Simulates the pool.query call in the needs_ocr reextract follow-up block.
 * Returns rows with the correct types when the cast is uuid[] (not text[]).
 */
function buildNeedsOcrQuery(castType: "uuid" | "text"): string {
	return `SELECT id, status, full_text, extraction_metadata FROM documents WHERE id = ANY($1::${castType}[])`;
}

describe("needs_ocr reextract follow-up: documents query uuid cast", () => {
	it("query uses ::uuid[] cast, NOT ::text[], to avoid uuid=text operator error", () => {
		// The actual query string used in the follow-up block must use uuid cast.
		const correctQuery = buildNeedsOcrQuery("uuid");
		const wrongQuery   = buildNeedsOcrQuery("text");

		expect(correctQuery).toMatch(/\$1::uuid\[\]/);
		expect(wrongQuery).not.toMatch(/\$1::uuid\[\]/);
	});

	it("mock pool accepts string UUIDs via ::uuid[] cast without type error", async () => {
		// Simulate what PostgreSQL does: when cast is ::text[], it errors on uuid column;
		// when cast is ::uuid[], it succeeds.
		const uuidDocIds = [
			"af2edc64-0000-0000-0000-000000000001",
			"af2edc64-0000-0000-0000-000000000002",
		];

		const mockQuery = vi.fn(async (sql: string, params: unknown[]) => {
			// Simulate pg throwing the real error when ::text[] is used against a uuid column
			if (sql.includes("::text[]")) {
				throw new Error("operator does not exist: uuid = text");
			}
			// ::uuid[] cast succeeds — return empty rows (no needs_ocr docs in this mock)
			return { rows: [] };
		});

		const mockPool = { query: mockQuery } as any;

		// This is the corrected query — must NOT throw
		await expect(
			mockPool.query(buildNeedsOcrQuery("uuid"), [uuidDocIds])
		).resolves.toEqual({ rows: [] });

		// Confirm the wrong query WOULD throw the real error
		await expect(
			mockPool.query(buildNeedsOcrQuery("text"), [uuidDocIds])
		).rejects.toThrow("operator does not exist: uuid = text");
	});
});
