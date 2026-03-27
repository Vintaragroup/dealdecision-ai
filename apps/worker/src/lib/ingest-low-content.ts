import type { JobStatus } from "@dealdecision/contracts";

export type LowContentDecisionInput = {
	contentType: string;
	attempt: number;
	completenessReason: string;
};

export type LowContentDecision =
	| {
		kind: "retry";
		docStatus: "pending" | "ready_for_analysis";
		jobStatus: JobStatus;
		message: string;
		nextAttempt: number;
	}
	| {
		kind: "needs_ocr";
		docStatus: "needs_ocr";
		jobStatus: JobStatus;
		message: string;
		enqueue: {
			render_document_pages: { force_ocr: true };
			document_intelligence_extract: true;
		};
	}
	| {
		kind: "fail";
		docStatus: "failed";
		jobStatus: JobStatus;
		message: string;
	};

export function decideLowContentOutcome(input: LowContentDecisionInput): LowContentDecision {
	const contentType = String(input.contentType ?? "").toLowerCase();
	const attempt = Number.isFinite(Number(input.attempt)) ? Math.max(0, Math.floor(Number(input.attempt))) : 0;
	const reason = typeof input.completenessReason === "string" && input.completenessReason.trim()
		? input.completenessReason.trim()
		: "unknown";

	const isPdf = contentType === "pdf" || contentType === "application/pdf" || contentType.endsWith("/pdf");

	// Existing behavior: first 2 attempts retry.
	if (attempt < 2) {
		return {
			kind: "retry",
			// Treat the doc as ingested (with warnings) so downstream pipeline steps can proceed.
			// A follow-up ingest attempt is enqueued to try to improve extraction quality.
			docStatus: "ready_for_analysis",
			// Important: we enqueue a follow-up ingest job, but this job must reach a terminal status.
			// Leaving the original job in `retrying` causes API clients (and our e2e harness)
			// to block forever because the follow-up has a different job_id.
			jobStatus: "succeeded_with_warnings",
			message: `Low-content extraction (${reason}); scheduled retry`,
			nextAttempt: attempt + 1,
		};
	}

	// New behavior: PDFs never hard-fail solely due to low-content. Require OCR/DI.
	if (isPdf) {
		return {
			kind: "needs_ocr",
			docStatus: "needs_ocr",
			jobStatus: "succeeded_with_warnings",
			message: `Low-content extraction after retries (${reason}); OCR required`,
			enqueue: {
				render_document_pages: { force_ocr: true },
				document_intelligence_extract: true,
			},
		};
	}

	return {
		kind: "fail",
		docStatus: "failed",
		jobStatus: "failed",
		message: `Low-content extraction after retries (${reason})`,
	};
}
