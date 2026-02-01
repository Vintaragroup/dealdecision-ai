export {};

type SegmentAuditItem = {
  visual_asset_id?: string;
  visual_asset_group_id?: string;
  document_id?: string;
  extractor_version?: string | null;
  quality_source?: string | null;
  segment?: string;
  segment_source?: string;
  segment_confidence?: number | null;
  page_index?: number | null;
  page_label?: string | null;
  image_uri?: string | null;
  evidence_count?: number | null;
  snippet?: string | null;
  archetype_tags?: string[];
  persisted_segment_key?: string | null;
  computed_segment?: string | null;
  computed_reason?: unknown;
  content_preview?: {
    ocr_text_len?: number;
    ocr_text_snippet?: string | null;
    structured_json_present?: boolean;
    structured_json_keys?: string[];
    structured_json_snippet?: string | null;
  };
  reason?: {
    title_text_snippet?: string | null;
    title_source?: string | null;
    classification_text_len?: number;
    classification_text_sources_used?: string[];
    top_scores?: Array<{ segment: string; score: number }>;
    best_score?: number | null;
    runner_up_score?: number | null;
    threshold?: number;
    unknown_reason_code?: string | null;
    override_applied?: boolean;
    override_rule_id?: string;
    override_explanation?: string;
  };
};

type SegmentAuditDocument = {
  document_id: string;
  title: string | null;
  type: string | null;
  status: string | null;
  page_count: number | null;
  summary?: { total_items?: number; by_segment?: Record<string, number> };
  items: SegmentAuditItem[];
};

type SegmentAuditReport = {
  deal_id: string;
  generated_at: string;
  documents: SegmentAuditDocument[];
  error?: { code?: string; message?: string };
};

type LineageResponse = {
  deal_id: string;
  nodes: unknown[];
  edges: unknown[];
  warnings: string[];
  segment_audit_report?: SegmentAuditReport;
};

function parseArgs(argv: string[]) {
  const args: Record<string, string | boolean> = {};
  const positional: string[] = [];

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
    positional.push(a);
  }

  return { args, positional };
}

function usage() {
  return `segment-classification-audit\n\nFetches a deal's lineage with debug segment classification details and renders a Markdown audit.\n\nUsage:\n  pnpm tsx scripts/segment-classification-audit.ts --deal-id <uuid>\n\nOptions:\n  --deal-id        Deal UUID (or pass as first positional arg)\n  --api-base-url   Base URL for API (default: http://localhost:9000)\n  --out-md         Write Markdown report to this path (default: docs/Active/audit/analizer-debug/segment-classification-audit.md)\n  --out-json       Write raw lineage JSON to this path (default: artifacts/segment-audit/<dealId>.lineage.json)\n  --no-group-word  Disable structured Word grouping (default: enabled)\n  --no-group-pptx  Disable PPTX slide grouping (default: enabled)\n  --segment-rescore Enable segment_rescore=1 (recompute vs persisted)\n  --dump-unknown   Enable dump_unknown=1 (adds unknown_structured_report in response; dev-only)\n`;
}

function boolArg(value: string | boolean | undefined, defaultValue: boolean): boolean {
  if (value == null) return defaultValue;
  if (typeof value === "boolean") return value;
  const s = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(s)) return true;
  if (["0", "false", "no", "off"].includes(s)) return false;
  return defaultValue;
}

function mdEscape(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function truncate(text: string | null | undefined, max: number): string | null {
  if (!text) return null;
  const t = String(text).replace(/\s+/g, " ").trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max).trimEnd()}…` : t;
}

function percent(n: number, d: number): string {
  if (!Number.isFinite(n) || !Number.isFinite(d) || d <= 0) return "0%";
  return `${Math.round((n / d) * 100)}%`;
}

function summarizeCounts<K extends string>(values: K[]): Array<{ key: K; count: number }> {
  const m = new Map<K, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return Array.from(m.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count);
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
  if (has(/\b(cap\s+table|cap\s*table|capitalization\s+table|term\s+sheet|use\s+of\s+funds|use\s+of\s+proceeds|ownership|valuation)\b/)) out.push("raise_terms");
  if (has(/\b(kpis?|key\s+metrics|metrics|cohort|cohorts|retention|pipeline)\b/)) out.push("traction");
  if (has(/\b(assumptions|inputs|drivers)\b/)) out.push("financials:inputs");
  if (has(/\b(tam|sam|som|market|opportunity|sizing|cagr)\b/)) out.push("market");
  if (has(/\b(competition|competitors|competitive)\b/)) out.push("competition");
  if (has(/\b(risk|risks)\b/)) out.push("risks");
  if (has(/\b(team)\b/)) out.push("team");
  if (has(/\b(overview|company\s+overview|executive\s+summary)\b/)) out.push("overview");

  return Array.from(new Set(out));
}

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${text.slice(0, 300)}`);
  }
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

async function writeFile(filePath: string, content: string) {
  const fs = await import("node:fs/promises");
  await fs.writeFile(filePath, content, "utf8");
}

function computeOutJsonDefault(dealId: string): string {
  // Keep under artifacts for easy diffing/attachment.
  return `artifacts/segment-audit/${dealId}.lineage.json`;
}

function renderMarkdown(params: {
  apiBaseUrl: string;
  dealId: string;
  lineageUrl: string;
  report: SegmentAuditReport;
  warnings: string[];
  outJsonPath: string | null;
}) {
  const docs = Array.isArray(params.report.documents) ? params.report.documents : [];
  const items = docs.flatMap((d) => (Array.isArray(d.items) ? d.items : []));

  const unknownItems = items.filter((it) => String(it.segment ?? "unknown") === "unknown");
  const lowConfidence = items.filter((it) => {
    const c = typeof it.segment_confidence === "number" ? it.segment_confidence : null;
    return c != null && c > 0 && c < 0.65;
  });
  const computedItems = items.filter((it) => String(it.segment_source ?? "") === "computed_v1");
  const persistedItems = items.filter((it) => String(it.segment_source ?? "").startsWith("human_override") || String(it.segment_source ?? "").startsWith("promoted") || String(it.segment_source ?? "").includes("persisted"));

  const titleHintForUnknown = unknownItems
    .map((it) => ({
      title: (it.reason?.title_text_snippet ?? null) as string | null,
      hints: titleHintBuckets((it.reason?.title_text_snippet ?? "") as string),
    }))
    .filter((x) => x.hints.length > 0);

  const titleHintFlat = titleHintForUnknown.flatMap((x) => x.hints.map((h) => h as string));
  const titleHintSummary = summarizeCounts(titleHintFlat);

  const unknownArchetypeTags = unknownItems.flatMap((it) => (Array.isArray((it as any).archetype_tags) ? ((it as any).archetype_tags as string[]) : []));
  const unknownArchetypeSummary = summarizeCounts(unknownArchetypeTags.map((t) => String(t) as string));

  const sourcesUsed = items.flatMap((it) => Array.isArray(it.reason?.classification_text_sources_used) ? it.reason!.classification_text_sources_used! : []);
  const sourcesSummary = summarizeCounts(sourcesUsed.map((s) => String(s) as string));

  const segments = items.map((it) => String(it.segment ?? "unknown") as string);
  const segmentsSummary = summarizeCounts(segments);

  const docTypes = docs.map((d) => String(d.type ?? "unknown") as string);
  const docTypeSummary = summarizeCounts(docTypes);

  const lines: string[] = [];
  lines.push(`# Segment Classification Audit`);
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`API: ${params.apiBaseUrl}`);
  lines.push(`Deal: ${params.dealId}`);
  lines.push("");
  lines.push(`Lineage (debug): ${params.lineageUrl}`);
  if (params.outJsonPath) lines.push(`Raw JSON: ${params.outJsonPath}`);
  lines.push("");

  if (params.report.error?.message) {
    lines.push(`## Error`);
    lines.push(`- code=${params.report.error.code ?? "unknown"}`);
    lines.push(`- message=${params.report.error.message}`);
    lines.push("");
  }

  lines.push(`## Summary`);
  lines.push(`| Metric | Value |`);
  lines.push(`| --- | --- |`);
  lines.push(`| Documents | ${docs.length} |`);
  lines.push(`| Items (pages/assets/groups) | ${items.length} |`);
  lines.push(`| Unknown segment | ${unknownItems.length} (${percent(unknownItems.length, Math.max(1, items.length))}) |`);
  lines.push(`| Low confidence (<0.65) | ${lowConfidence.length} (${percent(lowConfidence.length, Math.max(1, items.length))}) |`);
  lines.push(`| Source: computed_v1 | ${computedItems.length} (${percent(computedItems.length, Math.max(1, items.length))}) |`);
  lines.push(`| Source: persisted/override/promoted | ${persistedItems.length} (${percent(persistedItems.length, Math.max(1, items.length))}) |`);
  lines.push("");

  if (params.warnings.length > 0) {
    lines.push(`## Warnings`);
    for (const w of params.warnings) lines.push(`- ${mdEscape(String(w))}`);
    lines.push("");
  }

  lines.push(`## Document types`);
  lines.push(`| Type | Count |`);
  lines.push(`| --- | --- |`);
  for (const r of docTypeSummary) lines.push(`| ${mdEscape(r.key)} | ${r.count} |`);
  lines.push("");

  lines.push(`## Segment distribution (all items)`);
  lines.push(`| Segment | Count |`);
  lines.push(`| --- | --- |`);
  for (const r of segmentsSummary) lines.push(`| ${mdEscape(r.key)} | ${r.count} |`);
  lines.push("");

  lines.push(`## Classification text sources used (all items)`);
  lines.push(`| Source | Count |`);
  lines.push(`| --- | --- |`);
  for (const r of sourcesSummary.slice(0, 20)) lines.push(`| ${mdEscape(r.key)} | ${r.count} |`);
  if (sourcesSummary.length > 20) lines.push(`| … | ${sourcesSummary.slice(20).reduce((acc, x) => acc + x.count, 0)} |`);
  lines.push("");

  lines.push(`## Unknown items: title near-miss buckets`);
  lines.push(`These are *heuristic* hints based on the title text snippet, used to spot systematic synonym gaps (e.g., P&L, Cap Table).`);
  lines.push(`| Title-hint bucket | Count |`);
  lines.push(`| --- | --- |`);
  if (titleHintSummary.length === 0) {
    lines.push(`| (none) | 0 |`);
  } else {
    for (const r of titleHintSummary.slice(0, 15)) lines.push(`| ${mdEscape(r.key)} | ${r.count} |`);
    if (titleHintSummary.length > 15) lines.push(`| … | ${titleHintSummary.slice(15).reduce((acc, x) => acc + x.count, 0)} |`);
  }
  lines.push("");

  lines.push(`## Unknown items: archetype tags`);
  lines.push(`Heuristic multi-label tags to capture deck nuances (tutorials, product examples, technical architecture, medical research, real-estate site plans, etc.). These are *independent* from pitch-deck segments.`);
  lines.push(`| Archetype tag | Count |`);
  lines.push(`| --- | --- |`);
  if (unknownArchetypeSummary.length === 0) {
    lines.push(`| (none) | 0 |`);
  } else {
    for (const r of unknownArchetypeSummary.slice(0, 20)) lines.push(`| ${mdEscape(r.key)} | ${r.count} |`);
    if (unknownArchetypeSummary.length > 20) lines.push(`| … | ${unknownArchetypeSummary.slice(20).reduce((acc, x) => acc + x.count, 0)} |`);
  }
  lines.push("");

  lines.push(`## Documents`);
  for (const doc of docs) {
    lines.push("");
    lines.push(`### ${mdEscape(doc.title ?? doc.document_id)}`);
    lines.push(`- document_id=${doc.document_id}`);
    lines.push(`- type=${doc.type ?? "unknown"} status=${doc.status ?? "unknown"} page_count=${doc.page_count ?? "?"}`);

    const bySeg = doc.summary?.by_segment ?? {};
    const bySegRows = Object.entries(bySeg)
      .map(([seg, n]) => ({ seg, n }))
      .sort((a, b) => b.n - a.n);

    if (bySegRows.length > 0) {
      lines.push(`- by_segment=${bySegRows.map((r) => `${r.seg}:${r.n}`).join(", ")}`);
    }

    const docItems = Array.isArray(doc.items) ? doc.items : [];
    for (const it of docItems) {
      const id = it.visual_asset_id ?? it.visual_asset_group_id ?? "";
      const pageIndex = typeof it.page_index === "number" ? it.page_index : null;
      const pageLabel = it.page_label ?? (pageIndex != null ? `Page ${pageIndex + 1}` : "Page —");
      const seg = it.segment ?? "unknown";
      const conf = typeof it.segment_confidence === "number" ? it.segment_confidence : null;
      const source = it.segment_source ?? "unknown";

      const best = it.reason?.best_score ?? null;
      const runner = it.reason?.runner_up_score ?? null;
      const threshold = it.reason?.threshold ?? null;
      const unknownReason = it.reason?.unknown_reason_code ?? null;

      const titleSnippet = truncate(it.reason?.title_text_snippet ?? null, 140);
      const classSnippet = truncate(it.snippet ?? null, 180) ?? truncate((it as any)?.reason?.classification_text_snippet ?? null, 180);
      const ocrSnippet = truncate(it.content_preview?.ocr_text_snippet ?? null, 180);
      const archetypeTags = Array.isArray((it as any).archetype_tags) ? ((it as any).archetype_tags as string[]).slice(0, 8) : [];

      const sources = Array.isArray(it.reason?.classification_text_sources_used)
        ? it.reason!.classification_text_sources_used!.slice(0, 8)
        : [];
      const sjKeys = Array.isArray(it.content_preview?.structured_json_keys)
        ? it.content_preview!.structured_json_keys!.slice(0, 12)
        : [];

      lines.push("");
      lines.push(`#### ${mdEscape(String(pageLabel))}`);
      lines.push(`- visual_asset_id=${id}`);
      lines.push(`- segment=${seg} confidence=${conf != null ? conf.toFixed(2) : "?"} source=${source}`);
      lines.push(
        `- best_score=${best != null ? best.toFixed(3) : "?"} runner_up=${runner != null ? runner.toFixed(3) : "?"} threshold=${threshold != null ? threshold : "?"}`
      );
      if (unknownReason) lines.push(`- unknown_reason_code=${unknownReason}`);
      if (titleSnippet) lines.push(`- title_text_snippet=${mdEscape(titleSnippet)}`);
      if (archetypeTags.length > 0) lines.push(`- archetype_tags=${archetypeTags.map((t) => mdEscape(String(t))).join(", ")}${Array.isArray((it as any).archetype_tags) && ((it as any).archetype_tags as any[]).length > archetypeTags.length ? ", …" : ""}`);
      if (sources.length > 0) lines.push(`- classification_text_sources_used=${sources.join(", ")}${Array.isArray(it.reason?.classification_text_sources_used) && it.reason!.classification_text_sources_used!.length > sources.length ? ", …" : ""}`);
      if (classSnippet) lines.push(`- classification_text_snippet=${mdEscape(classSnippet)}`);
      if (ocrSnippet) lines.push(`- ocr_text_snippet=${mdEscape(ocrSnippet)}`);
      if (sjKeys.length > 0) lines.push(`- structured_json_keys=${sjKeys.join(", ")}${Array.isArray(it.content_preview?.structured_json_keys) && it.content_preview!.structured_json_keys!.length > sjKeys.length ? ", …" : ""}`);
      if (typeof it.evidence_count === "number") lines.push(`- evidence_count=${it.evidence_count}`);
      if (it.image_uri) lines.push(`- image_uri=${it.image_uri}`);

      if (it.reason?.override_applied) {
        lines.push(`- override_applied=true rule=${it.reason.override_rule_id ?? "?"}`);
        if (it.reason.override_explanation) lines.push(`- override_explanation=${mdEscape(it.reason.override_explanation)}`);
      }
    }
  }

  lines.push("");
  lines.push(`## Next actions (what to look at)`);
  lines.push(`- If many items are \`unknown\`: check whether OCR is missing/empty and whether classification sources show only structured_json with little body text.`);
  lines.push(`- If Unknown title-hint buckets cluster (e.g., many \`raise_terms\`): add/adjust title synonyms and keep them gated to low-signal cases (to avoid hurting other deals).`);
  lines.push(`- If many items are low-confidence: look for frequent runner-up ties; these are good candidates for adding/adjusting heading keywords in the segment classifier.`);
  lines.push(`- If PPTX/Word grouping hides signal: rerun with \`--no-group-word\` or \`--no-group-pptx\` to see raw members.`);
  lines.push("");

  return lines.join("\n");
}

async function main() {
  const { args, positional } = parseArgs(process.argv.slice(2));
  if (args.help) {
    // eslint-disable-next-line no-console
    console.log(usage());
    process.exit(0);
  }

  const dealId =
    (typeof args["deal-id"] === "string" ? args["deal-id"] : null) ??
    (typeof positional[0] === "string" ? positional[0] : null);

  if (!dealId) {
    // eslint-disable-next-line no-console
    console.error("Missing --deal-id");
    // eslint-disable-next-line no-console
    console.log(usage());
    process.exit(1);
  }

  const apiBaseUrl = typeof args["api-base-url"] === "string" ? String(args["api-base-url"]) : "http://localhost:9000";
  const outMd = typeof args["out-md"] === "string"
    ? String(args["out-md"])
    : "docs/Active/audit/analizer-debug/segment-classification-audit.md";

  const outJson = typeof args["out-json"] === "string" ? String(args["out-json"]) : computeOutJsonDefault(dealId);

  const groupWord = !boolArg(args["no-group-word"], false);
  const groupPptx = !boolArg(args["no-group-pptx"], false);
  const segmentRescore = boolArg(args["segment-rescore"], false);
  const dumpUnknown = boolArg(args["dump-unknown"], false);

  const qs = new URLSearchParams();
  qs.set("debug_segments", "1");
  qs.set("segment_audit", "1");
  qs.set("group_word", groupWord ? "1" : "0");
  qs.set("group_pptx", groupPptx ? "1" : "0");
  if (segmentRescore) qs.set("segment_rescore", "1");
  if (dumpUnknown) qs.set("dump_unknown", "1");

  const lineageUrl = `${apiBaseUrl.replace(/\/$/, "")}/api/v1/deals/${dealId}/lineage?${qs.toString()}`;

  const lineage = (await fetchJson(lineageUrl)) as LineageResponse;
  const report = lineage.segment_audit_report;

  if (outJson) {
    const path = await import("node:path");
    await ensureDir(path.dirname(outJson));
    await writeFile(outJson, JSON.stringify(lineage, null, 2));
  }

  if (!report) {
    throw new Error("segment_audit_report missing from lineage response (did you set debug_segments=1 in dev?)");
  }

  const md = renderMarkdown({
    apiBaseUrl,
    dealId,
    lineageUrl,
    report,
    warnings: Array.isArray(lineage.warnings) ? lineage.warnings : [],
    outJsonPath: outJson,
  });

  {
    const path = await import("node:path");
    await ensureDir(path.dirname(outMd));
    await writeFile(outMd, md);
  }

  // eslint-disable-next-line no-console
  console.log(`Wrote Markdown report: ${outMd}`);
  if (outJson) {
    // eslint-disable-next-line no-console
    console.log(`Wrote JSON artifact: ${outJson}`);
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
