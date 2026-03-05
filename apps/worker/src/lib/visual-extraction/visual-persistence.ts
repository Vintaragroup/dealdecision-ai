// visual-extraction/visual-persistence.ts
// upsertVisualAsset, upsertVisualExtraction, insertEvidenceLinkIfMissing,
// persistVisionResponse, deduceDocKind, computeVisionRoutingDecisionV1 — verbatim extraction.

import type { Pool } from "pg";
import { sanitizeDeep, sanitizeText } from "@dealdecision/core";
import type {
    VisionBBox,
    VisionOcrBlock,
    VisionAsset,
    VisionExtractResponse,
    VisionRoutingDecisionV1,
} from "./types";
import {
    normalizeImageUriForDb,
    coerceBBox,
    coerceJsonObject,
    coerceJsonArray,
    coerceSegmentKey,
    mapSlideTypeToSegmentKey,
    classifySegmentKeyFromText,
    type SegmentKey,
} from "./_shared";

type LogLike = Pick<Console, "log" | "warn" | "error">;

function cleanSnippetText(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

function looksLikeJunkLine(line: string): boolean {
	const s = cleanSnippetText(line);
	if (!s) return true;
	// URLs/emails/page numbers are rarely useful for scoring evidence.
	if (/\bhttps?:\/\//i.test(s) || /\bwww\./i.test(s) || /\b\S+@\S+\b/.test(s)) return true;
	if (/^\(?\d{1,3}\)?$/.test(s)) return true;
	if (/^(?:slide|page)\s*\d+\b/i.test(s)) return true;
	// Excess symbol soup.
	const noSpace = s.replace(/\s/g, "");
	const letters = (noSpace.match(/[A-Za-z]/g) ?? []).length;
	const digits = (noSpace.match(/[0-9]/g) ?? []).length;
	const other = Math.max(0, noSpace.length - letters - digits);
	if (noSpace.length >= 10 && other / Math.max(1, noSpace.length) >= 0.35) return true;
	return false;
}

function deriveEvidenceSnippetV2(params: {
	ocrText: string | null;
	ocrBlocks: VisionOcrBlock[];
	structuredJson: Record<string, unknown> | null;
	maxChars?: number;
}): { snippet: string | null; source: string } {
	const maxChars = params.maxChars ?? 500;
	const blocks = Array.isArray(params.ocrBlocks) ? params.ocrBlocks : [];

	const usable = blocks
		.map((b) => {
			const text = typeof b?.text === "string" ? b.text.trim() : "";
			const conf = typeof b?.confidence === "number" && Number.isFinite(b.confidence) ? b.confidence : 0.4;
			const y = typeof b?.bbox?.y === "number" && Number.isFinite(b.bbox.y) ? b.bbox.y : null;
			const x = typeof b?.bbox?.x === "number" && Number.isFinite(b.bbox.x) ? b.bbox.x : null;
			return { text, conf, y, x };
		})
		.filter((b) => b.text.length >= 2)
		// Confidence filter: keep higher-signal words.
		.filter((b) => b.conf >= 0.55)
		// Avoid tiny header/footer noise; keep the body region.
		.filter((b) => b.y == null || (b.y >= 0.06 && b.y <= 0.92))
		.sort((a, b) => {
			const dy = (a.y ?? 0) - (b.y ?? 0);
			if (Math.abs(dy) > 0.01) return dy;
			return (a.x ?? 0) - (b.x ?? 0);
		});

	if (usable.length > 0) {
		// Group into rough lines by y proximity.
		const lines: Array<{ y: number; confs: number[]; parts: string[] }> = [];
		for (const b of usable) {
			const y = b.y ?? 0;
			const last = lines[lines.length - 1];
			if (!last || Math.abs(last.y - y) > 0.018) {
				lines.push({ y, confs: [b.conf], parts: [b.text] });
				continue;
			}
			last.confs.push(b.conf);
			last.parts.push(b.text);
		}

		const candidateLines = lines
			.map((l) => {
				const text = cleanSnippetText(l.parts.join(" "));
				const avg = l.confs.reduce((a, c) => a + c, 0) / Math.max(1, l.confs.length);
				return { y: l.y, avg, text };
			})
			.filter((l) => l.text.length >= 6)
			.filter((l) => !looksLikeJunkLine(l.text));

		if (candidateLines.length > 0) {
			// Prefer early body lines while skipping the very top-most line if it's short (often a brand/header).
			const picked: string[] = [];
			for (const l of candidateLines) {
				if (picked.length === 0 && l.y <= 0.12 && l.text.length <= 28) continue;
				picked.push(l.text);
				if (picked.join(" ").length >= maxChars) break;
				if (picked.length >= 6) break;
			}
			const joined = cleanSnippetText(picked.join(" "));
			if (joined) return { snippet: joined.length > maxChars ? `${joined.slice(0, maxChars - 3)}...` : joined, source: "ocr_blocks_filtered_v2" };
		}
	}

	// Fallbacks
	const sj = params.structuredJson && typeof params.structuredJson === "object" ? params.structuredJson : null;
	const structuredTitle = sj && typeof (sj as any).title === "string" ? String((sj as any).title).trim() : "";
	if (structuredTitle) {
		const s = structuredTitle.length > maxChars ? `${structuredTitle.slice(0, maxChars - 3)}...` : structuredTitle;
		return { snippet: s, source: "structured_title_fallback" };
	}

	const raw = typeof params.ocrText === "string" ? params.ocrText.trim() : "";
	if (raw) {
		const s = raw.length > maxChars ? `${raw.slice(0, maxChars - 3)}...` : raw;
		return { snippet: s, source: "ocr_text_truncate_fallback" };
	}

	return { snippet: null, source: "none" };
}

type UpsertVisualAssetInput = {
	documentId: string;
	pageIndex: number;
	assetType: VisionAsset["asset_type"];
	bbox: VisionBBox;
	imageUri: string | null;
	imageHash: string | null;
	extractorVersion: string;
	confidence: number;
	qualityFlags: Record<string, unknown>;
};

export async function upsertVisualAsset(pool: Pool, input: UpsertVisualAssetInput): Promise<string> {
	const baseParams = [
		sanitizeText(input.documentId),
		input.pageIndex,
		sanitizeText(input.assetType),
		JSON.stringify(sanitizeDeep(input.bbox)),
		input.imageUri,
		input.imageHash,
		sanitizeText(input.extractorVersion),
		input.confidence,
		JSON.stringify(sanitizeDeep(input.qualityFlags ?? {})),
	];

	if (input.imageHash) {
		const { rows } = await pool.query<{ id: string }>(
			`INSERT INTO visual_assets (
			   document_id, page_index, asset_type, bbox, image_uri, image_hash, extractor_version, confidence, quality_flags
			 ) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9::jsonb)
			 ON CONFLICT (document_id, page_index, extractor_version, image_hash)
			 DO UPDATE SET
			   asset_type = EXCLUDED.asset_type,
			   bbox = EXCLUDED.bbox,
			   image_uri = COALESCE(NULLIF(visual_assets.image_uri,''), EXCLUDED.image_uri),
			   confidence = GREATEST(visual_assets.confidence, EXCLUDED.confidence),
			   quality_flags = visual_assets.quality_flags || EXCLUDED.quality_flags
			 RETURNING id`,
			baseParams
		);
		return rows[0].id;
	}

	const { rows } = await pool.query<{ id: string }>(
		`INSERT INTO visual_assets (
		   document_id, page_index, asset_type, bbox, image_uri, image_hash, extractor_version, confidence, quality_flags
		 ) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9::jsonb)
		 ON CONFLICT (document_id, page_index, extractor_version) WHERE image_hash IS NULL
		 DO UPDATE SET
		   asset_type = EXCLUDED.asset_type,
		   bbox = EXCLUDED.bbox,
		   image_uri = COALESCE(NULLIF(visual_assets.image_uri,''), EXCLUDED.image_uri),
		   confidence = GREATEST(visual_assets.confidence, EXCLUDED.confidence),
		   quality_flags = visual_assets.quality_flags || EXCLUDED.quality_flags
		 RETURNING id`,
		baseParams
	);
	return rows[0].id;
}

type UpsertVisualExtractionInput = {
	visualAssetId: string;
	extractorVersion: string;
	ocrText: string | null;
	ocrBlocks: VisionOcrBlock[];
	structuredJson: Record<string, unknown>;
	units: string | null;
	labels: Record<string, unknown>;
	modelVersion: string | null;
	confidence: number;
};

export async function upsertVisualExtraction(pool: Pool, input: UpsertVisualExtractionInput): Promise<void> {
	await pool.query(
		`INSERT INTO visual_extractions (
		   visual_asset_id, ocr_text, ocr_blocks, structured_json, units, labels,
		   extractor_version, model_version, confidence
		 ) VALUES ($1,$2,$3::jsonb,$4::jsonb,$5,$6::jsonb,$7,$8,$9)
		 ON CONFLICT (visual_asset_id, extractor_version)
		 DO UPDATE SET
		   ocr_text = COALESCE(EXCLUDED.ocr_text, visual_extractions.ocr_text),
		   ocr_blocks = CASE
		     WHEN jsonb_typeof(EXCLUDED.ocr_blocks) = 'array' AND jsonb_array_length(EXCLUDED.ocr_blocks) > 0 THEN EXCLUDED.ocr_blocks
		     ELSE visual_extractions.ocr_blocks
		   END,
		   structured_json = visual_extractions.structured_json || EXCLUDED.structured_json,
		   units = COALESCE(EXCLUDED.units, visual_extractions.units),
		   labels = visual_extractions.labels || EXCLUDED.labels,
		   model_version = COALESCE(EXCLUDED.model_version, visual_extractions.model_version),
		   confidence = GREATEST(visual_extractions.confidence, EXCLUDED.confidence)
		`,
		[
			sanitizeText(input.visualAssetId),
			input.ocrText,
			JSON.stringify(sanitizeDeep(Array.isArray(input.ocrBlocks) ? input.ocrBlocks : [])),
			JSON.stringify(
				sanitizeDeep(
					input.structuredJson && typeof input.structuredJson === "object" && !Array.isArray(input.structuredJson)
						? input.structuredJson
						: {}
				)
			),
			input.units,
			JSON.stringify(
				sanitizeDeep(input.labels && typeof input.labels === "object" && !Array.isArray(input.labels) ? input.labels : {})
			),
			sanitizeText(input.extractorVersion),
			input.modelVersion,
			input.confidence,
		]
	);
}

export async function insertEvidenceLinkIfMissing(pool: Pool, input: {
	documentId: string;
	pageIndex: number | null;
	evidenceType: string;
	visualAssetId: string | null;
	ref: Record<string, unknown>;
	snippet: string | null;
	confidence: number;
}) {
	// IMPORTANT: evidence snippets are scoring-critical. When we re-extract visuals with improved OCR/preprocessing,
	// we must be able to refresh the persisted snippet/ref instead of permanently keeping the first (possibly-garbled)
	// OCR output.
	//
	// The table does not reliably have a unique constraint across these columns, so we do an UPDATE-first pattern.
	const params = [
		sanitizeText(input.documentId),
		input.pageIndex,
		sanitizeText(input.evidenceType),
		input.visualAssetId ? sanitizeText(input.visualAssetId) : null,
		JSON.stringify(sanitizeDeep(input.ref ?? {})),
		input.snippet,
		input.confidence,
	];

	const updateRes = await pool.query(
		`UPDATE evidence_links
		   SET ref = $5::jsonb,
		       snippet = $6,
		       confidence = $7
		 WHERE document_id = $1
		   AND page_index IS NOT DISTINCT FROM $2
		   AND evidence_type = $3
		   AND visual_asset_id IS NOT DISTINCT FROM $4`,
		params
	);
	const updated = typeof (updateRes as any)?.rowCount === "number" ? (updateRes as any).rowCount : 0;
	if (updated > 0) return;

	await pool.query(
		`INSERT INTO evidence_links (document_id, page_index, evidence_type, visual_asset_id, ref, snippet, confidence)
		 VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
		params
	);
}

export async function persistVisionResponse(
	pool: Pool,
	response: VisionExtractResponse,
	options?: { pageImageUri?: string | null; env?: NodeJS.ProcessEnv }
): Promise<{ persisted: number; withImageUri: number }> {
	let persisted = 0;
	let withImageUri = 0;
	const env = options?.env ?? process.env;
	const pageImageUri = options?.pageImageUri ?? null;
	const pageImageUriNormalized = normalizeImageUriForDb(pageImageUri, env);

	const docKind = await (async () => {
		try {
			const res = await pool.query(
				`SELECT type, extraction_metadata
				   FROM documents
				  WHERE id = $1
				  LIMIT 1`,
				[sanitizeText(response.document_id)]
			);
			const row = res.rows?.[0] as any;
			return deduceDocKind({ type: row?.type ?? null, extraction_metadata: row?.extraction_metadata ?? null });
		} catch {
			return "unknown";
		}
	})();

	const excelVisionEnabled = (() => {
		const raw = env.ENABLE_EXCEL_VISION_EXTRACTION;
		if (raw == null) return false;
		return ["1", "true", "yes", "on"].includes(String(raw).trim().toLowerCase());
	})();

	const persistExcelImageText = (() => {
		const raw = env.PERSIST_EXCEL_IMAGE_TEXT;
		if (raw == null) return false;
		return ["1", "true", "yes", "on"].includes(String(raw).trim().toLowerCase());
	})();

	// Optional: enrich segment assignment from per-page understanding (PDF-only).
	let pageUnderstanding: any | null = null;
	try {
		const res = await pool.query(
			"SELECT payload FROM document_page_understanding WHERE document_id = $1 AND page_index = $2 AND version = 'page_understanding_v1' LIMIT 1",
			[sanitizeText(response.document_id), response.page_index]
		);
		pageUnderstanding = (res as any)?.rows?.[0]?.payload ?? null;
	} catch {
		pageUnderstanding = null;
	}
	const pageUnderstandingTitle =
		pageUnderstanding && typeof pageUnderstanding === "object" && typeof (pageUnderstanding as any).resolved_title === "string"
			? String((pageUnderstanding as any).resolved_title)
			: "";
	const pageUnderstandingSlideType =
		pageUnderstanding && typeof pageUnderstanding === "object" && typeof (pageUnderstanding as any).resolved_slide_type === "string"
			? String((pageUnderstanding as any).resolved_slide_type)
			: "";
	const pageUnderstandingSeg = mapSlideTypeToSegmentKey(pageUnderstandingSlideType);

	for (const asset of response.assets ?? []) {
		const normalizedAssetImageUri = normalizeImageUriForDb(asset.image_uri ?? null, env) ?? pageImageUriNormalized;
		const assetBBox = coerceBBox((asset as any)?.bbox);
		const assetQualityFlags = coerceJsonObject((asset as any)?.quality_flags) ?? {};
		const extractionObj = (asset as any)?.extraction;
		const ocrTextFromAsset = typeof extractionObj?.ocr_text === "string" ? extractionObj.ocr_text : null;
		const ocrBlocksFromAsset = coerceJsonArray<VisionOcrBlock>(extractionObj?.ocr_blocks);
		// Fallback: some OCR endpoints may return page-level OCR fields instead of per-asset extraction.
		// Supported shapes:
		// - response.ocr_text / response.ocr_blocks
		// - response.ocr.text / response.ocr.blocks
		const ocrObj = (response as any)?.ocr;
		const ocrTextFromResponseTop = typeof (response as any)?.ocr_text === "string" ? String((response as any).ocr_text) : null;
		const ocrBlocksFromResponseTop = coerceJsonArray<VisionOcrBlock>((response as any)?.ocr_blocks);
		const ocrTextFromResponseNested = typeof ocrObj?.text === "string" ? String(ocrObj.text) : null;
		const ocrBlocksFromResponseNested = coerceJsonArray<VisionOcrBlock>(ocrObj?.blocks);
		const ocrTextFromResponse = ocrTextFromResponseTop ?? ocrTextFromResponseNested;
		const ocrBlocksFromResponse =
			(ocrBlocksFromResponseTop && ocrBlocksFromResponseTop.length > 0)
				? ocrBlocksFromResponseTop
				: ocrBlocksFromResponseNested;
		const ocrText = ocrTextFromAsset ?? ocrTextFromResponse;
		const ocrBlocks = (ocrBlocksFromAsset && ocrBlocksFromAsset.length > 0) ? ocrBlocksFromAsset : ocrBlocksFromResponse;
		const structuredJson = coerceJsonObject(extractionObj?.structured_json);
		const labels = coerceJsonObject(extractionObj?.labels);
		const extractionConfidence =
			typeof extractionObj?.confidence === "number" && Number.isFinite(extractionObj.confidence)
				? extractionObj.confidence
				: typeof (asset as any)?.confidence === "number" && Number.isFinite((asset as any).confidence)
					? (asset as any).confidence
					: 0;
		const titleFromLabels = typeof (labels as any)?.title === "string" ? String((labels as any).title) : "";
		const titleFromStructured = typeof (structuredJson as any)?.title === "string" ? String((structuredJson as any).title) : "";
		const vuObj = (structuredJson as any)?.vision_understanding_v1;
		const titleFromVision = typeof vuObj?.title === "string" ? String(vuObj.title) : "";
		const visionConfidence =
			typeof vuObj?.confidence === "number" && Number.isFinite(vuObj.confidence) ? vuObj.confidence : null;
		const hasAnyTextSignal = Boolean(
			titleFromLabels.trim() ||
			titleFromStructured.trim() ||
			titleFromVision.trim() ||
			pageUnderstandingTitle.trim() ||
			(ocrText && ocrText.trim())
		);

		// Persist a stable segment assignment for vision assets (PDF/images).
		// Resolution order: quality_flags.segment_key -> structured_json.segment_key -> infer from OCR/labels.
		const existingFromQuality = coerceSegmentKey((assetQualityFlags as any)?.segment_key);
		const existingFromStructured = coerceSegmentKey((structuredJson as any)?.segment_key);
		let segmentKey: SegmentKey | null = existingFromQuality ?? existingFromStructured;
		let segmentWasInferred = false;
		let segmentSourceHint: string | null = null;
		let unknownReasonCode: string | null = null;
		if (!segmentKey) {
			const combined = [
				titleFromLabels,
				titleFromStructured,
				titleFromVision,
				pageUnderstandingTitle,
				pageUnderstandingSlideType,
				ocrText,
			]
				.filter(Boolean)
				.join("\n");
			segmentKey = classifySegmentKeyFromText(combined, "unknown");
			segmentWasInferred = true;
			if (segmentKey === "unknown") {
				unknownReasonCode = combined.trim().length === 0 ? "NO_TEXT" : "LOW_SIGNAL";
			}
		} else if (segmentKey === "unknown") {
			unknownReasonCode = hasAnyTextSignal ? "LOW_SIGNAL" : "NO_TEXT";
		}

		// Prefer deterministic segmenting from page_understanding_v1 when present.
		if ((!segmentKey || segmentKey === "unknown") && pageUnderstandingSeg && !existingFromQuality) {
			segmentKey = pageUnderstandingSeg;
			segmentWasInferred = true;
			segmentSourceHint = "page_understanding_v1";
			unknownReasonCode = null;
		}

		// For XLSX-derived page images, treat the segment assignment as a structured pipeline output.
		// This lets the API treat segment_key as persisted/promoted (instead of "hint-only") and avoids "unknown" grouping.
		const isExcelDoc = docKind === "excel";
		if (isExcelDoc && (typeof (assetQualityFlags as any)?.source !== "string" || !String((assetQualityFlags as any).source).startsWith("structured_"))) {
			(assetQualityFlags as any).source = "structured_excel_render_v1";
			(assetQualityFlags as any).original_source = response.extractor_version;
		}


		// Excel: OCR/vision on rendered sheet images is disabled by default.
		// We only persist structured (cell-based) assets unless ENABLE_EXCEL_VISION_EXTRACTION is explicitly turned on.
		if (isExcelDoc && asset.asset_type === "image_text" && !excelVisionEnabled && !persistExcelImageText) {
			continue;
		}

		// Skip persisting empty page-image artifacts for Excel documents even when vision is enabled.
		// These frequently have no OCR/title signal, become segment_key=unknown, and add noise to the graph.
		if (
			isExcelDoc &&
			excelVisionEnabled &&
			asset.asset_type === "image_text" &&
			!hasAnyTextSignal &&
			(!segmentKey || segmentKey === "unknown")
		) {
			continue;
		}

		const qualityFlagsWithSeg: any = { ...(assetQualityFlags ?? {}) };
		if (typeof qualityFlagsWithSeg.source !== "string" || !qualityFlagsWithSeg.source.trim()) {
			qualityFlagsWithSeg.source = response.extractor_version;
		}
		if (segmentKey && !existingFromQuality) {
			qualityFlagsWithSeg.segment_key = segmentKey;
			if (segmentSourceHint && (typeof qualityFlagsWithSeg.segment_source !== "string" || !qualityFlagsWithSeg.segment_source.trim())) {
				qualityFlagsWithSeg.segment_source = segmentSourceHint;
			} else if (segmentWasInferred && (typeof qualityFlagsWithSeg.segment_source !== "string" || !qualityFlagsWithSeg.segment_source.trim())) {
				qualityFlagsWithSeg.segment_source = "inferred_ocr_v1";
			}
		}
		if (segmentKey === "unknown" && unknownReasonCode && (typeof qualityFlagsWithSeg.unknown_reason_code !== "string" || !qualityFlagsWithSeg.unknown_reason_code.trim())) {
			qualityFlagsWithSeg.unknown_reason_code = unknownReasonCode;
		}

		// Persist an explicit acceptance marker so the pipeline can safely skip re-processing the same page.
		// Acceptance is conservative: segment must be non-unknown and we need a title/text signal with reasonable confidence.
		const segmentSource = typeof qualityFlagsWithSeg.segment_source === "string" ? String(qualityFlagsWithSeg.segment_source) : "";
		const isHumanOverride = segmentSource === "human_override" || segmentSource === "human_override_v1" || segmentSource.startsWith("human_override_");
		const isPromoted = segmentSource.startsWith("promoted");
		const titleCandidate = (titleFromLabels || titleFromStructured || titleFromVision).trim();
		const ocrLen = typeof ocrText === "string" ? ocrText.trim().length : 0;
		const hasTitle = titleCandidate.length >= 4;
		const hasOcrText = ocrLen >= 30;
		const okByVision = hasTitle && (visionConfidence == null ? false : visionConfidence >= 0.55);
		const okByOcr = hasOcrText && extractionConfidence >= 0.30;
		const okByStructuredTitle = hasTitle && extractionConfidence >= 0.50;
		const acceptedV1 = Boolean(
			segmentKey &&
			segmentKey !== "unknown" &&
			(isHumanOverride || isPromoted || okByVision || okByOcr || okByStructuredTitle)
		);
		if (typeof qualityFlagsWithSeg.accepted_v1 !== "boolean") {
			qualityFlagsWithSeg.accepted_v1 = acceptedV1;
			qualityFlagsWithSeg.accepted_reason_v1 = isHumanOverride
				? "human_override"
				: isPromoted
					? "promoted"
					: okByVision
						? "vision_understanding"
						: okByOcr
							? "ocr_text"
							: okByStructuredTitle
								? "structured_title"
								: "not_accepted";
		}
		const structuredJsonWithSeg = segmentKey && !existingFromStructured
			? { ...structuredJson, segment_key: segmentKey }
			: structuredJson;

		const visualAssetId = await upsertVisualAsset(pool, {
			documentId: response.document_id,
			pageIndex: response.page_index,
			assetType: asset.asset_type,
			bbox: assetBBox,
			imageUri: normalizedAssetImageUri,
			imageHash: asset.image_hash ?? null,
			extractorVersion: response.extractor_version,
			confidence: asset.confidence ?? 0,
			qualityFlags: qualityFlagsWithSeg,
		});

		if (normalizedAssetImageUri) withImageUri += 1;

		await upsertVisualExtraction(pool, {
			visualAssetId,
			extractorVersion: response.extractor_version,
			ocrText: ocrText,
			ocrBlocks: ocrBlocks,
			structuredJson: structuredJsonWithSeg,
			units: asset.extraction?.units ?? null,
			labels: labels,
			modelVersion: asset.extraction?.model_version ?? null,
			confidence: asset.extraction?.confidence ?? asset.confidence ?? 0,
		});

		const { snippet, source: snippetSource } = deriveEvidenceSnippetV2({
			ocrText: ocrText,
			ocrBlocks,
			structuredJson: structuredJsonWithSeg as any,
			maxChars: 500,
		});

		await insertEvidenceLinkIfMissing(pool, {
			documentId: response.document_id,
			pageIndex: response.page_index,
			evidenceType: "visual_asset",
			visualAssetId,
			ref: {
				asset_type: asset.asset_type,
				bbox: assetBBox,
				image_uri: normalizedAssetImageUri,
				page_image_uri: pageImageUriNormalized,
				image_hash: asset.image_hash ?? null,
				extractor_version: response.extractor_version,
				snippet_source: snippetSource,
			},
			snippet,
			confidence: asset.confidence ?? 0,
		});

		persisted += 1;
	}

	return { persisted, withImageUri };
}

export function deduceDocKind(meta: { extraction_metadata?: any; type?: string | null }): string {
	const fromMeta = meta.extraction_metadata && typeof meta.extraction_metadata === "object"
		? ((meta.extraction_metadata as any).doc_kind ?? (meta.extraction_metadata as any).contentType ?? null)
		: null;
	const kindRaw = (fromMeta || meta.type || "").toString().toLowerCase();
	if (kindRaw.includes("excel") || kindRaw.endsWith("xlsx") || kindRaw === "xls") return "excel";
	if (kindRaw.includes("powerpoint") || kindRaw.includes("ppt")) return "powerpoint";
	if (kindRaw.includes("word") || kindRaw.includes("doc")) return "word";
	if (kindRaw.includes("image")) return "image";
	return kindRaw || "unknown";
}


function coerceNumberOrNull(v: unknown): number | null {
	if (typeof v !== "number") return null;
	if (!Number.isFinite(v)) return null;
	return v;
}

function coerceIntOrNull(v: unknown): number | null {
	const n = coerceNumberOrNull(v);
	if (n == null) return null;
	return Math.max(0, Math.floor(n));
}

function coerceBoolOrNull(v: unknown): boolean | null {
	if (typeof v === "boolean") return v;
	return null;
}

function readNeedsOcrFromExtractionMetadata(extractionMetadata: unknown): boolean | null {
	const m = extractionMetadata && typeof extractionMetadata === "object" ? (extractionMetadata as any) : null;
	// Prefer the canonical persisted field.
	const direct = coerceBoolOrNull(m?.needsOcr);
	if (direct != null) return direct;
	// Older/alternate shapes.
	const probe = coerceBoolOrNull(m?.pdf_text_probe?.needsOcr);
	if (probe != null) return probe;
	const probe2 = coerceBoolOrNull(m?.textProbe?.needsOcr);
	if (probe2 != null) return probe2;
	return null;
}

function readPageOcrAttemptedFromExtractionMetadata(extractionMetadata: unknown): boolean | null {
	const m = extractionMetadata && typeof extractionMetadata === "object" ? (extractionMetadata as any) : null;
	const attempted = coerceBoolOrNull(m?.pageOcr?.attempted);
	if (attempted != null) return attempted;
	// Fallback: if we ever persist a different summary key, tolerate it.
	return coerceBoolOrNull(m?.page_ocr_attempted);
}

/**
 * Computes whether vision-worker fallback is allowed for this document.
 * Policy:
 * - Office docs (excel/powerpoint/word): NEVER
 * - Editable PDFs: NEVER
 * - Image-only PDFs: ONLY if local OCR was attempted and full_text remains below threshold
 * - Images: allowed
 */
export function computeVisionRoutingDecisionV1(params: {
	doc_kind: string;
	extraction_metadata: unknown;
	full_text_len: number;
	min_text_threshold_chars: number;
	force_ocr?: boolean;
	page_coverage?: { pages_with_text: number | null; total_pages: number | null; coverage: number | null };
	completeness_score?: number | null;
	summary_length?: number | null;
}): VisionRoutingDecisionV1 {
	const docKind = String(params.doc_kind || "unknown").trim().toLowerCase();
	const minTextThresholdChars = Number.isFinite(params.min_text_threshold_chars)
		? Math.max(0, Math.floor(params.min_text_threshold_chars))
		: 800;
	const fullTextLen = Number.isFinite(params.full_text_len) ? Math.max(0, Math.floor(params.full_text_len)) : 0;

	const metaObj = params.extraction_metadata && typeof params.extraction_metadata === "object" ? (params.extraction_metadata as any) : null;
	const completenessScore = params.completeness_score ?? coerceNumberOrNull(metaObj?.completeness?.score);
	const summaryLength = params.summary_length ?? coerceIntOrNull(metaObj?.summaryLength);

	const pagesWithTextFromMeta = (() => {
		const probe = metaObj?.pdf_text_probe && typeof metaObj.pdf_text_probe === "object" ? metaObj.pdf_text_probe : null;
		const probe2 = metaObj?.textProbe && typeof metaObj.textProbe === "object" ? metaObj.textProbe : null;
		return coerceIntOrNull(probe?.pages_with_text ?? probe2?.pages_with_text);
	})();
	const totalPagesFromMeta = coerceIntOrNull(metaObj?.totalPages ?? metaObj?.pagesProcessed ?? metaObj?.pages_probed);

	const pagesWithText = params.page_coverage?.pages_with_text ?? pagesWithTextFromMeta;
	const totalPages = params.page_coverage?.total_pages ?? totalPagesFromMeta;
	const coverage = params.page_coverage?.coverage ?? (totalPages && totalPages > 0 && pagesWithText != null ? pagesWithText / totalPages : null);
	const weakCoverageOrLowContent =
		(coverage != null && coverage < 0.7) ||
		(completenessScore != null && completenessScore < 0.8) ||
		(summaryLength != null && summaryLength < 50);

	const isOffice = docKind === "excel" || docKind === "powerpoint" || docKind === "word";
	const isPdf = docKind === "pdf";
	const isImage = docKind === "image";
	const forceOcr = Boolean(params.force_ocr);

	const needsOcr = readNeedsOcrFromExtractionMetadata(params.extraction_metadata);
	const pageOcrAttempted = readPageOcrAttemptedFromExtractionMetadata(params.extraction_metadata);

	let visionFallbackAllowed = false;
	let reason = "unknown_disallowed";
	if (isOffice) {
		visionFallbackAllowed = false;
		reason = "office_disallowed";
	} else if (isImage) {
		visionFallbackAllowed = true;
		reason = "image_allowed";
	} else if (isPdf) {
		// IMPORTANT: OCR gating and visual extraction are different concerns.
		// For normal pitch-deck sized PDFs, we always allow vision fallback so we can
		// run `extract_visuals` and populate page understanding/key metrics, even if
		// native PDF text is "ok".
		const isPitchDeckSized = typeof totalPages === "number" && Number.isFinite(totalPages) && totalPages > 0 && totalPages <= 80;

		if (forceOcr) {
			visionFallbackAllowed = true;
			reason = "force_ocr";
		} else if (weakCoverageOrLowContent) {
			visionFallbackAllowed = true;
			reason = "pdf_weak_coverage_or_low_content";
		} else if (isPitchDeckSized) {
			visionFallbackAllowed = true;
			reason = "pdf_pitch_deck_allow_extract_visuals";
		} else if (needsOcr !== true) {
			visionFallbackAllowed = false;
			reason = "pdf_text_ok";
		} else if (pageOcrAttempted !== true) {
			visionFallbackAllowed = false;
			reason = "pdf_ocr_not_attempted";
		} else if (fullTextLen >= minTextThresholdChars) {
			visionFallbackAllowed = false;
			reason = "pdf_text_above_threshold_after_ocr";
		} else {
			visionFallbackAllowed = true;
			reason = "pdf_image_only_low_text_after_ocr";
		}
	} else {
		visionFallbackAllowed = false;
		reason = "unsupported_kind_disallowed";
	}

	return {
		vision_fallback_allowed: visionFallbackAllowed,
		reason,
		inputs: {
			force_ocr: forceOcr,
			needs_ocr: needsOcr,
			page_ocr_attempted: pageOcrAttempted,
			full_text_len: fullTextLen,
			pages_with_text: pagesWithText,
			total_pages: totalPages,
			coverage,
			completeness_score: completenessScore,
			summary_length: summaryLength,
			min_text_threshold_chars: minTextThresholdChars,
		},
	};
}

