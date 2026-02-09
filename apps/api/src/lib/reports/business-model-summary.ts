export type SegmentedNode = {
  page_index: number;
  slide_title: string | null;
  bullets: string[];
  segment_key: string | null;
  segment_reason: any;
  source_document_id: string;
};

export type BusinessModelSummaryV1 = {
  value: string | null;
  confidence: number;
  derived_from: {
    product_pages: number[];
    gtm_pages: number[];
    distribution_pages: number[];
    traction_pages: number[];
    market_pages: number[];
    other_pages: number[];
  };
  supporting_nodes: Array<{
    page_index: number;
    slide_title: string | null;
    segment_key: string | null;
    reason?: any;
    note_snippet?: string | null;
  }>;
};

const asNonEmptyString = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

const normalizeSeg = (v: unknown): string => String(v ?? '').trim().toLowerCase();

const uniqSorted = (xs: number[]): number[] => Array.from(new Set(xs)).sort((a, b) => a - b);

const containsAny = (haystack: string, needles: string[]): boolean => needles.some((n) => haystack.includes(n));

function isExcludedSegmentForBusinessModel(seg: string): boolean {
  return seg === 'raise_terms' || seg === 'operations' || seg === 'equipment';
}

function segmentWeight(seg: string): number {
  // Role weights: identity > reality > mechanics > scale > context.
  // Keep distribution aligned with go_to_market.
  if (seg === 'product') return 1.0;
  if (seg === 'traction') return 0.9;
  if (seg === 'overview') return 0.9;
  if (seg === 'go_to_market' || seg === 'gtm' || seg === 'distribution') return 0.6;
  if (seg === 'financials') return 0.4;
  if (seg === 'market' || seg === 'market_size' || seg === 'problem') return 0.2;
  if (seg === 'raise_terms') return 0.0;
  return 0.2;
}

function isVisionOnlySlide(text: string): boolean {
  const t = text.toLowerCase();
  return containsAny(t, [
    'our vision',
    'vision',
    'mission',
    'poised to win',
    'why now',
    'opportunity',
    'industry outlook',
  ]);
}

function hasCoreIdentityLanguage(text: string): boolean {
  const t = text.toLowerCase();
  // “What we do / Our product” style explicit identity.
  if (containsAny(t, ['what we do', 'what we sell', 'our product', 'our products', 'we sell', 'we build', 'we make'])) return true;
  // Product / offering nouns.
  if (containsAny(t, ['apparel', 'clothing', 'accessories', 'glove', 'gloves', 'software', 'saas', 'platform', 'subscription', 'marketplace', 'services'])) return true;
  return false;
}

function hasExplicitChannelOrModelSignal(text: string): boolean {
  const t = text.toLowerCase();
  // Channels
  if (containsAny(t, ['dtc', 'direct-to-consumer', 'direct to consumer', 'e-commerce', 'ecommerce', 'website', 'shopify', 'online store'])) return true;
  if (containsAny(t, ['wholesale', 'retailers', 'brick and mortar', 'green grass', 'pro shop', 'reseller', 'accounts'])) return true;
  if (containsAny(t, ['retail channels', 'retail channel', 'distribution', 'channel partner', 'channel partners', 'partnership', 'partnerships'])) return true;
  // Business model / structure
  if (containsAny(t, ['subscription', 'usage-based', 'usage based', 'licensing', 'license', 'marketplace', 'commission'])) return true;
  return false;
}

function isGenericMacroMarketSlide(text: string): boolean {
  const t = text.toLowerCase();
  // If it looks like pure macro sizing/outlook without category confirmation, treat as generic.
  const macro = containsAny(t, ['tam', 'sam', 'som', 'cagr', 'market size', 'industry outlook', 'macro', 'tailwinds', 'growing market']);
  const category = containsAny(t, ['golf', 'apparel', 'accessories', 'consumer', 'cpg', 'sport']);
  return macro && !category;
}

function joinText(node: SegmentedNode): string {
  const title = (node.slide_title ?? '').trim();
  const bullets = Array.isArray(node.bullets) ? node.bullets.join(' ') : '';
  return `${title} ${bullets}`.replace(/\s+/g, ' ').trim();
}

function bestSnippet(node: SegmentedNode, keywords: string[]): string | null {
  const bullets = Array.isArray(node.bullets) ? node.bullets : [];
  const normalized = keywords.map((k) => k.toLowerCase());

  const candidates = bullets
    .map((b) => asNonEmptyString(b))
    .filter((b): b is string => Boolean(b))
    .map((b) => ({
      raw: b,
      lc: b.toLowerCase(),
    }))
    .filter((b) => (normalized.length === 0 ? true : containsAny(b.lc, normalized)));

  if (candidates.length === 0) {
    const fallback = asNonEmptyString(bullets[0]);
    return fallback ? fallback.slice(0, 140) : null;
  }

  candidates.sort((a, b) => a.raw.length - b.raw.length || a.raw.localeCompare(b.raw));
  return candidates[0].raw.slice(0, 180);
}

function classifyProduct(text: string): { label: string | null; keywords: string[] } {
  const t = text.toLowerCase();
  const hits: string[] = [];

  const hasGolf = t.includes('golf');
  const hasApparel = containsAny(t, ['apparel', 'clothing', 'outerwear', 'pants', 'shirts', 'shorts', 'hoodie', 'jacket']);
  const hasAccessories = containsAny(t, ['accessories', 'hat', 'caps', 'belt', 'bag', 'glove', 'socks']);
  const hasFootwear = containsAny(t, ['footwear', 'shoes', 'sneaker', 'boot']);
  const hasSoftware = containsAny(t, ['software', 'saas', 'platform', 'api', 'subscription']);

  if (hasGolf) hits.push('golf');
  if (hasApparel) hits.push('apparel');
  if (hasAccessories) hits.push('accessories');
  if (hasFootwear) hits.push('footwear');
  if (hasSoftware) hits.push('software');

  if (hasSoftware) return { label: 'Software', keywords: hits };
  if (hasGolf && hasApparel) return { label: 'Golf apparel', keywords: hits };
  if (hasApparel && hasAccessories) return { label: 'Apparel and accessories', keywords: hits };
  if (hasApparel) return { label: 'Apparel', keywords: hits };
  if (hasAccessories) return { label: 'Accessories', keywords: hits };
  if (hasFootwear) return { label: 'Footwear', keywords: hits };
  return { label: null, keywords: hits };
}

function classifyChannels(text: string): {
  dtc: boolean;
  wholesale: boolean;
  retail: boolean;
  enterprise: boolean;
  partners: boolean;
  omni: boolean;
  keywords: string[];
} {
  const t = text.toLowerCase();

  const dtc = containsAny(t, ['dtc', 'direct-to-consumer', 'direct to consumer', 'e-commerce', 'ecommerce', 'website', 'shopify', 'online store']);
  const wholesale = containsAny(t, ['wholesale', 'accounts', 'retailers', 'brick and mortar', 'green grass', 'pro shop', 'reseller']);
  const retail = containsAny(t, ['retail', 'stores', 'in-store', 'brick and mortar', 'shops']);
  const enterprise = containsAny(t, ['enterprise', 'b2b', 'mid-market', 'fortune']);
  // “Partners” language is too loose for business-model identity; only treat as a signal
  // if it's explicitly licensing/royalty-driven.
  const partners = containsAny(t, ['license', 'licensing', 'royalty', 'royalties']) && containsAny(t, ['partner', 'partners', 'partnership', 'partnerships']);
  const omni = containsAny(t, ['omnichannel', 'omni-channel', 'omni channel']);

  const keywords: string[] = [];
  if (dtc) keywords.push('dtc');
  if (wholesale) keywords.push('wholesale');
  if (retail) keywords.push('retail');
  if (enterprise) keywords.push('enterprise');
  if (partners) keywords.push('partners');
  if (omni) keywords.push('omnichannel');

  return { dtc, wholesale, retail, enterprise, partners, omni, keywords };
}

function tractionSupportsChannel(text: string): { supports: boolean; keywords: string[] } {
  const t = text.toLowerCase();
  const hasNumber = /\b\d{1,3}(?:,\d{3})*(?:\.\d+)?\b/.test(t);

  const supportsWholesale = hasNumber && containsAny(t, ['wholesale', 'retailer', 'retailers', 'accounts', 'brick and mortar', 'green grass']);
  const supportsDtc = containsAny(t, ['conversion', 'cvr', 'checkout', 'attribution', 'website', 'returning customer', 'repeat rate', 'aov', 'lifetime value']);

  const supports = Boolean(supportsWholesale || supportsDtc);
  const keywords: string[] = [];
  if (supportsWholesale) keywords.push('wholesale-traction');
  if (supportsDtc) keywords.push('dtc-traction');
  return { supports, keywords };
}

function marketCorroborates(text: string): { ok: boolean; keywords: string[] } {
  const t = text.toLowerCase();
  // Only include market pages when they confirm category relevant to product, and avoid licensing/generic macro.
  const hasCategory = containsAny(t, ['golf', 'apparel', 'accessories', 'consumer', 'cpg', 'sport']);
  const isLicensing = containsAny(t, ['licensing', 'license']);
  const ok = hasCategory && !isLicensing && !isGenericMacroMarketSlide(text);
  const keywords: string[] = [];
  if (t.includes('golf')) keywords.push('golf');
  if (t.includes('lifestyle')) keywords.push('lifestyle');
  if (t.includes('athleisure')) keywords.push('athleisure');
  if (t.includes('apparel')) keywords.push('apparel');
  if (t.includes('consumer')) keywords.push('consumer');
  if (t.includes('accessories')) keywords.push('accessories');
  return { ok, keywords };
}

function bucketForSegment(seg: string): keyof BusinessModelSummaryV1['derived_from'] {
  if (seg === 'product') return 'product_pages';
  if (seg === 'go_to_market' || seg === 'gtm') return 'gtm_pages';
  // Distribution slides are treated as GTM evidence for business model summary.
  if (seg === 'distribution') return 'gtm_pages';
  if (seg === 'traction') return 'traction_pages';
  if (seg === 'market' || seg === 'market_size' || seg === 'problem') return 'market_pages';
  return 'other_pages';
}

export function buildBusinessModelSummaryV1(nodes: SegmentedNode[]): BusinessModelSummaryV1 | null {
  const derived: BusinessModelSummaryV1['derived_from'] = {
    product_pages: [],
    gtm_pages: [],
    distribution_pages: [],
    traction_pages: [],
    market_pages: [],
    other_pages: [],
  };

  const contributions: Array<{
    node: SegmentedNode;
    score: number;
    snippetKeywords: string[];
    usedBuckets: Array<keyof BusinessModelSummaryV1['derived_from']>;
    weight: number;
  }> = [];

  let bestCoreIdentity: { value: string; score: number } | null = null;
  let productFound = false;
  let tractionFound = false;
  let gtmFound = false;
  let kpiFound = false;
  let marketFound = false;
  let marketContributionCount = 0;
  let totalContributionCount = 0;

  let channelFlags = {
    dtc: false,
    wholesale: false,
    retail: false,
    enterprise: false,
    partners: false,
    omni: false,
  };

  for (const node of nodes ?? []) {
    if (!node || typeof node !== 'object') continue;

    const seg = normalizeSeg(node.segment_key);
    const text = joinText(node);
    const weight = segmentWeight(seg);

    // Exclude whole segments that should never contribute to business model summary supporting evidence.
    if (isExcludedSegmentForBusinessModel(seg)) {
      continue;
    }

    // Exclude financials by default unless it explicitly states channel/model.
    if (seg === 'financials' && !hasExplicitChannelOrModelSignal(text)) {
      continue;
    }

    const bucket = bucketForSegment(seg);

    let nodeScore = 0;
    const snippetKeywords: string[] = [];
    const usedBuckets: Array<keyof BusinessModelSummaryV1['derived_from']> = [];

    // ---- Core identity (claim-gated) ----
    // Core identity claims may ONLY come from product / traction / overview or explicit “what we do/product” language.
    // Explicitly exclude market/opportunity/industry/vision-only slides.
    const eligibleForCoreIdentity = (bucket === 'product_pages' || bucket === 'traction_pages' || seg === 'overview' || hasCoreIdentityLanguage(text))
      && bucket !== 'market_pages'
      && !isVisionOnlySlide(text);

    if (eligibleForCoreIdentity && weight >= 0.6) {
      const prod = classifyProduct(text);
      const lc = text.toLowerCase();
      // “What is it?”: prefer product nouns; never allow channels to become the noun phrase.
      const coreIdentity = (() => {
        if (prod.label) {
          if (prod.label === 'Golf apparel') return 'Golf apparel brand';
          if (prod.label === 'Software') return 'Software company';
          if (prod.label.toLowerCase().includes('apparel')) return `${prod.label} brand`;
          return `${prod.label} company`;
        }
        if (containsAny(lc, ['physical goods', 'consumer goods', 'cpg'])) return 'Consumer brand';
        if (containsAny(lc, ['subscription', 'saas', 'software', 'platform'])) return 'Software company';
        return null;
      })();

      if (coreIdentity) {
        productFound = productFound || bucket === 'product_pages';
        tractionFound = tractionFound || bucket === 'traction_pages';
        // Weighted dominance: product should anchor identity.
        let coreScore = (bucket === 'product_pages' ? 3.0 : bucket === 'traction_pages' ? 2.2 : 1.5) * weight;
        if (containsAny(lc, ['apparel', 'accessories', 'glove', 'clothing', 'outerwear', 'collection'])) coreScore += 0.25;
        if (lc.includes('brand')) coreScore += 0.10;
        if (!bestCoreIdentity || coreScore > bestCoreIdentity.score) bestCoreIdentity = { value: coreIdentity, score: coreScore };
      }
    }

    // Product evidence bucket tracking
    if (bucket === 'product_pages') {
      const prod = classifyProduct(text);
      if (prod.label) {
        nodeScore += 3;
        if (containsAny(text.toLowerCase(), ['apparel', 'accessories', 'glove', 'clothing', 'outerwear', 'collection'])) nodeScore += 1;
        snippetKeywords.push(...prod.keywords);
        derived.product_pages.push(node.page_index);
        usedBuckets.push('product_pages');
      }
    }

    // Distribution / monetization modifiers (channels): only from go_to_market/distribution (preferred)
    // and traction when it contains distribution/channel attribution.
    if (bucket === 'gtm_pages') {
      const ch = classifyChannels(text);
      if (ch.dtc || ch.wholesale || ch.enterprise || ch.partners || ch.retail) {
        gtmFound = true;
        nodeScore += 3;
        if (ch.omni || (Number(ch.dtc) + Number(ch.wholesale) + Number(ch.retail) >= 2)) nodeScore += 1;
        snippetKeywords.push(...ch.keywords);
        derived.gtm_pages.push(node.page_index);
        usedBuckets.push('gtm_pages');

        channelFlags = {
          dtc: channelFlags.dtc || ch.dtc,
          wholesale: channelFlags.wholesale || ch.wholesale,
          retail: channelFlags.retail || ch.retail,
          enterprise: channelFlags.enterprise || ch.enterprise,
          partners: channelFlags.partners || ch.partners,
          omni: channelFlags.omni || ch.omni,
        };
      }
    }

    // Traction support (commercial reality + channel attribution)
    if (bucket === 'traction_pages') {
      const sup = tractionSupportsChannel(text);
      if (sup.supports) {
        tractionFound = true;
        nodeScore += 2;
        const hasRevenue = containsAny(text.toLowerCase(), ['revenue', 'attributed revenue', '$', 'arr', 'mrr']);
        const hasCustomers = containsAny(text.toLowerCase(), ['customers', 'accounts', 'doors', 'retailers', 'buyers']);
        if ((hasRevenue || hasCustomers) && /\b\d{1,3}(?:,\d{3})*(?:\.\d+)?\b/.test(text)) kpiFound = true;
        const ch = classifyChannels(text);
        // Boost traction when revenue is explicitly attributed to a channel.
        if (hasRevenue && (ch.dtc || ch.wholesale || ch.retail)) nodeScore += 1;
        snippetKeywords.push(...sup.keywords);
        derived.traction_pages.push(node.page_index);
        usedBuckets.push('traction_pages');

        // Traction can also contribute channel flags, but only when it contains distribution/channel language.
        if (ch.dtc || ch.wholesale || ch.retail || ch.enterprise || ch.partners) {
          gtmFound = true;
          snippetKeywords.push(...ch.keywords);
          channelFlags = {
            dtc: channelFlags.dtc || ch.dtc,
            wholesale: channelFlags.wholesale || ch.wholesale,
            retail: channelFlags.retail || ch.retail,
            enterprise: channelFlags.enterprise || ch.enterprise,
            partners: channelFlags.partners || ch.partners,
            omni: channelFlags.omni || ch.omni,
          };
        }
      }
    }

    // Market corroboration
    if (bucket === 'market_pages') {
      const m = marketCorroborates(text);
      if (m.ok) {
        marketFound = true;
        // Track market, but never let it contribute nouns to the model.
        // Keep weight small and exclude from supporting_nodes by default.
        nodeScore += 0.5;
        snippetKeywords.push(...m.keywords);
        derived.market_pages.push(node.page_index);
        usedBuckets.push('market_pages');
      }
    }

    if (nodeScore > 0) {
      contributions.push({ node, score: nodeScore * weight, snippetKeywords, usedBuckets, weight });
      totalContributionCount += 1;
      if (bucket === 'market_pages') marketContributionCount += 1;
    }
  }

  // ---- Claim gate: require at least one core identity claim ----
  if (!bestCoreIdentity) {
    return null;
  }

  // ---- Confidence (deck-aware, claim-gated) ----
  // base = 0.35
  // +0.25 if ≥1 product page
  // +0.20 if ≥1 traction page
  // +0.10 if ≥1 go_to_market page
  // +0.05 if revenue/customers KPIs exist
  // -0.10 if market slides are >30% of evidence inputs
  // cap at 0.85
  let confidence = 0.35;
  if (derived.product_pages.length > 0) confidence += 0.25;
  if (derived.traction_pages.length > 0) confidence += 0.20;
  if (derived.gtm_pages.length > 0) confidence += 0.10;
  if (kpiFound) confidence += 0.05;
  const marketShare = totalContributionCount > 0 ? (marketContributionCount / totalContributionCount) : 0;
  if (marketShare > 0.30) confidence -= 0.10;
  // Market corroboration can increase confidence slightly (cap +0.05 total)
  if (marketFound) confidence += 0.05;
  confidence = Math.min(0.85, Math.max(0, confidence));

  // ---- Two-layer structure: [Core Identity] + [Distribution / Monetization Modifiers] ----
  const coreIdentity = bestCoreIdentity.value;

  const channels: string[] = [];
  if (channelFlags.dtc) channels.push('DTC');
  if (channelFlags.wholesale) channels.push('wholesale');
  if (!channelFlags.wholesale && channelFlags.retail) channels.push('retail');
  if (channelFlags.enterprise) channels.push('enterprise');
  // Only include partners if licensing is dominant (rare). We keep this conservative.
  if (channelFlags.partners) channels.push('licensing partners');

  const channelPhrase = channels.length > 0
    ? channels.length === 1
      ? channels[0]
      : channels.slice(0, -1).join(' and ') + ' and ' + channels[channels.length - 1]
    : null;

  const omni = channelFlags.omni || (channelFlags.dtc && (channelFlags.wholesale || channelFlags.retail));
  const omniClause = omni ? ' via omnichannel distribution' : '';

  const value = (() => {
    // Claim gate guarantees core identity.
    if (!channelPhrase) return `${coreIdentity}.`;
    return `${coreIdentity} selling ${channelPhrase}${omniClause}.`;
  })();

  // Derived_from: unique, sorted
  for (const k of Object.keys(derived) as Array<keyof typeof derived>) {
    derived[k] = uniqSorted(derived[k]);
  }

  // Supporting nodes: take top contributions, excluding market by default.
  contributions.sort((a, b) => b.score - a.score || a.node.page_index - b.node.page_index);
  const supporting_nodes = contributions
    .filter((c) => bucketForSegment(normalizeSeg(c.node.segment_key)) !== 'market_pages')
    .slice(0, 8)
    .map((c) => ({
    page_index: c.node.page_index,
    slide_title: c.node.slide_title ?? null,
    segment_key: c.node.segment_key ?? null,
    reason: c.node.segment_reason,
    note_snippet: bestSnippet(c.node, c.snippetKeywords),
  }));

  return {
    value,
    confidence,
    derived_from: derived,
    supporting_nodes,
  };
}
