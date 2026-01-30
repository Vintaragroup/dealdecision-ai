import { describe, expect, it, beforeEach, afterEach } from "vitest";

import type { VisionExtractResponse } from "../visual-extraction";

describe("persistVisionResponse", () => {
	const originalEnv = { ...process.env };

	beforeEach(() => {
		process.env = { ...originalEnv };
	});

	afterEach(() => {
		process.env = { ...originalEnv };
	});

	it("persists visual_assets with non-null image_uri via pageImageUri fallback", async () => {
		const { persistVisionResponse } = await import("../visual-extraction.js");

		const observedImageUris: Array<string | null> = [];

		const pool = {
			query: async (sql: string, params?: any[]) => {
				const s = String(sql);

				// docKind resolution query
				if (s.includes("FROM documents") && s.includes("SELECT type")) {
					return { rows: [{ type: "pdf", extraction_metadata: {} }] };
				}

				// visual_assets insert
				if (s.includes("INSERT INTO visual_assets")) {
					// In upsertVisualAsset, image_uri is the 5th value (index 4)
					observedImageUris.push((params ?? [])[4] ?? null);
					return { rows: [{ id: "va_1" }] };
				}

				// evidence_links insert/update + visual_extractions insert/update
				return { rows: [], rowCount: 1 } as any;
			},
		} as any;

		const response: VisionExtractResponse = {
			document_id: "doc_1",
			page_index: 0,
			extractor_version: "vision_v1",
			assets: [
				{
					asset_type: "chart",
					bbox: { x: 0, y: 0, w: 10, h: 10 },
					confidence: 0.9,
					quality_flags: {},
					image_uri: null,
					image_hash: null,
					extraction: {
						ocr_text: "Revenue grew",
						ocr_blocks: [],
						structured_json: { title: "Revenue" },
						labels: {},
						confidence: 0.9,
					},
				},
			],
		};

		process.env.R2_ENDPOINT = "https://r2.example";
		process.env.R2_BUCKET = "bucket";
		const pageImageUri = "https://r2.example/bucket/key.png?X-Amz-Signature=deadbeef";
		const res = await persistVisionResponse(pool, response, { pageImageUri, env: process.env });

		expect(res.persisted).toBe(1);
		expect(res.withImageUri).toBe(1);
		expect(observedImageUris.length).toBe(1);
		expect(observedImageUris[0]).toBe("key.png");
	});

	it("falls back to response-level ocr_text/ocr_blocks when asset extraction omits them", async () => {
		const { persistVisionResponse } = await import("../visual-extraction.js");

		let observedOcrText: string | null = null;
		let observedBlocks: any[] | null = null;

		const pool = {
			query: async (sql: string, params?: any[]) => {
				const s = String(sql);

				// docKind resolution query
				if (s.includes("FROM documents") && s.includes("SELECT type")) {
					return { rows: [{ type: "application/pdf", extraction_metadata: {} }] };
				}

				// visual_assets insert
				if (s.includes("INSERT INTO visual_assets")) {
					return { rows: [{ id: "va_1" }] };
				}

				// visual_extractions insert/upsert
				if (s.includes("INSERT INTO visual_extractions")) {
					observedOcrText = (params ?? [])[1] ?? null;
					try {
						observedBlocks = JSON.parse(String((params ?? [])[2] ?? "[]"));
					} catch {
						observedBlocks = null;
					}
					return { rows: [], rowCount: 1 } as any;
				}

				return { rows: [], rowCount: 1 } as any;
			},
		} as any;

		const response: any = {
			document_id: "doc_1",
			page_index: 0,
			extractor_version: "vision_ocr_v1",
			ocr_text: "Top-level OCR text",
			ocr_blocks: [{ text: "A" }, { text: "B" }],
			assets: [
				{
					asset_type: "image_text",
					bbox: { x: 0, y: 0, w: 10, h: 10 },
					confidence: 0.9,
					quality_flags: {},
					image_uri: null,
					image_hash: null,
					extraction: {
						// Intentionally omit ocr_text/ocr_blocks to force response-level fallback
						structured_json: { segment_key: "unit_test" },
						labels: {},
						confidence: 0.9,
					},
				},
			],
		};

		const res = await persistVisionResponse(pool, response, { pageImageUri: null, env: process.env });
		expect(res.persisted).toBe(1);
		expect(observedOcrText).toBe("Top-level OCR text");
		expect(Array.isArray(observedBlocks)).toBe(true);
		expect((observedBlocks ?? []).length).toBe(2);
	});
});
