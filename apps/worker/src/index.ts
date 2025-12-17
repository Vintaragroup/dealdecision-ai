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
import { processDocument } from "./lib/processors";
import type { DocumentAnalysis } from "./lib/processors";

async function updateJob(job: Job, status: JobStatus, message?: string) {
	const pool = getPool();
	await pool.query(
		`UPDATE jobs SET status = $2, updated_at = now(), message = COALESCE($3, message) WHERE job_id = $1`,
		[(job.id ?? job.name).toString(), status, message ?? null]
	);
}

async function ingestDocumentProcessor(job: Job) {
	const documentId = (job.data as { document_id?: string; file_buffer?: string } | undefined)?.document_id;
	const fileBufferB64 = (job.data as { document_id?: string; file_buffer?: string } | undefined)?.file_buffer;
	const fileName = (job.data as { document_id?: string; file_name?: string } | undefined)?.file_name;
	const dealId = (job.data as { document_id?: string; deal_id?: string } | undefined)?.deal_id;

	if (!documentId || !fileBufferB64 || !dealId || !fileName) {
		await updateJob(job, "failed", "Missing required fields: documentId, fileBufferB64, dealId, or fileName");
		return { ok: false };
	}

	try {
		await updateJob(job, "running", "Extracting document content");
		if (documentId) {
			await updateDocumentStatus(documentId, "processing");
		}

		// Decode base64 buffer
		const buffer = Buffer.from(fileBufferB64, "base64");

		// Process document
		const analysis: DocumentAnalysis = await processDocument(
			buffer,
			fileName,
			documentId,
			dealId
		);

		await updateJob(
			job,
			"running",
			`Extracted ${analysis.contentType} content (${Math.round(analysis.metadata.processingTimeMs)}ms)`
		);

		if (!analysis.metadata.extractionSuccess) {
			await updateDocumentStatus(documentId, "failed");
			await updateJob(job, "failed", analysis.metadata.errorMessage || "Extraction failed");
			return { ok: false, analysis };
		}

		// Store analysis in evidence
		for (const metric of analysis.structuredData.keyMetrics.slice(0, 10)) {
			await insertEvidence({
				deal_id: dealId,
				document_id: documentId,
				source: "extraction",
				kind: "metric",
				text: String(metric.key),
				confidence: 0.8,
			});
		}

		for (const heading of analysis.structuredData.mainHeadings.slice(0, 10)) {
			await insertEvidence({
				deal_id: dealId,
				document_id: documentId,
				source: "extraction",
				kind: "section",
				text: heading,
				confidence: 0.9,
			});
		}

		// Store summary
		if (analysis.structuredData.textSummary) {
			await insertEvidence({
				deal_id: dealId,
				document_id: documentId,
				source: "extraction",
				kind: "summary",
				text: analysis.structuredData.textSummary,
				confidence: 0.85,
			});
		}

		await updateDocumentStatus(documentId, "completed");
		await updateJob(
			job,
			"succeeded",
			`Extracted ${analysis.structuredData.keyMetrics.length} metrics, ${analysis.structuredData.mainHeadings.length} headings`
		);

		console.log(`[ingest_document] documentId=${documentId} dealId=${dealId} type=${analysis.contentType} success=true`);
		return { ok: true, analysis };
	} catch (err) {
		const message = err instanceof Error ? err.message : "Unknown error";
		if (documentId) {
			await updateDocumentStatus(documentId, "failed");
		}
		await updateJob(job, "failed", `Document extraction failed: ${message}`);
		console.error(`[ingest_document] error:`, err);
		throw err;
	}
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
				deal_id: dealId,
				document_id: draft.document_id,
				source: draft.source,
				kind: draft.kind,
				text: draft.text,
				confidence: 0.7,
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
