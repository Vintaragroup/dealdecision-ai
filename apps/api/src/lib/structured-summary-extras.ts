import type { AnalystSegment } from "./analyst-segment";
import type { SegmentedDealNode } from "./segmented-nodes-for-deal";
import { detectDeckType } from "./reports/deck-type";
import { buildDealSummaryV1, buildMarketSummaryV1, buildProductSummaryV1, type SummaryNodeRef } from "./reports/canonical-summaries";

const normalizeWhitespace = (s: string): string => s.replace(/\s+/g, " ").trim();

const asCleanString = (v: unknown, maxLen: number): string | null => {
  if (typeof v !== "string") return null;
  const s = normalizeWhitespace(v);
  if (!s) return null;
  if (s.length <= maxLen) return s;
  return `${s.slice(0, Math.max(0, maxLen - 1)).trimEnd()}…`;
};

function tokenizeLoose(s: string): string {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9%$]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wordCountLoose(text: string): number {
  const t = tokenizeLoose(text);
  if (!t) return 0;
  return t.split(" ").filter(Boolean).length;
}

function hasConcreteInfoToken(text: string): boolean {
  const raw = String(text);
  if (/%|\$/.test(raw)) return true;
  if (/\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b/.test(raw)) return true;
  if (/\b\d+(?:\.\d+)?\s*(k|m|mm|million|b|bn|billion|x)\b/i.test(raw)) return true;
  const t = tokenizeLoose(raw);
  return ["tam", "sam", "som", "icp", "market", "customers", "accounts", "arr", "mrr", "forecast"].some((k) => t.includes(k));
}

function meetsMinimumInfo(text: string): boolean {
  return wordCountLoose(text) >= 7 || hasConcreteInfoToken(text);
}

const FLUFF_PREFIXES = ["unlock the potential", "thank you", "next steps", "who we are"];

function startsWithAnyLoose(text: string, prefixes: string[]): boolean {
  const t = tokenizeLoose(text);
  return prefixes.some((p) => t === p || t.startsWith(`${p} `));
}

function pickGoodBullet(node: SegmentedDealNode, maxLen = 240): string | null {
  const bullets = Array.isArray(node.bullets) ? node.bullets : [];
  for (const b of bullets) {
    const s = asCleanString(b, maxLen);
    if (!s) continue;
    if (startsWithAnyLoose(s, FLUFF_PREFIXES)) continue;
    if (!meetsMinimumInfo(s)) continue;
    return s;
  }
  const snippet = asCleanString(node.bullets_snippet ?? "", maxLen);
  if (snippet && !startsWithAnyLoose(snippet, FLUFF_PREFIXES) && meetsMinimumInfo(snippet)) return snippet;
  const title = asCleanString(node.slide_title ?? "", Math.min(140, maxLen));
  return title;
}

function scoreNodeForSegment(node: SegmentedDealNode, segment: AnalystSegment): number {
  const effective = node.segment_key;
  if (effective !== segment) return -1;

  let score = 50;

  const title = tokenizeLoose(node.slide_title ?? "");
  const bulletsText = tokenizeLoose(node.bullets.join(" \n "));

  const rulesHit = Array.isArray((node.segment_reason as any)?.rules_hit) ? (node.segment_reason as any).rules_hit : [];
  if (rulesHit.some((r: string) => r.includes("segmenter:title:"))) score += 10;
  if (String((node.segment_reason as any)?.source ?? "") === "deterministic") score += 6;

  const bulletCount = Array.isArray(node.bullets) ? node.bullets.length : 0;
  score += Math.min(10, bulletCount) * 1.2;

  if (segment === "market") {
    if (title.includes("industry outlook")) score += 18;
    if (title.includes("market")) score += 10;
    if (title.includes("opportunity")) score += 6;
    if (node.page_index === 0) score -= 6;
  }

  if (segment === "product") {
    if (title.includes("product")) score += 12;
    if (title.includes("solution")) score += 10;
    if (bulletsText.includes("platform") || bulletsText.includes("workflow") || bulletsText.includes("api")) score += 6;
  }

  if (segment === "go_to_market") {
    if (title.includes("go to market") || title.includes("gtm")) score += 12;
    if (title.includes("marketing") || title.includes("omni")) score += 8;
    if (bulletsText.includes("email") || bulletsText.includes("sms") || bulletsText.includes("retail")) score += 4;
  }

  const picked = pickGoodBullet(node, 240);
  if (!picked) score -= 20;
  else {
    const len = picked.length;
    if (len >= 40 && len <= 220) score += 6;
    if (len < 20) score -= 6;
  }

  return score;
}

function nodeToSource(node: SegmentedDealNode, snippet: string): Record<string, any> {
  return {
    kind: "dpu_node",
    node_id: node.node_id,
    source_document_id: node.source_document_id,
    page_index: node.page_index,
    page: node.page_index + 1,
    slide_title: node.slide_title,
    segment_key: node.segment_key,
    segment_reason: node.segment_reason,
    note_snippet: asCleanString(snippet, 260) ?? snippet,
  };
}

function dedupeSources(sources: Array<Record<string, any>>): Array<Record<string, any>> {
  const seen = new Set<string>();
  const mk = (s: any): string => `${String(s?.kind ?? "")}::${String(s?.source_document_id ?? s?.document_id ?? "")}::${String(s?.page_index ?? "")}::${String(s?.node_id ?? "")}`;
  const out: Array<Record<string, any>> = [];
  for (const s of sources) {
    const k = mk(s);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

function findNodeByPageIndex(nodes: SegmentedDealNode[], pageIndex: number): SegmentedDealNode | null {
  for (const n of nodes ?? []) {
    if (!n) continue;
    if (typeof n.page_index !== 'number') continue;
    if (n.page_index === pageIndex) return n;
  }
  return null;
}

function refsToSources(nodes: SegmentedDealNode[], refs: SummaryNodeRef[]): Array<Record<string, any>> {
  const out: Array<Record<string, any>> = [];
  for (const r of Array.isArray(refs) ? refs : []) {
    const n = findNodeByPageIndex(nodes, r.page_index);
    if (!n) continue;
    const snippet = typeof r.note_snippet === 'string' && r.note_snippet.trim() ? r.note_snippet.trim() : (asCleanString(n.bullets_snippet ?? '', 220) ?? '');
    out.push(nodeToSource(n, snippet));
  }
  return dedupeSources(out);
}

function buildSummaryFromNodes(nodes: SegmentedDealNode[], segment: AnalystSegment): { value: string | null; confidence: number; sources: Array<Record<string, any>> } {
  const candidates = nodes
    .slice()
    .map((n) => ({ node: n, score: scoreNodeForSegment(n, segment) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  const chosen: Array<{ node: SegmentedDealNode; snippet: string }> = [];
  for (const c of candidates) {
    if (chosen.length >= 3) break;
    const snippet = pickGoodBullet(c.node, 240);
    if (!snippet) continue;
    chosen.push({ node: c.node, snippet });
  }

  const value = chosen.length > 0 ? chosen.map((x) => x.snippet.replace(/\s*\.$/, ".")).join(" ") : null;
  const sources = chosen.map((x) => nodeToSource(x.node, x.snippet));

  const confidence = chosen.length === 0 ? 0 : chosen.length === 1 ? 0.66 : chosen.length === 2 ? 0.73 : 0.78;
  return { value, confidence, sources };
}

export function compileStructuredSummaryExtras(input: {
  nodes: SegmentedDealNode[];
  structured_summary: any;
}): {
  deck_type: string;
  deal_summary_v1: any | null;
  product_summary_v1: any | null;
  market_summary_v1: any | null;
  market_summary: { value: string | null; confidence: number; sources: Array<Record<string, any>> };
  product_summary: { value: string | null; confidence: number; sources: Array<Record<string, any>> };
  gtm_summary: { value: string | null; confidence: number; sources: Array<Record<string, any>> };
  deal_summary: { value: string | null; confidence: number; sources: Array<Record<string, any>> };
} {
  const nodes = Array.isArray(input.nodes) ? input.nodes : [];
  const structured = input.structured_summary ?? {};

  const deck_type = detectDeckType(nodes as any);

  // Balance-sheet product-page guard.
  // A page tagged segment_key="product" by the visual classifier may contain balance-sheet
  // liability-table data from a misclassified SEC exhibit (e.g. EX-99.5 pro-forma financials).
  // Such pages must not enter the product or market summary builders because their content
  // is financial tabular data, not narrative product descriptions.
  // This mirrors the identical guard in apps/api/src/routes/understanding.ts (BALANCE_SHEET_PAGE_RE).
  const BALANCE_SHEET_PAGE_RE = /\b(?:term loan\b|net of discounts?|total liabilities|convertible notes? payable\b|derivative warrant|lease liabilities)/i;
  const narrativeNodes = (nodes as any[]).filter((n: any) => {
    const seg = String(n.segment_key ?? '').trim().toLowerCase();
    if (seg !== 'product') return true; // only filter product-tagged pages
    const body = [
      ...(Array.isArray(n.bullets) ? n.bullets : []),
      typeof n.bullets_snippet === 'string' ? n.bullets_snippet : '',
    ].join(' ');
    return !BALANCE_SHEET_PAGE_RE.test(body);
  });

  // Canonical deterministic syntheses (node-first, claim-gated).
  // These are the preferred outputs for dashboard inspector traceability.
  const deal_summary_v1_raw = buildDealSummaryV1({ nodes: narrativeNodes as any, structured_summary: structured });
  const product_summary_v1_raw = buildProductSummaryV1(narrativeNodes as any);
  const market_summary_v1_raw = buildMarketSummaryV1(narrativeNodes as any);

  // Browser-friendly contract: include `sources[]` on v1 sections.
  // The dashboard UI can render `supporting_nodes`, while consumers expecting legacy `sources`
  // can rely on a stable `{document_id, page_index, slide_title, snippet}` style array.
  const deal_summary_v1 = deal_summary_v1_raw
    ? { ...deal_summary_v1_raw, sources: deal_summary_v1_raw.supporting_nodes ? refsToSources(nodes, deal_summary_v1_raw.supporting_nodes) : [] }
    : null;
  const product_summary_v1 = product_summary_v1_raw
    ? { ...product_summary_v1_raw, sources: product_summary_v1_raw.supporting_nodes ? refsToSources(nodes, product_summary_v1_raw.supporting_nodes) : [] }
    : null;
  const market_summary_v1 = market_summary_v1_raw
    ? { ...market_summary_v1_raw, sources: market_summary_v1_raw.supporting_nodes ? refsToSources(nodes, market_summary_v1_raw.supporting_nodes) : [] }
    : null;

  // Backward-compatible keys (but now sourced from canonical v1 syntheses).
  const market_summary = {
    value: market_summary_v1?.value ?? null,
    confidence: typeof market_summary_v1?.confidence === 'number' ? market_summary_v1.confidence : 0,
    sources: Array.isArray(market_summary_v1?.sources) ? market_summary_v1.sources : (market_summary_v1?.supporting_nodes ? refsToSources(nodes, market_summary_v1.supporting_nodes) : []),
  };

  const product_summary = {
    value: product_summary_v1?.value ?? null,
    confidence: typeof product_summary_v1?.confidence === 'number' ? product_summary_v1.confidence : 0,
    sources: Array.isArray(product_summary_v1?.sources) ? product_summary_v1.sources : (product_summary_v1?.supporting_nodes ? refsToSources(nodes, product_summary_v1.supporting_nodes) : []),
  };

  // GTM summary remains informational (not part of Prompt 7 hardening scope).
  const gtm_summary = buildSummaryFromNodes(nodes, "go_to_market");

  const deal_summary = {
    value: deal_summary_v1?.value ?? null,
    confidence: typeof deal_summary_v1?.confidence === 'number' ? deal_summary_v1.confidence : 0,
    sources: Array.isArray(deal_summary_v1?.sources) ? deal_summary_v1.sources : (deal_summary_v1?.supporting_nodes ? refsToSources(nodes, deal_summary_v1.supporting_nodes) : []),
  };

  return {
    deck_type,
    deal_summary_v1,
    product_summary_v1,
    market_summary_v1,
    market_summary,
    product_summary,
    gtm_summary,
    deal_summary,
  };
}
