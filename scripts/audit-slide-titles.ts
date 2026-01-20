export {};

import fs from "node:fs";
import path from "node:path";

type DealRow = {
  id: string;
  name?: string | null;
  stage?: string | null;
  priority?: string | null;
};

type VisualAssetRow = {
  id?: string;
  visual_asset_id?: string;
  document_id?: string;
  document_title?: string | null;
  document_type?: string | null;
  page_index?: number | null;
  extractor_version?: string | null;
  quality_flags?: { source?: string | null } | null;

  ocr_text?: string | null;
  structured_json?: any;

  slide_title?: string | null;
  slide_title_source?: string | null;
  slide_title_confidence?: number | null;

  computed_segment?: string | null;
  computed_confidence?: number | null;
  effective_segment?: string | null;
  segment_source?: string | null;
};

type DealVisualAssetsResponse = {
  deal_id: string;
  visual_assets: VisualAssetRow[];
};

function nowStamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}_${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function alphaRatio(s: string): number {
  const t = s.replace(/\s+/g, "");
  if (!t) return 0;
  const alpha = (t.match(/[a-zA-Z]/g) ?? []).length;
  return alpha / t.length;
}

function looksScrambledTitle(title: string): boolean {
  const s = normalizeWhitespace(title);
  if (!s) return true;
  const alpha = alphaRatio(s);
  if (alpha < 0.5) return true;

  const words = s.split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;

  const tooManySingles = words.filter((w) => w.length === 1).length >= Math.ceil(words.length * 0.6);
  if (tooManySingles) return true;

  const hasVeryLongNoVowels = words.some((w) => w.length >= 16 && !/[aeiou]/i.test(w));
  if (hasVeryLongNoVowels) return true;

  const weirdChars = (s.match(/[^a-zA-Z0-9\s\-\/:,.()&+%$]/g) ?? []).length;
  if (weirdChars >= Math.ceil(s.length * 0.15)) return true;

  return false;
}

function topOcrLine(ocrText: string | null | undefined): string | null {
  if (typeof ocrText !== "string") return null;
  const lines = ocrText
    .split(/\r?\n/)
    .map((l) => normalizeWhitespace(l))
    .filter(Boolean);
  if (lines.length === 0) return null;
  return lines[0].slice(0, 180);
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} for ${url}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

async function runWithLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let idx = 0;
  const workers = Array.from({ length: Math.max(1, limit) }, async () => {
    while (true) {
      const i = idx;
      idx += 1;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

async function main() {
  const baseUrl = process.argv[2] ?? "http://localhost:9000";
  const outPathArg = process.argv[3] ?? `artifacts/title-audit.${nowStamp()}.json`;
  const outPath = path.resolve(process.cwd(), outPathArg);

  const deals = await fetchJson<DealRow[]>(`${baseUrl}/api/dashboard/deals`);

  const perDeal = await runWithLimit(deals, 3, async (deal) => {
    const payload = await fetchJson<DealVisualAssetsResponse>(`${baseUrl}/api/v1/deals/${encodeURIComponent(deal.id)}/visual-assets`);
    const assets = Array.isArray(payload.visual_assets) ? payload.visual_assets : [];

    let total = 0;
    let withTitle = 0;
    let scrambledTitles = 0;
    let fuzzyTitles = 0;
    let computedUnknown = 0;
    let effectiveUnknown = 0;
    let visionAssets = 0;
    let structuredAssets = 0;

    const worstSamples: any[] = [];

    for (const a of assets) {
      total += 1;
      const title = typeof a.slide_title === "string" ? normalizeWhitespace(a.slide_title) : "";
      const titleSource = typeof a.slide_title_source === "string" ? a.slide_title_source : null;
      const ocrLine = topOcrLine(a.ocr_text);
      const ocrLineScrambled = ocrLine ? looksScrambledTitle(ocrLine) : null;

      const qualitySource = typeof a.quality_flags?.source === "string" ? a.quality_flags.source : null;
      const extractorVersion = typeof a.extractor_version === "string" ? a.extractor_version : null;
      const isStructured = extractorVersion === "structured_native_v1" || (qualitySource != null && qualitySource.startsWith("structured_"));
      if (isStructured) structuredAssets += 1;
      else visionAssets += 1;

      if (title) {
        withTitle += 1;
        if (looksScrambledTitle(title)) scrambledTitles += 1;
      }
      if (titleSource === "heading_fuzzy_v1") fuzzyTitles += 1;

      const computedSeg = typeof a.computed_segment === "string" ? a.computed_segment : null;
      const effectiveSeg = typeof a.effective_segment === "string" ? a.effective_segment : null;
      if (computedSeg === "unknown" || computedSeg == null) computedUnknown += 1;
      if (effectiveSeg === "unknown" || effectiveSeg == null) effectiveUnknown += 1;

      const addSample = (reason: string) => {
        if (worstSamples.length >= 40) return;
        worstSamples.push({
          reason,
          deal_id: deal.id,
          deal_name: deal.name ?? null,
          document_id: a.document_id ?? null,
          document_title: a.document_title ?? null,
          page_index: a.page_index ?? null,
          extractor_version: extractorVersion,
          quality_source: qualitySource,
          slide_title: title || null,
          slide_title_source: titleSource,
          slide_title_confidence: typeof a.slide_title_confidence === "number" ? a.slide_title_confidence : null,
          ocr_top_line: ocrLine,
          ocr_top_line_scrambled: ocrLineScrambled,
          computed_segment: computedSeg,
          computed_confidence: typeof a.computed_confidence === "number" ? a.computed_confidence : null,
          effective_segment: effectiveSeg,
          segment_source: typeof a.segment_source === "string" ? a.segment_source : null,
        });
      };

      if (!title) addSample("missing_title");
      else if (looksScrambledTitle(title)) addSample("scrambled_title");
      else if (computedSeg === "unknown" || computedSeg == null) addSample("unknown_segment_with_title");
    }

    // Keep a small set of samples, preferring missing/scrambled.
    worstSamples.sort((a, b) => {
      const order = (r: string) => (r === "missing_title" ? 0 : r === "scrambled_title" ? 1 : 2);
      return order(a.reason) - order(b.reason);
    });

    return {
      deal_id: deal.id,
      deal_name: deal.name ?? null,
      totals: {
        visual_assets: total,
        vision_assets: visionAssets,
        structured_assets: structuredAssets,
        with_title: withTitle,
        scrambled_titles: scrambledTitles,
        fuzzy_titles: fuzzyTitles,
        computed_unknown: computedUnknown,
        effective_unknown: effectiveUnknown,
      },
      worst_samples: worstSamples.slice(0, 12),
    };
  });

  const global = {
    deals: deals.length,
    visual_assets: perDeal.reduce((s, d) => s + d.totals.visual_assets, 0),
    with_title: perDeal.reduce((s, d) => s + d.totals.with_title, 0),
    scrambled_titles: perDeal.reduce((s, d) => s + d.totals.scrambled_titles, 0),
    fuzzy_titles: perDeal.reduce((s, d) => s + d.totals.fuzzy_titles, 0),
    computed_unknown: perDeal.reduce((s, d) => s + d.totals.computed_unknown, 0),
    effective_unknown: perDeal.reduce((s, d) => s + d.totals.effective_unknown, 0),
    vision_assets: perDeal.reduce((s, d) => s + d.totals.vision_assets, 0),
    structured_assets: perDeal.reduce((s, d) => s + d.totals.structured_assets, 0),
  };

  const report = {
    generated_at: new Date().toISOString(),
    base_url: baseUrl,
    global,
    per_deal: perDeal,
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ out: outPathArg, global }, null, 2));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
