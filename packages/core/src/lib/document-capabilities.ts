export type DocumentKind =
	| "pdf"
	| "excel"
	| "powerpoint"
	| "word"
	| "image"
	| "csv"
	| "text"
	| "unknown";

export type DocumentCapabilities = {
	kind: DocumentKind;
	visualExtractable: boolean;
	renderedPages: {
		required: boolean;
		supported: boolean;
	};
};

export function inferDocumentKind(input: {
	fileName?: string | null;
	mimeType?: string | null;
	kindHint?: string | null;
}): DocumentKind {
	const hint = (input.kindHint ?? "").trim().toLowerCase();
	if (hint === "pdf") return "pdf";
	if (hint === "excel" || hint === "xlsx" || hint === "xls" || hint === "spreadsheet") return "excel";
	if (hint === "powerpoint" || hint === "pptx" || hint === "ppt" || hint === "presentation") return "powerpoint";
	if (hint === "word" || hint === "docx" || hint === "doc") return "word";
	if (hint === "image" || hint === "png" || hint === "jpg" || hint === "jpeg" || hint === "gif" || hint === "webp") return "image";
	if (hint === "csv") return "csv";
	if (hint === "text" || hint === "txt") return "text";

	const fileName = (input.fileName ?? "").trim().toLowerCase();
	const ext = fileName.includes(".") ? fileName.split(".").pop() ?? "" : "";
	const mt = (input.mimeType ?? "").trim().toLowerCase();

	if (ext === "pdf" || mt.includes("application/pdf")) return "pdf";
	if (["xlsx", "xls"].includes(ext) || mt.includes("spreadsheet")) return "excel";
	if (["pptx", "ppt"].includes(ext) || mt.includes("presentation") || mt.includes("powerpoint")) return "powerpoint";
	if (["docx", "doc"].includes(ext) || mt.includes("word")) return "word";
	if (["png", "jpg", "jpeg", "gif", "webp", "tif", "tiff", "bmp"].includes(ext) || mt.startsWith("image/"))
		return "image";
	if (ext === "csv" || mt.includes("text/csv")) return "csv";
	if (ext === "txt" || mt.startsWith("text/plain")) return "text";

	return "unknown";
}

export function getDocumentCapabilities(input: {
	fileName?: string | null;
	mimeType?: string | null;
	kindHint?: string | null;
}): DocumentCapabilities {
	const kind = inferDocumentKind(input);

	const visualExtractable = kind === "pdf" || kind === "excel" || kind === "powerpoint" || kind === "word" || kind === "image";

	// Policy: for any doc we plan to run vision-based visual extraction on,
	// we require rendered page images to exist in R2 under rendered_pages/page_%04d.png.
	const renderedPagesSupported = visualExtractable;
	const renderedPagesRequired = visualExtractable;

	return {
		kind,
		visualExtractable,
		renderedPages: {
			required: renderedPagesRequired,
			supported: renderedPagesSupported,
		},
	};
}

export function getInitialRenderedPagesChunk(input: {
	capabilities: DocumentCapabilities;
	maxPagesPerChunk: number;
	totalPagesHint?: number | null;
}): { page_start: number; page_end: number } | null {
	const max = Math.max(1, Math.floor(input.maxPagesPerChunk));
	if (!input.capabilities.renderedPages.required) return null;

	if (input.capabilities.kind === "image") {
		return { page_start: 0, page_end: 1 };
	}

	const total = typeof input.totalPagesHint === "number" && Number.isFinite(input.totalPagesHint)
		? Math.max(0, Math.floor(input.totalPagesHint))
		: 0;

	if (input.capabilities.kind === "pdf" && total > 0) {
		return { page_start: 0, page_end: Math.min(total, max) };
	}

	// Office docs (pptx/docx/xlsx) have unknown pages at ingest; render_document_pages will detect.
	return { page_start: 0, page_end: max };
}
