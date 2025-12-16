import type { Job } from "bullmq";
import { randomUUID } from "crypto";
import type { JobStatus } from "@dealdecision/contracts";
import { createWorker } from "./lib/queue";
import {
	getPool,
	closePool,
	updateDocumentStatus,
	insertEvidence,
	getDocumentsForDeal,
	getEvidenceDocumentIds,
} from "./lib/db";
import { deriveEvidenceDrafts } from "./lib/evidence";

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
createWorker("fetch_evidence", async (job: Job) => {
	const dealId = (job.data as { deal_id?: string } | undefined)?.deal_id;
	const filter = (job.data as { filter?: string } | undefined)?.filter;
	if (!dealId) {
		await updateJob(job, "failed", "Missing deal_id for evidence fetch");
		return { ok: false };
	}

	try {
		await updateJob(job, "running", "Fetching evidence");
		const documents = await getDocumentsForDeal(dealId);
		if (documents.length === 0) {
			await updateJob(job, "succeeded", "No documents available for evidence");
			return { inserted: 0 };
		}

		const existingDocIds = await getEvidenceDocumentIds(dealId);
		const drafts = deriveEvidenceDrafts(documents, { filter, excludeDocumentIds: existingDocIds });
		let inserted = 0;

		for (const draft of drafts) {
			await insertEvidence({
				evidence_id: randomUUID(),
				deal_id: dealId,
				document_id: draft.document_id,
				source: draft.source,
				kind: draft.kind,
				text: draft.text,
				excerpt: draft.excerpt,
			});
			inserted += 1;
		}

		const message = inserted === 0 ? "No new evidence created" : `Created ${inserted} evidence item(s)`;
		await updateJob(job, "succeeded", message);
		console.log(`[fetch_evidence] deal=${dealId} inserted=${inserted} filter=${filter ?? ""}`);
		return { inserted };
	} catch (err) {
		const message = err instanceof Error ? err.message : "Failed to fetch evidence";
		await updateJob(job, "failed", message);
		throw err;
	}
});
createWorker("analyze_deal", baseProcessor("running", "succeeded"));

const shutdown = async () => {
	await closePool();
	process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log("DealDecision worker started");
