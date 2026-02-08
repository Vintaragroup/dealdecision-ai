import { test } from "node:test";
import assert from "node:assert/strict";

import { derivePromotedFactsFromDpuForDeal } from "../src/lib/promoted-facts-from-dpu";

const now = new Date().toISOString();

type DpuRow = { document_id: string; page_index: number; payload: any };

function mkPool(args: { dealId: string; dpuRows: DpuRow[] }): any {
	return {
		query: async (sql: string, params?: unknown[]) => {
			const q = String(sql);
			if (q.includes("SELECT 1 FROM document_page_understanding") && q.includes("LIMIT 1")) {
				return { rows: [{ ok: 1 }], rowCount: 1 };
			}
			if (q.includes("FROM public.document_page_understanding") && q.includes("WHERE deal_id = $1")) {
				assert.deepEqual(params, [args.dealId]);
				return {
					rows: args.dpuRows.map((r) => ({ document_id: r.document_id, page_index: r.page_index, payload: r.payload })),
				};
			}
			throw new Error(`Unexpected SQL in test: ${q}`);
		},
	};
}

test("marketing-attributed revenue typing: paid media/campaign tokens route to marketing_attributed_revenue_v1", async () => {
	const dealId = "00000000-0000-4000-8000-00000000ca22";
	const docId = "doc-marketing";

	const dpuRows: DpuRow[] = [
		{
			document_id: docId,
			page_index: 3,
			payload: {
				structured: {
					title: "Business Performance",
					bullets: [
						"Paid media campaign drove $800,000 in revenue; ROAS 4.2x; CAC improved QoQ",
						"Conversion rate 3.2%",
					],
				},
				source: {
					visual_asset_id: "00000000-0000-4000-8000-00000000c0aa",
					extracted_at: now,
				},
			},
		},
	];

	const pool = mkPool({ dealId, dpuRows });
	const facts = await derivePromotedFactsFromDpuForDeal(pool as any, dealId);

	const attributed = facts.find((f: any) => f?.content_json?.fact_type === "marketing_attributed_revenue_v1");
	assert.ok(attributed, "expected a marketing_attributed_revenue_v1 fact");
	assert.equal(attributed?.content_json?.value_json?.scope, "channel_attributed");
	assert.equal(attributed?.content_json?.value_json?.amount?.amount, 800000);
	assert.match(
		String(attributed?.content_json?.value_json?.typing_reason ?? ""),
		/marketing_attributed_revenue_v1: tokens=\[/,
		"expected deterministic typing_reason for attributed revenue"
	);

	assert.ok(
		!facts.some(
			(f: any) =>
				f?.content_json?.fact_type === "revenue_v1" &&
				f?.content_json?.value_json?.amount?.amount === 800000 &&
				String(f?.content_json?.value_json?.scope ?? "") === "company_total"
		),
		"expected paid-media/campaign revenue to not be emitted as company_total revenue_v1"
	);
});

test("marketing-attributed revenue typing: performance tokens alone (conversion/ROAS/CAC) route to marketing_attributed_revenue_v1", async () => {
	const dealId = "00000000-0000-4000-8000-00000000ca23";
	const docId = "doc-performance";

	const dpuRows: DpuRow[] = [
		{
			document_id: docId,
			page_index: 8,
			payload: {
				structured: {
					title: "Business Performance",
					bullets: ["Conversion improved and drove $800,000 in revenue"],
				},
				source: {
					visual_asset_id: "00000000-0000-4000-8000-00000000c0ab",
					extracted_at: now,
				},
			},
		},
	];

	const pool = mkPool({ dealId, dpuRows });
	const facts = await derivePromotedFactsFromDpuForDeal(pool as any, dealId);

	const attributed = facts.find((f: any) => f?.content_json?.fact_type === "marketing_attributed_revenue_v1");
	assert.ok(attributed, "expected a marketing_attributed_revenue_v1 fact");
	assert.equal(attributed?.content_json?.value_json?.scope, "channel_attributed");
	assert.equal(attributed?.content_json?.value_json?.amount?.amount, 800000);
	assert.match(
		String(attributed?.content_json?.value_json?.typing_reason ?? ""),
		/marketing_attributed_revenue_v1: tokens=\[/,
		"expected deterministic typing_reason for attributed revenue"
	);

	assert.ok(
		!facts.some(
			(f: any) =>
				f?.content_json?.fact_type === "revenue_v1" &&
				f?.content_json?.value_json?.amount?.amount === 800000 &&
				String(f?.content_json?.value_json?.scope ?? "") === "company_total"
		),
		"expected performance-attributed revenue to not be emitted as company_total revenue_v1"
	);
});

test("marketing-attributed revenue typing: numeric-only bullet uses slide context (revenue + conversion) to classify as attributed", async () => {
	const dealId = "00000000-0000-4000-8000-00000000ca24";
	const docId = "doc-context";

	const dpuRows: DpuRow[] = [
		{
			document_id: docId,
			page_index: 8,
			payload: {
				structured: {
					title: "Business Performance",
					bullets: ["Revenue", "$800,000", "Conversion rate improved"],
				},
				source: {
					visual_asset_id: "00000000-0000-4000-8000-00000000c0ac",
					extracted_at: now,
				},
			},
		},
	];

	const pool = mkPool({ dealId, dpuRows });
	const facts = await derivePromotedFactsFromDpuForDeal(pool as any, dealId);

	const attributed = facts.find((f: any) => f?.content_json?.fact_type === "marketing_attributed_revenue_v1");
	assert.ok(attributed, "expected a marketing_attributed_revenue_v1 fact");
	assert.equal(attributed?.content_json?.value_json?.scope, "channel_attributed");
	assert.equal(attributed?.content_json?.value_json?.amount?.amount, 800000);
});
