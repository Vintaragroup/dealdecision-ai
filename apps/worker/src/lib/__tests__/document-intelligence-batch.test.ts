import { describe, it, expect } from "vitest";

import {
	planDocumentIntelligenceBatch,
	selectDocumentsForDocumentIntelligenceBatch,
} from "../document-intelligence-batch";

describe("document intelligence batch", () => {
	it("selectDocumentsForDocumentIntelligenceBatch uses authoritative filters and deterministic ordering", async () => {
		const calls: Array<{ sql: string; params: any[] | undefined }> = [];
		const pool: any = {
			query: async (sql: string, params?: any[]) => {
				calls.push({ sql: String(sql), params });
				return { rows: [] };
			},
		};

		await selectDocumentsForDocumentIntelligenceBatch(pool, "11111111-1111-1111-1111-111111111111");

		expect(calls.length).toBe(1);
		const sql = calls[0]!.sql;
		expect(sql).toContain("FROM documents");
		expect(sql).toContain("deleted_at IS NULL");
		expect(sql).toContain("ready_for_analysis_at IS NOT NULL");
		expect(sql).toContain("status = ANY");
		expect(sql.replace(/\s+/g, " ")).toContain("ORDER BY uploaded_at ASC NULLS LAST, updated_at ASC, id ASC");
	});

	it("planDocumentIntelligenceBatch is deterministic and dedupes active docs", () => {
		const active = new Map<string, string[]>();
		active.set("b", ["job-2", "job-1"]);

		const plan = planDocumentIntelligenceBatch(["c", "b", "a", "b"], active);

		expect(plan.doc_ids_selected).toEqual(["a", "b", "c"]);
		expect(plan.doc_ids_to_enqueue).toEqual(["a", "c"]);
		expect(plan.doc_ids_skipped_active).toEqual(["b"]);
		expect(plan.active_job_ids).toEqual(["job-1", "job-2"]);
	});
});
