import { normalizeAnalystSegment, type AnalystSegment } from "./analyst-segment";

export type WordGroupableVisual = {
  id: string;
  document_id: string;
  page_index: number | null;
  created_at?: string | null;
  extractor_version?: string | null;
  asset_type?: string | null;
  quality_flags?: any;
  structured_json?: any;
  structured_kind?: string | null;
  structured_summary?: any;
  evidence_count?: number | null;
  evidence_sample_snippets?: string[] | null;
  effective_segment?: string | null;
  segment?: string | null;
  segment_source?: string | null;
  segment_confidence?: number | null;
};

export type GroupedWordVisualAsset = {
  document_id: string;
  group_id: string;
  member_visual_asset_ids: string[];
  page_index: number;
  page_label: string;
  captured_text: string;
  segment_key: AnalystSegment;
  evidence_count_total: number;
  evidence_snippets: string[];
  evidence_asset_ids: string[];
  page_indexes: number[];
  heading?: string | null;
};

export type WordGroupingStats = {
  word_members_skipped_empty: number;
  word_groups_skipped_empty: number;
};

function asCleanString(value: unknown, maxLen: number): string | null {
  if (typeof value !== "string") return null;
  const s = value.replace(/\s+/g, " ").trim();
  if (!s) return null;
  if (s.length > maxLen) return `${s.slice(0, maxLen).trimEnd()}…`;
  return s;
}

function toTextLoose(value: unknown, maxDepth = 6): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (maxDepth <= 0) return "";

  if (Array.isArray(value)) {
    return value.map((v) => toTextLoose(v, maxDepth - 1)).filter(Boolean).join(" ");
  }

  if (typeof value === "object") {
    const v = value as any;
    const direct =
      (typeof v.text === "string" ? v.text : null) ??
      (typeof v.content === "string" ? v.content : null) ??
      (typeof v.value === "string" ? v.value : null);
    if (direct) return direct;

    const children = v.children ?? v.runs ?? v.items ?? v.paragraphs;
    if (children) return toTextLoose(children, maxDepth - 1);

    try {
      const s = JSON.stringify(value);
      if (s && s !== "{}" && s !== "[]") return s;
    } catch {
      // ignore
    }
  }

  return "";
}

function normalizeWhitespaceMultiline(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function isHeadingOnlyText(value: string): boolean {
  const text = normalizeWhitespaceMultiline(value);
  if (!text) return true;

  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return true;

  // If we have any bullet-like line, it's not heading-only.
  if (lines.some((l) => /^[-*\u2022]\s+/.test(l) || /^\d+[.)]\s+/.test(l))) return false;

  const collapsed = lines.join(" ").replace(/\s+/g, " ").trim();
  const wordCount = collapsed.split(/\s+/).filter(Boolean).length;

  const looksLikeLabel = (l: string) => {
    const s = l.replace(/\s+/g, " ").trim();
    if (!s) return false;
    if (/^[A-Za-z][A-Za-z0-9 &/\\-]{0,60}:$/.test(s)) return true;
    if (s.length <= 28 && s.endsWith(":")) return true;
    if (s.length <= 22 && s.split(/\s+/).filter(Boolean).length <= 3) return true;
    return false;
  };

  if (lines.length === 1) return looksLikeLabel(lines[0]);

  // Small multi-line groups that are all label-like are still heading-only.
  if (lines.length <= 3 && lines.every(looksLikeLabel)) return true;

  const uniqueLower = new Set(lines.map((l) => l.toLowerCase()));
  if (uniqueLower.size === 1) return looksLikeLabel(lines[0]);

  // Multiple short lines but no substantive content.
  if (wordCount <= 6 && collapsed.length <= 45) return true;

  return false;
}

function extractHeading(v: WordGroupableVisual): string | null {
  const sj = v.structured_json;
  if (!sj || typeof sj !== "object") return null;
  return asCleanString((sj as any).heading, 140);
}

function extractWordText(v: WordGroupableVisual): string {
  const sj = v.structured_json;
  if (!sj || typeof sj !== "object") return "";

  const heading = extractHeading(v);
  const textSnippet = asCleanString((sj as any).text_snippet, 900);

  const parasRaw = (sj as any).paragraphs;
  const parasText = Array.isArray(parasRaw)
    ? parasRaw
        .map((p: any) => toTextLoose(p))
        .map((t) => asCleanString(t, 220))
        .filter(Boolean)
        .slice(0, 30)
        .join("\n")
    : null;

  const parts = [heading, parasText, textSnippet].filter((p): p is string => typeof p === "string" && p.trim().length > 0);
  return normalizeWhitespaceMultiline(parts.join("\n"));
}

function hasAnyTableContent(v: WordGroupableVisual): boolean {
  const sj = v.structured_json;
  if (!sj || typeof sj !== "object") return false;
  const rows = (sj as any).table_rows;
  if (!Array.isArray(rows) || rows.length === 0) return false;

  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    for (const cell of row) {
      const t = asCleanString(toTextLoose(cell), 140);
      if (t) return true;
    }
  }
  return false;
}

function isEmptyWordVisual(v: WordGroupableVisual): boolean {
  const text = extractWordText(v);
  if (text && text.trim().length > 0) return false;
  if (hasAnyTableContent(v)) return false;
  return true;
}

function isHeadingBlock(v: WordGroupableVisual): boolean {
  const heading = extractHeading(v);
  if (!heading) return false;
  // Heuristic: if the block is mostly a heading (short) or explicit style hints exist.
  const sj: any = v.structured_json;
  const style = typeof sj?.style === "string" ? sj.style : "";
  const level = typeof sj?.level === "number" ? sj.level : null;
  if (style.toLowerCase().includes("heading")) return true;
  if (level != null && Number.isFinite(level) && level <= 4) return true;

  const body = extractWordText(v);
  if (body && body.split(/\s+/).length <= 12) return true;
  return false;
}

function isSectionBreakBlock(v: WordGroupableVisual): boolean {
  const text = extractWordText(v);
  if (!text) return false;
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return false;
  if (/^(?:[-_]{3,}|—{3,}|\*{3,})$/.test(cleaned)) return true;
  if (/\bsection\s*break\b/i.test(cleaned)) return true;
  return false;
}

function isStructuredWordVisual(v: WordGroupableVisual): boolean {
  const extractorVersion = typeof v.extractor_version === "string" ? v.extractor_version : "";
  const qSource = typeof (v as any)?.quality_flags?.source === "string" ? String((v as any).quality_flags.source) : "";
  const kind = typeof (v as any)?.structured_json?.kind === "string" ? String((v as any).structured_json.kind) : "";

  if (extractorVersion === "structured_native_v1" && qSource.startsWith("structured_word")) return true;
  if (qSource.startsWith("structured_word")) return true;
  if (kind === "word_section") return true;
  return false;
}

function pickEffectiveSegment(v: WordGroupableVisual): AnalystSegment {
  const segRaw =
    typeof (v as any)?.effective_segment === "string"
      ? (v as any).effective_segment
      : typeof (v as any)?.segment === "string"
        ? (v as any).segment
        : null;
  return normalizeAnalystSegment(segRaw) ?? "unknown";
}

function majoritySegment(items: WordGroupableVisual[]): AnalystSegment {
  const counts = new Map<AnalystSegment, number>();
  const order: AnalystSegment[] = [];
  for (const it of items) {
    const seg = pickEffectiveSegment(it);
    counts.set(seg, (counts.get(seg) ?? 0) + 1);
    if (!order.includes(seg)) order.push(seg);
  }

  let best: AnalystSegment = order[0] ?? "unknown";
  let bestCount = -1;
  for (const seg of order) {
    const c = counts.get(seg) ?? 0;
    if (c > bestCount) {
      best = seg;
      bestCount = c;
    }
  }

  // If tie, keep first-seen (stable)
  const top = Array.from(counts.entries()).filter(([, n]) => n === bestCount).map(([k]) => k);
  if (top.length > 1) {
    return order.find((s) => top.includes(s)) ?? best;
  }

  return best;
}

export function groupWordVisualAssetsByDocumentWithStats(
  visuals: WordGroupableVisual[],
  opts: {
    maxBlocksPerGroup?: number;
    maxCapturedChars?: number;
  } = {}
): { groups: GroupedWordVisualAsset[]; stats: WordGroupingStats } {
  const maxBlocksPerGroup = Math.max(2, Math.floor(opts.maxBlocksPerGroup ?? 8));
  const maxCapturedChars = Math.max(200, Math.floor(opts.maxCapturedChars ?? 1500));

  const stats: WordGroupingStats = { word_members_skipped_empty: 0, word_groups_skipped_empty: 0 };

  const byDoc = new Map<string, WordGroupableVisual[]>();
  for (const v of visuals) {
    if (!v || typeof v !== "object") continue;
    if (typeof v.document_id !== "string" || !v.document_id) continue;
    if (!isStructuredWordVisual(v)) continue;
    const list = byDoc.get(v.document_id) ?? [];
    list.push(v);
    byDoc.set(v.document_id, list);
  }

  const groups: GroupedWordVisualAsset[] = [];

  const segmentOrder: AnalystSegment[] = [
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
  ];

  for (const [docId, itemsRaw] of Array.from(byDoc.entries()).sort(([a], [b]) => a.localeCompare(b))) {
    const bySeg = new Map<AnalystSegment, WordGroupableVisual[]>();
    for (const v of itemsRaw) {
      if (isEmptyWordVisual(v)) {
        stats.word_members_skipped_empty += 1;
        continue;
      }
      const seg = pickEffectiveSegment(v);
      const list = bySeg.get(seg) ?? [];
      list.push(v);
      bySeg.set(seg, list);
    }

    for (const seg of segmentOrder) {
      const itemsForSeg = bySeg.get(seg);
      if (!itemsForSeg || itemsForSeg.length === 0) continue;

      const items = itemsForSeg
        .slice()
        .sort((a, b) => {
          const pa = typeof a.page_index === "number" ? a.page_index : 1e9;
          const pb = typeof b.page_index === "number" ? b.page_index : 1e9;
          if (pa !== pb) return pa - pb;
          const ca = typeof a.created_at === "string" ? a.created_at : "";
          const cb = typeof b.created_at === "string" ? b.created_at : "";
          if (ca !== cb) return ca.localeCompare(cb);
          return String(a.id).localeCompare(String(b.id));
        });

      let chunkIndex = 0;
      let current: WordGroupableVisual[] = [];
      let currentText = "";
      let currentHeading: string | null = null;

      const flush = () => {
        if (current.length === 0) return;

        const groupHasNonHeadingText = currentText && !isHeadingOnlyText(currentText);

        const groupHasContent = Boolean(
          groupHasNonHeadingText ||
            current.some((v) => hasAnyTableContent(v))
        );

        if (!groupHasContent) {
          stats.word_groups_skipped_empty += 1;
          current = [];
          currentText = "";
          currentHeading = null;
          return;
        }

        chunkIndex += 1;

        const memberIds = current.map((v) => v.id);
        const pageIndexes = current
          .map((v) => (typeof v.page_index === "number" && Number.isFinite(v.page_index) ? Math.max(0, Math.floor(v.page_index)) : null))
          .filter((v): v is number => v != null);

        const evidenceSnippets: string[] = [];
        const evidenceAssetIds: string[] = [];
        let evidenceCountTotal = 0;

        for (const v of current) {
          const c = Number((v as any).evidence_count);
          evidenceCountTotal += Number.isFinite(c) ? c : 0;
          const snipsRaw = (v as any).evidence_sample_snippets;
          const snips = Array.isArray(snipsRaw) ? snipsRaw : typeof snipsRaw === "string" ? [snipsRaw] : [];
          for (const s of snips) {
            if (typeof s !== "string") continue;
            const cleaned = s.replace(/\s+/g, " ").trim();
            if (!cleaned) continue;
            if (!evidenceSnippets.some((x) => x.toLowerCase() === cleaned.toLowerCase())) evidenceSnippets.push(cleaned);
          }
          if ((Number.isFinite(c) ? c : 0) > 0) evidenceAssetIds.push(v.id);
        }

        const label = chunkIndex > 1 ? `${seg} (part ${chunkIndex})` : seg;
        const firstPageIndexRaw = current[0]?.page_index;
        const page_index =
          typeof firstPageIndexRaw === "number" && Number.isFinite(firstPageIndexRaw)
            ? Math.max(0, Math.floor(firstPageIndexRaw))
            : 0;

        groups.push({
          document_id: docId,
          group_id: `word_group:${docId}:${seg}:${chunkIndex}`,
          member_visual_asset_ids: memberIds,
          page_index,
          page_label: label,
          captured_text: currentText.length > maxCapturedChars ? `${currentText.slice(0, maxCapturedChars).trimEnd()}…` : currentText,
          segment_key: seg,
          evidence_count_total: evidenceCountTotal,
          evidence_snippets: evidenceSnippets.slice(0, 8),
          evidence_asset_ids: evidenceAssetIds,
          page_indexes: pageIndexes,
          heading: currentHeading,
        });

        current = [];
        currentText = "";
        currentHeading = null;
      };

      for (const v of items) {
        const nextTextPiece = extractWordText(v);
        const wouldExceedText =
          current.length > 0 && nextTextPiece && currentText.length + 2 + nextTextPiece.length > maxCapturedChars;
        const wouldExceedBlocks = current.length >= maxBlocksPerGroup;

        if (wouldExceedBlocks || wouldExceedText) flush();

        if (current.length === 0) {
          const h = extractHeading(v);
          if (h) currentHeading = h;
        } else if (!currentHeading) {
          const h = extractHeading(v);
          if (h) currentHeading = h;
        }

        current.push(v);

        if (nextTextPiece) {
          const merged = currentText ? `${currentText}\n\n${nextTextPiece}` : nextTextPiece;
          currentText = merged.length > maxCapturedChars ? merged.slice(0, maxCapturedChars).trimEnd() : merged;
        }
      }

      flush();
    }
  }

  return { groups, stats };
}

export function groupWordVisualAssetsByDocument(
  visuals: WordGroupableVisual[],
  opts: {
    maxBlocksPerGroup?: number;
    maxCapturedChars?: number;
  } = {}
): GroupedWordVisualAsset[] {
  return groupWordVisualAssetsByDocumentWithStats(visuals, opts).groups;
}
