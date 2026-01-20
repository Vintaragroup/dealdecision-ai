/*
  Summarize a visual-quality before/after run produced by scripts/run-visual-quality-before-after.ts.

  Usage:
    pnpm -s tsx scripts/summarize-visual-quality-run.ts \
      --summary artifacts/visual_quality_runs/all_other_deals_2026-01-18/summary.json

  Outputs:
    Writes a markdown summary next to summary.json.
*/

import fs from "node:fs/promises";
import path from "node:path";

type Row = {
  deal_id: string;
  deal_name?: string;
  visuals: number;
  evidence_first_known_garbage_before: number;
  evidence_first_known_garbage_after: number;
  evidence_first_empty_before: number;
  evidence_first_empty_after: number;
  evidence_first_low_signal_non_empty_before: number;
  evidence_first_low_signal_non_empty_after: number;
  evidence_first_signal_mean_before: number;
  evidence_first_signal_mean_after: number;
  title_garbledish_before: number;
  title_garbledish_after: number;
};

type Summary = {
  schema_version?: string;
  started_at?: string;
  finished_at?: string;
  api?: { base?: string };
  deal_count?: number;
  rows: Row[];
};

function parseArgs(argv: string[]) {
  const get = (k: string): string | null => {
    const idx = argv.indexOf(k);
    if (idx === -1) return null;
    const v = argv[idx + 1];
    return typeof v === "string" ? v : null;
  };
  const summary = get("--summary") ?? "";
  if (!summary) {
    console.error("Missing --summary <path/to/summary.json>");
    process.exit(2);
  }
  return { summary };
}

function sum(rows: Row[], key: keyof Row): number {
  return rows.reduce((acc, r) => acc + (Number(r[key]) || 0), 0);
}

function meanWeighted(rows: Row[], valueKey: keyof Row, weightKey: keyof Row): number {
  let wSum = 0;
  let vSum = 0;
  for (const r of rows) {
    const w = Number(r[weightKey]) || 0;
    const v = Number(r[valueKey]) || 0;
    if (w <= 0) continue;
    wSum += w;
    vSum += v * w;
  }
  return wSum ? vSum / wSum : 0;
}

function fmtPct(n: number, d: number): string {
  if (!d) return "0%";
  return `${((n / d) * 100).toFixed(1)}%`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const raw = await fs.readFile(args.summary, "utf8");
  const summary: Summary = JSON.parse(raw);
  const rows = Array.isArray(summary.rows) ? summary.rows : [];

  const totalDeals = rows.length;
  const totalVisuals = sum(rows, "visuals");

  const garbageBefore = sum(rows, "evidence_first_known_garbage_before");
  const garbageAfter = sum(rows, "evidence_first_known_garbage_after");

  const emptyBefore = sum(rows, "evidence_first_empty_before");
  const emptyAfter = sum(rows, "evidence_first_empty_after");

  const lowSigNonEmptyBefore = sum(rows, "evidence_first_low_signal_non_empty_before");
  const lowSigNonEmptyAfter = sum(rows, "evidence_first_low_signal_non_empty_after");

  const titleGarbledBefore = sum(rows, "title_garbledish_before");
  const titleGarbledAfter = sum(rows, "title_garbledish_after");

  const meanSignalBefore = meanWeighted(rows, "evidence_first_signal_mean_before", "visuals");
  const meanSignalAfter = meanWeighted(rows, "evidence_first_signal_mean_after", "visuals");

  const dealsWithGarbageAfter = rows.filter((r) => (r.evidence_first_known_garbage_after || 0) > 0);
  const dealsWithLowSigAfter = rows.filter((r) => (r.evidence_first_low_signal_non_empty_after || 0) > 0);
  const dealsWithTitleGarbledAfter = rows.filter((r) => (r.title_garbledish_after || 0) > 0);

  const md: string[] = [];
  md.push(`# Visual Quality Run Summary`);
  md.push("");
  md.push(`- Deals: ${totalDeals}`);
  md.push(`- Visual assets: ${totalVisuals}`);
  md.push(`- API: ${summary.api?.base ?? ""}`);
  md.push(`- Started: ${summary.started_at ?? ""}`);
  md.push(`- Finished: ${summary.finished_at ?? ""}`);
  md.push("");

  md.push(`## Evidence snippet quality`);
  md.push(`- Known garbage (first snippet): ${garbageBefore} → ${garbageAfter} (of ${totalVisuals}, ${fmtPct(garbageAfter, totalVisuals)})`);
  md.push(`- Empty first snippets: ${emptyBefore} → ${emptyAfter} (of ${totalVisuals}, ${fmtPct(emptyAfter, totalVisuals)})`);
  md.push(`- Low-signal non-empty first snippets: ${lowSigNonEmptyBefore} → ${lowSigNonEmptyAfter} (of ${totalVisuals}, ${fmtPct(lowSigNonEmptyAfter, totalVisuals)})`);
  md.push(`- Mean first-snippet signal (weighted): ${meanSignalBefore.toFixed(3)} → ${meanSignalAfter.toFixed(3)}`);
  md.push("");

  md.push(`## Titles`);
  md.push(`- Garbled-ish titles: ${titleGarbledBefore} → ${titleGarbledAfter} (of ${totalVisuals}, ${fmtPct(titleGarbledAfter, totalVisuals)})`);
  md.push("");

  md.push(`## Deals needing follow-up`);
  md.push(`- Known garbage remaining: ${dealsWithGarbageAfter.length}`);
  for (const r of dealsWithGarbageAfter.slice(0, 20)) {
    md.push(`  - ${r.deal_name ?? r.deal_id}: ${r.evidence_first_known_garbage_after}`);
  }
  md.push(`- Low-signal non-empty remaining: ${dealsWithLowSigAfter.length}`);
  for (const r of dealsWithLowSigAfter.slice(0, 20)) {
    md.push(`  - ${r.deal_name ?? r.deal_id}: ${r.evidence_first_low_signal_non_empty_after}`);
  }
  md.push(`- Garbled-ish titles remaining: ${dealsWithTitleGarbledAfter.length}`);
  for (const r of dealsWithTitleGarbledAfter.slice(0, 20)) {
    md.push(`  - ${r.deal_name ?? r.deal_id}: ${r.title_garbledish_after}`);
  }

  const outPath = path.join(path.dirname(args.summary), "summary.md");
  await fs.writeFile(outPath, md.join("\n") + "\n", "utf8");

  console.log(JSON.stringify({ ok: true, out: outPath, totals: { totalDeals, totalVisuals, garbageBefore, garbageAfter } }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
