/**
 * PR1 — XLSX Worker Visibility: unit tests for callXlsxWorker + callXlsxWorkerWithRetries.
 *
 * Coverage:
 *  - ok:true path (success logs emitted, payload returned)
 *  - HTTP 5xx → XLSX_WORKER_UNAVAILABLE, retryable:true
 *  - HTTP 4xx → XLSX_BAD_INPUT, retryable:false (no retries)
 *  - AbortError → XLSX_TIMEOUT, retryable:true
 *  - Network throw (ECONNREFUSED) → XLSX_WORKER_UNAVAILABLE, retryable:true
 *  - 3x retries on 503 → XLSX_WORKER_EXHAUSTED emitted
 *  - No retry on non-retryable error
 *  - Succeeds on 3rd attempt after two 503s
 *  - Compile guard: result is always XlsxWorkerResult (never null)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { callXlsxWorker, callXlsxWorkerWithRetries } from "../lib/visual-extraction";
import type { XlsxWorkerResult } from "../lib/visual-extraction";

// ── fixtures ──────────────────────────────────────────────────────────────────

const BASE_CONFIG = {
	enabled: true,
	visionWorkerUrl: "http://localhost:9999",
	extractorVersion: "excel_py_v1",
	timeoutMs: 5000,
	maxPages: 50,
};

const BASE_REQUEST = {
	document_id: "doc-xlsx-test",
	xlsx_b64: Buffer.from("fake-xlsx-bytes").toString("base64"),
	extractor_version: "excel_py_v1",
};

const MOCK_SUCCESS_RESPONSE = {
	document_id: "doc-xlsx-test",
	extractor_version: "excel_py_v1",
	pages: [
		{
			document_id: "doc-xlsx-test",
			page_index: 0,
			extractor_version: "excel_py_v1",
			assets: [],
		},
	],
};

function makeMockLogger() {
	return { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

/** Cycles through an array of response factories, repeating the last one. */
function makeSequentialFetch(responses: Array<() => Promise<Response>>) {
	let idx = 0;
	return vi.fn(async () => {
		const factory = responses[Math.min(idx++, responses.length - 1)];
		return factory();
	});
}

// ── callXlsxWorker unit tests ─────────────────────────────────────────────────

describe("callXlsxWorker", () => {
	it("returns ok:true with payload on 200 success", async () => {
		const logger = makeMockLogger();
		const mockFetch = makeSequentialFetch([
			async () =>
				new Response(JSON.stringify(MOCK_SUCCESS_RESPONSE), {
					status: 200,
					headers: { "content-type": "application/json" },
				}),
		]);

		const result = await callXlsxWorker(BASE_CONFIG, BASE_REQUEST, {
			fetchImpl: mockFetch as any,
			logger,
			logMeta: { deal_id: "deal-1" },
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.payload.pages).toHaveLength(1);
			expect(result.payload.document_id).toBe("doc-xlsx-test");
		}

		// XLSX_WORKER_CALL and XLSX_WORKER_SUCCESS must be logged
		const logEvents = logger.log.mock.calls.map((c) => JSON.parse(c[0] as string));
		expect(logEvents.find((e) => e.event === "XLSX_WORKER_CALL")).toBeDefined();
		const successEvent = logEvents.find((e) => e.event === "XLSX_WORKER_SUCCESS");
		expect(successEvent).toBeDefined();
		expect(successEvent?.extracted_pages_count).toBe(1);
		expect(successEvent?.deal_id).toBe("deal-1");

		// No error logs
		expect(logger.error).not.toHaveBeenCalled();
	});

	it("returns ok:false XLSX_WORKER_UNAVAILABLE with retryable:true on 503", async () => {
		const logger = makeMockLogger();
		const mockFetch = makeSequentialFetch([
			async () => new Response("Service Unavailable", { status: 503 }),
		]);

		const result = await callXlsxWorker(BASE_CONFIG, BASE_REQUEST, {
			fetchImpl: mockFetch as any,
			logger,
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe("XLSX_WORKER_UNAVAILABLE");
			expect(result.retryable).toBe(true);
		}

		const errEvents = logger.error.mock.calls.map((c) => JSON.parse(c[0] as string));
		const failureEvent = errEvents.find((e) => e.event === "XLSX_WORKER_FAILURE");
		expect(failureEvent).toBeDefined();
		expect(failureEvent?.code).toBe("XLSX_WORKER_UNAVAILABLE");
		expect(failureEvent?.retryable).toBe(true);
	});

	it("returns ok:false XLSX_WORKER_UNAVAILABLE with retryable:true on 500", async () => {
		const logger = makeMockLogger();
		const mockFetch = makeSequentialFetch([
			async () => new Response("Internal Server Error", { status: 500 }),
		]);

		const result = await callXlsxWorker(BASE_CONFIG, BASE_REQUEST, {
			fetchImpl: mockFetch as any,
			logger,
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe("XLSX_WORKER_UNAVAILABLE");
			expect(result.retryable).toBe(true);
		}
	});

	it("returns ok:false XLSX_BAD_INPUT with retryable:false on 422", async () => {
		const logger = makeMockLogger();
		const mockFetch = makeSequentialFetch([
			async () => new Response("Unprocessable Entity", { status: 422 }),
		]);

		const result = await callXlsxWorker(BASE_CONFIG, BASE_REQUEST, {
			fetchImpl: mockFetch as any,
			logger,
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe("XLSX_BAD_INPUT");
			expect(result.retryable).toBe(false);
		}
	});

	it("returns ok:false XLSX_BAD_INPUT with retryable:false on 400", async () => {
		const logger = makeMockLogger();
		const mockFetch = makeSequentialFetch([
			async () => new Response("Bad Request", { status: 400 }),
		]);

		const result = await callXlsxWorker(BASE_CONFIG, BASE_REQUEST, {
			fetchImpl: mockFetch as any,
			logger,
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe("XLSX_BAD_INPUT");
			expect(result.retryable).toBe(false);
		}
	});

	it("returns ok:false XLSX_TIMEOUT with retryable:true on AbortError", async () => {
		const logger = makeMockLogger();
		const mockFetch = vi.fn(async () => {
			const err = new Error("The operation was aborted.");
			err.name = "AbortError";
			throw err;
		});

		const result = await callXlsxWorker(BASE_CONFIG, BASE_REQUEST, {
			fetchImpl: mockFetch as any,
			logger,
			timeoutMs: 30_000, // prevent the real AbortController from firing
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe("XLSX_TIMEOUT");
			expect(result.retryable).toBe(true);
		}
	});

	it("returns ok:false XLSX_WORKER_UNAVAILABLE with retryable:true on network throw", async () => {
		const logger = makeMockLogger();
		const mockFetch = vi.fn(async () => {
			throw new Error("ECONNREFUSED connect ECONNREFUSED 127.0.0.1:9999");
		});

		const result = await callXlsxWorker(BASE_CONFIG, BASE_REQUEST, {
			fetchImpl: mockFetch as any,
			logger,
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe("XLSX_WORKER_UNAVAILABLE");
			expect(result.retryable).toBe(true);
		}
	});

	it("returns ok:false XLSX_PARSE_FAILED when response body is invalid JSON", async () => {
		const logger = makeMockLogger();
		const mockFetch = makeSequentialFetch([
			async () =>
				new Response("not-json{{{", {
					status: 200,
					headers: { "content-type": "application/json" },
				}),
		]);

		const result = await callXlsxWorker(BASE_CONFIG, BASE_REQUEST, {
			fetchImpl: mockFetch as any,
			logger,
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe("XLSX_PARSE_FAILED");
			expect(result.retryable).toBe(false);
		}
	});

	it("returns ok:false XLSX_PARSE_FAILED when response JSON is missing pages array", async () => {
		const logger = makeMockLogger();
		const mockFetch = makeSequentialFetch([
			async () =>
				new Response(JSON.stringify({ document_id: "doc-1", extractor_version: "v1" }), {
					status: 200,
					headers: { "content-type": "application/json" },
				}),
		]);

		const result = await callXlsxWorker(BASE_CONFIG, BASE_REQUEST, {
			fetchImpl: mockFetch as any,
			logger,
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe("XLSX_PARSE_FAILED");
			expect(result.retryable).toBe(false);
		}
	});
});

// ── callXlsxWorkerWithRetries tests ──────────────────────────────────────────

describe("callXlsxWorkerWithRetries", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("returns ok:true immediately and makes 1 fetch call when first attempt succeeds", async () => {
		const logger = makeMockLogger();
		const mockFetch = makeSequentialFetch([
			async () =>
				new Response(JSON.stringify(MOCK_SUCCESS_RESPONSE), {
					status: 200,
					headers: { "content-type": "application/json" },
				}),
		]);

		const resultPromise = callXlsxWorkerWithRetries(BASE_CONFIG, BASE_REQUEST, {
			fetchImpl: mockFetch as any,
			logger,
			backoffMs: [0, 0, 0],
			jitterPct: 0,
		});
		await vi.runAllTimersAsync();
		const result = await resultPromise;

		expect(result.ok).toBe(true);
		expect(mockFetch).toHaveBeenCalledTimes(1);

		// XLSX_WORKER_SUCCESS log emitted
		const successLogs = logger.log.mock.calls
			.map((c) => JSON.parse(c[0] as string))
			.filter((e) => e.event === "XLSX_WORKER_SUCCESS");
		expect(successLogs).toHaveLength(1);
	});

	it("retries exactly maxAttempts times on XLSX_WORKER_UNAVAILABLE and emits XLSX_WORKER_EXHAUSTED", async () => {
		const logger = makeMockLogger();
		const mockFetch = vi.fn(async () => new Response("", { status: 503 }));

		const resultPromise = callXlsxWorkerWithRetries(BASE_CONFIG, BASE_REQUEST, {
			fetchImpl: mockFetch as any,
			logger,
			maxAttempts: 3,
			backoffMs: [0, 0, 0],
			jitterPct: 0,
		});
		await vi.runAllTimersAsync();
		const result = await resultPromise;

		expect(result.ok).toBe(false);
		// All 3 attempts consumed
		expect(mockFetch).toHaveBeenCalledTimes(3);

		const errEvents = logger.error.mock.calls.map((c) => JSON.parse(c[0] as string));
		// 3 XLSX_WORKER_FAILURE events (one per attempt)
		const failureEvents = errEvents.filter((e) => e.event === "XLSX_WORKER_FAILURE");
		expect(failureEvents).toHaveLength(3);
		// 1 XLSX_WORKER_EXHAUSTED at the end
		const exhaustedEvent = errEvents.find((e) => e.event === "XLSX_WORKER_EXHAUSTED");
		expect(exhaustedEvent).toBeDefined();
		expect(exhaustedEvent?.total_attempts).toBe(3);
		expect(exhaustedEvent?.code).toBe("XLSX_WORKER_UNAVAILABLE");

		// 2 XLSX_WORKER_RETRY log events (after attempt 1 and 2)
		const retryLogs = logger.log.mock.calls
			.map((c) => JSON.parse(c[0] as string))
			.filter((e) => e.event === "XLSX_WORKER_RETRY");
		expect(retryLogs).toHaveLength(2);
		expect(retryLogs[0].attempt).toBe(1);
		expect(retryLogs[1].attempt).toBe(2);
	});

	it("does NOT retry on non-retryable XLSX_BAD_INPUT (422) — only 1 fetch call", async () => {
		const logger = makeMockLogger();
		const mockFetch = vi.fn(async () => new Response("Unprocessable", { status: 422 }));

		const resultPromise = callXlsxWorkerWithRetries(BASE_CONFIG, BASE_REQUEST, {
			fetchImpl: mockFetch as any,
			logger,
			maxAttempts: 3,
			backoffMs: [0, 0, 0],
		});
		await vi.runAllTimersAsync();
		const result = await resultPromise;

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.code).toBe("XLSX_BAD_INPUT");
		// Only called once — 422 is not retryable
		expect(mockFetch).toHaveBeenCalledTimes(1);

		// No XLSX_WORKER_RETRY events
		const retryLogs = logger.log.mock.calls
			.map((c) => JSON.parse(c[0] as string))
			.filter((e) => e.event === "XLSX_WORKER_RETRY");
		expect(retryLogs).toHaveLength(0);
	});

	it("succeeds on 3rd attempt after two 503s", async () => {
		const logger = makeMockLogger();
		let callCount = 0;
		const mockFetch = vi.fn(async () => {
			callCount++;
			if (callCount < 3) return new Response("", { status: 503 });
			return new Response(JSON.stringify(MOCK_SUCCESS_RESPONSE), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		});

		const resultPromise = callXlsxWorkerWithRetries(BASE_CONFIG, BASE_REQUEST, {
			fetchImpl: mockFetch as any,
			logger,
			maxAttempts: 3,
			backoffMs: [0, 0, 0],
			jitterPct: 0,
		});
		await vi.runAllTimersAsync();
		const result = await resultPromise;

		expect(result.ok).toBe(true);
		expect(mockFetch).toHaveBeenCalledTimes(3);

		// 2 retry events (after attempt 1 and 2)
		const retryLogs = logger.log.mock.calls
			.map((c) => JSON.parse(c[0] as string))
			.filter((e) => e.event === "XLSX_WORKER_RETRY");
		expect(retryLogs).toHaveLength(2);

		// No XLSX_WORKER_EXHAUSTED (succeeded before exhausting attempts)
		const errEvents = logger.error.mock.calls.map((c) => JSON.parse(c[0] as string));
		expect(errEvents.find((e) => e.event === "XLSX_WORKER_EXHAUSTED")).toBeUndefined();
	});

	it("retries on XLSX_TIMEOUT (AbortError) and emits XLSX_WORKER_EXHAUSTED when all attempts fail", async () => {
		const logger = makeMockLogger();
		const mockFetch = vi.fn(async () => {
			const err = new Error("The operation was aborted.");
			err.name = "AbortError";
			throw err;
		});

		const resultPromise = callXlsxWorkerWithRetries(BASE_CONFIG, BASE_REQUEST, {
			fetchImpl: mockFetch as any,
			logger,
			maxAttempts: 3,
			backoffMs: [0, 0, 0],
			jitterPct: 0,
			timeoutMs: 30_000,
		});
		await vi.runAllTimersAsync();
		const result = await resultPromise;

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.code).toBe("XLSX_TIMEOUT");
		expect(mockFetch).toHaveBeenCalledTimes(3);

		const errEvents = logger.error.mock.calls.map((c) => JSON.parse(c[0] as string));
		expect(errEvents.find((e) => e.event === "XLSX_WORKER_EXHAUSTED")).toBeDefined();
	});
});

// ── Compile-level guard: XlsxWorkerResult is never null ─────────────────────

describe("XlsxWorkerResult compile guard", () => {
	it("result type is always XlsxWorkerResult (never null | undefined)", async () => {
		const mockFetch = makeSequentialFetch([
			async () =>
				new Response(JSON.stringify(MOCK_SUCCESS_RESPONSE), {
					status: 200,
					headers: { "content-type": "application/json" },
				}),
		]);

		// TypeScript enforces XlsxWorkerResult — assigning to the explicit type below
		// will fail at build time if callXlsxWorkerWithRetries returns null or undefined.
		const r: XlsxWorkerResult = await callXlsxWorkerWithRetries(BASE_CONFIG, BASE_REQUEST, {
			fetchImpl: mockFetch as any,
			logger: undefined,
		});

		// At runtime: .ok is always a boolean
		expect(typeof r.ok).toBe("boolean");

		// Never null
		expect(r).not.toBeNull();
		expect(r).not.toBeUndefined();
	});
});
