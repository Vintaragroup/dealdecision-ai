import { buildCanonicalInput, computeInputHash, stableCompare } from "./canonical";
import { classifyPage, computeClassificationFeatures } from "./classify";
import { extractEntities } from "./extract_entities";
import { extractMetrics } from "./extract_metrics";
import { normalizeText } from "./normalize";
import { rankEvidence } from "./rank_evidence";

import type {
  DeterministicUnderstandingInput,
  DocumentUnderstanding,
  EvidenceSnippet,
  ExtractedMetric,
  PageType,
  PageUnderstanding,
  SegmentUnderstanding,
  UnderstandingPatch,
} from "./types";

type NowFn = () => Date;

export interface BuildUnderstandingPatchOptions {
  now?: NowFn;
}

function sortPagesStable(pages: DeterministicUnderstandingInput["pages"]): DeterministicUnderstandingInput["pages"] {
  return [...pages].sort((a, b) => {
    const docCmp = stableCompare(a.document_id, b.document_id);
    if (docCmp !== 0) return docCmp;

    const ai = typeof a.page_index === "number" ? a.page_index : Number.MAX_SAFE_INTEGER;
    const bi = typeof b.page_index === "number" ? b.page_index : Number.MAX_SAFE_INTEGER;
    const idxCmp = stableCompare(ai, bi);
    if (idxCmp !== 0) return idxCmp;

    return stableCompare(a.page_id, b.page_id);
  });
}

function countBy<T>(items: readonly T[], key: (item: T) => string): Array<{ key: string; count: number }> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const k = key(item);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }

  const rows = [...counts.entries()].map(([k, c]) => ({ key: k, count: c }));
  rows.sort((a, b) => {
    if (a.count !== b.count) return b.count - a.count;
    return a.key.localeCompare(b.key);
  });
  return rows;
}

function stableMetricKey(m: ExtractedMetric): string {
  const valueKey =
    typeof m.value_normalized === "number" ? String(m.value_normalized) : String(m.value_normalized);
  return [m.metric_type, m.unit, valueKey, m.raw_value, m.context].join("|\u0001|");
}

function mergeMetrics(metrics: ExtractedMetric[]): ExtractedMetric[] {
  const byKey = new Map<string, ExtractedMetric>();
  for (const m of metrics) {
    const k = stableMetricKey(m);
    const existing = byKey.get(k);
    if (!existing) {
      byKey.set(k, m);
      continue;
    }

    // Deterministic merge: prefer the highest confidence.
    if ((m.confidence ?? 0) > (existing.confidence ?? 0)) byKey.set(k, m);
  }

  const out = [...byKey.values()];
  out.sort((a, b) => stableMetricKey(a).localeCompare(stableMetricKey(b)));
  return out;
}

function mergeEvidence(snippets: EvidenceSnippet[], max: number): EvidenceSnippet[] {
  const bestBySnippet = new Map<string, EvidenceSnippet>();
  for (const s of snippets) {
    const existing = bestBySnippet.get(s.snippet);
    if (!existing || s.score > existing.score) bestBySnippet.set(s.snippet, s);
  }

  const out = [...bestBySnippet.values()];
  out.sort((a, b) => {
    const sd = b.score - a.score;
    if (sd !== 0) return sd;
    return a.snippet.localeCompare(b.snippet);
  });
  return out.slice(0, max);
}

function bucketOutline(pages: PageUnderstanding[]): DocumentUnderstanding["outline"] {
  const byType = new Map<string, string[]>();
  for (const p of pages) {
    const label = p.page_type;
    const list = byType.get(label) ?? [];
    list.push(p.page_id);
    byType.set(label, list);
  }

  const labels = [...byType.keys()].sort((a, b) => a.localeCompare(b));
  return labels.map((label) => {
    const page_ids = (byType.get(label) ?? []).slice().sort((a, b) => stableCompare(a, b));
    return { label, page_ids };
  });
}

export function buildUnderstandingPatch(
  input: DeterministicUnderstandingInput,
  opts: BuildUnderstandingPatchOptions = {}
): UnderstandingPatch {
  const now = opts.now ?? (() => new Date());
  const created_at = now().toISOString();

  const canonical = buildCanonicalInput(input);
  const input_hash = computeInputHash(canonical);

  const pagesSorted = sortPagesStable(input.pages ?? []);

  const pages: Record<string, PageUnderstanding> = {};
  for (const p of pagesSorted) {
    const raw_ocr_text = p.raw_ocr_text ?? "";
    const norm = normalizeText(raw_ocr_text);
    const classification = classifyPage(norm.normalized_text);

    const key_numbers = extractMetrics(norm.normalized_text);
    const evidence = rankEvidence(norm.normalized_text, classification.page_type);
    const key_entities = extractEntities(norm.normalized_text);

    pages[p.page_id] = {
      page_id: p.page_id,
      document_id: p.document_id,
      ...(typeof p.page_index === "number" ? { page_index: p.page_index } : {}),
      normalized_text: norm.normalized_text,
      normalization_flags: norm.normalization_flags,
      page_type: classification.page_type,
      confidence: classification.confidence,
      why: classification.why,
      evidence,
      key_numbers,
      key_entities,
      quality_flags: [],
    };
  }

  // Documents
  const documents: Record<string, DocumentUnderstanding> = {};
  const documentsSorted = [...(input.documents ?? [])].sort((a, b) => stableCompare(a.document_id, b.document_id));

  for (const d of documentsSorted) {
    const docPages = pagesSorted
      .filter((p) => p.document_id === d.document_id)
      .map((p) => pages[p.page_id])
      .filter(Boolean);

    const allEvidence = docPages.flatMap((p) => p.evidence ?? []);
    const document_key_points = mergeEvidence(allEvidence, 12);
    const key_points = document_key_points.map((e) => e.snippet);

    const allMetrics = docPages.flatMap((p) => p.key_numbers ?? []);
    const key_numbers = mergeMetrics(allMetrics);

    // Rollups for debug/UI (no new inference).
    const top_page_types = countBy(docPages, (p) => p.page_type).map((r) => ({
      page_type: r.key as PageType,
      count: r.count,
    }));

    let currency_count = 0;
    let percent_count = 0;
    let year_count = 0;
    for (const p of docPages) {
      const text = p.normalized_text ?? "";
      const f = computeClassificationFeatures(text);
      currency_count += f.currency_count;
      percent_count += f.percent_count;
      year_count += f.year_count;
    }

    const common_metric_types = countBy(key_numbers, (m) => m.metric_type).map((r) => ({
      metric_type: r.key,
      count: r.count,
    }));

    documents[d.document_id] = {
      document_id: d.document_id,
      ...(typeof d.title === "string" && d.title.length ? { document_title: d.title } : {}),
      document_summary: {
        top_page_types,
        totals: { currency_count, percent_count, year_count },
        common_metric_types,
      },
      document_key_points,
      key_points,
      key_numbers,
      outline: bucketOutline(docPages),
    };
  }

  // Segments (optional)
  const segmentsInput = input.segments ?? [];
  const segmentsSorted = [...segmentsInput].sort((a, b) => stableCompare(a.segment_id, b.segment_id));
  const segments: Record<string, SegmentUnderstanding> = {};

  for (const s of segmentsSorted) {
    const page_ids = [...(s.page_ids ?? [])].sort((a, b) => stableCompare(a, b));
    const segPages = page_ids.map((pid) => pages[pid]).filter(Boolean);

    const allEvidence = segPages.flatMap((p) => p.evidence ?? []);
    const evidence = mergeEvidence(allEvidence, 12);
    const key_points = evidence.map((e) => e.snippet);

    const allMetrics = segPages.flatMap((p) => p.key_numbers ?? []);
    const key_numbers = mergeMetrics(allMetrics);

    const dominant_page_types = countBy(segPages, (p) => p.page_type).map((r) => ({
      page_type: r.key as PageType,
      count: r.count,
    }));
    const common_metric_types = countBy(key_numbers, (m) => m.metric_type).map((r) => ({
      metric_type: r.key,
      count: r.count,
    }));

    segments[s.segment_id] = {
      segment_id: s.segment_id,
      ...(typeof s.label === "string" && s.label.length ? { segment_label: s.label } : {}),
      segment_summary: { dominant_page_types, common_metric_types },
      key_points,
      key_numbers,
      evidence,
    };
  }

  const patch: UnderstandingPatch = {
    analysis_version: "deterministic_understanding_v1",
    created_at,
    input_hash,
    deal_id: input.deal_id,
    pages,
    documents,
    ...(segmentsSorted.length ? { segments } : {}),
  };

  return patch;
}

export function enrichDeterministically(
  input: DeterministicUnderstandingInput,
  opts: BuildUnderstandingPatchOptions = {}
): UnderstandingPatch {
  return buildUnderstandingPatch(input, opts);
}
