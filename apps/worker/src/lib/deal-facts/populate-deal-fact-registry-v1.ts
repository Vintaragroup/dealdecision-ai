/**
 * populate-deal-fact-registry-v1.ts
 *
 * Orchestrates the full Deal Fact Registry v1 pipeline for a deal:
 *   1. Load page_registry_v1 rows for the deal
 *   2. Build DealFactV1 entries (extractive, evidence-backed)
 *   3. Run conflict detection pass
 *   4. Upsert to deal_facts_v1 table
 *
 * - Idempotent: safe to run multiple times.
 * - Best-effort: never throws, never breaks parent job.
 * - Logs structured events: DEAL_FACT_REGISTRY_V1_POPULATED | DEAL_FACT_REGISTRY_V1_ERROR
 */

import type { Pool } from "pg";

import { queryPageRegistryForDeal } from "../db/page-registry-db";
import { buildDealFactRegistryV1 } from "./build-deal-fact-registry-v1";
import { detectDealFactConflictsV1 } from "./detect-deal-fact-conflicts-v1";
import { upsertDealFactsV1 } from "../db/deal-facts-db";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PopulateDealFactRegistryV1Opts {
  dealId: string;
  /**
   * When provided, restricts page_registry_v1 lookup to this document only.
   * When omitted, loads all documents' pages for the deal.
   */
  documentId?: string;
  /** Max pages to load from page_registry_v1 (default 500). */
  pageLimit?: number;
}

export interface PopulateDealFactRegistryV1Result {
  ok: boolean;
  deal_id: string;
  pages_loaded: number;
  facts_built: number;
  facts_conflicted: number;
  facts_upserted: number;
  error?: string;
}

// ─── Main entrypoint ──────────────────────────────────────────────────────────

export async function populateDealFactRegistryV1(
  pool: Pool,
  opts: PopulateDealFactRegistryV1Opts,
): Promise<PopulateDealFactRegistryV1Result> {
  const { dealId, documentId, pageLimit = 500 } = opts;

  try {
    // 1. Load page_registry_v1 rows
    const pageRows = await queryPageRegistryForDeal(pool, dealId, {
      documentId,
      limit: pageLimit,
    });

    if (pageRows.length === 0) {
      return {
        ok:               true,
        deal_id:          dealId,
        pages_loaded:     0,
        facts_built:      0,
        facts_conflicted: 0,
        facts_upserted:   0,
      };
    }

    // 2. Build facts (pure, extractive)
    const buildResult = buildDealFactRegistryV1({
      dealId,
      pageRegistryRows: pageRows,
    });

    if (!buildResult.ok || buildResult.facts.length === 0) {
      return {
        ok:               buildResult.ok,
        deal_id:          dealId,
        pages_loaded:     pageRows.length,
        facts_built:      0,
        facts_conflicted: 0,
        facts_upserted:   0,
        error:            buildResult.error,
      };
    }

    // 3. Conflict detection
    const factsWithConflicts = detectDealFactConflictsV1(buildResult.facts);
    const conflictedCount = factsWithConflicts.filter(
      (f) => (f.conflicts_with_fact_ids?.length ?? 0) > 0,
    ).length;

    // 4. Upsert to DB
    const upserted = await upsertDealFactsV1(pool, factsWithConflicts);

    return {
      ok:               true,
      deal_id:          dealId,
      pages_loaded:     pageRows.length,
      facts_built:      buildResult.facts.length,
      facts_conflicted: conflictedCount,
      facts_upserted:   upserted,
    };
  } catch (err) {
    return {
      ok:               false,
      deal_id:          dealId,
      pages_loaded:     0,
      facts_built:      0,
      facts_conflicted: 0,
      facts_upserted:   0,
      error:            String(err),
    };
  }
}
