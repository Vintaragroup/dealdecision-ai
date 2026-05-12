import type { Pool } from "pg";
import { normalizeAnalystSegment, type AnalystSegment } from "./analyst-segment";
import { segmentDpuPage } from "./segment-dpu-page";
import { assessTextQuality, sanitizeForDisplay } from "./text-quality";

const asNonEmptyString = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

// Patterns used by the page_text bullet fallback to pre-filter garbage lines before
// normalizeAndFilterLines is applied.  These catch SEC/legal headers and balance-sheet
// table rows that should never surface as product/market bullet candidates.
const PAGE_TEXT_SEC_HEADER_RE = /\b(?:securities\s+and\s+exchange\s+commission|exhibit\s+\d|form\s+[fs]-?\d|pursuant\s+to\s+section|annual\s+report\s+on\s+form|proxy\s+statement)\b/i;
const PAGE_TEXT_BALANCE_SHEET_RE = /\b(?:term\s+loan|net\s+of\s+discounts?|total\s+liabilities|total\s+assets|convertible\s+notes?\s+payable|derivative\s+warrant|lease\s+liabilities|stockholders.{0,5}equity)\b/i;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isMissingTableError(err: any): boolean {
  return String(err?.code ?? "") === "42P01";
}

export type SegmentedDealNode = {
  node_id: string;
  document_id: string;
  source_document_id: string;
  page_index: number;
  slide_title: string | null;
  bullets: string[];
  bullets_snippet: string;
  visual_asset_id: string | null;
  segment_key: AnalystSegment | null;
  structured_segment_key_raw: string | null;
  quality_flags_segment_key_raw: string | null;
  segment_reason: {
    rules_hit: string[];
    keywords_hit: string[];
    classifier_confidence: number | null;
    source: "deterministic" | "hybrid" | "unknown";
  };
};

export type DroppedLine = { line: string; reason: string };

const normalizeWhitespace = (s: string): string => s.replace(/\s+/g, " ").trim();

const countMatches = (s: string, re: RegExp): number => {
  const m = s.match(re);
  return m ? m.length : 0;
};

const symbolRatio = (s: string): number => {
  const cleaned = s.replace(/\s+/g, "");
  if (!cleaned) return 0;
  const symbols = countMatches(cleaned, /[^a-zA-Z0-9]/g);
  return symbols / cleaned.length;
};

const digitRatio = (s: string): number => {
  const cleaned = s.replace(/\s+/g, "");
  if (!cleaned) return 0;
  const digits = countMatches(cleaned, /\d/g);
  return digits / cleaned.length;
};

const hasKpiContext = (s: string): boolean => {
  const t = s.toLowerCase();
  return /\b(revenue|arr|mrr|gmv|cagr|growth|margin|gross\s+margin|burn|runway|conversion|cac|ltv|ebitda|customers?|users?|accounts?|retailers?|courses?|locations?|stores?)\b/i.test(t);
};

const whitespaceRatio = (s: string): number => {
  if (!s) return 0;
  const spaces = countMatches(s, /\s/g);
  return spaces / s.length;
};

const hasRepeatedPunctuationRun = (s: string): boolean => {
  return /[|]{3,}/.test(s) || /[.]{6,}/.test(s) || /[-_]{8,}/.test(s) || /[=]{5,}/.test(s) || /[!]{4,}/.test(s);
};

export function normalizeAndFilterLines(lines: string[]): { kept: string[]; dropped: DroppedLine[] } {
  const kept: string[] = [];
  const dropped: DroppedLine[] = [];

  for (const raw of Array.isArray(lines) ? lines : []) {
    const original = typeof raw === "string" ? raw : "";
    let line = normalizeWhitespace(original.replace(/^\s*[-•\u2022]+\s*/g, ""));
    if (!line) {
      dropped.push({ line: original, reason: "empty" });
      continue;
    }

    if (/(confidential|all rights reserved|©|copyright)/i.test(line)) {
      dropped.push({ line, reason: "boilerplate" });
      continue;
    }
    if (/(http|https|www\.)/i.test(line)) {
      dropped.push({ line, reason: "url" });
      continue;
    }

    // Very long footer-like lines (often legal blocks or OCR concatenation)
    if (line.length >= 220 && whitespaceRatio(line) <= 0.06) {
      dropped.push({ line, reason: "long_footer" });
      continue;
    }

    const sRatio = symbolRatio(line);
    const dRatio = digitRatio(line);
    if (sRatio > 0.25) {
      dropped.push({ line, reason: "ocr_symbol_ratio" });
      continue;
    }
    // Digit-heavy lines are often table scraps / OCR concat, but KPI bullets can be
    // legitimately numeric (e.g. "$800,000 in revenue", "3.2% conversion").
    // Only drop digit-heavy lines when they lack obvious KPI context.
    if (dRatio > 0.25 && !hasKpiContext(line)) {
      dropped.push({ line, reason: "ocr_digit_ratio" });
      continue;
    }

    const tokens = line.split(/\s+/g).filter(Boolean);
    const wordCount = tokens.length;
    const avgTokenLen = wordCount > 0 ? tokens.reduce((acc, t) => acc + t.length, 0) / wordCount : 0;
    if (avgTokenLen > 18 && wordCount < 6) {
      dropped.push({ line, reason: "ocr_token_shape" });
      continue;
    }
    if (hasRepeatedPunctuationRun(line)) {
      dropped.push({ line, reason: "punctuation_run" });
      continue;
    }

    kept.push(line);
  }

  return { kept, dropped };
}

function slideTitleFromPayload(payload: any): string | null {
  const structured = payload?.structured ?? null;
  const textBlocks = payload?.text_blocks ?? null;
  return (
    asNonEmptyString(structured?.title) ??
    asNonEmptyString(structured?.slide_title) ??
    asNonEmptyString(textBlocks?.title) ??
    null
  );
}

function bulletLinesFromPayload(payload: any): { kept: string[]; dropped: DroppedLine[] } {
  const structured = payload?.structured ?? null;
  const textBlocks = payload?.text_blocks ?? null;
  const bullets: unknown = Array.isArray(structured?.bullets) ? structured.bullets : Array.isArray(textBlocks?.bullets) ? textBlocks.bullets : null;

  // Primary path: use structured bullets when present.
  if (Array.isArray(bullets) && bullets.length > 0) {
    const rawLines: string[] = [];
    for (const b of bullets) {
      const s = asNonEmptyString(b);
      if (!s) continue;
      // Split multi-line bullets and inline bullet separators.
      for (const piece of s.split(/\r?\n/g)) {
        const trimmed = piece.trim();
        if (!trimmed) continue;
        if (trimmed.includes("•")) {
          rawLines.push(...trimmed.split(/\s*•\s*/g));
        } else {
          rawLines.push(trimmed);
        }
      }
    }
    return normalizeAndFilterLines(rawLines);
  }

  // Fallback: derive candidate lines from page_text when structured bullets are absent.
  // This recovers narrative content from text-PDF pages and OCR-heavy decks that lack
  // LLM-structured bullets, enabling downstream segment classification and summary building.
  // Kept conservative: minimum line length, SEC/balance-sheet pre-filter, 20-line cap.
  const pageText = typeof payload?.page_text === "string" ? payload.page_text.trim() : "";
  if (!pageText) return { kept: [], dropped: [] };

  // Pre-strip inline copyright/confidentiality footers that PPTX OCR embeds in slide text.
  // Pattern: "© 2023 COMPANY NAME - PROPRIETARY INFORMATION – CONFIDENTIAL".
  // We replace the footer with a double-space so the subsequent \s{2,} split can
  // cleanly separate content that appeared before and after the footer in the original.
  const stripped = pageText
    .replace(/©[^\n]{0,150}?(?:CONFIDENTIAL|PROPRIETARY\s+INFORMATION)/gi, "  ")
    .trim();
  if (!stripped) return { kept: [], dropped: [] };

  // Split on real newlines OR on 2+ consecutive spaces (OCR column / region boundaries).
  // Also cap line length at 240 chars so downstream consumers (bestBullet maxLen=260) can
  // use the resulting lines. Lines longer than 240 chars are usually concatenated SEC or
  // legal prose that the SEC_HEADER and BALANCE_SHEET filters will catch anyway.
  const candidates = stripped
    .split(/\r?\n|\s{2,}/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 25 && s.length <= 240)
    .filter((s) => !PAGE_TEXT_SEC_HEADER_RE.test(s))
    .filter((s) => !PAGE_TEXT_BALANCE_SHEET_RE.test(s))
    .slice(0, 20);

  return normalizeAndFilterLines(candidates);
}

function bulletsFromPayload(payload: any, maxBullets = 12): string[] {
  const { kept } = bulletLinesFromPayload(payload);
  const out: string[] = [];
  for (const line of kept) {
    if (out.length >= maxBullets) break;
    const cleaned = sanitizeForDisplay(line);
    const assessed = assessTextQuality(cleaned);
    // Hard rule: do not allow garbage OCR/boilerplate to become a bullet candidate.
    if (!(assessed.quality === "good" || assessed.quality === "ok") || !assessed.display) continue;
    out.push(assessed.display);
  }
  return out;
}

function segmentFromTitleAndBullets(input: { title: string | null; bullets: string[] }): {
  segment_key: AnalystSegment;
  confidence: number;
  reason: { title_rules_hit: string[]; bullet_rules_hit: string[]; override_rules_hit: string[]; keywords: string[] };
} {
  return segmentDpuPage({ title: input.title, bullets: input.bullets });
}

function bulletsSnippetFromPayload(payload: any, maxLen: number): string {
  const { kept } = bulletLinesFromPayload(payload);
  const joined = sanitizeForDisplay(kept.slice(0, 12).join(" • "));
  if (!joined) return "";

  const clipped = joined.length <= maxLen ? joined : `${joined.slice(0, Math.max(0, maxLen - 1)).trimEnd()}…`;
  const assessed = assessTextQuality(clipped);
  if (!(assessed.quality === 'good' || assessed.quality === 'ok') || !assessed.display) return "";
  return assessed.display;
}

function visualAssetIdFromPayload(payload: any): string | null {
  const p = payload && typeof payload === "object" ? payload : null;
  const source = p?.source && typeof p.source === "object" ? p.source : null;
  const fallback = p?.metadata?.source && typeof p.metadata.source === "object" ? p.metadata.source : null;
  const raw = asNonEmptyString(source?.visual_asset_id) ?? asNonEmptyString(fallback?.visual_asset_id) ?? asNonEmptyString(p?.visual_asset_id);
  return raw && isUuid(raw) ? raw : null;
}

export async function getSegmentedNodesForDeal(pool: Pool, dealId: string): Promise<{ nodes: SegmentedDealNode[]; warnings: string[] }> {
  const warnings: string[] = [];

  let dpuRows: Array<{ document_id: string; page_index: number; payload: any }> = [];
  try {
    const { rows } = await pool.query(
      `
      SELECT document_id::text, page_index, payload
      FROM public.document_page_understanding
      WHERE deal_id = $1::uuid
        AND version = 'page_understanding_v1'
      ORDER BY document_id, page_index
      `,
      [dealId]
    );

    dpuRows = (rows ?? []).map((r: any) => ({
      document_id: String(r.document_id),
      page_index: Number(r.page_index),
      payload: r.payload ?? null,
    }));
  } catch (err) {
    if (isMissingTableError(err)) {
      warnings.push("document_page_understanding table missing");
      return { nodes: [], warnings };
    }
    throw err;
  }

  const visualAssetIds = Array.from(
    new Set(
      dpuRows
        .map((r) => visualAssetIdFromPayload(r.payload))
        .filter((v): v is string => Boolean(v && isUuid(v)))
    )
  );

  const visualAssetById = new Map<string, { quality_flags: any }>();
  if (visualAssetIds.length > 0) {
    try {
      const { rows } = await pool.query(
        `
        SELECT id::text, quality_flags
        FROM visual_assets
        WHERE id = ANY($1::uuid[])
        `,
        [visualAssetIds]
      );
      for (const r of rows ?? []) {
        const id = String((r as any).id);
        visualAssetById.set(id, { quality_flags: (r as any).quality_flags ?? null });
      }
    } catch (err) {
      if (isMissingTableError(err)) {
        warnings.push("visual_assets table missing; segment mapping via quality_flags unavailable");
      } else {
        warnings.push("visual_assets query failed; segment mapping via quality_flags unavailable");
      }
    }
  } else {
    warnings.push("No visual_asset_id references found in DPU payloads");
  }

  const nodes: SegmentedDealNode[] = [];
  for (const r of dpuRows) {
    const p = r.payload && typeof r.payload === "object" ? r.payload : null;
    const structuredKeyRaw = asNonEmptyString(p?.structured?.segment_key);
    const structuredKey = structuredKeyRaw ? normalizeAnalystSegment(structuredKeyRaw) : null;

    const visualAssetId = visualAssetIdFromPayload(p);
    const qualityFlags = visualAssetId ? visualAssetById.get(visualAssetId)?.quality_flags : null;

    const qfKeyRaw = asNonEmptyString(qualityFlags?.segment_key);
    const qfKey = qfKeyRaw ? normalizeAnalystSegment(qfKeyRaw) : null;
    const qfConfidence = typeof qualityFlags?.segment_confidence === "number" ? qualityFlags.segment_confidence : null;
    const qfSource = asNonEmptyString((qualityFlags as any)?.segment_source);
    const qfIsHumanOverride = qfSource === "human_override";

    let segmentKey: AnalystSegment | null = null;
    let segmentReason: SegmentedDealNode["segment_reason"] = {
      rules_hit: [],
      keywords_hit: [],
      classifier_confidence: null,
      source: "unknown",
    };

    const slideTitle = slideTitleFromPayload(p);
    const bullets = bulletsFromPayload(p, 12);
    const deterministic = segmentFromTitleAndBullets({ title: slideTitle, bullets });
    const deterministicIsStrong = deterministic.confidence >= 0.8 || deterministic.reason.title_rules_hit.length > 0;

    // Keep explicit human overrides stable (these are typically curated and should win).
    if (qfIsHumanOverride && qfKey) {
      segmentKey = qfKey;
      segmentReason = {
        rules_hit: ["visual_assets.quality_flags.segment_key"],
        keywords_hit: [],
        classifier_confidence: qfConfidence,
        source: "hybrid",
      };
    } else if (deterministicIsStrong) {
      segmentKey = deterministic.segment_key;
      segmentReason = {
        rules_hit: [
          ...deterministic.reason.title_rules_hit.map((x) => `segmenter:title:${x}`),
          ...deterministic.reason.bullet_rules_hit.map((x) => `segmenter:bullet:${x}`),
          ...deterministic.reason.override_rules_hit.map((x) => `segmenter:override:${x}`),
          "segmenter:dpu_page_v1",
        ],
        keywords_hit: deterministic.reason.keywords,
        classifier_confidence: deterministic.confidence,
        source: "deterministic",
        // include richer diagnostics for inspector
        title_rules_hit: deterministic.reason.title_rules_hit,
        bullet_rules_hit: deterministic.reason.bullet_rules_hit,
        override_rules_hit: deterministic.reason.override_rules_hit,
      } as any;
    } else if (qfKey) {
      segmentKey = qfKey;
      segmentReason = {
        rules_hit: ["visual_assets.quality_flags.segment_key"],
        keywords_hit: [],
        classifier_confidence: qfConfidence,
        source: "hybrid",
      };
    } else if (structuredKey) {
      segmentKey = structuredKey;
      segmentReason = {
        rules_hit: ["payload.structured.segment_key"],
        keywords_hit: [],
        classifier_confidence: null,
        source: "deterministic",
      };
    } else if (deterministic.segment_key !== "unknown" && deterministic.confidence > 0) {
      // Weak but non-empty deterministic fallback.
      segmentKey = deterministic.segment_key;
      segmentReason = {
        rules_hit: [
          ...deterministic.reason.title_rules_hit.map((x) => `segmenter:title:${x}`),
          ...deterministic.reason.bullet_rules_hit.map((x) => `segmenter:bullet:${x}`),
          ...deterministic.reason.override_rules_hit.map((x) => `segmenter:override:${x}`),
          "segmenter:dpu_page_v1:weak",
        ],
        keywords_hit: deterministic.reason.keywords,
        classifier_confidence: deterministic.confidence,
        source: "deterministic",
        title_rules_hit: deterministic.reason.title_rules_hit,
        bullet_rules_hit: deterministic.reason.bullet_rules_hit,
        override_rules_hit: deterministic.reason.override_rules_hit,
      } as any;
    }


    nodes.push({
      node_id: `${r.document_id}:${r.page_index}`,
      document_id: r.document_id,
      source_document_id: r.document_id,
      page_index: r.page_index,
      slide_title: slideTitle,
      bullets,
      bullets_snippet: bulletsSnippetFromPayload(p, 240),
      visual_asset_id: visualAssetId,
      segment_key: segmentKey,
      structured_segment_key_raw: structuredKeyRaw,
      quality_flags_segment_key_raw: qfKeyRaw,
      segment_reason: segmentReason,
    });
  }

  return { nodes, warnings };
}
