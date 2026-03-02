/**
 * populate-page-registry-v1.ts
 *
 * Populates the page_registry_v1 table for a given (dealId, documentId).
 *
 * Flow:
 *  1. Enumerate pages from document_page_understanding DPU rows.
 *  2. For each page: resolve page_text, run extraction + classification.
 *  3. Upsert into page_registry_v1 (idempotent, keyed on page_id).
 *
 * Called from: populate-document-page-understanding job (best-effort).
 * Never throws — all errors are caught and logged. Returns a result summary.
 */

import type { Pool } from "pg";
import type { PageRegistryRowV1 } from "@dealdecision/core";
import {
  computePageId,
  capPageExcerpt,
} from "@dealdecision/core";

import { extractNumericClaims } from "./extract-numeric-claims";
import { extractEntities } from "./extract-entities";
import { extractKeyClaims } from "./extract-key-claims";
import { classifyPageTypeV1 } from "./classify-page-type-v1";
import { upsertPageRegistryRowsV1 } from "../db/page-registry-db";

// ─── DPU row type (minimal; we only need what we read) ────────────────────────

interface DpuRow {
  page_index: number;
  page_text: string | null;
  payload: Record<string, unknown> | null;
}

// ─── Result type ──────────────────────────────────────────────────────────────

export interface PopulatePageRegistryV1Result {
  ok: boolean;
  deal_id: string;
  document_id: string;
  pages_attempted: number;
  pages_upserted: number;
  pages_skipped_no_text: number;
  error?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Check if page_registry_v1 exists in the DB (graceful migration check). */
async function hasPageRegistryTable(pool: Pool): Promise<boolean> {
  try {
    const { rows } = await pool.query<{ oid: string | null }>(
      "SELECT to_regclass('public.page_registry_v1') AS oid"
    );
    return !!rows[0]?.oid;
  } catch {
    return false;
  }
}

/**
 * Load DPU rows for a document in page order.
 * Returns the `page_text` from the payload (the pre-resolved best text).
 */
async function loadDpuRows(
  pool: Pool,
  documentId: string,
  version: string,
  pageStart: number,
  pageEnd: number
): Promise<DpuRow[]> {
  const { rows } = await pool.query<{
    page_index: number;
    page_text: string | null;
    payload: Record<string, unknown> | null;
  }>(
    `SELECT page_index,
            (payload->>'page_text')::text AS page_text,
            payload
       FROM public.document_page_understanding
      WHERE document_id = $1::uuid
        AND version     = $2::text
        AND page_index >= $3::int
        AND page_index <  $4::int
      ORDER BY page_index ASC`,
    [documentId, version, pageStart, pageEnd]
  );
  return rows;
}

/**
 * Choose the best excerpt from page_text (first 280 chars of meaningful text).
 */
function buildExcerpt(pageText: string): string | undefined {
  const trimmed = pageText.replace(/\s+/g, " ").trim();
  if (!trimmed) return undefined;
  return capPageExcerpt(trimmed);
}

// ─── Main function ────────────────────────────────────────────────────────────

export interface PopulatePageRegistryV1Opts {
  dealId: string;
  documentId: string;
  pageStart?: number;
  pageEnd?: number;
  /** DPU version key (default: "page_understanding_v1") */
  version?: string;
  /** Batch size for upsert (default: 50) */
  batchSize?: number;
}

/**
 * Populate page_registry_v1 for a single document.
 *
 * Design guarantees:
 * - Idempotent: re-runs overwrite existing page_id rows.
 * - Never throws: catches all errors, returns result summary.
 * - Best-effort: per-page errors are skipped with a log, not fatal.
 */
export async function populatePageRegistryV1(
  pool: Pool,
  opts: PopulatePageRegistryV1Opts
): Promise<PopulatePageRegistryV1Result> {
  const {
    dealId,
    documentId,
    pageStart = 0,
    pageEnd = 9999,
    version = "page_understanding_v1",
    batchSize = 50,
  } = opts;

  const base: PopulatePageRegistryV1Result = {
    ok: false,
    deal_id: dealId,
    document_id: documentId,
    pages_attempted: 0,
    pages_upserted: 0,
    pages_skipped_no_text: 0,
  };

  try {
    // Guard: table must exist
    const tableExists = await hasPageRegistryTable(pool);
    if (!tableExists) {
      return {
        ...base,
        error: "page_registry_v1 table not found — migration not applied",
      };
    }

    // Load DPU rows
    const dpuRows = await loadDpuRows(pool, documentId, version, pageStart, pageEnd);

    if (dpuRows.length === 0) {
      return { ...base, ok: true };
    }

    base.pages_attempted = dpuRows.length;

    // Batch rows for upsert
    const batch: PageRegistryRowV1[] = [];
    let totalUpserted = 0;

    for (const dpu of dpuRows) {
      const pageText = dpu.page_text?.trim() ?? "";

      if (!pageText) {
        base.pages_skipped_no_text++;
        continue;
      }

      try {
        // Deterministic extraction
        const numericClaims = extractNumericClaims(pageText);
        const entities = extractEntities(pageText);
        const keyClaims = extractKeyClaims(pageText);

        // Page type classification
        const { page_type, confidence } = classifyPageTypeV1(
          pageText,
          numericClaims,
          entities
        );

        // Build row
        const row: PageRegistryRowV1 = {
          page_id: computePageId({
            deal_id: dealId,
            document_id: documentId,
            page_number: dpu.page_index,
          }),
          deal_id: dealId,
          document_id: documentId,
          page_number: dpu.page_index,
          page_type,
          confidence,
          entities,
          numeric_claims: numericClaims,
          key_claims: keyClaims,
          evidence_ids: [],
          excerpt: buildExcerpt(pageText),
        };

        batch.push(row);

        // Flush batch
        if (batch.length >= batchSize) {
          const upserted = await upsertPageRegistryRowsV1(pool, batch);
          totalUpserted += upserted;
          batch.length = 0;
        }
      } catch (pageErr) {
        // Per-page error: skip and continue
        console.warn(
          JSON.stringify({
            event: "PAGE_REGISTRY_V1_PAGE_ERROR",
            deal_id: dealId,
            document_id: documentId,
            page_index: dpu.page_index,
            error: pageErr instanceof Error ? pageErr.message : String(pageErr),
            ts: new Date().toISOString(),
          })
        );
      }
    }

    // Flush remaining
    if (batch.length > 0) {
      const upserted = await upsertPageRegistryRowsV1(pool, batch);
      totalUpserted += upserted;
    }

    base.pages_upserted = totalUpserted;
    base.ok = true;
    return base;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ...base, error: msg };
  }
}
