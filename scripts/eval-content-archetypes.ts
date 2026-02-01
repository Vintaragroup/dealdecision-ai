export {};

import fs from "node:fs";
import path from "node:path";

import {
  ALL_CONTENT_ARCHETYPE_TAGS,
  detectContentArchetypeTags,
  type ContentArchetypeTag,
} from "../packages/core/src/classification/content-archetypes";

type CorpusRow = {
  vertical?: string;
  deal_id?: string;
  document_id?: string;
  page_index?: number;
  page_label?: string;
  title_text?: string;
  body_text?: string;
  structured_hints?: unknown;
  gold_archetype_tags?: string[];
  notes?: string;
};

function readJsonl(filePath: string): CorpusRow[] {
  const raw = fs.readFileSync(filePath, "utf8");
  const rows: CorpusRow[] = [];
  for (const [idx, line] of raw.split(/\r?\n/).entries()) {
    const l = line.trim();
    if (!l) continue;
    try {
      rows.push(JSON.parse(l));
    } catch (err) {
      throw new Error(`Invalid JSONL at line ${idx + 1}: ${(err as any)?.message ?? String(err)}`);
    }
  }
  return rows;
}

function inc(map: Record<string, number>, key: string, by = 1) {
  map[key] = (map[key] ?? 0) + by;
}

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function structuredToString(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function asSupportedTag(tag: string): ContentArchetypeTag | null {
  // Runtime-safe narrowing: only accept tags that the detector might output.
  const supported = new Set<ContentArchetypeTag>(ALL_CONTENT_ARCHETYPE_TAGS);
  return supported.has(tag as ContentArchetypeTag) ? (tag as ContentArchetypeTag) : null;
}

function main() {
  const inputPath = process.argv[2] ?? "artifacts/training/sample_labeled_corpus.jsonl";
  const resolved = path.resolve(process.cwd(), inputPath);
  if (!fs.existsSync(resolved)) {
    // eslint-disable-next-line no-console
    console.error(`Missing corpus: ${resolved}`);
    // eslint-disable-next-line no-console
    console.error(`Usage: pnpm tsx scripts/eval-content-archetypes.ts <path/to/corpus.jsonl>`);
    // eslint-disable-next-line no-console
    console.error(`Tip: if you want to evaluate harvested unknowns, label a copy of artifacts/unknown-knowledgebase/unknown_items.jsonl into a corpus shape with gold_archetype_tags.`);
    process.exit(1);
  }

  const rows = readJsonl(resolved);
  const totals = {
    rows: rows.length,
    withGold: 0,
    withAnySupportedGold: 0,
  };

  const unsupportedGold: Record<string, number> = {};
  const supportedGoldCounts: Record<string, number> = {};
  const predictedCounts: Record<string, number> = {};

  const perTag = new Map<ContentArchetypeTag, { tp: number; fp: number; fn: number }>();
  const ensure = (t: ContentArchetypeTag) => {
    const v = perTag.get(t);
    if (v) return v;
    const init = { tp: 0, fp: 0, fn: 0 };
    perTag.set(t, init);
    return init;
  };

  for (const r of rows) {
    const goldRaw = Array.isArray(r.gold_archetype_tags) ? r.gold_archetype_tags.filter((t) => typeof t === "string") : [];
    if (goldRaw.length > 0) totals.withGold++;

    const goldSupported = uniq(goldRaw.map((t) => asSupportedTag(t)).filter((t): t is ContentArchetypeTag => Boolean(t)));
    if (goldSupported.length > 0) totals.withAnySupportedGold++;

    for (const t of goldRaw) {
      const supported = asSupportedTag(t);
      if (supported) inc(supportedGoldCounts, supported);
      else inc(unsupportedGold, t);
    }

    const predicted = detectContentArchetypeTags({
      title: r.title_text ?? null,
      snippet: r.body_text ?? null,
      ocr: null,
      structured: structuredToString(r.structured_hints),
    });

    for (const t of predicted) inc(predictedCounts, t);

    const goldSet = new Set(goldSupported);
    const predSet = new Set(predicted);

    // Update per-tag confusion
    for (const t of new Set([...goldSet, ...predSet])) {
      const stats = ensure(t as ContentArchetypeTag);
      const inGold = goldSet.has(t as ContentArchetypeTag);
      const inPred = predSet.has(t as ContentArchetypeTag);
      if (inGold && inPred) stats.tp++;
      else if (!inGold && inPred) stats.fp++;
      else if (inGold && !inPred) stats.fn++;
    }
  }

  const f1 = (tp: number, fp: number, fn: number) => {
    const p = tp + fp === 0 ? 0 : tp / (tp + fp);
    const r = tp + fn === 0 ? 0 : tp / (tp + fn);
    return p + r === 0 ? 0 : (2 * p * r) / (p + r);
  };

  const rowsOut: any[] = [];
  for (const [tag, s] of perTag.entries()) {
    rowsOut.push({ tag, ...s, f1: Number(f1(s.tp, s.fp, s.fn).toFixed(3)) });
  }
  rowsOut.sort((a, b) => b.f1 - a.f1);

  const unsupported = Object.entries(unsupportedGold)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([tag, count]) => ({ tag, count }));

  const report = {
    corpus: resolved,
    totals,
    supported_gold_counts: supportedGoldCounts,
    predicted_counts: predictedCounts,
    per_tag: rowsOut,
    unsupported_gold_top: unsupported,
    notes: {
      meaning: "unsupported_gold_top are labels present in your corpus but not in the current ContentArchetypeTag enum; they won't be evaluated until we add them or map them into archetypes/topics.",
    },
  };

  // eslint-disable-next-line no-console
  console.log(JSON.stringify(report, null, 2));
}

main();
