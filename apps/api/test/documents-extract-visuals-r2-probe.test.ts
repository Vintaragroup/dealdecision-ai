process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerDocumentRoutes } from "../src/routes/documents";
import { closeQueues } from "../src/lib/queue";
import { enqueueJob as enqueueJobService } from "../src/services/jobs";

test.after(async () => {
	await closeQueues();
});

test("POST /api/v1/deals/:deal_id/documents/:document_id/extract-visuals returns 202 when R2 probe overrides stale rendered_pages_rendered", async () => {
	const dealId = "00000000-0000-0000-0000-0000000000b1";
	const documentId = "00000000-0000-0000-0000-0000000000b2";

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
				assert.equal(params[0], documentId);
				assert.equal(params[1], dealId);
				return {
					rows: [
						{
							extraction_metadata: {
								rendered_pages_r2: {
									bucket: "b",
									prefix: `deals/${dealId}/documents/${documentId}/rendered_pages`,
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
			assert.equal(input.deal_id, dealId);
			assert.equal(input.document_id, documentId);
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

	const res = await app.inject({ method: "POST", url: `/api/v1/deals/${dealId}/documents/${documentId}/extract-visuals`, payload: {} });
	assert.equal(res.statusCode, 202);
	const body = res.json() as any;
	assert.equal(body.ok, true);
	assert.equal(body.job_id, "job-1");
	assert.equal(body.readiness_reason, "r2_probe_overrode_metadata");
	assert.equal(body.r2_probe_overrides?.length, 1);
	assert.equal(body.r2_probe_overrides[0].document_id, documentId);

	await app.close();
});

test("POST /api/v1/deals/:deal_id/documents/:document_id/extract-visuals returns 202 for XLSX even when rendered pages metadata missing", async () => {
	const dealId = "00000000-0000-0000-0000-0000000000c1";
	const documentId = "00000000-0000-0000-0000-0000000000c2";

	const seen: {
		insertParams?: unknown[];
		queue?: { name: string; data: Record<string, unknown>; opts: { jobId: string } };
	} = {};

	const mockQueue = {
		add: async (name: string, data: Record<string, unknown>, opts: { jobId: string }) => {
			seen.queue = { name, data, opts };
			return { id: "bull-1" };
		},
	};

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
				assert.equal(params[0], documentId);
				assert.equal(params[1], dealId);
				return {
					rows: [
						{
							extraction_metadata: null,
							file_name: null,
							mime_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
						},
					],
				};
			}
			if (sql.includes("FROM jobs") && sql.includes("status = ANY")) {
				// Dedupe probe (no existing jobs).
				return { rows: [] };
			}
			if (sql.includes("INSERT INTO jobs") && sql.includes("RETURNING id, job_id, status")) {
				seen.insertParams = params;
				return { rows: [{ id: 1, job_id: params[0], status: "queued" }] };
			}
			throw new Error(`Unexpected query: ${sql}`);
		},
	} as any;

	const app = Fastify();
	await registerDocumentRoutes(app, mockPool, {
		enqueueJob: async (input: any, opts: any) => {
			return await enqueueJobService(input, {
				...(opts ?? {}),
				deps: { pool: mockPool as any, queue: mockQueue as any },
			});
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
			objectExistsInR2: async () => {
				throw new Error("not used");
			},
		},
	});

	const res = await app.inject({ method: "POST", url: `/api/v1/deals/${dealId}/documents/${documentId}/extract-visuals`, payload: {} });
	assert.equal(res.statusCode, 202);
	const body = res.json() as any;
	assert.equal(body?.ok, true);
	assert.notEqual(body?.error, "rendered_pages_not_ready");

	assert.ok(seen.insertParams, "expected jobs insert");
	assert.ok(seen.queue, "expected bullmq enqueue");

	// Assert job row insert payload contains deal_id + document_id + type.
	const insertParams = seen.insertParams ?? [];
	const payloadJson = insertParams[6] as string;
	assert.equal(typeof payloadJson, "string");
	const persistedPayload = JSON.parse(payloadJson) as Record<string, unknown>;
	assert.equal(persistedPayload.type, "extract_visuals");
	assert.equal(persistedPayload.deal_id, dealId);
	assert.equal(persistedPayload.document_id, documentId);

	// Assert bullmq payload includes identifiers too.
	assert.equal(seen.queue?.name, "extract_visuals");
	assert.equal(seen.queue?.data?.deal_id, dealId);
	assert.equal(seen.queue?.data?.document_id, documentId);

	await app.close();
});
