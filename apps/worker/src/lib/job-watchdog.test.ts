import { describe, it, expect } from "vitest";
import { runJobWatchdogOnce } from "./job-watchdog";
import { selectReextractCandidates } from "./reextract-selection";

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
                document_id: null,
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

  it("self-heals documents stuck in processing and makes them reextractable", async () => {
    const now = new Date("2026-01-25T00:00:00.000Z");

    const doc = {
      id: "00000000-0000-0000-0000-000000000001",
      deal_id: "deal-1",
      title: "Doc",
      type: "pdf",
      status: "processing",
      uploaded_at: "2026-01-24T23:00:00.000Z",
      updated_at: "2026-01-24T23:10:00.000Z",
      verification_status: null,
      verification_result: null,
      structured_data: null,
      extraction_metadata: { status: "processing" },
      full_content: null,
      full_text: null,
      page_count: null,
    };

    const mockPool = {
      queries: [] as Array<{ sql: string; params?: unknown[] }>,
      query: async (sql: string, params?: unknown[]) => {
        mockPool.queries.push({ sql, params });

        if (sql.includes("FROM jobs") && sql.includes("WHERE status = 'running'")) {
          return {
            rows: [
              {
                job_id: "job-ingest-1",
                queue: "ingest_documents",
                type: null,
                stage: "render_pages",
                updated_at: "2026-01-24T22:00:00.000Z",
                document_id: doc.id,
              },
            ],
          };
        }

        if (sql.includes("UPDATE jobs") && sql.includes("SET status = 'failed'")) {
          return { rows: [{ job_id: "job-ingest-1" }] };
        }

        if (sql.includes("UPDATE documents") && sql.includes("SET status = 'failed'")) {
          doc.status = "failed";
          doc.updated_at = now.toISOString();
          doc.extraction_metadata = {
            ...(doc.extraction_metadata as any),
            status: "failed",
            errorMessage: String((params ?? [])[1] ?? ""),
          };
          return { rows: [] };
        }

        return { rows: [] };
      },
    };

    const res = await runJobWatchdogOnce({ pool: mockPool as any, now, limit: 10 });
    expect(res.failed).toBe(1);
    expect(doc.status).toBe("failed");
    expect((doc.extraction_metadata as any)?.status).toBe("failed");
    expect(String((doc.extraction_metadata as any)?.errorMessage)).toContain("stale_job_timeout");

    const candidates = selectReextractCandidates([doc as any], {
      dealId: "deal-1",
      explicitDocIds: false,
      thresholdLow: 0.75,
      includeWarnings: false,
      now,
    });
    expect(candidates.map((d: any) => d.id)).toContain(doc.id);
  });
});
