import assert from "node:assert/strict";

import { buildNarrationPrompt } from "../build-narration-prompt";
import { buildOverviewPrompt } from "../build-overview-prompt";

const extractCatalogFromNarrationPrompt = (user: string): any[] => {
	const marker = "CITATION_CATALOG_JSON (allowlist; choose citations ONLY from this list):\n";
	const idx = user.indexOf(marker);
	assert.ok(idx >= 0, "missing CITATION_CATALOG_JSON marker");
	const json = user.slice(idx + marker.length).trim();
	return JSON.parse(json);
};

const extractCatalogFromOverviewPrompt = (user: string): any[] => {
	const marker = "CITATION_CATALOG_JSON (allowlist; choose citations ONLY from this list):\n";
	const idx = user.indexOf(marker);
	assert.ok(idx >= 0, "missing CITATION_CATALOG_JSON marker");
	const tail = user.slice(idx + marker.length);
	const json = tail.split("\n\n")[0].trim();
	return JSON.parse(json);
};

describe("citation catalog construction (D2)", () => {
	it("includes promoted_facts source_path page + evidence_id", () => {
		const excerpt = {
			structured_summary: { kpis: {} },
			deal_summary_v1: null,
			score_explanation: { understanding_v1: null, component_evidence_ids: {} },
			promoted_facts: [
				{ fact_type: "revenue_v1", evidence_id: "ev_123", source_path: "doc:abc:page:12" },
			],
			evidence_catalog: [{ page: 3, slide_title: "Financials" }],
		} as const;

		const narr = buildNarrationPrompt({ excerpt });
		const narrCatalog = extractCatalogFromNarrationPrompt(narr.user);
		assert.ok(Array.isArray(narrCatalog));
		assert.ok(
			narrCatalog.some((c: any) => c?.page === 12 && c?.evidence_id === "ev_123"),
			"expected promoted_facts citation (page 12 + ev_123)",
		);
		assert.ok(
			narrCatalog.some((c: any) => c?.page === 3 && c?.slide_title === "Financials"),
			"expected evidence_catalog direct page object (page 3)",
		);
	});

	it("is stable for identical excerpt inputs", () => {
		const excerpt = {
			structured_summary: {
				kpis: {
					revenue: {
						value: { raw: "$1M" },
						sources: [{ page: 7, slide_title: "Revenue" }],
					},
				},
			},
			deal_summary_v1: { one_liner: "One liner.", sources: [{ page: 2 }] },
			promoted_facts: [{ evidence_id: "ev_1", source_path: "doc:z:page:2" }],
			score_explanation: {
				understanding_v1: { diligence_open_items: [{ text: "Need CAC", evidence_ids: ["ev_2"] }] },
				component_evidence_ids: { financial_health: ["ev_3"] },
			},
		} as const;

		const p1 = buildNarrationPrompt({ excerpt });
		const p2 = buildNarrationPrompt({ excerpt });
		assert.equal(JSON.stringify(extractCatalogFromNarrationPrompt(p1.user)), JSON.stringify(extractCatalogFromNarrationPrompt(p2.user)));

		const o1 = buildOverviewPrompt({ reportExcerpt: excerpt });
		const o2 = buildOverviewPrompt({ reportExcerpt: excerpt });
		assert.equal(JSON.stringify(extractCatalogFromOverviewPrompt(o1.user)), JSON.stringify(extractCatalogFromOverviewPrompt(o2.user)));
	});
});
