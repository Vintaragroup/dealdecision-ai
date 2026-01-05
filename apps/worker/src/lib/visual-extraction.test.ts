import { test } from "node:test";
import assert from "node:assert/strict";

import {
	getVisionExtractorConfig,
	upsertVisualAsset,
	persistVisionResponse,
} from "./visual-extraction";

function makePoolMock() {
	const calls: Array<{ sql: string; params: unknown[] }> = [];
	const pool = {
		query: async (sql: string, params: unknown[]) => {
			calls.push({ sql, params });
			// Return a fake id for visual_assets inserts
			if (sql.includes("INSERT INTO visual_assets")) {
				return { rows: [{ id: "00000000-0000-0000-0000-000000000001" }] } as any;
			}
			return { rows: [] } as any;
		},
	} as any;

	return { pool, calls };
}

test("getVisionExtractorConfig defaults are safe and disabled", () => {
	const cfg = getVisionExtractorConfig({} as any);
	assert.equal(cfg.enabled, false);
	assert.equal(cfg.visionWorkerUrl, "http://localhost:8000");
	assert.equal(cfg.extractorVersion, "vision_v1");
	assert.equal(cfg.timeoutMs, 8000);
	assert.equal(cfg.maxPages, 10);
});

test("upsertVisualAsset uses null-hash conflict target when image_hash is null", async () => {
	const { pool, calls } = makePoolMock();
	await upsertVisualAsset(pool, {
		documentId: "00000000-0000-0000-0000-000000000000",
		pageIndex: 0,
		assetType: "image_text",
		bbox: { x: 0, y: 0, w: 1, h: 1 },
		imageUri: "http://example.com/page0.png",
		imageHash: null,
		extractorVersion: "vision_v1",
		confidence: 0.5,
		qualityFlags: {},
	});

	assert.ok(calls[0].sql.includes("ON CONFLICT (document_id, page_index, extractor_version) WHERE image_hash IS NULL"));
});

test("upsertVisualAsset uses hash conflict target when image_hash is provided", async () => {
	const { pool, calls } = makePoolMock();
	await upsertVisualAsset(pool, {
		documentId: "00000000-0000-0000-0000-000000000000",
		pageIndex: 0,
		assetType: "image_text",
		bbox: { x: 0, y: 0, w: 1, h: 1 },
		imageUri: "http://example.com/page0.png",
		imageHash: "abc123",
		extractorVersion: "vision_v1",
		confidence: 0.5,
		qualityFlags: {},
	});

	assert.ok(calls[0].sql.includes("ON CONFLICT (document_id, page_index, extractor_version, image_hash)"));
});

test("persistVisionResponse writes assets + extraction + evidence link", async () => {
	const { pool, calls } = makePoolMock();

	const persisted = await persistVisionResponse(pool, {
		document_id: "00000000-0000-0000-0000-000000000000",
		page_index: 2,
		extractor_version: "vision_v1",
		assets: [
			{
				asset_type: "table",
				bbox: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
				confidence: 0.9,
				quality_flags: { stub: true },
				image_uri: null,
				image_hash: null,
				extraction: {
					ocr_text: "hello",
					ocr_blocks: [],
					structured_json: { rows: 1 },
					units: null,
					labels: {},
					model_version: null,
					confidence: 0.8,
				},
			},
		],
	});

	assert.equal(persisted, 1);
	assert.ok(calls.some((c) => c.sql.includes("INSERT INTO visual_assets")));
	assert.ok(calls.some((c) => c.sql.includes("INSERT INTO visual_extractions")));
	assert.ok(calls.some((c) => c.sql.includes("INSERT INTO evidence_links")));
});
