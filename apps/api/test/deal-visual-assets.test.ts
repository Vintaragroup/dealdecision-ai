process.env.REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerDealRoutes } from "../src/routes/deals";
import { closeQueues } from "../src/lib/queue";

test.after(async () => {
	await closeQueues();
});

test("GET /api/v1/deals/:deal_id/visual-assets returns 200 with array for existing deal", async () => {
	const now = new Date("2026-01-05T00:00:00.000Z").toISOString();

	const rows = [
		{
			visual_asset_id: "va-1",
			id: "va-1",
			document_id: "doc-1",
			deal_id: "deal-1",
			page_index: 0,
			bbox: { x: 0, y: 0, w: 1, h: 1 },
			image_uri: "/uploads/rendered_pages/doc-1/page_000.png",
			image_hash: null,
			created_at: now,
			asset_type: "image_text",
			confidence: 0.8,
			quality_flags: {},
			extractor_version: "vision_v1",
			document_title: "Deck",
			document_type: "pdf",
			document_status: "processed",
			document_page_count: 10,
			evidence_count: 1,
			evidence_sample_snippets: ["Snippet"],
			has_extraction: true,
			structured_kind: "table",
			structured_summary: { totalRows: 5 },
			ocr_text: "hello",
			structured_json: { rows: [] },
		},
	];

	const mockPool = {
		query: async (sql: string, params: unknown[]) => {
			if (sql.includes("SELECT id FROM deals WHERE id = $1")) {
				assert.equal(params[0], "deal-1");
				return { rows: [{ id: "deal-1" }] };
			}
			if (sql.includes("to_regclass")) {
				return { rows: [{ oid: "ok" }] };
			}
			if (sql.includes("information_schema.columns")) {
				return { rows: [{ ok: 1 }] };
			}
			if (sql.includes("FROM visual_assets")) {
				return { rows };
			}
			throw new Error(`Unexpected query: ${sql}`);
		},
	} as any;

	const app = Fastify();
	await registerDealRoutes(app, mockPool);

	const res = await app.inject({ method: "GET", url: "/api/v1/deals/deal-1/visual-assets" });

	assert.equal(res.statusCode, 200);
	const body = res.json();
	assert.equal(body.deal_id, "deal-1");
	assert.ok(Array.isArray(body.visual_assets));
	assert.equal(body.visual_assets.length, 1);
	assert.equal(body.visual_assets[0].visual_asset_id, "va-1");
	assert.equal(body.visual_assets[0].document.id, "doc-1");

	await app.close();
});

test("GET /api/v1/deals/:deal_id/visual-assets returns 404 when deal missing", async () => {
	const mockPool = {
		query: async (sql: string, params: unknown[]) => {
			if (sql.includes("SELECT id FROM deals WHERE id = $1")) {
				assert.equal(params[0], "deal-missing");
				return { rows: [] };
			}
			if (sql.includes("to_regclass")) {
				return { rows: [{ oid: "ok" }] };
			}
			if (sql.includes("information_schema.columns")) {
				return { rows: [{ ok: 1 }] };
			}
			throw new Error(`Unexpected query: ${sql}`);
		},
	} as any;

	const app = Fastify();
	await registerDealRoutes(app, mockPool);

	const res = await app.inject({ method: "GET", url: "/api/v1/deals/deal-missing/visual-assets" });

	assert.equal(res.statusCode, 404);
	const body = res.json();
	assert.equal(body.error, "deal_not_found");
	assert.equal(body.deal_id, "deal-missing");

	await app.close();
});
