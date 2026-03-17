/**
 * Job-progress helper shared across all worker job processors.
 *
 * Wraps `updateJobProgress` with the conventional stage/current/total/error
 * shape used throughout the worker.
 */
import type { Job } from "bullmq";
import type { JobStatus } from "@dealdecision/contracts";
import { updateJobProgress } from "../job-progress";

export async function updateJob(
  job: Job,
  status: JobStatus,
  message?: string,
  progressPct?: number | null
): Promise<void> {
  await updateJobProgress(job, {
    status: status as any,
    stage: "status_update",
    current: typeof progressPct === "number" ? progressPct : undefined,
    total: typeof progressPct === "number" ? 100 : undefined,
    message,
    error: status === "failed" ? message ?? "failed" : undefined,
  });
}
