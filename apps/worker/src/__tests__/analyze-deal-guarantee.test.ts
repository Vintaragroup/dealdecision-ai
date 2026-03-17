/**
 * PR7-lite: maybeEnqueueAnalyzeDealGuarantee unit tests
 *
 * Tests:
 *   1. Enqueues when all prerequisites are met (no active job, all docs finalized)
 *   2. Second call with active job → skips (idempotency: analyze_already_active)
 *   3. Skips when analyze_deal is running
 *   4. Skips when analyze_deal recently succeeded (within freshness window)
 *   5. Skips when a doc is missing the finalized marker (prerequisites_not_met)
 *   6. Skips when deal_id is empty/missing
 *   7. Skips when no docs exist in the deal
 */

import { describe, it, expect, vi } from "vitest";
import {
  maybeEnqueueAnalyzeDealGuarantee,
  type GuaranteePool,
} from "../lib/analyze-deal-guarantee";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePool(overrides: {
  active_analyze_status?: string | null;
  total_docs?: number;
  unfinalized_visual_docs?: number;
}): GuaranteePool {
  const row = {
    active_analyze_status: overrides.active_analyze_status ?? null,
    total_docs: overrides.total_docs ?? 2,
    unfinalized_visual_docs: overrides.unfinalized_visual_docs ?? 0,
  };
  return {
    query: vi.fn(async () => ({ rows: [row] })),
  };
}

function makeLogger() {
  const logs: string[] = [];
  const warns: string[] = [];
  return {
    log: vi.fn((msg: string) => logs.push(msg)),
    warn: vi.fn((msg: string) => warns.push(msg)),
    _logs: logs,
    _warns: warns,
  };
}

const neverCallback = vi.fn(async () => ({ enqueued: false, jobId: null }));

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("maybeEnqueueAnalyzeDealGuarantee", () => {
  it("enqueues when prerequisites are met (no active job, all docs finalized)", async () => {
    const pool = makePool({ active_analyze_status: null, total_docs: 2, unfinalized_visual_docs: 0 });
    const logger = makeLogger();
    const enqueueCb = vi.fn(async () => ({ enqueued: true, jobId: "job-abc" }));

    const result = await maybeEnqueueAnalyzeDealGuarantee({
      deal_id: "deal-001",
      trigger: "test_trigger",
      pool,
      logger,
      enqueueCallback: enqueueCb,
    });

    expect(result.action).toBe("enqueued");
    expect((result as any).job_id).toBe("job-abc");
    expect(enqueueCb).toHaveBeenCalledOnce();

    // Check emitted events
    const checkEvent = logger._logs.find((l) => l.includes("ANALYZE_ENQUEUE_GUARANTEE_CHECK"));
    const enqueuedEvent = logger._logs.find((l) => l.includes("ANALYZE_ENQUEUE_GUARANTEE_ENQUEUED"));
    expect(checkEvent).toBeTruthy();
    expect(enqueuedEvent).toBeTruthy();
  });

  it("skips with analyze_already_active when queued analyze_deal exists", async () => {
    const pool = makePool({ active_analyze_status: "queued", total_docs: 2, unfinalized_visual_docs: 0 });
    const logger = makeLogger();

    const result = await maybeEnqueueAnalyzeDealGuarantee({
      deal_id: "deal-002",
      trigger: "test",
      pool,
      logger,
      enqueueCallback: neverCallback,
    });

    expect(result.action).toBe("skipped");
    expect((result as any).reason).toBe("analyze_already_active");
    expect(neverCallback).not.toHaveBeenCalled();

    const skipEvent = logger._logs.find((l) => l.includes("ANALYZE_ENQUEUE_GUARANTEE_SKIPPED"));
    expect(skipEvent).toBeTruthy();
    expect(skipEvent).toContain("analyze_already_active");
  });

  it("skips with analyze_already_active when analyze_deal is running", async () => {
    const pool = makePool({ active_analyze_status: "running", total_docs: 3, unfinalized_visual_docs: 0 });
    const logger = makeLogger();

    const result = await maybeEnqueueAnalyzeDealGuarantee({
      deal_id: "deal-003",
      trigger: "recovery",
      pool,
      logger,
      enqueueCallback: neverCallback,
    });

    expect(result.action).toBe("skipped");
    expect((result as any).reason).toBe("analyze_already_active");
    expect(neverCallback).not.toHaveBeenCalled();
  });

  it("skips with analyze_recently_succeeded when analyze_deal succeeded within freshness window", async () => {
    const pool = makePool({
      active_analyze_status: "succeeded",
      total_docs: 2,
      unfinalized_visual_docs: 0,
    });
    const logger = makeLogger();

    const result = await maybeEnqueueAnalyzeDealGuarantee({
      deal_id: "deal-004",
      trigger: "recovery",
      pool,
      logger,
      enqueueCallback: neverCallback,
    });

    expect(result.action).toBe("skipped");
    expect((result as any).reason).toBe("analyze_recently_succeeded");
    expect(neverCallback).not.toHaveBeenCalled();
  });

  it("skips with prerequisites_not_met when a doc is missing the finalized marker", async () => {
    const pool = makePool({
      active_analyze_status: null,
      total_docs: 2,
      unfinalized_visual_docs: 1, // one doc not yet finalized
    });
    const logger = makeLogger();

    const result = await maybeEnqueueAnalyzeDealGuarantee({
      deal_id: "deal-005",
      trigger: "recovery",
      pool,
      logger,
      enqueueCallback: neverCallback,
    });

    expect(result.action).toBe("skipped");
    expect((result as any).reason).toBe("prerequisites_not_met");
    expect(neverCallback).not.toHaveBeenCalled();

    const skipEvent = logger._logs.find((l) => l.includes("ANALYZE_ENQUEUE_GUARANTEE_SKIPPED"));
    expect(skipEvent).toBeTruthy();
    expect(skipEvent).toContain("prerequisites_not_met");
  });

  it("skips with missing_deal_id when deal_id is empty", async () => {
    const pool = makePool({});
    const logger = makeLogger();

    const result = await maybeEnqueueAnalyzeDealGuarantee({
      deal_id: "",
      trigger: "recovery",
      pool,
      logger,
      enqueueCallback: neverCallback,
    });

    expect(result.action).toBe("skipped");
    expect((result as any).reason).toBe("missing_deal_id");
    expect(neverCallback).not.toHaveBeenCalled();
    // Missing deal_id uses warn, not log
    expect(logger._warns.some((w) => w.includes("ANALYZE_ENQUEUE_GUARANTEE_SKIPPED"))).toBe(true);
    // Pool should not be queried when deal_id is missing
    expect((pool.query as any)).not.toHaveBeenCalled();
  });

  it("skips with no_docs when total_docs = 0", async () => {
    const pool = makePool({
      active_analyze_status: null,
      total_docs: 0,
      unfinalized_visual_docs: 0,
    });
    const logger = makeLogger();

    const result = await maybeEnqueueAnalyzeDealGuarantee({
      deal_id: "deal-006",
      trigger: "recovery",
      pool,
      logger,
      enqueueCallback: neverCallback,
    });

    expect(result.action).toBe("skipped");
    expect((result as any).reason).toBe("no_docs");
    expect(neverCallback).not.toHaveBeenCalled();
  });

  it("emits ANALYZE_ENQUEUE_GUARANTEE_ENQUEUED with already_enqueued=true when callback says not enqueued", async () => {
    // Simulates the case where enqueuePersistedJob catches a duplicate → enqueued=false
    const pool = makePool({ active_analyze_status: null, total_docs: 1, unfinalized_visual_docs: 0 });
    const logger = makeLogger();
    const enqueueCb = vi.fn(async () => ({ enqueued: false, jobId: null }));

    const result = await maybeEnqueueAnalyzeDealGuarantee({
      deal_id: "deal-007",
      trigger: "recovery",
      pool,
      logger,
      enqueueCallback: enqueueCb,
    });

    // Still reports action=enqueued (the callback was called and returned "not enqueued" which is idempotent)
    expect(result.action).toBe("enqueued");
    const enqueuedEvent = logger._logs.find((l) => l.includes("ANALYZE_ENQUEUE_GUARANTEE_ENQUEUED"));
    expect(enqueuedEvent).toBeTruthy();
    const parsed = JSON.parse(enqueuedEvent!);
    expect(parsed.already_enqueued).toBe(true);
  });

  it("uses a single DB query per call", async () => {
    const pool = makePool({ active_analyze_status: null, total_docs: 2, unfinalized_visual_docs: 0 });
    const logger = makeLogger();
    const enqueueCb = vi.fn(async () => ({ enqueued: true, jobId: "j1" }));

    await maybeEnqueueAnalyzeDealGuarantee({
      deal_id: "deal-008",
      trigger: "test",
      pool,
      logger,
      enqueueCallback: enqueueCb,
    });

    // Pool.query must be called exactly once
    expect((pool.query as any)).toHaveBeenCalledOnce();
  });
});
