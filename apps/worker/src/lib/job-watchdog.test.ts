import { describe, it, expect } from "vitest";
import { runJobWatchdogOnce } from "./job-watchdog";

// This test uses a lightweight pool mock (no real DB) and asserts the watchdog
// marks a stale running job as failed.

describe("job-watchdog", () => {
  it("marks stale running jobs as failed with duration in error", async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];

    const now = new Date("2026-01-25T12:00:00.000Z");
    const staleUpdatedAt = new Date("2026-01-25T11:00:00.000Z");

    const mockPool = {
      query: async (sql: string, params: unknown[] = []) => {
        queries.push({ sql, params });

        if (sql.includes("FROM jobs") && sql.includes("status = 'running'")) {
          return {
            rows: [
              {
                job_id: "job-1",
                queue: "ingest_documents",
                type: "ingest_documents",
                stage: "persist_document",
                updated_at: staleUpdatedAt,
              },
            ],
          };
        }

        if (sql.includes("UPDATE jobs") && sql.includes("status = 'failed'")) {
          return { rows: [{ job_id: "job-1" }] };
        }

        return { rows: [] };
      },
    };

    const res = await runJobWatchdogOnce({ pool: mockPool as any, now, limit: 10 });
    expect(res.scanned).toBe(1);
    expect(res.failed).toBe(1);

    const update = queries.find((q) => q.sql.includes("UPDATE jobs") && q.sql.includes("status = 'failed'"));
    expect(update).toBeTruthy();
    const error = String((update?.params ?? [])[1] ?? "");
    expect(error).toContain("stale_job_timeout");
    expect(error).toContain("age_min=");
    expect(error).toContain("timeout_min=");
  });
});
