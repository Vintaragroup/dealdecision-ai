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
});
