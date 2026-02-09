import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../r2", () => {
	return {
		getR2ObjectUrl: vi.fn(async ({ bucket, key }: any) => `https://signed.example/${bucket}/${key}`),
		r2ObjectExists: vi.fn(async () => true),
	};
});

describe("resolvePageImageUris (legacy metadata R2 keys)", () => {
	const originalEnv = { ...process.env };

	beforeEach(() => {
		process.env = { ...originalEnv };
	});

	afterEach(() => {
		process.env = { ...originalEnv };
	});

	it("signs non-http URIs from extraction_metadata when vision is remote (https) and R2 is configured", async () => {
		const { resolvePageImageUris } = await import("../visual-extraction.js");

		const pool = {
			query: vi.fn(async () => {
				return {
					rows: [
						{
							page_count: 2,
							extraction_metadata: {
								page_image_uris: [
									"deals/d/documents/x/rendered_pages/page_0000.png",
									"deals/d/documents/x/rendered_pages/page_0001.png",
								],
							},
						},
					],
				};
			}),
		} as any;

		process.env.VISION_BASE_URL = "https://vision.example";
		process.env.R2_BUCKET = "bucket";

		const uris = await resolvePageImageUris(pool, "doc_1", { env: process.env, logger: console } as any);
		expect(uris).toEqual([
			"https://signed.example/bucket/deals/d/documents/x/rendered_pages/page_0000.png",
			"https://signed.example/bucket/deals/d/documents/x/rendered_pages/page_0001.png",
		]);
	});

	it("does not sign non-http URIs from extraction_metadata when vision is local (http)", async () => {
		const { resolvePageImageUris } = await import("../visual-extraction.js");

		const pool = {
			query: vi.fn(async () => {
				return {
					rows: [
						{
							page_count: 2,
							extraction_metadata: {
								page_image_uris: [
									"deals/d/documents/x/rendered_pages/page_0000.png",
									"deals/d/documents/x/rendered_pages/page_0001.png",
								],
							},
						},
					],
				};
			}),
		} as any;

		process.env.VISION_BASE_URL = "http://vision.local";
		process.env.R2_BUCKET = "bucket";

		const uris = await resolvePageImageUris(pool, "doc_1", { env: process.env, logger: console } as any);
		expect(uris).toEqual([
			"deals/d/documents/x/rendered_pages/page_0000.png",
			"deals/d/documents/x/rendered_pages/page_0001.png",
		]);
	});
});
