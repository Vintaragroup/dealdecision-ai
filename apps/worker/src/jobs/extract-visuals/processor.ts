import type { Job } from "bullmq";
import { runExtractVisualsCoordinator } from "./coordinator";

// ── Processor (thin wrapper) ───────────────────────────────────────────────────
// Full orchestration logic lives in coordinator.ts.
// This file exists so that BullMQ's registerWorker call can import a stable
// `extractVisualsProcessor` export without coupling to the coordinator's internals.

export async function extractVisualsProcessor(job: Job) {
	return runExtractVisualsCoordinator(job);
}
