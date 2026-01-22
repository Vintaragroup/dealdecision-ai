export {};

/**
 * Deal title + OCR discovery report.
 *
 * Purpose:
 * - For a given deal, show (per page) the generated slide_title, its source/confidence,
 *   the top OCR header candidates (from ocr_blocks), and a short OCR/text preview.
 * - Highlight “business-definition” keyword hits to diagnose extraction→interpretation gaps.
 *
 * Usage:
 *   pnpm -s tsx scripts/discover-deal-title-gap.ts --deal <deal_id>
 *   pnpm -s tsx scripts/discover-deal-title-gap.ts --deal <deal_id> --base-url http://localhost:9000
 *   pnpm -s tsx scripts/discover-deal-title-gap.ts --deal <deal_id> --out artifacts/webmax_title_discovery.md
 */

type VisualAsset = {
  document_id?: string | null;
  document_title?: string | null;
  document_type?: string | null;
  page_index?: number | null;
  extractor_version?: string | null;
  structured_kind?: string | null;

  slide_title?: string | null;
  slide_title_source?: string | null;
  slide_title_confidence?: number | null;

  ocr_text?: string | null;
  ocr_blocks?: Array<{
    bbox?: { x?: number; y?: number; w?: number; h?: number } | null;
    text?: string | null;
    confidence?: number | null;
  }> | null;

  structured_json?: any;

  effective_segment?: string | null;
  segment_source?: string | null;
  segment_confidence?: number | null;
  computed_segment?: string | null;
  computed_confidence?: number | null;
  computed_reason?: string | null;
};

type VisualAssetsResponse = { deal_id: string; visual_assets: VisualAsset[] };

function parseArgs(argv: string[]) {
  const out: { baseUrl: string; dealId: string | null; outPath: string } = {
    baseUrl: process.env.API_BASE_URL || "http://localhost:9000",
    dealId: null,
    outPath: "",
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--base-url") {
      out.baseUrl = String(argv[i + 1] ?? out.baseUrl);
      i++;
      continue;
    }
    if (a === "--deal") {
      out.dealId = String(argv[i + 1] ?? "").trim() || null;
      i++;
      continue;
    }
    if (a === "--out") {
      out.outPath = String(argv[i + 1] ?? "").trim();
      i++;
      continue;
    }
  }

  out.baseUrl = out.baseUrl.replace(/\/$/, "");
  return out;
}

function normalizeWhitespace(v: unknown): string {
  if (typeof v !== "string") return "";
  return v.replace(/\s+/g, " ").trim();
}

function pickLines(text: string, maxLines: number): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => normalizeWhitespace(l))
    .filter(Boolean);
  return lines.slice(0, Math.max(0, maxLines));
}

function pickStructuredPreview(structuredJson: any): string {
  if (!structuredJson || typeof structuredJson !== "object") return "";

  const title = normalizeWhitespace((structuredJson as any).title);
  const bulletsRaw = (structuredJson as any).bullets;
  const bullets = Array.isArray(bulletsRaw) ? bulletsRaw.map((b) => normalizeWhitespace(b)).filter(Boolean) : [];

  const range = normalizeWhitespace((structuredJson as any).range);
  const sheet = normalizeWhitespace((structuredJson as any).sheet);
  const label = normalizeWhitespace((structuredJson as any).label);

  const bits = [title, bullets[0], label, sheet && range ? `${sheet} ${range}` : range].filter(Boolean);
  return bits.length ? bits[0].slice(0, 180) : "";
}

function headerCandidatesFromBlocks(blocks: VisualAsset["ocr_blocks"]): string[] {
  if (!Array.isArray(blocks)) return [];

  const scored: Array<{ score: number; text: string }> = [];

  for (const b of blocks) {
    const raw = normalizeWhitespace(b?.text);
    if (!raw) continue;

    const y = typeof b?.bbox?.y === "number" ? b.bbox.y : null;
    const h = typeof b?.bbox?.h === "number" ? b.bbox.h : null;
    const conf = typeof b?.confidence === "number" ? b.confidence : 0.5;

    // Roughly “top of page”, avoid tiny stray glyphs.
    const inHeaderBand = y == null ? true : y <= 0.28;
    const tooTall = h != null && h > 0.35;
    if (!inHeaderBand || tooTall) continue;

    const len = raw.length;
    if (len <= 2) continue;

    // Prefer longer strings and higher confidence, lightly penalize very low y (often logos/corner junk).
    const yPenalty = y != null ? Math.max(0, 0.08 - y) * 2.0 : 0;
    const score = len * (0.6 + conf) - yPenalty;
    scored.push({ score, text: raw });
  }

  scored.sort((a, b) => b.score - a.score);

  const uniq: string[] = [];
  for (const s of scored) {
    const t = s.text.replace(/\s+/g, " ").trim();
    if (!t) continue;
    if (uniq.some((u) => u.toLowerCase() === t.toLowerCase())) continue;
    uniq.push(t.slice(0, 160));
    if (uniq.length >= 3) break;
  }

  return uniq;
}

const BUSINESS_KEYWORDS: Array<{ label: string; re: RegExp }> = [
  { label: "mortgage", re: /\bmortgage\b/i },
  { label: "lender", re: /\blender(s)?\b/i },
  { label: "borrower", re: /\bborrower(s)?\b/i },
  { label: "crm", re: /\bcrm\b/i },
  { label: "saas", re: /\bsaas\b/i },
  { label: "platform", re: /\bplatform\b/i },
  { label: "predictive", re: /\bpredict(ive|ing)?\b/i },
  { label: "scoring", re: /\bscor(e|ing)\b/i },
  { label: "ai", re: /\bai\b/i },
  { label: "automation", re: /\bautomation\b/i },
];

function keywordHits(text: string): string[] {
  const hits: string[] = [];
  for (const k of BUSINESS_KEYWORDS) {
    if (k.re.test(text)) hits.push(k.label);
  }
  return hits;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} for ${url}${text ? `: ${text.slice(0, 240)}` : ""}`);
  }
  return (await res.json()) as T;
}

function groupKey(a: VisualAsset): string {
  const docId = typeof a.document_id === "string" ? a.document_id : "(unknown-doc)";
  const docTitle = normalizeWhitespace(a.document_title) || "(untitled)";
  return `${docId}::${docTitle}`;
}

async function main() {
  const { baseUrl, dealId, outPath } = parseArgs(process.argv);
  if (!dealId) throw new Error("Missing --deal <deal_id>");

  const payload = await fetchJson<VisualAssetsResponse>(`${baseUrl}/api/v1/deals/${encodeURIComponent(dealId)}/visual-assets?group_word=1`);
  const assets = Array.isArray(payload.visual_assets) ? payload.visual_assets : [];

  const byDoc = new Map<string, VisualAsset[]>();
  for (const a of assets) {
    const key = groupKey(a);
    const arr = byDoc.get(key) ?? [];
    arr.push(a);
    byDoc.set(key, arr);
  }

  const lines: string[] = [];
  lines.push(`# Deal Title Discovery`);
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Base URL: ${baseUrl}`);
  lines.push(`Deal ID: ${dealId}`);
  lines.push(`Visual assets: ${assets.length}`);
  lines.push("");

  // Cross-asset keyword map to quickly see if business-definition signals exist.
  const hitPages: Array<{ doc: string; page: number; title: string; hits: string[]; snippet: string }> = [];

  const docs = Array.from(byDoc.entries()).sort((a, b) => b[1].length - a[1].length);

  for (const [key, items] of docs) {
    const [, docTitle] = key.split("::");
    const sorted = items.slice().sort((a, b) => (a.page_index ?? 9999) - (b.page_index ?? 9999));

    const docType = normalizeWhitespace(sorted[0]?.document_type) || "";
    const extractor = normalizeWhitespace(sorted[0]?.extractor_version) || "";

    lines.push(`---`);
    lines.push("");
    lines.push(`## ${docTitle}`);
    if (docType || extractor) lines.push(`Type: ${docType || "(unknown)"} • Extractor: ${extractor || "(unknown)"}`);
    lines.push("");
    lines.push(`| Page | Segment | Title (source/conf) | OCR header candidates | OCR preview |`);
    lines.push(`|---:|---|---|---|---|`);

    for (const a of sorted) {
      const page = (typeof a.page_index === "number" ? a.page_index : 0) + 1;
      const seg = normalizeWhitespace(a.effective_segment) || normalizeWhitespace(a.computed_segment) || "unknown";

      const title = normalizeWhitespace(a.slide_title) || "(missing)";
      const source = normalizeWhitespace(a.slide_title_source) || "(none)";
      const conf = typeof a.slide_title_confidence === "number" ? a.slide_title_confidence.toFixed(2) : "";
      const titleCell = `${title} (${source}${conf ? `/${conf}` : ""})`;

      const headerCands = headerCandidatesFromBlocks(a.ocr_blocks).join(" / ");

      const ocrPreview = (() => {
        const ocr = typeof a.ocr_text === "string" ? a.ocr_text : "";
        const s = pickLines(ocr, 2).join(" ⏎ ");
        const sj = pickStructuredPreview(a.structured_json);
        const mix = [s, sj ? `SJ: ${sj}` : ""].filter(Boolean).join(" • ");
        return mix ? mix.slice(0, 220) : "(no text)";
      })();

      const ocrTextNorm = normalizeWhitespace(a.ocr_text) || "";
      const sjTextNorm = normalizeWhitespace(pickStructuredPreview(a.structured_json)) || "";
      const hits = keywordHits([ocrTextNorm, sjTextNorm, title].join(" \n "));
      if (hits.length) {
        hitPages.push({ doc: docTitle, page, title, hits, snippet: ocrPreview });
      }

      lines.push(`| ${page} | ${mdEscape(seg)} | ${mdEscape(titleCell)} | ${mdEscape(headerCands)} | ${mdEscape(ocrPreview)} |`);
    }
  }

  lines.push(`---`);
  lines.push("");
  lines.push(`## Business Keyword Hits`);
  lines.push("");
  lines.push(`This is a quick scan for business-definition signals in OCR/title text (helps diagnose “text exists but analyzer missed it”).`);
  lines.push("");
  lines.push(`| Document | Page | Hits | Title | Snippet |`);
  lines.push(`|---|---:|---|---|---|`);

  for (const h of hitPages.sort((a, b) => a.doc.localeCompare(b.doc) || a.page - b.page)) {
    lines.push(`| ${mdEscape(h.doc)} | ${h.page} | ${mdEscape(h.hits.join(","))} | ${mdEscape(h.title)} | ${mdEscape(h.snippet)} |`);
  }

  const fs = await import("node:fs/promises");
  const path = await import("node:path");

  const resolvedOut = outPath
    ? path.resolve(process.cwd(), outPath)
    : path.resolve(process.cwd(), "artifacts", `deal_title_discovery.${dealId}.md`);

  await fs.mkdir(path.dirname(resolvedOut), { recursive: true });
  await fs.writeFile(resolvedOut, lines.join("\n"), "utf-8");

  // Also write a machine-readable JSON alongside.
  const jsonOut = resolvedOut.replace(/\.md$/i, ".json");
  const report = {
    generated_at: new Date().toISOString(),
    base_url: baseUrl,
    deal_id: dealId,
    counts: { visual_assets: assets.length, documents: byDoc.size },
    keyword_hits: hitPages,
  };
  await fs.writeFile(jsonOut, JSON.stringify(report, null, 2), "utf-8");

  console.log(`Wrote ${resolvedOut}`);
  console.log(`Wrote ${jsonOut}`);
}

function mdEscape(s: string): string {
  return String(s)
    .replace(/\|/g, "\\|")
    .replace(/\n/g, " ")
    .replace(/\r/g, " ")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
