/**
 * deck-financial-signals-v1.ts
 *
 * Deterministic regex-based extractor that scans pitch-deck DPU text pages for
 * financial signal mentions.  Works on PDF/PPT-only deals where no XLSX parsers
 * produce data.
 *
 * ── Signal buckets ───────────────────────────────────────────────────────────
 *  revenue_mentions    — revenue/sales/top-line dollar figures
 *  burn_mentions       — burn rate / monthly spend figures
 *  runway_mentions     — cash runway in months
 *  margin_mentions     — gross margin / net margin percentages
 *  pricing_mentions    — per-seat/per-user/subscription pricing
 *  arr_mrr_mentions    — explicit ARR / MRR figures
 *  unit_econ_mentions  — LTV, CAC, ARPU, ACV
 *
 * ── Summary booleans ─────────────────────────────────────────────────────────
 *  has_revenue, has_burn, has_runway, has_pricing, has_arr_mrr, has_unit_economics
 *
 * ── Evidence pointers ────────────────────────────────────────────────────────
 *  Each mention includes: text (the matched snippet), doc_id, page_index
 *
 * Pure function — no I/O, no LLM, no side effects.
 */

// ─── Public types ─────────────────────────────────────────────────────────────

export interface DeckFinancialMention {
  /** The matched text snippet (max 120 chars). */
  text: string;
  /** Source document UUID. */
  doc_id: string;
  /** Zero-based page index within the document. */
  page_index: number;
}

export interface DeckFinancialSignalsV1 {
  schema_version: "deck_financial_signals_v1";
  /** Revenue / sales / top-line dollar mentions. */
  revenue_mentions:   DeckFinancialMention[];
  /** Burn rate / monthly spend mentions. */
  burn_mentions:      DeckFinancialMention[];
  /** Cash runway (months) mentions. */
  runway_mentions:    DeckFinancialMention[];
  /** Gross or net margin percentage mentions. */
  margin_mentions:    DeckFinancialMention[];
  /** Per-seat, per-user, subscription pricing mentions. */
  pricing_mentions:   DeckFinancialMention[];
  /** Explicit ARR / MRR dollar-figure mentions. */
  arr_mrr_mentions:   DeckFinancialMention[];
  /** Unit-economics mentions (LTV, CAC, ARPU, ACV). */
  unit_econ_mentions: DeckFinancialMention[];
  // ── Summary booleans ──────────────────────────────────────────────────────
  has_revenue:         boolean;
  has_burn:            boolean;
  has_runway:          boolean;
  has_pricing:         boolean;
  has_arr_mrr:         boolean;
  has_unit_economics:  boolean;
  /** Total pages scanned. */
  pages_scanned: number;
}

// ─── DpuPage interface (mirrored from processor to avoid circular import) ─────

export interface DeckSignalPage {
  document_id: string;
  page_index:  number;
  text:        string;
}

// ─── Regex patterns ───────────────────────────────────────────────────────────

/** Dollar amount token, e.g. $1.2M, $500K, $2.5B, $3,000,000 */
const AMT = String.raw`\$[\d,]+(?:\.\d+)?\s*[KMBTkmbt]?`;

// Revenue: keyword → $ or $ → keyword
// NOTE: ARR, MRR, annual/monthly recurring are intentionally excluded — those
// signals belong exclusively to arr_mrr_mentions via ARR_MRR_RE.  Including
// them here caused ARR/MRR figures to bleed into revenue_mentions and then into
// the deck revenue value in FTRL.
const REVENUE_RE = new RegExp(
  `(?:${AMT}\\s+(?:revenue|revenues|sales|top[\\-\\s]?line)|` +
  `(?:revenue|revenues|sales|top[\\-\\s]?line)` +
  `(?:[^\\n\\r]{0,25}?)${AMT})`,
  "gi",
);

// ARR / MRR: anchored on ARR or MRR tokens followed by/preceded by amount.
//
// Extended to handle:
//  - "Total ARR / Total MRR" formats: "$1.58M Total ARR"
//  - amounts with "+" or "~" suffix appended by decks: "$40K+ MRR", "$6M+ ARR"
//  - explicit traction table header patterns: "Q-Trust FI ARR" is excluded (no amount)
const ARR_MRR_RE = new RegExp(
  `(?:${AMT}[+~]?\\s+(?:Total\\s+)?(?:ARR|MRR)|` +
  `(?:Total\\s+)?(?:ARR|MRR)\\s*(?:of\\s*)?${AMT}|` +
  `\\d+[KMB]?\\s+(?:ARR|MRR)|(?:ARR|MRR)\\s*[=:]\\s*${AMT})`,
  "gi",
);

// Burn rate / monthly spend
// NOTE: The middle clause ($AMT /month) was intentionally removed — it matched
// any dollar-per-month string with zero semantic context, causing pricing slide
// values to contaminate burn_mentions. Clauses 1 and 3 cover all legitimate
// burn disclosures: "burn $250K", "burn rate $X", "monthly burn $X", etc.
const BURN_RE = new RegExp(
  `(?:burn\\s*(?:rate)?(?:[^\\n]{0,20}?)${AMT}` +
  `|monthly\\s*(?:burn|spend|cost)(?:[^\\n]{0,20}?)${AMT})`,
  "gi",
);

// Runway in months
const RUNWAY_RE = /(?:runway|cash\s+(?:runway|position))(?:[^\n]{0,30}?)\d+[-–]?\d*\s*months?|\d+[-–]\d+\s*months?\s+(?:runway|cash)|(?:runway|cash)\s+(?:of\s*)?\d+\s+months?/gi;

// Margin percentages
const MARGIN_RE = /(?:gross\s*)?margin[s]?,?(?:[^\n]{0,25}?)\d+\.?\d*\s*%|\d+\.?\d*\s*%\s*(?:gross\s*)?margin[s]?/gi;

// Pricing
const PRICING_RE = new RegExp(
  `(?:${AMT}\\s*(?:\\/(?:seat|user|mo|month|yr|year)|\\s+per\\s+(?:seat|user|month|year))|` +
  `(?:price|plan|tier|license)[\\s:]+${AMT}|subscription\\s+(?:of\\s*)?${AMT})`,
  "gi",
);

// Unit economics: LTV, CAC, ARPU, ACV
const UNIT_ECON_RE = new RegExp(
  `(?:LTV|CAC|ARPU|ACV|CLV|CLTV|payback)(?:[^\\n]{0,25}?)${AMT}|${AMT}\\s+(?:LTV|CAC|ARPU|ACV)`,
  "gi",
);

// ─── Extractor ────────────────────────────────────────────────────────────────

const MAX_MENTIONS_PER_BUCKET = 8;

function collectMentions(
  pages: DeckSignalPage[],
  pattern: RegExp,
): DeckFinancialMention[] {
  const seen = new Set<string>();
  const results: DeckFinancialMention[] = [];

  for (const page of pages) {
    if (results.length >= MAX_MENTIONS_PER_BUCKET) break;
    const text = page.text ?? "";
    if (!text.trim()) continue;

    // Reset lastIndex because patterns are global
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text)) !== null && results.length < MAX_MENTIONS_PER_BUCKET) {
      const snippet = m[0].trim().replace(/\s+/g, " ").slice(0, 120);
      if (!snippet) continue;
      const key = `${page.document_id}:${page.page_index}:${snippet.slice(0, 40)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({ text: snippet, doc_id: page.document_id, page_index: page.page_index });
    }
  }

  return results;
}

/**
 * Extract deck financial signals from raw DPU text pages.
 *
 * @param pages - Array of DpuPage-compatible objects (must have .text, .document_id, .page_index).
 * @returns DeckFinancialSignalsV1 or null when pages array is empty.
 */
export function extractDeckFinancialSignalsV1(
  pages: DeckSignalPage[],
): DeckFinancialSignalsV1 | null {
  if (pages.length === 0) return null;

  const revenue_mentions   = collectMentions(pages, REVENUE_RE);
  const arr_mrr_mentions   = collectMentions(pages, ARR_MRR_RE);
  const burn_mentions      = collectMentions(pages, BURN_RE);
  const runway_mentions    = collectMentions(pages, RUNWAY_RE);
  const margin_mentions    = collectMentions(pages, MARGIN_RE);
  const pricing_mentions   = collectMentions(pages, PRICING_RE);
  const unit_econ_mentions = collectMentions(pages, UNIT_ECON_RE);

  // Any signal at all?
  const hasAny =
    revenue_mentions.length > 0 ||
    arr_mrr_mentions.length > 0 ||
    burn_mentions.length > 0 ||
    runway_mentions.length > 0 ||
    margin_mentions.length > 0 ||
    pricing_mentions.length > 0 ||
    unit_econ_mentions.length > 0;

  if (!hasAny) return null;

  return {
    schema_version: "deck_financial_signals_v1",
    revenue_mentions,
    burn_mentions,
    runway_mentions,
    margin_mentions,
    pricing_mentions,
    arr_mrr_mentions,
    unit_econ_mentions,
    has_revenue:        revenue_mentions.length > 0,
    has_burn:           burn_mentions.length > 0,
    has_runway:         runway_mentions.length > 0,
    has_pricing:        pricing_mentions.length > 0,
    has_arr_mrr:        arr_mrr_mentions.length > 0,
    has_unit_economics: unit_econ_mentions.length > 0,
    pages_scanned: pages.length,
  };
}
