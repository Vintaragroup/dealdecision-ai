import { test } from "node:test";
import assert from "node:assert/strict";

// Worker tests run with `type: commonjs` + `ts-node/register`.
// Use require() to avoid TS/ESM interop issues.
const { buildPhase1DealOverviewV2 } = require("./phase1/dealOverviewV2");

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

	assert.ok(out.product_solution);
	assert.match(String(out.product_solution), /3ICE\s+is\s+a\s+'new\s+media'\s+company/i);
	assert.match(String(out.product_solution), /3-on-3\s+professional\s+ice\s+hockey\s+league/i);
	assert.doesNotMatch(String(out.product_solution), /best\s+part\s+of\s+hockey/i);

	assert.ok(out.raise);
	assert.match(String(out.raise), /approximately\s*\$?\s*10\s*m/i);
	assert.equal(out.deal_type, "startup_raise");
});
