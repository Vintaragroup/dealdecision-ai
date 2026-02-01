/*
  Report visual title + evidence snippet quality for a deal.

  Usage:
    pnpm -s tsx scripts/report-visual-quality.ts --deal <dealId> --label before --out artifacts/webmax_visual_quality

  Outputs:
    <out>.<label>.json
    <out>.<label>.md
*/

import fs from "node:fs/promises";
import path from "node:path";

type Args = {
  deal: string;
  label: string;
  out: string;
  apiBase: string;
};

function parseArgs(argv: string[]): Args {
  const get = (k: string): string | null => {
    const idx = argv.indexOf(k);
    if (idx === -1) return null;
    const v = argv[idx + 1];
    return typeof v === "string" ? v : null;
  };

  const deal = get("--deal") ?? get("-d") ?? "";
  const label = get("--label") ?? "run";
  const out = get("--out") ?? "artifacts/visual_quality";
  const apiBase = (get("--api") ?? process.env.DDAI_API_BASE ?? "http://localhost:9000").replace(/\/$/, "");

  if (!deal.trim()) {
    console.error("Missing --deal <dealId>");
    process.exit(2);
  }

  return { deal: deal.trim(), label: label.trim() || "run", out, apiBase };
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
  // OCR-y mixed case like PoSOP
  const tokens = t.split(/\s+/).filter(Boolean);
  if (tokens.some((w) => /^[A-Z][a-z][A-Z]{2,}$/.test(w.replace(/[^A-Za-z]/g, "")))) return true;
  // lots of tiny tokens
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
  // Known noisy token seen in OCR output.
  if (/\bposop\b/i.test(s)) return true;
  // OCR-y mixed case like PoSOP (more general).
  const tokens = s.split(/\s+/).filter(Boolean);
  if (tokens.some((w) => /^[A-Z][a-z][A-Z]{2,}$/.test(w.replace(/[^A-Za-z]/g, "")))) return true;
  // Many tiny tokens in a row is often junk.
  if (tokens.length >= 7 && tokens.filter((w) => w.length <= 2).length >= Math.ceil(tokens.length * 0.7)) return true;
  return false;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const url = `${args.apiBase}/api/v1/deals/${args.deal}/visual-assets`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`HTTP ${res.status} from ${url}`);
    console.error(body.slice(0, 1200));
    process.exit(1);
  }

  const payload: any = await res.json();
  const assets: any[] = Array.isArray(payload?.visual_assets) ? payload.visual_assets : [];

  const items = assets.map((a) => {
    const pageIndex = typeof a?.page_index === "number" ? a.page_index : null;
    const docId = typeof a?.document_id === "string" ? a.document_id : null;
    const docTitle = cleanOneLine(a?.document_title);
    const vaId = typeof a?.visual_asset_id === "string" ? a.visual_asset_id : typeof a?.id === "string" ? a.id : null;

    const slideTitle = cleanOneLine(a?.slide_title);
    const slideTitleSource = cleanOneLine(a?.slide_title_source);
    const slideTitleConfidence = typeof a?.slide_title_confidence === "number" ? a.slide_title_confidence : null;

    const ocrText = cleanOneLine(a?.ocr_text);
    const ocrLen = ocrText.length;

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
      slide_title_confidence: slideTitleConfidence,
      title_garbledish: looksGarbledishTitle(slideTitle),
      ocr_len: ocrLen,
      evidence_count: typeof a?.evidence_count === "number" ? a.evidence_count : null,
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

  const sampleWorstEvidence = [...items]
    .filter((i) => i.evidence_snippets?.[0])
    .sort((a, b) => a.evidence_first_signal - b.evidence_first_signal)
    .slice(0, 10);

  const sampleWorstTitles = [...items]
    .filter((i) => i.slide_title)
    .sort((a, b) => (a.title_garbledish === b.title_garbledish ? 0 : a.title_garbledish ? -1 : 1))
    .slice(0, 15);

  const report = {
    schema_version: "visual_quality_v1",
    deal_id: args.deal,
    label: args.label,
    api: { base: args.apiBase, url },
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
    worst_examples: {
      titles: sampleWorstTitles,
      evidence: sampleWorstEvidence,
    },
    items,
  };

  const outJson = `${args.out}.${args.label}.json`;
  const outMd = `${args.out}.${args.label}.md`;
  await fs.mkdir(path.dirname(outJson), { recursive: true });
  await fs.writeFile(outJson, JSON.stringify(report, null, 2), "utf8");

  const mdLines: string[] = [];
  mdLines.push(`# Visual Quality Report (${args.label})`);
  mdLines.push("");
  mdLines.push(`- Deal: ${args.deal}`);
  mdLines.push(`- Generated: ${report.generated_at}`);
  mdLines.push(`- API: ${url}`);
  mdLines.push("");
  mdLines.push("## Totals");
  mdLines.push("");
  mdLines.push(`- Visuals: ${report.totals.visuals}`);
  mdLines.push(`- Garbled-ish titles: ${report.totals.title_garbledish} (${(report.totals.title_garbledish_pct * 100).toFixed(1)}%)`);
  mdLines.push(`- Title source: index_fallback_v1: ${report.totals.title_source_index_fallback} (${(report.totals.title_source_index_fallback_pct * 100).toFixed(1)}%)`);
  mdLines.push(`- Evidence low-signal (first snippet): ${report.totals.evidence_low_signal_first_snippet} (${(report.totals.evidence_low_signal_first_snippet_pct * 100).toFixed(1)}%)`);
  mdLines.push("");

  mdLines.push("## Worst Evidence Snippets (by heuristic score)");
  mdLines.push("");
  for (const w of report.worst_examples.evidence) {
    mdLines.push(`- ${w.document_title || w.document_id} p${w.page_index != null ? w.page_index + 1 : "?"}: score=${w.evidence_first_signal.toFixed(2)} title="${w.slide_title}" snippet="${cleanOneLine(w.evidence_snippets?.[0] ?? "").slice(0, 220)}"`);
  }
  mdLines.push("");

  mdLines.push("## Visuals (title + first evidence snippet)");
  mdLines.push("");
  mdLines.push("| Doc | Page | Title | Title Source | Evidence Snippet (first) | Evidence Score | OCR chars |");
  mdLines.push("|---|---:|---|---|---|---:|---:|");
  for (const it of items) {
    const doc = (it.document_title || it.document_id || "").replace(/\|/g, "\\|");
    const page = it.page_index != null ? String(it.page_index + 1) : "";
    const title = (it.slide_title || "").replace(/\|/g, "\\|");
    const src = (it.slide_title_source || "").replace(/\|/g, "\\|");
    const snip = cleanOneLine(it.evidence_snippets?.[0] ?? "").slice(0, 180).replace(/\|/g, "\\|");
    mdLines.push(`| ${doc} | ${page} | ${title} | ${src} | ${snip} | ${it.evidence_first_signal.toFixed(2)} | ${it.ocr_len} |`);
  }

  await fs.writeFile(outMd, mdLines.join("\n"), "utf8");

  console.log(JSON.stringify({ ok: true, outJson, outMd, totals: report.totals }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
