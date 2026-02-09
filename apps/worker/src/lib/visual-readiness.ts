export type VisualDocReadinessInput = {
	id: string;
	status: string | null;
	deletedAt: string | null;
	metaStatus: string | null;
	/**
	 * Explicitly ignored: guard must not depend on jobs table state.
	 * Present for test coverage / future-proofing.
	 */
	jobStatus?: string | null;
};

export type VisualIngestBlockReason =
	| "deleted"
	| "status_not_ready"
	| "meta_status_missing"
	| "meta_status_not_succeeded";

export function getVisualIngestBlockReason(input: {
	status: string | null;
	deletedAt: string | null;
	metaStatus: string | null;
	jobStatus?: string | null;
}): VisualIngestBlockReason | null {
	// Source of truth is documents table only.
	void input.jobStatus;
	if (input.deletedAt != null) return "deleted";
	// Most flows set documents.status=ready_for_analysis once ingestion is complete.
	// Some remediation flows temporarily set status=needs_ocr while still producing
	// usable rendered pages + successful ingest metadata. Visual extraction should
	// be allowed to proceed in that state to avoid guard stalls.
	const status = typeof input.status === "string" ? input.status : "";
	if (status !== "ready_for_analysis") {
		const meta = typeof input.metaStatus === "string" ? input.metaStatus.toLowerCase() : null;
		const allowNeedsOcr = status === "needs_ocr" && meta === "succeeded";
		if (!allowNeedsOcr) return "status_not_ready";
	}
	if (input.metaStatus == null) return "meta_status_missing";
	if (input.metaStatus !== "succeeded") return "meta_status_not_succeeded";
	return null;
}

export function isIngestCompleteForVisuals(input: {
	status: string | null;
	deletedAt: string | null;
	metaStatus: string | null;
	jobStatus?: string | null;
}): boolean {
	return getVisualIngestBlockReason(input) == null;
}

export function evaluateVisualDocReadiness(
	input: VisualDocReadinessInput
	): { blocked: boolean; reason: "ingest_not_complete" | "deleted" | null } {
	const blockReason = getVisualIngestBlockReason(input);
	if (blockReason === "deleted") return { blocked: true, reason: "deleted" };
	if (blockReason != null) return { blocked: true, reason: "ingest_not_complete" };
	return { blocked: false, reason: null };
}
