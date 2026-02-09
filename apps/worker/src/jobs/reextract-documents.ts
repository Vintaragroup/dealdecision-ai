import type { Job } from "bullmq";

import { sanitizeJobId } from "../lib/job-id";
import { updateJobProgress } from "../lib/job-progress";
import { enqueuePersistedJob } from "../lib/job-enqueue";
import {
	deleteExtractionEvidenceForDocument,
	getDocumentOriginalFileMeta,
	getDocumentsByIds,
	getDocumentsForDealWithVerification,
	insertDocumentExtractionAudit,
	updateDocumentStatus,
} from "../lib/db";
import { selectReextractCandidates } from "../lib/reextract-selection";

function inferFileNameFallback(input: { documentId: string; mimeType: string | null }): string {
	const mt = String(input.mimeType ?? "").toLowerCase();
	if (mt.includes("pdf")) return `${input.documentId}.pdf`;
	if (mt.includes("presentation") || mt.includes("powerpoint") || mt.includes("ppt")) return `${input.documentId}.pptx`;
	if (mt.includes("sheet") || mt.includes("excel") || mt.includes("spreadsheet")) return `${input.documentId}.xlsx`;
	if (mt.includes("word")) return `${input.documentId}.docx`;
	if (mt.startsWith("image/")) {
		const ext = mt.split("/")[1] || "png";
		return `${input.documentId}.${ext}`;
	}
	if (mt.includes("csv")) return `${input.documentId}.csv`;
	return `${input.documentId}`;
}

function hasUsableExtensionForIngest(fileName: string): boolean {
	const raw = String(fileName ?? "").trim();
	if (!raw) return false;
	const lower = raw.toLowerCase();
	// Require a known extension so downstream detectFileType() behaves.
	const ext = lower.includes(".") ? lower.split(".").pop() || "" : "";
	if (!ext) return false;
	return ["pdf", "pptx", "ppt", "xlsx", "xls", "docx", "doc", "png", "jpg", "jpeg", "gif", "csv"].includes(ext);
}

type ReextractDocumentsJobData = {
	deal_id?: string;
	document_ids?: string[];
	threshold_low?: number;
	include_warnings?: boolean;
	force?: boolean;
	mode?: string;
};

export type ReextractDocumentsCoordinatorResult = {
	status: "enqueued";
	docs: number;
};

export async function reextractDocumentsProcessor(job: Job): Promise<ReextractDocumentsCoordinatorResult> {
	const data = (job.data ?? {}) as ReextractDocumentsJobData;
	const dealId = typeof data.deal_id === "string" ? data.deal_id : undefined;
	const documentIds = Array.isArray(data.document_ids) ? data.document_ids : undefined;
	const thresholdLow = Number(data.threshold_low ?? 0.75);
	const includeWarnings = Boolean(data.include_warnings);
	const force = Boolean(data.force) || String(data.mode ?? "").toLowerCase() === "manual";
	const jobId = job.id ? String(job.id) : null;

	const logStage = (stage: string, extra: Record<string, unknown> = {}) => {
		console.log(
			JSON.stringify({
				event: "REEXTRACT_STAGE",
				job_id: jobId,
				deal_id: dealId ?? null,
				stage,
				...extra,
			})
		);
	};

	if (!dealId) {
		await updateJobProgress(job, { status: "failed", stage: "status_update", message: "Missing deal_id" });
		return { status: "enqueued", docs: 0 };
	}

	logStage("job_start", { threshold_low: thresholdLow, include_warnings: includeWarnings, force });
	await updateJobProgress(job, {
		status: "running",
		stage: "status_update",
		current: 5,
		total: 100,
		message: "Scanning documents for re-extraction",
	});

	const explicitDocIds = Array.isArray(documentIds) && documentIds.length > 0;
	const sourceDocs = explicitDocIds ? await getDocumentsByIds(documentIds) : await getDocumentsForDealWithVerification(dealId);

	const candidates = force && !explicitDocIds
		? sourceDocs.filter((d) => d.deal_id === dealId)
		: selectReextractCandidates(sourceDocs, {
			dealId,
			explicitDocIds,
			thresholdLow,
			includeWarnings,
		});

	logStage("docs_selected", {
		candidates: candidates.length,
		explicit_doc_ids: explicitDocIds,
		threshold_low: thresholdLow,
		include_warnings: includeWarnings,
		force,
	});

	await updateJobProgress(job, {
		stage: "docs_selected",
		current: 0,
		total: candidates.length,
		message: `Selected ${candidates.length} document(s)`,
		meta: { idx: 0, total: candidates.length },
	});

	if (candidates.length === 0) {
		logStage("enqueue_followups_done", { docs: 0 });
		logStage("job_complete", { status: "enqueued", docs: 0 });
		try {
			await job.updateProgress({ stage: "complete" } as any);
		} catch {
			// best-effort
		}
		await updateJobProgress(job, {
			status: "succeeded",
			stage: "status_update",
			current: 100,
			total: 100,
			message: "No documents matched re-extraction criteria",
		});
		return { status: "enqueued", docs: 0 };
	}

	for (let i = 0; i < candidates.length; i += 1) {
		const doc = candidates[i];
		logStage("doc_start", {
			document_id: doc.id,
			doc_index: i,
			docs_total: candidates.length,
			title: doc.title ?? null,
		});
		await updateJobProgress(job, {
			stage: "doc",
			current: i,
			total: candidates.length,
			message: `Enqueueing re-extract ${i + 1}/${candidates.length}`,
			meta: { doc_index: i, total_docs: candidates.length, doc_id: doc.id },
		});

		// Best-effort audit + cleanup; coordinator must not block long-running child work.
		try {
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
				triggeredByJobId: jobId ?? undefined,
			});
		} catch {
			// best-effort
		}

		try {
			await deleteExtractionEvidenceForDocument({ documentId: doc.id });
		} catch {
			// best-effort
		}

		try {
			await updateDocumentStatus(doc.id, "pending");
		} catch {
			// best-effort
		}

		const enqueueIdRaw = `ingest_documents__${dealId}__${doc.id}__${jobId ?? "reextract"}__${i}`;
		const ingestJobId = sanitizeJobId(enqueueIdRaw);
		try {
			const meta = await getDocumentOriginalFileMeta(doc.id);
			const fileNameFromMetaRaw = typeof meta?.file_name === "string" && meta.file_name.trim() ? meta.file_name.trim() : null;
			const fileNameFromMeta = fileNameFromMetaRaw && hasUsableExtensionForIngest(fileNameFromMetaRaw) ? fileNameFromMetaRaw : null;
			const fileName = fileNameFromMeta ?? inferFileNameFallback({ documentId: doc.id, mimeType: meta?.mime_type ?? null });

			await enqueuePersistedJob({
				job_id: ingestJobId,
				type: "ingest_documents",
				deal_id: doc.deal_id,
				document_id: doc.id,
				parent_job_id: jobId,
				payload: {
					document_id: doc.id,
					deal_id: doc.deal_id,
					file_name: fileName,
					mode: "from_storage",
					attempt: 1,
					parent_job_id: jobId,
				},
			});
			console.log(
				JSON.stringify({
					event: "REEXTRACT_ENQUEUED_INGEST",
					deal_id: doc.deal_id,
					document_id: doc.id,
					ingest_job_id: ingestJobId,
					bullmq_job_id: ingestJobId,
					parent_job_id: jobId,
				})
			);
		} catch (err) {
			console.warn(
				`[reextract_documents] failed to enqueue ingest_documents doc=${doc.id}: ${err instanceof Error ? err.message : String(err)}`
			);
			logStage("enqueue_ingest_failed", {
				document_id: doc.id,
				ingest_job_id: ingestJobId,
				error: err instanceof Error ? err.message : String(err),
			});
			continue;
		}
	}

	logStage("enqueue_followups_done", { docs: candidates.length });
	logStage("job_complete", { status: "enqueued", docs: candidates.length });

	try {
		await job.updateProgress({ stage: "complete" } as any);
	} catch {
		// best-effort
	}

	await updateJobProgress(job, {
		status: "succeeded",
		stage: "status_update",
		current: 100,
		total: 100,
		message: `Enqueued re-extraction for ${candidates.length} document(s)`,
	});

	return { status: "enqueued", docs: candidates.length };
}
