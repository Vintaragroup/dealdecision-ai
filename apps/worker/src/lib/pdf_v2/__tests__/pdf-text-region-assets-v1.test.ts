import { expect, test } from "vitest";

import {
	buildPdfTextRegionStructuredAssetsV1,
	persistPdfV2TextRegionAssetsV1Shadow,
} from "../pdf-text-region-assets-v1";

function makePoolMock() {
	const calls: Array<{ sql: string; params: any[] }> = [];
	let idCounter = 1;
	const pool = {
		query: async (sql: string, params: any[]) => {
			calls.push({ sql, params });
			if (sql.includes("INSERT INTO visual_assets")) {
				const id = `00000000-0000-0000-0000-${String(idCounter).padStart(12, "0")}`;
				idCounter += 1;
				return { rows: [{ id }] } as any;
			}
			return { rows: [] } as any;
		},
	} as any;
	return { pool, calls };
}

test("PDF v2 text region assets: mode=off writes nothing", async () => {
	const { pool, calls } = makePoolMock();
	const fullContent = {
		pdf_v2: {
			pages: [
				{
					page_index: 0,
					understanding_v1: {
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

	const persisted = await persistPdfV2TextRegionAssetsV1Shadow({
		pool,
		documentId: "doc_1",
		dealId: "deal_1",
		fullContent,
		env: { PDF_V2_TEXT_REGION_ASSETS_MODE: "off" } as any,
	});

	expect(persisted).toBe(0);
	expect(calls.length).toBe(0);
});

test("PDF v2 text region assets: mode=shadow persists stable, bounded region assets", async () => {
	const { pool, calls } = makePoolMock();
	const documentId = "doc_1";

	const fullContent = {
		pdf_v2: {
			pages: [
				{
					page_index: 0,
					understanding_v1: {
						regions: [
							// Intentionally out-of-order to verify deterministic sorting.
							{ role: "footer", bbox: { x: 0.2, y: 0.9, w: 0.3, h: 0.05 }, text: "FTR", conf: 0.7 },
							{ role: "body", bbox: { x: 0.3, y: 0.2, w: 0.3, h: 0.1 }, text: "BODY2", conf: 0.9 },
							{ role: "title", bbox: { x: 0.1, y: 0.1, w: 0.8, h: 0.1 }, text: "TITLE", conf: 1 },
							{ role: "body", bbox: { x: 0.1, y: 0.2, w: 0.2, h: 0.1 }, text: "BODY1", conf: 0.95 },
						],
					},
				},
			],
		},
	};

	// Sanity-check builder behavior first.
	const built = buildPdfTextRegionStructuredAssetsV1({ documentId, dealId: "deal_1", fullContent });
	expect(built.length).toBe(4);
	expect(built.every((b) => b.pageIndex === 0)).toBe(true);
	expect(built[0].structured.asset_id).toBe(`pdf_text_region_v1:${documentId}:0:0`);

	const persisted = await persistPdfV2TextRegionAssetsV1Shadow({
		pool,
		documentId,
		dealId: "deal_1",
		fullContent,
		env: { PDF_V2_TEXT_REGION_ASSETS_MODE: "shadow" } as any,
	});

	expect(persisted).toBe(4);
	expect(persisted).toBeGreaterThanOrEqual(3);
	expect(persisted).toBeLessThanOrEqual(12);

	const assetInserts = calls.filter((c) => c.sql.includes("INSERT INTO visual_assets"));
	const extractionInserts = calls.filter((c) => c.sql.includes("INSERT INTO visual_extractions"));
	expect(assetInserts.length).toBe(4);
	expect(extractionInserts.length).toBe(4);

	// Ensure stable/deterministic asset IDs based on sorted region order.
	const assetIds = assetInserts.map((c) => String(c.params[5] ?? ""));
	expect(assetIds).toEqual([
		`pdf_text_region_v1:${documentId}:0:0`,
		`pdf_text_region_v1:${documentId}:0:1`,
		`pdf_text_region_v1:${documentId}:0:2`,
		`pdf_text_region_v1:${documentId}:0:3`,
	]);

	// Validate structured_json payload for one extraction.
	const structuredJsonRaw = extractionInserts[0].params[3];
	const structured = JSON.parse(String(structuredJsonRaw));
	expect(structured.kind).toBe("pdf_text_region");
	expect(structured.document_id).toBe(documentId);
	expect(structured.page_index).toBe(0);
	expect(structured.title).toBe("Page 1 – title");
	expect(structured.locator.document_id).toBe(documentId);
	expect(structured.locator.page_index).toBe(0);
	expect(structured.bbox_units).toBe("normalized");
	expect(structured.provenance.source).toBe("pdf_v2_understanding_v1");
	expect(structured.provenance.version).toBe("pdf_text_region_v1");
});
