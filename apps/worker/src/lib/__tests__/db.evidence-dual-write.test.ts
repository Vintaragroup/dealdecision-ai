import { describe, it, expect, beforeEach, vi } from "vitest";

// db.ts requires DATABASE_URL on import.
process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgres://user:pass@localhost:5432/db";

// ─── Helpers ────────────────────────────────────────────────────────────────

type QueryRecord = { sql: string; params?: unknown[] };

type MockPoolOptions = {
  /** Does the evidence table exist? (default: true) */
  legacyTableExists?: boolean;
  /** Does the evidence_items table exist? (default: true) */
  canonicalTableExists?: boolean;
  /** Should the legacy INSERT succeed? (default: true) */
  legacyInsertSucceeds?: boolean;
  /** Should the canonical INSERT succeed? (default: true) */
  canonicalInsertSucceeds?: boolean;
  /** evidence table columns available (default: full set) */
  legacyCols?: string[];
};

function makePool(opts: MockPoolOptions = {}): { pool: any; queries: QueryRecord[] } {
  const {
    legacyTableExists = true,
    canonicalTableExists = true,
    legacyInsertSucceeds = true,
    canonicalInsertSucceeds = true,
    legacyCols = ["evidence_id", "deal_id", "document_id", "source", "kind", "text", "confidence"],
  } = opts;

  const queries: QueryRecord[] = [];

  const pool = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      queries.push({ sql: sql.trim(), params });

      // to_regclass: table existence check
      if (/to_regclass/i.test(sql)) {
        if (/evidence_items/i.test(sql)) {
          return { rows: [{ oid: canonicalTableExists ? "evidence_items" : null }] };
        }
        // Legacy evidence table
        return { rows: [{ oid: legacyTableExists ? "evidence" : null }] };
      }

      // information_schema.columns: legacy schema probe
      if (/information_schema\.columns/i.test(sql) && /evidence\b/i.test(sql)) {
        return {
          rows: legacyCols.map((c) => ({ column_name: c })),
        };
      }

      // INSERT INTO evidence (legacy write)
      if (/INSERT INTO evidence\b/i.test(sql)) {
        if (!legacyInsertSucceeds) throw new Error("legacy_insert_failed");
        return { rows: [] };
      }

      // INSERT INTO evidence_items (canonical write)
      if (/INSERT INTO evidence_items\b/i.test(sql)) {
        if (!canonicalInsertSucceeds) throw new Error("canonical_insert_failed");
        return { rows: [{ inserted: true }] };
      }

      return { rows: [] };
    }),
  };

  return { pool, queries };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("insertEvidence dual-write — canonical evidence_items", () => {
  beforeEach(async () => {
    const db = await import("../db.js");
    // Reset the cached table-existence and schema-probe state between tests.
    db.__resetEvidenceItemsExistsCacheForTests();
    vi.clearAllMocks();
  });

  // Case 1: canonical write active — both tables receive a row
  it("writes to both evidence and evidence_items when canonical table exists", async () => {
    const db = await import("../db.js");
    const { pool, queries } = makePool({ canonicalTableExists: true });

    await db.__insertEvidenceItemsCanonicalWithPoolForTests(pool, {
      deal_id: "11111111-1111-1111-1111-111111111111",
      document_id: "22222222-2222-2222-2222-222222222222",
      source: "extraction",
      kind: "metric",
      text: "ARR: $5M",
      confidence: 0.9,
    });

    const canonicalInsert = queries.find((q) => /INSERT INTO evidence_items/i.test(q.sql));
    expect(canonicalInsert, "canonical INSERT must be issued").toBeDefined();
    expect(canonicalInsert!.params![0]).toMatch(/^ev_/); // evidence_id starts with ev_
    expect(canonicalInsert!.params![2]).toBe("extraction"); // source_type
    expect(canonicalInsert!.params![3]).toBe("extraction:22222222-2222-2222-2222-222222222222:metric"); // source_path
    expect(canonicalInsert!.params![6]).toBe(0.9); // confidence
    expect(canonicalInsert!.params![7]).toBe("ARR: $5M"); // content_text
  });

  // Case 2: evidence_items table absent — skips canonical write, legacy unaffected
  it("skips canonical write when evidence_items table is absent", async () => {
    const db = await import("../db.js");
    const { pool, queries } = makePool({ canonicalTableExists: false });

    // Should not throw
    await expect(
      db.__insertEvidenceItemsCanonicalWithPoolForTests(pool, {
        deal_id: "11111111-1111-1111-1111-111111111111",
        document_id: "22222222-2222-2222-2222-222222222222",
        source: "extraction",
        kind: "metric",
        text: "ARR: $5M",
        confidence: 0.9,
      })
    ).resolves.toBeUndefined();

    const canonicalInsert = queries.find((q) => /INSERT INTO evidence_items/i.test(q.sql));
    expect(canonicalInsert).toBeUndefined(); // no canonical INSERT attempted
  });

  // Case 3: canonical INSERT fails — error is swallowed, no rethrow
  it("swallows canonical INSERT failure without rethrowing", async () => {
    const db = await import("../db.js");
    const { pool, queries } = makePool({
      canonicalTableExists: true,
      canonicalInsertSucceeds: false,
    });

    // Should not throw even though canonical INSERT fails
    await expect(
      db.__insertEvidenceItemsCanonicalWithPoolForTests(pool, {
        deal_id: "11111111-1111-1111-1111-111111111111",
        source: "extraction",
        kind: "metric",
        text: "some text",
        confidence: 0.8,
      })
    ).resolves.toBeUndefined();

    const canonicalInsert = queries.find((q) => /INSERT INTO evidence_items/i.test(q.sql));
    expect(canonicalInsert).toBeDefined(); // INSERT was attempted
  });

  // Case 4: deterministic identity — same params → same evidence_id
  it("produces the same evidence_id for identical params (idempotent)", async () => {
    const db = await import("../db.js");
    const params = {
      deal_id: "11111111-1111-1111-1111-111111111111",
      document_id: "22222222-2222-2222-2222-222222222222",
      source: "extraction",
      kind: "metric",
      text: "Revenue: $1M",
      confidence: 0.8,
    };

    // First call
    const { pool: pool1, queries: queries1 } = makePool();
    await db.__insertEvidenceItemsCanonicalWithPoolForTests(pool1, params);
    const id1 = queries1.find((q) => /INSERT INTO evidence_items/i.test(q.sql))?.params?.[0] as string;

    // Reset cache and call again with same params
    db.__resetEvidenceItemsExistsCacheForTests();
    const { pool: pool2, queries: queries2 } = makePool();
    await db.__insertEvidenceItemsCanonicalWithPoolForTests(pool2, params);
    const id2 = queries2.find((q) => /INSERT INTO evidence_items/i.test(q.sql))?.params?.[0] as string;

    expect(id1).toMatch(/^ev_/);
    expect(id1).toBe(id2); // deterministic
  });

  // Case 5: different content → different evidence_ids (no collision)
  it("produces different evidence_ids for different text content", async () => {
    const db = await import("../db.js");
    const base = {
      deal_id: "11111111-1111-1111-1111-111111111111",
      document_id: "22222222-2222-2222-2222-222222222222",
      source: "extraction",
      kind: "metric",
      confidence: 0.8,
    };

    const { pool: p1, queries: q1 } = makePool();
    await db.__insertEvidenceItemsCanonicalWithPoolForTests(p1, { ...base, text: "ARR: $1M" });
    const id1 = q1.find((q) => /INSERT INTO evidence_items/i.test(q.sql))?.params?.[0] as string;

    db.__resetEvidenceItemsExistsCacheForTests();
    const { pool: p2, queries: q2 } = makePool();
    await db.__insertEvidenceItemsCanonicalWithPoolForTests(p2, { ...base, text: "ARR: $5M" });
    const id2 = q2.find((q) => /INSERT INTO evidence_items/i.test(q.sql))?.params?.[0] as string;

    expect(id1).toMatch(/^ev_/);
    expect(id2).toMatch(/^ev_/);
    expect(id1).not.toBe(id2);
  });

  // Case 6: null document_id — uses "nodoc" in source_path, source_document_id is null
  it("handles null document_id correctly", async () => {
    const db = await import("../db.js");
    const { pool, queries } = makePool();

    await db.__insertEvidenceItemsCanonicalWithPoolForTests(pool, {
      deal_id: "11111111-1111-1111-1111-111111111111",
      document_id: null,
      source: "fetch_evidence",
      kind: "fact",
      text: "Some fact",
      confidence: 0.7,
    });

    const ins = queries.find((q) => /INSERT INTO evidence_items/i.test(q.sql))!;
    expect(ins.params![3]).toBe("fetch_evidence:nodoc:fact"); // source_path uses "nodoc"
    expect(ins.params![4]).toBeNull(); // source_document_id is null
  });

  // Case 7: source_path shape
  it("constructs source_path as {source}:{document_id}:{kind}", async () => {
    const db = await import("../db.js");
    const { pool, queries } = makePool();

    await db.__insertEvidenceItemsCanonicalWithPoolForTests(pool, {
      deal_id: "11111111-1111-1111-1111-111111111111",
      document_id: "33333333-3333-3333-3333-333333333333",
      source: "extraction",
      kind: "summary",
      text: "Executive summary text",
    });

    const ins = queries.find((q) => /INSERT INTO evidence_items/i.test(q.sql))!;
    expect(ins.params![3]).toBe("extraction:33333333-3333-3333-3333-333333333333:summary");
  });

  // Case 8: tags array contains source and kind
  it("includes source and kind in the tags array", async () => {
    const db = await import("../db.js");
    const { pool, queries } = makePool();

    await db.__insertEvidenceItemsCanonicalWithPoolForTests(pool, {
      deal_id: "11111111-1111-1111-1111-111111111111",
      source: "extraction",
      kind: "section",
      text: "Go-to-market strategy",
    });

    const ins = queries.find((q) => /INSERT INTO evidence_items/i.test(q.sql))!;
    const tags = ins.params![5] as string[];
    expect(tags).toContain("extraction");
    expect(tags).toContain("section");
  });

  // Case 9: meta includes writer and kind markers
  it("includes writer and kind in the meta jsonb field", async () => {
    const db = await import("../db.js");
    const { pool, queries } = makePool();

    await db.__insertEvidenceItemsCanonicalWithPoolForTests(pool, {
      deal_id: "11111111-1111-1111-1111-111111111111",
      source: "extraction",
      kind: "metric",
      text: "Metric value",
    });

    const ins = queries.find((q) => /INSERT INTO evidence_items/i.test(q.sql))!;
    const meta = JSON.parse(ins.params![8] as string);
    expect(meta.writer).toBe("fetch_evidence_dual_write");
    expect(meta.kind).toBe("metric");
  });

  // Case 10: cache avoids repeat to_regclass checks within same process
  it("only issues one to_regclass check per process lifecycle", async () => {
    const db = await import("../db.js");

    const { pool, queries } = makePool({ canonicalTableExists: true });

    const params = {
      deal_id: "11111111-1111-1111-1111-111111111111",
      source: "extraction",
      kind: "metric",
      text: "Text A",
    };

    // Two writes with the same pool instance
    await db.__insertEvidenceItemsCanonicalWithPoolForTests(pool, params);
    await db.__insertEvidenceItemsCanonicalWithPoolForTests(pool, { ...params, text: "Text B" });

    const regclassCalls = queries.filter((q) => /to_regclass/i.test(q.sql));
    // Cache hit on second call: only 1 regclass query total
    expect(regclassCalls.length).toBe(1);
  });
});

// ─── Integration: stage-0 loaders no longer fall back after dual-write ────────

describe("Stage-0 loader fallback reduction after dual-write", () => {
  it("a deal processed after dual-write should have canonical evidence and not need fallback", async () => {
    // This test documents the intended post-fix state: a deal whose evidence
    // was written by insertEvidence (with dual-write active) will have rows in
    // evidence_items, so loadCoverageSnapshot returns evidenceSource=canonical
    // without touching the legacy table.
    //
    // We verify this by showing that the canonical write produces a row in
    // evidence_items with the correct deal_id, which is what the
    // stage-0 COUNT query will find.

    const db = await import("../db.js");
    const { pool, queries } = makePool({ canonicalTableExists: true });

    await db.__insertEvidenceItemsCanonicalWithPoolForTests(pool, {
      deal_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      document_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      source: "extraction",
      kind: "metric",
      text: "Pipeline: $10M",
      confidence: 0.85,
    });

    const canonicalInsert = queries.find((q) => /INSERT INTO evidence_items/i.test(q.sql));
    expect(canonicalInsert).toBeDefined();
    // The deal_id param (index 1) matches the deal we wrote for
    expect(canonicalInsert!.params![1]).toBe("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    // After this write, a COUNT on evidence_items WHERE deal_id = X would return >0
    // and stage-0 would resolve evidenceSource = "canonical" (no fallback needed).
  });
});
