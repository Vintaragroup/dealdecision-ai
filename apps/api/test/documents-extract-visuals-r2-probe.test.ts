process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerDocumentRoutes } from "../src/routes/documents";
import { closeQueues } from "../src/lib/queue";

test.after(async () => {
	await closeQueues();
});

test("POST /api/v1/deals/:deal_id/documents/:document_id/extract-visuals returns 202 when R2 probe overrides stale rendered_pages_rendered", async () => {
	const mockPool = {
		query: async (sql: string, params: unknown[]) => {
			if (sql.includes("information_schema.columns")) {
				// hasColumn() checks for documents.mime_type.
				return { rows: [{ ok: 1 }] };
			}
			if (sql.includes("SELECT to_regclass")) {
				// hasTable() checks for document_files.
				return { rows: [{ oid: null }] };
			}
			if (sql.includes("FROM documents") && sql.includes("WHERE id = $1") && sql.includes("deal_id = $2")) {
				assert.equal(params[0], "doc-1");
				assert.equal(params[1], "deal-1");
				return {
					rows: [
						{
							extraction_metadata: {
								rendered_pages_r2: {
									bucket: "b",
									prefix: "deals/deal-1/documents/doc-1/rendered_pages",
									format: "page_%04d.png",
								},
								rendered_pages_count: 5,
								rendered_pages_rendered: 0,
							},
							file_name: null,
							mime_type: "application/pdf",
						},
					],
				};
			}
			throw new Error(`Unexpected query: ${sql}`);
		},
	} as any;

	const app = Fastify();
	await registerDocumentRoutes(app, mockPool, {
		enqueueJob: async (input: any) => {
			assert.equal(input.type, "extract_visuals");
			assert.equal(input.deal_id, "deal-1");
			assert.equal(input.document_id, "doc-1");
			return { id: 1, job_id: "job-1", status: "queued" };
		},
		r2: {
			uploadToR2: async () => {
				throw new Error("not used");
			},
			getSignedDownloadUrl: async () => {
				throw new Error("not used");
			},
			deleteFromR2: async () => {
				throw new Error("not used");
			},
			getR2Config: () => {
				throw new Error("not used");
			},
			getPublicUrlForKey: () => {
				throw new Error("not used");
			},
			objectExistsInR2: async ({ key }: { key: string }) => {
				// Treat the last page as present.
				return { exists: key.endsWith("/page_0004.png"), key } as any;
			},
		},
	});

	const res = await app.inject({ method: "POST", url: "/api/v1/deals/deal-1/documents/doc-1/extract-visuals", payload: {} });
	assert.equal(res.statusCode, 202);
	const body = res.json() as any;
	assert.equal(body.ok, true);
	assert.equal(body.job_id, "job-1");
	assert.equal(body.readiness_reason, "r2_probe_overrode_metadata");
	assert.equal(body.r2_probe_overrides?.length, 1);
	assert.equal(body.r2_probe_overrides[0].document_id, "doc-1");

	await app.close();
});
