export {};

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

type ApiError = { code: string; message: string };

type SegmentScore = { segment: string; score: number };

type SegmentAuditItem = {
  visual_asset_id?: string;
  document_id?: string;

  page_index?: number | null;
  page_label?: string;

  // Effective segment (server-side effective result)
  segment?: string;
  effective_segment?: string;

  segment_source?: string;
  segment_confidence?: number | null;

  // Persisted segment
  persisted_segment_key?: string | null;

  // Computed segment (rescore)
  computed_segment?: string | null;
  captured_text?: string;

  // Reasons (shape varies slightly across versions)
  computed_reason?: {
    best_score?: number | null;
    threshold?: number | null;
    top_scores?: SegmentScore[];
    unknown_reason_code?: string | null;
    override_rule_id?: string | null;
    rule_id?: string | null;
  } | null;

  reason?: {
    best_score?: number | null;
    threshold?: number | null;
    top_scores?: SegmentScore[];
    unknown_reason_code?: string | null;
    override_rule_id?: string | null;
    rule_id?: string | null;
  } | null;

  snippet?: string | null;
};

type SegmentAuditDocument = {
  document_id: string;
  title?: string | null;
  type?: string | null;
  items: SegmentAuditItem[];
};

type SegmentAuditReport = {
  deal_id?: string;
  generated_at?: string;
  documents: SegmentAuditDocument[];
  error?: ApiError;
};

type LineageResponse = {
  deal_id?: string;
  segment_audit_report?: SegmentAuditReport;
};

type SegmentFeaturesResponse = {
  deal_id?: string;
  generated_at?: string;
  samples: Array<{
    source_kind?: string;
    document_id?: string;
    visual_asset_id?: string;
    page_index?: number | null;
    features?: unknown;
    classification_text?: string;
  }>;
};

type FeatureIndex = {
  byVisualAssetId: Map<string, unknown>;
  byDocPageIndex: Map<string, Map<number, unknown>>;
};

type EffectiveMode = "effective" | "computed" | "persisted";

type CliOpts = {
  dealId: string;
  apiBase: string;
  includeText: boolean;
  maxText: number;
  open: boolean;
  docId?: string;
  effectiveMode: EffectiveMode;

  includeFeatures: boolean;
  featuresOnlyMismatch: boolean;
  featuresMax: number;
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

function coerceBool(raw: unknown, defaultValue: boolean) {
  if (raw == null) return defaultValue;
  const v = String(raw).toLowerCase().trim();
  if (["1", "true", "yes", "y", "on"].includes(v)) return true;
  if (["0", "false", "no", "n", "off"].includes(v)) return false;
  return defaultValue;
}

function coerceInt(raw: unknown, defaultValue: number) {
  if (raw == null) return defaultValue;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : defaultValue;
}

function slugify(input: string): string {
  const s = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
  return s.length ? s : "document";
}

function escapeMdTableCell(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/\n/g, "\\n")
    .replace(/\|/g, "\\|")
    .trim();
}

function truncateText(value: string, maxLen: number): string {
  if (value.length <= maxLen) return value;
  return `${value.slice(0, maxLen).trimEnd()}…`;
}

function stableNowIso(): string {
  return new Date().toISOString();
}

async function fetchJson<T>(url: URL): Promise<T> {
  if (typeof fetch !== "function") {
    throw new Error("Global fetch() is not available. Use Node 18+.");
  }

  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${url.toString()}${text ? `\n${text}` : ""}`);
  }
  return (await res.json()) as T;
}

async function fetchJsonAllowError<T>(url: URL): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    const value = await fetchJson<T>(url);
    return { ok: true, value };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

async function atomicWriteFile(filePath: string, content: string): Promise<void> {
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, content, "utf8");
  await fs.rename(tmp, filePath);
}

function fmtConfidence(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const pct = value <= 1 ? value * 100 : value;
  return `${Math.round(pct)}%`;
}

function stableSortDocuments(docs: SegmentAuditDocument[]): SegmentAuditDocument[] {
  return docs
    .slice()
    .sort(
      (a, b) =>
        (a.document_id ?? "").localeCompare(b.document_id ?? "") ||
        String(a.title ?? "").localeCompare(String(b.title ?? ""))
    );
}

function stableSortItems(items: SegmentAuditItem[]): SegmentAuditItem[] {
  return items
    .slice()
    .sort((a, b) => {
      const pa = typeof a.page_index === "number" ? a.page_index : Number.MAX_SAFE_INTEGER;
      const pb = typeof b.page_index === "number" ? b.page_index : Number.MAX_SAFE_INTEGER;
      if (pa !== pb) return pa - pb;
      return String(a.page_label ?? "").localeCompare(String(b.page_label ?? ""));
    });
}

function getEffectiveSegmentRaw(item: SegmentAuditItem): string {
  const v = item.effective_segment ?? item.segment;
  return typeof v === "string" && v.trim().length ? v.trim() : "unknown";
}

function getPersistedSegmentRaw(item: SegmentAuditItem): string {
  const v = item.persisted_segment_key;
  return typeof v === "string" && v.trim().length ? v.trim() : "unknown";
}

function getComputedSegmentRaw(item: SegmentAuditItem): string {
  const v = item.computed_segment;
  return typeof v === "string" && v.trim().length ? v.trim() : "unknown";
}

function getDisplayEffectiveSegment(item: SegmentAuditItem, mode: EffectiveMode): string {
  if (mode === "computed") return getComputedSegmentRaw(item);
  if (mode === "persisted") return getPersistedSegmentRaw(item);
  return getEffectiveSegmentRaw(item);
}

function getBestScore(item: SegmentAuditItem): number | null {
  const v = item.computed_reason?.best_score ?? item.reason?.best_score;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function getThreshold(item: SegmentAuditItem): number | null {
  const v = item.computed_reason?.threshold ?? item.reason?.threshold;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function getTopScores(item: SegmentAuditItem): SegmentScore[] {
  const scores = item.computed_reason?.top_scores ?? item.reason?.top_scores;
  if (!Array.isArray(scores)) return [];
  return scores
    .filter((s) => s && typeof s.segment === "string" && typeof s.score === "number" && Number.isFinite(s.score))
    .slice()
    .sort((a, b) => b.score - a.score || a.segment.localeCompare(b.segment));
}

function formatTopScoresCompact(item: SegmentAuditItem, limit = 4): string {
  const top = getTopScores(item).slice(0, limit);
  if (!top.length) return "—";
  return top.map((s) => `${s.segment}:${s.score.toFixed(2)}`).join("; ");
}

function getRuleId(item: SegmentAuditItem): string {
  const v =
    item.computed_reason?.override_rule_id ??
    item.computed_reason?.rule_id ??
    item.reason?.override_rule_id ??
    item.reason?.rule_id;
  return typeof v === "string" && v.trim().length ? v.trim() : "—";
}

function getUnknownReasonCode(item: SegmentAuditItem): string {
  const v = item.computed_reason?.unknown_reason_code ?? item.reason?.unknown_reason_code;
  return typeof v === "string" && v.trim().length ? v.trim() : "—";
}

function getCapturedText(item: SegmentAuditItem): string {
  const raw =
    (typeof item.captured_text === "string" ? item.captured_text : "") ||
    (typeof item.snippet === "string" ? item.snippet : "") ||
    "";
  return raw.replace(/\r\n?/g, "\n").trim();
}

function getPersistedSegmentOrNull(item: SegmentAuditItem): string | null {
  const v = item.persisted_segment_key;
  return typeof v === "string" && v.trim().length ? v.trim() : null;
}

function getComputedSegmentOrNull(item: SegmentAuditItem): string | null {
  const v = item.computed_segment;
  return typeof v === "string" && v.trim().length ? v.trim() : null;
}

function computeCounts(values: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return out;
}

function sortedCountRows(counts: Record<string, number>): Array<{ segment: string; count: number }> {
  return Object.entries(counts)
    .map(([segment, count]) => ({ segment, count }))
    .sort((a, b) => b.count - a.count || a.segment.localeCompare(b.segment));
}

function mismatches(items: SegmentAuditItem[]): SegmentAuditItem[] {
  return items.filter((it) => {
    const eff = getEffectiveSegmentRaw(it);
    const per = getPersistedSegmentRaw(it);
    const comp = getComputedSegmentRaw(it);
    return eff !== comp || per !== comp;
  });
}

function buildErrorBlock(err: ApiError): string[] {
  return [
    "## Error",
    "",
    "The API returned an error in `segment_audit_report.error`.",
    "",
    "```json",
    JSON.stringify(err, null, 2),
    "```",
    "",
  ];
}

function buildWarningBlock(message: string): string[] {
  return [
    "## Warning",
    "",
    message,
    "",
  ];
}

function renderSummaryTable(args: {
  totalItems: number;
  effectiveCounts: Record<string, number>;
  persistedCounts: Record<string, number>;
  computedCounts: Record<string, number>;
  mismatchEffectiveVsComputed: number;
  mismatchPersistedVsComputed: number;
}): string[] {
  const lines: string[] = [];

  lines.push("## Summary");
  lines.push("");
  lines.push("| Metric | Value |");
  lines.push("|---|---:|");
  lines.push(`| Total pages/items | ${args.totalItems} |`);
  lines.push(`| Mismatches (effective != computed) | ${args.mismatchEffectiveVsComputed} |`);
  lines.push(`| Mismatches (persisted != computed) | ${args.mismatchPersistedVsComputed} |`);
  lines.push("");

  const emitCounts = (label: string, counts: Record<string, number>) => {
    lines.push(`### Counts by ${label}`);
    lines.push("");
    lines.push("| Segment | Count |");
    lines.push("|---|---:|");
    for (const row of sortedCountRows(counts)) {
      lines.push(`| ${escapeMdTableCell(row.segment)} | ${row.count} |`);
    }
    if (!Object.keys(counts).length) {
      lines.push("| (none) | 0 |");
    }
    lines.push("");
  };

  emitCounts("effective segment", args.effectiveCounts);
  emitCounts("persisted segment", args.persistedCounts);
  emitCounts("computed segment", args.computedCounts);

  return lines;
}

function renderPageByPageTable(opts: {
  items: SegmentAuditItem[];
  effectiveMode: EffectiveMode;
  includeText: boolean;
  maxText: number;
}): string[] {
  const lines: string[] = [];

  lines.push("## Page-by-Page");
  lines.push("");
  lines.push(
    "| page_label | effective_segment | persisted_segment_key | computed_segment | segment_source | segment_confidence | best_score | threshold | top_scores | rule_id | unknown_reason_code | captured_text |"
  );
  lines.push(
    "|---|---|---|---|---|---:|---:|---:|---|---|---|---|"
  );

  for (const it of stableSortItems(opts.items)) {
    const pageLabel = escapeMdTableCell(String(it.page_label ?? (it.page_index != null ? `Page ${it.page_index + 1}` : "—")));

    const effective = escapeMdTableCell(getDisplayEffectiveSegment(it, opts.effectiveMode));
    const persisted = escapeMdTableCell(getPersistedSegmentRaw(it));
    const computed = escapeMdTableCell(getComputedSegmentRaw(it));

    const source = escapeMdTableCell(String(it.segment_source ?? "—"));
    const conf = escapeMdTableCell(fmtConfidence(it.segment_confidence));

    const best = getBestScore(it);
    const threshold = getThreshold(it);

    const topScores = escapeMdTableCell(formatTopScoresCompact(it, 4));
    const ruleId = escapeMdTableCell(getRuleId(it));
    const unknownReason = escapeMdTableCell(getUnknownReasonCode(it));

    const capturedRaw = opts.includeText ? getCapturedText(it) : "";
    const captured = opts.includeText
      ? escapeMdTableCell(truncateText(capturedRaw, opts.maxText))
      : "(omitted)";

    lines.push(
      `| ${pageLabel} | ${effective} | ${persisted} | ${computed} | ${source} | ${conf} | ${best != null ? best.toFixed(2) : "—"} | ${
        threshold != null ? threshold.toFixed(2) : "—"
      } | ${topScores} | ${ruleId} | ${unknownReason} | ${captured} |`
    );
  }

  lines.push("");
  return lines;
}

function buildFeatureIndex(resp: SegmentFeaturesResponse): FeatureIndex {
  const byVisualAssetId = new Map<string, unknown>();
  const byDocPageIndex = new Map<string, Map<number, unknown>>();

  const samples = Array.isArray(resp.samples) ? resp.samples : [];
  for (const s of samples) {
    const visualId = typeof s?.visual_asset_id === "string" && s.visual_asset_id.trim().length ? s.visual_asset_id.trim() : null;
    const docId = typeof s?.document_id === "string" && s.document_id.trim().length ? s.document_id.trim() : null;
    const pageIndex = typeof s?.page_index === "number" && Number.isFinite(s.page_index) ? s.page_index : null;

    const payload = (s as any)?.features;
    if (visualId) byVisualAssetId.set(visualId, payload);
    if (docId && pageIndex != null) {
      const m = byDocPageIndex.get(docId) ?? new Map<number, unknown>();
      // Stable: first write wins.
      if (!m.has(pageIndex)) m.set(pageIndex, payload);
      byDocPageIndex.set(docId, m);
    }
  }

  return { byVisualAssetId, byDocPageIndex };
}

function findFeaturesForItem(features: FeatureIndex, docId: string, item: SegmentAuditItem): unknown | null {
  const visualId = typeof item.visual_asset_id === "string" && item.visual_asset_id.trim().length ? item.visual_asset_id.trim() : null;
  if (visualId && features.byVisualAssetId.has(visualId)) {
    return features.byVisualAssetId.get(visualId) ?? null;
  }

  const pageIndex = typeof item.page_index === "number" && Number.isFinite(item.page_index) ? item.page_index : null;
  if (pageIndex != null) {
    const docMap = features.byDocPageIndex.get(docId);
    if (docMap && docMap.has(pageIndex)) return docMap.get(pageIndex) ?? null;
  }

  return null;
}

function renderFeatureAppendix(opts: {
  docId: string;
  items: SegmentAuditItem[];
  features: FeatureIndex | null;
  includeFeatures: boolean;
  featuresOnlyMismatch: boolean;
  featuresMax: number;
}): string[] {
  if (!opts.includeFeatures) return [];

  const lines: string[] = [];
  lines.push("## Feature Appendix");
  lines.push("");

  if (!opts.features) {
    lines.push("Feature payloads were requested, but could not be fetched.");
    lines.push("");
    return lines;
  }

  const includeItem = (it: SegmentAuditItem) => {
    if (!opts.featuresOnlyMismatch) return true;
    const eff = getEffectiveSegmentRaw(it);
    const comp = getComputedSegmentOrNull(it);
    const per = getPersistedSegmentOrNull(it);
    return eff !== (comp ?? null) || comp !== per;
  };

  const selected = stableSortItems(opts.items).filter(includeItem);
  let rendered = 0;

  for (const it of selected) {
    if (rendered >= opts.featuresMax) break;

    const payload = findFeaturesForItem(opts.features, opts.docId, it);
    if (payload == null) continue;

    const pageLabel = String(it.page_label ?? (it.page_index != null ? `Page ${it.page_index + 1}` : "—"));
    const effective = getEffectiveSegmentRaw(it);
    const computed = getComputedSegmentOrNull(it);
    const persisted = getPersistedSegmentOrNull(it);
    const visualId = typeof it.visual_asset_id === "string" ? it.visual_asset_id : "";

    lines.push(`### ${escapeMdTableCell(pageLabel)} — ${escapeMdTableCell(effective)}`);
    lines.push(`- visual_asset_id: ${escapeMdTableCell(visualId)}`);
    lines.push(`- effective_segment: ${escapeMdTableCell(effective)}`);
    lines.push(`- computed_segment: ${escapeMdTableCell(computed ?? "null")}`);
    lines.push(`- persisted_segment_key: ${escapeMdTableCell(persisted ?? "null")}`);
    lines.push("");
    lines.push("```json");
    lines.push(JSON.stringify(payload, null, 2));
    lines.push("```");
    lines.push("");
    rendered += 1;
  }

  if (rendered === 0) {
    lines.push("No matching feature payloads were returned for the selected pages.");
    lines.push("");
  }

  return lines;
}

function renderMismatchDetails(opts: {
  items: SegmentAuditItem[];
  includeText: boolean;
  maxText: number;
}): string[] {
  const bad = mismatches(opts.items);
  const lines: string[] = [];

  lines.push("## Mismatch Details");
  lines.push("");

  if (!bad.length) {
    lines.push("No mismatches found.");
    lines.push("");
    return lines;
  }

  lines.push("Rows where: effective != computed OR persisted != computed");
  lines.push("");
  lines.push("| page_label | effective_segment | persisted_segment_key | computed_segment | captured_text | ");
  lines.push("|---|---|---|---|---|");

  for (const it of stableSortItems(bad)) {
    const pageLabel = escapeMdTableCell(String(it.page_label ?? (it.page_index != null ? `Page ${it.page_index + 1}` : "—")));
    const effective = escapeMdTableCell(getEffectiveSegmentRaw(it));
    const persisted = escapeMdTableCell(getPersistedSegmentRaw(it));
    const computed = escapeMdTableCell(getComputedSegmentRaw(it));

    const capturedRaw = opts.includeText ? getCapturedText(it) : "";
    const captured = opts.includeText
      ? escapeMdTableCell(truncateText(capturedRaw, opts.maxText))
      : "(omitted)";

    lines.push(`| ${pageLabel} | ${effective} | ${persisted} | ${computed} | ${captured} |`);
  }

  lines.push("");
  return lines;
}

function buildDocReport(opts: {
  dealId: string;
  doc: SegmentAuditDocument;
  endpoint: string;
  effectiveMode: EffectiveMode;
  includeText: boolean;
  maxText: number;
  reportError?: ApiError;

  includeFeatures: boolean;
  featuresOnlyMismatch: boolean;
  featuresMax: number;
  features: FeatureIndex | null;
}): string {
  const now = stableNowIso();
  const title = String(opts.doc.title ?? "(untitled)");

  const items = Array.isArray(opts.doc.items) ? opts.doc.items : [];

  const effCounts = computeCounts(items.map((it) => getDisplayEffectiveSegment(it, opts.effectiveMode)));
  const persistedCounts = computeCounts(items.map((it) => getPersistedSegmentRaw(it)));
  const computedCounts = computeCounts(items.map((it) => getComputedSegmentRaw(it)));

  const mismatchEff = items.filter((it) => getEffectiveSegmentRaw(it) !== getComputedSegmentRaw(it)).length;
  const mismatchPer = items.filter((it) => getPersistedSegmentRaw(it) !== getComputedSegmentRaw(it)).length;

  const lines: string[] = [];

  lines.push(`# Segment Audit`);
  lines.push("");
  lines.push(`- deal_id: ${escapeMdTableCell(opts.dealId)}`);
  lines.push(`- document_title: ${escapeMdTableCell(title)}`);
  lines.push(`- document_id: ${escapeMdTableCell(opts.doc.document_id)}`);
  lines.push(`- generated_at: ${escapeMdTableCell(now)}`);
  lines.push(`- source_endpoint: ${escapeMdTableCell(opts.endpoint)}`);
  lines.push(`- effective_mode: ${escapeMdTableCell(opts.effectiveMode)}`);
  lines.push("");

  if (opts.reportError) {
    lines.push(...buildErrorBlock(opts.reportError));
  }

  lines.push(
    ...renderSummaryTable({
      totalItems: items.length,
      effectiveCounts: effCounts,
      persistedCounts,
      computedCounts,
      mismatchEffectiveVsComputed: mismatchEff,
      mismatchPersistedVsComputed: mismatchPer,
    })
  );

  lines.push(
    ...renderPageByPageTable({
      items,
      effectiveMode: opts.effectiveMode,
      includeText: opts.includeText,
      maxText: opts.maxText,
    })
  );

  lines.push(...renderMismatchDetails({ items, includeText: opts.includeText, maxText: opts.maxText }));

  // Feature appendix (optional). Must not affect the main page-by-page table.
  lines.push(
    ...renderFeatureAppendix({
      docId: opts.doc.document_id,
      items,
      features: opts.features,
      includeFeatures: opts.includeFeatures,
      featuresOnlyMismatch: opts.featuresOnlyMismatch,
      featuresMax: opts.featuresMax,
    })
  );

  lines.push("---");
  lines.push("Generated from `GET /api/v1/deals/:deal_id/lineage?debug_segments=1&segment_audit=1&segment_rescore=1` (read-only).");
  lines.push("");

  return lines.join("\n");
}

function buildIndex(opts: {
  dealId: string;
  endpoint: string;
  generatedAt: string;
  docRows: Array<{
    document_id: string;
    title: string;
    filename: string;
    total_items: number;
    mismatches_effective_vs_computed: number;
    mismatches_persisted_vs_computed: number;
  }>;
  reportError?: ApiError;
  warning?: string;
}): string {
  const lines: string[] = [];

  lines.push(`# Segment Audits Index`);
  lines.push("");
  lines.push(`- deal_id: ${escapeMdTableCell(opts.dealId)}`);
  lines.push(`- generated_at: ${escapeMdTableCell(opts.generatedAt)}`);
  lines.push(`- source_endpoint: ${escapeMdTableCell(opts.endpoint)}`);
  lines.push("");

  if (opts.warning) {
    lines.push(...buildWarningBlock(opts.warning));
  }

  if (opts.reportError) {
    lines.push(...buildErrorBlock(opts.reportError));
  }

  lines.push("## Documents");
  lines.push("");
  lines.push("| title | document_id | total_items | mismatches (eff!=comp) | mismatches (per!=comp) | link |");
  lines.push("|---|---|---:|---:|---:|---|");

  const sorted = opts.docRows
    .slice()
    .sort((a, b) => a.document_id.localeCompare(b.document_id) || a.title.localeCompare(b.title));

  for (const row of sorted) {
    lines.push(
      `| ${escapeMdTableCell(row.title)} | ${escapeMdTableCell(row.document_id)} | ${row.total_items} | ${row.mismatches_effective_vs_computed} | ${row.mismatches_persisted_vs_computed} | [report](./${encodeURIComponent(
        row.filename
      )}) |`
    );
  }

  if (!sorted.length) {
    lines.push("| (none) | — | 0 | 0 | 0 | — |");
  }

  lines.push("");
  lines.push("---");
  lines.push("Tip: open a document report to review per-page segment reasons and captured text snippets.");
  lines.push("");

  return lines.join("\n");
}

function parseCli(argv: string[]): CliOpts {
  const args = parseArgs(argv);

  const dealId = String(args.deal ?? "").trim();
  if (!dealId) {
    throw new Error("Missing required flag: --deal <uuid>");
  }

  const apiBase = String(args.base ?? "http://localhost:9000").trim() || "http://localhost:9000";

  const includeText = coerceBool(args["include-text"], true);
  const maxText = Math.max(0, coerceInt(args["max-text"], 800));

  const open = coerceBool(args.open, false);
  const docId = args.doc ? String(args.doc).trim() : undefined;

  const effectiveModeRaw = String(args["effective-mode"] ?? "effective").trim() as EffectiveMode;
  const effectiveMode: EffectiveMode =
    effectiveModeRaw === "computed" || effectiveModeRaw === "persisted" || effectiveModeRaw === "effective"
      ? effectiveModeRaw
      : "effective";

  const includeFeatures = coerceBool(args["include-features"], false);
  const featuresOnlyMismatch = coerceBool(args["features-only-mismatch"], true);
  const featuresMax = Math.max(0, coerceInt(args["features-max"], 25));

  return {
    dealId,
    apiBase,
    includeText,
    maxText,
    open,
    docId,
    effectiveMode,

    includeFeatures,
    featuresOnlyMismatch,
    featuresMax,
  };
}

async function main() {
  const opts = parseCli(process.argv.slice(2));

  const __filename = fileURLToPath(import.meta.url);
  const repoRoot = path.resolve(path.dirname(__filename), "..");

  const outDir = path.join(repoRoot, "docs/Reports/segment-audits", opts.dealId);
  await fs.mkdir(outDir, { recursive: true });

  const base = new URL(opts.apiBase);
  const url = new URL(`/api/v1/deals/${encodeURIComponent(opts.dealId)}/lineage`, base);
  url.searchParams.set("debug_segments", "1");
  url.searchParams.set("segment_audit", "1");
  url.searchParams.set("segment_rescore", "1");

  // Optional: fetch canonical segment features used for classification (DEV-only endpoint).
  let features: FeatureIndex | null = null;
  let featuresWarning: string | undefined;
  if (opts.includeFeatures) {
    const featuresUrl = new URL(`/api/v1/deals/${encodeURIComponent(opts.dealId)}/segments/features`, base);
    // Maximize available samples (endpoint caps to 5).
    featuresUrl.searchParams.set("limit_per_kind", "5");
    const res = await fetchJsonAllowError<SegmentFeaturesResponse>(featuresUrl);
    if (res.ok) {
      features = buildFeatureIndex(res.value);
    } else {
      featuresWarning = `Failed to fetch segment features from ${featuresUrl.toString()}. Reports were generated without feature appendices.\n\nError: ${escapeMdTableCell(res.error)}`;
      features = null;
    }
  }

  const generatedAt = stableNowIso();

  const resp = await fetchJson<LineageResponse>(url);
  const report = resp.segment_audit_report;

  if (!report) {
    const index = buildIndex({
      dealId: opts.dealId,
      endpoint: url.toString(),
      generatedAt,
      docRows: [],
      reportError: { code: "MISSING_SEGMENT_AUDIT_REPORT", message: "Response missing segment_audit_report" },
      ...(featuresWarning ? { warning: featuresWarning } : {}),
    });
    await atomicWriteFile(path.join(outDir, "index.md"), index);
    console.log(outDir);
    return;
  }

  let documents = stableSortDocuments(Array.isArray(report.documents) ? report.documents : []);
  if (opts.docId) {
    documents = documents.filter((d) => d.document_id === opts.docId);
  }

  const docRows: Array<{
    document_id: string;
    title: string;
    filename: string;
    total_items: number;
    mismatches_effective_vs_computed: number;
    mismatches_persisted_vs_computed: number;
  }> = [];

  for (const doc of documents) {
    const title = String(doc.title ?? "(untitled)");
    const safeTitle = slugify(title);
    const filename = `${safeTitle}.${doc.document_id}.md`;

    const items = Array.isArray(doc.items) ? doc.items : [];

    const mismEff = items.filter((it) => getEffectiveSegmentRaw(it) !== getComputedSegmentRaw(it)).length;
    const mismPer = items.filter((it) => getPersistedSegmentRaw(it) !== getComputedSegmentRaw(it)).length;

    docRows.push({
      document_id: doc.document_id,
      title,
      filename,
      total_items: items.length,
      mismatches_effective_vs_computed: mismEff,
      mismatches_persisted_vs_computed: mismPer,
    });

    const md = buildDocReport({
      dealId: opts.dealId,
      doc,
      endpoint: url.toString(),
      effectiveMode: opts.effectiveMode,
      includeText: opts.includeText,
      maxText: opts.maxText,
      reportError: report.error,

      includeFeatures: opts.includeFeatures,
      featuresOnlyMismatch: opts.featuresOnlyMismatch,
      featuresMax: opts.featuresMax,
      features,
    });

    await atomicWriteFile(path.join(outDir, filename), md);
  }

  const index = buildIndex({
    dealId: opts.dealId,
    endpoint: url.toString(),
    generatedAt,
    docRows,
    reportError: report.error,
    ...(featuresWarning ? { warning: featuresWarning } : {}),
  });

  await atomicWriteFile(path.join(outDir, "index.md"), index);

  if (opts.open) {
    console.log(outDir);
  } else {
    console.log(`[segment:audit] Wrote ${docRows.length} document report(s) + index.md to ${outDir}`);
  }
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`[segment:audit] ${msg}`);
  process.exitCode = 1;
});
