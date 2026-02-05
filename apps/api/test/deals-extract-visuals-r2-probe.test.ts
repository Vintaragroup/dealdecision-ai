process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerDealRoutes } from "../src/routes/deals";
import { closeQueues } from "../src/lib/queue";

test.after(async () => {
	await closeQueues();
});

test("POST /api/v1/deals/:deal_id/extract-visuals returns 202 when R2 probe overrides stale rendered_pages_rendered", async () => {
	const dealId = "00000000-0000-0000-0000-0000000000a1";

	const mockPool = {
		query: async (sql: string, params: unknown[]) => {
			if (sql.includes("SELECT * FROM deals WHERE id = $1")) {
				assert.equal(params[0], dealId);
				return { rows: [{ id: dealId, deleted_at: null }] };
			}
			if (sql.includes("SELECT to_regclass")) {
				// hasTable() checks for document_files.
				return { rows: [{ oid: null }] };
			}
			if (sql.includes("information_schema.columns")) {
				// hasColumn() checks for mime_type.
				return { rows: [{ ok: 1 }] };
			}
			if (sql.includes("FROM documents") && sql.includes("WHERE deal_id = $1")) {
				return {
					rows: [
						{
							id: "doc-1",
							file_name: null,
							mime_type: "application/pdf",
							extraction_metadata: {
								rendered_pages_r2: { bucket: "b", prefix: `deals/${dealId}/documents/doc-1/rendered_pages`, format: "page_%04d.png" },
								rendered_pages_count: 5,
								rendered_pages_rendered: 0,
							},
						},
					],
				};
			}
			throw new Error(`Unexpected query: ${sql}`);
		},
	} as any;

	const app = Fastify();
	await registerDealRoutes(app, mockPool, {
		enqueueJob: async (input: any) => {
			assert.equal(input.type, "extract_visuals_deal");
			return { id: 1, job_id: "job-1", status: "queued" };
		},
		r2: {
			objectExistsInR2: async ({ key }: { key: string }) => {
				// Treat the last page as present.
				return { exists: key.endsWith("/page_0004.png"), key } as any;
			},
		},
	});

	const res = await app.inject({ method: "POST", url: `/api/v1/deals/${dealId}/extract-visuals`, payload: {} });
	assert.equal(res.statusCode, 202);
	const body = res.json() as any;
	assert.equal(body.readiness_reason, "r2_probe_overrode_metadata");
	assert.deepEqual(body.ready_documents, ["doc-1"]);
	assert.equal(body.job_id, "job-1");

	await app.close();
});
