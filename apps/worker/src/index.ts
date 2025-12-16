import type { Job } from "bullmq";
import type { JobStatus } from "@dealdecision/contracts";
import { createWorker } from "./lib/queue";
import { getPool, closePool, updateDocumentStatus } from "./lib/db";

async function updateJob(job: Job, status: JobStatus, message?: string) {
	const pool = getPool();
	await pool.query(
		`UPDATE jobs SET status = $2, updated_at = now(), message = COALESCE($3, message) WHERE job_id = $1`,
		[(job.id ?? job.name).toString(), status, message ?? null]
	);
}

async function ingestDocumentProcessor(job: Job) {
	const documentId = (job.data as { document_id?: string } | undefined)?.document_id;
	await updateJob(job, "running", "Ingesting document");
	if (documentId) {
		await updateDocumentStatus(documentId, "processing");
	}

	// Placeholder extraction work
	await updateJob(job, "running", "Extracting content");

	if (documentId) {
		await updateDocumentStatus(documentId, "completed");
	}
	await updateJob(job, "succeeded", "Ingest complete");
	return { ok: true };
}

function baseProcessor(statusOnStart: JobStatus, statusOnComplete: JobStatus) {
	return async (job: Job) => {
		await updateJob(job, statusOnStart);
		// Placeholder: perform actual work here
		await updateJob(job, statusOnComplete);
		return { ok: true };
	};
}

createWorker("ingest_document", ingestDocumentProcessor);
createWorker("fetch_evidence", baseProcessor("running", "succeeded"));
createWorker("analyze_deal", baseProcessor("running", "succeeded"));

const shutdown = async () => {
	await closePool();
	process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log("DealDecision worker started");
