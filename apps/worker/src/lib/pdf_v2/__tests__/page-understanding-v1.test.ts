import { expect, test } from "vitest";

import { persistPdfPageUnderstandingV1Shadow } from "../page-understanding-v1";

function makePoolMock(opts?: { regionAssets?: Array<{ id: string; bbox: any }> }) {
	const calls: Array<{ sql: string; params: any[] }> = [];
	const regionAssets = opts?.regionAssets ?? [];
	const pool = {
		query: async (sql: string, params: any[]) => {
			calls.push({ sql, params });
			if (sql.includes("FROM visual_assets") && sql.includes("extractor_version = 'pdf_text_region_v1'")) {
				return { rows: regionAssets } as any;
			}
			return { rows: [] } as any;
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

test("page understanding v1: shadow upserts for pages with understanding_v1", async () => {
	const { pool, calls } = makePoolMock({
		regionAssets: [
			{ id: "va_1", bbox: { x: 0.1, y: 0.1, w: 0.8, h: 0.1 } },
			{ id: "va_2", bbox: { x: 0.1, y: 0.3, w: 0.8, h: 0.2 } },
		],
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

	const upserts = calls.filter((c) => c.sql.includes("INSERT INTO document_page_understanding"));
	expect(upserts.length).toBe(1);
	expect(upserts[0].sql).toContain("ON CONFLICT (document_id, page_index, version)");

	const payloadRaw = String(upserts[0].params[4]);
	const payload = JSON.parse(payloadRaw);
	expect(payload.version).toBe("page_understanding_v1");
	expect(payload.document_id).toBe("doc_1");
	expect(payload.page_index).toBe(0);
	expect(payload.inputs.region_asset_count).toBe(2);
	expect(payload.resolved_title).toBe("Market problem");
	expect(payload.resolved_title_source).toBe("understanding_v1.title_candidate");
	expect(payload.resolved_title_meta.title_candidates_count).toBe(2);

	// Region linking should pick overlapping asset.
	expect(payload.regions[0].linked_asset_id).toBe("va_1");
	// Metric linking should link to nearest-center or overlap.
	const km0 = payload.key_metrics[0];
	expect(km0.linked_asset_id).toBeTruthy();
});

test("page understanding v1: idempotent upsert shape", async () => {
	const { pool, calls } = makePoolMock();
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

	const upserts = calls.filter((c) => c.sql.includes("INSERT INTO document_page_understanding"));
	expect(upserts.length).toBe(2);
	expect(upserts[0].sql).toContain("ON CONFLICT (document_id, page_index, version)");
	expect(upserts[1].sql).toContain("ON CONFLICT (document_id, page_index, version)");
});
