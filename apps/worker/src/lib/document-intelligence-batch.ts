import type { Pool } from "pg";
import { randomUUID } from "crypto";

import { sanitizeDeep, sanitizeText } from "@dealdecision/core";

import { sanitizeJobId } from "./job-id";

export type EligibleDocumentRow = {
	id: string;
	uploaded_at: string | null;
	updated_at: string | null;
};

export type DocumentIntelligenceBatchPlan = {
	doc_ids_selected: string[];
	doc_ids_to_enqueue: string[];
	doc_ids_skipped_active: string[];
	active_job_ids: string[];
};

export type DocumentIntelligenceBatchOutcome = {
	ok: boolean;
	timed_out: boolean;
	failed_job_ids: string[];
	cancelled_job_ids: string[];
	succeeded_job_ids: string[];
	succeeded_with_warnings_job_ids: string[];
};

const ACTIVE_JOB_STATUSES = ["queued", "running", "retrying"] as const;
const TERMINAL_JOB_STATUSES = ["succeeded", "succeeded_with_warnings", "failed", "cancelled"] as const;

function uniqSorted(values: string[]): string[] {
	return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

export async function selectDocumentsForDocumentIntelligenceBatch(pool: Pool, dealId: string): Promise<EligibleDocumentRow[]> {
	const { rows } = await pool.query<EligibleDocumentRow>(
		`
		SELECT id, uploaded_at, updated_at
		  FROM documents
		 WHERE deal_id = $1
		   AND deleted_at IS NULL
		   AND ready_for_analysis_at IS NOT NULL
		   AND status = ANY($2::text[])
		 ORDER BY uploaded_at ASC NULLS LAST, updated_at ASC, id ASC
		`,
		[sanitizeText(dealId), ["ready_for_analysis", "completed"]]
	);
	return (rows ?? []).filter((r) => typeof r?.id === "string" && r.id.length > 0);
}

export async function loadActiveDocumentIntelligenceJobs(
	pool: Pool,
	dealId: string,
	documentIds: string[]
): Promise<Map<string, string[]>> {
	const ids = uniqSorted(documentIds);
	const out = new Map<string, string[]>();
	if (ids.length === 0) return out;

	const { rows } = await pool.query<{ job_id: string; document_id: string }>(
		`
		SELECT job_id, document_id
		  FROM jobs
		 WHERE deal_id = $1
		   AND type = 'document_intelligence_extract'
		   AND document_id = ANY($2::uuid[])
		   AND status = ANY($3::text[])
		 ORDER BY document_id ASC, job_id ASC
		`,
		[sanitizeText(dealId), ids.map((d) => sanitizeText(d)), ACTIVE_JOB_STATUSES]
	);

	for (const r of rows ?? []) {
		const docId = typeof r?.document_id === "string" ? r.document_id : "";
		const jobId = typeof r?.job_id === "string" ? r.job_id : "";
		if (!docId || !jobId) continue;
		const arr = out.get(docId) ?? [];
		arr.push(jobId);
		out.set(docId, arr);
	}

	return out;
}

export function planDocumentIntelligenceBatch(selectedDocIds: string[], activeJobsByDocId: Map<string, string[]>): DocumentIntelligenceBatchPlan {
	const selected = uniqSorted(selectedDocIds);
	const skippedActive: string[] = [];
	const toEnqueue: string[] = [];
	const activeJobIds: string[] = [];

	for (const docId of selected) {
		const active = activeJobsByDocId.get(docId) ?? [];
		if (active.length > 0) {
			skippedActive.push(docId);
			activeJobIds.push(...active);
			continue;
		}
		toEnqueue.push(docId);
	}

	return {
		doc_ids_selected: selected,
		doc_ids_to_enqueue: toEnqueue,
		doc_ids_skipped_active: skippedActive,
		active_job_ids: uniqSorted(activeJobIds),
	};
}

export async function enqueueDocumentIntelligenceExtractJobs(opts: {
	dealId: string;
	documentIds: string[];
	parentJobId: string | null;
	run_id: string | null;
	step_run_id: string | null;
}): Promise<string[]> {
	// Lazy import to keep this module import-safe in unit tests (queue init requires REDIS_URL).
	const { enqueuePersistedJob } = await import("./job-enqueue.js");

	const enqueued: string[] = [];
	for (const docId of uniqSorted(opts.documentIds)) {
		const payload = sanitizeDeep({
			reason: "document_intelligence_batch",
			...(opts.run_id ? { run_id: opts.run_id } : {}),
			...(opts.step_run_id ? { step_run_id: opts.step_run_id } : {}),
			...(opts.parentJobId ? { parent_job_id: opts.parentJobId } : {}),
		}) as Record<string, unknown>;

		const { job_id } = await enqueuePersistedJob({
			type: "document_intelligence_extract",
			deal_id: opts.dealId,
			document_id: docId,
			parent_job_id: opts.parentJobId,
			payload,
		});
		enqueued.push(job_id);
	}
	return enqueued;
}

export async function pollJobsToTerminal(
	pool: Pool,
	jobIds: string[],
	opts?: { timeoutMs?: number; pollMs?: number }
): Promise<DocumentIntelligenceBatchOutcome> {
	const ids = uniqSorted(jobIds);
	if (ids.length === 0) {
		return {
			ok: true,
			timed_out: false,
			failed_job_ids: [],
			cancelled_job_ids: [],
			succeeded_job_ids: [],
			succeeded_with_warnings_job_ids: [],
		};
	}

	const timeoutMs = typeof opts?.timeoutMs === "number" ? opts.timeoutMs : 10 * 60_000;
	const pollMs = typeof opts?.pollMs === "number" ? opts.pollMs : 2000;

	const started = Date.now();
	while (true) {
		const { rows } = await pool.query<{ job_id: string; status: string | null }>(
			`SELECT job_id, status FROM jobs WHERE job_id = ANY($1::text[]) ORDER BY job_id ASC`,
			[ids.map((j) => sanitizeText(j))]
		);

		const statusById = new Map<string, string>();
		for (const r of rows ?? []) {
			if (typeof r?.job_id !== "string") continue;
			statusById.set(r.job_id, String(r.status ?? ""));
		}

		const failed: string[] = [];
		const cancelled: string[] = [];
		const succeeded: string[] = [];
		const succeededWarn: string[] = [];
		let allTerminal = true;

		for (const id of ids) {
			const st = String(statusById.get(id) ?? "").toLowerCase();
			if (!TERMINAL_JOB_STATUSES.includes(st as any)) {
				allTerminal = false;
				continue;
			}
			if (st === "failed") failed.push(id);
			else if (st === "cancelled") cancelled.push(id);
			else if (st === "succeeded_with_warnings") succeededWarn.push(id);
			else if (st === "succeeded") succeeded.push(id);
		}

		if (allTerminal) {
			return {
				ok: failed.length === 0 && cancelled.length === 0,
				timed_out: false,
				failed_job_ids: uniqSorted(failed),
				cancelled_job_ids: uniqSorted(cancelled),
				succeeded_job_ids: uniqSorted(succeeded),
				succeeded_with_warnings_job_ids: uniqSorted(succeededWarn),
			};
		}

		if (Date.now() - started > timeoutMs) {
			return {
				ok: false,
				timed_out: true,
				failed_job_ids: uniqSorted(failed),
				cancelled_job_ids: uniqSorted(cancelled),
				succeeded_job_ids: uniqSorted(succeeded),
				succeeded_with_warnings_job_ids: uniqSorted(succeededWarn),
			};
		}

		await new Promise<void>((resolve) => setTimeout(resolve, pollMs));
	}
}

export async function insertBlockedAnalyzeJob(pool: Pool, opts: {
	dealId: string;
	parentJobId: string | null;
	reason: string;
	message: string;
	details?: Record<string, unknown>;
}): Promise<{ job_id: string }> {
	const jobId = sanitizeJobId(randomUUID());
	const payload = sanitizeDeep({
		reason: opts.reason,
		blocked_by: "document_intelligence_batch",
		...(opts.details ? { details: opts.details } : {}),
		...(opts.parentJobId ? { parent_job_id: opts.parentJobId } : {}),
	}) as Record<string, unknown>;

	await pool.query(
		`INSERT INTO jobs (
			job_id, deal_id, document_id, type, queue, status,
			payload, parent_job_id,
			progress_pct, message, error,
			stage, progress_current, progress_total,
			started_at, finished_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13,$14,now(),now())`,
		[
			sanitizeText(jobId),
			sanitizeText(opts.dealId),
			null,
			"analyze_deal",
			"analyze_deal",
			"failed",
			JSON.stringify(payload),
			opts.parentJobId ? sanitizeText(opts.parentJobId) : null,
			100,
			sanitizeText(opts.message),
			sanitizeText(opts.message),
			"blocked",
			100,
			100,
		]
	);

	return { job_id: jobId };
}
