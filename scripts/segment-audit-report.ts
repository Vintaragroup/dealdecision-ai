import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

type SegmentAuditReport = {
  deal_id: string;
  generated_at: string;
  documents: Array<{
    document_id: string;
    title: string | null;
    type: string | null;
    status: string | null;
    page_count: number | null;
    items: Array<{
      visual_asset_id: string;
      document_id: string;
      extractor_version: string | null;
      quality_source: string | null;
      segment: string;
      segment_source: "persisted" | "structured" | "vision" | "missing";
      segment_confidence: number | null;
      page_index: number | null;
      page_label: string;
      image_uri: string | null;
      snippet: string | null;
      evidence_count?: number;
      content_preview?: {
        ocr_text_len: number;
        ocr_text_snippet: string | null;
        structured_json_present: boolean;
        structured_json_keys: string[];
        structured_json_snippet: string | null;
      };
      rescore?: {
        segment: string;
        confidence: number | null;
        snippet?: string | null;
        sources_used?: string[];
        top_scores?: Array<{ segment: string; score: number }>;
        keyword_hits?: Record<string, unknown> | null;
      };
      reason: {
        classification_text_len: number;
        classification_text_sources_used: string[];
        keyword_hits?: Record<string, string[]>;
        top_scores?: Array<{ segment: string; score: number }>;
        best_score?: number | null;
        runner_up_score?: number | null;
        threshold?: number;
        unknown_reason_code?: string | null;
      };
    }>;
    summary: {
      total_items: number;
      by_segment: Record<string, number>;
    };
  }>;
  error?: { code: string; message: string };
};

function parseArgs(argv: string[]) {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a?.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      out[key] = next;
      i++;
    } else {
      out[key] = "1";
    }
  }
  return out;
}

function escapeMdTableCell(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/\n/g, "\\n")
    .replace(/\|/g, "\\|")
    .trim();
}

function fmtConfidence(value: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const pct = value <= 1 ? value * 100 : value;
  return `${Math.round(pct)}%`;
}

function stableSegmentOrder(segments: string[]): string[] {
  const canonical = [
    "overview",
    "problem",
    "solution",
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

  const set = new Set(segments);
  const ordered: string[] = [];
  for (const s of canonical) if (set.has(s)) ordered.push(s);
  const extras = segments.filter((s) => !canonical.includes(s)).sort((a, b) => a.localeCompare(b));
  ordered.push(...extras);
  return ordered;
}

function stableUnknownReasonOrder(codes: string[]): string[] {
  const canonical = [
    "NO_CLASSIFICATION_TEXT",
    "MISSING_OCR_TEXT",
    "MISSING_STRUCTURED_JSON",
    "LOW_BEST_SCORE",
    "TIE_LOW_CONFIDENCE",
    "PERSISTED_UNKNOWN",
  ];

  const set = new Set(codes);
  const ordered: string[] = [];
  for (const c of canonical) if (set.has(c)) ordered.push(c);
  const extras = codes.filter((c) => !canonical.includes(c)).sort((a, b) => a.localeCompare(b));
  ordered.push(...extras);
  return ordered;
}

function countWhere<T>(arr: T[], pred: (t: T) => boolean): number {
  let n = 0;
  for (const t of arr) if (pred(t)) n += 1;
  return n;
}

function topCounts(values: string[], limit = 10): Array<{ value: string; count: number }> {
  const m = new Map<string, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }));
}

function remediationForUnknown(code: string): string[] {
  switch (code) {
    case "PERSISTED_UNKNOWN":
      return [
        "Fix upstream persisted segment_key (quality flags or structured JSON).",
        "Use persisted-vs-rescore diff to pick the correct segment.",
        "Backfill segment_key when classifier output is correct.",
      ];
    case "NO_CLASSIFICATION_TEXT":
      return [
        "Ensure OCR text exists for vision items (OCR pipeline / asset linkage).",
        "Ensure structured JSON exists for structured-native items.",
        "Check extractor version / ingestion logs for empty content.",
      ];
    case "MISSING_STRUCTURED_JSON":
      return [
        "Structured-native item missing structured JSON: investigate extractor output/storage.",
        "Verify the document type is supported by the structured extractor.",
      ];
    case "MISSING_OCR_TEXT":
      return [
        "Vision/OCR-backed item missing OCR text: investigate OCR stage and job execution.",
        "Confirm page image exists and OCR ran successfully.",
      ];
    case "LOW_BEST_SCORE":
      return [
        "Classifier ran but confidence too low: expand keywords or adjust thresholds.",
        "Confirm classifier snippet contains the relevant content (sources used).",
      ];
    case "TIE_LOW_CONFIDENCE":
      return [
        "Multiple segments tied: add discriminating keywords or boost title/structure signals.",
        "Verify slide titles / structured summaries are extracted correctly.",
      ];
    default:
      return ["Review content preview vs classifier snippet; add missing signals or fix extraction."];
  }
}

function formatKeywordEvidence(
  item: SegmentAuditReport["documents"][number]["items"][number]
): string {
  if (item.segment_source === "persisted") return "(n/a - persisted)";

  const reason = item.reason ?? ({} as any);
  const keywordHits = reason.keyword_hits as Record<string, string[]> | undefined;
  if (!keywordHits || typeof keywordHits !== "object") return "—";

  const pickHits = (segment: string) => {
    const hits = keywordHits[segment];
    return Array.isArray(hits) ? hits.filter((h) => typeof h === "string" && h.trim().length > 0) : [];
  };

  if (item.segment !== "unknown") {
    const hits = pickHits(item.segment).slice(0, 12);
    return hits.length ? escapeMdTableCell(hits.join(", ")) : "(none)";
  }

  const topScores = Array.isArray(reason.top_scores) ? reason.top_scores : [];
  const topSegments = topScores
    .filter((s) => s && typeof s.segment === "string")
    .slice(0, 3)
    .map((s) => s.segment);

  const parts: string[] = [];
  for (const seg of topSegments) {
    const hits = pickHits(seg).slice(0, 6);
    if (hits.length) parts.push(`${seg}: ${hits.join(", ")}`);
  }

  if (!parts.length) return "(none)";
  return escapeMdTableCell(parts.join(" | "));
}

function formatTopScores(
  item: SegmentAuditReport["documents"][number]["items"][number]
): string {
  if (item.segment_source === "persisted") return "(n/a - persisted)";

  const reason = item.reason ?? ({} as any);
  const topScores = Array.isArray(reason.top_scores) ? reason.top_scores : [];
  const parts: string[] = [];
  for (const ts of topScores.slice(0, 3)) {
    if (!ts || typeof ts.segment !== "string" || typeof ts.score !== "number") continue;
    parts.push(`${ts.segment} ${ts.score.toFixed(2)}`);
  }
  return parts.length ? escapeMdTableCell(parts.join("; ")) : "—";
}

function formatTextSourcesUsed(
  item: SegmentAuditReport["documents"][number]["items"][number]
): string {
  const sourcesUsed = Array.isArray(item.reason?.classification_text_sources_used)
    ? item.reason.classification_text_sources_used.filter((s) => typeof s === "string" && s.trim().length > 0)
    : [];
  return sourcesUsed.length ? escapeMdTableCell(sourcesUsed.join(", ")) : "(none)";
}

function summarizeUnknownGroups(
  unknownItems: SegmentAuditReport["documents"][number]["items"]
): {
  reasonCodes: string[];
  byReason: Map<string, SegmentAuditReport["documents"][number]["items"]>;
} {
  const byReason = new Map<string, SegmentAuditReport["documents"][number]["items"]>();
  for (const it of unknownItems) {
    const codeRaw = it.reason?.unknown_reason_code;
    const code = typeof codeRaw === "string" && codeRaw.trim().length ? codeRaw.trim() : "UNKNOWN";
    const arr = byReason.get(code) ?? [];
    arr.push(it);
    byReason.set(code, arr);
  }
  const reasonCodes = stableUnknownReasonOrder(Array.from(byReason.keys()));
  return { reasonCodes, byReason };
}

function formatReasonCell(item: SegmentAuditReport["documents"][number]["items"][number]): string {
  const seg = item.segment;
  const reason = item.reason ?? ({} as any);
  if (seg === "unknown") {
    const code = reason.unknown_reason_code ?? "—";
    const persisted = item.segment_source === "persisted" ? " (persisted)" : "";
    const threshold = typeof reason.threshold === "number" ? `; threshold=${reason.threshold}` : "";
    return escapeMdTableCell(`unknown_reason_code=${code}${persisted}${threshold}`);
  }

  const best = typeof reason.best_score === "number" && Number.isFinite(reason.best_score) ? reason.best_score : null;
  const bestStr = best != null ? `best_score=${best.toFixed(2)}` : "best_score=—";

  const hits = reason.keyword_hits && typeof reason.keyword_hits === "object" ? (reason.keyword_hits as any)[seg] : null;
  const hitsList = Array.isArray(hits) ? (hits as unknown[]).filter((h) => typeof h === "string").slice(0, 8) : [];
  const hitsStr = hitsList.length ? `hits=${hitsList.join(", ")}` : "hits=—";

  return escapeMdTableCell(`${bestStr}; ${hitsStr}`);
}

function describeUnknownReason(code: string): string {
  switch (code) {
    case "NO_CLASSIFICATION_TEXT":
      return "No classification text available for this item (len=0).";
    case "MISSING_OCR_TEXT":
      return "OCR / vision text missing, so vision-based classification had no text.";
    case "MISSING_STRUCTURED_JSON":
      return "Structured JSON missing, so structured-native classification had no payload.";
    case "LOW_BEST_SCORE":
      return "Best segment score below threshold.";
    case "TIE_LOW_CONFIDENCE":
      return "Top scores too close (tie / low confidence).";
    case "PERSISTED_UNKNOWN":
      return "Segment was explicitly persisted as unknown.";
    default:
      return "Unknown classification reason.";
  }
}

function contentPreviewCell(item: SegmentAuditReport["documents"][number]["items"][number]): string {
  const preview = item.content_preview;
  const structured = preview?.structured_json_snippet;
  const ocr = preview?.ocr_text_snippet;

  const parts: string[] = [];
  if (typeof structured === "string" && structured.trim().length) parts.push(`json: ${structured.trim()}`);
  if (typeof ocr === "string" && ocr.trim().length) parts.push(`ocr: ${ocr.trim()}`);
  if (!parts.length) return "(empty)";
  return escapeMdTableCell(parts.join(" | "));
}

function classifierSnippetCell(item: SegmentAuditReport["documents"][number]["items"][number]): string {
  const snippet = item.snippet;
  if (typeof snippet !== "string" || snippet.trim().length === 0) return "(empty)";

  const trimmed = snippet.trim();
  // Persisted-first rows typically only have the persisted segment label as "classifier" text.
  if (item.segment_source === "persisted" && (trimmed === item.segment || trimmed === "unknown")) {
    return "(n/a - persisted)";
  }
  return escapeMdTableCell(trimmed);
}

function hasNonEmptyText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function computeGapStats(items: Array<SegmentAuditReport["documents"][number]["items"][number]>) {
  let total = 0;
  let persisted = 0;
  let persistedUnknown = 0;
  let nonPersisted = 0;
  let nonPersistedUnknown = 0;

  let withAnyContent = 0;
  let withOcrContent = 0;
  let withJsonContent = 0;

  let classifierHadText = 0;
  let classifierNoText = 0;

  let contentButClassifierEmpty = 0;
  let noContent = 0;

  for (const it of items) {
    total++;
    const isPersisted = it.segment_source === "persisted";
    if (isPersisted) {
      persisted++;
      if (it.segment === "unknown") persistedUnknown++;
      continue;
    }

    nonPersisted++;
    if (it.segment === "unknown") nonPersistedUnknown++;

    const preview = it.content_preview;
    const hasOcr = hasNonEmptyText(preview?.ocr_text_snippet);
    const hasJson = hasNonEmptyText(preview?.structured_json_snippet);
    const hasContent = hasOcr || hasJson;

    if (hasContent) withAnyContent++;
    if (hasOcr) withOcrContent++;
    if (hasJson) withJsonContent++;

    const sourcesUsed = Array.isArray(it.reason?.classification_text_sources_used)
      ? it.reason.classification_text_sources_used.filter((s) => typeof s === "string" && s.trim().length > 0)
      : [];
    const textLen = typeof it.reason?.classification_text_len === "number" ? it.reason.classification_text_len : 0;
    const classifierHasText = textLen > 0 && sourcesUsed.length > 0;

    if (classifierHasText) classifierHadText++;
    else classifierNoText++;

    if (!hasContent) noContent++;
    if (hasContent && !classifierHasText) contentButClassifierEmpty++;
  }

  return {
    total,
    persisted,
    persistedUnknown,
    nonPersisted,
    nonPersistedUnknown,
    withAnyContent,
    withOcrContent,
    withJsonContent,
    classifierHadText,
    classifierNoText,
    contentButClassifierEmpty,
    noContent,
  };
}

function summarizeUnknownTopCandidates(
  items: Array<SegmentAuditReport["documents"][number]["items"][number]>
): Array<{ segment: string; n: number }> {
  const counts = new Map<string, number>();
  for (const it of items) {
    if (it.segment !== "unknown") continue;
    if (it.segment_source === "persisted") continue;
    const top = Array.isArray(it.reason?.top_scores) ? it.reason.top_scores : [];
    const top0 = top[0];
    const seg = typeof top0?.segment === "string" && top0.segment.trim().length ? top0.segment.trim() : null;
    if (!seg) continue;
    counts.set(seg, (counts.get(seg) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([segment, n]) => ({ segment, n }))
    .sort((a, b) => b.n - a.n || a.segment.localeCompare(b.segment))
    .slice(0, 8);
}

function summarizeContentAvailability(
  items: Array<SegmentAuditReport["documents"][number]["items"][number]>
) {
  let withJson = 0;
  let withOcr = 0;
  for (const it of items) {
    const p = it.content_preview;
    if (p?.structured_json_present && typeof p.structured_json_snippet === "string" && p.structured_json_snippet.trim().length) {
      withJson++;
    }
    if (typeof p?.ocr_text_snippet === "string" && p.ocr_text_snippet.trim().length) {
      withOcr++;
    }
  }
  return { withJson, withOcr };
}

async function atomicWriteFile(filePath: string, contents: string) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}`);
  await fs.writeFile(tmp, contents, "utf8");
  await fs.rename(tmp, filePath);
}

async function fetchJson(url: string) {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    // ignore
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${url}: ${text.slice(0, 300)}`);
  }
  return json;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const dealId = args["deal-id"] ?? process.env.DEAL_ID;
  if (!dealId) {
    throw new Error('Missing deal id. Provide --deal-id <uuid> or set DEAL_ID env var.');
  }

  const apiBaseUrl = (args["api-base-url"] ?? process.env.API_BASE_URL ?? "http://localhost:9000").replace(/\/$/, "");
  const url = `${apiBaseUrl}/api/v1/deals/${dealId}/lineage?debug_segments=1&segment_audit=1&segment_rescore=1`;

  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const dealIdShort = dealId.split("-")[0] ?? dealId;
  const outPath = args["out"] ?? path.join(repoRoot, `docs/Reports/segment-audit.${dealIdShort}.md`);

  const lineage = await fetchJson(url);
  const audit = lineage?.segment_audit_report as SegmentAuditReport | undefined;
  if (!audit || typeof audit !== "object") {
    throw new Error(`lineage response missing segment_audit_report (url=${url})`);
  }

  const generatedAt = typeof audit.generated_at === "string" ? audit.generated_at : "UNKNOWN_GENERATED_AT";
  const documents = Array.isArray(audit.documents) ? audit.documents : [];

  const totalDocs = documents.length;
  const totalItems = documents.reduce((acc, d) => acc + (Array.isArray(d.items) ? d.items.length : 0), 0);

  const segmentTotals: Record<string, number> = {};
  for (const d of documents) {
    const items = Array.isArray(d.items) ? d.items : [];
    for (const it of items) {
      const seg = typeof it.segment === "string" && it.segment.trim() ? it.segment.trim() : "unknown";
      segmentTotals[seg] = (segmentTotals[seg] ?? 0) + 1;
    }
  }

  const overallSegments = stableSegmentOrder(Object.keys(segmentTotals));

  const docTitleById = new Map<string, string>();
  for (const d of documents) {
    if (typeof d.document_id !== "string" || !d.document_id) continue;
    const title = typeof d.title === "string" && d.title.trim().length ? d.title.trim() : d.document_id;
    docTitleById.set(d.document_id, title);
  }

  const lines: string[] = [];
  lines.push(`# Segment Audit Report`);
  lines.push("");
  lines.push(`Deal: **${audit.deal_id ?? dealId}**`);
  lines.push(`Generated: **${generatedAt}**`);
  lines.push("");

  if (audit.error) {
    lines.push(`> ERROR: ${audit.error.code} — ${audit.error.message}`);
    lines.push("");
  }

  lines.push(`## Deal Summary`);
  lines.push("");
  lines.push(`- Deal ID: ${audit.deal_id ?? dealId}`);
  lines.push(`- Timestamp generated: ${generatedAt}`);
  lines.push(`- Total documents: ${totalDocs}`);
  lines.push(`- Total visual / structured items: ${totalItems}`);
  lines.push("");
  lines.push(`### Segment distribution`);
  lines.push("");
  lines.push(`| Segment | Count |`);
  lines.push(`|---|---:|`);
  for (const seg of overallSegments) {
    lines.push(`| ${escapeMdTableCell(seg)} | ${segmentTotals[seg] ?? 0} |`);
  }
  lines.push("");

  // Deal-wide unknown rollup (grouped by unknown_reason_code)
  const allUnknownItems: SegmentAuditReport["documents"][number]["items"] = [];
  for (const d of documents) {
    const items = Array.isArray(d.items) ? d.items : [];
    for (const it of items) if (it.segment === "unknown") allUnknownItems.push(it);
  }

  if (allUnknownItems.length) {
    const { reasonCodes, byReason } = summarizeUnknownGroups(allUnknownItems);

    lines.push(`### Unknown summary (deal-wide)`);
    lines.push("");
    for (const code of reasonCodes) {
      const group = byReason.get(code) ?? [];
      const contentAvail = summarizeContentAvailability(group);

      const sourceCounts: Record<string, number> = {};
      for (const it of group) {
        const src = it.segment_source ?? "missing";
        sourceCounts[src] = (sourceCounts[src] ?? 0) + 1;
      }
      const sourceCountsSorted = Object.entries(sourceCounts)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([s, n]) => `${s} (${n})`);

      const textLens = group.map((it) =>
        typeof it.reason?.classification_text_len === "number" ? it.reason.classification_text_len : 0
      );
      const avgLen = textLens.length
        ? Math.round(textLens.reduce((a, b) => a + b, 0) / Math.max(1, textLens.length))
        : 0;

      const sourcesCounts: Record<string, number> = {};
      for (const it of group) {
        const sources = Array.isArray(it.reason?.classification_text_sources_used)
          ? it.reason.classification_text_sources_used
          : [];
        for (const s of sources) {
          if (typeof s !== "string" || !s.trim().length) continue;
          sourcesCounts[s] = (sourcesCounts[s] ?? 0) + 1;
        }
      }
      const sourcesSorted = Object.entries(sourcesCounts)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 8)
        .map(([s, n]) => `${s} (${n})`);

      lines.push(`#### Unknown reason: ${escapeMdTableCell(code)} (${group.length})`);
      lines.push("");
      lines.push(describeUnknownReason(code));
      lines.push("");
      lines.push(
        `- avg classification_text_len: ${avgLen}; sources_used: ${sourcesSorted.length ? sourcesSorted.join(", ") : "(none)"}`
      );
      lines.push(
        `- segment sources: ${sourceCountsSorted.length ? escapeMdTableCell(sourceCountsSorted.join(", ")) : "(none)"}`
      );
      lines.push(
        `- content available: structured_json (${contentAvail.withJson}/${group.length}); ocr_text (${contentAvail.withOcr}/${group.length})`
      );
      lines.push("");
      lines.push("| Document | Count | Pages / Items |");
      lines.push("|---|---:|---|");

      const byDoc = new Map<string, SegmentAuditReport["documents"][number]["items"]>();
      for (const it of group) {
        const docId = typeof it.document_id === "string" && it.document_id ? it.document_id : "UNKNOWN_DOCUMENT";
        const arr = byDoc.get(docId) ?? [];
        arr.push(it);
        byDoc.set(docId, arr);
      }

      const docRows = Array.from(byDoc.entries())
        .map(([docId, items]) => {
          const title = docTitleById.get(docId) ?? docId;
          const labels = items
            .slice()
            .sort((a, b) => (a.page_index ?? 1e9) - (b.page_index ?? 1e9) || a.page_label.localeCompare(b.page_label))
            .map((it) => it.page_label);
          const MAX_LABELS_PER_DOC = 30;
          const shown = labels.slice(0, MAX_LABELS_PER_DOC);
          const remainder = labels.length - shown.length;
          const pagesCell = `${shown.join(", ")}${remainder > 0 ? `, … (+${remainder} more)` : ""}`;
          return { title, count: items.length, pagesCell };
        })
        .sort((a, b) => b.count - a.count || a.title.localeCompare(b.title));

      for (const row of docRows) {
        lines.push(`| ${escapeMdTableCell(row.title)} | ${row.count} | ${escapeMdTableCell(row.pagesCell)} |`);
      }
      lines.push("");
    }
    lines.push("");
  }

  // Deal-wide gap analysis
  {
    const allItems: SegmentAuditReport["documents"][number]["items"] = [];
    for (const d of documents) {
      const items = Array.isArray(d.items) ? d.items : [];
      allItems.push(...items);
    }

    const stats = computeGapStats(allItems);
    const unknownTop = summarizeUnknownTopCandidates(allItems);

    lines.push(`### Classification gaps (deal-wide)`);
    lines.push("");
    lines.push(
      `This section highlights where we can't explain classification well yet (e.g. persisted segments bypass scoring, or content exists but classifier input text was empty).`
    );
    lines.push("");
    lines.push(`- Total items: ${stats.total}`);
    lines.push(`- Persisted segment_key items (no scoring/keywords): ${stats.persisted} (unknown: ${stats.persistedUnknown})`);
    lines.push(`- Non-persisted items (scored/attempted): ${stats.nonPersisted} (unknown: ${stats.nonPersistedUnknown})`);
    lines.push(
      `- Non-persisted content coverage: any (${stats.withAnyContent}/${stats.nonPersisted}); structured_json (${stats.withJsonContent}/${stats.nonPersisted}); ocr_text (${stats.withOcrContent}/${stats.nonPersisted})`
    );
    lines.push(
      `- Non-persisted classifier input: present (${stats.classifierHadText}/${stats.nonPersisted}); empty (${stats.classifierNoText}/${stats.nonPersisted})`
    );
    lines.push(
      `- Gap: content present but classifier text empty (${stats.contentButClassifierEmpty}/${stats.nonPersisted}); gap: no content extracted (${stats.noContent}/${stats.nonPersisted})`
    );

    if (unknownTop.length) {
      lines.push("");
      lines.push("Top candidate segments for non-persisted unknowns (by top score):");
      lines.push("");
      lines.push(`| Candidate segment | Count |`);
      lines.push(`|---|---:|`);
      for (const row of unknownTop) {
        lines.push(`| ${escapeMdTableCell(row.segment)} | ${row.n} |`);
      }
    }

    lines.push("");
  }

  // Deal-wide evidence coverage
  {
    const allItems: SegmentAuditReport["documents"][number]["items"] = [];
    for (const d of documents) {
      const items = Array.isArray(d.items) ? d.items : [];
      allItems.push(...items);
    }
    const withEvidence = countWhere(allItems, (it) => (it.evidence_count ?? 0) > 0);
    const pct = allItems.length ? Math.round((withEvidence / allItems.length) * 100) : 0;
    const topSegs = topCounts(
      allItems.filter((it) => (it.evidence_count ?? 0) > 0).map((it) => (it.segment?.trim() ? it.segment.trim() : "unknown")),
      8
    );

    lines.push(`### Evidence coverage (deal-wide)`);
    lines.push("");
    lines.push(`- Items with evidence: ${withEvidence}/${allItems.length} (${pct}%)`);
    if (topSegs.length) {
      lines.push(`- Evidence present by segment (top): ${escapeMdTableCell(topSegs.map((r) => `${r.value} (${r.count})`).join(", "))}`);
    }
    lines.push("");
  }

  // Deal-wide extraction quality health
  {
    const allItems: SegmentAuditReport["documents"][number]["items"] = [];
    for (const d of documents) {
      const items = Array.isArray(d.items) ? d.items : [];
      allItems.push(...items);
    }
    const ocrMissing = countWhere(allItems, (it) => (it.content_preview?.ocr_text_len ?? 0) === 0);
    const structuredPresent = countWhere(allItems, (it) => it.content_preview?.structured_json_present === true);
    const structuredMissing = countWhere(allItems, (it) => it.content_preview?.structured_json_present === false);
    const rescorePresent = countWhere(allItems, (it) => Boolean(it.rescore));

    lines.push(`### Extraction quality health (deal-wide)`);
    lines.push("");
    lines.push(`- OCR missing/empty (ocr_text_len=0): ${ocrMissing}/${allItems.length}`);
    lines.push(`- Structured JSON present: ${structuredPresent}/${allItems.length}`);
    lines.push(`- Structured JSON missing: ${structuredMissing}/${allItems.length}`);
    lines.push(`- Rescore fields present: ${rescorePresent}/${allItems.length}`);
    lines.push("");
  }

  // Deal-wide remediation checklist
  {
    const allItems: SegmentAuditReport["documents"][number]["items"] = [];
    for (const d of documents) {
      const items = Array.isArray(d.items) ? d.items : [];
      allItems.push(...items);
    }
    const unknowns = allItems.filter((it) => it.segment === "unknown");
    const { reasonCodes, byReason } = summarizeUnknownGroups(unknowns);

    lines.push(`### Remediation checklist (deal-wide)`);
    lines.push("");
    if (!unknowns.length) {
      lines.push(`- No unknown items.`);
      lines.push("");
    } else {
      for (const code of reasonCodes) {
        const group = byReason.get(code) ?? [];
        lines.push(`- **${escapeMdTableCell(code)}**: ${group.length}`);
        for (const action of remediationForUnknown(code)) {
          lines.push(`  - ${escapeMdTableCell(action)}`);
        }
      }
      lines.push("");
    }
  }

  // Deal-wide persisted vs rescore
  {
    const allItems: SegmentAuditReport["documents"][number]["items"] = [];
    for (const d of documents) {
      const items = Array.isArray(d.items) ? d.items : [];
      allItems.push(...items);
    }
    const persisted = allItems.filter((it) => it.segment_source === "persisted" && typeof it.rescore?.segment === "string");
    if (persisted.length) {
      const changed = persisted.filter((it) => (it.rescore?.segment ?? "") !== (it.segment ?? ""));
      const unchanged = persisted.length - changed.length;
      const changedTo = topCounts(changed.map((it) => it.rescore?.segment ?? "unknown"), 10);

      lines.push(`### Persisted vs rescore (deal-wide)`);
      lines.push("");
      lines.push(`- Persisted items with rescore: ${persisted.length}`);
      lines.push(`- Would change segment: ${changed.length}`);
      lines.push(`- Would stay same: ${unchanged}`);
      if (changedTo.length) {
        lines.push(`- Most common rescore targets (when changed): ${escapeMdTableCell(changedTo.map((r) => `${r.value} (${r.count})`).join(", "))}`);
      }

      const sample = changed
        .slice()
        .sort((a, b) => (a.page_index ?? 1e9) - (b.page_index ?? 1e9) || a.page_label.localeCompare(b.page_label))
        .slice(0, 12);
      if (sample.length) {
        lines.push("");
        lines.push(`| Document | Page / Item | Persisted | Rescore | Rescore conf | Rescore snippet |`);
        lines.push(`|---|---|---|---|---:|---|`);
        for (const it of sample) {
          const conf = fmtConfidence(it.rescore?.confidence ?? null);
          lines.push(
            `| ${escapeMdTableCell(docTitleById.get(it.document_id) ?? it.document_id)} | ${escapeMdTableCell(it.page_label)} | ${escapeMdTableCell(it.segment)} | ${escapeMdTableCell(it.rescore?.segment ?? "") } | ${conf} | ${escapeMdTableCell(it.rescore?.snippet ?? "")} |`
          );
        }
      }

      lines.push("");
    }
  }

  lines.push(`## Per-document breakdown`);

  for (const doc of documents) {
    const title = doc.title ?? "(untitled)";
    const docType = doc.type ?? "—";
    const pageCount = typeof doc.page_count === "number" ? String(doc.page_count) : "—";
    const items = Array.isArray(doc.items) ? doc.items : [];

    lines.push(`### ${escapeMdTableCell(title)}`);
    lines.push("");
    lines.push(`- Document ID: ${doc.document_id}`);
    lines.push(`- Document type: ${escapeMdTableCell(docType)}`);
    lines.push(`- Page count: ${pageCount}`);
    lines.push(`- Total items extracted: ${items.length}`);
    lines.push("");

    // Group by segment.
    const bySegment = new Map<string, typeof items>();
    for (const it of items) {
      const seg = typeof it.segment === "string" && it.segment.trim() ? it.segment.trim() : "unknown";
      const arr = bySegment.get(seg) ?? [];
      arr.push(it);
      bySegment.set(seg, arr);
    }

    const segments = stableSegmentOrder(Array.from(bySegment.keys()));

    // Unknown rollup (grouped by unknown_reason_code)
    const unknownItems = items.filter((it) => it.segment === "unknown");
    if (unknownItems.length) {
      const { reasonCodes, byReason } = summarizeUnknownGroups(unknownItems);

      lines.push(`#### Unknown summary (${unknownItems.length})`);
      lines.push("");
      for (const code of reasonCodes) {
        const group = byReason.get(code) ?? [];
        const contentAvail = summarizeContentAvailability(group);
        const pageLabels = group
          .slice()
          .sort((a, b) => (a.page_index ?? 1e9) - (b.page_index ?? 1e9) || a.page_label.localeCompare(b.page_label))
          .map((it) => it.page_label);

        const textLens = group.map((it) =>
          typeof it.reason?.classification_text_len === "number" ? it.reason.classification_text_len : 0
        );
        const avgLen = textLens.length
          ? Math.round(textLens.reduce((a, b) => a + b, 0) / Math.max(1, textLens.length))
          : 0;

        const sourcesCounts: Record<string, number> = {};
        for (const it of group) {
          const sources = Array.isArray(it.reason?.classification_text_sources_used)
            ? it.reason.classification_text_sources_used
            : [];
          for (const s of sources) {
            if (typeof s !== "string" || !s.trim().length) continue;
            sourcesCounts[s] = (sourcesCounts[s] ?? 0) + 1;
          }
        }
        const sourcesSorted = Object.entries(sourcesCounts)
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .slice(0, 6)
          .map(([s, n]) => `${s} (${n})`);

        lines.push(`- **${escapeMdTableCell(code)}**: ${group.length} — ${describeUnknownReason(code)}`);
        lines.push(
          `  - avg classification_text_len: ${avgLen}; sources_used: ${sourcesSorted.length ? sourcesSorted.join(", ") : "(none)"}`
        );
        lines.push(
          `  - content available: structured_json (${contentAvail.withJson}/${group.length}); ocr_text (${contentAvail.withOcr}/${group.length})`
        );
        lines.push(
          `  - pages/items: ${pageLabels.length ? escapeMdTableCell(pageLabels.join(", ")) : "(none)"}`
        );
      }
      lines.push("");
    }

    // Per-document gap analysis
    {
      const stats = computeGapStats(items);
      const unknownTop = summarizeUnknownTopCandidates(items);

      lines.push(`#### Classification gaps (${escapeMdTableCell(title)} )`);
      lines.push("");
      lines.push(`- Total items: ${stats.total}`);
      lines.push(`- Persisted segment_key items (no scoring/keywords): ${stats.persisted} (unknown: ${stats.persistedUnknown})`);
      lines.push(`- Non-persisted items (scored/attempted): ${stats.nonPersisted} (unknown: ${stats.nonPersistedUnknown})`);
      lines.push(
        `- Non-persisted content coverage: any (${stats.withAnyContent}/${stats.nonPersisted}); structured_json (${stats.withJsonContent}/${stats.nonPersisted}); ocr_text (${stats.withOcrContent}/${stats.nonPersisted})`
      );
      lines.push(
        `- Gap: content present but classifier text empty (${stats.contentButClassifierEmpty}/${stats.nonPersisted}); gap: no content extracted (${stats.noContent}/${stats.nonPersisted})`
      );

      if (unknownTop.length) {
        lines.push("");
        lines.push("Top candidate segments for non-persisted unknowns (by top score):");
        lines.push("");
        lines.push(`| Candidate segment | Count |`);
        lines.push(`|---|---:|`);
        for (const row of unknownTop) {
          lines.push(`| ${escapeMdTableCell(row.segment)} | ${row.n} |`);
        }
      }

      lines.push("");
    }

    // Per-document evidence coverage
    {
      const withEvidence = countWhere(items, (it) => (it.evidence_count ?? 0) > 0);
      const pct = items.length ? Math.round((withEvidence / items.length) * 100) : 0;
      const topSegs = topCounts(
        items.filter((it) => (it.evidence_count ?? 0) > 0).map((it) => (it.segment?.trim() ? it.segment.trim() : "unknown")),
        8
      );

      lines.push(`#### Evidence coverage (${escapeMdTableCell(title)})`);
      lines.push("");
      lines.push(`- Items with evidence: ${withEvidence}/${items.length} (${pct}%)`);
      if (topSegs.length) {
        lines.push(`- Evidence present by segment (top): ${escapeMdTableCell(topSegs.map((r) => `${r.value} (${r.count})`).join(", "))}`);
      }
      lines.push("");
    }

    // Per-document extraction quality health
    {
      const ocrMissing = countWhere(items, (it) => (it.content_preview?.ocr_text_len ?? 0) === 0);
      const structuredPresent = countWhere(items, (it) => it.content_preview?.structured_json_present === true);
      const structuredMissing = countWhere(items, (it) => it.content_preview?.structured_json_present === false);
      const rescorePresent = countWhere(items, (it) => Boolean(it.rescore));

      lines.push(`#### Extraction quality health (${escapeMdTableCell(title)})`);
      lines.push("");
      lines.push(`- OCR missing/empty (ocr_text_len=0): ${ocrMissing}/${items.length}`);
      lines.push(`- Structured JSON present: ${structuredPresent}/${items.length}`);
      lines.push(`- Structured JSON missing: ${structuredMissing}/${items.length}`);
      lines.push(`- Rescore fields present: ${rescorePresent}/${items.length}`);
      lines.push("");
    }

    // Per-document remediation checklist
    {
      const unknowns = items.filter((it) => it.segment === "unknown");
      const { reasonCodes, byReason } = summarizeUnknownGroups(unknowns);

      lines.push(`#### Remediation checklist (${escapeMdTableCell(title)})`);
      lines.push("");
      if (!unknowns.length) {
        lines.push(`- No unknown items.`);
        lines.push("");
      } else {
        for (const code of reasonCodes) {
          const group = byReason.get(code) ?? [];
          lines.push(`- **${escapeMdTableCell(code)}**: ${group.length}`);
          for (const action of remediationForUnknown(code)) {
            lines.push(`  - ${escapeMdTableCell(action)}`);
          }
        }
        lines.push("");
      }
    }

    // Per-document persisted vs rescore
    {
      const persisted = items.filter((it) => it.segment_source === "persisted" && typeof it.rescore?.segment === "string");
      if (persisted.length) {
        const changed = persisted.filter((it) => (it.rescore?.segment ?? "") !== (it.segment ?? ""));
        const unchanged = persisted.length - changed.length;
        const changedTo = topCounts(changed.map((it) => it.rescore?.segment ?? "unknown"), 10);

        lines.push(`#### Persisted vs rescore (${escapeMdTableCell(title)})`);
        lines.push("");
        lines.push(`- Persisted items with rescore: ${persisted.length}`);
        lines.push(`- Would change segment: ${changed.length}`);
        lines.push(`- Would stay same: ${unchanged}`);
        if (changedTo.length) {
          lines.push(`- Most common rescore targets (when changed): ${escapeMdTableCell(changedTo.map((r) => `${r.value} (${r.count})`).join(", "))}`);
        }

        const sample = changed
          .slice()
          .sort((a, b) => (a.page_index ?? 1e9) - (b.page_index ?? 1e9) || a.page_label.localeCompare(b.page_label))
          .slice(0, 12);
        if (sample.length) {
          lines.push("");
          lines.push(`| Page / Item | Persisted | Rescore | Rescore conf | Rescore snippet |`);
          lines.push(`|---|---|---|---:|---|`);
          for (const it of sample) {
            const conf = fmtConfidence(it.rescore?.confidence ?? null);
            lines.push(
              `| ${escapeMdTableCell(it.page_label)} | ${escapeMdTableCell(it.segment)} | ${escapeMdTableCell(it.rescore?.segment ?? "")} | ${conf} | ${escapeMdTableCell(it.rescore?.snippet ?? "")} |`
            );
          }
        }

        lines.push("");
      }
    }

    for (const seg of segments) {
      const segItems = bySegment.get(seg) ?? [];
      lines.push(`#### Segment: ${escapeMdTableCell(seg)} (${segItems.length})`);
      lines.push("");

      lines.push(
        `| Page / Item | Segment | Segment source | Confidence | Text sources used | Content preview (json/ocr) | Classifier snippet (used) | Keyword evidence | Reason | Top scores |`
      );
      lines.push(`|---|---|---|---:|---|---|---|---|---|---|`);

      for (const it of segItems) {
        const label = it.page_label ?? (it.page_index != null ? `Item ${it.page_index + 1}` : "Item —");
        const segSource = it.segment_source ?? "missing";
        const conf = fmtConfidence(it.segment_confidence);

        const sourcesUsedCell = formatTextSourcesUsed(it);

        const previewCell = contentPreviewCell(it);
        const classifierCell = classifierSnippetCell(it);

        const keywordEvidenceCell = formatKeywordEvidence(it);

        const reasonCell = formatReasonCell(it);

        const topScoresCell = formatTopScores(it);

        lines.push(
          `| ${escapeMdTableCell(label)} | ${escapeMdTableCell(it.segment)} | ${escapeMdTableCell(segSource)} | ${conf} | ${sourcesUsedCell} | ${previewCell} | ${classifierCell} | ${keywordEvidenceCell} | ${reasonCell} | ${topScoresCell} |`
        );
      }

      lines.push("");
    }

    lines.push("");
  }

  lines.push("---");
  lines.push("Generated from `segment_audit_report` only. If `segment_rescore=1` was requested, rescore fields are computed server-side for comparison (no DB writes).");

  await atomicWriteFile(outPath, lines.join("\n"));
  console.log(`[segment-audit-report] Wrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
