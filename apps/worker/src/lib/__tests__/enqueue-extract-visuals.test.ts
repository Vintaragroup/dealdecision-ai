import { describe, expect, it, vi } from "vitest";
import { enqueueExtractVisualsIfPossible } from "../visual-extraction";

describe("enqueueExtractVisualsIfPossible", () => {
	it("enqueues with a sanitized jobId (no ':')", async () => {
		const queue = {
			add: vi.fn().mockResolvedValue({}),
		};

		const ok = await enqueueExtractVisualsIfPossible({
			pool: {} as any,
			queue,
			config: {
				enabled: true,
				visionWorkerUrl: "http://localhost:8000",
				extractorVersion: "v1",
				timeoutMs: 10_000,
				maxPages: 50,
			},
			documentId: "doc:123",
			dealId: "deal:456",
			imageUrisOverride: ["https://example.com/page_0000.png"],
		});

		expect(ok).toBe(true);
		expect(queue.add).toHaveBeenCalledTimes(1);

		const call = (queue.add as any).mock.calls[0];
		const opts = call[2];
		expect(opts.jobId).not.toContain(":");
		expect(String(opts.jobId)).toMatch(/^[A-Za-z0-9_-]+$/);
	});

	it("does not enqueue until rendered_pages_r2 is complete", async () => {
		const queue = {
			add: vi.fn().mockResolvedValue({}),
		};
		const pool = {
			query: vi.fn().mockResolvedValue({
				rows: [
					{
						page_count: 12,
						extraction_metadata: {
							rendered_pages_r2: { bucket: "bucket", prefix: "deals/d/documents/x/rendered_pages", format: "page_%04d.png" },
							rendered_pages_count: 12,
							rendered_pages_rendered: 0,
						},
					},
				],
			}),
		} as any;

		const ok = await enqueueExtractVisualsIfPossible({
			pool,
			queue,
			config: {
				enabled: true,
				visionWorkerUrl: "http://localhost:8000",
				extractorVersion: "v1",
				timeoutMs: 10_000,
				maxPages: 50,
			},
			documentId: "doc1",
			dealId: "deal1",
		});

		expect(ok).toBe(false);
		expect(queue.add).not.toHaveBeenCalled();
	});
});
