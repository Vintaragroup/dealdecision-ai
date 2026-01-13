import { sanitizeDeep, sanitizeText } from "@dealdecision/core";
import type { Pool } from "pg";
import path from "path";
import fs from "fs/promises";
import { createHash } from "crypto";

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

const SEGMENT_KEYS = [
	"overview",
	"problem",
	"solution",
	"product",
	"market",
	"traction",
	"business_model",
	"competition",
	"team",
	"distribution",
	"raise_terms",
	"exit",
	"risks",
	"financials",
	"unknown",
] as const;

type SegmentKey = (typeof SEGMENT_KEYS)[number];

function coerceSegmentKey(value: unknown): SegmentKey | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	if (!trimmed) return null;
	// @ts-expect-error - runtime includes check.
	return (SEGMENT_KEYS as readonly string[]).includes(trimmed) ? (trimmed as SegmentKey) : null;
}

function coerceJsonObject(value: unknown): Record<string, unknown> {
	if (!value) return {};
	if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
	if (typeof value === "string") {
		try {
			const parsed = JSON.parse(value);
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
		} catch {
			// ignore
		}
	}
	return {};
}

function coerceJsonArray<T = unknown>(value: unknown): T[] {
	if (Array.isArray(value)) return value as T[];
	if (typeof value === "string") {
		try {
			const parsed = JSON.parse(value);
			if (Array.isArray(parsed)) return parsed as T[];
		} catch {
			// ignore
		}
	}
	return [];
}

function coerceBBox(value: unknown): VisionBBox {
	const obj = coerceJsonObject(value);
	const x = typeof obj.x === "number" ? obj.x : Number(obj.x);
	const y = typeof obj.y === "number" ? obj.y : Number(obj.y);
	const w = typeof obj.w === "number" ? obj.w : Number(obj.w);
	const h = typeof obj.h === "number" ? obj.h : Number(obj.h);

	return {
		x: Number.isFinite(x) ? x : 0,
		y: Number.isFinite(y) ? y : 0,
		w: Number.isFinite(w) ? w : 1,
		h: Number.isFinite(h) ? h : 1,
	};
}

function normalizeImageUriForApi(imageUri: string | null, env: NodeJS.ProcessEnv = process.env): string | null {
	if (!imageUri) return null;
	const trimmed = String(imageUri).trim();
	if (!trimmed) return null;
	if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) return trimmed;
	if (trimmed.startsWith("/uploads/")) return trimmed;

	// Best-effort: map absolute file paths under UPLOAD_DIR to an API-relative URL under /uploads.
	const uploadDir = env.UPLOAD_DIR ? path.resolve(env.UPLOAD_DIR) : null;
	if (uploadDir && trimmed.startsWith("/")) {
		try {
			const rel = path.relative(uploadDir, trimmed);
			if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) {
				return `/uploads/${rel.split(path.sep).join("/")}`;
			}
		} catch {
			// fall through
		}
	}

	// Anything else (e.g. /tmp/*) is not web-served.
	return null;
}

function parseBool(input: string | undefined | null): boolean {
	if (!input) return false;
	return ["1", "true", "yes", "on"].includes(input.trim().toLowerCase());
}

function parseIntWithDefault(input: string | undefined, fallback: number): number {
	const v = Number.parseInt(String(input ?? ""), 10);
	return Number.isFinite(v) ? v : fallback;
}

let didWarnVisualExtractionDisabled = false;

export function getVisionExtractorConfig(env: NodeJS.ProcessEnv = process.env): VisionExtractorConfig {
	return {
		enabled: parseBool(env.ENABLE_VISUAL_EXTRACTION),
		visionWorkerUrl: (env.VISION_WORKER_URL || "http://localhost:8000").replace(/\/$/, ""),
		extractorVersion: env.VISION_EXTRACTOR_VERSION || "vision_v1",
		timeoutMs: parseIntWithDefault(env.VISION_TIMEOUT_MS, 8000),
		// Default high enough to cover typical pitch decks while keeping a hard cap via env.
		maxPages: parseIntWithDefault(env.VISION_MAX_PAGES, 50),
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
				if (pageIndex < 0) continue;
				if (pageCount && pageCount > 0 && pageIndex >= pageCount) continue;
				const full = path.join(dir, f);
				const list = byIndex.get(pageIndex) ?? [];
				list.push(full);
				byIndex.set(pageIndex, list);
			}

			const inferredPageCount =
				pageCount && pageCount > 0
					? pageCount
					: byIndex.size > 0
						? Math.max(...Array.from(byIndex.keys())) + 1
						: 0;

			const ordered: string[] = [];
			for (let i = 0; i < inferredPageCount; i += 1) {
				const cands = byIndex.get(i);
				if (!cands || cands.length === 0) continue;
				ordered.push(pickBestPerPage(cands));
			}

			if (ordered.length > 0) {
				// If the document row never had page_count, infer it from rendered pages so downstream
				// extraction (and UI) can behave deterministically.
				if ((!pageCount || pageCount <= 0) && inferredPageCount > 0) {
					try {
						await pool.query(
							"UPDATE documents SET page_count = $2, updated_at = now() WHERE id = $1 AND (page_count IS NULL OR page_count <= 0)",
							[sanitizeText(documentId), inferredPageCount]
						);
						logger.log(
							JSON.stringify({
								event: "PAGE_COUNT_INFERRED_FROM_RENDERED_PAGES",
								document_id: documentId,
								page_count: inferredPageCount,
								dir,
							})
						);
					} catch {
						// ignore
					}
				}
				return ordered;
			}
		}

		if (!pageCount || pageCount <= 0) {
			logger.log(
				JSON.stringify({
					event: "NO_PAGE_IMAGES_AVAILABLE",
					document_id: documentId,
					reason: "page_count_missing_and_no_images_found",
					searched_dirs: dirs,
				})
			);
			return [];
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

export async function backfillVisualAssetImageUris(params: {
	pool: Pool;
	documentId: string;
	pageImageUris: string[];
	env?: NodeJS.ProcessEnv;
}): Promise<{ updated: number }> {
	const env = params.env ?? process.env;
	let updated = 0;

	for (let i = 0; i < params.pageImageUris.length; i += 1) {
		const normalized = normalizeImageUriForApi(params.pageImageUris[i], env);
		if (!normalized) continue;
		try {
			const res = await params.pool.query<{ rowCount?: number }>(
				`UPDATE visual_assets
					 SET image_uri = $3
				 WHERE document_id = $1
				   AND page_index = $2
				   AND (image_uri IS NULL OR image_uri = '')`,
				[sanitizeText(params.documentId), i, normalized]
			);
			updated += res.rowCount ?? 0;
		} catch (err) {
			console.warn(
				`[visual_extraction] backfill image_uri failed doc=${params.documentId} page=${i}: ${
					err instanceof Error ? err.message : String(err)
				}`
			);
		}
	}

	return { updated };
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
	await pool.query(
		`INSERT INTO evidence_links (document_id, page_index, evidence_type, visual_asset_id, ref, snippet, confidence)
		 SELECT $1, $2, $3, $4, $5::jsonb, $6, $7
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
			JSON.stringify(sanitizeDeep(input.ref ?? {})),
			input.snippet,
			input.confidence,
		]
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
	const pageImageUriNormalized = normalizeImageUriForApi(pageImageUri, env);

	for (const asset of response.assets ?? []) {
		const normalizedAssetImageUri = normalizeImageUriForApi(asset.image_uri ?? null, env) ?? pageImageUriNormalized;
		const assetBBox = coerceBBox((asset as any)?.bbox);
		const assetQualityFlags = coerceJsonObject((asset as any)?.quality_flags);
		const extractionObj = (asset as any)?.extraction;
		const ocrText = typeof extractionObj?.ocr_text === "string" ? extractionObj.ocr_text : null;
		const ocrBlocks = coerceJsonArray<VisionOcrBlock>(extractionObj?.ocr_blocks);
		const structuredJson = coerceJsonObject(extractionObj?.structured_json);
		const labels = coerceJsonObject(extractionObj?.labels);

		// Persist a stable segment assignment for vision assets (PDF/images).
		// Resolution order: quality_flags.segment_key -> structured_json.segment_key -> infer from OCR/labels.
		const existingFromQuality = coerceSegmentKey((assetQualityFlags as any)?.segment_key);
		const existingFromStructured = coerceSegmentKey((structuredJson as any)?.segment_key);
		let segmentKey: SegmentKey | null = existingFromQuality ?? existingFromStructured;
		if (!segmentKey) {
			const titleFromLabels = typeof (labels as any)?.title === "string" ? String((labels as any).title) : "";
			const titleFromStructured = typeof (structuredJson as any)?.title === "string" ? String((structuredJson as any).title) : "";
			const combined = [titleFromLabels, titleFromStructured, ocrText].filter(Boolean).join("\n");
			segmentKey = classifySegmentKeyFromText(combined, "unknown");
		}

		const qualityFlagsWithSeg = segmentKey && !existingFromQuality
			? { ...assetQualityFlags, segment_key: segmentKey }
			: assetQualityFlags;
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

		const snippetRaw = ocrText;
		const snippet = snippetRaw && snippetRaw.length > 500 ? `${snippetRaw.slice(0, 497)}...` : snippetRaw;

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

type SyntheticAssetBuild = {
	pageIndex: number;
	asset: VisionAsset;
};

function hashKey(parts: Array<string | number>): string {
	return createHash("sha256").update(parts.map((p) => String(p)).join("|"), "utf8").digest("hex");
}

function cleanTextForClassification(input: unknown): string {
	if (input == null) return "";
	if (typeof input === "string") return input;
	if (typeof input === "number" || typeof input === "boolean") return String(input);
	if (Array.isArray(input)) return input.map((v) => cleanTextForClassification(v)).join("\n");
	if (typeof input === "object") {
		const obj = input as any;
		if (typeof obj.text === "string") return obj.text;
		if (typeof obj.value === "string") return obj.value;
		if (typeof obj.content === "string") return obj.content;
		if (Array.isArray(obj.runs)) return obj.runs.map((r: any) => (typeof r?.text === "string" ? r.text : "")).join("");
		return "";
	}
	return "";
}

function normalizeTextList(value: unknown, maxItems: number): string[] {
	const arr = Array.isArray(value) ? value : [];
	const out: string[] = [];
	for (const item of arr) {
		const t = cleanTextForClassification(item).trim();
		if (!t) continue;
		out.push(t);
		if (out.length >= maxItems) break;
	}
	return out;
}

function classifySegmentKeyFromText(textRaw: string, defaultKey: SegmentKey = "unknown"): SegmentKey {
	const text = String(textRaw || "")
		.toLowerCase()
		.replace(/\s+/g, " ")
		.trim();
	if (!text) return defaultKey;

	// API-aligned keyword sets (keep in sync with apps/api classifySegment headingSets).
	const keywordSets: Record<SegmentKey, string[]> = {
		overview: ["overview", "summary", "executive summary"],
		problem: ["problem", "pain", "challenge", "issue", "gap", "why this matters"],
		solution: ["solution", "approach", "value proposition", "why us"],
		product: ["product", "products", "technology", "features", "feature", "demo", "roadmap", "how it works"],
		market: ["market", "tam", "sam", "som", "opportunity", "segment", "sizing", "cagr"],
		traction: [
			"traction",
			"growth",
			"users",
			"customers",
			"mrr",
			"arr",
			"revenue",
			"retention",
			"pipeline",
			"gmv",
			"kpi",
			"conversion",
			"demo-to-close",
			"demo to close",
			"lift",
		],
		business_model: [
			"business model",
			"pricing",
			"revenue model",
			"unit economics",
			"how we make money",
			"saas",
			"platform",
			"add-ons",
			"addons",
			"subscription",
		],
		distribution: [
			"distribution",
			"go-to-market",
			"go to market",
			"gtm",
			"channels",
			"sales",
			"partnerships",
			"marketing",
			"reseller",
			"partners",
			"channel",
		],
		team: ["team", "founder", "ceo", "cto", "cfo", "bio", "leadership", "advisors", "founders", "meet our team"],
		competition: ["competition", "competitor", "alternative", "compare", "landscape", "moat"],
		risks: ["risk", "challenge", "threat", "mitigation", "compliance", "regulation", "limitation"],
		financials: [
			"financial",
			"financial strategy",
			"profit",
			"loss",
			"p&l",
			"balance",
			"cash",
			"projection",
			"forecast",
			"projections",
			"ebitda",
			"budget",
			"expenses",
			"gross margin",
			"revenue",
			"margin",
			"unit economics",
		],
		raise_terms: ["raise", "funding", "round", "terms", "cap table", "valuation", "use of funds", "investment"],
		exit: ["exit", "exit strategy", "acquisition", "m&a", "strategic options", "acquirer", "acquirers", "strategic buyers"],
		unknown: [],
	};

	const weights: Record<SegmentKey, number> = {
		overview: 1,
		problem: 3,
		solution: 3,
		product: 3,
		market: 3,
		traction: 3,
		business_model: 2,
		distribution: 2,
		team: 2,
		competition: 2,
		risks: 2,
		financials: 3,
		raise_terms: 3,
		exit: 2,
		unknown: 0,
	};

	const scoreByKey = new Map<SegmentKey, number>();
	for (const [key, phrases] of Object.entries(keywordSets) as Array<[SegmentKey, string[]]>) {
		if (key === "unknown") continue;
		let score = 0;
		for (const phrase of phrases) {
			if (!phrase) continue;
			if (text.includes(phrase.toLowerCase())) score += weights[key];
		}
		if (score > 0) scoreByKey.set(key, score);
	}

	let best: SegmentKey = defaultKey;
	let bestScore = 0;
	let secondScore = 0;
	for (const [k, s] of scoreByKey.entries()) {
		if (s > bestScore) {
			secondScore = bestScore;
			bestScore = s;
			best = k;
		} else if (s > secondScore) {
			secondScore = s;
		}
	}

	// Confidence gating: keep deterministic, but avoid over-assigning from weak signal.
	const MIN_SCORE = 2;
	const MIN_MARGIN = 1;
	if (bestScore < MIN_SCORE) return defaultKey;
	if (secondScore > 0 && bestScore < secondScore + MIN_MARGIN) return defaultKey;
	return best;
}

export function inferSegmentKeyFromStructured(params: {
	structuredJson: unknown;
	source: string;
	documentTitle?: string | null;
}): SegmentKey {
	const sj = (params.structuredJson ?? {}) as any;
	const docTitle = typeof params.documentTitle === "string" ? params.documentTitle : "";
	const title = cleanTextForClassification(sj?.title);
	const textSnippet = cleanTextForClassification(sj?.text_snippet);
	const heading = cleanTextForClassification(sj?.heading);
	const bullets = normalizeTextList(sj?.bullets, 20).join("\n");
	const paragraphs = normalizeTextList(sj?.paragraphs, 20).join("\n");
	const sheetName = cleanTextForClassification(sj?.sheet_name);
	const headers = normalizeTextList(sj?.headers, 20).join("\n");
	const numericColumns = normalizeTextList(sj?.numeric_columns, 20).join("\n");
	const sampleRows = Array.isArray(sj?.sample_rows) ? sj.sample_rows : [];
	const firstRowPreview = Array.isArray(sampleRows?.[0])
		? sampleRows[0].slice(0, 20).map((v: any) => cleanTextForClassification(v)).filter(Boolean).join(" ")
		: "";

	const combined = [
		docTitle,
		title,
		heading,
		textSnippet,
		bullets,
		paragraphs,
		sheetName ? `sheet: ${sheetName}` : "",
		headers ? `headers: ${headers}` : "",
		numericColumns ? `numeric: ${numericColumns}` : "",
		firstRowPreview ? `row0: ${firstRowPreview}` : "",
	]
		.filter(Boolean)
		.join("\n");

	// Excel defaults to financials unless there's a stronger signal.
	if (params.source === "structured_excel") {
		const inferred = classifySegmentKeyFromText(combined, "financials");
		return inferred || "financials";
	}

	return classifySegmentKeyFromText(combined, "unknown");
}

export async function resegmentStructuredSyntheticAssets(params: {
	pool: Pool;
	documentId: string;
	documentTitle?: string | null;
}): Promise<{ updated_assets: number; updated_extractions: number }> {
	const sources = ["structured_word", "structured_powerpoint", "structured_excel"];
	const { rows } = await params.pool.query<{
		id: string;
		quality_flags: any;
		structured_json: any;
	}> (
		`SELECT va.id,
		        va.quality_flags,
		        ve.structured_json
		   FROM visual_assets va
		   LEFT JOIN visual_extractions ve
		     ON ve.visual_asset_id = va.id
		    AND ve.extractor_version = va.extractor_version
		  WHERE va.document_id = $1
		    AND (va.quality_flags->>'source') = ANY($2)`,
		[sanitizeText(params.documentId), sources]
	);

	let updatedAssets = 0;
	let updatedExtractions = 0;
	for (const row of rows) {
		const source = typeof row?.quality_flags?.source === "string" ? row.quality_flags.source : "";
		if (!source) continue;
		const inferred = inferSegmentKeyFromStructured({
			structuredJson: row.structured_json,
			source,
			documentTitle: params.documentTitle ?? null,
		});
		if (!inferred) continue;

		const seg = String(inferred);
		// Update visual_assets.quality_flags.segment_key
		const res1 = await params.pool.query(
			`UPDATE visual_assets
			    SET quality_flags = jsonb_set(COALESCE(quality_flags, '{}'::jsonb), '{segment_key}', to_jsonb($2::text), true)
			  WHERE id = $1`,
			[sanitizeText(row.id), seg]
		);
		updatedAssets += (res1 as any)?.rowCount ?? 0;

		// Update visual_extractions.structured_json.segment_key (debug/secondary)
		const res2 = await params.pool.query(
			`UPDATE visual_extractions
			    SET structured_json = jsonb_set(COALESCE(structured_json, '{}'::jsonb), '{segment_key}', to_jsonb($2::text), true)
			  WHERE visual_asset_id = $1`,
			[sanitizeText(row.id), seg]
		);
		updatedExtractions += (res2 as any)?.rowCount ?? 0;
	}

	return { updated_assets: updatedAssets, updated_extractions: updatedExtractions };
}

function buildSyntheticAssets(params: {
	docKind: string;
	structuredData: any;
	fullContent: any;
}): SyntheticAssetBuild[] {
	const out: SyntheticAssetBuild[] = [];
	const kind = params.docKind;

	if (kind === "excel") {
		const sheets = Array.isArray(params.fullContent?.sheets) ? params.fullContent.sheets : [];
		sheets.forEach((sheet: any, idx: number) => {
			const headers = Array.isArray(sheet?.headers) ? sheet.headers.slice(0, 50) : [];
			const rows = Array.isArray(sheet?.rows) ? sheet.rows.slice(0, 5) : [];
			const rowCount = typeof sheet?.summary?.totalRows === "number" ? sheet.summary.totalRows : rows.length;
			const numericColumns = Array.isArray(sheet?.summary?.numericColumns) ? sheet.summary.numericColumns.slice(0, 25) : [];
			const sheetName = sheet?.name ?? `Sheet ${idx + 1}`;
			const firstRowPreview = Array.isArray(rows?.[0]) ? rows[0].slice(0, 20).map((v: any) => cleanTextForClassification(v)).filter(Boolean).join(" ") : "";
			const classifyText = [
				sheetName ? `sheet: ${sheetName}` : "",
				headers?.length ? `headers: ${headers.join(" ")}` : "",
				numericColumns?.length ? `numeric: ${numericColumns.join(" ")}` : "",
				firstRowPreview ? `row0: ${firstRowPreview}` : "",
			]
				.filter(Boolean)
				.join("\n");
			const segmentKey = classifySegmentKeyFromText(classifyText, "financials");
			const structuredJson = {
				kind: "excel_sheet",
				segment_key: segmentKey,
				sheet_name: sheetName,
				headers,
				row_count: rowCount,
				sample_rows: rows,
				numeric_columns: numericColumns,
				summary: sheet?.summary ?? {},
			};
			out.push({
				pageIndex: idx,
				asset: {
					asset_type: "table",
					bbox: { x: 0, y: 0, w: 1, h: 1 },
					confidence: 0.9,
					quality_flags: { source: "structured_excel", segment_key: segmentKey },
					image_uri: null,
					image_hash: hashKey([params.docKind, structuredJson.sheet_name ?? idx]),
					extraction: {
						ocr_text: null,
						ocr_blocks: [],
						structured_json: structuredJson,
						units: null,
						labels: { source: "structured_excel" },
						model_version: null,
						confidence: 0.9,
					},
				},
			});
		});
		return out;
	}

	if (kind === "word") {
		const sections = Array.isArray(params.fullContent?.sections) ? params.fullContent.sections : [];
		sections.slice(0, 25).forEach((section: any, idx: number) => {
			const heading = typeof section?.heading === "string" ? section.heading : null;
			const paragraphsRaw = Array.isArray(section?.paragraphs) ? section.paragraphs.slice(0, 5) : [];
			const paragraphs = normalizeTextList(paragraphsRaw, 6);
			const tableRows = Array.isArray(section?.tables?.[0]?.rows) ? section.tables[0].rows.slice(0, 5) : [];
			const textSnippetBase = typeof section?.text === "string" ? section.text : paragraphs.join(" ");
			const textSnippet = textSnippetBase ? textSnippetBase.slice(0, 500) : "";
			const classifyText = [heading ?? "", textSnippet, paragraphs.join("\n")].filter(Boolean).join("\n");
			const segmentKey = classifySegmentKeyFromText(classifyText, "unknown");
			const structuredJson = {
				kind: "word_section",
				segment_key: segmentKey,
				heading,
				level: typeof section?.level === "number" ? section.level : null,
				text_snippet: textSnippet,
				paragraphs,
				table_rows: tableRows,
			};
			out.push({
				pageIndex: idx,
				asset: {
					asset_type: tableRows.length > 0 ? "table" : "image_text",
					bbox: { x: 0, y: 0, w: 1, h: 1 },
					confidence: 0.85,
					quality_flags: { source: "structured_word", segment_key: segmentKey },
					image_uri: null,
					image_hash: hashKey([params.docKind, heading ?? idx, tableRows.length > 0 ? "table" : "text"]),
					extraction: {
						ocr_text: null,
						ocr_blocks: [],
						structured_json: structuredJson,
						units: null,
						labels: { source: "structured_word" },
						model_version: null,
						confidence: 0.85,
					},
				},
			});
		});
		return out;
	}

	if (kind === "powerpoint") {
		const slides = Array.isArray(params.fullContent?.slides) ? params.fullContent.slides : [];
		slides.slice(0, 50).forEach((slide: any, idx: number) => {
			const bullets = normalizeTextList(slide?.bullets, 15);
			const title = typeof slide?.title === "string" ? slide.title : null;
			const textSnippet = typeof slide?.text === "string" ? slide.text.slice(0, 500) : "";
			const classifyText = [title ?? "", textSnippet, bullets.join("\n")].filter(Boolean).join("\n");
			const segmentKey = classifySegmentKeyFromText(classifyText, "unknown");
			const structuredJson = {
				kind: "powerpoint_slide",
				segment_key: segmentKey,
				slide_number: typeof slide?.slideNumber === "number" ? slide.slideNumber : idx + 1,
				title,
				bullets,
				text_snippet: textSnippet,
				notes: typeof slide?.notes === "string" ? slide.notes.slice(0, 500) : null,
				images: Array.isArray(slide?.images) ? slide.images : [],
			};
			out.push({
				pageIndex: idx,
				asset: {
					asset_type: "image_text",
					bbox: { x: 0, y: 0, w: 1, h: 1 },
					confidence: 0.85,
					quality_flags: { source: "structured_powerpoint", segment_key: segmentKey },
					image_uri: null,
					image_hash: hashKey([params.docKind, structuredJson.slide_number ?? idx]),
					extraction: {
						ocr_text: null,
						ocr_blocks: [],
						structured_json: structuredJson,
						units: null,
						labels: { source: "structured_powerpoint" },
						model_version: null,
						confidence: 0.85,
					},
				},
			});
		});
	}

	return out;
}

export async function persistSyntheticVisualAssets(params: {
	pool: Pool;
	documentId: string;
	docKind: string;
	structuredData: any;
	fullContent: any;
	extractorVersion?: string;
	env?: NodeJS.ProcessEnv;
}): Promise<number> {
	const env = params.env ?? process.env;
	const extractorVersion = params.extractorVersion ?? "structured_native_v1";
	const assets = buildSyntheticAssets({ docKind: params.docKind, structuredData: params.structuredData, fullContent: params.fullContent });
	if (assets.length === 0) return 0;

	let persisted = 0;
	const grouped = new Map<number, VisionAsset[]>();
	for (const entry of assets) {
		const list = grouped.get(entry.pageIndex) ?? [];
		list.push(entry.asset);
		grouped.set(entry.pageIndex, list);
	}

	for (const [pageIndex, assetList] of grouped.entries()) {
		const response: VisionExtractResponse = {
			document_id: params.documentId,
			page_index: pageIndex,
			extractor_version: extractorVersion,
			assets: assetList,
		};
		const { persisted: pCount } = await persistVisionResponse(params.pool, response, { pageImageUri: null, env });
		persisted += pCount;
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
	if (!params.config.enabled) {
		// Optional fail-safe warning: once per process, when ingest completion tries to enqueue visuals.
		// Only warn for unset or explicit "0" to avoid noisy logs for other falsey values.
		const raw = process.env.ENABLE_VISUAL_EXTRACTION;
		const normalized = typeof raw === "string" ? raw.trim() : "";
		if (!didWarnVisualExtractionDisabled && (normalized.length === 0 || normalized === "0")) {
			didWarnVisualExtractionDisabled = true;
			logger.warn("Visual extraction disabled: ENABLE_VISUAL_EXTRACTION not set");
		}
		return false;
	}

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
