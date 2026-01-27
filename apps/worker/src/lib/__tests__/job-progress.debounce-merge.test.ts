import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";

const query = vi.fn(async (_sql: string, _params?: unknown[]) => ({ rows: [] }));
const getPool = vi.fn(() => ({ query }));

vi.mock("../db.js", () => ({ getPool }));

describe("updateJobProgress debounced DB writes", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("preserves a pending status update when followed by progress-only finalize", async () => {
		const { updateJobProgress } = await import("../job-progress.js");

		const job = {
			id: "job_1",
			name: "job_1",
			queueName: "extract_visuals",
			updateProgress: vi.fn(async () => undefined),
		} as any;

		// First call sets a terminal-ish status (e.g. succeeded) via updateJob().
		await updateJobProgress(job, {
			status: "succeeded" as any,
			stage: "status_update",
			current: 100,
			total: 100,
			message: "done",
		});

		// Second call simulates emitJobProgress() which does not include status.
		await updateJobProgress(job, {
			stage: "finalize",
			current: 100,
			total: 100,
			message: "finalizing",
		});

		// Flush the debounce timer.
		vi.runAllTimers();
		// Allow the timer callback's async query to resolve.
		await Promise.resolve();
		await Promise.resolve();

		expect(query).toHaveBeenCalled();
		const lastParams = (query as any).mock.calls.at(-1)?.[1] as any[] | undefined;
		expect(Array.isArray(lastParams)).toBe(true);
		// $2 is status in the UPDATE query.
		expect(lastParams?.[1]).toBe("succeeded");
		// $3 is stage.
		expect(lastParams?.[2]).toBe("finalize");
	});
});
