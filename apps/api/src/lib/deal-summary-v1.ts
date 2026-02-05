import type { Pool } from "pg";
import { normalizeAnalystSegment, type AnalystSegment } from "./analyst-segment";
import { getSegmentedNodesForDeal, type SegmentedDealNode } from "./segmented-nodes-for-deal";

const normalizeWhitespace = (s: string): string => s.replace(/\s+/g, " ").trim();

const asCleanString = (v: unknown, maxLen: number): string | null => {
  if (typeof v !== "string") return null;
  const s = normalizeWhitespace(v);
  if (!s) return null;
  if (s.length <= maxLen) return s;
  return `${s.slice(0, Math.max(0, maxLen - 1)).trimEnd()}…`;
};

export type DealSummaryCitation = {
  source_document_id: string;
  page_index: number;
  slide_title: string | null;
  snippet: string;
  segment_key: AnalystSegment | null;
  node_id: string;
};

export type DealSummaryLine = {
  text: string;
  sources: DealSummaryCitation[];
};

export type DealSummaryV1 = {
  version: "deal_summary_v1";
  ready: boolean;
  reason: string | null;
  one_liner: DealSummaryLine | null;
  product: DealSummaryLine | null;
  market: DealSummaryLine | null;
  paragraphs: DealSummaryLine[];
  warnings: string[];
  debug?: {
    used_node_ids: string[];
  };
};

function tokenizeLoose(s: string): string {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9%$]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasAny(text: string, keywords: string[]): boolean {
  const t = tokenizeLoose(text);
  return keywords.some((k) => t.includes(k));
}

const FLUFF_PREFIXES = ["unlock the potential", "thank you", "next steps", "who we are"];

function startsWithAnyLoose(text: string, prefixes: string[]): boolean {
  const t = tokenizeLoose(text);
  return prefixes.some((p) => t === p || t.startsWith(`${p} `));
}

function wordCountLoose(text: string): number {
  const t = tokenizeLoose(text);
  if (!t) return 0;
  return t.split(" ").filter(Boolean).length;
}

function hasConcreteInfoToken(text: string): boolean {
  const raw = String(text);
  if (/%|\$/.test(raw)) return true;
  if (/\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b/.test(raw)) return true; // 1,000 / 12,345.67
  if (/\b\d+(?:\.\d+)?\s*(k|m|mm|million|b|bn|billion|x)\b/i.test(raw)) return true; // 12M, 3.2x, 5bn
  const t = tokenizeLoose(raw);
  return ["tam", "sam", "som", "players", "participation", "segment", "segments", "age", "cohort", "icp", "market"].some((k) => t.includes(k));
}

function meetsMinimumInfo(text: string): boolean {
  return wordCountLoose(text) >= 7 || hasConcreteInfoToken(text);
}

function inferSegmentFromNode(node: SegmentedDealNode): AnalystSegment | null {
  const title = node.slide_title ?? "";
  const body = node.bullets.join(" \n ");
  const all = `${title}\n${body}`;
  const t = tokenizeLoose(all);

  // Strong market signals
  if (hasAny(t, ["tam", "sam", "som"])) return "market";
  if (hasAny(t, ["market", "target", "icp", "customers", "customer segments", "segment", "buyer", "persona", "industry"])) {
    // Avoid team/about pages being misclassified as market
    if (hasAny(t, ["team", "founder", "advis", "leadership"])) return null;
    return "market";
  }

  // Strong product signals
  if (hasAny(t, ["product", "solution", "platform", "how it works", "features", "workflow", "api", "technology"])) {
    if (hasAny(t, ["team", "founder", "advis", "leadership"])) return null;
    return "product";
  }

  // Overview-style
  if (hasAny(t, ["overview", "company", "who we are", "about", "mission"])) return "overview";

  return null;
}

function candidateTextFromNode(node: SegmentedDealNode, maxLen: number): string | null {
  // Prefer first bullet, otherwise fall back to bullets_snippet or title.
  const bullets = Array.isArray(node.bullets) ? node.bullets : [];
  const firstBullet = bullets.length > 0 ? asCleanString(bullets[0], maxLen) : null;
  if (firstBullet) return firstBullet;
  const snippet = asCleanString(node.bullets_snippet ?? "", maxLen);
  if (snippet) return snippet;
  const title = asCleanString(node.slide_title ?? "", Math.min(120, maxLen));
  if (title) return title;
  return null;
}

function candidateTextFromNodeForSegment(node: SegmentedDealNode, segment: AnalystSegment, maxLen: number): string | null {
  const bullets = Array.isArray(node.bullets) ? node.bullets : [];

  if (segment === "market" || segment === "product") {
    for (const b of bullets) {
      const s = asCleanString(b, maxLen);
      if (!s) continue;
      if (startsWithAnyLoose(s, FLUFF_PREFIXES)) continue;
      if (!meetsMinimumInfo(s)) continue;
      return s;
    }
  }

  return candidateTextFromNode(node, maxLen);
}

function scoreNodeForSegment(node: SegmentedDealNode, segment: AnalystSegment): number {
  let score = 0;

  const effective = node.segment_key;
  if (effective === segment) score += 50;

  const inferred = inferSegmentFromNode(node);
  if (!effective && inferred === segment) score += 30;

  const title = tokenizeLoose(node.slide_title ?? "");
  const bullets = tokenizeLoose(node.bullets.join(" \n "));

  if (segment === "product") {
    if (title.includes("product") || title.includes("solution")) score += 12;
    if (hasAny(bullets, ["platform", "product", "solution", "api", "workflow", "automate"])) score += 8;
  }

  if (segment === "market") {
    if (title.includes("market") || title.includes("icp") || title.includes("customers")) score += 12;
    if (hasAny(bullets, ["tam", "sam", "som", "market", "icp", "target", "customers"])) score += 10;

    // Prefer informative market framing over generic opportunity/cover slides.
    if (title.includes("industry outlook")) score += 18;
    if (title.includes("palm is poised")) score += 18;
    if (title.includes("opportunity")) score -= 8;
    if (node.page_index === 0) score -= 10;
  }

  if (segment === "overview") {
    if (title.includes("overview") || title.includes("company") || title.includes("about")) score += 12;
    if (hasAny(bullets, ["we", "company", "mission", "platform", "helps", "enables"])) score += 6;
  }

  const text = candidateTextFromNode(node, 280);
  if (text) {
    const len = text.length;
    if (len >= 40 && len <= 220) score += 6;
    if (len > 220) score += 2;
    if (len < 20) score -= 6;
  } else {
    score -= 20;
  }

  // Avoid common cross-contamination.
  if (hasAny(`${title}\n${bullets}`, ["team", "advisors", "leadership", "equipment"])) score -= 20;

  return score;
}

function buildCitation(node: SegmentedDealNode, snippet: string): DealSummaryCitation {
  return {
    source_document_id: node.source_document_id,
    page_index: node.page_index,
    slide_title: node.slide_title,
    snippet: asCleanString(snippet, 220) ?? snippet,
    segment_key: node.segment_key,
    node_id: node.node_id,
  };
}

function pickBest(nodes: SegmentedDealNode[], segment: AnalystSegment): { node: SegmentedDealNode; text: string } | null {
  let best: { node: SegmentedDealNode; text: string; score: number } | null = null;
  for (const n of nodes) {
    const score = scoreNodeForSegment(n, segment);
    if (score <= 0) continue;
    const text = candidateTextFromNodeForSegment(n, segment, 280);
    if (!text) continue;

    // Hard filter for fluff/min-info on market/product lines.
    if ((segment === "market" || segment === "product") && startsWithAnyLoose(text, FLUFF_PREFIXES)) continue;
    if ((segment === "market" || segment === "product") && !meetsMinimumInfo(text)) continue;

    if (!best || score > best.score) {
      best = { node: n, text, score };
    }
  }
  return best ? { node: best.node, text: best.text } : null;
}

export async function compileDealSummaryV1(pool: Pool, dealId: string, opts?: { includeDebug?: boolean }): Promise<DealSummaryV1> {
  const prefetched = (opts as any)?.prefetched as { nodes: SegmentedDealNode[]; warnings: string[] } | undefined;
  const { nodes, warnings } = prefetched ?? (await getSegmentedNodesForDeal(pool, dealId));

  const productPick = pickBest(nodes, "product");
  const marketPick = pickBest(nodes, "market");
  const overviewPick = pickBest(nodes, "overview");

  const usedNodeIds: string[] = [];

  const product: DealSummaryLine | null = productPick
    ? (() => {
        usedNodeIds.push(productPick.node.node_id);
        return {
          text: productPick.text,
          sources: [buildCitation(productPick.node, productPick.text)],
        };
      })()
    : null;

  const market: DealSummaryLine | null = marketPick
    ? (() => {
        usedNodeIds.push(marketPick.node.node_id);
        return {
          text: marketPick.text,
          sources: [buildCitation(marketPick.node, marketPick.text)],
        };
      })()
    : null;

  const oneLinerPick = overviewPick ?? productPick ?? marketPick;
  const one_liner: DealSummaryLine | null = oneLinerPick
    ? (() => {
        usedNodeIds.push(oneLinerPick.node.node_id);
        return {
          text: oneLinerPick.text,
          sources: [buildCitation(oneLinerPick.node, oneLinerPick.text)],
        };
      })()
    : null;

  const paragraphs: DealSummaryLine[] = [];
  if (overviewPick?.node?.bullets?.length) {
    const firstTwo = overviewPick.node.bullets.slice(0, 2).map((b) => asCleanString(b, 420)).filter((v): v is string => Boolean(v));
    for (const p of firstTwo) {
      paragraphs.push({
        text: p,
        sources: [buildCitation(overviewPick.node, p)],
      });
    }
  }

  const ready = Boolean(one_liner && product && market);
  const reason = ready
    ? null
    : [
        !product ? "missing_product" : null,
        !market ? "missing_market" : null,
        !one_liner ? "missing_one_liner" : null,
      ]
        .filter((v): v is string => Boolean(v))
        .join(",");

  const out: DealSummaryV1 = {
    version: "deal_summary_v1",
    ready,
    reason: reason || null,
    one_liner,
    product,
    market,
    paragraphs,
    warnings: warnings ?? [],
  };

  if (opts?.includeDebug) {
    out.debug = {
      used_node_ids: Array.from(new Set(usedNodeIds)),
    };
  }

  return out;
}
