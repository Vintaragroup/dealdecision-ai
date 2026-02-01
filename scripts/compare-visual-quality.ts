/*
  Compare two visual-quality report artifacts produced by scripts/report-visual-quality.ts.

  Usage:
    pnpm -s tsx scripts/compare-visual-quality.ts \
      --before artifacts/webmax_visual_quality.before.json \
      --after artifacts/webmax_visual_quality.after_refresh.json
*/

import fs from "node:fs/promises";

type Item = {
  visual_asset_id: string | null;
  document_id: string | null;
  document_title: string;
  page_index: number | null;
  slide_title: string;
  slide_title_source: string;
  title_garbledish: boolean;
  evidence_snippets: string[];
  evidence_first_signal: number;
};

type Report = {
  schema_version?: string;
  deal_id?: string;
  label?: string;
  generated_at?: string;
  totals?: Record<string, unknown>;
  items: Item[];
};

function cleanOneLine(s: unknown): string {
  if (typeof s !== "string") return "";
  return s.replace(/\s+/g, " ").trim();
}

function toKey(i: Item): string {
  // visual_asset_id should be stable across runs; fallback includes doc+page.
  return cleanOneLine(i.visual_asset_id) || `${cleanOneLine(i.document_id)}::${String(i.page_index ?? "")}`;
}

function mean(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function parseArgs(argv: string[]) {
  const get = (k: string): string | null => {
    const idx = argv.indexOf(k);
    if (idx === -1) return null;
    const v = argv[idx + 1];
    return typeof v === "string" ? v : null;
  };
  const before = get("--before") ?? "";
  const after = get("--after") ?? "";
  if (!before || !after) {
    console.error("Missing --before <file> and/or --after <file>");
    process.exit(2);
  }
  return { before, after };
}

function containsKnownGarbage(s: string): boolean {
  const t = cleanOneLine(s);
  if (!t) return false;
  if (/\bposop\b/i.test(t)) return true;
  if (/\b\w{1,3}(?:\s+\w{1,3}){6,}\b/.test(t)) return true; // lots of tiny tokens
  return false;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const before: Report = JSON.parse(await fs.readFile(args.before, "utf8"));
  const after: Report = JSON.parse(await fs.readFile(args.after, "utf8"));

  const beforeByKey = new Map(before.items.map((i) => [toKey(i), i] as const));
  const afterByKey = new Map(after.items.map((i) => [toKey(i), i] as const));

  const keys = Array.from(new Set([...beforeByKey.keys(), ...afterByKey.keys()]));

  const deltas: Array<{
    key: string;
    doc: string;
    page: number | null;
    title: string;
    beforeSnippet: string;
    afterSnippet: string;
    beforeSignal: number;
    afterSignal: number;
    delta: number;
  }> = [];

  let missingInAfter = 0;
  let missingInBefore = 0;
  let changedFirstSnippet = 0;

  for (const key of keys) {
    const b = beforeByKey.get(key);
    const a = afterByKey.get(key);
    if (!b) {
      missingInBefore += 1;
      continue;
    }
    if (!a) {
      missingInAfter += 1;
      continue;
    }

    const b0 = cleanOneLine(b.evidence_snippets?.[0] ?? "");
    const a0 = cleanOneLine(a.evidence_snippets?.[0] ?? "");
    if (b0 !== a0) changedFirstSnippet += 1;

    const beforeSignal = Number.isFinite(b.evidence_first_signal) ? b.evidence_first_signal : 0;
    const afterSignal = Number.isFinite(a.evidence_first_signal) ? a.evidence_first_signal : 0;
    deltas.push({
      key,
      doc: cleanOneLine(a.document_title || b.document_title),
      page: a.page_index ?? b.page_index,
      title: cleanOneLine(a.slide_title || b.slide_title),
      beforeSnippet: b0,
      afterSnippet: a0,
      beforeSignal,
      afterSignal,
      delta: afterSignal - beforeSignal,
    });
  }

  const allDeltaValues = deltas.map((d) => d.delta);

  const knownGarbageBefore = deltas.filter((d) => containsKnownGarbage(d.beforeSnippet)).length;
  const knownGarbageAfter = deltas.filter((d) => containsKnownGarbage(d.afterSnippet)).length;

  const improved = [...deltas].sort((x, y) => y.delta - x.delta).slice(0, 10);
  const regressed = [...deltas].sort((x, y) => x.delta - y.delta).slice(0, 10);

  console.log("== Visual quality diff ==");
  console.log(`before: ${args.before}`);
  console.log(`after:  ${args.after}`);
  console.log("-");
  console.log(`items(before)=${before.items.length} items(after)=${after.items.length}`);
  console.log(`missing_in_before=${missingInBefore} missing_in_after=${missingInAfter}`);
  console.log(`changed_first_snippet=${changedFirstSnippet}`);
  console.log(`mean_signal_delta=${mean(allDeltaValues).toFixed(4)}`);
  console.log(`known_garbage_first_snippet: before=${knownGarbageBefore} after=${knownGarbageAfter}`);

  const fmt = (d: (typeof deltas)[number]) => {
    const loc = `${d.doc || "(unknown doc)"} p${d.page ?? "?"}`;
    return `${loc} | Δ=${d.delta.toFixed(3)} | ${d.title || "(no title)"}\n  before: ${d.beforeSnippet || "(empty)"}\n  after:  ${d.afterSnippet || "(empty)"}`;
  };

  console.log("\n== Top improvements ==");
  for (const d of improved) console.log(fmt(d));

  console.log("\n== Top regressions ==");
  for (const d of regressed) console.log(fmt(d));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
