import type { AnalystSegment } from "./analyst-segment";

export type DpuSegmentReason = {
  title_rules_hit: string[];
  bullet_rules_hit: string[];
  override_rules_hit: string[];
  keywords: string[];
};

export type DpuSegmentResult = {
  segment_key: AnalystSegment;
  confidence: number; // 0..1
  reason: DpuSegmentReason;
};

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

const clean = (v: unknown): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");

const lower = (v: unknown): string => clean(v).toLowerCase();

const hasMoneyToken = (t: string): boolean => /\$\s*\d/.test(t);

const hasYearGte = (t: string, year: number): boolean => {
  const years = Array.from(t.matchAll(/\b(20\d{2})\b/g)).map((m) => Number(m[1]));
  return years.some((y) => Number.isFinite(y) && y >= year);
};

const anyMatch = (t: string, res: RegExp[]): boolean => res.some((r) => r.test(t));

const extractKeywordHits = (t: string, needles: string[]): string[] => {
  const tl = t.toLowerCase();
  return needles.filter((k) => tl.includes(k.toLowerCase()));
};

type TitleRule = { id: string; re: RegExp; segment: AnalystSegment; keywords: string[] };

const TITLE_RULES: TitleRule[] = [
  { id: "gtm.title.gtm_marketing_omni", re: /\b(go\s*to\s*market|gtm|marketing|omni[- ]channel)\b/i, segment: "go_to_market", keywords: ["go to market", "gtm", "marketing", "omni-channel"] },
  { id: "market.title.industry_outlook", re: /\b(industry|outlook|market|opportunity)\b/i, segment: "market", keywords: ["industry", "outlook", "market", "opportunity"] },
  { id: "traction.title.traction", re: /\btraction\b/i, segment: "traction", keywords: ["traction"] },
  { id: "team.title.team_advisors_story", re: /\b(team|advisors?|who\s+we\s+are|our\s+story)\b/i, segment: "team", keywords: ["team", "advisor", "who we are", "our story"] },
  { id: "product.title.product_journey", re: /\b(product\s+journey|product|validation|featured)\b/i, segment: "product", keywords: ["product", "journey", "validation", "featured"] },
  { id: "financials.title.financials_forecast", re: /\b(financials|full\s+horizon|forecast)\b/i, segment: "financials", keywords: ["financials", "full horizon", "forecast"] },
  { id: "raise.title.raise_terms", re: /\b(capital\s+raise|\braise\b)\b/i, segment: "raise_terms", keywords: ["capital raise", "raise"] },
  { id: "team.title.strategic_hires", re: /\b(strategic\s+hires?|\bhires?\b)\b/i, segment: "team", keywords: ["strategic hires", "hires"] },
  { id: "overview.title.business_performance", re: /\bbusiness\s+performance\b/i, segment: "overview", keywords: ["business performance"] },
  { id: "market.title.licensing", re: /\blicens(e|ing)\b/i, segment: "market", keywords: ["licensing"] },
  { id: "ops.title.operations_equipment", re: /\b(equipment|operational\s+optimization|operations)\b/i, segment: "operations", keywords: ["equipment", "operational optimization", "operations"] },
];

export function inferSegmentFromTitleRuleId(ruleId: string): AnalystSegment | null {
  const id = String(ruleId || "").startsWith("segmenter:title:") ? String(ruleId).slice("segmenter:title:".length) : String(ruleId || "");
  const hit = TITLE_RULES.find((r) => r.id === id);
  return hit?.segment ?? null;
}

function isNoisyBullets(bullets: string[]): boolean {
  if (!Array.isArray(bullets) || bullets.length === 0) return true;
  const meaningful = bullets
    .map((b) => clean(b))
    .filter(Boolean)
    .filter((b) => b.length >= 4)
    .filter((b) => !/^(n\/?a|na|tbd|none)$/i.test(b));
  return meaningful.length === 0;
}

export function segmentDpuPage(input: {
  title: string | null;
  bullets: string[];
  now?: Date;
}): DpuSegmentResult {
  const title = clean(input.title);
  const bullets = Array.isArray(input.bullets) ? input.bullets.map(clean).filter(Boolean) : [];

  const now = input.now ?? new Date();
  const currentYear = now.getFullYear();

  const titleL = title.toLowerCase();
  const bulletsText = bullets.join("\n");
  const bulletsL = bulletsText.toLowerCase();

  const reason: DpuSegmentReason = { title_rules_hit: [], bullet_rules_hit: [], override_rules_hit: [], keywords: [] };

  const bulletIntent = (() => {
    const traction_intent = (() => {
      const hasKpiWord = anyMatch(bulletsText, [
        /\brevenue\b/i,
        /\bin\s+revenue\b/i,
        /\battributed\s+revenue\b/i,
        /\bconversion\b/i,
        /\bconversion\s+rate\b/i,
        /\bcac\b/i,
        /\bcustomer\s+acquisition\s+cost\b/i,
        /\breturning\s+customer\b/i,
        /\breturn\s+rate\b/i,
        /\barr\b/i,
        /\bmrr\b/i,
        /\bgross\s+margin\b/i,
      ]);
      const hasNumeric = /\$\s*\d/.test(bulletsText) || /\b\d+(?:\.\d+)?\s*%\b/.test(bulletsText) || /\b\d{3,}\b/.test(bulletsText);
      return hasKpiWord && hasNumeric;
    })();

    const customers_distribution_intent = (() => {
      const hasServing = /\bserving\b/i.test(bulletsText);
      const hasCount = /\b\d{2,}\b/.test(bulletsText);
      const hasFootprint = /\b(retailers?|brick\s+and\s+mortar|accounts?|doors?|green\s+grass)\b/i.test(bulletsText);
      const hasChannel = /\b(wholesale|retail|distribution|channel|partnerships?)\b/i.test(bulletsText);
      // Require either explicit footprint language (accounts/retailers/brick&mortar/doors) or a serving-style statement.
      // Avoid treating generic "store count" bullets as GTM.
      return (hasServing && hasCount && (hasFootprint || hasChannel)) || (hasCount && hasFootprint && (hasServing || hasChannel));
    })();

    const market_intent = (() => {
      const hasSizing = anyMatch(bulletsText, [/\btam\b/i, /\bsam\b/i, /\bsom\b/i, /\bmarket\s+size\b/i, /\bcagr\b/i]);
      const hasMarketLanguage = anyMatch(bulletsText, [/\bmarket\b/i, /\bindustry\b/i, /\boutlook\b/i, /\bopportunity\b/i, /\bgrow\w*\b/i, /\bparticipation\b/i]);
      return hasSizing || (anyMatch(bulletsText, [/\bmarket\b/i, /\bindustry\b/i]) && hasMarketLanguage);
    })();

    const product_intent = anyMatch(bulletsText, [/\bapparel\b/i, /\baccessories\b/i, /\bglove\w*\b/i, /\bcollection\b/i, /\bproduct\b/i]);

    const gtm_intent = anyMatch(bulletsText, [
      /\bsell\s+via\s+website\b/i,
      /\bwebsite\b/i,
      /\bretail\s+channels?\b/i,
      /\bwholesale\b/i,
      /\bomni[- ]channel\b/i,
      /\bgo\s*to\s*market\b/i,
      /\bdistribution\b/i,
      /\bpartnerships?\b/i,
      /\bchannel\s+partners?\b/i,
    ]);

    return { traction_intent, customers_distribution_intent, market_intent, product_intent, gtm_intent };
  })();

  // ---- Title-first rules (high confidence, can be overridden by intent) ----
  const titleHit = title ? TITLE_RULES.find((r) => r.re.test(title)) : null;
  if (titleHit) {
    reason.title_rules_hit.push(titleHit.id);
    reason.keywords.push(...extractKeywordHits(title, titleHit.keywords));

    // Capital Raise is locked regardless of bullets.
    if (titleHit.segment === "raise_terms") {
      return { segment_key: titleHit.segment, confidence: 0.95, reason: { ...reason, keywords: Array.from(new Set(reason.keywords)) } };
    }

    // ---- Bullet intent overrides (deterministic) ----
    const override = (() => {
      // Strategic hires slides can be about footprint / distribution, not team.
      if (titleHit.id === "team.title.strategic_hires" && bulletIntent.customers_distribution_intent) {
        return {
          id: "gtm.intent.customers_distribution",
          segment: "go_to_market" as AnalystSegment,
          keywords: ["serving", "retailers", "brick and mortar", "accounts", "distribution", "wholesale"],
          confidence: 0.9,
        };
      }

      // Business Performance is typically KPI-driven; route to traction when KPI signals exist.
      if (titleHit.id === "overview.title.business_performance" && bulletIntent.traction_intent) {
        return {
          id: "traction.intent.kpi_signals",
          segment: "traction" as AnalystSegment,
          keywords: ["revenue", "conversion", "cac", "returning customer", "arr", "mrr"],
          confidence: 0.9,
        };
      }

      // Licensing is frequently a go-to-market / channel slide when bullets indicate GTM language.
      if (titleHit.id === "market.title.licensing" && bulletIntent.gtm_intent) {
        return {
          id: "gtm.intent.licensing",
          segment: "go_to_market" as AnalystSegment,
          keywords: ["distribution", "retail channels", "partnership", "wholesale", "go to market"],
          confidence: 0.9,
        };
      }

      return null;
    })();

    if (override) {
      reason.override_rules_hit.push(override.id);
      reason.keywords.push(...extractKeywordHits(bulletsText, override.keywords));
      reason.keywords.push(...extractKeywordHits(title, override.keywords));
      return {
        segment_key: override.segment,
        confidence: clamp01(override.confidence),
        reason: { ...reason, keywords: Array.from(new Set(reason.keywords)) },
      };
    }

    return { segment_key: titleHit.segment, confidence: 0.95, reason: { ...reason, keywords: Array.from(new Set(reason.keywords)) } };
  }

  // ---- Bullet fallback rules (medium confidence) ----
  const bulletRules: Array<{ id: string; when: () => boolean; segment: AnalystSegment; keywords: string[]; confidence: number }>= [
    {
      id: "raise.bullets.valuation_equity_board",
      when: () => anyMatch(bulletsL, [/\bvaluation\b/i, /\bequity\b/i, /\bboard\s*seat\b/i, /\bsafe\b/i, /\bcap\b/i]),
      segment: "raise_terms",
      keywords: ["valuation", "equity", "board seat", "safe", "cap"],
      confidence: 0.75,
    },
    {
      id: "financials.bullets.year_money_forecast",
      when: () => hasYearGte(bulletsText, currentYear) && hasMoneyToken(bulletsText) && anyMatch(bulletsL, [/\bforecast\b/i, /\bprojection\b/i, /\bprojected\b/i, /\bplan\b/i, /\bmodeled\b/i]),
      segment: "financials",
      keywords: ["forecast", "projection", "plan"],
      confidence: 0.72,
    },
    {
      id: "traction.bullets.serving_counts_retail",
      when: () => {
        const hasServing = /\bserving\b/i.test(bulletsText);
        const hasCount = /\b\d{2,}\b/.test(bulletsText);
        const hasChannel = /\b(retailers?|courses?|stores?|accounts?)\b/i.test(bulletsText);
        return hasServing && hasCount && hasChannel;
      },
      segment: "traction",
      keywords: ["serving", "retailers", "courses", "stores", "accounts"],
      confidence: 0.68,
    },
    {
      id: "traction.intent.kpi_signals",
      when: () => bulletIntent.traction_intent,
      segment: "traction",
      keywords: ["revenue", "conversion", "cac", "returning customer", "arr", "mrr"],
      confidence: 0.86,
    },
    {
      id: "gtm.intent.customers_distribution",
      when: () => bulletIntent.customers_distribution_intent,
      segment: "go_to_market",
      keywords: ["serving", "retailers", "brick and mortar", "accounts", "wholesale", "distribution"],
      confidence: 0.81,
    },
    {
      id: "gtm.intent.channels_partnerships",
      when: () => bulletIntent.gtm_intent,
      segment: "go_to_market",
      keywords: ["go to market", "wholesale", "distribution", "retail channels", "partnership"],
      confidence: 0.78,
    },
    {
      id: "market.intent.sizing_macro",
      when: () => bulletIntent.market_intent,
      segment: "market",
      keywords: ["tam", "sam", "som", "market", "industry", "cagr", "outlook"],
      confidence: 0.74,
    },
    {
      id: "product.intent.products",
      when: () => bulletIntent.product_intent,
      segment: "product",
      keywords: ["apparel", "accessories", "glove", "collection", "product"],
      confidence: 0.72,
    },
    {
      id: "ops.bullets.ops_optimization_inventory",
      when: () => anyMatch(bulletsL, [/\bloyalty\s+program\b/i, /\bwebsite\s+optimization\b/i, /\binventory\b/i, /\bturnaround\b/i, /\blogistics\b/i, /\bsupply\s+chain\b/i]),
      segment: "operations",
      keywords: ["loyalty program", "website optimization", "inventory", "turnaround", "logistics", "supply chain"],
      confidence: 0.66,
    },
  ];

  for (const r of bulletRules) {
    if (!r.when()) continue;
    reason.bullet_rules_hit.push(r.id);
    reason.keywords.push(...extractKeywordHits(bulletsText, r.keywords));
    return { segment_key: r.segment, confidence: clamp01(r.confidence), reason: { ...reason, keywords: Array.from(new Set(reason.keywords)) } };
  }

  // ---- Unknown policy ----
  if (!title && isNoisyBullets(bullets)) {
    return { segment_key: "unknown", confidence: 0, reason };
  }

  // If we have content but no hits, fall back to overview instead of unknown to reduce unknown rate.
  // This keeps unknown for truly empty/noisy pages.
  return { segment_key: "overview", confidence: 0.35, reason };
}
