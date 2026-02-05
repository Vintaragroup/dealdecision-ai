import { detectDeckType, type DeckType } from './deck-type';
import type { SummaryClaimType } from './summary-claims';

export type SummaryNodeRef = {
  page_index: number;
  slide_title: string | null;
  segment_key: string | null;
  reason?: any;
  note_snippet?: string | null;
};

type ExcludedNode = {
  page_index: number;
  slide_title: string | null;
  segment_key: string | null;
  exclusion_reason: string;
};

export type DealSummaryV1Section = {
  value: string;
  confidence: number;
  claims: SummaryClaimType[];
  derived_from: {
    product_pages: number[];
    traction_pages: number[];
    market_pages?: number[];
  };
  supporting_nodes: SummaryNodeRef[];
  debug?: {
    deck_type: DeckType;
    excluded_nodes: ExcludedNode[];
  };
};

export type ProductSummaryV1Section = {
  value: string;
  confidence: number;
  claims: SummaryClaimType[];
  derived_from: {
    product_pages: number[];
    traction_pages?: number[];
  };
  supporting_nodes: SummaryNodeRef[];
  debug?: {
    deck_type: DeckType;
    excluded_nodes: ExcludedNode[];
  };
};

export type MarketSummaryV1Section = {
  value: string;
  confidence: number;
  claims: SummaryClaimType[];
  derived_from: {
    market_pages: number[];
    industry_pages: number[];
    opportunity_pages: number[];
  };
  supporting_nodes: SummaryNodeRef[];
  debug?: {
    deck_type: DeckType;
    non_market_centric: boolean;
    excluded_nodes: ExcludedNode[];
  };
};

type NodeLike = {
  page_index: number;
  slide_title: string | null;
  bullets: string[];
  segment_key: string | null;
  segment_reason: any;
  source_document_id: string;
};

const normalizeWhitespace = (s: string): string => String(s).replace(/\s+/g, ' ').trim();
const asNonEmptyString = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

const uniqSorted = (xs: number[]): number[] => Array.from(new Set(xs)).sort((a, b) => a - b);

function normSeg(s: unknown): string {
  const t = String(s ?? '').trim().toLowerCase();
  if (!t) return '';
  if (t === 'gtm') return 'go_to_market';
  if (t === 'market_size') return 'market';
  return t;
}

function tokenizeLoose(s: string): string {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9%$]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function containsAny(text: string, needles: string[]): boolean {
  const t = tokenizeLoose(text);
  return needles.some((n) => t.includes(n));
}

function joinText(node: NodeLike): string {
  const title = (node.slide_title ?? '').trim();
  const bullets = Array.isArray(node.bullets) ? node.bullets.join(' ') : '';
  return normalizeWhitespace(`${title} ${bullets}`);
}

function bestBullet(
  node: NodeLike,
  opts?: { maxLen?: number; allowNumbers?: boolean; bannedTokens?: string[]; requiredTokens?: string[] }
): string | null {
  const maxLen = opts?.maxLen ?? 240;
  const allowNumbers = opts?.allowNumbers ?? true;
  const banned = Array.isArray(opts?.bannedTokens) ? opts!.bannedTokens!.map((s) => tokenizeLoose(s)) : [];
  const required = Array.isArray(opts?.requiredTokens) ? opts!.requiredTokens!.map((s) => tokenizeLoose(s)).filter(Boolean) : [];

  const bullets = Array.isArray(node.bullets) ? node.bullets : [];
  for (const b of bullets) {
    const s = asNonEmptyString(b);
    if (!s) continue;
    const cleaned = normalizeWhitespace(s);
    if (cleaned.length < 12) continue;
    if (cleaned.length > maxLen) continue;
    const t = tokenizeLoose(cleaned);
    if (!allowNumbers && /\b\d/.test(cleaned)) continue;
    if (banned.some((bt) => bt && t.includes(bt))) continue;
    if (required.length > 0 && !required.some((rt) => rt && t.includes(rt))) continue;
    return cleaned;
  }

  const title = asNonEmptyString(node.slide_title);
  if (title) {
    const cleaned = normalizeWhitespace(title);
    if (cleaned.length <= Math.min(140, maxLen)) return cleaned;
  }

  return null;
}

function toNodeRef(node: NodeLike, note: string | null, reason: any): SummaryNodeRef {
  return {
    page_index: node.page_index,
    slide_title: node.slide_title ?? null,
    segment_key: node.segment_key ?? null,
    note_snippet: note ?? null,
    reason,
  };
}

function extractCoreIdentityFromBusinessModelSummary(value: string): string | null {
  const s = normalizeWhitespace(value);
  if (!s) return null;
  const lower = s.toLowerCase();
  const idx = lower.indexOf(' selling ');
  if (idx > 0) return s.slice(0, idx).trim();
  const idx2 = lower.indexOf(' that ');
  if (idx2 > 0) return s.slice(0, idx2).trim();
  const idx3 = lower.indexOf(' with ');
  if (idx3 > 0 && idx3 <= 64) return s.slice(0, idx3).trim();
  return s;
}

function inferProductCategoryAndFormFactor(text: string): { category: string | null; form: 'physical' | 'digital' | 'service' | null; tags: string[] } {
  const t = tokenizeLoose(text);

  const tags: string[] = [];
  const hasGolf = t.includes('golf');
  const apparel = containsAny(t, ['apparel', 'clothing', 'outerwear', 'shirts', 'shorts', 'pants', 'hoodie', 'jacket']);
  const gloves = containsAny(t, ['glove', 'gloves']);
  const accessories = containsAny(t, ['accessory', 'accessories', 'hat', 'caps', 'belt', 'bag', 'socks']);
  const footwear = containsAny(t, ['footwear', 'shoes', 'sneaker', 'boot']);
  const software = containsAny(t, ['software', 'saas', 'platform', 'api', 'subscription', 'cloud']);
  const marketplace = containsAny(t, ['marketplace']);
  const service = containsAny(t, ['service', 'services', 'consulting', 'managed']);

  if (hasGolf) tags.push('golf');
  if (apparel) tags.push('apparel');
  if (gloves) tags.push('gloves');
  if (accessories) tags.push('accessories');
  if (footwear) tags.push('footwear');
  if (software) tags.push('software');
  if (marketplace) tags.push('marketplace');
  if (service) tags.push('service');

  const form = software || marketplace ? 'digital' : service ? 'service' : apparel || gloves || accessories || footwear ? 'physical' : null;

  if (software && marketplace) return { category: 'Marketplace platform', form, tags };
  if (software) return { category: 'Software platform', form, tags };
  if (hasGolf && apparel) return { category: 'Golf apparel', form, tags };
  if (apparel && (gloves || accessories)) return { category: 'Apparel and accessories', form, tags };
  if (apparel) return { category: 'Apparel', form, tags };
  if (gloves && accessories) return { category: 'Gloves and accessories', form, tags };
  if (gloves) return { category: 'Gloves', form, tags };
  if (accessories) return { category: 'Accessories', form, tags };
  if (footwear) return { category: 'Footwear', form, tags };
  if (service) return { category: 'Services', form, tags };
  return { category: null, form, tags };
}

function scoreNode(node: NodeLike, opts: { segment: string; preferTitleTokens?: string[]; preferBodyTokens?: string[]; penalizeTokens?: string[] }): number {
  const seg = normSeg(node.segment_key);
  if (seg !== opts.segment) return -1;

  let score = 50;
  const title = tokenizeLoose(node.slide_title ?? '');
  const body = tokenizeLoose(node.bullets.join(' \n '));

  if (Array.isArray(opts.preferTitleTokens)) {
    for (const k of opts.preferTitleTokens) if (k && title.includes(tokenizeLoose(k))) score += 8;
  }
  if (Array.isArray(opts.preferBodyTokens)) {
    for (const k of opts.preferBodyTokens) if (k && body.includes(tokenizeLoose(k))) score += 6;
  }
  if (Array.isArray(opts.penalizeTokens)) {
    for (const k of opts.penalizeTokens) if (k && (title.includes(tokenizeLoose(k)) || body.includes(tokenizeLoose(k)))) score -= 12;
  }

  const picked = bestBullet(node, { maxLen: 260 });
  if (picked) {
    if (picked.length >= 40 && picked.length <= 220) score += 6;
    if (picked.length < 20) score -= 6;
  } else {
    score -= 25;
  }

  return score;
}

function pickTopNodes(nodes: NodeLike[], opts: Parameters<typeof scoreNode>[1] & { limit: number; bulletOpts?: Parameters<typeof bestBullet>[1] }): Array<{ node: NodeLike; snippet: string; score: number }> {
  const bulletOpts = opts.bulletOpts;
  const scored = (nodes ?? [])
    .map((n) => ({ node: n, score: scoreNode(n, opts) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.node.page_index - b.node.page_index);

  const out: Array<{ node: NodeLike; snippet: string; score: number }> = [];
  for (const x of scored) {
    if (out.length >= opts.limit) break;
    const snip = bestBullet(x.node, bulletOpts);
    if (!snip) continue;
    out.push({ node: x.node, snippet: snip, score: x.score });
  }
  return out;
}

export function buildProductSummaryV1(nodes: NodeLike[]): ProductSummaryV1Section | null {
  const deckType = detectDeckType(nodes);

  const excluded: ExcludedNode[] = [];

  const productNodes = (nodes ?? []).filter((n) => normSeg(n.segment_key) === 'product');
  if (productNodes.length === 0) return null;

  const banned = ['tam', 'sam', 'som', 'cagr', 'market size', 'growth', 'revenue', 'arr', 'mrr'];

  const picked = pickTopNodes(nodes, {
    segment: 'product',
    limit: 3,
    preferTitleTokens: ['product', 'solution'],
    preferBodyTokens: ['apparel', 'glove', 'accessories', 'platform', 'software'],
    penalizeTokens: ['tam', 'sam', 'som', 'cagr', 'market size'],
    bulletOpts: { maxLen: 260, bannedTokens: banned },
  });

  // Track exclusions (product-only) for inspector.
  for (const n of productNodes) {
    const s = bestBullet(n, { maxLen: 260, bannedTokens: banned });
    if (!s) {
      excluded.push({ page_index: n.page_index, slide_title: n.slide_title ?? null, segment_key: n.segment_key ?? null, exclusion_reason: 'no_product_snippet' });
      continue;
    }
    const t = tokenizeLoose(s);
    if (banned.some((k) => t.includes(tokenizeLoose(k)))) {
      excluded.push({ page_index: n.page_index, slide_title: n.slide_title ?? null, segment_key: n.segment_key ?? null, exclusion_reason: 'banned_market_or_growth_tokens' });
      continue;
    }
  }

  if (picked.length === 0) return null;

  const joined = picked.map((p) => joinText(p.node)).join(' \n ');
  const { category, form, tags } = inferProductCategoryAndFormFactor(joined);

  const rollupHint = deckType === 'rollup' || containsAny(joined, ['acquisition', 'acquisitions', 'buy and build', 'roll-up', 'rollup', 'portfolio']);

  const core = (() => {
    if (rollupHint) return 'Roll-up strategy across multiple operating businesses';
    if (category && form) return `${category} (${form})`;
    if (category) return category;
    if (form) return `${form} product`;
    return null;
  })();

  if (!core) return null;

  const itemMentions: string[] = [];
  if (tags.includes('apparel')) itemMentions.push('apparel');
  if (tags.includes('gloves')) itemMentions.push('gloves');
  if (tags.includes('accessories')) itemMentions.push('accessories');
  if (tags.includes('software')) itemMentions.push('software');

  const detail = (() => {
    if (rollupHint) {
      // Try to list up to 3 named entities from product bullets in a deterministic way.
      const names: string[] = [];
      for (const p of picked) {
        for (const b of p.node.bullets ?? []) {
          const raw = asNonEmptyString(b);
          if (!raw) continue;
          const matches = raw.match(/\b[A-Z][A-Za-z0-9&.-]{2,}\b/g) ?? [];
          for (const m of matches) {
            if (names.length >= 3) break;
            if (m.toLowerCase() === 'golf') continue;
            if (m.toLowerCase() === 'dtc') continue;
            if (!names.includes(m)) names.push(m);
          }
          if (names.length >= 3) break;
        }
        if (names.length >= 3) break;
      }
      return names.length > 0 ? `Includes ${names.join(', ')}.` : null;
    }

    if (itemMentions.length >= 2) return `Includes ${itemMentions.join(', ')}.`;
    if (itemMentions.length === 1) return `Includes ${itemMentions[0]}.`;

    // Fall back to a short product bullet for specificity.
    const first = picked[0]?.snippet;
    return first ? `${first.replace(/\s*\.$/, '')}.` : null;
  })();

  const sentences: Array<{ text: string; claim: SummaryClaimType }> = [];
  sentences.push({ text: `Product: ${core}.`, claim: 'solution_statement' });
  if (detail) sentences.push({ text: detail.endsWith('.') ? detail : `${detail}.`, claim: 'what_it_sells' });

  const value = sentences.map((s) => normalizeWhitespace(s.text)).join(' ');

  const productPages = uniqSorted(picked.map((p) => p.node.page_index));
  const supporting_nodes = picked
    .slice(0, 6)
    .map((p, idx) => toNodeRef(p.node, p.snippet, { rank: idx + 1, claim_type: idx === 0 ? 'solution_statement' : 'what_it_sells' }));

  // Traction confirmation adds confidence, but traction never supplies the product noun phrase.
  const tractionPick = pickTopNodes(nodes, {
    segment: 'traction',
    limit: 1,
    preferTitleTokens: ['traction', 'customers'],
    preferBodyTokens: ['customers', 'accounts', 'adoption', 'repeat', 'conversion'],
    penalizeTokens: ['tam', 'sam', 'som'],
    bulletOpts: { maxLen: 200 },
  });

  const tractionConfirm = tractionPick.length > 0;
  if (tractionConfirm) {
    supporting_nodes.push(toNodeRef(tractionPick[0].node, tractionPick[0].snippet, { rank: supporting_nodes.length + 1, claim_type: 'why_it_wins', role: 'supporting' }));
  }

  const base = productPages.length >= 2 ? 0.75 : 0.6;
  let confidence = base;
  if (tractionConfirm) confidence += 0.1;
  confidence = Math.min(0.85, confidence);

  return {
    value,
    confidence,
    claims: sentences.map((s) => s.claim),
    derived_from: {
      product_pages: productPages,
      traction_pages: tractionConfirm ? uniqSorted(tractionPick.map((p) => p.node.page_index)) : [],
    },
    supporting_nodes: supporting_nodes.slice(0, 6),
    debug: { deck_type: deckType, excluded_nodes: excluded },
  };
}

export function buildMarketSummaryV1(nodes: NodeLike[]): MarketSummaryV1Section | null {
  const deckType = detectDeckType(nodes);

  const excluded: ExcludedNode[] = [];

  const marketCandidates = (nodes ?? []).filter((n) => {
    const seg = normSeg(n.segment_key);
    return seg === 'market' || seg === 'industry' || seg === 'opportunity';
  });

  const nonMarketCentric = deckType === 'compliance' || deckType === 'rollup';
  if (marketCandidates.length === 0) {
    return nonMarketCentric ? null : null;
  }

  const banned = ['we', 'our', 'us', 'palm'];

  const picked = pickTopNodes(nodes, {
    segment: 'market',
    limit: 3,
    preferTitleTokens: ['market', 'industry outlook', 'industry', 'participation'],
    preferBodyTokens: ['participation', 'cagr', 'growing', 'growth', 'tailwinds', 'category'],
    penalizeTokens: ['raising', 'valuation', 'cap table'],
    bulletOpts: { maxLen: 260, bannedTokens: banned },
  });

  // Include industry/opportunity if present (but still exclude company-positioning language).
  const pickedIndustry = pickTopNodes(nodes, {
    segment: 'industry',
    limit: 2,
    preferTitleTokens: ['industry', 'outlook'],
    preferBodyTokens: ['trend', 'tailwinds', 'growth'],
    penalizeTokens: ['we', 'our'],
    bulletOpts: { maxLen: 260, bannedTokens: banned },
  });
  const pickedOpp = pickTopNodes(nodes, {
    segment: 'opportunity',
    limit: 2,
    preferTitleTokens: ['opportunity'],
    preferBodyTokens: ['market', 'category', 'growth'],
    penalizeTokens: ['we', 'our'],
    bulletOpts: { maxLen: 260, bannedTokens: banned },
  });

  // Track exclusions for inspector.
  for (const n of marketCandidates) {
    const s = bestBullet(n, { maxLen: 260, bannedTokens: banned });
    if (!s) {
      excluded.push({ page_index: n.page_index, slide_title: n.slide_title ?? null, segment_key: n.segment_key ?? null, exclusion_reason: 'no_market_snippet' });
      continue;
    }
    const t = tokenizeLoose(s);
    if (banned.some((k) => t.includes(tokenizeLoose(k)))) {
      excluded.push({ page_index: n.page_index, slide_title: n.slide_title ?? null, segment_key: n.segment_key ?? null, exclusion_reason: 'company_positioning_language' });
      continue;
    }
  }

  const chosen = [...picked, ...pickedIndustry, ...pickedOpp].slice(0, 3);
  if (chosen.length === 0) return nonMarketCentric ? null : null;

  const lines = chosen.map((c) => c.snippet.replace(/\s*\.$/, '') + '.');

  // Deterministic framing; avoid company positioning.
  const value = normalizeWhitespace(`Market context: ${lines.join(' ')}`);

  const supporting_nodes = chosen
    .slice(0, 6)
    .map((c, idx) => toNodeRef(c.node, c.snippet, { rank: idx + 1, claim_type: 'market_context' }));

  const derived = {
    market_pages: uniqSorted(picked.map((p) => p.node.page_index)),
    industry_pages: uniqSorted(pickedIndustry.map((p) => p.node.page_index)),
    opportunity_pages: uniqSorted(pickedOpp.map((p) => p.node.page_index)),
  };

  // Confidence is intentionally conservative: market slides can be sparse or generic.
  const pageCount = uniqSorted(chosen.map((c) => c.node.page_index)).length;
  let confidence = pageCount >= 2 ? 0.75 : 0.6;
  confidence = Math.min(0.85, confidence);

  // Non-market-centric decks: allow null, but if we do emit, keep confidence slightly lower.
  if (nonMarketCentric) confidence = Math.min(confidence, 0.72);

  return {
    value,
    confidence,
    claims: ['market_context'],
    derived_from: derived,
    supporting_nodes,
    debug: { deck_type: deckType, non_market_centric: nonMarketCentric, excluded_nodes: excluded },
  };
}

export function buildDealSummaryV1(input: { nodes: NodeLike[]; structured_summary: any }): DealSummaryV1Section | null {
  const nodes = Array.isArray(input.nodes) ? input.nodes : [];
  const structured = input.structured_summary ?? {};
  const deckType = detectDeckType(nodes);

  const excluded: ExcludedNode[] = [];

  const bm = structured?.business_model_summary;
  const bmValue = typeof bm?.value === 'string' ? bm.value.trim() : '';
  const coreIdentity = bmValue ? extractCoreIdentityFromBusinessModelSummary(bmValue) : null;

  // Required claim: what_the_company_is from product OR business_model_summary
  const identitySentence = (() => {
    if (coreIdentity) return `Company: ${coreIdentity}.`;

    const productPick = pickTopNodes(nodes, {
      segment: 'product',
      limit: 1,
      preferTitleTokens: ['product', 'solution'],
      preferBodyTokens: ['apparel', 'glove', 'accessories', 'platform', 'software'],
      penalizeTokens: ['tam', 'sam', 'som'],
      bulletOpts: { maxLen: 220 },
    });

    if (productPick.length === 0) return null;

    const joined = joinText(productPick[0].node);
    const cls = inferProductCategoryAndFormFactor(joined);
    if (!cls.category) return null;
    return `Company: ${cls.category} company.`;
  })();

  // Required claim: what_it_sells from product
  const productPick = pickTopNodes(nodes, {
    segment: 'product',
    limit: 1,
    preferTitleTokens: ['product', 'solution'],
    preferBodyTokens: ['apparel', 'glove', 'accessories', 'platform', 'software'],
    penalizeTokens: ['tam', 'sam', 'som'],
    bulletOpts: { maxLen: 240, bannedTokens: ['tam', 'sam', 'som', 'cagr', 'market size'] },
  });

  const whatItSellsSentence = productPick.length > 0 ? `Sells: ${productPick[0].snippet.replace(/\s*\.$/, '')}.` : null;

  // Required claim: who_it_serves from traction OR market
  const whoPickTraction = pickTopNodes(nodes, {
    segment: 'traction',
    limit: 1,
    preferTitleTokens: ['traction', 'customers'],
    preferBodyTokens: ['customers', 'accounts', 'retailers', 'users', 'golfers', 'buyers', 'icp'],
    penalizeTokens: ['tam', 'sam', 'som'],
    bulletOpts: {
      maxLen: 240,
      requiredTokens: ['customers', 'accounts', 'retailers', 'users', 'golfers', 'courses', 'icp', 'segments'],
    },
  });

  const whoPickMarket = pickTopNodes(nodes, {
    segment: 'market',
    limit: 1,
    preferTitleTokens: ['icp', 'customers', 'segments', 'market'],
    preferBodyTokens: ['icp', 'customers', 'segments', 'target'],
    penalizeTokens: ['we', 'our'],
    bulletOpts: {
      maxLen: 240,
      bannedTokens: ['we', 'our', 'palm'],
      requiredTokens: ['icp', 'customers', 'segments', 'target', 'buyer', 'persona', 'users'],
    },
  });

  const whoSentence = (() => {
    if (whoPickTraction.length > 0) return `Serves: ${whoPickTraction[0].snippet.replace(/\s*\.$/, '')}.`;
    if (whoPickMarket.length > 0) return `Serves: ${whoPickMarket[0].snippet.replace(/\s*\.$/, '')}.`;
    return null;
  })();

  // Required claim: why_it_wins from traction OR product
  const whyPickTraction = pickTopNodes(nodes, {
    segment: 'traction',
    limit: 1,
    preferTitleTokens: ['traction'],
    preferBodyTokens: ['conversion', 'accounts', 'revenue', 'repeat', 'adoption', 'pipeline'],
    penalizeTokens: ['tam', 'sam', 'som'],
    bulletOpts: {
      maxLen: 240,
      requiredTokens: ['revenue', 'conversion', 'accounts', 'customers', 'repeat', 'retention', 'pipeline', 'growth', 'dtc', 'wholesale'],
    },
  });
  const whyPickProduct = pickTopNodes(nodes, {
    segment: 'product',
    limit: 1,
    preferTitleTokens: ['product', 'solution'],
    preferBodyTokens: ['differentiated', 'patented', 'proprietary', 'performance', 'technology'],
    penalizeTokens: ['tam', 'sam', 'som'],
    bulletOpts: { maxLen: 240 },
  });

  const whySentence = (() => {
    if (whyPickTraction.length > 0) return `Why it wins: ${whyPickTraction[0].snippet.replace(/\s*\.$/, '')}.`;
    if (whyPickProduct.length > 0) return `Why it wins: ${whyPickProduct[0].snippet.replace(/\s*\.$/, '')}.`;
    return null;
  })();

  const requiredMissing: string[] = [];
  if (!identitySentence) requiredMissing.push('what_the_company_is');
  if (!whatItSellsSentence) requiredMissing.push('what_it_sells');
  if (!whoSentence) requiredMissing.push('who_it_serves');
  if (!whySentence) requiredMissing.push('why_it_wins');

  if (requiredMissing.length > 0) return null;

  const sentences: Array<{ text: string; claim: SummaryClaimType }> = [
    { text: identitySentence!, claim: 'what_the_company_is' },
    { text: whatItSellsSentence!, claim: 'what_it_sells' },
    { text: whoSentence!, claim: 'who_it_serves' },
    { text: whySentence!, claim: 'why_it_wins' },
  ];

  const value = sentences.map((s) => normalizeWhitespace(s.text)).join(' ');

  const supporting_nodes: SummaryNodeRef[] = [];
  if (productPick[0]) supporting_nodes.push(toNodeRef(productPick[0].node, productPick[0].snippet, { claim_type: 'what_it_sells', role: 'primary' }));
  if (whoPickTraction[0]) supporting_nodes.push(toNodeRef(whoPickTraction[0].node, whoPickTraction[0].snippet, { claim_type: 'who_it_serves', role: 'primary' }));
  else if (whoPickMarket[0]) supporting_nodes.push(toNodeRef(whoPickMarket[0].node, whoPickMarket[0].snippet, { claim_type: 'who_it_serves', role: 'supporting' }));
  if (whyPickTraction[0]) supporting_nodes.push(toNodeRef(whyPickTraction[0].node, whyPickTraction[0].snippet, { claim_type: 'why_it_wins', role: 'primary' }));
  else if (whyPickProduct[0]) supporting_nodes.push(toNodeRef(whyPickProduct[0].node, whyPickProduct[0].snippet, { claim_type: 'why_it_wins', role: 'supporting' }));

  // Include top product node for identity if we didn't use business_model_summary.
  if (!coreIdentity && productPick[0]) {
    supporting_nodes.unshift(toNodeRef(productPick[0].node, productPick[0].snippet, { claim_type: 'what_the_company_is', role: 'supporting' }));
  }

  // Market nodes should not dominate deal summary; include at most 1 supporting market node.
  if (whoPickMarket[0] && !supporting_nodes.some((n) => n.page_index === whoPickMarket[0].node.page_index)) {
    supporting_nodes.push(toNodeRef(whoPickMarket[0].node, whoPickMarket[0].snippet, { claim_type: 'who_it_serves', role: 'supporting' }));
  }

  const productPages = uniqSorted([...(productPick.map((p) => p.node.page_index)), ...(whyPickProduct.map((p) => p.node.page_index))]);
  const tractionPages = uniqSorted([...(whoPickTraction.map((p) => p.node.page_index)), ...(whyPickTraction.map((p) => p.node.page_index))]);
  const marketPages = uniqSorted([...(whoPickMarket.map((p) => p.node.page_index))]);

  // Exclusions: only track nodes in allowed segments that were not selected.
  const allowedSegs = new Set(['product', 'traction', 'market', 'overview', 'go_to_market', 'distribution']);
  const usedPageIndex = new Set(supporting_nodes.map((n) => n.page_index));
  for (const n of nodes) {
    const seg = normSeg(n.segment_key);
    if (!allowedSegs.has(seg)) continue;
    if (usedPageIndex.has(n.page_index)) continue;

    // Explicit exclusions per spec.
    if (seg === 'raise_terms' || seg === 'team' || seg === 'operations' || seg === 'equipment') {
      excluded.push({ page_index: n.page_index, slide_title: n.slide_title ?? null, segment_key: n.segment_key ?? null, exclusion_reason: 'disallowed_segment' });
      continue;
    }

    // Market limited role.
    if (seg === 'market') {
      excluded.push({ page_index: n.page_index, slide_title: n.slide_title ?? null, segment_key: n.segment_key ?? null, exclusion_reason: 'market_is_supporting_only' });
      continue;
    }

    excluded.push({ page_index: n.page_index, slide_title: n.slide_title ?? null, segment_key: n.segment_key ?? null, exclusion_reason: 'not_selected_top_evidence' });
  }

  // Confidence: deterministic and conservative.
  let confidence = 0.62;
  if (supporting_nodes.length >= 3) confidence += 0.06;
  if (coreIdentity) confidence += 0.06;
  if (tractionPages.length > 0) confidence += 0.06;
  confidence = Math.min(0.85, confidence);

  return {
    value,
    confidence,
    claims: sentences.map((s) => s.claim),
    derived_from: {
      product_pages: productPages,
      traction_pages: tractionPages,
      market_pages: marketPages.length > 0 ? marketPages : [],
    },
    supporting_nodes: supporting_nodes.slice(0, 6),
    debug: {
      deck_type: deckType,
      excluded_nodes: excluded.slice(0, 50),
    },
  };
}
