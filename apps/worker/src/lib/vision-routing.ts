import { sanitizeText } from "@dealdecision/core";

import { getPool, mergeDocumentExtractionMetadata } from "./db";
import { computeVisionRoutingDecisionV1, deduceDocKind } from "./visual-extraction";

function getMinPdfTextThresholdChars(env: NodeJS.ProcessEnv = process.env): number {
	const v = Number(env.PDF_MIN_TEXT_THRESHOLD_CHARS);
	return Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 800;
}

export async function computeAndPersistVisionRoutingV1(params: {
	pool: ReturnType<typeof getPool>;
	documentId: string;
	stage: "render_document_pages" | "extract_visuals" | "deep_scan_visuals";
	jobId: string | null;
	force_ocr?: boolean;
}): Promise<{
	doc_kind: string;
	full_text_len: number;
	decision: ReturnType<typeof computeVisionRoutingDecisionV1>;
}> {
	const minTextThresholdChars = getMinPdfTextThresholdChars(process.env);
	let docKind = "unknown";
	let extractionMetadata: any = null;
	let docType: string | null = null;
	let fullTextLen = 0;
	let fullContent: any = null;
	let pageCount: number | null = null;
	let pagesWithText: number | null = null;
	let totalPages: number | null = null;
	let coverage: number | null = null;
	let completenessScore: number | null = null;
	let summaryLength: number | null = null;
	try {
		const { rows } = await params.pool.query<{ extraction_metadata: any; type: string | null; full_text_len: number; full_content: any; page_count: number | null }>(
			"SELECT extraction_metadata, type, full_content, page_count, length(coalesce(full_text,''))::int AS full_text_len FROM documents WHERE id = $1 LIMIT 1",
			[sanitizeText(params.documentId)]
		);
		extractionMetadata = rows?.[0]?.extraction_metadata ?? null;
		docType = typeof rows?.[0]?.type === "string" ? rows[0].type : null;
		fullContent = rows?.[0]?.full_content ?? null;
		pageCount = typeof rows?.[0]?.page_count === "number" && Number.isFinite(rows[0].page_count) ? Math.max(0, Math.floor(rows[0].page_count)) : null;
		fullTextLen = typeof rows?.[0]?.full_text_len === "number" ? rows[0].full_text_len : 0;
		docKind = deduceDocKind({ extraction_metadata: extractionMetadata, type: docType });

		// Compute page-level text coverage for PDFs. Prefer stored full_content pages so hybrid OCR merges are reflected.
		if (docKind === "pdf") {
			const fc = fullContent && typeof fullContent === "object" ? fullContent : null;
			const pages = Array.isArray(fc?.pages) ? fc.pages : null;
			if (pages) {
				totalPages = pages.length;
				pagesWithText = pages.filter((p: any) => typeof p?.text === "string" && p.text.trim().length > 0).length;
			} else {
				totalPages = pageCount;
				pagesWithText = null;
			}
			if (typeof totalPages === "number" && totalPages > 0 && typeof pagesWithText === "number") {
				coverage = pagesWithText / totalPages;
			}
		}

		const metaObj = extractionMetadata && typeof extractionMetadata === "object" ? extractionMetadata : null;
		completenessScore = typeof metaObj?.completeness?.score === "number" && Number.isFinite(metaObj.completeness.score) ? metaObj.completeness.score : null;
		summaryLength = typeof metaObj?.summaryLength === "number" && Number.isFinite(metaObj.summaryLength) ? Math.max(0, Math.floor(metaObj.summaryLength)) : null;
	} catch {
		// best-effort
	}

	const decision = computeVisionRoutingDecisionV1({
		doc_kind: docKind,
		extraction_metadata: extractionMetadata,
		full_text_len: fullTextLen,
		min_text_threshold_chars: minTextThresholdChars,
		force_ocr: params.force_ocr,
		page_coverage: { pages_with_text: pagesWithText, total_pages: totalPages, coverage },
		completeness_score: completenessScore,
		summary_length: summaryLength,
	});

	try {
		await mergeDocumentExtractionMetadata({
			documentId: params.documentId,
			patch: {
				vision_routing_v1: {
					decided_at: new Date().toISOString(),
					doc_kind: docKind,
					vision_fallback_allowed: decision.vision_fallback_allowed,
					reason: decision.reason,
					inputs: {
						...decision.inputs,
					},
				},
			},
		});
	} catch {
		// best-effort
	}

	return { doc_kind: docKind, full_text_len: fullTextLen, decision };
}
