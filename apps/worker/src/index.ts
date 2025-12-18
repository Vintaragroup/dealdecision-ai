import type { Job } from "bullmq";
import { randomUUID } from "crypto";
import type { JobStatus } from "@dealdecision/contracts";
import { sanitizeText } from "@dealdecision/core";
import { createWorker, getQueue } from "./lib/queue";
import {
	getPool,
	closePool,
	updateDocumentStatus,
	updateDocumentAnalysis,
	insertEvidence,
	getDocumentsForDeal,
	getEvidenceDocumentIds,
	updateDocumentVerification,
	saveIngestionReport,
	getDocumentsByIds,
} from "./lib/db";
import { deriveEvidenceDrafts } from "./lib/evidence";
import { processDocument } from "./lib/processors";
import { verifyDocumentExtraction } from "./lib/verification";
import type { DocumentAnalysis, ExtractedContent } from "./lib/processors";
import type { VerificationResult } from "./lib/verification";

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

/**
 * Extract full text from extracted content for full-text search indexing
 */
function extractFullText(content: ExtractedContent | null, contentType: string): string {
	if (!content) return "";

	const parts: string[] = [];

	switch (contentType) {
		case "pdf": {
			const pdf = content as any;
			if (pdf.pages && Array.isArray(pdf.pages)) {
				for (const page of pdf.pages) {
					if (page.text) parts.push(page.text);
					if (page.slideTitle) parts.push(page.slideTitle);
				}
			}
			break;
		}
		case "excel": {
			const excel = content as any;
			if (excel.sheets && Array.isArray(excel.sheets)) {
				for (const sheet of excel.sheets) {
					if (sheet.name) parts.push(`Sheet: ${sheet.name}`);
					if (sheet.headers) parts.push(sheet.headers.join(" "));
					if (sheet.rows && Array.isArray(sheet.rows)) {
						for (const row of sheet.rows) {
							parts.push(Object.values(row).map(v => String(v)).join(" "));
						}
					}
				}
			}
			break;
		}
		case "powerpoint": {
			const ppt = content as any;
			if (ppt.slides && Array.isArray(ppt.slides)) {
				for (const slide of ppt.slides) {
					if (slide.title) parts.push(slide.title);
					if (slide.notes) parts.push(slide.notes);
					if (slide.textContent) parts.push(slide.textContent);
				}
			}
			break;
		}
		case "word": {
			const word = content as any;
			if (word.paragraphs && Array.isArray(word.paragraphs)) {
				for (const para of word.paragraphs) {
					if (para.text) parts.push(para.text);
				}
			}
			if (word.summary?.totalText) parts.push(word.summary.totalText);
			break;
		}
		case "image": {
			const image = content as any;
			if (image.ocrText) parts.push(image.ocrText);
			break;
		}
	}

	return parts.join(" ").substring(0, 1000000); // Cap at 1MB for storage
}

/**
 * Get page count from extracted content
 */
function getPageCount(content: ExtractedContent | null, contentType: string): number {
	if (!content) return 0;

	switch (contentType) {
		case "pdf": {
			const pdf = content as any;
			return pdf.metadata?.pages || pdf.summary?.totalPages || 0;
		}
		case "excel": {
			const excel = content as any;
			return excel.metadata?.totalSheets || 0;
		}
		case "powerpoint": {
			const ppt = content as any;
			return ppt.slides?.length || 0;
		}
		case "word": {
			const word = content as any;
			return 1; // Word documents are typically single file
		}
		case "image": {
			return 1; // Single image file
		}
		default:
			return 0;
	}
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
	return { score, reason, summaryLen, headings, metrics };
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
		[sanitizeText((job.id ?? job.name).toString()), sanitizeText(status), message ? sanitizeText(message) : null, progressPct ?? null]
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
			const fullText = extractFullText(analysis.content, analysis.contentType);
			const pageCount = getPageCount(analysis.content, analysis.contentType);
			await updateDocumentAnalysis({
				documentId,
				structuredData: analysis.structuredData,
				extractionMetadata,
				fullContent: analysis.content,
				fullText: fullText || undefined,
				pageCount: pageCount || undefined,
			});
			await updateDocumentStatus(documentId, needsOcr ? "needs_ocr" : "failed");
			await updateJob(job, "failed", message);
			return { ok: false, analysis };
		}

		// Store analysis in evidence - now capturing ALL metrics and headings, not just top 10
		let metricsInserted = 0;
		for (const metric of analysis.structuredData.keyMetrics) {
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
		for (const heading of analysis.structuredData.mainHeadings) {
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

		const fullText = extractFullText(analysis.content, analysis.contentType);
		const pageCount = getPageCount(analysis.content, analysis.contentType);
		
		// Determine content threshold based on document type
		// Word docs (cut sheets, whitepapers) can be valid with minimal content
		// Other formats need more substantial content
		let contentThreshold = 0.5;
		if (analysis.contentType === "word") {
			contentThreshold = 0.25; // Lower threshold for Word docs
		}
		
		const lowContent = completeness.score < contentThreshold;
		
		if (lowContent && attempt < 2) {
			const message = `Low-content extraction (${completeness.reason}); retrying`;
			extractionMetadata.errorMessage = message;
			await updateDocumentAnalysis({
				documentId,
				structuredData: analysis.structuredData,
				extractionMetadata,
				fullContent: analysis.content,
				fullText: fullText || undefined,
				pageCount: pageCount || undefined,
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
				fullContent: analysis.content,
				fullText: fullText || undefined,
				pageCount: pageCount || undefined,
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
				fullContent: analysis.content,
				fullText: fullText || undefined,
				pageCount: pageCount || undefined,
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

			// Queue verification job for this document
			const verifyQueue = getQueue("verify_documents");
			await verifyQueue.add(
				"verify_documents",
				{
					deal_id: dealId,
					document_ids: [documentId],
				},
				{ removeOnComplete: true, removeOnFail: false, delay: 500 } // Small delay to ensure extraction is fully written
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

/**
 * Verification job: Runs after extraction to verify data quality and readiness
 */
createWorker("verify_documents", async (job: Job) => {
	const dealId = (job.data as { deal_id?: string } | undefined)?.deal_id;
	const documentIds = (job.data as { document_ids?: string[] } | undefined)?.document_ids;

	if (!dealId || !documentIds || documentIds.length === 0) {
		await updateJob(job, "failed", "Missing deal_id or document_ids");
		return { ok: false };
	}

	try {
		await updateJob(job, "running", `Verifying ${documentIds.length} document(s)...`, 10);

		const pool = getPool();
		const documents = await getDocumentsByIds(documentIds);

		if (documents.length === 0) {
			await updateJob(job, "failed", "Documents not found");
			return { ok: false };
		}

		const verificationResults: Record<string, VerificationResult> = {};
		let passCount = 0;
		let warnCount = 0;
		let failCount = 0;

		// Verify each document
		for (let i = 0; i < documents.length; i++) {
			const doc = documents[i];
			const progressPct = Math.round((i / documents.length) * 80) + 10;

			try {
				// Get the structured analysis data
				const analysis = {
					content: doc.full_content,
					contentType: doc.type || "other",
					structuredData: doc.structured_data || { keyMetrics: [], mainHeadings: [], textSummary: "" },
					metadata: {
						extractionSuccess: doc.status === "completed",
						errorMessage: null,
						processingTimeMs: 0,
					},
				} as DocumentAnalysis;

				const verificationResult = verifyDocumentExtraction({
					analysis,
					fullText: doc.full_text,
					pageCount: doc.page_count || 0,
					extractionMetadata: doc.extraction_metadata,
				});

				verificationResults[doc.id] = verificationResult;

				// Determine status based on overall score
				const verificationStatus = verificationResult.overall_score >= 0.8
					? "verified"
					: verificationResult.overall_score >= 0.5
					? "warnings"
					: "failed";

				if (verificationStatus === "verified") passCount++;
				else if (verificationStatus === "warnings") warnCount++;
				else failCount++;

				// Update document with verification result
				await updateDocumentVerification({
					documentId: doc.id,
					verificationStatus,
					verificationResult,
					readyForAnalysisAt: verificationStatus === "verified" ? new Date() : undefined,
				});

				// Mark as ready if verified
				if (verificationStatus === "verified") {
					await updateDocumentStatus(doc.id, "ready_for_analysis");
				}

				await updateJob(
					job,
					"running",
					`Verified ${doc.title} (score: ${(verificationResult.overall_score * 100).toFixed(0)}%)`,
					progressPct
				);
			} catch (err) {
				console.error(`[verify_documents] error verifying ${doc.id}:`, err);
				await updateDocumentVerification({
					documentId: doc.id,
					verificationStatus: "failed",
					verificationResult: {
						error: err instanceof Error ? err.message : "Unknown error",
					},
				});
				failCount++;
			}
		}

		const message = `Verification complete: ${passCount} verified, ${warnCount} warnings, ${failCount} failed`;
		await updateJob(job, "succeeded", message, 100);
		console.log(`[verify_documents] deal=${dealId} ${message}`);

		return { ok: true, passCount, warnCount, failCount, verificationResults };
	} catch (err) {
		const message = err instanceof Error ? err.message : "Verification failed";
		await updateJob(job, "failed", message);
		console.error(`[verify_documents] error:`, err);
		throw err;
	}
});

/**
 * Ingestion report job: Generates summary report after all docs are extracted and verified
 */
createWorker("generate_ingestion_report", async (job: Job) => {
	const dealId = (job.data as { deal_id?: string } | undefined)?.deal_id;
	const documentIds = (job.data as { document_ids?: string[] } | undefined)?.document_ids;

	if (!dealId || !documentIds || documentIds.length === 0) {
		await updateJob(job, "failed", "Missing deal_id or document_ids");
		return { ok: false };
	}

	try {
		await updateJob(job, "running", "Generating ingestion report...", 20);

		const documents = await getDocumentsByIds(documentIds);

		const documentSummaries = documents.map(doc => {
			const structuredData = doc.structured_data as any;
			const extractionMetadata = doc.extraction_metadata as any;
			const verificationResult = doc.verification_result as VerificationResult | null;

			return {
				title: doc.title,
				type: doc.type,
				status: doc.status,
				verification_status: doc.verification_status,
				pages: doc.page_count || 0,
				file_size_bytes: extractionMetadata?.fileSizeBytes || 0,
				extraction_quality_score: (verificationResult?.overall_score ?? 0.5),
				metrics_extracted: structuredData?.keyMetrics?.length || 0,
				sections_found: structuredData?.mainHeadings?.length || 0,
				ocr_avg_confidence: verificationResult?.quality_checks?.ocr_confidence?.avg || 100,
				verification_warnings: verificationResult?.warnings || [],
			};
		});

		// Calculate overall metrics
		const totalPages = documents.reduce((sum, d) => sum + (d.page_count || 0), 0);
		const totalMetrics = documents.reduce((sum, d) => {
			const sd = d.structured_data as any;
			return sum + (sd?.keyMetrics?.length || 0);
		}, 0);
		const totalSections = documents.reduce((sum, d) => {
			const sd = d.structured_data as any;
			return sum + (sd?.mainHeadings?.length || 0);
		}, 0);
		const avgQualityScore = documents.length > 0
			? documentSummaries.reduce((sum, d) => sum + d.extraction_quality_score, 0) / documents.length
			: 0;

		// Determine overall readiness
		const verifiedCount = documents.filter(d => d.verification_status === "verified").length;
		const warningCount = documents.filter(d => d.verification_status === "warnings").length;
		const failedCount = documents.filter(d => d.verification_status === "failed").length;

		let overallReadiness: "ready" | "needs_review" | "failed" = "ready";
		let readinessDetails = "All documents verified and ready for analysis";

		if (failedCount > 0) {
			overallReadiness = "failed";
			readinessDetails = `${failedCount} document(s) failed verification. Please review and re-upload.`;
		} else if (warningCount > 0) {
			overallReadiness = "needs_review";
			readinessDetails = `${warningCount} document(s) have warnings. Review before proceeding.`;
		}

		const summary = {
			files_uploaded: documentIds.length,
			total_pages: totalPages,
			total_metrics: totalMetrics,
			total_sections: totalSections,
			avg_quality_score: avgQualityScore,
			documents: documentSummaries,
			overall_readiness: overallReadiness,
			readiness_details: readinessDetails,
			verification_summary: {
				verified: verifiedCount,
				warnings: warningCount,
				failed: failedCount,
			},
			completed_at: new Date().toISOString(),
			next_steps: overallReadiness === "ready"
				? "Proceed to deal analysis with uploaded documents"
				: "Address warnings/failures before proceeding",
		};

		const reportId = randomUUID();
		await saveIngestionReport({
			reportId,
			dealId,
			summary,
			documentIds,
		});

		// Update all documents with ingestion summary
		for (const doc of documents) {
			const pool = getPool();
			await pool.query(
				`UPDATE documents SET ingestion_summary = $2 WHERE id = $1`,
				[doc.id, summary]
			);
		}

		await updateJob(
			job,
			"succeeded",
			`Report generated: ${verifiedCount} verified, ${warningCount} warnings, ${failedCount} failed`,
			100
		);

		console.log(`[generate_ingestion_report] deal=${dealId} report_id=${reportId} readiness=${overallReadiness}`);

		return { ok: true, report_id: reportId, summary };
	} catch (err) {
		const message = err instanceof Error ? err.message : "Report generation failed";
		await updateJob(job, "failed", message);
		console.error(`[generate_ingestion_report] error:`, err);
		throw err;
	}
});

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
