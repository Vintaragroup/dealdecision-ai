/**
 * Evidence split fallback tests — R1/D2 fix (feature/evidence-source-of-truth-fix)
 *
 * Verifies that loadUpstreamSnapshot and loadCoverageSnapshot correctly resolve
 * evidence counts from the canonical `evidence_items` table and fall back to the
 * legacy `evidence` table when the canonical table has no rows for the deal.
 *
 * Cases covered:
 *   Case 1 — Canonical-only:          evidence_items has rows; evidence source = 'canonical'.
 *   Case 2 — Legacy-only:             evidence_items empty; legacy evidence used; source = 'legacy_fallback'.
 *   Case 3 — Both present:            evidence_items wins; legacy evidence not queried.
 *   Case 4 — Neither present:         both tables return 0; source = 'missing'.
 *   Case 5 — Legacy fallback query fails: error in legacy query; source = 'missing', no throw.
 */

import { describe, it, expect } from "vitest";
import { loadUpstreamSnapshot, loadCoverageSnapshot } from "../stages/stage-0-load-inputs";

// ─── Pool factory helpers ─────────────────────────────────────────────────────

/** Build a mock pool that routes SQL queries based on table name substrings. */
function makePool(opts: {
	evidenceItemsCount: number;
	legacyEvidenceCount: number;
	legacyQueryThrows?: boolean;
}): any {
	const { evidenceItemsCount, legacyEvidenceCount, legacyQueryThrows = false } = opts;
	return {
		query: async (sql: string, _params?: unknown[]) => {
			// document_page_understanding counts (check before generic 'documents')
			if (sql.includes("document_page_understanding") && sql.includes("non_empty")) {
				return { rows: [{ total: "5", non_empty: "4" }] };
			}
			if (sql.includes("document_page_understanding") && sql.includes("COUNT")) {
				return { rows: [{ total: "5", non_empty: "4" }] };
			}
			// excel_range bonus pages (also references document_page_understanding)
			if (sql.includes("excel_range")) {
				return { rows: [{ c: "0" }] };
			}
			// visual_assets count (must come before documents check; its SQL JOINs documents)
			if (sql.includes("visual_assets")) {
				return { rows: [{ c: "3" }] };
			}
			// documents count (simple FROM public.documents)
			if (sql.includes("FROM public.documents")) {
				return { rows: [{ c: "2" }] };
			}
			// evidence_items (canonical)
			if (sql.includes("evidence_items")) {
				return { rows: [{ c: String(evidenceItemsCount) }] };
			}
			// legacy evidence (fallback) — must NOT contain 'evidence_items'
			if (sql.includes("FROM public.evidence") && !sql.includes("evidence_items")) {
				if (legacyQueryThrows) throw new Error("legacy evidence query failed");
				return { rows: [{ c: String(legacyEvidenceCount) }] };
			}
			// governed_llm_overviews count
			if (sql.includes("governed_llm_overviews")) {
				return { rows: [{ c: "0" }] };
			}
			// Default: no rows
			return { rows: [] };
		},
	};
}

const DEAL_ID = "11111111-2222-3333-4444-555555555555";

// ─── loadUpstreamSnapshot ─────────────────────────────────────────────────────

describe("loadUpstreamSnapshot — evidence source resolution", () => {
	it("Case 1: canonical-only — evidenceSource = 'canonical', count from evidence_items", async () => {
		const pool = makePool({ evidenceItemsCount: 15, legacyEvidenceCount: 0 });
		const snapshot = await loadUpstreamSnapshot(pool, DEAL_ID);

		expect(snapshot.evidenceCount).toBe(15);
		expect(snapshot.evidenceSource).toBe("canonical");
	});

	it("Case 2: legacy-only — evidenceSource = 'legacy_fallback', count from legacy evidence", async () => {
		const pool = makePool({ evidenceItemsCount: 0, legacyEvidenceCount: 12 });
		const snapshot = await loadUpstreamSnapshot(pool, DEAL_ID);

		expect(snapshot.evidenceCount).toBe(12);
		expect(snapshot.evidenceSource).toBe("legacy_fallback");
	});

	it("Case 3: both present — canonical wins; legacy evidence table not substituted", async () => {
		// evidence_items has 20 rows, legacy has 8 — canonical wins, no fallback needed
		const pool = makePool({ evidenceItemsCount: 20, legacyEvidenceCount: 8 });
		const snapshot = await loadUpstreamSnapshot(pool, DEAL_ID);

		expect(snapshot.evidenceCount).toBe(20);
		expect(snapshot.evidenceSource).toBe("canonical");
	});

	it("Case 4: neither present — evidenceSource = 'missing', evidenceCount = 0", async () => {
		const pool = makePool({ evidenceItemsCount: 0, legacyEvidenceCount: 0 });
		const snapshot = await loadUpstreamSnapshot(pool, DEAL_ID);

		expect(snapshot.evidenceCount).toBe(0);
		expect(snapshot.evidenceSource).toBe("missing");
	});

	it("Case 5: legacy fallback query throws — evidenceSource = 'missing', does not throw", async () => {
		const pool = makePool({ evidenceItemsCount: 0, legacyEvidenceCount: 0, legacyQueryThrows: true });
		const snapshot = await loadUpstreamSnapshot(pool, DEAL_ID);

		// Must not throw; best-effort fallback
		expect(snapshot.evidenceCount).toBe(0);
		expect(snapshot.evidenceSource).toBe("missing");
	});

	it("returns other fields correctly regardless of evidence source", async () => {
		const pool = makePool({ evidenceItemsCount: 5, legacyEvidenceCount: 0 });
		const snapshot = await loadUpstreamSnapshot(pool, DEAL_ID);

		expect(snapshot.dpuCount).toBe(5);
		expect(snapshot.visualAssetCount).toBe(3);
		expect(snapshot.overlayExists).toBe(false);
	});
});

// ─── loadCoverageSnapshot ─────────────────────────────────────────────────────

describe("loadCoverageSnapshot — evidence source resolution", () => {
	it("Case 1: canonical-only — evidenceSource = 'canonical', count from evidence_items", async () => {
		const pool = makePool({ evidenceItemsCount: 18, legacyEvidenceCount: 0 });
		const snapshot = await loadCoverageSnapshot(pool, DEAL_ID);

		expect(snapshot.evidenceCount).toBe(18);
		expect(snapshot.evidenceSource).toBe("canonical");
	});

	it("Case 2: legacy-only — evidenceSource = 'legacy_fallback', count from legacy evidence", async () => {
		const pool = makePool({ evidenceItemsCount: 0, legacyEvidenceCount: 11 });
		const snapshot = await loadCoverageSnapshot(pool, DEAL_ID);

		expect(snapshot.evidenceCount).toBe(11);
		expect(snapshot.evidenceSource).toBe("legacy_fallback");
	});

	it("Case 3: both present — canonical wins", async () => {
		const pool = makePool({ evidenceItemsCount: 25, legacyEvidenceCount: 7 });
		const snapshot = await loadCoverageSnapshot(pool, DEAL_ID);

		expect(snapshot.evidenceCount).toBe(25);
		expect(snapshot.evidenceSource).toBe("canonical");
	});

	it("Case 4: neither present — evidenceSource = 'missing', evidenceCount = 0", async () => {
		const pool = makePool({ evidenceItemsCount: 0, legacyEvidenceCount: 0 });
		const snapshot = await loadCoverageSnapshot(pool, DEAL_ID);

		expect(snapshot.evidenceCount).toBe(0);
		expect(snapshot.evidenceSource).toBe("missing");
	});

	it("Case 5: legacy fallback query throws — evidenceSource = 'missing', no throw", async () => {
		const pool = makePool({ evidenceItemsCount: 0, legacyEvidenceCount: 0, legacyQueryThrows: true });
		const snapshot = await loadCoverageSnapshot(pool, DEAL_ID);

		expect(snapshot.evidenceCount).toBe(0);
		expect(snapshot.evidenceSource).toBe("missing");
	});

	it("other coverage fields are unaffected by evidence source resolution", async () => {
		const pool = makePool({ evidenceItemsCount: 10, legacyEvidenceCount: 0 });
		const snapshot = await loadCoverageSnapshot(pool, DEAL_ID);

		expect(snapshot.docsCount).toBe(2);
		expect(snapshot.dpuPageCount).toBe(5);
		expect(snapshot.dpuNonemptyPages).toBe(4);
		expect(snapshot.xlsxBonusPages).toBe(0);
		expect(snapshot.visualsCount).toBe(3);
	});
});

// ─── Evidence gate E3 — end-to-end with legacy fallback ──────────────────────

describe("Evidence gate E3 — legacy fallback preserves gate passage", () => {
	it("E3 passes when count comes from legacy fallback (>= threshold)", async () => {
		const { computeEvidenceGateV1 } = await import("../evidence-gate-v1");

		// Simulate: evidence_items empty, legacy evidence provides 12 rows.
		const pool = makePool({ evidenceItemsCount: 0, legacyEvidenceCount: 12 });
		const snapshot = await loadCoverageSnapshot(pool, DEAL_ID);

		const gate = computeEvidenceGateV1({
			docs_count: snapshot.docsCount,
			expected_pages_total: snapshot.dpuPageCount,
			dpu_nonempty_pages: snapshot.dpuNonemptyPages,
			evidence_count: snapshot.evidenceCount,
		});

		// E3 requires >= 10; fallback gives us 12 → should pass.
		const e3 = gate.results.find((r) => r.gate === "E3");
		expect(e3?.passed).toBe(true);
		expect(gate.blocking_reason).not.toBe("EVIDENCE_GATE_LOW_EVIDENCE");
		expect(snapshot.evidenceSource).toBe("legacy_fallback");
	});

	it("E3 fails with EVIDENCE_GATE_LOW_EVIDENCE when neither table has enough rows", async () => {
		const { computeEvidenceGateV1 } = await import("../evidence-gate-v1");

		// Simulate: both tables return 0.
		const pool = makePool({ evidenceItemsCount: 0, legacyEvidenceCount: 0 });
		const snapshot = await loadCoverageSnapshot(pool, DEAL_ID);

		const gate = computeEvidenceGateV1({
			docs_count: snapshot.docsCount,
			expected_pages_total: snapshot.dpuPageCount,
			dpu_nonempty_pages: snapshot.dpuNonemptyPages,
			evidence_count: snapshot.evidenceCount,
		});

		const e3 = gate.results.find((r) => r.gate === "E3");
		expect(e3?.passed).toBe(false);
		expect(e3?.reason_code).toBe("EVIDENCE_GATE_LOW_EVIDENCE");
		expect(snapshot.evidenceSource).toBe("missing");
	});

	it("E3 passes when canonical evidence is sufficient (>= threshold)", async () => {
		const { computeEvidenceGateV1 } = await import("../evidence-gate-v1");

		const pool = makePool({ evidenceItemsCount: 15, legacyEvidenceCount: 0 });
		const snapshot = await loadCoverageSnapshot(pool, DEAL_ID);

		const gate = computeEvidenceGateV1({
			docs_count: snapshot.docsCount,
			expected_pages_total: snapshot.dpuPageCount,
			dpu_nonempty_pages: snapshot.dpuNonemptyPages,
			evidence_count: snapshot.evidenceCount,
		});

		const e3 = gate.results.find((r) => r.gate === "E3");
		expect(e3?.passed).toBe(true);
		expect(snapshot.evidenceSource).toBe("canonical");
	});
});
