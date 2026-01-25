import { describe, expect, it, vi } from "vitest";

import { loadOriginalBytesFromDocumentStorage } from "./from-storage";

vi.mock("../r2", () => {
	return {
		downloadFromR2: vi.fn(async () => Buffer.from("pdf-bytes")),
	};
});

describe("loadOriginalBytesFromDocumentStorage", () => {
	it("returns null when storage_key missing", async () => {
		const pool = {
			query: vi.fn(async () => ({ rows: [{ storage_bucket: "b", storage_key: null, mime_type: "application/pdf" }] })),
		} as any;

		const res = await loadOriginalBytesFromDocumentStorage({ pool, documentId: "doc1", env: {} as any });
		expect(res).toBeNull();
	});

	it("downloads bytes when storage_key present", async () => {
		const pool = {
			query: vi.fn(async () => ({ rows: [{ storage_bucket: "bucket", storage_key: "key.pdf", mime_type: "application/pdf" }] })),
		} as any;

		const logger = { log: vi.fn(), warn: vi.fn() };
		const res = await loadOriginalBytesFromDocumentStorage({ pool, documentId: "doc2", env: { R2_BUCKET: "bucket" } as any, logger });
		expect(res).not.toBeNull();
		expect(res?.bytes.toString()).toBe("pdf-bytes");
		expect(res?.key).toBe("key.pdf");
		expect(logger.log).toHaveBeenCalled();
	});
});
