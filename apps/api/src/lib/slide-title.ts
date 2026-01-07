type NormBBox = { x: number; y: number; w: number; h: number } | null;

type LineCandidate = {
  raw: string;
  norm: string;
  bbox: NormBBox;
  lineIndex: number;
};

type SlideCandidateScore = {
  text: string;
  rawText: string;
  score: number;
  parts: string[];
  bbox: NormBBox;
  lineIndex: number;
  heading: string | null;
  brandRegionHit: boolean;
  brandOverlap: number;
};

export type OcrBBox = { x: number; y: number; w: number; h: number };

export type OcrBlock = {
  text?: string | null;
  value?: string | null;
  bbox?: OcrBBox | null;
  box?: OcrBBox | null;
  bounding_box?: OcrBBox | null;
  conf?: number | null;
  level?: "word" | "line";
  line_id?: string | number | null;
};

export type PageInput = {
  ocr_blocks?: OcrBlock[] | null;
  ocr_text?: string | null;
  page_width?: number | null;
  page_height?: number | null;
};

export type BrandRegion = { cx: number; cy: number; rx: number; ry: number };

export type BrandModel = {
  phrases: Set<string>;
  regions: BrandRegion[];
};

export type SlideTitleResult = {
  slide_title: string | null;
  slide_title_confidence: number;
  slide_title_source: "ocr_layout_v1" | "ocr_fallback" | "none";
  slide_title_warnings?: string[];
  slide_title_debug?: { candidates: Array<{ text: string; score: number; reasons: string[] }> };
};

export type SlideTitleInput = {
  blocks?: OcrBlock[] | null;
  ocr_text?: string | null;
  page_width?: number | null;
  page_height?: number | null;
  brandModel?: BrandModel;
  enableDebug?: boolean;
};

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

const DEFAULT_BLACKLIST = new Set<string>([
  "confidential",
  "confidentential",
  "confidential information",
  "draft",
  "internal use only",
  "all rights reserved",
  "pitch deck",
  "deck",
]);

const headingKeywords = [
  "problem",
  "market problem",
  "solution",
  "traction",
  "business model",
  "go-to-market",
  "go to market",
  "distribution",
  "team",
  "financials",
  "financial",
  "exit",
  "exit strategy",
  "acquirers",
  "call to action",
  "investment opportunity",
];

export function normalizePhrase(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .toLowerCase()
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[^a-z0-9\-\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isUrlEmailPhone(text: string): boolean {
  const s = text.trim().toLowerCase();
  const compact = s.replace(/[^a-z0-9]/g, "");
  if (/https?:\/\//.test(s)) return true;
  if (/www\./.test(s)) return true;
  if (/\bwww\b/.test(s) && /(com|io|ai|net|co)/.test(s)) return true;
  if (compact.startsWith("www") && /(com|io|ai|net|co)/.test(compact)) return true;
  if (/\S+@\S+\.\S+/.test(s)) return true;
  if (/tel:\d/.test(s)) return true;
  if (/\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/.test(s)) return true;
  return false;
}

function looksLikePageNumber(text: string): boolean {
  const s = text.trim().toLowerCase();
  return /^page\s*\d{1,4}$/.test(s) || /^\d{1,3}\s*\/\s*\d{1,3}$/.test(s);
}

function normalizeBlocks(blocks: OcrBlock[] | null | undefined, pageWidth?: number | null, pageHeight?: number | null): Array<{ raw: string; norm: string; bbox: NormBBox; level?: string; line_id?: string | number | null }> {
  if (!Array.isArray(blocks) || blocks.length === 0) return [];

  const parsed = blocks
    .map((b) => {
      const rawText = typeof b.text === "string" ? b.text : typeof b.value === "string" ? b.value : "";
      if (!rawText || !rawText.trim()) return null;
      const box = (b.bbox ?? b.box ?? b.bounding_box ?? {}) as any;
      const pick = (v: any): number | null => {
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
      };
      const x = pick(box.x ?? box.left ?? box.x0);
      const y = pick(box.y ?? box.top ?? box.y0);
      const w = pick(box.w ?? box.width);
      const h = pick(box.h ?? box.height);
      const x1 = pick(box.x1 ?? box.right);
      const y1 = pick(box.y1 ?? box.bottom);
      const resolvedW = w != null ? w : x != null && x1 != null ? Math.max(0, x1 - x) : null;
      const resolvedH = h != null ? h : y != null && y1 != null ? Math.max(0, y1 - y) : null;
      return {
        raw: rawText.trim(),
        norm: normalizePhrase(rawText),
        bbox: { x, y, w: resolvedW, h: resolvedH } as NormBBox,
        level: b.level,
        line_id: b.line_id,
      };
    })
    .filter(Boolean) as Array<{ raw: string; norm: string; bbox: NormBBox; level?: string; line_id?: string | number | null }>;

  const maxX = parsed.reduce((m, p) => {
    const x = p.bbox?.x ?? 0;
    const w = p.bbox?.w ?? 0;
    return Math.max(m, x + (w ?? 0));
  }, 0);
  const maxY = parsed.reduce((m, p) => {
    const y = p.bbox?.y ?? 0;
    const h = p.bbox?.h ?? 0;
    return Math.max(m, y + (h ?? 0));
  }, 0);

  const denomX = pageWidth && pageWidth > 0 ? pageWidth : maxX > 1.5 ? maxX : 1;
  const denomY = pageHeight && pageHeight > 0 ? pageHeight : maxY > 1.5 ? maxY : 1;

  return parsed.map((p) => {
    const nx = p.bbox?.x != null ? clamp(p.bbox.x / denomX, 0, 1) : null;
    const ny = p.bbox?.y != null ? clamp(p.bbox.y / denomY, 0, 1) : null;
    const nw = p.bbox?.w != null ? clamp((p.bbox.w ?? 0) / denomX, 0, 1) : null;
    const nh = p.bbox?.h != null ? clamp((p.bbox.h ?? 0) / denomY, 0, 1) : null;
    const bbox = nx == null || ny == null ? null : { x: nx, y: ny, w: nw ?? 0, h: nh ?? 0 };
    return { ...p, bbox };
  });
}

function groupLines(blocks: Array<{ raw: string; norm: string; bbox: NormBBox; level?: string; line_id?: string | number | null }>): LineCandidate[] {
  if (blocks.length === 0) return [];

  const lineBlocks = blocks.filter((b) => b.level === "line");
  if (lineBlocks.length > 0) {
    return lineBlocks
      .map((b, idx) => ({ raw: b.raw, norm: b.norm, bbox: b.bbox, lineIndex: idx }))
      .filter((l) => Boolean(l.norm));
  }

  const grouped = new Map<string, Array<typeof blocks[number]>>();
  for (const b of blocks) {
    const key = b.line_id != null ? String(b.line_id) : String(Math.round((b.bbox?.y ?? 0) / 0.02));
    const arr = grouped.get(key) ?? [];
    arr.push(b);
    grouped.set(key, arr);
  }

  const lines: LineCandidate[] = [];
  let idx = 0;
  for (const arr of grouped.values()) {
    const sorted = arr.slice().sort((a, b) => (a.bbox?.x ?? 0) - (b.bbox?.x ?? 0));
    const rawLine = sorted.map((s) => s.raw).join(" ").trim();
    const norm = normalizePhrase(rawLine);
    if (!norm) continue;
    const xs = sorted.map((s) => s.bbox?.x ?? 0);
    const ys = sorted.map((s) => s.bbox?.y ?? 0);
    const ws = sorted.map((s) => (s.bbox?.x ?? 0) + (s.bbox?.w ?? 0));
    const hs = sorted.map((s) => s.bbox?.h ?? 0).filter((v) => Number.isFinite(v));
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...ws);
    const hAvg = hs.length > 0 ? hs.reduce((a, b) => a + b, 0) / hs.length : 0;
    lines.push({ raw: rawLine, norm, bbox: { x: minX, y: minY, w: Math.max(0, maxX - minX), h: hAvg }, lineIndex: idx++ });
  }

  return lines.sort((a, b) => (a.bbox?.y ?? 0) - (b.bbox?.y ?? 0));
}

function extractLines(page: PageInput): LineCandidate[] {
  const normalizedBlocks = normalizeBlocks(page.ocr_blocks ?? null, page.page_width, page.page_height);
  const lineFromBlocks = groupLines(normalizedBlocks);
  if (lineFromBlocks.length > 0) return lineFromBlocks;

  const lines: LineCandidate[] = [];
  if (typeof page.ocr_text === "string") {
    let idx = 0;
    for (const rawLine of page.ocr_text.split(/\r?\n/)) {
      const norm = normalizePhrase(rawLine);
      if (!norm) continue;
      lines.push({ raw: rawLine.trim(), norm, bbox: null, lineIndex: idx++ });
    }
  }
  return lines;
}

function alphaRatio(text: string): number {
  const letters = (text.match(/[a-z]/gi) || []).length;
  return letters / Math.max(1, text.length);
}

function isMostlyNumeric(text: string): boolean {
  const digits = (text.match(/\d/g) || []).length;
  return digits / Math.max(1, text.length) > 0.5;
}

function tokenSet(value: string): Set<string> {
  return new Set(value.split(/\s+/).filter(Boolean));
}

function overlapRatio(text: string, phrases: Set<string>): number {
  const tokens = Array.from(tokenSet(text));
  if (tokens.length === 0) return 0;
  let best = 0;
  for (const phrase of phrases) {
    const phraseTokens = tokenSet(phrase);
    const inter = tokens.filter((t) => phraseTokens.has(t)).length;
    if (phraseTokens.size === 0) continue;
    const ratio = inter / phraseTokens.size;
    if (ratio > best) best = ratio;
  }
  return best;
}

function inBrandRegion(bbox: NormBBox, regions: BrandRegion[]): boolean {
  if (!bbox) return false;
  const cx = bbox.x + (bbox.w ?? 0) / 2;
  const cy = bbox.y + (bbox.h ?? 0) / 2;
  for (const r of regions) {
    const dx = r.rx > 0 ? (cx - r.cx) / r.rx : 0;
    const dy = r.ry > 0 ? (cy - r.cy) / r.ry : 0;
    if (dx * dx + dy * dy <= 1) return true;
  }
  return false;
}

export function buildBrandModel(pages: PageInput[]): BrandModel {
  if (!Array.isArray(pages) || pages.length === 0) return { phrases: new Set(DEFAULT_BLACKLIST), regions: [] };

  const phraseCounts = new Map<string, number>();
  const positions = new Map<string, Array<{ cx: number; cy: number; w: number; h: number }>>();

  pages.forEach((page) => {
    const lines = extractLines(page);
    const seen = new Set<string>();
    for (const line of lines) {
      const norm = normalizePhrase(line.norm);
      if (!norm || norm.length < 3 || norm.length > 120) continue;
      if (isUrlEmailPhone(norm) || looksLikePageNumber(norm)) continue;
      const isTop = line.bbox?.y != null ? line.bbox.y <= 0.5 : line.lineIndex <= 8;
      if (!isTop) continue;
      seen.add(norm);
      if (line.bbox) {
        const cx = line.bbox.x + (line.bbox.w ?? 0) * 0.5;
        const cy = line.bbox.y + (line.bbox.h ?? 0) * 0.5;
        const arr = positions.get(norm) ?? [];
        arr.push({ cx, cy, w: line.bbox.w ?? 0, h: line.bbox.h ?? 0 });
        positions.set(norm, arr);
      }
    }
    for (const n of seen) phraseCounts.set(n, (phraseCounts.get(n) ?? 0) + 1);
  });

  const pageCount = pages.length;
  const threshold = Math.max(2, Math.min(Math.ceil(pageCount * 0.35), 4));

  const phrases = new Set<string>(DEFAULT_BLACKLIST);
  const regions: BrandRegion[] = [];

  for (const [phrase, count] of phraseCounts.entries()) {
    if (count >= threshold) {
      phrases.add(phrase);
      const pts = positions.get(phrase) ?? [];
      if (pts.length >= 2) {
        const meanCx = pts.reduce((s, p) => s + p.cx, 0) / pts.length;
        const meanCy = pts.reduce((s, p) => s + p.cy, 0) / pts.length;
        const meanW = pts.reduce((s, p) => s + p.w, 0) / pts.length;
        const meanH = pts.reduce((s, p) => s + p.h, 0) / pts.length;
        const varCx = pts.reduce((s, p) => s + Math.pow(p.cx - meanCx, 2), 0) / pts.length;
        const varCy = pts.reduce((s, p) => s + Math.pow(p.cy - meanCy, 2), 0) / pts.length;
        const stdCx = Math.sqrt(varCx);
        const stdCy = Math.sqrt(varCy);
        if (stdCx <= 0.08 && stdCy <= 0.08) {
          regions.push({ cx: meanCx, cy: meanCy, rx: Math.min(0.3, Math.max(0.05, stdCx * 3 + meanW * 0.5)), ry: Math.min(0.3, Math.max(0.05, stdCy * 3 + meanH * 0.5)) });
        }
      }
    }
  }

  return { phrases, regions };
}

function scoreCandidate(line: LineCandidate, brandModel: BrandModel): SlideCandidateScore {
  const heading = headingKeywords.find((h) => line.norm.includes(h)) ?? null;
  const sizeScore = line.bbox?.h != null ? clamp((line.bbox.h ?? 0) * 8, 0, 2) : 0.3;
  const widthScore = line.bbox?.w != null ? clamp((line.bbox.w ?? 0) * 2, 0, 1.2) : 0.2;
  const topScore = line.bbox?.y != null ? clamp(0.7 - line.bbox.y * 1.4, 0, 0.7) : line.lineIndex === 0 ? 0.4 : 0;
  const centerBias = line.bbox?.x != null && line.bbox?.w != null ? clamp(0.3 - Math.abs(line.bbox.x + (line.bbox.w ?? 0) / 2 - 0.5), -0.1, 0.3) : 0;
  const headingBoost = heading ? 1.2 : 0;
  const brandOverlap = overlapRatio(line.norm, brandModel.phrases);
  const brandPenalty = brandOverlap >= 0.7 ? -2 : brandOverlap >= 0.5 ? -1.2 : brandOverlap >= 0.3 ? -0.6 : 0;
  const brandRegionHit = inBrandRegion(line.bbox, brandModel.regions);
  const regionPenalty = brandRegionHit ? -1.2 : 0;
  const alphaScore = alphaRatio(line.norm) < 0.3 ? -0.8 : 0;

  const score = sizeScore + widthScore + topScore + centerBias + headingBoost + brandPenalty + regionPenalty + alphaScore;

  const parts: string[] = [];
  if (heading) parts.push(`heading:${heading}`);
  if (sizeScore) parts.push(`size:${sizeScore.toFixed(2)}`);
  if (widthScore) parts.push(`width:${widthScore.toFixed(2)}`);
  if (topScore) parts.push(`top:${topScore.toFixed(2)}`);
  if (centerBias) parts.push(`center:${centerBias.toFixed(2)}`);
  if (brandPenalty) parts.push(`brand_penalty:${brandPenalty.toFixed(2)}`);
  if (regionPenalty) parts.push("brand_region");
  if (alphaScore < 0) parts.push("low_alpha");

  return { text: line.norm, rawText: line.raw, score, parts, bbox: line.bbox, lineIndex: line.lineIndex, heading, brandRegionHit, brandOverlap };
}

export function inferSlideTitleForSlide(input: SlideTitleInput): SlideTitleResult {
  const brandModel: BrandModel = input.brandModel ?? { phrases: new Set(DEFAULT_BLACKLIST), regions: [] };
  const hasLayoutBlocks = Array.isArray(input.blocks) && input.blocks.length > 0;
  const lines = extractLines({ ocr_blocks: input.blocks ?? null, ocr_text: input.ocr_text ?? null, page_width: input.page_width, page_height: input.page_height });

  const candidates: SlideCandidateScore[] = [];
  const altCandidates: SlideCandidateScore[] = [];
  for (const line of lines) {
    const len = line.norm.length;
    if (len < 3 || len > 120) continue;
    if (isUrlEmailPhone(line.norm) || looksLikePageNumber(line.norm)) continue;
    if (isMostlyNumeric(line.norm)) continue;
    const alpha = alphaRatio(line.norm);
    if (alpha < 0.25) continue;
    const topPortion = line.bbox?.y != null ? line.bbox.y < 0.35 : line.lineIndex <= 6;
    const sc = scoreCandidate(line, brandModel);
    const isBrandPhrase = brandModel.phrases.has(line.norm);
    if (topPortion && !isBrandPhrase) {
      candidates.push(sc);
    } else if (!isBrandPhrase) {
      altCandidates.push(sc);
    }
  }

  const byHeight = (arr: SlideCandidateScore[]) => arr.slice().sort((a, b) => (b.bbox?.h ?? 0) - (a.bbox?.h ?? 0));
  const tallest = byHeight([...candidates, ...altCandidates])[0];
  const tallestHeight = tallest?.bbox?.h ?? 0;

  const filtered = candidates.filter((c) => !(c.brandRegionHit && (c.bbox?.h ?? 0) < tallestHeight * 0.9));
  filtered.sort((a, b) => b.score - a.score || (a.bbox?.y ?? 0) - (b.bbox?.y ?? 0));

  let pick = filtered[0] ?? null;
  if (!pick) {
    const nonBrandFallback = altCandidates.filter((c) => c.brandOverlap < 0.3 && !c.brandRegionHit && !brandModel.phrases.has(c.text));
    nonBrandFallback.sort((a, b) => (b.bbox?.h ?? 0) - (a.bbox?.h ?? 0) || b.score - a.score);
    pick = nonBrandFallback[0] ?? null;
  }

  if (!pick) {
    return { slide_title: null, slide_title_confidence: 0, slide_title_source: "none" };
  }

  const runner = filtered[1] ?? null;
  const margin = runner ? pick.score - runner.score : pick.score;
  const scoreScale = clamp(pick.score / 5, 0, 1);
  let confidence = clamp(0.35 + scoreScale * 0.45 + clamp(margin, 0, 2) * 0.1, 0, 1);
  if (pick.brandRegionHit) confidence = Math.min(confidence, 0.65);
  if (pick.brandOverlap > 0.4) confidence = Math.min(confidence, 0.55);

  const result: SlideTitleResult = {
    slide_title: pick.rawText || pick.text,
    slide_title_confidence: Number(confidence.toFixed(3)),
    slide_title_source: hasLayoutBlocks ? "ocr_layout_v1" : "ocr_fallback",
  };

  if (input.enableDebug) {
    result.slide_title_debug = {
      candidates: [...filtered, ...altCandidates]
        .slice(0, 12)
        .map((c) => ({ text: c.rawText || c.text, score: Number(c.score.toFixed(3)), reasons: c.parts })),
    };
  }

  return result;
}

export function inferSlideTitleForDocument(pages: PageInput[]): { brandModel: BrandModel; titles: SlideTitleResult[] } {
  const brandModel = buildBrandModel(pages);
  const titles = pages.map((p) => inferSlideTitleForSlide({ blocks: p.ocr_blocks ?? null, ocr_text: p.ocr_text ?? null, page_height: p.page_height, page_width: p.page_width, brandModel }));
  return { brandModel, titles };
}

export function inferDocumentBrandName(pages: PageInput[]): { brand_name: string | null; confidence: number | null } {
  if (!Array.isArray(pages) || pages.length === 0) return { brand_name: null, confidence: null };
  const counts = new Map<string, number>();

  for (const page of pages) {
    const lines = extractLines(page);
    const topLines = lines.filter((l) => (l.bbox?.y != null ? l.bbox.y <= 0.25 : l.lineIndex <= 4));
    const pageSet = new Set<string>();
    for (const line of topLines) {
      if (!line.norm || line.norm.length < 3 || line.norm.length > 60) continue;
      if (isUrlEmailPhone(line.norm) || looksLikePageNumber(line.norm)) continue;
      if (DEFAULT_BLACKLIST.has(line.norm)) continue;
      pageSet.add(line.norm);
    }
    for (const n of pageSet) counts.set(n, (counts.get(n) ?? 0) + 1);
  }

  let best: { text: string; count: number } | null = null;
  const pagesCount = pages.length;
  const threshold = Math.max(2, Math.ceil(pagesCount * 0.35));
  for (const [text, count] of counts.entries()) {
    if (count < threshold) continue;
    if (!best || count > best.count) best = { text, count };
  }
  if (!best) return { brand_name: null, confidence: null };
  const confidence = clamp(0.5 + (best.count / pagesCount) * 0.45, 0, 0.95);
  return { brand_name: best.text, confidence: Number(confidence.toFixed(3)) };
}

// Backward compatibility exports
export function buildBrandBlacklistForDocument(pages: PageInput[]): Set<string> {
  return buildBrandModel(pages).phrases;
}

export const buildBrandBlacklist = buildBrandBlacklistForDocument;

export function inferSlideTitle(params: { ocr_blocks?: unknown; ocr_text?: string | null; page_index?: number | null; doc_brand_blacklist: Set<string>; brand_name?: string | null; enableDebug?: boolean }): SlideTitleResult {
  const brandModel: BrandModel = { phrases: new Set(params.doc_brand_blacklist ?? []), regions: [] };
  if (params.brand_name) brandModel.phrases.add(normalizePhrase(params.brand_name));
  return inferSlideTitleForSlide({ blocks: Array.isArray(params.ocr_blocks) ? (params.ocr_blocks as OcrBlock[]) : null, ocr_text: params.ocr_text ?? null, brandModel, enableDebug: params.enableDebug });
}
