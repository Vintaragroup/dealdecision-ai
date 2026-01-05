import { sanitizeDeep, sanitizeText } from "@dealdecision/core";
import type { Pool } from "pg";

export type VisionExtractorConfig = {
	enabled: boolean;
	visionWorkerUrl: string;
	extractorVersion: string;
	timeoutMs: number;
	maxPages: number;
};

export type VisionExtractRequest = {
	document_id: string;
	page_index: number;
	image_uri: string;
	extractor_version: string;
};

export type VisionBBox = { x: number; y: number; w: number; h: number };

export type VisionOcrBlock = {
	text: string;
	bbox: VisionBBox;
	confidence?: number | null;
};

export type VisionExtraction = {
	ocr_text?: string | null;
	ocr_blocks: VisionOcrBlock[];
	structured_json: Record<string, unknown>;
	units?: string | null;
	labels: Record<string, unknown>;
	model_version?: string | null;
	confidence: number;
};

export type VisionAsset = {
	asset_type: "chart" | "table" | "map" | "diagram" | "image_text" | "unknown";
	bbox: VisionBBox;
	confidence: number;
	quality_flags: Record<string, unknown>;
	image_uri?: string | null;
	image_hash?: string | null;
	extraction: VisionExtraction;
};

export type VisionExtractResponse = {
	document_id: string;
	page_index: number;
	extractor_version: string;
	assets: VisionAsset[];
};

function parseBool(input: string | undefined | null): boolean {
	if (!input) return false;
	return ["1", "true", "yes", "on"].includes(input.trim().toLowerCase());
}

function parseIntWithDefault(input: string | undefined, fallback: number): number {
	const v = Number.parseInt(String(input ?? ""), 10);
	return Number.isFinite(v) ? v : fallback;
}

export function getVisionExtractorConfig(env: NodeJS.ProcessEnv = process.env): VisionExtractorConfig {
	return {
		enabled: parseBool(env.ENABLE_VISUAL_EXTRACTION),
		visionWorkerUrl: (env.VISION_WORKER_URL || "http://localhost:8000").replace(/\/$/, ""),
		extractorVersion: env.VISION_EXTRACTOR_VERSION || "vision_v1",
		timeoutMs: parseIntWithDefault(env.VISION_TIMEOUT_MS, 8000),
		maxPages: parseIntWithDefault(env.VISION_MAX_PAGES, 10),
	};
}

export async function hasTable(pool: Pool, table: string): Promise<boolean> {
	try {
		const { rows } = await pool.query<{ oid: string | null }>("SELECT to_regclass($1) as oid", [table]);
		return rows?.[0]?.oid !== null;
	} catch {
		return false;
	}
}

export async function callVisionWorker(
	config: VisionExtractorConfig,
	request: VisionExtractRequest,
	fetchImpl: typeof fetch = fetch
): Promise<VisionExtractResponse | null> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), config.timeoutMs);

	try {
		const res = await fetchImpl(`${config.visionWorkerUrl}/extract-visuals`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(request),
			signal: controller.signal,
		});

		if (!res.ok) {
			return null;
		}

		const json = (await res.json()) as VisionExtractResponse;
		if (!json || typeof json !== "object") return null;
		if (!Array.isArray((json as any).assets)) return null;
		return json;
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
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
		sanitizeDeep(input.bbox),
		input.imageUri,
		input.imageHash,
		sanitizeText(input.extractorVersion),
		input.confidence,
		sanitizeDeep(input.qualityFlags ?? {}),
	];

	if (input.imageHash) {
		const { rows } = await pool.query<{ id: string }>(
			`INSERT INTO visual_assets (
			   document_id, page_index, asset_type, bbox, image_uri, image_hash, extractor_version, confidence, quality_flags
			 ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
			 ON CONFLICT (document_id, page_index, extractor_version, image_hash)
			 DO UPDATE SET
			   asset_type = EXCLUDED.asset_type,
			   bbox = EXCLUDED.bbox,
			   image_uri = COALESCE(EXCLUDED.image_uri, visual_assets.image_uri),
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
		 ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
		 ON CONFLICT (document_id, page_index, extractor_version) WHERE image_hash IS NULL
		 DO UPDATE SET
		   asset_type = EXCLUDED.asset_type,
		   bbox = EXCLUDED.bbox,
		   image_uri = COALESCE(EXCLUDED.image_uri, visual_assets.image_uri),
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
		 ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
		 ON CONFLICT (visual_asset_id, extractor_version)
		 DO UPDATE SET
		   ocr_text = COALESCE(EXCLUDED.ocr_text, visual_extractions.ocr_text),
		   ocr_blocks = CASE
		     WHEN jsonb_array_length(EXCLUDED.ocr_blocks) > 0 THEN EXCLUDED.ocr_blocks
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
			sanitizeDeep(input.ocrBlocks ?? []),
			sanitizeDeep(input.structuredJson ?? {}),
			input.units,
			sanitizeDeep(input.labels ?? {}),
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
	await pool.query(
		`INSERT INTO evidence_links (document_id, page_index, evidence_type, visual_asset_id, ref, snippet, confidence)
		 SELECT $1, $2, $3, $4, $5, $6, $7
		 WHERE NOT EXISTS (
		   SELECT 1
		     FROM evidence_links
		    WHERE document_id = $1
		      AND page_index IS NOT DISTINCT FROM $2
		      AND evidence_type = $3
		      AND visual_asset_id IS NOT DISTINCT FROM $4
		 )`,
		[
			sanitizeText(input.documentId),
			input.pageIndex,
			sanitizeText(input.evidenceType),
			input.visualAssetId ? sanitizeText(input.visualAssetId) : null,
			sanitizeDeep(input.ref ?? {}),
			input.snippet,
			input.confidence,
		]
	);
}

export async function persistVisionResponse(pool: Pool, response: VisionExtractResponse): Promise<number> {
	let persisted = 0;

	for (const asset of response.assets ?? []) {
		const visualAssetId = await upsertVisualAsset(pool, {
			documentId: response.document_id,
			pageIndex: response.page_index,
			assetType: asset.asset_type,
			bbox: asset.bbox,
			imageUri: asset.image_uri ?? null,
			imageHash: asset.image_hash ?? null,
			extractorVersion: response.extractor_version,
			confidence: asset.confidence ?? 0,
			qualityFlags: asset.quality_flags ?? {},
		});

		await upsertVisualExtraction(pool, {
			visualAssetId,
			extractorVersion: response.extractor_version,
			ocrText: asset.extraction?.ocr_text ?? null,
			ocrBlocks: asset.extraction?.ocr_blocks ?? [],
			structuredJson: asset.extraction?.structured_json ?? {},
			units: asset.extraction?.units ?? null,
			labels: asset.extraction?.labels ?? {},
			modelVersion: asset.extraction?.model_version ?? null,
			confidence: asset.extraction?.confidence ?? asset.confidence ?? 0,
		});

		const snippetRaw = asset.extraction?.ocr_text ?? null;
		const snippet = snippetRaw && snippetRaw.length > 500 ? `${snippetRaw.slice(0, 497)}...` : snippetRaw;

		await insertEvidenceLinkIfMissing(pool, {
			documentId: response.document_id,
			pageIndex: response.page_index,
			evidenceType: "visual_asset",
			visualAssetId,
			ref: {
				asset_type: asset.asset_type,
				bbox: asset.bbox,
				image_uri: asset.image_uri ?? null,
				image_hash: asset.image_hash ?? null,
				extractor_version: response.extractor_version,
			},
			snippet,
			confidence: asset.confidence ?? 0,
		});

		persisted += 1;
	}

	return persisted;
}
