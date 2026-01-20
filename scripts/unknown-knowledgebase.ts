export {};

import path from "node:path";
import { fileURLToPath } from "node:url";

import { detectContentArchetypeTags } from "../packages/core/src/classification/content-archetypes";

type SummaryFile = {
  generated_at?: string;
  apiBaseUrl?: string;
  summaries?: Array<{
    deal_id: string;
    deal_name?: string | null;
    out_json?: string;
  }>;
};

type DealPhase1Meta = {
  deal_id: string;
  deal_name?: string | null;
  business_archetype?: string | null;
  deal_type?: string | null;
  business_model?: string | null;
};

type SegmentAuditItem = {
  visual_asset_id?: string;
  document_id?: string;
  page_index?: number | null;
  page_label?: string | null;
  image_uri?: string | null;
  segment?: string;
  segment_confidence?: number | null;
  segment_source?: string | null;
  archetype_tags?: string[];
  snippet?: string | null;
  reason?: {
    title_text_snippet?: string | null;
    unknown_reason_code?: string | null;
  };
  content_preview?: {
    ocr_text_snippet?: string | null;
    structured_json_snippet?: string | null;
  };
};

type SegmentAuditDocument = {
  document_id: string;
  title?: string | null;
  type?: string | null;
  page_count?: number | null;
  items?: SegmentAuditItem[];
};

type SegmentAuditReport = {
  deal_id: string;
  generated_at?: string;
  documents?: SegmentAuditDocument[];
};

type LineageResponse = {
  deal_id: string;
  segment_audit_report?: SegmentAuditReport;
};

type UnknownKnowledgeRow = {
  schema_version: 1;
  harvested_at: string;

  // Optional: set when we backfill fields from newer lineage artifacts.
  enriched_at?: string;

  // Dedupe key: stable, unique per asset within a deal.
  key: string;

  deal_id: string;
  deal_name: string | null;
  deal_business_archetype: string | null;
  deal_type: string | null;
  business_model: string | null;

  document_id: string;
  document_title: string | null;
  document_type: string | null;

  visual_asset_id: string | null;
  page_index: number | null;
  page_label: string | null;
  image_uri: string | null;

  unknown_reason_code: string | null;
  archetype_tags: string[];

  title_text_snippet: string | null;
  snippet: string | null;
  ocr_text_snippet: string | null;
  structured_json_snippet: string | null;
};

function uniqStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}

function parseArgs(argv: string[]) {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      args.help = true;
      continue;
    }
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        args[key] = next;
        i++;
      } else {
        args[key] = "true";
      }
    }
  }
  return args;
}

function boolArg(value: string | boolean | undefined, defaultValue: boolean): boolean {
  if (value == null) return defaultValue;
  if (typeof value === "boolean") return value;
  const s = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(s)) return true;
  if (["0", "false", "no", "off"].includes(s)) return false;
  return defaultValue;
}

function usage() {
  return `unknown-knowledgebase\n\nHarvests unknown segment items from existing segment-audit lineage JSON files and writes an append-only JSONL corpus + summaries.\n\nDefaults assume you already ran: pnpm report:segments:audit:all\n\nUsage:\n  pnpm tsx scripts/unknown-knowledgebase.ts\n\nOptions:\n  --api-base-url              Base URL for API (default: from summary.json or http://localhost:9000)\n  --summary-json              Segment audit all-deals summary (default: artifacts/segment-audit/all-deals/summary.json)\n  --in-json-dir               Directory of *.lineage.json files (default: artifacts/segment-audit/all-deals)\n  --out-dir                   Output directory (default: artifacts/unknown-knowledgebase)\n  --out-jsonl                 Append-only JSONL path (default: <out-dir>/unknown_items.jsonl)\n  --out-jsonl-enriched         Materialized/enriched JSONL (rewritten each run; default: <out-dir>/unknown_items.enriched.jsonl)\n  --out-summary-json          Summary JSON path (default: <out-dir>/summary.json)\n  --out-summary-md            Summary Markdown path (default: <out-dir>/summary.md)\n  --out-summary-json-enriched  Enriched summary JSON (default: <out-dir>/summary.enriched.json)\n  --out-summary-md-enriched    Enriched summary Markdown (default: <out-dir>/summary.enriched.md)\n  --append                    Append and dedupe against existing JSONL (default: true)\n  --fetch-deal-meta           Fetch deal phase1 meta (business archetype / deal type) from API (default: true)\n  --max-rows                  Cap number of harvested rows this run (default: unlimited)\n`;
}

async function readJson(filePath: string): Promise<any> {
  const fs = await import("node:fs/promises");
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function writeFile(filePath: string, content: string): Promise<void> {
  const fs = await import("node:fs/promises");
  await fs.writeFile(filePath, content, "utf8");
}

async function appendFile(filePath: string, content: string): Promise<void> {
  const fs = await import("node:fs/promises");
  await fs.appendFile(filePath, content, "utf8");
}

async function ensureDir(dirPath: string): Promise<void> {
  const fs = await import("node:fs/promises");
  await fs.mkdir(dirPath, { recursive: true });
}

async function listLineageFiles(dirPath: string): Promise<string[]> {
  const fs = await import("node:fs/promises");
  const entries = await fs.readdir(dirPath);
  return entries
    .filter((name) => name.endsWith(".lineage.json"))
    .map((name) => path.join(dirPath, name))
    .sort((a, b) => a.localeCompare(b));
}

function normalizeStr(value: unknown, maxLen: number): string | null {
  if (typeof value !== "string") return null;
  const s = value.trim();
  if (!s) return null;
  return s.length > maxLen ? `${s.slice(0, maxLen - 1)}…` : s;
}

function stableKey(params: { dealId: string; documentId: string; visualAssetId: string | null; pageIndex: number | null; imageUri: string | null }): string {
  // Prefer visual_asset_id when present; fall back to (doc+page) for older/partial items.
  const base = `deal:${params.dealId}|doc:${params.documentId}`;
  if (params.visualAssetId) return `${base}|va:${params.visualAssetId}`;
  if (params.pageIndex != null) return `${base}|page:${params.pageIndex}`;
  if (params.imageUri) return `${base}|img:${params.imageUri}`;
  return `${base}|unknown-location`;
}

function inc(map: Record<string, number>, key: string, by = 1) {
  map[key] = (map[key] ?? 0) + by;
}

function sortEntries(m: Record<string, number>): Array<[string, number]> {
  return Object.entries(m).sort((a, b) => b[1] - a[1]);
}

async function loadExistingKeys(jsonlPath: string): Promise<Set<string>> {
  const fs = await import("node:fs/promises");
  const keys = new Set<string>();
  try {
    const raw = await fs.readFile(jsonlPath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim();
      if (!t) continue;
      try {
        const obj = JSON.parse(t) as any;
        const key = typeof obj?.key === "string" ? obj.key : null;
        if (key) keys.add(key);
      } catch {
        // Ignore malformed lines so we can still append future runs.
      }
    }
  } catch {
    // file doesn't exist
  }
  return keys;
}

async function loadExistingRows(jsonlPath: string): Promise<Map<string, UnknownKnowledgeRow>> {
  const fs = await import("node:fs/promises");
  const rows = new Map<string, UnknownKnowledgeRow>();
  try {
    const raw = await fs.readFile(jsonlPath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim();
      if (!t) continue;
      try {
        const obj = JSON.parse(t) as any;
        const key = typeof obj?.key === "string" ? obj.key : null;
        if (!key) continue;
        rows.set(key, obj as UnknownKnowledgeRow);
      } catch {
        // Ignore malformed lines.
      }
    }
  } catch {
    // file doesn't exist
  }
  return rows;
}

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url);
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}: ${text.slice(0, 300)}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Failed to parse JSON from ${url} (body head: ${text.slice(0, 180)})`);
  }
}

async function fetchDealMeta(apiBaseUrl: string, dealId: string): Promise<DealPhase1Meta> {
  const base = apiBaseUrl.replace(/\/$/, "");
  const url = `${base}/api/v1/deals/${encodeURIComponent(dealId)}?mode=phase1`;
  const raw = (await fetchJson(url)) as any;

  const dealName = typeof raw?.name === "string" ? raw.name : typeof raw?.label === "string" ? raw.label : null;

  const phase1BusinessArchetype = raw?.phase1_business_archetype_v1 ?? raw?.business_archetype_v1 ?? null;
  const businessArchetypeValue =
    typeof phase1BusinessArchetype?.value === "string" ? phase1BusinessArchetype.value : typeof phase1BusinessArchetype === "string" ? phase1BusinessArchetype : null;

  const dealOverview = raw?.phase1_deal_overview_v2 ?? raw?.deal_overview_v2 ?? null;
  const dealType = typeof dealOverview?.deal_type === "string" ? dealOverview.deal_type : null;
  const businessModel = typeof dealOverview?.business_model === "string" ? dealOverview.business_model : null;

  return {
    deal_id: dealId,
    deal_name: dealName,
    business_archetype: businessArchetypeValue,
    deal_type: dealType,
    business_model: businessModel,
  };
}

function extractUnknownRows(params: {
  lineage: LineageResponse;
  dealNameFromSummary: string | null;
  dealMeta: DealPhase1Meta | null;
  maxRows: number | null;
  existingKeys: Set<string>;
}): {
  addedRows: UnknownKnowledgeRow[];
  seenUnknownRows: UnknownKnowledgeRow[];
  stats: { totalSeen: number; totalUnknown: number; totalAdded: number };
} {
  const report = params.lineage.segment_audit_report;
  const documents = Array.isArray(report?.documents) ? report!.documents : [];

  const addedRows: UnknownKnowledgeRow[] = [];
  const seenUnknownRows: UnknownKnowledgeRow[] = [];
  let totalSeen = 0;
  let totalUnknown = 0;
  let totalAdded = 0;

  const dealId = String(params.lineage.deal_id);
  const dealName = params.dealMeta?.deal_name ?? params.dealNameFromSummary ?? null;

  for (const doc of documents) {
    const documentId = String(doc.document_id);
    const documentTitle = (typeof doc.title === "string" ? doc.title : null) ?? null;
    const documentType = (typeof doc.type === "string" ? doc.type : null) ?? null;

    const items = Array.isArray(doc.items) ? doc.items : [];
    for (const it of items) {
      totalSeen++;
      if (String(it?.segment ?? "unknown") !== "unknown") continue;
      totalUnknown++;

      const visualAssetId = typeof it.visual_asset_id === "string" && it.visual_asset_id.trim() ? it.visual_asset_id.trim() : null;
      const pageIndex = typeof it.page_index === "number" && Number.isFinite(it.page_index) ? it.page_index : null;
      const imageUri = typeof it.image_uri === "string" && it.image_uri.trim() ? it.image_uri.trim() : null;

      const key = stableKey({ dealId, documentId, visualAssetId, pageIndex, imageUri });

      const archetypeTags = Array.isArray((it as any).archetype_tags)
        ? (it as any).archetype_tags.filter((t: any) => typeof t === "string" && t.trim().length > 0).map((t: string) => t.trim())
        : [];

      // Backfill tags even when the lineage artifact didn't include them (e.g., API running older code).
      // We intentionally ignore structured_json_snippet here because our harvested "structured" field is
      // a small JSON hint blob (often just {"segment_key": ...}), which would add noise.
      const computedArchetypeTags = detectContentArchetypeTags({
        title: normalizeStr(it?.reason?.title_text_snippet, 220),
        snippet: normalizeStr((it as any)?.snippet, 600),
        ocr: normalizeStr(it?.content_preview?.ocr_text_snippet, 400),
        structured: null,
      });

      const mergedArchetypeTags = uniqStrings([
        ...archetypeTags,
        ...computedArchetypeTags.filter((t) => typeof t === "string" && t.trim().length > 0),
      ]);

      const row: UnknownKnowledgeRow = {
        schema_version: 1,
        harvested_at: new Date().toISOString(),
        key,

        deal_id: dealId,
        deal_name: dealName,
        deal_business_archetype: params.dealMeta?.business_archetype ?? null,
        deal_type: params.dealMeta?.deal_type ?? null,
        business_model: params.dealMeta?.business_model ?? null,

        document_id: documentId,
        document_title: documentTitle,
        document_type: documentType,

        visual_asset_id: visualAssetId,
        page_index: pageIndex,
        page_label: typeof it.page_label === "string" ? it.page_label : null,
        image_uri: imageUri,

        unknown_reason_code: normalizeStr(it?.reason?.unknown_reason_code, 80),
        archetype_tags: mergedArchetypeTags,

        title_text_snippet: normalizeStr(it?.reason?.title_text_snippet, 220),
        snippet: normalizeStr((it as any)?.snippet, 600),
        ocr_text_snippet: normalizeStr(it?.content_preview?.ocr_text_snippet, 400),
        structured_json_snippet: normalizeStr(it?.content_preview?.structured_json_snippet, 400),
      };

      seenUnknownRows.push(row);

      if (!params.existingKeys.has(key)) {
        addedRows.push(row);
        params.existingKeys.add(key);
        totalAdded++;
      }

      if (params.maxRows != null && totalAdded >= params.maxRows) {
        return { addedRows, seenUnknownRows, stats: { totalSeen, totalUnknown, totalAdded } };
      }
    }
  }

  return { addedRows, seenUnknownRows, stats: { totalSeen, totalUnknown, totalAdded } };
}

function buildSummary(params: { rows: UnknownKnowledgeRow[] }) {
  const byArchetypeTag: Record<string, number> = {};
  const byUnknownReason: Record<string, number> = {};
  const byDealArchetype: Record<string, number> = {};
  const byDealType: Record<string, number> = {};

  for (const r of params.rows) {
    inc(byUnknownReason, r.unknown_reason_code ?? "(none)");
    inc(byDealArchetype, r.deal_business_archetype ?? "(unknown)");
    inc(byDealType, r.deal_type ?? "(unknown)");

    if (r.archetype_tags.length === 0) inc(byArchetypeTag, "(none)");
    for (const t of r.archetype_tags) inc(byArchetypeTag, t);
  }

  return {
    generated_at: new Date().toISOString(),
    total_rows: params.rows.length,
    by_unknown_reason: sortEntries(byUnknownReason),
    by_archetype_tag: sortEntries(byArchetypeTag),
    by_deal_business_archetype: sortEntries(byDealArchetype),
    by_deal_type: sortEntries(byDealType),
  };
}

function asNonEmptyArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((t) => typeof t === "string" && t.trim().length > 0)
    .map((t) => String(t).trim());
}

function maybeFill<T>(current: T, next: T): T {
  // Only fill when current is "empty".
  if (current == null) return next;
  if (typeof current === "string" && current.trim().length === 0) return next;
  if (Array.isArray(current) && current.length === 0) return next;
  return current;
}

function enrichExistingRow(params: {
  existing: UnknownKnowledgeRow;
  fromNew: UnknownKnowledgeRow;
}): UnknownKnowledgeRow {
  const e = params.existing;
  const n = params.fromNew;

  const merged: UnknownKnowledgeRow = {
    ...e,
    enriched_at: new Date().toISOString(),

    deal_name: maybeFill(e.deal_name, n.deal_name),
    deal_business_archetype: maybeFill(e.deal_business_archetype, n.deal_business_archetype),
    deal_type: maybeFill(e.deal_type, n.deal_type),
    business_model: maybeFill(e.business_model, n.business_model),

    document_title: maybeFill(e.document_title, n.document_title),
    document_type: maybeFill(e.document_type, n.document_type),

    page_label: maybeFill(e.page_label, n.page_label),
    image_uri: maybeFill(e.image_uri, n.image_uri),

    unknown_reason_code: maybeFill(e.unknown_reason_code, n.unknown_reason_code),
    archetype_tags: (() => {
      const cur = Array.isArray(e.archetype_tags) ? e.archetype_tags : [];
      const nxt = Array.isArray(n.archetype_tags) ? n.archetype_tags : [];
      return cur.length > 0 ? cur : nxt;
    })(),

    title_text_snippet: maybeFill(e.title_text_snippet, n.title_text_snippet),
    snippet: maybeFill(e.snippet, n.snippet),
    ocr_text_snippet: maybeFill(e.ocr_text_snippet, n.ocr_text_snippet),
    structured_json_snippet: maybeFill(e.structured_json_snippet, n.structured_json_snippet),
  };

  return merged;
}

function renderSummaryMarkdown(params: { outJsonl: string; summary: any; sampleRows: UnknownKnowledgeRow[] }) {
  const lines: string[] = [];
  lines.push(`# Unknown Knowledge Base`);
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Corpus: ${params.outJsonl}`);
  lines.push("");

  lines.push(`## Totals`);
  lines.push("");
  lines.push(`- Rows: ${params.summary.total_rows}`);

  const top = (entries: Array<[string, number]>, n: number) => entries.slice(0, n);

  lines.push("");
  lines.push(`## Unknown reason codes (top)`);
  lines.push("");
  for (const [k, v] of top(params.summary.by_unknown_reason ?? [], 20)) lines.push(`- ${k}: ${v}`);

  lines.push("");
  lines.push(`## Archetype tags (top)`);
  lines.push("");
  for (const [k, v] of top(params.summary.by_archetype_tag ?? [], 30)) lines.push(`- ${k}: ${v}`);

  lines.push("");
  lines.push(`## Deal business archetype (top)`);
  lines.push("");
  for (const [k, v] of top(params.summary.by_deal_business_archetype ?? [], 20)) lines.push(`- ${k}: ${v}`);

  lines.push("");
  lines.push(`## Deal type (top)`);
  lines.push("");
  for (const [k, v] of top(params.summary.by_deal_type ?? [], 20)) lines.push(`- ${k}: ${v}`);

  if (params.sampleRows.length > 0) {
    lines.push("");
    lines.push(`## Sample unknowns`);
    lines.push("");
    for (const r of params.sampleRows.slice(0, 12)) {
      const tags = r.archetype_tags.length > 0 ? r.archetype_tags.join(", ") : "(none)";
      lines.push(`- ${r.deal_name ?? r.deal_id} • ${r.document_title ?? r.document_id} • ${r.page_label ?? "(no page label)"} • reason=${r.unknown_reason_code ?? "(none)"} • tags=${tags}`);
      if (r.title_text_snippet) lines.push(`  - title: ${r.title_text_snippet}`);
    }
  }

  lines.push("");
  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    process.exit(0);
  }

  const __filename = fileURLToPath(import.meta.url);
  const repoRoot = path.resolve(path.dirname(__filename), "..");

  const summaryJsonPath =
    typeof args["summary-json"] === "string" ? String(args["summary-json"]) : "artifacts/segment-audit/all-deals/summary.json";
  const inJsonDir = typeof args["in-json-dir"] === "string" ? String(args["in-json-dir"]) : "artifacts/segment-audit/all-deals";
  const outDir = typeof args["out-dir"] === "string" ? String(args["out-dir"]) : "artifacts/unknown-knowledgebase";

  const outJsonl = typeof args["out-jsonl"] === "string" ? String(args["out-jsonl"]) : path.join(outDir, "unknown_items.jsonl");
  const outJsonlEnriched =
    typeof (args as any)["out-jsonl-enriched"] === "string"
      ? String((args as any)["out-jsonl-enriched"])
      : path.join(outDir, "unknown_items.enriched.jsonl");
  const outSummaryJson =
    typeof args["out-summary-json"] === "string" ? String(args["out-summary-json"]) : path.join(outDir, "summary.json");
  const outSummaryMd = typeof args["out-summary-md"] === "string" ? String(args["out-summary-md"]) : path.join(outDir, "summary.md");

  const outSummaryJsonEnriched =
    typeof (args as any)["out-summary-json-enriched"] === "string"
      ? String((args as any)["out-summary-json-enriched"])
      : path.join(outDir, "summary.enriched.json");
  const outSummaryMdEnriched =
    typeof (args as any)["out-summary-md-enriched"] === "string"
      ? String((args as any)["out-summary-md-enriched"])
      : path.join(outDir, "summary.enriched.md");

  const append = boolArg(args.append, true);
  const fetchMeta = boolArg(args["fetch-deal-meta"], true);
  const maxRows = typeof args["max-rows"] === "string" ? Math.max(1, Number(args["max-rows"])) : null;

  const summaryAbs = path.isAbsolute(summaryJsonPath) ? summaryJsonPath : path.join(repoRoot, summaryJsonPath);
  const inDirAbs = path.isAbsolute(inJsonDir) ? inJsonDir : path.join(repoRoot, inJsonDir);
  const outDirAbs = path.isAbsolute(outDir) ? outDir : path.join(repoRoot, outDir);
  const outJsonlAbs = path.isAbsolute(outJsonl) ? outJsonl : path.join(repoRoot, outJsonl);
  const outJsonlEnrichedAbs = path.isAbsolute(outJsonlEnriched) ? outJsonlEnriched : path.join(repoRoot, outJsonlEnriched);
  const outSummaryJsonAbs = path.isAbsolute(outSummaryJson) ? outSummaryJson : path.join(repoRoot, outSummaryJson);
  const outSummaryMdAbs = path.isAbsolute(outSummaryMd) ? outSummaryMd : path.join(repoRoot, outSummaryMd);
  const outSummaryJsonEnrichedAbs = path.isAbsolute(outSummaryJsonEnriched) ? outSummaryJsonEnriched : path.join(repoRoot, outSummaryJsonEnriched);
  const outSummaryMdEnrichedAbs = path.isAbsolute(outSummaryMdEnriched) ? outSummaryMdEnriched : path.join(repoRoot, outSummaryMdEnriched);

  await ensureDir(outDirAbs);

  let summary: SummaryFile | null = null;
  try {
    summary = (await readJson(summaryAbs)) as SummaryFile;
  } catch {
    summary = null;
  }

  const apiBaseUrl =
    typeof args["api-base-url"] === "string"
      ? String(args["api-base-url"])
      : typeof summary?.apiBaseUrl === "string"
        ? String(summary.apiBaseUrl)
        : "http://localhost:9000";

  const lineageFilesFromSummary = Array.isArray(summary?.summaries)
    ? summary!.summaries
        .map((s) => (typeof s.out_json === "string" ? s.out_json : null))
        .filter((p): p is string => Boolean(p))
    : [];

  const lineageFilesAbs: string[] = [];
  if (lineageFilesFromSummary.length > 0) {
    for (const p of lineageFilesFromSummary) {
      lineageFilesAbs.push(path.isAbsolute(p) ? p : path.join(repoRoot, p));
    }
  } else {
    lineageFilesAbs.push(...(await listLineageFiles(inDirAbs)));
  }

  const dealNameById = new Map<string, string | null>();
  if (Array.isArray(summary?.summaries)) {
    for (const s of summary!.summaries) {
      if (typeof s.deal_id !== "string") continue;
      const name = typeof s.deal_name === "string" ? s.deal_name : null;
      dealNameById.set(s.deal_id, name);
    }
  }

  const existingKeys = append ? await loadExistingKeys(outJsonlAbs) : new Set<string>();
  const existingRowsByKey = append ? await loadExistingRows(outJsonlAbs) : new Map<string, UnknownKnowledgeRow>();

  console.log(`[unknown-knowledgebase] Inputs: ${lineageFilesAbs.length} lineage files`);
  console.log(`[unknown-knowledgebase] Append=${append} (existing keys=${existingKeys.size})`);

  const metaCache = new Map<string, DealPhase1Meta>();
  const allNewRows: UnknownKnowledgeRow[] = [];
  const enrichedExistingKeys = new Set<string>();

  for (let i = 0; i < lineageFilesAbs.length; i++) {
    const fp = lineageFilesAbs[i];
    const lineage = (await readJson(fp)) as LineageResponse;
    const dealId = String((lineage as any)?.deal_id ?? "").trim();
    if (!dealId) continue;

    const dealNameFromSummary = dealNameById.get(dealId) ?? null;

    let dealMeta: DealPhase1Meta | null = null;
    if (fetchMeta) {
      if (metaCache.has(dealId)) {
        dealMeta = metaCache.get(dealId)!;
      } else {
        try {
          dealMeta = await fetchDealMeta(apiBaseUrl, dealId);
          metaCache.set(dealId, dealMeta);
        } catch {
          dealMeta = { deal_id: dealId, deal_name: dealNameFromSummary };
          metaCache.set(dealId, dealMeta);
        }
      }
    }

    const { addedRows, seenUnknownRows, stats } = extractUnknownRows({
      lineage,
      dealNameFromSummary,
      dealMeta,
      maxRows: maxRows != null ? Math.max(0, maxRows - allNewRows.length) : null,
      existingKeys,
    });

    // Best-effort enrichment: if the same key already exists but is missing archetype_tags (or deal/doc metadata),
    // update the materialized/enriched view.
    for (const r of seenUnknownRows) {
      const existing = existingRowsByKey.get(r.key);
      if (!existing) continue;
      const existingTags = asNonEmptyArray((existing as any).archetype_tags);
      const nextTags = asNonEmptyArray(r.archetype_tags);
      const shouldEnrich = existingTags.length === 0 && nextTags.length > 0;
      const metaMissing =
        (existing.deal_business_archetype == null && r.deal_business_archetype != null) ||
        (existing.deal_type == null && r.deal_type != null) ||
        (existing.business_model == null && r.business_model != null);
      if (!shouldEnrich && !metaMissing) continue;

      existingRowsByKey.set(r.key, enrichExistingRow({ existing, fromNew: r }));
      enrichedExistingKeys.add(r.key);
    }

    if (addedRows.length > 0) {
      allNewRows.push(...addedRows);
    }

    console.log(
      `[unknown-knowledgebase] [${i + 1}/${lineageFilesAbs.length}] deal=${dealMeta?.deal_name ?? dealNameFromSummary ?? dealId} seen=${stats.totalSeen} unknown=${stats.totalUnknown} added=${stats.totalAdded}`
    );

    if (maxRows != null && allNewRows.length >= maxRows) break;
  }

  if (!append) {
    await writeFile(outJsonlAbs, "");
  }

  if (allNewRows.length > 0) {
    const payload = allNewRows.map((r) => JSON.stringify(r)).join("\n") + "\n";
    await appendFile(outJsonlAbs, payload);
  }

  // Summaries should reflect the full corpus (existing + new), not just the delta of this run.
  const fullRows: UnknownKnowledgeRow[] = (() => {
    if (!append) return allNewRows;
    const out: UnknownKnowledgeRow[] = [];
    for (const r of existingRowsByKey.values()) out.push(r);
    for (const r of allNewRows) {
      if (!existingRowsByKey.has(r.key)) out.push(r);
    }
    return out;
  })();

  const summaryOut = {
    ...buildSummary({ rows: fullRows }),
    new_rows_added: allNewRows.length,
    existing_rows_seen: existingRowsByKey.size,
  };
  await writeFile(outSummaryJsonAbs, JSON.stringify(summaryOut, null, 2));

  const md = renderSummaryMarkdown({
    outJsonl: path.relative(repoRoot, outJsonlAbs),
    summary: summaryOut,
    sampleRows: fullRows,
  });
  await writeFile(outSummaryMdAbs, md);

  // Materialized enriched view (rewritten each run): makes it easy to backfill tags without mutating the append-only file.
  {
    const fs = await import("node:fs/promises");
    const payload = fullRows.map((r) => JSON.stringify(r)).join("\n") + "\n";
    await fs.writeFile(outJsonlEnrichedAbs, payload, "utf8");

    const enrichedSummary = {
      ...buildSummary({ rows: fullRows }),
      new_rows_added: allNewRows.length,
      existing_rows_seen: existingRowsByKey.size,
      enriched_existing_rows_updated: enrichedExistingKeys.size,
    };
    await writeFile(outSummaryJsonEnrichedAbs, JSON.stringify(enrichedSummary, null, 2));
    const enrichedMd = renderSummaryMarkdown({
      outJsonl: path.relative(repoRoot, outJsonlEnrichedAbs),
      summary: enrichedSummary,
      sampleRows: fullRows,
    });
    await writeFile(outSummaryMdEnrichedAbs, enrichedMd);
  }

  console.log(`[unknown-knowledgebase] Wrote JSONL: ${path.relative(repoRoot, outJsonlAbs)} (+${allNewRows.length} rows)`);
  console.log(`[unknown-knowledgebase] Wrote summary JSON: ${path.relative(repoRoot, outSummaryJsonAbs)}`);
  console.log(`[unknown-knowledgebase] Wrote summary MD: ${path.relative(repoRoot, outSummaryMdAbs)}`);
  console.log(`[unknown-knowledgebase] Wrote enriched JSONL: ${path.relative(repoRoot, outJsonlEnrichedAbs)} (rewritten)`);
  console.log(`[unknown-knowledgebase] Wrote enriched summary JSON: ${path.relative(repoRoot, outSummaryJsonEnrichedAbs)}`);
  console.log(`[unknown-knowledgebase] Wrote enriched summary MD: ${path.relative(repoRoot, outSummaryMdEnrichedAbs)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
