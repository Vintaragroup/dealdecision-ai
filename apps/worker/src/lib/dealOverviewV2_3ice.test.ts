import { expect, test } from "vitest";

import { buildPhase1DealOverviewV2 } from "./phase1/dealOverviewV2";

test("3ICE regression: prefer explicit definition over cover tagline", () => {
	const docs: any[] = [
		{
			document_id: "doc-3ice",
			title: "PD - 3ICE",
			type: "pitch_deck",
			full_text: "",
			full_content: {
				pages: [
					{ text: "3ICE\nTHE BEST PART OF HOCKEY" },
					{ text: "3ICE is a 'new media' company and the first ever 3-on-3 professional ice hockey league." },
					{ text: "We are raising approximately $10M" },
				],
			},
		},
	];

	const out = buildPhase1DealOverviewV2({ documents: docs, nowIso: "2025-01-01T00:00:00.000Z" });

	expect(out.product_solution).toBeTruthy();
	expect(String(out.product_solution)).toMatch(/3ICE\s+is\s+a\s+'new\s+media'\s+company/i);
	expect(String(out.product_solution)).toMatch(/3-on-3\s+professional\s+ice\s+hockey\s+league/i);
	expect(String(out.product_solution)).not.toMatch(/best\s+part\s+of\s+hockey/i);

	expect(out.raise).toBeTruthy();
	expect(String(out.raise)).toMatch(/approximately\s*\$?\s*10\s*m/i);
	expect(out.deal_type).toEqual("startup_raise");
});
