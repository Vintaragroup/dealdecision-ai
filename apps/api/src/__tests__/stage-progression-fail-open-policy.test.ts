import { test } from "node:test";
import assert from "node:assert/strict";

import { evaluateDealStageProgression } from "../services/stageProgression";

function makePoolMock(): any {
  return {
    query: async (sql: string, params?: unknown[]) => {
      if (sql.includes("FROM deals") && sql.includes("stage") && sql.includes("deleted_at")) {
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

      if (sql.includes("COUNT(*) as count") && sql.includes("FROM evidence")) {
        return { rows: [{ count: "2" }] };
      }

      if (sql.includes("FROM deal_intelligence_objects")) {
        return { rows: [{ ok: 1 }] };
      }

      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

test("stage progression prod_warn fails open but discloses when node gate throws", async () => {
  const pool = makePoolMock();
  const env = { NODE_ENV: "production", DDAI_FAIL_OPEN_MODE: "prod_warn" } as any;

  const res = await evaluateDealStageProgression(pool, "deal-1", {
    env,
    getNodeEvidenceGateForDeal: async () => {
      throw new Error("boom");
    },
  });

  assert.equal(res.shouldProgress, true);
  assert.equal(res.newStage, "ready_decision");
  assert.ok(Array.isArray(res.disclosures) && res.disclosures.includes("fail_open_stage_progression_gate"));
});

test("stage progression prod_block fails closed when node gate throws", async () => {
  const pool = makePoolMock();
  const env = { NODE_ENV: "production", DDAI_FAIL_OPEN_MODE: "prod_block" } as any;

  const res = await evaluateDealStageProgression(pool, "deal-2", {
    env,
    getNodeEvidenceGateForDeal: async () => {
      throw new Error("boom");
    },
  });

  assert.equal(res.shouldProgress, false);
  assert.ok(typeof res.reason === "string" && res.reason.includes("Blocked from ready_decision"));
  assert.ok(Array.isArray(res.disclosures) && res.disclosures.includes("fail_open_stage_progression_gate"));
});
