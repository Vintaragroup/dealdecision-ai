// BullMQ queue names (shared runtime constants).
// Keep in sync with JobType values and any queue registries.

export const QUEUE_NAMES = {
	ingest_documents: "ingest_documents",
	render_document_pages: "render_document_pages",
	extract_visuals: "extract_visuals",
	finalize_extract_visuals: "finalize_extract_visuals",
	deep_scan_visuals: "deep_scan_visuals",
	document_intelligence_extract: "document_intelligence_extract",
	fetch_evidence: "fetch_evidence",
	analyze_deal: "analyze_deal",
	verify_documents: "verify_documents",
	remediate_extraction: "remediate_extraction",
	reextract_documents: "reextract_documents",
	populate_document_page_understanding: "populate_document_page_understanding",
	investor_insights: "investor_insights",
	export_report_pdf: "export_report_pdf",
	monitor_deal_signals: "monitor_deal_signals",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];
