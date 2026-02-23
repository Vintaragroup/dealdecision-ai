/**
 * Regression and guardrail tests for the extract_visuals skip-existing gate.
 *
 * Root cause (fixed): pages whose `visual_assets` row existed but whose
 * `visual_extractions` row was absent (vision was unavailable on the prior
 * run, audit.status="skipped"/"vision_unavailable") were permanently skipped.
 *
 * Guardrails documented here:
 *   1. `isAuditVisionFailure` — robust failure detection (status, reason, health code)
 *   2. `shouldSkipExtractVisualsPage` — decision logic using the above helper
 *   3. Canary log — "EXTRACT_VISUALS_SKIPPED_WITHOUT_VE_ROW" must never lead to a skip
 *   4. E2E pool fixture — simulates the two key DB states end-to-end
 */
import { describe, it, expect, vi } from "vitest";
import { isAuditVisionFailure, shouldSkipExtractVisualsPage } from "../visual-extraction";

// ─────────────────────────────────────────────────────────────────────────────
// 1. isAuditVisionFailure — robust failure detection
// ─────────────────────────────────────────────────────────────────────────────

describe("isAuditVisionFailure — failure signal detection", () => {
	// ── status-string cases ───────────────────────────────────────────────────

	it("detects status=skipped", () => {
		expect(isAuditVisionFailure({ status: "skipped" })).toBe(true);
	});

	it("detects status=failed", () => {
		expect(isAuditVisionFailure({ status: "failed" })).toBe(true);
	});

	it("detects status=vision_unavailable", () => {
		expect(isAuditVisionFailure({ status: "vision_unavailable" })).toBe(true);
	});

	it("does NOT flag status=succeeded", () => {
		expect(isAuditVisionFailure({ status: "succeeded" })).toBe(false);
	});

	it("does NOT flag null status", () => {
		expect(isAuditVisionFailure({ status: null })).toBe(false);
	});

	it("does NOT flag undefined status", () => {
		expect(isAuditVisionFailure({ status: undefined })).toBe(false);
	});

	// ── reason-substring cases ────────────────────────────────────────────────

	it("detects reason containing 'vision_unavailable'", () => {
		expect(isAuditVisionFailure({ status: null, reason: "vision_unavailable" })).toBe(true);
	});

	it("detects reason containing 'vision_unavailable' mid-string", () => {
		expect(isAuditVisionFailure({
			status: null,
			reason: "vision worker returned vision_unavailable at startup",
		})).toBe(true);
	});

	it("detects reason containing 'health_check_failed'", () => {
		expect(isAuditVisionFailure({ status: null, reason: "health_check_failed after 3 retries" })).toBe(true);
	});

	it("reason check is case-insensitive", () => {
		expect(isAuditVisionFailure({ status: null, reason: "HEALTH_CHECK_FAILED" })).toBe(true);
		expect(isAuditVisionFailure({ status: null, reason: "Vision_Unavailable" })).toBe(true);
	});

	it("does NOT flag benign reason string", () => {
		expect(isAuditVisionFailure({ status: null, reason: "ocr_completed_normally" })).toBe(false);
	});

	// ── healthStatus (HTTP code) cases ────────────────────────────────────────

	it("detects healthStatus=400", () => {
		expect(isAuditVisionFailure({ status: null, healthStatus: 400 })).toBe(true);
	});

	it("detects healthStatus=503", () => {
		expect(isAuditVisionFailure({ status: null, healthStatus: 503 })).toBe(true);
	});

	it("does NOT flag healthStatus=200", () => {
		expect(isAuditVisionFailure({ status: null, healthStatus: 200 })).toBe(false);
	});

	it("does NOT flag healthStatus=399", () => {
		expect(isAuditVisionFailure({ status: null, healthStatus: 399 })).toBe(false);
	});

	it("does NOT flag null healthStatus", () => {
		expect(isAuditVisionFailure({ status: null, healthStatus: null })).toBe(false);
	});

	// ── multi-signal: any one is sufficient ───────────────────────────────────

	it("detects failure when only reason signals it (status ok)", () => {
		expect(isAuditVisionFailure({
			status: "succeeded",
			reason: "health_check_failed",
			healthStatus: 200,
		})).toBe(true);
	});

	it("detects failure when only healthStatus signals it (status ok, no reason)", () => {
		expect(isAuditVisionFailure({
			status: "succeeded",
			reason: null,
			healthStatus: 502,
		})).toBe(true);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. shouldSkipExtractVisualsPage — skip decision
// ─────────────────────────────────────────────────────────────────────────────

describe("shouldSkipExtractVisualsPage — skip gate logic", () => {
	// ── must-attempt cases ───────────────────────────────────────────────────

	it("must attempt: audit status=skipped, even if DB row exists", () => {
		expect(shouldSkipExtractVisualsPage({
			docAuditStatus: "skipped",
			hasVisualExtractionRow: true,
		})).toBe(false);
	});

	it("must attempt: audit status=failed, even if DB row exists", () => {
		expect(shouldSkipExtractVisualsPage({
			docAuditStatus: "failed",
			hasVisualExtractionRow: true,
		})).toBe(false);
	});

	it("must attempt: audit status=vision_unavailable, even if DB row exists", () => {
		expect(shouldSkipExtractVisualsPage({
			docAuditStatus: "vision_unavailable",
			hasVisualExtractionRow: true,
		})).toBe(false);
	});

	it("must attempt: audit status=skipped, no DB row", () => {
		expect(shouldSkipExtractVisualsPage({
			docAuditStatus: "skipped",
			hasVisualExtractionRow: false,
		})).toBe(false);
	});

	it("must attempt: audit ok but no visual_extractions row (production bug case)", () => {
		// This was the production bug: visual_assets existed but visual_extractions was empty.
		// Previously the gate queried only visual_assets and skipped, leaving evidence empty.
		expect(shouldSkipExtractVisualsPage({
			docAuditStatus: "succeeded",
			hasVisualExtractionRow: false,
		})).toBe(false);
	});

	it("must attempt: audit status=null, no DB row (brand-new doc)", () => {
		expect(shouldSkipExtractVisualsPage({
			docAuditStatus: null,
			hasVisualExtractionRow: false,
		})).toBe(false);
	});

	it("must attempt: audit status=undefined, no DB row", () => {
		expect(shouldSkipExtractVisualsPage({
			docAuditStatus: undefined,
			hasVisualExtractionRow: false,
		})).toBe(false);
	});

	// ── reason-based failure overrides DB row ─────────────────────────────────

	it("must attempt: reason=vision_unavailable, even if DB row exists", () => {
		expect(shouldSkipExtractVisualsPage({
			docAuditStatus: null,
			docAuditReason: "vision_unavailable",
			hasVisualExtractionRow: true,
		})).toBe(false);
	});

	it("must attempt: reason=health_check_failed, even if DB row exists", () => {
		expect(shouldSkipExtractVisualsPage({
			docAuditStatus: null,
			docAuditReason: "health_check_failed after 3 retries",
			hasVisualExtractionRow: true,
		})).toBe(false);
	});

	// ── healthStatus-based failure overrides DB row ───────────────────────────

	it("must attempt: healthStatus=503, even if DB row exists", () => {
		expect(shouldSkipExtractVisualsPage({
			docAuditStatus: null,
			docAuditHealthStatus: 503,
			hasVisualExtractionRow: true,
		})).toBe(false);
	});

	// ── should-skip cases ─────────────────────────────────────────────────────

	it("should skip: audit ok AND visual_extractions row confirmed", () => {
		expect(shouldSkipExtractVisualsPage({
			docAuditStatus: "succeeded",
			hasVisualExtractionRow: true,
		})).toBe(true);
	});

	it("should skip: audit status=null AND visual_extractions row confirmed", () => {
		expect(shouldSkipExtractVisualsPage({
			docAuditStatus: null,
			hasVisualExtractionRow: true,
		})).toBe(true);
	});

	it("should skip: any non-failure audit status AND DB row confirmed", () => {
		for (const status of ["succeeded_with_warnings", "completed", "partial"]) {
			expect(
				shouldSkipExtractVisualsPage({ docAuditStatus: status, hasVisualExtractionRow: true }),
				`expected skip for audit status="${status}" with DB row`
			).toBe(true);
		}
	});

	// ── no DB row always means must attempt ───────────────────────────────────

	it("no DB row always means must attempt, regardless of audit status", () => {
		for (const status of [null, undefined, "succeeded", "completed", "partial"]) {
			expect(
				shouldSkipExtractVisualsPage({ docAuditStatus: status as any, hasVisualExtractionRow: false }),
				`expected attempt for audit status=${JSON.stringify(status)} with no DB row`
			).toBe(false);
		}
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Canary log guardrail
//    EXTRACT_VISUALS_SKIPPED_WITHOUT_VE_ROW must NEVER lead to a skip decision.
//    We assert that when the query returns has_va=true / has_ve=false,
//    shouldSkipExtractVisualsPage returns false (attempt, not skip).
// ─────────────────────────────────────────────────────────────────────────────

describe("canary: EXTRACT_VISUALS_SKIPPED_WITHOUT_VE_ROW must not cause a skip", () => {
	it("cross-check: has_va=true, has_ve=false → shouldSkip returns false regardless of audit", () => {
		// This is the exact condition that fires the canary log in production.
		// The final gate decision must be false (= attempt), not skip.
		const auditStatuses: Array<string | null | undefined> = [
			"succeeded",
			"completed",
			null,
			undefined,
			"partial",
		];
		for (const docAuditStatus of auditStatuses) {
			const decision = shouldSkipExtractVisualsPage({
				docAuditStatus,
				hasVisualExtractionRow: false, // has_va=true but has_ve=false (canary state)
			});
			expect(decision, `audit=${JSON.stringify(docAuditStatus)}: canary state must not skip`).toBe(false);
		}
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. End-to-end pool fixture
//    Simulates the DB query returning has_va / has_ve flags and asserts the
//    full gate logic: canary log fires when appropriate, skip decision correct.
// ─────────────────────────────────────────────────────────────────────────────

describe("E2E gate fixture — pool query result → skip decision", () => {
	/** Minimal pool mock factory. Returns a single aggregate row with has_va / has_ve. */
	function makePool(has_va: boolean, has_ve: boolean) {
		return {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			query: vi.fn(async (..._args: any[]) => ({ rows: [{ has_va, has_ve }] })),
		};
	}

	/**
	 * Simulate what the gate body does after receiving the pool result.
	 * Mirrors the logic in index.ts without importing the whole monolith.
	 * Returns { skip, canaryFired }.
	 */
	async function runGateLogic(params: {
		docAuditStatus: string | null;
		docAuditReason?: string | null;
		docAuditHealthStatus?: number | null;
		has_va: boolean;
		has_ve: boolean;
	}): Promise<{ skip: boolean; canaryFired: boolean }> {
		const { docAuditStatus, docAuditReason = null, docAuditHealthStatus = null, has_va, has_ve } = params;

		// Fast-path: audit indicates failure → skip gate bypassed entirely
		if (isAuditVisionFailure({ status: docAuditStatus, reason: docAuditReason, healthStatus: docAuditHealthStatus })) {
			return { skip: false, canaryFired: false };
		}

		// Simulate the DB query (extractor-version aware, LEFT JOIN, aggregate row)
		const pool = makePool(has_va, has_ve);
		const result = await pool.query(
			`SELECT
			   (COUNT(va.id) > 0)               AS has_va,
			   (COUNT(ve_row.visual_asset_id) > 0) AS has_ve
			   FROM visual_assets va
			   LEFT JOIN visual_extractions ve_row
			     ON ve_row.visual_asset_id = va.id
			    AND ve_row.extractor_version = $3
			  WHERE va.document_id = $1
			    AND va.page_index = $2
			    AND va.extractor_version = $3`,
			["doc-1", 0, "vision_v1"]
		);
		const row = result.rows[0];
		const hasVisualAssetRow      = row?.has_va === true;
		const hasVisualExtractionRow = row?.has_ve === true;

		// Canary: fires when old-bug state is detected (va row exists, no ve row)
		const canaryFired = hasVisualAssetRow && !hasVisualExtractionRow;

		const skip = shouldSkipExtractVisualsPage({
			docAuditStatus,
			docAuditReason,
			docAuditHealthStatus,
			hasVisualExtractionRow,
		});

		return { skip, canaryFired };
	}

	it("Scenario A: visual_assets exist, audit=skipped, no visual_extractions → must attempt", async () => {
		const { skip, canaryFired } = await runGateLogic({
			docAuditStatus: "skipped",
			has_va: true,
			has_ve: false,
		});
		expect(skip).toBe(false);
		// Audit fast-path bypasses DB entirely — canary query never reached
		expect(canaryFired).toBe(false);
	});

	it("Scenario B: visual_assets exist, audit=vision_unavailable, no visual_extractions → must attempt", async () => {
		const { skip } = await runGateLogic({
			docAuditStatus: "vision_unavailable",
			has_va: true,
			has_ve: false,
		});
		expect(skip).toBe(false);
	});

	it("Scenario C: audit=succeeded, visual_assets exist but NO visual_extractions → canary fires, must attempt", async () => {
		const { skip, canaryFired } = await runGateLogic({
			docAuditStatus: "succeeded",
			has_va: true,
			has_ve: false,
		});
		// This is the production bug signature: old code would have skipped, new code must not.
		expect(skip).toBe(false);
		expect(canaryFired).toBe(true);  // canary log must fire
	});

	it("Scenario D: audit=succeeded, visual_extractions row confirmed → safe to skip", async () => {
		const { skip, canaryFired } = await runGateLogic({
			docAuditStatus: "succeeded",
			has_va: true,
			has_ve: true,
		});
		expect(skip).toBe(true);
		expect(canaryFired).toBe(false);  // no canary — state is correct
	});

	it("Scenario E: audit=null (no prior run), no visual_assets, no visual_extractions → must attempt", async () => {
		const { skip } = await runGateLogic({
			docAuditStatus: null,
			has_va: false,
			has_ve: false,
		});
		expect(skip).toBe(false);
	});

	it("Scenario F: audit=null, visual_extractions confirmed → safe to skip", async () => {
		const { skip, canaryFired } = await runGateLogic({
			docAuditStatus: null,
			has_va: true,
			has_ve: true,
		});
		expect(skip).toBe(true);
		expect(canaryFired).toBe(false);
	});

	it("Scenario G: audit ok but reason=vision_unavailable → must attempt even if DB row exists", async () => {
		const { skip } = await runGateLogic({
			docAuditStatus: "succeeded",
			docAuditReason: "vision_unavailable",
			has_va: true,
			has_ve: true,
		});
		expect(skip).toBe(false);
	});

	it("Scenario H: healthStatus=503, visual_extractions exist → must attempt (health code overrides)", async () => {
		const { skip } = await runGateLogic({
			docAuditStatus: null,
			docAuditHealthStatus: 503,
			has_va: true,
			has_ve: true,
		});
		expect(skip).toBe(false);
	});
});
