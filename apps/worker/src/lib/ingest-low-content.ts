import type { JobStatus } from "@dealdecision/contracts";

export type LowContentDecisionInput = {
	contentType: string;
	attempt: number;
	completenessReason: string;
};

export type LowContentDecision =
	| {
		kind: "retry";
		docStatus: "pending";
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

	// Existing behavior: first 2 attempts retry.
	if (attempt < 2) {
		return {
			kind: "retry",
			docStatus: "pending",
			jobStatus: "retrying",
			message: `Low-content extraction (${reason}); retrying`,
			nextAttempt: attempt + 1,
		};
	}

	// New behavior: PDFs never hard-fail solely due to low-content. Require OCR/DI.
	if (contentType === "pdf") {
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
