/**
 * Regression guard: backfillMissingDpuPlaceholdersForDocumentRange must NOT use
 * "ON CONFLICT ... DO NOTHING" because it silently leaves `updated_at` stale when
 * the force_refresh best-effort DELETE fails.
 *
 * Root cause scenario:
 *   1. force_refresh=true DELETE runs but fails silently (best-effort try/catch).
 *   2. Old DPU placeholder rows remain with original created_at (before min_dpu_created_at).
 *   3. backfill INSERT fires ON CONFLICT → previously DO NOTHING → no timestamp update.
 *   4. GREATEST(created_at, COALESCE(updated_at, created_at)) still returns old timestamp.
 *   5. Freshness gate permanently returns DPU_STALE.
 *
 * Fix: ON CONFLICT now sets updated_at = now() so GREATEST picks up the fresh value
 * even without a successful DELETE.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE_PATH = join(__dirname, "../document-page-understanding.ts");

let source: string;
try {
	source = readFileSync(SOURCE_PATH, "utf8");
} catch {
	source = "";
}

describe("backfillMissingDpuPlaceholdersForDocumentRange — freshness fix", () => {
	it("source file loads", () => {
		expect(source.length).toBeGreaterThan(0);
	});

	it("backfill ON CONFLICT sets updated_at = now() (not DO NOTHING)", () => {
		// The old broken form:
		const oldForm = /ON\s+CONFLICT\s*\(document_id,\s*page_index,\s*version\)\s+DO\s+NOTHING/is;
		expect(oldForm.test(source)).toBe(false);

		// The new form must set updated_at after the DO UPDATE keyword.
		// Note: SQL comments between DO UPDATE and SET are allowed; check both parts separately.
		const hasDoUpdate = /ON\s+CONFLICT\s*\(document_id,\s*page_index,\s*version\)\s+DO\s+UPDATE/is.test(source);
		expect(hasDoUpdate).toBe(true);
		// Verify that SET updated_at = now() appears in the backfill function body.
		const backfillBlock = source.split('backfillMissingDpuPlaceholdersForDocumentRange')[1]?.split('export async function populateDocument')[0] ?? '';
		const hasUpdatedAt = /SET\s+updated_at\s*=\s*now\(\)/is.test(backfillBlock);
		expect(hasUpdatedAt).toBe(true);
	});

	it("backfill ON CONFLICT does NOT overwrite payload (content rows are preserved)", () => {
		// The conflict handler must only touch updated_at to avoid corrupting real DPU content.
		// Extract the ON CONFLICT clause from the backfill function specifically (not the main upsert).
		const backfillFn = source.split("backfillMissingDpuPlaceholdersForDocumentRange")[1] ?? "";
		// The next function definition starts with "export async function populateDocument..."
		const backfillBody = backfillFn.split("export async function populateDocument")[0] ?? "";

		expect(backfillBody).toBeTruthy();
		// payload must not be in the SET clause of the backfill conflict handler.
		const conflictSetSection = backfillBody.match(/ON\s+CONFLICT[^;]+SET([^;]+)/is)?.[1] ?? "";
		expect(conflictSetSection.toLowerCase()).not.toMatch(/payload\s*=/);
	});

	it("main upsert (populateDocumentPageUnderstandingFromVisualExtractions) still sets created_at = now()", () => {
		// The main upsert must keep created_at = now() so direct reruns with visual_assets always freshen.
		const mainUpsertMatch = source.match(
			/upserted AS \(\s*INSERT INTO public\.document_page_understanding[\s\S]*?ON CONFLICT[^;]*?SET([\s\S]*?)RETURNING/s
		);
		expect(mainUpsertMatch).toBeTruthy();
		const setClause = mainUpsertMatch?.[1] ?? "";
		expect(setClause).toMatch(/created_at\s*=\s*now\(\)/i);
		expect(setClause).toMatch(/updated_at\s*=\s*now\(\)/i);
	});
});

describe("backfillMissingDpuPlaceholdersForDocumentRange — functional", () => {
	it("conflict case: updates updated_at so freshness gate sees fresh timestamp", async () => {
		// Simulate the scenario: old row exists (DELETE failed), backfill INSERT fires ON CONFLICT.
		// We verify that the new 'DO UPDATE SET updated_at = now()' branch runs (updated > 0).
		const { populateDocumentPageUnderstandingFromVisualExtractions } = await import(
			"../document-page-understanding.js"
		);

		const queries: Array<{ sql: string; params: any[] | undefined }> = [];
		const pool: any = {
			query: async (sql: string, params?: any[]) => {
				queries.push({ sql, params });
				if (sql.includes("COUNT(*)::bigint AS inserted")) {
					// Simulate: 1 row was "upserted" (conflict → updated_at touched)
					return { rows: [{ inserted: "1" }] };
				}
				if (sql.includes("COUNT(*)::bigint AS enriched")) {
					return { rows: [{ enriched: "0" }] };
				}
				return { rows: [{ upserted: "0", page_text_empty: "0", candidates_found: "0", rows_with_text: "0", rows_missing_text: "0" }] };
			},
		};

		// Drive through the document-level path which calls the backfill function internally.
		await populateDocumentPageUnderstandingFromVisualExtractions(pool, {
			documentId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
			dealId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
			pageStart: 0,
			pageEnd: 5,
			version: "page_understanding_v1",
		});

		// The backfill INSERT query should contain DO UPDATE SET updated_at = now()
		const backfillQuery = queries.find(
			(q) => q.sql.includes("COUNT(*)::bigint AS inserted") && q.sql.includes("DO UPDATE")
		);
		expect(backfillQuery).toBeTruthy();
		// DO UPDATE and SET updated_at may be separated by SQL comments — check both parts.
		expect(backfillQuery?.sql).toMatch(/DO\s+UPDATE/is);
		expect(backfillQuery?.sql).toMatch(/SET\s+updated_at\s*=\s*now\(\)/is);
	});
});
