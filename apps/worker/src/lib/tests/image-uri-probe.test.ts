import { describe, expect, it, vi } from "vitest";

import { probeImageUriFetchability } from "../visual-extraction";

function makeResponse(params: { status: number; headers?: Record<string, string> }) {
	const headerMap = new Map<string, string>();
	for (const [k, v] of Object.entries(params.headers ?? {})) headerMap.set(k.toLowerCase(), v);
	return {
		status: params.status,
		headers: {
			get: (key: string) => headerMap.get(String(key).toLowerCase()) ?? null,
		},
		arrayBuffer: vi.fn(async () => new ArrayBuffer(1)),
	} as any;
}

describe("probeImageUriFetchability", () => {
	it("treats 206 from ranged GET as reachable (no HEAD)", async () => {
		const fetchImpl = vi.fn(async (_url: string, init?: any) => {
			if (init?.method === "HEAD") throw new Error("HEAD should not be used");
			expect(init?.method).toBe("GET");
			expect(init?.headers?.Range).toBe("bytes=0-0");
			return makeResponse({ status: 206, headers: { "content-type": "image/png" } });
		});

		const diag = await probeImageUriFetchability("https://r2.example/signed.png", { fetchImpl, timeoutMs: 1000 });
		expect(diag.ok).toBe(true);
		expect(diag.status).toBe(206);
		expect(diag.method).toBe("GET_RANGE");
		expect(diag.content_type).toBe("image/png");
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	// Regression: Cloudflare R2 presigned GET URLs return 403 for HEAD but 206 for GET+Range.
	// The probe must use GET+Range so it never triggers a 403 on a valid signed URL.
	it("succeeds with GET+Range even when HEAD would return 403 (presigned R2/S3 URL scenario)", async () => {
		const fetchImpl = vi.fn(async (_url: string, init?: any) => {
			const method = String(init?.method ?? "GET").toUpperCase();
			// Simulate SigV4-presigned GET URL: HEAD is not part of the signature → 403.
			if (method === "HEAD") {
				return makeResponse({ status: 403 });
			}
			// Ranged GET succeeds.
			expect(method).toBe("GET");
			expect(init?.headers?.Range).toBe("bytes=0-0");
			return makeResponse({ status: 206, headers: { "content-type": "image/png" } });
		});

		const diag = await probeImageUriFetchability("https://r2.example/presigned-get-only.png", { fetchImpl, timeoutMs: 1000 });
		expect(diag.ok).toBe(true);
		expect(diag.status).toBe(206);
		expect(diag.method).toBe("GET_RANGE");
		// The probe must never have called HEAD.
		const usedMethods = fetchImpl.mock.calls.map(([, init]: any[]) => String(init?.method ?? "GET").toUpperCase());
		expect(usedMethods).not.toContain("HEAD");
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it("treats 200 from ranged GET as reachable", async () => {
		const fetchImpl = vi.fn(async (_url: string, init?: any) => {
			// Some origins return 200 even with a Range header (range not supported but GET succeeds).
			expect(String(init?.method ?? "GET").toUpperCase()).toBe("GET");
			expect(init?.headers?.Range).toBe("bytes=0-0");
			return makeResponse({ status: 200, headers: { "content-type": "image/png" } });
		});

		const diag = await probeImageUriFetchability("https://cdn.example/page_0000.png", { fetchImpl, timeoutMs: 1000 });
		expect(diag.ok).toBe(true);
		expect(diag.status).toBe(200);
		expect(diag.method).toBe("GET_RANGE");
	});

	it("treats 4xx (other than 200/206) as unreachable", async () => {
		const fetchImpl = vi.fn(async () => makeResponse({ status: 403 }));
		const diag = await probeImageUriFetchability("https://r2.example/expired.png", { fetchImpl, timeoutMs: 1000 });
		expect(diag.ok).toBe(false);
		expect(diag.status).toBe(403);
		expect(diag.method).toBe("GET_RANGE");
	});

	it("treats network error as unreachable", async () => {
		const fetchImpl = vi.fn(async () => { throw new Error("ECONNREFUSED"); });
		const diag = await probeImageUriFetchability("https://r2.example/unreachable.png", { fetchImpl, timeoutMs: 1000 });
		expect(diag.ok).toBe(false);
		expect(diag.status).toBeNull();
		expect(diag.method).toBe("GET_RANGE");
		expect(diag.error).toContain("ECONNREFUSED");
	});
});
