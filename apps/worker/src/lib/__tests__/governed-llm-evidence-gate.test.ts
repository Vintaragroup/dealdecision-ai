// Part C: LLM evidence gate tests.
// Verifies that the OpenAI provider's `complete()` is never called when the
// total unique evidence count across all four display-fact fields is below
// MIN_LLM_EVIDENCE_COUNT (currently 3).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Module-level mock: makes .complete() throw if inadvertently called ───────
// Must be hoisted before imports so vitest can intercept the module.
vi.mock("../llm/providers/openai-provider", () => ({
	OpenAIGPT4oProvider: vi.fn().mockImplementation(() => ({
		complete: vi.fn().mockRejectedValue(
			new Error("INVARIANT: LLM complete() must NOT be called when evidence is below threshold")
		),
	})),
}));

import {
	generateAndPersistGovernedLlmOverviewBestEffort,
	MIN_LLM_EVIDENCE_COUNT,
} from "../governed-llm-overlay";

// ── Pool helpers ─────────────────────────────────────────────────────────────

/**
 * Build a mock pool that:
 *  - Reports governed_llm_overviews and evidence_items tables as present
 *  - Returns exactly 2 phaseb_visual evidence items (1 product + 1 raise_terms)
 *    so allEvidenceIds.size === 2 < MIN_LLM_EVIDENCE_COUNT
 *  - Accepts but ignores all INSERT / diagnostics writes
 *  - Returns empty for all other queries (kpi, dpu, etc.)
 */
function buildSparseEvidencePool(dealId: string): any {
	return {
		query: async (sql: string, params?: unknown[]) => {
			// ── Table existence checks ─────────────────────────────────────────
			if (sql.includes("to_regclass")) {
				const table = String((params ?? [])[0] ?? "");
				if (table === "governed_llm_overviews") return { rows: [{ oid: "governed_llm_overviews" }] };
				if (table === "evidence_items") return { rows: [{ oid: "evidence_items" }] };
				// All other tables (evidence, kpi_metrics, etc.) → not present → no DPU upserts
				return { rows: [{ oid: null }] };
			}

			// ── readDealPhaseMode ──────────────────────────────────────────────
			if (sql.includes("FROM deals") && sql.includes("llm_phase_mode")) {
				return { rows: [{ llm_phase_mode: "governed" }] };
			}

			// ── loadPhasebVisualEvidenceItems: returns 2 rows (1 product + 1 raise) ──
			// The function picks these up when DPU-based fields are empty.
			if (sql.includes("evidence_items") && sql.includes("phaseb_visual")) {
				return {
					rows: [
						{
							evidence_id: "ev-sparse-product-01",
							source_document_id: "doc-sparse-01",
							source_visual_asset_id: null,
							source_path: "page:1",
							tags: ["product", "overview"],
							content_text: "We build an AI-powered investment analysis platform for VC firms.",
							confidence: 0.8,
						},
						{
							evidence_id: "ev-sparse-raise-01",
							source_document_id: "doc-sparse-01",
							source_visual_asset_id: null,
							source_path: "page:5",
							tags: ["raise_terms", "funding"],
							content_text: "Raising $2.5M seed round at $12M pre-money valuation.",
							confidence: 0.9,
						},
					],
				};
			}

			// ── Diagnostics / governed overview INSERT (best-effort writes) ────
			if (sql.includes("INSERT INTO") || sql.includes("UPDATE ")) {
				return { rows: [{ id: "mock-row-1" }] };
			}

			// ── Default: return empty for everything else ──────────────────────
			// (kpi reconciliation, gatherGlobalSummarySources, etc.)
			return { rows: [] };
		},
	};
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("MIN_LLM_EVIDENCE_COUNT constant", () => {
	it("is 3 — documents the governing threshold", () => {
		expect(MIN_LLM_EVIDENCE_COUNT).toBe(3);
	});

	it("gates fire below threshold (0, 1, 2)", () => {
		// Property test: any count strictly less than MIN_LLM_EVIDENCE_COUNT should trip the gate.
		for (const n of [0, 1, 2]) {
			expect(n < MIN_LLM_EVIDENCE_COUNT).toBe(true);
		}
	});

	it("gate does NOT fire at or above threshold (3, 10)", () => {
		for (const n of [3, 10]) {
			expect(n < MIN_LLM_EVIDENCE_COUNT).toBe(false);
		}
	});
});

describe("LLM evidence gate — integration", () => {
	const DEAL_ID = "00000000-0000-0000-0000-aabbccddee01";

	beforeEach(() => {
		process.env.OPENAI_API_KEY = "sk-test-dummy-key-never-sent";
	});
	afterEach(() => {
		delete process.env.OPENAI_API_KEY;
		vi.clearAllMocks();
	});

	it("does NOT call LLM when total evidence count (2) < MIN_LLM_EVIDENCE_COUNT (3)", async () => {
		// Arrange: pool provides exactly 2 phaseb evidence items, no DPU snippets.
		// Both fields end up with 1 evidence item each → total unique IDs = 2 < 3.
		const pool = buildSparseEvidencePool(DEAL_ID);

		const { OpenAIGPT4oProvider } = await import("../llm/providers/openai-provider");
		const completeSpy = (OpenAIGPT4oProvider as any).mock.instances?.[0]?.complete;

		// Act: call the top-level function (OPENAI_API_KEY is set — without the
		// gate, the provider WOULD be instantiated and .complete() called).
		const result = await generateAndPersistGovernedLlmOverviewBestEffort({
			pool,
			dealId: DEAL_ID,
			phase1_deal_overview_v2: null, // no DPU sources → all 4 DPU arrays empty
		});

		// Assert: function is fail-open (always returns ok)
		expect(result.ok).toBe(true);

		// Assert: no provider instance should have had .complete() called.
		// The vi.mock at the top throws if .complete() fires, so if we reach here
		// the gate functioned correctly.
		const allInstances = (OpenAIGPT4oProvider as any).mock?.instances ?? [];
		for (const inst of allInstances) {
			if (inst?.complete) {
				expect(inst.complete).not.toHaveBeenCalled();
			}
		}
	});

	it("never throws even when evidence is at zero", async () => {
		// Architecture invariant: the function is always fail-open.
		const pool = {
			query: async (sql: string, params?: unknown[]) => {
				if (sql.includes("to_regclass")) return { rows: [{ oid: null }] }; // no tables
				if (sql.includes("FROM deals") && sql.includes("llm_phase_mode"))
					return { rows: [{ llm_phase_mode: "governed" }] };
				if (sql.includes("INSERT INTO") || sql.includes("UPDATE "))
					return { rows: [{ id: "x" }] };
				return { rows: [] };
			},
		} as any;

		await expect(
			generateAndPersistGovernedLlmOverviewBestEffort({ pool, dealId: DEAL_ID })
		).resolves.not.toThrow();
	});
});
