/**
 * populate-financial-fact-registry-v1.ts
 *
 * Orchestrates PDF → FinancialFactV1 pipeline for a single deal.
 *
 * Pipeline (v2 — Candidate Expansion):
 * 1. Query page_registry_v1 for PRIMARY candidates:
 *      page_type IN ('financials', 'traction', 'ask')
 *    and SECONDARY candidates (currency-dense pages of other types) up to
 *    CANDIDATE_PAGE_CAP total pages (default 15).
 * 2. For each candidate, fetch raw OCR/DPU text.
 * 3. Guard: skip pages where detectFinancialTableCandidate() returns false
 *    (controlled by opts.skip_non_financial, default true).
 * 4. Run extractFinancialTableClaims (source_kind="pdf_table") AND
 *    extractInlineFinancialClaims (source_kind="pdf_kpi_line") on each page.
 * 5. Merge all facts across pages with confidence-based dedup:
 *      pdf_table > xlsx > pdf_kpi_line > deck > unknown
 *    When source_kind ties, keep both as separate facts (different source_pointer).
 * 6. Run reconcileFinancialFactsV1() to add derived facts (e.g. runway).
 * 7. Upsert via upsertFinancialFactsV1().
 * 8. Emit FINANCIAL_EXPANSION_V2_SUMMARY log.
 *
 * Best-effort: individual page failures are caught and logged; the run
 * continues for remaining pages.
 *
 * Caller: populate-document-page-understanding.ts (after DPU block).
 */

import type { Pool } from "pg";
import type { FinancialFactV1 } from "@dealdecision/core";
import { upsertFinancialFactsV1 } from "../db/financial-facts-db";
import {
  detectFinancialTableCandidate,
  extractFinancialTableClaims,
} from "./extract-financial-table-claims";
import {
  extractInlineFinancialClaims,
} from "./extract-inline-financial-claims";
import {
  extractChartFactClaims,
  inferChartMetricKey,
} from "./extract-chart-fact-claims";
import { extractKpiTileClaims } from "./extract-kpi-tile-claims";
import { reconcileFinancialFactsV1 } from "./reconcile-financial-facts-v1";
import {
  applySlideAwareness,
  FINANCIAL_SLIDE_TYPES,
} from "./slide-aware-confidence-v1.js";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Hard cap on candidate pages evaluated per deal run. */
const CANDIDATE_PAGE_CAP = 15;

/**
 * Secondary expansion: fetch up to this many additional pages (not financials/
 * traction/ask) for currency-density scoring.
 */
const SECONDARY_FETCH_LIMIT = 30;

/**
 * Source-kind confidence rank. Higher = stronger evidence.
 * Used for dedup: when two facts share (metric_key, period_label),
 * the one with the higher rank wins.
 */
const SOURCE_KIND_RANK: Record<string, number> = {
  pdf_table:    4,
  xlsx:         3,
  pdf_kpi_line: 2,
  kpi_tile:     2,
  deck:         1,
  chart_pixel:  1,
  unknown:      0,
};

// ─── Public types ─────────────────────────────────────────────────────────────

export interface PopulateFinancialFactRegistryV1Opts {
  deal_id: string;
  /** Optional: restrict to one document */
  document_id?: string;
  /** If true (default), skip pages with no detected financial content */
  skip_non_financial?: boolean;
  /**
   * Set to true when the target document is a spreadsheet (XLSX / Excel).
   * When set, extracted facts will carry source_kind="xlsx" rather than
   * "pdf_table", ensuring the ranking step correctly identifies spreadsheet
   * provenance.  Does NOT change the ranking table — excel-origin data still
   * participates in dedup against pdf_table rows from other documents.
   */
  xlsx_doc?: boolean;
}

export interface PopulateFinancialFactRegistryV1Result {
  pages_scanned:        number;
  pages_with_data:      number;
  facts_extracted:      number;
  facts_derived:        number;
  facts_upserted:       number;
  /** Pages added beyond page_type='financials' (traction/ask/currency-dense) */
  pages_expanded:       number;
  /** Facts sourced from inline KPI extraction (source_kind="pdf_kpi_line") */
  facts_inline:         number;
  /** Facts dropped by confidence-based dedup (lower-rank duplicate removed) */
  facts_merged:         number;
  /** Facts tagged source_kind="kpi_tile" (KPI tile callout extraction) */
  facts_kpi:            number;
  /** Facts tagged source_kind="chart_pixel" (bar chart pixel extraction) */
  facts_chart:          number;
  /** Facts tagged source_kind="xlsx" (only when xlsx_doc=true) */
  facts_xlsx:           number;
  /** Candidate pages rejected by the detectFinancialTableCandidate guard */
  candidates_rejected:  number;
  /** Duplicate facts deleted after cross-document dedup (same value+metric+period) */
  facts_deduplicated:   number;
  errors:               string[];
}

// ─── Core ────────────────────────────────────────────────────────────────────

export async function populateFinancialFactRegistryV1(
  pool: Pool,
  opts: PopulateFinancialFactRegistryV1Opts,
): Promise<PopulateFinancialFactRegistryV1Result> {
  const result: PopulateFinancialFactRegistryV1Result = {
    pages_scanned:       0,
    pages_with_data:     0,
    facts_extracted:     0,
    facts_derived:       0,
    facts_upserted:      0,
    pages_expanded:      0,
    facts_inline:        0,
    facts_kpi:           0,
    facts_merged:        0,
    facts_chart:         0,
    facts_xlsx:          0,
    candidates_rejected: 0,
    facts_deduplicated:  0,
    errors:              [],
  };

  const allExtracted: FinancialFactV1[] = [];

  try {
    // ── 1. Build candidate page list ────────────────────────────────────────
    const primaryRows = await queryPrimaryCandidatePages(pool, opts);

    // Count primary pages that are NOT page_type='financials'
    result.pages_expanded = primaryRows.filter(
      (r) => r.page_type !== "financials",
    ).length;

    // Fill remaining capacity with secondary (currency-dense) candidates
    const remaining = CANDIDATE_PAGE_CAP - primaryRows.length;
    const primaryIds = new Set(primaryRows.map((r) => r.page_id));

    let secondaryRows: CandidatePageRow[] = [];
    if (remaining > 0) {
      const candidatesForScoring = await querySecondaryCandidatePages(
        pool,
        opts,
        primaryIds,
      );

      // Score + filter secondary candidates using text density check
      for (const row of candidatesForScoring) {
        if (secondaryRows.length >= remaining) break;
        try {
          const text = await fetchDpuText(pool, row.document_id, row.page_index);
          if (text && detectFinancialTableCandidate(text)) {
            secondaryRows.push({ ...row, _prefetchedText: text });
            result.pages_expanded++;
          }
        } catch {
          // secondary scoring errors are silent — just skip the candidate
        }
      }
    }

    const allRows = [
      ...primaryRows.slice(0, CANDIDATE_PAGE_CAP),
      ...secondaryRows,
    ].slice(0, CANDIDATE_PAGE_CAP);

    if (allRows.length === 0) {
      emitExpansionSummary(opts.deal_id, result);
      return result;
    }

    // ── 2. Process each candidate page ──────────────────────────────────────
    for (const pageRow of allRows) {
      result.pages_scanned++;
      try {
        // Use pre-fetched text for secondary candidates; fetch for primary
        const text =
          pageRow._prefetchedText ??
          (await fetchDpuText(pool, pageRow.document_id, pageRow.page_index));
        if (!text) continue;

        // Fetch slide classification context from DPU payload (non-fatal)
        const slideCtx = await fetchDpuSlideContext(
          pool, pageRow.document_id, pageRow.page_index,
        );

        // Guard: skip pages with no financial signal
        // Exception: pages classified as financial slide types bypass this guard
        // since the slide classification is stronger evidence than text density.
        const isFinancialSlide = slideCtx.slide_type != null &&
          FINANCIAL_SLIDE_TYPES.has(slideCtx.slide_type);
        if (
          opts.skip_non_financial !== false &&
          !isFinancialSlide &&
          !detectFinancialTableCandidate(text)
        ) {
          result.candidates_rejected++;
          continue;
        }

        // ── 3. Extract: table claims ─────────────────────────────────────────
        const tableExtracted = extractFinancialTableClaims(text, {
          deal_id:              opts.deal_id,
          document_id:          pageRow.document_id,
          page_number:          pageRow.page_index,
          page_id:              pageRow.page_id,
          source_kind_override: opts.xlsx_doc ? "xlsx" : undefined,
          slide_type:           slideCtx.slide_type ?? undefined,
          slide_title:          slideCtx.slide_title ?? undefined,
        });

        // ── 4. Extract: inline KPI claims ────────────────────────────────────
        const inlineExtracted = extractInlineFinancialClaims(text, {
          deal_id:     opts.deal_id,
          document_id: pageRow.document_id,
          page_number: pageRow.page_index,
          page_id:     pageRow.page_id,
          slide_type:  slideCtx.slide_type ?? undefined,
          slide_title: slideCtx.slide_title ?? undefined,
        });

        // ── 4c. Extract: KPI tile claims ─────────────────────────────────────
        const kpiExtracted = extractKpiTileClaims(text, {
          deal_id:     opts.deal_id,
          document_id: pageRow.document_id,
          page_number: pageRow.page_index,
          page_id:     pageRow.page_id,
          slide_type:  slideCtx.slide_type ?? undefined,
          slide_title: slideCtx.slide_title ?? undefined,
        });

        // ── 4a. Apply slide-aware confidence adjustments ─────────────────────
        const tableAware  = applySlideAwareness(tableExtracted,  slideCtx.slide_type, slideCtx.slide_title);
        const inlineAware = applySlideAwareness(inlineExtracted, slideCtx.slide_type, slideCtx.slide_title);
        const kpiAware    = applySlideAwareness(kpiExtracted,    slideCtx.slide_type, slideCtx.slide_title);

        const pageFacts = [...tableAware, ...inlineAware, ...kpiAware];
        if (pageFacts.length === 0) continue;

        result.pages_with_data++;
        result.facts_extracted += tableAware.length;
        result.facts_inline    += inlineAware.length;
        result.facts_kpi       += kpiAware.length;

        // Guard: log warning when xlsx_doc is set but a table fact has no source_kind
        if (opts.xlsx_doc) {
          for (const f of tableAware) {
            if (!f.source_kind) {
              console.warn(
                JSON.stringify({
                  event: "FINANCIAL_FACT_XLSX_SOURCE_MISSING",
                  deal_id: opts.deal_id,
                  document_id: pageRow.document_id,
                  page_index: pageRow.page_index,
                  metric_key: f.metric_key,
                  ts: new Date().toISOString(),
                }),
              );
            } else {
              result.facts_xlsx++;
            }
          }
        }

        allExtracted.push(...pageFacts);
      } catch (pageErr: unknown) {
        const msg = pageErr instanceof Error ? pageErr.message : String(pageErr);
        result.errors.push(
          `page doc=${pageRow.document_id} idx=${pageRow.page_index}: ${msg}`,
        );
      }
    }

    // ── 4b. XLSX observability: emit structured log when XLSX tables produced facts ─
    if (opts.xlsx_doc && result.facts_xlsx > 0) {
      console.log(
        JSON.stringify({
          event:         "XLSX_FINANCIAL_FACTS_DETECTED",
          deal_id:       opts.deal_id,
          document_id:   opts.document_id ?? null,
          fact_count:    result.facts_xlsx,
          ts:            new Date().toISOString(),
        }),
      );
    }

    // ── 5. Chart pixel extraction (visual_extractions → chart_pixel facts) ──
    try {
      const chartRows = await queryChartExtractions(pool, opts);
      for (const row of chartRows) {
        try {
          const chartFacts = extractChartFactClaims(row.structured_json, {
            deal_id:          opts.deal_id,
            document_id:      row.document_id,
            visual_asset_id:  row.visual_asset_id,
            page_number:      row.page_index,
            slide_type:       row.slide_type ?? undefined,
            slide_title:      row.slide_title ?? undefined,
            dpu_text:         row.dpu_text ?? undefined,
          });
          result.facts_chart += chartFacts.length;
          allExtracted.push(...chartFacts);
        } catch (chartErr: unknown) {
          const msg = chartErr instanceof Error ? chartErr.message : String(chartErr);
          result.errors.push(`chart va=${row.visual_asset_id} pg=${row.page_index}: ${msg}`);
        }
      }
    } catch (chartQueryErr: unknown) {
      const msg = chartQueryErr instanceof Error ? chartQueryErr.message : String(chartQueryErr);
      result.errors.push(`chart query: ${msg}`);
    }

    // ── 5. Confidence-based dedup across all pages ───────────────────────────
    const { merged, droppedCount } = mergeFactsByConfidence(allExtracted);
    result.facts_merged = droppedCount;

    // ── 6. Reconcile (add derived facts, e.g. runway) ────────────────────────
    const reconciled = reconcileFinancialFactsV1(merged, opts.deal_id);
    result.facts_derived = reconciled.length - merged.length;

    // ── 7. Upsert ────────────────────────────────────────────────────────────
    const upserted = await upsertFinancialFactsV1(pool, reconciled);
    result.facts_upserted = upserted;
    // ── 8. Cross-document value-level dedup ────────────────────────────────────
    // Delete duplicate facts accumulated across separate per-document runs.
    // Keeps the lexicographically smallest fact_id (deterministic).
    result.facts_deduplicated = await deduplicateFactsByValueForDeal(pool, opts.deal_id);  } catch (topErr: unknown) {
    const msg = topErr instanceof Error ? topErr.message : String(topErr);
    result.errors.push(`populate top-level: ${msg}`);
  }

  // ── 8. Emit expansion summary log ─────────────────────────────────────────
  emitExpansionSummary(opts.deal_id, result);

  return result;
}

// ─── Merge helpers ────────────────────────────────────────────────────────────

interface MergeResult {
  merged:       FinancialFactV1[];
  droppedCount: number;
}

/**
 * Dedup facts by (metric_key, period_label).
 *
 * When two facts share the same metric+period, keep the one with the higher
 * source_kind rank (pdf_table > xlsx > pdf_kpi_line > deck > unknown).
 * Within the same rank, keep both (different source_pointer means different
 * extraction context — may reflect conflicting readings).
 *
 * Projection safety: if the existing fact carries a realized temporal_scope
 * (historical | current) and the incoming fact carries a projected scope
 * (projected | scenario | target), the incoming fact is dropped regardless of
 * its source_kind rank.  This prevents workbook forecast columns from
 * displacing confirmed actuals.
 *
 * Sanity pre-filter: facts with implausibly small values for specific currency
 * metrics (e.g. burn_rate < $1K) are dropped before rank-based selection.
 *
 * Never downgrades confidence. Returns a new array.
 */

/**
 * Minimum plausible absolute value (currency unit) per metric.
 * Facts below this threshold are discarded during merge, regardless of source.
 */
const CURRENCY_SANITY_MIN: Record<string, number> = {
  burn_rate: 1_000,  // $1K/month — below this is implausibly small for any funded company
};

export function mergeFactsByConfidence(facts: FinancialFactV1[]): MergeResult {
  // Sanity pre-filter: remove facts with implausibly small currency values.
  const sanitized = facts.filter((f) => {
    const min = CURRENCY_SANITY_MIN[f.metric_key];
    return !(min !== undefined && f.unit === "currency" && Math.abs(f.value) < min);
  });

  // Map key → best fact seen so far (by source rank)
  const best = new Map<string, FinancialFactV1>();
  let droppedCount = facts.length - sanitized.length; // count sanity-filtered as dropped

  const isRealizedScope = (scope: string | undefined) =>
    scope === "historical" || scope === "current";
  const isProjectedScopeLocal = (scope: string | undefined) =>
    scope === "projected" || scope === "scenario" || scope === "target";

  for (const fact of sanitized) {
    const key = `${fact.metric_key}:${fact.period_label}`;
    const existing = best.get(key);

    if (!existing) {
      best.set(key, fact);
      continue;
    }

    // Projection safety: realized facts always win over projected ones.
    if (isRealizedScope(existing.temporal_scope) && isProjectedScopeLocal(fact.temporal_scope)) {
      droppedCount++;
      continue;
    }
    // Inverse: if incoming is realized and existing is projected, replace.
    if (isProjectedScopeLocal(existing.temporal_scope) && isRealizedScope(fact.temporal_scope)) {
      best.set(key, fact);
      droppedCount++;
      continue;
    }

    const incomingRank = SOURCE_KIND_RANK[fact.source_kind] ?? 0;
    const existingRank = SOURCE_KIND_RANK[existing.source_kind] ?? 0;

    if (incomingRank > existingRank) {
      // Incoming is higher quality — replace existing
      best.set(key, fact);
      droppedCount++;
    } else {
      // Existing is equal or higher quality — keep existing, discard incoming
      droppedCount++;
    }
  }

  return { merged: Array.from(best.values()), droppedCount };
}

// ─── Logging ──────────────────────────────────────────────────────────────────

function emitExpansionSummary(
  deal_id: string,
  result: PopulateFinancialFactRegistryV1Result,
): void {
  console.info(
    JSON.stringify({
      event:                 "FINANCIAL_EXPANSION_V2_SUMMARY",
      deal_id,
      pages_scanned:         result.pages_scanned,
      pages_with_data:       result.pages_with_data,
      pages_expanded:        result.pages_expanded,
      candidates_rejected:   result.candidates_rejected,
      facts_extracted_table: result.facts_extracted,
      facts_extracted_inline:result.facts_inline,
      facts_kpi:             result.facts_kpi,
      facts_chart:           result.facts_chart,
      facts_xlsx:            result.facts_xlsx,
      facts_after_merge:     result.facts_upserted + result.facts_merged,
      facts_derived:         result.facts_derived,
      facts_upserted:        result.facts_upserted,
      facts_merged_dropped:  result.facts_merged,
      facts_deduplicated:    result.facts_deduplicated,
      errors:                result.errors.length,
    }),
  );
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

/**
 * Delete duplicate financial facts for a deal that share the same
 * (metric_key, period_label, value, source_kind). Keeps the lexicographically
 * smallest fact_id (deterministic).
 *
 * This handles cross-document duplicates: when the same document is uploaded
 * twice or when two documents contain the same KPI tile, separate populate runs
 * insert two identical facts with different fact_ids. This cleanup removes the
 * extra copy.
 *
 * Returns the number of rows deleted.
 */
async function deduplicateFactsByValueForDeal(pool: Pool, deal_id: string): Promise<number> {
  try {
    const result = await pool.query(
      `DELETE FROM financial_facts_v1
       USING (
         SELECT fact_id,
                ROW_NUMBER() OVER (
                  PARTITION BY deal_id, metric_key, period_label, value::text, source_kind
                  ORDER BY fact_id
                ) AS rn
         FROM financial_facts_v1
         WHERE deal_id = $1
       ) ranked
       WHERE financial_facts_v1.fact_id = ranked.fact_id
         AND financial_facts_v1.deal_id = $1
         AND ranked.rn > 1`,
      [deal_id],
    );
    return result.rowCount ?? 0;
  } catch {
    return 0;
  }
}

interface CandidatePageRow {
  page_id: string;
  document_id: string;
  page_index: number;
  page_type: string;
  /** Pre-fetched DPU text for secondary candidates scored during expansion */
  _prefetchedText?: string;
}

async function queryPrimaryCandidatePages(
  pool: Pool,
  opts: PopulateFinancialFactRegistryV1Opts,
): Promise<CandidatePageRow[]> {
  const params: unknown[] = [opts.deal_id];
  const docFilter = opts.document_id ? `AND pr.document_id = $2::uuid` : "";
  if (opts.document_id) params.push(opts.document_id);

  const { rows } = await pool.query<CandidatePageRow>(
    `SELECT
       pr.page_id,
       pr.document_id::text,
       pr.page_number    AS page_index,
       pr.page_type
     FROM public.page_registry_v1 pr
     WHERE pr.deal_id = $1::uuid
       AND pr.page_type IN ('financials', 'traction', 'ask')
       ${docFilter}
     ORDER BY
       CASE pr.page_type
         WHEN 'financials' THEN 1
         WHEN 'traction'   THEN 2
         WHEN 'ask'        THEN 3
         ELSE 4
       END,
       pr.document_id,
       pr.page_number
     LIMIT ${CANDIDATE_PAGE_CAP * 4}`,
    params,
  );

  return rows;
}

async function querySecondaryCandidatePages(
  pool: Pool,
  opts: PopulateFinancialFactRegistryV1Opts,
  excludePageIds: Set<string>,
): Promise<CandidatePageRow[]> {
  const params: unknown[] = [opts.deal_id];
  const docFilter = opts.document_id ? `AND pr.document_id = $2::uuid` : "";
  if (opts.document_id) params.push(opts.document_id);

  const { rows } = await pool.query<CandidatePageRow>(
    `SELECT
       pr.page_id,
       pr.document_id::text,
       pr.page_number    AS page_index,
       pr.page_type
     FROM public.page_registry_v1 pr
     WHERE pr.deal_id = $1::uuid
       AND pr.page_type NOT IN ('financials', 'traction', 'ask')
       ${docFilter}
     ORDER BY pr.document_id, pr.page_number
     LIMIT ${SECONDARY_FETCH_LIMIT}`,
    params,
  );

  // Filter out page IDs already in primary set
  return rows.filter((r) => !excludePageIds.has(r.page_id));
}

async function fetchDpuText(
  pool: Pool,
  documentId: string,
  pageIndex: number,
): Promise<string | null> {
  const { rows } = await pool.query<{ page_text: string | null }>(
    `SELECT COALESCE(payload->>'normalized_text', payload->>'page_text') AS page_text
     FROM public.document_page_understanding
     WHERE document_id = $1::uuid
       AND page_index   = $2::int
     LIMIT 1`,
    [documentId, pageIndex],
  );

  return rows[0]?.page_text ?? null;
}

// ─── Slide context helper ─────────────────────────────────────────────────────

interface DpuSlideContext {
  slide_type:  string | null;
  slide_title: string | null;
}

/**
 * Fetch slide classification metadata from the DPU payload for a single page.
 *
 * Returns null values when the DPU row is missing or the payload lacks slide fields.
 * Never throws.
 */
async function fetchDpuSlideContext(
  pool: Pool,
  documentId: string,
  pageIndex: number,
): Promise<DpuSlideContext> {
  try {
    const { rows } = await pool.query<{ slide_type: string | null; slide_title: string | null }>(
      `SELECT
         payload->'structured'->>'segment_key' AS slide_type,
         NULL::text                             AS slide_title
       FROM public.document_page_understanding
       WHERE document_id = $1::uuid
         AND page_index   = $2::int
       LIMIT 1`,
      [documentId, pageIndex],
    );
    return {
      slide_type:  rows[0]?.slide_type  ?? null,
      slide_title: rows[0]?.slide_title ?? null,
    };
  } catch {
    return { slide_type: null, slide_title: null };
  }
}

// ─── Chart extraction DB helper ───────────────────────────────────────────────

interface ChartExtractionRow {
  visual_asset_id: string;
  document_id: string;
  page_index: number;
  structured_json: Record<string, unknown>;
  slide_type: string | null;
  slide_title: string | null;
  dpu_text: string | null;
}

async function queryChartExtractions(
  pool: Pool,
  opts: PopulateFinancialFactRegistryV1Opts,
): Promise<ChartExtractionRow[]> {
  const params: unknown[] = [opts.deal_id];
  const docFilter = opts.document_id ? `AND va.document_id = $2::uuid` : "";
  if (opts.document_id) params.push(opts.document_id);

  const { rows } = await pool.query<ChartExtractionRow>(
    `SELECT
       va.id::text                                              AS visual_asset_id,
       va.document_id::text,
       va.page_index,
       ve.structured_json,
       dpu.payload->'structured'->>'segment_key'               AS slide_type,
       NULL::text                                              AS slide_title,
       COALESCE(
         dpu.payload->>'normalized_text',
         dpu.payload->>'page_text'
       )                                                       AS dpu_text
     FROM visual_assets va
     JOIN visual_extractions ve ON ve.visual_asset_id = va.id
     JOIN documents d ON d.id = va.document_id
     LEFT JOIN document_page_understanding dpu
       ON dpu.document_id = va.document_id
      AND dpu.page_index  = va.page_index
     WHERE d.deal_id = $1::uuid
       AND va.asset_type = 'chart'
       AND (va.quality_flags->>'axis_mapping_succeeded')::boolean = true
       ${docFilter}
     ORDER BY va.document_id, va.page_index
     LIMIT 20`,
    params,
  );

  return rows;
}



