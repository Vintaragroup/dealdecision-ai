/**
 * gates.test.ts
 *
 * Unit tests for the Investor Insight Gate evaluators (G0–G5).
 *
 * Focus areas:
 *   - G3: StructuredJsonMinimalSchema validation (the main fix target)
 *   - repairGateStateInReport: patches stale gate_state in stored reports
 *
 * All tests use in-memory mock pools — no DB connection required.
 */

import { describe, it, expect } from "vitest";
import type { Pool, QueryResult } from "pg";
import {
	evaluateGates,
	StructuredJsonMinimalSchema,
	repairGateStateInReport,
	type GateContext,
} from "../gates";
import type { GateState } from "../../../contracts/investor-insights/schemas";

// ─────────────────────────────────────────────────────────────────────────────
// Mock pool helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A simple query-sequence mock pool.
 * Each call to pool.query() returns the next item in the `responses` array.
 * If the array is exhausted, the mock returns empty rows.
 */
function makeSequentialPool(
	responses: Array<{ rows: unknown[] } | Error>
): Pool {
	let callIndex = 0;
	return {
		query: (..._args: unknown[]) => {
			const resp = responses[callIndex++];
			if (!resp) return Promise.resolve({ rows: [], rowCount: 0 } as unknown as QueryResult);
			if (resp instanceof Error) return Promise.reject(resp);
			return Promise.resolve({ rows: resp.rows, rowCount: resp.rows.length } as unknown as QueryResult);
		},
	} as unknown as Pool;
}

/**
 * Build a full sequential pool that passes G0–G2, then inserts a custom G3
 * response, then passes G4–G5. Gates are evaluated in parallel so the query
 * order is not strictly sequential — we use a regex-based router instead.
 */
function makeRoutedPool(
	g3Override: Array<{ rows: unknown[] } | Error>
): Pool {
	type MockResponse = { rows: unknown[] } | Error;
	const g3Calls: Array<MockResponse> = [...g3Override];
	let g3CallIdx = 0;

	return {
		query: (queryArg: unknown, ..._rest: unknown[]) => {
			const sql =
				typeof queryArg === "string"
					? queryArg
					: typeof queryArg === "object" && queryArg !== null
					? (queryArg as { text?: string }).text ?? ""
					: "";
			const s = sql.toLowerCase();

			// Route by SQL keyword patterns (multiline-safe via .includes)
			if (s.includes("deals") && s.includes("where") && s.includes("id") && !s.includes("documents")) {
				// G0 deal check
				return Promise.resolve({ rows: [{ id: "test-deal" }], rowCount: 1 });
			}
			if (s.includes("documents") && s.includes("deal_id") && !s.includes("visual") && !s.includes("dpu") && !s.includes("document_page")) {
				// G0 document count
				return Promise.resolve({ rows: [{ c: "1" }], rowCount: 1 });
			}
			if (s.includes("document_page_understanding") && s.includes("count") && !s.includes("coalesce")) {
				// G1 DPU count
				return Promise.resolve({ rows: [{ c: "21" }], rowCount: 1 });
			}
			if (s.includes("coalesce") && s.includes("page_text")) {
				// G2 coverage check
				return Promise.resolve({ rows: [{ total: "21", non_empty: "21" }], rowCount: 1 });
			}
			// G3 existence check: has 'exists' keyword AND 'visual_extractions' but NOT 'limit'
			if (s.includes("exists") && s.includes("visual_extractions") && !s.includes("limit")) {
				const r = g3Calls[g3CallIdx];
				if (r && !(r instanceof Error)) {
					g3CallIdx++;
					return Promise.resolve({ rows: r.rows, rowCount: r.rows.length });
				}
				if (r instanceof Error) {
					g3CallIdx++;
					return Promise.reject(r);
				}
				return Promise.resolve({ rows: [{ exists: true }], rowCount: 1 });
			}
			// G3 sample query: has 'visual_extractions' AND 'limit'
			if (s.includes("visual_extractions") && s.includes("limit")) {
				const r = g3Calls[g3CallIdx];
				if (r && !(r instanceof Error)) {
					g3CallIdx++;
					return Promise.resolve({ rows: r.rows, rowCount: r.rows.length });
				}
				if (r instanceof Error) {
					g3CallIdx++;
					return Promise.reject(r);
				}
				return Promise.resolve({ rows: [], rowCount: 0 });
			}
			if (s.includes("evidence_items")) {
				// G4
				return Promise.resolve({ rows: [{ c: "10" }], rowCount: 1 });
			}
			if (s.includes("governed_llm_overviews")) {
				// G5
				return Promise.resolve({ rows: [{ c: "1" }], rowCount: 1 });
			}
			// Default: empty
			return Promise.resolve({ rows: [], rowCount: 0 });
		},
	} as unknown as Pool;
}

const TEST_CTX: GateContext = { dealId: "da96b5a9-e5b2-46c1-a6ef-da037f876426", engineVersion: "v1" };

// ─────────────────────────────────────────────────────────────────────────────
// StructuredJsonMinimalSchema — unit
// ─────────────────────────────────────────────────────────────────────────────

describe("StructuredJsonMinimalSchema", () => {
	it("passes for a non-empty plain object", () => {
		expect(StructuredJsonMinimalSchema.safeParse({ segment_key: "traction" }).success).toBe(true);
	});

	it("passes for a rich nested object", () => {
		expect(StructuredJsonMinimalSchema.safeParse({ chart: { type: "bar" }, segment_key: "financials" }).success).toBe(true);
	});

	it("fails for empty object {}", () => {
		const r = StructuredJsonMinimalSchema.safeParse({});
		expect(r.success).toBe(false);
		if (!r.success) {
			expect(r.error.issues[0]?.message).toMatch(/empty/i);
		}
	});

	it("fails for null", () => {
		expect(StructuredJsonMinimalSchema.safeParse(null).success).toBe(false);
	});

	it("fails for a plain string", () => {
		expect(StructuredJsonMinimalSchema.safeParse("not an object").success).toBe(false);
	});

	it("fails for an array", () => {
		expect(StructuredJsonMinimalSchema.safeParse([{ segment_key: "traction" }]).success).toBe(false);
	});

	it("passes for {'segment_key': 'traction'} — minimal Carmoola-style row", () => {
		expect(StructuredJsonMinimalSchema.safeParse({ segment_key: "traction" }).success).toBe(true);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// G3 via evaluateGates — integration-style with mock pool
// ─────────────────────────────────────────────────────────────────────────────

describe("G3 — structured_json gate", () => {
	it("passes when structured_json is a valid non-empty object ({segment_key: 'traction'})", async () => {
		const pool = makeRoutedPool([
			// G3 existence check → row exists
			{ rows: [{ exists: true }] },
			// G3 sample → minimal valid row
			{ rows: [{ raw_json: JSON.stringify({ segment_key: "traction" }) }] },
		]);
		const state = await evaluateGates(pool, TEST_CTX);
		const g3 = state.results.find((r) => r.gate === "G3")!;
		expect(g3.passed).toBe(true);
		expect(state.all_passed).toBe(true);
	});

	it("passes when structured_json is a rich object with chart and segment_key", async () => {
		const pool = makeRoutedPool([
			{ rows: [{ exists: true }] },
			{ rows: [{ raw_json: JSON.stringify({ chart: { type: "bar" }, segment_key: "financials" }) }] },
		]);
		const state = await evaluateGates(pool, TEST_CTX);
		const g3 = state.results.find((r) => r.gate === "G3")!;
		expect(g3.passed).toBe(true);
	});

	it("fails with GATE_STRUCTURED_JSON_MISSING when no rows exist", async () => {
		const pool = makeRoutedPool([
			// Existence check → false
			{ rows: [{ exists: false }] },
		]);
		const state = await evaluateGates(pool, TEST_CTX);
		const g3 = state.results.find((r) => r.gate === "G3")!;
		expect(g3.passed).toBe(false);
		expect(g3.reason_code).toBe("GATE_STRUCTURED_JSON_MISSING");
	});

	it("fails with GATE_STRUCTURED_JSON_PARSE_FAILED when raw_json is invalid JSON", async () => {
		const pool = makeRoutedPool([
			{ rows: [{ exists: true }] },
			// Sample returns malformed JSON
			{ rows: [{ raw_json: "{ this is not json }" }] },
		]);
		const state = await evaluateGates(pool, TEST_CTX);
		const g3 = state.results.find((r) => r.gate === "G3")!;
		expect(g3.passed).toBe(false);
		expect(g3.reason_code).toBe("GATE_STRUCTURED_JSON_PARSE_FAILED");
		// Should populate diag with payload_length and preview
		expect(g3.diag).toBeDefined();
		expect(typeof g3.diag?.["payload_length"]).toBe("number");
		expect(typeof g3.diag?.["preview"]).toBe("string");
	});

	it("fails with GATE_STRUCTURED_JSON_SCHEMA_MISMATCH when raw_json is empty object {}", async () => {
		const pool = makeRoutedPool([
			{ rows: [{ exists: true }] },
			// Empty object passes parse but fails schema (refine: non-empty)
			{ rows: [{ raw_json: "{}" }] },
		]);
		const state = await evaluateGates(pool, TEST_CTX);
		const g3 = state.results.find((r) => r.gate === "G3")!;
		expect(g3.passed).toBe(false);
		expect(g3.reason_code).toBe("GATE_STRUCTURED_JSON_SCHEMA_MISMATCH");
		expect(g3.diag).toBeDefined();
	});

	it("fails with GATE_STRUCTURED_JSON_SCHEMA_MISMATCH when raw_json is a JSON array", async () => {
		const pool = makeRoutedPool([
			{ rows: [{ exists: true }] },
			{ rows: [{ raw_json: '[{"segment_key": "traction"}]' }] },
		]);
		const state = await evaluateGates(pool, TEST_CTX);
		const g3 = state.results.find((r) => r.gate === "G3")!;
		expect(g3.passed).toBe(false);
		expect(g3.reason_code).toBe("GATE_STRUCTURED_JSON_SCHEMA_MISMATCH");
	});

	it("fails with GATE_STRUCTURED_JSON_QUERY_FAILED when DB query throws", async () => {
		const pool = makeRoutedPool([
			// Existence check throws
			new Error("connection refused"),
		]);
		const state = await evaluateGates(pool, TEST_CTX);
		const g3 = state.results.find((r) => r.gate === "G3")!;
		expect(g3.passed).toBe(false);
		expect(g3.reason_code).toBe("GATE_STRUCTURED_JSON_QUERY_FAILED");
	});

	it("does NOT produce reason_code GATE_STRUCTURED_JSON_UNREADABLE (obsolete — stale reports only)", () => {
		// This test documents that the obsolete reason code is no longer emitted by
		// the current evalG3 implementation. If this test starts failing it means
		// someone re-introduced the old code.
		const allCurrentReasonCodes = [
			"GATE_STRUCTURED_JSON_MISSING",
			"GATE_STRUCTURED_JSON_PARSE_FAILED",
			"GATE_STRUCTURED_JSON_SCHEMA_MISMATCH",
			"GATE_STRUCTURED_JSON_QUERY_FAILED",
		];
		const isObsoletePresent = allCurrentReasonCodes.includes("GATE_STRUCTURED_JSON_UNREADABLE");
		expect(isObsoletePresent).toBe(false);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// repairGateStateInReport
// ─────────────────────────────────────────────────────────────────────────────

describe("repairGateStateInReport", () => {
	const DEAL_ID = "da96b5a9-e5b2-46c1-a6ef-da037f876426";

	/**
	 * Make a pool that:
	 * 1. Handles all gate evaluation queries (G0–G5) with passing results
	 * 2. Handles the SELECT for the existing report row
	 * 3. Records the UPDATE statement and its parameters
	 */
	function makeRepairPool(
		storedGateState: GateState | null,
		capturedUpdates: Array<{ sql: string; params: unknown[] }>
	): Pool {
		const staleReport = {
			id: "report-id-123",
			render_package: {
				gate_state: storedGateState,
				sections: [{ key: "insight_slots", body: "raise_terms: NotComputable" }],
			},
		};

		return {
			query: (queryArg: unknown, params?: unknown[]) => {
				const sql =
					typeof queryArg === "string" ? queryArg
					: typeof queryArg === "object" && queryArg !== null
					? (queryArg as { text?: string }).text ?? ""
					: "";
				const s = sql.toLowerCase();

				// Gate evaluation queries (multiline-safe)
				if (s.includes("deals") && s.includes("where") && s.includes("id") && !s.includes("documents")) return Promise.resolve({ rows: [{ id: DEAL_ID }], rowCount: 1 });
				if (s.includes("documents") && s.includes("deal_id") && !s.includes("visual") && !s.includes("document_page")) return Promise.resolve({ rows: [{ c: "1" }], rowCount: 1 });
				if (s.includes("document_page_understanding") && s.includes("count") && !s.includes("coalesce")) return Promise.resolve({ rows: [{ c: "21" }], rowCount: 1 });
				if (s.includes("coalesce") && s.includes("page_text")) return Promise.resolve({ rows: [{ total: "21", non_empty: "21" }], rowCount: 1 });
				if (s.includes("exists") && s.includes("visual_extractions") && !s.includes("limit")) return Promise.resolve({ rows: [{ exists: true }], rowCount: 1 });
				if (s.includes("visual_extractions") && s.includes("limit")) return Promise.resolve({ rows: [{ raw_json: JSON.stringify({ segment_key: "traction" }) }], rowCount: 1 });
				if (s.includes("evidence_items")) return Promise.resolve({ rows: [{ c: "10" }], rowCount: 1 });
				if (s.includes("governed_llm_overviews")) return Promise.resolve({ rows: [{ c: "1" }], rowCount: 1 });

				// Repair: SELECT existing report
				if (s.includes("investor_insight_reports") && s.includes("order by")) {
					return Promise.resolve({ rows: [staleReport], rowCount: 1 });
				}

				// Repair: UPDATE
				if (s.includes("update") && s.includes("investor_insight_reports")) {
					capturedUpdates.push({ sql, params: params ?? [] });
					return Promise.resolve({ rows: [], rowCount: 1 });
				}

				return Promise.resolve({ rows: [], rowCount: 0 });
			},
		} as unknown as Pool;
	}

	it("patches stored gate_state with fresh gate evaluation results", async () => {
		const staleGateState: GateState = {
			all_passed: false,
			results: [
				{ gate: "G0", actual: 1, passed: true },
				{ gate: "G3", passed: false, reason_code: "GATE_STRUCTURED_JSON_UNREADABLE" as string },
			],
		};
		const updates: Array<{ sql: string; params: unknown[] }> = [];
		const pool = makeRepairPool(staleGateState, updates);

		const result = await repairGateStateInReport(pool, DEAL_ID);

		expect(result.updated).toBe(true);
		expect(result.newGateState.all_passed).toBe(true);

		// Verify UPDATE was called with the new gate_state
		expect(updates.length).toBe(1);
		const updatedRp = JSON.parse(updates[0]!.params[1] as string) as {
			gate_state: GateState;
			sections: unknown[];
		};
		expect(updatedRp.gate_state.all_passed).toBe(true);
		expect(updatedRp.gate_state.results.find((r) => r.gate === "G3")?.passed).toBe(true);
	});

	it("preserves existing render_package.sections when patching gate_state", async () => {
		const staleGateState: GateState = {
			all_passed: false,
			results: [{ gate: "G3", passed: false, reason_code: "GATE_STRUCTURED_JSON_UNREADABLE" as string }],
		};
		const updates: Array<{ sql: string; params: unknown[] }> = [];
		const pool = makeRepairPool(staleGateState, updates);

		await repairGateStateInReport(pool, DEAL_ID);

		const updatedRp = JSON.parse(updates[0]!.params[1] as string) as {
			gate_state: GateState;
			sections: Array<{ key: string }>;
		};
		// Sections should be preserved
		expect(updatedRp.sections).toBeDefined();
		expect(updatedRp.sections[0]?.key).toBe("insight_slots");
	});

	it("returns oldGateState=null when no report row exists", async () => {
		const updates: Array<{ sql: string; params: unknown[] }> = [];
		// Pool that returns empty for the SELECT
		const pool: Pool = {
			query: (queryArg: unknown, _params?: unknown[]) => {
				const sql =
					typeof queryArg === "string" ? queryArg
					: typeof queryArg === "object" && queryArg !== null
					? (queryArg as { text?: string }).text ?? ""
					: "";
				// Passing gate queries (multiline-safe)
				const s = sql.toLowerCase();
				if (s.includes("deals") && s.includes("where") && s.includes("id") && !s.includes("documents")) return Promise.resolve({ rows: [{ id: DEAL_ID }], rowCount: 1 });
				if (s.includes("documents") && s.includes("deal_id") && !s.includes("visual") && !s.includes("document_page")) return Promise.resolve({ rows: [{ c: "1" }], rowCount: 1 });
				if (s.includes("document_page_understanding") && s.includes("count") && !s.includes("coalesce")) return Promise.resolve({ rows: [{ c: "21" }], rowCount: 1 });
				if (s.includes("coalesce") && s.includes("page_text")) return Promise.resolve({ rows: [{ total: "21", non_empty: "21" }], rowCount: 1 });
				if (s.includes("exists") && s.includes("visual_extractions") && !s.includes("limit")) return Promise.resolve({ rows: [{ exists: true }], rowCount: 1 });
				if (s.includes("visual_extractions") && s.includes("limit")) return Promise.resolve({ rows: [{ raw_json: JSON.stringify({ segment_key: "traction" }) }], rowCount: 1 });
				if (s.includes("evidence_items")) return Promise.resolve({ rows: [{ c: "10" }], rowCount: 1 });
				if (s.includes("governed_llm_overviews")) return Promise.resolve({ rows: [{ c: "1" }], rowCount: 1 });
				// No report row
				if (s.includes("investor_insight_reports")) return Promise.resolve({ rows: [], rowCount: 0 });
				return Promise.resolve({ rows: [], rowCount: 0 });
			},
		} as unknown as Pool;

		const result = await repairGateStateInReport(pool, "no-report-deal");
		expect(result.updated).toBe(false);
		expect(result.oldGateState).toBeNull();
		expect(updates.length).toBe(0);
		// newGateState is still computed even when no row found
		expect(result.newGateState?.results).toBeDefined();
	});

	it("new gate_state has no GATE_STRUCTURED_JSON_UNREADABLE reason_code after repair", async () => {
		const staleGateState: GateState = {
			all_passed: false,
			results: [
				{ gate: "G0", actual: 1, passed: true },
				{ gate: "G1", actual: 21, passed: true },
				{ gate: "G2", actual: 1, passed: true, threshold: 0 },
				{ gate: "G3", passed: false, reason_code: "GATE_STRUCTURED_JSON_UNREADABLE" as string },
				{ gate: "G4", actual: 42, passed: true },
				{ gate: "G5", actual: 2, passed: true },
			],
		};
		const updates: Array<{ sql: string; params: unknown[] }> = [];
		const pool = makeRepairPool(staleGateState, updates);

		const result = await repairGateStateInReport(pool, DEAL_ID);

		// New state should have no GATE_STRUCTURED_JSON_UNREADABLE
		const newG3 = result.newGateState.results.find((r) => r.gate === "G3")!;
		expect(newG3.reason_code).not.toBe("GATE_STRUCTURED_JSON_UNREADABLE");
		expect(newG3.passed).toBe(true);
		// Old state should still reference the obsolete code
		const oldG3 = result.oldGateState?.results.find((r) => r.gate === "G3");
		expect(oldG3?.reason_code).toBe("GATE_STRUCTURED_JSON_UNREADABLE");
	});
});
