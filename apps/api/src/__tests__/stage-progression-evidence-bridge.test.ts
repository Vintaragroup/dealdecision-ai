import { test } from "node:test";
import assert from "node:assert/strict";

import { evaluateDealStageProgression } from "../services/stageProgression";

test("stage progression prefers evidence_items when table exists and has rows", async () => {
  const pool = {
    query: async (sql: string, params?: unknown[]) => {
      if (sql.includes("FROM deals") && sql.includes("deleted_at")) {
        return {
          rows: [
            {
              id: String((params ?? [])[0]),
              stage: "in_diligence",
              score: 80,
              created_at: new Date("2026-02-10T00:00:00.000Z"),
              updated_at: new Date("2026-02-11T00:00:00.000Z"),
            },
          ],
        };
      }
      if (sql.includes("COUNT(*) as count") && sql.includes("FROM documents")) {
        return { rows: [{ count: "2" }] };
      }
      if (sql.includes("to_regclass('public.evidence_items')")) {
        return { rows: [{ oid: "evidence_items" }] };
      }
      if (sql.includes("FROM evidence_items")) {
        return { rows: [{ count: "2" }] };
      }
      if (sql.includes("FROM evidence") && !sql.includes("evidence_items")) {
        return { rows: [{ count: "0" }] };
      }
      if (sql.includes("FROM deal_intelligence_objects")) {
        return { rows: [{ ok: 1 }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  } as any;

  const res = await evaluateDealStageProgression(pool, "deal-1", {
    env: { NODE_ENV: "test", DDAI_FAIL_OPEN_MODE: "dev" } as any,
    getNodeEvidenceGateForDeal: (async () => ({ gate: { status: "ok", node_coverage_pct: 100 } as any, source: "none" })) as any,
  });

  assert.equal(res.shouldProgress, true);
  assert.equal(res.newStage, "ready_decision");
});

test("stage progression falls back to legacy evidence when evidence_items is absent", async () => {
  const pool = {
    query: async (sql: string, params?: unknown[]) => {
      if (sql.includes("FROM deals") && sql.includes("deleted_at")) {
        return {
          rows: [
            {
              id: String((params ?? [])[0]),
              stage: "in_diligence",
              score: 80,
              created_at: new Date("2026-02-10T00:00:00.000Z"),
              updated_at: new Date("2026-02-11T00:00:00.000Z"),
            },
          ],
        };
      }
      if (sql.includes("COUNT(*) as count") && sql.includes("FROM documents")) {
        return { rows: [{ count: "2" }] };
      }
      if (sql.includes("to_regclass('public.evidence_items')")) {
        return { rows: [{ oid: null }] };
      }
      if (sql.includes("FROM evidence") && !sql.includes("evidence_items")) {
        return { rows: [{ count: "2" }] };
      }
      if (sql.includes("FROM deal_intelligence_objects")) {
        return { rows: [{ ok: 1 }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  } as any;

  const res = await evaluateDealStageProgression(pool, "deal-2", {
    env: { NODE_ENV: "test", DDAI_FAIL_OPEN_MODE: "dev" } as any,
    getNodeEvidenceGateForDeal: (async () => ({ gate: { status: "ok", node_coverage_pct: 100 } as any, source: "none" })) as any,
  });

  assert.equal(res.shouldProgress, true);
  assert.equal(res.newStage, "ready_decision");
});
