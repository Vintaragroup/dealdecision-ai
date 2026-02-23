/**
 * Regression tests for materializePhaseBVisualEvidenceForDeal.
 *
 * Key regression: evidence_links rows with snippet=null, confidence=0, and a
 * non-empty ref object must be materialized into BOTH `evidence` and
 * `evidence_items` — not skipped.  Before the fix the two-stage skip logic
 * treated confidence=0 as "actual low confidence" instead of "unset", causing
 * all ref-only rows to be silently skipped.
 *
 * After this fix, these rows must produce an `INSERT INTO evidence_items`
 * with source_type='phaseb_visual' so that the governed-LLM narration
 * pipeline can build a citation catalog and return evidence_basis="cited"
 * instead of "no_evidence".
 */

import { describe, it, expect } from "vitest";
import { materializePhaseBVisualEvidenceForDeal } from "../materialize-evidence";

// ---------------------------------------------------------------------------
// Inline pool mock — each test creates its own instance so query captures
// are isolated and there is no global state to reset between tests.
// ---------------------------------------------------------------------------

type QueryCall = { sql: string; params: unknown[] };

function makeMockPool(opts: { linkRows: Record<string, unknown>[] }): {
  pool: any;
  queryCalls: QueryCall[];
} {
  const queryCalls: QueryCall[] = [];
  const pool = {
    async query(sql: string, params?: unknown[]) {
      const s = String(sql).trim();
      queryCalls.push({ sql: s, params: params ?? [] });

      if (s.includes("to_regclass"))
        return { rows: [{ oid: "12345" }], rowCount: 1 };

      if (s.includes("information_schema.columns"))
        return { rows: [{ ok: 1 }], rowCount: 1 };

      if (s.startsWith("DELETE")) return { rows: [], rowCount: 0 };

      if (s.includes("FROM evidence_links"))
        return { rows: opts.linkRows, rowCount: opts.linkRows.length };

      if (s.startsWith("INSERT")) return { rows: [], rowCount: 1 };

      return { rows: [], rowCount: 0 };
    },
  };
  return { pool, queryCalls };
}

function evidenceItemsInserts(calls: QueryCall[]): QueryCall[] {
  return calls.filter(
    (q) => q.sql.startsWith("INSERT") && q.sql.includes("evidence_items")
  );
}

function legacyEvidenceInserts(calls: QueryCall[]): QueryCall[] {
  return calls.filter(
    (q) =>
      q.sql.startsWith("INSERT") &&
      q.sql.includes("evidence") &&
      !q.sql.includes("evidence_items")
  );
}

const DEAL_ID = "cccc0000-0000-0000-0000-000000000003";
const DOC_ID = "aaaa0000-0000-0000-0000-000000000001";
const ASSET_ID = "bbbb0000-0000-0000-0000-000000000002";
const ENV = { DDAI_ENABLE_PHASEB_VISUAL_EVIDENCE: "1" };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("materializePhaseBVisualEvidenceForDeal — evidence_items upsert", () => {
  it("inserts into evidence_items when snippet=null, confidence=0, ref has keys (regression)", async () => {
    const { pool, queryCalls } = makeMockPool({
      linkRows: [
        {
          document_id: DOC_ID,
          page_index: 2,
          evidence_type: "revenue",
          visual_asset_id: ASSET_ID,
          ref: { slide: "Financials", anchor: "chart_1" },
          snippet: null,
          confidence: 0,
        },
      ],
    });

    const result = await materializePhaseBVisualEvidenceForDeal(
      pool as any,
      DEAL_ID,
      { env: ENV }
    );

    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(0);
    expect(result.materialized).toBe(1);

    const items = evidenceItemsInserts(queryCalls);
    expect(items.length).toBe(1);

    const { sql, params } = items[0]!;
    // evidence_id = deterministic UUID derived from the idKey
    expect(typeof params[0]).toBe("string");
    // deal_id
    expect(params[1]).toBe(DEAL_ID);
    // source_type
    expect(params[2]).toBe("phaseb_visual");
    // source_path — must contain page:3 (page_number = page_index+1 = 3)
    expect(String(params[3])).toMatch(/page:3/);
    // source_document_id
    expect(params[4]).toBe(DOC_ID);
    // source_visual_asset_id
    expect(params[5]).toBe(ASSET_ID);
    // tags: array containing phaseb_visual signal tag
    expect(Array.isArray(params[6])).toBe(true);
    expect((params[6] as string[]).some((t) => t.includes("phaseb_visual"))).toBe(true);
    // content_text falls back to the evidence_type label when snippet is null
    expect(String(params[8])).toContain("revenue");
    // SQL must include ON CONFLICT upsert
    expect(sql).toContain("ON CONFLICT (evidence_id)");
  });

  it("inserts into evidence_items when ref is a non-empty array (array ref signal)", async () => {
    const { pool, queryCalls } = makeMockPool({
      linkRows: [
        {
          document_id: DOC_ID,
          page_index: 5,
          evidence_type: "market",
          visual_asset_id: ASSET_ID,
          ref: [{ anchor: "chart_a" }, { anchor: "chart_b" }],
          snippet: null,
          confidence: 0,
        },
      ],
    });

    const result = await materializePhaseBVisualEvidenceForDeal(
      pool as any,
      DEAL_ID,
      { env: ENV }
    );

    expect(result.materialized).toBe(1);
    expect(result.skipped).toBe(0);
    expect(evidenceItemsInserts(queryCalls).length).toBe(1);
  });

  it("skips a row with no snippet, no ref, and confidence=0 — and emits no evidence_items insert", async () => {
    const { pool, queryCalls } = makeMockPool({
      linkRows: [
        {
          document_id: DOC_ID,
          page_index: 0,
          evidence_type: "other",
          visual_asset_id: null,
          ref: null,
          snippet: null,
          confidence: 0,
        },
      ],
    });

    const result = await materializePhaseBVisualEvidenceForDeal(
      pool as any,
      DEAL_ID,
      { env: ENV }
    );

    expect(result.materialized).toBe(0);
    expect(result.skipped).toBe(1);
    expect(evidenceItemsInserts(queryCalls).length).toBe(0);
  });

  it("deletes stale evidence_items rows before re-materializing", async () => {
    const altDealId = "dddd0000-0000-0000-0000-000000000004";
    const { pool, queryCalls } = makeMockPool({ linkRows: [] });

    await materializePhaseBVisualEvidenceForDeal(pool as any, altDealId, { env: ENV });

    const deletions = queryCalls.filter(
      (q) =>
        q.sql.startsWith("DELETE") &&
        q.sql.includes("evidence_items") &&
        q.sql.includes("phaseb_visual")
    );
    expect(deletions.length).toBe(1);
    expect(deletions[0]!.params[0]).toBe(altDealId);
  });

  it("both evidence and evidence_items receive inserts for the same eligible row", async () => {
    const { pool, queryCalls } = makeMockPool({
      linkRows: [
        {
          document_id: DOC_ID,
          page_index: 1,
          evidence_type: "team",
          visual_asset_id: "bbbb0000-0000-0000-0000-000000000005",
          ref: { key: "val" },
          snippet: "The team has 10 years experience.",
          confidence: 0.8,
        },
      ],
    });

    const result = await materializePhaseBVisualEvidenceForDeal(
      pool as any,
      DEAL_ID,
      { env: ENV }
    );

    expect(result.materialized).toBe(1);

    const legacy = legacyEvidenceInserts(queryCalls);
    const items = evidenceItemsInserts(queryCalls);
    expect(legacy.length).toBe(1);
    expect(items.length).toBe(1);

    // Both tables receive the same deterministic evidence_id.
    expect(legacy[0]!.params[0]).toBe(items[0]!.params[0]);
  });
});
