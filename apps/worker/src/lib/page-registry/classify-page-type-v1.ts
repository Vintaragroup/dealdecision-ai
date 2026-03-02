/**
 * classify-page-type-v1.ts
 *
 * Conservative deterministic page type classifier.
 *
 * Priority order (first rule that fires wins):
 *  1. ask          — raise/funding/valuation signals
 *  2. use_of_funds — how funds will be used
 *  3. financials   — financial statements / metrics (income, cash, balance)
 *  4. traction     — growth metrics: ARR, MRR, users, retention
 *  5. market       — TAM/SAM/SOM, market size
 *  6. competition  — competitors/competitive landscape
 *  7. team         — founder/CEO/team biographies
 *  8. product      — how the product works, features, workflow
 *  9. risks        — risk factors, challenges
 * 10. gtm          — go-to-market, sales channels, distribution
 * 11. unknown      — nothing triggered with sufficient confidence
 *
 * Each rule has:
 * - patterns: test against full page text (case-insensitive)
 * - minHits: how many patterns must match to fire
 * - confidence: returned confidence if fired
 *
 * Never throws — returns { page_type: "unknown", confidence: "low" } on error.
 */

import type { PageTypeV1, PageConfidenceV1, NumericClaimV1, PageEntityV1 } from "@dealdecision/core";

export interface PageTypeResult {
  page_type: PageTypeV1;
  confidence: PageConfidenceV1;
  /** Which rule name fired (for debugging). */
  rule?: string;
}

// ─── Rule definition ──────────────────────────────────────────────────────────

interface PageTypeRule {
  type: PageTypeV1;
  patterns: RegExp[];
  minHits: number;
  confidence: PageConfidenceV1;
}

// ─── Rules table ──────────────────────────────────────────────────────────────
// Note: Rules are evaluated in order; first match wins.

const PAGE_TYPE_RULES: PageTypeRule[] = [
  // ── Ask / Raise ────────────────────────────────────────────────────────────
  {
    type: "ask",
    patterns: [
      /\bthe ask\b/i,
      /\braising\s+\$?[\d.]+[mkbMKB]/i,
      /\bwe\s+are\s+raising\b/i,
      /\bseeking\s+\$?[\d.]+[mkbMKB]/i,
      /\bfunding\s+round\b/i,
      /\buse\s+of\s+(proceeds|funds)\b/i,
      /\bvaluation\s+cap\b/i,
      /\bpre[-\s]money\b|\bpost[-\s]money\b/i,
      /\bconvertible\s+note\b|\bsafe\s+note\b|\bsafe\b.*\binvest/i,
      /\bterm\s+sheet\b/i,
      /\binvestment\s+opportunity\b/i,
      /\bclose\s+(?:the\s+)?round\b/i,
    ],
    minHits: 2,
    confidence: "high",
  },
  // ── Ask — single strong signal ─────────────────────────────────────────────
  {
    type: "ask",
    patterns: [
      /\bthe ask\b/i,
    ],
    minHits: 1,
    confidence: "medium",
  },

  // ── Use of Funds ───────────────────────────────────────────────────────────
  {
    type: "use_of_funds",
    patterns: [
      /\buse\s+of\s+(?:funds|proceeds|capital|money)\b/i,
      /\bhow\s+(?:we['']ll\s+)?(?:use|allocate|deploy)\s+(?:the\s+)?(?:funds|capital|proceeds)\b/i,
      /\bfund\s+allocation\b/i,
      /\ballocation\s+(?:of\s+)?(?:funds|capital)\b/i,
      /\boperations?\b.*\bmarketing\b.*\bR&D\b/i, // typical use-of-funds breakdown
    ],
    minHits: 1,
    confidence: "high",
  },

  // ── Financials ─────────────────────────────────────────────────────────────
  {
    type: "financials",
    patterns: [
      /\bincome\s+statement\b/i,
      /\bbalance\s+sheet\b/i,
      /\bcash\s+flow\b/i,
      /\bfinancial\s+(?:statements?|projections?|highlights?|summary|overview)\b/i,
      /\bgross\s+(?:margin|profit)\b/i,
      /\bebitda\b/i,
      /\bnet\s+(?:income|revenue|loss)\b/i,
      /\boperating\s+expense[s]?\b/i,
      /\bcapex\b|\bopex\b/i,
      /\bp&l\b|\bprofit\s*(?:&|and)\s*loss\b/i,
    ],
    minHits: 2,
    confidence: "high",
  },
  {
    type: "financials",
    patterns: [
      /\bgross\s+(?:margin|profit)\b/i,
      /\bebitda\b/i,
      /\bp&l\b/i,
    ],
    minHits: 1,
    confidence: "medium",
  },

  // ── Traction ───────────────────────────────────────────────────────────────
  {
    type: "traction",
    patterns: [
      /\barr\b.*\$?[\d]/i,
      /\bmrr\b.*\$?[\d]/i,
      /\b(monthly|annual)\s+recurring\s+revenue\b/i,
      /\b[\d,]+\s*(paying\s+)?customers?\b/i,
      /\b[\d,]+\s*(monthly\s+)?(?:users?|subscribers?|downloads?)\b/i,
      /\bretention\s+rate\b/i,
      /\bchurn\s+(?:rate)?\b/i,
      /\bgrowth\s+rate\b/i,
      /\bcustomer\s+(?:growth|count|traction)\b/i,
      /\b(?:nps|net\s+promoter\s+score)\b/i,
      /\brevenue\s+(?:grew?|growth|traction)\b/i,
    ],
    minHits: 2,
    confidence: "high",
  },
  {
    type: "traction",
    patterns: [
      /\b(arr|mrr)\b/i,
      /\b\d[\d,]+\s+(?:users?|customers?)\b/i,
    ],
    minHits: 1,
    confidence: "medium",
  },

  // ── Market ─────────────────────────────────────────────────────────────────
  {
    type: "market",
    patterns: [
      /\btam\b/i,
      /\bsam\b/i,
      /\bsom\b/i,
      /\btotal\s+addressable\s+market\b/i,
      /\bmarket\s+(?:size|opportunity|potential|landscape|overview)\b/i,
      /\bindustry\s+(?:size|growth|trends?)\b/i,
      /\b\$[\d.]+[bB]\s+market\b/i,
      /\bmarket\s+segmentation\b/i,
    ],
    minHits: 2,
    confidence: "high",
  },
  {
    type: "market",
    patterns: [
      /\btam\b/i,
      /\btotal\s+addressable\s+market\b/i,
    ],
    minHits: 1,
    confidence: "medium",
  },

  // ── Competition ────────────────────────────────────────────────────────────
  {
    type: "competition",
    patterns: [
      /\bcompetitive\s+(?:landscape|analysis|matrix|overview|advantage)\b/i,
      /\bcompetitors?\b/i,
      /\bvs\.?\s+[A-Z][a-z]/,
      /\bunlike\s+(?:our\s+)?competitors?\b/i,
      /\bcompetition\b/i,
      /\bmarket\s+players?\b/i,
      /\bcurrent\s+solutions?\b/i,
    ],
    minHits: 2,
    confidence: "high",
  },
  {
    type: "competition",
    patterns: [
      /\bcompetitive\s+landscape\b/i,
      /\bcompetitors?\b/i,
    ],
    minHits: 1,
    confidence: "medium",
  },

  // ── Team ───────────────────────────────────────────────────────────────────
  {
    type: "team",
    patterns: [
      /\b(?:meet\s+(?:the\s+)?)?(?:our\s+)?team\b/i,
      /\bfounder[s]?\b/i,
      /\bco[-\s]?founder[s]?\b/i,
      /\bceo\b.*\bcto\b|\bcto\b.*\bceo\b/i,
      /\b(?:led by|manages|management\s+team)\b/i,
      /\byears?\s+of\s+experience\b/i,
      /\bpreviously\s+(?:at|worked|founded|led)\b/i,
      /\blinkedin\b/i,
      /\badvisors?\b.*\bboard\b|\bboard\b.*\badvisors?\b/i,
    ],
    minHits: 2,
    confidence: "high",
  },
  {
    type: "team",
    patterns: [
      /\b(founder|co-founder)\b/i,
      /\bceo\b/i,
    ],
    minHits: 1,
    confidence: "medium",
  },

  // ── Product ────────────────────────────────────────────────────────────────
  {
    type: "product",
    patterns: [
      /\bhow\s+it\s+works?\b/i,
      /\bour\s+(?:product|solution|platform|service)\b/i,
      /\bkey\s+features?\b/i,
      /\bworkflow\b/i,
      /\bintegration[s]?\b/i,
      /\btechnology\s+(?:stack|overview)\b/i,
      /\buser\s+(?:journey|flow|experience)\b/i,
      /\bproduct\s+(?:overview|demo|roadmap|features?)\b/i,
      /\bsolution\s+overview\b/i,
    ],
    minHits: 2,
    confidence: "high",
  },
  {
    type: "product",
    patterns: [
      /\bhow\s+it\s+works?\b/i,
      /\bour\s+(?:product|platform)\b/i,
    ],
    minHits: 1,
    confidence: "medium",
  },

  // ── Risks ──────────────────────────────────────────────────────────────────
  {
    type: "risks",
    patterns: [
      /\brisk\s+factors?\b/i,
      /\bkey\s+risks?\b/i,
      /\bchallenges?\b/i,
      /\bconsiderations?\b/i,
      /\blimitations?\b/i,
      /\brisk(?:s)?\s+and\s+mitigations?\b/i,
    ],
    minHits: 2,
    confidence: "high",
  },
  {
    type: "risks",
    patterns: [
      /\brisk\s+factors?\b/i,
    ],
    minHits: 1,
    confidence: "medium",
  },

  // ── GTM / Distribution ────────────────────────────────────────────────────
  {
    type: "gtm",
    patterns: [
      /\bgo[-\s]to[-\s]market\b/i,
      /\bgtm\s+strategy\b/i,
      /\bsales\s+(?:strategy|channels?|motion|cycle|process)\b/i,
      /\bdistribution\s+(?:channel|strategy)\b/i,
      /\bcustomer\s+acquisition\s+(?:strategy|cost|channel)\b/i,
      /\bmarketing\s+(?:strategy|channels?|mix)\b/i,
      /\bpartner\s+(?:channel|ecosystem)\b/i,
    ],
    minHits: 2,
    confidence: "high",
  },
  {
    type: "gtm",
    patterns: [
      /\bgo[-\s]to[-\s]market\b/i,
    ],
    minHits: 1,
    confidence: "medium",
  },
];

// ─── Classifier ───────────────────────────────────────────────────────────────

/**
 * Classify page type from page text, numeric claims, and entities.
 * Priority: deterministic keyword rules (first match wins).
 * Falls back to "unknown" / "low" if no rule fires.
 *
 * @param pageText — pre-resolved best page text
 * @param numericClaims — output of extractNumericClaims (used for signal boost)
 * @param entities — output of extractEntities (unused in v1 rules but available)
 */
export function classifyPageTypeV1(
  pageText: string,
  _numericClaims: NumericClaimV1[] = [],
  _entities: PageEntityV1[] = [],
): PageTypeResult {
  try {
    if (!pageText || !pageText.trim()) {
      return { page_type: "unknown", confidence: "low" };
    }

    const text = pageText;

    for (const rule of PAGE_TYPE_RULES) {
      let hits = 0;
      for (const pattern of rule.patterns) {
        if (pattern.test(text)) hits++;
        if (hits >= rule.minHits) break;
      }
      if (hits >= rule.minHits) {
        return {
          page_type: rule.type,
          confidence: rule.confidence,
          rule: `${rule.type}:min${rule.minHits}`,
        };
      }
    }

    return { page_type: "unknown", confidence: "low" };
  } catch {
    return { page_type: "unknown", confidence: "low" };
  }
}
