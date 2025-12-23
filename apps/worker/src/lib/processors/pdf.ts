import * as pdfjs from "pdfjs-dist/legacy/build/pdf.js";
import { createCanvas, Image, ImageData } from "@napi-rs/canvas";
import path from "path";
import fs from "fs/promises";
import crypto from "crypto";
import Tesseract from "tesseract.js";

(pdfjs as any).GlobalWorkerOptions.disableWorker = true;

// pdf.js render needs ImageData in the Node runtime
if (typeof (global as any).ImageData === "undefined") {
  (global as any).ImageData = ImageData;
}

// Some PDF assets rely on Image being present in the runtime
if (typeof (global as any).Image === "undefined") {
  (global as any).Image = Image;
}

const canvasFactory = {
  create(width: number, height: number) {
    const canvas = createCanvas(Math.ceil(width), Math.ceil(height));
    return { canvas, context: canvas.getContext("2d") } as const;
  },
  reset(canvasAndContext: { canvas: any }, width: number, height: number) {
    canvasAndContext.canvas.width = Math.ceil(width);
    canvasAndContext.canvas.height = Math.ceil(height);
  },
  destroy(canvasAndContext: { canvas: any; context?: any }) {
    canvasAndContext.canvas = null as any;
    canvasAndContext.context = null as any;
  },
};

const PDF_TIMEOUT_MS = 30000;
// Process up to 30 pages to avoid clipping larger decks while keeping work bounded
const PDF_MAX_PAGES = 30;
// For visual-heavy decks, allow OCR over all processed pages when text is sparse.
const PDF_OCR_MAX_PAGES = PDF_MAX_PAGES;
const OCR_TIMEOUT_MS = 120000;
const OCR_BASE_RENDER_SCALE = 4; // Higher DPI render for image-heavy slides
const OCR_MAX_RENDER_SCALE = 6; // Upper guard to avoid runaway memory
const OCR_MIN_TARGET_DIM = 1400; // Aim for at least this pixel dimension on the long side
const OCR_CONTRAST = 1.2; // Simple contrast boost during preprocessing
const OCR_THRESHOLD = 180; // Binarize after contrast to reduce backgrounds
const DEBUG_ENABLED = process.env.PDF_EXTRACT_DEBUG === "1";

// Tesseract/Leptonica can emit noisy warnings like:
// "Image too small to scale!!" / "Line cannot be recognized!!"
// These are generally benign (from tiny intermediate components), but they spam logs.
function withSilencedTesseractNoise<T>(fn: () => Promise<T>): Promise<T> {
  const patterns = ["Image too small to scale!!", "Line cannot be recognized!!"];

  const origStdoutWrite = process.stdout.write.bind(process.stdout);
  const origStderrWrite = process.stderr.write.bind(process.stderr);

  const filterWrite = (orig: typeof process.stdout.write) => {
    return ((chunk: any, encoding?: any, cb?: any) => {
      try {
        const s =
          typeof chunk === "string"
            ? chunk
            : Buffer.isBuffer(chunk)
              ? chunk.toString("utf8")
              : String(chunk);
        if (patterns.some((p) => s.includes(p))) {
          if (typeof cb === "function") cb();
          return true;
        }
      } catch {
        // ignore
      }
      return orig(chunk as any, encoding as any, cb as any) as any;
    }) as any;
  };

  (process.stdout as any).write = filterWrite(origStdoutWrite);
  (process.stderr as any).write = filterWrite(origStderrWrite);

  return fn().finally(() => {
    (process.stdout as any).write = origStdoutWrite;
    (process.stderr as any).write = origStderrWrite;
  });
}

type DebugPageMeta = {
  pageNumber: number;
  mode: "text" | "ocr";
  provider?: "tesseract";
  pdfWordCount?: number;
  ocrWordCount?: number;
  slideTitle?: string;
  metricsSample: Array<{ value: string; label: string; conf?: number }>;
  renderScale?: number;
  regions?: number;
  skippedRegions?: number;
  titleDebug?: { topWordsSample: string[]; anchor?: string; filteredCount: number };
};

function isBoilerplate(text: string): boolean {
  const lower = (text || "").toLowerCase();
  return (
    /https?:\/\//.test(lower) ||
    /www\./.test(lower) ||
    /@/.test(lower) ||
    /\d{3}[\s.-]?\d{3}[\s.-]?\d{4}/.test(lower)
  );
}

function isLikelyGoodTitle(title: string): boolean {
  const raw = (title || "").replace(/\s+/g, " ").trim();
  if (!raw) return false;

  const t = stripLogoPrefix(raw);

  if (t.length < 10) return false;
  if (t.length > 120) return false;
  if (!/\b[a-zA-Z]{3,}\b/.test(t)) return false;

  const words = t.split(/\s+/).filter(Boolean);
  if (words.length < 2) return false;

  const punct = (t.match(/[\]\[\)\(\{\}\|<>\\]/g) || []).length;
  if (punct >= 2) return false;

  const letters = (t.match(/[A-Za-z]/g) || []).length;
  if (letters / Math.max(1, t.length) < 0.55) return false;

  if (isBoilerplate(t)) return false;

  const allCapsRuns = (t.match(/\b[A-Z]{3,}\b/g) || []).length;
  const realWords = (t.match(/\b[a-zA-Z]{3,}\b/g) || []).length;
  if (allCapsRuns >= 5 && realWords < 3) return false;

  // kill the specific junk you're seeing
  if (/\buse\)\b/i.test(t)) return false;

  return true;
}

function extractSlideTitle(
  words: Array<{ text: string; x: number; y: number; width: number; height: number; conf?: number }>,
  pageHeight?: number
): string {
  if (!words.length) return "";

  const topLimit = pageHeight ? pageHeight * 0.25 : Number.POSITIVE_INFINITY;
  const topWords = words.filter((w) => w.text && w.y <= topLimit && w.height > 0);
  if (!topWords.length) return "";

  const sorted = [...topWords].sort((a, b) => {
    const hDiff = b.height - a.height;
    if (Math.abs(hDiff) > 0.1) return hDiff;
    return (b.conf ?? 0) - (a.conf ?? 0);
  });

  const anchor = sorted[0];
  const anchorY = anchor.y;
  const anchorH = anchor.height || 1;

  const lineOne = sorted.filter((w) => {
    const txt = (w.text || "").trim();
    if (!txt) return false;
    if (txt.length <= 1) return false;
    if (w.conf !== undefined && w.conf < 50) return false;
    if (w.height < 8) return false;
    if (isBoilerplate(txt)) return false;
    return Math.abs(w.y - anchorY) <= anchorH * 0.8;
  });

  lineOne.sort((a, b) => a.x - b.x);
  const titleLineWords = [...lineOne];

  if (titleLineWords.length < 3) {
    const secondLine = sorted.filter((w) => {
      const txt = (w.text || "").trim();
      if (!txt) return false;
      if (txt.length <= 1) return false;
      if (w.conf !== undefined && w.conf < 50) return false;
      if (w.height < 8) return false;
      if (isBoilerplate(txt)) return false;
      if (Math.abs(w.y - anchorY) <= anchorH * 0.8) return false;
      return w.y >= anchorY && Math.abs(w.y - anchorY) <= anchorH * 1.3;
    });

    if (secondLine.length) {
      const merged = [...lineOne, ...secondLine].sort((a, b) => {
        const yDiff = a.y - b.y;
        if (Math.abs(yDiff) > anchorH * 0.2) return yDiff;
        return a.x - b.x;
      });
      const mergedLine = merged.map((w) => (w.text || "").trim()).join(" ").trim();
      if (mergedLine.split(/\s+/).length >= titleLineWords.length) {
        return mergedLine;
      }
    }
  }

  return titleLineWords.map((w) => (w.text || "").trim()).join(" ").trim();
}

function computeOcrScale(page: pdfjs.PDFPageProxy): number {
  const [, , width, height] = page.view;
  const maxDim = Math.max(width, height);
  const scaleForTarget = Math.ceil(OCR_MIN_TARGET_DIM / Math.max(1, maxDim));
  const chosen = Math.max(OCR_BASE_RENDER_SCALE, scaleForTarget);
  return Math.min(OCR_MAX_RENDER_SCALE, chosen);
}

function normalizeConfidence(conf: unknown): number {
  const num = Number(conf ?? 0);
  if (Number.isNaN(num)) return 0;
  if (num <= 1) return Math.max(0, Math.min(100, num * 100));
  return Math.max(0, Math.min(100, num));
}

function normalizeBoilerplateText(input: string): string {
  return (input || "")
    .toLowerCase()
    .replace(/[^a-z0-9@\.\/\:\-\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTitleKey(input: string): string {
  return (input || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripLogoPrefix(title: string): string {
  const t = (title || "").replace(/\s+/g, " ").trim();
  const m = t.match(/^([a-zA-Z]{1,3})\s+(.{6,})$/);
  if (!m) return t;

  const rest = m[2].trim();
  // only strip if remainder looks like a real title
  if ((rest.match(/\b[a-zA-Z]{3,}\b/g) || []).length >= 2) return rest;
  return t;
}

function isGarbledContext(ctx: string): boolean {
  const c = (ctx || "").replace(/\s+/g, " ").trim();
  if (!c) return true;

  // Very long contexts from OCR are often garbage (we prefer short labels).
  // In practice, metric "labels" should be fairly short; long spans tend to be sentence-like OCR soup.
  if (c.length > 90) return true;

  const letters = (c.match(/[A-Za-z]/g) || []).length;
  const digits = (c.match(/[0-9]/g) || []).length;
  const spaces = (c.match(/\s/g) || []).length;

  // Allowed characters for a "label-ish" context.
  const allowed = (c.match(/[A-Za-z0-9\s\-–%\$\.,\/:]/g) || []).length;
  const allowedRatio = allowed / Math.max(1, c.length);

  // Hard reject for too little real text.
  if (letters < 4) return true;

  // If OCR produced lots of weird glyphs, treat as garbage.
  if (allowedRatio < 0.82) return true;

  // Too dense (no spaces) tends to be OCR junk.
  if (spaces < 2 && c.length > 25) return true;

  // Lots of digit noise with few letters tends to be OCR debris.
  if (digits > 0 && letters / Math.max(1, digits) < 0.6 && c.length > 25) return true;

  // Structural junk.
  if (/[|\\]{2,}/.test(c)) return true;
  if (/[\[\]\{\}<>]/.test(c)) return true;
  if (/[_]{3,}/.test(c)) return true;

  // Excessive all-caps runs are usually broken OCR (e.g. "GTA MORTON SOTUTIONS").
  const capsRuns = (c.match(/\b[A-Z]{3,}\b/g) || []).length;
  if (capsRuns >= 4 && c.length > 30) return true;

  // Lots of 1-char tokens is usually garbage.
  const tokens = c.split(/\s+/).filter(Boolean);
  const oneChar = tokens.filter((t) => t.length === 1).length;
  if (tokens.length >= 6 && oneChar / tokens.length > 0.35) return true;

  // Run-on fragments (lots of tokens) are rarely "labels".
  if (tokens.length > 12) return true;

  return false;
}

type Region = { x: number; y: number; w: number; h: number };

function isNumericValue(text: string): boolean {
  return /(?:\$[\d,]+(?:\.\d+)?(?:%|[kmb]|x)?|[\d,]+(?:\.\d+)?(?:%|[kmb]|x)|\d+\s*[–-]\s*\d+(?:%|[kmb]|x)?)/i.test(
    text
  );
}

function extractMetrics(
  words: Array<{ text: string; x: number; y: number; width: number; height: number; conf?: number }>,
  maxLabelWords = 10
): Array<{ value: string; label: string; x: number; y: number; conf?: number }> {
  const metrics: Array<{ value: string; label: string; x: number; y: number; conf?: number }> = [];
  const seen = new Set<string>();
  for (const w of words) {
    if (!isNumericValue(w.text)) continue;
    const yBand = w.height * 0.75 + 8;
    const bandWords = words
      .filter((o) => o !== w && Math.abs(o.y - w.y) <= yBand && o.x >= w.x - 120 && o.x <= w.x + w.width + 120)
      .sort((a, b) => a.x - b.x);
    const labelWords: string[] = [];
    for (const o of bandWords) {
      const t = (o.text || "").trim();
      if (!t || isNumericValue(t) || isBoilerplate(t)) continue;
      labelWords.push(t);
      if (labelWords.length >= maxLabelWords) break;
    }
    const label = labelWords.join(" ").trim();
    if (!label) continue;
    const key = `${w.text.toLowerCase()}::${label.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    metrics.push({ value: w.text, label, x: w.x, y: w.y, conf: w.conf });
  }
  return metrics;
}

// Detect coarse text regions by edge density on a downscaled image.
function detectTextRegions(imageData: ImageData, width: number, height: number): Region[] {
  const target = 256;
  const scale = Math.max(1, Math.max(width, height) / target);
  const dw = Math.max(16, Math.floor(width / scale));
  const dh = Math.max(16, Math.floor(height / scale));
  const edges = new Uint8Array(dw * dh);

  // Downsample and compute simple gradient magnitude.
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const srcX = Math.min(width - 1, Math.floor(x * scale));
      const srcY = Math.min(height - 1, Math.floor(y * scale));
      const idx = (srcY * width + srcX) * 4;
      const g = 0.299 * imageData.data[idx] + 0.587 * imageData.data[idx + 1] + 0.114 * imageData.data[idx + 2];

      const srcX2 = Math.min(width - 1, srcX + 1);
      const srcY2 = Math.min(height - 1, srcY + 1);
      const idxR = (srcY * width + srcX2) * 4;
      const idxD = (srcY2 * width + srcX) * 4;
      const gR = 0.299 * imageData.data[idxR] + 0.587 * imageData.data[idxR + 1] + 0.114 * imageData.data[idxR + 2];
      const gD = 0.299 * imageData.data[idxD] + 0.587 * imageData.data[idxD + 1] + 0.114 * imageData.data[idxD + 2];
      const grad = Math.abs(g - gR) + Math.abs(g - gD);
      edges[y * dw + x] = grad > 40 ? 1 : 0;
    }
  }

  // Connected components on binary edge map.
  const visited = new Uint8Array(dw * dh);
  const regions: Region[] = [];
  const directions = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];

  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      const idx = y * dw + x;
      if (visited[idx] || edges[idx] === 0) continue;
      let minX = x,
        maxX = x,
        minY = y,
        maxY = y,
        count = 0;
      const stack = [[x, y]];
      visited[idx] = 1;
      while (stack.length) {
        const [cx, cy] = stack.pop()!;
        count++;
        minX = Math.min(minX, cx);
        maxX = Math.max(maxX, cx);
        minY = Math.min(minY, cy);
        maxY = Math.max(maxY, cy);
        for (const [dx, dy] of directions) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= dw || ny >= dh) continue;
          const nidx = ny * dw + nx;
          if (visited[nidx] || edges[nidx] === 0) continue;
          visited[nidx] = 1;
          stack.push([nx, ny]);
        }
      }

      // Skip tiny components.
      if (count < 20) continue;
      regions.push({ x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 });
    }
  }

  // Merge close/overlapping regions.
  const merged: Region[] = [];
  for (const r of regions) {
    let mergedFlag = false;
    for (const m of merged) {
      const close = r.x <= m.x + m.w + 4 && m.x <= r.x + r.w + 4 && r.y <= m.y + m.h + 4 && m.y <= r.y + r.h + 4;
      if (close) {
        const nx = Math.min(m.x, r.x);
        const ny = Math.min(m.y, r.y);
        const nx2 = Math.max(m.x + m.w, r.x + r.w);
        const ny2 = Math.max(m.y + m.h, r.y + r.h);
        m.x = nx;
        m.y = ny;
        m.w = nx2 - nx;
        m.h = ny2 - ny;
        mergedFlag = true;
        break;
      }
    }
    if (!mergedFlag) merged.push({ ...r });
  }

  // Scale back to original coords and filter.
  const minW = width * 0.03;
  const minH = height * 0.02;
  const maxW = width * 0.95;
  const maxH = height * 0.5;
  const footerY = height * 0.88;

  const scaled = merged
    .map((r) => ({
      x: Math.max(0, Math.floor(r.x * scale)),
      y: Math.max(0, Math.floor(r.y * scale)),
      w: Math.min(width, Math.ceil(r.w * scale)),
      h: Math.min(height, Math.ceil(r.h * scale)),
    }))
    .filter((r) => r.w >= minW && r.h >= minH && r.w <= maxW && r.h <= maxH && r.y + r.h < footerY);


// Sort by area desc and cap to 12 regions.
  return scaled.sort((a, b) => b.w * b.h - a.w * a.h).slice(0, 12);
}

function withTimeout<T>(promise: Promise<T>, label: string, ms = PDF_TIMEOUT_MS): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}


export interface PDFContent {
  metadata: {
    title?: string;
    author?: string;
    subject?: string;
    creationDate?: string;
    pages: number;
  };
  pages: Array<{
    pageNumber: number;
    text: string;
    slideTitle?: string;
    words: Array<{
      text: string;
      x: number;
      y: number;
      width: number;
      height: number;
      conf: number;
    }>;
    metrics: Array<{ value: string; label: string; x: number; y: number; conf?: number }>;
    tables: Array<{
      rows: string[][];
      confidence: number;
    }>;
  }>;
  summary: {
    totalWords: number;
    totalPages: number;
    processedPages: number;
    mainHeadings: string[];
    keyNumbers: Array<{ value: string; context: string }>;
    textItems: number;
    ocrUsed?: boolean;
  };
}

type PreprocessMode = "none" | "basic";
async function renderPageToCanvas(
  page: pdfjs.PDFPageProxy,
  scale = 2,
  preprocessMode: PreprocessMode = "none",
  captureDebugImages = false
): Promise<{ canvas: any; context: any; imageData: ImageData; rawPng?: Buffer; prePng?: Buffer }> {
  const viewport = page.getViewport({ scale });
  const { canvas, context } = canvasFactory.create(viewport.width, viewport.height);

  const renderContext = {
    canvasContext: context as any,
    viewport,
    canvasFactory,
  };

  await withTimeout(page.render(renderContext).promise, "pdf render", PDF_TIMEOUT_MS);

  let rawPng: Buffer | undefined;
  let prePng: Buffer | undefined;

  if (captureDebugImages && DEBUG_ENABLED) {
    rawPng = canvas.toBuffer("image/png");
  }

  if (preprocessMode === "basic") {
    // Grayscale + linear contrast + binarize to improve OCR on busy slides.
    const img = context.getImageData(0, 0, canvas.width, canvas.height);
    const data = img.data;
    const gain = OCR_CONTRAST;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      const contrasted = Math.min(255, Math.max(0, (gray - 128) * gain + 128));
      const value = contrasted >= OCR_THRESHOLD ? 255 : 0;
      data[i] = value;
      data[i + 1] = value;
      data[i + 2] = value;
    }
    context.putImageData(img, 0, 0);
  }

  if (captureDebugImages && DEBUG_ENABLED) {
    prePng = canvas.toBuffer("image/png");
  }

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  return { canvas, context, imageData, rawPng, prePng };
}

async function ocrPage(
  page: pdfjs.PDFPageProxy,
  pageNumber: number,
  captureDebug = false
): Promise<
  OCRResult & {
    rawPng?: Buffer;
    prePng?: Buffer;
    regions?: Region[];
    scale: number;
    provider: "tesseract";
    imageWidth: number;
    imageHeight: number;
    skippedRegions: number;
  }
> {
  const scale = computeOcrScale(page);
  const { canvas, imageData, rawPng, prePng } = await renderPageToCanvas(page, scale, "basic", captureDebug);

  const regions = detectTextRegions(imageData, canvas.width, canvas.height);
  const aggregateWords: OCRResult["words"] = [];
  const textParts: string[] = [];
  let skippedRegions = 0;

  const processResult = (data: any, offsetX = 0, offsetY = 0) => {
    const words = (data.words || [])
      .map((w: any) => {
        const width = Number((w.bbox?.x1 ?? 0) - (w.bbox?.x0 ?? 0));
        const height = Number((w.bbox?.y1 ?? 0) - (w.bbox?.y0 ?? 0));
        const conf = normalizeConfidence(w.confidence ?? w.conf ?? 0);
        const text = (w.text || "").trim();
        return {
          text,
          x: Number(w.bbox?.x0 ?? 0) + offsetX,
          y: Number(w.bbox?.y0 ?? 0) + offsetY,
          width,
          height,
          conf,
        };
      })
      .filter(
        (w: { text: string; width: number; height: number; conf: number }) =>
          w.text.length > 0 && w.width > 0 && w.height > 0 && w.height >= 8 && w.conf >= 50
      );

    aggregateWords.push(...words);
    if (data.text) textParts.push(data.text);
  };

  if (regions.length === 0) {
    const fullPng = canvas.toBuffer("image/png");
    const { data } = await withTimeout(
      withSilencedTesseractNoise(() => Tesseract.recognize(fullPng, "eng", { logger: () => {} })),
      `ocr page ${pageNumber}`,
      OCR_TIMEOUT_MS
    );
    processResult(data, 0, 0);
  } else {
    for (const region of regions) {
      // Hard-guard small crops (prevents `Image too small to scale!!`).
      if (region.w < 60 || region.h < 25) {
        skippedRegions++;
        continue;
      }
      // Skip ultra-wide, banner-like regions unless they are near the top.
      if (region.w / Math.max(1, region.h) > 25 && region.y >= canvas.height * 0.25) {
        skippedRegions++;
        continue;
      }

      const crop = createCanvas(region.w, region.h);
      const ctx = crop.getContext("2d");
      ctx.drawImage(canvas, region.x, region.y, region.w, region.h, 0, 0, region.w, region.h);
      const png = crop.toBuffer("image/png");
      const { data } = await withTimeout(
        withSilencedTesseractNoise(() => Tesseract.recognize(png, "eng", { logger: () => {} })),
        `ocr page ${pageNumber} region`,
        OCR_TIMEOUT_MS
      );
      processResult(data, region.x, region.y);
    }
  }

  return {
    text: textParts.join(" ").replace(/\s+/g, " ").trim(),
    words: aggregateWords,
    rawPng: captureDebug ? rawPng : undefined,
    prePng: captureDebug ? prePng : undefined,
    regions,
    scale,
    provider: "tesseract",
    imageWidth: canvas.width,
    imageHeight: canvas.height,
    skippedRegions,
  };
}

async function writeDebugPage(options: {
  dir: string;
  pageNumber: number;
  meta: DebugPageMeta;
  rawPng?: Buffer;
  prePng?: Buffer;
}) {
  if (!DEBUG_ENABLED) return;
  const base = path.join(options.dir, `page_${String(options.pageNumber).padStart(3, "0")}`);
  const tasks: Array<Promise<unknown>> = [];
  tasks.push(fs.writeFile(`${base}.json`, JSON.stringify(options.meta, null, 2)));
  if (options.rawPng) tasks.push(fs.writeFile(`${base}_raw.png`, options.rawPng));
  if (options.prePng) tasks.push(fs.writeFile(`${base}_pre.png`, options.prePng));
  try {
    await Promise.all(tasks);
  } catch (err) {
    console.error("[pdf][debug] failed to write page debug", err);
  }
}

async function writeDebugSummary(dir: string, summary: Record<string, unknown>) {
  if (!DEBUG_ENABLED) return;
  try {
    await fs.writeFile(path.join(dir, "summary.json"), JSON.stringify(summary, null, 2));
  } catch (err) {
    console.error("[pdf][debug] failed to write summary", err);
  }
}

async function extractWithTextThenOcr(worker: pdfjs.PDFDocumentProxy, processedPages: number, debugDir?: string) {
  const pages: PDFContent["pages"] = [];
  const allWords: string[] = [];
  const slideTitles: string[] = [];
  const numbers: Array<{ value: string; context: string }> = [];
  let textItemsCount = 0;
  let usedOcr = false;
  const debugRecords: DebugPageMeta[] = [];

  for (let i = 1; i <= processedPages; i++) {
    const page = await withTimeout(worker.getPage(i), `pdf page ${i}`);
    const [, , , pageHeight] = page.view;
    const textContent = await withTimeout(page.getTextContent(), `pdf text ${i}`);

    const words = (textContent.items as Array<any>)
      .filter(
        (item): item is { str: string; transform: number[]; width: number; height: number } =>
          typeof item?.str === "string" &&
          Array.isArray(item?.transform) &&
          typeof item?.width === "number" &&
          typeof item?.height === "number"
      )
      .map((item) => ({
        text: item.str,
        x: item.transform[4],
        y: item.transform[5],
        width: item.width,
        height: item.height,
        conf: 100,
      }));

    const slideTitle = extractSlideTitle(words, pageHeight);
    if (isLikelyGoodTitle(slideTitle)) {
      slideTitles.push(stripLogoPrefix(slideTitle));
    }

    textItemsCount += words.length;
    const pageText = words.map((w) => w.text).join(" ");
    const cleanTokens = pageText.split(/\s+/).filter(Boolean);
    allWords.push(...cleanTokens);

    const numberMatches = pageText.matchAll(/(\$[\d,]+(?:\.\d{2})?|[\d,]+(?:\.\d{2})?%|[\d,]+(?:\.\d+)?[KMB]?)/g);
    for (const match of numberMatches) {
      if (!isNumericValue(match[0])) continue;
      const idx = pageText.indexOf(match[0]);
      const contextStart = Math.max(0, idx - 50);
      const contextEnd = Math.min(pageText.length, idx + 50);
      const context = pageText.substring(contextStart, contextEnd).trim();
      numbers.push({ value: match[0], context });
    }

    pages.push({
      pageNumber: i,
      text: pageText,
      slideTitle,
      words,
      metrics: extractMetrics(words),
      tables: [],
    });
  }

  const hasText = allWords.length >= 20 || textItemsCount >= 20;
  if (!hasText) {
    const ocrPages = Math.min(processedPages, PDF_OCR_MAX_PAGES);
    pages.length = 0;
    allWords.length = 0;
    numbers.length = 0;
    textItemsCount = 0;
    usedOcr = true;

    for (let i = 1; i <= ocrPages; i++) {
      const page = await withTimeout(worker.getPage(i), `pdf page ${i}`);
      const ocr = await ocrPage(page, i, DEBUG_ENABLED);
      const tokens = ocr.text.split(/\s+/).filter(Boolean);
      allWords.push(...tokens);
      textItemsCount += ocr.words.length;

      const slideTitle = extractSlideTitle(ocr.words, ocr.imageHeight);
      let titleDebug: DebugPageMeta["titleDebug"];
      if (DEBUG_ENABLED && !slideTitle) {
        const topLimit = ocr.imageHeight ? ocr.imageHeight * 0.25 : Number.POSITIVE_INFINITY;
        const topWords = ocr.words.filter((w) => w.text && w.y <= topLimit);
        const filteredTop = topWords.filter((w) => w.height >= 8 && (w.conf ?? 0) >= 50 && !isBoilerplate(w.text));
        const sortedTop = filteredTop.slice().sort((a, b) => {
          const hDiff = b.height - a.height;
          if (Math.abs(hDiff) > 0.1) return hDiff;
          return (b.conf ?? 0) - (a.conf ?? 0);
        });
        const anchor = sortedTop[0];
        const topWordsSample = sortedTop.slice(0, 6).map((w) => w.text);
        titleDebug = {
          topWordsSample,
          anchor: anchor?.text,
          filteredCount: filteredTop.length,
        };
      }

      if (isLikelyGoodTitle(slideTitle)) {
        slideTitles.push(stripLogoPrefix(slideTitle));
      }

      const numberMatches = ocr.text.matchAll(/(\$[\d,]+(?:\.\d{2})?|[\d,]+(?:\.\d{2})?%|[\d,]+(?:\.\d+)?[KMB]?)/g);
      for (const match of numberMatches) {
        if (!isNumericValue(match[0])) continue;
        const idx = ocr.text.indexOf(match[0]);
        const contextStart = Math.max(0, idx - 50);
        const contextEnd = Math.min(ocr.text.length, idx + 50);
        const context = ocr.text.substring(contextStart, contextEnd).trim();
        numbers.push({ value: match[0], context });
      }

      const metrics = extractMetrics(ocr.words);

      pages.push({
        pageNumber: i,
        text: ocr.text,
        slideTitle,
        words: ocr.words,
        metrics,
        tables: [],
      });

      if (DEBUG_ENABLED && debugDir) {
        const meta: DebugPageMeta = {
          pageNumber: i,
          mode: "ocr",
          provider: "tesseract",
          pdfWordCount: 0,
          ocrWordCount: ocr.words.length,
          slideTitle,
          metricsSample: metrics.slice(0, 5),
          renderScale: ocr.scale,
          regions: ocr.regions?.length,
          skippedRegions: ocr.skippedRegions,
          titleDebug,
        };
        debugRecords.push(meta);
        await writeDebugPage({
          dir: debugDir,
          pageNumber: i,
          meta,
          rawPng: ocr.rawPng,
          prePng: ocr.prePng,
        });
      }
    }

    if (allWords.length === 0) {
      throw new Error("No text extracted from PDF even after OCR");
    }
  } else if (DEBUG_ENABLED && debugDir) {
    // Debug images even when text extraction worked (helps compare OCR preprocessing).
    for (const pageMeta of pages) {
      const page = await withTimeout(worker.getPage(pageMeta.pageNumber), `pdf page ${pageMeta.pageNumber}`);
      const scale = computeOcrScale(page);
      const { rawPng, prePng } = await renderPageToCanvas(page, scale, "basic", true);
      const meta: DebugPageMeta = {
        pageNumber: pageMeta.pageNumber,
        mode: "text",
        pdfWordCount: pageMeta.words.length,
        ocrWordCount: 0,
        slideTitle: pageMeta.slideTitle,
        metricsSample: pageMeta.metrics.slice(0, 5),
        renderScale: scale,
      };
      debugRecords.push(meta);
      await writeDebugPage({ dir: debugDir, pageNumber: pageMeta.pageNumber, meta, rawPng, prePng });
    }
  }

  // --- Boilerplate detection across pages ---
  const freq: Record<string, number> = {};
  for (const page of pages) {
    const samples: string[] = [];
    if (page.slideTitle) samples.push(page.slideTitle);
    if (page.text) samples.push(page.text.slice(0, 300));
    for (const s of samples) {
      const norm = normalizeBoilerplateText(s);
      if (!norm) continue;
      freq[norm] = (freq[norm] || 0) + 1;
    }
  }

  const boilerplate: Set<string> = new Set();
  const threshold = Math.max(1, Math.ceil(processedPages * 0.4));
  for (const [k, count] of Object.entries(freq)) {
    if (count >= threshold) boilerplate.add(k);
  }

  // Practical boilerplate stripping (regex-based for URLs/emails/phones + repeated short titles).
  const repeatedTitleKeys = new Set<string>();
  for (const t of slideTitles) {
    const norm = normalizeBoilerplateText(t);
    if (norm && boilerplate.has(norm) && t.length <= 40) {
      repeatedTitleKeys.add(t);
    }
  }

  const stripBoilerplate = (text: string) => {
    let out = text || "";
    out = out.replace(/https?:\/\/\S+/gi, " ");
    out = out.replace(/\bwww\.[^\s]+/gi, " ");
    out = out.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, " ");
    out = out.replace(/\b\d{3}[\s.-]?\d{3}[\s.-]?\d{4}\b/g, " ");
    for (const t of repeatedTitleKeys) {
      const esc = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      out = out.replace(new RegExp(esc, "gi"), " ");
    }
    return out.replace(/\s+/g, " ").trim();
  };

  for (const page of pages) {
    if (page.text) {
      page.text = stripBoilerplate(page.text);
    }
    if (page.slideTitle) {
      const norm = normalizeBoilerplateText(page.slideTitle);
      if (boilerplate.has(norm)) page.slideTitle = "";
    }
  }

  // Filter main headings (quality + dedupe OCR variants).
  const filteredHeadings = (() => {
    const out: string[] = [];
    const seen = new Set<string>();

    for (const tRaw of slideTitles) {
        const cleaned = stripLogoPrefix(tRaw);
        if (!isLikelyGoodTitle(cleaned)) continue;

        const norm = normalizeBoilerplateText(cleaned);
        if (!norm || boilerplate.has(norm)) continue;

        const key = normalizeTitleKey(cleaned).replace(/^[^a-z]+/g, "").trim();
        if (!key || seen.has(key)) continue;

        seen.add(key);
        out.push(cleaned.replace(/\s+/g, " ").trim());
        if (out.length >= 10) break;
    }

    return out;
})();

  // Build numbers list: prefer metric label contexts, dedupe by value, keep shortest/cleanest context.
  const derivedNumbers = pages
    .flatMap((p) => p.metrics.filter((m) => isNumericValue(m.value)).map((m) => ({ value: m.value, context: m.label })))
    .concat(numbers)
    .filter((n) => n.value && n.context && isNumericValue(n.value));

const filteredNumbers = (() => {
  const bestByValue = new Map<string, { value: string; context: string }>();

  const scoreContext = (ctx: string) => {
    const c = (ctx || "").replace(/\s+/g, " ").trim();
    if (!c) return 1e9;

    const len = c.length;
    const manyCaps = (c.match(/[A-Z]{3,}/g) || []).length;
    const weird = (c.match(/[^A-Za-z0-9\s\-–%\$\.,\/:]/g) || []).length;

    // shorter is better; lots of all-caps runs + weird glyphs are often OCR junk
    return len + (manyCaps > 6 ? 40 : 0) + weird * 15;
  };

  for (const n of derivedNumbers) {
    const value = (n.value || "").trim();
    const ctxRaw = (n.context || "").replace(/\s+/g, " ").trim();
    if (!value || !ctxRaw) continue;
    if (!isNumericValue(value)) continue;

    // ✅ skip obvious OCR garbage contexts early
    if (isGarbledContext(ctxRaw)) continue;

    const normCtx = normalizeBoilerplateText(ctxRaw);
    if (normCtx && boilerplate.has(normCtx)) continue;

    const ctx = ctxRaw.length > 120 ? ctxRaw.slice(0, 117).trim() + "..." : ctxRaw;
    // After truncation, check again for garbage
    if (isGarbledContext(ctx)) continue;
    const key = value.toLowerCase();

    const existing = bestByValue.get(key);
    if (!existing) {
      bestByValue.set(key, { value, context: ctx });
      continue;
    }

    if (scoreContext(ctx) < scoreContext(existing.context)) {
      bestByValue.set(key, { value, context: ctx });
    }
  }

  return Array.from(bestByValue.values());
})();

  return {
    pages,
    summary: {
      totalWords: allWords.length,
      processedPages,
      mainHeadings: filteredHeadings,
      keyNumbers: filteredNumbers.slice(0, 20),
      textItems: textItemsCount,
    },
    usedOcr,
    debugRecords,
  };
}

type OCRResult = {
  text: string;
  words: Array<{ text: string; x: number; y: number; width: number; height: number; conf: number }>;
};

export async function extractPDFContent(buffer: Buffer, options: { docId?: string } = {}): Promise<PDFContent> {
  const data = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  if (data.byteLength === 0) {
    throw new Error("Empty PDF buffer");
  }

  const docIdRaw = options.docId || crypto.randomUUID();
  const docId = docIdRaw.replace(/[^a-zA-Z0-9_\-]/g, "_");
  const debugDir = DEBUG_ENABLED ? path.join("/tmp/pdf_extract_debug", docId) : undefined;
  if (debugDir) {
    await fs.mkdir(debugDir, { recursive: true }).catch(() => {});
  }

  const standardFontDataUrl = path.join(path.dirname(require.resolve("pdfjs-dist/package.json")), "standard_fonts/");

  const worker = await withTimeout(pdfjs.getDocument({ data, standardFontDataUrl }).promise, "pdf load");
  const processedPages = Math.min(worker.numPages, PDF_MAX_PAGES);
  const metadata = await worker.getMetadata().catch(() => ({}));

  const { pages, summary, usedOcr, debugRecords } = await extractWithTextThenOcr(worker, processedPages, debugDir);

  if (DEBUG_ENABLED && debugDir) {
    await writeDebugSummary(debugDir, {
      docId,
      totalPages: worker.numPages,
      processedPages: summary.processedPages,
      ocrUsed: usedOcr,
      mainHeadings: summary.mainHeadings,
      keyNumbersSample: summary.keyNumbers.slice(0, 10),
      pageDebug: debugRecords,
    });
  }

  return {
    metadata: {
      title: (metadata as any)?.title || undefined,
      author: (metadata as any)?.author || undefined,
      subject: (metadata as any)?.subject || undefined,
      creationDate: (metadata as any)?.creationDate || undefined,
      pages: worker.numPages,
    },
    pages,
    summary: {
      totalWords: summary.totalWords,
      totalPages: worker.numPages,
      processedPages: summary.processedPages,
      mainHeadings: summary.mainHeadings,
      keyNumbers: summary.keyNumbers,
      textItems: summary.textItems,
      ocrUsed: usedOcr,
    },
  };
}