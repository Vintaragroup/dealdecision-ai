import { expect, test } from "vitest";

import {
	enqueueExtractVisualsIfPossible,
	getVisionExtractorConfig,
	resolvePageImageUris,
	upsertVisualAsset,
	persistVisionResponse,
	backfillVisualAssetImageUris,
	toTextLoose,
	inferSegmentKeyFromStructured,
	persistSyntheticVisualAssets,
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
	expect(cfg.enabled).toBe(false);
	expect(cfg.visionWorkerUrl).toBe("http://localhost:8000");
	expect(cfg.extractorVersion).toBe("vision_v1");
	expect(cfg.timeoutMs).toBe(8000);
	// Default aligns with rendered-pages config to cover large decks while allowing env override.
	expect(cfg.maxPages).toBe(50);
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

	expect(calls[0].sql.includes("ON CONFLICT (document_id, page_index, extractor_version) WHERE image_hash IS NULL")).toBe(true);
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

	expect(calls[0].sql.includes("ON CONFLICT (document_id, page_index, extractor_version, image_hash)")).toBe(true);
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

	expect(rowsByKey.get(key)?.image_uri).toBe("");
	expect(
		calls[0].sql.includes("image_uri = COALESCE(NULLIF(visual_assets.image_uri,''), EXCLUDED.image_uri)")
	).toBe(true);

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

	expect(rowsByKey.get(key)?.image_uri).toBe("/uploads/rendered_pages/doc/page_001.png");
});

test("persistVisionResponse writes assets + extraction + evidence link", async () => {
	const { pool, calls } = makePoolMock();

	const { persisted } = await persistVisionResponse(pool, {
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

	expect(persisted).toBe(1);
	expect(calls.some((c) => c.sql.includes("INSERT INTO visual_assets"))).toBe(true);
	expect(calls.some((c) => c.sql.includes("INSERT INTO visual_extractions"))).toBe(true);
	expect(calls.some((c) => c.sql.includes("INSERT INTO evidence_links"))).toBe(true);
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
	expect(uris).toEqual([]);
	expect(logs.some((l) => l.includes("NO_PAGE_IMAGES_AVAILABLE"))).toBe(true);
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
	expect(ok).toBe(false);
	expect(added).toBe(0);

	// sanity: ensure our resolve stub indeed returns none
	const uris = await resolvePageImageUris(pool as any, "00000000-0000-0000-0000-000000000000", { fsImpl });
	expect(uris).toHaveLength(0);
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

	expect(ok).toBe(true);
	expect(captured).toBeTruthy();
	expect(captured.document_id).toBe("doc-123");
	expect(captured.deal_id).toBe("deal-456");
	expect(captured.extractor_version).toBe("vision_v1");
	expect(Array.isArray(captured.image_uris)).toBe(true);
	expect(captured.image_uris).toHaveLength(2);

	// Also validate resolver ordering produces absolute paths containing the expected filenames.
	const uris = await resolvePageImageUris(pool as any, "doc-123", { fsImpl, logger: { log: () => {}, warn: () => {} } as any });
	expect(uris[0].endsWith("page_001_raw.png")).toBe(true);
	expect(uris[1].endsWith("page_002_raw.png")).toBe(true);
});

test("structured_word text canonicalization never leaks [object Object]", () => {
	const paragraphNode = {
		children: [
			{ text: "Hello" },
			{ runs: [{ text: " " }, { text: "world" }] },
			{ items: [{ content: " from" }, { value: " Word" }] },
		],
	};

	const out = toTextLoose([paragraphNode, "[object Object]", { text: "Solution" }]);
	expect(out).toContain("Hello");
	expect(out).toContain("world");
	expect(out).toContain("Solution");
	expect(out).not.toContain("[object Object]");

	const structuredJson = {
		kind: "word_section",
		heading: "Solution value proposition why us",
		paragraphs: [
			paragraphNode,
			{ text: "Our solution helps customers." },
			"[object Object]",
		],
	};

	const seg = inferSegmentKeyFromStructured({
		structuredJson,
		source: "structured_word",
		documentTitle: "Test Doc",
	});

	// Stable keyword-based classification (should not be derailed by poisoning artifacts).
	expect(seg).toBe("solution");
});

test("persistSyntheticVisualAssets skips empty word_section sections", async () => {
	const { pool, calls } = makePoolMock();

	const persisted = await persistSyntheticVisualAssets({
		pool,
		documentId: "00000000-0000-0000-0000-000000000000",
		docKind: "word",
		structuredData: {},
		fullContent: {
			sections: [
				{ heading: null, paragraphs: [], text: "", tables: [] },
				{ heading: "Product", paragraphs: ["This is a real section."], text: "", tables: [] },
			],
		},
		extractorVersion: "structured_native_v1",
		env: { UPLOAD_DIR: "/tmp" } as any,
	});

	expect(persisted).toBe(1);

	const inserts = calls.filter((c) => c.sql.includes("INSERT INTO visual_assets"));
	expect(inserts).toHaveLength(1);
});

test("persistSyntheticVisualAssets coalesces many small word sections", async () => {
	const { pool, calls } = makePoolMock();

	const sections = Array.from({ length: 40 }).map((_, i) => ({
		heading: null,
		paragraphs: [`Section ${i + 1}: short.`],
		text: "",
		tables: [],
	}));

	const persisted = await persistSyntheticVisualAssets({
		pool,
		documentId: "00000000-0000-0000-0000-000000000000",
		docKind: "word",
		structuredData: {},
		fullContent: { sections },
		extractorVersion: "structured_native_v1",
		env: { UPLOAD_DIR: "/tmp" } as any,
	});

	// With coalescing, we should emit far fewer assets than the raw section count.
	expect(persisted).toBeGreaterThan(0);
	expect(persisted).toBeLessThan(40);

	const inserts = calls.filter((c) => c.sql.includes("INSERT INTO visual_assets"));
	expect(inserts.length).toBe(persisted);
});

test("persistSyntheticVisualAssets adds investor/analyst summaries for excel sheets", async () => {
	const { pool, calls } = makePoolMock();

	const persisted = await persistSyntheticVisualAssets({
		pool,
		documentId: "00000000-0000-0000-0000-000000000000",
		docKind: "excel",
		structuredData: {},
		fullContent: {
			sheets: [
				{
					name: "Revenue",
					headers: ["col_A", "Month 1", "Month 2", "Month 3"],
					summary: { totalRows: 12, numericColumns: ["Month 1", "Month 2", "Month 3"], columnTypes: { col_A: "text" } },
					gridPreview: {
						maxRows: 10,
						maxCols: 6,
						cells: [
							{ a: "A1", w: "Metric" },
							{ a: "A2", w: "Revenue" },
							{ a: "A3", w: "COGS" },
							{ a: "B2", v: 1000 },
							{ a: "C2", v: 1200 },
						],
					},
				},
			],
		},
		extractorVersion: "structured_native_v1",
		env: { UPLOAD_DIR: "/tmp" } as any,
	});

	expect(persisted).toBeGreaterThan(0);

	const extractionInserts = calls.filter((c) => c.sql.includes("INSERT INTO visual_extractions"));
	expect(extractionInserts.length).toBeGreaterThan(0);

	// upsertVisualExtraction params: [visualAssetId, ocrText, ocrBlocks, structuredJson, units, labels, extractorVersion, modelVersion, confidence]
	const structuredJsonRaw = extractionInserts[0].params[3] as string;
	const sj = JSON.parse(structuredJsonRaw);

	expect(sj.kind).toBe("excel_sheet");
	expect(typeof sj.summary_text_investor).toBe("string");
	expect(typeof sj.summary_text_analyst).toBe("string");
	expect(sj.summary_text_investor.length).toBeGreaterThan(10);
	expect(sj.summary_text_analyst.length).toBeGreaterThan(10);
	expect(sj.understanding_v1?.schema_version).toBe("excel_sheet_understanding_v1");
	expect(sj.understanding_v1?.sheet_name).toBe("Revenue");
	expect(sj.understanding_v1?.metrics_v1?.schema_version).toBe("excel_sheet_metrics_v1");
	expect(["grid_preview", "time_series_table", "sheet_rows", "none"]).toContain(sj.understanding_v1?.metrics_v1?.source);
	// For this fixture, we should be able to compute a key series from the grid preview.
	expect(sj.understanding_v1?.metrics_v1?.key_series?.label).toBe("Revenue");
	expect(typeof sj.understanding_v1?.metrics_v1?.key_series?.end_value).toBe("number");
});

test("persistSyntheticVisualAssets computes use_of_funds distribution metrics for excel sheets", async () => {
	const { pool, calls } = makePoolMock();

	const persisted = await persistSyntheticVisualAssets({
		pool,
		documentId: "00000000-0000-0000-0000-000000000000",
		docKind: "excel",
		structuredData: {},
		fullContent: {
			sheets: [
				{
					name: "Allocation of funds",
					headers: ["Category", "Amount", "Percent"],
					rows: [
						{ Category: "Product", Amount: 400000, Percent: "40%" },
						{ Category: "Sales & Marketing", Amount: 350000, Percent: "35%" },
						{ Category: "Operations", Amount: 250000, Percent: "25%" },
					],
					summary: { totalRows: 3, numericColumns: ["Amount", "Percent"], columnTypes: { Category: "text" } },
					gridPreview: { maxRows: 10, maxCols: 6, cells: [{ a: "A1", w: "Category" }, { a: "B1", w: "Amount" }] },
				},
			],
		},
		extractorVersion: "structured_native_v1",
		env: { UPLOAD_DIR: "/tmp" } as any,
	});

	expect(persisted).toBeGreaterThan(0);

	const extractionInserts = calls.filter((c) => c.sql.includes("INSERT INTO visual_extractions"));
	expect(extractionInserts.length).toBeGreaterThan(0);

	const structuredJsonRaw = extractionInserts[0].params[3] as string;
	const sj = JSON.parse(structuredJsonRaw);

	expect(sj.kind).toBe("excel_sheet");
	expect(sj.understanding_v1?.schema_version).toBe("excel_sheet_understanding_v1");
	expect(sj.understanding_v1?.detected_type).toBe("use_of_funds");
	expect(sj.understanding_v1?.metrics_v1?.schema_version).toBe("excel_sheet_metrics_v1");
	expect(sj.understanding_v1?.metrics_v1?.distribution?.total_value).toBe(1000000);
	expect(Array.isArray(sj.understanding_v1?.metrics_v1?.distribution?.top_categories)).toBe(true);
	expect(sj.understanding_v1?.metrics_v1?.distribution?.top_categories?.[0]?.label).toBe("Product");
	expect(sj.understanding_v1?.metrics_v1?.distribution?.percent_column_sum?.within_tolerance).toBe(true);
	expect(typeof sj.summary_text_investor).toBe("string");
	expect(sj.summary_text_investor.length).toBeGreaterThan(10);
});

test("persistSyntheticVisualAssets computes use_of_funds distribution from grid preview when rows missing", async () => {
	const { pool, calls } = makePoolMock();

	const persisted = await persistSyntheticVisualAssets({
		pool,
		documentId: "00000000-0000-0000-0000-000000000000",
		docKind: "excel",
		structuredData: {},
		fullContent: {
			sheets: [
				{
					name: "Allocation of funds",
					headers: ["Category", "Amount", "Percent"],
					// Intentionally omit rows to force gridPreview path.
					summary: { totalRows: 10, numericColumns: ["Amount", "Percent"], columnTypes: { Category: "text" } },
					gridPreview: {
						maxRows: 10,
						maxCols: 6,
						cells: [
							{ a: "A1", w: "Category" },
							{ a: "B1", w: "Amount" },
							{ a: "C1", w: "Percent" },
							{ a: "A2", w: "Product" },
							{ a: "B2", v: 400000 },
							{ a: "C2", w: "40%" },
							{ a: "A3", w: "Sales & Marketing" },
							{ a: "B3", v: 350000 },
							{ a: "C3", w: "35%" },
							{ a: "A4", w: "Operations" },
							{ a: "B4", v: 250000 },
							{ a: "C4", w: "25%" },
						],
					},
				},
			],
		},
		extractorVersion: "structured_native_v1",
		env: { UPLOAD_DIR: "/tmp" } as any,
	});

	expect(persisted).toBeGreaterThan(0);
	const extractionInserts = calls.filter((c) => c.sql.includes("INSERT INTO visual_extractions"));
	expect(extractionInserts.length).toBeGreaterThan(0);

	const sj = JSON.parse(extractionInserts[0].params[3] as string);
	expect(sj.understanding_v1?.detected_type).toBe("use_of_funds");
	expect(sj.understanding_v1?.metrics_v1?.schema_version).toBe("excel_sheet_metrics_v1");
	expect(sj.understanding_v1?.metrics_v1?.distribution?.total_value).toBe(1000000);
	expect(sj.understanding_v1?.metrics_v1?.distribution?.top_categories?.[0]?.label).toBe("Product");
	expect(sj.understanding_v1?.metrics_v1?.distribution?.percent_column_sum?.within_tolerance).toBe(true);
	// Investor summary should now lead with a grounded total.
	expect(String(sj.summary_text_investor)).toMatch(/Use of funds totals/i);
});

test("persistSyntheticVisualAssets computes time_series_table metrics when values keyed by header", async () => {
	const { pool, calls } = makePoolMock();

	const persisted = await persistSyntheticVisualAssets({
		pool,
		documentId: "00000000-0000-0000-0000-000000000000",
		docKind: "excel",
		structuredData: {},
		fullContent: {
			sheets: [
				{
					name: "Revenue",
					headers: ["Metric", "Month 1", "Month 2", "Month 3", "Month 4", "Month 5", "Month 6"],
					tables: [
						{
							kind: "time_series",
							name: "Revenue table",
							label_col: "A",
							value_cols: [
								{ col: "B", header: "Month 1" },
								{ col: "C", header: "Month 2" },
								{ col: "D", header: "Month 3" },
								{ col: "E", header: "Month 4" },
								{ col: "F", header: "Month 5" },
								{ col: "G", header: "Month 6" },
							],
							rows: [
								{
									label: "Revenue",
									values: {
										"Month 1": { value: 1000 },
										"Month 2": { value: 1200 },
										"Month 3": { value: 1500 },
										"Month 4": { value: 1700 },
										"Month 5": { value: 1800 },
										"Month 6": { value: 2000 },
									},
								},
							],
						},
					],
					summary: { totalRows: 10, numericColumns: ["Month 1", "Month 2"], columnTypes: { Metric: "text" } },
					gridPreview: { maxRows: 10, maxCols: 6, cells: [{ a: "A1", w: "Metric" }, { a: "A2", w: "Revenue" }] },
				},
			],
		},
		extractorVersion: "structured_native_v1",
		env: { UPLOAD_DIR: "/tmp" } as any,
	});

	expect(persisted).toBeGreaterThan(0);
	const extractionInserts = calls.filter((c) => c.sql.includes("INSERT INTO visual_extractions"));
	expect(extractionInserts.length).toBeGreaterThan(0);

	const sj = JSON.parse(extractionInserts[0].params[3] as string);
	const m = sj.understanding_v1?.metrics_v1;
	expect(m?.schema_version).toBe("excel_sheet_metrics_v1");
	expect(m?.source).toBe("time_series_table");
	expect(m?.quality?.numeric_cells).toBeGreaterThan(0);
	expect(m?.key_series?.label).toBe("Revenue");
	expect(m?.key_series?.start_value).toBe(1000);
	expect(m?.key_series?.end_value).toBe(2000);
});

test("persistSyntheticVisualAssets derives a revenue key series when the Revenue row is empty", async () => {
	const { pool, calls } = makePoolMock();

	const persisted = await persistSyntheticVisualAssets({
		pool,
		documentId: "00000000-0000-0000-0000-000000000000",
		docKind: "excel",
		structuredData: {},
		fullContent: {
			sheets: [
				{
					name: "Revenue",
					headers: ["Metric", "Month 1", "Month 2", "Month 3", "Month 4", "Month 5", "Month 6"],
					tables: [
						{
							kind: "time_series",
							name: "Revenue table",
							label_col: "A",
							value_cols: [
								{ col: "B", header: "Month 1" },
								{ col: "C", header: "Month 2" },
								{ col: "D", header: "Month 3" },
								{ col: "E", header: "Month 4" },
								{ col: "F", header: "Month 5" },
								{ col: "G", header: "Month 6" },
							],
							rows: [
								{
									label: "Revenue",
									values: {
										"Month 1": {},
										"Month 2": {},
										"Month 3": {},
										"Month 4": {},
										"Month 5": {},
										"Month 6": {},
									},
								},
								{
									label: "Small MW deals",
									values: {
										"Month 1": { value: 10 },
										"Month 2": { value: 20 },
										"Month 3": { value: 30 },
										"Month 4": { value: 40 },
										"Month 5": { value: 50 },
										"Month 6": { value: 60 },
									},
								},
								{
									label: "Custom MW deals",
									values: {
										"Month 1": { value: 5 },
										"Month 2": { value: 5 },
										"Month 3": { value: 10 },
										"Month 4": { value: 10 },
										"Month 5": { value: 15 },
										"Month 6": { value: 15 },
									},
								},
							],
						},
					],
					summary: { totalRows: 10, numericColumns: ["Month 1", "Month 2"], columnTypes: { Metric: "text" } },
					gridPreview: { maxRows: 10, maxCols: 6, cells: [{ a: "A1", w: "Metric" }, { a: "A2", w: "Revenue" }] },
				},
			],
		},
		extractorVersion: "structured_native_v1",
		env: { UPLOAD_DIR: "/tmp" } as any,
	});

	expect(persisted).toBeGreaterThan(0);
	const extractionInserts = calls.filter((c) => c.sql.includes("INSERT INTO visual_extractions"));
	expect(extractionInserts.length).toBeGreaterThan(0);

	const sj = JSON.parse(extractionInserts[0].params[3] as string);
	const m = sj.understanding_v1?.metrics_v1;
	expect(m?.schema_version).toBe("excel_sheet_metrics_v1");
	expect(m?.source).toBe("time_series_table");
	expect(String(m?.key_series?.label)).toMatch(/Estimated total/i);
	expect(m?.key_series?.start_value).toBe(15);
	expect(m?.key_series?.end_value).toBe(75);
	// Investor summary should lead with evidence instead of structure-only text.
	expect(String(sj.summary_text_investor)).toMatch(/changes from/i);
});

test("backfillVisualAssetImageUris updates missing image_uri when page image exists", async () => {
	const calls: any[] = [];
	const pool = {
		query: async (sql: string, params: any[]) => {
			calls.push({ sql, params });
			return { rowCount: 1 } as any;
		},
	} as any;

	const env = { UPLOAD_DIR: "/app/uploads" } as any;
	const res = await backfillVisualAssetImageUris({
		pool,
		documentId: "doc-1",
		pageImageUris: ["/app/uploads/rendered_pages/doc-1/page_000.png", "/tmp/unknown.png"],
		env,
	});

	expect(res.updated).toBe(1);
	expect(calls[0].params[0]).toBe("doc-1");
	expect(calls[0].params[1]).toBe(0);
	expect(calls[0].params[2]).toBe("/uploads/rendered_pages/doc-1/page_000.png");
	expect(calls.length).toBe(1);
});
