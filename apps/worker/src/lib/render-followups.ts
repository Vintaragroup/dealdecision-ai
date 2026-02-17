export function shouldSkipExtractVisualsAfterRenderV1(input: {
	doc_kind: string;
	page_count_total: number | null | undefined;
	vision_fallback_allowed: boolean;
}): boolean {
	// Policy: for PDFs we allow extract_visuals follow-up on "normal" decks/docs (<= 80 pages)
	// even when text extraction looks good. Preserve safety for huge PDFs.
	if (input.doc_kind !== "pdf") return false;
	const total = typeof input.page_count_total === "number" && Number.isFinite(input.page_count_total)
		? input.page_count_total
		: null;
	if (total != null && total > 80) return !input.vision_fallback_allowed;
	return false;
}
