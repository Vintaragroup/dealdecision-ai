import type { Pool } from "pg";
import type { Job, Processor } from "bullmq";
import { createHash } from "crypto";

function sha256Hex(input: string): string {
	return createHash("sha256").update(input).digest("hex");
}

function stableUuid(seed: string): string {
	const hex = sha256Hex(seed).slice(0, 32);
	const a = hex.slice(0, 8);
	const b = hex.slice(8, 12);
	const c = `4${hex.slice(13, 16)}`;
	const dNibble = ((parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16);
	const d = `${dNibble}${hex.slice(17, 20)}`;
	const e = hex.slice(20, 32);
	return `${a}-${b}-${c}-${d}-${e}`;
}

export function stableLedgerUuid(seed: string): string {
	return stableUuid(seed);
}

function stableJsonStringify(value: unknown): string {
	const seen = new WeakSet<object>();

	const normalize = (v: any): any => {
		if (v === null) return null;
		if (v === undefined) return { __type: "undefined" };
		if (typeof v === "number") return Number.isFinite(v) ? v : String(v);
		if (typeof v === "bigint") return { __type: "bigint", value: v.toString() };
		if (typeof v === "string" || typeof v === "boolean") return v;
		if (v instanceof Date) return { __type: "date", value: v.toISOString() };
		if (Array.isArray(v)) return v.map(normalize);
		if (v instanceof Set) return { __type: "set", value: Array.from(v).map(normalize) };
		if (v instanceof Map) {
			const entries = Array.from(v.entries()).map(([k, val]) => [normalize(k), normalize(val)]);
			entries.sort((a, b) => {
				const ak = JSON.stringify(a[0]);
				const bk = JSON.stringify(b[0]);
				return ak < bk ? -1 : ak > bk ? 1 : 0;
			});
			return { __type: "map", value: entries };
		}

		if (typeof v === "object") {
			if (seen.has(v)) return { __type: "circular" };
			seen.add(v);
			const out: Record<string, any> = {};
			for (const key of Object.keys(v).sort()) {
				out[key] = normalize(v[key]);
			}
			return out;
		}

		return { __type: typeof v, value: String(v) };
	};

	return JSON.stringify(normalize(value));
}

export type StepLedgerIds = {
	run_id: string;
	step_run_id: string;
};

let ledgerUpdatedAtTriggerShape: { runs: boolean; steps: boolean } | null = null;

async function getLedgerUpdatedAtTriggerShape(pool: Pool): Promise<{ runs: boolean; steps: boolean }> {
	if (ledgerUpdatedAtTriggerShape) return ledgerUpdatedAtTriggerShape;
	try {
		const res = await pool.query<{ tgname: string }>(
			`SELECT tgname
			   FROM pg_trigger
			  WHERE tgname IN ('trg_pipeline_runs_set_updated_at','trg_pipeline_step_runs_set_updated_at')
			    AND NOT tgisinternal`
		);
		const names = new Set((res.rows ?? []).map((r) => String((r as any).tgname ?? "")));
		ledgerUpdatedAtTriggerShape = {
			runs: names.has("trg_pipeline_runs_set_updated_at"),
			steps: names.has("trg_pipeline_step_runs_set_updated_at"),
		};
		return ledgerUpdatedAtTriggerShape;
	} catch {
		ledgerUpdatedAtTriggerShape = { runs: false, steps: false };
		return ledgerUpdatedAtTriggerShape;
	}
}

function isMissingTableError(err: any): boolean {
	const code = String(err?.code ?? "");
	// 42P01 = undefined_table
	return code === "42P01";
}

type PipelineRunFinalStatus = "succeeded" | "failed";

type RunFinalizeStats = {
	total_steps: number;
	nonterminal_steps: number;
	failed_steps: number;
	max_finished_at: string | null;
};

async function finalizePipelineRunIfTerminalWithClient(
	client: { query: (sql: string, params?: any[]) => Promise<any> },
	opts: {
		run_id: string;
		source: string;
		step_run_id?: string | null;
		step_status?: string | null;
		triggerShape: { runs: boolean; steps: boolean };
	}
): Promise<{ finalized: boolean; status: PipelineRunFinalStatus | null; stats: RunFinalizeStats | null }> {
	// Lock the run row so only one finalizer can decide at a time.
	const runRes = await client.query(
		`SELECT status
		   FROM pipeline_runs
		  WHERE run_id = $1
		  FOR UPDATE`,
		[opts.run_id]
	);

	const runStatus = String(runRes?.rows?.[0]?.status ?? "").toLowerCase();
	if (runStatus !== "running") {
		return { finalized: false, status: null, stats: null };
	}

	const aggRes = await client.query(
		`SELECT
			COUNT(*)::int AS total_steps,
			COUNT(*) FILTER (WHERE status IN ('running','blocked'))::int AS nonterminal_steps,
			COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_steps,
			MAX(finished_at)::text AS max_finished_at
		   FROM pipeline_step_runs
		  WHERE run_id = $1`,
		[opts.run_id]
	);

	const stats: RunFinalizeStats = {
		total_steps: Number(aggRes?.rows?.[0]?.total_steps ?? 0),
		nonterminal_steps: Number(aggRes?.rows?.[0]?.nonterminal_steps ?? 0),
		failed_steps: Number(aggRes?.rows?.[0]?.failed_steps ?? 0),
		max_finished_at: (aggRes?.rows?.[0]?.max_finished_at as any) ?? null,
	};

	if (!(stats.total_steps > 0)) {
		return { finalized: false, status: null, stats };
	}
	if (stats.nonterminal_steps > 0) {
		// blocked is non-terminal by requirement.
		return { finalized: false, status: null, stats };
	}

	const finalStatus: PipelineRunFinalStatus = stats.failed_steps > 0 ? "failed" : "succeeded";

	let failedStepError: unknown | null = null;
	if (finalStatus === "failed") {
		const errRes = await client.query(
			`SELECT error
			   FROM pipeline_step_runs
			  WHERE run_id = $1 AND status = 'failed'
			  ORDER BY finished_at DESC NULLS LAST, updated_at DESC
			  LIMIT 1`,
			[opts.run_id]
		);
		failedStepError = errRes?.rows?.[0]?.error ?? null;
	}

	const finalizedReason = {
		by: "step_terminality",
		source: opts.source,
		step_run_id: opts.step_run_id ?? null,
		step_status: opts.step_status ?? null,
		stats: {
			total_steps: stats.total_steps,
			nonterminal_steps: stats.nonterminal_steps,
			failed_steps: stats.failed_steps,
			max_finished_at: stats.max_finished_at,
		},
		final_status: finalStatus,
		finalized_at: new Date().toISOString(),
	};

	const updateRes = await client.query(
		`UPDATE pipeline_runs
			SET status = $2,
				finished_at = COALESCE($3::timestamptz, now()),
				summary = summary || jsonb_build_object('finalized_reason', $4::jsonb),
				error = CASE WHEN $2 = 'failed' AND error IS NULL THEN $5::jsonb ELSE error END${
					opts.triggerShape.runs ? "" : ",\n\t\t\t\tupdated_at = now()"
				}
		  WHERE run_id = $1 AND status = 'running'`,
		[
			opts.run_id,
			finalStatus,
			stats.max_finished_at,
			JSON.stringify(finalizedReason),
			failedStepError ? JSON.stringify(failedStepError) : null,
		]
	);

	const finalized = Number(updateRes?.rowCount ?? 0) > 0;
	return { finalized, status: finalized ? finalStatus : null, stats };
}

export async function finalizePipelineRunIfTerminal(
	pool: Pool,
	opts: { run_id: string; source: string; step_run_id?: string | null; step_status?: string | null }
): Promise<{ finalized: boolean; status: PipelineRunFinalStatus | null }> {
	const triggerShape = await getLedgerUpdatedAtTriggerShape(pool);
	let client: any = null;
	try {
		client = await (pool as any).connect();
		await client.query("BEGIN");
		const res = await finalizePipelineRunIfTerminalWithClient(client, {
			run_id: opts.run_id,
			source: opts.source,
			step_run_id: opts.step_run_id ?? null,
			step_status: opts.step_status ?? null,
			triggerShape,
		});
		await client.query("COMMIT");
		return { finalized: res.finalized, status: res.status };
	} catch (err: any) {
		try {
			if (client) await client.query("ROLLBACK");
		} catch {
			// ignore
		}
		if (isMissingTableError(err)) return { finalized: false, status: null };
		return { finalized: false, status: null };
	} finally {
		try {
			if (client) client.release();
		} catch {
			// ignore
		}
	}
}

export async function reconcileStuckPipelineRuns(
	pool: Pool,
	opts?: { batchSize?: number }
): Promise<{ scanned: number; finalized: number; succeeded: number; failed: number }> {
	const batchSize = typeof opts?.batchSize === "number" ? Math.max(1, Math.floor(opts.batchSize)) : 25;
	const triggerShape = await getLedgerUpdatedAtTriggerShape(pool);
	let client: any = null;
	try {
		client = await (pool as any).connect();
		await client.query("BEGIN");

		// Lock candidate runs so multiple reconcilers don't dogpile.
		const candidates = await client.query(
			`SELECT r.run_id
			   FROM pipeline_runs r
			  WHERE r.status = 'running'
				AND EXISTS (SELECT 1 FROM pipeline_step_runs s WHERE s.run_id = r.run_id)
				AND NOT EXISTS (
					SELECT 1
					  FROM pipeline_step_runs s
					 WHERE s.run_id = r.run_id
					   AND s.status IN ('running','blocked')
				)
			  ORDER BY r.started_at ASC
			  LIMIT $1
			  FOR UPDATE SKIP LOCKED`,
			[batchSize]
		);

		const runIds = ((candidates?.rows ?? []) as Array<{ run_id?: unknown }>).
			map((r) => String(r?.run_id ?? "")).
			filter(Boolean);
		let finalized = 0;
		let succeeded = 0;
		let failed = 0;
		for (const runId of runIds) {
			const res = await finalizePipelineRunIfTerminalWithClient(client, {
				run_id: runId,
				source: "reconciler",
				triggerShape,
			});
			if (res.finalized) {
				finalized += 1;
				if (res.status === "failed") failed += 1;
				if (res.status === "succeeded") succeeded += 1;
			}
		}

		await client.query("COMMIT");
		return { scanned: runIds.length, finalized, succeeded, failed };
	} catch (err: any) {
		try {
			if (client) await client.query("ROLLBACK");
		} catch {
			// ignore
		}
		if (isMissingTableError(err)) return { scanned: 0, finalized: 0, succeeded: 0, failed: 0 };
		return { scanned: 0, finalized: 0, succeeded: 0, failed: 0 };
	} finally {
		try {
			if (client) client.release();
		} catch {
			// ignore
		}
	}
}

export function computeInputHash(job: Pick<Job, "name" | "data">): string {
	return sha256Hex(stableJsonStringify({ name: job.name, data: job.data }));
}

export function computeOutputHash(output: unknown): string {
	return sha256Hex(stableJsonStringify(output));
}

export function computeNamedStepInputHash(stepName: string, input: unknown): string {
	return sha256Hex(stableJsonStringify({ step_name: stepName, input }));
}

export function makeNamedStepRunId(stepName: string, jobId: string): string {
	return stableUuid(`pipeline-step-run:${stepName}:${String(jobId ?? "")}`);
}

export async function startNamedStepRunLedger(
	pool: Pool,
	opts: {
		run_id: string;
		step_name: string;
		job_id: string | null;
		input?: unknown;
	}
): Promise<StepLedgerIds | null> {
	const step_run_id = makeNamedStepRunId(opts.step_name, opts.job_id ?? "");
	const input_hash = computeNamedStepInputHash(opts.step_name, opts.input);
	const triggerShape = await getLedgerUpdatedAtTriggerShape(pool);

	try {
		await pool.query(
			`INSERT INTO pipeline_step_runs (step_run_id, run_id, step_name, job_id, input_hash, status)
			 VALUES ($1, $2, $3, $4, $5, 'running')
			 ON CONFLICT (step_run_id) DO UPDATE SET
				status = 'running',
				input_hash = EXCLUDED.input_hash${triggerShape.steps ? "" : ",\n\t\t\t\tupdated_at = now()"}`,
			[step_run_id, opts.run_id, opts.step_name, opts.job_id, input_hash]
		);
		return { run_id: opts.run_id, step_run_id };
	} catch (err: any) {
		if (isMissingTableError(err)) return null;
		return null;
	}
}

export async function startStepRunLedger(
	pool: Pool,
	job: Pick<Job, "id" | "name" | "data">,
	dealId: string | null | undefined
): Promise<StepLedgerIds | null> {
	const run_id = stableUuid(`pipeline-run:${job.name}:${String(job.id ?? "")}`);
	const step_run_id = stableUuid(`pipeline-step-run:${job.name}:${String(job.id ?? "")}`);
	const input_hash = computeInputHash(job as any);
	const triggerShape = await getLedgerUpdatedAtTriggerShape(pool);

	try {
		await pool.query(
			`INSERT INTO pipeline_runs (run_id, deal_id, trigger_type, trigger_job_id, input_hash, status)
			 VALUES ($1, $2, 'bullmq', $3, $4, 'running')
			 ON CONFLICT (run_id) DO UPDATE SET
				status = 'running',
				input_hash = EXCLUDED.input_hash${triggerShape.runs ? "" : ",\n\t\t\t\tupdated_at = now()"}`,
			[run_id, dealId, String(job.id ?? null), input_hash]
		);

		await pool.query(
			`INSERT INTO pipeline_step_runs (step_run_id, run_id, step_name, job_id, input_hash, status)
			 VALUES ($1, $2, $3, $4, $5, 'running')
			 ON CONFLICT (step_run_id) DO UPDATE SET
				status = 'running',
				input_hash = EXCLUDED.input_hash${triggerShape.steps ? "" : ",\n\t\t\t\tupdated_at = now()"}`,
			[step_run_id, run_id, job.name, String(job.id ?? null), input_hash]
		);

		return { run_id, step_run_id };
	} catch (err: any) {
		if (isMissingTableError(err)) return null;
		// Fail open; ledger should never block work.
		return null;
	}
}

export async function finishStepRunLedger(
	pool: Pool,
	ids: StepLedgerIds,
	status: "succeeded" | "failed",
	payload: { output?: unknown; summary?: any; error?: any }
): Promise<void> {
	try {
		const output_hash = payload.output === undefined ? null : computeOutputHash(payload.output);
		const triggerShape = await getLedgerUpdatedAtTriggerShape(pool);
		await pool.query(
			`UPDATE pipeline_step_runs
			 SET status = $3,
				 output_hash = $4,
				 summary = COALESCE($5::jsonb, '{}'::jsonb),
				 error = $6::jsonb,
				 finished_at = now()${triggerShape.steps ? "" : ",\n\t\t\t\t updated_at = now()"}
			 WHERE step_run_id = $1 AND run_id = $2`,
			[
				ids.step_run_id,
				ids.run_id,
				status,
				output_hash,
				payload.summary ? JSON.stringify(payload.summary) : "{}",
				payload.error ? JSON.stringify(payload.error) : null,
			]
		);

		await pool.query(
			`UPDATE pipeline_runs
			 SET status = CASE WHEN $2 = 'failed' THEN 'failed' ELSE status END,
				 finished_at = CASE WHEN $2 = 'failed' THEN now() ELSE finished_at END${triggerShape.runs ? "" : ",\n\t\t\t\t updated_at = now()"}
			 WHERE run_id = $1`,
			[ids.run_id, status]
		);

		// Immediate finalization: if all steps are terminal (blocked is non-terminal), finalize run.
		// Never rely on jobs/trigger ids; pipeline_step_runs is the source of truth.
		if (status === "succeeded") {
			await finalizePipelineRunIfTerminal(pool, {
				run_id: ids.run_id,
				source: "finish_step",
				step_run_id: ids.step_run_id,
				step_status: status,
			});
		}
	} catch (err: any) {
		if (isMissingTableError(err)) return;
		return;
	}
}

export function extractDealIdFromJob(job: Pick<Job, "data">): string | null {
	const d: any = job.data as any;
	const dealId = d?.deal_id ?? d?.dealId ?? d?.deal?.id ?? null;
	return typeof dealId === "string" ? dealId : null;
}

export function wrapProcessorWithRunLedger<T>(pool: Pool, processor: (job: Job<T>) => Promise<any>) {
	return async (job: Job<T>) => {
		const dealId = extractDealIdFromJob(job);
		const ids = await startStepRunLedger(pool, job as any, dealId);

		try {
			const output = await processor(job);
			const summary =
				output && typeof output === "object" && (output as any).__step_summary != null
					? (output as any).__step_summary
					: { ok: true };
			if (ids) await finishStepRunLedger(pool, ids, "succeeded", { output, summary });
			return output;
		} catch (err: any) {
			if (ids) await finishStepRunLedger(pool, ids, "failed", { error: { message: err?.message ?? String(err) } });
			throw err;
		}
	};
}

export function wrapBullmqProcessorWithRunLedger(
	getPool: () => Pool,
	processor: Processor<any, any, string>
): Processor<any, any, string> {
	return async (job, token) => {
		let pool: Pool | null = null;
		try {
			pool = getPool();
		} catch {
			pool = null;
		}

		if (!pool) return await processor(job, token);

		const dealId = extractDealIdFromJob(job);
		const ids = await startStepRunLedger(pool, job as any, dealId);
		if (ids) {
			try {
				// Attach provenance for downstream code (best-effort, in-memory only).
				(job.data as any).__pipeline_ledger = ids;
			} catch {
				// ignore
			}
		}
		try {
			const output = await processor(job, token);
			const summary =
				output && typeof output === "object" && (output as any).__step_summary != null
					? (output as any).__step_summary
					: { ok: true };
			if (ids) await finishStepRunLedger(pool, ids, "succeeded", { output, summary });
			return output;
		} catch (err: any) {
			if (ids)
				await finishStepRunLedger(pool, ids, "failed", {
					error: { message: err?.message ?? String(err) },
				});
			throw err;
		}
	};
}
