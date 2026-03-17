import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock job-progress so updateJob tests don't need a real BullMQ job ──────────
vi.mock("../job-progress", () => ({
  updateJobProgress: vi.fn().mockResolvedValue(undefined),
}));

import { devLogEnabled, makeDevLogger } from "../worker-utils/logging";
import { updateJob } from "../worker-utils/progress";
import { parseFiniteInt } from "../worker-utils/db";
import { retryWithBackoff } from "../worker-utils/retry";
import { updateJobProgress } from "../job-progress";
import type { Job } from "bullmq";

// ── makeDevLogger ──────────────────────────────────────────────────────────────

describe("makeDevLogger", () => {
  it("does not log when disabled", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const log = makeDevLogger(false);
    log("test_event", { foo: "bar" });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("logs structured JSON when enabled", () => {
    const messages: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((msg: string) => {
      messages.push(msg);
    });
    const log = makeDevLogger(true);
    log("test_event", { deal_id: "abc123", count: 5 });
    expect(spy).toHaveBeenCalledOnce();
    const parsed = JSON.parse(messages[0]!);
    expect(parsed).toEqual({ event: "test_event", deal_id: "abc123", count: 5 });
    spy.mockRestore();
  });

  it("warns instead of throwing when payload is not serializable", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const log = makeDevLogger(true);
    const circular: Record<string, unknown> = {};
    circular.self = circular; // circular reference — JSON.stringify will throw
    log("bad_event", circular);
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0]![0]).toContain("[devLog] failed to stringify event=bad_event");
    expect(logSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
    logSpy.mockRestore();
  });

  it("devLogEnabled is a boolean", () => {
    expect(typeof devLogEnabled).toBe("boolean");
  });
});

// ── updateJob ──────────────────────────────────────────────────────────────────

const fakeJob = { id: "job-1" } as unknown as Job;

describe("updateJob", () => {
  beforeEach(() => {
    vi.mocked(updateJobProgress).mockClear();
  });

  it("calls updateJobProgress with status=running and no progress fields when progressPct is omitted", async () => {
    await updateJob(fakeJob, "running", "Starting up");
    expect(updateJobProgress).toHaveBeenCalledOnce();
    const [, input] = vi.mocked(updateJobProgress).mock.calls[0]!;
    expect(input).toMatchObject({
      status: "running",
      stage: "status_update",
      message: "Starting up",
      error: undefined,
      current: undefined,
      total: undefined,
    });
  });

  it("passes current/total when progressPct is provided", async () => {
    await updateJob(fakeJob, "running", "Half done", 50);
    const [, input] = vi.mocked(updateJobProgress).mock.calls[0]!;
    expect(input).toMatchObject({ current: 50, total: 100 });
  });

  it("sets error field when status is 'failed'", async () => {
    await updateJob(fakeJob, "failed", "Something went wrong");
    const [, input] = vi.mocked(updateJobProgress).mock.calls[0]!;
    expect(input.error).toBe("Something went wrong");
  });

  it("uses 'failed' as fallback error when message is undefined and status is failed", async () => {
    await updateJob(fakeJob, "failed");
    const [, input] = vi.mocked(updateJobProgress).mock.calls[0]!;
    expect(input.error).toBe("failed");
  });

  it("does not set error when status is 'succeeded'", async () => {
    await updateJob(fakeJob, "succeeded", "All done", 100);
    const [, input] = vi.mocked(updateJobProgress).mock.calls[0]!;
    expect(input.error).toBeUndefined();
  });
});

// ── parseFiniteInt ─────────────────────────────────────────────────────────────

describe("parseFiniteInt", () => {
  it("returns the integer for a finite number", () => {
    expect(parseFiniteInt(42)).toBe(42);
  });

  it("floors a floating-point number", () => {
    expect(parseFiniteInt(3.9)).toBe(3);
  });

  it("parses a numeric string", () => {
    expect(parseFiniteInt("7")).toBe(7);
  });

  it("floors a float string", () => {
    expect(parseFiniteInt("2.99")).toBe(2);
  });

  it("returns null for NaN", () => {
    expect(parseFiniteInt(NaN)).toBeNull();
  });

  it("returns null for Infinity", () => {
    expect(parseFiniteInt(Infinity)).toBeNull();
  });

  it("returns null for a non-numeric string", () => {
    expect(parseFiniteInt("abc")).toBeNull();
  });

  it("returns null for non-number/non-string values", () => {
    expect(parseFiniteInt(null)).toBeNull();
    expect(parseFiniteInt(undefined)).toBeNull();
    expect(parseFiniteInt({})).toBeNull();
  });
});

// ── retryWithBackoff ───────────────────────────────────────────────────────────

describe("retryWithBackoff", () => {
  it("returns the result immediately when fn succeeds on first attempt", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await retryWithBackoff(fn, { maxAttempts: 3, initialDelayMs: 0 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledOnce();
  });

  it("retries and returns value after transient failure", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValue("success");
    const result = await retryWithBackoff(fn, { maxAttempts: 3, initialDelayMs: 0 });
    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("throws the last error when all attempts fail", async () => {
    const err = new Error("permanent");
    const fn = vi.fn().mockRejectedValue(err);
    await expect(retryWithBackoff(fn, { maxAttempts: 3, initialDelayMs: 0 })).rejects.toThrow("permanent");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("calls onRetry with attempt number and error on each retry", async () => {
    const retries: Array<{ attempt: number; err: unknown }> = [];
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("e1"))
      .mockRejectedValueOnce(new Error("e2"))
      .mockResolvedValue("done");
    await retryWithBackoff(fn, {
      maxAttempts: 3,
      initialDelayMs: 0,
      onRetry: (attempt, e) => retries.push({ attempt, err: e }),
    });
    expect(retries).toHaveLength(2);
    expect(retries[0]!.attempt).toBe(1);
    expect((retries[0]!.err as Error).message).toBe("e1");
    expect(retries[1]!.attempt).toBe(2);
  });

  it("respects maxAttempts=1 by not retrying", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("boom"));
    await expect(retryWithBackoff(fn, { maxAttempts: 1, initialDelayMs: 0 })).rejects.toThrow("boom");
    expect(fn).toHaveBeenCalledOnce();
  });
});
