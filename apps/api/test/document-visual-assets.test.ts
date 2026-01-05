process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerDocumentRoutes } from "../src/routes/documents";
import { closeQueues } from "../src/lib/queue";

test.after(async () => {
	await closeQueues();
});

test("GET /api/v1/deals/:deal_id/documents/:document_id/visual-assets returns empty + warning when tables missing", async () => {
	const mockPool = {
		query: async (sql: string, params: unknown[]) => {
			if (sql.includes("FROM documents") && sql.includes("WHERE deal_id = $1") && sql.includes("AND id = $2")) {
				assert.equal(params[0], "deal-1");
				assert.equal(params[1], "doc-1");
				return { rows: [{ id: "doc-1" }] };
			}
			if (sql.includes("to_regclass")) {
				assert.ok(typeof params[0] === "string");
				return { rows: [{ oid: null }] };
			}
			throw new Error("Unexpected query");
		},
	} as any;

	const app = Fastify();
	await registerDocumentRoutes(app, mockPool);

	const res = await app.inject({
		method: "GET",
		url: "/api/v1/deals/deal-1/documents/doc-1/visual-assets",
	});

	assert.equal(res.statusCode, 200);
	const body = res.json();
	assert.equal(body.deal_id, "deal-1");
	assert.equal(body.document_id, "doc-1");
	assert.ok(Array.isArray(body.assets));
	assert.equal(body.assets.length, 0);
	assert.ok(Array.isArray(body.warnings));
	assert.ok(body.warnings.length >= 1);

	await app.close();
});

test("GET /api/v1/deals/:deal_id/documents/:document_id/visual-assets returns assets with latest_extraction and evidence", async () => {
	const now = new Date("2026-01-05T00:00:00.000Z").toISOString();

	const rows = [
		{
			id: "asset-1",
			page_index: 0,
			asset_type: "chart",
			bbox: { x: 0, y: 0, w: 1, h: 1 },
			image_uri: "/tmp/page_001_raw.png",
			image_hash: null,
			extractor_version: "vision_v1",
			confidence: "0.8",
			quality_flags: {},
			created_at: now,
			extraction_id: "ext-1",
			ocr_text: "Revenue",
			ocr_blocks: [],
			structured_json: { series: [] },
			units: null,
			labels: {},
			model_version: null,
			extraction_confidence: "0.7",
			extraction_created_at: now,
			evidence_count: 2,
			evidence_sample_snippets: ["Snippet 1", "Snippet 2"],
		},
	];

	const mockPool = {
		query: async (sql: string, params: unknown[]) => {
			if (sql.includes("FROM documents") && sql.includes("WHERE deal_id = $1") && sql.includes("AND id = $2")) {
				assert.equal(params[0], "deal-1");
				assert.equal(params[1], "doc-1");
				return { rows: [{ id: "doc-1" }] };
			}
			if (sql.includes("to_regclass")) {
				return { rows: [{ oid: "ok" }] };
			}
			if (sql.includes("FROM visual_assets")) {
				assert.equal(params[0], "deal-1");
				assert.equal(params[1], "doc-1");
				return { rows };
			}
			throw new Error("Unexpected query");
		},
	} as any;

	const app = Fastify();
	await registerDocumentRoutes(app, mockPool);

	const res = await app.inject({
		method: "GET",
		url: "/api/v1/deals/deal-1/documents/doc-1/visual-assets",
	});

	assert.equal(res.statusCode, 200);
	const body = res.json();
	assert.equal(body.deal_id, "deal-1");
	assert.equal(body.document_id, "doc-1");
	assert.equal(body.assets.length, 1);
	assert.equal(body.assets[0].id, "asset-1");
	assert.equal(body.assets[0].latest_extraction.id, "ext-1");
	assert.equal(body.assets[0].evidence.count, 2);
	assert.equal(body.assets[0].evidence.sample_snippets.length, 2);

	await app.close();
});
