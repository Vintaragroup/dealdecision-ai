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
});
