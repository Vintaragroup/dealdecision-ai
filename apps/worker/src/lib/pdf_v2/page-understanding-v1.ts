import type { Pool } from "pg";

import { getPipelineAutomationMode } from "../pipeline-policy";

type PageUnderstandingMode = "off" | "shadow" | "primary";

type NormalizedBBox = { x: number; y: number; w: number; h: number };

type RegionLike = {
	role?: unknown;
	bbox?: unknown;
	text?: unknown;
	conf?: unknown;
};

type MetricLike = {
	label?: unknown;
	value?: unknown;
	unit?: unknown;
	context?: unknown;
	conf?: unknown;
	source_bbox?: unknown;
	source_text?: unknown;
};

type OcrV2BlockLike = { text?: unknown; confidence?: unknown; bbox?: unknown };

type OcrV2Like = {
	provider?: unknown;
	avg_confidence?: unknown;
	blocks?: unknown;
};

type PdfV2PageLike = {
	page_index?: unknown;
	final?: { text?: unknown };
	understanding_v1?: unknown;
	ocr_v2?: unknown;
};

type PdfV2Like = { status?: unknown; pages?: unknown };

type TitleCandidateLike = { text?: unknown; score?: unknown; reasons?: unknown };

function normalizeMode(raw: unknown): PageUnderstandingMode {
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

function cleanText(s: unknown): string {
	return String(typeof s === "string" ? s : "").replace(/\s+/g, " ").trim();
}

function clampInt(n: unknown): number | null {
	return typeof n === "number" && Number.isFinite(n) ? Math.trunc(n) : null;
}

function coerceNormalizedBBox(input: unknown): NormalizedBBox | null {
	if (!input || typeof input !== "object") return null;
	const obj = input as any;
	const x = clamp01(typeof obj.x === "number" ? obj.x : NaN);
	const y = clamp01(typeof obj.y === "number" ? obj.y : NaN);
	const w = clamp01(typeof obj.w === "number" ? obj.w : NaN);
	const h = clamp01(typeof obj.h === "number" ? obj.h : NaN);
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

function safeJsonStringify(v: any): string {
	return JSON.stringify(v ?? null);
}

function alnumRatio(s: string): number {
	const t = s.replace(/\s+/g, "");
	if (!t) return 0;
	const alnum = (t.match(/[A-Za-z0-9]/g) ?? []).length;
	return alnum / t.length;
}

function computeOcrV2CleanText(ocrV2: OcrV2Like | null): { text: string; keptBlocks: number; totalBlocks: number } {
	const blocks = Array.isArray(ocrV2?.blocks) ? (ocrV2?.blocks as OcrV2BlockLike[]) : [];
	const totalBlocks = blocks.length;

	const kept: string[] = [];
	for (const b of blocks) {
		if (kept.length >= 80) break;
		const txt = cleanText(b?.text);
		if (!txt || txt.length < 10) continue;
		const confRaw = typeof b?.confidence === "number" && Number.isFinite(b.confidence) ? b.confidence : null;
		if (confRaw != null && confRaw < 0.55) continue;
		if (alnumRatio(txt) < 0.4) continue;
		kept.push(txt);
	}

	const uniq: string[] = [];
	const seen = new Set<string>();
	for (const t of kept) {
		const key = t.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		uniq.push(t);
	}

	return { text: uniq.join("\n"), keptBlocks: uniq.length, totalBlocks };
}

function iou(a: NormalizedBBox, b: NormalizedBBox): number {
	const ax2 = a.x + a.w;
	const ay2 = a.y + a.h;
	const bx2 = b.x + b.w;
	const by2 = b.y + b.h;
	const ix1 = Math.max(a.x, b.x);
	const iy1 = Math.max(a.y, b.y);
	const ix2 = Math.min(ax2, bx2);
	const iy2 = Math.min(ay2, by2);
	const iw = Math.max(0, ix2 - ix1);
	const ih = Math.max(0, iy2 - iy1);
	const inter = iw * ih;
	if (inter <= 0) return 0;
	const ua = a.w * a.h + b.w * b.h - inter;
	if (ua <= 0) return 0;
	return inter / ua;
}

function centerDist2(a: NormalizedBBox, b: NormalizedBBox): number {
	const ax = a.x + a.w / 2;
	const ay = a.y + a.h / 2;
	const bx = b.x + b.w / 2;
	const by = b.y + b.h / 2;
	const dx = ax - bx;
	const dy = ay - by;
	return dx * dx + dy * dy;
}

function linkToAssets(target: { bbox: NormalizedBBox } | null, assets: Array<{ id: string; bbox: NormalizedBBox }>): {
	linked_asset_id: string | null;
	link_reason: "bbox_iou" | "nearest_center" | "none";
} {
	if (!target || assets.length === 0) return { linked_asset_id: null, link_reason: "none" };

	let bestId: string | null = null;
	let bestIou = 0;
	for (const a of assets) {
		const score = iou(target.bbox, a.bbox);
		if (score > bestIou + 1e-12) {
			bestIou = score;
			bestId = a.id;
		} else if (Math.abs(score - bestIou) <= 1e-12 && score > 0 && bestId && a.id < bestId) {
			// deterministic tie-break
			bestId = a.id;
		}
	}

	if (bestId && bestIou > 0) return { linked_asset_id: bestId, link_reason: "bbox_iou" };

	let nearestId: string | null = null;
	let nearestD2 = Number.POSITIVE_INFINITY;
	for (const a of assets) {
		const d2 = centerDist2(target.bbox, a.bbox);
		if (d2 < nearestD2 - 1e-12) {
			nearestD2 = d2;
			nearestId = a.id;
		} else if (Math.abs(d2 - nearestD2) <= 1e-12 && nearestId && a.id < nearestId) {
			nearestId = a.id;
		}
	}
	return nearestId ? { linked_asset_id: nearestId, link_reason: "nearest_center" } : { linked_asset_id: null, link_reason: "none" };
}

function pickFirstLine(text: string): string {
	const lines = String(text || "")
		.split(/\r?\n/)
		.map((l) => l.trim())
		.filter(Boolean);
	return lines.length ? lines[0].slice(0, 180) : "";
}

function normalizeForBoilerplate(s: string): string {
	return cleanText(s)
		.toLowerCase()
		.replace(/\bpage\s*\d+\b/g, " ")
		.replace(/[\d]+/g, " ")
		.replace(/[^a-z\s]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function looksLikeBoilerplate(s: string): boolean {
	const t = normalizeForBoilerplate(s);
	if (!t) return false;
	// common boilerplate fragments
	if (t.includes("confidential")) return true;
	if (t.includes("all rights reserved")) return true;
	if (t.includes("copyright")) return true;
	return false;
}

function sanitizeTitleText(raw: string): string {
	let t = cleanText(raw);
	if (!t) return "";
	// Remove leading bullets/punctuation noise.
	t = t.replace(/^[\s•\-–—_~"“”'`´]+/, "").trim();
	// Common OCR artifact: single-letter prefix (e.g. "S MARKET PROBLEM")
	if (/^[A-Za-z]\s+[A-Z0-9][A-Z0-9\s\-–—:&/]+$/.test(t) && t.length >= 10) {
		t = t.replace(/^[A-Za-z]\s+/, "");
	}
	// Drop page-number-only titles.
	if (/^\s*(page\s*)?\d+\s*$/i.test(t)) return "";
	return t.slice(0, 180);
}

function isBadTitleCandidate(t: string): boolean {
	const s = sanitizeTitleText(t);
	if (!s) return true;
	if (s.length < 4) return true;
	if (alnumRatio(s) < 0.55) return true;
	// Too many repeated punctuation/symbols
	if ((s.match(/[^A-Za-z0-9\s]/g) ?? []).length > Math.max(6, Math.floor(s.length * 0.25))) return true;
	// Mostly digits
	const digits = (s.match(/[0-9]/g) ?? []).length;
	if (digits > 0 && digits / s.length > 0.5) return true;
	return false;
}

function buildBoilerplateSetFromUnderstanding(pages: PdfV2PageLike[]): Set<string> {
	const counts = new Map<string, number>();
	let pagesWithUnderstanding = 0;

	for (const p of pages) {
		const u = (p as any)?.understanding_v1;
		const understanding = u && typeof u === "object" ? (u as any) : null;
		if (!understanding) continue;
		pagesWithUnderstanding += 1;
		const regionsRaw = Array.isArray(understanding?.regions) ? (understanding.regions as RegionLike[]) : [];
		for (const r of regionsRaw) {
			const role = coerceRole((r as any)?.role);
			if (role !== "footer" && role !== "title") continue;
			const txt = cleanText((r as any)?.text);
			if (!txt || txt.length < 8) continue;
			const key = normalizeForBoilerplate(txt);
			if (!key || key.length < 6) continue;
			counts.set(key, (counts.get(key) ?? 0) + 1);
		}
	}

	const out = new Set<string>();
	const threshold = Math.max(3, Math.ceil(pagesWithUnderstanding * 0.4));
	for (const [k, n] of counts.entries()) {
		if (n >= threshold) out.add(k);
	}
	return out;
}

function selectBestTitleCandidate(params: {
	titleCandidates: Array<{ text: string; score: number; reasons: string[] }>;
	boilerplate: Set<string>;
}): { title: string; candidate_score: number; candidate_reasons: string[] } | null {
	let best: { title: string; candidate_score: number; candidate_reasons: string[] } | null = null;
	for (const c of params.titleCandidates) {
		const title = sanitizeTitleText(c.text);
		if (!title) continue;
		if (isBadTitleCandidate(title)) continue;
		const bpKey = normalizeForBoilerplate(title);
		if (bpKey && params.boilerplate.has(bpKey)) continue;
		if (looksLikeBoilerplate(title)) continue;
		const score = Number.isFinite(c.score) ? c.score : 0;
		if (!best || score > best.candidate_score + 1e-9 || (Math.abs(score - best.candidate_score) <= 1e-9 && title < best.title)) {
			best = { title, candidate_score: score, candidate_reasons: c.reasons };
		}
	}
	return best;
}

function deriveTitle(params: {
	understandingTitle: string;
	understandingConf: number;
	understandingTitleCandidates: Array<{ text: string; score: number; reasons: string[] }>;
	ocrClean: string;
	regionsSorted: Array<{ role: string; text: string; conf: number }>;
	finalText: string;
	ocrAvgConfidence: number | null;
	boilerplate: Set<string>;
}): { title: string; confidence: number; source: string } {
	const titleFromCandidates = selectBestTitleCandidate({ titleCandidates: params.understandingTitleCandidates, boilerplate: params.boilerplate });
	const understandingTitleSan = sanitizeTitleText(params.understandingTitle);
	const rawLooksNoisyPrefix = /^[A-Za-z]\s+[A-Z0-9][A-Z0-9\s\-–—:&/]+$/.test(cleanText(params.understandingTitle));
	const understandingTitleBad = understandingTitleSan ? (isBadTitleCandidate(understandingTitleSan) || rawLooksNoisyPrefix) : true;
	const understandingTitleBoiler = understandingTitleSan ? (params.boilerplate.has(normalizeForBoilerplate(understandingTitleSan)) || looksLikeBoilerplate(understandingTitleSan)) : false;

	if (titleFromCandidates && (understandingTitleBad || understandingTitleBoiler || titleFromCandidates.candidate_score > (params.understandingConf + 0.15))) {
		return {
			title: titleFromCandidates.title,
			confidence: clamp01(0.35 + Math.max(0, Math.min(0.6, titleFromCandidates.candidate_score))),
			source: "understanding_v1.title_candidate",
		};
	}

	if (understandingTitleSan && !understandingTitleBad && !understandingTitleBoiler) {
		return { title: understandingTitleSan, confidence: clamp01(params.understandingConf), source: "understanding_v1.title" };
	}

	const ocrLine = pickFirstLine(params.ocrClean);
	if (ocrLine) {
		const base = 0.35;
		const boost = params.ocrAvgConfidence != null ? Math.max(0, Math.min(0.4, params.ocrAvgConfidence * 0.4)) : 0.1;
		return { title: ocrLine, confidence: clamp01(base + boost), source: "ocr_v2_text_clean.first_line" };
	}

	const titleRegion = params.regionsSorted.find((r) => r.role === "title" && r.text && !isBadTitleCandidate(r.text) && !params.boilerplate.has(normalizeForBoilerplate(r.text)));
	if (titleRegion) {
		return { title: sanitizeTitleText(titleRegion.text), confidence: clamp01(0.25 + titleRegion.conf * 0.6), source: "region.title" };
	}

	const finalSnip = sanitizeTitleText(params.finalText);
	if (finalSnip) {
		return { title: finalSnip, confidence: 0.2, source: "pdf_v2.final.text" };
	}

	return { title: "", confidence: 0, source: "none" };
}

function deriveSummary(params: {
	understandingSummary: string;
	understandingConf: number;
	regionsSorted: Array<{ role: string; text: string; conf?: number }>;
	metrics: Array<{ label: string; value: string; unit: string }>;
	resolvedTitle: string;
	boilerplate: Set<string>;
}): { summary: string; confidence: number; source: string } {
	const sumSan = cleanText(params.understandingSummary);
	const sumBoiler = sumSan ? (params.boilerplate.has(normalizeForBoilerplate(sumSan)) || looksLikeBoilerplate(sumSan)) : false;
	if (sumSan && !sumBoiler && sumSan.length >= 40) {
		return { summary: sumSan.slice(0, 600), confidence: clamp01(params.understandingConf), source: "understanding_v1.summary" };
	}

	const body = params.regionsSorted
		.filter((r) => r.role === "body")
		.map((r) => ({ text: cleanText(r.text), conf: typeof r.conf === "number" && Number.isFinite(r.conf) ? clamp01(r.conf) : 0 }))
		.filter((r) => Boolean(r.text) && r.text.length >= 20 && alnumRatio(r.text) >= 0.5 && r.conf >= 0.35)
		.filter((r) => !params.boilerplate.has(normalizeForBoilerplate(r.text)) && !looksLikeBoilerplate(r.text))
		.sort((a, b) => {
			// prefer higher conf, then longer (bounded)
			if (b.conf !== a.conf) return b.conf - a.conf;
			return b.text.length - a.text.length;
		})
		.slice(0, 3)
		.map((r) => r.text)
		.map((t) => (t.length > 220 ? t.slice(0, 220) + "…" : t));

	const metricBits = params.metrics
		.slice(0, 4)
		.map((m) => {
			const label = cleanText(m.label);
			const value = cleanText(m.value);
			const unit = cleanText(m.unit);
			return [label, value, unit].filter(Boolean).join(" ").trim();
		})
		.filter(Boolean);

	const parts = [] as string[];
	if (params.resolvedTitle) parts.push(params.resolvedTitle);
	if (body.length) parts.push(body.join(" "));
	if (metricBits.length) parts.push(metricBits.join("; "));

	const summary = parts.join(" — ").slice(0, 600);
	const confidence = clamp01(0.25 + (body.length ? 0.25 : 0) + (metricBits.length ? 0.2 : 0));
	return { summary, confidence, source: "derived_v1" };
}

export async function persistPdfPageUnderstandingV1Shadow(params: {
	pool: Pool;
	documentId: string;
	dealId?: string | null;
	fullContent: any;
	env?: NodeJS.ProcessEnv;
	now?: string;
}): Promise<{ persisted_pages: number; attempted_pages: number }> {
	const env = params.env ?? process.env;
	const mode = normalizeMode(env.PDF_PAGE_UNDERSTANDING_MODE);
	if (mode !== "shadow") return { persisted_pages: 0, attempted_pages: 0 };

	const fullContent = params.fullContent ?? {};
	const pdfV2: PdfV2Like | null =
		(fullContent as any)?.pdf_v2 && typeof (fullContent as any).pdf_v2 === "object" ? ((fullContent as any).pdf_v2 as any) : (fullContent as any);
	if (!pdfV2 || (pdfV2 as any).status !== "ok") return { persisted_pages: 0, attempted_pages: 0 };

	const pages = Array.isArray((pdfV2 as any)?.pages) ? ((pdfV2 as any).pages as PdfV2PageLike[]) : [];
	if (pages.length === 0) return { persisted_pages: 0, attempted_pages: 0 };

	const boilerplate = buildBoilerplateSetFromUnderstanding(pages);

	const now = params.now || new Date().toISOString();

	let attempted = 0;
	let persisted = 0;

	for (const p of pages) {
		const pageIndex = clampInt(p?.page_index);
		if (pageIndex == null || pageIndex < 0) continue;

		const u = (p as any)?.understanding_v1;
		const understanding = u && typeof u === "object" ? (u as any) : null;
		if (!understanding) continue;

		attempted += 1;

		const regionsRaw = Array.isArray(understanding?.regions) ? (understanding.regions as RegionLike[]) : [];
		const normalizedRegions = regionsRaw
			.map((r) => {
				const role = coerceRole((r as any)?.role);
				const bbox = coerceNormalizedBBox((r as any)?.bbox);
				const text = cleanText((r as any)?.text);
				const conf = typeof (r as any)?.conf === "number" && Number.isFinite((r as any).conf) ? clamp01((r as any).conf) : 0;
				return bbox ? { role, bbox, text, conf } : null;
			})
			.filter((x): x is { role: "title" | "body" | "footer" | "other"; bbox: NormalizedBBox; text: string; conf: number } => Boolean(x));

		normalizedRegions.sort((a, b) => {
			const rp = rolePriority(a.role) - rolePriority(b.role);
			if (rp !== 0) return rp;
			if (a.bbox.y !== b.bbox.y) return a.bbox.y - b.bbox.y;
			if (a.bbox.x !== b.bbox.x) return a.bbox.x - b.bbox.x;
			return 0;
		});

		const boundedRegions = normalizedRegions.slice(0, 12);
		if (boundedRegions.length < 3) continue;

		const ocrV2Raw = (p as any)?.ocr_v2;
		const ocrV2: OcrV2Like | null = ocrV2Raw && typeof ocrV2Raw === "object" ? (ocrV2Raw as any) : null;
		const ocrV2Avg = typeof ocrV2?.avg_confidence === "number" && Number.isFinite(ocrV2.avg_confidence) ? clamp01(ocrV2.avg_confidence) : null;
		const ocrClean = computeOcrV2CleanText(ocrV2);

		const finalText = cleanText((p as any)?.final?.text);
		const understandingTitle = cleanText(understanding?.title);
		const understandingTitleConf = typeof understanding?.title_confidence === "number" && Number.isFinite(understanding.title_confidence) ? clamp01(understanding.title_confidence) : 0;
		const titleCandidatesRaw = Array.isArray(understanding?.title_candidates) ? (understanding.title_candidates as TitleCandidateLike[]) : [];
		const titleCandidates = titleCandidatesRaw
			.map((c) => {
				const text = cleanText((c as any)?.text);
				const score = typeof (c as any)?.score === "number" && Number.isFinite((c as any).score) ? (c as any).score : 0;
				const reasons = Array.isArray((c as any)?.reasons) ? ((c as any).reasons as any[]).map((r) => cleanText(r)).filter(Boolean).slice(0, 8) : [];
				return text ? { text, score, reasons } : null;
			})
			.filter((x): x is { text: string; score: number; reasons: string[] } => Boolean(x))
			.slice(0, 12);
		const titleRes = deriveTitle({
			understandingTitle,
			understandingConf: understandingTitleConf,
			understandingTitleCandidates: titleCandidates,
			ocrClean: ocrClean.text,
			regionsSorted: boundedRegions,
			finalText,
			ocrAvgConfidence: ocrV2Avg,
			boilerplate,
		});

		const slideType = typeof understanding?.slide_type === "string" ? String(understanding.slide_type) : "";
		const slideTypeConf = typeof understanding?.slide_type_confidence === "number" && Number.isFinite(understanding.slide_type_confidence)
			? clamp01(understanding.slide_type_confidence)
			: 0;
		const slideTypeRes = slideType
			? { slide_type: slideType, confidence: slideTypeConf, source: "understanding_v1.slide_type" }
			: { slide_type: "other", confidence: 0.1, source: "default" };

		const understandingSummary = cleanText(understanding?.summary);
		const understandingSummaryConf = typeof understanding?.summary_confidence === "number" && Number.isFinite(understanding.summary_confidence)
			? clamp01(understanding.summary_confidence)
			: 0;

		const metricsRaw = Array.isArray(understanding?.key_metrics) ? (understanding.key_metrics as MetricLike[]) : [];
		const metricsNorm = metricsRaw
			.map((m) => {
				const value = cleanText((m as any)?.value);
				if (!value) return null;
				const label = cleanText((m as any)?.label);
				const unit = cleanText((m as any)?.unit);
				const context = cleanText((m as any)?.context);
				const conf = typeof (m as any)?.conf === "number" && Number.isFinite((m as any).conf) ? clamp01((m as any).conf) : 0;
				const bbox = coerceNormalizedBBox((m as any)?.source_bbox?.bbox);
				return { label, value, unit, context, conf, source_bbox: bbox };
			})
			.filter((x): x is { label: string; value: string; unit: string; context: string; conf: number; source_bbox: NormalizedBBox | null } => Boolean(x));

		const sumRes = deriveSummary({
			understandingSummary,
			understandingConf: understandingSummaryConf,
			regionsSorted: boundedRegions,
			metrics: metricsNorm.map((m) => ({ label: m.label, value: m.value, unit: m.unit })),
			resolvedTitle: titleRes.title,
			boilerplate,
		});

		// Fetch synthetic pdf_text_region assets for linking.
		const assetsRes = await params.pool.query(
			`SELECT id, bbox
			   FROM visual_assets
			  WHERE document_id = $1
			    AND page_index = $2
			    AND extractor_version = 'pdf_text_region_v1'
			  ORDER BY id ASC`,
			[params.documentId, pageIndex]
		);
		const assetRows = Array.isArray((assetsRes as any)?.rows) ? ((assetsRes as any).rows as any[]) : [];
		const regionAssets = assetRows
			.map((r) => {
				const id = typeof r?.id === "string" ? r.id : null;
				const bbox = coerceNormalizedBBox(r?.bbox);
				return id && bbox ? { id, bbox } : null;
			})
			.filter((x): x is { id: string; bbox: NormalizedBBox } => Boolean(x));

		const regionsOut = boundedRegions.map((r, idx) => {
			const link = linkToAssets({ bbox: r.bbox }, regionAssets);
			return {
				region_index: idx,
				role: r.role,
				bbox_norm: r.bbox,
				conf: r.conf,
				linked_asset_id: link.linked_asset_id,
				text_snip: r.text.length > 160 ? r.text.slice(0, 160) + "…" : r.text,
			};
		});

		const keyMetricsOut = metricsRaw.map((m: any) => {
			const sourceBbox = coerceNormalizedBBox(m?.source_bbox?.bbox);
			const link = sourceBbox ? linkToAssets({ bbox: sourceBbox }, regionAssets) : { linked_asset_id: null, link_reason: "none" as const };
			return {
				...(m && typeof m === "object" ? m : {}),
				linked_asset_id: link.linked_asset_id,
				link_reason: link.link_reason,
			};
		});

		const payload = {
			version: "page_understanding_v1",
			generated_at: now,
			document_id: params.documentId,
			page_index: pageIndex,
			inputs: {
				has_understanding_v1: true,
				has_ocr_v2: Boolean(ocrV2),
				has_ocr_v2_text_clean: Boolean(ocrClean.text),
				region_asset_count: regionAssets.length,
				ocr_v2_avg_confidence: ocrV2Avg,
				ocr_v2_kept_blocks: ocrClean.keptBlocks,
				ocr_v2_total_blocks: ocrClean.totalBlocks,
			},
			resolved_title: titleRes.title,
			resolved_title_confidence: titleRes.confidence,
			resolved_title_source: titleRes.source,
			resolved_title_meta: {
				understanding_title_present: Boolean(understandingTitle),
				title_candidates_count: titleCandidates.length,
				boilerplate_key_hits: titleRes.title ? (boilerplate.has(normalizeForBoilerplate(titleRes.title)) ? 1 : 0) : 0,
			},
			resolved_slide_type: slideTypeRes.slide_type,
			resolved_slide_type_confidence: slideTypeRes.confidence,
			resolved_slide_type_source: slideTypeRes.source,
			resolved_summary: sumRes.summary,
			resolved_summary_confidence: sumRes.confidence,
			resolved_summary_source: sumRes.source,
			regions: regionsOut,
			key_metrics: keyMetricsOut,
		};

		await params.pool.query(
			`INSERT INTO document_page_understanding (document_id, deal_id, page_index, version, payload, created_at, updated_at)
			 VALUES ($1, $2, $3, $4, $5::jsonb, now(), now())
			 ON CONFLICT (document_id, page_index, version)
			 DO UPDATE SET
			   deal_id = EXCLUDED.deal_id,
			   payload = EXCLUDED.payload,
			   created_at = now(),
			   updated_at = now()`,
			[params.documentId, params.dealId ?? null, pageIndex, "page_understanding_v1", safeJsonStringify(payload)]
		);

		persisted += 1;
	}

	return { persisted_pages: persisted, attempted_pages: attempted };
}
