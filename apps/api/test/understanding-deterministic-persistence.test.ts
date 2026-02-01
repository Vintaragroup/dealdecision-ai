import test from "node:test";
import assert from "node:assert/strict";
import fastify from "fastify";

import { registerUnderstandingRoutes } from "../src/routes/understanding";
import { enrichDeterministically } from "../src/understanding/enrich";
import { getLatestUnderstandingPatch, persistUnderstandingPatch } from "../src/understanding/persist";

type StoredRow = {
  id: string;
  deal_id: string;
  analysis_version: string;
  input_hash: string;
  created_at: string;
  patch_json: any;
};

function makeMockPool() {
  let nextId = 1;
  const rowsByKey = new Map<string, StoredRow>();

  function key(dealId: string, analysisVersion: string, inputHash: string) {
    return `${dealId}|${analysisVersion}|${inputHash}`;
  }

  return {
    state: {
      rowsByKey,
      get count() {
        return rowsByKey.size;
      },
      list() {
        return [...rowsByKey.values()];
      },
    },
    async query(sql: string, params: any[]) {
      if (sql.includes("INSERT INTO understanding_patches")) {
        const [deal_id, analysis_version, input_hash, created_at, patch_json] = params;
        const k = key(String(deal_id), String(analysis_version), String(input_hash));
        if (rowsByKey.has(k)) return { rows: [] };

        const row: StoredRow = {
          id: `up-${nextId++}`,
          deal_id: String(deal_id),
          analysis_version: String(analysis_version),
          input_hash: String(input_hash),
          created_at: String(created_at),
          patch_json: JSON.parse(String(patch_json)),
        };
        rowsByKey.set(k, row);
        return { rows: [row] };
      }

      if (sql.includes("FROM understanding_patches") && sql.includes("WHERE deal_id = $1") && sql.includes("AND analysis_version = $2") && sql.includes("AND input_hash = $3")) {
        const [deal_id, analysis_version, input_hash] = params;
        const k = key(String(deal_id), String(analysis_version), String(input_hash));
        const row = rowsByKey.get(k);
        return { rows: row ? [row] : [] };
      }

      if (sql.includes("FROM understanding_patches") && sql.includes("ORDER BY created_at DESC")) {
        const [deal_id, analysis_version] = params;
        const matches = [...rowsByKey.values()].filter(
          (r) => r.deal_id === String(deal_id) && r.analysis_version === String(analysis_version)
        );
        matches.sort((a, b) => {
          const cd = String(b.created_at).localeCompare(String(a.created_at));
          if (cd !== 0) return cd;
          return String(b.id).localeCompare(String(a.id));
        });
        return { rows: matches.slice(0, 1) };
      }

      return { rows: [] };
    },
  } as any;
}

test("deterministic understanding persistence: same input twice => one stored record", async () => {
  const mockPool = makeMockPool();
  const app = fastify({ logger: false });
  await registerUnderstandingRoutes(app, mockPool);

  const dealId = "00000000-0000-0000-0000-000000000001";

  const payload = {
    documents: [{ document_id: "doc-1", title: "Deck" }],
    pages: [
      {
        page_id: "p1",
        document_id: "doc-1",
        page_index: 0,
        raw_ocr_text: "Revenue $100 in 2024",
      },
    ],
  };

  const r1 = await app.inject({
    method: "POST",
    url: `/api/v1/deals/${dealId}/understanding/deterministic`,
    payload,
  });
  assert.equal(r1.statusCode, 200);

  const b1 = r1.json();
  assert.equal(b1.analysis_version, "deterministic_understanding_v1");
  assert.ok(typeof b1.input_hash === "string" && b1.input_hash.length > 0);
  assert.ok(typeof b1.created_at === "string" && b1.created_at.length > 0);

  // Response patch can be reproduced deterministically using returned created_at.
  const expected1 = enrichDeterministically({ ...payload, deal_id: dealId } as any, {
    now: () => new Date(b1.created_at),
  });
  assert.deepEqual(b1.patch, expected1);

  const r2 = await app.inject({
    method: "POST",
    url: `/api/v1/deals/${dealId}/understanding/deterministic`,
    payload,
  });
  assert.equal(r2.statusCode, 200);

  const b2 = r2.json();
  assert.deepEqual(b2, b1);
  assert.equal(mockPool.state.count, 1);
});

test("Acceptance: Patch round-trip persists without undefined-field drift", async () => {
  const mockPool = makeMockPool();

  const dealId = "00000000-0000-0000-0000-0000000000aa";
  const input = {
    deal_id: dealId,
    documents: [{ document_id: "doc-1" }],
    pages: [
      {
        page_id: "p1",
        document_id: "doc-1",
        // Intentionally omit optional fields like page_index in order to catch undefined drift.
        raw_ocr_text: "Revenue $100 in 2024",
      },
    ],
  } as any;

  const patch = enrichDeterministically(input, { now: () => new Date("2026-01-31T00:00:00.000Z") });
  const stored = await persistUnderstandingPatch(patch, { pool: mockPool });

  assert.deepEqual(stored.patch, patch);
  // If any undefined optional fields slip into the patch, JSON round-trip would drop them.
  assert.deepEqual(JSON.parse(JSON.stringify(patch)), patch);
});

test("deterministic understanding persistence: different input_hash => two records; GET returns latest", async () => {
  const mockPool = makeMockPool();
  const app = fastify({ logger: false });
  await registerUnderstandingRoutes(app, mockPool);

  const dealId = "00000000-0000-0000-0000-000000000002";

  const payload1 = {
    documents: [{ document_id: "doc-1", title: "Deck" }],
    pages: [
      {
        page_id: "p1",
        document_id: "doc-1",
        page_index: 0,
        raw_ocr_text: "Revenue $100 in 2024",
      },
    ],
  };

  const r1 = await app.inject({
    method: "POST",
    url: `/api/v1/deals/${dealId}/understanding/deterministic`,
    payload: payload1,
  });
  assert.equal(r1.statusCode, 200);
  const b1 = r1.json();

  // Ensure created_at differs deterministically across calls.
  await new Promise((r) => setTimeout(r, 5));

  const payload2 = {
    ...payload1,
    pages: [
      {
        ...payload1.pages[0],
        raw_ocr_text: "Revenue $200 in 2024",
      },
    ],
  };

  const r2 = await app.inject({
    method: "POST",
    url: `/api/v1/deals/${dealId}/understanding/deterministic`,
    payload: payload2,
  });
  assert.equal(r2.statusCode, 200);
  const b2 = r2.json();

  assert.notEqual(b1.input_hash, b2.input_hash);
  assert.equal(mockPool.state.count, 2);

  const g = await app.inject({
    method: "GET",
    url: `/api/v1/deals/${dealId}/understanding/deterministic`,
  });
  assert.equal(g.statusCode, 200);
  const latest = g.json();

  // Latest should match whichever record has the most recent created_at.
  const expected = [b1, b2].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
  assert.deepEqual(latest, expected);
});

test("Acceptance: Latest retrieval tie-breaks by id desc when created_at is equal", async () => {
  const mockPool = makeMockPool();

  const dealId = "00000000-0000-0000-0000-0000000000bb";
  const createdAt = "2026-01-31T00:00:00.000Z";

  const p1 = enrichDeterministically(
    {
      deal_id: dealId,
      documents: [{ document_id: "doc-1" }],
      pages: [{ page_id: "p1", document_id: "doc-1", page_index: 0, raw_ocr_text: "Revenue $100 in 2024" }],
    } as any,
    { now: () => new Date(createdAt) }
  );
  const p2 = enrichDeterministically(
    {
      deal_id: dealId,
      documents: [{ document_id: "doc-1" }],
      pages: [{ page_id: "p1", document_id: "doc-1", page_index: 0, raw_ocr_text: "Revenue $200 in 2024" }],
    } as any,
    { now: () => new Date(createdAt) }
  );

  const r1 = await persistUnderstandingPatch(p1, { pool: mockPool });
  const r2 = await persistUnderstandingPatch(p2, { pool: mockPool });
  assert.equal(r1.created_at, createdAt);
  assert.equal(r2.created_at, createdAt);
  assert.notEqual(r1.id, r2.id);

  const latest = await getLatestUnderstandingPatch(dealId, "deterministic_understanding_v1", { pool: mockPool });
  assert.ok(latest);
  // With identical created_at, the later insert (higher id) must win.
  assert.equal(latest?.id, r2.id);
});
