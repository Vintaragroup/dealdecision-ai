/**
 * Unit tests for enqueuePersistedJob — priority field (Phase 4 first-pass latency).
 *
 * Verifies that the optional `priority` input is correctly wired through to the
 * BullMQ `queue.add()` options object, with the documented clamping behaviour.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks (must precede dynamic imports of job-enqueue) ────────────────────
const mockQueueAdd = vi.fn(async () => ({ id: "bullmq-job-1" }));
const mockPoolQuery = vi.fn(async () => ({ rows: [] }));

vi.mock("../db", () => ({ getPool: vi.fn(() => ({ query: mockPoolQuery })) }));
vi.mock("../queue", () => ({ getQueue: vi.fn(() => ({ add: mockQueueAdd })) }));
vi.mock("../job-id", () => ({ sanitizeJobId: vi.fn((id: string) => id) }));
vi.mock("@dealdecision/core", () => ({
  sanitizeDeep: vi.fn((v: unknown) => v),
  sanitizeText: vi.fn((s: string) => String(s ?? "")),
}));

// ── Helper: grab the options object passed to queue.add ─────────────────────
function capturedQueueAddOptions(): Record<string, unknown> {
  const calls = mockQueueAdd.mock.calls as unknown[][];
  if (calls.length === 0) throw new Error("queue.add was not called");
  return ((calls[0][2] as Record<string, unknown>) ?? {});
}

// ── Tests ──────────────────────────────────────────────────────────────────
describe("enqueuePersistedJob — priority field", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes priority: 1 to queue.add when priority=1 is provided", async () => {
    const { enqueuePersistedJob } = await import("../job-enqueue.js");
    await enqueuePersistedJob({ type: "analyze_deal", deal_id: "deal-fp-1", priority: 1 });
    expect(capturedQueueAddOptions()).toMatchObject({ priority: 1 });
  });

  it("passes priority: 5 to queue.add when priority=5 is provided", async () => {
    const { enqueuePersistedJob } = await import("../job-enqueue.js");
    await enqueuePersistedJob({ type: "analyze_deal", deal_id: "deal-fp-1", priority: 5 });
    expect(capturedQueueAddOptions()).toMatchObject({ priority: 5 });
  });

  it("does NOT set priority key when priority is omitted", async () => {
    const { enqueuePersistedJob } = await import("../job-enqueue.js");
    await enqueuePersistedJob({ type: "analyze_deal", deal_id: "deal-fp-1" });
    expect(capturedQueueAddOptions()).not.toHaveProperty("priority");
  });

  it("clamps priority=0 up to 1 (BullMQ requires priority >= 1)", async () => {
    const { enqueuePersistedJob } = await import("../job-enqueue.js");
    await enqueuePersistedJob({ type: "analyze_deal", deal_id: "deal-fp-1", priority: 0 });
    expect(capturedQueueAddOptions()).toMatchObject({ priority: 1 });
  });

  it("clamps negative priority to 1", async () => {
    const { enqueuePersistedJob } = await import("../job-enqueue.js");
    await enqueuePersistedJob({ type: "analyze_deal", deal_id: "deal-fp-1", priority: -10 });
    expect(capturedQueueAddOptions()).toMatchObject({ priority: 1 });
  });

  it("omits priority when NaN is provided (non-finite guard)", async () => {
    const { enqueuePersistedJob } = await import("../job-enqueue.js");
    await enqueuePersistedJob({ type: "analyze_deal", deal_id: "deal-fp-1", priority: NaN });
    expect(capturedQueueAddOptions()).not.toHaveProperty("priority");
  });

  it("omits priority when Infinity is provided (non-finite guard)", async () => {
    const { enqueuePersistedJob } = await import("../job-enqueue.js");
    await enqueuePersistedJob({ type: "analyze_deal", deal_id: "deal-fp-1", priority: Infinity });
    expect(capturedQueueAddOptions()).not.toHaveProperty("priority");
  });

  it("floors fractional priority values (e.g. 2.9 → 2)", async () => {
    const { enqueuePersistedJob } = await import("../job-enqueue.js");
    await enqueuePersistedJob({ type: "analyze_deal", deal_id: "deal-fp-1", priority: 2.9 });
    expect(capturedQueueAddOptions()).toMatchObject({ priority: 2 });
  });

  it("still inserts a DB row regardless of priority", async () => {
    const { enqueuePersistedJob } = await import("../job-enqueue.js");
    await enqueuePersistedJob({ type: "analyze_deal", deal_id: "deal-fp-1", priority: 3 });
    expect(mockPoolQuery).toHaveBeenCalledTimes(1);
  });

  it("returns a job_id string", async () => {
    const { enqueuePersistedJob } = await import("../job-enqueue.js");
    const result = await enqueuePersistedJob({ type: "analyze_deal", deal_id: "deal-fp-1", priority: 1 });
    expect(typeof result.job_id).toBe("string");
    expect(result.job_id.length).toBeGreaterThan(0);
  });
});
