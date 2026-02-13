import type { Pool } from "pg";
import { normalizeAnalystSegment, type AnalystSegment } from "./analyst-segment";
import { getSegmentedNodesForDeal, type SegmentedDealNode } from "./segmented-nodes-for-deal";
import { buildDealSummaryTiers } from "./deal-summary-tiers";
import {
  assessTextQuality,
  sanitizeForDisplay,
  type SuppressReason,
  type TextQuality,
} from "./text-quality";
import { normalizeCanonicalFact, type CanonicalFactKind, type CanonicalFactMeta } from "./canonical/canonical-fact-normalizer";

const normalizeWhitespace = (s: string): string => s.replace(/\s+/g, " ").trim();

const asCleanString = (v: unknown, maxLen: number): string | null => {
  if (typeof v !== "string") return null;
  const s = normalizeWhitespace(v);
  if (!s) return null;
  if (s.length <= maxLen) return s;
  return `${s.slice(0, Math.max(0, maxLen - 1)).trimEnd()}…`;
};

const truncateForDisplay = (text: string, maxLen: number): string | null => {
  const s = normalizeWhitespace(text);
  if (!s) return null;
  if (s.length <= maxLen) return s;
  if (maxLen < 24) return null;

  const head = s.slice(0, Math.max(0, maxLen - 3)).trimEnd();
  const lastSpace = head.lastIndexOf(" ");
  const trimmed = (lastSpace >= Math.floor(maxLen * 0.6) ? head.slice(0, lastSpace) : head).trimEnd();
  if (trimmed.length < 12) return null;
  return `${trimmed}…`;
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
  display_text: string | null;
  quality: TextQuality;
  suppressed_reasons: SuppressReason[];
  sources: DealSummaryCitation[];
};

export type DealSummaryV1 = {
  version: "deal_summary_v1";
  ready: boolean;
  reason: string | null;
  meta?: {
    one_liner?: CanonicalFactMeta;
    product?: CanonicalFactMeta;
    market_target?: CanonicalFactMeta;
    market_context?: CanonicalFactMeta;
    market?: CanonicalFactMeta;
  };
  tiers: {
    hero: string;
    overview: string;
    deep: string;
  };
  one_liner: DealSummaryLine | null;
  product: DealSummaryLine | null;
  market_target: DealSummaryLine | null;
  market_context: DealSummaryLine | null;
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

type Assessed = { quality: TextQuality; reasons: SuppressReason[]; display: string | null };

function assessCandidateText(input: string): Assessed {
  return assessTextQuality(sanitizeForDisplay(input));
}

// Ranking-only: use this to pick between deterministic candidates.
// Suppression semantics still come from assessTextQuality/buildLine.
function rankTextQuality(assessed: Assessed): number {
  let score = 0;

  if (assessed.quality === "good") score += 40;
  else if (assessed.quality === "ok") score += 20;

  if (!assessed.display) score -= 30;

  const d = assessed.display ?? "";
  const wc = wordCountLoose(d);
  if (wc >= 10) score += 6;
  if (wc <= 4) score -= 8;
  if (startsWithAnyLoose(d, FLUFF_PREFIXES)) score -= 10;
  if (!meetsMinimumInfo(d)) score -= 6;

  for (const r of assessed.reasons ?? []) {
    if (r === "boilerplate_marker" || r === "looks_like_footer") score -= 8;
  }

  return score;
}

function buildLine(node: SegmentedDealNode, rawText: string): DealSummaryLine {
  const assessed = assessCandidateText(rawText);
  const display = assessed.display;
  const snippet = display ?? sanitizeForDisplay(rawText);
  return {
    text: display ?? "",
    display_text: display,
    quality: assessed.quality,
    suppressed_reasons: assessed.reasons,
    sources: [buildCitation(node, snippet)],
  };
}

function buildCanonicalLine(node: SegmentedDealNode, rawText: string, kind: CanonicalFactKind): { line: DealSummaryLine; meta: CanonicalFactMeta } {
  const normalized = normalizeCanonicalFact(rawText, { kind, maxLen: 220 });
  const snippet = normalized.display_text ?? sanitizeForDisplay(rawText);
  return {
    line: {
      text: normalized.display_text ?? "",
      display_text: normalized.display_text,
      quality: normalized.quality,
      suppressed_reasons: normalized.suppressed_reasons,
      sources: [buildCitation(node, snippet)],
    },
    meta: normalized.meta,
  };
}

function buildMarketTargetFromText(text: string): string | null {
  const raw = normalizeWhitespace(text);
  if (!raw) return null;
  const t = raw.toLowerCase();

  const hasGolf = /\bgolf\b/.test(t);
  const has1834 = /(18\s*[-–]\s*34)/.test(t) || /(18\s*to\s*34)/.test(t);
  const hasMale = /\bmale\b/.test(t) || /\bmen\b/.test(t) || /\bmens\b/.test(t) || /\bmen(?:'|’)?s\b/.test(t);
  const hasWomen = /\bwomen\b/.test(t) || /\bwomens\b/.test(t) || /\bwomen(?:'|’)?s\b/.test(t) || /\bfemale\b/.test(t);
  const hasYouth = /\byouth\b/.test(t) || /\bjunior\b/.test(t) || /\bgen\s*z\b/.test(t);

  const hasDtc = /\bdtc\b/.test(t) || /direct\s*-?to\s*-?consumer/.test(t) || /e-?commerce/.test(t) || /online\b/.test(t) || /website\b/.test(t);
  const hasWholesale = /\bwholesale\b/.test(t) || /\bretailers?\b/.test(t) || /\bpro\s*shops?\b/.test(t);
  const hasGreenGrass = /green\s*grass/.test(t);
  const hasCourses = /\bcourses?\b/.test(t) || /\bclubs?\b/.test(t);
  const hasRetailers = /\bretailers?\b/.test(t) || /\bstores?\b/.test(t);
  const hasProShops = /\bpro\s*shops?\b/.test(t);

  if (hasGolf && has1834 && hasMale && (hasWomen || hasYouth) && hasDtc && hasWholesale && (hasGreenGrass || hasCourses || hasRetailers || hasProShops)) {
    const buyers: string[] = [];
    if (hasGreenGrass || hasCourses) buyers.push('green grass courses');
    if (hasRetailers) buyers.push('retailers');
    if (hasProShops) buyers.push('pro shops');
    const uniqBuyers = Array.from(new Set(buyers));
    const buyersPhrase = uniqBuyers.length > 0 ? ` (e.g., ${uniqBuyers.join(', ')})` : '';
    return `Target market: core 18–34 male golfer segment, expanding into women and youth; sells via DTC and to wholesale buyers${buyersPhrase}.`;
  }

  return null;
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
  // Return raw title even if it is garbage so callers can produce a suppressed line
  // (display_text null) rather than treating the segment as missing.
  return title;
}

function candidateTextFromNodeForSegment(node: SegmentedDealNode, segment: AnalystSegment, maxLen: number): string | null {
  const bullets = Array.isArray(node.bullets) ? node.bullets : [];

  if (segment === "market" || segment === "product") {
    for (const b of bullets) {
      const s = asCleanString(b, maxLen);
      if (!s) continue;
      if (startsWithAnyLoose(s, FLUFF_PREFIXES)) continue;

      const assessed = assessCandidateText(s);
      if (!(assessed.quality === "good" || assessed.quality === "ok") || !assessed.display) continue;
      if (!meetsMinimumInfo(assessed.display)) continue;
      return assessed.display;
    }
  }

  const raw = candidateTextFromNode(node, maxLen);
  if (!raw) return null;
  const assessed = assessCandidateText(raw);
  if (!(assessed.quality === "good" || assessed.quality === "ok") || !assessed.display) return raw;
  return assessed.display;
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
  const cleaned = sanitizeForDisplay(snippet);
  const assessed = assessTextQuality(cleaned);
  const finalSnippet = assessed.display ?? asCleanString(cleaned, 220) ?? cleaned;
  return {
    source_document_id: node.source_document_id,
    page_index: node.page_index,
    slide_title: node.slide_title,
    snippet: finalSnippet,
    segment_key: node.segment_key,
    node_id: node.node_id,
  };
}

type Pick = { node: SegmentedDealNode; raw_text: string; assessed: Assessed };

function pickBest(nodes: SegmentedDealNode[], segment: AnalystSegment): Pick | null {
  const PRODUCT_VALIDATION_TOKENS = [
    "as seen in",
    "press",
    "media",
    "featured",
    "award",
    "awards",
    "collab",
    "collaboration",
    "partner",
    "partnership",
    "forbes",
    "vogue",
    "gq",
    "golf digest",
  ];

  const hasValidation = (s: string): boolean => {
    const t = tokenizeLoose(s);
    return PRODUCT_VALIDATION_TOKENS.some((k) => t.includes(tokenizeLoose(k)));
  };

  const tryPick = (opts: { disallowValidation: boolean }): Pick | null => {
    let bestEligible: { pick: Pick; score: number; q: number } | null = null;
    let bestRejected: { pick: Pick; score: number; q: number } | null = null;
    for (const n of nodes) {
      const score = scoreNodeForSegment(n, segment);
      if (score <= 0) continue;

      const rawText = candidateTextFromNodeForSegment(n, segment, 280) ?? candidateTextFromNode(n, 280);
      if (!rawText) continue;

      const assessed = assessCandidateText(rawText);
      const pick: Pick = { node: n, raw_text: rawText, assessed };
      const display = assessed.display;
      const isGood = !!display && (assessed.quality === "good" || assessed.quality === "ok");
      const q = rankTextQuality(assessed);

      // Hard filter for fluff/min-info on market/product lines.
      const eligible =
        isGood &&
        (segment !== "market" && segment !== "product"
          ? true
          : !startsWithAnyLoose(display!, FLUFF_PREFIXES) && meetsMinimumInfo(display!));

      // Product definition should not be press/awards/collabs unless we have no alternative.
      if (segment === "product" && opts.disallowValidation && eligible && hasValidation(`${n.slide_title ?? ""}\n${display!}`)) {
        continue;
      }

      if (eligible) {
        if (!bestEligible || score > bestEligible.score || (score === bestEligible.score && q > bestEligible.q)) {
          bestEligible = { pick, score, q };
        }
      } else {
        if (!bestRejected || score > bestRejected.score || (score === bestRejected.score && q > bestRejected.q)) {
          bestRejected = { pick, score, q };
        }
      }
    }
    return bestEligible?.pick ?? bestRejected?.pick ?? null;
  };

  return tryPick({ disallowValidation: true }) ?? tryPick({ disallowValidation: false });
}

function pickBestMarket(nodes: SegmentedDealNode[], kind: 'target' | 'context'): Pick | null {
  const targetHints = ['icp', 'target', 'customer', 'customers', 'segment', 'segments', 'persona', 'buyer', 'age', 'cohort', 'golfers', 'dtc', 'wholesale', 'green grass', 'pro shop', 'retail', 'courses'];
  const contextHints = ['participation', 'cagr', 'growth', 'growing', 'tailwinds', 'market size', 'tam', 'sam', 'som', 'industry'];

  const isTargetLike = (text: string): boolean => {
    const t = tokenizeLoose(text);
    const hasCore = ['icp', 'target', 'customer', 'customers', 'segment', 'segments', 'persona', 'buyer'].some((k) => t.includes(k));
    return hasCore && hasAny(t, targetHints);
  };

  const isContextLike = (text: string): boolean => {
    const t = tokenizeLoose(text);
    if (!hasAny(t, contextHints)) return false;
    // If it reads like ICP, it's not context.
    if (['icp', 'persona', 'buyer', 'segments', 'target customers'].some((k) => t.includes(tokenizeLoose(k)))) return false;
    return true;
  };

  let bestEligible: { pick: Pick; score: number; q: number } | null = null;
  let bestRejected: { pick: Pick; score: number; q: number } | null = null;
  for (const n of nodes) {
    const base = scoreNodeForSegment(n, 'market');
    if (base <= 0) continue;

    const rawText = candidateTextFromNodeForSegment(n, 'market', 280) ?? candidateTextFromNode(n, 280);
    if (!rawText) continue;
    const assessed = assessCandidateText(rawText);
    const pick: Pick = { node: n, raw_text: rawText, assessed };
    const textForChecks = assessed.display ?? rawText;
    const q = rankTextQuality(assessed);

    // Target/context classification should still be attempted on the raw text when suppressed,
    // so callers can differentiate missing vs suppressed.
    if (startsWithAnyLoose(textForChecks, FLUFF_PREFIXES)) continue;
    if (!meetsMinimumInfo(textForChecks)) continue;

    const combined = `${n.slide_title ?? ''}\n${textForChecks}`;
    if (kind === 'target' && !isTargetLike(combined)) continue;
    if (kind === 'context' && !isContextLike(combined)) continue;

    const bump = kind === 'target' ? 10 : 0;
    const score = base + bump;
    const eligible = !!assessed.display && (assessed.quality === "good" || assessed.quality === "ok");
    if (eligible) {
      if (!bestEligible || score > bestEligible.score || (score === bestEligible.score && q > bestEligible.q)) {
        bestEligible = { pick, score, q };
      }
    } else {
      if (!bestRejected || score > bestRejected.score || (score === bestRejected.score && q > bestRejected.q)) {
        bestRejected = { pick, score, q };
      }
    }
  }

  return bestEligible?.pick ?? bestRejected?.pick ?? null;
}

export async function compileDealSummaryV1(pool: Pool, dealId: string, opts?: { includeDebug?: boolean }): Promise<DealSummaryV1> {
  const prefetched = (opts as any)?.prefetched as { nodes: SegmentedDealNode[]; warnings: string[] } | undefined;
  const { nodes, warnings } = prefetched ?? (await getSegmentedNodesForDeal(pool, dealId));

  const productPick = pickBest(nodes, "product");
  const marketTargetPick = pickBestMarket(nodes, 'target') ?? pickBest(nodes, 'market');
  const marketContextPick = pickBestMarket(nodes, 'context');
  const overviewPick = pickBest(nodes, "overview");

  const usedNodeIds: string[] = [];
  const meta: NonNullable<DealSummaryV1['meta']> = {};

  const product: DealSummaryLine | null = productPick
    ? (() => {
        usedNodeIds.push(productPick.node.node_id);
        const built = buildCanonicalLine(productPick.node, productPick.assessed.display ?? productPick.raw_text, 'product');
        meta.product = built.meta;
        return built.line;
      })()
    : null;

  const market_target: DealSummaryLine | null = marketTargetPick
    ? (() => {
        usedNodeIds.push(marketTargetPick.node.node_id);

        const baseDisplay = marketTargetPick.assessed.display;
        const templatedRaw = buildMarketTargetFromText(`${overviewPick?.assessed.display ?? ''}\n${baseDisplay ?? marketTargetPick.raw_text}`);
        const templatedAssessed = templatedRaw ? assessCandidateText(templatedRaw) : null;
        const finalText = templatedAssessed?.display ?? baseDisplay ?? marketTargetPick.raw_text;

        // Prefer templated target if it passes quality gate; otherwise keep original.
        const lineBuilt = buildCanonicalLine(marketTargetPick.node, finalText, 'market_target');
        meta.market_target = lineBuilt.meta;
        // Preserve suppression from original pick if templating is suppressed.
        if (templatedAssessed && !templatedAssessed.display && baseDisplay) {
          const fallbackBuilt = buildCanonicalLine(marketTargetPick.node, baseDisplay, 'market_target');
          meta.market_target = fallbackBuilt.meta;
          return fallbackBuilt.line;
        }
        return lineBuilt.line;
      })()
    : null;

  const market_context: DealSummaryLine | null = marketContextPick
    ? (() => {
        usedNodeIds.push(marketContextPick.node.node_id);
        const built = buildCanonicalLine(marketContextPick.node, marketContextPick.assessed.display ?? marketContextPick.raw_text, 'market_context');
        meta.market_context = built.meta;
        return built.line;
      })()
    : null;

  const market: DealSummaryLine | null = market_target
    ? (() => {
        // If market_target is suppressed, market is suppressed too.
        if (!market_target.display_text) {
          meta.market = meta.market_target;
          return {
            text: "",
            display_text: null,
            quality: market_target.quality,
            suppressed_reasons: market_target.suppressed_reasons,
            sources: [...market_target.sources, ...(market_context?.sources ?? [])],
          };
        }

        const target = market_target.display_text.replace(/\s*\.+\s*$/, "").trim();
        const context = market_context?.display_text ? market_context.display_text.replace(/\s*\.+\s*$/, "").trim() : null;

        let composed = `${target}.`;
        if (context) {
          const prefix = `${composed} Market context: `;
          const suffix = ".";
          const maxContextLen = 220 - prefix.length - suffix.length;
          const clipped = truncateForDisplay(context, maxContextLen);
          if (clipped) {
            const proposal = `${prefix}${clipped}${suffix}`;
            if (proposal.length <= 220) composed = proposal;
          }
        }

        const normalized = normalizeCanonicalFact(composed, { kind: 'market', maxLen: 220 });
        meta.market = normalized.meta;

        return {
          text: normalized.display_text ?? "",
          display_text: normalized.display_text,
          quality: normalized.quality,
          suppressed_reasons: normalized.suppressed_reasons,
          sources: [...market_target.sources, ...(context && market_context?.sources ? market_context.sources : [])],
        };
      })()
    : null;

  const oneLinerPick = overviewPick ?? productPick ?? marketTargetPick ?? marketContextPick;
  const one_liner: DealSummaryLine | null = oneLinerPick
    ? (() => {
        usedNodeIds.push(oneLinerPick.node.node_id);
        const built = buildCanonicalLine(oneLinerPick.node, oneLinerPick.assessed.display ?? oneLinerPick.raw_text, 'one_liner');
        meta.one_liner = built.meta;
        return built.line;
      })()
    : null;

  const paragraphs: DealSummaryLine[] = [];
  if (overviewPick?.node?.bullets?.length) {
    const firstTwo = overviewPick.node.bullets.slice(0, 2).map((b) => asCleanString(b, 420)).filter((v): v is string => Boolean(v));
    for (const p of firstTwo) {
      const assessed = assessCandidateText(p);
      if (!(assessed.quality === "good" || assessed.quality === "ok") || !assessed.display) continue;
      paragraphs.push(buildLine(overviewPick.node, assessed.display));
    }
  }

  const tiers = buildDealSummaryTiers({
    identityText: overviewPick?.assessed.display ?? one_liner?.display_text ?? null,
    productText: product?.display_text ?? null,
    marketText: market_target?.display_text ?? null,
    extraText: [market_context?.display_text ?? null, ...paragraphs.map((p) => p.display_text).filter((v): v is string => Boolean(v))].filter(Boolean).join(" \n "),
  });

  const ready = Boolean(one_liner?.display_text && product?.display_text && market_target?.display_text);
  const reason = ready
    ? null
    : [
        !product ? "missing_product" : product.display_text ? null : "suppressed_product",
        !market_target ? "missing_market_target" : market_target.display_text ? null : "suppressed_market_target",
        !one_liner ? "missing_one_liner" : one_liner.display_text ? null : "suppressed_one_liner",
      ]
        .filter((v): v is string => Boolean(v))
        .join(",");

  const out: DealSummaryV1 = {
    version: "deal_summary_v1",
    ready,
    reason: reason || null,
    meta,
    tiers,
    one_liner,
    product,
    market_target,
    market_context,
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
