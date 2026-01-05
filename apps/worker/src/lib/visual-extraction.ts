import { sanitizeDeep, sanitizeText } from "@dealdecision/core";
import type { Pool } from "pg";
import path from "path";
import fs from "fs/promises";

export type VisionExtractorConfig = {
	enabled: boolean;
	visionWorkerUrl: string;
	extractorVersion: string;
	timeoutMs: number;
	maxPages: number;
};

type LogLike = Pick<Console, "log" | "warn" | "error">;

type FsLike = Pick<typeof fs, "readdir" | "stat">;

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

function safeDocIdForPath(documentId: string): string {
	return String(documentId || "").replace(/[^a-zA-Z0-9_\-]/g, "_");
}

async function dirExists(fsImpl: FsLike, dir: string): Promise<boolean> {
	try {
		const s = await fsImpl.stat(dir);
		return s.isDirectory();
	} catch {
		return false;
	}
}

function candidateArtifactDirs(params: {
	documentId: string;
	meta?: unknown;
	env?: NodeJS.ProcessEnv;
}): string[] {
	const env = params.env ?? process.env;
	const safeId = safeDocIdForPath(params.documentId);
	const uploadDir = env.UPLOAD_DIR ? path.resolve(env.UPLOAD_DIR) : path.resolve(process.cwd(), "uploads");

	const dirs: string[] = [];
	const metaObj = params.meta && typeof params.meta === "object" ? (params.meta as any) : null;
	for (const key of ["debug_dir", "debugDir", "artifacts_dir", "artifactsDir", "rendered_pages_dir", "renderedPagesDir"]) {
		const v = metaObj?.[key];
		if (typeof v === "string" && v.trim()) dirs.push(v.trim());
	}

	// Known extractor debug location (only exists if PDF_EXTRACT_DEBUG=1 at extraction time)
	dirs.push(path.join("/tmp/pdf_extract_debug", safeId));

	// Common “uploads/artifacts” patterns (best-effort; may not exist)
	dirs.push(path.join(uploadDir, "rendered_pages", safeId));
	dirs.push(path.join(uploadDir, "page_images", safeId));
	dirs.push(path.join(uploadDir, "extracted_images", safeId));
	dirs.push(path.join(uploadDir, "artifacts", safeId, "pages"));
	dirs.push(path.join(uploadDir, "artifacts", safeId));
	dirs.push(path.join(uploadDir, safeId, "pages"));
	dirs.push(path.join(uploadDir, safeId));

	// Dedupe while preserving order
	return Array.from(new Set(dirs));
}

function parsePageIndexFromFilename(fileName: string): number | null {
	const name = fileName.toLowerCase();
	if (!(name.endsWith(".png") || name.endsWith(".jpg") || name.endsWith(".jpeg"))) return null;

	// Examples: page_001_raw.png, page-12.png, page12.jpg
	const m = name.match(/page[_\-]?0*(\d{1,6})/);
	if (!m) return null;
	const n = Number.parseInt(m[1], 10);
	return Number.isFinite(n) ? n : null;
}

function pickBestPerPage(candidates: string[]): string {
	// Prefer “raw” over “pre” over anything else.
	const rank = (p: string) => {
		const n = p.toLowerCase();
		if (n.includes("_raw")) return 3;
		if (n.includes("_pre")) return 2;
		return 1;
	};
	return candidates.sort((a, b) => rank(b) - rank(a))[0];
}

export async function resolvePageImageUris(
	pool: Pool,
	documentId: string,
	options?: {
		logger?: LogLike;
		fsImpl?: FsLike;
		env?: NodeJS.ProcessEnv;
	}
): Promise<string[]> {
	const logger = options?.logger ?? console;
	const fsImpl = options?.fsImpl ?? fs;

	try {
		const { rows } = await pool.query<{ page_count: number | null; extraction_metadata: unknown | null }>(
			`SELECT page_count, extraction_metadata
			   FROM documents
			  WHERE id = $1
			  LIMIT 1`,
			[sanitizeText(documentId)]
		);
		const row = rows?.[0];
		const pageCount = typeof row?.page_count === "number" && Number.isFinite(row.page_count) ? row.page_count : 0;
		if (!pageCount || pageCount <= 0) {
			logger.log(
				JSON.stringify({ event: "NO_PAGE_IMAGES_AVAILABLE", document_id: documentId, reason: "page_count_missing" })
			);
			return [];
		}

		const dirs = candidateArtifactDirs({ documentId, meta: row?.extraction_metadata, env: options?.env });
		for (const dir of dirs) {
			if (!(await dirExists(fsImpl, dir))) continue;
			let files: string[] = [];
			try {
				files = await fsImpl.readdir(dir);
			} catch {
				continue;
			}

			const hasZero = files.some((f) => parsePageIndexFromFilename(f) === 0);
			const byIndex = new Map<number, string[]>();
			for (const f of files) {
				const parsed = parsePageIndexFromFilename(f);
				if (parsed === null) continue;
				const pageIndex = hasZero ? parsed : parsed - 1;
				if (pageIndex < 0 || pageIndex >= pageCount) continue;
				const full = path.join(dir, f);
				const list = byIndex.get(pageIndex) ?? [];
				list.push(full);
				byIndex.set(pageIndex, list);
			}

			const ordered: string[] = [];
			for (let i = 0; i < pageCount; i += 1) {
				const cands = byIndex.get(i);
				if (!cands || cands.length === 0) continue;
				ordered.push(pickBestPerPage(cands));
			}

			if (ordered.length > 0) {
				return ordered;
			}
		}

		logger.log(
			JSON.stringify({
				event: "NO_PAGE_IMAGES_AVAILABLE",
				document_id: documentId,
				reason: "no_matching_files",
				searched_dirs: dirs,
				page_count: pageCount,
			})
		);
		return [];
	} catch (err) {
		logger.warn(
			`[visual_extraction] resolvePageImageUris failed doc=${documentId}: ${
				err instanceof Error ? err.message : String(err)
			}`
		);
		return [];
	}
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

export async function enqueueExtractVisualsIfPossible(params: {
	pool: Pool;
	queue: { add: (name: string, data: any, opts?: any) => Promise<unknown> };
	config: VisionExtractorConfig;
	documentId: string;
	dealId: string;
	logger?: LogLike;
	resolveOptions?: { fsImpl?: FsLike; env?: NodeJS.ProcessEnv };
}): Promise<boolean> {
	const logger = params.logger ?? console;
	if (!params.config.enabled) return false;

	const imageUris = await resolvePageImageUris(params.pool, params.documentId, {
		logger,
		fsImpl: params.resolveOptions?.fsImpl,
		env: params.resolveOptions?.env,
	});
	if (imageUris.length === 0) return false;

	await params.queue.add(
		"extract_visuals",
		{
			document_id: params.documentId,
			deal_id: params.dealId,
			extractor_version: params.config.extractorVersion,
			image_uris: imageUris,
		},
		{ removeOnComplete: true, removeOnFail: false, delay: 750 }
	);
	logger.log(
		JSON.stringify({
			event: "extract_visuals_enqueued",
			document_id: params.documentId,
			pages: imageUris.length,
		})
	);
	return true;
}
