import assert from "node:assert";
import { describe, it, mock } from "node:test";
import { reconcileIngest } from "../src/lib/ingest-reconcile";

describe("reconcileIngest", () => {
	it("requeues stalled ingest jobs from stored bytes", async () => {
		const now = new Date("2026-01-11T00:00:00.000Z");
		mock.method(Date, "now", () => now.getTime());

		const staleIso = new Date(now.getTime() - 15 * 60_000).toISOString();

		const rows = [
			{
				id: "doc-stalled",
				title: "Doc",
				status: "processing",
				extraction_metadata: null,
				page_count: 0,
				file_sha: "sha1",
				file_name: "doc.pdf",
				has_file_row: true,
				has_blob_bytes: true,
				latest_ingest_job_id: "job-123",
				latest_ingest_status: "running",
				latest_ingest_updated_at: staleIso,
			},
		];

		const queries: Array<{ sql: string; params?: any[] }> = [];
		const pool = {
			query: mock.fn(async (sql: string, params?: any[]) => {
				queries.push({ sql, params });
				if (sql.includes("FROM documents d")) {
					return { rows };
				}
				return { rows: [], rowCount: 1 };
			}),
		};

		const enqueued: any[] = [];
		const enqueue = mock.fn(async (input: any) => {
			enqueued.push(input);
			return { job_id: "job-new" };
		});

		const summary = await reconcileIngest({ dealId: "deal-1", pool: pool as any, enqueue });

		assert.strictEqual(summary.enqueued, 1);
		assert.strictEqual(summary.stalled_jobs_detected, 1);
		assert.strictEqual(summary.stalled_processing_count, 1);
		assert.strictEqual(summary.stalled_marked_failed, 1);
		assert.strictEqual(enqueued[0]?.payload?.mode, "from_storage");

		const jobUpdate = queries.find((q) => q.sql.includes("UPDATE jobs"));
		assert.ok(jobUpdate);
		const docUpdate = queries.find((q) => q.sql.includes("UPDATE documents"));
		assert.ok(docUpdate);

		mock.restoreAll();
	});
});
