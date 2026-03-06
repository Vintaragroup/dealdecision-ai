/**
 * PR31 — OCR Auto-Rerun Helper: maybeEnqueueInvestorInsightsAfterOcrImprovement
 *
 * After the OCR backfill (step 6a-ocr inside investor-insights/processor.ts)
 * materially improves DPU coverage, this module decides whether to enqueue a
 * follow-up investor_insights run so the stale deterministic_only report is
 * automatically refreshed without manual intervention.
 *
 * Policy (all must hold to enqueue):
 *   1. coverage_after > coverage_before
 *   2. improvement is material: delta >= OCR_AUTO_RERUN_MIN_DELTA (0.05)
 *      OR the improvement crossed the evidence gate threshold (0.55)
 *   3. latest investor_insights report is deterministic_only OR was blocked by
 *      EVIDENCE_GATE_LOW_COVERAGE (not already "complete")
 *   4. no investor_insights job is currently active for this deal
 *   5. cooldown guard: last auto-rerun attempted_at is beyond
 *      OCR_AUTO_RERUN_COOLDOWN_MS ago (1 h), using the audit_log metadata
 *      stored in investor_insight_reports
 *
 * Safeguards against infinite loops:
 *   - Cooldown: at most one auto-rerun per hour per deal
 *   - Active-job check: skip if a job is already running for this deal
 *   - No rerun if report already succeeded ("complete")
 *   - Deterministic BullMQ job ID (hourly slot) prevents duplicate waiting jobs
 */

import type { Pool } from "pg";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Minimum absolute coverage delta required to trigger an auto-rerun. */
export const OCR_AUTO_RERUN_MIN_DELTA = 0.05;

/** Minimum interval between auto-reruns for the same deal (1 hour in ms). */
export const OCR_AUTO_RERUN_COOLDOWN_MS = 60 * 60 * 1000;

// ─── Types ────────────────────────────────────────────────────────────────────

/** Reason codes for skipping the auto-rerun. */
export type OcrAutoRerunSkipReason =
	| "no_material_improvement"
	| "no_blocked_report"
	| "already_running"
	| "cooldown_active"
	| "report_succeeded";

/** Lightweight snapshot of the most-recent investor_insight_reports row. */
export interface LatestReportMeta {
	/** render_package.status from the last persisted report. */
	status: string;
	/** evidence_gate.blocking_reason from the last persisted report (null if not set). */
	evidenceGateBlockingReason: string | null;
	/** ISO timestamp of the last DB update. */
	updatedAt: string;
}

export type OcrAutoRerunDecision =
	| {
			shouldEnqueue: true;
			triggerReason: "coverage_crossed_threshold" | "coverage_delta_sufficient";
			crossedThreshold: boolean;
			delta: number;
	  }
	| {
			shouldEnqueue: false;
			skipReason: OcrAutoRerunSkipReason;
	  };

// ─── Pure policy helper (fully unit-testable) ─────────────────────────────────

/**
 * Decide whether to enqueue an auto investor_insights rerun after OCR backfill.
 *
 * Pure function — no DB / queue access. Inject `hasActiveJob` and
 * `lastAutoRerunAt` from callers (DB-backed in production; mocked in tests).
 */
export function decideMaybeEnqueue(opts: {
	coverageBefore: number;
	coverageAfter: number;
	/** The evidence gate threshold (e.g. 0.55). */
	threshold: number;
	/** Latest persisted report metadata, or null when no report exists yet. */
	latestReport: LatestReportMeta | null;
	/** True if an investor_insights job is currently active for this deal. */
	hasActiveJob: boolean;
	/**
	 * ISO timestamp of the most recent auto-rerun attempt for this deal,
	 * or null if none has been recorded.
	 */
	lastAutoRerunAt: string | null;
	/** Override wall-clock time for unit testing. */
	nowMs?: number;
}): OcrAutoRerunDecision {
	const {
		coverageBefore,
		coverageAfter,
		threshold,
		latestReport,
		hasActiveJob,
		lastAutoRerunAt,
		nowMs = Date.now(),
	} = opts;

	// ── Guard 1: no active job ────────────────────────────────────────────────
	if (hasActiveJob) {
		return { shouldEnqueue: false, skipReason: "already_running" };
	}

	// ── Guard 2: cooldown ─────────────────────────────────────────────────────
	if (lastAutoRerunAt !== null) {
		const elapsed = nowMs - new Date(lastAutoRerunAt).getTime();
		if (elapsed < OCR_AUTO_RERUN_COOLDOWN_MS) {
			return { shouldEnqueue: false, skipReason: "cooldown_active" };
		}
	}

	// ── Guard 3: latest report must be in a re-runnable state ─────────────────
	if (latestReport === null) {
		return { shouldEnqueue: false, skipReason: "no_blocked_report" };
	}
	if (latestReport.status === "complete") {
		return { shouldEnqueue: false, skipReason: "report_succeeded" };
	}
	const isBlockedOrDeterministicOnly =
		latestReport.status === "deterministic_only" ||
		latestReport.evidenceGateBlockingReason === "EVIDENCE_GATE_LOW_COVERAGE";
	if (!isBlockedOrDeterministicOnly) {
		return { shouldEnqueue: false, skipReason: "no_blocked_report" };
	}

	// ── Guard 4: material coverage improvement ────────────────────────────────
	const delta = coverageAfter - coverageBefore;
	const crossedThreshold = coverageBefore < threshold && coverageAfter >= threshold;
	const materialImprovement = delta >= OCR_AUTO_RERUN_MIN_DELTA || crossedThreshold;

	if (!materialImprovement) {
		return { shouldEnqueue: false, skipReason: "no_material_improvement" };
	}

	const triggerReason = crossedThreshold
		? "coverage_crossed_threshold"
		: "coverage_delta_sufficient";

	return { shouldEnqueue: true, triggerReason, crossedThreshold, delta };
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

/**
 * Load the most-recent investor_insight_reports metadata needed by the
 * auto-rerun policy (status, evidence_gate.blocking_reason, updated_at).
 *
 * Best-effort: returns null on error or when no row is found.
 */
export async function loadLatestReportMetaForAutoRerun(
	pool: Pool,
	dealId: string
): Promise<{ reportMeta: LatestReportMeta | null; lastAutoRerunAt: string | null }> {
	try {
		const { rows } = await pool.query<{
			status: string | null;
			evidence_gate_blocking_reason: string | null;
			updated_at: string;
			last_auto_rerun_at: string | null;
		}>(
			`SELECT
			    render_package->>'status'                                  AS status,
			    render_package->'evidence_gate'->>'blocking_reason'        AS evidence_gate_blocking_reason,
			    updated_at::text                                           AS updated_at,
			    (
			      SELECT elem->>'attempted_at'
			        FROM jsonb_array_elements(COALESCE(iir2.audit_log, '[]'::jsonb)) AS elem
			       WHERE elem->>'event' = 'AUTO_RERUN_AFTER_OCR_ATTEMPTED'
			       ORDER BY elem->>'attempted_at' DESC
			       LIMIT 1
			    ) AS last_auto_rerun_at
			   FROM public.investor_insight_reports iir2
			  WHERE iir2.deal_id = $1::uuid
			  ORDER BY iir2.updated_at DESC
			  LIMIT 1`,
			[dealId]
		);

		if (!rows[0]) {
			return { reportMeta: null, lastAutoRerunAt: null };
		}

		const row = rows[0];
		const reportMeta: LatestReportMeta | null = row.status
			? {
					status: row.status,
					evidenceGateBlockingReason: row.evidence_gate_blocking_reason ?? null,
					updatedAt: row.updated_at,
			  }
			: null;

		return { reportMeta, lastAutoRerunAt: row.last_auto_rerun_at ?? null };
	} catch {
		return { reportMeta: null, lastAutoRerunAt: null };
	}
}

/**
 * Append an AUTO_RERUN_AFTER_OCR_ATTEMPTED event to the audit_log of the
 * most-recent investor_insight_reports row for the deal.
 *
 * Non-fatal: failure is swallowed so it never blocks the enqueue path.
 */
export async function recordAutoRerunAttempt(
	pool: Pool,
	dealId: string,
	meta: {
		coverageBefore: number;
		coverageAfter: number;
		triggerReason: string;
		crossedThreshold: boolean;
		jobId: string;
	}
): Promise<void> {
	const event = {
		event: "AUTO_RERUN_AFTER_OCR_ATTEMPTED",
		attempted_at: new Date().toISOString(),
		coverage_before: meta.coverageBefore,
		coverage_after: meta.coverageAfter,
		trigger_reason: meta.triggerReason,
		crossed_threshold: meta.crossedThreshold,
		job_id: meta.jobId,
	};

	try {
		await pool.query(
			`UPDATE public.investor_insight_reports
			    SET audit_log = COALESCE(audit_log, '[]'::jsonb) || $2::jsonb
			  WHERE id = (
			    SELECT id
			      FROM public.investor_insight_reports
			     WHERE deal_id = $1::uuid
			     ORDER BY updated_at DESC
			     LIMIT 1
			  )`,
			[dealId, JSON.stringify([event])]
		);
	} catch {
		// Non-fatal: cooldown metadata write failure must not block the enqueue.
	}
}

// ─── Orchestrated helper ──────────────────────────────────────────────────────

/**
 * Lightweight queue handle type — compatible with BullMQ's Queue.add().
 * Accepting only the subset we need makes this easier to mock in tests.
 */
export interface EnqueueHandle {
	add(
		name: string,
		data: object,
		opts?: { jobId?: string; removeOnComplete?: boolean; removeOnFail?: boolean; attempts?: number; backoff?: object }
	): Promise<{ id?: string } | void>;
}

/**
 * Orchestrated auto-rerun decider + enqueuer.
 *
 * Loads the required DB metadata, evaluates the policy, and (when the policy
 * passes) enqueues a new investor_insights job with:
 *   - triggered_by = "auto_rerun_after_ocr"
 *   - force_recompute = true   (bypasses upstream-fingerprint dedup so the
 *     improved OCR pages are processed in the follow-up run)
 *   - mode = "standard"
 *
 * Emits structured log lines for both the enqueue and every skip path.
 *
 * @param opts.coverageBefore  Coverage ratio before OCR backfill (0–1).
 * @param opts.coverageAfter   Coverage ratio after OCR backfill (0–1).
 * @param opts.threshold       Evidence gate threshold (EVIDENCE_GATE_COVERAGE_THRESHOLD).
 * @param opts.checkActiveJob  Injected fn; returns true if an active II job exists.
 *                             When omitted, defaults to false (safe open).
 * @param opts.enqueue         Injected queue handle or mock.
 */
export async function maybeEnqueueInvestorInsightsAfterOcrImprovement(opts: {
	pool: Pool;
	dealId: string;
	coverageBefore: number;
	coverageAfter: number;
	threshold: number;
	/** Injectable: resolves the hasActiveJob flag. Defaults to () => false. */
	checkActiveJob?: () => Promise<boolean>;
	enqueue: EnqueueHandle;
}): Promise<OcrAutoRerunDecision> {
	const { pool, dealId, coverageBefore, coverageAfter, threshold } = opts;

	// ── Gather inputs ─────────────────────────────────────────────────────────
	const [{ reportMeta, lastAutoRerunAt }, hasActiveJob] = await Promise.all([
		loadLatestReportMetaForAutoRerun(pool, dealId),
		opts.checkActiveJob ? opts.checkActiveJob().catch(() => false) : Promise.resolve(false),
	]);

	const decision = decideMaybeEnqueue({
		coverageBefore,
		coverageAfter,
		threshold,
		latestReport: reportMeta,
		hasActiveJob,
		lastAutoRerunAt,
	});

	if (!decision.shouldEnqueue) {
		console.log(
			JSON.stringify({
				event: "INVESTOR_INSIGHTS_AUTO_RERUN_SKIPPED",
				deal_id: dealId,
				reason_code: decision.skipReason,
				coverage_before: coverageBefore,
				coverage_after: coverageAfter,
				ts: new Date().toISOString(),
			})
		);
		return decision;
	}

	// ── Enqueue ───────────────────────────────────────────────────────────────
	// Hourly-scoped job ID provides natural dedup: BullMQ will not add a second
	// waiting job with the same ID within the same hour.
	const hourSlot = new Date().toISOString().slice(0, 13); // "2026-03-06T11"
	const jobId = `investor_insights__${dealId}__v1__auto_rerun_after_ocr__${hourSlot}`;

	try {
		await opts.enqueue.add(
			"generate_investor_insights",
			{
				deal_id: dealId,
				engine_version: "v1",
				triggered_by: "auto_rerun_after_ocr",
				force_recompute: true,
				mode: "standard",
			},
			{
				jobId,
				removeOnComplete: true,
				removeOnFail: false,
				attempts: 3,
				backoff: { type: "exponential", delay: 1000 },
			}
		);

		// Best-effort: persist event to audit_log for cooldown tracking.
		await recordAutoRerunAttempt(pool, dealId, {
			coverageBefore,
			coverageAfter,
			triggerReason: decision.triggerReason,
			crossedThreshold: decision.crossedThreshold,
			jobId,
		});

		const delta = Math.round(decision.delta * 1000) / 1000;

		console.log(
			JSON.stringify({
				event: "INVESTOR_INSIGHTS_AUTO_RERUN_ENQUEUED",
				deal_id: dealId,
				job_id: jobId,
				coverage_before: coverageBefore,
				coverage_after: coverageAfter,
				delta,
				crossed_threshold: decision.crossedThreshold,
				trigger_reason: decision.triggerReason,
				previous_status: reportMeta?.status ?? null,
				ts: new Date().toISOString(),
			})
		);
	} catch (err) {
		console.warn(
			JSON.stringify({
				event: "INVESTOR_INSIGHTS_AUTO_RERUN_ENQUEUE_FAILED",
				deal_id: dealId,
				error: err instanceof Error ? err.message : String(err),
				ts: new Date().toISOString(),
			})
		);
	}

	return decision;
}
