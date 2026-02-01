import type { Pool } from "pg";

import { upsertVisualAsset, upsertVisualExtraction } from "../visual-extraction";
import { getPipelineAutomationMode } from "../pipeline-policy";

type PdfV2TextRegionAssetsMode = "off" | "shadow" | "primary";

type NormalizedBBox = { x: number; y: number; w: number; h: number };

type UnderstandingRegion = {
	role?: unknown;
	bbox?: unknown;
	text?: unknown;
	conf?: unknown;
};

function normalizeMode(raw: unknown): PdfV2TextRegionAssetsMode {
	const v = typeof raw === "string" ? raw.trim().toLowerCase() : "";
	if (v === "shadow" || v === "primary" || v === "off") return v;
	return getPipelineAutomationMode(process.env) === "off" ? "off" : "shadow";
}

function clamp01(n: number): number {
	if (!Number.isFinite(n)) return 0;
	if (n < 0) return 0;
	if (n > 1) return 1;
	return n;
}

function coerceNormalizedBBox(input: unknown): NormalizedBBox | null {
	if (!input || typeof input !== "object") return null;
	const obj = input as any;
	const x = clamp01(typeof obj.x === "number" ? obj.x : NaN);
	const y = clamp01(typeof obj.y === "number" ? obj.y : NaN);
	const w = clamp01(typeof obj.w === "number" ? obj.w : NaN);
	const h = clamp01(typeof obj.h === "number" ? obj.h : NaN);
	// Require any sensible dimensions.
	if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h)) return null;
	if (w <= 0 || h <= 0) return null;
	return { x, y, w, h };
}

function coerceRole(input: unknown): "title" | "body" | "footer" | "other" {
	const r = typeof input === "string" ? input.trim().toLowerCase() : "";
	if (r === "title" || r === "body" || r === "footer" || r === "other") return r;
	return "other";
}

function rolePriority(role: "title" | "body" | "footer" | "other"): number {
	switch (role) {
		case "title":
			return 0;
		case "body":
			return 1;
		case "footer":
			return 2;
		default:
			return 3;
	}
}

export type PdfTextRegionStructuredAssetV1 = {
	asset_id: string;
	document_id: string;
	deal_id?: string | null;
	page_index: number;
	kind: "pdf_text_region";
	title: string;
	text: string;
	confidence: number;
	locator: { document_id: string; page_index: number; deal_id?: string | null };
	bbox: NormalizedBBox;
	bbox_units: "normalized";
	provenance: {
		source: "pdf_v2_understanding_v1";
		version: "pdf_text_region_v1";
		region_role: "title" | "body" | "footer" | "other";
		region_index: number;
	};
};

export function buildPdfTextRegionStructuredAssetsV1(args: {
	documentId: string;
	dealId?: string | null;
	fullContent: any;
}): Array<{ pageIndex: number; structured: PdfTextRegionStructuredAssetV1; bbox: NormalizedBBox; confidence: number }> {
	const documentId = args.documentId;
	const dealId = args.dealId ?? null;
	const fullContent = args.fullContent ?? {};

	// Accept either { pdf_v2: { pages: [...] } } (DB full_content) or { pages: [...] } (artifact pdf_v2 object).
	const pdfV2 = (fullContent as any)?.pdf_v2 && typeof (fullContent as any).pdf_v2 === "object" ? (fullContent as any).pdf_v2 : fullContent;
	const pages = Array.isArray((pdfV2 as any)?.pages) ? (pdfV2 as any).pages : [];
	if (pages.length === 0) return [];

	const out: Array<{ pageIndex: number; structured: PdfTextRegionStructuredAssetV1; bbox: NormalizedBBox; confidence: number }> = [];

	for (const page of pages) {
		const pageIndexRaw = (page as any)?.page_index;
		const pageIndex = typeof pageIndexRaw === "number" && Number.isFinite(pageIndexRaw) ? pageIndexRaw : null;
		if (pageIndex == null || pageIndex < 0) continue;

		const understanding = (page as any)?.understanding_v1;
		if (!understanding || typeof understanding !== "object") continue;
		const regions = Array.isArray((understanding as any)?.regions) ? ((understanding as any).regions as UnderstandingRegion[]) : [];
		if (regions.length < 3) continue;

		const normalized = regions
			.map((r) => {
				const role = coerceRole((r as any)?.role);
				const bbox = coerceNormalizedBBox((r as any)?.bbox);
				const text = typeof (r as any)?.text === "string" ? (r as any).text : "";
				const conf = typeof (r as any)?.conf === "number" && Number.isFinite((r as any).conf) ? clamp01((r as any).conf) : 0;
				return { role, bbox, text, conf };
			})
			.filter((r) => Boolean(r.bbox));

		if (normalized.length < 3) continue;
		normalized.sort((a, b) => {
			const rp = rolePriority(a.role) - rolePriority(b.role);
			if (rp !== 0) return rp;
			const ya = (a.bbox as NormalizedBBox).y;
			const yb = (b.bbox as NormalizedBBox).y;
			if (ya !== yb) return ya - yb;
			const xa = (a.bbox as NormalizedBBox).x;
			const xb = (b.bbox as NormalizedBBox).x;
			if (xa !== xb) return xa - xb;
			return 0;
		});

		const bounded = normalized.slice(0, 12);
		if (bounded.length < 3) continue;

		for (let regionIndex = 0; regionIndex < bounded.length; regionIndex += 1) {
			const region = bounded[regionIndex];
			const assetId = `pdf_text_region_v1:${documentId}:${pageIndex}:${regionIndex}`;
			const title = `Page ${pageIndex + 1} – ${region.role}`;

			out.push({
				pageIndex,
				bbox: region.bbox as NormalizedBBox,
				confidence: region.conf,
				structured: {
					asset_id: assetId,
					document_id: documentId,
					deal_id: dealId,
					page_index: pageIndex,
					kind: "pdf_text_region",
					title,
					text: region.text,
					confidence: region.conf,
					locator: {
						document_id: documentId,
						page_index: pageIndex,
						deal_id: dealId,
					},
					bbox: region.bbox as NormalizedBBox,
					bbox_units: "normalized",
					provenance: {
						source: "pdf_v2_understanding_v1",
						version: "pdf_text_region_v1",
						region_role: region.role,
						region_index: regionIndex,
					},
				},
			});
		}
	}

	return out;
}

export async function persistPdfV2TextRegionAssetsV1Shadow(params: {
	pool: Pool;
	documentId: string;
	dealId?: string | null;
	fullContent: any;
	env?: NodeJS.ProcessEnv;
}): Promise<number> {
	const env = params.env ?? process.env;
	const mode = normalizeMode(env.PDF_V2_TEXT_REGION_ASSETS_MODE);
	if (mode !== "shadow") return 0;

	const structuredAssets = buildPdfTextRegionStructuredAssetsV1({
		documentId: params.documentId,
		dealId: params.dealId ?? null,
		fullContent: params.fullContent,
	});
	if (structuredAssets.length === 0) return 0;

	let persisted = 0;
	for (const entry of structuredAssets) {
		const assetId = entry.structured.asset_id;
		const pageIndex = entry.pageIndex;
		const title = entry.structured.title;

		const visualAssetId = await upsertVisualAsset(params.pool, {
			documentId: params.documentId,
			pageIndex,
			assetType: "image_text",
			bbox: entry.bbox,
			imageUri: null,
			imageHash: assetId,
			extractorVersion: "pdf_text_region_v1",
			confidence: entry.confidence,
			qualityFlags: {
				source: "pdf_v2_understanding_v1",
				synthetic_kind: "pdf_text_region",
				asset_id: assetId,
				region_role: entry.structured.provenance.region_role,
				region_index: entry.structured.provenance.region_index,
			},
		});

		await upsertVisualExtraction(params.pool, {
			visualAssetId,
			extractorVersion: "pdf_text_region_v1",
			ocrText: null,
			ocrBlocks: [],
			structuredJson: entry.structured as any,
			units: null,
			labels: { source: "pdf_v2_understanding_v1", title },
			modelVersion: null,
			confidence: entry.confidence,
		});

		persisted += 1;
	}

	return persisted;
}
