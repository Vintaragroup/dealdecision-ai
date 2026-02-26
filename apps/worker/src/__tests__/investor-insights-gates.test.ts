/**
 * Tests for Investor Insights Gate Evaluators (G3 focus).
 *
 * Coverage:
 *   G3 – Structured artifact present (visual_extractions.structured_json)
 *     - Passes for bare stub {"segment_key": "traction"} (Carmoola real-world regression)
 *     - Passes for full OCR object {"table": {...}, "segment_key": "product"}
 *     - Fails SCHEMA_MISMATCH for empty object {} (with diag)
 *     - Fails PARSE_FAILED for malformed JSON (with diag)
 *     - Fails MISSING when no rows exist
 *
 * NOTE: evalG3 is not exported directly; we unit-test through evaluateGates()
 * which calls all gates in sequence.  We stub G0–G2 and G4–G5 returning "pass"
 * so that G3 is the only variable under test.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a minimal Pool mock for G3 tests.
 * @param existsRow   - whether EXISTS query returns true
 * @param rawJson     - JSON string returned by the LIMIT 1 sample query
 */
function makeG3Pool(existsRow: boolean, rawJson: string | null) {
	return {
		query: vi.fn(async (sql: string) => {
			// G0: deal existence
			if (sql.includes("FROM public.deals")) return { rows: [{ id: "deal-1" }] };
			// G0: documents count
			if (sql.includes("FROM public.documents")) return { rows: [{ c: "2" }] };
			// G1: DPU count
			if (sql.includes("FROM public.document_page_understanding") && sql.includes("COUNT")) {
				return { rows: [{ c: "5" }] };
			}
			// G2: DPU coverage
			if (
				sql.includes("FROM public.document_page_understanding") &&
				sql.includes("non_empty")
			) {
				return { rows: [{ total: "5", non_empty: "4" }] };
			}
			// G3: EXISTS check
			if (sql.includes("EXISTS") && sql.includes("visual_extractions")) {
				return { rows: [{ exists: existsRow }] };
			}
			// G3: sample row
			if (sql.includes("LIMIT 1") && sql.includes("visual_extractions")) {
				return { rows: rawJson !== null ? [{ raw_json: rawJson }] : [] };
			}
			// G4: evidence items count
			if (sql.includes("FROM public.evidence_items")) return { rows: [{ c: "3" }] };
			// G5: fallback pass
			return { rows: [{ c: "1" }] };
		}),
	} as any;
}

// Import gates after environment setup
const { evaluateGates } = await import("../jobs/investor-insights/gates");

// ── G3 tests ─────────────────────────────────────────────────────────────────

describe("Investor Insights – G3 gate (structured_json readability)", () => {
	const DEAL_ID = "61ef36dd-391a-4a4e-b30b-1f5d1f19f91e"; // 3ICE (used as test DEAL_ID)

	it("G3 passes for Carmoola stub row {\"segment_key\": \"traction\"} (non-empty object)", async () => {
		const pool = makeG3Pool(true, JSON.stringify({ segment_key: "traction" }));
		const state = await evaluateGates(pool, { dealId: DEAL_ID, engineVersion: "test" });
		const g3 = state.results.find((r) => r.gate === "G3");
		expect(g3?.passed).toBe(true);
		expect(g3?.reason_code).toBeUndefined();
		// diag must NOT be present on a passing gate
		expect((g3 as any)?.diag).toBeUndefined();
	});

	it("G3 passes for full OCR row {\"table\": {...}, \"segment_key\": \"product\"}", async () => {
		const pool = makeG3Pool(true, JSON.stringify({
			table: { rows: [["Revenue", "$1.2M"]] },
			segment_key: "product",
		}));
		const state = await evaluateGates(pool, { dealId: DEAL_ID, engineVersion: "test" });
		const g3 = state.results.find((r) => r.gate === "G3");
		expect(g3?.passed).toBe(true);
	});

	it("G3 fails SCHEMA_MISMATCH for empty object {} (with diag)", async () => {
		const pool = makeG3Pool(true, "{}");
		const state = await evaluateGates(pool, { dealId: DEAL_ID, engineVersion: "test" });
		const g3 = state.results.find((r) => r.gate === "G3");
		expect(g3?.passed).toBe(false);
		expect(g3?.reason_code).toBe("GATE_STRUCTURED_JSON_SCHEMA_MISMATCH");
		// diag should be present on failure
		const diag = (g3 as any)?.diag as Record<string, unknown> | undefined;
		expect(diag).toBeDefined();
		expect(diag?.payload_length).toBe(2); // "{}" is 2 bytes
		expect(diag?.schema_version).toBe("StructuredJsonMinimalSchema_v1");
		expect(typeof diag?.preview).toBe("string");
	});

	it("G3 fails PARSE_FAILED for malformed JSON (with diag containing preview)", async () => {
		const badJson = "not-valid-json-at-all";
		const pool = makeG3Pool(true, badJson);
		const state = await evaluateGates(pool, { dealId: DEAL_ID, engineVersion: "test" });
		const g3 = state.results.find((r) => r.gate === "G3");
		expect(g3?.passed).toBe(false);
		expect(g3?.reason_code).toBe("GATE_STRUCTURED_JSON_PARSE_FAILED");
		const diag = (g3 as any)?.diag as Record<string, unknown> | undefined;
		expect(diag).toBeDefined();
		expect(diag?.payload_length).toBe(badJson.length);
		expect(diag?.preview).toBe(badJson);
		expect(diag?.schema_version).toBe("StructuredJsonMinimalSchema_v1");
	});

	it("G3 fails MISSING when no visual_extractions rows exist", async () => {
		const pool = makeG3Pool(false, null);
		const state = await evaluateGates(pool, { dealId: DEAL_ID, engineVersion: "test" });
		const g3 = state.results.find((r) => r.gate === "G3");
		expect(g3?.passed).toBe(false);
		expect(g3?.reason_code).toBe("GATE_STRUCTURED_JSON_MISSING");
		expect(g3?.actual).toBe(0);
	});

	it("G3 fails PARSE_FAILED for JSON array [] (not a plain object)", async () => {
		// An array is valid JSON but fails the z.record() schema check — expect SCHEMA_MISMATCH
		const pool = makeG3Pool(true, "[]");
		const state = await evaluateGates(pool, { dealId: DEAL_ID, engineVersion: "test" });
		const g3 = state.results.find((r) => r.gate === "G3");
		expect(g3?.passed).toBe(false);
		// Arrays parse fine but are not plain objects → SCHEMA_MISMATCH
		expect(g3?.reason_code).toBe("GATE_STRUCTURED_JSON_SCHEMA_MISMATCH");
	});

	it("G3 PARSE_FAILED diag.preview is truncated to first 200 chars for very long payloads", async () => {
		const longBadJson = "x".repeat(500);
		const pool = makeG3Pool(true, longBadJson);
		const state = await evaluateGates(pool, { dealId: DEAL_ID, engineVersion: "test" });
		const g3 = state.results.find((r) => r.gate === "G3");
		const diag = (g3 as any)?.diag as Record<string, unknown> | undefined;
		expect(diag?.payload_length).toBe(500);
		expect((diag?.preview as string).length).toBe(200);
	});

	it("all_passed is false when G3 fails", async () => {
		const pool = makeG3Pool(false, null);
		const state = await evaluateGates(pool, { dealId: DEAL_ID, engineVersion: "test" });
		expect(state.all_passed).toBe(false);
	});

	it("all_passed is true when all gates pass (G3 with valid stub row)", async () => {
		const pool = makeG3Pool(true, JSON.stringify({ segment_key: "traction" }));
		const state = await evaluateGates(pool, { dealId: DEAL_ID, engineVersion: "test" });
		expect(state.all_passed).toBe(true);
	});
});
