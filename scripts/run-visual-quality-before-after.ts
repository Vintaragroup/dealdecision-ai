/*
  Run a visual-quality before/after evaluation across deals.

  For each deal:
    1) Fetch /visual-assets and compute metrics (before)
    2) POST /extract-visuals with force flags
    3) Poll /jobs/:id until completion
    4) Fetch /visual-assets again and compute metrics (after)
    5) Write per-deal JSON reports + an aggregate summary

  Usage:
    pnpm -s tsx scripts/run-visual-quality-before-after.ts --out artifacts/visual_quality_runs/run1

  Useful flags:
    --api http://localhost:9000
    --limit 5
    --only <dealId> (repeatable)
    --exclude <dealId> (repeatable)

  Notes:
    - This script triggers re-extraction; it can take a while on many deals.
*/

import fs from "node:fs/promises";
import path from "node:path";

type Deal = { id: string; name?: string | null };

type Args = {
  apiBase: string;
  outDir: string;
  limit: number | null;
  only: string[];
  exclude: string[];
  pollSeconds: number;
};

function parseArgs(argv: string[]): Args {
  const get = (k: string): string | null => {
    const idx = argv.indexOf(k);
    if (idx === -1) return null;
    const v = argv[idx + 1];
    return typeof v === "string" ? v : null;
  };
  const getAll = (k: string): string[] => {
    const out: string[] = [];
    for (let i = 0; i < argv.length; i++) {
      if (argv[i] === k && typeof argv[i + 1] === "string") out.push(String(argv[i + 1]));
    }
    return out;
  };

  const apiBase = (get("--api") ?? process.env.DDAI_API_BASE ?? "http://localhost:9000").replace(/\/$/, "");
  const outDir = get("--out") ?? "artifacts/visual_quality_runs/run";
  const limitRaw = get("--limit");
  const limit = limitRaw ? Number(limitRaw) : null;
  const only = getAll("--only");
  const exclude = getAll("--exclude");
  const pollSeconds = Math.max(1, Number(get("--poll") ?? "2"));

  return {
    apiBase,
    outDir,
    limit: Number.isFinite(limit) ? limit : null,
    only,
    exclude,
    pollSeconds,
  };
}

function cleanOneLine(s: unknown): string {
  if (typeof s !== "string") return "";
  return s.replace(/\s+/g, " ").trim();
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function mean(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function weirdCharRatio(s: string): number {
  if (!s) return 1;
  const weird = (s.match(/[^a-zA-Z0-9\s\-\/:,.()&+%$]/g) ?? []).length;
  return weird / Math.max(1, s.length);
}

function alphaRatio(s: string): number {
  const noSpace = s.replace(/\s/g, "");
  if (!noSpace) return 0;
  const letters = (noSpace.match(/[A-Za-z]/g) ?? []).length;
  return letters / Math.max(1, noSpace.length);
}

function looksGarbledishTitle(title: string): boolean {
  const t = cleanOneLine(title);
  if (!t) return true;
  if (t.length >= 10 && alphaRatio(t) < 0.55) return true;
  if (t.length >= 12 && weirdCharRatio(t) >= 0.12) return true;
  const tokens = t.split(/\s+/).filter(Boolean);
  if (tokens.some((w) => /^[A-Z][a-z][A-Z]{2,}$/.test(w.replace(/[^A-Za-z]/g, "")))) return true;
  if (tokens.length >= 5 && tokens.filter((w) => w.length <= 2).length >= Math.ceil(tokens.length * 0.7)) return true;
  return false;
}

function snippetSignalScore(snippet: string): number {
  const s = cleanOneLine(snippet);
  if (!s) return 0;
  const hasUrl = /\bhttps?:\/\//i.test(s) || /\bwww\./i.test(s);
  const hasEmail = /\b\S+@\S+\b/.test(s);
  const wc = s.split(/\s+/).filter(Boolean).length;
  const alpha = alphaRatio(s);
  const weird = weirdCharRatio(s);

  let score = 0;
  score += Math.min(1, wc / 20) * 0.45;
  score += clamp01((alpha - 0.45) / 0.5) * 0.45;
  score -= clamp01((weird - 0.08) / 0.25) * 0.35;
  if (hasUrl || hasEmail) score -= 0.2;
  return Math.max(0, Math.min(1, score));
}

function containsKnownGarbage(snippet: string): boolean {
  const s = cleanOneLine(snippet);
  if (!s) return false;
  if (/\bposop\b/i.test(s)) return true;
  const tokens = s.split(/\s+/).filter(Boolean);
  if (tokens.some((w) => /^[A-Z][a-z][A-Z]{2,}$/.test(w.replace(/[^A-Za-z]/g, "")))) return true;
  if (tokens.length >= 7 && tokens.filter((w) => w.length <= 2).length >= Math.ceil(tokens.length * 0.7)) return true;
  return false;
}

async function httpJson(url: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, { ...init, headers: { accept: "application/json", ...(init?.headers ?? {}) } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} from ${url}: ${body.slice(0, 400)}`);
  }
  return await res.json();
}

async function fetchDeals(apiBase: string): Promise<Deal[]> {
  const url = `${apiBase}/api/v1/deals`;
  const data = await httpJson(url);
  if (!Array.isArray(data)) return [];
  return data
    .map((d) => ({ id: cleanOneLine(d?.id), name: cleanOneLine(d?.name) }))
    .filter((d) => d.id);
}

async function fetchVisualAssets(apiBase: string, dealId: string): Promise<any[]> {
  const url = `${apiBase}/api/v1/deals/${dealId}/visual-assets`;
  const payload = await httpJson(url);
  return Array.isArray(payload?.visual_assets) ? payload.visual_assets : [];
}

function computeReport(dealId: string, label: string, apiBase: string, assets: any[]) {
  const items = assets.map((a: any) => {
    const pageIndex = typeof a?.page_index === "number" ? a.page_index : null;
    const docId = typeof a?.document_id === "string" ? a.document_id : null;
    const docTitle = cleanOneLine(a?.document_title);
    const vaId = typeof a?.visual_asset_id === "string" ? a.visual_asset_id : typeof a?.id === "string" ? a.id : null;

    const slideTitle = cleanOneLine(a?.slide_title);
    const slideTitleSource = cleanOneLine(a?.slide_title_source);

    const evidenceSnippets: string[] = Array.isArray(a?.evidence_sample_snippets)
      ? a.evidence_sample_snippets.map((s: any) => cleanOneLine(s)).filter(Boolean)
      : [];
    const firstEvidence = evidenceSnippets[0] ?? "";
    const evidenceSignal = snippetSignalScore(firstEvidence);

    return {
      visual_asset_id: vaId,
      document_id: docId,
      document_title: docTitle,
      page_index: pageIndex,
      slide_title: slideTitle,
      slide_title_source: slideTitleSource,
      title_garbledish: looksGarbledishTitle(slideTitle),
      evidence_snippets: evidenceSnippets,
      evidence_first_signal: evidenceSignal,
    };
  });

  const total = items.length;
  const titleGarbled = items.filter((i) => i.title_garbledish).length;
  const indexFallback = items.filter((i) => i.slide_title_source === "index_fallback_v1").length;
  const ocrTitle = items.filter((i) => i.slide_title_source?.startsWith("ocr") || i.slide_title_source?.includes("ocr")).length;
  const structuredTitle = items.filter((i) => i.slide_title_source?.includes("structured")).length;

  const evidenceFirstEmpty = items.filter((i) => !i.evidence_snippets?.[0]).length;
  const evidenceFirstKnownGarbage = items.filter((i) => containsKnownGarbage(i.evidence_snippets?.[0] ?? "")).length;
  const evidenceFirstLowSignalNonEmpty = items.filter((i) => (i.evidence_snippets?.[0] ? i.evidence_first_signal < 0.45 : false)).length;
  const evidenceLowSignal = items.filter((i) => (i.evidence_snippets?.[0] ? i.evidence_first_signal < 0.45 : true)).length;
  const evidenceMeanSignal = mean(items.map((i) => i.evidence_first_signal));

  return {
    schema_version: "visual_quality_v2",
    deal_id: dealId,
    label,
    api: { base: apiBase, url: `${apiBase}/api/v1/deals/${dealId}/visual-assets` },
    generated_at: new Date().toISOString(),
    totals: {
      visuals: total,
      title_garbledish: titleGarbled,
      title_garbledish_pct: total ? titleGarbled / total : 0,
      title_source_index_fallback: indexFallback,
      title_source_index_fallback_pct: total ? indexFallback / total : 0,
      title_source_ocr: ocrTitle,
      title_source_structured: structuredTitle,
      evidence_first_empty: evidenceFirstEmpty,
      evidence_first_empty_pct: total ? evidenceFirstEmpty / total : 0,
      evidence_first_known_garbage: evidenceFirstKnownGarbage,
      evidence_first_known_garbage_pct: total ? evidenceFirstKnownGarbage / total : 0,
      evidence_first_low_signal_non_empty: evidenceFirstLowSignalNonEmpty,
      evidence_first_low_signal_non_empty_pct: total ? evidenceFirstLowSignalNonEmpty / total : 0,
      evidence_low_signal_first_snippet: evidenceLowSignal,
      evidence_low_signal_first_snippet_pct: total ? evidenceLowSignal / total : 0,
      evidence_first_signal_mean: evidenceMeanSignal,
    },
    items,
  };
}

async function triggerExtractVisuals(apiBase: string, dealId: string): Promise<string> {
  const url = `${apiBase}/api/v1/deals/${dealId}/extract-visuals`;
  const payload = await httpJson(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ force_reextract: true, force_resegment: true }),
  });
  const jobId = cleanOneLine(payload?.job_id);
  if (!jobId) throw new Error(`No job_id returned from ${url}`);
  return jobId;
}

async function waitForJob(apiBase: string, jobId: string, pollSeconds: number): Promise<any> {
  const url = `${apiBase}/api/v1/jobs/${jobId}`;
  for (let i = 0; i < 7200; i++) {
    const payload = await httpJson(url);
    const status = cleanOneLine(payload?.status);
    if (status === "succeeded" || status === "failed") return payload;
    await new Promise((r) => setTimeout(r, pollSeconds * 1000));
  }
  throw new Error(`Timeout waiting for job ${jobId}`);
}

async function writeJson(filePath: string, data: unknown) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dealsAll = await fetchDeals(args.apiBase);

  const selected = dealsAll
    .filter((d) => (args.only.length ? args.only.includes(d.id) : true))
    .filter((d) => !args.exclude.includes(d.id));

  const deals = args.limit != null ? selected.slice(0, args.limit) : selected;

  if (!deals.length) {
    console.error("No deals selected.");
    process.exit(2);
  }

  const runMeta = {
    schema_version: "visual_quality_run_v1",
    started_at: new Date().toISOString(),
    api: { base: args.apiBase },
    deal_count: deals.length,
    deals: deals.map((d) => ({ id: d.id, name: d.name ?? null })),
  };
  await fs.mkdir(args.outDir, { recursive: true });
  await writeJson(path.join(args.outDir, "run.json"), runMeta);

  const summaryRows: any[] = [];

  for (const deal of deals) {
    const dealId = deal.id;
    const dealName = deal.name ?? "";
    console.log(`== Deal ${dealId} ${dealName ? `(${dealName})` : ""} ==`);

    const assetsBefore = await fetchVisualAssets(args.apiBase, dealId);
    const before = computeReport(dealId, "before", args.apiBase, assetsBefore);
    await writeJson(path.join(args.outDir, `${dealId}.before.json`), before);

    const jobId = await triggerExtractVisuals(args.apiBase, dealId);
    console.log(`triggered job ${jobId}`);
    const jobRes = await waitForJob(args.apiBase, jobId, args.pollSeconds);
    console.log(`job status=${jobRes?.status ?? ""}`);

    const assetsAfter = await fetchVisualAssets(args.apiBase, dealId);
    const after = computeReport(dealId, "after", args.apiBase, assetsAfter);
    await writeJson(path.join(args.outDir, `${dealId}.after.json`), after);

    const b = before.totals as any;
    const a = after.totals as any;
    summaryRows.push({
      deal_id: dealId,
      deal_name: dealName,
      visuals: a.visuals,
      evidence_first_known_garbage_before: b.evidence_first_known_garbage,
      evidence_first_known_garbage_after: a.evidence_first_known_garbage,
      evidence_first_empty_before: b.evidence_first_empty,
      evidence_first_empty_after: a.evidence_first_empty,
      evidence_first_low_signal_non_empty_before: b.evidence_first_low_signal_non_empty,
      evidence_first_low_signal_non_empty_after: a.evidence_first_low_signal_non_empty,
      evidence_first_signal_mean_before: b.evidence_first_signal_mean,
      evidence_first_signal_mean_after: a.evidence_first_signal_mean,
      title_garbledish_before: b.title_garbledish,
      title_garbledish_after: a.title_garbledish,
    });
  }

  const summary = {
    ...runMeta,
    finished_at: new Date().toISOString(),
    rows: summaryRows,
  };
  await writeJson(path.join(args.outDir, "summary.json"), summary);

  console.log(`\nWrote: ${args.outDir}/summary.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
