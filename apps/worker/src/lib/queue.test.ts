import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

let lastWorkerOptions: any | null = null;

class MockWorker {
  constructor(_name: string, _processor: any, opts: any) {
    lastWorkerOptions = opts;
  }
  on(_event: string, _handler: (...args: any[]) => void) {
    return this;
  }
}

class MockQueue {
  constructor(_name: string, _opts: any) {}
}

vi.mock("ioredis", () => {
  class MockRedis {
    // Keep signature compatible with `new IORedis(url, opts)`
    constructor(_url: string, _opts: any) {}
    on(_event: string, _handler: (...args: any[]) => void) {
      return this;
    }
  }

  return { default: MockRedis };
});

describe("createWorker concurrency", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    lastWorkerOptions = null;
    process.env = { ...originalEnv };
    process.env.REDIS_URL = "redis://localhost:6379";
    delete process.env.WORKER_CONCURRENCY;
    (globalThis as any).__DEALDECISION_BULLMQ = { Worker: MockWorker, Queue: MockQueue };
    vi.resetModules();
  });

  afterEach(() => {
    delete (globalThis as any).__DEALDECISION_BULLMQ;
    process.env = { ...originalEnv };
  });

  it("defaults to concurrency=1 when WORKER_CONCURRENCY is unset", async () => {
    const { createWorker } = await import("./queue.js");

    createWorker("fetch_evidence", (async () => undefined) as any);

    expect(lastWorkerOptions?.concurrency).toBe(1);
  });

  it("uses WORKER_CONCURRENCY when set", async () => {
    process.env.WORKER_CONCURRENCY = "3";

    const { createWorker } = await import("./queue.js");

    createWorker("fetch_evidence", (async () => undefined) as any);

    expect(lastWorkerOptions?.concurrency).toBe(3);
  });
});
