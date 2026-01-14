export type AnalystSegment =
  | "problem"
  | "solution"
  | "product"
  | "market"
  | "traction"
  | "business_model"
  | "distribution"
  | "team"
  | "competition"
  | "risks"
  | "financials"
  | "raise_terms"
  | "exit"
  | "overview"
  | "unknown";

export type UnknownReasonCode = "NO_TEXT" | "LOW_SIGNAL" | "AMBIGUOUS_TIE";

export const canonicalSegments: AnalystSegment[] = [
  "overview",
  "problem",
  "solution",
  "product",
  "market",
  "traction",
  "business_model",
  "distribution",
  "team",
  "competition",
  "risks",
  "financials",
  "raise_terms",
  "exit",
  "unknown",
];

export function normalizeAnalystSegment(value: unknown): AnalystSegment | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return (canonicalSegments as readonly string[]).includes(trimmed) ? (trimmed as AnalystSegment) : null;
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const structuredSources = ["structured_word", "structured_powerpoint", "structured_excel"] as const;
type StructuredSource = (typeof structuredSources)[number];

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value));

const normalizeWhitespace = (value: string): string => value.replace(/\s+/g, " ").trim();

export type SegmentFeatures = {
  // Canonical feature fields (stable across all doc types)
  title_text: string;
  title_source: string;
  body_text: string;
  evidence_text: string;
  structured_segment_hint: AnalystSegment | null;
  doc_kind: "vision" | "pptx" | "docx" | "xlsx" | "image";
  page_index: number | null;
  slide_number: number | null;

  // Backward-compatible fields
  title: string;
  headings: string[];
  body: string;
  labels: string[];
  evidence_snippets: string[];
  source_kind: "vision" | "pptx" | "docx" | "xlsx" | "image";
  page_number: number | null;
  doc_title: string | null;
  has_title: boolean;
  has_table: boolean;
};

const cleanText = (value: unknown, maxLen = 800): string => {
  if (typeof value !== "string") return "";
  const cleaned = normalizeWhitespace(value);
  if (!cleaned) return "";
  return cleaned.slice(0, maxLen);
};

const collectStringList = (value: unknown, limit: number, maxItemLen = 200): string[] => {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const v of value) {
    if (out.length >= limit) break;
    const s = cleanText(v, maxItemLen);
    if (!s) continue;
    out.push(s);
  }
  return out;
};

const flattenLabelStrings = (labels: unknown, limit: number): string[] => {
  const out: string[] = [];
  const push = (v: unknown) => {
    if (out.length >= limit) return;
    const s = cleanText(v, 120);
    if (!s) return;
    out.push(s);
  };
  const visit = (v: unknown) => {
    if (out.length >= limit) return;
    if (typeof v === "string") return push(v);
    if (Array.isArray(v)) {
      for (const item of v) {
        if (out.length >= limit) break;
        if (typeof item === "string") push(item);
      }
      return;
    }
    if (v && typeof v === "object") {
      const obj = v as Record<string, unknown>;
      for (const key of Object.keys(obj)) {
        if (out.length >= limit) break;
        visit(obj[key]);
      }
    }
  };
  visit(labels);
  return Array.from(new Set(out.map((s) => s.trim()).filter(Boolean))).slice(0, limit);
};

const detectSourceKind = (input: {
  extractor_version?: string | null;
  quality_source?: string | null;
  structured_json?: unknown;
  document_mime_type?: string | null;
  document_filename?: string | null;
}): SegmentFeatures["source_kind"] => {
  const extractorVersion = typeof input.extractor_version === "string" ? input.extractor_version : null;
  const qualitySource = typeof input.quality_source === "string" ? input.quality_source : null;
  if (extractorVersion === "structured_native_v1" || (qualitySource && structuredSources.includes(qualitySource as any))) {
    const sj = input.structured_json;
    const sjObj = isPlainObject(sj) ? sj : null;
    const kind = typeof sjObj?.kind === "string" ? sjObj.kind : "";
    if (qualitySource === "structured_powerpoint" || kind === "powerpoint_slide") return "pptx";
    if (qualitySource === "structured_word" || kind === "word_section") return "docx";
    if (qualitySource === "structured_excel" || kind === "excel_sheet") return "xlsx";
    return "docx";
  }

  const mt = typeof input.document_mime_type === "string" ? input.document_mime_type.toLowerCase() : "";
  if (mt.startsWith("image/")) return "image";

  const fn = typeof input.document_filename === "string" ? input.document_filename.toLowerCase() : "";
  if (fn.endsWith(".png") || fn.endsWith(".jpg") || fn.endsWith(".jpeg") || fn.endsWith(".webp")) return "image";
  return "vision";
};

export function buildSegmentFeatures(asset: {
  ocr_text?: string | null;
  ocr_blocks?: unknown;
  structured_kind?: string | null;
  structured_summary?: unknown;
  structured_json?: unknown;
  labels?: unknown;
  asset_type?: string | null;
  page_index?: number | null;
  evidence_snippets?: string[] | null;
  extractor_version?: string | null;
  quality_source?: string | null;
  document_title?: string | null;
  document_mime_type?: string | null;
  document_filename?: string | null;
  brand_blacklist?: Set<string> | string[] | null;
  brand_name?: string | null;
  enable_debug?: boolean;
}): SegmentFeatures {
  const pageIndex = typeof asset.page_index === "number" && Number.isFinite(asset.page_index) ? asset.page_index : null;
  const pageNumber = typeof asset.page_index === "number" && Number.isFinite(asset.page_index) ? asset.page_index + 1 : null;
  const docTitle = typeof asset.document_title === "string" && asset.document_title.trim().length > 0 ? asset.document_title.trim() : null;
  const sourceKind = detectSourceKind({
    extractor_version: asset.extractor_version ?? null,
    quality_source: asset.quality_source ?? null,
    structured_json: asset.structured_json,
    document_mime_type: asset.document_mime_type ?? null,
    document_filename: asset.document_filename ?? null,
  });

  const evidenceSnippets = Array.isArray(asset.evidence_snippets)
    ? asset.evidence_snippets.filter((s): s is string => typeof s === "string" && s.trim().length > 0).map((s) => normalizeWhitespace(s)).slice(0, 8)
    : [];

  const sk = typeof asset.structured_kind === "string" ? asset.structured_kind.toLowerCase() : "";
  const structuredSummaryTable = (asset.structured_summary as any)?.table;
  const tableDetected =
    sk === "table" ||
    Boolean(structuredSummaryTable) ||
    String(asset.asset_type ?? "").toLowerCase() === "table" ||
    (isPlainObject(asset.structured_json) && Boolean((asset.structured_json as any)?.table));

  const labels = flattenLabelStrings(asset.labels, 12);

  const sjObj = isPlainObject(asset.structured_json) ? (asset.structured_json as Record<string, unknown>) : null;
  const structuredSegmentHint = sjObj ? normalizeAnalystSegment((sjObj as any)?.segment_key) : null;
  const headings: string[] = [];
  let title = "";
  let titleSource = "missing";
  let body = "";
  let slideNumber: number | null = null;

  if (sourceKind === "pptx") {
    title = cleanText((sjObj as any)?.title, 160);
    titleSource = title ? "structured_json.title" : "missing";
    slideNumber = typeof (sjObj as any)?.slide_number === "number" && Number.isFinite((sjObj as any).slide_number)
      ? Number((sjObj as any).slide_number)
      : null;
    const bullets = collectStringList((sjObj as any)?.bullets, 40, 180);
    const notes = cleanText((sjObj as any)?.notes, 600);
    const snippet = cleanText((sjObj as any)?.text_snippet, 900);
    body = [bullets.join("\n"), notes, snippet].filter(Boolean).join("\n").trim();
  } else if (sourceKind === "docx") {
    const heading = cleanText((sjObj as any)?.heading, 200);
    title = heading;
    titleSource = title ? "structured_json.heading" : "missing";
    const paragraphs = collectStringList((sjObj as any)?.paragraphs, 60, 220);
    const snippet = cleanText((sjObj as any)?.text_snippet, 900);
    const tableRows = Array.isArray((sjObj as any)?.table_rows) ? ((sjObj as any).table_rows as any[]) : [];
    const tablePreview: string[] = [];
    for (const row of tableRows.slice(0, 6)) {
      if (!Array.isArray(row)) continue;
      const cells = row
        .slice(0, 6)
        .map((c: any) => (typeof c === "string" ? cleanText(c, 60) : c != null ? String(c) : ""))
        .filter((c: string) => c.trim().length > 0);
      if (cells.length) tablePreview.push(cells.join(" | "));
    }
    body = [paragraphs.join("\n"), snippet, tablePreview.length ? `TABLE:\n${tablePreview.join("\n")}` : ""]
      .filter(Boolean)
      .join("\n")
      .trim();
  } else if (sourceKind === "xlsx") {
    title = cleanText((sjObj as any)?.sheet_name, 120);
    titleSource = title ? "structured_json.sheet_name" : "missing";
    const headers = collectStringList((sjObj as any)?.headers, 60, 80);
    headings.push(...headers.slice(0, 20));
    const sampleRows = Array.isArray((sjObj as any)?.sample_rows) ? ((sjObj as any).sample_rows as any[]) : [];
    const rowLines: string[] = [];
    for (const row of sampleRows.slice(0, 8)) {
      if (!Array.isArray(row)) continue;
      const cells = row
        .slice(0, 10)
        .map((c: any) => (typeof c === "string" ? cleanText(c, 80) : c != null ? String(c) : ""))
        .filter((c: string) => c.trim().length > 0);
      if (cells.length) rowLines.push(cells.join(" | "));
    }
    body = rowLines.join("\n").trim();
  } else {
    // Vision/image: derive title from OCR candidates when possible.
    const blacklistSet = asset.brand_blacklist instanceof Set
      ? asset.brand_blacklist
      : new Set(Array.isArray(asset.brand_blacklist) ? asset.brand_blacklist : []);
    try {
      const { inferSlideTitle } = require("./slide-title");
      const titleDerived = inferSlideTitle({
        ocr_blocks: asset.ocr_blocks,
        ocr_text: asset.ocr_text ?? null,
        page_index: typeof asset.page_index === "number" ? asset.page_index : null,
        doc_brand_blacklist: blacklistSet,
        brand_name: typeof asset.brand_name === "string" ? asset.brand_name : null,
        enableDebug: asset.enable_debug === true,
      });
      title = cleanText(titleDerived?.slide_title, 180);
      titleSource = typeof titleDerived?.slide_title_source === "string" && titleDerived.slide_title_source.trim().length > 0
        ? titleDerived.slide_title_source
        : title
          ? "ocr_fallback"
          : "missing";
    } catch {
      // Fallback if slide-title module isn't available for some reason.
      const lines = typeof asset.ocr_text === "string" ? asset.ocr_text.split(/\r?\n/).map((l) => normalizeWhitespace(l)).filter(Boolean) : [];
      title = lines[0] ? lines[0].slice(0, 180) : "";
      titleSource = title ? "ocr_top_line" : "missing";
    }

    const ocrText = typeof asset.ocr_text === "string" ? asset.ocr_text : "";
    body = normalizeWhitespace(ocrText).slice(0, 1400);

    const lines = ocrText.split(/\r?\n/).map((l) => normalizeWhitespace(l)).filter(Boolean);
    const titleLower = title.toLowerCase();
    for (const line of lines.slice(0, 12)) {
      if (headings.length >= 6) break;
      if (line.length < 6) continue;
      if (title && line.toLowerCase() === titleLower) continue;
      if (line.length > 140) continue;
      const wordCount = line.split(/\s+/).filter(Boolean).length;
      if (wordCount < 2) continue;
      headings.push(line);
    }
  }

  title = normalizeWhitespace(title);
  const hasTitle = Boolean(title && title.trim().length > 0);
  const headingsDeduped = Array.from(new Set(headings.map((h) => normalizeWhitespace(h)).filter(Boolean))).slice(0, 24);

  const evidenceText = evidenceSnippets.join("\n").trim();

  return {
    title_text: title,
    title_source: titleSource,
    body_text: body,
    evidence_text: evidenceText,
    structured_segment_hint: structuredSegmentHint,
    doc_kind: sourceKind,
    page_index: pageIndex,
    slide_number: slideNumber,
    title,
    headings: headingsDeduped,
    body,
    labels,
    evidence_snippets: evidenceSnippets,
    source_kind: sourceKind,
    page_number: pageNumber,
    doc_title: docTitle,
    has_title: hasTitle,
    has_table: tableDetected,
  };
}

export function buildClassificationText(features: SegmentFeatures): string {
  const parts: string[] = [];
  const title = normalizeWhitespace(features.title || "");
  const headings = Array.isArray(features.headings) ? features.headings.map((h) => normalizeWhitespace(h)).filter(Boolean) : [];
  const body = normalizeWhitespace(features.body || "");
  const evidence = Array.isArray(features.evidence_snippets)
    ? features.evidence_snippets.map((e) => normalizeWhitespace(e)).filter(Boolean)
    : [];

  if (title) parts.push(`TITLE: ${title}`);
  if (headings.length) parts.push(`HEADINGS: ${headings.slice(0, 16).join(" | ")}`);
  if (body) parts.push(`BODY: ${body}`);
  if (evidence.length) parts.push(`EVIDENCE: ${evidence.slice(0, 6).join(" | ")}`);

  return parts.join("\n");
}

const buildStructuredClassificationText = (input: {
  quality_source?: string | null;
  extractor_version?: string | null;
  structured_json?: unknown;
  structured_summary?: unknown;
  slide_title?: string | null;
  evidence_snippets?: string[] | null;
  maxLen?: number;
}): { text: string; sources_used: string[] } => {
  const maxLen = typeof input.maxLen === "number" && Number.isFinite(input.maxLen) ? input.maxLen : 1400;

  const sourceRaw = typeof input.quality_source === "string" ? input.quality_source : "";
  const source = (structuredSources as readonly string[]).includes(sourceRaw) ? (sourceRaw as StructuredSource) : null;

  const sj = input.structured_json;
  const sjObj = isPlainObject(sj) ? sj : null;
  const kind = typeof sjObj?.kind === "string" ? sjObj.kind : "";
  const inferredSource: StructuredSource | null = source
    ? source
    : kind === "word_section"
      ? "structured_word"
      : kind === "powerpoint_slide"
        ? "structured_powerpoint"
        : kind === "excel_sheet"
          ? "structured_excel"
          : null;

  const parts: string[] = [];
  const sourcesUsed = new Set<string>();
  const push = (value: unknown, sourceTag?: string) => {
    if (typeof value !== "string") return;
    const cleaned = normalizeWhitespace(value);
    if (!cleaned) return;
    parts.push(cleaned);
    if (sourceTag) sourcesUsed.add(sourceTag);
  };
  const pushList = (values: unknown, limit: number, sourceTag?: string) => {
    if (!Array.isArray(values)) return;
    let pushed = 0;
    for (const v of values) {
      if (pushed >= limit) break;
      if (typeof v !== "string") continue;
      const cleaned = normalizeWhitespace(v);
      if (!cleaned) continue;
      parts.push(cleaned);
      if (sourceTag) sourcesUsed.add(sourceTag);
      pushed += 1;
    }
  };
  const pushTablePreview = (rows: unknown, rowLimit: number, cellLimit: number, sourceTag?: string) => {
    if (!Array.isArray(rows)) return;
    let pushedRows = 0;
    for (const row of rows) {
      if (pushedRows >= rowLimit) break;
      if (!Array.isArray(row)) continue;
      const cells: string[] = [];
      for (const cell of row.slice(0, cellLimit)) {
        if (typeof cell === "string") {
          const cleaned = normalizeWhitespace(cell);
          if (cleaned) cells.push(cleaned);
        } else if (cell != null && (typeof cell === "number" || typeof cell === "boolean")) {
          cells.push(String(cell));
        }
      }
      if (cells.length) {
        parts.push(cells.join(" | "));
        if (sourceTag) sourcesUsed.add(sourceTag);
        pushedRows += 1;
      }
    }
  };

  // Structured-specific fields from worker synthetic assets.
  if (inferredSource === "structured_powerpoint") {
    push(sjObj?.title, "structured_json.title");
    pushList(sjObj?.bullets, 20, "structured_json.bullets");
    push(sjObj?.notes, "structured_json.notes");
    push(sjObj?.text_snippet, "structured_json.text_snippet");
  } else if (inferredSource === "structured_word") {
    push(sjObj?.heading, "structured_json.heading");
    push(sjObj?.text_snippet, "structured_json.text_snippet");
    pushList(sjObj?.paragraphs, 20, "structured_json.paragraphs");
    pushTablePreview(sjObj?.table_rows, 10, 2, "structured_json.table_rows");
  } else if (inferredSource === "structured_excel") {
    push(sjObj?.sheet_name, "structured_json.sheet_name");
    pushList(sjObj?.headers, 30, "structured_json.headers");
    pushList(sjObj?.numeric_columns, 20, "structured_json.numeric_columns");
    pushTablePreview(sjObj?.sample_rows, 5, 3, "structured_json.sample_rows");
    if (isPlainObject(sjObj?.summary)) {
      const summary = sjObj.summary as Record<string, unknown>;
      push(typeof summary?.title === "string" ? summary.title : null, "structured_json.summary.title");
    }
  } else {
    // Best-effort fallback: include common keys if present.
    push(sjObj?.title, "structured_json.title");
    push(sjObj?.heading, "structured_json.heading");
    push(sjObj?.text_snippet, "structured_json.text_snippet");
    pushList(sjObj?.bullets, 20, "structured_json.bullets");
    pushList(sjObj?.paragraphs, 20, "structured_json.paragraphs");
  }

  // Additional text signals (still structured mode).
  push(input.slide_title, "slide_title");
  const firstEvidence = Array.isArray(input.evidence_snippets)
    ? input.evidence_snippets.find((s) => typeof s === "string" && s.trim().length > 0)
    : null;
  push(firstEvidence, "evidence_snippet");

  if (input.structured_summary != null) {
    if (typeof input.structured_summary === "string") {
      push(input.structured_summary, "structured_summary");
    } else if (isPlainObject(input.structured_summary)) {
      try {
        push(JSON.stringify(input.structured_summary).slice(0, 500), "structured_summary");
      } catch {
        // ignore
      }
    }
  }

  // Dedupe + cap.
  const deduped: string[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(p);
  }

  // Last-resort fallback: if we have a worker-provided segment_key but no other text,
  // use it so structured assets don't default to unknown due to empty text.
  if (deduped.length === 0 && isPlainObject(sjObj)) {
    const segmentKey = typeof sjObj?.segment_key === "string" ? normalizeWhitespace(sjObj.segment_key) : "";
    if (segmentKey) {
      deduped.push(segmentKey);
      sourcesUsed.add("structured_json.segment_key");
    }
  }

  return { text: deduped.join(" \n ").slice(0, maxLen), sources_used: Array.from(sourcesUsed) };
};

export type SegmentClassifierInput = {
  ocr_text?: string | null;
  ocr_blocks?: unknown;
  ocr_snippet?: string | null;
  structured_kind?: string | null;
  structured_summary?: unknown;
  structured_json?: unknown;
  labels?: unknown;
  asset_type?: string | null;
  page_index?: number | null;
  slide_title?: string | null;
  slide_title_confidence?: number | null;
  evidence_snippets?: string[] | null;
  brand_blacklist?: Set<string> | string[] | null;
  brand_name?: string | null;
  extractor_version?: string | null;
  quality_source?: string | null;
  document_title?: string | null;
  document_mime_type?: string | null;
  document_filename?: string | null;
  enable_debug?: boolean;
  include_debug_text_snippet?: boolean;
  // Optional hint to stabilize structured assets when text is low-signal.
  // Caller should pass persisted_segment_key (or structured_json.segment_key) for structured_* sources.
  hint_segment?: AnalystSegment | string | null;
  // Rescore/audit controls
  disable_structured_segment_key_signal?: boolean;
  disable_structured_segment_key_fallback?: boolean;
};

export type SegmentClassifierOutput = {
  segment: AnalystSegment;
  confidence: number;
  debug?: Record<string, unknown>;
};

export function classifySegment(input: SegmentClassifierInput): SegmentClassifierOutput {
  const TITLE_MATCH_CONFIDENCE = 0.95;
  const TITLE_INTENT_CONFIDENCE = 0.8;
  const BODY_SCORE_THRESHOLD = 0.5;
  const TIE_DELTA_EPS = 0.1;
  const NORMALIZE_SCALE = 5;
  const MIN_CAPTURED_TEXT_LEN = 18;

  const HINT_BOOST = 0.5;
  const PRODUCT_PLACEHOLDER_BOOST = 0.2;

  // unknown must never accumulate meaningful score.
  const UNKNOWN_EPS = 0.00001;

  const enableDebug = input.enable_debug === true;
  const includeDebugTextSnippet = enableDebug && input.include_debug_text_snippet === true;
  const extractorVersion = typeof input.extractor_version === "string" ? input.extractor_version : null;
  const qualitySource = typeof input.quality_source === "string" ? input.quality_source : null;

  const normalized = (value: unknown): string | null => {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed ? trimmed.toLowerCase() : null;
  };

  const normalizeForMatch = (value: unknown): string =>
    normalizeWhitespace(typeof value === "string" ? value : "")
      .toLowerCase()
      .replace(/[\u2013\u2014]/g, "-")
      .replace(/[^a-z0-9\s\-]/g, " ")
      .replace(/[\s\-]+/g, " ")
      .trim();

  const normalizeScore = (raw: number): number => {
    const safe = Number.isFinite(raw) ? raw : 0;
    return Math.max(0, Math.min(1, safe / NORMALIZE_SCALE));
  };

  const hasAny = (text: string, phrases: string[]): { hit: boolean; matched: string[] } => {
    const matched: string[] = [];
    for (const p of phrases) {
      const needle = normalizeForMatch(p);
      if (!needle) continue;
      if (text.includes(needle)) matched.push(p);
    }
    return { hit: matched.length > 0, matched };
  };

  const termToRegex = (term: string): RegExp => {
    const raw = term.trim();
    // Allow whitespace/hyphen flexibility for multiword terms.
    const escaped = escapeRegExp(raw)
      .replace(/\\\s+/g, "\\s+")
      .replace(/\\-/g, "[\\s-]+");
    const startsWord = /[A-Za-z0-9]/.test(raw[0] ?? "");
    const endsWord = /[A-Za-z0-9]/.test(raw[raw.length - 1] ?? "");
    const prefix = startsWord ? "\\b" : "";
    const suffix = endsWord ? "\\b" : "";
    return new RegExp(`${prefix}${escaped}${suffix}`, "i");
  };

  const scoreByTerms = (
    text: string,
    terms: Array<{ term: string; weight?: number }>
  ): { raw: number; matched: string[] } => {
    const matched: string[] = [];
    let rawScore = 0;
    for (const t of terms) {
      const w = typeof t.weight === "number" && Number.isFinite(t.weight) ? t.weight : 1;
      const re = termToRegex(t.term);
      if (!re.test(text)) continue;
      matched.push(t.term);
      rawScore += w;
    }
    return { raw: rawScore, matched };
  };

  // Intentionally restrict this to *action* phrases.
  // We still allow nouns like "platform"/"engine" to count as product terms,
  // but we require an action phrase somewhere in BODY+HEADINGS to classify as product/solution.
  const functionalVerbPhrases = ["integrates", "predicts", "automates"];

  const brandTokens: string[] = [];
  if (input.brand_blacklist instanceof Set) {
    brandTokens.push(...Array.from(input.brand_blacklist));
  } else if (Array.isArray(input.brand_blacklist)) {
    brandTokens.push(...input.brand_blacklist);
  }
  const bn = normalized(input.brand_name);
  if (bn) brandTokens.push(bn);

  const normalizedBrandTokens = Array.from(
    new Set(brandTokens.map(normalized).filter((t): t is string => typeof t === "string" && t.length >= 3))
  );

  const headingKeywords = [
    "traction",
    "business model",
    "pricing",
    "product",
    "products",
    "go-to-market",
    "go to market",
    "distribution",
    "market",
    "competition",
    "team",
    "meet our team",
    "financial",
    "financials",
    "financial strategy",
    "exit",
    "exit strategy",
    "use of funds",
  ];

  const findHeadingKeyword = (value: string | null): string | null => {
    if (!value) return null;
    const lower = value.toLowerCase();
    for (const kw of headingKeywords) {
      const idx = lower.indexOf(kw);
      if (idx >= 0) return value.slice(idx, idx + kw.length);
    }
    return null;
  };

  const stripBrands = (value: string, preserveHeading?: string | null): string => {
    let cleaned = value;
    for (const token of normalizedBrandTokens) {
      const pattern = new RegExp(`\\b${escapeRegExp(token.toLowerCase())}\\b`, "gi");
      cleaned = cleaned.replace(pattern, " ");
    }
    cleaned = cleaned.replace(/\s+/g, " ").trim();

    if (preserveHeading) {
      const lowerHeading = preserveHeading.toLowerCase();
      if (!cleaned.toLowerCase().includes(lowerHeading)) {
        cleaned = cleaned ? `${preserveHeading} ${cleaned}`.trim() : preserveHeading;
      }
    }

    return cleaned;
  };

  const isTitleUsable = (title: string | null): boolean => {
    if (typeof title !== "string") return false;
    const collapsed = title.trim().replace(/\s+/g, " ");
    if (!collapsed || collapsed.length < 3) return false;

    const alphaCount = (collapsed.match(/[A-Za-z]/g) || []).length;
    if (alphaCount / collapsed.length < 0.45) return false;

    const nonAlnumRatio = (collapsed.match(/[^A-Za-z0-9\s]/g) || []).length / Math.max(1, collapsed.length);
    if (nonAlnumRatio > 0.25) return false;
    if (/[~™©®]/.test(collapsed)) return false;

    const words = collapsed.split(/\s+/).filter(Boolean);
    const headingFromTitle = findHeadingKeyword(collapsed);
    if (words.length <= 2 && !headingFromTitle) return false;

    const stripped = stripBrands(collapsed, headingFromTitle);
    if (!stripped) return false;
    const strippedAlpha = (stripped.match(/[A-Za-z]/g) || []).length;
    if (strippedAlpha === 0) return false;

    return true;
  };

  const features = buildSegmentFeatures({
    ocr_text: input.ocr_text,
    ocr_blocks: input.ocr_blocks,
    structured_kind: input.structured_kind,
    structured_summary: input.structured_summary,
    structured_json: input.structured_json,
    labels: input.labels,
    asset_type: input.asset_type,
    page_index: input.page_index,
    evidence_snippets: input.evidence_snippets,
    extractor_version: extractorVersion,
    quality_source: qualitySource,
    document_title: input.document_title,
    document_mime_type: input.document_mime_type,
    document_filename: input.document_filename,
    brand_blacklist: input.brand_blacklist,
    brand_name: input.brand_name,
    enable_debug: enableDebug,
  });

  const hintFromCaller = normalizeAnalystSegment((input as any)?.hint_segment);
  const hintFromStructured = input.disable_structured_segment_key_signal === true ? null : features.structured_segment_hint;
  const hintSegment: AnalystSegment | null = hintFromCaller ?? hintFromStructured;

  const classificationText = buildClassificationText(features);
  const headingFromTitle = findHeadingKeyword(features.title || null);

  const titleRaw = normalizeWhitespace(features.title || "");
  const titleStripped = stripBrands(titleRaw, headingFromTitle);
  const titleMatchText = normalizeForMatch(titleStripped);

  const scoringRaw = normalizeWhitespace([...(features.headings ?? []), features.body ?? ""].filter(Boolean).join("\n")).slice(0, 1800);
  const scoringStripped = stripBrands(scoringRaw, headingFromTitle);
  const scoringText = normalizeForMatch(scoringStripped);

  const evidenceRaw = Array.isArray(features.evidence_snippets) ? features.evidence_snippets.join("\n") : "";
  const evidenceText = normalizeForMatch(stripBrands(evidenceRaw, null));

  const hasFunctionalVerb = hasAny(scoringText, functionalVerbPhrases).hit;

  // Rule 1 label matching helper.
  const matchHardTitleLabel = (text: string): { segment: AnalystSegment; term: string } | null => {
    const t = text;
    if (!t) return null;
    const map: Array<{ term: string; re: RegExp; segment: AnalystSegment }> = [
      { term: "company overview", re: /\bcompany\s+overview\b/i, segment: "overview" },
      { term: "overview", re: /\boverview\b/i, segment: "overview" },
      { term: "introduction", re: /\bintroduction\b/i, segment: "overview" },
      { term: "summary", re: /\bsummary\b/i, segment: "overview" },
      { term: "agenda", re: /\bagenda\b/i, segment: "overview" },
      { term: "market problem", re: /\bmarket\s+problem\b/i, segment: "problem" },
      { term: "problem", re: /\bproblem\b/i, segment: "problem" },
      // Keep product/solution title matches strict to avoid company names like
      // "<Brand> ... Solutions" triggering the solution segment.
      { term: "products", re: /^(?:our\s+)?products$/i, segment: "product" },
      { term: "product", re: /^(?:our\s+)?product$/i, segment: "product" },
      { term: "product overview", re: /^(?:our\s+)?product\s+overview$/i, segment: "product" },
      { term: "platform", re: /^(?:our\s+)?platform$/i, segment: "product" },
      { term: "how it works", re: /\bhow\s+it\s+works\b/i, segment: "product" },
      { term: "solution", re: /^(?:our\s+)?solution$/i, segment: "solution" },
      { term: "solutions", re: /^(?:our\s+)?solutions$/i, segment: "solution" },
      { term: "solution overview", re: /^(?:our\s+)?solution\s+overview$/i, segment: "solution" },
      { term: "traction", re: /\btraction\b/i, segment: "traction" },
      { term: "distribution", re: /\bdistribution\b/i, segment: "distribution" },
      { term: "go-to-market", re: /\bgo\s*(?:-|\s)to\s*(?:-|\s)market\b/i, segment: "distribution" },
      { term: "go to market", re: /\bgo\s+to\s+market\b/i, segment: "distribution" },
      { term: "gtm", re: /\bgtm\b/i, segment: "distribution" },
      { term: "route to market", re: /\broute\s+to\s+market\b/i, segment: "distribution" },
      { term: "marketing strategy", re: /\bmarketing\s+strategy\b/i, segment: "distribution" },
      { term: "sales and marketing", re: /\bsales\s+(?:and|&)\s+marketing\b/i, segment: "distribution" },
      { term: "business model", re: /\bbusiness\s+model\b/i, segment: "business_model" },
      { term: "financial strategy", re: /\bfinancial\s+strategy\b/i, segment: "financials" },
      { term: "financials", re: /\bfinancials\b/i, segment: "financials" },
      { term: "use of funds", re: /\buse\s+of\s+funds\b/i, segment: "raise_terms" },
      { term: "allocation of funds", re: /\ballocation\s+of\s+funds\b/i, segment: "raise_terms" },
      { term: "exit strategy", re: /\bexit\s+strategy\b/i, segment: "exit" },
      { term: "exit", re: /\bexit\b/i, segment: "exit" },
      { term: "meet our team", re: /\bmeet\s+our\s+team\b/i, segment: "team" },
      { term: "team", re: /\bteam\b/i, segment: "team" },
    ];

    for (const entry of map) {
      if (entry.re.test(t)) return { segment: entry.segment, term: entry.term };
    }
    return null;
  };

  const titleIntent = hasAny(titleMatchText, ["why this matters", "value", "impact"]);

  // Rule 3 keyword lists (BODY + HEADINGS).
  const segmentTerms: Record<Exclude<AnalystSegment, "overview" | "unknown">, Array<{ term: string; weight?: number }>> = {
    problem: [
      { term: "problem" },
      { term: "pain" },
      { term: "pain point" },
      { term: "challenge" },
      { term: "issue" },
      { term: "gap" },
      { term: "inefficient" },
      { term: "lack of" },
    ],
    solution: [
      { term: "solution" },
      { term: "approach" },
      { term: "value proposition" },
      { term: "impact" },
      { term: "benefit" },
      { term: "benefits" },
      { term: "outcome" },
      { term: "outcomes" },
      { term: "solve" },
      { term: "solving" },
      { term: "seamlessly integrates" },
    ],
    product: [
      { term: "product" },
      { term: "products" },
      { term: "feature" },
      { term: "features" },
      { term: "module" },
      { term: "modules" },
      { term: "platform", weight: 0.5 },
      { term: "engine", weight: 0.5 },
      { term: "workflow", weight: 0.5 },
      { term: "capability" },
      { term: "capabilities" },
      { term: "how it works" },
      { term: "demo" },
      { term: "architecture" },
    ],
    market: [
      { term: "market" },
      { term: "tam" },
      { term: "sam" },
      { term: "som" },
      { term: "opportunity" },
      { term: "sizing" },
      { term: "cagr" },
    ],
    traction: [
      { term: "traction" },
      { term: "growth" },
      { term: "customers" },
      { term: "users" },
      { term: "revenue" },
      { term: "arr" },
      { term: "mrr" },
      { term: "retention" },
      { term: "pipeline" },
      { term: "kpi" },
      { term: "conversion" },
      { term: "lift" },
    ],
    business_model: [
      { term: "business model", weight: 2 },
      { term: "pricing", weight: 2 },
      { term: "revenue model", weight: 2 },
      { term: "unit economics", weight: 2 },
      { term: "how we make money" },
      { term: "subscription" },
      { term: "saas", weight: 2 },
      { term: "add-ons" },
      { term: "add ons" },
      { term: "addons" },
      { term: "tier" },
      { term: "tiers" },
      { term: "plan" },
      { term: "plans" },
      { term: "arpu" },
      { term: "take rate" },
    ],
    distribution: [
      { term: "distribution" },
      { term: "go-to-market" },
      { term: "go to market" },
      { term: "gtm" },
      { term: "channels" },
      { term: "channel" },
      { term: "partner", weight: 2 },
      { term: "partners", weight: 2 },
      { term: "reseller", weight: 2 },
      { term: "resellers", weight: 2 },
      { term: "sales" },
      { term: "marketing" },
      { term: "partnerships" },
    ],
    team: [
      { term: "team" },
      { term: "meet our team" },
      { term: "founder" },
      { term: "ceo" },
      { term: "cto" },
      { term: "cfo" },
      { term: "leadership" },
      { term: "advisors" },
    ],
    competition: [
      { term: "competition" },
      { term: "competitor" },
      { term: "competitive" },
      { term: "alternatives" },
      { term: "landscape" },
      { term: "moat" },
      { term: "differentiation" },
    ],
    risks: [
      { term: "risk" },
      { term: "risks" },
      { term: "mitigation" },
      { term: "regulation" },
      { term: "compliance" },
      { term: "threat" },
    ],
    financials: [
      { term: "financial" },
      { term: "financials" },
      { term: "forecast" },
      { term: "projection" },
      { term: "projections" },
      { term: "margin" },
      { term: "gross margin" },
      { term: "cash" },
      { term: "income" },
      { term: "profit" },
      { term: "loss" },
      { term: "p&l" },
      { term: "ebitda" },
      { term: "budget" },
    ],
    raise_terms: [
      { term: "use of funds" },
      { term: "allocation of funds" },
      { term: "funding" },
      { term: "raise" },
      { term: "round" },
      { term: "terms" },
      { term: "cap table" },
      { term: "valuation" },
      { term: "term sheet" },
      { term: "pre money" },
      { term: "post money" },
      { term: "safe" },
      { term: "convertible" },
    ],
    exit: [
      { term: "exit" },
      { term: "exit strategy", weight: 2 },
      { term: "acquisition", weight: 2 },
      { term: "m&a", weight: 2 },
      { term: "strategic buyers", weight: 3 },
      { term: "acquirer", weight: 2 },
      { term: "acquirers", weight: 2 },
    ],
  };

  const solutionBenefitTerms = [
    "value proposition",
    "value prop",
    "benefit",
    "benefits",
    "impact",
    "outcome",
    "outcomes",
    "results",
    "roi",
    "saves",
    "save time",
    "reduces",
    "reduce cost",
    "improves",
    "increase",
  ];

  const productFeatureTerms = [
    "feature",
    "features",
    "module",
    "modules",
    "how it works",
    "architecture",
    "workflow",
    "platform",
    "integrates",
    "integration",
    "demo",
  ];

  const evidenceWeight = 1.0;
  const scoreRows: Array<{ segment: AnalystSegment; score: number; matched_body: string[]; matched_evidence: string[] }> = [];

  const keywordHits: Record<string, { title: string[]; body: string[]; evidence: string[] }> = {};

  const titleTermsBySegment: Partial<Record<AnalystSegment, string[]>> = {
    problem: ["market problem", "problem"],
    market: ["market", "tam", "sam", "som"],
    traction: ["traction"],
    product: ["product", "products", "platform", "how it works"],
    solution: ["solution", "solutions"],
    financials: ["financials", "forecast", "projection"],
    raise_terms: ["use of funds", "term sheet", "valuation", "cap table", "round"],
    distribution: ["go to market", "go-to-market", "gtm", "distribution"],
    team: ["team"],
    competition: ["competition", "competitors"],
    risks: ["risks", "risk"],
    business_model: ["business model", "pricing"],
    exit: ["exit"],
    overview: ["overview", "company overview"],
  };

  for (const seg of canonicalSegments) {
    if (seg === "unknown") continue;
    const titleHit = hasAny(titleMatchText, titleTermsBySegment[seg] ?? []);
    keywordHits[seg] = { title: titleHit.matched, body: [], evidence: [] };
  }

  for (const seg of Object.keys(segmentTerms) as Array<Exclude<AnalystSegment, "overview" | "unknown">>) {
    const body = scoreByTerms(scoringStripped, segmentTerms[seg]);
    const ev = scoreByTerms(evidenceRaw, segmentTerms[seg]);
    keywordHits[seg] = keywordHits[seg] ?? { title: [], body: [], evidence: [] };
    keywordHits[seg].body = body.matched;
    keywordHits[seg].evidence = ev.matched;

    const rawWithTable = seg === "financials" && features.has_table ? body.raw + 1 : body.raw;
    const combinedRaw = rawWithTable + ev.raw * evidenceWeight;
    scoreRows.push({ segment: seg, score: normalizeScore(combinedRaw), matched_body: body.matched, matched_evidence: ev.matched });
  }

  // Product vs solution shaping.
  const benefitHits = scoreByTerms(`${scoringStripped}\n${evidenceRaw}`, solutionBenefitTerms.map((t) => ({ term: t, weight: 1 }))).raw;
  const featureHits = scoreByTerms(`${scoringStripped}\n${evidenceRaw}`, productFeatureTerms.map((t) => ({ term: t, weight: 1 }))).raw;

  let ranked = scoreRows.sort((a, b) => b.score - a.score);

  const adjustScore = (segment: AnalystSegment, delta: number) => {
    if (segment === "unknown") return;
    if (!ranked.some((r) => r.segment === segment)) {
      ranked.push({ segment, score: 0, matched_body: [], matched_evidence: [] } as any);
    }
    ranked = ranked.map((r) => (r.segment === segment ? { ...r, score: Math.max(0, Math.min(1, r.score + delta)) } : r));
    ranked.sort((a, b) => b.score - a.score);
  };

  if (featureHits > benefitHits + 1) adjustScore("product", 0.08);
  if (benefitHits > featureHits + 1) adjustScore("solution", 0.08);

  const scoringAdjustments: Array<{ rule_id: string; segment: AnalystSegment; delta: number; matched_terms: string[] }> = [];

  if (hintSegment && hintSegment !== "unknown") {
    adjustScore(hintSegment, HINT_BOOST);
    scoringAdjustments.push({
      rule_id: "STRUCTURED_HINT_BOOST",
      segment: hintSegment,
      delta: HINT_BOOST,
      matched_terms: [`structured_hint:${hintSegment}`],
    });
  }

  const allowProductPlaceholder = input.quality_source === "structured_word" || (hintSegment != null && hintSegment !== "unknown");
  if (allowProductPlaceholder) {
    const combined = `${titleStripped}\n${scoringStripped}`;
    if (/\bproduct\s+name\b/i.test(combined)) {
      adjustScore("product", PRODUCT_PLACEHOLDER_BOOST);
      scoringAdjustments.push({
        rule_id: "PRODUCT_PLACEHOLDER",
        segment: "product",
        delta: PRODUCT_PLACEHOLDER_BOOST,
        matched_terms: ["product name"],
      });
    }
  }

  const best = ranked[0] ?? { segment: "unknown" as AnalystSegment, score: 0, matched_body: [] as string[], matched_evidence: [] as string[] };
  const second = ranked[1] ?? { segment: "unknown" as AnalystSegment, score: 0, matched_body: [] as string[], matched_evidence: [] as string[] };
  const tieDelta = best.score - second.score;

  type RankedEntry = { segment: string; score: number };
  const sortRanked = (entries: RankedEntry[]): RankedEntry[] => entries.slice().sort((a, b) => b.score - a.score);

  const ensureDebugConsistency = (
    debug: Record<string, unknown> | undefined,
    chosenSegment: AnalystSegment,
    override?: { rule_id: string; explanation: string }
  ): Record<string, unknown> | undefined => {
    if (!enableDebug || !debug) return debug;

    const preRaw = Array.isArray((debug as any).top_scores) ? (debug as any).top_scores : [];
    const pre: RankedEntry[] = preRaw
      .filter((s: any) => s && typeof s === "object")
      .map((s: any) => ({ segment: String((s as any).segment), score: Number((s as any).score) }))
      .filter((s: RankedEntry) => Number.isFinite(s.score));
    const preSorted = sortRanked(pre);

    const tieDeltaVal =
      typeof (debug as any).tie_delta === "number" && Number.isFinite((debug as any).tie_delta)
        ? Number((debug as any).tie_delta)
        : TIE_DELTA_EPS;
    const chosen = String(chosenSegment);

    // Never boost unknown; it is a true fallback.
    if (chosenSegment === "unknown") {
      const out: any = {
        ...debug,
        top_scores: preSorted,
        best_score: typeof preSorted[0]?.score === "number" ? preSorted[0].score : null,
        runner_up_score: typeof preSorted[1]?.score === "number" ? preSorted[1].score : null,
      };
      if (override) {
        out.override_applied = true;
        out.override_rule_id = override.rule_id;
        out.override_explanation = override.explanation;
        out.top_scores_pre_override = preSorted;
      }
      return out;
    }

    if (!override && preSorted[0]?.segment === chosen) {
      const out = { ...debug, top_scores: preSorted } as any;
      out.best_score = typeof preSorted[0]?.score === "number" ? preSorted[0].score : out.best_score;
      out.runner_up_score = typeof preSorted[1]?.score === "number" ? preSorted[1].score : out.runner_up_score;
      return out;
    }

    const currentBest = typeof preSorted[0]?.score === "number" ? preSorted[0].score : 0;
    const boostedScore = currentBest + Math.max(tieDeltaVal, 0.0001) + 0.00001;
    const postMap = new Map<string, number>();
    for (const s of preSorted) postMap.set(s.segment, s.score);
    postMap.set(chosen, Math.max(postMap.get(chosen) ?? 0, boostedScore));

    const post = sortRanked(Array.from(postMap.entries()).map(([segment, score]) => ({ segment, score })));
    const out: any = {
      ...debug,
      top_scores_pre_override: preSorted,
      top_scores: post,
      best_score: typeof post[0]?.score === "number" ? post[0].score : null,
      runner_up_score: typeof post[1]?.score === "number" ? post[1].score : null,
      override_applied: true,
      override_rule_id: override?.rule_id ?? "override",
      override_explanation: override?.explanation ?? "override applied",
    };
    return out;
  };

  const debugBase = enableDebug
    ? {
        classification_source:
          features.source_kind === "vision" || features.source_kind === "image" ? "vision" : "structured",
        classification_text_len: classificationText.length,
        captured_text: classificationText.slice(0, 800),
        ...(includeDebugTextSnippet ? { classification_text_snippet: classificationText.slice(0, 250) } : {}),
        segment_features: features,
        title_text_snippet: features.title_text ? features.title_text.slice(0, 200) : null,
        title_source: features.title_source,
        keyword_hits: keywordHits,
        scoring_adjustments: scoringAdjustments,
        top_scores: ranked.map((r: { segment: AnalystSegment; score: number }) => ({ segment: r.segment, score: r.score })),
        best_score: best.score,
        runner_up_score: second.score,
        threshold: BODY_SCORE_THRESHOLD,
        tie_delta: TIE_DELTA_EPS,
      }
    : undefined;

  // Rule 1: Hard title labels.
  const hardTitle = matchHardTitleLabel(titleMatchText);
  if (hardTitle) {
    const outDebug = enableDebug
      ? {
          ...debugBase,
          rule_id: "TITLE_MATCH",
          matched_terms: [hardTitle.term],
          threshold: BODY_SCORE_THRESHOLD,
          tie_delta: tieDelta,
        }
      : undefined;
    return {
      segment: hardTitle.segment,
      confidence: TITLE_MATCH_CONFIDENCE,
      debug: ensureDebugConsistency(outDebug, hardTitle.segment, {
        rule_id: "TITLE_MATCH",
        explanation: `TITLE contains hard label: ${hardTitle.term}`,
      }),
    };
  }

  // Rule 2: Title intent keywords.
  if (titleIntent.hit) {
    const pos = hasAny(scoringText, [
      "lift",
      "improves",
      "seamlessly integrates",
      "capability",
      "solve",
      "solves",
      "solving",
      "solution",
    ]);
    const neg = hasAny(scoringText, ["pain", "lack of", "inefficient"]);
    const chosen: AnalystSegment = neg.hit ? "problem" : pos.hit || hasFunctionalVerb ? "solution" : "problem";
    const matched = Array.from(new Set([...(titleIntent.matched ?? []), ...(pos.matched ?? []), ...(neg.matched ?? [])]));
    const outDebug = enableDebug
      ? {
          ...debugBase,
          rule_id: "TITLE_INTENT",
          matched_terms: matched,
          tie_delta: tieDelta,
        }
      : undefined;
    return {
      segment: chosen,
      confidence: TITLE_INTENT_CONFIDENCE,
      debug: ensureDebugConsistency(outDebug, chosen, {
        rule_id: "TITLE_INTENT",
        explanation: "TITLE contains intent phrase; body keywords select problem vs solution",
      }),
    };
  }

  // Deterministic table routing: if the extractor detected a table-like asset,
  // route to financials before falling back to low-signal body scoring.
  if (features.has_table) {
    const outDebug = enableDebug
      ? {
          ...debugBase,
          rule_id: "TABLE_TO_FINANCIALS",
          matched_terms: ["table"],
          threshold: BODY_SCORE_THRESHOLD,
          tie_delta: tieDelta,
        }
      : undefined;
    return {
      segment: "financials",
      confidence: 0.85,
      debug: ensureDebugConsistency(outDebug, "financials", {
        rule_id: "TABLE_TO_FINANCIALS",
        explanation: "Detected table structure; routing to financials",
      }),
    };
  }

  // Rule 3: Body+evidence keyword scoring.
  const bestScore = best.score;
  const chosenFromBody = best.segment;
  const baseDebug = enableDebug
    ? {
        ...debugBase,
        rule_id: "BODY_SCORE",
        matched_terms: Array.from(new Set([...(best.matched_body ?? []), ...(best.matched_evidence ?? [])])),
        threshold: BODY_SCORE_THRESHOLD,
        tie_delta: tieDelta,
      }
    : undefined;

  const titleReallyEmpty = typeof features.title_text === "string" ? features.title_text.trim().length === 0 : true;
  const capturedLen =
    (typeof titleMatchText === "string" ? titleMatchText.length : 0) +
    (typeof scoringText === "string" ? scoringText.length : 0) +
    (typeof evidenceText === "string" ? evidenceText.length : 0);

  const finalizeUnknown = (reason: UnknownReasonCode): SegmentClassifierOutput => {
    const outDebug = enableDebug
      ? {
          ...(baseDebug ?? {}),
          rule_id: "UNKNOWN",
          unknown_reason_code: reason,
          matched_terms: [],
        }
      : undefined;

    if (hintSegment && hintSegment !== "unknown") {
      const matchedTerms = [
        ...(hintFromCaller ? ["persisted_segment_key"] : []),
        ...(hintFromCaller ? [] : ["structured_json.segment_key"]),
        `structured_hint:${hintSegment}`,
      ];

      const forcedDebug = enableDebug
        ? {
            ...(outDebug ?? {}),
            rule_id: "STRUCTURED_HINT_FALLBACK",
            matched_terms: matchedTerms,
            unknown_reason_code: null,
            // Ensure unknown remains epsilon-ish if someone inspects scores.
            unknown_score: UNKNOWN_EPS,
          }
        : undefined;

      return {
        segment: hintSegment,
        confidence: Math.max(BODY_SCORE_THRESHOLD, 0.5),
        debug: ensureDebugConsistency(forcedDebug, hintSegment, {
          rule_id: "STRUCTURED_HINT_FALLBACK",
          explanation: `Forced to hint segment (${hintSegment}) because classifier returned unknown (${reason})`,
        }),
      };
    }

    return {
      segment: "unknown",
      confidence: 0,
      debug: ensureDebugConsistency(
        {
          ...(outDebug ?? {}),
          unknown_score: UNKNOWN_EPS,
        },
        "unknown",
        {
          rule_id: "UNKNOWN",
          explanation: `Classified as unknown (${reason})`,
        }
      ),
    };
  };

  if (capturedLen < MIN_CAPTURED_TEXT_LEN && titleReallyEmpty) {
    return finalizeUnknown("NO_TEXT");
  }

  if (bestScore < BODY_SCORE_THRESHOLD) {
    return finalizeUnknown("LOW_SIGNAL");
  }

  if (second.score >= BODY_SCORE_THRESHOLD && Math.abs(best.score - second.score) <= TIE_DELTA_EPS) {
    return finalizeUnknown("AMBIGUOUS_TIE");
  }

  return {
    segment: chosenFromBody,
    confidence: bestScore,
    debug: ensureDebugConsistency(baseDebug, chosenFromBody),
  };
}
