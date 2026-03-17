import { expect, test } from "vitest";

import { persistPdfPageUnderstandingV1Shadow } from "../page-understanding-v1";

function makePoolMock(opts?: { regionAssets?: Array<{ id: string; bbox: any }>; patchRowCount?: number }) {
	const calls: Array<{ sql: string; params: any[] }> = [];
	const regionAssets = opts?.regionAssets ?? [];
	const patchRowCount = opts?.patchRowCount ?? 1; // default: UPDATE found a matching row
	const pool = {
		query: async (sql: string, params: any[]) => {
			calls.push({ sql, params });
			if (sql.includes("FROM visual_assets") && sql.includes("extractor_version = 'pdf_text_region_v1'")) {
				return { rows: regionAssets } as any;
			}
			if (sql.includes("UPDATE document_page_understanding")) {
				return { rows: [], rowCount: patchRowCount } as any;
			}
			return { rows: [], rowCount: 0 } as any;
		},
	} as any;
	return { pool, calls };
}

test("page understanding v1: mode=off persists nothing", async () => {
	const { pool, calls } = makePoolMock();
	const res = await persistPdfPageUnderstandingV1Shadow({
		pool,
		documentId: "doc_1",
		dealId: "deal_1",
		fullContent: {
			pdf_v2: {
				status: "ok",
				pages: [
					{
						page_index: 0,
						understanding_v1: { title: "T", regions: [{ role: "title", bbox: { x: 0.1, y: 0.1, w: 0.8, h: 0.1 }, text: "T", conf: 1 }, { role: "body", bbox: { x: 0.1, y: 0.3, w: 0.8, h: 0.2 }, text: "B", conf: 0.9 }, { role: "footer", bbox: { x: 0.1, y: 0.9, w: 0.8, h: 0.05 }, text: "F", conf: 0.8 }] },
					},
				],
			},
		},
		env: { PDF_PAGE_UNDERSTANDING_MODE: "off" } as any,
	});

	expect(res.persisted_pages).toBe(0);
	expect(res.attempted_pages).toBe(0);
	expect(calls.length).toBe(0);
});

test("page understanding v1: shadow patches for pages with understanding_v1", async () => {
	const { pool, calls } = makePoolMock({
		regionAssets: [
			{ id: "va_1", bbox: { x: 0.1, y: 0.1, w: 0.8, h: 0.1 } },
			{ id: "va_2", bbox: { x: 0.1, y: 0.3, w: 0.8, h: 0.2 } },
		],
		patchRowCount: 1,
	});

	const res = await persistPdfPageUnderstandingV1Shadow({
		pool,
		documentId: "doc_1",
		dealId: "deal_1",
		fullContent: {
			pdf_v2: {
				status: "ok",
				pages: [
					{
						page_index: 0,
						final: { text: "Fallback" },
						ocr_v2: {
							provider: "tesseract",
							avg_confidence: 0.5,
							blocks: [
								{ text: "TITLE", confidence: 0.9 },
								{ text: "###", confidence: 0.2 },
							],
						},
						understanding_v1: {
							title: "S MARKET PROBLEM",
							title_confidence: 0.8,
							title_candidates: [
							{ text: "S MARKET PROBLEM", score: 0.1, reasons: ["noisy"] },
							{ text: "Market problem", score: 0.9, reasons: ["title_region"] },
						],
							slide_type: "market",
							slide_type_confidence: 0.7,
							summary: "Summary",
							summary_confidence: 0.6,
							regions: [
								{ role: "title", bbox: { x: 0.1, y: 0.1, w: 0.8, h: 0.1 }, text: "S MARKET PROBLEM", conf: 1 },
								{ role: "body", bbox: { x: 0.1, y: 0.3, w: 0.8, h: 0.2 }, text: "BODY", conf: 0.9 },
								{ role: "footer", bbox: { x: 0.1, y: 0.9, w: 0.8, h: 0.05 }, text: "FOOT", conf: 0.8 },
							],
							key_metrics: [
								{
									label: "ARR",
									value: "$10M",
									unit: "USD",
									context: "Context",
									conf: 0.9,
									source_bbox: { bbox_units: "normalized", bbox: { x: 0.1, y: 0.3, w: 0.2, h: 0.1 } },
									source_text: "ARR $10M",
								},
							],
						},
					},
					{ page_index: 1 },
				],
			},
		},
		env: { PDF_PAGE_UNDERSTANDING_MODE: "shadow" } as any,
		now: "2026-01-21T00:00:00.000Z",
	});

	expect(res.attempted_pages).toBe(1);
	expect(res.persisted_pages).toBe(1);
	expect(res.skipped_no_target_row).toBe(0);

	// Must use UPDATE patch (not INSERT) to preserve existing text fields.
	const patches = calls.filter((c) => c.sql.includes("UPDATE document_page_understanding"));
	expect(patches.length).toBe(1);
	expect(patches[0].sql).toContain("payload = payload || $3::jsonb");
	expect(patches[0].sql).toContain("AND version = 'page_understanding_v1'");
	// Safety guard: must never touch rows without text fields.
	expect(patches[0].sql).toContain("payload->'text_blocks' IS NOT NULL");

	const patchJson = JSON.parse(patches[0].params[2]);
	// Patch must contain slide classification fields.
	expect(patchJson.resolved_slide_type).toBe("market");
	expect(patchJson.resolved_slide_type_confidence).toBe(0.7);
	expect(patchJson.slide_title).toBe("Market problem");
	expect(patchJson._slide_patch_version).toBe("v1");
	// Patch must NOT contain text fields that would overwrite production text extraction.
	expect(patchJson.page_text).toBeUndefined();
	expect(patchJson.text_blocks).toBeUndefined();
	expect(patchJson.structured).toBeUndefined();
	expect(patchJson.normalized_text).toBeUndefined();

	// Region linking should pick overlapping asset.
	expect(patchJson.slide_regions[0].linked_asset_id).toBe("va_1");
	// Metric linking should link to nearest-center or overlap.
	expect(patchJson.slide_key_metrics[0].linked_asset_id).toBeTruthy();
});

test("page understanding v1: idempotent patch shape", async () => {
	const { pool, calls } = makePoolMock({ patchRowCount: 1 });
	const fullContent = {
		pdf_v2: {
			status: "ok",
			pages: [
				{
					page_index: 0,
					understanding_v1: {
						title: "T",
						regions: [
							{ role: "title", bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.1 }, text: "A", conf: 1 },
							{ role: "body", bbox: { x: 0.1, y: 0.3, w: 0.2, h: 0.1 }, text: "B", conf: 0.9 },
							{ role: "footer", bbox: { x: 0.1, y: 0.9, w: 0.2, h: 0.05 }, text: "C", conf: 0.8 },
						],
					},
				},
			],
		},
	};

	await persistPdfPageUnderstandingV1Shadow({
		pool,
		documentId: "doc_1",
		dealId: "deal_1",
		fullContent,
		env: { PDF_PAGE_UNDERSTANDING_MODE: "shadow" } as any,
	});
	await persistPdfPageUnderstandingV1Shadow({
		pool,
		documentId: "doc_1",
		dealId: "deal_1",
		fullContent,
		env: { PDF_PAGE_UNDERSTANDING_MODE: "shadow" } as any,
	});

	const patches = calls.filter((c) => c.sql.includes("UPDATE document_page_understanding"));
	expect(patches.length).toBe(2);
	expect(patches[0].sql).toContain("payload = payload || $3::jsonb");
	expect(patches[1].sql).toContain("payload = payload || $3::jsonb");
});

test("page understanding v1: skipped_no_target_row when UPDATE matches nothing", async () => {
	const { pool } = makePoolMock({ patchRowCount: 0 });
	const res = await persistPdfPageUnderstandingV1Shadow({
		pool,
		documentId: "doc_1",
		dealId: "deal_1",
		fullContent: {
			pdf_v2: {
				status: "ok",
				pages: [
					{
						page_index: 0,
						understanding_v1: {
							title: "T",
							regions: [
								{ role: "title", bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.1 }, text: "A", conf: 1 },
								{ role: "body", bbox: { x: 0.1, y: 0.3, w: 0.2, h: 0.1 }, text: "B", conf: 0.9 },
								{ role: "footer", bbox: { x: 0.1, y: 0.9, w: 0.2, h: 0.05 }, text: "C", conf: 0.8 },
							],
						},
					},
				],
			},
		},
		env: { PDF_PAGE_UNDERSTANDING_MODE: "shadow" } as any,
	});
	// attempted but not persisted — DPU row not yet present / no text field.
	expect(res.attempted_pages).toBe(1);
	expect(res.persisted_pages).toBe(0);
	expect(res.skipped_no_target_row).toBe(1);
});
