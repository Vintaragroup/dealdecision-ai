export {};

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

type DealListItem = {
  id: string;
  name?: string | null;
  label?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type SegmentAuditItem = {
  segment?: string;
  segment_confidence?: number | null;
  segment_source?: string;
  page_label?: string | null;
  page_index?: number | null;
  archetype_tags?: string[];
  reason?: {
    title_text_snippet?: string | null;
    unknown_reason_code?: string | null;
  };
};

type SegmentAuditDocument = {
  document_id: string;
  title: string | null;
  type: string | null;
  page_count: number | null;
  items: SegmentAuditItem[];
};

type SegmentAuditReport = {
  deal_id: string;
  generated_at: string;
  documents: SegmentAuditDocument[];
};

type LineageNode = {
  kind?: string;
  metadata?: {
    created_at?: string | null;
    extracted_at?: string | null;
    asset_type?: string | null;
  };
};

type LineageResponse = {
  deal_id: string;
  nodes: LineageNode[];
  segment_audit_report?: SegmentAuditReport;
  warnings?: string[];
};

type DealAuditSummary = {
  deal_id: string;
  deal_name: string | null;
  out_md: string;
  out_json: string;
  last_visual_asset_created_at: string | null;
  last_extract_visuals_job_at: string | null;
  visual_asset_count: number;
  total_items: number;
  by_segment: Record<string, number>;
  unknown_reason_codes: Record<string, number>;
  unknown_title_hint_buckets: Record<string, number>;
  unknown_archetype_tags: Record<string, number>;
};

type JobListItem = {
  job_id: string;
  type?: string;
  status?: string;
  created_at?: string;
  updated_at?: string;
};

type PortfolioTotals = {
  deals: number;
  total_items: number;
  unknown_items: number;
  unknown_pct: number | null;
};

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
      continue;
    }
  }
  return args;
}

function usage() {
  return `segment-classification-audit-all\n\nRuns segment classification audit for every deal returned by /api/v1/deals and writes per-deal Markdown + JSON artifacts and an aggregate summary.\n\nUsage:\n  pnpm tsx scripts/segment-classification-audit-all.ts\n\nOptions:\n  --api-base-url   Base URL for API (default: http://localhost:9000)\n  --out-md-dir     Directory for per-deal Markdown (default: docs/Active/audit/analizer-debug/segment-audit-all)\n  --out-json-dir   Directory for per-deal JSON (default: artifacts/segment-audit/all-deals)\n  --summary-md     Summary Markdown path (default: <out-md-dir>/summary.md)\n  --summary-json   Summary JSON path (default: <out-json-dir>/summary.json)\n  --history-dir    Directory for timestamped summary snapshots (default: <out-json-dir>/history)\n  --fresh-hours    "stale" threshold in hours for extract-visuals recency (default: 4)\n  --concurrency    Number of audits to run at once (default: 2)\n  --limit          Only process N newest deals (default: all)\n  --segment-rescore Enable segment_rescore=1 during audit (default: true)\n`;
}

function boolArg(value: string | boolean | undefined, defaultValue: boolean): boolean {
  if (value == null) return defaultValue;
  if (typeof value === "boolean") return value;
  const s = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(s)) return true;
  if (["0", "false", "no", "off"].includes(s)) return false;
  return defaultValue;
}

function intArg(value: string | boolean | undefined, defaultValue: number): number {
  if (value == null) return defaultValue;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : defaultValue;
}

function computePortfolioTotals(summaries: DealAuditSummary[]): PortfolioTotals {
  let totalItems = 0;
  let unknownItems = 0;
  for (const s of summaries) {
    totalItems += typeof s.total_items === "number" ? s.total_items : 0;
    unknownItems += typeof s.by_segment?.unknown === "number" ? s.by_segment.unknown : 0;
  }
  const pct = totalItems > 0 ? (unknownItems / totalItems) * 100 : null;
  return {
    deals: summaries.length,
    total_items: totalItems,
    unknown_items: unknownItems,
    unknown_pct: pct == null ? null : Number(pct.toFixed(2)),
  };
}

function toCompactTimestamp(iso: string): string {
  // Example: 2026-01-17T04:18:15.585Z -> 20260117T041815Z
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return iso.replace(/[^0-9TZ]/g, "");
  return `${m[1]}${m[2]}${m[3]}T${m[4]}${m[5]}${m[6]}Z`;
}

function findLatestHistorySnapshot(historyDir: string): string | null {
  try {
    const entries = fs
      .readdirSync(historyDir)
      .filter((f) => f.startsWith("summary.") && f.endsWith(".json"))
      .sort();
    return entries.length ? path.join(historyDir, entries[entries.length - 1]) : null;
  } catch {
    return null;
  }
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

async function ensureDir(dirPath: string) {
  const fs = await import("node:fs/promises");
  await fs.mkdir(dirPath, { recursive: true });
}

function sanitizeFileToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\-_.]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_.]+|[-_.]+$/g, "")
    .slice(0, 60);
}

function normalizeLooseTitle(value: string | null | undefined): string {
  if (!value) return "";
  return String(value)
    .toLowerCase()
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[^a-z0-9\s\-]/g, " ")
    .replace(/[\s\-]+/g, " ")
    .trim();
}

function titleHintBuckets(title: string): string[] {
  const t = normalizeLooseTitle(title);
  if (!t) return [];
  const out: string[] = [];
  const has = (re: RegExp) => re.test(t);

  if (has(/\b(p\s*l|pnl|profit\s+and\s+loss|income\s+statement|balance\s+sheet|cash\s+flow|cashflow|forecast|budget|unit\s+economics)\b/)) out.push("financials");
  if (has(/\b(cap\s+table|cap\s*table|capitalization\s+table|term\s+sheet|use\s+of\s+funds|use\s+of\s+proceeds|ownership|valuation|sources\s+and\s+uses|sources\s+uses)\b/)) out.push("raise_terms");
  if (has(/\b(kpis?|key\s+metrics|metrics|cohort|cohorts|retention|pipeline)\b/)) out.push("traction");
  if (has(/\b(assumptions|inputs|drivers)\b/)) out.push("financials:inputs");
  if (has(/\b(tam|sam|som|market|opportunity|sizing|cagr)\b/)) out.push("market");
  if (has(/\b(competition|competitors|competitive)\b/)) out.push("competition");
  if (has(/\b(risk|risks)\b/)) out.push("risks");
  if (has(/\b(team)\b/)) out.push("team");
  if (has(/\b(overview|company\s+overview|executive\s+summary|investment\s+highlights)\b/)) out.push("overview");

  return Array.from(new Set(out));
}

function inc(map: Record<string, number>, key: string, by = 1) {
  map[key] = (map[key] ?? 0) + by;
}

function maxIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}

function hoursAgo(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return (Date.now() - t) / (1000 * 60 * 60);
}

function staleEpsilonHours(freshHours: number): number {
  // Tolerance to avoid borderline false positives caused by execution time and rounding.
  // For a 4h threshold, this yields 0.2h (12 minutes).
  return Math.min(0.25, Math.max(0.1, freshHours * 0.05));
}

function isStaleAge(ageHours: number | null | undefined, freshHours: number): boolean {
  if (ageHours == null) return true;
  return ageHours > freshHours + staleEpsilonHours(freshHours);
}

async function fetchLatestExtractVisualsJobAt(apiBaseUrl: string, dealId: string): Promise<string | null> {
  const url = `${apiBaseUrl.replace(/\/$/, "")}/api/v1/jobs?deal_id=${encodeURIComponent(dealId)}&type=extract_visuals&limit=1`;
  const raw = (await fetchJson(url)) as any;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const j = raw[0] as JobListItem;
  const updated = typeof j.updated_at === "string" ? j.updated_at : null;
  const created = typeof j.created_at === "string" ? j.created_at : null;
  return updated || created;
}

async function runAuditViaPnpm(params: {
  dealId: string;
  apiBaseUrl: string;
  outMd: string;
  outJson: string;
  segmentRescore: boolean;
}) {
  const args: string[] = [
    "-s",
    "report:segments:audit:md",
    "--",
    "--deal-id",
    params.dealId,
    "--api-base-url",
    params.apiBaseUrl,
    "--out-md",
    params.outMd,
    "--out-json",
    params.outJson,
  ];
  if (params.segmentRescore) args.push("--segment-rescore");

  await new Promise<void>((resolve, reject) => {
    const child = spawn("pnpm", args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Audit failed for ${params.dealId} (exit code ${code})`));
    });
  });
}

async function loadLineageFromFile(filePath: string): Promise<LineageResponse> {
  const fs = await import("node:fs/promises");
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as LineageResponse;
}

function summarizeDeal(lineage: LineageResponse, dealName: string | null, outMd: string, outJson: string, lastExtractVisualsJobAt: string | null): DealAuditSummary {
  const nodes = Array.isArray(lineage.nodes) ? lineage.nodes : [];
  let lastVisualAssetCreatedAt: string | null = null;
  let visualAssetCount = 0;

  for (const n of nodes) {
    if (String(n?.kind ?? "") !== "visual_asset") continue;
    visualAssetCount++;
    const extractedAt = (n?.metadata?.extracted_at ?? null) as string | null;
    const createdAt = (n?.metadata?.created_at ?? null) as string | null;
    const ts = extractedAt || createdAt;
    if (ts) lastVisualAssetCreatedAt = maxIso(lastVisualAssetCreatedAt, ts);
  }

  const report = lineage.segment_audit_report;
  const docs = Array.isArray(report?.documents) ? report!.documents : [];
  const items = docs.flatMap((d) => (Array.isArray(d.items) ? d.items : []));

  // Some lineage shapes don't emit `nodes.kind=visual_asset` even when segment_audit items include
  // image URIs (e.g., structured/synthetic visual assets). Use item-level image URIs as a fallback
  // signal so the "recent job but no outputs" bucket doesn't false-positive.
  if (visualAssetCount === 0 && items.length > 0) {
    const uniqueUris = new Set<string>();
    for (const it of items as any[]) {
      const direct = typeof it?.image_uri === "string" && it.image_uri.trim()
        ? String(it.image_uri)
        : typeof it?.imageUri === "string" && it.imageUri.trim()
          ? String(it.imageUri)
          : null;
      const fromReason = typeof it?.reason?.image_uri === "string" && it.reason.image_uri.trim()
        ? String(it.reason.image_uri)
        : typeof it?.reason?.imageUri === "string" && it.reason.imageUri.trim()
          ? String(it.reason.imageUri)
          : null;
      const fromMeta = typeof it?.metadata?.image_uri === "string" && it.metadata.image_uri.trim()
        ? String(it.metadata.image_uri)
        : typeof it?.metadata?.imageUri === "string" && it.metadata.imageUri.trim()
          ? String(it.metadata.imageUri)
          : null;
      const uri = direct ?? fromReason ?? fromMeta;
      if (uri) uniqueUris.add(uri);
    }
    if (uniqueUris.size > 0) visualAssetCount = uniqueUris.size;
  }

  const bySegment: Record<string, number> = {};
  const unknownReasonCodes: Record<string, number> = {};
  const unknownTitleHints: Record<string, number> = {};
  const unknownArchetypeTags: Record<string, number> = {};

  for (const it of items) {
    const seg = String(it.segment ?? "unknown");
    inc(bySegment, seg);

    if (seg === "unknown") {
      const code = String(it.reason?.unknown_reason_code ?? "unknown");
      inc(unknownReasonCodes, code);

      const title = String(it.reason?.title_text_snippet ?? "");
      const hints = titleHintBuckets(title);
      for (const h of hints) inc(unknownTitleHints, h);

      const tags = Array.isArray((it as any)?.archetype_tags) ? ((it as any).archetype_tags as any[]) : [];
      for (const t of tags) {
        if (typeof t !== "string" || !t.trim()) continue;
        inc(unknownArchetypeTags, t.trim());
      }
    }
  }

  return {
    deal_id: lineage.deal_id,
    deal_name: dealName,
    out_md: outMd,
    out_json: outJson,
    last_visual_asset_created_at: lastVisualAssetCreatedAt,
    last_extract_visuals_job_at: lastExtractVisualsJobAt,
    visual_asset_count: visualAssetCount,
    total_items: items.length,
    by_segment: bySegment,
    unknown_reason_codes: unknownReasonCodes,
    unknown_title_hint_buckets: unknownTitleHints,
    unknown_archetype_tags: unknownArchetypeTags,
  };
}

function renderSummaryMarkdown(params: {
  apiBaseUrl: string;
  freshHours: number;
  summaries: DealAuditSummary[];
}) {
  const lines: string[] = [];
  lines.push(`# Segment Classification Audit (All Deals)`);
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`API: ${params.apiBaseUrl}`);
  lines.push(`Stale threshold: ${params.freshHours} hours (+${Math.round(staleEpsilonHours(params.freshHours) * 60)}m tolerance)`);
  lines.push("");

  const computed = params.summaries.map((s) => {
    const effectiveTs = s.last_extract_visuals_job_at || s.last_visual_asset_created_at;
    return {
      ...s,
      effective_ts: effectiveTs,
      age_hours: hoursAgo(effectiveTs),
      has_assets: (s.visual_asset_count ?? 0) > 0,
      has_items: (s.total_items ?? 0) > 0,
    };
  });

  const missingJobs = computed.filter((s) => !s.last_extract_visuals_job_at);
  const staleJobs = computed.filter((s) => s.last_extract_visuals_job_at && isStaleAge(s.age_hours ?? null, params.freshHours));
  const recentButNoOutput = computed.filter(
    (s) =>
      s.last_extract_visuals_job_at &&
      !isStaleAge(s.age_hours ?? null, params.freshHours) &&
      !s.has_items
  );

  if (missingJobs.length > 0 || staleJobs.length > 0 || recentButNoOutput.length > 0) {
    lines.push(`## Extract-visuals status`);
    lines.push("");

    if (missingJobs.length > 0) {
      lines.push(`### Missing extract-visuals job records`);
      for (const s of missingJobs) {
        const name = s.deal_name ?? "(unnamed)";
        lines.push(
          `- ${name} — ${s.deal_id} — last_extract_visuals_job_at=null, last_visual_asset_ts=${s.last_visual_asset_created_at ?? "null"}, assets=${s.visual_asset_count}, items=${s.total_items}`
        );
      }
      lines.push("");
    }

    if (staleJobs.length > 0) {
      lines.push(`### Stale extract-visuals job (older than ${params.freshHours}h)`);
      for (const s of staleJobs.sort((a, b) => (b.age_hours ?? 1e9) - (a.age_hours ?? 1e9))) {
        const name = s.deal_name ?? "(unnamed)";
        lines.push(
          `- ${name} — ${s.deal_id} — last_extract_visuals_job_at=${s.last_extract_visuals_job_at ?? "null"} (age=${(s.age_hours ?? 0).toFixed(1)}h), last_visual_asset_ts=${s.last_visual_asset_created_at ?? "null"}, assets=${s.visual_asset_count}, items=${s.total_items}`
        );
      }
      lines.push("");
    }

    if (recentButNoOutput.length > 0) {
      lines.push(`### Recent extract-visuals job but no outputs`);
      for (const s of recentButNoOutput.sort((a, b) => (b.age_hours ?? 0) - (a.age_hours ?? 0))) {
        const name = s.deal_name ?? "(unnamed)";
        lines.push(
          `- ${name} — ${s.deal_id} — last_extract_visuals_job_at=${s.last_extract_visuals_job_at ?? "null"} (age=${(s.age_hours ?? 0).toFixed(1)}h), last_visual_asset_ts=${s.last_visual_asset_created_at ?? "null"}, assets=${s.visual_asset_count}, items=${s.total_items}`
        );
      }
      lines.push("");
    }
  }

  lines.push(`## Per-deal summary`);
  lines.push("");
  lines.push(`| deal | deal_id | last_extract_visuals_job_at | last_visual_asset_ts | age_h | total_items | unknown | unk_research | unk_how_to | unk_tutorial | unk_examples | unk_site_plan | out_md |`);
  lines.push(`|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|`);

  for (const s of params.summaries) {
    const name = (s.deal_name ?? "(unnamed)").replace(/\|/g, "\\|");
    const effectiveTs = s.last_extract_visuals_job_at || s.last_visual_asset_created_at;
    const age = hoursAgo(effectiveTs);
    const unknown = s.by_segment.unknown ?? 0;
    const unkResearch = s.unknown_archetype_tags.medical_research_findings ?? 0;
    const unkHowTo = s.unknown_archetype_tags.medical_how_to_procedure ?? 0;
    const unkTutorial = s.unknown_archetype_tags.product_tutorial ?? 0;
    const unkExamples = s.unknown_archetype_tags.product_use_case_examples ?? 0;
    const unkSitePlan = s.unknown_archetype_tags.real_estate_site_plan ?? 0;
    const financials = s.by_segment.financials ?? 0;
    const outMdRel = s.out_md;
    lines.push(
      `| ${name} | ${s.deal_id} | ${s.last_extract_visuals_job_at ?? "null"} | ${s.last_visual_asset_created_at ?? "null"} | ${age == null ? "" : age.toFixed(1)} | ${s.total_items} | ${unknown} | ${unkResearch} | ${unkHowTo} | ${unkTutorial} | ${unkExamples} | ${unkSitePlan} | ${outMdRel} |`
    );
  }

  const totalBySegment: Record<string, number> = {};
  const totalUnknownReasons: Record<string, number> = {};
  const totalUnknownTitleHints: Record<string, number> = {};
  const totalUnknownArchetypeTags: Record<string, number> = {};

  for (const s of params.summaries) {
    for (const [k, v] of Object.entries(s.by_segment)) inc(totalBySegment, k, v);
    for (const [k, v] of Object.entries(s.unknown_reason_codes)) inc(totalUnknownReasons, k, v);
    for (const [k, v] of Object.entries(s.unknown_title_hint_buckets)) inc(totalUnknownTitleHints, k, v);
    for (const [k, v] of Object.entries(s.unknown_archetype_tags)) inc(totalUnknownArchetypeTags, k, v);
  }

  const sortEntries = (m: Record<string, number>) => Object.entries(m).sort((a, b) => b[1] - a[1]);

  lines.push("");
  lines.push(`## Aggregate segment distribution`);
  lines.push("");
  for (const [k, v] of sortEntries(totalBySegment)) lines.push(`- ${k}: ${v}`);

  lines.push("");
  lines.push(`## Unknown reason codes (aggregate)`);
  lines.push("");
  for (const [k, v] of sortEntries(totalUnknownReasons).slice(0, 30)) lines.push(`- ${k}: ${v}`);

  lines.push("");
  lines.push(`## Unknown title-hint buckets (aggregate)`);
  lines.push("");
  for (const [k, v] of sortEntries(totalUnknownTitleHints)) lines.push(`- ${k}: ${v}`);

  lines.push("");
  lines.push(`## Unknown archetype tags (aggregate)`);
  lines.push("");
  if (Object.keys(totalUnknownArchetypeTags).length === 0) {
    lines.push(`- (none): 0`);
  } else {
    for (const [k, v] of sortEntries(totalUnknownArchetypeTags).slice(0, 30)) lines.push(`- ${k}: ${v}`);
  }

  lines.push("");
  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    // eslint-disable-next-line no-console
    console.log(usage());
    process.exit(0);
  }

  const apiBaseUrl = typeof args["api-base-url"] === "string" ? String(args["api-base-url"]) : "http://localhost:9000";
  const outMdDir = typeof args["out-md-dir"] === "string" ? String(args["out-md-dir"]) : "docs/Active/audit/analizer-debug/segment-audit-all";
  const outJsonDir = typeof args["out-json-dir"] === "string" ? String(args["out-json-dir"]) : "artifacts/segment-audit/all-deals";

  const freshHours = intArg(args["fresh-hours"], 4);
  const concurrency = intArg(args["concurrency"], 2);
  const limit = typeof args.limit === "string" ? Math.max(1, Number(args.limit)) : null;
  const segmentRescore = boolArg(args["segment-rescore"], true);

  const summaryMd = typeof args["summary-md"] === "string" ? String(args["summary-md"]) : `${outMdDir}/summary.md`;
  const summaryJson = typeof args["summary-json"] === "string" ? String(args["summary-json"]) : `${outJsonDir}/summary.json`;
  const historyDir = typeof args["history-dir"] === "string" ? String(args["history-dir"]) : `${outJsonDir}/history`;

  await ensureDir(outMdDir);
  await ensureDir(outJsonDir);

  const dealsUrl = `${apiBaseUrl.replace(/\/$/, "")}/api/v1/deals`;
  const dealsRaw = (await fetchJson(dealsUrl)) as any;
  if (!Array.isArray(dealsRaw)) throw new Error(`Expected array from ${dealsUrl}`);

  const deals: DealListItem[] = dealsRaw;
  const selectedDeals = limit ? deals.slice(0, limit) : deals;

  // eslint-disable-next-line no-console
  console.log(`Found ${deals.length} deals; auditing ${selectedDeals.length} (concurrency=${concurrency})`);

  const summaries: DealAuditSummary[] = [];

  let idx = 0;
  const workers = new Array(Math.max(1, concurrency)).fill(null).map(async () => {
    while (true) {
      const i = idx++;
      if (i >= selectedDeals.length) return;

      const d = selectedDeals[i];
      const dealId = String(d.id);
      const dealName = (d.name ?? d.label ?? null) as string | null;
      const token = sanitizeFileToken(`${dealName ?? "deal"}-${dealId}`) || dealId;

      const outMd = `${outMdDir}/${token}.md`;
      const outJson = `${outJsonDir}/${token}.lineage.json`;

      // eslint-disable-next-line no-console
      console.log(`\n== [${i + 1}/${selectedDeals.length}] ${dealName ?? "(unnamed)"} (${dealId}) ==`);

      await runAuditViaPnpm({ dealId, apiBaseUrl, outMd, outJson, segmentRescore });
      const lineage = await loadLineageFromFile(outJson);
      const lastJobAt = await fetchLatestExtractVisualsJobAt(apiBaseUrl, dealId);
      const summary = summarizeDeal(lineage, dealName, outMd, outJson, lastJobAt);
      summaries.push(summary);

      const effectiveTs = summary.last_extract_visuals_job_at || summary.last_visual_asset_created_at;
      const age = hoursAgo(effectiveTs);
      if (effectiveTs == null || isStaleAge(age, freshHours)) {
        // eslint-disable-next-line no-console
        console.log(
          `NOTE: extract-visuals likely stale for ${dealId} (last_extract_visuals_job_at=${summary.last_extract_visuals_job_at ?? "null"}, last_visual_asset_ts=${summary.last_visual_asset_created_at ?? "null"}, age_h=${age == null ? "" : age.toFixed(1)})`
        );
      }
    }
  });

  await Promise.all(workers);

  summaries.sort((a, b) => (b.last_visual_asset_created_at ?? "").localeCompare(a.last_visual_asset_created_at ?? ""));

  const md = renderSummaryMarkdown({ apiBaseUrl, freshHours, summaries });
  const totals = computePortfolioTotals(summaries);
  const generated_at = new Date().toISOString();

  await ensureDir(historyDir);
  const prevSnapshotPath = findLatestHistorySnapshot(historyDir);
  let previous_unknown_items: number | null = null;
  if (prevSnapshotPath) {
    try {
      const prevRaw = JSON.parse(await (await import("node:fs/promises")).readFile(prevSnapshotPath, "utf8")) as any;
      const prevSummaries = Array.isArray(prevRaw?.summaries) ? (prevRaw.summaries as DealAuditSummary[]) : [];
      previous_unknown_items = computePortfolioTotals(prevSummaries).unknown_items;
    } catch {
      previous_unknown_items = null;
    }
  }

  const delta_unknown_items =
    previous_unknown_items == null ? null : previous_unknown_items - totals.unknown_items;

  {
    const fsP = await import("node:fs/promises");
    await fsP.writeFile(summaryMd, md, "utf8");
    await fsP.writeFile(
      summaryJson,
      JSON.stringify(
        {
          generated_at,
          apiBaseUrl,
          freshHours,
          totals,
          previous_unknown_items,
          delta_unknown_items,
          summaries,
        },
        null,
        2
      ),
      "utf8"
    );

    const stamp = toCompactTimestamp(generated_at);
    const jsonSnapshotPath = path.join(historyDir, `summary.${stamp}.json`);
    const mdSnapshotPath = path.join(historyDir, `summary.${stamp}.md`);
    await fsP.copyFile(summaryJson, jsonSnapshotPath);
    try {
      await fsP.copyFile(summaryMd, mdSnapshotPath);
    } catch {
      // ignore
    }
  }

  // eslint-disable-next-line no-console
  console.log(`\nWrote summary Markdown: ${summaryMd}`);
  // eslint-disable-next-line no-console
  console.log(`Wrote summary JSON: ${summaryJson}`);
  // eslint-disable-next-line no-console
  console.log(
    `Portfolio unknowns: ${totals.unknown_items}/${totals.total_items}` +
      (totals.unknown_pct == null ? "" : ` (${totals.unknown_pct}%)`) +
      (delta_unknown_items == null ? "" : ` | reduced by ${delta_unknown_items} vs previous snapshot`)
  );
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
