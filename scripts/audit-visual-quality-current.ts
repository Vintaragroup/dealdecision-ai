/*
  Audit current visual-title + evidence-snippet quality across deals WITHOUT re-extracting.

  Goal: provide a single-command, low-touch check that new ingested deals look sane
  (no obvious OCR garbage leaking into evidence snippets / titles).

  Usage:
    pnpm -s tsx scripts/audit-visual-quality-current.ts --out artifacts/visual_quality_audit_current

  Flags:
    --api http://localhost:9000
    --limit 10
    --only <dealId> (repeatable)
    --exclude <dealId> (repeatable)

  Notes:
    - This calls /api/v1/deals/:id/visual-assets for each deal.
*/

import fs from "node:fs/promises";
import path from "node:path";

type Deal = { id: string; name?: string | null };

type Args = {
  apiBase: string;
  out: string;
  limit: number | null;
  only: string[];
  exclude: string[];
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
  const out = get("--out") ?? "artifacts/visual_quality_audit_current";
  const limitRaw = get("--limit");
  const limit = limitRaw ? Number(limitRaw) : null;
  const only = getAll("--only");
  const exclude = getAll("--exclude");

  return {
    apiBase,
    out,
    limit: Number.isFinite(limit) ? limit : null,
    only,
    exclude,
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

function computeMetrics(assets: any[]) {
  const items = assets.map((a: any) => {
    const slideTitle = cleanOneLine(a?.slide_title);
    const evidenceSnippets: string[] = Array.isArray(a?.evidence_sample_snippets)
      ? a.evidence_sample_snippets.map((s: any) => cleanOneLine(s)).filter(Boolean)
      : [];
    const first = evidenceSnippets[0] ?? "";
    const signal = snippetSignalScore(first);

    return {
      slide_title: slideTitle,
      title_garbledish: looksGarbledishTitle(slideTitle),
      first_snippet: first,
      first_empty: !first,
      first_known_garbage: containsKnownGarbage(first),
      first_low_signal_non_empty: first ? signal < 0.45 : false,
      first_signal: signal,
    };
  });

  const total = items.length;
  const titleGarbled = items.filter((i) => i.title_garbledish).length;
  const empty = items.filter((i) => i.first_empty).length;
  const garbage = items.filter((i) => i.first_known_garbage).length;
  const lowSigNonEmpty = items.filter((i) => i.first_low_signal_non_empty).length;
  const meanSignal = mean(items.map((i) => i.first_signal));

  return {
    visuals: total,
    evidence_first_empty: empty,
    evidence_first_known_garbage: garbage,
    evidence_first_low_signal_non_empty: lowSigNonEmpty,
    evidence_first_signal_mean: meanSignal,
    title_garbledish: titleGarbled,
  };
}

function evaluatePassFail(m: ReturnType<typeof computeMetrics>) {
  // Conservative defaults: aim to catch obvious regressions automatically.
  const thresholds = {
    maxKnownGarbage: 0,
    maxGarbledTitles: 0,
    // Allow some empties (spreadsheets / images with no text), but keep it bounded.
    maxEmptyPct: 0.25,
    // Low-signal non-empty is the dangerous case (garbage leaking). Keep very small.
    maxLowSignalNonEmptyPct: 0.05,
  };

  const emptyPct = m.visuals ? m.evidence_first_empty / m.visuals : 0;
  const lowSigPct = m.visuals ? m.evidence_first_low_signal_non_empty / m.visuals : 0;

  const failures: string[] = [];
  if (m.evidence_first_known_garbage > thresholds.maxKnownGarbage) failures.push("known_garbage_first_snippet");
  if (m.title_garbledish > thresholds.maxGarbledTitles) failures.push("garbled_titles");
  if (emptyPct > thresholds.maxEmptyPct) failures.push("too_many_empty_snippets");
  if (lowSigPct > thresholds.maxLowSignalNonEmptyPct) failures.push("too_many_low_signal_non_empty");

  return { pass: failures.length === 0, failures, thresholds, emptyPct, lowSigPct };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const allDeals = await fetchDeals(args.apiBase);

  const selected = allDeals
    .filter((d) => (args.only.length ? args.only.includes(d.id) : true))
    .filter((d) => !args.exclude.includes(d.id));

  const deals = args.limit != null ? selected.slice(0, args.limit) : selected;
  if (!deals.length) {
    console.error("No deals selected.");
    process.exit(2);
  }

  const rows: any[] = [];
  for (const deal of deals) {
    const assets = await fetchVisualAssets(args.apiBase, deal.id);
    const metrics = computeMetrics(assets);
    const evalRes = evaluatePassFail(metrics);
    rows.push({
      deal_id: deal.id,
      deal_name: deal.name ?? "",
      ...metrics,
      pass: evalRes.pass,
      failures: evalRes.failures,
      empty_pct: evalRes.emptyPct,
      low_signal_non_empty_pct: evalRes.lowSigPct,
    });
  }

  const report = {
    schema_version: "visual_quality_current_audit_v1",
    generated_at: new Date().toISOString(),
    api: { base: args.apiBase },
    totals: {
      deals: rows.length,
      visuals: rows.reduce((a, r) => a + (r.visuals || 0), 0),
      failing_deals: rows.filter((r) => !r.pass).length,
    },
    rows,
  };

  const outJson = `${args.out}.json`;
  const outMd = `${args.out}.md`;
  await fs.mkdir(path.dirname(outJson), { recursive: true });
  await fs.writeFile(outJson, JSON.stringify(report, null, 2), "utf8");

  const failing = rows.filter((r) => !r.pass);
  const md: string[] = [];
  md.push(`# Visual Quality Current Audit`);
  md.push("");
  md.push(`- Generated: ${report.generated_at}`);
  md.push(`- API: ${args.apiBase}`);
  md.push(`- Deals: ${report.totals.deals}`);
  md.push(`- Visual assets: ${report.totals.visuals}`);
  md.push(`- Failing deals: ${report.totals.failing_deals}`);
  md.push("");

  if (failing.length) {
    md.push(`## Failing deals`);
    for (const r of failing) {
      md.push(`- ${r.deal_name || r.deal_id}: failures=${(r.failures || []).join(",") || "?"} visuals=${r.visuals}`);
      md.push(`  - known_garbage=${r.evidence_first_known_garbage} garbled_titles=${r.title_garbledish}`);
      md.push(`  - empty=${r.evidence_first_empty} (${(r.empty_pct * 100).toFixed(1)}%) low_signal_non_empty=${r.evidence_first_low_signal_non_empty} (${(r.low_signal_non_empty_pct * 100).toFixed(1)}%)`);
    }
    md.push("");
  } else {
    md.push(`## All deals passed`);
    md.push("");
  }

  await fs.writeFile(outMd, md.join("\n") + "\n", "utf8");

  console.log(JSON.stringify({ ok: true, outJson, outMd, failing_deals: report.totals.failing_deals }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
