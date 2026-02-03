import type { PageType } from "./types";

export interface PageClassification {
  page_type: PageType;
  confidence: number;
  why: string[];
}

export interface ClassificationFeatures {
  keyword_hits: Record<string, number>;
  matched_keywords: Record<string, string[]>;
  currency_count: number;
  percent_count: number;
  year_count: number;
  digit_ratio: number;
  table_like_high: boolean;
}

const KEYWORDS = {
  financials: [
    "revenue",
    "sales",
    "cogs",
    "gross",
    "margin",
    "ebitda",
    "net income",
    "operating",
    "cash flow",
    "balance sheet",
    "assets",
    "liabilities",
    "equity",
    "forecast",
    "budget",
  ],
  terms: [
    "cap table",
    "capitalization",
    "preferred",
    "common",
    "option pool",
    "dilution",
    "valuation",
    "pre-money",
    "post-money",
    "safe",
    "note",
    "interest",
    "maturity",
    "liquidation preference",
  ],
  market: [
    "tam",
    "sam",
    "som",
    "market size",
    "competition",
    "competitor",
    "industry",
    "segments",
    "positioning",
  ],
  product: [
    "platform",
    "product",
    "features",
    "workflow",
    "integration",
    "api",
    "dashboard",
    "module",
    "screenshots",
  ],
  traction: [
    "arr",
    "mrr",
    "bookings",
    "churn",
    "retention",
    "cohorts",
    "pipeline",
    "conversion",
    "cac",
    "ltv",
    "users",
    "growth",
  ],
  timeline: [
    "roadmap",
    "timeline",
    "milestones",
    "q1",
    "q2",
    "quarter",
    "launch",
    "phases",
  ],
  team: [
    "founder",
    "ceo",
    "cto",
    "leadership",
    "experience",
    "board",
    "advisors",
  ],
  legal: [
    "confidentiality",
    "disclaimer",
    "forward-looking",
    "litigation",
    "regulatory",
    "risk factors",
  ],
} as const;

const PAGE_TYPE_FOR_CATEGORY: Record<keyof typeof KEYWORDS, PageType> = {
  financials: "financials_pnl",
  terms: "terms_cap_table",
  market: "market_size",
  product: "product_overview",
  traction: "traction_kpis",
  timeline: "timeline_roadmap",
  team: "team",
  legal: "legal_disclosures",
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countKeywordPresence(textLower: string, keyword: string): boolean {
  const normalizedKeyword = keyword.toLowerCase().trim().replace(/\s+/g, " ");
  const pattern = escapeRegExp(normalizedKeyword).replace(/\s+/g, "\\s+");
  const re = new RegExp(`\\b${pattern}\\b`, "i");
  return re.test(textLower);
}

function countMatches(re: RegExp, text: string): number {
  let n = 0;
  const rr = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
  while (rr.exec(text) !== null) n++;
  return n;
}

function computeDigitRatio(text: string): number {
  const digits = (text.match(/[0-9]/g) ?? []).length;
  const alpha = (text.match(/[A-Za-z]/g) ?? []).length;
  const denom = Math.max(1, digits + alpha);
  return digits / denom;
}

function isTableLikeHigh(text: string, digitRatio: number): boolean {
  const rawLines = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  if (rawLines.length < 6) return false;

  const shortLines = rawLines.filter((l) => l.length <= 60);
  const shortLineRatio = shortLines.length / rawLines.length;

  const multiNumberLines = rawLines.filter((l) => {
    const nums = l.match(/[0-9]+/g) ?? [];
    return nums.length >= 3;
  });
  const multiNumberRatio = multiNumberLines.length / rawLines.length;

  // Heuristic: many short lines + many multi-number lines + high digit density.
  if (shortLineRatio >= 0.6 && multiNumberRatio >= 0.3 && digitRatio >= 0.15) return true;
  if (multiNumberRatio >= 0.5 && digitRatio >= 0.25) return true;
  return false;
}

export function computeClassificationFeatures(normalized_text: string): ClassificationFeatures {
  const textLower = normalized_text.toLowerCase();

  const currency_count = Math.min(
    10,
    countMatches(/\$/g, normalized_text) + countMatches(/\busd\b/gi, normalized_text)
  );
  const percent_count = Math.min(10, countMatches(/\d+(?:\.\d+)?%/g, normalized_text));
  const year_count = Math.min(10, countMatches(/(?:19|20)\d{2}/g, normalized_text));
  const digit_ratio = computeDigitRatio(normalized_text);
  const table_like_high = isTableLikeHigh(normalized_text, digit_ratio);

  const keyword_hits: Record<string, number> = {};
  const matched_keywords: Record<string, string[]> = {};

  (Object.keys(KEYWORDS) as Array<keyof typeof KEYWORDS>).forEach((category) => {
    const kws = KEYWORDS[category];
    const matched: string[] = [];
    for (const kw of kws) {
      if (countKeywordPresence(textLower, kw)) matched.push(kw);
      if (matched.length >= 10) break;
    }
    keyword_hits[category] = matched.length;
    matched_keywords[category] = matched;
  });

  return {
    keyword_hits,
    matched_keywords,
    currency_count,
    percent_count,
    year_count,
    digit_ratio,
    table_like_high,
  };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function classifyPage(
  normalized_text: string,
  features?: ClassificationFeatures
): PageClassification {
  const f = features ?? computeClassificationFeatures(normalized_text);

  const hasAnyKeywordHit = (Object.keys(KEYWORDS) as Array<keyof typeof KEYWORDS>).some(
    (category) => (f.keyword_hits[category] ?? 0) > 0
  );

  const numericScore =
    Math.min(10, f.currency_count) * 0.4 +
    Math.min(10, f.percent_count) * 0.3 +
    Math.min(10, f.year_count) * 0.2 +
    (f.table_like_high ? 2.0 : 0.0);

  const candidates: Array<{ page_type: PageType; category: keyof typeof KEYWORDS; score: number }> = (
    Object.keys(KEYWORDS) as Array<keyof typeof KEYWORDS>
  ).map((category) => {
    const keywordScore = Math.min(10, f.keyword_hits[category] ?? 0) * 1.0;
    return {
      page_type: PAGE_TYPE_FOR_CATEGORY[category],
      category,
      score: keywordScore + numericScore,
    };
  });

  candidates.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    // deterministic tie-break: by page_type name
    if (a.page_type < b.page_type) return -1;
    if (a.page_type > b.page_type) return 1;
    return 0;
  });

  const best = candidates[0];
  const second = candidates[1] ?? best;
  const max_score = best?.score ?? 0;
  const second_score = second?.score ?? 0;

  const chosenType: PageType = !hasAnyKeywordHit || max_score < 3.0 ? "unknown" : best.page_type;

  const rawConfidence = Math.min(1, (max_score - second_score + 1) / (max_score + 2));
  const confidence = chosenType === "unknown" ? 0.2 : clamp(rawConfidence, 0.2, 0.95);

  const why: string[] = [];
  // Always include keyword reasons when present, even if the page is classified as "unknown"
  // due to low max_score. This preserves explainability for low-signal pages.
  const matched = f.matched_keywords[best.category] ?? [];
  for (const kw of matched.slice(0, 6)) {
    why.push(`keyword:${kw}`);
    if (why.length >= 6) break;
  }

  if (why.length < 6 && f.currency_count > 0) why.push(`currency_count:${f.currency_count}`);
  if (why.length < 6 && f.year_count > 0) why.push(`year_count:${f.year_count}`);
  if (why.length < 6 && f.table_like_high) why.push("table_like:true");
  if (why.length < 6 && f.percent_count > 0) why.push(`percent_count:${f.percent_count}`);
  if (why.length < 6) {
    const bucket = f.digit_ratio >= 0.25 ? "high" : f.digit_ratio >= 0.12 ? "medium" : "low";
    why.push(`digit_ratio:${bucket}`);
  }

  // Keep top 3–6 reasons deterministically.
  const whyFinal = why.slice(0, Math.min(6, Math.max(3, why.length)));

  return {
    page_type: chosenType,
    confidence,
    why: whyFinal,
  };
}
