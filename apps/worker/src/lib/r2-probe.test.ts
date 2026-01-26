import { describe, expect, it } from "vitest";
import { computeChunkRangeForPage, probeHttpStatus } from "./r2-probe";

describe("computeChunkRangeForPage", () => {
	it("computes the correct chunk for a page", () => {
		expect(computeChunkRangeForPage({ pageIndex: 0, totalPages: 15, chunkSize: 10 })).toEqual({ start: 0, end: 10 });
		expect(computeChunkRangeForPage({ pageIndex: 9, totalPages: 15, chunkSize: 10 })).toEqual({ start: 0, end: 10 });
		expect(computeChunkRangeForPage({ pageIndex: 10, totalPages: 15, chunkSize: 10 })).toEqual({ start: 10, end: 15 });
		expect(computeChunkRangeForPage({ pageIndex: 14, totalPages: 15, chunkSize: 10 })).toEqual({ start: 10, end: 15 });
	});
});

describe("probeHttpStatus", () => {
	it("returns 404 when fetch returns 404", async () => {
		const res = await probeHttpStatus("https://example.com/missing", {
			fetchImpl: async () => ({ ok: false, status: 404 }),
		});
		expect(res.ok).toBe(false);
		expect(res.status).toBe(404);
		expect(res.timed_out).toBe(false);
	});
});
