/**
 * PR31 — Tests for ocr-auto-rerun-v1
 *
 * Coverage:
 *  1. Pure policy helper: decideMaybeEnqueue — all 7 prompt scenarios + edge cases
 *  2. DB helper: loadLatestReportMetaForAutoRerun — query shape + error handling
 *  3. Integration: maybeEnqueueInvestorInsightsAfterOcrImprovement — enqueue path
 *     + each skip path
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import {
	OCR_AUTO_RERUN_MIN_DELTA,
	OCR_AUTO_RERUN_COOLDOWN_MS,
	decideMaybeEnqueue,
	loadLatestReportMetaForAutoRerun,
	maybeEnqueueInvestorInsightsAfterOcrImprovement,
	type LatestReportMeta,
	type EnqueueHandle,
} from "../../../lib/ocr-auto-rerun-v1";

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const DEAL_ID = "11111111-1111-1111-1111-111111111111";
const THRESHOLD = 0.55;
const NOW_MS = new Date("2026-03-06T12:00:00.000Z").getTime();

/** A deterministic_only report that is eligible for re-run. */
function makeBlockedReport(overrides?: Partial<LatestReportMeta>): LatestReportMeta {
	return {
		status: "deterministic_only",
		evidenceGateBlockingReason: "EVIDENCE_GATE_LOW_COVERAGE",
		updatedAt: "2026-03-06T10:00:00.000Z",
		...overrides,
	};
}

// ─── decideMaybeEnqueue — pure unit tests ────────────────────────────────────

describe("decideMaybeEnqueue", () => {
	// ── Prompt scenario 1: large coverage jump ────────────────────────────────
	it("scenario 1: 0.45 → 0.61 with deterministic_only report → enqueue", () => {
		const result = decideMaybeEnqueue({
			coverageBefore: 0.45,
			coverageAfter: 0.61,
			threshold: THRESHOLD,
			latestReport: makeBlockedReport(),
			hasActiveJob: false,
			lastAutoRerunAt: null,
			nowMs: NOW_MS,
		});

		expect(result.shouldEnqueue).toBe(true);
		if (result.shouldEnqueue) {
			expect(result.crossedThreshold).toBe(true); // 0.45 < 0.55 && 0.61 >= 0.55
			expect(result.delta).toBeCloseTo(0.16);
			expect(result.triggerReason).toBe("coverage_crossed_threshold");
		}
	});

	// ── Prompt scenario 2: tiny delta ────────────────────────────────────────
	it("scenario 2: 0.45 → 0.47 (delta 0.02 < 0.05) → no_material_improvement", () => {
		const result = decideMaybeEnqueue({
			coverageBefore: 0.45,
			coverageAfter: 0.47,
			threshold: THRESHOLD,
			latestReport: makeBlockedReport(),
			hasActiveJob: false,
			lastAutoRerunAt: null,
			nowMs: NOW_MS,
		});

		expect(result.shouldEnqueue).toBe(false);
		if (!result.shouldEnqueue) {
			expect(result.skipReason).toBe("no_material_improvement");
		}
	});

	// ── Prompt scenario 3: small delta, threshold not crossed ─────────────────
	it("scenario 3: 0.52 → 0.54 (delta 0.02, threshold not crossed) → no_material_improvement", () => {
		const result = decideMaybeEnqueue({
			coverageBefore: 0.52,
			coverageAfter: 0.54,
			threshold: THRESHOLD,
			latestReport: makeBlockedReport(),
			hasActiveJob: false,
			lastAutoRerunAt: null,
			nowMs: NOW_MS,
		});

		expect(result.shouldEnqueue).toBe(false);
		if (!result.shouldEnqueue) {
			expect(result.skipReason).toBe("no_material_improvement");
		}
	});

	// ── Prompt scenario 4: threshold crossed ─────────────────────────────────
	it("scenario 4: 0.52 → 0.57 (crossed 0.55 threshold) → enqueue", () => {
		const result = decideMaybeEnqueue({
			coverageBefore: 0.52,
			coverageAfter: 0.57,
			threshold: THRESHOLD,
			latestReport: makeBlockedReport(),
			hasActiveJob: false,
			lastAutoRerunAt: null,
			nowMs: NOW_MS,
		});

		expect(result.shouldEnqueue).toBe(true);
		if (result.shouldEnqueue) {
			expect(result.crossedThreshold).toBe(true);
			expect(result.triggerReason).toBe("coverage_crossed_threshold");
		}
	});

	// ── Prompt scenario 5: active job ────────────────────────────────────────
	it("scenario 5: active investor_insights job for this deal → already_running", () => {
		const result = decideMaybeEnqueue({
			coverageBefore: 0.45,
			coverageAfter: 0.61,
			threshold: THRESHOLD,
			latestReport: makeBlockedReport(),
			hasActiveJob: true,
			lastAutoRerunAt: null,
			nowMs: NOW_MS,
		});

		expect(result.shouldEnqueue).toBe(false);
		if (!result.shouldEnqueue) {
			expect(result.skipReason).toBe("already_running");
		}
	});

	// ── Prompt scenario 6: cooldown active ───────────────────────────────────
	it("scenario 6: cooldown active (last rerun 30 min ago) → cooldown_active", () => {
		const thirtyMinAgo = new Date(NOW_MS - 30 * 60 * 1000).toISOString();

		const result = decideMaybeEnqueue({
			coverageBefore: 0.45,
			coverageAfter: 0.61,
			threshold: THRESHOLD,
			latestReport: makeBlockedReport(),
			hasActiveJob: false,
			lastAutoRerunAt: thirtyMinAgo,
			nowMs: NOW_MS,
		});

		expect(result.shouldEnqueue).toBe(false);
		if (!result.shouldEnqueue) {
			expect(result.skipReason).toBe("cooldown_active");
		}
	});

	// ── Prompt scenario 7: report already succeeded ───────────────────────────
	it("scenario 7: latest report status=complete → report_succeeded", () => {
		const result = decideMaybeEnqueue({
			coverageBefore: 0.45,
			coverageAfter: 0.61,
			threshold: THRESHOLD,
			latestReport: makeBlockedReport({ status: "complete", evidenceGateBlockingReason: null }),
			hasActiveJob: false,
			lastAutoRerunAt: null,
			nowMs: NOW_MS,
		});

		expect(result.shouldEnqueue).toBe(false);
		if (!result.shouldEnqueue) {
			expect(result.skipReason).toBe("report_succeeded");
		}
	});

	// ── Edge: no existing report ──────────────────────────────────────────────
	it("no existing report (latestReport=null) → no_blocked_report", () => {
		const result = decideMaybeEnqueue({
			coverageBefore: 0.45,
			coverageAfter: 0.61,
			threshold: THRESHOLD,
			latestReport: null,
			hasActiveJob: false,
			lastAutoRerunAt: null,
			nowMs: NOW_MS,
		});

		expect(result.shouldEnqueue).toBe(false);
		if (!result.shouldEnqueue) {
			expect(result.skipReason).toBe("no_blocked_report");
		}
	});

	// ── Edge: delta exactly at minimum threshold ───────────────────────────────
	it(`delta exactly = OCR_AUTO_RERUN_MIN_DELTA (${OCR_AUTO_RERUN_MIN_DELTA}) → enqueue (Rule A)`, () => {
		const result = decideMaybeEnqueue({
			coverageBefore: 0.50,
			coverageAfter: 0.50 + OCR_AUTO_RERUN_MIN_DELTA,
			threshold: THRESHOLD,
			latestReport: makeBlockedReport(),
			hasActiveJob: false,
			lastAutoRerunAt: null,
			nowMs: NOW_MS,
		});

		expect(result.shouldEnqueue).toBe(true);
		if (result.shouldEnqueue) {
			// 0.50 → 0.55: delta = 0.05 AND crossed threshold (0.55 >= 0.55)
			expect(result.crossedThreshold).toBe(true);
		}
	});

	// ── Edge: delta > minimum but threshold not crossed ───────────────────────
	it("delta 0.06 but threshold NOT crossed (both sides above 0.55) → enqueue (delta_sufficient)", () => {
		const result = decideMaybeEnqueue({
			coverageBefore: 0.60,
			coverageAfter: 0.66,
			threshold: THRESHOLD,
			latestReport: makeBlockedReport(),
			hasActiveJob: false,
			lastAutoRerunAt: null,
			nowMs: NOW_MS,
		});

		expect(result.shouldEnqueue).toBe(true);
		if (result.shouldEnqueue) {
			// Both sides already above threshold → crossedThreshold = false
			expect(result.crossedThreshold).toBe(false);
			expect(result.triggerReason).toBe("coverage_delta_sufficient");
		}
	});

	// ── Edge: cooldown just expired ───────────────────────────────────────────
	it("cooldown just expired (last rerun exactly at cooldown boundary) → enqueue", () => {
		const justAfterCooldown = new Date(NOW_MS - OCR_AUTO_RERUN_COOLDOWN_MS - 1).toISOString();

		const result = decideMaybeEnqueue({
			coverageBefore: 0.45,
			coverageAfter: 0.61,
			threshold: THRESHOLD,
			latestReport: makeBlockedReport(),
			hasActiveJob: false,
			lastAutoRerunAt: justAfterCooldown,
			nowMs: NOW_MS,
		});

		expect(result.shouldEnqueue).toBe(true);
	});

	// ── Edge: report blocked but status is not deterministic_only ─────────────
	it("report with blocking_reason but unknown status → no_blocked_report", () => {
		const result = decideMaybeEnqueue({
			coverageBefore: 0.45,
			coverageAfter: 0.61,
			threshold: THRESHOLD,
			latestReport: { status: "failed", evidenceGateBlockingReason: null, updatedAt: "2026-03-06T10:00:00Z" },
			hasActiveJob: false,
			lastAutoRerunAt: null,
			nowMs: NOW_MS,
		});

		expect(result.shouldEnqueue).toBe(false);
		if (!result.shouldEnqueue) {
			expect(result.skipReason).toBe("no_blocked_report");
		}
	});

	// ── Edge: coverage did not improve (after <= before) ─────────────────────
	it("coverage did not improve (0.50 → 0.50) → no_material_improvement", () => {
		const result = decideMaybeEnqueue({
			coverageBefore: 0.50,
			coverageAfter: 0.50,
			threshold: THRESHOLD,
			latestReport: makeBlockedReport(),
			hasActiveJob: false,
			lastAutoRerunAt: null,
			nowMs: NOW_MS,
		});

		expect(result.shouldEnqueue).toBe(false);
		if (!result.shouldEnqueue) {
			expect(result.skipReason).toBe("no_material_improvement");
		}
	});

	// ── Edge: active-job guard takes priority over cooldown ───────────────────
	it("active job + cooldown active → already_running (active job guard fires first)", () => {
		const thirtyMinAgo = new Date(NOW_MS - 30 * 60 * 1000).toISOString();

		const result = decideMaybeEnqueue({
			coverageBefore: 0.45,
			coverageAfter: 0.61,
			threshold: THRESHOLD,
			latestReport: makeBlockedReport(),
			hasActiveJob: true,
			lastAutoRerunAt: thirtyMinAgo,
			nowMs: NOW_MS,
		});

		expect(result.shouldEnqueue).toBe(false);
		if (!result.shouldEnqueue) {
			// already_running should be checked before cooldown_active
			expect(result.skipReason).toBe("already_running");
		}
	});
});

// ─── loadLatestReportMetaForAutoRerun ────────────────────────────────────────

describe("loadLatestReportMetaForAutoRerun", () => {
	it("returns reportMeta and null lastAutoRerunAt when no auto-rerun events in audit_log", async () => {
		const pool = {
			query: vi.fn().mockResolvedValue({
				rows: [
					{
						status: "deterministic_only",
						evidence_gate_blocking_reason: "EVIDENCE_GATE_LOW_COVERAGE",
						updated_at: "2026-03-06T10:00:00.000000",
						last_auto_rerun_at: null,
					},
				],
			}),
		} as unknown as import("pg").Pool;

		const result = await loadLatestReportMetaForAutoRerun(pool, DEAL_ID);

		expect(result.reportMeta).not.toBeNull();
		expect(result.reportMeta?.status).toBe("deterministic_only");
		expect(result.reportMeta?.evidenceGateBlockingReason).toBe("EVIDENCE_GATE_LOW_COVERAGE");
		expect(result.lastAutoRerunAt).toBeNull();
	});

	it("returns lastAutoRerunAt when a previous auto-rerun event is present", async () => {
		const rerunAt = "2026-03-06T09:30:00.000Z";
		const pool = {
			query: vi.fn().mockResolvedValue({
				rows: [
					{
						status: "deterministic_only",
						evidence_gate_blocking_reason: "EVIDENCE_GATE_LOW_COVERAGE",
						updated_at: "2026-03-06T10:00:00.000000",
						last_auto_rerun_at: rerunAt,
					},
				],
			}),
		} as unknown as import("pg").Pool;

		const result = await loadLatestReportMetaForAutoRerun(pool, DEAL_ID);

		expect(result.lastAutoRerunAt).toBe(rerunAt);
	});

	it("returns null for both fields when no row exists", async () => {
		const pool = {
			query: vi.fn().mockResolvedValue({ rows: [] }),
		} as unknown as import("pg").Pool;

		const result = await loadLatestReportMetaForAutoRerun(pool, DEAL_ID);

		expect(result.reportMeta).toBeNull();
		expect(result.lastAutoRerunAt).toBeNull();
	});

	it("returns null for both fields when DB throws (fail-open)", async () => {
		const pool = {
			query: vi.fn().mockRejectedValue(new Error("DB connection lost")),
		} as unknown as import("pg").Pool;

		const result = await loadLatestReportMetaForAutoRerun(pool, DEAL_ID);

		expect(result.reportMeta).toBeNull();
		expect(result.lastAutoRerunAt).toBeNull();
	});

	it("returns null status-based reportMeta when render_package status is null in DB", async () => {
		const pool = {
			query: vi.fn().mockResolvedValue({
				rows: [
					{
						status: null,
						evidence_gate_blocking_reason: null,
						updated_at: "2026-03-06T10:00:00.000000",
						last_auto_rerun_at: null,
					},
				],
			}),
		} as unknown as import("pg").Pool;

		const result = await loadLatestReportMetaForAutoRerun(pool, DEAL_ID);

		// null status → reportMeta = null (no policy decision possible)
		expect(result.reportMeta).toBeNull();
	});
});

// ─── maybeEnqueueInvestorInsightsAfterOcrImprovement — integration ───────────

describe("maybeEnqueueInvestorInsightsAfterOcrImprovement", () => {
	function makePool(
		reportRow: {
			status: string | null;
			evidence_gate_blocking_reason: string | null;
			last_auto_rerun_at: string | null;
		} | null,
		auditUpdateResult?: { rowCount: number }
	) {
		const rows = reportRow ? [{ ...reportRow, updated_at: "2026-03-06T10:00:00.000000" }] : [];
		return {
			query: vi.fn().mockImplementation((sql: string) => {
				if (sql.includes("UPDATE")) {
					return Promise.resolve(auditUpdateResult ?? { rowCount: 1 });
				}
				return Promise.resolve({ rows });
			}),
		} as unknown as import("pg").Pool;
	}

	function makeEnqueue() {
		const add = vi.fn().mockResolvedValue({ id: "mock-job-id" });
		const enqueue: EnqueueHandle = { add };
		return { enqueue, add };
	}

	it("enqueues when policy passes (coverage 0.45 → 0.61, deterministic_only)", async () => {
		const pool = makePool({
			status: "deterministic_only",
			evidence_gate_blocking_reason: "EVIDENCE_GATE_LOW_COVERAGE",
			last_auto_rerun_at: null,
		});
		const { enqueue, add } = makeEnqueue();

		const decision = await maybeEnqueueInvestorInsightsAfterOcrImprovement({
			pool,
			dealId: DEAL_ID,
			coverageBefore: 0.45,
			coverageAfter: 0.61,
			threshold: THRESHOLD,
			enqueue,
		});

		expect(decision.shouldEnqueue).toBe(true);
		expect(add).toHaveBeenCalledOnce();

		// Verify job data shape
		const [jobName, jobData, jobOpts] = add.mock.calls[0]!;
		expect(jobName).toBe("generate_investor_insights");
		expect(jobData).toMatchObject({
			deal_id: DEAL_ID,
			engine_version: "v1",
			triggered_by: "auto_rerun_after_ocr",
			force_recompute: true,
			mode: "standard",
		});
		expect(typeof jobOpts?.jobId).toBe("string");
		expect(jobOpts?.jobId).toContain("auto_rerun_after_ocr");
	});

	it("skips enqueue when coverage improvement is too small (0.45 → 0.47)", async () => {
		const pool = makePool({
			status: "deterministic_only",
			evidence_gate_blocking_reason: "EVIDENCE_GATE_LOW_COVERAGE",
			last_auto_rerun_at: null,
		});
		const { enqueue, add } = makeEnqueue();

		const decision = await maybeEnqueueInvestorInsightsAfterOcrImprovement({
			pool,
			dealId: DEAL_ID,
			coverageBefore: 0.45,
			coverageAfter: 0.47,
			threshold: THRESHOLD,
			enqueue,
		});

		expect(decision.shouldEnqueue).toBe(false);
		if (!decision.shouldEnqueue) {
			expect(decision.skipReason).toBe("no_material_improvement");
		}
		expect(add).not.toHaveBeenCalled();
	});

	it("skips enqueue when report is complete (report_succeeded)", async () => {
		const pool = makePool({
			status: "complete",
			evidence_gate_blocking_reason: null,
			last_auto_rerun_at: null,
		});
		const { enqueue, add } = makeEnqueue();

		const decision = await maybeEnqueueInvestorInsightsAfterOcrImprovement({
			pool,
			dealId: DEAL_ID,
			coverageBefore: 0.45,
			coverageAfter: 0.61,
			threshold: THRESHOLD,
			enqueue,
		});

		expect(decision.shouldEnqueue).toBe(false);
		if (!decision.shouldEnqueue) {
			expect(decision.skipReason).toBe("report_succeeded");
		}
		expect(add).not.toHaveBeenCalled();
	});

	it("skips enqueue when active job is running for this deal", async () => {
		const pool = makePool({
			status: "deterministic_only",
			evidence_gate_blocking_reason: "EVIDENCE_GATE_LOW_COVERAGE",
			last_auto_rerun_at: null,
		});
		const { enqueue, add } = makeEnqueue();

		const decision = await maybeEnqueueInvestorInsightsAfterOcrImprovement({
			pool,
			dealId: DEAL_ID,
			coverageBefore: 0.45,
			coverageAfter: 0.61,
			threshold: THRESHOLD,
			checkActiveJob: async () => true,
			enqueue,
		});

		expect(decision.shouldEnqueue).toBe(false);
		if (!decision.shouldEnqueue) {
			expect(decision.skipReason).toBe("already_running");
		}
		expect(add).not.toHaveBeenCalled();
	});

	it("skips enqueue when last auto-rerun was recent (cooldown active)", async () => {
		const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
		const pool = makePool({
			status: "deterministic_only",
			evidence_gate_blocking_reason: "EVIDENCE_GATE_LOW_COVERAGE",
			last_auto_rerun_at: thirtyMinAgo,
		});
		const { enqueue, add } = makeEnqueue();

		const decision = await maybeEnqueueInvestorInsightsAfterOcrImprovement({
			pool,
			dealId: DEAL_ID,
			coverageBefore: 0.45,
			coverageAfter: 0.61,
			threshold: THRESHOLD,
			enqueue,
		});

		expect(decision.shouldEnqueue).toBe(false);
		if (!decision.shouldEnqueue) {
			expect(decision.skipReason).toBe("cooldown_active");
		}
		expect(add).not.toHaveBeenCalled();
	});

	it("skips enqueue when DB query fails (fail-open → null report → no_blocked_report)", async () => {
		const pool = {
			query: vi.fn().mockRejectedValue(new Error("DB timeout")),
		} as unknown as import("pg").Pool;
		const { enqueue, add } = makeEnqueue();

		// Should not throw — fails open to skip
		const decision = await maybeEnqueueInvestorInsightsAfterOcrImprovement({
			pool,
			dealId: DEAL_ID,
			coverageBefore: 0.45,
			coverageAfter: 0.61,
			threshold: THRESHOLD,
			enqueue,
		});

		expect(decision.shouldEnqueue).toBe(false);
		expect(add).not.toHaveBeenCalled();
	});

	it("still returns shouldEnqueue=true even when audit_log update fails (non-fatal)", async () => {
		const pool = {
			query: vi.fn().mockImplementation((sql: string) => {
				if (sql.includes("UPDATE")) {
					return Promise.reject(new Error("DB write failed"));
				}
				return Promise.resolve({
					rows: [
						{
							status: "deterministic_only",
							evidence_gate_blocking_reason: "EVIDENCE_GATE_LOW_COVERAGE",
							updated_at: "2026-03-06T10:00:00.000000",
							last_auto_rerun_at: null,
						},
					],
				});
			}),
		} as unknown as import("pg").Pool;
		const { enqueue, add } = makeEnqueue();

		const decision = await maybeEnqueueInvestorInsightsAfterOcrImprovement({
			pool,
			dealId: DEAL_ID,
			coverageBefore: 0.45,
			coverageAfter: 0.61,
			threshold: THRESHOLD,
			enqueue,
		});

		// Enqueue still happened despite DB write failure
		expect(decision.shouldEnqueue).toBe(true);
		expect(add).toHaveBeenCalledOnce();
	});

	it("enqueues and uses an hourly-scoped job ID for BullMQ dedup", async () => {
		const pool = makePool({
			status: "deterministic_only",
			evidence_gate_blocking_reason: "EVIDENCE_GATE_LOW_COVERAGE",
			last_auto_rerun_at: null,
		});
		const { enqueue, add } = makeEnqueue();

		await maybeEnqueueInvestorInsightsAfterOcrImprovement({
			pool,
			dealId: DEAL_ID,
			coverageBefore: 0.45,
			coverageAfter: 0.61,
			threshold: THRESHOLD,
			enqueue,
		});

		const jobOpts = add.mock.calls[0]?.[2];
		// Job ID should contain the deal_id and auto_rerun_after_ocr tag
		expect(jobOpts?.jobId).toContain(DEAL_ID);
		expect(jobOpts?.jobId).toContain("auto_rerun_after_ocr");
		// Hourly slot: should contain the hour string from current ISO time
		const hourSlot = new Date().toISOString().slice(0, 13);
		expect(jobOpts?.jobId).toContain(hourSlot);
	});

	it("enqueues for threshold-crossed scenario (0.52 → 0.57)", async () => {
		const pool = makePool({
			status: "deterministic_only",
			evidence_gate_blocking_reason: "EVIDENCE_GATE_LOW_COVERAGE",
			last_auto_rerun_at: null,
		});
		const { enqueue, add } = makeEnqueue();

		const decision = await maybeEnqueueInvestorInsightsAfterOcrImprovement({
			pool,
			dealId: DEAL_ID,
			coverageBefore: 0.52,
			coverageAfter: 0.57,
			threshold: THRESHOLD,
			enqueue,
		});

		expect(decision.shouldEnqueue).toBe(true);
		if (decision.shouldEnqueue) {
			expect(decision.crossedThreshold).toBe(true);
		}
		expect(add).toHaveBeenCalledOnce();
	});
});

// ─── Constant exports ─────────────────────────────────────────────────────────

describe("exported constants", () => {
	it("OCR_AUTO_RERUN_MIN_DELTA is 0.05", () => {
		expect(OCR_AUTO_RERUN_MIN_DELTA).toBe(0.05);
	});

	it("OCR_AUTO_RERUN_COOLDOWN_MS is 1 hour in ms", () => {
		expect(OCR_AUTO_RERUN_COOLDOWN_MS).toBe(60 * 60 * 1000);
	});
});
