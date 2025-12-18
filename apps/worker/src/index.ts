import type { Job } from "bullmq";
import { randomUUID } from "crypto";
import type { JobStatus } from "@dealdecision/contracts";
import { createWorker, getQueue } from "./lib/queue";
import {
	getPool,
	closePool,
	updateDocumentStatus,
	updateDocumentAnalysis,
	insertEvidence,
	getDocumentsForDeal,
	getEvidenceDocumentIds,
} from "./lib/db";
import { deriveEvidenceDrafts } from "./lib/evidence";
import { processDocument } from "./lib/processors";
import type { DocumentAnalysis } from "./lib/processors";

// Polyfill Promise.withResolvers for Node runtimes that don't provide it yet (Node < 22)
if (typeof (Promise as any).withResolvers !== "function") {
	(Promise as any).withResolvers = function <T = unknown>() {
		let resolve!: (value: T | PromiseLike<T>) => void;
		let reject!: (reason?: unknown) => void;
		const promise = new Promise<T>((res, rej) => {
			resolve = res;
			reject = rej;
		});
		return { promise, resolve, reject };
	};
}

function computeCompleteness(analysis: DocumentAnalysis) {
	const headings = analysis.structuredData.mainHeadings?.length ?? 0;
	const metrics = analysis.structuredData.keyMetrics?.length ?? 0;
	const summaryLen = analysis.structuredData.textSummary?.length ?? 0;

	let score = 0;
	if (summaryLen >= 100) score += 0.4;
	else if (summaryLen >= 20) score += 0.2;
	if (headings >= 3) score += 0.3;
	else if (headings >= 1) score += 0.15;
	if (metrics >= 5) score += 0.3;
	else if (metrics >= 1) score += 0.15;

	const reason = `summary=${summaryLen} chars, headings=${headings}, metrics=${metrics}, score=${score.toFixed(2)}`;
	return { score, reason };
}

async function updateJob(job: Job, status: JobStatus, message?: string, progressPct?: number | null) {
	const pool = getPool();
	await pool.query(
		`UPDATE jobs
		 SET status = $2,
		     updated_at = now(),
		     message = COALESCE($3, message),
		     progress_pct = COALESCE($4, progress_pct)
		 WHERE job_id = $1`,
		[(job.id ?? job.name).toString(), status, message ?? null, progressPct ?? null]
	);
}

async function ingestDocumentProcessor(job: Job) {
	const documentId = (job.data as { document_id?: string; file_buffer?: string } | undefined)?.document_id;
	const fileBufferB64 = (job.data as { document_id?: string; file_buffer?: string } | undefined)?.file_buffer;
	const fileName = (job.data as { document_id?: string; file_name?: string } | undefined)?.file_name;
	const dealId = (job.data as { document_id?: string; deal_id?: string } | undefined)?.deal_id;
	const attempt = Number((job.data as { attempt?: number } | undefined)?.attempt ?? 1);

	console.log(
		`[ingest_document] start job=${job.id} doc=${documentId ?? ""} deal=${dealId ?? ""} attempt=${attempt} payloadSize=${fileBufferB64?.length ?? 0}`
	);

	if (!documentId || !fileBufferB64 || !dealId || !fileName) {
		console.error(`[ingest_document] Missing required fields:`, { documentId, fileBufferB64: !!fileBufferB64, dealId, fileName });
		await updateJob(job, "failed", "Missing required fields: documentId, fileBufferB64, dealId, or fileName");
		return { ok: false };
	}

	try {
		await updateJob(job, "running", `Starting document extraction (attempt ${attempt})`, 5);
		if (documentId) {
			await updateDocumentStatus(documentId, "processing");
		}

		// Decode base64 buffer
		const buffer = Buffer.from(fileBufferB64, "base64");
		const decodedBytes = buffer.length;
		console.log(
			`[ingest_document] decoded bytes=${decodedBytes} doc=${documentId} deal=${dealId} attempt=${attempt}`
		);
		if (decodedBytes === 0) {
			await updateJob(job, "failed", "Decoded file buffer is empty", 100);
			await updateDocumentStatus(documentId, "failed");
			console.error(`[ingest_document] decoded empty buffer doc=${documentId} deal=${dealId} attempt=${attempt}`);
			return { ok: false };
		}
		await updateJob(job, "running", `Decoded file (${buffer.length} bytes)`, 15);

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
			`Extracted ${analysis.contentType} (${Math.round(analysis.metadata.processingTimeMs)}ms)` ,
			50
		);

		const completeness = computeCompleteness(analysis);
		const extractionMetadata = {
			contentType: analysis.contentType,
			fileSizeBytes: decodedBytes,
			processingTimeMs: analysis.metadata.processingTimeMs,
			attempt,
			decodedBytes,
			pagesProcessed: analysis.contentType === "pdf" ? (analysis.content as any)?.summary?.processedPages ?? null : null,
			totalPages: analysis.contentType === "pdf" ? (analysis.content as any)?.summary?.totalPages ?? null : null,
			totalWords: analysis.contentType === "pdf" ? (analysis.content as any)?.summary?.totalWords ?? null : null,
			textItems: analysis.contentType === "pdf" ? (analysis.content as any)?.summary?.textItems ?? null : null,
			headingsCount: analysis.structuredData.mainHeadings?.length ?? 0,
			summaryLength: analysis.structuredData.textSummary?.length ?? 0,
			completeness,
			errorMessage: analysis.metadata.errorMessage,
			needsOcr: false,
		};

		if (!analysis.metadata.extractionSuccess) {
			const message = analysis.metadata.errorMessage || "Extraction failed";
			const needsOcr = message.toLowerCase().includes("no text extracted") || message.toLowerCase().includes("image-only");
			extractionMetadata.needsOcr = needsOcr;
			await updateDocumentAnalysis({
				documentId,
				structuredData: analysis.structuredData,
				extractionMetadata,
			});
			await updateDocumentStatus(documentId, needsOcr ? "needs_ocr" : "failed");
			await updateJob(job, "failed", message);
			return { ok: false, analysis };
		}

		// Store analysis in evidence
		let metricsInserted = 0;
		for (const metric of analysis.structuredData.keyMetrics.slice(0, 10)) {
			await insertEvidence({
				deal_id: dealId,
				document_id: documentId,
				source: "extraction",
				kind: "metric",
				text: String(metric.key),
				confidence: 0.8,
			});
			metricsInserted += 1;
		}

		let headingsInserted = 0;
		for (const heading of analysis.structuredData.mainHeadings.slice(0, 10)) {
			await insertEvidence({
				deal_id: dealId,
				document_id: documentId,
				source: "extraction",
				kind: "section",
				text: heading,
				confidence: 0.9,
			});
			headingsInserted += 1;
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

		await updateJob(job, "running", `Inserted evidence (metrics=${metricsInserted}, headings=${headingsInserted})`, 80);

		const lowContent = completeness.score < 0.5;
		if (lowContent && attempt < 2) {
			const message = `Low-content extraction (${completeness.reason}); retrying`;
			extractionMetadata.errorMessage = message;
			await updateDocumentAnalysis({
				documentId,
				structuredData: analysis.structuredData,
				extractionMetadata,
			});
			await updateDocumentStatus(documentId, "pending");
			await updateJob(job, "failed", message, 100);
			console.warn(`[ingest_document] low content, requeuing attempt ${attempt + 1}`);
			const ingestQueue = getQueue("ingest_document");
			await ingestQueue.add("ingest_document", { ...job.data, attempt: attempt + 1 }, { removeOnComplete: true, removeOnFail: false });
			return { ok: false, analysis, completeness };
		} else if (lowContent) {
			const message = `Low-content extraction after retries (${completeness.reason})`;
			extractionMetadata.errorMessage = message;
			await updateDocumentAnalysis({
				documentId,
				structuredData: analysis.structuredData,
				extractionMetadata,
			});
			await updateDocumentStatus(documentId, "failed");
			await updateJob(job, "failed", message, 100);
			console.warn(`[ingest_document] low content after retries documentId=${documentId}`);
			return { ok: false, analysis, completeness };
		} else {
			await updateDocumentAnalysis({
				documentId,
				status: "completed",
				structuredData: analysis.structuredData,
				extractionMetadata,
			});
			await updateJob(
				job,
				"succeeded",
				`Extracted ${analysis.structuredData.keyMetrics.length} metrics, ${analysis.structuredData.mainHeadings.length} headings (score=${completeness.score.toFixed(2)})`,
				100
			);

			console.log(
				`[ingest_document] documentId=${documentId} dealId=${dealId} type=${analysis.contentType} success=true metrics=${metricsInserted} headings=${headingsInserted} score=${completeness.score.toFixed(2)}`
			);
		}
		return { ok: true, analysis };
	} catch (err) {
		const message = err instanceof Error ? err.message : "Unknown error";
		const needsOcr = typeof message === "string" && (message.toLowerCase().includes("no text extracted") || message.toLowerCase().includes("image-only"));
		if (documentId) {
			await updateDocumentAnalysis({
				documentId,
				extractionMetadata: {
					contentType: fileName?.toLowerCase().split(".").pop() ?? null,
					attempt,
					errorMessage: message,
					needsOcr,
				},
			});
			await updateDocumentStatus(documentId, needsOcr ? "needs_ocr" : "failed");
		}
		await updateJob(job, "failed", `Document extraction failed: ${message}`, 100);
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

// Keep-alive interval to ensure process doesn't exit
setInterval(() => {
	// Just keep the process alive
}, 30000);
