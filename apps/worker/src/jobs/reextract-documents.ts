import type { Job } from "bullmq";

import { getQueue } from "../lib/queue";
import { updateJobProgress } from "../lib/job-progress";
import {
	deleteExtractionEvidenceForDocument,
	getDocumentsByIds,
	getDocumentsForDealWithVerification,
	insertDocumentExtractionAudit,
	updateDocumentStatus,
} from "../lib/db";
import { selectReextractCandidates } from "../lib/reextract-selection";

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

	const ingestQueue = getQueue("ingest_documents");
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

		await ingestQueue.add(
			"ingest_documents",
			{
				document_id: doc.id,
				deal_id: doc.deal_id,
				file_name: typeof doc.title === "string" && doc.title.trim() ? doc.title : `${doc.id}`,
				mode: "from_storage",
				attempt: 1,
				parent_job_id: jobId,
			},
			{ removeOnComplete: true, removeOnFail: false }
		);
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
