import type { Job } from "bullmq";
import { randomUUID, createHash } from "crypto";
import type { JobStatus } from "@dealdecision/contracts";
import {
	sanitizeText,
	generatePhase1DIOV1,
	DealOrchestrator,
	DIOStorageImpl,
	SlideSequenceAnalyzer,
	MetricBenchmarkValidator,
	VisualDesignScorer,
	NarrativeArcDetector,
	FinancialHealthCalculator,
	RiskAssessmentEngine,
} from "@dealdecision/core";
import { createWorker, getQueue } from "./lib/queue";
import {
	getPool,
	closePool,
	updateDocumentStatus,
	updateDocumentAnalysis,
	insertEvidence,
	deleteExtractionEvidenceForDeal,
	deleteExtractionEvidenceForDocument,
	getDocumentsForDeal,
	getDocumentsForDealWithAnalysis,
	getEvidenceDocumentIds,
	updateDocumentVerification,
	saveIngestionReport,
	getDocumentsByIds,
	getDocumentsForDealWithVerification,
	insertDocumentExtractionAudit,
	getDocumentOriginalFile,
	upsertDocumentOriginalFile,
} from "./lib/db";
import { deriveEvidenceDrafts } from "./lib/evidence";
import { normalizeToCanonical } from "./lib/normalization";
import { processDocument } from "./lib/processors";
import { verifyDocumentExtraction } from "./lib/verification";
import { remediateStructuredData } from "./lib/remediation";
import { buildPhase1DealOverviewV2, buildPhase1UpdateReportV1 } from "./lib/phase1/dealOverviewV2";
import { buildPhase1BusinessArchetypeV1 } from "./lib/phase1/businessArchetypeV1";
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

async function getDealIdForJob(job: Job): Promise<string | null> {
	const pool = getPool();
	const jobId = (job.id ?? job.name)?.toString();
	if (!jobId) return null;

	const { rows } = await pool.query<{ deal_id: string | null }>(
		`SELECT deal_id FROM jobs WHERE job_id = $1`,
		[sanitizeText(jobId)]
	);
	return rows?.[0]?.deal_id ?? null;
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
		const extractionStartedAt = new Date().toISOString();
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

		// Persist original bytes for future true re-extraction
		try {
			const sha256 = createHash("sha256").update(buffer).digest("hex");
			await upsertDocumentOriginalFile({
				documentId,
				sha256,
				bytes: buffer,
				sizeBytes: decodedBytes,
				fileName,
				mimeType: null,
			});
			console.log(`[ingest_document] stored original bytes sha256=${sha256} doc=${documentId}`);
		} catch (err) {
			// Do not fail ingestion if original-byte persistence fails; extraction can still proceed.
			console.warn(
				`[ingest_document] failed to store original bytes doc=${documentId}: ${err instanceof Error ? err.message : "unknown"}`
			);
		}

		// Process document
		const analysis: DocumentAnalysis = await processDocument(
			buffer,
			fileName,
			documentId,
			dealId
		);

		// Normalization (always runs): ensure structured_data.canonical.* exists.
		const normalized = normalizeToCanonical({
			contentType: analysis.contentType,
			content: analysis.content,
			structuredData: analysis.structuredData,
		});
		analysis.structuredData = normalized.structuredData;

		await updateJob(
			job,
			"running",
			`Extracted ${analysis.contentType} (${Math.round(analysis.metadata.processingTimeMs)}ms)` ,
			50
		);

		const completeness = computeCompleteness(analysis);
		const extractorNameByKind: Record<string, string> = {
			pdf: "worker.pdf",
			excel: "worker.excel",
			powerpoint: "worker.powerpoint",
			word: "worker.word",
			image: "worker.ocr",
			unknown: "worker.unknown",
		};
		const docKind = analysis.contentType;
		const extractionFinishedAt = new Date().toISOString();
		const extractionMetadata: any = {
			// DoD-required fields
			doc_kind: docKind,
			extractor_name: extractorNameByKind[docKind] ?? "worker.unknown",
			extractor_version: process.env.DOC_EXTRACTOR_VERSION || "1.0.0",
			started_at: extractionStartedAt,
			finished_at: extractionFinishedAt,
			status: analysis.metadata.extractionSuccess ? "succeeded" : "failed",

			// Existing fields kept for compatibility
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
			const fullTextAbsentReason = fullText && fullText.trim().length > 0
				? null
				: needsOcr
					? "no_text_extracted_needs_ocr"
					: "no_text_extracted";
			await updateDocumentAnalysis({
				documentId,
				structuredData: analysis.structuredData,
				extractionMetadata,
				fullContent: analysis.content,
				fullText: fullText || undefined,
				fullTextAbsentReason: fullTextAbsentReason ?? undefined,
				pageCount: pageCount || undefined,
			});

			// Evidence emission (best-effort): even on failed extraction, canonical may contain derived/null metrics.
			// Only emit when we have concrete detected values.
			for (const ev of normalized.canonicalEvidence) {
				await insertEvidence({
					deal_id: dealId,
					document_id: documentId,
					source: "extraction",
					kind: "canonical_metric",
					text: `${ev.metric_key}: ${ev.value} • ${ev.source_pointer}`,
					confidence: 0.9,
				});
			}
			await updateDocumentStatus(documentId, needsOcr ? "needs_ocr" : "failed");
			await updateJob(job, "failed", message);
			return { ok: false, analysis };
		}

		// Store analysis in evidence - now capturing ALL metrics and headings, not just top 10
		let metricsInserted = 0;
		for (const metric of analysis.structuredData.keyMetrics) {
			const key = typeof (metric as any)?.key === "string" ? String((metric as any).key) : "metric";
			const rawValue = (metric as any)?.value;
			const value = typeof rawValue === "string"
				? rawValue
				: typeof rawValue === "number"
					? String(rawValue)
					: rawValue == null
						? ""
						: JSON.stringify(rawValue);
			const context = typeof (metric as any)?.source === "string" ? String((metric as any).source) : "";
			const isNumericValue = key.trim().toLowerCase() === "numeric_value";
			const label = isNumericValue ? "extracted_number" : key;
			const textParts = [`${label}${value ? `: ${value}` : ""}`];
			if (context) textParts.push(`source: ${context}`);
			await insertEvidence({
				deal_id: dealId,
				document_id: documentId,
				source: "extraction",
				kind: "metric",
				text: textParts.join(" • "),
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

		// Evidence emission (DoD): canonical metrics with pointers (esp. Excel)
		let canonicalInserted = 0;
		for (const ev of normalized.canonicalEvidence) {
			await insertEvidence({
				deal_id: dealId,
				document_id: documentId,
				source: "extraction",
				kind: "canonical_metric",
				text: `${ev.metric_key}: ${ev.value} • ${ev.source_pointer}`,
				confidence: 0.9,
			});
			canonicalInserted += 1;
		}
		if (canonicalInserted > 0) {
			await updateJob(job, "running", `Inserted canonical metric evidence (${canonicalInserted})`, 82);
		}

		const fullText = extractFullText(analysis.content, analysis.contentType);
		const pageCount = getPageCount(analysis.content, analysis.contentType);
		const fullTextAbsentReason = fullText && fullText.trim().length > 0
			? null
			: analysis.contentType === "excel"
				? "excel_has_no_full_text"
				: "no_text_extracted";
		
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
				fullTextAbsentReason: fullTextAbsentReason ?? undefined,
				pageCount: pageCount || undefined,
			});
			await updateDocumentStatus(documentId, "pending");
			await updateJob(job, "failed", message, 100);
			console.warn(`[ingest_document] low content, requeuing attempt ${attempt + 1}`);
			const ingestQueue = getQueue("ingest_documents");
			await ingestQueue.add("ingest_documents", { ...job.data, attempt: attempt + 1 }, { removeOnComplete: true, removeOnFail: false });
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
				fullTextAbsentReason: fullTextAbsentReason ?? undefined,
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
				fullTextAbsentReason: fullTextAbsentReason ?? undefined,
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
					doc_kind: fileName?.toLowerCase().split(".").pop() ?? null,
					extractor_name: "worker.unknown",
					extractor_version: process.env.DOC_EXTRACTOR_VERSION || "1.0.0",
					started_at: null,
					finished_at: new Date().toISOString(),
					status: "failed",
					contentType: fileName?.toLowerCase().split(".").pop() ?? null,
					attempt,
					errorMessage: message,
					needsOcr,
				},
				fullTextAbsentReason: "extraction_failed",
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

createWorker("ingest_documents", ingestDocumentProcessor);
createWorker("fetch_evidence", async (job: Job) => {
	const dealId = (job.data as { deal_id?: string } | undefined)?.deal_id;
	const filter = (job.data as { filter?: string } | undefined)?.filter;
	if (!dealId) {
		await updateJob(job, "failed", "Missing deal_id for evidence fetch");
		return { ok: false };
	}

	try {
		await updateJob(job, "running", "Fetching evidence", 5);
		// Also rebuild extraction evidence from stored structured_data so the UI shows
		// metric values/context (not just keys like numeric_value).
		const docsForAnalysis = await getDocumentsForDealWithAnalysis(dealId);
		if (docsForAnalysis.length === 0) {
			await updateJob(job, "succeeded", "No documents available for evidence");
			return { inserted: 0 };
		}

		// Important: wipe all existing extraction evidence for this deal before rebuilding.
		// This removes stale/orphaned rows (e.g. evidence tied to documents that were deleted)
		// and prevents legacy metrics like plain `numeric_value` from lingering.
		await deleteExtractionEvidenceForDeal({ dealId });

		let rebuilt = 0;
		for (const doc of docsForAnalysis) {
			const structured = (doc.structured_data && typeof doc.structured_data === "object")
				? (doc.structured_data as any)
				: null;
			if (!structured) continue;

			// Defensive: deal-level delete above should already remove these, but keep the
			// per-document delete as a safeguard if this code is reused elsewhere.
			await deleteExtractionEvidenceForDocument({ documentId: doc.id });

			// Metrics
			const metrics = Array.isArray(structured?.keyMetrics) ? structured.keyMetrics : [];
			for (const metric of metrics) {
				const key = typeof metric?.key === "string" ? String(metric.key) : "metric";
				const rawValue = metric?.value;
				const value = typeof rawValue === "string"
					? rawValue
					: typeof rawValue === "number"
						? String(rawValue)
						: rawValue == null
							? ""
							: JSON.stringify(rawValue);
				const context = typeof metric?.source === "string" ? String(metric.source) : "";
				const isNumericValue = key.trim().toLowerCase() === "numeric_value";
				const label = isNumericValue ? "extracted_number" : key;
				const textParts = [`${label}${value ? `: ${value}` : ""}`];
				if (context) textParts.push(`source: ${context}`);
				await insertEvidence({
					deal_id: dealId,
					document_id: doc.id,
					source: "extraction",
					kind: "metric",
					text: textParts.join(" • "),
					confidence: 0.8,
				});
			}

			// Sections/headings
			const headings = Array.isArray(structured?.mainHeadings) ? structured.mainHeadings : [];
			for (const heading of headings) {
				if (typeof heading !== "string" || !heading.trim()) continue;
				await insertEvidence({
					deal_id: dealId,
					document_id: doc.id,
					source: "extraction",
					kind: "section",
					text: heading,
					confidence: 0.9,
				});
			}

			// Summary
			if (typeof structured?.textSummary === "string" && structured.textSummary.trim()) {
				await insertEvidence({
					deal_id: dealId,
					document_id: doc.id,
					source: "extraction",
					kind: "summary",
					text: structured.textSummary,
					confidence: 0.85,
				});
			}

			rebuilt += 1;
		}

		await updateJob(job, "running", `Rebuilt extraction evidence (docs=${rebuilt})`, 40);

		const documents = docsForAnalysis.map((d) => ({
			document_id: d.id,
			deal_id: d.deal_id,
			title: d.title,
			type: d.type,
			status: d.status,
			uploaded_at: d.uploaded_at,
			updated_at: d.updated_at,
		}));

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

		const message = inserted === 0
			? `No new fetch_evidence items created (rebuilt extraction evidence for ${rebuilt} doc(s))`
			: `Created ${inserted} fetch_evidence item(s) (rebuilt extraction evidence for ${rebuilt} doc(s))`;
		await updateJob(job, "succeeded", message, 100);
		console.log(`[fetch_evidence] deal=${dealId} inserted=${inserted} rebuilt=${rebuilt} filter=${filter ?? ""}`);
		return { inserted };
	} catch (err) {
		const message = err instanceof Error ? err.message : "Failed to fetch evidence";
		await updateJob(job, "failed", message);
		throw err;
	}
});
createWorker("analyze_deal", async (job: Job) => {
	const dealId =
		(job.data as { deal_id?: string } | undefined)?.deal_id ??
		(await getDealIdForJob(job));
	if (!dealId) {
		await updateJob(job, "failed", "Missing deal_id for analysis", 100);
		return { ok: false };
	}

	try {
		await updateJob(job, "running", "Loading documents for analysis", 10);
		const rows = await getDocumentsForDealWithAnalysis(dealId);
		const eligible = rows.filter(
			(doc) => (doc.status === "completed" || doc.status === "ready_for_analysis") && doc.extraction_metadata
		);
		if (eligible.length === 0) {
			await updateJob(job, "failed", "No extracted documents available for analysis", 100);
			return { ok: false };
		}

		const inputDocuments = eligible.map((doc) => {
			const extraction = (doc.extraction_metadata && typeof doc.extraction_metadata === "object")
				? (doc.extraction_metadata as Record<string, unknown>)
				: {};
			const structured = (doc.structured_data && typeof doc.structured_data === "object")
				? (doc.structured_data as Record<string, unknown>)
				: {};
			const canonical = (structured as any)?.canonical && typeof (structured as any).canonical === "object"
				? (structured as any).canonical
				: undefined;
			const canonicalMetrics = (canonical as any)?.financials?.canonical_metrics && typeof (canonical as any).financials.canonical_metrics === "object"
				? ((canonical as any).financials.canonical_metrics as Record<string, unknown>)
				: {};
			const canonicalKeyMetrics = Object.entries(canonicalMetrics)
				.filter(([, v]) => typeof v === "number" && Number.isFinite(v as number))
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([k, v]) => ({ key: k, value: v, source: "canonical" }));

			return {
				document_id: doc.id,
				title: doc.title,
				type: doc.type,
				page_count: doc.page_count ?? undefined,
				verification_status: doc.verification_status ?? null,
				verification_result: doc.verification_result ?? null,

				// DoD: analyzers consume canonical structured data only
				canonical: canonical ?? {
					company: {},
					deal: {},
					traction: {},
					financials: { canonical_metrics: {} },
					risks: {},
				},
				keyMetrics: canonicalKeyMetrics,
				mainHeadings: [],
				textSummary: "",

				// DoD: full_text allowed only as fallback
				full_text: typeof doc.full_text === "string" ? doc.full_text : undefined,
				full_text_absent_reason: typeof doc.full_text_absent_reason === "string" ? doc.full_text_absent_reason : undefined,

				// Keep only non-content metadata that helps orchestration; no raw extractor artifacts.
				doc_kind: (extraction as any).doc_kind ?? undefined,
				extractor_name: (extraction as any).extractor_name ?? undefined,
				extractor_version: (extraction as any).extractor_version ?? undefined,
			};
		});

		const dio_context = {
			primary_doc_type: inputDocuments.some((d: any) => d.type === "pitch_deck") ? "pitch_deck" : "other",
			deal_type: "other",
			vertical: "other",
			stage: "unknown",
			confidence: 0.5,
		};

		await updateJob(job, "running", `Running analysis (${inputDocuments.length} document(s))`, 40);

		const storage = new DIOStorageImpl(process.env.DATABASE_URL || "");
		let previousDio: any | null = null;
		try {
			previousDio = await storage.getLatestDIO(dealId);
		} catch {
			previousDio = null;
		}

		const nowIso = new Date().toISOString();
		const phase1_deal_overview_v2 = buildPhase1DealOverviewV2({
			nowIso,
			documents: eligible.map((doc) => ({
				document_id: doc.id,
				title: doc.title,
				type: doc.type,
				full_text: doc.full_text,
				full_content: doc.full_content,
			})),
		});
		const phase1_business_archetype_v1 = buildPhase1BusinessArchetypeV1({
			nowIso,
			documents: eligible.map((doc) => ({
				document_id: doc.id,
				title: doc.title,
				type: doc.type,
				full_text: doc.full_text,
				full_content: doc.full_content,
			})),
		});

		// Deterministic docs fingerprint for change acknowledgement.
		const docsFingerprint = createHash("sha256")
			.update(
				eligible
					.map((d) => ({
						id: String(d.id ?? ""),
						type: typeof d.type === "string" ? d.type : "",
						title: typeof d.title === "string" ? d.title : "",
					}))
					.sort((a, b) => a.id.localeCompare(b.id))
					.map((d) => `${d.id}|${d.type}|${d.title}`)
					.join("\n")
			)
			.digest("hex");
		const previousDocsFingerprint =
			(typeof (previousDio as any)?.dio?.phase1?.update_report_v1?.docs_fingerprint === "string")
				? (previousDio as any).dio.phase1.update_report_v1.docs_fingerprint
				: undefined;

		// Compute a deterministic current Phase 1 snapshot (no LLM; no new mining) so we can diff
		// coverage/decision/missing against the previous stored Phase 1.
		const currentPhase1 = generatePhase1DIOV1({
			deal: {
				deal_id: dealId,
				name:
					(typeof (previousDio as any)?.deal?.name === "string" ? (previousDio as any).deal.name : undefined)
					?? (typeof phase1_deal_overview_v2.deal_name === "string" ? phase1_deal_overview_v2.deal_name : undefined),
			},
			inputDocuments,
			deal_overview_v2: phase1_deal_overview_v2,
			business_archetype_v1: phase1_business_archetype_v1,
		});
		if (process.env.DEBUG_PHASE1_OVERVIEW_V2 === "1") {
			console.log(
				JSON.stringify({
					event: "phase1_deal_overview_v2_selected",
					deal_id: dealId,
					product_solution: phase1_deal_overview_v2.product_solution ?? null,
					market_icp: phase1_deal_overview_v2.market_icp ?? null,
					sources: Array.isArray(phase1_deal_overview_v2.sources) ? phase1_deal_overview_v2.sources : [],
				})
			);
		}
		const phase1_update_report_v1 = buildPhase1UpdateReportV1({
			previousDio,
			currentOverview: phase1_deal_overview_v2,
			currentPhase1,
			docsFingerprint,
			previousDocsFingerprint,
			nowIso,
		});
		{
			const hasPrevDio = !!previousDio;
			const prevDioHasPhase1 = !!(previousDio as any)?.dio?.phase1;
			const t = typeof phase1_update_report_v1;
			const isObj = !!phase1_update_report_v1 && t === "object";
			const keys = isObj ? Object.keys(phase1_update_report_v1 as any) : [];
			const summary =
				isObj && typeof (phase1_update_report_v1 as any).summary === "string" ? (phase1_update_report_v1 as any).summary : "";
			const summary_head = summary ? summary.slice(0, 80) : "";
			console.log(
				JSON.stringify({
					event: "phase1_update_report_v1_built",
					deal_id: dealId,
					hasPrevDio,
					prevDioHasPhase1,
					typeof_phase1_update_report_v1: t,
					update_report_v1_keys: keys,
					update_report_v1_summary_head: summary_head,
				})
			);
		}
		const analyzers = {
			slideSequence: new SlideSequenceAnalyzer(),
			metricBenchmark: new MetricBenchmarkValidator(),
			visualDesign: new VisualDesignScorer(),
			narrativeArc: new NarrativeArcDetector(),
			financialHealth: new FinancialHealthCalculator(),
			riskAssessment: new RiskAssessmentEngine(),
		};

		const orchestrator = new DealOrchestrator(analyzers as any, storage as any, {
			maxRetries: parseInt(process.env.ORCHESTRATOR_MAX_RETRIES || "2"),
			analyzerTimeout: parseInt(process.env.ORCHESTRATOR_TIMEOUT || "60000"),
			continueOnError: process.env.ORCHESTRATOR_CONTINUE_ON_ERROR !== "false",
			debug: process.env.ORCHESTRATOR_DEBUG === "true",
		});

		const result = await orchestrator.analyze({
			deal_id: dealId,
			analysis_cycle: 1,
			input_data: {
				documents: inputDocuments,
				dio_context,
				phase1_deal_overview_v2,
				phase1_business_archetype_v1,
				phase1_update_report_v1,
			},
		});

		if (!result.success || !result.storage_result) {
			await updateJob(job, "failed", result.error || "Analysis failed", 100);
			return { ok: false, error: result.error || "Analysis failed" };
		}

		const overallScore = (result.dio as any)?.overall_score
			?? (result.dio as any)?.score_explanation?.totals?.overall_score
			?? null;

		await updateJob(
			job,
			"succeeded",
			`Analysis complete (version=${result.storage_result.version}${result.storage_result.is_duplicate ? ", refreshed" : ""})`,
			100
		);

		return {
			ok: true,
			dio_id: result.storage_result.dio_id,
			version: result.storage_result.version,
			is_duplicate: result.storage_result.is_duplicate,
			overall_score: overallScore,
		};
	} catch (err) {
		const message = err instanceof Error ? err.message : "Analysis failed";
		await updateJob(job, "failed", message, 100);
		throw err;
	}
});

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
				const structuredData = (doc.structured_data as Partial<DocumentAnalysis["structuredData"]> | null) ?? {};
				const analysis: DocumentAnalysis = {
					documentId: doc.id,
					dealId: doc.deal_id,
					fileType: "unknown",
					fileName: doc.title,
					extractedAt: new Date(doc.updated_at || doc.uploaded_at).toISOString(),
					contentType: "unknown",
					content: (doc.full_content as ExtractedContent | null) ?? null,
					metadata: {
						fileSizeBytes: 0,
						processingTimeMs: 0,
						extractionSuccess: doc.status === "completed",
						errorMessage: undefined,
					},
					structuredData: {
						keyFinancialMetrics: structuredData.keyFinancialMetrics,
						keyMetrics: structuredData.keyMetrics ?? [],
						mainHeadings: structuredData.mainHeadings ?? [],
						textSummary: structuredData.textSummary ?? "",
						entities: structuredData.entities ?? [],
					},
				};

				const verificationResult = verifyDocumentExtraction({
					analysis,
					fullText: doc.full_text ?? undefined,
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
 * Remediation job: Canonicalizes extracted data to eliminate common artifacts
 * while preserving raw extraction fields (full_text/full_content) in the DB.
 *
 * Important constraint: we cannot re-extract from the original binary unless the
 * original file bytes are available (they are only present at upload time).
 */
createWorker("remediate_extraction", async (job: Job) => {
	const dealId = (job.data as { deal_id?: string } | undefined)?.deal_id;
	const includeWarnings = Boolean((job.data as { include_warnings?: boolean } | undefined)?.include_warnings);

	if (!dealId) {
		await updateJob(job, "failed", "Missing deal_id");
		return { ok: false };
	}

	try {
		await updateJob(job, "running", "Scanning documents needing remediation", 5);
		const documents = await getDocumentsForDealWithVerification(dealId);
		if (documents.length === 0) {
			await updateJob(job, "succeeded", "No documents found", 100);
			return { ok: true, remediated: 0 };
		}

		const candidates = documents.filter((d) => {
			if (d.status !== "completed" && d.status !== "ready_for_analysis") return false;
			if (d.verification_status === "failed") return true;
			if (includeWarnings && d.verification_status === "warnings") return true;
			// If never verified but has extracted content, allow remediation only when includeWarnings.
			if (includeWarnings && (d.verification_status == null)) return true;
			return false;
		});

		if (candidates.length === 0) {
			await updateJob(job, "succeeded", "No documents matched remediation criteria", 100);
			return { ok: true, remediated: 0 };
		}

		await updateJob(job, "running", `Remediating ${candidates.length} document(s)`, 10);

		let remediated = 0;
		let verifiedAfter = 0;
		let warningsAfter = 0;
		let failedAfter = 0;

		for (let i = 0; i < candidates.length; i++) {
			const doc = candidates[i];
			const progressPct = Math.round((i / candidates.length) * 80) + 10;

			await insertDocumentExtractionAudit({
				documentId: doc.id,
				dealId: doc.deal_id,
				structuredData: doc.structured_data ?? null,
				extractionMetadata: doc.extraction_metadata ?? null,
				fullContent: doc.full_content ?? null,
				fullText: doc.full_text ?? null,
				verificationStatus: doc.verification_status ?? null,
				verificationResult: doc.verification_result ?? null,
				reason: "remediate_extraction",
				triggeredByJobId: job.id?.toString(),
			});

			const structuredData = (doc.structured_data as Partial<DocumentAnalysis["structuredData"]> | null) ?? {
				keyMetrics: [],
				mainHeadings: [],
				textSummary: "",
				entities: [],
			};

			const remediation = remediateStructuredData({
				structuredData: {
					keyFinancialMetrics: structuredData.keyFinancialMetrics,
					keyMetrics: structuredData.keyMetrics ?? [],
					mainHeadings: structuredData.mainHeadings ?? [],
					textSummary: structuredData.textSummary ?? "",
					entities: structuredData.entities ?? [],
				},
				fullText: doc.full_text,
			});

			// Preserve raw fields; only update canonical structured_data + metadata.
			const prevMeta = (doc.extraction_metadata && typeof doc.extraction_metadata === "object")
				? (doc.extraction_metadata as Record<string, unknown>)
				: {};
			const history = Array.isArray((prevMeta as any).remediation_history)
				? ([...(prevMeta as any).remediation_history] as unknown[])
				: [];
			history.push({
				at: new Date().toISOString(),
				type: "canonicalize_structured_data",
				changes: remediation.changes,
			});

			const nextMeta = {
				...prevMeta,
				remediation_history: history,
			};

			await updateDocumentAnalysis({
				documentId: doc.id,
				structuredData: remediation.structuredData,
				extractionMetadata: nextMeta,
			});

			// Re-verify after remediation.
			const analysis: DocumentAnalysis = {
				documentId: doc.id,
				dealId: doc.deal_id,
				fileType: "unknown",
				fileName: doc.title,
				extractedAt: new Date(doc.updated_at || doc.uploaded_at).toISOString(),
				contentType: "unknown",
				content: (doc.full_content as ExtractedContent | null) ?? null,
				metadata: {
					fileSizeBytes: 0,
					processingTimeMs: 0,
					extractionSuccess: doc.status === "completed" || doc.status === "ready_for_analysis",
					errorMessage: undefined,
				},
				structuredData: remediation.structuredData,
			};

			const verificationResult = verifyDocumentExtraction({
				analysis,
				fullText: doc.full_text ?? undefined,
				pageCount: doc.page_count || 0,
				extractionMetadata: nextMeta,
			});

			const verificationStatus = verificationResult.overall_score >= 0.8
				? "verified"
				: verificationResult.overall_score >= 0.5
				? "warnings"
				: "failed";

			if (verificationStatus === "verified") verifiedAfter++;
			else if (verificationStatus === "warnings") warningsAfter++;
			else failedAfter++;

			await updateDocumentVerification({
				documentId: doc.id,
				verificationStatus,
				verificationResult,
				readyForAnalysisAt: verificationStatus === "verified" ? new Date() : undefined,
			});

			if (verificationStatus === "verified") {
				await updateDocumentStatus(doc.id, "ready_for_analysis");
			}

			remediated++;
			await updateJob(
				job,
				"running",
				`Remediated ${doc.title} → ${verificationStatus} (${(verificationResult.overall_score * 100).toFixed(0)}%)`,
				progressPct
			);
		}

		const message = `Remediation complete: ${remediated} processed (${verifiedAfter} verified, ${warningsAfter} warnings, ${failedAfter} failed)`;
		await updateJob(job, "succeeded", message, 100);
		return { ok: true, remediated, verifiedAfter, warningsAfter, failedAfter };
	} catch (err) {
		const message = err instanceof Error ? err.message : "Remediation failed";
		await updateJob(job, "failed", message, 100);
		throw err;
	}
});

/**
 * True re-extraction job: re-runs extraction from the persisted original file bytes.
 *
 * Selection behavior:
 * - If document_ids provided: re-extract those documents.
 * - Else: re-extract documents that are failed OR have overall_score < threshold_low.
 */
createWorker("reextract_documents", async (job: Job) => {
	const dealId = (job.data as { deal_id?: string } | undefined)?.deal_id;
	const documentIds = (job.data as { document_ids?: string[] } | undefined)?.document_ids;
	const thresholdLow = Number((job.data as { threshold_low?: number } | undefined)?.threshold_low ?? 0.75);
	const includeWarnings = Boolean((job.data as { include_warnings?: boolean } | undefined)?.include_warnings);

	if (!dealId) {
		await updateJob(job, "failed", "Missing deal_id");
		return { ok: false };
	}

	try {
		await updateJob(job, "running", "Scanning documents for re-extraction", 5);

		const sourceDocs = Array.isArray(documentIds) && documentIds.length > 0
			? await getDocumentsByIds(documentIds)
			: await getDocumentsForDealWithVerification(dealId);

		const candidates = sourceDocs.filter((d) => {
			if (d.deal_id !== dealId) return false;
			if (d.status !== "completed" && d.status !== "ready_for_analysis") return false;
			if (d.verification_status === "failed") return true;
			if (includeWarnings && d.verification_status === "warnings") return true;
			const score = (d.verification_result as any)?.overall_score;
			if (typeof score === "number" && Number.isFinite(score) && score < thresholdLow) return true;
			return false;
		});

		if (candidates.length === 0) {
			await updateJob(job, "succeeded", "No documents matched re-extraction criteria", 100);
			return { ok: true, reextracted: 0 };
		}

		await updateJob(job, "running", `Re-extracting ${candidates.length} document(s)`, 10);
		let reextracted = 0;
		let skippedNoFile = 0;

		for (let i = 0; i < candidates.length; i++) {
			const doc = candidates[i];
			const progressPct = Math.round((i / candidates.length) * 80) + 10;

			const original = await getDocumentOriginalFile(doc.id);
			if (!original) {
				skippedNoFile += 1;
				await updateJob(
					job,
					"running",
					`Skipping ${doc.title}: no stored original file bytes`,
					progressPct
				);
				continue;
			}

			await insertDocumentExtractionAudit({
				documentId: doc.id,
				dealId: doc.deal_id,
				structuredData: doc.structured_data ?? null,
				extractionMetadata: doc.extraction_metadata ?? null,
				fullContent: doc.full_content ?? null,
				fullText: doc.full_text ?? null,
				verificationStatus: doc.verification_status ?? null,
				verificationResult: doc.verification_result ?? null,
				reason: "reextract_documents",
				triggeredByJobId: job.id?.toString(),
			});

			await updateDocumentStatus(doc.id, "processing");
			await updateJob(job, "running", `Re-extracting ${doc.title}`, progressPct);

			// Clear prior extraction evidence for this document to avoid duplicates.
			await deleteExtractionEvidenceForDocument({ documentId: doc.id });

			const buffer = original.bytes;
			const fileName = original.file_name ?? doc.title;

			const analysis: DocumentAnalysis = await processDocument(
				buffer,
				fileName,
				doc.id,
				doc.deal_id
			);

			const decodedBytes = buffer.length;
			const completeness = computeCompleteness(analysis);
			const prevMeta = (doc.extraction_metadata && typeof doc.extraction_metadata === "object")
				? (doc.extraction_metadata as Record<string, unknown>)
				: {};
			const history = Array.isArray((prevMeta as any).reextraction_history)
				? ([...(prevMeta as any).reextraction_history] as unknown[])
				: [];
			history.push({
				at: new Date().toISOString(),
				type: "reextract_from_original",
				sha256: original.sha256,
				result: {
					contentType: analysis.contentType,
					score: completeness.score,
					reason: completeness.reason,
				},
			});

			const extractionMetadata = {
				...prevMeta,
				contentType: analysis.contentType,
				fileSizeBytes: decodedBytes,
				processingTimeMs: analysis.metadata.processingTimeMs,
				reextraction_history: history,
				completeness,
				errorMessage: analysis.metadata.errorMessage,
			};

			if (!analysis.metadata.extractionSuccess) {
				const message = analysis.metadata.errorMessage || "Re-extraction failed";
				const fullText = extractFullText(analysis.content, analysis.contentType);
				const pageCount = getPageCount(analysis.content, analysis.contentType);
				await updateDocumentAnalysis({
					documentId: doc.id,
					structuredData: analysis.structuredData,
					extractionMetadata,
					fullContent: analysis.content,
					fullText: fullText || undefined,
					pageCount: pageCount || undefined,
				});
				await updateDocumentStatus(doc.id, "failed");
				await updateJob(job, "running", `Failed ${doc.title}: ${message}`, progressPct);
				continue;
			}

			// Persist extracted content
			const fullText = extractFullText(analysis.content, analysis.contentType);
			const pageCount = getPageCount(analysis.content, analysis.contentType);
			await updateDocumentAnalysis({
				documentId: doc.id,
				status: "completed",
				structuredData: analysis.structuredData,
				extractionMetadata,
				fullContent: analysis.content,
				fullText: fullText || undefined,
				pageCount: pageCount || undefined,
			});

			// Re-insert evidence for metrics/headings/summary
			for (const metric of analysis.structuredData.keyMetrics) {
				await insertEvidence({
					deal_id: doc.deal_id,
					document_id: doc.id,
					source: "extraction",
					kind: "metric",
					text: String(metric.key),
					confidence: 0.8,
				});
			}
			for (const heading of analysis.structuredData.mainHeadings) {
				await insertEvidence({
					deal_id: doc.deal_id,
					document_id: doc.id,
					source: "extraction",
					kind: "section",
					text: heading,
					confidence: 0.9,
				});
			}
			if (analysis.structuredData.textSummary) {
				await insertEvidence({
					deal_id: doc.deal_id,
					document_id: doc.id,
					source: "extraction",
					kind: "summary",
					text: analysis.structuredData.textSummary,
					confidence: 0.85,
				});
			}

			// Re-verify after re-extraction
			const verifyQueue = getQueue("verify_documents");
			await verifyQueue.add(
				"verify_documents",
				{ deal_id: doc.deal_id, document_ids: [doc.id] },
				{ removeOnComplete: true, removeOnFail: false, delay: 500 }
			);

			reextracted += 1;
		}

		const message = `Re-extraction complete: reextracted=${reextracted}, skipped_no_file=${skippedNoFile}`;
		await updateJob(job, "succeeded", message, 100);
		console.log(`[reextract_documents] deal=${dealId} ${message}`);
		return { ok: true, reextracted, skippedNoFile };
	} catch (err) {
		const message = err instanceof Error ? err.message : "Re-extraction failed";
		await updateJob(job, "failed", message);
		console.error(`[reextract_documents] error:`, err);
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
