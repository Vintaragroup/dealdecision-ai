import { test } from "node:test";
import assert from "node:assert/strict";

import {
	enqueueExtractVisualsIfPossible,
	getVisionExtractorConfig,
	resolvePageImageUris,
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

function makeVisualAssetsStatePoolMock() {
	const calls: Array<{ sql: string; params: unknown[] }> = [];
	const rowsByKey = new Map<string, { id: string; image_uri: string | null }>();
	const pool = {
		query: async (sql: string, params: unknown[]) => {
			calls.push({ sql, params });
			if (!sql.includes("INSERT INTO visual_assets")) {
				return { rows: [] } as any;
			}

			const documentId = String(params[0] ?? "");
			const pageIndex = Number(params[1] ?? 0);
			const imageUri = (params[4] ?? null) as string | null;
			const imageHash = (params[5] ?? null) as string | null;
			const extractorVersion = String(params[6] ?? "");

			const key = `${documentId}::${pageIndex}::${extractorVersion}::${imageHash ?? "__null__"}`;
			const existing = rowsByKey.get(key);
			const id = existing?.id ?? "00000000-0000-0000-0000-000000000001";

			// Simulate the intended UPSERT backfill semantics:
			// image_uri = COALESCE(NULLIF(visual_assets.image_uri,''), EXCLUDED.image_uri)
			const existingUri = existing?.image_uri ?? null;
			const backfilled = existingUri && existingUri !== "" ? existingUri : imageUri;

			rowsByKey.set(key, { id, image_uri: backfilled });
			return { rows: [{ id }] } as any;
		},
	} as any;

	return { pool, calls, rowsByKey };
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

test("upsertVisualAsset backfills empty image_uri on conflict", async () => {
	const { pool, calls, rowsByKey } = makeVisualAssetsStatePoolMock();
	const documentId = "00000000-0000-0000-0000-000000000000";
	const extractorVersion = "vision_v1";
	const key = `${documentId}::0::${extractorVersion}::__null__`;

	await upsertVisualAsset(pool, {
		documentId,
		pageIndex: 0,
		assetType: "image_text",
		bbox: { x: 0, y: 0, w: 1, h: 1 },
		imageUri: "",
		imageHash: null,
		extractorVersion,
		confidence: 0.5,
		qualityFlags: {},
	});

	assert.equal(rowsByKey.get(key)?.image_uri, "");
	assert.ok(
		calls[0].sql.includes("image_uri = COALESCE(NULLIF(visual_assets.image_uri,''), EXCLUDED.image_uri)")
	);

	await upsertVisualAsset(pool, {
		documentId,
		pageIndex: 0,
		assetType: "image_text",
		bbox: { x: 0, y: 0, w: 1, h: 1 },
		imageUri: "/uploads/rendered_pages/doc/page_001.png",
		imageHash: null,
		extractorVersion,
		confidence: 0.5,
		qualityFlags: {},
	});

	assert.equal(rowsByKey.get(key)?.image_uri, "/uploads/rendered_pages/doc/page_001.png");
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

test("resolvePageImageUris returns [] and logs NO_PAGE_IMAGES_AVAILABLE when dirs missing", async () => {
	const logs: string[] = [];
	const logger = {
		log: (s: any) => logs.push(String(s)),
		warn: (s: any) => logs.push(String(s)),
		error: (s: any) => logs.push(String(s)),
	};

	const pool = {
		query: async () => ({ rows: [{ page_count: 3, extraction_metadata: null }] }),
	} as any;

	const fsImpl = {
		stat: async () => {
			throw new Error("ENOENT");
		},
		readdir: async () => [],
	} as any;

	const uris = await resolvePageImageUris(pool, "00000000-0000-0000-0000-000000000000", { logger, fsImpl });
	assert.deepEqual(uris, []);
	assert.ok(logs.some((l) => l.includes("NO_PAGE_IMAGES_AVAILABLE")));
});

test("enqueueExtractVisualsIfPossible does not enqueue when resolver finds no images", async () => {
	const pool = {
		query: async () => ({ rows: [{ page_count: 2, extraction_metadata: null }] }),
	} as any;

	const fsImpl = {
		stat: async () => {
			throw new Error("ENOENT");
		},
		readdir: async () => [],
	} as any;

	// Monkeypatch by calling resolve directly via env-less option: pass a logger/fsImpl through pool wrapper
	let added = 0;
	const queue = {
		add: async () => {
			added += 1;
		},
	};

	const cfg = { ...getVisionExtractorConfig({} as any), enabled: true, extractorVersion: "vision_v1" };

	const ok = await enqueueExtractVisualsIfPossible({
		pool: pool as any,
		queue,
		config: cfg,
		documentId: "00000000-0000-0000-0000-000000000000",
		dealId: "00000000-0000-0000-0000-000000000999",
		logger: { log: () => {}, warn: () => {}, error: () => {} } as any,
		resolveOptions: { fsImpl },
	});

	// If enqueue helper returns false, it skipped. Also verify queue.add not called.
	assert.equal(ok, false);
	assert.equal(added, 0);

	// sanity: ensure our resolve stub indeed returns none
	const uris = await resolvePageImageUris(pool as any, "00000000-0000-0000-0000-000000000000", { fsImpl });
	assert.equal(uris.length, 0);
});

test("enqueueExtractVisualsIfPossible enqueues with extractor_version and image_uris when images exist", async () => {
	const pool = {
		query: async () => ({ rows: [{ page_count: 2, extraction_metadata: null }] }),
	} as any;

	const fsImpl = {
		stat: async () => ({ isDirectory: () => true }),
		readdir: async () => ["page_001_raw.png", "page_002_raw.png"],
	} as any;

	let captured: any = null;
	const queue = {
		add: async (_name: string, data: any) => {
			captured = data;
		},
	};

	const cfg = { ...getVisionExtractorConfig({} as any), enabled: true, extractorVersion: "vision_v1" };

	// Force resolver to look only at /tmp path by using a documentId that maps there.
	// It will find our mocked files there.
	const ok = await enqueueExtractVisualsIfPossible({
		pool: pool as any,
		queue,
		config: cfg,
		documentId: "doc-123",
		dealId: "deal-456",
		logger: { log: () => {}, warn: () => {}, error: () => {} } as any,
		resolveOptions: { fsImpl },
	});

	assert.equal(ok, true);
	assert.ok(captured);
	assert.equal(captured.document_id, "doc-123");
	assert.equal(captured.deal_id, "deal-456");
	assert.equal(captured.extractor_version, "vision_v1");
	assert.ok(Array.isArray(captured.image_uris));
	assert.equal(captured.image_uris.length, 2);

	// Also validate resolver ordering produces absolute paths containing the expected filenames.
	const uris = await resolvePageImageUris(pool as any, "doc-123", { fsImpl, logger: { log: () => {}, warn: () => {} } as any });
	assert.ok(uris[0].endsWith("page_001_raw.png"));
	assert.ok(uris[1].endsWith("page_002_raw.png"));
});
