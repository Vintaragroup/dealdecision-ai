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
  it("ref-only (snippet=null, ocr=null): legacy evidence written with placeholder, evidence_items NOT written", async () => {
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
          ocr_text: null,
          ocr_confidence: null,
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

    // evidence_items must NOT be written — placeholder pollutes governed overlay.
    expect(evidenceItemsInserts(queryCalls).length).toBe(0);

    // Legacy evidence row IS written (placeholder keeps the citation anchor alive).
    const legacy = legacyEvidenceInserts(queryCalls);
    expect(legacy.length).toBe(1);
    // evidence.text is the placeholder
    const textParam = legacy[0]!.params.find((p) => typeof p === "string" && (p as string).includes("no OCR snippet"));
    expect(textParam).toBeTruthy();
  });

  it("ref-only array signal (snippet=null, ocr=null): legacy evidence written, evidence_items NOT written", async () => {
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
          ocr_text: null,
          ocr_confidence: null,
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
    expect(evidenceItemsInserts(queryCalls).length).toBe(0);
    expect(legacyEvidenceInserts(queryCalls).length).toBe(1);
  });

  it("evidence_items IS written when ref-only row has long enough OCR text (>= 40 chars)", async () => {
    const LONG_OCR = "Market size is $4.2B growing at 18% CAGR with strong SaaS tailwinds.";
    const { pool, queryCalls } = makeMockPool({
      linkRows: [
        {
          document_id: DOC_ID,
          page_index: 5,
          evidence_type: "market",
          visual_asset_id: ASSET_ID,
          ref: { slide: "Market" },
          snippet: null,
          confidence: 0,
          ocr_text: LONG_OCR,
          ocr_confidence: 0.8,
        },
      ],
    });

    const result = await materializePhaseBVisualEvidenceForDeal(
      pool as any,
      DEAL_ID,
      { env: ENV }
    );

    expect(result.materialized).toBe(1);
    const items = evidenceItemsInserts(queryCalls);
    expect(items.length).toBe(1);
    // content_text must be the real OCR text, not a placeholder
    expect(String(items[0]!.params[8])).toBe(LONG_OCR);
    expect(String(items[0]!.params[8])).not.toContain("no OCR snippet");
  });

  it("evidence_items NOT written when OCR is short (< 40 chars) and snippet is null", async () => {
    const { pool, queryCalls } = makeMockPool({
      linkRows: [
        {
          document_id: DOC_ID,
          page_index: 1,
          evidence_type: "chart",
          visual_asset_id: ASSET_ID,
          ref: { slide: "Overview" },
          snippet: null,
          confidence: 0.6,
          ocr_text: "Short OCR",   // < 40 chars — not usable
          ocr_confidence: 0.9,
        },
      ],
    });

    const result = await materializePhaseBVisualEvidenceForDeal(
      pool as any,
      DEAL_ID,
      { env: ENV }
    );

    expect(result.materialized).toBe(1);  // legacy evidence still written (placeholder)
    expect(evidenceItemsInserts(queryCalls).length).toBe(0);
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
          ocr_text: null,
          ocr_confidence: null,
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

  // ---------------------------------------------------------------------------
  // OCR fallback tests
  // ---------------------------------------------------------------------------

  it("Case A: snippet=null, ve.ocr_text present => content_text = OCR text (not placeholder)", async () => {
    const OCR_TEXT = "Revenue grew 40% YoY reaching $2.4M ARR in Q4. Gross margin 72%.";
    const { pool, queryCalls } = makeMockPool({
      linkRows: [
        {
          document_id: DOC_ID,
          page_index: 3,
          evidence_type: "financial_metrics",
          visual_asset_id: ASSET_ID,
          ref: { slide: "Financials" },
          snippet: null,
          confidence: 0,
          ocr_text: OCR_TEXT,
          ocr_confidence: 0.85,
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
    // content_text param is at index 8 in the evidence_items INSERT
    const contentText = String(items[0]!.params[8]);
    expect(contentText).toBe(OCR_TEXT);
    expect(contentText).not.toContain("no OCR snippet");

    // confidence should be max(0, 0.85, 0.5) = 0.85
    const confidenceParam = items[0]!.params[7] as number;
    expect(confidenceParam).toBeCloseTo(0.85, 5);
  });

  it("Case B: snippet present, ocr_text present => snippet wins, OCR ignored (no regression)", async () => {
    const SNIPPET = "Platform automates invoice reconciliation saving 4 hours/week per user.";
    const OCR_TEXT = "This OCR text should not be used since snippet is available.";
    const { pool, queryCalls } = makeMockPool({
      linkRows: [
        {
          document_id: DOC_ID,
          page_index: 2,
          evidence_type: "product",
          visual_asset_id: ASSET_ID,
          ref: { tag: "product_overview" },
          snippet: SNIPPET,
          confidence: 0.9,
          ocr_text: OCR_TEXT,
          ocr_confidence: 0.6,
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

    const items = evidenceItemsInserts(queryCalls);
    expect(items.length).toBe(1);
    const contentText = String(items[0]!.params[8]);
    // Must use snippet, NOT ocr_text
    expect(contentText).toBe(SNIPPET);
    expect(contentText).not.toContain("OCR text should not be used");

    // confidence = max(0.9, 0.6, 0.5) = 0.9
    const confidenceParam = items[0]!.params[7] as number;
    expect(confidenceParam).toBeCloseTo(0.9, 5);
  });

  it("Case C: snippet=null, ocr_text=null, ref={} (empty) => skipped, no inserts", async () => {
    const { pool, queryCalls } = makeMockPool({
      linkRows: [
        {
          document_id: DOC_ID,
          page_index: 0,
          evidence_type: "unknown",
          visual_asset_id: null,
          ref: {},       // empty object — hasAnyRefSignal returns false
          snippet: null,
          confidence: 0.9, // high confidence should NOT prevent skip when no text
          ocr_text: null,
          ocr_confidence: null,
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
    expect(legacyEvidenceInserts(queryCalls).length).toBe(0);
  });

  it("PPTX-style: snippet present on non-PDF row behaves identically (no regression)", async () => {
    const SNIPPET = "B2B SaaS platform for HR compliance. 120 customers, $1.2M ARR.";
    const { pool, queryCalls } = makeMockPool({
      linkRows: [
        {
          document_id: DOC_ID,
          page_index: 0,
          evidence_type: "overview",
          visual_asset_id: ASSET_ID,
          ref: [{ slide: 1 }],
          snippet: SNIPPET,
          confidence: 0.75,
          // Both OCR fields absent, simulating PPTX path where visual_extractions has no OCR
          ocr_text: null,
          ocr_confidence: null,
        },
      ],
    });

    const result = await materializePhaseBVisualEvidenceForDeal(
      pool as any,
      DEAL_ID,
      { env: ENV }
    );

    expect(result.materialized).toBe(1);
    const items = evidenceItemsInserts(queryCalls);
    expect(String(items[0]!.params[8])).toBe(SNIPPET);
  });
});
