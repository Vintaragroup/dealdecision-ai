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
import {
  analyzeSentenceCoherence,
  normalizeCanonicalFact,
  type CanonicalFactKind,
  type CanonicalFactMeta,
} from "./canonical/canonical-fact-normalizer";

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
  text: string | null;
  display_text: string | null;
  quality: TextQuality;
  suppressed_reasons: SuppressReason[];
  sources: DealSummaryCitation[];
};

export type DealSummaryFieldMeta = {
  quality: TextQuality;
  suppressed_reasons: SuppressReason[];
  canonical?: CanonicalFactMeta;
};

export type DealSummaryV1 = {
  version: "deal_summary_v1";
  ready: boolean;
  reason: string | null;
  meta?: {
    one_liner?: DealSummaryFieldMeta;
    product?: DealSummaryFieldMeta;
    market_target?: DealSummaryFieldMeta;
    market_context?: DealSummaryFieldMeta;
    market?: DealSummaryFieldMeta;
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

const MARKET_MAX_LEN = 220;

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

type MarketContextCandidate = {
  raw: string;
  segment_key?: string;
  page_index?: number;
  node_id?: string;
};

function scoreMarketContextCandidateV1(c: MarketContextCandidate): number {
  const raw = normalizeWhitespace(String(c.raw ?? ""));
  if (!raw) return -1000;

  const assessed = assessCandidateText(raw);
  const cleaned = sanitizeForDisplay(raw);
  if (!cleaned) return -1000;

  // Coherence checks are intended to catch OCR/boilerplate junk.
  // For very long context bullets, run coherence on a representative sample so we don't
  // incorrectly reject coherent-but-long text (it can still be selected and later suppressed as `too_long`).
  const sample =
    cleaned.length > 340
      ? truncateForDisplay(cleaned, 320) ?? cleaned.slice(0, 320)
      : cleaned;

  // Prefer missing over selecting junk: if it doesn't look coherent here, it will be suppressed later anyway.
  if (startsWithAnyLoose(sample, FLUFF_PREFIXES)) return -1000;
  if (!meetsMinimumInfo(sample)) return -600;

  const coh = analyzeSentenceCoherence(sample);
  // Avoid picking OCR junk, but don't exclude coherent-looking long context just because
  // the coherence analyzer flags repetition/structure issues in a long sample.
  const isLong = cleaned.length > MARKET_MAX_LEN;
  if (!coh.ok) {
    // Heading-style fragments and non-verbal strings are disproportionately OCR/boilerplate.
    if (coh.reasons.includes('heading_style')) return -800;
    if (!coh.has_verb_like) return -800;
    // For long market-context-like bullets, allow the candidate (it can still be suppressed as `too_long`).
    if (!isLong) return -800;
  }

  // Rank relative quality, but do not disqualify coherent-but-long candidates.
  // (Those should still be selectable and then surfaced as suppressed with `too_long`.)
  let score = 0;
  if (assessed.quality === "good") score += 40;
  else if (assessed.quality === "ok") score += 20;
  if (!assessed.display && !assessed.reasons?.includes("too_long")) score -= 30;

  score += coh.sentence_like ? 35 : 18;
  if (!coh.ok) score -= 12;

  // Strong penalties for OCR-like token shapes.
  const toks = tokenizeLoose(sample).split(" ").filter(Boolean);
  if (toks.length) {
    const singleLetter = toks.filter((t) => t.length === 1 && t !== "a" && t !== "i").length;
    if (singleLetter / toks.length >= 0.2) score -= 25;
  }

  // Heading-style fragments are frequently non-sentential even if they contain real words.
  if (coh.reasons.includes("heading_style")) score -= 20;
  if (!coh.has_verb_like) score -= 10;

  return score;
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
    text: display,
    display_text: display,
    quality: assessed.quality,
    suppressed_reasons: assessed.reasons,
    sources: [buildCitation(node, snippet)],
  };
}

function buildCanonicalLine(node: SegmentedDealNode, rawText: string, kind: CanonicalFactKind): { line: DealSummaryLine; meta: DealSummaryFieldMeta } {
  const sourceTexts = [node.slide_title ?? "", node.bullets_snippet ?? "", rawText]
    .map((s) => normalizeWhitespace(String(s)))
    .filter(Boolean);
  const normalized = normalizeCanonicalFact(rawText, { kind, maxLen: 220, sourceTexts });
  const snippet = normalized.display_text ?? sanitizeForDisplay(rawText);
  return {
    line: {
      text: normalized.display_text,
      display_text: normalized.display_text,
      quality: normalized.quality,
      suppressed_reasons: normalized.suppressed_reasons,
      sources: [buildCitation(node, snippet)],
    },
    meta: {
      quality: normalized.quality,
      suppressed_reasons: normalized.suppressed_reasons,
      canonical: normalized.meta,
    },
  };
}

function appendCanonicalRules(meta: CanonicalFactMeta, extraRules: string[]): CanonicalFactMeta {
  if (!extraRules.length) return meta;
  return {
    ...meta,
    rules_applied: [...extraRules, ...(meta.rules_applied ?? [])],
  };
}

function stripTrailingSentencePunct(s: string): string {
  return normalizeWhitespace(String(s)).replace(/[.!?]+\s*$/, "").trim();
}

function stripLeadingMarketContextLabel(s: string): string {
  return normalizeWhitespace(String(s)).replace(/^(?:market\s+context|context)\s*[:\-–—]\s*/i, "").trim();
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

type Pick = { node: SegmentedDealNode; raw_text: string; assessed: Assessed; extra_rules?: string[] };

function splitSentenceCandidatesMarketContext(input: string): string[] {
  const raw = String(input ?? "");
  if (!raw) return [];

  // First split on newlines, then on sentence punctuation.
  const byNewline = raw
    .split(/\r?\n+/g)
    .map((s) => normalizeWhitespace(s))
    .filter(Boolean);

  const out: string[] = [];
  for (const line of byNewline.length ? byNewline : [normalizeWhitespace(raw)]) {
    for (const part of line.split(/(?<=[.!?])\s+/g)) {
      const cleaned = normalizeWhitespace(part);
      if (!cleaned) continue;
      out.push(cleaned);
    }
  }

  const maybeSplitOnDivider = (s: string, divider: RegExp): string[] => {
    if (!divider.test(s)) return [s];
    const pieces = s.split(divider).map((p) => normalizeWhitespace(p)).filter(Boolean);
    if (pieces.length !== 2) return [s];
    const [a, b] = pieces;
    if (wordCountLoose(a) < 6 || wordCountLoose(b) < 6) return [s];
    return [a, b];
  };

  const refined: string[] = [];
  for (const c of out) {
    const dashSplit = maybeSplitOnDivider(c, /\s*[—–-]\s+/g);
    for (const d of dashSplit) {
      const pipeSplit = maybeSplitOnDivider(d, /\s*\|\s*/g);
      refined.push(...pipeSplit);
    }
  }

  return refined.map((s) => normalizeWhitespace(s)).filter(Boolean);
}

function hasKpiUnitSignal(text: string): boolean {
  const s = String(text ?? "");
  if (!s) return false;
  return (
    /(€|\$|£)\s*\d/.test(s) ||
    /\b\d+(?:\.\d+)?\s*%\b/.test(s) ||
    /\b\d+(?:\.\d+)?\s*(k|m|b|bn|mm|million|billion)\b/i.test(s) ||
    /\b(arr|mrr|gmv|cagr|revenue|runway|burn|margin|cac|ltv)\b/i.test(s)
  );
}

function numericDensityExtreme(text: string): boolean {
  const s = String(text ?? "");
  if (!s) return false;
  const numberHits = (s.match(/\b\d+(?:,\d{3})*(?:\.\d+)?\b/g) ?? []).length;
  const wc = wordCountLoose(s);
  if (wc <= 0) return false;
  return numberHits >= 4 && numberHits / Math.max(1, wc) >= 0.25;
}

function scoreMarketContextClauseCandidate(clause: string): number {
  const s = normalizeWhitespace(clause);
  if (!s) return -100;
  const wc = wordCountLoose(s);
  if (wc < 6) return -50;

  const t = tokenizeLoose(s);
  const verbs = ["is", "are", "driving", "growing", "targeting", "expanding", "monetized"];
  const gtmTerms = ["organic", "content", "referral", "referrals", "partners", "partner", "b2b2c", "retention", "distribution", "channels", "channel"];

  let score = 0;
  if (verbs.some((v) => t.includes(v))) score += 2;
  if (gtmTerms.some((k) => t.includes(k))) score += 2;
  if (wc >= 10) score += 1;

  // Penalize symbol-heavy scraps.
  const assessed = assessCandidateText(s);
  if (assessed.reasons.includes("too_many_symbols")) score -= 2;
  if (assessed.reasons.includes("looks_like_title_dump")) score -= 2;

  // Penalize extreme numeric density without KPI context.
  if (numericDensityExtreme(s) && !hasKpiUnitSignal(s)) score -= 2;

  return score;
}

function mineBestMarketContextClause(input: string): { clause: string | null; appliedRule: string | null } {
  const candidates = splitSentenceCandidatesMarketContext(input);
  let best: { clause: string; score: number } | null = null;
  for (const c of candidates) {
    const cleaned = normalizeWhitespace(stripLeadingMarketContextLabel(c));
    if (!cleaned) continue;
    if (startsWithAnyLoose(cleaned, FLUFF_PREFIXES)) continue;
    if (wordCountLoose(cleaned) < 8) continue;
    const score = scoreMarketContextClauseCandidate(cleaned);
    if (!best || score > best.score) best = { clause: cleaned, score };
  }

  if (!best) return { clause: null, appliedRule: null };
  if (best.score < 2) return { clause: null, appliedRule: null };
  return { clause: best.clause, appliedRule: "market_context_clause_miner_v1" };
}

function separatorPenalty(text: string): number {
  const s = String(text ?? "");
  if (!s) return 0;
  let penalty = 0;
  if (/[|\\]/.test(s)) penalty += 6;
  if (/•/.test(s)) penalty += 4;
  if (/[—–]/.test(s)) penalty += 2;
  if (/(?:\|\s*){4,}/.test(s)) penalty += 8;
  return penalty;
}

function maxTokenRepeatCount(text: string): number {
  const toks = tokenizeLoose(text).split(" ").filter(Boolean);
  const counts = new Map<string, number>();
  for (const tok of toks) counts.set(tok, (counts.get(tok) ?? 0) + 1);
  let max = 0;
  for (const v of counts.values()) max = Math.max(max, v);
  return max;
}

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
  const contextHints = [
    'participation',
    'cagr',
    'growth',
    'growing',
    'tailwinds',
    'market size',
    'tam',
    'sam',
    'som',
    'industry',
    // GTM / growth engine / distribution context often provides the only coherent "context" sentence.
    'go to market',
    'gtm',
    'distribution',
    'partners',
    'partner',
    'organic',
    'content',
    'referral',
    'retention',
    'channels',
    'channel',
    'expanding',
    'driving',
  ];

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
    // Context may live on market OR GTM/distribution/traction pages.
    const base =
      kind === 'context'
        ? Math.max(
            scoreNodeForSegment(n, 'market'),
            scoreNodeForSegment(n, 'go_to_market'),
            scoreNodeForSegment(n, 'distribution'),
            scoreNodeForSegment(n, 'traction')
          )
        : scoreNodeForSegment(n, 'market');
    if (base <= 0) continue;

    const baseRawText =
      (kind === 'context'
        ? candidateTextFromNodeForSegment(n, n.segment_key ?? 'market', 420) ?? candidateTextFromNode(n, 420)
        : candidateTextFromNodeForSegment(n, 'market', 280) ?? candidateTextFromNode(n, 280)) ?? null;
    if (!baseRawText) continue;

    const evidenceText = kind === 'context'
      ? [n.slide_title ?? '', n.bullets_snippet ?? '', ...((Array.isArray(n.bullets) ? n.bullets : []).slice(0, 6)), baseRawText]
          .map((s) => normalizeWhitespace(String(s)))
          .filter(Boolean)
          .join('\n')
      : baseRawText;

    const mined = kind === 'context' ? mineBestMarketContextClause(evidenceText) : { clause: null as string | null, appliedRule: null as string | null };
    const rawText = mined.clause ?? baseRawText;
    if (!rawText) continue;
    const assessed = assessCandidateText(rawText);
    const pick: Pick = { node: n, raw_text: rawText, assessed, extra_rules: mined.appliedRule ? [mined.appliedRule] : undefined };
    const textForChecks = assessed.display ?? rawText;
    const q = rankTextQuality(assessed);

    // Target/context classification should still be attempted on the raw text when suppressed,
    // so callers can differentiate missing vs suppressed.
    if (startsWithAnyLoose(textForChecks, FLUFF_PREFIXES)) continue;
    if (!meetsMinimumInfo(textForChecks)) continue;

    const combined = `${n.slide_title ?? ''}\n${textForChecks}`;
    if (kind === 'target' && !isTargetLike(combined)) continue;
    if (kind === 'context' && !isContextLike(combined)) continue;

    // Hardening: for market_context, prefer missing over selecting incoherent OCR junk.
    // This does not relax the coherence gate; it just avoids choosing candidates that will be suppressed.
    let contextCandidateScore = 0;
    if (kind === 'context') {
      contextCandidateScore = scoreMarketContextCandidateV1({
        raw: textForChecks,
        segment_key: n.segment_key ?? undefined,
        page_index: n.page_index,
        node_id: n.node_id,
      });
      // Only hard-reject strongly negative (very likely OCR/boilerplate junk).
      if (contextCandidateScore <= -200) continue;
    }

    const bump = kind === 'target' ? 10 : 0;
    const seg = n.segment_key;
    const segBoost =
      kind === 'context' && (seg === 'go_to_market' || seg === 'distribution' || seg === 'traction' || seg === 'market')
        ? (seg === 'market' ? 4 : 8)
        : 0;

    // De-prioritize separator-heavy/repetitive/too-short context scraps.
    const sepPenalty = kind === 'context' ? separatorPenalty(evidenceText) : 0;
    const repeatPenalty = kind === 'context' && maxTokenRepeatCount(evidenceText) >= 5 ? 6 : 0;
    const shortPenalty = kind === 'context' && wordCountLoose(textForChecks) < 6 ? 10 : 0;

    const score = base + bump + segBoost + contextCandidateScore - sepPenalty - repeatPenalty - shortPenalty;
    const eligible = !!assessed.display && (assessed.quality === "good" || assessed.quality === "ok");
    if (eligible) {
      if (!bestEligible || score > bestEligible.score || (score === bestEligible.score && q > bestEligible.q)) {
        bestEligible = { pick, score, q };
      }
    } else {
      // For market_context, prefer missing over rejected/junk candidates.
      // Exception: keep coherent-looking *long* context as suppressed, so callers can differentiate
      // missing vs suppressed `too_long` (and composition can still make safe decisions).
      if (kind === 'context') {
        const isPlausiblyTooLong = normalizeWhitespace(textForChecks).length > MARKET_MAX_LEN;
        if (!isPlausiblyTooLong) continue;
      }
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
        if (marketContextPick.extra_rules?.length && built.meta.canonical) {
          meta.market_context = {
            ...built.meta,
            canonical: appendCanonicalRules(built.meta.canonical, marketContextPick.extra_rules),
          };
        } else {
          meta.market_context = built.meta;
        }
        return built.line;
      })()
    : null;

  const market: DealSummaryLine | null = (() => {
    // Spec: do not concatenate garbage.
    // - if target.clean AND context.clean => "${target} (Context: ${context})"
    // - else if target.clean => target
    // - else if context.clean => context
    // - else => null
    const targetTextRaw = typeof market_target?.text === 'string' ? market_target.text : null;
    const contextTextRaw = typeof market_context?.text === 'string' ? market_context.text : null;

    const targetClean = targetTextRaw ? stripTrailingSentencePunct(targetTextRaw) : null;
    const contextClean = contextTextRaw ? stripTrailingSentencePunct(stripLeadingMarketContextLabel(contextTextRaw)) : null;

    const hasTarget = Boolean(targetClean);
    const hasContext = Boolean(contextClean);

    if (!hasTarget && !hasContext) return null;

    const sources: DealSummaryCitation[] = [
      ...(hasTarget ? market_target?.sources ?? [] : []),
      ...(hasContext ? market_context?.sources ?? [] : []),
    ];

    const targetOnly = `${targetClean ?? ''}.`;
    const contextOnly = `${contextClean ?? ''}.`;

    let composed = '';
    let chosenSources: DealSummaryCitation[] = sources;
    const composeRules: string[] = [];

    if (hasTarget && hasContext) {
      const attempted = `${targetClean} (Context: ${contextClean}).`;
      if (attempted.length <= MARKET_MAX_LEN) {
        composed = attempted;
      } else {
        // Too long to safely assess; fall back to a single component.
        composeRules.push('market_compose_fallback_more_coherent_component');

        const targetCoh = analyzeSentenceCoherence(targetOnly);
        const contextCoh = analyzeSentenceCoherence(contextOnly);
        const preferTarget = (targetCoh.ok && !contextCoh.ok) || targetCoh.score >= contextCoh.score;

        const first = preferTarget ? { text: targetOnly, sources: market_target?.sources ?? [] } : { text: contextOnly, sources: market_context?.sources ?? [] };
        const second = preferTarget ? { text: contextOnly, sources: market_context?.sources ?? [] } : { text: targetOnly, sources: market_target?.sources ?? [] };

        if (first.text.length <= MARKET_MAX_LEN) {
          composed = first.text;
          chosenSources = first.sources;
        } else if (second.text.length <= MARKET_MAX_LEN) {
          composed = second.text;
          chosenSources = second.sources;
        } else {
          // Neither component fits; truncate preferred (target first) at a word boundary.
          composeRules.push('market_compose_truncated_to_cap');

          const truncatedFirst = truncateForDisplay(first.text, MARKET_MAX_LEN);
          if (truncatedFirst) {
            composed = truncatedFirst;
            chosenSources = first.sources;
          } else {
            const truncatedSecond = truncateForDisplay(second.text, MARKET_MAX_LEN);
            if (truncatedSecond) {
              composed = truncatedSecond;
              chosenSources = second.sources;
            } else {
              return null;
            }
          }
        }
      }
    } else if (hasTarget) {
      composed = targetOnly;
      chosenSources = market_target?.sources ?? [];
    } else {
      composed = contextOnly;
      chosenSources = market_context?.sources ?? [];
    }

    // If the composed string is short enough but reads like a heading fragment, prefer the more coherent component.
    if (hasTarget && hasContext && composed && composed.length <= MARKET_MAX_LEN) {
      const composedCoh = analyzeSentenceCoherence(composed);
      if (!composedCoh.ok) {
        composeRules.push('market_compose_fallback_more_coherent_component');

        const targetCoh = analyzeSentenceCoherence(targetOnly);
        const contextCoh = analyzeSentenceCoherence(contextOnly);
        const preferTarget = (targetCoh.ok && !contextCoh.ok) || targetCoh.score >= contextCoh.score;

        const preferred = preferTarget ? { text: targetOnly, sources: market_target?.sources ?? [] } : { text: contextOnly, sources: market_context?.sources ?? [] };
        const candidate = preferred.text.length <= MARKET_MAX_LEN ? preferred : null;
        if (candidate) {
          composed = candidate.text;
          chosenSources = candidate.sources;
        }
      }
    }

    // Safety: ensure we never trip the global too_long suppression just from composition.
    if (composed.length > MARKET_MAX_LEN) {
      const clipped = truncateForDisplay(composed, MARKET_MAX_LEN);
      if (!clipped) return null;
      composed = clipped;
      if (!composeRules.includes('market_compose_truncated_to_cap')) composeRules.push('market_compose_truncated_to_cap');
    }

    const sourceTexts = chosenSources
      .flatMap((s) => [s.slide_title ?? '', s.snippet ?? ''])
      .map((s) => normalizeWhitespace(String(s)))
      .filter(Boolean);

    const normalized = normalizeCanonicalFact(composed, { kind: 'market', maxLen: MARKET_MAX_LEN, sourceTexts });
    meta.market = {
      quality: normalized.quality,
      suppressed_reasons: normalized.suppressed_reasons,
      canonical: appendCanonicalRules(normalized.meta, composeRules),
    };

    return {
      text: normalized.display_text,
      display_text: normalized.display_text,
      quality: normalized.quality,
      suppressed_reasons: normalized.suppressed_reasons,
      sources: chosenSources,
    };
  })();

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
