/**
 * Verifies the db.ts shutdown guard:
 *   1. closePool() without markDbShuttingDown() is a no-op (pool.end() never called).
 *   2. closePool() called twice after markDbShuttingDown() calls pool.end() exactly once.
 *
 * These are the same guarantees that index.ts relies on when shutdown() is
 * invoked more than once (double-signal, or the schema-check early-exit path
 * firing before the signal handler).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Provide required env vars before any module is imported.
process.env.DATABASE_URL =
  process.env.DATABASE_URL || "postgres://user:pass@localhost:5432/test";

describe("shutdown idempotency – closePool guard in db.ts", () => {
  // Reset module registry before each test so module-level state is clean.
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("closePool() without markDbShuttingDown does NOT call pool.end()", async () => {
    const endMock = vi.fn();

    vi.doMock("pg", () => ({
      Pool: vi.fn(() => ({
        query: vi.fn(async () => ({ rows: [] })),
        end: endMock,
      })),
    }));

    const { closePool, getPool } = await import("../lib/db");

    // Materialise the pool so it's non-null.
    getPool();

    await closePool();

    // Must be a no-op: pool.end() must never be called while shuttingDown=false.
    expect(endMock).not.toHaveBeenCalled();
  });

  it("after markDbShuttingDown(), closePool() called twice only ends pool once", async () => {
    const endMock = vi.fn();

    vi.doMock("pg", () => ({
      Pool: vi.fn(() => ({
        query: vi.fn(async () => ({ rows: [] })),
        end: endMock,
      })),
    }));

    const { closePool, getPool, markDbShuttingDown } = await import("../lib/db");

    // Materialise the pool.
    getPool();

    // Signal shutdown exactly once.
    markDbShuttingDown();

    // Call closePool() twice (simulates double-signal / schema-check + SIGTERM race).
    await closePool();
    await closePool();

    // pool.end() must be called exactly once; the second closePool is a no-op
    // because `pool` is set to null after the first successful close.
    expect(endMock).toHaveBeenCalledTimes(1);
  });
});
