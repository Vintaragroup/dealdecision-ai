import { describe, expect, it } from "vitest";

describe("planChunkEnqueues", () => {
	it("enqueues two chunks for total_pages=15 chunk_size=10: [0,10) and [10,15)", async () => {
		const { planChunkEnqueues } = await import("../page-chunks.js");

		const planned = planChunkEnqueues({ totalPages: 15, chunkSize: 10 });
		expect(planned.chunks_enqueued).toBe(2);
		expect(planned.ranges).toEqual([
			{ start: 0, end: 10 },
			{ start: 10, end: 15 },
		]);
	});
});
