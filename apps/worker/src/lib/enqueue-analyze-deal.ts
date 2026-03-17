/**
 * Shared helper for enqueueing analyze_deal jobs.
 *
 * Extracted from index.ts so extract_visuals and other processors can import it
 * without depending on the monolithic index module.
 */

import { sanitizeText } from "@dealdecision/core";
import { getPool } from "./db";
import { enqueuePersistedJob } from "./job-enqueue";

async function countVisualAssetsForDeal(
	pool: ReturnType<typeof getPool>,
	dealId: string
): Promise<number | null> {
	try {
		const { rows } = await pool.query<{ c: number }>(
			`SELECT COUNT(*)::int AS c
			   FROM visual_assets va
			   JOIN documents d ON d.id = va.document_id
			  WHERE d.deal_id = $1`,
			[sanitizeText(dealId)]
		);
		return typeof rows?.[0]?.c === "number" ? rows[0].c : null;
	} catch {
		return null;
	}
}

export async function enqueueAnalyzeDeal(params: {
	dealId: string | null | undefined;
	reason: string;
	triggerJobId?: string | null;
	shouldEnqueue?: boolean;
	skipReason?: string | null;
	prereq?: Record<string, unknown>;
	extra?: Record<string, unknown>;
}): Promise<{ enqueued: boolean; jobId: string | null }> {
	const dealId = typeof params.dealId === "string" ? params.dealId.trim() : "";
	const mergedExtra = {
		...(params.prereq ?? {}),
		...(params.extra ?? {}),
	};
	if (params.shouldEnqueue === false) {
		console.warn(
			JSON.stringify({
				event: "ANALYZE_DEAL_SKIPPED",
				deal_id: dealId || null,
				reason: params.reason,
				gate: params.skipReason ?? "gated",
				trigger_job_id: params.triggerJobId ?? null,
				extra: mergedExtra,
			})
		);
		return { enqueued: false, jobId: null };
	}
	if (!dealId) {
		console.warn(
			JSON.stringify({
				event: "ANALYZE_DEAL_SKIPPED",
				reason: params.reason,
				gate: "missing_deal_id",
				trigger_job_id: params.triggerJobId ?? null,
				extra: mergedExtra,
			})
		);
		return { enqueued: false, jobId: null };
	}

	// IMPORTANT: jobs are tracked in Postgres via job_id. Persist before BullMQ picks up.
	// Use enqueuePersistedJob so the same job_id is used for both DB and BullMQ.
	try {
		const pool = getPool();
		const visualAssetsTotal = await countVisualAssetsForDeal(pool, dealId);
		const prereq = { ...mergedExtra, visual_assets_total: visualAssetsTotal };

		const payload = {
			deal_id: dealId,
			reason: params.reason,
			...(params.triggerJobId ? { parent_job_id: params.triggerJobId } : {}),
			prereq,
		};

		const persisted = await enqueuePersistedJob({
			type: "analyze_deal",
			deal_id: dealId,
			parent_job_id: params.triggerJobId ?? null,
			payload,
		});

		console.log(
			JSON.stringify({
				event: "ANALYZE_DEAL_ENQUEUED",
				deal_id: dealId,
				reason: params.reason,
				job_id: persisted.job_id,
				trigger_job_id: params.triggerJobId ?? null,
				prereq,
			})
		);
		return { enqueued: true, jobId: persisted.job_id };
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		if (msg.toLowerCase().includes("exists") || msg.toLowerCase().includes("already exists")) {
			console.warn(
				JSON.stringify({
					event: "ANALYZE_DEAL_SKIPPED",
					deal_id: dealId,
					reason: params.reason,
					gate: "already_enqueued",
					trigger_job_id: params.triggerJobId ?? null,
					error: msg,
				})
			);
			return { enqueued: false, jobId: null };
		}
		console.warn(
			JSON.stringify({
				event: "ANALYZE_DEAL_ENQUEUE_FAILED",
				deal_id: dealId,
				reason: params.reason,
				trigger_job_id: params.triggerJobId ?? null,
				error: msg,
			})
		);
		return { enqueued: false, jobId: null };
	}
}
