import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import type { Pool } from "pg";

import { registerDashboardRoutes } from "../src/routes/dashboard";

function makeDpuPayload(input: { title: string; segment_key: string; bullets: string[] }) {
  return {
    structured: {
      title: input.title,
      segment_key: input.segment_key,
      bullets: input.bullets,
    },
  };
}

test("/api/dashboard/deals/:deal_id/nodes/inspect includes evidence_role + exclusion_reason", async () => {
  const app = Fastify();

  const dealId = "00000000-0000-0000-0000-0000000000a1";

  const dpuRows = [
    {
      document_id: "doc-1",
      page_index: 0,
      payload: makeDpuPayload({
        title: "Go to Market Strategy",
        segment_key: "go_to_market",
        bullets: ["Channels: DTC via Shopify and wholesale through retailers"],
      }),
    },
    {
      document_id: "doc-1",
      page_index: 1,
      payload: makeDpuPayload({
        title: "Team",
        segment_key: "team",
        bullets: ["Hiring plan"],
      }),
    },
  ];

  const mockPool = {
    query: async (sql: string, params?: unknown[]) => {
      const q = String(sql);

      // getSegmentedNodesForDeal
      if (q.includes("FROM public.document_page_understanding") && q.includes("version = 'page_understanding_v1'") && q.includes("ORDER BY document_id, page_index")) {
        assert.deepEqual(params, [dealId]);
        return { rows: dpuRows };
      }

      // evidence connections query inside the route
      if (q.includes("WITH dpu AS") && q.includes("FROM evidence_items")) {
        assert.deepEqual(params, [dealId]);
        return { rows: [] };
      }

      // visual_assets lookup is optional; in this test we have no visual_asset_id.
      if (q.includes("FROM visual_assets") && q.includes("quality_flags")) {
        return { rows: [] };
      }

      throw new Error(`Unexpected SQL in test: ${q}`);
    },
  } as unknown as Pool;

  await registerDashboardRoutes(app, mockPool);

  try {
    const res = await app.inject({
      method: "GET",
      url: `/api/dashboard/deals/${dealId}/nodes/inspect`,
    });

    assert.equal(res.statusCode, 200, `Unexpected status ${res.statusCode}: ${res.body}`);

    const body = res.json() as any;
    assert.ok(Array.isArray(body.nodes));

    const gtm = body.nodes.find((n: any) => n.page_index === 0);
    assert.ok(gtm);
    assert.equal(gtm.structured_segment_key_raw, "go_to_market");
    assert.equal(gtm.evidence_role, "primary");
    assert.equal(gtm.exclusion_reason, null);

    const team = body.nodes.find((n: any) => n.page_index === 1);
    assert.ok(team);
    assert.equal(team.structured_segment_key_raw, "team");
    assert.equal(team.evidence_role, "excluded");
    assert.equal(team.exclusion_reason, "team_advisors_hiring");
  } finally {
    await app.close();
  }
});
