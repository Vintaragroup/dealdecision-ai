import { beforeEach, describe, expect, it, vi } from "vitest";

type MockPool = { query: ReturnType<typeof vi.fn> };
type MockQueue = { add: ReturnType<typeof vi.fn> };

describe("enqueuePersistedJob", () => {
	beforeEach(() => {
		vi.resetModules();
		vi.clearAllMocks();
	});

	it("inserts job row before queue.add", async () => {
		const calls: string[] = [];
		const pool: MockPool = {
			query: vi.fn(async () => {
				calls.push("db");
				return { rows: [] } as any;
			}),
		};
		const queue: MockQueue = {
			add: vi.fn(async () => {
				calls.push("queue");
				return {} as any;
			}),
		};

		vi.doMock("../db", () => ({ getPool: () => pool }));
		vi.doMock("../queue", () => ({ getQueue: () => queue }));

		const { enqueuePersistedJob } = await import("../job-enqueue");
		await enqueuePersistedJob({
			job_id: "test_job_123",
			type: "ingest_documents",
			deal_id: "deal_1",
			document_id: "doc_1",
			payload: { hello: "world" },
		});

		expect(calls[0]).toBe("db");
		expect(calls[1]).toBe("queue");
		expect(pool.query).toHaveBeenCalledTimes(1);
		expect(queue.add).toHaveBeenCalledTimes(1);
	});

	it("idempotent mode tolerates existing job and existing queue job", async () => {
		const pool: MockPool = {
			query: vi.fn(async () => {
				// ON CONFLICT DO NOTHING means no error; just return.
				return { rows: [] } as any;
			}),
		};
		const queue: MockQueue = {
			add: vi.fn(async () => {
				throw new Error("Job test_job_123 already exists");
			}),
		};

		vi.doMock("../db", () => ({ getPool: () => pool }));
		vi.doMock("../queue", () => ({ getQueue: () => queue }));

		const { enqueuePersistedJob } = await import("../job-enqueue");
		await expect(
			enqueuePersistedJob({
				job_id: "test_job_123",
				idempotent: true,
				type: "render_document_pages",
				deal_id: "deal_1",
				document_id: "doc_1",
				payload: { force_ocr: true },
				page_start: 0,
				page_end: 10,
			})
		).resolves.toEqual({ job_id: "test_job_123" });
	});

	it("rejects empty document_id for document-scoped jobs", async () => {
		const pool: MockPool = {
			query: vi.fn(async () => ({ rows: [] } as any)),
		};
		const queue: MockQueue = {
			add: vi.fn(async () => ({} as any)),
		};

		vi.doMock("../db", () => ({ getPool: () => pool }));
		vi.doMock("../queue", () => ({ getQueue: () => queue }));

		const { enqueuePersistedJob } = await import("../job-enqueue");
		await expect(
			enqueuePersistedJob({
				job_id: "test_job_empty_doc",
				type: "extract_visuals",
				deal_id: "deal_1",
				document_id: "   ",
				payload: {},
			})
		).rejects.toThrow(/document_id/i);
	});

	it("supports delay_ms override", async () => {
		const pool: MockPool = {
			query: vi.fn(async () => ({ rows: [] } as any)),
		};
		const queue: MockQueue = {
			add: vi.fn(async () => ({} as any)),
		};

		vi.doMock("../db", () => ({ getPool: () => pool }));
		vi.doMock("../queue", () => ({ getQueue: () => queue }));

		const { enqueuePersistedJob } = await import("../job-enqueue");
		await enqueuePersistedJob({
			job_id: "test_job_delay",
			type: "ingest_documents",
			deal_id: "deal_1",
			document_id: "doc_1",
			payload: { hello: "world" },
			delay_ms: 5000,
		});

		expect(queue.add).toHaveBeenCalledWith(
			"ingest_documents",
			expect.any(Object),
			expect.objectContaining({ delay: 5000 })
		);
	});

	// ── PR3: retry opts ──────────────────────────────────────────────────────

	it("applies attempts:3 and exponential backoff for non-extract_visuals jobs", async () => {
		const pool: MockPool = {
			query: vi.fn(async () => ({ rows: [] } as any)),
		};
		const queue: MockQueue = {
			add: vi.fn(async () => ({} as any)),
		};

		vi.doMock("../db", () => ({ getPool: () => pool }));
		vi.doMock("../queue", () => ({ getQueue: () => queue }));

		const { enqueuePersistedJob } = await import("../job-enqueue");
		await enqueuePersistedJob({
			job_id: "test_retry_ingest",
			type: "ingest_documents",
			deal_id: "deal_1",
			document_id: "doc_1",
			payload: {},
		});

		expect(queue.add).toHaveBeenCalledWith(
			"ingest_documents",
			expect.any(Object),
			expect.objectContaining({
				attempts: 3,
				backoff: { type: "exponential", delay: 1000 },
			})
		);
	});

	it("applies retry opts for populate_document_page_understanding jobs", async () => {
		const pool: MockPool = {
			query: vi.fn(async () => ({ rows: [] } as any)),
		};
		const queue: MockQueue = {
			add: vi.fn(async () => ({} as any)),
		};

		vi.doMock("../db", () => ({ getPool: () => pool }));
		vi.doMock("../queue", () => ({ getQueue: () => queue }));

		const { enqueuePersistedJob } = await import("../job-enqueue");
		await enqueuePersistedJob({
			job_id: "test_retry_dpu",
			type: "populate_document_page_understanding",
			deal_id: "deal_2",
			document_id: "doc_2",
			payload: {},
		});

		const call = queue.add.mock.calls[0] as any[];
		const opts = call[2] as Record<string, unknown>;
		expect(opts.attempts).toBe(3);
		expect((opts.backoff as any).type).toBe("exponential");
		expect((opts.backoff as any).delay).toBe(1000);
	});

	it("does NOT set attempts for extract_visuals — queue defaultJobOptions (attempts:5) must win", async () => {
		// extract_visuals queue is configured with defaultJobOptions: { attempts: 5, backoff: exponential 10s }
		// in getQueue("extract_visuals"). Job-level opts override defaultJobOptions, so we must not
		// set attempts at the job level for extract_visuals or we'd downgrade from 5 to 3.
		const pool: MockPool = {
			query: vi.fn(async () => ({ rows: [] } as any)),
		};
		const queue: MockQueue = {
			add: vi.fn(async () => ({} as any)),
		};

		vi.doMock("../db", () => ({ getPool: () => pool }));
		vi.doMock("../queue", () => ({ getQueue: () => queue }));

		const { enqueuePersistedJob } = await import("../job-enqueue");
		await enqueuePersistedJob({
			job_id: "test_extract_visuals_no_attempts",
			type: "extract_visuals",
			deal_id: "deal_3",
			document_id: "doc_3",
			payload: {},
		});

		const call = queue.add.mock.calls[0] as any[];
		const opts = call[2] as Record<string, unknown>;
		// Must NOT have job-level attempts — leave it to the queue's defaultJobOptions.
		expect(opts.attempts).toBeUndefined();
		expect(opts.backoff).toBeUndefined();
	});
});
