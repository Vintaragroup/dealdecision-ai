/**
 * Promote visual OCR text into documents.full_text for full-text search.
 *
 * Extracted from index.ts so extract_visuals and finalize_extract_visuals
 * processors can import without depending on the monolithic index module.
 */

import { createHash } from "crypto";
import { sanitizeText } from "@dealdecision/core";

import { mergeDocumentExtractionMetadata } from "./db";

export async function promoteVisualOcrToDocumentFullText(params: {
	pool: any;
	documentId: string;
	dealId?: string | null;
	triggerJobId?: string | null;
}): Promise<{ promoted: boolean; ocrChars: number; pages: number; reason: string }> {
	const pool = params.pool;
	const documentId = sanitizeText(params.documentId);
	if (!documentId) return { promoted: false, ocrChars: 0, pages: 0, reason: "invalid_document_id" };

	let docRow: any = null;
	try {
		const { rows } = await pool.query(
			"SELECT full_text, full_text_absent_reason, extraction_metadata FROM documents WHERE id = $1 LIMIT 1",
			[documentId]
		);
		docRow = rows?.[0] ?? null;
	} catch {
		return { promoted: false, ocrChars: 0, pages: 0, reason: "document_lookup_failed" };
	}

	const existingMeta =
		docRow?.extraction_metadata && typeof docRow.extraction_metadata === "object"
			? docRow.extraction_metadata
			: null;
	const existingSearchIndex =
		existingMeta?.search_index && typeof existingMeta.search_index === "object"
			? existingMeta.search_index
			: null;
	const existingSha =
		typeof existingSearchIndex?.visual_ocr_sha256 === "string"
			? String(existingSearchIndex.visual_ocr_sha256)
			: "";

	let ocrRows: Array<{ page_index: number | null; ocr_text: string | null }> = [];
	try {
		const { rows } = await pool.query(
			`
			SELECT va.page_index, ve.ocr_text
			  FROM visual_assets va
			  JOIN visual_extractions ve ON ve.visual_asset_id = va.id
			 WHERE va.document_id = $1
			   AND ve.ocr_text IS NOT NULL
			   AND length(ve.ocr_text) > 0
			 ORDER BY va.page_index ASC
			`,
			[documentId]
		);
		ocrRows = (rows ?? []) as any;
	} catch (err: any) {
		const msg = err instanceof Error ? err.message : String(err);
		if (/relation\s+"?(visual_assets|visual_extractions)"?\s+does\s+not\s+exist/i.test(msg)) {
			return { promoted: false, ocrChars: 0, pages: 0, reason: "visual_tables_missing" };
		}
		return { promoted: false, ocrChars: 0, pages: 0, reason: "ocr_query_failed" };
	}

	const parts: string[] = [];
	const seenPages = new Set<number>();
	let chars = 0;
	const maxOcrChars = 120_000;
	for (const r of ocrRows) {
		const t = typeof r?.ocr_text === "string" ? r.ocr_text : "";
		if (!t.trim()) continue;
		const pageIndex =
			typeof r?.page_index === "number" && Number.isFinite(r.page_index) ? r.page_index : null;
		if (pageIndex != null) seenPages.add(pageIndex);
		const header = pageIndex != null ? `\n\n[OCR page ${pageIndex + 1}]\n` : "\n\n[OCR]\n";
		const chunk = header + t.trim();
		if (chars + chunk.length > maxOcrChars) {
			const remaining = Math.max(0, maxOcrChars - chars);
			if (remaining > 0) {
				parts.push(chunk.slice(0, remaining));
				chars += Math.min(remaining, chunk.length);
			}
			break;
		}
		parts.push(chunk);
		chars += chunk.length;
	}

	const ocrText = parts.join("").trim();
	if (!ocrText) return { promoted: false, ocrChars: 0, pages: 0, reason: "no_ocr_text" };

	const sha = createHash("sha256").update(ocrText).digest("hex");
	if (existingSha && existingSha === sha) {
		return { promoted: false, ocrChars: ocrText.length, pages: seenPages.size, reason: "already_promoted" };
	}

	const existingFullText = typeof docRow?.full_text === "string" ? String(docRow.full_text) : "";
	const maxFullText = 1024 * 1024;
	let nextFullText = "";
	if (existingFullText.trim()) {
		nextFullText = (
			existingFullText + "\n\n---\nOCR (visual extraction)\n" + ocrText
		).slice(0, maxFullText);
	} else {
		nextFullText = ocrText.slice(0, maxFullText);
	}

	try {
		await pool.query(
			`UPDATE documents
			    SET full_text = $2,
			        full_text_absent_reason = NULL,
			        updated_at = now()
			  WHERE id = $1`,
			[documentId, nextFullText]
		);
	} catch {
		return {
			promoted: false,
			ocrChars: ocrText.length,
			pages: seenPages.size,
			reason: "document_full_text_update_failed",
		};
	}

	try {
		await mergeDocumentExtractionMetadata({
			documentId,
			patch: {
				search_index: {
					visual_ocr_sha256: sha,
					visual_ocr_promoted_at: new Date().toISOString(),
					visual_ocr_char_count: ocrText.length,
					visual_ocr_pages: seenPages.size,
					trigger_job_id: params.triggerJobId ?? null,
				},
			},
		});
	} catch {
		// best-effort
	}

	try {
		console.log(
			JSON.stringify({
				event: "SEARCH_INDEX_UPDATED",
				deal_id: params.dealId ?? null,
				document_id: documentId,
				method: "postgres_documents_full_text",
				ocr_chars: ocrText.length,
				ocr_pages: seenPages.size,
				trigger_job_id: params.triggerJobId ?? null,
				ts: new Date().toISOString(),
			})
		);
	} catch {
		// ignore
	}

	return {
		promoted: true,
		ocrChars: ocrText.length,
		pages: seenPages.size,
		reason: "promoted",
	};
}
