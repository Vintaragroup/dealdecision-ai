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

		const pageImageUri = "https://r2.example/bucket/key.png";
		const res = await persistVisionResponse(pool, response, { pageImageUri, env: process.env });

		expect(res.persisted).toBe(1);
		expect(res.withImageUri).toBe(1);
		expect(observedImageUris.length).toBe(1);
		expect(observedImageUris[0]).toBe(pageImageUri);
	});
});
