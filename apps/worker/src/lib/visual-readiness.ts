export type VisualDocReadinessInput = {
	id: string;
	status: string | null;
	hasExtractionMetadata: boolean;
	pageCount: number | null;
	hasRenderedPages: boolean;
	hasOriginalBytes: boolean;
};

export function evaluateVisualDocReadiness(
	input: VisualDocReadinessInput
): { blocked: boolean; reason: "status_not_ready" | "missing_extraction_metadata" | "no_page_images" | null } {
	const statusReady = input.status === "completed" || input.status === "ready_for_analysis";
	if (!statusReady) return { blocked: true, reason: "status_not_ready" };
	if (!input.hasExtractionMetadata) return { blocked: true, reason: "missing_extraction_metadata" };
	const pageCountMissing = input.pageCount == null || input.pageCount <= 0;
	if (pageCountMissing && !input.hasRenderedPages) return { blocked: true, reason: "no_page_images" };
	return { blocked: false, reason: null };
}
