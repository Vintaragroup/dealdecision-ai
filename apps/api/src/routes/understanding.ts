import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { z } from "zod";

import { getPool } from "../lib/db";
import { enrichDeterministically } from "../understanding/enrich";
import { getLatestUnderstandingPatch, persistUnderstandingPatch } from "../understanding/persist";

import type { DeterministicUnderstandingInput } from "../understanding/types";

function isUuid(value: string): boolean {
  return z.string().uuid().safeParse(value).success;
}

// ---------------------------------------------------------------------------
// Narrative numeric-consistency helpers
//
// These functions are intentionally generic and pattern-based — they do not
// reference specific deal IDs or hard-coded values. They guard against a class
// of narrative inconsistency that arises when:
//   (a) extracted go-to-market slide text contains hypothetical ARR projections
//       ("yielding ~$139M ARR"), or
//   (b) LLM-generated deal-summary paragraphs assert a raise amount that is
//       orders of magnitude larger than the trusted structured raise value.
// ---------------------------------------------------------------------------

/**
 * Large-dollar pattern: matches $X[M|MM|million|B|billion] in text.
 * Uses a global flag so matchAll can iterate multiple hits in one string.
 */
const LARGE_DOLLAR_RE = /\$\s*([\d,]+(?:\.\d+)?)\s*(B(?:illion)?|MM?|million)\b/gi;

/**
 * Returns the numeric dollar value encoded by a LARGE_DOLLAR_RE match group.
 */
function parseDollarMatchAmount(numStr: string, suffixStr: string): number {
  const n = parseFloat(numStr.replace(/,/g, ""));
  if (!Number.isFinite(n)) return NaN;
  const s = suffixStr.toLowerCase();
  if (s === "b" || s.startsWith("bill")) return n * 1e9;
  return n * 1e6; // M, MM, million
}

/**
 * Projection / hypothetical keywords that, combined with a large-dollar claim,
 * indicate a forward-looking assumption rather than a reported fact.
 */
const PROJECTION_KEYWORD_RE =
  /\b(?:yielding|yield(?:s)?|projected?|projection|forecast(?:ed|s)?|could\s+reach|would(?:\s+be)?\s+generate|assuming|hypothetical|implies?\s+a|representing|translat(?:e[sd]?|ing)\s+to|would\s+translate|potentially\s+generat|may\s+generat)\b/i;

/**
 * Returns "" when `text` is dominated by numeric or floating-point tokens,
 * which indicates XLSX chart-backing coordinates or raw spreadsheet cell data
 * leaked into a narrative field (e.g. "25 729.21875 1139.53125 1560.9375…"
 * from an XLSX chart source column, or "Sheet: For Charts 2 5 11 200 1800…"
 * from a revenue projection table).
 *
 * Guard fires when ALL of the following are true:
 *   - text has at least 8 whitespace-delimited tokens
 *   - more than 40% of those tokens are pure numeric values
 *     (integers, decimals, or negative numbers; optionally with commas)
 *
 * Short strings (< 8 tokens) are left untouched to avoid false positives on
 * legitimate short financial references like "$2M raise" or "Q3 2026".
 */
export function rejectIfNumericDominated(text: string): string {
  if (!text) return "";
  const tokens = text.trim().split(/\s+/);
  if (tokens.length < 8) return text;
  const numericCount = tokens.filter((t) => /^-?[\d,]*\.?\d+$/.test(t)).length;
  return numericCount / tokens.length > 0.4 ? "" : text;
}

/**
 * Splits `text` into sentences and removes any sentence that contains both:
 *   - a dollar amount ≥ $50M (M, MM, million, B, billion notation), AND
 *   - a projection/hypothetical keyword (e.g. "yielding", "projected", "could reach").
 *
 * This strips lines like "yielding ~$139M ARR" while leaving factual mentions
 * of dollar amounts that are not framed as forward-looking projections.
 */
export function stripHypotheticalDollarProjectionSentences(text: string): string {
  if (!text) return "";
  // Split on sentence boundaries, keeping the delimiter attached to the preceding sentence.
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const clean = sentences.filter((sentence) => {
    const dollarMatches = [...sentence.matchAll(new RegExp(LARGE_DOLLAR_RE.source, "gi"))];
    if (dollarMatches.length === 0) return true; // no dollar amount → keep
    const hasLargeDollar = dollarMatches.some(
      (m) => parseDollarMatchAmount(m[1] ?? "", m[2] ?? "") >= 50_000_000,
    );
    if (!hasLargeDollar) return true; // amount below threshold → keep
    return !PROJECTION_KEYWORD_RE.test(sentence); // keep only if no projection keyword
  });
  return clean.join(" ").trim();
}

/**
 * Parses the numeric value from a formatted raise string like "$2MM", "$4M",
 * "$375 million", "$1.5B", etc.  Returns NaN when the format is unrecognised.
 */
function parseTrustedRaiseAmount(raiseValueStr: string | null | undefined): number {
  if (!raiseValueStr || typeof raiseValueStr !== "string") return NaN;
  const m = raiseValueStr.match(/\$?\s*([\d,]+(?:\.\d+)?)\s*(B(?:illion)?|MM?|million|K|thousand)?\b/i);
  if (!m) return NaN;
  const n = parseFloat(m[1].replace(/,/g, ""));
  if (!Number.isFinite(n)) return NaN;
  const s = (m[2] ?? "").toLowerCase();
  if (s === "b" || s.startsWith("bill")) return n * 1e9;
  if (s === "k" || s.startsWith("thou")) return n * 1e3;
  return n * 1e6;
}

/**
 * Returns an empty string when `text` contains an explicit raise-amount assertion
 * (e.g. "The proposed raise is set at $375 million") whose value is ≥ 20× the
 * `trustedRaiseValueStr` from the persisted structured summary.  Otherwise returns
 * `text` unchanged.
 *
 * This only fires when the text contains an unambiguous raise assertion pattern so
 * that incidental mentions of large numbers are left untouched.
 */
export function suppressIfRaiseAmountOverstated(
  text: string,
  trustedRaiseValueStr: string | null | undefined,
): string {
  if (!text) return "";
  const trustedAmount = parseTrustedRaiseAmount(trustedRaiseValueStr);
  if (!Number.isFinite(trustedAmount) || trustedAmount <= 0) return text; // no trusted value → keep

  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  for (const sentence of sentences) {
    const isRaiseAssertion =
      /\b(?:proposed\s+raise|raise\s+(?:is|of)|rais(?:ing|ed))\b/i.test(sentence);
    if (!isRaiseAssertion) continue;
    const dollarMatches = [
      ...sentence.matchAll(new RegExp(LARGE_DOLLAR_RE.source, "gi")),
    ];
    for (const m of dollarMatches) {
      const claimed = parseDollarMatchAmount(m[1] ?? "", m[2] ?? "");
      if (Number.isFinite(claimed) && claimed > trustedAmount * 20) {
        return ""; // suppress the whole paragraph — the raise claim is 20× off
      }
    }
  }
  return text;
}

/**
 * Classify a long-form PDF page into a narrative segment using its opening text.
 *
 * Long-form text PDFs (investor memos, marketing plans, strategy documents) are
 * processed by the vision worker as `pdf_text` pages, which do NOT pass through
 * the structured-asset segment classifier (`inferSegmentKeyFromStructured`).  As
 * a result, all their pages arrive in the DPU pipeline with segment_key="unknown"
 * and are effectively invisible to the understanding field chains.
 *
 * This function provides a read-time fallback: given the raw page text, it looks
 * for section-heading patterns in the first 220 chars (where PDF section headings
 * appear) and returns the matching segment key, or "" when no confident match.
 *
 * Safety constraints:
 *   - Only uses the opening text to avoid classifying body prose as a segment
 *   - Requires a match in a curated, conservative keyword set
 *   - Never writes to any table — purely in-memory inference
 *   - Only activated when DPU named-segment coverage for the deal is < 15%
 *     (i.e., the deal consists almost entirely of unsegmented long-form PDFs)
 */
function classifyLongFormPdfPageHeading(pageText: string): string {
  const header = pageText.slice(0, 220).toLowerCase().replace(/\s+/g, " ").trim();
  if (header.length < 20) return "";

  // Reject document cover / title / table-of-contents pages — these are metadata, not content
  if (/\bprepared (?:for|by)\b|\bdocument title\b|\btable of contents\b/.test(header)) return "";

  // Distribution / GTM / company-overview — highest utility for what_company_does,
  // go_to_market, market_positioning, competitive_differentiation.
  if (
    /\bgo[\s-]to[\s-]market\b|\bsales (strategy|infrastructure|funnel|channel)\b|\bdistribution (strategy|channel|model)\b|\bchannel (strategy|partner)\b|\bmarket entry\b/.test(header) ||
    /\bexecutive summary\b|\bcompany overview\b|\bbrand accelerator\b|\binvestment platform\b|\bportfolio (strategy|approach|overview|mission)\b|\bbrand positioning\b/.test(header)
  ) return "distribution";

  // Revenue / business model
  if (
    /\bproduct margin\b|\brevenue (model|streams?|strategy|generation)\b|\bbusiness model\b|\bhow we make money\b|\bpricing (model|strategy)\b|\bunit economics\b|\bmargin strategy\b/.test(header)
  ) return "business_model";

  // Why-now / traction timing signals
  if (
    /\bacquirer appetite\b|\bwhy now\b|\bmarket (timing|window|momentum)\b|\bindustry (momentum|landscape|trends?)\b/.test(header) ||
    // "at-a-glance" pattern covers both compact ("at-a-glance") and OCR-spaced
    // forms ("At - A - Glance") produced when hyphens are extracted with
    // surrounding spaces.
    /\bat\s*-?\s*a\s*-?\s*glance\b|\bcompany (highlights?|snapshot|metrics)\b|\bkey (metrics|highlights)\b/.test(header)
  ) return "traction";

  // Solution / product-description — how-it-works and problem-framing slides.
  if (
    /\bhow it works?\b|\bour (?:solution|technology|platform)\b|\bproduct overview\b|\bone (?:solution|platform)\b/.test(header) ||
    // "Aims to solve / address" slides describe the company's core problem-solution
    // thesis and provide substantive narrative for the solution understanding field.
    /\baims? to (?:solve|address|transform)\b|\b(?:solving|addressing) (?:a|the|one of the)\b/.test(header)
  ) return "solution";

  // Team
  if (/\b(leadership|management|founding|advisory) team\b|\bkey personnel\b/.test(header)) return "team";

  // Risks
  if (/\bkey risks\b|\brisk (analysis|overview|framework|mitigation)\b/.test(header)) return "risks";

  return "";
}

const deterministicUnderstandingBodySchema = z
  .object({
    deal_id: z.string().optional(),
    documents: z.array(z.any()),
    pages: z.array(z.any()),
    segments: z.array(z.any()).optional(),
  })
  .passthrough();

type DeterministicUnderstandingBody = z.infer<typeof deterministicUnderstandingBodySchema>;

export async function registerUnderstandingRoutes(app: FastifyInstance, poolOverride?: Pool) {
  const pool = poolOverride ?? getPool();

  app.post("/api/v1/deals/:dealId/understanding/deterministic", async (request, reply) => {
    const dealId = (request.params as any)?.dealId as string;
    if (!isUuid(dealId)) {
      return reply.status(400).send({ error: "Invalid dealId (expected UUID)" });
    }

    const parsed = deterministicUnderstandingBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid input", details: parsed.error.flatten() });
    }

    const body: DeterministicUnderstandingBody = parsed.data;
    if (typeof body.deal_id === "string" && body.deal_id.length > 0 && body.deal_id !== dealId) {
      return reply.status(400).send({ error: "deal_id in body must match dealId path param" });
    }

    const input: DeterministicUnderstandingInput = {
      ...(body as any),
      deal_id: dealId,
    };

    const patch = enrichDeterministically(input);
    const stored = await persistUnderstandingPatch(patch, { pool });

    return reply.send({
      analysis_version: stored.analysis_version,
      input_hash: stored.input_hash,
      created_at: stored.created_at,
      patch: stored.patch,
    });
  });

  app.get("/api/v1/deals/:dealId/understanding/deterministic", async (request, reply) => {
    const dealId = (request.params as any)?.dealId as string;
    if (!isUuid(dealId)) {
      return reply.status(400).send({ error: "Invalid dealId (expected UUID)" });
    }

    const latest = await getLatestUnderstandingPatch(dealId, "deterministic_understanding_v1", { pool });
    if (!latest) {
      return reply.status(404).send({ error: "Deterministic understanding patch not found" });
    }

    return reply.send({
      analysis_version: latest.analysis_version,
      input_hash: latest.input_hash,
      created_at: latest.created_at,
      patch: latest.patch,
    });
  });

  /**
   * GET /api/v1/deals/:dealId/understanding
   *
   * Returns a structured deal-understanding object composed from existing
   * pipeline outputs stored in deal_intelligence_objects. Fields are best-effort
   * derivations from phase1 analysis; individual fields may be null if the
   * relevant analysis has not run or produced no output.
   */
  app.get("/api/v1/deals/:dealId/understanding", async (request, reply) => {
    const dealId = (request.params as any)?.dealId as string;
    if (!isUuid(dealId)) {
      return reply.status(400).send({ error: "Invalid dealId (expected UUID)" });
    }

    const dealCheck = await pool.query(`SELECT id FROM deals WHERE id = $1 LIMIT 1`, [dealId]);
    if (!dealCheck.rows?.length) {
      return reply.status(404).send({ error: "Deal not found" });
    }

    let dioData: Record<string, any> | null = null;
    const dioResult = await pool.query(
      `SELECT dio_data
         FROM deal_intelligence_objects
        WHERE deal_id = $1
        ORDER BY analysis_version DESC, updated_at DESC NULLS LAST, dio_id DESC
        LIMIT 1`,
      [dealId],
    );
    dioData = dioResult.rows?.[0]?.dio_data ?? null;

    const phase1 = dioData?.dio?.phase1 ?? null;
    const overviewV2 = phase1?.deal_overview_v2 ?? null;
    const dealSummarySummary = phase1?.deal_summary_v2?.summary ?? null;
    const dealSummaryV2Risks: unknown[] = Array.isArray(phase1?.deal_summary_v2?.risks)
      ? (phase1!.deal_summary_v2.risks as unknown[])
      : [];
    const archetypeV1 = phase1?.business_archetype_v1 ?? null;
    const reportSS = dioData?.report?.structured_summary ?? null;
    const execSummaryV1 = phase1?.executive_summary_v1 ?? null;

    // DPU page text by segment key — supplementary fallback for fields not populated by DIO.
    // MIME type is joined so that narrative fields can exclude spreadsheet-origin pages.
    const dpuResult = await pool.query(
      `SELECT dpu.payload->'structured'->>'segment_key' as seg,
              dpu.payload->>'page_text' as txt,
              COALESCE(docs.mime_type, '') as doc_mime_type
         FROM document_page_understanding dpu
         LEFT JOIN documents docs ON docs.id = dpu.document_id
        WHERE dpu.deal_id = $1
          AND dpu.payload->>'page_text' IS NOT NULL
        ORDER BY dpu.page_index`,
      [dealId],
    );
    // MIME pattern for spreadsheet files (XLSX / XLS).  Pages originating from
    // spreadsheet documents must not win narrative understanding fields because
    // XLSX cells — budget rows, revenue projections, chart-backing series — are
    // tabular financial data that is never appropriate as narrative content.
    const SPREADSHEET_MIME_RE = /spreadsheetml|vnd\.ms-excel/i;
    // Content-level guard — catches orphaned DPU rows whose parent document record
    // was deleted or is missing from the documents table (mime_type = NULL after
    // LEFT JOIN).  Excel cell-range headers ("Sheet1 A1:T40") are uniquely produced
    // by the XLSX extraction pipeline and never appear in narrative PDF pages.
    const SPREADSHEET_PAGE_CONTENT_RE = /\bSheet\d+\s+[A-Z]+\d+:[A-Z]+\d+\b/;

    const dpuBySegment: Record<string, string[]> = {};
    // Narrative-only segment map: excludes pages from spreadsheet documents so
    // that XLSX budget sheets, allocation tables, and chart data cannot win
    // fields like what_company_does, traction_summary, go_to_market, etc.
    const dpuNarrativeBySegment: Record<string, string[]> = {};
    // Financial balance-sheet content guard: a PDF page tagged segment_key="product" by the
    // visual classifier may contain balance-sheet liability table data (e.g. pro-forma combined
    // financials filed as SEC exhibit EX-99.5).  Such pages must not enter dpuNarrativeBySegment
    // for the "product" bucket because dpuProductText directly populates business_model and
    // revenue_model.  The guard fires on exclusive balance-sheet line-item phrases that cannot
    // appear in any legitimate product-description slide:
    //   - "term loan" or "net of discounts" — balance-sheet debt line items
    //   - "total liabilities" — balance-sheet summary row
    //   - "convertible notes payable" — convertible debt line item
    //   - "derivative warrant" — warrant liability classification
    //   - "lease liabilities" — operating/finance lease line item
    const BALANCE_SHEET_PAGE_RE = /\b(?:term loan\b|net of discounts?|total liabilities|convertible notes? payable\b|derivative warrant|lease liabilities)/i;
    for (const row of dpuResult.rows ?? []) {
      const seg: string = row.seg ?? "";
      const txt: string = row.txt ?? "";
      const mimeType: string = row.doc_mime_type ?? "";
      if (seg && txt) {
        if (!dpuBySegment[seg]) dpuBySegment[seg] = [];
        dpuBySegment[seg].push(txt);
        // Exclude a page if either: (a) its document has a spreadsheet MIME type, or
        // (b) the page text itself contains Excel cell-range notation — the latter
        // covers orphaned DPU rows whose parent document no longer exists in `documents`,
        // or (c) it is a "product"-labeled page whose content is a financial balance-sheet
        // table (pro-forma financials PDF misclassified at extraction time).
        const isSpreadsheetPage = SPREADSHEET_MIME_RE.test(mimeType) || SPREADSHEET_PAGE_CONTENT_RE.test(txt);
        const isBalanceSheetProductPage = seg === "product" && BALANCE_SHEET_PAGE_RE.test(txt);
        if (!isSpreadsheetPage && !isBalanceSheetProductPage) {
          if (!dpuNarrativeBySegment[seg]) dpuNarrativeBySegment[seg] = [];
          dpuNarrativeBySegment[seg].push(txt);
        }
      }
    }

    // Second pass: recover narrative content from long-form PDF pages that the
    // visual classifier does not segment (segment_key = "unknown").
    //
    // Rationale: vision-worker extracted pdf_text pages never pass through
    // inferSegmentKeyFromStructured, so their segment_key remains "unknown" in
    // structured_json.  The loop above adds them to dpuBySegment["unknown"] /
    // dpuNarrativeBySegment["unknown"] — buckets that no understanding field
    // ever reads.  The result is that all narrative content from memo-style PDFs
    // is silently dropped from every field chain.
    //
    // Safety gate: only activate when named-segment coverage for this deal is
    // < 15 % of all DPU pages (i.e. the deal is composed almost entirely of
    // unsegmented long-form PDFs).  For deck-heavy benchmark deals where > 85 %
    // of pages already have named segments, this path never runs.
    //
    // Pages are classified using classifyLongFormPdfPageHeading() which examines
    // only the first 220 chars (where section headings are visible) and requires
    // a conservative keyword match.  Body-only continuation pages \u2014 which have no
    // section heading in their opening text \u2014 return "" and are not added.
    const namedSegmentPageCount = (dpuResult.rows ?? []).filter((r) => {
      const s = r.seg ?? "";
      return s && s !== "unknown";
    }).length;
    const totalDpuPageCount = (dpuResult.rows ?? []).length;
    const isWeakDpuCoverage =
      totalDpuPageCount > 0 && namedSegmentPageCount / totalDpuPageCount < 0.15;

    if (isWeakDpuCoverage) {
      for (const row of dpuResult.rows ?? []) {
        const seg: string = row.seg ?? "";
        // Skip pages already in a named segment \u2014 they are already handled above.
        if (seg && seg !== "unknown") continue;
        const txt: string = row.txt ?? "";
        const mimeType: string = row.doc_mime_type ?? "";
        if (!txt) continue;
        const isSpreadsheetPage =
          SPREADSHEET_MIME_RE.test(mimeType) || SPREADSHEET_PAGE_CONTENT_RE.test(txt);
        if (isSpreadsheetPage) continue;
        const inferredSeg = classifyLongFormPdfPageHeading(txt);
        if (!inferredSeg) continue;
        // Add to narrative bucket only (these pages are guaranteed non-spreadsheet
        // by the guard above, so they are always narrative-safe).
        if (!dpuNarrativeBySegment[inferredSeg]) dpuNarrativeBySegment[inferredSeg] = [];
        dpuNarrativeBySegment[inferredSeg].push(txt);
      }
    }

    function asStr(v: unknown): string {
      return typeof v === "string" && v.trim() ? v.trim() : "";
    }

    function asKnownStr(v: unknown): string {
      const s = asStr(v);
      if (!s) return "";
      return /^(unknown|n\/?a|none)$/i.test(s) ? "" : s;
    }

    function firstKnown(...values: unknown[]): string {
      for (const v of values) {
        const s = asKnownStr(v);
        if (s) return s;
      }
      return "";
    }

    function joinArray(v: unknown): string {
      if (!Array.isArray(v)) return "";
      return v
        .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
        .map((x) => x.trim())
        .join("; ");
    }

    function normalizeWhitespace(v: string): string {
      return v.replace(/\s+/g, " ").trim();
    }

    function appendSignal(signals: string[], sentence: string): void {
      const next = normalizeWhitespace(sentence);
      if (!next) return;
      const nextLc = next.toLowerCase();
      if (signals.some((s) => s.toLowerCase() === nextLc)) return;
      signals.push(next);
    }

    // Returns true when a risk string is a generic LLM placeholder rather than an
    // extracted business risk (e.g. "Missing evidence for key metrics...",
    // "Low confidence score suggests..."). Filtered before DPU distribution fallback.
    function isGenericRiskEntry(s: unknown): boolean {
      if (typeof s !== "string") return false;
      const trimmed = (s as string).trim();
      return (
        /^(missing evidence|low confidence score|lacks?\s|competition poses a significant risk)/i.test(trimmed) ||
        /^competition$/i.test(trimmed) ||
        /could affect long-term/i.test(trimmed) ||
        /may impact user\s+trust/i.test(trimmed) ||
        /^retention\s+risk$/i.test(trimmed) ||
        /^security\s*(\/|and)\s*privacy/i.test(trimmed)
      );
    }

    // Returns true when all traction signals match a generic placeholder pattern
    // (e.g. "Growth mentioned", "ARR mentioned", "Retention / churn mentioned"). When true,
    // DPU financials/traction slide text is preferred over these low-information signals.
    function isGenericTractionSignals(signals: unknown): boolean {
      if (!Array.isArray(signals) || signals.length === 0) return true;
      // Fast path: every signal ends with "mentioned" — these are pure category labels
      // with no embedded values ("ARR mentioned", "Revenue mentioned", etc.).
      if (signals.every((s): s is string => typeof s === "string" && /\bmentioned\.?$/i.test(s.trim()))) return true;
      // Legacy: original narrow pattern for well-known "X mentioned" forms.
      return signals.every(
        (s): s is string =>
          typeof s === "string" &&
          /^(?:growth|customers?|pilots?|partnerships?|traction)(?:\s*[\/&,]\s*(?:growth|customers?|pilots?|partnerships?|traction))*\s+mentioned\.?$/i.test(
            s.trim(),
          ),
      );
    }

    // Per-segment DPU text — joins all pages for a given segment key.
    const dpuJoin = (key: string): string =>
      (dpuBySegment[key] ?? []).join(" ").replace(/\s+/g, " ").trim();

    // Joins pages from narrative (non-spreadsheet) documents only.
    // Always prefer this over dpuJoin() for narrative understanding fields so
    // that XLSX-sourced pages cannot win company description, traction, GTM, etc.
    const dpuNarrativeJoin = (key: string): string =>
      (dpuNarrativeBySegment[key] ?? []).join(" ").replace(/\s+/g, " ").trim();

    // Narrative product/traction text (non-XLSX sources only).
    const dpuProductText    = dpuNarrativeJoin("product");
    const dpuTractionText   = dpuNarrativeJoin("traction");

    // Chart-OCR guard for product text used in business/revenue model fields.
    // Deck pages classified as "product" may be market-penetration expansion slides
    // whose text is dominated by chart axis sequences (e.g. "0.10% 0.09% 0.08%..."
    // or "5000 4500 4000 3500 3000...") rather than narrative product descriptions.
    // When detected, suppress product text from business_model and revenue_model so
    // those chains fall through to the second-pass business_model narrative instead.
    // Patterns:
    //   (?:\d\.\d{2}%\s+){3,}  — 3+ adjacent decimal-percentage tokens (chart y-axis)
    //   (?:\d{3,5}\s+){5,}     — 5+ adjacent 3-5 digit numbers (numeric chart axis)
    const CHART_OCR_RE = /(?:\d\.\d{2}%\s+){3,}|(?:\d{3,5}\s+){5,}/;
    const dpuProductTextForBizModel = CHART_OCR_RE.test(dpuProductText) ? "" : dpuProductText;

    // Full financials text (all sources including XLSX) — kept for financial
    // analysis contexts (dpuFinancialsForCustomer phrase guard, raw numeric checks).
    const dpuFinancialsText = dpuJoin("financials");

    // Narrative-only financials — deck/PPTX financial slides classified as
    // financials (e.g. KPI tiles, raise-terms slides) without XLSX rows.
    const dpuNarrativeFinancialsText = dpuNarrativeJoin("financials");

    // Narrative financials with metrics — deck KPI/metrics slides classified as
    // financials that contain actual numeric values (e.g. "$29M+", "18,000+").
    // XLSX pro-forma tables are excluded, so only deck slide content can win.
    const dpuNarrativeFinancialsWithMetrics =
      /\b\d[\d,]*\s*[KkMmBb+]|[€$£]\d[\d,]*[KkMmBb]?|\b\d{4,}\b/.test(dpuNarrativeFinancialsText)
        ? dpuNarrativeFinancialsText
        : "";

    // (Legacy: full financials with metrics — kept for financial analysis paths
    //  that intentionally include XLSX numeric rows, but not used in narrative fields.)
    const dpuFinancialsWithMetrics =
      /\b\d[\d,]*\s*[KkMmBb+]|[€$£]\d[\d,]*[KkMmBb]?|\b\d{4,}\b/.test(dpuFinancialsText)
        ? dpuFinancialsText
        : "";
    void dpuFinancialsWithMetrics; // retained for potential financial-only consumers

    // Market DPU text qualified for GTM use — filtered out when the segment is clearly a
    // market-size / TAM slide ("billion" / "trillion") or a use-of-funds / headcount slide
    // ("employee benefits" is a strong signal the page describes an org or budget breakdown
    // rather than a GTM strategy, e.g. a use-of-funds roadmap misclassified as "market").
    // Uses narrative join to exclude any XLSX pages classified as "market".
    const dpuMarketForGTM =
      /\b(billion|trillion)\b|\$\s*\d+\s*B\b/i.test(dpuNarrativeJoin("market")) ||
      /\bemployee benefits\b|\buse of funds\b/i.test(dpuNarrativeJoin("market"))
        ? ""
        : dpuNarrativeJoin("market");

    // Roadmap OCR guard: product_solution text extracted from a product-roadmap slide (not a
    // current-state product description) is rejected so the field falls through to better data.
    const ROADMAP_OCR_RE = /\b(product\s+roadmap|q[1-4]\s+20\d\d|Goal:\s*(growth|revenue|engagement))\b/i;
    const rejectRoadmap = (text: string): string => ROADMAP_OCR_RE.test(text) ? "" : text;

    // SPAC transaction text guard: DIO phase1 extractors may mis-identify SPAC merger mechanics
    // (e.g. "The Company will provide the holders of its Public Shares (the 'Public Stockholders')
    // with the opportunity to redeem all or a portion of their Public Shares...") as the company's
    // product description.  When detected, suppress the field so it falls through to better data.
    // These patterns are exclusively SPAC/blank-check-company corporate-event language and cannot
    // appear in any genuine product, service, or solution description.
    const SPAC_TRANSACTION_RE = /\bpublic stockholders?\b|\bpublic shares?\b|(?:\bredeem\b.{0,100}\bpublic\b)|\bbusiness combination\b|\btrust account\b/i;
    const rejectIfSpacTransaction = (text: string): string => SPAC_TRANSACTION_RE.test(text) ? "" : text;

    // DPU business_model segment — exists in SMB/CIM deals where the classifier assigns a
    // dedicated "business model" page (e.g. HVAC service description in a broker CIM).
    const dpuBusinessModelText = dpuJoin("business_model");

    // Broker disclaimer guard: CIM documents append a legal disclaimer paragraph to the
    // market_icp DIO field ("Buyer is advised to consult their financial advisor...").  When
    // detected, suppress so downstream fields fall through to substantive content.
    const BROKER_DISCLAIMER_RE = /buyer is advised to consult|financial advisor to review and verify/i;

    // TAM/SAM/SOM market-size contamination guard: when the DIO market_icp field contains
    // a TAM/SAM/SOM heading followed by a dollar-denominated size figure, the extractor
    // captured a market-sizing slide rather than an ICP/customer description.
    // Example: "TAM DevSecOps + GRC ... $8.2B SAM — SDLC governance..."
    const TAM_SAM_SOM_RE = /\b(?:TAM|SAM|SOM)\b[^.]*\$[\d.]+\s*[BMbmkK]\b/;

    // Slide-layout OCR junk guard: isolated digit pairs embedded in text ("10 10
    // Intelligence", "13 Pricing") combined with bullet-point characters (•·●) indicate
    // the text was OCR'd from a visually-rendered slide or product UI screenshot and
    // contains no usable ICP content.
    const SLIDE_LAYOUT_OCR_RE = /\s\d{1,3}\s+\d{1,3}\s+\w/;
    const BULLET_CHAR_RE = /[•·●]/;

    const icp = asStr(overviewV2?.market_icp);
    // Distributor field-management language guard: "pull-through" combined with
    // inventory/account-level phrasing ("keeps SKUs active at the account") is
    // distributor execution jargon — it appears in trade/channel management sections
    // of field-sales documents, never in customer-segment or positioning descriptions.
    // When detected, the market_icp was extracted from an operational tactics section
    // (not an ICP section) and must be suppressed.
    const DISTRIBUTOR_FIELD_MGMT_RE =
      /\bpull[\s-]through\b[\s\S]{0,200}?\bskus?\b|\bskus?\b[\s\S]{0,200}?\bpull[\s-]through\b|\bkeeps?\s+\w+[s]?\s+active\s+at\s+the\s+account/i;
    const cleanMarketIcp =
      BROKER_DISCLAIMER_RE.test(icp) ||
      TAM_SAM_SOM_RE.test(icp) ||
      (SLIDE_LAYOUT_OCR_RE.test(icp) && BULLET_CHAR_RE.test(icp)) ||
      DISTRIBUTOR_FIELD_MGMT_RE.test(icp)
        ? ""
        : icp;

    // DIO business_model hallucination guard: when the DIO phase1 mis-classifies a business
    // as a real-estate investment variant (e.g. "real estate investment" or "real estate
    // structured investment" — the latter arises when a PO-financing / structured-capital
    // section is mis-tagged as the overall business model), suppress the value so the field
    // falls through to DPU-sourced or archetype content instead.
    const REAL_ESTATE_INVESTMENT_RE = /\breal estate (investment|structured)\b/i;
    const cleanDIOBizModel = REAL_ESTATE_INVESTMENT_RE.test(asStr(overviewV2?.business_model))
      ? ""
      : asKnownStr(overviewV2?.business_model);

    // Long-form platform / accelerator / holding-company override for business_model —
    // fires only when the weak-DPU second pass is active (isWeakDpuCoverage = true) AND
    // the recovered distribution or business_model narrative contains platform / accelerator /
    // holding-company language.  Returns a normalized label (not raw narrative text) so the
    // field remains concise and machine-readable for downstream consumers.
    //
    // Patterns are intentionally generalizable:
    //   brand_accelerator — acquires + scales language, multi-brand platform, brand accelerator
    //   investment_platform — investment platform, spirits/sector platform company
    //   holding_company — holding company / parent company / holding entity
    // This fires before the generic archetype so that "consumer_product" cannot win when
    // the deal's own documents clearly describe a different structural model.
    const PLATFORM_ACCELERATOR_RE =
      /\bbrand\s+accelerator\b|\bmulti[\s-]brand\s+(platform|portfolio)\b|\b(acquires?\s+and\s+scales?|acquires?\s+and\s+grows?)\b|\bportfolio\s+(company|model|approach)\b/i;
    const HOLDING_COMPANY_RE = /\bholding\s+(company|entity|structure)\b|\bparent\s+company\b/i;
    const INVESTMENT_PLATFORM_RE =
      /\binvestment\s+platform\b|\b\w+\s+platform\s+(company|for)\b|\bspirits?\s+platform\b/i;
    const longFormBizModelOverride = (() => {
      if (!isWeakDpuCoverage) return "";
      // Combine both segments so that platform/accelerator language in the distribution
      // narrative can be detected even when the business_model segment has non-matching content
      // (e.g. a margin-strategy section classified under business_model).
      const narrative = [dpuNarrativeJoin("distribution"), dpuNarrativeJoin("business_model")]
        .join(" ")
        .trim();
      if (!narrative) return "";
      if (PLATFORM_ACCELERATOR_RE.test(narrative)) return "brand_accelerator";
      if (INVESTMENT_PLATFORM_RE.test(narrative)) return "investment_platform";
      if (HOLDING_COMPANY_RE.test(narrative)) return "holding_company";
      return "";
    })();

    // Report structured_summary business_model guard — only trust the extracted label when the
    // archetype extractor had positive confidence.  A zero-confidence archetype indicates
    // extraction failure; the promoted business_model fact in that case is often a mis-applied
    // label (e.g. "Wholesale/Retail" from a distribution/channel slide rather than a model slide).
    // Additionally reject known contamination labels regardless of confidence: "Wholesale/Retail"
    // is a frequent mis-classification for SaaS/software companies when a channel or distribution
    // slide is processed without adjacent model context.
    // Also covers "real estate structured investment" (structured-capital mis-tag) and
    // the "real estate structured" prefix family.
    const CONTAMINATED_BIZ_MODEL_RE = /^wholesale[\s\/]retail$|^real estate investment$|^real estate structured\b/i;
    const cleanReportBizModel =
      (archetypeV1?.confidence ?? 0) > 0 &&
      !CONTAMINATED_BIZ_MODEL_RE.test(asStr(reportSS?.business_model?.value))
        ? asKnownStr(reportSS?.business_model?.value)
        : "";

    // Traction signals from the DIO LLM extraction can contain raw spreadsheet cell-range
    // content when the LLM was fed XLSX pages (e.g. "Sheet1 A1:T40 Headers: col_A, col_B…").
    // Filter each signal through two guards before using them in traction_summary:
    //   1. SPREADSHEET_SIGNAL_RE — rejects Excel cell-range notation and pipe-table rows
    //   2. rejectIfNumericDominated — rejects numeric-series strings (>40 % numeric tokens)
    const SPREADSHEET_SIGNAL_RE = /\bSheet\d+\s+[A-Z]+\d+:[A-Z]+\d+\b|\|\s*\|[\s|]{6,}\|/;
    const cleanTractionSignals = Array.isArray(overviewV2?.traction_signals)
      ? (overviewV2!.traction_signals as unknown[]).filter((s): s is string => {
          if (typeof s !== "string" || !s.trim()) return false;
          if (SPREADSHEET_SIGNAL_RE.test(s)) return false;
          if (rejectIfNumericDominated(s) === "" && s.trim().length > 0) return false;
          return true;
        })
      : [];

    // Narrative financials for target_customer — applies the P&L phrase guard to
    // narrative (non-XLSX) financial pages only.  This ensures that XLSX allocation
    // tables, payroll sheets, and expense models cannot win target_customer even when
    // their column labels differ from the narrow phrase regex (e.g. "Fixed/Variable"
    // vs "Total Expenses").  XLSX pages are excluded upstream via SPREADSHEET_MIME_RE.
    const dpuNarrativeFinancialsForCustomer =
      /gross sales|total expenses|income before tax/i.test(dpuNarrativeFinancialsText)
        ? ""
        : dpuNarrativeFinancialsText;

    // Financial-projection document header guard — rejects narrative pages whose opening
    // text is a document-level financial projection title (e.g. "ACME CORP Financial
    // Projection (36 Months)").  These pages describe the financial model, not the ICP or
    // target customer.  Deck-sourced KPI slides (ARPU tiles, cohort charts) do not contain
    // this language, so the guard does not affect deck-heavy deals.
    const FINANCIAL_PROJECTION_HEADER_RE =
      /financial projec(?:tion|ted)|projected\s+(?:revenue|income|growth)/i;
    const dpuNarrativeFinancialsForCustomerClean = FINANCIAL_PROJECTION_HEADER_RE.test(
      dpuNarrativeFinancialsForCustomer,
    )
      ? ""
      : dpuNarrativeFinancialsForCustomer;

    // (Legacy: full financials for customer — retained for reference.  Not used in
    //  target_customer chain; replaced by dpuNarrativeFinancialsForCustomer above.)
    const dpuFinancialsForCustomer = /gross sales|total expenses|income before tax/i.test(dpuFinancialsText)
      ? ""
      : dpuFinancialsText;
    void dpuFinancialsForCustomer; // retained for potential financial-only consumers

    // Solution DPU for competitive_differentiation use — CIM title/cover pages ("Confidential
    // Business Memorandum", "listed for sale by", "Business Intermediary") don't describe
    // differentiation.  Suppress them so the field falls through to DPU business_model content.
    const CIM_COVER_RE = /confidential business memorandum|business intermediary|listed for sale by/i;
    const dpuSolutionForDiff = CIM_COVER_RE.test(dpuJoin("solution")) ? "" : dpuJoin("solution");

    // SEC exhibit filing header guard: executive_summary_v1 evidence snippets may originate
    // from SEC filing wrapper pages (e.g. "EX-99.5 6 d541283dex995.htm EX-99.5 Exhibit 99.5
    // UNAUDITED PRO FORMA CONDENSED COMBINED FINANCIAL INFORMATION...") or SPAC merger proxy
    // documents (e.g. "...the Business Combination and Related Transactions\" and \"Risk Factors
    // — If the Business Combination is consummated, Compute Health Stockholders will experience
    // dilution\"...").  These are legal/transactional document text with no investment signal
    // content; they must be filtered before any snippet is shown or used to drive context
    // heuristics like consumerDistributionContext.
    // Patterns:
    //   EX-99.X / Exhibit 99.X — SEC exhibit header wrappers
    //   UNAUDITED PRO FORMA — pro-forma financial merger statement header
    //   Business Combination — SPAC-specific corporate transaction term
    //   [Company] Stockholders — SPAC stockholder dilution / redemption language
    const SEC_EXHIBIT_HEADER_RE = /\bEX-99\.\d+\b|\bUNAUDITED PRO FORMA\b|\bExhibit\s+99\.\d+|\bbusiness combination\b|\bstockholders\b.{0,80}\bcompute(\s+health)?\b|\bcompute(\s+health)?\b.{0,80}\bstockholders\b/i;
    const investmentEvidenceSnippets = Array.isArray(execSummaryV1?.evidence)
      ? (execSummaryV1.evidence as Array<{ snippet?: unknown }>)
          .map((e) => stripHypotheticalDollarProjectionSentences(asStr(e?.snippet)))
          .filter((s) => Boolean(s) && !SEC_EXHIBIT_HEADER_RE.test(s))
          .slice(0, 2)
      : [];
    const investmentSignalsFromEvidence = joinArray(investmentEvidenceSnippets);
    const hasSubstantiveInvestmentEvidence =
      investmentEvidenceSnippets.some((s) => !/^see\s+document\s*:/i.test(s));

    const medicalRiskFallback =
      /\b(medical|diagnostic|testing|health|screen)\b/i.test(
        `${asStr(overviewV2?.business_model)} ${asStr(overviewV2?.go_to_market)} ${asStr(overviewV2?.market_icp)}`
      )
        ? "Primary risk is validation and adoption for this regulated medical testing workflow. Distribution likely requires partnerships with healthcare systems and public agencies."
        : "";

    const baseSignalsCorpus = normalizeWhitespace(
      [
        asStr(overviewV2?.product_solution),
        asStr(overviewV2?.business_model),
        asStr(overviewV2?.go_to_market),
        asStr(overviewV2?.market_icp),
        asStr(overviewV2?.traction_metrics),
        joinArray(overviewV2?.traction_signals),
        asStr(dealSummarySummary?.one_liner),
        asStr(dealSummarySummary?.paragraphs?.[0]),
        asStr(archetypeV1?.value),
        cleanReportBizModel,  // guarded version — excludes contaminated labels like "Wholesale/Retail"
        asStr(reportSS?.deal_summary_v1?.tiers?.hero),
        asStr(reportSS?.deal_summary_v1?.tiers?.deep),
        investmentSignalsFromEvidence,
      ].join(" "),
    ).toLowerCase();

    const containsAny = (...patterns: RegExp[]): boolean => patterns.some((p) => p.test(baseSignalsCorpus));

    const predictionModelContext =
      containsAny(/\b(prediction|predictive|forecast|accuracy|accurate|injury)\b/i) &&
      (
        containsAny(/\b(ai|artificial\s+intelligence|machine\s+learning|ml|model|analytics|data\s+platform)\b/i) ||
        containsAny(/\b(sports|betting|fantasy)\b/i)
      );

    const consumerDistributionContext =
      containsAny(/\b(consumer|cpg|beverage|retail|wholesale|hospitality|venue|on\s*-?\s*premise|distributor)\b/i);

    const earlyTractionContext =
      containsAny(/\b(early|pilot|loi|pipeline|run\s*-?\s*rate|pre\s*-?\s*sales|partnership)\b/i);

    // Medical-device context guard: suppresses the generic consumer-distribution
    // signal heuristics for deals where the corpus contains strong medical / clinical
    // language.  DIO may mis-classify a medical-device company (e.g. Allurion) as
    // "Omnichannel (DTC + Wholesale/Retail)" — that label puts "retail" + "wholesale"
    // into baseSignalsCorpus and fires consumerDistributionContext, appending an
    // irrelevant consumer-brand risk signal.  When "patients", "medical device",
    // "health care provider", or "balloon" appear in the corpus, the deal is not a
    // consumer-distribution business and the signal must be suppressed.
    const isMedicalDeviceContext = /\b(?:medical\s+device|patients?|health\s+care\s+provider|procedureless|clinical\s+(?:trial|study|evidence)|balloon)\b/i.test(baseSignalsCorpus);

    const investorSignals: string[] = [];
    const baselineSignalText =
      (hasSubstantiveInvestmentEvidence ? investmentSignalsFromEvidence : "") ||
      medicalRiskFallback ||
      investmentSignalsFromEvidence;
    appendSignal(investorSignals, baselineSignalText);

    if (predictionModelContext) {
      appendSignal(
        investorSignals,
        "Key risk is whether predictions are accurate in real-world usage; commercial outcomes depend on independent validation of model performance.",
      );
    }

    if (consumerDistributionContext && earlyTractionContext && !isMedicalDeviceContext) {
      appendSignal(
        investorSignals,
        "This appears early-stage with initial traction but limited realized revenue scale, so repeat-demand and channel execution risk remain central.",
      );
    }

    if (consumerDistributionContext && !isMedicalDeviceContext) {
      appendSignal(
        investorSignals,
        "Success depends heavily on distribution execution and brand strength; unit economics, gross margins, and path to profitability should be validated before underwriting growth assumptions.",
      );
    }

    // Trusted raise value from persisted structured summary — used for narrative cross-check.
    const trustedRaiseValue: string | null = asStr(reportSS?.raise?.value) || null;

    const understanding = {
      what_company_does:
        dpuNarrativeJoin("distribution") ||
        dpuNarrativeJoin("business_model") ||
        cleanMarketIcp ||
        dpuBusinessModelText ||
        rejectIfSpacTransaction(rejectRoadmap(asStr(overviewV2?.product_solution))) ||
        asStr(overviewV2?.go_to_market) ||
        asStr(overviewV2?.business_model) ||
        asStr(dealSummarySummary?.one_liner) ||
        asStr(reportSS?.deal_summary_v1?.tiers?.hero) ||
        asStr(reportSS?.deal_summary_v1?.one_liner?.text),

      problem:
        asStr(overviewV2?.product_solution) !== rejectIfSpacTransaction(rejectRoadmap(asStr(overviewV2?.product_solution)))
          ? cleanMarketIcp || dpuNarrativeJoin("distribution") || asStr(dealSummarySummary?.one_liner)
          : dpuNarrativeJoin("solution") ||
            cleanMarketIcp ||
            dpuNarrativeJoin("distribution") ||
            asStr(dealSummarySummary?.one_liner) ||
            asStr(reportSS?.deal_summary_v1?.tiers?.hero),

      solution:
        dpuNarrativeJoin("solution") ||
        cleanMarketIcp ||
        dpuNarrativeJoin("distribution") ||
        rejectIfSpacTransaction(rejectRoadmap(asStr(overviewV2?.product_solution))),

      why_now:
        dpuTractionText ||
        cleanMarketIcp ||
        dpuNarrativeFinancialsText,

      business_model:
        dpuProductTextForBizModel ||
        longFormBizModelOverride ||
        // For weak-DPU deals where longFormBizModelOverride found no platform/accelerator
        // label in the narrative, prefer second-pass business_model narrative content
        // (e.g. "Our B2B2C Business Model…") over the generic DIO archetype label.
        (isWeakDpuCoverage ? dpuNarrativeJoin("business_model") : "") ||
        firstKnown(
          archetypeV1?.value,
          cleanReportBizModel,
        ) ||
        cleanDIOBizModel ||
        dpuBusinessModelText ||
        dpuNarrativeJoin("business_model") ||
        dpuNarrativeFinancialsText ||
        dpuNarrativeJoin("distribution"),

      revenue_model:
        dpuProductTextForBizModel ||
        // For medical-device deals with weak DPU coverage, the DIO classifier may
        // assign a mis-matched business model label (e.g. "Omnichannel (DTC + Wholesale/Retail)"
        // for a clinic-distribution medical device).  Prefer the second-pass business_model
        // narrative (e.g. "Our B2B2C Business Model…") over that label when both conditions hold.
        // The isMedicalDeviceContext gate prevents this from firing for consumer/CPG deals
        // that legitimately have an archetype or DIO label.
        (isMedicalDeviceContext && isWeakDpuCoverage ? dpuNarrativeJoin("business_model") : "") ||
        firstKnown(
          cleanDIOBizModel,
          archetypeV1?.value,
          cleanReportBizModel,
        ) ||
        dpuBusinessModelText ||
        dpuNarrativeJoin("business_model") ||
        dpuNarrativeFinancialsText ||
        dpuNarrativeJoin("distribution"),

      // Strip sentences that pair a large-dollar amount (≥$50M) with hypothetical/projection
      // language (e.g. "yielding ~$139M ARR") — these are forward-looking assertions surfaced
      // from GTM slides, not reported facts.  Fall back to DPU traction then market_icp when
      // stripping removes all content so the field remains populated.
      // dpuMarketForGTM: the DPU market segment filtered to exclude TAM/market-size slides
      // (e.g. "$65 billion used car finance market") so that genuine GTM content (events,
      // broadcast, channel partners) surfaces first without being displaced by traction text.
      go_to_market:
        stripHypotheticalDollarProjectionSentences(rejectIfNumericDominated(asStr(overviewV2?.go_to_market))) ||
        dpuMarketForGTM ||
        dpuNarrativeJoin("distribution") ||
        dpuTractionText ||
        dpuNarrativeJoin("market") ||
        cleanMarketIcp,

      // DPU narrative financials often contains per-customer spend, shared-expense context, or
      // ARPU data from deck KPI slides — better descriptors of customer segments than generic
      // ICP language.  XLSX allocation/payroll tables and expense models are excluded upstream
      // via the narrative filter so they cannot win this field regardless of their column labels.
      // For long-form PDF deals, financial projection document headers are suppressed via
      // dpuNarrativeFinancialsForCustomerClean, and the distribution narrative (company identity
      // description) is used as a fallback — it implicitly describes the types of
      // brands/customers/partners the company targets.
      target_customer:
        dpuNarrativeFinancialsForCustomerClean ||
        cleanMarketIcp ||
        dpuNarrativeJoin("distribution") ||
        rejectIfNumericDominated(asStr(overviewV2?.go_to_market)),

      traction_summary:
        (isGenericTractionSignals(cleanTractionSignals) ? "" : joinArray(cleanTractionSignals)) ||
        (isWeakDpuCoverage ? dpuTractionText : "") ||
        dpuNarrativeJoin("distribution") ||
        dpuNarrativeFinancialsWithMetrics ||
        dpuTractionText ||
        joinArray(cleanTractionSignals) ||
        asStr(overviewV2?.traction_metrics),

      risks:
        joinArray(dealSummaryV2Risks.filter((r) => !isGenericRiskEntry(r))) ||
        joinArray((overviewV2?.key_risks_detected as unknown[] ?? []).filter((r) => !isGenericRiskEntry(r))) ||
        [dpuNarrativeJoin("distribution"), dpuNarrativeJoin("financials")].filter(Boolean).join(" ").trim() ||
        joinArray(dealSummaryV2Risks) ||
        joinArray(overviewV2?.key_risks_detected),

      // Suppress LLM-generated paragraphs that assert a raise amount contradicting the
      // trusted structured raise value by ≥ 20×; fall back to tiers.deep in that case.
      // Use market_icp first as it typically captures the positioning narrative ("first X
      // that does Y") more precisely than an LLM-generated summary built from incomplete data.
      market_positioning: (() => {
        const primary = suppressIfRaiseAmountOverstated(
          asStr(dealSummarySummary?.paragraphs?.[0]),
          trustedRaiseValue,
        );
        return cleanMarketIcp ||
          dpuNarrativeJoin("distribution") ||
          dpuTractionText ||
          primary ||
          asStr(reportSS?.deal_summary_v1?.tiers?.deep);
      })(),

      competitive_differentiation:
        cleanMarketIcp ||
        dpuSolutionForDiff ||
        dpuBusinessModelText ||
        dpuNarrativeJoin("distribution") ||
        rejectRoadmap(asStr(overviewV2?.product_solution)) ||
        asStr(reportSS?.deal_summary_v1?.tiers?.overview),

      // Evidence-backed signals from document claims — surfaces capital use, brand, and marketing
      // terms extracted during document scanning; used for investor-usefulness signal coverage.
      investment_signals:
        normalizeWhitespace(investorSignals.join(" ")),
    };

    return reply.send({ understanding });
  });
}
